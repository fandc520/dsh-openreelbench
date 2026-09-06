/**
 * The script screen — the second gate, and the one that decides the film.
 *
 * A section is a shot: one spoken line, one image. So the editor is a table of
 * sections rather than a prose box, because the thing being approved is the
 * *breakdown*, not the wording.
 *
 * Two layers of checking, deliberately split:
 *
 *   - Style rules (section length, character budget) run here, per keystroke.
 *     The playbook is already in the browser and these are the numbers a writer
 *     is steering by while typing.
 *   - Schema rules run on the host through `POST /studio/validate`, debounced.
 *     Re-implementing them here would put a second copy of the contract in the
 *     browser, and the copy the gate enforces would be the other one.
 *
 * Timings are treated as intent throughout: the compose stage rebuilds the
 * timeline from ffprobe measurements of the real narration. The editor keeps
 * them consistent so the artifact validates, and says as much, rather than
 * pretending they are promises.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { type StudioState, api } from './api.ts'
import { type AgentPhase, BusyLabel } from './busy.tsx'

const NEWLINE = String.fromCharCode(10)

export interface ScriptScreenProps {
  state: StudioState
  onReload: () => Promise<void>
  onSend: (text: string) => Promise<void>
  /** Move the workbench to another stage's screen. */
  onGoToStage: (stageId: string) => void
}

interface DraftSection {
  id: string
  label: string
  text: string
  prompt: string
  deliveryNote: string
  pauseAfter: string
  seconds: string
}

interface DraftScript {
  title: string
  sections: DraftSection[]
  performanceIntent: string
  sampleSectionId: string
}

interface RawSection {
  id?: unknown
  label?: unknown
  text?: unknown
  start_seconds?: unknown
  end_seconds?: unknown
  delivery_cues?: { delivery_note?: unknown; pause_after_seconds?: unknown } | null
  visual?: { prompt?: unknown; style_note?: unknown } | null
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function draftFrom(state: StudioState): DraftScript {
  const script = state.artifacts.script as
    | { title?: unknown; sections?: unknown; voice_performance?: Record<string, unknown> }
    | undefined
  const sections = Array.isArray(script?.sections) ? (script.sections as RawSection[]) : []
  return {
    title: str(script?.title) === '' ? state.project.title : str(script?.title),
    performanceIntent: str(script?.voice_performance?.performance_intent),
    sampleSectionId: str(script?.voice_performance?.sample_section_id),
    sections: sections.map((section, index) => {
      const start = typeof section.start_seconds === 'number' ? section.start_seconds : 0
      const end = typeof section.end_seconds === 'number' ? section.end_seconds : 0
      return {
        id: str(section.id) === '' ? 's' + (index + 1) : str(section.id),
        label: str(section.label),
        text: str(section.text),
        prompt: str(section.visual?.prompt),
        deliveryNote: str(section.delivery_cues?.delivery_note),
        pauseAfter: typeof section.delivery_cues?.pause_after_seconds === 'number'
          ? String(section.delivery_cues.pause_after_seconds)
          : '',
        seconds: (Math.max(0, end - start)).toFixed(1),
      }
    }),
  }
}

/**
 * Rebuild the artifact from the draft, laying sections end to end.
 *
 * Timings are recomputed rather than carried: a user who lengthens section 2
 * has not thought about section 5's start time, and the schema rejects gaps and
 * overlaps. Since compose re-measures everything anyway, the honest thing is to
 * keep them consistent automatically.
 */
function buildScript(draft: DraftScript, style: string): Record<string, unknown> {
  let cursor = 0
  const sections = draft.sections.map((section) => {
    const seconds = Math.max(0.5, Number(section.seconds) || 0)
    const start = cursor
    cursor += seconds
    const cues: Record<string, unknown> = {}
    if (section.deliveryNote.trim() !== '') cues.delivery_note = section.deliveryNote.trim()
    const pause = Number(section.pauseAfter)
    if (section.pauseAfter.trim() !== '' && Number.isFinite(pause)) cues.pause_after_seconds = pause
    return {
      id: section.id.trim(),
      text: section.text.trim(),
      start_seconds: Number(start.toFixed(2)),
      end_seconds: Number(cursor.toFixed(2)),
      ...(section.label.trim() === '' ? {} : { label: section.label.trim() }),
      ...(Object.keys(cues).length === 0 ? {} : { delivery_cues: cues }),
      ...(section.prompt.trim() === '' ? {} : { visual: { prompt: section.prompt.trim(), style_note: style } }),
    }
  })
  const voice: Record<string, unknown> = {}
  if (draft.performanceIntent.trim() !== '') voice.performance_intent = draft.performanceIntent.trim()
  if (draft.sampleSectionId.trim() !== '') voice.sample_section_id = draft.sampleSectionId.trim()
  return {
    version: '1.0',
    title: draft.title.trim(),
    total_duration_seconds: Number(cursor.toFixed(2)),
    sections,
    ...(Object.keys(voice).length === 0 ? {} : { voice_performance: voice }),
  }
}

export function ScriptScreen({ state, onReload, onSend, onGoToStage }: ScriptScreenProps): JSX.Element {
  const baseline = useMemo(() => draftFrom(state), [state])
  const [draft, setDraft] = useState<DraftScript>(baseline)
  const [touched, setTouched] = useState(false)
  const [phase, setPhase] = useState<AgentPhase | null>(null)
  const [busy, setBusy] = useState(false)
  const [schemaIssues, setSchemaIssues] = useState<Array<{ path: string; message: string }>>([])
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!touched) setDraft(baseline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline])

  const playbook = state.style.playbook
  const stage = state.stages.find((entry) => entry.stage === 'script')
  const approved = stage?.status === 'completed' && stage.human_approved
  const hasScript = state.artifacts.script !== undefined

  const totalSeconds = draft.sections.reduce((sum, s) => sum + (Number(s.seconds) || 0), 0)
  const totalChars = draft.sections.reduce((sum, s) => sum + s.text.trim().length, 0)
  const budget = Math.round(state.project.target_duration_seconds * playbook.narration.chars_per_second)

  /**
   * Two severities, and the difference matters.
   *
   * `blocking` is what the gate would reject or what leaves the next stage
   * with nothing to work from. `advice` is the style playbook talking — a
   * section under the minimum is not wrong, compose pads it to the floor
   * anyway, and a panel that refuses to submit over a suggestion is just
   * getting in the way of the person it is advising.
   */
  const rowIssues = draft.sections.map((section) => {
    const blocking: string[] = []
    const advice: string[] = []
    const seconds = Number(section.seconds) || 0
    if (section.text.trim() === '') blocking.push('台词是空的')
    if (section.id.trim() === '') blocking.push('缺 id')
    if (section.prompt.trim() === '') advice.push('没写画面提示词，Agent 只能自己编一个')
    if (seconds > playbook.pacing.maxSectionSeconds) {
      advice.push('比这个风格建议的 ' + playbook.pacing.maxSectionSeconds + ' 秒长，一张图可能撑不住，考虑拆段')
    }
    if (seconds > 0 && seconds < playbook.pacing.minSectionSeconds) {
      advice.push('比这个风格建议的 ' + playbook.pacing.minSectionSeconds + ' 秒短，合成时会补到这个长度')
    }
    return { blocking, advice }
  })
  const duplicateIds = new Set(
    draft.sections.map((s) => s.id.trim()).filter((id, index, all) => id !== '' && all.indexOf(id) !== index),
  )

  // Schema checks: debounced, on the host, against the same rules the gate uses.
  useEffect(() => {
    if (debounce.current !== null) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      void api.validate('script', buildScript(draft, state.style.id))
        .then((report) => setSchemaIssues(report.issues))
        .catch(() => setSchemaIssues([]))
    }, 500)
    return () => { if (debounce.current !== null) clearTimeout(debounce.current) }
  }, [draft, state.style.id])

  const blocking = rowIssues.some((issues) => issues.blocking.length > 0)
    || duplicateIds.size > 0
    || schemaIssues.length > 0
    || draft.sections.length === 0
  const adviceCount = rowIssues.reduce((sum, issues) => sum + issues.advice.length, 0)

  function edit(index: number, patch: Partial<DraftSection>): void {
    setTouched(true)
    setResult(null)
    setDraft((previous) => ({
      ...previous,
      sections: previous.sections.map((section, i) => (i === index ? { ...section, ...patch } : section)),
    }))
  }

  function move(index: number, delta: number): void {
    const target = index + delta
    if (target < 0 || target >= draft.sections.length) return
    setTouched(true)
    setDraft((previous) => {
      const sections = [...previous.sections]
      const [moved] = sections.splice(index, 1)
      sections.splice(target, 0, moved!)
      return { ...previous, sections }
    })
  }

  function removeSection(index: number): void {
    setTouched(true)
    setDraft((previous) => ({ ...previous, sections: previous.sections.filter((_, i) => i !== index) }))
  }

  function addSection(): void {
    setTouched(true)
    const used = new Set(draft.sections.map((s) => s.id))
    let n = draft.sections.length + 1
    while (used.has('s' + n)) n += 1
    setDraft((previous) => ({
      ...previous,
      sections: [...previous.sections, {
        id: 's' + n, label: '', text: '', prompt: '', deliveryNote: '', pauseAfter: '',
        seconds: String(playbook.pacing.minSectionSeconds + 2),
      }],
    }))
  }

  async function askForScript(kind: 'draft' | 'regenerate'): Promise<void> {
    if (phase !== null || busy) return
    setResult(null)
    setPhase('sending')
    const before = JSON.stringify(state.artifacts.script ?? null)
    try {
      // The leading `/dsh-creative-studio-storytelling` is a load gesture the
      // harness resolves deterministically, the same way the shots screen loads
      // its cinematography skill. Without it a script comes out as the brief's
      // key points read aloud in order — every sentence true, nothing
      // remembered. The brief's points are parallel; a film is linear, and
      // turning one into the other is a craft with a method.
      await onSend([
        '/dsh-creative-studio-storytelling',
        '',
        ...(kind === 'draft'
          ? ['简报已经通过了，请按它写脚本：分段即分镜，每段一句解说加一张配图，'
            + '写成 script 并以 awaiting_human 提交，我在创意工作台里改。']
          : ['这版脚本我想换个写法，请重写一版 script 并以 awaiting_human 提交。',
            '**分段结构要重新设计，不要只换措辞**——换个钩子类型，或者换一条因果链。']),
        '',
        '交给我时说清楚：用的哪种钩子、整片弧线怎么走、哪一段你拿不准。',
      ].join(NEWLINE))
      setPhase(kind === 'draft' ? 'drafting' : 'regenerating')
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const next = await api.state(state.project.id).catch(() => undefined)
        if (next !== undefined && JSON.stringify(next.artifacts.script ?? null) !== before) {
          setTouched(false)
          await onReload()
          setPhase(null)
          setResult({ kind: 'ok', text: kind === 'draft' ? 'Agent 写好了，逐段看一遍。' : '换了一版，看看这个分法。' })
          return
        }
      }
      setPhase(null)
      setResult({ kind: 'error', text: '等了两分钟没等到新脚本，去对话里看看 Agent 的进度。' })
    } catch (error) {
      setPhase(null)
      setResult({ kind: 'error', text: (error as Error).message })
    }
  }

  async function submit(): Promise<void> {
    if (blocking) return
    setBusy(true)
    setResult(null)
    try {
      await api.submitStage({
        project: state.project.id,
        stage: 'script',
        status: 'completed',
        artifacts: { script: buildScript(draft, state.style.id) },
        human_approved: true,
        note: '在创意工作台确认',
      })
      setTouched(false)
      await onReload()
      // No message to the model here, unlike the brief gate. Nothing is being
      // handed off: the panel generates the narration itself on the next
      // screen, and it already has the script it needs. Telling the model
      // would only invite it to start work the panel is about to do.
      onGoToStage('assets_audio')
    } catch (error) {
      setResult({ kind: 'error', text: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dcs-screen">
      <header className="dcs-screen-head">
        <div>
          <h2 className="dcs-screen-title">脚本</h2>
          <p className="dcs-screen-sub">一段一句解说、一张配图。段落顺序就是分镜顺序。</p>
        </div>
        <span className={'dcs-pill ' + (approved ? 'dcs-pill-ok' : 'dcs-pill-wait')}>
          {approved ? '已审核' : '待确认'}
        </span>
      </header>

      <div className="dcs-summary">
        <span><b>{draft.sections.length}</b> 段</span>
        <span>预估 <b>{totalSeconds.toFixed(1)}</b> 秒 / 目标 {state.project.target_duration_seconds} 秒</span>
        <span className={totalChars > budget * 1.15 ? 'dcs-tone-wait' : undefined}>
          <b>{totalChars}</b> 字 / 预算约 {budget}
        </span>
        <span className="dcs-spacer" />
        <button type="button" className="dcs-btn dcs-btn-small" disabled={phase !== null || busy}
          onClick={() => void askForScript(hasScript ? 'regenerate' : 'draft')}>
          <BusyLabel phase={phase} idle={hasScript ? '重新生成' : '让 Agent 起草'} />
        </button>
      </div>

      <p className="dcs-hint">
        这里填的时长是<b>预估</b>：合成时会按 ffprobe 量出的真实配音重排时间轴，字幕也按实测走。
        它的用处是帮你判断分段合不合理。
        {adviceCount > 0
          ? <>　<span className="dcs-tone-wait">黄框</span>是风格建议，不影响提交；红框才是必须改的。</>
          : null}
      </p>

      {draft.sections.length === 0 && phase === null ? (
        <p className="dcs-note">还没有脚本。可以让 Agent 按简报起草一版，也可以自己加段。</p>
      ) : null}

      <div className="dcs-sections">
        {draft.sections.map((section, index) => {
          const issues = rowIssues[index] ?? { blocking: [], advice: [] }
          const dup = duplicateIds.has(section.id.trim())
          const hardFail = issues.blocking.length > 0 || dup
          const rowClass = 'dcs-section-row'
            + (hardFail ? ' dcs-section-error' : issues.advice.length > 0 ? ' dcs-section-advised' : '')
          return (
            <div className={rowClass} key={index}>
              <div className="dcs-section-head">
                <span className="dcs-section-index">{index + 1}</span>
                <input
                  className="dcs-input dcs-input-id"
                  value={section.id}
                  placeholder="编号"
                  title="段落编号。配音和配图文件按它归档，也是 Agent 指认这一段的方式。"
                  onChange={(e) => edit(index, { id: e.target.value })}
                />
                <input
                  className="dcs-input dcs-input-label"
                  value={section.label}
                  placeholder="场次名（选填）"
                  title="只是给人看的名字，例如「开场·撞击预告」。不影响生成。"
                  onChange={(e) => edit(index, { label: e.target.value })}
                />
                <span className="dcs-seconds-wrap">
                  <input
                    className="dcs-input dcs-input-seconds"
                    inputMode="decimal"
                    value={section.seconds}
                    placeholder="时长"
                    title="预估时长，用来判断分段是否合理。成片以实测配音为准。"
                    onChange={(e) => edit(index, { seconds: e.target.value })}
                  />
                  <span className="dcs-unit">秒</span>
                </span>
                <span className="dcs-spacer" />
                <button type="button" className="dcs-icon" title="上移" disabled={index === 0}
                  onClick={() => move(index, -1)}>↑</button>
                <button type="button" className="dcs-icon" title="下移"
                  disabled={index === draft.sections.length - 1} onClick={() => move(index, 1)}>↓</button>
                <button type="button" className="dcs-icon dcs-icon-danger" title="删除这一段"
                  onClick={() => removeSection(index)}>×</button>
              </div>

              <div className="dcs-line">
                <span className="dcs-line-label" title="这一段要念出来的字，也是字幕内容">台词</span>
                <textarea
                  className="dcs-input dcs-textarea"
                  rows={2}
                  value={section.text}
                  placeholder="要念出来的字。不要写「（停顿）」「【画面：…】」——它们会被念出来。"
                  onChange={(e) => edit(index, { text: e.target.value })}
                />
              </div>

              <div className="dcs-line">
                <span
                  className="dcs-line-label"
                  title="这一段画面的主体。它是分镜页每一镜的起点——分镜没写自己的主体时，用的就是这一句。风格和镜头语言由插件分层拼上，不要写在这里。"
                >画面</span>
                <textarea
                  className="dcs-input dcs-textarea dcs-prompt"
                  rows={2}
                  value={section.prompt}
                  placeholder="英文提示词：只写画面主体。风格、镜头、光线由插件分层拼，别写在这"
                  spellCheck={false}
                  onChange={(e) => edit(index, { prompt: e.target.value })}
                />
              </div>

              <div className="dcs-line">
                <span className="dcs-line-label" title="怎么念这一段，以及念完停多久">表达</span>
                <div className="dcs-row">
                  <input
                    className="dcs-input"
                    value={section.deliveryNote}
                    placeholder="选填：一句话说清怎么念，例如「铺垫，收尾放慢」"
                    onChange={(e) => edit(index, { deliveryNote: e.target.value })}
                  />
                  <span className="dcs-seconds-wrap">
                    <input
                      className="dcs-input dcs-input-seconds"
                      inputMode="decimal"
                      value={section.pauseAfter}
                      placeholder="—"
                      title="念完之后停顿几秒，覆盖风格默认值"
                      onChange={(e) => edit(index, { pauseAfter: e.target.value })}
                    />
                    <span className="dcs-unit">秒停顿</span>
                  </span>
                </div>
              </div>

              {hardFail ? (
                <ul className="dcs-problems">
                  {dup ? <li>编号与其他段重复</li> : null}
                  {issues.blocking.map((problem) => <li key={problem}>{problem}</li>)}
                </ul>
              ) : null}
              {issues.advice.length > 0 ? (
                <ul className="dcs-advice">
                  {issues.advice.map((note) => <li key={note}>{note}</li>)}
                </ul>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="dcs-actions">
        <button type="button" className="dcs-btn dcs-btn-small" onClick={addSection}>+ 加一段</button>
        <span className="dcs-spacer" />
      </div>

      {schemaIssues.length > 0 ? (
        <ul className="dcs-problems">
          {schemaIssues.slice(0, 6).map((issue) => (
            <li key={issue.path + issue.message}>{issue.path}：{issue.message}</li>
          ))}
          {schemaIssues.length > 6 ? <li>…还有 {schemaIssues.length - 6} 条</li> : null}
        </ul>
      ) : null}

      <div className="dcs-actions">
        <span className="dcs-hint">
          {approved
            ? '这一版已经确认过了。再提交一次会替换脚本，配音、配图和成片都要重做。'
            : '确认之后 Agent 才会开始配音。之后想改也可以回来重新提交。'}
        </span>
        <span className="dcs-spacer" />
        <button type="button" className="dcs-btn dcs-btn-primary" disabled={busy || phase !== null || blocking}
          onClick={() => void submit()}>
          {busy ? '提交中…' : approved ? '重新提交脚本' : '确认脚本，进入配音'}
        </button>
      </div>

      {result !== null ? (
        <p className={'dcs-note ' + (result.kind === 'ok' ? 'dcs-note-ok' : 'dcs-note-error')}>{result.text}</p>
      ) : null}
    </div>
  )
}

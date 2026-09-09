/**
 * The project screen — the brief gate.
 *
 * It fuses what used to be three separate steps: creating the project, picking
 * a style, and writing the brief. They fuse because a person decides them
 * together, in one look; splitting them into three approvals would be honest to
 * the state machine and hostile to the user.
 *
 * The page reads as three stacked decisions, each in its own card:
 *
 *   项目设置  — two columns: identity (title / duration / platform) on the
 *              left, look (style + its preview card) on the right. One
 *              保存设置 serves both, because they are one save.
 *   创意简报  — the writing surface, with 重新生成 parked in its own corner.
 *   the CTA  — the page's single commitment, centered and loud, because it
 *              submits every field above at once.
 *
 * Two kinds of write leave this screen, and they are deliberately different:
 *
 *   - Marker fields (title, duration, style) go to `POST /studio/project`.
 *     They are project settings, not pipeline state, and changing a title
 *     should not invalidate a script.
 *   - The brief goes to `POST /studio/stage`, which runs the full check set
 *     and moves the gate. Approving here is the same act as telling the model
 *     "看过了，可以" — so it also says exactly that in the conversation, and
 *     the model picks the run up from there.
 */
import { useEffect, useMemo, useState } from 'react'

import { PLATFORM_FRAMES, type Brief, type StudioState, api } from './api.ts'
import { type AgentPhase, BusyLabel } from './busy.tsx'
import { IconCheck, IconDoc, IconMic, IconPalette, IconPlay, IconSliders, IconSpark } from './icons.tsx'

export interface ProjectScreenProps {
  state: StudioState
  onReload: () => Promise<void>
  onSend: (text: string) => Promise<void>
}

interface Draft {
  title: string
  duration: string
  style: string
  platform: string
  hook: string
  keyPoints: string
  audience: string
  tone: string
}

type Note = { kind: 'ok' | 'error'; text: string }

function draftFrom(state: StudioState): Draft {
  const brief = state.artifacts.brief ?? {}
  return {
    title: state.project.title,
    duration: String(state.project.target_duration_seconds),
    style: state.project.style,
    // Marker first, brief second, then the neutral default - the same order
    // the host resolves it in, so the box shows what would actually happen.
    platform: state.project.target_platform
      ?? (typeof brief.target_platform === 'string' ? brief.target_platform : 'generic'),
    hook: typeof brief.hook === 'string' ? brief.hook : '',
    keyPoints: Array.isArray(brief.key_points) ? brief.key_points.join('\n') : '',
    audience: typeof brief.audience === 'string' ? brief.audience : '',
    tone: typeof brief.tone === 'string' ? brief.tone : '',
  }
}

export function ProjectScreen({ state, onReload, onSend }: ProjectScreenProps): JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(state))
  const [busy, setBusy] = useState<'idle' | 'saving' | 'submitting'>('idle')
  const [phase, setPhase] = useState<AgentPhase | null>(null)
  // One note per card, so a save result lands where the save button is and a
  // brief result lands inside the brief card.
  const [saveNote, setSaveNote] = useState<Note | null>(null)
  const [briefNote, setBriefNote] = useState<Note | null>(null)
  const [submitNote, setSubmitNote] = useState<Note | null>(null)

  // Reload replaces the draft only when the user has nothing staged, so a
  // background refresh cannot eat what they are typing.
  const baseline = useMemo(() => draftFrom(state), [state])
  const dirty = useMemo(
    () => (Object.keys(draft) as Array<keyof Draft>).some((key) => draft[key] !== baseline[key]),
    [draft, baseline],
  )
  useEffect(() => {
    if (!dirty) setDraft(baseline)
    // Intentionally keyed on the baseline only: re-running when `dirty` flips
    // would discard the very edit that set it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline])

  const hasBrief = state.artifacts.brief !== undefined
  const stage = state.stages.find((entry) => entry.stage === 'brief')
  const approved = stage?.status === 'completed' && stage.human_approved
  const parked = stage?.status === 'awaiting_human'
  const keyPoints = draft.keyPoints.split('\n').map((line) => line.trim()).filter((line) => line !== '')

  const problems: string[] = []
  if (draft.title.trim() === '') problems.push('标题不能为空')
  if (draft.hook.trim() === '') problems.push('缺开场钩子')
  if (keyPoints.length < 3) problems.push('要点至少三条（现在 ' + keyPoints.length + ' 条）')
  if (keyPoints.length > 5) problems.push('要点最多五条（现在 ' + keyPoints.length + ' 条）')
  const durationValue = Number(draft.duration)
  if (!Number.isFinite(durationValue) || durationValue < 5 || durationValue > 1800) {
    problems.push('时长要在 5–1800 秒之间')
  }

  // The preview follows the DROPDOWN, not the saved project. Reading
  // `state.style.playbook` here would describe the style the user is leaving
  // rather than the one they are considering — the panel would explain the
  // wrong thing at exactly the moment it matters.
  const playbook = state.style.options.find((option) => option.id === draft.style)?.playbook
    ?? state.style.playbook
  const budget = Math.round(durationValue * (playbook.narration.chars_per_second || 4.9))
  const styleChanged = draft.style !== state.project.style
  // Same rule as the style preview: follow the DROPDOWN, not the saved value,
  // so the hint describes the choice being considered.
  const platformFrame = PLATFORM_FRAMES.find((option) => option.id === draft.platform)
  const platformChanged = draft.platform !== (state.project.target_platform ?? 'generic')

  function set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setSaveNote(null)
    setBriefNote(null)
    setSubmitNote(null)
    setDraft((previous) => ({ ...previous, [key]: value }))
  }

  /** Persist the marker fields without touching pipeline state. */
  async function saveSettings(): Promise<void> {
    setBusy('saving')
    setSaveNote(null)
    try {
      await api.updateProject({
        project: state.project.id,
        title: draft.title.trim(),
        target_duration_seconds: durationValue,
        style: draft.style,
        target_platform: draft.platform,
      })
      await onReload()
      setSaveNote({ kind: 'ok', text: '已保存。' })
    } catch (error) {
      setSaveNote({ kind: 'error', text: (error as Error).message })
    } finally {
      setBusy('idle')
    }
  }

  /**
   * Ask the model for a brief, then watch the artifact until it changes.
   *
   * Like the welcome screen's wait, this polls: the model writes the brief
   * through its own tool call and the panel has no push channel, so a changed
   * artifact is the only signal that the request landed.
   */
  async function askForBrief(kind: 'draft' | 'regenerate'): Promise<void> {
    if (phase !== null || busy !== 'idle') return
    setBriefNote(null)
    setPhase('sending')
    const before = JSON.stringify(state.artifacts.brief ?? null)
    try {
      await onSend(kind === 'draft'
        ? '请为项目「' + state.project.title + '」起草创意简报（钩子、三到五条要点、受众、调性），'
          + '写成 brief 并以 awaiting_human 提交，我在创意工作台里看。'
        : '这版简报的方向我想换一个。请重新起草一版**方向不同**的创意简报，'
          + '同样写成 brief 并以 awaiting_human 提交。')
      setPhase(kind === 'draft' ? 'drafting' : 'regenerating')
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const next = await api.state(state.project.id).catch(() => undefined)
        if (next !== undefined && JSON.stringify(next.artifacts.brief ?? null) !== before) {
          await onReload()
          setPhase(null)
          setBriefNote({ kind: 'ok', text: kind === 'draft' ? 'Agent 起草好了，看看要不要改。' : '换了一版，看看这个方向。' })
          return
        }
      }
      setPhase(null)
      setBriefNote({ kind: 'error', text: '等了两分钟没等到新简报，去对话里看看 Agent 的进度。' })
    } catch (error) {
      setPhase(null)
      setBriefNote({ kind: 'error', text: (error as Error).message })
    }
  }

  async function submit(): Promise<void> {
    if (problems.length > 0) return
    setBusy('submitting')
    setSubmitNote(null)
    const brief: Brief = {
      version: '1.0',
      title: draft.title.trim(),
      hook: draft.hook.trim(),
      key_points: keyPoints,
      target_duration_seconds: durationValue,
      style: draft.style,
      target_platform: draft.platform,
      ...(draft.audience.trim() === '' ? {} : { audience: draft.audience.trim() }),
      ...(draft.tone.trim() === '' ? {} : { tone: draft.tone.trim() }),
    }
    try {
      // Marker first: the brief records the same title and duration, and a
      // half-applied pair would leave the two disagreeing.
      await api.updateProject({
        project: state.project.id,
        title: draft.title.trim(),
        target_duration_seconds: durationValue,
        style: draft.style,
        target_platform: draft.platform,
      })
      await api.submitStage({
        project: state.project.id,
        stage: 'brief',
        status: 'completed',
        artifacts: { brief },
        human_approved: true,
        note: '在创意工作台确认',
      })
      await onReload()
      await onSend('我在创意工作台确认了简报「' + brief.title + '」，brief 闸已通过，请继续写脚本。')
      setSubmitNote({ kind: 'ok', text: '简报已通过，已通知 Agent 继续写脚本。' })
    } catch (error) {
      setSubmitNote({ kind: 'error', text: (error as Error).message })
    } finally {
      setBusy('idle')
    }
  }

  return (
    <div className="dcs-screen">
      <header className="dcs-screen-head">
        <h2 className="dcs-screen-title">项目详情</h2>
        <span className="dcs-spacer" />
        <span className={'dcs-pill ' + (approved ? 'dcs-pill-ok' : parked ? 'dcs-pill-wait' : '')}>
          {approved ? '已通过' : parked ? '等你确认' : stage?.status === 'pending' ? '未开始' : (stage?.status ?? '未开始')}
        </span>
      </header>

      <section className="dcs-card">
        <div className="dcs-card-head">
          <IconSliders className="dcs-section-icon" />
          <h3 className="dcs-card-title">项目设置</h3>
          {dirty ? <span className="dcs-card-mark">未保存</span> : null}
        </div>
        <div className="dcs-card-body">
          <div className="dcs-setgrid">
            <label className="dcs-field">
              <span className="dcs-label">标题</span>
              <input className="dcs-input" value={draft.title} onChange={(e) => set('title', e.target.value)} />
            </label>
            <label className="dcs-field">
              <span className="dcs-label">时长（秒）</span>
              <input
                className="dcs-input"
                inputMode="numeric"
                value={draft.duration}
                onChange={(e) => set('duration', e.target.value)}
              />
            </label>
            <label className="dcs-field">
              <span className="dcs-label">投放平台</span>
              <select
                className="dcs-select"
                value={draft.platform}
                onChange={(e) => set('platform', e.target.value)}
              >
                {PLATFORM_FRAMES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} — {option.frame}
                  </option>
                ))}
              </select>
              <span className="dcs-hint">
                {/* Said before rendering, not after: the frame is the one setting
                    whose consequence is invisible until the film comes out wrong. */}
                成片按这个出画幅，
                {platformFrame?.id === 'generic'
                  ? '现在用设置里的默认值。'
                  : <b>{platformFrame?.frame}</b>}
                {platformChanged ? <b className="dcs-note-warn">　（预览中，保存后生效）</b> : null}
              </span>
            </label>
          </div>

          <div className="dcs-style-row">
            <label className="dcs-field">
              <span className="dcs-label">风格</span>
              <select className="dcs-select" value={draft.style} onChange={(e) => set('style', e.target.value)}>
                {state.style.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}（{option.id}）— {option.mood}
                  </option>
                ))}
              </select>
              <span className="dcs-hint">
                {playbook.best_for} · 语速约 {playbook.narration.chars_per_second} 字/秒 ·
                单段 {playbook.pacing.minSectionSeconds}–{playbook.pacing.maxSectionSeconds} 秒
                {styleChanged ? <b className="dcs-note-warn">　（预览中，保存后生效）</b> : null}
              </span>
            </label>

            <div className="dcs-style-card">
            <div className="dcs-style-line">
              <b><IconPalette className="dcs-style-glyph" />画面基调</b>{playbook.mood}
            </div>
            <div className="dcs-style-line">
              <b><IconMic className="dcs-style-glyph" />旁白语气</b>{playbook.narration.voice_style}
            </div>
            <div className="dcs-style-line">
              <b><IconSpark className="dcs-style-glyph" />一致性锚点</b>
              <ul className="dcs-anchors">
                {playbook.visual.consistency_anchors.map((anchor) => <li key={anchor}>{anchor}</li>)}
              </ul>
            </div>
            </div>
          </div>
        </div>
        <div className="dcs-card-foot">
          {saveNote !== null ? (
            <span className={'dcs-note ' + (saveNote.kind === 'ok' ? 'dcs-note-ok' : 'dcs-note-error')}>{saveNote.text}</span>
          ) : null}
          <span className="dcs-spacer" />
          <button type="button" className="dcs-btn" disabled={busy !== 'idle'} onClick={() => void saveSettings()}>
            <IconCheck className="dcs-btn-icon" />
            {busy === 'saving' ? '保存中…' : '保存设置'}
          </button>
        </div>
      </section>

      <section className="dcs-card">
        <div className="dcs-card-head">
          <IconDoc className="dcs-section-icon" />
          <h3 className="dcs-card-title">创意简报</h3>
        </div>
        <div className="dcs-card-body">
          {!hasBrief && phase === null ? (
            <p className="dcs-note">
              还没有简报。可以自己写，也可以让 Agent 先起一版——它知道项目标题、时长和风格。
            </p>
          ) : null}

          <label className="dcs-field">
            <span className="dcs-label">开场钩子</span>
            <input
              className="dcs-input"
              value={draft.hook}
              placeholder="开场三秒抓人的那一句，不是标题的复述"
              onChange={(e) => set('hook', e.target.value)}
            />
          </label>

          <label className="dcs-field">
            <span className="dcs-label">关键要点</span>
            <textarea
              className="dcs-input dcs-textarea"
              rows={5}
              value={draft.keyPoints}
              placeholder={'一行一条，三到五条。\n每条是一个能独立成段的信息点，不是关键词。'}
              onChange={(e) => set('keyPoints', e.target.value)}
            />
          </label>

          <div className="dcs-row">
            <label className="dcs-field">
              <span className="dcs-label">受众（可选）</span>
              <input className="dcs-input" value={draft.audience} onChange={(e) => set('audience', e.target.value)} />
            </label>
            <label className="dcs-field">
              <span className="dcs-label">调性（可选）</span>
              <input className="dcs-input" value={draft.tone} onChange={(e) => set('tone', e.target.value)} />
            </label>
          </div>

          {problems.length > 0 ? (
            <ul className="dcs-problems">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          ) : null}

          {briefNote !== null ? (
            <p className={'dcs-note ' + (briefNote.kind === 'ok' ? 'dcs-note-ok' : 'dcs-note-error')}>{briefNote.text}</p>
          ) : null}
        </div>
        <div className="dcs-card-foot">
          <span className="dcs-hint">
            {keyPoints.length} 条 · {durationValue > 0 ? '按当前风格约 ' + budget + ' 字' : ''}
          </span>
          <span className="dcs-spacer" />
          <button
            type="button"
            className="dcs-btn dcs-btn-small dcs-btn-accent"
            disabled={phase !== null || busy !== 'idle'}
            title="让 Agent 换一个方向重写，你可以多要几版再挑"
            onClick={() => void askForBrief(hasBrief ? 'regenerate' : 'draft')}
          >
            <IconSpark className="dcs-btn-icon" />
            <BusyLabel phase={phase} idle={hasBrief ? '重新生成' : '让 Agent 起草'} />
          </button>
        </div>
      </section>

      <div className="dcs-cta">
        <button
          type="button"
          className="dcs-cta-primary"
          disabled={busy !== 'idle' || problems.length > 0}
          title={problems.length > 0 ? problems[0] : undefined}
          onClick={() => void submit()}
        >
          <IconPlay className="dcs-cta-icon" />
          {busy === 'submitting' ? '提交中…' : approved ? '重新提交简报' : '确认简报，进入脚本'}
        </button>
        <p className="dcs-cta-hint">
          {approved
            ? '这一版已经确认过了。再提交会替换简报，后面所有阶段都要重做。'
            : '这一页所有信息确认后的下一步——之后 Agent 才会开始写脚本。'}
        </p>
        {submitNote !== null ? (
          <p className={'dcs-note ' + (submitNote.kind === 'ok' ? 'dcs-note-ok' : 'dcs-note-error')}>{submitNote.text}</p>
        ) : null}
      </div>
    </div>
  )
}

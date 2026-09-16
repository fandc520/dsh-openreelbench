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
 *   - Marker fields (title, duration, style) go to `POST /openreel/project`.
 *     They are project settings, not pipeline state, and changing a title
 *     should not invalidate a script.
 *   - The brief goes to `POST /openreel/stage`, which runs the full check set
 *     and moves the gate. Approving here is the same act as telling the model
 *     "看过了，可以" — so it also says exactly that in the conversation, and
 *     the model picks the run up from there.
 */
import { useEffect, useMemo, useState } from 'react'

import { FRAME_GROUPS, type Brief, type PluginState, api, frameGroupOf } from './api.ts'
import { type AgentPhase, BusyLabel } from './busy.tsx'
import { IconCheck, IconDoc, IconMic, IconPalette, IconPlay, IconSliders, IconSpark } from './icons.tsx'
import { buildBriefApprovedNote, buildBriefJob } from '../brief-job.js'

import { tx } from './i18n.ts'

export interface ProjectScreenProps {
  state: PluginState
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

function draftFrom(state: PluginState): Draft {
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
  if (draft.title.trim() === '') problems.push(tx('标题不能为空'))
  if (draft.hook.trim() === '') problems.push(tx('缺开场钩子'))
  if (keyPoints.length < 3) problems.push(tx('要点至少三条（现在 ') + keyPoints.length + tx(' 条）'))
  if (keyPoints.length > 5) problems.push(tx('要点最多五条（现在 ') + keyPoints.length + tx(' 条）'))
  const durationValue = Number(draft.duration)
  if (!Number.isFinite(durationValue) || durationValue < 5 || durationValue > 1800) {
    problems.push(tx('时长要在 5–1800 秒之间'))
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
  /**
   * The picker chooses a SHAPE; the project stores a platform.
   *
   * Selecting by group and storing `platforms[0]` means a project that already
   * says `wechat` keeps saying it — the group it belongs to is already
   * selected, so no change event fires and nothing rewrites the brief behind
   * the user's back. Only an actual change of shape writes a new value.
   */
  const platformGroup = frameGroupOf(draft.platform)
  const platformChanged = draft.platform !== (state.project.target_platform ?? 'generic')
  /* The real pixels, straight off the host — baseline times the render scale.
     Worked out here from the group only if an older host sent no frame. */
  const scale = state.frame?.scale ?? 1
  const frameWidth = state.frame?.width ?? platformGroup.baseWidth
  const frameHeight = state.frame?.height ?? platformGroup.baseHeight
  // The served frame follows the SAVED platform, so while a change is still a
  // draft the pixels have to come from the group being previewed instead.
  const previewWidth = platformChanged
    ? Math.max(2, Math.round(platformGroup.baseWidth * scale / 2) * 2)
    : frameWidth
  const previewHeight = platformChanged
    ? Math.max(2, Math.round(platformGroup.baseHeight * scale / 2) * 2)
    : frameHeight

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
      setSaveNote({ kind: 'ok', text: tx('已保存。') })
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
      // Save first. The four settings on this screen are what the brief is
      // written against, and 起草 is a separate button from 保存 -- a user who
      // set 45s and picked 抖音 and then asked for a draft would otherwise get
      // one written against whatever was last saved, with nothing saying so.
      await api.updateProject({
        project: state.project.id,
        title: draft.title.trim(),
        target_duration_seconds: durationValue,
        style: draft.style,
        target_platform: draft.platform,
      })
      await onSend(buildBriefJob({
        projectId: state.project.id,
        title: draft.title.trim(),
        durationSeconds: durationValue,
        style: draft.style,
        platform: draft.platform,
        redraft: kind !== 'draft',
      }))
      setPhase(kind === 'draft' ? 'drafting' : 'regenerating')
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const next = await api.state(state.project.id).catch(() => undefined)
        if (next !== undefined && JSON.stringify(next.artifacts.brief ?? null) !== before) {
          await onReload()
          setPhase(null)
          setBriefNote({ kind: 'ok', text: kind === 'draft' ? tx('Agent 起草好了，看看要不要改。') : tx('换了一版，看看这个方向。') })
          return
        }
      }
      setPhase(null)
      setBriefNote({ kind: 'error', text: tx('等了两分钟没等到新简报，去对话里看看 Agent 的进度。') })
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
        note: tx('在OpenReel 创意台确认'),
      })
      await onReload()
      await onSend(buildBriefApprovedNote(state.project.id, brief.title ?? draft.title.trim()))
      setSubmitNote({ kind: 'ok', text: tx('简报已通过，已通知 Agent 继续写脚本。') })
    } catch (error) {
      setSubmitNote({ kind: 'error', text: (error as Error).message })
    } finally {
      setBusy('idle')
    }
  }

  return (
    <div className="orb-screen">
      <header className="orb-screen-head">
        <h2 className="orb-screen-title">{tx('项目详情')}</h2>
        <span className="orb-spacer" />
        <span className={'orb-pill ' + (approved ? 'orb-pill-ok' : parked ? 'orb-pill-wait' : '')}>
          {approved ? tx('已通过') : parked ? tx('等你确认') : stage?.status === 'pending' ? tx('未开始') : (stage?.status ?? tx('未开始'))}
        </span>
      </header>

      <section className="orb-card">
        <div className="orb-card-head">
          <IconSliders className="orb-section-icon" />
          <h3 className="orb-card-title">{tx('项目设置')}</h3>
          {dirty ? <span className="orb-card-mark">{tx('未保存')}</span> : null}
        </div>
        <div className="orb-card-body">
          <div className="orb-setgrid">
            <label className="orb-field">
              <span className="orb-label">{tx('标题')}</span>
              <input className="orb-input" value={draft.title} onChange={(e) => set('title', e.target.value)} />
            </label>
            <label className="orb-field">
              <span className="orb-label">{tx('时长（秒）')}</span>
              <input
                className="orb-input"
                inputMode="numeric"
                value={draft.duration}
                onChange={(e) => set('duration', e.target.value)}
              />
            </label>
            <label className="orb-field">
              <span className="orb-label">{tx('投放平台')}</span>
              <select
                className="orb-select"
                value={platformGroup.id}
                onChange={(e) => {
                  const picked = FRAME_GROUPS.find((group) => group.id === e.target.value)
                  if (picked !== undefined) set('platform', picked.platforms[0]!)
                }}
              >
                {FRAME_GROUPS.map((group) => (
                  <option key={group.id} value={group.id}>
                    {tx(group.names)} — {tx(group.label)} {group.baseWidth}×{group.baseHeight}
                  </option>
                ))}
              </select>
              <span className="orb-hint">
                {/* Said before rendering, not after: the frame is the one setting
                    whose consequence is invisible until the film comes out wrong.
                    Both numbers, because the scale is in settings and nothing on
                    this page would otherwise explain why 16:9 is not 1920. */}
                {tx('分镜图和成片都按 ')}<b>{previewWidth}×{previewHeight}</b>{tx(' 出')}
                {scale === 1
                  ? ''
                  : tx('（基线 ') + platformGroup.baseWidth + '×' + platformGroup.baseHeight
                    + tx(' × 设置里的生成系数 ') + scale + '）'}
                。
                {platformChanged ? <b className="orb-note-warn">　{tx('（预览中，保存后生效）')}</b> : null}
              </span>
            </label>
          </div>

          <div className="orb-style-row">
            <label className="orb-field">
              <span className="orb-label">{tx('风格')}</span>
              <select className="orb-select" value={draft.style} onChange={(e) => set('style', e.target.value)}>
                {state.style.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {tx(option.name)}（{option.id}）— {tx(option.mood)}
                  </option>
                ))}
              </select>
              <span className="orb-hint">
                {tx(playbook.best_for)}{tx(' · 语速约 ')}{playbook.narration.chars_per_second}{tx(' 字/秒 · 单段 ')}
                {playbook.pacing.minSectionSeconds}–{playbook.pacing.maxSectionSeconds}{tx(' 秒')}
                {styleChanged ? <b className="orb-note-warn">　{tx('（预览中，保存后生效）')}</b> : null}
              </span>
            </label>

            <div className="orb-style-card">
            <div className="orb-style-line">
              <b><IconPalette className="orb-style-glyph" />{tx('画面基调')}</b>{playbook.mood}
            </div>
            <div className="orb-style-line">
              <b><IconMic className="orb-style-glyph" />{tx('旁白语气')}</b>{playbook.narration.voice_style}
            </div>
            <div className="orb-style-line">
              <b><IconSpark className="orb-style-glyph" />{tx('一致性锚点')}</b>
              <ul className="orb-anchors">
                {playbook.visual.consistency_anchors.map((anchor) => <li key={anchor}>{anchor}</li>)}
              </ul>
            </div>
            </div>
          </div>
        </div>
        <div className="orb-card-foot">
          {saveNote !== null ? (
            <span className={'orb-note ' + (saveNote.kind === 'ok' ? 'orb-note-ok' : 'orb-note-error')}>{saveNote.text}</span>
          ) : null}
          <span className="orb-spacer" />
          <button type="button" className="orb-btn" disabled={busy !== 'idle'} onClick={() => void saveSettings()}>
            <IconCheck className="orb-btn-icon" />
            {busy === 'saving' ? tx('保存中…') : tx('保存设置')}
          </button>
        </div>
      </section>

      <section className="orb-card">
        <div className="orb-card-head">
          <IconDoc className="orb-section-icon" />
          <h3 className="orb-card-title">{tx('创意简报')}</h3>
        </div>
        <div className="orb-card-body">
          {!hasBrief && phase === null ? (
            <p className="orb-note">
              {tx('还没有简报。可以自己写，也可以让 Agent 先起一版——它知道项目标题、时长和风格。')}
            </p>
          ) : null}

          <label className="orb-field">
            <span className="orb-label">{tx('开场钩子')}</span>
            <input
              className="orb-input"
              value={draft.hook}
              placeholder={tx('开场三秒抓人的那一句，不是标题的复述')}
              onChange={(e) => set('hook', e.target.value)}
            />
          </label>

          <label className="orb-field">
            <span className="orb-label">{tx('关键要点')}</span>
            <textarea
              className="orb-input orb-textarea"
              rows={5}
              value={draft.keyPoints}
              placeholder={tx('一行一条，三到五条。\n每条是一个能独立成段的信息点，不是关键词。')}
              onChange={(e) => set('keyPoints', e.target.value)}
            />
          </label>

          <div className="orb-row">
            <label className="orb-field">
              <span className="orb-label">{tx('受众（可选）')}</span>
              <input className="orb-input" value={draft.audience} onChange={(e) => set('audience', e.target.value)} />
            </label>
            <label className="orb-field">
              <span className="orb-label">{tx('调性（可选）')}</span>
              <input className="orb-input" value={draft.tone} onChange={(e) => set('tone', e.target.value)} />
            </label>
          </div>

          {problems.length > 0 ? (
            <ul className="orb-problems">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          ) : null}

          {briefNote !== null ? (
            <p className={'orb-note ' + (briefNote.kind === 'ok' ? 'orb-note-ok' : 'orb-note-error')}>{briefNote.text}</p>
          ) : null}
        </div>
        <div className="orb-card-foot">
          <span className="orb-hint">
            {keyPoints.length}{tx(' 条 · ')}{durationValue > 0 ? tx('按当前风格约 ') + budget + tx(' 字') : ''}
          </span>
          <span className="orb-spacer" />
          <button
            type="button"
            className="orb-btn orb-btn-small orb-btn-accent"
            disabled={phase !== null || busy !== 'idle'}
            title={tx('让 Agent 换一个方向重写，你可以多要几版再挑')}
            onClick={() => void askForBrief(hasBrief ? 'regenerate' : 'draft')}
          >
            <IconSpark className="orb-btn-icon" />
            <BusyLabel phase={phase} idle={hasBrief ? tx('重新生成') : tx('让 Agent 起草')} />
          </button>
        </div>
      </section>

      <div className="orb-cta">
        <button
          type="button"
          className="orb-cta-primary"
          disabled={busy !== 'idle' || problems.length > 0}
          title={problems.length > 0 ? problems[0] : undefined}
          onClick={() => void submit()}
        >
          <IconPlay className="orb-cta-icon" />
          {busy === 'submitting' ? tx('提交中…') : approved ? tx('重新提交简报') : tx('确认简报，进入脚本')}
        </button>
        <p className="orb-cta-hint">
          {approved
            ? tx('这一版已经确认过了。再提交会替换简报，后面所有阶段都要重做。')
            : tx('这一页所有信息确认后的下一步——之后 Agent 才会开始写脚本。')}
        </p>
        {submitNote !== null ? (
          <p className={'orb-note ' + (submitNote.kind === 'ok' ? 'orb-note-ok' : 'orb-note-error')}>{submitNote.text}</p>
        ) : null}
      </div>
    </div>
  )
}

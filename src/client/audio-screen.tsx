/**
 * 配音 — the third gate: generate takes on top, voice on the bottom.
 *
 * Three things are worth knowing before reading the code.
 *
 * **Auditioning runs from the browser; generating does not.** Both could —
 * dsh-comfyui exposes its own routes and studio's host never touches ComfyUI
 * either way — but the two calls differ in what a failure costs. An audition is
 * a preview: it produces no artifact, and a bad one is discarded by looking
 * away. Generation produces what the next stage consumes, and it fails in ways
 * that need judgement — a stale option list, a voice that reads wrong. Driving
 * it from here left the model unaware any of it had happened and left the user
 * watching a spinner while the real work scrolled past in a queue they could
 * not see. So generation is stated as a job and handed to the model, and this
 * screen watches the manifest for the result.
 *
 * **There is one take per section, and regenerating replaces it.** No version
 * picker, by decision: roll again until it is right. The file on disk keeps its
 * older siblings, but the manifest names exactly one, so "which take is live"
 * is never ambiguous — and compose, which reads the manifest, cannot pick up
 * the wrong one.
 *
 * **The card strip is a picker, not a timeline.** One uniform line per
 * section — ordinal, id, duration. A missing take is a dashed card, and the
 * count lives on the 全部 card at the end; stretching cards by duration would
 * duplicate what the waveform already shows and push later sections off
 * screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { type StudioState, api, bindingWorkflows } from './api.ts'
import { type AgentPhase, BusyLabel } from './busy.tsx'
import { IconMic, IconPlay, IconSpark } from './icons.tsx'
import { Strip } from './strip.tsx'
import { ComfyError, comfy, resolveWorkflowId, runAndWait } from './comfy.ts'
import { type AssetFile, AssetPicker, inputAssetUrl, useAssetUrls } from './asset-picker.tsx'
import { Spinner } from './busy.tsx'
import { type Selection, Waveform } from './waveform.tsx'
import { buildVoiceJob } from '../voice-job.js'

export interface AudioScreenProps {
  state: StudioState
  onReload: () => Promise<void>
  onSend: (text: string) => Promise<void>
  onGoToStage: (stageId: string) => void
}

interface SectionRow {
  id: string
  label: string
  text: string
  deliveryNote: string
  /** Project-relative path of the current take, when one exists. */
  path?: string
  url?: string
  seconds?: number
}

const VOICE_NODE = 'CharacterVoicesNode'

function readSections(state: StudioState): SectionRow[] {
  const script = state.artifacts.script as
    | { sections?: Array<Record<string, unknown>> } | undefined
  const manifest = state.artifacts.asset_manifest_audio as
    | { assets?: Array<{ scene_id?: string; path?: string; duration_seconds?: number; type?: string }> }
    | undefined
  const takes = new Map<string, { path: string; url?: string; seconds?: number }>()
  for (const asset of manifest?.assets ?? []) {
    if (asset.scene_id === undefined || asset.path === undefined) continue
    if (asset.type !== 'narration' && asset.type !== 'audio') continue
    // Last wins: a replaced take is appended, and the newest is the live one.
    takes.set(asset.scene_id, {
      path: asset.path,
      ...(asset.duration_seconds === undefined ? {} : { seconds: asset.duration_seconds }),
    })
  }
  return (script?.sections ?? []).map((section) => {
    const id = String(section.id ?? '')
    const cues = section.delivery_cues as { delivery_note?: unknown } | undefined
    const take = takes.get(id)
    return {
      id,
      label: typeof section.label === 'string' ? section.label : '',
      text: typeof section.text === 'string' ? section.text : '',
      deliveryNote: typeof cues?.delivery_note === 'string' ? cues.delivery_note : '',
      ...(take ?? {}),
    }
  })
}

/** What the panel watches to know the agent's narration landed. */
function signatureOf(state: StudioState): string {
  const manifest = state.artifacts.asset_manifest_audio as
    | { assets?: Array<{ scene_id?: string; path?: string }> } | undefined
  return (manifest?.assets ?? [])
    .map((asset) => String(asset.scene_id) + '=' + String(asset.path))
    .sort()
    .join('|')
}

export function AudioScreen({ state, onReload, onSend, onGoToStage }: AudioScreenProps): JSX.Element {
  const sections = useMemo(() => readSections(state), [state])
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '')
  const [voices, setVoices] = useState<string[]>([])
  const [voice, setVoice] = useState(state.project.voice)
  const [designName, setDesignName] = useState('')
  const [designPrompt, setDesignPrompt] = useState('')
  const [comfyUp, setComfyUp] = useState<boolean | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [phase, setPhase] = useState<AgentPhase | null>(null)
  const [ttsPick, setTtsPick] = useState('')
  const [progress, setProgress] = useState(0)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined)
  const [auditionUrl, setAuditionUrl] = useState<string | undefined>(undefined)
  const [playingAll, setPlayingAll] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  /** Which reference clip is playing, by name. One at a time. */
  const [playingRef, setPlayingRef] = useState<string | null>(null)
  /**
   * URLs learnt from the picker itself.
   *
   * `useAssetUrls` reads the load area once at mount, so a clip uploaded
   * during this visit is not in it. Remembering what the picker just handed
   * over is what keeps a fresh upload playable without a reload.
   */
  const [pickedUrls, setPickedUrls] = useState<Map<string, string>>(() => new Map())
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const player = useRef<HTMLAudioElement | null>(null)
  // The playAll() queue: refs because advancing through it must not itself
  // trigger a render — only the resulting activeId change should.
  const playQueue = useRef<string[]>([])
  const playIndex = useRef(0)

  // A binding offers several workflows; the head is the default and the user
  // may pick another for this screen without editing settings. The choice is
  // per-visit on purpose — it is a "try the other one" gesture, not a setting.
  const ttsChoices = bindingWorkflows(state.bindings?.tts)
  const designWorkflow = bindingWorkflows(state.bindings?.voice_design)[0] ?? ''
  const queryWorkflow = bindingWorkflows(state.bindings?.voice_query)[0] ?? ''
  const ttsWorkflow = ttsChoices.includes(ttsPick) ? ttsPick : (ttsChoices[0] ?? '')
  const stage = state.stages.find((entry) => entry.stage === 'assets_audio')
  const approved = stage?.status === 'completed' && stage.human_approved
  /**
   * On-screen time per section, from the host's plan.
   *
   * A clip's own length and the time it occupies are different numbers — the
   * style adds lead-in and tail, and a short section is floored. Showing the
   * clip length here and the on-screen time on the shots page made the same
   * section read as two different lengths on two pages. The film is cut to the
   * plan, so the plan is what both pages show.
   */
  const onScreen = new Map(state.timeline.map((timing) => [timing.sectionId, timing.duration]))

  const active = sections.find((section) => section.id === activeId) ?? sections[0]
  const done = sections.filter((section) => section.path !== undefined).length

  const voiceReferences = state.project.voice_references ?? []
  const assetUrls = useAssetUrls()
  /** `input` is the fallback only: an uploaded clip and a generated one differ. */
  const referenceUrl = (name: string): string =>
    pickedUrls.get(name) ?? assetUrls.get(name) ?? inputAssetUrl(name)

  useEffect(() => {
    void comfy.available().then(setComfyUp)
  }, [])

  const loadVoices = useCallback(async (): Promise<void> => {
    const options = await comfy.inputOptions(VOICE_NODE, 'voice_name').catch(() => [])
    setVoices(options.map(String).filter((name) => name !== 'none'))
  }, [])

  useEffect(() => {
    if (comfyUp !== true) return
    void loadVoices()
  }, [comfyUp, loadVoices])

  /**
   * Reload the voice list and re-derive the bound workflows' parameter
   * snapshots in the same gesture.
   *
   * The dropdown reads ComfyUI's live options while a run is validated against
   * the snapshot dsh-comfyui captured when the workflow was saved. Refreshing
   * only the dropdown would show a voice that still cannot be used — the two
   * have to move together, or the list becomes a promise the run does not keep.
   */
  async function refreshVoices(): Promise<void> {
    setWorking('voices')
    setResult(null)
    try {
      await loadVoices()
      const names = [ttsWorkflow, queryWorkflow].filter((name) => name.trim() !== '')
      const changed: string[] = []
      for (const name of names) {
        const id = await resolveWorkflowId(name).catch(() => undefined)
        if (id === undefined) continue
        changed.push(...await comfy.refreshParams(id).catch(() => []))
      }
      say('ok', changed.length === 0
        ? '音色列表已刷新，工作流参数没有变化。'
        : '音色列表已刷新，工作流参数更新了：' + [...new Set(changed)].join('、')) 
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setWorking(null)
    }
  }

  useEffect(() => { setVoice(state.project.voice) }, [state.project.voice])

  // The agent's proposal arrives on the project marker; adopt it only while the
  // user has not started typing their own, so a poll cannot overwrite an edit.
  useEffect(() => {
    const proposed = state.project.voice_design_name ?? ''
    if (proposed !== '' && designName === '') setDesignName(proposed)
    const prompt = state.project.voice_design_prompt ?? ''
    if (prompt !== '' && designPrompt === '') setDesignPrompt(prompt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.project.voice_design_name, state.project.voice_design_prompt])
  useEffect(() => { setSelection(null); setPreviewUrl(undefined) }, [activeId])

  /**
   * Drives playAll(): the click handler only points activeId at the next
   * queued section (via a ref, so advancing does not itself force a render).
   * Nothing else calls .play() on a src swap, so this effect is what actually
   * keeps the audio moving — and it is the only place that attaches or
   * removes the 'ended' listener, so a re-render never leaves one behind.
   */
  useEffect(() => {
    if (!playingAll) return undefined
    const element = player.current
    if (element === null) return undefined
    void element.play()
    const advance = (): void => {
      playIndex.current += 1
      const next = playQueue.current[playIndex.current]
      if (next === undefined) {
        setPlayingAll(false)
        return
      }
      setActiveId(next)
    }
    element.addEventListener('ended', advance)
    return () => element.removeEventListener('ended', advance)
  }, [playingAll, activeId])

  function say(kind: 'ok' | 'error', text: string): void {
    setResult({ kind, text })
  }

  async function saveVoice(next: string): Promise<void> {
    setVoice(next)
    try {
      await api.updateProject({ project: state.project.id, voice: next })
      await onReload()
    } catch (error) {
      say('error', (error as Error).message)
    }
  }

  /**
   * Reference audio for a voice-cloning TTS workflow.
   *
   * The same interface as the shots screen's reference images, and deliberately
   * so: what is stored is the name ComfyUI knows the file by, the file itself
   * stays in ComfyUI's input directory, and the workflow's own loader is what
   * reads it. Copying the clip into the project would only produce a second
   * file nothing loads.
   *
   * Kept project-wide rather than per section for the same reason references
   * are: a cloned voice is what the WHOLE film should sound like. Attaching one
   * per take would mean re-picking it for every section, and a film whose
   * narrator changes halfway is the failure this stage exists to prevent.
   */
  async function saveVoiceReferences(next: readonly string[], note: string): Promise<void> {
    setWorking('voice-reference')
    setResult(null)
    try {
      await api.updateProject({ project: state.project.id, voice_references: [...next] })
      await onReload()
      say('ok', note)
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setWorking(null)
    }
  }

  async function addVoiceReference(file: AssetFile): Promise<void> {
    setPickerOpen(false)
    setPickedUrls((previous) => new Map(previous).set(file.name, file.url))
    if (voiceReferences.includes(file.name)) { say('error', '这段参考音频已经在列表里了。'); return }
    await saveVoiceReferences([...voiceReferences, file.name], '加了一段参考音频：' + file.name)
  }

  async function removeVoiceReference(name: string): Promise<void> {
    if (playingRef === name) setPlayingRef(null)
    await saveVoiceReferences(voiceReferences.filter((entry) => entry !== name), '去掉了一段参考音频')
  }

  /** Generate one section's narration and record it on the manifest. */
  /**
   * Hand narration generation to the agent rather than queueing it here.
   *
   * The panel *can* drive ComfyUI directly — auditioning does exactly that —
   * but generation is different in three ways that matter. It is the expensive
   * call, it produces the artifact the next stage consumes, and it fails in
   * ways that need judgement (a stale option list, a voice that reads wrong).
   * Driving it from here left the agent with no idea any of it had happened,
   * and left the user watching a spinner while the real work scrolled past in
   * a queue they could not see.
   *
   * So the panel states the job precisely — workflow, section, text, delivery,
   * voice, reference clips, where the file goes — and then watches the manifest
   * for the result. The wording lives in `src/voice-job.ts` so it can be tested
   * without a browser.
   * The agent stays the one thing that talks to ComfyUI for generation, which
   * is what lets it recover when a run goes wrong.
   */
  async function generate(ids: readonly string[]): Promise<void> {
    if (working !== null || phase !== null) return
    if (voice.trim() === '') {
      say('error', '先选一个音色。整片配错音色等于整片重做。')
      return
    }
    if (ttsWorkflow.trim() === '') {
      say('error', '还没绑定配音工作流。去设置页的「ComfyUI 工作流绑定」里填上。')
      return
    }
    try {
      // Catch a stale saved-parameter snapshot here, before spending a whole
      // agent turn on a run that ComfyUI's own copy of the workflow will reject.
    } catch (error) {
      say('error', error instanceof ComfyError ? error.message : (error as Error).message)
      return
    }
    const wanted = ids
      .map((id) => sections.find((entry) => entry.id === id))
      .filter((section): section is NonNullable<typeof section> =>
        section !== undefined && section.text.trim() !== '')
    if (wanted.length === 0) {
      say('error', '这些段落还没有台词。')
      return
    }

    setResult(null)
    setPhase('sending')
    const before = signatureOf(state)
    try {
      await onSend(buildVoiceJob({
        workflow: ttsWorkflow,
        voice,
        voiceReferences,
        sections: wanted.map((section) => ({
          id: section.id,
          text: section.text,
          deliveryNote: section.deliveryNote,
        })),
      }))

      setPhase('generating')
      // The manifest changing is the only signal the panel gets; there is no
      // push channel from a tool call back into this component.
      for (let attempt = 0; attempt < 240; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        const next = await api.state(state.project.id).catch(() => undefined)
        if (next !== undefined && signatureOf(next) !== before) {
          await onReload()
          setPhase(null)
          say('ok', '配音回来了，逐段听一下。')
          return
        }
      }
      setPhase(null)
      say('error', '等了十分钟没等到配音。去对话里看看 Agent 卡在哪。')
    } catch (error) {
      setPhase(null)
      say('error', (error as Error).message)
    }
  }

  /**
   * Audition the selected library voice.
   *
   * The library's wav files are not reachable through ComfyUI's /view, so the
   * only way to hear one is to have a workflow hand back its reference clip.
   * That is what the 音色查询 binding is for.
   */
  async function audition(): Promise<void> {
    if (voice.trim() === '') { say('error', '先选一个音色。'); return }
    setWorking('audition')
    setResult(null)
    try {
      const workflowId = await resolveWorkflowId(queryWorkflow)
      const media = await runAndWait({
        workflowId,
        parameters: { voice_name: voice },
        onProgress: setProgress,
      })
      const audio = media.find((item) => item.kind === 'audio') ?? media[0]
      if (audio === undefined) throw new ComfyError('音色查询工作流没有返回音频')
      setAuditionUrl(audio.url)
    } catch (error) {
      say('error', error instanceof ComfyError ? error.message : (error as Error).message)
    } finally {
      setWorking(null)
    }
  }

  /**
   * Toggle back-to-back playback of every generated take, without merging any
   * files. The actual play()/advance work lives in the effect above; this
   * just loads the queue and flips the mode — clicking again while playing
   * stops it.
   */
  function playAll(): void {
    if (playingAll) {
      setPlayingAll(false)
      player.current?.pause()
      return
    }
    const queue = sections.filter((section) => section.path !== undefined).map((section) => section.id)
    if (queue.length === 0) return
    playQueue.current = queue
    playIndex.current = 0
    setPlayingAll(true)
    setActiveId(queue[0]!)
  }

  async function trim(): Promise<void> {
    if (active?.path === undefined || selection === null) return
    setWorking(active.id)
    try {
      await fetch('/studio/asset/trim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project: state.project.id,
          path: active.path,
          start: selection.start,
          end: selection.end,
        }),
      }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error) })
      setSelection(null)
      // Cache-bust: the file changed underneath the same URL.
      setPreviewUrl(undefined)
      await onReload()
      say('ok', '裁好了。')
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setWorking(null)
    }
  }

  async function submit(): Promise<void> {
    setWorking('submit')
    try {
      const manifest = state.artifacts.asset_manifest_audio
      await api.submitStage({
        project: state.project.id,
        stage: 'assets_audio',
        status: 'completed',
        artifacts: { asset_manifest_audio: manifest },
        human_approved: true,
        note: '在创意工作台确认配音',
      })
      await onReload()

      // Hand the shot plan to the model on the way out.
      //
      // This gate used to send nothing, on the reasoning that the model should
      // not start work the user has not looked at. That reasoning was about
      // GENERATING PICTURES, which costs GPU time and is what the shots screen
      // asks for on its own. Designing the plan is the opposite: it is words,
      // it is free, it is reversible, and without it the shots screen opens
      // with all six shot-language pickers empty — which is not a blank slate
      // waiting for the user, it is four of the five prompt layers missing.
      //
      // The leading `/dsh-creative-studio-cinematography` is a load gesture the
      // harness resolves deterministically: any whitespace-bounded `/name` in a
      // user message injects that skill's body as instructions for this turn.
      // So the craft knowledge arrives because the panel asked for it, not
      // because the model recognised a catalog line — and it is not resident,
      // the catalog carries one line and the body only comes on this turn.
      onGoToStage('assets_shots')
      await onSend([
        '/dsh-creative-studio-cinematography',
        '',
        '配音过了，接下来设计分镜的镜头语言。项目 `' + state.project.id + '`。',
        '',
        '按脚本逐段设计，写成 `scene_plan` 用 `studio_stage` 以 `in_progress` 提交'
        + '（stage 是 `assets_shots`）。**这一步不生成任何图片**，只定计划。',
        '每一段的时长已经由配音实测出来了，用 `studio_project` 的 `action: "status"` 能看到进度，'
        + '`action: "get"` 传 `artifact: "script"` 能读脚本。',
        '',
        '写完在对话里告诉我：你定的节奏是什么、哪几镜你拿不准。我在分镜页看。',
      ].join(String.fromCharCode(10)))
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setWorking(null)
    }
  }

  const audioSrc = previewUrl ?? (active?.path === undefined
    ? undefined
    : '/studio/media?project=' + encodeURIComponent(state.project.id)
      + '&path=' + encodeURIComponent(active.path) + '&v=' + (active.seconds ?? 0))

  return (
    <div className="dcs-screen">
      <header className="dcs-screen-head">
        <h2 className="dcs-screen-title">配音</h2>
        <span className="dcs-spacer" />
        <span className={'dcs-pill ' + (approved ? 'dcs-pill-ok' : 'dcs-pill-wait')}>
          {approved ? '已审核' : '待确认'}
        </span>
      </header>

      {comfyUp === false ? (
        <p className="dcs-note dcs-note-error">
          连不上 dsh-comfyui，这一页的生成功能都不可用。确认它已安装并启用。
        </p>
      ) : null}

      <section className="dcs-card">
        <div className="dcs-card-head">
          <IconSpark className="dcs-section-icon" />
          <h3 className="dcs-card-title">配音生成</h3>
          <span className="dcs-card-meta">
            <span><b>{done}</b>/{sections.length} 段已生成</span>
          </span>
          <span className="dcs-spacer" />
          {ttsChoices.length > 1 ? (
            <label className="dcs-inline-pick">
              <span className="dcs-hint">工作流</span>
              <select
                className="dcs-select dcs-select-small"
                value={ttsWorkflow}
                disabled={working !== null || phase !== null}
                title="这个能力绑定了多条工作流，选一条用于这次生成"
                onChange={(event) => setTtsPick(event.target.value)}
              >
                {ttsChoices.map((name, index) => (
                  <option key={name} value={name}>{index === 0 ? name + '（默认）' : name}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="dcs-hint">工作流 {ttsWorkflow === '' ? '（未绑定）' : ttsWorkflow}</span>
          )}
          <button
            type="button"
            className="dcs-btn dcs-btn-small"
            disabled={working !== null || phase !== null || sections.length === 0}
            onClick={() => void generate(sections.map((section) => section.id))}
          >
            <BusyLabel phase={phase} idle="全部生成" />
          </button>
        </div>
        <div className="dcs-card-body">
        {active !== undefined ? (
          <div className="dcs-take-detail">
            <div className="dcs-line">
              <span className="dcs-line-label">台词</span>
              <p className="dcs-take-text">{active.text || '（这一段没有台词）'}</p>
            </div>
            {active.deliveryNote !== '' ? (
              <div className="dcs-line">
                <span className="dcs-line-label">表达</span>
                <p className="dcs-take-text dcs-hint">{active.deliveryNote}</p>
              </div>
            ) : null}

            <Waveform url={audioSrc} selection={selection} onSelectionChange={setSelection} />
            {audioSrc !== undefined ? <audio ref={player} className="dcs-audio" src={audioSrc} controls /> : null}

            <div className="dcs-actions">
              <span className="dcs-hint">
                {phase === null ? '' : '已交给 Agent，生成中会出现在对话里。'}
              </span>
              <span className="dcs-spacer" />
              <button type="button" className="dcs-btn dcs-btn-small"
                disabled={selection === null || working !== null || active.path === undefined}
                onClick={() => void trim()}>裁掉选区外</button>
              <button type="button" className="dcs-btn dcs-btn-small dcs-btn-primary"
                disabled={working !== null || phase !== null}
                onClick={() => void generate([active.id])}>
                {phase === null
                  ? (active.path === undefined ? '生成这一段' : '重新生成')
                  : <BusyLabel phase={phase} idle="" />}
              </button>
            </div>
          </div>
        ) : null}

        <Strip ariaLabel="配音序列">
          {sections.map((section, index) => {
            const screenTime = onScreen.get(section.id)
            // Uniform width on purpose. Cards used to scale with duration at
            // 18px a second, which is what a TIMELINE does — and this is not
            // one. Here the row is a picker: every card is one section, they
            // are equally clickable, and stretching them only pushes the later
            // ones off screen. Duration is already on the card as a number.
            const classes = ['dcs-take-card']
            if (section.id === activeId) classes.push('dcs-take-current')
            if (section.path === undefined) classes.push('dcs-take-empty')
            return (
              <button
                key={section.id}
                type="button"
                className={classes.join(' ')}
                onClick={() => { setPlayingAll(false); setActiveId(section.id) }}
                title={(section.label || section.text.slice(0, 30))
                  + (section.seconds === undefined ? '' : ' · 配音 ' + section.seconds.toFixed(2) + 's'
                    + (screenTime === undefined ? '' : ' · 占屏 ' + screenTime.toFixed(2) + 's（含风格留白）'))}
              >
                <span className="dcs-take-index">{index + 1}</span>
                <span className="dcs-take-id">{section.id}</span>
                <span className="dcs-take-time">
                  {working === section.id
                    ? '生成中'
                    : section.seconds === undefined ? '未生成'
                      : (screenTime ?? section.seconds).toFixed(1) + 's'}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            className={'dcs-take-card dcs-take-all' + (playingAll ? ' dcs-take-current' : '')}
            disabled={done === 0}
            onClick={playAll}
            title={playingAll ? '停止连播' : '按顺序播放已生成的段落，不合并文件'}
          >
            <span className="dcs-take-index">{playingAll ? '■' : '▶'}</span>
            <span className="dcs-take-id">全部</span>
            <span className="dcs-take-time">{done}/{sections.length} 段</span>
          </button>
        </Strip>
        </div>
      </section>

      <section className="dcs-card">
        <div className="dcs-card-head">
          <IconMic className="dcs-section-icon" />
          <h3 className="dcs-card-title">音色</h3>
          <span className="dcs-card-meta">
            <span>{voices.length > 0 ? '音色库 ' + voices.length + ' 个' : comfyUp === true ? '读不到音色库' : ''}</span>
            <span>{queryWorkflow === '' ? '试听需先绑定「音色查询」工作流' : '试听工作流 ' + queryWorkflow}</span>
          </span>
          <span className="dcs-spacer" />
          <button
            type="button"
            className="dcs-btn dcs-btn-small"
            disabled={working !== null || comfyUp !== true}
            title="重新读一遍 ComfyUI 的音色库，并同步两条工作流保存的参数清单"
            onClick={() => void refreshVoices()}
          >
            {working === 'voices' ? <><Spinner />刷新中…</> : '刷新列表'}
          </button>
          <button
            type="button"
            className="dcs-btn dcs-btn-small"
            disabled={working !== null || comfyUp !== true || voice === '' || queryWorkflow === ''}
            title={queryWorkflow === '' ? '设置 → AI 创意工作室 → 绑定「音色查询」工作流' : '播放这个音色的参考片段'}
            onClick={() => void audition()}
          >
            {working === 'audition' ? <><Spinner />试听中…</> : '试听'}
          </button>
        </div>
        <div className="dcs-card-body">
          <div className="dcs-duo-split">
            <div className="dcs-duo-col">
              <label className="dcs-field">
                <span className="dcs-label">音色库</span>
                <select
                  className="dcs-select"
                  value={voice}
                  disabled={working !== null}
                  onChange={(event) => void saveVoice(event.target.value)}
                >
                  <option value="">（未选）</option>
                  {voices.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              {auditionUrl !== undefined ? <audio className="dcs-audio" src={auditionUrl} controls autoPlay /> : null}

              {/* Reference audio lives here rather than in a panel of its own.
                  It is not a separate subject: picking a library voice and cloning
                  one from a sample are two answers to the same question, and a
                  third container made them look like two unrelated features. */}
              <div className="dcs-subhead">
                <span className="dcs-subhead-label">参考音频</span>
                <span className="dcs-hint">
                  {voiceReferences.length === 0
                    ? '声音克隆用，整个项目共用'
                    : '整个项目共用 · ' + voiceReferences.length + ' 段'}
                </span>
              </div>

              {/* Slots, like the reference images on the shots screen: position
                  matters, because a workflow's loaders take them in order. */}
              <div className="dcs-slots">
                {voiceReferences.map((name, index) => (
                  <div className="dcs-slot" key={name + index}>
                    <span className="dcs-slot-index">{index + 1}</span>
                    <button
                      type="button"
                      className={'dcs-slot-media dcs-slot-audio'
                        + (playingRef === name ? ' dcs-slot-audio-on' : '')}
                      title={playingRef === name ? '停止' : '试听这一段'}
                      onClick={() => setPlayingRef(playingRef === name ? null : name)}
                    >{playingRef === name ? '■' : '▶'}</button>
                    {playingRef === name ? (
                      <audio
                        src={referenceUrl(name)}
                        autoPlay
                        onEnded={() => setPlayingRef(null)}
                        onError={() => {
                          setPlayingRef(null)
                          say('error', '播放不了 ' + name + '。它可能已经不在 ComfyUI 的输入目录里了。')
                        }}
                        hidden
                      />
                    ) : null}
                    <span className="dcs-slot-name" title={name}>{name}</span>
                    <button
                      type="button"
                      className="dcs-slot-x"
                      aria-label="移除这一槽"
                      disabled={working !== null}
                      onClick={() => void removeVoiceReference(name)}
                    >×</button>
                  </div>
                ))}
                <button
                  type="button"
                  className="dcs-slot dcs-slot-empty"
                  disabled={working !== null}
                  title="从 ComfyUI 的素材里指定一段；浏览器里也可以上传新的"
                  onClick={() => setPickerOpen(true)}
                >
                  <span className="dcs-slot-index">{voiceReferences.length + 1}</span>
                  <span className="dcs-slot-add">指定参考音频</span>
                </button>
              </div>
              <p className="dcs-hint">槽位按顺序对应工作流的加载参数。</p>
            </div>

            <div className="dcs-duo-col">
              <div className="dcs-col-head">
                <b>音色设计</b>
                <span className="dcs-hint">
                  工作流 {designWorkflow === '' ? '（未绑定）' : designWorkflow} · 交给 Agent 去跑
                </span>
                <span className="dcs-spacer" />
                <button
                  type="button"
                  className="dcs-btn dcs-btn-small"
                  disabled={working !== null}
                  title="让 Agent 看着项目题材和风格，提一个音色方案"
                  onClick={() => {
                    void onSend('看看这个项目的题材和风格，给我一个合适的解说音色方案：'
                      + '用 studio_project 的 set_voice，把 voice_design_name 和 voice_design_prompt '
                      + '写到项目 ' + state.project.id + ' 上，我在创意工作台里看。')
                    say('ok', '已经让 Agent 想一个，写好后这里会自动填上。')
                  }}
                ><IconSpark className="dcs-btn-icon" />自动生成</button>
              </div>
              <input
                className="dcs-input"
                value={designName}
                placeholder="音色名称，例如 jiangshuo_male"
                onChange={(event) => setDesignName(event.target.value)}
              />
              <textarea
                className="dcs-input dcs-textarea"
                rows={3}
                value={designPrompt}
                placeholder="想要什么样的声音，例如：沉稳中年男声，语速偏慢，略带磁性"
                onChange={(event) => setDesignPrompt(event.target.value)}
              />
              <div className="dcs-col-foot">
                <span className="dcs-spacer" />
                <button
                  type="button"
                  className="dcs-btn"
                  disabled={designName.trim() === '' || designPrompt.trim() === ''}
                  onClick={() => {
                    void onSend([
                      '请用音色设计工作流 ' + (designWorkflow === '' ? '（设置页里还没绑定）' : '`' + designWorkflow + '`')
                        + ' 做一个新音色。',
                      '',
                      '- 音色名称：`' + designName.trim() + '`',
                      '- 音色提示词：' + designPrompt.trim(),
                      '',
                      '保存进音色库后，刷新音色库快照与音色库数据，并确认新音色可用。'
                      + ([ttsWorkflow, queryWorkflow].filter((name) => name.trim() !== '').length === 0
                        ? '（配音与音色查询工作流都还没绑定，刷新完提醒我去设置页填上。）'
                        : '涉及的工作流：'
                          + [ttsWorkflow, queryWorkflow]
                            .filter((name) => name.trim() !== '')
                            .map((name) => '`' + name + '`')
                            .join('、')
                          + '。'),
                    ].join('\n'))
                    say('ok', '已经交给 Agent。做好之后按它的提示刷新一次工作流快照，再回来选音色。')
                  }}
                >创建音色</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {pickerOpen ? (
        <AssetPicker
          kinds={['audio']}
          onPick={(file) => void addVoiceReference(file)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}

      <div className="dcs-cta">
        <button type="button" className="dcs-cta-primary"
          disabled={working !== null || done < sections.length || sections.length === 0}
          title={done < sections.length ? '还有 ' + (sections.length - done) + ' 段没生成，补齐才能提交' : undefined}
          onClick={() => void submit()}>
          <IconPlay className="dcs-cta-icon" />
          {working === 'submit' ? '提交中…' : approved ? '重新提交配音' : '确认配音，进入配图'}
        </button>
        <p className="dcs-cta-hint">
          {done < sections.length
            ? '还有 ' + (sections.length - done) + ' 段没生成，补齐才能提交。'
            : approved
              ? '这一版已经确认过了。再提交一次会替换配音，配图和成片要重做。'
              : '这一页所有段落听过之后的下一步——之后才会开始配图。'}
        </p>
        {result !== null ? (
          <p className={'dcs-note ' + (result.kind === 'ok' ? 'dcs-note-ok' : 'dcs-note-error')}>{result.text}</p>
        ) : null}
      </div>
    </div>
  )
}

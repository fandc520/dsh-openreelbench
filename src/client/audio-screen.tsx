/**
 * 配音 — the third gate: generate takes on top, voice on the bottom.
 *
 * Three things are worth knowing before reading the code.
 *
 * **Auditioning runs from the browser; generating does not.** Both could —
 * dsh-comfyui exposes its own routes and openreelbench's host never touches ComfyUI
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

import { type PluginState, api, bindingWorkflows } from './api.ts'
import { type AgentPhase, BusyLabel } from './busy.tsx'
import { IconMic, IconPlay, IconSpark } from './icons.tsx'
import { Strip } from './strip.tsx'
import { ComfyError, comfy, resolveWorkflowId, runAndWait } from './comfy.ts'
import { type AssetFile, AssetPicker, inputAssetUrl, useAssetUrls } from './asset-picker.tsx'
import { Spinner } from './busy.tsx'
import { type Selection, Waveform } from './waveform.tsx'
import { CONTENT_LANGUAGES, resolveContentLanguage } from '../content-language.js'
import { buildVoiceJob } from '../voice-job.js'
import { buildScenePlanJob, buildVoiceDesignJob, buildVoiceProposalJob } from '../voice-extra-jobs.js'

import { tx } from './i18n.ts'

export interface AudioScreenProps {
  state: PluginState
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

function readSections(state: PluginState): SectionRow[] {
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
function signatureOf(state: PluginState): string {
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
  /**
   * A per-file counter appended to the media URL.
   *
   * Trimming rewrites the file under the SAME path, and that URL string is
   * what both `<audio>` and the waveform key their reload on — an identical
   * string means the effect never re-runs and the panel goes on drawing the
   * take from before the cut, which is exactly what "点了没反应" was.
   *
   * The recorded duration cannot stand in for this: undo puts the old length
   * back, so trim → undo → trim would land on a URL the browser has already
   * cached under different bytes.
   */
  const [mediaRev, setMediaRev] = useState<ReadonlyMap<string, number>>(() => new Map())
  /**
   * What the last trim or restore did, shown NEXT TO the buttons.
   *
   * Everything else on this screen reports into the note above the submit
   * button, at the bottom of a long page. That is fine for "配音回来了", which
   * you go looking for; it is useless for a trim, where you are staring at the
   * waveform and the only question is whether anything happened at all.
   */
  const [editNote, setEditNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
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
  /**
   * What language this film is narrated in.
   *
   * Resolved host-side (the project's own choice, else the panel's language)
   * and read back, never worked out here — the script request budgets in this
   * language's unit, and two copies of the decision is how the two disagree.
   */
  const contentLanguage = resolveContentLanguage(state.contentLanguage, undefined)
  /**
   * Sections still waiting for a take. Drives the fill-the-gaps button.
   *
   * A section with no line can never get one, so it is not "remaining" — it
   * would keep the button lit forever and generate() refuses it anyway.
   */
  const missing = sections.filter(
    (section) => section.path === undefined && section.text.trim() !== '')

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
        ? tx('音色列表已刷新，工作流参数没有变化。')
        : tx('音色列表已刷新，工作流参数更新了：') + [...new Set(changed)].join('、')) 
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
  useEffect(() => { setSelection(null); setPreviewUrl(undefined); setEditNote(null) }, [activeId])

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

  /** Force one file's URL to change, so every player of it reloads. */
  function bumpMedia(path: string): void {
    setMediaRev((current) => {
      const next = new Map(current)
      next.set(path, (current.get(path) ?? 0) + 1)
      return next
    })
  }

  /**
   * Set the film's narration language.
   *
   * Saved on the project rather than held for this visit: it governs the
   * SCRIPT as well, and the script screen has to see the same answer. A
   * per-visit choice would let one screen write English lines and the other
   * budget them as Chinese characters.
   */
  async function saveLanguage(next: string): Promise<void> {
    try {
      await api.updateProject({ project: state.project.id, language: next })
      await onReload()
    } catch (error) {
      say('error', (error as Error).message)
    }
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
    if (voiceReferences.includes(file.name)) { say('error', tx('这段参考音频已经在列表里了。')); return }
    await saveVoiceReferences([...voiceReferences, file.name], tx('加了一段参考音频：') + file.name)
  }

  async function removeVoiceReference(name: string): Promise<void> {
    if (playingRef === name) setPlayingRef(null)
    await saveVoiceReferences(voiceReferences.filter((entry) => entry !== name), tx('去掉了一段参考音频'))
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
      say('error', tx('先选一个音色。整片配错音色等于整片重做。'))
      return
    }
    if (ttsWorkflow.trim() === '') {
      say('error', tx('还没绑定配音工作流。去设置页的「ComfyUI 工作流绑定」里填上。'))
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
      say('error', tx('这些段落还没有台词。'))
      return
    }

    setResult(null)
    setPhase('sending')
    const before = signatureOf(state)
    try {
      await onSend(buildVoiceJob({
        projectId: state.project.id,
        workflow: ttsWorkflow,
        voice,
        voiceReferences,
        ...(contentLanguage.id === 'zh' ? {} : { languageName: contentLanguage.name }),
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
          say('ok', tx('配音回来了，逐段听一下。'))
          return
        }
      }
      setPhase(null)
      say('error', tx('等了十分钟没等到配音。去对话里看看 Agent 卡在哪。'))
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
    if (voice.trim() === '') { say('error', tx('先选一个音色。')); return }
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
      if (audio === undefined) throw new ComfyError(tx('音色查询工作流没有返回音频'))
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

  /** POST a trim or a restore and read back the take's new length. */
  async function editAudio(route: string, body: Record<string, unknown>): Promise<number | undefined> {
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json() as { error?: string; seconds?: number }
    if (!response.ok) throw new Error(payload.error ?? tx('请求失败'))
    return typeof payload.seconds === 'number' ? payload.seconds : undefined
  }

  /**
   * Keep the selection, drop the rest. Destructive — the file is rewritten.
   *
   * `working` is set to a literal rather than to the section id on purpose:
   * the strip reads `working === section.id` as "generating", and a trim that
   * lit that label said the wrong thing about what was happening.
   */
  async function trim(): Promise<void> {
    if (active?.path === undefined || selection === null) return
    const path = active.path
    const was = active.seconds
    setWorking('trim')
    setEditNote(null)
    try {
      const seconds = await editAudio('/openreel/asset/trim', {
        project: state.project.id,
        path,
        start: selection.start,
        end: selection.end,
      })
      setSelection(null)
      setPreviewUrl(undefined)
      // Before the reload, not after: the waveform should redraw the moment
      // the host says it is done, not one round trip later.
      bumpMedia(path)
      await onReload()
      setEditNote({
        kind: 'ok',
        text: seconds === undefined
          ? tx('裁好了')
          : tx('裁好了 · ') + (was === undefined ? '' : was.toFixed(2) + 's → ') + seconds.toFixed(2) + 's',
      })
    } catch (error) {
      setEditNote({ kind: 'error', text: (error as Error).message })
    } finally {
      setWorking(null)
    }
  }

  /**
   * Undo every trim on this take at once.
   *
   * Not "one step back": a trim rewrites the file, so there is no stack of
   * cuts to walk. What the host keeps is the take as it was generated, and
   * that is the only point anyone can actually aim at on a waveform.
   */
  async function restore(): Promise<void> {
    if (active?.path === undefined) return
    const path = active.path
    setWorking('restore')
    setEditNote(null)
    try {
      const seconds = await editAudio('/openreel/asset/restore', {
        project: state.project.id,
        path,
      })
      setSelection(null)
      setPreviewUrl(undefined)
      bumpMedia(path)
      await onReload()
      setEditNote({
        kind: 'ok',
        text: tx('已还原成刚生成时的样子')
          + (seconds === undefined ? '' : ' · ' + seconds.toFixed(2) + 's'),
      })
    } catch (error) {
      setEditNote({ kind: 'error', text: (error as Error).message })
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
        note: tx('在OpenReel 创意台确认配音'),
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
      // Two gestures: what a scene_plan is, and how to choose a shot for a
      // line. See `voice-extra-jobs.ts`.
      onGoToStage('assets_shots')
      await onSend(buildScenePlanJob(state.project.id, sections.length))
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setWorking(null)
    }
  }

  const audioSrc = previewUrl ?? (active?.path === undefined
    ? undefined
    : '/openreel/media?project=' + encodeURIComponent(state.project.id)
      + '&path=' + encodeURIComponent(active.path) + '&v=' + (active.seconds ?? 0)
      + '&r=' + (mediaRev.get(active.path) ?? 0))

  /**
   * Which takes still have an untrimmed copy on disk. The host lists them
   * because only the host can see `originals/`; an older host sends nothing,
   * and then undo is simply offered as unavailable rather than as a 404.
   */
  const trimmedPaths = new Set(state.trimmed ?? [])
  const canRestore = active?.path !== undefined && trimmedPaths.has(active.path)

  return (
    <div className="orb-screen">
      <header className="orb-screen-head">
        <h2 className="orb-screen-title">{tx('配音')}</h2>
        <span className="orb-spacer" />
        <span className={'orb-pill ' + (approved ? 'orb-pill-ok' : 'orb-pill-wait')}>
          {approved ? tx('已审核') : tx('待确认')}
        </span>
      </header>

      {comfyUp === false ? (
        <p className="orb-note orb-note-error">
          {tx('连不上 dsh-comfyui，这一页的生成功能都不可用。确认它已安装并启用。')}
        </p>
      ) : null}

      <section className="orb-card">
        <div className="orb-card-head">
          <IconSpark className="orb-section-icon" />
          <h3 className="orb-card-title">{tx('配音生成')}</h3>
          <span className="orb-card-meta">
            <span><b>{done}</b>/{sections.length}{tx(' 段已生成')}</span>
          </span>
          <span className="orb-spacer" />
          {/* A REFERENCE for the request, not a switch on the workflow: which
              slot carries a language — or whether the workflow has one — is the
              workflow's business, so the note says so rather than promising it
              will take effect. It also governs the script, which is why it is
              stored on the project and not held for this visit. */}
          <label className="orb-inline-pick">
            <span className="orb-hint">{tx('语种')}</span>
            <select
              className="orb-select orb-select-small"
              value={contentLanguage.id}
              disabled={working !== null || phase !== null}
              title={tx('台词和配音都用这个语言。作为参考写进给 Agent 的请求——工作流需支持该语种，否则 Agent 会按它能做的处理')}
              onChange={(event) => void saveLanguage(event.target.value)}
            >
              {CONTENT_LANGUAGES.map((entry) => (
                <option key={entry.id} value={entry.id}>{entry.label}</option>
              ))}
            </select>
          </label>
          <span className="orb-spacer" />
          {ttsChoices.length > 1 ? (
            <label className="orb-inline-pick">
              <span className="orb-hint">{tx('工作流')}</span>
              <select
                className="orb-select orb-select-small"
                value={ttsWorkflow}
                disabled={working !== null || phase !== null}
                title={tx('这个能力绑定了多条工作流，选一条用于这次生成')}
                onChange={(event) => setTtsPick(event.target.value)}
              >
                {ttsChoices.map((name, index) => (
                  <option key={name} value={name}>{index === 0 ? name + tx('（默认）') : name}</option>
                ))}
              </select>
            </label>
          ) : (
            <span className="orb-hint">{tx('工作流')} {ttsWorkflow === '' ? tx('（未绑定）') : ttsWorkflow}</span>
          )}
        </div>
        <div className="orb-card-body">
        {active !== undefined ? (
          <div className="orb-take-detail">
            <div className="orb-line">
              <span className="orb-line-label">{tx('台词')}</span>
              <p className="orb-take-text">{active.text || tx('（这一段没有台词）')}</p>
            </div>
            {active.deliveryNote !== '' ? (
              <div className="orb-line">
                <span className="orb-line-label">{tx('表达')}</span>
                <p className="orb-take-text orb-hint">{active.deliveryNote}</p>
              </div>
            ) : null}

            <Waveform url={audioSrc} selection={selection} onSelectionChange={setSelection} />
            {audioSrc !== undefined ? <audio ref={player} className="orb-audio" src={audioSrc} controls /> : null}

            <div className="orb-actions">
              <span className={'orb-hint'
                + (editNote?.kind === 'error' ? ' orb-note-error' : '')
                + (editNote?.kind === 'ok' ? ' orb-note-ok' : '')}>
                {working === 'trim' ? tx('正在裁剪…')
                  : working === 'restore' ? tx('正在还原…')
                    : editNote !== null ? editNote.text
                      : phase === null ? '' : tx('已交给 Agent，生成中会出现在对话里。')}
              </span>
              <span className="orb-spacer" />
              {/* Rendered even with nothing to undo, disabled rather than
                  hidden: trimming is destructive, and a button that appears
                  only after the damage is a promise made too late to read. */}
              <button type="button" className="orb-btn orb-btn-small"
                disabled={!canRestore || working !== null}
                onClick={() => void restore()}
                title={canRestore
                  ? tx('把这一段还原成刚生成时的样子，之前的裁剪全部作废')
                  : tx('这一段还没裁剪过，没有可还原的版本')}>{tx('撤销裁剪')}</button>
              <button type="button" className="orb-btn orb-btn-small"
                disabled={selection === null || working !== null || active.path === undefined}
                onClick={() => void trim()}
                title={selection === null
                  ? tx('先在波形上拖选要保留的部分')
                  : tx('只保留选中的 ') + (selection.end - selection.start).toFixed(2)
                    + tx(' 秒，文件会被直接改写（可撤销）')}>{tx('裁剪')}</button>
              {/* The common case after a partial run: some takes landed, one
                  failed or was added later. Regenerating the lot to fill a
                  hole costs the whole batch of TTS again, so the hole gets its
                  own button. Hidden when there is no hole, and when nothing
                  has been generated at all, since it is 全部生成 then. */}
              {missing.length === 0 || missing.length === sections.length ? null : (
                <button
                  type="button"
                  className="orb-btn orb-btn-small"
                  disabled={working !== null || phase !== null}
                  onClick={() => void generate(missing.map((section) => section.id))}
                  title={tx('只生成还没有配音的那几段，已经有的不动')}
                >
                  <BusyLabel phase={phase} idle={tx('生成剩余（') + missing.length + '）'} />
                </button>
              )}
              <button
                type="button"
                className="orb-btn orb-btn-small orb-btn-accent"
                disabled={working !== null || phase !== null || sections.length === 0}
                onClick={() => void generate(sections.map((section) => section.id))}
                title={tx('整批重新生成，已有配音会被替换')}
              >
                <BusyLabel phase={phase} idle={tx('全部生成')} />
              </button>
              <button type="button" className="orb-btn orb-btn-small orb-btn-accent"
                disabled={working !== null || phase !== null}
                onClick={() => void generate([active.id])}>
                <IconSpark className="orb-btn-icon" />
                {phase === null
                  ? (active.path === undefined ? tx('生成这一段') : tx('重新生成'))
                  : <BusyLabel phase={phase} idle="" />}
              </button>
            </div>
          </div>
        ) : null}

        <Strip ariaLabel={tx('配音序列')}>
          {sections.map((section, index) => {
            const screenTime = onScreen.get(section.id)
            // Uniform width on purpose. Cards used to scale with duration at
            // 18px a second, which is what a TIMELINE does — and this is not
            // one. Here the row is a picker: every card is one section, they
            // are equally clickable, and stretching them only pushes the later
            // ones off screen. Duration is already on the card as a number.
            const classes = ['orb-take-card']
            if (section.id === activeId) classes.push('orb-take-current')
            if (section.path === undefined) classes.push('orb-take-empty')
            return (
              <button
                key={section.id}
                type="button"
                className={classes.join(' ')}
                onClick={() => { setPlayingAll(false); setActiveId(section.id) }}
                title={(section.label || section.text.slice(0, 30))
                  + (section.seconds === undefined ? '' : tx(' · 配音 ') + section.seconds.toFixed(2) + 's'
                    + (screenTime === undefined ? '' : tx(' · 占屏 ') + screenTime.toFixed(2) + tx('s（含风格留白）')))}
              >
                <span className="orb-take-index">{index + 1}</span>
                <span className="orb-take-id">{section.id}</span>
                <span className="orb-take-time">
                  {working === section.id
                    ? tx('生成中')
                    : section.seconds === undefined ? tx('未生成')
                      : (screenTime ?? section.seconds).toFixed(1) + 's'}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            className={'orb-take-card orb-take-all' + (playingAll ? ' orb-take-current' : '')}
            disabled={done === 0}
            onClick={playAll}
            title={playingAll ? tx('停止连播') : tx('按顺序播放已生成的段落，不合并文件')}
          >
            <span className="orb-take-index">{playingAll ? '■' : '▶'}</span>
            <span className="orb-take-id">{tx('全部')}</span>
            <span className="orb-take-time">{done}/{sections.length}{tx(' 段')}</span>
          </button>
        </Strip>
        </div>
      </section>

      <section className="orb-card">
        <div className="orb-card-head">
          <IconMic className="orb-section-icon" />
          <h3 className="orb-card-title">{tx('音色')}</h3>
          <span className="orb-card-meta">
            <span>{voices.length > 0 ? tx('音色库 ') + voices.length + tx(' 个') : comfyUp === true ? tx('读不到音色库') : ''}</span>
            <span>{queryWorkflow === '' ? tx('试听需先绑定「音色查询」工作流') : tx('试听工作流 ') + queryWorkflow}</span>
          </span>
          <span className="orb-spacer" />
          <button
            type="button"
            className="orb-btn orb-btn-small"
            disabled={working !== null || comfyUp !== true}
            title={tx('重新读一遍 ComfyUI 的音色库，并同步两条工作流保存的参数清单')}
            onClick={() => void refreshVoices()}
          >
            {working === 'voices' ? <><Spinner />{tx('刷新中…')}</> : tx('刷新列表')}
          </button>
          <button
            type="button"
            className="orb-btn orb-btn-small"
            disabled={working !== null || comfyUp !== true || voice === '' || queryWorkflow === ''}
            title={queryWorkflow === '' ? tx('设置 → OpenReel 创意台 → 绑定「音色查询」工作流') : tx('播放这个音色的参考片段')}
            onClick={() => void audition()}
          >
            {working === 'audition' ? <><Spinner />{tx('试听中…')}</> : tx('试听')}
          </button>
        </div>
        <div className="orb-card-body">
          <div className="orb-duo-split">
            <div className="orb-duo-col">
              <label className="orb-field">
                <span className="orb-label">{tx('音色库')}</span>
                <select
                  className="orb-select"
                  value={voice}
                  disabled={working !== null}
                  onChange={(event) => void saveVoice(event.target.value)}
                >
                  <option value="">{tx('（未选）')}</option>
                  {voices.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              {auditionUrl !== undefined ? <audio className="orb-audio" src={auditionUrl} controls autoPlay /> : null}

              {/* Reference audio lives here rather than in a panel of its own.
                  It is not a separate subject: picking a library voice and cloning
                  one from a sample are two answers to the same question, and a
                  third container made them look like two unrelated features. */}
              <div className="orb-subhead">
                <span className="orb-subhead-label">{tx('参考音频')}</span>
                <span className="orb-hint">
                  {voiceReferences.length === 0
                    ? tx('声音克隆用，整个项目共用')
                    : tx('整个项目共用 · ') + voiceReferences.length + tx(' 段')}
                </span>
              </div>

              {/* Slots, like the reference images on the shots screen: position
                  matters, because a workflow's loaders take them in order. */}
              <div className="orb-slots">
                {voiceReferences.map((name, index) => (
                  <div className="orb-slot" key={name + index}>
                    <span className="orb-slot-index">{index + 1}</span>
                    <button
                      type="button"
                      className={'orb-slot-media orb-slot-audio'
                        + (playingRef === name ? ' orb-slot-audio-on' : '')}
                      title={playingRef === name ? tx('停止') : tx('试听这一段')}
                      onClick={() => setPlayingRef(playingRef === name ? null : name)}
                    >{playingRef === name ? '■' : '▶'}</button>
                    {playingRef === name ? (
                      <audio
                        src={referenceUrl(name)}
                        autoPlay
                        onEnded={() => setPlayingRef(null)}
                        onError={() => {
                          setPlayingRef(null)
                          say('error', tx('播放不了 ') + name + tx('。它可能已经不在 ComfyUI 的输入目录里了。'))
                        }}
                        hidden
                      />
                    ) : null}
                    <span className="orb-slot-name" title={name}>{name}</span>
                    <button
                      type="button"
                      className="orb-slot-x"
                      aria-label={tx('移除这一槽')}
                      disabled={working !== null}
                      onClick={() => void removeVoiceReference(name)}
                    >×</button>
                  </div>
                ))}
                <button
                  type="button"
                  className="orb-slot orb-slot-empty"
                  disabled={working !== null}
                  title={tx('从 ComfyUI 的素材里指定一段；浏览器里也可以上传新的')}
                  onClick={() => setPickerOpen(true)}
                >
                  <span className="orb-slot-index">{voiceReferences.length + 1}</span>
                  <span className="orb-slot-add">{tx('指定参考音频')}</span>
                </button>
              </div>
              <p className="orb-hint">{tx('槽位按顺序对应工作流的加载参数。')}</p>
            </div>

            <div className="orb-duo-col">
              <div className="orb-col-head">
                <b>{tx('音色设计')}</b>
                <span className="orb-hint">
                  {designWorkflow === '' ? tx('（未绑定）') : designWorkflow}
                </span>
                <span className="orb-spacer" />
                <button
                  type="button"
                  className="orb-btn orb-btn-small"
                  disabled={working !== null}
                  title={tx('让 Agent 看着项目题材和风格，提一个音色方案')}
                  onClick={() => {
                    void onSend(buildVoiceProposalJob(state.project.id))
                    say('ok', tx('已经让 Agent 想一个，写好后这里会自动填上。'))
                  }}
                ><IconSpark className="orb-btn-icon" />{tx('自动生成')}</button>
              </div>
              <input
                className="orb-input"
                value={designName}
                placeholder={tx('音色名称，例如 jiangshuo_male')}
                onChange={(event) => setDesignName(event.target.value)}
              />
              <textarea
                className="orb-input orb-textarea"
                rows={3}
                value={designPrompt}
                placeholder={tx('想要什么样的声音，例如：沉稳中年男声，语速偏慢，略带磁性')}
                onChange={(event) => setDesignPrompt(event.target.value)}
              />
              <div className="orb-col-foot">
                <span className="orb-spacer" />
                <button
                  type="button"
                  className="orb-btn orb-btn-accent"
                  disabled={designName.trim() === '' || designPrompt.trim() === ''}
                  onClick={() => {
                    void onSend(buildVoiceDesignJob({
                      projectId: state.project.id,
                      workflow: designWorkflow,
                      name: designName.trim(),
                      prompt: designPrompt.trim(),
                      refreshWorkflows: [ttsWorkflow, queryWorkflow].filter((n) => n.trim() !== ''),
                    }))
                    say('ok', tx('已经交给 Agent。做好之后按它的提示刷新一次工作流快照，再回来选音色。'))
                  }}
                >{tx('创建音色')}</button>
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

      <div className="orb-cta">
        <button type="button" className="orb-cta-primary"
          disabled={working !== null || done < sections.length || sections.length === 0}
          title={done < sections.length ? tx('还有 ') + (sections.length - done) + tx(' 段没生成，补齐才能提交') : undefined}
          onClick={() => void submit()}>
          <IconPlay className="orb-cta-icon" />
          {working === 'submit' ? tx('提交中…') : approved ? tx('重新提交配音') : tx('确认配音，进入配图')}
        </button>
        <p className="orb-cta-hint">
          {done < sections.length
            ? tx('还有 ') + (sections.length - done) + tx(' 段没生成，补齐才能提交。')
            : approved
              ? tx('这一版已经确认过了。再提交一次会替换配音，配图和成片要重做。')
              : tx('这一页所有段落听过之后的下一步——之后才会开始配图。')}
        </p>
        {result !== null ? (
          <p className={'orb-note ' + (result.kind === 'ok' ? 'orb-note-ok' : 'orb-note-error')}>{result.text}</p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 分镜 — the fourth gate, and the one that decides what the film looks like.
 *
 * Three things are worth knowing before reading the code.
 *
 * **The strip is per SHOT, not per section.** A section is a spoken beat; a
 * shot is a picture carrying part of it. Drawing one card per section would
 * hide the thing this screen exists to decide — whether one picture can hold
 * twenty seconds. Sections appear as headers spanning their shots, so the
 * grouping stays legible without becoming the unit.
 *
 * **Width is on-screen time, and time is fixed.** A section's length comes from
 * its narration and cannot move here. Adding a shot splits time that is already
 * spoken for; a weight decides how the split falls. So a wide card is a shot
 * holding the screen a long while — the visual warning that a still is about to
 * feel dead — and adding a shot is literally cutting that card in two.
 *
 * **Timings come from the host.** `state.timeline` is computed by the same
 * function the renderer plans with, so what this screen shows and what compose
 * cuts cannot disagree. The browser never recomputes pacing.
 */
import { useEffect, useMemo, useState } from 'react'

import { SHOT_LANGUAGE_FIELDS, type StudioState, api, bindingWorkflows } from './api.ts'
import { type AgentPhase, BusyLabel } from './busy.tsx'
import { IconImage, IconPlay, IconSliders } from './icons.tsx'
import { type AssetFile, AssetPicker, inputAssetUrl, useAssetUrls } from './asset-picker.tsx'
import { AdvicePanel } from './advice-panel.tsx'
import { Strip } from './strip.tsx'
import { buildShotJob } from '../shot-job.js'

export interface ShotsScreenProps {
  state: StudioState
  onReload: () => Promise<void>
  onSend: (text: string) => Promise<void>
  onGoToStage: (stageId: string) => void
}

/** Spelled once so no template has to carry the escape. */
const NEWLINE = String.fromCharCode(10)

/** The first argument that actually says something. Blank is not a value. */
function firstFilled(...candidates: Array<unknown>): string {
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return ''
}

interface Shot {
  key: string
  sectionId: string
  sectionLabel: string
  /** Position within its section. */
  index: number
  start: number
  duration: number
  weight: number
  /** The spoken line this picture carries — context, never editable here. */
  text: string
  prompt: string
  /** Undefined until the picture exists. */
  assetId?: string
  path?: string
}

interface RawAsset {
  id?: string
  type?: string
  path?: string
  scene_id?: string
  prompt?: string
  shot_index?: number
  weight?: number
}

/**
 * Join the planned timeline with the recorded pictures.
 *
 * The plan is authoritative about *when*; the manifest is authoritative about
 * *what*. A planned slot with no asset is a hole to fill, which is exactly what
 * the strip should show.
 */
function buildShots(state: StudioState): Shot[] {
  const script = state.artifacts.script as
    | { sections?: Array<{ id?: string; text?: string; label?: string; visual?: { prompt?: string } }> }
    | undefined
  const manifest = state.artifacts.asset_manifest_shots as { assets?: RawAsset[] } | undefined
  const byId = new Map((manifest?.assets ?? []).map((asset) => [String(asset.id), asset]))
  const sections = new Map((script?.sections ?? []).map((section) => [String(section.id), section]))

  const shots: Shot[] = []
  for (const timing of state.timeline) {
    const section = sections.get(timing.sectionId)
    // The plan says how many shots this section has and what each should show;
    // the manifest says which of them exist. Where they disagree the plan wins
    // on count — you can intend a shot before making it, never the reverse.
    const planned = state.project.shot_plan?.[timing.sectionId]
    const real = timing.shots.filter((slot) => slot.assetId !== undefined)
    const slots = planned === undefined || planned.length === 0
      ? timing.shots
      : planned.map((entry, position) => ({
        index: position,
        assetId: real[position]?.assetId,
        start: 0,
        duration: 0,
        weight: entry.weight ?? 1,
      }))
    // The host owns how long a section is; dividing it among slots while the
    // user is still deciding is plain arithmetic, and once everything is
    // generated the host's own split takes over and agrees with this one.
    const totalWeight = slots.reduce((sum, slot) => sum + (slot.weight > 0 ? slot.weight : 1), 0) || 1
    let cursor = timing.start
    const laid = slots.map((slot, position) => {
      const span = (timing.duration * (slot.weight > 0 ? slot.weight : 1)) / totalWeight
      const start = cursor
      cursor += span
      return { ...slot, index: position, start, duration: span }
    })

    for (const slot of laid) {
      const asset = slot.assetId === undefined ? undefined : byId.get(slot.assetId)
      shots.push({
        key: timing.sectionId + '#' + slot.index,
        sectionId: timing.sectionId,
        sectionLabel: timing.label,
        index: slot.index,
        start: slot.start,
        duration: slot.duration,
        weight: slot.weight,
        text: typeof section?.text === 'string' ? section.text : '',
        // A shot with no picture yet inherits the script's prompt as its seed;
        // the script wrote one visual idea per section, and the first shot is
        // the one that idea belongs to.
        // Plan first: it is what the user typed. The asset's own prompt is
        // what was actually generated, and the script's is only the seed for
        // the first shot of a section nobody has touched yet.
        // `??` alone would let an empty string win: an asset recorded with
        // `prompt: ''` would shadow the script's visual and leave the shot with
        // nothing to draw from, silently.
        prompt: firstFilled(
          planned?.[slot.index]?.prompt,
          asset?.prompt,
          slot.index === 0 ? section?.visual?.prompt : undefined,
        ),
        ...(asset?.id === undefined ? {} : { assetId: asset.id }),
        ...(asset?.path === undefined ? {} : { path: asset.path }),
      })
    }
  }
  return shots
}

/** The manifest as it should be after an edit to one section's shot list. */
function rewriteSection(
  state: StudioState,
  sectionId: string,
  shots: ReadonlyArray<Pick<Shot, 'prompt' | 'weight' | 'assetId' | 'path'>>,
): Record<string, unknown> {
  const manifest = state.artifacts.asset_manifest_shots as { assets?: RawAsset[] } | undefined
  const others = (manifest?.assets ?? []).filter((asset) => asset.scene_id !== sectionId)
  const mine = shots
    .map((shot, index) => {
      if (shot.assetId === undefined || shot.path === undefined) return undefined
      return {
        id: shot.assetId,
        type: 'image',
        path: shot.path,
        source_tool: 'comfyui_workflow',
        scene_id: sectionId,
        shot_index: index,
        weight: shot.weight,
        ...(shot.prompt.trim() === '' ? {} : { prompt: shot.prompt.trim() }),
      }
    })
    .filter((asset): asset is NonNullable<typeof asset> => asset !== undefined)
  return { version: '1.0', assets: [...others, ...mine] }
}

export function ShotsScreen({ state, onReload, onSend, onGoToStage }: ShotsScreenProps): JSX.Element {
  const shots = useMemo(() => buildShots(state), [state])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  /**
   * Open unless everything passed.
   *
   * A clean run should cost one line and no attention; a problem should not
   * need a click before it can be read. `undefined` means "not decided yet" so
   * the first render can follow the report, and a later toggle sticks.
   */
  const [phase, setPhase] = useState<AgentPhase | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [draftPrompt, setDraftPrompt] = useState<string | null>(null)
  const [imagePick, setImagePick] = useState('')
  const [loraHint, setLoraHint] = useState(state.project.lora_name ?? '')
  const [loraOn, setLoraOn] = useState((state.project.lora_strength ?? 0) === 1)
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  /** name -> thumbnail URL, learned from the picker and from ComfyUI's list. */
  /** URLs the picker handed over this visit; the hook covers everything else. */
  const [pickedUrls, setPickedUrls] = useState<Map<string, string>>(new Map())

  const imageChoices = bindingWorkflows(state.bindings?.image)
  const imageWorkflow = imageChoices.includes(imagePick) ? imagePick : (imageChoices[0] ?? '')
  const stage = state.stages.find((entry) => entry.stage === 'assets_shots')
  const approved = stage?.status === 'completed' && stage.human_approved
  const playbook = state.style.playbook
  const total = state.timeline.reduce((sum, timing) => sum + timing.duration, 0)
  const done = shots.filter((shot) => shot.path !== undefined).length

  const active = shots.find((shot) => shot.key === activeKey) ?? shots[0]
  useEffect(() => { setDraftPrompt(null) }, [activeKey])

  // Learn every asset's real URL once, so a reference saved in an earlier
  // session still shows a thumbnail rather than a guessed path.
  const assetUrls = useAssetUrls()
  useEffect(() => {
    setLoraHint(state.project.lora_name ?? '')
    setLoraOn((state.project.lora_strength ?? 0) === 1)
  }, [state.project.lora_name, state.project.lora_strength])

  /** Persist the LoRA hint so a reload — and the next batch — keeps it. */
  async function saveLora(next?: { on?: boolean; hint?: string }): Promise<void> {
    const on = next?.on ?? loraOn
    const hint = (next?.hint ?? loraHint).trim()
    setBusy('lora')
    try {
      // `lora_strength` doubles as the on/off flag (1 on, 0 off) so an
      // unticked hint stays on the project rather than being erased — turning
      // it back on should not mean typing it again.
      await api.updateProject({
        project: state.project.id,
        lora_name: hint,
        lora_strength: on ? 1 : 0,
      })
      await onReload()
      say('ok', !on || hint === '' ? '附加参数不会出现在生成请求里。' : '附加参数已记下，下次生成会带上。')
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function say(kind: 'ok' | 'error', text: string): void {
    setResult({ kind, text })
  }

  const prompt = draftPrompt ?? active?.prompt ?? ''
  const references = state.project.references ?? []

  /**
   * A reference lives in ComfyUI's input directory, so its thumbnail comes
   * through dsh-comfyui's media proxy — `file`/`subfolder`/`type`, the same
   * three the proxy builds its own URLs from.
   */
  function referenceUrl(name: string): string {
    // The list knows whether a file is an upload or a generation, and they sit
    // in different ComfyUI directories — so a guessed `type` is wrong half the
    // time. Fall back to `input` only when the list has not answered yet.
    return pickedUrls.get(name) ?? assetUrls.get(name) ?? inputAssetUrl(name)
  }

  const isLastShot = active !== undefined
    && active.index === sectionShots(active.sectionId).length - 1

  /** Shots with no picture yet. Drives the fill-the-gaps button. */
  const missing = shots.filter((shot) => shot.path === undefined)
  const variation = state.variation
  /**
   * The two slideshow dimensions that depend on the timeline rather than the
   * pictures, so they can be answered before anything is generated.
   *
   * The other three overlap what the variation report already says here; the
   * full score belongs on the compose screen, where it can also refuse.
   */
  const pacing = Object.entries(state.slideshow?.dimensions ?? {})
    .filter(([name, entry]) => (name === 'static_hold' || name === 'picture_rate') && entry.score >= 2)

  // What the all-clear line reports. Counted off the plan rather than the
  // report, so the numbers name the two things the check is actually about.
  const planShots = (state.artifacts.scene_plan as {
    shots?: Array<{ shot_language?: { shot_size?: string; lighting_key?: string } }>
  } | undefined)?.shots ?? []
  const shotSizeCount = new Set(
    planShots.map((entry) => entry.shot_language?.shot_size).filter((size) => size !== undefined),
  ).size
  const lightingCount = new Set(
    planShots.map((entry) => entry.shot_language?.lighting_key).filter((key) => key !== undefined),
  ).size
  // Short form for the row; the long `reason` justifies the score and names the
  // standard, which is a report's job rather than a sidebar's.
  const paceHint = pacing.length === 0
    ? state.slideshow?.dimensions.picture_rate?.short
    : pacing.map(([, entry]) => entry.short ?? entry.reason).join('；')
  const styleDefaults = (playbook.visual.shot_defaults ?? {}) as Record<string, unknown>

  /**
   * Open the shot a violation names.
   *
   * Shot ids are the plan's, so the mapping back to a screen position goes
   * through the scene_plan rather than being guessed from the id's shape - an
   * id is only conventionally `<section>-<index>` and an imported plan need
   * not follow that.
   */
  function jumpToShot(shotId: string): void {
    const plan = state.artifacts.scene_plan as {
      shots?: Array<{ id: string; section_id: string; shot_index: number }>
    } | undefined
    const entry = plan?.shots?.find((shot) => shot.id === shotId)
    if (entry === undefined) return
    setActiveKey(entry.section_id + '#' + entry.shot_index)
  }
  /** The active shot's built prompt, when there is an active shot to build. */
  const builtPrompt = active === undefined ? undefined : promptFor(active)
  const isHero = active !== undefined && shotEntry(active)?.hero_moment === true

  /** The built prompt for a shot, by position within its section. */
  function promptFor(shot: Shot): StudioState['prompts'][number] | undefined {
    return state.prompts.find(
      (entry) => entry.sectionId === shot.sectionId && entry.shotIndex === shot.index,
    )
  }

  /**
   * Everything the model needs to make one picture look like the others.
   *
   * The wording lives in `src/shot-job.ts` so it can be tested without a
   * browser: a missing prompt in this string looks exactly like a working
   * one until someone reads the message by eye, and once did.
   */
  function jobFor(list: readonly Shot[]): string {
    // Free text, passed through verbatim: which LoRA and how strong is the
    // workflow's business, and a structured field here would only be this
    // panel guessing at parameter names it cannot know.
    const hint = (state.project.lora_name ?? '').trim()
    return buildShotJob({
      projectId: state.project.id,
      workflow: imageWorkflow,
      negativePrompt: playbook.visual.negative_prompt,
      references,
      ...((state.project.lora_strength ?? 0) === 1 && hint !== '' ? { extraParams: hint } : {}),
      shots: list.map((shot) => {
        const built = promptFor(shot)
        return {
          sectionId: shot.sectionId,
          index: shot.index,
          seconds: shot.duration,
          text: shot.text,
          ...(built === undefined
            ? {}
            : { built: { prompt: built.prompt, missingSubject: built.missingSubject } }),
          fallbackPrompt: shot.prompt,
        }
      }),
    })
  }

  /** Watch the manifest until the agent's pictures land. */
  async function generate(list: readonly Shot[]): Promise<void> {
    if (phase !== null || busy !== null) return
    if (imageWorkflow === '') { say('error', '还没绑定配图工作流。去设置页的「ComfyUI 工作流绑定」里填上。'); return }
    if (list.length === 0) return
    setResult(null)
    setPhase('sending')
    const before = JSON.stringify(state.artifacts.asset_manifest_shots ?? null)
    try {
      await onSend(jobFor(list))
      setPhase('generating')
      for (let attempt = 0; attempt < 240; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        const next = await api.state(state.project.id).catch(() => undefined)
        if (next !== undefined && JSON.stringify(next.artifacts.asset_manifest_shots ?? null) !== before) {
          await onReload()
          // The slots just became real; keeping the local placeholders would
          // count them twice.
          setPhase(null)
          say('ok', '分镜回来了，逐张看一下。')
          return
        }
      }
      setPhase(null)
      say('error', '等了十分钟没等到分镜。去对话里看看 Agent 卡在哪。')
    } catch (error) {
      setPhase(null)
      say('error', (error as Error).message)
    }
  }

  /** Persist a section's shot list — add, remove, reweight, or reprompt. */
  async function writeSection(
    sectionId: string,
    next: ReadonlyArray<Pick<Shot, 'prompt' | 'weight' | 'assetId' | 'path'>>,
    note: string,
  ): Promise<void> {
    setBusy(sectionId)
    setResult(null)
    try {
      await api.submitStage({
        project: state.project.id,
        stage: 'assets_shots',
        status: 'in_progress',
        artifacts: { asset_manifest_shots: rewriteSection(state, sectionId, next) },
        note,
      })
      await onReload()
      say('ok', note)
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /**
   * Persist a section's shot plan.
   *
   * Every edit that is about *intent* — adding a shot, its prompt, its share —
   * goes through here, because the manifest cannot hold any of it until a
   * picture exists. Sending the whole section keeps the plan and what is on
   * screen the same list.
   */
  async function savePlan(
    sectionId: string,
    entries: ReadonlyArray<{
      prompt?: string
      weight?: number
      shot_language?: Record<string, unknown>
      hero_moment?: boolean
    }>,
    note: string,
  ): Promise<void> {
    setBusy(sectionId)
    setResult(null)
    try {
      await api.saveScenePlan(state.project.id, sectionId, entries.map((entry) => ({
        ...(entry.prompt === undefined ? {} : { prompt: entry.prompt.trim() }),
        ...(entry.weight === undefined ? {} : { weight: entry.weight }),
        // Only sent when this call is actually changing it. Absent means
        // "leave what is stored", which is how the other shots keep theirs.
        ...(entry.shot_language === undefined ? {} : { shot_language: entry.shot_language }),
        ...(entry.hero_moment === undefined ? {} : { hero_moment: entry.hero_moment }),
      })))
      await onReload()
      say('ok', note)
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /** The current plan for a section, filled in from what is on screen. */
  function planFor(sectionId: string): Array<{ prompt?: string; weight?: number }> {
    return sectionShots(sectionId).map((shot) => ({ prompt: shot.prompt, weight: shot.weight }))
  }

  function sectionShots(sectionId: string): Shot[] {
    return shots.filter((shot) => shot.sectionId === sectionId)
  }

  /**
   * Add a shot to the active section. It goes into the plan immediately, so
   * the prompt typed into it survives a reload — the picture comes later.
   */
  async function addShot(): Promise<void> {
    if (active === undefined) return
    const sectionId = active.sectionId
    const at = sectionShots(sectionId).length
    await savePlan(sectionId, [...planFor(sectionId), { weight: 1 }],
      '加了第 ' + (at + 1) + ' 镜到「' + active.sectionLabel + '」，这一段的时间已经重新分配。')
    setActiveKey(sectionId + '#' + at)
  }

  async function removeShot(): Promise<void> {
    if (active === undefined) return
    const list = sectionShots(active.sectionId)
    if (list.length <= 1) { say('error', '每段至少要留一个分镜。'); return }
    const sectionId = active.sectionId
    const at = active.index
    const kept = list.filter((shot) => shot.key !== active.key)
    // Drop it from the plan first, then from the manifest if it had a picture —
    // the plan decides how many shots there are, so leaving it there would
    // bring the slot straight back on the next reload.
    await savePlan(sectionId, kept.map((shot) => ({ prompt: shot.prompt, weight: shot.weight })),
      '删掉了「' + active.sectionLabel + '」的第 ' + (at + 1) + ' 镜')
    if (active.path !== undefined) await writeSection(sectionId, kept, '同步资产清单')
    setActiveKey(sectionId + '#' + Math.max(0, at - 1))
  }

  async function move(delta: number): Promise<void> {
    if (active === undefined) return
    const list = sectionShots(active.sectionId)
    const from = list.findIndex((shot) => shot.key === active.key)
    const to = from + delta
    if (to < 0 || to >= list.length) return
    const next = [...list]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    await writeSection(active.sectionId, next, '调整了「' + active.sectionLabel + '」的分镜顺序')
    setActiveKey(active.sectionId + '#' + to)
  }

  /** A shot's share of its section, normalised so the section always sums to 1. */
  function shareOf(shot: Shot): number {
    const list = sectionShots(shot.sectionId)
    const sum = list.reduce((total, entry) => total + (entry.weight > 0 ? entry.weight : 1), 0) || 1
    return (shot.weight > 0 ? shot.weight : 1) / sum
  }

  /**
   * Set one shot's share; the last shot absorbs whatever is left.
   *
   * Shares have to sum to one — a section's length is fixed, so giving one shot
   * more can only come from another. Making the last one the remainder means
   * the numbers are always consistent without asking the user to do the
   * subtraction, and it is why the last shot's field is read-only rather than
   * an input that could contradict the others.
   */
  async function setShare(value: number): Promise<void> {
    if (active === undefined) return
    const list = sectionShots(active.sectionId)
    const lastIndex = list.length - 1
    if (lastIndex <= 0) { say('error', '这一段只有一个分镜，占比固定是 1。'); return }
    if (active.index === lastIndex) { say('error', '最后一镜的占比由前面几镜决定，改前面的。'); return }
    if (!(value > 0 && value < 1)) { say('error', '占比要在 0 和 1 之间。'); return }

    const fixed = list.map((shot, index) => index === active.index ? value : shareOf(shot))
    const othersSum = fixed.reduce((sum, share, index) => index === lastIndex ? sum : sum + share, 0)
    const remainder = 1 - othersSum
    if (remainder < 0.02) {
      say('error', '前面几镜加起来已经占满了，最后一镜没有时间可分。')
      return
    }
    const entries = list.map((shot, index) => ({
      prompt: shot.prompt,
      weight: index === lastIndex ? remainder : fixed[index]!,
    }))
    await savePlan(active.sectionId, entries, '改了段落占比，最后一镜自动补齐')
    // Generated shots also carry their weight in the manifest, which is what
    // compose reads; keep the two in step.
    if (list.some((shot) => shot.path !== undefined)) {
      await writeSection(active.sectionId,
        list.map((shot, index) => ({ ...shot, weight: entries[index]!.weight! })), '同步资产清单')
    }
  }

  /**
   * Attach a picked server asset to the active shot.
   *
   * What is stored is the name ComfyUI knows the file by, not a copy: the
   * workflow's loader reads it out of ComfyUI's own directory, so copying it
   * into the project would only produce a second file nothing loads.
   */
  async function addReference(file: AssetFile): Promise<void> {
    setPickerOpen(false)
    setPickedUrls((previous) => new Map(previous).set(file.name, file.url))
    if (references.includes(file.name)) { say('error', '这张参考图已经在列表里了。'); return }
    await saveReferences([...references, file.name], '加了一张参考图：' + file.name)
  }

  /** References belong to the project, so writing one is a marker update. */
  async function saveReferences(next: readonly string[], note: string): Promise<void> {
    setBusy('reference')
    setResult(null)
    try {
      await api.updateProject({ project: state.project.id, references: [...next] })
      await onReload()
      say('ok', note)
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function removeReference(name: string): Promise<void> {
    await saveReferences(references.filter((entry) => entry !== name), '去掉了一张参考图')
  }

  /**
   * The shot language stored for one shot.
   *
   * Read off the artifact rather than the `shot_plan` view: the view is a
   * lossy projection that deliberately does not carry it.
   */
  function shotEntry(shot: Shot): {
    shot_language?: Record<string, unknown>
    hero_moment?: boolean
  } | undefined {
    const plan = state.artifacts.scene_plan as {
      shots?: Array<{
        section_id: string
        shot_index: number
        shot_language?: Record<string, unknown>
        hero_moment?: boolean
      }>
    } | undefined
    return plan?.shots?.find(
      (entry) => entry.section_id === shot.sectionId && entry.shot_index === shot.index,
    )
  }

  function languageOf(shot: Shot): Record<string, unknown> {
    return shotEntry(shot)?.shot_language ?? {}
  }

  /** Set one shot-language field, leaving the rest of the section alone. */
  async function setLanguage(field: string, raw: string): Promise<void> {
    if (active === undefined) return
    const next = { ...languageOf(active) }
    // An empty pick means "no opinion" — the style default takes over again,
    // which is different from picking the same value the style happens to use.
    if (raw === '') delete next[field]
    else next[field] = field === 'lens_mm' ? Number(raw) : raw
    const entries = planFor(active.sectionId).map((entry, index) =>
      index === active.index ? { ...entry, shot_language: next } : entry)
    await savePlan(active.sectionId, entries, '镜头语言已保存')
  }

  /** Mark or unmark this shot as the film's visual peak. */
  async function toggleHero(): Promise<void> {
    if (active === undefined) return
    const entries = planFor(active.sectionId).map((entry, index) =>
      index === active.index ? { ...entry, hero_moment: !isHero } : entry)
    await savePlan(active.sectionId, entries, isHero ? '取消了高光' : '标记为高光镜')
  }

  async function savePrompt(): Promise<void> {
    if (active === undefined || draftPrompt === null) return
    const entries = planFor(active.sectionId).map((entry, index) =>
      index === active.index ? { ...entry, prompt: draftPrompt } : entry)
    await savePlan(active.sectionId, entries, '画面提示词已保存')
    setDraftPrompt(null)
  }

  async function submit(): Promise<void> {
    if (done < shots.length) { say('error', '还有 ' + (shots.length - done) + ' 个分镜没生成。'); return }
    setBusy('submit')
    setResult(null)
    try {
      const manifest = state.artifacts.asset_manifest_shots as Record<string, unknown> | undefined
      await api.submitStage({
        project: state.project.id,
        stage: 'assets_shots',
        status: 'completed',
        artifacts: { asset_manifest_shots: manifest ?? { version: '1.0', assets: [] } },
        human_approved: true,
        note: '在创意工作台确认',
      })
      await onReload()
      onGoToStage('compose')
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const imageSrc = active?.path === undefined
    ? undefined
    : '/studio/media?project=' + encodeURIComponent(state.project.id)
      + '&path=' + encodeURIComponent(active.path)

  /** Cards are laid out proportionally, with a floor so a short shot stays clickable. */
  const widthOf = (seconds: number): string =>
    'max(84px, ' + ((seconds / Math.max(total, 0.001)) * 100).toFixed(2) + '%)'

  return (
    <div className="dcs-screen">
      <header className="dcs-screen-head">
        <h2 className="dcs-screen-title">分镜</h2>
        <span className="dcs-spacer" />
        <span className={'dcs-pill ' + (approved ? 'dcs-pill-ok' : '')}>
          {approved ? '已审核' : stage?.status === 'in_progress' ? '进行中' : '待确认'}
        </span>
      </header>

      {result !== null ? (
        <p className={'dcs-note ' + (result.kind === 'ok' ? 'dcs-note-ok' : 'dcs-note-error')}>{result.text}</p>
      ) : null}

      <section className="dcs-card">
        <div className="dcs-card-head">
          <IconImage className="dcs-section-icon" />
          <h3 className="dcs-card-title">分镜生成</h3>
          <span className="dcs-card-meta">
            <span><b>{done}</b>/{shots.length} 镜已生成 · 全片 {total.toFixed(1)} 秒</span>
          </span>
          <span className="dcs-spacer" />
          {/* Always a dropdown, even with one candidate: a read-only name looks
              like a label, and a select says "this is a choice you own" — plus
              an unbound capability shows where to fix it instead of a blank. */}
          <label className="dcs-inline-pick">
            <span className="dcs-hint">工作流</span>
            <select
              className="dcs-select dcs-select-small"
              value={imageWorkflow}
              disabled={phase !== null || busy !== null}
              title={imageChoices.length === 0
                ? '设置 → AI 创意工作室 → ComfyUI 工作流绑定 → 配图（文生图）'
                : undefined}
              onChange={(event) => setImagePick(event.target.value)}
            >
              {imageChoices.length === 0 ? (
                <option value="">（未绑定 · 去设置页添加）</option>
              ) : imageChoices.map((name, index) => (
                <option key={name} value={name}>{index === 0 ? name + '（默认）' : name}</option>
              ))}
            </select>
          </label>
          <span className="dcs-spacer" />
          {/* The common case after a partial run: some pictures landed, one
              failed or was added later. Regenerating the lot to fill a hole
              costs the whole batch again, so the hole gets its own button —
              hidden when there is no hole, since then it does nothing. */}
          {missing.length === 0 || missing.length === shots.length ? null : (
            <button
              type="button"
              className="dcs-btn dcs-btn-small"
              disabled={phase !== null || busy !== null}
              onClick={() => void generate(missing)}
              title="只生成还没有图的那几镜，已经有的不动"
            >
              <BusyLabel phase={phase} idle={'生成缺失（' + missing.length + '）'} />
            </button>
          )}
        </div>
        <div className="dcs-card-body">
          {/* One shell for both quality checks, shared with the compose screen.
              Always rendered: an empty screen cannot tell you that anything was
              checked, so a pass costs one collapsed line and a finding opens. */}
        {variation === null ? null : (
          <AdvicePanel
            title="创作建议"
            onJump={jumpToShot}
            rows={[
              {
                label: '镜头变化',
                clean: variation.violations.length === 0,
                summary: variation.violations.length === 0
                  ? '通过'
                  : variation.score.toFixed(1) + ' / 5 · ' + variation.violations.length + ' 条',
                hint: shotSizeCount + ' 种镜别 · ' + lightingCount + ' 种光线',
                ...(variation.verdict === 'revise' || variation.verdict === 'fail'
                  ? { severity: variation.verdict } : {}),
                details: [
                  ...variation.violations.map((issue) => ({
                    key: issue.code, text: issue.message, jumpTo: issue.shotIds,
                  })),
                  ...variation.suggestions.map((line) => ({ key: line, text: line, tip: true })),
                ],
              },
              {
                label: '镜头节奏',
                clean: pacing.length === 0,
                summary: pacing.length === 0 ? '通过' : (paceHint ?? '偏慢'),
                ...(paceHint === undefined ? {} : { hint: paceHint }),
              },
            ]}
          />
        )}



        {active !== undefined ? (
          <>
            <div className="dcs-shot-detail">
              <div className="dcs-shot-side">
                <div className="dcs-shot-image">
                  {imageSrc === undefined
                    ? <div className="dcs-shot-empty">这一镜还没生成</div>
                    : <img src={imageSrc} alt={active.sectionLabel} />}
                </div>

                <div className="dcs-shot-head">
                  <span className="dcs-shot-where">
                    {active.sectionLabel} · 第 {active.index + 1} 镜 / {sectionShots(active.sectionId).length}
                  </span>
                  <span className="dcs-hint">{active.duration.toFixed(1)} 秒</span>
                </div>

                {/* Prose, not a field. The narration is the one thing here
                    nobody edits — it is context for the four decisions below, and
                    a titled block gave it the same weight as the things that are
                    actually being chosen. */}
                <p className="dcs-shot-text" title="这一段要念出来的字，分镜跟着它走">
                  <span className="dcs-shot-text-label">台词：</span>
                  {active.text || '（这一段没有台词）'}
                </p>
              </div>

              <div className="dcs-shot-meta">
                <div className="dcs-shot-block">
                  <span
                    className="dcs-shot-block-title"
                    title="这一镜拍什么，只写主体。相机 / 镜头 / 光线 / 风格由下面的镜头语言和 playbook 分层拼上——「最终提示词」就是拼好的结果。"
                  >画面提示词</span>
                  <textarea
                    className="dcs-input dcs-textarea"
                    rows={3}
                    value={prompt}
                    placeholder="英文提示词：只写画面主体"
                    spellCheck={false}
                    disabled={busy !== null}
                    onChange={(event) => setDraftPrompt(event.target.value)}
                  />
                </div>

                <div className="dcs-shot-block dcs-shot-block-lang">
                  <span className="dcs-shot-block-title" title="这四层逐镜变化，是让十张图真的不一样的地方">
                    镜头语言
                  </span>
                  <div className="dcs-lang-grid">
                    {SHOT_LANGUAGE_FIELDS.map((field) => {
                      const own = languageOf(active)[field.key]
                      const inherited = styleDefaults[field.key]
                      return (
                        <label className="dcs-lang-cell" key={field.key}>
                          <span className="dcs-lang-name" title={field.hint}>{field.label}</span>
                          <select
                            className={'dcs-select dcs-lang-select'
                              + (own === undefined && inherited !== undefined ? ' dcs-select-inherited' : '')}
                            value={own === undefined ? '' : String(own)}
                            disabled={busy !== null}
                            onChange={(event) => void setLanguage(field.key, event.target.value)}
                          >
                            {/* Named rather than blank: an empty row reads as
                                broken, and what it actually means is that the
                                style decides — worth saying out loud. */}
                            <option value="">
                              {inherited === undefined
                                ? '不指定'
                                : '跟风格（' + (field.options.find((o) => o.id === String(inherited))?.label
                                  ?? String(inherited)) + '）'}
                            </option>
                            {field.options.map((option) => (
                              <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      )
                    })}
                  </div>
                </div>

                {builtPrompt === undefined ? null : (
                  <div className="dcs-shot-block">
                    <span className="dcs-shot-block-title" title="插件拼好的整条，生成时原样使用">
                      最终提示词
                    </span>
                    <div className="dcs-built">
                      {builtPrompt.layers.map((entry) => (
                        <span
                          key={entry.layer}
                          className={'dcs-built-layer' + (entry.fromDefaults ? ' dcs-built-inherited' : '')}
                          title={'第 ' + entry.layer + ' 层 · ' + entry.name
                            + (entry.fromDefaults ? '（来自风格默认）' : '')}
                        >{entry.text}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* The strip's toolbar: one row of shot-level commands, parked right
                above the timeline they act on. */}
            <div className="dcs-shot-tools">
              <label className="dcs-inline-pick">
                <span className="dcs-hint">段落占比</span>
                {isLastShot ? (
                  <span className="dcs-derived" title="最后一镜自动补齐剩下的时间，改前面几镜即可">
                    {shareOf(active).toFixed(2)}　自动
                  </span>
                ) : (
                  <input
                    key={active.key + ':' + active.weight}
                    className="dcs-input dcs-input-seconds"
                    inputMode="decimal"
                    defaultValue={shareOf(active).toFixed(2)}
                    disabled={busy !== null}
                    title="这一镜占本段时间的比例，0 到 1 之间。两镜均分就是 0.5，最后一镜自动补齐。"
                    onBlur={(event) => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value) && Math.abs(value - shareOf(active)) > 0.005) void setShare(value)
                    }}
                  />
                )}
              </label>
              <button type="button" className="dcs-btn dcs-btn-small" disabled={busy !== null}
                onClick={() => void move(-1)} title="在本段内前移">←</button>
              <button
                type="button"
                className={'dcs-btn dcs-btn-small' + (isHero ? ' dcs-btn-hero' : '')}
                disabled={busy !== null}
                onClick={() => void toggleHero()}
                title="全片的画面顶点。标了之后前后两镜的镜别要和它不一样，否则顶不起来。"
              >{isHero ? '★ 高光' : '☆ 高光'}</button>
              <button type="button" className="dcs-btn dcs-btn-small" disabled={busy !== null}
                onClick={() => void move(1)} title="在本段内后移">→</button>
              <button type="button" className="dcs-btn dcs-btn-small" disabled={busy !== null}
                onClick={() => void addShot()} title="给这一段再加一镜，时长从本段切分">添加</button>
              <button type="button" className="dcs-btn dcs-btn-small dcs-btn-quiet-danger" disabled={busy !== null}
                onClick={() => void removeShot()}>删除</button>
              {draftPrompt !== null ? (
                <button type="button" className="dcs-btn dcs-btn-small" disabled={busy !== null}
                  onClick={() => void savePrompt()}>保存提示词</button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="dcs-note">脚本还没有段落，先回上一步。</p>
        )}

        {/* Same film body as the timeline: this is the same object seen
            earlier in its life, and giving it a different frame made two
            views of one thing look like two unrelated widgets. */}
        <div className="dcs-film">
          <div className="dcs-film-perf" aria-hidden="true" />
          <div className="dcs-film-body">
        <Strip ariaLabel="分镜序列">
            {state.timeline.map((timing) => (
              <div className="dcs-shot-group" key={timing.sectionId} style={{ width: widthOf(timing.duration) }}>
                <div className="dcs-shot-group-label" title={timing.sectionId}>
                  {timing.label} · {timing.duration.toFixed(1)}s
                </div>
                <div className="dcs-shot-cards">
                  {sectionShots(timing.sectionId).map((shot) => {
                    const src = shot.path === undefined
                      ? undefined
                      : '/studio/media?project=' + encodeURIComponent(state.project.id)
                        + '&path=' + encodeURIComponent(shot.path)
                    const wide = shot.duration > playbook.pacing.maxSectionSeconds
                    const classes = ['dcs-shot-card']
                    if (shot.key === active?.key) classes.push('dcs-shot-card-current')
                    if (shot.path === undefined) classes.push('dcs-shot-card-empty')
                    if (wide) classes.push('dcs-shot-card-wide')
                    return (
                      <button
                        type="button"
                        key={shot.key}
                        className={classes.join(' ')}
                        style={{ flexGrow: shot.weight }}
                        title={wide
                          ? shot.duration.toFixed(1) + ' 秒，比风格建议的 ' + playbook.pacing.maxSectionSeconds + ' 秒长，考虑再切一镜'
                          : shot.duration.toFixed(1) + ' 秒'}
                        onClick={() => setActiveKey(shot.key)}
                      >
                        {src === undefined
                          ? <span className="dcs-shot-card-hole">+</span>
                          : <img src={src} alt="" />}
                        <span className="dcs-shot-card-time">{shot.duration.toFixed(1)}s</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
        </Strip>
          </div>
          <div className="dcs-film-perf" aria-hidden="true" />
        </div>

        {active !== undefined ? (
          <div className="dcs-shot-foot">
            <span className="dcs-spacer" />
            <button
              type="button"
              className="dcs-btn dcs-btn-small dcs-btn-accent"
              disabled={phase !== null || busy !== null || shots.length === 0}
              onClick={() => void generate(shots)}
              title="整批重新生成，已有图会被替换"
            >
              <BusyLabel phase={phase} idle="全部生成" />
            </button>
            <button
              type="button"
              className="dcs-btn dcs-btn-small dcs-btn-accent"
              disabled={phase !== null || busy !== null}
              onClick={() => void generate([active])}
            >
              {phase === null ? (active.path === undefined ? '生成这一镜' : '重新生成') : <BusyLabel phase={phase} idle="" />}
            </button>
          </div>
        ) : null}
        </div>
      </section>
      <section className="dcs-card">
        <div className="dcs-card-head">
          <IconSliders className="dcs-section-icon" />
          <h3 className="dcs-card-title">生成参数与参考图</h3>
          <span className="dcs-card-meta"><span>参考图 <b>{references.length}</b> 张</span></span>
        </div>
        <div className="dcs-card-body">
          <div className="dcs-duo-split">
            <div className="dcs-duo-col">
              <div className="dcs-col-head"><b>生成参数</b></div>
              <div className="dcs-row dcs-row-tight">
                <input
                  type="checkbox"
                  className="dcs-check-box"
                  checked={loraOn}
                  disabled={busy !== null}
                  title={loraOn ? '这行会附在生成请求里' : '勾选后这行才会附在生成请求里'}
                  onChange={(event) => {
                    setLoraOn(event.target.checked)
                    void saveLora({ on: event.target.checked })
                  }}
                />
                <input
                  className="dcs-input"
                  value={loraHint}
                  placeholder="例如：LoRA 强度 0.8　/　综合强度 0.5-0.8-0.4"
                  spellCheck={false}
                  disabled={busy !== null}
                  onChange={(event) => setLoraHint(event.target.value)}
                  onBlur={(event) => {
                    if (event.target.value.trim() !== (state.project.lora_name ?? '').trim()) {
                      void saveLora({ hint: event.target.value })
                    }
                  }}
                />
              </div>
              <p className="dcs-hint">填入要加载的 LoRA 和对应的强度，发送给 Agent 自行理解。</p>
            </div>

            <div className="dcs-duo-col">
              <div className="dcs-col-head"><b>参考图</b></div>

              {/* Slots, like the ComfyUI panel's load area: position matters,
                  because a workflow's loaders take them in order. */}
              <div className="dcs-slots">
                {references.map((name, index) => (
                  <div className="dcs-slot" key={name + index}>
                    <span className="dcs-slot-index">{index + 1}</span>
                    <img className="dcs-slot-media" src={referenceUrl(name)} alt="" loading="lazy" />
                    <span className="dcs-slot-name" title={name}>{name}</span>
                    <button
                      type="button"
                      className="dcs-slot-x"
                      aria-label="移除这一槽"
                      disabled={busy !== null}
                      onClick={() => void removeReference(name)}
                    >×</button>
                  </div>
                ))}
                <button
                  type="button"
                  className="dcs-slot dcs-slot-empty"
                  disabled={busy !== null}
                  title="从 ComfyUI 的素材里指定一张；浏览器里也可以上传新的"
                  onClick={() => setPickerOpen(true)}
                >
                  <span className="dcs-slot-index">{references.length + 1}</span>
                  <span className="dcs-slot-add">指定参考图</span>
                </button>
              </div>
              <p className="dcs-hint">指定 ComfyUI 中的参考图，以用于多图风格参考。</p>
            </div>
          </div>
        </div>
      </section>


      <div className="dcs-cta">
        <button
          type="button"
          className="dcs-cta-primary"
          disabled={busy !== null || phase !== null || done < shots.length}
          title={done < shots.length ? '还差 ' + (shots.length - done) + ' 镜没生成' : undefined}
          onClick={() => void submit()}
        >
          <IconPlay className="dcs-cta-icon" />
          {busy === 'submit'
            ? '提交中…'
            : done < shots.length
              ? '还差 ' + (shots.length - done) + ' 镜'
              : approved ? '重新提交分镜' : '确认分镜，进入成片'}
        </button>
        <p className="dcs-cta-hint">
          {approved
            ? '这一版已经确认过了。再提交一次会替换分镜，成片要重做。'
            : '这一页所有分镜确认后的下一步——之后才会开始合成。'}
        </p>
      </div>

      {pickerOpen ? (
        <AssetPicker
          kinds={['image']}
          onPick={(file) => void addReference(file)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  )
}

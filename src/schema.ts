/**
 * Artifact shapes and their validators.
 *
 * Ported from OpenMontage's `schemas/artifacts/*.json`, trimmed to the four
 * artifacts MVP-0 actually produces, and hand-written rather than run through a
 * JSON Schema engine: the plugin ships zero validation dependencies, and a
 * hand-written pass can say *which section overlaps which* instead of
 * "does not match schema".
 *
 * Field names stay identical to OpenMontage wherever a field survived, so its
 * director instructions still describe these artifacts accurately.
 * `ScriptSection.visual` is the one MVP-0 addition — an illustrated explainer
 * needs a per-section image prompt, and OpenMontage carried that in the
 * separate `scene_plan` stage this pipeline folds away.
 *
 * Validation is structural only. Whether a path exists on disk is checked in
 * state.ts, because that is a fact about the world rather than about shape.
 */

export type ArtifactName =
  | 'brief'
  | 'script'
  /** Narration recorded by the assets_audio stage. */
  | 'asset_manifest_audio'
  /**
   * What each shot is meant to SHOW, planned before anything is generated.
   * Owned by assets_shots, but written ahead of the manifest it plans.
   */
  | 'scene_plan'
  /** Stills and clips recorded by the assets_shots stage. */
  | 'asset_manifest_shots'
  | 'render_report'

export interface Issue {
  path: string
  message: string
}

/* ------------------------------------------------------------------ types */

export interface Brief {
  version: '1.0'
  title: string
  hook: string
  key_points: string[]
  tone: string
  style: string
  target_platform: 'youtube' | 'bilibili' | 'douyin' | 'xiaohongshu' | 'wechat' | 'generic'
  target_duration_seconds: number
  core_message?: string
  cta?: string
  target_audience?: string
  metadata?: Record<string, unknown>
}

export interface DeliveryCues {
  pace?: 'slow' | 'measured' | 'conversational' | 'brisk' | 'fast'
  energy?: string
  emphasis_words?: string[]
  /** Silence held before this line, overriding the playbook's default lead-in. */
  pause_before_seconds?: number
  /** Silence held after this line, overriding the playbook's default tail. */
  pause_after_seconds?: number
  delivery_note?: string
  /** Narration text as the TTS workflow should receive it (punctuation, breaks). */
  provider_text?: string
}

export interface SectionVisual {
  prompt: string
  negative_prompt?: string
  style_note?: string
}

export interface ScriptSection {
  id: string
  text: string
  start_seconds: number
  end_seconds: number
  label?: string
  speaker_directions?: string
  delivery_cues?: DeliveryCues
  visual?: SectionVisual
}

export interface Script {
  version: '1.0'
  title: string
  total_duration_seconds: number
  sections: ScriptSection[]
  voice_performance?: {
    performance_intent?: string
    pacing_profile?: string
    energy_curve?: string
    pause_policy?: string
    /** The most performance-sensitive section, used for the TTS sample gate. */
    sample_section_id?: string
  }
  metadata?: Record<string, unknown>
}

export type AssetType = 'image' | 'narration' | 'audio' | 'music' | 'sfx' | 'video' | 'subtitle'

export interface AssetRecord {
  id: string
  type: AssetType
  /** Relative to the project directory. Absolute paths are rejected. */
  path: string
  source_tool: string
  /** The `ScriptSection.id` this asset belongs to. */
  scene_id: string
  prompt?: string
  seed?: number
  model?: string
  /** Filled in by `openreel_stage` from ffprobe; a caller-supplied value is overwritten. */
  duration_seconds?: number
  resolution?: string
  format?: string
  workflow_id?: string
  /**
   * Order within its section, from 0. A section holds as many shots as its
   * pacing needs; the script decides what is *said*, this decides how many
   * pictures carry it.
   */
  shot_index?: number
  /**
   * Share of the section's on-screen time. Shots split their section evenly
   * unless weights say otherwise, so `1` on every shot is the default and any
   * other set of numbers is read as a ratio.
   */
  weight?: number
}

export interface AssetManifest {
  version: '1.0'
  assets: AssetRecord[]
  metadata?: Record<string, unknown>
}

export interface RenderOutput {
  path: string
  format: string
  resolution: string
  duration_seconds: number
  codec?: string
  audio_codec?: string
  fps?: number
  file_size_bytes?: number
}

export interface RenderReport {
  version: '1.0'
  outputs: RenderOutput[]
  render_time_seconds?: number
  warnings?: string[]
  metadata?: Record<string, unknown>
}

/* -------------------------------------------------------------- primitives */

/* -------------------------------------------------------------- scene plan */

/**
 * Structured cinematography vocabulary, one entry per shot.
 *
 * The enums are OpenMontage's, value for value. That is deliberate: OM's
 * prompt builder maps each of these onto a natural-language phrase, and
 * keeping the vocabulary identical makes that a translation rather than a
 * redesign.
 *
 * Every field is optional. A plan that names only a subject is still a plan —
 * the point is that there is now somewhere to PUT a lens choice, which is what
 * separates "each picture was directed" from "each picture got the same
 * prefix".
 */
export interface ShotLanguage {
  shot_size?: ShotSize
  camera_movement?: CameraMovement
  lens_mm?: number
  lighting_key?: LightingKey
  color_temperature?: ColorTemperature
  depth_of_field?: DepthOfField
}

export const SHOT_SIZES = [
  'extreme_wide', 'wide', 'medium_wide', 'medium', 'medium_close',
  'close_up', 'extreme_close_up', 'over_shoulder', 'insert', 'establishing',
] as const
export type ShotSize = (typeof SHOT_SIZES)[number]

export const CAMERA_MOVEMENTS = [
  'static', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down',
  'dolly_in', 'dolly_out', 'tracking_left', 'tracking_right',
  'crane_up', 'crane_down', 'handheld', 'steadicam', 'whip_pan',
  'orbital', 'zoom_in', 'zoom_out', 'rack_focus',
] as const
export type CameraMovement = (typeof CAMERA_MOVEMENTS)[number]

/** Real focal lengths only; a free number invites 37mm, which means nothing. */
export const LENS_MM = [14, 24, 35, 50, 85, 135, 200] as const

export const LIGHTING_KEYS = [
  'high_key', 'low_key', 'natural', 'golden_hour', 'blue_hour',
  'tungsten_warm', 'neon', 'silhouette', 'rim_lit', 'volumetric', 'overcast_soft',
] as const
export type LightingKey = (typeof LIGHTING_KEYS)[number]

export const COLOR_TEMPERATURES = ['cool', 'neutral', 'warm', 'mixed'] as const
export type ColorTemperature = (typeof COLOR_TEMPERATURES)[number]

export const DEPTHS_OF_FIELD = ['shallow', 'medium', 'deep'] as const
export type DepthOfField = (typeof DEPTHS_OF_FIELD)[number]

/** One planned picture. */
export interface SceneShot {
  /** Stable within the plan; the generated asset carries the same id. */
  id: string
  section_id: string
  shot_index: number
  /** What this shot shows - the subject layer, in plain words. */
  prompt?: string
  /** Concrete texture/material words, kept apart from the subject sentence. */
  texture_keywords?: string[]
  shot_language?: ShotLanguage
  /** Share of the section's screen time. Absent means an equal share. */
  weight?: number
  /** Reference image names in ComfyUI's input directory, for this shot only. */
  reference_names?: string[]
  /**
   * The visual peak. At most a couple per film.
   *
   * A run of competently-framed pictures with no high point is the failure a
   * variation score cannot see any other way: nothing is wrong with any single
   * frame, and the whole thing is still flat. Marking one says which frame is
   * carrying the film, and the checker then insists its neighbours look
   * different from it.
   */
  hero_moment?: boolean
}

export interface ScenePlan {
  version: '1.0'
  shots: SceneShot[]
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class Checker {
  readonly issues: Issue[] = []

  constructor(private readonly root: Record<string, unknown>) {}

  private fail(path: string, message: string): undefined {
    this.issues.push({ path, message })
    return undefined
  }

  str(obj: Record<string, unknown>, key: string, path: string, required: boolean): string | undefined {
    const value = obj[key]
    if (value === undefined || value === null) {
      if (required) this.fail(path + '.' + key, 'is required')
      return undefined
    }
    if (typeof value !== 'string') return this.fail(path + '.' + key, 'must be a string, got ' + typeof value)
    if (required && value.trim() === '') return this.fail(path + '.' + key, 'must not be empty')
    return value
  }

  num(
    obj: Record<string, unknown>,
    key: string,
    path: string,
    required: boolean,
    range?: { min?: number; max?: number },
  ): number | undefined {
    const value = obj[key]
    if (value === undefined || value === null) {
      if (required) this.fail(path + '.' + key, 'is required')
      return undefined
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return this.fail(path + '.' + key, 'must be a finite number, got ' + JSON.stringify(value))
    }
    if (range?.min !== undefined && value < range.min) {
      return this.fail(path + '.' + key, 'must be >= ' + range.min + ', got ' + value)
    }
    if (range?.max !== undefined && value > range.max) {
      return this.fail(path + '.' + key, 'must be <= ' + range.max + ', got ' + value)
    }
    return value
  }

  enum<T extends string>(
    obj: Record<string, unknown>,
    key: string,
    path: string,
    allowed: readonly T[],
    required: boolean,
  ): T | undefined {
    const value = this.str(obj, key, path, required)
    if (value === undefined) return undefined
    if (!(allowed as readonly string[]).includes(value)) {
      return this.fail(path + '.' + key, 'must be one of ' + allowed.join(' | ') + ', got ' + JSON.stringify(value))
    }
    return value as T
  }

  strArray(obj: Record<string, unknown>, key: string, path: string, minItems: number): string[] | undefined {
    const value = obj[key]
    if (value === undefined || value === null) {
      if (minItems > 0) this.fail(path + '.' + key, 'is required')
      return undefined
    }
    if (!Array.isArray(value)) return this.fail(path + '.' + key, 'must be an array of strings')
    if (value.length < minItems) {
      return this.fail(path + '.' + key, 'must have at least ' + minItems + ' item(s), got ' + value.length)
    }
    const out: string[] = []
    value.forEach((item, index) => {
      if (typeof item !== 'string' || item.trim() === '') {
        this.fail(path + '.' + key + '[' + index + ']', 'must be a non-empty string')
        return
      }
      out.push(item)
    })
    return out
  }

  objArray(obj: Record<string, unknown>, key: string, path: string, minItems: number): Array<Record<string, unknown>> | undefined {
    const value = obj[key]
    if (value === undefined || value === null) {
      if (minItems > 0) this.fail(path + '.' + key, 'is required')
      return undefined
    }
    if (!Array.isArray(value)) return this.fail(path + '.' + key, 'must be an array of objects')
    if (value.length < minItems) {
      return this.fail(path + '.' + key, 'must have at least ' + minItems + ' item(s), got ' + value.length)
    }
    const out: Array<Record<string, unknown>> = []
    value.forEach((item, index) => {
      if (!isRecord(item)) {
        this.fail(path + '.' + key + '[' + index + ']', 'must be an object')
        return
      }
      out.push(item)
    })
    return out
  }

  /**
   * Reject fields the schema does not know. A typo silently dropped is worse
   * than a rejected write, because the pipeline then advances on a lie.
   */
  unknownKeys(obj: Record<string, unknown>, path: string, allowed: readonly string[]): void {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) {
        this.fail(path + '.' + key, 'is not a recognised field (allowed: ' + allowed.join(', ') + ')')
      }
    }
  }

  version(path: string): void {
    if (this.root.version !== '1.0') {
      this.fail(path + '.version', 'must be the string "1.0", got ' + JSON.stringify(this.root.version))
    }
  }

  add(path: string, message: string): void {
    this.issues.push({ path, message })
  }
}

/* --------------------------------------------------------------- artifacts */

export const PLATFORMS = ['youtube', 'bilibili', 'douyin', 'xiaohongshu', 'wechat', 'generic'] as const

const BRIEF_KEYS = [
  'version', 'title', 'hook', 'key_points', 'tone', 'style', 'target_platform',
  'target_duration_seconds', 'core_message', 'cta', 'target_audience', 'metadata',
] as const

function validateBrief(value: Record<string, unknown>): Issue[] {
  const c = new Checker(value)
  c.unknownKeys(value, 'brief', BRIEF_KEYS)
  c.version('brief')
  c.str(value, 'title', 'brief', true)
  c.str(value, 'hook', 'brief', true)
  c.strArray(value, 'key_points', 'brief', 1)
  // Optional, both of them, because nothing downstream reads either one: the
  // playbook already carries the narration voice, and no stage consumes the
  // platform. Requiring a field the pipeline never uses buys nothing and costs
  // the model a failed round trip guessing at it.
  c.str(value, 'tone', 'brief', false)
  c.str(value, 'style', 'brief', true)
  c.enum(value, 'target_platform', 'brief', PLATFORMS, false)
  c.num(value, 'target_duration_seconds', 'brief', true, { min: 5, max: 1800 })
  c.str(value, 'core_message', 'brief', false)
  c.str(value, 'cta', 'brief', false)
  c.str(value, 'target_audience', 'brief', false)
  return c.issues
}

const PACES = ['slow', 'measured', 'conversational', 'brisk', 'fast'] as const
const SECTION_KEYS = [
  'id', 'text', 'start_seconds', 'end_seconds', 'label',
  'speaker_directions', 'delivery_cues', 'visual',
] as const
const CUE_KEYS = [
  'pace', 'energy', 'emphasis_words', 'pause_before_seconds',
  'pause_after_seconds', 'delivery_note', 'provider_text',
] as const
const VISUAL_KEYS = ['prompt', 'negative_prompt', 'style_note'] as const
const VOICE_KEYS = [
  'performance_intent', 'pacing_profile', 'energy_curve', 'pause_policy', 'sample_section_id',
] as const
const SCRIPT_KEYS = ['version', 'title', 'total_duration_seconds', 'sections', 'voice_performance', 'metadata'] as const

function validateScript(value: Record<string, unknown>): Issue[] {
  const c = new Checker(value)
  c.unknownKeys(value, 'script', SCRIPT_KEYS)
  c.version('script')
  c.str(value, 'title', 'script', true)
  const total = c.num(value, 'total_duration_seconds', 'script', true, { min: 1 })

  const voice = value.voice_performance
  if (voice !== undefined && voice !== null) {
    if (!isRecord(voice)) c.add('script.voice_performance', 'must be an object')
    else c.unknownKeys(voice, 'script.voice_performance', VOICE_KEYS)
  }

  const sections = c.objArray(value, 'sections', 'script', 1)
  if (sections === undefined) return c.issues

  const seenIds = new Set<string>()
  let previousEnd = -Infinity
  let lastEnd = 0

  sections.forEach((section, index) => {
    const path = 'script.sections[' + index + ']'
    c.unknownKeys(section, path, SECTION_KEYS)
    const id = c.str(section, 'id', path, true)
    c.str(section, 'text', path, true)
    const start = c.num(section, 'start_seconds', path, true, { min: 0 })
    const end = c.num(section, 'end_seconds', path, true, { min: 0 })
    c.str(section, 'label', path, false)
    c.str(section, 'speaker_directions', path, false)

    if (id !== undefined) {
      if (seenIds.has(id)) c.add(path + '.id', 'duplicate section id ' + JSON.stringify(id))
      seenIds.add(id)
    }

    // A timeline that overlaps or runs backwards produces subtitles that
    // contradict the render, so it is rejected rather than repaired.
    if (start !== undefined && end !== undefined && end <= start) {
      c.add(path, 'end_seconds (' + end + ') must be greater than start_seconds (' + start + ')')
    }
    if (start !== undefined && previousEnd > -Infinity && start < previousEnd) {
      c.add(path, 'start_seconds (' + start + ') overlaps the previous section, which ends at ' + previousEnd)
    }
    if (end !== undefined) {
      previousEnd = end
      lastEnd = end
    }

    const cues = section.delivery_cues
    if (cues !== undefined && cues !== null) {
      if (!isRecord(cues)) {
        c.add(path + '.delivery_cues', 'must be an object')
      } else {
        c.unknownKeys(cues, path + '.delivery_cues', CUE_KEYS)
        c.enum(cues, 'pace', path + '.delivery_cues', PACES, false)
        c.str(cues, 'energy', path + '.delivery_cues', false)
        c.str(cues, 'delivery_note', path + '.delivery_cues', false)
        c.str(cues, 'provider_text', path + '.delivery_cues', false)
        c.num(cues, 'pause_before_seconds', path + '.delivery_cues', false, { min: 0, max: 5 })
        c.num(cues, 'pause_after_seconds', path + '.delivery_cues', false, { min: 0, max: 5 })
        if (cues.emphasis_words !== undefined) c.strArray(cues, 'emphasis_words', path + '.delivery_cues', 0)
      }
    }

    const visual = section.visual
    if (visual !== undefined && visual !== null) {
      if (!isRecord(visual)) {
        c.add(path + '.visual', 'must be an object')
      } else {
        c.unknownKeys(visual, path + '.visual', VISUAL_KEYS)
        c.str(visual, 'prompt', path + '.visual', true)
        c.str(visual, 'negative_prompt', path + '.visual', false)
        c.str(visual, 'style_note', path + '.visual', false)
      }
    }
  })

  // The planned timeline is a plan, not a measurement — compose re-times
  // everything against the real narration. A wildly wrong total still means
  // the script was not written to length, so a >25% drift is an error.
  if (total !== undefined && lastEnd > 0) {
    const drift = Math.abs(lastEnd - total) / total
    if (drift > 0.25) {
      c.add(
        'script.total_duration_seconds',
        'declares ' + total + 's but the last section ends at ' + lastEnd + 's ('
        + Math.round(drift * 100) + '% drift); fix the section timings or the total',
      )
    }
  }

  return c.issues
}

const ASSET_TYPES = ['image', 'narration', 'audio', 'music', 'sfx', 'video', 'subtitle'] as const
const ASSET_KEYS = [
  'id', 'type', 'path', 'source_tool', 'scene_id', 'prompt', 'seed',
  'model', 'duration_seconds', 'resolution', 'format', 'workflow_id',
  'shot_index', 'weight',
] as const

/**
 * Artifact paths are project-relative by contract. Both an absolute path and a
 * `..` segment leave the project directory, and both are realistic in
 * model-authored JSON — a ComfyUI output directory pasted verbatim is the
 * common case. Catching them here reports a wrong *shape*, which is what they
 * are; leaving it to the on-disk check would report them as a missing file.
 */
function unsafePathReason(value: string): string | undefined {
  if (value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(value)) {
    return 'must be relative to the project directory, got the absolute path ' + JSON.stringify(value)
  }
  if (value.split(/[\\/]/).includes('..')) {
    return 'must stay inside the project directory, but ' + JSON.stringify(value) + ' contains a ".." segment'
  }
  return undefined
}

/**
 * Both asset manifests share one shape; only the asset types they may carry
 * differ, and that belongs to the state machine (it is a cross-artifact rule
 * about the stage, not about the document). `label` keeps the issue paths
 * pointing at the artifact the caller actually sent.
 */
function validateAssetManifest(value: Record<string, unknown>, label: string): Issue[] {
  const c = new Checker(value)
  c.unknownKeys(value, label, ['version', 'assets', 'metadata'])
  c.version(label)
  const assets = c.objArray(value, 'assets', label, 1)
  if (assets === undefined) return c.issues

  const seenIds = new Set<string>()
  assets.forEach((asset, index) => {
    const path = label + '.assets[' + index + ']'
    c.unknownKeys(asset, path, ASSET_KEYS)
    const id = c.str(asset, 'id', path, true)
    c.enum(asset, 'type', path, ASSET_TYPES, true)
    const relPath = c.str(asset, 'path', path, true)
    c.str(asset, 'source_tool', path, true)
    c.str(asset, 'scene_id', path, true)
    c.str(asset, 'prompt', path, false)
    c.str(asset, 'model', path, false)
    c.str(asset, 'resolution', path, false)
    c.str(asset, 'format', path, false)
    c.str(asset, 'workflow_id', path, false)
    c.num(asset, 'seed', path, false)
    c.num(asset, 'duration_seconds', path, false, { min: 0 })
    c.num(asset, 'shot_index', path, false, { min: 0, max: 999 })
    // A zero weight would ask for a shot that is on screen for no time at all.
    c.num(asset, 'weight', path, false, { min: 0.01, max: 100 })

    if (id !== undefined) {
      if (seenIds.has(id)) c.add(path + '.id', 'duplicate asset id ' + JSON.stringify(id))
      seenIds.add(id)
    }
    if (relPath !== undefined) {
      const reason = unsafePathReason(relPath)
      if (reason !== undefined) c.add(path + '.path', reason)
    }
  })
  return c.issues
}

const OUTPUT_KEYS = [
  'path', 'format', 'resolution', 'duration_seconds', 'codec',
  'audio_codec', 'fps', 'file_size_bytes',
] as const

function validateRenderReport(value: Record<string, unknown>): Issue[] {
  const c = new Checker(value)
  c.unknownKeys(value, 'render_report', ['version', 'outputs', 'render_time_seconds', 'warnings', 'metadata'])
  c.version('render_report')
  const outputs = c.objArray(value, 'outputs', 'render_report', 1)
  if (outputs !== undefined) {
    outputs.forEach((output, index) => {
      const path = 'render_report.outputs[' + index + ']'
      c.unknownKeys(output, path, OUTPUT_KEYS)
      const relPath = c.str(output, 'path', path, true)
      c.str(output, 'format', path, true)
      c.str(output, 'resolution', path, true)
      c.num(output, 'duration_seconds', path, true, { min: 0 })
      c.str(output, 'codec', path, false)
      c.str(output, 'audio_codec', path, false)
      c.num(output, 'fps', path, false, { min: 1 })
      c.num(output, 'file_size_bytes', path, false, { min: 0 })
      if (relPath !== undefined) {
        const reason = unsafePathReason(relPath)
        if (reason !== undefined) c.add(path + '.path', reason)
      }
    })
  }
  c.num(value, 'render_time_seconds', 'render_report', false, { min: 0 })
  if (value.warnings !== undefined) c.strArray(value, 'warnings', 'render_report', 0)
  return c.issues
}

/* ------------------------------------------------------------------ facade */

const SCENE_PLAN_KEYS = ['version', 'shots'] as const
const SHOT_KEYS = [
  'id', 'section_id', 'shot_index', 'prompt', 'texture_keywords',
  'shot_language', 'weight', 'reference_names', 'hero_moment',
] as const
const SHOT_LANGUAGE_KEYS = [
  'shot_size', 'camera_movement', 'lens_mm', 'lighting_key',
  'color_temperature', 'depth_of_field',
] as const

export function validateScenePlan(value: Record<string, unknown>): Issue[] {
  const c = new Checker(value)
  c.unknownKeys(value, 'scene_plan', SCENE_PLAN_KEYS)
  c.version('scene_plan')

  const shots = c.objArray(value, 'shots', 'scene_plan', 1)
  if (shots === undefined) return c.issues

  // Two shots claiming the same id would make the manifest ambiguous about
  // which plan a generated picture answers to.
  const seen = new Set<string>()
  // A section's shot_index values have to be 0..n-1 with nothing missing, or
  // the share-out of screen time has a hole in it.
  const perSection = new Map<string, number[]>()

  shots.forEach((shot, index) => {
    const path = 'scene_plan.shots[' + index + ']'
    c.unknownKeys(shot, path, SHOT_KEYS)

    const id = c.str(shot, 'id', path, true)
    if (id !== undefined) {
      if (seen.has(id)) c.issues.push({ path: path + '.id', message: 'duplicate shot id ' + JSON.stringify(id) })
      seen.add(id)
    }

    const sectionId = c.str(shot, 'section_id', path, true)
    const shotIndex = c.num(shot, 'shot_index', path, true, { min: 0 })
    if (sectionId !== undefined && shotIndex !== undefined) {
      if (!Number.isInteger(shotIndex)) {
        c.issues.push({ path: path + '.shot_index', message: 'must be a whole number, got ' + shotIndex })
      } else {
        const list = perSection.get(sectionId) ?? []
        list.push(shotIndex)
        perSection.set(sectionId, list)
      }
    }

    c.str(shot, 'prompt', path, false)
    if (shot.texture_keywords !== undefined) c.strArray(shot, 'texture_keywords', path, 0)
    if (shot.reference_names !== undefined) c.strArray(shot, 'reference_names', path, 0)
    c.num(shot, 'weight', path, false, { min: 0.01, max: 100 })
    if (shot.hero_moment !== undefined && typeof shot.hero_moment !== 'boolean') {
      c.issues.push({ path: path + '.hero_moment', message: 'must be true or false' })
    }

    const language = shot.shot_language
    if (language !== undefined && language !== null) {
      const lpath = path + '.shot_language'
      if (!isRecord(language)) {
        c.issues.push({ path: lpath, message: 'must be an object' })
      } else {
        c.unknownKeys(language, lpath, SHOT_LANGUAGE_KEYS)
        c.enum(language, 'shot_size', lpath, SHOT_SIZES, false)
        c.enum(language, 'camera_movement', lpath, CAMERA_MOVEMENTS, false)
        c.enum(language, 'lighting_key', lpath, LIGHTING_KEYS, false)
        c.enum(language, 'color_temperature', lpath, COLOR_TEMPERATURES, false)
        c.enum(language, 'depth_of_field', lpath, DEPTHS_OF_FIELD, false)
        const lens = c.num(language, 'lens_mm', lpath, false)
        if (lens !== undefined && !(LENS_MM as readonly number[]).includes(lens)) {
          c.issues.push({
            path: lpath + '.lens_mm',
            message: 'must be one of ' + LENS_MM.join(' | ') + ', got ' + lens,
          })
        }
      }
    }
  })

  for (const [sectionId, indices] of perSection) {
    const sorted = [...indices].sort((a, b) => a - b)
    const expected = sorted.map((_, i) => i)
    if (sorted.join(',') !== expected.join(',')) {
      c.issues.push({
        path: 'scene_plan.shots',
        message: "section '" + sectionId + "' has shot_index " + sorted.join(', ')
          + '; they must run 0..' + (sorted.length - 1) + ' with no gaps or repeats',
      })
    }
  }

  return c.issues
}

const VALIDATORS: Record<ArtifactName, (value: Record<string, unknown>) => Issue[]> = {
  brief: validateBrief,
  script: validateScript,
  asset_manifest_audio: (value) => validateAssetManifest(value, 'asset_manifest_audio'),
  scene_plan: validateScenePlan,
  asset_manifest_shots: (value) => validateAssetManifest(value, 'asset_manifest_shots'),
  render_report: validateRenderReport,
}

/** Structural issues with one artifact; an empty array means it is well-formed. */
export function validateArtifact(name: ArtifactName, value: unknown): Issue[] {
  if (!isRecord(value)) return [{ path: name, message: 'must be a JSON object' }]
  return VALIDATORS[name](value)
}

export function formatIssues(issues: readonly Issue[]): string {
  return issues.map((issue) => '  - ' + issue.path + ': ' + issue.message).join('\n')
}

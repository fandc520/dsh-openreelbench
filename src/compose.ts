/**
 * FFmpeg assembly: script + generated assets -> one narrated video.
 *
 * The ordering rule that makes this work is *measure first, then lay out*.
 * OpenMontage's `video_compose` trusts the timeline in the artifact; here the
 * script's `start_seconds` / `end_seconds` are treated as intent only, and the
 * real timeline is built from what ffprobe reports about each narration file.
 * TTS output is never the length the writer guessed, and every downstream
 * artifact — subtitles above all — has to agree with the audio that shipped.
 *
 * Pipeline per render:
 *   1. probe every narration clip
 *   2. pad each one to its section's on-screen length      -> work/audio-NNN.wav
 *   3. concat those into a single narration bed            -> work/narration.wav
 *   4. turn each still into a clip of the same length      -> work/video-NNN.mp4
 *   5. concat the clips (stream copy, uniform encode)      -> work/video.mp4
 *   6. mux bed + clips, optionally burning subtitles       -> output/<id>.mp4
 *
 * Segments are normalised to one codec, size, pixel format, SAR and frame rate
 * so step 5 can stream-copy. A mismatch there is what produces non-monotonous
 * DTS and silently corrupt output.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

import type { Config } from './config.js'
import type { AssetManifest, AssetRecord, RenderOutput, RenderReport, Script, ScriptSection } from './schema.js'
import type { Playbook } from './playbooks.js'
import type { Cut, CutSection } from './cuts.js'
import { resolveVideoProfile } from './media-profile.js'
import {
  type MusicSettings,
  loudnessFor, loudnormAnalyseArgs, loudnormFilter, musicMixFilter, parseLoudnorm,
} from './audio-mix.js'
import { type SubtitleBackground, renderAss } from './subtitle-style.js'
import { type ProjectLayout, ensureDir, pathExists, resolveInProject, toProjectRelative } from './project.js'
import { type SubtitleCue, cuesForSection, renderSrt } from './subtitle.js'

export class ComposeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComposeError'
  }
}

/* ------------------------------------------------------------ process glue */

interface RunResult {
  stdout: string
  stderr: string
}

function run(command: string, args: string[], signal: AbortSignal, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    try {
      child = spawn(command, args, { signal, windowsHide: true })
    } catch (error) {
      rejectPromise(new ComposeError('cannot start ' + command + ': ' + (error as Error).message))
      return
    }

    let stdout = ''
    let stderr = ''
    // Bounded: ffmpeg writes a progress line per frame and a long render would
    // otherwise hold megabytes of it in memory for no benefit.
    const cap = 64 * 1024
    child.stdout?.setEncoding('utf-8')
    child.stderr?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < cap) stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-cap)
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectPromise(new ComposeError(command + ' timed out after ' + Math.round(timeoutMs / 1000) + 's'))
    }, timeoutMs)

    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (error.code === 'ENOENT') {
        rejectPromise(new ComposeError(
          'cannot find ' + JSON.stringify(command)
          + ' on PATH — install FFmpeg or set ffmpegPath/ffprobePath in the plugin config',
        ))
        return
      }
      if (error.name === 'AbortError') {
        rejectPromise(new ComposeError(command + ' was cancelled'))
        return
      }
      rejectPromise(new ComposeError(command + ' failed to run: ' + error.message))
    })

    child.on('close', (code: number | null) => {
      clearTimeout(timer)
      if (code === 0) {
        resolvePromise({ stdout, stderr })
        return
      }
      const tail = stderr.trim().split('\n').slice(-12).join('\n')
      rejectPromise(new ComposeError(
        command + ' exited with code ' + code + '\n' + args.join(' ') + '\n--- stderr ---\n' + tail,
      ))
    })
  })
}

const PROBE_TIMEOUT_MS = 30_000

/** Media duration in seconds, or undefined when the file has no readable one. */
export async function probeDuration(ffprobePath: string, file: string, signal?: AbortSignal): Promise<number | undefined> {
  const controller = signal === undefined ? new AbortController() : undefined
  const effective = signal ?? controller!.signal
  let result: RunResult
  try {
    result = await run(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ], effective, PROBE_TIMEOUT_MS)
  } catch {
    return undefined
  }
  const value = Number.parseFloat(result.stdout.trim())
  return Number.isFinite(value) && value > 0 ? value : undefined
}

interface StreamInfo {
  width?: number
  height?: number
  duration?: number
}

async function probeVideoStream(ffprobePath: string, file: string, signal: AbortSignal): Promise<StreamInfo> {
  try {
    const result = await run(ffprobePath, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'default=noprint_wrappers=1',
      file,
    ], signal, PROBE_TIMEOUT_MS)
    const info: StreamInfo = {}
    for (const line of result.stdout.split(/\r?\n/)) {
      const [key, raw] = line.split('=')
      if (raw === undefined) continue
      const value = Number.parseFloat(raw)
      if (!Number.isFinite(value)) continue
      if (key === 'width') info.width = value
      else if (key === 'height') info.height = value
      else if (key === 'duration') info.duration = value
    }
    return info
  } catch {
    return {}
  }
}

/* ------------------------------------------------------------ the timeline */

export interface SectionTiming {
  sectionId: string
  label: string
  /** Section start on the master timeline. */
  start: number
  /** Total on-screen time, narration plus its lead-in and tail. */
  duration: number
  /** Silence held before this section's narration, after style and cues. */
  lead: number
  /** Where the narration itself starts and ends inside the section. */
  speechStart: number
  speechEnd: number
  narrationPath: string
  /** Seconds skipped at the head of the clip. */
  trimStart: number
  /** The pictures carrying this section, in order, already sliced. */
  shots: ShotTiming[]
  text: string
}

/**
 * One picture's slice of its section.
 *
 * A section's length is decided by its narration and cannot move; what a shot
 * chooses is how that fixed time is divided. So a shot carries a share, not a
 * duration — and the shares are normalised against whatever else is in the
 * section, which is what makes "add a shot here" a safe edit: it splits time
 * that was already spoken for instead of stretching the film.
 */
export interface ShotTiming {
  index: number
  /** Absolute position on the master timeline. */
  start: number
  duration: number
  visualPath: string
  visualIsVideo: boolean
}

function pickAsset(assets: readonly AssetRecord[], sectionId: string, types: readonly string[]): AssetRecord | undefined {
  return assets.find((asset) => asset.scene_id === sectionId && types.includes(asset.type))
}

/**
 * A section's shots in screen order.
 *
 * `shot_index` is the authored order; ties and absent indexes fall back to the
 * order the manifest lists them, which is the order they were generated. A
 * manifest written before shots existed has neither, and reads as one shot —
 * so an old project composes exactly as it did.
 */
function shotsOf(assets: readonly AssetRecord[], sectionId: string): AssetRecord[] {
  return assets
    .filter((asset) => asset.scene_id === sectionId && (asset.type === 'image' || asset.type === 'video'))
    .map((asset, order) => ({ asset, order }))
    .sort((a, b) => (a.asset.shot_index ?? a.order) - (b.asset.shot_index ?? b.order) || a.order - b.order)
    .map((entry) => entry.asset)
}

/**
 * Divide a section's fixed span among its shots, by weight.
 *
 * The last shot absorbs the rounding remainder rather than each shot rounding
 * independently: shots are concatenated, so a few milliseconds lost per shot
 * would accumulate into visible drift against the narration underneath.
 */
function sliceShots(
  layout: ProjectLayout,
  shots: readonly AssetRecord[],
  start: number,
  span: number,
): ShotTiming[] {
  const weights = shots.map((shot) => (shot.weight !== undefined && shot.weight > 0 ? shot.weight : 1))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const timings: ShotTiming[] = []
  let cursor = start
  shots.forEach((shot, index) => {
    const last = index === shots.length - 1
    const duration = last ? start + span - cursor : (span * weights[index]!) / total
    timings.push({
      index,
      start: cursor,
      duration,
      visualPath: resolveInProject(layout, shot.path),
      visualIsVideo: shot.type === 'video',
    })
    cursor += duration
  })
  return timings
}

/**
 * The timeline as *planned*, without touching the filesystem.
 *
 * The panel needs to show how long each shot will be on screen, and that
 * number comes from the narration's measured length plus the style's padding —
 * the same arithmetic the renderer does. Exposing it here rather than letting
 * the browser reimplement it is the point: two copies of a pacing rule drift,
 * and the copy the film is cut from would be the other one.
 *
 * Durations come from the manifest, where `openreel_stage` already wrote what
 * ffprobe measured, so this is a projection of recorded fact rather than an
 * estimate.
 */
/**
 * The editor's overrides for one section, if a cut is in play.
 *
 * A cut records only what was changed, so everything it does not mention falls
 * through to the plan — which is what lets a re-generated take flow into an
 * existing cut instead of stranding it.
 */
function cutFor(cut: Cut | undefined, sectionId: string): CutSection | undefined {
  return cut?.sections.find((section) => section.id === sectionId)
}

/**
 * Order and weight a section's shots, honouring the cut when it names them.
 *
 * Ids the cut lists but the manifest no longer has are skipped, and shots the
 * cut never mentioned are appended in manifest order — so re-generating one
 * picture never silently drops the rest of the edit.
 */
/**
 * The span the cues occupy: the speech window, inset by the editor's own
 * subtitle pads. Clamped so the two insets can never meet and leave no room.
 */
function cueWindow(
  speechStart: number,
  speech: number,
  override: CutSection | undefined,
): [number, number] {
  const room = Math.max(0.1, speech)
  const lead = Math.min(override?.cueLead ?? 0, room * 0.45)
  const tail = Math.min(override?.cueTail ?? 0, room * 0.45)
  return [speechStart + lead, speechStart + speech - tail]
}

function orderShots(shots: readonly AssetRecord[], override: CutSection | undefined): AssetRecord[] {
  if (override?.shots === undefined) return [...shots]
  const byId = new Map(shots.map((shot) => [shot.id, shot]))
  const ordered: AssetRecord[] = []
  for (const entry of override.shots) {
    const shot = byId.get(entry.assetId)
    if (shot === undefined) continue
    byId.delete(entry.assetId)
    ordered.push(entry.weight === undefined ? shot : { ...shot, weight: entry.weight })
  }
  for (const shot of shots) if (byId.has(shot.id)) ordered.push(shot)
  return ordered
}

export function planSections(
  script: Script,
  manifest: AssetManifest,
  playbook: Playbook,
  cut?: Cut,
): Array<{
  sectionId: string
  label: string
  start: number
  duration: number
  speechSeconds: number
  /** Silence before the speech, so a preview can place the clip exactly. */
  lead: number
  /** Seconds skipped at the head of the clip, so a preview skips them too. */
  trimStart: number
  narrationPath?: string
  text: string
  shots: Array<{
    index: number; assetId?: string; path?: string
    start: number; duration: number; weight: number
  }>
  /** Cues as they will be written, from the same function that writes them. */
  cues: Array<{ start: number; end: number; text: string }>
}> {
  const plan = []
  let cursor = 0
  for (const section of script.sections) {
    const narration = pickAsset(manifest.assets, section.id, ['narration', 'audio'])
    const override = cutFor(cut, section.id)
    // Trim comes off the clip before anything else: the pads sit around what
    // is left, not around what was recorded.
    const speech = Math.max(0.05, (narration?.duration_seconds ?? 0)
      - (override?.trimStart ?? 0) - (override?.trimEnd ?? 0))
    const lead = override?.lead
      ?? section.delivery_cues?.pause_before_seconds ?? playbook.pacing.padBeforeSeconds
    const tail = override?.tail
      ?? section.delivery_cues?.pause_after_seconds ?? playbook.pacing.padAfterSeconds
    // The style's floor is a PLANNING default. Once an editor has set a pad
    // explicitly it must win outright — a floor that silently puts back the
    // pause someone just set to zero makes the control look broken, which is
    // exactly how it looked.
    const edited = override?.lead !== undefined || override?.tail !== undefined
    const duration = edited
      ? lead + speech + tail
      : Math.max(lead + speech + tail, playbook.pacing.minSectionSeconds)

    const shots = orderShots(shotsOf(manifest.assets, section.id), override)
    const weights = shots.map((shot) => (shot.weight !== undefined && shot.weight > 0 ? shot.weight : 1))
    const total = weights.reduce((sum, weight) => sum + weight, 0) || 1
    let inner = cursor
    const laid = shots.map((shot, index) => {
      const last = index === shots.length - 1
      const span = last ? cursor + duration - inner : (duration * weights[index]!) / total
      const entry = {
        index,
        assetId: shot.id,
        path: shot.path,
        start: Number(inner.toFixed(3)),
        duration: Number(span.toFixed(3)),
        weight: weights[index]!,
      }
      inner += span
      return entry
    })

    // Cues come from the same function the renderer uses, over the same
    // timings — so the lane the panel draws and the file that ships cannot
    // describe different subtitles.
    const speechStart = cursor + lead
    const cues = cuesForSection(...cueWindow(speechStart, speech, override), subtitleText(section),
      playbook.subtitleMaxChars, override?.cues)
      .map((cue) => ({
        start: Number(cue.start.toFixed(3)),
        end: Number(cue.end.toFixed(3)),
        text: cue.text,
      }))

    plan.push({
      sectionId: section.id,
      label: section.label ?? section.id,
      start: Number(cursor.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      speechSeconds: Number(speech.toFixed(3)),
      lead: Number(lead.toFixed(3)),
      trimStart: Number((override?.trimStart ?? 0).toFixed(3)),
      ...(narration?.path === undefined ? {} : { narrationPath: narration.path }),
      text: subtitleText(section),
      cues,
      // A section with no pictures yet still occupies its span; the panel
      // shows it as one empty slot rather than pretending it does not exist.
      shots: laid.length > 0 ? laid : [{ index: 0, start: Number(cursor.toFixed(3)), duration: Number(duration.toFixed(3)), weight: 1 }],
    })
    cursor += duration
  }
  return plan
}

function buildTimeline(
  layout: ProjectLayout,
  script: Script,
  manifest: AssetManifest,
  durations: ReadonlyMap<string, number>,
  playbook: Playbook,
  cut: Cut | undefined,
): SectionTiming[] {
  const timings: SectionTiming[] = []
  let cursor = 0

  for (const section of script.sections) {
    const narration = pickAsset(manifest.assets, section.id, ['narration', 'audio'])
    const override = cutFor(cut, section.id)
    const shots = orderShots(shotsOf(manifest.assets, section.id), override)
    if (narration === undefined) throw new ComposeError('section ' + section.id + ' has no narration asset')
    if (shots.length === 0) throw new ComposeError('section ' + section.id + ' has no image or video asset')

    const recorded = durations.get(narration.id)
    const speechLength = recorded === undefined
      ? undefined
      : Math.max(0.05, recorded - (override?.trimStart ?? 0) - (override?.trimEnd ?? 0))
    if (speechLength === undefined) {
      throw new ComposeError('could not measure the duration of narration asset ' + narration.id + ' (' + narration.path + ')')
    }

    // The style sets the default breathing room; a section may widen it through
    // its own delivery cues, which is how a writer marks a beat before a
    // reversal without slowing the whole film down.
    // The cut wins over the script's cues, which win over the style. Each
    // layer is a more specific decision than the one under it, and the cut is
    // the only one made while watching the film.
    const lead = override?.lead
      ?? section.delivery_cues?.pause_before_seconds ?? playbook.pacing.padBeforeSeconds
    const tail = override?.tail
      ?? section.delivery_cues?.pause_after_seconds ?? playbook.pacing.padAfterSeconds
    const natural = lead + speechLength + tail
    // Same rule as the plan: an explicit pad in the cut is not floored.
    const duration = (override?.lead !== undefined || override?.tail !== undefined)
      ? natural
      : Math.max(natural, playbook.pacing.minSectionSeconds)

    timings.push({
      sectionId: section.id,
      label: section.label ?? section.id,
      start: cursor,
      duration,
      lead,
      speechStart: cursor + lead,
      speechEnd: cursor + lead + speechLength,
      narrationPath: resolveInProject(layout, narration.path),
      trimStart: override?.trimStart ?? 0,
      shots: sliceShots(layout, shots, cursor, duration),
      text: subtitleText(section),
    })
    cursor += duration
  }

  return timings
}

/** What the viewer should read: the spoken line, not the TTS control text. */
function subtitleText(section: ScriptSection): string {
  return section.text
}

/* ------------------------------------------------------------------ filters */

function geometry(fit: Playbook['fit'], width: number, height: number): string[] {
  if (fit === 'cover') {
    return [
      'scale=' + width + ':' + height + ':force_original_aspect_ratio=increase',
      'crop=' + width + ':' + height,
    ]
  }
  return [
    'scale=' + width + ':' + height + ':force_original_aspect_ratio=decrease',
    'pad=' + width + ':' + height + ':(ow-iw)/2:(oh-ih)/2:color=black',
  ]
}

/**
 * A still held for several seconds reads as a dead frame, so it gets a slow
 * linear push-in. The source is first fitted to twice the output size: zooming
 * a frame that is already at output resolution resamples upward and shimmers.
 */
function stillFilter(config: RenderConfig, playbook: Playbook, frames: number): string {
  const { width, height, fps } = config.video
  if (!playbook.kenBurns) {
    return [...geometry(playbook.fit, width, height), 'setsar=1', 'fps=' + fps, 'format=yuv420p'].join(',')
  }
  const zoomEnd = 1.10
  const step = (zoomEnd - 1) / Math.max(1, frames)
  return [
    ...geometry(playbook.fit, width * 2, height * 2),
    "zoompan=z='min(1+" + step.toFixed(6) + "*on," + zoomEnd + ")'"
      + ":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
      + ':d=1:s=' + width + 'x' + height + ':fps=' + fps,
    'setsar=1',
    'format=yuv420p',
  ].join(',')
}

/** FFmpeg filter arguments need drive letters and separators escaped twice. */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/* -------------------------------------------------------------------- render */

export interface ComposeOptions {
  layout: ProjectLayout
  script: Script
  manifest: AssetManifest
  config: Config
  /** Owns pacing, Ken Burns, fit and subtitle width. */
  playbook: Playbook
  /**
   * `brief.target_platform`. A named platform fixes the output frame; absent
   * or `generic` leaves it to the configured default.
   */
  targetPlatform?: string | undefined
  /**
   * Bake the subtitles into the picture for this render. Defaults to the
   * configured setting; the compose screen overrides it per export.
   */
  burnSubtitles?: boolean | undefined
  /** `outline` keeps the picture visible; `box` guarantees contrast. */
  subtitleBackground?: SubtitleBackground | undefined
  /**
   * Project-relative path of the background music bed, when the project has
   * one. Looped and cut to the film's length, ducked under the narration.
   */
  musicPath?: string | undefined
  /** The project's level and fade overrides. Absent fields take the spec. */
  musicSettings?: MusicSettings | undefined
  /** The editor's version, when one is being rendered. */
  cut?: Cut | undefined
  signal: AbortSignal
  onProgress?(update: RenderProgress): void
}

export type RenderPhase =
  | 'probing' | 'narration' | 'shots' | 'joining' | 'music' | 'loudness' | 'muxing' | 'done'

export interface RenderProgress {
  phase: RenderPhase
  /** 0..1 through the whole render. Monotonic. */
  fraction: number
  /** One line for a person, already in their language. */
  label: string
}

/**
 * How much of the wall clock each phase gets on the bar.
 *
 * ONLY THE SHOTS PHASE IS REALLY MEASURED — it reports i/n and that is where
 * most of the time goes. The rest are fixed spans taken from watching real
 * renders, so the bar is an estimate that never goes backwards rather than a
 * true percentage. Burning subtitles re-encodes the whole video in the mux,
 * which is the one case that makes the tail longer than its span suggests; the
 * label says what is happening, which is what a person actually needs when a
 * bar sits still.
 */
const PHASE_SPAN: Record<RenderPhase, { from: number; to: number }> = {
  probing: { from: 0, to: 0.04 },
  narration: { from: 0.04, to: 0.10 },
  shots: { from: 0.10, to: 0.70 },
  joining: { from: 0.70, to: 0.78 },
  music: { from: 0.78, to: 0.86 },
  loudness: { from: 0.86, to: 0.90 },
  muxing: { from: 0.90, to: 1 },
  done: { from: 1, to: 1 },
}

export interface ComposeResult {
  report: RenderReport
  timeline: SectionTiming[]
  /** Project-relative path of the SRT sidecar, when one was written. */
  subtitlePath: string | undefined
  warnings: string[]
}

/**
 * Config with the frame resolved onto it.
 *
 * `Config['video']` is what the USER sets; a render also needs the pixels the
 * platform and the scale worked out. Widening it here keeps every filter
 * builder reading one object instead of taking width and height as two more
 * arguments that could be passed in the wrong order.
 */
type RenderConfig = Omit<Config, 'video'> & { video: Config['video'] & { width: number; height: number } }

export async function renderProject(options: ComposeOptions): Promise<ComposeResult> {
  const { layout, script, manifest, playbook, cut, signal } = options

  // The frame is decided once, here, and then every downstream reader sees it
  // through `config.video` as before. Threading a second width/height through
  // the filter builders would leave two sources of truth for the same number,
  // and one of them would eventually be read by mistake.
  //
  // Settings no longer carry a width and a height — the platform's baseline
  // times `renderScale` is the whole answer — so the resolved pair is spliced
  // in here and the local type says so.
  const profile = resolveVideoProfile(
    options.targetPlatform, options.config.video.renderScale, options.config.video.fps)
  const config: RenderConfig = {
    ...options.config,
    video: { ...options.config.video, width: profile.width, height: profile.height, fps: profile.fps },
  }
  const startedAt = Date.now()
  const warnings: string[] = []
  const emit = options.onProgress ?? ((): void => {})
  /**
   * Emit one progress update.
   *
   * @param phase - which stage of the render this is.
   * @param label - the line a person reads, already in their language.
   * @param within - 0..1 through this phase, when the phase can say.
   */
  const notify = (phase: RenderPhase, label: string, within = 0): void => {
    const span = PHASE_SPAN[phase]
    emit({
      phase,
      label,
      fraction: Math.min(1, Math.max(0, span.from + (span.to - span.from) * Math.min(1, Math.max(0, within)))),
    })
  }
  const { ffmpegPath, ffprobePath } = config
  const stepTimeout = config.renderTimeoutMs

  // A stale work directory would let a previous run's segments sneak into the
  // concat list, so it is rebuilt from empty every time.
  await fs.rm(layout.workDir, { recursive: true, force: true })
  await ensureDir(layout.workDir)
  await ensureDir(layout.outputDir)

  // Each cut renders to its own file: versions exist so two edits can be
  // compared, and one overwriting the other would defeat that.
  const stem = cut === undefined ? layout.id : layout.id + '-' + cut.id

  // 1. Measure.
  notify('probing', '测量配音时长')
  const durations = new Map<string, number>()
  for (const asset of manifest.assets) {
    if (asset.type !== 'narration' && asset.type !== 'audio') continue
    const absolute = resolveInProject(layout, asset.path)
    const measured = await probeDuration(ffprobePath, absolute, signal)
    if (measured === undefined) throw new ComposeError('ffprobe could not read a duration from ' + asset.path)
    durations.set(asset.id, measured)
  }

  const timeline = buildTimeline(layout, script, manifest, durations, playbook, cut)
  const totalDuration = timeline.reduce((sum, timing) => sum + timing.duration, 0)
  notify('probing', timeline.length + ' 段 · 共 ' + totalDuration.toFixed(1) + ' 秒', 1)

  // 2. Pad each narration clip to its section length.
  const audioSegments: string[] = []
  for (const [index, timing] of timeline.entries()) {
    const target = join(layout.workDir, 'audio-' + String(index).padStart(3, '0') + '.wav')
    const leadMs = Math.round(timing.lead * 1000)
    const filters = ['aresample=48000', 'aformat=sample_fmts=s16:channel_layouts=stereo']
    if (leadMs > 0) filters.unshift('adelay=' + leadMs + ':all=1')
    filters.push('apad')
    await run(ffmpegPath, [
      '-y', '-nostdin',
      // `-ss` before `-i` seeks the input, so the trimmed head is never decoded.
      ...(timing.trimStart > 0 ? ['-ss', timing.trimStart.toFixed(3)] : []),
      '-i', timing.narrationPath,
      '-af', filters.join(','),
      '-t', timing.duration.toFixed(3),
      '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le',
      target,
    ], signal, stepTimeout)
    audioSegments.push(target)
  }

  // 3. One narration bed.
  notify('narration', '拼接配音轨')
  const narrationBed = join(layout.workDir, 'narration.wav')
  await concatSegments(ffmpegPath, layout.workDir, 'audio-list.txt', audioSegments, narrationBed, signal, stepTimeout)

  // 4. One clip per SHOT, all normalised to the same encode. A section with a
  //    single shot produces exactly one, so this is the old behaviour plus the
  //    ability to cut within a section.
  const videoSegments: string[] = []
  const allShots = timeline.flatMap((timing) => timing.shots.map((shot) => ({ shot, timing })))
  for (const [index, { shot, timing }] of allShots.entries()) {
    const within = timing.shots.length > 1 ? ' 分镜 ' + (shot.index + 1) + '/' + timing.shots.length : ''
    notify('shots', '渲染分镜 ' + (index + 1) + '/' + allShots.length + '　' + timing.label + within,
      index / allShots.length)
    const target = join(layout.workDir, 'video-' + String(index).padStart(3, '0') + '.mp4')
    const frames = Math.max(1, Math.round(shot.duration * config.video.fps))
    const args = ['-y', '-nostdin']
    if (shot.visualIsVideo) {
      // Loop a short clip rather than freeze on its last frame.
      args.push('-stream_loop', '-1', '-i', shot.visualPath)
    } else {
      args.push('-loop', '1', '-framerate', String(config.video.fps), '-i', shot.visualPath)
    }
    const filter = shot.visualIsVideo
      ? [...geometry(playbook.fit, config.video.width, config.video.height), 'setsar=1', 'fps=' + config.video.fps, 'format=yuv420p'].join(',')
      : stillFilter(config, playbook, frames)
    args.push(
      '-t', shot.duration.toFixed(3),
      '-vf', filter,
      '-an',
      '-c:v', config.video.codec,
      '-crf', String(config.video.crf),
      '-preset', config.video.preset,
      '-pix_fmt', 'yuv420p',
      '-r', String(config.video.fps),
      target,
    )
    await run(ffmpegPath, args, signal, stepTimeout)
    videoSegments.push(target)
  }

  notify('joining', '拼接画面')
  const videoTrack = join(layout.workDir, 'video.mp4')
  await concatSegments(ffmpegPath, layout.workDir, 'video-list.txt', videoSegments, videoTrack, signal, stepTimeout)

  // 5. Subtitles are written before the mux, because burning them in needs the
  //    file to already exist.
  const cues: SubtitleCue[] = []
  for (const timing of timeline) {
    const sectionCut = cutFor(cut, timing.sectionId)
    cues.push(...cuesForSection(
      ...cueWindow(timing.speechStart, timing.speechEnd - timing.speechStart, sectionCut),
      timing.text, playbook.subtitleMaxChars, sectionCut?.cues))
  }
  let subtitleRelative: string | undefined
  let subtitleAbsolute: string | undefined
  if (config.writeSubtitles && cues.length > 0) {
    subtitleAbsolute = join(layout.outputDir, stem + '.srt')
    await fs.writeFile(subtitleAbsolute, renderSrt(cues), 'utf-8')
    subtitleRelative = toProjectRelative(layout, subtitleAbsolute)
  }

  // Per render, not per install: whether this cut needs subtitles baked in is a
  // decision about where it is going, and that changes between exports of the
  // same project. The setting stays as the default.
  // Defaults to OFF when nobody said, and there is no setting behind it any
  // more. Burn-in is per export, not per install — the same cut goes to a
  // platform that plays a sidecar .srt and to one that does not. The panel
  // states it on every render and `openreel_compose` takes it as an argument,
  // so the only case this default covers is a caller that mentioned neither,
  // where the sidecar is the reversible choice: burning is a re-encode.
  const burning = (options.burnSubtitles ?? false) && cues.length > 0

  // Burning reads an ASS we write, never the SRT.
  //
  // ASS sizes are units in the script's own coordinate space, and libass falls
  // back to 384x288 when the file declares none — which an SRT never does. A
  // `force_style` asking for 46px therefore rendered at 46 * 1080/288, roughly
  // 172px, and MarginV was wrong by the same factor: three huge lines across
  // the middle of the frame. Declaring PlayRes ourselves makes every number a
  // real pixel. The .srt is still written, still shipped, still the portable
  // one — it just is not what gets burned.
  let burnAbsolute: string | undefined
  if (burning) {
    burnAbsolute = join(layout.workDir, stem + '.ass')
    await fs.writeFile(burnAbsolute, renderAss(cues, {
      width: config.video.width,
      height: config.video.height,
      ...(options.subtitleBackground === undefined ? {} : { background: options.subtitleBackground }),
      ...(config.subtitleFont.trim() === '' ? {} : { fontName: config.subtitleFont.trim() }),
    }), 'utf-8')
  }

  // 6. The music bed, when the project has one.
  //
  // Looped rather than padded with silence: a bed that stops two thirds of the
  // way through sounds like a fault, and the skill tells the model to ask for
  // one at least as long as the film precisely so the loop point is rare.
  let musicAbsolute: string | undefined
  if (options.musicPath !== undefined && options.musicPath.trim() !== '') {
    musicAbsolute = resolveInProject(layout, options.musicPath.trim())
    if (!(await pathExists(musicAbsolute))) {
      throw new ComposeError(
        'the project names a music bed at ' + options.musicPath
        + ' but the file is not there. Re-import it, or clear the music track on the compose screen.',
      )
    }
    const musicSeconds = await probeDuration(ffprobePath, musicAbsolute, signal)
    if (musicSeconds !== undefined && musicSeconds + 0.5 < totalDuration) {
      // Not fatal — it loops — but the seam is audible, and this is the only
      // place that knows both numbers.
      warnings.push(
        'the music bed is ' + musicSeconds.toFixed(1) + 's and the film is '
        + totalDuration.toFixed(1) + 's, so it loops ' + Math.ceil(totalDuration / musicSeconds)
        + ' times; a longer track would avoid the seam',
      )
    }
  }

  // 7. Mix the bed under the narration, and measure the result.
  //
  // A separate ffmpeg run rather than one graph inside the mux, because the
  // loudness pass needs a finished mix to measure — see `audio-mix.ts` for why
  // it must be measured rather than normalised on the fly.
  const loudness = loudnessFor(options.targetPlatform)
  let audioTrack = narrationBed
  let audioFilter: string | undefined
  if (musicAbsolute !== undefined) {
    notify('music', '混入配乐')
    const mixed = join(layout.workDir, 'mix.wav')
    await run(ffmpegPath, [
      '-y', '-nostdin',
      '-i', narrationBed,
      '-stream_loop', '-1', '-i', musicAbsolute,
      '-filter_complex', musicMixFilter({
        totalSeconds: totalDuration,
        loudness,
        // Input 0 is the narration here; in the mux it was input 1. Passing the
        // indices in rather than hard-coding them is what lets the same graph
        // serve both without a second copy that drifts.
        voiceInput: 0,
        musicInput: 1,
        ...(options.musicSettings === undefined ? {} : { settings: options.musicSettings }),
      }),
      '-map', '[out]',
      '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le',
      mixed,
    ], signal, stepTimeout)
    audioTrack = mixed

    notify('loudness', '测量响度')
    const analysis = await run(ffmpegPath, loudnormAnalyseArgs(mixed, loudness), signal, stepTimeout)
    const measured = parseLoudnorm(analysis.stderr)
    if (measured === undefined) {
      // The mix is still correct; only the target is missed. Said out loud
      // because a film a few dB off is something the user can act on, and
      // guessing at it silently is what we are refusing to do.
      warnings.push('could not measure the mix loudness, so it was only peak-limited, not normalised')
    }
    audioFilter = loudnormFilter(loudness, measured)
  }

  // 8. Mux. Stream-copy the video unless subtitles have to be burned in.
  notify('muxing', burning ? '封装并烧录字幕（要重新编码，这一步最久）' : '封装成片')
  const outputAbsolute = join(layout.outputDir, stem + '.mp4')
  const muxArgs = ['-y', '-nostdin', '-i', videoTrack, '-i', audioTrack]
  // Per render, not per install: whether this cut needs subtitles baked in is a
  // decision about where it is going, and that changes between exports of the
  // same project. The setting stays as the default.
  if (burning && burnAbsolute !== undefined) {
    muxArgs.push(
      '-vf', "subtitles='" + escapeFilterPath(burnAbsolute) + "'",
      '-c:v', config.video.codec,
      '-crf', String(config.video.crf),
      '-preset', config.video.preset,
      '-pix_fmt', 'yuv420p',
    )
  } else {
    muxArgs.push('-c:v', 'copy')
  }
  muxArgs.push('-map', '0:v:0', '-map', '1:a:0')
  // Normalisation runs ONLY on the music path. A narration-only render already
  // sits at whatever level the TTS produced, and moving every existing
  // project's audio to a new target is a separate change with its own risk.
  // Adding a second source is what makes the level uncertain, so that is where
  // it starts.
  if (audioFilter !== undefined) muxArgs.push('-af', audioFilter)
  muxArgs.push(
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-shortest',
    outputAbsolute,
  )
  try {
    await run(ffmpegPath, muxArgs, signal, stepTimeout)
  } catch (error) {
    if (burning) {
      // Burning depends on libass and a usable font for the script being
      // rendered; on a fresh Windows host that is the likeliest failure here.
      throw new ComposeError(
        (error as Error).message
        + '\nSubtitle burn-in failed. Set burnSubtitles to false to keep the .srt as a sidecar instead.',
      )
    }
    throw error
  }

  // 9. Report what the file actually is, not what was asked for.
  const info = await probeVideoStream(ffprobePath, outputAbsolute, signal)
  const stat = await fs.stat(outputAbsolute)
  const measuredDuration = info.duration ?? totalDuration
  if (Math.abs(measuredDuration - totalDuration) > 0.5) {
    warnings.push(
      'planned ' + totalDuration.toFixed(2) + 's but the render measures '
      + measuredDuration.toFixed(2) + 's',
    )
  }

  const output: RenderOutput = {
    path: toProjectRelative(layout, outputAbsolute),
    format: 'mp4',
    resolution: (info.width ?? config.video.width) + 'x' + (info.height ?? config.video.height),
    duration_seconds: Number(measuredDuration.toFixed(3)),
    codec: config.video.codec,
    audio_codec: 'aac',
    fps: config.video.fps,
    file_size_bytes: stat.size,
  }

  const report: RenderReport = {
    version: '1.0',
    outputs: [output],
    render_time_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    ...(warnings.length > 0 ? { warnings } : {}),
    metadata: {
      title: script.title,
      sections: timeline.length,
      subtitles: subtitleRelative ?? null,
      subtitles_burned: burning,
      music: musicAbsolute === undefined ? null : toProjectRelative(layout, musicAbsolute),
      style: playbook.name,
      ken_burns: playbook.kenBurns,
      fit: playbook.fit,
    },
  }

  // The work directory is scratch; keeping it would double the project's size
  // for every render.
  await fs.rm(layout.workDir, { recursive: true, force: true })

  return { report, timeline, subtitlePath: subtitleRelative, warnings }
}

/**
 * Join same-encoding segments with the concat demuxer. Paths go in absolute
 * with forward slashes: the demuxer resolves relative entries against the list
 * file, and a backslash inside a quoted entry is an escape character.
 */
async function concatSegments(
  ffmpegPath: string,
  workDir: string,
  listName: string,
  segments: readonly string[],
  target: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  if (segments.length === 0) throw new ComposeError('nothing to concatenate')
  const listPath = join(workDir, listName)
  const body = segments
    .map((segment) => "file '" + segment.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'")
    .join('\n') + '\n'
  await fs.writeFile(listPath, body, 'utf-8')
  await run(ffmpegPath, [
    '-y', '-nostdin',
    '-f', 'concat', '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    target,
  ], signal, timeoutMs)
}

/**
 * Local playback of a timeline that has not been rendered yet.
 *
 * The compose screen exists so a person can hear whether a pause works and see
 * whether a cut lands — and that judgement is worthless if reaching it costs a
 * multi-minute ffmpeg run each time. Everything needed is already in the
 * browser: the narration clips, the stills, and the exact timings the renderer
 * will use. So the preview *is* the edit loop, and the render is what happens
 * once the edit is right.
 *
 * The clock is `performance.now()`, not any one audio element. Sections are
 * separate files with silence between them, so no single element spans the
 * film; using one as the clock would make every gap drift. Each clip is
 * scheduled against the shared clock and corrected if it lands late.
 */

export interface PreviewSection {
  sectionId: string
  start: number
  duration: number
  speechSeconds: number
  /** Silence before the speech, published by the host rather than guessed. */
  lead: number
  /** Seconds skipped at the head of the clip, so the preview skips them too. */
  trimStart: number
  /** Project-relative narration path; a section without one plays as silence. */
  narrationPath?: string
}

export interface PreviewOptions {
  projectId: string
  sections: readonly PreviewSection[]
  /** Project-relative music bed. Looped under the whole film, ducked under speech. */
  musicPath?: string | undefined
  /** Called on every animation frame with the current position. */
  onTick: (seconds: number) => void
  onEnd: () => void
}

/** Drift beyond this and the clip is nudged back onto the clock. */
const SYNC_TOLERANCE = 0.25

/**
 * The bed's two levels, as linear gain rather than decibels because that is
 * what `HTMLMediaElement.volume` takes.
 *
 * These are the render's own numbers converted: MIX.bedDb is -20 dB, which is
 * 10^(-20/20) = 0.1, and the sidechain takes it about 8 dB further down during
 * speech, 10^(-28/20) = 0.04. The preview exists to judge whether a pause works
 * and whether a cut lands, and it cannot answer that if the music sits at a
 * level the render will never produce.
 *
 * The duck is done by switching this element's gain rather than with a real
 * compressor: the preview already knows exactly which frames have speech in
 * them — it schedules them — so the one thing a sidechain would have to detect
 * is here for free, and a WebAudio graph would buy nothing but latency.
 */
const BED_GAIN = 0.1
const BED_GAIN_DUCKED = 0.04
/** Per-frame approach toward the target gain, so the duck is not a click. */
const DUCK_GLIDE = 0.12

export class Preview {
  private readonly audio = new Map<string, HTMLAudioElement>()
  /** Sections whose clip this run has already told to start. */
  private readonly started = new Set<string>()
  private raf: number | undefined
  /** Wall-clock time that corresponds to position 0. */
  private origin = 0
  private position = 0
  private running = false

  /** The bed, when the project has one. One element for the whole film. */
  private readonly music: HTMLAudioElement | undefined

  /**
   * Written out rather than declared as a constructor parameter property.
   *
   * That shorthand is one of the few TypeScript forms Node's type stripping
   * cannot handle, and it was the only thing keeping this module out of the
   * test run — a class with no React and no DOM beyond two audio elements,
   * which is exactly the kind of thing that should be tested directly.
   */
  private readonly options: PreviewOptions

  constructor(options: PreviewOptions) {
    this.options = options
    const mediaUrl = (path: string): string =>
      '/studio/media?project=' + encodeURIComponent(options.projectId)
      + '&path=' + encodeURIComponent(path)

    for (const section of options.sections) {
      if (section.narrationPath === undefined) continue
      const element = new Audio(mediaUrl(section.narrationPath))
      element.preload = 'auto'
      this.audio.set(section.sectionId, element)
    }

    if (options.musicPath !== undefined && options.musicPath !== '') {
      const bed = new Audio(mediaUrl(options.musicPath))
      bed.preload = 'auto'
      // The render loops a short bed to fill the film, so the preview must too
      // — otherwise a two-minute cut goes silent halfway through a check the
      // finished file would pass.
      bed.loop = true
      bed.volume = BED_GAIN
      this.music = bed
    }
  }

  get isPlaying(): boolean {
    return this.running
  }

  /**
   * Put the looping bed at the film position, and start or stop it.
   *
   * The bed is one continuous element, so unlike a narration clip it is not
   * re-armed per section — only re-aimed. Its own time is the film position
   * folded into the track's length, which is exactly what the render's
   * `-stream_loop` produces.
   */
  private aimMusic(at: number, playing: boolean): void {
    const bed = this.music
    if (bed === undefined) return
    if (!playing) {
      bed.pause()
      return
    }
    // `duration` is NaN until metadata arrives. Starting at 0 for the first
    // moments is right anyway, and the drift correction in `tick` picks it up
    // once the number exists.
    const length = bed.duration
    const want = Number.isFinite(length) && length > 0 ? at % length : at
    bed.currentTime = Math.max(0, want)
    void bed.play().catch(() => {})
  }

  play(from = this.position): void {
    // A fresh run re-arms every clip; whatever was playing belonged to the
    // previous position.
    this.started.clear()
    this.position = from
    this.origin = performance.now() / 1000 - from
    this.running = true
    this.aimMusic(from, true)
    this.tick()
  }

  pause(): void {
    this.running = false
    if (this.raf !== undefined) cancelAnimationFrame(this.raf)
    this.raf = undefined
    for (const element of this.audio.values()) element.pause()
    this.music?.pause()
    this.started.clear()
  }

  seek(seconds: number): void {
    this.position = Math.max(0, seconds)
    if (this.running) this.play(this.position)
    else {
      for (const element of this.audio.values()) element.pause()
      this.aimMusic(this.position, false)
      this.options.onTick(this.position)
    }
  }

  dispose(): void {
    this.pause()
    for (const element of this.audio.values()) element.src = ''
    this.audio.clear()
    if (this.music !== undefined) this.music.src = ''
  }

  /** Glide the bed toward the level this frame calls for. */
  private duck(speaking: boolean): void {
    const bed = this.music
    if (bed === undefined) return
    const target = speaking ? BED_GAIN_DUCKED : BED_GAIN
    const next = bed.volume + (target - bed.volume) * DUCK_GLIDE
    // Snapping the last sliver avoids an asymptote that never arrives and
    // keeps writing to the element on every frame forever.
    bed.volume = Math.abs(next - target) < 0.002 ? target : Math.min(1, Math.max(0, next))
  }

  private tick = (): void => {
    if (!this.running) return
    const now = performance.now() / 1000 - this.origin
    this.position = now
    const total = this.options.sections.reduce((sum, section) => sum + section.duration, 0)
    if (now >= total) {
      this.pause()
      this.position = total
      this.options.onTick(total)
      this.options.onEnd()
      return
    }

    let speaking = false
    for (const section of this.options.sections) {
      // Speech sits inside the section, after its lead-in; the rest is silence.
      const speechStart = section.start + section.lead
      const speechEnd = speechStart + section.speechSeconds
      const inside = now >= speechStart && now < speechEnd
      // Tracked over EVERY section, including ones with no clip: a section
      // whose narration failed to generate is still speech time in the
      // timeline, and the render will duck under it.
      if (inside) speaking = true

      const element = this.audio.get(section.sectionId)
      if (element === undefined) continue

      if (!inside) {
        if (this.started.has(section.sectionId)) {
          element.pause()
          this.started.delete(section.sectionId)
        }
        continue
      }

      // The clip is played from its trim point, so the preview hears exactly
      // what the render will cut.
      const want = now - speechStart + section.trimStart
      // `started` tracks INTENT, not the element's own `paused` flag.
      // `play()` resolves asynchronously and the element reads as paused the
      // whole time it is starting — keying off that re-seeks and restarts the
      // clip on every frame, so it never actually gets going.
      if (!this.started.has(section.sectionId)) {
        this.started.add(section.sectionId)
        element.currentTime = Math.max(0, want)
        void element.play().catch(() => {})
        continue
      }
      // Correct drift only once the element is genuinely settled. Seeking a
      // clip that is still buffering restarts the stall it is recovering from.
      if (element.seeking || element.readyState < 3 || element.paused) continue
      if (Math.abs(element.currentTime - want) > SYNC_TOLERANCE) {
        element.currentTime = Math.max(0, want)
      }
    }

    this.duck(speaking)

    this.options.onTick(now)
    this.raf = requestAnimationFrame(this.tick)
  }
}

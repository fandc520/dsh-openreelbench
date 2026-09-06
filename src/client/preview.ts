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
  /** Called on every animation frame with the current position. */
  onTick: (seconds: number) => void
  onEnd: () => void
}

/** Drift beyond this and the clip is nudged back onto the clock. */
const SYNC_TOLERANCE = 0.25

export class Preview {
  private readonly audio = new Map<string, HTMLAudioElement>()
  /** Sections whose clip this run has already told to start. */
  private readonly started = new Set<string>()
  private raf: number | undefined
  /** Wall-clock time that corresponds to position 0. */
  private origin = 0
  private position = 0
  private running = false

  constructor(private readonly options: PreviewOptions) {
    for (const section of options.sections) {
      if (section.narrationPath === undefined) continue
      const element = new Audio('/studio/media?project=' + encodeURIComponent(options.projectId)
        + '&path=' + encodeURIComponent(section.narrationPath))
      element.preload = 'auto'
      this.audio.set(section.sectionId, element)
    }
  }

  get isPlaying(): boolean {
    return this.running
  }

  play(from = this.position): void {
    // A fresh run re-arms every clip; whatever was playing belonged to the
    // previous position.
    this.started.clear()
    this.position = from
    this.origin = performance.now() / 1000 - from
    this.running = true
    this.tick()
  }

  pause(): void {
    this.running = false
    if (this.raf !== undefined) cancelAnimationFrame(this.raf)
    this.raf = undefined
    for (const element of this.audio.values()) element.pause()
    this.started.clear()
  }

  seek(seconds: number): void {
    this.position = Math.max(0, seconds)
    if (this.running) this.play(this.position)
    else {
      for (const element of this.audio.values()) element.pause()
      this.options.onTick(this.position)
    }
  }

  dispose(): void {
    this.pause()
    for (const element of this.audio.values()) element.src = ''
    this.audio.clear()
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

    for (const section of this.options.sections) {
      const element = this.audio.get(section.sectionId)
      if (element === undefined) continue
      // Speech sits inside the section, after its lead-in; the rest is silence.
      const speechStart = section.start + section.lead
      const speechEnd = speechStart + section.speechSeconds
      const inside = now >= speechStart && now < speechEnd

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

    this.options.onTick(now)
    this.raf = requestAnimationFrame(this.tick)
  }
}

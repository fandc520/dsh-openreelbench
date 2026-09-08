/**
 * Mixing a music bed under the narration — the levels, and the filter graph.
 *
 * Ported from OpenMontage's `skills/creative/sound-design.md`. Everything here
 * is the COUNTABLE half of that document: the numbers it states as
 * requirements rather than as taste. They live in code because a level is
 * either right or it is not, and asking a model to set one on every render
 * would make it different every time.
 *
 * The taste half — tempo, genre, instrumental-only — is the skill in
 * `skill-sound-design.ts`. Neither file repeats the other.
 *
 * WHY A SIDECHAIN AND NOT A FIXED LEVEL
 *
 * A music bed sitting at one level is either audible under speech or inaudible
 * in the gaps. W3C accessibility asks for music 20 dB below foreground speech;
 * the BBC guideline is to then drop it another 4 dB from wherever it sounds
 * right. Both are about the moment speech is present. So the bed sits at -20 dB
 * and a compressor keyed off the narration pulls it down a further ~8 dB
 * whenever anyone is talking, which is inside the 6-12 dB the source asks for.
 * Between sentences it comes back on its own.
 *
 * THE ONE THING TAKEN FROM STANDARD PRACTICE RATHER THAN THE SOURCE is the
 * compressor's attack and release. The source gives the DEPTH of the duck and
 * says nothing about its timing. 20 ms catches a word's onset without clipping
 * its front; 500 ms recovers between sentences without pumping between words.
 */

/** Levels the source states as requirements. Decibels unless named otherwise. */
export const MIX = {
  /**
   * Where the bed sits before ducking.
   *
   * W3C: music must be 20 dB below foreground speech. This is measured against
   * the narration bed as generated, which is why nothing normalises the
   * narration first — moving it would move this too.
   */
  bedDb: -20,
  /**
   * The intelligibility band, carved out of the MUSIC only.
   *
   * The source says cut 2-4 kHz on the bed to make room for speech. A 3 kHz
   * bell with a wide-ish Q covers that span; -4 dB is the source's own figure
   * for how much.
   */
  carveHz: 3000,
  carveQ: 1.2,
  carveDb: -4,
  /** Below this is rumble, and generated music often has some. */
  highpassHz: 40,
  /**
   * Ducking. `threshold` is linear amplitude, as ffmpeg wants it: 0.05 is
   * about -26 dB, low enough that ordinary narration triggers it.
   *
   * THE RATIO WAS MEASURED, NOT CALCULATED, and the two disagree. Textbook
   * arithmetic for a hard-knee peak compressor says a key 14 dB over threshold
   * at 3:1 gives 9 dB of gain reduction. `sidechaincompress` has a soft knee
   * and detects RMS, so 3:1 actually measures 6.9 dB against narration peaking
   * at -15 dB — the very bottom of the 6-12 dB the source asks for, and real
   * speech averages below its peaks, so it would fall out of range. 4:1
   * measures 7.7 dB, which leaves room in both directions.
   *
   * The smoke test re-measures this on every run.
   */
  duckThreshold: 0.05,
  duckRatio: 4,
  duckAttackMs: 20,
  duckReleaseMs: 500,
  /** Long enough not to sound like a fault, short enough not to waste the head. */
  fadeInSeconds: 1.5,
  fadeOutSeconds: 2,
} as const

/**
 * The three numbers a project may override, and their bounds.
 *
 * Everything else in `MIX` stays fixed. These three are the ones a person can
 * actually judge by listening — is the music too loud for this narration, does
 * this opening want a longer swell — and the rest (the carve frequency, the
 * duck ratio, the loudness target) are answers to questions listening does not
 * ask.
 *
 * The DEFAULT gain is the spec's own -20 dB, so a project that never touches
 * the control still gets the W3C figure. Overriding it is a decision, not a
 * drift.
 */
export const MIX_BOUNDS = {
  /** Quieter than -40 is inaudible; louder than -6 buries the words. */
  gainDb: { min: -40, max: -6, default: MIX.bedDb },
  fadeInSeconds: { min: 0, max: 20, default: MIX.fadeInSeconds },
  fadeOutSeconds: { min: 0, max: 20, default: MIX.fadeOutSeconds },
} as const

/** What a project chose, if anything. Absent fields take the default. */
export interface MusicSettings {
  gainDb?: number | undefined
  fadeInSeconds?: number | undefined
  fadeOutSeconds?: number | undefined
}

/**
 * One clamp, used by the route, the render and the preview.
 *
 * Kept here rather than at the edge that happens to receive the number: the
 * preview has to reach the same answer as the render from the same stored
 * value, and two clamps would eventually disagree about an out-of-range one.
 */
export function resolveMusicSettings(settings: MusicSettings | undefined): {
  gainDb: number
  fadeInSeconds: number
  fadeOutSeconds: number
} {
  const pick = (value: number | undefined, bound: { min: number; max: number; default: number }): number =>
    value === undefined || !Number.isFinite(value)
      ? bound.default
      : Math.min(bound.max, Math.max(bound.min, value))
  return {
    gainDb: pick(settings?.gainDb, MIX_BOUNDS.gainDb),
    fadeInSeconds: pick(settings?.fadeInSeconds, MIX_BOUNDS.fadeInSeconds),
    fadeOutSeconds: pick(settings?.fadeOutSeconds, MIX_BOUNDS.fadeOutSeconds),
  }
}

/**
 * How far the sidechain pulls the bed down while someone is talking.
 *
 * Measured, not calculated — see the note on `duckRatio`. The preview reads it
 * from here so that changing the ratio cannot leave the edit loop and the
 * export describing different mixes.
 */
export const DUCK_DB = -8

/** Decibels to the linear gain `HTMLMediaElement.volume` takes. */
export function gainToVolume(db: number): number {
  return Math.min(1, Math.max(0, Math.pow(10, db / 20)))
}

/**
 * Integrated loudness and true peak, per platform.
 *
 * The same `target_platform` that already decides the frame. Every platform
 * normalises DOWN to its target and none normalise up, so landing above it
 * means the platform quietens the whole film — including the narration.
 */
export interface LoudnessTarget {
  /** Integrated LUFS. */
  lufs: number
  /** True peak ceiling, dBTP. */
  truePeak: number
}

const PLATFORM_LOUDNESS: Record<string, LoudnessTarget> = {
  youtube: { lufs: -14, truePeak: -1.5 },
  bilibili: { lufs: -14, truePeak: -1.5 },
  // The short-video platforms are played on phone speakers and ask for a
  // tighter ceiling than YouTube does.
  douyin: { lufs: -14, truePeak: -1 },
  xiaohongshu: { lufs: -14, truePeak: -1 },
  wechat: { lufs: -14, truePeak: -1 },
}

/** -14 LUFS is every listed platform's target, so it is also the fallback. */
const DEFAULT_LOUDNESS: LoudnessTarget = { lufs: -14, truePeak: -1.5 }

export function loudnessFor(platform: string | undefined): LoudnessTarget {
  if (platform === undefined) return DEFAULT_LOUDNESS
  return PLATFORM_LOUDNESS[platform] ?? DEFAULT_LOUDNESS
}

export interface MusicMixOptions {
  /** Film length in seconds. The bed is looped and cut to exactly this. */
  totalSeconds: number
  /** Where the mix should land. */
  loudness: LoudnessTarget
  /** ffmpeg input index of the narration bed. */
  voiceInput: number
  /** ffmpeg input index of the music. */
  musicInput: number
  /** The project's overrides. Absent fields take the spec defaults. */
  settings?: MusicSettings | undefined
}

/**
 * The `-filter_complex` graph that turns narration plus music into one track.
 *
 * Returned as a string rather than run here so a test can read it, and so the
 * mux step stays one place that assembles arguments.
 *
 * `amix` is given `normalize=0` deliberately. Its default halves every input to
 * guarantee no clipping, which would drop the narration 6 dB below the level
 * everything else in this file is measured against — the bed offset, the duck
 * depth and the loudness target would all then be wrong together, and the film
 * would simply come out quiet with nothing to point at.
 */
export function musicMixFilter(options: MusicMixOptions): string {
  const { totalSeconds, loudness, voiceInput, musicInput } = options
  const { gainDb, fadeInSeconds, fadeOutSeconds } = resolveMusicSettings(options.settings)
  const v = '[' + voiceInput + ':a]'
  const m = '[' + musicInput + ':a]'
  // A fade-out longer than the film would start before zero, and ffmpeg reads a
  // negative `st` as garbage rather than as an error.
  const fadeOutStart = Math.max(0, totalSeconds - fadeOutSeconds)

  return [
    // The bed: shaped, levelled, cut to length, faded at both ends. `atrim`
    // rather than relying on -shortest, because the input is looped forever and
    // an explicit end is one less thing depending on how EOF propagates.
    m + 'aresample=48000,'
      + 'highpass=f=' + MIX.highpassHz + ','
      + 'equalizer=f=' + MIX.carveHz + ':t=q:w=' + MIX.carveQ + ':g=' + MIX.carveDb + ','
      + 'volume=' + gainDb + 'dB,'
      + 'atrim=0:' + totalSeconds.toFixed(3) + ','
      + 'asetpts=PTS-STARTPTS,'
      + 'afade=t=in:st=0:d=' + fadeInSeconds + ','
      + 'afade=t=out:st=' + fadeOutStart.toFixed(3) + ':d=' + fadeOutSeconds
      + '[bed]',

    // The narration is used twice: once as the thing you hear, once as the key
    // that pushes the bed down. `asplit` rather than two references to the same
    // pad, which ffmpeg refuses.
    v + 'aresample=48000,asplit=2[voice][key]',

    // Order matters: the FIRST input is compressed, the second is the key.
    '[bed][key]sidechaincompress='
      + 'threshold=' + MIX.duckThreshold
      + ':ratio=' + MIX.duckRatio
      + ':attack=' + MIX.duckAttackMs
      + ':release=' + MIX.duckReleaseMs
      + '[ducked]',

    // `duration=first` ties the mix to the narration, which is exactly the film
    // length. normalize=0: see the note above.
    '[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]',

    '[mixed]aresample=48000[out]',
  ].join(';')
}

/* ------------------------------------------------------- loudness, in two passes */

/**
 * Loudness normalisation happens in TWO passes, and the reason is the whole
 * point of the feature.
 *
 * ffmpeg's `loudnorm` defaults to DYNAMIC mode when it has no measurement to
 * work from: it rides the gain over time, pushing quiet passages up toward the
 * target. Run over a mix that was just carefully ducked, it hears the gaps
 * between sentences as "too quiet" and lifts the music back into them — undoing
 * the ducking, one gap at a time, with no error and nothing in the output to
 * point at.
 *
 * Measuring first and passing the numbers back with `linear=true` applies ONE
 * constant gain to the whole file. The duck survives intact, and the film still
 * lands on the platform's target. The cost is a second decode of the audio,
 * which is seconds — and cheap next to a feature that silently does not work.
 */
export interface LoudnessMeasurement {
  input_i: string
  input_tp: string
  input_lra: string
  input_thresh: string
  target_offset: string
}

/** The analysis pass: measure, output nothing. */
export function loudnormAnalyseArgs(input: string, target: LoudnessTarget): string[] {
  return [
    '-v', 'info', '-nostdin', '-i', input,
    '-af', 'loudnorm=I=' + target.lufs + ':TP=' + target.truePeak + ':LRA=11:print_format=json',
    '-f', 'null', '-',
  ]
}

/**
 * Pull the JSON block loudnorm prints on stderr.
 *
 * It is printed among ordinary log lines, so the last `{...}` is taken rather
 * than the whole stream parsed. A failure here is not fatal to the caller —
 * see `loudnormFilter`.
 */
export function parseLoudnorm(stderr: string): LoudnessMeasurement | undefined {
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    const parsed = JSON.parse(stderr.slice(start, end + 1)) as Partial<LoudnessMeasurement>
    if (parsed.input_i === undefined || parsed.input_tp === undefined) return undefined
    return parsed as LoudnessMeasurement
  } catch {
    return undefined
  }
}

/**
 * The normalising filter.
 *
 * With a measurement: linear, one constant gain, ducking preserved.
 * Without one: `alimiter` at the true-peak ceiling and nothing else. NOT
 * dynamic loudnorm — falling back to the mode that undoes the ducking would
 * turn a failed measurement into a silently wrong mix, which is worse than a
 * film that is a decibel or two off target.
 */
export function loudnormFilter(
  target: LoudnessTarget,
  measured: LoudnessMeasurement | undefined,
): string {
  if (measured === undefined) {
    // dBTP to linear amplitude, which is what alimiter's `limit` wants.
    const limit = Math.pow(10, target.truePeak / 20)
    return 'alimiter=limit=' + limit.toFixed(4) + ':level=false'
  }
  return 'loudnorm=I=' + target.lufs + ':TP=' + target.truePeak + ':LRA=11'
    + ':measured_I=' + measured.input_i
    + ':measured_TP=' + measured.input_tp
    + ':measured_LRA=' + measured.input_lra
    + ':measured_thresh=' + measured.input_thresh
    + ':offset=' + measured.target_offset
    + ':linear=true:print_format=summary'
}

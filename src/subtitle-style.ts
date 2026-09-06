/**
 * How burned-in subtitles look, and the ASS file that makes it so.
 *
 * Ported from OpenMontage's `skills/creative/typography.md`, whose numbers come
 * from the Netflix and BBC subtitle specs, EBU/SMPTE safe-area standards and
 * WCAG contrast requirements. Until now the burn was a bare
 * `-vf subtitles=file.srt`, which hands every one of these decisions to
 * libass's defaults: small Arial pinned to the frame edge, no outline.
 *
 * WHY THIS WRITES AN ASS FILE INSTEAD OF PASSING `force_style`
 *
 * ASS sizes are not pixels. They are units in the script's own coordinate
 * space, and libass falls back to 384x288 when the file declares none — which
 * an SRT never does. So `FontSize=46` intending 46px rendered at 46 * 1080/288,
 * about 172px: three enormous lines stacked across the middle of the frame.
 * `MarginV` was off by the same factor, which is why the text sat centred
 * rather than near the bottom.
 *
 * Writing the ASS ourselves lets us declare `PlayResX/PlayResY` equal to the
 * output frame, and every number below is then a true pixel. Guessing the
 * 384x288 default and pre-dividing would also work today and break on the
 * first ffmpeg build that changes it.
 *
 * The `.srt` sidecar is still written and still shipped — it is the portable,
 * editable one. The `.ass` exists only to be burned.
 *
 * THE ONE NUMBER THAT DOES NOT PORT IS CHARACTERS PER LINE. The spec says
 * 37-42, right for Latin script and wrong by more than double for Chinese: a
 * hanzi carries roughly the information of an English word, and Netflix's own
 * Simplified Chinese guideline is 16 per line. Our playbooks carry 18-24 in
 * `subtitleMaxChars`, set per style, and the splitting happens upstream in
 * `subtitle.ts`. Nothing here touches it.
 */
import type { SubtitleCue } from './subtitle.js'

/** `outline` keeps the picture visible; `box` guarantees contrast. */
export const SUBTITLE_BACKGROUNDS = ['outline', 'box'] as const
export type SubtitleBackground = (typeof SUBTITLE_BACKGROUNDS)[number]

export interface SubtitleStyleOptions {
  /** Output frame. Sizes and margins scale with it rather than assuming 1080p. */
  width: number
  height: number
  background?: SubtitleBackground | undefined
  /** Font family. Must exist on the host, or libass silently substitutes. */
  fontName?: string | undefined
}

/**
 * Reference height the spec's pixel values are quoted against.
 *
 * Scaling from the SHORT side rather than the height keeps a vertical render's
 * text the same physical size as a landscape one — scale by height and a
 * 1080x1920 frame gets text nearly twice as large as intended.
 */
const REFERENCE_SHORT_SIDE = 1080

const SPEC = {
  /** 42px at 1080p is the accessibility floor, not a suggestion. */
  fontSize: 46,
  /** White text with a 2-4px dark stroke is the no-box style. */
  outline: 3,
  /** A soft shadow separates the stroke from bright backgrounds. */
  shadow: 1,
  /** 60px from the edge minimum: below that a phone's gesture bar covers it. */
  marginBottom: 64,
  /** Title-safe: text stays inside 90% of the frame width. */
  safeWidthRatio: 0.9,
} as const

/** `H:MM:SS.cc` — ASS centiseconds, and a single-digit hour. */
function assTime(seconds: number): string {
  const total = Math.max(0, seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = Math.floor(total % 60)
  const centis = Math.round((total - Math.floor(total)) * 100)
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  // A rounded 100 would print as `:05.100`, which libass reads as garbage.
  return centis === 100
    ? assTime(Math.floor(total) + 1)
    : hours + ':' + pad(minutes) + ':' + pad(secs) + '.' + pad(centis)
}

/**
 * Escape one cue for a `Dialogue:` line.
 *
 * Commas separate the nine leading fields, but the text is the LAST field so
 * its own commas are safe. Newlines are not: a raw one would end the line and
 * the rest would parse as an unknown directive, silently dropping the cue.
 */
function assText(text: string): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\\N')
}

/** The resolved numbers, exposed so tests and the panel can state them. */
export function subtitleMetrics(options: SubtitleStyleOptions): {
  fontSize: number
  marginBottom: number
  sideMargin: number
  outline: number
} {
  const shortSide = Math.max(1, Math.min(options.width, options.height))
  const scale = shortSide / REFERENCE_SHORT_SIDE
  const px = (value: number): number => Math.max(1, Math.round(value * scale))
  return {
    fontSize: px(SPEC.fontSize),
    marginBottom: px(SPEC.marginBottom),
    sideMargin: Math.round((options.width * (1 - SPEC.safeWidthRatio)) / 2),
    outline: px(SPEC.outline),
  }
}

/**
 * A complete ASS file for these cues at this frame size.
 *
 * Colours are ASS `&HAABBGGRR` — alpha first and the channels reversed from
 * the usual hex, which is the easiest thing here to get wrong: `&H00FFFFFF` is
 * opaque white, not transparent white, and a higher alpha means MORE
 * transparent.
 */
export function renderAss(cues: readonly SubtitleCue[], options: SubtitleStyleOptions): string {
  const metrics = subtitleMetrics(options)
  const boxed = options.background === 'box'
  const font = (options.fontName ?? 'Microsoft YaHei').replace(/[,\r\n]/g, ' ').trim()

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    // The whole reason this file exists: declaring the frame makes every
    // number below a real pixel.
    'PlayResX: ' + Math.round(options.width),
    'PlayResY: ' + Math.round(options.height),
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,'
      + ' BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,'
      + ' BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    [
      'Style: Default',
      font,
      metrics.fontSize,
      '&H00FFFFFF',             // primary: opaque white
      '&H00FFFFFF',             // secondary (karaoke); unused
      '&H00000000',             // outline: opaque black
      // Boxed draws this behind the glyphs; 0x33 alpha is ~80% opaque, the
      // contrast figure the spec asks for. The outline style keeps it clear.
      boxed ? '&H33000000' : '&H00000000',
      0, 0, 0, 0,               // bold, italic, underline, strikeout
      100, 100,                 // scale x, y
      0, 0,                     // spacing, angle
      boxed ? 3 : 1,            // 3 = opaque box, 1 = outline + shadow
      boxed ? Math.max(1, Math.round(metrics.outline / 2)) : metrics.outline,
      boxed ? 0 : Math.max(1, Math.round(metrics.outline / 3)),
      2,                        // bottom centre
      metrics.sideMargin,
      metrics.sideMargin,
      metrics.marginBottom,
      1,                        // encoding: default
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const events = cues.map((cue) =>
    'Dialogue: 0,' + assTime(cue.start) + ',' + assTime(cue.end)
    + ',Default,,0,0,0,,' + assText(cue.text))

  return [...header, ...events, ''].join('\n')
}

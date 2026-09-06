/**
 * How burned-in subtitles look.
 *
 * Ported from OpenMontage's `skills/creative/typography.md`, whose numbers come
 * from the Netflix and BBC subtitle specs, EBU/SMPTE safe-area standards and
 * WCAG contrast requirements. Until now the burn was a bare
 * `-vf subtitles=file.srt`, which hands every one of these decisions to
 * libass's defaults: 16pt Arial, centred at the very bottom edge, no outline.
 * On a vertical render that lands under the platform's own UI, and at 4K it is
 * a sixth of the size a viewer can read.
 *
 * THE ONE NUMBER THAT DOES NOT PORT IS CHARACTERS PER LINE. The spec says
 * 37–42, which is right for Latin script and wrong by more than double for
 * Chinese: a hanzi carries roughly the information of an English word, and
 * Netflix's own Simplified Chinese guideline is 16 per line. Our playbooks
 * already carry 18–24 in `subtitleMaxChars`, set per style, and the line
 * splitting happens upstream in `subtitle.ts`. Nothing here should touch it.
 *
 * Everything else scales with the output frame rather than assuming 1080p,
 * because `target_platform` can now produce 1080x1920 or 1080x1440.
 */

/** Style knobs a caller may override; every one has a spec-backed default. */
export interface SubtitleStyleOptions {
  /** Output frame, so sizes and margins scale instead of assuming 1080p. */
  width: number
  height: number
  /**
   * `outline` keeps the picture visible and reads on any background;
   * `box` guarantees contrast on busy footage at the cost of covering it.
   */
  background?: 'outline' | 'box'
  /** Font family. Must exist on the host, or libass silently substitutes. */
  fontName?: string | undefined
}

/**
 * Reference height every size in the spec is quoted against.
 *
 * The spec's 42px is a 1080p number. Scaling from the SHORT side rather than
 * the height keeps a vertical render's text the same physical size as a
 * landscape one — scale by height and a 1080x1920 frame would get text nearly
 * twice as large as intended.
 */
const REFERENCE_SHORT_SIDE = 1080

/** Spec values at the reference size, in pixels. */
const SPEC = {
  /** 42px+ at 1080p is the accessibility floor, not a suggestion. */
  fontSize: 46,
  /** White text with a 2–4px dark stroke is the no-box style. */
  outline: 3,
  /** A soft shadow separates the stroke from bright backgrounds. */
  shadow: 1,
  /** 60px from the edge minimum: below that a phone's gesture bar covers it. */
  marginBottom: 64,
  /** Title-safe: text stays inside 90% of the frame width. */
  safeWidthRatio: 0.9,
} as const

/**
 * An ASS `force_style` string for ffmpeg's `subtitles` filter.
 *
 * Colours are ASS `&HAABBGGRR` — alpha first and the channels reversed from
 * the usual hex, which is the single easiest thing to get wrong here: `&H00FFFFFF`
 * is opaque white, not transparent white.
 */
export function subtitleForceStyle(options: SubtitleStyleOptions): string {
  const shortSide = Math.max(1, Math.min(options.width, options.height))
  const scale = shortSide / REFERENCE_SHORT_SIDE
  const px = (value: number): number => Math.max(1, Math.round(value * scale))

  // Horizontal margins put the text inside the title-safe 90%.
  const sideMargin = Math.round((options.width * (1 - SPEC.safeWidthRatio)) / 2)

  const boxed = options.background === 'box'
  const entries: Array<[string, string | number]> = [
    ['FontName', options.fontName ?? 'Microsoft YaHei'],
    ['FontSize', px(SPEC.fontSize)],
    ['PrimaryColour', '&H00FFFFFF'],
    // Black at 20% transparency behind the glyphs when boxed; the outline
    // style leaves it fully transparent and relies on the stroke instead.
    ['BackColour', boxed ? '&H33000000' : '&H00000000'],
    ['OutlineColour', '&H00000000'],
    // BorderStyle 3 paints an opaque box behind the line; 1 draws the stroke.
    ['BorderStyle', boxed ? 3 : 1],
    ['Outline', boxed ? px(2) : px(SPEC.outline)],
    ['Shadow', boxed ? 0 : px(SPEC.shadow)],
    // 2 = bottom centre.
    ['Alignment', 2],
    ['MarginV', px(SPEC.marginBottom)],
    ['MarginL', sideMargin],
    ['MarginR', sideMargin],
    ['Bold', 0],
  ]
  // Commas separate entries, so a value containing one would split the style
  // silently. Only the font name can, and a font with a comma in its name is
  // not a font we can ask libass for anyway.
  return entries.map(([key, value]) => key + '=' + String(value).replace(/,/g, ' ')).join(',')
}

/** The two knobs, described for a settings form. */
export const SUBTITLE_BACKGROUNDS = ['outline', 'box'] as const
export type SubtitleBackground = (typeof SUBTITLE_BACKGROUNDS)[number]

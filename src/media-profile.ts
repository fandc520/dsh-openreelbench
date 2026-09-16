/**
 * Platform render profiles — what frame the film is cut to, and what size the
 * pictures are generated at.
 *
 * `brief.target_platform` used to be validated and then ignored: the schema
 * refused anything outside the list, and compose read width and height from the
 * global settings regardless. A project declared for 抖音 rendered 1920x1080.
 * A declaration nothing acts on is worse than no declaration, because it reads
 * like a decision that was made.
 *
 * THE RULE, as of the render-scale change: the platform decides the ASPECT
 * RATIO and the BASELINE resolution; one setting — `video.renderScale` —
 * multiplies that baseline; the product is the frame, and the SAME product is
 * what the image workflow is told to draw at. There is no separate output
 * resolution in settings any more, because there were two answers to one
 * question and only one of them reached the picture generator: a vertical
 * project's stills came back 16:9 and compose cropped the sides off.
 *
 * Baseline numbers follow OpenMontage's `lib/media_profiles.py` where the
 * platforms line up; the Chinese platforms are their own published upload specs.
 */

export type TargetPlatform =
  | 'youtube' | 'bilibili' | 'douyin' | 'xiaohongshu' | 'wechat' | 'generic'

/**
 * One frame shape, and every platform that publishes to it.
 *
 * Grouped rather than listed per platform because the frame is the ONLY thing
 * this choice decides: offering 抖音 and 微信视频号 as separate options that
 * produce byte-identical output asks the user to make a distinction the
 * software does not act on.
 *
 * `platforms[0]` is what gets stored when the group is chosen. The rest stay
 * in the group so a project that already named one keeps its own value — the
 * picker matches on the group, and never rewrites a stored platform that
 * already resolves to the right frame.
 */
export interface FrameGroup {
  id: string
  /** The shape, which is what the user is actually choosing. */
  label: string
  /** Who publishes here, for the option text. */
  names: string
  platforms: readonly TargetPlatform[]
  width: number
  height: number
}

export const FRAME_GROUPS: readonly FrameGroup[] = [
  {
    id: 'landscape-16-9',
    label: '横屏 16:9',
    names: 'YouTube / 哔哩哔哩 / 不指定',
    // `generic` lives here rather than in a group of its own: with the output
    // resolution gone from settings there is nothing left for "unspecified" to
    // defer TO, so its frame is the landscape default and saying so is honest.
    platforms: ['youtube', 'bilibili', 'generic'],
    width: 1920,
    height: 1080,
  },
  {
    id: 'portrait-9-16',
    label: '竖屏 9:16',
    names: '抖音 / 微信视频号',
    platforms: ['douyin', 'wechat'],
    width: 1080,
    height: 1920,
  },
  {
    // Xiaohongshu's feed is 3:4; its full-screen slot is 9:16. The feed is what
    // a note actually lands in, so that is what the frame follows.
    id: 'portrait-3-4',
    label: '竖屏 3:4',
    names: '小红书',
    platforms: ['xiaohongshu'],
    width: 1080,
    height: 1440,
  },
]

/** The group a platform belongs to. Anything unrecognised lands in the first. */
export function frameGroupFor(platform: string | undefined): FrameGroup {
  return FRAME_GROUPS.find((group) =>
    (group.platforms as readonly string[]).includes(platform ?? '')) ?? FRAME_GROUPS[0]!
}

export const SCALE_BOUNDS = { min: 0.1, max: 2, default: 1 } as const

/**
 * Bring a scale factor into range.
 *
 * Clamped rather than refused: this runs at render time, and a settings value
 * from a future version must not be the reason a film cannot be cut.
 */
export function clampScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale)) return SCALE_BOUNDS.default
  return Math.min(SCALE_BOUNDS.max, Math.max(SCALE_BOUNDS.min, scale))
}

/**
 * Round a scaled dimension to something an encoder will accept.
 *
 * h264 with yuv420p needs even width and height — an odd number is not a
 * slightly different picture, it is a failed render. Rounded to 2 rather than
 * to 8 on purpose: 1920 x 0.5 has to come out 960, and a generator that wants
 * multiples of 64 will round again on its own side.
 */
export function evenPixels(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

export interface ResolvedProfile {
  width: number
  height: number
  fps: number
  /** The platform's own frame, before the scale. */
  baseWidth: number
  baseHeight: number
  scale: number
  /** Whether the platform was named, or fell back to the landscape default. */
  source: 'platform' | 'default'
  /** The group's shape, e.g. 竖屏 9:16. */
  shape: string
  /** One line a person can read: shape, pixels, and the scale if it bit. */
  label: string
}

/**
 * The frame to render in, and to generate pictures at.
 *
 * An unknown or absent platform falls back to the landscape default rather
 * than throwing — this runs at render time, and refusing to render because a
 * brief predates the field would punish the user for our schema history.
 *
 * `fps` is passed through untouched: the platform fixes the frame, not the
 * frame rate, which is a quality setting the user may have raised deliberately.
 */
export function resolveVideoProfile(
  platform: string | undefined,
  scale: number | undefined,
  fps: number,
): ResolvedProfile {
  const group = frameGroupFor(platform)
  const factor = clampScale(scale)
  const width = evenPixels(group.width * factor)
  const height = evenPixels(group.height * factor)
  const named = platform !== undefined
    && platform !== 'generic'
    && FRAME_GROUPS.some((entry) => (entry.platforms as readonly string[]).includes(platform))
  const pixels = width + 'x' + height
  return {
    width,
    height,
    fps,
    baseWidth: group.width,
    baseHeight: group.height,
    scale: factor,
    source: named ? 'platform' : 'default',
    shape: group.label,
    label: group.label + ' ' + pixels
      // Rounded for display only: 1/3 prints as 0.333, not as seventeen digits.
      + (factor === 1
        ? ''
        : '（基线 ' + group.width + 'x' + group.height
          + ' × ' + Number(factor.toFixed(3)) + '）'),
  }
}

/** Every frame group at a given scale, for settings, panels and skills. */
export function listFrameProfiles(scale?: number): Array<{
  id: string; label: string; names: string; platforms: readonly string[]
  baseWidth: number; baseHeight: number; width: number; height: number
}> {
  const factor = clampScale(scale)
  return FRAME_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    names: group.names,
    platforms: group.platforms,
    baseWidth: group.width,
    baseHeight: group.height,
    width: evenPixels(group.width * factor),
    height: evenPixels(group.height * factor),
  }))
}

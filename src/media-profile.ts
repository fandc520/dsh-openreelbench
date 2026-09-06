/**
 * Platform render profiles — what frame the finished film is actually cut to.
 *
 * `brief.target_platform` used to be validated and then ignored: the schema
 * refused anything outside the list, and compose read width and height from the
 * global settings regardless. A project declared for 抖音 rendered 1920x1080.
 * A declaration nothing acts on is worse than no declaration, because it reads
 * like a decision that was made.
 *
 * THE RULE: a named platform decides the frame; `generic` hands the decision
 * back to settings. That keeps the setting meaningful for people rendering to
 * no particular place, and keeps "I said 抖音" from quietly producing landscape.
 * Whichever way it resolves, the answer is reported in the render output, so
 * the frame is never a surprise.
 *
 * Numbers follow OpenMontage's `lib/media_profiles.py` where the platforms line
 * up; the Chinese platforms are their own published upload specs.
 */

export type TargetPlatform =
  | 'youtube' | 'bilibili' | 'douyin' | 'xiaohongshu' | 'wechat' | 'generic'

export interface VideoProfile {
  width: number
  height: number
  fps: number
}

/** Named frames. `generic` is absent on purpose: it means "ask the settings". */
const PLATFORM_PROFILES: Record<Exclude<TargetPlatform, 'generic'>, VideoProfile & { label: string }> = {
  youtube: { width: 1920, height: 1080, fps: 30, label: 'YouTube 横屏 16:9' },
  bilibili: { width: 1920, height: 1080, fps: 30, label: '哔哩哔哩 横屏 16:9' },
  douyin: { width: 1080, height: 1920, fps: 30, label: '抖音 竖屏 9:16' },
  // Xiaohongshu's feed is 3:4; its full-screen slot is 9:16. The feed is what a
  // note actually lands in, so that is what the frame follows.
  xiaohongshu: { width: 1080, height: 1440, fps: 30, label: '小红书 竖屏 3:4' },
  wechat: { width: 1080, height: 1920, fps: 30, label: '微信视频号 竖屏 9:16' },
}

export interface ResolvedProfile extends VideoProfile {
  /** Where these numbers came from, for the render report and the panel. */
  source: 'platform' | 'settings'
  label: string
}

/**
 * The frame to render in.
 *
 * `settings` is the configured default; `platform` comes off the brief. An
 * unknown or absent platform falls back to settings rather than throwing —
 * this runs at render time, and refusing to render because a brief predates
 * the field would punish the user for our schema history.
 */
export function resolveVideoProfile(
  settings: VideoProfile,
  platform: string | undefined,
): ResolvedProfile {
  if (platform !== undefined && platform !== 'generic' && platform in PLATFORM_PROFILES) {
    const profile = PLATFORM_PROFILES[platform as Exclude<TargetPlatform, 'generic'>]
    return {
      width: profile.width,
      height: profile.height,
      // The platform fixes the frame, not the frame rate: fps is a quality
      // setting the user may have raised deliberately, and every profile here
      // names 30 anyway.
      fps: settings.fps,
      source: 'platform',
      label: profile.label,
    }
  }
  return {
    ...settings,
    source: 'settings',
    label: '设置里的默认画幅 ' + settings.width + 'x' + settings.height,
  }
}

/** Every named platform and the frame it implies, for settings and skills. */
export function listPlatformProfiles(): Array<{ platform: string; label: string; width: number; height: number }> {
  return Object.entries(PLATFORM_PROFILES).map(([platform, profile]) => ({
    platform,
    label: profile.label,
    width: profile.width,
    height: profile.height,
  }))
}

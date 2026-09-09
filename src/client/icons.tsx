/**
 * The panel's small stroke icons.
 *
 * Inline SVG rather than a font or sprite: the harness serves the client as a
 * single bundle and nothing else (an icon font file would 404), and inline
 * SVG inherits `currentColor`, so one glyph follows text colour everywhere —
 * including the poster's fixed palette and the theme's tokens.
 *
 * Paths are drawn on a 24-grid at stroke 1.7, sized by CSS (default 14px).
 * Keep the set small and ornamental: these mark sections and tags, they do
 * not carry state — status colour stays with the tone classes.
 */
import type { ReactNode } from 'react'

export interface IconProps {
  className?: string | undefined
}

function Glyph({ children, className }: IconProps & { children: ReactNode }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** 场记板 — 图文解说片管线，也当「创作」的通符。 */
export function IconClapper({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z" />
      <path d="m6.2 5.3 3.1 3.9" />
      <path d="m12.4 3.4 3.1 4" />
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Glyph>
  )
}

/** 时钟回环 — 历史项目。 */
export function IconHistory({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </Glyph>
  )
}

/** 垃圾桶 — 回收站。 */
export function IconTrash({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </Glyph>
  )
}

/** 四角星 — 未被单独指派图标时的通用创作符。 */
export function IconSpark({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9-5.7-1.8L10.2 9Z" />
    </Glyph>
  )
}

/** 播放三角 — 成片 / 预览类动作的标记。 */
export function IconPlay({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <path d="M7 4.8v14.4a.6.6 0 0 0 .9.5l11.5-7.2a.6.6 0 0 0 0-1L7.9 4.3a.6.6 0 0 0-.9.5Z" />
    </Glyph>
  )
}

/** 钢笔 — 脚本。 */
export function IconPen({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Glyph>
  )
}

/** 麦克风 — 配音。 */
export function IconMic({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
    </Glyph>
  )
}

/** 图片 — 分镜。 */
export function IconImage({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </Glyph>
  )
}

/** 调节杆 — 项目设置。 */
export function IconSliders({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </Glyph>
  )
}

/** 文档 — 创意简报。 */
export function IconDoc({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </Glyph>
  )
}

/** 时钟 — 时长。 */
export function IconClock({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Glyph>
  )
}

/** 地球 — 投放平台。 */
export function IconGlobe({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9Z" />
    </Glyph>
  )
}

/** 调色板 — 风格。 */
export function IconPalette({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <circle cx="13.5" cy="6.5" r=".8" />
      <circle cx="17.5" cy="10.5" r=".8" />
      <circle cx="8.5" cy="7.5" r=".8" />
      <circle cx="6.5" cy="12.5" r=".8" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1-.3-.3-.4-.6-.4-1 0-.9.7-1.6 1.6-1.6H16c3.3 0 6-2.7 6-6-.1-4.9-4.6-8.8-10-8.8Z" />
    </Glyph>
  )
}

/** 对勾 — 保存 / 完成。 */
export function IconCheck({ className }: IconProps): JSX.Element {
  return (
    <Glyph className={className}>
      <path d="M20 6 9 17l-5-5" />
    </Glyph>
  )
}

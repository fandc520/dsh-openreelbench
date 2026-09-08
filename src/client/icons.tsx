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

interface IconProps {
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

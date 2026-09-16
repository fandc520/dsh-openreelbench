/**
 * The media card — `tool.call.toolview` for `openreel_show` and `openreel_compose`.
 *
 * A tool result reaches the browser as text plus a `meta` payload the host
 * attached through `presentationMeta`. Text is what a transcript keeps and what
 * the model reads back; this card is what a person looks at. So the card draws
 * from `meta` alone and never parses the text — the two are separate channels
 * carrying the same event, and treating the prose as data would tie the card to
 * wording that exists for the model's benefit.
 *
 * It is deliberately generic: any project-relative path the host resolved into
 * a `/openreel/media` URL renders here, whether it is a finished film, one take,
 * or a single frame. That is why `openreel_show` exists at all — the agent has
 * plenty of ways to make media and, until now, no way to put it on screen.
 */
import { createElement as h, useEffect, useState } from 'react'

interface MediaItem {
  path: string
  name: string
  kind: string
  bytes: number
  url: string
}

interface MediaMeta {
  kind: 'media'
  project: string
  items: MediaItem[]
  note?: string
}

/** Structural slice of the wire ToolCallBlock — only what this card reads. */
interface Block {
  kind?: string
  call?: { name: string; argsRaw: string } | null
  isError?: boolean
  error?: { name?: string; code?: string }
  meta?: unknown
}

export interface MediaCardProps {
  block: Block
}

function readMeta(block: Block): MediaMeta | undefined {
  const meta = block.meta
  if (meta === null || typeof meta !== 'object') return undefined
  const candidate = meta as MediaMeta
  if (candidate.kind !== 'media' || !Array.isArray(candidate.items)) return undefined
  return candidate
}

function sizeLabel(bytes: number): string {
  if (bytes <= 0) return ''
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/** How much of a text file is worth pulling into a chat card. */
const TEXT_LIMIT = 256 * 1024

/**
 * Text files render as text.
 *
 * A subtitle track handed back as a download link is the one thing nobody can
 * check at a glance, and checking it at a glance is the entire reason the card
 * exists. So this fetches the file and shows it — bounded, because a card is
 * not a file viewer and an unbounded one would paste a megabyte into the
 * conversation.
 */
function TextPreview({ item }: { item: MediaItem }): ReturnType<typeof h> {
  const [body, setBody] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (item.bytes > TEXT_LIMIT) return undefined
    // Discarded on unmount so a card scrolled away mid-fetch does not set
    // state on a component that is gone.
    let live = true
    fetch(item.url)
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.text()
      })
      .then((value) => { if (live) setBody(value) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [item.url, item.bytes])

  const content = item.bytes > TEXT_LIMIT
    ? '文件太大，卡片里不展开（' + Math.round(item.bytes / 1024) + ' KB）。用右下角的 ↓ 下载。'
    : failed
      ? '读不出来。'
      : body ?? '读取中…'

  return h('pre', { className: 'orb-card-text' }, content)
}

function Frame({ item, onZoom }: { item: MediaItem; onZoom: () => void }): ReturnType<typeof h> {
  const [failed, setFailed] = useState(false)

  const body = failed
    ? h('div', { className: 'orb-card-missing' }, '打不开：' + item.name)
    : item.kind === 'video'
      ? h('video', {
          className: 'orb-card-video',
          src: item.url,
          controls: true,
          preload: 'metadata',
          onError: () => setFailed(true),
        })
      : item.kind === 'audio'
        ? h('audio', {
            className: 'orb-card-audio',
            src: item.url,
            controls: true,
            preload: 'metadata',
            onError: () => setFailed(true),
          })
        : item.kind === 'text'
          ? h(TextPreview, { item })
          : item.kind === 'image'
            ? h('img', {
                className: 'orb-card-image',
                src: item.url,
                alt: item.name,
                loading: 'lazy',
                onClick: onZoom,
                onError: () => setFailed(true),
              })
            // Nothing a browser can show inline. Say what it is and offer it,
            // rather than pretending a preview exists.
            : h('a', {
                className: 'orb-card-file',
                href: item.url + '&download=1',
                target: '_blank',
                rel: 'noreferrer',
              }, '下载 ' + item.name)

  return h('figure', { className: 'orb-card-frame orb-card-frame--' + item.kind },
    body,
    h('figcaption', { className: 'orb-card-caption' },
      h('span', { className: 'orb-card-name', title: item.path }, item.name),
      h('span', { className: 'orb-card-size' }, sizeLabel(item.bytes)),
      // Every kind gets this, including the ones shown inline: seeing a file
      // and keeping it are different wants, and the preview answers only one.
      h('a', {
        className: 'orb-card-get',
        href: item.url + '&download=1',
        download: item.name,
        title: '下载',
      }, '↓'),
    ),
  )
}

export function MediaCard({ block }: MediaCardProps): ReturnType<typeof h> | null {
  const [zoom, setZoom] = useState<MediaItem | null>(null)

  if (block.isError === true) {
    return h('div', { className: 'orb-card orb-card--error' },
      '媒体回显失败：' + (block.error?.code ?? block.error?.name ?? '未知原因'))
  }
  // Still running, or a settled call whose host did not attach a payload:
  // returning null hands the turn back to the generic tool row rather than
  // drawing an empty shell over it.
  const meta = readMeta(block)
  if (meta === undefined) return null

  return h('div', { className: 'orb-card' },
    meta.note === undefined ? null : h('p', { className: 'orb-card-note' }, meta.note),
    h('div', { className: 'orb-card-grid' },
      meta.items.map((item) => h(Frame, {
        key: item.path,
        item,
        onZoom: () => setZoom(item),
      })),
    ),
    zoom === null ? null : h('div', {
      className: 'orb-card-zoom',
      role: 'dialog',
      onClick: () => setZoom(null),
    }, h('img', { src: zoom.url, alt: zoom.name })),
  )
}

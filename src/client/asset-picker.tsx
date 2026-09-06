/**
 * The ComfyUI asset browser, as a modal.
 *
 * Ported from dsh-comfyui's load-area picker rather than reinvented, because
 * the material a reference image is chosen from already lives on that server
 * and the user already knows this dialog. A local file input would have been
 * less code and the wrong answer: it can only offer files the user can name on
 * disk, while most of what they want to reuse is something ComfyUI generated
 * ten minutes ago.
 *
 * Uploading and browsing are the same gesture here. A file dropped, pasted or
 * picked goes to the server first and then comes back as a card like any
 * other — so there is one notion of "material this workflow can load", not two.
 */
import { useEffect, useRef, useState } from 'react'

import { comfy } from './comfy.ts'

/** One file ComfyUI can load, as `/comfyui/loadarea` reports it. */
export interface AssetFile {
  name: string
  kind: 'image' | 'video' | 'audio'
  url: string
  source: 'imported' | 'generated'
  ts?: string
  workflowName?: string | null
}

export interface AssetPickerProps {
  /**
   * Only offer these kinds, and only accept these kinds from the file input.
   * Image references pass `['image']`, voice references `['audio']`.
   */
  kinds?: ReadonlyArray<AssetFile['kind']>
  /** Highlighted as the current choice. */
  current?: string | undefined
  onPick: (file: AssetFile) => void
  onClose: () => void
}

type SourceTab = 'all' | 'imported' | 'generated'

/**
 * The real URL of every file ComfyUI can load, by name.
 *
 * A reference is stored as a bare filename, because that is what a loader node
 * takes. Rendering it needs a URL, and the two ComfyUI directories — uploads
 * and generations — are served differently, so a URL guessed from the name is
 * wrong for whichever half the guess did not assume. Asking the load area is
 * the only way to be right, and both reference panels need the same answer.
 *
 * Returns an empty map until the fetch lands; callers fall back for that frame.
 */
export function useAssetUrls(): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map())
  useEffect(() => {
    let live = true
    void fetch('/comfyui/loadarea')
      .then((response) => response.json() as Promise<{ files?: Array<{ name: string; url: string }> }>)
      .then((data) => {
        if (!live) return
        setUrls((previous) => {
          const next = new Map(previous)
          for (const file of data.files ?? []) next.set(file.name, file.url)
          return next
        })
      })
      .catch(() => {})
    return () => { live = false }
  }, [])
  return urls
}

/** Where a file in ComfyUI's INPUT directory lives, when the map has no answer. */
export function inputAssetUrl(name: string): string {
  return '/comfyui/media?' + new URLSearchParams({ file: name, subfolder: '', type: 'input' }).toString()
}

export function AssetPicker({ kinds, current, onPick, onClose }: AssetPickerProps): JSX.Element {
  const [files, setFiles] = useState<AssetFile[]>([])
  const [tab, setTab] = useState<SourceTab>('all')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const hovering = useRef(false)

  async function refresh(): Promise<void> {
    try {
      const data = await fetch('/comfyui/loadarea').then((response) => response.json()) as
        { ok?: boolean; files?: AssetFile[] }
      setFiles(data.files ?? [])
      setError(null)
    } catch (cause) {
      setError('读不到 ComfyUI 的素材列表：' + (cause as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  // Escape closes, as a modal should.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  /** Paste only counts while the pointer is over the drop zone. */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (!hovering.current) return
      const file = event.clipboardData?.files?.[0]
      if (file === undefined) return
      event.preventDefault()
      void upload(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  async function upload(file: File): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const name = await comfy.uploadAsset(file)
      await refresh()
      setFlash('已上传：' + name)
      window.setTimeout(() => setFlash(null), 2500)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const wanted = kinds ?? ['image', 'video', 'audio']

  // The file input's filter follows the same list. It used to be a hard-coded
  // `image/*`, which made the audio picker refuse every file it was opened for
  // — the browser's dialog simply showed nothing selectable, with no error to
  // explain why.
  const accept = wanted.map((kind) => kind + '/*').join(',')
  const noun = wanted.length === 1
    ? { image: '图片', video: '视频', audio: '音频' }[wanted[0]!]
    : '素材'
  const visible = files
    .filter((file) => wanted.includes(file.kind))
    .filter((file) => tab === 'all' || file.source === tab)

  // Round-robin into three columns. CSS multi-column balances to the container
  // height and refuses to overflow, which is exactly wrong for a scrolling grid.
  const columns: AssetFile[][] = [[], [], []]
  visible.forEach((file, index) => { columns[index % 3]!.push(file) })

  const tabs: Array<{ id: SourceTab; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'imported', label: '已导入' },
    { id: 'generated', label: '已生成' },
  ]

  return (
    <div className="dcs-picker-overlay" onClick={onClose}>
      <div className="dcs-picker" onClick={(event) => event.stopPropagation()}>
        <div className="dcs-picker-bar">
          <div className="dcs-picker-tabs">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={'dcs-picker-tab' + (tab === entry.id ? ' dcs-picker-tab-active' : '')}
                onClick={() => setTab(entry.id)}
              >{entry.label}</button>
            ))}
          </div>

          <label
            className="dcs-dropzone"
            title="点击选择，或把文件拖进来 / 粘贴进来"
            onMouseEnter={() => { hovering.current = true }}
            onMouseLeave={() => { hovering.current = false }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              const file = event.dataTransfer.files[0]
              if (file !== undefined) void upload(file)
            }}
          >
            <input
              type="file"
              accept={accept}
              hidden
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file !== undefined) void upload(file)
              }}
            />
            {busy ? '上传中…' : '上传到服务器'}
          </label>

          <span className="dcs-spacer" />
          <button type="button" className="dcs-btn dcs-btn-small" onClick={onClose}>关闭</button>
        </div>

        {flash !== null ? <p className="dcs-note dcs-note-ok">{flash}</p> : null}
        {error !== null ? <p className="dcs-note dcs-note-error">{error}</p> : null}

        {loading
          ? <p className="dcs-picker-empty">读取中…</p>
          : visible.length === 0
            ? <p className="dcs-picker-empty">这里还没有{noun}。上传一个，或先生成一些。</p>
            : (
              <div className="dcs-picker-grid">
                {columns.map((column, index) => (
                  <div className="dcs-picker-col" key={index}>
                    {column.map((file) => (
                      <div
                        key={file.source + ':' + file.name}
                        role="button"
                        tabIndex={0}
                        className={'dcs-picker-card' + (file.name === current ? ' dcs-picker-card-active' : '')}
                        title={file.name + (file.workflowName == null ? '' : '　' + file.workflowName)}
                        onClick={() => onPick(file)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onPick(file)
                          }
                        }}
                      >
                        {file.kind === 'image'
                          ? <img className="dcs-picker-thumb" src={file.url} alt="" loading="lazy" />
                          : <span className="dcs-picker-thumb dcs-picker-thumb-other">
                            {file.kind === 'audio' ? '♪' : '▤'}
                          </span>}
                        <span className="dcs-picker-name">{file.name}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
      </div>
    </div>
  )
}

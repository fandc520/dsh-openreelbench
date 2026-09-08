/**
 * The trash — where 移除 puts a project, and the only way back out.
 *
 * It sits under the project list on the welcome screen and stays collapsed,
 * because it is a recovery path rather than a place anyone works. It is hidden
 * entirely when empty: an always-visible empty bin is noise on the screen a run
 * starts from.
 *
 * The two actions are deliberately asymmetric. 还原 is a file move and needs no
 * ceremony. 彻底删除 is the one irreversible operation in this plugin, so it
 * asks first and states the size it is about to destroy — a project can hold a
 * rendered film plus a batch of assets that cost real GPU time, and "how much
 * am I losing" is exactly what a person needs at that moment.
 */
import { useState } from 'react'

import { type TrashEntry, api } from './api.ts'
import { IconTrash } from './icons.tsx'

export interface TrashSectionProps {
  entries: readonly TrashEntry[]
  onChanged: () => Promise<void>
  onNotice: (text: string) => void
  onError: (text: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes === 0) return '空'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

export function TrashSection({ entries, onChanged, onNotice, onError }: TrashSectionProps): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  if (entries.length === 0) return null

  async function restore(entry: TrashEntry): Promise<void> {
    setBusy(entry.entry)
    try {
      const { id } = await api.restoreTrash(entry.entry)
      await onChanged()
      onNotice('「' + entry.title + '」已还原为项目 ' + id + '。')
    } catch (error) {
      onError((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function purge(entry: TrashEntry): Promise<void> {
    setBusy(entry.entry)
    try {
      await api.purgeTrash(entry.entry)
      await onChanged()
      onNotice('「' + entry.title + '」已彻底删除。')
    } catch (error) {
      onError((error as Error).message)
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  return (
    <section className="dcs-section">
      <button
        type="button"
        className="dcs-disclosure"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dcs-disclosure-caret">{open ? '▾' : '▸'}</span>
        <IconTrash className="dcs-section-icon" />
        回收站
        <span className="dcs-count">{entries.length}</span>
      </button>

      {open ? (
        <div className="dcs-trash">
          {entries.map((entry) => {
            const working = busy === entry.entry
            return (
              <div className="dcs-trash-row" key={entry.entry}>
                <div className="dcs-trash-body">
                  <span className="dcs-project-title">{entry.title}</span>
                  <span className="dcs-project-meta">
                    {entry.removed_at.slice(0, 10)} 移除 · {formatBytes(entry.bytes)} · 原 id {entry.id}
                  </span>
                </div>

                {confirming === entry.entry ? (
                  <div className="dcs-trash-actions">
                    <span className="dcs-hint dcs-note-error">彻底删除后无法恢复</span>
                    <button type="button" className="dcs-btn dcs-btn-small" disabled={working}
                      onClick={() => setConfirming(null)}>取消</button>
                    <button type="button" className="dcs-btn dcs-btn-small dcs-btn-danger" disabled={working}
                      onClick={() => void purge(entry)}>{working ? '删除中…' : '确认删除'}</button>
                  </div>
                ) : (
                  <div className="dcs-trash-actions">
                    <button type="button" className="dcs-btn dcs-btn-small" disabled={working}
                      onClick={() => void restore(entry)}>{working ? '还原中…' : '还原'}</button>
                    <button type="button" className="dcs-btn dcs-btn-small dcs-btn-quiet-danger" disabled={working}
                      onClick={() => setConfirming(entry.entry)}>彻底删除</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

/**
 * One project row on the welcome screen, with its overflow menu.
 *
 * The card body opens the project; the menu holds the actions that are not
 * "open". Rename edits in place rather than opening a dialog — it is one short
 * field, and a dialog for it would be more chrome than content.
 *
 * Removal asks first and says where the project went. It is a move into
 * `.trash`, not a delete, so the confirmation is a checkpoint rather than a
 * last warning — but a project holds a rendered film and a batch of generated
 * assets, and a single click in a dropdown should not carry them off silently.
 */
import { useEffect, useRef, useState } from 'react'

import type { LibraryProject } from './api.ts'

export interface ProjectCardProps {
  project: LibraryProject
  disabled: boolean
  onOpen: (projectId: string) => void
  onRename: (projectId: string, title: string) => Promise<void>
  onRemove: (projectId: string) => Promise<void>
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

export function ProjectCard({ project, disabled, onOpen, onRename, onRemove }: ProjectCardProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [mode, setMode] = useState<'idle' | 'renaming' | 'confirming'>('idle')
  const [title, setTitle] = useState(project.title)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)
  const renameInput = useRef<HTMLInputElement | null>(null)

  // A menu that stays open after a click elsewhere reads as a stuck overlay,
  // so it closes on any outside pointer press and on Escape.
  useEffect(() => {
    if (!menuOpen) return undefined
    function onPointerDown(event: PointerEvent): void {
      if (root.current !== null && !root.current.contains(event.target as Node)) setMenuOpen(false)
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (mode === 'renaming') renameInput.current?.focus()
  }, [mode])

  useEffect(() => { setTitle(project.title) }, [project.title])

  async function commitRename(): Promise<void> {
    const next = title.trim()
    if (next === '' || next === project.title) {
      setMode('idle')
      setTitle(project.title)
      return
    }
    setBusy(true)
    try {
      await onRename(project.id, next)
      setMode('idle')
    } finally {
      setBusy(false)
    }
  }

  async function commitRemove(): Promise<void> {
    setBusy(true)
    try {
      await onRemove(project.id)
    } finally {
      setBusy(false)
      setMode('idle')
    }
  }

  if (mode === 'renaming') {
    return (
      <div className="orb-project orb-project-editing" ref={root}>
        <input
          ref={renameInput}
          className="orb-input"
          value={title}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void commitRename()
            if (event.key === 'Escape') { setTitle(project.title); setMode('idle') }
          }}
        />
        <div className="orb-project-actions">
          <button type="button" className="orb-btn orb-btn-small" disabled={busy}
            onClick={() => { setTitle(project.title); setMode('idle') }}>取消</button>
          <button type="button" className="orb-btn orb-btn-small orb-btn-primary" disabled={busy}
            onClick={() => void commitRename()}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </div>
    )
  }

  if (mode === 'confirming') {
    return (
      <div className="orb-project orb-project-editing" ref={root}>
        <span className="orb-project-title">移除「{project.title}」？</span>
        <span className="orb-project-meta">
          移到回收站，不是删除——素材和成片都还在，可以手动移回来。
        </span>
        <div className="orb-project-actions">
          <button type="button" className="orb-btn orb-btn-small" disabled={busy}
            onClick={() => setMode('idle')}>取消</button>
          <button type="button" className="orb-btn orb-btn-small orb-btn-danger" disabled={busy}
            onClick={() => void commitRemove()}>{busy ? '移除中…' : '移除'}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="orb-project" ref={root}>
      <button
        type="button"
        className="orb-project-body"
        disabled={disabled}
        onClick={() => onOpen(project.id)}
      >
        <span className="orb-project-title">{project.title}</span>
        <span className="orb-project-meta">
          {project.created_at.slice(0, 10)} · {formatBytes(project.total_bytes)}
        </span>
      </button>

      <button
        type="button"
        className="orb-kebab"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="更多操作"
        title="更多操作"
        onClick={() => setMenuOpen((open) => !open)}
      >
        ⋯
      </button>

      {menuOpen ? (
        <div className="orb-menu" role="menu">
          <button type="button" role="menuitem" className="orb-menu-item"
            onClick={() => { setMenuOpen(false); onOpen(project.id) }}>编辑</button>
          <button type="button" role="menuitem" className="orb-menu-item"
            onClick={() => { setMenuOpen(false); setMode('renaming') }}>重命名</button>
          <button type="button" role="menuitem" className="orb-menu-item orb-menu-item-danger"
            onClick={() => { setMenuOpen(false); setMode('confirming') }}>移除</button>
        </div>
      ) : null}
    </div>
  )
}

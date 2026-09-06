/**
 * The welcome screen — where a run starts.
 *
 * There is no "pick a pipeline" dropdown on purpose. The user states what they
 * want; a pipeline button only prefixes the box with a command token so the
 * model does not have to infer the pipeline from prose. Choosing stays a
 * sentence, which is the shape this whole product takes.
 *
 * Submitting sends the text into the conversation and then watches the project
 * list for something created after that moment. The panel has no push channel
 * from the host, and the model creates the project through its own tool call,
 * so polling for the new project is what turns "the model acted" into "the
 * panel moved on". The wait is bounded — a run that never produces a project
 * leaves the user back at the box rather than spinning forever.
 */
import { useEffect, useRef, useState } from 'react'

import { type AgentPhase, BusyLabel } from './busy.tsx'
import { type Catalog, type LibraryProject, api } from './api.ts'
import { ProjectCard } from './project-card.tsx'
import { TrashSection } from './trash.tsx'
import type { TrashEntry } from './api.ts'

const PLACEHOLDER = '说一句你想做的片子，例如：做一条讲月球起源的解说片，30 秒，画风冷静一点'

export interface WelcomeProps {
  catalog: Catalog | undefined
  projects: readonly LibraryProject[]
  /** Push text into the session; resolves once the host accepts it. */
  onSend: (text: string) => Promise<void>
  onOpenProject: (projectId: string) => void
  onRefresh: () => Promise<LibraryProject[]>
  trash: readonly TrashEntry[]
  onRefreshTrash: () => Promise<void>
}

export function Welcome({
  catalog, projects, onSend, onOpenProject, onRefresh, trash, onRefreshTrash,
}: WelcomeProps): JSX.Element {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<AgentPhase | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const cancelled = useRef(false)

  useEffect(() => () => { cancelled.current = true }, [])

  /** Put the pipeline's command in the box and leave the cursor after it. */
  function pickPipeline(command: string): void {
    const rest = text.replace(/^\/\S+\s*/, '')
    const next = command + ' ' + rest
    setText(next)
    const element = inputRef.current
    if (element !== null) {
      element.focus()
      requestAnimationFrame(() => element.setSelectionRange(next.length, next.length))
    }
  }

  async function submit(): Promise<void> {
    const value = text.trim()
    if (value === '' || phase !== null) return
    setPhase('sending')
    setError(null)
    const known = new Set(projects.map((project) => project.id))
    try {
      await onSend(value)
      setText('')
      setPhase('creating')
      // Up to two minutes: creating a project is one tool call, but the model
      // may be finishing something else first.
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        if (cancelled.current) return
        const latest = await onRefresh().catch(() => [])
        const created = latest.find((project) => !known.has(project.id))
        if (created !== undefined) {
          setPhase(null)
          onOpenProject(created.id)
          return
        }
      }
      setPhase(null)
      setError('等了两分钟没等到新项目。可能 Agent 还在忙，或者它没有建项目——去对话里看看。')
    } catch (failure) {
      setPhase(null)
      setError((failure as Error).message)
    }
  }

  const busy = phase !== null

  return (
    <div className="dcs-welcome">
      <header className="dcs-hero">
        <h1 className="dcs-hero-title">ComfyUI 创意工作室</h1>
        <p className="dcs-hero-sub">ComfyUI Creative Studio</p>
        <p className="dcs-hero-line">一句需求到一条成片。生成走 ComfyUI，合成走 FFmpeg，每一步都停下来等你点头。</p>
      </header>

      <div className="dcs-composer">
        <textarea
          ref={inputRef}
          className="dcs-composer-input"
          value={text}
          placeholder={PLACEHOLDER}
          rows={3}
          disabled={busy}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <div className="dcs-composer-foot">
          <span className="dcs-hint">⌘/Ctrl + Enter 发送</span>
          <span className="dcs-spacer" />
          <button
            type="button"
            className="dcs-btn dcs-btn-primary"
            disabled={busy || text.trim() === ''}
            onClick={() => void submit()}
          >
            <BusyLabel phase={phase} idle="开始" />
          </button>
        </div>
      </div>

      {error !== null ? <p className="dcs-note dcs-note-error">{error}</p> : null}
      {notice !== null ? <p className="dcs-note">{notice}</p> : null}

      <section className="dcs-section">
        <h2 className="dcs-section-title">创作媒体类型</h2>
        <div className="dcs-pipelines">
          {(catalog?.pipelines ?? []).map((pipeline) => (
            <button
              key={pipeline.id}
              type="button"
              className="dcs-pipeline"
              disabled={busy}
              title={pipeline.description}
              onClick={() => pickPipeline(pipeline.command)}
            >
              <span className="dcs-pipeline-name">{pipeline.name}</span>
              <span className="dcs-pipeline-desc">{pipeline.best_for}</span>
            </button>
          ))}
        </div>
      </section>

      {projects.length > 0 ? (
        <section className="dcs-section">
          <h2 className="dcs-section-title">继续之前的项目</h2>
          <div className="dcs-projects">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                disabled={busy}
                onOpen={onOpenProject}
                onRename={async (id, title) => {
                  await api.updateProject({ project: id, title })
                  await onRefresh()
                }}
                onRemove={async (id) => {
                  await api.removeProject(id)
                  await onRefresh()
                  await onRefreshTrash()
                  setNotice('已移到回收站，可以在下方还原。')
                }}
              />
            ))}
          </div>
        </section>
      ) : null}

      <TrashSection
        entries={trash}
        onChanged={async () => { await onRefresh(); await onRefreshTrash() }}
        onNotice={(text) => { setError(null); setNotice(text) }}
        onError={(text) => { setNotice(null); setError(text) }}
      />
    </div>
  )
}

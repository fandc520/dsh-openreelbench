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
import { useEffect, useRef, useState, type ComponentType } from 'react'

import { type AgentPhase, BusyLabel } from './busy.tsx'
import { type Catalog, type LibraryProject, api } from './api.ts'
import { IconClapper, IconHistory, IconSpark } from './icons.tsx'
import { ProjectCard } from './project-card.tsx'
import { TrashSection } from './trash.tsx'
import type { TrashEntry } from './api.ts'

const PLACEHOLDER = '说一句你想做的片子，例如：做一条讲月球起源的解说片，30 秒，画风冷静一点'

/**
 * Poster backdrop geometry, in the art's 720×240 viewBox space.
 *
 * Fixed coordinates rather than random ones: the backdrop is identical on
 * every load, so it reads as a poster instead of as noise reshuffling.
 */
const STARS: ReadonlyArray<{ x: number; y: number; r: number; delay: number; dur: number }> = [
  { x: 36, y: 30, r: 1.2, delay: 0, dur: 3.8 },
  { x: 74, y: 96, r: 0.9, delay: 1.2, dur: 4.6 },
  { x: 112, y: 24, r: 1.6, delay: 2.1, dur: 3.2 },
  { x: 148, y: 140, r: 1.0, delay: 0.6, dur: 5.2 },
  { x: 186, y: 58, r: 1.3, delay: 1.8, dur: 4.1 },
  { x: 222, y: 22, r: 0.8, delay: 2.9, dur: 3.6 },
  { x: 258, y: 110, r: 1.5, delay: 0.3, dur: 4.9 },
  { x: 296, y: 48, r: 0.9, delay: 3.4, dur: 3.9 },
  { x: 330, y: 16, r: 1.2, delay: 1.5, dur: 4.4 },
  { x: 368, y: 128, r: 1.0, delay: 2.4, dur: 5.0 },
  { x: 402, y: 34, r: 1.7, delay: 0.9, dur: 3.3 },
  { x: 438, y: 88, r: 0.8, delay: 3.1, dur: 4.7 },
  { x: 476, y: 20, r: 1.3, delay: 1.1, dur: 3.7 },
  { x: 512, y: 132, r: 1.1, delay: 2.7, dur: 4.3 },
  { x: 548, y: 56, r: 0.9, delay: 0.4, dur: 5.4 },
  { x: 584, y: 104, r: 1.4, delay: 1.9, dur: 3.5 },
  { x: 620, y: 26, r: 1.0, delay: 3.6, dur: 4.8 },
  { x: 656, y: 84, r: 1.5, delay: 0.7, dur: 3.9 },
  { x: 688, y: 36, r: 0.9, delay: 2.2, dur: 4.2 },
  { x: 668, y: 156, r: 1.2, delay: 1.4, dur: 5.1 },
  { x: 96, y: 170, r: 1.1, delay: 2.8, dur: 4.5 },
  { x: 300, y: 168, r: 0.8, delay: 0.2, dur: 3.4 },
  { x: 470, y: 172, r: 1.0, delay: 3.3, dur: 5.3 },
  { x: 590, y: 60, r: 0.7, delay: 1.7, dur: 4.0 },
]

/**
 * One glyph per pipeline, looked up by the pipeline's stable id. A pipeline
 * without an entry falls back to the generic spark — adding a pipeline must
 * not wait on this file, and an unadorned tag still reads fine.
 */
const PIPELINE_ICONS: Record<string, ComponentType> = {
  'explainer-stills': IconClapper,
}

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
  // History collapses but starts open: on the screen a run starts from, the
  // list is the fastest way back into work, and hiding it by default would
  // trade one scroll line for one extra click every visit.
  const [historyOpen, setHistoryOpen] = useState(true)
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
        <div className="dcs-poster">
          <svg
            className="dcs-poster-art"
            viewBox="0 0 720 240"
            preserveAspectRatio="xMidYMax slice"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id="dcs-poster-bg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#111537" />
                <stop offset="100%" stopColor="#05060f" />
              </linearGradient>
              <radialGradient id="dcs-glow-violet">
                <stop offset="0%" stopColor="#7c5cff" stopOpacity="0.5" />
                <stop offset="100%" stopColor="#7c5cff" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="dcs-glow-teal">
                <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.42" />
                <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="dcs-glow-indigo">
                <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.46" />
                <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="dcs-poster-vignette">
                <stop offset="55%" stopColor="#05060f" stopOpacity="0" />
                <stop offset="100%" stopColor="#05060f" stopOpacity="0.5" />
              </radialGradient>
              <filter id="dcs-poster-blur" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="42" />
              </filter>
            </defs>

            <rect width="720" height="240" fill="url(#dcs-poster-bg)" />

            <g filter="url(#dcs-poster-blur)">
              <ellipse className="dcs-poster-drift-a" cx="150" cy="64" rx="240" ry="110" fill="url(#dcs-glow-violet)" />
              <ellipse className="dcs-poster-drift-b" cx="568" cy="46" rx="230" ry="100" fill="url(#dcs-glow-teal)" />
              <ellipse className="dcs-poster-drift-c" cx="368" cy="196" rx="280" ry="110" fill="url(#dcs-glow-indigo)" />
            </g>

            <g>
              {STARS.map((star, index) => (
                <circle
                  key={index}
                  className="dcs-poster-star"
                  cx={star.x}
                  cy={star.y}
                  r={star.r}
                  fill="#dfe3ff"
                  style={{ animationDelay: star.delay + 's', animationDuration: star.dur + 's' }}
                />
              ))}
            </g>

            <rect width="720" height="240" fill="url(#dcs-poster-vignette)" />
          </svg>
          {/* The film strip is HTML, not SVG: inside the poster it would scale
              with the banner's width, and a wide window widened the sprocket
              holes. Fixed pixels keep the strip identical at every size. */}
          <div className="dcs-poster-strip" aria-hidden="true" />
          <div className="dcs-poster-body">
            <span className="dcs-hero-sub">ComfyUI Creative Studio</span>
            <h1 className="dcs-hero-title">ComfyUI 创意工作室</h1>
            <p className="dcs-hero-tagline">
              基于 ComfyUI 与 DSH 开源生态的内容创作平台 —— 专业创作管线 · 原生 AI 人机协同
            </p>
          </div>
        </div>
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
        <h2 className="dcs-section-title">
          <IconClapper className="dcs-section-icon" />
          创作媒体类型
        </h2>
        <div className="dcs-pipelines">
          {(catalog?.pipelines ?? []).map((pipeline) => {
            const Icon = PIPELINE_ICONS[pipeline.id] ?? IconSpark
            return (
              <button
                key={pipeline.id}
                type="button"
                className="dcs-pipeline"
                disabled={busy}
                title={pipeline.description + '（' + pipeline.best_for + '）'}
                onClick={() => pickPipeline(pipeline.command)}
              >
                <Icon className="dcs-pipeline-icon" />
                <span className="dcs-pipeline-name">{pipeline.name}</span>
              </button>
            )
          })}
        </div>
      </section>

      {projects.length > 0 ? (
        <section className="dcs-section">
          <button
            type="button"
            className="dcs-disclosure"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <span className="dcs-disclosure-caret">{historyOpen ? '▾' : '▸'}</span>
            <IconHistory className="dcs-section-icon" />
            历史项目
            <span className="dcs-count">{projects.length}</span>
          </button>
          {historyOpen ? (
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
          ) : null}
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

/**
 * OpenReel 创意台 — the session-scoped pipeline panel.
 *
 * It holds two things and nothing else: which project this session is looking
 * at, and which step of that project is on screen. Everything else is derived
 * from `/openreel/state`, so the panel never keeps a second copy of pipeline
 * state that could drift from the checkpoints on disk.
 *
 * The selected project lives in component state rather than anywhere durable.
 * A session is a conversation about one production, and losing the selection on
 * reload just returns the user to the welcome screen with their project listed
 * one click away — cheaper than inventing a persistence story for it.
 *
 * Screens are looked up from the pipeline definition, so adding the script or
 * timeline screen is registering a component under its `ScreenId`, not editing
 * this file's control flow.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { type Catalog, type LibraryProject, type ScreenId, type PluginState, type TrashEntry, api } from './api.ts'
import { ProjectScreen } from './project-screen.tsx'
import { ShotsScreen } from './shots-screen.tsx'
import { TimelineScreen } from './timeline-screen.tsx'
import { ScriptScreen } from './script-screen.tsx'
import { AudioScreen } from './audio-screen.tsx'
import { Rail, buildRail } from './rail.tsx'
import { Welcome } from './welcome.tsx'
import { readMemory, takePendingScreen, writeMemory } from './session-memory.ts'

export interface WorkbenchProps {
  /** Push text into this session; the panel's only way to reach the model. */
  send: (text: string) => Promise<void>
  /** Which session this panel belongs to; the key its memory is filed under. */
  sessionId: string
}

interface ScreenProps {
  state: PluginState
  onReload: () => Promise<void>
  onSend: (text: string) => Promise<void>
  onGoToStage: (stageId: string) => void
  /** Only the timeline screen uses these; the rest ignore them. */
  cutId: string
  onSelectCut: (id: string) => void
}

/**
 * The screen registry.
 *
 * A lookup rather than a chain of conditions: the previous shape carried a
 * deny-list of "screens that are done", and adding one meant remembering to
 * edit it in two places. It was not remembered — the shots screen rendered with
 * a "this page is not built yet" notice underneath it. A registry cannot fall
 * into that state: an entry exists or it does not.
 */
const SCREENS: Partial<Record<ScreenId, (props: ScreenProps) => JSX.Element>> = {
  project: (props) => <ProjectScreen {...props} />,
  script: (props) => <ScriptScreen {...props} />,
  'assets-audio': (props) => <AudioScreen {...props} />,
  'assets-shots': (props) => <ShotsScreen {...props} />,
  timeline: (props) => <TimelineScreen {...props} />,
}

/** Screens implemented so far. A missing one renders its own placeholder. */
const SCREEN_TITLES: Record<ScreenId, string> = {
  project: '项目详情',
  script: '脚本',
  'assets-audio': '配音',
  'assets-shots': '配图',
  timeline: '时间线',
}

export function Workbench({ send, sessionId }: WorkbenchProps): JSX.Element {
  // Restored on mount so a trip to the chat tab and back lands where it left.
  // A pending target from a tool card wins over the remembered position.
  const restored = (() => {
    const pending = takePendingScreen(sessionId)
    if (pending !== null) {
      writeMemory(sessionId, { projectId: pending.projectId, stage: pending.stage })
      return { projectId: pending.projectId, stage: pending.stage }
    }
    return readMemory(sessionId)
  })()

  const [catalog, setCatalog] = useState<Catalog | undefined>(undefined)
  const [projects, setProjects] = useState<LibraryProject[]>([])
  const [trash, setTrash] = useState<TrashEntry[]>([])
  const [projectId, setProjectId] = useState<string | null>(restored.projectId)
  const [state, setState] = useState<PluginState | undefined>(undefined)
  const [activeStage, setActiveStage] = useState<string | null>(restored.stage)
  /**
   * Which edit version the panel is looking at.
   *
   * It lives here beside the project because it is the same kind of fact — part
   * of "what am I looking at" — and because `reload` has to carry it. While the
   * timeline screen owned it alone, every refresh fetched the plan instead of
   * the cut, so an edit saved correctly and then vanished from the very view
   * that made it.
   */
  const [cutId, setCutId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refreshProjects = useCallback(async (): Promise<LibraryProject[]> => {
    const { projects: found } = await api.library()
    setProjects(found)
    return found
  }, [])

  const refreshTrash = useCallback(async (): Promise<void> => {
    const { entries } = await api.trash()
    setTrash(entries)
  }, [])

  useEffect(() => {
    let live = true
    void api.catalog().then((value) => { if (live) setCatalog(value) }).catch(() => {})
    void refreshProjects().catch(() => {})
    void refreshTrash().catch(() => {})
    return () => { live = false }
  }, [refreshProjects, refreshTrash])

  /**
   * Land on the newest saved cut rather than the plan.
   *
   * The plan is read-only, so any edit made while it is selected silently opens
   * yet another version — someone returning to a film they were cutting would
   * accumulate one per visit without noticing. Only the first load of a project
   * picks; after that an explicit choice of 计划版本 stands.
   */
  const autoPicked = useRef<string | null>(null)
  useEffect(() => {
    if (projectId === null || state === undefined) return
    if (autoPicked.current === projectId) return
    autoPicked.current = projectId
    const newest = state.cuts[0]
    if (cutId === '' && newest !== undefined) setCutId(newest.id)
  }, [projectId, state, cutId])

  const reload = useCallback(async (): Promise<void> => {
    if (projectId === null) return
    setLoading(true)
    try {
      const next = await api.state(projectId, cutId)
      setState(next)
      setError(null)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setLoading(false)
    }
  }, [projectId, cutId])

  useEffect(() => {
    if (projectId === null) {
      setState(undefined)
      return
    }
    void reload()
  }, [projectId, reload])

  /**
   * Keep the open project fresh while the panel is on screen.
   *
   * The model writes artifacts through its own tool calls and the panel has no
   * push channel, so without this a brief drafted a second after the screen
   * opened stays invisible until something else forces a re-read. Polling stops
   * while the tab is hidden — an unseen panel has no reason to ask.
   */
  useEffect(() => {
    if (projectId === null) return undefined
    const timer = setInterval(() => {
      if (!document.hidden) void reload()
    }, 5000)
    const onVisible = (): void => { if (!document.hidden) void reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [projectId, reload])

  function openProject(id: string): void {
    setActiveStage(null)
    setCutId('')
    autoPicked.current = null
    setError(null)
    setProjectId(id)
    writeMemory(sessionId, { projectId: id, stage: null })
  }

  function selectStage(stageId: string): void {
    setActiveStage(stageId)
    writeMemory(sessionId, { stage: stageId })
  }

  function backToWelcome(): void {
    setProjectId(null)
    setActiveStage(null)
    writeMemory(sessionId, { projectId: null, stage: null })
    void refreshProjects().catch(() => {})
    void refreshTrash().catch(() => {})
  }

  if (projectId === null) {
    return (
      <div className="orb-workbench">
        <Welcome
          catalog={catalog}
          projects={projects}
          onSend={send}
          onOpenProject={openProject}
          onRefresh={refreshProjects}
          trash={trash}
          onRefreshTrash={refreshTrash}
        />
      </div>
    )
  }

  if (state === undefined) {
    return (
      <div className="orb-workbench orb-centered">
        {error === null
          ? <p className="orb-note">读取项目中…</p>
          : (
            <div className="orb-empty">
              <p className="orb-note orb-note-error">{error}</p>
              <button type="button" className="orb-btn" onClick={backToWelcome}>返回</button>
            </div>
          )}
      </div>
    )
  }

  const steps = buildRail(state.pipeline.definition.stages, state.stages, activeStage)
  const current = steps.find((step) => step.current) ?? steps[0]!
  const screen = current.stage.screen

  return (
    <div className="orb-workbench">
      <header className="orb-topbar">
        <button type="button" className="orb-back" onClick={backToWelcome} title="回到欢迎页">←</button>
        <div className="orb-topbar-body">
          <span className="orb-topbar-title">{state.project.title}</span>
          <span className="orb-topbar-meta">
            {state.pipeline.definition.name} · {state.project.target_duration_seconds}s ·
            {' '}{state.style.playbook.name}
            {state.project.voice === '' ? ' · 音色未定' : ' · ' + state.project.voice}
          </span>
        </div>
        <button type="button" className="orb-btn" disabled={loading} onClick={() => void reload()}>
          {loading ? '刷新中…' : '刷新'}
        </button>
      </header>

      <Rail steps={steps} onSelect={selectStage} />

      {error !== null ? <p className="orb-note orb-note-error">{error}</p> : null}

      {/* One path only. Two hand-written conditionals for project and script
          outlived the registry above and rendered those two screens twice —
          the exact two-places failure the registry was introduced to end. */}
      {SCREENS[screen] !== undefined
        ? SCREENS[screen]!({
          state,
          onReload: reload,
          onSend: send,
          onGoToStage: setActiveStage,
          cutId,
          onSelectCut: setCutId,
        })
        : (
          <div className="orb-screen orb-placeholder">
            <h2 className="orb-screen-title">{SCREEN_TITLES[screen]}</h2>
            <p className="orb-note">
              这一页还没做。当前阶段 <code>{current.stage.id}</code>，状态 <code>{current.status}</code>。
            </p>
            <p className="orb-hint">{current.stage.hint}</p>
          </div>
        )}
    </div>
  )
}

/**
 * Where the workbench was, per session.
 *
 * The conversation view ring unmounts the inactive view, so switching to chat
 * and back destroys the panel's React state. Without this, every tab switch
 * dropped the user back on the welcome screen — the panel forgot a project they
 * were in the middle of.
 *
 * Module scope rather than component state, because the point is to outlive the
 * component. Keyed by session, because two sessions are two productions and
 * must not steer each other. It deliberately does not persist across a page
 * load: the map is a convenience for tab switching, not a durable record, and a
 * reload landing on the welcome screen with the project one click away is fine.
 *
 * `pendingScreen` exists for a limitation worth stating plainly: a plugin
 * cannot switch the conversation's active view tab — `setView` lives in
 * ui-conversation's private store with no service behind it. So a tool card
 * that wants to send someone to a stage cannot open the panel; it records where
 * that person should land, and the panel honours it the next time it mounts.
 */

export interface WorkbenchMemory {
  projectId: string | null
  /** Stage the user last looked at, or null to follow the run. */
  stage: string | null
  /** One-shot target set from outside the panel; consumed on the next mount. */
  pendingScreen: { projectId: string; stage: string } | null
}

const EMPTY: WorkbenchMemory = { projectId: null, stage: null, pendingScreen: null }

const memory = new Map<string, WorkbenchMemory>()

export function readMemory(sessionId: string): WorkbenchMemory {
  return memory.get(sessionId) ?? EMPTY
}

export function writeMemory(sessionId: string, patch: Partial<WorkbenchMemory>): void {
  memory.set(sessionId, { ...readMemory(sessionId), ...patch })
}

/**
 * Ask the panel to open a stage the next time it mounts in this session.
 * Called from a tool card, which has no way to bring the panel forward itself.
 */
export function requestScreen(sessionId: string, projectId: string, stage: string): void {
  writeMemory(sessionId, { pendingScreen: { projectId, stage } })
}

/** Take the pending target, if any, and clear it. */
export function takePendingScreen(sessionId: string): { projectId: string; stage: string } | null {
  const pending = readMemory(sessionId).pendingScreen
  if (pending !== null) writeMemory(sessionId, { pendingScreen: null })
  return pending
}

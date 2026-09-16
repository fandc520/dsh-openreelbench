/**
 * "The agent is working" indicators.
 *
 * The panel cannot see what the model is doing — it has no channel into the
 * turn. What it can honestly report is what *it* is waiting for, so a phase is
 * named after the panel's own expectation ("waiting for a project to appear"),
 * never after a mental state it would be guessing at.
 *
 * Phases live in one table so adding another is an entry plus the call site
 * that sets it, not a new piece of UI.
 */

import { tx } from './i18n.ts'

export const AGENT_PHASES = {
  sending: '发送中',
  thinking: 'Agent 思考中',
  researching: '资料查阅中',
  creating: '创建项目中',
  drafting: '起草简报中',
  regenerating: '重新生成中',
  generating: 'Agent 生成中',
  importing: '回填素材中',
} as const

export type AgentPhase = keyof typeof AGENT_PHASES

/**
 * Translated HERE, not in the table above.
 *
 * `AGENT_PHASES` is a module-level constant: a `tx()` inside it would run once,
 * at import, while the language store is still on its default — and then never
 * again. Every constant table in this bundle keeps its Chinese and is
 * translated at the point of display, for that reason.
 */
export function phaseLabel(phase: AgentPhase): string {
  return tx(AGENT_PHASES[phase])
}

/** A small ring that keeps turning while a phase is active. */
export function Spinner(): JSX.Element {
  return <span className="orb-spinner" aria-hidden="true" />
}

export interface BusyLabelProps {
  phase: AgentPhase | null
  /** Shown when no phase is active. */
  idle: string
}

/** Button content: a spinner and the phase name, or the idle label. */
export function BusyLabel({ phase, idle }: BusyLabelProps): JSX.Element {
  if (phase === null) return <>{idle}</>
  return (
    <span className="orb-busy">
      <Spinner />
      {phaseLabel(phase)}
    </span>
  )
}

/**
 * The step rail — the workbench's "where am I" strip.
 *
 * A step is reachable only when every earlier stage is completed, which is the
 * same rule the state machine's prerequisite check enforces on the host. The
 * rail does not invent that rule; it projects it, so a locked step in the UI
 * and a `PREREQUISITE VIOLATION` from the API can never disagree.
 *
 * Each step leads with its stage glyph; a completed step swaps the glyph for a
 * check. Thin links between the cards carry the "one line" reading a pipeline
 * should have. Gate state is drawn separately from completion because they are
 * different facts: a stage can be completed without approval (an ungated one),
 * and a gated stage sitting at `awaiting_human` is the one place the run stops
 * for a person.
 */
import { Fragment, type ComponentType } from 'react'

import { IconClapper, IconImage, IconMic, IconPen, IconPlay, type IconProps } from './icons.tsx'
import type { PipelineStage, StageView } from './api.ts'
import { tx } from './i18n.ts'

export interface RailStep {
  stage: PipelineStage
  view: StageView | undefined
  status: StageView['status']
  reachable: boolean
  current: boolean
}

/** One glyph per stage, keyed by the stage id the host defines. */
const STAGE_ICONS: Record<string, ComponentType<IconProps>> = {
  brief: IconClapper,
  script: IconPen,
  assets_audio: IconMic,
  assets_shots: IconImage,
  compose: IconPlay,
}

/**
 * Join the pipeline definition with the live stage states.
 * @param active - the stage the user is looking at, or null to follow the run.
 */
export function buildRail(
  stages: readonly PipelineStage[],
  views: readonly StageView[],
  active: string | null,
): RailStep[] {
  const byId = new Map(views.map((view) => [view.stage, view]))
  const steps: RailStep[] = []
  let reachable = true

  for (const stage of stages) {
    const view = byId.get(stage.id)
    const status = view?.status ?? 'pending'
    steps.push({ stage, view, status, reachable, current: false })
    // The next step opens only once this one is genuinely done — completed,
    // and approved when it is a gate.
    if (!(status === 'completed' && (!stage.gated || view?.human_approved === true))) {
      reachable = false
    }
  }

  const currentId = active ?? steps.find((step) => step.status !== 'completed')?.stage.id
    ?? steps[steps.length - 1]?.stage.id
  for (const step of steps) step.current = step.stage.id === currentId
  return steps
}

/**
 * What a step says about itself.
 *
 * A gate is not a separate badge — it only ever shows up as one of two states,
 * and naming those states says more than labelling the step "闸" and making the
 * reader work out what that implies. 待确认 is the only place the run stops for
 * a person; 已审核 is the only thing that lets it continue.
 */
function statusText(step: RailStep): { label: string; tone: 'idle' | 'active' | 'wait' | 'ok' | 'bad' } {
  if (step.status === 'failed') return { label: tx('失败'), tone: 'bad' }
  if (step.status === 'awaiting_human') return { label: tx('待确认'), tone: 'wait' }
  if (step.status === 'in_progress') return { label: tx('进行中'), tone: 'active' }
  if (step.status === 'completed') {
    if (!step.stage.gated) return { label: tx('已完成'), tone: 'ok' }
    return step.view?.human_approved === true
      ? { label: tx('已审核'), tone: 'ok' }
      : { label: tx('待确认'), tone: 'wait' }
  }
  return { label: tx('未开始'), tone: 'idle' }
}

export interface RailProps {
  steps: readonly RailStep[]
  onSelect: (stageId: string) => void
}

export function Rail({ steps, onSelect }: RailProps): JSX.Element {
  return (
    <nav className="orb-rail" aria-label={tx('管线步骤')}>
      {steps.map((step, index) => {
        const classes = ['orb-step']
        if (step.current) classes.push('orb-step-current')
        if (!step.reachable) classes.push('orb-step-locked')
        classes.push('orb-step-' + step.status)
        const locked = !step.reachable && !step.current
        const status = statusText(step)
        const Icon = STAGE_ICONS[step.stage.id]
        return (
          <Fragment key={step.stage.id}>
            {index > 0 ? <span className="orb-rail-link" aria-hidden="true" /> : null}
            <button
              type="button"
              className={classes.join(' ')}
              disabled={locked}
              title={locked ? tx('前一步没完成，这一步进不去') : tx(step.stage.hint)}
              onClick={() => onSelect(step.stage.id)}
            >
              <span className="orb-step-index">
                {step.status === 'completed'
                  ? '✓'
                  : Icon !== undefined
                    ? <Icon className="orb-step-glyph" />
                    : index + 1}
              </span>
              <span className="orb-step-body">
                <span className="orb-step-label">{tx(step.stage.label)}</span>
                <span className={'orb-step-status orb-tone-' + status.tone}>{status.label}</span>
              </span>
            </button>
          </Fragment>
        )
      })}
    </nav>
  )
}

/**
 * The step rail — the workbench's "where am I" strip.
 *
 * A step is reachable only when every earlier stage is completed, which is the
 * same rule the state machine's prerequisite check enforces on the host. The
 * rail does not invent that rule; it projects it, so a locked step in the UI
 * and a `PREREQUISITE VIOLATION` from the API can never disagree.
 *
 * Gate state is drawn separately from completion because they are different
 * facts: a stage can be completed without approval (an ungated one), and a
 * gated stage sitting at `awaiting_human` is the one place the run stops for
 * a person.
 */
import type { PipelineStage, StageView } from './api.ts'

export interface RailStep {
  stage: PipelineStage
  view: StageView | undefined
  status: StageView['status']
  reachable: boolean
  current: boolean
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
  if (step.status === 'failed') return { label: '失败', tone: 'bad' }
  if (step.status === 'awaiting_human') return { label: '待确认', tone: 'wait' }
  if (step.status === 'in_progress') return { label: '进行中', tone: 'active' }
  if (step.status === 'completed') {
    if (!step.stage.gated) return { label: '已完成', tone: 'ok' }
    return step.view?.human_approved === true
      ? { label: '已审核', tone: 'ok' }
      : { label: '待确认', tone: 'wait' }
  }
  return { label: '未开始', tone: 'idle' }
}

export interface RailProps {
  steps: readonly RailStep[]
  onSelect: (stageId: string) => void
}

export function Rail({ steps, onSelect }: RailProps): JSX.Element {
  return (
    <nav className="dcs-rail" aria-label="管线步骤">
      {steps.map((step, index) => {
        const classes = ['dcs-step']
        if (step.current) classes.push('dcs-step-current')
        if (!step.reachable) classes.push('dcs-step-locked')
        classes.push('dcs-step-' + step.status)
        const locked = !step.reachable && !step.current
        const status = statusText(step)
        return (
          <button
            key={step.stage.id}
            type="button"
            className={classes.join(' ')}
            disabled={locked}
            title={locked ? '前一步没完成，这一步进不去' : step.stage.hint}
            onClick={() => onSelect(step.stage.id)}
          >
            <span className="dcs-step-index">{index + 1}</span>
            <span className="dcs-step-body">
              <span className="dcs-step-label">{step.stage.label}</span>
              <span className={'dcs-step-status dcs-tone-' + status.tone}>{status.label}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}

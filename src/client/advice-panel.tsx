/**
 * The advice panel — one shell for every "we checked this" surface.
 *
 * Two screens run quality checks and both need to say the same three things:
 * that a check happened, what it found, and whether it matters. They were
 * drifting apart — the shots screen grew a collapsible dark panel while the
 * compose screen still hid its score entirely when the film was fine, which is
 * the failure this shell exists to prevent: an empty screen cannot tell you
 * that anything was checked.
 *
 * ALWAYS RENDERED, EVEN WHEN CLEAN. Collapsed and quiet on a pass, open on a
 * finding. A pass should cost one line and no attention; a problem should not
 * cost a click.
 */
import { createElement as h, useState } from 'react'

/** One checked question and its answer. */
export interface AdviceRow {
  /** What was checked, in two to four characters. */
  label: string
  /** True when this row found nothing. */
  clean: boolean
  /** The headline: a reassurance when clean, the finding when not. */
  summary: string
  /** Extra context for a clean row — dimmed, never load-bearing. */
  hint?: string | undefined
  /** Detail lines, shown under the row when it is not clean. */
  details?: AdviceDetail[] | undefined
  /** Pushes the row's colour when it is not clean. */
  severity?: 'revise' | 'fail' | undefined
}

export interface AdviceDetail {
  key: string
  text: string
  /** Ids the reader can jump to. Rendered as buttons when `onJump` is given. */
  jumpTo?: readonly string[] | undefined
  /** A suggestion rather than a finding: italic, no bullet emphasis. */
  tip?: boolean | undefined
}

export interface AdvicePanelProps {
  title: string
  rows: readonly AdviceRow[]
  /** Called with an id from `jumpTo`. Without it, ids render as plain text. */
  onJump?: ((id: string) => void) | undefined
  /** Rendered at the right of the header — an override switch, typically. */
  action?: ReturnType<typeof h> | undefined
}

export function AdvicePanel({ title, rows, onJump, action }: AdvicePanelProps): ReturnType<typeof h> | null {
  const problems = rows.filter((row) => !row.clean)
  const clean = problems.length === 0

  // Defaults follow the finding, but a reader who collapses a warning has said
  // something and keeps saying it — so an explicit choice outranks the default
  // until the panel unmounts.
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? !clean

  return h('div', { className: 'dcs-plan-advice' + (open ? ' dcs-plan-advice-open' : '') },
    h('div', { className: 'dcs-plan-advice-bar' },
      h('button', {
        type: 'button',
        className: 'dcs-plan-advice-head',
        onClick: () => setToggled(!open),
        'aria-expanded': open,
      },
        h('span', { className: 'dcs-plan-advice-caret' }, open ? '▾' : '▸'),
        h('span', { className: 'dcs-plan-advice-title' }, title),
        clean
          ? h('span', { className: 'dcs-plan-advice-ok' }, '全部通过')
          : h('span', { className: 'dcs-plan-advice-warn' }, problems.length + ' 处建议'),
      ),
      action ?? null,
    ),

    !open ? null : h('div', { className: 'dcs-plan-advice-body' },
      ...rows.flatMap((row) => [
        h('div', { className: 'dcs-plan-advice-row', key: row.label },
          h('span', { className: 'dcs-plan-advice-label' }, row.label),
          row.clean
            ? h('span', { className: 'dcs-plan-advice-ok' },
                row.summary,
                row.hint === undefined ? null : h('span', { className: 'dcs-hint' }, '　' + row.hint),
              )
            : h('span', {
                className: 'dcs-plan-advice-warn'
                  + (row.severity === undefined ? '' : ' dcs-plan-advice-' + row.severity),
              }, row.summary),
        ),
        ...(row.clean || row.details === undefined || row.details.length === 0
          ? []
          : [h('ul', { className: 'dcs-plan-advice-list', key: row.label + ':detail' },
              ...row.details.map((detail) => h('li', {
                key: detail.key,
                ...(detail.tip === true ? { className: 'dcs-variation-tip' } : {}),
              },
                detail.text,
                detail.jumpTo === undefined || detail.jumpTo.length === 0 || onJump === undefined
                  ? null
                  : h('span', { className: 'dcs-variation-shots' },
                      ...detail.jumpTo.map((id) => h('button', {
                        type: 'button',
                        key: id,
                        className: 'dcs-variation-jump',
                        onClick: () => onJump(id),
                        title: '跳到这一镜',
                      }, id)),
                    ),
              )),
            )]),
      ]),
    ),
  )
}

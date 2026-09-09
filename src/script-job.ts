/**
 * The script screen's request: write a script, or rewrite one.
 *
 * TWO GESTURES, not one. The screen has always loaded the storytelling skill —
 * without it a script comes out as the brief's key points read aloud in order,
 * every sentence true and nothing remembered. What it never loaded is the stage
 * sheet, and `script` is a strictly whitelisted artifact: six top-level keys,
 * eight section keys, one extra and the whole document is rejected. The harness
 * collects gestures with `matchAll` and dedupes them, so both load.
 *
 * The two answer different questions and neither substitutes for the other:
 *
 *   storytelling  — how to turn parallel key points into a causal chain
 *   stage-script  — which keys that chain has to be written into
 *
 * WHAT LEFT THE REQUEST. Three lines, each a weaker copy of something already
 * loaded: "分段即分镜，每段一句解说加一张配图" opens the sheet; "以 awaiting_human
 * 提交" is the gate protocol, in the pipeline skill's red lines and again in the
 * sheet; and "说清用的哪种钩子、整片弧线怎么走、哪一段你拿不准" is verbatim the
 * closing line of storytelling's own checklist.
 *
 * WHAT ARRIVED. The project id — the old request said "简报已经通过了" and named
 * no project at all, so a model with a compacted history could not call
 * `studio_stage` without looking one up. And the two live numbers the panel
 * already knows: the target length and the character budget it implies, which
 * the sheet can only state as a formula.
 */

export interface ScriptJobInput {
  projectId: string
  title: string
  /** The film's target length, from the marker. */
  durationSeconds: number
  /** `narration.chars_per_second` of the project's style. */
  charsPerSecond: number
  /** Style playbook id, so the model can resolve the rest of the contract. */
  style: string
  /** A rewrite changes the segmentation, not the wording. */
  rewrite: boolean
}

const NEWLINE = String.fromCharCode(10)
/** Exported so the handoff test can follow the gesture out of the screen. */
export const SCRIPT_STAGE_SKILL = 'dsh-creative-studio-stage-script'
export const SCRIPT_CRAFT_SKILL = 'dsh-creative-studio-storytelling'

export function buildScriptJob(input: ScriptJobInput): string {
  // The sheet gives the rule (chars per second); the panel knows both numbers,
  // so it can give the answer. A budget stated as a number is checkable at a
  // glance; stated as a multiplication it gets skipped.
  const budget = Math.round(input.durationSeconds * input.charsPerSecond)

  return [
    '/' + SCRIPT_STAGE_SKILL,
    '/' + SCRIPT_CRAFT_SKILL,
    '',
    input.rewrite
      ? '项目 `' + input.projectId + '`（' + input.title + '）的脚本**重写一版**，'
        + '**分段结构要重新设计，不要只换措辞**——换个钩子类型，或者换一条因果链。'
      : '简报过闸了。按它给项目 `' + input.projectId + '`（' + input.title + '）写脚本。',
    '',
    '目标 ' + input.durationSeconds + 's · 风格 `' + input.style + '`'
      + ' · 按 ' + input.charsPerSecond + ' 字/秒算**全片约 ' + budget + ' 字**',
  ].join(NEWLINE)
}

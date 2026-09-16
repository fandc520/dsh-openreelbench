/**
 * The two requests the project screen sends: draft a brief, and redraft one.
 *
 * The first of the requests written to the split the pipeline skills now make:
 * STRUCTURE AND PROTOCOL LIVE IN THE STAGE SHEET, the request carries only
 * which step this is and what the panel currently holds.
 *
 * What that removed from the old wording:
 *
 *   - "钩子、三到五条要点、受众、调性" — a four-item paraphrase of a twelve-row
 *     field table the sheet already carries in full
 *   - "以 awaiting_human 提交" — the gate protocol, in the pipeline skill's red
 *     lines and again in the sheet
 *   - "方向要真的不同" — the sheet says what different means (a new angle, a new
 *     audience assumption, a new order), which is the part that was missing
 *
 * What it ADDED is the part neither had:
 *
 *   - THE PROJECT ID. The old request named the project by title only, so a
 *     model whose history had been compacted had to look the id up by name
 *     before it could call `openreel_stage` at all.
 *   - The four settings the user picked on the screen. The sheet tells the
 *     model to read them off the marker; listing them here saves the lookup and
 *     makes the request legible to a person reading the conversation.
 */

/** What the立项 screen currently holds. Every field is the user's own choice. */
export interface BriefJobInput {
  projectId: string
  title: string
  /** Seconds. The user picked this; it is not the configured default. */
  durationSeconds: number
  /** Style playbook id. */
  style: string
  /** `generic` included, because "no particular platform" is also a choice. */
  platform: string
  /** A redraft asks for a different angle, not a reworded same one. */
  redraft: boolean
}

const NEWLINE = String.fromCharCode(10)
const SKILL = 'dsh-openreelbench-stage-brief'

export function buildBriefJob(input: BriefJobInput): string {
  return [
    '/' + SKILL,
    '',
    input.redraft
      ? '给项目 `' + input.projectId + '`（' + input.title + '）**重拟一版方向不同的**创意简报。'
      : '给项目 `' + input.projectId + '`（' + input.title + '）起草创意简报。',
    '',
    // Named as the user's choices rather than as parameters: it is the
    // difference between "here are some values" and "these are already decided".
    '立项页上已经定了：时长 ' + input.durationSeconds + 's · 风格 `' + input.style
      + '` · 平台 `' + input.platform + '`',
  ].join(NEWLINE)
}

/**
 * The line the screen sends after the user approves the brief.
 *
 * Not a job — the work is done and the gate is shut behind it. It exists to
 * hand the turn on, so it carries the next stage's gesture rather than a
 * description of what a script is.
 */
export function buildBriefApprovedNote(projectId: string, title: string): string {
  return [
    '/dsh-openreelbench-stage-script',
    '',
    '简报「' + title + '」我确认了，brief 闸已过。项目 `' + projectId + '`，接着写脚本。',
  ].join(NEWLINE)
}

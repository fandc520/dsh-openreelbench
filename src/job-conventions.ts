/**
 * The sentences every generation request ends with, defined once.
 *
 * Three screens hand the agent a job — takes, shots, a music bed — and each
 * request closes the same four ways: name the workflow, submit asynchronously,
 * import and record each result, and do not close the gate yourself. Those four
 * were copy-pasted between three builders, and by the time anyone looked they
 * had drifted:
 *
 *   - the shots request never mentioned `comfyui_workflow` at all, so it named
 *     a workflow without saying which tool runs one
 *   - "submit asynchronously" existed in two spellings, and one of them also
 *     said "and import it", which the other left to the next sentence
 *   - the do-not-close line said 看过 in one and 听过 in another
 *
 * None of that is visible from inside one file. That is the whole argument for
 * this module: the parts that differ per screen are arguments, and the parts
 * that are the same are not written twice.
 *
 * WHAT DOES NOT BELONG HERE. Anything a screen says because of what it makes —
 * the negative prompt, the BPM table, the two rules that disqualify a music
 * track. Pulling those in would make this the union of three requests rather
 * than their intersection, and the next screen would have to opt out of most
 * of it.
 */

/** The unit a batch is counted in: 张 for pictures, 段 for takes. */
export type JobUnit = '张' | '段'

/** How the user will judge the result, which is how they say the gate closes. */
export type JobReview = '看过' | '听过'

/**
 * Which workflow to run, and the tool that runs one.
 *
 * The tool name is not decoration. A request naming a workflow but no tool
 * leaves the model to remember that `dsh-comfyui` exists — which it did, most
 * of the time, and that is exactly the kind of failure that never reproduces
 * on the run you are watching.
 */
export function workflowLine(workflow: string): string {
  return '工作流：`' + workflow + '`（用 `comfyui_workflow` 的 `action: run`）'
}

/**
 * Submit one at a time and record as they land.
 *
 * Waiting for the whole batch means a failure on the last item throws away
 * every earlier one, and the panel — which watches the manifest — shows nothing
 * at all until the very end.
 */
export function asyncLine(unit: JobUnit): string {
  return '**请用异步方式逐' + unit + '提交**，每收到一' + unit
    + '返回就立即搬进项目并回填，不要等全部跑完再一起处理。'
}

export interface ImportLineOptions {
  /** `image`, `audio` or `music`. */
  kind: 'image' | 'audio' | 'music'
  /** The manifest this batch is recorded in. Absent for the film-wide bed. */
  manifest?: 'asset_manifest_audio' | 'asset_manifest_shots' | undefined
  unit: JobUnit
  /** Extra clause for a batch whose items need more than a scene id. */
  extra?: string | undefined
}

/**
 * Import each result and record it.
 *
 * `music` is the one kind with no `scene_id` and no manifest — it belongs to
 * the film rather than to a section, and the import records it on the project
 * by itself. Saying that plainly is cheaper than letting the model invent a
 * section for it and hit ASSET ORPHANED.
 */
export function importLine(options: ImportLineOptions): string {
  if (options.kind === 'music') {
    return '生成完用 `studio_project` 的 `action: "import"` 搬进项目，'
      + '`kind` 填 `music`，**不要填 `scene_id`** —— 配乐属于整部片子，不属于某一段。'
      + '导入会自动记到项目上，不用再写进任何清单。'
  }
  const unit = options.unit
  return '每' + unit + '生成完用 `studio_project` 的 `action: "import"` 搬进项目'
    + '（`kind` 填 `' + options.kind + '`、`scene_id` 填段落编号），'
    + '然后写进 `' + options.manifest + '` 并用 `studio_stage` 以 `in_progress` 记录——'
    + '**每' + unit + '都记一次**，不要攒到最后。'
    + (options.extra === undefined || options.extra.trim() === '' ? '' : options.extra.trim())
}

/**
 * The gate stays shut until a person looks.
 *
 * This is a governance instruction, not a preference: `studio_stage` refuses a
 * `completed` without `human_approved`, so a model that submits one gets a GATE
 * VIOLATION and has to be told why. Saying it up front turns a refusal into a
 * rule it already knew.
 */
export function holdGateLine(review: JobReview): string {
  return '**不要提交 completed** —— 我要在创意工作台' + review + '再确认。'
}

/**
 * The four closing lines in the order they are always used.
 *
 * Returned as an array so a caller can drop it into its own `lines` list with
 * whatever spacing that request uses.
 */
export function closingLines(options: ImportLineOptions & { review: JobReview }): string[] {
  return [
    asyncLine(options.unit),
    importLine(options),
    holdGateLine(options.review),
  ]
}

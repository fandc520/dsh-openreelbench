/**
 * The one sentence every generation request still shares: which workflow, and
 * the tool that runs one.
 *
 * This module started larger. It held the four lines every request ended with —
 * submit incrementally, import each result, record it, leave the gate shut —
 * because those four had been copy-pasted between three builders and had
 * drifted apart. Defining them once fixed the drift and left the requests long.
 *
 * They have since moved again, into the stage sheets, and that is the better
 * home: a protocol is invariant, so it belongs with the node it governs rather
 * than in every message about that node. The requests now carry the sheet's
 * gesture instead, which loads it for the turn.
 *
 * What stayed is what is NOT invariant across nodes: the workflow name is panel
 * state, and the music bed's import line has no stage sheet to live in — the
 * bed belongs to the film, and importing one advances no stage.
 */
/** The unit a batch is counted in: 张 for pictures, 段 for takes. */
export type JobUnit = '张' | '段'

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

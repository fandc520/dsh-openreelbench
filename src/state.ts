/**
 * The state machine. This is the whole reason the plugin exists.
 *
 * Ported from OpenMontage's `lib/checkpoint.py`, keeping the two rules that
 * gave that design its value and dropping everything else:
 *
 *   1. GATE VIOLATION — a stage the pipeline gates on human approval cannot be
 *      written `completed` without explicit evidence of that approval.
 *   2. PREREQUISITE VIOLATION — a stage cannot be touched until every earlier
 *      stage is completed (and approved, where gated).
 *
 * Both raise. That is deliberate and load-bearing: a version of this that
 * warned and wrote anyway would leave a set of ordinary tools with a progress
 * counter attached, and the model could skip straight to `compose` on a script
 * nobody read. Everything else here — schema validation, asset existence
 * checks, ffprobe backfill, downstream invalidation — exists so that a stage
 * recorded as done is done in fact, not in claim.
 *
 * The checks the model cannot talk its way past are the ones about the world:
 * a narration file either exists on disk or it does not.
 */
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

import {
  type ArtifactName,
  type AssetManifest,
  type AssetRecord,
  type Issue,
  type RenderReport,
  type Script,
  formatIssues,
  isRecord,
  validateArtifact,
} from './schema.js'
import {
  type TrashEntry,
  TRASH_DIR,
  listTrash,
  resolveInTrash,
  type ProjectLayout,
  type ProjectMarker,
  type ProjectSummary,
  ensureDir,
  ensureLayout,
  listProjects,
  pathExists,
  projectLayout,
  readJson,
  readMarker,
  resolveInProject,
  slugify,
  writeJsonAtomic,
  writeMarker,
} from './project.js'

/* ----------------------------------------------------------------- contract */

export const STAGES = ['brief', 'script', 'assets_audio', 'assets_shots', 'compose'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_ARTIFACT: Record<Stage, ArtifactName> = {
  brief: 'brief',
  script: 'script',
  assets_audio: 'asset_manifest_audio',
  assets_shots: 'asset_manifest_shots',
  compose: 'render_report',
}

/**
 * Which asset types each generative stage owns. Splitting audio from stills is
 * not cosmetic: ComfyUI reloads its models when a run switches between an
 * audio and an image workflow, so the two are generated as separate batches —
 * and a batch the user approves is a batch the state machine should be able to
 * check on its own terms.
 */
export const STAGE_ASSET_TYPES: Record<'assets_audio' | 'assets_shots', ReadonlySet<string>> = {
  assets_audio: new Set(['narration', 'audio', 'music', 'sfx']),
  assets_shots: new Set(['image', 'video']),
}

export function isAssetStage(stage: Stage): stage is 'assets_audio' | 'assets_shots' {
  return stage === 'assets_audio' || stage === 'assets_shots'
}

/**
 * Four gates. The first two sit before the expensive work — approving a script
 * the user has
 * not read is how a pipeline burns an hour of GPU time on the wrong video.
 */
export const GATED_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  'brief', 'script', 'assets_audio', 'assets_shots',
])

export const CHECKPOINT_STATUSES = ['in_progress', 'awaiting_human', 'completed', 'failed'] as const
export type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number]

export interface Checkpoint {
  version: '1.0'
  project_id: string
  stage: Stage
  status: CheckpointStatus
  timestamp: string
  human_approval_required: boolean
  human_approved: boolean
  /** Artifact name -> project-relative path of the file that holds it. */
  artifact_refs: Record<string, string>
  review?: Record<string, unknown>
  metadata?: Record<string, unknown>
  note?: string
}

export type ViolationCode =
  | 'GATE_VIOLATION'
  | 'PREREQUISITE_VIOLATION'
  | 'SCHEMA_INVALID'
  | 'ASSET_MISSING'
  | 'COVERAGE_INCOMPLETE'
  /**
   * The material is well-formed and complete, and would still make a bad film.
   *
   * The fifth class of check, and the only one about quality rather than
   * structure. Unlike the other four it is overridable: a person who has seen
   * the score can say render it anyway.
   */
  | 'QUALITY_VIOLATION'
  | 'NO_PROJECT'
  | 'BAD_REQUEST'

export class StateViolationError extends Error {
  constructor(readonly code: ViolationCode, message: string) {
    super(message)
    this.name = 'StateViolationError'
  }
}

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage)
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value)
}

export function isStatus(value: unknown): value is CheckpointStatus {
  return typeof value === 'string' && (CHECKPOINT_STATUSES as readonly string[]).includes(value)
}

/* -------------------------------------------------------------- state views */

export interface StageView {
  stage: Stage
  status: CheckpointStatus | 'pending'
  gated: boolean
  human_approved: boolean
  timestamp?: string
  artifact?: string
  note?: string
}

export interface ProjectStatus {
  project: ProjectMarker
  stages: StageView[]
  /** The stage the model should work on next, or null when the run is done. */
  next_stage: Stage | null
  /** Set when the pipeline is parked at a gate waiting for the user. */
  awaiting_approval: Stage | null
}

export interface WriteResult {
  checkpoint: Checkpoint
  /** Later stages discarded because this one was rewritten. */
  invalidated: Stage[]
  /** Non-fatal observations (e.g. durations that were corrected). */
  notices: string[]
}

export interface WriteRequest {
  projectId: string
  stage: Stage
  status: CheckpointStatus
  /** Artifact name -> value. The stage's canonical artifact is mandatory
   *  for `awaiting_human` and `completed`. */
  artifacts: Record<string, unknown>
  humanApproved: boolean
  review?: Record<string, unknown>
  metadata?: Record<string, unknown>
  note?: string
}

export interface StateMachineDeps {
  /**
   * Read lazily, not captured: the settings section can change the project
   * root while the host runs, and a value snapshotted at apply time would keep
   * writing to the old directory until the next restart.
   */
  workspaceRoot(): string
  /** Media duration in seconds, or undefined when the file is not probeable. */
  probeDuration(absolutePath: string): Promise<number | undefined>
}

/* ------------------------------------------------------------------- engine */

export class StateMachine {
  /** One write at a time per project: a checkpoint plus its artifacts is a
   *  multi-file transaction, and two interleaved writes would tear it. */
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: StateMachineDeps) {}

  layout(projectId: string): ProjectLayout {
    return projectLayout(this.deps.workspaceRoot(), projectId)
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return listProjects(this.deps.workspaceRoot())
  }

  private serialize<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve()
    // Run regardless of how the previous write ended; its failure is its own
    // caller's problem, not a reason to wedge the queue.
    const next = previous.then(work, work)
    const guard = next.then(() => undefined, () => undefined)
    this.locks.set(projectId, guard)
    // Drop the entry once this write is the tail, so the map does not grow for
    // the lifetime of the host.
    void guard.then(() => {
      if (this.locks.get(projectId) === guard) this.locks.delete(projectId)
    })
    return next
  }

  /* --------------------------------------------------------------- projects */

  async initProject(input: {
    id?: string
    title: string
    targetDurationSeconds: number
    style?: string
    pipeline?: string
    voice?: string
  }): Promise<{ layout: ProjectLayout; marker: ProjectMarker; existed: boolean }> {
    const id = input.id ?? slugify(input.title)
    const layout = this.layout(id)
    const existing = await readMarker(layout)
    if (existing !== undefined) {
      return { layout, marker: existing, existed: true }
    }
    const marker: ProjectMarker = {
      version: '1.0',
      id,
      title: input.title,
      pipeline: input.pipeline ?? 'explainer-stills',
      style: input.style ?? 'default',
      created_at: new Date().toISOString(),
      target_duration_seconds: input.targetDurationSeconds,
      voice: input.voice ?? '',
    }
    await ensureLayout(layout)
    await writeMarker(layout, marker)
    return { layout, marker, existed: false }
  }

  /** Record the narration voice on an existing project. */
  /**
   * Patch the mutable fields on a project's marker.
   *
   * Only the fields a person can legitimately change after the project exists:
   * its id and creation time are identity, and the pipeline is not switchable
   * mid-run because the stages already on disk belong to the old one.
   */
  async updateProject(projectId: string, patch: {
    title?: string
    targetDurationSeconds?: number
    style?: string
    voice?: string
    voiceDesignName?: string
    voiceDesignPrompt?: string
    loraName?: string
    loraStrength?: number
    references?: string[]
    voiceReferences?: string[]
    targetPlatform?: string
    /** @deprecated storage moved to the scene_plan artifact; read-only legacy. */
    shotPlan?: Record<string, Array<{ prompt?: string; weight?: number }>>
  }): Promise<ProjectMarker> {
    return this.serialize(projectId, async () => {
      const { layout, marker } = await this.requireProject(projectId)
      const updated: ProjectMarker = {
        ...marker,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.targetDurationSeconds !== undefined
          ? { target_duration_seconds: patch.targetDurationSeconds }
          : {}),
        ...(patch.style !== undefined ? { style: patch.style } : {}),
        ...(patch.voice !== undefined ? { voice: patch.voice } : {}),
        ...(patch.voiceDesignName !== undefined ? { voice_design_name: patch.voiceDesignName } : {}),
        ...(patch.voiceDesignPrompt !== undefined ? { voice_design_prompt: patch.voiceDesignPrompt } : {}),
        ...(patch.loraName !== undefined ? { lora_name: patch.loraName } : {}),
        ...(patch.loraStrength !== undefined ? { lora_strength: patch.loraStrength } : {}),
        ...(patch.references !== undefined ? { references: patch.references } : {}),
        ...(patch.voiceReferences !== undefined ? { voice_references: patch.voiceReferences } : {}),
        ...(patch.targetPlatform !== undefined ? { target_platform: patch.targetPlatform } : {}),
        ...(patch.shotPlan !== undefined ? { shot_plan: patch.shotPlan } : {}),
      }
      await writeMarker(layout, updated)
      return updated
    })
  }

  /**
   * Take a project out of the library.
   *
   * It is moved into `<workspaceRoot>/.trash/<id>-<timestamp>`, not deleted.
   * A project directory holds a rendered film and a batch of assets that cost
   * real GPU time, and "移除" in a dropdown is far too light a gesture to
   * destroy that. `.trash` fails the project-id pattern, so a trashed project
   * disappears from the listing without any extra filtering, and anyone can
   * put it back with a file move.
   *
   * @returns where it went, so the caller can say so.
   */
  async removeProject(projectId: string): Promise<{ trashedTo: string }> {
    return this.serialize(projectId, async () => {
      const { layout } = await this.requireProject(projectId)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const trashDir = join(this.deps.workspaceRoot(), TRASH_DIR)
      const target = join(trashDir, projectId + '-' + stamp)
      await fs.mkdir(trashDir, { recursive: true })
      await fs.rename(layout.dir, target)
      return { trashedTo: target }
    })
  }

  async listTrash(): Promise<TrashEntry[]> {
    return listTrash(this.deps.workspaceRoot())
  }

  /**
   * Put a trashed project back under its original id.
   *
   * A live project already holding that id is a hard stop rather than a
   * silent rename: the two are different runs that happen to share a name,
   * and quietly restoring under `foo-2` would leave the user with two
   * projects and no idea which is which.
   */
  async restoreProject(entry: string): Promise<{ id: string }> {
    const root = this.deps.workspaceRoot()
    const source = resolveInTrash(root, entry)
    const marker = await readJson<ProjectMarker>(join(source, 'project.json'))
    if (marker === undefined) {
      throw new StateViolationError('NO_PROJECT', 'trash entry ' + JSON.stringify(entry) + ' has no project.json')
    }
    return this.serialize(marker.id, async () => {
      const target = join(root, marker.id)
      if (await pathExists(target)) {
        throw new StateViolationError(
          'BAD_REQUEST',
          '项目 ' + JSON.stringify(marker.id) + ' 已经存在，无法还原。'
          + '先把现有的那个移除或重命名，再还原这一个。',
        )
      }
      await fs.rename(source, target)
      return { id: marker.id }
    })
  }

  /**
   * Delete a trashed project for real. There is no third chance after this —
   * the caller is responsible for having asked.
   */
  async purgeProject(entry: string): Promise<{ entry: string }> {
    const source = resolveInTrash(this.deps.workspaceRoot(), entry)
    if (!(await pathExists(source))) {
      throw new StateViolationError('NO_PROJECT', 'trash entry ' + JSON.stringify(entry) + ' does not exist')
    }
    await fs.rm(source, { recursive: true, force: true })
    return { entry }
  }

  async setVoice(projectId: string, voice: string): Promise<ProjectMarker> {
    return this.serialize(projectId, async () => {
      const { layout, marker } = await this.requireProject(projectId)
      const updated: ProjectMarker = { ...marker, voice }
      await writeMarker(layout, updated)
      return updated
    })
  }

  async requireProject(projectId: string): Promise<{ layout: ProjectLayout; marker: ProjectMarker }> {
    const layout = this.layout(projectId)
    const marker = await readMarker(layout)
    if (marker === undefined) {
      throw new StateViolationError(
        'NO_PROJECT',
        'no project ' + JSON.stringify(projectId) + ' under ' + this.deps.workspaceRoot()
        + " — run studio_project with action 'init' first",
      )
    }
    return { layout, marker }
  }

  /* ------------------------------------------------------------ checkpoints */

  private checkpointPath(layout: ProjectLayout, stage: Stage): string {
    return join(layout.checkpointsDir, stage + '.json')
  }

  async readCheckpoint(layout: ProjectLayout, stage: Stage): Promise<Checkpoint | undefined> {
    return readJson<Checkpoint>(this.checkpointPath(layout, stage))
  }

  async readArtifact<T>(layout: ProjectLayout, name: ArtifactName): Promise<T | undefined> {
    return readJson<T>(join(layout.artifactsDir, name + '.json'))
  }

  /**
   * Artifacts that record an INTENTION rather than a result.
   *
   * These are the only ones `writePlan` will touch. The restriction is the
   * point: every artifact a stage is judged on still has exactly one way in —
   * `submitStage`, with its schema check, asset verification and gate. Without
   * this set, a second write path would quietly become a way around all three.
   */
  static readonly PLAN_ARTIFACTS: ReadonlySet<ArtifactName> = new Set<ArtifactName>(['scene_plan'])

  /**
   * Save a plan.
   *
   * No gate and no checkpoint: a plan is what someone means to make, and the
   * stage is still judged on whether they made it. It is schema-checked like
   * anything else, though — a plan the prompt builder cannot read is not a
   * plan, and the whole reason this artifact exists is to be read by code.
   */
  async writePlan(projectId: string, name: ArtifactName, value: unknown): Promise<void> {
    if (!StateMachine.PLAN_ARTIFACTS.has(name)) {
      throw new StateViolationError(
        'BAD_REQUEST',
        "'" + name + "' is not a plan artifact; record it with studio_stage so it goes through its gate",
      )
    }
    const issues = validateArtifact(name, value)
    if (issues.length > 0) {
      throw new StateViolationError(
        'SCHEMA_INVALID',
        'SCHEMA INVALID: ' + issues.length + ' problem(s) in ' + name + ':' + String.fromCharCode(10) + formatIssues(issues),
      )
    }
    const { layout } = await this.requireProject(projectId)
    await this.serialize(projectId, async () => {
      await ensureDir(layout.artifactsDir)
      await writeJsonAtomic(join(layout.artifactsDir, name + '.json'), value)
    })
  }

  async status(projectId: string): Promise<ProjectStatus> {
    const { layout, marker } = await this.requireProject(projectId)
    const stages: StageView[] = []
    let nextStage: Stage | null = null
    let awaiting: Stage | null = null

    for (const stage of STAGES) {
      const checkpoint = await this.readCheckpoint(layout, stage)
      const gated = GATED_STAGES.has(stage)
      if (checkpoint === undefined) {
        stages.push({ stage, status: 'pending', gated, human_approved: false })
        if (nextStage === null) nextStage = stage
        continue
      }
      const view: StageView = {
        stage,
        status: checkpoint.status,
        gated,
        human_approved: checkpoint.human_approved,
        timestamp: checkpoint.timestamp,
      }
      const artifactRef = checkpoint.artifact_refs[STAGE_ARTIFACT[stage]]
      if (artifactRef !== undefined) view.artifact = artifactRef
      if (checkpoint.note !== undefined) view.note = checkpoint.note
      stages.push(view)

      if (checkpoint.status === 'awaiting_human' && awaiting === null) awaiting = stage
      if (checkpoint.status !== 'completed' && nextStage === null) nextStage = stage
    }

    return { project: marker, stages, next_stage: nextStage, awaiting_approval: awaiting }
  }

  /* ------------------------------------------------------------------ write */

  async write(request: WriteRequest): Promise<WriteResult> {
    return this.serialize(request.projectId, () => this.writeUnlocked(request))
  }

  private async writeUnlocked(request: WriteRequest): Promise<WriteResult> {
    const { stage, status } = request
    const { layout } = await this.requireProject(request.projectId)
    const notices: string[] = []

    const canonical = STAGE_ARTIFACT[stage]
    const needsArtifact = status === 'completed' || status === 'awaiting_human'
    if (needsArtifact && request.artifacts[canonical] === undefined) {
      throw new StateViolationError(
        'BAD_REQUEST',
        "stage '" + stage + "' with status '" + status + "' must supply its artifact '" + canonical + "'",
      )
    }

    // 1. Shape. Anything the schema does not recognise is rejected outright.
    const issues: Issue[] = []
    for (const [name, value] of Object.entries(request.artifacts)) {
      if (!(name in ARTIFACT_STAGE)) {
        issues.push({ path: name, message: 'unknown artifact; expected one of ' + Object.keys(ARTIFACT_STAGE).join(', ') })
        continue
      }
      issues.push(...validateArtifact(name as ArtifactName, value))
    }
    if (issues.length > 0) {
      throw new StateViolationError(
        'SCHEMA_INVALID',
        'SCHEMA INVALID: ' + issues.length + " problem(s) in stage '" + stage + "' artifacts:\n" + formatIssues(issues),
      )
    }

    // 2. The world. Only meaningful once shapes are known-good.
    //
    // These run whenever the artifact is supplied at all, including on an
    // `in_progress` write. Assets are generated in batches, and a wrong path
    // caught when the first batch is recorded is a wrong path caught before the
    // second batch is generated. Only the coverage rule — every section needs
    // both narration and a visual — waits for a terminal status, since a
    // partial manifest is partial by definition.
    //
    // Verification may also *normalise* an artifact (ffprobe durations replace
    // whatever the caller declared). That normalisation produces a new object:
    // the request's artifacts belong to the caller, and the harness hands tool
    // arguments over deep-frozen, so writing through them is both rude and a
    // TypeError. `persisted` is what actually goes to disk.
    const persisted: Record<string, unknown> = { ...request.artifacts }
    if (request.artifacts[canonical] !== undefined) {
      if (isAssetStage(stage)) {
        const verified = await this.verifyAssets(
          layout,
          stage,
          request.artifacts[canonical] as AssetManifest,
          needsArtifact,
        )
        notices.push(...verified.notices)
        persisted[canonical] = verified.manifest
      }
      if (stage === 'compose') {
        await this.verifyRender(layout, request.artifacts[canonical] as RenderReport)
      }
    }

    // 3. Gate, then order. Order last, so a caller fixing one violation at a
    //    time sees the cheapest problem first.
    const gated = GATED_STAGES.has(stage)
    if (gated && status === 'completed' && !request.humanApproved) {
      throw new StateViolationError(
        'GATE_VIOLATION',
        "GATE VIOLATION: stage '" + stage + "' is an approval gate but was written completed without human_approved=true.\n"
        + "Correct protocol: write status='awaiting_human', show the user a summary of the artifact, END YOUR TURN, "
        + "and only after the user actually approves, re-write with status='completed' and human_approved=true.",
      )
    }

    if (status !== 'failed') {
      await this.enforcePrerequisites(layout, stage)
    }

    // 4. Rewriting a stage retroactively falsifies everything downstream.
    const invalidated = needsArtifact ? await this.invalidateSuccessors(layout, stage) : []
    if (invalidated.length > 0) {
      notices.push(
        'discarded later stage(s) ' + invalidated.join(', ')
        + ' because ' + stage + ' was rewritten; they must be redone',
      )
    }

    // 5. Persist artifacts first, then the checkpoint that points at them.
    //    In the reverse order a crash leaves a checkpoint referencing a file
    //    that was never written.
    const artifactRefs: Record<string, string> = {}
    for (const [name, value] of Object.entries(persisted)) {
      const relative = 'artifacts/' + name + '.json'
      await writeJsonAtomic(join(layout.dir, 'artifacts', name + '.json'), value)
      artifactRefs[name] = relative
    }

    const path = this.checkpointPath(layout, stage)
    await this.archiveSuperseded(layout, stage, status)

    const checkpoint: Checkpoint = {
      version: '1.0',
      project_id: request.projectId,
      stage,
      status,
      timestamp: new Date().toISOString(),
      human_approval_required: gated,
      human_approved: gated ? request.humanApproved : false,
      artifact_refs: artifactRefs,
      ...(request.review !== undefined ? { review: request.review } : {}),
      ...(request.metadata !== undefined ? { metadata: request.metadata } : {}),
      ...(request.note !== undefined ? { note: request.note } : {}),
    }
    await writeJsonAtomic(path, checkpoint)

    return { checkpoint, invalidated, notices }
  }

  /* -------------------------------------------------------------- the rules */

  private async enforcePrerequisites(layout: ProjectLayout, stage: Stage): Promise<void> {
    const index = stageIndex(stage)
    const incomplete: string[] = []
    const unapproved: string[] = []

    for (const predecessor of STAGES.slice(0, index)) {
      const checkpoint = await this.readCheckpoint(layout, predecessor)
      if (checkpoint === undefined || checkpoint.status !== 'completed') {
        incomplete.push(predecessor + (checkpoint === undefined ? ' (never started)' : ' (' + checkpoint.status + ')'))
        continue
      }
      if (GATED_STAGES.has(predecessor) && !checkpoint.human_approved) {
        unapproved.push(predecessor)
      }
    }

    if (incomplete.length === 0 && unapproved.length === 0) return

    const details: string[] = []
    if (incomplete.length > 0) details.push('incomplete or missing: ' + incomplete.join(', '))
    if (unapproved.length > 0) details.push('completed without the required human approval: ' + unapproved.join(', '))
    throw new StateViolationError(
      'PREREQUISITE_VIOLATION',
      "PREREQUISITE VIOLATION: stage '" + stage + "' cannot be written; " + details.join('; ')
      + '. Pipeline order: ' + STAGES.join(' -> ') + '.',
    )
  }

  /**
   * Every asset must exist, belong to a real script section, and — for media
   * with a timeline — report the duration ffprobe actually measures. Together
   * with the coverage check, this is what makes "assets completed" impossible
   * to assert without having generated the assets.
   *
   * `requireCoverage` is false for an in-flight batch, where sections are
   * expected to be missing their other half.
   */
  private async verifyAssets(
    layout: ProjectLayout,
    stage: 'assets_audio' | 'assets_shots',
    manifest: AssetManifest,
    requireCoverage: boolean,
  ): Promise<{ manifest: AssetManifest; notices: string[] }> {
    const script = await this.readArtifact<Script>(layout, 'script')
    if (script === undefined) {
      throw new StateViolationError('PREREQUISITE_VIOLATION', 'cannot verify assets: no script artifact on disk')
    }
    const sectionIds = new Set(script.sections.map((section) => section.id))
    const notices: string[] = []
    const missing: string[] = []
    const orphaned: string[] = []
    const wrongStage: string[] = []
    const measuredAssets: AssetRecord[] = []
    const allowed = STAGE_ASSET_TYPES[stage]

    for (const asset of manifest.assets) {
      // A still recorded against the audio stage would satisfy that stage's
      // coverage while contributing nothing to it, and would then be missing
      // from the manifest the composer reads for visuals.
      if (!allowed.has(asset.type)) {
        wrongStage.push(asset.id + " -> type '" + asset.type + "'")
        continue
      }
      let absolute: string
      try {
        absolute = resolveInProject(layout, asset.path)
      } catch (error) {
        missing.push(asset.id + ' -> ' + asset.path + ' (' + (error as Error).message + ')')
        continue
      }
      if (!(await pathExists(absolute))) {
        missing.push(asset.id + ' -> ' + asset.path)
        continue
      }
      if (!sectionIds.has(asset.scene_id)) {
        orphaned.push(asset.id + " -> scene_id '" + asset.scene_id + "'")
        continue
      }
      if (!HAS_TIMELINE.has(asset.type)) {
        measuredAssets.push(asset)
        continue
      }
      const measured = await this.deps.probeDuration(absolute)
      if (measured === undefined) {
        missing.push(asset.id + ' -> ' + asset.path + ' (exists but ffprobe could not read a duration; corrupt or empty?)')
        continue
      }
      const declared = asset.duration_seconds
      if (declared !== undefined && Math.abs(declared - measured) > 0.05) {
        notices.push(
          asset.id + ': declared ' + declared.toFixed(2) + 's, measured ' + measured.toFixed(2) + 's — using the measurement',
        )
      }
      measuredAssets.push({ ...asset, duration_seconds: Number(measured.toFixed(3)) })
    }

    if (missing.length > 0) {
      throw new StateViolationError(
        'ASSET_MISSING',
        'ASSET MISSING: ' + missing.length + ' asset(s) are not readable under ' + layout.dir + ':\n'
        + missing.map((line) => '  - ' + line).join('\n')
        + '\nCopy or move the ComfyUI outputs into the project (assets/images, assets/audio) before recording them.',
      )
    }
    if (wrongStage.length > 0) {
      throw new StateViolationError(
        'SCHEMA_INVALID',
        "WRONG STAGE: " + wrongStage.length + " asset(s) do not belong to stage '" + stage + "':\n"
        + wrongStage.map((line) => '  - ' + line).join('\n')
        + '\nThis stage accepts: ' + [...allowed].join(', ')
        + '. Record the others under '
        + (stage === 'assets_audio' ? 'assets_shots' : 'assets_audio') + '.',
      )
    }
    if (orphaned.length > 0) {
      throw new StateViolationError(
        'COVERAGE_INCOMPLETE',
        'ASSET ORPHANED: ' + orphaned.length + ' asset(s) reference a scene_id that is not in the script:\n'
        + orphaned.map((line) => '  - ' + line).join('\n')
        + '\nValid section ids: ' + [...sectionIds].join(', '),
      )
    }

    const normalised: AssetManifest = { ...manifest, assets: measuredAssets }
    if (!requireCoverage) return { manifest: normalised, notices }

    // Coverage, for this stage only: the other half is a different stage's
    // problem, and demanding both here would make the first batch unrecordable.
    const want = stage === 'assets_audio' ? 'narration' : 'a visual'
    const gaps: string[] = []
    for (const section of script.sections) {
      const mine = manifest.assets.filter((asset) => asset.scene_id === section.id)
      if (!mine.some((asset) => allowed.has(asset.type))) {
        gaps.push(section.id + ': no ' + want + ' asset')
      }
    }
    if (gaps.length > 0) {
      throw new StateViolationError(
        'COVERAGE_INCOMPLETE',
        'COVERAGE INCOMPLETE: every script section needs narration and a visual:\n'
        + gaps.map((line) => '  - ' + line).join('\n'),
      )
    }

    return { manifest: normalised, notices }
  }

  private async verifyRender(layout: ProjectLayout, report: RenderReport): Promise<void> {
    const missing: string[] = []
    for (const output of report.outputs) {
      try {
        const absolute = resolveInProject(layout, output.path)
        if (!(await pathExists(absolute))) missing.push(output.path)
      } catch (error) {
        missing.push(output.path + ' (' + (error as Error).message + ')')
      }
    }
    if (missing.length > 0) {
      throw new StateViolationError(
        'ASSET_MISSING',
        'ASSET MISSING: the render report names output file(s) that do not exist:\n'
        + missing.map((line) => '  - ' + line).join('\n')
        + '\nRun studio_compose and record the paths it returns.',
      )
    }
  }

  /* ------------------------------------------------------------- versioning */

  /**
   * Copy the current checkpoint into history before it is overwritten, so a
   * script v1 -> v2 rewrite and every gate transition stay reconstructable.
   * Repeated `in_progress` heartbeats are not archived — they are partial
   * progress, not versions. Archiving is best effort: losing a history copy
   * must never fail a write.
   */
  private async archiveSuperseded(layout: ProjectLayout, stage: Stage, incoming: CheckpointStatus): Promise<void> {
    const existing = await this.readCheckpoint(layout, stage).catch(() => undefined)
    if (existing === undefined) return
    if (existing.status === 'in_progress' && incoming === 'in_progress') return
    const stamp = existing.timestamp.replace(/[:.]/g, '-')
    try {
      await fs.mkdir(layout.historyDir, { recursive: true })
      await writeJsonAtomic(join(layout.historyDir, stage + '-' + stamp + '.json'), existing)
    } catch {
      // Intentionally swallowed: history is an audit convenience.
    }
  }

  /** Archive and remove every stage after `stage` that had recorded state. */
  private async invalidateSuccessors(layout: ProjectLayout, stage: Stage): Promise<Stage[]> {
    const invalidated: Stage[] = []
    for (const successor of STAGES.slice(stageIndex(stage) + 1)) {
      const checkpoint = await this.readCheckpoint(layout, successor).catch(() => undefined)
      if (checkpoint === undefined) continue
      await this.archiveSuperseded(layout, successor, 'failed')
      await fs.rm(this.checkpointPath(layout, successor), { force: true })
      invalidated.push(successor)
    }
    return invalidated
  }
}

/* ------------------------------------------------------------------ helpers */

const ARTIFACT_STAGE: Record<ArtifactName, Stage> = {
  brief: 'brief',
  script: 'script',
  asset_manifest_audio: 'assets_audio',
  // Planned by the same stage that generates from it, and written first.
  // STAGE_ARTIFACT stays one-to-one because that map answers a different
  // question: which artifact a stage's completion is judged on. A plan is not
  // that - a stage is done when the pictures exist, not when they are imagined.
  scene_plan: 'assets_shots',
  asset_manifest_shots: 'assets_shots',
  render_report: 'compose',
}

/** Asset types whose real duration drives the timeline. */
const HAS_TIMELINE: ReadonlySet<string> = new Set(['narration', 'audio', 'music', 'sfx', 'video'])

/** Narrow an unknown artifact payload to an object, for tool argument parsing. */
export function asArtifactObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new StateViolationError('BAD_REQUEST', label + ' must be a JSON object')
  }
  return value
}

export type { AssetRecord }

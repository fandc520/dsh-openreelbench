/**
 * Project layout, path safety, and atomic JSON persistence.
 *
 * Every path the plugin touches is derived from an explicit workspace root —
 * never `process.cwd()`, which in a harness host is wherever the launcher
 * happened to start and would scatter user projects across the filesystem.
 *
 * On-disk shape of one project:
 *
 *   <workspaceRoot>/<projectId>/
 *     project.json                 identity marker (title, pipeline, created)
 *     checkpoints/<stage>.json     current state of each stage
 *     checkpoints/history/         superseded checkpoints, newest last
 *     artifacts/<name>.json        the artifact each stage produced
 *     assets/images/               txt2img output
 *     assets/audio/                TTS output
 *     work/                        render scratch, safe to delete
 *     output/                      final renders and sidecar subtitles
 */
import { homedir } from 'node:os'
import { join, resolve, sep, isAbsolute } from 'node:path'
import { type Dirent, promises as fs } from 'node:fs'

export const PROJECT_MARKER = 'project.json'

export interface ProjectMarker {
  version: '1.0'
  id: string
  title: string
  /** Reserved for M4, when a second pipeline arrives. */
  pipeline: string
  /** Reserved for M1, when playbooks replace the hard-coded style. */
  style: string
  created_at: string
  target_duration_seconds: number
  /**
   * Where the film is headed, which is what decides its frame.
   *
   * On the marker as well as in the brief, for the same reason `style` and
   * `target_duration_seconds` are: the panel has to be able to set it before a
   * brief exists, and rendering has to be able to read it after the brief has
   * been rewritten. The marker wins when both are present - it is the one the
   * user edits directly.
   */
  target_platform?: string
  /**
   * The narration voice this project uses, as the TTS workflow names it.
   * Designing a voice is a preparation step outside the pipeline: the user
   * either picks an existing one or generates it in the ComfyUI panel first.
   * Empty means the model must ask before generating any narration — a whole
   * project rendered in the wrong voice is a whole project regenerated.
   */
  voice: string
  /**
   * A voice-design draft the agent fills in for the panel.
   *
   * It lives on the project because the panel has no inbox: the agent cannot
   * hand a suggestion to a React form, but it can write it here and the panel
   * reads it on its next poll. Not pipeline state — nothing downstream reads
   * it, and losing it costs one button press.
   */
  voice_design_name?: string
  voice_design_prompt?: string
  /**
   * A LoRA hint passed through to the image workflow.
   *
   * Project-level rather than part of the style playbook: a playbook is a
   * reusable house standard, while this is one production's feel. Folding it
   * into the playbook would let a single project's taste leak into every other
   * project that shares the style. Not validated — like the bindings, the
   * workflow's own parameter list is the authority on what it accepts.
   */
  lora_name?: string
  lora_strength?: number
  /**
   * Reference images for img2img-style workflows, by the name ComfyUI knows
   * them under.
   *
   * Project-level, not per shot: a reference is what the whole film should
   * look like, and attaching one per picture would mean re-picking it for
   * every shot. Names rather than paths or URLs, because what the model does
   * with these is put them straight into a loader node — the file already
   * lives in ComfyUI's input directory, which is the only place that node
   * reads from.
   */
  references?: string[]
  /**
   * The shot plan: how many pictures each section is cut into, and what each
   * one is meant to show.
   *
   * It lives here rather than in the shots manifest because a manifest records
   * what was *produced*, and a plan exists before anything is. Writing an
   * intended shot into the manifest would mean an entry with no file, which is
   * exactly what the asset checks exist to reject — so a prompt typed for an
   * ungenerated shot had nowhere to go and was silently dropped on save.
   *
   * Keyed by section id, in screen order. The manifest stays authoritative for
   * what exists; this is authoritative for what was asked for.
   */
  shot_plan?: Record<string, Array<{ prompt?: string; weight?: number }>>
}

export interface ProjectLayout {
  id: string
  dir: string
  marker: string
  checkpointsDir: string
  historyDir: string
  artifactsDir: string
  assetsDir: string
  imagesDir: string
  audioDir: string
  workDir: string
  outputDir: string
}

/**
 * Project ids become directory names, so they are restricted to a portable
 * character set rather than escaped. Rejecting is safer than sanitising: a
 * silently rewritten id would not match what the model recorded.
 */
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export class ProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectError'
  }
}

export function assertValidProjectId(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new ProjectError(
      'invalid project id ' + JSON.stringify(id)
      + ' — use lowercase letters, digits, hyphen or underscore, starting with a letter or digit (max 64 chars)',
    )
  }
  return id
}

/** Derive a valid id from a free-form title; callers may override it. */
export function slugify(title: string): string {
  const ascii = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  // A Chinese title reduces to an empty slug, which is the common case here.
  return ascii === '' ? 'project-' + Date.now().toString(36) : ascii
}

export function defaultWorkspaceRoot(): string {
  const base = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(base, 'data', 'dsh-creative-studio', 'projects')
}

export function resolveWorkspaceRoot(configured: string): string {
  const trimmed = configured.trim()
  if (trimmed === '') return defaultWorkspaceRoot()
  return resolve(trimmed)
}

export function projectLayout(root: string, id: string): ProjectLayout {
  assertValidProjectId(id)
  const dir = join(root, id)
  return {
    id,
    dir,
    marker: join(dir, PROJECT_MARKER),
    checkpointsDir: join(dir, 'checkpoints'),
    historyDir: join(dir, 'checkpoints', 'history'),
    artifactsDir: join(dir, 'artifacts'),
    assetsDir: join(dir, 'assets'),
    imagesDir: join(dir, 'assets', 'images'),
    audioDir: join(dir, 'assets', 'audio'),
    workDir: join(dir, 'work'),
    outputDir: join(dir, 'output'),
  }
}

/**
 * Resolve an artifact-relative path against the project directory, refusing
 * anything that escapes it. Artifacts are model-authored, so `../../` is a
 * realistic input, not a hypothetical one.
 */
export function resolveInProject(layout: ProjectLayout, relative: string): string {
  if (isAbsolute(relative)) {
    throw new ProjectError('path must be relative to the project directory, got ' + JSON.stringify(relative))
  }
  const full = resolve(layout.dir, relative)
  const base = resolve(layout.dir)
  if (full !== base && !full.startsWith(base + sep)) {
    throw new ProjectError('path ' + JSON.stringify(relative) + ' escapes the project directory')
  }
  return full
}

/** Turn an absolute path back into the project-relative form artifacts store. */
export function toProjectRelative(layout: ProjectLayout, absolute: string): string {
  const base = resolve(layout.dir)
  const full = resolve(absolute)
  if (!full.startsWith(base + sep)) {
    throw new ProjectError('path ' + JSON.stringify(absolute) + ' is outside the project directory')
  }
  return full.slice(base.length + 1).split(sep).join('/')
}

/* ---------------------------------------------------------------- file I/O */

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function ensureLayout(layout: ProjectLayout): Promise<void> {
  await ensureDir(layout.dir)
  await ensureDir(layout.checkpointsDir)
  await ensureDir(layout.historyDir)
  await ensureDir(layout.artifactsDir)
  await ensureDir(layout.imagesDir)
  await ensureDir(layout.audioDir)
  await ensureDir(layout.workDir)
  await ensureDir(layout.outputDir)
}

/**
 * Write JSON atomically: temp file in the same directory, fsync, then rename.
 * A crash mid-write must never leave a truncated checkpoint, because a
 * truncated checkpoint reads as "stage never completed" and silently rewinds
 * the pipeline. `fs.rename` replaces the destination on Windows too.
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value, null, 2) + '\n'
  const temp = path + '.' + process.pid.toString(36) + '.' + Date.now().toString(36) + '.tmp'
  const handle = await fs.open(temp, 'w')
  try {
    await handle.writeFile(body, 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.rename(temp, path)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  let body: string
  try {
    body = await fs.readFile(path, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    return JSON.parse(body) as T
  } catch (error) {
    throw new ProjectError('corrupt JSON at ' + path + ': ' + (error as Error).message)
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/* --------------------------------------------------------------- discovery */

export async function readMarker(layout: ProjectLayout): Promise<ProjectMarker | undefined> {
  return readJson<ProjectMarker>(layout.marker)
}

export async function writeMarker(layout: ProjectLayout, marker: ProjectMarker): Promise<void> {
  await writeJsonAtomic(layout.marker, marker)
}

/** The trash lives beside the projects, under a name no project id can take. */
export const TRASH_DIR = '.trash'

/**
 * A trash entry name is `<project id>-<ISO timestamp>`, and it arrives from the
 * browser — so it is checked as a flat name, never as a path. `..`, separators
 * and drive letters are all rejected before anything touches the filesystem.
 */
// Uppercase is allowed because the stamp is an ISO timestamp (`...T14-36-24-989Z`).
// What matters is what stays out: dots, separators and drive letters.
const TRASH_ENTRY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

export function resolveInTrash(root: string, entry: string): string {
  if (!TRASH_ENTRY_PATTERN.test(entry)) {
    throw new ProjectError('not a trash entry name: ' + JSON.stringify(entry))
  }
  const trash = resolve(root, TRASH_DIR)
  const full = resolve(trash, entry)
  if (!full.startsWith(trash + sep)) {
    throw new ProjectError('trash entry ' + JSON.stringify(entry) + ' escapes the trash directory')
  }
  return full
}

/** Total bytes under a directory, for telling a user what a purge would destroy. */
export async function directorySize(dir: string, depth = 0): Promise<number> {
  if (depth > 6) return 0
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  let total = 0
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) total += await directorySize(full, depth + 1)
    else if (entry.isFile()) total += await fs.stat(full).then((stat) => stat.size, () => 0)
  }
  return total
}

export interface TrashEntry {
  /** Directory name inside `.trash`; the handle for restore and purge. */
  entry: string
  /** The project id it will return to. */
  id: string
  title: string
  removed_at: string
  created_at: string
  bytes: number
}

/** Trashed projects, newest first. Unreadable entries are skipped, not thrown on. */
export async function listTrash(root: string): Promise<TrashEntry[]> {
  const trash = join(root, TRASH_DIR)
  let entries: Dirent[]
  try {
    entries = await fs.readdir(trash, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const found: TrashEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(trash, entry.name)
    const marker = await readJson<ProjectMarker>(join(dir, PROJECT_MARKER))
    if (marker === undefined) continue
    const stat = await fs.stat(dir).catch(() => undefined)
    found.push({
      entry: entry.name,
      id: marker.id,
      title: marker.title,
      created_at: marker.created_at,
      removed_at: (stat?.mtime ?? new Date()).toISOString(),
      bytes: await directorySize(dir),
    })
  }
  found.sort((a, b) => b.removed_at.localeCompare(a.removed_at))
  return found
}

export interface ProjectSummary {
  id: string
  title: string
  created_at: string
  target_duration_seconds: number
}

export async function listProjects(root: string): Promise<ProjectSummary[]> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const summaries: ProjectSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!ID_PATTERN.test(entry.name)) continue
    const marker = await readJson<ProjectMarker>(join(root, entry.name, PROJECT_MARKER))
    if (marker === undefined) continue
    summaries.push({
      id: marker.id,
      title: marker.title,
      created_at: marker.created_at,
      target_duration_seconds: marker.target_duration_seconds,
    })
  }
  summaries.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return summaries
}

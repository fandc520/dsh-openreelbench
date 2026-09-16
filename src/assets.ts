/**
 * Bringing generated media into a project, and editing it once it is there.
 *
 * Both the `openreel_project` tool and the panel's HTTP route land here, which is
 * the point: file naming is one rule in one place. Callers parse their own
 * input — tool arguments and a JSON body are different shapes — and hand this
 * module an already-typed request.
 */
import { dirname, extname, isAbsolute, join, relative as relativePathBetween } from 'node:path'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'

import { type ProjectLayout, ensureDir, pathExists, resolveInProject, toProjectRelative } from './project.js'

/**
 * `music` is not a third media type — it is audio with a different LIFETIME.
 * Every other asset belongs to one script section and is named after it; the
 * music bed belongs to the whole film and has no section to be named after.
 * That difference is why it is a kind rather than a flag.
 */
export const IMPORT_KINDS = ['image', 'audio', 'music'] as const
export type ImportKind = (typeof IMPORT_KINDS)[number]

export class AssetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssetError'
  }
}

/**
 * Asset file names follow one rule, generated here rather than accepted from
 * the caller: `<seq>-<sceneId>[.v<n>].<ext>`.
 *
 * With the sequence baked in, a directory listing is already in playback order,
 * and the scene id makes every file traceable to its section without opening a
 * manifest.
 */
export function assetFileName(seq: number, sceneId: string, version: number, ext: string): string {
  const stem = String(seq).padStart(2, '0') + '-' + sceneId.replace(/[^A-Za-z0-9._-]+/g, '_')
  return (version <= 1 ? stem : stem + '.v' + version) + ext
}

/** Windows separators break the string concatenation the paths below use. */
export function toPosix(path: string): string {
  return path.split('\\').join('/')
}

function assetExtension(source: string, kind: ImportKind): string {
  const bare = source.split('?')[0] ?? source
  const ext = extname(bare).toLowerCase()
  if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext
  return kind === 'image' ? '.png' : '.wav'
}

/** `music.wav`, then `music.v2.wav`. Older beds stay on disk to go back to. */
async function nextFreeMusicPath(dir: string, ext: string): Promise<string> {
  for (let version = 1; version <= 999; version += 1) {
    const candidate = dir + '/' + (version <= 1 ? 'music' : 'music.v' + version) + ext
    if (!(await pathExists(candidate))) return candidate
  }
  throw new AssetError('too many music beds already on disk')
}

async function nextFreePath(dir: string, seq: number, sceneId: string, ext: string): Promise<string> {
  for (let version = 1; version <= 999; version += 1) {
    const candidate = dir + '/' + assetFileName(seq, sceneId, version, ext)
    if (!(await pathExists(candidate))) return candidate
  }
  throw new AssetError('too many versions of ' + sceneId + ' already on disk')
}

export interface ImportRequest {
  source: string
  kind: ImportKind
  /** Absent for `music`, which belongs to the film rather than to a section. */
  sceneId?: string | undefined
}

export interface ImportedAsset {
  source: string
  kind: ImportKind
  /** Empty for `music`. */
  scene_id: string
  path: string
  bytes: number
}

/**
 * Copy or download each item into the project under the naming rule.
 * @param order - section id -> its 1-based position in the approved script.
 */
export async function importAssets(
  layout: ProjectLayout,
  order: ReadonlyMap<string, number>,
  items: readonly ImportRequest[],
  signal: AbortSignal,
): Promise<ImportedAsset[]> {
  const imported: ImportedAsset[] = []
  for (const [index, item] of items.entries()) {
    const targetDir = toPosix(item.kind === 'image' ? layout.imagesDir : layout.audioDir)
    await ensureDir(targetDir)
    const ext = assetExtension(item.source, item.kind)

    // The music bed has no section, so it cannot take the sequenced name. It
    // gets a fixed stem instead, which also means the compose step can find
    // yesterday's bed without consulting anything.
    let target: string
    if (item.kind === 'music') {
      target = await nextFreeMusicPath(targetDir, ext)
    } else {
      const seq = order.get(item.sceneId ?? '')
      if (seq === undefined) {
        throw new AssetError(
          'items[' + index + '].scene_id ' + JSON.stringify(item.sceneId)
          + ' is not a section in the approved script. Valid ids: ' + [...order.keys()].join(', '),
        )
      }
      target = await nextFreePath(targetDir, seq, item.sceneId ?? '', ext)
    }

    if (/^https?:\/\//i.test(item.source)) {
      // The generating workflow may live on another host, so a media URL is
      // often the only handle on the file.
      const response = await fetch(item.source, { signal })
      if (!response.ok) {
        throw new AssetError('could not fetch ' + item.source + ': HTTP ' + response.status + ' ' + response.statusText)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.byteLength === 0) throw new AssetError(item.source + ' returned an empty body')
      await fs.writeFile(target, buffer)
      imported.push({ ...item, scene_id: item.sceneId ?? '', path: toProjectRelative(layout, target), bytes: buffer.byteLength })
      continue
    }

    if (!isAbsolute(item.source)) {
      throw new AssetError(
        'items[' + index + '].source must be an absolute path or an http(s) URL, got ' + JSON.stringify(item.source),
      )
    }
    if (!(await pathExists(item.source))) {
      throw new AssetError('source file does not exist: ' + item.source)
    }
    await fs.copyFile(item.source, target)
    const stat = await fs.stat(target)
    imported.push({ ...item, scene_id: item.sceneId ?? '', path: toProjectRelative(layout, target), bytes: stat.size })
  }
  return imported
}

/**
 * The marker patch an import implies.
 *
 * Music is the only kind that has one: it is recorded on the project rather
 * than in an asset manifest, so importing the file and recording it are one
 * gesture. Split into two, the file would sit on disk with nothing pointing at
 * it whenever the second step was forgotten — and nothing would report that,
 * because a file nobody references is indistinguishable from no file.
 *
 * The last one wins if several arrive together: a second bed replaces the
 * first, it does not layer under it.
 */
export function musicPatchOf(imported: readonly ImportedAsset[]): { path: string } | undefined {
  const beds = imported.filter((entry) => entry.kind === 'music')
  const last = beds[beds.length - 1]
  return last === undefined ? undefined : { path: last.path }
}

/* -------------------------------------------------------------- trimming */

function runFfmpeg(ffmpegPath: string, args: string[], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    try {
      child = spawn(ffmpegPath, args, { windowsHide: true })
    } catch (error) {
      rejectPromise(new AssetError('cannot start ' + ffmpegPath + ': ' + (error as Error).message))
      return
    }
    let stderr = ''
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8192) })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectPromise(new AssetError('ffmpeg timed out'))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      rejectPromise(new AssetError('ffmpeg failed to run: ' + error.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise()
      else rejectPromise(new AssetError('ffmpeg exited ' + code + '\n' + stderr.trim().split('\n').slice(-6).join('\n')))
    })
  })
}

/**
 * Where a take's pre-trim copy lives: the same relative path, under
 * `originals/`.
 *
 * Mirroring the path rather than flattening to a file name keeps two takes
 * called `01-intro.wav` in different directories apart, and makes the backup
 * readable as "this file, before anyone cut it" without an index to consult.
 */
function originalPathOf(layout: ProjectLayout, absolute: string): string {
  return join(layout.originalsDir, toProjectRelative(layout, absolute))
}

/** Does this take still have a pre-trim copy to go back to? */
export async function hasOriginalAudio(layout: ProjectLayout, relativePath: string): Promise<boolean> {
  return pathExists(originalPathOf(layout, resolveInProject(layout, relativePath)))
}

/** Every take with a pre-trim copy, as project-relative asset paths. */
export async function listTrimmedAudio(layout: ProjectLayout): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) await walk(child, depth + 1)
      else if (entry.isFile()) found.push(toPosix(relativePathBetween(layout.originalsDir, child)))
    }
  }
  await walk(layout.originalsDir, 0)
  return found.sort()
}

/**
 * Trim an asset's head and tail in place.
 *
 * Written to a sibling temp file and renamed over the original, so a failure
 * part-way leaves the original intact rather than a truncated file the manifest
 * still points at. Audio is re-encoded to PCM rather than stream-copied:
 * a copy cuts on packet boundaries, which is audible on a clip this short.
 *
 * The FIRST trim of a take copies it to `originals/` before cutting, and later
 * trims leave that copy alone. That is what makes undo mean "back to the take
 * as generated" rather than "back one cut": a trim is not a step in a history,
 * it is a rewrite, and stacking three of them leaves no coordinate system in
 * which "one step back" is a thing anyone could point at on the waveform.
 */
export async function trimAudioAsset(options: {
  ffmpegPath: string
  ffprobePath?: string
  layout: ProjectLayout
  relativePath: string
  start: number
  end?: number | undefined
}): Promise<{ path: string; bytes: number; seconds?: number; undoable: boolean }> {
  const { ffmpegPath, ffprobePath, layout, relativePath, start, end } = options
  const absolute = resolveInProject(layout, relativePath)
  if (!(await pathExists(absolute))) throw new AssetError('no such asset: ' + relativePath)
  if (!Number.isFinite(start) || start < 0) throw new AssetError('start must be a non-negative number of seconds')
  if (end !== undefined && (!Number.isFinite(end) || end <= start)) {
    throw new AssetError('end must be greater than start')
  }

  const backup = originalPathOf(layout, absolute)
  if (!(await pathExists(backup))) {
    await ensureDir(dirname(backup))
    // copyFile, not rename: the asset has to stay where it is for ffmpeg to
    // read it, and for the manifest to keep pointing at something.
    await fs.copyFile(absolute, backup)
  }

  const temp = absolute + '.trim.wav'
  const args = ['-y', '-nostdin', '-i', absolute, '-ss', start.toFixed(3)]
  if (end !== undefined) args.push('-to', end.toFixed(3))
  args.push('-c:a', 'pcm_s16le', '-ar', '48000', temp)

  try {
    await runFfmpeg(ffmpegPath, args)
    await fs.rename(temp, absolute)
  } catch (error) {
    await fs.rm(temp, { force: true })
    throw error
  }
  const stat = await fs.stat(absolute)
  const seconds = await measure(ffprobePath, absolute)
  return {
    path: relativePath,
    bytes: stat.size,
    ...(seconds === undefined ? {} : { seconds }),
    undoable: true,
  }
}

/**
 * Put a trimmed take back the way it was generated.
 *
 * The backup is COPIED back rather than moved, so the undo is itself
 * repeatable: trim, undo, trim again, undo again. A move would make the second
 * undo fail with "nothing to restore" on a take the user can plainly see has
 * been cut.
 */
export async function restoreAudioAsset(options: {
  ffprobePath?: string
  layout: ProjectLayout
  relativePath: string
}): Promise<{ path: string; bytes: number; seconds?: number; restored: boolean }> {
  const { ffprobePath, layout, relativePath } = options
  const absolute = resolveInProject(layout, relativePath)
  const backup = originalPathOf(layout, absolute)
  if (!(await pathExists(backup))) {
    throw new AssetError('this take has not been trimmed, so there is nothing to restore: ' + relativePath)
  }
  await ensureDir(dirname(absolute))
  await fs.copyFile(backup, absolute)
  const stat = await fs.stat(absolute)
  const seconds = await measure(ffprobePath, absolute)
  return {
    path: relativePath,
    bytes: stat.size,
    ...(seconds === undefined ? {} : { seconds }),
    restored: true,
  }
}

/**
 * How long the file on disk is, in seconds.
 *
 * Best-effort on purpose: a missing ffprobe must not turn a trim that already
 * succeeded into an error. The caller treats `undefined` as "the recorded
 * duration stands", which is exactly what it was before this existed.
 */
async function measure(ffprobePath: string | undefined, absolute: string): Promise<number | undefined> {
  if (ffprobePath === undefined || ffprobePath === '') return undefined
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(ffprobePath, [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', absolute,
      ], { windowsHide: true })
    } catch {
      resolvePromise(undefined)
      return
    }
    let out = ''
    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => { out += chunk })
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolvePromise(undefined) }, 15_000)
    child.on('error', () => { clearTimeout(timer); resolvePromise(undefined) })
    child.on('close', () => {
      clearTimeout(timer)
      const value = Number(out.trim())
      resolvePromise(Number.isFinite(value) && value > 0 ? Number(value.toFixed(3)) : undefined)
    })
  })
}

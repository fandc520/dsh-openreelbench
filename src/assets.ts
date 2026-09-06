/**
 * Bringing generated media into a project, and editing it once it is there.
 *
 * Both the `studio_project` tool and the panel's HTTP route land here, which is
 * the point: file naming is one rule in one place. Callers parse their own
 * input — tool arguments and a JSON body are different shapes — and hand this
 * module an already-typed request.
 */
import { extname, isAbsolute } from 'node:path'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'

import { type ProjectLayout, ensureDir, pathExists, resolveInProject, toProjectRelative } from './project.js'

export const IMPORT_KINDS = ['image', 'audio'] as const
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
  sceneId: string
}

export interface ImportedAsset {
  source: string
  kind: ImportKind
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
    const seq = order.get(item.sceneId)
    if (seq === undefined) {
      throw new AssetError(
        'items[' + index + '].scene_id ' + JSON.stringify(item.sceneId)
        + ' is not a section in the approved script. Valid ids: ' + [...order.keys()].join(', '),
      )
    }

    const targetDir = toPosix(item.kind === 'image' ? layout.imagesDir : layout.audioDir)
    await ensureDir(targetDir)
    const target = await nextFreePath(targetDir, seq, item.sceneId, assetExtension(item.source, item.kind))

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
      imported.push({ ...item, scene_id: item.sceneId, path: toProjectRelative(layout, target), bytes: buffer.byteLength })
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
    imported.push({ ...item, scene_id: item.sceneId, path: toProjectRelative(layout, target), bytes: stat.size })
  }
  return imported
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
 * Trim an asset's head and tail in place.
 *
 * Written to a sibling temp file and renamed over the original, so a failure
 * part-way leaves the original intact rather than a truncated file the manifest
 * still points at. Audio is re-encoded to PCM rather than stream-copied:
 * a copy cuts on packet boundaries, which is audible on a clip this short.
 */
export async function trimAudioAsset(options: {
  ffmpegPath: string
  layout: ProjectLayout
  relativePath: string
  start: number
  end?: number | undefined
}): Promise<{ path: string; bytes: number }> {
  const { ffmpegPath, layout, relativePath, start, end } = options
  const absolute = resolveInProject(layout, relativePath)
  if (!(await pathExists(absolute))) throw new AssetError('no such asset: ' + relativePath)
  if (!Number.isFinite(start) || start < 0) throw new AssetError('start must be a non-negative number of seconds')
  if (end !== undefined && (!Number.isFinite(end) || end <= start)) {
    throw new AssetError('end must be greater than start')
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
  return { path: relativePath, bytes: stat.size }
}

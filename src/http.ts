/**
 * HTTP helpers for the studio routes.
 *
 * Deliberately a local copy rather than an import from dsh-comfyui: a plugin
 * must not depend on another plugin's internals, and these are a few dozen
 * lines of well-understood plumbing.
 *
 * The media reader is the part with real substance. A browser seeking inside a
 * rendered film issues ranged requests, and a server that answers every one of
 * them with the whole file makes the scrub bar unusable on anything longer than
 * a few seconds — so `sendFile` speaks `Range` properly, including the 416 that
 * tells a client its range was nonsense.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { extname } from 'node:path'

/** Send a JSON response with no-store caching. */
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

/** Read and parse a JSON request body; undefined when the body is empty. */
export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return undefined
  return JSON.parse(text) as unknown
}

/**
 * Whether a request originates from the page that served it.
 *
 * A missing Origin is allowed because same-origin GETs and non-browser callers
 * omit it; the check exists to stop another site's script from driving the
 * writes, and those always carry an Origin.
 */
export function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined) return true
  if (host === undefined) return false
  return origin === 'http://' + host || origin === 'https://' + host
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Query parameters of a request URL, resolved against a dummy base. */
export function query(request: IncomingMessage): URLSearchParams {
  return new URL(request.url ?? '/', 'http://localhost').searchParams
}

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.weba': 'audio/webm',
  '.opus': 'audio/opus',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** Media categories the library groups files into. */
export type MediaKind = 'audio' | 'image' | 'video' | 'text' | 'other'

/**
 * The URL a browser fetches one project file from.
 *
 * Lives here rather than beside the route because two callers mint it: the
 * routes that describe a project to the panel, and `studio_show`, which puts
 * media in front of the user through a tool card. One spelling, so a change to
 * the route cannot leave the card pointing at nothing.
 */
export function mediaUrl(projectId: string, relativePath: string, download = false): string {
  const params = new URLSearchParams({ project: projectId, path: relativePath })
  if (download) params.set('download', '1')
  return '/studio/media?' + params.toString()
}

export function mediaKindOf(path: string): MediaKind {
  const type = contentTypeOf(path)
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  // Subtitles are the reason this kind exists: a .srt handed back as a
  // download link is the one thing nobody can check at a glance, and checking
  // it at a glance is the whole point of showing it.
  if (type.startsWith('text/') || type.startsWith('application/json')) return 'text'
  return 'other'
}

/** `bytes=<start>-<end>`, resolved against a known size. undefined = no range. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | undefined {
  if (header === undefined) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return 'invalid'
  // A suffix range ("bytes=-500") asks for the final N bytes.
  const start = rawStart === '' ? Math.max(0, size - Number(rawEnd)) : Number(rawStart)
  const end = rawStart === '' || rawEnd === '' ? size - 1 : Number(rawEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid'
  if (start > end || start < 0 || start >= size) return 'invalid'
  return { start, end: Math.min(end, size - 1) }
}

/**
 * Stream a file, honouring `Range` so media players can seek.
 * @param download - send as an attachment under `filename` instead of inline.
 */
export async function sendFile(
  request: IncomingMessage,
  response: ServerResponse,
  absolutePath: string,
  options: { download?: boolean; filename?: string } = {},
): Promise<void> {
  let size: number
  try {
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) {
      sendJson(response, 404, { error: 'not a file' })
      return
    }
    size = stat.size
  } catch {
    sendJson(response, 404, { error: 'not found' })
    return
  }

  const headers: Record<string, string> = {
    'content-type': contentTypeOf(absolutePath),
    'accept-ranges': 'bytes',
    // Project files are rewritten in place when a take is replaced, so a
    // cached copy would show the old media under the same URL.
    'cache-control': 'no-cache',
  }
  if (options.download === true) {
    const name = (options.filename ?? absolutePath.split(/[\\/]/).pop() ?? 'download')
      .replace(/["\\]/g, '_')
    headers['content-disposition'] = 'attachment; filename="' + name + '"'
  }

  const range = parseRange(request.headers.range, size)
  if (range === 'invalid') {
    response.writeHead(416, { 'content-range': 'bytes */' + size })
    response.end()
    return
  }

  if (range === undefined) {
    headers['content-length'] = String(size)
    response.writeHead(200, headers)
    createReadStream(absolutePath).pipe(response)
    return
  }

  headers['content-length'] = String(range.end - range.start + 1)
  headers['content-range'] = 'bytes ' + range.start + '-' + range.end + '/' + size
  response.writeHead(206, headers)
  createReadStream(absolutePath, { start: range.start, end: range.end }).pipe(response)
}

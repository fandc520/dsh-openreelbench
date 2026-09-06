/**
 * SRT generation from the measured timeline.
 *
 * Subtitles are written from what the narration actually turned out to be, not
 * from the script's planned `start_seconds` / `end_seconds`. TTS never lands on
 * the planned length, and a subtitle track built from the plan drifts further
 * out of sync with every section.
 */

export interface SubtitleCue {
  /** Seconds from the start of the render. */
  start: number
  end: number
  text: string
}

function pad(value: number, width: number): string {
  return value.toString().padStart(width, '0')
}

/** `HH:MM:SS,mmm` — SRT uses a comma before the milliseconds. */
export function formatTimestamp(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const totalMs = Math.round(clamped * 1000)
  const ms = totalMs % 1000
  const totalSeconds = (totalMs - ms) / 1000
  const s = totalSeconds % 60
  const totalMinutes = (totalSeconds - s) / 60
  const m = totalMinutes % 60
  const h = (totalMinutes - m) / 60
  return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + ',' + pad(ms, 3)
}

/**
 * Break one narration line into on-screen chunks. CJK text has no spaces to
 * wrap on, so the split is by punctuation first and by character count as a
 * fallback; Latin text still splits on the same punctuation and then on word
 * boundaries.
 */
export function splitCueText(text: string, maxChars: number): string[] {
  const normalised = text.replace(/\s+/g, ' ').trim()
  if (normalised === '') return []
  if (normalised.length <= maxChars) return [normalised]

  const clauses = normalised
    .split(/(?<=[。！？；.!?;：:，,、])/u)
    .map((part) => part.trim())
    .filter((part) => part !== '')

  const chunks: string[] = []
  let current = ''
  for (const clause of clauses) {
    if (clause.length > maxChars) {
      if (current !== '') {
        chunks.push(current)
        current = ''
      }
      chunks.push(...hardWrap(clause, maxChars))
      continue
    }
    if (current === '') {
      current = clause
    } else if (current.length + clause.length <= maxChars) {
      current += clause
    } else {
      chunks.push(current)
      current = clause
    }
  }
  if (current !== '') chunks.push(current)
  return chunks.length > 0 ? chunks : hardWrap(normalised, maxChars)
}

function hardWrap(text: string, maxChars: number): string[] {
  // Prefer a space near the limit so Latin words survive; CJK falls through to
  // a flat character split, which is what readers of those scripts expect.
  const out: string[] = []
  let rest = text
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1)
    const space = window.lastIndexOf(' ')
    const cut = space > maxChars * 0.6 ? space : maxChars
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest !== '') out.push(rest)
  return out
}

/**
 * Split one section's speech window into cues proportional to chunk length,
 * so a long clause holds the screen longer than a short one.
 */
/**
 * @param segments - an editor's own split, replacing the automatic one. Only
 * the SEGMENTATION is stored in a cut, never the times: keeping timing derived
 * means a cue survives a pad change, a trim, or a re-recorded take, all of
 * which would leave stored timestamps pointing at the wrong words.
 */
export function cuesForSection(
  start: number,
  end: number,
  text: string,
  maxChars: number,
  segments?: ReadonlyArray<{ text: string; weight?: number }>,
): SubtitleCue[] {
  const chunks: Array<{ text: string; weight?: number }> = segments !== undefined && segments.length > 0
    ? segments
      .map((segment) => ({ ...segment, text: segment.text.trim() }))
      .filter((segment) => segment.text !== '')
    : splitCueText(text, maxChars).map((chunk) => ({ text: chunk }))
  if (chunks.length === 0) return []
  const span = Math.max(0.001, end - start)
  // A weight is an explicit share; without one a cue takes time in proportion
  // to its length, so a long clause holds the screen longer than a short one.
  // Weights stay relative for the same reason the segmentation is text-only:
  // the window they divide moves, and shares move with it.
  const weights = chunks.map((chunk) => chunk.weight ?? chunk.text.length)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const cues: SubtitleCue[] = []
  let cursor = start
  chunks.forEach((chunk, index) => {
    const share = total === 0 ? span / chunks.length : (weights[index]! / total) * span
    const cueEnd = index === chunks.length - 1 ? end : Math.min(end, cursor + share)
    cues.push({ start: cursor, end: cueEnd, text: chunk.text })
    cursor = cueEnd
  })
  return cues
}

export function renderSrt(cues: readonly SubtitleCue[]): string {
  return cues
    .map((cue, index) =>
      (index + 1) + '\n'
      + formatTimestamp(cue.start) + ' --> ' + formatTimestamp(cue.end) + '\n'
      + cue.text + '\n')
    .join('\n')
}

/** One cue as read back off disk. */
export interface ParsedCue {
  index: number
  start: number
  end: number
  text: string
}

/** `HH:MM:SS,mmm` — a dot is accepted too, since some writers emit one. */
function parseTimestamp(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(value.trim())
  if (match === null) return undefined
  const [, hours, minutes, seconds, millis] = match
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
    + Number(millis!.padEnd(3, '0')) / 1000
}

/**
 * Read an SRT back.
 *
 * It lives beside `renderSrt` because one module should own a format in both
 * directions: the compose screen draws its cue lane from the file that actually
 * shipped, and a reader that drifts from the writer would show a subtitle track
 * nobody will ever see.
 *
 * Malformed blocks are skipped rather than thrown on. A cue lane is a reading
 * aid, and losing one cue is a far better outcome than losing the whole
 * timeline to a stray blank line.
 */
export function parseSrt(source: string): ParsedCue[] {
  const cues: ParsedCue[] = []
  const blocks = source.replace(/\r\n/g, '\n').trim().split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trim()).filter((line) => line !== '')
    if (lines.length < 2) continue
    // The index line is optional in practice; find the line carrying the arrow.
    const arrowAt = lines.findIndex((line) => line.includes('-->'))
    if (arrowAt === -1) continue
    const [rawStart, rawEnd] = lines[arrowAt]!.split('-->')
    const start = parseTimestamp(rawStart ?? '')
    const end = parseTimestamp(rawEnd ?? '')
    if (start === undefined || end === undefined || end < start) continue
    const text = lines.slice(arrowAt + 1).join(' ')
    if (text === '') continue
    cues.push({ index: cues.length + 1, start, end, text })
  }
  return cues
}

/**
 * Cuts — the edit versions of a finished film.
 *
 * Everything before the compose stage produces *material*: a script, takes,
 * pictures. Each of those can be thrown away and re-rolled, and the cost of
 * being wrong is machine time. This stage is different. Here a person watches
 * the whole thing in sync and decides that a pause is too long or a shot holds
 * a beat past its welcome — judgements that can only be made with the audio and
 * the picture together, and that cost human attention rather than GPU minutes.
 * Losing that is not something a re-roll fixes, which is why a cut is saved,
 * named, and kept.
 *
 * A cut is an OVERRIDE LAYER, not a copy. It records only what the editor
 * changed against the plan, so a re-generated take or a re-written prompt still
 * flows through: the film that ships is allowed to differ from the plan the way
 * a finished film differs from its screenplay, without the plan being rewritten
 * to match after the fact.
 */
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

import { type ProjectLayout, ensureDir, readJson, writeJsonAtomic } from './project.js'

/** One section's timing as the editor left it. */
export interface CutSection {
  id: string
  /** Silence before the narration; absent keeps the style's own. */
  lead?: number
  /** Silence after it. */
  tail?: number
  /**
   * Seconds cut off the head and tail of the narration clip.
   *
   * Padding stops at zero — past that, shortening a section means shortening
   * what is said, and that is a different act from adjusting a pause. Keeping
   * them separate is what lets a drag past the edge stay honest about which
   * one it is doing.
   */
  trimStart?: number
  trimEnd?: number
  /**
   * The subtitle segmentation as the editor left it — text only.
   *
   * Times stay derived from the speech window, so a cue keeps pointing at the
   * right words after a pad change, a trim, or a re-recorded take. Storing
   * timestamps here would freeze them against material that moves.
   */
  cues?: Array<{ text: string; weight?: number }>
  /**
   * Silence at the ends of the subtitle run, inside the speech window.
   *
   * Cues otherwise tile that window exactly, which forces the first one on at
   * the instant the voice starts. Subtitles usually want to arrive a beat late
   * and leave a beat early, and that beat is not a pause in the audio — so it
   * is its own inset rather than a change to the section's pads.
   */
  cueLead?: number
  cueTail?: number
  /**
   * Shot order and shares, by asset id. Absent keeps the manifest order.
   * An id no longer in the manifest is ignored, so re-generating a shot does
   * not strand the cut.
   */
  shots?: Array<{ assetId: string; weight?: number }>
}

export interface Cut {
  version: '1.0'
  id: string
  name: string
  created_at: string
  updated_at: string
  /** Free note: what this version was trying to do. */
  note?: string
  sections: CutSection[]
  /** Set once this cut has been rendered. */
  output?: string
  duration_seconds?: number
}

export class CutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CutError'
  }
}

/** Cut ids name files, so they are held to the same shape as project ids. */
const CUT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function assertCutId(id: string): string {
  if (!CUT_ID.test(id)) {
    throw new CutError('cut id must be lowercase letters, digits, - or _, got ' + JSON.stringify(id))
  }
  return id
}

function cutsDir(layout: ProjectLayout): string {
  return join(layout.dir, 'cuts')
}

export function cutPath(layout: ProjectLayout, id: string): string {
  return join(cutsDir(layout), assertCutId(id) + '.json')
}

export async function listCuts(layout: ProjectLayout): Promise<Cut[]> {
  let names: string[]
  try {
    names = await fs.readdir(cutsDir(layout))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const cuts: Cut[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const cut = await readJson<Cut>(join(cutsDir(layout), name))
    if (cut !== undefined) cuts.push(cut)
  }
  cuts.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return cuts
}

export async function readCut(layout: ProjectLayout, id: string): Promise<Cut | undefined> {
  return readJson<Cut>(cutPath(layout, id))
}

export async function writeCut(layout: ProjectLayout, cut: Cut): Promise<Cut> {
  await ensureDir(cutsDir(layout))
  await writeJsonAtomic(cutPath(layout, cut.id), cut)
  return cut
}

export async function deleteCut(layout: ProjectLayout, id: string): Promise<void> {
  await fs.rm(cutPath(layout, id), { force: true })
}

/** Normalise whatever the panel sent into a storable cut. */
export function parseCut(input: Record<string, unknown>, existing?: Cut): Cut {
  const id = typeof input.id === 'string' ? assertCutId(input.id.trim()) : undefined
  if (id === undefined) throw new CutError('a cut needs an id')
  const name = typeof input.name === 'string' && input.name.trim() !== ''
    ? input.name.trim()
    : existing?.name ?? id

  const sections: CutSection[] = []
  if (Array.isArray(input.sections)) {
    for (const raw of input.sections) {
      if (raw === null || typeof raw !== 'object') continue
      const entry = raw as Record<string, unknown>
      if (typeof entry.id !== 'string' || entry.id.trim() === '') continue
      const section: CutSection = { id: entry.id.trim() }
      // A pad is a real number of seconds, and zero is meaningful — it is how
      // an editor removes a pause entirely.
      if (typeof entry.lead === 'number' && Number.isFinite(entry.lead) && entry.lead >= 0) {
        section.lead = Math.min(10, entry.lead)
      }
      if (typeof entry.tail === 'number' && Number.isFinite(entry.tail) && entry.tail >= 0) {
        section.tail = Math.min(10, entry.tail)
      }
      if (typeof entry.trimStart === 'number' && Number.isFinite(entry.trimStart) && entry.trimStart >= 0) {
        section.trimStart = entry.trimStart
      }
      if (typeof entry.trimEnd === 'number' && Number.isFinite(entry.trimEnd) && entry.trimEnd >= 0) {
        section.trimEnd = entry.trimEnd
      }
      if (typeof entry.cueLead === 'number' && Number.isFinite(entry.cueLead) && entry.cueLead >= 0) {
        section.cueLead = entry.cueLead
      }
      if (typeof entry.cueTail === 'number' && Number.isFinite(entry.cueTail) && entry.cueTail >= 0) {
        section.cueTail = entry.cueTail
      }
      if (Array.isArray(entry.cues)) {
        const cues: Array<{ text: string; weight?: number }> = []
        for (const raw of entry.cues) {
          // Plain strings are the pre-weight spelling, still accepted so a cut
          // saved before weights existed keeps working.
          if (typeof raw === 'string') {
            const text = raw.trim()
            if (text !== '') cues.push({ text })
            continue
          }
          if (raw === null || typeof raw !== 'object') continue
          const cue = raw as { text?: unknown; weight?: unknown }
          if (typeof cue.text !== 'string' || cue.text.trim() === '') continue
          cues.push({
            text: cue.text.trim(),
            ...(typeof cue.weight === 'number' && Number.isFinite(cue.weight) && cue.weight > 0
              ? { weight: cue.weight } : {}),
          })
        }
        if (cues.length > 0) section.cues = cues
      }
      if (Array.isArray(entry.shots)) {
        const shots: Array<{ assetId: string; weight?: number }> = []
        for (const rawShot of entry.shots) {
          if (rawShot === null || typeof rawShot !== 'object') continue
          const shot = rawShot as Record<string, unknown>
          if (typeof shot.assetId !== 'string' || shot.assetId.trim() === '') continue
          shots.push({
            assetId: shot.assetId.trim(),
            ...(typeof shot.weight === 'number' && Number.isFinite(shot.weight) && shot.weight > 0
              ? { weight: shot.weight } : {}),
          })
        }
        if (shots.length > 0) section.shots = shots
      }
      sections.push(section)
    }
  }

  const now = new Date().toISOString()
  return {
    version: '1.0',
    id,
    name,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    ...(typeof input.note === 'string' && input.note.trim() !== '' ? { note: input.note.trim() } : {}),
    sections,
    ...(existing?.output === undefined ? {} : { output: existing.output }),
    ...(existing?.duration_seconds === undefined ? {} : { duration_seconds: existing.duration_seconds }),
  }
}

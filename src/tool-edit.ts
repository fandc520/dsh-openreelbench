/**
 * `openreel_edit` — editing the film after the pictures exist.
 *
 * The fifth tool, and the reason it exists at all is the rule in CONVENTIONS
 * §8: a step the panel can do directly must ALSO be reachable by the agent,
 * because an unattended run has no panel. Saving a cut, deleting one and
 * trimming a take were panel-only, which left the automatic path able to render
 * the plan version and nothing else.
 *
 * In its own module rather than in `tools.ts` because the cut schema is most of
 * its length — the shape a cut may take is genuinely large, and describing it
 * to the model is the bulk of the work here.
 *
 * EDITING IS DELIBERATELY NOT GATED. A cut is a proposal; the gate is compose,
 * where the render is judged. Putting an approval in front of every trim would
 * gate an act whose whole point is that it is cheap to try.
 */
import { type ToolDefinition, type PluginRuntime, requireString, optionalRecord, text } from './tools.js'
import { CutError, deleteCut, listCuts, parseCut, readCut, writeCut } from './cuts.js'
import { AssetError, trimAudioAsset } from './assets.js'
import { StateViolationError } from './state.js'

const NL = String.fromCharCode(10)

export function editDefinition(runtime: PluginRuntime): ToolDefinition {
  const { machine } = runtime
  return {
    name: 'openreel_edit',
    description:
      'Edit the film: save or delete a cut (an edit version), and trim a narration clip. '
      + 'A CUT IS NON-DESTRUCTIVE — it stores per-section pauses, trims, subtitle text and shot '
      + 'order layered over the approved script, so several versions live side by side and the '
      + 'plan version is always still there. TRIM IS DESTRUCTIVE: it rewrites the audio file in '
      + 'place. Trim for a take with silence or a breath at the ends; use a cut section\'s '
      + 'trimStart/trimEnd when the change belongs to one version rather than to the material.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['cuts', 'save_cut', 'delete_cut', 'trim_audio'],
          description: 'What to do.',
        },
        project: { type: 'string', description: 'Project id. Required for every action.' },
        cut: {
          type: 'object',
          description:
            'save_cut: the whole cut document. Saving an existing id REPLACES that version — '
            + 'read it back with action "cuts" first if you mean to amend one.',
          properties: {
            id: { type: 'string', description: 'Stable id, lowercase letters, digits, - and _. Names the file.' },
            name: { type: 'string', description: 'What this version is called in the panel.' },
            note: { type: 'string', description: 'What this version was trying to do.' },
            sections: {
              type: 'array',
              description: 'Per-section overrides. A section left out keeps the style default.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Script section id.' },
                  lead: { type: 'number', description: 'Silence before the narration, seconds (0-10).' },
                  tail: { type: 'number', description: 'Silence after it, seconds (0-10).' },
                  trimStart: {
                    type: 'number',
                    description: 'Seconds cut off the head of the clip, for this version only. '
                      + 'Not the same as trim_audio, which changes the file itself.',
                  },
                  trimEnd: { type: 'number', description: 'Seconds cut off its tail, for this version only.' },
                  cueLead: { type: 'number', description: 'Delay before the first subtitle, inside the speech window.' },
                  cueTail: { type: 'number', description: 'Gap after the last one.' },
                  cues: {
                    type: 'array',
                    description:
                      'Subtitle segmentation, TEXT ONLY. Times stay derived from the speech window, so a '
                      + 'cue keeps pointing at the right words after a pad change or a re-recorded take.',
                    items: {
                      type: 'object',
                      properties: {
                        text: { type: 'string' },
                        weight: { type: 'number', description: 'Relative share of the window. Default 1.' },
                      },
                      required: ['text'],
                    },
                  },
                  shots: {
                    type: 'array',
                    description: 'Shot order and shares, by asset id. Absent keeps the manifest order.',
                    items: {
                      type: 'object',
                      properties: {
                        assetId: { type: 'string' },
                        weight: { type: 'number', description: 'Relative share of the section. Default 1.' },
                      },
                      required: ['assetId'],
                    },
                  },
                },
                required: ['id'],
              },
            },
          },
          required: ['id'],
        },
        id: { type: 'string', description: 'delete_cut: which version to remove.' },
        path: {
          type: 'string',
          description: 'trim_audio: project-relative path of the clip, e.g. "assets/audio/01-s1.wav".',
        },
        start: { type: 'number', description: 'trim_audio: new start, seconds from the clip head. Default 0.' },
        end: { type: 'number', description: 'trim_audio: new end, in seconds. Omit to keep the tail.' },
      },
      required: ['action', 'project'],
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        return text(renderEditResult(value as Record<string, unknown>))
      },
    },
    timeoutMs: 120_000,
    async execute(args) {
      const action = requireString(args, 'action')
      const projectId = requireString(args, 'project')
      const { layout } = await machine.requireProject(projectId)

      if (action === 'cuts') {
        return { action, project: projectId, cuts: await listCuts(layout) }
      }

      if (action === 'save_cut') {
        const input = optionalRecord(args, 'cut')
        if (input === undefined) throw new StateViolationError('BAD_REQUEST', 'save_cut needs a cut object')
        try {
          // Parsed and clamped by the SAME function the panel's route uses, so a
          // value the panel could never produce cannot arrive down this path.
          const existing = typeof input.id === 'string' ? await readCut(layout, input.id.trim()) : undefined
          const saved = await writeCut(layout, parseCut(input, existing))
          return { action, project: projectId, cut: saved, replaced: existing !== undefined }
        } catch (error) {
          if (error instanceof CutError) throw new StateViolationError('BAD_REQUEST', error.message)
          throw error
        }
      }

      if (action === 'delete_cut') {
        const id = requireString(args, 'id')
        try {
          const existing = await readCut(layout, id)
          if (existing === undefined) {
            throw new StateViolationError(
              'BAD_REQUEST',
              'project ' + projectId + ' has no cut ' + JSON.stringify(id),
            )
          }
          await deleteCut(layout, id)
          return { action, project: projectId, deleted: id, name: existing.name }
        } catch (error) {
          if (error instanceof CutError) throw new StateViolationError('BAD_REQUEST', error.message)
          throw error
        }
      }

      if (action === 'trim_audio') {
        const relative = requireString(args, 'path')
        const end = typeof args.end === 'number' ? args.end : undefined
        try {
          const result = await trimAudioAsset({
            ffmpegPath: runtime.getConfig().ffmpegPath,
            layout,
            relativePath: relative,
            start: typeof args.start === 'number' ? args.start : 0,
            ...(end === undefined ? {} : { end }),
          })
          return { action, project: projectId, ...result }
        } catch (error) {
          if (error instanceof AssetError) throw new StateViolationError('BAD_REQUEST', error.message)
          throw error
        }
      }

      throw new StateViolationError('BAD_REQUEST', 'unknown action ' + JSON.stringify(action))
    },
  }
}

function renderEditResult(value: Record<string, unknown>): string {
  const action = value.action as string

  if (action === 'cuts') {
    const cuts = value.cuts as Array<{
      id: string; name: string; output?: string; sections: unknown[]; note?: string
    }>
    if (cuts.length === 0) {
      return 'No cuts yet. The plan version is the only one, and it needs no file.'
    }
    return ['Cuts:', ...cuts.map((cut) =>
      '  ' + cut.id.padEnd(18) + cut.name
      + '  (' + cut.sections.length + ' section override(s))'
      + (cut.output === undefined ? '  — not rendered' : '  — rendered')
      + (cut.note === undefined ? '' : '  ' + cut.note))].join(NL)
  }

  if (action === 'save_cut') {
    const cut = value.cut as { id: string; name: string; sections: unknown[] }
    return (value.replaced === true ? 'Replaced cut ' : 'Saved cut ')
      + cut.id + '  "' + cut.name + '"  with ' + cut.sections.length + ' section override(s).'
      + NL + 'Render it with openreel_compose, passing cut: "' + cut.id + '".'
  }

  if (action === 'delete_cut') {
    return 'Deleted cut ' + value.deleted + '  "' + value.name + '". The plan version is untouched.'
  }

  if (action === 'trim_audio') {
    // The manifest's recorded duration is now stale. Deliberately not corrected:
    // the timeline re-probes every clip at render time, so that number is a
    // record of what was measured, never an input. Saying so beats leaving the
    // model to notice a mismatch and try to "fix" it.
    return 'Trimmed ' + value.path + ' — now ' + Math.round((value.bytes as number) / 1024) + ' KB.'
      + NL + 'The timeline re-measures every clip at render time, so nothing else needs updating.'
  }

  return JSON.stringify(value, null, 2)
}

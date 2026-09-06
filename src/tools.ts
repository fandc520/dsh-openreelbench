/**
 * The three model-facing tools.
 *
 * `studio_stage` is the only door into the state machine. `studio_project` and
 * `studio_compose` deliberately cannot advance anything: compose renders a file
 * and hands back a report, and the run is only *recorded* when that report
 * survives `studio_stage`'s checks. Keeping one writer is what makes the
 * governance claim true rather than aspirational.
 *
 * A structural `ToolDefinition` is used instead of importing the harness tool
 * package, matching how dsh-comfyui registers: the plugin then depends on the
 * registry's shape and not on a specific package version.
 */
import { basename, extname, isAbsolute } from 'node:path'
import { promises as fs } from 'node:fs'

import { type Config, bindingWorkflows } from './config.js'
import type { ArtifactName, AssetManifest, Brief, ScenePlan, Script } from './schema.js'
import { type ProjectLayout, ensureDir, pathExists, resolveInProject, toProjectRelative } from './project.js'
import { planSections, renderProject } from './compose.js'
import { resolveVideoProfile } from './media-profile.js'
import { scoreSlideshowRisk } from './slideshow.js'
import { checkSceneVariation } from './variation.js'
import { mediaKindOf, mediaUrl } from './http.js'
import { AssetError, IMPORT_KINDS, type ImportKind, type ImportRequest, importAssets } from './assets.js'
import { type Playbook, listPlaybooks, renderVisualContract, resolvePlaybook } from './playbooks.js'
import { resolvePipeline } from './pipelines.js'
import {
  type Stage,
  STAGES,
  STAGE_ARTIFACT,
  StateMachine,
  StateViolationError,
  GATED_STAGES,
  isStage,
  isStatus,
} from './state.js'

/** A minimal ToolDefinition for ctx.tools.register. */
interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): unknown[]
    /**
     * Structured payload threaded into the session log beside the text, for a
     * `tool.call.toolview` card to render. Text is what a transcript keeps;
     * this is what the card draws from.
     */
    presentationMeta?(args: unknown, value: unknown): unknown
  }
  timeoutMs?: number
  execute(args: Record<string, unknown>, exec: ToolRunContext): Promise<unknown>
}

interface ToolRunContext {
  agent?: unknown
  signal: AbortSignal
}

export interface StudioRuntime {
  getConfig(): Config
  readonly machine: StateMachine
}

function text(body: string): unknown[] {
  return [{ type: 'text', text: body }]
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new StateViolationError('BAD_REQUEST', key + ' is required and must be a non-empty string')
  }
  return value.trim()
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new StateViolationError('BAD_REQUEST', key + ' must be a string')
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function optionalRecord(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new StateViolationError('BAD_REQUEST', key + ' must be a JSON object')
  }
  return value as Record<string, unknown>
}

/** Absolute paths for the model to copy ComfyUI output into. */
function pathsOf(layout: ProjectLayout): Record<string, string> {
  return {
    project: layout.dir,
    images: layout.imagesDir,
    audio: layout.audioDir,
    output: layout.outputDir,
  }
}

/* --------------------------------------------------------- studio_project */

function projectDefinition(runtime: StudioRuntime): ToolDefinition {
  return {
    name: 'studio_project',
    description:
      'Manage creative-studio projects and their working files. '
      + "`init` creates a project directory and returns the absolute paths to write assets into. "
      + "`status` reports every stage, which one is next, and whether the run is parked at an approval gate — call it before doing anything to an existing project. "
      + "`list` enumerates projects. `get` reads back one artifact (brief, script, asset_manifest, render_report). "
      + "`import` copies generated files (absolute local paths, or http(s) URLs such as a dsh-comfyui media proxy link) into the project and returns the project-relative paths the asset manifests require. Each item names the `scene_id` it belongs to; the plugin generates the file name from it, and a repeat import of the same section becomes a new version rather than overwriting. "
      + "`bindings` shows which ComfyUI workflow currently backs TTS and txt2img. "
      + "`style` lists the style playbooks and returns the exact image prompt prefix, suffix, negative prompt and consistency anchors the project must use — read it before writing any image prompt. "
      + "`set_voice` records the narration voice. "
      + 'This tool never advances pipeline state; only studio_stage does.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['init', 'status', 'list', 'get', 'import', 'bindings', 'set_voice', 'style'],
          description: 'What to do.',
        },
        project: { type: 'string', description: 'Project id. Required for status, get, import and set_voice.' },
        title: { type: 'string', description: 'init: human-readable project title.' },
        id: { type: 'string', description: 'init: explicit project id (lowercase letters, digits, - and _). Derived from the title when omitted.' },
        target_duration_seconds: { type: 'number', description: 'init: target length of the finished video.' },
        style: {
          type: 'string',
          description:
            "init: which style playbook the project uses (an id from action 'style'). "
            + "Omitted takes the configured default. action 'style': pass an id to see that playbook in full, "
            + "omit it to list every style with the project's current one marked.",
        },
        voice: {
          type: 'string',
          description:
            'init / set_voice: the narration voice, named exactly as the TTS workflow names it '
            + '(take it from that workflow\'s voice parameter options in `comfyui_workflow action: list`). '
            + 'Designing a new voice is a preparation step the user does in the ComfyUI panel, not part of this pipeline.',
        },
        voice_design_name: {
          type: 'string',
          description: "set_voice: a proposed NAME for a voice to design. Written onto the project so the panel's 音色设计 form can pick it up; it does not change the narration voice.",
        },
        voice_design_prompt: {
          type: 'string',
          description: 'set_voice: the prompt describing that voice, in the same slot.',
        },
        artifact: {
          type: 'string',
          enum: [
            'brief', 'script', 'scene_plan',
            'asset_manifest_audio', 'asset_manifest_shots', 'render_report',
          ],
          description: 'get: which artifact to read.',
        },
        items: {
          type: 'array',
          description: 'import: files to bring into the project.',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Absolute local path, or an http(s) URL.' },
              kind: { type: 'string', enum: ['image', 'audio'], description: 'Decides the destination directory.' },
              scene_id: { type: 'string', description: 'The script section this asset belongs to. The file name is generated from it — you do not choose one.' },
            },
            required: ['source', 'kind', 'scene_id'],
          },
        },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        return text(renderProjectResult(value as Record<string, unknown>))
      },
    },
    timeoutMs: 120_000,
    async execute(args, exec) {
      const action = requireString(args, 'action')
      const machine = runtime.machine
      const config = runtime.getConfig()

      if (action === 'list') {
        const projects = await machine.listProjects()
        return { action, projects }
      }

      if (action === 'bindings') {
        return { action, bindings: config.bindings }
      }

      if (action === 'style') {
        const projectId = optionalString(args, 'project')
        const marker = projectId === undefined ? undefined : (await machine.requireProject(projectId)).marker
        const wanted = optionalString(args, 'style') ?? marker?.style ?? config.defaultStyle
        const { playbook, resolved, fallback } = resolvePlaybook(wanted, config.playbooks)
        return {
          action,
          styles: listPlaybooks(config.playbooks),
          current: resolved,
          requested: wanted,
          fallback,
          playbook,
          visual_contract: renderVisualContract(playbook),
        }
      }

      if (action === 'init') {
        const title = requireString(args, 'title')
        const duration = typeof args.target_duration_seconds === 'number'
          ? args.target_duration_seconds
          : config.defaultDurationSeconds
        const created = await machine.initProject({
          title,
          targetDurationSeconds: duration,
          ...(optionalString(args, 'id') !== undefined ? { id: optionalString(args, 'id')! } : {}),
          style: optionalString(args, 'style') ?? config.defaultStyle,
          ...(optionalString(args, 'voice') !== undefined ? { voice: optionalString(args, 'voice')! } : {}),
        })
        const { playbook, resolved } = resolvePlaybook(created.marker.style, config.playbooks)
        return {
          action,
          project: created.marker,
          existed: created.existed,
          paths: pathsOf(created.layout),
          next_stage: 'brief',
          bindings: config.bindings,
          style: resolved,
          playbook,
          visual_contract: renderVisualContract(playbook),
        }
      }

      const projectId = requireString(args, 'project')

      if (action === 'set_voice') {
        // Also the way a voice-design suggestion reaches the panel: the panel
        // has no inbox, so a proposal is written onto the project and picked up
        // on its next poll.
        const voice = optionalString(args, 'voice')
        const designName = optionalString(args, 'voice_design_name')
        const designPrompt = optionalString(args, 'voice_design_prompt')
        if (voice === undefined && designName === undefined && designPrompt === undefined) {
          throw new StateViolationError(
            'BAD_REQUEST',
            "set_voice needs 'voice', or a 'voice_design_name'/'voice_design_prompt' proposal",
          )
        }
        const marker = await machine.updateProject(projectId, {
          ...(voice === undefined ? {} : { voice }),
          ...(designName === undefined ? {} : { voiceDesignName: designName }),
          ...(designPrompt === undefined ? {} : { voiceDesignPrompt: designPrompt }),
        })
        return { action, project: marker }
      }

      if (action === 'status') {
        const status = await machine.status(projectId)
        // What the stage in front of you will be judged on. Handed over with
        // the status rather than left in a skill, because the moment it is
        // useful is the moment you are about to work on that stage.
        const { pipeline } = resolvePipeline(status.project.pipeline)
        const ahead = status.next_stage ?? status.awaiting_approval
        const focus = pipeline.stages.find((entry) => entry.id === ahead)?.review_focus
        return {
          action,
          ...status,
          ...(focus === undefined ? {} : { review_focus: { stage: ahead, items: focus } }),
          paths: pathsOf(machine.layout(projectId)),
        }
      }

      if (action === 'get') {
        const artifact = requireString(args, 'artifact') as ArtifactName
        const { layout } = await machine.requireProject(projectId)
        const value = await machine.readArtifact<unknown>(layout, artifact)
        if (value === undefined) {
          throw new StateViolationError('BAD_REQUEST', 'project ' + projectId + ' has no ' + artifact + ' artifact yet')
        }
        return { action, artifact, value }
      }

      if (action === 'import') {
        const items = args.items
        if (!Array.isArray(items) || items.length === 0) {
          throw new StateViolationError('BAD_REQUEST', 'import needs a non-empty items array')
        }
        const { layout } = await machine.requireProject(projectId)
const parsed: ImportRequest[] = items.map((item, index) => {
          if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            throw new StateViolationError('BAD_REQUEST', 'items[' + index + '] must be an object')
          }
          const record = item as Record<string, unknown>
          const kind = requireString(record, 'kind')
          if (!(IMPORT_KINDS as readonly string[]).includes(kind)) {
            throw new StateViolationError('BAD_REQUEST', 'items[' + index + '].kind must be one of ' + IMPORT_KINDS.join(' | '))
          }
          return {
            source: requireString(record, 'source'),
            kind: kind as ImportKind,
            sceneId: requireString(record, 'scene_id'),
          }
        })
        const script = await machine.readArtifact<Script>(layout, 'script')
        if (script === undefined) {
          throw new StateViolationError(
            'PREREQUISITE_VIOLATION',
            'cannot import assets before the script exists — asset file names are generated from the section order.',
          )
        }
        const order = new Map(script.sections.map((section, index) => [section.id, index + 1]))
        const imported = await importAssets(layout, order, parsed, exec.signal)
          .catch((error) => {
            // Asset failures are argument problems from the model's side.
            if (error instanceof AssetError) throw new StateViolationError('BAD_REQUEST', error.message)
            throw error
          })
        return { action, imported, paths: pathsOf(layout) }
      }

      throw new StateViolationError('BAD_REQUEST', 'unknown action ' + JSON.stringify(action))
    },
  }
}

function renderProjectResult(value: Record<string, unknown>): string {
  const action = value.action as string
  if (action === 'list') {
    const projects = value.projects as Array<{ id: string; title: string; created_at: string }>
    if (projects.length === 0) return 'No studio projects yet.'
    return ['Projects:', ...projects.map((p) => '- ' + p.id + '  ' + p.title + '  (' + p.created_at.slice(0, 10) + ')')].join('\n')
  }

  if (action === 'bindings') {
    return renderBindings(value.bindings as Config['bindings'])
  }

  if (action === 'style') {
    const styles = value.styles as Array<{ id: string; name: string; mood: string; best_for: string; source: string }>
    const playbook = value.playbook as Playbook
    const lines: string[] = []
    if (value.fallback === true) {
      lines.push('Style "' + value.requested + '" is not defined — falling back to "' + value.current + '".', '')
    }
    lines.push('Styles:')
    for (const style of styles) {
      const mark = style.id === value.current ? ' *' : '  '
      lines.push(mark + ' ' + style.id.padEnd(14) + style.name + '  — ' + style.mood + '（' + style.best_for + '）')
    }
    lines.push(
      '',
      'Active: ' + value.current + '  「' + playbook.name + '」',
      '',
      renderVisualContract(playbook),
      '',
      '旁白：' + playbook.narration.voice_style,
      '语速估算：' + playbook.narration.chars_per_second + ' 字/秒'
        + '　单段 ' + playbook.pacing.minSectionSeconds + '–' + playbook.pacing.maxSectionSeconds + ' 秒',
      '',
      '质量红线：',
      ...playbook.quality_rules.map((rule) => '- ' + rule),
    )
    return lines.join('\n')
  }

  if (action === 'set_voice') {
    const project = value.project as {
      id: string; voice: string; voice_design_name?: string; voice_design_prompt?: string
    }
    const lines: string[] = []
    if (project.voice !== '') lines.push('Project ' + project.id + ' will be narrated by "' + project.voice + '".')
    if (project.voice_design_name !== undefined && project.voice_design_name !== '') {
      lines.push('Voice-design proposal saved for the panel: "' + project.voice_design_name + '"'
        + (project.voice_design_prompt === undefined ? '' : ' — ' + project.voice_design_prompt))
    }
    return lines.join('\n')
  }

  if (action === 'init') {
    const project = value.project as { id: string; title: string; target_duration_seconds: number; voice: string }
    const paths = value.paths as Record<string, string>
    const lines = [
      (value.existed === true ? 'Project already exists: ' : 'Created project: ') + project.id + '  "' + project.title + '"',
      'Target duration: ' + project.target_duration_seconds + 's',
      'Write images to: ' + paths.images,
      'Write audio to:  ' + paths.audio,
      '',
      'Style: ' + value.style + '  「' + (value.playbook as Playbook).name + '」'
        + "  — read the full contract with action 'style' before writing image prompts.",
      voiceLine(project.voice),
      '',
      'Next stage: brief (approval gate).',
      '',
      renderBindings(value.bindings as Config['bindings']),
    ]
    return lines.join('\n')
  }

  if (action === 'status') {
    const project = value.project as { id: string; title: string; voice: string; style: string }
    const stages = value.stages as Array<{ stage: string; status: string; gated: boolean; human_approved: boolean; timestamp?: string }>
    const lines = [
      'Project ' + project.id + '  "' + project.title + '"',
      'Style: ' + project.style,
      voiceLine(project.voice),
      '',
    ]
    for (const stage of stages) {
      const marks: string[] = []
      if (stage.gated) marks.push(stage.human_approved ? 'approved' : 'gate')
      const suffix = marks.length > 0 ? '  [' + marks.join(', ') + ']' : ''
      lines.push('  ' + stage.stage.padEnd(9) + stage.status.padEnd(15) + suffix)
    }
    lines.push('')
    if (value.awaiting_approval !== null && value.awaiting_approval !== undefined) {
      lines.push('PARKED AT A GATE: ' + value.awaiting_approval + ' is waiting for the user to approve. Do not advance it yourself.')
    } else if (value.next_stage === null) {
      lines.push('All stages completed.')
    } else {
      lines.push('Next stage: ' + value.next_stage)
    }
    const paths = value.paths as Record<string, string>
    lines.push('Project directory: ' + paths.project)
    const focus = value.review_focus as { stage: string; items: string[] } | undefined
    if (focus !== undefined) {
      // In front of the model before the work, not after: a review focus
      // read afterwards is a post-mortem, read beforehand it is a brief.
      lines.push('')
      lines.push('自审重点（' + focus.stage + '）—— 提交前对着过一遍，'
        + 'schema / 资产 / 覆盖 / 闸 插件已经管了，这些是它管不到的：')
      for (const item of focus.items) lines.push('  - ' + item)
    }
    return lines.join('\n')
  }

  if (action === 'get') {
    return value.artifact + ':\n' + JSON.stringify(value.value, null, 2)
  }

  if (action === 'import') {
    const imported = value.imported as Array<{ path: string; bytes: number; kind: string; scene_id: string }>
    const lines = ['Imported ' + imported.length + ' file(s). Use these paths verbatim in the asset manifest:']
    for (const item of imported) {
      lines.push('  ' + item.scene_id.padEnd(10) + item.path + '   (' + Math.round(item.bytes / 1024) + ' KB)')
    }
    return lines.join('\n')
  }

  return JSON.stringify(value, null, 2)
}

function voiceLine(voice: string): string {
  if (voice.trim() !== '') return 'Narration voice: "' + voice + '"'
  return 'Narration voice: NOT SET — before generating any narration, ask the user which voice to use '
    + '(offer the options from the TTS workflow\'s voice parameter, or ask them to design a 解说 voice in the ComfyUI panel first), '
    + 'then record it with studio_project action="set_voice".'
}

function renderBindings(bindings: Config['bindings']): string {
  const lines = ['ComfyUI bindings — run these through comfyui_workflow:']
  for (const [capability, binding] of Object.entries(bindings)) {
    const all = bindingWorkflows(binding)
    if (all.length === 0) {
      lines.push(
        '  ' + capability + ': NOT BOUND — ask the user to add a workflow name from '
        + '`comfyui_workflow action: list` in Settings; do not guess one',
      )
      continue
    }
    lines.push('  ' + capability + ': "' + all[0] + '"'
      + (all.length > 1 ? '  (alternatives: ' + all.slice(1).map((n) => '"' + n + '"').join(', ') + ')' : ''))
    if (binding.notes.trim() !== '') lines.push('    note: ' + binding.notes.trim())
  }
  lines.push('Call `comfyui_workflow action: list` for each one\'s parameters, defaults and options — that listing is authoritative, not this table.')
  return lines.join('\n')
}

/* ----------------------------------------------------------- studio_stage */

function stageDefinition(runtime: StudioRuntime): ToolDefinition {
  return {
    name: 'studio_stage',
    description:
      'Record a pipeline stage and advance the project. This is the ONLY way state moves, and every write is checked: '
      + 'the artifact must match its schema, every earlier stage must be completed (and approved where gated), '
      + 'asset paths must exist on disk, and gated stages cannot be completed without human_approved=true. '
      + 'A failed check raises — it does not warn and write anyway. '
      + "Approval-gate protocol for `brief` and `script`: write status='awaiting_human' with the artifact, summarise it for the user in prose, END YOUR TURN, "
      + "and only after they actually approve write it again with status='completed' and human_approved=true. "
      + 'Rewriting an earlier stage discards every later stage, which then has to be redone.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id.' },
        stage: { type: 'string', enum: [...STAGES], description: 'Which stage this write is for.' },
        status: {
          type: 'string',
          enum: ['in_progress', 'awaiting_human', 'completed', 'failed'],
          description: "in_progress records partial work; awaiting_human parks at a gate; completed advances; failed records a dead end.",
        },
        artifacts: {
          type: 'object',
          description:
            "Artifact name -> value, e.g. {\"script\": {...}}. The stage's own artifact "
            + '(brief -> brief, script -> script, assets_audio -> asset_manifest_audio, '
            + 'assets_shots -> asset_manifest_shots, compose -> render_report) '
            + 'is required for awaiting_human and completed.',
        },
        human_approved: {
          type: 'boolean',
          description: 'True only when the user has actually approved this artifact in conversation. Never set it pre-emptively.',
        },
        review: { type: 'object', description: 'Optional review notes recorded alongside the checkpoint.' },
        metadata: { type: 'object', description: 'Optional free-form metadata.' },
        note: { type: 'string', description: 'Optional one-line note about this write.' },
      },
      required: ['project', 'stage', 'status'],
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        const data = value as {
          variation?: {
            score: number
            verdict: string
            violations: Array<{ message: string }>
            suggestions: string[]
          }
          stage: Stage
          status: string
          human_approved: boolean
          gated: boolean
          invalidated: string[]
          notices: string[]
          next_stage: string | null
        }
        const lines = ['Stage "' + data.stage + '" recorded as ' + data.status + '.']
        if (data.gated) {
          lines.push(data.human_approved ? 'Gate satisfied: the user approved this artifact.' : 'This stage is an approval gate.')
        }
        if (data.invalidated.length > 0) {
          lines.push('Discarded later stage(s): ' + data.invalidated.join(', ') + ' — they must be redone.')
        }
        for (const notice of data.notices) lines.push('note: ' + notice)
        if (data.status === 'awaiting_human') {
          lines.push('')
          lines.push('STOP HERE. Summarise the artifact for the user in prose and end your turn. Do not start the next stage.')
        } else if (data.next_stage === null) {
          lines.push('')
          lines.push('Pipeline complete.')
        } else {
          lines.push('')
          lines.push('Next stage: ' + data.next_stage)
        }
        if (data.variation !== undefined && data.variation.violations.length > 0) {
          lines.push('')
          lines.push('分镜重复度 ' + data.variation.score + '/5（' + data.variation.verdict + '）——'
            + '生成之前改掉这些，比生成完重跑便宜：')
          for (const issue of data.variation.violations) lines.push('  - ' + issue.message)
          for (const tip of data.variation.suggestions) lines.push('  · ' + tip)
        }
        return text(lines.join('\n'))
      },
    },
    timeoutMs: 120_000,
    async execute(args) {
      const projectId = requireString(args, 'project')
      const stageRaw = requireString(args, 'stage')
      const statusRaw = requireString(args, 'status')
      if (!isStage(stageRaw)) {
        throw new StateViolationError('BAD_REQUEST', 'stage must be one of ' + STAGES.join(', ') + ', got ' + JSON.stringify(stageRaw))
      }
      if (!isStatus(statusRaw)) {
        throw new StateViolationError('BAD_REQUEST', 'status must be in_progress | awaiting_human | completed | failed')
      }
      // Passed straight through, not copied. The harness deep-freezes tool-call
      // arguments, and the state machine treats every artifact it is handed as
      // read-only — normalisation (ffprobe durations replacing declared ones)
      // builds a new object rather than writing through this one. A defensive
      // clone here would work too, but it would also hide a regression in that
      // contract from every caller that does not go through a tool.
      const artifacts = optionalRecord(args, 'artifacts') ?? {}
      const humanApproved = args.human_approved === true

      const result = await runtime.machine.write({
        projectId,
        stage: stageRaw,
        status: statusRaw,
        artifacts,
        humanApproved,
        ...(optionalRecord(args, 'review') !== undefined ? { review: optionalRecord(args, 'review')! } : {}),
        ...(optionalRecord(args, 'metadata') !== undefined ? { metadata: optionalRecord(args, 'metadata')! } : {}),
        ...(optionalString(args, 'note') !== undefined ? { note: optionalString(args, 'note')! } : {}),
      })

      const status = await runtime.machine.status(projectId)

      // Writing a scene plan gets its variation report back with it.
      //
      // The panel reads this off /studio/state, but the model has no way to
      // call an HTTP route — so without this the check simply did not exist
      // for the model, and it would first learn of a repetitive plan when
      // compose refused, after every picture had been paid for. Returning it
      // here needs no new tool and no polling: you have just written the plan,
      // and this is what is repetitive about it.
      let variation
      if (artifacts.scene_plan !== undefined) {
        const { layout } = await runtime.machine.requireProject(projectId)
        const script = await runtime.machine.readArtifact<Script>(layout, 'script')
        const subjects = new Map<string, string>()
        for (const section of script?.sections ?? []) {
          const prompt = section.visual?.prompt
          if (prompt !== undefined && prompt.trim() !== '') subjects.set(section.id, prompt.trim())
        }
        variation = checkSceneVariation((artifacts.scene_plan as ScenePlan).shots, subjects)
      }

      return {
        stage: stageRaw,
        status: statusRaw,
        gated: GATED_STAGES.has(stageRaw),
        human_approved: result.checkpoint.human_approved,
        artifact: STAGE_ARTIFACT[stageRaw],
        invalidated: result.invalidated,
        notices: result.notices,
        next_stage: status.next_stage,
        awaiting_approval: status.awaiting_approval,
        ...(variation === undefined ? {} : { variation }),
      }
    },
  }
}

/* --------------------------------------------------------- studio_compose */

function composeDefinition(runtime: StudioRuntime): ToolDefinition {
  return {
    name: 'studio_compose',
    description:
      'Render the finished video with FFmpeg from the approved script and the recorded asset manifest. '
      + 'Measures every narration clip with ffprobe first, lays the timeline out from those measurements '
      + '(the script timings are treated as intent), writes an SRT from the real timing, and returns a render_report. '
      + 'It does NOT advance the pipeline: pass the returned report to studio_stage with stage="compose" to record it. '
      + 'Requires the assets stage to be completed.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id.' },
        force: {
          type: 'boolean',
          description:
            'Render even when the slideshow risk score is 4.0 or higher. Only pass this when '
            + 'the USER has seen the score and asked for the render anyway - never on your own judgement.',
        },
      },
      required: ['project'],
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        const data = value as {
          report: { outputs: Array<{ path: string; resolution: string; duration_seconds: number; file_size_bytes?: number }>; render_time_seconds?: number }
          timeline: Array<{ sectionId: string; start: number; duration: number }>
          subtitlePath?: string | null
          warnings: string[]
        }
        const output = data.report.outputs[0]
        const lines: string[] = []
        if (output !== undefined) {
          lines.push(
            'Rendered ' + output.path + '  '
            + output.resolution + '  ' + output.duration_seconds.toFixed(1) + 's  '
            + Math.round((output.file_size_bytes ?? 0) / 1024) + ' KB'
            + (data.report.render_time_seconds !== undefined ? '  (took ' + data.report.render_time_seconds + 's)' : ''),
          )
        }
        if (data.subtitlePath !== undefined && data.subtitlePath !== null) lines.push('Subtitles: ' + data.subtitlePath)
        lines.push('')
        lines.push('Timeline (measured):')
        for (const timing of data.timeline) {
          lines.push('  ' + timing.start.toFixed(2).padStart(7) + 's  ' + timing.duration.toFixed(2).padStart(6) + 's  ' + timing.sectionId)
        }
        for (const warning of data.warnings) lines.push('warning: ' + warning)
        lines.push('')
        lines.push('Now record it: studio_stage stage="compose" status="completed", passing the render_report object above through UNCHANGED - do not rebuild or tidy it.')
        return text(lines.join('\n'))
      },
      presentationMeta(args, value) {
        // Same payload shape as studio_show, so one card renders both: a
        // finished film is worth seeing without asking for it again.
        const data = value as { report: { outputs: Array<{ path: string; duration_seconds: number; file_size_bytes?: number }> } }
        const project = (args as { project?: unknown }).project
        if (typeof project !== 'string') return undefined
        return {
          kind: 'media',
          project,
          items: data.report.outputs.map((output) => ({
            path: output.path,
            name: output.path.split('/').pop() ?? output.path,
            kind: mediaKindOf(output.path),
            bytes: output.file_size_bytes ?? 0,
            url: mediaUrl(project, output.path),
          })),
        }
      },
    },
    timeoutMs: 3_600_000,
    async execute(args, exec) {
      const projectId = requireString(args, 'project')
      const machine = runtime.machine
      const config = runtime.getConfig()
      const { layout } = await machine.requireProject(projectId)

      for (const stage of ['assets_audio', 'assets_shots'] as const) {
        const checkpoint = await machine.readCheckpoint(layout, stage)
        if (checkpoint === undefined || checkpoint.status !== 'completed') {
          throw new StateViolationError(
            'PREREQUISITE_VIOLATION',
            "PREREQUISITE VIOLATION: cannot compose; stage '" + stage + "' is "
            + (checkpoint === undefined ? 'never started' : checkpoint.status)
            + '. Generate those assets and record them with studio_stage first.',
          )
        }
      }

      const script = await machine.readArtifact<Script>(layout, 'script')
      const audio = await machine.readArtifact<AssetManifest>(layout, 'asset_manifest_audio')
      const video = await machine.readArtifact<AssetManifest>(layout, 'asset_manifest_shots')
      if (script === undefined) throw new StateViolationError('PREREQUISITE_VIOLATION', 'no script artifact on disk')
      if (audio === undefined) throw new StateViolationError('PREREQUISITE_VIOLATION', 'no asset_manifest_audio artifact on disk')
      if (video === undefined) throw new StateViolationError('PREREQUISITE_VIOLATION', 'no asset_manifest_shots artifact on disk')

      // The composer does not care which stage produced what — it needs one
      // narration and one visual per section — so the two stage manifests are
      // merged back into the single view it reads.
      const manifest: AssetManifest = {
        ...audio,
        assets: [...audio.assets, ...video.assets],
      }

      const { marker } = await machine.requireProject(projectId)
      const { playbook, resolved, fallback } = resolvePlaybook(marker.style, config.playbooks)

      // The frame comes off the brief. A project declared for a vertical
      // platform used to render landscape anyway, because target_platform was
      // validated and then never read again.
      // The marker first: it is what the project screen edits, so it is the
      // one the user can see and change. The brief is the fallback for
      // projects whose platform only ever went through the model.
      // Slideshow risk, scored against the timeline that is about to be cut.
      //
      // The refusal is aimed at the model. A person who has watched the thing
      // and wants it anyway passes force and gets it - governance nobody can
      // overrule is a wall, not governance.
      const scenePlan = await machine.readArtifact<ScenePlan>(layout, 'scene_plan')
      const subjects = new Map<string, string>()
      for (const section of script.sections) {
        const visual = section.visual
        if (visual?.prompt !== undefined && visual.prompt.trim() !== '') {
          subjects.set(section.id, visual.prompt.trim())
        }
      }
      const planned = planSections(script, manifest, playbook)
      const risk = scenePlan === undefined
        ? undefined
        : scoreSlideshowRisk(scenePlan.shots, planned, playbook, subjects)
      if (risk?.blocking === true && args.force !== true) {
        throw new StateViolationError(
          'QUALITY_VIOLATION',
          'QUALITY VIOLATION: 幻灯片风险 ' + risk.average.toFixed(2) + '/5（' + risk.verdict + '），'
          + '这样出片基本就是配了旁白的幻灯片。' + String.fromCharCode(10)
          + Object.entries(risk.dimensions)
            .filter(([, entry]) => entry.score >= 2)
            .map(([name, entry]) => '  - ' + name + ' ' + entry.score + '：' + entry.reason)
            .join(String.fromCharCode(10)) + String.fromCharCode(10)
          + '先回 scene_plan 改：补镜头语言、把重复的画面换掉、标一个高光镜。'
          + '**如果用户看过分数仍然要出**，再带 force: true 重跑。',
        )
      }

      const brief = await machine.readArtifact<Brief>(layout, 'brief')
      const platform = marker.target_platform ?? brief?.target_platform
      const profile = resolveVideoProfile(config.video, platform)

      const result = await renderProject({
        layout,
        script,
        manifest,
        config,
        playbook,
        ...(platform === undefined ? {} : { targetPlatform: platform }),
        signal: exec.signal,
      })
      // Said out loud, always: a frame that silently differs from the settings
      // is the failure this fix exists to prevent, and silence would reproduce
      // it one layer up.
      if (risk !== undefined) {
        result.warnings.push('幻灯片风险 ' + risk.average.toFixed(2) + '/5（' + risk.verdict + '）'
          + (args.force === true && risk.blocking ? '　⚠️ 用户要求强制出片' : ''))
      }
      result.warnings.push(
        profile.source === 'platform'
          ? '画幅按 target_platform=' + platform + ' 出片：' + profile.label
          : '画幅用设置里的默认值：' + profile.width + 'x' + profile.height,
      )
      if (fallback) {
        result.warnings.push(
          'project style "' + marker.style + '" is not defined; rendered with "' + resolved + '" instead',
        )
      }

      return {
        project: projectId,
        report: result.report,
        timeline: result.timeline.map((timing) => ({
          sectionId: timing.sectionId,
          label: timing.label,
          start: Number(timing.start.toFixed(3)),
          duration: Number(timing.duration.toFixed(3)),
        })),
        subtitlePath: result.subtitlePath ?? null,
        warnings: result.warnings,
      }
    },
  }
}

/* ----------------------------------------------------------- studio_show */

function showDefinition(runtime: StudioRuntime): ToolDefinition {
  return {
    name: 'studio_show',
    description:
      'Put project media into the conversation so the user can look at it without leaving the chat: '
      + 'a rendered film, a take, a shot, anything already inside the project. '
      + 'Paths are project-relative, exactly as they appear in an asset manifest or a render report. '
      + 'It shows what exists — it never generates, imports or records anything.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id.' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Project-relative paths, e.g. "output/film.mp4" or "assets/audio/01-s1.wav".',
        },
        note: { type: 'string', description: 'Optional one line shown above the media.' },
      },
      required: ['project', 'paths'],
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        const data = value as { items: Array<{ name: string; kind: string; bytes: number }>; note?: string }
        const lines = data.note === undefined ? [] : [data.note]
        for (const item of data.items) {
          lines.push('  ' + item.name + '  ' + item.kind + '  ' + Math.round(item.bytes / 1024) + ' KB')
        }
        // The card renders the media itself; this text is what a headless host
        // or a transcript is left with.
        return text(lines.join('\n'))
      },
      presentationMeta(_args, value) {
        // The card draws from this; the text above is what a transcript keeps.
        const data = value as { project: string; items: unknown[]; note?: string }
        return {
          kind: 'media',
          project: data.project,
          items: data.items,
          ...(data.note === undefined ? {} : { note: data.note }),
        }
      },
    },
    timeoutMs: 30_000,
    async execute(args) {
      const projectId = requireString(args, 'project')
      const paths = args.paths
      if (!Array.isArray(paths) || paths.length === 0) {
        throw new StateViolationError('BAD_REQUEST', 'paths must be a non-empty array')
      }
      const { layout } = await runtime.machine.requireProject(projectId)
      const items = []
      for (const entry of paths) {
        if (typeof entry !== 'string' || entry.trim() === '') continue
        const relative = entry.trim()
        // Same guard as every other path from outside: absolute paths and `..`
        // never reach the filesystem.
        const absolute = resolveInProject(layout, relative)
        if (!(await pathExists(absolute))) {
          throw new StateViolationError('BAD_REQUEST', 'no such file in the project: ' + relative)
        }
        const stat = await fs.stat(absolute)
        items.push({
          path: relative,
          name: relative.split('/').pop() ?? relative,
          kind: mediaKindOf(relative),
          bytes: stat.size,
          url: mediaUrl(projectId, relative),
        })
      }
      if (items.length === 0) {
        throw new StateViolationError('BAD_REQUEST', 'none of the given paths named a file')
      }
      return {
        project: projectId,
        items,
        ...(optionalString(args, 'note') === undefined ? {} : { note: optionalString(args, 'note') }),
      }
    },
  }
}

/* ------------------------------------------------------------- registration */

export function registerStudioTools(ctx: unknown, runtime: StudioRuntime): Array<() => void> {
  const tools = (ctx as { tools: { register(definition: ToolDefinition): () => void } }).tools
  return [
    tools.register(projectDefinition(runtime)),
    tools.register(stageDefinition(runtime)),
    tools.register(composeDefinition(runtime)),
    tools.register(showDefinition(runtime)),
  ]
}

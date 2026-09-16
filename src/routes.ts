/**
 * Browser-facing HTTP routes — the data plane behind the two panels.
 *
 *   GET  /openreel/catalog              pipelines and styles the panels offer
 *   GET  /openreel/state?project=<id>   everything OpenReel 创意台 renders
 *   GET  /openreel/media?project&path   preview and download, Range-aware
 *   GET  /openreel/library              创意台看板's project → category → file tree
 *   POST /openreel/project              rename / retime / restyle a project
 *   POST /openreel/project/remove       move a project into .trash
 *   GET  /openreel/trash                what is in the trash
 *   POST /openreel/trash/restore        put one back
 *   POST /openreel/trash/purge          delete one for real
 *   POST /openreel/import               pull generated media into the project
 *   POST /openreel/asset/trim           cut an asset's head and tail with ffmpeg
 *   POST /openreel/asset/restore        put a trimmed asset back the way it was
 *   POST /openreel/validate             check an artifact without writing it
 *   GET  /openreel/cuts?project=        edit versions of the finished film
 *   POST /openreel/cuts                 save one
 *   POST /openreel/cuts/delete          drop one
 *   POST /openreel/stage                a panel's submit button
 *
 * Three of the four are reads. The one write goes through `StateMachine.write()`
 * — the same function `openreel_stage` calls — and that is the whole point: the
 * panel is allowed to advance the pipeline, but not to reach past the schema,
 * asset, gate and prerequisite checks while doing it. A route that wrote
 * `checkpoints/*.json` directly would be quicker and would quietly delete the
 * governance this plugin exists to provide.
 *
 * Every path from the client is resolved with `resolveInProject`, so `..` and
 * absolute paths are rejected before they reach the filesystem.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

import {
  type ArtifactName, type AssetManifest, type ScenePlan, type SceneShot, type Script,
  PLATFORMS, formatIssues, validateArtifact,
} from './schema.js'
import { ProjectError, type ProjectLayout, resolveInProject, toProjectRelative } from './project.js'
import { listPlaybooks, resolvePlaybook } from './playbooks.js'
import { buildScenePrompts } from './prompt.js'
import { checkSceneVariation } from './variation.js'
import { scoreSlideshowRisk } from './slideshow.js'
import {
  AssetError, IMPORT_KINDS, type ImportKind, type ImportRequest,
  importAssets, listTrimmedAudio, musicPatchOf, restoreAudioAsset, trimAudioAsset,
} from './assets.js'
import { MIX_BOUNDS } from './audio-mix.js'
import { CONTENT_LANGUAGE_IDS, resolveContentLanguage } from './content-language.js'
import { resolveVideoProfile } from './media-profile.js'
import { listPipelines, resolvePipeline } from './pipelines.js'
import { planSections } from './compose.js'
import { type ComposeResultPayload, composeProject } from './render-job.js'
import { CutError, type Cut, deleteCut, listCuts, parseCut, readCut, writeCut } from './cuts.js'
import { STAGES, STAGE_ARTIFACT, StateViolationError, isStage, isStatus } from './state.js'
import type { PluginRuntime } from './tools.js'
import {
  errorMessage,
  mediaKindOf,
  mediaUrl,
  query,
  readJsonBody,
  sameOrigin,
  sendFile,
  sendJson,
} from './http.js'

interface WebServer {
  register(route: {
    kind: string
    path: string
    handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>
  }): () => void
}

/** Map a StateViolationError's code onto the status a browser should see. */
function statusForViolation(code: string): number {
  if (code === 'NO_PROJECT') return 404
  if (code === 'BAD_REQUEST' || code === 'SCHEMA_INVALID') return 400
  // Gate, prerequisite, missing asset, coverage and quality failures are all
  // "the request was understood but the pipeline refuses it".
  return 409
}

function fail(response: ServerResponse, error: unknown): void {
  // A rejected path is a bad request, not a server fault — the client asked
  // for something outside the project and was told no.
  if (error instanceof AssetError) {
    sendJson(response, 400, { error: error.message, code: 'ASSET_ERROR' })
    return
  }
  if (error instanceof CutError) {
    sendJson(response, 400, { error: error.message, code: 'BAD_CUT' })
    return
  }
  if (error instanceof ProjectError) {
    sendJson(response, 400, { error: error.message, code: 'BAD_PATH' })
    return
  }
  if (error instanceof StateViolationError) {
    sendJson(response, statusForViolation(error.code), { error: error.message, code: error.code })
    return
  }
  sendJson(response, 500, { error: errorMessage(error) })
}

/* ------------------------------------------------------------------- state */

const ARTIFACTS: readonly ArtifactName[] = [
  'brief', 'script', 'scene_plan', 'asset_manifest_audio', 'asset_manifest_shots', 'render_report',
]

/* -------------------------------------------------------------- scene plan */

/**
 * The scene plan as the shots screen has always read it: section id -> entries.
 *
 * A lossy projection on purpose. The screen wants a count and a couple of
 * fields per shot; the artifact carries more than that. Widening this view is
 * how shot language reaches the UI later, and until then the extra fields ride
 * along on disk untouched — which is exactly what `mergeSectionShots` below is
 * for.
 */
function shotPlanView(plan: ScenePlan): Record<string, Array<{ prompt?: string; weight?: number }>> {
  const view: Record<string, Array<{ prompt?: string; weight?: number }>> = {}
  const ordered = [...plan.shots].sort((a, b) => a.shot_index - b.shot_index)
  for (const shot of ordered) {
    const list = view[shot.section_id] ?? []
    list.push({
      ...(shot.prompt === undefined ? {} : { prompt: shot.prompt }),
      ...(shot.weight === undefined ? {} : { weight: shot.weight }),
    })
    view[shot.section_id] = list
  }
  return view
}

/** Lift a pre-artifact plan off the marker, so nothing is lost on first write. */
function fromMarkerPlan(
  marker: Record<string, Array<{ prompt?: string; weight?: number }>>,
): ScenePlan {
  const shots: SceneShot[] = []
  for (const [sectionId, entries] of Object.entries(marker)) {
    entries.forEach((entry, index) => {
      shots.push({
        id: sectionId + '-' + index,
        section_id: sectionId,
        shot_index: index,
        ...(entry.prompt === undefined || entry.prompt.trim() === '' ? {} : { prompt: entry.prompt }),
        ...(entry.weight === undefined ? {} : { weight: entry.weight }),
      })
    })
  }
  return { version: '1.0', shots }
}

/**
 * The plan to reason from when nobody has written one down.
 *
 * Five-layer prompts, the variation report and the slideshow score all read a
 * scene plan. Requiring one to be SAVED first meant that on a normal run —
 * where the script names a visual per section and nobody opens the shot editor
 * — none of the three engaged at all, and the generation request fell back to
 * bare prompts. The plan is derivable: the timeline already says how many
 * pictures each section gets, and the script already says what each is of.
 *
 * Derived, never written. A stored plan always wins, and this exists so the
 * absence of one does not silently switch off three checks. The prompt
 * fallback rule mirrors the panel's own — the section's visual seeds its FIRST
 * shot only, because that is the one the script's single idea belongs to.
 */
function derivedScenePlan(
  timeline: ReadonlyArray<{ sectionId: string; shots: ReadonlyArray<{ index: number }> }>,
  markerPlan: Record<string, Array<{ prompt?: string; weight?: number }>> | undefined,
  subjects: ReadonlyMap<string, string>,
): ScenePlan {
  const shots: SceneShot[] = []
  for (const timing of timeline) {
    const planned = markerPlan?.[timing.sectionId]
    const count = Math.max(planned?.length ?? 0, timing.shots.length, 1)
    for (let index = 0; index < count; index += 1) {
      const entry = planned?.[index]
      const prompt = entry?.prompt ?? (index === 0 ? subjects.get(timing.sectionId) : undefined)
      shots.push({
        id: timing.sectionId + '-' + index,
        section_id: timing.sectionId,
        shot_index: index,
        ...(prompt === undefined || prompt.trim() === '' ? {} : { prompt: prompt.trim() }),
        ...(entry?.weight === undefined ? {} : { weight: entry.weight }),
      })
    }
  }
  return { version: '1.0', shots }
}

/**
 * Replace one section's shots, keeping whatever the caller did not mention.
 *
 * The incoming list is authoritative for how many shots there are and what
 * order they come in. It is NOT authoritative for fields it omits: a panel that
 * only knows about prompts must not silently strip the lens choice off a shot
 * because it had no box to show it in. Surviving shots are matched by position,
 * which is what "the third picture in this section" means to everyone looking
 * at the screen.
 */
function mergeSectionShots(
  existing: ScenePlan | undefined,
  sectionId: string,
  incoming: ReadonlyArray<Record<string, unknown>>,
): ScenePlan {
  const others = (existing?.shots ?? []).filter((shot) => shot.section_id !== sectionId)
  const previous = (existing?.shots ?? [])
    .filter((shot) => shot.section_id === sectionId)
    .sort((a, b) => a.shot_index - b.shot_index)

  const shots: SceneShot[] = incoming.map((entry, index) => {
    const kept = previous[index]
    const merged: SceneShot = {
      ...(kept ?? {}),
      id: typeof entry.id === 'string' && entry.id.trim() !== ''
        ? entry.id.trim()
        : kept?.id ?? sectionId + '-' + index,
      section_id: sectionId,
      shot_index: index,
    }
    // `undefined` means "not mentioned" and keeps what is there; an empty
    // string or null is the caller actually clearing the field.
    if ('prompt' in entry) {
      const prompt = typeof entry.prompt === 'string' ? entry.prompt.trim() : ''
      if (prompt === '') delete merged.prompt
      else merged.prompt = prompt
    }
    if ('weight' in entry) {
      const weight = entry.weight
      if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) merged.weight = weight
      else delete merged.weight
    }
    // Every optional field of SceneShot beyond prompt and weight. A field
    // missing from this list is silently dropped on save: the panel sends it,
    // the route ignores it, and the control looks broken with nothing logged.
    // `hero_moment` was exactly that until it was noticed by hand.
    for (const key of ['shot_language', 'texture_keywords', 'reference_names', 'hero_moment'] as const) {
      if (!(key in entry)) continue
      const value = entry[key]
      if (value === null || value === undefined || value === false) delete merged[key]
      else Object.assign(merged, { [key]: value })
    }
    return merged
  })

  return { version: '1.0', shots: [...others, ...shots] }
}

/* ----------------------------------------------------------------- library */

interface LibraryFile {
  name: string
  path: string
  kind: string
  bytes: number
  modified: string
  url: string
  download_url: string
}

/** Walk one directory tree, bounded so a stray symlink cannot run away. */
async function walk(root: string, layout: ProjectLayout, depth = 0): Promise<LibraryFile[]> {
  if (depth > 4) return []
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const files: LibraryFile[] = []
  for (const entry of entries) {
    const absolute = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walk(absolute, layout, depth + 1))
      continue
    }
    if (!entry.isFile()) continue
    const stat = await fs.stat(absolute).catch(() => undefined)
    if (stat === undefined) continue
    const relative = toProjectRelative(layout, absolute)
    files.push({
      name: entry.name,
      path: relative,
      kind: mediaKindOf(entry.name),
      bytes: stat.size,
      modified: stat.mtime.toISOString(),
      url: mediaUrl(layout.id, relative),
      download_url: mediaUrl(layout.id, relative, true),
    })
  }
  return files
}

/**
 * One project's files, grouped the way the board shows them: the generated
 * material by medium, and the finished film on its own.
 *
 * Grouping by detected medium rather than by directory means a pipeline that
 * starts writing clips into `assets/` gets a "video" group without this code
 * changing.
 */
async function libraryEntry(layout: ProjectLayout, title: string, createdAt: string): Promise<unknown> {
  const assets = await walk(layout.assetsDir, layout)
  const outputs = await walk(layout.outputDir, layout)
  const groups: Record<string, LibraryFile[]> = { audio: [], image: [], video: [], other: [] }
  for (const file of assets) (groups[file.kind] ?? groups.other!).push(file)
  for (const list of Object.values(groups)) list.sort((a, b) => a.name.localeCompare(b.name))
  outputs.sort((a, b) => a.name.localeCompare(b.name))

  const categories = [
    { id: 'audio', label: '音频', files: groups.audio! },
    { id: 'image', label: '图片', files: groups.image! },
    { id: 'video', label: '视频', files: groups.video! },
    { id: 'final', label: '成片', files: outputs },
  ].filter((category) => category.files.length > 0)

  const total = [...assets, ...outputs].reduce((sum, file) => sum + file.bytes, 0)
  return { id: layout.id, title, created_at: createdAt, total_bytes: total, categories }
}

/* --------------------------------------------------------------- mounting */

/** One project's render, while it runs and after it stops. */
interface RenderJob {
  state: 'running' | 'done' | 'failed'
  /** The composer's own progress line, shown verbatim on the page. */
  progress: string
  /** 0..1 through the render. See PHASE_SPAN for how honest that is. */
  fraction: number
  phase: string
  /** When the render started, so the page can show how long it has been. */
  startedAt: number
  controller: AbortController
  result?: ComposeResultPayload
  error?: string
  code?: string
}

/** Just the part of the host's skill registry this file asks about. */
interface SkillCatalog {
  list?: (options: Record<string, unknown>) => Promise<Array<{
    name: string
    invocation?: { userInvocable?: boolean }
  }>>
}

export function mountStudioRoutes(ctx: Context, runtime: PluginRuntime): (() => void) | undefined {
  const webServer = ctx.get('webServer') as WebServer | undefined
  if (webServer === undefined) return undefined

  const disposers: Array<() => void> = []
  const { machine } = runtime

  /**
   * In-flight renders, one per project.
   *
   * Held in memory rather than on disk on purpose: a job is a fact about THIS
   * host process, and a stale 'running' entry surviving a restart would leave a
   * project permanently unable to render. Losing the record of a finished
   * render costs nothing — the report is already in the checkpoint.
   */
  const renders = new Map<string, RenderJob>()
  disposers.push(() => {
    // Unloading the plugin mid-encode should stop ffmpeg, not orphan it.
    for (const job of renders.values()) job.controller.abort()
    renders.clear()
  })

  // ---- GET /openreel/skill?name= -------------------------------------------
  //
  // Whether the host's skill registry resolves one name, and whether a `/name`
  // gesture would load it.
  //
  // A panel that opens its request with `/some-skill` is depending on the host
  // to splice that body in before the step. When the name does not resolve the
  // host leaves it as ordinary prose — no error anywhere — and the model
  // proceeds with none of the guidance the request was built around. It still
  // answers, so the failure looks like a bad answer rather than a missing
  // skill. This route is how a panel refuses to send instead.
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/skill',
    handler: async (request, response) => {
      try {
        const name = query(request).get('name') ?? ''
        if (name === '') {
          sendJson(response, 400, { error: 'name is required' })
          return
        }
        const skills = ctx.get('skills') as SkillCatalog | undefined
        if (skills?.list === undefined) {
          // No registry at all is not the same as a missing skill, and saying
          // "unavailable" would send the panel down the wrong explanation.
          sendJson(response, 200, { name, known: false, loadable: false, registry: false })
          return
        }
        const found = (await skills.list({})).find((entry) => entry.name === name)
        sendJson(response, 200, {
          name,
          registry: true,
          known: found !== undefined,
          // The gesture checks exactly this, so this route must too.
          loadable: found?.invocation?.userInvocable === true,
        })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- GET /openreel/state -------------------------------------------------
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/state',
    handler: async (request, response) => {
      try {
        const projectId = query(request).get('project')
        if (projectId === null || projectId === '') {
          sendJson(response, 400, { error: 'project is required' })
          return
        }
        const status = await machine.status(projectId)
        const layout = machine.layout(projectId)
        const config = runtime.getConfig()
        const { playbook, resolved, fallback } = resolvePlaybook(status.project.style, config.playbooks)

        const artifacts: Record<string, unknown> = {}
        for (const name of ARTIFACTS) {
          const value = await machine.readArtifact<unknown>(layout, name)
          // Served verbatim. The panel edits these artifacts and submits them
          // back, so anything added here for display would come back as an
          // unrecognised field — a route that decorates a document it also
          // accepts has made that document impossible to round-trip.
          if (value !== undefined) artifacts[name] = value
        }

        // The planned timeline, so the panel shows real on-screen times rather
        // than reimplementing the pacing rules in the browser.
        const script = artifacts.script as Script | undefined
        const audio = artifacts.asset_manifest_audio as AssetManifest | undefined
        const shots = artifacts.asset_manifest_shots as AssetManifest | undefined
        const cuts = await listCuts(layout)
        const activeCut = cuts.find((entry) => entry.id === (query(request).get('cut') ?? '')) ?? undefined
        const plan = script === undefined
          ? []
          : planSections(script, {
            version: '1.0',
            assets: [...(audio?.assets ?? []), ...(shots?.assets ?? [])],
          }, playbook, activeCut)

        const report = artifacts.render_report as { outputs?: Array<{ path?: unknown }> } | undefined
        const filmPath = typeof report?.outputs?.[0]?.path === 'string' ? report.outputs[0].path : undefined

        const pipeline = resolvePipeline(status.project.pipeline)

        // `project.shot_plan` is now a VIEW, not storage.
        //
        // The plan lives in the scene_plan artifact, where it is schema-checked
        // and can carry shot language. Projects created before that artifact
        // existed still have theirs on the marker, so the marker is the
        // fallback rather than the source. Panels read one shape either way.
        const scenePlan = artifacts.scene_plan as ScenePlan | undefined

        // Built prompts, five layers deep, computed here rather than in the
        // browser: the same function the model is told to rely on, so the
        // panel and the generation request cannot describe different pictures.
        //
        // A separate top-level key, NOT part of `artifacts`. Those are served
        // verbatim because the panel submits them back, and a derived field
        // inside one would come back as an unrecognised member.
        const subjects = new Map<string, string>()
        for (const section of script?.sections ?? []) {
          const visual = section.visual as { prompt?: unknown } | undefined
          if (typeof visual?.prompt === 'string' && visual.prompt.trim() !== '') {
            subjects.set(section.id, visual.prompt.trim())
          }
        }
        // Everything derived below reads the EFFECTIVE plan: the stored one if
        // there is one, otherwise the one the timeline and script already
        // imply. Gating on a saved plan meant a normal run — script written,
        // shot editor never opened — got no five-layer prompts and neither
        // check, which made all three look broken rather than absent.
        const effectivePlan = scenePlan ?? derivedScenePlan(plan, status.project.shot_plan, subjects)

        const prompts = plan.length === 0 ? [] : buildScenePrompts(effectivePlan.shots, playbook, subjects)
        // Advisory, computed on every read so the panel can show it before the
        // generate button rather than after the bill.
        const variation = plan.length === 0 ? null : checkSceneVariation(effectivePlan.shots, subjects)

        // Scored against the timeline the panel is about to draw, so the number
        // on the compose screen is the number compose will refuse on.
        const slideshow = plan.length === 0
          ? null
          : scoreSlideshowRisk(effectivePlan.shots, plan, playbook, subjects)

        // The view follows the effective plan too. Serving it off the stored
        // plan alone dropped every section that plan did not mention — a
        // project whose marker held prompts for three sections lost two of
        // them the moment one section was saved into the artifact.
        const project = plan.length === 0
          ? status.project
          : { ...status.project, shot_plan: shotPlanView(effectivePlan) }

        sendJson(response, 200, {
          project,
          pipeline: { id: pipeline.resolved, fallback: pipeline.fallback, definition: pipeline.pipeline },
          style: { id: resolved, fallback, playbook, options: listPlaybooks(config.playbooks) },
          stages: status.stages.map((stage) => ({ ...stage, artifact_name: STAGE_ARTIFACT[stage.stage] })),
          next_stage: status.next_stage,
          awaiting_approval: status.awaiting_approval,
          artifacts,
          timeline: plan,
          prompts,
          variation,
          slideshow,
          cuts,
          film: filmPath === undefined ? null : { path: filmPath, url: mediaUrl(projectId, filmPath) },
          bindings: config.bindings,
          // The frame, resolved once and served: the platform's baseline times
          // the render scale. The shots screen needs the SAME numbers compose
          // will cut to — a panel that worked them out again in the browser is
          // exactly how a vertical project ended up with 16:9 stills.
          frame: resolveVideoProfile(
            status.project.target_platform
              ?? (typeof (artifacts.brief as { target_platform?: unknown } | undefined)?.target_platform === 'string'
                ? (artifacts.brief as { target_platform: string }).target_platform
                : undefined),
            config.video.renderScale,
            config.video.fps,
          ),
          // Which takes have a pre-trim copy on disk, so the panel can offer
          // undo on exactly those. A separate top-level key rather than a flag
          // inside the manifest, for the same reason `prompts` is one: the
          // manifest is served verbatim and submitted back.
          trimmed: await listTrimmedAudio(layout),
          // What language this film is in: the project's own choice, or the
          // panel's language when it has never made one. Resolved host-side so
          // the screens and the requests they compose cannot disagree.
          contentLanguage: resolveContentLanguage(status.project.language, config.language).id,
        })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- GET /openreel/catalog -----------------------------------------------
  // What the welcome screen offers and what the project screen picks from.
  // Static for now, but a route rather than a constant in the bundle so a
  // custom playbook added to config shows up without rebuilding the client.
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/catalog',
    handler: async (_request, response) => {
      try {
        sendJson(response, 200, {
          pipelines: listPipelines(),
          styles: listPlaybooks(runtime.getConfig().playbooks),
          default_duration_seconds: runtime.getConfig().defaultDurationSeconds,
        })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- POST /openreel/project ----------------------------------------------
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/project',
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'POST only' })
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin writes are refused' })
          return
        }
        const body = await readJsonBody(request)
        if (body === null || typeof body !== 'object') {
          sendJson(response, 400, { error: 'a JSON object body is required' })
          return
        }
        const input = body as Record<string, unknown>
        if (typeof input.project !== 'string' || input.project === '') {
          sendJson(response, 400, { error: 'project is required' })
          return
        }
        const patch: {
          title?: string
          language?: string
          targetDurationSeconds?: number
          style?: string
          voice?: string
          voiceDesignName?: string
          voiceDesignPrompt?: string
          loraName?: string
          loraStrength?: number
          references?: string[]
          voiceReferences?: string[]
          music?: {
            path?: string; workflow?: string; prompt?: string
            gain_db?: number; fade_in?: number; fade_out?: number
          }
          targetPlatform?: string
          shotPlan?: Record<string, Array<{ prompt?: string; weight?: number }>>
        } = {}
        if (typeof input.title === 'string' && input.title.trim() !== '') patch.title = input.title.trim()
        if (typeof input.style === 'string' && input.style.trim() !== '') patch.style = input.style.trim()
        if (typeof input.voice === 'string') patch.voice = input.voice.trim()
        if (typeof input.language === 'string') {
          const language = input.language.trim()
          // Checked rather than trusted: this steers what the model writes, so
          // a value nothing recognises would silently mean "Chinese" and the
          // panel would go on showing the language the user picked.
          if (!CONTENT_LANGUAGE_IDS.includes(language)) {
            sendJson(response, 400, {
              error: 'language must be one of ' + CONTENT_LANGUAGE_IDS.join(', ')
                + ', got ' + JSON.stringify(language),
            })
            return
          }
          patch.language = language
        }
        if (typeof input.voice_design_name === 'string') patch.voiceDesignName = input.voice_design_name.trim()
        if (typeof input.voice_design_prompt === 'string') patch.voiceDesignPrompt = input.voice_design_prompt.trim()
        if (typeof input.lora_name === 'string') patch.loraName = input.lora_name.trim()
        if (typeof input.target_platform === 'string') {
          const platform = input.target_platform.trim()
          // Checked here rather than trusted: the frame is decided from this
          // value, so a typo would render the wrong shape and say nothing.
          if (!(PLATFORMS as readonly string[]).includes(platform)) {
            sendJson(response, 400, {
              error: 'target_platform must be one of ' + PLATFORMS.join(', ') + ', got ' + JSON.stringify(platform),
            })
            return
          }
          patch.targetPlatform = platform
        }
        // shot_plan is deliberately NOT accepted here any more. It lives in the
        // scene_plan artifact, where the schema can see it; leaving a second
        // way to write it would put the same fact in two places, and the
        // marker copy has no validation to keep it honest.
        //
        // The marker field stays readable so projects that predate the
        // artifact still show their plan until their first save lifts it over.
        if (Array.isArray(input.references)) {
          patch.references = input.references
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '')
        }
        if (Array.isArray(input.voice_references)) {
          patch.voiceReferences = input.voice_references
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '')
        }
        if (input.music !== null && typeof input.music === 'object' && !Array.isArray(input.music)) {
          const music = input.music as Record<string, unknown>
          const patchMusic: {
            path?: string; workflow?: string; prompt?: string
            gain_db?: number; fade_in?: number; fade_out?: number
          } = {}
          // Only the keys that were sent. An absent key means "leave it", which
          // is what lets the panel save a workflow name and the agent save a
          // path without either erasing the other.
          if (typeof music.workflow === 'string') patchMusic.workflow = music.workflow.trim()
          if (typeof music.prompt === 'string') patchMusic.prompt = music.prompt.trim()
          if (typeof music.path === 'string') {
            const relative = music.path.trim()
            // Checked here rather than at render time: an absolute path or a
            // `..` segment reaching the marker would be a stored escape route,
            // and compose would report it as a missing file.
            if (relative !== '' && (/^([a-zA-Z]:)?[\\/]/.test(relative) || relative.split(/[\\/]/).includes('..'))) {
              sendJson(response, 400, { error: 'music.path must be relative to the project, got ' + JSON.stringify(relative) })
              return
            }
            patchMusic.path = relative
          }
          // Clamped through the same function the render and the preview use, so
          // an out-of-range value cannot mean one thing on the page and another
          // in the file.
          const bounded = (value: unknown, bound: { min: number; max: number }): number | undefined =>
            typeof value === 'number' && Number.isFinite(value)
              ? Math.min(bound.max, Math.max(bound.min, value))
              : undefined
          const gain = bounded(music.gain_db, MIX_BOUNDS.gainDb)
          if (gain !== undefined) patchMusic.gain_db = gain
          const fadeIn = bounded(music.fade_in, MIX_BOUNDS.fadeInSeconds)
          if (fadeIn !== undefined) patchMusic.fade_in = fadeIn
          const fadeOut = bounded(music.fade_out, MIX_BOUNDS.fadeOutSeconds)
          if (fadeOut !== undefined) patchMusic.fade_out = fadeOut
          if (Object.keys(patchMusic).length > 0) patch.music = patchMusic
        }
        if (typeof input.lora_strength === 'number' && Number.isFinite(input.lora_strength)) {
          patch.loraStrength = Math.min(2, Math.max(0, input.lora_strength))
        }
        if (typeof input.target_duration_seconds === 'number') {
          const seconds = input.target_duration_seconds
          if (!Number.isFinite(seconds) || seconds < 5 || seconds > 1800) {
            sendJson(response, 400, { error: 'target_duration_seconds must be between 5 and 1800' })
            return
          }
          patch.targetDurationSeconds = seconds
        }
        if (Object.keys(patch).length === 0) {
          sendJson(response, 400, { error: 'nothing to update' })
          return
        }
        const marker = await machine.updateProject(input.project, patch)
        sendJson(response, 200, { project: marker })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- POST /openreel/project/remove ---------------------------------------
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/project/remove',
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'POST only' })
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin writes are refused' })
          return
        }
        const body = await readJsonBody(request)
        const input = (body ?? {}) as Record<string, unknown>
        if (typeof input.project !== 'string' || input.project === '') {
          sendJson(response, 400, { error: 'project is required' })
          return
        }
        const { trashedTo } = await machine.removeProject(input.project)
        sendJson(response, 200, { removed: input.project, trashed_to: trashedTo })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- GET /openreel/trash -------------------------------------------------
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/trash',
    handler: async (_request, response) => {
      try {
        sendJson(response, 200, { entries: await machine.listTrash() })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- POST /openreel/trash/restore & /openreel/trash/purge -------------------
  for (const [path, run] of [
    ['/openreel/trash/restore', (entry: string) => machine.restoreProject(entry)],
    ['/openreel/trash/purge', (entry: string) => machine.purgeProject(entry)],
  ] as const) {
    disposers.push(webServer.register({
      kind: 'exact',
      path,
      handler: async (request, response) => {
        try {
          if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'POST only' })
            return
          }
          if (!sameOrigin(request)) {
            sendJson(response, 403, { error: 'cross-origin writes are refused' })
            return
          }
          const body = await readJsonBody(request)
          const input = (body ?? {}) as Record<string, unknown>
          if (typeof input.entry !== 'string' || input.entry === '') {
            sendJson(response, 400, { error: 'entry is required' })
            return
          }
          sendJson(response, 200, await run(input.entry))
        } catch (error) {
          fail(response, error)
        }
      },
    }))
  }

  // ---- POST /openreel/scene-plan -------------------------------------------
  // One section's shots at a time, because that is the unit the screen edits.
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/scene-plan',
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'POST only' })
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin writes are refused' })
          return
        }
        const body = await readJsonBody(request)
        if (body === null || typeof body !== 'object') {
          sendJson(response, 400, { error: 'a JSON object body is required' })
          return
        }
        const input = body as Record<string, unknown>
        const projectId = typeof input.project === 'string' ? input.project : ''
        const sectionId = typeof input.section === 'string' ? input.section.trim() : ''
        if (projectId === '' || sectionId === '') {
          sendJson(response, 400, { error: 'project and section are required' })
          return
        }
        if (!Array.isArray(input.shots)) {
          sendJson(response, 400, { error: 'shots must be an array' })
          return
        }
        const incoming = input.shots.filter(
          (entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object',
        )

        const { layout, marker } = await machine.requireProject(projectId)
        let existing = await machine.readArtifact<ScenePlan>(layout, 'scene_plan')
        // First write on a project that predates the artifact: bring the
        // marker's plan across so the sections nobody is editing survive.
        if (existing === undefined && marker.shot_plan !== undefined) {
          existing = fromMarkerPlan(marker.shot_plan)
        }

        const plan = mergeSectionShots(existing, sectionId, incoming)
        await machine.writePlan(projectId, 'scene_plan', plan)
        sendJson(response, 200, { scene_plan: plan })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- cuts --------------------------------------------------------------
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/cuts',
    handler: async (request, response) => {
      try {
        if (request.method === 'GET') {
          const projectId = query(request).get('project')
          if (projectId === null || projectId === '') {
            sendJson(response, 400, { error: 'project is required' })
            return
          }
          const { layout } = await machine.requireProject(projectId)
          sendJson(response, 200, { cuts: await listCuts(layout) })
          return
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'GET or POST' })
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin writes are refused' })
          return
        }
        const body = await readJsonBody(request)
        if (body === null || typeof body !== 'object') {
          sendJson(response, 400, { error: 'a JSON object body is required' })
          return
        }
        const input = body as Record<string, unknown>
        if (typeof input.project !== 'string' || input.project === '') {
          sendJson(response, 400, { error: 'project is required' })
          return
        }
        const { layout } = await machine.requireProject(input.project)
        const cutInput = (input.cut ?? {}) as Record<string, unknown>
        const id = typeof cutInput.id === 'string' ? cutInput.id.trim() : ''
        // Editing an existing version keeps its creation time and its render,
        // so a saved cut's history is not reset by a tweak.
        const existing = id === '' ? undefined : await readCut(layout, id).catch(() => undefined)
        const saved = await writeCut(layout, parseCut(cutInput, existing))
        sendJson(response, 200, { cut: saved })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/cuts/delete',
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'POST only' })
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin writes are refused' })
          return
        }
        const body = (await readJsonBody(request) ?? {}) as Record<string, unknown>
        if (typeof body.project !== 'string' || typeof body.cut !== 'string') {
          sendJson(response, 400, { error: 'project and cut are required' })
          return
        }
        const { layout } = await machine.requireProject(body.project)
        await deleteCut(layout, body.cut)
        sendJson(response, 200, { deleted: body.cut })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- GET /openreel/media -------------------------------------------------
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/media',
    handler: async (request, response) => {
      try {
        const params = query(request)
        const projectId = params.get('project')
        const path = params.get('path')
        if (projectId === null || path === null) {
          sendJson(response, 400, { error: 'project and path are required' })
          return
        }
        const { layout } = await machine.requireProject(projectId)
        // Rejects absolute paths and any `..` segment before touching disk.
        const absolute = resolveInProject(layout, path)
        await sendFile(request, response, absolute, {
          download: params.get('download') === '1',
          filename: path.split('/').pop() ?? 'file',
        })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- GET /openreel/library ----------------------------------------------
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/library',
    handler: async (request, response) => {
      try {
        const only = query(request).get('project')
        const summaries = await machine.listProjects()
        const wanted = only === null || only === ''
          ? summaries
          : summaries.filter((summary) => summary.id === only)
        const projects = []
        for (const summary of wanted) {
          projects.push(await libraryEntry(machine.layout(summary.id), summary.title, summary.created_at))
        }
        sendJson(response, 200, { projects })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- POST /openreel/import -----------------------------------------------
  // The panel generates through dsh-comfyui's own routes and gets back a media
  // URL; this is how that URL becomes a file inside the project, under the same
  // naming rule the tool uses.
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/import',
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'POST only' })
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin writes are refused' })
          return
        }
        const input = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>
        if (typeof input.project !== 'string' || input.project === '') {
          sendJson(response, 400, { error: 'project is required' })
          return
        }
        const items = input.items
        if (!Array.isArray(items) || items.length === 0) {
          sendJson(response, 400, { error: 'items must be a non-empty array' })
          return
        }
        const { layout } = await machine.requireProject(input.project)
        const script = await machine.readArtifact<{ sections: Array<{ id: string }> }>(layout, 'script')
        if (script === undefined) {
          sendJson(response, 409, {
            error: '还没有脚本，素材文件名按段落顺序生成，先确认脚本再导入。',
            code: 'PREREQUISITE_VIOLATION',
          })
          return
        }
        const parsed: ImportRequest[] = items.map((item) => {
          const record = (item ?? {}) as Record<string, unknown>
          const kind = String(record.kind ?? '')
          if (!(IMPORT_KINDS as readonly string[]).includes(kind)) {
            throw new AssetError('kind must be one of ' + IMPORT_KINDS.join(' | '))
          }
          if (kind === 'music') {
            return { source: String(record.source ?? ''), kind: 'music' as ImportKind }
          }
          return {
            source: String(record.source ?? ''),
            kind: kind as ImportKind,
            sceneId: String(record.scene_id ?? ''),
          }
        })
        const order = new Map(script.sections.map((section, index) => [section.id, index + 1]))
        const imported = await importAssets(layout, order, parsed, AbortSignal.timeout(180_000))
        // Importing the bed and recording it are one gesture -- see `musicPatchOf`.
        const musicPatch = musicPatchOf(imported)
        if (musicPatch !== undefined) await machine.updateProject(input.project, { music: musicPatch })
        sendJson(response, 200, { imported })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- POST /openreel/asset/trim -------------------------------------------
  // The browser picks the in and out points off a waveform; the cut itself is
  // ffmpeg's job, because only the host can write the file.
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/asset/trim',
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'POST only' })
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin writes are refused' })
          return
        }
        const input = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>
        if (typeof input.project !== 'string' || input.project === '') {
          sendJson(response, 400, { error: 'project is required' })
          return
        }
        if (typeof input.path !== 'string' || input.path === '') {
          sendJson(response, 400, { error: 'path is required' })
          return
        }
        const { layout } = await machine.requireProject(input.project)
        const config = runtime.getConfig()
        const result = await trimAudioAsset({
          ffmpegPath: config.ffmpegPath,
          ffprobePath: config.ffprobePath,
          layout,
          relativePath: input.path,
          start: typeof input.start === 'number' ? input.start : 0,
          end: typeof input.end === 'number' ? input.end : undefined,
        })
        // The file is shorter now, so the length the manifest records is
        // simply wrong. Correcting it is what makes the panel's on-screen
        // times and the compose plan agree with what is on disk.
        if (result.seconds !== undefined) {
          await machine.reviseAssetDuration(input.project, result.path, result.seconds)
        }
        sendJson(response, 200, result)
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- POST /openreel/asset/restore ----------------------------------------
  // Undo every trim on one take at once. There is no per-cut history to step
  // back through — a trim rewrites the file — so the only honest undo is "the
  // take as it was generated", which is what `originals/` holds.
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/asset/restore',
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'POST only' })
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin writes are refused' })
          return
        }
        const input = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>
        if (typeof input.project !== 'string' || input.project === '') {
          sendJson(response, 400, { error: 'project is required' })
          return
        }
        if (typeof input.path !== 'string' || input.path === '') {
          sendJson(response, 400, { error: 'path is required' })
          return
        }
        const { layout } = await machine.requireProject(input.project)
        const result = await restoreAudioAsset({
          ffprobePath: runtime.getConfig().ffprobePath,
          layout,
          relativePath: input.path,
        })
        if (result.seconds !== undefined) {
          await machine.reviseAssetDuration(input.project, result.path, result.seconds)
        }
        sendJson(response, 200, result)
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- POST /openreel/validate ---------------------------------------------
  // Schema checking without a write, so an editor can mark problems while the
  // user types. The panel must not re-implement these rules: they live in
  // schema.ts, and a browser copy would drift from the one the gate enforces.
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/validate',
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'POST only' })
          return
        }
        const body = await readJsonBody(request)
        const input = (body ?? {}) as Record<string, unknown>
        const artifact = input.artifact
        if (typeof artifact !== 'string' || !ARTIFACTS.includes(artifact as ArtifactName)) {
          sendJson(response, 400, { error: 'artifact must be one of ' + ARTIFACTS.join(', ') })
          return
        }
        const issues = validateArtifact(artifact as ArtifactName, input.value)
        sendJson(response, 200, {
          artifact,
          valid: issues.length === 0,
          issues,
          text: issues.length === 0 ? '' : formatIssues(issues),
        })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- POST/GET /openreel/compose -------------------------------------------
  //
  // The compose screen renders the film itself rather than asking the agent to.
  // By this point nothing is left to decide: the cut, the pauses, the subtitle
  // style and the music were all settled on the screen, and routing the last
  // step through a model adds a round trip and a chance to mistranscribe them.
  // `openreel_compose` stays for unattended runs, and both go through
  // `composeProject` so the prerequisites and the slideshow refusal cannot hold
  // on one path and be skipped on the other.
  //
  // A render takes minutes, so POST starts one and returns; GET reports where
  // it is. Holding the request open for the whole encode would give the page
  // nothing to show and put the result at the mercy of an idle timeout.
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/compose',
    handler: async (request, response) => {
      try {
        const projectId = request.method === 'GET'
          ? (query(request).get('project') ?? '')
          : undefined

        if (request.method === 'GET') {
          if (projectId === '') {
            sendJson(response, 400, { error: 'project is required' })
            return
          }
          const job = renders.get(projectId as string)
          sendJson(response, 200, job === undefined
            ? { running: false, state: 'idle' }
            : {
                running: job.state === 'running',
                state: job.state,
                progress: job.progress,
                fraction: job.fraction,
                phase: job.phase,
                elapsed_seconds: Number(((Date.now() - job.startedAt) / 1000).toFixed(1)),
                ...(job.result === undefined ? {} : { result: job.result }),
                ...(job.error === undefined ? {} : { error: job.error, code: job.code }),
              })
          return
        }

        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'GET or POST only' })
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin writes are refused' })
          return
        }
        const input = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>
        const project = input.project
        if (typeof project !== 'string' || project === '') {
          sendJson(response, 400, { error: 'project is required' })
          return
        }
        // One render per project at a time. Two concurrent encodes write the
        // same work directory and the same output file, and the loser would
        // corrupt the winner's film rather than merely wasting a CPU.
        const existing = renders.get(project)
        if (existing?.state === 'running') {
          sendJson(response, 409, { error: '这个项目正在合成中', code: 'ALREADY_RENDERING', progress: existing.progress })
          return
        }
        // Fail fast on a project that is not ready, so the button reports it
        // instead of a job that dies a second later with nobody watching.
        await machine.requireProject(project)

        const background = input.subtitle_background
        const controller = new AbortController()
        const job: RenderJob = {
          state: 'running', progress: '准备中', fraction: 0, phase: 'probing',
          startedAt: Date.now(), controller,
        }
        renders.set(project, job)

        // Deliberately not awaited: the response goes out now and the page
        // polls. Every failure path below lands on the job, which is what the
        // page reads -- an unhandled rejection here would be invisible.
        void (async (): Promise<void> => {
          try {
            const result = await composeProject(runtime, {
              projectId: project,
              ...(typeof input.burn_subtitles === 'boolean' ? { burnSubtitles: input.burn_subtitles } : {}),
              ...(background === 'outline' || background === 'box'
                ? { subtitleBackground: background } : {}),
              ...(input.force === true ? { force: true } : {}),
              ...(typeof input.cut === 'string' && input.cut !== '' ? { cutId: input.cut } : {}),
              signal: controller.signal,
              onProgress: (update) => {
                job.progress = update.label
                job.phase = update.phase
                // Never backwards. A bar that retreats reads as a fault even
                // when the estimate behind it genuinely improved.
                job.fraction = Math.max(job.fraction, update.fraction)
              },
            })
            // Recorded through the state machine, the same call openreel_stage
            // makes. The panel may advance the pipeline; it may not reach past
            // the schema and asset checks while doing it, and writing the
            // checkpoint here directly is exactly the shortcut that would.
            job.progress = '记录成片'
            job.phase = 'recording'
            job.fraction = 1
            await machine.write({
              projectId: project,
              stage: 'compose',
              status: 'completed',
              artifacts: { render_report: result.report as unknown as Record<string, unknown> },
              humanApproved: false,
            })
            job.result = result
            job.state = 'done'
            job.progress = '完成'
            job.phase = 'done'
          } catch (error) {
            job.state = 'failed'
            job.error = errorMessage(error)
            job.code = error instanceof StateViolationError ? error.code : 'RENDER_FAILED'
          }
        })()

        sendJson(response, 202, { started: true, project })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  // ---- POST /openreel/stage ------------------------------------------------
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/openreel/stage',
    handler: async (request, response) => {
      try {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'POST only' })
          return
        }
        if (!sameOrigin(request)) {
          sendJson(response, 403, { error: 'cross-origin writes are refused' })
          return
        }
        const body = await readJsonBody(request)
        if (body === null || typeof body !== 'object') {
          sendJson(response, 400, { error: 'a JSON object body is required' })
          return
        }
        const input = body as Record<string, unknown>
        const projectId = input.project
        const stage = input.stage
        const status = input.status
        if (typeof projectId !== 'string' || projectId === '') {
          sendJson(response, 400, { error: 'project is required' })
          return
        }
        if (!isStage(stage)) {
          sendJson(response, 400, { error: 'stage must be one of ' + STAGES.join(', ') })
          return
        }
        if (!isStatus(status)) {
          sendJson(response, 400, { error: 'status must be in_progress | awaiting_human | completed | failed' })
          return
        }
        const artifacts = input.artifacts
        const result = await machine.write({
          projectId,
          stage,
          status,
          artifacts: artifacts !== null && typeof artifacts === 'object' && !Array.isArray(artifacts)
            ? structuredClone(artifacts) as Record<string, unknown>
            : {},
          humanApproved: input.human_approved === true,
          ...(typeof input.note === 'string' ? { note: input.note } : {}),
        })
        const after = await machine.status(projectId)
        sendJson(response, 200, {
          stage,
          status,
          human_approved: result.checkpoint.human_approved,
          invalidated: result.invalidated,
          notices: result.notices,
          next_stage: after.next_stage,
          awaiting_approval: after.awaiting_approval,
        })
      } catch (error) {
        fail(response, error)
      }
    },
  }))

  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

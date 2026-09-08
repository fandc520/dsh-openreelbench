/**
 * Rendering the finished film — the whole act, in one place.
 *
 * This used to live inside `studio_compose`'s `execute`, which was fine while
 * the tool was the only way to reach it. It is not any more: pressing 合成 on
 * the compose screen renders directly rather than asking the model to do it,
 * because the last step of the pipeline has nothing left to decide. Everything
 * a person could judge — the cut, the pauses, the subtitle style, the music —
 * they judged on the screen already; routing that through an agent adds a
 * round trip, a chance to mistranscribe it, and no judgement.
 *
 * THE TOOL STAYS. A fully automatic run has no screen to press, and the model
 * still needs the last step. Two callers, one function, so the governance
 * cannot hold on one path and be skipped on the other — the prerequisites, the
 * slideshow refusal, the frame resolution and the warnings all live here.
 */
import type { AssetManifest, Brief, RenderReport, ScenePlan, Script } from './schema.js'
import { type SectionTiming, planSections, renderProject } from './compose.js'
import { resolveVideoProfile } from './media-profile.js'
import { scoreSlideshowRisk } from './slideshow.js'
import { resolvePlaybook } from './playbooks.js'
import { type Cut, readCut } from './cuts.js'
import { StateViolationError } from './state.js'
import type { StudioRuntime } from './tools.js'

export interface ComposeRequest {
  projectId: string
  /** Bake subtitles into the picture for this render. Omitted takes the setting. */
  burnSubtitles?: boolean | undefined
  subtitleBackground?: 'outline' | 'box' | undefined
  /**
   * Render past a blocking slideshow score.
   *
   * Only ever set by a person who has seen the number. The refusal is aimed at
   * unattended runs; governance nobody can overrule is a wall, not governance.
   */
  force?: boolean | undefined
  /**
   * Which saved edit to render. Absent renders the plan.
   *
   * New, and it closes a hole: the tool had no such parameter, so selecting a
   * version on the compose screen and pressing 合成 rendered the PLAN every
   * time. The panel's message named the cut and the model had nowhere to put
   * it, so it was dropped in silence — and the output was still a film, which
   * is why nothing caught it.
   */
  cutId?: string | undefined
  signal: AbortSignal
  onProgress?: ((message: string) => void) | undefined
}

export interface ComposeResultPayload {
  project: string
  report: RenderReport
  timeline: Array<{ sectionId: string; label: string; start: number; duration: number }>
  subtitlePath: string | null
  warnings: string[]
  /** Which cut was rendered, or null for the plan. */
  cut: string | null
}

export async function composeProject(
  runtime: StudioRuntime,
  request: ComposeRequest,
): Promise<ComposeResultPayload> {
  const { projectId } = request
  const machine = runtime.machine
  const config = runtime.getConfig()
  const { layout, marker } = await machine.requireProject(projectId)

  for (const stage of ['assets_audio', 'assets_shots'] as const) {
    const checkpoint = await machine.readCheckpoint(layout, stage)
    if (checkpoint === undefined || checkpoint.status !== 'completed') {
      throw new StateViolationError(
        'PREREQUISITE_VIOLATION',
        'PREREQUISITE VIOLATION: cannot compose; stage ' + JSON.stringify(stage) + ' is '
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
  const manifest: AssetManifest = { ...audio, assets: [...audio.assets, ...video.assets] }

  let cut: Cut | undefined
  if (request.cutId !== undefined && request.cutId !== '') {
    cut = await readCut(layout, request.cutId)
    if (cut === undefined) {
      throw new StateViolationError(
        'BAD_REQUEST',
        'no saved version ' + JSON.stringify(request.cutId) + ' in this project',
      )
    }
  }

  const { playbook, resolved, fallback } = resolvePlaybook(marker.style, config.playbooks)

  // Slideshow risk, scored against the timeline that is about to be cut.
  const scenePlan = await machine.readArtifact<ScenePlan>(layout, 'scene_plan')
  const subjects = new Map<string, string>()
  for (const section of script.sections) {
    const visual = section.visual
    if (visual?.prompt !== undefined && visual.prompt.trim() !== '') {
      subjects.set(section.id, visual.prompt.trim())
    }
  }
  const planned = planSections(script, manifest, playbook, cut)
  const risk = scenePlan === undefined
    ? undefined
    : scoreSlideshowRisk(scenePlan.shots, planned, playbook, subjects)
  if (risk?.blocking === true && request.force !== true) {
    const NL = String.fromCharCode(10)
    throw new StateViolationError(
      'QUALITY_VIOLATION',
      'QUALITY VIOLATION: 幻灯片风险 ' + risk.average.toFixed(2) + '/5（' + risk.verdict + '），'
      + '这样出片基本就是配了旁白的幻灯片。' + NL
      + Object.entries(risk.dimensions)
        .filter(([, entry]) => entry.score >= 2)
        .map(([name, entry]) => '  - ' + name + ' ' + entry.score + '：' + entry.reason)
        .join(NL) + NL
      + '先回 scene_plan 改：补镜头语言、把重复的画面换掉、标一个高光镜。'
      + '**如果用户看过分数仍然要出**，再带 force: true 重跑。',
    )
  }

  // The frame comes off the project first — that is what the project screen
  // edits, so it is the one a person can see and change — and off the brief for
  // projects whose platform only ever went through the model.
  const brief = await machine.readArtifact<Brief>(layout, 'brief')
  const platform = marker.target_platform ?? brief?.target_platform
  const profile = resolveVideoProfile(config.video, platform)

  const result = await renderProject({
    layout,
    script,
    manifest,
    config,
    playbook,
    ...(request.burnSubtitles === undefined ? {} : { burnSubtitles: request.burnSubtitles }),
    ...(request.subtitleBackground === undefined ? {} : { subtitleBackground: request.subtitleBackground }),
    ...(platform === undefined ? {} : { targetPlatform: platform }),
    ...(cut === undefined ? {} : { cut }),
    // Read off the project, never taken as a request argument: the bed is a
    // property of the film, and letting a render name a different one would
    // make two exports of the same cut differ in a way nothing recorded.
    ...(marker.music?.path === undefined || marker.music.path === ''
      ? {} : {
          musicPath: marker.music.path,
          musicSettings: {
            gainDb: marker.music.gain_db,
            fadeInSeconds: marker.music.fade_in,
            fadeOutSeconds: marker.music.fade_out,
          },
        }),
    signal: request.signal,
    ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
  })

  if (risk !== undefined) {
    result.warnings.push('幻灯片风险 ' + risk.average.toFixed(2) + '/5（' + risk.verdict + '）'
      + (request.force === true && risk.blocking ? '　⚠️ 用户要求强制出片' : ''))
  }
  // Said out loud, always: a frame that silently differs from the settings is
  // the failure this exists to prevent, and silence would reproduce it one
  // layer up.
  result.warnings.push(
    profile.source === 'platform'
      ? '画幅按 target_platform=' + platform + ' 出片：' + profile.label
      : '画幅用设置里的默认值：' + profile.width + 'x' + profile.height,
  )
  if (fallback) {
    result.warnings.push(
      'project style ' + JSON.stringify(marker.style) + ' is not defined; rendered with '
      + JSON.stringify(resolved) + ' instead',
    )
  }

  return {
    project: projectId,
    report: result.report,
    timeline: result.timeline.map((timing: SectionTiming) => ({
      sectionId: timing.sectionId,
      label: timing.label,
      start: Number(timing.start.toFixed(3)),
      duration: Number(timing.duration.toFixed(3)),
    })),
    subtitlePath: result.subtitlePath ?? null,
    warnings: result.warnings,
    cut: cut?.id ?? null,
  }
}

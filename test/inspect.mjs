/**
 * Print what the quality engines see for a real project.
 *
 *   node test/inspect.mjs               列出所有项目
 *   node test/inspect.mjs <项目id>       打印这个项目的全部派生结果
 *
 * Why this exists: the five-layer prompts, the variation report and the
 * slideshow score are all DERIVED — nothing writes them to disk, and the panel
 * is the only place they normally appear. Checking them meant clicking through
 * four screens and reading a collapsed banner. This prints the same numbers the
 * route computes, straight from the project on disk, so a verification pass
 * does not depend on the UI being right.
 *
 * It reads only. Nothing here writes to the project.
 */
import { resolve } from 'node:path'

import { Config } from '../lib/config.js'
import { StateMachine } from '../lib/state.js'
import { probeDuration, planSections } from '../lib/compose.js'
import { resolvePlaybook } from '../lib/playbooks.js'
import { buildScenePrompts } from '../lib/prompt.js'
import { checkSceneVariation } from '../lib/variation.js'
import { scoreSlideshowRisk } from '../lib/slideshow.js'
import { resolveVideoProfile } from '../lib/media-profile.js'

const NL = String.fromCharCode(10)

// The workspace root lives in DSH settings, which this script cannot read.
// OPENREEL_ROOT overrides it; the default matches the configured one on this
// machine. If the listing comes back empty, that is the thing to set.
const config = Config({ workspaceRoot: process.env.OPENREEL_ROOT ?? resolve('D:/AiStudio') })
const machine = new StateMachine({
  workspaceRoot: () => config.workspaceRoot,
  probeDuration: (path) => probeDuration(config.ffprobePath, path),
})

function head(title) {
  console.log(NL + '── ' + title + ' ' + '─'.repeat(Math.max(0, 62 - title.length)))
}

const wanted = process.argv[2]

if (wanted === undefined) {
  const projects = await machine.listProjects()
  console.log('工作区：' + config.workspaceRoot)
  if (projects.length === 0) {
    console.log('（没有项目）')
  } else {
    console.log(NL + '项目：')
    for (const entry of projects) console.log('  ' + entry.id.padEnd(28) + entry.title)
    console.log(NL + '用法：node test/inspect.mjs ' + projects[0].id)
  }
  process.exit(0)
}

const { layout, marker } = await machine.requireProject(wanted)
const script = await machine.readArtifact(layout, 'script')
const audio = await machine.readArtifact(layout, 'asset_manifest_audio')
const shots = await machine.readArtifact(layout, 'asset_manifest_shots')
const stored = await machine.readArtifact(layout, 'scene_plan')
const { playbook, resolved, fallback } = resolvePlaybook(marker.style, config.playbooks)

head('项目')
console.log('id       ' + marker.id)
console.log('标题     ' + marker.title)
console.log('风格     ' + resolved + (fallback ? '  ⚠ 项目写的 "' + marker.style + '" 不存在，回退了' : ''))
const profile = resolveVideoProfile(config.video, marker.target_platform)
console.log('平台     ' + (marker.target_platform ?? '（未设置）')
  + '  →  ' + profile.width + 'x' + profile.height + '（' + profile.source + '）')

if (script === undefined) {
  console.log(NL + '还没有脚本，后面的都算不了。')
  process.exit(0)
}

const timeline = planSections(script, {
  version: '1.0',
  assets: [...(audio?.assets ?? []), ...(shots?.assets ?? [])],
}, playbook)

const subjects = new Map()
for (const section of script.sections) {
  const prompt = section.visual?.prompt
  if (typeof prompt === 'string' && prompt.trim() !== '') subjects.set(section.id, prompt.trim())
}

head('脚本里的画面描述（五层里第 3 层的来源）')
for (const section of script.sections) {
  const prompt = subjects.get(section.id)
  console.log('  ' + section.id.padEnd(6) + (prompt ?? '（没写）'))
}

// Mirrors the route: stored plan wins, otherwise derive from the timeline.
const plan = stored ?? {
  version: '1.0',
  shots: timeline.flatMap((timing) => {
    const planned = marker.shot_plan?.[timing.sectionId]
    const count = Math.max(planned?.length ?? 0, timing.shots.length, 1)
    return Array.from({ length: count }, (_, index) => {
      const entry = planned?.[index]
      const prompt = entry?.prompt ?? (index === 0 ? subjects.get(timing.sectionId) : undefined)
      return {
        id: timing.sectionId + '-' + index,
        section_id: timing.sectionId,
        shot_index: index,
        ...(prompt === undefined || prompt.trim() === '' ? {} : { prompt: prompt.trim() }),
        ...(entry?.weight === undefined ? {} : { weight: entry.weight }),
      }
    })
  }),
}

head('分镜计划  ' + (stored === undefined ? '（推导的，还没人编辑过分镜）' : '（已保存的 scene_plan）'))
for (const shot of plan.shots) {
  const language = Object.entries(shot.shot_language ?? {}).map(([k, v]) => k + '=' + v).join(' ')
  console.log('  ' + (shot.section_id + '#' + shot.shot_index).padEnd(8)
    + (shot.hero_moment ? '★ ' : '  ')
    + (shot.prompt ?? '（无主体）').slice(0, 44).padEnd(46)
    + (language || '（无镜头语言）'))
}

head('五层提示词')
for (const built of buildScenePrompts(plan.shots, playbook, subjects)) {
  console.log('  ' + built.sectionId + '#' + built.shotIndex + (built.missingSubject ? '  ⚠ 没有主体' : ''))
  for (const layer of built.layers) {
    console.log('     ' + layer.layer + ' ' + layer.name + (layer.fromDefaults ? '(风格默认)' : '        ').padEnd(10)
      + layer.text)
  }
}

head('重复度检查  variation —— 只提示，不拦')
const variation = checkSceneVariation(plan.shots, subjects)
console.log('  ' + variation.score + ' / 5   ' + variation.verdict
  + (variation.violations.length === 0 ? '   ✓ 没有问题' : ''))
for (const issue of variation.violations) console.log('  - [' + issue.code + '] ' + issue.message)
for (const tip of variation.suggestions) console.log('  · ' + tip)

head('幻灯片风险  slideshow —— 会拦合成')
if (timeline.length === 0) {
  console.log('  还没有时间轴（配音没生成），算不了')
} else {
  const risk = scoreSlideshowRisk(plan.shots, timeline, playbook, subjects)
  console.log('  ' + risk.average + ' / 5   ' + risk.verdict
    + (risk.blocking ? '   ⛔ 会拦住合成，除非用户勾「我看过了，照出」' : '   ✓ 放行'))
  for (const [name, dimension] of Object.entries(risk.dimensions)) {
    console.log('  ' + name.padEnd(26) + String(dimension.score).padStart(4) + '   ' + dimension.reason)
  }
}

head('时间轴')
let total = 0
for (const timing of timeline) {
  total += timing.duration
  console.log('  ' + timing.sectionId.padEnd(6) + timing.duration.toFixed(2).padStart(7) + 's'
    + '   ' + timing.shots.length + ' 镜')
}
console.log('  ' + '合计'.padEnd(6) + total.toFixed(2).padStart(7) + 's'
  + '   每分钟 ' + (total > 0 ? (plan.shots.length / total * 60).toFixed(1) : '0') + ' 张画面')
console.log()

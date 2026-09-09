/**
 * End-to-end smoke test against the built lib/.
 * Run: pnpm test
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'

import { Config } from '../lib/config.js'
import { resolvePlaybook } from '../lib/playbooks.js'
import { StateMachine } from '../lib/state.js'
import { parseSrt, renderSrt } from '../lib/subtitle.js'
import { escapeFilterPath, probeDuration, renderProject } from '../lib/compose.js'
import { mediaKindOf, mediaUrl } from '../lib/http.js'
import { registerStudioTools } from '../lib/tools.js'
import { parseCut, writeCut } from '../lib/cuts.js'

const run = promisify(execFile)
const WS = resolve('tmp/ws')

let passed = 0
let failed = 0

function ok(label) {
  passed += 1
  console.log('  PASS  ' + label)
}
function bad(label, detail) {
  failed += 1
  console.log('  FAIL  ' + label + (detail ? '\n        ' + String(detail).split('\n').join('\n        ') : ''))
}

async function expectThrow(label, code, fn) {
  try {
    await fn()
    bad(label, 'expected ' + code + ' but the call succeeded')
  } catch (error) {
    if (error.code === code) ok(label + '  -> ' + code)
    else bad(label, 'expected ' + code + ', got ' + (error.code ?? error.name) + ': ' + error.message)
  }
}

/** What the harness does to tool-call arguments before execute. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const inner of Object.values(value)) deepFreeze(inner)
  return Object.freeze(value)
}

async function expectOk(label, fn) {
  try {
    const value = await fn()
    ok(label)
    return value
  } catch (error) {
    bad(label, error.stack ?? error.message)
    return undefined
  }
}

/* --------------------------------------------------------------- fixtures */

const SECTIONS = [
  { id: 's1', label: 'hook', seconds: 3.2, color: 'blue' },
  { id: 's2', label: 'body', seconds: 2.1, color: 'green' },
  { id: 's3', label: 'close', seconds: 4.0, color: 'maroon' },
]

function script(overrides = {}) {
  let cursor = 0
  const sections = SECTIONS.map((section) => {
    const start = cursor
    const end = cursor + section.seconds + 0.6
    cursor = end
    return {
      id: section.id,
      label: section.label,
      text: '这是第 ' + section.id + ' 段的解说文字，用来验证字幕切分与时间轴对齐是否正确。',
      start_seconds: Number(start.toFixed(2)),
      end_seconds: Number(end.toFixed(2)),
      delivery_cues: section.id === 's2'
        // Overrides the playbook's 0.15 / 0.45 default, which is how a writer
        // marks a beat without slowing the whole film down.
        ? { pace: 'measured', pause_before_seconds: 1.0, pause_after_seconds: 1.5 }
        : { pace: 'conversational' },
      visual: { prompt: 'a ' + section.color + ' abstract gradient, cinematic lighting' },
    }
  })
  return {
    version: '1.0',
    title: '烟雾测试片',
    total_duration_seconds: Number(cursor.toFixed(2)),
    sections,
    ...overrides,
  }
}

const brief = {
  version: '1.0',
  title: '烟雾测试片',
  hook: '三十秒讲明白一件事',
  key_points: ['第一点', '第二点', '第三点'],
  tone: '克制、清楚',
  style: 'flat illustration',
  target_platform: 'bilibili',
  target_duration_seconds: 30,
}

async function makeMedia(layout) {
  for (const section of SECTIONS) {
    await run('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=' + section.color + ':s=1280x720:d=1',
      '-frames:v', '1',
      join(layout.imagesDir, section.id + '.png'),
    ])
    await run('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=' + section.seconds,
      '-ar', '44100', '-ac', '1',
      join(layout.audioDir, section.id + '.wav'),
    ])
  }
}

/** Narration for every section — what assets_audio records. */
function audioManifest() {
  return {
    version: '1.0',
    assets: SECTIONS.map((section) => ({
      id: section.id + '-audio',
      type: 'narration',
      path: 'assets/audio/' + section.id + '.wav',
      source_tool: 'comfyui_workflow',
      scene_id: section.id,
      // Deliberately wrong: the state machine must overwrite it with the
      // ffprobe measurement rather than trust the caller.
      duration_seconds: 99,
    })),
  }
}

/** A still for every section — what assets_shots records. */
function videoManifest() {
  return {
    version: '1.0',
    assets: SECTIONS.map((section) => ({
      id: section.id + '-image',
      type: 'image',
      path: 'assets/images/' + section.id + '.png',
      source_tool: 'comfyui_workflow',
      scene_id: section.id,
    })),
  }
}


/* ------------------------------------------------- apply() with fake services */

/**
 * Mount the plugin against stand-in services and watch what it registers.
 * Covers the wiring apply() does that no other test reaches: the settings
 * section, and the skill re-render that has to follow a settings change —
 * the binding table is rendered *into* the instruction text, so a skill left
 * standing after a rebind would name the old workflow.
 */
function fakeHost() {
  const tools = new Map()
  const skills = new Map()
  let skillSeq = 0
  const effects = []
  let section

  const settingsScope = {
    value: undefined,
    get() {
      return this.value
    },
    watchers: [],
    watch(cb) {
      this.watchers.push(cb)
    },
    commit(next) {
      this.value = next
      for (const cb of this.watchers) cb()
    },
  }

  // Mirrors @deepseek-ai/dsh-settings' SettingsProvider.installSection.
  //
  // The stub used to offer `register`, which the real provider does not expose
  // to consumers — so it drifted from the API without a word until a dependency
  // bump made the difference load-bearing. The signature and the hook order are
  // copied from the package's own types: setSource before onChange, both called
  // at install so a consumer's derived state is correct from the first tick.
  const settingsService = {
    installSection(owner, ns, schema, entry, hooks) {
      section = { ns, schema, base: entry }
      settingsScope.value = schema(entry)
      hooks.setSource(() => settingsScope.value)
      hooks.onChange()
      settingsScope.watch(() => hooks.onChange())
    },
  }

  const routes = new Map()
  const webServer = {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }

  const ctx = {
    // dsh-settings guards its callbacks with isUnloading(ctx), which reads
    // ctx.fiber.state — cordis fiber states 4 and 5 mean disposed/unloading.
    fiber: { state: 1 },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    get(name) {
      if (name === 'skills') {
        return {
          register(skill) {
            const key = skill.name + '#' + (skillSeq += 1)
            skills.set(key, skill)
            return () => skills.delete(key)
          },
          // Mirrors the host: an omitted invocation policy defaults to both
          // true, which is what makes a `/name` gesture load a runtime skill.
          async list() {
            return [...skills.values()].map((skill) => ({
              name: skill.name,
              invocation: skill.invocation ?? { modelInvocable: true, userInvocable: true },
            }))
          },
        }
      }
      if (name === 'webServer') return webServer
      return undefined
    },
    effect(fn, label) {
      effects.push({ label, dispose: fn() })
    },
    inject(names, cb) {
      const scoped = {
        effect: (fn, label) => effects.push({ label: label ?? 'injected', dispose: fn() }),
        get: (name) => ctx.get(name),
      }
      // The real host hands the callback a context carrying the service it
      // waited for; routes look theirs up off it, so it has to be there.
      if (names.includes('settings')) cb({ ...scoped, settings: settingsService })
      else if (names.includes('webServer')) cb({ ...scoped, webServer })
    },
  }

  return {
    ctx,
    tools,
    skills,
    routes,
    section: () => section,
    scope: settingsScope,
    disposeAll() {
      for (const effect of effects.reverse()) effect.dispose?.()
    },
  }
}

async function testApply() {
  const { apply, Config: EntryConfig } = await import('../lib/index.js')
  const host = fakeHost()
  const entry = EntryConfig({ bindings: { tts: { workflow: 'Alpha-TTS' }, image: { workflow: 'Alpha-Image' } } })

  apply(host.ctx, entry)

  const toolNames = [...host.tools.keys()].sort().join(',')
  if (toolNames === 'studio_compose,studio_edit,studio_project,studio_show,studio_stage') ok('apply registers the five tools')
  else bad('tool registration', toolNames)

  const skillNames = [...host.skills.values()].map((s) => s.name).sort()
  const expectedSkills = [
    'dsh-creative-studio-cinematography',
    'dsh-creative-studio-explainer-stills',
    'dsh-creative-studio-reviewer',
    'dsh-creative-studio-sound-design',
    'dsh-creative-studio-stage-assets-audio',
    'dsh-creative-studio-stage-assets-shots',
    'dsh-creative-studio-stage-brief',
    'dsh-creative-studio-stage-compose',
    'dsh-creative-studio-stage-script',
    'dsh-creative-studio-storytelling',
    'dsh-creative-studio-usage',
  ]
  if (skillNames.join(',') === expectedSkills.join(','))
    ok('apply registers all 11 skills')
  else bad('skill registration', skillNames.join(','))

  const section = host.section()
  if (section?.ns === 'studio') ok("settings section registered under the 'studio' namespace")
  else bad('settings namespace', JSON.stringify(section?.ns))
  if (section?.base === entry) ok('the cordis.yml entry is passed as the settings base layer')
  else bad('settings base', 'entry config was not handed to the settings service')

  const before = [...host.skills.values()].find((s) => s.name === 'dsh-creative-studio-explainer-stills')
  if (before.content.includes('Alpha-TTS')) ok('the skill renders the configured binding')
  else bad('skill binding', 'Alpha-TTS missing from the instruction text')

  // A user rebinds the TTS workflow in the settings page.
  host.scope.commit(EntryConfig({
    ...entry,
    bindings: { tts: { workflow: 'Beta-TTS', notes: '' }, image: { workflow: 'Alpha-Image', notes: '' } },
  }))

  const after = [...host.skills.values()].find((s) => s.name === 'dsh-creative-studio-explainer-stills')
  if (after.content.includes('Beta-TTS') && !after.content.includes('Alpha-TTS')) {
    ok('a settings change re-renders the skill with the new binding')
  } else {
    bad('skill re-render', 'still naming the old workflow after the settings change')
  }
  if ([...host.skills.values()].length === 11) ok('re-rendering replaces the skills instead of stacking them')
  else bad('skill leak', [...host.skills.values()].length + ' skills registered')

  host.disposeAll()
  if (host.tools.size === 0 && host.skills.size === 0) ok('disposing the fiber unregisters everything')
  else bad('dispose', host.tools.size + ' tools, ' + host.skills.size + ' skills left behind')
}

/* ------------------------------------------------------------------- main */

/* ------------------------------------------------------- route test rig */

/** A request the route handlers can read: URL, method, headers, JSON body. */
function fakeRequest(url, { method = 'GET', headers = {}, body } = {}) {
  const source = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const request = Readable.from(source)
  request.url = url
  request.method = method
  request.headers = { host: 'localhost:3080', ...headers }
  return request
}

/**
 * A response that captures the status line and collects the body — a real
 * Writable, because sendFile pipes a read stream straight into it.
 */
function fakeResponse() {
  const chunks = []
  const response = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk))
      callback()
    },
  })
  response.statusCode = 0
  response.headers = {}
  response.writeHead = (status, headers = {}) => {
    response.statusCode = status
    response.headers = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]))
    return response
  }
  response.settled = new Promise((resolve) => response.on('finish', resolve))
  response.buffer = () => Buffer.concat(chunks)
  response.text = () => Buffer.concat(chunks).toString('utf8')
  response.json = () => JSON.parse(response.text())
  return response
}

/** Drive one registered route and wait for its response to finish. */
async function callRoute(routes, path, url, options) {
  const route = routes.get(path)
  if (route === undefined) throw new Error('route not registered: ' + path)
  const request = fakeRequest(url, options)
  const response = fakeResponse()
  await route.handler(request, response)
  await response.settled
  return response
}

async function main() {
  await fs.rm(WS, { recursive: true, force: true })

  const config = Config({
    workspaceRoot: WS,
    video: { width: 640, height: 360, fps: 24, preset: 'ultrafast' },
  })
  const { playbook } = resolvePlaybook(config.defaultStyle, config.playbooks)
  const machine = new StateMachine({
    workspaceRoot: () => WS,
    probeDuration: (path) => probeDuration(config.ffprobePath, path),
  })

  console.log('\n== apply() ==')
  await testApply()

  console.log('\n== project ==')
  const created = await expectOk('init project', () =>
    machine.initProject({ id: 'smoke', title: '烟雾测试片', targetDurationSeconds: 30 }))
  const layout = created.layout
  if (created.marker.voice === '') ok('voice starts unset, so the model has to ask')
  else bad('voice default', 'expected empty, got ' + JSON.stringify(created.marker.voice))

  const voiced = await expectOk('set_voice', () => machine.setVoice('smoke', '解说-沉稳男声'))
  if (voiced?.voice === '解说-沉稳男声') ok('voice persisted on the project marker')
  else bad('set_voice', JSON.stringify(voiced))

  console.log('\n== style playbooks ==')
  if (playbook.name === '清晰科技') ok('default style resolves to ' + config.defaultStyle + ' 「' + playbook.name + '」')
  else bad('default style', JSON.stringify(playbook.name))
  const missingStyle = resolvePlaybook('no-such-style', config.playbooks)
  if (missingStyle.fallback === true && missingStyle.resolved === config.defaultStyle) ok('an undefined style falls back and says so')
  else bad('style fallback', JSON.stringify(missingStyle.resolved))
  const custom = resolvePlaybook('mine', { mine: { ...playbook, name: '自定义', subtitleMaxChars: 12 } })
  if (custom.playbook.subtitleMaxChars === 12 && custom.fallback === false) ok('a custom playbook overrides the built-ins')
  else bad('custom playbook', JSON.stringify(custom.resolved))

  console.log('\n== the two rules ==')
  await expectThrow('assets_audio before anything', 'PREREQUISITE_VIOLATION', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_audio', status: 'completed', artifacts: { asset_manifest_audio: audioManifest() }, humanApproved: true }))

  await expectThrow('brief completed without approval', 'GATE_VIOLATION', () =>
    machine.write({ projectId: 'smoke', stage: 'brief', status: 'completed', artifacts: { brief }, humanApproved: false }))

  await expectThrow('brief missing a required field', 'SCHEMA_INVALID', () =>
    machine.write({ projectId: 'smoke', stage: 'brief', status: 'awaiting_human', artifacts: { brief: { ...brief, hook: undefined } }, humanApproved: false }))

  await expectThrow('brief with a typo\'d field', 'SCHEMA_INVALID', () =>
    machine.write({ projectId: 'smoke', stage: 'brief', status: 'awaiting_human', artifacts: { brief: { ...brief, target_platfrom: 'bilibili' } }, humanApproved: false }))

  console.log('\n== brief ==')
  await expectOk('brief -> awaiting_human', () =>
    machine.write({ projectId: 'smoke', stage: 'brief', status: 'awaiting_human', artifacts: { brief }, humanApproved: false }))

  const parked = await machine.status('smoke')
  if (parked.awaiting_approval === 'brief') ok('status reports the gate')
  else bad('status reports the gate', JSON.stringify(parked.stages))

  await expectThrow('script while brief is unapproved', 'PREREQUISITE_VIOLATION', () =>
    machine.write({ projectId: 'smoke', stage: 'script', status: 'awaiting_human', artifacts: { script: script() }, humanApproved: false }))

  await expectOk('brief -> completed + approved', () =>
    machine.write({ projectId: 'smoke', stage: 'brief', status: 'completed', artifacts: { brief }, humanApproved: true }))

  console.log('\n== script ==')
  const overlapping = script()
  overlapping.sections[1].start_seconds = 0.5
  await expectThrow('overlapping sections', 'SCHEMA_INVALID', () =>
    machine.write({ projectId: 'smoke', stage: 'script', status: 'awaiting_human', artifacts: { script: overlapping }, humanApproved: false }))

  await expectThrow('total duration drifting from the sections', 'SCHEMA_INVALID', () =>
    machine.write({ projectId: 'smoke', stage: 'script', status: 'awaiting_human', artifacts: { script: script({ total_duration_seconds: 300 }) }, humanApproved: false }))

  await expectOk('script -> completed + approved', () =>
    machine.write({ projectId: 'smoke', stage: 'script', status: 'completed', artifacts: { script: script() }, humanApproved: true }))

  console.log('\n== assets_audio ==')
  await expectThrow('manifest naming files that do not exist', 'ASSET_MISSING', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_audio', status: 'completed', artifacts: { asset_manifest_audio: audioManifest() }, humanApproved: true }))

  await makeMedia(layout)

  const escaping = audioManifest()
  escaping.assets[0].path = '../../../etc/passwd'
  await expectThrow('manifest escaping the project directory', 'SCHEMA_INVALID', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_audio', status: 'completed', artifacts: { asset_manifest_audio: escaping }, humanApproved: true }))

  const orphan = audioManifest()
  orphan.assets[0].scene_id = 'does-not-exist'
  await expectThrow('asset pointing at an unknown section', 'COVERAGE_INCOMPLETE', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_audio', status: 'completed', artifacts: { asset_manifest_audio: orphan }, humanApproved: true }))

  const gappy = audioManifest()
  gappy.assets = gappy.assets.filter((asset) => asset.scene_id !== 's2')
  await expectThrow('a section with no narration', 'COVERAGE_INCOMPLETE', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_audio', status: 'completed', artifacts: { asset_manifest_audio: gappy }, humanApproved: true }))

  // Audio and stills are separate stages so ComfyUI is never made to swap
  // models mid-batch. Each stage must refuse the other's media outright,
  // otherwise a still would satisfy audio coverage while contributing nothing.
  await expectThrow('a still recorded against assets_audio', 'SCHEMA_INVALID', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_audio', status: 'completed', artifacts: { asset_manifest_audio: videoManifest() }, humanApproved: true }))

  const badBatch = audioManifest()
  badBatch.assets[1].path = 'assets/audio/typo.wav'
  await expectThrow('a wrong path is caught at in_progress, before the batch finishes', 'ASSET_MISSING', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_audio', status: 'in_progress', artifacts: { asset_manifest_audio: badBatch }, humanApproved: false }))

  const partial = audioManifest()
  partial.assets = partial.assets.filter((asset) => asset.scene_id !== 's3')
  await expectOk('a partial batch passes in_progress without a coverage error', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_audio', status: 'in_progress', artifacts: { asset_manifest_audio: partial }, humanApproved: false }))

  await expectThrow('assets_audio completed without approval', 'GATE_VIOLATION', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_audio', status: 'completed', artifacts: { asset_manifest_audio: audioManifest() }, humanApproved: false }))

  // The harness deep-freezes tool-call arguments. A state machine that wrote
  // the ffprobe measurement back through the caller's manifest threw
  // "Cannot add property duration_seconds, object is not extensible" here, and
  // only in the real host — the offline test used to hand it thawed objects.
  const written = await expectOk('assets_audio -> completed, with deep-frozen artifacts', () =>
    machine.write({
      projectId: 'smoke',
      stage: 'assets_audio',
      status: 'completed',
      artifacts: deepFreeze({ asset_manifest_audio: audioManifest() }),
      humanApproved: true,
    }))
  if (written) {
    const stored = await machine.readArtifact(layout, 'asset_manifest_audio')
    const measured = stored.assets.find((asset) => asset.id === 's1-audio').duration_seconds
    if (Math.abs(measured - 3.2) < 0.1) ok('declared duration overwritten with the ffprobe measurement (' + measured + 's)')
    else bad('duration backfill', 'expected ~3.2, got ' + measured)
  }

  console.log('\n== assets_shots ==')
  await expectThrow('narration recorded against assets_shots', 'SCHEMA_INVALID', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_shots', status: 'completed', artifacts: { asset_manifest_shots: audioManifest() }, humanApproved: true }))

  const gappyVideo = videoManifest()
  gappyVideo.assets = gappyVideo.assets.filter((asset) => asset.scene_id !== 's2')
  await expectThrow('a section with no visual', 'COVERAGE_INCOMPLETE', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_shots', status: 'completed', artifacts: { asset_manifest_shots: gappyVideo }, humanApproved: true }))

  await expectOk('assets_shots -> completed', () =>
    machine.write({ projectId: 'smoke', stage: 'assets_shots', status: 'completed', artifacts: { asset_manifest_shots: videoManifest() }, humanApproved: true }))

  console.log('\n== compose ==')
  const progressLog = []
  const result = await expectOk('render', async () => renderProject({
    layout,
    script: await machine.readArtifact(layout, 'script'),
    // The composer takes one merged view; the two stage manifests exist so
    // each batch can be approved and checked on its own terms.
    manifest: {
      version: '1.0',
      assets: [
        ...(await machine.readArtifact(layout, 'asset_manifest_audio')).assets,
        ...(await machine.readArtifact(layout, 'asset_manifest_shots')).assets,
      ],
    },
    config,
    playbook,
    signal: new AbortController().signal,
    onProgress: (update) => {
      progressLog.push(update)
      console.log('        . ' + String(Math.round(update.fraction * 100)).padStart(3) + '%  ' + update.label)
    },
  }))

  if (result) {
    const output = result.report.outputs[0]
    const absolute = join(layout.dir, output.path)
    const stat = await fs.stat(absolute).catch(() => undefined)
    if (stat && stat.size > 10_000) ok('produced ' + output.path + '  ' + output.resolution + '  ' + output.duration_seconds + 's  ' + Math.round(stat.size / 1024) + ' KB')
    else bad('produced an output file', 'missing or suspiciously small')

    // Playbook padding on s1 and s3, the section's own cues on s2.
    const expected = (0.15 + 3.2 + 0.45) + (1.0 + 2.1 + 1.5) + (0.15 + 4.0 + 0.45)
    if (Math.abs(output.duration_seconds - expected) < 0.4) ok('duration matches the measured timeline (' + output.duration_seconds + 's vs ' + expected.toFixed(1) + 's)')
    else bad('duration', 'expected ~' + expected.toFixed(1) + ', got ' + output.duration_seconds)

    const t1 = result.timeline.find((t) => t.sectionId === 's1')
    const t2 = result.timeline.find((t) => t.sectionId === 's2')
    // s1 takes the playbook default (0.15 + 3.2 + 0.45); s2 overrides it
    // through its own cues (1.0 + 2.1 + 1.5).
    if (Math.abs(t1.duration - 3.8) < 0.05) ok('s1 uses the playbook pacing (' + t1.duration.toFixed(2) + 's)')
    else bad('playbook pacing', 'expected ~3.80s, got ' + t1.duration)
    if (Math.abs(t2.duration - 4.6) < 0.05) ok('s2 pause cues override the playbook (' + t2.duration.toFixed(2) + 's)')
    else bad('per-section pause cues', 'expected ~4.60s, got ' + t2.duration)

    // Every section still resolves to at least one shot, and the shots of a
    // section tile it exactly — no gap, no overlap, no drift.
    const tiled = result.timeline.every((timing) => {
      if (timing.shots.length === 0) return false
      const span = timing.shots.reduce((sum, shot) => sum + shot.duration, 0)
      const contiguous = timing.shots.every((shot, index) =>
        index === 0
          ? Math.abs(shot.start - timing.start) < 0.001
          : Math.abs(shot.start - (timing.shots[index - 1].start + timing.shots[index - 1].duration)) < 0.001)
      return Math.abs(span - timing.duration) < 0.001 && contiguous
    })
    if (tiled) ok('every section is tiled exactly by its shots')
    else bad('shot tiling', JSON.stringify(result.timeline.map((t) => t.shots.length)))

    // ---- what the progress bar is drawn from ---------------------------

    // A bar that goes backwards reads as a fault even when the estimate behind
    // it genuinely improved, so the sequence has to be monotonic at the source
    // rather than only clamped in the route.
    const fractions = progressLog.map((entry) => entry.fraction)
    const slipped = fractions.findIndex((value, index) => index > 0 && value < fractions[index - 1])
    if (slipped === -1) ok('render progress never goes backwards (' + fractions.length + ' updates)')
    else bad('progress slipped', 'at ' + slipped + ': ' + fractions.slice(Math.max(0, slipped - 1), slipped + 1))
    if ((fractions[fractions.length - 1] ?? 0) >= 0.9) ok('and reaches the end of the bar')
    else bad('progress stops short', String(fractions[fractions.length - 1]))
    // Only the shot phase can report a real count; the rest are fixed spans.
    // If that one stopped reporting i/n the bar would be pure guesswork through
    // the longest part of the render.
    const shots = progressLog.filter((entry) => entry.phase === 'shots')
    if (shots.length >= 3 && new Set(shots.map((entry) => entry.fraction)).size === shots.length)
      ok('the shot phase advances the bar per shot, which is where the time goes')
    else bad('shots do not advance', JSON.stringify(shots.map((entry) => entry.fraction)))
    // These labels go straight onto the page. The old ones were the developer's
    // English internals -- 'muxing', 'probing narration' -- shown to the user.
    const english = progressLog.filter((entry) => !/[\u4e00-\u9fa5]/.test(entry.label))
    if (english.length === 0) ok('every progress label is written for the reader, not the log')
    else bad('untranslated progress', english.map((entry) => entry.label).join(' | '))

    const srt = await fs.readFile(join(layout.dir, result.subtitlePath), 'utf-8').catch(() => undefined)
    if (srt && srt.includes('-->')) ok('wrote ' + result.subtitlePath + ' (' + srt.split('\n\n').filter(Boolean).length + ' cues)')
    else bad('subtitles', 'no SRT written')


    // ---- the same film, with a music bed -------------------------------
    //
    // The filter graph is measured on its own further down; this is the other
    // half of the question — that the render actually reaches it, that a bed on
    // the project changes the output, and that a two-pass loudness measurement
    // survives a real ffmpeg run rather than only a hand-built one.
    // Both renders write output/smoke.mp4 -- same project, same cut -- so the
    // plain one has to be measured before the scored one replaces it. Measuring
    // afterwards compared the music render against itself, which of course
    // showed no difference at all.
    const levelIn = async (relative) => {
      const { stderr } = await run('ffmpeg', [
        '-hide_banner', '-nostats', '-nostdin', '-i', join(layout.dir, relative),
        '-af', 'highpass=f=600,highpass=f=600,highpass=f=600,lowpass=f=850,lowpass=f=850,volumedetect',
        '-f', 'null', '-',
      ])
      const found = /mean_volume:\s*(-?[0-9.]+) dB/.exec(stderr)
      return found === null ? undefined : Number(found[1])
    }
    const withoutBed = await levelIn(result.report.outputs[0].path)

    const bed = join(layout.audioDir, 'music.wav')
    await run('ffmpeg', [
      '-y', '-v', 'error',
      // Deliberately SHORTER than the film, to exercise the loop and the
      // warning that goes with it.
      '-f', 'lavfi', '-i', 'sine=frequency=700:duration=5:sample_rate=48000',
      '-af', 'volume=4dB', '-ac', '2', bed,
    ])
    const scored = await expectOk('render with a music bed', async () => renderProject({
      layout,
      script: await machine.readArtifact(layout, 'script'),
      manifest: {
        version: '1.0',
        assets: [
          ...(await machine.readArtifact(layout, 'asset_manifest_audio')).assets,
          ...(await machine.readArtifact(layout, 'asset_manifest_shots')).assets,
        ],
      },
      config,
      playbook,
      musicPath: 'assets/audio/music.wav',
      signal: new AbortController().signal,
    }))
    if (scored) {
      if (scored.report.metadata.music === 'assets/audio/music.wav')
        ok('the render report names the bed it was scored with')
      else bad('music not reported', JSON.stringify(scored.report.metadata.music))

      // A bed shorter than the film loops, and the seam is audible. Not fatal,
      // but this is the only place that knows both numbers.
      const looped = scored.warnings.find((line) => line.includes('loops'))
      if (looped !== undefined) ok('a short bed warns that it loops')
      else bad('no loop warning', JSON.stringify(scored.warnings))

      // The bed has to reach the output. Comparing the two renders' audio is
      // the only thing that can tell "mixed in" from "silently dropped" — both
      // produce a playable file of about the same size. The narration fixtures
      // are 440 Hz and the bed is 700 Hz, so a steep band around 700 separates
      // them.
      const withBed = await levelIn(scored.report.outputs[0].path)
      if (withBed !== undefined && withoutBed !== undefined && withBed - withoutBed > 6)
        ok('the bed is audible in the render (' + withBed.toFixed(1) + ' vs ' + withoutBed.toFixed(1) + ' dB)')
      else bad('bed missing from the render', JSON.stringify([withBed, withoutBed]))
    }

    // A project naming a bed that is not on disk must say so, not render silence.
    let missingBed
    await renderProject({
      layout,
      script: await machine.readArtifact(layout, 'script'),
      manifest: {
        version: '1.0',
        assets: [
          ...(await machine.readArtifact(layout, 'asset_manifest_audio')).assets,
          ...(await machine.readArtifact(layout, 'asset_manifest_shots')).assets,
        ],
      },
      config,
      playbook,
      musicPath: 'assets/audio/nope.wav',
      signal: new AbortController().signal,
    }).catch((error) => { missingBed = String(error.message ?? error) })
    // Naming the file is not enough: ffmpeg's own failure names it too. What
    // the explicit check adds is what to DO about it, and that is the part
    // worth asserting -- a raw ffmpeg error tells the user nothing actionable.
    if (missingBed !== undefined && missingBed.includes('nope.wav') && missingBed.includes('Re-import'))
      ok('a bed that is not on disk fails with something the user can act on')
    else bad('missing bed', missingBed ?? 'rendered anyway')

    const fake = structuredClone(result.report)
    fake.outputs[0].path = 'output/not-real.mp4'
    await expectThrow('render report naming a file that was never produced', 'ASSET_MISSING', () =>
      machine.write({ projectId: 'smoke', stage: 'compose', status: 'completed', artifacts: { render_report: fake }, humanApproved: false }))

    await expectOk('compose -> completed', () =>
      machine.write({ projectId: 'smoke', stage: 'compose', status: 'completed', artifacts: { render_report: result.report }, humanApproved: false }))

    const done = await machine.status('smoke')
    if (done.next_stage === null) ok('pipeline reports complete')
    else bad('pipeline complete', 'next_stage=' + done.next_stage)
  }

  console.log('\n== rewriting an earlier stage ==')
  const rewrite = await expectOk('script rewritten after the run finished', () =>
    machine.write({ projectId: 'smoke', stage: 'script', status: 'completed', artifacts: { script: script({ title: '改过的标题' }) }, humanApproved: true }))
  if (rewrite) {
    if (rewrite.invalidated.join(',') === 'assets_audio,assets_shots,compose') ok('discarded both asset stages and compose')
    else bad('downstream invalidation', 'invalidated=' + JSON.stringify(rewrite.invalidated))
    const after = await machine.status('smoke')
    if (after.next_stage === 'assets_audio') ok('next stage is back to assets_audio')
    else bad('next stage after rewrite', after.next_stage)
  }

  const history = await fs.readdir(layout.historyDir)
  if (history.length >= 3) ok('archived ' + history.length + ' superseded checkpoint(s)')
  else bad('history', 'expected several archived checkpoints, found ' + history.length)

  console.log('\n== client bundle ==')
  {
    const { readFileSync } = await import('node:fs')
    let captured
    globalThis.window = { __ModuleLoader__: { load: (module) => { captured = module } } }
    new Function(readFileSync('client/client.js', 'utf-8'))()

    if (captured?.id === 'dsh-creative-studio') ok('bundle announces itself to the module loader')
    else bad('bundle id', JSON.stringify(captured?.id))

    const externals = []
    const req = (id) => {
      externals.push(id)
      if (id === 'react') {
        return {
          createElement: () => null, useState: () => [undefined, () => {}], useEffect: () => {},
          useMemo: (fn) => fn(), useRef: () => ({ current: null }), useCallback: (fn) => fn,
          useSyncExternalStore: () => undefined,
          // Called at module scope by memoised components, so the stub has to
          // return something callable rather than undefined.
          memo: (component) => component,
        }
      }
      if (id === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: null }
      throw new Error('bundle reached past the module table: ' + id)
    }
    const mod = captured.factory(req)

    // The purity gate: anything beyond react means the bundle would fail to
    // load in the browser, where only module-table entries resolve.
    const unexpected = externals.filter((id) => id !== 'react' && id !== 'react/jsx-runtime')
    if (unexpected.length === 0) ok('bundle imports no platform value beyond react')
    else bad('client purity', 'imported ' + JSON.stringify(unexpected))

    if (JSON.stringify(mod.inject) === JSON.stringify(['slots', 'settingsScope', 'sessions']))
      ok('client injects slots, settingsScope and sessions')
    else bad('client inject', JSON.stringify(mod.inject))

    const registered = []
    const sent = []
    const ctx = {
      effect: (fn) => { fn() },
      slots: {
        inject: (slot, register) => {
          const value = register()
          if (value && typeof value.next === 'function') { for (const _ of value); }
        },
        register: (meta) => { registered.push(meta); return () => {} },
      },
      settingsScope: {
        bind: () => ({
          getSnapshot: () => ({ status: 'loading', value: undefined, base: undefined, user: undefined, writable: false }),
          subscribe: () => () => {}, set: async () => {}, unset: async () => {},
        }),
      },
      sessions: {
        binding: (id) => ({
          session: {
            prompt: async (content, mode) => {
              sent.push({ id, mode, text: content[0]?.text })
              return { ok: true }
            },
          },
        }),
      },
    }
    mod.apply(ctx)

    const slots = registered.map((meta) => meta.name + '#' + (meta.id ?? meta.key))
    if (slots.includes('conversation.view#studio') && slots.includes('settings.section#studio'))
      ok('registers ' + slots.join(' + '))
    else bad('client slots', JSON.stringify(slots))

    // The session-scope contract: a session slot's `inject` takes the session
    // id, and send must go through `sessions.scope(id)`. Calling the plugin's
    // own root `conversation` throws `requires a session scope` in the browser.
    const view = registered.find((meta) => meta.name === 'conversation.view')
    if (typeof view?.inject === 'function') {
      const face = view.inject('session-42')
      if (face.sessionId === 'session-42') ok('the view carries its session id for panel memory')
      else bad('sessionId prop', JSON.stringify(face.sessionId))
      await face.send('hello')
      const call = sent[0]
      if (sent.length === 1 && call.id === 'session-42' && call.text === 'hello' && call.mode === 'queue')
        ok('the view prompts the bound session in queue mode')
      else bad('session send', JSON.stringify(sent))

      // A pruned session must surface, not fail silently.
      const dead = registered.find((meta) => meta.name === 'conversation.view')
        .inject.call(null, 'gone')
      const savedBinding = ctx.sessions.binding
      ctx.sessions.binding = () => undefined
      let refused = false
      await dead.send('x').catch(() => { refused = true })
      ctx.sessions.binding = savedBinding
      if (refused) ok('sending into a vanished session rejects')
      else bad('dead session', 'send resolved for a session with no binding')
    } else bad('view inject', 'conversation.view registered no inject factory')

    // The settings form is a hand-written table, not generated from the schema,
    // so a binding added to config.ts can silently never reach the UI. It did:
    // voice_design and voice_query shipped invisible. This is the guard.
    const fieldsSource = readFileSync('src/client/fields.ts', 'utf-8')
    const entryConfig = Config({})
    const missing = Object.keys(entryConfig.bindings).filter(
      (key) => !fieldsSource.includes("'bindings', '" + key + "', 'workflows'"),
    )
    if (missing.length === 0) {
      ok('every config binding has a settings field (' + Object.keys(entryConfig.bindings).join(', ') + ')')
    } else {
      bad('settings coverage', 'these bindings have no field: ' + missing.join(', '))
    }

    delete globalThis.window
  }

  // Last on purpose: the route block ends with a panel submit to `brief`,
  // which invalidates every later stage. Anything asserting on downstream
  // state has to have run already.
  console.log('\n== 人机同步：直接执行的动作也要有 Agent 通路 ==')
  {
    const read = (await import('node:fs')).readFileSync
    const routesSource = read('src/routes.ts', 'utf-8')
    const toolsSource = read('src/tools.ts', 'utf-8')

    // CONVENTIONS 8.2. A panel button that advances the pipeline must reach the
    // same host function the agent's tool reaches -- not a second copy of it.
    // Two copies means the governance holds on one path and is skipped on the
    // other, silently: the render still produces a film, the write still
    // produces a checkpoint, and nothing says which checks were missed.
    //
    // A full-auto run has no button to press, so every one of these needs the
    // tool side to exist at all. Add a row when a new direct action lands.
    const shared = [
      { action: '合成', call: 'composeProject(runtime', tool: 'studio_compose' },
      { action: '过闸 / 提交产物', call: 'machine.write({', tool: 'studio_stage' },
      { action: '导入素材', call: 'importAssets(layout', tool: 'studio_project' },
    ]
    const broken = []
    for (const entry of shared) {
      // The CALL, not the name: an aliased import leaves the name in the file
      // and satisfies a bare search while the two paths have already parted.
      if (!routesSource.includes(entry.call)) broken.push(entry.action + ': the route no longer calls ' + entry.call)
      if (!toolsSource.includes(entry.call)) broken.push(entry.action + ': the tool no longer calls ' + entry.call)
      if (!toolsSource.includes("'" + entry.tool + "'")) broken.push(entry.action + ': ' + entry.tool + ' is gone')
    }
    // And the route must not be able to reach the underlying renderer at all.
    // Sharing the function is the point; a second call site next to it would
    // be a second implementation with none of the checks.
    if (routesSource.includes('renderProject(')) {
      broken.push('合成: the route reaches renderProject directly, past every check in composeProject')
    }
    if (broken.length === 0)
      ok('all ' + shared.length + ' direct actions share one function with their tool')
    else bad('panel and agent diverged', broken.join('; '))

    // The other half of the same rule: a step that needs the model to JUDGE or
    // GENERATE goes to the agent, and the craft knowledge rides a skill gesture
    // rather than being inlined. Inlined, it would either be resident context
    // forever or quietly drift from the skill it was copied out of.
    const withSkill = [
      { screen: 'script-screen', skill: 'dsh-creative-studio-storytelling' },
      { screen: 'audio-screen', skill: 'dsh-creative-studio-cinematography' },
      { screen: 'timeline-screen', skill: 'dsh-creative-studio-sound-design', constant: 'MUSIC_SKILL' },
    ]
    const missing = withSkill.filter((entry) => {
      const source = read('src/client/' + entry.screen + '.tsx', 'utf-8')
      // The QUOTED gesture, not the bare name: every one of these screens also
      // names its skill in a comment explaining why the gesture is there, and a
      // whole-file search would call a deleted gesture present.
      const sent = source.includes("'/" + entry.skill + "'")
      // ...or the constant a job builder exports for the same string.
      const viaConstant = entry.constant !== undefined && source.includes(entry.constant)
      return !sent && !viaConstant
    })
    if (missing.length === 0)
      ok('every generative handoff loads its craft skill instead of inlining it')
    else bad('handoff without a skill', missing.map((entry) => entry.screen).join(', '))
  }
  console.log('\n== 后台合成（不经过 Agent） ==')
  {
    const { apply: applyRender, Config: RenderConfig } = await import('../lib/index.js')
    const host = fakeHost()
    applyRender(host.ctx, RenderConfig({
      workspaceRoot: WS,
      video: { width: 480, height: 270, fps: 12, preset: 'ultrafast' },
    }))
    const routes = host.routes

    // Its own project: the shared one has had its script rewritten by now, so
    // its asset stages are invalidated -- which is a fine thing to assert
    // against but not a thing to render from.
    const id = 'render-route'
    await machine.initProject({ id, title: '后台合成', targetDurationSeconds: 30 })
    const layout = machine.layout(id)
    await makeMedia(layout)

    const poll = async () => {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150))
        const status = (await callRoute(routes, '/studio/compose',
          '/studio/compose?project=' + id, {})).json()
        if (status.state !== 'running') return status
      }
      return { state: 'timeout' }
    }
    const start = (body) => callRoute(routes, '/studio/compose', '/studio/compose', {
      method: 'POST', body: { project: id, ...body },
    })

    // GOVERNANCE FIRST. The panel may advance the pipeline; it may not reach
    // past the checks while doing it. A render before the assets are recorded
    // has to fail the same way the tool's would.
    //
    // The brief and script go in BEFORE this attempt on purpose. Without them
    // the render fails anyway -- on a missing artifact, with the same
    // PREREQUISITE_VIOLATION code -- so the test would pass with the stage
    // check deleted. Leaving only the asset stages missing makes that check the
    // one thing standing in the way, and the message names which stage.
    await machine.write({ projectId: id, stage: 'brief', status: 'completed', artifacts: { brief }, humanApproved: true })
    await machine.write({ projectId: id, stage: 'script', status: 'completed', artifacts: { script: script() }, humanApproved: true })

    await start({})
    const tooEarly = await poll()
    if (tooEarly.state === 'failed' && tooEarly.code === 'PREREQUISITE_VIOLATION'
      && String(tooEarly.error).includes('assets_audio'))
      ok('rendering before the assets are recorded is refused, and says which stage')
    else bad('prerequisites skipped', JSON.stringify(tooEarly).slice(0, 200))

    await machine.write({ projectId: id, stage: 'assets_audio', status: 'completed', artifacts: { asset_manifest_audio: audioManifest() }, humanApproved: true })
    await machine.write({ projectId: id, stage: 'assets_shots', status: 'completed', artifacts: { asset_manifest_shots: videoManifest() }, humanApproved: true })

    // The whole point: pressing 合成 produces a film without a model in the
    // loop, and RECORDS it through the state machine rather than writing the
    // checkpoint itself.
    const accepted = await start({})
    if (accepted.statusCode === 202) ok('POST returns as soon as the render is running')
    else bad('compose start', accepted.statusCode + ' ' + accepted.text().slice(0, 200))

    // Poll while it runs, so the page has something to draw. Captured here
    // because by the time the job says 'done' the progress is over.
    const seen = []
    const done = await (async () => {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 60))
        const status = (await callRoute(routes, '/studio/compose',
          '/studio/compose?project=' + id, {})).json()
        if (status.state === 'running') seen.push(status)
        else return status
      }
      return { state: 'timeout' }
    })()
    if (done.state === 'done') ok('the render finished with no agent involved')
    else bad('render failed', JSON.stringify(done).slice(0, 300))

    // What the bar is drawn from has to survive the trip through the route,
    // not just exist inside the composer.
    const withBar = seen.filter((status) => typeof status.fraction === 'number')
    if (withBar.length > 0 && withBar.some((status) => status.fraction > 0))
      ok('the route reports a moving progress fraction while it runs')
    else bad('no progress over the wire', JSON.stringify(seen.slice(0, 3)))
    if (seen.some((status) => typeof status.elapsed_seconds === 'number'))
      ok('and how long it has been going')
    else bad('no elapsed time', JSON.stringify(seen[0]))
    const labels = seen.map((status) => status.progress).filter(Boolean)
    if (labels.length > 0 && labels.every((label) => /[一-龥]/.test(label)))
      ok('the labels reaching the page are the readable ones')
    else bad('raw labels over the wire', labels.join(' | '))

    if (done.state === 'done') {
      const checkpoint = await machine.readCheckpoint(layout, 'compose')
      if (checkpoint?.status === 'completed')
        ok('the report is recorded through the state machine, not written past it')
      else bad('not recorded', JSON.stringify(checkpoint?.status))
      // Recorded via machine.write means the asset check ran: a report naming a
      // file that does not exist would have thrown rather than been stored.
      const report = await machine.readArtifact(layout, 'render_report')
      if (report?.outputs?.[0]?.path !== undefined) ok('and the stored report names the file it made')
      else bad('no report', JSON.stringify(report))
      // 1920x1080 rather than the 480x270 in this host's config, because the
      // brief declares bilibili and a named platform decides the frame. That is
      // the tool's rule, and seeing it here is how we know the route runs the
      // same resolution rather than a second copy of it.
      if (report?.outputs?.[0]?.resolution === '1920x1080')
        ok('the platform on the brief decides the frame, on this path too')
      else bad('frame', JSON.stringify(report?.outputs?.[0]?.resolution))
      const said = done.result?.warnings?.some((line) => line.includes('target_platform'))
      if (said === true) ok('and the render says which frame it used rather than leaving it silent')
      else bad('frame not reported', JSON.stringify(done.result?.warnings))
    }

    // THE BUG THIS FOUND. `studio_compose` had no cut parameter, so the panel's
    // message named a version the model could not pass on -- every render was
    // of the plan, and the output was still a film, so nothing caught it.
    const cutId = 'cut-route'
    // A cut is a set of PER-SECTION OVERRIDES, not a selection of sections:
    // leaving s2 out would just mean "nothing overridden for s2" and would
    // render an identical film. A lead-in long enough to move the total is what
    // makes "did the cut reach the renderer" answerable from the output.
    await writeCut(layout, parseCut({
      id: cutId,
      name: '开头留白',
      sections: [{ id: 's1', lead: 3 }, { id: 's2' }, { id: 's3' }],
    }))
    const cutStart = await start({ cut: cutId })
    if (cutStart.statusCode === 202) {
      const cutDone = await poll()
      // Asserting on result.cut alone would only prove the request echoed back
      // what it was sent -- it is set from the id whether or not the cut ever
      // reached the renderer, which is exactly how the original bug hid. The
      // duration is the output, and it has to have moved.
      const planned = done.result?.report?.outputs?.[0]?.duration_seconds
      const edited = cutDone.result?.report?.outputs?.[0]?.duration_seconds
      if (cutDone.state === 'done' && edited !== undefined && planned !== undefined
        && edited > planned + 1)
        ok('a selected version is the version that gets rendered ('
          + edited.toFixed(1) + 's against the plan at ' + planned.toFixed(1) + 's)')
      else bad('cut ignored', JSON.stringify([planned, edited]))
      // Its own file, so two versions can be compared rather than one
      // overwriting the other.
      const stored = await machine.readArtifact(layout, 'render_report')
      if (stored?.outputs?.[0]?.path?.includes(cutId))
        ok('and it renders to its own file rather than over the plan')
      else bad('cut output path', JSON.stringify(stored?.outputs?.[0]?.path))
    } else bad('cut render', cutStart.statusCode + ' ' + cutStart.text().slice(0, 200))

    const missing = await start({ cut: 'cut-not-real' })
    const missingDone = missing.statusCode === 202 ? await poll() : { state: 'rejected' }
    if (missingDone.state === 'failed' && String(missingDone.error).includes('cut-not-real'))
      ok('a version that does not exist fails by name')
    else bad('unknown cut', JSON.stringify(missingDone).slice(0, 200))

    // Two encodes at once write the same work directory and the same output
    // file: the loser would corrupt the winner's film rather than merely waste
    // a CPU. The second press has to be refused, not queued behind the first.
    const first = await start({})
    const second = await start({})
    if (first.statusCode === 202 && second.statusCode === 409 && second.json().code === 'ALREADY_RENDERING')
      ok('a second render of the same project is refused while one is running')
    else bad('concurrent renders', first.statusCode + ' then ' + second.statusCode)
    await poll()

    const blank = await callRoute(routes, '/studio/compose', '/studio/compose', {
      method: 'POST', body: {},
    })
    if (blank.statusCode === 400) ok('the route needs a project')
    else bad('blank project', String(blank.statusCode))

    // The page draws a bar, not just a spinner: minutes of silence and a
    // spinning circle are indistinguishable from a stuck render.
    const timelineSource = (await import('node:fs')).readFileSync('src/client/timeline-screen.tsx', 'utf-8')
    if (timelineSource.includes('dcs-render-fill') && timelineSource.includes("role=\"progressbar\""))
      ok('the compose screen draws a progress bar while rendering')
    else bad('no bar', 'a long render shows only a spinner')

    // The panel drives this route rather than composing a message about it.
    const screen = (await import('node:fs')).readFileSync('src/client/timeline-screen.tsx', 'utf-8')
    // Scoped to the function, not the file: the surrounding comments name the
    // tool on purpose, and a whole-file search would call that a regression.
    const composeFrom = screen.indexOf('async function compose(): Promise<void> {')
    const composeBody = composeFrom === -1
      ? ''
      : screen.slice(composeFrom, screen.indexOf(String.fromCharCode(10) + '  }', composeFrom))
    if (composeBody.includes('api.startCompose(') && !composeBody.includes('onSend('))
      ok('the compose button renders directly instead of asking the agent to')
    else bad('still via the agent', 'the panel composes a studio_compose request')
    // And it passes the version the user is looking at -- the thing the prose
    // route could not carry.
    if (screen.includes('cut: cut.id')) ok('and it sends the selected version with it')
    else bad('cut not sent', 'the panel renders the plan whatever is selected')
    // The tool keeps its place: a fully automatic run has no button to press.
    const toolSource = (await import('node:fs')).readFileSync('src/tools.ts', 'utf-8')
    if (toolSource.includes("name: 'studio_compose'") && toolSource.includes('composeProject(runtime'))
      ok('the tool stays, and goes through the same function the route does')
    else bad('tool path diverged', 'the agent and the panel no longer share a compose')

    host.disposeAll()
  }
  console.log('\n== routes ==')
  {
    const { apply: applyPlugin, Config: RouteConfig } = await import('../lib/index.js')
    const host = fakeHost()
    applyPlugin(host.ctx, RouteConfig({ workspaceRoot: WS }))
    const routes = host.routes

    const expected = ['/studio/catalog', '/studio/state', '/studio/media', '/studio/library',
      '/studio/project', '/studio/project/remove', '/studio/trash', '/studio/trash/restore',
      '/studio/trash/purge', '/studio/import', '/studio/asset/trim', '/studio/validate', '/studio/stage',
      '/studio/compose', '/studio/skill']
    const mounted = expected.filter((path) => routes.has(path))
    if (mounted.length === expected.length) ok(expected.length + ' routes mounted')
    else bad('route mounting', 'only ' + JSON.stringify(mounted))

    const catalog = await callRoute(routes, '/studio/catalog', '/studio/catalog')
    if (catalog.statusCode === 200) {
      const doc = catalog.json()
      const first = doc.pipelines?.[0]
      if (first?.stages?.length === 5 && first.command?.startsWith('/'))
        ok('catalog offers ' + doc.pipelines.length + ' pipeline(s), ' + first.stages.length + ' stages, command ' + first.command)
      else bad('catalog pipelines', JSON.stringify(first))
      const screens = (first?.stages ?? []).map((stage) => stage.screen)
      if (screens.join(',') === 'project,script,assets-audio,assets-shots,timeline')
        ok('pipeline maps every stage to a screen')
      else bad('pipeline screens', screens.join(','))
      if (doc.styles?.length >= 3) ok('catalog lists ' + doc.styles.length + ' styles')
      else bad('catalog styles', JSON.stringify(doc.styles?.length))
      // The project screen previews a style before saving it, so every option
      // has to carry its whole playbook — a summary would lag the dropdown.
      const withPlaybooks = (doc.styles ?? []).filter((style) => style.playbook?.visual?.negative_prompt)
      if (withPlaybooks.length === doc.styles.length)
        ok('every style option carries its full playbook')
      else bad('style playbooks', withPlaybooks.length + '/' + doc.styles.length)
    } else bad('GET /studio/catalog', String(catalog.statusCode))

    const state = await callRoute(routes, '/studio/state', '/studio/state?project=smoke')
    let body
    if (state.statusCode === 200) {
      body = state.json()
      if (body.stages?.length === 5) ok('state returns all five stages')
      else bad('state stages', JSON.stringify(body.stages?.length))
      if (body.artifacts?.script && body.artifacts?.asset_manifest_audio) ok('state inlines the artifacts the panel renders')
      else bad('state artifacts', JSON.stringify(Object.keys(body.artifacts ?? {})))
      if (body.style?.playbook?.name) ok('state resolves the style playbook (' + body.style.playbook.name + ')')
      else bad('state style', JSON.stringify(body.style))
      if (body.film?.url?.startsWith('/studio/media?')) ok('state hands back a playable film URL')
      else bad('state film', JSON.stringify(body.film))
      // Artifacts are served verbatim: the panel builds media URLs itself from
      // the project id and the asset path, so nothing has to be added here — and
      // anything added would come back on the next submit as an unknown field.
      const first = body.artifacts.asset_manifest_audio.assets[0]
      if (first !== undefined && !('url' in first)) ok('served artifacts carry no display-only fields')
      else bad('artifact purity', JSON.stringify(first))
    } else bad('GET /studio/state', state.statusCode + ' ' + state.text().slice(0, 200))

    if (state.statusCode === 200) {
      const doc = state.json()
      if (doc.pipeline?.definition?.stages?.length === 5) ok('state resolves the project pipeline')
      else bad('state pipeline', JSON.stringify(doc.pipeline?.id))
      if (doc.style?.options?.length >= 3) ok('state offers the style list the project screen picks from')
      else bad('state style options', JSON.stringify(doc.style?.options?.length))
    }

    const patched = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST',
      body: { project: 'smoke', title: '改过的标题', target_duration_seconds: 45, style: 'warm-doc' },
    })
    if (patched.statusCode === 200) {
      const marker = patched.json().project
      if (marker.title === '改过的标题' && marker.target_duration_seconds === 45 && marker.style === 'warm-doc')
        ok('project route patches title, duration and style')
      else bad('project patch', JSON.stringify(marker))
    } else bad('POST /studio/project', patched.statusCode + ' ' + patched.text().slice(0, 160))

    // References are project-level and stored as ComfyUI's own file names —
    // the model puts them straight into a loader node, so a path or a URL here
    // would be the one thing that node cannot use.
    const withRefs = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST',
      body: { project: 'smoke', references: ['ref_a.png', '  ', 'ref_b.png'] },
    })
    if (withRefs.statusCode === 200) {
      const stored = withRefs.json().project.references
      if (JSON.stringify(stored) === JSON.stringify(['ref_a.png', 'ref_b.png']))
        ok('project references persist, blanks dropped')
      else bad('references', JSON.stringify(stored))
    } else bad('POST references', String(withRefs.statusCode))

    // A shot plan exists before any picture does. It cannot live in the shots
    // manifest — that records produced files, and an entry with no file is
    // exactly what the asset checks reject — so a prompt typed for a shot that
    // has not been generated used to be dropped on save without a word.
    const planned = await callRoute(routes, '/studio/scene-plan', '/studio/scene-plan', {
      method: 'POST',
      body: {
        project: 'smoke',
        section: 's1',
        shots: [{ prompt: '  开场空镜  ', weight: 0.4 }, { prompt: '推近', weight: 0.6 }],
      },
    })
    if (planned.statusCode === 200) {
      const shots = planned.json().scene_plan.shots
      if (shots.length === 2 && shots[0].prompt === '开场空镜' && shots[1].weight === 0.6)
        ok('a shot plan survives without any picture existing')
      else bad('scene plan', JSON.stringify(shots))
      if (shots[0].id === 's1-0' && shots[0].section_id === 's1' && shots[1].shot_index === 1)
        ok('shots get stable ids and gapless indices')
      else bad('shot identity', JSON.stringify(shots))
    } else bad('POST scene-plan', planned.statusCode + ' ' + planned.text().slice(0, 160))

    // Shot language is the reason this artifact exists. A screen that has no
    // box for it must not delete it just by saving the fields it does know —
    // this is the contract most likely to be broken by a future edit.
    const withLanguage = await callRoute(routes, '/studio/scene-plan', '/studio/scene-plan', {
      method: 'POST',
      body: {
        project: 'smoke',
        section: 's1',
        shots: [
          { prompt: '开场空镜', shot_language: { shot_size: 'establishing', lens_mm: 24 } },
          { prompt: '推近' },
        ],
      },
    })
    if (withLanguage.statusCode === 200) ok('a shot accepts structured shot language')
    else bad('shot language write', withLanguage.statusCode + ' ' + withLanguage.text().slice(0, 200))

    const reSaved = await callRoute(routes, '/studio/scene-plan', '/studio/scene-plan', {
      method: 'POST',
      body: {
        project: 'smoke',
        section: 's1',
        shots: [{ prompt: '开场空镜', weight: 1 }, { prompt: '推近' }],
      },
    })
    if (reSaved.statusCode === 200) {
      const kept = reSaved.json().scene_plan.shots.find((shot) => shot.shot_index === 0)
      if (kept?.shot_language?.shot_size === 'establishing' && kept.shot_language.lens_mm === 24)
        ok('saving without shot_language keeps the shot_language already stored')
      else bad('merge lost shot language', JSON.stringify(kept))
    } else bad('scene plan re-save', String(reSaved.statusCode))

    // EVERY optional field has to survive the round trip. A field the merge
    // does not know about is silently dropped: the panel sends it, the route
    // ignores it, and the control looks broken with nothing logged anywhere.
    // hero_moment was exactly that -- the star button did nothing and every
    // test still passed, because no test sent one.
    const allFields = {
      prompt: '全字段',
      weight: 2,
      shot_language: { shot_size: 'close_up', lens_mm: 85 },
      texture_keywords: ['磨砂金属'],
      reference_names: ['ref.png'],
      hero_moment: true,
    }
    const roundTrip = await callRoute(routes, '/studio/scene-plan', '/studio/scene-plan', {
      method: 'POST',
      body: { project: 'smoke', section: 's2', shots: [allFields] },
    })
    if (roundTrip.statusCode === 200) {
      const saved = roundTrip.json().scene_plan.shots.find((shot) => shot.section_id === 's2')
      const lost = Object.keys(allFields).filter((key) => JSON.stringify(saved?.[key]) !== JSON.stringify(allFields[key]))
      if (lost.length === 0) ok('every optional shot field survives a save  (' + Object.keys(allFields).length + ')')
      else bad('fields dropped by the merge', JSON.stringify(lost) + ' got ' + JSON.stringify(saved))
    } else bad('all-fields save', roundTrip.statusCode + ' ' + roundTrip.text().slice(0, 160))

    // And each has to be clearable again, or a control can be switched on but
    // never off.
    const cleared = await callRoute(routes, '/studio/scene-plan', '/studio/scene-plan', {
      method: 'POST',
      body: {
        project: 'smoke',
        section: 's2',
        shots: [{ prompt: '全字段', hero_moment: false, texture_keywords: null, reference_names: null }],
      },
    })
    if (cleared.statusCode === 200) {
      const saved = cleared.json().scene_plan.shots.find((shot) => shot.section_id === 's2')
      const stuck = ['hero_moment', 'texture_keywords', 'reference_names'].filter((key) => saved?.[key] !== undefined)
      if (stuck.length === 0) ok('a field switched on can be switched off again')
      else bad('fields stuck on', JSON.stringify(stuck))
      if (saved?.shot_language?.shot_size === 'close_up')
        ok('and clearing one field leaves the unmentioned ones alone')
      else bad('clearing was too broad', JSON.stringify(saved))
    } else bad('clear save', String(cleared.statusCode))

    // An enum outside the vocabulary is a typo, and a typo that reaches a
    // prompt builder produces a silently worse picture.
    const badLanguage = await callRoute(routes, '/studio/scene-plan', '/studio/scene-plan', {
      method: 'POST',
      body: {
        project: 'smoke',
        section: 's1',
        shots: [{ shot_language: { shot_size: 'gigantic' } }],
      },
    })
    if (badLanguage.statusCode === 400 || badLanguage.statusCode === 409)
      ok('an unknown shot_size is refused  -> ' + badLanguage.json().code)
    else bad('shot language guard', badLanguage.statusCode + ' ' + badLanguage.text().slice(0, 160))

    // THE MODEL has to see the variation report too. It cannot call an HTTP
    // route, so /studio/state is the panel's channel only -- without this the
    // check did not exist for the model, which would first learn of a
    // repetitive plan when compose refused, after paying for every picture.
    {
      const stageTools = new Map()
      const { registerStudioTools: regStage } = await import('../lib/tools.js')
      regStage(
        { tools: { register: (definition) => { stageTools.set(definition.name, definition); return () => {} } } },
        { machine, getConfig: () => config },
      )
      const stageTool = stageTools.get('studio_stage')
      const smoke = machine.layout('smoke')
      // studio_stage enforces pipeline order, and earlier tests left the chain
      // partly invalidated. Re-recorded from the artifacts already on disk.
      for (const [stage, name] of [
        ['brief', 'brief'],
        ['script', 'script'],
        ['assets_audio', 'asset_manifest_audio'],
      ]) {
        await machine.write({
          projectId: 'smoke', stage, status: 'completed',
          artifacts: { [name]: await machine.readArtifact(smoke, name) },
          humanApproved: true,
        })
      }
      const script = await machine.readArtifact(smoke, 'script')
      const repetitive = {
        version: '1.0',
        shots: script.sections.map((section, index) => ({
          id: 'rep-' + index, section_id: section.id, shot_index: 0, prompt: 'a modern office',
        })),
      }
      const answer = await stageTool.execute({
        project: 'smoke', stage: 'assets_shots', status: 'in_progress',
        artifacts: { scene_plan: repetitive },
      }, { signal: new AbortController().signal })

      if (answer.variation !== undefined && answer.variation.violations.length > 0)
        ok('studio_stage hands the model its variation report  -> ' + answer.variation.score)
      else bad('model cannot see variation', JSON.stringify(answer.variation))

      if (answer.variation?.violations.some((entry) => entry.code === 'duplicate-subject'))
        ok('and it names the duplicated subjects')
      else bad('duplicate not reported', JSON.stringify(answer.variation?.violations))

      // The rendered text is what the model actually reads.
      const shown = stageTool.output.render({}, answer).map((block) => block.text).join('')
      if (shown.includes('分镜重复度')) ok('the report is in the text the model reads, not only the payload')
      else bad('report not rendered', shown.slice(-200))

      // A stage write with no plan must not carry an empty report.
      const plain = await stageTool.execute({
        project: 'smoke', stage: 'assets_shots', status: 'in_progress', artifacts: {},
      }, { signal: new AbortController().signal })
      if (plain.variation === undefined) ok('a write with no scene_plan carries no report')
      else bad('spurious report', JSON.stringify(plain.variation))

      // And the model can read the plan back at all, which it could not before.
      const projectTool = stageTools.get('studio_project')
      const artifactEnum = projectTool.parameters.properties.artifact.enum
      if (artifactEnum.includes('scene_plan')) ok('studio_project can read scene_plan back')
      else bad('scene_plan unreadable', JSON.stringify(artifactEnum))

      // This block wrote a deliberately repetitive plan through the real tool,
      // which persists it. Put the section plan the later route tests assert on
      // back, or they read this one instead.
      await machine.writePlan('smoke', 'scene_plan', {
        version: '1.0',
        shots: [
          { id: 's1-0', section_id: 's1', shot_index: 0, prompt: '开场空镜', weight: 1,
            shot_language: { shot_size: 'establishing', lens_mm: 24 } },
          { id: 's1-1', section_id: 's1', shot_index: 1, prompt: '推近' },
        ],
      })
    }

    // A normal run never opens the shot editor, so no scene_plan is saved.
    // Gating the five-layer prompts and both checks on a STORED plan meant all
    // three quietly did nothing on exactly the common path -- the generation
    // request went out with bare prompts and no layers at all.
    {
      const smokeLayout = machine.layout('smoke')
      const stored = await machine.readArtifact(smokeLayout, 'scene_plan')
      await fs.rm(join(smokeLayout.artifactsDir, 'scene_plan.json'), { force: true })

      const bare = await callRoute(routes, '/studio/state', '/studio/state?project=smoke')
      const payload = bare.json()
      const covered = new Set(payload.prompts.map((entry) => entry.sectionId))
      const sections = new Set(payload.timeline.map((entry) => entry.sectionId))
      if (payload.prompts.length > 0 && covered.size === sections.size)
        ok('with no saved plan, every section still gets a built prompt  (' + payload.prompts.length + ')')
      else bad('derived plan misses sections', 'covered ' + [...covered] + ' of ' + [...sections])

      // And the layers have to be there, not just the bare subject.
      const first = payload.prompts[0]
      if (first !== undefined && first.layers.length >= 3 && first.prompt.includes('.'))
        ok('the derived prompt is layered, not a bare subject')
      else bad('no layers without a stored plan', JSON.stringify(first))

      // The subject the script wrote must survive into the prompt.
      const scriptVisual = (payload.artifacts.script.sections[0].visual ?? {}).prompt
      if (scriptVisual === undefined || first.prompt.includes(scriptVisual))
        ok('the script visual reaches the built prompt')
      else bad('subject lost', scriptVisual + ' not in ' + first.prompt)

      // And the checks engage rather than reporting null.
      if (payload.variation !== null && payload.slideshow !== null)
        ok('both checks run without a stored plan')
      else bad('checks off', 'variation ' + payload.variation + ' slideshow ' + payload.slideshow)

      if (stored !== undefined) await machine.writePlan('smoke', 'scene_plan', stored)
    }

    // The plan reaches the panel as the shape the shots screen reads.
    const planState = await callRoute(routes, '/studio/state', '/studio/state?project=smoke')
    if (planState.statusCode === 200) {
      const view = planState.json().project.shot_plan
      if (view?.s1?.length === 2 && view.s1[0].prompt === '开场空镜')
        ok('state serves the plan as the shot_plan view')
      else bad('shot_plan view', JSON.stringify(view))
      const artifact = planState.json().artifacts.scene_plan
      if (artifact?.shots?.length === 2) ok('state also carries the scene_plan artifact itself')
      else bad('scene_plan artifact in state', JSON.stringify(artifact))
    } else bad('state after plan', String(planState.statusCode))

    // writePlan is not a back door: manifests still have to go through a gate.
    let refusedPlanWrite = false
    await machine.writePlan('smoke', 'asset_manifest_shots', { version: '1.0', assets: [] })
      .catch((error) => { refusedPlanWrite = error.code === 'BAD_REQUEST' })
    if (refusedPlanWrite) ok('writePlan refuses a gated artifact')
    else bad('writePlan guard', 'a manifest was written without a gate')

    // Reference audio takes the same road as reference images: a list of names
    // in ComfyUI's input directory, stored on the marker, read back by the
    // voice screen. Blank and non-string entries are dropped at the route --
    // an empty name would reach a loader node as a request for a file called "".
    const refsSaved = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST',
      body: { project: 'smoke', voice_references: ['clone-a.wav', '  clone-b.flac  ', '', 7] },
    })
    const savedRefs = refsSaved.json().project?.voice_references
    if (refsSaved.statusCode === 200
      && Array.isArray(savedRefs) && savedRefs.length === 2
      && savedRefs[0] === 'clone-a.wav' && savedRefs[1] === 'clone-b.flac')
      ok('reference audio names round-trip through the marker, trimmed and filtered')
    else bad('voice_references save', refsSaved.statusCode + ' ' + JSON.stringify(savedRefs))

    // A save that does not mention them must not clear them. The panel writes
    // one field at a time, so a patch that overwrote absent fields would drop
    // the clips the moment anyone renamed the project.
    await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST', body: { project: 'smoke', title: '改过的标题' },
    })
    const afterOther = await callRoute(routes, '/studio/state', '/studio/state?project=smoke', {})
    if (afterOther.json().project?.voice_references?.length === 2)
      ok('an unrelated project save leaves the reference audio alone')
    else bad('references clobbered', JSON.stringify(afterOther.json().project?.voice_references))

    // The music field is MERGED, not replaced. The panel saves the workflow
    // name long before a file exists, and the agent's import writes the path
    // without knowing what was typed -- a whole-object patch would make each
    // of those erase the other.
    const wf = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST', body: { project: 'smoke', music: { workflow: 'Alpha-Music' } },
    })
    const bedSave = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST', body: { project: 'smoke', music: { path: 'assets/audio/music.wav' } },
    })
    const both = bedSave.json().project?.music
    if (wf.statusCode === 200 && both?.workflow === 'Alpha-Music' && both?.path === 'assets/audio/music.wav')
      ok('saving the bed path keeps the workflow name, and the other way round')
    else bad('music merge', JSON.stringify(both))

    // Clearing the path must be possible without forgetting the workflow --
    // that is the 去掉 button, and it should not cost the next film its setting.
    const clearedBed = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST', body: { project: 'smoke', music: { path: '' } },
    })
    const afterClear = clearedBed.json().project?.music
    if (afterClear?.path === '' && afterClear?.workflow === 'Alpha-Music')
      ok('dropping the bed from the film keeps the workflow for the next one')
    else bad('music clear', JSON.stringify(afterClear))

    // The mix settings clamp at the route too, so a hand-written request cannot
    // store a level the render would then have to defend against.
    const loud = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST', body: { project: 'smoke', music: { gain_db: 99, fade_in: -5, fade_out: 500 } },
    })
    const stored = loud.json().project?.music
    if (stored?.gain_db === -6 && stored?.fade_in === 0 && stored?.fade_out === 20)
      ok('out-of-range mix settings are clamped before they are stored')
    else bad('route clamp', JSON.stringify(stored))
    // And a partial save leaves the others alone -- the save button sends only
    // the fields that parsed, so a cleared box must not mean zero.
    const partial = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST', body: { project: 'smoke', music: { gain_db: -18 } },
    })
    const afterPartial = partial.json().project?.music
    if (afterPartial?.gain_db === -18 && afterPartial?.fade_out === 20
      && afterPartial?.workflow === 'Alpha-Music')
      ok('saving one mix field keeps the others and the workflow name')
    else bad('partial music save', JSON.stringify(afterPartial))

    // A stored path is a path compose will resolve inside the project. An
    // absolute one or a `..` segment reaching the marker would be an escape
    // route saved to disk, and compose would report it as a missing file
    // rather than as what it is.
    const escapes = []
    for (const attempt of ['/etc/passwd', 'C:/windows/x.wav', '../../out.wav', 'a/../../b.wav']) {
      const sent = await callRoute(routes, '/studio/project', '/studio/project', {
        method: 'POST', body: { project: 'smoke', music: { path: attempt } },
      })
      if (sent.statusCode !== 400) escapes.push(attempt + ' -> ' + sent.statusCode)
    }
    if (escapes.length === 0) ok('an absolute or climbing music path is refused at the route')
    else bad('music path escape', escapes.join('; '))
    // And the refusal must not have taken the good value with it.
    const stillThere = await callRoute(routes, '/studio/state', '/studio/state?project=smoke', {})
    if (stillThere.json().project?.music?.workflow === 'Alpha-Music')
      ok('a refused path leaves the stored music untouched')
    else bad('refusal clobbered', JSON.stringify(stillThere.json().project?.music))

    const platformSaved = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST', body: { project: 'smoke', target_platform: 'douyin' },
    })
    if (platformSaved.statusCode === 200 && platformSaved.json().project.target_platform === 'douyin')
      ok('the project screen can set the target platform')
    else bad('platform save', platformSaved.statusCode + ' ' + platformSaved.text().slice(0, 160))

    // The frame is decided from this value, so a typo must not reach the marker.
    const badPlatform = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST', body: { project: 'smoke', target_platform: 'myspace' },
    })
    if (badPlatform.statusCode === 400) ok('an unknown platform is refused at the route')
    else bad('platform guard', String(badPlatform.statusCode))

    const badDuration = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST', body: { project: 'smoke', target_duration_seconds: 99999 },
    })
    if (badDuration.statusCode === 400) ok('project route rejects an out-of-range duration')
    else bad('project duration guard', String(badDuration.statusCode))

    const noop = await callRoute(routes, '/studio/project', '/studio/project', {
      method: 'POST', body: { project: 'smoke' },
    })
    if (noop.statusCode === 400) ok('project route rejects an empty patch')
    else bad('project empty patch', String(noop.statusCode))

    // Removal trashes rather than deletes: a project holds a rendered film and
    // a batch of generated assets, and the listing must lose it while the
    // bytes survive.
    await machine.initProject({ id: 'throwaway', title: '待移除', targetDurationSeconds: 20 })
    const removed = await callRoute(routes, '/studio/project/remove', '/studio/project/remove', {
      method: 'POST', body: { project: 'throwaway' },
    })
    if (removed.statusCode === 200 && removed.json().trashed_to.includes('.trash')) {
      ok('remove moves the project into .trash')
      const stillThere = await fs.stat(removed.json().trashed_to).then(() => true, () => false)
      if (stillThere) ok('the trashed project still exists on disk')
      else bad('trash', 'the directory is gone, not trashed')
      const after = await machine.listProjects()
      if (!after.some((entry) => entry.id === 'throwaway')) ok('a trashed project drops out of the listing')
      else bad('trash listing', 'still listed')
    } else bad('POST /studio/project/remove', removed.statusCode + ' ' + removed.text().slice(0, 140))

    const removeMissing = await callRoute(routes, '/studio/project/remove', '/studio/project/remove', {
      method: 'POST', body: { project: 'no-such-project' },
    })
    if (removeMissing.statusCode === 404) ok('removing an unknown project is 404')
    else bad('remove 404', String(removeMissing.statusCode))

    // The trash closes the loop: what 移除 put away must be listable, and both
    // reversible and irreversible exits have to work.
    const listed = await callRoute(routes, '/studio/trash', '/studio/trash')
    const trashed = listed.statusCode === 200 ? listed.json().entries : []
    const mine = trashed.find((item) => item.id === 'throwaway')
    if (mine !== undefined && mine.title === '待移除' && typeof mine.bytes === 'number')
      ok('trash lists the removed project with its title and size')
    else bad('GET /studio/trash', JSON.stringify(trashed).slice(0, 160))

    const restored = await callRoute(routes, '/studio/trash/restore', '/studio/trash/restore', {
      method: 'POST', body: { entry: mine.entry },
    })
    if (restored.statusCode === 200 && restored.json().id === 'throwaway') {
      const back = await machine.listProjects()
      if (back.some((entry) => entry.id === 'throwaway')) ok('restore puts the project back in the listing')
      else bad('restore', 'not listed after restore')
    } else bad('POST /studio/trash/restore', restored.statusCode + ' ' + restored.text().slice(0, 140))

    // Restoring onto a live id must refuse rather than quietly rename.
    await callRoute(routes, '/studio/project/remove', '/studio/project/remove', {
      method: 'POST', body: { project: 'throwaway' },
    })
    await machine.initProject({ id: 'throwaway', title: '同名新项目', targetDurationSeconds: 20 })
    const again = await callRoute(routes, '/studio/trash', '/studio/trash')
    const blocked = again.json().entries.find((item) => item.id === 'throwaway')
    const collision = await callRoute(routes, '/studio/trash/restore', '/studio/trash/restore', {
      method: 'POST', body: { entry: blocked.entry },
    })
    if (collision.statusCode === 409 || collision.statusCode === 400) ok('restoring onto a live id refuses')
    else bad('restore collision', String(collision.statusCode))

    const purged = await callRoute(routes, '/studio/trash/purge', '/studio/trash/purge', {
      method: 'POST', body: { entry: blocked.entry },
    })
    if (purged.statusCode === 200) {
      const gone = await fs.stat(join(WS, '.trash', blocked.entry)).then(() => true, () => false)
      if (!gone) ok('purge deletes the trashed project for real')
      else bad('purge', 'directory survived')
    } else bad('POST /studio/trash/purge', String(purged.statusCode))

    const escape = await callRoute(routes, '/studio/trash/purge', '/studio/trash/purge', {
      method: 'POST', body: { entry: '../smoke' },
    })
    if (escape.statusCode === 400) ok('a trash entry name escaping the trash is refused')
    else bad('trash traversal', String(escape.statusCode))

    // Round-trip contract: what /studio/state hands the panel must be
    // submittable back unchanged. A route that decorates a document it also
    // accepts makes that document impossible to return — which is exactly what
    // an injected `url` field did.
    if (state.statusCode === 200) {
      const served = state.json().artifacts
      let roundTripped = true
      for (const [name, value] of Object.entries(served)) {
        const stage = { brief: 'brief', script: 'script', asset_manifest_audio: 'assets_audio',
          asset_manifest_shots: 'assets_shots', render_report: 'compose' }[name]
        if (stage === undefined) continue
        const back = await callRoute(routes, '/studio/stage', '/studio/stage', {
          method: 'POST',
          body: { project: 'smoke', stage, status: 'completed', human_approved: true, artifacts: { [name]: value } },
        })
        if (back.statusCode !== 200) {
          roundTripped = false
          bad('artifact round-trip', name + ': ' + back.statusCode + ' ' + back.text().slice(0, 200))
        }
      }
      if (roundTripped) ok('every served artifact can be submitted back unchanged')
    }

    // A cut is an override layer, not a copy: it records only what the editor
    // changed, so a re-generated take still flows through instead of stranding
    // the edit.
    const saved = await callRoute(routes, '/studio/cuts', '/studio/cuts', {
      method: 'POST',
      body: {
        project: 'smoke',
        cut: { id: 'cut-a', name: '慢一点', sections: [{ id: 's1', tail: 1.5 }, { id: 'gone', lead: 9 }] },
      },
    })
    if (saved.statusCode === 200) {
      const doc = saved.json().cut
      if (doc.id === 'cut-a' && doc.sections.length === 2 && doc.sections[0].tail === 1.5)
        ok('a cut saves its timing overrides')
      else bad('cut save', JSON.stringify(doc))
    } else bad('POST /studio/cuts', saved.statusCode + ' ' + saved.text().slice(0, 160))

    // An explicit pad must beat the style's minimum-section floor. It did not:
    // setting a pause to zero silently got the floor's padding back, which made
    // the control look broken.
    await callRoute(routes, '/studio/cuts', '/studio/cuts', {
      method: 'POST',
      body: { project: 'smoke', cut: { id: 'cut-tight', name: '零留白', sections: [{ id: 's1', lead: 0, tail: 0 }] } },
    })
    const tight = await callRoute(routes, '/studio/state', '/studio/state?project=smoke&cut=cut-tight')
    if (tight.statusCode === 200) {
      const s1 = tight.json().timeline.find((entry) => entry.sectionId === 's1')
      // s1's narration measures 3.2s; with both pads at zero that is the whole
      // section, floor or no floor.
      if (Math.abs(s1.duration - s1.speechSeconds) < 0.02)
        ok('a pad set to zero is honoured, not floored (' + s1.duration.toFixed(2) + 's)')
      else bad('zero pad', s1.duration + ' vs speech ' + s1.speechSeconds)
    } else bad('state with zero pads', String(tight.statusCode))
    await callRoute(routes, '/studio/cuts/delete', '/studio/cuts/delete', {
      method: 'POST', body: { project: 'smoke', cut: 'cut-tight' },
    })

    // Padding bottoms out at zero; shortening past that means cutting the clip,
    // which is a different act and a different field.
    await callRoute(routes, '/studio/cuts', '/studio/cuts', {
      method: 'POST',
      body: {
        project: 'smoke',
        cut: { id: 'cut-trim', name: '裁一刀', sections: [{ id: 's1', lead: 0, tail: 0, trimStart: 0.5, trimEnd: 0.3 }] },
      },
    })
    const trimmed = await callRoute(routes, '/studio/state', '/studio/state?project=smoke&cut=cut-trim')
    if (trimmed.statusCode === 200) {
      const s1 = trimmed.json().timeline.find((entry) => entry.sectionId === 's1')
      // 3.2s recorded, 0.8s cut away, no padding left.
      if (Math.abs(s1.duration - 2.4) < 0.03) ok('a trim shortens the section past zero padding (' + s1.duration.toFixed(2) + 's)')
      else bad('trim', s1.duration + ' expected ~2.40')
      if (Math.abs(s1.trimStart - 0.5) < 0.001) ok('the trim point reaches the preview')
      else bad('trimStart', String(s1.trimStart))
    } else bad('state with trim', String(trimmed.statusCode))
    await callRoute(routes, '/studio/cuts/delete', '/studio/cuts/delete', {
      method: 'POST', body: { project: 'smoke', cut: 'cut-trim' },
    })

    // A cut stores the subtitle SEGMENTATION, never the times: keeping timing
    // derived is what lets an edited cue survive a pad change or a re-record.
    await callRoute(routes, '/studio/cuts', '/studio/cuts', {
      method: 'POST',
      body: {
        project: 'smoke',
        cut: { id: 'cut-subs', name: '改字幕', sections: [{ id: 's1', cues: ['前半句', '  ', '后半句都在这里'] }] },
      },
    })
    const subs = await callRoute(routes, '/studio/state', '/studio/state?project=smoke&cut=cut-subs')
    if (subs.statusCode === 200) {
      const s1 = subs.json().timeline.find((entry) => entry.sectionId === 's1')
      if (s1.cues.length === 2 && s1.cues[0].text === '前半句') ok('a cut supplies its own cue segmentation')
      else bad('cue override', JSON.stringify(s1.cues))
      // Longer text holds the screen longer, and the pair tiles the speech.
      const span = s1.cues[s1.cues.length - 1].end - s1.cues[0].start
      if (Math.abs(span - s1.speechSeconds) < 0.02 && s1.cues[1].end - s1.cues[1].start > s1.cues[0].end - s1.cues[0].start)
        ok('edited cues still take their timing from the speech window')
      else bad('cue timing', JSON.stringify(s1.cues))
    } else bad('state with cues', String(subs.statusCode))

    // A weight is an explicit share of the same fixed window: one cue can only
    // grow by shrinking its neighbour, so the film's length never moves.
    await callRoute(routes, '/studio/cuts', '/studio/cuts', {
      method: 'POST',
      body: {
        project: 'smoke',
        cut: {
          id: 'cut-subs', name: '改字幕',
          sections: [{ id: 's1', cues: [{ text: '短的', weight: 2.4 }, { text: '长的那一条', weight: 0.8 }] }],
        },
      },
    })
    const weighted = await callRoute(routes, '/studio/state', '/studio/state?project=smoke&cut=cut-subs')
    if (weighted.statusCode === 200) {
      const s1 = weighted.json().timeline.find((entry) => entry.sectionId === 's1')
      const first = s1.cues[0].end - s1.cues[0].start
      const second = s1.cues[1].end - s1.cues[1].start
      // The weights say 3:1 despite the second cue having more characters.
      if (Math.abs(first / second - 3) < 0.05) ok('an explicit cue weight beats the character-count default')
      else bad('cue weight', first.toFixed(2) + ' / ' + second.toFixed(2))
      if (Math.abs((first + second) - s1.speechSeconds) < 0.02)
        ok('weighted cues still tile the speech window exactly')
      else bad('cue tiling', (first + second) + ' vs ' + s1.speechSeconds)
    } else bad('state with cue weights', String(weighted.statusCode))
    await callRoute(routes, '/studio/cuts/delete', '/studio/cuts/delete', {
      method: 'POST', body: { project: 'smoke', cut: 'cut-subs' },
    })

    const withCut = await callRoute(routes, '/studio/state', '/studio/state?project=smoke&cut=cut-a')
    if (withCut.statusCode === 200) {
      const doc = withCut.json()
      const s1 = doc.timeline.find((entry) => entry.sectionId === 's1')
      const plain = state.json().timeline.find((entry) => entry.sectionId === 's1')
      // s1's own tail is the playbook default; the cut lengthens it.
      if (s1 !== undefined && s1.duration > plain.duration)
        ok('the timeline re-plans under a cut (' + plain.duration.toFixed(2) + 's -> ' + s1.duration.toFixed(2) + 's)')
      else bad('cut timeline', JSON.stringify([plain?.duration, s1?.duration]))
      if (doc.cuts?.length === 1) ok('state lists saved cuts')
      else bad('state cuts', JSON.stringify(doc.cuts?.length))
    } else bad('GET state with cut', String(withCut.statusCode))

    // The plan a panel reads has to be the plan for the cut it is editing.
    // Fetching without the id returns the untouched plan, which is how an edit
    // could save correctly and still not show up.
    const padded = await callRoute(routes, '/studio/cuts', '/studio/cuts', {
      method: 'POST',
      body: { project: 'smoke', cut: { id: 'cut-pad', name: '拉长', sections: [{ id: 's1', tail: 6 }] } },
    })
    if (padded.statusCode === 200) {
      const withPad = await callRoute(routes, '/studio/state', '/studio/state?project=smoke&cut=cut-pad')
      const without = await callRoute(routes, '/studio/state', '/studio/state?project=smoke')
      const padSection = withPad.json().timeline.find((entry) => entry.sectionId === 's1')
      const plainSection = without.json().timeline.find((entry) => entry.sectionId === 's1')
      // Derived, not hardcoded: the section's own lead comes from its cues or
      // the style, and pinning a number here would test the fixture instead of
      // the behaviour.
      const expectedPad = padSection.lead + padSection.speechSeconds + 6
      if (Math.abs(padSection.duration - expectedPad) < 0.05)
        ok('a six-second tail actually lengthens the section (' + padSection.duration.toFixed(2) + 's)')
      else bad('pad length', padSection.duration + ' expected ~' + expectedPad.toFixed(2))
      if (padSection.duration > plainSection.duration + 5)
        ok('the same request without the cut id returns the untouched plan')
      else bad('cut isolation', plainSection.duration + ' vs ' + padSection.duration)
    } else bad('POST pad cut', String(padded.statusCode))
    await callRoute(routes, '/studio/cuts/delete', '/studio/cuts/delete', {
      method: 'POST', body: { project: 'smoke', cut: 'cut-pad' },
    })

    const badCut = await callRoute(routes, '/studio/cuts', '/studio/cuts', {
      method: 'POST', body: { project: 'smoke', cut: { id: '../escape', name: 'x' } },
    })
    if (badCut.statusCode === 400) ok('a cut id that could escape its directory is refused')
    else bad('cut id guard', String(badCut.statusCode))

    const dropped = await callRoute(routes, '/studio/cuts/delete', '/studio/cuts/delete', {
      method: 'POST', body: { project: 'smoke', cut: 'cut-a' },
    })
    const remaining = await callRoute(routes, '/studio/cuts', '/studio/cuts?project=smoke')
    if (dropped.statusCode === 200 && remaining.json().cuts.length === 0) ok('a cut can be deleted')
    else bad('cut delete', String(dropped.statusCode))

    const noProject = await callRoute(routes, '/studio/state', '/studio/state')
    if (noProject.statusCode === 400) ok('state without a project is 400')
    else bad('state 400', String(noProject.statusCode))

    const unknown = await callRoute(routes, '/studio/state', '/studio/state?project=nope')
    if (unknown.statusCode === 404) ok('state for an unknown project is 404')
    else bad('state 404', String(unknown.statusCode))

    const asset = body?.artifacts?.asset_manifest_shots?.assets?.[0]
    if (asset !== undefined) {
      const media = await callRoute(routes, '/studio/media',
        '/studio/media?project=smoke&path=' + encodeURIComponent(asset.path))
      if (media.statusCode === 200 && media.headers['content-type'] === 'image/png' && media.buffer().length > 0)
        ok('media serves a real file with the right content-type (' + media.buffer().length + ' bytes)')
      else bad('GET /studio/media', media.statusCode + ' ' + media.headers['content-type'])

      const ranged = await callRoute(routes, '/studio/media',
        '/studio/media?project=smoke&path=' + encodeURIComponent(asset.path),
        { headers: { range: 'bytes=0-9' } })
      if (ranged.statusCode === 206 && ranged.buffer().length === 10 && ranged.headers['content-range']?.startsWith('bytes 0-9/'))
        ok('media answers Range with 206 so a player can seek')
      else bad('media Range', ranged.statusCode + ' len=' + ranged.buffer().length + ' ' + ranged.headers['content-range'])
    } else bad('media fixture', 'no video asset in the state payload')

    const escaped = await callRoute(routes, '/studio/media',
      '/studio/media?project=smoke&path=' + encodeURIComponent('../../../secret.txt'))
    if (escaped.statusCode === 400 && escaped.json().code === 'BAD_PATH')
      ok('media refuses a path escaping the project with 400')
    else bad('media traversal', escaped.statusCode + ' ' + escaped.text().slice(0, 120))

    const library = await callRoute(routes, '/studio/library', '/studio/library?project=smoke')
    if (library.statusCode === 200) {
      const entry = library.json().projects?.[0]
      const ids = (entry?.categories ?? []).map((category) => category.id)
      if (ids.includes('audio') && ids.includes('image')) ok('library groups files by medium: ' + ids.join(', '))
      else bad('library categories', JSON.stringify(ids))
      if (entry?.total_bytes > 0) ok('library reports a size (' + Math.round(entry.total_bytes / 1024) + ' KB)')
      else bad('library size', JSON.stringify(entry?.total_bytes))
    } else bad('GET /studio/library', String(library.statusCode))

    // Validate checks without writing, so the editor can mark problems as the
    // user types instead of the panel re-implementing schema.ts in the browser.
    const goodScript = await machine.readArtifact(machine.layout('smoke'), 'script')
    const validOk = await callRoute(routes, '/studio/validate', '/studio/validate', {
      method: 'POST', body: { artifact: 'script', value: goodScript },
    })
    if (validOk.statusCode === 200 && validOk.json().valid === true) ok('validate accepts a good script')
    else bad('POST /studio/validate', validOk.statusCode + ' ' + validOk.text().slice(0, 160))

    const validBad = await callRoute(routes, '/studio/validate', '/studio/validate', {
      method: 'POST', body: { artifact: 'script', value: { ...goodScript, title: undefined } },
    })
    if (validBad.statusCode === 200 && validBad.json().valid === false && validBad.json().issues.length > 0)
      ok('validate reports issues without writing (' + validBad.json().issues[0].path + ')')
    else bad('validate bad script', validBad.text().slice(0, 160))

    const before = await machine.status('smoke')
    const validUnknown = await callRoute(routes, '/studio/validate', '/studio/validate', {
      method: 'POST', body: { artifact: 'nonsense', value: {} },
    })
    const after = await machine.status('smoke')
    if (validUnknown.statusCode === 400) ok('validate rejects an unknown artifact name')
    else bad('validate unknown', String(validUnknown.statusCode))
    if (JSON.stringify(before.stages) === JSON.stringify(after.stages))
      ok('validate never moves pipeline state')
    else bad('validate purity', 'stages changed')

    // The panel generates through dsh-comfyui and lands the media here, so the
    // route has to enforce the same naming rule the tool does.
    const audioAsset = body.artifacts.asset_manifest_audio.assets[0]
    const imported = await callRoute(routes, '/studio/import', '/studio/import', {
      method: 'POST',
      body: {
        project: 'smoke',
        items: [{ source: join(WS, 'smoke', audioAsset.path), kind: 'audio', scene_id: 's2' }],
      },
    })
    if (imported.statusCode === 200) {
      const path = imported.json().imported[0].path
      if (/assets\/audio\/02-s2(\.v\d+)?\.wav$/.test(path)) ok('import names by section order: ' + path)
      else bad('import naming', path)
    } else bad('POST /studio/import', imported.statusCode + ' ' + imported.text().slice(0, 160))

    const badScene = await callRoute(routes, '/studio/import', '/studio/import', {
      method: 'POST',
      body: { project: 'smoke', items: [{ source: 'http://x/y.wav', kind: 'audio', scene_id: 'nope' }] },
    })
    if (badScene.statusCode === 400) ok('import refuses a scene id that is not in the script')
    else bad('import scene guard', String(badScene.statusCode))

    // Trimming rewrites the file in place; the point of the test is that the
    // result is genuinely shorter, not merely that ffmpeg exited zero.
    const trimTarget = imported.statusCode === 200 ? imported.json().imported[0].path : undefined
    if (trimTarget !== undefined) {
      const before = await probeDuration(config.ffprobePath, join(WS, 'smoke', trimTarget))
      const trimmed = await callRoute(routes, '/studio/asset/trim', '/studio/asset/trim', {
        method: 'POST', body: { project: 'smoke', path: trimTarget, start: 0.5, end: 1.5 },
      })
      const after = await probeDuration(config.ffprobePath, join(WS, 'smoke', trimTarget))
      if (trimmed.statusCode === 200 && after !== undefined && before !== undefined && after < before)
        ok('trim shortens the file in place (' + before.toFixed(2) + 's -> ' + after.toFixed(2) + 's)')
      else bad('POST /studio/asset/trim', trimmed.statusCode + ' ' + trimmed.text().slice(0, 160))

      const badRange = await callRoute(routes, '/studio/asset/trim', '/studio/asset/trim', {
        method: 'POST', body: { project: 'smoke', path: trimTarget, start: 2, end: 1 },
      })
      if (badRange.statusCode === 400) ok('trim refuses an end before the start')
      else bad('trim range guard', String(badRange.statusCode))
    }

    const crossOrigin = await callRoute(routes, '/studio/stage', '/studio/stage', {
      method: 'POST',
      headers: { origin: 'http://evil.example' },
      body: { project: 'smoke', stage: 'brief', status: 'completed', human_approved: true },
    })
    if (crossOrigin.statusCode === 403) ok('stage refuses a cross-origin write')
    else bad('stage cross-origin', String(crossOrigin.statusCode))

    const gate = await callRoute(routes, '/studio/stage', '/studio/stage', {
      method: 'POST',
      body: { project: 'smoke', stage: 'brief', status: 'completed', artifacts: { brief }, human_approved: false },
    })
    if (gate.statusCode === 409 && gate.json().code === 'GATE_VIOLATION')
      ok('the gate still holds through the route, not just the tool')
    else bad('stage gate', gate.statusCode + ' ' + gate.text().slice(0, 160))

    const badStage = await callRoute(routes, '/studio/stage', '/studio/stage', {
      method: 'POST',
      body: { project: 'smoke', stage: 'nope', status: 'completed' },
    })
    if (badStage.statusCode === 400) ok('stage rejects an unknown stage name')
    else bad('stage unknown', String(badStage.statusCode))

    const submit = await callRoute(routes, '/studio/stage', '/studio/stage', {
      method: 'POST',
      body: { project: 'smoke', stage: 'brief', status: 'completed', artifacts: { brief }, human_approved: true, note: '面板提交' },
    })
    if (submit.statusCode === 200 && submit.json().human_approved === true)
      ok('a panel submit advances the pipeline through StateMachine.write()')
    else bad('stage submit', submit.statusCode + ' ' + submit.text().slice(0, 160))

    host.disposeAll()
    if (routes.size === 0) ok('routes unwind with the fiber')
    else bad('route disposal', routes.size + ' still registered after dispose')
  }


  console.log('\n== 字幕解析 ==')
  {
    // The compose screen draws its cue lane from the file that shipped, so the
    // reader has to agree with the writer exactly — a parser that drifts shows
    // a subtitle track nobody will ever see.
    const cues = [
      { start: 0.15, end: 3.35, text: '第一句' },
      { start: 4, end: 6.5, text: '第二句，带标点。' },
    ]
    const round = parseSrt(renderSrt(cues))
    const same = round.length === cues.length && round.every((cue, index) =>
      cue.text === cues[index].text
      && Math.abs(cue.start - cues[index].start) < 0.002
      && Math.abs(cue.end - cues[index].end) < 0.002)
    if (same) ok('an SRT round-trips through renderSrt and parseSrt')
    else bad('srt round-trip', JSON.stringify(round))

    const messy = parseSrt('1\n00:00:01,000 --> 00:00:02.500\n有点乱\n\nnot a cue\n\n')
    if (messy.length === 1 && messy[0].text === '有点乱') ok('a malformed block is skipped, not thrown on')
    else bad('srt tolerance', JSON.stringify(messy))
  }

  console.log('\n== 多分镜 ==')
  {
    // The point of shots: a long section can be carried by more than one
    // picture. The section's length is fixed by its narration, so the shots
    // divide it — and a weight says which one holds the screen longer.
    const audio = (await machine.readArtifact(layout, 'asset_manifest_audio')).assets
    const shots = (await machine.readArtifact(layout, 'asset_manifest_shots')).assets
    const s1shot = shots.find((asset) => asset.scene_id === 's1')
    const split = {
      version: '1.0',
      assets: [
        ...audio,
        ...shots.filter((asset) => asset.scene_id !== 's1'),
        { ...s1shot, id: 's1-shot-0', shot_index: 0, weight: 1 },
        { ...s1shot, id: 's1-shot-1', shot_index: 1, weight: 3 },
      ],
    }
    const multi = await expectOk('render with two shots in one section', async () => renderProject({
      layout,
      script: await machine.readArtifact(layout, 'script'),
      manifest: split,
      config,
      playbook,
      signal: new AbortController().signal,
    }))
    if (multi) {
      const s1 = multi.timeline.find((timing) => timing.sectionId === 's1')
      if (s1.shots.length === 2) ok('s1 now carries two shots')
      else bad('shot count', String(s1.shots.length))

      const [a, b] = s1.shots
      if (Math.abs(b.duration / a.duration - 3) < 0.02) ok('weight 3 holds the screen 3x as long')
      else bad('shot weights', a.duration.toFixed(2) + ' / ' + b.duration.toFixed(2))

      // The section's own length must not move: adding a shot splits time that
      // was already spoken for.
      const before = result.timeline.find((timing) => timing.sectionId === 's1')
      if (Math.abs(s1.duration - before.duration) < 0.001) ok('adding a shot did not stretch the section')
      else bad('section length', before.duration + ' -> ' + s1.duration)

      const total = multi.report.outputs[0].duration_seconds
      const expected = result.report.outputs[0].duration_seconds
      if (Math.abs(total - expected) < 0.4) ok('the film is the same length as before (' + total.toFixed(2) + 's)')
      else bad('film length', expected + ' -> ' + total)
    }
  }

  console.log('\n== 媒体回显 ==')
  {
    // studio_show is how the agent puts media on screen. The card reads
    // `presentationMeta` and never the rendered text, so that payload is the
    // contract this holds — including that its url is the one the media route
    // answers, since a wrong url draws a broken frame and says nothing.
    const registered = new Map()
    registerStudioTools(
      { tools: { register: (definition) => { registered.set(definition.name, definition); return () => {} } } },
      { machine, getConfig: () => config },
    )
    const show = registered.get('studio_show')
    const exec = { signal: new AbortController().signal }

    const shots = (await machine.readArtifact(layout, 'asset_manifest_shots')).assets
    const one = shots[0].path
    const shown = await show.execute({ project: layout.id, paths: [one], note: '看一眼' }, exec)
    const item = shown.items[0]
    if (shown.items.length === 1 && item.path === one && item.kind === 'image' && item.bytes > 0)
      ok('studio_show resolves a project path into one item')
    else bad('show result', JSON.stringify(shown.items))

    if (item.url === mediaUrl(layout.id, one))
      ok('the item url is the one /studio/media is registered for')
    else bad('media url', item.url)

    const meta = show.output.presentationMeta({ project: layout.id }, shown)
    if (meta.kind === 'media' && meta.items[0].url === item.url && meta.note === '看一眼')
      ok('the card payload carries the url and the note')
    else bad('presentationMeta', JSON.stringify(meta))

    // A compose result feeds the same card, so a finished film shows itself.
    const composeMeta = registered.get('studio_compose').output.presentationMeta(
      { project: layout.id },
      { report: { outputs: [{ path: 'output/smoke.mp4', duration_seconds: 12, file_size_bytes: 4096 }] } },
    )
    if (composeMeta.kind === 'media' && composeMeta.items[0].kind === 'video'
      && composeMeta.items[0].url === mediaUrl(layout.id, 'output/smoke.mp4'))
      ok('studio_compose feeds the same card')
    else bad('compose card payload', JSON.stringify(composeMeta))

    let refused
    try {
      await show.execute({ project: layout.id, paths: ['output/not-a-file.mp4'] }, exec)
    } catch (error) {
      refused = error
    }
    if (refused?.code === 'BAD_REQUEST') ok('studio_show refuses a path with no file behind it')
    else bad('missing path', refused === undefined ? 'accepted it' : String(refused.code))

    let escaped
    try {
      await show.execute({ project: layout.id, paths: ['../../etc/passwd'] }, exec)
    } catch (error) {
      escaped = error
    }
    if (escaped !== undefined) ok('studio_show refuses a path that climbs out of the project')
    else bad('escape', 'accepted ../../etc/passwd')
  }


  console.log('\n== 媒体回显 · 渲染 ==')
  {
    // The card has to SHOW media, not link to it. That is the whole difference
    // between a preview and a URL, and it is decided by one branch on `kind` -
    // so this renders the real component and asserts the tag that comes out.
    // A regression here is silent: links still work, they just stop being a
    // preview, and nothing errors.
    const { render, flatten } = await import('./render.mjs')
    const React = (await import('react')).default
    const { readFileSync } = await import('node:fs')

    const savedWindow = globalThis.window
    let captured
    globalThis.window = { __ModuleLoader__: { load: (module) => { captured = module } } }
    new Function(readFileSync('client/client.js', 'utf-8'))()
    const jsx = (type, props, key) =>
      React.createElement(type, key === undefined ? props : { ...props, key })
    const mod = captured.factory((id) => {
      if (id === 'react') return React
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: React.Fragment }
      throw new Error('bundle reached past the module table: ' + id)
    })

    const entries = []
    mod.apply({
      effect: (fn) => { fn() },
      slots: {
        inject: (_slot, fn) => { const value = fn(); if (value && typeof value.next === 'function') { for (const _ of value); } },
        register: (meta, component) => { entries.push({ meta, component }); return () => {} },
      },
      settingsScope: {
        bind: () => ({
          getSnapshot: () => ({ status: 'loading', value: undefined, base: undefined, user: undefined, writable: false }),
          subscribe: () => () => {}, set: async () => {}, unset: async () => {},
        }),
      },
      sessions: { binding: () => ({ session: { prompt: async () => ({ ok: true }) } }) },
    })
    globalThis.window = savedWindow

    // Each screen must be rendered from exactly ONE place. Two hand-written
    // conditionals for project and script outlived the SCREENS registry and
    // drew those two screens twice -- the whole page appeared duplicated, and
    // nothing failed. Counting the JSX call sites in source is crude but it is
    // the only thing that would have caught it.
    {
      const workbench = (await import('node:fs')).readFileSync('src/client/workbench.tsx', 'utf-8')
      const twice = []
      for (const screen of ['ProjectScreen', 'ScriptScreen', 'AudioScreen', 'ShotsScreen', 'TimelineScreen']) {
        // One import, one entry in the SCREENS registry. A third mention is a
        // second render path.
        const uses = workbench.split('<' + screen).length - 1
        if (uses > 1) twice.push(screen + ' x' + uses)
      }
      if (twice.length === 0) ok('every screen is rendered from exactly one place')
      else bad('duplicate render path', twice.join(', '))
    }

    const card = entries.find((e) => e.meta.name === 'tool.call.toolview' && e.meta.key === 'studio_show')
    if (card?.component !== undefined) ok('the media card is registered with a component')
    else bad('media card', 'not registered')

    /** Render one item through the real card and report the tag it produced. */
    const tagFor = (path) => {
      const item = {
        path, name: path.split('/').pop(), kind: mediaKindOf(path),
        bytes: 2048, url: mediaUrl('p', path),
      }
      const tree = render(React.createElement(card.component, {
        block: { kind: 'tool-result', meta: { kind: 'media', project: 'p', items: [item] } },
      }))
      const node = flatten(tree).find((n) => ['img', 'audio', 'video', 'pre', 'a'].includes(n.tag))
      return { kind: item.kind, tag: node?.tag, src: node?.props?.src, controls: node?.props?.controls }
    }

    // Every extension ComfyUI or ffmpeg can hand back, against the tag that
    // actually previews it. `a` anywhere in this table is a failure.
    const expected = [
      ['assets/shots/s1.png', 'image', 'img'],
      ['assets/shots/s2.jpg', 'image', 'img'],
      ['assets/shots/s3.webp', 'image', 'img'],
      ['assets/shots/s4.avif', 'image', 'img'],
      ['output/loop.gif', 'image', 'img'],
      ['assets/audio/s1.wav', 'audio', 'audio'],
      ['assets/audio/s2.flac', 'audio', 'audio'],
      ['assets/audio/s3.mp3', 'audio', 'audio'],
      ['assets/audio/s4.opus', 'audio', 'audio'],
      ['output/film.mp4', 'video', 'video'],
      ['output/anim.webm', 'video', 'video'],
      ['output/take.mov', 'video', 'video'],
      ['output/film.srt', 'text', 'pre'],
      ['output/film.vtt', 'text', 'pre'],
    ]
    const wrong = []
    for (const [path, kind, tag] of expected) {
      const got = tagFor(path)
      if (got.kind !== kind || got.tag !== tag) wrong.push(path + ' -> ' + got.kind + '/' + got.tag)
    }
    if (wrong.length === 0) ok('all ' + expected.length + ' media types render inline, none fall back to a link')
    else bad('inline rendering', wrong.join('; '))

    // Playable media needs transport controls, or it is a still frame you
    // cannot start.
    const playable = ['output/film.mp4', 'assets/audio/s1.wav'].map(tagFor)
    if (playable.every((entry) => entry.controls === true)) ok('audio and video carry controls')
    else bad('controls', JSON.stringify(playable))

    // The src has to be the media route, not a bare project path.
    const shot = tagFor('assets/shots/s1.png')
    if (shot.src === mediaUrl('p', 'assets/shots/s1.png')) ok('the rendered src points at /studio/media')
    else bad('rendered src', String(shot.src))

    // Only genuinely unshowable bytes may degrade to a link.
    const binary = tagFor('output/mystery.bin')
    if (binary.kind === 'other' && binary.tag === 'a') ok('an unshowable file degrades to a download link')
    else bad('binary fallback', JSON.stringify(binary))
  }


  console.log('\n== 平台画幅 ==')
  {
    // target_platform used to be validated and then ignored: a project declared
    // for a vertical platform rendered 1920x1080 anyway.
    const { resolveVideoProfile } = await import('../lib/media-profile.js')
    const settings = { width: 1920, height: 1080, fps: 30 }

    const vertical = resolveVideoProfile(settings, 'douyin')
    if (vertical.width === 1080 && vertical.height === 1920 && vertical.source === 'platform')
      ok('douyin renders vertical, not the landscape default')
    else bad('douyin frame', JSON.stringify(vertical))

    const generic = resolveVideoProfile(settings, 'generic')
    if (generic.width === 1920 && generic.source === 'settings')
      ok('generic hands the frame back to settings')
    else bad('generic frame', JSON.stringify(generic))

    // A brief written before the field existed must still render.
    const missing = resolveVideoProfile(settings, undefined)
    const unknown = resolveVideoProfile(settings, 'myspace')
    if (missing.source === 'settings' && unknown.source === 'settings')
      ok('an absent or unknown platform falls back instead of throwing')
    else bad('platform fallback', JSON.stringify([missing.source, unknown.source]))

    // fps is a quality setting, not a platform fact.
    const fast = resolveVideoProfile({ width: 1920, height: 1080, fps: 60 }, 'douyin')
    if (fast.fps === 60) ok('the platform sets the frame, not the frame rate')
    else bad('fps override', String(fast.fps))

    // THREE lists name the same platforms: the schema's vocabulary, the
    // renderer's frames, and the picker's labels. Nothing links them at
    // compile time, and every way they can drift fails silently -- a picker
    // offering a value the schema rejects, or promising a shape the renderer
    // will not produce. So they are compared here.
    const { PLATFORMS } = await import('../lib/schema.js')
    const { listPlatformProfiles } = await import('../lib/media-profile.js')

    const framed = new Set(listPlatformProfiles().map((entry) => entry.platform))
    const unframed = PLATFORMS.filter((id) => id !== 'generic' && !framed.has(id))
    const invented = [...framed].filter((id) => !PLATFORMS.includes(id))
    if (unframed.length === 0 && invented.length === 0)
      ok('every schema platform has a frame, and no frame is invented')
    else bad('platform coverage', 'unframed ' + JSON.stringify(unframed) + ', invented ' + JSON.stringify(invented))

    // The picker lives in the client bundle; read its list back out of the
    // built file rather than trusting that someone updated both.
    const bundle = (await import('node:fs')).readFileSync('client/client.js', 'utf-8')
    const offered = [...bundle.matchAll(/id:\s*"(youtube|bilibili|douyin|xiaohongshu|wechat|generic)"/g)]
      .map((match) => match[1])
    const offeredSet = new Set(offered)
    if (PLATFORMS.every((id) => offeredSet.has(id)) && offeredSet.size === PLATFORMS.length)
      ok('the picker offers exactly the platforms the schema accepts')
    else bad('picker list', 'picker has ' + JSON.stringify([...offeredSet]) + ', schema has ' + JSON.stringify(PLATFORMS))

    // And the hint text must not promise a frame the renderer will not cut.
    const lying = listPlatformProfiles().filter((entry) => {
      const resolved = resolveVideoProfile(settings, entry.platform)
      return resolved.width !== entry.width || resolved.height !== entry.height
    })
    if (lying.length === 0) ok('the advertised frame is the frame that gets rendered')
    else bad('frame mismatch', JSON.stringify(lying))
  }


  console.log('\n== 五层提示词 ==')
  {
    const { buildShotPrompt, buildScenePrompts, styleClause, resolveShotLanguage } =
      await import('../lib/prompt.js')
    const { BUILT_IN_PLAYBOOKS } = await import('../lib/playbooks.js')
    const tech = BUILT_IN_PLAYBOOKS['clean-tech']

    // THE property this whole layer exists for. Three shots that differ only
    // in their subject used to yield three strings identical but for a short
    // middle phrase; with shot language they must genuinely diverge.
    const shots = [
      { id: 'a', section_id: 's1', shot_index: 0, prompt: 'a data center corridor' },
      {
        id: 'b', section_id: 's2', shot_index: 0, prompt: 'a single GPU board',
        shot_language: { shot_size: 'extreme_close_up', lens_mm: 85, depth_of_field: 'shallow' },
      },
      {
        id: 'c', section_id: 's3', shot_index: 0, prompt: 'city skyline at dawn',
        shot_language: { shot_size: 'establishing', lens_mm: 24, lighting_key: 'blue_hour' },
      },
    ]
    const built = shots.map((shot) => buildShotPrompt(shot, tech).prompt)
    if (new Set(built).size === 3) ok('three shots produce three different prompts')
    else bad('prompt variety', JSON.stringify(built))

    // Measure the divergence rather than assert it loosely: under the old
    // scheme the shared text was ~85% of each prompt.
    const words = built.map((text) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)))
    const shared = [...words[0]].filter((word) => words[1].has(word) && words[2].has(word))
    const sharedRatio = shared.length / words[0].size
    if (sharedRatio < 0.6) ok('shared text is ' + Math.round(sharedRatio * 100) + '% of a prompt, not most of it')
    else bad('prompts still mostly identical', Math.round(sharedRatio * 100) + '% shared: ' + shared.join(' '))

    // Layer order is the contract: style must come last, subject in the middle.
    const layers = buildShotPrompt(shots[1], tech).layers
    if (layers[layers.length - 1].layer === 5 && layers.some((entry) => entry.layer === 3))
      ok('style is the closing clause, not the opening one')
    else bad('layer order', JSON.stringify(layers.map((entry) => entry.layer)))

    // A shot overrules the playbook field by field, keeping the rest.
    const merged = resolveShotLanguage({ lighting_key: 'low_key' }, { lighting_key: 'high_key', depth_of_field: 'deep' })
    if (merged.value.lighting_key === 'low_key' && merged.value.depth_of_field === 'deep')
      ok('a shot overrules one field without blanking the others')
    else bad('language merge', JSON.stringify(merged.value))
    if (merged.fromDefaults.has('depth_of_field') && !merged.fromDefaults.has('lighting_key'))
      ok('the panel can tell which fields came from the style')
    else bad('default provenance', JSON.stringify([...merged.fromDefaults]))

    // The renderer decides the frame now, so a prompt must not name one.
    const framed = built.filter((text) => /16:9|9:16|aspect ratio/i.test(text))
    if (framed.length === 0) ok('no prompt hard-codes an aspect ratio')
    else bad('aspect in prompt', JSON.stringify(framed))

    // A custom playbook that predates style_hint still has to work.
    const legacy = {
      ...tech,
      visual: { ...tech.visual, style_hint: undefined, image_prompt_prefix: 'oil painting, ' },
    }
    if (styleClause(legacy) === 'oil painting') ok('a playbook with no style_hint falls back to its prefix')
    else bad('style fallback', styleClause(legacy))

    // A section split into shots that only described the first still needs
    // three pictures, so the section subject fills the gaps.
    const plan = [
      { id: 's1-0', section_id: 's1', shot_index: 0, prompt: 'the harbour' },
      { id: 's1-1', section_id: 's1', shot_index: 1 },
    ]
    const withFallback = buildScenePrompts(plan, tech, new Map([['s1', 'fishing boats']]))
    if (withFallback[1].prompt.includes('fishing boats') && withFallback[1].missingSubject === false)
      ok('a shot with no subject borrows its section subject')
    else bad('subject fallback', JSON.stringify(withFallback[1]))

    const orphan = buildShotPrompt({ id: 'x', section_id: 's9', shot_index: 0 }, tech)
    if (orphan.missingSubject === true) ok('a shot with no subject anywhere is flagged, not silently empty')
    else bad('missing subject flag', JSON.stringify(orphan))

    // Framing phrasing presumes a person; a style must not impose it.
    if (!/waist up/.test(built[0])) ok('a shot with no framing gets no framing clause')
    else bad('framing imposed', built[0])

    // The pickers offer a vocabulary the schema has to accept and the builder
    // has to have a phrase for. Three lists again, same drift hazard as the
    // platform frames -- and here a mismatch means a save that 400s or a
    // silently dropped clause.
    const schema = await import('../lib/schema.js')
    const vocab = {
      shot_size: schema.SHOT_SIZES,
      camera_movement: schema.CAMERA_MOVEMENTS,
      lighting_key: schema.LIGHTING_KEYS,
      color_temperature: schema.COLOR_TEMPERATURES,
      depth_of_field: schema.DEPTHS_OF_FIELD,
      lens_mm: schema.LENS_MM.map(String),
    }
    const bundleText = (await import('node:fs')).readFileSync('client/client.js', 'utf-8')
    const wrong = []
    for (const [field, allowed] of Object.entries(vocab)) {
      for (const value of allowed) {
        // Every schema value must be reachable from a picker.
        if (!bundleText.includes('"' + value + '"')) wrong.push(field + '/' + value + ' not offered')
      }
    }
    if (wrong.length === 0) ok('every shot-language value the schema accepts is offered in a picker')
    else bad('picker vocabulary', wrong.join('; '))

    // And every value must have a PHRASE. The builder falls back to the bare
    // enum when a phrase is missing, which reaches the model as `medium_close`
    // -- syntactically fine, meaningless to a diffusion model, and invisible
    // unless something looks. A correct phrase may well contain the enum word
    // ('wide' -> 'wide shot capturing full scene'), so the check is that the
    // layer text is not the bare enum, not that it avoids the word.
    const raw = []
    //
    // Built against a playbook with NO defaults on purpose: clean-tech fills
    // colour temperature for every shot, and that filled-in half was enough to
    // keep layer 4 non-empty while a missing lighting phrase silently vanished.
    // A guard a default can mask is not a guard.
    const bare = { ...tech, visual: { ...tech.visual, shot_defaults: {} } }
    const layerTextFor = (language, layer) => buildShotPrompt(
      { id: 'p', section_id: 's', shot_index: 0, prompt: 'x', shot_language: language },
      bare,
    ).layers.find((entry) => entry.layer === layer)?.text
    for (const size of schema.SHOT_SIZES) {
      if (layerTextFor({ shot_size: size }, 2) === size) raw.push('shot_size/' + size)
    }
    for (const move of schema.CAMERA_MOVEMENTS) {
      if (move === 'static') continue
      if (layerTextFor({ camera_movement: move }, 2) === move) raw.push('camera_movement/' + move)
    }
    for (const key of schema.LIGHTING_KEYS) {
      const text = layerTextFor({ lighting_key: key }, 4)
      if (text === undefined || text === key) raw.push('lighting_key/' + key)
    }
    for (const dof of schema.DEPTHS_OF_FIELD) {
      const text = layerTextFor({ depth_of_field: dof }, 1)
      if (text === undefined || text === dof) raw.push('depth_of_field/' + dof)
    }
    for (const temp of schema.COLOR_TEMPERATURES) {
      const text = layerTextFor({ color_temperature: temp }, 4)
      if (text === undefined || text === temp) raw.push('color_temperature/' + temp)
    }
    if (raw.length === 0) ok('every enum has a real phrase, none falls through to its raw name')
    else bad('missing phrase', raw.join('; '))
  }


  console.log('\n== 分镜重复度 ==')
  {
    const { checkSceneVariation } = await import('../lib/variation.js')
    const shot = (id, extra) => ({ id, section_id: id, shot_index: 0, ...extra })

    // A checker that fires on good work gets ignored, and then it is not a
    // checker. Silence on a competent plan is the property that keeps the
    // noisy cases worth reading.
    const good = [
      shot('s1', {
        prompt: 'rain-slicked Tokyo intersection at night, neon reflections in puddles',
        texture_keywords: ['wet asphalt'], shot_language: { shot_size: 'establishing', lighting_key: 'neon' },
      }),
      shot('s2', {
        prompt: 'a soldering iron touching a circuit board', hero_moment: true,
        texture_keywords: ['molten tin'], shot_language: { shot_size: 'extreme_close_up', lighting_key: 'rim_lit' },
      }),
      shot('s3', {
        prompt: 'an engineer leaning back from three monitors',
        texture_keywords: ['worn desk'], shot_language: { shot_size: 'medium', lighting_key: 'tungsten_warm' },
      }),
      shot('s4', {
        prompt: 'server racks receding down a cold corridor',
        texture_keywords: ['brushed steel'], shot_language: { shot_size: 'wide', lighting_key: 'high_key' },
      }),
    ]
    const clean = checkSceneVariation(good)
    if (clean.violations.length === 0 && clean.verdict === 'strong')
      ok('a varied plan reports nothing at all')
    else bad('false positives', JSON.stringify(clean.violations.map((entry) => entry.code)))

    // And the case it exists for.
    const flat = [
      shot('a', { prompt: 'a modern office, stunning' }),
      shot('b', { prompt: 'a modern office, stunning' }),
      shot('c', { prompt: 'a beautiful cityscape' }),
      shot('d', {}),
    ]
    const report = checkSceneVariation(flat)
    const codes = new Set(report.violations.map((entry) => entry.code))
    const wanted = ['duplicate-subject', 'generic-language', 'empty-subject', 'no-hero', 'lighting-monotony']
    const absent = wanted.filter((code) => !codes.has(code))
    if (absent.length === 0 && report.verdict === 'fail')
      ok('a flat plan is caught on every count  -> ' + report.score + ' ' + report.verdict)
    else bad('missed violations', 'absent ' + JSON.stringify(absent) + ' verdict ' + report.verdict)

    // Duplicate detection has to survive case and punctuation, or it catches
    // only literal copy-paste and misses the way a model actually repeats.
    const nearDupes = checkSceneVariation([
      shot('a', { prompt: 'A Modern Office.' }),
      shot('b', { prompt: 'a modern  office' }),
    ])
    if (nearDupes.violations.some((entry) => entry.code === 'duplicate-subject'))
      ok('duplicate subjects are matched past case and punctuation')
    else bad('duplicate matching', JSON.stringify(nearDupes.violations))

    // Below four shots most checks stay quiet: a two-shot plan cannot be
    // repetitive, and firing there teaches people to stop reading.
    const tiny = checkSceneVariation([shot('a', { prompt: 'a harbour at dawn' })])
    if (tiny.violations.length === 0) ok('a one-shot plan is not scolded for lacking variety')
    else bad('small plan noise', JSON.stringify(tiny.violations.map((entry) => entry.code)))

    // The longest RUN, not the count of equal adjacent pairs -- otherwise
    // three separate pairs read as one run of three.
    const pairs = ['wide', 'wide', 'close_up', 'close_up', 'medium', 'medium'].map(
      (size, index) => ({ id: 'p' + index, section_id: 's', shot_index: index, prompt: 'thing ' + index, shot_language: { shot_size: size } }),
    )
    if (!checkSceneVariation(pairs).violations.some((entry) => entry.code === 'consecutive-same-size'))
      ok('three separate pairs are not counted as a run of three')
    else bad('run counting', 'pairs misread as a run')

    const run = ['wide', 'wide', 'wide', 'close_up'].map(
      (size, index) => ({ id: 'r' + index, section_id: 's', shot_index: index, prompt: 'thing ' + index, shot_language: { shot_size: size } }),
    )
    if (checkSceneVariation(run).violations.some((entry) => entry.code === 'consecutive-same-size'))
      ok('a real run of three is caught')
    else bad('run detection', 'missed a genuine run')

    // A clean plan must still be VISIBLE as clean. Hiding the banner entirely
    // makes "the check passed" and "the check never ran" identical on screen,
    // and the first person to use this assumed the second for a while.
    const bundleText = (await import('node:fs')).readFileSync('client/client.js', 'utf-8')
    const advice = ['创作建议', '镜头变化', '镜头节奏', '通过']
    const absentBits = advice.filter((bit) => !bundleText.includes(bit))
    if (absentBits.length === 0) ok('the advice panel names both checks and can report a pass')
    else bad('advice panel incomplete', JSON.stringify(absentBits))

    // Both rows render off the same guard, so neither can go missing while the
    // other shows -- which is how the two used to read as unrelated events.
    if (bundleText.includes('dcs-plan-advice-row') && bundleText.includes('dcs-plan-advice-title'))
      ok('the two rows sit in one named container')
    else bad('rows not unified', 'dcs-plan-advice markup missing')

    // Class names are a flat namespace across every screen, and a collision is
    // silent in BOTH directions: the loser's rules are overridden, and the
    // winner's leak onto whatever else wore the name. This has bitten twice —
    // `.dcs-advice` (a script-screen list) and `.dcs-select-small`, whose older
    // rule 594 lines later won and rendered the shot-language pickers wider
    // than designed. That was the cramped layout, hiding in a shared adjective.
    //
    // Declarations a few lines apart are one component split for readability.
    // Far-apart ones are two components arguing, so only those are flagged, and
    // the four that predate this check are listed so a NEW one still fails.
    const styles = (await import('node:fs')).readFileSync('src/client/workbench-styles.ts', 'utf-8')
    const at = new Map()
    styles.split(String.fromCharCode(10)).forEach((line, index) => {
      const hit = /^\.([a-z0-9-]+)\s*[,{]/.exec(line)
      if (hit !== null) at.set(hit[1], [...(at.get(hit[1]) ?? []), index + 1])
    })
    const accepted = new Set(['dcs-info', 'dcs-cue-actions', 'dcs-block-wave', 'dcs-field-narrow'])
    const collisions = [...at.entries()]
      .filter(([name, lines]) => lines.length > 1
        && Math.max(...lines) - Math.min(...lines) > 30
        && !accepted.has(name))
      .map(([name, lines]) => name + ' at ' + lines.join(','))
    if (collisions.length === 0) ok('no new class name is claimed by two different components')
    else bad('class name collision', JSON.stringify(collisions))

    // Markup can outlive the stylesheet block it was written for. Rewriting one
    // section wholesale took three classes with it that other screens were
    // still using, and nothing complained: TypeScript does not read CSS, the
    // bundle built, every test passed, and the compose banner simply rendered
    // unstyled. So every class the panels name has to exist in a stylesheet.
    const { readdirSync, readFileSync } = await import('node:fs')
    const sheets = readFileSync('src/client/workbench-styles.ts', 'utf-8')
      + readFileSync('src/client/styles.ts', 'utf-8')
    const unstyled = []
    for (const file of readdirSync('src/client').filter((name) => name.endsWith('.tsx'))) {
      const markup = readFileSync('src/client/' + file, 'utf-8')
      const named = new Set([...markup.matchAll(/className=[{]?['"`]([^'"`]*)/g)]
        .flatMap((hit) => hit[1].split(/\s+/))
        .filter((name) => name.startsWith('dcs-')))
      for (const name of named) {
        if (!sheets.includes('.' + name)) unstyled.push(file + ' → .' + name)
      }
    }

    if (unstyled.length === 0) ok('every dcs- class the panels use is defined in a stylesheet')
    else bad('unstyled classes', JSON.stringify(unstyled))

    // A shot with no subject of its own borrows its section's, and must not
    // then be reported as empty.
    const borrowed = checkSceneVariation(
      [shot('x', {})],
      new Map([['x', 'a lighthouse in fog']]),
    )
    if (!borrowed.violations.some((entry) => entry.code === 'empty-subject'))
      ok('a shot borrowing its section subject is not called empty')
    else bad('subject fallback ignored', JSON.stringify(borrowed.violations))

    // Scoring follows OpenMontage so both report the same words.
    if (checkSceneVariation([]).verdict === 'fail') ok('an empty plan fails rather than passing vacuously')
    else bad('empty plan', JSON.stringify(checkSceneVariation([])))
  }


  console.log('\n== 幻灯片风险 ==')
  {
    const { scoreSlideshowRisk } = await import('../lib/slideshow.js')
    const { BUILT_IN_PLAYBOOKS } = await import('../lib/playbooks.js')
    const tech = BUILT_IN_PLAYBOOKS['clean-tech']
    const timing = (id, seconds) => ({ sectionId: id, duration: seconds, shots: [{ index: 0, duration: seconds }] })

    // The film this check exists to stop: four pictures nobody chose, each
    // held twenty-five seconds.
    const nothing = ['a', 'b', 'c', 'd'].map((id) => ({ id, section_id: id, shot_index: 0 }))
    const bleak = scoreSlideshowRisk(nothing, nothing.map((s) => timing(s.section_id, 25)), tech)
    if (bleak.blocking === true && bleak.verdict === 'fail')
      ok('an unconsidered, slow plan is blocked  -> ' + bleak.average)
    else bad('slideshow not caught', JSON.stringify(bleak))

    // And a directed one must sail through, or the block is just an obstacle.
    const directed = [
      'harbour at dawn', 'a soldering iron on a board', 'engineer at three monitors',
      'server racks in a corridor', 'a hand closing a laptop', 'rain on a window',
    ].map((prompt, index) => ({
      id: 'g' + index, section_id: 's' + index, shot_index: 0, prompt,
      texture_keywords: ['grain'],
      shot_language: {
        shot_size: ['wide', 'extreme_close_up', 'medium', 'establishing', 'close_up', 'insert'][index],
        lighting_key: ['natural', 'rim_lit', 'tungsten_warm', 'blue_hour', 'high_key', 'overcast_soft'][index],
      },
      ...(index === 1 ? { hero_moment: true } : {}),
    }))
    const fine = scoreSlideshowRisk(directed, directed.map((s) => timing(s.section_id, 7)), tech)
    if (fine.blocking === false && fine.verdict === 'strong')
      ok('a directed plan is not blocked  -> ' + fine.average + ' ' + fine.verdict)
    else bad('false block', JSON.stringify(fine))

    // Ken Burns is what buys a long hold; a style that turns it off has to cut
    // faster, and the score has to know that.
    const still = { ...tech, kenBurns: false }
    const held = directed.map((s) => timing(s.section_id, 15))
    const withKb = scoreSlideshowRisk(directed, held, tech).dimensions.static_hold.score
    const without = scoreSlideshowRisk(directed, held, still).dimensions.static_hold.score
    if (without > withKb) ok('the same hold scores worse when Ken Burns is off')
    else bad('kenBurns ignored', withKb + ' vs ' + without)

    // PICTURE RATE IS STYLE-RELATIVE, and the first version was not.
    //
    // An absolute floor of six a minute scored warm-doc as a slideshow — a
    // playbook whose own description is 缓慢、有呼吸感 and whose profile is
    // contemplative, for which OpenMontage's table gives 3–6 as correct. The
    // check was marking a style down for succeeding at being itself.
    const slowFilm = directed.map((s) => timing(s.section_id, 15))   // 6 shots / 90s = 4.0 a minute
    const asDoc = scoreSlideshowRisk(directed, slowFilm, BUILT_IN_PLAYBOOKS['warm-doc']).dimensions.picture_rate
    const asBrief = scoreSlideshowRisk(directed, slowFilm, BUILT_IN_PLAYBOOKS['flat-brief']).dimensions.picture_rate
    if (asDoc.score === 0) ok('4 pictures a minute is correct for a contemplative style, not a fault')
    else bad('contemplative penalised', JSON.stringify(asDoc))
    if (asBrief.score >= 4) ok('the same rate is a failure for an energetic style  -> ' + asBrief.score)
    else bad('energetic not penalised', JSON.stringify(asBrief))
    if (asDoc.reason.includes('沉静') && asBrief.reason.includes('快节奏'))
      ok('the reason names which style it is judging against')
    else bad('reason hides the standard', asDoc.reason + ' | ' + asBrief.reason)

    // Every profile the playbook type allows needs a rate, or a style silently
    // falls back to someone else's standard.
    const profiles = ['contemplative', 'conversational', 'energetic', 'technical', 'cinematic']
    const unrated = profiles.filter((profile) => {
      const pb = { ...tech, narration: { ...tech.narration, pacing_profile: profile } }
      return !scoreSlideshowRisk(directed, slowFilm, pb).dimensions.picture_rate.reason.includes('该有')
    })
    if (unrated.length === 0) ok('every pacing profile has a rate of its own')
    else bad('profiles with no rate', JSON.stringify(unrated))

    // A style claiming cinema has to be backed by structure.
    const doc = BUILT_IN_PLAYBOOKS['warm-doc']
    const bare = nothing.map((s) => ({ ...s, prompt: 'a thing ' + s.id }))
    const claim = scoreSlideshowRisk(bare, bare.map((s) => timing(s.section_id, 5)), doc)
      .dimensions.unsupported_style_claim
    if (claim.score > 0) ok('an unbacked cinematic claim is scored  -> ' + claim.score)
    else bad('claim unchecked', JSON.stringify(claim))
    const backed = scoreSlideshowRisk(directed, directed.map((s) => timing(s.section_id, 7)), doc)
      .dimensions.unsupported_style_claim
    if (backed.score === 0) ok('a backed cinematic claim scores zero')
    else bad('claim false positive', JSON.stringify(backed))

    // The score existing is not the same as it blocking. This runs the real
    // tool against the smoke project after writing a deliberately bleak plan,
    // and then checks that `force` -- and only `force` -- gets past it.
    const { registerStudioTools: reg } = await import('../lib/tools.js')
    const composeTools = new Map()
    reg(
      { tools: { register: (definition) => { composeTools.set(definition.name, definition); return () => {} } } },
      { machine, getConfig: () => config },
    )
    const compose = composeTools.get('studio_compose')
    const script = await machine.readArtifact(layout, 'script')
    const savedPlan = await machine.readArtifact(layout, 'scene_plan')

    // Earlier tests deliberately invalidate downstream stages, so the whole
    // chain is re-recorded from its artifacts on disk. Otherwise compose
    // refuses on prerequisites and never reaches the quality check.
    for (const [stage, name] of [
      ['brief', 'brief'],
      ['script', 'script'],
      ['assets_audio', 'asset_manifest_audio'],
      ['assets_shots', 'asset_manifest_shots'],
    ]) {
      await machine.write({
        projectId: layout.id, stage, status: 'completed',
        artifacts: { [name]: await machine.readArtifact(layout, name) },
        humanApproved: true,
      })
    }

    await machine.writePlan(layout.id, 'scene_plan', {
      version: '1.0',
      shots: script.sections.map((section, index) => ({
        id: 'bleak-' + index, section_id: section.id, shot_index: 0,
      })),
    })
    // The smoke fixture is a brisk 13-second film: no plan, however thoughtless,
    // can make it a slideshow, and the gate correctly lets it through. To
    // exercise the refusal itself the project is put on a custom playbook that
    // claims cinema and wants fast cuts -- a real configuration, not a stub,
    // under which this material genuinely does score badly.
    const strictConfig = Config({
      workspaceRoot: WS,
      playbooks: {
        strict: {
          ...BUILT_IN_PLAYBOOKS['clean-tech'],
          name: '严苛电影感',
          kenBurns: false,
          visual: { ...BUILT_IN_PLAYBOOKS['clean-tech'].visual, style_hint: 'cinematic photographic still' },
          // 2 is the config schema's own floor; with kenBurns off the hold limit
          // lands at 1.2s, which this material blows past on every section.
          pacing: { ...BUILT_IN_PLAYBOOKS['clean-tech'].pacing, maxSectionSeconds: 2 },
        },
      },
    })
    const strictTools = new Map()
    reg(
      { tools: { register: (definition) => { strictTools.set(definition.name, definition); return () => {} } } },
      { machine, getConfig: () => strictConfig },
    )
    const strictCompose = strictTools.get('studio_compose')
    await machine.updateProject(layout.id, { style: 'strict' })

    let blocked
    await strictCompose.execute({ project: layout.id }, { signal: new AbortController().signal })
      .catch((error) => { blocked = error })
    if (blocked?.code === 'QUALITY_VIOLATION') ok('compose refuses a blocking slideshow score')
    else bad('compose gate', blocked === undefined ? 'it rendered anyway' : blocked.code + ' ' + blocked.message.slice(0, 120))

    // The refusal has to say what to fix, or it is just a wall.
    if (blocked?.message?.includes('scene_plan') && /\d\.\d{2}\/5/.test(blocked.message))
      ok('the refusal names the score and where to go')
    else bad('unhelpful refusal', String(blocked?.message).slice(0, 160))

    // And a person who has seen it can still get their film.
    const forced = await strictCompose.execute(
      { project: layout.id, force: true },
      { signal: new AbortController().signal },
    ).catch((error) => error)
    if (forced instanceof Error) bad('force ignored', forced.message.slice(0, 160))
    else ok('force renders anyway, and says so in the warnings')
    if (forced?.warnings?.some((line) => line.includes('强制'))) ok('a forced render is recorded as forced')
    else bad('silent force', JSON.stringify(forced?.warnings))

    await machine.updateProject(layout.id, { style: 'clean-tech' })
    if (savedPlan !== undefined) await machine.writePlan(layout.id, 'scene_plan', savedPlan)

    // Every dimension has to be capable of both extremes, or it is a constant
    // dressed up as a measurement -- which is exactly why three of OM's six
    // were replaced rather than ported.
    const flatDims = Object.keys(bleak.dimensions)
    const varying = flatDims.filter((name) =>
      bleak.dimensions[name].score !== (fine.dimensions[name]?.score ?? -1))
    if (varying.length >= 4) ok(varying.length + '/' + flatDims.length + ' dimensions actually move between a bad plan and a good one')
    else bad('dead dimensions', 'only ' + JSON.stringify(varying) + ' moved')
  }


  console.log('\n== 自审协议 ==')
  {
    const { STUDIO_REVIEWER_SKILL } = await import('../lib/skill-reviewer.js')
    const { PIPELINES } = await import('../lib/pipelines.js')
    const body = STUDIO_REVIEWER_SKILL.content

    // The focus lists are rendered from the pipeline, so the skill cannot drift
    // from what the tools hand over. Checked by looking for each item.
    const every = PIPELINES['explainer-stills'].stages.flatMap((stage) => stage.review_focus)
    const absent = every.filter((item) => !body.includes(item))
    if (absent.length === 0) ok('the reviewer skill carries every stage focus item  (' + every.length + ')')
    else bad('focus drift', JSON.stringify(absent))

    // The CHAI rule that does the work: a critical with no fix is downgraded.
    if (body.includes('investigation') && body.includes('降级'))
      ok('the skill states the downgrade rule that stops a review becoming complaints')
    else bad('missing downgrade rule', 'no investigation/downgrade language')

    // And it must tell the model NOT to re-check what code already enforces,
    // or the review spends its attention re-deriving facts it was handed.
    for (const already of ['SCHEMA INVALID', 'COVERAGE_INCOMPLETE', 'PREREQUISITE VIOLATION']) {
      if (!body.includes(already)) bad('reviewer does not name an enforced check', already)
    }
    ok('the skill names what code already enforces, so review time goes elsewhere')

    // Two rounds, not perfection.
    if (body.includes('两轮')) ok('the skill caps revision rounds')
    else bad('no round cap', 'perfectionism will stall the pipeline')

    // The status tool hands the focus over at the moment it is useful.
    const focusTools = new Map()
    const { registerStudioTools: regFocus } = await import('../lib/tools.js')
    regFocus(
      { tools: { register: (definition) => { focusTools.set(definition.name, definition); return () => {} } } },
      { machine, getConfig: () => config },
    )
    const projectTool = focusTools.get('studio_project')
    const status = await projectTool.execute(
      { action: 'status', project: 'smoke' },
      { signal: new AbortController().signal },
    )
    if (status.review_focus === undefined) {
      // Every stage of the smoke project is complete, so there is nothing ahead
      // to review — which is itself the right answer.
      if (status.next_stage === null) ok('a finished project offers no review focus')
      else bad('focus missing', 'next_stage ' + status.next_stage + ' but no focus')
    } else {
      const stage = PIPELINES['explainer-stills'].stages.find((entry) => entry.id === status.review_focus.stage)
      if (stage !== undefined && status.review_focus.items.length === stage.review_focus.length)
        ok('studio_project status carries the focus for the stage ahead  -> ' + status.review_focus.stage)
      else bad('focus mismatch', JSON.stringify(status.review_focus))

      const shown = projectTool.output.render({ action: 'status' }, status).map((b) => b.text).join('')
      if (shown.includes('自审重点')) ok('and it is in the text the model reads')
      else bad('focus not rendered', shown.slice(-200))
    }

    // Focus items must be judgements, not things the machine already counts.
    const countable = every.filter((item) => /schema|文件存在|覆盖完整/.test(item))
    if (countable.length === 0) ok('no focus item duplicates a check the code already makes')
    else bad('redundant focus', JSON.stringify(countable))
  }


  console.log('\n== 生图请求 ==')
  {
    // The single most important string in the pipeline: the only thing between
    // a plan and a batch of GPU jobs. It used to live inside the shots screen
    // as a closure, so nothing could check it -- and a missing prompt looked
    // exactly like a working one until someone read the message by eye.
    const { buildShotJob } = await import('../lib/shot-job.js')
    const base = {
      workflow: 'Alpha-Image',
      negativePrompt: 'text, watermark',
      references: [],
    }

    const full = buildShotJob({
      ...base,
      shots: [{
        sectionId: 's1', index: 0, seconds: 8.2, text: '三十年前，科幻片还在预言未来。',
        built: { prompt: '24mm lens. wide shot. a hand holding a phone. golden hour', missingSubject: false },
        fallbackPrompt: 'a hand holding a phone',
      }],
    })
    if (full.includes('24mm lens. wide shot. a hand holding a phone. golden hour'))
      ok('the built prompt reaches the message intact')
    else bad('prompt missing from message', full)

    // The failure that was reported by eye: a message with a negative prompt
    // and no positive one.
    if (/完整正面提示词/.test(full) && full.split('负向提示词').length === 2)
      ok('the message labels the positive prompts and carries the negative once')
    else bad('prompt labelling', full.slice(0, 300))

    // No prompt built (no scene plan reached this shot): the raw subject still
    // has to appear, or the shot goes out blank.
    const fallback = buildShotJob({
      ...base,
      shots: [{ sectionId: 's2', index: 0, seconds: 5, text: '', fallbackPrompt: 'a lighthouse in fog' }],
    })
    if (fallback.includes('a lighthouse in fog')) ok('with no built prompt the raw subject still ships')
    else bad('fallback lost', fallback)

    // An empty built prompt must not shadow the fallback -- that is exactly how
    // a heading with a blank line under it gets sent.
    const blank = buildShotJob({
      ...base,
      shots: [{
        sectionId: 's3', index: 0, seconds: 5, text: '',
        built: { prompt: '   ', missingSubject: true },
        fallbackPrompt: 'a harbour at dawn',
      }],
    })
    if (blank.includes('a harbour at dawn')) ok('an empty built prompt falls back rather than shipping blank')
    else bad('blank shipped', blank)

    // Nothing anywhere: say so, do not emit a bare heading.
    const nothing = buildShotJob({
      ...base,
      shots: [{ sectionId: 's4', index: 0, seconds: 5, text: '某段台词', fallbackPrompt: '' }],
    })
    if (nothing.includes('没有画面描述'))
      ok('a shot with no subject anywhere says so instead of going out empty')
    else bad('silent empty shot', nothing)

    // The old template must not come back: instructing the model to assemble
    // prefix + subject + suffix is the failure the五层 rewrite undid.
    if (!/风格前缀|风格后缀：/.test(full)) ok('the message never hands over a prefix/suffix template')
    else bad('template returned', full)

    // Narration rides along labelled as atmosphere, or the model draws the words.
    if (full.includes('参考台词氛围：')) ok('narration is labelled as atmosphere, not subject')
    else bad('unlabelled narration', full)

    // Async, incremental — the same protocol the audio screen uses.
    if (full.includes('异步') && full.includes('不要等全部跑完'))
      ok('the message asks for async, incremental submission')
    else bad('missing async protocol', full)
  }


  console.log('\n== 源码都在仓库里 ==')
  {
    // .gitignore said `client/` to exclude the BUILD output. A bare directory
    // pattern matches at any depth, so it also swallowed `src/client/` -- the
    // whole UI, twenty-four files, never committed. `git status` stayed clean
    // the entire time, which is exactly why nothing caught it: an ignored file
    // is indistinguishable from a file that does not need committing.
    //
    // Comparing what is on disk against what git tracks is the only check that
    // sees the difference.
    const fs = await import('node:fs')
    const { execFileSync } = await import('node:child_process')
    let tracked
    try {
      tracked = new Set(execFileSync('git', ['ls-files'], { encoding: 'utf-8' })
        .split(String.fromCharCode(10)).filter((line) => line !== ''))
    } catch {
      tracked = undefined
    }
    if (tracked === undefined) {
      // A published tarball has no git. Nothing to check, and nothing broken.
      ok('no git here, so nothing to compare (skipped)')
    } else {
      const missing = []
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const path = dir + '/' + entry.name
          if (entry.isDirectory()) walk(path)
          else if (/\.(ts|tsx|mjs|json|md)$/.test(entry.name) && !tracked.has(path)) missing.push(path)
        }
      }
      for (const dir of ['src', 'test', 'docs']) if (fs.existsSync(dir)) walk(dir)
      if (missing.length === 0) ok('every source file under src/, test/ and docs/ is tracked by git')
      else bad('untracked source', missing.length + ' file(s), e.g. ' + missing.slice(0, 4).join(', '))
    }

    // The root cause, asserted directly: an unanchored directory pattern.
    const ignore = fs.readFileSync('.gitignore', 'utf-8')
    const unanchored = ignore.split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .filter((line) => line.endsWith('/') && !line.startsWith('/') && !line.includes('*'))
      .filter((line) => line !== 'node_modules/')
    if (unanchored.length === 0) ok('build-output ignores are anchored, so they cannot match a nested directory')
    else bad('unanchored ignore', unanchored.join(', ') + ' matches at any depth')
  }
  console.log('\n== 配音请求 ==')
  {
    // The sibling of 生图请求, and here for the same reason: while this string
    // lived inside the voice screen as a closure, nothing could check it, and
    // a line silently missing from it looks exactly like a line that is there.
    const { buildVoiceJob } = await import('../lib/voice-job.js')
    const base = {
      workflow: 'Alpha-TTS',
      voice: 'jiangshuo_male',
      sections: [
        { id: 's1', text: '三十年前，科幻片还在预言未来。', deliveryNote: '沉稳，略慢' },
        { id: 's2', text: '现在它在描述昨天。', deliveryNote: '' },
      ],
    }

    const plain = buildVoiceJob({ ...base, voiceReferences: [] })
    if (plain.includes('`jiangshuo_male`') && plain.includes('三十年前') && plain.includes('表达：沉稳，略慢'))
      ok('voice, lines and delivery notes all reach the message')
    else bad('voice job body', plain)

    // An ordinary library voice must not grow a reference line out of nowhere:
    // a workflow with no reference input would be handed a parameter it has no
    // slot for.
    if (!plain.includes('参考音频')) ok('with no reference clips the message says nothing about them')
    else bad('phantom reference', plain)

    const one = buildVoiceJob({ ...base, voiceReferences: ['clone-a.wav'] })
    if (one.includes('参考音频：`clone-a.wav`')) ok('a single reference clip is named')
    else bad('one reference lost', one)

    // The regression this exists to catch. The shots screen shipped a request
    // whose positive prompt had gone missing and nothing failed; a reference
    // clip is the same shape of omission -- the run still succeeds, it just
    // clones nobody.
    const many = buildVoiceJob({ ...base, voiceReferences: ['clone-a.wav', 'clone-b.flac'] })
    if (many.includes('clone-a.wav') && many.includes('clone-b.flac')
      && many.includes('参考音频1') && many.includes('参考音频2'))
      ok('several reference clips ship numbered, so slot order survives')
    else bad('references lost', many)

    // Names only. Telling the model which node to load them into would be a
    // second, staler copy of the workflow's own parameter list.
    if (!/LoadAudio|加载节点/.test(many)) ok('the message names files, not loader nodes')
    else bad('loader named', many)

    // Same protocol as the shots screen: a failure on the last segment must not
    // throw away every earlier one.
    if (plain.includes('异步') && plain.includes('不要等全部跑完') && plain.includes('不要提交 completed'))
      ok('the message asks for async, incremental submission and no self-approval')
    else bad('missing async protocol', plain)
  }


  console.log('\n== 参考音频面板 ==')
  {
    const fs = await import('node:fs')
    const picker = fs.readFileSync('src/client/asset-picker.tsx', 'utf-8')

    // The bug this closes. The picker was written for reference images and its
    // file input said accept="image/*". Opened for audio it filtered every
    // file out -- the browser's dialog simply showed nothing selectable, with
    // no error to explain why.
    if (!picker.includes('accept="image')) ok('the picker no longer hard-codes an image filter')
    else bad('image-only picker', 'an image-only accept is still in the source')
    if (picker.includes('const accept = wanted.map') && picker.includes('accept={accept}'))
      ok('the file filter is derived from the kinds the picker was opened for')
    else bad('accept not derived', 'the input filter does not follow `kinds`')

    // Two panels, one upload path. Renaming it to uploadAsset was the point:
    // an `uploadImage` that also takes audio invites the next person to add a
    // second one.
    const comfyClient = fs.readFileSync('src/client/comfy.ts', 'utf-8')
    if (comfyClient.includes('uploadAsset') && !comfyClient.includes('uploadImage'))
      ok('there is one upload path, not one per media type')
    else bad('upload path', 'uploadImage still exists alongside uploadAsset')

    // ComfyUI's only upload endpoint is /upload/image and its form field is
    // `image` whatever the bytes are. Renaming the field to match the media
    // would 400, so the field name is asserted rather than left to intuition.
    if (comfyClient.includes("form.append('image'")) ok('the multipart field stays `image`, as ComfyUI requires')
    else bad('upload field renamed', 'ComfyUI /upload/image only reads the `image` field')

    // Audio references must not be handed to the image workflow, or the other
    // way round: two lists, two pickers, each opened for one kind.
    const audioScreen = fs.readFileSync('src/client/audio-screen.tsx', 'utf-8')
    const shotsScreen = fs.readFileSync('src/client/shots-screen.tsx', 'utf-8')
    if (audioScreen.includes("kinds={['audio']}")) ok('the voice screen opens the picker for audio only')
    else bad('voice picker kind', 'the voice screen does not restrict the picker to audio')
    if (shotsScreen.includes("kinds={['image']}")) ok('the shots screen still opens it for images only')
    else bad('shots picker kind', 'the shots screen lost its image restriction')

    // It has to actually be on screen, and it has to preview rather than list.
    const bundle = fs.readFileSync('client/client.js', 'utf-8')
    if (bundle.includes('参考音频')) ok('the 参考音频 panel ships in the bundle')
    else bad('panel missing', 'no 参考音频 in the client bundle')
    if (audioScreen.includes('setPlayingRef') && audioScreen.includes('<audio'))
      ok('a reference clip can be auditioned in place, not just named')
    else bad('no preview', 'the reference slots only show a filename')
  }
  console.log('\n== 镜头语言技能 ==')
  {
    const { STUDIO_CINEMATOGRAPHY_SKILL } = await import('../lib/skill-cinematography.js')
    const schema = await import('../lib/schema.js')
    const body = STUDIO_CINEMATOGRAPHY_SKILL.content

    // The gesture the panel sends has to name a skill that exists, and match
    // the harness grammar exactly: /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/
    // A typo here degrades silently -- the message still sends, the body never
    // loads, and the model designs shot language with no guidance at all.
    const name = STUDIO_CINEMATOGRAPHY_SKILL.name
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) ok('the skill name matches the harness gesture grammar')
    else bad('ungrammatical skill name', name)

    const bundleText = (await import('node:fs')).readFileSync('client/client.js', 'utf-8')
    if (bundleText.includes('/' + name)) ok('the panel sends a load gesture naming this exact skill')
    else bad('gesture missing or misspelled', 'bundle does not contain /' + name)

    // Every enum the skill tells the model to use must be one the schema
    // accepts, or its advice produces SCHEMA INVALID.
    // Only enum-SHAPED tokens (snake_case with an underscore). Plain words in
    // backticks are the skill's own ✗ examples of language to avoid -- checking
    // those against the schema would flag the advice for being advice.
    const named = [...body.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((match) => match[1])
    const vocab = new Set([
      ...schema.SHOT_SIZES, ...schema.CAMERA_MOVEMENTS, ...schema.LIGHTING_KEYS,
      ...schema.COLOR_TEMPERATURES, ...schema.DEPTHS_OF_FIELD,
      'shot_size', 'camera_movement', 'lens_mm', 'lighting_key', 'color_temperature',
      'depth_of_field', 'scene_plan', 'shot_index', 'hero_moment', 'texture_keywords',
      'prompt', 'shot_language', 'assets_shots', 'in_progress', 'status', 'get', 'script',
      'target_platform', 'variation', 'revise', 'fail', 'version', 'shots',
      // Tool and API names the skill legitimately references.
      'studio_stage', 'studio_project', 'asset_manifest_shots',
    ])
    const invented = [...new Set(named)].filter((token) => !vocab.has(token))
    if (invented.length === 0) ok('every enum the skill names is one the schema accepts')
    else bad('skill invents vocabulary', JSON.stringify(invented))

    // The craft content that makes this worth loading at all. Without the
    // sequence rules it is just a restatement of the enum list, which the main
    // skill already carries.
    for (const idea of ['序列', '连着三镜', '高光', 'establishing', '质感']) {
      if (!body.includes(idea)) bad('skill missing craft content', idea)
    }
    ok('the skill carries sequence craft, not just the enum list')

    // The trap the builder itself has: a framing phrase that presumes a person.
    if (body.includes('waist up')) ok('the skill warns about the framing phrase that invents a person')
    else bad('missing framing warning', 'medium shot phrase trap not mentioned')

    // Adjectives are the failure this table exists to prevent: the same "moody"
    // routes to a different picture every render, so the skill has to hand over
    // the CAUSES instead of the word. Ported from OM's cinematic.md.
    if (body.includes('cinematic') && body.includes('禁用'))
      ok('the skill bans the adjective that names a bundle of choices')
    else bad('adjective not banned', 'no ban on cinematic as a prompt word')
    for (const cause of ['low_key', 'medium_close', 'extreme_wide', 'golden_hour']) {
      if (!body.includes(cause)) bad('mood table incomplete', cause)
    }
    ok('the skill translates feelings into concrete field values')

    // The rate table has to agree with what the scorer actually enforces, or
    // the skill tells the model to aim at a number that will be marked down.
    const { BUILT_IN_PLAYBOOKS: books } = await import('../lib/playbooks.js')
    const { scoreSlideshowRisk: score } = await import('../lib/slideshow.js')
    const disagreeing = []
    for (const [id, pb] of Object.entries(books)) {
      const one = [{ id: 'a', section_id: 's', shot_index: 0, prompt: 'x' }]
      // Exactly at the floor the skill advertises for this profile.
      const advertised = { contemplative: 3, conversational: 5, technical: 5, cinematic: 8, energetic: 12 }
      const floor = advertised[pb.narration.pacing_profile]
      const seconds = (1 / floor) * 60
      const at = score(one, [{ sectionId: 's', duration: seconds, shots: [{ index: 0, duration: seconds }] }], pb)
      if (at.dimensions.picture_rate.score !== 0) disagreeing.push(id + ' at ' + floor + '/min scores ' + at.dimensions.picture_rate.score)
    }
    if (disagreeing.length === 0) ok('the rate the skill advertises is the rate the scorer passes')
    else bad('skill and scorer disagree', JSON.stringify(disagreeing))

    // It must not tell the model to generate anything: this step is words only.
    if (body.includes('不生成') || body.includes('不要提交 completed'))
      ok('the skill says plainly that this step generates nothing')
    else bad('generation not ruled out', 'skill could be read as asking for pictures')
  }


  console.log('\n== 编辑模式的配乐播放 ==')
  {
    // The preview is a plain class -- no React, no DOM past two audio elements
    // -- so it is driven directly here rather than asserted about as source
    // text. Both of the bugs this covers looked completely fine on the page.
    const made = []
    globalThis.Audio = class FakeAudio {
      constructor(src) {
        this.src = src
        this.volume = 1
        this.currentTime = 0
        this.duration = NaN
        this.loop = false
        this.preload = ''
        this.paused = true
        this.seeking = false
        this.readyState = 4
        made.push(this)
      }

      play() { this.paused = false; return Promise.resolve() }
      pause() { this.paused = true }
    }
    // The clock is driven by hand: a real rAF would make every assertion a race.
    let frame
    globalThis.requestAnimationFrame = (fn) => { frame = fn; return 1 }
    globalThis.cancelAnimationFrame = () => { frame = undefined }

    const { Preview } = await import('../src/client/preview.ts')

    // Two sections: speech from 1.0 to 3.0, then silence to 6.0.
    const sections = [
      { sectionId: 's1', start: 0, duration: 3, speechSeconds: 2, lead: 1, trimStart: 0, narrationPath: 'assets/audio/01-s1.wav' },
      { sectionId: 's2', start: 3, duration: 3, speechSeconds: 0, lead: 0, trimStart: 0 },
    ]
    // Resolved by the caller, as the screen does -- Preview takes numbers, not
    // stored settings, so that it stays importable without host code.
    const { DUCK_DB, MIX_BOUNDS, gainToVolume, resolveMusicSettings } =
      await import('../lib/audio-mix.js')
    const bedFor = (path, overrides = {}) => {
      const mix = resolveMusicSettings(overrides)
      return {
        path,
        gain: gainToVolume(mix.gainDb),
        ducked: gainToVolume(mix.gainDb + DUCK_DB),
        fadeInSeconds: mix.fadeInSeconds,
        fadeOutSeconds: mix.fadeOutSeconds,
      }
    }
    const build = (musicPath, overrides) => {
      made.length = 0
      let now = 0
      globalThis.performance = { now: () => now * 1000 }
      const preview = new Preview({
        projectId: 'smoke',
        sections,
        ...(musicPath === undefined ? {} : { music: bedFor(musicPath, overrides) }),
        onTick: () => {},
        onEnd: () => {},
      })
      return { preview, at: (seconds) => { now = seconds }, bed: () => made[made.length - 1] }
    }

    // No bed on the project means no element at all.
    const silent = build(undefined)
    if (made.length === 1) ok('a project with no bed builds only its narration clips')
    else bad('spurious element', made.length + ' audio elements')
    silent.preview.dispose()

    const run = build('assets/audio/music.wav')
    const bed = run.bed()
    if (bed.src.includes('music.wav')) ok('the bed is loaded from the project path')
    else bad('bed src', bed.src)
    // The render loops a short bed to fill the film; a preview that stops
    // halfway is judging a different cut than the one being exported.
    if (bed.loop === true) ok('the bed loops, as the render does')
    else bad('no loop', 'a short bed would go silent mid-film')

    // Starting mid-film must aim the bed at the same point the render's
    // -stream_loop would be at, not restart it from zero.
    bed.duration = 4
    run.at(100)
    run.preview.play(5)
    if (!bed.paused && Math.abs(bed.currentTime - 1) < 0.001)
      ok('starting at 5s into a 4s bed lands at 1s, where the loop actually is')
    else bad('bed not aimed', 'paused=' + bed.paused + ' currentTime=' + bed.currentTime)

    // The duck. Levels are the render's own, converted to linear gain.
    // The clock is pinned BEFORE play, because `origin` is computed there: move
    // it afterwards and every tick reads a position neither the test nor the
    // player intended. Holding it still is what makes a frame loop mean
    // "the same instant, repeatedly".
    const settle = (seconds, frames) => {
      run.at(100)
      run.preview.play(seconds)
      for (let index = 0; index < frames; index += 1) {
        run.at(100)
        if (frame !== undefined) frame()
      }
    }
    settle(4.0, 120)
    const quiet = bed.volume
    settle(2.0, 120)
    const ducked = bed.volume
    if (Math.abs(quiet - 0.1) < 0.005) ok('between sentences the bed sits at the -20 dB it renders at')
    else bad('bed level', String(quiet))
    if (Math.abs(ducked - 0.04) < 0.005) ok('under speech it ducks to -28 dB, as the sidechain does')
    else bad('no duck in preview', String(ducked))

    // Section s2 has no narration file. It is still speech time in the
    // timeline when it has any, and a duck keyed off "is a clip playing"
    // rather than "is this speech" would miss exactly that case.
    // Long enough that the test point sits clear of both fades, so this
    // measures the duck and only the duck.
    const gapless = [
      { sectionId: 'g1', start: 0, duration: 10, speechSeconds: 6, lead: 0, trimStart: 0 },
    ]
    made.length = 0
    let clock = 0
    globalThis.performance = { now: () => clock * 1000 }
    const orphan = new Preview({
      projectId: 'smoke', sections: gapless, music: bedFor('assets/audio/music.wav'),
      onTick: () => {}, onEnd: () => {},
    })
    const orphanBed = made[made.length - 1]
    clock = 100
    orphan.play(3)
    for (let index = 0; index < 120; index += 1) { clock = 100; if (frame !== undefined) frame() }
    if (Math.abs(orphanBed.volume - 0.04) < 0.005)
      ok('a section whose narration is missing still ducks the bed')
    else bad('duck missed', String(orphanBed.volume))
    orphan.dispose()

    // ---- the fades, which are settings now ------------------------------

    // The render fades the bed at both ends with afade. A preview that ignored
    // that would let someone set an eight-second swell and hear nothing of it
    // until the export -- the one moment the setting is impossible to judge.
    const swell = build('assets/audio/music.wav', { fadeInSeconds: 2, fadeOutSeconds: 2 })
    const swellBed = swell.bed()
    const levelAt = (seconds) => {
      swell.at(100)
      swell.preview.play(seconds)
      for (let index = 0; index < 300; index += 1) {
        swell.at(100)
        if (frame !== undefined) frame()
      }
      return swellBed.volume
    }
    // EXACT levels, not just "lower than the middle". The duck glides toward
    // its target frame by frame, and an implementation that read the already-
    // enveloped volume back off the element would feed the fade into that
    // glide -- the two would settle somewhere neither asked for, still lower
    // in a fade than out of one, so an ordering check would pass a mix that is
    // several times too quiet. The film is 6s; speech runs 1.0-3.0.
    const bedGain = gainToVolume(MIX_BOUNDS.gainDb.default)
    const close = (actual, expected) => Math.abs(actual - expected) < 0.002
    if (close(levelAt(0.8), bedGain * 0.4)) ok('the bed fades in on the project curve, at the right level')
    else bad('fade-in level', levelAt(0.8) + ' want ' + bedGain * 0.4)
    if (close(levelAt(3.5), bedGain)) ok('and sits at full level clear of both fades')
    else bad('mid level', levelAt(3.5) + ' want ' + bedGain)
    if (close(levelAt(5.5), bedGain * 0.25)) ok('and fades out into the last seconds')
    else bad('fade-out level', levelAt(5.5) + ' want ' + bedGain * 0.25)

    // Zero means no fade, not a divide by zero.
    const abrupt = build('assets/audio/music.wav', { fadeInSeconds: 0, fadeOutSeconds: 0 })
    const abruptBed = abrupt.bed()
    abrupt.at(100)
    abrupt.preview.play(0)
    for (let index = 0; index < 200; index += 1) { abrupt.at(100); if (frame !== undefined) frame() }
    if (Number.isFinite(abruptBed.volume) && abruptBed.volume > 0.05)
      ok('a zero fade starts at full level rather than at NaN')
    else bad('zero fade', String(abruptBed.volume))
    abrupt.preview.dispose()
    swell.preview.dispose()

    // Out-of-range values are clamped by the same function the render uses, so
    // the loudest a bed can be here is the loudest it can be in the file.
    const shouted = resolveMusicSettings({ gainDb: 40, fadeInSeconds: -3 })
    if (shouted.gainDb === MIX_BOUNDS.gainDb.max && shouted.fadeInSeconds === 0)
      ok('out-of-range mix settings clamp rather than pass through')
    else bad('no clamp', JSON.stringify(shouted))
    if (resolveMusicSettings(undefined).gainDb === -20)
      ok('an untouched project still gets the spec level')
    else bad('default drifted', String(resolveMusicSettings(undefined).gainDb))

    // Pausing the film must stop the bed too, or the music plays on over a
    // frozen picture.
    run.preview.pause()
    if (bed.paused) ok('pausing the preview pauses the bed')
    else bad('bed kept playing', 'the music runs over a stopped picture')
    run.preview.dispose()
    if (bed.src === '') ok('disposing releases the bed')
    else bad('bed leaked', bed.src)
  }
  console.log('\n== 配乐面板 ==')
  {
    const fs = await import('node:fs')
    const screen = fs.readFileSync('src/client/timeline-screen.tsx', 'utf-8')
    const bundle = fs.readFileSync('client/client.js', 'utf-8')

    if (bundle.includes('配乐')) ok('the 配乐 panel ships in the bundle')
    else bad('panel missing', 'no 配乐 in the client bundle')

    // Always on screen, bed or no bed. An empty screen cannot tell you that a
    // music track is something this film can have -- the same reason the advice
    // panel renders when it is clean.
    if (!screen.includes('{musicPath === undefined ? null : (\n        <section className="dcs-panel dcs-music"'))
      ok('the panel is rendered whether or not a bed exists yet')
    else bad('panel hidden when empty', 'no bed means no way to add one')

    // A filename is not a preview. The bed has to be playable in place, the
    // same rule the media card and the reference slots follow.
    // Bounded by the section's own end rather than a character count: the panel
    // grew past the old window and the check reported a missing preview that
    // was there all along.
    const panelAt = screen.indexOf('dcs-panel dcs-music')
    const panelEnd = screen.indexOf('</section>', panelAt)
    if (panelAt !== -1 && screen.slice(panelAt, panelEnd).includes('<audio'))
      ok('the bed can be played on the page, not just named')
    else bad('no preview', 'the panel only shows a filename')

    // And it has to appear as a track on the timeline, which is what the user
    // asked for: one block the length of the film, because that is what it is.
    if (screen.includes('dcs-music-block') && screen.includes("dcs-lane-label-plain\">配乐"))
      ok('the bed shows as its own lane over the shared time axis')
    else bad('no lane', 'the timeline has no music track')

    // ...IN the lane, not floating over the ruler. dcs-lane-blocks is an
    // unpositioned flex row, so an absolutely-positioned child resolves against
    // whatever is positioned further up the tree and lands at the top of the
    // track. The cue lane is the exception and pays for it with its own
    // position: relative; the bed spans the whole lane and needs neither.
    const sheet = (await import('node:fs')).readFileSync('src/client/workbench-styles.ts', 'utf-8')
    const ruleOf = (selector) => {
      const at = sheet.indexOf(selector + ' {')
      return at === -1 ? '' : sheet.slice(at, sheet.indexOf('}', at))
    }
    const laneRow = ruleOf('.dcs-lane-blocks')
    const block = ruleOf('.dcs-music-block')
    if (block !== '' && !block.includes('position: absolute'))
      ok('the bed block is laid out by the lane, not positioned over it')
    else bad('bed escapes its lane', block.trim())
    // The reason the rule above matters, asserted rather than assumed: if the
    // lane ever gains position: relative the constraint can be relaxed, and
    // this says so out loud instead of leaving a rule nobody can re-derive.
    if (!laneRow.includes('position:'))
      ok('...and the lane it sits in is still unpositioned, which is why')
    else bad('lane now positioned', laneRow.trim())

    // The message goes through the shared builder, so the skill gesture and the
    // import instruction cannot drift from what the tests check.
    if (screen.includes('buildMusicJob(')) ok('the panel sends the built request, not a second copy of it')
    else bad('inline message', 'the timeline screen composes its own music request')

    // Saving is explicit. It used to happen on blur, which gave no sign it had
    // -- the only way to find out was to reload the page. Three more fields
    // saving that way would have been three more things to doubt.
    const panelSlice = panelAt === -1 ? '' : screen.slice(panelAt, panelEnd)
    if (panelSlice.includes('commitMusic()') && !panelSlice.includes('onBlur'))
      ok('the music form saves on a button, not silently on blur')
    else bad('blur save', 'the form still persists without saying so')
    if (screen.includes('musicDirty') && screen.includes('未保存'))
      ok('and says so while anything is unsaved')
    else bad('no dirty marker', 'nothing shows that the form has unsaved changes')
  }
  console.log('\n== 技能是否真的会加载 ==')
  {
    const { apply: applySkills, Config: SkillConfig } = await import('../lib/index.js')
    const host = fakeHost()
    applySkills(host.ctx, SkillConfig({ workspaceRoot: WS }))
    const { MUSIC_SKILL } = await import('../lib/music-job.js')

    // The gesture is the host's own injection path: ctx.skills.register
    // publishes the body, and a `/name` on a user message makes the host splice
    // it in before the step. The panel is not asking the model to go read
    // something -- but the whole thing is silent when the name does not
    // resolve, so the panel has to be able to ask.
    const good = (await callRoute(host.routes, '/studio/skill',
      '/studio/skill?name=' + MUSIC_SKILL, {})).json()
    if (good.known && good.loadable && good.registry)
      ok('the skill the music request invokes is registered and user-invocable')
    else bad('skill not loadable', JSON.stringify(good))

    // Registered but not user-invocable is a DIFFERENT failure from absent, and
    // the panel says something different about each -- one is a restart, the
    // other is a policy.
    const missing = (await callRoute(host.routes, '/studio/skill',
      '/studio/skill?name=dsh-creative-studio-not-a-skill', {})).json()
    if (missing.registry && !missing.known && !missing.loadable)
      ok('an unregistered name reports absent rather than merely unloadable')
    else bad('unknown skill', JSON.stringify(missing))

    // Registered is not the same as loadable. Other providers' skills can carry
    // a policy that excludes user invocation, and the gesture honours it -- so
    // a route answering "it exists" would tell the panel to send a request
    // whose skill still would not load.
    host.skills.set('policy#0', {
      name: 'dsh-creative-studio-locked',
      invocation: { modelInvocable: true, userInvocable: false },
    })
    const locked = (await callRoute(host.routes, '/studio/skill',
      '/studio/skill?name=dsh-creative-studio-locked', {})).json()
    if (locked.known && !locked.loadable)
      ok('a registered but non-user-invocable skill reports known and unloadable')
    else bad('policy ignored', JSON.stringify(locked))
    host.skills.delete('policy#0')

    const blank = await callRoute(host.routes, '/studio/skill', '/studio/skill', {})
    if (blank.statusCode === 400) ok('the route needs a name')
    else bad('blank name', String(blank.statusCode))

    // Every runtime skill this plugin registers has to pass the same check the
    // gesture applies, or a panel that invokes it degrades to plain prose.
    const names = [...host.skills.values()].map((skill) => skill.name)
    const unloadable = []
    for (const name of names) {
      const answer = (await callRoute(host.routes, '/studio/skill',
        '/studio/skill?name=' + encodeURIComponent(name), {})).json()
      if (!answer.loadable) unloadable.push(name)
    }
    if (unloadable.length === 0) ok('all ' + names.length + ' registered skills would load from a gesture')
    else bad('skills that cannot be invoked', unloadable.join(', '))

    // A host with no skill registry at all must NOT read as "the skill is
    // missing" -- that would send the user looking for the wrong thing.
    const bare = fakeHost()
    const withSkills = bare.ctx.get
    bare.ctx.get = (name) => (name === 'skills' ? undefined : withSkills(name))
    applySkills(bare.ctx, SkillConfig({ workspaceRoot: WS }))
    const none = (await callRoute(bare.routes, '/studio/skill',
      '/studio/skill?name=' + MUSIC_SKILL, {})).json()
    if (none.registry === false && none.loadable === false)
      ok('no skill registry reports itself as such, not as a missing skill')
    else bad('bare host', JSON.stringify(none))
    bare.disposeAll()
    host.disposeAll()
  }

  // The panel gates on that answer instead of sending a request whose guidance
  // would silently not arrive.
  {
    const screen = (await import('node:fs')).readFileSync('src/client/timeline-screen.tsx', 'utf-8')
    if (screen.includes('api.skill(MUSIC_SKILL)') && screen.includes('这里不发'))
      ok('the music panel refuses to send when its skill would not load')
    else bad('no gate', 'the panel sends regardless of whether the skill loads')
  }

  console.log('\n== studio_edit：剪辑版本与裁剪 ==')
  {
    const { registerStudioTools: regEdit } = await import('../lib/tools.js')
    const editTools = new Map()
    regEdit(
      { tools: { register: (definition) => { editTools.set(definition.name, definition); return () => {} } } },
      { machine, getConfig: () => config },
    )
    const tool = editTools.get('studio_edit')
    const call = async (args) => tool.execute(args, { signal: new AbortController().signal })

    // ---- cuts round-trip -------------------------------------------------

    const empty = await call({ action: 'cuts', project: 'smoke' })
    if (empty.cuts.length === 0) ok('a project with no cuts lists none rather than failing')
    else bad('cuts baseline', JSON.stringify(empty.cuts.map((c) => c.id)))

    const saved = await call({
      action: 'save_cut',
      project: 'smoke',
      cut: {
        id: 'agent-cut',
        name: '代理剪辑',
        note: '试试更短的开头',
        sections: [{ id: 's1', lead: 0.4, tail: 0.2, cues: [{ text: '第一句' }, { text: '第二句', weight: 2 }] }],
      },
    })
    if (saved.cut.id === 'agent-cut' && saved.replaced === false) ok('the agent can save a cut')
    else bad('save_cut', JSON.stringify(saved))
    // Weights and pads have to survive the round trip, or the cut the agent
    // saved is not the cut that renders.
    const section = saved.cut.sections[0]
    if (section?.lead === 0.4 && section?.cues?.[1]?.weight === 2)
      ok('pads and cue weights survive the round trip')
    else bad('cut fields dropped', JSON.stringify(section))

    // The SAME parser the panel route uses, so a value the panel could never
    // produce cannot arrive down this path either.
    const clamped = await call({
      action: 'save_cut',
      project: 'smoke',
      cut: { id: 'agent-cut', name: '代理剪辑', sections: [{ id: 's1', lead: 999, tail: -3 }] },
    })
    const bounded = clamped.cut.sections[0]
    if (bounded.lead === 10 && bounded.tail === undefined)
      ok('the agent path clamps exactly like the panel path')
    else bad('clamping', JSON.stringify(bounded))
    if (clamped.replaced === true) ok('saving a known id says it replaced rather than added')
    else bad('replace not reported', JSON.stringify(clamped.replaced))

    const listed = await call({ action: 'cuts', project: 'smoke' })
    if (listed.cuts.length === 1 && listed.cuts[0].id === 'agent-cut')
      ok('the saved cut comes back in the listing')
    else bad('listing', JSON.stringify(listed.cuts.map((c) => c.id)))

    // A cut id names a file, so it is held to the same shape as a project id.
    let badId
    await call({ action: 'save_cut', project: 'smoke', cut: { id: '../escape', name: 'x' } })
      .catch((error) => { badId = String(error.message ?? error) })
    if (badId !== undefined && badId.includes('cut id')) ok('a cut id that would escape the directory is refused')
    else bad('cut id escape', badId ?? 'accepted')

    let missing
    await call({ action: 'delete_cut', project: 'smoke', id: 'never-existed' })
      .catch((error) => { missing = String(error.message ?? error) })
    if (missing !== undefined && missing.includes('no cut')) ok('deleting a cut that is not there says so')
    else bad('delete missing', missing ?? 'reported success')

    const removed = await call({ action: 'delete_cut', project: 'smoke', id: 'agent-cut' })
    const after = await call({ action: 'cuts', project: 'smoke' })
    if (removed.deleted === 'agent-cut' && after.cuts.length === 0) ok('the agent can delete a cut')
    else bad('delete_cut', JSON.stringify(after.cuts.map((c) => c.id)))

    // ---- trim ------------------------------------------------------------

    const clip = 'assets/audio/s1.wav'
    const before = (await fs.stat(join(layout.dir, clip))).size
    const trimmed = await call({ action: 'trim_audio', project: 'smoke', path: clip, start: 0.5, end: 1.5 })
    const now = (await fs.stat(join(layout.dir, clip))).size
    if (now < before && trimmed.bytes === now) ok('the agent can trim a take (' + before + ' -> ' + now + ' bytes)')
    else bad('trim_audio', before + ' -> ' + now)
    // ffprobe is the honest check: a file can shrink for reasons other than
    // being shorter.
    const probed = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(layout.dir, clip),
    ])
    const seconds = Number(probed.stdout.trim())
    if (Math.abs(seconds - 1.0) < 0.1) ok('the trimmed clip really is one second long')
    else bad('trim duration', seconds + 's, expected ~1.0')

    let escaped
    await call({ action: 'trim_audio', project: 'smoke', path: '../../secrets.wav', start: 0 })
      .catch((error) => { escaped = String(error.message ?? error) })
    if (escaped !== undefined) ok('a trim path climbing out of the project is refused')
    else bad('trim escape', 'reached the filesystem')

    let backwards
    await call({ action: 'trim_audio', project: 'smoke', path: clip, start: 2, end: 1 })
      .catch((error) => { backwards = String(error.message ?? error) })
    if (backwards !== undefined && backwards.includes('greater than start'))
      ok('an end before the start is refused rather than producing an empty file')
    else bad('backwards trim', backwards ?? 'accepted')
  }

  console.log('\n== 目标平台：agent 也能改 ==')
  {
    const { registerStudioTools: regPlat } = await import('../lib/tools.js')
    const platTools = new Map()
    regPlat(
      { tools: { register: (definition) => { platTools.set(definition.name, definition); return () => {} } } },
      { machine, getConfig: () => config },
    )
    const projectTool = platTools.get('studio_project')
    const callProject = async (args) => projectTool.execute(args, { signal: new AbortController().signal })

    const set = await callProject({ action: 'set_platform', project: 'smoke', target_platform: 'douyin' })
    // The frame is REPORTED, not left implied -- the whole reason the field
    // exists is that a declaration nothing acts on reads like a decision.
    if (set.profile.width === 1080 && set.profile.height === 1920 && set.profile.source === 'platform')
      ok('setting 抖音 reports the portrait frame it implies')
    else bad('set_platform frame', JSON.stringify(set.profile))
    if (set.project.target_platform === 'douyin') ok('the platform is stored on the project')
    else bad('platform not stored', JSON.stringify(set.project.target_platform))

    const generic = await callProject({ action: 'set_platform', project: 'smoke', target_platform: 'generic' })
    if (generic.profile.source === 'settings') ok("'generic' hands the frame back to the settings")
    else bad('generic frame', JSON.stringify(generic.profile))

    let rejected
    await callProject({ action: 'set_platform', project: 'smoke', target_platform: 'myspace' })
      .catch((error) => { rejected = String(error.message ?? error) })
    if (rejected !== undefined && rejected.includes('must be one of'))
      ok('an unknown platform is refused with the list')
    else bad('platform validation', rejected ?? 'accepted')
  }

  console.log('\n== 人机同径：面板能做的 agent 也要能做 ==')
  {
    // CONVENTIONS §8. Every one of these is something the panel does with a
    // button; an unattended run has no panel, so each needs a way in. This is
    // the list, checked rather than remembered -- the failure it guards against
    // is adding a seventh panel-only button and noticing a release later.
    const { registerStudioTools: regAll } = await import('../lib/tools.js')
    const allTools = new Map()
    regAll(
      { tools: { register: (definition) => { allTools.set(definition.name, definition); return () => {} } } },
      { machine, getConfig: () => config },
    )

    // Reachability is read off the ACTION ENUM and the declared parameters,
    // never off the serialized schema as text. Searching the JSON for the word
    // matched the action names in their own `path`/`start` descriptions, so
    // deleting trim_audio from the enum left this passing -- the check said
    // "the schema mentions it" when it meant "the model can call it".
    const actionsOf = (tool) => allTools.get(tool)?.parameters?.properties?.action?.enum ?? []
    const paramsOf = (tool) => Object.keys(allTools.get(tool)?.parameters?.properties ?? {})

    const reachable = [
      ['保存剪辑版本', 'studio_edit', 'action', 'save_cut'],
      ['删除剪辑版本', 'studio_edit', 'action', 'delete_cut'],
      ['列出剪辑版本', 'studio_edit', 'action', 'cuts'],
      ['裁剪音频', 'studio_edit', 'action', 'trim_audio'],
      ['目标平台', 'studio_project', 'action', 'set_platform'],
      ['导入素材', 'studio_project', 'action', 'import'],
      ['音色', 'studio_project', 'action', 'set_voice'],
      ['风格', 'studio_project', 'action', 'style'],
      // Compose takes no action enum; what the panel can choose per render is
      // what has to be reachable here.
      ['合成指定版本', 'studio_compose', 'param', 'cut'],
      ['烧录字幕', 'studio_compose', 'param', 'burn_subtitles'],
    ]
    const unreachable = reachable.filter(([, tool, kind, name]) =>
      !(kind === 'action' ? actionsOf(tool) : paramsOf(tool)).includes(name))
    if (unreachable.length === 0) ok('every panel action the agent needs has a tool path (' + reachable.length + ')')
    else bad('panel-only action', unreachable.map(([label]) => label).join(', '))
  }



  console.log('\n== 请求的共用收尾约定 ==')
  {
    const { buildShotJob } = await import('../lib/shot-job.js')
    const { buildVoiceJob } = await import('../lib/voice-job.js')
    const { buildMusicJob } = await import('../lib/music-job.js')

    const shots = buildShotJob({
      workflow: 'Alpha-Image',
      negativePrompt: 'text, watermark',
      references: [],
      shots: [{ sectionId: 's1', index: 0, seconds: 3, text: '台词', fallbackPrompt: 'a cat' }],
    })
    const voice = buildVoiceJob({
      workflow: 'Alpha-TTS',
      voice: 'v1',
      voiceReferences: [],
      sections: [{ id: 's1', text: '台词', deliveryNote: '' }],
    })
    const music = buildMusicJob({
      projectId: 'p', workflow: 'Alpha-Music', styleName: 's',
      pacingProfile: 'conversational', totalSeconds: 60,
    })

    // THE DRIFT THIS MODULE EXISTS FOR. All three name a workflow; only two of
    // them said which tool runs one. The shots request never mentioned
    // comfyui_workflow at all -- it named a workflow and left the model to
    // remember where workflows are run, which it did, most of the time.
    const missingTool = [['分镜', shots], ['配音', voice], ['配乐', music]]
      .filter(([, text]) => !text.includes('comfyui_workflow'))
    if (missingTool.length === 0) ok('every request naming a workflow also names the tool that runs one')
    else bad('workflow without a tool', missingTool.map(([label]) => label).join(', '))

    // Batches submit incrementally: waiting for the whole thing means a failure
    // on the last item throws away every earlier one, and the panel -- which
    // watches the manifest -- shows nothing until the very end.
    if (shots.includes('异步') && voice.includes('异步')) ok('both batch requests ask for incremental submission')
    else bad('async line', 'a batch request lost it')
    // The bed is one file. An async line there would be instructions for a loop
    // that does not exist.
    if (!music.includes('异步')) ok('the single-item request does not ask for a loop it has no items for')
    else bad('async on music', 'the bed request talks about submitting one at a time')

    // Governance, not preference: studio_stage refuses a completed without
    // human_approved, so a model that submits one gets a GATE VIOLATION and has
    // to be told why. Saying it up front turns the refusal into a known rule.
    if (shots.includes('不要提交 completed') && voice.includes('不要提交 completed'))
      ok('both gated batches are told to leave the gate shut')
    else bad('gate line', 'a gated request lost it')
    // Importing music advances no stage, so there is no gate to hold.
    if (!music.includes('不要提交 completed')) ok('the ungated request has no gate line to carry')
    else bad('gate on music', 'the bed request talks about a gate it does not touch')

    // The bed belongs to the film, not a section. A fabricated scene_id is
    // rejected as an orphan, so the request has to say so rather than leave the
    // model to guess a section for it.
    if (music.includes('不要填') && music.includes('scene_id')) ok('the bed request says it takes no scene_id')
    else bad('music scene_id', music)

    // Several pictures can share a section; takes cannot. Only the shots
    // request should carry shot_index -- this is the part that IS per-screen,
    // and folding it into the shared module would make it the union of three
    // requests rather than their intersection.
    if (shots.includes('shot_index') && !voice.includes('shot_index'))
      ok('the per-screen clause stayed per-screen')
    else bad('shot_index', 'it leaked into the takes request, or left the shots one')

    // Counted in the unit each screen actually deals in.
    if (shots.includes('逐张') && voice.includes('逐段')) ok('each batch is counted in its own unit')
    else bad('unit', 'a request counts in the wrong unit')

    // And the wording is now ONE definition: the same sentence, not two
    // spellings that happen to agree today.
    const { asyncLine, holdGateLine } = await import('../lib/job-conventions.js')
    if (shots.includes(asyncLine('张')) && voice.includes(asyncLine('段')))
      ok('both requests carry the shared sentence verbatim, not a copy of it')
    else bad('async drift', 'a builder has its own wording again')
    if (shots.includes(holdGateLine('看过')) && voice.includes(holdGateLine('听过')))
      ok('the gate line is the shared one in both')
    else bad('gate drift', 'a builder has its own wording again')

    // Wording assertions catch a builder that inlines DIFFERENT text. One that
    // inlines identical text drifts only on the next edit, so the import is
    // pinned too -- the same "one list, several places" rule as §5.4.
    const { readFileSync: readSource } = await import('node:fs')
    const inlined = ['shot-job', 'voice-job', 'music-job'].filter((name) =>
      !readSource('src/' + name + '.ts', 'utf-8').includes("from './job-conventions.js'"))
    if (inlined.length === 0) ok('every job builder takes its closing lines from the shared module')
    else bad('builder stopped sharing', inlined.join(', '))
  }

  console.log('\n== 管线技能：地图与地形分开 ==')
  {
    const { buildPipelineSkills, buildPipelineSkill } = await import('../lib/pipeline-skill.js')
    const { buildStageSkills, stageSkillName } = await import('../lib/stage-skills.js')
    const { PIPELINES } = await import('../lib/pipelines.js')
    const { Config: SkillConfig } = await import('../lib/config.js')

    const cfg = SkillConfig({ bindings: { tts: { workflow: 'Alpha-TTS' }, image: { workflow: 'Alpha-Image' } } })
    const pipeSkills = buildPipelineSkills(cfg)
    const stageSkills = buildStageSkills(cfg)
    const registered = new Set([
      ...pipeSkills.map((s) => s.name),
      ...stageSkills.map((s) => s.name),
      'dsh-creative-studio-storytelling',
      'dsh-creative-studio-cinematography',
      'dsh-creative-studio-sound-design',
      'dsh-creative-studio-reviewer',
      'dsh-creative-studio-usage',
    ])

    // A pipeline with no skill is a pipeline the model has no map for, and
    // nothing else would say so -- it would just work worse.
    if (pipeSkills.length === Object.keys(PIPELINES).length)
      ok('every pipeline gets a skill, rendered from its own data')
    else bad('pipeline skills', pipeSkills.length + ' skills for ' + Object.keys(PIPELINES).length + ' pipelines')

    // THE FAILURE THIS SECTION EXISTS FOR. The node map cites a /gesture per
    // stage. A gesture naming a skill that is not registered does not error:
    // the message sends, nothing loads, and the model does that step with no
    // instructions at all.
    const cited = []
    for (const skill of pipeSkills) {
      for (const match of skill.content.matchAll(/`\/([a-z0-9-]+)`/g)) cited.push([skill.name, match[1]])
    }
    const dangling = cited.filter(([, name]) => !registered.has(name))
    if (cited.length > 0 && dangling.length === 0)
      ok('every /gesture the node map cites names a registered skill (' + cited.length + ')')
    else if (cited.length === 0) bad('node map cites nothing', 'the map has no gestures at all')
    else bad('dangling gesture', dangling.map(([from, name]) => from + ' -> /' + name).join(', '))

    // And the other direction: a stage with no detail sheet.
    const missing = []
    for (const pipeline of Object.values(PIPELINES)) {
      for (const stage of pipeline.stages) {
        const wanted = stageSkillName(stage.id.replace(/_/g, '-'))
        if (!registered.has(wanted)) missing.push(pipeline.id + '/' + stage.id)
      }
    }
    if (missing.length === 0) ok('every stage of every pipeline has a detail sheet')
    else bad('stage with no skill', missing.join(', '))

    // The map has to actually list the stages, in order. A table rendered from
    // the wrong source would still look like a table.
    const explainer = pipeSkills.find((s) => s.name === 'dsh-creative-studio-explainer-stills')
    const order = PIPELINES['explainer-stills'].stages.map((s) => s.id)
    const positions = order.map((id) => explainer.content.indexOf('`' + id + '`'))
    if (positions.every((at, i) => at > 0 && (i === 0 || at > positions[i - 1])))
      ok('the node map lists every stage in pipeline order')
    else bad('node map order', JSON.stringify(positions))

    // A map that also carried the terrain would be the monolith this replaced.
    // The brief field table is the bulkiest piece of stage detail; if it is
    // back in the pipeline skill, the split has quietly undone itself.
    if (!explainer.content.includes('key_points') && !explainer.content.includes('core_message'))
      ok('the pipeline skill stayed a map -- no stage field tables in it')
    else bad('terrain in the map', 'the brief field table is back in the pipeline skill')

    // ...and the terrain has to still exist somewhere. Extraction by line range
    // is exactly the operation that silently drops a table row.
    const carries = [
      ['brief', 'core_message'],
      ['script', 'visual'],
      ['assets-audio', 'asset_manifest_audio'],
      ['assets-shots', 'shot_index'],
      ['compose', 'render_report'],
    ]
    const lost = carries.filter(([key, needle]) =>
      !(stageSkills.find((s) => s.name === stageSkillName(key))?.content ?? '').includes(needle))
    if (lost.length === 0) ok('each stage sheet still carries its own subject matter')
    else bad('content lost in the split', lost.map(([k, n]) => k + ' lost ' + n).join(', '))

    // Both asset stages share the landing rules, and both need them: each is
    // read on its own, so a rule in only one of them is missing from the other.
    const audio = stageSkills.find((s) => s.name === stageSkillName('assets-audio')).content
    const shots = stageSkills.find((s) => s.name === stageSkillName('assets-shots')).content
    if (audio.includes('两段共同的落盘规则') && shots.includes('两段共同的落盘规则'))
      ok('both asset stages carry the shared landing rules')
    else bad('landing rules', 'only one asset stage has them')

    // The whole point: reading one node must cost less than reading everything.
    const worst = Math.max(...stageSkills.map((s) => s.content.length))
    const monolith = 12678 // measured on the skill this replaced, at HEAD~1
    if (explainer.content.length + worst < monolith)
      ok('map + worst stage is ' + (explainer.content.length + worst) + ' chars against the old ' + monolith)
    else bad('no saving', 'the split costs as much as the monolith did')

    // Live config still reaches the split bodies. A stage sheet quoting a
    // documented example instead of the bound workflow is worse than silent --
    // it is confidently wrong.
    const rebound = SkillConfig({ bindings: { tts: { workflow: 'Beta-TTS' }, image: { workflow: 'Beta-Image' } } })
    const after = buildPipelineSkill(PIPELINES['explainer-stills'], rebound)
    if (after.content.includes('Beta-TTS') && !after.content.includes('Alpha-TTS'))
      ok('the pipeline skill renders the bindings actually in force')
    else bad('stale bindings', 'the map still names the old workflow')
  }

  console.log('\n== 配乐技能 ==')
  {
    const { STUDIO_SOUND_DESIGN_SKILL } = await import('../lib/skill-sound-design.js')
    const { buildMusicJob } = await import('../lib/music-job.js')
    const { MIX } = await import('../lib/audio-mix.js')
    const body = STUDIO_SOUND_DESIGN_SKILL.content
    const name = STUDIO_SOUND_DESIGN_SKILL.name

    // Same grammar check as the shot-language skill. A typo degrades silently:
    // the message still sends, the body never loads, and the model picks a
    // track with no guidance at all.
    if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) ok('the skill name matches the harness gesture grammar')
    else bad('skill name', name)
    const job = buildMusicJob({
      projectId: 'p', workflow: 'w', styleName: 's', pacingProfile: 'conversational', totalSeconds: 60,
    })
    if (job.includes('/' + name)) ok('the panel sends a load gesture naming this exact skill')
    else bad('gesture mismatch', 'panel and skill disagree on the name')

    // THE SPLIT THIS SKILL EXISTS TO MAKE. Levels are countable and are done in
    // ffmpeg; a second copy of them here would be a number nothing checks, and
    // an invitation to ask for a lever that does not exist. Anything that reads
    // as a dB instruction to the model is the failure.
    const levels = body.match(/-?\d+\s*(dB|LUFS|dBTP)/g) ?? []
    // The one place levels may appear is the paragraph saying they are handled.
    const handled = body.indexOf('全部由插件在 ffmpeg 里完成')
    const stray = levels.filter((token) => {
      const at = body.indexOf(token)
      return handled === -1 || at < handled || at > handled + 400
    })
    if (stray.length === 0) ok('the skill states no level the model could try to set')
    else bad('levels leaked into the skill', stray.join(', '))

    // What it MUST carry: the two disqualifying rules and the BPM table.
    for (const must of ['纯器乐', '动态', 'BPM']) {
      if (!body.includes(must)) bad('skill missing content', must)
    }
    ok('the skill carries the two hard rules and the tempo table')

    // The pacing profiles the skill names have to be the ones the playbooks
    // actually use, or its table answers a question nobody asked.
    const { listPlaybooks } = await import('../lib/playbooks.js')
    const profiles = new Set(listPlaybooks({}).map((entry) => entry.playbook.narration.pacing_profile))
    const unnamed = [...profiles].filter((profile) => !body.includes(profile))
    if (unnamed.length === 0) ok('every pacing profile a built-in playbook uses appears in the skill')
    else bad('profile not covered', unnamed.join(', '))

    // And the job builder has to agree with the skill about them, or the two
    // give the model different bands for the same film.
    const disagreeing = []
    for (const profile of profiles) {
      const message = buildMusicJob({
        projectId: 'p', workflow: 'w', styleName: 's', pacingProfile: profile, totalSeconds: 60,
      })
      if (message.includes('按技能里的表自己判断')) disagreeing.push(profile)
    }
    if (disagreeing.length === 0) ok('the job builder has a band for every profile the playbooks use')
    else bad('no band for', disagreeing.join(', '))

    // It must not tell the model to mix anything: there is no lever.
    if (body.includes('管不了') || body.includes('你不用管'))
      ok('the skill says plainly which decisions are not the model\u2019s')
    else bad('lever not ruled out', 'the skill could be read as asking for a mix')

    // The duck depth the skill and the panel quote has to be the one the filter
    // actually applies -- three places said 9 dB while the measurement said 8.
    if (MIX.duckRatio === 4) ok('the ratio in the mix is the measured one, not the calculated one')
    else bad('duck ratio drifted', String(MIX.duckRatio))
  }
  console.log('\n== 配乐请求与登记 ==')
  {
    const { buildMusicJob } = await import('../lib/music-job.js')
    const { musicPatchOf, IMPORT_KINDS } = await import('../lib/assets.js')

    const job = buildMusicJob({
      projectId: 'smoke',
      workflow: 'Alpha-Music',
      styleName: '干净科技',
      pacingProfile: 'contemplative',
      totalSeconds: 92.4,
      platform: 'douyin',
    })

    // The skill gesture is the point of this message. Without it the model
    // picks a track on vibes, which is exactly what the ported knowledge exists
    // to replace. Whitespace-bounded and on its own line, or it does not load.
    const firstLine = job.split(String.fromCharCode(10))[0]
    if (firstLine === '/dsh-creative-studio-sound-design')
      ok('the request opens with the sound-design skill gesture')
    else bad('no skill gesture', firstLine)

    // BPM comes off the playbook's pacing profile, not off the model's taste.
    if (job.includes('60–80')) ok('the BPM band follows the playbook pacing profile')
    else bad('wrong BPM band', job)
    const fast = buildMusicJob({
      projectId: 'p', workflow: 'w', styleName: 's', pacingProfile: 'energetic', totalSeconds: 30,
    })
    if (fast.includes('120–140')) ok('a different pacing profile asks for a different band')
    else bad('band not derived', fast)
    // An unknown profile must not silently produce a blank line where the
    // number goes -- that reads as "no opinion" rather than "look it up".
    const odd = buildMusicJob({
      projectId: 'p', workflow: 'w', styleName: 's', pacingProfile: 'invented', totalSeconds: 30,
    })
    if (odd.includes('按技能里的表自己判断')) ok('an unknown pacing profile defers to the skill table')
    else bad('unknown profile', odd)

    // Length with headroom. A bed exactly the film's length loses its last
    // second to the fade-out.
    if (job.includes('至少 98 秒')) ok('the requested length clears the film plus the fade')
    else bad('length', job)

    // kind: music, and NO scene_id -- the bed belongs to no section, and a
    // fabricated one would be rejected as an orphan.
    if (job.includes('`kind` 填 `music`') && job.includes('不要填 `scene_id`'))
      ok('the import instruction says music and no section')
    else bad('import instruction', job)

    // The two rules that disqualify a track outright are repeated in the
    // request, not left to the skill alone: this is the last thing read.
    if (job.includes('纯器乐') && job.includes('动态要平'))
      ok('the two disqualifying rules are restated in the request itself')
    else bad('rules missing', job)

    // Levels are not the model's to set, and saying so is cheaper than
    // fielding a request for a lever that does not exist.
    if (job.includes('你不用管这些')) ok('the request says plainly that levels are not its job')
    else bad('levels', job)

    // ---- import records the bed on the project --------------------------

    if (IMPORT_KINDS.includes('music')) ok('music is an importable kind')
    else bad('import kinds', IMPORT_KINDS.join(','))

    // Importing the file and recording it are ONE gesture. Split in two, a
    // forgotten second step leaves the bed on disk with nothing pointing at
    // it -- and a file nobody references looks exactly like no file.
    const patch = musicPatchOf([
      { source: 'a', kind: 'audio', scene_id: 's1', path: 'assets/audio/01-s1.wav', bytes: 1 },
      { source: 'b', kind: 'music', scene_id: '', path: 'assets/audio/music.wav', bytes: 1 },
    ])
    if (patch?.path === 'assets/audio/music.wav') ok('importing a bed produces the marker patch that records it')
    else bad('music patch', JSON.stringify(patch))
    if (musicPatchOf([{ source: 'a', kind: 'audio', scene_id: 's1', path: 'p', bytes: 1 }]) === undefined)
      ok('an import with no bed in it patches nothing')
    else bad('spurious patch', 'a plain audio import touched the marker')
    // A second bed replaces the first; it does not layer under it.
    const two = musicPatchOf([
      { source: 'a', kind: 'music', scene_id: '', path: 'assets/audio/music.wav', bytes: 1 },
      { source: 'b', kind: 'music', scene_id: '', path: 'assets/audio/music.v2.wav', bytes: 1 },
    ])
    if (two?.path === 'assets/audio/music.v2.wav') ok('the last bed imported is the one that wins')
    else bad('two beds', JSON.stringify(two))
  }
  console.log('\n== 配乐混音 ==')
  {
    const { MIX, loudnessFor, loudnormFilter, musicMixFilter, parseLoudnorm } =
      await import('../lib/audio-mix.js')

    // ---- the graph, read rather than run -------------------------------

    const graph = musicMixFilter({
      totalSeconds: 60, loudness: loudnessFor('youtube'), voiceInput: 0, musicInput: 1,
    })
    // amix halves every input by default to guarantee no clipping. That would
    // drop the narration 6 dB below the level the bed offset, the duck depth
    // and the loudness target are all measured against -- the film would come
    // out quiet with nothing to point at.
    if (graph.includes('normalize=0')) ok('amix does not silently halve both inputs')
    else bad('amix normalize', graph)
    // The FIRST input of sidechaincompress is the one that gets compressed.
    // Swapped, it ducks the narration under the music, which is audible only
    // as "the music is fine and I cannot hear the words".
    if (graph.includes('[bed][key]sidechaincompress')) ok('the bed is what gets ducked, not the voice')
    else bad('sidechain order', graph)

    // The three overridable numbers actually reach the graph. A control that
    // saves but does not change the filter is the worst kind: the file sounds
    // the same and the setting looks accepted.
    const custom = musicMixFilter({
      totalSeconds: 60, loudness: loudnessFor('youtube'), voiceInput: 0, musicInput: 1,
      settings: { gainDb: -12, fadeInSeconds: 4, fadeOutSeconds: 6 },
    })
    if (custom.includes('volume=-12dB')) ok('the project bed level reaches the filter')
    else bad('gain ignored', custom)
    if (custom.includes('afade=t=in:st=0:d=4')) ok('so does the fade-in')
    else bad('fade-in ignored', custom)
    // The fade-out start is derived, not stored: 60 - 6.
    if (custom.includes('afade=t=out:st=54.000:d=6')) ok('and the fade-out, placed from the film length')
    else bad('fade-out ignored', custom)
    // A fade longer than the film would start before zero, and ffmpeg reads a
    // negative st as garbage rather than as an error.
    const stubby = musicMixFilter({
      totalSeconds: 3, loudness: loudnessFor('youtube'), voiceInput: 0, musicInput: 1,
      settings: { fadeOutSeconds: 20 },
    })
    if (stubby.includes('afade=t=out:st=0.000:')) ok('a fade longer than the film starts at zero, not before it')
    else bad('negative fade start', stubby)
    // The untouched graph still carries the spec values.
    if (graph.includes('volume=-20dB') && graph.includes('afade=t=in:st=0:d=1.5'))
      ok('a project that sets nothing still renders the spec mix')
    else bad('defaults drifted', graph)

    // ---- loudness --------------------------------------------------------

    const short = loudnessFor('douyin')
    const long = loudnessFor('youtube')
    if (short.truePeak === -1 && long.truePeak === -1.5 && short.lufs === -14)
      ok('the platform that already decides the frame also decides the loudness target')
    else bad('platform loudness', JSON.stringify([short, long]))
    if (loudnessFor(undefined).lufs === -14 && loudnessFor('myspace').lufs === -14)
      ok('an absent or unknown platform still gets a target rather than nothing')
    else bad('loudness fallback', JSON.stringify(loudnessFor('myspace')))

    // The whole reason loudness is measured in a separate pass. Dynamic
    // loudnorm rides the gain over time: it hears the gaps between sentences
    // as too quiet and lifts the music back into them, undoing the ducking
    // with no error and nothing in the output to point at.
    const measured = parseLoudnorm('some log\n{"input_i":"-18.5","input_tp":"-2.1",'
      + '"input_lra":"7.0","input_thresh":"-28.9","target_offset":"0.3"}\nmore log')
    const applied = loudnormFilter(long, measured)
    if (applied.includes('linear=true') && applied.includes('measured_I=-18.5'))
      ok('a measured mix is normalised linearly, so the duck survives')
    else bad('linear normalisation', applied)

    // And when the measurement fails, it must NOT quietly fall back to the
    // mode that undoes the ducking.
    const fallback = loudnormFilter(long, undefined)
    if (fallback.startsWith('alimiter') && !fallback.includes('loudnorm'))
      ok('a failed measurement peak-limits rather than falling back to dynamic')
    else bad('dynamic fallback', fallback)
    if (parseLoudnorm('no json here') === undefined && parseLoudnorm('{"input_i":"-1"}') === undefined)
      ok('an incomplete measurement is rejected rather than half-used')
    else bad('loudnorm parsing', 'accepted something unusable')

    // ---- the duck, measured on real audio --------------------------------

    // A level table is worth nothing unless the filter actually applies it, and
    // "the render produced a file" cannot tell the difference between a bed
    // that ducks and one that does not.
    //
    // Two tones far apart: 200 Hz narration, present only in the second half,
    // and a 800 Hz bed running throughout. Measuring the 800 Hz band in a
    // silent stretch and in a spoken one gives the duck depth directly.
    //
    // THE BAND FILTER HAS TO BE STEEP. A single `bandpass` leaks enough of the
    // 200 Hz tone to raise the floor of the ducked reading, which hid half the
    // effect and made ratio changes look like they did almost nothing.
    const band = 'highpass=f=500,highpass=f=500,highpass=f=500,lowpass=f=1400,lowpass=f=1400'
    const mixDir = join(WS, 'music-mix')
    await fs.mkdir(mixDir, { recursive: true })
    const voice = join(mixDir, 'voice.wav')
    const music = join(mixDir, 'music.wav')
    const mixed = join(mixDir, 'mix.wav')

    let duckError
    let depth
    let quiet
    try {
      // `sine` comes out at -18 dBFS, not full scale -- the reason an earlier
      // version of this test measured no ducking at all was a key sitting below
      // the threshold, not a broken filter.
      await run(config.ffmpegPath, [
        '-v', 'error', '-y', '-nostdin',
        '-f', 'lavfi', '-i', 'sine=frequency=200:duration=10:sample_rate=48000',
        '-af', "volume=6dB,volume=enable='lt(t,5)':volume=0",
        '-ac', '2', voice,
      ])
      await run(config.ffmpegPath, [
        '-v', 'error', '-y', '-nostdin',
        '-f', 'lavfi', '-i', 'sine=frequency=800:duration=12:sample_rate=48000',
        '-af', 'volume=4dB', '-ac', '2', music,
      ])
      await run(config.ffmpegPath, [
        '-v', 'error', '-y', '-nostdin',
        '-i', voice, '-stream_loop', '-1', '-i', music,
        '-filter_complex', musicMixFilter({
          totalSeconds: 10, loudness: long, voiceInput: 0, musicInput: 1,
        }),
        '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', mixed,
      ])

      const levelOf = async (from, to) => {
        const { stderr } = await run(config.ffmpegPath, [
          '-hide_banner', '-nostats', '-nostdin', '-i', mixed,
          '-af', 'atrim=' + from + ':' + to + ',' + band + ',volumedetect',
          '-f', 'null', '-',
        ])
        const found = /mean_volume:\s*(-?[0-9.]+) dB/.exec(stderr)
        if (found === null) throw new Error('volumedetect printed no level')
        return Number(found[1])
      }
      quiet = await levelOf(2, 4)
      const ducked = await levelOf(6, 8)
      depth = quiet - ducked
    } catch (error) {
      duckError = String(error.message ?? error)
    }

    if (duckError !== undefined) {
      bad('the mix could not run', duckError.slice(-300))
    } else {
      // The bed has to BE there in the gap, or there is nothing to duck.
      if (quiet > -60) ok('the music bed reaches the mix (' + quiet.toFixed(1) + ' dB in the gap)')
      else bad('no bed in the mix', quiet + ' dB — the graph dropped the music input')
      // The range the source asks for. Both ends matter: under 6 dB the words
      // fight the music, over 12 dB the bed pumps in and out audibly.
      if (depth >= 6 && depth <= 12)
        ok('narration ducks the bed by ' + depth.toFixed(1) + ' dB, inside the 6–12 dB the spec asks for')
      else bad('duck depth', depth.toFixed(1) + ' dB is outside 6–12; ratio is ' + MIX.duckRatio)
    }
  }
  console.log('\n== 面板与快捷键 ==')
  {
    // The advice shell is the answer to "did anything check this?" — a question
    // an empty screen answers wrongly. Both screens must render it even when
    // clean, and both must route through the same component so they cannot
    // drift the way they already did once.
    const bundleText = (await import('node:fs')).readFileSync('client/client.js', 'utf-8')
    for (const title of ['创作建议', '成片检查']) {
      if (bundleText.includes(title)) ok('the ' + title + ' panel ships')
      else bad('advice panel missing', title)
    }
    if (bundleText.includes('全部通过')) ok('a clean check says so rather than rendering nothing')
    else bad('silent pass', 'no all-clear wording in the bundle')

    // Space is the editor key browsers spend on scrolling. Both the press and
    // the release have to be blocked: some browsers scroll on keyup, which no
    // amount of blocking keydown prevents.
    const timeline = (await import('node:fs')).readFileSync('src/client/timeline-screen.tsx', 'utf-8')
    if (/keydown/.test(timeline) && /keyup/.test(timeline)) ok('space is claimed on both press and release')
    else bad('scroll not suppressed', 'only one of keydown/keyup is handled')
    for (const exempt of ['INPUT', 'TEXTAREA', 'BUTTON', 'isContentEditable']) {
      if (!timeline.includes(exempt)) bad('space steals from a field', exempt + ' not exempt')
    }
    ok('typing and button activation keep their space')

    // Bound once, acting on the live handler: `togglePreview` reads a playhead
    // that moves every frame, so a listener holding one render's copy would
    // resume from wherever the screen was mounted.
    if (timeline.includes('toggleRef.current()')) ok('the key reads the live toggle, not a stale closure')
    else bad('stale closure', 'space calls a captured togglePreview')
  }


  console.log('\n== 烧录字幕排版 ==')
  {
    const { renderAss, subtitleMetrics } = await import('../lib/subtitle-style.js')
    const cues = [
      { start: 0.2, end: 2.0, text: '第一条字幕' },
      { start: 2.0, end: 4.0, text: '第二条' + String.fromCharCode(10) + '分成两行' },
    ]

    // THE BUG THIS FILE EXISTS FOR. ASS sizes are units in the script's own
    // coordinate space; libass falls back to 384x288 when a file declares none,
    // which an SRT never does. A force_style asking for 46px rendered at
    // 46 * 1080/288 — roughly 172px, three vast lines across the middle of the
    // frame — and MarginV was wrong by the same factor. Declaring PlayRes is
    // what makes every other number in here a real pixel.
    const ass = renderAss(cues, { width: 1920, height: 1080 })
    if (ass.includes('PlayResX: 1920') && ass.includes('PlayResY: 1080'))
      ok('the ASS declares the frame, so its sizes are real pixels')
    else bad('no PlayRes', ass.split(String.fromCharCode(10)).slice(0, 6).join(' | '))

    const wide = subtitleMetrics({ width: 1920, height: 1080 })
    if (wide.fontSize === 46 && wide.marginBottom === 64) ok('1080p gets the spec values unscaled')
    else bad('1080p metrics', JSON.stringify(wide))

    // Scaling from the short side keeps a vertical render the same physical
    // size; scaling by height would make 1080x1920 nearly twice as large.
    const tall = subtitleMetrics({ width: 1080, height: 1920 })
    if (tall.fontSize === wide.fontSize) ok('a vertical frame gets the same text size, not a bigger one')
    else bad('vertical scaling', wide.fontSize + ' vs ' + tall.fontSize)
    const uhd = subtitleMetrics({ width: 3840, height: 2160 })
    if (uhd.fontSize === wide.fontSize * 2) ok('4K doubles it')
    else bad('4K scaling', String(uhd.fontSize))

    // Title-safe: text inside 90% of the width, whichever way the frame turns.
    if (Math.abs(wide.sideMargin - 1920 * 0.05) < 1 && Math.abs(tall.sideMargin - 1080 * 0.05) < 1)
      ok('side margins hold the title-safe 90%')
    else bad('safe area', wide.sideMargin + ' / ' + tall.sideMargin)

    // A raw newline would end the Dialogue line and the rest would parse as an
    // unknown directive — the cue vanishes with no error anywhere.
    const twoLine = ass.split(String.fromCharCode(10)).find((line) => line.includes('第二条'))
    if (twoLine !== undefined && twoLine.includes(String.fromCharCode(92) + 'N') && !twoLine.endsWith('第二条'))
      ok('a two-line cue is escaped, not truncated')
    else bad('newline escaping', String(twoLine))

    if (ass.includes('0:00:00.20,0:00:02.00')) ok('times are ASS centiseconds')
    else bad('timestamp format', ass.split(String.fromCharCode(10)).find((l) => l.startsWith('Dialogue')) ?? '')

    // AND IT HAS TO PUT PIXELS ON THE SCREEN.
    //
    // The test this replaces burned a clip and asserted the output file was
    // non-empty. It passed while the subtitles rendered at 172px across the
    // middle of the frame, and kept passing when they stopped rendering at
    // all — a file with no visible text is still a file. Only the pixels can
    // tell those apart.
    //
    // The measurement is a byte comparison rather than a brightness average:
    // averages of a whole band move by fractions when text covers 1% of it,
    // and a threshold needs a magic number. Two captures of the same frame,
    // one burned and one not, differ in exactly the pixels the glyphs cover —
    // zero when nothing drew, thousands when something did.
    const burnDir = join(WS, 'subtitle-burn')
    await fs.mkdir(burnDir, { recursive: true })
    const assPath = join(burnDir, 'burn.ass')
    await fs.writeFile(assPath, renderAss(
      [{ start: 0, end: 3, text: '字幕烧录测试' }],
      { width: 640, height: 360 },
    ), 'utf-8')

    /** Raw grey pixels of the bottom third, with and without the burn. */
    const band = async (name, prefix) => {
      const target = join(burnDir, name)
      await run(config.ffmpegPath, [
        '-v', 'error', '-y', '-nostdin',
        '-f', 'lavfi', '-i', 'color=c=navy:s=640x360:d=1',
        '-frames:v', '1',
        '-vf', prefix + 'crop=640:120:0:240,format=gray',
        '-f', 'rawvideo', '-pix_fmt', 'gray', target,
      ])
      return fs.readFile(target)
    }

    let drawn
    let burnError
    try {
      const plain = await band('plain.raw', '')
      const burnt = await band('burnt.raw', "subtitles='" + escapeFilterPath(assPath) + "',")
      drawn = 0
      for (let index = 0; index < plain.length; index += 1) {
        if (plain[index] !== burnt[index]) drawn += 1
      }
    } catch (error) {
      burnError = String(error.message ?? error)
    }
    if (burnError !== undefined) bad('burn could not run', burnError.slice(-300))
    else if (drawn > 200) ok('burned subtitles put ' + drawn + ' pixels on screen')
    else bad('subtitles invisible', drawn + ' pixels changed — it renders a file and shows nothing')

    const boxed = renderAss(cues, { width: 1920, height: 1080, background: 'box' })
    const styleOf = (text) => text.split(String.fromCharCode(10)).find((l) => l.startsWith('Style: Default'))
    if (styleOf(boxed) !== styleOf(ass)) ok('box and outline produce different styles')
    else bad('background ignored', 'both render identically')
  }


  console.log('\n' + passed + ' passed, ' + failed + ' failed\n')
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

/**
 * Live integration test: real ComfyUI workflows -> real assets -> real render.
 *
 * Not part of `pnpm test`. It needs a running ComfyUI with the workflows this
 * script names present in the dsh-comfyui library, and it reuses dsh-comfyui's
 * own compiled client so the generation path is the one the agent would drive.
 *
 * What it proves that the offline smoke test cannot: that the three studio
 * tools work against media a real workflow produced, that `import` handles a
 * ComfyUI /view URL, and — by leaving an mp4 behind — whether the Chinese TTS
 * and the txt2img style are actually good enough to ship.
 *
 * Run: node test/integration-comfyui.mjs
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promises as fs } from 'node:fs'

import { Config } from '../lib/config.js'
import { resolvePlaybook } from '../lib/playbooks.js'
import { StateMachine } from '../lib/state.js'
import { probeDuration } from '../lib/compose.js'
import { registerStudioTools } from '../lib/tools.js'

const COMFY_LIB = 'file:///D:/dsh-comfyui/lib/'
const { ComfyUIClient, collectMedia } = await import(COMFY_LIB + 'comfyui.js')
const { applyWorkflowParameters } = await import(COMFY_LIB + 'params.js')

const COMFY_BASE = 'http://127.0.0.1:8188'
const LIBRARY = join(homedir(), '.dsh', 'data', 'dsh-comfyui', 'workflows.json')
const WS = resolve('tmp/projects')
const PROJECT = 'comfy-live'

const TTS_WORKFLOW = 'Qwen3-TTS(Text)'
const IMAGE_WORKFLOW = 'Krea-T2I-Afterlight'
const VOICE = 'shejian_narrator.wav'

/* ----------------------------------------------------------------- script */

const SECTIONS = [
  {
    id: 's1',
    label: 'hook',
    text: '你在 ComfyUI 里连好的那张图，其实不能直接被程序调用。',
    visual: 'a tangled node graph glowing on a dark screen, cinematic teal and orange lighting, shallow depth of field, no text',
  },
  {
    id: 's2',
    label: 'body',
    text: '画布保存的是界面布局，而能跑的是另一种格式：节点编号加输入参数。',
    visual: 'clean isometric diagram of data flowing between three glowing cubes, dark background, teal and orange, minimal, no text',
  },
  {
    id: 's3',
    label: 'close',
    text: '把画布提取成可执行工作流，参数才会变成能被调用的接口。',
    visual: 'a single glowing control panel with labelled sliders, dark studio background, teal and orange rim light, no text',
  },
]

let passed = 0
let failed = 0
const t0 = Date.now()

function stamp() {
  return ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's'
}
function ok(label) {
  passed += 1
  console.log(stamp() + '  PASS  ' + label)
}
function bad(label, detail) {
  failed += 1
  console.log(stamp() + '  FAIL  ' + label + (detail ? '\n          ' + String(detail).split('\n').join('\n          ') : ''))
}
function step(label) {
  console.log(stamp() + '  ....  ' + label)
}

/* ------------------------------------------------------------- tool harness */

/** Capture the tool definitions the plugin registers, then call them by name. */
function harness(runtime) {
  const registered = new Map()
  const ctx = {
    tools: {
      register(definition) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
    },
  }
  const disposers = registerStudioTools(ctx, runtime)
  const signal = new AbortController().signal
  return {
    names: [...registered.keys()],
    async call(name, args) {
      const definition = registered.get(name)
      if (definition === undefined) throw new Error('tool ' + name + ' was never registered')
      return definition.execute(args, { signal })
    },
    render(name, args, value) {
      const definition = registered.get(name)
      return definition.output.render(args, value)[0].text
    },
    dispose() {
      for (const d of disposers.reverse()) d()
    },
  }
}

/* ------------------------------------------------------------------ comfy */

async function loadWorkflow(name) {
  const library = JSON.parse(await readFile(LIBRARY, 'utf-8'))
  const found = library.find((entry) => entry.name === name)
  if (found === undefined) {
    throw new Error('workflow ' + JSON.stringify(name) + ' is not in the library; have: ' + library.map((e) => e.name).join(', '))
  }
  return found
}

async function runWorkflow(client, objectInfo, saved, values, label) {
  // applyWorkflowParameters returns a modified clone and does NOT mutate its
  // argument. Queuing the original instead is silent: the workflow hash is
  // unchanged, so ComfyUI serves the previous run from cache and every section
  // comes back byte-identical. Hence the distinctness checks at the end.
  const workflow = applyWorkflowParameters(saved.workflow, saved.parameters ?? [], values, objectInfo)
  const promptId = await client.queuePrompt(workflow)
  const entry = await client.waitForCompletion({
    promptId,
    timeoutMs: 900_000,
    pollIntervalMs: 1_000,
    signal: new AbortController().signal,
  })
  const media = collectMedia({ promptId, entry, maxItems: 8, proxyBase: undefined })
  if (media.length === 0) throw new Error(label + ': the workflow produced no media')
  return media
}

/** ComfyUI's own /view URL — exactly the kind of link studio_project import takes. */
function viewUrl(item) {
  const params = new URLSearchParams({
    filename: item.filename,
    subfolder: item.subfolder ?? '',
    type: item.type ?? 'output',
  })
  return COMFY_BASE + '/view?' + params.toString()
}

/* ------------------------------------------------------------------- main */

async function main() {
  await fs.rm(join(WS, PROJECT), { recursive: true, force: true })

  const config = Config({
    workspaceRoot: WS,
    video: { width: 1280, height: 720, fps: 24, preset: 'veryfast' },
    bindings: {
      tts: { workflow: TTS_WORKFLOW },
      image: { workflow: IMAGE_WORKFLOW },
    },
  })
  const machine = new StateMachine({
    workspaceRoot: () => WS,
    probeDuration: (path) => probeDuration(config.ffprobePath, path),
  })
  const tools = harness({ getConfig: () => config, machine })

  if (tools.names.join(',') === 'studio_project,studio_stage,studio_compose') ok('three tools registered')
  else bad('tool registration', tools.names.join(','))

  const client = new ComfyUIClient(COMFY_BASE, undefined, 10_000, 64 * 1024 * 1024)
  step('reading object_info')
  const objectInfo = await client.objectInfo()
  const ttsWorkflow = await loadWorkflow(TTS_WORKFLOW)
  const imageWorkflow = await loadWorkflow(IMAGE_WORKFLOW)
  ok('bound workflows resolved by name: ' + TTS_WORKFLOW + ' / ' + IMAGE_WORKFLOW)

  const voiceParam = (ttsWorkflow.parameters ?? []).find((p) => p.name === 'voice_name')
  if (voiceParam?.options?.includes(VOICE)) ok('voice "' + VOICE + '" is in the workflow\'s options')
  else bad('voice option', 'not offered by the workflow; options: ' + JSON.stringify(voiceParam?.options))

  /* -- project + the two gates ------------------------------------------- */

  const init = await tools.call('studio_project', {
    action: 'init', id: PROJECT, title: '什么是可执行工作流', target_duration_seconds: 30, voice: VOICE,
  })
  ok('studio_project init  (voice: ' + init.project.voice + ')')

  const brief = {
    version: '1.0',
    title: '什么是可执行工作流',
    hook: '你连好的那张图，其实不能直接被程序调用',
    key_points: ['画布保存的是界面布局', '可执行的是节点编号加输入参数', '提取之后参数才成为接口'],
    tone: '克制、直给',
    style: '暗色调科技感插画，青橙配色',
    target_platform: 'bilibili',
    target_duration_seconds: 30,
  }
  await tools.call('studio_stage', { project: PROJECT, stage: 'brief', status: 'awaiting_human', artifacts: { brief } })
  await tools.call('studio_stage', { project: PROJECT, stage: 'brief', status: 'completed', artifacts: { brief }, human_approved: true })
  ok('brief through the gate')

  let cursor = 0
  const script = {
    version: '1.0',
    title: brief.title,
    total_duration_seconds: 0,
    voice_performance: { performance_intent: '像同行讲给同行听，不煽情', pacing_profile: 'conversational' },
    sections: SECTIONS.map((section) => {
      const start = cursor
      const end = cursor + 9
      cursor = end
      return {
        id: section.id,
        label: section.label,
        text: section.text,
        start_seconds: start,
        end_seconds: end,
        delivery_cues: { pace: 'measured' },
        visual: { prompt: section.visual, style_note: 'dark tech illustration, teal and orange' },
      }
    }),
  }
  script.total_duration_seconds = cursor
  await tools.call('studio_stage', { project: PROJECT, stage: 'script', status: 'awaiting_human', artifacts: { script } })
  await tools.call('studio_stage', { project: PROJECT, stage: 'script', status: 'completed', artifacts: { script }, human_approved: true })
  ok('script through the gate  (' + script.sections.length + ' sections)')

  /* -- batch 1: all narration -------------------------------------------- */

  const audioAssets = []
  for (const section of SECTIONS) {
    step('TTS  ' + section.id + '  「' + section.text.slice(0, 18) + '…」')
    const media = await runWorkflow(client, objectInfo, ttsWorkflow, {
      prompt: section.text,
      voice_name: VOICE,
    }, 'tts ' + section.id)
    const audio = media.find((item) => item.kind === 'audio') ?? media[0]
    const imported = await tools.call('studio_project', {
      action: 'import', project: PROJECT,
      items: [{ source: viewUrl(audio), kind: 'audio', scene_id: section.id }],
    })
    audioAssets.push({
      id: section.id + '-audio',
      type: 'narration',
      path: imported.imported[0].path,
      source_tool: 'comfyui_workflow',
      scene_id: section.id,
      workflow_id: ttsWorkflow.id,
      model: TTS_WORKFLOW,
    })
    ok('narration ' + section.id + ' -> ' + imported.imported[0].path + '  (' + Math.round(imported.imported[0].bytes / 1024) + ' KB)')
  }

  const batch1 = await tools.call('studio_stage', {
    project: PROJECT, stage: 'assets_audio', status: 'completed', human_approved: true,
    artifacts: { asset_manifest_audio: { version: '1.0', assets: audioAssets } },
  })
  ok('first batch recorded as in_progress, paths verified' + (batch1.notices.length > 0 ? '  (' + batch1.notices.join('; ') + ')' : ''))

  /* -- batch 2: all stills ------------------------------------------------ */

  const imageAssets = []
  for (const section of SECTIONS) {
    step('txt2img  ' + section.id)
    const media = await runWorkflow(client, objectInfo, imageWorkflow, {
      prompt: section.visual + ', dark tech illustration, teal and orange',
      width: 1280,
      height: 720,
    }, 'image ' + section.id)
    const image = media.find((item) => item.kind === 'image') ?? media[0]
    const imported = await tools.call('studio_project', {
      action: 'import', project: PROJECT,
      items: [{ source: viewUrl(image), kind: 'image', scene_id: section.id }],
    })
    imageAssets.push({
      id: section.id + '-image',
      type: 'image',
      path: imported.imported[0].path,
      source_tool: 'comfyui_workflow',
      scene_id: section.id,
      prompt: section.visual,
      workflow_id: imageWorkflow.id,
      model: IMAGE_WORKFLOW,
    })
    ok('image ' + section.id + ' -> ' + imported.imported[0].path + '  (' + Math.round(imported.imported[0].bytes / 1024) + ' KB)')
  }

  const done = await tools.call('studio_stage', {
    project: PROJECT, stage: 'assets_shots', status: 'completed', human_approved: true,
    artifacts: { asset_manifest_shots: { version: '1.0', assets: imageAssets } },
  })
  ok('assets_shots completed')
  for (const notice of done.notices) console.log('          note: ' + notice)

  const storedAudio = await machine.readArtifact(machine.layout(PROJECT), 'asset_manifest_audio')
  const storedVideo = await machine.readArtifact(machine.layout(PROJECT), 'asset_manifest_shots')
  const stored = { assets: [...storedAudio.assets, ...storedVideo.assets] }
  const measured = storedAudio.assets.filter((a) => a.duration_seconds !== undefined)
  console.log('          measured narration: ' + measured.map((a) => a.scene_id + '=' + a.duration_seconds + 's').join('  '))

  /* -- did the parameters actually reach ComfyUI? -------------------------
   * Every section has different text and a different image prompt, so every
   * asset must differ. Identical outputs mean the parameters never made it
   * into the submitted workflow and ComfyUI replayed a cached run — a failure
   * that otherwise sails through as a green pipeline over the wrong media. */
  const layout = machine.layout(PROJECT)
  const digests = new Map()
  for (const asset of stored.assets) {
    const bytes = await fs.readFile(join(layout.dir, asset.path))
    digests.set(asset.id, createHash('sha256').update(bytes).digest('hex').slice(0, 12))
  }
  for (const kind of ['audio', 'image']) {
    const group = stored.assets.filter((a) => (kind === 'audio' ? a.type === 'narration' : a.type === 'image'))
    const unique = new Set(group.map((a) => digests.get(a.id)))
    if (unique.size === group.length) ok(kind + ': all ' + group.length + ' outputs are distinct')
    else {
      bad(kind + ' outputs are distinct',
        'only ' + unique.size + ' distinct file(s) across ' + group.length + ' sections — parameters did not reach ComfyUI, '
        + 'or the workflow ignores them:\n' + group.map((a) => '  ' + a.scene_id + '  ' + digests.get(a.id)).join('\n'))
    }
  }
  const spoken = measured.map((a) => a.duration_seconds)
  if (new Set(spoken).size === spoken.length) ok('narration durations differ: ' + spoken.map((d) => d + 's').join(', '))
  else bad('narration durations differ', 'identical durations: ' + spoken.join(', '))

  // A Chinese narration line runs ~4.5 characters per second. An order-of-
  // magnitude miss means the workflow spoke its own default text, not ours.
  for (const section of SECTIONS) {
    const asset = measured.find((a) => a.scene_id === section.id)
    if (asset === undefined) continue
    const expected = section.text.length / 4.5
    const ratio = asset.duration_seconds / expected
    if (ratio > 0.5 && ratio < 2.2) {
      ok(section.id + ': ' + asset.duration_seconds + 's for ' + section.text.length + ' chars (~' + expected.toFixed(1) + 's expected)')
    } else {
      bad(section.id + ' narration length is plausible',
        asset.duration_seconds + 's for ' + section.text.length + ' chars — expected around ' + expected.toFixed(1)
        + 's. The workflow probably spoke its own default text.')
    }
  }

  /* -- compose ------------------------------------------------------------ */

  step('composing')
  const composed = await tools.call('studio_compose', { project: PROJECT })
  console.log(tools.render('studio_compose', {}, composed).split('\n').map((l) => '          ' + l).join('\n'))

  await tools.call('studio_stage', {
    project: PROJECT, stage: 'compose', status: 'completed',
    artifacts: { render_report: composed.report },
  })
  ok('compose recorded')

  const status = await tools.call('studio_project', { action: 'status', project: PROJECT })
  if (status.next_stage === null) ok('pipeline complete')
  else bad('pipeline complete', 'next_stage=' + status.next_stage)

  const output = join(machine.layout(PROJECT).dir, composed.report.outputs[0].path)
  console.log('\n' + passed + ' passed, ' + failed + ' failed')
  console.log('\n成片： ' + output)
  console.log('字幕： ' + join(machine.layout(PROJECT).dir, composed.subtitlePath ?? '(none)'))
  tools.dispose()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('\n' + stamp() + '  ABORTED\n' + (error.stack ?? error.message))
  process.exit(1)
})

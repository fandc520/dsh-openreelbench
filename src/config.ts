/**
 * dsh-creative-studio host configuration.
 *
 * Two groups of knobs live here and they have very different lifetimes:
 *
 * - Rendering settings (`video`, `pacing`, `ffmpegPath`) describe this machine
 *   and change rarely.
 * - `bindings` describes which ComfyUI workflow currently backs each
 *   generative capability. The plugin never calls ComfyUI itself; it hands
 *   these bindings to the model so the model can drive `comfyui_workflow`.
 *   Swapping a TTS or txt2img workflow is therefore a config edit, never a
 *   code change — that is the whole point of keeping it data.
 *
 * Nested object schemas deliberately carry no `.default({})`: schemastery
 * already fills an absent branch from its inner defaults and merges a partial
 * one key by key, so a profile can override `video.fps` on its own.
 *
 * The value and the type are declared separately — the same shape dsh-comfyui
 * uses — because the schema's inferred type cannot be written as an annotation
 * on its own declaration.
 */
import z from '@deepseek-ai/schemastery'

import { DEFAULT_STYLE, type Playbook } from './playbooks.js'

/**
 * Which ComfyUI workflow backs one generative capability.
 *
 * Deliberately just a name. `comfyui_workflow action: list` already returns
 * every workflow's parameter list — english name, chinese label, default,
 * options, upload kind — so restating any of that here would be a second copy
 * of knowledge that drifts the moment the workflow is edited in the panel.
 * The binding's whole job is to point the model at the right entry in that
 * library; the library remains the authority on how to call it.
 *
 * A name rather than the library id, because the id is a `randomUUID()`
 * regenerated whenever a canvas is re-extracted — a config pinned to it fails
 * silently. The name is what the user sees and manages in the panel.
 */
export interface CapabilityBinding {
  /**
   * Candidate workflow names, best first. The head is the default the model
   * and the panel start from; the rest are alternatives a person can pick
   * between without editing config.
   *
   * A list rather than a single name because one capability genuinely has
   * several good answers — a fast draft workflow and a slow finishing one are
   * the same binding at different moments, and making that a config edit means
   * nobody ever switches.
   */
  workflows: string[]
  /**
   * The pre-list spelling. Still read so an existing profile keeps working; it
   * folds in ahead of `workflows`.
   * @deprecated Prefer `workflows`.
   */
  workflow?: string
  /** Free-form guidance surfaced to the model alongside the binding. */
  notes: string
}

/** Every workflow a binding offers, default first, de-duplicated. */
export function bindingWorkflows(binding: CapabilityBinding | undefined): string[] {
  const all = [
    ...(binding?.workflow === undefined ? [] : [binding.workflow]),
    ...(binding?.workflows ?? []),
  ]
  return [...new Set(all.map((name) => name.trim()).filter((name) => name !== ''))]
}

/** The one a caller should use when it has no reason to prefer another. */
export function defaultWorkflow(binding: CapabilityBinding | undefined): string {
  return bindingWorkflows(binding)[0] ?? ''
}

/**
 * Encoder settings only. How the film *looks and breathes* — Ken Burns, fit,
 * section holds, subtitle width — belongs to the style playbook, because those
 * are the things that differ between a contemplative documentary and a brisk
 * product reveal. Keeping them here too would give every style the same feel.
 */
export interface VideoProfile {
  width: number
  height: number
  fps: number
  codec: string
  crf: number
  preset: string
}

export interface Config {
  /** Project root. Empty means `$DSH_HOME/data/dsh-creative-studio/projects`. */
  workspaceRoot: string
  ffmpegPath: string
  ffprobePath: string
  /** Target length used when a request does not state one. */
  defaultDurationSeconds: number
  video: VideoProfile
  /** The SRT is always a sidecar; burning it in costs a re-encode. */
  writeSubtitles: boolean
  burnSubtitles: boolean
  bindings: {
    tts: CapabilityBinding
    image: CapabilityBinding
    /** Optional: designing a voice is preparation, not a pipeline stage. */
    voice_design: CapabilityBinding
    /** Optional: returns a library voice's reference clip so it can be auditioned. */
    voice_query: CapabilityBinding
  }
  /** Style a project uses when it names none. */
  defaultStyle: string
  /**
   * Extra style playbooks, keyed by id. Merged over the built-ins, so an entry
   * reusing a built-in id replaces it entirely.
   */
  playbooks: Record<string, Playbook>
  /** Ceiling for one `studio_compose` render. */
  renderTimeoutMs: number
}

const binding = () => z.object({
  workflows: z.array(z.string()).default([])
    .description('dsh-comfyui 工作流库里的名称，第一条是默认值，其余作为候选出现在页面的下拉菜单里。'
      + '填名称不填 id——id 每次重新提取画布都会变。'),
  workflow: z.string().default('')
    .description('旧写法，仍然生效并排在候选首位。新配置请用上面的列表。'),
  notes: z.string().default('')
    .description('给 Agent 的额外提示，会原样出现在技能里。参数细节不用写——那些它会去 comfyui_workflow 的清单里查。'),
})

export const Config: z<Config> = z.object({
  workspaceRoot: z.string().default('')
    .description('项目根目录。留空 = $DSH_HOME/data/dsh-creative-studio/projects。成片、素材、状态都落在这里，建议放非系统盘。'),
  ffmpegPath: z.string().default('ffmpeg')
    .description('ffmpeg 可执行文件。在 PATH 上就填 ffmpeg，否则填绝对路径。'),
  ffprobePath: z.string().default('ffprobe')
    .description('ffprobe 可执行文件。用于实测配音时长——时间轴和字幕都按它的测量值排。'),
  defaultDurationSeconds: z.number().min(5).max(1800).default(30)
    .description('默认成片时长（秒）。用户没说要多长时用这个值估算脚本字数。'),

  video: z.object({
    width: z.number().min(256).max(7680).default(1920).description('成片宽度（像素）'),
    height: z.number().min(256).max(4320).default(1080).description('成片高度（像素）'),
    fps: z.number().min(12).max(60).default(30).description('帧率'),
    codec: z.string().default('libx264').description('视频编码器。libx264 兼容性最好；有 N 卡可试 h264_nvenc。'),
    crf: z.number().min(0).max(51).default(20).description('画质。数字越小越清晰、文件越大；18–23 是常用区间。'),
    preset: z.string().default('medium').description('编码速度档。ultrafast/veryfast/medium/slow——越慢文件越小。'),
  }).description('编码参数。画面观感（推近、裁切）和节奏（留白、单段时长）归风格库管，不在这里。'),

  writeSubtitles: z.boolean().default(true)
    .description('输出 .srt 字幕文件（与成片同名同目录）。字幕时间轴按实测配音排，不按脚本预估。'),
  burnSubtitles: z.boolean().default(false)
    .description('把字幕烧进画面。需要重新编码，且依赖系统中文字体；关闭时字幕只作为旁挂 .srt。'),

  /**
   * Which ComfyUI workflow backs each capability. Empty until the workflow
   * exists in the dsh-comfyui library — the tools report an unbound capability
   * rather than letting the model guess a name.
   */
  bindings: z.object({
    tts: binding().description('配音（TTS）'),
    image: binding().description('配图（文生图）'),
    voice_design: binding().description('音色设计（可选，用于造新音色）'),
    voice_query: binding().description('音色查询（可选，输出所选音色的参考音频，用于试听）'),
  }).description('每项生成能力用哪条 ComfyUI 工作流。只填名称，参数由 comfyui_workflow 的清单说了算。'),

  /**
   * Style. `defaultStyle` names one of the built-ins (clean-tech, warm-doc,
   * flat-brief) or an entry in `playbooks`. Custom playbooks are validated by
   * the schema below rather than waved through, so a typo in a hand-written
   * style is reported at load rather than silently dropping a palette.
   */
  defaultStyle: z.string().default(DEFAULT_STYLE)
    .description('默认风格。内置 clean-tech（清晰科技）/ warm-doc（温暖纪实）/ flat-brief（扁平快讲），也可填下面自定义风格的 id。'),
  playbooks: z.dict(z.object({
    name: z.string().required(),
    mood: z.string().default(''),
    best_for: z.string().default(''),
    visual: z.object({
      image_prompt_prefix: z.string().default('').description('拼在每条图像提示词前面：媒介与配色'),
      image_prompt_suffix: z.string().default('').description('拼在每条图像提示词后面：光线与质感'),
      negative_prompt: z.string().default('').description('每次生成都传的负向提示词'),
      consistency_anchors: z.array(z.string()).default([]).description('每一段都要守住的画面约束'),
    }),
    narration: z.object({
      voice_style: z.string().default(''),
      pacing_profile: z.union([
        'contemplative', 'conversational', 'energetic', 'technical', 'cinematic',
      ] as const).default('conversational'),
      chars_per_second: z.number().min(1).max(20).default(4.9).description('该风格的旁白语速（字/秒），用于估算脚本长度。实测中文约 4.95'),
    }),
    pacing: z.object({
      padBeforeSeconds: z.number().min(0).max(5).default(0.15),
      padAfterSeconds: z.number().min(0).max(5).default(0.45),
      minSectionSeconds: z.number().min(0.5).max(60).default(2),
      maxSectionSeconds: z.number().min(2).max(120).default(20),
    }),
    kenBurns: z.boolean().default(true),
    fit: z.union(['pad', 'cover'] as const).default('cover'),
    subtitleMaxChars: z.number().min(8).max(80).default(24).description('每条字幕最多几个字，超了自动切分'),
    quality_rules: z.array(z.string()).default([]).description('质量红线，会原样写进技能给 Agent 看'),
  })).default({}).description(
    '自定义风格。键是风格 id（填进上面的「默认风格」或项目里）。'
    + '与内置同名会整套替换，不做逐字段合并——半覆盖的调色板正是画风漂移的来源。',
  ),

  renderTimeoutMs: z.number().min(10_000).max(3_600_000).default(900_000)
    .description('单次合成的超时上限（毫秒）。超过就中断，默认 15 分钟。'),
}) as unknown as z<Config>

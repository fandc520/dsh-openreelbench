/**
 * Pipeline definitions — which stages a production runs, and which screen the
 * workbench shows for each.
 *
 * A pipeline is not "a list of stages"; it is **an ordering of screens**. That
 * distinction is what keeps the second pipeline cheap: a podcast run reuses the
 * project and script screens unchanged and swaps only its asset stages, so
 * adding it is a config entry rather than a new UI.
 *
 * Ported from OpenMontage's `pipeline_defs/*.yaml`, minus the parts that only
 * made sense with 121 tools: one engine, several manifests. The state machine
 * still owns what a stage *means*; this file owns what a run *contains*.
 */
import type { Stage } from './state.js'

/** A screen the workbench can render. Each has one component in the client. */
export type ScreenId = 'project' | 'script' | 'assets-audio' | 'assets-shots' | 'timeline'

export interface PipelineStage {
  id: Stage
  screen: ScreenId
  /** Whether this stage parks for human approval. Mirrors GATED_STAGES. */
  gated: boolean
  /** Short label for the step rail. */
  label: string
  /** One line under the label, telling the user what this step decides. */
  hint: string
  /**
   * What the reviewer looks at for this stage — and ONLY what code cannot.
   *
   * Schema shape, file existence, coverage and pipeline order are already
   * enforced by the state machine, and repeating them here would produce a
   * reviewer that spends its attention re-deriving facts it was handed. What
   * is left is the residue: judgements. Whether a hook actually stops someone,
   * whether a picture matches the sentence it sits under. Nothing in this list
   * should be answerable by counting.
   */
  review_focus: string[]
}

export interface Pipeline {
  id: string
  name: string
  description: string
  /**
   * The token the welcome screen puts in the input box when its button is
   * clicked. It reads like a command so the model can tell which pipeline the
   * user picked without having to infer it from prose.
   */
  command: string
  /** What this pipeline is good for, shown on the welcome card. */
  best_for: string
  stages: PipelineStage[]
}

export const DEFAULT_PIPELINE = 'explainer-stills'

export const PIPELINES: Record<string, Pipeline> = {
  'explainer-stills': {
    id: 'explainer-stills',
    name: '图文解说片',
    description: '一句解说配一张图，ffprobe 实测配音时长排时间轴，自动出字幕。',
    command: '/图文解说片',
    best_for: '技术解说 · 概念拆解 · 产品说明',
    stages: [
      {
        id: 'brief', screen: 'project', gated: true, label: '立项',
        hint: '定题目、时长、风格、创意简报',
        review_focus: [
          '钩子是一句真能让人停下的话，不是标题的复述',
          '要点之间互不重叠，去掉任何一条都会少讲一件事',
          '要点数量撑得起目标时长，也不至于讲不完',
          '受众和语气是具体的人和具体的说法，不是「大众」「专业」',
        ],
      },
      {
        id: 'script', screen: 'script', gated: true, label: '脚本',
        hint: '分段即分镜，一段一句解说一张图',
        review_focus: [
          '每一段只讲一件事，讲不完就该拆段',
          '按风格的语速算，每段字数落在它自己的时长里',
          '有起承转合：开头抓人、中间递进、结尾落地，不是要点平铺',
          'visual.prompt 写的是看得见的东西，不是抽象概念',
          '念出来是人话，没有书面语的长句和倒装',
        ],
      },
      {
        id: 'assets_audio', screen: 'assets-audio', gated: true, label: '配音',
        hint: '选音色、出样音、批量配音',
        review_focus: [
          '这个音色是这支片子该有的声音，不只是「能听」',
          '断句和停顿落在语义边界上，没有把词读断',
          '全片语速一致，没有某几段明显快慢',
        ],
      },
      {
        id: 'assets_shots', screen: 'assets-shots', gated: true, label: '分镜',
        hint: '按风格模板出图，一段可以切成多个分镜',
        review_focus: [
          '**每张图和它那句解说对得上** —— 这是代码永远看不到的一条',
          '全片风格一致，没有一张明显跳出去',
          '标为高光的那一镜确实是最有冲击力的',
          '画面里没有出现文字（文字交给字幕层）',
        ],
      },
      {
        id: 'compose', screen: 'timeline', gated: false, label: '成片',
        hint: '合成时间轴、字幕、导出',
        review_focus: [
          '字幕断行在语义边界上，不出现孤字',
          '段落之间的停顿听起来是有意的，不是接不上',
          '整片看下来有节奏，不是匀速念完',
        ],
      },
    ],
  },
}

export function resolvePipeline(id: string): { pipeline: Pipeline; resolved: string; fallback: boolean } {
  const wanted = id.trim()
  const hit = wanted === '' ? undefined : PIPELINES[wanted]
  if (hit !== undefined) return { pipeline: hit, resolved: wanted, fallback: false }
  return { pipeline: PIPELINES[DEFAULT_PIPELINE]!, resolved: DEFAULT_PIPELINE, fallback: wanted !== '' }
}

export function listPipelines(): Pipeline[] {
  return Object.values(PIPELINES)
}

/** The screen a stage is edited on, for the workbench's router. */
export function screenForStage(pipeline: Pipeline, stage: Stage): ScreenId | undefined {
  return pipeline.stages.find((entry) => entry.id === stage)?.screen
}

/**
 * The image generation request, as one testable function.
 *
 * This string is the most important one in the pipeline: it is the only thing
 * standing between a plan and a batch of GPU jobs, and everything upstream —
 * the scene plan, the five-layer builder, the style playbook — exists to make
 * it right. It lived inside the shots screen as a closure, which meant nothing
 * could check it without a browser, and a missing prompt looked exactly like a
 * working one until someone read the message by eye.
 *
 * So it lives here: pure, no React, no DOM, no node built-ins. The host builds
 * it for tests, the client bundles it for the panel, and both see the same
 * words.
 */

/** One shot as the panel knows it, plus whatever was built for it. */
export interface ShotJobItem {
  sectionId: string
  /** Position within the section, from zero. */
  index: number
  seconds: number
  /** The narration this picture sits under. Atmosphere, never subject matter. */
  text: string
  /** The five-layer prompt, when one was built for this shot. */
  built?: { prompt: string; missingSubject: boolean } | undefined
  /** The raw subject, used only when no built prompt reached this shot. */
  fallbackPrompt: string
}

export interface ShotJobInput {
  projectId: string
  workflow: string
  /**
   * The frame every picture must come back at.
   *
   * Carried in the REQUEST, not left to the stage skill. The skill said "尺寸
   * 按成片画幅生成" and gave a table keyed on the platform — which meant the
   * model had to know the project's platform, look it up, and remember that a
   * render scale existed. It did none of those, the workflow's own default
   * won, and a 9:16 project got 16:9 stills that compose cropped the sides off.
   * A number in the message cannot be looked up wrong.
   */
  width: number
  height: number
  negativePrompt: string
  /** Reference image names in ComfyUI's input directory. Names only. */
  references: readonly string[]
  /** Free-text extra parameters (LoRA and its strength), passed verbatim. */
  extraParams?: string | undefined
  shots: readonly ShotJobItem[]
}

import { workflowLine } from './job-conventions.js'

const NEWLINE = String.fromCharCode(10)

/** The sheet carries the recording protocol; the request only points at it. */
export const SHOTS_STAGE_SKILL = 'dsh-openreelbench-stage-assets-shots'

/**
 * Every prompt is handed over finished.
 *
 * Not a template. Sending "style prefix + subject + style suffix" is what made
 * every picture in a film look the same, and instructing the model to assemble
 * one would put that failure straight back — this time in prose, where no test
 * would see it.
 */
export function buildShotJob(input: ShotJobInput): string {
  const lines: string[] = [
    '/' + SHOTS_STAGE_SKILL,
    '',
    '项目 `' + input.projectId + '`，请用 ComfyUI 生成下面 ' + input.shots.length + ' 张分镜。',
    '',
    workflowLine(input.workflow),
    // Ahead of the prompts on purpose: it applies to every one of them, and a
    // constraint stated after a list of eighteen items is a constraint read
    // after eighteen decisions have already been made.
    '尺寸：**' + input.width + 'x' + input.height + '**（宽x高）。'
      + '这是成片画幅，每一张都必须按它生成——工作流的默认尺寸不要用，'
      + '出错画幅合成时只能裁掉两边。',
    '负向提示词：' + input.negativePrompt,
  ]

  // Just the names. Which loader node and which slot is something the model
  // reads off the workflow's own parameter list; restating it here would be a
  // second, staler copy.
  if (input.references.length === 1) {
    lines.push('参考图：`' + input.references[0] + '`')
  } else if (input.references.length > 1) {
    lines.push('参考图：' + input.references
      .map((name, index) => '参考图' + (index + 1) + ' `' + name + '`').join('　'))
  }

  if (input.extraParams !== undefined && input.extraParams.trim() !== '') {
    lines.push('附加参数：' + input.extraParams.trim())
  }

  lines.push('')
  lines.push('每张的正面提示词：')
  lines.push('')

  for (const shot of input.shots) {
    const where = '`' + shot.sectionId + '` 第 ' + (shot.index + 1) + ' 镜（' + shot.seconds.toFixed(1) + 's）'
    const prompt = (shot.built?.prompt ?? '').trim() === ''
      ? shot.fallbackPrompt.trim()
      : shot.built!.prompt.trim()

    if (prompt === '') {
      // Nothing to draw from at all. Said plainly rather than emitting a bare
      // heading with an empty line under it, which reads as a bug and leaves
      // the model guessing at what was meant.
      lines.push('- ' + where + '　⚠️ 这一镜没有画面描述，按下面的台词氛围自拟一句')
    } else {
      lines.push('- ' + where + (shot.built?.missingSubject === true
        ? '　⚠️ 这一镜没写主体，下面只有风格和镜头语言，按台词氛围补上主体'
        : ''))
      lines.push('  ' + prompt)
    }
    // The line rides along as ATMOSPHERE, not as subject matter. Without it the
    // model went looking for it anyway; unlabelled, it would start drawing the
    // words. Naming what it is for settles both.
    if (shot.text.trim() !== '') lines.push('  　参考台词氛围：' + shot.text.trim())
  }


  return lines.join(NEWLINE)
}

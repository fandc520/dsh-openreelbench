/**
 * The narration generation request, as one testable function.
 *
 * The sibling of `shot-job.ts`, and here for the same reason: this string is
 * the whole contract between the voice screen and the batch of TTS jobs it
 * asks for, and while it lived inside the component as a closure nothing could
 * check it without a browser. A line silently missing from it looks exactly
 * like a line that is there — which is how the shots screen shipped a request
 * with no positive prompt in it.
 *
 * Pure: no React, no DOM, no node built-ins. The host builds it for tests, the
 * client bundles it for the panel, and both see the same words.
 */

/** One section to narrate. */
export interface VoiceJobSection {
  id: string
  /** The line to read. Passed through verbatim. */
  text: string
  /** How to read it, when the script said. Empty means it did not. */
  deliveryNote: string
}

export interface VoiceJobInput {
  projectId: string
  workflow: string
  /** The library voice, as `voice_name`. */
  voice: string
  /**
   * Reference clips for a voice-cloning workflow, by the name ComfyUI knows
   * them under. Empty for an ordinary library voice.
   */
  voiceReferences: readonly string[]
  sections: readonly VoiceJobSection[]
}

import { workflowLine } from './job-conventions.js'

const NEWLINE = String.fromCharCode(10)

/** The sheet carries the recording protocol; the request only points at it. */
export const AUDIO_STAGE_SKILL = 'dsh-openreelbench-stage-assets-audio'

export function buildVoiceJob(input: VoiceJobInput): string {
  const lines: string[] = [
    '/' + AUDIO_STAGE_SKILL,
    '',
    '项目 `' + input.projectId + '`，请用 ComfyUI 生成下面 ' + input.sections.length + ' 段旁白配音。',
    '',
    workflowLine(input.workflow),
    '音色参数 `voice_name`：`' + input.voice + '`',
  ]

  // Names only. Which loader node and which slot is something the model reads
  // off the workflow's own parameter list; restating it here would be a
  // second, staler copy. Same rule as the shots screen's reference images.
  if (input.voiceReferences.length === 1) {
    lines.push('参考音频：`' + input.voiceReferences[0] + '`')
  } else if (input.voiceReferences.length > 1) {
    lines.push('参考音频：' + input.voiceReferences
      .map((name, index) => '参考音频' + (index + 1) + ' `' + name + '`').join('　'))
  }

  lines.push('正文参数：把每段的台词原样传进去，一段一次调用。')
  lines.push('')
  lines.push('段落：')

  for (const section of input.sections) {
    const note = section.deliveryNote.trim() === '' ? '' : '　表达：' + section.deliveryNote.trim()
    lines.push('- `' + section.id + '`：' + section.text.trim() + note)
  }

  lines.push('')
  // Same protocol as the shots screen. Waiting for the whole batch means a
  // failure on the last segment throws away every earlier one, and the panel —
  // which watches the manifest — shows nothing at all until the very end.

  return lines.join(NEWLINE)
}

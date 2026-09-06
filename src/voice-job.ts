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

const NEWLINE = String.fromCharCode(10)

export function buildVoiceJob(input: VoiceJobInput): string {
  const lines: string[] = [
    '请用 ComfyUI 生成下面 ' + input.sections.length + ' 段旁白配音。',
    '',
    '工作流：`' + input.workflow + '`（用 `comfyui_workflow` 的 `action: run`）',
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
  lines.push('**请用异步方式逐段提交**，每收到一段返回就立即搬进项目并回填，不要等全部跑完再一起处理。')
  lines.push(
    '每段生成完用 `studio_project` 的 `action: "import"` 搬进项目，'
    + '`scene_id` 填上面的段落编号、`kind` 填 `audio`，'
    + '然后把这一段写进 `asset_manifest_audio`，用 `studio_stage` 以 `in_progress` 记录——'
    + '**每段都记一次**，不要攒到最后。',
  )
  lines.push('**不要提交 completed** —— 我要在创意工作台里听过再确认。')

  return lines.join(NEWLINE)
}

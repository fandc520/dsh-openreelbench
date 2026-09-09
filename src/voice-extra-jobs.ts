/**
 * The three other requests the voice screen sends, besides the takes.
 *
 * They were inline strings — one of them a single concatenation buried in an
 * onClick — and each restated something its stage sheet already covers in more
 * detail than the restatement did.
 *
 * All three are trimmed to the same shape as the rest of this consolidation:
 * a gesture, which step this is, and what the panel holds. The protocol lives
 * in the sheet the gesture loads.
 */

const NEWLINE = String.fromCharCode(10)

export const AUDIO_STAGE_SKILL = 'dsh-creative-studio-stage-assets-audio'
export const SHOTS_STAGE_SKILL = 'dsh-creative-studio-stage-assets-shots'
export const SHOTS_CRAFT_SKILL = 'dsh-creative-studio-cinematography'

/**
 * Voice design: the "自动生成" button that fills the two form fields.
 *
 * The sheet has a paragraph on exactly this button, including the one thing
 * that reliably goes wrong — `voice_design_name` is a filename in the voice
 * library, so lowercase ASCII with underscores, no extension, never Chinese.
 * The old request said none of that; it just named the two fields.
 */
export function buildVoiceProposalJob(projectId: string): string {
  return [
    '/' + AUDIO_STAGE_SKILL,
    '',
    '给项目 `' + projectId + '` 提一个解说音色方案，写到项目上，我在创意工作台里看。',
  ].join(NEWLINE)
}

export interface VoiceDesignJobInput {
  projectId: string
  /** The design workflow, empty when the settings page has none bound. */
  workflow: string
  name: string
  prompt: string
  /** TTS and voice-query workflows, whichever are bound. Both need refreshing. */
  refreshWorkflows: readonly string[]
}

/**
 * Voice design: the "创建音色" button that actually runs the workflow.
 *
 * The refresh step stays in the request rather than moving wholly to the sheet,
 * because WHICH workflows need refreshing is panel state — it depends on what
 * the user has bound. The sheet says that refreshing is required and what
 * happens when it is skipped (the voice reads as "not in the allowed options",
 * and the temptation is to rename the voice instead of refreshing).
 */
export function buildVoiceDesignJob(input: VoiceDesignJobInput): string {
  const lines = [
    '/' + AUDIO_STAGE_SKILL,
    '',
    '给项目 `' + input.projectId + '` 做一个新音色。',
    '',
    '- 名称：`' + input.name + '`',
    '- 想要的声音：' + input.prompt,
  ]
  lines.push(input.workflow === ''
    ? '- 工作流：**设置页里还没绑定音色设计工作流**，先告诉用户去填'
    : '- 工作流：`' + input.workflow + '`')
  if (input.refreshWorkflows.length > 0) {
    // Named because the model cannot see the settings page. The sheet knows
    // that a refresh is needed; only the panel knows of what.
    lines.push('- 做好后要刷新快照的：'
      + input.refreshWorkflows.map((name) => '`' + name + '`').join('、'))
  } else {
    lines.push('- 配音与音色查询工作流都还没绑定，刷新完提醒我去设置页填上')
  }
  return lines.join(NEWLINE)
}

/**
 * The handoff from the voice gate into shot planning.
 *
 * Two gestures, for the same reason the script request has two: the sheet says
 * what a `scene_plan` is and that writing one produces no pictures, and the
 * craft skill says how to choose a shot for a line. The old request carried
 * only the craft one, plus its own paraphrase of the protocol and a reminder
 * of which tool reads a script — which is what the usage skill is for.
 */
export function buildScenePlanJob(projectId: string, sections: number): string {
  return [
    '/' + SHOTS_STAGE_SKILL,
    '/' + SHOTS_CRAFT_SKILL,
    '',
    '配音过闸了。给项目 `' + projectId + '` 设计 ' + sections + ' 段的镜头语言，写成 `scene_plan`。',
    '',
    '每段时长已经是配音的实测值，按它定节奏。写完在对话里说：你定的节奏是什么、哪几镜拿不准。',
  ].join(NEWLINE)
}

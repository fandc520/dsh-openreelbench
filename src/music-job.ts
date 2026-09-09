/**
 * The music generation request, as one testable function.
 *
 * The third of these, after `shot-job.ts` and `voice-job.ts`, and here for the
 * same reason: a line silently missing from a request looks exactly like a line
 * that is there.
 *
 * This one carries something the other two do not — a skill gesture. Choosing a
 * bed is a judgement call the model cannot make well from the project data
 * alone, and the knowledge that makes it well is in
 * `skill-sound-design.ts`. A whitespace-bounded `/dsh-creative-studio-sound-design`
 * on the first line loads that skill for this turn only, which is the whole
 * reason these skills are not resident.
 */

/** The BPM band the source table gives for each of the playbook's pacing profiles. */
const BPM_BY_PACING: Record<string, { range: string; mood: string }> = {
  contemplative: { range: '60–80', mood: '沉静、专注' },
  conversational: { range: '90–110', mood: '平稳、不抢戏' },
  technical: { range: '90–110', mood: '清晰、克制' },
  // Cinematic sits in the same band but wants its slow end: the pictures are
  // already carrying the drama, and music competing with them is what makes a
  // film feel like a trailer.
  cinematic: { range: '90–110（取偏慢端）', mood: '有情绪但不压人' },
  energetic: { range: '120–140', mood: '热情、有推力' },
}

export interface MusicJobInput {
  projectId: string
  workflow: string
  /** Style playbook name, for the model to reason about mood. */
  styleName: string
  /** `playbook.narration.pacing_profile`. Decides the BPM band. */
  pacingProfile: string
  /** Film length in seconds, as the timeline currently stands. */
  totalSeconds: number
  /** `target_platform`, when the project names one. */
  platform?: string | undefined
  /** What the user typed as a starting point, if anything. */
  note?: string | undefined
}

import { importLine, workflowLine } from './job-conventions.js'

const NEWLINE = String.fromCharCode(10)
/** The skill the request opens with. Exported so the panel can check it loads. */
export const MUSIC_SKILL = 'dsh-creative-studio-sound-design'
const SKILL = MUSIC_SKILL

export function buildMusicJob(input: MusicJobInput): string {
  const band = BPM_BY_PACING[input.pacingProfile]
  // Rounded UP, and with headroom: a bed exactly the film's length loses its
  // last second to the fade-out. The skill says to err long for the same reason.
  const wanted = Math.ceil(input.totalSeconds + 5)

  const lines: string[] = [
    '/' + SKILL,
    '',
    '给项目 `' + input.projectId + '` 配一段背景音乐。**先按上面这份技能选曲**，再生成。',
    '',
    '这个片子的情况：',
    '- 风格：' + input.styleName + '（语速档 `' + input.pacingProfile + '`）',
    band === undefined
      ? '- BPM：按技能里的表自己判断'
      : '- 对应 BPM：**' + band.range + '**，情绪 ' + band.mood,
    '- 全片时长：' + input.totalSeconds.toFixed(1) + 's，所以**要一段至少 ' + wanted + ' 秒的曲子**',
  ]
  if (input.platform !== undefined && input.platform !== '' && input.platform !== 'generic') {
    lines.push('- 目标平台：' + input.platform)
  }
  if (input.note !== undefined && input.note.trim() !== '') {
    lines.push('- 用户的额外要求：' + input.note.trim())
  }

  lines.push('')
  lines.push(workflowLine(input.workflow))
  lines.push('')

  // The two rules that disqualify a track outright are repeated here rather
  // than left to the skill alone. They are the difference between a bed and a
  // ruined film, and the request is the last thing the model reads.
  lines.push('两条不能破的：**必须纯器乐**（负向写 vocals, lyrics, singing），'
    + '**动态要平**（不要 drop、不要渐强到高潮）。')
  lines.push('')
  // One bed, so no async line and no gate line: nothing to interleave, and
  // importing music advances no stage.
  lines.push(importLine({ kind: 'music', unit: '段' }))
  // Levels are not the model's to set. Saying so is cheaper than fielding a
  // request to "mix it a bit quieter", which there is no lever for.
  lines.push(
    '音量、压制、EQ、响度由合成时的 ffmpeg 处理（音乐床压 20dB、解说一响再让 8dB、'
    + '挖掉 2–4kHz、整体压到平台响度目标），**你不用管这些**。',
  )
  lines.push('')
  lines.push('搬完告诉我：**你选了多少 BPM、哪一类曲风、为什么配这个片子**。')

  return lines.join(NEWLINE)
}

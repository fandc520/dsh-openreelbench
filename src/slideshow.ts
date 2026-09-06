/**
 * Slideshow risk — the last check before a film is cut.
 *
 * Ported from OpenMontage's `lib/slideshow_risk.py`, which scores a plan across
 * dimensions that predict whether the output will feel like a slideshow rather
 * than a directed piece. That question is sharper here than it was there: this
 * pipeline literally makes a sequence of stills, so "is it a slideshow" is not
 * a risk it might drift into — it is the thing it is, and the only question is
 * whether it is a good one.
 *
 * UNLIKE the variation check, this one CAN refuse: `studio_compose` will not
 * render a blocking score without an explicit override (see `blocking` at the
 * bottom for what counts). The reasoning behind putting a stop here and
 * nowhere else:
 *
 *   - the variation check runs on a plan, where the answer is "reword it";
 *     stopping there would block work over a heuristic about intentions
 *   - this runs on finished material, where the score describes what a viewer
 *     will actually see, and a re-render is cheap next to publishing it
 *
 * And the refusal is aimed at the MODEL, not the person. A human who has
 * watched the thing and wants it anyway passes `force` and gets it. Governance
 * that a person cannot overrule is not governance, it is a wall.
 *
 * THREE OF OM's SIX DIMENSIONS HAVE NO DATA HERE, and porting them anyway
 * would have added three constants to an average — diluting the signal while
 * looking thorough:
 *
 *   - `weak_shot_intent` and half of `decorative_visuals` read `shot_intent` /
 *     `information_role` / `narrative_role`. This pipeline has none: a shot's
 *     purpose is the line of narration it sits against. Folded into one
 *     `decorative_visuals` proxy — a shot nobody made any decision about.
 *   - `weak_motion` reads camera movement. These are stills; motion is Ken
 *     Burns, added at compose time from the playbook. OM scores a flat 1.5 when
 *     there is no movement, which for us would be 1.5 on every film ever made.
 *     Replaced by `static_hold`: how long a single picture is asked to hold the
 *     screen, which is the same worry with data behind it.
 *   - `typography_overreliance` counts text and stat cards. We have no scene
 *     types and our playbooks forbid text in the picture outright. Replaced by
 *     `picture_rate`: how many pictures a minute of film gets, which is what
 *     actually separates a film from a deck.
 */
import type { SceneShot } from './schema.js'
import type { Playbook } from './playbooks.js'
import type { Verdict } from './variation.js'

export interface Dimension {
  /** 0–5, lower is better. */
  score: number
  reason: string
  /**
   * The same finding in a few words, for a panel with no room to explain.
   *
   * `reason` justifies the score and names the standard it judged against;
   * that belongs in a report. A row in a sidebar wants the advice only —
   * "偏慢，把长段拆成多镜" rather than the arithmetic behind it.
   */
  short?: string
}

export interface SlideshowReport {
  /** Mean of the dimensions, 0–5. */
  average: number
  verdict: Verdict
  dimensions: Record<string, Dimension>
  /** True when compose should refuse without an override. Not simply average >= 4; see below. */
  blocking: boolean
}

/** OpenMontage's thresholds, unchanged. */
function verdictFor(score: number): Verdict {
  if (score < 2) return 'strong'
  if (score < 3) return 'acceptable'
  if (score < 4) return 'revise'
  return 'fail'
}

function percent(part: number, whole: number): string {
  return Math.round((part / whole) * 100) + '%'
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** How long each section holds the screen, and which shot covers what. */
export interface SectionTimingLite {
  sectionId: string
  duration: number
  shots: Array<{ index: number; duration: number }>
}

/* -------------------------------------------------------------- dimensions */

function scoreRepetition(shots: readonly SceneShot[], subjects: ReadonlyMap<string, string>): Dimension {
  if (shots.length < 3) return { score: 0, reason: '镜数太少，谈不上重复' }

  const subjectOf = (shot: SceneShot): string =>
    normalise(shot.prompt ?? subjects.get(shot.section_id) ?? '')
  // OM also counted repeated scene TYPES here. We have no scene types, so the
  // dimension rests on the two sub-checks that do have data, reweighted to
  // still reach 5 on their own.
  const uniqueSubjects = new Set(shots.map(subjectOf).filter((text) => text !== ''))
  const withSubject = shots.filter((shot) => subjectOf(shot) !== '').length
  const uniqueRatio = withSubject === 0 ? 0 : uniqueSubjects.size / withSubject

  const sizes = new Map<string, number>()
  for (const shot of shots) {
    const size = shot.shot_language?.shot_size ?? 'none'
    sizes.set(size, (sizes.get(size) ?? 0) + 1)
  }
  const topSize = Math.max(...sizes.values())
  const sizeRatio = topSize / shots.length

  let score = 0
  const reasons: string[] = []
  if (withSubject === 0) {
    score += 2.5
    reasons.push('没有一镜写了画面主体')
  } else if (uniqueRatio < 0.6) {
    score += 2.5
    reasons.push('只有 ' + percent(uniqueSubjects.size, withSubject) + ' 的画面描述是不重样的')
  }
  if (sizeRatio > 0.6) {
    score += 2.5
    reasons.push(percent(topSize, shots.length) + ' 的镜头是同一个镜别')
  }
  return { score: Math.min(5, score), reason: reasons.join('；') || '画面和镜别都有变化' }
}

function scoreDecorative(shots: readonly SceneShot[]): Dimension {
  // OM asked whether a scene stated a purpose. Ours asks whether anyone made a
  // decision about it at all: no subject of its own, no shot language, no
  // texture. Such a shot exists because a section needed a picture, which is
  // the definition of decorative.
  const unconsidered = shots.filter((shot) => {
    const hasSubject = (shot.prompt ?? '').trim() !== ''
    const hasLanguage = Object.keys(shot.shot_language ?? {}).length > 0
    const hasTexture = (shot.texture_keywords ?? []).length > 0
    return !hasSubject && !hasLanguage && !hasTexture
  })
  const ratio = unconsidered.length / shots.length
  const score = Math.min(5, ratio * 5)
  const reason = ratio > 0.5
    ? unconsidered.length + '/' + shots.length + ' 镜没有任何自己的决定（无主体、无镜头语言、无质感词），只是「这一段需要张图」'
    : ratio > 0.2
      ? unconsidered.length + '/' + shots.length + ' 镜没写任何具体内容'
      : '大部分镜头都是想过的'
  return { score: Number(score.toFixed(1)), reason }
}

function scoreStaticHold(timings: readonly SectionTimingLite[], playbook: Playbook): Dimension {
  const holds = timings.flatMap((timing) => timing.shots.map((shot) => shot.duration))
  if (holds.length === 0) return { score: 0, reason: '还没有时间轴' }

  // A still stops holding attention somewhere past the style's own ceiling;
  // Ken Burns buys some of that back, which is exactly why a playbook that
  // turns it off has to cut faster.
  const ceiling = playbook.pacing.maxSectionSeconds
  const limit = playbook.kenBurns ? ceiling : ceiling * 0.6
  const overlong = holds.filter((seconds) => seconds > limit)
  const worst = Math.max(...holds)

  const ratio = overlong.length / holds.length
  const score = Math.min(5, ratio * 5 + (worst > limit * 1.5 ? 1 : 0))
  const reason = overlong.length === 0
    ? '每一张的停留都在 ' + limit.toFixed(0) + ' 秒以内'
    : overlong.length + '/' + holds.length + ' 张停留超过 ' + limit.toFixed(0) + ' 秒'
      + '（最长 ' + worst.toFixed(1) + ' 秒）'
      + (playbook.kenBurns ? '' : '，而这个风格关掉了 Ken Burns，画面是完全不动的')
  const short = overlong.length === 0 ? '停留合适' : '单张停留太久，拆段或加镜'
  return { score: Number(score.toFixed(1)), reason, short }
}

/**
 * Cuts per minute a style is expected to run at, from OpenMontage's
 * `skills/creative/cinematic.md` "Average Shot Length by Style".
 *
 * THIS HAS TO BE STYLE-RELATIVE, and the first version was not. An absolute
 * floor of six pictures a minute scored `warm-doc` as a slideshow — a playbook
 * whose own description is "缓慢、有呼吸感" and whose profile is
 * `contemplative`, for which OM's table gives 3–6 as the CORRECT range. The
 * check was marking a style down for succeeding at being itself.
 */
const CUTS_PER_MINUTE: Record<string, { low: number; label: string }> = {
  contemplative: { low: 3, label: '沉静' },
  conversational: { low: 5, label: '常速' },
  technical: { low: 5, label: '讲解' },
  cinematic: { low: 8, label: '电影感' },
  energetic: { low: 12, label: '快节奏' },
}

function scorePictureRate(
  shots: readonly SceneShot[],
  timings: readonly SectionTimingLite[],
  playbook: Playbook,
): Dimension {
  const total = timings.reduce((sum, timing) => sum + timing.duration, 0)
  if (total <= 0) return { score: 0, reason: '还没有时间轴' }
  const perMinute = (shots.length / total) * 60

  const profile = playbook.narration.pacing_profile
  const target = CUTS_PER_MINUTE[profile] ?? CUTS_PER_MINUTE.conversational!

  // The style's own low end is the pass mark: at or above it the film is
  // running at the speed it means to. Half of that is a deck being narrated.
  const floor = target.low
  const score = perMinute >= floor
    ? 0
    : perMinute <= floor * 0.5
      ? 5
      : ((floor - perMinute) / (floor * 0.5)) * 5

  const reason = '每分钟 ' + perMinute.toFixed(1) + ' 张画面'
    + '（' + target.label + '风格该有 ' + floor + ' 张以上）'
    + (perMinute >= floor ? '，节奏合适' : perMinute <= floor * 0.5 ? '，太少了，看起来就是在念幻灯片' : '，偏慢')
  const short = perMinute >= floor
    ? '节奏合适'
    : perMinute <= floor * 0.5
      ? '太慢，把长段拆成多镜'
      : '偏慢，可以再切几镜'
  return { score: Number(score.toFixed(1)), reason, short }
}

function scoreStyleClaim(shots: readonly SceneShot[], playbook: Playbook): Dimension {
  // OM keyed this off the renderer family. Ours keys off the playbook, which
  // is where the claim is actually made: a style calling itself cinematic has
  // to be backed by structure, or it is a label.
  const claim = (playbook.visual.style_hint ?? playbook.visual.image_prompt_prefix).toLowerCase()
  const claimsCinema = claim.includes('cinematic') || claim.includes('photographic')
  if (!claimsCinema) return { score: 0, reason: '这个风格没有声称电影感' }

  const issues: string[] = []
  if (!shots.some((shot) => shot.hero_moment === true)) {
    issues.push('自称电影感却没有一个高光镜')
  }
  const withLighting = shots.filter((shot) => shot.shot_language?.lighting_key !== undefined).length
  if (withLighting < shots.length * 0.3) {
    issues.push('自称电影感却只有 ' + withLighting + '/' + shots.length + ' 镜定了光线')
  }
  const sizes = new Set(shots.map((shot) => shot.shot_language?.shot_size).filter((size) => size !== undefined))
  if (sizes.size < 2) {
    issues.push('自称电影感却只有 ' + sizes.size + ' 种镜别')
  }
  return {
    score: Math.min(5, Number((issues.length * 1.8).toFixed(1))),
    reason: issues.join('；') || '电影感有结构撑着',
  }
}

/* ------------------------------------------------------------------ public */

/**
 * Score a film before it is cut.
 *
 * `timings` is the planned timeline — the same one the panel draws and compose
 * renders from, so the score is about the film that will exist rather than an
 * idealised version of the plan.
 */
export function scoreSlideshowRisk(
  shots: readonly SceneShot[],
  timings: readonly SectionTimingLite[],
  playbook: Playbook,
  subjects: ReadonlyMap<string, string> = new Map(),
): SlideshowReport {
  if (shots.length === 0) {
    return {
      average: 5,
      verdict: 'fail',
      dimensions: { repetition: { score: 5, reason: '没有分镜' } },
      blocking: true,
    }
  }

  const dimensions: Record<string, Dimension> = {
    repetition: scoreRepetition(shots, subjects),
    decorative_visuals: scoreDecorative(shots),
    static_hold: scoreStaticHold(timings, playbook),
    picture_rate: scorePictureRate(shots, timings, playbook),
    unsupported_style_claim: scoreStyleClaim(shots, playbook),
  }

  const scores = Object.values(dimensions).map((entry) => entry.score)
  const average = Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2))
  const verdict = verdictFor(average)

  // Blocking is NOT just the average, because the average hides the case that
  // matters most. A film where repetition, thoughtlessness and hold time are
  // each maxed out still averages 3.0 once two well-behaved dimensions are
  // folded in -- and that film is a slideshow by every measure that looked.
  //
  // So: block on a failing average, OR on a majority of dimensions each
  // failing on their own. Several independent measures agreeing is stronger
  // evidence than their mean, not weaker.
  const failing = scores.filter((score) => score >= 4).length
  const blocking = average >= 4 || failing > scores.length / 2

  return { average, verdict, dimensions, blocking }
}

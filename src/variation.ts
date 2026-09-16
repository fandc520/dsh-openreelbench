/**
 * Scene-plan variation check — run BEFORE anything is generated.
 *
 * Ported from OpenMontage's `lib/variation_checker.py`, which exists because a
 * plan can be schema-valid, fully populated, and still describe ten of the same
 * picture. Nothing downstream catches that: the manifest sees ten files, the
 * gate sees complete coverage, and the failure only becomes visible when a
 * person watches the finished film.
 *
 * The point of running it here is arithmetic. Ten stills is ten GPU jobs; a
 * problem caught in the plan costs a re-word, and the same problem caught in
 * the film costs the whole batch again.
 *
 * ADVISORY, NOT A GATE. It reports; it does not refuse. Refusing belongs to the
 * slideshow risk score at compose time, where there is a finished plan to judge
 * and a real decision to block. A checker that stops work on a heuristic gets
 * worked around, and then it stops being read at all.
 *
 * TWO OF OM's EIGHT CHECKS ARE DELIBERATELY NOT PORTED:
 *
 *   - *static shot overuse* ("at least 40% of scenes need camera movement").
 *     This pipeline produces stills. Motion is Ken Burns, applied at compose
 *     time from the playbook, not planned per shot — so the check would fire on
 *     every plan we ever make. A warning that is always on is noise, and noise
 *     is how a checker gets ignored.
 *   - *shot intent* ("every scene should explain why it exists"). Every shot
 *     here already sits against a line of narration, which is that answer. A
 *     second field restating it would be filled in to satisfy the check.
 *
 * ONE CHECK IS OURS, NOT OM's: duplicate subjects. Every picture in this
 * pipeline comes out of one workflow with one style clause, so two shots that
 * ask for the same thing get two of the same picture. OM, spreading work over
 * many providers, never had that as the FIRST thing to look for.
 */
import { t } from './i18n.js'

import type { SceneShot } from './schema.js'

/**
 * Words that describe nothing.
 *
 * OpenMontage's list, plus a few this pipeline attracts. They are not banned —
 * a phrase is only counted when it is most of what a shot says, because "a
 * modern kitchen, steam on the window" is specific and "a modern space" is not.
 */
const GENERIC_PHRASES = [
  'a person', 'a beautiful', 'modern', 'futuristic', 'cutting-edge',
  "in today's world", 'sleek design', 'innovative', 'state-of-the-art',
  'next-generation', 'revolutionary', 'a professional', 'dynamic',
  'vibrant', 'stunning', 'breathtaking', 'amazing', 'incredible',
  'powerful', 'seamless', 'elegant solution',
  // Seen in our own runs: what a model writes when it has nothing to say.
  'high quality', 'best quality', 'masterpiece', 'detailed', 'beautiful scene',
  'abstract concept', 'conceptual illustration',
]

export type Verdict = 'strong' | 'acceptable' | 'revise' | 'fail'

export interface Violation {
  /** Stable id, so a panel can dismiss or link one without matching prose. */
  code: string
  message: string
  /** Which shots it is about, by id. Empty when it is about the plan overall. */
  shotIds: string[]
}

export interface VariationReport {
  /** 0–5, lower is better. Each violation adds 0.6, as in OpenMontage. */
  score: number
  verdict: Verdict
  violations: Violation[]
  suggestions: string[]
  /** How many shots were judged; below 4 most checks stay quiet. */
  shotCount: number
}

/** OpenMontage's thresholds, unchanged, so the two report the same words. */
function verdictFor(score: number): Verdict {
  if (score < 2) return 'strong'
  if (score < 3) return 'acceptable'
  if (score < 4) return 'revise'
  return 'fail'
}

function percent(part: number, whole: number): string {
  return Math.round((part / whole) * 100) + '%'
}

/** Normalise a subject for comparison: case, punctuation and spacing. */
function normaliseSubject(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/**
 * Check a plan for the patterns that reliably produce a flat film.
 *
 * `subjects` supplies each section's own visual prompt, used for shots that
 * did not write one — the built prompt falls back the same way, so the check
 * judges the text that will actually be generated from.
 */
export function checkSceneVariation(
  shots: readonly SceneShot[],
  subjects: ReadonlyMap<string, string> = new Map(),
): VariationReport {
  const ordered = [...shots].sort((a, b) => (a.section_id === b.section_id
    ? a.shot_index - b.shot_index
    : a.section_id.localeCompare(b.section_id)))

  if (ordered.length === 0) {
    return {
      score: 5,
      verdict: 'fail',
      violations: [{ code: 'empty', message: t('还没有分镜计划，没有东西可以检查。'), shotIds: [] }],
      suggestions: [],
      shotCount: 0,
    }
  }

  const violations: Violation[] = []
  const suggestions: string[] = []
  const total = ordered.length
  // Below four shots there is no such thing as a repetitive pattern, and
  // firing on a two-shot plan would teach people to ignore the report.
  const enoughToJudge = total >= 4

  const subjectOf = (shot: SceneShot): string =>
    (shot.prompt ?? subjects.get(shot.section_id) ?? '').trim()

  /* -- 1. Shot size variety ------------------------------------------------ */
  const sizes = ordered.map((shot) => shot.shot_language?.shot_size ?? 'unspecified')
  const sizeCounts = new Map<string, number>()
  for (const size of sizes) sizeCounts.set(size, (sizeCounts.get(size) ?? 0) + 1)
  if (enoughToJudge) {
    const [topSize, topCount] = [...sizeCounts.entries()].sort((a, b) => b[1] - a[1])[0]!
    if (topCount / total > 0.5) {
      violations.push({
        code: 'shot-size-monotony',
        message: topSize === 'unspecified'
          ? total + t(' 镜里有 ') + topCount + t(' 镜没写镜别（') + percent(topCount, total) + '）。'
            + t('镜别是让画面不一样的第一层，全空等于全都交给模型自己猜。')
          : t('镜别「') + topSize + t('」占了 ') + topCount + '/' + total + t(' 镜（') + percent(topCount, total) + '）。',
        shotIds: ordered
          .filter((shot) => (shot.shot_language?.shot_size ?? 'unspecified') === topSize)
          .map((shot) => shot.id),
      })
      suggestions.push(t('远景定场和特写交替着来，画面才有节奏。'))
    }
  }

  /* -- 2. Consecutive same size -------------------------------------------- */
  // The longest actual RUN, not the count of equal adjacent pairs: the latter
  // adds up separate pairs (wide,wide,cu,cu,med,med) into a fake run of three.
  let longestRun = 1
  let currentRun = 1
  let runEnd = 0
  for (let index = 1; index < sizes.length; index += 1) {
    if (sizes[index] === sizes[index - 1] && sizes[index] !== 'unspecified') {
      currentRun += 1
      if (currentRun > longestRun) {
        longestRun = currentRun
        runEnd = index
      }
    } else {
      currentRun = 1
    }
  }
  if (longestRun >= 3) {
    violations.push({
      code: 'consecutive-same-size',
      message: t('连着 ') + longestRun + t(' 镜是同一个镜别，剪起来会觉得停在原地。'),
      shotIds: ordered.slice(runEnd - longestRun + 1, runEnd + 1).map((shot) => shot.id),
    })
  }

  /* -- 3. Lighting variety ------------------------------------------------- */
  const lightings = new Set(
    ordered.map((shot) => shot.shot_language?.lighting_key).filter((key) => key !== undefined),
  )
  if (enoughToJudge && lightings.size <= 1) {
    violations.push({
      code: 'lighting-monotony',
      message: total + t(' 镜只有 ') + lightings.size + t(' 种光线。光线是情绪转折最省力的手段。'),
      shotIds: [],
    })
  }

  /* -- 4. Hero moment ------------------------------------------------------ */
  const heroes = ordered.filter((shot) => shot.hero_moment === true)
  if (enoughToJudge && heroes.length === 0) {
    violations.push({
      code: 'no-hero',
      message: t('没有任何一镜标为高光。一支片子总该有一个画面是它的顶点。'),
      shotIds: [],
    })
    suggestions.push(t('把最有冲击力的那一镜勾上「高光」。'))
  }
  for (const hero of heroes) {
    const at = ordered.indexOf(hero)
    const heroSize = hero.shot_language?.shot_size
    if (heroSize === undefined) continue
    for (const offset of [-1, 1]) {
      const neighbour = ordered[at + offset]
      if (neighbour === undefined) continue
      if (neighbour.shot_language?.shot_size === heroSize) {
        violations.push({
          code: 'hero-not-distinct',
          message: t('高光镜 `') + hero.id + t('` 和相邻镜是同一个镜别，顶点就顶不起来。'),
          shotIds: [hero.id, neighbour.id],
        })
        break
      }
    }
  }

  /* -- 5. Generic language ------------------------------------------------- */
  const generic = ordered.filter((shot) => {
    const subject = subjectOf(shot).toLowerCase()
    if (subject === '') return false
    return GENERIC_PHRASES.some((phrase) => subject.includes(phrase))
  })
  if (generic.length >= total * 0.3) {
    violations.push({
      code: 'generic-language',
      message: generic.length + '/' + total + t(' 镜用了空词（modern、stunning 这类）。')
        + t('这种词对扩散模型等于没说，画面只会退回默认样子。'),
      shotIds: generic.map((shot) => shot.id),
    })
    suggestions.push(
      t('把「a beautiful cityscape」换成「rain-slicked Tokyo intersection at night, ')
      + t('neon reflections in puddles」这种能看见的东西。'),
    )
  }

  /* -- 6. Texture keywords ------------------------------------------------- */
  const textured = ordered.filter((shot) => (shot.texture_keywords ?? []).length > 0)
  if (enoughToJudge && textured.length < total * 0.3) {
    violations.push({
      code: 'no-texture',
      message: total + t(' 镜里只有 ') + textured.length + t(' 镜写了质感词。')
        + t('材质是同一个构图能出两种画面的地方。'),
      shotIds: [],
    })
  }

  /* -- 7. Duplicate subjects (ours, not OM's) ------------------------------ */
  // One workflow, one style clause: two shots asking for the same thing get
  // two of the same picture. This is the most direct form of the failure and
  // the cheapest to fix, so it is checked at any plan size.
  const bySubject = new Map<string, SceneShot[]>()
  for (const shot of ordered) {
    const key = normaliseSubject(subjectOf(shot))
    if (key === '') continue
    bySubject.set(key, [...(bySubject.get(key) ?? []), shot])
  }
  const duplicated = [...bySubject.values()].filter((group) => group.length > 1)
  if (duplicated.length > 0) {
    violations.push({
      code: 'duplicate-subject',
      message: duplicated
        .map((group) => group.length + t(' 镜写了同一个画面（') + group.map((shot) => shot.id).join('、') + '）')
        .join('；') + t('。同一条工作流出同一句提示词，就是同一张图。'),
      shotIds: duplicated.flat().map((shot) => shot.id),
    })
  }

  /* -- 8. Empty subjects --------------------------------------------------- */
  const empty = ordered.filter((shot) => subjectOf(shot) === '')
  if (empty.length > 0) {
    violations.push({
      code: 'empty-subject',
      message: empty.length + t(' 镜既没写画面，所在段也没有。生成时只剩风格和镜头语言，画什么全靠模型猜。'),
      shotIds: empty.map((shot) => shot.id),
    })
  }

  const score = Math.min(5, Number((violations.length * 0.6).toFixed(1)))
  return { score, verdict: verdictFor(score), violations, suggestions, shotCount: total }
}

/**
 * Style playbooks — the M1 layer, ported from OpenMontage's `styles/*.yaml`.
 *
 * A playbook is the answer to a failure this pipeline demonstrably has. In the
 * first live run, three sections produced two photographic renders and one flat
 * vector illustration, from the same model and the same seed policy, purely
 * because the three prompts were worded differently. Seeds control variety;
 * they do not control style. What controls style is a shared prefix, a shared
 * negative prompt, and a short list of anchors the model must not drift from —
 * exactly what OpenMontage's `asset_generation` block carries.
 *
 * A playbook also owns pacing. OpenMontage keeps `motion.pacing_rules` inside
 * the style for a good reason: a contemplative documentary and a brisk product
 * reveal want different holds, and pinning them to one global config makes
 * every style feel the same. So `pacing` and the subtitle width move here, and
 * the top-level config values become the fallback for a project with no style.
 *
 * Built-ins are TypeScript constants rather than YAML files on disk: they ship
 * with the package, get type-checked, and need no parser dependency. Custom
 * playbooks are plain config — `bindings`-style data the user edits in
 * cordis.yml (and, once the settings section lands, in the browser).
 */
import type { ShotLanguage } from './schema.js'
import { styleClause } from './prompt.js'


export interface PlaybookVisual {
  /**
   * Layer 5 of the prompt: what this style IS, in one clause.
   *
   * Medium and palette only. Anything about light, framing or depth belongs in
   * `shot_defaults`, where a shot can overrule it - the old prefix carried all
   * of that as fixed text, which is precisely what made every picture the same.
   */
  style_hint?: string
  /**
   * The style's preference for each shot-language field, used only where the
   * shot itself is silent.
   *
   * A preference, not a rule. That distinction is the whole of the fix: the
   * house look survives, and a shot that wants a long lens still gets one.
   */
  shot_defaults?: ShotLanguage
  /**
   * @deprecated Layer 5 reads `style_hint`. Kept because a custom playbook in
   * settings may only have this, and it is the fallback when `style_hint` is
   * absent. Do not add to it.
   */
  image_prompt_prefix: string
  /**
   * @deprecated Superseded by `shot_defaults`. No longer sent to any workflow:
   * every built-in suffix held lighting, composition and a hard-coded `16:9`,
   * and the last of those is now wrong outright - the frame follows
   * `target_platform`, which can be vertical.
   */
  image_prompt_suffix: string
  /** Passed as the negative prompt on every generation. */
  negative_prompt: string
  /** Non-negotiables restated to the model for every section. */
  consistency_anchors: string[]
}

export interface PlaybookNarration {
  /** Feeds `script.voice_performance.performance_intent`. */
  voice_style: string
  /** Feeds `script.voice_performance.pacing_profile`. */
  pacing_profile: 'contemplative' | 'conversational' | 'energetic' | 'technical' | 'cinematic'
  /**
   * Spoken characters per second, used to size the script before any audio
   * exists. Measured at 4.95 for Chinese narration on Qwen3-TTS; a slower
   * style should lower it so the script comes out shorter, not longer.
   */
  chars_per_second: number
}

export interface PlaybookPacing {
  padBeforeSeconds: number
  padAfterSeconds: number
  minSectionSeconds: number
  /** A still cannot hold attention past this; the script should split instead. */
  maxSectionSeconds: number
}

export interface Playbook {
  name: string
  /** One line the model shows the user when offering styles. */
  mood: string
  best_for: string
  visual: PlaybookVisual
  narration: PlaybookNarration
  pacing: PlaybookPacing
  /** Slow push-in on stills. */
  kenBurns: boolean
  fit: 'pad' | 'cover'
  /** Characters per subtitle cue before it is split. */
  subtitleMaxChars: number
  /** Restated to the model at the script and asset stages. */
  quality_rules: string[]
}

/** The style a project falls back to when it names none. */
export const DEFAULT_STYLE = 'clean-tech'

export const BUILT_IN_PLAYBOOKS: Record<string, Playbook> = {
  'clean-tech': {
    name: '清晰科技',
    mood: '冷静、可信、信息密度高',
    best_for: '技术解说、产品说明、概念拆解',
    visual: {
      // Medium and palette. What the old suffix also carried - even lighting,
      // centred composition - is now a default a shot can argue with.
      style_hint: 'clean technical illustration, dark navy background with teal and amber accents',
      shot_defaults: {
        lighting_key: 'high_key',
        color_temperature: 'cool',
        depth_of_field: 'deep',
        // No shot_size default on purpose. Framing is the one field whose
        // phrasing presumes a subject - "medium shot from waist up" puts a
        // person in a picture of a corridor. A shot with no opinion about
        // framing is better off saying nothing than saying the wrong thing.
      },
      image_prompt_prefix:
        'clean technical illustration, dark navy background, teal and amber accent palette, ',
      image_prompt_suffix:
        ', soft even lighting, generous negative space, centered composition, 16:9',
      negative_prompt:
        'text, letters, words, watermark, signature, ui, logo, photorealistic portrait, '
        + 'cluttered, busy, low contrast, oversaturated, grainy, jpeg artifacts',
      consistency_anchors: [
        '全片统一：深蓝底 + 青色主体 + 琥珀色点缀，不出现第四种主色',
        '统一为插画质感，不要混入摄影级真实渲染',
        '统一柔和均匀布光，不要戏剧性侧光和强阴影',
        '画面主体居中，四周留白，不要满构图',
      ],
    },
    narration: {
      voice_style: '像同行讲给同行听，克制、直给，不煽情不卖关子',
      pacing_profile: 'conversational',
      chars_per_second: 4.9,
    },
    pacing: { padBeforeSeconds: 0.15, padAfterSeconds: 0.45, minSectionSeconds: 2, maxSectionSeconds: 20 },
    kenBurns: true,
    fit: 'cover',
    subtitleMaxChars: 24,
    quality_rules: [
      '同屏主色不超过三种（底色不计）',
      '画面里不出现任何文字——文字交给字幕层',
      '每段只讲一件事，讲不完就拆段',
      '静帧最长 20 秒，超过就该拆',
    ],
  },

  'warm-doc': {
    name: '温暖纪实',
    mood: '缓慢、有呼吸感、带情绪',
    best_for: '人物故事、品牌短片、随笔式解说',
    visual: {
      // The golden light moves out of the fixed clause: it is this style's
      // preference, not a law, and a night scene should be able to say so.
      style_hint: 'cinematic photographic still, muted earth tones, film grain',
      shot_defaults: {
        lighting_key: 'golden_hour',
        color_temperature: 'warm',
        depth_of_field: 'shallow',
        lens_mm: 50,
      },
      image_prompt_prefix:
        'cinematic photographic still, warm golden hour light, muted earth tones, film grain, ',
      image_prompt_suffix:
        ', shallow depth of field, natural composition, 16:9',
      negative_prompt:
        'text, letters, words, watermark, logo, ui, vector, flat illustration, cartoon, '
        + '3d render, neon, oversaturated, harsh flash',
      consistency_anchors: [
        '全片统一暖色调，不要出现冷蓝或霓虹',
        '统一为摄影质感，不要混入矢量插画',
        '统一浅景深，主体清晰背景虚化',
        '自然光，不要影棚硬光',
      ],
    },
    narration: {
      voice_style: '放慢，留白，像在讲一件自己在意的事',
      pacing_profile: 'contemplative',
      chars_per_second: 4.2,
    },
    pacing: { padBeforeSeconds: 0.35, padAfterSeconds: 0.9, minSectionSeconds: 3.5, maxSectionSeconds: 24 },
    kenBurns: true,
    fit: 'cover',
    subtitleMaxChars: 20,
    quality_rules: [
      '统一暖色调，一段冷色都不要',
      '段与段之间留足停顿，不要赶',
      '画面里不出现任何文字',
      '每段至少 3.5 秒，短了没有呼吸感',
    ],
  },

  'flat-brief': {
    name: '扁平快讲',
    mood: '明快、干脆、信息优先',
    best_for: '功能速览、要点罗列、社交平台短片',
    visual: {
      style_hint:
        'flat vector illustration, bold solid shapes, white background, '
        + 'high contrast primary palette, no gradients or shadows',
      shot_defaults: {
        lighting_key: 'high_key',
        color_temperature: 'neutral',
        depth_of_field: 'deep',
      },
      image_prompt_prefix:
        'flat vector illustration, bold solid shapes, white background, high contrast primary palette, ',
      image_prompt_suffix:
        ', minimal, no gradients, no shadows, centered, 16:9',
      negative_prompt:
        'text, letters, words, watermark, logo, photorealistic, 3d render, gradient, '
        + 'drop shadow, texture, grain, dark background',
      consistency_anchors: [
        '全片白底，不要深色背景',
        '统一扁平矢量，不要渐变、阴影、材质',
        '色块饱和度一致，不要一段浓一段淡',
        '主体居中，构图简单到一眼看懂',
      ],
    },
    narration: {
      voice_style: '干脆利落，句子短，不铺垫',
      pacing_profile: 'energetic',
      chars_per_second: 5.6,
    },
    pacing: { padBeforeSeconds: 0.1, padAfterSeconds: 0.25, minSectionSeconds: 1.5, maxSectionSeconds: 12 },
    kenBurns: false,
    fit: 'pad',
    subtitleMaxChars: 18,
    quality_rules: [
      '白底扁平，一段深色画面都不要',
      '每段一句话讲完，不要复句',
      '画面里不出现任何文字',
      '静帧最长 12 秒',
    ],
  },
}

/**
 * Resolve a style name against the built-ins plus whatever the config adds.
 * A custom playbook with a built-in's name replaces it wholesale rather than
 * merging: a half-overridden palette is how styles drift.
 */
export function resolvePlaybook(
  style: string,
  custom: Record<string, Playbook> | undefined,
): { playbook: Playbook; resolved: string; fallback: boolean } {
  const all = { ...BUILT_IN_PLAYBOOKS, ...(custom ?? {}) }
  const wanted = style.trim()
  const hit = wanted === '' ? undefined : all[wanted]
  if (hit !== undefined) return { playbook: hit, resolved: wanted, fallback: false }
  const fallbackPlaybook = all[DEFAULT_STYLE] ?? BUILT_IN_PLAYBOOKS[DEFAULT_STYLE]!
  return { playbook: fallbackPlaybook, resolved: DEFAULT_STYLE, fallback: wanted !== '' }
}

/**
 * Every style, each with its full playbook.
 *
 * The whole playbook rides along rather than a summary because the project
 * screen shows a style's palette, pacing and anchors *while the user is still
 * choosing*. A summary would force a round trip per dropdown change, and the
 * detail panel would lag a selection it is supposed to explain.
 */
export function listPlaybooks(custom: Record<string, Playbook> | undefined): Array<{
  id: string
  name: string
  mood: string
  best_for: string
  source: 'built-in' | 'custom'
  playbook: Playbook
}> {
  const customIds = new Set(Object.keys(custom ?? {}))
  const all = { ...BUILT_IN_PLAYBOOKS, ...(custom ?? {}) }
  return Object.entries(all).map(([id, playbook]) => ({
    id,
    playbook,
    name: playbook.name,
    mood: playbook.mood,
    best_for: playbook.best_for,
    source: customIds.has(id) ? 'custom' : 'built-in',
  }))
}

/** The exact strings the model must paste into a txt2img call. */
/**
 * What the model needs to know about pictures in this style.
 *
 * No longer a template to assemble. Prompts are built host-side by
 * `buildShotPrompt`, layer by layer, and handed over finished - a template
 * invites the model to paste the same fixed text around every subject, which
 * is the failure this whole layer exists to undo. What is left here is the
 * part the model genuinely decides: what each picture is OF, and which shot
 * language suits it.
 */
export function renderVisualContract(playbook: Playbook): string {
  const defaults = playbook.visual.shot_defaults ?? {}
  const named = Object.entries(defaults)
    .map(([key, value]) => key + '=' + String(value))
  return [
    '**图像提示词不用你拼。** 插件按五层拼好后给你，你只需要决定两件事：',
    '',
    '1. 每一镜**拍什么**（scene_plan 的 `prompt`，一句英文，只写画面主体）',
    '2. 用什么**镜头语言**（`shot_language`，选填，词表见 skill）',
    '',
    '这个风格是：' + styleClause(playbook),
    ...(named.length === 0 ? [] : [
      '它偏好的镜头语言：' + named.join('　') + '（**只是默认**，你在某一镜写了就以你的为准）',
    ]),
    '',
    '负向提示词（插件会一起给出，一字不改）：',
    '',
    '    ' + playbook.visual.negative_prompt,
    '',
    '一致性锚点（每一段都要守住）：',
    ...playbook.visual.consistency_anchors.map((line) => '- ' + line),
  ].join(String.fromCharCode(10))
}

/**
 * The five-layer shot prompt builder.
 *
 * WHAT THIS REPLACES, and why it had to go:
 *
 *   prompt = playbook.image_prompt_prefix + <this shot's subject> + playbook.image_prompt_suffix
 *
 * Every picture in a film got the same first clause and the same last clause,
 * with one short phrase varying in between. A diffusion model conditions on
 * the whole string, so the constant part dominates: composition, framing and
 * lighting collapse onto one look, and ten sections produce ten of the same
 * picture. OpenMontage hit this and abandoned the approach — its
 * `shot_prompt_builder.py` says so in its own docstring. This is that fix,
 * ported.
 *
 * The inversion is the point. Style stops being the loudest thing in the
 * prompt and becomes a short closing clause; shot language — lens, framing,
 * movement, light — goes from absent to being the bulk of what varies. Four of
 * the five layers change from shot to shot.
 *
 *   1  Camera    lens, depth of field
 *   2  Movement  shot size, camera movement
 *   3  Subject   what this picture is OF, plus texture words
 *   4  Lighting  key, colour temperature
 *   5  Style     one clause from the playbook  <- the only fixed layer
 *
 * A playbook still gets an opinion, but it holds it as a DEFAULT rather than a
 * decree: `shot_defaults` fills any layer a shot left blank, and a shot that
 * names its own lens or light always wins. That is what keeps a house style
 * intact without making every frame identical.
 *
 * The phrase tables below are OpenMontage's, value for value, so the enum
 * vocabulary in `scene_plan` means the same thing on both sides.
 */
import type { SceneShot, ShotLanguage } from './schema.js'
import type { Playbook } from './playbooks.js'

const SHOT_SIZE_PHRASES: Record<string, string> = {
  extreme_wide: 'extreme wide shot showing vast environment',
  wide: 'wide shot capturing full scene',
  medium_wide: 'medium-wide shot framing subject with surroundings',
  medium: 'medium shot from waist up',
  medium_close: 'medium close-up from chest up',
  close_up: 'close-up focusing on face or detail',
  extreme_close_up: 'extreme close-up on fine detail',
  over_shoulder: 'over-the-shoulder perspective',
  insert: 'insert shot of specific detail',
  establishing: 'establishing shot setting the location',
}

const MOVEMENT_PHRASES: Record<string, string> = {
  static: 'locked-off static camera',
  pan_left: 'smooth pan to the left',
  pan_right: 'smooth pan to the right',
  tilt_up: 'gentle tilt upward',
  tilt_down: 'gentle tilt downward',
  dolly_in: 'slow dolly in toward subject',
  dolly_out: 'slow dolly out from subject',
  tracking_left: 'tracking shot moving left alongside subject',
  tracking_right: 'tracking shot moving right alongside subject',
  crane_up: 'crane shot rising upward',
  crane_down: 'crane shot descending',
  handheld: 'handheld camera with natural movement',
  steadicam: 'smooth steadicam following movement',
  whip_pan: 'fast whip pan',
  orbital: 'orbital camera circling subject',
  zoom_in: 'slow zoom in',
  zoom_out: 'slow zoom out',
  rack_focus: 'rack focus shift between foreground and background',
}

const LIGHTING_PHRASES: Record<string, string> = {
  high_key: 'bright high-key lighting, minimal shadows',
  low_key: 'dramatic low-key lighting with deep shadows',
  natural: 'natural ambient lighting',
  golden_hour: 'warm golden hour sunlight',
  blue_hour: 'cool blue hour twilight',
  tungsten_warm: 'warm tungsten interior lighting',
  neon: 'neon-lit with vibrant color spill',
  silhouette: 'backlit silhouette',
  rim_lit: 'rim lighting highlighting edges',
  volumetric: 'volumetric light with visible rays',
  overcast_soft: 'soft overcast diffused light',
}

const DOF_PHRASES: Record<string, string> = {
  shallow: 'shallow depth of field with bokeh',
  medium: 'medium depth of field',
  deep: 'deep focus with everything sharp',
}

const COLOR_TEMP_PHRASES: Record<string, string> = {
  cool: 'cool blue-toned color palette',
  neutral: 'neutral balanced colors',
  warm: 'warm amber-toned color palette',
  mixed: 'mixed color temperatures for contrast',
}

/** Which layer each clause came from, so a panel can show its work. */
export interface PromptLayer {
  layer: 1 | 2 | 3 | 4 | 5
  name: string
  text: string
  /** True when the playbook supplied this rather than the shot. */
  fromDefaults: boolean
}

export interface BuiltPrompt {
  shotId: string
  sectionId: string
  shotIndex: number
  /** The string to send to the image workflow. */
  prompt: string
  /** The playbook's negative, unchanged. */
  negative: string
  layers: PromptLayer[]
  /** Set when this shot had nothing of its own to show. */
  missingSubject: boolean
}

/**
 * The shot's own language over the playbook's, field by field.
 *
 * Not an object spread of one over the other: a shot that sets only a lens
 * should still pick up the style's preferred light, and spreading a
 * partially-filled object would blank the rest.
 */
export function resolveShotLanguage(
  shot: ShotLanguage | undefined,
  defaults: ShotLanguage | undefined,
): { value: ShotLanguage; fromDefaults: Set<keyof ShotLanguage> } {
  const value: ShotLanguage = {}
  const fromDefaults = new Set<keyof ShotLanguage>()
  const keys: Array<keyof ShotLanguage> = [
    'shot_size', 'camera_movement', 'lens_mm', 'lighting_key', 'color_temperature', 'depth_of_field',
  ]
  for (const key of keys) {
    const own = shot?.[key]
    if (own !== undefined) {
      Object.assign(value, { [key]: own })
      continue
    }
    const fallback = defaults?.[key]
    if (fallback !== undefined) {
      Object.assign(value, { [key]: fallback })
      fromDefaults.add(key)
    }
  }
  return { value, fromDefaults }
}

/**
 * The style clause — layer 5.
 *
 * A playbook written before this existed only has the old prefix, so the
 * prefix is the fallback: trailing punctuation trimmed, used as it stands. It
 * is worse than a purpose-written hint — a prefix tends to carry lighting and
 * composition that now belong to layers 2 and 4 — but it is never wrong, and
 * it keeps a custom playbook working the day this ships.
 */
export function styleClause(playbook: Playbook): string {
  const hint = playbook.visual.style_hint?.trim()
  if (hint !== undefined && hint !== '') return hint
  return playbook.visual.image_prompt_prefix.trim().replace(/[,，\s]+$/, '')
}

/**
 * Build one shot's prompt.
 *
 * `fallbackSubject` is the section's own `visual.prompt` from the script, used
 * when a shot has not been given a subject of its own — a section split into
 * three shots that only described the first still has to produce three
 * pictures.
 */
export function buildShotPrompt(
  shot: SceneShot,
  playbook: Playbook,
  fallbackSubject?: string,
): BuiltPrompt {
  const { value: language, fromDefaults } = resolveShotLanguage(
    shot.shot_language,
    playbook.visual.shot_defaults,
  )
  const layers: PromptLayer[] = []
  const add = (
    layer: PromptLayer['layer'],
    name: string,
    text: string,
    keys: Array<keyof ShotLanguage>,
  ): void => {
    if (text === '') return
    layers.push({
      layer,
      name,
      text,
      fromDefaults: keys.length > 0 && keys.every((key) => fromDefaults.has(key)),
    })
  }

  // 1. Camera.
  const camera = [
    language.lens_mm === undefined ? '' : language.lens_mm + 'mm lens',
    language.depth_of_field === undefined ? '' : DOF_PHRASES[language.depth_of_field] ?? '',
  ].filter((part) => part !== '')
  add(1, '相机', camera.join(', '), ['lens_mm', 'depth_of_field'])

  // 2. Movement. A locked-off camera is the default state of a still, so
  //    saying so adds a clause without adding information.
  const movement = [
    language.shot_size === undefined ? '' : SHOT_SIZE_PHRASES[language.shot_size] ?? language.shot_size,
    language.camera_movement === undefined || language.camera_movement === 'static'
      ? ''
      : MOVEMENT_PHRASES[language.camera_movement] ?? language.camera_movement,
  ].filter((part) => part !== '')
  add(2, '镜头', movement.join(', '), ['shot_size', 'camera_movement'])

  // 3. Subject.
  const subject = (shot.prompt ?? fallbackSubject ?? '').trim()
  const texture = (shot.texture_keywords ?? []).map((word) => word.trim()).filter((word) => word !== '')
  const subjectText = [subject, texture.join(', ')].filter((part) => part !== '').join('. ')
  add(3, '主体', subjectText, [])

  // 4. Lighting.
  const lighting = [
    language.lighting_key === undefined ? '' : LIGHTING_PHRASES[language.lighting_key] ?? '',
    language.color_temperature === undefined ? '' : COLOR_TEMP_PHRASES[language.color_temperature] ?? '',
  ].filter((part) => part !== '')
  add(4, '光线', lighting.join(', '), ['lighting_key', 'color_temperature'])

  // 5. Style — last and short, which is the whole reorganisation in one line.
  add(5, '风格', styleClause(playbook), [])

  return {
    shotId: shot.id,
    sectionId: shot.section_id,
    shotIndex: shot.shot_index,
    prompt: layers.map((entry) => entry.text).join('. '),
    negative: playbook.visual.negative_prompt,
    layers,
    missingSubject: subject === '',
  }
}

/** Every shot in a plan, in screen order. */
export function buildScenePrompts(
  shots: readonly SceneShot[],
  playbook: Playbook,
  subjects: ReadonlyMap<string, string>,
): BuiltPrompt[] {
  return [...shots]
    .sort((a, b) => (a.section_id === b.section_id
      ? a.shot_index - b.shot_index
      : a.section_id.localeCompare(b.section_id)))
    .map((shot) => buildShotPrompt(shot, playbook, subjects.get(shot.section_id)))
}

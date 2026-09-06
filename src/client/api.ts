/**
 * Typed fetches against the studio routes, plus the shapes the screens read.
 *
 * The types are declared here rather than imported from the host modules:
 * a wire payload is a contract of its own, and pulling `src/state.ts` into the
 * browser bundle to describe it would drag the whole state machine along with
 * it. What crosses the wire is JSON, and this file is where its shape lives.
 */

export interface ProjectMarker {
  id: string
  title: string
  pipeline: string
  style: string
  created_at: string
  target_duration_seconds: number
  /** Where the film is headed. Decides the output frame; see PLATFORM_FRAMES. */
  target_platform?: string
  voice: string
  /** A voice-design proposal the agent left for the panel to pick up. */
  voice_design_name?: string
  voice_design_prompt?: string
  lora_name?: string
  lora_strength?: number
  /** Reference image names in ComfyUI's input directory, project-wide. */
  references?: string[]
  /** Reference AUDIO names in the same directory — voice cloning, project-wide. */
  voice_references?: string[]
  /**
   * How many shots each section is cut into, and what each is meant to show.
   *
   * A VIEW served off the scene_plan artifact (older projects: off the marker).
   * Write it with `api.saveScenePlan`, never through `updateProject`.
   */
  shot_plan?: Record<string, Array<{ prompt?: string; weight?: number }>>
}

export type StageStatus = 'pending' | 'in_progress' | 'awaiting_human' | 'completed' | 'failed'

export interface StageView {
  stage: string
  status: StageStatus
  gated: boolean
  human_approved: boolean
  timestamp?: string
  note?: string
}

export type ScreenId = 'project' | 'script' | 'assets-audio' | 'assets-shots' | 'timeline'

export interface PipelineStage {
  id: string
  screen: ScreenId
  gated: boolean
  label: string
  hint: string
}

export interface Pipeline {
  id: string
  name: string
  description: string
  command: string
  best_for: string
  stages: PipelineStage[]
}

export interface Playbook {
  name: string
  mood: string
  best_for: string
  visual: {
    /** Layer 5 of the built prompt: medium and palette, one clause. */
    style_hint?: string
    /** What the style prefers per shot, used only where a shot is silent. */
    shot_defaults?: Record<string, string | number>
    image_prompt_prefix: string
    image_prompt_suffix: string
    negative_prompt: string
    consistency_anchors: string[]
  }
  narration: { voice_style: string; pacing_profile: string; chars_per_second: number }
  pacing: { padBeforeSeconds: number; padAfterSeconds: number; minSectionSeconds: number; maxSectionSeconds: number }
  quality_rules: string[]
}

export interface StyleOption {
  id: string
  name: string
  mood: string
  best_for: string
  source: 'built-in' | 'custom'
  /** The whole playbook, so the project screen can preview a style before saving it. */
  playbook: Playbook
}

export interface Brief {
  version?: string
  title?: string
  hook?: string
  key_points?: string[]
  audience?: string
  tone?: string
  target_duration_seconds?: number
  style?: string
  [key: string]: unknown
}

export interface CutSection {
  id: string
  lead?: number
  tail?: number
  trimStart?: number
  trimEnd?: number
  cues?: Array<{ text: string; weight?: number }>
  cueLead?: number
  cueTail?: number
  shots?: Array<{ assetId: string; weight?: number }>
}

/** One saved edit of the finished film. */
export interface Cut {
  version: string
  id: string
  name: string
  created_at: string
  updated_at: string
  note?: string
  sections: CutSection[]
  output?: string
  duration_seconds?: number
}

export interface StudioState {
  project: ProjectMarker
  pipeline: { id: string; fallback: boolean; definition: Pipeline }
  style: { id: string; fallback: boolean; playbook: Playbook; options: StyleOption[] }
  stages: StageView[]
  next_stage: string | null
  awaiting_approval: string | null
  artifacts: { brief?: Brief; [key: string]: unknown }
  /** Planned on-screen timing, computed host-side from the same pacing rules compose uses. */
  timeline: Array<{
    sectionId: string
    label: string
    start: number
    duration: number
    speechSeconds: number
    lead: number
    trimStart: number
    narrationPath?: string
    text: string
    shots: Array<{
      index: number; assetId?: string; path?: string
      start: number; duration: number; weight: number
    }>
    cues: Array<{ start: number; end: number; text: string }>
    /** Index of each cue within its section, so an edit knows which one it is. */
  }>
  /**
   * Prompts built host-side, five layers deep, one per planned shot.
   *
   * Derived, never submitted back — the panel shows them and sends them, it
   * does not own them. Empty until a scene_plan exists.
   */
  prompts: Array<{
    shotId: string
    sectionId: string
    shotIndex: number
    prompt: string
    negative: string
    layers: Array<{ layer: number; name: string; text: string; fromDefaults: boolean }>
    missingSubject: boolean
  }>
  /**
   * The pre-generation variation check. Advisory: it reports, it never blocks.
   * Null until a scene_plan exists.
   */
  variation: {
    score: number
    verdict: 'strong' | 'acceptable' | 'revise' | 'fail'
    violations: Array<{ code: string; message: string; shotIds: string[] }>
    suggestions: string[]
    shotCount: number
  } | null
  /**
   * Slideshow risk for the film about to be cut. Unlike `variation` this one
   * blocks: compose refuses at 4.0 unless the user overrides it.
   */
  slideshow: {
    average: number
    verdict: 'strong' | 'acceptable' | 'revise' | 'fail'
    dimensions: Record<string, { score: number; reason: string; short?: string }>
    blocking: boolean
  } | null
  film: { path: string; url: string } | null
  /** Saved edit versions, newest first. */
  cuts: Cut[]
  bindings: Record<string, { workflows?: string[]; workflow?: string; notes: string }>
}

export interface Catalog {
  pipelines: Pipeline[]
  styles: StyleOption[]
  default_duration_seconds: number
}

export interface LibraryFile {
  name: string
  path: string
  kind: string
  bytes: number
  modified: string
  url: string
  download_url: string
}

export interface LibraryProject {
  id: string
  title: string
  created_at: string
  total_bytes: number
  categories: Array<{ id: string; label: string; files: LibraryFile[] }>
}

export interface TrashEntry {
  entry: string
  id: string
  title: string
  removed_at: string
  created_at: string
  bytes: number
}

/**
 * Every workflow a binding offers, default first.
 *
 * Mirrors the host's `bindingWorkflows`. Spelled again here rather than
 * imported because this file describes the wire, and the wire carries both the
 * list and the older single-name spelling.
 */
export function bindingWorkflows(
  binding: { workflows?: string[]; workflow?: string } | undefined,
): string[] {
  const all = [
    ...(binding?.workflow === undefined ? [] : [binding.workflow]),
    ...(binding?.workflows ?? []),
  ]
  return [...new Set(all.map((name) => name.trim()).filter((name) => name !== ''))]
}

/**
 * What each platform renders to, for the picker's hint text.
 *
 * The host decides the real frame (`src/media-profile.ts`); this is a label so
 * the user can see the consequence before saving. Keep the two in step - a
 * picker that promises a shape the renderer does not produce is worse than a
 * picker with no hint at all.
 */
export const PLATFORM_FRAMES: ReadonlyArray<{ id: string; label: string; frame: string }> = [
  { id: 'generic', label: '不指定', frame: '用设置里的默认画幅' },
  { id: 'youtube', label: 'YouTube', frame: '1920×1080 横屏 16:9' },
  { id: 'bilibili', label: '哔哩哔哩', frame: '1920×1080 横屏 16:9' },
  { id: 'douyin', label: '抖音', frame: '1080×1920 竖屏 9:16' },
  { id: 'xiaohongshu', label: '小红书', frame: '1080×1440 竖屏 3:4' },
  { id: 'wechat', label: '微信视频号', frame: '1080×1920 竖屏 9:16' },
]

/**
 * The shot-language vocabulary, with Chinese labels for the pickers.
 *
 * The ids are the schema's enums and the host's phrase-table keys; only the
 * labels live here. A value the schema does not know is refused on save, so
 * these lists are cross-checked against it in the test suite rather than
 * trusted to stay in step by hand.
 */
export const SHOT_LANGUAGE_FIELDS: ReadonlyArray<{
  key: string
  label: string
  hint: string
  options: ReadonlyArray<{ id: string; label: string }>
}> = [
  {
    key: 'shot_size',
    label: '镜别',
    hint: '离主体多远',
    options: [
      { id: 'establishing', label: '定场' }, { id: 'extreme_wide', label: '大远景' },
      { id: 'wide', label: '远景' }, { id: 'medium_wide', label: '中远景' },
      { id: 'medium', label: '中景' }, { id: 'medium_close', label: '中近景' },
      { id: 'close_up', label: '特写' }, { id: 'extreme_close_up', label: '大特写' },
      { id: 'over_shoulder', label: '过肩' }, { id: 'insert', label: '插入' },
    ],
  },
  {
    key: 'lens_mm',
    label: '焦段',
    hint: '广角还是长焦',
    options: [
      { id: '14', label: '14mm 超广' }, { id: '24', label: '24mm 广角' },
      { id: '35', label: '35mm 小广' }, { id: '50', label: '50mm 标准' },
      { id: '85', label: '85mm 中长' }, { id: '135', label: '135mm 长焦' },
      { id: '200', label: '200mm 超长' },
    ],
  },
  {
    key: 'depth_of_field',
    label: '景深',
    hint: '背景虚不虚',
    options: [
      { id: 'shallow', label: '浅（背景虚化）' }, { id: 'medium', label: '中' },
      { id: 'deep', label: '深（全清晰）' },
    ],
  },
  {
    key: 'lighting_key',
    label: '光线',
    hint: '这一镜的光',
    options: [
      { id: 'natural', label: '自然光' }, { id: 'high_key', label: '高调（明亮少影）' },
      { id: 'low_key', label: '低调（重影戏剧）' }, { id: 'golden_hour', label: '黄金时刻' },
      { id: 'blue_hour', label: '蓝调时刻' }, { id: 'tungsten_warm', label: '暖钨丝' },
      { id: 'neon', label: '霓虹' }, { id: 'silhouette', label: '剪影' },
      { id: 'rim_lit', label: '轮廓光' }, { id: 'volumetric', label: '丁达尔' },
      { id: 'overcast_soft', label: '阴天柔光' },
    ],
  },
  {
    key: 'color_temperature',
    label: '色温',
    hint: '冷暖',
    options: [
      { id: 'cool', label: '冷' }, { id: 'neutral', label: '中性' },
      { id: 'warm', label: '暖' }, { id: 'mixed', label: '冷暖对比' },
    ],
  },
  {
    key: 'camera_movement',
    label: '运动',
    hint: '静帧一般留空',
    options: [
      { id: 'static', label: '固定' }, { id: 'pan_left', label: '左摇' },
      { id: 'pan_right', label: '右摇' }, { id: 'tilt_up', label: '上摇' },
      { id: 'tilt_down', label: '下摇' }, { id: 'dolly_in', label: '推' },
      { id: 'dolly_out', label: '拉' }, { id: 'tracking_left', label: '左跟' },
      { id: 'tracking_right', label: '右跟' }, { id: 'crane_up', label: '升' },
      { id: 'crane_down', label: '降' }, { id: 'handheld', label: '手持' },
      { id: 'steadicam', label: '斯坦尼康' }, { id: 'whip_pan', label: '甩镜' },
      { id: 'orbital', label: '环绕' }, { id: 'zoom_in', label: '变焦推' },
      { id: 'zoom_out', label: '变焦拉' }, { id: 'rack_focus', label: '变焦点' },
    ],
  },
]

/** A route answered with a status the caller should show rather than swallow. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // Only a body needs the header, and `exactOptionalPropertyTypes` will not
    // accept an explicit `undefined` for it — so it is spread in or left out.
    ...(init?.body === undefined ? {} : { headers: { 'content-type': 'application/json' } }),
  })
  const text = await response.text()
  let payload: unknown
  try {
    payload = text === '' ? undefined : JSON.parse(text)
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    const body = payload as { error?: string; code?: string } | undefined
    throw new ApiError(response.status, body?.error ?? ('HTTP ' + response.status), body?.code)
  }
  return payload as T
}

export const api = {
  catalog: (): Promise<Catalog> => request('/studio/catalog'),

  state: (project: string, cut?: string): Promise<StudioState> =>
    request('/studio/state?project=' + encodeURIComponent(project)
      + (cut === undefined || cut === '' ? '' : '&cut=' + encodeURIComponent(cut))),

  cuts: (project: string): Promise<{ cuts: Cut[] }> =>
    request('/studio/cuts?project=' + encodeURIComponent(project)),

  saveCut: (project: string, cut: Partial<Cut> & { id: string }): Promise<{ cut: Cut }> =>
    request('/studio/cuts', { method: 'POST', body: JSON.stringify({ project, cut }) }),

  deleteCut: (project: string, cut: string): Promise<{ deleted: string }> =>
    request('/studio/cuts/delete', { method: 'POST', body: JSON.stringify({ project, cut }) }),

  library: (project?: string): Promise<{ projects: LibraryProject[] }> =>
    request('/studio/library' + (project === undefined ? '' : '?project=' + encodeURIComponent(project))),

  updateProject: (body: {
    project: string
    title?: string
    target_duration_seconds?: number
    style?: string
    target_platform?: string
    voice?: string
    voice_design_name?: string
    voice_design_prompt?: string
    lora_name?: string
    lora_strength?: number
    references?: string[]
    voice_references?: string[]
  }): Promise<{ project: ProjectMarker }> =>
    request('/studio/project', { method: 'POST', body: JSON.stringify(body) }),

  /**
   * Save one section's shots into the scene_plan artifact.
   *
   * Only the fields this screen knows about are sent. The host merges by
   * position and keeps the rest, so a save from here never strips shot
   * language a later screen put there.
   */
  saveScenePlan: (
    project: string,
    section: string,
    shots: ReadonlyArray<{ prompt?: string; weight?: number }>,
  ): Promise<{ scene_plan: unknown }> =>
    request('/studio/scene-plan', { method: 'POST', body: JSON.stringify({ project, section, shots }) }),

  trash: (): Promise<{ entries: TrashEntry[] }> => request('/studio/trash'),

  restoreTrash: (entry: string): Promise<{ id: string }> =>
    request('/studio/trash/restore', { method: 'POST', body: JSON.stringify({ entry }) }),

  purgeTrash: (entry: string): Promise<{ entry: string }> =>
    request('/studio/trash/purge', { method: 'POST', body: JSON.stringify({ entry }) }),

  removeProject: (project: string): Promise<{ removed: string; trashed_to: string }> =>
    request('/studio/project/remove', { method: 'POST', body: JSON.stringify({ project }) }),

  validate: (artifact: string, value: unknown): Promise<{
    valid: boolean
    issues: Array<{ path: string; message: string }>
    text: string
  }> => request('/studio/validate', { method: 'POST', body: JSON.stringify({ artifact, value }) }),

  submitStage: (body: {
    project: string
    stage: string
    status: string
    artifacts?: Record<string, unknown>
    human_approved?: boolean
    note?: string
  }): Promise<{ next_stage: string | null; invalidated: string[]; notices: string[] }> =>
    request('/studio/stage', { method: 'POST', body: JSON.stringify(body) }),
}

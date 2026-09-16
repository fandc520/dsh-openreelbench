/**
 * The settings card as data.
 *
 * Every control the card renders is one entry in {@link FIELD_GROUPS}, so
 * adding a knob is adding a row here rather than writing another block of JSX.
 * That matters beyond tidiness: the host schema and this table are the two
 * halves of the same contract, and a table is something you can read next to
 * `config.ts` and see what is missing.
 *
 * Writes are grouped by the FIRST path segment because the scope's `set` takes
 * a top-level field of the section — editing `video.crf` means writing the
 * whole `video` object back with that one key replaced.
 */
import { BUILT_IN_PLAYBOOKS } from '../playbooks.ts'
import { LANGUAGE_OPTIONS, tx } from './i18n.ts'

export type FieldPath = readonly [string, ...string[]]

export interface FieldSpec {
  path: FieldPath
  label: string
  hint?: string
  placeholder?: string
  kind: 'text' | 'number' | 'boolean' | 'select' | 'list'
  /**
   * A number field that takes fractions.
   *
   * Every other number here is a count — frames, seconds, a CRF step — so
   * `numeric` is the right keypad for them, and it is the WRONG one for a
   * 0.1–2 multiplier: that keypad has no decimal separator on it.
   */
  decimal?: boolean

  /** Rendered from live settings, so custom playbooks appear in the picker. */
  options?: (value: Record<string, unknown> | undefined) => Array<{ value: string; label: string }>
  /** Lay this field beside the next ones in a row. */
  row?: string
}

export interface FieldGroup {
  title: string
  /** One line saying what this group governs, so a reader can skip it. */
  blurb?: string
  fields: FieldSpec[]
}

function styleOptions(value: Record<string, unknown> | undefined): Array<{ value: string; label: string }> {
  const custom = (value?.playbooks ?? {}) as Record<string, { name?: string }>
  const entries = new Map<string, string>()
  // `BUILT_IN_PLAYBOOKS` is a constant table, so its names are translated
  // here — where the option is built for display — rather than in the table.
  for (const [id, playbook] of Object.entries(BUILT_IN_PLAYBOOKS)) {
    entries.set(id, tx(playbook.name) + '（' + id + '）')
  }
  for (const [id, playbook] of Object.entries(custom)) {
    entries.set(id, (playbook?.name ?? id) + '（' + id + tx('，自定义）'))
  }
  return [...entries].map(([value_, label]) => ({ value: value_, label }))
}

/**
 * The two panel languages.
 *
 * Native names, never translated: someone who cannot read the current language
 * has to be able to find their own in this list, and "Chinese" is no help to a
 * reader who only reads Chinese.
 */
function languageOptions(): Array<{ value: string; label: string }> {
  return LANGUAGE_OPTIONS.map((entry) => ({ value: entry.id, label: entry.label }))
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    title: '语言',
    fields: [
      {
        path: ['language'],
        label: '界面语言',
        hint: '同时决定新项目的脚本与配音语种，可在配音页按项目改。不影响导演指令本身。',
        kind: 'select',
        options: languageOptions,
      },
    ],
  },
  {
    title: '工作区',
    fields: [
      {
        path: ['workspaceRoot'],
        label: '项目根目录',
        hint: '项目存储目录。留空则在 $DSH_HOME/data/dsh-openreelbench/projects，默认 C 盘。',
        placeholder: 'D:/AiStudio',
        kind: 'text',
      },
    ],
  },
  {
    title: 'ComfyUI 工作流绑定',
    // Names, not ids: an id changes every time the canvas is re-extracted.
    // Parameters are the workflow list's business — restating them here would
    // be a second copy that drifts.
    blurb: '指定各环节调用的工作流，可多选；第一条是默认。标题是用到它的页面，括号里是做什么。',
    fields: [
      {
        path: ['bindings', 'tts', 'workflows'],
        label: '配音（TTS）',
        placeholder: 'Qwen3-TTS(Text)',
        kind: 'list',
      },
      {
        path: ['bindings', 'image', 'workflows'],
        label: '分镜（文生图）',
        placeholder: 'Krea-T2I-Afterlight',
        kind: 'list',
      },
      {
        path: ['bindings', 'music', 'workflows'],
        label: '合成（文生音乐）',
        placeholder: 'Music-Gen',
        kind: 'list',
      },
      {
        path: ['bindings', 'voice_query', 'workflows'],
        label: '配音（音色试听）',
        placeholder: 'Voice-Query',
        kind: 'list',
      },
      {
        path: ['bindings', 'voice_design', 'workflows'],
        label: '配音（音色设计）',
        placeholder: 'Qwen3-VoiceDesign',
        kind: 'list',
      },
    ],
  },
  {
    title: '创作默认值',
    fields: [
      {
        path: ['defaultStyle'],
        label: '默认风格',
        hint: '决定提示词模板、旁白语气、语速与单段时长。',
        kind: 'select',
        options: styleOptions,
      },
      {
        path: ['defaultDurationSeconds'],
        label: '默认时长（秒）',
        hint: '用户没说时长时按它估算脚本字数。',
        kind: 'number',
      },
    ],
  },
  {
    title: '成片输出',
    blurb: '画幅由立项页的投放平台决定，这里只调倍率。',
    fields: [
      // A width and a height used to live here. They were a second answer to a
      // question the platform had already answered, and only one of the two
      // ever reached the picture generator — so a 竖屏 project got 16:9 stills.
      // A multiplier cannot contradict the aspect ratio; it can only make the
      // same frame cheaper.
      {
        path: ['video', 'renderScale'],
        label: '生成系数',
        hint: '0.1–2，可填小数。乘在投放平台的画幅基线上：0.5 → 16:9 出 960×540。分镜图与成片同尺寸。',
        kind: 'number',
        decimal: true,
        row: 'size',
      },
      { path: ['video', 'fps'], label: '帧率', kind: 'number', row: 'size' },
      {
        path: ['video', 'crf'],
        label: '画质 CRF',
        hint: '越小越清晰、文件越大，18–23 常用。',
        kind: 'number',
        row: 'enc',
      },
      {
        path: ['video', 'preset'],
        label: '编码速度',
        hint: 'ultrafast / veryfast / medium / slow。',
        kind: 'text',
        row: 'enc',
      },
      {
        path: ['writeSubtitles'],
        label: '输出 .srt 字幕',
        // Burn-in is NOT here. It is per export, not per install: the same cut
        // goes to a platform that plays a sidecar .srt and to one that does
        // not, and the compose screen asks every time.
        hint: '时间轴按实测配音长度排。烧进画面在合成页逐次决定。',
        kind: 'boolean',
      },
    ],
  },
  {
    title: '本机环境',
    blurb: '装好 FFmpeg 就不用动。',
    fields: [
      { path: ['ffmpegPath'], label: 'ffmpeg 路径', placeholder: 'ffmpeg', kind: 'text', row: 'bin' },
      { path: ['ffprobePath'], label: 'ffprobe 路径', placeholder: 'ffprobe', kind: 'text', row: 'bin' },
      {
        path: ['renderTimeoutMs'],
        label: '合成超时（毫秒）',
        hint: '单次合成上限，默认 900000（15 分钟）。',
        kind: 'number',
      },
    ],
  },
]

/** Stable identity for a field, used as a draft key and a React key. */
export function fieldKey(path: FieldPath): string {
  return path.join('.')
}

export function getPath(root: unknown, path: readonly string[]): unknown {
  let cursor: unknown = root
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

/** Whether the user layer carries this path at all — presence, not equality. */
export function isOverridden(user: unknown, path: readonly string[]): boolean {
  let cursor: unknown = user
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return false
    if (!Object.prototype.hasOwnProperty.call(cursor, key)) return false
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return true
}

/** Immutably replace one nested value in a container, materialising gaps. */
export function withPath(container: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path as [string, ...string[]]
  const source = typeof container === 'object' && container !== null ? (container as Record<string, unknown>) : {}
  return { ...source, [head]: withPath(source[head], rest, value) }
}

/**
 * Fold staged edits into one write per top-level field.
 *
 * `scope.set` addresses a top-level field of the section, so two edits under
 * `video` have to arrive as a single `video` object. Writing them as two calls
 * would make the second overwrite the first with a value built from the stale
 * pre-edit section.
 */
export function buildWrites(
  section: Record<string, unknown> | undefined,
  edits: ReadonlyMap<string, { path: FieldPath; value: unknown }>,
): Array<[string, unknown]> {
  const pending = new Map<string, unknown>()
  for (const { path, value } of edits.values()) {
    const [head, ...rest] = path
    const current = pending.has(head) ? pending.get(head) : section?.[head]
    pending.set(head, rest.length === 0 ? value : withPath(current, rest, value))
  }
  return [...pending]
}

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

export type FieldPath = readonly [string, ...string[]]

export interface FieldSpec {
  path: FieldPath
  label: string
  hint?: string
  placeholder?: string
  kind: 'text' | 'number' | 'boolean' | 'select' | 'list'
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
  for (const [id, playbook] of Object.entries(BUILT_IN_PLAYBOOKS)) {
    entries.set(id, playbook.name + '（' + id + '）')
  }
  for (const [id, playbook] of Object.entries(custom)) {
    entries.set(id, (playbook?.name ?? id) + '（' + id + '，自定义）')
  }
  return [...entries].map(([value_, label]) => ({ value: value_, label }))
}

export const FIELD_GROUPS: FieldGroup[] = [
  {
    title: '工作区',
    blurb: '成片和素材落在哪里。',
    fields: [
      {
        path: ['workspaceRoot'],
        label: '项目根目录',
        hint: '成片、素材、状态都落在这里。留空则用 $DSH_HOME/data/dsh-creative-studio/projects（在 C 盘）。',
        placeholder: 'D:/AiStudio',
        kind: 'text',
      },
    ],
  },
  {
    title: 'ComfyUI 工作流绑定',
    blurb: '每项能力用 dsh-comfyui 工作流库里的哪一条。只填名称——参数由那份清单说了算，'
      + '在这里再写一遍必然漂移。用名称不用 id：id 每次重新提取画布都会变。',
    fields: [
      {
        path: ['bindings', 'tts', 'workflows'],
        label: '配音（TTS）',
        hint: '逐段生成旁白。第一条是默认，必填，否则配音页无法生成；其余作为候选出现在工作台的下拉菜单里。',
        placeholder: 'Qwen3-TTS(Text)',
        kind: 'list',
      },
      {
        path: ['bindings', 'image', 'workflows'],
        label: '配图（文生图）',
        hint: '逐段生成画面。第一条是默认，其余作为候选出现在工作台的下拉菜单里。',
        placeholder: 'Krea-T2I-Afterlight',
        kind: 'list',
      },
      {
        path: ['bindings', 'music', 'workflows'],
        label: '配乐（文生音乐）',
        hint: '整片音乐床交给 Agent 选曲并用这条工作流生成。可选——不绑定时，合成页配乐栏仍会显示项目里手填过的名称。'
          + '第一条是默认，其余作为候选出现在合成页的下拉菜单里。',
        placeholder: 'Music-Gen',
        kind: 'list',
      },
      {
        path: ['bindings', 'voice_query', 'workflows'],
        label: '音色查询',
        hint: '输出所选音色的参考音频，供配音页试听。不绑定时「试听」按钮是灰的。'
          + '最小形态：🎭 Character Voices 的 reference_audio_only 接一个 SaveAudio。'
          + '第一条是默认，其余作为候选出现在工作台的下拉菜单里。',
        placeholder: 'Voice-Query',
        kind: 'list',
      },
      {
        path: ['bindings', 'voice_design', 'workflows'],
        label: '音色设计',
        hint: '造一个新音色。可选——造音色是准备工作，不在管线里。第一条是默认，其余作为候选出现在工作台的下拉菜单里。',
        placeholder: 'Qwen3-VoiceDesign',
        kind: 'list',
      },
    ],
  },
  {
    title: '创作默认值',
    blurb: '新项目从这里起步，之后可以在项目详情页单独改。',
    fields: [
      {
        path: ['defaultStyle'],
        label: '默认风格',
        hint: '决定画面提示词模板、旁白语气、语速估算和单段时长上下限。',
        kind: 'select',
        options: styleOptions,
      },
      {
        path: ['defaultDurationSeconds'],
        label: '默认时长（秒）',
        hint: '用户没说要多长时，按这个值估算脚本字数。',
        kind: 'number',
      },
    ],
  },
  {
    title: '成片输出',
    blurb: '合成的画面规格与字幕。画面观感和节奏归风格库管，不在这里。',
    fields: [
      { path: ['video', 'width'], label: '宽', kind: 'number', row: 'size' },
      { path: ['video', 'height'], label: '高', kind: 'number', row: 'size' },
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
        hint: '字幕时间轴按 ffprobe 实测的配音长度排，不按脚本预估。',
        kind: 'boolean',
      },
      {
        path: ['burnSubtitles'],
        label: '把字幕烧进画面',
        hint: '需要重新编码，且依赖系统中文字体；失败时改回旁挂 .srt。',
        kind: 'boolean',
      },
    ],
  },
  {
    title: '本机环境',
    blurb: '这台机器上的可执行文件与耐心上限。装好 FFmpeg 就不用动。',
    fields: [
      { path: ['ffmpegPath'], label: 'ffmpeg 路径', placeholder: 'ffmpeg', kind: 'text', row: 'bin' },
      { path: ['ffprobePath'], label: 'ffprobe 路径', placeholder: 'ffprobe', kind: 'text', row: 'bin' },
      {
        path: ['renderTimeoutMs'],
        label: '合成超时（毫秒）',
        hint: '单次 studio_compose 的上限，默认 900000（15 分钟）。',
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

/**
 * The usage skill: tool contracts and failure handling, as opposed to the
 * creative guidance in skill.ts.
 *
 * The split matters. `-explainer` answers "how do I make the film"; this one
 * answers "how do these tools actually behave when I call them". They have
 * different trigger conditions — one loads when the work starts, the other
 * when something is confusing or has just gone wrong — and mixing them makes
 * both longer than the moment needs.
 *
 * Everything here is written for the *calling* agent, so it only contains
 * behaviour the caller can act on. Plugin-authoring constraints (the harness
 * deep-freezes tool arguments, so a plugin must never write through them) are
 * real and important, but they belong in the development docs: an agent
 * sending JSON has no way to act on them. The caller-facing consequence of
 * that same rule — what you send is not necessarily what gets stored — is
 * here instead.
 */

export interface RuntimeSkill {
  name: string
  source: string
  description: string
  whenToUse: string
  content: string
}

const CONTENT = `# dsh-creative-studio 工具契约

管线怎么走看 \`dsh-creative-studio-explainer\`。这份讲**工具本身怎么表现**——
它会不会改你的输入、报错了怎么办、重试安不安全、和 ComfyUI 插件怎么分工。

## 三个工具的职责边界

| 工具 | 会改状态吗 | 说明 |
|---|---|---|
| \`studio_project\` | **不会** | 建项目、查状态、读产物、搬文件、看风格和绑定、设音色 |
| \`studio_stage\` | **会，唯一入口** | 写产物 + 推进阶段，所有校验都在这里 |
| \`studio_compose\` | **不会** | 只出片并返回 report，这一趟算不算数由 \`studio_stage\` 记 |

\`studio_compose\` 和 \`studio_stage\` 分成两步是刻意的：渲染只是产生了一个文件，
**报告要经 \`studio_stage\` 核对输出文件真实存在之后才算数**。
所以 compose 成功不等于 compose 阶段完成，你必须再写一次 stage。

## 你提交的不等于落盘的

工具会**规范化**你的输入，落盘的是规范化之后的版本：

- \`asset_manifest\` 里每条音视频的 \`duration_seconds\`，一律被 ffprobe 实测值覆盖。
  你填的会被丢弃（差得多时会在 notices 里告诉你）
- 阶段推进后再读，请用 \`studio_project action: "get"\`，**不要假设自己发的那份原样存着**
- \`status\` 是项目状态的唯一真相。你自己记的进度可能已经过期——尤其在被
  \`invalidated\` 作废之后

反过来，工具**不会**替你补全：schema 不认识的字段直接报错而不是忽略，
所以 \`SCHEMA INVALID\` 里出现"未识别字段"基本就是你拼错了字段名。

## 错误码与处置

| 报错 | 含义 | 怎么办 |
|---|---|---|
| \`GATE VIOLATION\` | 没经用户批准就想 completed | 改写 \`awaiting_human\`，讲给用户听，**结束这一轮** |
| \`PREREQUISITE VIOLATION\` | 前面的段没做完或没批准 | 回去补前面那段，别改这一段的写法 |
| \`SCHEMA INVALID\` | 产物字段不对 | 报错里带字段路径，逐条改。未识别字段=拼错 |
| \`ASSET MISSING\` | manifest/report 里的文件不存在 | 用 \`studio_project action: "import"\` 搬进项目再写 |
| \`COVERAGE INCOMPLETE\` | 有段落缺配音或配图，或 scene_id 对不上脚本 | 补齐那几段；检查 scene_id 拼写 |
| \`NO PROJECT\` | 项目不存在 | 先 \`action: "init"\` |
| \`BAD REQUEST\` | 参数用法不对 | 照报错改参数，不是改数据 |

**这些都是硬失败，不是建议。** 反复重试同一份数据不会通过。
换个说法、绕个字段、把路径改成别的写法——都不行，因为校验查的是磁盘上的事实。

## 重试与幂等

- **同一阶段可以反复写。** 旧 checkpoint 会归档到 \`checkpoints/history/\`，不会丢
- **重写早期阶段会作废后续阶段。** 改了 script，assets 和 compose 的 checkpoint
  会被删除，返回值里的 \`invalidated\` 列出来了——那几段必须重做
- 连续写 \`in_progress\` 不算版本，不会堆历史
- **同一个项目的写入是串行的**，你并发调也会排队，不会写坏
- \`studio_compose\` 可以重复跑，每次覆盖同一个输出文件；跑之前会清空 \`work/\` 临时目录

## 路径规则

- manifest 和 report 里的路径**必须是项目相对路径**（\`assets/audio/s1.flac\`）
- 绝对路径、含 \`..\` 的路径，在 schema 层就被拒
- 想把外部文件弄进来只有一条路：\`studio_project action: "import"\`。
  它接受**绝对本地路径**或 **http(s) URL**（比如 ComfyUI 的 \`/view?filename=...\`），
  返回的就是可以直接写进 manifest 的相对路径
- \`checkpoints/\` 和 \`artifacts/\` 是状态机私有存储，**不要用文件工具直接读写**

## 和 dsh-comfyui 的分工

studio **不连 ComfyUI**，一次网络请求都不发（除了 \`import\` 拉文件）。

- studio 的配置里只有工作流**名称**，没有参数
- 参数一律去 \`comfyui_workflow action: list\` 查，那份清单是权威且实时的
- 绑定的工作流在清单里找不到（用户改名或删了）→ **告诉用户，不要顺手换一条跑**
- 生成失败是 ComfyUI 那边的事，按 \`comfyui_workflow\` 自己的报错处理，
  和 studio 的状态机无关——素材没生成出来，就先别写 \`assets\` 阶段

## 耗时与中断

- \`studio_compose\` 是长任务（分钟级），支持中断
- ComfyUI 首次加载模型很慢（实测 t2i 首张 140 秒，后续 25 秒），
  **这是正常的**，不要以为卡死了就重试——重试只会再排一个队
- 素材分两批生成（先全部音频再全部图像）就是为了让模型只加载一次

## 项目文件在哪

\`studio_project action: "init"\` 和 \`"status"\` 的输出里有绝对路径。
用户要看成品，指给他 \`output/\` 目录；成品和 \`.srt\` 字幕同名同目录。
`

export const STUDIO_USAGE_SKILL: RuntimeSkill = {
  name: 'dsh-creative-studio-usage',
  source: 'runtime',
  description:
    'dsh-creative-studio 三个工具的调用契约：谁能推进状态、输入会被怎样规范化、'
    + '七个错误码分别怎么处置、重试与幂等语义、路径规则、与 dsh-comfyui 的分工、耗时预期。'
    + '调 studio_* 工具遇到报错，或不确定某个工具会不会改状态时加载。',
  whenToUse:
    '看到 GATE VIOLATION / PREREQUISITE VIOLATION / SCHEMA INVALID / ASSET MISSING / '
    + 'COVERAGE INCOMPLETE 等 studio 报错时；不确定 studio 工具的副作用、重试是否安全、'
    + '路径该怎么写、或它和 dsh-comfyui 如何分工时。',
  content: CONTENT,
}

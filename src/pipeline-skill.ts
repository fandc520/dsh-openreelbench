/**
 * The pipeline skill — one per pipeline, rendered from the pipeline's own data.
 *
 * It answers three questions and no others: what this pipeline makes, what the
 * rules are, and what the nodes are. The operating detail for any one node
 * lives in that node's stage skill; the craft behind a node lives in a craft
 * skill. This document's job is to be the map, and a map that also contained
 * the terrain would be the 488-line skill this replaced.
 *
 * RENDERED, NOT WRITTEN. The stage table, the state diagram and the review
 * focus all come out of `PIPELINES`, so adding a pipeline produces its skill
 * with no second place to update. That is the same bet `pipelines.ts` already
 * makes about screens — a pipeline is configuration, not code — extended to
 * the prose the model reads.
 *
 * THREE LAYERS, THREE LIFETIMES, and that is why they are not one document:
 *
 *   - this file      per pipeline      the map
 *   - stage-skills   per stage         how to do one node, reused across
 *                                      pipelines that share the stage
 *   - craft skills   cross-pipeline    storytelling, cinematography, sound
 *                                      design, review — a short-form pipeline
 *                                      wants the same storytelling
 *
 * Folding the craft skills in per pipeline would make N copies of one document
 * and N places to fix a sentence. That failure already happened once at a
 * smaller scale: four closing conventions copied between three job builders
 * drifted, and one of them lost the name of the tool it was telling the model
 * to call.
 */
import { type CapabilityBinding, type Config, bindingWorkflows } from './config.js'
import { renderVisualContract, resolvePlaybook } from './playbooks.js'
import { type Pipeline, PIPELINES } from './pipelines.js'
import { GATED_STAGES } from './state.js'
import type { RuntimeSkill } from './skill.js'
import { stageSkillName } from './stage-skills.js'

/** Which craft skill a stage should be read alongside. Absent means none applies. */
const STAGE_CRAFT: Record<string, string> = {
  script: 'dsh-creative-studio-storytelling',
  assets_shots: 'dsh-creative-studio-cinematography',
  compose: 'dsh-creative-studio-sound-design',
}

/** Stage id to the stage-skill key. The two differ only in separator. */
function stageKey(id: string): string {
  return id.replace(/_/g, '-')
}

function renderBinding(label: string, binding: CapabilityBinding): string {
  const all = bindingWorkflows(binding)
  if (all.length === 0) {
    return '- **' + label + '**：未绑定。用 `comfyui_workflow` 的 `action: list` 列出工作流库，'
      + '挑一个合适的告诉用户，请他填进设置页的「ComfyUI 工作流绑定」，'
      + '再继续。**不要自己挑一个就跑。**'
  }
  const note = binding.notes.trim() === '' ? '' : '　—　' + binding.notes.trim()
  // Alternatives are listed so the model can honour a request to switch, but
  // the default is named as the default so it does not start deliberating.
  const rest = all.slice(1)
  const others = rest.length === 0 ? '' : '（备选：' + rest.map((n) => '`' + n + '`').join('、') + '）'
  return '- **' + label + '**：`' + all[0] + '`' + others + note
}

/** `brief ──[闸]──> script ──[闸]──> …`, from the stages themselves. */
function renderFlow(pipeline: Pipeline): string {
  return pipeline.stages
    .map((stage, index) => {
      if (index === 0) return stage.id
      const gate = GATED_STAGES.has(pipeline.stages[index - 1]!.id) ? ' ──[闸]──> ' : ' ────────> '
      return gate + stage.id
    })
    .join('')
}

/**
 * The node map: one row per stage, and for each one, where to read further.
 *
 * The two right-hand columns are the whole point of the split — a stage row
 * that did not say where its detail lives would be a table of contents with no
 * page numbers.
 */
function renderNodes(pipeline: Pipeline): string {
  const rows = pipeline.stages.map((stage, index) => {
    const craft = STAGE_CRAFT[stage.id]
    return '| ' + (index + 1)
      + ' | `' + stage.id + '`'
      + ' | ' + stage.label
      + ' | ' + (stage.gated ? '**是**' : '否')
      + ' | ' + stage.hint
      + ' | `/' + stageSkillName(stageKey(stage.id)) + '`'
      + ' | ' + (craft === undefined ? '—' : '`/' + craft + '`')
      + ' |'
  })
  return [
    '| # | 阶段 | 界面 | 闸 | 这一步定什么 | 操作细则 | 创作技能 |',
    '|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

/** What the reviewer looks at, per stage — judgement only, never countable. */
function renderReview(pipeline: Pipeline): string {
  return pipeline.stages
    .map((stage) => '**' + stage.label + '（`' + stage.id + '`）**\n'
      + stage.review_focus.map((item) => '- ' + item).join('\n'))
    .join('\n\n')
}

export function buildPipelineSkill(pipeline: Pipeline, config: Config): RuntimeSkill {
  const { playbook } = resolvePlaybook(config.defaultStyle, config.playbooks)
  const gates = pipeline.stages.filter((stage) => stage.gated).length

  const content = `# AI 创意工作室：${pipeline.name}

${pipeline.description}

**适合**：${pipeline.best_for}

${pipeline.stages.length} 段状态机，顺序固定，**一步都不能跳**：

\`\`\`
${renderFlow(pipeline)}
\`\`\`

${gates} 个闸都在花掉时间之前：前面的挡住「脚本没定就去跑生成」，后面的让各批素材各自过一次目，不满意只重做那一批。

## 节点图

**这份技能是地图，不是地形。** 每一步真正怎么做，读它那一行的「操作细则」——
用带斜杠的手势加载，用完就不占上下文。

${renderNodes(pipeline)}

「创作技能」那一列是**跨管线共用的手艺**，不属于这条管线。别的管线走到同类节点读的是同一份。

## 红线

**推进状态只能调 \`studio_stage\`。** 它会做 schema 校验、审批闸校验、前置校验、资产存在性校验，
任何一条不过就抛错，没有"提示一下但还是写进去"。看到 \`PREREQUISITE VIOLATION\` /
\`GATE VIOLATION\` / \`ASSET MISSING\` / \`COVERAGE INCOMPLETE\` 不要绕过去，
那说明你确实漏了一步——回去补。工具行为和错误处置细节见
\`dsh-creative-studio-usage\` 技能。

**审批闸协议**（上表里标「是」的那几段）：

1. 写 \`status: "awaiting_human"\`，带上完整产物
2. 用自然语言把产物要点讲给用户听（不要贴 JSON）
3. **结束你这一轮**，等用户真的回话
4. 用户认可后，再写一次 \`status: "completed"\` + \`human_approved: true\`

直接写 \`completed\` 会被 \`GATE VIOLATION\` 挡回来。用户没说"可以/继续/就这样"之前，
\`human_approved\` 永远是 false。

**重写早期阶段会作废后续阶段。** 用户在素材做完之后改脚本，后面几段的
checkpoint 会被归档删除，必须重做。这是对的——素材是照旧脚本生成的。

## 开工前：先读风格

**动笔之前调 \`studio_project action: "style"\`。** 它返回本项目的风格 playbook：
图像提示词的前后缀、负向提示词、一致性锚点、旁白语气、语速估算、单段时长上下限、质量红线。

风格不是装饰。实测过一次：三段用了同一个模型同一套 seed，只因为提示词措辞不同
（一段写了 cinematic，一段写了 flat/minimal），出来的画风完全不是一路。
**风格靠统一的提示词模板和负向提示词解决，不靠 seed。**

用户没指定风格时用配置的默认值；他要换，\`studio_project action: "style"\` 会列出所有可选风格。

## 每一段过闸时看什么

**只列代码看不到的。** schema 形状、文件存在、覆盖完整、阶段顺序，状态机已经拦了；
在这里重复它们，只会让审查把注意力花在重新推导已经拿到的事实上。剩下的是判断。

${renderReview(pipeline)}

## ComfyUI 绑定表

本插件**不直接连 ComfyUI**。生成一律由你调 \`dsh-comfyui\` 的 \`comfyui_workflow\` 完成。

绑定表**只告诉你用哪条工作流**，不复述它的参数：

${renderBinding('配音（TTS）', config.bindings.tts)}
${renderBinding('配图（txt2img）', config.bindings.image)}

**怎么调这条工作流，去 \`comfyui_workflow action: list\` 里看。** 那份清单是权威——
每个参数的英文 \`name\`、中文 \`label\`、默认值、\`options\` 下拉选项、\`numberKind\` 数字类型、
\`upload\` 加载类型都在里面，而且随用户在面板里的改动实时变。绑定表不重复这些信息，
就是为了避免两份会互相漂移的参数知识。

具体地：

- 正文参数叫什么，看清单里哪个参数承载文本（不同工作流可能是 \`prompt\`、\`text\` 或别的）
- 音色参数的可选值，看那个参数的 \`options\`
- 尺寸、步数、seed 不传就用工作流自己的默认值，没有把握就别覆盖
- 带 \`options\` 的参数传值必须落在选项内，否则会报错
- 清单里找不到绑定的那条工作流（用户改了名或删了）→ **告诉用户，不要顺手换一条跑**

## 当前风格的图像契约

${renderVisualContract(playbook)}

**这是默认风格「${playbook.name}」的。项目实际用哪套以 \`studio_project action: "style"\` 为准。**

## 不要做的事

- 不要用文件工具直接改 \`checkpoints/\` 或 \`artifacts/\` 下的文件，那是状态机的私有存储
- 不要在用户没确认时替他确认
- 不要为了绕过校验去编造路径或时长
- 不要在 \`visual.prompt\` 里重写风格词，风格由 playbook 统一加
`

  return {
    name: 'dsh-creative-studio-' + pipeline.id,
    source: 'runtime',
    description:
      'AI 创意工作室的' + pipeline.name + '管线：'
      + pipeline.stages.map((stage) => stage.id).join(' → ') + ' '
      + pipeline.stages.length + ' 段状态机，' + gates + ' 个人工审批闸，'
      + '风格 playbook 统一画风，生成走 ComfyUI 工作流、合成走 FFmpeg。'
      + '每段的操作细则是单独的技能，这份是节点图和规矩。'
      + '处理 studio_project / studio_stage / studio_compose，或用户要做' + pipeline.best_for + '时加载。',
    whenToUse:
      '用户要做' + pipeline.name + '（' + pipeline.best_for + '），'
      + '或要求推进已有的 studio 项目时。先读这份拿到全局，再按节点图加载那一段的操作细则。',
    content,
  }
}

/** Every pipeline's skill. One entry today, and no work per pipeline after. */
export function buildPipelineSkills(config: Config): RuntimeSkill[] {
  return Object.values(PIPELINES).map((pipeline) => buildPipelineSkill(pipeline, config))
}

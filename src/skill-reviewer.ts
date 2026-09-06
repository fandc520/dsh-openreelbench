/**
 * The reviewer — the fourth class of check, and the only one that is judgement.
 *
 * Three classes are already enforced in code and cannot be argued with: schema
 * shape, whether an asset exists on disk, and pipeline order plus its gates. A
 * fourth, quality, is enforced arithmetically where it can be (the variation
 * report and the slideshow score). What is left over is the part no counting
 * function reaches — whether a hook actually stops someone, whether a picture
 * matches the sentence beneath it — and that part is what this skill is for.
 *
 * It is INSTRUCTIONS, not code, on purpose. OpenMontage made the same call and
 * said why in its own file: this "replaces the Python reviewer class with an
 * instruction-driven self-review protocol". A function can count colours; it
 * cannot tell you the third section is boring.
 *
 * The one thing worth stealing wholesale is the CHAI rule set, which is not a
 * style preference — OM cites a study finding that critique quality along those
 * three axes governs downstream output quality. The rule that does the work is
 * the third: a critical finding without a proposed fix is downgraded, which is
 * what stops a review from becoming a list of complaints.
 */
import type { RuntimeSkill } from './skill.js'
import { PIPELINES } from './pipelines.js'

/** Per-stage focus, rendered from the pipeline so the two cannot drift. */
function focusTable(): string {
  const lines: string[] = []
  for (const stage of PIPELINES['explainer-stills']!.stages) {
    lines.push('')
    lines.push('#### ' + stage.label + '（`' + stage.id + '`）')
    lines.push('')
    for (const item of stage.review_focus) lines.push('- ' + item)
  }
  return lines.join('\n')
}

const CONTENT = `# 自审协议

每一段写完、**提交 \`studio_stage\` 之前**，先自审一遍。
这是「做完了」和「可以交」之间的那道关。

## 你不用查的东西

插件已经用代码挡住了四类问题，**再查一遍是浪费注意力**：

| 已经强制 | 谁在管 |
|---|---|
| 产物结构、字段名、枚举值 | schema 校验，不合就抛 \`SCHEMA INVALID\` |
| 资产文件是否真的存在 | \`studio_stage\` 逐条核对路径 |
| 每一段是否都有素材 | 覆盖检查，缺一个抛 \`COVERAGE_INCOMPLETE\` |
| 管线顺序、审批闸 | 状态机，跳段抛 \`PREREQUISITE VIOLATION\` |
| 分镜重复度、幻灯片风险 | \`variation\` 报告 + 出片前的风险闸 |

**你要查的是这些之外的东西** —— 全部是判断题，一条都不是数出来的。

## 三条规矩（CHAI）

发现问题不等于评审。**评审要告诉下一步怎么改。**

### 准确

每一条都要**指得出在哪**：哪个字段、哪一段、哪一张图。
指不出位置就是在猜，不要写。

### 完整

抓到一条就交，比「再看一轮」更糟。
**找到一个问题，先扫一遍同类的**——同样的错还藏在哪儿？

### 可执行

**每一条 critical 都必须带一个具体的改法**，不是只说哪儿不对。

> ✗ 「第三段太长了」
> ✓ 「第三段 180 字要塞进 10 秒，按 4.9 字/秒算需要 37 秒。砍到 49 字，
> 　 或者拆成两段。」

**提不出改法的，降级成 \`investigation\`**，写下来交给下一轮，不要拿它拦路。
这条是整套规矩的关键——没有它，评审就退化成一张抱怨清单。

## 四级严重度

| 级别 | 什么时候用 | 要求 |
|---|---|---|
| \`critical\` | 不改就不能往下走 | **必须带改法**，否则降级 |
| \`suggestion\` | 该改，明显更好，但不挡路 | 要说怎么改 |
| \`nitpick\` | 可改可不改 | 可以只指出 |
| \`investigation\` | 确实有问题，但你说不清怎么改 | 交给下一轮，**不拦** |

**别抬高级别。** 缺字段是 critical，句子啰嗦是 suggestion，标点是 nitpick。
什么都是 critical，等于什么都不是。

## 怎么决定

| 情况 | 做什么 |
|---|---|
| 0 条 critical | **通过** —— 去提交，suggestion 记在 note 里 |
| 有 critical | **返修** —— 改完再审，**最多两轮** |
| 两轮之后仍有 critical | **带问题通过** —— 提交，把没解决的写进 note |

**两轮封顶。** 目标是出片，不是完美。追求完美会把管线卡死。

## 每一段看什么
${focusTable()}

## 风格 playbook 是硬约束

playbook 的 \`quality_rules\` 不是建议。
「同屏主色不超过三种」就是三种，违反了永远要标出来。

## 怎么记

自审结果写进 \`studio_stage\` 的 \`note\`，格式随意但要能读：

\`\`\`
自审：通过（0 critical / 2 suggestion）
- [suggestion] 第 2 段「其实」是口头禅，删掉更利落
- [nitpick] s3 的画面描述可以更具体
\`\`\`

有 critical 就**先改再提交**，不要提交完再说。

## 交给人之前

写 \`awaiting_human\` 时，给用户的那段话里要有：

1. **这一段产出了什么**（一句话）
2. **你自审发现并改掉了什么**（有就说，没有就说没有）
3. **你拿不准、想让他定的是什么**（这条最重要）

第 3 条空着的评审多半没认真做——**总有一两处是你判断不了的**。
`

export const STUDIO_REVIEWER_SKILL: RuntimeSkill = {
  name: 'dsh-creative-studio-reviewer',
  source: 'runtime',
  description:
    'AI 创意工作室的自审协议：提交任何一段之前先按 CHAI 规矩自审（准确 / 完整 / 可执行），'
    + '四级严重度、两轮封顶、每一段各自的审查重点。'
    + '只覆盖代码查不到的判断题——schema、资产存在、覆盖、闸、重复度都已经由插件强制。',
  whenToUse:
    '准备调 studio_stage 提交任何一段之前；'
    + '尤其是写 awaiting_human 把东西交给用户看之前。',
  content: CONTENT,
}

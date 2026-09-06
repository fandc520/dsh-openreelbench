/**
 * The craft skill: choosing shot language for a stills explainer.
 *
 * Everything else in this plugin is machinery — a state machine, a prompt
 * builder, two scorers. None of it decides whether a close-up or a wide shot
 * belongs under a particular sentence, and that decision is most of what
 * separates a film from a narrated slideshow. This is the knowledge for making
 * it, and it is instructions rather than code for the same reason the reviewer
 * is: the question is "what does this sentence need to show", and nothing
 * countable answers that.
 *
 * LOADED DETERMINISTICALLY, NOT BY GUESSWORK. The panel puts `/dsh-creative-
 * studio-cinematography` in the message it sends when the audio gate passes,
 * and the harness injects this body as instructions for that turn. So it does
 * not depend on the model recognising that a catalog line applies, and it is
 * not resident: the catalog carries one line, the body arrives only on the turn
 * that needs it.
 */
import type { RuntimeSkill } from './skill.js'

const CONTENT = `# 镜头语言设计

给一支「一句解说一张图」的片子设计画面。你要产出的是 \`scene_plan\`，
每一镜六个字段——**镜别 / 焦段 / 景深 / 光线 / 色温 / 运动**。

先说清楚这件事为什么值得做：

> 六个字段全空时，五层提示词里有四层是空的，
> 每张图只剩「主体 + 风格」——而风格对每张图都一样。
> **这正是「一堆好看但雷同的图配旁白」的做法。**

## 一、先读旁白，再想画面

逐段问三个问题，顺序不能反：

1. **这一句在说什么？** —— 主体从这里来
2. **这一句在做什么？** —— 它是在开场、在举例、在下结论，还是在转折
3. **观众此刻需要看见什么？** —— 不是「配一张相关的图」，是「这句话缺哪个画面就听不懂」

第 2 问决定镜别。**这是整套设计的支点。**

## 二、旁白的功能 → 镜别

| 这一句在做什么 | 镜别 | 为什么 |
|---|---|---|
| 开场、交代背景、「在某某地方」 | \`establishing\` / \`wide\` | 先让人知道自己在哪 |
| 引入一个对象、一个人、一件事 | \`medium_wide\` / \`medium\` | 看得见对象，也看得见它在哪 |
| 讲一个细节、一个数字、一处关键 | \`close_up\` | 视线收紧＝注意力收紧 |
| 「关键就在这里」「问题出在……」 | \`extreme_close_up\` | 全片最紧的那几下，省着用 |
| 举一个具体例子、一个物件 | \`insert\` | 插入一下就走，不停留 |
| 两方对话、对比、「一边……一边……」 | \`over_shoulder\` | 有视角就有立场 |
| 收束、回到全局、「所以」 | \`wide\` / \`medium_wide\` | 拉开＝松一口气 |

**没想清楚就留空。** 留空会用风格的默认值，比硬塞一个错的强——
\`medium\` 的英文短语是 "medium shot from waist up"，
**给一条机房走廊配这个，等于凭空加了个人。**

## 二·五、把形容词换成造成它的原因

**「电影感」「高级」「有氛围」这些词不约束任何一个像素。**

同一个「moody」，不同的模型、不同的一次渲染，会路由到完全不同的画面——
主观措辞在标注者之间的方差极大，写进提示词等于把决定权交还给随机数。

所以**不要写形容词，写造成那个形容词的具体选择**：

| 你想要的感觉 | 换成这些字段 |
|---|---|
| 压抑、沉重 | \`lighting_key: low_key\` + \`color_temperature: cool\` + \`depth_of_field: shallow\` |
| 亲近、私密 | \`shot_size: medium_close\` + \`lens_mm: 50\` + \`depth_of_field: shallow\` |
| 宏大、开阔 | \`shot_size: extreme_wide\` 或 \`establishing\` + \`lens_mm: 14/24\` + \`depth_of_field: deep\` |
| 紧张、逼近 | \`shot_size: extreme_close_up\` + \`lighting_key: rim_lit\` 或 \`low_key\` |
| 清晰、可信 | \`lighting_key: high_key\` + \`depth_of_field: deep\` + 中性色温 |
| 时间感、怀旧 | \`lighting_key: golden_hour\` 或 \`blue_hour\` + \`color_temperature: warm\` |

> **「cinematic」这个词直接禁用。** 它不是一个画面选择，它是一堆选择的名字。
> 从上面挑，或者直接说你要的镜别、焦段、光线。

主体描述 \`prompt\` 里同理：**写看得见的东西，不写它给人的感觉。**

## 三、序列比单张重要

一镜一镜地挑，最后会得到一串各自合理、连起来平庸的画面。**镜头语言是序列决策。**

三条硬规矩：

1. **不要连着三镜同镜别。** 两镜可以，三镜就停在原地了
2. **相邻两镜要有落差。** 远景接特写有力量，中景接中景没有
3. **全片至少三种镜别。** 只有两种的片子，观众十秒后就不看画面了

一个能用的节奏型（六段片）：

\`\`\`
establishing → medium → close_up → wide → extreme_close_up → medium_wide
   交代           展开      收紧      松    ★高光            收束
\`\`\`

不必照抄，但**「紧—松—紧」的呼吸感要有**。全程一样紧和全程一样松，一样难看。

### 一分钟该有几张画面

跟着风格走，不是越多越好：

| 风格节奏 | 每分钟画面数 |
|---|---|
| 沉静（\`contemplative\`，如温暖纪实） | 3 张以上 |
| 常速 / 讲解（\`conversational\` / \`technical\`，如清晰科技） | 5 张以上 |
| 电影感（\`cinematic\`） | 8 张以上 |
| 快节奏（\`energetic\`，如扁平快讲） | 12 张以上 |

低于本风格的下限，出片前的幻灯片风险闸会扣分。
**要提速就把长段拆成多镜**，不要硬缩短旁白。

## 四、其余五个字段

### 焦段 \`lens_mm\`
跟着镜别走，不用每镜都填：
- \`14\` / \`24\` 广角 —— 空间感、纵深、略有夸张，配 establishing
- \`35\` / \`50\` 标准 —— 接近肉眼，最安全
- \`85\` / \`135\` 长焦 —— 压缩空间、背景虚化，配特写和人物

### 景深 \`depth_of_field\`
- \`shallow\` 只想让人看主体
- \`deep\` 画面里有多个东西都要看清（示意图、结构图必选）

### 光线 \`lighting_key\` —— **情绪转折最省力的手段**
全片只用一种光，等于全片一个情绪。
- 讲问题、讲风险 → \`low_key\` / \`silhouette\`
- 讲方案、讲结果 → \`high_key\` / \`natural\`
- 时间感 → \`golden_hour\` / \`blue_hour\`
- 科技感 → \`neon\` / \`rim_lit\` / \`volumetric\`

**四镜以上至少两种光。**

### 色温 \`color_temperature\`
一般跟着风格默认走。**只在需要对比时才手动指定**——
「过去 vs 现在」「问题 vs 方案」用 \`cool\` / \`warm\` 分开，观众不用听就懂。

### 运动 \`camera_movement\`
**静帧片一般留空。** 画面的动是合成时按风格加的 Ken Burns，不是这里定的。

## 五、高光镜 \`hero_moment\`

**全片标一个，最多两个。** 标的是「这支片子如果只能留一帧，留哪一帧」。

标了之后有个硬要求：**它的前后两镜不能和它同镜别**，否则顶点顶不起来。
通常高光是全片最紧的一镜（\`extreme_close_up\`），前后放远一些。

## 六、质感词 \`texture_keywords\`

一到三个**具体材质**，不是形容词。

> ✗ \`beautiful\`、\`modern\`、\`high quality\`
> ✓ \`wet asphalt\`、\`brushed steel\`、\`molten tin\`、\`worn paper\`

**同样的构图，材质不同就是两张画面。** 覆盖到三成以上。

## 七、主体 \`prompt\` 怎么写

一句英文，**只写看得见的东西**。不写风格、不写光线、不写画幅——那三样分别由第 5 层、
第 4 层和 \`target_platform\` 管，你重复写只会打架。

> ✗ \`abstract concept of AI transforming society, modern, stunning\`
> ✓ \`a hand holding a phone, holographic cards dissolving above the screen\`

**两镜不要写同一句话。** 一条工作流、一句风格，同样的提示词就是同一张图。

## 八、怎么提交

一次写完整份计划，用 \`studio_stage\`：

\`\`\`
stage: "assets_shots"
status: "in_progress"
artifacts: { scene_plan: { version: "1.0", shots: [...] } }
\`\`\`

\`shot_index\` 同一段内必须 0..n-1 不跳号。段 id 用脚本里真实的。

**不要提交 completed** —— 这时候一张图都还没生成。

## 九、返回里会带一份检查

提交后 \`variation\` 会告诉你哪儿重了：镜别单调、连续同镜别、光线单一、
没有高光、空词、缺质感词、主体重复。

**\`verdict\` 是 \`revise\` 或 \`fail\` 就改完再交一次。** 这时候改是免费的，
生成之后再改就要重跑一批图。

## 十、交给用户

写完跟用户说三件事：

1. 你给这支片子定的**节奏**是什么（一句话，比如「远—近—远，高光在第 4 段」）
2. 哪几镜你**拿不准**，想让他看
3. 提醒他可以在分镜页直接改那六个下拉框

**第 2 条不要空着。** 一份每一镜都很确定的设计，多半是没想。
`

export const STUDIO_CINEMATOGRAPHY_SKILL: RuntimeSkill = {
  name: 'dsh-creative-studio-cinematography',
  source: 'runtime',
  description:
    '为图文解说片设计镜头语言：把每段旁白的功能映射成镜别、焦段、景深、光线、色温，'
    + '安排全片的紧松节奏和高光镜，写成 scene_plan。'
    + '六个字段全空时五层提示词有四层是空的，画面必然雷同——这份技能就是填那四层。',
  whenToUse:
    '配音过闸之后、生成分镜之前，要给 scene_plan 设计 shot_language 时；'
    + '或者分镜页的镜头语言大面积空着、variation 报告说镜别单调时。',
  content: CONTENT,
}

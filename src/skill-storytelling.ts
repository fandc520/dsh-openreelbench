/**
 * The craft skill for the script stage: narrative structure.
 *
 * Ported from OpenMontage's `skills/creative/storytelling.md`, whose sources
 * are Derek Muller's PhD work on misconception-first teaching, Kurzgesagt's
 * production rules, 3Blue1Brown's guided-discovery method and Mayer's
 * multimedia learning principles. None of that is inventable on the spot, and
 * without it a script comes out as the brief's key points read aloud in order.
 *
 * `review_focus` for this stage already asks for 起承转合. That was a
 * requirement with no method attached — this is the method.
 *
 * WHAT WAS ADAPTED RATHER THAN COPIED:
 *
 *   - Pacing is given in words per minute for English narration. Ours is
 *     Chinese, measured in characters per second, and it already lives on the
 *     playbook (`narration.chars_per_second`, 4.2–5.6 across the built-ins).
 *     Quoting 150 wpm here would put a second, wrong number next to the one
 *     the timeline actually uses.
 *   - "One new concept per 30–45 seconds" is about concepts, not sections.
 *     Our sections run 2–20 seconds, so a concept spans several of them; said
 *     plainly, or the model splits its thinking as finely as it splits its
 *     paragraphs.
 *   - Two of Mayer's five principles are structural facts here rather than
 *     advice: narration and picture are simultaneous by construction (one
 *     section carries both), and the playbooks already forbid text in the
 *     picture. They are named as guaranteed so the model spends no attention
 *     on them.
 */
import type { RuntimeSkill } from './skill.js'

const CONTENT = `# 解说片的叙事结构

写 \`script\` 用。你要产出的是**分好段的解说词**——每段一句话、一张图。

先说清楚为什么不能只把要点顺一遍：

> 简报里的 key_points 是**并列**的，而片子是**线性**的。
> 把并列的东西按顺序念出来，就是「要点平铺」——每句都对，看完什么都没记住。
> 叙事结构做的事，是把并列关系改造成**因果关系**。

## 一、But-Therefore 法（最该先用的一条）

**段与段之间不许用「然后」，只能用「但是」或「所以」。**

> ✗ 原子有电子，**然后**电子有能级，**然后**能级决定光谱……
> ✓ 原子有电子，**但**它们不像小行星那样绕圈，**所以**需要一个全新的模型……

结构长这样：

\`\`\`
铺垫：  你以为 X 是这样的。
但是：  这个想法哪里不对 / 不完整 / 出人意料。
所以：  得先理解 Y。
但是：  Y 又带出一个新问题……
所以：  真正的答案是 Z。
所以：  这改变了你该怎么看 X。
\`\`\`

**自检方法**：把你的段落连起来读，每两段之间插一个「然后」。
如果读着通顺，说明它们只是并列——改。

## 二、整片的弧线

一支三分钟片子的骨架（按目标时长等比缩放）：

| 位置 | 段落作用 | 要点 |
|---|---|---|
| 开头 4% | **钩子** | 一到两句。反直觉的断言或者认知打断 |
| 到 17% | **张力** | 「大多数人以为……但并不是」。**说清楚为什么值得看** |
| 到 28% | **概念一** | 最简单的那块积木。**一段只讲一件事** |
| 到 42% | **概念二** | 在概念一上加一层，引出皱褶 |
| 45% 附近 | **喘口气** | 一个短段落，让人消化一下 |
| 到 62% | **关键洞察** | 「啊哈」的那一下。**这里之后留一段静默** |
| 到 78% | **证据** | 「你看，当……的时候会发生什么」 |
| 到 92% | **所以呢** | 拉回现实：这意味着什么 |
| 最后 8% | **回扣 + 收束** | 呼应钩子，一句话重述核心 |

### 按时长缩放

| 全片 | 讲几个概念 |
|---|---|
| 1 分钟 | 1–2 |
| 2 分钟 | 2–3 |
| 3 分钟 | 3–5 |
| 5 分钟 | 5–8 |

**一个概念 30–45 秒**，这是认知负荷的上限（Mayer 的分段原则）。

> 注意：**概念 ≠ 段落**。我们一段只有几秒到二十几秒，
> 所以**一个概念通常横跨好几段**。不要把思路切得和段落一样碎。

## 三、四种钩子，挑一种

| 类型 | 写法 | 适合 |
|---|---|---|
| **反直觉** | 「关于 X，你听到的几乎都是错的。」 | 辟谣、认知纠正 |
| **结果** | 「看完这三分钟，你会明白 X 是怎么回事。」 | 概念讲解 |
| **悬念** | 「1987 年，发生了一件不该发生的事……」 | 故事驱动 |
| **代价** | 「就这一个错误，每年让人损失 X。」 | 实用、避坑 |

**钩子必须在前 30 秒内连张力一起讲完。** 观众流失一半就发生在这 30 秒里。

## 四、先讲误解，再纠正

Derek Muller 的博士研究：**先呈现常见误解、再推翻它**的视频，
学习效果显著高于直接讲正确答案的视频。

所以开头优先考虑「大家以为的」，而不是「事实是」。

## 五、引导发现，而不是宣布答案

**别把答案讲出来，把推理的路重走一遍**，让观众觉得是自己想到的：

1. **提问** —— 一个具体的问题
2. **笨办法** —— 显而易见的做法，让它先work一点点，然后崩掉
3. **关键一步** —— 引入**一个**新想法
4. **推演** —— 一步步应用，每一步都显得理所当然
5. **推广** —— 「这个套路不止用在这个例子上……」

## 六、不要写形容词，写造成它的东西

**这条和分镜那边同源**：主观措辞在人和模型之间的方差极大，
写进脚本约束不了任何东西。

| ✗ 别写 | ✓ 写 |
|---|---|
| 震撼的揭示 | 广角拉开，主体逆光成剪影 |
| 令人振奋的时刻 | 低角度对着脸，光打在眼泪的边缘 |
| 有氛围的画面 | 低调布光，阴影提两档，体积雾 |

**解说词本身也一样**：不写「这非常重要」，写重要在哪。

## 七、每一段顺手带一句画面意图

段落的 \`visual.prompt\` 就是这个。**一句英文，只写看得见的东西**——
下一段（分镜）会把它扩成五层提示词，你不用管风格、光线、画幅。

\`\`\`
段落：  「我们从小把电子想象成绕着原子核转的小行星……」
画面：  a stylized atom model, electrons on clean orbital rings
\`\`\`

留空也行，但**留空就等于让模型自己猜这一句该配什么**。

## 八、节奏

| 规矩 | 值 |
|---|---|
| 每段字数 | **按风格的语速算**（\`chars_per_second\`，插件会核对），不要自己定 wpm |
| 换一次画面 | 3–5 秒 |
| 一个新概念 | 30–45 秒 |
| 打断一次节奏 | 45–90 秒（一个短段、一个反问、一句玩笑） |
| 关键洞察之后 | 留 1–3 秒静默——**用一个短段落实现** |

## 九、两件我们的管线已经保证了的事

Mayer 的五条原则里有两条你**不用操心**，插件的结构已经保证：

- **同时性**——解说和画面天然同步，因为一段就是「一句话 + 它的图」
- **通道分离**——画面里不出现文字（风格 playbook 的负向提示词里就写着），
  文字全交给字幕层

剩下三条要你管：**分段**（一段一个意思）、**信号词**（每隔几段给个路标，
「接下来是有意思的地方」）、**去枝蔓**（有趣但无关的内容会**降低** 20–30% 的理解，
不是锦上添花）。

## 十、写完自检

提交前对着这几条过一遍：

1. 段与段之间插「然后」读着通顺吗？通顺就是并列，要改
2. 钩子在前 30 秒内讲完了吗
3. 有没有哪一段讲了两件事
4. 关键洞察之后有没有留一个短段落喘气
5. 结尾回扣钩子了吗
6. 有没有「重要」「震撼」「深刻」这类不落地的词

写 \`awaiting_human\` 交给用户时，**告诉他你用的是哪种钩子、整片的弧线怎么走**，
以及**哪一段你拿不准**。第三条不要空着。
`

export const STUDIO_STORYTELLING_SKILL: RuntimeSkill = {
  name: 'dsh-creative-studio-storytelling',
  source: 'runtime',
  description:
    '解说片的叙事结构：But-Therefore 因果链、整片弧线与按时长缩放、四种钩子、'
    + '先讲误解再纠正、引导发现法、节奏与认知负荷上限。'
    + '简报的要点是并列的而片子是线性的——这份技能是把并列改造成因果的方法。',
  whenToUse:
    '简报过闸之后、写 script 之前；或者脚本被指出「只是要点平铺、没有起承转合」时。',
  content: CONTENT,
}

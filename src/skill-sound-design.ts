/**
 * The craft skill for the compose stage: choosing a music bed.
 *
 * Ported from OpenMontage's `skills/creative/sound-design.md`, whose numbers
 * come from the W3C accessibility guidance, the BBC audio guidelines, the
 * platform loudness specs and standard mastering practice.
 *
 * WHAT WAS DELIBERATELY LEFT OUT, AND WHY IT IS MOST OF THE SOURCE.
 *
 * The original is largely a table of levels: duck the music 18-20 dB under
 * speech, carve 2-4 kHz out of the bed, land the mix at -14 LUFS, keep true
 * peak under -1.5 dBTP. Every one of those is COUNTABLE, and this plugin does
 * them in ffmpeg on every render — see `audio-mix.ts`. Repeating them here
 * would put a second copy of each number in a place nothing checks, and invite
 * the model to ask for a level it has no way to set.
 *
 * So the split is the one this project uses everywhere: code for what can be
 * counted, instructions for what cannot. What is left is genuinely a judgement
 * call — tempo, genre, mood, and the two rules that disqualify a track
 * outright. That is a short skill, and it should be.
 *
 * The TTS processing chain (HPF, EQ, 3:1 compression, de-esser) is also left
 * out, for a different reason: we do not mix the narration. It arrives from the
 * TTS workflow and goes into the film as generated. Advice with no lever
 * attached reads as a missing feature.
 */
import type { RuntimeSkill } from './skill.js'

const CONTENT = `# 给片子配一段背景音乐

选曲用。你要产出的是**一段器乐**，长度够铺满全片。

先说清楚这份技能不管什么：

> **音量、压制、EQ、响度、真峰值，全部由插件在 ffmpeg 里完成，你不用管，也管不了。**
> 音乐床压在解说下方 20 dB、解说一响再往下让 8 dB、
> 从音乐里挖掉 2–4 kHz 给人声让路、整体压到平台的 LUFS 目标——
> 这些是**可以数出来的**，所以写成了代码。
>
> 剩下**数不出来的**才归你：**多快、什么调性、什么乐器**。

## 一、两条硬规矩，违反了整段废掉

**① 必须是纯器乐。** 有人声的曲子会和解说抢同一条通道，
再怎么压制也压不掉「两个人同时说话」的感觉。
提示词里明确写 instrumental，负向里写 vocals / lyrics / singing。

**② 动态要平。** 不要有 drop、不要有渐强到高潮、不要有突然的静默。
背景音乐一旦有戏剧性起伏，观众的注意力就会从解说上被拽走一次。
提示词里写 steady / even dynamics / no build-up。

这两条不是偏好，是**背景音乐和配乐的区别**。

## 二、速度按内容类型定

| 内容 | BPM | 情绪 |
|---|---|---|
| 沉静讲解 / 教程 | 60–80 | 专注、可信 |
| 企业 / 访谈 | 60–100 | 专业、克制 |
| 常规解说 / 科普 | 90–110 | 平稳、不抢戏 |
| 轻快解说 / 推广 | 110–130 | 热情、好接近 |
| 高能 / 产品演示 | 120–140 | 兴奋、紧迫 |
| 快节奏 / 动作 | 140–200 | 肾上腺素 |

**对齐风格 playbook 的 \`pacing_profile\`**，别自己另定一套：

| playbook 的语速档 | 取这一行 |
|---|---|
| \`contemplative\` | 60–80 |
| \`conversational\` / \`technical\` | 90–110 |
| \`cinematic\` | 90–110（偏慢端） |
| \`energetic\` | 120–140 |

## 三、解说片能用的几类曲风

- **Lo-fi**——稳、不抢戏、现代感
- **Ambient**——气氛型，天生待在背景里
- **轻原声吉他**——温暖、好接近
- **当代流行器乐**——轻快、耳熟
- **Cinematic light / inspiring**——有情绪但不压人

配严肃题材用后两类要小心，很容易变成「广告片腔」。

## 四、长度

**至少要够全片长度。** 短了会听出循环接缝——
插件会把它循环铺满，但循环点是硬切，不是交叉淡入。

宁可长，长了会从头截断，并自动做 1.5s 淡入 / 2s 淡出。

## 五、把方向转写成提示词

你要说清的是四件事：**曲风 + BPM + 情绪 + instrumental**，再加时长。
但**怎么写出来，取决于工作流后面是哪个模型**——

> 面板和这份技能给的是**方向**，不是可以照抄的提示词。
> 先用 \`comfyui_workflow\` 的 \`action: "skill"\` 读那条配乐工作流的技能包：
> 它写着那个模型吃什么形状的提示词、有没有自己的风格词表、负向怎么写。
> 用户标了 \`requireSkill\` 的工作流**不读就跑不了**。

下面这行只是**信息完整度的样子**，不是格式模板：

\`\`\`
lo-fi ambient instrumental / 75 BPM / calm, focused / steady, no drops / 90s
\`\`\`

四项都在、时长在、instrumental 写明——**够不够按这个比，怎么排按模型的规范来**。

负向要表达的是：\`vocals, lyrics, singing, sudden dynamics, crescendo\`。
有的模型没有负向输入槽，那就在正向里用它自己的写法表达"纯器乐、动态平稳"。

## 六、交给用户之前

说清楚三件事：**你选了多少 BPM、哪一类曲风、为什么配这个片子**。
第三条不要写成「符合视频调性」——写出你对齐的是哪一个具体属性
（语速档、题材、目标平台）。
`

export const STUDIO_SOUND_DESIGN_SKILL: RuntimeSkill = {
  name: 'dsh-creative-studio-sound-design',
  source: 'runtime',
  description:
    '给解说片选背景音乐：必须纯器乐、动态要平这两条硬规矩，'
    + '按 playbook 语速档定 BPM，几类适合解说的曲风，长度与提示词写法。'
    + '音量压制、EQ、响度这些可以数出来的事插件在 ffmpeg 里做了，这份技能只管数不出来的部分。',
  whenToUse:
    '合成阶段要加背景音乐、或者要重新选一段配乐时；片子被指出「音乐抢戏 / 有人声 / 忽大忽小」时也读这份。',
  content: CONTENT,
}

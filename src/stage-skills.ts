/**
 * The per-stage operating instructions, one skill each.
 *
 * These were a single 350-line section inside the pipeline skill, which meant
 * that asking how to write a brief also loaded how to mux a film. Split so a
 * stage costs only itself.
 *
 * KEYED BY STAGE, NOT BY PIPELINE × STAGE. `pipelines.ts` states the design
 * these follow: a pipeline is an ordering of screens, and a second pipeline
 * "reuses the project and script screens unchanged". Stage skills inherit that
 * — a podcast run writes the same `brief` artifact through the same fields, so
 * it reads the same skill. Keying them per pipeline would have produced 13
 * copies of one document and 13 places to fix a typo.
 *
 * WHY SKILLS RATHER THAN REFERENCE FILES. The platform supports a skill
 * `resourceBase`, and this is exactly the shape that mechanism is for. But the
 * `web-app` bundle disables `tool-fs`, `tool-fs-search` and
 * `tool-str-replace-editor`, so in the profile this plugin actually runs in,
 * the model has no way to open a file — a reference would be a path it silently
 * could not follow. A registered skill is loaded by the same on-demand gesture
 * and needs no filesystem.
 *
 * Generated content is copied verbatim from what the pipeline skill already
 * said; the interpolations still read live config, so the numbers stay the ones
 * in force rather than a documented example.
 */
import type { Config } from './config.js'
import { defaultWorkflow } from './config.js'
import { resolvePlaybook } from './playbooks.js'
import type { RuntimeSkill } from './skill.js'

/** The prefix every stage skill shares. `stage-` keeps them together in a catalog. */
export const STAGE_SKILL_PREFIX = 'dsh-creative-studio-stage-'

/** The gesture that loads one stage's instructions, for the pipeline skill to cite. */
export function stageSkillName(key: string): string {
  return STAGE_SKILL_PREFIX + key
}

export function buildStageSkills(config: Config): RuntimeSkill[] {
  const designWorkflow = defaultWorkflow(config.bindings.voice_design) === ''
    ? '（未绑定——告诉用户去设置页的「ComfyUI 工作流绑定」里填上，不要自己找一条代替）'
    : '`' + defaultWorkflow(config.bindings.voice_design) + '`'
  const { playbook } = resolvePlaybook(config.defaultStyle, config.playbooks)
  const charsPerSecond = playbook.narration.chars_per_second
  const budget = Math.round(config.defaultDurationSeconds * charsPerSecond)
  // Every stage body interpolates some subset of these; naming them all keeps
  // the generated bodies identical to the text they came from.
  void designWorkflow; void charsPerSecond; void budget; void playbook

  return [
    {
      name: stageSkillName("brief"),
      source: 'runtime',
      description: "写 brief 产物：字段表（多一个字段整条被拒）、投放平台如何决定成片画幅、建完项目立刻起草而不是等用户再说一遍、以及「换个方向」要换成什么。",
      whenToUse: "要写或重写创意简报时。项目刚 init 完紧接着就是这一步。",
      content: `# brief（创意简报）

从用户一句话需求推出来。**字段就这些，不要自己发明**（多一个字段就整条被拒）：

| 字段 | 必填 | 说明 |
|---|---|---|
| \`version\` | ✔ | 固定字符串 \`"1.0"\` |
| \`title\` | ✔ | 片名 |
| \`hook\` | ✔ | 开场三秒抓人的那句，**不是标题的复述** |
| \`key_points\` | ✔ | 三到五条，每条是一个能独立成段的信息点，不是关键词 |
| \`style\` | ✔ | 当前风格的 id（如 \`clean-tech\`） |
| \`target_duration_seconds\` | ✔ | 用户没说就用 ${config.defaultDurationSeconds} |
| \`core_message\` | | 一句话说清整片要传达什么。**「切入角度」写这里**，没有 \`angle\` 字段 |
| \`cta\` | | 结尾行动号召 |
| \`target_audience\` | | 受众 |
| \`tone\` | | 语气。不填就用风格自带的旁白语气 |
| \`target_platform\` | | 只能是 \`youtube\` / \`bilibili\` / \`douyin\` / \`xiaohongshu\` / \`wechat\` / \`generic\`。**它决定成片画幅**（见下表）。**不确定就填 \`generic\`**，别写 \`web\` 这类不在表里的值 |
| \`metadata\` | | 自由字段，放不进上面任何一格的东西塞这里 |

**建完项目就立刻起草一版，不要等用户再说一遍。** 用户在创意工作台里看到的是一个
表单——空表单等于让他从零写，而他刚刚已经把需求讲过一次了。正确节奏是：
\`studio_project init\` 之后**紧接着**写 brief 并以 \`awaiting_human\` 提交，
然后用一段话把要点讲给他听。

用户可能会要**换一个方向**（面板上有「重新生成」按钮，会发一句话给你）。
这时重写一版 \`awaiting_human\`，**方向要真的不同**——不是把同一版换几个词，
是换切入角度、换受众假设、换叙事顺序。

写完停下等确认。

### 投放平台决定画幅

\`target_platform\` 不是标签，是**出片尺寸**：

| 平台 | 画幅 |
|---|---|
| \`youtube\` / \`bilibili\` | 1920x1080 横屏 |
| \`douyin\` / \`wechat\` | 1080x1920 竖屏 |
| \`xiaohongshu\` | 1080x1440 竖屏 3:4 |
| \`generic\` | 用设置里的默认值 |

用户也能在创意工作台的项目页直接选，选的结果存在项目标记上。
**两处都有时以项目标记为准**——那是用户自己点的。
所以你要改画幅，改 \`brief.target_platform\` 可能不生效；
让用户在面板上选，或者明确告诉他去改。
`,
    },
    {
      name: stageSkillName("script"),
      source: 'runtime',
      description: "写 script 产物：字段表、按风格语速算每段字数、分段即分镜、visual.prompt 只写看得见的东西。叙事结构本身在 storytelling 技能里。",
      whenToUse: "brief 过闸之后要写脚本时，或脚本被打回要改时。",
      content: `# script（脚本）

**分段即分镜。** 每个 section 是一句解说 + 一张配图，这是这条管线的物理约束。

- **按 ${charsPerSecond} 字/秒估算**（当前风格的值，风格不同语速不同）。
  ${config.defaultDurationSeconds} 秒片约 ${budget} 字。写超了就是要重录。
- 单段 ${playbook.pacing.minSectionSeconds}–${playbook.pacing.maxSectionSeconds} 秒。
  短了配图来不及看清，长了一张图撑不住——撑不住就拆段，不要硬拉长。
- \`start_seconds\` / \`end_seconds\` 是**意图**，不是承诺。compose 会用 ffprobe 量出的
  真实配音时长重排时间轴，字幕也按实测走。但仍要写得像样：段间不许重叠，
  最后一段结束时间与 \`total_duration_seconds\` 偏差不得超过 25%，否则校验不过。
- \`text\` 是**要念出来的字**。不要写"（停顿）""【画面：xxx】"这类东西——它们会被念出来。
- \`visual.prompt\` **只写画面主体，不写风格词**。风格由 playbook 的前后缀统一加，
  你在这里再写一遍"cinematic"之类，就是在和风格库打架。

### 表演指导（narration 不是朗读）

目标是让配音听起来**被导过**，而不是被念过。

顶层必须给 \`voice_performance\`：

- \`performance_intent\` — 当前风格的语气是「${playbook.narration.voice_style}」，据此写具体意图
- \`pacing_profile\` — \`${playbook.narration.pacing_profile}\`
- \`energy_curve\` — 能量怎么走（例：钩子克制，中段变暖，收尾更慢）
- \`pause_policy\` — 什么地方停（例：铺垫句后短停，反转前长停）
- \`sample_section_id\` — **最考验表演的那一段**的 id，样音就录它，不是默认第一段

每段可给 \`delivery_cues\`：

| 字段 | 用途 |
|---|---|
| \`pace\` | slow / measured / conversational / brisk / fast |
| \`energy\` | 这一段的情绪 |
| \`emphasis_words\` | 要咬住的词 |
| \`pause_before_seconds\` / \`pause_after_seconds\` | **覆盖风格的默认留白**（默认前 ${playbook.pacing.padBeforeSeconds}s / 后 ${playbook.pacing.padAfterSeconds}s），反转前想留白就写这里 |
| \`delivery_note\` | 一句话说清怎么念 |
| \`provider_text\` | TTS 要吃的带标记版本（SSML break、断句符号）。\`text\` 保持干净给字幕用 |

**写作规则**（照抄自 OM 的 voice-performance-director，这几条最管用）：

1. 写口语不写书面语。短句、少从句、标点清楚
2. **用静默做结构。** 反转前、惊人论断后、最终结论前加停顿
3. 停顿要克制。太多 break 听起来做作
4. **禁止空话。** "自然""有感染力""生动"这类词，除非同时给出具体的
   pace / emphasis / pause / energy，否则等于没写
5. **一段只放一个表演意图。** 需要三次情绪转折就拆成三段

写完停下等确认。
`,
    },
    {
      name: stageSkillName("assets-audio"),
      source: 'runtime',
      description: "生成配音并回填 asset_manifest_audio：音色怎么定、样音先行、批量生成的异步节奏、以及两个素材段共同的落盘规则（路径、scene_id、逐段 in_progress）。",
      whenToUse: "脚本过闸之后要配音时。",
      content: `# assets_audio（配音）

**先确认音色。** 项目上的 narration voice 为空时，\`studio_project\` 的输出会明写
\`NOT SET\`。这时**先问用户**——把 TTS 工作流 voice 参数的选项列给他挑，或者请他先去
ComfyUI 面板用音色设计工作流做一个「解说」音色。定下来用
\`studio_project action: "set_voice"\` 记到项目上。**不要自己挑一个音色就开跑**：
整片配错音色等于整片重做。音色设计本身是准备流程，不在这条管线里。

**用户在创意工作台点「自动生成」时，你要做的是**：用
\`studio_project action: "set_voice"\` 写 \`voice_design_name\` 和 \`voice_design_prompt\`。
这两个字段直接回填到他面前的表单里，所以**一次调用就写完，不要先在对话里问他**——
项目的标题、简报和风格你都读得到，据此拟一版即可，不满意他会点「重新生成」。

\`voice_design_name\` 有硬性格式要求，写错了工作流会拒绝：

- **英文小写 + 下划线，不带扩展名**，例如 \`wuhan_30y_female\`
- **不要写 \`.wav\`**——ComfyUI 节点自己会补后缀，你再加一次就成了 \`xxx.wav.wav\`
- **绝对不能是中文**。它是音色库里的文件名，不是给人看的标签
- 建议编码进可辨识的信息：地域/年龄/性别/气质，如 \`beijing_40y_male_calm\`

\`voice_design_prompt\` 是给音色设计工作流的**英文**提示词，描述音质本身
（年龄、性别、音色、语气、口音），不要描述要念的内容。

音色设计工作流是 \`${designWorkflow}\`。

**新音色保存进音色库后，刷新音色库快照与音色库数据，并确认新音色可用**
（配音工作流和音色查询工作流都要）。怎么刷见 dsh-comfyui 的技能。

音色名被判「不在允许的选项里」时，多半是快照没刷新，**先刷新再重试**，
不要改音色名去迁就旧清单。

**样音先行。** 批量配音之前，先只跑 \`sample_section_id\` 那一段，把音频发给用户听。
他确认音色、语速、停顿、情绪都对了再往下。样音过了之后**不许再改** TTS 工作流、
音色、语速——改了就要重新出样音。这一步只花一次调用，省的是整批重录。

样音**不单独写 checkpoint**，它和整批配音一起在这一段的闸上通过。

**然后一次把所有段落的配音跑完，中途不要去跑图像。** 原因是 ComfyUI 的调度：
图像和音频工作流用的是不同的模型，交替调用会让它反复卸载/加载模型，
时间几乎全耗在 load models 上。同类连着跑，模型只加载一次。
管线把配音和配图拆成两段，就是为了让这件事在流程上是天然的。

跑完写 \`asset_manifest_audio\`，走审批闸：\`awaiting_human\` → 用户认可 → \`completed\`。
这一段**只接受**声音类素材（narration / audio / music / sfx），塞进一张图会被
\`WRONG STAGE\` 挡回来。

## 两段共同的落盘规则

（做错就是 \`ASSET MISSING\`）

- 生成完用 \`studio_project\` 的 \`action: "import"\` 把文件搬进项目，它会返回
  项目相对路径。**不要自己拼路径**，也不要把 ComfyUI 的输出目录直接写进 manifest
- 每个 item 要传 \`scene_id\`。**文件名由插件生成，你不要起名**——
  规范是 \`<序号>-<段id>[.v<n>].<扩展名>\`，序号来自脚本里的段顺序
- 同一段重复 import 会**生成新版本**（\`.v2\`、\`.v3\`），不覆盖旧的。
  重做某一段就直接再 import 一次，然后在 manifest 里写新返回的路径
- \`assets[].scene_id\` 必须是脚本里真实的 section id
- 该段的**每个 section 都要有素材**，缺一个就 \`COVERAGE_INCOMPLETE\`
- \`duration_seconds\` 不用你填，写了也会被 ffprobe 的实测值覆盖

素材还没齐但想记录进度，可以写 \`status: "in_progress"\` 带上部分 manifest——
它会**当场校验路径和 scene_id**，只跳过覆盖检查。路径写错能提前报出来。
`,
    },
    {
      name: stageSkillName("assets-shots"),
      source: 'runtime',
      description: "生成分镜并回填 asset_manifest_shots：scene_plan 先行、五层提示词怎么拼、一段切多镜怎么写 shot_index 和 weight，以及两个素材段共同的落盘规则。",
      whenToUse: "配音过闸之后要出图时。镜头语言本身在 cinematography 技能里。",
      content: `# assets_shots（配图）

配音通过之后才做。同样一次跑完所有段落。

**提示词不用你拼。** 插件按五层拼好后连同负向提示词一起给你，**原样用**。
面板发的生成请求里每一镜都带着拼好的整条。

> 曾经的做法是「风格前缀 + 本段主体 + 风格后缀」。
> 固定的那两截在提示词里占了 84% 的词，于是构图光线全部收敛，十段出十张同款。
> 现在固定的只剩最后一句风格，占比降到 53%。**不要再手工拼前后缀，那是在把它改回去。**

你要决定的是另外两件事，写进 \`scene_plan\`：

1. 每一镜**拍什么**（\`prompt\`，一句英文，只写画面主体，不写风格不写光线）
2. 用什么**镜头语言**（\`shot_language\`，选填但强烈建议填——它才是让十张图不一样的东西）

五层是这样拼的，四层逐镜变化：

| 层 | 来自 | 变不变 |
|---|---|---|
| 1 相机 | \`lens_mm\` + \`depth_of_field\` | 逐镜 |
| 2 镜头 | \`shot_size\` + \`camera_movement\` | 逐镜 |
| 3 主体 | \`prompt\` + \`texture_keywords\` | 逐镜 |
| 4 光线 | \`lighting_key\` + \`color_temperature\` | 逐镜 |
| 5 风格 | playbook 的一句话 | **固定，只有这一层** |

某一镜没写的字段，用风格的默认值补；**你写了就以你的为准**。
所以「这个风格偏好暖光」和「这一镜是夜戏」不冲突——后者赢。

**不要在 \`prompt\` 里写画幅**（16:9 之类）。画幅由 \`target_platform\` 决定，
写进提示词只会和实际出片打架。

跑完写 \`asset_manifest_shots\`，同样走闸。这一段**只接受** image / video。

### 分镜计划 \`scene_plan\`

> **设计镜头语言时先加载 \`/dsh-creative-studio-cinematography\`。**
> 配音过闸时面板会自动带上这个手势，正文会作为指令注入。
> 那份技能讲的是「旁白的功能怎么映射成镜别」和「全片的紧松节奏」——
> 六个字段全空时五层里有四层是空的，画面必然雷同。


这一段还有第二份产物：\`scene_plan\`，记的是**每个分镜打算拍什么**，在生成之前就写。
它不走闸（闸看的是图有没有出来，不是想没想好），但**照样过 schema 校验**。

面板保存分镜时会自动写它。你要写就用 \`studio_stage\` 带上 \`scene_plan\`，形状是：

\`\`\`jsonc
{
  "version": "1.0",
  "shots": [
    {
      "id": "s1-0",            // 同一份计划内唯一
      "section_id": "s1",      // 脚本里真实的段 id
      "shot_index": 0,         // 同段内必须 0..n-1，不能跳号重号
      "prompt": "俯瞰清晨的城市天际线",   // 这一镜拍什么，主体本身
      "texture_keywords": ["湿漉漉的沥青", "冷雾"],
      "weight": 1.5,           // 占本段时长的份额，缺省均摊
      "hero_moment": true,     // 全片的画面顶点，标一两个就够
      "shot_language": {       // 全部选填，但填了就必须是下面的词
        "shot_size": "establishing",
        "camera_movement": "static",
        "lens_mm": 24,
        "lighting_key": "golden_hour",
        "color_temperature": "warm",
        "depth_of_field": "deep"
      }
    }
  ]
}
\`\`\`

\`shot_language\` 的取值是**封闭词表**，写别的会被判 \`SCHEMA INVALID\`：

| 字段 | 可选值 |
|---|---|
| \`shot_size\` | extreme_wide / wide / medium_wide / medium / medium_close / close_up / extreme_close_up / over_shoulder / insert / establishing |
| \`camera_movement\` | static / pan_left / pan_right / tilt_up / tilt_down / dolly_in / dolly_out / tracking_left / tracking_right / crane_up / crane_down / handheld / steadicam / whip_pan / orbital / zoom_in / zoom_out / rack_focus |
| \`lens_mm\` | 14 / 24 / 35 / 50 / 85 / 135 / 200 |
| \`lighting_key\` | high_key / low_key / natural / golden_hour / blue_hour / tungsten_warm / neon / silhouette / rim_lit / volumetric / overcast_soft |
| \`color_temperature\` | cool / neutral / warm / mixed |
| \`depth_of_field\` | shallow / medium / deep |

### 生成之前会查一遍重复度

用 \`studio_stage\` 写 \`scene_plan\` 时，**返回里会直接带一份重复度报告**（\`variation\`），
不用你另外去问。面板也会在生成按钮上方显示同一份。查这些：

| | 查什么 |
|---|---|
| 镜别单调 | 同一个镜别超过一半，或者干脆全都没写 |
| 连续同镜别 | 连着三镜一样 |
| 光线单一 | 四镜以上只有一种光 |
| 没有高光 | 一个 \`hero_moment\` 都没标 |
| 高光不突出 | 高光镜和邻镜同镜别 |
| 空词 | modern / stunning / masterpiece 这类，对扩散模型等于没说 |
| 缺质感词 | \`texture_keywords\` 覆盖不到三成 |
| **主体重复** | 两镜写了同一句画面 |
| 空主体 | 这一镜和所在段都没写画面 |

**它只提示，不拦你。** 但 \`verdict\` 是 \`revise\` 或 \`fail\` 时先改计划再生成——
改几个字比重跑一批图便宜太多。

**为什么值得填 \`shot_language\`**：曾经每张图都是「同一个前缀 + 一句描述 + 同一个后缀」，
固定的那两截占了 84% 的词，所有画面收敛成同一副样子。
镜别、焦段、光线是**逐镜不同**的那部分——它们才是让十张图真的是十张图的东西。

## 两段共同的落盘规则

（做错就是 \`ASSET MISSING\`）

- 生成完用 \`studio_project\` 的 \`action: "import"\` 把文件搬进项目，它会返回
  项目相对路径。**不要自己拼路径**，也不要把 ComfyUI 的输出目录直接写进 manifest
- 每个 item 要传 \`scene_id\`。**文件名由插件生成，你不要起名**——
  规范是 \`<序号>-<段id>[.v<n>].<扩展名>\`，序号来自脚本里的段顺序
- 同一段重复 import 会**生成新版本**（\`.v2\`、\`.v3\`），不覆盖旧的。
  重做某一段就直接再 import 一次，然后在 manifest 里写新返回的路径
- \`assets[].scene_id\` 必须是脚本里真实的 section id
- 该段的**每个 section 都要有素材**，缺一个就 \`COVERAGE_INCOMPLETE\`
- \`duration_seconds\` 不用你填，写了也会被 ffprobe 的实测值覆盖

素材还没齐但想记录进度，可以写 \`status: "in_progress"\` 带上部分 manifest——
它会**当场校验路径和 scene_id**，只跳过覆盖检查。路径写错能提前报出来。
`,
    },
    {
      name: stageSkillName("compose"),
      source: 'runtime',
      description: "合成成片并记录 render_report：studio_compose 怎么调、返回的报告要原样交给 studio_stage（自己拼装几乎一定 SCHEMA INVALID）、以及怎么把成片带进对话。",
      whenToUse: "两个素材段都过闸之后要出片时，或要记录一次合成结果时。",
      content: `# compose（合成）

调 \`studio_compose\`，它读脚本和 asset_manifest，ffprobe 量时长、按风格的节奏排时间轴、
生成字幕、ffmpeg 出片，返回一份 \`render_report\`。

### 出片前的幻灯片风险闸

\`studio_compose\` 出片前会打一次分，五个维度：

| 维度 | 看什么 |
|---|---|
| \`repetition\` | 画面描述和镜别重不重样 |
| \`decorative_visuals\` | 有多少镜是「这段需要张图」——没主体没镜头语言没质感词 |
| \`static_hold\` | 单张画面停留多久（风格关了 Ken Burns 的话门槛更严） |
| \`picture_rate\` | 每分钟几张画面，太少就是在念幻灯片 |
| \`unsupported_style_claim\` | 风格自称电影感，结构撑不撑得住 |

**这一道是真的会拦。** 平均分 ≥ 4，**或者过半维度各自 ≥ 4**，就直接抛
\`QUALITY VIOLATION\`，不出片。

> 为什么不只看平均：三个维度全打满、两个正常，平均才 3.0——
> 而那部片子每一项看过它的指标都说它是幻灯片。**几个独立指标同时报警比它们的均值更有说服力。**

被拦了先回 \`scene_plan\` 改：补镜头语言、换掉重复的画面、标一个高光镜。

**\`force: true\` 只有一种用法**：用户看过分数、明确说就这么出。
**不要自己判断「应该可以」然后带上它。**

### 字幕：旁挂还是烧录

\`studio_compose\` 有两个可选参数，**面板会在提示里明确告诉你用哪个**：

| 参数 | 值 | 什么时候 |
|---|---|---|
| \`burn_subtitles\` | \`true\` / \`false\` | 缺省用设置里的默认。**成片页每次导出可以单独选** |
| \`subtitle_background\` | \`outline\` / \`box\` | 描边保留画面，底色块保证对比度 |

不烧录时字幕仍然会写成旁挂 \`.srt\`，和成片放在一起。
烧录要重新编码整段视频，并依赖本机字体——**字体缺失时 libass 会静默换字体，不报错**。

字号、边距、安全区不用你操心，插件按输出画幅算好（Netflix / BBC / WCAG 那套规范）。
**每行字数**由风格的 \`subtitleMaxChars\` 决定（中文 18–24，不是拉丁文的 42）。

## 记录

**把它返回的 report 原样交给 \`studio_stage\`**（\`stage: "compose"\`, \`status: "completed"\`）。

「原样」是字面意思：**整个对象照搬，一个字段都不要动、不要补、不要重排**。
不要自己拼一份，也不要「整理」成看起来更整齐的样子——路径和时长是 ffprobe 实测的，
\`studio_stage\` 会拿它们去核对文件真实存在。

真踩过的两次返工，都是重新拼装造成的：

\`\`\`jsonc
{
  "version": "1.0",              // 必须正好是字符串 "1.0"
  "outputs": [                   // 必填，至少一项
    {
      "path": "output/xxx.mp4",  // 必填，项目相对路径
      "format": "mp4",           // 必填
      "resolution": "1920x1080", // 必填
      "duration_seconds": 42.5,  // 必填
      "codec": "libx264",        // 以下选填：codec / audio_codec / fps / file_size_bytes
      "file_size_bytes": 8123456
    }
  ],
  "render_time_seconds": 12.3,   // 选填
  "warnings": [],                // 选填
  "metadata": { }                // 选填，放不进上面的东西都归这里
}
\`\`\`

顶层**只认这五个键**、每个 output **只认上面八个键**，多一个就会被判 \`SCHEMA INVALID\`。所以照搬永远是对的，
自己拼装几乎一定要返工——\`studio_compose\` 返回的就是这个形状。

记完了，把成片带进对话：

    studio_show project=<项目id> paths=["output/xxx.mp4"]

它只做一件事——把项目里已有的文件放到聊天里，让人当场能看。
不生成、不导入、不落盘，路径就是 manifest 或 render_report 里的原样路径。
任何时候想给人看点什么（一段配音、一张分镜、一版成片）都可以用它，不必等到最后。
`,
    },
  ]
}

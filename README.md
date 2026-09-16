# dsh-openreelbench

English: [README.en.md](README.en.md)

**dsh 开源视频创意台** —— DeepSeek Harness 插件，把一句话需求变成一条带配音、配图和字幕的解说片。

四段状态机，两个人工审批闸：

```
brief ──[闸]──> script ──[闸]──> assets ──> compose
```

**生成走 ComfyUI，合成走 FFmpeg。** 插件自己不连 ComfyUI——它持有一张绑定表，
告诉 Agent 该用哪个工作流，Agent 用 [`dsh-comfyui`](https://github.com/fandc520/dsh-comfyui)
的 `comfyui_workflow` 去跑。换工作流只改配置，不改代码。

双面结构：宿主半面（工具 / 技能 / 设置命名空间注册）+ 浏览器半面（设置页 UI）。
设置页在「设置 → OpenReel 创意台」独立侧边栏入口下，见 [插件开发标准](docs/PLUGIN_DEVELOPMENT.md)。

## 为什么要一个状态机

管线的价值不在"有一组工具"，在于**推不动的地方真的推不动**：

- 脚本没经用户确认，`assets` 写不进去 —— `GATE VIOLATION`
- 前面的段没做完，后面的段写不进去 —— `PREREQUISITE VIOLATION`
- manifest 里的文件磁盘上不存在，`assets` 完不成 —— `ASSET MISSING`
- 有段落缺配音或配图，同样完不成 —— `COVERAGE INCOMPLETE`

这些都**抛错**，不是"提示一下但还是写进去"。做成后者，整套治理就废了，
插件退化成一组普通工具。

配音时长不采信调用方申报的值，一律以 `ffprobe` 实测覆盖；时间轴和字幕都按实测排。

## 安装

**版本要求**：DeepSeek Harness **≥ 0.1.2**（新版 settings 服务 API；建议直接用 0.1.5-rc 线）、
Node ≥ 22.19，以及 PATH 上的 `ffmpeg` / `ffprobe`。

**搭配插件**：强烈建议与姊妹插件 [`dsh-comfyui`](https://github.com/fandc520/dsh-comfyui)（≥ 0.4.0）
一同安装。OpenReelbench 自己不连 ComfyUI——图像、配音、配乐的生成全部经由它的 `comfyui_workflow`
执行。先装好 dsh-comfyui 并在其面板里备好工作流，再把工作流**名称**填进下面的绑定表。

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile <你的 profile> add github:fandc520/dsh-openreelbench
```

pnpm ≥ 10 默认拦截 Git 依赖的构建脚本，需要在 profile 的 `pnpm-workspace.yaml` 里
`allowBuilds` 之后重跑 `add`。装完重启 profile。

本地开发装法：

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile <你的 profile> add D:\dev-projects\Ai-CreativityStudio\dsh-openreelbench
```

## 配置

两个入口写同一份值：**DSH 设置页的 `openreel` 段**，以及 `cordis.yml` 里的 `openreel` 层。
同一套 schemastery schema 驱动两边——设置页把 `cordis.yml` 当基础层，只写你改动的部分。

改动**即时生效**，不用重启：项目根、ffprobe 路径都是每次调用时读，
绑定表和风格契约变了会重挂技能（它们是渲染进指令正文的，不重挂就会指向旧工作流）。
只有插件代码本身变了才需要重启。

`cordis.yml` 那一层长这样：

```yaml
- id: openreel
  name: dsh-openreelbench
  config:
    workspaceRoot: ''            # 空 = $DSH_HOME/data/dsh-openreelbench/projects
    defaultDurationSeconds: 30
    video:                       # 只有编码参数；观感和节奏归风格库
      width: 1920
      height: 1080
      fps: 30
      preset: medium
    defaultStyle: clean-tech     # clean-tech / warm-doc / flat-brief
    burnSubtitles: false         # false 只出 .srt 旁挂文件（不需要重编码）
    bindings:
      tts:
        workflow: 'Qwen3-TTS(Text)'      # dsh-comfyui 工作流库里的名称
        notes: ''
      image:
        workflow: 'Krea-T2I-Afterlight'
        notes: ''
```

**绑定只给名称，不复述参数。** `comfyui_workflow action: list` 已经返回每条工作流的
完整参数清单（英文 name、中文 label、默认值、options、numberKind、upload 类型），
而且随用户在面板里的改动实时变。在这里再抄一份只会漂移。绑定的职责就是
把 Agent 指到工作流库里对的那一条，怎么调它由那份清单说了算。

用名称而不是 id：id 是 `randomUUID()`，同一张画布**重新提取一次就变**，
配置会静默失效。名称是用户在面板里看得见管得着的。留空时工具和技能会明说"未绑定"，
要求 Agent 去 list 里找，不许自己挑一条。

嵌套配置支持逐键覆盖——只写 `video: { fps: 24 }` 其余键仍取默认值。

## 风格 playbook

**M0 实测暴露的问题**：三段用同一个模型、同一套 seed，只因提示词措辞不同
（一段写 cinematic，一段写 flat/minimal），出来的画风完全不是一路。
**风格靠统一的提示词模板和负向提示词解决，不靠 seed。**

一套 playbook 管这些：

| 段 | 内容 |
|---|---|
| `visual` | 图像提示词前缀/后缀、负向提示词、一致性锚点 |
| `narration` | 旁白语气、语速档、**字/秒**（脚本长度估算用） |
| `pacing` | 段前后留白、单段时长上下限 |
| `kenBurns` / `fit` / `subtitleMaxChars` | 观感 |
| `quality_rules` | 质量红线，写进技能给 Agent 看 |

内置三套：`clean-tech`（清晰科技）· `warm-doc`（温暖纪实）· `flat-brief`（扁平快讲）。

自定义写进 `playbooks`，同名会**整套替换**内置的（不做深合并——半覆盖的调色板正是风格漂移的来源）：

```yaml
    playbooks:
      my-style:
        name: 我的风格
        visual:
          image_prompt_prefix: 'watercolor illustration, soft pastel palette, '
          image_prompt_suffix: ', hand-drawn texture, 16:9'
          negative_prompt: 'text, watermark, photorealistic, 3d render'
          consistency_anchors: ['全片水彩质感', '不要出现文字']
        narration:
          chars_per_second: 4.2
        pacing:
          padAfterSeconds: 0.8
          maxSectionSeconds: 24
```

`openreel_project action: "style"` 会把当前风格的**可直接粘贴的提示词模板**交给 Agent。
单段还能用 `delivery_cues.pause_before_seconds` / `pause_after_seconds` 覆盖风格的默认留白。

### 音色

音色**不在绑定表里**，它是项目级设置：`openreel_project action="init"` 时传 `voice`，
或事后 `action="set_voice"`。为空时工具输出会明写 `NOT SET`，Agent 必须先问用户
（把 TTS 工作流 voice 参数的 options 列出来给他挑）再生成配音。

**设计一个新音色是准备流程，不在这条管线里**——用户在 ComfyUI 面板用音色设计
工作流做好，这边只负责引用。

## 四个工具

| 工具 | 职责 |
|---|---|
| `openreel_project` | `init` / `status` / `list` / `get` / `import` / `set_voice` / `style` / `bindings`。`import` 把 ComfyUI 产出（绝对路径或 http 媒体代理 URL）搬进项目，返回 manifest 要用的项目相对路径 |
| `openreel_stage` | **状态机唯一入口**。写产物 + 推进状态，任何校验不过就抛错 |
| `openreel_compose` | ffprobe 量时长 → 排时间轴 → 出字幕 → ffmpeg 出片，返回 `render_report`。**它不推进状态**，报告要交给 `openreel_stage` 记录 |
| `openreel_show` | 把项目里**已有**的文件放进对话里当场预览（成片、配音、分镜都行）。只回显，不生成、不导入、不落盘 |

分成两步是故意的：`openreel_compose` 只是产出一个文件，这一趟算不算数，
由 `openreel_stage` 核对输出文件真实存在之后才认。

设置页通过 `installSettingsSection` 注册在 `openreel` 命名空间下；宿主没有 settings 服务时
（headless）这一段直接不注册，`cordis.yml` 的值照常生效。

插件通过 `ctx.skills.register` 注册**两份**运行时技能（可被项目/用户技能覆盖），
按触发时机拆分而不是按主题：

| 技能 | 管什么 | 何时加载 |
|---|---|---|
| `dsh-openreelbench-explainer` | 怎么做片子：四段流程、审批闸协议、脚本与表演指导、风格契约 | 开始创作时 |
| `dsh-openreelbench-usage` | 工具怎么表现：谁改状态、输入会被怎样规范化、错误码处置、重试语义、路径规则、与 dsh-comfyui 的分工 | 遇到报错、不确定工具副作用时 |

两份里的绑定表和风格契约都按当前配置实时渲染。

## 项目目录

```
<workspaceRoot>/<projectId>/
├── project.json              项目标识
├── checkpoints/<stage>.json  各段状态
│   └── history/              被覆盖的旧 checkpoint
├── artifacts/<name>.json     brief / script / asset_manifest / render_report
├── assets/images/            配图
├── assets/audio/             配音，以及 music.wav（整片一条的背景音乐床）
├── work/                     渲染临时文件，渲完即删
└── output/                   成片与 .srt
```

`checkpoints/` 和 `artifacts/` 是状态机私有存储，不要用文件工具直接改。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test               # 端到端冒烟测试，需要 ffmpeg
```

冒烟测试用 lavfi 合成素材跑完整条链路（307 项），覆盖两条状态机红线、schema 校验、
路径穿越拦截、时长回填、**冻结入参**、风格解析与回退、逐段停顿覆盖、
`apply()` 对假服务的挂载（工具/技能/设置段注册、配置变更后重挂技能、dispose 清理干净）、
分批生成的中途校验、真实出片、以及"重写早期阶段作废后续阶段"。

音视频这类"文件生成了但内容是错的"的失败，一律**测量输出**而不是测量文件大小：
字幕烧录比对同一帧烧与不烧的像素差，配乐压制用双音测量音乐频段在有无解说时的电平差。

另有 `test/integration-comfyui.mjs`（不进 `pnpm test`）：驱动真实 ComfyUI 工作流跑完整链路，
并断言各段产出互不相同——参数没传进去时 ComfyUI 会命中缓存返回同一结果，
那种失败会让一条全绿的管线跑在错误的素材上。

### 配乐

合成页有一条**配乐**轨道。填一个 ComfyUI 配乐工作流的名称，点「添加音乐」，
Agent 会先读 `dsh-openreelbench-sound-design` 技能选曲，再用那条工作流生成，
最后以 `kind: "music"` 搬进项目——**不填 `scene_id`**，因为音乐属于整部片子。

三项可调：**音量、淡入、淡出**，填完点保存（有未保存改动时按钮旁会显示「未保存」）。
默认就是规范值，改了才算一次决定。**保存后合成和页面试听走的是同一套数**——
试听要是和成片不一样，它就没有存在的意义了。

其余的按规范固定，不开放：这三项是**听得出来**的，
挖频、压制比、响度目标回答的是听不出来的问题。

合成时 ffmpeg 的完整处理：

| 处理 | 值 | 出处 |
|---|---|---|
| 音乐床 | 解说下方 20 dB（可调 −40 ~ −6） | W3C 无障碍 |
| 解说在说时再压 | 约 8 dB（侧链压缩） | BBC，规范给 6–12 dB |
| 音乐 EQ | 3 kHz 挖 −4 dB，给人声让出可懂度频段 | 同上 |
| 淡入 / 淡出 | 1.5s / 2s（各可调 0–20s） | — |
| 整体响度 | −14 LUFS，真峰值 −1.5 dBTP（短视频平台 −1） | 各平台 2025 规范 |

响度走**两遍**：先测，再用 `linear=true` 施加一个固定增益。
单遍 `loudnorm` 是动态的，会把句子之间的空隙当成"太安静"再把音乐顶回去——
把刚做好的压制一段段抵消掉，而且不报错。

曲子短于全片会自动循环并给一条警告；接缝是硬切，所以技能里要求宁可长。

### 素材生成顺序

skill 里写死了一条作业约束：**先把所有配音生成完，再生成所有配图**，不要逐段交替。
图像和音频工作流用不同的模型，交替调用会让 ComfyUI 反复卸载/加载模型，
时间几乎全耗在 load models 上。

配合这条，`assets` 阶段的 `in_progress` 写入**照样校验路径和 scene_id**，
只跳过"每段都得有配音+配图"的覆盖检查——第一批就能发现路径写错，
不用等到全部生成完。

## 血统

状态机移植自 [OpenMontage](https://github.com/calesthio/OpenMontage) 的
`lib/checkpoint.py`，产物 schema 移植自它的 `schemas/artifacts/*.json`，
导演指令移植自 `script-director`。保留了字段名，所以那边的管线描述在这里依然成立。
移植过程中丢掉的是它那套各自为政的生成工具——凡 ComfyUI 能做的都收编成工作流调用。

## 许可

MIT

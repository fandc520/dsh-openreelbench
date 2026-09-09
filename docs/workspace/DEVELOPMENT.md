# 开发文档

项目定位、目录、外部依赖见 [CLAUDE.md](CLAUDE.md)。本文件记录**做过什么、为什么这么做、下一步做什么**。

---

## 当前状态

| | |
|---|---|
| 阶段 | **M1 已完成**；M2 设计已定稿（见第八节），未开工 |
| 插件 | `dsh-creative-studio/`（本工作区子目录）· 双面（host 约 3600 行 + client 约 550 行 TS） |
| 测试 | `pnpm test` 48 项全绿（只需 ffmpeg）；另有真实 ComfyUI 集成测试 |
| 部署 | 已装进用户在用的 `web` profile，`workspaceRoot: D:/AiStudio` |
| 已出片 | `moon-origin-test`（LLM 驱动全程跑通）· `comfy-live`（无 LLM 集成测试） |
| 检索 | 工作区整体一个 codegraph 索引：698 文件 / 11,222 节点 / 29,923 边 |

### 增量路线

| | 阶段 | 内容 | 状态 |
|---|---|---|---|
| M0 | 最短链路 | 四段状态机 + 三工具 + FFmpeg 合成。host-only | ✅ |
| M1 | 风格与质检 | 风格 playbook + 表演指导 + 样音闸 + 设置页（连带建起 client 面） | ✅（reviewer 与成本追踪**已排除**） |
| M2 | UI 面 | 管线进度卡、审批卡片、风格选择条。脚手架已就位，只加界面 | ← 下一步 |
| M3 | Remotion 路径 | 动态排版、数据卡、图表。合成层从「图片轮播」升级到「动态图形」 | |
| M4 | 第二条管线 | 接视频生成。此时才处理长耗时、异步队列、显存约束 | |
| M5 | 工作室化 | 多管线选择、项目库、与 dsh-comfyui 面板视觉整合 | |

顺序逻辑：**把最难的留到架构已被验证之后**。M1 纯数据层消化成本最低；
M2 收益最大且脚手架已在 M1 顺带建好；M3 是质量分水岭但不影响架构；M4 才引入异步和资源约束。

---

## 一、拆解阶段的结论（2026-08-25）

产出四份 HTML 见 `docs/`。以下是反复要用的事实。

### OM 机制速查

**指令驱动架构。** OM 几乎没有编排代码——没有 orchestrator、reviewer、handler。
Agent 读 YAML manifest + Markdown 导演指令来驱动流程，Python 只提供工具和持久化。

**状态机是代码，管线是配置。** 状态机硬编码在 `lib/checkpoint.py`
（写 checkpoint 时回溯校验全部前序段落，不满足抛 `PREREQUISITE VIOLATION`）。
管线是 `pipeline_defs/*.yaml` 声明式数据。同一引擎跑 13 套配置。

**工作流 = 管线 + playbook + 工具组 + 审批策略。** OM 本身没有「工作流」这个概念，
它是这四样的组合。风格差异靠 playbook，不靠新建管线。

**四层检验。** ① JSON Schema 校验（机器判定，失败阻断）② `review_focus` 逐条评审
③ playbook `quality_rules` ④ `success_criteria`。critical 级问题若无具体修复方案自动降级。

**三层知识。** Layer1 工具契约（121 个）→ 靠 `agent_skills[]` 桥接 → Layer3 通用技术知识
（`.agents/skills/`，90 目录 577 md，与 OM 零耦合可整体复用）。
Layer2（`skills/`，157 md）是项目自有规范。

### 实测结论（本机）

- 零 API key 时 **35/121** 工具可用；装完免费依赖 **40/121**
- 规律：**加工已有素材的能力全部本地免费；凭空生成素材的能力几乎全部要钱**
  （配图 0/17、视频 0/27、TTS 0/11、音乐 0/5、数字人 0/4）
- **Remotion 零 key 渲染链路实测跑通**：690 帧 → 4.1MB / 23 秒成品，零 API 调用
- 121 个工具中标 `production` 的**只有 6 个**，`experimental` 有 68 个

### 已确认缺陷（中文 Windows）

两处同一病根，OM 基本没在中文 Windows 上验证过：

1. `tools/audio/piper_tts.py` subprocess 用 `text=True` + `input=`，按系统 GBK 编码写入 stdin
   而 piper 按 UTF-8 读取 → **该工具对任何非 ASCII 文本不可用**。
   修法：`text=False` + `input=text.encode("utf-8")`
2. `tools/tool_registry.py` 探测子进程时同类问题，异常被吞在读取线程里 → 某工具输出被静默丢弃

> 这两个文件最终**没有迁移**（Python 整体没要），所以缺陷不影响本项目。留档备查。

### ComfyUI 收编判定

| 判定 | 数量 | 内容 |
|---|---|---|
| A 全收编 | 73 | 图像 17 · 视频 27 · TTS 11 · 增强 6 · 音乐 5 · 数字人 4 · 3D 3 |
| B 需拆分 | 13 | analysis 族：视觉理解走 ComfyUI，FFmpeg 类分析和转写留本地 |
| C 必须保留 | 20 | video_post 9 · graphics 3 · screen_capture 3 · 音频 2 · 字幕 2 · 发布 1 |
| D 可选/删 | 15 | 角色动画 6 · 素材检索 4 · 3D 世界 2 · 音乐检索 3 |

**收编时不要改能力族名和接口。** 管线 manifest 写的是 `required_tools: [tts_selector, image_selector]`，
只要新适配器仍以 `capability="tts"` 注册进注册表，13 条管线和 103 个导演指令一个字都不用改。

**OM 自带的 ComfyUI 客户端不必移植**——`tools/_comfyui/client.py` 约 500 行，
而 dsh-comfyui 的 `comfyui_workflow` 抽象层次更高（参数已命名化）。
它自带的 4 个工作流 JSON（`flux2-txt2img`、`wan22-t2v/i2v-4step`、`ace-step-1-t2a`）
可以导入 dsh-comfyui 的工作流库复用。

### 为什么不需要 Python

| 工具 | 真实依赖 |
|---|---|
| `video_compose` `video_stitch` `audio_mixer` `scene_detect` `frame_sampler` | 仅 `cmd:ffmpeg` / `cmd:ffprobe` |
| `subtitle_gen` `diagram_gen` `export_bundle` | **零依赖，纯逻辑** |
| `code_snippet` | `pygments`+`PIL` → Node 侧用 shiki 替代 |
| Remotion | 本来就是 Node/React |

真正需要 Python 的只剩 Manim（可选，MVP 不要）和 faster-whisper（可走 ComfyUI Whisper 节点）。

---

## 二、M0：图文解说片（2026-08-28 完成）

选它是因为**三样能力全部就绪**：配音走 ComfyUI TTS、配图走 txt2img、合成用 ffmpeg 对齐。

### 四段状态机

```
brief（审批闸）→ script（审批闸）→ assets → compose
```

两个审批闸都在**花时间之前**——脚本没定就不该去跑生成。

### 文件

```
dsh-creative-studio/
├── package.json          host-only（无 ./client、无 dsh.client）· prepare: build
├── cordis.patch.yml      - insert: [{ id: studio, name: dsh-creative-studio }]
├── test/
│   ├── smoke.mjs         48 项，只需 ffmpeg
│   └── integration-comfyui.mjs   真实 ComfyUI 端到端
└── src/
    ├── index.ts          apply() · inject ['tools'] · 三个 ctx.effect · 设置段
    ├── config.ts         编码参数 + 绑定表 + 风格；每项带中文 description
    ├── state.ts          状态机核心（移植 OM checkpoint.py）
    ├── schema.ts         四份产物的手写校验器（搬 OM 的 JSON schema，零依赖）
    ├── project.ts        布局、路径穿越防护、原子 JSON 写入
    ├── playbooks.ts      风格库（M1）
    ├── compose.ts        ffprobe 测量 → 时间轴 → ffmpeg
    ├── subtitle.ts       实测时间轴 → SRT（含中文标点切分）
    ├── tools.ts          三个工具
    ├── skill.ts          导演指令（移植 OM script-director + voice-performance-director）
    └── skill-usage.ts    工具契约与故障排查（M1）
```

约 3600 行，比最初预估的 1200–1500 多一倍——多出来的在 schema 校验器和 compose 的 ffmpeg 分支上。

### 三个工具

| 工具 | 职责 | 关键约束 |
|---|---|---|
| `studio_project` | init / status / list / get / **import** / set_voice / **style** / bindings | 工作区根来自显式配置，不用 `process.cwd()`；`import` 把 ComfyUI 产出搬进项目并返回相对路径 |
| `studio_stage` | 写产物 + 推进状态，**状态机唯一入口** | 写入前跑 schema + 审批闸 + 前置 + 资产存在性校验，**不合格必须真的抛错** |
| `studio_compose` | 读 asset_manifest，ffmpeg 出片 | 先 ffprobe 回填真实时长再对齐；可中断。**它不推进状态**，报告交回 `studio_stage` 记录 |

`studio_compose` 与 `studio_stage` 分两步是刻意的：渲染只是产生了一个文件，
**算不算数由 `studio_stage` 核对输出文件真实存在之后才认**。

### M0 明确不做

不写 ComfyUI 适配器（Agent 直接调）· 不做 reviewer · 不做成本追踪 · 不碰视频生成 ·
不碰 Remotion · 不做 client 面。

### 验收标准与结果

| | 结果 |
|---|---|
| 一句话需求 → 30 秒图文解说片，在 brief 和 script 停下等确认 | ✅ |
| 跳过 script 直接调 assets 报 `PREREQUISITE VIOLATION` | ✅ |
| 换一个 ComfyUI 工作流，管线和技能不用改 | ✅（改成按名称绑定后验证） |
| 中文 TTS 自然度与 txt2img 风格一致性够不够用 | TTS ✅ / 风格 ❌ → 促成 M1 |

---

## 三、关键设计决策

### 工作流接入：绑定表只给名称

**studio 不连 ComfyUI。** `config.bindings.<能力>.workflow` 只存 dsh-comfyui
工作流库里的**名称**，**不复述任何参数**。Agent 调 `comfyui_workflow action: list`
拿完整参数清单，再用 `action: run` 跑。

理由：

- **不抄参数**——list 已返回英文 name、中文 label、默认值、options、numberKind、upload 类型，
  且随用户在面板里的改动实时变；抄一份必然漂移。用户库里 TTS 正文参数叫 `prompt` 不叫 `text`，
  还有带空格的 `A or B` 和未识别语义的 `param_6`，硬编码参数名一定碎
- **用名称不用 id**——id 是 `randomUUID()`，同一张画布重新提取一次就变，配置静默失效
- **硬校验留在回填**：`studio_stage` 验证文件真实存在，并用 ffprobe 覆盖调用方申报的时长

留空时工具明说「未绑定」，要求 Agent 去 list 里找，不许自己挑一条。

**可视化导入/提参数不要重做**——dsh-comfyui 面板已有（`/comfyui/workflows`、
`/workflows/recognize`、`/comfy-workflows/analyze`、`/comfy-workflows/extract` 五条路由加
`params.ts`）。studio 再做一遍等于两套工作流库、两个 UUID 空间。

### 音色是项目级设置，不是绑定

`project.json` 上的 `voice` 字段，`studio_project` 的 `init` / `set_voice` 写入。
为空时工具输出明写 `NOT SET`，Agent 必须先问用户再生成配音——整片配错音色等于整片重做。

**设计新音色是准备流程，不在管线内**：用户在 ComfyUI 面板用音色设计工作流做好，studio 只负责引用。
用户库里 `Qwen3-VoiceDesign`（造音色，写入角色音色库）与 `Qwen3-TTS(Text)`（逐段配音，
`voice_name` 读同一个库）本来就是这个关系，闭环在 ComfyUI 内部。

### 素材生成顺序：分批，不交替

**先生成全部配音，再生成全部配图。** 图像和音频工作流用不同模型，逐段交替会让 ComfyUI
反复卸载/加载模型，时间几乎全耗在 load models 上（实测 t2i 首张 140 秒，后续 25 秒）。

配合这条，`assets` 的 `in_progress` 写入**照样校验路径和 scene_id**，只跳过覆盖检查——
第一批就能发现路径写错，不用等全部生成完。

### 风格靠 playbook，不靠 seed

**M0 实测的反例**：三段用同一个模型同一套 seed，只因提示词措辞不同（一段写 `cinematic`，
一段写 `flat/minimal`），出来两种画风。seed 只影响多样性/丰富度，不解决风格。

### config 与 playbook 的分界

config 只留**编码参数**（分辨率/帧率/codec/crf/preset）；
**观感与节奏全部归 playbook**（Ken Burns、fit、段前后留白、单段时长、字幕字数）。
`config.video.kenBurns` `config.video.fit` `config.pacing` 已删除——留着就是两个真相源，
而且会让每套风格观感一样。

### 两份技能，按触发时机拆

| 技能 | 管什么 | 何时加载 |
|---|---|---|
| `-explainer` | 怎么做片子：四段流程、审批闸协议、脚本与表演指导、风格契约 | 开始创作时 |
| `-usage` | 工具怎么表现：谁改状态、输入会被怎样规范化、错误码处置、重试语义、路径规则、与 dsh-comfyui 分工 | 遇到报错时 |

**拆分依据是触发条件不是主题。** 合成一份会让每次加载都为另一半付费。
`-usage` 那份可以当未来其他 OM→DSH 插件的模板。

**面向开发者与面向 Agent 的规则要分开写。** 同一次事故里，
「插件不能就地加工调用方数据」是开发规范（Agent 无法据以行动，写进技能是噪音），
「你提交的不等于落盘的，回读要用 `action: get`」才是 Agent 能用的版本。

---

## 四、M1 完成内容（2026-08-28）

### 风格 playbook（`src/playbooks.ts`）

一套 playbook 管：`visual`（提示词前后缀 / 负向提示词 / 一致性锚点）·
`narration`（语气 / 语速档 / **字每秒**）· `pacing`（段前后留白 / 单段时长上下限）·
`kenBurns` / `fit` / `subtitleMaxChars` · `quality_rules`。

内置三套：`clean-tech`（清晰科技）· `warm-doc`（温暖纪实）· `flat-brief`（扁平快讲）。
自定义走 `config.playbooks`，**同名整套替换，不做深合并**——半覆盖的调色板正是风格漂移的来源。

内置项写成 TypeScript 常量而不是 YAML 文件：随包分发、受类型检查、不需要 YAML 解析依赖。
自定义项是普通配置，用户在 cordis.yml 或设置页里编辑。

新增 `studio_project action: "style"`，返回可直接粘贴的提示词模板。

### 表演指导 + 样音闸

补回 OM 砍掉的 `delivery_cues.pause_before_seconds` / `pause_after_seconds`
（**这原本是个 bug**：skill 让 Agent 写这两个字段，schema 却不认，真写了会被拒）
和 `voice_performance.sample_section_id`。逐段停顿可覆盖风格的默认留白，compose 已实装。

`meta/voice-performance-director` 的五条写作规则搬进 skill，其中最管用的是**禁止空话**：
「自然」「有感染力」这类词除非配上具体 pace/emphasis/pause/energy，否则等于没写。

样音闸做成 assets 阶段内部的**第 0 批**（只跑 `sample_section_id` 那一段给用户听），
**不加状态段**——它是质量约束不是治理约束，加闸要动状态机。

### 设置页（host 注册 + client 渲染，两边都要）

**最关键的一条：`installSettingsSection` 只负责值的持久化与实时解析，不产生任何界面。**
这一点踩过（见第五节）。设置页需要两个半边配对：

| 半边 | 做什么 |
|---|---|
| host `installSettingsSection(ctx, 'studio', Config, entry, hooks)` | 注册命名空间、上报 schema、持久化用户增量 |
| client `slots.inject('settings.section', …)` id=`studio` | 侧栏一个条目 + 内容页。**没有它设置页里什么都不会出现** |

两边靠命名空间字符串配对，互不知道对方存在——这正是外部分发的插件也能有设置页的原因。

`cordis.yml` 的 entry 作为 base 层，设置页只写用户增量。注册在 `studio` 命名空间，`cordis.yml` 的 entry 作为 base 层，设置页只写用户增量。
所有配置项都加了中文 `.description()`——设置页渲染的就是 schemastery schema。

**关键设计：改动即时生效，不用重启。**

- `StateMachineDeps.workspaceRoot` 从 `string` 改成 `(): string`，每次调用时读。
  apply 时快照会导致改了项目根还在往旧目录写
- `resolved` 是配置的活视图，`onChange` 用 `Object.assign(resolved, source())` 就地覆盖，
  下游全部读它，不用告诉任何调用方「配置换了」
- **配置变更要重挂技能**：绑定表和风格契约是渲染进指令正文的，不重挂就会一直报旧工作流名

**client 面（约 550 行，5 个文件）**：`index.ts` 是注册表（M2 加界面只加条目）、
`scope.ts` 是命名空间句柄、`fields.ts` 把表单写成数据表、`settings.tsx` 是页面、
`styles.ts` 用宿主 `--dsw-alias-*` 主题变量。bundle 外部依赖只有 `react`——
服务全从 context 上取，一个平台值 import 都没有，纯度门天然满足。

**表单是暂存的，点保存才写。** settings 每次写入都是带版本围栏的持久化文档变更，
做成随敲随写的话，`workspaceRoot` 打到一半的路径就会变成项目根目录。
「已覆盖」标记看的是用户层里键的**存在性**，不是值——覆盖成和默认值一样也是覆盖。

**`@deepseek-ai/dsh-settings` 声明为普通 dependency，不是可选 peer。**
dsh-comfyui 用的是「可选 peer + 硬 import」，那在 GitHub 安装时会崩——pnpm 不装可选 peer。
这个包只是薄封装（`settingsNamespace` 返回校验过的字符串，`installSettingsSection`
只走 `ctx.inject(['settings'])`），**没有运行时身份**，多一份拷贝无害。

### M1 明确排除

reviewer 技能、成本追踪——推迟到 M2 之后。

---

## 五、踩过的坑（已归档，本节只留索引）

按 CLAUDE.md 的归档规矩，坑分两处记，**本文件不再重复正文**：

| 坑 | 记在哪 |
|---|---|
| 工具参数 deepFreeze，就地加工必炸 | SKILL.md §10.1 |
| `installSettingsSection` 只注册值不产生界面 | SKILL.md §10.2 |
| 设置页挂错位置（`settings.plugin.item` vs `settings.section`） | SKILL.md §10.3 |
| `conversation.send` 在 root 作用域抛错 | SKILL.md §10.4 |
| `dsh.client.inject` 不控制激活顺序 | SKILL.md §10.5 |
| 设置表单必须暂存不能随敲随写 | SKILL.md §10.6 |
| schemastery 的 `.default({})` 与 `z.dict()` | SKILL.md §10.7 |
| client bundle 纯度门 | SKILL.md §10.8 |
| 集成测试假绿（ComfyUI 命中缓存） | CONVENTIONS.md §2.1 |
| ComfyUI 调度：同类连着跑不要交替 | CONVENTIONS.md §2.2 |
| FFmpeg concat 段编码一致性 | CONVENTIONS.md §3.1 |
| zoompan 的 `d` 参数 | CONVENTIONS.md §3.2 |
| 路径穿越要在 schema 层拦 | CONVENTIONS.md §4.2 |
| 破坏性测试的顺序依赖 | CONVENTIONS.md §5.1 |
| 批量改文件要先断言锚点 | CONVENTIONS.md §6.1 |
| 插件目录迁移要同步四处 | CONVENTIONS.md §6.2 |

新踩的坑写进上面两处，不要写回本节——本节只维护这张索引。

---

## 六、实测数据

### 用户 ComfyUI 工作流库（`~/.dsh/data/dsh-comfyui/workflows.json`）

| 名称 | 参数 |
|---|---|
| `Qwen3-TTS(Text)` | prompt, seed, voice_name, "A or B", filename_prefix |
| `Qwen3-VoiceDesign` | seed, "A or B", language, reference_text, voice_instruction, character_name |
| `Krea-T2I-Afterlight` | seed, steps, width, height, prompt, `param_6`, batch_size |
| `KREA2-EDIT` | image, prompt, seed, steps, width, height（图生图） |
| `Minimax-H3-T2V` | prompt, duration, aspect_ratio, size, seed, steps（文生视频） |

`Qwen3-TTS(Text)` 的 `voice_name` 有 20 个选项。**注意其中
`Morgan_Freeman` / `Clint_Eastwood` / `David_Attenborough` 是真人音色，出片有肖像权与声音权风险。**
中文可用的只有 `shejian_narrator` / `tianmei_demo` / `yujie_demo` / `zh_man_sichuan` 四个，
没有一个是为「解说」设计的。

### 端到端实测（2026-08-28，真实 ComfyUI）

无 LLM 的集成测试 `test/integration-comfyui.mjs`：伪造 ctx 捕获三个 ToolDefinition，
直接调 `execute`，走真实 Qwen3-TTS + Krea-T2I。**22/22 通过**，产出 1280×720 / 19.9s 成品。

**真实中文语速：90 字 / 18.2 秒 = 4.95 字/秒**（分段 5.79 / 4.40 / 4.83）。
风格库里 `clean-tech` 取 4.9。

**风格一致性实测**：s1/s3 是摄影质感暗调渲染，s2 是扁平等距插画，明显跑偏——
因为 prompt 措辞不同。另 s3 出现乱码文字（prompt 里已写 `no text`），
负向提示词因此进了风格库。

---

## 七、待定决策

| # | 决策 | 状态 |
|---|---|---|
| 1 | ~~中文 TTS 工作流~~ | 已定：`Qwen3-TTS(Text)` |
| 2 | ~~插件包名与位置~~ | 已定：`dsh-creative-studio`，2026-08-29 从 `D:\` 移进本工作区（见「九、工作区合并」）|
| 3 | ~~工作流接入方式~~ | 已定：绑定表只给名称，参数去 list 查 |
| 4 | ~~输出目录~~ | 已定：`D:/AiStudio`，可在设置页改 |
| 5 | **解说音色** | 库里四个中文音色没有一个是为解说设计的，需要用 `Qwen3-VoiceDesign` 做一个 |
| 6 | **ComfyUI 显存** | M4 接视频生成时才卡脖子 |
| 7 | **角色动画去留** | `character_animation` 6 个自研工具，看是否做卡通内容 |
| 8 | **HyperFrames 去留** | 需 npm 包且实测 doctor 超时，M3 时评估维护成本 vs Remotion 是否够用 |
| 9 | **音乐/音效接入** | OM 的 `music_library` 是**用户本地曲库发现工具**，不该被 ComfyUI 收编——「生成音乐」和「用户自己的曲库」是两个 provider。值得抄的是它的时序规则：**本地已有素材要在决策点之前露出** |

---

## 八、M2 计划：创意工作台 + 工作室看板（2026-08-29 定稿）

> 面板命名规范：**创意工作台**（管线流程，`conversation.view`）· **工作室看板**（跨项目内容与数据，`shell.overlay`）。

### 设计转向：不是「对话流卡片」，是双面协同

第一版方案是纯对话流卡片（`tool.call.toolview` 按工具名挂）。**推翻了。**

理由：对话流适合 Agent——它要的是系统透明度和可操作性；**人要的是宏观引导层**，
一眼定位「走到哪、卡在哪、产物长什么样」。散文式的审批闸让人在看不见产物的情况下点头，
闸还在，把关的依据没了。

OM 的 Backlot 就是这个思路且是实现过的：`backlot/state.py` 715 行（`_build_stage_rail`
管线轨、`_build_storyboard` 分镜表、gate-skip 检测）+ `backlot/ui/board.js` 1142 行。

结论是**二者结合**：创意工作台做人类操作面，对话流卡片做 Agent 侧同步显示，两边写同一个状态机。

### 五个流程界面

界面数 = 状态机段数。每个界面把多个子步骤融合成**一个闸**，人在界面上点提交即通过。

| # | 界面 | 融合的子步骤 | 闸 | 核心组件 |
|---|---|---|---|---|
| 1 | **项目详情** | 初始化 · 风格选择 · brief | ★ | 表单 + 风格卡（调色板 / 提示词模板 / 一致性锚点） |
| 2 | **脚本** | script | ★ | **表格**：段号/时长/正文/配图提示词/表演指导，可编辑 + 校验标记 |
| 3 | **assets-audio** | 音色选择 · 试听 · 样音 · 批量配音 · 校对 | ★ | 音色选择器 + 播放器 + 配音列表（实测 vs 预估时长） |
| 4 | **assets-video** | 风格微调 · 试生成 · 批量配图 · 单张重做 | ★ | 参数条 + 配图网格（缩略图 + 提示词） |
| 5 | **时间线** | compose | | **时间轴**：段块 + 音频轨 + 字幕轨 → 成片播放器 |

**闸从 2 个变成 4 个**（原来只有 brief / script）。这是状态机的实质改动，不是纯 UI。

**样音闸消解**：并进 assets-audio 的单一闸，样音 + 全部配音一次通过。原先「样音在磁盘上无痕」
的问题随之作废，不需要新状态。

### 工作室看板（`shell.overlay`，独立于管线）

**定位不是「资产库」，是插件自己的工作台。** 挂在 `shell.overlay`（全框浮层，root 作用域），
和创意工作台并存：创意工作台管**一次生产的流程**，工作室看板管**跨会话、跨项目的全部内容与数据**。

M2 先只做**资产预览**这一块，但容器按面板设计，后面往里加页签而不是重做：

| 阶段 | 内容 |
|---|---|
| **M2 做** | 资产预览：项目 → 分类（音频/图片/视频）→ 段 → 版本的文件树 + 预览 + 下载 + 复制路径 |
| 后续可加 | 项目库（所有项目的卡片墙、进度、成片缩略图）· 风格库管理 · 生成历史与统计 · 工作流绑定体检 |

```
项目 A ── 音频 ── 01-s1.wav / 01-s1.v2.wav
       ├─ 图片 ── 01-s1.png
       ├─ 视频
       └─ 成片 ── projectA.mp4 / .srt
```

数据源是目录扫描，所以依赖下面的落盘规范。

**为什么它挂 root 而创意工作台挂 session**：工作室看板跨会话看全部产出，不需要往会话发消息；
创意工作台必须能提交给 Agent，而 `conversation.send` 在 root 作用域直接抛错（见下）。
两边各取所需，不是妥协。

### 落盘路径规范（命名权从 Agent 收回插件）

现在 `import` 收一个可选 `name`，Agent 传什么就叫什么，技能里的「请传 section id」是约定不是强制。
结果目录里可能是 `ComfyUI_00042_.png`，资产库读不出语义。

**规范落在 `import` 这一个入口**——它已经是素材进项目的唯一通道。参数改成
`{ source, kind, scene_id }`，文件名由插件算：

```
assets/audio/03-scene-3.wav        <序号>-<段id>[.v<n>].<扩展名>
assets/images/03-scene-3.v2.png    首版无后缀，重生成递增
output/<项目id>.mp4 / .srt
```

- 序号两位补零 → 目录里天然按播放顺序排
- 段 id → 资产库能反查是哪一段
- 版本号 → 重生成留痕，manifest 指向当前版本

**不做单独的导出流程。** `output/` 就是导出目录；资产库给「下载」和「复制路径」两个动作。

### 媒体路由（M2 唯一的一块新 host 服务代码）

```
GET /studio/media?project=<id>&path=<项目相对路径>
```

用现成的 `resolveInProject()` 挡路径穿越（已写好并测过）。同一条路由服务预览和下载，
只差 `Content-Disposition`；局域网访问同样走它。前端媒体组件参照 `D:\dsh-comfyui`
的 `src/client/lightbox.tsx`（68 行）重写——跨插件不能值导入。

### 管线驱动界面编排

管线不是「段的列表」，是**「界面的编排」**：

```ts
Pipeline = {
  id: 'explainer-stills',
  stages: [
    { id: 'brief',        screen: 'project',      gated: true  },
    { id: 'script',       screen: 'script',       gated: true  },
    { id: 'assets_audio', screen: 'assets-audio', gated: true  },
    { id: 'assets_video', screen: 'assets-video', gated: true  },
    { id: 'compose',      screen: 'timeline',     gated: false },
  ],
}
```

界面是**按类型注册的组件表**，管线只说用哪几个、什么顺序。播客管线复用 `project` + `script`，
换掉资产两段。M4 加管线时就是加一条配置，不是重做界面。

### 提交的双动作，与「单一写入口」到底指什么

面板的提交按钮做两件事：**① 推进状态 ② 通知 Agent 继续**。

「状态机只有一个写入口」不是说面板不能写，而是说**面板的写必须走 `StateMachine.write()`
这条同一路径**，不能直接改 `checkpoints/*.json`。走进去，schema 校验、资产存在性校验、
闸校验、前置校验一个都不少；绕过去，四类校验全失效，治理就废了。

所以提交按钮 → HTTP 路由 → `StateMachine.write()`，和 `studio_stage` 走同一个函数。

界面的**锁定规则**天然来自前置校验：前一段没 completed，后一个界面不可进入、不可点击。

---

### TODO

按能独立验证的顺序排，每一批做完都应该是可用状态。

**M2.0 状态机改造**（纯 host，无 UI，先做因为后面全依赖它）—— 除回归外已完成 2026-08-29

- [x] `STAGES` 拆成 5 段：`brief / script / assets_audio / assets_video / compose`
- [x] `GATED_STAGES` 扩到 4 个：brief · script · assets_audio · assets_video
- [x] `asset_manifest` 拆成两个产物，或加 `kind` 分区，让两段各自校验各自的覆盖率
- [x] `import` 参数 `name` → `scene_id`，文件名由插件按规范生成，含版本号递增
- [x] 技能同步：分批策略改成两段闸，删掉样音闸的单独描述
- [x] 测试：52 项全绿（原 48 + 4 项错段/闸校验）
- [x] 迁移后的 `moon-origin-test` 在五段机器下读取正确（五段 completed、四闸已批准、
      `next_stage: null`、两份 manifest 命名合规）
- [ ] **回归**：跑一次完整出片，确认拆段没破坏已验证的链路（需真实 ComfyUI）

**M2.1 数据面** ✅ 2026-08-29（`src/http.ts` + `src/routes.ts`，测试 70 项全绿）

- [x] `GET /studio/state?project=<id>` —— 管线轨 + 五段状态 + 全部产物 + 风格 playbook + 成片 URL
- [x] `GET /studio/media?project&path` —— 预览与下载，支持 `Range`（206）让播放器能拖动；越界返回 400 `BAD_PATH`
- [x] `GET /studio/library` —— 按介质分组（音频/图片/视频/成片），非按目录，所以将来出视频素材自动多一组
- [x] `POST /studio/stage` —— 面板提交，走 `StateMachine.write()`；同源校验；违规码映射成 400/404/409
- [ ] 提交后通知 Agent：`ctx.conversation.send(text)`（inject `'conversation'`）—— 属客户端，M2.2 做

**M2.2 面板骨架**

- [ ] 创意工作台挂 `conversation.view`（会话视图 tab 环，新 id + label）
- [ ] 工作室看板挂 `shell.overlay`（全框浮层，新 id），M2 只放资产预览页签
- [ ] 管线轨组件：5 段 + 当前位置 + 闸状态 + 锁定态
- [ ] 界面路由：按 `Pipeline.stages[].screen` 分发到组件表
- [ ] 媒体组件（图 / 音 / 视频 / lightbox），参照 dsh-comfyui 重写

**M2.3 五个界面**（逐个做，每个做完能单独验证）

- [ ] 项目详情 · [ ] 脚本表格 · [ ] assets-audio · [ ] assets-video · [ ] 时间线

**M2.4 工作室看板（M2 只做资产预览页签）**

- [ ] `shell.overlay` 面板容器 + 页签框架（后续加页签不重做）
- [ ] 资产预览：文件树 + 预览 + 下载 + 复制路径

**M2.5 对话流卡片**（原方案保留为 Agent 侧同步显示）

- [ ] `tool.call.toolview` key=`studio_stage`：闸口大卡 / 其余一行，从 `argsRaw` 渲染
- [x] `tool.call.toolview` key=`studio_compose` / `studio_show`：通用媒体卡 ✅ 2026-08-31

### 开工前的三件事（2026-08-29 全部已定）

1. **面板挂在哪** —— 创意工作台 `conversation.view`（session 作用域，能 `send`）；
   工作室看板 `shell.overlay`（root 作用域，跨会话看产出）。**依据是下面第 2 条的作用域约束。**

2. **面板提交后怎么通知 Agent** —— `ctx.conversation.send(text)`，走的是和输入框同一条
   `session.prompt([{type:'text',text}], 'queue')`（`packages/client/ui-conversation/src/client/service.ts:143`）。
   `'queue'` 排队等 Agent 空闲；`'steer'` 会打断，面板提交不该用。

   **硬约束**：`scopeId()` 在 root 作用域直接抛
   `conversation.send requires a session scope`（同文件 :332）。所以要提交的面板
   必须在 session 作用域里——这条把创意工作台的挂载点判死了。

3. **`moon-origin-test` 兼容** —— **已迁移完成**（2026-08-29）。6 个素材按新规范重命名
   （`s1.wav` → `01-s1.wav`），manifest 按类型拆成 audio/video 两份，`assets.json`
   拆成 `assets_audio.json` + `assets_video.json` 且都补回 `human_approved: true`，
   旧文件归档进 `checkpoints/history/`。备份 `moon-origin-test.bak-20260829-181509`，
   M2.0 验证通过后可删。

   它现在是 **M2 面板开发的样本数据**——空工作区里五个界面全是空的，看不出表格和时间线画得对不对。

### 参考

- `dsh-creative-studio/docs/PLUGIN_DEVELOPMENT.md` —— **挑位之前先查这份**。
  48 个挂载点全表、三档风险标记、设置页三条注入路径决策表、注册检查表
- `OpenMontage/backlot/` —— 同思路的可运行实现：`state.py` 的 `_build_stage_rail` /
  `_build_storyboard`，`ui/board.js` 的界面
- `D:\dsh-comfyui\src\client\` —— 可运行的双面插件参照，媒体组件在 `lightbox.tsx`

## 九、工作区合并（2026-08-29）

插件原来在 `D:\dsh-creative-studio`，与规划工作区分居两处：两套文档、两份 codegraph 索引、
两个会话上下文，看一眼设计再改一行代码要跨目录。已合并成一个根：
插件整体移进 `d:\dev-projects\Ai-CreativityStudio\dsh-creative-studio`。

**为什么是把插件搬进来，不是反过来**——插件是要发布的包（`files` 白名单 + `github:` 安装路径），
把 121 工具分析、几 MB HTML 和 OM 上游克隆塞进去会污染它；而且会话历史与 memory 的 key 是
工作区路径 `d--dev-projects-Ai-CreativityStudio`，反向搬会让它们全部作废。

**接线改了四处**（`~/.dsh/profiles/web/`）：

| 位置 | 改成 |
|---|---|
| `package.json` 依赖 | `link:D:/dev-projects/Ai-CreativityStudio/dsh-creative-studio` |
| `pnpm-lock.yaml` | 同上（specifier 与 version 两行）|
| `node_modules/.package-map.json` | `link:` 与 `file:///` 两个值 |
| `node_modules/dsh-creative-studio` | 重建为指向新路径的**原生**符号链接（`MSYS=winsymlinks:nativestrict ln -s`）|

pnpm 的包用硬链接指向全局 store，同盘 `mv` 不影响 `node_modules`，无需重装。
插件目录里的 `.codegraph/codegraph.db` 存绝对路径，移动后重新索引。

**留下的一个代价**：将来若要把整个工作区做成一个 git 仓库，插件会是嵌套仓库，
届时二选一——用 submodule，或工作区本身不 git 化、只在插件目录里 `git init`。

---

## 十、成片环节收尾（2026-08-31）

### 通用媒体回显：`studio_show` + 一张卡

**问题**：Agent 能造出媒体，却没有任何办法把它放到人眼前。
先前只有 dsh-comfyui 的卡片，绑死在它自己的产物上。

**做法**：新增第四个工具 `studio_show`（project + paths + note），
只做一件事——把项目里**已存在**的文件解析成 `/studio/media` URL 交给卡片。
不生成、不导入、不落盘。路径穿越和不存在的文件都在 host 侧拒掉。

卡片挂 `tool.call.toolview`，两个 key 共用一个组件：`studio_show` 和 `studio_compose`——
**成片自己就该显示自己，不该等人再要一次**。

关键契约：卡片只读 `presentationMeta`，**从不解析渲染文本**。
文本是给 transcript 和模型读的，卡片是给人看的，两条通道各自承载同一件事；
把散文当数据会把卡片绑死在为模型措辞的字句上。

`mediaUrl()` 从 `routes.ts` 提到 `http.ts`，因为现在两个调用方（路由、工具）都要拼它——
一份拼法，路由改了不会留下指向空处的卡片。测试直接断言两边同一个函数的输出相等。

**逐格验过渲染分支**（2026-08-31 补）。第一版四类里只有三类真回显：
`.srt` / `.vtt` / `.json` 掉进 `<a>` 兜底，成了「只贴 URL」——**而字幕恰恰最该当场看**。
`MediaKind` 加了 `text`，卡片给它 `<pre>` 内联预览（256 KB 上限，超了给下载）；
扩展名表补齐 ComfyUI 真会吐的格式（avif / apng / bmp / tiff / m4v / avi / aac / oga / weba 等）。
每张卡片的标题栏统一加了 `↓`——**看见和留下是两件事，预览只答了一件**。

测试不再只断言 payload，而是真调组件看吐出什么标签
（`test/render.mjs`，桩 dispatcher，不引 `react-dom`）：14 种格式逐个过，
表里出现 `a` 即失败。归档为 CONVENTIONS 5.3。

### 成片环节的双模式

**用户的判断**：合成不是终点。编辑之所以放在这里，是因为**只有音画同步时才能判断一个停顿**，
而这个判断不会因为 ffmpeg 跑过一次就失效。所以渲染是一个**模式**，不是目的地。

- 有成片时默认进「成片」模式——打开一个已出片的项目，多半就是想看
- 「编辑」切回本地预览，可以接着调，也可以另存一版
- 两个播放器各有各的时钟，`<video>` 在编辑态是卸载的，
  所以播放位置**用 ref 交接**（`handover`），切过去从原地继续，读起来才是一个界面
- 任何一次 `editSection` 自动离开成片模式——屏幕上那份渲染已经和正在编辑的东西不符了，
  留在它上面会让改动看起来毫无效果
- 编辑态且存在旧成片时，画面左上角挂一条 `编辑中 · 成片还是上一次合成的`

### 两次 `SCHEMA INVALID` 的返工

Agent 记录 compose 时连着两次校验失败，都是**重新拼装 render_report** 造成的。
根因不在 Agent：skill 说了「原样交上去」却没给字段表，
而「原样」对一个手里只有摘要的 Agent 来说是有解释空间的。
已在 skill 的 compose 段补完整字段表（顶层五键、每 output 八键、哪四个必填），
并把「原样」写死成不留余地的话。归档为 CONVENTIONS 4.4。

面板发给 Agent 的合成提示语同步收紧，并追加一句「记完用 `studio_show` 把成片带进对话」。

测试 130 → 136。


### 逐格验过回显分支

第一版四类只有三类是真回显：`.srt` / `.vtt` / `.json` 掉进 `<a>` 兜底，成了「只贴 URL」——
**而字幕恰恰是最该当场扫一眼的东西**。

- `MediaKind` 加 `text`，卡片给它 `<pre>` 内联预览（256 KB 上限，超了给下载）
- 扩展名表补齐 ComfyUI / ffmpeg 真会吐的格式：
  avif / apng / bmp / tiff / jfif、m4v / avi / mpeg、aac / oga / weba
- 每张卡的标题栏统一加 `↓`——**看见和留下是两件事，预览只答了一件**

测试不再只断言 payload，而是真调组件看吐出什么标签
（`test/render.mjs`，桩 dispatcher 跑首屏，**不引 `react-dom`**——bundle 只允许 import `react`）。
14 种格式逐个过，表里出现 `a` 即失败。归档为 CONVENTIONS 5.3。

顺带确认播放器可拖进度：`/studio/media` 有 `accept-ranges: bytes` + 206 + `content-range`。

测试 136 → **141**。

---

## 十一、图文解说管线：最小链路完成（2026-08-31）

`explainer-stills` 从立项到成片的 UI 和功能**已经全线跑通**。
五个界面各自能用，五段状态机真的会拦，成片能出、能编辑、能存版本、能回显。

**下一步是收束这条管线**，不是铺新的。收束清单见 §十二。

### 移植蓝图

顺手做了一份对照表：**[docs/om-05-blueprint.md](docs/om-05-blueprint.md)**。
逐项列出 OM 的 13 条管线 / 20 份 schema / 150 份导演指令 / 19 个引擎模块 / 121 个工具，
对照我们迁移了什么、有意不迁什么、还差什么，并按价值排了优先级。

蓝图里最要紧的一条发现——**我们正用着 OM 明确废弃的做法**：

> `shot_prompt_builder.py` 的文件注释：*"This replaces the old approach of prepending a
> fixed playbook `image_prompt_prefix` to every scene description, which made all scenes
> look the same."*

我们的 `renderVisualContract()` 就是 `prefix + 本段描述 + suffix`。
OM 已经踩过并给出了 5 层框架（镜头 / 运动 / 主体 / 光线 / 风格）。
配套还有两道我们没有的质量闸：`variation_checker`（生成前查重复）、
`slideshow_risk`（合成前六维打分，≥ 4.0 不许出片）。

> 这三个连起来是同一件事：**防止「一堆好看但雷同的图 + 旁白」**。
> 而这恰好是 `explainer-stills` 唯一的失败模式。

### 已确认的其他缺口

- `target_platform` 只做了 schema 校验，**不影响出片**——竖屏需求会出成横屏
  （`config.ts` 的 width/height 是全局默认值，对应 OM 的 `media_profiles.py`）
- `scene_plan` 没有独立 schema，藏在 marker 的 `shot_plan` 里，不受四层检验保护
- 四层检验缺第四层：有 schema / 资产存在 / 闸 / 前置，**没有品质**（OM 的 `meta/reviewer`）

---

## 十二、下一步：收束图文解说管线

明天做的是**这条管线的收束**，不是加管线。候选（按蓝图优先级）：

| | 事项 | 出处 |
|---|---|---|
| **0** | **`scene_plan` 独立成产物，带 `shot_language` 枚举** | `scene_plan.schema.json` |
| 1 | 提示词分层：5 层镜头语言替代固定前后缀 | `shot_prompt_builder.py` |
| 2 | 生成前的分镜重复度检查 | `variation_checker.py` |
| 3 | 合成前的幻灯片风险闸 | `slideshow_risk.py` |
| 4 | `reviewer` 品质检验（四层检验的第四层） | `skills/meta/reviewer.md` |
| 5 | 平台档位生效（画幅 / 分辨率跟着 `target_platform` 走） | `media_profiles.py` |

> **0 是 1–3 的前置**（2026-08-31 修正）：`build_shot_prompt` / `check_scene_variation` /
> `score_slideshow_risk` 的入参全部来自 scene_plan 的 `shot_language`
> （`shot_size` / `camera_movement` / `lens_mm` / `lighting_key` / `color_temperature` /
> `depth_of_field` 六组枚举）。我们现在只有 `script.visual` 三个自由文本
> 和 marker 里的 `shot_plan`——**5 层里有 4 层的输入没地方存**。

还有一批**已知但没归档为待办**的细节调整，明天一并过一遍。

### 仍然挂着的旧项

- `工作室看板`（`shell.overlay` + 资产浏览器）——设计定了，没动工
- `tool.call.toolview` 给 `studio_stage` 的审批卡（M2.5）
- 音色候选快照回填到项目 marker
- 打包批量配音（用户判断「目前没那个必要」）

---

## 十三、两个数据层缺口补齐（2026-08-31 深夜）

明天要做的 1–3 全部读 scene_plan，所以先把地基补上。**只动数据层，不动界面形态。**

### 缺口 A：`scene_plan` 成为真产物

`shot_plan` 原本挂在项目 marker 上——不是 artifact，不过 schema 校验，
也没有地方放镜头语言。现在它是 `assets_shots` 阶段的**第二份产物**。

```
STAGE_ARTIFACT  一阶段一产物，回答「这段完成与否看哪份」——保持不变
ARTIFACT_STAGE  产物归属哪段，scene_plan → assets_shots——新增
```

> **为什么 `scene_plan` 不进 `STAGE_ARTIFACT`**：那张表回答的是「这一段完成与否看哪份产物」。
> 一段的完成标准是**图出来了**，不是**想好了**。计划不该替图作证。

- **不走闸，但过 schema**。闸看的是结果，计划不是结果；
  但它存在的全部意义就是被代码读，所以形状必须硬
- 新增受限写入口 `machine.writePlan()`，**只允许 `PLAN_ARTIFACTS` 里的产物**。
  这条限制是重点——没有它，第二条写入路径就成了绕过闸和资产校验的后门。
  测试里钉死了：拿它写 manifest 会被拒
- `shot_language` 六组枚举**逐值照抄 OM**（`shot_size` 10 / `camera_movement` 18 /
  `lens_mm` 7 / `lighting_key` 11 / `color_temperature` 4 / `depth_of_field` 3），
  这样移植 `shot_prompt_builder` 是直译而不是重新设计
- 校验含两条结构规则：**同段 `shot_index` 必须 0..n-1 无跳号无重号**、**`id` 不得重复**

#### 迁移与兼容，三层

1. `project.shot_plan` 变成**视图**，从 scene_plan 投影，界面读法不变
2. 旧项目首次保存时，`fromMarkerPlan()` 把 marker 上的计划整体提上来
3. **`/studio/project` 不再接受 `shot_plan` 写入**——留着就是两个真相来源，
   而 marker 那份没有校验管着它

#### 一条容易踩的契约，已用测试钉住

保存按**位置合并**，未提及的字段原样保留。
今天的分镜页没有镜头语言的输入框，如果保存时按「传什么存什么」来做，
**明天加上下拉框之前，每存一次盘就把镜头语言抹一次**。
测试 `saving without shot_language keeps the shot_language already stored` 就是防这个。

### 缺口 B：`target_platform` 真的决定画幅

原本只有 schema 校验，出片尺寸一律取 `config.video`。选「抖音」出 1920×1080。

新增 `src/media-profile.ts`：

| platform | 画幅 |
|---|---|
| youtube / bilibili | 1920×1080 |
| douyin / wechat | 1080×1920 |
| xiaohongshu | 1080×1440（3:4，笔记流的实际比例） |
| generic | 交回设置 |

- **规则**：具名平台定画幅，`generic` 交回设置。
  想用自己的尺寸就选 `generic`——这条比「设置优先」更好解释，也不会让「我说了抖音」出横屏
- **fps 不跟平台走**。它是画质设置，用户可能特意调过；而且所有档位本来都是 30
- 解析结果**每次都写进 warnings**。静默换画幅正是这次要修的病，
  在上一层重演一遍就白修了
- 落点在 `renderProject` 顶部一次性算出，然后**遮蔽 `config`**——
  下游全部照旧读 `config.video`，避免同一个数字有两个来源

测试 141 → **151**。

### 缺口 B 的前端：立项页的投放平台

数据层跑通后补上入口。`target_platform` 现在和 `style` / `target_duration_seconds`
走同一个模式：**marker 与 brief 各存一份，marker 优先**。

- marker 上有它，因为面板要在 brief 存在之前就能选；
  brief 里也有它，因为 Agent 写简报时会填。渲染时 `marker ?? brief`——
  **用户自己点的那份说了算**
- 路由**校验**平台值，不是照单收下：画幅是从它算出来的，
  拼错一个字母会静默出错画幅
- 下拉框的提示文字跟着**下拉框**走而不是已保存值，和风格预览同一条规则——
  否则它描述的是用户正要离开的选项

#### 三份清单，一处漂移就静默出错

平台名现在有三个地方各写一遍：schema 的 `PLATFORMS`（校验）、
`media-profile.ts` 的档位表（渲染）、`api.ts` 的 `PLATFORM_FRAMES`（下拉框）。
编译期没有任何东西把它们连起来，而每一种漂移都不会报错：

- 下拉框多一个 schema 不认的值 → 用户选了，保存 400
- 下拉框少一个 → 那个平台再也选不到
- 提示文字写 9:16 但档位表是 3:4 → 界面撒谎

所以测试直接**从构建产物里正则捞出下拉框的清单**和另外两份比对，
并逐项验证「提示的画幅 == 渲染的画幅」。
故意删掉小红书跑了一次，确认会 FAIL 才留下。

测试 151 → **156**。

---

## 十四、五层提示引擎（2026-09-01）

`src/prompt.ts`。OM 的 `shot_prompt_builder.py` 移植，短语表逐值照抄。

### 拆的是什么

我们的 playbook 后缀长这样：

```
, soft even lighting, generous negative space, centered composition, 16:9
```

**`soft even lighting` 是第 4 层，`centered composition` 是第 2 层**——
两个本该逐镜决定的东西被写死成每张图都一样。雷同的机制就在我们自己的数据里。
（顺带：`16:9` 现在是**错的**，画幅跟着 `target_platform` 走，可能是竖屏。）

所以拆成两半：

| 原来在哪 | 现在在哪 | 性质 |
|---|---|---|
| 前缀里的媒介与配色 | `visual.style_hint` | 第 5 层，**固定** |
| 后缀里的光线 / 景深 / 构图 | `visual.shot_defaults` | **默认值**，逐镜可覆盖 |
| 后缀里的 `16:9` | 删掉 | 画幅归 `target_platform` |

> **关键区别：playbook 从「命令」变成「偏好」。**
> 房子的风格还在，但「这个风格偏好暖光」和「这一镜是夜戏」不再冲突——后者赢。

### 实测效果

同样三镜，共享词占比：

```
旧（前后缀）  84%
新（5 层）    53%
```

测试里钉的就是这个数（阈值 60%），不是「看起来不一样」这种说不清的断言。

### 一个默认值不该有的默认值

第一版给 clean-tech 默认了 `shot_size: 'medium'`。
OM 对 `medium` 的短语是 **"medium shot from waist up"**——
「从腰部往上」对一条机房走廊是错的，那个短语默认画面里有人。

改成**不默认镜别**：没意见就不出这一层。沉默好过错话，而且能逼人去填。

### 提示词不再交给 Agent 拼

- `/studio/state` 新增 `prompts`（派生字段，**不在 `artifacts` 里**——那些要原样回传）
- 分镜页发给 Agent 的消息从「风格前缀 + 主体 + 风格后缀」改成**直接给拼好的整条**
- `renderVisualContract()` 不再输出模板，改成说明「你只需要决定拍什么 + 镜头语言」
- 分镜页加了六个下拉框和一个分层预览（每层一个 chip，继承自风格的用虚线框）

### 两次测试自身的错误，都值得记

**其一**：断言「短语不含枚举词」。错的——`wide` 的正确短语就是
`wide shot capturing full scene`，本来就含 `wide`。真正要防的是**落到裸枚举兜底**。

**其二**（更隐蔽）：改成查「层文本 == 裸枚举」后，我删掉 `rim_lit` 的短语验证，
**测试仍然通过**。因为 clean-tech 默认了 `color_temperature`，
把第 4 层填成了非空——**默认值把缺失掩盖了**。
改成用无默认值的 playbook 构建后才真的报错。

> **一个能被默认值掩盖的守卫不是守卫。**
> 验证测试有没有牙，必须在**没有任何回退**的条件下做。

### 顺带发现

我一直手敲 `npx tsc -p tsconfig.json --noEmit`，那**只检查 host**——
`tsconfig.json` 里 `exclude: ["src/client"]`。
项目本来就有 `tsconfig.client.json`，`npm run typecheck` 两个都跑。
用对命令后立刻冒出四个 client 类型错误。**以后一律 `npm run typecheck`。**

测试 156 → **168**。

---

## 十五、两道质量闸（2026-09-01）

### `variation.ts` —— 生成前查重（**只提示**）

OM 八项检查，**两项没有照搬**：

- `static shot overuse`（40% 镜头要有运镜）——我们出静帧，运动是合成时按风格加的 Ken Burns。
  照搬就是**每份计划都报一条假警**，而常亮的警告等于没有警告
- `shot_intent`（每镜要说明为什么存在）——每一镜都贴着一句解说词，那就是答案。
  再加一个字段只会为了过检查而填

**补了一项 OM 没有的：主体重复。** 我们一条工作流、一句风格，
两镜写同一句话就是两张同一张图。OM 分散在多个供应商上，从来不用先看这个。

新增 `hero_moment` 字段（分镜页一个 ★ 开关）——OM 的 schema 里有，
「全片没有一个画面顶点」是别的指标都看不出来的那种平。

面板在**生成按钮上方**显示，可点击跳到出问题的那一镜。

### `slideshow.ts` —— 出片前打分（**真的会拦**）

OM 六个维度，**三个在静帧管线上没有数据**。照搬会变成三个常数项，
把平均分稀释成噪音，还显得很周全。换掉的理由逐条写在文件头：

| OM | 我们 | 为什么 |
|---|---|---|
| `weak_shot_intent` + 半个 `decorative_visuals` | `decorative_visuals` | 没有 `shot_intent`；改问「有没有人为这一镜做过任何决定」 |
| `weak_motion` | `static_hold` | 静帧没有运镜；改问「一张画面被要求撑多久」 |
| `typography_overreliance` | `picture_rate` | 没有文字卡；改问「每分钟几张画面」 |

`static_hold` 会读 `playbook.kenBurns`——**关掉 Ken Burns 的风格必须剪得更快**，
阈值降到 60%。

#### 拦截规则不是只看平均分

**测试逼出来的一个真问题。** 最初照 OM 写成 `average >= 4`，
结果一部「重复 5、无人决策 5、停留过长 5」的片子平均只有 3.5，**放行**。

> 平均数会掩盖「多个独立指标同时报警」。
> 三个维度全打满、两个正常，平均才 3.0——而每一项看过它的指标都说它是幻灯片。

改成 **平均 ≥ 4 **或者** 过半维度各自 ≥ 4**。
几个独立测量同时失败，比它们的均值更有说服力。

#### 拦的是模型，不是人

`QUALITY_VIOLATION` 是第五类检验——前四类（schema / 资产 / 闸 / 前置）都关于结构，
这一类关于品质，也是**唯一可以推翻的**：`force: true`。

- skill 里写死：**只有用户看过分数并明确要求时才带 force**
- 面板在成片页显示分数，拦截时给一个「我看过了，照出」的勾选框，
  勾了才在给 Agent 的提示里加那句话
- 强制出片会在 warnings 里留痕

**人推不翻的治理不是治理，是墙。**

### 测试里两次「不是代码错，是测试错」

**其一**：断言「短语不含枚举词」——`wide` 的正确短语本来就含 `wide`。

**其二**（更值得记）：想验证闸会拦，结果 smoke 项目是一部 **13 秒 3 镜的快片**，
**它本来就不可能是幻灯片**，怎么改计划都拦不住。
不是闸坏了，是测试条件不成立。
最后用一个「自称电影感 + 关掉 Ken Burns + 段落上限 2 秒」的自定义 playbook——
真实配置，不是桩——才让这份素材真的得了低分。
（顺带发现 config schema 自己拦住了 `maxSectionSeconds: 1`，守卫在起作用。）

测试 176 → **186**。

---

## 十六、三处补漏 + 自审协议（2026-09-01）

### 补漏一：Agent 根本看不到 variation

**我上一轮留下的真漏洞。** skill 里写着「结果在 `/studio/state` 的 `variation` 里」——
**Agent 调不了 HTTP 路由**。对它来说这道检查等于不存在，
它会一路走到 compose 被 slideshow 拦下才知道出事，而那时图已经全生成完了，
**正好错过这道检查存在的全部意义**。

修法：`studio_stage` 在提交内容含 `scene_plan` 时**把报告一并返回**，
并且写进 render 出来的文本里（Agent 读的是文本，不是 payload）。
不用新工具、不用轮询——你刚写完计划，这就是它哪儿重了。

顺带：`studio_project action: "get"` 的枚举里补上 `scene_plan`，
Agent 之前连自己写的计划都读不回来。

### 补漏二：节奏问题藏到了花钱之后

`static_hold` 和 `picture_rate` **生成之前就能算**——配音已经有了，时间轴是确定的。
但它们只显示在成片页，等于把「这片子太慢」藏到图都生成完之后。

分镜页的横幅现在也显示这两项（**只显示不拦**，拦仍然在 compose）。
条件同步改成「variation 或 pacing 任一有话说就出现」——
原来只看 variation，**一份画面很多样但节奏像幻灯片的计划会完全不提示**。

### 自审协议 `skill-reviewer.ts`

第一梯队最后一项。它是**指令不是代码**——OM 自己也这么选，
理由写在它的文件里：「replaces the Python reviewer class with an
instruction-driven self-review protocol」。函数能数颜色，数不出第三段无聊。

#### 移植时最重要的一条判断：只留代码查不到的

OM 的 `success_criteria` 里大半我们**已经用代码强制了**——
schema、文件存在、覆盖完整、管线顺序。照搬会得到一个
**把注意力花在重新推导已知事实上的评审**。

所以 `review_focus` 只写判断题，19 条，一条都不是数出来的。最典型的：

> **「每张图和它那句解说对得上」—— 这是代码永远看不到的一条。**

skill 开头专门列了一张「你不用查的东西」表，指名道姓说这五类已经有人管了。

#### 从 OM 整段搬过来的：CHAI 三条

OM 引了一项研究，说评审质量沿这三个轴直接决定下游产出质量。真正起作用的是第三条：

> **提不出改法的 critical 降级成 `investigation`。**

没有这条，评审就退化成一张抱怨清单。

还搬了：四级严重度（critical / suggestion / nitpick / investigation）、
**两轮封顶**（「目标是出片，不是完美」）、决策表。

#### 交付时机

`review_focus` 挂在管线定义上，`studio_project action: "status"`
**返回下一段的审查重点**并渲染进文本——
事后读到的审查重点是复盘，事前读到才是任务书。

skill 里的分段清单**从管线定义渲染**，两处不会漂移（有测试比对 19 条全覆盖）。

测试 191 → **198**。

---

## 十七、第一梯队完成，下一步

蓝图第一梯队 0–4 **全部完成**：

| | | |
|---|---|---|
| 0 | `scene_plan` 独立成产物 | 08-31 |
| 1 | 5 层提示引擎 | 09-01，共享词 84% → 53% |
| 2 | 分镜重复度（提示） | 09-01 |
| 3 | 幻灯片风险闸（拦截） | 09-01 |
| 4 | 自审协议 | 09-01 |

四层检验现在是**五层**：schema / 资产存在 / 闸 / 前置 / **品质**。
最后一层里，能算的用代码（variation + slideshow），
算不了的用指令（reviewer）——**分界线就是「这个问题能不能数出来」**。

### 记在这里，别忘了

**两套检查目前是图文解说的特化版本，而且没有留切换的接缝。**
`variation.ts` / `slideshow.ts` 在 routes 和 tools 里是无条件调用的，不看管线 id。
三处特化点：`static_hold`（假设静帧 + Ken Burns）、`picture_rate`（假设一镜一图）、
跳过的两项 OM 检查（运镜、shot_intent）。

**上第二条管线时必须一起做**：给 `PipelineStage` 加 `checks` 字段，让检查集跟着管线走。
等到第三条就晚了。已写进蓝图第三梯队。

### 一个已知的能力边界

这两道检查**不看图**。全部是对计划文本和结构做统计——
比例阈值、枚举分布、字符串比对、时间轴算术。零像素，零模型调用。

**它保证「你确实为每一镜做了不同的决定」，不保证「模型照做了」。**
LoRA 压过提示词照样能出十张同款，检查看不见。

真要看图，路子是**对生成的图算感知哈希（dHash/pHash）两两比汉明距离**——
不要模型、不要 GPU，ffmpeg 取帧就够，十张图四十五次比对毫秒级。
OM 也没有这个（它的 `clip_embedder.py` 是素材检索用的）。**待定。**

---

## 十八、明天的验收清单（2026-09-01 收尾）

> 全部改动**只验到构建和测试层，没在浏览器里看过**。下面按管线顺序走一遍即可。
> 201 项测试全绿，`npm run typecheck` 两份 tsconfig 都过。

### 引擎落在管线的哪个位置

```
立项 ────────► 脚本 ──► 配音 ──► 分镜 ──────────────► 成片
 │                                │                    │
 │ 投放平台                        │ ① variation 提示    │ ② slideshow 拦截
 │ （决定画幅）                     │ ② slideshow 的两项  │ ③ force 覆盖
 │                                │   （只显示不拦）     │
 └──────────── ④ 自审重点：每一段提交前都有 ───────────┘
```

| 引擎 | 算在哪 | 给谁看 | 拦不拦 |
|---|---|---|---|
| **5 层提示引擎** | `/studio/state` 每次读 | 分镜页「最终提示词」分层 chip；发给 Agent 的生成请求 | —— |
| **variation** | `/studio/state` + `studio_stage` 提交 `scene_plan` 时 | 分镜页横幅（生成按钮上方）；Agent 的工具返回 | 不拦 |
| **slideshow** | `/studio/state` + `studio_compose` 执行时 | 分镜页只显示节奏两项；成片页显示全部 | **拦**，`force` 可覆盖 |
| **reviewer** | 无计算，是 skill | Agent；`studio_project action:"status"` 返回下一段重点 | 不拦 |
| **平台画幅** | `studio_compose` 执行时 | 立项页下拉；compose 的 warnings | —— |

---

### 人工验收，按顺序

#### 0. 起手

重启 DSH。设置页「AI 创意工作室」应能打开，工作流绑定还在。

#### 1. 立项页 —— 投放平台

- [ ] 「风格」上方多了 **「投放平台」** 下拉，6 个选项各自标着画幅
- [ ] 选「抖音 — 1080×1920 竖屏 9:16」，下方提示同步变化，并显示「（预览中，保存后生效）」
- [ ] 保存后提示语里的「预览中」消失
- [ ] **最终验证放在最后一步**：出片后看视频尺寸是不是 1080×1920

#### 2. 分镜页 —— 三样新东西

**镜头语言（六个下拉）**
- [ ] 「画面」输入框下方出现六个小下拉：镜别 / 焦段 / 景深 / 光线 / 色温 / 运动
- [ ] 未选时显示「跟风格（xxx）」，斜体灰色；选了之后变正常颜色
- [ ] 改一个 → 应立刻保存（下方出现「镜头语言已保存」）
- [ ] **刷新页面后仍在**（这是数据层是否真落盘的检验）

**★ 高光开关**（← 今天最后发现并修掉的 bug，重点看这个）
- [ ] 点「☆ 高光」变成「★ 高光」，按钮变金色
- [ ] **刷新后仍是 ★**
- [ ] 再点一次能取消回 ☆，**刷新后仍是 ☆**

**最终提示词预览**
- [ ] 出现「最终提示词」一行，内容是**多个 chip**而不是一整条
- [ ] 来自风格默认的 chip 是**虚线框**，自己选的是实心底
- [ ] 改镜头语言后 chip 跟着变

#### 3. 分镜页 —— variation 横幅

先故意做坏：**给两镜写一模一样的画面**，另外几镜留空。

- [ ] 「全部生成」按钮**上方**出现横幅
- [ ] 显示「重复度高 / 建议再调 x.x / 5」
- [ ] 点「看看哪儿重了」展开逐条
- [ ] 条目后面有镜号小胶囊，**点它能跳到那一镜**
- [ ] 把重复的改掉 → 横幅条目减少或消失

#### 4. 分镜页 —— 节奏提示

- [ ] 若片子很慢（每分钟不到 6 张），横幅里应多出「每分钟 x.x 张画面，太少了」
- [ ] variation 干净但节奏慢时，横幅**仍然出现**，标题显示「节奏偏慢」，按钮文案是「看看慢在哪」

#### 5. 生成请求

- [ ] 点「全部生成」，看发给 Agent 的消息
- [ ] 里面应是**每镜一整条拼好的提示词**，不再有「风格前缀 / 风格后缀」两行
- [ ] 提示词里**不应出现 16:9**

#### 6. Agent 侧

- [ ] Agent 写 `scene_plan` 后，工具返回里应带「分镜重复度 x.x/5」并逐条列出
- [ ] 让 Agent 调 `studio_project action:"status"`，返回文本末尾应有「自审重点（下一段）」清单
- [ ] Agent 现在能 `action:"get"` 读 `scene_plan`

#### 7. 成片页 —— 幻灯片风险

- [ ] 分数低时**不显示**任何横幅（正常情况应该看不到）
- [ ] 用一份很差的计划时出现横幅，列出得分 ≥ 2 的维度
- [ ] 拦截时出现「我看过了，照出」勾选框
- [ ] 不勾直接合成 → Agent 会收到 `QUALITY VIOLATION`，说明分数和去哪儿改
- [ ] 勾上再合成 → 出片成功，warnings 里有「用户要求强制出片」

#### 8. 回到第 1 步的尾巴

- [ ] 成片是 **1080×1920 竖屏**
- [ ] compose 的 warnings 里有「画幅按 target_platform=douyin 出片」

---

### 最可能出问题的三处

按风险排序，出问题先看这里：

1. **分镜页横幅的显示条件** —— 改过两次（先只看 variation，后加 pacing）。
   可能出现「该显示不显示」或「空横幅」
2. **六个下拉的写入** —— 路由层测过，**UI 层没测过**。
   如果改了不保存，看浏览器控制台的网络请求 `POST /studio/scene-plan`
3. **★ 高光** —— 今天刚修好合并白名单。如果仍然刷新就掉，说明还有第二处漏

---

### 下一步建议（按价值）

#### 高优先级

| # | 事项 | 为什么 |
|---|---|---|
| 1 | **感知哈希查重（dHash）** | 现有两道检查**不看图**，只测「计划的多样性」。LoRA 压过提示词照样出十张同款，检查看不见。dHash 两两比汉明距离，不要模型不要 GPU，ffmpeg 取帧就够 |
| 2 | **`PipelineStage` 加 `checks` 字段** | 两套检查是图文解说特化版且**无条件调用**。上第二条管线时必须一起做，等到第三条就晚了 |
| 3 | **成本估算 + 审批**（`proposal_packet` / `cost_log`） | 闸只有在「推不动真的推不动」时才值钱，成本是最该拦的那道 |

#### 中优先级

| # | 事项 | 为什么 |
|---|---|---|
| 4 | `decision_log` | 留痕：为什么选这个风格、这个音色 |
| 5 | 工作室看板（`shell.overlay`） | 设计过没建，资产浏览器 |
| 6 | `tool.call.toolview` 给 `studio_stage` | 阶段推进现在只有文本 |

#### 观察项，先不动

- `skills/creative/` 那 30 份创作知识里，`broll-planning` / `storytelling` / `short-form` / `typography` / `sound-design` 与我们直接相关，但**先看看现有五层引擎实跑效果**再决定要不要搬——可能提示词质量已经够了

---

## 十九、验收第一轮修复（2026-09-01 夜）

### 1. 立项页 / 脚本页整页重复 —— 双渲染路径

`workbench.tsx` 有**两条渲染路径**：一张 `SCREENS` 注册表，
和两行更早留下的写死条件渲染（只覆盖 project 和 script）。
两边都执行，所以**只有这两页重复**，其余三页正常。

讽刺的是注册表上方的注释正是为了消灭这类问题写的：
「adding one meant remembering to edit it in two places. It was not remembered」。
**注册表加上了，旧的条件渲染没删。**

已删。并加了守卫：数 `workbench.tsx` 里每个 Screen 的 JSX 调用点，
超过一处即 FAIL（故意加回验证过会红）。

### 2. 五层提示词在正常流程里根本不生效 —— 最严重的一个

**症状**：分镜生成发出去的提示词没有五层，正面提示词也丢了。

**根因**：`prompts` / `variation` / `slideshow` 三者全部 `scenePlan === undefined ? [] : ...`。
而**正常流程里没有人写过 `scene_plan`**——脚本写完直接生图，
分镜编辑器可能一次都没打开过。于是三个引擎在最常见的路径上**静默什么都不做**。

更糟的是 `shot_plan` 视图也只从存储的 scene_plan 投影：
一个 marker 里存了三段提示词的旧项目，**只要有一段被存进 artifact，另外两段就从视图里消失**。

**修法**：新增 `derivedScenePlan()`——没有存储计划时，
从**时间轴 + marker 旧计划 + 脚本的 `visual.prompt`** 推导一份，
只用于派生输出，绝不落盘。存储的计划永远优先。

> 判断依据：这份计划**本来就是可推导的**。
> 时间轴已经说了每段几张图，脚本已经说了每张画什么。
> 要求「先存一份」才生效，等于让缺省路径关掉三个引擎。

实测：删掉 `scene_plan.json` 后，三段全部拿到分层提示词，两个检查都跑。
已加测试钉住（删计划 → 断言每段都有 prompt、层数 ≥ 3、脚本主体在里面、两个检查非 null）。

### 3. 配音卡片被撑宽

卡片宽度按时长 `× 18px` 缩放，上限 200px——**那是时间轴的做法**。
这一行是选择器不是量尺，每张卡都是一段、都同样可点，
撑宽只会把后面的段推出屏幕。改成固定 76px，时长本来就以数字写在卡上。

### 4. 两处给 Agent 的提示错了

- **音色名不要带 `.wav`**。ComfyUI 节点自己补后缀，再加一次就成了 `xxx.wav.wav`。
  skill 里原本明确要求带后缀，改了。（面板占位符本来就是对的）
- **批量配音没说异步逐段**。分镜页有这条协议，配音页漏了。
  攒到最后一起提交的问题：最后一段失败会把前面全部丢掉，
  而面板盯的是 manifest，中途什么都看不到。已补齐，措辞与分镜页一致。

### 5. 三处过期文案

「风格前后缀由 playbook 统一加」——**后缀已经不存在了**。
脚本页和分镜页的「画面」字段说明改成：只写主体，
相机 / 镜头 / 光线 / 风格由插件分层拼。

### 待办：管线引导 skills 的注入机制

用户提出：每次确认、推进下一步，Agent 都要翻插件源码确认 schema。
需要给管线本身做引导 skill，**但不能常驻**——五段各一份全塞进上下文会失控。

这牵涉 skills 的按需注入机制，**下一轮单独讨论**。
已知线索：`ctx.skills.register` 现在是启动时全量注册（`mountSkills`），
没有按阶段挂载/卸载的机制；但 `mountSkills` 本身已经是可重入的
（设置变更时会 unmount 再 mount），阶段变化时复用同一条路子理论上可行。

测试 201 → **206**。

### 验收工具 `npm run inspect`

三个引擎的输出**全是派生的**——不落盘，正常只在面板里出现。
要检查就得点四个页面、展开一个折叠横幅，而且**面板本身也可能有 bug**。

`test/inspect.mjs` 直接从磁盘上的项目算出路由会算的同一批数字：

```
npm run inspect                    列出所有项目
npm run inspect <项目id>            打印全部派生结果
```

打印：项目与平台画幅 → 脚本里的画面描述 → 分镜计划（标注是存储的还是推导的）
→ 每一镜的五层拆解（标注哪层来自风格默认）→ variation 逐条 → slideshow 五维 → 时间轴。

**只读，不写。** 工作区默认 `D:/AiStudio`，用 `STUDIO_ROOT` 覆盖。

实测 `scifi-ai-reality`：variation 2.4 acceptable，
指出「8 镜全没写镜别 / 没有光线 / 没有高光 / 没有质感词」；
slideshow 1.18 strong 放行，但 `picture_rate` 3.4 提示「每分钟 6.6 张，偏慢」。
**都是真问题。**

---

## 二十、镜头语言创作技能 + 确定性加载（2026-09-02）

### 先澄清一个前提：skill 本来就不常驻

之前担心「skill 常驻会撑爆上下文」。查了宿主实现，**DSH 是渐进披露**：
常驻的只有目录行（name + description + whenToUse），正文由
`skill` 工具按需拉取。实测三份技能的目录合计 **742 字符**，正文合计 7919 字符不进上下文。

**所以不需要为「不常驻」额外设计机制。**

### 确定性加载：`/name` 手势

宿主 `packages/skill/tool-skill/src/index.ts`：

```js
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g
```

**用户消息里任意位置出现 `/skill-name`，就把该技能正文注入为指令**，
追加在所有注入之后、最靠近模型的回答。

关键在于面板能不能用：`session.prompt()` 产生的消息 source 是
`{ kind: 'user', rpcId }`（`api-proxy.ts:2377`），**正是这个扫描认的那种**。
注册的技能默认 `{ modelInvocable: true, userInvocable: true }`。

> 所以**面板可以主动加载技能，不用赌模型认得出目录行**。
> 而且不是常驻——目录一行，正文只在那一轮到场。

### `skill-cinematography.ts`

内容不是枚举表的复述（那个主技能里已经有了），而是**手艺**：

- **旁白的功能 → 镜别** 的映射表（开场 / 引入 / 细节 / 转折 / 收束）
- **序列比单张重要**：不连三镜同镜别、相邻要有落差、全片至少三种
- 一个可用的呼吸节奏型，以及「紧—松—紧」的原则
- 光线是情绪转折最省力的手段，四镜以上至少两种
- 高光镜前后不能同镜别
- 质感词要写材质不写形容词

也复述了构建器自己的坑：**`medium` 的短语是 "medium shot from waist up"，
给机房走廊配这个等于凭空加了个人**——所以想不清楚就留空。

### 触发点：配音过闸

`audio-screen.tsx` 的 `submit()` 原本**故意不发消息**，
注释理由是「别让模型去做用户还没看过的事」。

那个理由针对的是**生成图片**（花 GPU、分镜页会自己要）。
**设计计划是反过来的**：它是文字、免费、可逆，而且不做的话分镜页打开时
六个下拉全空——那不是「留白等用户填」，是**五层提示里缺了四层**。

现在过闸时发一条带 `/dsh-creative-studio-cinematography` 的消息，
明确要求「只定计划，不生成任何图片，不要提交 completed」。

### 测试守什么

**手势拼错会静默失败**——消息照发，正文永不加载，模型在毫无指导的情况下设计镜头语言。
所以从构建产物里查 `/dsh-creative-studio-cinematography` 是否存在，
并校验名字符合宿主的手势文法。故意拼错一个字母验证过会 FAIL。

还有一条：**技能里提到的每个枚举都必须是 schema 认的**，
否则它的建议直接产出 `SCHEMA INVALID`。

> 这条测试第一版写错了：它把技能里 ✗ 示例中的 `beautiful`、`modern` 也当成枚举查。
> **分不清「我让你用的」和「我让你避免的」。** 收紧成只查枚举形状（含下划线的 snake_case）。

测试 214 → **220**。

### 补读 OM 创作技能，找回两处

写 `skill-cinematography.ts` 时只读了 `broll-planning.md`（而且只用了「逐段问旁白在说什么」
这个框架，其余讲实拍 vs 生成，我们全走 ComfyUI 用不上）。
另外 5 份约 1000 行没读。补读后找回两处：

#### 一、把形容词换成造成它的原因（`cinematic.md`）

我原来只写了负面规则「避免 modern / stunning 这类空词」。
OM 给的是**正面翻译表**，理由和 reviewer 的 CHAI 同源：
主观措辞在标注者与模型之间方差极大，标了「moody」每次渲染路由到不同画面。

按我们的六个字段重写了这张表（压抑 → `low_key` + `cool` + `shallow`，等等），
并照搬了它那条：**「cinematic」这个词直接禁用——它不是一个画面选择，是一堆选择的名字。**

> **「把形容词换成造成它的原因」比「别用形容词」有用得多**——后者只说不要做什么。

#### 二、`picture_rate` 校准错了（真 bug）

OM `cinematic.md` 有一张按风格的平均镜长表。对照发现我的评分是**绝对阈值**：
≤6 张/分钟判「在念幻灯片」。

而 `warm-doc` 的自我描述是「缓慢、有呼吸感」，`pacing_profile: 'contemplative'`——
**OM 的表给这个档位的正确区间就是 3-6 张/分钟。**

> **评分在因为一个风格成功地做了它自己而扣它的分。**

改成按 `pacing_profile` 取下限（沉静 3 / 常速 5 / 电影感 8 / 快节奏 12），
风格自己的下限就是及格线。同一支 4 张/分钟的片子现在：

```
warm-doc   (contemplative)  0 分  节奏合适
clean-tech (conversational) 2 分  偏慢
flat-brief (energetic)      5 分  在念幻灯片
```

技能里也登了这张表，并有测试**校验技能宣传的下限就是评分器放行的下限**——
两处一旦漂移，技能会让模型瞄准一个必被扣分的数字。
把阈值改回绝对值验证过，两条测试都会 FAIL。

测试 220 → **227**。

---

## 二十一、文档分工整理（2026-09-02）

`docs/om-05-blueprint.md` 越写越像第二本开发日志——每解决一项就在里面追加一段
「怎么修的」。两本文档回答的不是同一个问题：

| | 回答什么 |
|---|---|
| `om-05-blueprint.md` | **OM 有什么，我们拿了没拿，为什么** —— 对照分析，长期有效 |
| `DEVELOPMENT.md`（本文件） | **做过什么，怎么做的，踩了什么** —— 开发日志，按时间累积 |

所以做了一次归位：

- 蓝图里「为什么固定前后缀会让画面雷同」「scene_plan 顺序修正」两整节**移除**——
  内容在本文件 §十三、§十四，蓝图里是重复
- 表格里的 `✅ 2026-XX-XX 已完成，某某某具体做法` 一律压成
  `✅ 已完成，详见 DEVELOPMENT.md`
- **保留**「为什么那三个是最高优先级」——那是原始分析（发现我们在用 OM 明确废弃的方案），
  不是施工记录

蓝图 297 行 → 254 行，去掉的全是重复；补上 30 份清单后 321 行。

> 顺带修了本文件两处**章节编号撞车**（有两个「十八」、两个「十九」），
> 09-02 那两节改为 §二十 / §二十一。蓝图里的交叉引用同步更新。

### 顺带补齐：`skills/creative/` 30 份逐份清单

蓝图原来只有一行「30 份创作知识，富矿，未搬」，等于没说。
现在逐份读过并列进 §3a-i，按相关度分三组：

- **A 组 10 份**：直接相关、还没搬
- **B 组 8 份**：讲的是已收编给 ComfyUI 的能力（参数不适用，判断标准通用）
- **C 组 12 份**：需要我们没有的能力（实拍库 / 录屏 / 动画运行时 / 3D）

清单核对过：30 条对应 30 个文件，无遗漏、无虚构。

#### 读完得出的两个结论

**该继续搬的是 A 组前四份**，因为它们各自对应一处明确的空白：

| 技能 | 对应我们的空白 |
|---|---|
| `storytelling` | 脚本段落只是要点平铺，没有起承转合 |
| `typography` | 字幕只有 `subtitleMaxChars` 一个参数，断行 / 位置 / 对比度全凭默认 |
| `sound-design` | 只有旁白一条音轨，没有配乐，也没有混音关系 |
| `short-form` | 已经支持竖屏画幅，**但没有竖屏该怎么讲的知识** |

**`video-gen-prompting.md`（325 行）单独值得一提**：它指出我们的
`shot_language` 缺三个维度——**机位高度、拍摄角度、POV**——
以及多镜头之间保持同一主体的写法（identity anchoring）。
这三个是 OM 有而我们没抄全的枚举，将来要不要补是个独立决策。

---

## 二十一、收束与首次提交（2026-09-06）

### 回来第一件事：测试是红的

隔两天回来，`pnpm test` 在 `apply()` 段直接崩——
`settingsCtx.settings.installSection is not a function`。

源码调 `installSection`（正确，包里就是这个），
**测试桩提供的却是 `register`**，一个真实 `SettingsProvider` 从未对消费者暴露过的方法。
桩是照「看起来像那么回事」手写的，不是照 `.d.ts` 抄的。

照类型定义重写了桩，连 hook 调用顺序（`setSource` 先于 `onChange`）也照抄，
并在旁边注明它镜像的是谁。归档为 CONVENTIONS 5.1c。

> **桩和真实实现之间没有任何东西把它们绑在一起**——
> 差异只在依赖变动时才炸，而那时你已经想不起桩是怎么来的。

### 抽出 `advice-panel.tsx`

分镜页和成片页都在回答同样三个问题：查没查、查出什么、要不要紧。
两边已经开始分岔：分镜页长出了可折叠深色面板，
**成片页却仍然在片子没问题时什么都不显示**——正是这个壳要防的那个失败。

抽成一个组件，两边共用：

- **永远渲染**，通过时折叠成一行，有发现时展开
- 通过一行成本是「一行 + 零注意力」，问题不该再花一次点击
- 成片页五个维度各自成行，中文标签（画面重复 / 镜头用心 / 单张停留 / 画面密度 / 风格兑现）
- 强制出片的勾选框作为 `action` 挂在标题栏右侧

> **空屏幕无法告诉你「已经检查过了」。**

### 空格键播放 / 暂停

成片页全局生效，无论指针在哪。

- `keydown` **和 `keyup` 都要 `preventDefault`**——有些浏览器在抬起时滚动，
  只挡按下拦不住那一跳
- 输入框 / 文本域 / 下拉 / 按钮 / contentEditable 里放行：
  字幕要打空格，按钮的空格是激活键
- **通过 ref 调用，不是闭包**。`togglePreview` 读 `at`，播放时每帧都变；
  绑定某一次渲染的副本会让空格从「这个屏幕挂载时的位置」恢复

### 蓝图整理

`docs/om-05-blueprint.md` 只留原始对比分析，已解决项改成删除线 + ✅ + 指向本文档。
`skills/creative/` 30 份逐份清单补全（§3a-i，按 A / B / C 三组）。

§0 和 §8 是过时的——还在说三个质量模块「一个都没有」、建议「下一步做第一梯队」。
改成当前状态，并把建议换成**第三梯队的 9 + 11**。

### 首次提交

`git init` 建在 `dsh-creative-studio/`（用户选定），39 文件 12216 行，测试 **237 全绿**。

- `.gitignore` 加了 `client/`——它和 `lib/` 一样是构建产物，`prepare` 会重新生成
- 加了 `.gitattributes` `* text=auto eol=lf`——
  否则 Windows 上会存成 CRLF，换台机器 checkout 整片变更
- git 身份设在**仓库内**，没动全局配置

`OpenMontage/`、`docs/om-0*.html`、四份工作区文档**不在这个仓库里**——
按选定的范围，仓库只装可独立发布的插件包。

---

## 二十二、待办登记（2026-09-06 用户提出）

按用户口述原样记录，不重排优先级——排序等各项摸清楚了再说。

| # | 事项 | 说明 |
|---|---|---|
| 1 | **页面美观规范化** | 过一遍全部六个页面，统一间距、字号、容器、状态色 |
| 2 | ~~**配音环节加音频上传接口**~~ ✅ | 为将来的**声音克隆**留入口：用户传一段参考音频。见 §二十四 |
| 3 | ~~**合成页加音乐轨道 + 烧录字幕选项**~~ ✅ | 字幕见 §二十三，配乐见 §二十五 |
| 4 | **收束各环节的 Agent 提示，沉淀进流程 skills** | 现在提示词散在各屏的 `jobFor` / `submit` 里，应当沉淀成技能 |

### 与之相关的既有缺口

第 3 项要动的两处，正好对应 `skills/creative/` 里还没搬的两份：

- 背景音 → `sound-design.md`（对白 −12dB / 音乐床 −30~−20dB 的压制关系、各平台响度）
- 烧录字幕 → `typography.md`（字号、安全区、断行、对比度，Netflix / BBC / WCAG 规范）

**先搬知识再写功能**，否则参数只能拍脑袋定。

### 一个说法要固定下来：管线有两条并行线路

用户在讨论 `checks` 字段时给出的区分，比字段名本身更值得记：

| | 是什么 | 现在挂在哪 | 状态 |
|---|---|---|---|
| **创作线路** | 每一段该产出什么、怎么做好 | `PipelineStage.review_focus` + 各阶段技能 | ✅ 已实现 |
| **检测线路** | 每一段该跑哪些质检 | **还没有字段**，`variation` / `slideshow` 无条件调用 | ⚠️ 待做 |

两条**并行**，都跟着管线走。创作线路已经是配置（`review_focus` 在管线定义里，
技能按阶段确定性加载）；检测线路还是硬编码。

`checks` 字段就是把检测线路也变成配置。**开第二条管线时一并加入并调试**——
现在只有一条管线，「无条件调用」和「按管线调用」行为完全一样，改了测不出区别。

---

## 二十三、创作技能落到脚本环节 + 字幕排版落到合成环节（2026-09-06）

### `skill-storytelling.ts` —— 脚本段的叙事结构

移植 `skills/creative/storytelling.md`（Derek Muller 的博士研究、Kurzgesagt 的制作规则、
3Blue1Brown 的引导发现法、Mayer 的多媒体学习原则）。

`review_focus` 里本来就写着「有起承转合，不是要点平铺」——
**那是一条要求，没有配方法。这份技能就是方法。**

一句话说清它解决什么：

> 简报的 key_points 是**并列**的，片子是**线性**的。
> 把并列的按顺序念出来就是要点平铺——每句都对，看完什么都没记住。

最能直接用的是 **But-Therefore 法**：段与段之间不许用「然后」，只能用「但是」或「所以」。
自检方法也给了——把段落连起来，中间插「然后」读一遍，通顺就说明是并列，要改。

#### 三处适配，没有照抄

- **语速**：原文是英文的 150–160 wpm。我们是中文，用风格的 `chars_per_second`（4.2–5.6），
  **抄 wpm 会在时间轴用的数字旁边放第二个错数字**
- **「一个概念 30–45 秒」**：概念不等于段落。我们一段只有几秒到二十几秒，
  一个概念横跨好几段——不说清楚，模型会把思路切得和段落一样碎
- **Mayer 五原则里有两条是我们的结构事实**，不是建议：
  解说与画面天然同步（一段就是一句话加一张图）、画面里不出现文字（负向提示词里就写着）。
  **点名说「这两条已经保证」，模型才不会在上面花注意力**

加载方式和分镜那份一样：脚本页发请求时带 `/dsh-creative-studio-storytelling` 手势。

### `subtitle-style.ts` —— 字幕排版

移植 `skills/creative/typography.md`（Netflix / BBC 字幕规范、EBU/SMPTE 安全区、WCAG 对比度）。

**烧录本来就有**，但是裸 `-vf subtitles=file.srt`——把每一个决定都交给 libass 默认值：
16pt Arial、贴着画面最底边、无描边。竖屏渲染时那个位置在手机手势条底下，4K 时字号只有能看清的六分之一。

现在生成完整 `force_style`，**按输出画幅缩放**：

| 画幅 | 字号 | 底距 | 侧距 |
|---|---|---|---|
| 1920×1080 | 46 | 64 | 96 |
| 1080×1920 | 46 | 64 | 54 |
| 3840×2160 | 92 | 128 | 192 |

#### 唯一一条不能照搬的数字：每行字数

规范说 37–42，**那是拉丁字母的**。一个汉字的信息量约等于一个英文单词，
Netflix 自己的简体中文指引是每行 16 字。我们的 playbook 里是 18–24，按风格分设，
断行在 `subtitle.ts` 上游做——**这份文件一个字都不该碰它**。

> 照搬 42 会让中文字幕每行长出一倍半。**规范的数字有语种前提，抄之前先问是哪一种文字。**

### 烧录开关搬到成片页

原来只有全局设置 `config.burnSubtitles`。改成**每次导出可选**（设置仍是默认值）：

```
字幕  [ 不烧录（旁挂 .srt） | 烧录 · 描边 | 烧录 · 底色块 ]
```

> 同一个项目，发给能读旁挂 .srt 的平台和发给不能读的，答案不同——
> **这是关于「这一次要发去哪」的决定，不是关于「这台机器怎么装」的决定。**

`studio_compose` 加了 `burn_subtitles` 和 `subtitle_background` 两个参数，
面板在提示里明确告诉 Agent 用哪个。

### 测试：真烧一次

样式串写错**不会报错**——ffmpeg 会用默认样式把片子渲染出来，一声不吭。
所以测试真的跑一次 ffmpeg 烧录，并**读回 libass 的 `fontselect` 日志**确认字体没被静默替换：

```
fontselect: (Microsoft YaHei, 400, 0) -> MicrosoftYaHei    ← 没有 fallback
```

另外钉住：竖屏和横屏字号相同（**按短边缩放，按高缩放会让竖屏字大近一倍**）、
4K 翻倍、安全区 90%、底距 ≥60px、描边与底色块产生不同的 `BorderStyle`、
字体名里的逗号不能把样式串劈开。

测试 237 → **245**。

---

## 二十三、字幕烧录：一个「有测试却全线失效」的功能（2026-09-07）

用户合成了一次带字幕的片子，**画面里一个字都没有**。

### 排查

先抽帧确认——底部干净，确实没烧进去。然后逐层排除：

1. `lib/compose.js` 建于 21:44，合成在 21:57，**代码在磁盘上是全的**
2. 直接用真实文件跑那条 ffmpeg 命令——**字幕渲染出来了**，但

> **大得离谱，而且跑到了画面正中间。**

### 根因：ASS 的 FontSize 不是像素

它是 ASS 脚本自己坐标系里的单位。**libass 在文件没声明尺寸时回退到 384×288**，
而 SRT 永远不声明。所以 `force_style` 里写 `FontSize=46` 想要 46px，
实际渲染成 `46 × 1080/288 ≈ 172px`——三行巨字横在画面中央。
`MarginV` 差同一个倍数，所以文字没在底部。

### 修法：自己写 ASS，而不是传 force_style

猜那个 384×288 然后预先除掉也能今天生效，**下一个改了默认值的 ffmpeg 构建就崩**。

改成生成完整 ASS 文件并声明 `PlayResX/PlayResY = 输出画幅`，
于是排版规范里每个数字都是**真像素**：

```
FontSize 46  ·  MarginV 64  ·  安全区 90%  ·  描边 3px
```

竖屏按**短边**缩放，不按高度——按高度缩放会让 1080×1920 的字大出近一倍。

`.srt` 照旧写、照旧交付，它是可编辑的通用格式；`.ass` 只用来烧。

### 但真正该记的是：这个功能一直有测试，而且一直在过

那条测试烧完一段视频，断言**输出文件大小 > 0**。

> **一个没有可见字幕的视频文件，大小同样大于 0。**

它断言的是「ffmpeg 没崩」，对整整一类失败完全免疫。

换成**同一帧烧与不烧逐字节比对**：没画是 0，画了是几百到几千（实测 947）。
比平均亮度可靠（文字只占 1%，均值只动 0.7），比阈值干净（不用拍魔数）。

**而且这一条还不够。** 把 `PlayResX/Y` 删掉还原当初的 bug，
像素测试**照样通过**——只是画了 1535 个像素而不是 947 个。
所以另加一条断言 ASS 里必须有 `PlayResX/Y`。两条各管一种失败：

| 守卫 | 抓什么 |
|---|---|
| 逐字节比对 | 什么都没画 |
| 断言有 `PlayResX/Y` | 画了，但尺寸全错 |

归档为 CONVENTIONS 5.6。

### 顺带

- 烧录开关从全局设置搬成**逐次可覆盖**：`studio_compose` 新增
  `burn_subtitles` 和 `subtitle_background`（`outline` / `box`）参数，
  设置里的值退为默认
- 新增 `subtitleFont` 设置。**字体装不上时 libass 会静默换字体，不报错**

测试 237 → **246**。

---

## 二十四、参考音频：配音环节的上传口（§二十二 第 2 项）

分镜环节早就有「参考图」——从 ComfyUI 素材库指定，或就地上传。
配音环节没有对应的东西，所以声音克隆类工作流在这条管线里没有入口。

补的就是这个，**照分镜那一份搬**：同一个 `AssetPicker`、同样的槽位、
同样「存的是 ComfyUI 里的文件名而不是拷贝一份进项目」。

### 数据

`ProjectMarker.voice_references: string[]`，与 `references` 并列而不是合并。
两者都是「加载器要读的文件」，但**被不同工作流在不同环节消费**——
合成一个列表，槽位顺序一旦对上，图像工作流就会拿到一个音频文件。

路由 `POST /studio/project` 接收 `voice_references`，照 `references` 的规矩
trim 并丢掉空串与非字符串：**空文件名会作为「加载名为空的文件」送进加载器节点。**

### 搬这一份时暴露的三个硬编码

| 症状 | 根因 |
|---|---|
| 音频选择器里一个文件都选不出来 | `<input type="file" accept="image/*">` 写死。浏览器不报错，对话框就是空的 |
| `comfy.uploadImage` 名字骗人 | 它上传的从来不是「图片」，是字节 |
| 缩略图 URL 逻辑在两屏各有一份 | 两处都要问 `/comfyui/loadarea` 才知道文件在 input 还是 output 目录 |

依次改成：`accept` 由 `kinds` 推导；`uploadImage` → `uploadAsset`；
`useAssetUrls()` / `inputAssetUrl()` 提到 `asset-picker.tsx`，两屏共用。

**但 multipart 的字段名仍然是 `image`，这不是漏改。**
ComfyUI 只有 `/upload/image` 这一个上传端点，它不看字节内容直接落盘，
它自己的前端给 `LoadAudio` 上传音频走的也是这条路。改成 `audio` 会 400。
这一条写了断言，因为它看起来完全像个该改没改的地方。

### 顺手把配音请求提成了纯函数

`src/voice-job.ts`，与 `shot-job.ts` 同构、同理由：

> 这条消息还在组件闭包里的时候，没有浏览器就检不了它，
> 而**少一行和不少一行长得一模一样**。

分镜那边正是这么丢掉正面提示词的。参考音频是同一形状的疏漏——
少传了它，运行照样成功，只是没克隆到任何人。

### 守卫都验过会咬

| 故意破坏 | 失败的断言 |
|---|---|
| 删掉 `state.ts` 里写 `voice_references` 的那行 | 名单往返、无关保存不清空 |
| 删掉 `voice-job.ts` 里拼参考音频的分支 | 单条 / 多条参考音频 |
| 把 `accept={accept}` 改回 `accept="image/*"` | 图片过滤器已去掉、过滤器随 kinds 推导 |

测试 246 → **262**。

---

## 二十五、配乐（§二十二 第 3 项的后半）

合成页多一条音乐轨道。用户描述的流程原样实现：填工作流名 → 点「添加音乐」→
Agent 选曲生成搬回 → 轨道上出现一条铺满全片的块，页面里能直接播。

### 先搬知识：`sound-design.md`

搬完发现**这份技能的绝大部分不该进技能**。原文主体是一张电平表——
音乐床压 20 dB、挖 2–4 kHz、−14 LUFS、真峰值 −1.5 dBTP。
这些全是**数得出来的**，所以进了 `audio-mix.ts`，每次渲染由 ffmpeg 执行。

写进技能等于把同一个数字放到一个没人核对的地方，还顺带邀请模型去要一个
**根本不存在的旋钮**。剩下真正数不出来的——快慢、曲风、调性、必须纯器乐——才是技能。

> 代码管数得出来的，指令管数不出来的。这条在这个项目里第三次用上了。

TTS 处理链（HPF / EQ / 3:1 压缩 / de-esser）也没搬，理由不同：**我们不混解说**，
它从 TTS 出来什么样就什么样进片子。没有杠杆的建议读起来像缺功能。

### 数据落在 marker，不落在 asset_manifest_audio

清单里每个资产都**必须指向一个脚本段落**——覆盖检查和孤儿检查建立在这上面。
配乐不属于任何一段。硬塞进去要么编一个 `scene_id`，要么削弱一个能抓真实错误的守卫。

所以 `ProjectMarker.music = { path, workflow, prompt }`，并且 `updateProject` 里**是合并不是替换**：
面板在文件存在很久之前就存了工作流名，Agent 导入时写 path 却不知道用户填了什么，
整对象覆盖会让两边互相擦掉。

导入和登记是**同一个动作**（`musicPatchOf`）。拆成两步，忘掉第二步就会留下
一个磁盘上有、没人引用的文件——而**没人引用的文件和不存在的文件长得一模一样**。

### 混音：两个决定

**① 侧链压缩，不是固定电平。** 固定电平的音乐床要么在说话时听得见，要么在空隙里听不见。
W3C 要求音乐比前景语音低 20 dB，BBC 说再往下压 4 dB——两条说的都是"有人说话的那一刻"。
所以床位 −20 dB，压缩器拿解说做 key，说话时再拉下约 8 dB，句子之间自己回来。

**② 响度必须两遍测量。** 这条差点毁掉整个功能：

> ffmpeg 的 `loudnorm` 在没有测量值时**默认动态模式**——它随时间调增益，
> 把句子之间的空隙当成"太安静"，于是**把音乐顶回空隙里**。
> 刚做好的压制被一段段抵消，不报错，输出里也没有任何东西可指。

先测再用 `linear=true` 施加一个固定增益，压制原封不动，响度照样达标。
代价是音频多解码一遍。测量失败时**退到 `alimiter` 峰值限制，绝不退回动态模式**——
把失败的测量变成一个静默错误的混音，比差几个分贝糟得多。

### 一个算错了的数

侧链压缩比原本按教科书算：key 超阈值 14 dB、3:1 → 增益衰减 9 dB。
**实测 6.9 dB。** `sidechaincompress` 是软拐点 + RMS 检测，教科书公式（硬拐点、峰值检测）不适用。
6.9 已经贴着规范 6–12 dB 的下沿，而真实语音的平均电平低于峰值，会掉出范围。
改成 4:1，实测 7.7 dB。

代码里现在写的是**测出来的数**，注释说明了它和算出来的数不一样，
并且冒烟测试每次重测。三处文案里的「9dB」同步改成「8dB」。

### 测量方法本身也踩了一次

第一版用单个 `bandpass` 隔离音乐频段，测出的压制深度只有 3.4 dB，
而且**改压缩比几乎没有反应**——看起来像滤波器不工作。
真相是 2 阶带通对 600 Hz 外的 200 Hz 解说抑制不够，泄漏抬高了本底，
把一半效果盖住了。换成级联的 highpass×3 + lowpass×2 之后数字才对上。

> 测量工具不够陡的时候，症状是「这个参数好像没用」，不是「测量不准」。

### 守卫都验过会咬

| 故意破坏 | 失败的断言 |
|---|---|
| 侧链两路输入对调（压解说而不是压音乐） | 压的是床不是人声 · 混音跑不起来 |
| `amix` 去掉 `normalize=0` | amix 不会偷偷把两路各砍一半 |
| 拿掉侧链，改成静态床 | 压的是床不是人声 |
| 测量失败时退回动态 `loudnorm` | 失败的测量只做峰值限制 |
| `music` 补丁改成整对象替换 | 合并保留 · 清空保留 · 拒绝不误伤 |
| 去掉路由的路径校验 | 绝对路径与 `..` 被拒 |
| `musicPatchOf` 不认 music | 导入产生登记补丁 · 后一首覆盖前一首 |
| 请求里删掉技能手势 | 请求以技能手势开头 |
| compose 跳过配乐存在性检查 | 缺文件的报错要能照着做 |
| `IMPORT_KINDS` 去掉 music | 类型检查直接失败 |

### 顺带修掉一个一直在的隐患

`npm test` **不构建**，直接跑 `lib/`。这一轮差点因此把一个过期的数字写进注释
（改了压缩比没重新构建，测出来还是旧值）。加了 `pretest: npm run build`，
并确认构建失败会中止测试（exit 2，一条测试都不跑）。

之前排查字幕烧录时也撞过同一件事——那次是靠对比文件时间戳才发现的。

测试 264 → **307**。

---

## 二十六、配乐的三处收尾

### 1. 参考音频并回音色面板

原来是 `dcs-triangle` 里第三个跨列容器。挑音色库里的音色、和拿一段样本克隆一个音色，
**是同一个问题的两个答案**，拆成两个容器让它们看起来像两个不相干的功能。
现在并进「音色」面板，中间用 `.dcs-subhead` 分隔。`dcs-triangle-wide` 随之删掉——没人用了。

### 2. 技能手势就是插件注入，但它失败时是静默的

用户问：配乐请求里的 `/dsh-creative-studio-sound-design` 是不是「外部提醒调用」，
该不该改成插件注入。

查了宿主实现（`packages/skill/tool-skill/src/index.ts`）：**这条手势本身就是注入路径**。
`ctx.skills.register` 发布技能体，宿主在 `agent/pre-step` 扫描
**`source.kind === 'user'` 的消息**，命中 `/(^|\s)\/([a-z0-9-]+)(?=\s|$)/` 就把渲染好的技能体
作为 `instructions` 形态的上下文拼进这一步。不是让模型自己去读什么。

面板发的消息也走这条路——`session.prompt` 在宿主侧被打上 `kind: 'user'`
（`session-controller/src/commands.ts:309`），所以手势有效。

**但它有一个真问题**：名字解析不了时，宿主把那一行当普通散文留着，**不报任何错**。
模型于是在完全没有指导的情况下照样选了一首曲子——
失败看起来像「选得不好」，而不是「技能没加载」。

所以加了 `GET /studio/skill?name=`：问宿主注册表这个名字**在不在、以及是否 user-invocable**
（手势查的就是后者，路由必须查同一个）。配乐面板发送前先问，加载不了就**拒发**并说明原因：

- `registry: false` → 宿主根本没有技能服务，别去找技能的毛病
- `known: false` → 没注册，多半是插件更新后没重启
- `known && !loadable` → 注册了但策略不允许用户调用

三种是三件不同的事，说法也不同。

### 3. `kind: "music"` 报错——不是 bug，是进程旧了

现象：`lib/tools.js` 的 schema 里明明是 `['image','audio','music']`，
工具却回 `must be one of image | audio`。

排查：磁盘上的 `lib/assets.js`、`lib/tools.js` 都是对的，符号链接也指对了地方。
`Get-Process node` 显示三个 node 进程起于 **9/7 02:15**，而配乐那次构建是 **04:17**。
**运行中的 DSH 加载的是两小时前的模块。**

同一个原因也解释了第 2 条里 Agent 说的「系统没有加载 skills」——
那个进程里根本没有 `STUDIO_SOUND_DESIGN_SKILL`，手势名字解析不了，于是退化成散文。

> **「磁盘上的文件是新的，运行时的行为是旧的」是进程陈旧的特征症状。**
> 先比时间戳，别先怀疑代码。

新加的技能路由现在能替这类情况说一句人话（"没注册——插件更新后需要重启 DSH"），
覆盖了这个失败面的一部分。

测试 307 → **314**。

---

## 二十七、配乐的两个真 bug

### 1. 音乐块跑到刻度上面去了

`.dcs-music-block` 写了 `position: absolute`，而 `.dcs-lane-blocks` 是一个
**没有定位的 flex 行**。绝对定位的子元素于是向上找到最近的已定位祖先——
落在轨道顶端，正好压在刻度尺上。

字幕轨能用绝对定位，是因为它自己额外加了 `.dcs-lane-cues { position: relative }`——
字幕条各有各的偏移，必须绝对定位。**音乐床只有一块、铺满整条轨**，
根本不需要绝对定位，改成填满的 flex 子元素就对了。

> 抄一个看起来相似的结构时，连同它**为什么需要那个属性**一起抄，
> 否则会抄来属性、漏掉前提。

### 2. 编辑模式里听不到配乐

`Preview` 只调度解说片段，压根没有音乐。补上一条常驻元素：

- `loop = true`——渲染会循环短曲铺满全片，预览不循环就等于在审另一个版本
- 起播时把 `currentTime` 对到 `位置 % 曲长`，也就是 `-stream_loop` 那一刻真正在的位置
- **预览里也做压制**：`volume` 在 0.1（−20dB）和 0.04（−28dB）之间滑动

压制不用 WebAudio：**预览自己就知道哪一帧有解说**（它负责调度），
侧链唯一要检测的东西在这里是白送的，上 WebAudio 只会多一层延迟。

一个细节：`speaking` 在**所有段落**上统计，包括没有配音文件的段落。
配音没生成的段落在时间轴上**仍然是解说时间**，渲染会压在它下面；
用「有没有片段在播」来判断就会漏掉这一类。

### 顺带：把 Preview 变成可测的

它一直没有测试，因为 Node 的类型剥离不支持
`constructor(private readonly options: X)` 这种参数属性写法。
改成普通字段赋值，`smoke.mjs` 就能直接 `import('../src/client/preview.ts')`——
这个类没有 React、除两个 audio 元素外没有 DOM，本来就该直接测。

现在用假的 `Audio` 和手动驱动的 `requestAnimationFrame` 测了 9 项，
破坏验证四条都会咬：去掉压制、压制改成按「有没有片段在播」判断、
不循环、暂停时忘了音乐床。

写测试时自己也踩了一个：`origin` 是在 `play()` 里算的，
我却在 `play()` **之后**才设时钟，于是每一帧读到的位置既不是测试想要的、
也不是播放器想要的。**帧循环要成立，时钟必须在 `play()` 之前就钉住。**

测试 314 → **325**。

---

## 二十八、配乐的三项设置

### 一个设计判断：音量控件影响谁

用户说「视口给一个音量设置」。可以理解成只调试听音量，但**那样是错的**——
预览的全部意义是「听到的就是要导出的」，一个只改试听的旋钮会让人
调完之后渲染出一支不一样的片子。

所以是**一个控件，同时决定试听和成片**。默认仍是规范的 −20 dB，
`resolveMusicSettings` 是渲染、预览、路由三处共用的同一个 clamp——
同一个存储值不可能在页面上是一回事、在文件里是另一回事。

开放的三项（音量 / 淡入 / 淡出）都是**听得出来**的；
挖频、压制比、响度目标没开放，它们回答的是听不出来的问题。

### 保存改成显式

原来工作流名是 blur 时静默保存的——**存没存过看不出来，只能刷新页面才知道**。
再加三个字段各自静默保存，就是三件要怀疑的事。
改成一个保存按钮 + 「未保存」标记，一次提交全部字段。

两个细节：

- 表单里存**字符串**不存数字。数字框清空重填的那一瞬间是 `''`，
  当场转成 0 会让值在手底下跳。只在保存时解析一次。
- 保存成功后丢掉草稿，输入框**回弹到宿主 clamp 之后的值**——
  超范围的输入会当场自己纠正，而不是留在那里看起来像被接受了。

### 预览里也要有淡入淡出

不然把淡入拖到 8 秒，在**唯一能判断它的时刻**什么都听不见。
渲染用 `afade` 做两端，预览用一个包络乘在压制后的电平上。

写的时候埋了个雷，自己读出来的：包络乘完写进 `bed.volume`，
而下一帧的 glide 又从 `bed.volume` 读回来——**包络被反馈进了压制**，
两者会收敛到谁都没要的值。修法是给压制电平一份自己的状态（`bedLevel`），
`bed.volume` 只是二者的乘积。**一个东西有自己的变化理由，就该有自己的状态。**

这个 bug 一开始**测不出来**：淡入测试只断言「比中段低」，
而带反馈的实现也比中段低（低得多）。改成断言**准确电平**之后才咬得住——
反馈版在 0.8s 处是 0.0017，正确版是 0.04。

> 「比 X 小」这类断言，对**方向对了但数值全错**的实现是免疫的。

### 一个连带的结构调整

`Preview` 本来要 `import '../audio-mix.js'` 拿 clamp，但 Node 的类型剥离
**不会把相对 `.js` 说明符解析到 `.ts` 文件**，一 import 这个模块就又跑出测试范围了。
改成由调用方（在 bundle 里，import 是免费的）解析好数值传进来。
clamp 仍然只有一处，只是上移了一层，而 `Preview` 保持可以直接驱动。

测试 325 → **340**。

---

## 二十九、最后一步不再经过 Agent

### 为什么这一步本来就不该给 Agent

到合成这一步，**没有任何东西还需要判断**：剪辑版本、停顿、字幕样式、配乐，
全部已经在页面上定完了。把它们编成一段话交给模型，只是多一次往返、
多一个转述出错的机会，换不来任何判断。

现在按钮直接打 `POST /studio/compose`。**工具留着**——
全自动流程没有按钮可按，最后一步还是要模型来。

两条路径走**同一个函数** `composeProject()`：前置检查、幻灯片拦截、
画幅解析、警告，全在里面。否则治理会变成「模型这条路成立、面板那条路绕过」。

报告仍然经 `machine.write()` 落盘，和 `studio_stage` 是同一个调用——
面板可以推进管线，但不能在推进时绕过 schema 和资产校验。
路由自己写 checkpoint 会快一点，也正好是要禁止的那条捷径。

### 顺带发现：剪辑版本从来没有真正被渲染过

`studio_compose` **没有 `cut` 参数**。面板发给 Agent 的话里写着
「剪辑版本 `cut-xxx`」，模型无处可放，于是静默丢掉——
**每一次合成出的都是计划版本**。而输出仍然是一支正常的片子，所以一直没被发现。

现在 `cutId` 从面板直接进 `composeProject`，工具也补上了这个参数。

### 长任务：POST 起，GET 轮询

一次合成好几分钟。整个 POST 挂着等，页面上什么都看不到，还要看空闲超时的脸色。
改成 POST 起任务返回 202，GET 报进度（`renderProject` 的 `onProgress` 原样透出）。

任务表在内存里，不落盘：**任务是「这个宿主进程」的事实**，
一条残留的 running 记录跨过重启会让项目永远合成不了。丢掉已完成任务的记录没有代价——
报告已经在 checkpoint 里了。插件卸载时 abort，不留孤儿 ffmpeg。

同项目同时只允许一个渲染：两个并发编码写同一个工作目录和同一个输出文件，
输的那个会**毁掉赢的那个的成片**，而不只是浪费 CPU。

### 两条断言原本是假的

**① 前置检查那条**：删掉 stage 循环，测试照样通过——
因为脚本产物也不存在，报的是同一个 `PREREQUISITE_VIOLATION`。
改成先写好 brief 和 script，只让资产阶段缺着，那个循环才成了唯一挡路的东西，
并且断言错误信息里点名了 `assets_audio`。

**② 剪辑版本那条**：原本断言 `result.cut === cutId`——
可这个字段是**从请求里回显的**，剪辑有没有真的进渲染器它都成立。
**这正是原来那个 bug 藏身的地方。** 改成断言时长真的变了（15.8s vs 计划的 13.0s）。

> 断言「请求里的东西回来了」不等于断言「它起作用了」。

顺带纠正一个我自己的误解：**cut 是逐段覆盖，不是段落选择**。
少列一个段落只是「这段没有覆盖」，片子一样长——第一版测试就是这么写的，所以量不出差别。

测试 340 → **355**。

---

## 三十、合成进度可视化

上一轮已经有一行文字，但显示的是 `renderProject` 的**开发者英文内部字符串**
（`muxing`、`probing narration`），而且没有百分比。

### 进度改成结构化

`onProgress` 从 `(message: string)` 改成 `(update: RenderProgress)`：

```ts
{ phase, fraction, label }
```

`label` 是**给人看的中文**，`fraction` 是 0–1。
客户端不去解析英文散文——那种解析一改文案就碎。

### 进度条有多诚实

只有**分镜阶段是真的在数**（`i/n`，而且时间大头在这儿）。
其余是从实际渲染观察来的固定区间，写在 `PHASE_SPAN` 里：

| 阶段 | 区间 |
|---|---|
| 测量配音 | 0–4% |
| 拼接配音轨 | 4–10% |
| **渲染分镜** | **10–70%**（真实 i/n） |
| 拼接画面 | 70–78% |
| 混入配乐 | 78–86% |
| 测量响度 | 86–90% |
| 封装 | 90–100% |

所以它是**一个不会倒退的估计**，不是真百分比。
烧录字幕会让最后一段远超它的区间——那种时候**文字标签才是有用的那个**，
所以烧录时的标签直接写「要重新编码，这一步最久」。

路由侧再夹一层 `Math.max`：**进度条倒退看起来就是出故障了**，
哪怕背后的估计其实是变准了。

### 页面

标签 + 百分比 + 已用时长 + 一条 4px 的条。条做了 0.4s 缓动——
它在两次轮询之间是跳变的，不缓动看着像卡住然后闪一下。

### 测的是契约，不是像素

四条断言：**单调不倒退**、**能走到头**、**分镜阶段每镜都推进**（否则最长那段纯靠猜）、
**所有标签都含中文**（英文内部串泄漏到界面就是原来的毛病）。
另外三条断言这些东西**真的穿过了路由**，而不只是存在于合成器内部。

破坏验证四条都会咬。

测试 355 → **363**。

---

## 三十一、一条长期规则：人机同步，不是人机串行

用户定的规则，记进 CONVENTIONS §8。

**每个提交按钮先回答一个问题：下一步需要 Agent 判断或生成吗？**
要生成内容或要做创作判断 → 交给 Agent（并带 `/skill` 手势）；
只是执行页面上已经定好的决策 → **宿主直接做**。

判据不是「这一步重不重要」，而是**「模型在这里还剩什么可决定的」**。

**另一半更容易烂掉**：直接执行的那条路，**必须同时给 Agent 留通路**——
全自动流程没有按钮可按。做法是两条路径**调同一个函数**，不是各写一份。
各写一份的后果是治理在一条路上成立、在另一条路上被绕过，而且不报错。

### 让规则可执行，而不只是写下来

冒烟测试新增两条：

1. 三个共享动作（合成 / 过闸 / 导入）在路由和工具里**都调同一个函数**，
   而且路由**不能**直接够到底层的 `renderProject(`
2. 三处生成型交接（脚本 / 镜头语言 / 配乐）都**带着技能手势**发出去，
   而不是把知识内联进消息

写这两条时又踩了同一个坑两次：

- 判断「路由是否共享函数」用的是**裸函数名搜索**——`import { composeProject as runRender }`
  照样含有这个名字，改名走人它也绿。改成搜**调用形式** `composeProject(runtime`。
- 判断「交接是否带技能」用的是**整文件搜技能名**——可每个屏幕的注释里都解释了
  「这里为什么有这个手势」，删掉代码行注释还在。改成搜**带引号的字面量** `'/skill-name'`。

> 两次都是同一件事：**在整个文件里找一个字符串，找到的可能是解释它的注释，
> 不是它本身。** 断言要贴着「它被使用」的语法形式，不是「它被提到」。

### 当前欠账（做全自动前要补）

保存/删除剪辑版本、裁剪音频、改 lora / 参考图 / 配乐设置 / 目标平台——
这几件面板能做、Agent 没有工具能做。人工流程不受影响，全自动会卡住。

测试 363 → **365**。


---

## 二十八、补齐 Agent 通路：`studio_edit` 与 `set_platform`

CONVENTIONS §8.2 记下的欠账清掉了。面板能做、Agent 做不到的三件事补上：

| 动作 | 之前 | 现在 |
|---|---|---|
| 保存 / 删除 / 列出剪辑版本 | 只有 `/studio/cuts` | `studio_edit` 的 `cuts` / `save_cut` / `delete_cut` |
| 裁剪音频头尾 | 只有 `/studio/asset/trim` | `studio_edit` 的 `trim_audio` |
| 目标平台 | 只有 `/studio/project` | `studio_project` 的 `set_platform` |

两条路都调**同一个函数**：`save_cut` 走 `parseCut`（面板路由用的那一个），
`trim_audio` 走 `trimAudioAsset`。所以钳制规则只有一份——测试里
「面板路径怎么钳，Agent 路径就怎么钳」是直接对着同一批越界值断言的。

`studio_edit` 单独成模块而不是塞进 `tools.ts`：剪辑版本的 schema 占了它大半篇幅，
而描述「一个 cut 能长什么样」本来就是这件事的主要工作量。

**`set_platform` 会把解析出来的画幅一起回报。** 这个字段存在的全部理由，
就是「声明了却没人执行」读起来像做过决定——所以工具的返回里直接写明
「抖音 → 1080x1920」还是「用了设置里的默认值」。

**裁剪之后清单里的 `duration_seconds` 会过期，故意不修。** 时间轴在合成时
对每个片段重新 ffprobe，清单里那个数是**测量记录，不是输入**。
工具的返回里明说这件事，省得模型发现对不上又去「修正」它。

### 那张同径表第一版是假绿的

§8.2 说「冒烟测试里有一张表钉住对应关系」。第一版写成了
`JSON.stringify(tool.parameters).includes('trim_audio')`——
而 `path` / `start` 这些参数的**描述里**就写着 `trim_audio: ...`。

于是把 `trim_audio` 从 action 枚举里删掉，**测试照样全绿**。

> 它断言的是「schema 里提到了这个词」，我要的是「模型调得到这个动作」。

改成读 `parameters.properties.action.enum`（没有 action 枚举的工具读参数名）之后，
三处删除——`trim_audio`、`set_platform`、`burn_subtitles`——都能让它变红。

测试 365 → **383**。


---

## 二十九、收束提示词（一）：管线技能拆成地图 + 节点细则

用户的方案：**一条管线一份 skill**，说明管线的作用、目的和每个节点；
节点的具体操作下沉到 skill 的 reference，每个节点一份。

### 结构对，但 reference 文件在这个 profile 里送不到

平台确实支持 skill 的 `resourceBase`（`directory` / `url` / `opaque`），
加载时会注一句「按这个基准解析相对路径，用到再加载」——正是渐进披露。

但用户跑的 `web` profile 继承 `web-app` bundle，那里面：

```yaml
- id: tool-fs           disabled: true
- id: tool-fs-search    disabled: true
- id: tool-str-replace-editor   disabled: true
```

`~/.dsh/profiles/web/` 里没有覆盖。**Agent 没有任何读文件的工具**，
给它一个 reference 路径它打不开，而且不报错。

所以载体换成**注册的 skill**——同一套按需手势，不需要文件系统。

### 三层，三种生命周期

| 层 | 内容 | 生命周期 |
|---|---|---|
| `pipeline-skill.ts` | 目的、状态机、红线、节点图 | 每管线一份 |
| `stage-skills.ts` | 一个节点怎么做 | **每阶段一份，跨管线复用** |
| `skill-*.ts` | 叙事、镜头、配乐、审校 | 跨管线共用 |

**阶段细则按「阶段」而不是「管线×阶段」编号。** `pipelines.ts` 自己写着：
管线是界面的排序，第二条管线「原样复用立项和脚本界面」。播客管线写同一个 `brief`
产物、同一套字段，就该读同一份细则。按管线切 = 13 份副本、13 处要改。

创作技能同理不能折进管线技能——短视频管线一样要 storytelling。

### 管线技能是渲染出来的

状态机图、节点表、每段审查要点全部从 `PIPELINES` 出。加一条管线自动有技能。

节点图每行末尾给出该节点的 `/手势`。**最该防的失败：手势指向一个没注册的技能不报错**——
消息照发、什么都没加载、模型就那么把这一步做了。测试拿实际注册表核对全部手势。

### 代价

| | 之前 | 现在 |
|---|---|---|
| 一份文档 | 12,678 字 | 地图 3,987 |
| 读最重的节点 | 12,678 | 7,754 |
| 读最轻的节点 | 12,678 | 5,266 |
| 目录（11 条摘要） | — | 1,092 |

（12,678 是从 `HEAD~1` 实测的；我原本随手写了 11,548，一查是错的。）

## 三十、收束提示词（二）：请求的共用收尾约定

三个 `*-job.ts` 各自结尾都说同样四件事，是复制粘贴的，**已经飘了**：

| 约定 | 飘成了什么 |
|---|---|
| 工作流怎么调 | **`shot-job` 从头到尾没出现过 `comfyui_workflow`** |
| 异步逐个提交 | 两种写法，一个多一句「搬进项目并」 |
| import 指令 | 三种写法 |
| 不要提交 completed | 「看过」/「听过」/ 无 |

第一行是真 bug：它给了工作流名，却没说用哪个工具跑。

抽成 `job-conventions.ts`：**共同的不写两遍，不同的当参数传**（张/段、看过/听过）。
差异化的部分（`shot_index` 只有分镜有）留在各自的 builder 里——
把它们也收进来，这个模块就从三个请求的**交集**变成了**并集**。

测试钉住两件事：文字一致（inline 一段不同的写法 → 三条断言变红），
以及**确实 import 了这个模块**（写法碰巧一样的话，文字断言要等下一次编辑才发现）。

测试 392 → **403**。


---

## 三十一、收束提示词（三）：节点 1–3

用户定的切法：**不变的协议进阶段技能，请求只留「现在在哪一步 + 工作流 + 面板参数 + 活数据」**。
请求开头带 `/手势`，技能就和内联文字一样必读——这解决了「技能可能不加载」的顾虑。

查过 harness：`SKILL_GESTURE` 用 `matchAll` 收集并去重，**一条消息里多个手势全部加载**。

### 节点 1 立项

| | |
|---|---|
| 移进细则 | 字段表、闸协议、「方向不同」的判据（细则里本来就更全） |
| 补进请求 | **项目 id**（旧请求只给标题）、用户在面板上选的四项 |
| 改掉细则里一处错的 | 「`target_duration_seconds` 用户没说就用 30」——用户已经在立项页选了 45。改成四项一律以 marker 为准 |
| 前端 | 「起草」先保存表单再发送 |

### 节点 2 脚本

**最大的发现：`script` 是严格白名单，细则里一个字段都没列。**
顶层 6 键、section 8 键、`voice_performance` 5 键，多一个整条判 SCHEMA INVALID——
和最早踩的那两次是同一类，就摆在让模型照着写产物的文档里。

补了两张表 + 明说清单封闭 + 点名四个「看着合理但不存在」的键。
还补了 `awaiting_human`：细则原本只写「写完停下等确认」，从没出现过状态值。

请求带**两个手势**：`stage-script`（写进哪些键）+ `storytelling`（怎么写）。
移走三句，其中「说清哪种钩子/弧线/拿不准」是 storytelling 收尾清单的**逐字重复**。

### 节点 3 配音（四处发送）

四处全部抽成 builder，全部带项目 id 和手势：

| 发送 | 之前 | 现在 |
|---|---|---|
| 批量配音 | 有 builder，无手势无 id | + 手势 + id，去掉三行协议 |
| 镜头语言 | 只带 `/cinematography` | + `/stage-assets-shots` |
| 音色方案 | onClick 里一句拼接 | builder + 手势 |
| 创建音色 | onClick 里一个数组 | builder + 手势 |

**协议从请求移进两份素材细则**：逐个提交、落盘规则、审批闸。
「写 scene_plan 不生成任何图片」也移进细则——它是这一步的属性，不是这条消息的。

**留在请求里的例外**：哪几条工作流要刷新快照。模型看不到设置页，
只有面板知道用户绑了什么。

### `job-conventions.ts` 缩水了，这是对的

它上一轮抽出四条共用收尾约定。现在其中三条进了细则——
**协议是不变的，就该跟着它治理的那个节点走，而不是在每条关于该节点的消息里重述一遍。**

剩下 `workflowLine`（工作流名是面板状态）和 `importLine`（只有配乐在用：
配乐属于整部片子，导入不推进任何阶段，没有阶段细则可以安放它）。

### 请求实际短了多少

配音 **191 字符**、分镜 **264 字符**（测试钉住了这两个上限）。

### 我自己的断言反复在跟这项工作对着干

这一轮改了五条，都是**贴实现而不是贴行为**：

- handoff 检查扫源码里的引号手势 → 界面改调 builder 就挂，还诱我塞了一行 `void SKILL`
- 配乐预览检查 `<audio>` 绑 url → 用户改成走 preview 引擎跟画面同步播（更好）
- 「凭空发明字段」扫描分不清「这是字段」和「没有这个字段」
- 两条 async 断言仍要求请求里有协议

> 断言写在实现上，重构就会撞它；写在行为上，重构只会验证它。


---

## 三十二、收束提示词：全貌

五个节点全部过完。这一节是**结果的全貌**，不是过程——过程见 §三十一。

### 结构

```
管线技能（每管线一份，从 PIPELINES 渲染）    地图：目的 · 状态机 · 红线 · 节点图 · 绑定表
    │
    ├─ 阶段细则（每阶段一份，跨管线复用）     这一步写什么产物、什么字段、什么协议
    │     brief · script · assets-audio · assets-shots · compose
    │
    └─ 创作技能（跨管线共用）                 storytelling · cinematography
          sound-design · reviewer · usage      手艺，不属于任何一条管线

请求（*-job.ts，面板发出）                    手势 + 在哪一步 + 工作流 + 面板参数 + 活数据
```

### 十一处请求，现在发什么

| 节点 | 请求 | 手势 | 字符 |
|---|---|---|---|
| ① 立项 | 起草简报 | `stage-brief` | 120 |
| ① 立项 | 换个方向 | `stage-brief` | 131 |
| ① 立项 | 过闸交棒 | `stage-script` | 88 |
| ② 脚本 | 写脚本 | `stage-script` + `storytelling` | 163 |
| ② 脚本 | 重写一版 | `stage-script` + `storytelling` | 200 |
| ③ 配音 | 批量配音 | `stage-assets-audio` | 255 |
| ③ 配音 | 提音色方案 | `stage-assets-audio` | 90 |
| ③ 配音 | 创建新音色 | `stage-assets-audio` | 178 |
| ③→④ | 设计镜头语言 | `stage-assets-shots` + `cinematography` | 180 |
| ④ 分镜 | 生成图片 | `stage-assets-shots` | 416 |
| ⑤ 合成 | 配乐 | `sound-design` | 634 |

每一条都带**项目 id**——收束之前有六处没有，模型得靠对话历史记着，
或者用标题反查。会话一压缩就断了。

合成本身不发请求：**面板直接后台执行**（`composeProject`），
工具留给无人值守流程。见 CONVENTIONS §9。

### 每个节点的技能承接了什么

| 阶段细则 | 字符 | 承接的 |
|---|---|---|
| `stage-brief` | 1570 | 12 行字段表 · **四项设置以项目标记为准**（原文错写成「用户没说就用 30」）· 平台决定画幅 · 换方向要换什么 |
| `stage-script` | 2363 | **顶层 6 键 + section 8 键 + voice 5 键三张表**（原本一个字段都没有）· 清单封闭 · 四个不存在的键 · `awaiting_human`（原本只写「停下等确认」）· 表演指导 |
| `stage-assets-audio` | 2524 | 音色先行 · `voice_design_name` 命名硬规矩 · 样音先行 · **逐段提交** · 落盘规则 · 审批闸 · **面板给方向** |
| `stage-assets-shots` | 5010 | 五层拼装 · **内容不能改／措辞要改** · **写计划不生成图片** · 六个镜头语言字段 · **逐张提交** · 落盘规则 · 跑图四条固定规矩 · **面板给方向** |
| `stage-compose` | 2174 | 幻灯片风险闸 · 字幕旁挂还是烧录 · render_report 原样交回 |

| 创作技能 | 字符 | 承接的 |
|---|---|---|
| `storytelling` | 2831 | But-Therefore · 整片弧线 · 四种钩子 · 先讲误解 · 引导发现 · 节奏 |
| `cinematography` | 4127 | 旁白功能→镜别 · 序列比单张重要 · 六个字段各自怎么定 · 高光镜 |
| `sound-design` | 1861 | 两条硬规矩 · BPM 按语速档 · 曲风 · **方向转写成提示词** |
| `reviewer` | 2268 | CHAI 三条 · 四级严重度 · 每一段看什么 |
| `usage` | 2661 | **五个工具的边界**（原本写三个，漏了 `studio_edit` 和 `studio_show`）· 错误码处置 · 重试幂等 · 路径规则 |

### 三条贯穿全局的规则

**1. 协议进细则，请求只带手势。**
逐个提交、落盘、审批闸——协议是不变的，就该跟着它治理的那个节点走。
请求开头的 `/手势` 让细则和内联文字一样必读（harness 用 `matchAll` 收集，多个手势全加载）。

**2. 面板给方向，模型规范定措辞。**（CONVENTIONS §8.4）
面板不知道绑定后面是哪个模型。`comfyui_workflow action: "skill"` 返回该工作流的技能包，
标了 `requireSkill` 的**不读就拒绝运行**。
分镜那里要同时说清：**内容不能动（别删层别加前后缀），措辞要动。**

**3. 阶段细则按阶段编号，不按管线×阶段。**
第二条管线复用立项和脚本界面，就该复用同一份细则。

### 读一个节点的代价

| | 之前 | 现在 |
|---|---|---|
| 一份管线文档 | 12,678 字符 | 地图 4,180 |
| 读最重的节点 | 12,678 | 9,190（地图 + 分镜细则） |
| 读最轻的节点 | 12,678 | 5,750（地图 + 简报细则） |
| 目录（11 条摘要） | — | 约 1,100 |

测试 **441**。

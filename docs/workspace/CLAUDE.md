# Ai-CreativityStudio

## 这个工作区是什么

把 [OpenMontage](https://github.com/calesthio/OpenMontage)（下称 **OM**）拆解成设计，
再用 TypeScript 重建成 **DSH（DeepSeek Harness）插件**，并**全本地化**——
凡是「生成像素和波形」的能力统一走 ComfyUI。

产物是本工作区里的 **`dsh-creative-studio/`**，一个能把一句话需求变成成片的 DSH 插件。
它以符号链接接入 DSH 的 `web` profile（见「本机环境」）。

### 要什么，不要什么

| | |
|---|---|
| **要 OM 的** | 流程治理（状态机 + 审批闸）· 产物 schema · 创作知识 · 风格 playbook |
| **不要 OM 的** | 那 121 个各自为政的生成工具。凡 ComfyUI 能做的（TTS、图像、视频、音乐、超分抠图、口型同步）全部收编成工作流调用 |
| **例外保留** | ComfyUI 处理不了的：FFmpeg 时间轴合成、Remotion 动态排版、HyperFrames 视频特效 |

分界线很干净：

> **「生成像素和波形」的全部可交给 ComfyUI；「组织时间轴和版式」的一个都交不了。**

### 两条决定了项目形态的结论

**① OM 不是「要包装的 Python 代码库」，而是「要移植的设计」。**
它的 YAML manifest、JSON schema、Markdown 导演指令**本来就是数据，可以原样搬**。
需要重写的只有状态机，而它做的事无非是读写 JSON 加 schema 校验。
核对过所有要保留工具的真实依赖后确认：**插件可以是纯 TypeScript，不需要 Python。**

**② 治理的价值全在「推不动的地方真的推不动」。**
校验失败必须**真的抛错**。做成「提示一下但还是写进去」，整套治理就废了，
插件退化成一组普通工具。

### 方法论

**纵向构建，不横向铺开。** 每一步都保持「能出片」，不做半成品堆积。
当前进度、设计决策和后续计划见 **[DEVELOPMENT.md](DEVELOPMENT.md)**。

## 目录

```
d:\dev-projects\Ai-CreativityStudio\      ← 唯一项目根：分析、文档、上游参考、插件本体
├── CLAUDE.md                 本文件：项目是什么、东西在哪
├── DEVELOPMENT.md            开发文档：做过什么、要做什么、改造计划
├── CONVENTIONS.md            工作约定与项目踩坑：该怎么做、不该怎么做
├── .claude/skills/
│   └── dsh-plugin-development/   DSH 插件开发契约（写代码前先读）
├── docs/                     拆解阶段的分析产出，双击即可用浏览器打开
│   ├── om-01-audit.html          实测评估：能力包络、成本决策、缺陷
│   ├── om-02-anatomy.html        分模块拆解：概念、状态机、三层知识、工具全表、管线、风格
│   ├── om-03-comfyui-map.html    ComfyUI 收编图：逐族可替代性判定 + DSH 映射
│   ├── om-04-mvp.html            MVP 路线：四段状态机、三工具、六步增量
│   ├── om-05-blueprint.md        移植蓝图：搬了什么 / 有意不搬什么 / 还差什么 + 优先级
│   ├── diagrams/                 可拖拽编辑的讲解图（Excalidraw，见 CONVENTIONS.md §6.5–6.7）
│   │   ├── pipeline-comfyui-boundary.excalidraw   五段管线 + ComfyUI 收编分界
│   │   ├── gen-pipeline.py       重新生成该图（布局/内容改这里，别手拖）
│   │   └── check.py              结构校验：绑定、index 序、文字溢出、元素重叠
│   └── data/                     结构化数据 + 生成脚本
│       ├── tools_full.json       121 个工具的完整契约（注册表实际输出）
│       ├── pipelines.json        13 条管线 / 90 段的完整定义
│       ├── styles.json           5 套风格 playbook
│       ├── data.json             上述合并 + 中文标注，供页面使用
│       ├── prep.py               生成 data.json
│       ├── inject.py             把数据注入 HTML 模板
│       └── wrap_local.py         给 artifact 片段补 doctype 外壳
├── OpenMontage/              上游克隆（**只读参考，不要在里面改代码**）
└── dsh-creative-studio/      ← 改造产物：独立可发布的 DSH 插件包
    ├── README.md                 用户向：安装、配置、四个工具、风格库、音色
    ├── docs/PLUGIN_DEVELOPMENT.md    DSH 的 48 个 UI 挂载点全表 + 挑位决策表
    ├── src/                      host 11 个模块约 3600 行
    │   └── client/               client 5 个模块约 550 行（设置页）
    ├── client/                   client bundle 构建产物
    ├── test/
    │   ├── smoke.mjs             pnpm test：48 项，只需 ffmpeg
    │   └── integration-comfyui.mjs   真实 ComfyUI 端到端，不进 pnpm test
    └── cordis.patch.yml          bundle 层

D:\dsh-comfyui\               ← 用户已有的 ComfyUI 插件（**只读参考**）
D:\AiStudio\                  ← 成片产出目录（插件的 workspaceRoot）
```

## 东西去哪里找

| 要找 | 去哪 |
|---|---|
| 插件怎么用、怎么配 | [dsh-creative-studio/README.md](dsh-creative-studio/README.md) |
| 做过什么、下一步做什么、为什么这么设计 | [DEVELOPMENT.md](DEVELOPMENT.md) |
| **该怎么做、不该怎么做**（ComfyUI / FFmpeg / 测试 / 工作方法） | [CONVENTIONS.md](CONVENTIONS.md) |
| **DSH 平台的坑** | `.claude/skills/dsh-plugin-development/SKILL.md` §10 |
| DSH 插件开发契约（host/client、bundle/profile、slot、Conversation Node） | `.claude/skills/dsh-plugin-development/SKILL.md` |
| **界面要挂在哪个位置**（48 个插槽全表、风险标记、决策表） | [dsh-creative-studio/docs/PLUGIN_DEVELOPMENT.md](dsh-creative-studio/docs/PLUGIN_DEVELOPMENT.md) |
| **还有哪些 OM 的东西没搬、该先搬哪个** | [docs/om-05-blueprint.md](docs/om-05-blueprint.md) |
| OM 某个工具/管线/风格的原始定义 | `docs/data/*.json`，或 `OpenMontage/` 对应源文件 |
| OM 的状态机、三层知识、四层检验怎么设计的 | `docs/om-02-anatomy.html` |
| 某个能力族该不该收编进 ComfyUI | `docs/om-03-comfyui-map.html` |
| 用户 ComfyUI 里有哪些工作流 | `~/.dsh/data/dsh-comfyui/workflows.json` |
| 成片和字幕 | `D:\AiStudio\<项目id>\output\` |

## 三个外部依赖是什么

**DSH** — DeepSeek Harness，基于 Cordis 的插件框架（官方仓库 `deepseek-ai/deepseek-harness`，
MIT，开发者预览期无版本承诺）。关键概念：host / client 双运行面；
bundle（作者分发）vs profile（用户组合）；`cordis.patch.yml` 配置分层；
host 侧 `ctx.tools.register` / `ctx.skills.register` / `installSettingsSection`；
client 侧 slot 四步契约 + Conversation Node 确定性事件折叠。契约细节见上表的 SKILL.md。

**dsh-comfyui** — 用户自己开发的双面插件（`D:\dsh-comfyui`，约 8600 行 TS）。
本项目**复用它，不重做它**。它给 Agent 三个工具：

| 工具 | 作用 |
|---|---|
| `comfyui_workflow` | `list / run / get`。**主力**——列出工作流库（含 id、名称、描述、**完整参数清单**），按 id 运行并传 `parameters` 覆盖 |
| `comfyui_run` | 直接提交 API 格式工作流，或用内置模板 |
| `comfyui_object_info` | 列服务器支持的节点定义 |

它的 `src/params.ts` 自动从工作流提取语义化参数和资产加载槽位，
面板还能导入画布、分析连通分量、提取可运行工作流。**这些都不要重做。**

**OM** — 指令驱动架构：几乎没有编排代码，Agent 读 YAML manifest + Markdown 导演指令驱动流程，
Python 只提供工具和持久化。状态机是代码（`lib/checkpoint.py`），管线是配置（`pipeline_defs/*.yaml`），
同一引擎跑 13 套。机制速查见 DEVELOPMENT.md，完整拆解见 `docs/om-02-anatomy.html`。

## 本机环境

Win11 / Node 24 / pnpm 11 / Python 3.12 / FFmpeg 8.1（`ffmpeg` `ffprobe` 都在 PATH）。
ComfyUI 在 `http://127.0.0.1:8188`。DSH_HOME 未设置，落在 `~/.dsh`。
插件已装进用户在用的 `web` profile，走符号链接而非拷贝：
`~/.dsh/profiles/web/package.json` 里是 `"dsh-creative-studio": "link:D:/dev-projects/Ai-CreativityStudio/dsh-creative-studio"`，
`node_modules/dsh-creative-studio` 是指向该目录的原生符号链接。
**挪动插件目录必须同步改这两处**（外加 `pnpm-lock.yaml` 与 `node_modules/.package-map.json` 里的同名路径），否则 DSH 加载不到。

OM 的 venv 在 `OpenMontage/.venv/`，已装 requirements + pygments + piper-tts；
`OpenMontage/remotion-composer/node_modules/` 已装。调 OM 的 Python 用
`OpenMontage/.venv/Scripts/python.exe`，需在 `OpenMontage/` 下运行。

## 工作约定

### 动手前先读这两处

| | 记什么 | 什么时候读 |
|---|---|---|
| **[CONVENTIONS.md](CONVENTIONS.md)** | 本项目的规矩与教训：ComfyUI / FFmpeg / 状态机 / 测试 / 工作方法 | **每次动手前** |
| **`.claude/skills/dsh-plugin-development/SKILL.md` §10** | DSH 平台的坑：参数 deepFreeze、设置页只注册不渲染、挂载点与作用域、bundle 纯度 | 写插件代码时（skill 会自动加载） |

分界线：**换个项目还会遇到的坑进 skill，只有本项目会遇到的进 CONVENTIONS.md。**

### 遇到新问题，按这条规矩归档

踩了新坑先判断它属于哪一类，再写进对应的那一处，**不要两边都写、也不要堆回本文件**：

- 任何 DSH 插件都会踩 → SKILL.md §10
- ComfyUI / FFmpeg / OM / 本仓库测试结构 / 工作方法 → CONVENTIONS.md
- 只是这次的进度或决策，不构成规矩 → DEVELOPMENT.md

每条按 **症状 → 根因 → 正确做法 → 怎么更早发现** 写。
只写「别这么干」没用——下次踩的时候未必认得出是同一个坑，认得出症状才认得出。

### 派活给子 Agent

`.claude/agents/` 下两个档案，都用 sonnet：

| 档案 | 派什么 | 不派什么 |
|---|---|---|
| `backend-engineer` | HTTP 路由、schema 字段、ffmpeg/资产处理、补测试 | 状态机语义变更、管线阶段增删、跨模块重构 |
| `frontend-designer` | 组件位置、样式、交互细节、文案 | 新增整页、改插槽挂载点、改数据流 |

分界是**「照着现有模式再加一条」派出去，「要定形态」自己做**。
初版落稿和架构决策自己写，改良和补齐派出去，我只验收。

### 四份文档的分工

| 文档 | 回答什么 |
|---|---|
| `CLAUDE.md`（本文件） | 项目是什么、东西在哪 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 做过什么、下一步做什么、为什么这么设计 |
| [CONVENTIONS.md](CONVENTIONS.md) | 该怎么做、不该怎么做 |
| `dsh-creative-studio/docs/PLUGIN_DEVELOPMENT.md` | 界面该挂在哪个位置（48 个插槽全表） |

## 代码检索（CodeGraph）

本工作区**整体**是一个 CodeGraph 索引根（`.codegraph/` 在此层，不在 `dsh-creative-studio/` 内，
所以插件将来独立成包时目录是干净的）。`codegraph.json` 把 `OpenMontage/` 和 `docs/`
标为 `deprioritize`——仍然可查，但排序永远压在插件代码之下。

查本工作区内任何东西（插件、OM、docs）**不需要参数**，直接 `codegraph_explore`：
插件代码有实时监听，改完约 1 秒进图。

### 查宿主 DSH

宿主 `deepseek-harness` 是独立的图，排错时用 `projectPath` 指过去：

```
projectPath: "d:\deepseek-harness"
```

另一个插件 `dsh-comfyui`（参考实现）同理：`projectPath: "D:\dsh-comfyui"`。

| 要查什么 | 怎么查 |
|---|---|
| 插件自身 / OM 实现思路 / OM 的 skills 素材 | 直接问，无需 `projectPath` |
| DSH 的 service inject、消息契约、工具注册 | `projectPath: "d:\deepseek-harness"` |
| dsh-comfyui 怎么写的 | `projectPath: "D:\dsh-comfyui"` |

### 两条限制

- **边不跨图。** 宿主接口改动的 blast radius **不含**本插件的使用点，
  `impact` / `callers` 都查不到——两边分别查，别指望图告诉你
- **带 `projectPath` 的项目没有实时监听。** 响应里出现
  `⚠ changed on disk after the last index sync` 时，先跑
  `codegraph sync "d:\deepseek-harness"` 再重查
  （注意 `explore` 用 `-p <path>`，`sync` / `status` / `init` 用位置参数）

### OM 检索的两个坑

- `.agents/skills/` 与 `.claude/skills/` 是同一批内容的两份拷贝，结果会成对出现，
  不是两个不同实现
- `gsap.min.js` 等压缩产物也在图里，查通用名时会跳出来

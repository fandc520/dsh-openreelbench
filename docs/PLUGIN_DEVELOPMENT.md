# 插件开发标准 —— UI 注入

> 适用对象：给 DeepSeek Harness（DSH）写带界面的插件。
> 本仓库（dsh-openreelbench）是这份标准的活样例：设置页（`settings.section`）、
> 设置数据（`settingsScope` 命名空间）都在 `src/client/` 里，可以直接抄。
> 宿主侧的机制定义在 DSH 仓库：`packages/client/ui-settings/src/client/contract/slots.ts`
> （设置域插槽类型）与 `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`
> （全部插槽目录，含每个插槽的注册字段和占用者）。
> 第 8 节把后者翻成了全量挂载点速查表（48 个，含具体渲染位置），以后"想把 X 放到界面哪里"
> 直接到第 8 节对号入座。

## 0. 两条原则

1. **插件只跟插槽与服务说话，不 import 平台实现。** 宿主把能力放在
   `ctx.slots` / `ctx.settingsScope` 这类上下文服务上；插件 bundle 只 import
   `react` 等运行时，平台类型全部擦除（tsdown 的 externals + 构建期纯度门禁）。
   好处是插件不钉宿主版本，两端只共享一个插槽名 / 一个命名空间字符串。

2. **设置数据走"命名空间"这一对缝。** 宿主半面用
   `installSettingsSection(ctx, ns, Schema, 基础层, {...})` 注册一个配置命名空间；
   浏览器半面用 `ctx.settingsScope.bind({ namespace })` 拿同一个命名空间的读写句柄。
   两侧都不知道对方的存在，只认同一个字符串。**校验一次定义在宿主 schema，
   UI 只是它的视图**（本仓库 `src/schema.ts` + `src/client/fields.ts` 是一份契约的两半）。

## 1. 插件的两面结构

```
dsh-openreelbench/
├── src/index.ts            # 宿主半面：工具 / 技能 / installSettingsSection
├── src/client/index.ts     # 浏览器半面入口：export name / inject / apply(ctx)
├── src/client/*.tsx        # React 组件
├── client/client.js        # tsdown 产物（交给宿主 web 插件表分发）
├── cordis.patch.yml        # 把插件插进 profile 的层栈
└── package.json            # dsh.bundle.patch + dsh.client 声明
```

浏览器半面入口的固定形状：

```ts
export const name = 'dsh-openreelbench'          // 与宿主半面同名
export const inject = ['slots', 'settingsScope']   // 需要的服务（cordis fiber）
export function apply(ctx: ClientContext): void { ... }
```

`package.json` 里对应的声明：

```jsonc
"exports": { "./client": "./client/client.js" },   // 浏览器半面必须从这里可见
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-ui-settings"]
  }
}
```

`dsh.client.inject` 是**信息性**清单（插件表展示依赖、预取用的），**不决定激活顺序**。
激活顺序由 `apply` 的 `inject` 服务等待和 `slots.inject()` 保证。列它清单里的包必须在
profile 依赖里可解析；别把已不再使用的包留在清单里。

## 2. UI 注入机制：slots

插槽（slot）是宿主/其它插件声明的渲染位。插件**注册**进这些位：

- `slots.register(meta, component)` —— 注册一个具体条目；
- `slots.inject(slotName, () => slots.register(...))` —— **必须用这个包裹注册**：
  它等到该插槽的**声明真实上台**才注册，且注册随本 fiber 一并卸载。
  用裸 `register` 等于赌顺序，标准禁止。

插槽三种形态（都 `scope: 'root'`）：

| 形态 | 语义 | 举例 |
|---|---|---|
| `single` | 全屏只有一个席位，后注册替换先注册 | `settings.header` |
| `keyed` | 按 key 分格，渲染方按 key 派发 | `settings.plugin.item`（key = 命名空间） |
| `list` | 渲染方枚举全部条目（nav 行、tab、卡片列表） | `settings.section` |

注册条目携带的字段按插槽目录为准，通用的有：`id`（list 型必备，复用一个已在用的
id 等于**替换那个格子**）、`order`（升序）、`label`（字符串或 thunk）、`locale`
（文案字典命名空间）、`inject`（给组件的注入面：store / 回调 / 钩子源）。

组件的数据来源有两种：

- **注册时闭包捕获**：`() => h(MyComponent, { scope })` —— 适合本插件这类小而自足的页；
- **inject 注入面**：`inject: () => ({ controller, hooks, api, t })`，渲染器把它摊平成组件
  props，hook 源会按 uSES 契约绑定（`useScope` 就是这种消费形态）。

渲染方调用 `renderSlot(key, ownerProps, { only: id })` 时把 **owner props** 并入组件
props。`settings.section` 的 owner props 是 `{ close: () => void }`——组件不用的就声明但不接。

## 3. 设置页注入路径（决策表）

设置数据想被用户改，先选**位**，再谈注册。三条路，同一个数据管道：

| 你要的东西 | 注入到 | 效果 | 判定 |
|---|---|---|---|
| **一个独立设置页** | `settings.section` | 设置侧边栏多一个 nav 条目，内容列整页是你的 | **首选**，配置多、成体系时用 |
| 插件页里的一张卡片 | `settings.plugin.item` | 「设置 → 插件」页的配置 tab 下多一张卡（key = 命名空间） | 只适合"随插件附赠、不想霸占侧边栏"的小配置 |
| 通用页里的一行 | `settings.general.item` | 「设置 → 通用」页加一行偏好 | 单个开关级设置，不值得一整页 |

其它设置域插槽：`settings.trigger/header/action/close`（外壳文案）、`settings.onboarding`
（引导步骤）、`settings.plugins.tab`（插件段内部 tab）——用到时查插槽目录，别发明。

### 3.1 标准形态：`settings.section`

```ts
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: OPENREEL_NAMESPACE,        // 用自己的命名空间作 id：nav 行键 = 存储命名空间，页和数据一个单元
  order: 40,                   // 侧边栏位置：general=0, models=10, plugins=15, agent-presets=20
  label: () => 'OpenReel 创意台', // nav 行文案；多语言用 locale dict + thunk
}, () => h(SettingsSection, { scope })))
```

组件接收：owner props `close`（本页不用）+ 闭包传入的 `scope`。整页在
`snapshot.status === 'unavailable'`（宿主没注册该命名空间）时渲染 `null`，不留死页。

### 3.2 另一条路：`settings.plugin.item`（本插件不适用）

这个位置**本身没错**——它是官方给第三方插件的正规通路之一，
「设置 → 插件」页会按命名空间 key 自动配对卡片。但它解决的是另一个问题。

```ts
// 本插件曾经这么写，配置因此出现在「设置 → 插件」页里：
ctx.slots.register({
  name: 'settings.plugin.item', key: OPENREEL_NAMESPACE, ...
}, h(StudioSettingsCard, { scope }))
```

这是**插件页内部**的卡片位，不是独立设置页。它把插件的配置和"什么插件在跑、怎么装"
混在一起，用户找配置的路径和页面对不上。

适合它的是**配置项少、且用户本来就会去插件页找**的插件（官方的 bash、web-search
就挂在这）。**凡是"我觉得这个插件该有自己的设置项"，第一反应都应该是 `settings.section`。**

判断口诀：配置要"自己的页面/条目" → `settings.section`；
只是"出现在插件自己的设置卡片里" → 那是给插件的宿主页面看的，不是给你插件配置的。

## 4. 数据管道：命名空间配对（本插件实录）

```ts
// 宿主半面 src/index.ts —— 注册命名空间（无 UI，纯数据）：
installSettingsSection(ctx, OPENREEL_NS, Config, config, {
  setSource: (current) => { source = current },   // 设置层写回
  onChange: () => { Object.assign(resolved, source()) },  // 改动即时生效
})
```
```ts
// 浏览器半面 src/client/scope.ts —— 拿同一命名空间的句柄：
export const OPENREEL_NAMESPACE = 'openreel'           // 必须与宿主一致
const scope = ctx.settingsScope.bind<Config>({ namespace: OPENREEL_NAMESPACE })
```
```ts
// 组件里消费（src/client/scope.ts 的 useScope = useSyncExternalStore 包装）：
const snapshot = useScope(scope)                   // { status, value, user, writable, ... }
await scope.set('workspaceRoot', 'D:/AiStudio')    // 一次一个顶层字段；嵌套字段折叠后整体写回
```

- `snapshot.value` 是三层合成（用户层 → 合成层 → schema 默认）；`snapshot.user`
  的**在场性**才标记"已覆盖"（`isOverridden`），不比值相等性。
- 写是**文档级、带修订号**的持久化操作 → 表单一律**暂存、点保存才提交**（`fields.ts`
  的 `buildWrites` + `settings.tsx` 的 staged edits，别做随敲随写）。
- 命名空间没注册时 `status === 'unavailable'`，界面直接不渲染。

## 5. 注册规范检查表

- [ ] 所有注册都走 `slots.inject(slot, () => slots.register(...))`，无裸 `register`
- [ ] 条目的 `id` 是自己的命名空间，不蹭 shipped id（蹭 = 替换别人的格子）
- [ ] `order` 写了、与同类条目错开；`label` 是文案而非调试串；多语言用 locale dict + thunk
- [ ] 组件需要的数据尽量走闭包或 inject 面，不在组件里 import 平台包
- [ ] 宿主注册的命名空间与 client 的 `OPENREEL_NAMESPACE` 字符串一致（单点常量，别复制两份）
- [ ] 宿主 schema 与 `fields.ts` 是同一份契约：加了配置字段，两边一起加
- [ ] `package.json` 的 `dsh.client.inject` 只列实际依赖的包

## 6. 构建与验证

```sh
npm run build:client      # tsdown → client/client.js (+ .map)
```

- 产物是 `window.__ModuleLoader__.load({ id, factory })` 形态，宿主按 rev 哈希做缓存破坏；
  改完**刷新 GUI 页面**即生效。`pnpm run dev:web`（宿主 dev 构建）跑着时，client 改动有 HMR。
- 自检三条：
  1. `grep settings.section client/client.js`（你注册的插槽名进了产物）；
  2. 打开插件表确认 `dsh.client.inject` 清单里的包都可解析（不可解析会在宿主侧 loud throw）；
  3. 打开设置页：侧边栏出现条目、内容渲染、保存后刷新值还在、`已覆盖` 标记正确。

## 7. 踩过的坑

已归档到 `.claude/skills/dsh-plugin-development/SKILL.md` **第 10 节**——
那是 skill，写插件代码时会自动加载进上下文；文档要人主动打开，来不及。

与本文件（UI 注入）直接相关的三条：

- **§10.2** `installSettingsSection` 只注册值不产生界面，必须配 client 面
- **§10.3** 挑挂载点之前先查第 8 节的表，别从文档注释里推
- **§10.4** 服务作用域：要 `conversation.send` 的面板必须挂在 session 作用域的插槽上

新踩的坑写进 SKILL.md §10，不要写回这里。

## 8. UI 可挂载点总表（含具体位置速查）

> 数据源：DSH 插槽目录 `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`
> （由 `scripts/gen-client-catalog.ts` 生成，共 48 个插槽）。下表是它的中文对照版，按 UI
> 区域分四组，行号连续（1–48），方便"需要时依次对照"。
>
> 三档风险标记：
> - `➕` 空位 / 列表位 / 新 key / 新 select 命中——**可与现有条目并列，首选**；
> - `⚠️` 该位已有 shipped 占用——注册即替换（single 整位换、keyed 撞格、chain 抢先）；
> - `🚫` 禁止注册（会毁掉整个界面）。
>
> 使用顺序：先在界面里找到"具体位置"列说的那块 UI → 按"注册要点"写 `slots.inject(...)`
> → 确认"占用者/风险"没踩到别人的格子。所有注册一律 `slots.inject(slot, () => slots.register(...))`。

界面的物理布局（毛坯图，括号里是挂载点）：

```
窗口（左/中/右三列 + 全框浮层）
┌────────────┬──────────────────────────────┬───────────┐
│ sidebar    │ conversation                │ details   │
│ brand.*    │  ├ session.header           │(右侧详情列│
│ workspaces │  │  ├ header.actions        │  details. │
│  (directory│  │  ├ lineage / utilities   │  tool)    │
│   Flow)    │  ├ view（tab 环：chat, …）  │           │
│ footer.    │  ├ chat.node 消息流          │           │
│  action    │  │  ├ assistant-actions     │           │
│ settings   │  │  ├ commandview           │           │
│ (trigger)  │  │  └ turnTail              │           │
│            │  └ composer.* / input.*     │           │
└────────────┴──────────────────────────────┴───────────┘
  root（渲染树根，外壳唯一自渲染位，禁止注册）
  shell.overlay（全框浮层：徽标 / toast / 状态胶囊）
  设置面板（由 settings.trigger 打开）
  ├ settings.header · settings.action · settings.close（壳文案位）
  ├ settings.section（侧边栏条目 + 内容页）★ 本插件用位：id=openreel, order=40
  ├ settings.general.item（「通用」页里的一行偏好）
  ├ settings.plugins.tab（「插件」段内部页签）
  └ settings.plugin.item（「插件」页里的插件卡片，key=命名空间）
```

### 8.1 组一：设置域（9 个）

| # | 插槽 | 形态·作用域 | 具体位置（在 UI 的哪里渲染什么） | 注册要点 | 占用者 / 风险 |
|---|------|------------|--------------------------------|---------|---------------|
| 1 | `settings.section` | list / root | **设置侧边栏一个 nav 条目** + 右侧内容列一整页；owner props `{ close }` | `id`（必，用自己的命名空间）、`order`、`label` | general(0) / models(10) / plugins(15) / agent-presets(20) / studio(40)。`➕` |
| 2 | `settings.plugin.item` | keyed / root | 「设置 → 插件」页的配置 tab 下**一张插件配置卡片** | `key`（必，= 命名空间） | BashCard / AgentLoopCard / WebSearchCard。`⚠️` 撞 key 即替换那张卡 |
| 3 | `settings.general.item` | list / root | 「设置 → 通用」页里**一行偏好设置**（行自带 label、当前值、写路径） | `id`（必）、`order` | language / agent-preset / composer-enter / permission / appearance。`➕` |
| 4 | `settings.plugins.tab` | list / root | 「设置 → 插件」段内部的一个**页签页**（外壳渲染 tab 标签 + 面板） | `id`（必）、`order`、`label` | all（插件清单）/ configurable（可配置）。`➕` |
| 5 | `settings.action` | list / root | 设置内容列**头部、关闭按钮之前**的可选操作 | `id`（必）、`order` | open-document。`➕` |
| 6 | `settings.header` | single / root | 设置面板**标题文本**（nav 标题行内，对话框的可达性锚点） | 无 | HeaderContent。`⚠️` |
| 7 | `settings.close` | single / root | 关闭按钮的**无障碍标签文本**（按钮外观是外壳绘制） | 无 | CloseLabel。`⚠️` |
| 8 | `settings.trigger` | single / root | 侧边栏底部**设置入口行的内容**（图标+文字；rail=56px 时只出图标），owner `{ wide }` | 无 | TriggerContent。`⚠️` |
| 9 | `settings.onboarding` | list / root | 设置域 root 级**引导步骤**（一次挂当前步，步自己包模态），owner `{ stepId, complete, openSection }` | `id`（必）、`order` | welcome-notice / deepseek-official。`➕` |

### 8.2 组二：侧边栏与外壳（9 个）

| # | 插槽 | 形态·作用域 | 具体位置（在 UI 的哪里渲染什么） | 注册要点 | 占用者 / 风险 |
|---|------|------------|--------------------------------|---------|---------------|
| 10 | `root` | single / root | **渲染树根部**，外壳唯一自渲染位，是所有座位的祖先 | — | AppFrame。`🚫` 动态条目的 priority 低于 shipped，一注册整页变成你的组件、所有席位消失 |
| 11 | `shell.overlay` | list / root | **全框浮层**：所有列之上、滚动容器之外；默认点击穿透，条目自行接收指针事件 | `id`（必）、`order`、`label` | 无。`➕` 全 app 级徽标 / toast 就放这 |
| 12 | `sidebar` | single / root | **整个左列**（折叠态 56px rail 由占用者渲染），owner `{ collapsed, width }` | 无 | SidebarRoot。`⚠️` 换=整列重写，内部座位全部消失 |
| 13 | `sidebar.brand.mark` | single / root | 侧边栏品牌行与收起 rail 里的**品牌标**，owner `{ size }` | 无 | OfficialBrandMark。`⚠️` |
| 14 | `sidebar.brand.name` | single / root | 展开态品牌标旁的名字 | 无 | OfficialBrandName。`⚠️` |
| 15 | `sidebar.footer.action` | list / root | 侧边栏底部 **Settings 旁的可选操作按钮**，owner `{ wide }` | `id`（必）、`order`、`label` | cordis-panel。`➕` |
| 16 | `sidebar.settings` | single / root | 侧边栏底部的**设置座位**（ui-settings 在此注册 trigger 行 + 模态面板） | 无 | SettingsRoot。`⚠️` |
| 17 | `sidebar.workspaces` | single / root | **工作区/会话浏览区**：section 头、搜索、分组/扁平会话列表、workspace 对话框，owner `{ wide, expandSidebar }` | 无 | WorkspaceBrowser。`⚠️` |
| 18 | `sidebar.workspaces.directoryFlow` | single / root | 侧边栏浏览区下方的**目录选择流程位**，owner `{ open, busy, onPicked, onCancel, onError }` | 无 | Browse / Native DirectoryFlow。`⚠️` |

### 8.3 组三：会话域（27 个）

**整列与空屏（hero）：**

| # | 插槽 | 形态·作用域 | 具体位置（在 UI 的哪里渲染什么） | 注册要点 | 占用者 / 风险 |
|---|------|------------|--------------------------------|---------|---------------|
| 19 | `conversation` | single / session-maybe | **整个中列**：空屏 hero + 活会话两态；占用者跨会话保持 React 身份 | 无 | ConversationRoot。`⚠️` 换=接管会话全部，内部席位随之消失 |
| 20 | `conversation.hero.agentPreset` | single / root | 新会话空屏，workspace 选择器旁的 **agent-preset 芯片** | 无 | AgentPresetSeat。`⚠️` |
| 21 | `conversation.hero.brand.mark` | single / root | 空屏主标题前的**品牌标**，owner `{ size, className }` | 无 | OfficialBrandMark。`⚠️` |
| 22 | `conversation.hero.workspace` | single / root | 空会话阶段的 **workspace 选择器孔**（选别的 workspace 切到其空会话，草稿保留） | 无 | WorkspacePicker。`⚠️` |
| 23 | `conversation.hero.workspace.directoryFlow` | single / root | 空态选择器下的目录流位（owner props 同 18） | 无 | Browse / Native DirectoryFlow。`⚠️` |

**会话体、视图与头部（6 个）：**

| # | 插槽 | 形态·作用域 | 具体位置（在 UI 的哪里渲染什么） | 注册要点 | 占用者 / 风险 |
|---|------|------------|--------------------------------|---------|---------------|
| 24 | `conversation.session` | single / session | **整个会话体**：滚动区+全部内容；替换=自己渲染整段对话、draft 镜像和视图环 | 无 | ConversationSession。`⚠️` 空替换=空白会话页，不优雅降级 |
| 25 | `conversation.view` | list / session | **会话视图 tab 环**：一个 tab 一个条目，会话体用 `only: <active id>` 一次渲染一个 | `id`（必）、`order`、`label` | chat / trajectory。`➕` 想加"新视图 tab"就是这个 |
| 26 | `conversation.session.header` | single / session | 会话滚动区上方条：**标题 + 视图 tab + 操作行**，三者全由占用者画 | 无 | ConversationSessionHeader。`⚠️` 替换会连带收起 header.actions |
| 27 | `conversation.session.header.actions` | list / session | header 操作行里一个按钮（标题旁的**每会话控件**，additive 首选） | `id`（必）、`order`（负值留给静态上下文） | agent-preset / job-list。`➕` |
| 28 | `conversation.session.header.lineage` | single / session | **面包屑标题与谱系控件**（subagent 上溯导航；渲染位保留普通标题作 fallback） | 无 | SubagentHeaderLineage。`⚠️` |
| 29 | `conversation.session.header.utilities` | list / session | 右对齐的**会话工具区**（标题相邻操作组之外，不干扰上下文排序） | `id`（必）、`order` | session-log-download。`➕` |

**消息流（5 个）：**

| # | 插槽 | 形态·作用域 | 具体位置（在 UI 的哪里渲染什么） | 注册要点 | 占用者 / 风险 |
|---|------|------------|--------------------------------|---------|---------------|
| 30 | `conversation.chat.node` | keyed / session | **消息流中每类业务节点的最终渲染器**，按 `ChatConversationViewNode.kind` 派发（user / assistant-step / command / tool-call / workflow-run / compaction / …） | `key`（必）= 节点 kind | 15 个 kind 已占用（user…workflow-run）。`⚠️` 撞 key=替换该节点类型；**新 kind 需宿主分发侧先定义**，不能只在这注册 |
| 31 | `conversation.chat.assistant-actions` | list / session | 一条**已定稿助手消息的 IconActions 行内**操作条（每条消息一份），owner `{ messageId }` | `id`（必）、`order` | feedback。`➕` |
| 32 | `conversation.chat.commandview` | keyed / session | 聊天视图中**按命令名分发的命令行**（key=命令名；无 run 的节点落 GenericCommandCard fallback） | `key`（必）= 命令名 | 无。`➕` 斜杠命令消息想升级成专属卡就这 |
| 33 | `conversation.chat.turnTail` | chain / session | 完成 Turn 节点的**尾部扩展链**，在该节点的 IconActions 之前渲染 | `select`（必）：`owner => 命中值\|null`，全落空渲染 nothing | ProducedFiles。`➕` 成片摘要卡就挂这 |
| 34 | `conversation.message.images` | single / session | 一组连续持久消息图片的**可选画廊渲染器**，owner `{ images, loadImage, align }` | 无 | MessageImages。`⚠️` |

**输入区（10 个）：**

| # | 插槽 | 形态·作用域 | 具体位置（在 UI 的哪里渲染什么） | 注册要点 | 占用者 / 风险 |
|---|------|------------|--------------------------------|---------|---------------|
| 35 | `conversation.composer` | chain / session | **输入框整体接管链**：`select` 路由（先读 PendingInteraction / session 再判定），命中者替换默认 InputBar；全落空回退 composer.bar | `select`（必） | ApprovalPanel / SubagentReadOnlyComposer / QuestionComposer。`➕` 新的接管形态零 owner 改动 |
| 36 | `conversation.composer.bar` | single / session-maybe | **默认输入框主体**（composer 链的 fallback；hero 态与会话态共用同一 textarea DOM），owner `{ variant, blocked, disabled, … }` | 无 | InputBar。`⚠️` |
| 37 | `conversation.composer.dock` | list / session | **输入卡片下方、与卡片同宽**的读数条（shipped stats 行在这） | `id`（必）、`order`；owner `InputZone { session, input }` | stats。`➕` |
| 38 | `conversation.input.attachments` | single / session-maybe | 输入框内**草稿图 rail / 拖放区 / 预览面**，owner `{ attachments, canAcceptDrop, onAddImages, … }` | 无 | ComposerAttachments。`⚠️` |
| 39 | `conversation.input.dock` | list / session | **输入卡片上方、独占一整行**（queue / todo / goal 这类要自己一行东西的位） | `id`（必）、`order`；owner `InputZone` | queue / todo / goal。`➕` 风格选择条就放这 |
| 40 | `conversation.input.left` | list / session | 输入卡片内**工具行左端**（固有 access-mode / plan / attach 之后）的小控件 | `id`（必）、`order`；owner `InputZone` | 无。`➕` |
| 41 | `conversation.input.model` | single / session | 工具行右端、发送按钮左侧的**命名模型选择位**，owner `{ locked }` | 无 | ModelSelect。`⚠️` |
| 42 | `conversation.input.overlay` | list / session | InputBar 的**浮动覆盖层锚点**（`/` 命令菜单、弹出选择面板；各自读 store，关着渲染 null） | `id`（必）、`order` | command-popup / slash-menu。`➕` |
| 43 | `conversation.input.plan` | single / session | 工具行中 access-mode 右邻的**命名 plan 状态位**，owner `{ locked }`；空着不占布局 | 无 | PlanChip。`⚠️` |
| 44 | `conversation.input.right` | list / session | 同一工具行**右端、主发送按钮之前** | `id`（必）、`order`；owner `InputZone` | 无。`➕` |
| 45 | `conversation.details.tool` | single / session | **右侧详情列内、选中工具调用的输出体**；一个席位=要渲染所有工具的输出，owner `{ block, cwd }` | 无 | ToolDetails。`⚠️` 只想改单个工具的渲染用 46 的 `tool.call.toolview` 就别碰它 |

### 8.4 组四：工具 / 详情（3 个）

| # | 插槽 | 形态·作用域 | 具体位置（在 UI 的哪里渲染什么） | 注册要点 | 占用者 / 风险 |
|---|------|------------|--------------------------------|---------|---------------|
| 46 | `tool.call.toolview` | keyed / session | **会话消息流内单个工具调用的原子视图**，按 wire 工具名分发（key=工具名）；未声明的 key 落通用工具行 | `key`（必）= 工具名 | read/write/edit/grep/glob/bash/web_search/web_fetch/ask_user_question/todo_write/skill/cordis_run 等。`⚠️` 撞 key 替换该工具的渲染；自己注册的新工具则是 `➕` |
| 47 | `tool.view.cordis` | keyed / session | 会话流中最新合格 `cordis_run` 调用**卡片内、Package 自有的交互区** | `key`（必，owner 派发） | 无。`➕` |
| 48 | `details` | single / session | **右侧详情列**（布局打开时显示；缺席则列渲染 nothing） | 无 | DetailsPanel。`⚠️` 换=45 的 details.tool 席位随之消失 |

### 8.5 对照速查（挑位逻辑）与本插件规划位

```text
想在设置里放配置
  ├ 独立一整页 → settings.section（★ 本插件已用：id=openreel, order=40）
  ├ 通用页里一行 → settings.general.item
  └ 插件页一张卡 → settings.plugin.item（能不用就不用，见 3.2）
想在消息流里挂东西
  ├ 每轮结尾追加内容 → conversation.chat.turnTail（chain, select 命中）
  ├ 某条助手消息旁加操作 → conversation.chat.assistant-actions（list）
  ├ 斜杠命令升级专属卡 → conversation.chat.commandview（key=命令名）
  └ 工具调用改成自己的交互卡 → tool.call.toolview（key=工具名）
想在输入区加东西
  ├ 输入卡上方独占一行 → conversation.input.dock（list）
  ├ 卡片内工具行左/右端 → conversation.input.left / .right（list）
  ├ 卡片下方读数条 → conversation.composer.dock（list）
  ├ 输入框弹出层 → conversation.input.overlay（list）
  └ 整框替换输入框（审批/提问接管）→ conversation.composer（chain）
想在会话头部加按钮 → conversation.session.header.actions（list，首选）
想加一个会话视图 tab → conversation.view（list，新 id + label）
想在全 app 上浮一层 → shell.overlay（list，新 id）
```

本插件的 M2 规划位（全部落在 `➕` 上，不替换任何 shipped 条目）：

- `conversation.input.dock` —— 风格 / 成片参数选择条（新 id，`order` 与 queue/todo/goal 错开）；
- `conversation.chat.turnTail` —— 单条成片后的摘要卡片（`select` 命中"本插件产出的 turn"才出组件）；
- `conversation.session.header.actions` —— "成片库"按钮（新 id）；
- `conversation.view` —— "成片"视图 tab（新 id + label，会话体用 `only:` 切换）；
- `shell.overlay` —— 生成完成的 toast / 徽标（新 id）。
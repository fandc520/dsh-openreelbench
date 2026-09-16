# dsh-openreelbench

<div align="center">

**dsh 开源视频创意台** —— 一句话,一部片子。

[![npm version](https://img.shields.io/npm/v/dsh-openreelbench)](https://www.npmjs.com/package/dsh-openreelbench)
[![license](https://img.shields.io/npm/l/dsh-openreelbench)](./LICENSE)

<img src="images/workbench.png" width="80%" alt="dsh 开源视频创意台" />

English: [README.en.md](README.en.md)

</div>

## 我们为什么做它

大语言模型会写,ComfyUI 会画,配音模型会说——可是从「一句话」到「一部能看的片子」,中间隔着几十次往返:
写什么、配什么图、先出哪个、谁说了算、出了错谁来兜。

OpenReelbench 想做的,就是把这段路铺平。它是 [DeepSeek Harness](https://github.com/fandc520/dsh) 的开源创意插件:
你说出想法,AI 把它变成一部完整的解说片;而创作的主导权,始终握在你手里。

我们相信开源生态从不缺生成能力,缺的是把这些能力组织成**创作**的骨架。
OpenReelbench 是这个方向的一次认真尝试——用人工智能的潜力,为开源生态注入创意力量。

## 一条受管的创作流水线

四段状态机,两道人工闸。推不动的地方,是真的推不动——每一关,都由你亲自放行:

```
简报 ──〔你确认〕──> 脚本 ──〔你确认〕──> 配音 · 配图 ──> 合成
```

图像、配音、配乐由 [dsh-comfyui](https://github.com/fandc520/dsh-comfyui) 的 ComfyUI 工作流生成,组装由 FFmpeg 在本地完成。
你不必打开一次 ComfyUI 界面,也不必写一条 ffmpeg 命令。对 Agent 而言,这一切收敛为五个工具:
项目、状态机、合成、预览、剪辑——能力有了边界,创作才没有后顾之忧。

### 立项 —— 从一句话到一份创作意图

一切从一个念头开始。你说出它,AI 和你一起把它聊成一份简报:主题是什么、讲给谁听、时长几何、
用什么风格说。项目就此立项——往后的每一份素材、每一次状态、这部片子的全部家当,都在这一步安家。
想法还没聊透?没关系,换个方向重来是流水线的常态,不是事故。

<div align="center">
  <img src="images/project.png" width="70%" alt="立项" /><br/>
  <em>立项 —— 主题、时长、画幅、风格,一次说清</em>
</div>

### 脚本 —— 分段即分镜

脚本不是一篇流水文。它被切成一段一段,每一段就是将来的一格画面;每段写多长,由风格自带的
语速档说了算。画面提示词只写看得见的东西——光线、构图、动作,不写形容词堆出来的空话。
初稿不满意就改,改到满意为止。但请注意:脚本没有你的确认,管线一步都不会往前走。

<div align="center">
  <img src="images/script.png" width="70%" alt="脚本" /><br/>
  <em>脚本 —— 每一段,都是将来的一格画面</em>
</div>

### 配音 —— 让片子开口说话

先挑一支音色:从工作流现成的音色里选,或让 AI 按你的描述设计一支新的。样音先行——
先听一小段,满意了再批量生成全片。所有配音一次生成完毕,时长以实测为准,绝不采信口头申报:
后面的时间轴和字幕,都按真实声音排布。

<div align="center">
  <img src="images/narration.png" width="70%" alt="配音" /><br/>
  <em>配音 —— 样音先行,满意再批量</em>
</div>

### 分镜 —— 让每一格画面有话说

镜头语言在这里落进画面:镜别、焦段、光线、景深,五层提示词层层递进。一份风格契约管住全片
画风——第一张图和第三十张图,来自同一个世界。配音先行、配图在后,批次井然,
ComfyUI 不必来回装卸模型,把时间都花在出图上。

<div align="center">
  <img src="images/shots.png" width="70%" alt="分镜" /><br/>
  <em>分镜 —— 镜头语言落进每一格画面</em>
</div>

### 合成 —— 从想法到成片,你只需要关心内容本身

时间轴按实测时长排布,字幕逐句对齐声音,配乐自动压到解说之下、响度对齐平台规范。
点下合成,拿走成片和字幕文件——不用打开 ComfyUI,不用写一条 ffmpeg 命令。
繁琐的都交给了管线,省下来的精力,请全部投给内容。

<div align="center">
  <img src="images/compose.png" width="70%" alt="合成" /><br/>
  <em>合成 —— 时间轴、字幕与配乐,一次到位</em>
</div>

## 十一份技能,全程同行

管线之上,十一份内建技能陪跑全程——一半把关创意质量,一半配合具体创作:

| 把关创意 | 配合创作 |
|---|---|
| **自审协议** —— 提交之前,先按规矩自挑毛病 | **解说片总纲** —— 节点图与全局规矩 |
| **叙事结构** —— 因果链、钩子与整片弧线 | **简报 · 脚本 · 配音 · 分镜 · 合成** —— 五段各自的作业细则 |
| **镜头语言** —— 镜别、光线与高光镜 | **工具契约** —— 工具如何表现,报错如何处置 |
| **声音设计** —— 选曲的两条硬规矩 | |

## 安装

- **DeepSeek Harness ≥ 0.1.2**(建议 0.1.5-rc 线)、Node ≥ 22.19、PATH 上的 `ffmpeg` / `ffprobe`
- **搭档插件**:[dsh-comfyui](https://github.com/fandc520/dsh-comfyui) ≥ 0.4.0 —— 生成能力的执行端,先装它,并在面板里备好工作流

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile <你的 profile> add dsh-openreelbench
```

装完重启 profile。配置在「设置 → OpenReel 创意台」,或 `cordis.yml` 的 `openreel` 层——
绑定表里只写工作流的**名称**,怎么调由工作流自己的参数清单说了算。
更多细节见 [插件开发标准](docs/PLUGIN_DEVELOPMENT.md)。

## 这只是开始

OpenReelbench 目前只有一条**图文解说**管线——这是沿着最简单的视频内容创作流程,走通的第一步。
视频广告、创意短片、数字人……更多内容制作管线,将在同一条骨架上逐步生长。

它不仅是智能时代人机协同创作的一次尝试,更为未来的全智能、自动化创作,打下了扎实的基础。

## 许可

MIT

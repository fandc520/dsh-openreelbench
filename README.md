# dsh-openreelbench

English: [README.en.md](README.en.md)

**dsh 开源视频创意台** —— 一句话,一部片子。

<div align="center">
  <img src="images/workbench.png" width="80%" alt="dsh 开源视频创意台" />
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

- **简报** —— 把一句话聊成一份明确的创作意图:主题、时长、画幅、风格。
- **脚本** —— 分段即分镜,按风格语速算好每段字数,画面提示词只写看得见的东西。
- **素材** —— 配音与配图分批生成,互不干扰;时长以实测为准,绝不采信口头申报。
- **合成** —— 时间轴、字幕、混音一次到位,交付成片与字幕文件。

图像、配音、配乐由 [dsh-comfyui](https://github.com/fandc520/dsh-comfyui) 的 ComfyUI 工作流生成,组装由 FFmpeg 在本地完成。
你不必打开一次 ComfyUI 界面,也不必写一条 ffmpeg 命令——**从想法到成片,你只需要关心内容本身。**

对 Agent 而言,这一切收敛为五个工具:项目、状态机、合成、预览、剪辑。
能力有了边界,创作才没有后顾之忧。

## 十一份技能,全程同行

管线之上,十一份内建技能陪跑全程——一半把关创意质量,一半配合具体创作:

| 把关创意 | 配合创作 |
|---|---|
| **自审协议** —— 提交之前,先按规矩自挑毛病 | **解说片总纲** —— 节点图与全局规矩 |
| **叙事结构** —— 因果链、钩子与整片弧线 | **简报 · 脚本 · 配音 · 分镜 · 合成** —— 五段各自的作业细则 |
| **镜头语言** —— 镜别、光线与高光镜 | **工具契约** —— 工具如何表现,报错如何处置 |
| **声音设计** —— 选曲的两条硬规矩 | |

## 界面

<div align="center">
  <img src="images/project.png" width="70%" alt="项目设置" /><br/>
  <em>项目设置</em>
</div>

<div align="center">
  <img src="images/script.png" width="70%" alt="脚本" /><br/>
  <em>脚本 —— 分段即分镜</em>
</div>

<div align="center">
  <img src="images/narration.png" width="70%" alt="配音" /><br/>
  <em>配音 —— 音色、样音与批量生成</em>
</div>

<div align="center">
  <img src="images/shots.png" width="70%" alt="分镜" /><br/>
  <em>分镜 —— 镜头语言落进每一格画面</em>
</div>

<div align="center">
  <img src="images/compose.png" width="70%" alt="合成" /><br/>
  <em>合成 —— 时间轴、字幕与配乐</em>
</div>

## 安装

- **DeepSeek Harness ≥ 0.1.2**(建议 0.1.5-rc 线)、Node ≥ 22.19、PATH 上的 `ffmpeg` / `ffprobe`
- **搭档插件**:[dsh-comfyui](https://github.com/fandc520/dsh-comfyui) ≥ 0.4.0 —— 生成能力的执行端,先装它,并在面板里备好工作流

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile <你的 profile> add github:fandc520/dsh-openreelbench
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

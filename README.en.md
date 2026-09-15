# dsh-creative-studio

A [DeepSeek Harness](https://github.com/fandc520/dsh) plugin that turns a one-sentence
request into a narrated explainer video — voiceover, generated imagery, subtitles and all.

中文文档:[README.md](README.md)

Four-stage state machine, two human approval gates:

```
brief ──[gate]──> script ──[gate]──> assets ──> compose
```

**Generation runs on ComfyUI; assembly runs on FFmpeg.** The plugin never talks to
ComfyUI itself — it holds a binding table that tells the agent *which* workflow to use,
and the agent runs it through
[`dsh-comfyui`](https://github.com/fandc520/dsh-comfyui)'s `comfyui_workflow`.
Switching workflows is a config change, not a code change.

Two-sided structure: a host half (tool / skill / settings-namespace registration) plus a
browser half (the settings-page UI). The panel lives under **Settings → AI Creative
Studio** with its own sidebar entry; see
[the plugin development standard](docs/PLUGIN_DEVELOPMENT.md).

## Why a state machine

The pipeline's value is not "a set of tools" — it is that **where progress should be
blocked, it genuinely cannot proceed**:

- Script not confirmed by the user? `assets` refuses to write — `GATE VIOLATION`
- An earlier stage unfinished? A later stage refuses to write — `PREREQUISITE VIOLATION`
- A manifest file that does not exist on disk? `assets` cannot complete — `ASSET MISSING`
- A section missing voiceover or imagery? Same — `COVERAGE INCOMPLETE`

These **throw** — they don't "warn but write anyway". Do the latter and the whole
governance is dead: the plugin degrades into a pile of ordinary tools.

Narration durations are never taken from the caller's claim — `ffprobe` measures every
clip and overwrites the number; the timeline and the subtitles are both laid out from the
measured values.

## Install

Requires Node ≥ 22.19 and `ffmpeg` / `ffprobe` on PATH.

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile <your profile> add github:fandc520/dsh-creative-studio
```

pnpm ≥ 10 blocks build scripts of git dependencies by default — allow them in the
profile's `pnpm-workspace.yaml` (`allowBuilds`), then re-run `add`. Restart the
profile after installing.

Local development install:

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile <your profile> add D:\dev-projects\Ai-CreativityStudio\dsh-creative-studio
```

## Configuration

Two entries write the same values: the **`studio` section of the DSH settings page**,
and the `studio` layer in `cordis.yml`. One schemastery schema drives both — the
settings page treats `cordis.yml` as the base layer and only persists what you change.

Changes take effect **immediately**, no restart: project root and ffprobe path are read
on every call, and a changed binding table or style contract re-mounts the skills (they
are rendered into the instruction body; without a re-mount they would point at stale
workflows). Only a change to the plugin's own code needs a restart.

The `cordis.yml` layer looks like this:

```yaml
- id: studio
  name: dsh-creative-studio
  config:
    workspaceRoot: ''            # empty = $DSH_HOME/data/dsh-creative-studio/projects
    defaultDurationSeconds: 30
    video:                       # encoding parameters only; look & rhythm belong to the style playbook
      width: 1920
      height: 1080
      fps: 30
      preset: medium
    defaultStyle: clean-tech     # clean-tech / warm-doc / flat-brief
    burnSubtitles: false         # false writes a sidecar .srt (no re-encode needed)
    bindings:
      tts:
        workflow: 'Qwen3-TTS(Text)'      # a name from dsh-comfyui's workflow library
        notes: ''
      image:
        workflow: 'Krea-T2I-Afterlight'
        notes: ''
```

**Bindings carry names, never parameter copies.** `comfyui_workflow action: list`
already returns every workflow's full parameter sheet (English name, Chinese label,
defaults, options, numberKind, upload types), and it tracks the user's panel edits in
real time. Copying parameters here only creates drift. The binding's one job is to point
the agent at the right entry in the library; how to drive it is the sheet's call.

Names instead of ids: ids come from `randomUUID()` and **change on every re-extract**
of the same canvas, silently dead-ending the config. A name is something the user can
see and manage in the panel. Left empty, the tools and skills say "not bound" outright
and require the agent to find one in `list` — picking one on its own is not allowed.

Nested config supports per-key overrides — write `video: { fps: 24 }` and every other
key keeps its default.

## Style playbooks

**What the M0 run exposed**: three sections, same model, same seed, prompts differing
only in wording (one says cinematic, one says flat/minimal) — and the visual styles came
out on entirely different planets. **Style is solved by a unified prompt template and
negative prompt, not by seeds.**

One playbook governs:

| Section | Contents |
|---|---|
| `visual` | image prompt prefix/suffix, negative prompt, consistency anchors |
| `narration` | narration tone, speech-rate tier, **chars per second** (for script length estimates) |
| `pacing` | padding before/after sections, per-section duration bounds |
| `kenBurns` / `fit` / `subtitleMaxChars` | look and feel |
| `quality_rules` | quality red lines, rendered into the skill for the agent |

Three built in: `clean-tech` (crisp tech) · `warm-doc` (warm documentary) ·
`flat-brief` (flat fast-brief).

Custom styles go under `playbooks`; a same-name entry **replaces the built-in whole**
(no deep merge — a half-overridden palette is exactly where style drift comes from):

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

`studio_project action: "style"` hands the agent the current style's **paste-ready
prompt templates**. A single section can override the playbook's padding with
`delivery_cues.pause_before_seconds` / `pause_after_seconds`.

### Voice

Voice is **not in the binding table** — it is a project-level setting: pass `voice` to
`studio_project action="init"`, or call `action="set_voice"` later. When empty, the
tool output says `NOT SET` in plain words, and the agent must ask the user first
(listing the TTS workflow's `voice` parameter options to pick from) before generating
any narration.

**Designing a new voice is a preparation flow, outside this pipeline** — the user builds
it in the ComfyUI panel with a voice-design workflow; this side only references it.

## The four tools

| Tool | Responsibility |
|---|---|
| `studio_project` | `init` / `status` / `list` / `get` / `import` / `set_voice` / `style` / `bindings`. `import` brings ComfyUI output (absolute paths or http media-proxy URLs) into the project and returns the project-relative paths the manifests need |
| `studio_stage` | **The state machine's only write path.** Writes artifacts + advances state; any failed validation throws |
| `studio_compose` | ffprobe measures durations → lays out the timeline → writes subtitles → ffmpeg renders, returns a `render_report`. **It does not advance state** — the report must be handed to `studio_stage` for recording |
| `studio_show` | Puts files that **already exist** in the project into the conversation for on-the-spot preview (film, narration, shots). Echo only — generates nothing, imports nothing, writes nothing |

The two-step split is deliberate: `studio_compose` only produces a file; whether the
trip counts is decided by `studio_stage`, after verifying the output file really exists.

The settings page registers through `installSettingsSection` under the `studio`
namespace; on a host without a settings service (headless) the section is simply not
registered, and `cordis.yml` values keep working.

Through `ctx.skills.register` the plugin registers **two** runtime skills
(overridable per project/user), split by trigger timing, not by topic:

| Skill | Covers | Loads when |
|---|---|---|
| `dsh-creative-studio-explainer` | How to make the film: the four stages, gate protocol, script & performance guidance, style contract | When starting a creation |
| `dsh-creative-studio-usage` | How the tools behave: who advances state, how input is normalized, error-code handling, retry semantics, path rules, the division of labor with dsh-comfyui | On errors, or when unsure about a tool's side effects |

Both render their binding table and style contract live from the current config.

## Project directory

```
<workspaceRoot>/<projectId>/
├── project.json              project identity
├── checkpoints/<stage>.json  per-stage state
│   └── history/              checkpoints that were overwritten
├── artifacts/<name>.json     brief / script / asset_manifest / render_report
├── assets/images/            generated imagery
├── assets/audio/             narration, plus music.wav (the film-wide music bed)
├── work/                     render scratch, deleted after render
└── output/                   the film and its .srt
```

`checkpoints/` and `artifacts/` are the state machine's private storage — do not edit
them with file tools.

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test               # end-to-end smoke test, needs ffmpeg
```

The smoke test runs the full chain on lavfi-synthesized material (307 assertions),
covering both state-machine red lines, schema validation, path-traversal blocking,
duration backfill, **frozen parameters**, style resolution and fallback, per-section
pause overrides, `apply()` mounting against a fake service (tool/skill/settings-section
registration, skill re-mount on config change, clean dispose), mid-batch validation,
real rendering, and "rewriting an early stage invalidates later stages".

Audio/video failures — the kind where "the file was generated but its content is wrong"
— are always verified by **measuring the output**, never by file size: subtitle burn-in
compares pixel difference between the same frame burned and unburned; music ducking
measures the level difference of music-band energy with and without narration.

There is also `test/integration-comfyui.mjs` (not part of `pnpm test`): it drives real
ComfyUI workflows end to end and asserts the sections' outputs differ from each other —
when a parameter fails to reach the workflow, ComfyUI's cache returns the same result,
the kind of failure that lets an all-green pipeline run on the wrong material.

### Music

The compose page has a **music** track. Enter a ComfyUI music workflow's name, click
"Add music", and the agent first reads the `dsh-creative-studio-sound-design` skill to
pick the piece, then generates through that workflow, and finally imports it into the
project with `kind: "music"` — **no `scene_id`**, because music belongs to the whole
film.

Three knobs: **volume, fade-in, fade-out**; click save when done (an "unsaved" marker
appears next to the button when there are pending changes). The defaults are the spec
values; changing one is a decision. **After saving, compose and the page preview run on
the same numbers** — if the preview disagreed with the film, it would have no reason to
exist.

Everything else is fixed by the spec and not exposed: these three are **audible**;
the EQ notch, the ducking ratio and the loudness targets answer questions you cannot
hear.

Full ffmpeg processing at compose time:

| Processing | Value | Source |
|---|---|---|
| Music bed | 20 dB below narration (adjustable −40 ~ −6) | W3C accessibility |
| Duck while narration speaks | ~8 dB (sidechain compression) | BBC; spec range 6–12 dB |
| Music EQ | −4 dB notch at 3 kHz, yielding the intelligibility band to speech | same |
| Fade in / out | 1.5 s / 2 s (each adjustable 0–20 s) | — |
| Overall loudness | −14 LUFS, true peak −1.5 dBTP (−1 for short-video platforms) | 2025 platform specs |

Loudness runs in **two passes**: measure first, then apply one fixed gain with
`linear=true`. Single-pass `loudnorm` is dynamic — it reads the gaps between sentences
as "too quiet" and pushes the music back up, undoing the ducking section by section,
without ever reporting an error.

A track shorter than the film loops automatically with a warning; loop seams are hard
cuts, so the skill says prefer a longer piece.

### Asset generation order

The skill hardcodes one work constraint: **finish every narration clip first, then
generate every image** — never alternate per section. Image and audio workflows run on
different models; alternating makes ComfyUI unload and reload models over and over,
and nearly all the time goes to load models.

Along with this, `in_progress` writes during `assets` **still validate paths and
scene_id**, skipping only the "every section has narration + imagery" coverage check —
a wrong path surfaces in the first batch, without waiting for all generation to finish.

## Lineage

The state machine is ported from [OpenMontage](https://github.com/calesthio/OpenMontage)'s
`lib/checkpoint.py`, the artifact schemas from its `schemas/artifacts/*.json`, and the
director instructions from `script-director`. Field names are preserved, so that
project's pipeline descriptions still hold here. What the port dropped is its flock of
siloed generation tools — anything ComfyUI can do was absorbed into workflow calls.

## License

MIT

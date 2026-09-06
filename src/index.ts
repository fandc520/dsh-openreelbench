/**
 * dsh-creative-studio host entry.
 *
 * Host-only by design: MVP-0 has no web surface, so the package declares no
 * `dsh.client` and builds no client bundle. The UI face arrives at M2, when
 * the stage event stream is stable enough to project into a Conversation Node.
 *
 * The plugin owns a state machine over a workspace directory and three tools.
 * It does not talk to ComfyUI — generation is delegated to dsh-comfyui's tools,
 * driven by the model, using the workflow bindings in this plugin's config.
 * That keeps the two plugins coupled only through the model's tool calls, so
 * neither has to depend on the other's service.
 *
 * Configuration has two doors into the same values: the loader entry in
 * cordis.yml, and the `studio:` settings section the browser settings page
 * writes. One schema drives both, and changes land live — nothing here
 * snapshots a config value at apply time.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: augments cordis Context with ctx.settings used by the inject below
import type {} from '@deepseek-ai/dsh-settings'

import { Config } from './config.js'
import { probeDuration } from './compose.js'
import { resolveWorkspaceRoot } from './project.js'
import { buildStudioSkill } from './skill.js'
import { STUDIO_CINEMATOGRAPHY_SKILL } from './skill-cinematography.js'
import { STUDIO_STORYTELLING_SKILL } from './skill-storytelling.js'
import { STUDIO_REVIEWER_SKILL } from './skill-reviewer.js'
import { STUDIO_USAGE_SKILL } from './skill-usage.js'
import { StateMachine } from './state.js'
import { type StudioRuntime, registerStudioTools } from './tools.js'
import { mountStudioRoutes } from './routes.js'

export const name = 'dsh-creative-studio'
export { Config }

/**
 * `tools` is the registry this plugin writes into, so the fiber must wait for
 * it. `skills` and `settings` stay out: a headless host without either should
 * still get the tools, just without the director guidance or the settings page.
 */
export const inject = ['tools']

const STUDIO_NS = 'studio'

interface SkillsService {
  register(skill: unknown): () => void
}

export function apply(ctx: Context, config: Config): void {
  /**
   * The live view of the configuration. Everything downstream reads through
   * this object, and a settings change assigns over it in place, so no caller
   * has to be told that the config moved.
   */
  const resolved: Config = { ...config }
  let source: () => Config = () => resolved

  const machine = new StateMachine({
    // Both read on every call rather than being captured, so a settings change
    // to the project root or the ffprobe path takes effect without a restart.
    workspaceRoot: () => resolveWorkspaceRoot(resolved.workspaceRoot),
    probeDuration: (absolutePath: string) => probeDuration(resolved.ffprobePath, absolutePath),
  })

  const runtime: StudioRuntime = {
    getConfig: () => resolved,
    machine,
  }

  ctx.effect(() => {
    const disposers = registerStudioTools(ctx, runtime)
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'dsh-creative-studio: tools')

  /**
   * The data plane behind the two panels. `webServer` is looked up rather than
   * injected: a headless host has none, and the tools must still work there —
   * the panels simply do not exist without a browser to render them.
   */
  // `ctx.inject` rather than `ctx.get`: the web server is a service that may
  // arrive after this plugin applies, and a one-shot `ctx.get` at apply time
  // silently gives up on it — every route then 404s for the life of the
  // process while the rest of the plugin looks healthy.
  ctx.inject(['webServer'], (webCtx: Context) => {
    webCtx.effect(() => {
      const dispose = mountStudioRoutes(webCtx, runtime)
      return () => dispose?.()
    }, 'dsh-creative-studio: routes')
  })

  /**
   * Two skills, split by trigger rather than by topic: `-explainer` loads when
   * the creative work starts, `-usage` when a tool misbehaves or its contract
   * is in question. Merging them would make every load pay for both.
   *
   * They are re-registered whenever configuration changes, because the binding
   * table and the style contract are rendered *into* the instruction text — a
   * skill left standing after a workflow is rebound would name the old one.
   *
   * Runtime skills register at a rank project and user skills can override, so
   * shipping this guidance does not lock anyone out of replacing it.
   */
  let skillDisposers: Array<() => void> = []

  function unmountSkills(): void {
    for (const dispose of skillDisposers.reverse()) dispose()
    skillDisposers = []
  }

  function mountSkills(): void {
    unmountSkills()
    const skills = ctx.get('skills') as SkillsService | undefined
    if (skills === undefined) return
    skillDisposers = [
      skills.register(buildStudioSkill(resolved)),
      skills.register(STUDIO_STORYTELLING_SKILL),
      skills.register(STUDIO_CINEMATOGRAPHY_SKILL),
      skills.register(STUDIO_REVIEWER_SKILL),
      skills.register(STUDIO_USAGE_SKILL),
    ]
  }

  ctx.effect(() => {
    mountSkills()
    return unmountSkills
  }, 'dsh-creative-studio: skills')

  /**
   * The settings section rides the plugin fiber: a host without a settings
   * service never registers it, and the entry config stands as composed. The
   * entry is passed as the base layer, so the settings page shows what
   * cordis.yml set and writes only the user's deltas on top.
   */
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, STUDIO_NS, Config, config, {
      setSource: (current) => {
        source = current as () => Config
      },
      onChange: () => {
        Object.assign(resolved, source())
        mountSkills()
      },
    })
  })
}

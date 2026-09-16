/**
 * dsh-openreelbench browser half.
 *
 * Today it contributes one surface: a standalone Settings page. It exists as a
 * separate plugin face because `installSettingsSection` on the host registers a
 * namespace and persists its values but renders nothing — the Settings sidebar
 * enumerates `settings.section` entries and mounts the active one in the
 * content column, so a page only appears for a plugin that ships a browser
 * half. A host-only plugin is invisible in Settings by construction.
 *
 * REGISTRATION TABLE — every surface this plugin contributes is one entry in
 * `apply` below, so growing the UI is adding an entry plus its component, not
 * restructuring this file. Slot names and their risk marks come from
 * `docs/PLUGIN_DEVELOPMENT.md` §8, the catalogue of all 48 mount points; check
 * a name there before adding a row, and prefer the `+` (additive) positions.
 * The M2 surfaces slot in here:
 *
 *   settings.section                  ← the Settings page (done; nav row id
 *                                       `openreel`, page content inside)
 *   tool.call.toolview  key=openreel_stage
 *                                     ← pipeline progress, and `awaiting_human`
 *                                       rendered as an approval card
 *   tool.call.toolview  key=openreel_show
 *                                     ← the media card (done)
 *   tool.call.toolview  key=openreel_compose
 *                                     ← the same card, so a finished render
 *                                       shows itself (done)
 *   conversation.input.dock           ← style / render-parameter strip
 *   conversation.session.header.actions
 *                                     ← a "films" button opening the library
 *
 * Rendering the pipeline through `tool.call.toolview` means the tool RESULT is
 * the data, so none of this needs `openreel_stage` to publish stage events onto
 * the session stream. A separate event stream would only be worth building for
 * a surface that has to show progress with no tool call on screen — the films
 * library, say — and not for anything M2 needs first.
 *
 * Contributions go through `slots.inject` rather than a bare `slots.register`
 * so they wait on the real slot declaration and unwind with this fiber.
 */
import { createElement as h } from 'react'

import type { Config } from '../config.ts'
import { OPENREEL_NAMESPACE, type ClientContext } from './scope.ts'
import { MediaCard } from './media-card.tsx'
import { SettingsSection } from './settings.tsx'
import { setLanguage, tx } from './i18n.ts'
import { injectStyles } from './styles.ts'
import { injectWorkbenchStyles } from './workbench-styles.ts'
import { Workbench } from './workbench.tsx'

export const name = 'dsh-openreelbench'

/**
 * `settingsScope` comes from `@deepseek-ai/dsh-client-ui-settings` and backs the
 * settings page; `conversation` is how OpenReel 创意台 hands a submitted gate back to
 * the model. Both are hard requirements of the surfaces registered below, so
 * unlike the host's optional `skills` they are injected rather than probed.
 */
export const inject = ['slots', 'settingsScope', 'sessions']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => injectStyles(), 'dsh-openreelbench: styles')
  ctx.effect(() => injectWorkbenchStyles(), 'dsh-openreelbench: workbench styles')

  // Bound on this fiber, so the scope's disposer unwinds with the plugin.
  const scope = ctx.settingsScope.bind<Config>({ namespace: OPENREEL_NAMESPACE })

  /*
   * The panel's language, pushed into one module-level store.
   *
   * Every surface reads it from there rather than being handed it: the tool
   * views are mounted by the shell with no provider above them, and a second
   * source for this would show one half of a screen in each language.
   */
  ctx.effect(() => {
    const sync = (): void => {
      const language = scope.getSnapshot().value?.language
      if (language === 'zh' || language === 'en') setLanguage(language)
    }
    sync()
    return scope.subscribe(sync)
  }, 'dsh-openreelbench: language')

  // One sidebar entry in Settings: the shell projects each settings.section
  // registration into a nav row (label/order) and renders its component in the
  // content column, passing { close }. The section id doubles as the storage
  // namespace, so the page and its data stay one unit.
  // OpenReel 创意台: a session view tab. Session scope is mandatory — the panel
  // submits gates by sending into the conversation, and `conversation.send`
  // refuses a root context.
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    {
      name: 'conversation.view',
      id: 'openreel',
      order: 40,
      label: () => tx('OpenReel 创意台'),
      // A session-scoped slot passes its session id to `inject`, and the face
      // returned here reaches the component as props. Sending goes through the
      // session's own `prompt` — see SessionsService for why the two more
      // obvious routes (root `conversation`, scoped `.conversation`) both fail.
      inject: (sessionId: string) => ({
        sessionId,
        send: async (text: string): Promise<void> => {
          const session = ctx.sessions.binding(sessionId)?.session
          if (session === undefined) {
            throw new Error(tx('OpenReel 创意台：会话 ') + sessionId + tx(' 已不可用，无法发送'))
          }
          const result = await session.prompt([{ type: 'text', text }], 'queue')
          if (!result.ok) {
            throw new Error(tx('发送失败：') + result.error.code + ' ' + result.error.message)
          }
        },
      }),
    },
    Workbench,
  ))

  // The media card. Both keys are this plugin's own tools, so registering them
  // is additive - neither takes a rendering away from a shipped tool.
  //
  // `openreel_show` exists because the agent could make media and had no way to
  // put it on screen; `openreel_compose` shares the card so a finished film shows
  // itself rather than waiting to be asked for.
  for (const tool of ['openreel_show', 'openreel_compose']) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key: tool },
      MediaCard,
    ))
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: OPENREEL_NAMESPACE, order: 40, label: () => tx('OpenReel 创意台') },
    () => h(SettingsSection, { scope }),
  ))
}
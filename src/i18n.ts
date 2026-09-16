/**
 * One dictionary, both runtimes.
 *
 * It started as a client-only thing, on the reasoning that only the panel has
 * labels. That was wrong in a way that only showed up on screen: half the prose
 * the panel displays is COMPOSED BY THE HOST — the advice lines from
 * `slideshow.ts` and `variation.ts` are built at scoring time out of a number
 * and a phrase, and the browser receives the finished sentence. A dictionary
 * keyed by source strings cannot look up a sentence that never existed as a
 * source string, so those lines stayed Chinese inside an English panel.
 *
 * So the dictionary lives here, where both sides can reach it, and each side
 * translates what it is the one to build:
 *
 *   host    sentences it assembles at runtime (the advice lines)
 *   client  everything it renders, including the host's CONSTANT tables
 *
 * The split follows one rule: a constant is translated where it is DISPLAYED,
 * never where it is declared. A `t()` inside a module-level table runs once, at
 * import, while the language is still on its default — and then never again.
 * That is why `pipelines.ts` and `playbooks.ts` keep their Chinese and the
 * panel wraps them, while the scoring functions translate in place.
 *
 * NOT for anything the model reads. The director skills stay Chinese whatever
 * this says: what they ask the model to PRODUCE travels as data, in
 * `content-language.ts`.
 */
import { EN } from './i18n-en.js'

export const UI_LANGUAGES = ['zh', 'en'] as const
export type UiLanguage = (typeof UI_LANGUAGES)[number]

/**
 * The live language.
 *
 * A module-level store rather than an argument threaded through every scoring
 * function. One harness serves one user, and the alternative is a `language`
 * parameter on functions whose subject is shot variation — which is how a
 * signature stops describing what a function is for.
 */
let current: UiLanguage = 'zh'

export function setLanguage(next: UiLanguage): void {
  current = next
}

export function getLanguage(): UiLanguage {
  return current
}

export function isLanguage(value: unknown): value is UiLanguage {
  return value === 'zh' || value === 'en'
}

/**
 * Translate one string.
 *
 * `zh` is the source text AND the key. An entry that is missing or empty falls
 * through to the source, so a half-filled dictionary degrades to Chinese
 * rather than to blanks.
 */
export function t(zh: string): string {
  if (current === 'zh') return zh
  const found = EN[zh]
  return found === undefined || found === '' ? zh : found
}

/** What the language picker offers. Native names, never translated. */
export const LANGUAGE_OPTIONS: ReadonlyArray<{ id: UiLanguage; label: string }> = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
]

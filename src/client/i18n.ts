/**
 * The panel's end of the shared dictionary.
 *
 * The dictionary and the language store live in `src/i18n.ts`, because the host
 * builds half the prose the panel shows (see the note there). This file adds
 * the one thing the browser needs and the host does not: a way for a component
 * to RE-RENDER when the language changes.
 */
import { useSyncExternalStore } from 'react'

import { type UiLanguage, getLanguage, setLanguage as setShared, t } from '../i18n.js'

export { LANGUAGE_OPTIONS, type UiLanguage } from '../i18n.js'

const listeners = new Set<() => void>()

/** Set the language for both halves, and repaint every subscribed tree. */
export function setLanguage(next: UiLanguage): void {
  if (next === getLanguage()) return
  setShared(next)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Translate. The same function the host uses, under a shorter name because the
 * panel calls it several hundred times.
 *
 * It READS the language without subscribing, so a tree that only calls `tx`
 * would not repaint on a change — `useT()` at each root is what does that.
 */
export const tx = t

/** Subscribe this tree to the language. One call per root is enough. */
export function useT(): (zh: string) => string {
  useSyncExternalStore(subscribe, getLanguage, getLanguage)
  return t
}

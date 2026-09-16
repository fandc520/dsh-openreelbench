/**
 * Card styles, injected once per client fiber.
 *
 * Colours come from the host's `--dsw-alias-*` tokens rather than literals, so
 * the card follows the app's theme instead of fighting it. Every rule is
 * namespaced under `.orb-` because this stylesheet lives in the same document
 * as every other plugin's.
 *
 * Shared by every surface this plugin will grow — the settings card today, the
 * pipeline node and approval card at M2 — which is why the tokens and the
 * field/row primitives are separated from the card-specific rules below.
 */
const STYLE_ID = 'dsh-openreelbench-styles'

const CSS = `
.orb-card { display: flex; flex-direction: column; gap: 14px; }

.orb-group { display: flex; flex-direction: column; gap: 10px; }
/* Boxed groups so the eye can skip a whole category at once. */
.orb-group-boxed {
  padding: 13px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
}
.orb-group-blurb {
  margin: -4px 0 4px; font-size: 12px; line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}
.orb-group-title {
  font-size: 12px; font-weight: 600; letter-spacing: .02em;
  color: var(--dsw-alias-label-tertiary);
  text-transform: none; margin: 2px 0 0;
}

.orb-field { display: flex; flex-direction: column; gap: 5px; }
.orb-field-head { display: flex; align-items: baseline; gap: 8px; }
.orb-label { font-size: 13px; color: var(--dsw-alias-label-primary); }
.orb-badge {
  font-size: 11px; line-height: 1.6; padding: 0 6px; border-radius: 4px;
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.orb-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }

.orb-input, .orb-select {
  width: 100%; box-sizing: border-box;
  padding: 6px 9px; font: inherit; font-size: 13px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px; outline: none;
}
.orb-input:focus, .orb-select:focus { border-color: var(--dsw-alias-brand-primary); }
.orb-input:disabled, .orb-select:disabled { opacity: .55; cursor: not-allowed; }
.orb-input.orb-invalid { border-color: var(--dsw-alias-state-error-primary); }

.orb-row { display: flex; gap: 10px; }
.orb-row > * { flex: 1; min-width: 0; }

.orb-check { display: flex; align-items: center; gap: 8px; }
.orb-check input { margin: 0; }

.orb-list { display: flex; flex-direction: column; gap: 6px; }
.orb-list-row { display: flex; align-items: center; gap: 6px; }
.orb-list-row .orb-input { flex: 1; min-width: 0; }
.orb-list-tag {
  flex: none; font-size: 11px; line-height: 1.6; padding: 0 6px; border-radius: 4px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
}
.orb-list-remove {
  flex: none; width: 24px; height: 24px; line-height: 1; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px; cursor: pointer;
}
.orb-list-remove:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }
.orb-list-remove:disabled { opacity: .4; cursor: default; }
.orb-list-add { align-self: flex-start; }

.orb-actions {
  display: flex; align-items: center; gap: 10px;
  padding-top: 4px; border-top: 1px solid var(--dsw-alias-border-l1);
}
.orb-spacer { flex: 1; }
.orb-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font: inherit; font-size: 13px; padding: 5px 14px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  text-decoration: none;
  cursor: pointer;
}
.orb-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.orb-btn:disabled { opacity: .5; cursor: default; }
.orb-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.orb-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }

.orb-note { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.orb-note-error { color: var(--dsw-alias-state-error-primary); }
.orb-note-ok { color: var(--dsw-alias-state-success-primary); }
.orb-note-warn { color: var(--dsw-alias-state-warn-primary); }

/* -- media card (tool.call.toolview: openreel_show / openreel_compose) --------- */

.orb-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-radius: 10px;
  background: var(--dsw-alias-background-secondary);
}
.orb-card--error {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}
.orb-card-note {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.orb-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}
/* A lone item is usually the point of the call - let it have the width. */
.orb-card-grid:has(> .orb-card-frame:only-child) { grid-template-columns: 1fr; }

.orb-card-frame {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  min-width: 0;
}
.orb-card-frame--audio { grid-column: 1 / -1; }

.orb-card-video,
.orb-card-image {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: contain;
  border-radius: 8px;
  background: #000;
}
.orb-card-image { cursor: zoom-in; }
.orb-card-audio { width: 100%; }

.orb-card-file {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  text-decoration: underline;
}
.orb-card-missing {
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-background-tertiary);
}

.orb-card-caption {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.orb-card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.orb-card-size { flex: none; }

.orb-card-get {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  text-decoration: none;
}
.orb-card-get:hover { color: var(--dsw-alias-label-primary); }

/* Text renders as text - a subtitle track is the one thing a download link
   makes impossible to check at a glance. */
.orb-card-text {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-background-tertiary);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.orb-card-frame--text { grid-column: 1 / -1; }

.orb-card-zoom {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  background: rgba(0, 0, 0, .8);
  cursor: zoom-out;
}
.orb-card-zoom img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
`

/** Inject the stylesheet; returns the disposer the caller's effect owns. */
export function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.appendChild(element)
  return () => {
    element.remove()
  }
}

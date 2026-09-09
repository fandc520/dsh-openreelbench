/**
 * Card styles, injected once per client fiber.
 *
 * Colours come from the host's `--dsw-alias-*` tokens rather than literals, so
 * the card follows the app's theme instead of fighting it. Every rule is
 * namespaced under `.dcs-` because this stylesheet lives in the same document
 * as every other plugin's.
 *
 * Shared by every surface this plugin will grow — the settings card today, the
 * pipeline node and approval card at M2 — which is why the tokens and the
 * field/row primitives are separated from the card-specific rules below.
 */
const STYLE_ID = 'dsh-creative-studio-styles'

const CSS = `
.dcs-card { display: flex; flex-direction: column; gap: 14px; }

.dcs-group { display: flex; flex-direction: column; gap: 10px; }
/* Boxed groups so the eye can skip a whole category at once. */
.dcs-group-boxed {
  padding: 13px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
}
.dcs-group-blurb {
  margin: -4px 0 4px; font-size: 12px; line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}
.dcs-group-title {
  font-size: 12px; font-weight: 600; letter-spacing: .02em;
  color: var(--dsw-alias-label-tertiary);
  text-transform: none; margin: 2px 0 0;
}

.dcs-field { display: flex; flex-direction: column; gap: 5px; }
.dcs-field-head { display: flex; align-items: baseline; gap: 8px; }
.dcs-label { font-size: 13px; color: var(--dsw-alias-label-primary); }
.dcs-badge {
  font-size: 11px; line-height: 1.6; padding: 0 6px; border-radius: 4px;
  color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dcs-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }

.dcs-input, .dcs-select {
  width: 100%; box-sizing: border-box;
  padding: 6px 9px; font: inherit; font-size: 13px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px; outline: none;
}
.dcs-input:focus, .dcs-select:focus { border-color: var(--dsw-alias-brand-primary); }
.dcs-input:disabled, .dcs-select:disabled { opacity: .55; cursor: not-allowed; }
.dcs-input.dcs-invalid { border-color: var(--dsw-alias-state-error-primary); }

.dcs-row { display: flex; gap: 10px; }
.dcs-row > * { flex: 1; min-width: 0; }

.dcs-check { display: flex; align-items: center; gap: 8px; }
.dcs-check input { margin: 0; }

.dcs-list { display: flex; flex-direction: column; gap: 6px; }
.dcs-list-row { display: flex; align-items: center; gap: 6px; }
.dcs-list-row .dcs-input { flex: 1; min-width: 0; }
.dcs-list-tag {
  flex: none; font-size: 11px; line-height: 1.6; padding: 0 6px; border-radius: 4px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
}
.dcs-list-remove {
  flex: none; width: 24px; height: 24px; line-height: 1; font-size: 14px;
  display: flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px; cursor: pointer;
}
.dcs-list-remove:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }
.dcs-list-remove:disabled { opacity: .4; cursor: default; }
.dcs-list-add { align-self: flex-start; }

.dcs-actions {
  display: flex; align-items: center; gap: 10px;
  padding-top: 4px; border-top: 1px solid var(--dsw-alias-border-l1);
}
.dcs-spacer { flex: 1; }
.dcs-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font: inherit; font-size: 13px; padding: 5px 14px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dcs-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-btn:disabled { opacity: .5; cursor: default; }
.dcs-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
.dcs-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }

.dcs-note { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dcs-note-error { color: var(--dsw-alias-state-error-primary); }
.dcs-note-ok { color: var(--dsw-alias-state-success-primary); }
.dcs-note-warn { color: var(--dsw-alias-state-warn-primary); }

/* -- media card (tool.call.toolview: studio_show / studio_compose) --------- */

.dcs-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-radius: 10px;
  background: var(--dsw-alias-background-secondary);
}
.dcs-card--error {
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
}
.dcs-card-note {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dcs-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}
/* A lone item is usually the point of the call - let it have the width. */
.dcs-card-grid:has(> .dcs-card-frame:only-child) { grid-template-columns: 1fr; }

.dcs-card-frame {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  min-width: 0;
}
.dcs-card-frame--audio { grid-column: 1 / -1; }

.dcs-card-video,
.dcs-card-image {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: contain;
  border-radius: 8px;
  background: #000;
}
.dcs-card-image { cursor: zoom-in; }
.dcs-card-audio { width: 100%; }

.dcs-card-file {
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  text-decoration: underline;
}
.dcs-card-missing {
  padding: 12px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary);
  background: var(--dsw-alias-background-tertiary);
}

.dcs-card-caption {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
}
.dcs-card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dcs-card-size { flex: none; }

.dcs-card-get {
  flex: none;
  color: var(--dsw-alias-label-secondary);
  text-decoration: none;
}
.dcs-card-get:hover { color: var(--dsw-alias-label-primary); }

/* Text renders as text - a subtitle track is the one thing a download link
   makes impossible to check at a glance. */
.dcs-card-text {
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
.dcs-card-frame--text { grid-column: 1 / -1; }

.dcs-card-zoom {
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
.dcs-card-zoom img {
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

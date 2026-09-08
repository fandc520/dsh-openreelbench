/**
 * Styles for 创意工作台 — the shell, the step rail, the welcome screen and the
 * stage screens.
 *
 * Kept apart from `styles.ts` (which dresses the settings page) because the two
 * surfaces have independent lifetimes: the settings page ships today, the stage
 * screens land one per round, and a single growing stylesheet would make every
 * change to one of them a diff against the other.
 *
 * Colours come from the host's `--dsw-alias-*` tokens rather than literals, so
 * the panel follows the app's theme instead of fighting it.
 */
const STYLE_ID = 'dsh-creative-studio-workbench-styles'

const CSS = `
/* --------------------------------------------------------------- shell */

.dcs-workbench {
  display: flex; flex-direction: column; gap: 16px;
  height: 100%; overflow-y: auto; padding: 20px 24px 40px;
  box-sizing: border-box; color: var(--dsw-alias-label-primary);
}
.dcs-centered { align-items: center; justify-content: center; }
.dcs-empty { display: flex; flex-direction: column; gap: 12px; align-items: center; }

.dcs-topbar { display: flex; align-items: center; gap: 12px; }
.dcs-topbar-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.dcs-topbar-title { font-size: 15px; font-weight: 600; }
.dcs-topbar-meta { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dcs-back {
  font: inherit; font-size: 16px; line-height: 1; cursor: pointer;
  width: 30px; height: 30px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}
.dcs-back:hover { background: var(--dsw-alias-interactive-bg-hover); }

/* ----------------------------------------------------------- step rail */

.dcs-rail { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
.dcs-step {
  display: flex; align-items: center; gap: 9px; flex: 1 1 0; min-width: 128px;
  padding: 9px 12px; border-radius: 10px; cursor: pointer; text-align: left;
  font: inherit; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
}
.dcs-step:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-step:disabled { opacity: .45; cursor: not-allowed; }
.dcs-step-current { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dcs-step-index {
  flex: none; width: 22px; height: 22px; border-radius: 50%;
  display: grid; place-items: center; font-size: 12px;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2);
}
.dcs-step-completed .dcs-step-index {
  background: var(--dsw-alias-state-success-primary); border-color: transparent; color: var(--dsw-alias-label-primary-foreground);
}
.dcs-step-awaiting_human .dcs-step-index {
  background: var(--dsw-alias-state-warn-primary); border-color: transparent; color: var(--dsw-alias-label-primary-foreground);
}
.dcs-step-failed .dcs-step-index {
  background: var(--dsw-alias-state-error-primary); border-color: transparent; color: var(--dsw-alias-label-primary-foreground);
}
.dcs-step-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dcs-step-label { font-size: 13px; display: flex; align-items: center; gap: 5px; }
.dcs-step-status { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dcs-tone-wait { color: var(--dsw-alias-state-warn-primary); font-weight: 550; }
.dcs-tone-ok { color: var(--dsw-alias-state-success-primary); font-weight: 550; }
.dcs-tone-bad { color: var(--dsw-alias-state-error-primary); font-weight: 550; }
.dcs-tone-active { color: var(--dsw-alias-brand-primary); }

/* ------------------------------------------------------------- welcome */

.dcs-welcome {
  display: flex; flex-direction: column; gap: 26px;
  max-width: 780px; margin: 0 auto; width: 100%;
}
.dcs-hero { text-align: center; padding-top: 26px; display: flex; flex-direction: column; gap: 6px; }
.dcs-hero-title { margin: 0; font-size: 27px; font-weight: 650; letter-spacing: -.01em; }
.dcs-hero-sub {
  margin: 0; font-size: 12px; letter-spacing: .16em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dcs-hero-line { margin: 8px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }

.dcs-composer {
  display: flex; flex-direction: column; gap: 8px; padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
}
.dcs-composer:focus-within { border-color: var(--dsw-alias-brand-primary); }
.dcs-composer-input {
  font: inherit; font-size: 14px; line-height: 1.6; resize: vertical;
  border: none; outline: none; background: transparent;
  color: var(--dsw-alias-label-primary);
}
.dcs-composer-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dcs-composer-foot { display: flex; align-items: center; gap: 10px; }

.dcs-section { display: flex; flex-direction: column; gap: 8px; }
.dcs-section-title { margin: 0; font-size: 13px; font-weight: 600; }
.dcs-section-hint { margin: 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }

/* Cards size to their own text and wrap, so one media type does not stretch
   into a banner and several sit side by side. */
.dcs-pipelines { display: flex; flex-wrap: wrap; gap: 10px; }
.dcs-pipeline {
  display: flex; flex-direction: column; gap: 3px; text-align: left; cursor: pointer;
  font: inherit; padding: 10px 14px; border-radius: 10px; width: auto; flex: 0 0 auto;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dcs-pipeline:hover:not(:disabled) {
  border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-hover);
}
.dcs-pipeline:disabled { opacity: .5; cursor: default; }
.dcs-pipeline-name { font-size: 14px; font-weight: 600; white-space: nowrap; }
.dcs-pipeline-desc { font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }

.dcs-projects { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dcs-project {
  position: relative; display: flex; align-items: stretch; gap: 4px;
  padding: 0; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.dcs-project:hover { border-color: var(--dsw-alias-brand-primary); }
.dcs-project-body {
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;
  text-align: left; cursor: pointer; font: inherit; padding: 11px 4px 11px 13px;
  background: transparent; border: none; color: inherit; border-radius: 9px;
}
.dcs-project-body:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-project-body:disabled { cursor: default; opacity: .6; }
.dcs-project-editing {
  flex-direction: column; gap: 7px; padding: 11px 13px;
}
.dcs-project-actions { display: flex; justify-content: flex-end; gap: 7px; }

/* A round hit area inset from the card edge: a full-height square butted
   against the rounded corner made the hover read as a torn-off panel. */
.dcs-kebab {
  flex: none; align-self: center; margin-right: 7px;
  width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center;
  cursor: pointer; font: inherit; font-size: 15px; line-height: 1;
  background: transparent; border: none;
  color: var(--dsw-alias-label-tertiary);
}
.dcs-kebab:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }

.dcs-menu {
  position: absolute; top: calc(100% - 4px); right: 4px; z-index: 20;
  display: flex; flex-direction: column; min-width: 116px; padding: 4px;
  border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 6px 20px rgba(0, 0, 0, .18);
}
.dcs-menu-item {
  font: inherit; font-size: 13px; text-align: left; cursor: pointer;
  padding: 6px 10px; border-radius: 6px; border: none;
  background: transparent; color: var(--dsw-alias-label-primary);
}
.dcs-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-menu-item-danger { color: var(--dsw-alias-state-error-primary); }
.dcs-menu-item-danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger); }

/* ---------------------------------------------------------------- shots */

.dcs-shot-detail { display: flex; gap: 16px; align-items: flex-start; }
.dcs-shot-image {
  flex: none; width: 320px; aspect-ratio: 16/9; border-radius: 10px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  display: grid; place-items: center;
}
.dcs-shot-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dcs-shot-empty { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dcs-shot-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }

.dcs-btn-hero {
  border-color: rgba(244, 213, 141, .55);
  color: rgb(244, 213, 141);
}

/* -- 创作建议 --------------------------------------------------------------- */
/* A dark box above the picture: it belongs to the plan, not to the shot being
   edited, and the darker ground is what says so. Collapsed to a single line
   when everything passed — the point of the pass state is that it costs one
   line, not that it is loud. */

.dcs-plan-advice {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: #15171b;
  overflow: hidden;
}
.dcs-plan-advice-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  padding: 6px 11px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dcs-plan-advice-head:hover { background: rgba(255, 255, 255, .04); }
.dcs-plan-advice-caret {
  flex: none;
  width: 10px;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
.dcs-plan-advice-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .04em;
  color: var(--dsw-alias-label-primary);
}

.dcs-plan-advice-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 2px 11px 9px 29px;
}
.dcs-plan-advice-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
  line-height: 1.7;
}
/* Fixed width so the two answers line up and can be compared at a glance. */
.dcs-plan-advice-label {
  flex: none;
  width: 60px;
  color: var(--dsw-alias-label-secondary);
}
.dcs-plan-advice-ok { color: var(--dsw-alias-state-success-primary); }
.dcs-plan-advice-warn { color: var(--dsw-alias-state-warn-primary); }
.dcs-plan-advice-fail { color: var(--dsw-alias-state-error-primary); }

.dcs-plan-advice-list {
  margin: 0 0 3px;
  padding-left: 70px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
  list-style: none;
}
.dcs-plan-advice-list li::before {
  content: '·　';
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}

/* The compose screen's slideshow-risk banner. Same section casualty as the
   three below: the markup outlived the stylesheet block it was written for. */

.dcs-variation {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-left-width: 3px;
  border-radius: 8px;
  background: var(--dsw-alias-background-secondary);
}
.dcs-variation-acceptable { border-left-color: var(--dsw-alias-border-secondary); }
.dcs-variation-revise { border-left-color: var(--dsw-alias-state-warn-primary); }
.dcs-variation-fail { border-left-color: var(--dsw-alias-state-error-primary); }
.dcs-variation-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dcs-variation-score { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dcs-variation-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

/* The three bits the advice list still uses. They were defined in a section
   that the panel rewrite replaced wholesale; the markup kept using them, and
   the classes went silently unstyled. */

.dcs-variation-tip {
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  font-style: italic;
}
.dcs-variation-shots { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 6px; }
.dcs-variation-jump {
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-radius: 999px;
  background: rgba(255, 255, 255, .06);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 17px;
  cursor: pointer;
}
.dcs-variation-jump:hover {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l2);
}

/* -- shot detail blocks ----------------------------------------------------- */
/* The label used to sit in a 30px column beside its content, which left the
   content a narrow strip and put four labels in a vertical gutter that read as
   a form. Promoting each to a title over its own block gives the content the
   full width and lets the four stack as four things rather than four rows. */

.dcs-shot-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.dcs-shot-block-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
  color: var(--dsw-alias-label-secondary);
  cursor: help;
}
.dcs-shot-block > .dcs-input,
.dcs-shot-block > .dcs-textarea { width: 100%; box-sizing: border-box; }

/* -- shot language + the built prompt -------------------------------------- */
/* Six small pickers rather than one wide row: these are the four layers that
   vary per shot, and they have to sit beside the picture without pushing it
   off screen. */

.dcs-shot-block-lang { gap: 6px; }
.dcs-lang-grid {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 6px 8px;
}
.dcs-lang-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dcs-lang-name {
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  letter-spacing: .02em;
}
/* Named for the grid it belongs to, not for its size.
   It was .dcs-select-small, which the script editor already used 594 lines
   later with a bigger font and a max-width — that rule won, and these six
   pickers rendered wider than designed. A shared adjective is not a name. */
.dcs-lang-select {
  padding: 2px 4px;
  font-size: 11px;
  line-height: 18px;
  min-width: 0;
  width: 100%;
  max-width: none;
}
/* Inheriting from the style is the resting state, not a warning - dimmed
   rather than marked, so a filled-in field is what draws the eye. */
.dcs-select-inherited { color: var(--dsw-alias-label-secondary); font-style: italic; }

.dcs-built {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-radius: 6px;
  background: var(--dsw-alias-background-tertiary);
  font-size: 11px;
  line-height: 1.5;
}
/* Each layer is its own chip: the point of the rewrite is that the prompt has
   parts, and a single run-on string would hide exactly that. */
.dcs-built-layer {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--dsw-alias-background-primary);
  color: var(--dsw-alias-label-primary);
}
.dcs-built-inherited {
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border: 1px dashed var(--dsw-alias-border-secondary);
}
.dcs-shot-head { display: flex; align-items: baseline; gap: 10px; }
.dcs-shot-where { font-size: 13px; font-weight: 600; }
.dcs-shot-text {
  margin: 0; font-size: 13px; line-height: 1.7; flex: none;
  color: var(--dsw-alias-label-secondary);
}
.dcs-shot-text-label { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dcs-shot-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
/* ---------------------------------------------------------- timeline */

.dcs-screen-wide { max-width: 1080px; }

/* Version bar: the plan first, then saved cuts, then a way to add one. */
.dcs-cutbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dcs-cut-wrap { position: relative; display: inline-flex; }
.dcs-cut {
  font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}
.dcs-cut:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-cut-active {
  border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary);
}
.dcs-cut-new { border-style: dashed; }

/* -- film / edit switch ---------------------------------------------------- */
/* One control, two states, no third option: the render is a mode you can
   leave, so it reads as a switch rather than as a button that does something. */

.dcs-mode {
  display: inline-flex;
  flex: none;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-radius: 999px;
  background: var(--dsw-alias-background-tertiary);
}
.dcs-mode-btn {
  padding: 3px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.dcs-mode-btn:hover { color: var(--dsw-alias-label-primary); }
.dcs-mode-on {
  background: var(--dsw-alias-background-primary);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .18);
}

/* Only shown when a render exists but is not what is playing - the one case
   where the picture on screen could be mistaken for the finished thing. */
.dcs-stage-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 3;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, .55);
  color: rgba(244, 213, 141, .92);
  font-size: 11px;
  line-height: 16px;
  pointer-events: none;
}
.dcs-cut-dot { color: var(--dsw-alias-state-warn-primary); margin-left: 4px; }
.dcs-cut-x {
  width: 16px; padding: 0; border: none; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-tertiary); font-size: 13px; opacity: 0;
}
.dcs-cut-wrap:hover .dcs-cut-x { opacity: 1; }
.dcs-cut-x:hover { color: var(--dsw-alias-state-error-primary); }

/* The screen. Black surround so the picture is the only bright thing. */
.dcs-stage {
  border-radius: 12px; overflow: hidden; background: #000;
  border: 1px solid var(--dsw-alias-border-l2);
  display: grid; place-items: center; min-height: 240px;
}
.dcs-player { width: 100%; max-height: 60vh; display: block; }
.dcs-stage-empty { padding: 40px 20px; text-align: center; }

/* Local preview: the current still, its cue, and one play control. */
.dcs-preview { position: relative; width: 100%; display: grid; place-items: center; }
.dcs-preview-frame { width: 100%; max-height: 60vh; object-fit: contain; display: block; }
.dcs-preview-sub {
  position: absolute; left: 0; right: 0; bottom: 8%; text-align: center;
  padding: 0 12%; font-size: 15px; line-height: 1.6; color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, .9), 0 0 10px rgba(0, 0, 0, .7);
  pointer-events: none;
}
.dcs-preview-play {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 58px; height: 58px;
  border-radius: 50%; cursor: pointer; font-size: 14px; line-height: 1;
  border: 1px solid rgba(255, 255, 255, .25);
  background: rgba(0, 0, 0, .55); color: #fff;
}
.dcs-preview-play { font-size: 18px; opacity: .82; transition: opacity .15s; }
.dcs-preview-play:hover { background: rgba(0, 0, 0, .78); opacity: 1; }
/* Out of the way while it plays, so the frame is the thing being judged. */
.dcs-preview-play-on { opacity: 0; }
.dcs-preview:hover .dcs-preview-play-on { opacity: .82; }

/* The filmstrip. Perforations top and bottom, dark stock between — the lanes
   read as one physical strip rather than three stacked lists. */
.dcs-film {
  border-radius: 8px; overflow: hidden;
  background: #15171b;
  border: 1px solid var(--dsw-alias-border-l2);
}
.dcs-film-perf {
  height: 12px; flex: none;
  background-color: #0d0f12;
  background-image: repeating-linear-gradient(
    to right,
    transparent 0 9px,
    rgba(255, 255, 255, .22) 9px 19px
  );
  background-size: auto 7px;
  background-position: 0 3px;
  background-repeat: repeat-x;
}
.dcs-film-body { position: relative; padding: 5px 12px 6px; }

.dcs-timecode {
  position: absolute; bottom: 10px; left: 12px; z-index: 3;
  display: inline-flex; align-items: baseline; gap: 5px;
  padding: 2px 9px; border-radius: 5px;
  background: rgba(0, 0, 0, .55);
  border: 1px solid rgba(255, 255, 255, .12);
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.dcs-timecode-now { font-size: 11px; color: #f4d58d; letter-spacing: .04em; }
.dcs-timecode-total { font-size: 11px; color: rgba(255, 255, 255, .45); }
.dcs-track { position: relative; display: flex; flex-direction: column; gap: 4px; }
.dcs-lane { display: flex; align-items: stretch; gap: 8px; }
.dcs-lane-label {
  flex: none; width: 34px; font: inherit; font-size: 11px; cursor: pointer;
  border: none; background: transparent; color: rgba(255, 255, 255, .45);
  text-align: right; padding: 0;
}
.dcs-lane-label:hover { color: #f4d58d; }
.dcs-lane-blocks { flex: none; display: flex; gap: 0; }

/* The scale. Deliberately faint: it is a reference the eye checks against,
   not something to read. */
.dcs-ruler { height: 19px; margin-bottom: 0; }
.dcs-ruler-track {
  position: relative; flex: none; height: 19px;
  cursor: ew-resize; touch-action: none;
}
/* A wider hit area than the ticks look, so aiming at the scale is easy. */
.dcs-ruler-track::before { content: ''; position: absolute; inset: -4px 0 -2px; }
.dcs-tick {
  position: absolute; bottom: 0; width: 1px; height: 4px;
  background: rgba(255, 255, 255, .14);
}
.dcs-tick-major { height: 8px; background: rgba(255, 255, 255, .26); }
.dcs-tick i {
  position: absolute; bottom: 8px; left: 2px; font-style: normal;
  font-size: 9px; line-height: 1; white-space: nowrap;
  color: rgba(255, 255, 255, .3);
  font-variant-numeric: tabular-nums;
}
.dcs-lane-label-plain { cursor: default; }
.dcs-lane-label-plain:hover { color: rgba(255, 255, 255, .45); }

/* Cues sit at their own offsets rather than tiling, because subtitles have
   gaps between them and a flex row would close every one. */
.dcs-lane-cues { position: relative; height: 20px; }
.dcs-cue {
  position: absolute; top: 0; height: 20px; min-width: 3px; overflow: hidden;
  padding: 0 4px; cursor: pointer; font: inherit; font-size: 10px;
  border-radius: 3px; text-align: left; white-space: nowrap; text-overflow: ellipsis;
  border: 1px solid rgba(255, 255, 255, .1);
  background: rgba(255, 255, 255, .04); color: rgba(255, 255, 255, .55);
}
.dcs-cue-live { border-color: #f4d58d; color: #fff; background: rgba(244, 213, 141, .16); }
.dcs-cue { display: flex; align-items: center; }
.dcs-cue-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Narrower than the audio pads: a cue block is often only a few pixels wide. */
.dcs-cue .dcs-pad-handle { width: 5px; }
.dcs-lane-sep { width: 1px; align-self: stretch; background: var(--dsw-alias-border-l1); margin: 0 4px; }

/* The music bed: one block the length of the film, because that is literally
   what it is after looping and trimming. Deliberately flatter than a shot or a
   take -- it is the thing everything else sits on top of, not a peer.

   NOT absolutely positioned. dcs-lane-blocks is an unpositioned flex row, so an
   absolute child resolves against whatever is positioned further up and lands
   over the ruler at the top of the track -- which is exactly what it did. The
   cue lane gets away with absolute positioning because it adds its own
   position: relative (dcs-lane-cues); it needs to, since cues sit at their own
   offsets. The bed is one block spanning the whole lane, so it can just be a
   flex child that fills it. */
.dcs-music-block {
  flex: 1 1 auto; width: 100%; height: 20px; overflow: hidden;
  padding: 0 6px; cursor: pointer; font: inherit; font-size: 10px;
  display: flex; align-items: center; text-align: left;
  border-radius: 3px; white-space: nowrap;
  border: 1px solid rgba(141, 196, 244, .28);
  background: rgba(141, 196, 244, .12); color: rgba(255, 255, 255, .6);
}
.dcs-music-block:hover { border-color: rgba(141, 196, 244, .5); color: #fff; }
.dcs-music-name { overflow: hidden; text-overflow: ellipsis; }

.dcs-music { gap: 9px; }
/* The workflow field stays narrow; the brief takes the rest of the row. */
.dcs-music-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dcs-music-form > .dcs-input { flex: 1 1 220px; min-width: 0; }
.dcs-input-small { width: 190px; }

/* Info area: what the one-line lanes had to leave out. */
.dcs-info { gap: 10px; }
.dcs-info-split { display: flex; gap: 18px; align-items: flex-start; }
.dcs-info-controls {
  display: flex; gap: 10px; align-items: flex-end;
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dcs-cue-editor {
  display: flex; flex-direction: column; gap: 7px;
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dcs-cue-actions { display: flex; align-items: center; gap: 6px; }
.dcs-facts {
  margin: 0; display: grid; gap: 6px 18px;
  grid-template-columns: repeat(3, auto) 1fr;
}
.dcs-facts > div { display: flex; gap: 8px; min-width: 0; }
.dcs-fact-wide { grid-column: 1 / -1; }
.dcs-facts dt {
  flex: none; width: 30px; font-size: 11px; color: var(--dsw-alias-label-tertiary);
}
.dcs-facts dd {
  margin: 0; min-width: 0; font-size: 12px; line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere; white-space: normal;
}
.dcs-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.dcs-block {
  position: relative; min-width: 0; overflow: hidden; cursor: pointer;
  padding: 0 6px; height: 26px;
  display: flex; align-items: center; gap: 6px; text-align: left;
  font: inherit; border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, .13);
  background: rgba(255, 255, 255, .06); color: rgba(255, 255, 255, .7);
}
.dcs-block:hover { background: rgba(255, 255, 255, .12); }
.dcs-block-drag { cursor: grab; }
/* Pads, drawn where they actually are so an editor can see the pause. */
.dcs-block-pad {
  position: absolute; top: 0; bottom: 0; z-index: 0; pointer-events: none;
  background: repeating-linear-gradient(
    45deg, transparent 0 4px, rgba(255, 255, 255, .07) 4px 8px
  );
}
.dcs-block-wave { position: absolute; top: 0; bottom: 0; }
/* Edge handles: the cursor is the affordance, so it changes on hover. */
.dcs-pad-handle {
  position: absolute; top: 0; bottom: 0; width: 7px; z-index: 2;
  cursor: ew-resize; touch-action: none;
}
.dcs-pad-handle-left { left: 0; }
.dcs-pad-handle-right { right: 0; }
.dcs-pad-handle:hover { background: rgba(244, 213, 141, .55); }
/* While a drag runs, nothing else should look selectable. */
body.dcs-dragging { user-select: none; cursor: grabbing; }
.dcs-block-drag:active { cursor: grabbing; }

/* Picked up: it rides the pointer, lifts off the strip, and stops animating
   its own position — a transition here would lag the hand carrying it. */
.dcs-block-lifted {
  z-index: 5; opacity: .92; transition: none;
  border-color: #f4d58d;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .5);
}
/* Let go: it settles into the slot instead of being teleported out of the
   hand, and the lift fades as it lands. */
/* Just landed: a brief glow so the eye can find where the picture went, since
   the slot numbers deliberately stay where they are. */
.dcs-block-settled { animation: dcs-settle .7s ease-out; }
@keyframes dcs-settle {
  from { box-shadow: inset 0 0 0 2px #f4d58d; background: rgba(244, 213, 141, .3); }
  to { box-shadow: inset 0 0 0 2px transparent; }
}
@media (prefers-reduced-motion: reduce) { .dcs-block-settled { animation: none; } }

.dcs-block-landing {
  z-index: 5;
  border-color: #f4d58d;
  transition: transform .16s ease, box-shadow .16s ease, opacity .16s ease;
}
/* The neighbour steps aside toward the gap the block would fill, so the space
   opens on the side the pointer is actually on. */
/* The transition lives on the drag classes, never on '.dcs-block' itself.
   When the write lands, the block moves to its new slot in the DOM *and* its
   transform resets in the same commit — with a standing transition the browser
   animates that reset, so the block starts a full slot to the left, overlapping
   its neighbour, and slides back. Both classes disappear on that same frame, so
   scoping the transition to them makes the reset instant and the bounce
   impossible. */
.dcs-block-shoved {
  border-color: rgba(244, 213, 141, .5);
  transition: transform .14s ease;
}
@media (prefers-reduced-motion: reduce) {
  .dcs-block-shoved, .dcs-block-landing { transition: none; }
}
.dcs-block-live {
  border-color: #f4d58d;
  background: rgba(244, 213, 141, .18);
  color: #fff;
}
.dcs-block-name {
  position: relative; z-index: 1; font-size: 11px; flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dcs-block-time {
  position: relative; z-index: 1; flex: 1; text-align: center; font-size: 10px;
  color: rgba(255, 255, 255, .75); font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .8);
}
/* The clip's shape, behind its label. */
.dcs-block-wave {
  z-index: 0; pointer-events: none;
  display: flex; align-items: center; gap: 1px; padding: 0 2px;
}
.dcs-block-wave i {
  flex: 1 1 0; min-width: 0; border-radius: 1px;
  background: rgba(255, 255, 255, .22);
}
.dcs-block-live .dcs-block-wave i { background: rgba(244, 213, 141, .38); }
/* The playhead spans every lane, because the lanes share one axis. */
.dcs-playhead {
  position: absolute; bottom: 0; top: 19px; width: 2px; pointer-events: none;
  background: #f4d58d; box-shadow: 0 0 6px rgba(244, 213, 141, .6);
}

/* ------------------------------------------------------- asset picker */

.dcs-picker-overlay {
  position: fixed; inset: 0; z-index: 60; display: grid; place-items: center;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, .5)); padding: 24px;
}
.dcs-picker {
  display: flex; flex-direction: column; gap: 10px;
  width: min(880px, 100%); max-height: min(680px, 88vh); padding: 14px;
  border-radius: 12px; box-sizing: border-box;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
}
.dcs-picker-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dcs-picker-tabs { display: flex; gap: 4px; }
.dcs-picker-tab {
  font: inherit; font-size: 12px; padding: 4px 11px; border-radius: 7px; cursor: pointer;
  border: 1px solid transparent; background: transparent;
  color: var(--dsw-alias-label-secondary);
}
.dcs-picker-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-picker-tab-active {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
/* A zone, not a button: it takes a drop and a paste as well as a click, and
   looking like a button would advertise only the third. */
.dcs-dropzone {
  flex: 1; min-width: 140px; max-width: 260px; min-height: 34px; margin: 0 auto;
  display: flex; align-items: center; justify-content: center; text-align: center;
  cursor: pointer; font-size: 12px; padding: 0 12px; border-radius: 7px;
  border: 1px dashed var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  transition: border-color .12s, color .12s;
}
.dcs-dropzone:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.dcs-picker-empty {
  padding: 40px 0; text-align: center; font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
}
.dcs-picker-grid { display: flex; gap: 8px; overflow-y: auto; flex: 1; }
.dcs-picker-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.dcs-picker-card {
  display: flex; flex-direction: column; gap: 3px; cursor: pointer; padding: 5px;
  border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.dcs-picker-card:hover { border-color: var(--dsw-alias-brand-primary); }
.dcs-picker-card-active { border-color: var(--dsw-alias-brand-primary); border-width: 2px; }
.dcs-picker-thumb { width: 100%; border-radius: 6px; display: block; }
.dcs-picker-thumb-other {
  height: 84px; display: grid; place-items: center; font-size: 22px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary);
}
.dcs-picker-name {
  font-size: 10px; color: var(--dsw-alias-label-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Bottom row: the hint on the left, the load area on the right. */
.dcs-bottom { display: flex; gap: 12px; align-items: stretch; }
.dcs-edit { flex: 1 1 0; min-width: 0; }
.dcs-info { flex: 1 1 0; min-width: 0; }

/* A hairline between the clip controls and the subtitle controls: they are two
   jobs in one panel, and a gap alone reads as accidental spacing. */
.dcs-divider { height: 1px; background: var(--dsw-alias-border-l1); margin: 2px 0; }

.dcs-facts-box {
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  display: flex; flex-direction: column; gap: 8px;
}
.dcs-facts-title {
  font-size: 12px; font-weight: 600;
  color: var(--dsw-alias-label-primary);
  padding-bottom: 6px; border-bottom: 1px solid var(--dsw-alias-border-l1);
}

/* Five buttons in one row; they wrap rather than squeeze on a narrow panel. */
.dcs-cue-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dcs-cue-actions .dcs-btn { padding: 4px 9px; }
.dcs-bottom-left { flex: 1 1 0; min-width: 0; }
.dcs-bottom-right { flex: 1 1 0; min-width: 0; }

/* Slots, after the ComfyUI panel's load area: a slot's POSITION is meaningful,
   because a workflow's loaders consume them in order. */
.dcs-slots { display: flex; gap: 8px; flex-wrap: wrap; }
.dcs-slot {
  position: relative; width: 92px; display: flex; flex-direction: column; gap: 3px;
  padding: 5px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.dcs-slot-empty { border-style: dashed; align-items: center; justify-content: center; min-height: 92px; }
.dcs-slot-empty:hover { border-color: var(--dsw-alias-brand-primary); }
.dcs-slot-busy { cursor: progress; }
.dcs-slot-index {
  position: absolute; top: 3px; left: 4px; z-index: 1;
  font-size: 10px; padding: 0 4px; border-radius: 3px;
  background: rgba(0, 0, 0, .55); color: #fff;
}
.dcs-slot-empty .dcs-slot-index { position: static; background: transparent; color: var(--dsw-alias-label-tertiary); }
.dcs-slot-media { width: 100%; height: 62px; object-fit: cover; border-radius: 6px; display: block; }
.dcs-slot-name {
  font-size: 10px; color: var(--dsw-alias-label-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dcs-slot-add { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dcs-slot-x {
  position: absolute; top: 3px; right: 3px; width: 17px; height: 17px; padding: 0;
  border: none; border-radius: 50%; cursor: pointer; font-size: 12px; line-height: 1;
  background: rgba(0, 0, 0, .6); color: #fff; opacity: 0;
}
.dcs-slot:hover .dcs-slot-x { opacity: 1; }

/* An audio slot has nothing to show, so the thumbnail area becomes the
   transport. Same 62px box as an image thumbnail, so a row of reference
   clips lines up with a row of reference images. */
.dcs-slot-audio {
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; cursor: pointer; padding: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
}
.dcs-slot-audio:hover { border-color: var(--dsw-alias-brand-primary); }
.dcs-slot-audio-on { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }

.dcs-derived {
  font-size: 12px; padding: 4px 9px; border-radius: 6px;
  border: 1px dashed var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary); white-space: nowrap;
}
.dcs-row-tight { align-items: center; gap: 8px; }
.dcs-check-box { flex: none; width: 15px; height: 15px; margin: 0; cursor: pointer; }
.dcs-field-narrow { flex: 0 0 110px; }
.dcs-self-end { align-self: flex-end; }

/* The strip: sections are groups, shots are the cards inside them. */
.dcs-shot-group {
  flex: none; display: flex; flex-direction: column; gap: 4px; min-width: 96px;
}
.dcs-shot-group-label {
  font-size: 11px; color: var(--dsw-alias-label-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding-left: 2px; border-left: 2px solid var(--dsw-alias-border-l2);
}
.dcs-shot-cards { display: flex; gap: 3px; }
.dcs-shot-card {
  flex: 1 1 0; min-width: 0; position: relative; padding: 0; cursor: pointer;
  aspect-ratio: 16/9; border-radius: 7px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.dcs-shot-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dcs-shot-card-current { border-color: var(--dsw-alias-brand-primary); border-width: 2px; }
.dcs-shot-card-empty { border-style: dashed; }
/* A shot holding the screen longer than the style advises. */
.dcs-shot-card-wide { border-color: var(--dsw-alias-state-warn-primary); }
.dcs-shot-card-hole {
  display: grid; place-items: center; height: 100%;
  font-size: 18px; color: var(--dsw-alias-label-tertiary);
}
.dcs-shot-card-time {
  position: absolute; right: 3px; bottom: 2px; font-size: 10px; padding: 0 3px;
  border-radius: 3px; background: rgba(0, 0, 0, .55); color: #fff;
}

/* ---------------------------------------------------------------- trash */

.dcs-disclosure {
  display: flex; align-items: center; gap: 7px; align-self: flex-start;
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  padding: 4px 2px; background: transparent; border: none;
  color: var(--dsw-alias-label-secondary);
}
.dcs-disclosure:hover { color: var(--dsw-alias-label-primary); }
.dcs-disclosure-caret { font-size: 10px; width: 10px; }
.dcs-count {
  font-size: 11px; font-weight: 500; padding: 0 6px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary);
}

.dcs-trash { display: flex; flex-direction: column; gap: 6px; }
.dcs-trash-row {
  display: flex; align-items: center; gap: 12px; padding: 9px 12px;
  border-radius: 9px; border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.dcs-trash-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dcs-trash-actions { flex: none; display: flex; align-items: center; gap: 7px; }
.dcs-btn-quiet-danger { color: var(--dsw-alias-state-error-primary); }
.dcs-btn-quiet-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }

.dcs-btn-danger {
  border-color: transparent;
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
.dcs-project-title { font-size: 13px; font-weight: 550; }
.dcs-project-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); }

/* ------------------------------------------------------------- screens */

.dcs-screen {
  display: flex; flex-direction: column; gap: 18px;
  max-width: 780px; width: 100%; margin: 0 auto;
}
.dcs-screen-head { display: flex; align-items: flex-start; gap: 12px; }
.dcs-screen-title { margin: 0; font-size: 17px; font-weight: 600; }
.dcs-screen-sub { margin: 3px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dcs-placeholder { padding-top: 40px; align-items: center; text-align: center; }

.dcs-pill {
  flex: none; font-size: 11px; padding: 3px 9px; border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary);
}
.dcs-pill-ok { color: var(--dsw-alias-state-success-primary); }
.dcs-pill-wait { color: var(--dsw-alias-state-warn-primary); }

.dcs-field-narrow { max-width: 168px; }
.dcs-textarea { line-height: 1.6; resize: vertical; }

.dcs-style-card {
  display: flex; flex-direction: column; gap: 7px; padding: 12px;
  border-radius: 10px; background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); font-size: 12px;
}
.dcs-style-line { display: flex; gap: 10px; color: var(--dsw-alias-label-secondary); }
.dcs-style-line > b { flex: none; width: 68px; font-weight: 550; color: var(--dsw-alias-label-tertiary); }
.dcs-anchors { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px; }

/* Agent-working indicator: one ring, reused by every phase. */
.dcs-busy { display: inline-flex; align-items: center; gap: 7px; }
.dcs-spinner {
  display: inline-block; width: 12px; height: 12px; flex: none;
  border: 2px solid currentColor; border-right-color: transparent;
  border-radius: 50%; opacity: .75;
  animation: dcs-spin .7s linear infinite;
}
@keyframes dcs-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .dcs-spinner { animation-duration: 2.4s; }
}

.dcs-group-head { display: flex; align-items: center; gap: 10px; }
.dcs-inline-pick { display: flex; align-items: center; gap: 6px; }
.dcs-select-small { font-size: 12px; padding: 3px 7px; width: auto; max-width: 260px; }
.dcs-btn-small { font-size: 12px; padding: 4px 11px; }

/* -------------------------------------------------------- script editor */

.dcs-summary {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 9px 13px; border-radius: 9px; font-size: 12px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}
.dcs-summary b { color: var(--dsw-alias-label-primary); font-weight: 600; }

.dcs-sections { display: flex; flex-direction: column; gap: 10px; }
.dcs-section-row {
  display: flex; flex-direction: column; gap: 7px; padding: 11px 13px;
  border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
/* Amber is advice, red is a blocker — the border says which before the text does. */
.dcs-section-advised { border-color: var(--dsw-alias-state-warn-primary); }
.dcs-section-error { border-color: var(--dsw-alias-state-error-primary); }
.dcs-section-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.dcs-inline-field { display: flex; flex-direction: column; gap: 2px; }
.dcs-inline-label { font-size: 10px; color: var(--dsw-alias-label-tertiary); letter-spacing: .04em; }
.dcs-seconds-wrap { display: flex; align-items: center; gap: 4px; }

/* A fixed gutter so 台词 / 画面 / 表达 line up down the column. */
.dcs-line { display: flex; align-items: flex-start; gap: 9px; }
.dcs-line > .dcs-row { flex: 1; min-width: 0; }
.dcs-line > .dcs-input { flex: 1; min-width: 0; }
.dcs-line-label {
  flex: none; width: 30px; padding-top: 7px; font-size: 11px; line-height: 1.4;
  color: var(--dsw-alias-label-tertiary); cursor: help;
}

.dcs-advice {
  margin: 0; padding: 7px 12px 7px 28px; border-radius: 8px; font-size: 12px;
  background: var(--dsw-alias-bg-layer-1);
  border-left: 2px solid var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-label-secondary);
  display: flex; flex-direction: column; gap: 3px;
}
.dcs-section-index {
  flex: none; width: 20px; height: 20px; border-radius: 50%;
  display: grid; place-items: center; font-size: 11px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary);
}
.dcs-input-id { max-width: 88px; font-family: ui-monospace, monospace; font-size: 12px; }
.dcs-input-label { max-width: 150px; }
.dcs-input-seconds { max-width: 62px; text-align: right; }
.dcs-unit { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dcs-prompt { font-family: ui-monospace, monospace; font-size: 12px; }

.dcs-icon {
  flex: none; width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
  display: grid; place-items: center; font: inherit; font-size: 13px;
  background: transparent; border: 1px solid transparent;
  color: var(--dsw-alias-label-tertiary);
}
.dcs-icon:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary);
}
.dcs-icon:disabled { opacity: .3; cursor: default; }
.dcs-icon-danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}

/* ------------------------------------------------------------ audio stage */

/* Two panels above, the takes below — the triangle. Collapses to one column
   when the view is too narrow for two readable halves. */
.dcs-triangle { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
/* A panel that owns its own row: slots wrap, so half a row is half the slots. */

/* A divider inside a panel, for a second subject that belongs to the same
   question rather than to a container of its own. */
.dcs-subhead {
  display: flex; align-items: baseline; gap: 8px;
  margin-top: 4px; padding-top: 9px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.dcs-subhead-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-text-l1); }
@media (max-width: 720px) { .dcs-triangle { grid-template-columns: 1fr; } }

.dcs-panel {
  display: flex; flex-direction: column; gap: 8px; padding: 13px;
  border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.dcs-takes { gap: 12px; }

.dcs-take-detail {
  display: flex; flex-direction: column; gap: 9px; padding: 12px;
  border-radius: 9px; background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
}
.dcs-take-text { margin: 0; font-size: 13px; line-height: 1.65; flex: 1; }
.dcs-audio { width: 100%; height: 32px; }

.dcs-wave { display: flex; flex-direction: column; gap: 4px; }
.dcs-wave-canvas {
  width: 100%; display: block; cursor: crosshair; touch-action: none;
  border-radius: 7px; background: var(--dsw-alias-bg-layer-2);
}
.dcs-wave-foot { min-height: 16px; }

/* Card width tracks measured duration, so the strip reads as a timeline. */
.dcs-strip-wrap { position: relative; }
/* The bar is hidden, not styled: it sat exactly where a wide card's edge is
   and competed with the cards for "where does the sequence end". */
.dcs-strip {
  display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden;
  padding-bottom: 2px; cursor: grab; scrollbar-width: none;
  scroll-behavior: auto; touch-action: pan-y;
}
.dcs-strip::-webkit-scrollbar { display: none; }
.dcs-strip:active { cursor: grabbing; }
.dcs-strip img, .dcs-strip button { user-select: none; -webkit-user-drag: none; }
.dcs-strip-arrow {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 2;
  width: 26px; height: 46px; padding: 0; cursor: pointer; font-size: 17px;
  border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  opacity: .9;
}
.dcs-strip-arrow:hover { background: var(--dsw-alias-interactive-bg-hover); opacity: 1; }
.dcs-strip-arrow-left { left: -6px; }
.dcs-strip-arrow-right { right: -6px; }
.dcs-strip-arrow:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dcs-take-card {
  /* Compact and uniform: this row picks a section, it does not measure time. */
  flex: none; width: 76px; display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
  padding: 7px 9px; border-radius: 9px; cursor: pointer; font: inherit; text-align: left;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.dcs-take-card:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dcs-take-current { border-color: var(--dsw-alias-brand-primary); }
.dcs-take-empty { border-style: dashed; opacity: .75; }
.dcs-take-all { border-color: var(--dsw-alias-border-l3); }
.dcs-take-all:disabled { opacity: .4; cursor: default; }
.dcs-take-index { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dcs-take-id {
  font-size: 12px; font-family: ui-monospace, monospace;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dcs-take-time { font-size: 11px; color: var(--dsw-alias-label-tertiary); }

.dcs-problems {
  margin: 0; padding: 9px 12px 9px 28px; border-radius: 8px; font-size: 12px;
  background: var(--dsw-alias-bg-layer-2);
  border-left: 2px solid var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-state-warn-primary);
  display: flex; flex-direction: column; gap: 3px;
}
`

/** Inject the stylesheet; returns the disposer the caller's effect owns. */
export function injectWorkbenchStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = CSS
  document.head.appendChild(element)
  return () => {
    element.remove()
  }
}

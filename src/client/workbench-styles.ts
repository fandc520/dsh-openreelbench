/**
 * Styles for OpenReel 创意台 — the shell, the step rail, the welcome screen and the
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
const STYLE_ID = 'dsh-openreelbench-workbench-styles'

const CSS = `
/* --------------------------------------------------------------- shell */

.orb-workbench {
  display: flex; flex-direction: column; gap: 16px;
  height: 100%; overflow-y: auto; padding: 20px 24px 40px;
  box-sizing: border-box; color: var(--dsw-alias-label-primary);

  /* Panel palette, extracted from the welcome poster so the page ornaments
     with the same two hues the hero paints with. Violet leads, teal is the
     rare second read; both stay on edges, icons and small marks — fills keep
     the theme's layers so the panel still looks native in both app themes. */
  --orb-accent: #7c5cff;
  --orb-accent-2: #2dd4bf;
  --orb-accent-soft: rgba(124, 92, 255, 0.16);
  /* The waveform's own gradient, vertical: cyan at the centerline easing to
     green at the peaks — colour doubles as an amplitude read. */
  --orb-wave-core: #22d3ee;
  --orb-wave-edge: #34d399;
}
.orb-centered { align-items: center; justify-content: center; }
.orb-empty { display: flex; flex-direction: column; gap: 12px; align-items: center; }

.orb-topbar { display: flex; align-items: center; gap: 12px; }
.orb-topbar-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.orb-topbar-title { font-size: 15px; font-weight: 600; }
.orb-topbar-meta { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.orb-back {
  font: inherit; font-size: 16px; line-height: 1; cursor: pointer;
  width: 30px; height: 30px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}
.orb-back:hover { background: var(--dsw-alias-interactive-bg-hover); }

/* ----------------------------------------------------------- step rail */

/* Thin links between the cards carry the "one line" reading; hover and the
   current state light the border only — a fill change would fight the
   card-eats-card look every other surface here uses. */
.orb-rail { display: flex; align-items: stretch; overflow-x: auto; padding-bottom: 2px; }
.orb-rail-link { flex: 0 0 12px; align-self: center; height: 1px; background: var(--dsw-alias-border-l2); }
.orb-step {
  display: flex; align-items: center; gap: 10px; flex: 1 1 0; min-width: 132px;
  padding: 10px 13px; border-radius: 11px; cursor: pointer; text-align: left;
  font: inherit; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.orb-step:hover:not(:disabled) { border-color: var(--orb-accent); }
.orb-step:disabled { opacity: .45; cursor: not-allowed; }
.orb-step-current {
  border-color: var(--orb-accent);
  box-shadow: 0 0 0 1px var(--orb-accent-soft), 0 0 18px -8px var(--orb-accent);
}
.orb-step-index {
  flex: none; width: 24px; height: 24px; border-radius: 50%;
  display: grid; place-items: center; font-size: 12px; font-weight: 600;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary);
}
.orb-step-glyph { display: block; }
.orb-step-completed .orb-step-index {
  background: var(--orb-accent-soft); border-color: transparent; color: var(--orb-accent);
}
.orb-step-awaiting_human .orb-step-index {
  background: var(--dsw-alias-state-warn-primary); border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground);
}
.orb-step-failed .orb-step-index {
  background: var(--dsw-alias-state-error-primary); border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground);
}
.orb-step-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.orb-step-label { font-size: 13px; display: flex; align-items: center; gap: 5px; }
.orb-step-status { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.orb-tone-wait { color: var(--dsw-alias-state-warn-primary); font-weight: 550; }
.orb-tone-ok { color: var(--dsw-alias-state-success-primary); font-weight: 550; }
.orb-tone-bad { color: var(--dsw-alias-state-error-primary); font-weight: 550; }
.orb-tone-active { color: var(--orb-accent); }

/* ------------------------------------------------------------- welcome */

.orb-welcome {
  display: flex; flex-direction: column; gap: 26px;
  max-width: 980px; margin: 0 auto; width: 100%;
}
/* The banner spans the workbench edge-to-edge; everything that is content —
   composer, notices, sections — keeps the reading column. The -24px must
   match .orb-workbench's inline padding. */
.orb-welcome > :not(.orb-hero) { width: 100%; max-width: 780px; margin-inline: auto; }

/* The poster hero: a dark screening-room band behind the title. It keeps its
   own palette on purpose — a screen reads as a screen in both app themes —
   while everything below it stays on the theme's tokens. */
.orb-hero { text-align: center; padding-top: 0; display: flex; flex-direction: column; }
.orb-poster {
  position: relative; overflow: hidden; border-radius: 18px;
  margin-inline: -24px;
  min-height: clamp(200px, 28vw, 290px);
  box-shadow: 0 14px 40px -26px rgba(6, 8, 24, 0.55);
}
.orb-poster-art { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.orb-poster-drift-a, .orb-poster-drift-b, .orb-poster-drift-c {
  transform-box: fill-box; transform-origin: center;
}
.orb-poster-drift-a { animation: orb-poster-drift 26s ease-in-out infinite; }
.orb-poster-drift-b { animation: orb-poster-drift 34s ease-in-out infinite reverse; }
.orb-poster-drift-c { animation: orb-poster-drift 22s ease-in-out infinite; animation-delay: -8s; }
.orb-poster-star { opacity: 0.2; animation: orb-poster-twinkle 4s ease-in-out infinite; }
/* Film strip — fixed-pixel HTML layer rather than part of the scaled SVG, so
   the sprocket holes keep their size no matter how wide the banner gets. */
.orb-poster-strip {
  position: absolute; left: 0; right: 0; bottom: 0; height: 32px;
  background: rgba(4, 5, 12, 0.72);
  border-top: 1px solid rgba(143, 155, 255, 0.22);
}
.orb-poster-strip::before {
  content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 14px;
  transform: translateY(-50%);
  background: repeating-linear-gradient(90deg, rgba(17, 21, 55, 0.9) 0 12px, transparent 12px 52px);
}
.orb-poster-body {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 13px; padding: 24px 24px 46px; text-align: center;
}
.orb-hero-title {
  margin: 0; font-size: clamp(26px, 5vw, 42px); font-weight: 700; letter-spacing: .015em;
  color: #f4f5ff;
  text-shadow: 0 2px 28px rgba(124, 92, 255, 0.5), 0 1px 2px rgba(4, 5, 12, 0.8);
}
.orb-hero-sub {
  margin: 0; font-size: 11px; letter-spacing: .38em; text-transform: uppercase;
  color: rgba(226, 230, 255, 0.62);
}
.orb-hero-tagline {
  margin: 2px 0 0; font-size: 12px; line-height: 1.8; letter-spacing: .05em;
  color: rgba(210, 215, 255, 0.6);
}

@keyframes orb-poster-drift {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  50% { transform: translate(34px, 12px) rotate(5deg); }
}
@keyframes orb-poster-twinkle {
  0%, 100% { opacity: 0.12; }
  50% { opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  .orb-poster-drift-a, .orb-poster-drift-b, .orb-poster-drift-c, .orb-poster-star { animation: none; }
  .orb-poster-star { opacity: 0.45; }
}

/* The composer sits in the reading column below the banner, with the
   welcome gap giving it air rather than riding on the art. */
.orb-composer {
  display: flex; flex-direction: column; gap: 8px; padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
}
.orb-composer:focus-within { border-color: var(--orb-accent); }
.orb-composer-input {
  font: inherit; font-size: 14px; line-height: 1.6; resize: vertical;
  border: none; outline: none; background: transparent;
  color: var(--dsw-alias-label-primary);
}
.orb-composer-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.orb-composer-foot { display: flex; align-items: center; gap: 10px; }

.orb-section { display: flex; flex-direction: column; gap: 8px; }
.orb-section-title { margin: 0; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 7px; }
/* Section marks lead with the accent; the text itself stays on theme labels. */
.orb-section-icon { flex: none; color: var(--orb-accent); }
.orb-disclosure .orb-section-icon { color: var(--orb-accent); }
.orb-section-hint { margin: 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }

/* Pipeline tags are slim pills: name and glyph on the face, the whole
   explanation in the hover tooltip. Hover moves the border to the accent and
   tints glyph+text — a fill change would be the third thing lighting up. */
.orb-pipelines { display: flex; flex-wrap: wrap; gap: 8px; }
.orb-pipeline {
  display: inline-flex; align-items: center; gap: 7px; cursor: pointer;
  font: inherit; padding: 7px 15px; border-radius: 999px; width: auto; flex: 0 0 auto;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  transition: border-color .14s ease, color .14s ease;
}
.orb-pipeline:hover:not(:disabled) {
  border-color: var(--orb-accent); color: var(--orb-accent);
}
.orb-pipeline:disabled { opacity: .5; cursor: default; }
.orb-pipeline-icon { flex: none; }
.orb-pipeline-name { font-size: 13px; font-weight: 550; white-space: nowrap; }

/* History is a responsive grid: cards keep a readable floor width and the
   column count follows the panel, instead of locking to two. */
.orb-projects { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(225px, 1fr)); }
.orb-project {
  position: relative; display: flex; align-items: stretch; gap: 4px;
  padding: 0; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  transition: border-color .14s ease, box-shadow .14s ease;
}
/* Border lights only. A fill change on the inner button half-lights the card
   (the kebab side stays dark), which read as two mismatched containers. */
.orb-project:hover { border-color: var(--orb-accent); box-shadow: 0 0 14px -6px var(--orb-accent); }
.orb-project-body {
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;
  text-align: left; cursor: pointer; font: inherit; padding: 11px 4px 11px 13px;
  background: transparent; border: none; color: inherit; border-radius: 9px;
}
.orb-project-body:disabled { cursor: default; opacity: .6; }
.orb-project-editing {
  flex-direction: column; gap: 7px; padding: 11px 13px;
}
.orb-project-actions { display: flex; justify-content: flex-end; gap: 7px; }

/* A round hit area inset from the card edge: a full-height square butted
   against the rounded corner made the hover read as a torn-off panel. */
.orb-kebab {
  flex: none; align-self: center; margin-right: 7px;
  width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center;
  cursor: pointer; font: inherit; font-size: 15px; line-height: 1;
  background: transparent; border: none;
  color: var(--dsw-alias-label-tertiary);
}
/* Mixed toward the label colour so the fill reads a step deeper than the card
   in both themes — the plain hover tint sat too close to the card's own ground. */
.orb-kebab:hover {
  background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 86%, var(--dsw-alias-label-primary) 14%);
  color: var(--dsw-alias-label-primary);
}

.orb-menu {
  position: absolute; top: calc(100% - 4px); right: 4px; z-index: 20;
  display: flex; flex-direction: column; min-width: 116px; padding: 4px;
  border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 6px 20px rgba(0, 0, 0, .18);
}
.orb-menu-item {
  font: inherit; font-size: 13px; text-align: left; cursor: pointer;
  padding: 6px 10px; border-radius: 6px; border: none;
  background: transparent; color: var(--dsw-alias-label-primary);
}
.orb-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.orb-menu-item-danger { color: var(--dsw-alias-state-error-primary); }
.orb-menu-item-danger:hover { background: var(--dsw-alias-interactive-bg-hover-danger); }

/* ---------------------------------------------------------------- shots */

/* One shot, two halves: the picture with its identity on the left, the
   prompt pipeline on the right. Stretch alignment, so the left column's
   bottom meets the timeline wherever the right column ends — the preview
   box absorbs the difference, and a portrait shot fills it upward first. */
.orb-shot-detail { display: grid; gap: 16px; align-items: stretch; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); }
@media (max-width: 880px) { .orb-shot-detail { grid-template-columns: 1fr; } }
.orb-shot-side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.orb-shot-image {
  flex: 1 1 auto; min-height: 240px; width: 100%; border-radius: 10px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 0 16px 34px -22px rgba(0, 0, 0, .65);
  display: grid; place-items: center;
}
/* Contain, pinned to the bottom: a landscape still rests on the timeline
   with its spare space above; a portrait one climbs to the top edge first. */
.orb-shot-image img {
  width: 100%; height: 100%; object-fit: contain; object-position: center bottom; display: block;
}
.orb-shot-empty { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.orb-shot-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }

/* The strip's toolbar: one contained bar, its commands centered — the row
   acts on the timeline right under it. The generate pair sits below the
   strip, right-aligned, batch left of single. */
.orb-shot-tools {
  display: flex; align-items: center; justify-content: center; gap: 7px; flex-wrap: wrap;
  padding: 8px 12px; border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
}
.orb-shot-foot { display: flex; align-items: center; gap: 8px; }

/* The themed secondary: a calm mid-point between the panel's two hues —
   teal pulled 30% toward violet so it does not shout. On hover the text
   resolves to the pure teal. */
.orb-btn-accent {
  border-color: color-mix(in srgb, var(--orb-accent-2) 70%, var(--orb-accent) 30%);
  color: color-mix(in srgb, var(--orb-accent-2) 70%, var(--orb-accent) 30%);
  background: transparent;
}
.orb-btn-accent:hover:not(:disabled) {
  border-color: var(--orb-accent-2);
  color: var(--orb-accent-2);
  background: color-mix(in srgb, var(--orb-accent-2) 10%, transparent);
}

.orb-btn-hero {
  border-color: rgba(244, 213, 141, .55);
  color: rgb(244, 213, 141);
  background: rgba(244, 213, 141, .12);
}

/* -- 创作建议 --------------------------------------------------------------- */
/* A dark box above the picture: it belongs to the plan, not to the shot being
   edited, and the darker ground is what says so. Collapsed to a single line
   when everything passed — the point of the pass state is that it costs one
   line, not that it is loud. */

.orb-plan-advice {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: #15171b;
  overflow: hidden;
}
.orb-plan-advice-head {
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
.orb-plan-advice-head:hover { background: rgba(255, 255, 255, .04); }
.orb-plan-advice-caret {
  flex: none;
  width: 10px;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}
.orb-plan-advice-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .04em;
  color: var(--dsw-alias-label-primary);
}

.orb-plan-advice-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 2px 11px 9px 29px;
}
.orb-plan-advice-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
  line-height: 1.7;
}
/* Fixed width so the two answers line up and can be compared at a glance. */
.orb-plan-advice-label {
  flex: none;
  width: 60px;
  color: var(--dsw-alias-label-secondary);
}
.orb-plan-advice-ok { color: var(--dsw-alias-state-success-primary); }
.orb-plan-advice-warn { color: var(--dsw-alias-state-warn-primary); }
/* The headline verdict on the bar reads at the title's size, not larger —
   it is a status, not a shout. */
.orb-plan-advice-head .orb-plan-advice-ok,
.orb-plan-advice-head .orb-plan-advice-warn { font-size: 12px; font-weight: 550; }
.orb-plan-advice-fail { color: var(--dsw-alias-state-error-primary); }

.orb-plan-advice-list {
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
.orb-plan-advice-list li::before {
  content: '·　';
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
}

/* The compose screen's slideshow-risk banner. Same section casualty as the
   three below: the markup outlived the stylesheet block it was written for. */

.orb-variation {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-left-width: 3px;
  border-radius: 8px;
  background: var(--dsw-alias-background-secondary);
}
.orb-variation-acceptable { border-left-color: var(--dsw-alias-border-secondary); }
.orb-variation-revise { border-left-color: var(--dsw-alias-state-warn-primary); }
.orb-variation-fail { border-left-color: var(--dsw-alias-state-error-primary); }
.orb-variation-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.orb-variation-score { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.orb-variation-list {
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

.orb-variation-tip {
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  font-style: italic;
}
.orb-variation-shots { display: inline-flex; flex-wrap: wrap; gap: 4px; margin-left: 6px; }
.orb-variation-jump {
  padding: 0 6px;
  border: 1px solid var(--dsw-alias-border-secondary);
  border-radius: 999px;
  background: rgba(255, 255, 255, .06);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 17px;
  cursor: pointer;
}
.orb-variation-jump:hover {
  color: var(--dsw-alias-label-primary);
  border-color: var(--dsw-alias-border-l2);
}

/* -- shot detail blocks ----------------------------------------------------- */
/* The label used to sit in a 30px column beside its content, which left the
   content a narrow strip and put four labels in a vertical gutter that read as
   a form. Promoting each to a title over its own block gives the content the
   full width and lets the four stack as four things rather than four rows. */

.orb-shot-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.orb-shot-block-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
  color: var(--dsw-alias-label-secondary);
  cursor: help;
}
.orb-shot-block > .orb-input,
.orb-shot-block > .orb-textarea { width: 100%; box-sizing: border-box; }

/* -- shot language + the built prompt -------------------------------------- */
/* Six small pickers rather than one wide row: these are the four layers that
   vary per shot, and they have to sit beside the picture without pushing it
   off screen. */

.orb-shot-block-lang { gap: 6px; }
.orb-lang-grid {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 6px 8px;
}
.orb-lang-cell { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.orb-lang-name {
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary));
  letter-spacing: .02em;
}
/* Named for the grid it belongs to, not for its size.
   It was .orb-select-small, which the script editor already used 594 lines
   later with a bigger font and a max-width — that rule won, and these six
   pickers rendered wider than designed. A shared adjective is not a name. */
.orb-lang-select {
  padding: 2px 4px;
  font-size: 11px;
  line-height: 18px;
  min-width: 0;
  width: 100%;
  max-width: none;
}
/* Inheriting from the style is the resting state, not a warning - dimmed
   rather than marked, so a filled-in field is what draws the eye. */
.orb-select-inherited { color: var(--dsw-alias-label-secondary); font-style: italic; }

.orb-built {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 5px;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1);
  font-size: 11px;
  line-height: 1.5;
}
/* Each layer is its own chip: the point of the rewrite is that the prompt has
   parts, and a single run-on string would hide exactly that. */
.orb-built-layer {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--dsw-alias-background-primary);
  color: var(--dsw-alias-label-primary);
}
.orb-built-inherited {
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border: 1px dashed var(--dsw-alias-border-secondary);
}
.orb-shot-head { display: flex; align-items: baseline; gap: 10px; }
.orb-shot-where { font-size: 13px; font-weight: 600; }
/* 台词 as a quote block: inset on layer-1 with a teal spine, so the one
   thing nobody edits reads as source material, not as another field. */
.orb-shot-text {
  margin: 0; padding: 9px 12px; font-size: 13px; line-height: 1.7;
  border-radius: 9px; background: var(--dsw-alias-bg-layer-1);
  border-left: 2px solid var(--orb-accent-2);
  color: var(--dsw-alias-label-secondary);
}
.orb-shot-text-label { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
/* ---------------------------------------------------------- timeline */

.orb-screen-wide { max-width: 1080px; }

/* Version bar: the plan first, then saved cuts, then a way to add one. Many
   versions scroll on ONE line instead of stacking rows — and the bar reserves
   30px below the chips (paid back by a negative margin) so the hover actions
   floating under a chip stay inside the scroll box instead of being clipped. */
.orb-cutbar {
  display: flex; align-items: center; gap: 6px; flex-wrap: nowrap;
  min-width: 0; flex: 1 1 auto;
  overflow-x: auto; overflow-y: hidden;
  padding: 2px 2px 30px; margin-bottom: -26px;
  scrollbar-width: thin;
}
.orb-cutbar > * { flex: none; }
.orb-cut-wrap { position: relative; display: inline-flex; }
.orb-cut {
  font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 7px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}
.orb-cut:hover { background: var(--dsw-alias-interactive-bg-hover); }
.orb-cut-active {
  border-color: var(--orb-accent);
  color: var(--orb-accent);
  background: var(--orb-accent-soft);
}
.orb-cut-new { border-style: dashed; }

/* -- film / edit switch ---------------------------------------------------- */
/* One control, two states, no third option: the render is a mode you can
   leave, so it reads as a switch rather than as a button that does something. */

.orb-mode {
  display: inline-flex;
  flex: none;
  padding: 3px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
}
.orb-mode-btn {
  padding: 3px 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.orb-mode-btn:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.orb-mode-btn:disabled { opacity: .45; cursor: default; }
.orb-mode-on {
  background: var(--orb-accent-soft);
  color: var(--orb-accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--orb-accent) 45%, transparent);
}

/* Only shown when a render exists but is not what is playing - the one case
   where the picture on screen could be mistaken for the finished thing. */
.orb-stage-badge {
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
.orb-cut-dot { color: var(--dsw-alias-state-warn-primary); margin-left: 4px; }
/* Rename / delete float UNDER the chip on hover, centered: the bar stays one
   chip tall and the commands read as owned by the chip above them. */
.orb-cut-actions {
  position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%);
  display: flex; gap: 4px; z-index: 6;
  opacity: 0; pointer-events: none; transition: opacity .12s ease;
}
.orb-cut-wrap:hover .orb-cut-actions,
.orb-cut-wrap:focus-within .orb-cut-actions { opacity: 1; pointer-events: auto; }
.orb-cut-x {
  width: 24px; height: 20px; padding: 0; cursor: pointer; font-size: 12px; line-height: 1;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}
.orb-cut-x:hover { color: var(--dsw-alias-state-error-primary); border-color: currentColor; }

/* The screen. Black surround so the picture is the only bright thing. The mode
   switch floats over it, top center: it changes what the picture IS. */
.orb-stage {
  position: relative;
  border-radius: 12px; overflow: hidden; background: #000;
  border: 1px solid var(--dsw-alias-border-l2);
  display: grid; place-items: center; min-height: 240px;
}
.orb-mode-overlay {
  position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 4;
  background: rgba(10, 12, 16, .42);
  border-color: rgba(255, 255, 255, .12);
  backdrop-filter: blur(6px);
}
.orb-mode-overlay .orb-mode-btn { color: rgba(255, 255, 255, .62); }
.orb-mode-overlay .orb-mode-btn:hover:not(:disabled) { color: #fff; }
.orb-mode-overlay .orb-mode-on {
  background: rgba(124, 92, 255, .3);
  color: #fff;
  box-shadow: inset 0 0 0 1px rgba(164, 148, 255, .5);
}

/* Picture and its facts, 7:3. The facts panel is an inset card next to the
   stage, so the numbers sit where the judgement is made. */
.orb-compose-stage-row {
  display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 3fr);
  gap: 12px; align-items: stretch;
}
.orb-shot-info {
  display: flex; flex-direction: column; gap: 10px; min-width: 0;
  padding: 12px; border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
}
.orb-shot-info .orb-facts-box {
  flex: 1; padding: 0; border: none; background: transparent;
}
@media (max-width: 1080px) {
  .orb-compose-stage-row { grid-template-columns: 1fr; }
}

/* The merged compose card's inner rows: versions above, toolbar below. */
.orb-compose-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.orb-compose-actions {
  display: grid; align-items: center; gap: 10px;
  grid-template-columns: 1fr auto 1fr;
  padding: 8px 12px; border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
}
.orb-compose-subtools { display: flex; align-items: center; gap: 10px; justify-content: center; flex-wrap: wrap; }
.orb-compose-run { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
@media (max-width: 880px) {
  .orb-compose-actions { grid-template-columns: 1fr; }
  .orb-compose-actions > [aria-hidden] { display: none; }
  .orb-compose-run { justify-content: center; }
}
.orb-player { width: 100%; max-height: 60vh; display: block; }

/* Empty states that point forward: a title, one line of why, and the doors
   to walk through — "这一镜还没有画面" as a dead end helped nobody. */
.orb-stage-guide {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 40px 24px; text-align: center;
}
.orb-stage-guide-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.orb-stage-guide-hint { margin: 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.orb-stage-guide-actions { display: flex; gap: 8px; margin-top: 10px; }

/* Local preview: the current still, its cue, and one play control. */
.orb-preview { position: relative; width: 100%; display: grid; place-items: center; }
.orb-preview-frame { width: 100%; max-height: 60vh; object-fit: contain; display: block; }
.orb-preview-sub {
  position: absolute; left: 0; right: 0; bottom: 8%; text-align: center;
  padding: 0 12%; font-size: 15px; line-height: 1.6; color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, .9), 0 0 10px rgba(0, 0, 0, .7);
  pointer-events: none;
}
.orb-preview-play {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 58px; height: 58px;
  border-radius: 50%; cursor: pointer; font-size: 14px; line-height: 1;
  border: 1px solid rgba(255, 255, 255, .25);
  background: rgba(0, 0, 0, .55); color: #fff;
}
.orb-preview-play { font-size: 18px; opacity: .82; transition: opacity .15s; }
.orb-preview-play:hover { background: rgba(0, 0, 0, .78); opacity: 1; }
/* Out of the way while it plays, so the frame is the thing being judged. */
.orb-preview-play-on { opacity: 0; }
.orb-preview:hover .orb-preview-play-on { opacity: .82; }

/* The filmstrip. Perforations top and bottom, dark stock between — the lanes
   read as one physical strip rather than three stacked lists. */
.orb-film {
  border-radius: 8px; overflow: hidden;
  background: #15171b;
  border: 1px solid var(--dsw-alias-border-l2);
}
.orb-film-perf {
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
.orb-film-body { position: relative; padding: 5px 12px 6px; }

.orb-timecode {
  position: absolute; bottom: 10px; left: 12px; z-index: 3;
  display: inline-flex; align-items: baseline; gap: 5px;
  padding: 2px 9px; border-radius: 5px;
  background: rgba(0, 0, 0, .55);
  border: 1px solid rgba(255, 255, 255, .12);
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.orb-timecode-now { font-size: 11px; color: #f4d58d; letter-spacing: .04em; }
.orb-timecode-total { font-size: 11px; color: rgba(255, 255, 255, .45); }
.orb-track { position: relative; display: flex; flex-direction: column; gap: 4px; }
.orb-lane { display: flex; align-items: stretch; gap: 8px; }
.orb-lane-label {
  flex: none; width: 34px; font: inherit; font-size: 11px; cursor: pointer;
  border: none; background: transparent; color: rgba(255, 255, 255, .45);
  text-align: right; padding: 0;
}
.orb-lane-label:hover { color: #f4d58d; }
.orb-lane-blocks { flex: none; display: flex; gap: 0; }

/* The scale. Deliberately faint: it is a reference the eye checks against,
   not something to read. */
.orb-ruler { height: 19px; margin-bottom: 0; }
.orb-ruler-track {
  position: relative; flex: none; height: 19px;
  cursor: ew-resize; touch-action: none;
}
/* A wider hit area than the ticks look, so aiming at the scale is easy. */
.orb-ruler-track::before { content: ''; position: absolute; inset: -4px 0 -2px; }
.orb-tick {
  position: absolute; bottom: 0; width: 1px; height: 4px;
  background: rgba(255, 255, 255, .14);
}
.orb-tick-major { height: 8px; background: rgba(255, 255, 255, .26); }
.orb-tick i {
  position: absolute; bottom: 8px; left: 2px; font-style: normal;
  font-size: 9px; line-height: 1; white-space: nowrap;
  color: rgba(255, 255, 255, .3);
  font-variant-numeric: tabular-nums;
}
.orb-lane-label-plain { cursor: default; }
.orb-lane-label-plain:hover { color: rgba(255, 255, 255, .45); }

/* Cues sit at their own offsets rather than tiling, because subtitles have
   gaps between them and a flex row would close every one. */
.orb-lane-cues { position: relative; height: 20px; }
.orb-cue {
  position: absolute; top: 0; height: 20px; min-width: 3px; overflow: hidden;
  padding: 0 4px; cursor: pointer; font: inherit; font-size: 10px;
  border-radius: 3px; text-align: left; white-space: nowrap; text-overflow: ellipsis;
  border: 1px solid rgba(255, 255, 255, .1);
  background: rgba(255, 255, 255, .04); color: rgba(255, 255, 255, .55);
}
.orb-cue-live { border-color: var(--orb-accent); color: #fff; background: rgba(124, 92, 255, .2); }
.orb-cue { display: flex; align-items: center; }
.orb-cue-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Narrower than the audio pads: a cue block is often only a few pixels wide. */
.orb-cue .orb-pad-handle { width: 5px; }
.orb-lane-sep { width: 1px; align-self: stretch; background: var(--dsw-alias-border-l1); margin: 0 4px; }

/* The music bed: one block the length of the film, because that is literally
   what it is after looping and trimming. Deliberately flatter than a shot or a
   take -- it is the thing everything else sits on top of, not a peer.

   NOT absolutely positioned. orb-lane-blocks is an unpositioned flex row, so an
   absolute child resolves against whatever is positioned further up and lands
   over the ruler at the top of the track -- which is exactly what it did. The
   cue lane gets away with absolute positioning because it adds its own
   position: relative (orb-lane-cues); it needs to, since cues sit at their own
   offsets. The bed is one block spanning the whole lane, so it can just be a
   flex child that fills it. */
.orb-music-block {
  flex: 1 1 auto; width: 100%; height: 20px; overflow: hidden;
  padding: 0 6px; cursor: pointer; font: inherit; font-size: 10px;
  display: flex; align-items: center; text-align: left;
  border-radius: 3px; white-space: nowrap;
  border: 1px solid rgba(141, 196, 244, .28);
  background: rgba(141, 196, 244, .12); color: rgba(255, 255, 255, .6);
}
.orb-music-block:hover { border-color: rgba(141, 196, 244, .5); color: #fff; }
.orb-music-name { overflow: hidden; text-overflow: ellipsis; }

.orb-music { gap: 9px; }
/* The workflow field stays narrow; the brief takes the rest of the row. */
.orb-music-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
/* The music column's save row: always hugs the right edge, wrap or not. */
.orb-music-save { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
.orb-music-form > .orb-input { flex: 1 1 220px; min-width: 0; }
.orb-input-small { width: 190px; }
.orb-input-tiny { width: 58px; }
/* Render progress. The label carries the meaning; the bar exists so a long
   silent phase still looks alive. */
.orb-render {
  display: flex; flex-direction: column; gap: 6px;
  padding: 9px 12px; margin: 8px 0;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-l2, rgba(255, 255, 255, .03));
}
.orb-render-head { display: flex; align-items: center; gap: 8px; }
.orb-render-label { font-size: 12px; }
/* Tabular figures so the percentage and clock do not jiggle as they tick. */
.orb-render-clock { font-variant-numeric: tabular-nums; }
.orb-render-bar {
  height: 4px; border-radius: 2px; overflow: hidden;
  background: rgba(255, 255, 255, .08);
}
.orb-render-fill {
  height: 100%; background: #f4d58d;
  /* Eased, because the bar advances in jumps between poll responses and an
     unanimated step reads as a stall followed by a glitch. */
  transition: width .4s ease-out;
}
/* Unsaved is stated in words as well as colour: the marker has to survive a
   reader who cannot tell the accent from the resting state.

   Its own class, NOT orb-btn-accent: that name means "ask the model again"
   and is used by six buttons on four screens. Both rules under one name meant
   the later one won, so every one of those six rendered in this gold instead
   of the accent -- silently, because a wrong colour still looks deliberate. */
.orb-music-dirty { color: #f4d58d; }
.orb-btn-dirty { border-color: rgba(244, 213, 141, .45); color: #f4d58d; }

/* Info area: what the one-line lanes had to leave out. */
.orb-info { gap: 10px; }
.orb-info-split { display: flex; gap: 18px; align-items: flex-start; }
.orb-info-controls {
  display: flex; gap: 10px; align-items: flex-end;
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.orb-cue-editor {
  display: flex; flex-direction: column; gap: 7px;
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.orb-cue-actions { display: flex; align-items: center; gap: 6px; }
.orb-facts {
  margin: 0; display: grid; gap: 6px 18px;
  grid-template-columns: repeat(3, auto) 1fr;
}
.orb-facts > div { display: flex; gap: 8px; min-width: 0; }
.orb-fact-wide { grid-column: 1 / -1; }
.orb-facts dt {
  flex: none; width: 30px; font-size: 11px; color: var(--dsw-alias-label-tertiary);
}
.orb-facts dd {
  margin: 0; min-width: 0; font-size: 12px; line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere; white-space: normal;
}
.orb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.orb-block {
  position: relative; min-width: 0; overflow: hidden; cursor: pointer;
  padding: 0 6px; height: 26px;
  display: flex; align-items: center; gap: 6px; text-align: left;
  font: inherit; border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, .13);
  background: rgba(255, 255, 255, .06); color: rgba(255, 255, 255, .7);
}
.orb-block:hover { background: rgba(255, 255, 255, .12); }
.orb-block-drag { cursor: grab; }
/* Pads, drawn where they actually are so an editor can see the pause. */
.orb-block-pad {
  position: absolute; top: 0; bottom: 0; z-index: 0; pointer-events: none;
  background: repeating-linear-gradient(
    45deg, transparent 0 4px, rgba(255, 255, 255, .07) 4px 8px
  );
}
.orb-block-wave { position: absolute; top: 0; bottom: 0; }
/* Edge handles: the cursor is the affordance, so it changes on hover. */
.orb-pad-handle {
  position: absolute; top: 0; bottom: 0; width: 7px; z-index: 2;
  cursor: ew-resize; touch-action: none;
}
.orb-pad-handle-left { left: 0; }
.orb-pad-handle-right { right: 0; }
.orb-pad-handle:hover { background: rgba(244, 213, 141, .55); }
/* While a drag runs, nothing else should look selectable. */
body.orb-dragging { user-select: none; cursor: grabbing; }
.orb-block-drag:active { cursor: grabbing; }

/* Picked up: it rides the pointer, lifts off the strip, and stops animating
   its own position — a transition here would lag the hand carrying it. */
.orb-block-lifted {
  z-index: 5; opacity: .92; transition: none;
  border-color: #f4d58d;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .5);
}
/* Let go: it settles into the slot instead of being teleported out of the
   hand, and the lift fades as it lands. */
/* Just landed: a brief glow so the eye can find where the picture went, since
   the slot numbers deliberately stay where they are. */
.orb-block-settled { animation: orb-settle .7s ease-out; }
@keyframes orb-settle {
  from { box-shadow: inset 0 0 0 2px #f4d58d; background: rgba(244, 213, 141, .3); }
  to { box-shadow: inset 0 0 0 2px transparent; }
}
@media (prefers-reduced-motion: reduce) { .orb-block-settled { animation: none; } }

.orb-block-landing {
  z-index: 5;
  border-color: #f4d58d;
  transition: transform .16s ease, box-shadow .16s ease, opacity .16s ease;
}
/* The neighbour steps aside toward the gap the block would fill, so the space
   opens on the side the pointer is actually on. */
/* The transition lives on the drag classes, never on '.orb-block' itself.
   When the write lands, the block moves to its new slot in the DOM *and* its
   transform resets in the same commit — with a standing transition the browser
   animates that reset, so the block starts a full slot to the left, overlapping
   its neighbour, and slides back. Both classes disappear on that same frame, so
   scoping the transition to them makes the reset instant and the bounce
   impossible. */
.orb-block-shoved {
  border-color: color-mix(in srgb, var(--orb-accent) 55%, transparent);
  transition: transform .14s ease;
}
@media (prefers-reduced-motion: reduce) {
  .orb-block-shoved, .orb-block-landing { transition: none; }
}
.orb-block-live {
  border-color: var(--orb-accent);
  background: rgba(124, 92, 255, .2);
  color: #fff;
}
.orb-block-name {
  position: relative; z-index: 1; font-size: 11px; flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.orb-block-time {
  position: relative; z-index: 1; flex: 1; text-align: center; font-size: 10px;
  color: rgba(255, 255, 255, .75); font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .8);
}
/* The clip's shape, behind its label. */
.orb-block-wave {
  z-index: 0; pointer-events: none;
  display: flex; align-items: center; gap: 1px; padding: 0 2px;
}
.orb-block-wave i {
  flex: 1 1 0; min-width: 0; border-radius: 1px;
  background: rgba(255, 255, 255, .22);
}
.orb-block-live .orb-block-wave i { background: rgba(164, 148, 255, .45); }
/* The playhead spans every lane, because the lanes share one axis. */
.orb-playhead {
  position: absolute; bottom: 0; top: 19px; width: 2px; pointer-events: none;
  background: var(--orb-accent); box-shadow: 0 0 6px rgba(124, 92, 255, .6);
}

/* ------------------------------------------------------- asset picker */

.orb-picker-overlay {
  position: fixed; inset: 0; z-index: 60; display: grid; place-items: center;
  background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, .5)); padding: 24px;
}
.orb-picker {
  display: flex; flex-direction: column; gap: 10px;
  width: min(880px, 100%); max-height: min(680px, 88vh); padding: 14px;
  border-radius: 12px; box-sizing: border-box;
  background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2);
}
.orb-picker-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.orb-picker-tabs { display: flex; gap: 4px; }
.orb-picker-tab {
  font: inherit; font-size: 12px; padding: 4px 11px; border-radius: 7px; cursor: pointer;
  border: 1px solid transparent; background: transparent;
  color: var(--dsw-alias-label-secondary);
}
.orb-picker-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.orb-picker-tab-active {
  background: var(--dsw-alias-bg-layer-2);
  border-color: var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
/* A zone, not a button: it takes a drop and a paste as well as a click, and
   looking like a button would advertise only the third. */
.orb-dropzone {
  flex: 1; min-width: 140px; max-width: 260px; min-height: 34px; margin: 0 auto;
  display: flex; align-items: center; justify-content: center; text-align: center;
  cursor: pointer; font-size: 12px; padding: 0 12px; border-radius: 7px;
  border: 1px dashed var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  transition: border-color .12s, color .12s;
}
.orb-dropzone:hover { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.orb-picker-empty {
  padding: 40px 0; text-align: center; font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
}
.orb-picker-grid { display: flex; gap: 8px; overflow-y: auto; flex: 1; }
.orb-picker-col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.orb-picker-card {
  display: flex; flex-direction: column; gap: 3px; cursor: pointer; padding: 5px;
  border-radius: 9px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.orb-picker-card:hover { border-color: var(--dsw-alias-brand-primary); }
.orb-picker-card-active { border-color: var(--dsw-alias-brand-primary); border-width: 2px; }
.orb-picker-thumb { width: 100%; border-radius: 6px; display: block; }
.orb-picker-thumb-other {
  height: 84px; display: grid; place-items: center; font-size: 22px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary);
}
.orb-picker-name {
  font-size: 10px; color: var(--dsw-alias-label-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Bottom row: the hint on the left, the load area on the right. */
.orb-bottom { display: flex; gap: 12px; align-items: stretch; }
.orb-edit { flex: 1 1 0; min-width: 0; }
.orb-info { flex: 1 1 0; min-width: 0; }

/* A hairline between the clip controls and the subtitle controls: they are two
   jobs in one panel, and a gap alone reads as accidental spacing. */
.orb-divider { height: 1px; background: var(--dsw-alias-border-l1); margin: 2px 0; }

.orb-facts-box {
  padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  display: flex; flex-direction: column; gap: 8px;
}
.orb-facts-title {
  font-size: 12px; font-weight: 600;
  color: var(--dsw-alias-label-primary);
  padding-bottom: 6px; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
/* Name above, value below, three across, spread over the full width: the
   facts panel is narrow, and one stacked row per number turned it into a
   ladder. */
.orb-facts-stats {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;
  justify-items: center; text-align: center;
  padding-bottom: 8px; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.orb-facts-stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.orb-facts-stat dt { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.orb-facts-stat dd {
  font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
}

/* Five buttons in one row; they wrap rather than squeeze on a narrow panel. */
.orb-cue-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.orb-cue-actions .orb-btn { padding: 4px 9px; }
.orb-bottom-left { flex: 1 1 0; min-width: 0; }
.orb-bottom-right { flex: 1 1 0; min-width: 0; }

/* Slots, after the ComfyUI panel's load area: a slot's POSITION is meaningful,
   because a workflow's loaders consume them in order. */
.orb-slots { display: flex; gap: 8px; flex-wrap: wrap; }
.orb-slot {
  position: relative; width: 92px; display: flex; flex-direction: column; gap: 3px;
  padding: 5px; border-radius: 9px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
/* The empty slot is a command, not a tile: a full-width flat row under the
   square media slots, ordinal first so the position stays readable. */
.orb-slot-empty {
  border-style: dashed; width: 100%; min-height: 0;
  flex-direction: row; align-items: center; justify-content: flex-start;
  gap: 8px; padding: 9px 11px; color: var(--dsw-alias-label-secondary);
}
.orb-slot-empty:hover { border-color: var(--orb-accent); color: var(--orb-accent); }
.orb-slot-busy { cursor: progress; }
.orb-slot-index {
  position: absolute; top: 3px; left: 4px; z-index: 1;
  font-size: 10px; padding: 0 4px; border-radius: 3px;
  background: rgba(0, 0, 0, .55); color: #fff;
}
.orb-slot-empty .orb-slot-index { position: static; background: transparent; color: var(--dsw-alias-label-tertiary); }
.orb-slot-media { width: 100%; height: 62px; object-fit: cover; border-radius: 6px; display: block; }
.orb-slot-name {
  font-size: 10px; color: var(--dsw-alias-label-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.orb-slot-add { font-size: 12px; color: inherit; }
.orb-slot-x {
  position: absolute; top: 3px; right: 3px; width: 17px; height: 17px; padding: 0;
  border: none; border-radius: 50%; cursor: pointer; font-size: 12px; line-height: 1;
  background: rgba(0, 0, 0, .6); color: #fff; opacity: 0;
}
.orb-slot:hover .orb-slot-x { opacity: 1; }

/* An audio slot has nothing to show, so the thumbnail area becomes the
   transport. Same 62px box as an image thumbnail, so a row of reference
   clips lines up with a row of reference images. */
.orb-slot-audio {
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; cursor: pointer; padding: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
}
.orb-slot-audio:hover { border-color: var(--orb-accent); color: var(--orb-accent); }
.orb-slot-audio-on { color: var(--orb-accent); border-color: var(--orb-accent); background: var(--orb-accent-soft); }

.orb-derived {
  font-size: 12px; padding: 4px 9px; border-radius: 6px;
  border: 1px dashed var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-tertiary); white-space: nowrap;
}
.orb-row-tight { align-items: center; gap: 8px; }
.orb-check-box { flex: none; width: 15px; height: 15px; margin: 0; cursor: pointer; }
.orb-field-narrow { flex: 0 0 110px; }
.orb-self-end { align-self: flex-end; }

/* The strip: sections are groups, shots are the cards inside them. */
.orb-shot-group {
  flex: none; display: flex; flex-direction: column; gap: 4px; min-width: 96px;
}
.orb-shot-group-label {
  font-size: 11px; color: var(--dsw-alias-label-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding-left: 2px; border-left: 2px solid var(--dsw-alias-border-l2);
}
.orb-shot-cards { display: flex; gap: 3px; }
.orb-shot-card {
  flex: 1 1 0; min-width: 0; position: relative; padding: 0; cursor: pointer;
  aspect-ratio: 16/9; border-radius: 7px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.orb-shot-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
.orb-shot-card-current { border-color: var(--dsw-alias-brand-primary); border-width: 2px; }
.orb-shot-card-empty { border-style: dashed; }
/* A shot holding the screen longer than the style advises. */
.orb-shot-card-wide { border-color: var(--dsw-alias-state-warn-primary); }
.orb-shot-card-hole {
  display: grid; place-items: center; height: 100%;
  font-size: 18px; color: var(--dsw-alias-label-tertiary);
}
.orb-shot-card-time {
  position: absolute; right: 3px; bottom: 2px; font-size: 10px; padding: 0 3px;
  border-radius: 3px; background: rgba(0, 0, 0, .55); color: #fff;
}

/* ---------------------------------------------------------------- trash */

.orb-disclosure {
  display: flex; align-items: center; gap: 7px; align-self: flex-start;
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  padding: 4px 2px; background: transparent; border: none;
  color: var(--dsw-alias-label-secondary);
}
.orb-disclosure:hover { color: var(--dsw-alias-label-primary); }
.orb-disclosure-caret { font-size: 10px; width: 10px; }
.orb-count {
  font-size: 11px; font-weight: 500; padding: 0 6px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary);
}

.orb-trash { display: flex; flex-direction: column; gap: 6px; }
.orb-trash-row {
  display: flex; align-items: center; gap: 12px; padding: 9px 12px;
  border-radius: 9px; border: 1px dashed var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}
.orb-trash-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.orb-trash-actions { flex: none; display: flex; align-items: center; gap: 7px; }
.orb-btn-quiet-danger { color: var(--dsw-alias-state-error-primary); }
.orb-btn-quiet-danger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); }

.orb-btn-danger {
  border-color: transparent;
  background: var(--dsw-alias-state-error-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
.orb-project-title {
  font-size: 13px; font-weight: 550;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.orb-project-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); }

/* ------------------------------------------------------------- screens */

.orb-screen {
  display: flex; flex-direction: column; gap: 18px;
  max-width: 780px; width: 100%; margin: 0 auto;
}
.orb-screen-head { display: flex; align-items: flex-start; gap: 12px; }
.orb-screen-title { margin: 0; font-size: 17px; font-weight: 600; }
.orb-screen-sub { margin: 3px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.orb-placeholder { padding-top: 40px; align-items: center; text-align: center; }

.orb-pill {
  flex: none; font-size: 11px; padding: 3px 9px; border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary);
}
.orb-pill-ok { color: var(--dsw-alias-state-success-primary); }
.orb-pill-wait { color: var(--dsw-alias-state-warn-primary); }

.orb-field-narrow { max-width: 168px; }
.orb-textarea { line-height: 1.6; resize: vertical; }

.orb-style-card {
  display: flex; flex-direction: column; gap: 7px; padding: 12px;
  border-radius: 10px; background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1); font-size: 12px;
}
.orb-style-line { display: flex; gap: 10px; color: var(--dsw-alias-label-secondary); }
.orb-style-line > b { flex: none; width: 84px; font-weight: 550; color: var(--dsw-alias-label-tertiary); }
.orb-style-glyph { color: var(--orb-accent); margin-right: 5px; vertical-align: -2px; }
.orb-anchors { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 3px; }

/* -- cards ---------------------------------------------------------------- */
/* One bordered container with head / body / foot rows: the screen reads as
   three stacked decisions instead of a loose column of bare fields. */

.orb-card {
  display: flex; flex-direction: column;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2); overflow: hidden;
}
.orb-card-head {
  display: flex; align-items: center; gap: 8px; padding: 7px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  position: relative;
}
/* One violet-to-teal hairline under every card head — the quietest possible
   echo of the poster, so a wall of cards still reads as one instrument. */
.orb-card-head::after {
  content: ''; position: absolute; left: 12px; right: 12px; bottom: -1px; height: 1px;
  background: linear-gradient(90deg, var(--orb-accent), var(--orb-accent-2) 42%, transparent 85%);
  opacity: .5;
}
.orb-card-title { margin: 0; font-size: 13px; font-weight: 600; }
.orb-card-mark {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  background: var(--orb-accent-soft); color: var(--orb-accent);
}
.orb-card-body { display: flex; flex-direction: column; gap: 11px; padding: 8px 12px; }
/* Stats on a card head: quiet metadata between the title and its action. */
.orb-card-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-left: 6px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.orb-card-meta b { font-weight: 600; color: var(--dsw-alias-label-secondary); }
.orb-add-section {
  font: inherit; font-size: 13px; cursor: pointer; color: var(--dsw-alias-label-secondary);
  padding: 9px; border-radius: 9px; border: 1px dashed var(--dsw-alias-border-l2);
  background: transparent; transition: border-color .14s ease, color .14s ease;
}
.orb-add-section:hover { border-color: var(--orb-accent); color: var(--orb-accent); }
.orb-card-foot {
  display: flex; align-items: center; gap: 10px; padding: 6px 12px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.orb-btn-icon { flex: none; }

/* Settings row: the three identity choices side by side. */
.orb-setgrid {
  display: grid; gap: 13px 14px;
  grid-template-columns: minmax(0, 1.8fr) 110px minmax(0, 1.25fr);
}
@media (max-width: 880px) {
  .orb-setgrid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
/* Style row: the picker on the left, its preview card filling the right. */
.orb-style-row {
  display: grid; gap: 14px; align-items: start;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
}
@media (max-width: 880px) {
  .orb-style-row { grid-template-columns: 1fr; }
}

/* The page's one commitment. Accent gradient, centered, loud on purpose —
   every field above funnels into this one button. */
.orb-cta { display: flex; flex-direction: column; align-items: center; gap: 9px; padding-top: 2px; }
.orb-cta-primary {
  display: inline-flex; align-items: center; gap: 9px; cursor: pointer; font: inherit;
  font-size: 15px; font-weight: 650; letter-spacing: .02em; color: #fff;
  text-decoration: none;
  padding: 13px 44px; border: none; border-radius: 12px;
  background: linear-gradient(135deg, #8b5cf6 0%, #7c5cff 45%, #5a3df0 100%);
  box-shadow: 0 10px 26px -10px rgba(124, 92, 255, 0.6);
  transition: filter .15s ease, box-shadow .15s ease, transform .15s ease;
}
.orb-cta-primary:hover:not(:disabled) {
  filter: brightness(1.08);
  box-shadow: 0 12px 30px -10px rgba(124, 92, 255, 0.72);
}
.orb-cta-primary:active:not(:disabled) { transform: translateY(1px); }
.orb-cta-primary:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.orb-cta-icon { flex: none; }
.orb-cta-hint { margin: 0; font-size: 12px; color: var(--dsw-alias-label-tertiary); text-align: center; }

/* Agent-working indicator: one ring, reused by every phase. */
.orb-busy { display: inline-flex; align-items: center; gap: 7px; }
.orb-spinner {
  display: inline-block; width: 12px; height: 12px; flex: none;
  border: 2px solid currentColor; border-right-color: transparent;
  border-radius: 50%; opacity: .75;
  animation: orb-spin .7s linear infinite;
}
@keyframes orb-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .orb-spinner { animation-duration: 2.4s; }
}

.orb-group-head { display: flex; align-items: center; gap: 10px; }
.orb-inline-pick { display: flex; align-items: center; gap: 6px; }
.orb-select-small { font-size: 12px; padding: 3px 7px; width: auto; max-width: 260px; }
.orb-btn-small { font-size: 12px; padding: 4px 11px; }

/* -------------------------------------------------------- script editor */

.orb-sections { display: flex; flex-direction: column; gap: 10px; }
/* Rows sit on layer-1: inside the layer-2 card they read as inset material,
   one step deeper than the container that holds them. */
.orb-section-row {
  display: flex; flex-direction: column; gap: 7px; padding: 11px 13px;
  border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
/* Amber is advice, red is a blocker — the border says which before the text does. */
.orb-section-advised { border-color: var(--dsw-alias-state-warn-primary); }
.orb-section-error { border-color: var(--dsw-alias-state-error-primary); }
.orb-section-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.orb-inline-field { display: flex; flex-direction: column; gap: 2px; }
.orb-inline-label { font-size: 10px; color: var(--dsw-alias-label-tertiary); letter-spacing: .04em; }
.orb-seconds-wrap { display: flex; align-items: center; gap: 4px; }

/* A fixed gutter so 台词 / 画面 / 表达 line up down the column. */
.orb-line { display: flex; align-items: flex-start; gap: 9px; }
.orb-line > .orb-row { flex: 1; min-width: 0; }
.orb-line > .orb-input { flex: 1; min-width: 0; }
.orb-line-label {
  flex: none; width: 30px; padding-top: 7px; font-size: 11px; line-height: 1.4;
  color: var(--dsw-alias-label-tertiary); cursor: help;
}

.orb-advice {
  margin: 0; padding: 7px 12px 7px 28px; border-radius: 8px; font-size: 12px;
  background: var(--dsw-alias-bg-layer-1);
  border-left: 2px solid var(--dsw-alias-state-warn-primary);
  color: var(--dsw-alias-label-secondary);
  display: flex; flex-direction: column; gap: 3px;
}
.orb-section-index {
  flex: none; width: 20px; height: 20px; border-radius: 50%;
  display: grid; place-items: center; font-size: 11px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-tertiary);
}
.orb-input-id { max-width: 88px; font-family: ui-monospace, monospace; font-size: 12px; }
.orb-input-label { max-width: 150px; }
.orb-input-seconds { max-width: 62px; text-align: right; }
.orb-unit { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.orb-prompt { font-family: ui-monospace, monospace; font-size: 12px; }

.orb-icon {
  flex: none; width: 24px; height: 24px; border-radius: 6px; cursor: pointer;
  display: grid; place-items: center; font: inherit; font-size: 13px;
  background: transparent; border: 1px solid transparent;
  color: var(--dsw-alias-label-tertiary);
}
.orb-icon:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary);
}
.orb-icon:disabled { opacity: .3; cursor: default; }
.orb-icon-danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}

/* ------------------------------------------------------------ audio stage */

/* A card body in two halves with a hairline between; collapses to one column
   when the view is too narrow for two readable halves. */
.orb-duo-split { display: grid; gap: 16px; align-items: start; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.orb-duo-col { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.orb-duo-col + .orb-duo-col { padding-left: 16px; border-left: 1px solid var(--dsw-alias-border-l1); }
@media (max-width: 880px) {
  .orb-duo-split { grid-template-columns: 1fr; }
  .orb-duo-col + .orb-duo-col {
    padding-left: 0; border-left: none;
    padding-top: 14px; border-top: 1px solid var(--dsw-alias-border-l1);
  }
}
.orb-col-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.orb-col-head > b { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.orb-col-foot { display: flex; align-items: center; gap: 10px; }

/* A divider inside a panel, for a second subject that belongs to the same
   question rather than to a container of its own. */
.orb-subhead {
  display: flex; align-items: baseline; gap: 8px;
  margin-top: 4px; padding-top: 9px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.orb-subhead-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-text-l1); }

.orb-panel {
  display: flex; flex-direction: column; gap: 8px; padding: 13px;
  border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
}

.orb-take-detail {
  display: flex; flex-direction: column; gap: 9px; padding: 12px;
  border-radius: 9px; background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
}
.orb-take-text { margin: 0; font-size: 13px; line-height: 1.65; flex: 1; }
.orb-audio { width: 100%; height: 32px; }

.orb-wave { display: flex; flex-direction: column; gap: 4px; }
.orb-wave-canvas {
  width: 100%; display: block; cursor: crosshair; touch-action: none;
  border-radius: 7px; background: var(--dsw-alias-bg-layer-2);
}
.orb-wave-foot { min-height: 16px; }

/* Card width tracks measured duration, so the strip reads as a timeline. */
.orb-strip-wrap { position: relative; }
/* The bar is hidden, not styled: it sat exactly where a wide card's edge is
   and competed with the cards for "where does the sequence end". */
.orb-strip {
  display: flex; gap: 8px; overflow-x: auto; overflow-y: hidden;
  padding-bottom: 2px; cursor: grab; scrollbar-width: none;
  scroll-behavior: auto; touch-action: pan-y;
}
.orb-strip::-webkit-scrollbar { display: none; }
.orb-strip:active { cursor: grabbing; }
.orb-strip img, .orb-strip button { user-select: none; -webkit-user-drag: none; }
.orb-strip-arrow {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 2;
  width: 26px; height: 46px; padding: 0; cursor: pointer; font-size: 17px;
  border-radius: 7px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  opacity: .9;
}
.orb-strip-arrow:hover { background: var(--dsw-alias-interactive-bg-hover); opacity: 1; }
.orb-strip-arrow-left { left: -6px; }
.orb-strip-arrow-right { right: -6px; }
.orb-strip-arrow:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.orb-take-card {
  /* One line per card — ordinal, id, then the duration behind a hairline.
     This row picks a section; it does not measure time, so no card is wider
     than another and the long ones do not push the rest off screen. */
  flex: none; min-width: 96px; display: flex; align-items: center; gap: 7px;
  padding: 8px 11px; border-radius: 9px; cursor: pointer; font: inherit; text-align: left;
  border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.orb-take-card:hover { background: var(--dsw-alias-interactive-bg-hover); }
.orb-take-current { border-color: var(--orb-accent); box-shadow: 0 0 0 1px var(--orb-accent-soft); }
.orb-take-empty { border-style: dashed; opacity: .75; }
.orb-take-all { border-color: var(--dsw-alias-border-l3); }
.orb-take-all:disabled { opacity: .4; cursor: default; }
.orb-take-index { font-size: 10px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.orb-take-id {
  font-size: 12px; font-family: ui-monospace, monospace;
  max-width: 9em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.orb-take-time {
  font-size: 11px; color: var(--dsw-alias-label-tertiary); white-space: nowrap;
  margin-left: auto; padding-left: 8px; border-left: 1px solid var(--dsw-alias-border-l1);
}

.orb-problems {
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

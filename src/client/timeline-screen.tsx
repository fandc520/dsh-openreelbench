/**
 * 成片 — where the material becomes a work.
 *
 * Everything upstream produces *material*, and any of it can be thrown away and
 * re-rolled for the price of machine time. This screen is where a person
 * watches the whole thing in sync and decides that a pause runs long or a cut
 * lands early — judgements that cannot be made anywhere else, because nowhere
 * else plays the picture and the audio together.
 *
 * Two consequences shape the whole screen:
 *
 * **Editing happens here, not by going back.** Sending someone to the shots
 * screen to shorten a beat they felt at 0:23 breaks the only perception that
 * could have told them it was wrong. So the timing controls live under the
 * player, and what they produce is a CUT: an override layer over the plan. The
 * film is allowed to differ from the plan, the way a finished film differs from
 * its screenplay.
 *
 * **Cuts are saved and named.** Upstream, being wrong costs GPU minutes. Here it
 * costs an editor's attention, and no re-roll gives that back — so a version is
 * kept, comparable, and exported on its own terms.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { type Cut, type CutSection, type StudioState, api } from './api.ts'
import { type AgentPhase, BusyLabel } from './busy.tsx'
import { AdvicePanel } from './advice-panel.tsx'
import { Strip } from './strip.tsx'
import { Preview } from './preview.ts'

export interface TimelineScreenProps {
  state: StudioState
  onReload: () => Promise<void>
  onSend: (text: string) => Promise<void>
  onGoToStage: (stageId: string) => void
  /** Owned by the workbench, because `onReload` has to fetch this cut's plan. */
  cutId: string
  onSelectCut: (id: string) => void
}

const NEWLINE = String.fromCharCode(10)

/**
 * Pixels per second — the timeline's one unit.
 *
 * Everything used to be a percentage of the total, which meant the track always
 * filled its width: lengthening a pause re-proportioned the blocks instead of
 * making anything longer, so the edit that mattered most was the one the
 * timeline could not show. It also put the playhead's percentage on a box that
 * included the 42px label column, so its error grew the further right it went.
 * One unit, one origin, fixes both.
 */
/** What each slideshow dimension is called on screen. */
const RISK_LABELS: Record<string, string> = {
  repetition: '画面重复',
  decorative_visuals: '镜头用心',
  static_hold: '单张停留',
  picture_rate: '画面密度',
  unsupported_style_claim: '风格兑现',
}

const DEFAULT_PPS = 30
/** How far the scale can be zoomed. Below the floor a shot is unclickable;
 *  above the ceiling a short film scrolls for screens with nothing on it. */
const MIN_PPS = 6
const MAX_PPS = 160
/** Label column plus its gap; the lanes' content starts here. */
const LANE_LABEL = 42

/**
 * How much a 延长 button moves a cue boundary.
 *
 * Small enough that a press is a nudge rather than a commitment — this is
 * tuning by ear, and the button exists for the cases where a drag is too
 * coarse to land on.
 */
const CUE_STEP = 0.2

/** Must match `.dcs-block`'s right margin, or the gaps drift as blocks move. */
const BLOCK_GAP = 2

function pxAt(seconds: number, pps: number): string {
  return (seconds * pps).toFixed(1) + 'px'
}

/** A lane block: where it sits, how long, and what it stands for. */
interface Block {
  key: string
  sectionId: string
  label: string
  start: number
  duration: number
  /** Shot index within its section, for the picture lane. */
  shotIndex?: number
  /** Duration is overlaid on the audio lane only; the picture lane names shots. */
  showTime?: boolean
  /** How many shots share this block's section — one means nothing to reorder. */
  siblings?: number
  /** A CSS gradient standing in for the clip's shape. */
  waveform?: number[]
  /** Silence before and after the speech, as a share of the block. */
  leadShare?: number
  tailShare?: number
}

/** Just the file name — the info area names material, it does not locate it. */
function fileNameOf(path: string | undefined): string | undefined {
  if (path === undefined || path === '') return undefined
  return path.split('/').pop()
}

/**
 * A stand-in waveform for the audio lane.
 *
 * Decoding every clip to draw real peaks would download the whole film just to
 * paint a background; what the lane needs to say is only "there is sound here,
 * and this much of the block is silence". Heights come from the section id, so
 * the shape is stable across renders — a background that reshuffles every frame
 * reads as noise rather than as material.
 */
const waveformCache = new Map<string, number[]>()

function waveformOf(sectionId: string): number[] {
  // Cached by id, and the id is all it depends on. Rebuilding per render gave
  // the array a new identity every frame, so all 48 bars of every section
  // re-reconciled on each pointer move — which is why dragging an audio pad
  // stuttered while the cue lane, with nothing like it, stayed smooth.
  const hit = waveformCache.get(sectionId)
  if (hit !== undefined) return hit
  let seed = 0
  for (const character of sectionId) seed = (seed * 31 + character.charCodeAt(0)) >>> 0
  const bars: number[] = []
  // The bars cover the speech region only — the pads are drawn beside it, so a
  // silent stretch inside the waveform would be saying it twice.
  for (let index = 0; index < 48; index += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0
    bars.push(20 + (seed % 60))
  }
  waveformCache.set(sectionId, bars)
  return bars
}

/** Memoised so an unchanged bar array skips reconciliation entirely. */
const Waveform = memo(function Waveform({ bars }: { bars: number[] }): JSX.Element {
  return (
    <>
      {bars.map((height, index) => <i key={index} style={{ height: height + '%' }} />)}
    </>
  )
})

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return pad(Math.floor(whole / 60)) + ':' + pad(whole % 60)
    + '.' + Math.floor((Math.max(0, seconds) % 1) * 10)
}

export function TimelineScreen({
  state, onReload, onSend, onGoToStage, cutId, onSelectCut,
}: TimelineScreenProps): JSX.Element {
  const [phase, setPhase] = useState<AgentPhase | null>(null)
  /**
   * Whether the user has chosen to render past a blocking slideshow score.
   *
   * Held here rather than sent silently: `studio_compose` refuses at 4.0, and
   * the only thing that should lift that is a person saying so after seeing
   * the number. Reset on every reload, so the decision is about this cut.
   */
  const [forceRender, setForceRender] = useState(false)
  /**
   * Whether this export bakes the subtitles in, and how they sit.
   *
   * Per export rather than per install: the same project goes to a platform
   * that plays a sidecar .srt and to one that does not, and the answer differs
   * between those two exports of the identical cut. The setting is the default
   * this starts from, not the decision.
   */
  const [burnSubtitles, setBurnSubtitles] = useState<'off' | 'outline' | 'box'>('off')
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [at, setAt] = useState(0)
  const player = useRef<HTMLVideoElement | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const preview = useRef<Preview | null>(null)
  const padTimer = useRef<number | undefined>(undefined)
  /** The pad being dragged right now, so the lane can follow the pointer. */
  const [cueDraft, setCueDraft] = useState<string | null>(null)
  const cueBox = useRef<HTMLTextAreaElement | null>(null)
  /** In-flight creation of the first cut, shared by every edit in a burst. */
  const creating = useRef<Promise<Cut> | null>(null)
  const [dragPad, setDragPad] = useState<
    { sectionId: string; edge: 'lead' | 'tail'; seconds: number; trim: number } | null>(null)
  /**
   * The cue boundary being dragged, so the lane can follow the pointer.
   *
   * Without it the block only moved once the write came back, which reads as
   * the drag having done nothing until it suddenly did — the gesture has to
   * show its own effect while it is happening.
   */
  const [dragShot, setDragShot] = useState<DragShot | null>(null)
  /**
   * The block that just landed, briefly.
   *
   * Slot numbers stay put through a reorder — slot 1 is slot 1, and it is the
   * pictures that moved between them. That is the honest reading, but it leaves
   * nothing on screen tracking where the carried shot ended up, so it says so
   * itself for a moment.
   */
  const [landed, setLanded] = useState<string | null>(null)
  useEffect(() => {
    if (landed === null) return undefined
    const timer = window.setTimeout(() => setLanded(null), 700)
    return () => window.clearTimeout(timer)
  }, [landed])
  const [dragCue, setDragCue] = useState<
    { sectionId: string; index: number; edge: 'left' | 'right'; delta: number } | null>(null)

  const [pps, setPps] = useState(DEFAULT_PPS)
  const film = useRef<HTMLDivElement | null>(null)
  const px = (seconds: number): string => pxAt(seconds, pps)
  /** The live scale for the wheel listener, which is bound once. */
  const ppsRef = useRef(pps)
  ppsRef.current = pps

  const risk = state.slideshow
  const cut = state.cuts.find((entry) => entry.id === cutId)
  const total = state.timeline.reduce((sum, timing) => sum + timing.duration, 0)
  const stage = state.stages.find((entry) => entry.stage === 'compose')
  const recorded = stage?.status === 'completed'

  function say(kind: 'ok' | 'error', text: string): void {
    setResult({ kind, text })
  }

  /** The film this screen is showing: the selected cut's render, or the default. */
  const filmUrl = useMemo(() => {
    const path = cut?.output ?? state.film?.path
    if (path === undefined) return undefined
    return '/studio/media?project=' + encodeURIComponent(state.project.id)
      + '&path=' + encodeURIComponent(path)
  }, [cut, state.film, state.project.id])

  /**
   * Which of the two things this screen is showing: the film, or the edit.
   *
   * A render is not the end of this stage. The whole reason editing happens
   * here is that a pause can only be judged with the audio and the picture
   * together — and that judgement does not stop being available once ffmpeg
   * has run once. So the render is a mode, not a destination: it can be left,
   * and leaving it is how a second version gets made.
   *
   * Defaults to the film, because arriving at a project that has one almost
   * always means wanting to watch it.
   */
  const [mode, setMode] = useState<'film' | 'edit'>('film')
  const showingFilm = filmUrl !== undefined && mode === 'film'
  /**
   * Where the other player should pick up when the mode flips.
   *
   * The two players are different objects with their own clocks, and the
   * `<video>` is unmounted while the edit view is up. Handing the position
   * across a ref rather than reading it off state is what makes the switch
   * feel like one surface: you keep watching from where you were.
   */
  const handover = useRef<number | null>(null)

  function showFilm(): void {
    if (mode === 'film') return
    handover.current = at
    preview.current?.pause()
    setPreviewing(false)
    setMode('film')
  }

  /** Leave the render behind — either on purpose, or because an edit landed. */
  function showEdit(): void {
    if (mode === 'edit') return
    handover.current = at
    player.current?.pause()
    setMode('edit')
  }

  useEffect(() => {
    if (mode !== 'edit') return
    const to = handover.current
    if (to === null) return
    handover.current = null
    preview.current?.seek(to)
    // The film side seeks in onLoadedMetadata instead: its element remounts,
    // and there is nothing to seek until the metadata is in.
  }, [mode])

  /**
   * Cues come from the plan, not from the rendered .srt.
   *
   * The host computes them with the same function that writes the file, over
   * the same timings — so they agree by construction. Reading the file back
   * would also mean the lane showed the *last* render's subtitles while the
   * other lanes showed the current edit.
   */
  const cues = useMemo(
    () => state.timeline.flatMap((timing) => timing.cues.map((cue, index) => ({
      key: timing.sectionId + ':' + index,
      sectionId: timing.sectionId,
      index,
      total: timing.cues.length,
      ...cue,
    }))),
    [state.timeline],
  )

  const subtitlePath = useMemo(() => {
    const report = state.artifacts.render_report as
      | { metadata?: { subtitles?: unknown } } | undefined
    const path = report?.metadata?.subtitles
    return typeof path === 'string' && path !== '' ? path : undefined
  }, [state.artifacts.render_report])

  /** During a drag the lane follows the pointer, ahead of the saved value. */
  function liveLead(timing: StudioState['timeline'][number]): number {
    return dragPad?.sectionId === timing.sectionId && dragPad.edge === 'lead'
      ? dragPad.seconds
      : timing.lead
  }
  function liveTail(timing: StudioState['timeline'][number]): number {
    return dragPad?.sectionId === timing.sectionId && dragPad.edge === 'tail'
      ? dragPad.seconds
      : Math.max(0, timing.duration - timing.lead - timing.speechSeconds)
  }

  const shotBlocks: Block[] = []
  const voiceBlocks: Block[] = []
  for (const timing of state.timeline) {
    voiceBlocks.push({
      key: 'v:' + timing.sectionId,
      sectionId: timing.sectionId,
      label: timing.label,
      start: timing.start,
      duration: timing.duration,
      showTime: true,
      waveform: waveformOf(timing.sectionId),
      // The pads are what an editor is here to judge, so they are drawn rather
      // than folded into one uniform block.
      leadShare: timing.duration === 0 ? 0 : liveLead(timing) / timing.duration,
      tailShare: timing.duration === 0 ? 0 : liveTail(timing) / timing.duration,
    })
    for (const shot of timing.shots) {
      shotBlocks.push({
        // Keyed by the asset, not the slot. A positional key changes the moment
        // two shots swap, so React tears both down and builds them again —
        // there is no element left to move, and the reorder can only ever look
        // like a flash.
        key: 's:' + timing.sectionId + '#' + (shot.assetId ?? 'slot-' + shot.index),
        sectionId: timing.sectionId,
        label: timing.label,
        start: shot.start,
        duration: shot.duration,
        shotIndex: shot.index,
        siblings: timing.shots.length,
      })
    }
  }

  const activeShot = shotBlocks.find((block) => at >= block.start && at < block.start + block.duration)
  /**
   * A cue's live bounds: what it will be once this drag lands.
   *
   * The dragged edge moves with the pointer and its neighbour gives up exactly
   * as much, which is the same trade the write performs — so the preview and
   * the result cannot disagree.
   */
  function liveCue(cue: { sectionId: string; index: number; start: number; end: number }): {
    start: number
    end: number
  } {
    if (dragCue === null || dragCue.sectionId !== cue.sectionId) return cue
    const { index, edge, delta } = dragCue
    if (cue.index === index) {
      return edge === 'left' ? { start: cue.start - delta, end: cue.end } : { start: cue.start, end: cue.end + delta }
    }
    if (edge === 'left' && cue.index === index - 1) return { start: cue.start, end: cue.end - delta }
    if (edge === 'right' && cue.index === index + 1) return { start: cue.start + delta, end: cue.end }
    return cue
  }

  const activeCue = cues.find((cue) => at >= cue.start && at < cue.end)
  const cueTrack = useRef<HTMLDivElement | null>(null)

  /**
   * Drag a cue's boundary. Same gesture as the pads, and the same rule: the
   * time has to come from somewhere, so the neighbour gives it up.
   */
  function startCueEdge(
    event: React.PointerEvent<HTMLSpanElement>,
    cue: { sectionId: string; index: number },
    edge: 'left' | 'right',
  ): void {
    event.stopPropagation()
    event.preventDefault()
    const perPixel = 1 / pps
    const startX = event.clientX
    let last = 0
    const move = (moved: PointerEvent): void => {
      document.body.classList.add('dcs-dragging')
      // Dragging the left edge leftwards lengthens the cue; the right edge
      // reads the other way round.
      last = (moved.clientX - startX) * perPixel * (edge === 'left' ? -1 : 1)
      setDragCue({ sectionId: cue.sectionId, index: cue.index, edge, delta: last })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('dcs-dragging')
      setDragCue(null)
      // One write at the end of the gesture: every intermediate value would be
      // its own durable document revision.
      if (Math.abs(last) > 0.02) void nudgeCueEdge(cue.sectionId, cue.index, edge, last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const activeShotRaw = state.timeline
    .find((entry) => entry.sectionId === activeShot?.sectionId)
    ?.shots.find((entry) => entry.index === activeShot?.shotIndex)
  const activeShotPathRaw = activeShotRaw?.path
  const activeShotPath = useMemo(() => {
    const timing = state.timeline.find((entry) => entry.sectionId === activeShot?.sectionId)
    const shot = timing?.shots.find((entry) => entry.index === activeShot?.shotIndex)
    if (shot?.path === undefined) return undefined
    return '/studio/media?project=' + encodeURIComponent(state.project.id)
      + '&path=' + encodeURIComponent(shot.path)
  }, [activeShot, state.timeline, state.project.id])

  /**
   * The local preview follows the plan, so it is rebuilt whenever the plan
   * moves — a stale preview would play the timing the user just changed.
   */
  /**
   * A content signature, not the array's identity.
   *
   * Every `/studio/state` fetch returns a fresh array, so keying the preview on
   * the reference tore it down on any refresh — including the one that fires on
   * mount, which killed playback a second after it started. Rebuilding should
   * follow the timings actually changing, nothing else.
   */
  const timelineKey = useMemo(
    () => state.timeline
      .map((timing) => [timing.sectionId, timing.start, timing.duration, timing.lead,
        timing.speechSeconds, timing.trimStart, timing.narrationPath ?? ''].join(','))
      .join('|'),
    [state.timeline],
  )

  useEffect(() => {
    // Carry the position across a rebuild: the edit that changed the timing was
    // made while listening at a particular moment, and being thrown back to the
    // start is the fastest way to lose the thing being judged.
    const resumeAt = at
    const wasPlaying = preview.current?.isPlaying === true
    preview.current?.dispose()
    preview.current = new Preview({
      projectId: state.project.id,
      sections: state.timeline.map((timing) => ({
        sectionId: timing.sectionId,
        start: timing.start,
        duration: timing.duration,
        speechSeconds: timing.speechSeconds,
        lead: timing.lead,
        trimStart: timing.trimStart,
        ...(timing.narrationPath === undefined ? {} : { narrationPath: timing.narrationPath }),
      })),
      onTick: setAt,
      onEnd: () => setPreviewing(false),
    })
    if (wasPlaying) preview.current.play(resumeAt)
    else preview.current.seek(resumeAt)
    return () => {
      preview.current?.dispose()
      preview.current = null
    }
    // `at` is deliberately not a dependency: it changes every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineKey, state.project.id])

  /**
   * What Space does right now, kept fresh on every render.
   *
   * The film and the local preview are two players with their own clocks;
   * whichever is on screen is the one the key means.
   */
  const toggleRef = useRef<() => void>(() => {})
  toggleRef.current = (): void => {
    if (showingFilm) {
      const element = player.current
      if (element === null) return
      if (element.paused) void element.play()
      else element.pause()
      return
    }
    togglePreview()
  }

  function togglePreview(): void {
    const engine = preview.current
    if (engine === null) return
    if (engine.isPlaying) {
      engine.pause()
      setPreviewing(false)
    } else {
      engine.play(at >= total ? 0 : at)
      setPreviewing(true)
    }
  }

  /**
   * Space plays and pauses, wherever the pointer is on this screen.
   *
   * It is the one key every editor already knows, and the browser spends it on
   * scrolling the page. Reclaiming it means `preventDefault` on keydown — and
   * on keyup too, because some browsers scroll on the release rather than the
   * press, which produces a jump that no amount of blocking keydown stops.
   *
   * The one place it stays the browser's is inside a text field: a subtitle
   * being typed needs its spaces. Buttons are also exempt, where space is the
   * activation key and stealing it would break the keyboard path to every
   * control on the page.
   */
  useEffect(() => {
    const typing = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null
      if (element === null) return false
      const tag = element.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
        || tag === 'BUTTON' || element.isContentEditable === true
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' && event.key !== ' ') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (typing(event.target)) return
      event.preventDefault()
      // Through a ref, not the closure. `togglePreview` reads `at`, which moves
      // every frame while playing; a listener bound to one render's copy would
      // resume from wherever the playhead was when this screen mounted.
      toggleRef.current()
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if ((event.code === 'Space' || event.key === ' ') && !typing(event.target)) event.preventDefault()
    }
    // On window, not the panel: the key works wherever the pointer is, and a
    // panel-scoped listener would only fire once something inside had focus.
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
    // Nothing in here reads a value that changes: the action goes through
    // `toggleRef`, so this binds once and stays correct.
  }, [])

  /**
   * Wheel over the strip scrolls it; Ctrl+wheel zooms the scale.
   *
   * Zoom keeps whatever is under the pointer under the pointer — anchoring on
   * the left edge instead would throw away the spot the person was looking at,
   * which is the only reason they zoomed.
   */
  /**
   * Wheel over the strip: scroll along it, or zoom the scale with a modifier.
   *
   * Bound natively with `{ passive: false }` rather than through React's
   * `onWheel`, because React attaches wheel listeners passively — its
   * `preventDefault()` is ignored, so the browser kept paging and page-zooming
   * underneath a handler that looked correct.
   *
   * While the pointer is over the panel the wheel belongs to the panel —
   * scrolling stops dead at either end rather than spilling into the page,
   * because a gesture that changes meaning halfway through reads as the view
   * drifting rather than as a boundary. Move the pointer out and the page has
   * it again. Zoom answers to Alt as well as Ctrl, so browser zoom stays
   * reachable without leaving the panel.
   */
  useEffect(() => {
    const container = film.current
    const scroller = container?.querySelector('.dcs-strip') as HTMLElement | null
    if (container === null || scroller === null) return undefined

    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        event.preventDefault()
        const box = scroller.getBoundingClientRect()
        // Keep whatever sits under the pointer under the pointer: anchoring on
        // the left edge would throw away the spot that prompted the zoom.
        const atPointer = (event.clientX - box.left + scroller.scrollLeft - LANE_LABEL) / ppsRef.current
        const next = Math.min(MAX_PPS, Math.max(MIN_PPS,
          ppsRef.current * (event.deltaY < 0 ? 1.12 : 1 / 1.12)))
        if (next === ppsRef.current) return
        setPps(next)
        requestAnimationFrame(() => {
          scroller.scrollLeft = atPointer * next + LANE_LABEL - (event.clientX - box.left)
        })
        return
      }

      // A trackpad sends its own horizontal delta; a mouse only sends deltaY.
      const along = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (along === 0) return
      // Taken for the whole time the pointer is over the panel, including at
      // the ends. Handing the gesture back once the strip runs out turns one
      // continuous scroll into a sideways slide that suddenly becomes a page
      // jump — the panel is either the scroll surface or it is not.
      event.preventDefault()
      scroller.scrollLeft += along
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  /** Seek the player, and keep the read-out honest when there is nothing to seek. */
  function seek(seconds: number): void {
    setAt(seconds)
    preview.current?.seek(seconds)
    const element = player.current
    if (element !== null && Number.isFinite(element.duration)) element.currentTime = seconds
  }

  /**
   * Ask for a render.
   *
   * Composing takes minutes and can fail in ways that need judgement, so it
   * goes to the model like every other generation — and the panel watches the
   * report for the result.
   */
  async function compose(): Promise<void> {
    if (phase !== null || busy !== null) return
    setResult(null)
    setPhase('sending')
    const before = JSON.stringify(state.artifacts.render_report ?? null)
    try {
      await onSend([
        '请合成成片。',
        '',
        '用 `studio_compose`，项目 `' + state.project.id + '`'
        + (cut === undefined ? '。' : '，剪辑版本 `' + cut.id + '`（' + cut.name + '）。'),
        ...(forceRender
          ? ['幻灯片风险分我已经看过了，就这么出——调 `studio_compose` 时带上 `force: true`。']
          : []),
        burnSubtitles === 'off'
          ? '这一版**不要**烧录字幕（`burn_subtitles: false`），字幕留成旁挂 .srt。'
          : '这一版**烧录字幕**：`burn_subtitles: true`，`subtitle_background: "'
            + burnSubtitles + '"`。',
        '合成完把它返回的 render_report **整个对象原样**交给 `studio_stage`'
        + '（stage 是 compose，status 是 completed）——照搬，不要重新拼、不要补字段、不要改路径和时长。',
        '记录成功后用 `studio_show` 把成片带进对话，我在这边和聊天里都能看。',
      ].join(NEWLINE))
      setPhase('generating')
      for (let attempt = 0; attempt < 360; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        const next = await api.state(state.project.id, cutId).catch(() => undefined)
        if (next !== undefined && JSON.stringify(next.artifacts.render_report ?? null) !== before) {
          await onReload()
          setPhase(null)
          // A fresh render is what you asked for, so it is what you get shown.
          handover.current = null
          setMode('film')
          say('ok', '成片好了，看一遍。改哪儿都行——点「编辑」回来接着调。')
          return
        }
      }
      setPhase(null)
      say('error', '等了十五分钟没等到成片。去对话里看看 Agent 卡在哪。')
    } catch (error) {
      setPhase(null)
      say('error', (error as Error).message)
    }
  }

  /** Start a new version from what is on screen now. */
  async function newCut(): Promise<void> {
    const name = window.prompt('这一版叫什么？', '剪辑 ' + (state.cuts.length + 1))
    if (name === null || name.trim() === '') return
    const id = 'cut-' + Date.now().toString(36)
    setBusy('cut')
    try {
      const sections: CutSection[] = state.timeline.map((timing) => ({ id: timing.sectionId }))
      const { cut: saved } = await api.saveCut(state.project.id, { id, name: name.trim(), sections })
      await onReload()
      onSelectCut(saved.id)
      say('ok', '「' + saved.name + '」已建好。改动会存进这一版，不影响其他版本。')
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function renameCut(entry: Cut): Promise<void> {
    const name = window.prompt('这一版叫什么？', entry.name)
    if (name === null || name.trim() === '' || name.trim() === entry.name) return
    setBusy('cut')
    try {
      // Sections ride along unchanged: a save replaces the stored cut, so
      // sending only the name would blank the edit it is naming.
      await api.saveCut(state.project.id, { id: entry.id, name: name.trim(), sections: entry.sections })
      await onReload()
      say('ok', '改名为「' + name.trim() + '」。')
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function removeCut(entry: Cut): Promise<void> {
    if (!window.confirm('删掉「' + entry.name + '」？这一版的编排会丢失。')) return
    setBusy('cut')
    try {
      await api.deleteCut(state.project.id, entry.id)
      await onReload()
      if (cutId === entry.id) onSelectCut('')
      say('ok', '「' + entry.name + '」已删除。')
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /**
   * The shot list for a section as the cut sees it, filled in from the plan.
   *
   * A cut that has never touched this section says nothing about its shots, so
   * the plan's own order is the starting point — editing is always a departure
   * from something, never from an empty list.
   */
  function shotsOfSection(sectionId: string): Array<{ assetId: string; weight?: number }> {
    const override = cut?.sections.find((entry) => entry.id === sectionId)?.shots
    if (override !== undefined) return override.map((entry) => ({ ...entry }))
    const timing = state.timeline.find((entry) => entry.sectionId === sectionId)
    return (timing?.shots ?? [])
      .filter((shot) => shot.assetId !== undefined)
      .map((shot) => ({ assetId: shot.assetId!, weight: shot.weight }))
  }

  /** Move a shot within its section. */
  async function moveShot(sectionId: string, index: number, delta: number): Promise<void> {
    const list = shotsOfSection(sectionId)
    const to = index + delta
    if (to < 0 || to >= list.length) return
    const next = [...list]
    const [moved] = next.splice(index, 1)
    next.splice(to, 0, moved!)
    await editSection(sectionId, { shots: next })
  }

  /**
   * Set one shot's share of its section; the last absorbs the remainder.
   *
   * Same rule as the shots screen, and for the same reason: the section's
   * length is fixed by its narration, so one shot can only gain what another
   * gives up.
   */
  async function setShotShare(sectionId: string, index: number, share: number): Promise<void> {
    const list = shotsOfSection(sectionId)
    const last = list.length - 1
    if (last <= 0 || index === last) return
    if (!(share > 0 && share < 1)) { say('error', '占比要在 0 和 1 之间。'); return }
    const sum = list.reduce((total, entry) => total + (entry.weight ?? 1), 0) || 1
    const shares = list.map((entry, position) =>
      position === index ? share : (entry.weight ?? 1) / sum)
    const others = shares.reduce((total, value, position) => position === last ? total : total + value, 0)
    const remainder = 1 - others
    if (remainder < 0.02) { say('error', '前面几镜已经占满，最后一镜没有时间可分。'); return }
    await editSection(sectionId, {
      shots: list.map((entry, position) => ({
        assetId: entry.assetId,
        weight: position === last ? remainder : shares[position]!,
      })),
    })
  }

  /**
   * A pad's current value, from the cut if it set one and the plan otherwise.
   */
  function padsOf(sectionId: string): { lead: number; tail: number } {
    const timing = state.timeline.find((entry) => entry.sectionId === sectionId)
    const override = cut?.sections.find((entry) => entry.id === sectionId)
    return {
      lead: override?.lead ?? timing?.lead ?? 0,
      tail: override?.tail
        ?? Math.max(0, (timing?.duration ?? 0) - (timing?.lead ?? 0) - (timing?.speechSeconds ?? 0)),
    }
  }

  /**
   * Write a dragged pad, but not on every pointer move.
   *
   * A drag produces a value per frame and each one is a durable document write.
   * Coalescing to the last value after a short pause keeps the gesture smooth
   * and leaves one entry in the version's history instead of sixty.
   */
  function queuePad(sectionId: string, edge: 'lead' | 'tail', seconds: number, trim: number): void {
    setDragPad({ sectionId, edge, seconds, trim })
    if (padTimer.current !== undefined) window.clearTimeout(padTimer.current)
    padTimer.current = window.setTimeout(() => {
      setDragPad(null)
      void editSection(sectionId, {
        [edge]: seconds,
        [edge === 'lead' ? 'trimStart' : 'trimEnd']: trim,
      })
    }, 220)
  }

  /**
   * The cue segmentation for a section: the cut's own if it has one, otherwise
   * whatever the automatic split produced. Edits always start from what is on
   * screen, so the first change to a section never silently re-splits the rest.
   */
  function cueTextsOf(sectionId: string): Array<{ text: string; weight?: number }> {
    const override = cut?.sections.find((entry) => entry.id === sectionId)?.cues
    if (override !== undefined) return override.map((cue) => ({ ...cue }))
    return state.timeline.find((entry) => entry.sectionId === sectionId)?.cues
      .map((cue) => ({ text: cue.text })) ?? []
  }

  async function saveCues(
    sectionId: string,
    cues: ReadonlyArray<{ text: string; weight?: number }>,
    note: string,
  ): Promise<void> {
    const cleaned = cues
      .map((cue) => ({ ...cue, text: cue.text.trim() }))
      .filter((cue) => cue.text !== '')
    if (cleaned.length === 0) { say('error', '一段至少要留一条字幕。'); return }
    await editSection(sectionId, { cues: cleaned })
    say('ok', note)
  }

  /**
   * Move one cue's boundary, taking the time from its neighbour.
   *
   * The section's speech window is fixed, so a cue can only grow by shrinking
   * the one beside it — the same arithmetic as the shot shares, and the reason
   * the whole film's length never moves while an editor is tuning a line.
   *
   * Weights are written as seconds. They stay RELATIVE — normalised against
   * whatever the window turns out to be — so a re-recorded take or a changed
   * pad rescales them instead of leaving a cue pointing at the wrong words.
   */
  async function nudgeCueEdge(
    sectionId: string,
    index: number,
    edge: 'left' | 'right',
    deltaSeconds: number,
  ): Promise<void> {
    const timing = state.timeline.find((entry) => entry.sectionId === sectionId)
    if (timing === undefined) return
    const list = cueTextsOf(sectionId)
    const durations = timing.cues.map((cue) => cue.end - cue.start)
    const neighbour = edge === 'left' ? index - 1 : index + 1
    if (neighbour < 0 || neighbour >= durations.length) {
      // The run's outer edges have no neighbour to trade with, so they move the
      // subtitle pad instead: the cues shift inside the speech window rather
      // than stealing from a cue that is not there.
      const existing = cut?.sections.find((entry) => entry.id === sectionId)
      const field = edge === 'left' ? 'cueLead' : 'cueTail'
      const current = (edge === 'left' ? existing?.cueLead : existing?.cueTail) ?? 0
      const room = timing.speechSeconds * 0.45
      const next = Math.min(room, Math.max(0, current - deltaSeconds))
      if (Math.abs(next - current) < 0.01) return
      await editSection(sectionId, { [field]: Number(next.toFixed(2)) })
      say('ok', edge === 'left' ? '字幕晚一点出现' : '字幕早一点收起')
      return
    }
    const MIN = 0.2
    const grow = Math.min(
      Math.max(deltaSeconds, MIN - (durations[index] ?? 0)),
      (durations[neighbour] ?? 0) - MIN,
    )
    if (Math.abs(grow) < 0.01) return
    durations[index] = (durations[index] ?? 0) + grow
    durations[neighbour] = (durations[neighbour] ?? 0) - grow
    await saveCues(
      sectionId,
      list.map((cue, position) => ({ ...cue, weight: Number((durations[position] ?? 1).toFixed(3)) })),
      '调整了这条字幕的时长',
    )
  }

  /** Replace one cue's text. */
  async function editCue(text: string): Promise<void> {
    if (activeCue === undefined) return
    const list = cueTextsOf(activeCue.sectionId)
    const existing = list[activeCue.index]
    if (existing !== undefined) list[activeCue.index] = { ...existing, text }
    await saveCues(activeCue.sectionId, list, '字幕已保存')
  }

  /**
   * Split the active cue at the caret.
   *
   * At the caret rather than the midpoint, because where a line should break is
   * a judgement about the sentence, and the person reading it has already put
   * the cursor there.
   */
  async function splitCue(at: number): Promise<void> {
    if (activeCue === undefined) return
    const texts = cueTextsOf(activeCue.sectionId)
    const whole = cueDraft ?? texts[activeCue.index]?.text ?? ''
    const head = whole.slice(0, at).trim()
    const tail = whole.slice(at).trim()
    if (head === '' || tail === '') { say('error', '光标放在要断开的位置，两边都要有字。'); return }
    // Split halves inherit no weight: the automatic proportional split is a
    // better guess for two fresh lines than half of a number set for one.
    texts.splice(activeCue.index, 1, { text: head }, { text: tail })
    setCueDraft(null)
    await saveCues(activeCue.sectionId, texts, '拆成了两条')
  }

  /**
   * Merge with a neighbour inside the same section.
   *
   * Cues take their timing from their section's speech window, so one spanning
   * two sections would have no window to sit in — the first and last cue of a
   * section therefore have nothing to merge with in that direction.
   */
  async function mergeCue(direction: -1 | 1): Promise<void> {
    if (activeCue === undefined) return
    const texts = cueTextsOf(activeCue.sectionId)
    const other = activeCue.index + direction
    if (other < 0 || other >= texts.length) {
      say('error', direction < 0 ? '这是本段第一条，前面没有可合并的。' : '这是本段最后一条，后面没有可合并的。')
      return
    }
    const first = Math.min(activeCue.index, other)
    const joined = (texts[first]?.text ?? '') + (texts[first + 1]?.text ?? '')
    const merged = (texts[first]?.weight ?? 0) + (texts[first + 1]?.weight ?? 0)
    texts.splice(first, 2, merged > 0 ? { text: joined, weight: merged } : { text: joined })
    setCueDraft(null)
    await saveCues(activeCue.sectionId, texts, '合并成了一条')
  }

  /**
   * The cut an edit should land in, creating one on the first change.
   *
   * Memoised in a ref rather than derived from state: `cut` is read out of the
   * render that scheduled the edit, and a drag fires several edits before React
   * has re-rendered with the new id. Every one of them saw "no cut yet" and
   * made another — which is how a single drag produced a column of versions.
   */
  async function ensureCut(): Promise<Cut> {
    if (cut !== undefined) return cut
    if (creating.current === null) {
      creating.current = api.saveCut(state.project.id, {
        id: 'cut-' + Date.now().toString(36),
        name: '剪辑 ' + (state.cuts.length + 1),
        sections: state.timeline.map((timing) => ({ id: timing.sectionId })),
      }).then(({ cut: created }) => {
        onSelectCut(created.id)
        say('ok', '改动开了一个新版本「' + created.name + '」，计划版本没有被动过。')
        return created
      })
    }
    // Later edits in the same burst reuse whatever the first one is making, and
    // then keep using it until the reload catches up.
    const made = await creating.current
    return cut ?? made
  }

  /** Persist one section's timing into the active cut. */
  async function editSection(sectionId: string, patch: Partial<CutSection>): Promise<void> {
    // The render on screen no longer matches what is being edited; staying on
    // it would show the change having no effect.
    showEdit()
    setBusy(sectionId)
    setResult(null)
    try {
      const target = await ensureCut()
      const sections = state.timeline.map((timing) => {
        const existing = target!.sections.find((entry) => entry.id === timing.sectionId)
          ?? { id: timing.sectionId }
        return timing.sectionId === sectionId ? { ...existing, ...patch } : existing
      })
      await api.saveCut(state.project.id, { id: target.id, name: target.name, sections })
      await onReload()
    } catch (error) {
      say('error', (error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    // A different version is a different target; the memo belonged to the last.
    // The reload itself is the workbench's, keyed on the same id.
    creating.current = null
  }, [cutId])

  const activeTiming = state.timeline.find((timing) => timing.sectionId === activeShot?.sectionId)
  const activeCutSection = cut?.sections.find((entry) => entry.id === activeShot?.sectionId)

  /**
   * Commit on Enter as well as on blur.
   *
   * Blur alone loses the edit whenever the next click is on the timeline: that
   * click is a seek, and by the time the field's blur runs the value has been
   * overtaken by a re-render from the seek. Enter is also simply what a person
   * expects a number field to do.
   */
  function commitOnEnter(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter') return
    event.preventDefault()
    event.currentTarget.blur()
  }

  return (
    <div className="dcs-screen dcs-screen-wide">
      <header className="dcs-screen-head">
        <div>
          <h2 className="dcs-screen-title">成片</h2>
          <p className="dcs-screen-sub">
            {state.timeline.length} 段 · {shotBlocks.length} 镜 · {total.toFixed(1)} 秒
            {cut === undefined ? ' · 计划版本' : ' · 剪辑「' + cut.name + '」'}
          </p>
        </div>
        <span className={'dcs-pill ' + (recorded ? 'dcs-pill-ok' : '')}>
          {recorded ? '已记录' : filmUrl === undefined ? '未合成' : '未记录'}
        </span>
      </header>

      {result !== null ? (
        <p className={'dcs-note ' + (result.kind === 'ok' ? 'dcs-note-ok' : 'dcs-note-error')}>{result.text}</p>
      ) : null}

      {/* Versions. The plan is always the first option and cannot be deleted. */}
      <div className="dcs-cutbar">
        <button
          type="button"
          className={'dcs-cut' + (cut === undefined ? ' dcs-cut-active' : '')}
          onClick={() => onSelectCut('')}
        >计划版本</button>
        {state.cuts.map((entry) => (
          <span className={'dcs-cut-wrap' + (entry.id === cutId ? ' dcs-cut-wrap-active' : '')} key={entry.id}>
            <button
              type="button"
              className={'dcs-cut' + (entry.id === cutId ? ' dcs-cut-active' : '')}
              title={(entry.note ?? '') + '　更新于 ' + entry.updated_at.slice(0, 16).replace('T', ' ')}
              onClick={() => onSelectCut(entry.id)}
            >
              {entry.name}
              {entry.output === undefined ? <span className="dcs-cut-dot" title="还没出片">·</span> : null}
            </button>
            <button
              type="button"
              className="dcs-cut-x"
              aria-label="重命名这一版"
              title="重命名"
              disabled={busy !== null}
              onClick={() => void renameCut(entry)}
            >✎</button>
            <button
              type="button"
              className="dcs-cut-x"
              aria-label="删除这一版"
              disabled={busy !== null}
              onClick={() => void removeCut(entry)}
            >×</button>
          </span>
        ))}
        <button type="button" className="dcs-cut dcs-cut-new" disabled={busy !== null}
          onClick={() => void newCut()}>＋ 新版本</button>
        <span className="dcs-spacer" />
        {filmUrl === undefined ? null : (
          <div className="dcs-mode" role="group" aria-label="预览模式">
            <button
              type="button"
              className={'dcs-mode-btn' + (mode === 'film' ? ' dcs-mode-on' : '')}
              onClick={showFilm}
              title="播放已合成的成片"
            >成片</button>
            <button
              type="button"
              className={'dcs-mode-btn' + (mode === 'edit' ? ' dcs-mode-on' : '')}
              onClick={showEdit}
              title="回到编辑：改这一版，或另存一版"
            >编辑</button>
          </div>
        )}
        {filmUrl === undefined ? null : (
          <a
            className="dcs-btn dcs-btn-small"
            href={filmUrl + '&download=1'}
            download
            title="导出这一版的成片"
          >导出</a>
        )}
        {subtitlePath === undefined ? null : (
          <a
            className="dcs-btn dcs-btn-small"
            href={'/studio/media?project=' + encodeURIComponent(state.project.id)
              + '&path=' + encodeURIComponent(subtitlePath) + '&download=1'}
            download
            title="导出这一版的字幕"
          >字幕</a>
        )}
        <label className="dcs-inline-pick" title="烧录会重新编码整段视频，并依赖本机中文字体；关掉则字幕只作为旁挂 .srt 导出">
          <span className="dcs-hint">字幕</span>
          <select
            className="dcs-select dcs-select-small"
            value={burnSubtitles}
            disabled={phase !== null || busy !== null}
            onChange={(event) => setBurnSubtitles(event.target.value as 'off' | 'outline' | 'box')}
          >
            <option value="off">不烧录（旁挂 .srt）</option>
            <option value="outline">烧录 · 描边</option>
            <option value="box">烧录 · 底色块</option>
          </select>
        </label>
        <button
          type="button"
          className="dcs-btn dcs-btn-primary"
          disabled={phase !== null || busy !== null}
          onClick={() => void compose()}
        >
          <BusyLabel phase={phase} idle={filmUrl === undefined ? '合成' : '重新合成'} />
        </button>
      </div>

      {/* Same shell the shots screen uses. It used to render only on a
          revise/fail verdict, so a clean film showed nothing at all — and
          "checked and fine" looked exactly like "never checked". */}
      {risk === null ? null : (
        <AdvicePanel
          title="成片检查"
          action={!risk.blocking ? undefined : (
            <label className="dcs-inline-pick" title="看过分数仍然要出片">
              <input
                type="checkbox"
                checked={forceRender}
                onChange={(event) => setForceRender(event.target.checked)}
              />
              <span className="dcs-hint">我看过了，照出</span>
            </label>
          )}
          rows={Object.entries(risk.dimensions).map(([name, entry]) => ({
            label: RISK_LABELS[name] ?? name,
            clean: entry.score < 2,
            summary: entry.score < 2 ? '通过' : (entry.short ?? entry.reason),
            hint: entry.short ?? entry.reason,
            ...(entry.score >= 4 ? { severity: 'fail' as const } : entry.score >= 2 ? { severity: 'revise' as const } : {}),
            details: [{ key: name, text: entry.reason }],
          }))}
        />
      )}


      <div className="dcs-stage">
        {!showingFilm ? (
          /* No render yet — play it locally instead. The clips and stills are
             already here, so waiting on ffmpeg to hear a pause would put a
             multi-minute round trip inside the one loop that has to be tight. */
          <div className="dcs-preview">
            {activeShotPath === undefined
              ? <div className="dcs-stage-empty"><p className="dcs-note">这一镜还没有画面。</p></div>
              : <img className="dcs-preview-frame" src={activeShotPath} alt="" />}
            {activeCue === undefined
              ? null
              : <div className="dcs-preview-sub">{activeCue.text}</div>}
            {filmUrl === undefined ? null : (
              <div className="dcs-stage-badge">编辑中 · 成片还是上一次合成的</div>
            )}
            <button
              type="button"
              className={'dcs-preview-play' + (previewing ? ' dcs-preview-play-on' : '')}
              aria-label={previewing ? '暂停' : '预览播放'}
              onClick={togglePreview}
            >{previewing ? '❚❚' : '▶'}</button>
            {/* Over the picture rather than beside the strip: it reads as part
                of what is playing, and the strip stops paying for its width. */}
            <div className="dcs-timecode">
              <span className="dcs-timecode-now">{formatClock(at)}</span>
              <span className="dcs-timecode-total">/ {formatClock(total)}</span>
            </div>
          </div>
        ) : (
          <video
            ref={player}
            className="dcs-player"
            src={filmUrl}
            controls
            /* Without this the element has no intrinsic ratio before playback,
               and a portrait render sits letterboxed in a landscape box. */
            preload="metadata"
            onLoadedMetadata={(event) => {
              const to = handover.current
              if (to === null) return
              handover.current = null
              const element = event.currentTarget
              element.currentTime = Number.isFinite(element.duration)
                ? Math.min(to, element.duration)
                : to
            }}
            onTimeUpdate={(event) => setAt(event.currentTarget.currentTime)}
          />
        )}
      </div>

      {/* The filmstrip: three lanes over one shared time axis. */}
      <div className="dcs-film" ref={film}>
        <div className="dcs-film-perf" aria-hidden="true" />
        <div className="dcs-film-body">
          <Strip ariaLabel="时间线" arrows={false}>
          <div className="dcs-track" style={{ width: (LANE_LABEL + total * pps) + 'px' }}>
            <Ruler total={total} pps={pps} onScrub={seek} />
            <Lane label="分镜" blocks={shotBlocks} total={total} pps={pps} at={at} onSeek={seek}
              onOpen={() => onGoToStage('assets_shots')}
              onReorder={(sectionId, from, to) => moveShot(sectionId, from, to - from)}
              onDragShot={setDragShot}
              dragShot={dragShot}
              onLanded={setLanded}
              landedKey={landed} />
            <Lane label="配音" blocks={voiceBlocks} total={total} pps={pps} at={at} onSeek={seek}
              onOpen={() => onGoToStage('assets_audio')}
              padsOf={padsOf}
              onPad={(sectionId, edge, seconds, trim) => queuePad(sectionId, edge, seconds, trim)} />
            {cues.length > 0 ? (
              <div className="dcs-lane">
                <span className="dcs-lane-label dcs-lane-label-plain">字幕</span>
                <div className="dcs-lane-blocks dcs-lane-cues" ref={cueTrack} style={{ width: px(total) }}>
                  {cues.map((cue) => {
                    const live = at >= cue.start && at < cue.end
                    return (
                      <button
                        key={cue.key}
                        type="button"
                        className={'dcs-cue' + (live ? ' dcs-cue-live' : '')}
                        style={{
                          left: px(liveCue(cue).start),
                          width: px(Math.max(0.05, liveCue(cue).end - liveCue(cue).start)),
                        }}
                        title={cue.text + '　拖两端可调这条的长短，时间从相邻一条来'}
                        onClick={() => seek(cue.start)}
                      >
                        <span
                          className="dcs-pad-handle dcs-pad-handle-left"
                          title={cue.index === 0 ? '拖动改这一段字幕的前留白' : '和前一条互让时间'}
                          onPointerDown={(event) => startCueEdge(event, cue, 'left')}
                        />
                        <span className="dcs-cue-text">{cue.text}</span>
                        <span
                          className="dcs-pad-handle dcs-pad-handle-right"
                          title={cue.index === cue.total - 1 ? '拖动改这一段字幕的后留白' : '和后一条互让时间'}
                          onPointerDown={(event) => startCueEdge(event, cue, 'right')}
                        />
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
            <div className="dcs-playhead" style={{ left: (LANE_LABEL + at * pps) + 'px' }} />
            </div>
          </Strip>
        </div>
        <div className="dcs-film-perf" aria-hidden="true" />
      </div>

      {/* Editing, in the environment the judgement was made in. */}
      {activeShot !== undefined && activeTiming !== undefined ? (
        <div className="dcs-bottom">
          <section className="dcs-panel dcs-edit">
            <div className="dcs-group-head">
              <h3 className="dcs-group-title">片段编辑</h3>
              {cut === undefined
                ? <span className="dcs-hint">改动会自动开一个新版本</span>
                : null}
            </div>
            <div className="dcs-row dcs-row-tight">
              <label className="dcs-inline-pick">
                <span className="dcs-hint">← 留白</span>
                <input
                  key={activeShot.sectionId + ':lead:' + (activeCutSection?.lead ?? '')}
                  className="dcs-input dcs-input-seconds"
                  inputMode="decimal"
                  onKeyDown={commitOnEnter}
                  defaultValue={(activeCutSection?.lead ?? '').toString()}
                  placeholder={activeTiming.lead.toFixed(2)}
                  disabled={busy !== null}
                  onBlur={(event) => {
                    if (event.target.value.trim() === '') return
                    const value = Number(event.target.value)
                    if (Number.isFinite(value) && value >= 0) void editSection(activeShot.sectionId, { lead: value })
                  }}
                />
              </label>
              <label className="dcs-inline-pick">
                <span className="dcs-hint">占比</span>
                <input
                  key={activeShot.key + ':share'}
                  className="dcs-input dcs-input-seconds"
                  inputMode="decimal"
                  onKeyDown={commitOnEnter}
                  defaultValue={(activeShot.duration / Math.max(activeTiming.duration, 0.001)).toFixed(2)}
                  disabled={busy !== null || activeTiming.shots.length <= 1
                    || (activeShot.shotIndex ?? 0) === activeTiming.shots.length - 1}
                  title={activeTiming.shots.length <= 1
                    ? '这一段只有一镜'
                    : (activeShot.shotIndex ?? 0) === activeTiming.shots.length - 1
                      ? '最后一镜自动补齐剩下的时间'
                      : '这一镜占本段的比例'}
                  onBlur={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      void setShotShare(activeShot.sectionId, activeShot.shotIndex ?? 0, value)
                    }
                  }}
                />
              </label>
              <label className="dcs-inline-pick">
                <span className="dcs-hint">留白 →</span>
                <input
                  key={activeShot.sectionId + ':tail:' + (activeCutSection?.tail ?? '')}
                  className="dcs-input dcs-input-seconds"
                  inputMode="decimal"
                  onKeyDown={commitOnEnter}
                  defaultValue={(activeCutSection?.tail ?? '').toString()}
                  placeholder={Math.max(0, activeTiming.duration - activeTiming.lead - activeTiming.speechSeconds).toFixed(2)}
                  disabled={busy !== null}
                  onBlur={(event) => {
                    if (event.target.value.trim() === '') return
                    const value = Number(event.target.value)
                    if (Number.isFinite(value) && value >= 0) void editSection(activeShot.sectionId, { tail: value })
                  }}
                />
              </label>
            </div>

            <div className="dcs-divider" />

            <div className="dcs-group-head">
              <h3 className="dcs-group-title">字幕编辑</h3>
              <span className="dcs-hint">
                {activeCue === undefined
                  ? '播放头不在任何一条字幕上'
                  : '第 ' + (activeCue.index + 1) + ' / ' + activeCue.total + ' 条　'
                    + formatClock(activeCue.start) + ' – ' + formatClock(activeCue.end)}
              </span>
            </div>
            <textarea
              ref={cueBox}
              className="dcs-input dcs-textarea"
              rows={2}
              value={cueDraft ?? activeCue?.text ?? ''}
              placeholder={activeCue === undefined ? '把播放头移到某条字幕上' : ''}
              disabled={activeCue === undefined || busy !== null}
              onChange={(event) => setCueDraft(event.target.value)}
            />
            <div className="dcs-cue-actions">
              <button type="button" className="dcs-btn dcs-btn-small"
                disabled={activeCue === undefined || busy !== null || activeCue.index === 0}
                title="和本段前一条合并" onClick={() => void mergeCue(-1)}>← 合并</button>
              <button type="button" className="dcs-btn dcs-btn-small"
                disabled={activeCue === undefined || busy !== null}
                title="向左延长，时间从前一条来；本段第一条则改字幕前留白"
                onClick={() => activeCue !== undefined
                  && void nudgeCueEdge(activeCue.sectionId, activeCue.index, 'left', CUE_STEP)}>← 延长</button>
              <button type="button" className="dcs-btn dcs-btn-small"
                disabled={activeCue === undefined || busy !== null}
                title="在光标处断成两条"
                onClick={() => void splitCue(cueBox.current?.selectionStart ?? 0)}>拆分</button>
              <button type="button" className="dcs-btn dcs-btn-small"
                disabled={activeCue === undefined || busy !== null}
                title="向右延长，时间从后一条来；本段最后一条则改字幕后留白"
                onClick={() => activeCue !== undefined
                  && void nudgeCueEdge(activeCue.sectionId, activeCue.index, 'right', CUE_STEP)}>延长 →</button>
              <button type="button" className="dcs-btn dcs-btn-small"
                disabled={activeCue === undefined || busy !== null
                  || activeCue.index >= activeCue.total - 1}
                title="和本段后一条合并" onClick={() => void mergeCue(1)}>合并 →</button>
              <span className="dcs-spacer" />
              <button type="button" className="dcs-btn dcs-btn-small dcs-btn-primary"
                disabled={cueDraft === null || busy !== null}
                onClick={() => { const text = cueDraft; setCueDraft(null); if (text !== null) void editCue(text) }}>
                保存
              </button>
            </div>
          </section>

          <section className="dcs-panel dcs-info">
            <div className="dcs-group-head">
              <h3 className="dcs-group-title">镜头信息</h3>
            </div>
            <div className="dcs-facts-box">
              <div className="dcs-facts-title">
                {activeTiming.label} · 第 {(activeShot.shotIndex ?? 0) + 1} 镜
                <span className="dcs-hint">
                  　{formatClock(activeShot.start)} – {formatClock(activeShot.start + activeShot.duration)}
                </span>
              </div>
              <dl className="dcs-facts">
                <div><dt>本镜</dt><dd>{activeShot.duration.toFixed(2)}s</dd></div>
                <div><dt>本段</dt><dd>{activeTiming.duration.toFixed(2)}s</dd></div>
                <div><dt>配音</dt><dd>{activeTiming.speechSeconds.toFixed(2)}s</dd></div>
                <div className="dcs-fact-wide">
                  <dt>台词</dt>
                  <dd>{activeTiming.text === '' ? '（无）' : activeTiming.text}</dd>
                </div>
                <div className="dcs-fact-wide">
                  <dt>音频</dt>
                  <dd className="dcs-mono">{fileNameOf(activeTiming.narrationPath) ?? '（未生成）'}</dd>
                </div>
                <div className="dcs-fact-wide">
                  <dt>画面</dt>
                  <dd className="dcs-mono">{fileNameOf(activeShotPathRaw) ?? '（未生成）'}</dd>
                </div>
              </dl>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

/**
 * A second-by-second scale over the lanes.
 *
 * Ticks share the lanes' percentage geometry, so a block's width *is* its
 * duration read against this ruler rather than a separate drawing that happens
 * to look similar. Labels thin out as the film gets longer: a number every
 * second on a five-minute cut is a grey smear, and the point of the scale is
 * that a glance answers "how long is this".
 */
function Ruler({ total, pps, onScrub }: {
  total: number
  pps: number
  onScrub: (seconds: number) => void
}): JSX.Element | null {
  const track = useRef<HTMLDivElement | null>(null)

  /** Click or drag anywhere on the scale to move the playhead there. */
  function scrubFrom(clientX: number): void {
    const element = track.current
    if (element === null) return
    const box = element.getBoundingClientRect()
    onScrub(Math.min(total, Math.max(0, (clientX - box.left) / pps)))
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    // The strip underneath pans on this same gesture; scrubbing wins here
    // because the scale exists to be aimed at.
    event.stopPropagation()
    event.preventDefault()
    scrubFrom(event.clientX)
    const move = (moved: PointerEvent): void => scrubFrom(moved.clientX)
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('dcs-dragging')
    }
    document.body.classList.add('dcs-dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (total <= 0) return null
  const step = total <= 20 ? 1 : total <= 60 ? 5 : total <= 180 ? 10 : 30
  const ticks: JSX.Element[] = []
  for (let second = 0; second <= Math.ceil(total); second += 1) {
    const labelled = second % step === 0
    ticks.push(
      <span
        key={second}
        className={'dcs-tick' + (labelled ? ' dcs-tick-major' : '')}
        style={{ left: pxAt(second, pps) }}
      >
        {labelled ? <i>{second}s</i> : null}
      </span>,
    )
  }
  return (
    <div className="dcs-lane dcs-ruler">
      <span className="dcs-lane-label dcs-lane-label-plain" />
      <div
        className="dcs-ruler-track"
        style={{ width: pxAt(total, pps) }}
        ref={track}
        role="slider"
        aria-label="播放位置"
        aria-valuemin={0}
        aria-valuemax={total}
        onPointerDown={onPointerDown}
      >{ticks}</div>
    </div>
  )
}

/** A shot being carried, and where it would land. */
export interface DragShot {
  key: string
  sectionId: string
  /** Pixels travelled, so the block can ride the pointer. */
  dx: number
  /** Index it started at, within its section. */
  from: number
  /** Index it would drop into. Equal to `from` while it is still home. */
  to: number
  /**
   * Set the moment the hand lets go, before the write lands.
   *
   * Clearing the drag on release instead made every block snap back to where it
   * started for the frames between the release and the reload — the arrangement
   * the user had just built vanished and then reappeared. Holding the drag
   * through the write keeps the picture still, and the carried block animates
   * into the slot rather than being teleported out of the hand.
   */
  landing?: boolean
  /**
   * The sibling order this drag was measured against.
   *
   * Offsets are differences between two layouts; applying them to a third is
   * meaningless. When the reordered data arrives this no longer matches, and
   * the shifts drop out on the same frame the new order appears.
   */
  order: string
}

/**
 * How far each shot in a section slides while one of them is being carried.
 *
 * Worked out from the layout the list would have once the move lands, rather
 * than from which half of a neighbour the pointer is over. Those are not the
 * same question, and answering the second one gets the direction wrong exactly
 * when it matters: carrying the middle shot leftwards, the pointer crosses the
 * right half of the first shot — but that shot has nothing to its left to move
 * into, and the block being carried is going to land *before* it. It has to
 * step right, into the slot the carried block is vacating.
 *
 * Distances are the real ones, so blocks of different lengths open a gap that
 * actually fits what is coming.
 */
function shotShifts(widths: readonly number[], gap: number, from: number, to: number): number[] {
  const shifts = widths.map(() => 0)
  if (from === to) return shifts
  const offsets: number[] = []
  let cursor = 0
  for (const width of widths) {
    offsets.push(cursor)
    cursor += width + gap
  }
  const order = widths.map((_, index) => index)
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved!)

  cursor = 0
  for (const index of order) {
    shifts[index] = cursor - offsets[index]!
    cursor += widths[index]! + gap
  }
  // The carried block's own slot is kept: while the pointer holds it the block
  // follows the hand, but on release it flies into exactly this offset.
  return shifts
}

/**
 * The slot the pointer is asking for.
 *
 * Moving left, it lands before the first block whose middle it has passed;
 * moving right, after the last one. Midpoints rather than edges, so a block
 * swaps when the pointer is genuinely past it rather than as soon as they touch.
 */
function dropIndex(widths: readonly number[], gap: number, from: number, pointerX: number): number {
  const centres: number[] = []
  let cursor = 0
  for (const width of widths) {
    centres.push(cursor + width / 2)
    cursor += width + gap
  }
  let to = from
  for (let index = from - 1; index >= 0; index -= 1) {
    if (pointerX < centres[index]!) to = index
  }
  for (let index = from + 1; index < widths.length; index += 1) {
    if (pointerX > centres[index]!) to = index
  }
  return to
}

interface LaneProps {
  /** Pixels per second, so every lane measures with the same ruler. */
  pps: number
  label: string
  blocks: readonly Block[]
  total: number
  at: number
  onSeek: (seconds: number) => void
  onOpen: () => void
  /** Present only on the picture lane, where order is the editor's to change. */
  onReorder?: (sectionId: string, from: number, to: number) => void | Promise<void>
  /** Live drag report, so siblings can step aside while it is happening. */
  onDragShot?: (drag: DragShot | null) => void
  /** Fired once a moved block has settled, so the eye can be pointed at it. */
  onLanded?: (key: string) => void
  /** The block to mark as just-landed. */
  landedKey?: string | null
  dragShot?: DragShot | null
  /**
   * Present only on the audio lane: drag an edge to change that pad, and past
   * zero to trim the clip itself.
   */
  onPad?: (sectionId: string, edge: 'lead' | 'tail', seconds: number, trim: number) => void
  /** Current pads, so a drag starts from where the block actually is. */
  padsOf?: (sectionId: string) => { lead: number; tail: number }
}

/** One horizontal track. Block width is time, as everywhere else in this panel. */
function Lane({
  label, blocks, total, pps, at, onSeek, onOpen, onReorder, onDragShot, dragShot, onLanded, landedKey, onPad, padsOf,
}: LaneProps): JSX.Element {
  const track = useRef<HTMLDivElement | null>(null)

  /**
   * Only a section with more than one shot has an order to change.
   *
   * Showing a grab cursor on a lone shot advertises a gesture that cannot do
   * anything, which reads as the feature being broken rather than absent.
   */
  /**
   * How far a block slides to open the gap, from the layout the list will have.
   *
   * Recomputed per drag frame rather than stored, because it depends only on
   * `from` and `to` — both of which the drag already carries.
   */
  const shifts = useMemo(() => {
    // `dragShot` is optional on the props, so absent and idle read the same.
    if (dragShot === null || dragShot === undefined || dragShot.from === dragShot.to) {
      return new Map<string, number>()
    }
    const sibs = blocks.filter((entry) => entry.sectionId === dragShot.sectionId)
    // Once the write lands the list is already in the new order, and offsets
    // computed against the old one would move everything a second time. That
    // second move, undone a frame later when the drag cleared, was the bounce.
    if (sibs.map((entry) => entry.key).join('|') !== dragShot.order) return new Map<string, number>()
    const table = shotShifts(sibs.map((entry) => entry.duration * pps), BLOCK_GAP, dragShot.from, dragShot.to)
    return new Map(sibs.map((entry, index) => [
      entry.key,
      // While the hand still holds it the carried block follows the pointer,
      // so its computed slot is ignored until the release.
      index === dragShot.from && dragShot.landing !== true ? 0 : Math.round(table[index] ?? 0),
    ]))
  }, [dragShot, blocks, pps])

  function shiftOf(block: Block): number {
    return shifts.get(block.key) ?? 0
  }

  function canDrag(block: Block): boolean {
    return block.shotIndex !== undefined && onReorder !== undefined && (block.siblings ?? 1) > 1
  }

  /**
   * Drag one edge of an audio block to change that pad.
   *
   * Seconds per pixel comes from the lane's own width against the film's
   * length, so the block follows the pointer at the scale the eye is already
   * reading — which is the whole reason to do this here instead of typing a
   * number into a field.
   */
  function startPad(
    event: React.PointerEvent<HTMLSpanElement>,
    block: Block,
    edge: 'lead' | 'tail',
  ): void {
    if (onPad === undefined || padsOf === undefined) return
    event.stopPropagation()
    event.preventDefault()
    const perPixel = 1 / pps
    const startX = event.clientX
    const from = padsOf(block.sectionId)[edge]
    const move = (moved: PointerEvent): void => {
      // Dragging the left handle leftwards lengthens the lead-in; the right
      // handle reads the other way round.
      const delta = (moved.clientX - startX) * perPixel * (edge === 'lead' ? -1 : 1)
      document.body.classList.add('dcs-dragging')
      const raw = Number((from + delta).toFixed(2))
      // Past zero there is no pause left to remove, so the drag starts cutting
      // the clip instead. Two different acts, one continuous gesture — which is
      // what makes the edge feel like the edge of the sound rather than of a box.
      onPad(block.sectionId, edge, Math.max(0, raw), raw < 0 ? -raw : 0)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('dcs-dragging')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="dcs-lane">
      <button type="button" className="dcs-lane-label" onClick={onOpen} title="回到这一步去改内容">
        {label}
      </button>
      <div className="dcs-lane-blocks" ref={track}>
        {blocks.map((block) => {
          const live = at >= block.start && at < block.start + block.duration
          return (
            <button
              key={block.key}
              type="button"
              className={'dcs-block' + (live ? ' dcs-block-live' : '')
                + (canDrag(block) ? ' dcs-block-drag' : '')
                + (dragShot?.key === block.key
                  ? (dragShot.landing === true ? ' dcs-block-landing' : ' dcs-block-lifted')
                  : '')
                + (shiftOf(block) === 0 ? '' : ' dcs-block-shoved')
                + (landedKey === block.key ? ' dcs-block-settled' : '')}
              style={{
                width: pxAt(block.duration, pps),
                ...(dragShot?.key === block.key && dragShot.landing !== true
                  ? { transform: 'translateX(' + dragShot.dx.toFixed(0) + 'px)' }
                  : shiftOf(block) === 0 ? {} : { transform: 'translateX(' + shiftOf(block) + 'px)' }),
              }}
              data-section={block.sectionId}
              data-shot={block.shotIndex}
              data-key={block.key}
              onPointerDown={(event) => {
                if (!canDrag(block)) return
                // Pointer events, not HTML5 drag-and-drop: the strip around
                // this block pans on the same gesture, and the two event models
                // do not compose — the drag never started.
                event.stopPropagation()
                const from = block.shotIndex!
                const sectionId = block.sectionId
                const sibs = blocks.filter((entry) => entry.sectionId === sectionId)
                const order = sibs.map((entry) => entry.key).join('|')
                const widths = sibs.map((entry) => entry.duration * pps)
                const origin = track.current?.getBoundingClientRect().left ?? 0
                // Where this section's run begins inside the lane, so pointer
                // positions can be compared against the run's own geometry.
                const runStart = (sibs[0]?.start ?? 0) * pps
                const startX = event.clientX
                let moved = false
                let landing = from
                let dx = 0

                const move = (at: PointerEvent): void => {
                  dx = at.clientX - startX
                  if (!moved && Math.abs(dx) < 4) return
                  moved = true
                  document.body.classList.add('dcs-dragging')
                  landing = dropIndex(widths, BLOCK_GAP, from, at.clientX - origin - runStart)
                  onDragShot?.({ key: block.key, sectionId, dx, from, to: landing, order })
                }

                const up = (): void => {
                  window.removeEventListener('pointermove', move)
                  window.removeEventListener('pointerup', up)
                  document.body.classList.remove('dcs-dragging')
                  // The landing slot is whatever the last frame worked out, so
                  // what drops is exactly the arrangement that was on screen.
                  if (!moved || landing === from) {
                    onDragShot?.(null)
                    return
                  }
                  onDragShot?.({ key: block.key, sectionId, dx, from, to: landing, landing: true, order })
                  // Where the carried block will begin once it has landed —
                  // leaving the playhead on the old slot would leave it inside
                  // whichever shot moved into the vacated space.
                  const reordered = sibs.map((entry) => entry)
                  const [carried] = reordered.splice(from, 1)
                  reordered.splice(landing, 0, carried!)
                  const landedStart = (sibs[0]?.start ?? 0)
                    + reordered.slice(0, landing).reduce((sum, entry) => sum + entry.duration, 0)
                  // Move the playhead now, with the release. Doing it after
                  // the write meant it sat on the old slot for the length of a
                  // round trip and then jumped — which read as the whole thing
                  // springing back before correcting itself.
                  onSeek(landedStart)
                  void Promise.resolve(onReorder?.(sectionId, from, landing)).then(() => {
                    // Only now: the data carries the new order, so dropping the
                    // transforms moves nothing.
                    onDragShot?.(null)
                    onLanded?.(block.key)
                  })
                }

                window.addEventListener('pointermove', move)
                window.addEventListener('pointerup', up)
              }}
              title={block.label + '　' + formatClock(block.start) + ' + ' + block.duration.toFixed(2) + 's'
                + (canDrag(block) ? '　拖动可在本段内换位' : '')}
              onClick={() => onSeek(block.start)}
            >
              {block.waveform === undefined ? null : (
                <>
                  {(block.leadShare ?? 0) > 0.001 ? (
                    <span className="dcs-block-pad" aria-hidden="true"
                      style={{ left: 0, width: (block.leadShare! * block.duration * pps) + 'px' }} />
                  ) : null}
                  <span
                    className="dcs-block-wave"
                    aria-hidden="true"
                    style={{
                      left: ((block.leadShare ?? 0) * block.duration * pps) + 'px',
                      right: ((block.tailShare ?? 0) * block.duration * pps) + 'px',
                    }}
                  >
                    <Waveform bars={block.waveform} />
                  </span>
                  {(block.tailShare ?? 0) > 0.001 ? (
                    <span className="dcs-block-pad" aria-hidden="true"
                      style={{ right: 0, width: (block.tailShare! * block.duration * pps) + 'px' }} />
                  ) : null}
                </>
              )}
              {block.waveform !== undefined && onPad !== undefined ? (
                <>
                  <span
                    className="dcs-pad-handle dcs-pad-handle-left"
                    title="拖动改前留白"
                    onPointerDown={(event) => startPad(event, block, 'lead')}
                  />
                  <span
                    className="dcs-pad-handle dcs-pad-handle-right"
                    title="拖动改后留白"
                    onPointerDown={(event) => startPad(event, block, 'tail')}
                  />
                </>
              ) : null}
              {block.showTime ? (
                <span className="dcs-block-time">{block.duration.toFixed(1)}s</span>
              ) : (
                <span className="dcs-block-name">
                  {block.shotIndex === undefined ? block.label : block.label + ' ' + (block.shotIndex + 1)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

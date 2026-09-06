/**
 * A horizontally pannable strip: drag anywhere, or use the edge arrows.
 *
 * The scrollbar is hidden rather than styled. A bar under a row of cards is a
 * second thing to aim at, sitting exactly where a wide card's own edge is, and
 * it competes with the cards for the reader's sense of where the sequence
 * starts and ends. Dragging the content is the direct gesture; the arrows exist
 * for the same reason a scrollbar did — discoverability, and precision when
 * dragging is awkward.
 *
 * Drag has to coexist with clicking a card. A pointer that moves past a small
 * threshold is a pan, and the click that follows it is swallowed; anything
 * shorter stays a click. Without that, every card selection would jitter the
 * strip, and every pan would select whatever card it started on.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface StripProps {
  children: React.ReactNode
  /** Extra class on the scrolling element. */
  className?: string
  ariaLabel?: string
  /**
   * Edge arrows. On by default for card rows, where they aid discovery; a
   * surface whose whole point is dragging does not need a second way to say so.
   */
  arrows?: boolean
}

/** Past this many pixels a pointer gesture is a pan, not a click. */
const DRAG_THRESHOLD = 4

export function Strip({ children, className, ariaLabel, arrows = true }: StripProps): JSX.Element {
  const viewport = useRef<HTMLDivElement | null>(null)
  const [overflow, setOverflow] = useState({ left: false, right: false })
  const drag = useRef<{ startX: number; startScroll: number; moved: boolean } | null>(null)

  const measure = useCallback((): void => {
    const element = viewport.current
    if (element === null) return
    const room = element.scrollWidth - element.clientWidth
    setOverflow({
      left: element.scrollLeft > 1,
      right: room > 1 && element.scrollLeft < room - 1,
    })
  }, [])

  useEffect(() => {
    const element = viewport.current
    if (element === null) return undefined
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of Array.from(element.children)) observer.observe(child)
    element.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [measure, children])

  /** Scroll by most of a screenful, so the eye keeps an anchor. */
  function nudge(direction: -1 | 1): void {
    const element = viewport.current
    if (element === null) return
    element.scrollBy({ left: direction * element.clientWidth * 0.8, behavior: 'smooth' })
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    // Only the primary button pans; a right-click should still open a menu.
    if (event.button !== 0) return
    // A draggable child owns its own gesture — panning would fight the drag.
    if ((event.target as HTMLElement).closest('[draggable="true"]') !== null) return
    const element = viewport.current
    if (element === null) return
    drag.current = { startX: event.clientX, startScroll: element.scrollLeft, moved: false }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    const state = drag.current
    const element = viewport.current
    if (state === null || element === null) return
    const delta = event.clientX - state.startX
    if (!state.moved && Math.abs(delta) < DRAG_THRESHOLD) return
    if (!state.moved) {
      state.moved = true
      // Capture only once the gesture is a pan, so a plain click keeps its
      // normal target and the card underneath still receives it.
      element.setPointerCapture(event.pointerId)
    }
    element.scrollLeft = state.startScroll - delta
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>): void {
    const state = drag.current
    const element = viewport.current
    if (state !== null && state.moved && element !== null) {
      element.releasePointerCapture(event.pointerId)
      // Swallow the click this pan would otherwise produce.
      const swallow = (click: MouseEvent): void => {
        click.stopPropagation()
        click.preventDefault()
      }
      element.addEventListener('click', swallow, { capture: true, once: true })
      // If no click follows (a pan that ended off a card), do not leave the
      // listener armed for the next real click.
      window.setTimeout(() => element.removeEventListener('click', swallow, { capture: true }), 0)
    }
    drag.current = null
  }

  return (
    <div className="dcs-strip-wrap">
      {arrows && overflow.left ? (
        <button type="button" className="dcs-strip-arrow dcs-strip-arrow-left"
          aria-label="向左" onClick={() => nudge(-1)}>‹</button>
      ) : null}
      <div
        ref={viewport}
        className={'dcs-strip' + (className === undefined ? '' : ' ' + className)}
        aria-label={ariaLabel ?? ''}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {children}
      </div>
      {arrows && overflow.right ? (
        <button type="button" className="dcs-strip-arrow dcs-strip-arrow-right"
          aria-label="向右" onClick={() => nudge(1)}>›</button>
      ) : null}
    </div>
  )
}

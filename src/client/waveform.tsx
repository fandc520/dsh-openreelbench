/**
 * A waveform with a draggable selection, written from scratch.
 *
 * No wavesurfer, no peaks.js: the client bundle may only import from the
 * platform module table, so a third-party audio library is not an option. What
 * is available is enough — `decodeAudioData` gives the samples and a canvas
 * draws them.
 *
 * The selection marks what to KEEP. Trimming itself happens on the host with
 * ffmpeg, because only the host can write the file; this component's whole job
 * is turning "that hiss at the end" into two numbers.
 *
 * Decoding is deliberately one-shot per URL and the peaks are downsampled to
 * the canvas width before drawing. A thirty-second clip is a million-odd
 * samples, and walking them on every repaint would make dragging crawl.
 */
import { useEffect, useRef, useState } from 'react'

export interface Selection {
  start: number
  end: number
}

export interface WaveformProps {
  /** Audio to draw; undefined renders an empty frame. */
  url: string | undefined
  selection: Selection | null
  onSelectionChange: (selection: Selection | null) => void
  /** Playback position in seconds, drawn as a cursor. */
  playhead?: number
  height?: number
}

/** Min/max envelope per pixel column — the shape a person recognises. */
function buildPeaks(buffer: AudioBuffer, columns: number): Array<[number, number]> {
  const channel = buffer.getChannelData(0)
  const perColumn = Math.max(1, Math.floor(channel.length / columns))
  const peaks: Array<[number, number]> = []
  for (let column = 0; column < columns; column += 1) {
    const from = column * perColumn
    const to = Math.min(channel.length, from + perColumn)
    let min = 0
    let max = 0
    for (let i = from; i < to; i += 1) {
      const sample = channel[i]!
      if (sample < min) min = sample
      if (sample > max) max = sample
    }
    peaks.push([min, max])
  }
  return peaks
}

function cssVar(element: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

export function Waveform({
  url, selection, onSelectionChange, playhead, height = 72,
}: WaveformProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const dragging = useRef<{ from: number } | null>(null)

  useEffect(() => {
    if (url === undefined) {
      setBuffer(null)
      return undefined
    }
    let live = true
    setLoading(true)
    setError(null)
    // A fresh context per decode, closed straight after: browsers cap how many
    // stay open, and this component can mount once per section.
    const context = new AudioContext()
    void fetch(url)
      .then((response) => response.arrayBuffer())
      .then((bytes) => context.decodeAudioData(bytes))
      .then((decoded) => { if (live) setBuffer(decoded) })
      .catch(() => { if (live) setError('这段音频读不出来') })
      .finally(() => {
        void context.close()
        if (live) setLoading(false)
      })
    return () => { live = false }
  }, [url])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    canvas.width = Math.max(1, Math.floor(width * ratio))
    canvas.height = Math.floor(height * ratio)
    const context = canvas.getContext('2d')
    if (context === null) return
    context.scale(ratio, ratio)
    context.clearRect(0, 0, width, height)

    const wave = cssVar(canvas, '--dsw-alias-label-tertiary', '#888')
    const brand = cssVar(canvas, '--dsw-alias-brand-primary', '#4a9')
    // The wave carries the panel's second hue as a vertical gradient: cyan at
    // the centerline, easing to green toward the peaks — colour maps to
    // amplitude, so the loud passages read deeper without a second look.
    const waveGrad = context.createLinearGradient(0, 0, 0, height)
    waveGrad.addColorStop(0, cssVar(canvas, '--dcs-wave-edge', '#34d399'))
    waveGrad.addColorStop(0.5, cssVar(canvas, '--dcs-wave-core', '#22d3ee'))
    waveGrad.addColorStop(1, cssVar(canvas, '--dcs-wave-edge', '#34d399'))
    const middle = height / 2

    if (buffer === null) {
      context.strokeStyle = wave
      context.globalAlpha = 0.35
      context.beginPath()
      context.moveTo(0, middle)
      context.lineTo(width, middle)
      context.stroke()
      context.globalAlpha = 1
      return
    }

    // Kept region bright, trimmed region dimmed — the picture says what a save
    // would do without anyone reading a number.
    const toX = (seconds: number): number => (seconds / buffer.duration) * width
    if (selection !== null) {
      context.fillStyle = waveGrad
      context.globalAlpha = 0.14
      context.fillRect(toX(selection.start), 0, toX(selection.end) - toX(selection.start), height)
      context.globalAlpha = 1
    }

    const peaks = buildPeaks(buffer, Math.max(1, Math.floor(width)))
    peaks.forEach(([min, max], x) => {
      const inSelection = selection === null
        || (x >= toX(selection.start) && x <= toX(selection.end))
      context.strokeStyle = inSelection ? waveGrad : wave
      context.globalAlpha = inSelection ? 0.9 : 0.3
      context.beginPath()
      context.moveTo(x + 0.5, middle - max * middle * 0.92)
      context.lineTo(x + 0.5, middle - min * middle * 0.92)
      context.stroke()
    })
    context.globalAlpha = 1

    if (playhead !== undefined && playhead > 0) {
      context.strokeStyle = brand
      context.beginPath()
      context.moveTo(toX(playhead), 0)
      context.lineTo(toX(playhead), height)
      context.stroke()
    }
  }, [buffer, selection, playhead, height])

  function secondsAt(event: { clientX: number }): number {
    const canvas = canvasRef.current
    if (canvas === null || buffer === null) return 0
    const rect = canvas.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    return ratio * buffer.duration
  }

  return (
    <div className="dcs-wave">
      <canvas
        ref={canvasRef}
        className="dcs-wave-canvas"
        style={{ height: height + 'px' }}
        onPointerDown={(event) => {
          if (buffer === null) return
          event.currentTarget.setPointerCapture(event.pointerId)
          dragging.current = { from: secondsAt(event) }
        }}
        onPointerMove={(event) => {
          const drag = dragging.current
          if (drag === null || buffer === null) return
          const to = secondsAt(event)
          const start = Math.min(drag.from, to)
          const end = Math.max(drag.from, to)
          // A stray click is not a selection; it clears one.
          if (end - start < 0.05) return
          onSelectionChange({ start, end })
        }}
        onPointerUp={(event) => {
          const drag = dragging.current
          dragging.current = null
          event.currentTarget.releasePointerCapture(event.pointerId)
          if (drag !== null && Math.abs(secondsAt(event) - drag.from) < 0.05) onSelectionChange(null)
        }}
      />
      <div className="dcs-wave-foot">
        {loading ? <span className="dcs-hint">读取波形…</span> : null}
        {error !== null ? <span className="dcs-hint dcs-note-error">{error}</span> : null}
        {buffer !== null && error === null && !loading ? (
          <span className="dcs-hint">
            {selection === null
              ? '全长 ' + buffer.duration.toFixed(2) + ' 秒 · 在波形上拖选要保留的部分'
              : '保留 ' + selection.start.toFixed(2) + ' – ' + selection.end.toFixed(2)
                + ' 秒（共 ' + (selection.end - selection.start).toFixed(2) + ' 秒），点一下取消'}
          </span>
        ) : null}
      </div>
    </div>
  )
}

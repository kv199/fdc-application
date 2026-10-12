(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.HudShiftBar = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SEGMENT_COUNT = 36
  // Must match REDLINE_RPM_FRACTION in overlay.js, the threshold the Gear
  // block uses for redline when Shift Light has no learned target.
  const SHIFT_FALLBACK_FRACTION = 0.85
  const SEGMENT_VIEW_BOX = '0 0 48 32'
  const TRIANGLE_PATH = 'M19.2 6.4 Q24 0 28.8 6.4 L42 24 Q48 32 38 32 H10 Q0 32 6 24 Z'
  const ROTATED_TRIANGLE_TRANSFORM = 'rotate(180 24 16)'
  const SIGNALS = Object.freeze(['normal', 'redline', 'shift'])
  const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
  // Float error such as 10 / 36 * 36 < 10 must not drop a segment.
  const FILL_EPSILON = 1e-9

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function clamp01(value) {
    return Math.min(1, Math.max(0, value))
  }

  /**
   * Position of RPM between idle (0) and the current gear's threshold (1).
   * The threshold is the learned shift RPM when one is supplied; otherwise it
   * is SHIFT_FALLBACK_FRACTION of max RPM. Missing RPM or threshold data gives 0.
   */
  function fillFraction({ rpm, rpmIdle, rpmMax, shiftRpm } = {}) {
    const current = finite(rpm)
    if (current === null) return 0

    const idle = Math.max(0, finite(rpmIdle) ?? 0)
    const learned = finite(shiftRpm)
    const max = finite(rpmMax)
    let threshold = null
    if (learned !== null && learned > 0) threshold = learned
    else if (max !== null && max > 0) threshold = max * SHIFT_FALLBACK_FRACTION
    if (threshold === null || threshold <= idle) return 0

    return clamp01((current - idle) / (threshold - idle))
  }

  /** Whole segments lit for a fraction. Floor, so the bar is full only at the threshold. */
  function filledSegments(fraction, count = SEGMENT_COUNT) {
    const value = finite(fraction)
    if (value === null || value <= 0) return 0
    return Math.min(count, Math.floor(clamp01(value) * count + FILL_EPSILON))
  }

  /** Alternate apex-up and apex-down triangles. */
  function segmentTransform(index) {
    return index % 2 === 1 ? ROTATED_TRIANGLE_TRANSFORM : null
  }

  function normalizeSignal(signal) {
    return SIGNALS.includes(signal) ? signal : 'normal'
  }

  /**
   * Builds the segment row once and renders fill and signal. Each call writes
   * only the segments whose lit state changes and the signal when it changes.
   */
  function createShiftBar(options = {}) {
    const doc = typeof document !== 'undefined' ? document : null
    const root = options.root || doc?.getElementById('shift-bar') || null
    const container = options.segments || doc?.getElementById('shift-bar-segments') || null
    const segments = []
    let filledCount = 0
    let writtenSignal = null

    function createSegment(index) {
      const svg = doc.createElementNS(SVG_NAMESPACE, 'svg')
      svg.setAttribute('class', 'shift-bar__segment')
      svg.setAttribute('viewBox', SEGMENT_VIEW_BOX)
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      svg.setAttribute('aria-hidden', 'true')
      const group = doc.createElementNS(SVG_NAMESPACE, 'g')
      const transform = segmentTransform(index)
      if (transform) group.setAttribute('transform', transform)
      const empty = doc.createElementNS(SVG_NAMESPACE, 'path')
      empty.setAttribute('class', 'shift-bar__empty')
      empty.setAttribute('d', TRIANGLE_PATH)
      const fill = doc.createElementNS(SVG_NAMESPACE, 'path')
      fill.setAttribute('class', 'shift-bar__fill')
      fill.setAttribute('d', TRIANGLE_PATH)
      group.appendChild(empty)
      group.appendChild(fill)
      svg.appendChild(group)
      return svg
    }

    if (container && doc) {
      for (let index = 0; index < SEGMENT_COUNT; index += 1) {
        const segment = createSegment(index)
        container.appendChild(segment)
        segments.push(segment)
      }
    }

    function setFilled(count) {
      const from = filledCount
      filledCount = count
      const low = Math.min(from, count)
      const high = Math.max(from, count)
      for (let index = low; index < high; index += 1) {
        segments[index]?.classList.toggle('is-filled', index < count)
      }
    }

    function setSignal(signal) {
      if (signal === writtenSignal) return
      writtenSignal = signal
      root?.setAttribute('data-signal', signal)
    }

    // A redline or shift signal lights the whole row in the signal color, the
    // same moment the Gear block changes. Otherwise the row follows the fill.
    function render({ fraction = 0, signal = 'normal' } = {}) {
      const nextSignal = normalizeSignal(signal)
      const nextCount = nextSignal === 'normal' ? filledSegments(fraction) : SEGMENT_COUNT
      setSignal(nextSignal)
      if (nextCount !== filledCount) setFilled(nextCount)
      return getState()
    }

    function getState() {
      return {
        filledSegments: filledCount,
        segmentCount: SEGMENT_COUNT,
        signal: writtenSignal ?? 'normal'
      }
    }

    return { getState, render }
  }

  return {
    SEGMENT_COUNT,
    SHIFT_FALLBACK_FRACTION,
    TRIANGLE_PATH,
    createShiftBar,
    fillFraction,
    filledSegments,
    segmentTransform
  }
}))

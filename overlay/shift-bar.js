(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.HudShiftBar = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SEGMENT_COUNT = 36
  // The limiter flash starts at this share of the limiter RPM.
  const LIMITER_RPM_FRACTION = 0.97
  // Before any limiter hit, the limiter is estimated at this share of the game's max RPM. Recorded
  // limiters sit at 87-97% of it, so red then shows on the first pull for every recorded car,
  // usually about 0.15 s before the limiter in first gear.
  const LIMITER_ESTIMATE_FRACTION = 0.89
  // Segment geometry is drawn in design px (434 px wide with 12 px side padding
  // leaves 410 px for the row). Neighboring segment boxes overlap by 1.5 design px.
  const DESIGN_ROW_WIDTH = 410
  const DESIGN_OVERLAP = 1.5
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

  function finitePositive(value) {
    const number = finite(value)
    return number !== null && number > 0 ? number : null
  }

  /** The measured limiter: the usable ceiling, then the provisional ceiling (the highest hit so far). */
  function measuredLimiterRpm({ usableCeiling, provisionalCeiling } = {}) {
    return finitePositive(usableCeiling) ?? finitePositive(provisionalCeiling)
  }

  /**
   * The limiter RPM: the measured limiter when there is one, otherwise
   * LIMITER_ESTIMATE_FRACTION of the game's max RPM. Null when none is known.
   */
  function limiterRpm({ usableCeiling, provisionalCeiling, rpmMax } = {}) {
    const measured = measuredLimiterRpm({ usableCeiling, provisionalCeiling })
    if (measured !== null) return measured
    const max = finitePositive(rpmMax)
    return max === null ? null : max * LIMITER_ESTIMATE_FRACTION
  }

  /**
   * The RPM where red starts: LIMITER_RPM_FRACTION of the limiter. While the
   * cue is enabled and the gear's shift target lies above that point, red waits
   * until RPM passes the target (at most the limiter), so purple shows first.
   * This applies when the limiter is measured, so a gear that should be
   * shifted at the limiter still shows purple, and when the target is a learned
   * shift point for the current gear (learnedTarget), so a learned target just
   * below the estimated limiter still shows purple before red. With only the
   * estimate and no learned target, the target is the unreached game max, so
   * red does not wait.
   */
  function redlineRpm({ rpmMax, usableCeiling, provisionalCeiling, shiftCueEnabled = false, effectiveTargetRpm, learnedTarget = false } = {}) {
    const limiter = limiterRpm({ usableCeiling, provisionalCeiling, rpmMax })
    if (limiter === null) return null
    const threshold = limiter * LIMITER_RPM_FRACTION
    const measured = measuredLimiterRpm({ usableCeiling, provisionalCeiling }) !== null
    const target = shiftCueEnabled === true && (measured || learnedTarget === true) ? finitePositive(effectiveTargetRpm) : null
    return target === null ? threshold : Math.min(limiter, Math.max(threshold, target))
  }

  /**
   * The signal the Gear block and the Shift Bar both show. Red, from
   * redlineRpm, takes priority over purple. Purple is the Shift Light cue:
   * phase 'shift' while the cue is enabled. The 'approach' phase shows nothing.
   */
  function resolveSignal({ rpm, rpmMax, usableCeiling, provisionalCeiling, shiftCueEnabled = false, shiftPhase = 'normal', effectiveTargetRpm, learnedTarget = false } = {}) {
    const current = finite(rpm)
    const redline = redlineRpm({ rpmMax, usableCeiling, provisionalCeiling, shiftCueEnabled, effectiveTargetRpm, learnedTarget })
    if (current !== null && redline !== null && current >= redline) return 'redline'
    if (shiftCueEnabled === true && shiftPhase === 'shift') return 'shift'
    return 'normal'
  }

  /**
   * The RPM where the Shift Bar is full: the Shift Light cue-on RPM while the
   * cue is enabled (lightOnRpm, else effectiveTargetRpm), but never later than
   * the point where red starts, so the bar is full by then; otherwise where red
   * starts. Null when no threshold is known.
   */
  function resolveThresholdRpm({ rpmMax, usableCeiling, provisionalCeiling, shiftCueEnabled = false, lightOnRpm, effectiveTargetRpm, learnedTarget = false } = {}) {
    const redline = redlineRpm({ rpmMax, usableCeiling, provisionalCeiling, shiftCueEnabled, effectiveTargetRpm, learnedTarget })
    if (shiftCueEnabled === true) {
      const cueRpm = finitePositive(lightOnRpm) ?? finitePositive(effectiveTargetRpm)
      if (cueRpm !== null) return redline === null ? cueRpm : Math.min(cueRpm, redline)
    }
    return redline
  }

  /**
   * Position of RPM between idle (0) and thresholdRpm (1). Missing RPM or
   * threshold data, or a threshold at or below idle, gives 0.
   */
  function fillFraction({ rpm, rpmIdle, thresholdRpm } = {}) {
    const current = finite(rpm)
    if (current === null) return 0

    const idle = Math.max(0, finite(rpmIdle) ?? 0)
    const threshold = finite(thresholdRpm)
    if (threshold === null || threshold <= idle) return 0

    return clamp01((current - idle) / (threshold - idle))
  }

  /** Whole segments lit for a fraction. Floor, so the bar is full only at the threshold. */
  function filledSegments(fraction, count = SEGMENT_COUNT) {
    const value = finite(fraction)
    if (value === null || value <= 0) return 0
    return Math.min(count, Math.floor(clamp01(value) * count + FILL_EPSILON))
  }

  function normalizeSignal(signal) {
    return SIGNALS.includes(signal) ? signal : 'normal'
  }

  /** Rounds to 3 decimals and drops trailing zeros, for SVG path data. */
  function roundForPath(value) {
    return Number(value.toFixed(3))
  }

  /**
   * Geometry of the whole row in device pixels, so one SVG user unit is one
   * device pixel. Each segment starts at a whole-pixel step, so the gaps are
   * equal. width and height are the segments container's content box. Null
   * unless both are finite and above zero.
   */
  function segmentGeometry(width, height) {
    const w = finitePositive(width)
    const h = finitePositive(height)
    if (w === null || h === null) return null
    const unit = w / DESIGN_ROW_WIDTH
    // Segment box width: the row plus the overlaps of the 35 neighboring pairs, split over 36 boxes.
    const box = (w + (SEGMENT_COUNT - 1) * DESIGN_OVERLAP * unit) / SEGMENT_COUNT
    const step = Math.max(1, Math.round(box - DESIGN_OVERLAP * unit))
    const shapeWidth = box * 2 / 3
    const slant = box / 3
    const shapeHeight = Math.min(h, Math.round(box * 4 / 3))
    const extent = (SEGMENT_COUNT - 1) * step + box
    const left = Math.round((w - extent) / 2)
    const top = Math.round((h - shapeHeight) / 2)
    // The same right-leaning parallelogram in every segment, unrotated.
    const path = `M${roundForPath(slant)} 0 H${roundForPath(box)} L${roundForPath(shapeWidth)} ${shapeHeight} H0 Z`
    return { width: w, height: h, step, left, top, path }
  }

  /**
   * Builds the segment row once and renders fill and signal. The row is one
   * SVG in device pixels, so every segment starts on a whole pixel and the gaps
   * are equal. Each render call writes only the segments whose lit state
   * changes and the signal when it changes.
   */
  function createShiftBar(options = {}) {
    const doc = typeof document !== 'undefined' ? document : null
    const root = options.root || doc?.getElementById('shift-bar') || null
    const container = options.segments || doc?.getElementById('shift-bar-segments') || null
    const segments = []
    let row = null
    let appliedWidth = null
    let appliedHeight = null
    let appliedPixelRatio = null
    let filledCount = 0
    let writtenSignal = null

    function createSegment() {
      const group = doc.createElementNS(SVG_NAMESPACE, 'g')
      group.setAttribute('class', 'shift-bar__segment')
      const empty = doc.createElementNS(SVG_NAMESPACE, 'path')
      empty.setAttribute('class', 'shift-bar__empty')
      const fill = doc.createElementNS(SVG_NAMESPACE, 'path')
      fill.setAttribute('class', 'shift-bar__fill')
      group.appendChild(empty)
      group.appendChild(fill)
      return group
    }

    if (container && doc) {
      row = doc.createElementNS(SVG_NAMESPACE, 'svg')
      row.setAttribute('class', 'shift-bar__row')
      row.setAttribute('aria-hidden', 'true')
      row.setAttribute('preserveAspectRatio', 'none')
      for (let index = 0; index < SEGMENT_COUNT; index += 1) {
        const segment = createSegment()
        row.appendChild(segment)
        segments.push(segment)
      }
      container.appendChild(row)
    }

    /**
     * Applies the geometry for a device-pixel size: the row viewBox and CSS
     * size, then each segment's position and path. The CSS size is the same
     * whole device pixels, so the SVG is not stretched and every step stays
     * whole. Skips every write when the size is unchanged.
     */
    function layout(width, height) {
      const geometry = segmentGeometry(width, height)
      if (geometry === null) return null
      const pixelRatio = globalThis.devicePixelRatio || 1
      if (geometry.width === appliedWidth && geometry.height === appliedHeight && pixelRatio === appliedPixelRatio) return geometry
      appliedWidth = geometry.width
      appliedHeight = geometry.height
      appliedPixelRatio = pixelRatio
      row?.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`)
      row?.style?.setProperty('width', `${geometry.width / pixelRatio}px`)
      row?.style?.setProperty('height', `${geometry.height / pixelRatio}px`)
      segments.forEach((segment, index) => {
        segment.setAttribute('transform', `translate(${geometry.left + index * geometry.step} ${geometry.top})`)
        for (const path of segment.children) path.setAttribute('d', geometry.path)
      })
      return geometry
    }

    // Measures the container in device pixels. Without ResizeObserver nothing is measured.
    function observeSize() {
      if (typeof ResizeObserver !== 'function' || !container) return
      const observer = new ResizeObserver(entries => {
        const entry = entries[entries.length - 1]
        if (!entry) return
        const size = entry.devicePixelContentBoxSize?.[0]
        if (size) {
          layout(size.inlineSize, size.blockSize)
          return
        }
        const dpr = globalThis.devicePixelRatio || 1
        layout(Math.round(entry.contentRect.width * dpr), Math.round(entry.contentRect.height * dpr))
      })
      try {
        observer.observe(container, { box: 'device-pixel-content-box' })
      } catch {
        observer.observe(container)
      }
    }

    observeSize()

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
    // same moment the Gear block changes, and flashes in step with it. Otherwise
    // the row follows the fill.
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

    return { getState, layout, render }
  }

  return {
    LIMITER_RPM_FRACTION,
    LIMITER_ESTIMATE_FRACTION,
    SEGMENT_COUNT,
    createShiftBar,
    fillFraction,
    filledSegments,
    limiterRpm,
    redlineRpm,
    resolveSignal,
    resolveThresholdRpm,
    segmentGeometry
  }
}))

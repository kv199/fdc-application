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
   * cue is enabled, the limiter is measured, and the gear's shift target lies
   * above that point, red waits until RPM passes the target (at most the
   * limiter), so a gear that should be shifted at the limiter still shows purple
   * first. With only the estimate, the target is the unreached game max, so red
   * does not wait.
   */
  function redlineRpm({ rpmMax, usableCeiling, provisionalCeiling, shiftCueEnabled = false, effectiveTargetRpm } = {}) {
    const limiter = limiterRpm({ usableCeiling, provisionalCeiling, rpmMax })
    if (limiter === null) return null
    const threshold = limiter * LIMITER_RPM_FRACTION
    const measured = measuredLimiterRpm({ usableCeiling, provisionalCeiling }) !== null
    const target = shiftCueEnabled === true && measured ? finitePositive(effectiveTargetRpm) : null
    return target === null ? threshold : Math.min(limiter, Math.max(threshold, target))
  }

  /**
   * The signal the Gear block and the Shift Bar both show. Red, from
   * redlineRpm, takes priority over purple. Purple is the Shift Light cue:
   * phase 'shift' while the cue is enabled. The 'approach' phase shows nothing.
   */
  function resolveSignal({ rpm, rpmMax, usableCeiling, provisionalCeiling, shiftCueEnabled = false, shiftPhase = 'normal', effectiveTargetRpm } = {}) {
    const current = finite(rpm)
    const redline = redlineRpm({ rpmMax, usableCeiling, provisionalCeiling, shiftCueEnabled, effectiveTargetRpm })
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
  function resolveThresholdRpm({ rpmMax, usableCeiling, provisionalCeiling, shiftCueEnabled = false, lightOnRpm, effectiveTargetRpm } = {}) {
    const redline = redlineRpm({ rpmMax, usableCeiling, provisionalCeiling, shiftCueEnabled, effectiveTargetRpm })
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

    return { getState, render }
  }

  return {
    LIMITER_RPM_FRACTION,
    LIMITER_ESTIMATE_FRACTION,
    SEGMENT_COUNT,
    TRIANGLE_PATH,
    createShiftBar,
    fillFraction,
    filledSegments,
    limiterRpm,
    redlineRpm,
    resolveSignal,
    resolveThresholdRpm,
    segmentTransform
  }
}))

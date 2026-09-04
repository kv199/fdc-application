(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.HudDelta = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_LIMIT_SECONDS = 1

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function tracePointsFrom(value) {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== 'object') return []
    const candidates = [
      value.tracePoints,
      value.trace_points,
      value.referenceTrace,
      value.reference_trace,
      value.points,
      value.samples,
      value.trace,
      value.referenceRun,
      value.reference_run,
      value.run,
      value.referenceLap,
      value.reference_lap,
      value.lap
    ]
    const points = candidates.find(Array.isArray)
    if (points) return points
    for (const nested of candidates) {
      if (!nested || typeof nested !== 'object') continue
      const nestedPoints = tracePointsFrom(nested)
      if (nestedPoints.length) return nestedPoints
    }

    // A compact caller may keep the reference as parallel distance/time
    // arrays instead of allocating point objects.
    const distances = value.distancesM ?? value.distances_m ?? value.distances ?? value.distance
    const elapsedMs = value.elapsedMs ?? value.elapsed_ms ?? value.elapsedTimesMs
      ?? value.elapsed_times_ms ?? value.timesMs ?? value.times_ms
    const elapsedSeconds = value.times
    if (!Array.isArray(distances)) return []
    if (Array.isArray(elapsedMs)) {
      return distances.map((distanceM, index) => ({ distanceM, elapsedMs: elapsedMs[index] }))
    }
    if (Array.isArray(elapsedSeconds)) {
      return distances.map((distanceM, index) => ({ distanceM, elapsedS: elapsedSeconds[index] }))
    }
    return []
  }

  function elapsedMsFrom(point) {
    const milliseconds = finite(
      point?.elapsedMs
      ?? point?.elapsed_ms
      ?? point?.elapsedTimeMs
      ?? point?.elapsed_time_ms
      ?? point?.timeMs
      ?? point?.time_ms
    )
    if (milliseconds !== null) return milliseconds

    const seconds = finite(point?.elapsedS ?? point?.elapsed_s ?? point?.seconds ?? point?.time)
    return seconds === null ? null : seconds * 1000
  }

  function distanceMFrom(point) {
    return finite(point?.distanceM ?? point?.distance_m ?? point?.distance)
  }

  /**
   * Convert an Event reference trace to the small shape consumed by the HUD.
   * Event/run loaders can retain snake_case names, while callers may provide a
   * direct array for a lightweight integration or test.
   */
  function normalizeTracePoints(value) {
    return tracePointsFrom(value)
      .map(point => {
        const distanceM = distanceMFrom(point)
        const elapsedMs = elapsedMsFrom(point)
        if (distanceM === null || elapsedMs === null || distanceM < 0 || elapsedMs < 0) return null
        return { distanceM, elapsedMs }
      })
      .filter(Boolean)
      .sort((left, right) => left.distanceM - right.distanceM)
      .reduce((points, point) => {
        const previous = points.at(-1)
        if (previous && previous.distanceM === point.distanceM) {
          // Keep the latest timestamp for duplicate distance samples. This is
          // also what the event trace renderer does when collapsing samples.
          previous.elapsedMs = point.elapsedMs
        } else {
          points.push(point)
        }
        return points
      }, [])
  }

  function explicitReference(value) {
    if (!value || typeof value !== 'object') return value
    return value.reference
      ?? value.activeReference
      ?? value.active_reference
      ?? value.deltaReference
      ?? value.delta_reference
      ?? value.referenceLap
      ?? value.reference_lap
      ?? value.referenceRun
      ?? value.reference_run
      ?? value
  }

  function normalizeReference(value) {
    const source = explicitReference(value)
    const tracePoints = normalizeTracePoints(source)
    if (tracePoints.length < 2) return null
    const distanceOriginM = tracePoints[0].distanceM
    const elapsedOriginMs = tracePoints[0].elapsedMs
    const rebasedTracePoints = tracePoints.map(point => ({
      ...point,
      distanceM: point.distanceM - distanceOriginM,
      elapsedMs: point.elapsedMs - elapsedOriginMs
    }))
    return {
      eventId: source?.eventId ?? source?.event_id ?? value?.eventId ?? value?.event_id ?? null,
      tracePoints: rebasedTracePoints,
      startDistanceM: 0,
      endDistanceM: rebasedTracePoints.at(-1).distanceM,
      durationMs: rebasedTracePoints.at(-1).elapsedMs
    }
  }

  function interpolateReferenceMs(reference, distanceM) {
    if (!reference || !Array.isArray(reference.tracePoints) || reference.tracePoints.length < 2) return null
    const distance = finite(distanceM)
    if (distance === null) return null
    const points = reference.tracePoints
    if (distance <= points[0].distanceM) return points[0].elapsedMs
    if (distance >= points.at(-1).distanceM) return points.at(-1).elapsedMs

    for (let index = 1; index < points.length; index += 1) {
      const before = points[index - 1]
      const after = points[index]
      if (distance > after.distanceM) continue
      const span = after.distanceM - before.distanceM
      if (span <= 0) return after.elapsedMs
      const ratio = (distance - before.distanceM) / span
      return before.elapsedMs + ((after.elapsedMs - before.elapsedMs) * ratio)
    }
    return null
  }

  function currentElapsedMs(telemetry) {
    const currentMs = finite(telemetry?.lap?.currentMs ?? telemetry?.lap?.current_ms)
    if (currentMs !== null && currentMs >= 0) return currentMs
    const currentSeconds = finite(telemetry?.lap?.current)
    return currentSeconds === null || currentSeconds < 0 ? null : currentSeconds * 1000
  }

  function currentDistanceM(telemetry) {
    const distance = finite(telemetry?.lap?.distanceM ?? telemetry?.lap?.distance_m ?? telemetry?.lap?.distance)
    return distance === null || distance < 0 ? null : distance
  }

  /** Return current elapsed time minus reference elapsed time. Negative is ahead. */
  function calculateDelta(telemetry, reference, distanceOverrideM) {
    if (!telemetry || typeof telemetry !== 'object' || telemetry.isRaceOn !== true) return null
    const elapsedMs = currentElapsedMs(telemetry)
    const distanceM = distanceOverrideM === undefined
      ? currentDistanceM(telemetry)
      : finite(distanceOverrideM)
    const referenceMs = interpolateReferenceMs(reference, distanceM)
    if (elapsedMs === null || referenceMs === null) return null
    return (elapsedMs - referenceMs) / 1000
  }

  function toneForDelta(delta) {
    if (!Number.isFinite(delta) || delta === 0) return 'neutral'
    return delta < 0 ? 'ahead' : 'behind'
  }

  function fillPercent(delta, limitSeconds = DEFAULT_LIMIT_SECONDS) {
    const limit = finite(limitSeconds)
    if (!Number.isFinite(delta) || limit === null || limit <= 0) return 0
    return Math.min(50, Math.abs(delta) / limit * 50)
  }

  function formatDelta(delta) {
    if (!Number.isFinite(delta)) return '—'
    const sign = delta < 0 ? '-' : '+'
    return `${sign}${Math.abs(delta).toFixed(3)}`
  }

  function createDeltaRuntime(options = {}) {
    const root = options.root
      || (typeof document !== 'undefined' ? document.getElementById('delta-strip') : null)
    const valueElement = options.valueElement
      || root?.querySelector?.('[data-delta-value]')
      || (typeof document !== 'undefined' ? document.getElementById('delta-value') : null)
    const fillElement = options.fillElement
      || root?.querySelector?.('[data-delta-fill]')
      || (typeof document !== 'undefined' ? document.getElementById('delta-fill') : null)
    const barElement = options.barElement
      || root?.querySelector?.('[data-delta-bar]')
      || (typeof document !== 'undefined' ? document.getElementById('delta-bar') : null)
    const limitSeconds = finite(options.limitSeconds) ?? DEFAULT_LIMIT_SECONDS
    let reference = null
    let latest = null
    let distanceOriginM = null
    let lastDistanceM = null
    let lastLapNumber = null

    function resetDistanceTracking() {
      distanceOriginM = null
      lastDistanceM = null
      lastLapNumber = null
    }

    function relativeDistance(telemetry) {
      if (!telemetry || typeof telemetry !== 'object' || telemetry.isRaceOn !== true) {
        resetDistanceTracking()
        return null
      }
      const distanceM = currentDistanceM(telemetry)
      if (distanceM === null) return null
      const lapNumber = finite(telemetry?.lap?.number)
      const lapAdvanced = lastLapNumber !== null && lapNumber !== null && lapNumber > lastLapNumber
      const distanceRewound = lastDistanceM !== null && distanceM + 100 < lastDistanceM
      if (distanceOriginM === null || lapAdvanced || distanceRewound) distanceOriginM = distanceM
      lastDistanceM = distanceM
      lastLapNumber = lapNumber
      return Math.max(0, distanceM - distanceOriginM)
    }

    function render(delta) {
      latest = Number.isFinite(delta) ? delta : null
      const tone = toneForDelta(latest)
      const width = fillPercent(latest, limitSeconds)
      if (valueElement) {
        valueElement.textContent = formatDelta(latest)
        valueElement.dataset.tone = tone
      }
      if (barElement) {
        barElement.dataset.tone = tone
        const ariaValue = latest === null ? 0 : Math.max(-limitSeconds, Math.min(limitSeconds, latest))
        barElement.setAttribute('aria-valuenow', String(ariaValue))
      }
      if (fillElement) fillElement.style.width = `${width}%`
      if (root) root.dataset.deltaTone = tone
      return getState()
    }

    function setReference(nextReference) {
      reference = normalizeReference(nextReference)
      resetDistanceTracking()
      render(null)
      return reference
    }

    function setActiveEvent(event) {
      return setReference(event)
    }

    function clearReference() {
      reference = null
      resetDistanceTracking()
      return render(null)
    }

    function update(telemetry) {
      const distanceM = relativeDistance(telemetry)
      return render(calculateDelta(telemetry, reference, distanceM))
    }

    function getState() {
      return {
        deltaSeconds: latest,
        tone: toneForDelta(latest),
        fillPercent: fillPercent(latest, limitSeconds),
        reference
      }
    }

    render(null)
    return {
      clearReference,
      getState,
      render,
      setActiveEvent,
      setReference,
      update
    }
  }

  return {
    DEFAULT_LIMIT_SECONDS,
    calculateDelta,
    currentDistanceM,
    currentElapsedMs,
    fillPercent,
    formatDelta,
    interpolateReferenceMs,
    normalizeReference,
    normalizeTracePoints,
    toneForDelta,
    createDeltaRuntime
  }
}))

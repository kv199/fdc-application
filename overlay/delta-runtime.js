(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.HudDelta = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_LIMIT_SECONDS = 1
  const REFERENCE_DISTANCE_RATIO = 0.97
  // FDC virtual sectors are equal thirds of the reference lap distance.
  const SECTOR_COUNT = 3
  // Sector timing needs the lap observed from its start.
  const SECTOR_LAP_START_TOLERANCE_MS = 1000
  const SECTOR_TONE_LABELS = {
    better: 'better',
    worse: 'worse',
    best: 'best',
    equal: 'equal',
    active: 'current',
    neutral: 'no result'
  }

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function positiveMs(value) {
    const milliseconds = finite(value)
    return milliseconds !== null && milliseconds > 0 ? milliseconds : null
  }

  function smallestMs(...values) {
    const known = values.filter(value => Number.isFinite(value))
    return known.length ? Math.min(...known) : null
  }

  function neutralSectors() {
    return Array.from({ length: SECTOR_COUNT }, () => ({ tone: 'neutral', deltaMs: null }))
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

  function referenceTimeMsFrom(value) {
    const source = explicitReference(value)
    const candidates = source === value ? [source] : [value, source]
    const millisecondKeys = [
      'timeMs',
      'time_ms',
      'durationMs',
      'duration_ms',
      'lapTimeMs',
      'lap_time_ms',
      'finalTimeMs',
      'final_time_ms',
      'bestTimeMs',
      'best_time_ms'
    ]
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue
      for (const key of millisecondKeys) {
        const milliseconds = finite(candidate[key])
        if (milliseconds !== null && milliseconds >= 0) return milliseconds
      }
      // Compact callers use unqualified duration/time aliases in seconds;
      // *_ms and *Ms above are always interpreted as milliseconds.
      for (const key of ['duration', 'time', 'seconds']) {
        const seconds = finite(candidate[key])
        if (seconds !== null && seconds >= 0) return seconds * 1000
      }
    }
    return null
  }

  /** Event-wide best sector times as [s1, s2, s3] in ms; absent or invalid values are null. */
  function bestSectorsMsFrom(...sources) {
    const bestSectors = sources
      .map(source => source?.bestSectors ?? source?.best_sectors)
      .find(value => value && typeof value === 'object')
    return [
      positiveMs(bestSectors?.sector1TimeMs ?? bestSectors?.sector1_time_ms),
      positiveMs(bestSectors?.sector2TimeMs ?? bestSectors?.sector2_time_ms),
      positiveMs(bestSectors?.sector3TimeMs ?? bestSectors?.sector3_time_ms)
    ]
  }

  function normalizeReference(value) {
    const source = explicitReference(value)
    const tracePoints = normalizeTracePoints(source)
    const timeMs = referenceTimeMsFrom(value)
    if (tracePoints.length < 2) return null
    const distanceOriginM = tracePoints[0].distanceM
    const elapsedOriginMs = tracePoints[0].elapsedMs
    const rebasedTracePoints = tracePoints.map(point => ({
      ...point,
      distanceM: point.distanceM - distanceOriginM,
      elapsedMs: point.elapsedMs - elapsedOriginMs
    }))
    const traceDurationMs = rebasedTracePoints.at(-1).elapsedMs
    return {
      eventId: source?.eventId
        ?? source?.event_id
        ?? source?.id
        ?? value?.eventId
        ?? value?.event_id
        ?? value?.id
        ?? null,
      timeMs,
      tracePoints: rebasedTracePoints,
      startDistanceM: 0,
      endDistanceM: rebasedTracePoints.at(-1).distanceM,
      durationMs: traceDurationMs,
      bestSectorsMs: bestSectorsMsFrom(source, value)
    }
  }

  function isBetterReference(candidate, current) {
    if (!candidate) return false
    if (!current || String(candidate.eventId) !== String(current.eventId)) return true
    // A reference that covers noticeably less distance is a partial attempt,
    // so it never replaces a full one regardless of its time, and a full
    // reference always replaces a partial one.
    const candidateDistanceM = finite(candidate.endDistanceM)
    const currentDistanceM = finite(current.endDistanceM)
    if (candidateDistanceM !== null && currentDistanceM !== null && currentDistanceM > 0) {
      if (candidateDistanceM < currentDistanceM * REFERENCE_DISTANCE_RATIO) return false
      if (candidateDistanceM * REFERENCE_DISTANCE_RATIO > currentDistanceM) return true
    }
    const candidateTimeMs = finite(candidate.timeMs)
    const currentTimeMs = finite(current.timeMs)
    if (candidateTimeMs === null) return false
    return currentTimeMs === null || candidateTimeMs < currentTimeMs
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

  /**
   * Sector durations [s1, s2, s3] of a reference in ms. Sector boundaries are
   * thirds of the reference distance; null marks a sector that cannot be known.
   */
  function referenceSectorTimesMs(reference) {
    const endDistanceM = finite(reference?.endDistanceM)
    if (!reference || endDistanceM === null || endDistanceM <= 0) return neutralSectorTimes()
    const firstBoundaryMs = interpolateReferenceMs(reference, endDistanceM / SECTOR_COUNT)
    const secondBoundaryMs = interpolateReferenceMs(reference, (2 * endDistanceM) / SECTOR_COUNT)
    const endMs = finite(reference.timeMs) ?? finite(reference.durationMs)
    return [
      firstBoundaryMs,
      firstBoundaryMs === null || secondBoundaryMs === null ? null : secondBoundaryMs - firstBoundaryMs,
      secondBoundaryMs === null || endMs === null ? null : endMs - secondBoundaryMs
    ].map(positiveMs)
  }

  function neutralSectorTimes() {
    return Array.from({ length: SECTOR_COUNT }, () => null)
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

  /** Signed sector difference in ms as seconds with three decimals; 0 is shown as 0.000. */
  function formatSectorDelta(deltaMs) {
    if (!Number.isFinite(deltaMs)) return '—'
    if (deltaMs === 0) return '0.000'
    const sign = deltaMs < 0 ? '-' : '+'
    return `${sign}${(Math.abs(deltaMs) / 1000).toFixed(3)}`
  }

  function formatRaceTime(timeMs) {
    const milliseconds = finite(timeMs)
    if (milliseconds === null || milliseconds < 0) return '—'
    const roundedMs = Math.round(milliseconds)
    const minutes = String(Math.floor(roundedMs / 60000)).padStart(2, '0')
    const seconds = ((roundedMs % 60000) / 1000).toFixed(3).padStart(6, '0')
    return `${minutes}:${seconds}`
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
    const bestElement = options.bestElement
      || root?.querySelector?.('[data-delta-best]')
      || (typeof document !== 'undefined' ? document.getElementById('delta-best') : null)
    const bestContainer = options.bestContainer
      || root?.querySelector?.('[data-delta-best-container]')
      || bestElement?.parentElement
    const sectorElements = Array.isArray(options.sectorElements)
      ? options.sectorElements
      : Array.from(root?.querySelectorAll?.('[data-delta-sector]') || [])
    const limitSeconds = finite(options.limitSeconds) ?? DEFAULT_LIMIT_SECONDS
    let reference = null
    let latest = null
    let distanceOriginM = null
    let lastDistanceM = null
    let lastLapNumber = null
    // Set when relativeDistance() re-establishes the lap origin; the next
    // telemetry update consumes it to start a sector lap.
    let lapStarted = false
    // Samples and sector boundary times of the lap currently tracked.
    let lapTrack = null
    // Results shown for the three sectors, and the sector being driven (-1 for none).
    let sectorResults = neutralSectors()
    let activeSector = -1
    // True while a finished lap's results remain visible at the start of a new
    // lap, until that lap's first sector completes.
    let holdingResults = false
    // True once any sector of the row has completed since the row was cleared.
    let rowHasResults = false
    let bestSectorsMs = neutralSectorTimes()

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
      if (distanceOriginM === null || lapAdvanced || distanceRewound) {
        distanceOriginM = distanceM
        lapStarted = true
      }
      lastDistanceM = distanceM
      lastLapNumber = lapNumber
      return Math.max(0, distanceM - distanceOriginM)
    }

    // A lap first observed after its start, such as after the pause menu cleared
    // the live flag, has a distance origin in mid-lap, so its sector boundaries
    // would be wrong; it produces no sector results.
    function startSectorLap(elapsedMs) {
      lapTrack = elapsedMs !== null && elapsedMs <= SECTOR_LAP_START_TOLERANCE_MS
        ? { previousSample: null, firstBoundaryMs: null, secondBoundaryMs: null, thirdDone: false }
        : null
      holdingResults = rowHasResults
      activeSector = holdingResults || !lapTrack ? -1 : 0
    }

    function sectorResultFor(index, currentMs) {
      if (currentMs === null) return { tone: 'neutral', deltaMs: null }
      const bestMs = bestSectorsMs[index]
      const elapsedMs = Math.round(currentMs)
      const referenceMs = referenceSectorTimesMs(reference)[index]
      // The best time is updated even when there is no reference to compare
      // with, because the measured sector still counts toward the Event's best.
      bestSectorsMs[index] = smallestMs(bestMs, currentMs)
      if (referenceMs === null) return { tone: 'neutral', deltaMs: null }
      const deltaMs = elapsedMs - Math.round(referenceMs)
      let tone
      if (bestMs !== null && elapsedMs < Math.round(bestMs)) tone = 'best'
      else if (deltaMs === 0) tone = 'equal'
      else tone = deltaMs < 0 ? 'better' : 'worse'
      return { tone, deltaMs }
    }

    // currentMs is the measured sector duration, or null when it cannot be
    // measured. Sectors of a held row are ignored until the first sector of
    // the new lap completes, which replaces the held results.
    function completeSector(index, currentMs) {
      if (index === 0 && holdingResults) {
        sectorResults = neutralSectors()
        holdingResults = false
      }
      if (holdingResults) return
      sectorResults[index] = sectorResultFor(index, currentMs)
      rowHasResults = true
      activeSector = index < SECTOR_COUNT - 1 ? index + 1 : -1
    }

    function crossesBoundary(previousM, boundaryM, currentM) {
      return previousM < boundaryM && boundaryM <= currentM
    }

    function elapsedAtBoundary(previous, current, boundaryM) {
      const ratio = (boundaryM - previous.distanceM) / (current.distanceM - previous.distanceM)
      return previous.elapsedMs + ((current.elapsedMs - previous.elapsedMs) * ratio)
    }

    function trackSectors(telemetry, distanceM) {
      const started = lapStarted
      lapStarted = false
      if (!reference) {
        lapTrack = null
        return
      }
      if (distanceM === null) return
      const elapsedMs = currentElapsedMs(telemetry)
      if (started) startSectorLap(elapsedMs)
      if (!lapTrack || elapsedMs === null) return

      const sample = { distanceM, elapsedMs }
      const previous = lapTrack.previousSample
      lapTrack.previousSample = sample
      if (!previous) return

      const endDistanceM = reference.endDistanceM
      const firstBoundaryM = endDistanceM / SECTOR_COUNT
      const secondBoundaryM = (2 * endDistanceM) / SECTOR_COUNT
      if (lapTrack.firstBoundaryMs === null && crossesBoundary(previous.distanceM, firstBoundaryM, distanceM)) {
        lapTrack.firstBoundaryMs = elapsedAtBoundary(previous, sample, firstBoundaryM)
        completeSector(0, lapTrack.firstBoundaryMs)
      }
      if (lapTrack.secondBoundaryMs === null && crossesBoundary(previous.distanceM, secondBoundaryM, distanceM)) {
        lapTrack.secondBoundaryMs = elapsedAtBoundary(previous, sample, secondBoundaryM)
        const secondMs = lapTrack.firstBoundaryMs === null
          ? null
          : lapTrack.secondBoundaryMs - lapTrack.firstBoundaryMs
        completeSector(1, secondMs)
      }
    }

    function mergeBestSectors(nextReference) {
      const referenceSectorsMs = referenceSectorTimesMs(nextReference)
      bestSectorsMs = bestSectorsMs.map((bestMs, index) => smallestMs(
        bestMs,
        nextReference.bestSectorsMs?.[index],
        referenceSectorsMs[index]
      ))
    }

    function resetSectorRow() {
      sectorResults = neutralSectors()
      activeSector = -1
      holdingResults = false
      rowHasResults = false
      lapTrack = null
    }

    /** Sector cells as the row presents them, with the driven sector marked active. */
    function sectorDisplay() {
      return sectorResults.map((sector, index) => (index === activeSector
        ? { tone: 'active', deltaMs: null }
        : { tone: sector.tone, deltaMs: sector.deltaMs }))
    }

    // Last value written to each DOM property. Telemetry renders on every
    // packet while most presented values stay the same, so unchanged writes are
    // skipped to avoid needless style and layout work. The elements are fixed
    // for the runtime's lifetime, so these caches never need resetting.
    const written = {
      valueText: undefined,
      valueTone: undefined,
      barTone: undefined,
      ariaValue: undefined,
      fillWidth: undefined,
      rootTone: undefined,
      bestText: undefined,
      bestAvailable: undefined,
      bestLabel: undefined,
      bestHidden: undefined
    }
    const sectorCells = sectorElements.map(element => ({
      element,
      valueElement: element?.querySelector?.('[data-delta-sector-value]') || null,
      tone: undefined,
      text: undefined,
      label: undefined
    }))

    function renderSectors(display) {
      sectorCells.forEach((cell, index) => {
        const sector = display[index] || { tone: 'neutral', deltaMs: null }
        const tone = sector.tone
        const text = formatSectorDelta(sector.deltaMs)
        const label = `Sector ${index + 1}, ${SECTOR_TONE_LABELS[tone] || SECTOR_TONE_LABELS.neutral}`
        if (cell.element?.dataset && cell.tone !== tone) cell.element.dataset.sectorTone = tone
        cell.tone = tone
        if (cell.valueElement && cell.text !== text) cell.valueElement.textContent = text
        cell.text = text
        if (typeof cell.element?.setAttribute === 'function' && cell.label !== label) {
          cell.element.setAttribute('aria-label', label)
        }
        cell.label = label
      })
    }

    function render(delta) {
      latest = Number.isFinite(delta) ? delta : null
      const tone = toneForDelta(latest)
      const width = `${fillPercent(latest, limitSeconds)}%`
      if (valueElement) {
        const text = formatDelta(latest)
        if (written.valueText !== text) {
          valueElement.textContent = text
          written.valueText = text
        }
        if (written.valueTone !== tone) {
          valueElement.dataset.tone = tone
          written.valueTone = tone
        }
      }
      if (barElement) {
        if (written.barTone !== tone) {
          barElement.dataset.tone = tone
          written.barTone = tone
        }
        const ariaValue = String(latest === null ? 0 : Math.max(-limitSeconds, Math.min(limitSeconds, latest)))
        if (written.ariaValue !== ariaValue) {
          barElement.setAttribute('aria-valuenow', ariaValue)
          written.ariaValue = ariaValue
        }
      }
      if (fillElement && written.fillWidth !== width) {
        fillElement.style.width = width
        written.fillWidth = width
      }
      if (root && written.rootTone !== tone) {
        root.dataset.deltaTone = tone
        written.rootTone = tone
      }
      if (bestElement) {
        const bestTimeMs = reference?.timeMs ?? null
        const bestText = formatRaceTime(bestTimeMs)
        if (written.bestText !== bestText) {
          bestElement.textContent = bestText
          written.bestText = bestText
        }
        const available = bestTimeMs === null ? 'false' : 'true'
        if (bestElement.dataset && written.bestAvailable !== available) {
          bestElement.dataset.available = available
          written.bestAvailable = available
        }
        if (typeof bestElement.setAttribute === 'function') {
          const label = bestTimeMs === null ? 'Best lap time unavailable' : `Best lap time ${bestText}`
          if (written.bestLabel !== label) {
            bestElement.setAttribute('aria-label', label)
            written.bestLabel = label
          }
        }
      }
      if (bestContainer) {
        const hidden = reference?.timeMs === null || reference?.timeMs === undefined
        if (written.bestHidden !== hidden) {
          bestContainer.hidden = hidden
          written.bestHidden = hidden
        }
      }
      renderSectors(sectorDisplay())
      return getState()
    }

    // Installing a reference keeps the sector row and its hold state, so a
    // lap that just finished stays visible until the next lap's first sector.
    function setReference(nextReference) {
      reference = normalizeReference(nextReference)
      resetDistanceTracking()
      if (reference) {
        mergeBestSectors(reference)
      } else {
        bestSectorsMs = neutralSectorTimes()
        resetSectorRow()
      }
      render(null)
      return reference
    }

    function setActiveEvent(event) {
      return setReference(event)
    }

    function clearReference() {
      reference = null
      resetDistanceTracking()
      lapStarted = false
      bestSectorsMs = neutralSectorTimes()
      resetSectorRow()
      return render(null)
    }

    function update(telemetry) {
      const distanceM = relativeDistance(telemetry)
      trackSectors(telemetry, distanceM)
      return render(calculateDelta(telemetry, reference, distanceM))
    }

    /**
     * Finalize the last sector of the lap being tracked with the lap time. Call
     * it before the next telemetry update so the tracked lap is still the one
     * that just finished.
     */
    function completeLap(timeMs) {
      const lapMs = finite(timeMs)
      if (!reference || !lapTrack || lapMs === null || lapMs <= 0) return getState()
      if (lapTrack.secondBoundaryMs !== null && !lapTrack.thirdDone) {
        lapTrack.thirdDone = true
        const thirdMs = lapMs - lapTrack.secondBoundaryMs
        completeSector(2, thirdMs > 0 ? thirdMs : null)
      }
      return render(latest)
    }

    function getState() {
      return {
        deltaSeconds: latest,
        tone: toneForDelta(latest),
        fillPercent: fillPercent(latest, limitSeconds),
        bestTimeMs: reference?.timeMs ?? null,
        reference,
        sectors: sectorDisplay(),
        bestSectorsMs: bestSectorsMs.slice()
      }
    }

    render(null)
    return {
      clearReference,
      completeLap,
      getState,
      render,
      setActiveEvent,
      setReference,
      update
    }
  }

  return {
    DEFAULT_LIMIT_SECONDS,
    REFERENCE_DISTANCE_RATIO,
    calculateDelta,
    currentDistanceM,
    currentElapsedMs,
    fillPercent,
    formatDelta,
    formatRaceTime,
    formatSectorDelta,
    interpolateReferenceMs,
    isBetterReference,
    normalizeReference,
    normalizeTracePoints,
    referenceSectorTimesMs,
    referenceTimeMsFrom,
    toneForDelta,
    createDeltaRuntime
  }
}))

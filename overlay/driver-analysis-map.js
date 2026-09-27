(function (globalScope, factory) {
  const scoringApi = typeof module !== 'undefined' && module.exports && typeof document === 'undefined'
    ? require('./driver-analysis-scoring.js') : globalScope.DriverAnalysisScoring
  const api = factory(scoringApi)
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysisMap = api
}(typeof globalThis !== 'undefined' ? globalThis : this, scoringApi => {
  'use strict'

  // Same density as an Events lap trace.
  const TRACE_INTERVAL_MS = 100
  const ERROR_TYPES = Object.freeze(['front_scrub', 'exit_wheelspin', 'brake_steering_overload', 'abrupt_brake_release'])
  const ERROR_SHORT_LABELS = Object.freeze({
    front_scrub: 'SCRUB',
    exit_wheelspin: 'WHEELSPIN',
    brake_steering_overload: 'BRAKE + STEER',
    abrupt_brake_release: 'RELEASE'
  })
  const WHEELS = ['Fl', 'Fr', 'Rl', 'Rr']
  const PEAK_QUADS = ['slipAngle', 'slipRatio', 'combinedSlip']
  const INSTANT_QUADS = ['tireTempC', 'suspension', 'puddle']

  function finite(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function pedalState(point) {
    if ((finite(point?.brake) ?? 0) >= 0.05) return 'brake'
    if ((finite(point?.throttle) ?? 0) >= 0.05) return 'throttle'
    return 'coast'
  }

  function hasPosition(sample) {
    return Array.isArray(sample?.position) && sample.position.length === 3 && sample.position.every(value => finite(value) !== null)
  }

  // Stored samples of one drive become trace points in the Events lap trace format: one point per 100 ms and at pedal
  // or gear changes. Slip keeps the signed peak and curb contact keeps any contact since the previous point.
  function tracePointsFromSamples(samples) {
    const usable = (Array.isArray(samples) ? samples : []).filter(sample => hasPosition(sample) && finite(sample.timestampMs) !== null)
    if (usable.length === 0) return []
    const firstTimestampMs = usable[0].timestampMs
    const points = []
    let peaks = {}
    let curbs = {}
    for (const sample of usable) {
      for (const quad of PEAK_QUADS) {
        WHEELS.forEach((wheel, index) => {
          const value = finite(sample[quad]?.[index])
          const key = `${quad}${wheel}`
          if (value !== null && (peaks[key] === undefined || Math.abs(value) > Math.abs(peaks[key]))) peaks[key] = value
        })
      }
      WHEELS.forEach((wheel, index) => { if (sample.rumble?.[index] === true) curbs[`rumble${wheel}`] = true })
      const previous = points.at(-1)
      const due = !previous
        || sample.timestampMs - previous.timestampMs >= TRACE_INTERVAL_MS
        || pedalState(sample) !== pedalState(previous)
        || finite(sample.gear) !== previous.gear
      if (!due) continue
      const point = {
        timestampMs: sample.timestampMs,
        elapsedMs: sample.timestampMs - firstTimestampMs,
        distanceM: finite(sample.lapDistance),
        positionX: sample.position[0],
        positionY: sample.position[1],
        positionZ: sample.position[2],
        throttle: finite(sample.throttle) ?? 0,
        brake: finite(sample.brake) ?? 0,
        speedKmh: finite(sample.speedKmh),
        gear: finite(sample.gear),
        rpm: finite(sample.rpm),
        steer: finite(sample.steer),
        accelerationX: finite(sample.accelerationX),
        accelerationY: finite(sample.accelerationY),
        accelerationZ: finite(sample.accelerationZ),
        yawRate: finite(sample.yawRate),
        ...peaks,
        ...curbs
      }
      for (const quad of INSTANT_QUADS) {
        WHEELS.forEach((wheel, index) => {
          const value = finite(sample[quad]?.[index])
          if (value !== null) point[`${quad}${wheel}`] = value
        })
      }
      points.push(point)
      peaks = {}
      curbs = {}
    }
    return points
  }

  function firstIndexAtOrAfter(points, timestampMs) {
    let low = 0
    let high = points.length - 1
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (points[middle].timestampMs < timestampMs) low = middle + 1
      else high = middle
    }
    return low
  }

  // Problem checks become trace segments and clean checks become single points.
  function checkMarks(checks, points) {
    const marks = { errors: [], clean: [] }
    if (!Array.isArray(checks) || !Array.isArray(points) || points.length < 2) return marks
    const lastIndex = points.length - 1
    for (const check of checks) {
      const started = finite(check?.startedAtMs)
      const finished = finite(check?.finishedAtMs) ?? started
      if (started === null) continue
      if (check.outcome === 'problem') {
        const startIndex = Math.min(firstIndexAtOrAfter(points, started), lastIndex - 1)
        const afterEnd = firstIndexAtOrAfter(points, finished)
        const endIndex = Math.min(lastIndex, Math.max(startIndex + 1, points[afterEnd].timestampMs > finished ? afterEnd - 1 : afterEnd))
        marks.errors.push({ kind: check.problemType || check.opportunityType, startIndex, endIndex, check })
      } else if (check.outcome === 'clean') {
        marks.clean.push({ index: firstIndexAtOrAfter(points, (started + finished) / 2), check })
      }
    }
    return marks
  }

  function errorCounts(marks) {
    const counts = {}
    for (const mark of marks?.errors || []) counts[mark.kind] = (counts[mark.kind] || 0) + 1
    return counts
  }

  const percent = value => `${Math.round(value * 100)}%`

  function responseLosses(metrics) {
    const parts = []
    const lateral = finite(metrics.lateralResponseLoss)
    const yaw = finite(metrics.yawResponseLoss)
    if (lateral !== null && lateral > 0) parts.push(`lateral −${lateral.toFixed(1)} m/s²`)
    if (yaw !== null && yaw > 0) parts.push(`yaw −${Math.round(yaw * 180 / Math.PI)} °/s`)
    return parts.length ? [`Response ${parts.join(' · ')}`] : []
  }

  function joined(parts) {
    const present = parts.filter(Boolean)
    return present.length ? [present.join(' · ')] : []
  }

  const describe = {
    front_scrub: m => [
      ...joined([finite(m.steerGrowth) !== null && `Steering +${percent(m.steerGrowth)}`, finite(m.peakFrontSlip) !== null && `front slip ${percent(m.peakFrontSlip)}`]),
      ...responseLosses(m)
    ],
    exit_wheelspin: m => [
      ...joined([finite(m.throttleGrowth) !== null && `Throttle +${percent(m.throttleGrowth)}`, finite(m.drivenSlipPeak) !== null && `driven slip ${percent(m.drivenSlipPeak)}`]),
      ...joined([finite(m.effectiveAccelerationPeak) !== null && `Acceleration ${Number(m.effectiveAccelerationPeak).toFixed(1)} m/s²`])
    ],
    brake_steering_overload: m => [
      ...joined([
        finite(m.maxBrake) !== null && `Brake ${percent(m.maxBrake)}`,
        finite(m.maxSteer) !== null && `steering ${percent(m.maxSteer)}`,
        finite(m.maxFrontCombinedSlip) !== null && `front slip ${percent(m.maxFrontCombinedSlip)}`
      ]),
      ...responseLosses(m)
    ],
    abrupt_brake_release: m => [
      ...joined([finite(m.previousBrake) !== null && `Brake ${percent(m.previousBrake)}`, finite(m.releaseRate) !== null && `released at ${percent(m.releaseRate)}/s`]),
      ...joined([finite(m.rearSlipRise) !== null && `Rear slip +${percent(m.rearSlipRise)}`]),
      ...responseLosses(m)
    ]
  }

  // What the analysis measured for one problem, in numbers, with the instruction of that problem type.
  function errorTooltipModel(mark, points) {
    const meta = scoringApi?.PROBLEM_META?.[mark.kind]
    const start = points[mark.startIndex]
    const firstDistance = finite(points[0]?.distanceM)
    const distance = finite(start?.distanceM)
    const durationS = Math.max(0, (finite(mark.check?.finishedAtMs) ?? 0) - (finite(mark.check?.startedAtMs) ?? 0)) / 1000
    const where = distance !== null && firstDistance !== null ? `${((distance - firstDistance) / 1000).toFixed(2)} km · ` : ''
    const metrics = mark.check?.metrics && typeof mark.check.metrics === 'object' ? mark.check.metrics : {}
    return {
      kind: mark.kind,
      heading: meta?.label || String(mark.kind || '').toUpperCase(),
      subtitle: `${where}${durationS.toFixed(1)} s`,
      lines: describe[mark.kind]?.(metrics) || [],
      instruction: meta?.instruction || null
    }
  }

  // Problem segments are short, so a hover within reach of one prefers it over a closer plain trace point.
  function nearestErrorIndex(marks, projected, x, y, maxDistance = 14) {
    let nearest = null
    let nearestDistance = maxDistance
    for (const mark of marks?.errors || []) {
      for (let index = mark.startIndex; index <= mark.endIndex; index += 1) {
        const point = projected[index]
        if (!point) continue
        const distance = Math.hypot(point.x - x, point.y - y)
        if (distance <= nearestDistance) {
          nearest = index
          nearestDistance = distance
        }
      }
    }
    return nearest
  }

  function errorAt(marks, index) {
    return (marks?.errors || []).find(mark => index >= mark.startIndex && index <= mark.endIndex) || null
  }

  return {
    ERROR_SHORT_LABELS,
    ERROR_TYPES,
    TRACE_INTERVAL_MS,
    checkMarks,
    errorAt,
    errorCounts,
    errorTooltipModel,
    nearestErrorIndex,
    tracePointsFromSamples
  }
}))

(function (globalScope, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.EventTraceMap = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict'

  const GRAVITY = 9.80665

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  /**
   * Determine the pedal state of a point.
   * Brake >= 0.05 wins, then throttle >= 0.05, else coast.
   * @param {object} point - trace point with throttle and brake properties
   * @returns {'brake'|'throttle'|'coast'}
   */
  function pedalState(point) {
    if (finiteNumber(point?.brake) >= 0.05) return 'brake'
    if (finiteNumber(point?.throttle) >= 0.05) return 'throttle'
    return 'coast'
  }

  /**
   * Check if a point is a slip point.
   * A point is slip when any wheel has abs(combinedSlip) > limit.
   * @param {object} point - trace point with combinedSlipFl/Fr/Rl/Rr properties
   * @param {number} limit - slip threshold, default 1
   * @returns {boolean}
   */
  function isSlipPoint(point, limit = 1) {
    if (!point || typeof point !== 'object') return false
    for (const wheel of ['Fl', 'Fr', 'Rl', 'Rr']) {
      const key = `combinedSlip${wheel}`
      const value = finiteNumber(point[key])
      if (value !== null && Math.abs(value) > limit) return true
    }
    return false
  }

  /**
   * Check if any point in the list has extended telemetry.
   * @param {array} points - trace points
   * @returns {boolean}
   */
  function hasExtendedTelemetry(points) {
    if (!Array.isArray(points) || points.length === 0) return false
    const extendedFields = [
      'speedKmh', 'gear', 'rpm', 'steer',
      'accelerationX', 'accelerationY', 'accelerationZ', 'yawRate',
      'slipAngleFl', 'slipAngleFr', 'slipAngleRl', 'slipAngleRr',
      'slipRatioFl', 'slipRatioFr', 'slipRatioRl', 'slipRatioRr',
      'combinedSlipFl', 'combinedSlipFr', 'combinedSlipRl', 'combinedSlipRr',
      'tireTempCFl', 'tireTempCFr', 'tireTempCRl', 'tireTempCRr',
      'suspensionFl', 'suspensionFr', 'suspensionRl', 'suspensionRr',
      'puddleFl', 'puddleFr', 'puddleRl', 'puddleRr',
      'rumbleFl', 'rumbleFr', 'rumbleRl', 'rumbleRr'
    ]
    for (const point of points) {
      if (!point || typeof point !== 'object') continue
      for (const field of extendedFields) {
        if (finiteNumber(point[field]) !== null) return true
        if (field.startsWith('rumble') && point[field] === true) return true
      }
    }
    return false
  }

  /**
   * Group consecutive points by a key function into contiguous runs.
   * Consecutive runs share their boundary point so polylines connect.
   * @param {array} points - trace points
   * @param {function} keyOf - function(point) => key; points with same key are grouped
   * @returns {array} of {key, startIndex, endIndex}
   */
  function groupRuns(points, keyOf) {
    if (!Array.isArray(points) || points.length === 0) return []
    const runs = []
    let currentKey = keyOf(points[0])
    let startIndex = 0

    for (let i = 1; i < points.length; i += 1) {
      const key = keyOf(points[i])
      if (key !== currentKey) {
        // End current run: inclusive endIndex
        runs.push({ key: currentKey, startIndex, endIndex: i - 1 })
        currentKey = key
        startIndex = i - 1
      }
    }
    // Final run
    runs.push({ key: currentKey, startIndex, endIndex: points.length - 1 })
    return runs
  }

  /**
   * Find the nearest projected point within a maximum distance.
   * @param {array} projected - array of {x, y} projected coordinates
   * @param {number} x - query x coordinate
   * @param {number} y - query y coordinate
   * @param {number} maxDistance - maximum distance to search, default 14
   * @returns {number|null} index of nearest point, or null if none within maxDistance
   */
  function nearestPointIndex(projected, x, y, maxDistance = 14) {
    if (!Array.isArray(projected) || projected.length === 0) return null
    let nearest = null
    let nearestDistance = maxDistance

    for (let i = 0; i < projected.length; i += 1) {
      const p = projected[i]
      if (!p || typeof p !== 'object') continue
      const px = finiteNumber(p.x)
      const py = finiteNumber(p.y)
      if (px === null || py === null) continue
      const distance = Math.hypot(px - x, py - y)
      if (distance < nearestDistance) {
        nearest = i
        nearestDistance = distance
      }
    }
    return nearest
  }

  /**
   * Format gear value for display.
   * 0 = R, >= 11 = N, else the number.
   * @param {number} gear - gear value
   * @returns {string}
   */
  function formatGear(gear) {
    if (gear === null || gear === undefined) return '—'
    const g = finiteNumber(gear)
    if (g === null) return '—'
    if (g === 0) return 'R'
    if (g >= 11) return 'N'
    return String(Math.round(g))
  }

  /**
   * Format acceleration in g (m/s^2 / GRAVITY).
   * @param {number} accel - acceleration in m/s^2
   * @param {number} digits - decimal places, default 2
   * @returns {string}
   */
  function formatAccelG(accel, digits = 2) {
    const a = finiteNumber(accel)
    if (a === null) return '—'
    const g = a / GRAVITY
    const factor = 10 ** digits
    const rounded = Math.round(g * factor) / factor
    return rounded.toFixed(digits)
  }

  /**
   * Format angle rate (rad/s to deg/s).
   * @param {number} radPerSec - radians per second
   * @returns {string}
   */
  function formatAngleRate(radPerSec) {
    const r = finiteNumber(radPerSec)
    if (r === null) return '—'
    const degPerSec = r * 180 / Math.PI
    return String(Math.round(degPerSec))
  }

  /**
   * Format percentage.
   * @param {number} value - 0..1 or 0..100
   * @param {boolean} isNormalized - if true, value is 0..1; if false, already 0..100
   * @returns {string}
   */
  function formatPercent(value, isNormalized = true) {
    const v = finiteNumber(value)
    if (v === null) return '—'
    const pct = isNormalized ? v * 100 : v
    return String(Math.round(pct))
  }

  /**
   * Format lap elapsed time like the Events run times: MM:SS.mmm
   * @param {number} ms - milliseconds
   * @returns {string}
   */
  function formatTime(ms) {
    const m = finiteNumber(ms)
    if (m === null) return '—'
    const totalSeconds = Math.max(0, m) / 1000
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = (totalSeconds - minutes * 60).toFixed(3).padStart(6, '0')
    return `${String(minutes).padStart(2, '0')}:${seconds}`
  }

  /**
   * Build tooltip model for a single point.
   * Returns plain data: rows (array of objects), wheelTable (array of rows),
   * optional curbRow and puddleRow, and legacyTelemetry flag.
   * @param {object} point - trace point
   * @param {number} firstDistanceM - distance of first point (for relative distance)
   * @returns {object}
   */
  function tooltipModel(point, firstDistanceM = 0) {
    if (!point || typeof point !== 'object') {
      return { rows: [], wheelTable: [], notes: [], legacyTelemetry: true }
    }

    const rows = []
    const distanceM = finiteNumber(point.distanceM) ?? finiteNumber(firstDistanceM)
    const hasExtended = hasExtendedTelemetry([point])

    // Always present: distance and time
    if (distanceM !== null) {
      rows.push({ label: 'DIST', value: String(Math.round(distanceM - firstDistanceM)) + ' m' })
    }
    rows.push({ label: 'TIME', value: formatTime(point.elapsedMs) })

    // Extended telemetry fields
    if (hasExtended) {
      const speed = finiteNumber(point.speedKmh)
      if (speed !== null) {
        rows.push({ label: 'SPEED', value: String(Math.round(speed)) + ' km/h' })
      }

      const gear = finiteNumber(point.gear)
      rows.push({ label: 'GEAR', value: formatGear(gear) })

      const rpm = finiteNumber(point.rpm)
      if (rpm !== null) {
        rows.push({ label: 'RPM', value: String(Math.round(rpm)) })
      }

      rows.push({ label: 'THROTTLE', value: formatPercent(point.throttle, true) + ' %' })
      rows.push({ label: 'BRAKE', value: formatPercent(point.brake, true) + ' %' })

      const steer = finiteNumber(point.steer)
      if (steer !== null) {
        rows.push({ label: 'STEER', value: String(Math.round(steer * 100)) + ' %' })
      }

      const ax = finiteNumber(point.accelerationX)
      const ay = finiteNumber(point.accelerationY)
      const az = finiteNumber(point.accelerationZ)
      if (ax !== null) rows.push({ label: 'LAT', value: formatAccelG(ax) + ' g' })
      if (az !== null) rows.push({ label: 'LONG', value: formatAccelG(az) + ' g' })
      if (ay !== null) rows.push({ label: 'VERT', value: formatAccelG(ay) + ' g' })

      const yaw = finiteNumber(point.yawRate)
      if (yaw !== null) {
        rows.push({ label: 'YAW', value: formatAngleRate(yaw) + ' °/s' })
      }

      // Wheel table
      const wheels = ['Fl', 'Fr', 'Rl', 'Rr']
      const wheelTable = []

      // Slip values are the recorder's peaks since the previous trace point.
      const combinedRow = { label: 'COMBINED', values: {} }
      for (const wheel of wheels) {
        const combined = finiteNumber(point[`combinedSlip${wheel}`])
        combinedRow.values[wheel] = combined !== null ? Math.round(Math.abs(combined) * 100) + '%' : '—'
      }
      wheelTable.push(combinedRow)

      const slipAngleRow = { label: 'SLIP ANGLE', values: {} }
      for (const wheel of wheels) {
        const angle = finiteNumber(point[`slipAngle${wheel}`])
        slipAngleRow.values[wheel] = angle !== null ? Math.round(Math.abs(angle) * 100) + '%' : '—'
      }
      wheelTable.push(slipAngleRow)

      const slipRatioRow = { label: 'SLIP RATIO', values: {} }
      for (const wheel of wheels) {
        const ratio = finiteNumber(point[`slipRatio${wheel}`])
        slipRatioRow.values[wheel] = ratio !== null ? Math.round(ratio * 100) + '%' : '—'
      }
      wheelTable.push(slipRatioRow)

      const tireRow = { label: 'TIRE', values: {} }
      for (const wheel of wheels) {
        const temp = finiteNumber(point[`tireTempC${wheel}`])
        tireRow.values[wheel] = temp !== null ? Math.round(temp) + '°C' : '—'
      }
      wheelTable.push(tireRow)

      const suspRow = { label: 'SUSP', values: {} }
      for (const wheel of wheels) {
        const susp = finiteNumber(point[`suspension${wheel}`])
        suspRow.values[wheel] = susp !== null ? Math.round(susp * 100) + '%' : '—'
      }
      wheelTable.push(suspRow)

      // Curb row (only if at least one wheel is on a curb)
      const curbWheels = []
      for (const wheel of wheels) {
        if (point[`rumble${wheel}`] === true) curbWheels.push(wheel)
      }
      const curbRow = curbWheels.length > 0
        ? { label: 'CURB', wheels: curbWheels }
        : null

      // Puddle row (only if at least one wheel has puddle depth > 0)
      const puddleWheels = {}
      for (const wheel of wheels) {
        const puddle = finiteNumber(point[`puddle${wheel}`])
        if (puddle !== null && puddle > 0) {
          puddleWheels[wheel] = Math.round(puddle * 100) + '%'
        }
      }
      const puddleRow = Object.keys(puddleWheels).length > 0
        ? { label: 'PUDDLE', wheels: puddleWheels }
        : null

      return {
        rows,
        wheelTable,
        notes: ['SLIP: PEAK OVER 0.1 S', 'SUSP: 0% EXTENDED · 100% COMPRESSED'],
        curbRow,
        puddleRow,
        legacyTelemetry: false
      }
    }

    // Legacy: only distance, time, throttle, brake
    rows.push({ label: 'THROTTLE', value: formatPercent(point.throttle, true) + ' %' })
    rows.push({ label: 'BRAKE', value: formatPercent(point.brake, true) + ' %' })
    rows.push({ label: 'INFO', value: 'EXTENDED TELEMETRY NOT RECORDED FOR THIS LAP' })

    return {
      rows,
      wheelTable: [],
      notes: [],
      legacyTelemetry: true
    }
  }

  return {
    pedalState,
    isSlipPoint,
    hasExtendedTelemetry,
    groupRuns,
    nearestPointIndex,
    formatGear,
    formatAccelG,
    formatAngleRate,
    formatPercent,
    formatTime,
    tooltipModel
  }
}))

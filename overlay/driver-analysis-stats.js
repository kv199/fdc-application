(function (globalScope, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysisStats = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict'

  const STATS_VERSION = 4
  const GRAVITY = 9.80665
  const MIN_EVENTS = 3
  const TURNING_PHASES = new Set(['turn-in', 'rotation', 'exit'])

  const DEFAULT_THRESHOLDS = Object.freeze({
    maxStepMs: 250,
    movingKmh: 5,
    brakeOn: 0.1,
    brakeOff: 0.05,
    steerOn: 0.12,
    fullLock: 0.99,
    fullThrottle: 0.95,
    throttleOn: 0.05,
    brakingMinSpeedKmh: 40,
    brakingMinMs: 300,
    brakingMaxMs: 15000,
    brakeReleaseLevel: 0.8,
    trailBrakeLevel: 0.3,
    trailBrakingMinMs: 250,
    cornerMinMs: 300,
    exitWindowMs: 6000,
    exitAfterFullThrottleMs: 2000,
    smoothingWindowMs: 150
  })

  function finite(value) {
    const number = Number(value)
    return value !== null && value !== undefined && value !== '' && Number.isFinite(number) ? number : null
  }

  function round(value, digits = 3) {
    const number = finite(value)
    if (number === null) return null
    const factor = 10 ** digits
    return Math.round(number * factor) / factor
  }

  function quantile(sorted, fraction) {
    if (sorted.length === 0) return null
    const position = (sorted.length - 1) * fraction
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
  }

  function distribution(values) {
    const sorted = values.filter(value => Number.isFinite(value)).sort((left, right) => left - right)
    if (sorted.length === 0) return null
    return {
      median: round(quantile(sorted, 0.5)),
      p10: round(quantile(sorted, 0.1)),
      p90: round(quantile(sorted, 0.9)),
      max: round(sorted[sorted.length - 1])
    }
  }

  function share(part, total) {
    return total > 0 ? round(part / total, 4) : null
  }

  function createDriverAnalysisStats(options = {}) {
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) }
    let totals
    let brakingEvent
    let brakingEvents
    let corner
    let corners
    let accelerationWindow = []
    let prevSteerMagnitude = 0

    function reset() {
      totals = {
        movingMs: 0, distanceM: 0, maxSpeedKmh: 0,
        fullThrottleMs: 0, partialThrottleMs: 0, coastMs: 0, brakeMs: 0, brakeWithSteeringMs: 0,
        turningMs: 0, frontSlipDominantMs: 0,
        steeringMs: 0, fullLockMs: 0
      }
      brakingEvent = null
      brakingEvents = []
      corner = null
      corners = []
      accelerationWindow = []
      prevSteerMagnitude = 0
    }

    function closeBraking(endMs) {
      const event = brakingEvent
      brakingEvent = null
      if (!event) return
      const durationMs = endMs - event.startMs
      if (durationMs < thresholds.brakingMinMs || durationMs > thresholds.brakingMaxMs) return
      const peakDecel = event.peakDecelValues.length > 0
        ? quantile(event.peakDecelValues.slice().sort((a, b) => a - b), 0.95)
        : 0
      const isTrailBraking = event.startedStraight && event.trailMs >= thresholds.trailBrakingMinMs
      brakingEvents.push({
        durationS: durationMs / 1000,
        releaseS: Math.max(0, endMs - event.lastHighAt) / 1000,
        peakDecelG: peakDecel / GRAVITY,
        startedStraight: event.startedStraight,
        trailBraking: isTrailBraking,
        trailS: event.trailMs / 1000
      })
    }

    function closeCorner() {
      const item = corner
      corner = null
      if (!item || item.lastTurnMs - item.startMs < thresholds.cornerMinMs) return
      const peakLateral = item.lateralValues.length > 0
        ? quantile(item.lateralValues.slice().sort((a, b) => a - b), 0.95)
        : 0
      const peakLongitudinal = item.longitudinalValues.length > 0
        ? quantile(item.longitudinalValues.slice().sort((a, b) => a - b), 0.95)
        : 0
      corners.push({
        lateralG: peakLateral / GRAVITY,
        lifted: item.lifted,
        toFullThrottleS: item.fullThrottleAt === null ? null : (item.fullThrottleAt - item.minSpeedAt) / 1000,
        peakLongitudinalG: item.fullThrottleAt === null || item.longitudinalValues.length === 0 ? null : peakLongitudinal / GRAVITY,
        fullLockEntries: item.fullLockEntries
      })
    }

    function discardTransient() {
      brakingEvent = null
      corner = null
      accelerationWindow = []
    }

    function getSmoothedAccelerations(now) {
      const cutoff = now - thresholds.smoothingWindowMs
      const windowSamples = accelerationWindow.filter(entry => entry.timestampMs >= cutoff)
      if (windowSamples.length === 0) return { lateral: 0, longitudinal: 0 }
      const lateralSum = windowSamples.reduce((sum, entry) => sum + Math.abs(entry.lateral), 0)
      const longitudinalSum = windowSamples.reduce((sum, entry) => sum + entry.longitudinal, 0)
      return {
        lateral: lateralSum / windowSamples.length,
        longitudinal: longitudinalSum / windowSamples.length
      }
    }

    function addAccelerationSample(sample) {
      const lateral = finite(sample.lateralResponse)
      const longitudinal = finite(sample.longitudinalResponse)
      if (lateral !== null || longitudinal !== null) {
        accelerationWindow.push({
          timestampMs: sample.timestampMs,
          lateral: lateral || 0,
          longitudinal: longitudinal || 0
        })
        const cutoff = sample.timestampMs - thresholds.smoothingWindowMs
        accelerationWindow = accelerationWindow.filter(entry => entry.timestampMs >= cutoff)
      }
    }

    function updateBraking(sample, dtMs) {
      const speed = sample.speedKmh
      if (!brakingEvent) {
        if (sample.brake >= thresholds.brakeOn && speed >= thresholds.brakingMinSpeedKmh) {
          brakingEvent = { startMs: sample.timestampMs, peakBrake: sample.brake, lastHighAt: sample.timestampMs, peakDecelValues: [], trailMs: 0, startedStraight: sample.steerMagnitude < thresholds.steerOn }
        } else return
      }
      if (sample.brake < thresholds.brakeOff) {
        closeBraking(sample.timestampMs)
        return
      }
      if (sample.brake > brakingEvent.peakBrake) brakingEvent.peakBrake = sample.brake
      if (sample.brake >= brakingEvent.peakBrake * thresholds.brakeReleaseLevel) brakingEvent.lastHighAt = sample.timestampMs
      const smoothed = getSmoothedAccelerations(sample.timestampMs)
      if (smoothed.longitudinal !== 0) brakingEvent.peakDecelValues.push(-smoothed.longitudinal)
      if (dtMs && sample.brake >= thresholds.trailBrakeLevel && sample.steerMagnitude >= thresholds.steerOn) brakingEvent.trailMs += dtMs
    }

    function updateCorner(snapshot, sample) {
      const turning = TURNING_PHASES.has(snapshot.phase)
      const maneuverId = snapshot.maneuverId
      if (turning && (!corner || maneuverId !== corner.id)) {
        closeCorner()
        corner = {
          id: maneuverId, startMs: sample.timestampMs, lastTurnMs: sample.timestampMs,
          lateralValues: [], longitudinalValues: [], lifted: false, minSpeed: Infinity, minSpeedAt: sample.timestampMs,
          fullThrottleAt: null, fullLockEntries: 0
        }
      }
      if (!corner) return
      const now = sample.timestampMs
      if (turning) {
        corner.lastTurnMs = now
        const smoothed = getSmoothedAccelerations(now)
        if (smoothed.lateral !== 0) corner.lateralValues.push(Math.abs(smoothed.lateral))
        if (sample.brake >= thresholds.brakeOn || sample.throttle < thresholds.fullThrottle) {
          corner.lifted = true
        }
        if (sample.speedKmh < corner.minSpeed) {
          corner.minSpeed = sample.speedKmh
          corner.minSpeedAt = now
          corner.fullThrottleAt = null
          corner.longitudinalValues = []
        }
      } else if (sample.brake >= thresholds.brakeOn || now - corner.lastTurnMs > thresholds.exitWindowMs) {
        closeCorner()
        return
      }
      if (corner.fullThrottleAt === null && sample.throttle >= thresholds.fullThrottle && sample.brake < thresholds.brakeOn) {
        corner.fullThrottleAt = now
      }
      const smoothed = getSmoothedAccelerations(now)
      if (smoothed.longitudinal !== 0 && corner.fullThrottleAt !== null && now >= corner.minSpeedAt) {
        corner.longitudinalValues.push(smoothed.longitudinal)
      }
      if (!turning && corner.fullThrottleAt !== null && now - corner.fullThrottleAt >= thresholds.exitAfterFullThrottleMs) closeCorner()
    }

    function update(snapshot) {
      const sample = snapshot?.sample
      if (snapshot?.valid !== true || !sample) {
        if (snapshot?.resetReason) discardTransient()
        return
      }
      const previous = snapshot.previousSample
      if (!previous) {
        discardTransient()
      } else {
        addAccelerationSample(sample)
      }
      const rawDt = previous ? sample.timestampMs - previous.timestampMs : 0
      const dtMs = rawDt > 0 && rawDt <= thresholds.maxStepMs ? rawDt : 0
      totals.maxSpeedKmh = Math.max(totals.maxSpeedKmh, sample.speedKmh)

      if (dtMs > 0) {
        const speedStepM = (sample.speedKmh + previous.speedKmh) / 2 / 3.6 * dtMs / 1000
        const lapDelta = finite(sample.lapDistanceM) !== null && finite(previous.lapDistanceM) !== null
          ? sample.lapDistanceM - previous.lapDistanceM
          : null
        totals.distanceM += lapDelta !== null && lapDelta > 0 && lapDelta <= speedStepM * 1.5 + 1 ? lapDelta : speedStepM
        if (sample.speedKmh >= thresholds.movingKmh) {
          totals.movingMs += dtMs
          if (sample.brake >= thresholds.brakeOn) {
            totals.brakeMs += dtMs
            if (sample.steerMagnitude >= thresholds.steerOn) totals.brakeWithSteeringMs += dtMs
          } else if (sample.throttle >= thresholds.fullThrottle) totals.fullThrottleMs += dtMs
          else if (sample.throttle >= thresholds.throttleOn) totals.partialThrottleMs += dtMs
          else totals.coastMs += dtMs
          if (sample.steerMagnitude >= thresholds.steerOn) totals.steeringMs += dtMs
          if (sample.steerMagnitude >= thresholds.fullLock) totals.fullLockMs += dtMs
        }
        if (TURNING_PHASES.has(snapshot.phase) && finite(sample.frontSlip) !== null && finite(sample.rearSlip) !== null) {
          totals.turningMs += dtMs
          if (sample.frontSlip > sample.rearSlip) totals.frontSlipDominantMs += dtMs
        }
        if (prevSteerMagnitude < thresholds.fullLock && sample.steerMagnitude >= thresholds.fullLock && corner) {
          corner.fullLockEntries++
        }
        prevSteerMagnitude = sample.steerMagnitude
      }
      updateBraking(sample, dtMs)
      updateCorner(snapshot, sample)
    }

    function finalize() {
      brakingEvent = null
      closeCorner()
      const exits = corners.filter(item => item.lifted === true && item.toFullThrottleS !== null)
      const flatOutCount = corners.filter(item => item.lifted === false).length
      const moving = totals.movingMs
      const straightStartCount = brakingEvents.filter(item => item.startedStraight).length
      const trailBrakingEvents = brakingEvents.filter(item => item.trailBraking)
      const cornersWithoutFullLock = corners.filter(c => c.fullLockEntries === 0).length
      return {
        version: STATS_VERSION,
        movingMs: Math.round(moving),
        distanceM: round(totals.distanceM, 1),
        avgSpeedKmh: moving > 0 ? round(totals.distanceM / (moving / 1000) * 3.6, 1) : null,
        maxSpeedKmh: round(totals.maxSpeedKmh, 1),
        pedals: {
          fullThrottle: share(totals.fullThrottleMs, moving),
          partialThrottle: share(totals.partialThrottleMs, moving),
          coast: share(totals.coastMs, moving),
          brake: share(totals.brakeMs, moving),
          brakeWithSteering: share(totals.brakeWithSteeringMs, moving)
        },
        steering: {
          fullLockShare: share(totals.fullLockMs, totals.steeringMs),
          pulsesPerCorner: distribution(corners.map(c => c.fullLockEntries)),
          cornersWithoutFullLock: cornersWithoutFullLock
        },
        braking: {
          count: brakingEvents.length,
          peakDecelG: distribution(brakingEvents.map(item => item.peakDecelG)),
          durationS: distribution(brakingEvents.map(item => item.durationS)),
          releaseS: distribution(brakingEvents.map(item => item.releaseS)),
          straightStartCount: straightStartCount,
          trailBrakingShare: share(trailBrakingEvents.length, straightStartCount),
          trailOverlapS: distribution(trailBrakingEvents.map(item => item.trailS))
        },
        corners: {
          count: corners.length,
          flatOutCount: flatOutCount,
          lateralG: distribution(corners.map(item => item.lateralG)),
          frontSlipDominantShare: share(totals.frontSlipDominantMs, totals.turningMs)
        },
        exits: {
          count: exits.length,
          toFullThrottleS: distribution(exits.map(item => item.toFullThrottleS)),
          peakLongitudinalG: distribution(exits.map(item => item.peakLongitudinalG))
        }
      }
    }

    reset()
    return { finalize, reset, resetTransient: discardTransient, update }
  }

  function percent(value) {
    const number = finite(value)
    return number === null ? null : `${Math.round(number * 100)}%`
  }

  function fixed(prefix, value, digits, unit) {
    const number = finite(value)
    return number === null ? null : `${prefix ? `${prefix} ` : ''}${number.toFixed(digits)} ${unit}`
  }

  function range(dist, digits, unit) {
    return dist && finite(dist.p10) !== null && finite(dist.p90) !== null
      ? `${Number(dist.p10).toFixed(digits)}–${Number(dist.p90).toFixed(digits)} ${unit}`
      : null
  }

  function join(parts) {
    return parts.filter(Boolean).join(' · ')
  }

  // Descriptive card rows only: no reference values, grades, or recommendations.
  function formatStatsRows(stats) {
    if (!stats || typeof stats !== 'object' || finite(stats.version) === null) return []
    const rows = []
    const distanceKm = finite(stats.distanceM) === null ? null : stats.distanceM / 1000
    const overview = join([
      distanceKm === null || distanceKm <= 0 ? null : `${distanceKm.toFixed(1)} km`,
      finite(stats.avgSpeedKmh) === null ? null : `avg ${Math.round(stats.avgSpeedKmh)} / max ${Math.round(finite(stats.maxSpeedKmh) ?? 0)} km/h`
    ])
    if (overview) rows.push({ key: 'overview', label: 'OVERVIEW', count: null, text: overview, title: '' })

    const pedals = stats.pedals || {}
    if (finite(stats.movingMs) > 0 && finite(pedals.brake) !== null) {
      const brake = percent(pedals.brake)
      const steering = percent(pedals.brakeWithSteering)
      rows.push({
        key: 'pedals', label: 'PEDALS', count: null,
        text: join([
          `Full throttle ${percent(pedals.fullThrottle)}`,
          `Partial ${percent(pedals.partialThrottle)}`,
          `Coast ${percent(pedals.coast)}`,
          steering ? `Brake ${brake} (steering ${steering})` : `Brake ${brake}`
        ]),
        title: 'Share of moving time'
      })
    }

    const steeringStats = stats.steering || {}
    if (finite(steeringStats.fullLockShare) !== null) {
      const fullLockPercent = percent(steeringStats.fullLockShare)
      const cornersCount = finite(stats.corners?.count) || 0
      const pulsesPerCorner = steeringStats.pulsesPerCorner
      const cornersWithoutFullLock = finite(steeringStats.cornersWithoutFullLock)
      const pulseText = cornersCount >= MIN_EVENTS && pulsesPerCorner && finite(pulsesPerCorner.median) !== null
        ? `${Math.round(pulsesPerCorner.median)} full-lock pulse${Math.round(pulsesPerCorner.median) === 1 ? '' : 's'} per corner`
        : null
      const noFullLockText = cornersCount >= MIN_EVENTS && cornersWithoutFullLock !== null
        ? `no full lock in ${cornersWithoutFullLock} of ${cornersCount} corners`
        : null
      rows.push({
        key: 'steering', label: 'STEERING', count: null,
        text: join([
          fullLockPercent ? `full lock ${fullLockPercent} of steering time` : null,
          pulseText,
          noFullLockText
        ]),
        title: pulsesPerCorner && finite(pulsesPerCorner.p10) !== null && finite(pulsesPerCorner.p90) !== null
          ? range(pulsesPerCorner, 0, 'full-lock pulses per corner')
          : ''
      })
    }

    const braking = stats.braking || {}
    if (finite(braking.count) >= MIN_EVENTS) {
      const trailBrakingText = finite(braking.trailBrakingShare) === null
        ? null
        : finite(braking.trailOverlapS?.median) === null
          ? `trail braking ${percent(braking.trailBrakingShare)}`
          : `trail braking ${percent(braking.trailBrakingShare)} (${Number(braking.trailOverlapS.median).toFixed(1)} s)`
      rows.push({
        key: 'braking', label: 'BRAKING', count: braking.count,
        text: join([
          fixed('peak', braking.peakDecelG?.median, 2, 'g'),
          fixed('', braking.durationS?.median, 1, 's'),
          fixed('release', braking.releaseS?.median, 2, 's'),
          trailBrakingText
        ]),
        title: join([
          range(braking.peakDecelG, 2, 'g peak decel'),
          range(braking.durationS, 1, 's braking'),
          range(braking.releaseS, 2, 's release'),
          range(braking.trailOverlapS, 1, 's trail braking')
        ])
      })
    }

    const corners = stats.corners || {}
    if (finite(corners.count) >= MIN_EVENTS) {
      const flatOutText = finite(corners.flatOutCount) !== null
        ? `flat-out ${corners.flatOutCount} of ${corners.count}`
        : null
      rows.push({
        key: 'corners', label: 'CORNERS', count: corners.count,
        text: join([
          fixed('lateral', corners.lateralG?.median, 2, 'g'),
          fixed('peak', corners.lateralG?.p90, 2, 'g'),
          finite(corners.frontSlipDominantShare) === null ? null : `front slip > rear ${percent(corners.frontSlipDominantShare)}`,
          flatOutText
        ]),
        title: range(corners.lateralG, 2, 'g lateral') || ''
      })
    }

    const exits = stats.exits || {}
    if (finite(exits.count) >= MIN_EVENTS) {
      rows.push({
        key: 'exits', label: 'EXIT', count: exits.count,
        text: join([
          fixed('full throttle in', exits.toFullThrottleS?.median, 1, 's'),
          fixed('peak', exits.peakLongitudinalG?.median, 2, 'g')
        ]),
        title: join([
          range(exits.toFullThrottleS, 1, 's to full throttle'),
          range(exits.peakLongitudinalG, 2, 'g longitudinal')
        ])
      })
    }
    return rows
  }

  return { DEFAULT_THRESHOLDS, MIN_EVENTS, STATS_VERSION, createDriverAnalysisStats, distribution, formatStatsRows }
}))

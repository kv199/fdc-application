(function (globalScope, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysisState = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict'

  const PHASES = Object.freeze({
    STRAIGHT: 'straight',
    BRAKING: 'braking',
    TURN_IN: 'turn-in',
    ROTATION: 'rotation',
    EXIT: 'exit'
  })

  const DEFAULT_THRESHOLDS = Object.freeze({
    maxFrameGapMs: 250,
    minSpeedKmh: 25,
    brakeOn: 0.1,
    brakeOff: 0.05,
    steerOn: 0.12,
    steerRelease: 0.08,
    throttleOn: 0.2,
    speedBinKmh: 25,
    maneuverEndMs: 180,
    minManeuverMs: 120,
    bridgeMaxMs: 1000,
    bridgeLateralMin: 3
  })

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function clamp01(value) {
    const number = finite(value)
    return number === null ? 0 : Math.max(0, Math.min(1, number))
  }

  function averageQuad(quad, keys = ['fl', 'fr', 'rl', 'rr'], absoluteValues = true) {
    const values = keys.map(key => finite(quad?.[key]))
    if (values.some(value => value === null)) return null
    return values.reduce((sum, value) => sum + (absoluteValues ? Math.abs(value) : value), 0) / values.length
  }

  function axleAverage(quad, left, right) {
    const first = finite(quad?.[left])
    const second = finite(quad?.[right])
    return first === null || second === null ? null : (Math.abs(first) + Math.abs(second)) / 2
  }

  function maxQuad(quad) {
    const values = ['fl', 'fr', 'rl', 'rr'].map(key => finite(quad?.[key])).filter(value => value !== null)
    return values.length ? Math.max(...values.map(Math.abs)) : null
  }

  function vehicleIdentity(frame) {
    const car = frame?.car || {}
    const ordinal = finite(car.ordinal ?? frame?.carOrdinal)
    const pi = finite(car.pi ?? frame?.pi)
    const drivetrain = finite(car.drivetrain ?? frame?.drivetrain)
    const rpmMax = finite(frame?.rpmMax ?? car.rpmMax)
    if (ordinal === null || pi === null || drivetrain === null || rpmMax === null) return null
    return [Math.trunc(ordinal), Math.trunc(pi), Math.round(rpmMax), Math.trunc(drivetrain)].join(':')
  }

  function drivenSlip(frame) {
    const drivetrain = finite(frame?.car?.drivetrain ?? frame?.drivetrain)
    if (drivetrain === 0) return axleAverage(frame?.slipRatio, 'fl', 'fr')
    if (drivetrain === 1) return axleAverage(frame?.slipRatio, 'rl', 'rr')
    if (drivetrain === 2) return averageQuad(frame?.slipRatio)
    return finite(frame?.drivenSlip)
  }

  function normalizeSample(frame, previous = null) {
    const timestampMs = finite(frame?.timestampMs)
    const speedKmh = finite(frame?.speedKmh ?? frame?.speed)
    if (timestampMs === null || speedKmh === null) return null
    const acceleration = frame?.acceleration || {}
    const angularVelocity = frame?.angularVelocity || {}
    const sample = {
      timestampMs,
      isRaceOn: frame?.isRaceOn !== false,
      speedKmh: Math.max(0, speedKmh),
      throttle: clamp01(frame?.throttle),
      brake: clamp01(frame?.brake),
      steer: Math.max(-1, Math.min(1, finite(frame?.steer) ?? 0)),
      frontSlip: finite(frame?.frontSlip) ?? axleAverage(frame?.slipAngle, 'fl', 'fr'),
      rearSlip: finite(frame?.rearSlip) ?? axleAverage(frame?.slipAngle, 'rl', 'rr'),
      frontCombinedSlip: finite(frame?.frontCombinedSlip) ?? axleAverage(frame?.combinedSlip, 'fl', 'fr'),
      rearCombinedSlip: finite(frame?.rearCombinedSlip) ?? axleAverage(frame?.combinedSlip, 'rl', 'rr'),
      drivenSlip: drivenSlip(frame),
      lateralResponse: finite(frame?.lateralResponse ?? acceleration.x),
      verticalResponse: finite(frame?.verticalResponse ?? acceleration.y),
      longitudinalResponse: finite(frame?.longitudinalResponse ?? acceleration.z),
      yawRate: finite(frame?.yawRate ?? angularVelocity.y),
      rumbleContact: frame?.rumbleContact === true || ['fl', 'fr', 'rl', 'rr'].some(key => frame?.rumble?.[key] === true),
      puddleDepth: finite(frame?.puddleDepth) ?? maxQuad(frame?.puddle),
      suspensionFullyExtended: frame?.suspensionFullyExtended === true || (
        frame?.suspension && ['fl', 'fr', 'rl', 'rr'].every(key => finite(frame.suspension[key]) !== null && frame.suspension[key] <= 0)
      ),
      carIdentity: vehicleIdentity(frame),
      gear: finite(frame?.gear),
      rpm: finite(frame?.rpm),
      rpmMax: finite(frame?.rpmMax ?? frame?.car?.rpmMax),
      drivetrain: finite(frame?.car?.drivetrain ?? frame?.drivetrain),
      lapRaceTimeS: finite(frame?.lap?.raceTime ?? frame?.lapRaceTimeS),
      lapNumber: finite(frame?.lap?.number ?? frame?.lapNumber),
      lapDistanceM: finite(frame?.lap?.distance ?? frame?.lapDistanceM),
      surfaceDisturbed: frame?.surfaceDisturbed === true
    }
    const deltaMs = previous ? timestampMs - previous.timestampMs : null
    const dt = deltaMs !== null && deltaMs > 0 ? deltaMs / 1000 : null
    sample.steerMagnitude = Math.abs(sample.steer)
    sample.effectiveAcceleration = finite(frame?.effectiveAcceleration) ?? (
      dt ? (sample.speedKmh - previous.speedKmh) / 3.6 / dt : null
    )
    sample.steerRate = finite(frame?.steerRate) ?? (dt ? (sample.steerMagnitude - previous.steerMagnitude) / dt : null)
    sample.throttleRate = finite(frame?.throttleRate) ?? (dt ? (sample.throttle - previous.throttle) / dt : null)
    sample.brakeRate = finite(frame?.brakeRate) ?? (dt ? (sample.brake - previous.brake) / dt : null)
    sample.frontSlipGrowthRate = finite(frame?.frontSlipGrowthRate) ?? (dt && sample.frontSlip !== null && previous.frontSlip !== null ? (sample.frontSlip - previous.frontSlip) / dt : null)
    sample.drivenSlipGrowthRate = finite(frame?.drivenSlipGrowthRate) ?? (dt && sample.drivenSlip !== null && previous.drivenSlip !== null ? (sample.drivenSlip - previous.drivenSlip) / dt : null)
    return sample
  }

  function isTurning(sample, thresholds) {
    return sample.speedKmh >= thresholds.minSpeedKmh && sample.steerMagnitude >= thresholds.steerOn
  }

  function classifyPhase(sample, previous, phase, thresholds) {
    const turning = isTurning(sample, thresholds)
    const steerRate = sample.steerRate ?? 0
    if (!turning && sample.brake < thresholds.brakeOn && sample.steerMagnitude <= thresholds.steerRelease) return PHASES.STRAIGHT
    if (sample.brake >= thresholds.brakeOn && !turning) return PHASES.BRAKING
    if (turning && (phase === PHASES.STRAIGHT || phase === PHASES.BRAKING)) {
      if (sample.brake >= thresholds.brakeOn || steerRate >= 0.15) return PHASES.TURN_IN
    }
    if (turning && phase === PHASES.TURN_IN && sample.brake < thresholds.brakeOn) return PHASES.ROTATION
    if (turning && (phase === PHASES.TURN_IN || phase === PHASES.ROTATION) && (
      sample.throttle >= thresholds.throttleOn || (sample.steerRate !== null && sample.steerRate < -0.15 && (sample.effectiveAcceleration ?? -Infinity) > -3)
    )) return PHASES.EXIT
    if (phase === PHASES.EXIT && turning) return PHASES.EXIT
    if (phase === PHASES.ROTATION && turning) return PHASES.ROTATION
    if (phase === PHASES.TURN_IN && turning) return PHASES.TURN_IN
    if (phase === PHASES.BRAKING && sample.brake >= thresholds.brakeOff) return PHASES.BRAKING
    if (previous === null && sample.brake >= thresholds.brakeOn) return PHASES.BRAKING
    return phase
  }

  class DriverAnalysisState {
    constructor(options = {}) {
      this.thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) }
      this.reset()
    }

    reset(reason = null) {
      this.previousSample = null
      this.previousPhase = PHASES.STRAIGHT
      this.phase = PHASES.STRAIGHT
      this.phaseSinceMs = null
      this.identity = null
      this.maneuverId = 0
      this.maneuverStartedAtMs = null
      this.lastTimestampMs = null
      this.lastResetReason = reason
      this.maneuverSteerSign = null
      this.bridgeStartMs = null
      this.bridgeSteerSign = null
      this.gapSampleLateralMin = null
      return this.snapshot(null, reason)
    }

    resetTransient(reason = 'telemetry_gap') {
      this.previousSample = null
      this.previousPhase = PHASES.STRAIGHT
      this.phase = PHASES.STRAIGHT
      this.phaseSinceMs = null
      this.maneuverStartedAtMs = null
      this.lastTimestampMs = null
      this.lastResetReason = reason
      this.maneuverSteerSign = null
      this.bridgeStartMs = null
      this.bridgeSteerSign = null
      this.gapSampleLateralMin = null
      return this.snapshot(null, reason)
    }

    update(frame = {}) {
      const sample = normalizeSample(frame, this.previousSample)
      if (!sample) return this.resetTransient('invalid_frame')
      if (!sample.isRaceOn) return this.resetTransient('inactive')
      if (this.identity !== null && sample.carIdentity !== null && sample.carIdentity !== this.identity) {
        this.reset('car_identity_change')
        return this.snapshot(null, 'car_identity_change')
      }
      if (this.identity === null && sample.carIdentity !== null) this.identity = sample.carIdentity
      if (this.lastTimestampMs !== null) {
        const gap = sample.timestampMs - this.lastTimestampMs
        if (gap === 0) return this.snapshot(null)
        if (gap < 0) return this.resetTransient('timestamp_rewind')
        if (gap > this.thresholds.maxFrameGapMs) return this.resetTransient('telemetry_gap')
      }
      const previous = this.previousSample
      const nextPhase = classifyPhase(sample, previous, this.phase, this.thresholds)
      const previousPhase = this.phase
      const phaseChanged = nextPhase !== previousPhase
      const isTurningNow = isTurning(sample, this.thresholds)
      const isBraking = sample.brake >= this.thresholds.brakeOn
      const currentSteerSign = isTurningNow ? Math.sign(sample.steer) : null

      let endsManeuver = false
      let beginsManeuver = false
      let inBridge = this.bridgeStartMs !== null
      let inManeuver = false

      if (phaseChanged) {
        this.phase = nextPhase
        this.phaseSinceMs = sample.timestampMs
      } else if (this.phaseSinceMs === null) {
        this.phaseSinceMs = sample.timestampMs
      }

      const wasTurning = previousPhase === PHASES.EXIT || previousPhase === PHASES.ROTATION || previousPhase === PHASES.TURN_IN
      const isTurningPhaseNow = nextPhase === PHASES.EXIT || nextPhase === PHASES.ROTATION || nextPhase === PHASES.TURN_IN

      // State machine for gap bridging
      if (inBridge) {
        // We are in a gap - check if bridge should end or continue
        if (isBraking) {
          // Brake during gap ends the maneuver
          endsManeuver = true
          this.maneuverSteerSign = null
          this.bridgeStartMs = null
          this.bridgeSteerSign = null
          this.gapSampleLateralMin = null
        } else if (isTurningPhaseNow) {
          // Steering resumed - check if bridge succeeds
          const lateralOk = this.gapSampleLateralMin !== null && this.gapSampleLateralMin >= this.thresholds.bridgeLateralMin
          const sameSign = currentSteerSign === this.bridgeSteerSign

          if (sameSign && lateralOk) {
            // Bridge succeeds - continue same maneuver
            this.bridgeStartMs = null
            this.bridgeSteerSign = null
            this.gapSampleLateralMin = null
            this.maneuverSteerSign = currentSteerSign
          } else {
            // Bridge fails - end maneuver and start new one
            endsManeuver = true
            beginsManeuver = true
            this.maneuverSteerSign = currentSteerSign
            this.bridgeStartMs = null
            this.bridgeSteerSign = null
            this.gapSampleLateralMin = null
          }
        } else {
          // Still in gap (STRAIGHT phase) - track lateral response
          const lateralMag = sample.lateralResponse !== null ? Math.abs(sample.lateralResponse) : null

          if (lateralMag === null || lateralMag < this.thresholds.bridgeLateralMin) {
            // Lateral is too low - end bridge
            endsManeuver = true
            this.maneuverSteerSign = null
            this.bridgeStartMs = null
            this.bridgeSteerSign = null
            this.gapSampleLateralMin = null
          } else if (sample.timestampMs - this.bridgeStartMs > this.thresholds.bridgeMaxMs) {
            // Gap exceeded timeout - end bridge
            endsManeuver = true
            this.maneuverSteerSign = null
            this.bridgeStartMs = null
            this.bridgeSteerSign = null
            this.gapSampleLateralMin = null
          } else {
            // Gap continues, track minimum lateral
            if (this.gapSampleLateralMin === null) {
              this.gapSampleLateralMin = lateralMag
            } else {
              this.gapSampleLateralMin = Math.min(this.gapSampleLateralMin, lateralMag)
            }
          }
        }
      } else if (wasTurning && !isTurningPhaseNow && !isBraking) {
        // Transition from turning to straight - enter bridge unless the car already stopped cornering
        const lateralMag = sample.lateralResponse !== null ? Math.abs(sample.lateralResponse) : null
        if (lateralMag === null || lateralMag < this.thresholds.bridgeLateralMin) {
          endsManeuver = true
          this.maneuverSteerSign = null
        } else {
          this.bridgeStartMs = sample.timestampMs
          this.bridgeSteerSign = this.maneuverSteerSign
          this.gapSampleLateralMin = lateralMag
        }
      } else if (!wasTurning && isTurningPhaseNow) {
        // Start a new maneuver (not bridging)
        beginsManeuver = true
        this.maneuverSteerSign = currentSteerSign
      } else if (wasTurning && isTurningPhaseNow && currentSteerSign !== null) {
        // Update steering sign while continuing to turn
        this.maneuverSteerSign = currentSteerSign
      }

      // Apply maneuver ID changes
      if (beginsManeuver) {
        this.maneuverId += 1
        this.maneuverStartedAtMs = sample.timestampMs
      }

      // Set inManeuver flag: true while turning or bridging
      inManeuver = isTurningPhaseNow || this.bridgeStartMs !== null

      // A new maneuver already closes the previous one through the id change.
      const snapshot = this.snapshot(sample, null, { previous, previousPhase, phaseChanged, endsManeuver: endsManeuver && !beginsManeuver, inManeuver })
      this.previousSample = sample
      this.previousPhase = previousPhase
      this.lastTimestampMs = sample.timestampMs
      this.lastResetReason = null
      return snapshot
    }

    snapshot(sample, resetReason = null, overrides = {}) {
      return {
        valid: sample !== null,
        resetReason,
        timestampMs: sample?.timestampMs ?? null,
        phase: this.phase,
        previousPhase: overrides.previousPhase ?? this.previousPhase,
        phaseChanged: overrides.phaseChanged === true,
        phaseDurationMs: sample && this.phaseSinceMs !== null ? Math.max(0, sample.timestampMs - this.phaseSinceMs) : 0,
        maneuverId: this.maneuverId,
        maneuverStartedAtMs: this.maneuverStartedAtMs,
        maneuverEnded: overrides.endsManeuver === true,
        inManeuver: overrides.inManeuver ?? false,
        sample,
        previousSample: overrides.previous ?? null,
        vehicleIdentity: this.identity
      }
    }
  }

  return { DEFAULT_THRESHOLDS, PHASES, DriverAnalysisState, classifyPhase, finite, normalizeSample, vehicleIdentity }
}))

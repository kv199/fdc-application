(function (globalScope, factory) {
  const stateApi = typeof module !== 'undefined' && module.exports && typeof document === 'undefined'
    ? require('./driver-analysis-state.js')
    : globalScope.DriverAnalysisState
  const api = factory(stateApi || {})
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysisOpportunities = api
}(typeof globalThis !== 'undefined' ? globalThis : this, stateApi => {
  'use strict'

  const PHASES = stateApi.PHASES || { TURN_IN: 'turn-in', ROTATION: 'rotation', EXIT: 'exit' }
  const PROBLEM_TYPES = Object.freeze({
    FRONT_SCRUB: 'front_scrub',
    EXIT_WHEELSPIN: 'exit_wheelspin',
    BRAKE_STEERING_OVERLOAD: 'brake_steering_overload',
    ABRUPT_BRAKE_RELEASE: 'abrupt_brake_release'
  })
  const TYPE_ORDER = Object.freeze(Object.values(PROBLEM_TYPES))
  const DEFAULT_THRESHOLDS = Object.freeze({
    minSpeedKmh: 25,
    frontSteerMin: 0.18,
    frontSteerGrowthMin: 0.03,
    frontSustainMs: 200,
    exitThrottleMin: 0.35,
    exitThrottleRateMin: 0.15,
    wheelspinSlipMin: 0.1,
    overloadBrakeMin: 0.2,
    overloadSteerMin: 0.18,
    overloadCombinedMin: 0.5,
    releaseBrakeMin: 0.35,
    releaseRateMin: 1.5,
    minSamples: 2,
    maxOpportunityMs: 2500
  })

  function number(value, fallback = null) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  function speedBin(speed, thresholds) {
    return speed === null ? null : Math.max(0, Math.floor(speed / (thresholds.speedBinKmh || 25)))
  }

  function stableContext(sample, thresholds) {
    return {
      carIdentity: sample?.carIdentity || null,
      speedBin: speedBin(number(sample?.speedKmh), thresholds),
      gear: number(sample?.gear),
      drivetrain: number(sample?.drivetrain)
    }
  }

  function isTurning(snapshot, thresholds) {
    const sample = snapshot?.sample
    return (snapshot?.phase === PHASES.TURN_IN || snapshot?.phase === PHASES.ROTATION)
      && number(sample?.speedKmh, 0) >= thresholds.minSpeedKmh
      && number(sample?.steerMagnitude, Math.abs(number(sample?.steer, 0))) >= thresholds.frontSteerMin
  }

  function isTurningForFrontScrub(snapshot, thresholds) {
    const sample = snapshot?.sample
    return (snapshot?.phase === PHASES.TURN_IN || snapshot?.phase === PHASES.ROTATION || snapshot?.phase === PHASES.EXIT)
      && number(sample?.speedKmh, 0) >= thresholds.minSpeedKmh
      && number(sample?.steerMagnitude, Math.abs(number(sample?.steer, 0))) >= thresholds.frontSteerMin
  }

  function eligible(type, snapshot, thresholds) {
    const sample = snapshot?.sample
    const previous = snapshot?.previousSample
    if (!sample || sample.surfaceDisturbed === true || sample.rumbleContact === true || number(sample.puddleDepth, 0) > 0 || sample.suspensionFullyExtended === true) return false
    const steer = number(sample.steerMagnitude, Math.abs(number(sample.steer, 0)))
    if (type === PROBLEM_TYPES.FRONT_SCRUB) {
      return isTurningForFrontScrub(snapshot, thresholds) && (
        steer >= thresholds.frontSteerMin
        && ((number(sample.steerRate, 0) >= thresholds.frontSteerGrowthMin) || number(sample.frontSlip, 0) >= 0.12)
      )
    }
    if (type === PROBLEM_TYPES.EXIT_WHEELSPIN) {
      return snapshot.phase === PHASES.EXIT
        && number(sample.speedKmh, 0) >= thresholds.minSpeedKmh
        && number(sample.throttle, 0) >= thresholds.exitThrottleMin
        && (number(sample.throttleRate, 0) >= thresholds.exitThrottleRateMin || number(sample.drivenSlip, 0) >= thresholds.wheelspinSlipMin)
    }
    if (type === PROBLEM_TYPES.BRAKE_STEERING_OVERLOAD) {
      return isTurning(snapshot, thresholds)
        && number(sample.brake, 0) >= thresholds.overloadBrakeMin
        && steer >= thresholds.overloadSteerMin
        && (number(sample.frontCombinedSlip, 0) >= thresholds.overloadCombinedMin || (number(sample.frontSlip, 0) >= 0.16 && number(sample.brake, 0) >= 0.3))
    }
    if (type === PROBLEM_TYPES.ABRUPT_BRAKE_RELEASE) {
      return isTurning(snapshot, thresholds)
        && number(previous?.brake, number(sample.brake, 0)) >= thresholds.releaseBrakeMin
        && number(sample.brakeRate, 0) <= -thresholds.releaseRate
    }
    return false
  }

  function compactSample(sample) {
    if (!sample) return null
    const keys = [
      'timestampMs', 'speedKmh', 'throttle', 'brake', 'steer', 'steerMagnitude', 'steerRate', 'throttleRate', 'brakeRate',
      'effectiveAcceleration', 'lateralResponse', 'longitudinalResponse', 'yawRate', 'frontSlip', 'rearSlip',
      'frontCombinedSlip', 'drivenSlip', 'frontSlipGrowthRate', 'drivenSlipGrowthRate', 'gear', 'rpm', 'rpmMax',
      'drivetrain', 'carIdentity', 'surfaceDisturbed', 'rumbleContact', 'puddleDepth', 'suspensionFullyExtended'
    ]
    const result = {}
    for (const key of keys) if (sample[key] !== undefined) result[key] = sample[key]
    return result
  }

  class DriverAnalysisOpportunities {
    constructor(options = {}) {
      this.thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) }
      this.reset()
    }

    reset() {
      this.opportunities = []
      this.active = new Map()
      this.nextId = 1
      this.lastManeuverId = null
      return this.opportunities
    }

    resetTransient(reason = 'telemetry_gap') {
      for (const active of this.active.values()) this.finish(active, 'incomplete', false, reason)
      this.active.clear()
      this.lastManeuverId = null
      return this.opportunities
    }

    update(snapshot) {
      if (!snapshot?.valid || !snapshot.sample) {
        if (snapshot?.resetReason) this.resetTransient(snapshot.resetReason)
        return []
      }
      const sample = snapshot.sample
      const emitted = []
      const maneuverId = number(snapshot.maneuverId, 0)
      if (this.lastManeuverId !== null && maneuverId !== this.lastManeuverId) {
        for (const active of this.active.values()) emitted.push(this.finish(active, 'clean', true))
        this.active.clear()
      }
      this.lastManeuverId = maneuverId
      for (const type of TYPE_ORDER) {
        const candidate = this.active.get(type)
        const qualifies = eligible(type, snapshot, this.thresholds)
        const isBridgedGap = snapshot.phase === PHASES.STRAIGHT && snapshot.inManeuver === true
        const phaseRelevant = (type === PROBLEM_TYPES.EXIT_WHEELSPIN && snapshot.phase === PHASES.EXIT)
          || (type === PROBLEM_TYPES.FRONT_SCRUB && (snapshot.phase === PHASES.TURN_IN || snapshot.phase === PHASES.ROTATION || snapshot.phase === PHASES.EXIT || isBridgedGap))
          || (type !== PROBLEM_TYPES.EXIT_WHEELSPIN && type !== PROBLEM_TYPES.FRONT_SCRUB && (snapshot.phase === PHASES.TURN_IN || snapshot.phase === PHASES.ROTATION || isBridgedGap))
        const disturbed = sample.surfaceDisturbed === true || sample.rumbleContact === true || number(sample.puddleDepth, 0) > 0 || sample.suspensionFullyExtended === true
        if (disturbed && candidate !== undefined) {
          emitted.push(this.finish(candidate, 'incomplete', false, 'surface_disturbance'))
          this.active.delete(type)
          continue
        }
        if (qualifies || (candidate !== undefined && phaseRelevant)) {
          if (candidate === undefined) {
            this.active.set(type, {
              id: `opportunity-${this.nextId++}`,
              type,
              maneuverId,
              startedAtMs: sample.timestampMs,
              endedAtMs: sample.timestampMs,
              samples: [],
              preTriggerSample: compactSample(snapshot.previousSample),
              valid: true,
              invalidReason: null,
              context: stableContext(sample, this.thresholds)
            })
          }
          const current = this.active.get(type)
          if (sample.timestampMs - current.startedAtMs > this.thresholds.maxOpportunityMs) {
            emitted.push(this.finish(current, 'incomplete', false, 'opportunity_timeout'))
            this.active.delete(type)
            continue
          }
          current.samples.push(compactSample(sample))
          current.endedAtMs = sample.timestampMs
        } else if (candidate !== undefined) {
          emitted.push(this.finish(candidate, candidate.samples.length >= this.thresholds.minSamples ? 'clean' : 'incomplete', candidate.samples.length >= this.thresholds.minSamples))
          this.active.delete(type)
        }
      }
      if (snapshot.maneuverEnded === true) {
        for (const active of this.active.values()) emitted.push(this.finish(active, active.samples.length >= this.thresholds.minSamples ? 'clean' : 'incomplete', active.samples.length >= this.thresholds.minSamples))
        this.active.clear()
      }
      return emitted.filter(Boolean)
    }

    finish(active, outcome = 'clean', valid = true, invalidReason = null) {
      if (!active) return null
      const context = { ...active.context }
      let finalValid = valid === true
      let finalInvalidReason = invalidReason || null
      if (active.type === PROBLEM_TYPES.FRONT_SCRUB && finalValid && outcome === 'clean') {
        let sustainedSteerMs = 0
        let hasThrottleRise = false
        for (let i = 1; i < active.samples.length; i += 1) {
          const prevSample = active.samples[i - 1]
          const currSample = active.samples[i]
          const prevSteer = number(prevSample.steerMagnitude, 0)
          const currSteer = number(currSample.steerMagnitude, 0)
          if (prevSteer >= this.thresholds.frontSteerMin && currSteer >= this.thresholds.frontSteerMin) {
            const deltaMs = number(currSample.timestampMs, 0) - number(prevSample.timestampMs, 0)
            if (deltaMs > 0) sustainedSteerMs += deltaMs
          }
          if (number(currSample.throttle, 0) >= 0.2) hasThrottleRise = true
        }
        context.sustainedSteerMs = sustainedSteerMs
        if (hasThrottleRise) context.onThrottle = true
        if (sustainedSteerMs < this.thresholds.frontSustainMs) {
          finalValid = false
          finalInvalidReason = 'steering_pulse'
        }
      }
      const opportunity = {
        id: active.id,
        type: active.type,
        maneuverId: active.maneuverId,
        startedAtMs: number(active.startedAtMs, 0),
        endedAtMs: number(active.endedAtMs, active.startedAtMs),
        durationMs: Math.max(0, number(active.endedAtMs, active.startedAtMs) - number(active.startedAtMs, 0)),
        speedBin: active.context.speedBin,
        context,
        samples: active.samples.slice(),
        preTriggerSample: active.preTriggerSample,
        valid: finalValid,
        invalidReason: finalInvalidReason,
        outcome: finalInvalidReason === 'steering_pulse' ? 'incomplete' : outcome
      }
      this.opportunities.push(opportunity)
      return opportunity
    }

    finalize() {
      for (const active of this.active.values()) {
        const valid = active.samples.length >= this.thresholds.minSamples
        this.finish(active, valid ? 'clean' : 'incomplete', valid, valid ? null : 'recording_stopped_before_opportunity_completed')
      }
      this.active.clear()
      return this.opportunities.slice()
    }

    getOpportunities() {
      return this.opportunities.slice()
    }
  }

  return { DEFAULT_THRESHOLDS, DriverAnalysisOpportunities, PROBLEM_TYPES, TYPE_ORDER, eligible }
}))

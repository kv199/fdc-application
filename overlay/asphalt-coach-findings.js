(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.AsphaltCoachFindings = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const FINDINGS = Object.freeze({
    FRONT_SCRUB: 'front_scrub',
    EXIT_WHEELSPIN: 'exit_wheelspin',
    BRAKE_STEERING_OVERLOAD: 'brake_steering_overload',
    ABRUPT_BRAKE_RELEASE: 'abrupt_brake_release',
    CLEAN_EXIT: 'clean_exit',
    CONTROLLED_RELEASE: 'controlled_release'
  })

  const DEFAULT_THRESHOLDS = Object.freeze({
    minEvidenceMs: 140,
    positiveEvidenceMs: 180,
    frontSlipMin: 0.16,
    frontSlipGrowthPerSecond: 0.1,
    steeringGrowthPerSecond: 0.1,
    steeringMin: 0.28,
    responseFlatDelta: 0.03,
    yawFlatDelta: 0.04,
    drivenSlipMin: 0.12,
    drivenSlipCleanMax: 0.08,
    wheelspinAccelerationRatio: 0.65,
    wheelspinMinAcceleration: 0.5,
    throttleOn: 0.65,
    throttleRisePerSecond: 0.1,
    frontCombinedOverload: 0.85,
    overloadBrakeMin: 0.25,
    overloadSteerMin: 0.22,
    brakeReleaseMin: 0.35,
    brakeReleaseDropPerSecond: 1.5,
    brakeReleaseWindowMs: 250,
    brakeReleaseResponseDrop: 0.15,
    brakeReleaseYawDrop: 0.2,
    brakeReleaseRearSlipRise: 0.08,
    controlledBrakeMin: 0.08,
    controlledBrakeMax: 0.35,
    controlledReleaseRateMin: 0.15,
    controlledReleaseRateMax: 1.5,
    cleanExitThrottleMin: 0.45,
    cleanExitAccelerationMin: 0.5,
    cueMinConfidence: 0.84
  })

  const NEGATIVE_FINDINGS = Object.freeze([
    FINDINGS.FRONT_SCRUB,
    FINDINGS.EXIT_WHEELSPIN,
    FINDINGS.BRAKE_STEERING_OVERLOAD,
    FINDINGS.ABRUPT_BRAKE_RELEASE
  ])

  const POSITIVE_FINDINGS = Object.freeze([
    FINDINGS.CLEAN_EXIT,
    FINDINGS.CONTROLLED_RELEASE
  ])

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function phaseIsTurning(phase) {
    return phase === 'turn-in' || phase === 'rotation'
  }

  function phaseIsExit(phase) {
    return phase === 'exit'
  }

  function createCounts() {
    return {
      [FINDINGS.FRONT_SCRUB]: 0,
      [FINDINGS.EXIT_WHEELSPIN]: 0,
      [FINDINGS.BRAKE_STEERING_OVERLOAD]: 0,
      [FINDINGS.ABRUPT_BRAKE_RELEASE]: 0,
      [FINDINGS.CLEAN_EXIT]: 0,
      [FINDINGS.CONTROLLED_RELEASE]: 0
    }
  }

  function copyCounts(counts) {
    return {
      [FINDINGS.FRONT_SCRUB]: counts[FINDINGS.FRONT_SCRUB],
      [FINDINGS.EXIT_WHEELSPIN]: counts[FINDINGS.EXIT_WHEELSPIN],
      [FINDINGS.BRAKE_STEERING_OVERLOAD]: counts[FINDINGS.BRAKE_STEERING_OVERLOAD],
      [FINDINGS.ABRUPT_BRAKE_RELEASE]: counts[FINDINGS.ABRUPT_BRAKE_RELEASE],
      [FINDINGS.CLEAN_EXIT]: counts[FINDINGS.CLEAN_EXIT],
      [FINDINGS.CONTROLLED_RELEASE]: counts[FINDINGS.CONTROLLED_RELEASE]
    }
  }

  function delta(current, previous, field) {
    const currentValue = finite(current?.[field])
    const previousValue = finite(previous?.[field])
    return currentValue === null || previousValue === null ? null : currentValue - previousValue
  }

  class AsphaltCoachFindings {
    constructor(options = {}) {
      this.thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) }
      this.reset()
    }

    reset() {
      this.counts = createCounts()
      this.sequence = 0
      this.attemptId = 0
      this.lastTimestampMs = null
      this.lastCleanExitAcceleration = null
      this.pendingRelease = null
      this.candidates = Object.create(null)
      for (const kind of Object.values(FINDINGS)) this.candidates[kind] = null
      return this.getSummary()
    }

    beginAttempt(attemptId = null) {
      this.attemptId = finite(attemptId) ?? this.attemptId + 1
      this.resetTransient()
      return this.getSummary()
    }

    resetTransient() {
      for (const kind of Object.values(FINDINGS)) this.candidates[kind] = null
      this.lastTimestampMs = null
      this.lastCleanExitAcceleration = null
      this.pendingRelease = null
    }

    update(snapshot) {
      if (!snapshot?.valid || !snapshot.sample) {
        this.resetTransient()
        return {
          events: [],
          counts: copyCounts(this.counts),
          calibration: snapshot?.calibration ?? null,
          phase: 'straight'
        }
      }

      if (snapshot.newAttempt || (this.attemptId !== 0 && snapshot.attemptId !== this.attemptId)) {
        this.beginAttempt(snapshot.attemptId)
      } else if (this.attemptId === 0) {
        this.attemptId = snapshot.attemptId
      }

      const sample = snapshot.sample
      const previous = snapshot.previousSample
      const events = []
      this.updatePendingRelease(snapshot, events)

      const frontScrub = this.isFrontScrub(snapshot)
      const wheelspin = this.isExitWheelspin(snapshot)
      const overload = this.isBrakeSteeringOverload(snapshot)
      const controlledRelease = this.isControlledRelease(snapshot)
      const cleanExit = this.isCleanExit(snapshot)

      const frontEvent = this.updateSustained(FINDINGS.FRONT_SCRUB, frontScrub, snapshot, this.thresholds.minEvidenceMs, 0.87)
      const wheelEvent = this.updateSustained(FINDINGS.EXIT_WHEELSPIN, wheelspin, snapshot, this.thresholds.minEvidenceMs, 0.9)
      const overloadEvent = this.updateSustained(FINDINGS.BRAKE_STEERING_OVERLOAD, overload, snapshot, this.thresholds.minEvidenceMs, 0.88)
      const controlledEvent = this.updateSustained(FINDINGS.CONTROLLED_RELEASE, controlledRelease, snapshot, this.thresholds.positiveEvidenceMs, 0.9)
      const cleanEvent = this.updateSustained(FINDINGS.CLEAN_EXIT, cleanExit, snapshot, this.thresholds.positiveEvidenceMs, 0.92)

      if (frontEvent) events.push(frontEvent)
      if (wheelEvent) events.push(wheelEvent)
      if (overloadEvent) events.push(overloadEvent)
      if (controlledEvent) events.push(controlledEvent)
      if (cleanEvent) events.push(cleanEvent)

      if (cleanExit && sample.effectiveAcceleration !== null) {
        this.lastCleanExitAcceleration = Math.max(
          this.lastCleanExitAcceleration ?? 0,
          sample.effectiveAcceleration
        )
      }
      this.lastTimestampMs = sample.timestampMs

      return {
        events,
        counts: copyCounts(this.counts),
        calibration: snapshot.calibration,
        phase: snapshot.phase
      }
    }

    isFrontScrub(snapshot) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      if (!phaseIsTurning(snapshot.phase) || previous === null) return false
      if (
        sample.steerMagnitude < this.thresholds.steeringMin
        || sample.frontSlip === null
        || sample.lateralResponse === null
        || sample.yawRate === null
        || previous.frontSlip === null
        || previous.lateralResponse === null
        || previous.yawRate === null
        || sample.steerRate === null
      ) return false
      const slipRate = (sample.frontSlip - previous.frontSlip) / ((sample.timestampMs - previous.timestampMs) / 1000)
      const responseDelta = sample.lateralResponse - previous.lateralResponse
      const yawDelta = sample.yawRate - previous.yawRate
      return sample.steerRate >= this.thresholds.steeringGrowthPerSecond
        && slipRate >= this.thresholds.frontSlipGrowthPerSecond
        && sample.frontSlip >= this.thresholds.frontSlipMin
        && responseDelta <= this.thresholds.responseFlatDelta
        && yawDelta <= this.thresholds.yawFlatDelta
    }

    isExitWheelspin(snapshot) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      if (!phaseIsExit(snapshot.phase) || previous === null) return false
      if (
        sample.drivenSlip === null
        || sample.effectiveAcceleration === null
        || sample.throttleRate === null
        || this.lastCleanExitAcceleration === null
      ) return false
      const accelerationLimit = Math.max(
        this.thresholds.wheelspinMinAcceleration,
        this.lastCleanExitAcceleration * this.thresholds.wheelspinAccelerationRatio
      )
      return sample.throttle >= this.thresholds.throttleOn
        && sample.throttleRate >= this.thresholds.throttleRisePerSecond
        && sample.drivenSlip >= this.thresholds.drivenSlipMin
        && sample.effectiveAcceleration <= accelerationLimit
    }

    isBrakeSteeringOverload(snapshot) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      if (!phaseIsTurning(snapshot.phase) || previous === null) return false
      if (
        sample.frontCombinedSlip === null
        || sample.lateralResponse === null
        || sample.yawRate === null
        || previous.lateralResponse === null
        || previous.yawRate === null
      ) return false
      const responseDelta = sample.lateralResponse - previous.lateralResponse
      const yawDelta = sample.yawRate - previous.yawRate
      return sample.brake >= this.thresholds.overloadBrakeMin
        && sample.steerMagnitude >= this.thresholds.overloadSteerMin
        && sample.frontCombinedSlip >= this.thresholds.frontCombinedOverload
        && responseDelta <= this.thresholds.responseFlatDelta
        && yawDelta <= this.thresholds.yawFlatDelta
    }

    isControlledRelease(snapshot) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      if (!phaseIsTurning(snapshot.phase) || previous === null || sample.brakeRate === null) return false
      if (
        sample.frontCombinedSlip === null
        || sample.lateralResponse === null
        || previous.lateralResponse === null
      ) return false
      const responseDelta = sample.lateralResponse - previous.lateralResponse
      return sample.brake >= this.thresholds.controlledBrakeMin
        && sample.brake <= this.thresholds.controlledBrakeMax
        && sample.brakeRate <= -this.thresholds.controlledReleaseRateMin
        && sample.brakeRate >= -this.thresholds.controlledReleaseRateMax
        && sample.steerMagnitude >= 0.15
        && sample.frontCombinedSlip < this.thresholds.frontCombinedOverload
        && responseDelta >= -this.thresholds.responseFlatDelta
    }

    isCleanExit(snapshot) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      if (!phaseIsExit(snapshot.phase) || previous === null) return false
      if (sample.drivenSlip === null || sample.effectiveAcceleration === null || sample.throttleRate === null) return false
      return sample.throttle >= this.thresholds.cleanExitThrottleMin
        && sample.throttleRate >= this.thresholds.throttleRisePerSecond
        && sample.drivenSlip <= this.thresholds.drivenSlipCleanMax
        && sample.effectiveAcceleration >= this.thresholds.cleanExitAccelerationMin
        && sample.steerRate !== null
        && sample.steerRate <= 0.2
    }

    updatePendingRelease(snapshot, events) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      if (this.pendingRelease !== null) {
        const elapsedMs = sample.timestampMs - this.pendingRelease.timestampMs
        if (elapsedMs < 0 || elapsedMs > this.thresholds.brakeReleaseWindowMs) {
          this.pendingRelease = null
        } else if (!this.pendingRelease.issued) {
          const responseDrop = this.pendingRelease.lateralResponse - (sample.lateralResponse ?? this.pendingRelease.lateralResponse) >= this.thresholds.brakeReleaseResponseDrop
          const yawDrop = this.pendingRelease.yawRate - (sample.yawRate ?? this.pendingRelease.yawRate) >= this.thresholds.brakeReleaseYawDrop
          const rearSlipRise = sample.rearSlip !== null
            && this.pendingRelease.rearSlip !== null
            && sample.rearSlip - this.pendingRelease.rearSlip >= this.thresholds.brakeReleaseRearSlipRise
          if (responseDrop && (yawDrop || rearSlipRise)) {
            this.pendingRelease.issued = true
            const finding = this.createFinding(FINDINGS.ABRUPT_BRAKE_RELEASE, snapshot, 0.92, elapsedMs)
            if (finding) events.push(finding)
          }
        }
      }

      if (
        previous !== null
        && phaseIsTurning(snapshot.phase)
        && previous.brake >= this.thresholds.brakeReleaseMin
        && sample.brakeRate !== null
        && sample.brakeRate <= -this.thresholds.brakeReleaseDropPerSecond
      ) {
        this.pendingRelease = {
          timestampMs: sample.timestampMs,
          lateralResponse: previous.lateralResponse,
          yawRate: previous.yawRate,
          rearSlip: previous.rearSlip,
          issued: false
        }
      }
    }

    updateSustained(kind, condition, snapshot, minimumMs, confidence) {
      const candidate = this.candidates[kind]
      if (!condition) {
        this.candidates[kind] = null
        return null
      }

      if (candidate === null) {
        this.candidates[kind] = {
          sinceMs: snapshot.timestampMs,
          issued: false
        }
        return null
      }

      const evidenceMs = snapshot.timestampMs - candidate.sinceMs
      if (candidate.issued || evidenceMs < minimumMs) return null
      candidate.issued = true
      return this.createFinding(kind, snapshot, confidence, evidenceMs)
    }

    createFinding(kind, snapshot, confidence, evidenceMs) {
      if (!Object.values(FINDINGS).includes(kind)) return null
      this.counts[kind] += 1
      this.sequence += 1
      return {
        kind,
        confidence,
        evidenceMs,
        attemptId: snapshot.attemptId,
        eventToken: `${snapshot.attemptId}:${kind}:${this.sequence}`,
        evidenceCount: this.counts[kind],
        positive: POSITIVE_FINDINGS.includes(kind)
      }
    }

    getSummary() {
      return {
        counts: copyCounts(this.counts),
        negativeEvidence: NEGATIVE_FINDINGS.reduce((sum, kind) => sum + this.counts[kind], 0),
        positiveEvidence: POSITIVE_FINDINGS.reduce((sum, kind) => sum + this.counts[kind], 0)
      }
    }
  }

  return {
    DEFAULT_THRESHOLDS,
    FINDINGS,
    NEGATIVE_FINDINGS,
    POSITIVE_FINDINGS,
    AsphaltCoachFindings
  }
}))

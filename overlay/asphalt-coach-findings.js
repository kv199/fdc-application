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
    responseFlatRatio: 0.04,
    yawFlatRatio: 0.04,
    frontSlipEnvelopeRatio: 0.9,
    drivenSlipEnvelopeRatio: 1.25,
    cleanSlipEnvelopeRatio: 1.1,
    combinedSlipEnvelopeRatio: 1.15,
    brakeReleaseResponseRatio: 0.18,
    brakeReleaseYawRatio: 0.25,
    cleanExitAccelerationRatio: 0.45,
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

  function clamp01(value) {
    const number = finite(value)
    return number === null ? 0 : Math.max(0, Math.min(1, number))
  }

  function percentileRank(value, bin, medianField, p90Field) {
    const current = finite(value)
    const median = finite(bin?.[medianField])
    const p90 = finite(bin?.[p90Field])
    if (current === null || median === null || p90 === null) return 0
    if (p90 <= median) return current > p90 ? 1 : 0
    return clamp01((current - median) / (p90 - median))
  }

  function marginAbove(value, threshold, scale = threshold) {
    const current = finite(value)
    const minimum = finite(threshold)
    const span = Math.max(Math.abs(finite(scale) ?? 0), 0.01)
    if (current === null || minimum === null || current < minimum) return 0
    return clamp01((current - minimum) / span)
  }

  function marginBelow(value, threshold, scale = threshold) {
    const current = finite(value)
    const maximum = finite(threshold)
    const span = Math.max(Math.abs(finite(scale) ?? 0), 0.01)
    if (current === null || maximum === null || current > maximum) return 0
    return clamp01((maximum - current) / span)
  }

  function stalledResponseConfidence(responseDelta, flatDelta, current, expected) {
    const deltaValue = finite(responseDelta)
    const flat = Math.max(Math.abs(finite(flatDelta) ?? 0), 0.01)
    const currentValue = finite(current)
    const expectedValue = finite(expected)
    if (deltaValue === null) return 0
    const stalled = clamp01((flat - deltaValue) / flat)
    const belowExpected = expectedValue === null || expectedValue <= 0 || currentValue === null
      ? 0
      : clamp01((expectedValue - currentValue) / expectedValue)
    return Math.max(stalled, belowExpected)
  }

  function minimumComponentConfidence(components) {
    const values = Object.values(components || {}).map(value => finite(value))
    if (values.length === 0 || values.some(value => value === null)) return 0
    return Math.min(...values)
  }

  function mergeEvidence(previous, current) {
    const components = {}
    for (const key of new Set([
      ...Object.keys(previous?.components || {}),
      ...Object.keys(current?.components || {})
    ])) {
      components[key] = Math.max(
        finite(previous?.components?.[key]) ?? 0,
        finite(current?.components?.[key]) ?? 0
      )
    }
    return {
      ...previous,
      ...current,
      components
    }
  }

  function learnedThresholds(thresholds, snapshot) {
    const bin = snapshot?.calibration?.bin
    const scale = (field, fallback) => Math.max(fallback, finite(bin?.[field]) ?? 0)
    const responseScale = finite(bin?.lateralResponseP90)
    const yawScale = finite(bin?.yawRateP90)
    const accelerationScale = finite(bin?.effectiveAccelerationP90)
    return {
      responseFlatDelta: Math.max(
        thresholds.responseFlatDelta,
        (responseScale ?? 0) * thresholds.responseFlatRatio
      ),
      yawFlatDelta: Math.max(
        thresholds.yawFlatDelta,
        (yawScale ?? 0) * thresholds.yawFlatRatio
      ),
      frontSlipMin: Math.max(
        thresholds.frontSlipMin,
        (finite(bin?.frontSlipP90) ?? 0) * thresholds.frontSlipEnvelopeRatio
      ),
      drivenSlipMin: Math.max(
        thresholds.drivenSlipMin,
        (finite(bin?.drivenSlipP90) ?? 0) * thresholds.drivenSlipEnvelopeRatio
      ),
      drivenSlipCleanMax: Math.max(
        thresholds.drivenSlipCleanMax,
        (finite(bin?.drivenSlipP90) ?? 0) * thresholds.cleanSlipEnvelopeRatio
      ),
      frontCombinedOverload: Math.max(
        thresholds.frontCombinedOverload,
        (finite(bin?.frontCombinedSlipP90) ?? 0) * thresholds.combinedSlipEnvelopeRatio
      ),
      wheelspinAccelerationLimit: Math.max(
        thresholds.wheelspinMinAcceleration,
        (accelerationScale ?? 0) * thresholds.wheelspinAccelerationRatio
      ),
      brakeReleaseResponseDrop: Math.max(
        thresholds.brakeReleaseResponseDrop,
        (responseScale ?? 0) * thresholds.brakeReleaseResponseRatio
      ),
      brakeReleaseYawDrop: Math.max(
        thresholds.brakeReleaseYawDrop,
        (yawScale ?? 0) * thresholds.brakeReleaseYawRatio
      ),
      cleanExitAccelerationMin: Math.max(
        thresholds.cleanExitAccelerationMin,
        (accelerationScale ?? 0) * thresholds.cleanExitAccelerationRatio
      ),
      learnedAcceleration: scale('effectiveAccelerationP90', 0)
    }
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
      this.counts = createCounts()
      this.sequence = 0
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

      if (snapshot.calibration?.ready !== true || snapshot.sample.surfaceDisturbed === true) {
        this.resetTransient()
        return {
          events: [],
          counts: copyCounts(this.counts),
          calibration: snapshot.calibration,
          phase: snapshot.phase
        }
      }

      if (this.attemptId !== 0 && snapshot.attemptId !== this.attemptId) {
        this.beginAttempt(snapshot.attemptId)
      } else if (this.attemptId === 0) {
        this.attemptId = snapshot.attemptId
      }

      const sample = snapshot.sample
      const previous = snapshot.previousSample
      const events = []
      this.updatePendingRelease(snapshot, events)

      const frontScrub = this.detectFrontScrub(snapshot)
      const wheelspin = this.detectExitWheelspin(snapshot)
      const overload = this.detectBrakeSteeringOverload(snapshot)
      const controlledRelease = this.detectControlledRelease(snapshot)
      const cleanExit = this.detectCleanExit(snapshot)

      const frontEvent = this.updateSustained(FINDINGS.FRONT_SCRUB, frontScrub, snapshot, this.thresholds.minEvidenceMs)
      const wheelEvent = this.updateSustained(FINDINGS.EXIT_WHEELSPIN, wheelspin, snapshot, this.thresholds.minEvidenceMs)
      const overloadEvent = this.updateSustained(FINDINGS.BRAKE_STEERING_OVERLOAD, overload, snapshot, this.thresholds.minEvidenceMs)
      const controlledEvent = this.updateSustained(FINDINGS.CONTROLLED_RELEASE, controlledRelease, snapshot, this.thresholds.positiveEvidenceMs)
      const cleanEvent = this.updateSustained(FINDINGS.CLEAN_EXIT, cleanExit, snapshot, this.thresholds.positiveEvidenceMs)

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

    detectFrontScrub(snapshot) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      if (!phaseIsTurning(snapshot.phase) || previous === null) return null
      if (
        sample.steerMagnitude < this.thresholds.steeringMin
        || sample.frontSlip === null
        || sample.lateralResponse === null
        || sample.yawRate === null
        || previous.frontSlip === null
        || previous.lateralResponse === null
        || previous.yawRate === null
        || sample.steerRate === null
      ) return null
      const learned = learnedThresholds(this.thresholds, snapshot)
      const slipRate = (sample.frontSlip - previous.frontSlip) / ((sample.timestampMs - previous.timestampMs) / 1000)
      const responseDelta = sample.lateralResponse - previous.lateralResponse
      const yawDelta = sample.yawRate - previous.yawRate
      if (
        sample.steerRate < this.thresholds.steeringGrowthPerSecond
        || slipRate < this.thresholds.frontSlipGrowthPerSecond
        || sample.frontSlip < learned.frontSlipMin
        || responseDelta > learned.responseFlatDelta
        || yawDelta > learned.yawFlatDelta
      ) return null

      const bin = snapshot.calibration?.bin
      return {
        kind: FINDINGS.FRONT_SCRUB,
        steeringGrowth: sample.steerRate,
        slipGrowth: slipRate,
        responseLoss: responseDelta,
        yawLoss: yawDelta,
        evidenceMs: 0,
        components: {
          steeringGrowth: Math.min(
            percentileRank(sample.steerRate, bin, 'steerRateP50', 'steerRateP90'),
            marginAbove(sample.steerRate, this.thresholds.steeringGrowthPerSecond, this.thresholds.steeringGrowthPerSecond * 0.5)
          ),
          steeringLoad: percentileRank(sample.steerMagnitude, bin, 'steerMagnitudeP50', 'steerMagnitudeP90'),
          slipGrowth: Math.min(
            percentileRank(slipRate, bin, 'frontSlipGrowthRateP50', 'frontSlipGrowthRateP90'),
            marginAbove(slipRate, this.thresholds.frontSlipGrowthPerSecond, this.thresholds.frontSlipGrowthPerSecond * 0.5)
          ),
          slipLoad: percentileRank(sample.frontSlip, bin, 'frontSlipP50', 'frontSlipP90'),
          responseLoss: stalledResponseConfidence(
            responseDelta,
            learned.responseFlatDelta,
            sample.lateralResponse,
            bin?.lateralResponseP90
          ),
          yawLoss: stalledResponseConfidence(
            yawDelta,
            learned.yawFlatDelta,
            sample.yawRate,
            bin?.yawRateP90
          )
        }
      }
    }

    isFrontScrub(snapshot) {
      return this.detectFrontScrub(snapshot) !== null
    }

    detectExitWheelspin(snapshot) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      const learned = learnedThresholds(this.thresholds, snapshot)
      if (!phaseIsExit(snapshot.phase) || previous === null) return null
      if (
        sample.drivenSlip === null
        || sample.effectiveAcceleration === null
        || sample.throttleRate === null
        || (this.lastCleanExitAcceleration === null && learned.learnedAcceleration <= 0)
      ) return null
      const accelerationLimit = Math.max(
        learned.wheelspinAccelerationLimit,
        (this.lastCleanExitAcceleration ?? 0) * this.thresholds.wheelspinAccelerationRatio
      )
      if (!(sample.throttle >= this.thresholds.throttleOn
        && sample.throttleRate >= this.thresholds.throttleRisePerSecond
        && sample.drivenSlip >= learned.drivenSlipMin
        && sample.effectiveAcceleration <= accelerationLimit)) return null

      const bin = snapshot.calibration?.bin
      return {
        kind: FINDINGS.EXIT_WHEELSPIN,
        throttleGrowth: sample.throttleRate,
        slipGrowth: sample.drivenSlipGrowthRate,
        accelerationResponse: sample.effectiveAcceleration,
        evidenceMs: 0,
        components: {
          throttleGrowth: marginAbove(sample.throttleRate, this.thresholds.throttleRisePerSecond, this.thresholds.throttleRisePerSecond * 0.5),
          slipGrowth: Math.min(
            percentileRank(sample.drivenSlipGrowthRate, bin, 'drivenSlipGrowthRateP50', 'drivenSlipGrowthRateP90'),
            marginAbove(sample.drivenSlipGrowthRate, 0, 0.08)
          ),
          slipLoad: percentileRank(sample.drivenSlip, bin, 'drivenSlipP50', 'drivenSlipP90'),
          accelerationLoss: clamp01((accelerationLimit - sample.effectiveAcceleration) / Math.max(Math.abs(accelerationLimit), 0.01))
        }
      }
    }

    isExitWheelspin(snapshot) {
      return this.detectExitWheelspin(snapshot) !== null
    }

    detectBrakeSteeringOverload(snapshot) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      if (!phaseIsTurning(snapshot.phase) || previous === null) return null
      if (
        sample.frontCombinedSlip === null
        || sample.lateralResponse === null
        || sample.yawRate === null
        || previous.lateralResponse === null
        || previous.yawRate === null
      ) return null
      const learned = learnedThresholds(this.thresholds, snapshot)
      const responseDelta = sample.lateralResponse - previous.lateralResponse
      const yawDelta = sample.yawRate - previous.yawRate
      if (!(sample.brake >= this.thresholds.overloadBrakeMin
        && sample.steerMagnitude >= this.thresholds.overloadSteerMin
        && sample.frontCombinedSlip >= learned.frontCombinedOverload
        && responseDelta <= learned.responseFlatDelta
        && yawDelta <= learned.yawFlatDelta)) return null

      const bin = snapshot.calibration?.bin
      return {
        kind: FINDINGS.BRAKE_STEERING_OVERLOAD,
        brakeLoad: sample.brake,
        steeringLoad: sample.steerMagnitude,
        combinedSlip: sample.frontCombinedSlip,
        responseLoss: responseDelta,
        yawLoss: yawDelta,
        evidenceMs: 0,
        components: {
          brakeLoad: percentileRank(sample.brake, bin, 'brakeP50', 'brakeP90'),
          steeringLoad: percentileRank(sample.steerMagnitude, bin, 'steerMagnitudeP50', 'steerMagnitudeP90'),
          combinedSlip: percentileRank(sample.frontCombinedSlip, bin, 'frontCombinedSlipP50', 'frontCombinedSlipP90'),
          responseLoss: stalledResponseConfidence(
            responseDelta,
            learned.responseFlatDelta,
            sample.lateralResponse,
            bin?.lateralResponseP90
          ),
          yawLoss: stalledResponseConfidence(
            yawDelta,
            learned.yawFlatDelta,
            sample.yawRate,
            bin?.yawRateP90
          )
        }
      }
    }

    isBrakeSteeringOverload(snapshot) {
      return this.detectBrakeSteeringOverload(snapshot) !== null
    }

    detectControlledRelease(snapshot) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      if (!phaseIsTurning(snapshot.phase) || previous === null || sample.brakeRate === null) return null
      if (
        sample.frontCombinedSlip === null
        || sample.lateralResponse === null
        || previous.lateralResponse === null
      ) return null
      const learned = learnedThresholds(this.thresholds, snapshot)
      const responseDelta = sample.lateralResponse - previous.lateralResponse
      if (!(sample.brake >= this.thresholds.controlledBrakeMin
        && sample.brake <= this.thresholds.controlledBrakeMax
        && sample.brakeRate <= -this.thresholds.controlledReleaseRateMin
        && sample.brakeRate >= -this.thresholds.controlledReleaseRateMax
        && sample.steerMagnitude >= 0.15
        && sample.frontCombinedSlip < learned.frontCombinedOverload
        && responseDelta >= -learned.responseFlatDelta)) return null

      return {
        kind: FINDINGS.CONTROLLED_RELEASE,
        brakeReleaseRate: sample.brakeRate,
        combinedSlip: sample.frontCombinedSlip,
        responseChange: responseDelta,
        evidenceMs: 0,
        components: {
          releaseRate: marginBelow(Math.abs(sample.brakeRate), this.thresholds.controlledReleaseRateMax, this.thresholds.controlledReleaseRateMax),
          brakeWindow: Math.min(
            marginAbove(sample.brake, this.thresholds.controlledBrakeMin, this.thresholds.controlledBrakeMin),
            marginBelow(sample.brake, this.thresholds.controlledBrakeMax, this.thresholds.controlledBrakeMax)
          ),
          responseStability: stalledResponseConfidence(
            -responseDelta,
            learned.responseFlatDelta,
            sample.lateralResponse,
            null
          )
        }
      }
    }

    isControlledRelease(snapshot) {
      return this.detectControlledRelease(snapshot) !== null
    }

    detectCleanExit(snapshot) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      if (!phaseIsExit(snapshot.phase) || previous === null) return null
      if (sample.drivenSlip === null || sample.effectiveAcceleration === null || sample.throttleRate === null) return null
      const learned = learnedThresholds(this.thresholds, snapshot)
      if (!(sample.throttle >= this.thresholds.cleanExitThrottleMin
        && sample.throttleRate >= this.thresholds.throttleRisePerSecond
        && sample.drivenSlip <= learned.drivenSlipCleanMax
        && sample.effectiveAcceleration >= learned.cleanExitAccelerationMin
        && sample.steerRate !== null
        && sample.steerRate <= 0.2)) return null

      const bin = snapshot.calibration?.bin
      return {
        kind: FINDINGS.CLEAN_EXIT,
        throttleGrowth: sample.throttleRate,
        drivenSlip: sample.drivenSlip,
        accelerationResponse: sample.effectiveAcceleration,
        evidenceMs: 0,
        components: {
          throttleGrowth: marginAbove(sample.throttleRate, this.thresholds.throttleRisePerSecond, this.thresholds.throttleRisePerSecond * 0.5),
          lowDrivenSlip: marginBelow(sample.drivenSlip, learned.drivenSlipCleanMax, learned.drivenSlipCleanMax),
          accelerationStrength: percentileRank(sample.effectiveAcceleration, bin, 'effectiveAccelerationP50', 'effectiveAccelerationP90'),
          steeringStability: marginBelow(Math.max(0, sample.steerRate), 0.2, 0.2)
        }
      }
    }

    isCleanExit(snapshot) {
      return this.detectCleanExit(snapshot) !== null
    }

    updatePendingRelease(snapshot, events) {
      const sample = snapshot.sample
      const previous = snapshot.previousSample
      if (this.pendingRelease !== null) {
        const elapsedMs = sample.timestampMs - this.pendingRelease.timestampMs
        if (elapsedMs < 0 || elapsedMs > this.thresholds.brakeReleaseWindowMs) {
          this.pendingRelease = null
        } else if (!this.pendingRelease.issued) {
          const detection = this.detectAbruptBrakeRelease(snapshot)
          if (detection !== null) {
            const confidence = this.evidenceConfidence(detection.evidence, detection.evidenceMs, 0)
            if (confidence >= this.thresholds.cueMinConfidence) {
              this.pendingRelease.issued = true
              const finding = this.createFinding(FINDINGS.ABRUPT_BRAKE_RELEASE, snapshot, detection.evidence, confidence)
              if (finding) events.push(finding)
            }
          }
        }
      }

      const releaseRate = sample.brakeRate === null ? null : Math.abs(sample.brakeRate)
      if (
        previous === null
        || !phaseIsTurning(snapshot.phase)
        || previous.brake < this.thresholds.brakeReleaseMin
        || releaseRate === null
        || releaseRate < this.thresholds.brakeReleaseDropPerSecond
      ) return

      if (this.pendingRelease !== null) {
        this.pendingRelease.releaseRate = Math.max(this.pendingRelease.releaseRate, releaseRate)
        return
      }

      this.pendingRelease = {
        timestampMs: sample.timestampMs,
        releaseRate,
        lateralResponse: previous.lateralResponse,
        yawRate: previous.yawRate,
        rearSlip: previous.rearSlip,
        issued: false
      }
    }

    detectAbruptBrakeRelease(snapshot) {
      if (this.pendingRelease === null) return null
      const sample = snapshot.sample
      const elapsedMs = sample.timestampMs - this.pendingRelease.timestampMs
      if (elapsedMs < 0 || elapsedMs > this.thresholds.brakeReleaseWindowMs) return null
      const learned = learnedThresholds(this.thresholds, snapshot)
      const responseLoss = this.pendingRelease.lateralResponse - (sample.lateralResponse ?? this.pendingRelease.lateralResponse)
      const yawLoss = this.pendingRelease.yawRate - (sample.yawRate ?? this.pendingRelease.yawRate)
      const responseDrop = responseLoss >= learned.brakeReleaseResponseDrop
      const yawDrop = yawLoss >= learned.brakeReleaseYawDrop
      const rearSlipRiseValue = sample.rearSlip !== null
        && this.pendingRelease.rearSlip !== null
        ? sample.rearSlip - this.pendingRelease.rearSlip
        : 0
      const rearSlipRise = rearSlipRiseValue >= this.thresholds.brakeReleaseRearSlipRise
      if (!responseDrop || (!yawDrop && !rearSlipRise)) return null

      const yawEvidence = marginAbove(yawDrop ? yawLoss : 0, learned.brakeReleaseYawDrop, learned.brakeReleaseYawDrop * 0.5)
      const rearEvidence = marginAbove(rearSlipRiseValue, this.thresholds.brakeReleaseRearSlipRise, this.thresholds.brakeReleaseRearSlipRise * 0.5)
      return {
        evidenceMs: elapsedMs,
        evidence: {
          kind: FINDINGS.ABRUPT_BRAKE_RELEASE,
          responseLoss,
          yawLoss,
          rearSlipRise: rearSlipRise ? rearSlipRiseValue : 0,
          releaseRate: this.pendingRelease.releaseRate,
          evidenceMs: elapsedMs,
          components: {
            responseLoss: marginAbove(responseLoss, learned.brakeReleaseResponseDrop, learned.brakeReleaseResponseDrop * 0.5),
            stabilityLoss: Math.max(yawEvidence, rearEvidence),
            releaseAbruptness: marginAbove(this.pendingRelease.releaseRate, this.thresholds.brakeReleaseDropPerSecond, this.thresholds.brakeReleaseDropPerSecond * 0.5)
          }
        }
      }
    }

    evidenceConfidence(evidence, evidenceMs, minimumMs) {
      const durationProgress = Math.max(0, (evidenceMs - minimumMs) / Math.max(minimumMs, 1))
      const durationConfidence = Math.min(
        1,
        this.thresholds.cueMinConfidence
          + (1 - this.thresholds.cueMinConfidence) * durationProgress
      )
      return Math.min(
        durationConfidence,
        minimumComponentConfidence(evidence?.components)
      )
    }

    updateSustained(kind, evidence, snapshot, minimumMs) {
      const candidate = this.candidates[kind]
      if (!evidence) {
        this.candidates[kind] = null
        return null
      }

      if (candidate === null) {
        this.candidates[kind] = {
          sinceMs: snapshot.timestampMs,
          issued: false,
          evidence
        }
        return null
      }

      candidate.evidence = mergeEvidence(candidate.evidence, evidence)
      const evidenceMs = snapshot.timestampMs - candidate.sinceMs
      if (candidate.issued || evidenceMs <= minimumMs) return null
      const enrichedEvidence = { ...candidate.evidence, evidenceMs }
      const confidence = this.evidenceConfidence(enrichedEvidence, evidenceMs, minimumMs)
      const requiresCueConfidence = NEGATIVE_FINDINGS.includes(kind)
      if (requiresCueConfidence && confidence < this.thresholds.cueMinConfidence) return null
      candidate.issued = true
      return this.createFinding(kind, snapshot, enrichedEvidence, confidence)
    }

    createFinding(kind, snapshot, evidence, confidence) {
      if (!Object.values(FINDINGS).includes(kind)) return null
      this.counts[kind] += 1
      this.sequence += 1
      return {
        ...evidence,
        kind,
        confidence,
        evidence,
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
    learnedThresholds,
    AsphaltCoachFindings
  }
}))

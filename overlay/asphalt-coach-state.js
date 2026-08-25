(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.AsphaltCoachState = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
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
    speedBinCount: 12,
    envelopeWindowSize: 24,
    calibrationMinSamples: 36,
    calibrationMinBins: 3,
    calibrationMinBinSamples: 8,
    surfaceTransientRateRatio: 2.5
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

  function absolute(value) {
    const number = finite(value)
    return number === null ? null : Math.abs(number)
  }

  function pairAverage(quad, left, right, absoluteValues = true) {
    const first = finite(quad?.[left])
    const second = finite(quad?.[right])
    if (first === null || second === null) return null
    return absoluteValues ? (Math.abs(first) + Math.abs(second)) / 2 : (first + second) / 2
  }

  function allAverage(quad, absoluteValues = true) {
    const values = [finite(quad?.fl), finite(quad?.fr), finite(quad?.rl), finite(quad?.rr)]
    if (values.some(value => value === null)) return null
    return absoluteValues
      ? values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length
      : values.reduce((sum, value) => sum + value, 0) / values.length
  }

  function anyRumble(quad) {
    return quad?.fl === true || quad?.fr === true || quad?.rl === true || quad?.rr === true
  }

  function maxQuad(quad) {
    const values = [finite(quad?.fl), finite(quad?.fr), finite(quad?.rl), finite(quad?.rr)]
      .filter(value => value !== null)
      .map(value => Math.abs(value))
    return values.length === 0 ? null : Math.max(...values)
  }

  function median3(first, second, third) {
    const a = finite(first)
    const b = finite(second)
    const c = finite(third)
    if (a === null) return b === null ? c : c === null ? b : (b + c) / 2
    if (b === null) return c === null ? a : (a + c) / 2
    if (c === null) return (a + b) / 2
    return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
  }

  function createPercentile(windowSize) {
    return {
      count: 0,
      next: 0,
      ring: new Array(windowSize),
      sorted: new Array(windowSize)
    }
  }

  function insertSorted(metric, value) {
    let index = metric.count
    while (index > 0 && metric.sorted[index - 1] > value) {
      metric.sorted[index] = metric.sorted[index - 1]
      index -= 1
    }
    metric.sorted[index] = value
    metric.count += 1
  }

  function removeSorted(metric, value) {
    let index = 0
    while (index < metric.count && metric.sorted[index] !== value) index += 1
    if (index === metric.count) return
    while (index < metric.count - 1) {
      metric.sorted[index] = metric.sorted[index + 1]
      index += 1
    }
    metric.count -= 1
  }

  function addPercentile(metric, value) {
    const number = finite(value)
    if (number === null) return

    if (metric.count === metric.ring.length) removeSorted(metric, metric.ring[metric.next])
    metric.ring[metric.next] = number
    metric.next = (metric.next + 1) % metric.ring.length
    insertSorted(metric, number)
  }

  function percentile(metric, fraction) {
    if (!metric || metric.count === 0) return null
    const index = Math.min(metric.count - 1, Math.max(0, Math.floor((metric.count - 1) * fraction)))
    return metric.sorted[index]
  }

  function summarizeBin(bin) {
    return {
      index: bin.index,
      speedMinKmh: bin.speedMinKmh,
      speedMaxKmh: bin.speedMaxKmh,
      samples: bin.samples,
      maxLateralResponse: bin.maxLateralResponse,
      maxYawRate: bin.maxYawRate,
      maxEffectiveAcceleration: bin.maxEffectiveAcceleration,
      minFrontSlip: bin.minFrontSlip,
      lateralResponseP90: percentile(bin.lateralResponse, 0.9),
      yawRateP90: percentile(bin.yawRate, 0.9),
      effectiveAccelerationP90: percentile(bin.effectiveAcceleration, 0.9),
      frontSlipP90: percentile(bin.frontSlip, 0.9),
      drivenSlipP90: percentile(bin.drivenSlip, 0.9),
      frontCombinedSlipP90: percentile(bin.frontCombinedSlip, 0.9),
      verticalResponseP90: percentile(bin.verticalResponse, 0.9),
      verticalChangeRateP90: percentile(bin.verticalChangeRate, 0.9),
      lateralChangeRateP90: percentile(bin.lateralChangeRate, 0.9),
      longitudinalChangeRateP90: percentile(bin.longitudinalChangeRate, 0.9),
      ready: bin.calibrationFrozen
    }
  }

  function drivenWheelAverage(frame) {
    const drivetrain = finite(frame?.car?.drivetrain)
    if (drivetrain === 0) return pairAverage(frame.slipRatio, 'fl', 'fr')
    if (drivetrain === 1) return pairAverage(frame.slipRatio, 'rl', 'rr')
    if (drivetrain === 2) return allAverage(frame.slipRatio)
    return null
  }

  function vehicleIdentity(frame) {
    const ordinal = finite(frame?.car?.ordinal)
    const pi = finite(frame?.car?.pi)
    const rpmMax = finite(frame?.rpmMax)
    const drivetrain = finite(frame?.car?.drivetrain)
    if (ordinal === null || pi === null || rpmMax === null || drivetrain === null) return null
    return [Math.trunc(ordinal), Math.trunc(pi), Math.round(rpmMax), Math.trunc(drivetrain)].join(':')
  }

  function createEnvelope(thresholds) {
    const bins = []
    for (let index = 0; index < thresholds.speedBinCount; index += 1) {
      bins.push({
        index,
        speedMinKmh: index * thresholds.speedBinKmh,
        speedMaxKmh: (index + 1) * thresholds.speedBinKmh,
        samples: 0,
        calibrationFrozen: false,
        maxLateralResponse: 0,
        maxYawRate: 0,
        maxEffectiveAcceleration: 0,
        minFrontSlip: null,
        lateralResponse: createPercentile(thresholds.envelopeWindowSize),
        yawRate: createPercentile(thresholds.envelopeWindowSize),
        effectiveAcceleration: createPercentile(thresholds.envelopeWindowSize),
        frontSlip: createPercentile(thresholds.envelopeWindowSize),
        drivenSlip: createPercentile(thresholds.envelopeWindowSize),
        frontCombinedSlip: createPercentile(thresholds.envelopeWindowSize),
        verticalResponse: createPercentile(thresholds.envelopeWindowSize),
        verticalChangeRate: createPercentile(thresholds.envelopeWindowSize),
        lateralChangeRate: createPercentile(thresholds.envelopeWindowSize),
        longitudinalChangeRate: createPercentile(thresholds.envelopeWindowSize)
      })
    }
    return {
      samples: 0,
      bins,
      binsWithSamples: 0
    }
  }

  function emptySnapshot(reason = null) {
    return {
      valid: false,
      resetReason: reason,
      timestampMs: null,
      phase: PHASES.STRAIGHT,
      previousPhase: PHASES.STRAIGHT,
      phaseChanged: false,
      phaseDurationMs: 0,
      attemptId: 0,
      newAttempt: false,
      sample: null,
      previousSample: null,
      calibration: {
        ready: false,
        sampleCount: 0,
        binsWithSamples: 0,
        binIndex: null,
        bin: null,
        identity: null
      }
    }
  }

  function normalizeFrame(frame) {
    const timestampMs = finite(frame?.timestampMs)
    const speedKmh = finite(frame?.speedKmh)
    if (timestampMs === null || speedKmh === null) return null

    const accelerationX = finite(frame?.acceleration?.x)
    const accelerationY = finite(frame?.acceleration?.y)
    const accelerationZ = finite(frame?.acceleration?.z)
    const yawRate = finite(frame?.angularVelocity?.y)
    return {
      timestampMs,
      isRaceOn: frame?.isRaceOn === true,
      speedKmh: Math.max(0, speedKmh),
      throttle: clamp01(frame?.throttle),
      brake: clamp01(frame?.brake),
      steer: Math.max(-1, Math.min(1, finite(frame?.steer) ?? 0)),
      frontSlip: pairAverage(frame?.slipAngle, 'fl', 'fr'),
      rearSlip: pairAverage(frame?.slipAngle, 'rl', 'rr'),
      frontCombinedSlip: pairAverage(frame?.combinedSlip, 'fl', 'fr'),
      drivenSlip: drivenWheelAverage(frame),
      lateralResponse: accelerationX === null ? null : Math.abs(accelerationX),
      verticalResponse: accelerationY === null ? null : Math.abs(accelerationY),
      longitudinalResponse: accelerationZ === null ? null : Math.abs(accelerationZ),
      rumbleContact: anyRumble(frame?.rumble),
      puddleDepth: maxQuad(frame?.puddle),
      yawRate: yawRate === null ? null : Math.abs(yawRate),
      carIdentity: vehicleIdentity(frame),
      lapRaceTimeS: finite(frame?.lap?.raceTime),
      lapNumber: finite(frame?.lap?.number),
      lapDistanceM: finite(frame?.lap?.distance)
    }
  }

  class AsphaltCoachState {
    constructor(options = {}) {
      this.thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) }
      this.reset()
    }

    reset(reason = null) {
      this.lastTimestampMs = null
      this.lastRaceTimeS = null
      this.lastLapNumber = null
      this.lastDistanceM = null
      this.identity = null
      this.phase = PHASES.STRAIGHT
      this.phaseSinceMs = null
      this.previousPreviousSample = null
      this.previousSample = null
      this.lastFilteredLateralResponse = null
      this.lastFilteredLongitudinalResponse = null
      this.lastFilteredVerticalResponse = null
      this.activeAttempt = false
      this.attemptId = 0
      this.envelope = createEnvelope(this.thresholds)
      this.recentTransientRate = createPercentile(this.thresholds.envelopeWindowSize)
      this.lastResetReason = reason
      return this.getSnapshot(null, reason)
    }

    resetTransient(reason = 'telemetry_gap') {
      this.lastTimestampMs = null
      this.lastRaceTimeS = null
      this.lastLapNumber = null
      this.lastDistanceM = null
      this.phase = PHASES.STRAIGHT
      this.phaseSinceMs = null
      this.previousPreviousSample = null
      this.previousSample = null
      this.lastFilteredLateralResponse = null
      this.lastFilteredLongitudinalResponse = null
      this.lastFilteredVerticalResponse = null
      this.activeAttempt = false
      this.lastResetReason = reason
      return this.getSnapshot(null, reason)
    }

    beginAttempt() {
      this.phase = PHASES.STRAIGHT
      this.phaseSinceMs = null
      this.previousPreviousSample = null
      this.previousSample = null
      this.lastFilteredLateralResponse = null
      this.lastFilteredLongitudinalResponse = null
      this.lastFilteredVerticalResponse = null
      this.activeAttempt = false
      this.lastTimestampMs = null
      this.lastRaceTimeS = null
      this.lastLapNumber = null
      this.lastDistanceM = null
      this.attemptId += 1
      return this.getSnapshot(null, 'attempt_start')
    }

    update(frame = {}) {
      const sample = normalizeFrame(frame)
      if (sample === null) return this.resetTransient('invalid_frame')
      if (!sample.isRaceOn) return this.resetTransient('inactive')

      if (this.identity !== null && sample.carIdentity !== null && sample.carIdentity !== this.identity) {
        this.reset('car_identity_change')
        return this.getSnapshot(null, 'car_identity_change')
      }
      if (this.identity === null && sample.carIdentity !== null) this.identity = sample.carIdentity

      if (this.lastTimestampMs !== null) {
        const frameGapMs = sample.timestampMs - this.lastTimestampMs
        if (frameGapMs <= 0 || frameGapMs > this.thresholds.maxFrameGapMs) {
          this.resetTransient(frameGapMs <= 0 ? 'timestamp_rewind' : 'telemetry_gap')
          return this.getSnapshot(null, this.lastResetReason)
        }
        if (
          this.lastRaceTimeS !== null
          && sample.lapRaceTimeS !== null
          && sample.lapRaceTimeS + 5 < this.lastRaceTimeS
        ) {
          this.reset('race_clock_rewind')
          return this.getSnapshot(null, 'race_clock_rewind')
        }
        if (
          this.lastLapNumber !== null
          && sample.lapNumber !== null
          && sample.lapNumber < this.lastLapNumber
        ) {
          this.reset('lap_number_rewind')
          return this.getSnapshot(null, 'lap_number_rewind')
        }
        if (
          this.lastDistanceM !== null
          && sample.lapDistanceM !== null
          && sample.lapDistanceM + 100 < this.lastDistanceM
        ) {
          this.reset('lap_distance_rewind')
          return this.getSnapshot(null, 'lap_distance_rewind')
        }
      }

      const newAttempt = !this.activeAttempt
      if (newAttempt) {
        this.activeAttempt = true
        if (this.attemptId === 0) this.attemptId = 1
        this.phase = PHASES.STRAIGHT
        this.phaseSinceMs = sample.timestampMs
      }

      const previousSample = this.previousSample
      const deltaMs = previousSample === null
        ? null
        : sample.timestampMs - previousSample.timestampMs
      const deltaSeconds = deltaMs === null || deltaMs <= 0 ? null : deltaMs / 1000
      sample.effectiveAcceleration = deltaSeconds === null
        ? null
        : (sample.speedKmh - previousSample.speedKmh) / 3.6 / deltaSeconds
      sample.steerMagnitude = Math.abs(sample.steer)
      sample.steerRate = previousSample === null || deltaSeconds === null
        ? null
        : (sample.steerMagnitude - previousSample.steerMagnitude) / deltaSeconds
      sample.throttleRate = previousSample === null || deltaSeconds === null
        ? null
        : (sample.throttle - previousSample.throttle) / deltaSeconds
      sample.brakeRate = previousSample === null || deltaSeconds === null
        ? null
        : (sample.brake - previousSample.brake) / deltaSeconds
      const filteredLateralResponse = median3(
        this.previousPreviousSample?.lateralResponse,
        previousSample?.lateralResponse,
        sample.lateralResponse
      )
      const filteredLongitudinalResponse = median3(
        this.previousPreviousSample?.longitudinalResponse,
        previousSample?.longitudinalResponse,
        sample.longitudinalResponse
      )
      const filteredVerticalResponse = median3(
        this.previousPreviousSample?.verticalResponse,
        previousSample?.verticalResponse,
        sample.verticalResponse
      )
      sample.verticalChangeRate = previousSample === null || deltaSeconds === null || this.lastFilteredVerticalResponse === null
        ? null
        : Math.abs((filteredVerticalResponse ?? 0) - this.lastFilteredVerticalResponse) / deltaSeconds
      sample.lateralChangeRate = previousSample === null || deltaSeconds === null || this.lastFilteredLateralResponse === null
        ? null
        : Math.abs((filteredLateralResponse ?? 0) - this.lastFilteredLateralResponse) / deltaSeconds
      sample.longitudinalChangeRate = previousSample === null || deltaSeconds === null || this.lastFilteredLongitudinalResponse === null
        ? null
        : Math.abs((filteredLongitudinalResponse ?? 0) - this.lastFilteredLongitudinalResponse) / deltaSeconds
      sample.transientRate = Math.max(
        sample.lateralChangeRate ?? 0,
        sample.longitudinalChangeRate ?? 0,
        sample.verticalChangeRate ?? 0
      )
      sample.surfaceDisturbed = this.isSurfaceDisturbed(sample)
      sample.calibrationEligible = this.isCalibrationEligible(sample, previousSample)
      if (sample.calibrationEligible && sample.transientRate > 0) addPercentile(this.recentTransientRate, sample.transientRate)

      const previousPhase = this.phase
      const nextPhase = this.classifyPhase(sample, previousSample, deltaSeconds)
      if (nextPhase !== previousPhase) {
        this.phase = nextPhase
        this.phaseSinceMs = sample.timestampMs
      }

      this.updateEnvelope(sample)
      this.lastTimestampMs = sample.timestampMs
      this.lastRaceTimeS = sample.lapRaceTimeS
      this.lastLapNumber = sample.lapNumber
      this.lastDistanceM = sample.lapDistanceM
      this.previousPreviousSample = previousSample
      this.previousSample = sample
      this.lastFilteredLateralResponse = filteredLateralResponse
      this.lastFilteredLongitudinalResponse = filteredLongitudinalResponse
      this.lastFilteredVerticalResponse = filteredVerticalResponse
      this.lastResetReason = null

      return this.getSnapshot(sample, null, {
        previousPhase,
        phaseChanged: nextPhase !== previousPhase,
        phaseDurationMs: Math.max(0, sample.timestampMs - (this.phaseSinceMs ?? sample.timestampMs)),
        newAttempt,
        previousSample
      })
    }

    classifyPhase(sample, previousSample, deltaSeconds) {
      const phase = this.phase
      const steerRate = sample.steerRate ?? 0
      const speedIsUseful = sample.speedKmh >= this.thresholds.minSpeedKmh
      const turning = sample.steerMagnitude >= this.thresholds.steerOn && speedIsUseful
      const releasingSteer = sample.steerMagnitude <= this.thresholds.steerRelease

      if (!turning && releasingSteer && sample.brake < this.thresholds.brakeOn) return PHASES.STRAIGHT
      if (sample.brake >= this.thresholds.brakeOn && !turning) return PHASES.BRAKING
      if (turning && (phase === PHASES.BRAKING || phase === PHASES.STRAIGHT)) {
        if (sample.brake >= this.thresholds.brakeOn || steerRate >= 0.15) return PHASES.TURN_IN
      }
      if (turning && phase === PHASES.TURN_IN && sample.brake < this.thresholds.brakeOn) {
        return PHASES.ROTATION
      }
      if (
        turning
        && (phase === PHASES.TURN_IN || phase === PHASES.ROTATION)
        && (
          sample.throttle >= this.thresholds.throttleOn
          || (sample.steerRate !== null && sample.steerRate < -0.15 && (sample.effectiveAcceleration ?? -Infinity) > -3)
        )
      ) return PHASES.EXIT
      if (phase === PHASES.EXIT && turning) return PHASES.EXIT
      if (phase === PHASES.ROTATION && turning) return PHASES.ROTATION
      if (phase === PHASES.TURN_IN && turning) return PHASES.TURN_IN
      if (phase === PHASES.BRAKING && sample.brake >= this.thresholds.brakeOff) return PHASES.BRAKING
      if (previousSample === null && sample.brake >= this.thresholds.brakeOn) return PHASES.BRAKING
      if (!speedIsUseful && sample.brake < this.thresholds.brakeOn) return PHASES.STRAIGHT
      return phase
    }

    updateEnvelope(sample) {
      if (
        sample.speedKmh < this.thresholds.minSpeedKmh
        || sample.surfaceDisturbed
        || sample.calibrationEligible !== true
      ) return
      const binIndex = this.getBinIndex(sample.speedKmh)
      const bin = this.envelope.bins[binIndex]
      if (bin.calibrationFrozen) return
      if (bin.samples === 0) this.envelope.binsWithSamples += 1
      bin.samples += 1
      this.envelope.samples += 1
      if (sample.lateralResponse !== null) bin.maxLateralResponse = Math.max(bin.maxLateralResponse, sample.lateralResponse)
      if (sample.yawRate !== null) bin.maxYawRate = Math.max(bin.maxYawRate, sample.yawRate)
      if (sample.effectiveAcceleration !== null && sample.effectiveAcceleration > 0) {
        bin.maxEffectiveAcceleration = Math.max(bin.maxEffectiveAcceleration, sample.effectiveAcceleration)
      }
      if (sample.frontSlip !== null) {
        bin.minFrontSlip = bin.minFrontSlip === null
          ? sample.frontSlip
          : Math.min(bin.minFrontSlip, sample.frontSlip)
      }
      addPercentile(bin.lateralResponse, sample.lateralResponse)
      addPercentile(bin.yawRate, sample.yawRate)
      if (sample.effectiveAcceleration !== null && sample.effectiveAcceleration > 0) {
        addPercentile(bin.effectiveAcceleration, sample.effectiveAcceleration)
      }
      addPercentile(bin.frontSlip, sample.frontSlip)
      addPercentile(bin.drivenSlip, sample.drivenSlip)
      addPercentile(bin.frontCombinedSlip, sample.frontCombinedSlip)
      addPercentile(bin.verticalResponse, sample.verticalResponse)
      addPercentile(bin.verticalChangeRate, sample.verticalChangeRate)
      addPercentile(bin.lateralChangeRate, sample.lateralChangeRate)
      addPercentile(bin.longitudinalChangeRate, sample.longitudinalChangeRate)
      if (
        this.envelope.samples >= this.thresholds.calibrationMinSamples
        && this.envelope.binsWithSamples >= this.thresholds.calibrationMinBins
      ) {
        for (const candidate of this.envelope.bins) {
          if (candidate.samples >= this.thresholds.calibrationMinBinSamples) candidate.calibrationFrozen = true
        }
      }
    }

    getBinIndex(speedKmh) {
      return Math.max(
        0,
        Math.min(
          this.thresholds.speedBinCount - 1,
          Math.floor(speedKmh / this.thresholds.speedBinKmh)
        )
      )
    }

    isSurfaceDisturbed(sample) {
      if (sample.rumbleContact || (sample.puddleDepth !== null && sample.puddleDepth > 0)) return true
      if (sample.speedKmh < this.thresholds.minSpeedKmh) return false

      const bin = this.envelope.bins[this.getBinIndex(sample.speedKmh)]
      if (bin.samples < this.thresholds.calibrationMinBinSamples) return false

      return this.exceedsLearnedRate(bin.verticalChangeRate, sample.verticalChangeRate)
        || this.exceedsLearnedRate(bin.lateralChangeRate, sample.lateralChangeRate)
        || this.exceedsLearnedRate(bin.longitudinalChangeRate, sample.longitudinalChangeRate)
    }

    exceedsLearnedRate(metric, value) {
      const learnedRate = percentile(metric, 0.9)
      return learnedRate !== null
        && learnedRate > 0
        && value !== null
        && value > learnedRate * this.thresholds.surfaceTransientRateRatio
    }

    isCalibrationEligible(sample, previousSample) {
      const frontFailure = sample.steerMagnitude >= 0.28
        && sample.frontSlip !== null
        && sample.frontSlip >= 0.16
      const powerFailure = sample.throttle >= 0.65
        && sample.drivenSlip !== null
        && sample.drivenSlip >= 0.12
      const combinedFailure = sample.brake >= 0.25
        && sample.steerMagnitude >= 0.22
        && sample.frontCombinedSlip !== null
        && sample.frontCombinedSlip >= 0.85
      const abruptRelease = previousSample !== null
        && previousSample.brake >= 0.35
        && sample.brakeRate !== null
        && sample.brakeRate <= -1.5
      const learnedTransientRate = percentile(this.recentTransientRate, 0.9)
      const transientOutlier = learnedTransientRate !== null
        && learnedTransientRate > 0
        && sample.transientRate > learnedTransientRate * this.thresholds.surfaceTransientRateRatio

      return sample.speedKmh >= this.thresholds.minSpeedKmh
        && !sample.surfaceDisturbed
        && !frontFailure
        && !powerFailure
        && !combinedFailure
        && !abruptRelease
        && !transientOutlier
    }

    getSnapshot(sample, resetReason = null, overrides = {}) {
      const binIndex = sample === null
        ? null
        : this.getBinIndex(sample.speedKmh)
      const bin = binIndex === null ? null : summarizeBin(this.envelope.bins[binIndex])
      return {
        valid: sample !== null,
        resetReason,
        timestampMs: sample?.timestampMs ?? null,
        phase: this.phase,
        previousPhase: overrides.previousPhase ?? this.phase,
        phaseChanged: overrides.phaseChanged === true,
        phaseDurationMs: overrides.phaseDurationMs ?? 0,
        attemptId: this.attemptId,
        newAttempt: overrides.newAttempt === true,
        sample,
        previousSample: overrides.previousSample ?? null,
        calibration: {
          ready: this.envelope.samples >= this.thresholds.calibrationMinSamples
            && this.envelope.binsWithSamples >= this.thresholds.calibrationMinBins
            && bin?.ready === true,
          sampleCount: this.envelope.samples,
          binsWithSamples: this.envelope.binsWithSamples,
          binIndex,
          bin,
          identity: this.identity
        }
      }
    }
  }

  return {
    DEFAULT_THRESHOLDS,
    PHASES,
    AsphaltCoachState,
    createEnvelope,
    normalizeFrame,
    vehicleIdentity
  }
}))

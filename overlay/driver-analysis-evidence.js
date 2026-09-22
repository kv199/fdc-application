(function (globalScope, factory) {
  const opportunitiesApi = typeof module !== 'undefined' && module.exports && typeof document === 'undefined'
    ? require('./driver-analysis-opportunities.js')
    : globalScope.DriverAnalysisOpportunities
  const api = factory(opportunitiesApi || {})
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysisEvidence = api
}(typeof globalThis !== 'undefined' ? globalThis : this, opportunitiesApi => {
  'use strict'

  const TYPES = opportunitiesApi.PROBLEM_TYPES || {
    FRONT_SCRUB: 'front_scrub', EXIT_WHEELSPIN: 'exit_wheelspin',
    BRAKE_STEERING_OVERLOAD: 'brake_steering_overload', ABRUPT_BRAKE_RELEASE: 'abrupt_brake_release'
  }
  const DEFAULT_THRESHOLDS = Object.freeze({
    minDetectorConfidence: 0.84,
    minAttributionConfidence: 0.70,
    frontSteerGrowth: 0.03,
    frontSlipRise: 0.04,
    frontSlipLimit: 0.9,
    frontLateralLoss: 0.5,
    frontYawLoss: 0.05,
    frontThrottleRiseMax: 0.1,
    responseLoss: 0.02,
    wheelspinSlip: 0.12,
    wheelspinSlipRise: 0.04,
    wheelspinAccelerationMax: 1.5,
    overloadBrakeMin: 0.2,
    overloadSteerMin: 0.18,
    overloadCombinedSlip: 0.5,
    overloadResponseLoss: 0.02,
    releaseRate: 1.5,
    releaseResponseLoss: 0.15,
    releaseYawLoss: 0.2,
    releaseRearSlipRise: 0.08
  })

  function n(value, fallback = null) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }
  function abs(value) { const number = n(value); return number === null ? null : Math.abs(number) }
  function clamp(value, low = 0, high = 1) { return Math.max(low, Math.min(high, n(value, low))) }
  function average(values, fallback = null) {
    const finite = values.map(value => n(value)).filter(value => value !== null)
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : fallback
  }
  function max(values, fallback = null) {
    const finite = values.map(value => n(value)).filter(value => value !== null)
    return finite.length ? Math.max(...finite) : fallback
  }
  function min(values, fallback = null) {
    const finite = values.map(value => n(value)).filter(value => value !== null)
    return finite.length ? Math.min(...finite) : fallback
  }
  function range(values) {
    const high = max(values)
    const low = min(values)
    return high === null || low === null ? null : high - low
  }
  function finiteMetrics(value) {
    if (Array.isArray(value)) return value.map(finiteMetrics)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, finiteMetrics(item)]))
    return Number.isFinite(Number(value)) ? Number(value) : value === null ? null : value
  }

  function responseLoss(samples, key) {
    if (samples.length < 2) return null
    const split = Math.max(1, Math.floor(samples.length / 2))
    const before = max(samples.slice(0, split).map(sample => abs(sample[key])))
    const after = max(samples.slice(split).map(sample => abs(sample[key])))
    return before === null || after === null ? null : before - after
  }

  function detectFrontScrub(samples, thresholds) {
    const first = samples[0]
    const last = samples[samples.length - 1]
    const steerGrowth = abs(last.steerMagnitude) - abs(first.steerMagnitude)
    const frontSlipRise = (n(last.frontSlip, 0) - n(first.frontSlip, 0))
    const peakFrontSlip = max(samples.map(sample => n(sample.frontSlip, 0)), 0)
    const lateralLoss = responseLoss(samples, 'lateralResponse')
    const yawLoss = responseLoss(samples, 'yawRate')
    const action = steerGrowth >= thresholds.frontSteerGrowth || max(samples.map(sample => n(sample.steerRate, 0)), 0) >= thresholds.frontSteerGrowth
    const actionIndex = samples.findIndex((sample, index) => index > 0 && (n(sample.steerRate, 0) >= thresholds.frontSteerGrowth || abs(sample.steerMagnitude) - abs(samples[0].steerMagnitude) >= thresholds.frontSteerGrowth))
    const slipIndex = samples.findIndex(sample => n(sample.frontSlip, 0) - n(first.frontSlip, 0) >= thresholds.frontSlipRise)
    const ordered = actionIndex >= 0 && slipIndex >= 0 && actionIndex <= slipIndex
    const triggered = action && ordered && peakFrontSlip >= thresholds.frontSlipLimit && ((lateralLoss ?? -Infinity) >= thresholds.frontLateralLoss || (yawLoss ?? -Infinity) >= thresholds.frontYawLoss)
    const throttleRise = slipIndex >= 0 ? max(samples.slice(0, slipIndex + 1).map(sample => n(sample.throttle, 0)), 0) - n(first.throttle, 0) : 0
    const confounders = triggered && throttleRise >= thresholds.frontThrottleRiseMax ? ['throttle_rise'] : []
    const marginConfidence = average([
      clamp((steerGrowth - thresholds.frontSteerGrowth) / 0.15),
      clamp((peakFrontSlip - thresholds.frontSlipLimit) / 0.3),
      clamp(max([(lateralLoss ?? 0) / thresholds.frontLateralLoss, (yawLoss ?? 0) / thresholds.frontYawLoss]) - 1)
    ], 0)
    const confidence = triggered ? 0.84 + 0.16 * marginConfidence : 0.84 * marginConfidence
    const severity = clamp(average([(peakFrontSlip - thresholds.frontSlipLimit) / 0.4, (lateralLoss ?? 0) / 3], 0))
    return {
      triggered,
      inputCausality: ordered && max([lateralLoss, yawLoss], 0) >= 0 ? 0.9 : 0.35,
      detectorConfidence: clamp(confidence),
      severity,
      confounders,
      metrics: { steerGrowth, frontSlipRise, peakFrontSlip, lateralResponseLoss: lateralLoss, yawResponseLoss: yawLoss, responseLoss: max([lateralLoss, yawLoss], 0), throttleRise }
    }
  }

  function detectWheelspin(samples, thresholds) {
    const first = samples[0]
    const last = samples[samples.length - 1]
    const throttleGrowth = n(last.throttle, 0) - n(first.throttle, 0)
    const slipPeak = max(samples.map(sample => sample.drivenSlip), 0)
    const slipRise = n(last.drivenSlip, 0) - n(first.drivenSlip, 0)
    const accelerationPeak = max(samples.map(sample => sample.effectiveAcceleration))
    const input = throttleGrowth >= 0.03 || max(samples.map(sample => n(sample.throttleRate, 0)), 0) >= 0.15
    const slip = slipPeak >= thresholds.wheelspinSlip || slipRise >= thresholds.wheelspinSlipRise
    const weakResponse = accelerationPeak === null || accelerationPeak <= thresholds.wheelspinAccelerationMax
    const actionIndex = samples.findIndex((sample, index) => index > 0 && (n(sample.throttleRate, 0) >= 0.15 || n(sample.throttle, 0) - n(first.throttle, 0) >= 0.03))
    const slipIndex = samples.findIndex(sample => n(sample.drivenSlip, 0) >= thresholds.wheelspinSlip || n(sample.drivenSlip, 0) - n(first.drivenSlip, 0) >= thresholds.wheelspinSlipRise)
    const ordered = actionIndex >= 0 && slipIndex >= 0 && actionIndex <= slipIndex
    const triggered = input && slip && ordered && weakResponse
    const marginConfidence = average([
      clamp((throttleGrowth - 0.03) / 0.4),
      clamp((slipPeak - thresholds.wheelspinSlip) / 0.25),
      accelerationPeak === null ? 0.55 : clamp((thresholds.wheelspinAccelerationMax - accelerationPeak + 0.2) / 1.5)
    ], 0)
    const confidence = triggered ? 0.84 + 0.16 * marginConfidence : 0.84 * marginConfidence
    return {
      triggered,
      inputCausality: ordered ? 0.9 : 0.35,
      detectorConfidence: clamp(confidence),
      severity: clamp(average([slipPeak / 0.35, Math.max(0, thresholds.wheelspinAccelerationMax - (accelerationPeak ?? thresholds.wheelspinAccelerationMax)) / 2], 0)),
      confounders: [],
      metrics: { throttleGrowth, drivenSlipPeak: slipPeak, drivenSlipRise: slipRise, effectiveAccelerationPeak: accelerationPeak }
    }
  }

  function detectBrakeSteering(samples, thresholds) {
    const maxBrake = max(samples.map(sample => sample.brake), 0)
    const maxSteer = max(samples.map(sample => sample.steerMagnitude), 0)
    const maxCombined = max(samples.map(sample => sample.frontCombinedSlip), 0)
    const lateralLoss = responseLoss(samples, 'lateralResponse')
    const yawLoss = responseLoss(samples, 'yawRate')
    const responseLossValue = max([lateralLoss, yawLoss], 0)
    const overlap = maxBrake >= thresholds.overloadBrakeMin && maxSteer >= thresholds.overloadSteerMin
    const triggered = overlap && maxCombined >= thresholds.overloadCombinedSlip && responseLossValue >= thresholds.overloadResponseLoss
    const marginConfidence = average([
      clamp((maxBrake - thresholds.overloadBrakeMin) / 0.6),
      clamp((maxSteer - thresholds.overloadSteerMin) / 0.55),
      clamp((maxCombined - thresholds.overloadCombinedSlip) / 0.6),
      clamp((responseLossValue - thresholds.overloadResponseLoss) / 0.2)
    ], 0)
    const confidence = triggered ? 0.84 + 0.16 * marginConfidence : 0.84 * marginConfidence
    return {
      triggered,
      inputCausality: overlap && responseLossValue >= 0 ? 0.88 : 0.35,
      detectorConfidence: clamp(confidence),
      severity: clamp(average([maxCombined / 1.2, responseLossValue / 0.3], 0)),
      confounders: [],
      metrics: { maxBrake, maxSteer, maxFrontCombinedSlip: maxCombined, lateralResponseLoss: lateralLoss, yawResponseLoss: yawLoss, responseLoss: responseLossValue }
    }
  }

  function detectAbruptRelease(opportunity, thresholds) {
    const samples = opportunity.samples
    const first = samples[0]
    const previous = opportunity.preTriggerSample || {}
    const releaseRate = max(samples.map(sample => Math.abs(Math.min(0, n(sample.brakeRate, 0)))), 0)
    const previousBrake = Math.max(n(previous.brake, 0), n(first.brake, 0))
    const lateralLoss = responseLoss(samples, 'lateralResponse')
    const yawLoss = responseLoss(samples, 'yawRate')
    const rearSlipRise = n(samples[samples.length - 1]?.rearSlip, 0) - n(previous.rearSlip, n(first.rearSlip, 0))
    const triggered = previousBrake >= 0.35 && releaseRate >= thresholds.releaseRate && (
      (lateralLoss ?? 0) >= thresholds.releaseResponseLoss && (yawLoss ?? 0) >= thresholds.releaseYawLoss
      || rearSlipRise >= thresholds.releaseRearSlipRise
    )
    const marginConfidence = average([
      clamp((releaseRate - thresholds.releaseRate) / 3),
      clamp(((lateralLoss ?? 0) - thresholds.releaseResponseLoss) / 0.3),
      clamp(((yawLoss ?? 0) - thresholds.releaseYawLoss) / 0.35),
      clamp((rearSlipRise - thresholds.releaseRearSlipRise) / 0.2)
    ], 0)
    const confidence = triggered ? 0.84 + 0.16 * marginConfidence : 0.84 * marginConfidence
    return {
      triggered,
      inputCausality: releaseRate >= thresholds.releaseRate ? 0.92 : 0.3,
      detectorConfidence: clamp(confidence),
      severity: clamp(average([releaseRate / 4, (lateralLoss ?? 0) / 0.4, (yawLoss ?? 0) / 0.45, rearSlipRise / 0.25], 0)),
      confounders: [],
      metrics: { releaseRate, previousBrake, lateralResponseLoss: lateralLoss, yawResponseLoss: yawLoss, rearSlipRise }
    }
  }

  function detectOpportunity(opportunity, options = {}) {
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) }
    if (!opportunity || opportunity.valid !== true) return { outcome: 'incomplete', detectorConfidence: 0, attributionConfidence: 0, severity: 0, metrics: {}, confounders: ['invalid_opportunity'] }
    const samples = Array.isArray(opportunity.samples) ? opportunity.samples : []
    if (samples.length < 2) return { outcome: 'incomplete', detectorConfidence: 0, attributionConfidence: 0, severity: 0, metrics: {}, confounders: ['insufficient_samples'] }
    const detection = opportunity.type === TYPES.FRONT_SCRUB
      ? detectFrontScrub(samples, thresholds)
      : opportunity.type === TYPES.EXIT_WHEELSPIN
        ? detectWheelspin(samples, thresholds)
        : opportunity.type === TYPES.BRAKE_STEERING_OVERLOAD
          ? detectBrakeSteering(samples, thresholds)
          : detectAbruptRelease(opportunity, thresholds)
    const surfaceConfounders = samples.some(sample => sample.surfaceDisturbed === true || sample.rumbleContact === true || n(sample.puddleDepth, 0) > 0 || sample.suspensionFullyExtended === true)
      ? ['surface_disturbance'] : []
    const confounders = [...(detection.confounders || []), ...surfaceConfounders]
    if (confounders.length) return { outcome: 'ambiguous', detectorConfidence: detection.detectorConfidence, attributionConfidence: 0.2, severity: detection.severity, metrics: finiteMetrics(detection.metrics), confounders }
    const cleanMatches = Array.isArray(options.cleanCounterexamples) ? options.cleanCounterexamples : []
    const sameContext = cleanMatches.filter(candidate => candidate.context?.carIdentity === opportunity.context?.carIdentity && candidate.context?.speedBin === opportunity.context?.speedBin && candidate.context?.gear === opportunity.context?.gear)
    const sameCar = cleanMatches.filter(candidate => candidate.context?.carIdentity === opportunity.context?.carIdentity)
    const counterexampleSupport = sameContext.length ? 1 : sameCar.length ? 0.78 : 0.35
    const contextQuality = opportunity.context?.carIdentity && opportunity.context?.speedBin !== null ? 1 : 0.62
    const attributionConfidence = Math.min(detection.inputCausality, counterexampleSupport, contextQuality)
    let outcome = 'clean'
    if (detection.triggered && detection.detectorConfidence >= thresholds.minDetectorConfidence && attributionConfidence >= thresholds.minAttributionConfidence) outcome = 'problem'
    else if (detection.triggered || detection.detectorConfidence >= 0.65) outcome = 'ambiguous'
    return {
      opportunityId: opportunity.id,
      type: opportunity.type,
      maneuverId: opportunity.maneuverId,
      outcome,
      detectorConfidence: clamp(detection.detectorConfidence),
      attributionConfidence: clamp(attributionConfidence),
      severity: clamp(detection.severity),
      primary: true,
      metrics: finiteMetrics(detection.metrics),
      confounders,
      counterexampleCount: sameContext.length || sameCar.length
    }
  }

  function analyzeOpportunities(opportunities, options = {}) {
    const list = Array.isArray(opportunities) ? opportunities : []
    const initial = list.map(opportunity => ({ opportunity, result: detectOpportunity(opportunity, options) }))
    const clean = initial.filter(item => item.result.outcome === 'clean').map(item => item.opportunity)
    const analyzed = list.map(opportunity => {
      const result = detectOpportunity(opportunity, { ...options, cleanCounterexamples: clean.filter(candidate => candidate.type === opportunity.type) })
      return {
        ...result,
        opportunityId: opportunity.id,
        type: opportunity.type,
        maneuverId: opportunity.maneuverId,
        startedAtMs: opportunity.startedAtMs,
        endedAtMs: opportunity.endedAtMs
      }
    })
    return suppressSecondaryEvidence(analyzed)
  }

  const CAUSAL_PRIORITY = Object.freeze([
    TYPES.ABRUPT_BRAKE_RELEASE,
    TYPES.BRAKE_STEERING_OVERLOAD,
    TYPES.FRONT_SCRUB,
    TYPES.EXIT_WHEELSPIN
  ])

  function suppressSecondaryEvidence(evidence) {
    const byManeuver = new Map()
    for (const item of evidence) {
      if (!byManeuver.has(item.maneuverId)) byManeuver.set(item.maneuverId, [])
      byManeuver.get(item.maneuverId).push(item)
    }
    return evidence.map(item => {
      if (item.outcome !== 'problem') return { ...item, primary: false }
      const peers = byManeuver.get(item.maneuverId) || []
      const problemPeers = peers.filter(peer => {
        if (peer.outcome !== 'problem') return false
        const leftStart = n(item.startedAtMs, null)
        const leftEnd = n(item.endedAtMs, leftStart)
        const rightStart = n(peer.startedAtMs, null)
        const rightEnd = n(peer.endedAtMs, rightStart)
        if (leftStart === null || rightStart === null) return true
        return rightStart <= leftEnd + 500 && leftStart <= rightEnd + 500
      })
      const best = problemPeers.slice().sort((left, right) => CAUSAL_PRIORITY.indexOf(left.type) - CAUSAL_PRIORITY.indexOf(right.type))[0]
      const primary = !best || best.type === item.type
      return { ...item, primary }
    })
  }

  return { CAUSAL_PRIORITY, DEFAULT_THRESHOLDS, detectOpportunity, analyzeOpportunities, suppressSecondaryEvidence, TYPES }
}))

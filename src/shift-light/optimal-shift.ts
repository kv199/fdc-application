import type { Telemetry } from './telemetry'

/** Bump when persisted learning facts become semantically incompatible. */
export const SHIFT_LIGHT_LEARNING_VERSION = 3

export type ShiftLearningOutcome = 'better' | 'rpm_ceiling' | 'too_early' | 'invalid'
export type ShiftLearningReason = 'POWER_CROSSOVER' | 'RPM_CEILING' | 'TOO_EARLY' | 'INVALID'
export type ShiftLearningStatus = 'learning' | 'confirming' | 'optimal'

export interface PowerBinState {
  rpmBucket: number
  sampleCount: number
  medianPower: number
  medianTorque: number | null
  medianSpeed: number | null
  powerSum: number
  torqueSum: number
  torqueSampleCount: number
  speedSum: number
  speedSampleCount: number
}

export interface ShiftEvidenceState {
  sourceGear: number
  destinationGear: number
  beforeTimestampMs: number
  afterTimestampMs: number
  beforeRpm: number
  afterRpm: number
  beforePower: number
  afterPower: number
  beforeTorque: number | null
  afterTorque: number | null
  beforeSpeedKmh: number
  afterSpeedKmh: number
  /** Host materialization aliases retained in the JSON contract. */
  beforeSpeed: number
  afterSpeed: number
  outcome: ShiftLearningOutcome
  reason: ShiftLearningReason
}

export interface GearLearningState {
  sourceGear: number
  status: ShiftLearningStatus
  targetRpm: number | null
  candidateRpm: number | null
  confirmingRpms: number[]
  confirmingCount: number
  replacementCandidateRpm: number | null
  replacementConfirmingRpms: number[]
  targetContradicted: boolean
  lastReason: string | null
  powerBins: PowerBinState[]
  evidence: ShiftEvidenceState[]
}

/** Plain JSON contract persisted by the host; no in-progress pull is included. */
export interface ShiftLightLearningState {
  modelVersion: number
  version: number
  key: string
  /** Clean limiter peaks learned for this vehicle/configuration. */
  ceilingSamples: number[]
  /** Median of the trusted limiter peaks, or null until enough agree. */
  usableCeiling: number | null
  gears: GearLearningState[]
}

export interface OptimalShiftEstimate {
  gear: number
  shiftRpm: number
  evidence: number
}

export interface OptimalShiftDiagnostics {
  gear: number
  powerCurveCoverage: number
  powerBinCount: number
  peakPowerRpm: number | null
  currentRatio: number | null
  nextRatio: number | null
  ratioDrop: number | null
  currentRatioSamples: number
  nextRatioSamples: number
  targetRpm: number | null
  postShiftRpm: number | null
  powerAtTarget: number | null
  powerAfterShift: number | null
  estimateEvidence: number
  status: ShiftLearningStatus
  confirmingCount: number
  lastReason: string | null
  evidenceCount: number
}

export interface ShiftTransitionObservation {
  sourceGear: number
  destinationGear: number
  before: Telemetry
  after: Telemetry
}

const FORWARD_GEAR_MIN = 1
const FORWARD_GEAR_MAX = 10
const POWER_BIN_RPM = 200
const MAX_POWER_BINS_PER_GEAR = 64
const MAX_POWER_SAMPLES_PER_BIN = 24
const MAX_SHIFT_EVIDENCE_PER_GEAR = 32
const MAX_CONFIRMATIONS = 3
const CONFIRMATION_STABILITY_RPM = 100
const MIN_SPEED_KMH = 1
const RPM_CEILING_MARGIN_RPM = 100
const RPM_CEILING_MAX_OVERSHOOT_RPM = 100
const MIN_LIMITER_RISE_RPM = 100
const MIN_LIMITER_DROP_RPM = 40
const LIMITER_RECOVERY_TOLERANCE_RPM = 60
const MAX_CEILING_SAMPLES = 3
const MIN_TRUSTED_CEILING_SAMPLES = 3
const CEILING_SAMPLE_STABILITY_RPM = 100
const MAX_CLEAN_TIMESTAMP_GAP_MS = 1000

interface LimiterTracker {
  gear: number
  startRpm: number
  peakRpm: number
  phase: 'rising' | 'falling'
}

function isForwardGear(gear: number): boolean {
  return Number.isInteger(gear) && gear >= FORWARD_GEAR_MIN && gear <= FORWARD_GEAR_MAX
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function roundRpm(value: number): number {
  return Math.max(0, Math.round(value))
}

function finiteInRange(value: unknown, minimum: number, maximum: number): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null
}

function cleanWotMotionTelemetry(telemetry: Telemetry): boolean {
  if (telemetry.isRaceOn === false) return false
  if (!Number.isFinite(telemetry.throttle) || telemetry.throttle < 0.95) return false
  if (!Number.isFinite(telemetry.clutch) || telemetry.clutch > 0.05) return false
  if (Number.isFinite(telemetry.brake) && telemetry.brake > 0.02) return false
  if (Number.isFinite(telemetry.handBrake) && telemetry.handBrake > 0.02) return false
  if (!isForwardGear(telemetry.gear) || !finitePositive(telemetry.rpm)) return false
  if (!finitePositive(telemetry.speedKmh)) return false

  const slip = telemetry.combinedSlip
  if (slip) {
    const driven = telemetry.car.drivetrain === 0
      ? [slip.fl, slip.fr]
      : telemetry.car.drivetrain === 1
        ? [slip.rl, slip.rr]
        : [slip.fl, slip.fr, slip.rl, slip.rr]
    if (driven.some(value => Number.isFinite(value) && Math.abs(value) > 0.2)) return false
  }
  return true
}

function cleanPowerTelemetry(telemetry: Telemetry): boolean {
  return cleanWotMotionTelemetry(telemetry) && finitePositive(telemetry.power)
}

/** The same clean filter is used for power bins and completed shift evidence. */
export function isCleanShiftEvidence(telemetry: Telemetry): boolean {
  return cleanPowerTelemetry(telemetry)
}

function emptyGear(sourceGear: number): GearLearningState {
  return {
    sourceGear,
    status: 'learning',
    targetRpm: null,
    candidateRpm: null,
    confirmingRpms: [],
    confirmingCount: 0,
    replacementCandidateRpm: null,
    replacementConfirmingRpms: [],
    targetContradicted: false,
    lastReason: null,
    powerBins: [],
    evidence: []
  }
}

function cloneGear(state: GearLearningState): GearLearningState {
  return {
    sourceGear: state.sourceGear,
    status: state.status,
    targetRpm: state.targetRpm,
    candidateRpm: state.candidateRpm,
    confirmingRpms: [...state.confirmingRpms],
    confirmingCount: state.confirmingCount,
    replacementCandidateRpm: state.replacementCandidateRpm,
    replacementConfirmingRpms: [...state.replacementConfirmingRpms],
    targetContradicted: state.targetContradicted,
    lastReason: state.lastReason,
    powerBins: state.powerBins.map(bin => ({ ...bin })),
    evidence: state.evidence.map(item => ({ ...item }))
  }
}

function normalizePowerBin(value: unknown): PowerBinState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const rpmBucket = finiteInRange(raw.rpmBucket, 0, 100_000)
  const sampleCount = finiteInRange(raw.sampleCount, 0, MAX_POWER_SAMPLES_PER_BIN)
  const powerSum = finiteInRange(raw.powerSum, 0, Number.MAX_SAFE_INTEGER)
  const torqueSum = finiteInRange(raw.torqueSum, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  const torqueSampleCount = finiteInRange(raw.torqueSampleCount, 0, MAX_POWER_SAMPLES_PER_BIN)
  const speedSum = finiteInRange(raw.speedSum, 0, Number.MAX_SAFE_INTEGER)
  const speedSampleCount = finiteInRange(raw.speedSampleCount, 0, MAX_POWER_SAMPLES_PER_BIN)
  if (rpmBucket === null || sampleCount === null || powerSum === null || torqueSum === null
    || torqueSampleCount === null || speedSum === null || speedSampleCount === null) return null
  return {
    rpmBucket: roundRpm(rpmBucket),
    sampleCount: Math.round(sampleCount),
    medianPower: sampleCount > 0 ? powerSum / sampleCount : 0,
    medianTorque: torqueSampleCount > 0 ? torqueSum / torqueSampleCount : null,
    medianSpeed: speedSampleCount > 0 ? speedSum / speedSampleCount : null,
    powerSum,
    torqueSum,
    torqueSampleCount: Math.round(torqueSampleCount),
    speedSum,
    speedSampleCount: Math.round(speedSampleCount)
  }
}

function normalizeEvidence(value: unknown, sourceGear: number): ShiftEvidenceState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const destinationGear = finiteInRange(raw.destinationGear, sourceGear + 1, FORWARD_GEAR_MAX)
  const beforeTimestampMs = finiteInRange(raw.beforeTimestampMs, 0, Number.MAX_SAFE_INTEGER)
  const afterTimestampMs = finiteInRange(raw.afterTimestampMs, 0, Number.MAX_SAFE_INTEGER)
  const beforeRpm = finiteInRange(raw.beforeRpm, 0, 100_000)
  const afterRpm = finiteInRange(raw.afterRpm, 0, 100_000)
  const beforePower = finiteInRange(raw.beforePower, 0, Number.MAX_SAFE_INTEGER)
  const afterPower = finiteInRange(raw.afterPower, 0, Number.MAX_SAFE_INTEGER)
  const beforeSpeedKmh = finiteInRange(raw.beforeSpeedKmh, MIN_SPEED_KMH, 2_000)
  const afterSpeedKmh = finiteInRange(raw.afterSpeedKmh, MIN_SPEED_KMH, 2_000)
  if (destinationGear === null || beforeTimestampMs === null || afterTimestampMs === null
    || beforeRpm === null || afterRpm === null || beforePower === null || afterPower === null
    || beforeSpeedKmh === null || afterSpeedKmh === null) return null
  const outcome = raw.outcome
  if (outcome !== 'better' && outcome !== 'rpm_ceiling' && outcome !== 'too_early' && outcome !== 'invalid') return null
  const beforeTorque = raw.beforeTorque === null ? null : finiteInRange(raw.beforeTorque, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  const afterTorque = raw.afterTorque === null ? null : finiteInRange(raw.afterTorque, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  return {
    sourceGear,
    destinationGear: Math.round(destinationGear),
    beforeTimestampMs,
    afterTimestampMs,
    beforeRpm,
    afterRpm,
    beforePower,
    afterPower,
    beforeTorque,
    afterTorque,
    beforeSpeedKmh,
    afterSpeedKmh,
    beforeSpeed: beforeSpeedKmh,
    afterSpeed: afterSpeedKmh,
    outcome,
    reason: normalizeReason(raw.reason, outcome)
  }
}

function normalizeReason(value: unknown, outcome: ShiftLearningOutcome): ShiftLearningReason {
  if ((outcome === 'better' && value === 'POWER_CROSSOVER')
    || (outcome === 'rpm_ceiling' && value === 'RPM_CEILING')
    || (outcome === 'too_early' && value === 'TOO_EARLY')
    || (outcome === 'invalid' && value === 'INVALID')) return value
  return outcome === 'better' ? 'POWER_CROSSOVER'
    : outcome === 'rpm_ceiling' ? 'RPM_CEILING'
      : outcome === 'too_early' ? 'TOO_EARLY' : 'INVALID'
}

/**
 * Accumulates bounded, per-source-gear facts and derives a target only from
 * completed clean real upshifts. The only redline-related learning is a
 * separately confirmed physical limiter ceiling; rpmMax is never consulted.
 */
export class OptimalShiftEstimator {
  private readonly gears = new Map<number, GearLearningState>()
  private ceilingSamples: number[] = []
  private usableCeiling: number | null = null
  private limiterTracker: LimiterTracker | null = null
  private lastCleanTelemetry: Telemetry | null = null
  private limiterRearmed = true

  ingest(telemetry: Telemetry): void {
    this.observeLimiter(telemetry)
    if (!cleanPowerTelemetry(telemetry)) return
    const state = this.getOrCreate(telemetry.gear)
    const rpmBucket = Math.round(telemetry.rpm / POWER_BIN_RPM) * POWER_BIN_RPM
    let bin = state.powerBins.find(candidate => candidate.rpmBucket === rpmBucket)
    if (!bin) {
      if (state.powerBins.length >= MAX_POWER_BINS_PER_GEAR) {
        state.powerBins.sort((left, right) => left.rpmBucket - right.rpmBucket)
        state.powerBins.shift()
      }
      bin = {
        rpmBucket,
        sampleCount: 0,
        medianPower: 0,
        medianTorque: null,
        medianSpeed: null,
        powerSum: 0,
        torqueSum: 0,
        torqueSampleCount: 0,
        speedSum: 0,
        speedSampleCount: 0
      }
      state.powerBins.push(bin)
    }
    if (bin.sampleCount >= MAX_POWER_SAMPLES_PER_BIN) return
    bin.sampleCount += 1
    bin.powerSum += telemetry.power
    bin.speedSum += telemetry.speedKmh
    bin.speedSampleCount += 1
    if (Number.isFinite(telemetry.torque)) {
      bin.torqueSum += telemetry.torque!
      bin.torqueSampleCount += 1
    }
    bin.medianPower = bin.powerSum / bin.sampleCount
    bin.medianTorque = bin.torqueSampleCount > 0 ? bin.torqueSum / bin.torqueSampleCount : null
    bin.medianSpeed = bin.speedSampleCount > 0 ? bin.speedSum / bin.speedSampleCount : null
  }

  /** Record a completed Gx→Gx+1 observation, including rejected observations. */
  observeTransition(observation: ShiftTransitionObservation): ShiftEvidenceState | null {
    const { sourceGear, destinationGear, before, after } = observation
    if (!isForwardGear(sourceGear) || destinationGear !== sourceGear + 1) return null
    const valid = cleanPowerTelemetry(before) && cleanPowerTelemetry(after)
      && before.timestampMs <= after.timestampMs
    const forceImproved = after.power / after.speedKmh > before.power / before.speedKmh
    const outcome: ShiftLearningOutcome = !valid
      ? 'invalid'
      : forceImproved ? 'better'
        : this.isAtUsableCeiling(before.rpm) ? 'rpm_ceiling' : 'too_early'
    const reason: ShiftLearningReason = !valid
      ? 'INVALID'
      : forceImproved ? 'POWER_CROSSOVER'
        : this.isAtUsableCeiling(before.rpm) ? 'RPM_CEILING' : 'TOO_EARLY'
    const evidence: ShiftEvidenceState = {
      sourceGear,
      destinationGear,
      beforeTimestampMs: before.timestampMs,
      afterTimestampMs: after.timestampMs,
      beforeRpm: roundRpm(before.rpm),
      afterRpm: roundRpm(after.rpm),
      beforePower: before.power,
      afterPower: after.power,
      beforeTorque: Number.isFinite(before.torque) ? before.torque : null,
      afterTorque: Number.isFinite(after.torque) ? after.torque : null,
      beforeSpeedKmh: before.speedKmh,
      afterSpeedKmh: after.speedKmh,
      beforeSpeed: before.speedKmh,
      afterSpeed: after.speedKmh,
      outcome,
      reason
    }
    const state = this.getOrCreate(sourceGear)
    state.evidence.push(evidence)
    if (state.evidence.length > MAX_SHIFT_EVIDENCE_PER_GEAR) state.evidence.shift()
    this.applyOutcome(state, evidence)
    return { ...evidence }
  }

  getState(gear: number): GearLearningState | null {
    const state = this.gears.get(gear)
    return state ? cloneGear(state) : null
  }

  getStates(): GearLearningState[] {
    return [...this.gears.values()].sort((left, right) => left.sourceGear - right.sourceGear).map(cloneGear)
  }

  serializeLearningState(key: string): ShiftLightLearningState {
    return {
      modelVersion: SHIFT_LIGHT_LEARNING_VERSION,
      version: SHIFT_LIGHT_LEARNING_VERSION,
      key,
      ceilingSamples: [...this.ceilingSamples],
      usableCeiling: this.usableCeiling,
      gears: this.getStates()
    }
  }

  importLearningState(state: unknown, key: string): boolean {
    if (!state || typeof state !== 'object') return false
    const raw = state as Record<string, unknown>
    const modelVersion = raw.modelVersion ?? raw.version
    if (modelVersion !== SHIFT_LIGHT_LEARNING_VERSION || raw.key !== key || !Array.isArray(raw.gears)) return false
    const restored = new Map<number, GearLearningState>()
    const ceilingSamples = this.normalizeCeilingSamples(raw.ceilingSamples)
    for (const candidate of raw.gears.slice(0, FORWARD_GEAR_MAX)) {
      if (!candidate || typeof candidate !== 'object') continue
      const value = candidate as Record<string, unknown>
      const sourceGear = finiteInRange(value.sourceGear, FORWARD_GEAR_MIN, FORWARD_GEAR_MAX)
      if (sourceGear === null) continue
      const stateValue = emptyGear(Math.round(sourceGear))
      if (value.status === 'learning' || value.status === 'confirming' || value.status === 'optimal') stateValue.status = value.status
      stateValue.targetRpm = finiteInRange(value.targetRpm, 0, 100_000)
      stateValue.candidateRpm = finiteInRange(value.candidateRpm, 0, 100_000)
      stateValue.replacementCandidateRpm = finiteInRange(value.replacementCandidateRpm, 0, 100_000)
      stateValue.targetContradicted = value.targetContradicted === true
      stateValue.confirmingRpms = this.normalizeConfirmations(value.confirmingRpms)
      stateValue.confirmingCount = Math.min(MAX_CONFIRMATIONS, Math.max(0, Math.round(Number(value.confirmingCount ?? stateValue.confirmingRpms.length))))
      stateValue.replacementConfirmingRpms = this.normalizeConfirmations(value.replacementConfirmingRpms)
      stateValue.lastReason = typeof value.lastReason === 'string' ? value.lastReason.slice(0, 160) : null
      if (Array.isArray(value.powerBins)) {
        stateValue.powerBins = value.powerBins.map(normalizePowerBin).filter((bin): bin is PowerBinState => bin !== null).slice(0, MAX_POWER_BINS_PER_GEAR)
      }
      if (Array.isArray(value.evidence)) {
        stateValue.evidence = value.evidence.map(item => normalizeEvidence(item, stateValue.sourceGear)).filter((item): item is ShiftEvidenceState => item !== null).slice(-MAX_SHIFT_EVIDENCE_PER_GEAR)
      }
      restored.set(stateValue.sourceGear, stateValue)
    }
    this.gears.clear()
    for (const [gear, value] of restored) this.gears.set(gear, value)
    this.ceilingSamples = ceilingSamples
    this.usableCeiling = this.deriveUsableCeiling(ceilingSamples)
    return true
  }

  /**
   * Combines persisted completed facts with facts collected while persistence
   * was resolving. Pull state is intentionally absent from both inputs.
   */
  mergeLearningState(state: unknown, key: string): boolean {
    const persisted = new OptimalShiftEstimator()
    if (!persisted.importLearningState(state, key)) return false
    for (const incoming of persisted.getStates()) {
      const current = this.gears.get(incoming.sourceGear)
      if (!current) {
        this.gears.set(incoming.sourceGear, incoming)
        continue
      }
      const preferred = this.statusRank(incoming.status) > this.statusRank(current.status)
        ? incoming : current
      const merged = cloneGear(preferred)
      merged.powerBins = this.mergePowerBins(current.powerBins, incoming.powerBins)
      merged.evidence = this.mergeEvidence(current.evidence, incoming.evidence)
      if (!merged.lastReason) merged.lastReason = current.lastReason ?? incoming.lastReason
      this.gears.set(merged.sourceGear, merged)
    }
    const mergedCeilingSamples = this.normalizeCeilingSamples([
      ...persisted.ceilingSamples,
      ...this.ceilingSamples
    ])
    this.ceilingSamples = mergedCeilingSamples
    this.usableCeiling = this.deriveUsableCeiling(mergedCeilingSamples)
    return true
  }

  /** Compatibility aliases for callers that prefer shorter names. */
  exportState(key: string): ShiftLightLearningState { return this.serializeLearningState(key) }
  importState(state: unknown, key: string): boolean { return this.importLearningState(state, key) }

  diagnose(gear: number): OptimalShiftDiagnostics {
    const state = this.gears.get(gear)
    const bins = state?.powerBins ?? []
    const reliable = bins.filter(bin => bin.sampleCount > 0).sort((left, right) => left.rpmBucket - right.rpmBucket)
    const peak = reliable.reduce<PowerBinState | null>((best, bin) => {
      const power = bin.powerSum / bin.sampleCount
      const bestPower = best ? best.powerSum / best.sampleCount : -Infinity
      return power > bestPower ? bin : best
    }, null)
    const candidate = state?.candidateRpm ?? state?.targetRpm ?? null
    return {
      gear,
      powerCurveCoverage: reliable.length > 0 ? 1 : 0,
      powerBinCount: reliable.length,
      peakPowerRpm: peak?.rpmBucket ?? null,
      currentRatio: null,
      nextRatio: null,
      ratioDrop: null,
      currentRatioSamples: 0,
      nextRatioSamples: 0,
      targetRpm: state?.targetRpm ?? candidate,
      postShiftRpm: null,
      powerAtTarget: candidate === null ? null : this.powerAt(state, candidate),
      powerAfterShift: null,
      estimateEvidence: state?.evidence.filter(item => item.outcome === 'better' || item.outcome === 'rpm_ceiling').length ?? 0,
      status: state?.status ?? 'learning',
      confirmingCount: state?.confirmingRpms.length ?? 0,
      lastReason: state?.lastReason ?? null,
      evidenceCount: state?.evidence.length ?? 0
    }
  }

  reset(): void {
    this.gears.clear()
    this.ceilingSamples = []
    this.usableCeiling = null
    this.resetTransient()
  }
  resetTransient(): void {
    this.limiterTracker = null
    this.lastCleanTelemetry = null
    this.limiterRearmed = true
  }

  getUsableCeiling(): number | null { return this.usableCeiling }
  getCeilingSampleCount(): number { return this.ceilingSamples.length }

  private getOrCreate(gear: number): GearLearningState {
    let state = this.gears.get(gear)
    if (!state) {
      state = emptyGear(gear)
      this.gears.set(gear, state)
    }
    return state
  }

  private applyOutcome(state: GearLearningState, evidence: ShiftEvidenceState): void {
    if (evidence.outcome === 'invalid') {
      state.lastReason = 'Last shift was not usable: throttle, controls, speed or wheel slip was invalid.'
      return
    }
    if (evidence.outcome === 'too_early') {
      state.lastReason = 'Last clean shift was too early: the next gear produced less wheel force.'
      if (state.status === 'optimal' && state.targetRpm !== null
        && Math.abs(evidence.beforeRpm - state.targetRpm) <= CONFIRMATION_STABILITY_RPM) {
        // A single contradictory pull must never blank a working target. It
        // only arms replacement learning; the current target remains active.
        state.targetContradicted = true
        state.replacementCandidateRpm = null
        state.replacementConfirmingRpms = []
      }
      return
    }

    state.lastReason = evidence.outcome === 'rpm_ceiling'
      ? 'Engine RPM ceiling reached; no stronger next-gear crossover was found.'
      : null
    if (state.status === 'optimal') {
      if (!state.targetContradicted || state.targetRpm === null || evidence.beforeRpm <= state.targetRpm) return
      if (state.replacementCandidateRpm === null) {
        state.replacementCandidateRpm = evidence.beforeRpm
        state.replacementConfirmingRpms = [evidence.beforeRpm]
        return
      }
      const replacementValues = [...state.replacementConfirmingRpms, evidence.beforeRpm]
      if (Math.max(...replacementValues) - Math.min(...replacementValues) > CONFIRMATION_STABILITY_RPM) {
        state.replacementCandidateRpm = evidence.beforeRpm
        state.replacementConfirmingRpms = [evidence.beforeRpm]
        return
      }
      state.replacementConfirmingRpms = replacementValues.slice(-MAX_CONFIRMATIONS)
      if (state.replacementConfirmingRpms.length >= MAX_CONFIRMATIONS) {
        state.targetRpm = Math.min(...state.replacementConfirmingRpms)
        state.candidateRpm = state.targetRpm
        state.confirmingRpms = [...state.replacementConfirmingRpms]
        state.confirmingCount = MAX_CONFIRMATIONS
        state.replacementCandidateRpm = null
        state.replacementConfirmingRpms = []
        state.targetContradicted = false
      }
      return
    }
    if (state.candidateRpm === null) {
      state.candidateRpm = evidence.beforeRpm
      state.confirmingRpms = [evidence.beforeRpm]
      state.confirmingCount = 1
      state.status = 'confirming'
      return
    }
    const values = [...state.confirmingRpms, evidence.beforeRpm]
    if (Math.max(...values) - Math.min(...values) > CONFIRMATION_STABILITY_RPM) {
      state.candidateRpm = evidence.beforeRpm
      state.confirmingRpms = [evidence.beforeRpm]
      state.confirmingCount = 1
      state.status = 'confirming'
      return
    }
    state.confirmingRpms = values.slice(-MAX_CONFIRMATIONS)
    state.confirmingCount = state.confirmingRpms.length
    if (state.confirmingRpms.length >= MAX_CONFIRMATIONS) {
      state.targetRpm = Math.min(...state.confirmingRpms)
      state.candidateRpm = state.targetRpm
      state.status = 'optimal'
    } else {
      state.status = 'confirming'
    }
  }

  private statusRank(status: ShiftLearningStatus): number {
    return status === 'optimal' ? 3 : status === 'confirming' ? 2 : 1
  }

  private mergePowerBins(current: PowerBinState[], incoming: PowerBinState[]): PowerBinState[] {
    const bins = new Map<number, PowerBinState>()
    for (const item of [...incoming, ...current]) {
      const existing = bins.get(item.rpmBucket)
      if (!existing) {
        bins.set(item.rpmBucket, { ...item })
        continue
      }
      const count = Math.min(MAX_POWER_SAMPLES_PER_BIN, existing.sampleCount + item.sampleCount)
      const averagePower = (existing.powerSum + item.powerSum) / Math.max(1, existing.sampleCount + item.sampleCount)
      const torqueCount = Math.min(MAX_POWER_SAMPLES_PER_BIN, existing.torqueSampleCount + item.torqueSampleCount)
      const averageTorque = (existing.torqueSum + item.torqueSum) / Math.max(1, existing.torqueSampleCount + item.torqueSampleCount)
      const speedCount = Math.min(MAX_POWER_SAMPLES_PER_BIN, existing.speedSampleCount + item.speedSampleCount)
      const averageSpeed = (existing.speedSum + item.speedSum) / Math.max(1, existing.speedSampleCount + item.speedSampleCount)
      existing.sampleCount = count
      existing.powerSum = averagePower * count
      existing.medianPower = averagePower
      existing.torqueSampleCount = torqueCount
      existing.torqueSum = averageTorque * torqueCount
      existing.medianTorque = torqueCount > 0 ? averageTorque : null
      existing.speedSampleCount = speedCount
      existing.speedSum = averageSpeed * speedCount
      existing.medianSpeed = speedCount > 0 ? averageSpeed : null
    }
    return [...bins.values()].sort((left, right) => left.rpmBucket - right.rpmBucket).slice(-MAX_POWER_BINS_PER_GEAR)
  }

  private mergeEvidence(current: ShiftEvidenceState[], incoming: ShiftEvidenceState[]): ShiftEvidenceState[] {
    const facts = new Map<string, ShiftEvidenceState>()
    for (const item of [...incoming, ...current]) {
      const key = `${item.sourceGear}:${item.destinationGear}:${item.beforeTimestampMs}:${item.afterTimestampMs}:${item.beforeRpm}`
      facts.set(key, { ...item })
    }
    return [...facts.values()]
      .sort((left, right) => left.afterTimestampMs - right.afterTimestampMs)
      .slice(-MAX_SHIFT_EVIDENCE_PER_GEAR)
  }

  private normalizeConfirmations(value: unknown): number[] {
    if (!Array.isArray(value)) return []
    return value.map(item => finiteInRange(item, 0, 100_000)).filter((item): item is number => item !== null).map(roundRpm).slice(-MAX_CONFIRMATIONS)
  }

  private normalizeCeilingSamples(value: unknown): number[] {
    if (!Array.isArray(value)) return []
    return value
      .map(item => finiteInRange(item, 0, 100_000))
      .filter((item): item is number => item !== null)
      .map(roundRpm)
      .slice(-MAX_CEILING_SAMPLES)
  }

  private deriveUsableCeiling(samples: number[]): number | null {
    if (samples.length < MIN_TRUSTED_CEILING_SAMPLES) return null
    const sorted = [...samples].sort((left, right) => left - right)
    if (sorted[sorted.length - 1]! - sorted[0]! > CEILING_SAMPLE_STABILITY_RPM) return null
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1
      ? sorted[middle]!
      : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
  }

  private isAtUsableCeiling(rpm: number): boolean {
    return this.usableCeiling !== null
      && rpm >= this.usableCeiling - RPM_CEILING_MARGIN_RPM
      && rpm <= this.usableCeiling + RPM_CEILING_MAX_OVERSHOOT_RPM
  }

  /**
   * A ceiling sample requires a clean same-gear WOT pull that rises, drops
   * materially, and recovers near its prior peak. A plain max/plateau is not
   * enough because it can be caused by top speed or a driver lift.
   */
  private observeLimiter(telemetry: Telemetry): void {
    // A real limiter can momentarily cut engine power to zero or below, so the
    // ceiling detector applies the same clean WOT/motion controls without the
    // positive-power requirement used by power bins and shift comparison.
    if (!cleanWotMotionTelemetry(telemetry)) {
      this.resetTransient()
      return
    }
    const previous = this.lastCleanTelemetry
    this.lastCleanTelemetry = telemetry
    if (!previous || previous.gear !== telemetry.gear
      || telemetry.timestampMs < previous.timestampMs
      || telemetry.timestampMs - previous.timestampMs > MAX_CLEAN_TIMESTAMP_GAP_MS) {
      this.limiterRearmed = true
      this.limiterTracker = { gear: telemetry.gear, startRpm: telemetry.rpm, peakRpm: telemetry.rpm, phase: 'rising' }
      return
    }
    // A continuous clean WOT segment is one pull, even if the limiter cuts
    // deeply enough to produce another rise/drop/recovery cycle. Rearm only
    // after a dirty boundary, gear change, or telemetry discontinuity.
    if (!this.limiterRearmed) return
    const tracker = this.limiterTracker
    if (!tracker || tracker.gear !== telemetry.gear) {
      this.limiterTracker = { gear: telemetry.gear, startRpm: previous.rpm, peakRpm: Math.max(previous.rpm, telemetry.rpm), phase: 'rising' }
      return
    }
    if (tracker.phase === 'rising') {
      if (telemetry.rpm >= tracker.peakRpm) {
        tracker.peakRpm = telemetry.rpm
        return
      }
      if (tracker.peakRpm - telemetry.rpm >= MIN_LIMITER_DROP_RPM
        && tracker.peakRpm - tracker.startRpm >= MIN_LIMITER_RISE_RPM) {
        tracker.phase = 'falling'
      }
      return
    }
    if (telemetry.rpm >= tracker.peakRpm - LIMITER_RECOVERY_TOLERANCE_RPM) {
      this.recordCeilingSample(tracker.peakRpm)
      this.limiterRearmed = false
      this.limiterTracker = null
    }
  }

  private recordCeilingSample(sample: number): void {
    const rounded = roundRpm(sample)
    if (this.ceilingSamples.some(existing => Math.abs(existing - rounded) <= RPM_CEILING_MARGIN_RPM)) {
      this.ceilingSamples = [...this.ceilingSamples.filter(existing => Math.abs(existing - rounded) <= RPM_CEILING_MARGIN_RPM), rounded]
        .slice(-MAX_CEILING_SAMPLES)
    } else {
      this.ceilingSamples = [...this.ceilingSamples, rounded].slice(-MAX_CEILING_SAMPLES)
    }
    this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples)
  }

  private powerAt(state: GearLearningState | undefined, rpm: number): number | null {
    if (!state) return null
    const bin = state.powerBins.find(item => item.rpmBucket === Math.round(rpm / POWER_BIN_RPM) * POWER_BIN_RPM)
    return bin && bin.sampleCount > 0 ? bin.powerSum / bin.sampleCount : null
  }
}

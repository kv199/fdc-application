import type { Telemetry } from './telemetry'

/** Persisted facts are intentionally small and incompatible with the old curve learner. */
export const SHIFT_LIGHT_LEARNING_VERSION = 4

export type ShiftLearningOutcome = 'better' | 'not_better'
export type ShiftLearningReason = 'POWER_CROSSOVER' | 'NO_CROSSOVER'
export type ShiftLearningStatus = 'learning' | 'potential' | 'optimal'

export interface ShiftEvidenceState {
  sourceGear: number
  destinationGear: number
  beforeTimestampMs: number
  afterTimestampMs: number
  beforeRpm: number
  afterRpm: number
  beforePower: number
  afterPower: number
  powerDeltaPct: number
  outcome: ShiftLearningOutcome
  reason: ShiftLearningReason
}

export interface GearLearningState {
  sourceGear: number
  destinationGear: number
  status: ShiftLearningStatus
  targetRpm: number | null
  candidateRpm: number | null
  confirmationRpms: number[]
  confirmationCount: number
  lastReason: string | null
  evidence: ShiftEvidenceState[]
}

/** Compact JSON contract persisted by the native host. */
export interface ShiftLightLearningState {
  modelVersion: number
  version: number
  key: string
  reportedRedlineRpm: number | null
  ceilingSamples: number[]
  usableCeiling: number | null
  gearTargets: GearLearningState[]
  shiftSamples: ShiftEvidenceState[]
}

export interface OptimalShiftEstimate { gear: number, shiftRpm: number, evidence: number }

/** Stable diagnostic shape for the settings UI; curve fields are now empty. */
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
  confirmationCount: number
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
const MAX_SHIFT_SAMPLES = 64
const MAX_CONFIRMATIONS = 3
const CONFIRMATION_STABILITY_RPM = 100
const MIN_SPEED_KMH = 1
const MAX_CEILING_SAMPLES = 12
const MIN_TRUSTED_CEILING_SAMPLES = 3
const CEILING_SAMPLE_STABILITY_RPM = 100
const CEILING_MIN_REDLINE_FRACTION = 0.85
const CEILING_WAIT_ABOVE_RPM = 400
// A cluster this large is accepted even with samples just above it, so one stray high
// observation kept among the highest samples cannot block the ceiling forever.
const CEILING_WAIT_RELEASE_SAMPLES = 6
// The engine reaching a higher RPM on clean full throttle proves that a lower observation
// was not a limiter hit. A real first hit sits within about 2% below the limiter, while
// wheelspin peaks that mimic the limiter pattern were 500+ RPM below it.
const FALSE_LIMITER_BELOW_PEAK_RPM = 400
const MIN_LIMITER_RISE_RPM = 100
const MIN_LIMITER_DROP_RPM = 40
const LIMITER_RECOVERY_TOLERANCE_RPM = 60
const MAX_CLEAN_TIMESTAMP_GAP_MS = 1000

interface LimiterTracker { gear: number, startRpm: number, peakRpm: number, phase: 'rising' | 'falling' }

function isForwardGear(gear: number): boolean {
  return Number.isInteger(gear) && gear >= FORWARD_GEAR_MIN && gear <= FORWARD_GEAR_MAX
}
function finitePositive(value: number): boolean { return Number.isFinite(value) && value > 0 }
function roundRpm(value: number): number { return Math.max(0, Math.round(value)) }
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
  return true
}

function cleanPowerTelemetry(telemetry: Telemetry): boolean {
  return cleanWotMotionTelemetry(telemetry) && finitePositive(telemetry.power)
}

/** Public filter used by capture code and integrations. */
export function isCleanShiftEvidence(telemetry: Telemetry): boolean { return cleanPowerTelemetry(telemetry) }

function emptyGear(sourceGear: number, destinationGear = sourceGear + 1): GearLearningState {
  return { sourceGear, destinationGear, status: 'learning', targetRpm: null, candidateRpm: null,
    confirmationRpms: [], confirmationCount: 0, lastReason: null, evidence: [] }
}
function cloneEvidence(item: ShiftEvidenceState): ShiftEvidenceState { return { ...item } }
function cloneGear(state: GearLearningState): GearLearningState {
  return { ...state, confirmationRpms: [...state.confirmationRpms], evidence: state.evidence.map(cloneEvidence) }
}

function normalizeEvidence(value: unknown): ShiftEvidenceState | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const sourceGear = finiteInRange(raw.sourceGear, FORWARD_GEAR_MIN, FORWARD_GEAR_MAX)
  const destinationGear = finiteInRange(raw.destinationGear, FORWARD_GEAR_MIN, FORWARD_GEAR_MAX)
  const beforeTimestampMs = finiteInRange(raw.beforeTimestampMs, 0, Number.MAX_SAFE_INTEGER)
  const afterTimestampMs = finiteInRange(raw.afterTimestampMs, 0, Number.MAX_SAFE_INTEGER)
  const beforeRpm = finiteInRange(raw.beforeRpm, 0, 100_000)
  const afterRpm = finiteInRange(raw.afterRpm, 0, 100_000)
  const beforePower = finiteInRange(raw.beforePower, 0, Number.MAX_SAFE_INTEGER)
  const afterPower = finiteInRange(raw.afterPower, 0, Number.MAX_SAFE_INTEGER)
  const delta = finiteInRange(raw.powerDeltaPct, -100, Number.MAX_SAFE_INTEGER)
  if ([sourceGear, destinationGear, beforeTimestampMs, afterTimestampMs, beforeRpm, afterRpm,
    beforePower, afterPower, delta].some(item => item === null)) return null
  if (beforePower! <= 0 || afterPower! <= 0) return null
  if (Math.round(destinationGear!) !== Math.round(sourceGear!) + 1) return null
  return { sourceGear: Math.round(sourceGear!), destinationGear: Math.round(destinationGear!),
    beforeTimestampMs: beforeTimestampMs!, afterTimestampMs: afterTimestampMs!, beforeRpm: roundRpm(beforeRpm!),
    afterRpm: roundRpm(afterRpm!), beforePower: beforePower!, afterPower: afterPower!, powerDeltaPct: delta!,
    outcome: raw.outcome === 'not_better' || delta! < 0 ? 'not_better' : 'better',
    reason: raw.reason === 'NO_CROSSOVER' || delta! < 0 ? 'NO_CROSSOVER' : 'POWER_CROSSOVER' }
}

function normalizeRpmList(value: unknown): number[] {
  return Array.isArray(value) ? value.map(item => finiteInRange(item, 0, 100_000))
    .filter((item): item is number => item !== null).map(roundRpm).slice(-MAX_CONFIRMATIONS) : []
}
/** Keeps the highest observations, stored in ascending RPM order for determinism. */
function keepHighestCeilingSamples(values: number[]): number[] {
  return [...values].sort((a, b) => b - a).slice(0, MAX_CEILING_SAMPLES).sort((a, b) => a - b)
}
function normalizeCeilingSamples(value: unknown): number[] {
  return Array.isArray(value) ? keepHighestCeilingSamples(value.map(item => finiteInRange(item, 0, 100_000))
    .filter((item): item is number => item !== null).map(roundRpm)) : []
}

export class OptimalShiftEstimator {
  private readonly gears = new Map<number, GearLearningState>()
  private shiftSamples: ShiftEvidenceState[] = []
  private ceilingSamples: number[] = []
  private usableCeiling: number | null = null
  private reportedRedlineRpm: number | null = null
  private limiterTracker: LimiterTracker | null = null
  private lastCleanTelemetry: Telemetry | null = null
  private limiterRearmed = true
  /** Highest clean full-throttle RPM of this run; in memory only, cleared by reset(). */
  private peakWotRpm = 0

  ingest(telemetry: Telemetry): void {
    if (Number.isFinite(telemetry.rpmMax) && telemetry.rpmMax > 0) this.reportedRedlineRpm = roundRpm(telemetry.rpmMax)
    const cleanWot = cleanWotMotionTelemetry(telemetry)
    if (cleanWot && telemetry.gear < FORWARD_GEAR_MAX) this.getOrCreate(telemetry.gear)
    if (cleanWot && telemetry.rpm > this.peakWotRpm) this.raisePeakWotRpm(telemetry.rpm)
    this.observeLimiter(telemetry)
  }

  /** Only completed clean windows are stored; a negative delta is observation, not driver failure. */
  observeTransition(observation: ShiftTransitionObservation): ShiftEvidenceState | null {
    const { sourceGear, destinationGear, before, after } = observation
    if (!isForwardGear(sourceGear) || destinationGear !== sourceGear + 1) return null
    if (!cleanPowerTelemetry(before) || !cleanPowerTelemetry(after) || before.timestampMs > after.timestampMs) return null
    const powerDeltaPct = ((after.power - before.power) / before.power) * 100
    if (!Number.isFinite(powerDeltaPct)) return null
    const evidence: ShiftEvidenceState = { sourceGear, destinationGear, beforeTimestampMs: before.timestampMs,
      afterTimestampMs: after.timestampMs, beforeRpm: roundRpm(before.rpm), afterRpm: roundRpm(after.rpm),
      beforePower: before.power, afterPower: after.power, powerDeltaPct,
      outcome: powerDeltaPct >= 0 ? 'better' : 'not_better', reason: powerDeltaPct >= 0 ? 'POWER_CROSSOVER' : 'NO_CROSSOVER' }
    this.shiftSamples = [...this.shiftSamples, evidence].slice(-MAX_SHIFT_SAMPLES)
    const state = this.getOrCreate(sourceGear, destinationGear)
    state.evidence = [...state.evidence, evidence].slice(-MAX_SHIFT_SAMPLES)
    const baseline = this.usableCeiling ?? this.reportedRedlineRpm
    if (evidence.outcome === 'better' && baseline !== null && evidence.beforeRpm < baseline) this.applyBetterOutcome(state, evidence.beforeRpm)
    return cloneEvidence(evidence)
  }

  getState(gear: number): GearLearningState | null { const state = this.gears.get(gear); return state ? cloneGear(state) : null }
  getStates(): GearLearningState[] { return [...this.gears.values()].sort((a, b) => a.sourceGear - b.sourceGear).map(cloneGear) }
  /** Highest forward gear proven by the learning state: any row's source gear, and the destination of a row with evidence. */
  getHighestKnownGear(): number {
    let highest = 0
    for (const state of this.gears.values()) {
      highest = Math.max(highest, state.sourceGear)
      if (state.evidence.length > 0) highest = Math.max(highest, state.destinationGear)
    }
    return highest
  }

  serializeLearningState(key: string): ShiftLightLearningState {
    return { modelVersion: SHIFT_LIGHT_LEARNING_VERSION, version: SHIFT_LIGHT_LEARNING_VERSION, key,
      reportedRedlineRpm: this.reportedRedlineRpm, ceilingSamples: [...this.ceilingSamples], usableCeiling: this.usableCeiling,
      gearTargets: this.getStates(), shiftSamples: this.shiftSamples.map(cloneEvidence) }
  }

  importLearningState(state: unknown, key: string): boolean {
    if (!state || typeof state !== 'object') return false
    const raw = state as Record<string, unknown>
    const version = raw.modelVersion ?? raw.version
    if (version !== SHIFT_LIGHT_LEARNING_VERSION || raw.key !== key) return false
    const samples = Array.isArray(raw.shiftSamples) ? raw.shiftSamples.map(normalizeEvidence).filter((x): x is ShiftEvidenceState => x !== null) : []
    const restored = new Map<number, GearLearningState>()
    const rawTargets = Array.isArray(raw.gearTargets) ? raw.gearTargets : []
    for (const rawTarget of rawTargets) {
      if (!rawTarget || typeof rawTarget !== 'object') continue
      const item = rawTarget as Record<string, unknown>
      const sourceGear = finiteInRange(item.sourceGear, FORWARD_GEAR_MIN, FORWARD_GEAR_MAX)
      const destinationGear = finiteInRange(item.destinationGear, FORWARD_GEAR_MIN, FORWARD_GEAR_MAX)
      if (sourceGear === null || destinationGear !== sourceGear + 1) continue
      const target = emptyGear(Math.round(sourceGear), Math.round(destinationGear))
      if (item.status === 'potential' || item.status === 'optimal') target.status = item.status
      target.targetRpm = finiteInRange(item.targetRpm, 0, 100_000)
      target.candidateRpm = finiteInRange(item.candidateRpm, 0, 100_000)
      const rawCount = Number(item.confirmationCount ?? 0)
      const persistedCount = Number.isFinite(rawCount)
        ? Math.min(MAX_CONFIRMATIONS, Math.max(0, Math.round(rawCount)))
        : 0
      const targetSamples = samples.filter(sample => sample.sourceGear === target.sourceGear && sample.destinationGear === target.destinationGear && sample.outcome === 'better')
      const explicitRpms = normalizeRpmList(item.confirmationRpms)
      const seed = finiteInRange(item.candidateRpm ?? item.targetRpm, 0, 100_000)
      const candidateRpm = seed ?? targetSamples[targetSamples.length - 1]?.beforeRpm ?? null
      const derivedRpms = candidateRpm === null ? [] : targetSamples.map(sample => sample.beforeRpm).filter(rpm => Math.abs(rpm - candidateRpm) <= CONFIRMATION_STABILITY_RPM).slice(-MAX_CONFIRMATIONS)
      target.confirmationRpms = (explicitRpms.length > 0 ? explicitRpms : derivedRpms).slice(-MAX_CONFIRMATIONS)
      target.confirmationCount = Math.min(MAX_CONFIRMATIONS, Math.max(persistedCount, target.confirmationRpms.length))
      target.lastReason = typeof item.lastReason === 'string' ? item.lastReason.slice(0, 160) : null
      target.evidence = samples.filter(sample => sample.sourceGear === target.sourceGear && sample.destinationGear === target.destinationGear)
      restored.set(target.sourceGear, target)
    }
    this.gears.clear(); restored.forEach((value, gear) => this.gears.set(gear, value))
    this.shiftSamples = samples.slice(-MAX_SHIFT_SAMPLES)
    this.reportedRedlineRpm = finiteInRange(raw.reportedRedlineRpm, 0, 100_000)
    this.ceilingSamples = normalizeCeilingSamples(raw.ceilingSamples)
    this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples)
    return true
  }

  mergeLearningState(state: unknown, key: string): boolean {
    const incoming = new OptimalShiftEstimator()
    if (!incoming.importLearningState(state, key)) return false
    for (const target of incoming.getStates()) {
      const current = this.gears.get(target.sourceGear)
      if (!current) this.gears.set(target.sourceGear, target)
      else if (this.statusRank(target.status) > this.statusRank(current.status)) {
        this.mergeSameRank(target, current)
        this.gears.set(target.sourceGear, target)
      } else this.mergeSameRank(current, target)
    }
    const seen = new Set(this.shiftSamples.map(item => `${item.beforeTimestampMs}:${item.afterTimestampMs}`))
    this.shiftSamples = [...this.shiftSamples, ...incoming.shiftSamples.filter(item => !seen.has(`${item.beforeTimestampMs}:${item.afterTimestampMs}`))].slice(-MAX_SHIFT_SAMPLES)
    this.reportedRedlineRpm = incoming.reportedRedlineRpm ?? this.reportedRedlineRpm
    this.ceilingSamples = normalizeCeilingSamples([...this.ceilingSamples, ...incoming.ceilingSamples])
    this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples)
    return true
  }

  exportState(key: string): ShiftLightLearningState { return this.serializeLearningState(key) }
  importState(state: unknown, key: string): boolean { return this.importLearningState(state, key) }
  diagnose(gear: number): OptimalShiftDiagnostics {
    const state = this.gears.get(gear)
    return { gear, powerCurveCoverage: 0, powerBinCount: 0, peakPowerRpm: null, currentRatio: null, nextRatio: null,
      ratioDrop: null, currentRatioSamples: 0, nextRatioSamples: 0, targetRpm: state?.targetRpm ?? state?.candidateRpm ?? null,
      postShiftRpm: null, powerAtTarget: null, powerAfterShift: null, estimateEvidence: state?.evidence.length ?? 0,
      status: state?.status ?? 'learning', confirmationCount: state?.confirmationCount ?? 0,
      lastReason: state?.lastReason ?? null, evidenceCount: state?.evidence.length ?? 0 }
  }
  reset(): void { this.gears.clear(); this.shiftSamples = []; this.ceilingSamples = []; this.usableCeiling = null; this.reportedRedlineRpm = null; this.peakWotRpm = 0; this.resetTransient() }
  resetTransient(): void { this.limiterTracker = null; this.lastCleanTelemetry = null; this.limiterRearmed = true }
  getUsableCeiling(): number | null { return this.usableCeiling }
  /**
   * Until the usable ceiling is trusted, the highest observation at or above
   * CEILING_MIN_REDLINE_FRACTION of the redline stands in for the limiter, raised to the
   * highest clean full-throttle RPM of this run because the engine cannot exceed its limiter.
   * A first limiter hit is usually within about 2% below the real limiter, and the value only
   * rises during a run. Without an observation there is no provisional ceiling: following
   * the climbing RPM alone would light the cue at every pull. It is a presentation fallback
   * only; learning still uses the trusted ceiling.
   */
  getProvisionalCeiling(fallbackRedlineRpm: number | null = null): number | null {
    const redline = this.reportedRedlineRpm ?? fallbackRedlineRpm
    if (redline === null || !(redline > 0)) return null
    const considered = this.ceilingSamples.filter(sample => sample / redline >= CEILING_MIN_REDLINE_FRACTION)
    return considered.length ? Math.max(...considered, roundRpm(this.peakWotRpm)) : null
  }
  getCeilingSampleCount(): number { return this.ceilingSamples.length }
  /** Size of the highest qualifying cluster, or the largest non-qualifying cluster while no ceiling exists. */
  getCeilingClusterCount(): number { return this.analyzeCeiling(this.ceilingSamples).clusterCount }
  getReportedRedlineRpm(): number | null { return this.reportedRedlineRpm }

  private getOrCreate(sourceGear: number, destinationGear = sourceGear + 1): GearLearningState {
    let state = this.gears.get(sourceGear)
    if (!state) { state = emptyGear(sourceGear, destinationGear); this.gears.set(sourceGear, state) }
    return state
  }
  private applyBetterOutcome(state: GearLearningState, rpm: number): void {
    if (state.status === 'optimal') return
    if (state.candidateRpm === null || Math.abs(rpm - state.candidateRpm) > CONFIRMATION_STABILITY_RPM) {
      state.candidateRpm = rpm; state.confirmationRpms = [rpm]; state.confirmationCount = 1; state.status = 'potential'
    } else {
      state.confirmationRpms = [...state.confirmationRpms, rpm].slice(-MAX_CONFIRMATIONS); state.confirmationCount = state.confirmationRpms.length
    }
    if (state.confirmationCount >= MAX_CONFIRMATIONS) { state.status = 'optimal'; state.targetRpm = this.median(state.confirmationRpms); state.candidateRpm = state.targetRpm }
    state.lastReason = null
  }
  private statusRank(status: ShiftLearningStatus): number { return status === 'optimal' ? 3 : status === 'potential' ? 2 : 1 }
  private median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
  }
  private mergeSameRank(current: GearLearningState, incoming: GearLearningState): void {
    const seen = new Set(current.evidence.map(item => `${item.beforeTimestampMs}:${item.afterTimestampMs}`))
    current.evidence = [...current.evidence, ...incoming.evidence.filter(item => !seen.has(`${item.beforeTimestampMs}:${item.afterTimestampMs}`))].slice(-MAX_SHIFT_SAMPLES)
    const anchor = current.targetRpm ?? current.candidateRpm ?? incoming.targetRpm ?? incoming.candidateRpm
    const confirmations = anchor === null
      ? []
      : current.evidence
        .filter(item => item.outcome === 'better' && Math.abs(item.beforeRpm - anchor) <= CONFIRMATION_STABILITY_RPM)
        .map(item => item.beforeRpm)
        .slice(-MAX_CONFIRMATIONS)
    current.confirmationRpms = confirmations
    current.confirmationCount = Math.max(current.confirmationCount, incoming.confirmationCount, confirmations.length)
    if (current.confirmationCount >= MAX_CONFIRMATIONS && current.status !== 'learning') {
      current.status = 'optimal'
      current.targetRpm = this.median(confirmations)
    }
    current.candidateRpm = current.targetRpm ?? incoming.candidateRpm ?? current.candidateRpm
    current.lastReason = current.lastReason ?? incoming.lastReason
  }
  private deriveUsableCeiling(samples: number[]): number | null { return this.analyzeCeiling(samples).ceiling }
  /**
   * The limiter is the highest RPM the engine can hold, so low false detections never
   * block it. When the reported redline is known, only samples at or above
   * CEILING_MIN_REDLINE_FRACTION of it are considered. Scan from the highest considered
   * sample down: the first cluster (considered samples within CEILING_SAMPLE_STABILITY_RPM
   * at or below an anchor) that holds at least MIN_TRUSTED_CEILING_SAMPLES wins, and its
   * lower-middle value is the ceiling. A considered sample up to CEILING_WAIT_ABOVE_RPM
   * above that anchor means the real limiter is still collecting evidence, so no ceiling
   * is accepted yet, unless the cluster already holds CEILING_WAIT_RELEASE_SAMPLES.
   * Samples further above are isolated spikes and do not block.
   */
  private analyzeCeiling(samples: number[]): { ceiling: number | null, clusterCount: number } {
    const redline = this.reportedRedlineRpm
    const considered = redline !== null && redline > 0
      ? samples.filter(sample => sample / redline >= CEILING_MIN_REDLINE_FRACTION)
      : [...samples]
    const descending = considered.sort((a, b) => b - a)
    const clusterAt = (anchor: number): number[] => descending
      .filter(sample => sample <= anchor && anchor - sample <= CEILING_SAMPLE_STABILITY_RPM)
    const progressCount = descending.length > 0 ? clusterAt(descending[0]!).length : 0
    for (const anchor of descending) {
      const cluster = clusterAt(anchor)
      if (cluster.length < MIN_TRUSTED_CEILING_SAMPLES) continue
      if (cluster.length < CEILING_WAIT_RELEASE_SAMPLES
        && descending.some(sample => sample > anchor && sample - anchor <= CEILING_WAIT_ABOVE_RPM)) {
        return { ceiling: null, clusterCount: progressCount }
      }
      const ascending = [...cluster].reverse()
      return { ceiling: ascending[Math.floor((ascending.length - 1) / 2)]!, clusterCount: cluster.length }
    }
    return { ceiling: null, clusterCount: progressCount }
  }
  private observeLimiter(telemetry: Telemetry): void {
    if (!cleanWotMotionTelemetry(telemetry)) { this.resetTransient(); return }
    const previous = this.lastCleanTelemetry; this.lastCleanTelemetry = telemetry
    if (!previous || previous.gear !== telemetry.gear || telemetry.timestampMs < previous.timestampMs || telemetry.timestampMs - previous.timestampMs > MAX_CLEAN_TIMESTAMP_GAP_MS) {
      this.limiterRearmed = true; this.limiterTracker = { gear: telemetry.gear, startRpm: telemetry.rpm, peakRpm: telemetry.rpm, phase: 'rising' }; return
    }
    if (!this.limiterRearmed) return
    const tracker = this.limiterTracker
    if (!tracker || tracker.gear !== telemetry.gear) { this.limiterTracker = { gear: telemetry.gear, startRpm: previous.rpm, peakRpm: Math.max(previous.rpm, telemetry.rpm), phase: 'rising' }; return }
    if (tracker.phase === 'rising') {
      if (telemetry.rpm >= tracker.peakRpm) { tracker.peakRpm = telemetry.rpm; return }
      if (tracker.peakRpm - telemetry.rpm >= MIN_LIMITER_DROP_RPM && tracker.peakRpm - tracker.startRpm >= MIN_LIMITER_RISE_RPM) tracker.phase = 'falling'
      return
    }
    if (telemetry.rpm >= tracker.peakRpm - LIMITER_RECOVERY_TOLERANCE_RPM) { this.recordCeilingSample(tracker.peakRpm); this.limiterRearmed = false; this.limiterTracker = null }
  }
  private recordCeilingSample(sample: number): void {
    if (this.isBelowPeakWotRpm(sample)) return
    this.ceilingSamples = keepHighestCeilingSamples([...this.ceilingSamples, roundRpm(sample)])
    this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples)
  }
  private isBelowPeakWotRpm(sample: number): boolean { return sample < this.peakWotRpm - FALSE_LIMITER_BELOW_PEAK_RPM }
  /** A higher clean full-throttle RPM withdraws every observation it proves was not a limiter hit. */
  private raisePeakWotRpm(rpm: number): void {
    this.peakWotRpm = rpm
    const kept = this.ceilingSamples.filter(sample => !this.isBelowPeakWotRpm(sample))
    if (kept.length === this.ceilingSamples.length) return
    this.ceilingSamples = kept
    this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples)
  }
}

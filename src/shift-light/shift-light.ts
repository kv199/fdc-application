// Canonical source for the dependency-free FDC HUD Shift Light bundle.
import type { Telemetry } from './telemetry'
import {
  OptimalShiftEstimator, isCleanShiftEvidence, SHIFT_LIGHT_LEARNING_VERSION,
  type OptimalShiftDiagnostics, type ShiftLightLearningState
} from './optimal-shift'

export type ShiftLightStatus = 'fallback' | 'learning' | 'calibrated'
export type ShiftLightPhase = 'normal' | 'approach' | 'shift'
export type ShiftLightGearStatus = 'learning' | 'potential' | 'optimal'
export type ShiftLightMethod = 'optimal'
export type GearboxValidation = null
export type ShiftLightDiagnosticStatus = ShiftLightGearStatus

/** Compatibility profile shape retained for existing hosts. */
export interface ShiftLightProfile { key: string, gear: number, shiftRpm: number | null, sampleCount: number, status?: ShiftLightGearStatus, method?: ShiftLightMethod }
export interface ShiftLightGearState {
  gear: number
  status: ShiftLightGearStatus
  shiftRpm: number | null
  sampleCount: number
  method: ShiftLightMethod | null
  ratioDrop: null
  candidateRpm: number | null
  confirmationCount: number
  confirmationRpms: number[]
  lastReason: string | null
  acceptedShiftCount: number
  lastRpmBefore: number | null
  lastDeltaPct: number | null
  /** Model point in use for this pair; null when there is none or real comparisons reject it. */
  modelRpm: number | null
  /** The pair's effective target: model point, optimal target, potential candidate, then the ceiling fallbacks. */
  shiftAtRpm: number | null
  /** True when the pair has a model point in use or a confirmed optimal target. */
  ready: boolean
}
export interface ShiftLightGearDiagnostics extends OptimalShiftDiagnostics {}
export interface ShiftLightSnapshot {
  status: ShiftLightStatus
  phase: ShiftLightPhase
  shiftRpm: number | null
  effectiveTargetRpm: number | null
  lightOnRpm: number | null
  leadRpm: number
  acceptedShiftCount: number
  lastRpmBefore: number | null
  lastDeltaPct: number | null
  sampleCount: number
  carKey: string | null
  gameId: string | null
  carOrdinal: number | null
  pi: number | null
  rpmMax: number | null
  reportedRedlineRpm: number | null
  usableCeiling: number | null
  ceilingSampleCount: number
  /** Size of the highest ceiling cluster (uncapped); the UI shows it out of three. */
  ceilingClusterCount: number
  /** Highest considered limiter observation while the usable ceiling is not yet trusted. */
  provisionalCeiling: number | null
  fallbackShiftRpm: number | null
  carClass: number | null
  drivetrain: number | null
  cylinders: number | null
  gearCount: number | null
  observedGearCount: number
  gearboxChanged: boolean
  gearboxValidation: GearboxValidation
  gearboxSignature: null
  currentGear: number | null
  /** True when the current forward gear is the highest gear ever seen for this configuration. */
  lastKnownGear: boolean
  method: ShiftLightMethod | null
  gears: ShiftLightGearState[]
  diagnostics: ShiftLightGearDiagnostics[]
}
export interface ShiftLightLearnerOptions {
  onLearningState?: (state: ShiftLightLearningState) => void
  onCalibrated?: (profile: ShiftLightProfile) => void
  onProgress?: (profile: ShiftLightProfile) => void
  onGearboxChanged?: (gearboxSignature: string) => void
}

const NEUTRAL_GEAR = 11
const MAX_TIMESTAMP_GAP_MS = 1000
const PRE_SHIFT_WINDOW_MS = 200
const MAX_PRE_SHIFT_FRAMES = 5
const POST_SHIFT_DELAY_MS = 80
// Power ramps back after a limiter cut or any other interruption and was still ~5% low 94 ms
// after one recorded cut, so the before window starts well after that ramp.
const PRE_SHIFT_SETTLE_MS = 150
const POST_SHIFT_WINDOW_MS = 600
const MAX_NEUTRAL_WINDOW_MS = 400
// A clutch shift made with the throttle held may take longer than the before window: the before frames are then
// measured from the end of the clean run, and the whole gap from it to the new gear is bounded by this.
const MAX_CLUTCH_SHIFT_GAP_MS = 400
const MIN_POST_SHIFT_FRAMES = 3
const MAX_POST_SHIFT_FRAMES = 5
const REACTION_TIME_S = 0.15
const DEFAULT_LEAD_RPM = 200
const MIN_LEAD_RPM = 100
const MAX_LEAD_RPM = 1000
const MAX_RPM_RATE = 50_000
const RPM_RATE_ALPHA = 0.25

function isForwardGear(gear: number): boolean { return Number.isInteger(gear) && gear >= 1 && gear <= 10 }
/** Full throttle with no brake: only the clutch, a power cut or the gear change itself keeps such a frame from being clean. */
function isThrottleHeld(telemetry: Telemetry): boolean {
  if (telemetry.isRaceOn === false || !Number.isFinite(telemetry.throttle) || telemetry.throttle < 0.95) return false
  if (Number.isFinite(telemetry.brake) && telemetry.brake > 0.02) return false
  return !(Number.isFinite(telemetry.handBrake) && telemetry.handBrake > 0.02)
}
function isClutchPressed(telemetry: Telemetry): boolean { return Number.isFinite(telemetry.clutch) && telemetry.clutch > 0.05 }
function roundRpm(value: number): number { return Math.max(0, Math.round(value)) }
function fallbackPhase(rpm: number, rpmMax: number): ShiftLightPhase {
  if (!Number.isFinite(rpm) || !Number.isFinite(rpmMax) || rpmMax <= 0) return 'normal'
  return rpm >= rpmMax * 0.85 ? 'approach' : 'normal'
}
function normalizeIdentityKey(key: string): string | null { return typeof key === 'string' && key.startsWith('fh6:') ? key : null }

export function getShiftLightCarKey(telemetry: Telemetry): string | null {
  const ordinal = telemetry.car?.ordinal, carClass = telemetry.car?.class, pi = telemetry.car?.pi
  const drivetrain = telemetry.car?.drivetrain, cylinders = telemetry.car?.cylinders
  if (!Number.isFinite(ordinal) || ordinal <= 0 || !Number.isFinite(carClass) || carClass < 0 || !Number.isFinite(pi) || pi <= 0 || !Number.isFinite(drivetrain) || drivetrain < 0 || !Number.isFinite(cylinders) || cylinders <= 0) return null
  return ['fh6', Math.round(ordinal), Math.round(carClass), Math.round(pi), Math.round(drivetrain), Math.round(cylinders)].join(':')
}
export function getShiftLightIdentity(telemetry: Telemetry): { gameId: string, carOrdinal: number, carClass: number, pi: number, drivetrain: number, cylinders: number, rpmMax: number, key: string } | null {
  const key = getShiftLightCarKey(telemetry); if (!key) return null
  const parts = key.split(':')
  return { gameId: 'fh6', carOrdinal: Number(parts[1]), carClass: Number(parts[2]), pi: Number(parts[3]), drivetrain: Number(parts[4]), cylinders: Number(parts[5]), rpmMax: Number.isFinite(telemetry.rpmMax) ? telemetry.rpmMax : 0, key }
}

interface PendingUpshift {
  sourceGear: number
  destinationGear: number
  beforeFrames: Telemetry[]
  transitionTimestampMs: number | null
  firstNeutralTimestampMs: number | null
  postFrames: Telemetry[]
}

export class ShiftLightLearner {
  private readonly estimator = new OptimalShiftEstimator()
  private previous: Telemetry | null = null
  private preShiftFrames: Telemetry[] = []
  private cleanRunStartMs: number | null = null
  private cleanRunGear = 0
  // The last clean frame and what followed it: whether the throttle stayed held and the clutch was pressed.
  private cleanRunEndMs: number | null = null
  private heldSinceCleanRun = false
  private clutchSinceCleanRun = false
  private pendingUpshift: PendingUpshift | null = null
  private rpmRate: number | null = null
  private maxObservedGear = 0
  private latestRpmMax = 0
  constructor(private readonly key: string, private readonly options: ShiftLightLearnerOptions = {}) {}

  setProfile(_profile: ShiftLightProfile | null): void {}
  setProfiles(_profiles: ShiftLightProfile[]): void {}
  getProfiles(): ShiftLightProfile[] { return this.estimator.getStates().filter(state => state.status === 'optimal').map(state => ({ key: this.key, gear: state.sourceGear, shiftRpm: state.targetRpm, sampleCount: state.evidence.length, status: 'optimal', method: 'optimal' })) }
  serializeLearningState(): ShiftLightLearningState { return this.estimator.serializeLearningState(this.key) }
  importLearningState(state: unknown): void { this.estimator.importLearningState(state, this.key); this.publishLearningState() }
  mergeLearningState(state: unknown): void { if (this.estimator.mergeLearningState(state, this.key)) this.publishLearningState() }
  exportLearningState(): ShiftLightLearningState { return this.serializeLearningState() }
  exportState(): ShiftLightLearningState { return this.serializeLearningState() }
  importState(state: unknown): void { this.importLearningState(state) }
  mergeState(state: unknown): void { this.mergeLearningState(state) }
  reset(): void { this.estimator.reset(); this.previous = null; this.preShiftFrames = []; this.cleanRunStartMs = null; this.resetCleanRunEnd(); this.pendingUpshift = null; this.rpmRate = null; this.maxObservedGear = 0; this.latestRpmMax = 0; this.publishLearningState() }
  resetTransient(): void { this.estimator.resetTransient(); this.previous = null; this.preShiftFrames = []; this.cleanRunStartMs = null; this.resetCleanRunEnd(); this.pendingUpshift = null; this.rpmRate = null }

  update(telemetry: Telemetry): ShiftLightSnapshot {
    let previous = this.previous
    if (previous && !this.hasContinuousTimestamp(previous, telemetry)) { this.resetTransient(); previous = null }
    if (Number.isFinite(telemetry.rpmMax) && telemetry.rpmMax > 0) this.latestRpmMax = telemetry.rpmMax
    const forward = isForwardGear(telemetry.gear)
    if (forward) this.maxObservedGear = Math.max(this.maxObservedGear, telemetry.gear)
    this.estimator.ingest(telemetry)
    this.captureShift(previous, telemetry, forward)
    this.estimator.refreshModel(telemetry.timestampMs)
    this.updateRpmRate(previous, telemetry)
    this.previous = telemetry
    return this.snapshot(telemetry)
  }

  snapshot(telemetry: Telemetry | null = this.previous): ShiftLightSnapshot {
    const identity = this.parseIdentity(), currentGear = telemetry && isForwardGear(telemetry.gear) ? telemetry.gear : null
    const current = currentGear === null ? null : this.estimator.getState(currentGear)
    const rpmMax = telemetry?.rpmMax ?? this.latestRpmMax
    const usableCeiling = this.estimator.getUsableCeiling()
    const provisionalCeiling = usableCeiling === null ? this.estimator.getProvisionalCeiling(rpmMax > 0 ? rpmMax : null) : null
    const fallbackShiftRpm = usableCeiling ?? provisionalCeiling ?? (rpmMax > 0 ? roundRpm(rpmMax) : null)
    const modelRpm = currentGear === null ? null : this.estimator.getModelRpm(currentGear)
    const effectiveTargetRpm = modelRpm ?? current?.targetRpm ?? current?.candidateRpm ?? fallbackShiftRpm
    const leadRpm = this.getLeadRpm(), lightOnRpm = effectiveTargetRpm === null ? null : Math.max(0, roundRpm(effectiveTargetRpm - leadRpm))
    let phase = fallbackPhase(telemetry?.rpm ?? 0, rpmMax)
    if (lightOnRpm !== null && telemetry) phase = telemetry.rpm >= lightOnRpm ? 'shift' : phase
    const highestKnownGear = Math.max(this.maxObservedGear, this.estimator.getHighestKnownGear())
    const lastKnownGear = currentGear !== null && currentGear >= highestKnownGear
    // A model point in use counts as a learned target, so the HUD lets red wait for it.
    const learned = modelRpm !== null || current?.status === 'optimal' || current?.status === 'potential'
    const status: ShiftLightStatus = learned ? 'calibrated' : current ? 'learning' : 'fallback'
    const lastEvidence = current?.evidence[current.evidence.length - 1] ?? null
    return { status, phase, shiftRpm: effectiveTargetRpm, effectiveTargetRpm, lightOnRpm, leadRpm,
      acceptedShiftCount: current?.evidence.length ?? 0, lastRpmBefore: lastEvidence?.beforeRpm ?? null, lastDeltaPct: lastEvidence?.powerDeltaPct ?? null,
      sampleCount: current?.evidence.length ?? 0, carKey: normalizeIdentityKey(this.key), gameId: identity?.gameId ?? null,
      carOrdinal: identity?.carOrdinal ?? null, pi: identity?.pi ?? null, rpmMax: rpmMax > 0 ? rpmMax : null,
      reportedRedlineRpm: this.estimator.getReportedRedlineRpm(), usableCeiling,
      ceilingSampleCount: this.estimator.getCeilingSampleCount(), ceilingClusterCount: this.estimator.getCeilingClusterCount(), provisionalCeiling, fallbackShiftRpm,
      carClass: identity?.carClass ?? null, drivetrain: identity?.drivetrain ?? null, cylinders: identity?.cylinders ?? null,
      gearCount: null, observedGearCount: this.maxObservedGear, gearboxChanged: false, gearboxValidation: null, gearboxSignature: null,
      currentGear, lastKnownGear, method: learned ? 'optimal' : null,
      gears: this.getGearStates(fallbackShiftRpm ?? this.estimator.getReportedRedlineRpm()), diagnostics: this.getGearDiagnostics() }
  }

  clearConfiguration(): void { this.reset() }
  private publishLearningState(): void { this.options.onLearningState?.(this.serializeLearningState()) }

  private captureShift(previous: Telemetry | null, telemetry: Telemetry, forward: boolean): void {
    const clean = isCleanShiftEvidence(telemetry)
    const pending = this.pendingUpshift
    if (pending) {
      if (pending.transitionTimestampMs === null) {
        if (pending.firstNeutralTimestampMs !== null && telemetry.timestampMs - pending.firstNeutralTimestampMs > MAX_NEUTRAL_WINDOW_MS) this.pendingUpshift = null
        else if (forward && telemetry.gear === pending.destinationGear) {
          // A clutch shift with the throttle held measures the before frames from the end of the clean run, because
          // a slow clutch can take longer than the before window; a lift keeps the window measured from the new gear.
          const runEndMs = this.cleanRunEndMs
          const clutchShift = runEndMs !== null && this.heldSinceCleanRun && this.clutchSinceCleanRun && isThrottleHeld(telemetry)
          const referenceMs = clutchShift ? runEndMs : telemetry.timestampMs
          const fresh = clutchShift && telemetry.timestampMs - runEndMs > MAX_CLUTCH_SHIFT_GAP_MS
            ? []
            : pending.beforeFrames.filter(item => referenceMs - item.timestampMs >= 0 && referenceMs - item.timestampMs <= PRE_SHIFT_WINDOW_MS)
          if (fresh.length === 0) this.pendingUpshift = null
          else { pending.beforeFrames = fresh; pending.transitionTimestampMs = telemetry.timestampMs }
        }
        else if (telemetry.gear !== NEUTRAL_GEAR) this.pendingUpshift = null
      }
      if (this.pendingUpshift && pending.transitionTimestampMs !== null) {
        const elapsed = telemetry.timestampMs - pending.transitionTimestampMs
        if (elapsed > POST_SHIFT_WINDOW_MS || (forward && telemetry.gear !== pending.destinationGear)) this.pendingUpshift = null
        else if (forward && telemetry.gear === pending.destinationGear && elapsed >= POST_SHIFT_DELAY_MS && clean) {
          pending.postFrames.push(telemetry)
          if (pending.postFrames.length >= MIN_POST_SHIFT_FRAMES) this.finishShift(pending)
        }
      }
    }
    if (forward) {
      // Gear changes are detected independently of power: the first new-gear
      // frame is commonly torque-cut/negative and must only start capture.
      if (previous && isForwardGear(previous.gear) && telemetry.gear === previous.gear + 1) this.startPostShift(previous.gear, telemetry.gear, telemetry.timestampMs, this.preShiftFrames)
    }
    if (forward && clean) {
      this.cleanRunEndMs = telemetry.timestampMs; this.heldSinceCleanRun = true; this.clutchSinceCleanRun = false
      // Before evidence comes only from the settled clean run in this gear that directly precedes the transition.
      if (this.cleanRunStartMs === null || this.cleanRunGear !== telemetry.gear) { this.cleanRunStartMs = telemetry.timestampMs; this.cleanRunGear = telemetry.gear; this.preShiftFrames = [] }
      const settled = telemetry.timestampMs - this.cleanRunStartMs >= PRE_SHIFT_SETTLE_MS
      // The power model uses the same settled frames, so power ramping back after an interruption stays out of it.
      if (settled) this.estimator.observeModelFrame(telemetry)
      if (settled && (!this.pendingUpshift || this.pendingUpshift.sourceGear !== telemetry.gear)) this.preShiftFrames = [...this.preShiftFrames.filter(item => telemetry.timestampMs - item.timestampMs <= PRE_SHIFT_WINDOW_MS), telemetry].slice(-MAX_PRE_SHIFT_FRAMES)
      return
    }
    // A non-clean frame ends the clean run. Frames collected before it stay usable within the
    // before window, because a clutch press or a lift is the start of the shift itself; frames
    // after an interruption are protected by the settle rule, since a new clean run clears them.
    this.cleanRunStartMs = null
    this.heldSinceCleanRun = this.heldSinceCleanRun && isThrottleHeld(telemetry)
    if (isClutchPressed(telemetry)) this.clutchSinceCleanRun = true
    if (forward) return
    if (telemetry.gear === NEUTRAL_GEAR && this.preShiftFrames.length > 0) {
      const sourceGear = this.preShiftFrames[this.preShiftFrames.length - 1]!.gear
      if (sourceGear >= 1 && sourceGear < 10) this.pendingUpshift = { sourceGear, destinationGear: sourceGear + 1, beforeFrames: [...this.preShiftFrames], transitionTimestampMs: null, firstNeutralTimestampMs: telemetry.timestampMs, postFrames: [] }
    } else if (telemetry.gear !== NEUTRAL_GEAR) { this.preShiftFrames = []; this.pendingUpshift = null }
  }

  private resetCleanRunEnd(): void { this.cleanRunEndMs = null; this.heldSinceCleanRun = false; this.clutchSinceCleanRun = false }
  private startPostShift(sourceGear: number, destinationGear: number, timestampMs: number, beforeFrames: Telemetry[]): void {
    const fresh = beforeFrames.filter(item => timestampMs - item.timestampMs >= 0 && timestampMs - item.timestampMs <= PRE_SHIFT_WINDOW_MS)
    if (fresh.length > 0) this.pendingUpshift = { sourceGear, destinationGear, beforeFrames: fresh, transitionTimestampMs: timestampMs, firstNeutralTimestampMs: null, postFrames: [] }
  }
  private finishShift(pending: PendingUpshift): void {
    const before = this.medianTelemetry(pending.beforeFrames), after = this.medianTelemetry(pending.postFrames.slice(0, MAX_POST_SHIFT_FRAMES)); this.pendingUpshift = null
    if (!before || !after) return
    const evidence = this.estimator.observeTransition({ sourceGear: pending.sourceGear, destinationGear: pending.destinationGear, before, after })
    if (!evidence) return
    this.publishLearningState(); const state = this.estimator.getState(pending.sourceGear)
    this.options.onProgress?.({ key: this.key, gear: pending.sourceGear, shiftRpm: state?.targetRpm ?? null, sampleCount: state?.evidence.length ?? 0, status: state?.status ?? 'learning', method: 'optimal' })
    if (state?.status === 'optimal') this.options.onCalibrated?.({ key: this.key, gear: pending.sourceGear, shiftRpm: state.targetRpm, sampleCount: state.evidence.length, status: 'optimal', method: 'optimal' })
  }
  /** Median timestamp, RPM, power and per-wheel slip ratio of a window; other fields come from its middle frame. */
  private medianTelemetry(frames: Telemetry[]): Telemetry | null {
    if (frames.length === 0) return null
    const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]! }
    const pivot = frames[Math.floor(frames.length / 2)]!
    const slips = frames.map(item => item.slipRatio)
    const slipRatio = slips.every(slip => slip && typeof slip === 'object')
      ? { fl: median(slips.map(slip => slip.fl)), fr: median(slips.map(slip => slip.fr)), rl: median(slips.map(slip => slip.rl)), rr: median(slips.map(slip => slip.rr)) }
      : pivot.slipRatio
    return { ...pivot, timestampMs: median(frames.map(item => item.timestampMs)), rpm: median(frames.map(item => item.rpm)), power: median(frames.map(item => item.power)), slipRatio }
  }
  private getLeadRpm(): number { const raw = (this.rpmRate ?? 0) * REACTION_TIME_S; return Math.round(Math.max(MIN_LEAD_RPM, Math.min(MAX_LEAD_RPM, Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LEAD_RPM))) }
  private getGearStates(fallbackShiftRpm: number | null): ShiftLightGearState[] {
    return this.estimator.getStates().map(state => {
      const last = state.evidence[state.evidence.length - 1] ?? null
      const modelRpm = this.estimator.getModelRpm(state.sourceGear)
      return { gear: state.sourceGear, status: state.status, shiftRpm: state.targetRpm ?? state.candidateRpm, sampleCount: state.evidence.length, method: state.status === 'learning' ? null : 'optimal', ratioDrop: null, candidateRpm: state.candidateRpm, confirmationCount: state.confirmationCount, confirmationRpms: [...state.confirmationRpms], lastReason: state.lastReason, acceptedShiftCount: state.evidence.length, lastRpmBefore: last?.beforeRpm ?? null, lastDeltaPct: last?.powerDeltaPct ?? null,
        modelRpm, shiftAtRpm: modelRpm ?? state.targetRpm ?? state.candidateRpm ?? fallbackShiftRpm, ready: modelRpm !== null || state.status === 'optimal' }
    })
  }
  private getGearDiagnostics(): ShiftLightGearDiagnostics[] { return this.estimator.getStates().map(state => this.estimator.diagnose(state.sourceGear)) }
  private updateRpmRate(previous: Telemetry | null, telemetry: Telemetry): void {
    if (!previous || !isCleanShiftEvidence(previous) || !isCleanShiftEvidence(telemetry) || previous.gear !== telemetry.gear) { this.rpmRate = null; return }
    // Data Out sends two different packets per game timestamp; the second one carries no time step, so the rate is kept.
    if (telemetry.timestampMs === previous.timestampMs) return
    const dt = (telemetry.timestampMs - previous.timestampMs) / 1000, rate = (telemetry.rpm - previous.rpm) / dt
    if (dt < 0.005 || dt > 0.1 || !Number.isFinite(rate) || rate <= 0 || rate > MAX_RPM_RATE) { this.rpmRate = null; return }
    this.rpmRate = this.rpmRate === null ? rate : this.rpmRate * (1 - RPM_RATE_ALPHA) + rate * RPM_RATE_ALPHA
  }
  private parseIdentity(): { gameId: string, carOrdinal: number, carClass: number, pi: number, drivetrain: number, cylinders: number } | null {
    const parts = this.key.split(':'); if (parts.length !== 6 || parts[0] !== 'fh6') return null
    const values = parts.slice(1, 6).map(Number); if (values.some(value => !Number.isFinite(value))) return null
    return { gameId: 'fh6', carOrdinal: values[0]!, carClass: values[1]!, pi: values[2]!, drivetrain: values[3]!, cylinders: values[4]! }
  }
  private hasContinuousTimestamp(previous: Telemetry, telemetry: Telemetry): boolean { const delta = telemetry.timestampMs - previous.timestampMs; return Number.isFinite(delta) && delta >= 0 && delta <= MAX_TIMESTAMP_GAP_MS }
}

export { SHIFT_LIGHT_LEARNING_VERSION }

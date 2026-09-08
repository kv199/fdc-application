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
const POST_SHIFT_WINDOW_MS = 600
const MAX_NEUTRAL_WINDOW_MS = 400
const MIN_POST_SHIFT_FRAMES = 3
const MAX_POST_SHIFT_FRAMES = 5
const REACTION_TIME_S = 0.15
const DEFAULT_LEAD_RPM = 200
const MIN_LEAD_RPM = 100
const MAX_LEAD_RPM = 500
const MAX_RPM_RATE = 50_000
const RPM_RATE_ALPHA = 0.25

function isForwardGear(gear: number): boolean { return Number.isInteger(gear) && gear >= 1 && gear <= 10 }
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
  reset(): void { this.estimator.reset(); this.previous = null; this.preShiftFrames = []; this.pendingUpshift = null; this.rpmRate = null; this.maxObservedGear = 0; this.latestRpmMax = 0; this.publishLearningState() }
  resetTransient(): void { this.estimator.resetTransient(); this.previous = null; this.preShiftFrames = []; this.pendingUpshift = null; this.rpmRate = null }

  update(telemetry: Telemetry): ShiftLightSnapshot {
    let previous = this.previous
    if (previous && !this.hasContinuousTimestamp(previous, telemetry)) { this.resetTransient(); previous = null }
    if (Number.isFinite(telemetry.rpmMax) && telemetry.rpmMax > 0) this.latestRpmMax = telemetry.rpmMax
    const forward = isForwardGear(telemetry.gear)
    if (forward) this.maxObservedGear = Math.max(this.maxObservedGear, telemetry.gear)
    this.estimator.ingest(telemetry)
    this.captureShift(previous, telemetry, forward)
    this.updateRpmRate(previous, telemetry)
    this.previous = telemetry
    return this.snapshot(telemetry)
  }

  snapshot(telemetry: Telemetry | null = this.previous): ShiftLightSnapshot {
    const identity = this.parseIdentity(), currentGear = telemetry && isForwardGear(telemetry.gear) ? telemetry.gear : null
    const current = currentGear === null ? null : this.estimator.getState(currentGear)
    const rpmMax = telemetry?.rpmMax ?? this.latestRpmMax
    const fallbackShiftRpm = this.estimator.getUsableCeiling() ?? (rpmMax > 0 ? roundRpm(rpmMax) : null)
    const effectiveTargetRpm = current?.targetRpm ?? current?.candidateRpm ?? fallbackShiftRpm
    const leadRpm = this.getLeadRpm(), lightOnRpm = effectiveTargetRpm === null ? null : Math.max(0, roundRpm(effectiveTargetRpm - leadRpm))
    let phase = fallbackPhase(telemetry?.rpm ?? 0, rpmMax)
    if (lightOnRpm !== null && telemetry) phase = telemetry.rpm >= lightOnRpm ? 'shift' : phase
    const status: ShiftLightStatus = current?.status === 'optimal' || current?.status === 'potential' ? 'calibrated' : current ? 'learning' : 'fallback'
    const lastEvidence = current?.evidence[current.evidence.length - 1] ?? null
    return { status, phase, shiftRpm: effectiveTargetRpm, effectiveTargetRpm, lightOnRpm, leadRpm,
      acceptedShiftCount: current?.evidence.length ?? 0, lastRpmBefore: lastEvidence?.beforeRpm ?? null, lastDeltaPct: lastEvidence?.powerDeltaPct ?? null,
      sampleCount: current?.evidence.length ?? 0, carKey: normalizeIdentityKey(this.key), gameId: identity?.gameId ?? null,
      carOrdinal: identity?.carOrdinal ?? null, pi: identity?.pi ?? null, rpmMax: rpmMax > 0 ? rpmMax : null,
      reportedRedlineRpm: this.estimator.getReportedRedlineRpm(), usableCeiling: this.estimator.getUsableCeiling(),
      ceilingSampleCount: this.estimator.getCeilingSampleCount(), fallbackShiftRpm,
      carClass: identity?.carClass ?? null, drivetrain: identity?.drivetrain ?? null, cylinders: identity?.cylinders ?? null,
      gearCount: null, observedGearCount: this.maxObservedGear, gearboxChanged: false, gearboxValidation: null, gearboxSignature: null,
      currentGear, method: current?.status === 'optimal' || current?.status === 'potential' ? 'optimal' : null,
      gears: this.getGearStates(), diagnostics: this.getGearDiagnostics() }
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
          const fresh = pending.beforeFrames.filter(item => telemetry.timestampMs - item.timestampMs >= 0 && telemetry.timestampMs - item.timestampMs <= PRE_SHIFT_WINDOW_MS)
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
      if (!this.pendingUpshift || this.pendingUpshift.sourceGear !== telemetry.gear) this.preShiftFrames = [...this.preShiftFrames.filter(item => telemetry.timestampMs - item.timestampMs <= PRE_SHIFT_WINDOW_MS), telemetry].slice(-MAX_PRE_SHIFT_FRAMES)
    } else if (telemetry.gear === NEUTRAL_GEAR && this.preShiftFrames.length > 0) {
      const sourceGear = this.preShiftFrames[this.preShiftFrames.length - 1]!.gear
      if (sourceGear >= 1 && sourceGear < 10) this.pendingUpshift = { sourceGear, destinationGear: sourceGear + 1, beforeFrames: [...this.preShiftFrames], transitionTimestampMs: null, firstNeutralTimestampMs: telemetry.timestampMs, postFrames: [] }
    } else if (!forward && telemetry.gear !== NEUTRAL_GEAR) { this.preShiftFrames = []; this.pendingUpshift = null }
  }

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
  private medianTelemetry(frames: Telemetry[]): Telemetry | null {
    if (frames.length === 0) return null
    const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]! }
    const pivot = frames[Math.floor(frames.length / 2)]!
    return { ...pivot, timestampMs: median(frames.map(item => item.timestampMs)), rpm: median(frames.map(item => item.rpm)), power: median(frames.map(item => item.power)) }
  }
  private getLeadRpm(): number { const raw = (this.rpmRate ?? 0) * REACTION_TIME_S; return Math.round(Math.max(MIN_LEAD_RPM, Math.min(MAX_LEAD_RPM, Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LEAD_RPM))) }
  private getGearStates(): ShiftLightGearState[] { return this.estimator.getStates().map(state => { const last = state.evidence[state.evidence.length - 1] ?? null; return { gear: state.sourceGear, status: state.status, shiftRpm: state.targetRpm ?? state.candidateRpm, sampleCount: state.evidence.length, method: state.status === 'learning' ? null : 'optimal', ratioDrop: null, candidateRpm: state.candidateRpm, confirmationCount: state.confirmationCount, confirmationRpms: [...state.confirmationRpms], lastReason: state.lastReason, acceptedShiftCount: state.evidence.length, lastRpmBefore: last?.beforeRpm ?? null, lastDeltaPct: last?.powerDeltaPct ?? null } }) }
  private getGearDiagnostics(): ShiftLightGearDiagnostics[] { return this.estimator.getStates().map(state => this.estimator.diagnose(state.sourceGear)) }
  private updateRpmRate(previous: Telemetry | null, telemetry: Telemetry): void {
    if (!previous || !isCleanShiftEvidence(previous) || !isCleanShiftEvidence(telemetry) || previous.gear !== telemetry.gear) { this.rpmRate = null; return }
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

// Canonical source for the dependency-free FDC HUD Shift Light bundle.
import type { Telemetry } from './telemetry'
import {
  OptimalShiftEstimator,
  isCleanShiftEvidence,
  SHIFT_LIGHT_LEARNING_VERSION,
  type GearLearningState,
  type OptimalShiftDiagnostics,
  type ShiftLightLearningState
} from './optimal-shift'

export type ShiftLightStatus = 'fallback' | 'learning' | 'calibrated'
export type ShiftLightPhase = 'normal' | 'approach' | 'shift'
export type ShiftLightGearStatus = 'learning' | 'confirming' | 'optimal'
export type ShiftLightMethod = 'optimal'
export type GearboxValidation = null
export type ShiftLightDiagnosticStatus = ShiftLightGearStatus

/** Kept as a narrow compatibility shape while persistence moves to learning state. */
export interface ShiftLightProfile {
  key: string
  gear: number
  shiftRpm: number | null
  sampleCount: number
  status?: ShiftLightGearStatus
  method?: ShiftLightMethod
}

export interface ShiftLightGearState {
  gear: number
  status: ShiftLightGearStatus
  shiftRpm: number | null
  sampleCount: number
  method: ShiftLightMethod | null
  ratioDrop: null
  candidateRpm: number | null
  confirmingCount: number
  lastReason: string | null
}

export interface ShiftLightGearDiagnostics extends OptimalShiftDiagnostics {}

export interface ShiftLightSnapshot {
  status: ShiftLightStatus
  phase: ShiftLightPhase
  shiftRpm: number | null
  sampleCount: number
  carKey: string | null
  gameId: string | null
  carOrdinal: number | null
  pi: number | null
  rpmMax: number | null
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
  /** Deprecated profile hooks are retained for host migration compatibility. */
  onCalibrated?: (profile: ShiftLightProfile) => void
  onProgress?: (profile: ShiftLightProfile) => void
  onGearboxChanged?: (gearboxSignature: string) => void
}

const NEUTRAL_GEAR = 11
const MAX_TIMESTAMP_GAP_MS = 1000
const MAX_NEUTRAL_MS = 200
const MAX_NEUTRAL_FRAMES = 64
const MAX_RPM_RATE = 50_000
const RPM_RATE_ALPHA = 0.25

function isForwardGear(gear: number): boolean {
  return Number.isInteger(gear) && gear >= 1 && gear <= 10
}

function roundRpm(value: number): number {
  return Math.max(0, Math.round(value))
}

function fallbackPhase(rpm: number, rpmMax: number): ShiftLightPhase {
  if (!Number.isFinite(rpm) || !Number.isFinite(rpmMax) || rpmMax <= 0) return 'normal'
  // Redline is red. Purple is reserved for an actual Confirming or Optimal
  // target and must never appear merely because the game reports rpmMax.
  if (rpm >= rpmMax) return 'approach'
  if (rpm >= rpmMax * 0.85) return 'approach'
  return 'normal'
}

function normalizeIdentityKey(key: string): string | null {
  return typeof key === 'string' && key.startsWith('fh6:') ? key : null
}

/** Stable vehicle/configuration key. rpmMax is display data, not identity. */
export function getShiftLightCarKey(telemetry: Telemetry): string | null {
  const ordinal = telemetry.car?.ordinal
  const carClass = telemetry.car?.class
  const pi = telemetry.car?.pi
  const drivetrain = telemetry.car?.drivetrain
  const cylinders = telemetry.car?.cylinders
  if (!Number.isFinite(ordinal) || ordinal <= 0 || !Number.isFinite(carClass) || carClass < 0
    || !Number.isFinite(pi) || pi <= 0 || !Number.isFinite(drivetrain) || drivetrain < 0
    || !Number.isFinite(cylinders) || cylinders <= 0) return null
  return [
    'fh6', Math.round(ordinal), Math.round(carClass), Math.round(pi),
    Math.round(drivetrain), Math.round(cylinders)
  ].join(':')
}

export function getShiftLightIdentity(telemetry: Telemetry): {
  gameId: string
  carOrdinal: number
  carClass: number
  pi: number
  drivetrain: number
  cylinders: number
  rpmMax: number
  key: string
} | null {
  const key = getShiftLightCarKey(telemetry)
  if (!key) return null
  const parts = key.split(':')
  return {
    gameId: 'fh6',
    carOrdinal: Number(parts[1]),
    carClass: Number(parts[2]),
    pi: Number(parts[3]),
    drivetrain: Number(parts[4]),
    cylinders: Number(parts[5]),
    rpmMax: Number.isFinite(telemetry.rpmMax) ? telemetry.rpmMax : 0,
    key
  }
}

interface PendingUpshift {
  sourceGear: number
  before: Telemetry
  firstNeutralTimestampMs: number
  neutralFrames: number
}

/**
 * Learns independently for each observed source gear. The only decision input
 * is a completed clean real Gx→Gx+1 transition; rpmMax is used exclusively by
 * the redline display, while the learner's physical ceiling comes from clean
 * limiter telemetry.
 */
export class ShiftLightLearner {
  private readonly estimator = new OptimalShiftEstimator()
  private previous: Telemetry | null = null
  private pullGear: number | null = null
  private pullPeak: Telemetry | null = null
  private pendingUpshift: PendingUpshift | null = null
  private rpmRate: number | null = null
  private maxObservedGear = 0
  private latestRpmMax = 0

  constructor(
    private readonly key: string,
    private readonly options: ShiftLightLearnerOptions = {}
  ) {}

  /** Old profile loading is intentionally ignored; use importLearningState. */
  setProfile(_profile: ShiftLightProfile | null): void {}
  setProfiles(_profiles: ShiftLightProfile[]): void {}
  getProfiles(): ShiftLightProfile[] {
    return this.estimator.getStates()
      .filter(state => state.status === 'optimal')
      .map(state => ({
        key: this.key,
        gear: state.sourceGear,
        shiftRpm: state.targetRpm,
        sampleCount: state.evidence.length,
        status: 'optimal',
        method: 'optimal'
      }))
  }

  serializeLearningState(): ShiftLightLearningState {
    return this.estimator.serializeLearningState(this.key)
  }

  importLearningState(state: unknown): void {
    this.estimator.importLearningState(state, this.key)
    this.publishLearningState()
  }

  /** Join persisted completed facts with samples collected before async load. */
  mergeLearningState(state: unknown): void {
    if (this.estimator.mergeLearningState(state, this.key)) this.publishLearningState()
  }

  /** Short aliases for integrations that already use the estimator naming. */
  exportLearningState(): ShiftLightLearningState { return this.serializeLearningState() }
  exportState(): ShiftLightLearningState { return this.serializeLearningState() }
  importState(state: unknown): void { this.importLearningState(state) }
  mergeState(state: unknown): void { this.mergeLearningState(state) }

  reset(): void {
    this.estimator.reset()
    this.previous = null
    this.pullGear = null
    this.pullPeak = null
    this.pendingUpshift = null
    this.rpmRate = null
    this.maxObservedGear = 0
    this.latestRpmMax = 0
    this.publishLearningState()
  }

  resetTransient(): void {
    this.estimator.resetTransient()
    this.previous = null
    this.pullGear = null
    this.pullPeak = null
    this.pendingUpshift = null
    this.rpmRate = null
  }

  update(telemetry: Telemetry): ShiftLightSnapshot {
    let previous = this.previous
    if (previous && !this.hasContinuousTimestamp(previous, telemetry)) {
      this.resetTransient()
      previous = null
    }
    if (Number.isFinite(telemetry.rpmMax) && telemetry.rpmMax > 0) this.latestRpmMax = telemetry.rpmMax
    const forward = isForwardGear(telemetry.gear)
    if (forward) this.maxObservedGear = Math.max(this.maxObservedGear, telemetry.gear)

    this.estimator.ingest(telemetry)
    if (isCleanShiftEvidence(telemetry)) this.publishLearningState()

    if (forward) {
      const transition = this.getUpshiftTransition(previous, telemetry)
      if (transition) {
        const evidence = this.estimator.observeTransition({
          sourceGear: transition.sourceGear,
          destinationGear: telemetry.gear,
          before: transition.before,
          after: telemetry
        })
        if (evidence) {
          this.publishLearningState()
          this.options.onProgress?.({
            key: this.key,
            gear: transition.sourceGear,
            shiftRpm: this.estimator.getState(transition.sourceGear)?.targetRpm ?? null,
            sampleCount: this.estimator.getState(transition.sourceGear)?.evidence.length ?? 0,
            status: this.estimator.getState(transition.sourceGear)?.status ?? 'learning',
            method: 'optimal'
          })
          if ((evidence.outcome === 'better' || evidence.outcome === 'rpm_ceiling')
            && this.estimator.getState(transition.sourceGear)?.status === 'optimal') {
            this.options.onCalibrated?.({
              key: this.key,
              gear: transition.sourceGear,
              shiftRpm: this.estimator.getState(transition.sourceGear)?.targetRpm ?? null,
              sampleCount: this.estimator.getState(transition.sourceGear)?.evidence.length ?? 0,
              status: 'optimal',
              method: 'optimal'
            })
          }
        }
      }
      this.pendingUpshift = null
      if (this.pullGear !== telemetry.gear) {
        this.pullGear = telemetry.gear
        this.pullPeak = null
      }
      if (isCleanShiftEvidence(telemetry)) {
        if (!this.pullPeak || telemetry.rpm >= this.pullPeak.rpm) this.pullPeak = telemetry
      }
    } else if (telemetry.gear === NEUTRAL_GEAR && this.pullGear !== null && this.pullPeak) {
      const pending = this.pendingUpshift?.sourceGear === this.pullGear
        ? this.pendingUpshift
        : { sourceGear: this.pullGear, before: this.pullPeak, firstNeutralTimestampMs: telemetry.timestampMs, neutralFrames: 0 }
      const elapsed = telemetry.timestampMs - pending.firstNeutralTimestampMs
      pending.neutralFrames += 1
      if (elapsed <= MAX_NEUTRAL_MS && pending.neutralFrames <= MAX_NEUTRAL_FRAMES) this.pendingUpshift = pending
      else this.resetTransient()
    } else if (!forward) {
      this.resetTransient()
    }

    this.updateRpmRate(previous, telemetry)
    this.previous = telemetry
    return this.snapshot(telemetry)
  }

  snapshot(telemetry: Telemetry | null = this.previous): ShiftLightSnapshot {
    const identity = this.parseIdentity()
    const currentGear = telemetry && isForwardGear(telemetry.gear) ? telemetry.gear : null
    const current = currentGear === null ? null : this.estimator.getState(currentGear)
    const shiftRpm = current?.targetRpm ?? current?.candidateRpm ?? null
    const rpmMax = telemetry?.rpmMax ?? this.latestRpmMax
    let phase = fallbackPhase(telemetry?.rpm ?? 0, rpmMax)
    if (shiftRpm !== null && telemetry) phase = telemetry.rpm >= shiftRpm ? 'shift' : fallbackPhase(telemetry.rpm, rpmMax)
    const status: ShiftLightStatus = current?.status === 'optimal' || current?.status === 'confirming' ? 'calibrated' : 'learning'
    return {
      status,
      phase,
      shiftRpm,
      sampleCount: current?.evidence.length ?? 0,
      carKey: normalizeIdentityKey(this.key),
      gameId: identity?.gameId ?? null,
      carOrdinal: identity?.carOrdinal ?? null,
      pi: identity?.pi ?? null,
      rpmMax: rpmMax > 0 ? rpmMax : null,
      usableCeiling: this.estimator.getUsableCeiling(),
      ceilingSampleCount: this.estimator.getCeilingSampleCount(),
      fallbackShiftRpm: rpmMax > 0 ? roundRpm(rpmMax) : null,
      carClass: identity?.carClass ?? null,
      drivetrain: identity?.drivetrain ?? null,
      cylinders: identity?.cylinders ?? null,
      gearCount: null,
      observedGearCount: this.maxObservedGear,
      gearboxChanged: false,
      gearboxValidation: null,
      gearboxSignature: null,
      currentGear,
      method: current?.status === 'optimal' ? 'optimal' : current?.status === 'confirming' ? 'optimal' : null,
      gears: this.getGearStates(),
      diagnostics: this.getGearDiagnostics()
    }
  }

  clearConfiguration(): void { this.reset() }

  private publishLearningState(): void {
    this.options.onLearningState?.(this.serializeLearningState())
  }

  private getUpshiftTransition(previous: Telemetry | null, telemetry: Telemetry): { sourceGear: number, before: Telemetry } | null {
    if (this.pendingUpshift && telemetry.gear === this.pendingUpshift.sourceGear + 1
      && telemetry.timestampMs - this.pendingUpshift.firstNeutralTimestampMs <= MAX_NEUTRAL_MS) return this.pendingUpshift
    if (previous && isForwardGear(previous.gear) && telemetry.gear === previous.gear + 1
      && this.pullGear === previous.gear && this.pullPeak) return { sourceGear: previous.gear, before: this.pullPeak }
    return null
  }

  private getGearStates(): ShiftLightGearState[] {
    return this.estimator.getStates().map(state => ({
      gear: state.sourceGear,
      status: state.status,
      shiftRpm: state.targetRpm ?? state.candidateRpm,
      sampleCount: state.evidence.length,
      method: state.status === 'learning' ? null : 'optimal',
      ratioDrop: null,
      candidateRpm: state.candidateRpm,
      confirmingCount: state.confirmingRpms.length,
      lastReason: state.lastReason
    }))
  }

  private getGearDiagnostics(): ShiftLightGearDiagnostics[] {
    return this.estimator.getStates().map(state => this.estimator.diagnose(state.sourceGear))
  }

  private updateRpmRate(previous: Telemetry | null, telemetry: Telemetry): void {
    if (!previous || !isCleanShiftEvidence(previous) || !isCleanShiftEvidence(telemetry)
      || previous.gear !== telemetry.gear) {
      this.rpmRate = null
      return
    }
    const dt = (telemetry.timestampMs - previous.timestampMs) / 1000
    const rate = (telemetry.rpm - previous.rpm) / dt
    if (dt < 0.005 || dt > 0.1 || !Number.isFinite(rate) || rate <= 0 || rate > MAX_RPM_RATE) {
      this.rpmRate = null
      return
    }
    this.rpmRate = this.rpmRate === null ? rate : this.rpmRate * (1 - RPM_RATE_ALPHA) + rate * RPM_RATE_ALPHA
  }

  private parseIdentity(): { gameId: string, carOrdinal: number, carClass: number, pi: number, drivetrain: number, cylinders: number } | null {
    const parts = this.key.split(':')
    if (parts.length !== 6 || parts[0] !== 'fh6') return null
    const values = parts.slice(1, 6).map(Number)
    if (values.some(value => !Number.isFinite(value))) return null
    return { gameId: 'fh6', carOrdinal: values[0]!, carClass: values[1]!, pi: values[2]!, drivetrain: values[3]!, cylinders: values[4]! }
  }

  private hasContinuousTimestamp(previous: Telemetry, telemetry: Telemetry): boolean {
    const delta = telemetry.timestampMs - previous.timestampMs
    return Number.isFinite(delta) && delta >= 0 && delta <= MAX_TIMESTAMP_GAP_MS
  }
}

export { SHIFT_LIGHT_LEARNING_VERSION }

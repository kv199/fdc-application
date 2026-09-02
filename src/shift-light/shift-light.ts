// Canonical source for the dependency-free FDC HUD Shift Light bundle.
import type { Telemetry } from './telemetry'
import {
  OptimalShiftEstimator,
  type OptimalShiftDiagnostics,
  type OptimalShiftEstimate
} from './optimal-shift'

export type ShiftLightStatus = 'fallback' | 'learning' | 'calibrated'
export type ShiftLightPhase = 'normal' | 'approach' | 'shift'
export type ShiftLightGearStatus = 'learning' | 'calibrated'
export type ShiftLightMethod = 'observed' | 'optimal'
export type GearboxValidation = 'validating' | 'verified' | 'checking' | null
export type ShiftLightDiagnosticStatus
  = 'observed'
    | 'optimal'
    | 'learning'
    | 'waiting-for-wot'
    | 'waiting-for-ratio'
    | 'confirming'
    | 'gearbox-mismatch'

/**
 * A gear of 0 is the compatibility profile created by the first version of
 * the learner. New samples are always stored against the gear being pulled.
 */
export interface ShiftLightProfile {
  key: string
  gear: number
  shiftRpm: number | null
  sampleCount: number
  status?: ShiftLightGearStatus
  samples?: number[]
  method?: ShiftLightMethod
  ratioDrop?: number | null
  gearboxSignature?: string | null
}

export interface ShiftLightGearState {
  gear: number
  status: ShiftLightGearStatus
  shiftRpm: number | null
  sampleCount: number
  method: ShiftLightMethod | null
  ratioDrop: number | null
}

export interface ShiftLightGearDiagnostics extends OptimalShiftDiagnostics {
  status: ShiftLightDiagnosticStatus
  method: ShiftLightMethod | null
}

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
  carClass: number | null
  drivetrain: number | null
  cylinders: number | null
  gearCount: number | null
  observedGearCount: number
  gearboxChanged: boolean
  gearboxValidation: GearboxValidation
  gearboxSignature: string | null
  currentGear: number | null
  method: ShiftLightMethod | null
  gears: ShiftLightGearState[]
  diagnostics: ShiftLightGearDiagnostics[]
}

export interface ShiftLightLearnerOptions {
  onCalibrated?: (profile: ShiftLightProfile) => void
  onProgress?: (profile: ShiftLightProfile) => void
  onGearboxChanged?: (gearboxSignature: string) => void
}

const MIN_THROTTLE = 0.95
const MIN_RPM_FRACTION = 0.82
const REARM_FRACTION = 0.85
const MIN_RPM_DROP = 40
const RPM_DROP_FRACTION = 0.004
const RPM_OFFSET = 75
const REQUIRED_SAMPLES = 5
const NEUTRAL_GEAR = 11
const MAX_NEUTRAL_MS = 200
const MAX_NEUTRAL_FRAMES = 64
const MAX_TIMESTAMP_GAP_MS = 1000
const MAX_EVIDENCE_SAMPLES = 5
const OPTIMAL_CONFIRM_SAMPLES = 3
const OPTIMAL_STABILITY_RPM = 100
const OPTIMAL_UPDATE_RPM = 50
const SHIFT_SIGNAL_LEAD_MS = 180
const APPROACH_SIGNAL_LEAD_MS = 380
const MAX_SHIFT_SIGNAL_LEAD_RPM = 1200
const MAX_APPROACH_SIGNAL_LEAD_RPM = 1800
const MAX_RPM_RATE = 50_000
const RPM_RATE_ALPHA = 0.25
const REQUIRED_TERMINAL_LIMITER_SAMPLES = 2

function isForwardGear(gear: number): boolean {
  return Number.isFinite(gear) && gear >= 1 && gear <= 10
}

function fallbackPhase(rpm: number, rpmMax: number): ShiftLightPhase {
  if (!Number.isFinite(rpm) || !Number.isFinite(rpmMax) || rpmMax <= 0) return 'normal'
  const fraction = rpm / rpmMax
  if (fraction >= 0.98) return 'shift'
  if (fraction >= 0.85) return 'approach'
  return 'normal'
}

function roundRpm(value: number): number {
  return Math.max(0, Math.round(value))
}

function observedShiftRpm(samples: number[]): number | null {
  if (samples.length < REQUIRED_SAMPLES) return null
  const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length
  return roundRpm(average - RPM_OFFSET)
}

function normalizeGearboxSignature(signature: string | null | undefined): string | null {
  return typeof signature === 'string' && signature.length > 0 ? signature : null
}

interface GearboxSignaturePart {
  gear: number
  ratioDrop: number
  token: string
}

const GEARBOX_SIGNATURE_TOLERANCE = 0.005

function parseGearboxSignature(signature: string): GearboxSignaturePart[] {
  return signature.split('|')
    .map((part) => {
      const [gearText, ratioText] = part.split(':')
      const gear = Number(gearText)
      const ratioDrop = Number(ratioText)
      if (!Number.isInteger(gear) || !Number.isFinite(ratioDrop)) return null
      return { gear, ratioDrop, token: part }
    })
    .filter((part): part is GearboxSignaturePart => part !== null)
}

function signaturesHaveCompatibleKnownParts(
  previous: GearboxSignaturePart[],
  detected: GearboxSignaturePart[]
): boolean {
  const detectedByGear = new Map(detected.map(part => [part.gear, part.ratioDrop]))
  return previous.every((part) => {
    const detectedRatio = detectedByGear.get(part.gear)
    return detectedRatio === undefined
      || Math.abs(detectedRatio - part.ratioDrop) <= GEARBOX_SIGNATURE_TOLERANCE
  })
}

function signaturesShareKnownPart(
  left: GearboxSignaturePart[],
  right: GearboxSignaturePart[]
): boolean {
  const rightGears = new Set(right.map(part => part.gear))
  return left.some(part => rightGears.has(part.gear))
}

function signaturesAreCompatible(left: string, right: string): boolean {
  const leftParts = parseGearboxSignature(left)
  const rightParts = parseGearboxSignature(right)
  if (leftParts.length === 0 || rightParts.length === 0) return false
  return signaturesShareKnownPart(leftParts, rightParts)
    && signaturesHaveCompatibleKnownParts(leftParts, rightParts)
    && signaturesHaveCompatibleKnownParts(rightParts, leftParts)
}

function mergeGearboxSignatures(previous: string | null, detected: string): string {
  if (!previous) return detected
  const previousParts = parseGearboxSignature(previous)
  const detectedParts = parseGearboxSignature(detected)
  if (previousParts.length === 0 || detectedParts.length === 0) return detected
  if (!signaturesAreCompatible(previous, detected)) return detected

  const detectedGears = new Set(detectedParts.map(part => part.gear))
  if (previousParts.some(part => !detectedGears.has(part.gear))) return previous

  const previousByGear = new Map(previousParts.map(part => [part.gear, part]))
  const merged = detectedParts.map(part => previousByGear.get(part.gear) ?? part)
  for (const part of previousParts) {
    if (!merged.some(candidate => candidate.gear === part.gear)) merged.push(part)
  }
  return merged
    .sort((left, right) => left.gear - right.gear)
    .map(part => part.token)
    .join('|')
}

function isSignatureExtension(previous: string, next: string): boolean {
  const previousParts = parseGearboxSignature(previous)
  const nextParts = parseGearboxSignature(next)
  const nextGears = new Set(nextParts.map(part => part.gear))
  return nextParts.length > previousParts.length
    && previousParts.every(part => nextGears.has(part.gear))
    && signaturesHaveCompatibleKnownParts(previousParts, nextParts)
}

/**
 * FH6 does not expose a car-specific shift RPM. This stable identity is the
 * smallest useful key for a learned engine profile and deliberately avoids a
 * user-facing car-card workflow.
 */
export function getShiftLightCarKey(telemetry: Telemetry): string | null {
  const ordinal = telemetry.car?.ordinal
  const carClass = telemetry.car?.class
  const pi = telemetry.car?.pi
  const drivetrain = telemetry.car?.drivetrain
  const cylinders = telemetry.car?.cylinders
  const rpmMax = telemetry.rpmMax
  if (!Number.isFinite(ordinal) || ordinal <= 0) return null
  if (!Number.isFinite(carClass) || carClass < 0) return null
  if (!Number.isFinite(pi) || pi <= 0) return null
  if (!Number.isFinite(drivetrain) || drivetrain < 0) return null
  if (!Number.isFinite(cylinders) || cylinders <= 0) return null
  if (!Number.isFinite(rpmMax) || rpmMax <= 0) return null
  return [
    'fh6',
    Math.round(ordinal),
    Math.round(carClass),
    Math.round(pi),
    Math.round(drivetrain),
    Math.round(cylinders),
    roundRpm(rpmMax)
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
    rpmMax: Number(parts[6]),
    key
  }
}

interface PendingUpshift {
  sourceGear: number
  peakRpm: number
  neutralFrames: number
  firstNeutralTimestampMs: number
}

interface LimiterCandidate {
  gear: number
  peakRpm: number
}

/**
 * Learns an independent target for each source gear. Forza commonly reports
 * an upshift as `2 -> 11 -> 3`, so the learner deliberately carries the
 * previous pull through a short neutral transition before recording it.
 */
export class ShiftLightLearner {
  private readonly profiles = new Map<number, ShiftLightProfile>()
  private readonly samples = new Map<number, number[]>()
  private readonly observedGears = new Set<number>()
  private readonly optimalCandidates = new Map<number, OptimalShiftEstimate[]>()
  private readonly optimalEstimator = new OptimalShiftEstimator()
  private readonly storedGearboxSignatures = new Map<number, string | null>()
  private readonly terminalLimiterSamples = new Map<number, number>()
  private previous: Telemetry | null = null
  private pullGear: number | null = null
  private pullPeakRpm = 0
  private limiterCommitted = false
  private limiterCandidate: LimiterCandidate | null = null
  private pendingUpshift: PendingUpshift | null = null
  private rpmRate: number | null = null
  private gearboxSignature: string | null = null
  private maxObservedGear = 0
  private confirmedGearCount: number | null = null
  private gearboxChanged = false
  private readonly dirtyGears = new Set<number>()

  constructor(
    private readonly key: string,
    private readonly options: ShiftLightLearnerOptions = {}
  ) {}

  /** Compatibility helper for callers that only have one stored profile. */
  setProfile(profile: ShiftLightProfile | null): void {
    if (profile) this.setProfiles([profile])
  }

  setProfiles(profiles: ShiftLightProfile[]): void {
    for (const profile of profiles) {
      if (profile.key !== this.key) continue
      if (!Number.isInteger(profile.gear) || profile.gear < 0 || profile.gear > 10) continue
      if (!Number.isFinite(profile.shiftRpm) && !Array.isArray(profile.samples)) continue
      if (this.dirtyGears.has(profile.gear)) continue
      const samples = this.normalizeSamples(profile.samples)
      const method = profile.method === 'optimal' ? 'optimal' : 'observed'
      const maxSampleCount = method === 'optimal' ? 999 : MAX_EVIDENCE_SAMPLES
      const storedSampleCount = Number.isFinite(profile.sampleCount)
        ? Math.max(0, Math.round(profile.sampleCount))
        : 0
      const sampleCount = Math.min(
        maxSampleCount,
        Math.max(storedSampleCount, samples.length)
      )
      const storedShiftRpm = typeof profile.shiftRpm === 'number' && Number.isFinite(profile.shiftRpm)
        ? roundRpm(profile.shiftRpm)
        : null
      const completedObservedShiftRpm = storedShiftRpm === null && method === 'observed'
        ? observedShiftRpm(samples)
        : null
      const effectiveShiftRpm = storedShiftRpm ?? completedObservedShiftRpm
      const calibrated = effectiveShiftRpm !== null
        && (profile.status === 'calibrated' || sampleCount >= REQUIRED_SAMPLES)
      const normalized: ShiftLightProfile = {
        key: this.key,
        gear: profile.gear,
        shiftRpm: calibrated ? effectiveShiftRpm : null,
        sampleCount,
        status: calibrated ? 'calibrated' : 'learning',
        samples,
        method,
        ratioDrop: Number.isFinite(profile.ratioDrop) ? profile.ratioDrop : null,
        gearboxSignature: normalizeGearboxSignature(profile.gearboxSignature)
      }
      this.storedGearboxSignatures.set(normalized.gear, normalized.gearboxSignature ?? null)
      if (!calibrated) {
        if (samples.length > 0) this.samples.set(normalized.gear, samples)
        this.observedGears.add(normalized.gear)
        continue
      }
      // A persisted optimal target is the best known result for this exact
      // vehicle identity. Keep it active across restarts while fresh telemetry
      // validates it in the background; validation must not turn the HUD blank.
      this.profiles.set(normalized.gear, normalized)
      if (samples.length > 0) this.samples.set(normalized.gear, samples)
      if (normalized.gear > 0) this.observedGears.add(normalized.gear)
    }
  }

  getProfiles(): ShiftLightProfile[] {
    return [...this.profiles.values()].sort((left, right) => left.gear - right.gear)
  }

  reset(): void {
    this.profiles.clear()
    this.samples.clear()
    this.observedGears.clear()
    this.optimalCandidates.clear()
    this.storedGearboxSignatures.clear()
    this.dirtyGears.clear()
    this.optimalEstimator.reset()
    this.gearboxSignature = null
    this.maxObservedGear = 0
    this.confirmedGearCount = null
    this.terminalLimiterSamples.clear()
    this.gearboxChanged = false
    this.resetPull()
    this.previous = null
    this.rpmRate = null
  }

  /**
   * Pause/disconnect boundaries must not erase calibration. They only end the
   * in-progress pull so the next live packet cannot create a false shift.
   */
  resetTransient(): void {
    this.resetPull()
    this.previous = null
    this.rpmRate = null
  }

  update(telemetry: Telemetry): ShiftLightSnapshot {
    let previous = this.previous
    if (previous && !this.hasContinuousTimestamp(previous, telemetry)) {
      this.resetTransient()
      previous = null
    }
    const wot = Number.isFinite(telemetry.throttle) && telemetry.throttle >= MIN_THROTTLE
    const forward = isForwardGear(telemetry.gear)
    const neutral = telemetry.gear === NEUTRAL_GEAR

    if (forward) {
      this.observedGears.add(telemetry.gear)
      this.observeGear(telemetry.gear)
    }
    this.optimalEstimator.ingest(telemetry)
    const detectedGearboxSignature = this.optimalEstimator.getGearboxSignature()
    if (detectedGearboxSignature) this.updateGearboxSignature(detectedGearboxSignature)
    this.updateOptimalProfiles()
    this.updateRpmRate(previous, telemetry, wot, forward)

    if (forward) {
      const transition = this.getUpshiftTransition(previous, telemetry)
      if (!wot) {
        this.resetPull()
        this.previous = telemetry
        return this.snapshot(telemetry)
      }
      if (transition && transition.peakRpm >= telemetry.rpmMax * MIN_RPM_FRACTION) {
        if (!this.limiterCommitted) this.recordSample(transition.sourceGear, transition.peakRpm)
        if (
          telemetry.gear === transition.sourceGear + 1
          && telemetry.rpm > 0
          && Number.isFinite(telemetry.clutch)
          && telemetry.clutch <= 0.05
        ) {
          this.optimalEstimator.observeUpshiftRatio(
            transition.sourceGear,
            telemetry.rpm / transition.peakRpm
          )
        }
        this.limiterCandidate = null
      }

      this.pendingUpshift = null
      if (this.pullGear !== telemetry.gear) {
        this.pullGear = telemetry.gear
        this.pullPeakRpm = 0
        this.limiterCommitted = false
        this.limiterCandidate = null
      }

      if (telemetry.rpm < this.pullPeakRpm * REARM_FRACTION) {
        this.pullPeakRpm = 0
        this.limiterCommitted = false
        this.limiterCandidate = null
      }

      const rpmDrop = Math.max(MIN_RPM_DROP, telemetry.rpmMax * RPM_DROP_FRACTION)
      if (
        !this.limiterCommitted
        && this.pullPeakRpm >= telemetry.rpmMax * MIN_RPM_FRACTION
        && this.pullPeakRpm - telemetry.rpm >= rpmDrop
      ) {
        if (this.limiterCandidate?.gear === telemetry.gear) {
          if (!this.hasCompatibleProfile(telemetry.gear)) {
            this.recordSample(telemetry.gear, this.limiterCandidate.peakRpm)
          }
          this.optimalEstimator.observeLimiter(this.limiterCandidate.peakRpm)
          this.recordTerminalLimiterEvidence(telemetry.gear)
          this.limiterCandidate = null
          this.limiterCommitted = true
        } else {
          this.limiterCandidate = {
            gear: telemetry.gear,
            peakRpm: this.pullPeakRpm
          }
        }
      }

      this.pullPeakRpm = Math.max(this.pullPeakRpm, telemetry.rpm)
    } else if (neutral && this.pullGear !== null && this.pullPeakRpm >= telemetry.rpmMax * MIN_RPM_FRACTION) {
      const firstNeutralTimestampMs = this.pendingUpshift?.sourceGear === this.pullGear
        ? this.pendingUpshift.firstNeutralTimestampMs
        : telemetry.timestampMs
      const neutralFrames = this.pendingUpshift?.sourceGear === this.pullGear
        ? this.pendingUpshift.neutralFrames + 1
        : 1
      const neutralDurationMs = telemetry.timestampMs - firstNeutralTimestampMs
      if (
        Number.isFinite(neutralDurationMs)
        && neutralDurationMs <= MAX_NEUTRAL_MS
        && neutralFrames <= MAX_NEUTRAL_FRAMES
      ) {
        this.pendingUpshift = {
          sourceGear: this.pullGear,
          peakRpm: this.pullPeakRpm,
          neutralFrames,
          firstNeutralTimestampMs
        }
      } else {
        this.resetPull()
      }
    } else if (!neutral) {
      this.resetPull()
    }

    this.previous = telemetry
    return this.snapshot(telemetry)
  }

  snapshot(telemetry: Telemetry | null = this.previous): ShiftLightSnapshot {
    const identity = this.parseIdentity()
    const currentGear = telemetry && isForwardGear(telemetry.gear) ? telemetry.gear : null
    const activeStoredProfile = currentGear === null
      ? this.profiles.get(0)
      : this.profiles.get(currentGear) ?? this.profiles.get(0)
    const activeProfile = activeStoredProfile && this.isProfileUsable(activeStoredProfile)
      ? activeStoredProfile
      : null
    const currentSamples = currentGear === null ? [] : this.samples.get(currentGear) ?? []
    const gearboxValidation = this.getGearboxValidation(currentGear, activeProfile)
    const status: ShiftLightStatus = activeProfile ? 'calibrated' : 'learning'
    const shiftRpm = activeProfile?.shiftRpm ?? null
    let phase = fallbackPhase(telemetry?.rpm ?? 0, telemetry?.rpmMax ?? 0)

    if (shiftRpm !== null && telemetry) {
      const approachWindow = Math.max(250, shiftRpm * 0.04)
      const rpmRate = this.rpmRate
      const predictiveRate = activeProfile?.method !== null && activeProfile?.method !== undefined && rpmRate !== null && rpmRate > 0
        ? rpmRate
        : null
      const shiftLead = predictiveRate !== null
        ? Math.min(MAX_SHIFT_SIGNAL_LEAD_RPM, predictiveRate * SHIFT_SIGNAL_LEAD_MS / 1000)
        : 0
      const approachLead = predictiveRate !== null
        ? Math.max(approachWindow, Math.min(MAX_APPROACH_SIGNAL_LEAD_RPM, predictiveRate * APPROACH_SIGNAL_LEAD_MS / 1000))
        : approachWindow
      if (telemetry.rpm >= shiftRpm - shiftLead) phase = 'shift'
      else if (telemetry.rpm >= shiftRpm - approachLead) phase = 'approach'
      else phase = 'normal'
    }

    return {
      status,
      phase,
      shiftRpm,
      sampleCount: activeProfile?.sampleCount ?? currentSamples.length,
      carKey: this.key,
      gameId: identity?.gameId ?? null,
      carOrdinal: identity?.carOrdinal ?? null,
      pi: identity?.pi ?? null,
      rpmMax: identity?.rpmMax ?? null,
      carClass: identity?.carClass ?? null,
      drivetrain: identity?.drivetrain ?? null,
      cylinders: identity?.cylinders ?? null,
      gearCount: this.confirmedGearCount,
      observedGearCount: this.maxObservedGear,
      gearboxChanged: this.gearboxChanged,
      gearboxValidation,
      gearboxSignature: this.gearboxSignature,
      currentGear,
      method: activeProfile?.method ?? null,
      gears: this.getGearStates(),
      diagnostics: this.getGearDiagnostics()
    }
  }

  private getUpshiftTransition(previous: Telemetry | null, telemetry: Telemetry): { sourceGear: number, peakRpm: number } | null {
    if (
      this.pendingUpshift
      && telemetry.gear > this.pendingUpshift.sourceGear
      && telemetry.timestampMs - this.pendingUpshift.firstNeutralTimestampMs <= MAX_NEUTRAL_MS
    ) {
      return this.pendingUpshift
    }
    if (
      previous
      && isForwardGear(previous.gear)
      && telemetry.gear > previous.gear
      && this.pullGear === previous.gear
    ) {
      return { sourceGear: previous.gear, peakRpm: this.pullPeakRpm }
    }
    return null
  }

  private getGearStates(): ShiftLightGearState[] {
    const gears = new Set([
      ...this.observedGears,
      ...this.samples.keys(),
      ...[...this.profiles.keys()].filter(gear => gear > 0),
      ...this.storedGearboxSignatures.keys()
    ])
    return [...gears].sort((left, right) => left - right).map((gear) => {
      const profile = this.profiles.get(gear)
      const profileUsable = this.isProfileUsable(profile)
      const samples = this.samples.get(gear) ?? []
      return {
        gear,
        status: profileUsable && profile ? 'calibrated' : 'learning',
        shiftRpm: profileUsable ? profile?.shiftRpm ?? null : null,
        sampleCount: profileUsable && profile ? profile.sampleCount : samples.length,
        method: profileUsable ? profile?.method ?? null : null,
        ratioDrop: profileUsable ? profile?.ratioDrop ?? null : null
      }
    })
  }

  private getGearDiagnostics(): ShiftLightGearDiagnostics[] {
    const gears = new Set([
      ...this.observedGears,
      ...this.samples.keys(),
      ...this.profiles.keys(),
      ...this.storedGearboxSignatures.keys()
    ])
    return [...gears]
      .filter(gear => gear > 0)
      .sort((left, right) => left - right)
      .map((gear) => {
        const storedProfile = this.profiles.get(gear)
        const profile = this.isProfileUsable(storedProfile) ? storedProfile : undefined
        const diagnostics = this.optimalEstimator.diagnose(gear)
        let status: ShiftLightDiagnosticStatus

        if (profile?.method === 'optimal') status = 'optimal'
        else if (diagnostics.powerBinCount === 0 || diagnostics.powerCurveCoverage < 0.9) status = 'waiting-for-wot'
        else if (
          diagnostics.currentRatioSamples < 20
          || diagnostics.nextRatioSamples < 20
          || diagnostics.ratioDrop === null
        ) status = 'waiting-for-ratio'
        else if (diagnostics.targetRpm !== null) status = 'confirming'
        else if (profile?.method === 'observed') status = 'observed'
        else status = 'learning'

        return {
          ...diagnostics,
          status,
          method: profile?.method ?? null
        }
      })
  }

  private updateOptimalProfiles(): void {
    for (const gear of this.observedGears) {
      const estimate = this.optimalEstimator.estimate(gear)
      if (!estimate) continue

      const candidates = this.optimalCandidates.get(gear) ?? []
      candidates.push(estimate)
      if (candidates.length > OPTIMAL_CONFIRM_SAMPLES) candidates.shift()
      this.optimalCandidates.set(gear, candidates)
      if (candidates.length < OPTIMAL_CONFIRM_SAMPLES) continue

      const targetValues = candidates.map(candidate => candidate.shiftRpm)
      if (Math.max(...targetValues) - Math.min(...targetValues) > OPTIMAL_STABILITY_RPM) continue
      const target = roundRpm(targetValues.reduce((sum, value) => sum + value, 0) / targetValues.length)
      const latest = candidates.at(-1)!
      const existing = this.profiles.get(gear)
      if (
        existing?.method === 'optimal'
        && existing.shiftRpm !== null
        && Math.abs(existing.shiftRpm - target) < OPTIMAL_UPDATE_RPM
      ) continue

      const profile: ShiftLightProfile = {
        key: this.key,
        gear,
        shiftRpm: target,
        sampleCount: latest.evidence,
        status: 'calibrated',
        samples: [],
        method: 'optimal',
        ratioDrop: latest.ratioDrop,
        gearboxSignature: this.gearboxSignature
      }
      this.profiles.set(gear, profile)
      this.options.onCalibrated?.(profile)
    }
  }

  private updateRpmRate(
    previous: Telemetry | null,
    telemetry: Telemetry,
    wot: boolean,
    forward: boolean
  ): void {
    if (!previous || !wot || !forward || previous.gear !== telemetry.gear) {
      this.rpmRate = null
      return
    }

    const dt = (telemetry.timestampMs - previous.timestampMs) / 1000
    const rate = (telemetry.rpm - previous.rpm) / dt
    if (dt < 0.005 || dt > 0.1 || !Number.isFinite(rate) || rate <= 0 || rate > MAX_RPM_RATE) {
      this.rpmRate = null
      return
    }

    this.rpmRate = this.rpmRate === null
      ? rate
      : this.rpmRate * (1 - RPM_RATE_ALPHA) + rate * RPM_RATE_ALPHA
  }

  private resetPull(): void {
    this.pullGear = null
    this.pullPeakRpm = 0
    this.limiterCommitted = false
    this.limiterCandidate = null
    this.pendingUpshift = null
  }

  private observeGear(gear: number): void {
    if (gear <= this.maxObservedGear) return
    this.maxObservedGear = gear
    if (this.confirmedGearCount !== null && gear > this.confirmedGearCount) {
      this.confirmedGearCount = null
    }
  }

  private recordTerminalLimiterEvidence(gear: number): void {
    if (gear !== this.maxObservedGear) return
    const count = (this.terminalLimiterSamples.get(gear) ?? 0) + 1
    this.terminalLimiterSamples.set(gear, count)
    if (count >= REQUIRED_TERMINAL_LIMITER_SAMPLES) this.confirmedGearCount = gear
  }

  private recordSample(gear: number, observedRpm: number): void {
    if (gear < 1 || gear > 10 || this.hasCompatibleProfile(gear) || !Number.isFinite(observedRpm)) return
    const gearSamples = this.samples.get(gear) ?? []
    if (gearSamples.length >= REQUIRED_SAMPLES) return
    gearSamples.push(roundRpm(observedRpm))
    this.samples.set(gear, gearSamples)
    this.storedGearboxSignatures.set(gear, this.gearboxSignature)
    this.observedGears.add(gear)
    this.dirtyGears.add(gear)
    if (gearSamples.length < REQUIRED_SAMPLES) {
      this.options.onProgress?.({
        key: this.key,
        gear,
        shiftRpm: null,
        sampleCount: gearSamples.length,
        status: 'learning',
        samples: [...gearSamples],
        method: 'observed',
        ratioDrop: null,
        gearboxSignature: this.gearboxSignature
      })
      return
    }

    const observedAverage = gearSamples.reduce((sum, rpm) => sum + rpm, 0) / gearSamples.length
    const profile: ShiftLightProfile = {
      key: this.key,
      gear,
      shiftRpm: roundRpm(observedAverage - RPM_OFFSET),
      sampleCount: gearSamples.length,
      status: 'calibrated',
      samples: [...gearSamples],
      method: 'observed',
      ratioDrop: null,
      gearboxSignature: this.gearboxSignature
    }
    this.profiles.set(gear, profile)
    this.options.onProgress?.(profile)
    this.options.onCalibrated?.(profile)
  }

  private normalizeSamples(samples: number[] | undefined): number[] {
    if (!Array.isArray(samples)) return []
    return samples
      .filter(sample => Number.isFinite(sample))
      .slice(0, MAX_EVIDENCE_SAMPLES)
      .map(sample => roundRpm(sample))
  }

  private updateGearboxSignature(signature: string): void {
    if (this.gearboxSignature !== null && !signaturesAreCompatible(this.gearboxSignature, signature)) {
      // Wheel-derived AWD ratios can legitimately float. A contradictory live
      // signature is a diagnostic signal, never authorization to erase a
      // persisted calibration. The cached target stays available until an
      // explicit reset or a later, deliberate gearbox-generation workflow.
      this.gearboxChanged = true
      this.gearboxSignature = signature
      return
    }
    const nextSignature = mergeGearboxSignatures(this.gearboxSignature, signature)
    if (nextSignature === this.gearboxSignature) return

    const previousSignature = this.gearboxSignature
    const unsignedEvidenceGears = previousSignature === null
      ? this.bindUnsignedEvidence(nextSignature)
      : new Set<number>()
    const canMigrateEvidence = previousSignature !== null
      && isSignatureExtension(previousSignature, nextSignature)
    this.gearboxSignature = nextSignature
    this.gearboxChanged = false
    const migratedGears = new Set<number>()

    if (canMigrateEvidence) {
      for (const [gear, profile] of this.profiles) {
        if (profile.gearboxSignature !== previousSignature) continue
        const migrated = { ...profile, gearboxSignature: nextSignature }
        this.profiles.set(gear, migrated)
        migratedGears.add(gear)
        this.options.onProgress?.(migrated)
      }
    }

    for (const [gear, storedSignature] of this.storedGearboxSignatures) {
      if (unsignedEvidenceGears.has(gear)) continue
      if (canMigrateEvidence && storedSignature === previousSignature) {
        this.storedGearboxSignatures.set(gear, nextSignature)
        const samples = this.samples.get(gear)
        if (samples && samples.length > 0 && !migratedGears.has(gear)) {
          this.options.onProgress?.({
            key: this.key,
            gear,
            shiftRpm: null,
            sampleCount: samples.length,
            status: 'learning',
            samples: [...samples],
            method: 'observed',
            ratioDrop: null,
            gearboxSignature: nextSignature
          })
        }
        continue
      }
      this.samples.delete(gear)
      this.storedGearboxSignatures.delete(gear)
      this.dirtyGears.delete(gear)
    }
  }

  private clearCalibrationForGearboxChange(): void {
    this.profiles.clear()
    this.samples.clear()
    this.optimalCandidates.clear()
    this.storedGearboxSignatures.clear()
    this.dirtyGears.clear()
    this.gearboxChanged = true
  }

  /**
   * Profiles may be learned before enough adjacent gears have been driven to
   * create a gearbox signature. The first signature is evidence for that same
   * live gearbox, not a tune change, so attach unsigned evidence instead of
   * invalidating it.
   */
  private bindUnsignedEvidence(signature: string): Set<number> {
    const boundGears = new Set<number>()
    for (const [gear, profile] of this.profiles) {
      if (profile.gearboxSignature !== null && profile.gearboxSignature !== undefined) continue
      const bound = { ...profile, gearboxSignature: signature }
      this.profiles.set(gear, bound)
      boundGears.add(gear)
      this.options.onProgress?.(bound)
    }
    for (const [gear, storedSignature] of this.storedGearboxSignatures) {
      if (storedSignature === null || storedSignature === undefined) {
        this.storedGearboxSignatures.set(gear, signature)
        boundGears.add(gear)
      }
    }
    return boundGears
  }

  clearConfiguration(): void {
    this.clearCalibrationForGearboxChange()
    this.gearboxChanged = false
  }

  private isGearboxCompatible(signature: string | null | undefined): boolean {
    if (!this.gearboxSignature) return true
    const normalized = normalizeGearboxSignature(signature)
    return normalized !== null && signaturesAreCompatible(this.gearboxSignature, normalized)
  }

  private hasCompatibleProfile(gear: number): boolean {
    return this.isProfileUsable(this.profiles.get(gear))
  }

  private isProfileUsable(profile: ShiftLightProfile | undefined): boolean {
    if (!profile) return false
    // An observed target is weak, driver-dependent evidence and should be
    // relearned when its gearbox evidence contradicts it. An optimal target is
    // a persisted physics result: keep it visible and validate in background.
    return profile.method === 'optimal' || this.isGearboxCompatible(profile.gearboxSignature)
  }

  private getGearboxValidation(
    gear: number | null,
    profile: ShiftLightProfile | null
  ): GearboxValidation {
    if (profile?.method !== 'optimal' || profile.ratioDrop === null || profile.ratioDrop === undefined) return null
    if (this.gearboxChanged) return 'checking'
    if (gear === null) return 'validating'
    const liveRatio = this.optimalEstimator.getRatioDrop(gear)
    if (!liveRatio) return 'validating'
    const relativeDifference = Math.abs(liveRatio.ratioDrop - profile.ratioDrop) / profile.ratioDrop
    if (relativeDifference > 0.025) return 'checking'
    return this.gearboxSignature ? 'verified' : 'validating'
  }

  private hasContinuousTimestamp(previous: Telemetry, telemetry: Telemetry): boolean {
    const previousTimestampMs = previous.timestampMs
    const timestampMs = telemetry.timestampMs
    if (!Number.isFinite(previousTimestampMs) || !Number.isFinite(timestampMs)) return false
    const deltaMs = timestampMs - previousTimestampMs
    return deltaMs >= 0 && deltaMs <= MAX_TIMESTAMP_GAP_MS
  }

  private parseIdentity(): {
    gameId: string
    carOrdinal: number
    carClass: number
    pi: number
    drivetrain: number
    cylinders: number
    rpmMax: number
  } | null {
    const parts = this.key.split(':')
    if (parts.length !== 7 || parts[0] !== 'fh6') return null
    const values = parts.slice(1).map(value => Number(value))
    const [carOrdinal, carClass, pi, drivetrain, cylinders, rpmMax] = values
    if (
      carOrdinal === undefined || !Number.isFinite(carOrdinal) || carOrdinal <= 0
      || carClass === undefined || !Number.isFinite(carClass) || carClass < 0
      || pi === undefined || !Number.isFinite(pi) || pi <= 0
      || drivetrain === undefined || !Number.isFinite(drivetrain) || drivetrain < 0
      || cylinders === undefined || !Number.isFinite(cylinders) || cylinders <= 0
      || rpmMax === undefined || !Number.isFinite(rpmMax) || rpmMax <= 0
    ) return null
    return {
      gameId: 'fh6',
      carOrdinal,
      carClass,
      pi,
      drivetrain,
      cylinders,
      rpmMax
    }
  }
}

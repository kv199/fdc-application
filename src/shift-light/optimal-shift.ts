// Canonical build-time dependency of the FDC HUD Shift Light learner.
import type { Telemetry } from './telemetry'

export interface OptimalShiftEstimate {
  gear: number
  shiftRpm: number
  ratioDrop: number
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
}

interface PowerBin {
  powers: number[]
}

const FORWARD_GEAR_MIN = 1
const FORWARD_GEAR_MAX = 10
const WOT_THRESHOLD = 0.95
const POWER_BIN_RPM = 200
const MIN_POWER_SAMPLES = 2
const MAX_POWER_SAMPLES_PER_BIN = 24
const MAX_RATIO_SAMPLES = 240
const MIN_RATIO_SAMPLES = 20
const MAX_DIRECT_RATIO_SAMPLES = 24
const MIN_DIRECT_RATIO_SAMPLES = 3
const MIN_GEARBOX_SIGNATURE_DROPS = 2
const MAX_GEARBOX_SIGNATURE_DROPS = FORWARD_GEAR_MAX - FORWARD_GEAR_MIN
const GEARBOX_SIGNATURE_SCALE = 1000
const GEARBOX_SIGNATURE_FORMAT_DECIMALS = 4
const MIN_DRIVEN_WHEEL_RAD_S = 5
const MIN_ENGINE_RPM = 1200
const MAX_CLUTCH = 0.05
const MAX_BRAKE = 0.02
const MAX_HANDBRAKE = 0.02
const MAX_DRIVEN_COMBINED_SLIP = 0.2
const MIN_RATIO_DROP = 0.45
const MAX_RATIO_DROP = 0.95
const MIN_TARGET_RPM_FRACTION = 0.65
const MAX_TARGET_RPM_FRACTION = 0.99
const CURVE_COVERAGE_FRACTION = 0.90
const LIMITER_TARGET_FRACTION = 0.98
const LIMITER_SAFETY_RPM = 100
const MAX_INTERPOLATION_GAP_RPM = POWER_BIN_RPM * 2
const TARGET_STEP_RPM = 25
const CROSSOVER_CONFIRM_STEPS = 3
const RATIO_OUTLIER_FRACTION = 0.08
const RATIO_REACQUIRE_SAMPLES = 3
const LIMITER_STABILITY_RPM = 120
const LIMITER_REACQUIRE_SAMPLES = 2

function isForwardGear(gear: number): boolean {
  return Number.isFinite(gear) && gear >= FORWARD_GEAR_MIN && gear <= FORWARD_GEAR_MAX
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle]!
  return (sorted[middle - 1]! + sorted[middle]!) / 2
}

function drivenWheelSpeed(telemetry: Telemetry): number | null {
  const wheels = telemetry.wheelRotation
  if (!wheels) return null

  const values = telemetry.car.drivetrain === 0
    ? [wheels.fl, wheels.fr]
    : telemetry.car.drivetrain === 1
      ? [wheels.rl, wheels.rr]
      : [wheels.fl, wheels.fr, wheels.rl, wheels.rr]
  if (values.some(value => !Number.isFinite(value))) return null

  const average = values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length
  return average >= MIN_DRIVEN_WHEEL_RAD_S ? average : null
}

function drivenWheelValues(telemetry: Telemetry, values: { fl: number, fr: number, rl: number, rr: number }): number[] {
  return telemetry.car.drivetrain === 0
    ? [values.fl, values.fr]
    : telemetry.car.drivetrain === 1
      ? [values.rl, values.rr]
      : [values.fl, values.fr, values.rl, values.rr]
}

function hasCleanDriveEvidence(telemetry: Telemetry): boolean {
  if (Number.isFinite(telemetry.brake) && telemetry.brake > MAX_BRAKE) return false
  if (Number.isFinite(telemetry.handBrake) && telemetry.handBrake > MAX_HANDBRAKE) return false

  const slip = telemetry.combinedSlip
  if (!slip) return true
  const drivenSlip = drivenWheelValues(telemetry, slip)
  return drivenSlip.every(value => !Number.isFinite(value) || Math.abs(value) <= MAX_DRIVEN_COMBINED_SLIP)
}

export function isCleanShiftEvidence(telemetry: Telemetry): boolean {
  return telemetry.isRaceOn !== false
    && Number.isFinite(telemetry.throttle) && telemetry.throttle >= WOT_THRESHOLD
    && Number.isFinite(telemetry.clutch) && telemetry.clutch <= MAX_CLUTCH
    && Number.isFinite(telemetry.rpm) && telemetry.rpm > 0
    && hasCleanDriveEvidence(telemetry)
}

function representativePower(bin: PowerBin): number | null {
  return median(bin.powers)
}

/**
 * Builds the two facts required for an acceleration-optimal upshift:
 *
 * 1. the WOT engine-power curve;
 * 2. the RPM drop between adjacent gears, measured from engine RPM divided by
 *    driven-wheel angular speed.
 *
 * At one road speed, comparing engine power in the current gear with engine
 * power at the post-shift RPM is equivalent to comparing wheel force. This
 * avoids guessing final drive, tyre radius, or drivetrain efficiency.
 */
export class OptimalShiftEstimator {
  private readonly powerBins = new Map<number, PowerBin>()
  private readonly ratioSamples = new Map<number, number[]>()
  private readonly directRatioDrops = new Map<number, number[]>()
  private readonly limiterSamples: number[] = []
  private readonly ratioAlternates = new Map<string, { value: number, count: number }>()
  private limiterAlternate: { value: number, count: number } | null = null
  private lastLimiterEvidenceKey: number | null = null
  private rpmMax = 0

  ingest(telemetry: Telemetry): void {
    if (Number.isFinite(telemetry.rpmMax) && telemetry.rpmMax > this.rpmMax) {
      this.rpmMax = telemetry.rpmMax
    }

    this.ingestRatio(telemetry)
    this.ingestPower(telemetry)
  }

  reset(): void {
    this.powerBins.clear()
    this.ratioSamples.clear()
    this.directRatioDrops.clear()
    this.limiterSamples.length = 0
    this.ratioAlternates.clear()
    this.limiterAlternate = null
    this.lastLimiterEvidenceKey = null
    this.rpmMax = 0
  }

  /**
   * A ratio measured across a completed upshift does not depend on tyre size,
   * driven-wheel selection, or wheelspin during the pull. It is preferred once
   * repeated clean shifts agree, while wheel-derived ratios remain a fallback.
   */
  observeUpshiftRatio(gear: number, ratioDrop: number): void {
    if (!isForwardGear(gear) || !Number.isFinite(ratioDrop)) return
    if (ratioDrop < MIN_RATIO_DROP || ratioDrop > MAX_RATIO_DROP) return
    const samples = this.directRatioDrops.get(gear) ?? []
    this.pushStableRatio(samples, ratioDrop, MAX_DIRECT_RATIO_SAMPLES, `direct:${gear}`)
    this.directRatioDrops.set(gear, samples)
  }

  observeLimiter(rpm: number, evidenceKey?: number): void {
    if (!Number.isFinite(rpm) || rpm <= 0) return
    if (evidenceKey !== undefined) {
      if (!Number.isInteger(evidenceKey) || evidenceKey === this.lastLimiterEvidenceKey) return
      this.lastLimiterEvidenceKey = evidenceKey
    }

    const baseline = this.limiterSamples.length >= 2 ? median(this.limiterSamples) : null
    if (baseline !== null && Math.abs(rpm - baseline) > LIMITER_STABILITY_RPM) {
      if (
        this.limiterAlternate !== null
        && Math.abs(rpm - this.limiterAlternate.value) <= LIMITER_STABILITY_RPM
      ) {
        this.limiterAlternate = {
          value: (this.limiterAlternate.value * this.limiterAlternate.count + rpm)
            / (this.limiterAlternate.count + 1),
          count: this.limiterAlternate.count + 1
        }
      } else {
        this.limiterAlternate = { value: rpm, count: 1 }
      }
      if (this.limiterAlternate.count >= LIMITER_REACQUIRE_SAMPLES) {
        this.limiterSamples.length = 0
        this.limiterSamples.push(this.limiterAlternate.value)
        this.limiterAlternate = null
      }
      return
    }

    this.limiterAlternate = null
    this.limiterSamples.push(rpm)
    if (this.limiterSamples.length > 5) this.limiterSamples.shift()
  }

  /** The measured limiter, once two clean independent pulls agree. */
  getEffectiveRpmMax(): number | null {
    if (this.limiterSamples.length < 2) return null
    if (Math.max(...this.limiterSamples) - Math.min(...this.limiterSamples) > LIMITER_STABILITY_RPM) return null
    return median(this.limiterSamples)
  }

  resetTransient(): void {
    this.ratioAlternates.clear()
    this.limiterAlternate = null
  }

  getShiftCeiling(): number {
    return this.getLimiterCap()
  }

  getRatioDrop(gear: number): { ratioDrop: number, evidence: number } | null {
    const directSamples = this.directRatioDrops.get(gear) ?? []
    if (directSamples.length >= MIN_DIRECT_RATIO_SAMPLES && this.ratiosAreConsistent(directSamples)) {
      const directRatioDrop = median(directSamples)
      if (directRatioDrop !== null && directRatioDrop >= MIN_RATIO_DROP && directRatioDrop <= MAX_RATIO_DROP) {
        return { ratioDrop: directRatioDrop, evidence: directSamples.length }
      }
    }

    const currentSamples = this.ratioSamples.get(gear) ?? []
    const nextSamples = this.ratioSamples.get(gear + 1) ?? []
    if (currentSamples.length < MIN_RATIO_SAMPLES || nextSamples.length < MIN_RATIO_SAMPLES) return null

    const currentRatio = median(currentSamples)
    const nextRatio = median(nextSamples)
    if (currentRatio === null || nextRatio === null || currentRatio <= 0) return null

    const ratioDrop = nextRatio / currentRatio
    if (ratioDrop < MIN_RATIO_DROP || ratioDrop > MAX_RATIO_DROP) return null
    return {
      ratioDrop,
      evidence: Math.min(currentSamples.length, nextSamples.length)
    }
  }

  /**
   * Returns a bounded, stable fingerprint once enough adjacent gear ratios
   * have been observed. The learner uses this for every profile method, not
   * only optimal targets, so partial observed evidence cannot cross gearbox
   * variants with the same car identity.
   */
  getGearboxSignature(): string | null {
    const drops: string[] = []
    for (let gear = FORWARD_GEAR_MIN; gear < FORWARD_GEAR_MAX; gear += 1) {
      const ratio = this.getRatioDrop(gear)
      if (!ratio) continue
      const canonicalDrop = Math.round(ratio.ratioDrop * GEARBOX_SIGNATURE_SCALE) / GEARBOX_SIGNATURE_SCALE
      drops.push(`${gear}:${canonicalDrop.toFixed(GEARBOX_SIGNATURE_FORMAT_DECIMALS)}`)
      if (drops.length >= MAX_GEARBOX_SIGNATURE_DROPS) break
    }
    return drops.length >= MIN_GEARBOX_SIGNATURE_DROPS ? drops.join('|') : null
  }

  diagnose(gear: number): OptimalShiftDiagnostics {
    const currentSamples = this.ratioSamples.get(gear) ?? []
    const nextSamples = this.ratioSamples.get(gear + 1) ?? []
    const currentRatio = median(currentSamples)
    const nextRatio = median(nextSamples)
    const rawRatioDrop = currentRatio !== null && nextRatio !== null && currentRatio > 0
      ? nextRatio / currentRatio
      : null
    const ratioDrop = rawRatioDrop !== null && rawRatioDrop >= MIN_RATIO_DROP && rawRatioDrop <= MAX_RATIO_DROP
      ? rawRatioDrop
      : null
    const reliableBins = this.getReliablePowerBins()
    const effectiveRpmMax = this.getEffectiveRpmMax() ?? this.rpmMax
    const highestReliableRpm = reliableBins.at(-1)?.[0] ?? 0
    const peakPower = reliableBins.reduce<[number, PowerBin] | null>((best, candidate) => {
      const candidatePower = representativePower(candidate[1])
      const bestPower = best ? representativePower(best[1]) : null
      return candidatePower !== null && (bestPower === null || candidatePower > bestPower) ? candidate : best
    }, null)
    const estimate = this.estimate(gear)
    const targetRpm = estimate?.shiftRpm ?? null
    const postShiftRpm = targetRpm !== null && ratioDrop !== null
      ? targetRpm * ratioDrop
      : null

    return {
      gear,
      powerCurveCoverage: effectiveRpmMax > 0 ? Math.min(1, highestReliableRpm / effectiveRpmMax) : 0,
      powerBinCount: reliableBins.length,
      peakPowerRpm: peakPower?.[0] ?? null,
      currentRatio,
      nextRatio,
      ratioDrop,
      currentRatioSamples: currentSamples.length,
      nextRatioSamples: nextSamples.length,
      targetRpm,
      postShiftRpm,
      powerAtTarget: targetRpm === null ? null : this.powerAt(targetRpm, reliableBins),
      powerAfterShift: postShiftRpm === null ? null : this.powerAt(postShiftRpm, reliableBins),
      estimateEvidence: estimate?.evidence ?? 0
    }
  }

  estimate(gear: number): OptimalShiftEstimate | null {
    const effectiveRpmMax = this.getEffectiveRpmMax() ?? this.rpmMax
    if (!isForwardGear(gear) || gear >= FORWARD_GEAR_MAX || effectiveRpmMax <= 0) return null
    const ratio = this.getRatioDrop(gear)
    if (!ratio) return null

    const reliableBins = this.getReliablePowerBins()
    if (reliableBins.length < 8) return null

    const highestReliableRpm = reliableBins.at(-1)![0]
    if (highestReliableRpm < effectiveRpmMax * CURVE_COVERAGE_FRACTION) return null

    // Scan the usable upper band instead of assuming that an optimal shift can
    // never precede the absolute power peak. Unusual multi-peak curves are
    // still decided by the same-power-at-the-same-road-speed comparison.
    const firstCandidate = Math.round(effectiveRpmMax * MIN_TARGET_RPM_FRACTION / TARGET_STEP_RPM) * TARGET_STEP_RPM
    const limiterCap = this.getLimiterCap()
    const lastCandidate = Math.min(
      highestReliableRpm,
      Math.floor(Math.min(effectiveRpmMax * MAX_TARGET_RPM_FRACTION, limiterCap) / TARGET_STEP_RPM) * TARGET_STEP_RPM
    )
    let confirmedSteps = 0
    let firstCrossingRpm: number | null = null

    for (let rpm = firstCandidate; rpm <= lastCandidate; rpm += TARGET_STEP_RPM) {
      const currentPower = this.powerAt(rpm, reliableBins)
      const nextPower = this.powerAt(rpm * ratio.ratioDrop, reliableBins)
      if (currentPower === null || nextPower === null || nextPower < currentPower) {
        confirmedSteps = 0
        firstCrossingRpm = null
        continue
      }

      if (confirmedSteps === 0) firstCrossingRpm = rpm
      confirmedSteps += 1
      if (confirmedSteps >= CROSSOVER_CONFIRM_STEPS && firstCrossingRpm !== null) {
        return {
          gear,
          shiftRpm: firstCrossingRpm,
          ratioDrop: ratio.ratioDrop,
          evidence: Math.min(999, ratio.evidence + reliableBins.length)
        }
      }
    }

    const limiterTarget = Math.round(limiterCap / TARGET_STEP_RPM) * TARGET_STEP_RPM
    if (
      highestReliableRpm >= limiterTarget
      && this.powerAt(limiterTarget, reliableBins) !== null
      && this.powerAt(limiterTarget * ratio.ratioDrop, reliableBins) !== null
    ) {
      return {
        gear,
        shiftRpm: limiterTarget,
        ratioDrop: ratio.ratioDrop,
        evidence: Math.min(999, ratio.evidence + reliableBins.length)
      }
    }

    return null
  }

  private ingestRatio(telemetry: Telemetry): void {
    if (!isCleanShiftEvidence(telemetry)) return
    if (!isForwardGear(telemetry.gear)) return
    if (!Number.isFinite(telemetry.throttle) || telemetry.throttle < WOT_THRESHOLD) return
    if (!Number.isFinite(telemetry.rpm) || telemetry.rpm < MIN_ENGINE_RPM) return
    if (!Number.isFinite(telemetry.clutch) || telemetry.clutch > MAX_CLUTCH) return
    if (!hasCleanDriveEvidence(telemetry)) return

    const wheelSpeed = drivenWheelSpeed(telemetry)
    if (wheelSpeed === null) return
    const ratio = telemetry.rpm / wheelSpeed
    if (!Number.isFinite(ratio) || ratio <= 0) return

    const samples = this.ratioSamples.get(telemetry.gear) ?? []
    this.pushStableRatio(samples, ratio, MAX_RATIO_SAMPLES, `wheel:${telemetry.gear}`)
    this.ratioSamples.set(telemetry.gear, samples)
  }

  private ingestPower(telemetry: Telemetry): void {
    if (!isCleanShiftEvidence(telemetry)) return
    if (!isForwardGear(telemetry.gear)) return
    if (!Number.isFinite(telemetry.throttle) || telemetry.throttle < WOT_THRESHOLD) return
    if (!Number.isFinite(telemetry.clutch) || telemetry.clutch > MAX_CLUTCH) return
    if (!Number.isFinite(telemetry.rpm) || telemetry.rpm <= 0) return
    if (!Number.isFinite(telemetry.rpmMax) || telemetry.rpmMax <= 0 || telemetry.rpm > telemetry.rpmMax * 1.05) return
    if (!Number.isFinite(telemetry.power) || telemetry.power <= 0) return
    if (!hasCleanDriveEvidence(telemetry)) return

    const rpmBin = Math.round(telemetry.rpm / POWER_BIN_RPM) * POWER_BIN_RPM
    const existing = this.powerBins.get(rpmBin)
    if (existing) {
      existing.powers.push(telemetry.power)
      if (existing.powers.length > MAX_POWER_SAMPLES_PER_BIN) existing.powers.shift()
    } else {
      this.powerBins.set(rpmBin, { powers: [telemetry.power] })
    }
  }

  private getReliablePowerBins(): [number, PowerBin][] {
    return [...this.powerBins.entries()]
      .filter(([, bin]) => bin.powers.length >= MIN_POWER_SAMPLES && (representativePower(bin) ?? 0) > 0)
      .sort(([left], [right]) => left - right)
  }

  private getLimiterCap(): number {
    const effectiveRpmMax = this.getEffectiveRpmMax()
    const fallback = this.rpmMax * LIMITER_TARGET_FRACTION
    if (effectiveRpmMax === null) return fallback
    return Math.max(0, Math.min(fallback, effectiveRpmMax - LIMITER_SAFETY_RPM))
  }

  private pushStableRatio(samples: number[], ratio: number, maximum: number, key = 'ratio'): void {
    const baseline = samples.length >= 5 ? median(samples) : null
    if (baseline !== null && Math.abs(ratio - baseline) / baseline > RATIO_OUTLIER_FRACTION) {
      const alternate = this.ratioAlternates.get(key)
      if (alternate && Math.abs(ratio - alternate.value) / alternate.value <= RATIO_OUTLIER_FRACTION) {
        alternate.value = (alternate.value * alternate.count + ratio) / (alternate.count + 1)
        alternate.count += 1
      } else {
        this.ratioAlternates.set(key, { value: ratio, count: 1 })
      }
      const next = this.ratioAlternates.get(key)
      const required = key.startsWith('wheel:') ? MIN_RATIO_SAMPLES : RATIO_REACQUIRE_SAMPLES
      if (next && next.count >= required) {
        samples.length = 0
        samples.push(next.value)
        this.ratioAlternates.delete(key)
      }
      return
    }
    this.ratioAlternates.delete(key)
    samples.push(ratio)
    if (samples.length > maximum) samples.shift()
  }

  private ratiosAreConsistent(samples: number[]): boolean {
    const baseline = median(samples)
    return baseline !== null
      && samples.every(sample => Math.abs(sample - baseline) / baseline <= RATIO_OUTLIER_FRACTION)
  }

  private powerAt(rpm: number, bins: [number, PowerBin][]): number | null {
    let lower: [number, PowerBin] | null = null
    let upper: [number, PowerBin] | null = null
    for (const bin of bins) {
      if (bin[0] <= rpm) lower = bin
      if (bin[0] >= rpm) {
        upper = bin
        break
      }
    }
    if (!lower || !upper || upper[0] - lower[0] > MAX_INTERPOLATION_GAP_RPM) return null
    const lowerPower = representativePower(lower[1])
    const upperPower = representativePower(upper[1])
    if (lowerPower === null || upperPower === null) return null
    if (lower[0] === upper[0]) return lowerPower

    const fraction = (rpm - lower[0]) / (upper[0] - lower[0])
    return lowerPower + (upperPower - lowerPower) * fraction
  }
}

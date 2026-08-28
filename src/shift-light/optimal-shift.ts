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
  maxPower: number
  samples: number
}

const FORWARD_GEAR_MIN = 1
const FORWARD_GEAR_MAX = 10
const WOT_THRESHOLD = 0.95
const POWER_BIN_RPM = 100
const MIN_POWER_SAMPLES = 3
const MAX_RATIO_SAMPLES = 240
const MIN_RATIO_SAMPLES = 20
const MIN_GEARBOX_SIGNATURE_DROPS = 2
const MAX_GEARBOX_SIGNATURE_DROPS = FORWARD_GEAR_MAX - FORWARD_GEAR_MIN
const GEARBOX_SIGNATURE_SCALE = 1000
const GEARBOX_SIGNATURE_FORMAT_DECIMALS = 4
const MIN_DRIVEN_WHEEL_RAD_S = 5
const MIN_ENGINE_RPM = 1200
const MAX_CLUTCH = 0.05
const MIN_RATIO_DROP = 0.45
const MAX_RATIO_DROP = 0.95
const MIN_TARGET_RPM_FRACTION = 0.65
const MAX_TARGET_RPM_FRACTION = 0.99
const CURVE_COVERAGE_FRACTION = 0.90
const LIMITER_TARGET_FRACTION = 0.98
const MAX_INTERPOLATION_GAP_RPM = POWER_BIN_RPM * 2
const TARGET_STEP_RPM = 25
const CROSSOVER_CONFIRM_STEPS = 3

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
    this.rpmMax = 0
  }

  getRatioDrop(gear: number): { ratioDrop: number, evidence: number } | null {
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
    const highestReliableRpm = reliableBins.at(-1)?.[0] ?? 0
    const peakPower = reliableBins.reduce<[number, PowerBin] | null>((best, candidate) => (
      !best || candidate[1].maxPower > best[1].maxPower ? candidate : best
    ), null)
    const estimate = this.estimate(gear)
    const targetRpm = estimate?.shiftRpm ?? null
    const postShiftRpm = targetRpm !== null && ratioDrop !== null
      ? targetRpm * ratioDrop
      : null

    return {
      gear,
      powerCurveCoverage: this.rpmMax > 0 ? Math.min(1, highestReliableRpm / this.rpmMax) : 0,
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
    if (!isForwardGear(gear) || gear >= FORWARD_GEAR_MAX || this.rpmMax <= 0) return null
    const ratio = this.getRatioDrop(gear)
    if (!ratio) return null

    const reliableBins = this.getReliablePowerBins()
    if (reliableBins.length < 8) return null

    const highestReliableRpm = reliableBins.at(-1)![0]
    if (highestReliableRpm < this.rpmMax * CURVE_COVERAGE_FRACTION) return null

    // Scan the usable upper band instead of assuming that an optimal shift can
    // never precede the absolute power peak. Unusual multi-peak curves are
    // still decided by the same-power-at-the-same-road-speed comparison.
    const firstCandidate = Math.round(this.rpmMax * MIN_TARGET_RPM_FRACTION / TARGET_STEP_RPM) * TARGET_STEP_RPM
    const lastCandidate = Math.min(
      highestReliableRpm,
      Math.floor(this.rpmMax * MAX_TARGET_RPM_FRACTION / TARGET_STEP_RPM) * TARGET_STEP_RPM
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

    const limiterTarget = Math.round(this.rpmMax * LIMITER_TARGET_FRACTION / TARGET_STEP_RPM) * TARGET_STEP_RPM
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
    if (!isForwardGear(telemetry.gear)) return
    if (!Number.isFinite(telemetry.rpm) || telemetry.rpm < MIN_ENGINE_RPM) return
    if (!Number.isFinite(telemetry.clutch) || telemetry.clutch > MAX_CLUTCH) return

    const wheelSpeed = drivenWheelSpeed(telemetry)
    if (wheelSpeed === null) return
    const ratio = telemetry.rpm / wheelSpeed
    if (!Number.isFinite(ratio) || ratio <= 0) return

    const samples = this.ratioSamples.get(telemetry.gear) ?? []
    samples.push(ratio)
    if (samples.length > MAX_RATIO_SAMPLES) samples.shift()
    this.ratioSamples.set(telemetry.gear, samples)
  }

  private ingestPower(telemetry: Telemetry): void {
    if (!isForwardGear(telemetry.gear)) return
    if (!Number.isFinite(telemetry.throttle) || telemetry.throttle < WOT_THRESHOLD) return
    if (!Number.isFinite(telemetry.clutch) || telemetry.clutch > MAX_CLUTCH) return
    if (!Number.isFinite(telemetry.rpm) || telemetry.rpm <= 0) return
    if (!Number.isFinite(telemetry.rpmMax) || telemetry.rpmMax <= 0 || telemetry.rpm > telemetry.rpmMax * 1.05) return
    if (!Number.isFinite(telemetry.power) || telemetry.power <= 0) return

    const rpmBin = Math.round(telemetry.rpm / POWER_BIN_RPM) * POWER_BIN_RPM
    const existing = this.powerBins.get(rpmBin)
    if (existing) {
      existing.maxPower = Math.max(existing.maxPower, telemetry.power)
      existing.samples += 1
    } else {
      this.powerBins.set(rpmBin, { maxPower: telemetry.power, samples: 1 })
    }
  }

  private getReliablePowerBins(): [number, PowerBin][] {
    return [...this.powerBins.entries()]
      .filter(([, bin]) => bin.samples >= MIN_POWER_SAMPLES && bin.maxPower > 0)
      .sort(([left], [right]) => left - right)
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
    if (lower[0] === upper[0]) return lower[1].maxPower

    const fraction = (rpm - lower[0]) / (upper[0] - lower[0])
    return lower[1].maxPower + (upper[1].maxPower - lower[1].maxPower) * fraction
  }
}

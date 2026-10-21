import type { Telemetry } from './telemetry'

/**
 * In-memory power curve and gear ratios of one configuration, built from settled clean
 * full-throttle frames. Nothing here is persisted: only the resulting model point is.
 */
export type ShiftModelKind = 'crossover' | 'at-limiter'

export interface ShiftModelPoint {
  /** Model shift RPM for the pair, or null when the data cannot place one. */
  rpm: number | null
  kind: ShiftModelKind | null
  /** Share of 50-RPM scan points from the power peak to the result where both powers were known. */
  coverage: number | null
  /** Next-gear RPM divided by current-gear RPM at the same speed. */
  ratioStep: number | null
}

const BIN_RPM = 100
const MAX_BIN_VALUES = 32
const MIN_BIN_VALUES = 3
const BIN_QUANTILE = 0.9
const MAX_RATIO_VALUES = 64
const MIN_RATIO_VALUES = 10
const RATIO_MIN_SPEED_KMH = 20
const RATIO_MAX_SLIP = 0.15
const SCAN_STEP_RPM = 50
const AT_LIMITER_RPM = 200
const MIN_COVERAGE = 0.5

const NO_POINT: ShiftModelPoint = { rpm: null, kind: null, coverage: null, ratioStep: null }

/** Bounded window of the latest values with a cached quantile. */
class ValueWindow {
  private readonly values: number[] = []
  private next = 0
  private cached: number | null = null
  private dirty = false
  constructor(private readonly capacity: number, private readonly minimum: number, private readonly fraction: number) {}
  add(value: number): void {
    if (this.values.length < this.capacity) this.values.push(value)
    else { this.values[this.next] = value; this.next = (this.next + 1) % this.capacity }
    this.dirty = true
  }
  get size(): number { return this.values.length }
  value(): number | null {
    if (this.values.length < this.minimum) return null
    if (this.dirty) {
      const sorted = [...this.values].sort((a, b) => a - b)
      this.cached = sorted[Math.min(sorted.length - 1, Math.floor(this.fraction * sorted.length))]!
      this.dirty = false
    }
    return this.cached
  }
}

function maxAbsSlip(slip: Telemetry['slipRatio'] | undefined | null): number | null {
  if (!slip || typeof slip !== 'object') return null
  const values = [slip.fl, slip.fr, slip.rl, slip.rr]
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) return null
  return Math.max(...values.map(Math.abs))
}

export class PowerModel {
  private readonly bins = new Map<number, ValueWindow>()
  private readonly ratios = new Map<number, ValueWindow>()

  /**
   * Adds one settled clean full-throttle frame. Engine power does not depend on wheelspin, so
   * every such frame feeds the curve; rpm / speed only gives a gear ratio without wheelspin.
   */
  add(telemetry: Telemetry): void {
    const bin = Math.floor(telemetry.rpm / BIN_RPM)
    let window = this.bins.get(bin)
    if (!window) { window = new ValueWindow(MAX_BIN_VALUES, MIN_BIN_VALUES, BIN_QUANTILE); this.bins.set(bin, window) }
    window.add(telemetry.power)
    const slip = maxAbsSlip(telemetry.slipRatio)
    if (telemetry.speedKmh > RATIO_MIN_SPEED_KMH && slip !== null && slip < RATIO_MAX_SLIP) {
      let ratio = this.ratios.get(telemetry.gear)
      if (!ratio) { ratio = new ValueWindow(MAX_RATIO_VALUES, MIN_RATIO_VALUES, 0.5); this.ratios.set(telemetry.gear, ratio) }
      ratio.add(telemetry.rpm / telemetry.speedKmh)
    }
  }

  clear(): void { this.bins.clear(); this.ratios.clear() }
  isEmpty(): boolean { return this.bins.size === 0 && this.ratios.size === 0 }
  getRatio(gear: number): number | null { return this.ratios.get(gear)?.value() ?? null }

  /** Current power curve: bin index to its 90th-percentile power, only for bins with enough values. */
  curve(): Map<number, number> {
    const curve = new Map<number, number>()
    for (const [bin, window] of this.bins) {
      const value = window.value()
      if (value !== null) curve.set(bin, value)
    }
    return curve
  }

  /**
   * The pair's model point from a curve snapshot: scan every 50 RPM from the power peak to the
   * ceiling and skip points where either power is unknown. The first point where the next gear
   * has at least as much power is the crossover, but only after a known point where the current
   * gear was still stronger; otherwise the crossover may lie in a gap before it. Without a
   * crossover, known points reaching within 200 RPM of the ceiling put the point at the ceiling.
   */
  modelPoint(sourceGear: number, ceilingRpm: number | null, curve: Map<number, number> = this.curve()): ShiftModelPoint {
    const from = this.getRatio(sourceGear), to = this.getRatio(sourceGear + 1)
    if (from === null || to === null || !(from > 0)) return { ...NO_POINT }
    const ratioStep = to / from
    if (ceilingRpm === null || !(ceilingRpm > 0) || !(ratioStep > 0)) return { ...NO_POINT, ratioStep }
    let peakRpm: number | null = null, peakValue = -Infinity
    for (const [bin, value] of curve) {
      const rpm = bin * BIN_RPM + BIN_RPM / 2
      if (rpm <= ceilingRpm && (value > peakValue || (value === peakValue && peakRpm !== null && rpm < peakRpm))) { peakRpm = rpm; peakValue = value }
    }
    if (peakRpm === null) return { ...NO_POINT, ratioStep }
    let steps = 0, evaluable = 0, highest: number | null = null, sawLower = false
    for (let rpm = peakRpm; rpm <= ceilingRpm; rpm += SCAN_STEP_RPM) {
      steps++
      const here = curveValue(curve, rpm), shifted = curveValue(curve, rpm * ratioStep)
      if (here === null || shifted === null) continue
      evaluable++
      highest = rpm
      if (shifted >= here) {
        const coverage = evaluable / steps
        if (!sawLower || coverage < MIN_COVERAGE) return { ...NO_POINT, ratioStep, coverage }
        return { rpm: Math.round(rpm), kind: 'crossover', coverage, ratioStep }
      }
      sawLower = true
    }
    const coverage = steps === 0 ? 0 : evaluable / steps
    if (highest !== null && ceilingRpm - highest <= AT_LIMITER_RPM && coverage >= MIN_COVERAGE) {
      return { rpm: Math.round(ceilingRpm), kind: 'at-limiter', coverage, ratioStep }
    }
    return { ...NO_POINT, ratioStep, coverage }
  }
}

/** Power at an RPM by linear interpolation between bin centres; null unless both neighbouring bins are known. */
function curveValue(curve: Map<number, number>, rpm: number): number | null {
  const position = rpm / BIN_RPM - 0.5
  const low = Math.floor(position)
  const lowValue = curve.get(low), highValue = curve.get(low + 1)
  if (lowValue === undefined || highValue === undefined) return null
  return lowValue + (highValue - lowValue) * (position - low)
}

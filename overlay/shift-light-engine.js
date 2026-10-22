// FDC-owned Shift Light utility; keep this browser module self-contained.
var HudShiftLight = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/shift-light/shift-light.ts
  var shift_light_exports = {};
  __export(shift_light_exports, {
    SHIFT_LIGHT_LEARNING_VERSION: () => SHIFT_LIGHT_LEARNING_VERSION,
    ShiftLightLearner: () => ShiftLightLearner,
    getShiftLightCarKey: () => getShiftLightCarKey,
    getShiftLightIdentity: () => getShiftLightIdentity
  });

  // src/shift-light/power-model.ts
  var BIN_RPM = 100;
  var MAX_BIN_VALUES = 32;
  var MIN_BIN_VALUES = 3;
  var BIN_QUANTILE = 0.9;
  var MAX_RATIO_VALUES = 64;
  var MIN_RATIO_VALUES = 10;
  var RATIO_MIN_SPEED_KMH = 20;
  var RATIO_MAX_SLIP = 0.15;
  var WHEEL_RATIO_MIN_SPEED_KMH = 5;
  var WHEEL_RATIO_MIN_RAD_S = 5;
  var RPM_TO_RAD_S = 2 * Math.PI / 60;
  var SCAN_STEP_RPM = 50;
  var AT_LIMITER_RPM = 200;
  var MIN_COVERAGE = 0.5;
  var NO_POINT = { rpm: null, kind: null, coverage: null, ratioStep: null };
  var ValueWindow = class {
    constructor(capacity, minimum, fraction) {
      this.capacity = capacity;
      this.minimum = minimum;
      this.fraction = fraction;
    }
    capacity;
    minimum;
    fraction;
    values = [];
    next = 0;
    cached = null;
    dirty = false;
    add(value) {
      if (this.values.length < this.capacity) this.values.push(value);
      else {
        this.values[this.next] = value;
        this.next = (this.next + 1) % this.capacity;
      }
      this.dirty = true;
    }
    get size() {
      return this.values.length;
    }
    value() {
      if (this.values.length < this.minimum) return null;
      if (this.dirty) {
        const sorted = [...this.values].sort((a, b) => a - b);
        this.cached = sorted[Math.min(sorted.length - 1, Math.floor(this.fraction * sorted.length))];
        this.dirty = false;
      }
      return this.cached;
    }
  };
  function maxAbsSlip(slip) {
    if (!slip || typeof slip !== "object") return null;
    const values = [slip.fl, slip.fr, slip.rl, slip.rr];
    if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
    return Math.max(...values.map(Math.abs));
  }
  function drivenWheelValues(wheels, drivetrain) {
    if (!wheels || typeof wheels !== "object") return null;
    const driven = drivetrain === 0 ? [wheels.fl, wheels.fr] : drivetrain === 1 || drivetrain === 2 ? [wheels.rl, wheels.rr] : null;
    if (!driven || driven.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
    return driven;
  }
  function drivenWheelSpeed(telemetry) {
    const driven = drivenWheelValues(telemetry.wheelRotation, telemetry.car?.drivetrain);
    return driven === null ? null : driven.reduce((sum, value) => sum + Math.abs(value), 0) / driven.length;
  }
  function drivenWheelSlip(telemetry) {
    const driven = drivenWheelValues(telemetry.slipRatio, telemetry.car?.drivetrain);
    return driven === null ? null : Math.max(...driven.map(Math.abs));
  }
  function addRatio(windows, gear, value) {
    let window = windows.get(gear);
    if (!window) {
      window = new ValueWindow(MAX_RATIO_VALUES, MIN_RATIO_VALUES, 0.5);
      windows.set(gear, window);
    }
    window.add(value);
  }
  var PowerModel = class {
    bins = /* @__PURE__ */ new Map();
    /** Engine over driven-wheel angular speed: the overall gear ratio, wheelspin or not. */
    wheelRatios = /* @__PURE__ */ new Map();
    /** rpm / speed from frames without wheelspin; other units than the wheel ratios, so never mixed with them. */
    speedRatios = /* @__PURE__ */ new Map();
    /**
     * Adds one settled clean full-throttle frame. Engine power does not depend on wheelspin, so
     * every such frame feeds the curve. The driven wheels give the gear ratio even while they
     * spin; rpm / speed gives one only without wheelspin and is the fallback without wheel data.
     */
    add(telemetry) {
      const bin = Math.floor(telemetry.rpm / BIN_RPM);
      let window = this.bins.get(bin);
      if (!window) {
        window = new ValueWindow(MAX_BIN_VALUES, MIN_BIN_VALUES, BIN_QUANTILE);
        this.bins.set(bin, window);
      }
      window.add(telemetry.power);
      const wheelSpeed = drivenWheelSpeed(telemetry);
      if (wheelSpeed !== null && wheelSpeed > WHEEL_RATIO_MIN_RAD_S && telemetry.speedKmh > WHEEL_RATIO_MIN_SPEED_KMH) {
        const ratio = telemetry.rpm * RPM_TO_RAD_S / wheelSpeed;
        if (Number.isFinite(ratio) && ratio > 0) addRatio(this.wheelRatios, telemetry.gear, ratio);
      }
      const slip = maxAbsSlip(telemetry.slipRatio);
      if (telemetry.speedKmh > RATIO_MIN_SPEED_KMH && slip !== null && slip < RATIO_MAX_SLIP) {
        addRatio(this.speedRatios, telemetry.gear, telemetry.rpm / telemetry.speedKmh);
      }
    }
    clear() {
      this.bins.clear();
      this.wheelRatios.clear();
      this.speedRatios.clear();
    }
    isEmpty() {
      return this.bins.size === 0 && this.wheelRatios.size === 0 && this.speedRatios.size === 0;
    }
    /** The gear's ratio: from the driven wheels when it has one, else from rpm / speed. */
    getRatio(gear) {
      return this.wheelRatios.get(gear)?.value() ?? this.speedRatios.get(gear)?.value() ?? null;
    }
    /**
     * Next-gear ratio over current-gear ratio with both ratios from one source: the driven wheels
     * when both gears have one, else rpm / speed when both have one, else null.
     */
    ratioStep(sourceGear) {
      for (const windows of [this.wheelRatios, this.speedRatios]) {
        const from = windows.get(sourceGear)?.value() ?? null, to = windows.get(sourceGear + 1)?.value() ?? null;
        if (from !== null && to !== null) return from > 0 ? to / from : null;
      }
      return null;
    }
    /** Current power curve: bin index to its 90th-percentile power, only for bins with enough values. */
    curve() {
      const curve = /* @__PURE__ */ new Map();
      for (const [bin, window] of this.bins) {
        const value = window.value();
        if (value !== null) curve.set(bin, value);
      }
      return curve;
    }
    /**
     * The pair's model point from a curve snapshot: scan every 50 RPM from the power peak to the
     * scan limit and skip points where either power is unknown. The first point where the next gear
     * has at least as much power is the crossover, but only after a known point where the current
     * gear was still stronger; otherwise the crossover may lie in a gap before it. Without a
     * crossover, known points reaching within 200 RPM of the limit put the point at the limit, but
     * only when the limit is a known ceiling: below RPMs the engine already reached, a crossover
     * needs no limiter, while the at-limiter answer does.
     */
    modelPoint(sourceGear, scan, curve = this.curve()) {
      const ratioStep = this.ratioStep(sourceGear);
      if (ratioStep === null) return { ...NO_POINT };
      const limitRpm = scan.limitRpm;
      if (limitRpm === null || !(limitRpm > 0) || !(ratioStep > 0)) return { ...NO_POINT, ratioStep };
      let peakRpm = null, peakValue = -Infinity;
      for (const [bin, value] of curve) {
        const rpm = bin * BIN_RPM + BIN_RPM / 2;
        if (rpm <= limitRpm && (value > peakValue || value === peakValue && peakRpm !== null && rpm < peakRpm)) {
          peakRpm = rpm;
          peakValue = value;
        }
      }
      if (peakRpm === null) return { ...NO_POINT, ratioStep };
      let steps = 0, evaluable = 0, highest = null, sawLower = false;
      for (let rpm = peakRpm; rpm <= limitRpm; rpm += SCAN_STEP_RPM) {
        steps++;
        const here = curveValue(curve, rpm), shifted = curveValue(curve, rpm * ratioStep);
        if (here === null || shifted === null) continue;
        evaluable++;
        highest = rpm;
        if (shifted >= here) {
          const coverage2 = evaluable / steps;
          if (!sawLower || coverage2 < MIN_COVERAGE) return { ...NO_POINT, ratioStep, coverage: coverage2 };
          return { rpm: Math.round(rpm), kind: "crossover", coverage: coverage2, ratioStep };
        }
        sawLower = true;
      }
      const coverage = steps === 0 ? 0 : evaluable / steps;
      if (scan.ceilingKnown && highest !== null && limitRpm - highest <= AT_LIMITER_RPM && coverage >= MIN_COVERAGE) {
        return { rpm: Math.round(limitRpm), kind: "at-limiter", coverage, ratioStep };
      }
      return { ...NO_POINT, ratioStep, coverage };
    }
  };
  function curveValue(curve, rpm) {
    const position = rpm / BIN_RPM - 0.5;
    const low = Math.floor(position);
    const lowValue = curve.get(low), highValue = curve.get(low + 1);
    if (lowValue === void 0 || highValue === void 0) return null;
    return lowValue + (highValue - lowValue) * (position - low);
  }

  // src/shift-light/optimal-shift.ts
  var SHIFT_LIGHT_LEARNING_VERSION = 4;
  var FORWARD_GEAR_MIN = 1;
  var FORWARD_GEAR_MAX = 10;
  var MAX_SHIFT_SAMPLES = 64;
  var MAX_CONFIRMATIONS = 3;
  var CONFIRMATION_STABILITY_RPM = 100;
  var MAX_CEILING_SAMPLES = 12;
  var MIN_TRUSTED_CEILING_SAMPLES = 3;
  var CEILING_SAMPLE_STABILITY_RPM = 100;
  var CEILING_MIN_REDLINE_FRACTION = 0.85;
  var CEILING_WAIT_ABOVE_RPM = 400;
  var CEILING_WAIT_RELEASE_SAMPLES = 6;
  var FALSE_LIMITER_BELOW_PEAK_RPM = 400;
  var MIN_LIMITER_RISE_RPM = 100;
  var MIN_LIMITER_DROP_RPM = 40;
  var LIMITER_RECOVERY_TOLERANCE_RPM = 60;
  var MAX_CLEAN_TIMESTAMP_GAP_MS = 1e3;
  var MODEL_REFRESH_MS = 250;
  var MODEL_CHECK_RPM = 150;
  var MODEL_CHECK_MIN_DELTA_PCT = 3;
  var MODEL_REJECT_CONTRADICTIONS = 2;
  var MAX_COMPARISON_DRIVEN_SLIP = 4;
  function isForwardGear(gear) {
    return Number.isInteger(gear) && gear >= FORWARD_GEAR_MIN && gear <= FORWARD_GEAR_MAX;
  }
  function finitePositive(value) {
    return Number.isFinite(value) && value > 0;
  }
  function roundRpm(value) {
    return Math.max(0, Math.round(value));
  }
  function finiteInRange(value, minimum, maximum) {
    if (value === null || value === void 0 || value === "") return null;
    const number = typeof value === "number" ? value : Number(value);
    return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
  }
  function cleanWotMotionTelemetry(telemetry) {
    if (telemetry.isRaceOn === false) return false;
    if (!Number.isFinite(telemetry.throttle) || telemetry.throttle < 0.95) return false;
    if (!Number.isFinite(telemetry.clutch) || telemetry.clutch > 0.05) return false;
    if (Number.isFinite(telemetry.brake) && telemetry.brake > 0.02) return false;
    if (Number.isFinite(telemetry.handBrake) && telemetry.handBrake > 0.02) return false;
    if (!isForwardGear(telemetry.gear) || !finitePositive(telemetry.rpm)) return false;
    if (!finitePositive(telemetry.speedKmh)) return false;
    return true;
  }
  function cleanPowerTelemetry(telemetry) {
    return cleanWotMotionTelemetry(telemetry) && finitePositive(telemetry.power);
  }
  function isCleanShiftEvidence(telemetry) {
    return cleanPowerTelemetry(telemetry);
  }
  function isComparisonWheelspin(telemetry) {
    const slip = drivenWheelSlip(telemetry);
    return slip !== null && slip > MAX_COMPARISON_DRIVEN_SLIP;
  }
  function emptyGear(sourceGear, destinationGear = sourceGear + 1) {
    return {
      sourceGear,
      destinationGear,
      status: "learning",
      targetRpm: null,
      candidateRpm: null,
      confirmationRpms: [],
      confirmationCount: 0,
      lastReason: null,
      evidence: [],
      modelRpm: null
    };
  }
  function cloneEvidence(item) {
    return { ...item };
  }
  function cloneGear(state) {
    return { ...state, confirmationRpms: [...state.confirmationRpms], evidence: state.evidence.map(cloneEvidence) };
  }
  function normalizeEvidence(value) {
    if (!value || typeof value !== "object") return null;
    const raw = value;
    const sourceGear = finiteInRange(raw.sourceGear, FORWARD_GEAR_MIN, FORWARD_GEAR_MAX);
    const destinationGear = finiteInRange(raw.destinationGear, FORWARD_GEAR_MIN, FORWARD_GEAR_MAX);
    const beforeTimestampMs = finiteInRange(raw.beforeTimestampMs, 0, Number.MAX_SAFE_INTEGER);
    const afterTimestampMs = finiteInRange(raw.afterTimestampMs, 0, Number.MAX_SAFE_INTEGER);
    const beforeRpm = finiteInRange(raw.beforeRpm, 0, 1e5);
    const afterRpm = finiteInRange(raw.afterRpm, 0, 1e5);
    const beforePower = finiteInRange(raw.beforePower, 0, Number.MAX_SAFE_INTEGER);
    const afterPower = finiteInRange(raw.afterPower, 0, Number.MAX_SAFE_INTEGER);
    const delta = finiteInRange(raw.powerDeltaPct, -100, Number.MAX_SAFE_INTEGER);
    if ([
      sourceGear,
      destinationGear,
      beforeTimestampMs,
      afterTimestampMs,
      beforeRpm,
      afterRpm,
      beforePower,
      afterPower,
      delta
    ].some((item) => item === null)) return null;
    if (beforePower <= 0 || afterPower <= 0) return null;
    if (Math.round(destinationGear) !== Math.round(sourceGear) + 1) return null;
    return {
      sourceGear: Math.round(sourceGear),
      destinationGear: Math.round(destinationGear),
      beforeTimestampMs,
      afterTimestampMs,
      beforeRpm: roundRpm(beforeRpm),
      afterRpm: roundRpm(afterRpm),
      beforePower,
      afterPower,
      powerDeltaPct: delta,
      outcome: raw.outcome === "not_better" || delta < 0 ? "not_better" : "better",
      reason: raw.reason === "NO_CROSSOVER" || delta < 0 ? "NO_CROSSOVER" : "POWER_CROSSOVER"
    };
  }
  function normalizeRpmList(value) {
    return Array.isArray(value) ? value.map((item) => finiteInRange(item, 0, 1e5)).filter((item) => item !== null).map(roundRpm).slice(-MAX_CONFIRMATIONS) : [];
  }
  function currentSeries(evidence, candidateRpm, count) {
    const series = [];
    if (candidateRpm === null) return series;
    for (let index = evidence.length - 1; index >= 0 && series.length < count; index--) {
      const item = evidence[index];
      if (item.outcome !== "better") continue;
      if (Math.abs(item.beforeRpm - candidateRpm) > CONFIRMATION_STABILITY_RPM) break;
      series.unshift(item);
    }
    return series;
  }
  function seriesRpms(series, candidateRpm, count) {
    const rpms = series.map((item) => item.beforeRpm);
    while (candidateRpm !== null && rpms.length < count) rpms.unshift(roundRpm(candidateRpm));
    return rpms.slice(-MAX_CONFIRMATIONS);
  }
  function keepHighestCeilingSamples(values) {
    return [...values].sort((a, b) => b - a).slice(0, MAX_CEILING_SAMPLES).sort((a, b) => a - b);
  }
  function normalizeCeilingSamples(value) {
    return Array.isArray(value) ? keepHighestCeilingSamples(value.map((item) => finiteInRange(item, 0, 1e5)).filter((item) => item !== null).map(roundRpm)) : [];
  }
  var OptimalShiftEstimator = class _OptimalShiftEstimator {
    gears = /* @__PURE__ */ new Map();
    shiftSamples = [];
    ceilingSamples = [];
    usableCeiling = null;
    reportedRedlineRpm = null;
    limiterTracker = null;
    lastCleanTelemetry = null;
    limiterRearmed = true;
    /**
     * Highest clean full-throttle RPM of this run reached with positive power; in memory only, cleared by
     * reset(). Frames where the wheels drive the engine (an over-rev after a downshift or kickdown) do not count.
     */
    peakWotRpm = 0;
    /** Power curve and gear ratios of this run; in memory only, cleared by reset(). */
    powerModel = new PowerModel();
    /** Latest live model result per source gear. */
    liveModel = /* @__PURE__ */ new Map();
    modelDataChanged = false;
    modelScan = { limitRpm: null, ceilingKnown: false };
    lastModelRefreshMs = null;
    modelInfoCache = /* @__PURE__ */ new Map();
    ingest(telemetry) {
      if (Number.isFinite(telemetry.rpmMax) && telemetry.rpmMax > 0) this.reportedRedlineRpm = roundRpm(telemetry.rpmMax);
      const cleanWot = cleanWotMotionTelemetry(telemetry);
      if (cleanWot && telemetry.gear < FORWARD_GEAR_MAX) this.getOrCreate(telemetry.gear);
      if (cleanPowerTelemetry(telemetry) && telemetry.rpm > this.peakWotRpm) this.raisePeakWotRpm(telemetry.rpm);
      this.observeLimiter(telemetry);
    }
    /** Only completed clean windows are stored; a negative delta is observation, not driver failure. */
    observeTransition(observation) {
      const { sourceGear, destinationGear, before, after } = observation;
      if (!isForwardGear(sourceGear) || destinationGear !== sourceGear + 1) return null;
      if (!cleanPowerTelemetry(before) || !cleanPowerTelemetry(after) || before.timestampMs > after.timestampMs) return null;
      if (isComparisonWheelspin(before) || isComparisonWheelspin(after)) return null;
      const powerDeltaPct = (after.power - before.power) / before.power * 100;
      if (!Number.isFinite(powerDeltaPct)) return null;
      const evidence = {
        sourceGear,
        destinationGear,
        beforeTimestampMs: before.timestampMs,
        afterTimestampMs: after.timestampMs,
        beforeRpm: roundRpm(before.rpm),
        afterRpm: roundRpm(after.rpm),
        beforePower: before.power,
        afterPower: after.power,
        powerDeltaPct,
        outcome: powerDeltaPct >= 0 ? "better" : "not_better",
        reason: powerDeltaPct >= 0 ? "POWER_CROSSOVER" : "NO_CROSSOVER"
      };
      this.shiftSamples = [...this.shiftSamples, evidence].slice(-MAX_SHIFT_SAMPLES);
      const state = this.getOrCreate(sourceGear, destinationGear);
      state.evidence = [...state.evidence, evidence].slice(-MAX_SHIFT_SAMPLES);
      this.modelInfoCache.delete(sourceGear);
      const baseline = this.usableCeiling ?? this.reportedRedlineRpm;
      if (evidence.outcome === "better" && baseline !== null && evidence.beforeRpm < baseline) this.applyBetterOutcome(state, evidence.beforeRpm);
      return cloneEvidence(evidence);
    }
    getState(gear) {
      const state = this.gears.get(gear);
      return state ? cloneGear(state) : null;
    }
    getStates() {
      return [...this.gears.values()].sort((a, b) => a.sourceGear - b.sourceGear).map(cloneGear);
    }
    /** Highest forward gear proven by the learning state: any row's source gear, and the destination of a row with evidence. */
    getHighestKnownGear() {
      let highest = 0;
      for (const state of this.gears.values()) {
        highest = Math.max(highest, state.sourceGear);
        if (state.evidence.length > 0) highest = Math.max(highest, state.destinationGear);
      }
      return highest;
    }
    serializeLearningState(key) {
      return {
        modelVersion: SHIFT_LIGHT_LEARNING_VERSION,
        version: SHIFT_LIGHT_LEARNING_VERSION,
        key,
        reportedRedlineRpm: this.reportedRedlineRpm,
        ceilingSamples: [...this.ceilingSamples],
        usableCeiling: this.usableCeiling,
        // Only a model point in use is saved: a rejected one must not read as READY after a restart or in Garage.
        gearTargets: this.getStates().map((state) => ({ ...state, modelRpm: this.getModelRpm(state.sourceGear) })),
        shiftSamples: this.shiftSamples.map(cloneEvidence)
      };
    }
    importLearningState(state, key) {
      if (!state || typeof state !== "object") return false;
      const raw = state;
      const version = raw.modelVersion ?? raw.version;
      if (version !== SHIFT_LIGHT_LEARNING_VERSION || raw.key !== key) return false;
      const samples = Array.isArray(raw.shiftSamples) ? raw.shiftSamples.map(normalizeEvidence).filter((x) => x !== null) : [];
      const restored = /* @__PURE__ */ new Map();
      const rawTargets = Array.isArray(raw.gearTargets) ? raw.gearTargets : [];
      for (const rawTarget of rawTargets) {
        if (!rawTarget || typeof rawTarget !== "object") continue;
        const item = rawTarget;
        const sourceGear = finiteInRange(item.sourceGear, FORWARD_GEAR_MIN, FORWARD_GEAR_MAX);
        const destinationGear = finiteInRange(item.destinationGear, FORWARD_GEAR_MIN, FORWARD_GEAR_MAX);
        if (sourceGear === null || destinationGear !== sourceGear + 1) continue;
        const target = emptyGear(Math.round(sourceGear), Math.round(destinationGear));
        if (item.status === "potential" || item.status === "optimal") target.status = item.status;
        target.targetRpm = finiteInRange(item.targetRpm, 0, 1e5);
        target.candidateRpm = finiteInRange(item.candidateRpm, 0, 1e5);
        const rawCount = Number(item.confirmationCount ?? 0);
        const persistedCount = Number.isFinite(rawCount) ? Math.min(MAX_CONFIRMATIONS, Math.max(0, Math.round(rawCount))) : 0;
        const targetSamples = samples.filter((sample) => sample.sourceGear === target.sourceGear && sample.destinationGear === target.destinationGear && sample.outcome === "better");
        const explicitRpms = normalizeRpmList(item.confirmationRpms);
        const seed = finiteInRange(item.candidateRpm ?? item.targetRpm, 0, 1e5);
        const candidateRpm = seed ?? targetSamples[targetSamples.length - 1]?.beforeRpm ?? null;
        if (explicitRpms.length > 0 || target.status === "optimal") {
          const derivedRpms = candidateRpm === null ? [] : targetSamples.map((sample) => sample.beforeRpm).filter((rpm) => Math.abs(rpm - candidateRpm) <= CONFIRMATION_STABILITY_RPM).slice(-MAX_CONFIRMATIONS);
          target.confirmationRpms = (explicitRpms.length > 0 ? explicitRpms : derivedRpms).slice(-MAX_CONFIRMATIONS);
          target.confirmationCount = Math.min(MAX_CONFIRMATIONS, Math.max(persistedCount, target.confirmationRpms.length));
        } else {
          target.confirmationRpms = seriesRpms(currentSeries(targetSamples, candidateRpm, persistedCount), candidateRpm, persistedCount);
          target.confirmationCount = persistedCount;
        }
        target.lastReason = typeof item.lastReason === "string" ? item.lastReason.slice(0, 160) : null;
        target.evidence = samples.filter((sample) => sample.sourceGear === target.sourceGear && sample.destinationGear === target.destinationGear);
        const modelRpm = finiteInRange(item.modelRpm, 1, 1e5);
        target.modelRpm = modelRpm === null ? null : roundRpm(modelRpm);
        restored.set(target.sourceGear, target);
      }
      this.gears.clear();
      restored.forEach((value, gear) => this.gears.set(gear, value));
      this.shiftSamples = samples.slice(-MAX_SHIFT_SAMPLES);
      this.reportedRedlineRpm = finiteInRange(raw.reportedRedlineRpm, 0, 1e5);
      this.ceilingSamples = normalizeCeilingSamples(raw.ceilingSamples);
      this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples);
      this.applyLiveModel();
      return true;
    }
    mergeLearningState(state, key) {
      const incoming = new _OptimalShiftEstimator();
      if (!incoming.importLearningState(state, key)) return false;
      for (const target of incoming.getStates()) {
        const current = this.gears.get(target.sourceGear);
        if (!current) this.gears.set(target.sourceGear, target);
        else if (this.statusRank(target.status) > this.statusRank(current.status)) {
          const modelRpm = current.modelRpm ?? target.modelRpm;
          this.mergeSameRank(target, current);
          target.modelRpm = modelRpm;
          this.gears.set(target.sourceGear, target);
        } else {
          const modelRpm = current.modelRpm ?? target.modelRpm;
          this.mergeSameRank(current, target);
          current.modelRpm = modelRpm;
        }
      }
      const seen = new Set(this.shiftSamples.map((item) => `${item.beforeTimestampMs}:${item.afterTimestampMs}`));
      this.shiftSamples = [...this.shiftSamples, ...incoming.shiftSamples.filter((item) => !seen.has(`${item.beforeTimestampMs}:${item.afterTimestampMs}`))].slice(-MAX_SHIFT_SAMPLES);
      this.reportedRedlineRpm = incoming.reportedRedlineRpm ?? this.reportedRedlineRpm;
      this.ceilingSamples = normalizeCeilingSamples([...this.ceilingSamples, ...incoming.ceilingSamples]);
      this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples);
      this.applyLiveModel();
      return true;
    }
    exportState(key) {
      return this.serializeLearningState(key);
    }
    importState(state, key) {
      return this.importLearningState(state, key);
    }
    diagnose(gear) {
      const state = this.gears.get(gear);
      return {
        gear,
        powerCurveCoverage: 0,
        powerBinCount: 0,
        peakPowerRpm: null,
        currentRatio: null,
        nextRatio: null,
        ratioDrop: null,
        currentRatioSamples: 0,
        nextRatioSamples: 0,
        targetRpm: state?.targetRpm ?? state?.candidateRpm ?? null,
        postShiftRpm: null,
        powerAtTarget: null,
        powerAfterShift: null,
        estimateEvidence: state?.evidence.length ?? 0,
        status: state?.status ?? "learning",
        confirmationCount: state?.confirmationCount ?? 0,
        lastReason: state?.lastReason ?? null,
        evidenceCount: state?.evidence.length ?? 0,
        model: this.modelDiagnostics(gear)
      };
    }
    reset() {
      this.gears.clear();
      this.shiftSamples = [];
      this.ceilingSamples = [];
      this.usableCeiling = null;
      this.reportedRedlineRpm = null;
      this.peakWotRpm = 0;
      this.powerModel.clear();
      this.liveModel.clear();
      this.modelInfoCache.clear();
      this.modelDataChanged = false;
      this.modelScan = { limitRpm: null, ceilingKnown: false };
      this.lastModelRefreshMs = null;
      this.resetTransient();
    }
    resetTransient() {
      this.limiterTracker = null;
      this.lastCleanTelemetry = null;
      this.limiterRearmed = true;
    }
    /** Feeds one clean full-throttle frame that is settled in its gear into the power model. */
    observeModelFrame(telemetry) {
      if (!cleanPowerTelemetry(telemetry)) return;
      this.powerModel.add(telemetry);
      this.modelDataChanged = true;
    }
    /**
     * Recomputes the model points when the curve, the ratios or the scan limit changed, at most every
     * MODEL_REFRESH_MS of telemetry time. The scan runs to the ceiling (usable, else provisional);
     * without one it runs to the highest clean full-throttle RPM of this run and only a crossover
     * below it places a point. A pair whose live model places a point gets a gear row, and that
     * point replaces any persisted one.
     */
    refreshModel(timestampMs) {
      const ceiling = this.usableCeiling ?? this.getProvisionalCeiling();
      const scan = ceiling !== null ? { limitRpm: ceiling, ceilingKnown: true } : { limitRpm: this.peakWotRpm > 0 ? roundRpm(this.peakWotRpm) : null, ceilingKnown: false };
      if (!this.modelDataChanged && scan.limitRpm === this.modelScan.limitRpm && scan.ceilingKnown === this.modelScan.ceilingKnown) return;
      const last = this.lastModelRefreshMs;
      if (last !== null && timestampMs >= last && timestampMs - last < MODEL_REFRESH_MS) return;
      this.lastModelRefreshMs = timestampMs;
      this.modelDataChanged = false;
      this.modelScan = scan;
      this.liveModel.clear();
      if (!this.powerModel.isEmpty()) {
        const curve = this.powerModel.curve();
        for (let sourceGear = FORWARD_GEAR_MIN; sourceGear < FORWARD_GEAR_MAX; sourceGear++) {
          if (this.powerModel.getRatio(sourceGear) === null || this.powerModel.getRatio(sourceGear + 1) === null) continue;
          this.liveModel.set(sourceGear, this.powerModel.modelPoint(sourceGear, scan, curve));
        }
      }
      this.applyLiveModel();
    }
    /** Model point in use for the pair: null when there is none or real comparisons reject it. */
    getModelRpm(gear) {
      return this.modelInfo(gear).inUse;
    }
    modelDiagnostics(gear) {
      const { inUse: _inUse, ...diagnostics } = this.modelInfo(gear);
      return diagnostics;
    }
    getUsableCeiling() {
      return this.usableCeiling;
    }
    /**
     * Until the usable ceiling is trusted, the highest observation at or above
     * CEILING_MIN_REDLINE_FRACTION of the redline stands in for the limiter, raised to the
     * highest clean full-throttle RPM of this run because the engine cannot exceed its limiter.
     * A first limiter hit is usually within about 2% below the real limiter, and the value only
     * rises during a run. Without an observation there is no provisional ceiling: following
     * the climbing RPM alone would light the cue at every pull. It is a presentation fallback
     * only; learning still uses the trusted ceiling.
     */
    getProvisionalCeiling(fallbackRedlineRpm = null) {
      const redline = this.reportedRedlineRpm ?? fallbackRedlineRpm;
      if (redline === null || !(redline > 0)) return null;
      const considered = this.ceilingSamples.filter((sample) => sample / redline >= CEILING_MIN_REDLINE_FRACTION);
      return considered.length ? Math.max(...considered, roundRpm(this.peakWotRpm)) : null;
    }
    getCeilingSampleCount() {
      return this.ceilingSamples.length;
    }
    /** Size of the highest qualifying cluster, or the largest non-qualifying cluster while no ceiling exists. */
    getCeilingClusterCount() {
      return this.analyzeCeiling(this.ceilingSamples).clusterCount;
    }
    getReportedRedlineRpm() {
      return this.reportedRedlineRpm;
    }
    getOrCreate(sourceGear, destinationGear = sourceGear + 1) {
      let state = this.gears.get(sourceGear);
      if (!state) {
        state = emptyGear(sourceGear, destinationGear);
        this.gears.set(sourceGear, state);
      }
      return state;
    }
    applyBetterOutcome(state, rpm) {
      if (state.status === "optimal") return;
      if (state.candidateRpm === null || Math.abs(rpm - state.candidateRpm) > CONFIRMATION_STABILITY_RPM) {
        state.candidateRpm = rpm;
        state.confirmationRpms = [rpm];
        state.confirmationCount = 1;
        state.status = "potential";
      } else {
        state.confirmationRpms = [...state.confirmationRpms, rpm].slice(-MAX_CONFIRMATIONS);
        state.confirmationCount = state.confirmationRpms.length;
      }
      if (state.confirmationCount >= MAX_CONFIRMATIONS) {
        state.status = "optimal";
        state.targetRpm = this.median(state.confirmationRpms);
        state.candidateRpm = state.targetRpm;
      }
      state.lastReason = null;
    }
    statusRank(status) {
      return status === "optimal" ? 3 : status === "potential" ? 2 : 1;
    }
    median(values) {
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
    }
    mergeSameRank(current, incoming) {
      const sampleKey = (item) => `${item.beforeTimestampMs}:${item.afterTimestampMs}`;
      const ownSeries = currentSeries(current.evidence, current.candidateRpm, current.confirmationCount);
      const seen = new Set(current.evidence.map(sampleKey));
      current.evidence = [...current.evidence, ...incoming.evidence.filter((item) => !seen.has(sampleKey(item)))].slice(-MAX_SHIFT_SAMPLES);
      const anchor = current.targetRpm ?? current.candidateRpm ?? incoming.targetRpm ?? incoming.candidateRpm;
      let confirmations;
      if (anchor === null) confirmations = [];
      else if (current.status === "optimal") {
        confirmations = current.evidence.filter((item) => item.outcome === "better" && Math.abs(item.beforeRpm - anchor) <= CONFIRMATION_STABILITY_RPM).map((item) => item.beforeRpm).slice(-MAX_CONFIRMATIONS);
      } else {
        const ownKeys = new Set(ownSeries.map(sampleKey));
        const otherSeries = currentSeries(incoming.evidence, incoming.candidateRpm, incoming.confirmationCount).filter((item) => !ownKeys.has(sampleKey(item)));
        const joined = [...ownSeries, ...otherSeries].filter((item) => Math.abs(item.beforeRpm - anchor) <= CONFIRMATION_STABILITY_RPM);
        const count = Math.min(MAX_CONFIRMATIONS, Math.max(current.confirmationCount, incoming.confirmationCount, joined.length));
        confirmations = seriesRpms(joined.slice(-MAX_CONFIRMATIONS), anchor, count);
      }
      current.confirmationRpms = confirmations;
      current.confirmationCount = Math.max(current.confirmationCount, incoming.confirmationCount, confirmations.length);
      if (current.confirmationCount >= MAX_CONFIRMATIONS && current.status !== "learning") {
        current.status = "optimal";
        current.targetRpm = this.median(confirmations);
      }
      current.candidateRpm = current.targetRpm ?? incoming.candidateRpm ?? current.candidateRpm;
      current.lastReason = current.lastReason ?? incoming.lastReason;
    }
    deriveUsableCeiling(samples) {
      return this.analyzeCeiling(samples).ceiling;
    }
    applyLiveModel() {
      for (const [sourceGear, point] of this.liveModel) {
        if (point.rpm !== null) this.getOrCreate(sourceGear).modelRpm = point.rpm;
      }
      this.modelInfoCache.clear();
    }
    /**
     * A comparison well above the model point agrees when the next gear was at least as strong,
     * and one well below agrees when it was weaker; comparisons within MODEL_CHECK_RPM, or with
     * a power difference below MODEL_CHECK_MIN_DELTA_PCT, are neutral. Two or more contradictions that outnumber the agreements reject the point.
     */
    modelInfo(gear) {
      const cached = this.modelInfoCache.get(gear);
      if (cached) return cached;
      const state = this.gears.get(gear);
      const rpm = state?.modelRpm ?? null;
      const live = this.liveModel.get(gear);
      let agree = 0, contradict = 0;
      if (state && rpm !== null) {
        for (const sample of state.evidence) {
          if (Math.abs(sample.powerDeltaPct) < MODEL_CHECK_MIN_DELTA_PCT) continue;
          if (sample.beforeRpm > rpm + MODEL_CHECK_RPM) {
            if (sample.powerDeltaPct >= 0) agree++;
            else contradict++;
          } else if (sample.beforeRpm < rpm - MODEL_CHECK_RPM) {
            if (sample.powerDeltaPct < 0) agree++;
            else contradict++;
          }
        }
      }
      const rejected = contradict >= MODEL_REJECT_CONTRADICTIONS && contradict > agree;
      const fromLive = live !== void 0 && live.rpm !== null && live.rpm === rpm;
      const coverage = live?.coverage ?? null;
      const info = {
        rpm,
        kind: fromLive ? live.kind : null,
        coverage: coverage === null ? null : Math.round(coverage * 100) / 100,
        ratioStep: live?.ratioStep ?? null,
        agree,
        contradict,
        rejected,
        inUse: rpm !== null && !rejected ? rpm : null
      };
      this.modelInfoCache.set(gear, info);
      return info;
    }
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
    analyzeCeiling(samples) {
      const redline = this.reportedRedlineRpm;
      const considered = redline !== null && redline > 0 ? samples.filter((sample) => sample / redline >= CEILING_MIN_REDLINE_FRACTION) : [...samples];
      const descending = considered.sort((a, b) => b - a);
      const clusterAt = (anchor) => descending.filter((sample) => sample <= anchor && anchor - sample <= CEILING_SAMPLE_STABILITY_RPM);
      const progressCount = descending.length > 0 ? clusterAt(descending[0]).length : 0;
      for (const anchor of descending) {
        const cluster = clusterAt(anchor);
        if (cluster.length < MIN_TRUSTED_CEILING_SAMPLES) continue;
        if (cluster.length < CEILING_WAIT_RELEASE_SAMPLES && descending.some((sample) => sample > anchor && sample - anchor <= CEILING_WAIT_ABOVE_RPM)) {
          return { ceiling: null, clusterCount: progressCount };
        }
        const ascending = [...cluster].reverse();
        return { ceiling: ascending[Math.floor((ascending.length - 1) / 2)], clusterCount: cluster.length };
      }
      return { ceiling: null, clusterCount: progressCount };
    }
    observeLimiter(telemetry) {
      if (!cleanWotMotionTelemetry(telemetry)) {
        this.resetTransient();
        return;
      }
      const previous = this.lastCleanTelemetry;
      this.lastCleanTelemetry = telemetry;
      if (!previous || previous.gear !== telemetry.gear || telemetry.timestampMs < previous.timestampMs || telemetry.timestampMs - previous.timestampMs > MAX_CLEAN_TIMESTAMP_GAP_MS) {
        this.limiterRearmed = true;
        this.limiterTracker = { gear: telemetry.gear, startRpm: telemetry.rpm, peakRpm: telemetry.rpm, phase: "rising" };
        return;
      }
      if (!this.limiterRearmed) return;
      const tracker = this.limiterTracker;
      if (!tracker || tracker.gear !== telemetry.gear) {
        this.limiterTracker = { gear: telemetry.gear, startRpm: previous.rpm, peakRpm: Math.max(previous.rpm, telemetry.rpm), phase: "rising" };
        return;
      }
      if (tracker.phase === "rising") {
        if (telemetry.rpm >= tracker.peakRpm) {
          tracker.peakRpm = telemetry.rpm;
          return;
        }
        if (tracker.peakRpm - telemetry.rpm >= MIN_LIMITER_DROP_RPM && tracker.peakRpm - tracker.startRpm >= MIN_LIMITER_RISE_RPM) tracker.phase = "falling";
        return;
      }
      if (telemetry.rpm >= tracker.peakRpm - LIMITER_RECOVERY_TOLERANCE_RPM) {
        this.recordCeilingSample(tracker.peakRpm);
        this.limiterRearmed = false;
        this.limiterTracker = null;
      }
    }
    recordCeilingSample(sample) {
      if (this.isBelowPeakWotRpm(sample)) return;
      this.ceilingSamples = keepHighestCeilingSamples([...this.ceilingSamples, roundRpm(sample)]);
      this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples);
    }
    isBelowPeakWotRpm(sample) {
      return sample < this.peakWotRpm - FALSE_LIMITER_BELOW_PEAK_RPM;
    }
    /**
     * A higher clean full-throttle RPM reached with positive power withdraws every observation it proves was
     * not a limiter hit; an over-rev driven by the wheels proves nothing about the limiter.
     */
    raisePeakWotRpm(rpm) {
      this.peakWotRpm = rpm;
      const kept = this.ceilingSamples.filter((sample) => !this.isBelowPeakWotRpm(sample));
      if (kept.length === this.ceilingSamples.length) return;
      this.ceilingSamples = kept;
      this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples);
    }
  };

  // src/shift-light/shift-light.ts
  var NEUTRAL_GEAR = 11;
  var MAX_TIMESTAMP_GAP_MS = 1e3;
  var PRE_SHIFT_WINDOW_MS = 200;
  var MAX_PRE_SHIFT_FRAMES = 5;
  var POST_SHIFT_DELAY_MS = 80;
  var PRE_SHIFT_SETTLE_MS = 150;
  var POST_SHIFT_WINDOW_MS = 600;
  var MAX_NEUTRAL_WINDOW_MS = 400;
  var MAX_CLUTCH_SHIFT_GAP_MS = 400;
  var MIN_POST_SHIFT_FRAMES = 3;
  var MAX_POST_SHIFT_FRAMES = 5;
  var REACTION_TIME_S = 0.15;
  var DEFAULT_LEAD_RPM = 200;
  var MIN_LEAD_RPM = 100;
  var MAX_LEAD_RPM = 1e3;
  var MAX_RPM_RATE = 5e4;
  var RPM_RATE_ALPHA = 0.25;
  function isForwardGear2(gear) {
    return Number.isInteger(gear) && gear >= 1 && gear <= 10;
  }
  function isThrottleHeld(telemetry) {
    if (telemetry.isRaceOn === false || !Number.isFinite(telemetry.throttle) || telemetry.throttle < 0.95) return false;
    if (Number.isFinite(telemetry.brake) && telemetry.brake > 0.02) return false;
    return !(Number.isFinite(telemetry.handBrake) && telemetry.handBrake > 0.02);
  }
  function isClutchPressed(telemetry) {
    return Number.isFinite(telemetry.clutch) && telemetry.clutch > 0.05;
  }
  function roundRpm2(value) {
    return Math.max(0, Math.round(value));
  }
  function fallbackPhase(rpm, rpmMax) {
    if (!Number.isFinite(rpm) || !Number.isFinite(rpmMax) || rpmMax <= 0) return "normal";
    return rpm >= rpmMax * 0.85 ? "approach" : "normal";
  }
  function normalizeIdentityKey(key) {
    return typeof key === "string" && key.startsWith("fh6:") ? key : null;
  }
  function getShiftLightCarKey(telemetry) {
    const ordinal = telemetry.car?.ordinal, carClass = telemetry.car?.class, pi = telemetry.car?.pi;
    const drivetrain = telemetry.car?.drivetrain, cylinders = telemetry.car?.cylinders;
    if (!Number.isFinite(ordinal) || ordinal <= 0 || !Number.isFinite(carClass) || carClass < 0 || !Number.isFinite(pi) || pi <= 0 || !Number.isFinite(drivetrain) || drivetrain < 0 || !Number.isFinite(cylinders) || cylinders <= 0) return null;
    return ["fh6", Math.round(ordinal), Math.round(carClass), Math.round(pi), Math.round(drivetrain), Math.round(cylinders)].join(":");
  }
  function getShiftLightIdentity(telemetry) {
    const key = getShiftLightCarKey(telemetry);
    if (!key) return null;
    const parts = key.split(":");
    return { gameId: "fh6", carOrdinal: Number(parts[1]), carClass: Number(parts[2]), pi: Number(parts[3]), drivetrain: Number(parts[4]), cylinders: Number(parts[5]), rpmMax: Number.isFinite(telemetry.rpmMax) ? telemetry.rpmMax : 0, key };
  }
  var ShiftLightLearner = class {
    constructor(key, options = {}) {
      this.key = key;
      this.options = options;
    }
    key;
    options;
    estimator = new OptimalShiftEstimator();
    previous = null;
    preShiftFrames = [];
    cleanRunStartMs = null;
    cleanRunGear = 0;
    // The last clean frame and what followed it: whether the throttle stayed held and the clutch was pressed.
    cleanRunEndMs = null;
    heldSinceCleanRun = false;
    clutchSinceCleanRun = false;
    pendingUpshift = null;
    rpmRate = null;
    maxObservedGear = 0;
    latestRpmMax = 0;
    setProfile(_profile) {
    }
    setProfiles(_profiles) {
    }
    getProfiles() {
      return this.estimator.getStates().filter((state) => state.status === "optimal").map((state) => ({ key: this.key, gear: state.sourceGear, shiftRpm: state.targetRpm, sampleCount: state.evidence.length, status: "optimal", method: "optimal" }));
    }
    serializeLearningState() {
      return this.estimator.serializeLearningState(this.key);
    }
    importLearningState(state) {
      this.estimator.importLearningState(state, this.key);
      this.publishLearningState();
    }
    mergeLearningState(state) {
      if (this.estimator.mergeLearningState(state, this.key)) this.publishLearningState();
    }
    exportLearningState() {
      return this.serializeLearningState();
    }
    exportState() {
      return this.serializeLearningState();
    }
    importState(state) {
      this.importLearningState(state);
    }
    mergeState(state) {
      this.mergeLearningState(state);
    }
    reset() {
      this.estimator.reset();
      this.previous = null;
      this.preShiftFrames = [];
      this.cleanRunStartMs = null;
      this.resetCleanRunEnd();
      this.pendingUpshift = null;
      this.rpmRate = null;
      this.maxObservedGear = 0;
      this.latestRpmMax = 0;
      this.publishLearningState();
    }
    resetTransient() {
      this.estimator.resetTransient();
      this.previous = null;
      this.preShiftFrames = [];
      this.cleanRunStartMs = null;
      this.resetCleanRunEnd();
      this.pendingUpshift = null;
      this.rpmRate = null;
    }
    update(telemetry) {
      let previous = this.previous;
      if (previous && !this.hasContinuousTimestamp(previous, telemetry)) {
        this.resetTransient();
        previous = null;
      }
      if (Number.isFinite(telemetry.rpmMax) && telemetry.rpmMax > 0) this.latestRpmMax = telemetry.rpmMax;
      const forward = isForwardGear2(telemetry.gear);
      if (forward) this.maxObservedGear = Math.max(this.maxObservedGear, telemetry.gear);
      this.estimator.ingest(telemetry);
      this.captureShift(previous, telemetry, forward);
      this.estimator.refreshModel(telemetry.timestampMs);
      this.updateRpmRate(previous, telemetry);
      this.previous = telemetry;
      return this.snapshot(telemetry);
    }
    snapshot(telemetry = this.previous) {
      const identity = this.parseIdentity(), currentGear = telemetry && isForwardGear2(telemetry.gear) ? telemetry.gear : null;
      const current = currentGear === null ? null : this.estimator.getState(currentGear);
      const rpmMax = telemetry?.rpmMax ?? this.latestRpmMax;
      const usableCeiling = this.estimator.getUsableCeiling();
      const provisionalCeiling = usableCeiling === null ? this.estimator.getProvisionalCeiling(rpmMax > 0 ? rpmMax : null) : null;
      const fallbackShiftRpm = usableCeiling ?? provisionalCeiling ?? (rpmMax > 0 ? roundRpm2(rpmMax) : null);
      const modelRpm = currentGear === null ? null : this.estimator.getModelRpm(currentGear);
      const effectiveTargetRpm = modelRpm ?? current?.targetRpm ?? current?.candidateRpm ?? fallbackShiftRpm;
      const leadRpm = this.getLeadRpm(), lightOnRpm = effectiveTargetRpm === null ? null : Math.max(0, roundRpm2(effectiveTargetRpm - leadRpm));
      let phase = fallbackPhase(telemetry?.rpm ?? 0, rpmMax);
      if (lightOnRpm !== null && telemetry) phase = telemetry.rpm >= lightOnRpm ? "shift" : phase;
      const highestKnownGear = Math.max(this.maxObservedGear, this.estimator.getHighestKnownGear());
      const lastKnownGear = currentGear !== null && currentGear >= highestKnownGear;
      const learned = modelRpm !== null || current?.status === "optimal" || current?.status === "potential";
      const status = learned ? "calibrated" : current ? "learning" : "fallback";
      const lastEvidence = current?.evidence[current.evidence.length - 1] ?? null;
      return {
        status,
        phase,
        shiftRpm: effectiveTargetRpm,
        effectiveTargetRpm,
        lightOnRpm,
        leadRpm,
        acceptedShiftCount: current?.evidence.length ?? 0,
        lastRpmBefore: lastEvidence?.beforeRpm ?? null,
        lastDeltaPct: lastEvidence?.powerDeltaPct ?? null,
        sampleCount: current?.evidence.length ?? 0,
        carKey: normalizeIdentityKey(this.key),
        gameId: identity?.gameId ?? null,
        carOrdinal: identity?.carOrdinal ?? null,
        pi: identity?.pi ?? null,
        rpmMax: rpmMax > 0 ? rpmMax : null,
        reportedRedlineRpm: this.estimator.getReportedRedlineRpm(),
        usableCeiling,
        ceilingSampleCount: this.estimator.getCeilingSampleCount(),
        ceilingClusterCount: this.estimator.getCeilingClusterCount(),
        provisionalCeiling,
        fallbackShiftRpm,
        carClass: identity?.carClass ?? null,
        drivetrain: identity?.drivetrain ?? null,
        cylinders: identity?.cylinders ?? null,
        gearCount: null,
        observedGearCount: this.maxObservedGear,
        gearboxChanged: false,
        gearboxValidation: null,
        gearboxSignature: null,
        currentGear,
        lastKnownGear,
        method: learned ? "optimal" : null,
        gears: this.getGearStates(fallbackShiftRpm ?? this.estimator.getReportedRedlineRpm()),
        diagnostics: this.getGearDiagnostics()
      };
    }
    clearConfiguration() {
      this.reset();
    }
    publishLearningState() {
      this.options.onLearningState?.(this.serializeLearningState());
    }
    captureShift(previous, telemetry, forward) {
      const clean = isCleanShiftEvidence(telemetry);
      const pending = this.pendingUpshift;
      if (pending) {
        if (pending.transitionTimestampMs === null) {
          if (pending.firstNeutralTimestampMs !== null && telemetry.timestampMs - pending.firstNeutralTimestampMs > MAX_NEUTRAL_WINDOW_MS) this.pendingUpshift = null;
          else if (forward && telemetry.gear === pending.destinationGear) {
            const runEndMs = this.cleanRunEndMs;
            const clutchShift = runEndMs !== null && this.heldSinceCleanRun && this.clutchSinceCleanRun && isThrottleHeld(telemetry);
            const referenceMs = clutchShift ? runEndMs : telemetry.timestampMs;
            const fresh = clutchShift && telemetry.timestampMs - runEndMs > MAX_CLUTCH_SHIFT_GAP_MS ? [] : pending.beforeFrames.filter((item) => referenceMs - item.timestampMs >= 0 && referenceMs - item.timestampMs <= PRE_SHIFT_WINDOW_MS);
            if (fresh.length === 0) this.pendingUpshift = null;
            else {
              pending.beforeFrames = fresh;
              pending.transitionTimestampMs = telemetry.timestampMs;
            }
          } else if (telemetry.gear !== NEUTRAL_GEAR) this.pendingUpshift = null;
        }
        if (this.pendingUpshift && pending.transitionTimestampMs !== null) {
          const elapsed = telemetry.timestampMs - pending.transitionTimestampMs;
          if (elapsed > POST_SHIFT_WINDOW_MS || forward && telemetry.gear !== pending.destinationGear) this.pendingUpshift = null;
          else if (forward && telemetry.gear === pending.destinationGear && elapsed >= POST_SHIFT_DELAY_MS && clean) {
            pending.postFrames.push(telemetry);
            if (pending.postFrames.length >= MIN_POST_SHIFT_FRAMES) this.finishShift(pending);
          }
        }
      }
      if (forward) {
        if (previous && isForwardGear2(previous.gear) && telemetry.gear === previous.gear + 1) this.startPostShift(previous.gear, telemetry.gear, telemetry.timestampMs, this.preShiftFrames);
      }
      if (forward && clean) {
        this.cleanRunEndMs = telemetry.timestampMs;
        this.heldSinceCleanRun = true;
        this.clutchSinceCleanRun = false;
        if (this.cleanRunStartMs === null || this.cleanRunGear !== telemetry.gear) {
          this.cleanRunStartMs = telemetry.timestampMs;
          this.cleanRunGear = telemetry.gear;
          this.preShiftFrames = [];
        }
        const settled = telemetry.timestampMs - this.cleanRunStartMs >= PRE_SHIFT_SETTLE_MS;
        if (settled) this.estimator.observeModelFrame(telemetry);
        if (settled && (!this.pendingUpshift || this.pendingUpshift.sourceGear !== telemetry.gear)) this.preShiftFrames = [...this.preShiftFrames.filter((item) => telemetry.timestampMs - item.timestampMs <= PRE_SHIFT_WINDOW_MS), telemetry].slice(-MAX_PRE_SHIFT_FRAMES);
        return;
      }
      this.cleanRunStartMs = null;
      this.heldSinceCleanRun = this.heldSinceCleanRun && isThrottleHeld(telemetry);
      if (isClutchPressed(telemetry)) this.clutchSinceCleanRun = true;
      if (forward) return;
      if (telemetry.gear === NEUTRAL_GEAR && this.preShiftFrames.length > 0) {
        const sourceGear = this.preShiftFrames[this.preShiftFrames.length - 1].gear;
        if (sourceGear >= 1 && sourceGear < 10) this.pendingUpshift = { sourceGear, destinationGear: sourceGear + 1, beforeFrames: [...this.preShiftFrames], transitionTimestampMs: null, firstNeutralTimestampMs: telemetry.timestampMs, postFrames: [] };
      } else if (telemetry.gear !== NEUTRAL_GEAR) {
        this.preShiftFrames = [];
        this.pendingUpshift = null;
      }
    }
    resetCleanRunEnd() {
      this.cleanRunEndMs = null;
      this.heldSinceCleanRun = false;
      this.clutchSinceCleanRun = false;
    }
    startPostShift(sourceGear, destinationGear, timestampMs, beforeFrames) {
      const fresh = beforeFrames.filter((item) => timestampMs - item.timestampMs >= 0 && timestampMs - item.timestampMs <= PRE_SHIFT_WINDOW_MS);
      if (fresh.length > 0) this.pendingUpshift = { sourceGear, destinationGear, beforeFrames: fresh, transitionTimestampMs: timestampMs, firstNeutralTimestampMs: null, postFrames: [] };
    }
    finishShift(pending) {
      const before = this.medianTelemetry(pending.beforeFrames), after = this.medianTelemetry(pending.postFrames.slice(0, MAX_POST_SHIFT_FRAMES));
      this.pendingUpshift = null;
      if (!before || !after) return;
      const evidence = this.estimator.observeTransition({ sourceGear: pending.sourceGear, destinationGear: pending.destinationGear, before, after });
      if (!evidence) return;
      this.publishLearningState();
      const state = this.estimator.getState(pending.sourceGear);
      this.options.onProgress?.({ key: this.key, gear: pending.sourceGear, shiftRpm: state?.targetRpm ?? null, sampleCount: state?.evidence.length ?? 0, status: state?.status ?? "learning", method: "optimal" });
      if (state?.status === "optimal") this.options.onCalibrated?.({ key: this.key, gear: pending.sourceGear, shiftRpm: state.targetRpm, sampleCount: state.evidence.length, status: "optimal", method: "optimal" });
    }
    /** Median timestamp, RPM, power and per-wheel slip ratio of a window; other fields come from its middle frame. */
    medianTelemetry(frames) {
      if (frames.length === 0) return null;
      const median = (values) => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
      };
      const pivot = frames[Math.floor(frames.length / 2)];
      const slips = frames.map((item) => item.slipRatio);
      const slipRatio = slips.every((slip) => slip && typeof slip === "object") ? { fl: median(slips.map((slip) => slip.fl)), fr: median(slips.map((slip) => slip.fr)), rl: median(slips.map((slip) => slip.rl)), rr: median(slips.map((slip) => slip.rr)) } : pivot.slipRatio;
      return { ...pivot, timestampMs: median(frames.map((item) => item.timestampMs)), rpm: median(frames.map((item) => item.rpm)), power: median(frames.map((item) => item.power)), slipRatio };
    }
    getLeadRpm() {
      const raw = (this.rpmRate ?? 0) * REACTION_TIME_S;
      return Math.round(Math.max(MIN_LEAD_RPM, Math.min(MAX_LEAD_RPM, Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LEAD_RPM)));
    }
    getGearStates(fallbackShiftRpm) {
      return this.estimator.getStates().map((state) => {
        const last = state.evidence[state.evidence.length - 1] ?? null;
        const modelRpm = this.estimator.getModelRpm(state.sourceGear);
        return {
          gear: state.sourceGear,
          status: state.status,
          shiftRpm: state.targetRpm ?? state.candidateRpm,
          sampleCount: state.evidence.length,
          method: state.status === "learning" ? null : "optimal",
          ratioDrop: null,
          candidateRpm: state.candidateRpm,
          confirmationCount: state.confirmationCount,
          confirmationRpms: [...state.confirmationRpms],
          lastReason: state.lastReason,
          acceptedShiftCount: state.evidence.length,
          lastRpmBefore: last?.beforeRpm ?? null,
          lastDeltaPct: last?.powerDeltaPct ?? null,
          modelRpm,
          shiftAtRpm: modelRpm ?? state.targetRpm ?? state.candidateRpm ?? fallbackShiftRpm,
          ready: modelRpm !== null || state.status === "optimal"
        };
      });
    }
    getGearDiagnostics() {
      return this.estimator.getStates().map((state) => this.estimator.diagnose(state.sourceGear));
    }
    updateRpmRate(previous, telemetry) {
      if (!previous || !isCleanShiftEvidence(previous) || !isCleanShiftEvidence(telemetry) || previous.gear !== telemetry.gear) {
        this.rpmRate = null;
        return;
      }
      if (telemetry.timestampMs === previous.timestampMs) return;
      const dt = (telemetry.timestampMs - previous.timestampMs) / 1e3, rate = (telemetry.rpm - previous.rpm) / dt;
      if (dt < 5e-3 || dt > 0.1 || !Number.isFinite(rate) || rate <= 0 || rate > MAX_RPM_RATE) {
        this.rpmRate = null;
        return;
      }
      this.rpmRate = this.rpmRate === null ? rate : this.rpmRate * (1 - RPM_RATE_ALPHA) + rate * RPM_RATE_ALPHA;
    }
    parseIdentity() {
      const parts = this.key.split(":");
      if (parts.length !== 6 || parts[0] !== "fh6") return null;
      const values = parts.slice(1, 6).map(Number);
      if (values.some((value) => !Number.isFinite(value))) return null;
      return { gameId: "fh6", carOrdinal: values[0], carClass: values[1], pi: values[2], drivetrain: values[3], cylinders: values[4] };
    }
    hasContinuousTimestamp(previous, telemetry) {
      const delta = telemetry.timestampMs - previous.timestampMs;
      return Number.isFinite(delta) && delta >= 0 && delta <= MAX_TIMESTAMP_GAP_MS;
    }
  };
  return __toCommonJS(shift_light_exports);
})();
if (typeof globalThis !== "undefined") globalThis.HudShiftLight = HudShiftLight; if (typeof module !== "undefined") module.exports = HudShiftLight;

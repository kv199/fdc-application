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

  // src/shift-light/optimal-shift.ts
  var SHIFT_LIGHT_LEARNING_VERSION = 4;
  var FORWARD_GEAR_MIN = 1;
  var FORWARD_GEAR_MAX = 10;
  var MAX_SHIFT_SAMPLES = 64;
  var MAX_CONFIRMATIONS = 3;
  var CONFIRMATION_STABILITY_RPM = 100;
  var MAX_CEILING_SAMPLES = 3;
  var MIN_TRUSTED_CEILING_SAMPLES = 3;
  var CEILING_SAMPLE_STABILITY_RPM = 100;
  var MIN_LIMITER_RISE_RPM = 100;
  var MIN_LIMITER_DROP_RPM = 40;
  var LIMITER_RECOVERY_TOLERANCE_RPM = 60;
  var MAX_CLEAN_TIMESTAMP_GAP_MS = 1e3;
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
      evidence: []
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
  function normalizeCeilingSamples(value) {
    return Array.isArray(value) ? value.map((item) => finiteInRange(item, 0, 1e5)).filter((item) => item !== null).map(roundRpm).slice(-MAX_CEILING_SAMPLES) : [];
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
    ingest(telemetry) {
      if (Number.isFinite(telemetry.rpmMax) && telemetry.rpmMax > 0) this.reportedRedlineRpm = roundRpm(telemetry.rpmMax);
      if (cleanWotMotionTelemetry(telemetry) && telemetry.gear < FORWARD_GEAR_MAX) this.getOrCreate(telemetry.gear);
      this.observeLimiter(telemetry);
    }
    /** Only completed clean windows are stored; a negative delta is observation, not driver failure. */
    observeTransition(observation) {
      const { sourceGear, destinationGear, before, after } = observation;
      if (!isForwardGear(sourceGear) || destinationGear !== sourceGear + 1) return null;
      if (!cleanPowerTelemetry(before) || !cleanPowerTelemetry(after) || before.timestampMs > after.timestampMs) return null;
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
    serializeLearningState(key) {
      return {
        modelVersion: SHIFT_LIGHT_LEARNING_VERSION,
        version: SHIFT_LIGHT_LEARNING_VERSION,
        key,
        reportedRedlineRpm: this.reportedRedlineRpm,
        ceilingSamples: [...this.ceilingSamples],
        usableCeiling: this.usableCeiling,
        gearTargets: this.getStates(),
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
        const derivedRpms = candidateRpm === null ? [] : targetSamples.map((sample) => sample.beforeRpm).filter((rpm) => Math.abs(rpm - candidateRpm) <= CONFIRMATION_STABILITY_RPM).slice(-MAX_CONFIRMATIONS);
        target.confirmationRpms = (explicitRpms.length > 0 ? explicitRpms : derivedRpms).slice(-MAX_CONFIRMATIONS);
        target.confirmationCount = Math.min(MAX_CONFIRMATIONS, Math.max(persistedCount, target.confirmationRpms.length));
        target.lastReason = typeof item.lastReason === "string" ? item.lastReason.slice(0, 160) : null;
        target.evidence = samples.filter((sample) => sample.sourceGear === target.sourceGear && sample.destinationGear === target.destinationGear);
        restored.set(target.sourceGear, target);
      }
      this.gears.clear();
      restored.forEach((value, gear) => this.gears.set(gear, value));
      this.shiftSamples = samples.slice(-MAX_SHIFT_SAMPLES);
      this.ceilingSamples = normalizeCeilingSamples(raw.ceilingSamples);
      this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples);
      this.reportedRedlineRpm = finiteInRange(raw.reportedRedlineRpm, 0, 1e5);
      return true;
    }
    mergeLearningState(state, key) {
      const incoming = new _OptimalShiftEstimator();
      if (!incoming.importLearningState(state, key)) return false;
      for (const target of incoming.getStates()) {
        const current = this.gears.get(target.sourceGear);
        if (!current) this.gears.set(target.sourceGear, target);
        else if (this.statusRank(target.status) > this.statusRank(current.status)) {
          this.mergeSameRank(target, current);
          this.gears.set(target.sourceGear, target);
        } else this.mergeSameRank(current, target);
      }
      const seen = new Set(this.shiftSamples.map((item) => `${item.beforeTimestampMs}:${item.afterTimestampMs}`));
      this.shiftSamples = [...this.shiftSamples, ...incoming.shiftSamples.filter((item) => !seen.has(`${item.beforeTimestampMs}:${item.afterTimestampMs}`))].slice(-MAX_SHIFT_SAMPLES);
      this.ceilingSamples = normalizeCeilingSamples([...this.ceilingSamples, ...incoming.ceilingSamples]);
      this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples);
      this.reportedRedlineRpm = incoming.reportedRedlineRpm ?? this.reportedRedlineRpm;
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
        evidenceCount: state?.evidence.length ?? 0
      };
    }
    reset() {
      this.gears.clear();
      this.shiftSamples = [];
      this.ceilingSamples = [];
      this.usableCeiling = null;
      this.reportedRedlineRpm = null;
      this.resetTransient();
    }
    resetTransient() {
      this.limiterTracker = null;
      this.lastCleanTelemetry = null;
      this.limiterRearmed = true;
    }
    getUsableCeiling() {
      return this.usableCeiling;
    }
    getCeilingSampleCount() {
      return this.ceilingSamples.length;
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
      const seen = new Set(current.evidence.map((item) => `${item.beforeTimestampMs}:${item.afterTimestampMs}`));
      current.evidence = [...current.evidence, ...incoming.evidence.filter((item) => !seen.has(`${item.beforeTimestampMs}:${item.afterTimestampMs}`))].slice(-MAX_SHIFT_SAMPLES);
      const anchor = current.targetRpm ?? current.candidateRpm ?? incoming.targetRpm ?? incoming.candidateRpm;
      const confirmations = anchor === null ? [] : current.evidence.filter((item) => item.outcome === "better" && Math.abs(item.beforeRpm - anchor) <= CONFIRMATION_STABILITY_RPM).map((item) => item.beforeRpm).slice(-MAX_CONFIRMATIONS);
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
      if (samples.length < MIN_TRUSTED_CEILING_SAMPLES) return null;
      const sorted = [...samples].sort((a, b) => a - b);
      if (sorted[sorted.length - 1] - sorted[0] > CEILING_SAMPLE_STABILITY_RPM) return null;
      return sorted[Math.floor(sorted.length / 2)];
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
      this.ceilingSamples = [...this.ceilingSamples, roundRpm(sample)].slice(-MAX_CEILING_SAMPLES);
      this.usableCeiling = this.deriveUsableCeiling(this.ceilingSamples);
    }
  };

  // src/shift-light/shift-light.ts
  var NEUTRAL_GEAR = 11;
  var MAX_TIMESTAMP_GAP_MS = 1e3;
  var PRE_SHIFT_WINDOW_MS = 200;
  var MAX_PRE_SHIFT_FRAMES = 5;
  var POST_SHIFT_DELAY_MS = 80;
  var POST_SHIFT_WINDOW_MS = 600;
  var MAX_NEUTRAL_WINDOW_MS = 400;
  var MIN_POST_SHIFT_FRAMES = 3;
  var MAX_POST_SHIFT_FRAMES = 5;
  var REACTION_TIME_S = 0.15;
  var DEFAULT_LEAD_RPM = 200;
  var MIN_LEAD_RPM = 100;
  var MAX_LEAD_RPM = 500;
  var MAX_RPM_RATE = 5e4;
  var RPM_RATE_ALPHA = 0.25;
  function isForwardGear2(gear) {
    return Number.isInteger(gear) && gear >= 1 && gear <= 10;
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
      this.updateRpmRate(previous, telemetry);
      this.previous = telemetry;
      return this.snapshot(telemetry);
    }
    snapshot(telemetry = this.previous) {
      const identity = this.parseIdentity(), currentGear = telemetry && isForwardGear2(telemetry.gear) ? telemetry.gear : null;
      const current = currentGear === null ? null : this.estimator.getState(currentGear);
      const rpmMax = telemetry?.rpmMax ?? this.latestRpmMax;
      const fallbackShiftRpm = this.estimator.getUsableCeiling() ?? (rpmMax > 0 ? roundRpm2(rpmMax) : null);
      const effectiveTargetRpm = current?.targetRpm ?? current?.candidateRpm ?? fallbackShiftRpm;
      const leadRpm = this.getLeadRpm(), lightOnRpm = effectiveTargetRpm === null ? null : Math.max(0, roundRpm2(effectiveTargetRpm - leadRpm));
      let phase = fallbackPhase(telemetry?.rpm ?? 0, rpmMax);
      if (lightOnRpm !== null && telemetry) phase = telemetry.rpm >= lightOnRpm ? "shift" : phase;
      const status = current?.status === "optimal" || current?.status === "potential" ? "calibrated" : current ? "learning" : "fallback";
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
        usableCeiling: this.estimator.getUsableCeiling(),
        ceilingSampleCount: this.estimator.getCeilingSampleCount(),
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
        method: current?.status === "optimal" || current?.status === "potential" ? "optimal" : null,
        gears: this.getGearStates(),
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
            const fresh = pending.beforeFrames.filter((item) => telemetry.timestampMs - item.timestampMs >= 0 && telemetry.timestampMs - item.timestampMs <= PRE_SHIFT_WINDOW_MS);
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
        if (!this.pendingUpshift || this.pendingUpshift.sourceGear !== telemetry.gear) this.preShiftFrames = [...this.preShiftFrames.filter((item) => telemetry.timestampMs - item.timestampMs <= PRE_SHIFT_WINDOW_MS), telemetry].slice(-MAX_PRE_SHIFT_FRAMES);
      } else if (telemetry.gear === NEUTRAL_GEAR && this.preShiftFrames.length > 0) {
        const sourceGear = this.preShiftFrames[this.preShiftFrames.length - 1].gear;
        if (sourceGear >= 1 && sourceGear < 10) this.pendingUpshift = { sourceGear, destinationGear: sourceGear + 1, beforeFrames: [...this.preShiftFrames], transitionTimestampMs: null, firstNeutralTimestampMs: telemetry.timestampMs, postFrames: [] };
      } else if (!forward && telemetry.gear !== NEUTRAL_GEAR) {
        this.preShiftFrames = [];
        this.pendingUpshift = null;
      }
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
    medianTelemetry(frames) {
      if (frames.length === 0) return null;
      const median = (values) => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
      };
      const pivot = frames[Math.floor(frames.length / 2)];
      return { ...pivot, timestampMs: median(frames.map((item) => item.timestampMs)), rpm: median(frames.map((item) => item.rpm)), power: median(frames.map((item) => item.power)) };
    }
    getLeadRpm() {
      const raw = (this.rpmRate ?? 0) * REACTION_TIME_S;
      return Math.round(Math.max(MIN_LEAD_RPM, Math.min(MAX_LEAD_RPM, Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LEAD_RPM)));
    }
    getGearStates() {
      return this.estimator.getStates().map((state) => {
        const last = state.evidence[state.evidence.length - 1] ?? null;
        return { gear: state.sourceGear, status: state.status, shiftRpm: state.targetRpm ?? state.candidateRpm, sampleCount: state.evidence.length, method: state.status === "learning" ? null : "optimal", ratioDrop: null, candidateRpm: state.candidateRpm, confirmationCount: state.confirmationCount, confirmationRpms: [...state.confirmationRpms], lastReason: state.lastReason, acceptedShiftCount: state.evidence.length, lastRpmBefore: last?.beforeRpm ?? null, lastDeltaPct: last?.powerDeltaPct ?? null };
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

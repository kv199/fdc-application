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
  var SHIFT_LIGHT_LEARNING_VERSION = 2;
  var FORWARD_GEAR_MIN = 1;
  var FORWARD_GEAR_MAX = 10;
  var POWER_BIN_RPM = 200;
  var MAX_POWER_BINS_PER_GEAR = 64;
  var MAX_POWER_SAMPLES_PER_BIN = 24;
  var MAX_SHIFT_EVIDENCE_PER_GEAR = 32;
  var MAX_CONFIRMATIONS = 3;
  var CONFIRMATION_STABILITY_RPM = 100;
  var MIN_SPEED_KMH = 1;
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
  function cleanPowerTelemetry(telemetry) {
    if (telemetry.isRaceOn === false) return false;
    if (!Number.isFinite(telemetry.throttle) || telemetry.throttle < 0.95) return false;
    if (!Number.isFinite(telemetry.clutch) || telemetry.clutch > 0.05) return false;
    if (Number.isFinite(telemetry.brake) && telemetry.brake > 0.02) return false;
    if (Number.isFinite(telemetry.handBrake) && telemetry.handBrake > 0.02) return false;
    if (!isForwardGear(telemetry.gear) || !finitePositive(telemetry.rpm)) return false;
    if (!finitePositive(telemetry.power) || !finitePositive(telemetry.speedKmh)) return false;
    const slip = telemetry.combinedSlip;
    if (slip) {
      const driven = telemetry.car.drivetrain === 0 ? [slip.fl, slip.fr] : telemetry.car.drivetrain === 1 ? [slip.rl, slip.rr] : [slip.fl, slip.fr, slip.rl, slip.rr];
      if (driven.some((value) => Number.isFinite(value) && Math.abs(value) > 0.2)) return false;
    }
    return true;
  }
  function isCleanShiftEvidence(telemetry) {
    return cleanPowerTelemetry(telemetry);
  }
  function emptyGear(sourceGear) {
    return {
      sourceGear,
      status: "learning",
      targetRpm: null,
      candidateRpm: null,
      confirmingRpms: [],
      confirmingCount: 0,
      replacementCandidateRpm: null,
      replacementConfirmingRpms: [],
      targetContradicted: false,
      lastReason: null,
      powerBins: [],
      evidence: []
    };
  }
  function cloneGear(state) {
    return {
      sourceGear: state.sourceGear,
      status: state.status,
      targetRpm: state.targetRpm,
      candidateRpm: state.candidateRpm,
      confirmingRpms: [...state.confirmingRpms],
      confirmingCount: state.confirmingCount,
      replacementCandidateRpm: state.replacementCandidateRpm,
      replacementConfirmingRpms: [...state.replacementConfirmingRpms],
      targetContradicted: state.targetContradicted,
      lastReason: state.lastReason,
      powerBins: state.powerBins.map((bin) => ({ ...bin })),
      evidence: state.evidence.map((item) => ({ ...item }))
    };
  }
  function normalizePowerBin(value) {
    if (!value || typeof value !== "object") return null;
    const raw = value;
    const rpmBucket = finiteInRange(raw.rpmBucket, 0, 1e5);
    const sampleCount = finiteInRange(raw.sampleCount, 0, MAX_POWER_SAMPLES_PER_BIN);
    const powerSum = finiteInRange(raw.powerSum, 0, Number.MAX_SAFE_INTEGER);
    const torqueSum = finiteInRange(raw.torqueSum, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const torqueSampleCount = finiteInRange(raw.torqueSampleCount, 0, MAX_POWER_SAMPLES_PER_BIN);
    const speedSum = finiteInRange(raw.speedSum, 0, Number.MAX_SAFE_INTEGER);
    const speedSampleCount = finiteInRange(raw.speedSampleCount, 0, MAX_POWER_SAMPLES_PER_BIN);
    if (rpmBucket === null || sampleCount === null || powerSum === null || torqueSum === null || torqueSampleCount === null || speedSum === null || speedSampleCount === null) return null;
    return {
      rpmBucket: roundRpm(rpmBucket),
      sampleCount: Math.round(sampleCount),
      medianPower: sampleCount > 0 ? powerSum / sampleCount : 0,
      medianTorque: torqueSampleCount > 0 ? torqueSum / torqueSampleCount : null,
      medianSpeed: speedSampleCount > 0 ? speedSum / speedSampleCount : null,
      powerSum,
      torqueSum,
      torqueSampleCount: Math.round(torqueSampleCount),
      speedSum,
      speedSampleCount: Math.round(speedSampleCount)
    };
  }
  function normalizeEvidence(value, sourceGear) {
    if (!value || typeof value !== "object") return null;
    const raw = value;
    const destinationGear = finiteInRange(raw.destinationGear, sourceGear + 1, FORWARD_GEAR_MAX);
    const beforeTimestampMs = finiteInRange(raw.beforeTimestampMs, 0, Number.MAX_SAFE_INTEGER);
    const afterTimestampMs = finiteInRange(raw.afterTimestampMs, 0, Number.MAX_SAFE_INTEGER);
    const beforeRpm = finiteInRange(raw.beforeRpm, 0, 1e5);
    const afterRpm = finiteInRange(raw.afterRpm, 0, 1e5);
    const beforePower = finiteInRange(raw.beforePower, 0, Number.MAX_SAFE_INTEGER);
    const afterPower = finiteInRange(raw.afterPower, 0, Number.MAX_SAFE_INTEGER);
    const beforeSpeedKmh = finiteInRange(raw.beforeSpeedKmh, MIN_SPEED_KMH, 2e3);
    const afterSpeedKmh = finiteInRange(raw.afterSpeedKmh, MIN_SPEED_KMH, 2e3);
    if (destinationGear === null || beforeTimestampMs === null || afterTimestampMs === null || beforeRpm === null || afterRpm === null || beforePower === null || afterPower === null || beforeSpeedKmh === null || afterSpeedKmh === null) return null;
    const outcome = raw.outcome;
    if (outcome !== "better" && outcome !== "too_early" && outcome !== "invalid") return null;
    const beforeTorque = raw.beforeTorque === null ? null : finiteInRange(raw.beforeTorque, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    const afterTorque = raw.afterTorque === null ? null : finiteInRange(raw.afterTorque, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    return {
      sourceGear,
      destinationGear: Math.round(destinationGear),
      beforeTimestampMs,
      afterTimestampMs,
      beforeRpm,
      afterRpm,
      beforePower,
      afterPower,
      beforeTorque,
      afterTorque,
      beforeSpeedKmh,
      afterSpeedKmh,
      beforeSpeed: beforeSpeedKmh,
      afterSpeed: afterSpeedKmh,
      outcome
    };
  }
  var OptimalShiftEstimator = class _OptimalShiftEstimator {
    gears = /* @__PURE__ */ new Map();
    ingest(telemetry) {
      if (!cleanPowerTelemetry(telemetry)) return;
      const state = this.getOrCreate(telemetry.gear);
      const rpmBucket = Math.round(telemetry.rpm / POWER_BIN_RPM) * POWER_BIN_RPM;
      let bin = state.powerBins.find((candidate) => candidate.rpmBucket === rpmBucket);
      if (!bin) {
        if (state.powerBins.length >= MAX_POWER_BINS_PER_GEAR) {
          state.powerBins.sort((left, right) => left.rpmBucket - right.rpmBucket);
          state.powerBins.shift();
        }
        bin = {
          rpmBucket,
          sampleCount: 0,
          medianPower: 0,
          medianTorque: null,
          medianSpeed: null,
          powerSum: 0,
          torqueSum: 0,
          torqueSampleCount: 0,
          speedSum: 0,
          speedSampleCount: 0
        };
        state.powerBins.push(bin);
      }
      if (bin.sampleCount >= MAX_POWER_SAMPLES_PER_BIN) return;
      bin.sampleCount += 1;
      bin.powerSum += telemetry.power;
      bin.speedSum += telemetry.speedKmh;
      bin.speedSampleCount += 1;
      if (Number.isFinite(telemetry.torque)) {
        bin.torqueSum += telemetry.torque;
        bin.torqueSampleCount += 1;
      }
      bin.medianPower = bin.powerSum / bin.sampleCount;
      bin.medianTorque = bin.torqueSampleCount > 0 ? bin.torqueSum / bin.torqueSampleCount : null;
      bin.medianSpeed = bin.speedSampleCount > 0 ? bin.speedSum / bin.speedSampleCount : null;
    }
    /** Record a completed Gx→Gx+1 observation, including rejected observations. */
    observeTransition(observation) {
      const { sourceGear, destinationGear, before, after } = observation;
      if (!isForwardGear(sourceGear) || destinationGear !== sourceGear + 1) return null;
      const valid = cleanPowerTelemetry(before) && cleanPowerTelemetry(after) && before.timestampMs <= after.timestampMs;
      const outcome = !valid ? "invalid" : after.power / after.speedKmh > before.power / before.speedKmh ? "better" : "too_early";
      const evidence = {
        sourceGear,
        destinationGear,
        beforeTimestampMs: before.timestampMs,
        afterTimestampMs: after.timestampMs,
        beforeRpm: roundRpm(before.rpm),
        afterRpm: roundRpm(after.rpm),
        beforePower: before.power,
        afterPower: after.power,
        beforeTorque: Number.isFinite(before.torque) ? before.torque : null,
        afterTorque: Number.isFinite(after.torque) ? after.torque : null,
        beforeSpeedKmh: before.speedKmh,
        afterSpeedKmh: after.speedKmh,
        beforeSpeed: before.speedKmh,
        afterSpeed: after.speedKmh,
        outcome
      };
      const state = this.getOrCreate(sourceGear);
      state.evidence.push(evidence);
      if (state.evidence.length > MAX_SHIFT_EVIDENCE_PER_GEAR) state.evidence.shift();
      this.applyOutcome(state, evidence);
      return { ...evidence };
    }
    getState(gear) {
      const state = this.gears.get(gear);
      return state ? cloneGear(state) : null;
    }
    getStates() {
      return [...this.gears.values()].sort((left, right) => left.sourceGear - right.sourceGear).map(cloneGear);
    }
    serializeLearningState(key) {
      return {
        modelVersion: SHIFT_LIGHT_LEARNING_VERSION,
        version: SHIFT_LIGHT_LEARNING_VERSION,
        key,
        gears: this.getStates()
      };
    }
    importLearningState(state, key) {
      if (!state || typeof state !== "object") return false;
      const raw = state;
      const modelVersion = raw.modelVersion ?? raw.version;
      if (modelVersion !== SHIFT_LIGHT_LEARNING_VERSION || raw.key !== key || !Array.isArray(raw.gears)) return false;
      const restored = /* @__PURE__ */ new Map();
      for (const candidate of raw.gears.slice(0, FORWARD_GEAR_MAX)) {
        if (!candidate || typeof candidate !== "object") continue;
        const value = candidate;
        const sourceGear = finiteInRange(value.sourceGear, FORWARD_GEAR_MIN, FORWARD_GEAR_MAX);
        if (sourceGear === null) continue;
        const stateValue = emptyGear(Math.round(sourceGear));
        if (value.status === "learning" || value.status === "confirming" || value.status === "optimal") stateValue.status = value.status;
        stateValue.targetRpm = finiteInRange(value.targetRpm, 0, 1e5);
        stateValue.candidateRpm = finiteInRange(value.candidateRpm, 0, 1e5);
        stateValue.replacementCandidateRpm = finiteInRange(value.replacementCandidateRpm, 0, 1e5);
        stateValue.targetContradicted = value.targetContradicted === true;
        stateValue.confirmingRpms = this.normalizeConfirmations(value.confirmingRpms);
        stateValue.confirmingCount = Math.min(MAX_CONFIRMATIONS, Math.max(0, Math.round(Number(value.confirmingCount ?? stateValue.confirmingRpms.length))));
        stateValue.replacementConfirmingRpms = this.normalizeConfirmations(value.replacementConfirmingRpms);
        stateValue.lastReason = typeof value.lastReason === "string" ? value.lastReason.slice(0, 160) : null;
        if (Array.isArray(value.powerBins)) {
          stateValue.powerBins = value.powerBins.map(normalizePowerBin).filter((bin) => bin !== null).slice(0, MAX_POWER_BINS_PER_GEAR);
        }
        if (Array.isArray(value.evidence)) {
          stateValue.evidence = value.evidence.map((item) => normalizeEvidence(item, stateValue.sourceGear)).filter((item) => item !== null).slice(-MAX_SHIFT_EVIDENCE_PER_GEAR);
        }
        restored.set(stateValue.sourceGear, stateValue);
      }
      this.gears.clear();
      for (const [gear, value] of restored) this.gears.set(gear, value);
      return true;
    }
    /**
     * Combines persisted completed facts with facts collected while persistence
     * was resolving. Pull state is intentionally absent from both inputs.
     */
    mergeLearningState(state, key) {
      const persisted = new _OptimalShiftEstimator();
      if (!persisted.importLearningState(state, key)) return false;
      for (const incoming of persisted.getStates()) {
        const current = this.gears.get(incoming.sourceGear);
        if (!current) {
          this.gears.set(incoming.sourceGear, incoming);
          continue;
        }
        const preferred = this.statusRank(incoming.status) > this.statusRank(current.status) ? incoming : current;
        const merged = cloneGear(preferred);
        merged.powerBins = this.mergePowerBins(current.powerBins, incoming.powerBins);
        merged.evidence = this.mergeEvidence(current.evidence, incoming.evidence);
        if (!merged.lastReason) merged.lastReason = current.lastReason ?? incoming.lastReason;
        this.gears.set(merged.sourceGear, merged);
      }
      return true;
    }
    /** Compatibility aliases for callers that prefer shorter names. */
    exportState(key) {
      return this.serializeLearningState(key);
    }
    importState(state, key) {
      return this.importLearningState(state, key);
    }
    diagnose(gear) {
      const state = this.gears.get(gear);
      const bins = state?.powerBins ?? [];
      const reliable = bins.filter((bin) => bin.sampleCount > 0).sort((left, right) => left.rpmBucket - right.rpmBucket);
      const peak = reliable.reduce((best, bin) => {
        const power = bin.powerSum / bin.sampleCount;
        const bestPower = best ? best.powerSum / best.sampleCount : -Infinity;
        return power > bestPower ? bin : best;
      }, null);
      const candidate = state?.candidateRpm ?? state?.targetRpm ?? null;
      return {
        gear,
        powerCurveCoverage: reliable.length > 0 ? 1 : 0,
        powerBinCount: reliable.length,
        peakPowerRpm: peak?.rpmBucket ?? null,
        currentRatio: null,
        nextRatio: null,
        ratioDrop: null,
        currentRatioSamples: 0,
        nextRatioSamples: 0,
        targetRpm: state?.targetRpm ?? candidate,
        postShiftRpm: null,
        powerAtTarget: candidate === null ? null : this.powerAt(state, candidate),
        powerAfterShift: null,
        estimateEvidence: state?.evidence.filter((item) => item.outcome === "better").length ?? 0,
        status: state?.status ?? "learning",
        confirmingCount: state?.confirmingRpms.length ?? 0,
        lastReason: state?.lastReason ?? null,
        evidenceCount: state?.evidence.length ?? 0
      };
    }
    reset() {
      this.gears.clear();
    }
    resetTransient() {
    }
    getOrCreate(gear) {
      let state = this.gears.get(gear);
      if (!state) {
        state = emptyGear(gear);
        this.gears.set(gear, state);
      }
      return state;
    }
    applyOutcome(state, evidence) {
      if (evidence.outcome === "invalid") {
        state.lastReason = "Last shift was not usable: throttle, controls, speed or wheel slip was invalid.";
        return;
      }
      if (evidence.outcome === "too_early") {
        state.lastReason = "Last clean shift was too early: the next gear produced less wheel force.";
        if (state.status === "optimal" && state.targetRpm !== null && Math.abs(evidence.beforeRpm - state.targetRpm) <= CONFIRMATION_STABILITY_RPM) {
          state.targetContradicted = true;
          state.replacementCandidateRpm = null;
          state.replacementConfirmingRpms = [];
        }
        return;
      }
      state.lastReason = null;
      if (state.status === "optimal") {
        if (!state.targetContradicted || state.targetRpm === null || evidence.beforeRpm <= state.targetRpm) return;
        if (state.replacementCandidateRpm === null) {
          state.replacementCandidateRpm = evidence.beforeRpm;
          state.replacementConfirmingRpms = [evidence.beforeRpm];
          return;
        }
        const replacementValues = [...state.replacementConfirmingRpms, evidence.beforeRpm];
        if (Math.max(...replacementValues) - Math.min(...replacementValues) > CONFIRMATION_STABILITY_RPM) {
          state.replacementCandidateRpm = evidence.beforeRpm;
          state.replacementConfirmingRpms = [evidence.beforeRpm];
          return;
        }
        state.replacementConfirmingRpms = replacementValues.slice(-MAX_CONFIRMATIONS);
        if (state.replacementConfirmingRpms.length >= MAX_CONFIRMATIONS) {
          state.targetRpm = Math.min(...state.replacementConfirmingRpms);
          state.candidateRpm = state.targetRpm;
          state.confirmingRpms = [...state.replacementConfirmingRpms];
          state.confirmingCount = MAX_CONFIRMATIONS;
          state.replacementCandidateRpm = null;
          state.replacementConfirmingRpms = [];
          state.targetContradicted = false;
        }
        return;
      }
      if (state.candidateRpm === null) {
        state.candidateRpm = evidence.beforeRpm;
        state.confirmingRpms = [evidence.beforeRpm];
        state.confirmingCount = 1;
        state.status = "confirming";
        return;
      }
      const values = [...state.confirmingRpms, evidence.beforeRpm];
      if (Math.max(...values) - Math.min(...values) > CONFIRMATION_STABILITY_RPM) {
        state.candidateRpm = evidence.beforeRpm;
        state.confirmingRpms = [evidence.beforeRpm];
        state.confirmingCount = 1;
        state.status = "confirming";
        return;
      }
      state.confirmingRpms = values.slice(-MAX_CONFIRMATIONS);
      state.confirmingCount = state.confirmingRpms.length;
      if (state.confirmingRpms.length >= MAX_CONFIRMATIONS) {
        state.targetRpm = Math.min(...state.confirmingRpms);
        state.candidateRpm = state.targetRpm;
        state.status = "optimal";
      } else {
        state.status = "confirming";
      }
    }
    statusRank(status) {
      return status === "optimal" ? 3 : status === "confirming" ? 2 : 1;
    }
    mergePowerBins(current, incoming) {
      const bins = /* @__PURE__ */ new Map();
      for (const item of [...incoming, ...current]) {
        const existing = bins.get(item.rpmBucket);
        if (!existing) {
          bins.set(item.rpmBucket, { ...item });
          continue;
        }
        const count = Math.min(MAX_POWER_SAMPLES_PER_BIN, existing.sampleCount + item.sampleCount);
        const averagePower = (existing.powerSum + item.powerSum) / Math.max(1, existing.sampleCount + item.sampleCount);
        const torqueCount = Math.min(MAX_POWER_SAMPLES_PER_BIN, existing.torqueSampleCount + item.torqueSampleCount);
        const averageTorque = (existing.torqueSum + item.torqueSum) / Math.max(1, existing.torqueSampleCount + item.torqueSampleCount);
        const speedCount = Math.min(MAX_POWER_SAMPLES_PER_BIN, existing.speedSampleCount + item.speedSampleCount);
        const averageSpeed = (existing.speedSum + item.speedSum) / Math.max(1, existing.speedSampleCount + item.speedSampleCount);
        existing.sampleCount = count;
        existing.powerSum = averagePower * count;
        existing.medianPower = averagePower;
        existing.torqueSampleCount = torqueCount;
        existing.torqueSum = averageTorque * torqueCount;
        existing.medianTorque = torqueCount > 0 ? averageTorque : null;
        existing.speedSampleCount = speedCount;
        existing.speedSum = averageSpeed * speedCount;
        existing.medianSpeed = speedCount > 0 ? averageSpeed : null;
      }
      return [...bins.values()].sort((left, right) => left.rpmBucket - right.rpmBucket).slice(-MAX_POWER_BINS_PER_GEAR);
    }
    mergeEvidence(current, incoming) {
      const facts = /* @__PURE__ */ new Map();
      for (const item of [...incoming, ...current]) {
        const key = `${item.sourceGear}:${item.destinationGear}:${item.beforeTimestampMs}:${item.afterTimestampMs}:${item.beforeRpm}`;
        facts.set(key, { ...item });
      }
      return [...facts.values()].sort((left, right) => left.afterTimestampMs - right.afterTimestampMs).slice(-MAX_SHIFT_EVIDENCE_PER_GEAR);
    }
    normalizeConfirmations(value) {
      if (!Array.isArray(value)) return [];
      return value.map((item) => finiteInRange(item, 0, 1e5)).filter((item) => item !== null).map(roundRpm).slice(-MAX_CONFIRMATIONS);
    }
    powerAt(state, rpm) {
      if (!state) return null;
      const bin = state.powerBins.find((item) => item.rpmBucket === Math.round(rpm / POWER_BIN_RPM) * POWER_BIN_RPM);
      return bin && bin.sampleCount > 0 ? bin.powerSum / bin.sampleCount : null;
    }
  };

  // src/shift-light/shift-light.ts
  var NEUTRAL_GEAR = 11;
  var MAX_TIMESTAMP_GAP_MS = 1e3;
  var MAX_NEUTRAL_MS = 200;
  var MAX_NEUTRAL_FRAMES = 64;
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
    if (rpm >= rpmMax) return "approach";
    if (rpm >= rpmMax * 0.85) return "approach";
    return "normal";
  }
  function normalizeIdentityKey(key) {
    return typeof key === "string" && key.startsWith("fh6:") ? key : null;
  }
  function getShiftLightCarKey(telemetry) {
    const ordinal = telemetry.car?.ordinal;
    const carClass = telemetry.car?.class;
    const pi = telemetry.car?.pi;
    const drivetrain = telemetry.car?.drivetrain;
    const cylinders = telemetry.car?.cylinders;
    if (!Number.isFinite(ordinal) || ordinal <= 0 || !Number.isFinite(carClass) || carClass < 0 || !Number.isFinite(pi) || pi <= 0 || !Number.isFinite(drivetrain) || drivetrain < 0 || !Number.isFinite(cylinders) || cylinders <= 0) return null;
    return [
      "fh6",
      Math.round(ordinal),
      Math.round(carClass),
      Math.round(pi),
      Math.round(drivetrain),
      Math.round(cylinders)
    ].join(":");
  }
  function getShiftLightIdentity(telemetry) {
    const key = getShiftLightCarKey(telemetry);
    if (!key) return null;
    const parts = key.split(":");
    return {
      gameId: "fh6",
      carOrdinal: Number(parts[1]),
      carClass: Number(parts[2]),
      pi: Number(parts[3]),
      drivetrain: Number(parts[4]),
      cylinders: Number(parts[5]),
      rpmMax: Number.isFinite(telemetry.rpmMax) ? telemetry.rpmMax : 0,
      key
    };
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
    pullGear = null;
    pullPeak = null;
    pendingUpshift = null;
    rpmRate = null;
    maxObservedGear = 0;
    latestRpmMax = 0;
    /** Old profile loading is intentionally ignored; use importLearningState. */
    setProfile(_profile) {
    }
    setProfiles(_profiles) {
    }
    getProfiles() {
      return this.estimator.getStates().filter((state) => state.status === "optimal").map((state) => ({
        key: this.key,
        gear: state.sourceGear,
        shiftRpm: state.targetRpm,
        sampleCount: state.evidence.length,
        status: "optimal",
        method: "optimal"
      }));
    }
    serializeLearningState() {
      return this.estimator.serializeLearningState(this.key);
    }
    importLearningState(state) {
      this.estimator.importLearningState(state, this.key);
      this.publishLearningState();
    }
    /** Join persisted completed facts with samples collected before async load. */
    mergeLearningState(state) {
      if (this.estimator.mergeLearningState(state, this.key)) this.publishLearningState();
    }
    /** Short aliases for integrations that already use the estimator naming. */
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
      this.pullGear = null;
      this.pullPeak = null;
      this.pendingUpshift = null;
      this.rpmRate = null;
      this.maxObservedGear = 0;
      this.latestRpmMax = 0;
      this.publishLearningState();
    }
    resetTransient() {
      this.previous = null;
      this.pullGear = null;
      this.pullPeak = null;
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
      if (isCleanShiftEvidence(telemetry)) this.publishLearningState();
      if (forward) {
        const transition = this.getUpshiftTransition(previous, telemetry);
        if (transition) {
          const evidence = this.estimator.observeTransition({
            sourceGear: transition.sourceGear,
            destinationGear: telemetry.gear,
            before: transition.before,
            after: telemetry
          });
          if (evidence) {
            this.publishLearningState();
            this.options.onProgress?.({
              key: this.key,
              gear: transition.sourceGear,
              shiftRpm: this.estimator.getState(transition.sourceGear)?.targetRpm ?? null,
              sampleCount: this.estimator.getState(transition.sourceGear)?.evidence.length ?? 0,
              status: this.estimator.getState(transition.sourceGear)?.status ?? "learning",
              method: "optimal"
            });
            if (evidence.outcome === "better" && this.estimator.getState(transition.sourceGear)?.status === "optimal") {
              this.options.onCalibrated?.({
                key: this.key,
                gear: transition.sourceGear,
                shiftRpm: this.estimator.getState(transition.sourceGear)?.targetRpm ?? null,
                sampleCount: this.estimator.getState(transition.sourceGear)?.evidence.length ?? 0,
                status: "optimal",
                method: "optimal"
              });
            }
          }
        }
        this.pendingUpshift = null;
        if (this.pullGear !== telemetry.gear) {
          this.pullGear = telemetry.gear;
          this.pullPeak = null;
        }
        if (isCleanShiftEvidence(telemetry)) {
          if (!this.pullPeak || telemetry.rpm >= this.pullPeak.rpm) this.pullPeak = telemetry;
        }
      } else if (telemetry.gear === NEUTRAL_GEAR && this.pullGear !== null && this.pullPeak) {
        const pending = this.pendingUpshift?.sourceGear === this.pullGear ? this.pendingUpshift : { sourceGear: this.pullGear, before: this.pullPeak, firstNeutralTimestampMs: telemetry.timestampMs, neutralFrames: 0 };
        const elapsed = telemetry.timestampMs - pending.firstNeutralTimestampMs;
        pending.neutralFrames += 1;
        if (elapsed <= MAX_NEUTRAL_MS && pending.neutralFrames <= MAX_NEUTRAL_FRAMES) this.pendingUpshift = pending;
        else this.resetTransient();
      } else if (!forward) {
        this.resetTransient();
      }
      this.updateRpmRate(previous, telemetry);
      this.previous = telemetry;
      return this.snapshot(telemetry);
    }
    snapshot(telemetry = this.previous) {
      const identity = this.parseIdentity();
      const currentGear = telemetry && isForwardGear2(telemetry.gear) ? telemetry.gear : null;
      const current = currentGear === null ? null : this.estimator.getState(currentGear);
      const shiftRpm = current?.targetRpm ?? current?.candidateRpm ?? null;
      const rpmMax = telemetry?.rpmMax ?? this.latestRpmMax;
      let phase = fallbackPhase(telemetry?.rpm ?? 0, rpmMax);
      if (shiftRpm !== null && telemetry) phase = telemetry.rpm >= shiftRpm ? "shift" : "normal";
      const status = current?.status === "optimal" || current?.status === "confirming" ? "calibrated" : "learning";
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
        fallbackShiftRpm: rpmMax > 0 ? roundRpm2(rpmMax) : null,
        carClass: identity?.carClass ?? null,
        drivetrain: identity?.drivetrain ?? null,
        cylinders: identity?.cylinders ?? null,
        gearCount: null,
        observedGearCount: this.maxObservedGear,
        gearboxChanged: false,
        gearboxValidation: null,
        gearboxSignature: null,
        currentGear,
        method: current?.status === "optimal" ? "optimal" : current?.status === "confirming" ? "optimal" : null,
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
    getUpshiftTransition(previous, telemetry) {
      if (this.pendingUpshift && telemetry.gear === this.pendingUpshift.sourceGear + 1 && telemetry.timestampMs - this.pendingUpshift.firstNeutralTimestampMs <= MAX_NEUTRAL_MS) return this.pendingUpshift;
      if (previous && isForwardGear2(previous.gear) && telemetry.gear === previous.gear + 1 && this.pullGear === previous.gear && this.pullPeak) return { sourceGear: previous.gear, before: this.pullPeak };
      return null;
    }
    getGearStates() {
      return this.estimator.getStates().map((state) => ({
        gear: state.sourceGear,
        status: state.status,
        shiftRpm: state.targetRpm ?? state.candidateRpm,
        sampleCount: state.evidence.length,
        method: state.status === "learning" ? null : "optimal",
        ratioDrop: null,
        candidateRpm: state.candidateRpm,
        confirmingCount: state.confirmingRpms.length,
        lastReason: state.lastReason
      }));
    }
    getGearDiagnostics() {
      return this.estimator.getStates().map((state) => this.estimator.diagnose(state.sourceGear));
    }
    updateRpmRate(previous, telemetry) {
      if (!previous || !isCleanShiftEvidence(previous) || !isCleanShiftEvidence(telemetry) || previous.gear !== telemetry.gear) {
        this.rpmRate = null;
        return;
      }
      const dt = (telemetry.timestampMs - previous.timestampMs) / 1e3;
      const rate = (telemetry.rpm - previous.rpm) / dt;
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

// Generated from apps/co-driver/app/utils/shift-light.ts; keep this file synchronized with the source.
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

  // apps/co-driver/app/utils/shift-light.ts
  var shift_light_exports = {};
  __export(shift_light_exports, {
    ShiftLightLearner: () => ShiftLightLearner,
    getShiftLightCarKey: () => getShiftLightCarKey,
    getShiftLightIdentity: () => getShiftLightIdentity
  });

  // apps/co-driver/app/utils/optimal-shift.ts
  var FORWARD_GEAR_MIN = 1;
  var FORWARD_GEAR_MAX = 10;
  var WOT_THRESHOLD = 0.95;
  var POWER_BIN_RPM = 100;
  var MIN_POWER_SAMPLES = 3;
  var MAX_RATIO_SAMPLES = 240;
  var MIN_RATIO_SAMPLES = 20;
  var MIN_GEARBOX_SIGNATURE_DROPS = 2;
  var MAX_GEARBOX_SIGNATURE_DROPS = FORWARD_GEAR_MAX - FORWARD_GEAR_MIN;
  var GEARBOX_SIGNATURE_SCALE = 1e3;
  var GEARBOX_SIGNATURE_FORMAT_DECIMALS = 4;
  var MIN_DRIVEN_WHEEL_RAD_S = 5;
  var MIN_ENGINE_RPM = 1200;
  var MAX_CLUTCH = 0.05;
  var MIN_RATIO_DROP = 0.45;
  var MAX_RATIO_DROP = 0.95;
  var MIN_TARGET_RPM_FRACTION = 0.65;
  var MAX_TARGET_RPM_FRACTION = 0.99;
  var CURVE_COVERAGE_FRACTION = 0.9;
  var LIMITER_TARGET_FRACTION = 0.98;
  var MAX_INTERPOLATION_GAP_RPM = POWER_BIN_RPM * 2;
  var TARGET_STEP_RPM = 25;
  var CROSSOVER_CONFIRM_STEPS = 3;
  function isForwardGear(gear) {
    return Number.isFinite(gear) && gear >= FORWARD_GEAR_MIN && gear <= FORWARD_GEAR_MAX;
  }
  function median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  function drivenWheelSpeed(telemetry) {
    const wheels = telemetry.wheelRotation;
    if (!wheels) return null;
    const values = telemetry.car.drivetrain === 0 ? [wheels.fl, wheels.fr] : telemetry.car.drivetrain === 1 ? [wheels.rl, wheels.rr] : [wheels.fl, wheels.fr, wheels.rl, wheels.rr];
    if (values.some((value) => !Number.isFinite(value))) return null;
    const average = values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
    return average >= MIN_DRIVEN_WHEEL_RAD_S ? average : null;
  }
  var OptimalShiftEstimator = class {
    powerBins = /* @__PURE__ */ new Map();
    ratioSamples = /* @__PURE__ */ new Map();
    rpmMax = 0;
    ingest(telemetry) {
      if (Number.isFinite(telemetry.rpmMax) && telemetry.rpmMax > this.rpmMax) {
        this.rpmMax = telemetry.rpmMax;
      }
      this.ingestRatio(telemetry);
      this.ingestPower(telemetry);
    }
    reset() {
      this.powerBins.clear();
      this.ratioSamples.clear();
      this.rpmMax = 0;
    }
    getRatioDrop(gear) {
      const currentSamples = this.ratioSamples.get(gear) ?? [];
      const nextSamples = this.ratioSamples.get(gear + 1) ?? [];
      if (currentSamples.length < MIN_RATIO_SAMPLES || nextSamples.length < MIN_RATIO_SAMPLES) return null;
      const currentRatio = median(currentSamples);
      const nextRatio = median(nextSamples);
      if (currentRatio === null || nextRatio === null || currentRatio <= 0) return null;
      const ratioDrop = nextRatio / currentRatio;
      if (ratioDrop < MIN_RATIO_DROP || ratioDrop > MAX_RATIO_DROP) return null;
      return {
        ratioDrop,
        evidence: Math.min(currentSamples.length, nextSamples.length)
      };
    }
    /**
     * Returns a bounded, stable fingerprint once enough adjacent gear ratios
     * have been observed. The learner uses this for every profile method, not
     * only optimal targets, so partial observed evidence cannot cross gearbox
     * variants with the same car identity.
     */
    getGearboxSignature() {
      const drops = [];
      for (let gear = FORWARD_GEAR_MIN; gear < FORWARD_GEAR_MAX; gear += 1) {
        const ratio = this.getRatioDrop(gear);
        if (!ratio) continue;
        const canonicalDrop = Math.round(ratio.ratioDrop * GEARBOX_SIGNATURE_SCALE) / GEARBOX_SIGNATURE_SCALE;
        drops.push(`${gear}:${canonicalDrop.toFixed(GEARBOX_SIGNATURE_FORMAT_DECIMALS)}`);
        if (drops.length >= MAX_GEARBOX_SIGNATURE_DROPS) break;
      }
      return drops.length >= MIN_GEARBOX_SIGNATURE_DROPS ? drops.join("|") : null;
    }
    diagnose(gear) {
      const currentSamples = this.ratioSamples.get(gear) ?? [];
      const nextSamples = this.ratioSamples.get(gear + 1) ?? [];
      const currentRatio = median(currentSamples);
      const nextRatio = median(nextSamples);
      const rawRatioDrop = currentRatio !== null && nextRatio !== null && currentRatio > 0 ? nextRatio / currentRatio : null;
      const ratioDrop = rawRatioDrop !== null && rawRatioDrop >= MIN_RATIO_DROP && rawRatioDrop <= MAX_RATIO_DROP ? rawRatioDrop : null;
      const reliableBins = this.getReliablePowerBins();
      const highestReliableRpm = reliableBins.at(-1)?.[0] ?? 0;
      const peakPower = reliableBins.reduce((best, candidate) => !best || candidate[1].maxPower > best[1].maxPower ? candidate : best, null);
      const estimate = this.estimate(gear);
      const targetRpm = estimate?.shiftRpm ?? null;
      const postShiftRpm = targetRpm !== null && ratioDrop !== null ? targetRpm * ratioDrop : null;
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
      };
    }
    estimate(gear) {
      if (!isForwardGear(gear) || gear >= FORWARD_GEAR_MAX || this.rpmMax <= 0) return null;
      const ratio = this.getRatioDrop(gear);
      if (!ratio) return null;
      const reliableBins = this.getReliablePowerBins();
      if (reliableBins.length < 8) return null;
      const highestReliableRpm = reliableBins.at(-1)[0];
      if (highestReliableRpm < this.rpmMax * CURVE_COVERAGE_FRACTION) return null;
      const firstCandidate = Math.round(this.rpmMax * MIN_TARGET_RPM_FRACTION / TARGET_STEP_RPM) * TARGET_STEP_RPM;
      const lastCandidate = Math.min(
        highestReliableRpm,
        Math.floor(this.rpmMax * MAX_TARGET_RPM_FRACTION / TARGET_STEP_RPM) * TARGET_STEP_RPM
      );
      let confirmedSteps = 0;
      let firstCrossingRpm = null;
      for (let rpm = firstCandidate; rpm <= lastCandidate; rpm += TARGET_STEP_RPM) {
        const currentPower = this.powerAt(rpm, reliableBins);
        const nextPower = this.powerAt(rpm * ratio.ratioDrop, reliableBins);
        if (currentPower === null || nextPower === null || nextPower < currentPower) {
          confirmedSteps = 0;
          firstCrossingRpm = null;
          continue;
        }
        if (confirmedSteps === 0) firstCrossingRpm = rpm;
        confirmedSteps += 1;
        if (confirmedSteps >= CROSSOVER_CONFIRM_STEPS && firstCrossingRpm !== null) {
          return {
            gear,
            shiftRpm: firstCrossingRpm,
            ratioDrop: ratio.ratioDrop,
            evidence: Math.min(999, ratio.evidence + reliableBins.length)
          };
        }
      }
      const limiterTarget = Math.round(this.rpmMax * LIMITER_TARGET_FRACTION / TARGET_STEP_RPM) * TARGET_STEP_RPM;
      if (highestReliableRpm >= limiterTarget && this.powerAt(limiterTarget, reliableBins) !== null && this.powerAt(limiterTarget * ratio.ratioDrop, reliableBins) !== null) {
        return {
          gear,
          shiftRpm: limiterTarget,
          ratioDrop: ratio.ratioDrop,
          evidence: Math.min(999, ratio.evidence + reliableBins.length)
        };
      }
      return null;
    }
    ingestRatio(telemetry) {
      if (!isForwardGear(telemetry.gear)) return;
      if (!Number.isFinite(telemetry.rpm) || telemetry.rpm < MIN_ENGINE_RPM) return;
      if (!Number.isFinite(telemetry.clutch) || telemetry.clutch > MAX_CLUTCH) return;
      const wheelSpeed = drivenWheelSpeed(telemetry);
      if (wheelSpeed === null) return;
      const ratio = telemetry.rpm / wheelSpeed;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      const samples = this.ratioSamples.get(telemetry.gear) ?? [];
      samples.push(ratio);
      if (samples.length > MAX_RATIO_SAMPLES) samples.shift();
      this.ratioSamples.set(telemetry.gear, samples);
    }
    ingestPower(telemetry) {
      if (!isForwardGear(telemetry.gear)) return;
      if (!Number.isFinite(telemetry.throttle) || telemetry.throttle < WOT_THRESHOLD) return;
      if (!Number.isFinite(telemetry.clutch) || telemetry.clutch > MAX_CLUTCH) return;
      if (!Number.isFinite(telemetry.rpm) || telemetry.rpm <= 0) return;
      if (!Number.isFinite(telemetry.rpmMax) || telemetry.rpmMax <= 0 || telemetry.rpm > telemetry.rpmMax * 1.05) return;
      if (!Number.isFinite(telemetry.power) || telemetry.power <= 0) return;
      const rpmBin = Math.round(telemetry.rpm / POWER_BIN_RPM) * POWER_BIN_RPM;
      const existing = this.powerBins.get(rpmBin);
      if (existing) {
        existing.maxPower = Math.max(existing.maxPower, telemetry.power);
        existing.samples += 1;
      } else {
        this.powerBins.set(rpmBin, { maxPower: telemetry.power, samples: 1 });
      }
    }
    getReliablePowerBins() {
      return [...this.powerBins.entries()].filter(([, bin]) => bin.samples >= MIN_POWER_SAMPLES && bin.maxPower > 0).sort(([left], [right]) => left - right);
    }
    powerAt(rpm, bins) {
      let lower = null;
      let upper = null;
      for (const bin of bins) {
        if (bin[0] <= rpm) lower = bin;
        if (bin[0] >= rpm) {
          upper = bin;
          break;
        }
      }
      if (!lower || !upper || upper[0] - lower[0] > MAX_INTERPOLATION_GAP_RPM) return null;
      if (lower[0] === upper[0]) return lower[1].maxPower;
      const fraction = (rpm - lower[0]) / (upper[0] - lower[0]);
      return lower[1].maxPower + (upper[1].maxPower - lower[1].maxPower) * fraction;
    }
  };

  // apps/co-driver/app/utils/shift-light.ts
  var MIN_THROTTLE = 0.95;
  var MIN_RPM_FRACTION = 0.82;
  var REARM_FRACTION = 0.85;
  var MIN_RPM_DROP = 40;
  var RPM_DROP_FRACTION = 4e-3;
  var RPM_OFFSET = 75;
  var REQUIRED_SAMPLES = 5;
  var NEUTRAL_GEAR = 11;
  var MAX_NEUTRAL_MS = 200;
  var MAX_NEUTRAL_FRAMES = 64;
  var MAX_TIMESTAMP_GAP_MS = 1e3;
  var MAX_EVIDENCE_SAMPLES = 5;
  var OPTIMAL_CONFIRM_SAMPLES = 3;
  var OPTIMAL_STABILITY_RPM = 100;
  var OPTIMAL_UPDATE_RPM = 50;
  var SHIFT_SIGNAL_LEAD_MS = 180;
  var APPROACH_SIGNAL_LEAD_MS = 380;
  var MAX_SHIFT_SIGNAL_LEAD_RPM = 1200;
  var MAX_APPROACH_SIGNAL_LEAD_RPM = 1800;
  var MAX_RPM_RATE = 5e4;
  var RPM_RATE_ALPHA = 0.25;
  function isForwardGear2(gear) {
    return Number.isFinite(gear) && gear >= 1 && gear <= 10;
  }
  function fallbackPhase(rpm, rpmMax) {
    if (!Number.isFinite(rpm) || !Number.isFinite(rpmMax) || rpmMax <= 0) return "normal";
    const fraction = rpm / rpmMax;
    if (fraction >= 0.98) return "shift";
    if (fraction >= 0.85) return "approach";
    return "normal";
  }
  function roundRpm(value) {
    return Math.max(0, Math.round(value));
  }
  function observedShiftRpm(samples) {
    if (samples.length < REQUIRED_SAMPLES) return null;
    const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
    return roundRpm(average - RPM_OFFSET);
  }
  function normalizeGearboxSignature(signature) {
    return typeof signature === "string" && signature.length > 0 ? signature : null;
  }
  var GEARBOX_SIGNATURE_TOLERANCE = 5e-3;
  function parseGearboxSignature(signature) {
    return signature.split("|").map((part) => {
      const [gearText, ratioText] = part.split(":");
      const gear = Number(gearText);
      const ratioDrop = Number(ratioText);
      if (!Number.isInteger(gear) || !Number.isFinite(ratioDrop)) return null;
      return { gear, ratioDrop, token: part };
    }).filter((part) => part !== null);
  }
  function signaturesHaveCompatibleKnownParts(previous, detected) {
    const detectedByGear = new Map(detected.map((part) => [part.gear, part.ratioDrop]));
    return previous.every((part) => {
      const detectedRatio = detectedByGear.get(part.gear);
      return detectedRatio === void 0 || Math.abs(detectedRatio - part.ratioDrop) <= GEARBOX_SIGNATURE_TOLERANCE;
    });
  }
  function signaturesAreCompatible(left, right) {
    const leftParts = parseGearboxSignature(left);
    const rightParts = parseGearboxSignature(right);
    if (leftParts.length === 0 || rightParts.length === 0) return false;
    return signaturesHaveCompatibleKnownParts(leftParts, rightParts) && signaturesHaveCompatibleKnownParts(rightParts, leftParts);
  }
  function mergeGearboxSignatures(previous, detected) {
    if (!previous) return detected;
    const previousParts = parseGearboxSignature(previous);
    const detectedParts = parseGearboxSignature(detected);
    if (previousParts.length === 0 || detectedParts.length === 0) return detected;
    if (!signaturesHaveCompatibleKnownParts(previousParts, detectedParts)) return detected;
    const detectedGears = new Set(detectedParts.map((part) => part.gear));
    if (previousParts.some((part) => !detectedGears.has(part.gear))) return previous;
    const previousByGear = new Map(previousParts.map((part) => [part.gear, part]));
    const merged = detectedParts.map((part) => previousByGear.get(part.gear) ?? part);
    for (const part of previousParts) {
      if (!merged.some((candidate) => candidate.gear === part.gear)) merged.push(part);
    }
    return merged.sort((left, right) => left.gear - right.gear).map((part) => part.token).join("|");
  }
  function isSignatureExtension(previous, next) {
    const previousParts = parseGearboxSignature(previous);
    const nextParts = parseGearboxSignature(next);
    const nextGears = new Set(nextParts.map((part) => part.gear));
    return nextParts.length > previousParts.length && previousParts.every((part) => nextGears.has(part.gear)) && signaturesHaveCompatibleKnownParts(previousParts, nextParts);
  }
  function getShiftLightCarKey(telemetry) {
    const ordinal = telemetry.car?.ordinal;
    const pi = telemetry.car?.pi;
    const rpmMax = telemetry.rpmMax;
    if (!Number.isFinite(ordinal) || ordinal <= 0) return null;
    if (!Number.isFinite(pi) || pi <= 0) return null;
    if (!Number.isFinite(rpmMax) || rpmMax <= 0) return null;
    return `fh6:${Math.round(ordinal)}:${Math.round(pi)}:${roundRpm(rpmMax)}`;
  }
  function getShiftLightIdentity(telemetry) {
    const key = getShiftLightCarKey(telemetry);
    if (!key) return null;
    const parts = key.split(":");
    return {
      gameId: "fh6",
      carOrdinal: Number(parts[1]),
      pi: Number(parts[2]),
      rpmMax: Number(parts[3]),
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
    profiles = /* @__PURE__ */ new Map();
    pendingOptimalProfiles = /* @__PURE__ */ new Map();
    samples = /* @__PURE__ */ new Map();
    observedGears = /* @__PURE__ */ new Set();
    optimalCandidates = /* @__PURE__ */ new Map();
    optimalEstimator = new OptimalShiftEstimator();
    mismatchedOptimalGears = /* @__PURE__ */ new Set();
    storedGearboxSignatures = /* @__PURE__ */ new Map();
    previous = null;
    pullGear = null;
    pullPeakRpm = 0;
    limiterCommitted = false;
    limiterCandidate = null;
    pendingUpshift = null;
    rpmRate = null;
    gearboxSignature = null;
    dirtyGears = /* @__PURE__ */ new Set();
    /** Compatibility helper for callers that only have one stored profile. */
    setProfile(profile) {
      if (profile) this.setProfiles([profile]);
    }
    setProfiles(profiles) {
      for (const profile of profiles) {
        if (profile.key !== this.key) continue;
        if (!Number.isInteger(profile.gear) || profile.gear < 0 || profile.gear > 10) continue;
        if (!Number.isFinite(profile.shiftRpm) && !Array.isArray(profile.samples)) continue;
        if (this.dirtyGears.has(profile.gear)) continue;
        const samples = this.normalizeSamples(profile.samples);
        const method = profile.method === "optimal" ? "optimal" : "observed";
        const maxSampleCount = method === "optimal" ? 999 : MAX_EVIDENCE_SAMPLES;
        const storedSampleCount = Number.isFinite(profile.sampleCount) ? Math.max(0, Math.round(profile.sampleCount)) : 0;
        const sampleCount = Math.min(
          maxSampleCount,
          Math.max(storedSampleCount, samples.length)
        );
        const storedShiftRpm = typeof profile.shiftRpm === "number" && Number.isFinite(profile.shiftRpm) ? roundRpm(profile.shiftRpm) : null;
        const completedObservedShiftRpm = storedShiftRpm === null && method === "observed" ? observedShiftRpm(samples) : null;
        const effectiveShiftRpm = storedShiftRpm ?? completedObservedShiftRpm;
        const calibrated = effectiveShiftRpm !== null && (profile.status === "calibrated" || sampleCount >= REQUIRED_SAMPLES);
        const normalized = {
          key: this.key,
          gear: profile.gear,
          shiftRpm: calibrated ? effectiveShiftRpm : null,
          sampleCount,
          status: calibrated ? "calibrated" : "learning",
          samples,
          method,
          ratioDrop: Number.isFinite(profile.ratioDrop) ? profile.ratioDrop : null,
          gearboxSignature: normalizeGearboxSignature(profile.gearboxSignature)
        };
        this.storedGearboxSignatures.set(normalized.gear, normalized.gearboxSignature ?? null);
        if (!calibrated) {
          if (samples.length > 0) this.samples.set(normalized.gear, samples);
          this.observedGears.add(normalized.gear);
          continue;
        }
        if (normalized.method === "optimal" && normalized.ratioDrop !== null) {
          this.pendingOptimalProfiles.set(normalized.gear, normalized);
        } else {
          this.profiles.set(normalized.gear, normalized);
        }
        if (samples.length > 0) this.samples.set(normalized.gear, samples);
        if (normalized.gear > 0) this.observedGears.add(normalized.gear);
      }
    }
    getProfiles() {
      return [...this.profiles.values()].sort((left, right) => left.gear - right.gear);
    }
    reset() {
      this.profiles.clear();
      this.pendingOptimalProfiles.clear();
      this.samples.clear();
      this.observedGears.clear();
      this.optimalCandidates.clear();
      this.mismatchedOptimalGears.clear();
      this.storedGearboxSignatures.clear();
      this.dirtyGears.clear();
      this.optimalEstimator.reset();
      this.gearboxSignature = null;
      this.resetPull();
      this.previous = null;
      this.rpmRate = null;
    }
    /**
     * Pause/disconnect boundaries must not erase calibration. They only end the
     * in-progress pull so the next live packet cannot create a false shift.
     */
    resetTransient() {
      this.resetPull();
      this.previous = null;
      this.rpmRate = null;
    }
    update(telemetry) {
      let previous = this.previous;
      if (previous && !this.hasContinuousTimestamp(previous, telemetry)) {
        this.resetTransient();
        previous = null;
      }
      const wot = Number.isFinite(telemetry.throttle) && telemetry.throttle >= MIN_THROTTLE;
      const forward = isForwardGear2(telemetry.gear);
      const neutral = telemetry.gear === NEUTRAL_GEAR;
      if (forward) this.observedGears.add(telemetry.gear);
      this.optimalEstimator.ingest(telemetry);
      const detectedGearboxSignature = this.optimalEstimator.getGearboxSignature();
      if (detectedGearboxSignature) this.updateGearboxSignature(detectedGearboxSignature);
      this.activateStoredOptimalProfiles();
      this.updateOptimalProfiles();
      this.updateRpmRate(previous, telemetry, wot, forward);
      if (forward) {
        const transition = this.getUpshiftTransition(previous, telemetry);
        if (!wot) {
          this.resetPull();
          this.previous = telemetry;
          return this.snapshot(telemetry);
        }
        if (transition && transition.peakRpm >= telemetry.rpmMax * MIN_RPM_FRACTION) {
          if (!this.limiterCommitted) this.recordSample(transition.sourceGear, transition.peakRpm);
          this.limiterCandidate = null;
        }
        this.pendingUpshift = null;
        if (this.pullGear !== telemetry.gear) {
          this.pullGear = telemetry.gear;
          this.pullPeakRpm = 0;
          this.limiterCommitted = false;
          this.limiterCandidate = null;
        }
        if (telemetry.rpm < this.pullPeakRpm * REARM_FRACTION) {
          this.pullPeakRpm = 0;
          this.limiterCommitted = false;
          this.limiterCandidate = null;
        }
        const rpmDrop = Math.max(MIN_RPM_DROP, telemetry.rpmMax * RPM_DROP_FRACTION);
        if (!this.hasCompatibleProfile(telemetry.gear) && !this.limiterCommitted && this.pullPeakRpm >= telemetry.rpmMax * MIN_RPM_FRACTION && this.pullPeakRpm - telemetry.rpm >= rpmDrop) {
          if (this.limiterCandidate?.gear === telemetry.gear) {
            this.recordSample(telemetry.gear, this.limiterCandidate.peakRpm);
            this.limiterCandidate = null;
            this.limiterCommitted = true;
          } else {
            this.limiterCandidate = {
              gear: telemetry.gear,
              peakRpm: this.pullPeakRpm
            };
          }
        }
        this.pullPeakRpm = Math.max(this.pullPeakRpm, telemetry.rpm);
      } else if (neutral && this.pullGear !== null && this.pullPeakRpm >= telemetry.rpmMax * MIN_RPM_FRACTION) {
        const firstNeutralTimestampMs = this.pendingUpshift?.sourceGear === this.pullGear ? this.pendingUpshift.firstNeutralTimestampMs : telemetry.timestampMs;
        const neutralFrames = this.pendingUpshift?.sourceGear === this.pullGear ? this.pendingUpshift.neutralFrames + 1 : 1;
        const neutralDurationMs = telemetry.timestampMs - firstNeutralTimestampMs;
        if (Number.isFinite(neutralDurationMs) && neutralDurationMs <= MAX_NEUTRAL_MS && neutralFrames <= MAX_NEUTRAL_FRAMES) {
          this.pendingUpshift = {
            sourceGear: this.pullGear,
            peakRpm: this.pullPeakRpm,
            neutralFrames,
            firstNeutralTimestampMs
          };
        } else {
          this.resetPull();
        }
      } else if (!neutral) {
        this.resetPull();
      }
      this.previous = telemetry;
      return this.snapshot(telemetry);
    }
    snapshot(telemetry = this.previous) {
      const identity = this.parseIdentity();
      const currentGear = telemetry && isForwardGear2(telemetry.gear) ? telemetry.gear : null;
      const activeStoredProfile = currentGear === null ? this.profiles.get(0) : this.profiles.get(currentGear) ?? this.profiles.get(0);
      const activeProfile = activeStoredProfile && this.isGearboxCompatible(activeStoredProfile.gearboxSignature) ? activeStoredProfile : null;
      const currentSamples = currentGear === null || !this.isGearboxCompatible(this.storedGearboxSignatures.get(currentGear)) ? [] : this.samples.get(currentGear) ?? [];
      const status = activeProfile ? "calibrated" : "learning";
      const shiftRpm = activeProfile?.shiftRpm ?? null;
      let phase = fallbackPhase(telemetry?.rpm ?? 0, telemetry?.rpmMax ?? 0);
      if (shiftRpm !== null && telemetry) {
        const approachWindow = Math.max(250, shiftRpm * 0.04);
        const rpmRate = this.rpmRate;
        const predictiveRate = activeProfile?.method !== null && activeProfile?.method !== void 0 && rpmRate !== null && rpmRate > 0 ? rpmRate : null;
        const shiftLead = predictiveRate !== null ? Math.min(MAX_SHIFT_SIGNAL_LEAD_RPM, predictiveRate * SHIFT_SIGNAL_LEAD_MS / 1e3) : 0;
        const approachLead = predictiveRate !== null ? Math.max(approachWindow, Math.min(MAX_APPROACH_SIGNAL_LEAD_RPM, predictiveRate * APPROACH_SIGNAL_LEAD_MS / 1e3)) : approachWindow;
        if (telemetry.rpm >= shiftRpm - shiftLead) phase = "shift";
        else if (telemetry.rpm >= shiftRpm - approachLead) phase = "approach";
        else phase = "normal";
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
        gearboxSignature: this.gearboxSignature,
        currentGear,
        method: activeProfile?.method ?? null,
        gears: this.getGearStates(),
        diagnostics: this.getGearDiagnostics()
      };
    }
    getUpshiftTransition(previous, telemetry) {
      if (this.pendingUpshift && telemetry.gear > this.pendingUpshift.sourceGear && telemetry.timestampMs - this.pendingUpshift.firstNeutralTimestampMs <= MAX_NEUTRAL_MS) {
        return this.pendingUpshift;
      }
      if (previous && isForwardGear2(previous.gear) && telemetry.gear > previous.gear && this.pullGear === previous.gear) {
        return { sourceGear: previous.gear, peakRpm: this.pullPeakRpm };
      }
      return null;
    }
    getGearStates() {
      const gears = /* @__PURE__ */ new Set([
        ...this.observedGears,
        ...this.samples.keys(),
        ...[...this.profiles.keys()].filter((gear) => gear > 0),
        ...this.storedGearboxSignatures.keys()
      ]);
      return [...gears].sort((left, right) => left - right).map((gear) => {
        const profile = this.profiles.get(gear);
        const profileCompatible = !profile || this.isGearboxCompatible(profile.gearboxSignature);
        const samplesCompatible = this.isGearboxCompatible(this.storedGearboxSignatures.get(gear));
        const samples = samplesCompatible ? this.samples.get(gear) ?? [] : [];
        return {
          gear,
          status: profileCompatible && profile ? "calibrated" : "learning",
          shiftRpm: profileCompatible ? profile?.shiftRpm ?? null : null,
          sampleCount: profileCompatible && profile ? profile.sampleCount : samples.length,
          method: profileCompatible ? profile?.method ?? null : null,
          ratioDrop: profileCompatible ? profile?.ratioDrop ?? null : null
        };
      });
    }
    getGearDiagnostics() {
      const gears = /* @__PURE__ */ new Set([
        ...this.observedGears,
        ...this.samples.keys(),
        ...this.profiles.keys(),
        ...this.pendingOptimalProfiles.keys(),
        ...this.storedGearboxSignatures.keys()
      ]);
      return [...gears].filter((gear) => gear > 0).sort((left, right) => left - right).map((gear) => {
        const storedProfile = this.profiles.get(gear);
        const storedSignature = storedProfile ? storedProfile.gearboxSignature : this.storedGearboxSignatures.get(gear);
        const compatible = this.isGearboxCompatible(storedSignature);
        const profile = compatible ? storedProfile : void 0;
        const diagnostics = this.optimalEstimator.diagnose(gear);
        const storedRatioMismatch = profile?.method === "optimal" && typeof profile.ratioDrop === "number" && diagnostics.ratioDrop !== null && Math.abs(diagnostics.ratioDrop - profile.ratioDrop) / profile.ratioDrop > 0.025;
        let status;
        if (!compatible || storedRatioMismatch || this.mismatchedOptimalGears.has(gear)) status = "gearbox-mismatch";
        else if (profile?.method === "optimal") status = "optimal";
        else if (diagnostics.powerBinCount === 0 || diagnostics.powerCurveCoverage < 0.9) status = "waiting-for-wot";
        else if (diagnostics.currentRatioSamples < 20 || diagnostics.nextRatioSamples < 20 || diagnostics.ratioDrop === null) status = "waiting-for-ratio";
        else if (diagnostics.targetRpm !== null) status = "confirming";
        else if (profile?.method === "observed") status = "observed";
        else status = "learning";
        return {
          ...diagnostics,
          status,
          method: profile?.method ?? null
        };
      });
    }
    activateStoredOptimalProfiles() {
      for (const [gear, profile] of this.pendingOptimalProfiles) {
        if (!this.isGearboxCompatible(profile.gearboxSignature)) {
          this.pendingOptimalProfiles.delete(gear);
          this.mismatchedOptimalGears.add(gear);
          continue;
        }
        const ratio = this.optimalEstimator.getRatioDrop(gear);
        if (!ratio || profile.ratioDrop === null || profile.ratioDrop === void 0) continue;
        this.pendingOptimalProfiles.delete(gear);
        const relativeDifference = Math.abs(ratio.ratioDrop - profile.ratioDrop) / profile.ratioDrop;
        if (relativeDifference <= 0.025) this.profiles.set(gear, profile);
        else this.mismatchedOptimalGears.add(gear);
      }
    }
    updateOptimalProfiles() {
      for (const gear of this.observedGears) {
        const estimate = this.optimalEstimator.estimate(gear);
        if (!estimate) continue;
        const candidates = this.optimalCandidates.get(gear) ?? [];
        candidates.push(estimate);
        if (candidates.length > OPTIMAL_CONFIRM_SAMPLES) candidates.shift();
        this.optimalCandidates.set(gear, candidates);
        if (candidates.length < OPTIMAL_CONFIRM_SAMPLES) continue;
        const targetValues = candidates.map((candidate) => candidate.shiftRpm);
        if (Math.max(...targetValues) - Math.min(...targetValues) > OPTIMAL_STABILITY_RPM) continue;
        const target = roundRpm(targetValues.reduce((sum, value) => sum + value, 0) / targetValues.length);
        const latest = candidates.at(-1);
        const existing = this.profiles.get(gear);
        if (existing?.method === "optimal" && this.isGearboxCompatible(existing.gearboxSignature) && existing.shiftRpm !== null && Math.abs(existing.shiftRpm - target) < OPTIMAL_UPDATE_RPM) continue;
        const profile = {
          key: this.key,
          gear,
          shiftRpm: target,
          sampleCount: latest.evidence,
          status: "calibrated",
          samples: [],
          method: "optimal",
          ratioDrop: latest.ratioDrop,
          gearboxSignature: this.gearboxSignature
        };
        this.pendingOptimalProfiles.delete(gear);
        this.profiles.set(gear, profile);
        this.options.onCalibrated?.(profile);
      }
    }
    updateRpmRate(previous, telemetry, wot, forward) {
      if (!previous || !wot || !forward || previous.gear !== telemetry.gear) {
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
    resetPull() {
      this.pullGear = null;
      this.pullPeakRpm = 0;
      this.limiterCommitted = false;
      this.limiterCandidate = null;
      this.pendingUpshift = null;
    }
    recordSample(gear, observedRpm) {
      if (gear < 1 || gear > 10 || this.hasCompatibleProfile(gear) || !Number.isFinite(observedRpm)) return;
      const gearSamples = this.samples.get(gear) ?? [];
      if (gearSamples.length >= REQUIRED_SAMPLES) return;
      gearSamples.push(roundRpm(observedRpm));
      this.samples.set(gear, gearSamples);
      this.storedGearboxSignatures.set(gear, this.gearboxSignature);
      this.observedGears.add(gear);
      this.dirtyGears.add(gear);
      if (gearSamples.length < REQUIRED_SAMPLES) {
        this.options.onProgress?.({
          key: this.key,
          gear,
          shiftRpm: null,
          sampleCount: gearSamples.length,
          status: "learning",
          samples: [...gearSamples],
          method: "observed",
          ratioDrop: null,
          gearboxSignature: this.gearboxSignature
        });
        return;
      }
      const observedAverage = gearSamples.reduce((sum, rpm) => sum + rpm, 0) / gearSamples.length;
      const profile = {
        key: this.key,
        gear,
        shiftRpm: roundRpm(observedAverage - RPM_OFFSET),
        sampleCount: gearSamples.length,
        status: "calibrated",
        samples: [...gearSamples],
        method: "observed",
        ratioDrop: null,
        gearboxSignature: this.gearboxSignature
      };
      this.profiles.set(gear, profile);
      this.options.onProgress?.(profile);
      this.options.onCalibrated?.(profile);
    }
    normalizeSamples(samples) {
      if (!Array.isArray(samples)) return [];
      return samples.filter((sample) => Number.isFinite(sample)).slice(0, MAX_EVIDENCE_SAMPLES).map((sample) => roundRpm(sample));
    }
    updateGearboxSignature(signature) {
      const nextSignature = mergeGearboxSignatures(this.gearboxSignature, signature);
      if (nextSignature === this.gearboxSignature) return;
      const previousSignature = this.gearboxSignature;
      const canMigrateEvidence = previousSignature !== null && isSignatureExtension(previousSignature, nextSignature);
      this.gearboxSignature = nextSignature;
      const migratedGears = /* @__PURE__ */ new Set();
      if (canMigrateEvidence) {
        for (const [gear, profile] of this.profiles) {
          if (profile.gearboxSignature !== previousSignature) continue;
          const migrated = { ...profile, gearboxSignature: nextSignature };
          this.profiles.set(gear, migrated);
          migratedGears.add(gear);
          this.options.onProgress?.(migrated);
        }
        for (const [gear, profile] of this.pendingOptimalProfiles) {
          if (profile.gearboxSignature !== previousSignature) continue;
          const migrated = { ...profile, gearboxSignature: nextSignature };
          this.pendingOptimalProfiles.set(gear, migrated);
          migratedGears.add(gear);
          this.options.onProgress?.(migrated);
        }
      }
      for (const [gear, storedSignature] of this.storedGearboxSignatures) {
        if (canMigrateEvidence && storedSignature === previousSignature) {
          this.storedGearboxSignatures.set(gear, nextSignature);
          const samples = this.samples.get(gear);
          if (samples && samples.length > 0 && !migratedGears.has(gear)) {
            this.options.onProgress?.({
              key: this.key,
              gear,
              shiftRpm: null,
              sampleCount: samples.length,
              status: "learning",
              samples: [...samples],
              method: "observed",
              ratioDrop: null,
              gearboxSignature: nextSignature
            });
          }
          continue;
        }
        this.samples.delete(gear);
        this.storedGearboxSignatures.delete(gear);
        this.dirtyGears.delete(gear);
      }
    }
    isGearboxCompatible(signature) {
      if (!this.gearboxSignature) return true;
      const normalized = normalizeGearboxSignature(signature);
      return normalized !== null && signaturesAreCompatible(this.gearboxSignature, normalized);
    }
    hasCompatibleProfile(gear) {
      const profile = this.profiles.get(gear);
      return profile !== void 0 && this.isGearboxCompatible(profile.gearboxSignature);
    }
    hasContinuousTimestamp(previous, telemetry) {
      const previousTimestampMs = previous.timestampMs;
      const timestampMs = telemetry.timestampMs;
      if (!Number.isFinite(previousTimestampMs) || !Number.isFinite(timestampMs)) return false;
      const deltaMs = timestampMs - previousTimestampMs;
      return deltaMs >= 0 && deltaMs <= MAX_TIMESTAMP_GAP_MS;
    }
    parseIdentity() {
      const parts = this.key.split(":");
      if (parts.length !== 4 || parts[0] !== "fh6") return null;
      const values = parts.slice(1).map((value) => Number(value));
      const [carOrdinal, pi, rpmMax] = values;
      if (carOrdinal === void 0 || !Number.isFinite(carOrdinal) || carOrdinal <= 0 || pi === void 0 || !Number.isFinite(pi) || pi <= 0 || rpmMax === void 0 || !Number.isFinite(rpmMax) || rpmMax <= 0) return null;
      return {
        gameId: "fh6",
        carOrdinal,
        pi,
        rpmMax
      };
    }
  };
  return __toCommonJS(shift_light_exports);
})();
if (typeof globalThis !== "undefined") globalThis.HudShiftLight = HudShiftLight; if (typeof module !== "undefined") module.exports = HudShiftLight;

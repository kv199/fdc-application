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
    ShiftLightLearner: () => ShiftLightLearner,
    getShiftLightCarKey: () => getShiftLightCarKey,
    getShiftLightIdentity: () => getShiftLightIdentity
  });

  // src/shift-light/optimal-shift.ts
  var FORWARD_GEAR_MIN = 1;
  var FORWARD_GEAR_MAX = 10;
  var WOT_THRESHOLD = 0.95;
  var POWER_BIN_RPM = 200;
  var MIN_POWER_SAMPLES = 2;
  var MAX_POWER_SAMPLES_PER_BIN = 24;
  var MAX_RATIO_SAMPLES = 240;
  var MIN_RATIO_SAMPLES = 20;
  var MAX_DIRECT_RATIO_SAMPLES = 24;
  var MIN_DIRECT_RATIO_SAMPLES = 3;
  var MIN_GEARBOX_SIGNATURE_DROPS = 2;
  var MAX_GEARBOX_SIGNATURE_DROPS = FORWARD_GEAR_MAX - FORWARD_GEAR_MIN;
  var GEARBOX_SIGNATURE_SCALE = 1e3;
  var GEARBOX_SIGNATURE_FORMAT_DECIMALS = 4;
  var MIN_DRIVEN_WHEEL_RAD_S = 5;
  var MIN_ENGINE_RPM = 1200;
  var MAX_CLUTCH = 0.05;
  var MAX_BRAKE = 0.02;
  var MAX_HANDBRAKE = 0.02;
  var MAX_DRIVEN_COMBINED_SLIP = 0.2;
  var MIN_RATIO_DROP = 0.45;
  var MAX_RATIO_DROP = 0.95;
  var MIN_TARGET_RPM_FRACTION = 0.65;
  var MAX_TARGET_RPM_FRACTION = 0.99;
  var CURVE_COVERAGE_FRACTION = 0.9;
  var LIMITER_TARGET_FRACTION = 0.98;
  var LIMITER_SAFETY_RPM = 100;
  var MAX_INTERPOLATION_GAP_RPM = POWER_BIN_RPM * 2;
  var TARGET_STEP_RPM = 25;
  var CROSSOVER_CONFIRM_STEPS = 3;
  var RATIO_OUTLIER_FRACTION = 0.08;
  var RATIO_REACQUIRE_SAMPLES = 3;
  var LIMITER_STABILITY_RPM = 120;
  var LIMITER_REACQUIRE_SAMPLES = 2;
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
  function drivenWheelValues(telemetry, values) {
    return telemetry.car.drivetrain === 0 ? [values.fl, values.fr] : telemetry.car.drivetrain === 1 ? [values.rl, values.rr] : [values.fl, values.fr, values.rl, values.rr];
  }
  function hasCleanDriveEvidence(telemetry) {
    if (Number.isFinite(telemetry.brake) && telemetry.brake > MAX_BRAKE) return false;
    if (Number.isFinite(telemetry.handBrake) && telemetry.handBrake > MAX_HANDBRAKE) return false;
    const slip = telemetry.combinedSlip;
    if (!slip) return true;
    const drivenSlip = drivenWheelValues(telemetry, slip);
    return drivenSlip.every((value) => !Number.isFinite(value) || Math.abs(value) <= MAX_DRIVEN_COMBINED_SLIP);
  }
  function isCleanShiftEvidence(telemetry) {
    return telemetry.isRaceOn !== false && Number.isFinite(telemetry.throttle) && telemetry.throttle >= WOT_THRESHOLD && Number.isFinite(telemetry.clutch) && telemetry.clutch <= MAX_CLUTCH && Number.isFinite(telemetry.rpm) && telemetry.rpm > 0 && hasCleanDriveEvidence(telemetry);
  }
  function representativePower(bin) {
    return median(bin.powers);
  }
  var OptimalShiftEstimator = class {
    powerBins = /* @__PURE__ */ new Map();
    ratioSamples = /* @__PURE__ */ new Map();
    directRatioDrops = /* @__PURE__ */ new Map();
    limiterSamples = [];
    ratioAlternates = /* @__PURE__ */ new Map();
    limiterAlternate = null;
    lastLimiterEvidenceKey = null;
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
      this.directRatioDrops.clear();
      this.limiterSamples.length = 0;
      this.ratioAlternates.clear();
      this.limiterAlternate = null;
      this.lastLimiterEvidenceKey = null;
      this.rpmMax = 0;
    }
    /**
     * A ratio measured across a completed upshift does not depend on tyre size,
     * driven-wheel selection, or wheelspin during the pull. It is preferred once
     * repeated clean shifts agree, while wheel-derived ratios remain a fallback.
     */
    observeUpshiftRatio(gear, ratioDrop) {
      if (!isForwardGear(gear) || !Number.isFinite(ratioDrop)) return;
      if (ratioDrop < MIN_RATIO_DROP || ratioDrop > MAX_RATIO_DROP) return;
      const samples = this.directRatioDrops.get(gear) ?? [];
      this.pushStableRatio(samples, ratioDrop, MAX_DIRECT_RATIO_SAMPLES, `direct:${gear}`);
      this.directRatioDrops.set(gear, samples);
    }
    observeLimiter(rpm, evidenceKey) {
      if (!Number.isFinite(rpm) || rpm <= 0) return;
      if (evidenceKey !== void 0) {
        if (!Number.isInteger(evidenceKey) || evidenceKey === this.lastLimiterEvidenceKey) return;
        this.lastLimiterEvidenceKey = evidenceKey;
      }
      const baseline = this.limiterSamples.length >= 2 ? median(this.limiterSamples) : null;
      if (baseline !== null && Math.abs(rpm - baseline) > LIMITER_STABILITY_RPM) {
        if (this.limiterAlternate !== null && Math.abs(rpm - this.limiterAlternate.value) <= LIMITER_STABILITY_RPM) {
          this.limiterAlternate = {
            value: (this.limiterAlternate.value * this.limiterAlternate.count + rpm) / (this.limiterAlternate.count + 1),
            count: this.limiterAlternate.count + 1
          };
        } else {
          this.limiterAlternate = { value: rpm, count: 1 };
        }
        if (this.limiterAlternate.count >= LIMITER_REACQUIRE_SAMPLES) {
          this.limiterSamples.length = 0;
          this.limiterSamples.push(this.limiterAlternate.value);
          this.limiterAlternate = null;
        }
        return;
      }
      this.limiterAlternate = null;
      this.limiterSamples.push(rpm);
      if (this.limiterSamples.length > 5) this.limiterSamples.shift();
    }
    /** The measured limiter, once two clean independent pulls agree. */
    getEffectiveRpmMax() {
      if (this.limiterSamples.length < 2) return null;
      if (Math.max(...this.limiterSamples) - Math.min(...this.limiterSamples) > LIMITER_STABILITY_RPM) return null;
      return median(this.limiterSamples);
    }
    resetTransient() {
      this.ratioAlternates.clear();
      this.limiterAlternate = null;
    }
    getShiftCeiling() {
      return this.getLimiterCap();
    }
    getRatioDrop(gear) {
      const directSamples = this.directRatioDrops.get(gear) ?? [];
      if (directSamples.length >= MIN_DIRECT_RATIO_SAMPLES && this.ratiosAreConsistent(directSamples)) {
        const directRatioDrop = median(directSamples);
        if (directRatioDrop !== null && directRatioDrop >= MIN_RATIO_DROP && directRatioDrop <= MAX_RATIO_DROP) {
          return { ratioDrop: directRatioDrop, evidence: directSamples.length };
        }
      }
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
      const effectiveRpmMax = this.getEffectiveRpmMax() ?? this.rpmMax;
      const highestReliableRpm = reliableBins.at(-1)?.[0] ?? 0;
      const peakPower = reliableBins.reduce((best, candidate) => {
        const candidatePower = representativePower(candidate[1]);
        const bestPower = best ? representativePower(best[1]) : null;
        return candidatePower !== null && (bestPower === null || candidatePower > bestPower) ? candidate : best;
      }, null);
      const estimate = this.estimate(gear);
      const targetRpm = estimate?.shiftRpm ?? null;
      const postShiftRpm = targetRpm !== null && ratioDrop !== null ? targetRpm * ratioDrop : null;
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
      };
    }
    estimate(gear) {
      const effectiveRpmMax = this.getEffectiveRpmMax() ?? this.rpmMax;
      if (!isForwardGear(gear) || gear >= FORWARD_GEAR_MAX || effectiveRpmMax <= 0) return null;
      const ratio = this.getRatioDrop(gear);
      if (!ratio) return null;
      const reliableBins = this.getReliablePowerBins();
      if (reliableBins.length < 8) return null;
      const highestReliableRpm = reliableBins.at(-1)[0];
      if (highestReliableRpm < effectiveRpmMax * CURVE_COVERAGE_FRACTION) return null;
      const firstCandidate = Math.round(effectiveRpmMax * MIN_TARGET_RPM_FRACTION / TARGET_STEP_RPM) * TARGET_STEP_RPM;
      const limiterCap = this.getLimiterCap();
      const lastCandidate = Math.min(
        highestReliableRpm,
        Math.floor(Math.min(effectiveRpmMax * MAX_TARGET_RPM_FRACTION, limiterCap) / TARGET_STEP_RPM) * TARGET_STEP_RPM
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
      const limiterTarget = Math.round(limiterCap / TARGET_STEP_RPM) * TARGET_STEP_RPM;
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
      if (!isCleanShiftEvidence(telemetry)) return;
      if (!isForwardGear(telemetry.gear)) return;
      if (!Number.isFinite(telemetry.throttle) || telemetry.throttle < WOT_THRESHOLD) return;
      if (!Number.isFinite(telemetry.rpm) || telemetry.rpm < MIN_ENGINE_RPM) return;
      if (!Number.isFinite(telemetry.clutch) || telemetry.clutch > MAX_CLUTCH) return;
      if (!hasCleanDriveEvidence(telemetry)) return;
      const wheelSpeed = drivenWheelSpeed(telemetry);
      if (wheelSpeed === null) return;
      const ratio = telemetry.rpm / wheelSpeed;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      const samples = this.ratioSamples.get(telemetry.gear) ?? [];
      this.pushStableRatio(samples, ratio, MAX_RATIO_SAMPLES, `wheel:${telemetry.gear}`);
      this.ratioSamples.set(telemetry.gear, samples);
    }
    ingestPower(telemetry) {
      if (!isCleanShiftEvidence(telemetry)) return;
      if (!isForwardGear(telemetry.gear)) return;
      if (!Number.isFinite(telemetry.throttle) || telemetry.throttle < WOT_THRESHOLD) return;
      if (!Number.isFinite(telemetry.clutch) || telemetry.clutch > MAX_CLUTCH) return;
      if (!Number.isFinite(telemetry.rpm) || telemetry.rpm <= 0) return;
      if (!Number.isFinite(telemetry.rpmMax) || telemetry.rpmMax <= 0 || telemetry.rpm > telemetry.rpmMax * 1.05) return;
      if (!Number.isFinite(telemetry.power) || telemetry.power <= 0) return;
      if (!hasCleanDriveEvidence(telemetry)) return;
      const rpmBin = Math.round(telemetry.rpm / POWER_BIN_RPM) * POWER_BIN_RPM;
      const existing = this.powerBins.get(rpmBin);
      if (existing) {
        existing.powers.push(telemetry.power);
        if (existing.powers.length > MAX_POWER_SAMPLES_PER_BIN) existing.powers.shift();
      } else {
        this.powerBins.set(rpmBin, { powers: [telemetry.power] });
      }
    }
    getReliablePowerBins() {
      return [...this.powerBins.entries()].filter(([, bin]) => bin.powers.length >= MIN_POWER_SAMPLES && (representativePower(bin) ?? 0) > 0).sort(([left], [right]) => left - right);
    }
    getLimiterCap() {
      const effectiveRpmMax = this.getEffectiveRpmMax();
      const fallback = this.rpmMax * LIMITER_TARGET_FRACTION;
      if (effectiveRpmMax === null) return fallback;
      return Math.max(0, Math.min(fallback, effectiveRpmMax - LIMITER_SAFETY_RPM));
    }
    pushStableRatio(samples, ratio, maximum, key = "ratio") {
      const baseline = samples.length >= 5 ? median(samples) : null;
      if (baseline !== null && Math.abs(ratio - baseline) / baseline > RATIO_OUTLIER_FRACTION) {
        const alternate = this.ratioAlternates.get(key);
        if (alternate && Math.abs(ratio - alternate.value) / alternate.value <= RATIO_OUTLIER_FRACTION) {
          alternate.value = (alternate.value * alternate.count + ratio) / (alternate.count + 1);
          alternate.count += 1;
        } else {
          this.ratioAlternates.set(key, { value: ratio, count: 1 });
        }
        const next = this.ratioAlternates.get(key);
        const required = key.startsWith("wheel:") ? MIN_RATIO_SAMPLES : RATIO_REACQUIRE_SAMPLES;
        if (next && next.count >= required) {
          samples.length = 0;
          samples.push(next.value);
          this.ratioAlternates.delete(key);
        }
        return;
      }
      this.ratioAlternates.delete(key);
      samples.push(ratio);
      if (samples.length > maximum) samples.shift();
    }
    ratiosAreConsistent(samples) {
      const baseline = median(samples);
      return baseline !== null && samples.every((sample) => Math.abs(sample - baseline) / baseline <= RATIO_OUTLIER_FRACTION);
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
      const lowerPower = representativePower(lower[1]);
      const upperPower = representativePower(upper[1]);
      if (lowerPower === null || upperPower === null) return null;
      if (lower[0] === upper[0]) return lowerPower;
      const fraction = (rpm - lower[0]) / (upper[0] - lower[0]);
      return lowerPower + (upperPower - lowerPower) * fraction;
    }
  };

  // src/shift-light/shift-light.ts
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
  var REQUIRED_TERMINAL_LIMITER_SAMPLES = 2;
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
  function signaturesShareKnownPart(left, right) {
    const rightGears = new Set(right.map((part) => part.gear));
    return left.some((part) => rightGears.has(part.gear));
  }
  function signaturesAreCompatible(left, right) {
    const leftParts = parseGearboxSignature(left);
    const rightParts = parseGearboxSignature(right);
    if (leftParts.length === 0 || rightParts.length === 0) return false;
    return signaturesShareKnownPart(leftParts, rightParts) && signaturesHaveCompatibleKnownParts(leftParts, rightParts) && signaturesHaveCompatibleKnownParts(rightParts, leftParts);
  }
  function mergeGearboxSignatures(previous, detected) {
    if (!previous) return detected;
    const previousParts = parseGearboxSignature(previous);
    const detectedParts = parseGearboxSignature(detected);
    if (previousParts.length === 0 || detectedParts.length === 0) return detected;
    if (!signaturesAreCompatible(previous, detected)) return detected;
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
    const carClass = telemetry.car?.class;
    const pi = telemetry.car?.pi;
    const drivetrain = telemetry.car?.drivetrain;
    const cylinders = telemetry.car?.cylinders;
    const rpmMax = telemetry.rpmMax;
    if (!Number.isFinite(ordinal) || ordinal <= 0) return null;
    if (!Number.isFinite(carClass) || carClass < 0) return null;
    if (!Number.isFinite(pi) || pi <= 0) return null;
    if (!Number.isFinite(drivetrain) || drivetrain < 0) return null;
    if (!Number.isFinite(cylinders) || cylinders <= 0) return null;
    if (!Number.isFinite(rpmMax) || rpmMax <= 0) return null;
    return [
      "fh6",
      Math.round(ordinal),
      Math.round(carClass),
      Math.round(pi),
      Math.round(drivetrain),
      Math.round(cylinders),
      roundRpm(rpmMax)
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
      rpmMax: Number(parts[6]),
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
    samples = /* @__PURE__ */ new Map();
    observedGears = /* @__PURE__ */ new Set();
    optimalCandidates = /* @__PURE__ */ new Map();
    optimalEstimator = new OptimalShiftEstimator();
    storedGearboxSignatures = /* @__PURE__ */ new Map();
    terminalLimiterSamples = /* @__PURE__ */ new Map();
    previous = null;
    pullGear = null;
    pullPeakRpm = 0;
    pullStartRpm = 0;
    pullPowerSamples = 0;
    pullConfirmed = false;
    pullId = 0;
    limiterCommitted = false;
    limiterCandidate = null;
    pendingUpshift = null;
    rpmRate = null;
    gearboxSignature = null;
    maxObservedGear = 0;
    confirmedGearCount = null;
    gearboxChanged = false;
    dirtyGears = /* @__PURE__ */ new Set();
    restoredGears = /* @__PURE__ */ new Set();
    /** Compatibility helper for callers that only have one stored profile. */
    setProfile(profile) {
      if (profile) this.setProfiles([profile]);
    }
    setProfiles(profiles) {
      for (const profile of profiles) {
        if (profile.key !== this.key) continue;
        if (!Number.isInteger(profile.gear) || profile.gear < 0 || profile.gear > 10) continue;
        if (!Number.isFinite(profile.shiftRpm) && !Array.isArray(profile.samples)) continue;
        if (this.restoredGears.has(profile.gear)) continue;
        if (this.dirtyGears.has(profile.gear) && this.profiles.get(profile.gear)?.method === "optimal") continue;
        const freshSamples = this.dirtyGears.has(profile.gear) ? this.samples.get(profile.gear) ?? [] : [];
        const samples = [...this.normalizeSamples(profile.samples), ...freshSamples].slice(-MAX_EVIDENCE_SAMPLES);
        const method = profile.method === "optimal" ? "optimal" : "observed";
        const maxSampleCount = method === "optimal" ? 999 : MAX_EVIDENCE_SAMPLES;
        const storedSampleCount = Number.isFinite(profile.sampleCount) ? Math.max(0, Math.round(profile.sampleCount)) : 0;
        const sampleCount = Math.min(
          maxSampleCount,
          Math.max(storedSampleCount, samples.length)
        );
        const storedShiftRpm = typeof profile.shiftRpm === "number" && Number.isFinite(profile.shiftRpm) ? roundRpm(profile.shiftRpm) : null;
        const completedObservedShiftRpm = storedShiftRpm === null && method === "observed" ? observedShiftRpm(samples) : null;
        const effectiveShiftRpm = method === "observed" && freshSamples.length > 0 ? observedShiftRpm(samples) ?? storedShiftRpm : storedShiftRpm ?? completedObservedShiftRpm;
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
        this.restoredGears.add(normalized.gear);
        if (freshSamples.length > 0) this.options.onProgress?.(normalized);
        if (!calibrated) {
          if (samples.length > 0) this.samples.set(normalized.gear, samples);
          this.observedGears.add(normalized.gear);
          continue;
        }
        this.profiles.set(normalized.gear, normalized);
        if (samples.length > 0) this.samples.set(normalized.gear, samples);
        if (normalized.gear > 0) this.observedGears.add(normalized.gear);
      }
    }
    getProfiles() {
      return [...this.profiles.values()].sort((left, right) => left.gear - right.gear);
    }
    reset() {
      this.profiles.clear();
      this.samples.clear();
      this.observedGears.clear();
      this.optimalCandidates.clear();
      this.storedGearboxSignatures.clear();
      this.dirtyGears.clear();
      this.restoredGears.clear();
      this.optimalEstimator.reset();
      this.gearboxSignature = null;
      this.maxObservedGear = 0;
      this.confirmedGearCount = null;
      this.terminalLimiterSamples.clear();
      this.gearboxChanged = false;
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
      this.optimalCandidates.clear();
      this.optimalEstimator.resetTransient();
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
      const clean = isCleanShiftEvidence(telemetry);
      const forward = isForwardGear2(telemetry.gear);
      const neutral = telemetry.gear === NEUTRAL_GEAR;
      if (forward) {
        this.observedGears.add(telemetry.gear);
        this.observeGear(telemetry.gear);
      }
      this.optimalEstimator.ingest(telemetry);
      const detectedGearboxSignature = this.optimalEstimator.getGearboxSignature();
      if (detectedGearboxSignature) this.updateGearboxSignature(detectedGearboxSignature);
      this.updateRpmRate(previous, telemetry, wot, forward);
      if (forward) {
        const transition = this.getUpshiftTransition(previous, telemetry);
        if (!clean) {
          if (!wot && isCleanShiftEvidence({ ...telemetry, throttle: 1 })) this.confirmOptimalPull();
          this.resetPull();
          this.previous = telemetry;
          return this.snapshot(telemetry);
        }
        const evidenceCeiling = this.optimalEstimator.getEffectiveRpmMax() ?? telemetry.rpmMax;
        if (transition && transition.peakRpm >= evidenceCeiling * MIN_RPM_FRACTION) {
          if (!this.limiterCommitted) this.recordSample(transition.sourceGear, transition.peakRpm);
          if (telemetry.gear === transition.sourceGear + 1 && telemetry.rpm > 0 && Number.isFinite(telemetry.clutch) && telemetry.clutch <= 0.05) {
            this.optimalEstimator.observeUpshiftRatio(
              transition.sourceGear,
              telemetry.rpm / transition.peakRpm
            );
          }
          this.confirmOptimalPull();
          this.limiterCandidate = null;
        }
        this.pendingUpshift = null;
        if (this.pullGear !== telemetry.gear) {
          this.pullGear = telemetry.gear;
          this.pullPeakRpm = 0;
          this.pullStartRpm = telemetry.rpm;
          this.pullPowerSamples = 0;
          this.pullConfirmed = false;
          this.pullId += 1;
          this.limiterCommitted = false;
          this.limiterCandidate = null;
        }
        if (telemetry.rpm < this.pullPeakRpm * REARM_FRACTION) {
          this.confirmOptimalPull();
          this.pullPeakRpm = 0;
          this.pullStartRpm = telemetry.rpm;
          this.pullPowerSamples = 0;
          this.pullConfirmed = false;
          this.pullId += 1;
          this.limiterCommitted = false;
          this.limiterCandidate = null;
        }
        if (telemetry.power > 0 && (!previous || telemetry.timestampMs > previous.timestampMs)) {
          this.pullPowerSamples += 1;
        }
        const rpmDrop = Math.max(MIN_RPM_DROP, evidenceCeiling * RPM_DROP_FRACTION);
        if (this.limiterCandidate && telemetry.rpm > this.limiterCandidate.peakRpm + rpmDrop) {
          this.limiterCandidate = null;
        }
        const candidate = this.limiterCandidate;
        if (candidate && !this.limiterCommitted && telemetry.rpm >= candidate.troughRpm + rpmDrop && telemetry.rpm >= candidate.peakRpm * 0.98 && telemetry.rpm <= candidate.peakRpm + rpmDrop && this.pullPowerSamples >= 3 && this.pullPeakRpm - this.pullStartRpm >= 200) {
          this.optimalEstimator.observeLimiter(candidate.peakRpm, this.pullId);
          if (candidate.peakRpm >= evidenceCeiling * MIN_RPM_FRACTION) this.recordSample(telemetry.gear, candidate.peakRpm);
          this.recordTerminalLimiterEvidence(telemetry.gear);
          this.confirmOptimalPull();
          this.limiterCandidate = null;
          this.limiterCommitted = true;
        }
        if (!this.limiterCommitted && this.pullPeakRpm >= Math.max(1200, evidenceCeiling * 0.65) && this.pullPeakRpm - telemetry.rpm >= rpmDrop) {
          if (this.limiterCandidate?.gear === telemetry.gear) {
            this.limiterCandidate.troughRpm = Math.min(this.limiterCandidate.troughRpm, telemetry.rpm);
          } else {
            this.limiterCandidate = {
              gear: telemetry.gear,
              peakRpm: this.pullPeakRpm,
              troughRpm: telemetry.rpm
            };
          }
        }
        this.pullPeakRpm = Math.max(this.pullPeakRpm, telemetry.rpm);
      } else if (neutral && this.pullGear !== null && this.pullPeakRpm >= (this.optimalEstimator.getEffectiveRpmMax() ?? telemetry.rpmMax) * MIN_RPM_FRACTION) {
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
      const activeProfile = activeStoredProfile && this.isProfileUsable(activeStoredProfile) ? activeStoredProfile : currentGear === null ? null : this.getProvisionalProfile(currentGear);
      const currentSamples = currentGear === null ? [] : this.samples.get(currentGear) ?? [];
      const gearboxValidation = this.getGearboxValidation(currentGear, activeProfile);
      const status = activeProfile && activeProfile.status !== "learning" ? "calibrated" : "learning";
      const shiftRpm = activeProfile?.shiftRpm ?? null;
      let phase = fallbackPhase(telemetry?.rpm ?? 0, telemetry?.rpmMax ?? 0);
      const fallbackShiftRpm = this.optimalEstimator.getShiftCeiling() || (telemetry?.rpmMax ?? 0) * 0.98;
      if (this.optimalEstimator.getEffectiveRpmMax() !== null && telemetry) {
        phase = telemetry.rpm >= fallbackShiftRpm ? "shift" : telemetry.rpm >= this.optimalEstimator.getEffectiveRpmMax() * 0.85 ? "approach" : "normal";
      }
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
        fallbackShiftRpm: fallbackShiftRpm > 0 ? roundRpm(fallbackShiftRpm) : null,
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
        const stored = this.profiles.get(gear);
        const profile = stored && this.isProfileUsable(stored) ? stored : this.getProvisionalProfile(gear) ?? void 0;
        const profileUsable = this.isProfileUsable(profile);
        const samples = this.samples.get(gear) ?? [];
        return {
          gear,
          status: profileUsable && profile && profile.status !== "learning" ? "calibrated" : "learning",
          shiftRpm: profileUsable ? profile?.shiftRpm ?? null : null,
          sampleCount: profileUsable && profile ? profile.sampleCount : samples.length,
          method: profileUsable ? profile?.method ?? null : null,
          ratioDrop: profileUsable ? profile?.ratioDrop ?? null : null
        };
      });
    }
    getGearDiagnostics() {
      const gears = /* @__PURE__ */ new Set([
        ...this.observedGears,
        ...this.samples.keys(),
        ...this.profiles.keys(),
        ...this.storedGearboxSignatures.keys()
      ]);
      return [...gears].filter((gear) => gear > 0).sort((left, right) => left - right).map((gear) => {
        const storedProfile = this.profiles.get(gear);
        const profile = this.isProfileUsable(storedProfile) ? storedProfile : void 0;
        const diagnostics = this.optimalEstimator.diagnose(gear);
        let status;
        if (profile?.method === "optimal") status = "optimal";
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
        if (existing?.method === "optimal" && existing.shiftRpm !== null && Math.abs(existing.shiftRpm - target) < OPTIMAL_UPDATE_RPM) continue;
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
        this.profiles.set(gear, profile);
        this.dirtyGears.add(gear);
        this.options.onCalibrated?.(profile);
      }
    }
    confirmOptimalPull() {
      if (this.pullConfirmed || this.pullPowerSamples < 8 || this.pullPeakRpm - this.pullStartRpm < 1e3) return;
      this.pullConfirmed = true;
      this.updateOptimalProfiles();
    }
    getProvisionalProfile(gear) {
      const samples = this.samples.get(gear) ?? [];
      if (!samples.length || !this.isGearboxCompatible(this.storedGearboxSignatures.get(gear))) return null;
      return {
        key: this.key,
        gear,
        status: "learning",
        method: "observed",
        shiftRpm: roundRpm(samples.reduce((sum, value) => sum + value, 0) / samples.length - RPM_OFFSET),
        sampleCount: samples.length,
        samples: [...samples],
        ratioDrop: null,
        gearboxSignature: this.storedGearboxSignatures.get(gear) ?? null
      };
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
      this.pullStartRpm = 0;
      this.pullPowerSamples = 0;
      this.pullConfirmed = false;
      this.limiterCommitted = false;
      this.limiterCandidate = null;
      this.pendingUpshift = null;
    }
    observeGear(gear) {
      if (gear <= this.maxObservedGear) return;
      this.maxObservedGear = gear;
      if (this.confirmedGearCount !== null && gear > this.confirmedGearCount) {
        this.confirmedGearCount = null;
      }
    }
    recordTerminalLimiterEvidence(gear) {
      if (gear !== this.maxObservedGear) return;
      const count = (this.terminalLimiterSamples.get(gear) ?? 0) + 1;
      this.terminalLimiterSamples.set(gear, count);
      if (count >= REQUIRED_TERMINAL_LIMITER_SAMPLES) this.confirmedGearCount = gear;
    }
    recordSample(gear, observedRpm) {
      if (gear < 1 || gear > 10 || this.profiles.get(gear)?.method === "optimal" || !Number.isFinite(observedRpm)) return;
      const gearSamples = this.samples.get(gear) ?? [];
      gearSamples.push(roundRpm(observedRpm));
      if (gearSamples.length > REQUIRED_SAMPLES) gearSamples.shift();
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
      if (this.gearboxSignature !== null && !signaturesAreCompatible(this.gearboxSignature, signature)) {
        this.gearboxChanged = true;
        this.gearboxSignature = signature;
        return;
      }
      const nextSignature = mergeGearboxSignatures(this.gearboxSignature, signature);
      if (nextSignature === this.gearboxSignature) return;
      const previousSignature = this.gearboxSignature;
      const unsignedEvidenceGears = previousSignature === null ? this.bindUnsignedEvidence(nextSignature) : /* @__PURE__ */ new Set();
      const canMigrateEvidence = previousSignature !== null && isSignatureExtension(previousSignature, nextSignature);
      this.gearboxSignature = nextSignature;
      this.gearboxChanged = false;
      const migratedGears = /* @__PURE__ */ new Set();
      if (canMigrateEvidence) {
        for (const [gear, profile] of this.profiles) {
          if (profile.gearboxSignature !== previousSignature) continue;
          const migrated = { ...profile, gearboxSignature: nextSignature };
          this.profiles.set(gear, migrated);
          migratedGears.add(gear);
          this.options.onProgress?.(migrated);
        }
      }
      for (const [gear, storedSignature] of this.storedGearboxSignatures) {
        if (unsignedEvidenceGears.has(gear)) continue;
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
    clearCalibrationForGearboxChange() {
      this.profiles.clear();
      this.samples.clear();
      this.optimalCandidates.clear();
      this.storedGearboxSignatures.clear();
      this.dirtyGears.clear();
      this.gearboxChanged = true;
    }
    /**
     * Profiles may be learned before enough adjacent gears have been driven to
     * create a gearbox signature. The first signature is evidence for that same
     * live gearbox, not a tune change, so attach unsigned evidence instead of
     * invalidating it.
     */
    bindUnsignedEvidence(signature) {
      const boundGears = /* @__PURE__ */ new Set();
      for (const [gear, profile] of this.profiles) {
        if (profile.gearboxSignature !== null && profile.gearboxSignature !== void 0) continue;
        const bound = { ...profile, gearboxSignature: signature };
        this.profiles.set(gear, bound);
        boundGears.add(gear);
        this.options.onProgress?.(bound);
      }
      for (const [gear, storedSignature] of this.storedGearboxSignatures) {
        if (storedSignature === null || storedSignature === void 0) {
          this.storedGearboxSignatures.set(gear, signature);
          boundGears.add(gear);
        }
      }
      return boundGears;
    }
    clearConfiguration() {
      this.clearCalibrationForGearboxChange();
      this.gearboxChanged = false;
    }
    isGearboxCompatible(signature) {
      if (!this.gearboxSignature) return true;
      const normalized = normalizeGearboxSignature(signature);
      return normalized !== null && signaturesAreCompatible(this.gearboxSignature, normalized);
    }
    hasCompatibleProfile(gear) {
      return this.isProfileUsable(this.profiles.get(gear));
    }
    isProfileUsable(profile) {
      if (!profile) return false;
      return profile.method === "optimal" || this.isGearboxCompatible(profile.gearboxSignature);
    }
    getGearboxValidation(gear, profile) {
      if (profile?.method !== "optimal" || profile.ratioDrop === null || profile.ratioDrop === void 0) return null;
      if (this.gearboxChanged) return "checking";
      if (gear === null) return "validating";
      const liveRatio = this.optimalEstimator.getRatioDrop(gear);
      if (!liveRatio) return "validating";
      const relativeDifference = Math.abs(liveRatio.ratioDrop - profile.ratioDrop) / profile.ratioDrop;
      if (relativeDifference > 0.025) return "checking";
      return this.gearboxSignature ? "verified" : "validating";
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
      if (parts.length !== 7 || parts[0] !== "fh6") return null;
      const values = parts.slice(1).map((value) => Number(value));
      const [carOrdinal, carClass, pi, drivetrain, cylinders, rpmMax] = values;
      if (carOrdinal === void 0 || !Number.isFinite(carOrdinal) || carOrdinal <= 0 || carClass === void 0 || !Number.isFinite(carClass) || carClass < 0 || pi === void 0 || !Number.isFinite(pi) || pi <= 0 || drivetrain === void 0 || !Number.isFinite(drivetrain) || drivetrain < 0 || cylinders === void 0 || !Number.isFinite(cylinders) || cylinders <= 0 || rpmMax === void 0 || !Number.isFinite(rpmMax) || rpmMax <= 0) return null;
      return {
        gameId: "fh6",
        carOrdinal,
        carClass,
        pi,
        drivetrain,
        cylinders,
        rpmMax
      };
    }
  };
  return __toCommonJS(shift_light_exports);
})();
if (typeof globalThis !== "undefined") globalThis.HudShiftLight = HudShiftLight; if (typeof module !== "undefined") module.exports = HudShiftLight;

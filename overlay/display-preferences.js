(function (globalScope, factory) {
  const api = factory(globalScope)

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DisplayPreferences = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  const STORAGE_KEY = 'fdc.display-preferences.v1'
  const DEFAULTS = Object.freeze({
    speedUnit: 'kmh',
    redlineBrightness: 60,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: true
  })
  const MPH_PER_KMH = 0.621371

  function normalize(preferences) {
    const candidate = preferences && typeof preferences === 'object' ? preferences : {}
    // The v1 record used shiftLightBrightness for the FDC signal. Keep that
    // value as the migration fallback when the new split fields are absent.
    const brightnessCandidate = candidate.shiftLightBrightness
    const rawBrightness = brightnessCandidate === null || brightnessCandidate === undefined || brightnessCandidate === ''
      ? Number.NaN
      : Number(brightnessCandidate)
    const shiftLightBrightness = Number.isFinite(rawBrightness)
      ? Math.round(Math.max(0, Math.min(100, rawBrightness)))
      : DEFAULTS.shiftLightBrightness
    const redlineCandidate = candidate.redlineBrightness
    const rawRedlineBrightness = redlineCandidate === null || redlineCandidate === undefined || redlineCandidate === ''
      ? Number.NaN
      : Number(redlineCandidate)
    const redlineBrightness = Number.isFinite(rawRedlineBrightness)
      ? Math.round(Math.max(0, Math.min(100, rawRedlineBrightness)))
      : DEFAULTS.redlineBrightness
    const opacityCandidate = candidate.hudOpacity
    const rawOpacity = opacityCandidate === null || opacityCandidate === undefined || opacityCandidate === ''
      ? Number.NaN
      : Number(opacityCandidate)
    const hudOpacity = Number.isFinite(rawOpacity)
      ? Math.round(Math.max(1, Math.min(100, rawOpacity)))
      : DEFAULTS.hudOpacity

    return {
      speedUnit: candidate.speedUnit === 'mph' ? 'mph' : DEFAULTS.speedUnit,
      redlineBrightness,
      shiftLightBrightness,
      fdcShiftLightEnabled: candidate.fdcShiftLightEnabled !== false,
      showHudWithTelemetry: candidate.showHudWithTelemetry !== false,
      hudOpacity,
      configurationAlwaysOnTop: candidate.configurationAlwaysOnTop !== false
    }
  }

  function resolveStorage(storage) {
    if (storage) return storage
    try {
      return globalScope?.localStorage || null
    } catch {
      return null
    }
  }

  function read(storage) {
    try {
      const stored = resolveStorage(storage)?.getItem(STORAGE_KEY)
      return normalize(stored ? JSON.parse(stored) : null)
    } catch {
      return { ...DEFAULTS }
    }
  }

  function write(preferences, storage) {
    const normalized = normalize(preferences)
    try {
      resolveStorage(storage)?.setItem(STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
    return normalized
  }

  function update(patch, storage) {
    const candidate = patch && typeof patch === 'object' ? patch : {}
    return write({ ...read(storage), ...candidate }, storage)
  }

  function convertSpeedKmh(speedKmh, speedUnit = DEFAULTS.speedUnit) {
    if (speedKmh === null || speedKmh === undefined || speedKmh === '') return null
    const speed = Number(speedKmh)
    if (!Number.isFinite(speed)) return null
    return speedUnit === 'mph' ? speed * MPH_PER_KMH : speed
  }

  function speedUnitLabel(speedUnit = DEFAULTS.speedUnit) {
    return speedUnit === 'mph' ? 'mph' : 'km/h'
  }

  function formatSpeed(speedKmh, speedUnit = DEFAULTS.speedUnit) {
    const unit = speedUnit === 'mph' ? 'mph' : DEFAULTS.speedUnit
    const speed = convertSpeedKmh(speedKmh, unit)
    if (speed === null) return `-- ${speedUnitLabel(unit)}`
    return `${Math.max(0, Math.round(speed))} ${speedUnitLabel(unit)}`
  }

  function shiftLightBrightnessScale(brightness) {
    return normalize({ shiftLightBrightness: brightness }).shiftLightBrightness / DEFAULTS.shiftLightBrightness
  }

  function redlineBrightnessScale(brightness) {
    return normalize({ redlineBrightness: brightness }).redlineBrightness / DEFAULTS.redlineBrightness
  }

  function redlineBrightnessAlpha(brightness) {
    // Preserve the existing 24% red overlay at the 60% default while making
    // values above the default increase the visible layer's opacity.
    return Math.min(1, 0.24 * redlineBrightnessScale(brightness))
  }

  return {
    DEFAULTS,
    MPH_PER_KMH,
    STORAGE_KEY,
    convertSpeedKmh,
    formatSpeed,
    normalize,
    redlineBrightnessAlpha,
    redlineBrightnessScale,
    read,
    shiftLightBrightnessScale,
    speedUnitLabel,
    update,
    write
  }
}))

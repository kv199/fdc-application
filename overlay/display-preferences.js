(function (globalScope, factory) {
  const api = factory(globalScope)

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DisplayPreferences = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  const STORAGE_KEY = 'fdc.display-preferences.v1'
  const DEFAULTS = Object.freeze({
    speedUnit: 'kmh',
    distanceUnit: 'km',
    redlineBrightness: 80,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false,
    theme: 'dark'
  })
  const REDLINE_BRIGHTNESS_STOPS = Object.freeze([
    Object.freeze({ percent: 0, rgb: Object.freeze([18, 3, 2]) }),
    Object.freeze({ percent: 25, rgb: Object.freeze([77, 13, 12]) }),
    Object.freeze({ percent: 50, rgb: Object.freeze([143, 27, 24]) }),
    Object.freeze({ percent: 75, rgb: Object.freeze([207, 40, 36]) }),
    Object.freeze({ percent: 100, rgb: Object.freeze([255, 49, 43]) })
  ])

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

    const speedUnit = candidate.speedUnit === 'mph' ? 'mph' : DEFAULTS.speedUnit
    // Records saved before the distance unit existed follow the chosen speed unit.
    const distanceUnit = ['km', 'mi'].includes(candidate.distanceUnit)
      ? candidate.distanceUnit
      : speedUnit === 'mph' ? 'mi' : DEFAULTS.distanceUnit
    // Records saved before the theme setting existed keep the dark Configuration window.
    const theme = ['light', 'system'].includes(candidate.theme) ? candidate.theme : DEFAULTS.theme

    return {
      speedUnit,
      distanceUnit,
      redlineBrightness,
      shiftLightBrightness,
      fdcShiftLightEnabled: candidate.fdcShiftLightEnabled !== false,
      showHudWithTelemetry: candidate.showHudWithTelemetry !== false,
      hudOpacity,
      configurationAlwaysOnTop: candidate.configurationAlwaysOnTop === true,
      theme
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

  function shiftLightBrightnessScale(brightness) {
    return normalize({ shiftLightBrightness: brightness }).shiftLightBrightness / DEFAULTS.shiftLightBrightness
  }

  function redlineBrightnessColor(brightness) {
    const percent = normalize({ redlineBrightness: brightness }).redlineBrightness
    const upperIndex = REDLINE_BRIGHTNESS_STOPS.findIndex(stop => stop.percent >= percent)
    const upper = REDLINE_BRIGHTNESS_STOPS[upperIndex < 0 ? REDLINE_BRIGHTNESS_STOPS.length - 1 : upperIndex]
    const lower = REDLINE_BRIGHTNESS_STOPS[Math.max(0, upperIndex - 1)] || upper
    const range = upper.percent - lower.percent
    const progress = range > 0 ? (percent - lower.percent) / range : 0
    const rgb = lower.rgb.map((channel, index) => Math.round(
      channel + (upper.rgb[index] - channel) * progress
    ))
    return `rgb(${rgb.join(' ')} / 96%)`
  }

  return {
    DEFAULTS,
    STORAGE_KEY,
    normalize,
    REDLINE_BRIGHTNESS_STOPS,
    redlineBrightnessColor,
    read,
    shiftLightBrightnessScale,
    update,
    write
  }
}))

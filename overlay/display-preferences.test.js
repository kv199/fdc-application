const assert = require('node:assert/strict')
const test = require('node:test')

const DisplayPreferences = require('./display-preferences.js')

test('uses the fresh FDC display preference key', () => {
  assert.equal(DisplayPreferences.STORAGE_KEY, 'fdc.display-preferences.v1')
})

function createStorage(initialValue = null) {
  let value = initialValue
  return {
    getItem: key => key === DisplayPreferences.STORAGE_KEY ? value : null,
    setItem: (key, nextValue) => {
      if (key === DisplayPreferences.STORAGE_KEY) value = nextValue
    },
    value: () => value
  }
}

test('uses the split display defaults and enables the telemetry-driven displays by default', () => {
  assert.deepEqual(DisplayPreferences.read(createStorage()), {
    speedUnit: 'kmh',
    redlineBrightness: 80,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false
  })
})

test('migrates old records and sanitizes units, brightness, flags and HUD opacity', () => {
  assert.deepEqual(DisplayPreferences.normalize({ speedUnit: 'mph', shiftLightBrightness: 135 }), {
    speedUnit: 'mph',
    redlineBrightness: 80,
    shiftLightBrightness: 100,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false
  })
  assert.deepEqual(DisplayPreferences.normalize({ speedUnit: 'knots', shiftLightBrightness: -4 }), {
    speedUnit: 'kmh',
    redlineBrightness: 80,
    shiftLightBrightness: 0,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false
  })
  assert.deepEqual(DisplayPreferences.normalize({ redlineBrightness: '64.6', shiftLightBrightness: '44.4', fdcShiftLightEnabled: false, showHudWithTelemetry: false }), {
    speedUnit: 'kmh',
    redlineBrightness: 65,
    shiftLightBrightness: 44,
    fdcShiftLightEnabled: false,
    showHudWithTelemetry: false,
    hudOpacity: 80,
    configurationAlwaysOnTop: false
  })
  assert.deepEqual(DisplayPreferences.normalize({ speedUnit: 'mph', shiftLightBrightness: null }), {
    speedUnit: 'mph',
    redlineBrightness: 80,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false
  })
  assert.deepEqual(DisplayPreferences.normalize({ hudOpacity: 0 }), {
    speedUnit: 'kmh',
    redlineBrightness: 80,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 1,
    configurationAlwaysOnTop: false
  })
  assert.deepEqual(DisplayPreferences.normalize({ hudOpacity: 101.4 }), {
    speedUnit: 'kmh',
    redlineBrightness: 80,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 100,
    configurationAlwaysOnTop: false
  })
  assert.deepEqual(DisplayPreferences.normalize({ redlineBrightness: -1, shiftLightBrightness: 101 }), {
    speedUnit: 'kmh',
    redlineBrightness: 0,
    shiftLightBrightness: 100,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false
  })
})

test('keeps Configuration always on top only when it was explicitly enabled', () => {
  assert.equal(DisplayPreferences.DEFAULTS.configurationAlwaysOnTop, false)
  assert.equal(DisplayPreferences.normalize({ configurationAlwaysOnTop: true }).configurationAlwaysOnTop, true)
  assert.equal(DisplayPreferences.normalize({ configurationAlwaysOnTop: 'true' }).configurationAlwaysOnTop, false)
  assert.equal(DisplayPreferences.read(createStorage(JSON.stringify({ configurationAlwaysOnTop: true }))).configurationAlwaysOnTop, true)
})

test('falls back safely when persisted data is malformed', () => {
  assert.deepEqual(DisplayPreferences.read(createStorage('{not-json')), DisplayPreferences.DEFAULTS)
})

test('writes a versioned normalized preference record', () => {
  const storage = createStorage()
  const written = DisplayPreferences.write({ speedUnit: 'mph', shiftLightBrightness: 55, hudOpacity: 64, configurationAlwaysOnTop: false }, storage)

  assert.deepEqual(written, { speedUnit: 'mph', redlineBrightness: 80, shiftLightBrightness: 55, fdcShiftLightEnabled: true, showHudWithTelemetry: true, hudOpacity: 64, configurationAlwaysOnTop: false })
  assert.deepEqual(JSON.parse(storage.value()), written)
})

test('updates one preference without resetting the other', () => {
  const storage = createStorage(JSON.stringify({ speedUnit: 'mph', shiftLightBrightness: 75, hudOpacity: 42, configurationAlwaysOnTop: false }))

  assert.deepEqual(DisplayPreferences.update({ shiftLightBrightness: 90 }, storage), {
    speedUnit: 'mph',
    redlineBrightness: 80,
    shiftLightBrightness: 90,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 42,
    configurationAlwaysOnTop: false
  })
})

test('formats canonical km/h telemetry for either display unit', () => {
  assert.equal(DisplayPreferences.formatSpeed(128), '128 km/h')
  assert.equal(DisplayPreferences.formatSpeed(128, 'mph'), '80 mph')
  assert.equal(DisplayPreferences.formatSpeed(null, 'mph'), '-- mph')
  assert.equal(DisplayPreferences.formatSpeed(-3, 'kmh'), '0 km/h')
})

test('maps the existing 80 percent appearance to brightness scale 1', () => {
  assert.equal(DisplayPreferences.shiftLightBrightnessScale(0), 0)
  assert.equal(DisplayPreferences.shiftLightBrightnessScale(20), 0.25)
  assert.equal(DisplayPreferences.shiftLightBrightnessScale(80), 1)
  assert.equal(DisplayPreferences.shiftLightBrightnessScale(100), 1.25)
})

test('maps redline brightness through five opaque color stops', () => {
  assert.equal(DisplayPreferences.redlineBrightnessColor(0), 'rgb(18 3 2 / 96%)')
  assert.equal(DisplayPreferences.redlineBrightnessColor(25), 'rgb(77 13 12 / 96%)')
  assert.equal(DisplayPreferences.redlineBrightnessColor(50), 'rgb(143 27 24 / 96%)')
  assert.equal(DisplayPreferences.redlineBrightnessColor(75), 'rgb(207 40 36 / 96%)')
  assert.equal(DisplayPreferences.redlineBrightnessColor(80), 'rgb(217 42 37 / 96%)')
  assert.equal(DisplayPreferences.redlineBrightnessColor(100), 'rgb(255 49 43 / 96%)')
  assert.equal(DisplayPreferences.redlineBrightnessColor(60), 'rgb(169 32 29 / 96%)')
})

test('preserves saved redline brightness values when the default changes', () => {
  assert.equal(DisplayPreferences.read(createStorage(JSON.stringify({ redlineBrightness: 60 }))).redlineBrightness, 60)
})

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

test('uses km/h, 80 percent brightness and Configuration always-on-top by default', () => {
  assert.deepEqual(DisplayPreferences.read(createStorage()), {
    speedUnit: 'kmh',
    shiftLightBrightness: 80,
    configurationAlwaysOnTop: true
  })
})

test('sanitizes stored units and clamps brightness', () => {
  assert.deepEqual(DisplayPreferences.normalize({ speedUnit: 'mph', shiftLightBrightness: 135 }), {
    speedUnit: 'mph',
    shiftLightBrightness: 100,
    configurationAlwaysOnTop: true
  })
  assert.deepEqual(DisplayPreferences.normalize({ speedUnit: 'knots', shiftLightBrightness: -4 }), {
    speedUnit: 'kmh',
    shiftLightBrightness: 0,
    configurationAlwaysOnTop: true
  })
  assert.deepEqual(DisplayPreferences.normalize({ shiftLightBrightness: '64.6' }), {
    speedUnit: 'kmh',
    shiftLightBrightness: 65,
    configurationAlwaysOnTop: true
  })
  assert.deepEqual(DisplayPreferences.normalize({ speedUnit: 'mph', shiftLightBrightness: null }), {
    speedUnit: 'mph',
    shiftLightBrightness: 80,
    configurationAlwaysOnTop: true
  })
})

test('falls back safely when persisted data is malformed', () => {
  assert.deepEqual(DisplayPreferences.read(createStorage('{not-json')), DisplayPreferences.DEFAULTS)
})

test('writes a versioned normalized preference record', () => {
  const storage = createStorage()
  const written = DisplayPreferences.write({ speedUnit: 'mph', shiftLightBrightness: 55, configurationAlwaysOnTop: false }, storage)

  assert.deepEqual(written, { speedUnit: 'mph', shiftLightBrightness: 55, configurationAlwaysOnTop: false })
  assert.deepEqual(JSON.parse(storage.value()), written)
})

test('updates one preference without resetting the other', () => {
  const storage = createStorage(JSON.stringify({ speedUnit: 'mph', shiftLightBrightness: 75, configurationAlwaysOnTop: false }))

  assert.deepEqual(DisplayPreferences.update({ shiftLightBrightness: 90 }, storage), {
    speedUnit: 'mph',
    shiftLightBrightness: 90,
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

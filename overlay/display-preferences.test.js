const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const DisplayPreferences = require('./display-preferences.js')

// Loads display-preferences.js with the theme switch set to `enabled`, the same one-line
// change a maintainer makes to re-enable theme selection.
function loadWithThemeSelection(enabled) {
  const source = fs.readFileSync(path.join(__dirname, 'display-preferences.js'), 'utf8')
  const flag = 'const THEME_SELECTION_ENABLED = false'
  assert.ok(source.includes(flag), 'the theme switch is declared as false')
  const sandbox = { module: { exports: {} } }
  vm.runInNewContext(source.replace(flag, `const THEME_SELECTION_ENABLED = ${enabled}`), sandbox)
  return sandbox.module.exports
}

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
    distanceUnit: 'km',
    redlineBrightness: 80,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false,
    theme: 'dark'
  })
})

test('migrates old records and sanitizes units, brightness, flags and HUD opacity', () => {
  // speedUnit=mph defaults distanceUnit to mi
  assert.deepEqual(DisplayPreferences.normalize({ speedUnit: 'mph', shiftLightBrightness: 135 }), {
    speedUnit: 'mph',
    distanceUnit: 'mi',
    redlineBrightness: 80,
    shiftLightBrightness: 100,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false,
    theme: 'dark'
  })
  // invalid speedUnit defaults to kmh and distanceUnit to km
  assert.deepEqual(DisplayPreferences.normalize({ speedUnit: 'knots', shiftLightBrightness: -4 }), {
    speedUnit: 'kmh',
    distanceUnit: 'km',
    redlineBrightness: 80,
    shiftLightBrightness: 0,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false,
    theme: 'dark'
  })
  assert.deepEqual(DisplayPreferences.normalize({ redlineBrightness: '64.6', shiftLightBrightness: '44.4', fdcShiftLightEnabled: false, showHudWithTelemetry: false }), {
    speedUnit: 'kmh',
    distanceUnit: 'km',
    redlineBrightness: 65,
    shiftLightBrightness: 44,
    fdcShiftLightEnabled: false,
    showHudWithTelemetry: false,
    hudOpacity: 80,
    configurationAlwaysOnTop: false,
    theme: 'dark'
  })
  // speedUnit=mph and distanceUnit=null defaults to mi
  assert.deepEqual(DisplayPreferences.normalize({ speedUnit: 'mph', shiftLightBrightness: null }), {
    speedUnit: 'mph',
    distanceUnit: 'mi',
    redlineBrightness: 80,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false,
    theme: 'dark'
  })
  // explicit distanceUnit is preserved
  assert.deepEqual(DisplayPreferences.normalize({ speedUnit: 'mph', distanceUnit: 'km' }), {
    speedUnit: 'mph',
    distanceUnit: 'km',
    redlineBrightness: 80,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false,
    theme: 'dark'
  })
  assert.deepEqual(DisplayPreferences.normalize({ hudOpacity: 0 }), {
    speedUnit: 'kmh',
    distanceUnit: 'km',
    redlineBrightness: 80,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 1,
    configurationAlwaysOnTop: false,
    theme: 'dark'
  })
  assert.deepEqual(DisplayPreferences.normalize({ hudOpacity: 101.4 }), {
    speedUnit: 'kmh',
    distanceUnit: 'km',
    redlineBrightness: 80,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 100,
    configurationAlwaysOnTop: false,
    theme: 'dark'
  })
  assert.deepEqual(DisplayPreferences.normalize({ redlineBrightness: -1, shiftLightBrightness: 101 }), {
    speedUnit: 'kmh',
    distanceUnit: 'km',
    redlineBrightness: 0,
    shiftLightBrightness: 100,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 80,
    configurationAlwaysOnTop: false,
    theme: 'dark'
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

  assert.deepEqual(written, { speedUnit: 'mph', distanceUnit: 'mi', redlineBrightness: 80, shiftLightBrightness: 55, fdcShiftLightEnabled: true, showHudWithTelemetry: true, hudOpacity: 64, configurationAlwaysOnTop: false, theme: 'dark' })
  assert.deepEqual(JSON.parse(storage.value()), written)
})

test('defaults the Configuration theme to dark', () => {
  assert.equal(DisplayPreferences.DEFAULTS.theme, 'dark')
  assert.equal(DisplayPreferences.read(createStorage()).theme, 'dark')
})

test('keeps only the light and system Configuration themes and falls back to dark', () => {
  assert.equal(DisplayPreferences.normalize({ theme: 'light' }).theme, 'light')
  assert.equal(DisplayPreferences.normalize({ theme: 'system' }).theme, 'system')
  assert.equal(DisplayPreferences.normalize({ theme: 'dark' }).theme, 'dark')
  assert.equal(DisplayPreferences.normalize({ theme: 'LIGHT' }).theme, 'dark')
  assert.equal(DisplayPreferences.normalize({ theme: 'auto' }).theme, 'dark')
  assert.equal(DisplayPreferences.normalize({ theme: null }).theme, 'dark')
  assert.equal(DisplayPreferences.normalize({}).theme, 'dark')
})

test('migrates old stored records without a theme to dark and keeps the theme once saved', () => {
  const oldRecord = JSON.stringify({ speedUnit: 'mph', shiftLightBrightness: 75, hudOpacity: 42, configurationAlwaysOnTop: false })
  assert.equal(DisplayPreferences.read(createStorage(oldRecord)).theme, 'dark')

  const storage = createStorage(oldRecord)
  assert.equal(DisplayPreferences.update({ theme: 'light' }, storage).theme, 'light')
  assert.equal(DisplayPreferences.read(storage).theme, 'light')
  assert.equal(DisplayPreferences.read(storage).speedUnit, 'mph')
})

test('switches theme selection off, so every saved theme resolves to dark', () => {
  assert.equal(DisplayPreferences.THEME_SELECTION_ENABLED, false)
  for (const saved of ['light', 'system', 'dark', 'LIGHT', 'auto', null, undefined]) {
    assert.equal(DisplayPreferences.effectiveTheme(saved), 'dark', String(saved))
  }
})

test('keeps the saved theme while selection is switched off, so re-enabling restores it', () => {
  const storage = createStorage(JSON.stringify({ speedUnit: 'kmh', theme: 'light' }))
  assert.equal(DisplayPreferences.read(storage).theme, 'light')
  assert.equal(DisplayPreferences.update({ speedUnit: 'mph' }, storage).theme, 'light')
  assert.equal(JSON.parse(storage.value()).theme, 'light')
})

test('resolves light and system to themselves once theme selection is switched on', () => {
  const enabled = loadWithThemeSelection(true)
  assert.equal(enabled.THEME_SELECTION_ENABLED, true)
  assert.equal(enabled.effectiveTheme('light'), 'light')
  assert.equal(enabled.effectiveTheme('system'), 'system')
  assert.equal(enabled.effectiveTheme('dark'), 'dark')
  assert.equal(enabled.effectiveTheme('LIGHT'), 'dark')
  assert.equal(enabled.effectiveTheme(null), 'dark')
})

test('updates one preference without resetting the other', () => {
  const storage = createStorage(JSON.stringify({ speedUnit: 'mph', shiftLightBrightness: 75, hudOpacity: 42, configurationAlwaysOnTop: false }))

  assert.deepEqual(DisplayPreferences.update({ shiftLightBrightness: 90 }, storage), {
    speedUnit: 'mph',
    distanceUnit: 'mi',
    redlineBrightness: 80,
    shiftLightBrightness: 90,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: 42,
    configurationAlwaysOnTop: false,
    theme: 'dark'
  })
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

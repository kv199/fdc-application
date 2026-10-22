const test = require('node:test')
const assert = require('node:assert/strict')

const { COMPONENTS } = require('./hud-widgets.js')
const { resolveHudVisibility } = require('./hud-preferences.js')

const EDIT_CASES = [
  ['grouped', 'delta'],
  ['freeform', 'delta'],
  ['grouped', 'hud'],
  ['grouped', 'shiftBar'],
  ['freeform', 'shiftBar'],
  ...COMPONENTS.map(name => ['freeform', name])
]
const ALL_HIDDEN = Object.fromEntries(COMPONENTS.map(name => [name, false]))
const HIDING_CONDITIONS = {
  'no live telemetry': () => ({ telemetryVisible: false }),
  'overlay switches off': () => ({ overlayState: { delta: false, hud: false } }),
  'own block hidden': target => (COMPONENTS.includes(target) ? { state: { [target]: false } } : {}),
  'every block hidden': () => ({ state: ALL_HIDDEN })
}

function visibilityInput(overrides = {}) {
  return {
    telemetryVisible: true,
    mode: 'grouped',
    editingTargets: [],
    deltaReferenceActive: true,
    ...overrides,
    state: { ...Object.fromEntries(COMPONENTS.map(name => [name, true])), ...overrides.state },
    overlayState: { delta: true, hud: true, shiftBar: true, ...overrides.overlayState }
  }
}

// Hidden flags that must all be false for an edit target to be on screen.
function editChain(visibility, target) {
  if (target === 'delta') return [visibility.delta]
  if (target === 'shiftBar') return [visibility.shiftBar]
  if (target === 'hud') return [visibility.hudFrame]
  return [visibility.sections[target], visibility.hud, visibility.hudFrame]
}

test('resolveHudVisibility keeps the base visibility rules without an edit', () => {
  const noTelemetry = resolveHudVisibility(visibilityInput({ telemetryVisible: false }))
  assert.equal(noTelemetry.hudFrame, true)
  assert.equal(noTelemetry.delta, true)
  assert.equal(noTelemetry.hud, false)

  const hudSwitchOff = resolveHudVisibility(visibilityInput({ overlayState: { hud: false } }))
  assert.equal(hudSwitchOff.hudFrame, true)
  assert.equal(hudSwitchOff.delta, false)

  const allHidden = resolveHudVisibility(visibilityInput({ state: ALL_HIDDEN }))
  assert.equal(allHidden.hud, true)
  assert.equal(allHidden.hudFrame, true)
  assert.ok(COMPONENTS.every(name => allHidden.sections[name]))

  const tiresHidden = resolveHudVisibility(visibilityInput({ state: { tires: false } }))
  assert.equal(tiresHidden.sections.tires, true)
  assert.equal(tiresHidden.sections.history, false)
  assert.equal(tiresHidden.hudFrame, false)
})

test('an edited target and its containers stay visible under every hiding condition', () => {
  for (const [mode, target] of EDIT_CASES) {
    for (const [condition, overrides] of Object.entries(HIDING_CONDITIONS)) {
      const visibility = resolveHudVisibility(visibilityInput({ ...overrides(target), mode, editingTargets: [target] }))
      assert.deepEqual(
        editChain(visibility, target).filter(Boolean),
        [],
        `${mode} ${target} with ${condition}`
      )
    }
  }
})

test('edit targets that do not belong to the current mode change nothing', () => {
  const base = visibilityInput({ telemetryVisible: false })
  const expected = resolveHudVisibility(base)
  assert.deepEqual(resolveHudVisibility({ ...base, mode: 'freeform', editingTargets: ['hud'] }), resolveHudVisibility({ ...base, mode: 'freeform' }))
  for (const name of COMPONENTS) {
    assert.deepEqual(resolveHudVisibility({ ...base, editingTargets: [name] }), expected, `grouped ${name}`)
  }
})

function createFakeElement() {
  const classes = new Set()
  const fakeElement = {
    hidden: false,
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name)
    },
    append() {},
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 69, width: 100, height: 69 }),
    querySelectorAll: () => [createFakeElement(), createFakeElement(), createFakeElement()],
    querySelector: () => fakeElement,
    set innerHTML(_) {}
  }
  return fakeElement
}

const RUNTIME_GLOBALS = ['document', 'window', 'location', 'addEventListener', 'requestAnimationFrame', 'localStorage', 'HudWidgets', 'HudGrid', 'HudLayout', 'HudPreferences']
const RUNTIME_MODULES = [
  ...(require('fs').existsSync(require.resolve('./hud-grid.js')) ? ['./hud-grid.js'] : []),
  './hud-widgets.js', './hud-layout.js', './hud-preferences.js'
].map(file => require.resolve(file))

// Loads the real overlay layout and visibility modules on a minimal DOM, in
// the index.html script order.
function withOverlayRuntime(run, seed = {}) {
  const previous = Object.fromEntries(RUNTIME_GLOBALS.map(name => [name, global[name]]))
  const ids = ['layout-grid', 'delta-strip', 'hud-frame', 'hud', ...COMPONENTS.map(name => `hud-${name}`)]
  for (const name of ['delta', 'hud']) ids.push(`${name}-edit-tools`, `${name}-snap`, `${name}-reset`, `${name}-cancel`, `${name}-save`)
  ids.push('shift-bar', 'shift-bar-edit-tools', 'shift-bar-snap', 'shift-bar-reset', 'shift-bar-cancel', 'shift-bar-save')
  const elements = new Map(ids.map(id => [id, createFakeElement()]))
  const storage = new Map(Object.entries(seed))
  const counters = { storageWrites: 0 }

  try {
    Object.assign(global, {
      document: {
        getElementById: id => elements.get(id) || null,
        createElement: createFakeElement,
        querySelectorAll: () => [],
        body: createFakeElement(),
        documentElement: { clientWidth: 1920, clientHeight: 1080 }
      },
      location: { search: '' },
      addEventListener() {},
      requestAnimationFrame() {},
      localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => {
          counters.storageWrites += 1
          storage.set(key, value)
        }
      }
    })
    global.window = global
    delete global.HudWidgets
    for (const modulePath of RUNTIME_MODULES) {
      delete require.cache[modulePath]
      require(modulePath)
    }
    run({ element: id => elements.get(id), counters })
  } finally {
    for (const modulePath of RUNTIME_MODULES) delete require.cache[modulePath]
    for (const name of RUNTIME_GLOBALS) {
      if (previous[name] === undefined) delete global[name]
      else global[name] = previous[name]
    }
  }
}

function editChainElements(target) {
  if (target === 'delta') return ['delta-strip']
  if (target === 'shiftBar') return ['shift-bar']
  if (target === 'hud') return ['hud-frame']
  return [`hud-${target}`, 'hud', 'hud-frame']
}

const SWITCHED_ON_SHIFT_BAR = { 'fdc.overlay-visibility.v1': JSON.stringify({ shiftBar: true }) }

test('layout edit survives non-live telemetry packets in both layout modes', () => {
  withOverlayRuntime(({ element }) => {
    for (const [mode, target] of EDIT_CASES) {
      for (const finish of ['cancelEditMode', 'savePosition']) {
        HudLayout.setMode(mode)
        HudPreferences.setTelemetryVisible(false)
        HudLayout.enterEditMode(target)

        // Every Data Out packet outside live driving re-applies visibility.
        HudPreferences.setTelemetryVisible(true)
        HudPreferences.setTelemetryVisible(false)
        HudPreferences.apply()

        for (const id of editChainElements(target)) {
          assert.equal(element(id).hidden, false, `${mode} ${target}: #${id} while editing`)
        }

        HudLayout[finish]()
        const outerId = { delta: 'delta-strip', shiftBar: 'shift-bar' }[target] || 'hud-frame'
        assert.equal(element(outerId).hidden, true, `${mode} ${target}: #${outerId} after ${finish}`)
      }
    }
  }, SWITCHED_ON_SHIFT_BAR)
})

test('a hidden freeform block is shown only while it is edited', () => {
  withOverlayRuntime(({ element }) => {
    HudLayout.setMode('freeform')
    HudPreferences.setVisibility('tires', false)
    assert.equal(element('hud-tires').hidden, true)

    HudLayout.enterEditMode('tires')
    assert.equal(element('hud-tires').hidden, false)

    HudLayout.cancelEditMode()
    assert.equal(element('hud-tires').hidden, true)
  })
})

test('an unchanged telemetry visibility does no layout or storage work', () => {
  withOverlayRuntime(({ counters }) => {
    HudPreferences.setTelemetryVisible(false)
    const refreshLayout = HudLayout.refreshLayout
    let layoutRefreshes = 0
    HudLayout.refreshLayout = () => {
      layoutRefreshes += 1
      refreshLayout()
    }
    const storageWrites = counters.storageWrites

    for (let packet = 0; packet < 5; packet += 1) HudPreferences.setTelemetryVisible(false)

    assert.equal(layoutRefreshes, 0)
    assert.equal(counters.storageWrites, storageWrites)
  })
})

test('delta is hidden without an active reference', () => {
  const noReference = resolveHudVisibility(visibilityInput({ deltaReferenceActive: false }))
  assert.equal(noReference.delta, true)

  const withReference = resolveHudVisibility(visibilityInput({ deltaReferenceActive: true }))
  assert.equal(withReference.delta, false)
})

test('delta with a reference still follows telemetry visibility', () => {
  const withReferenceLive = resolveHudVisibility(visibilityInput({ telemetryVisible: true, deltaReferenceActive: true }))
  assert.equal(withReferenceLive.delta, false)

  const withReferenceNotLive = resolveHudVisibility(visibilityInput({ telemetryVisible: false, deltaReferenceActive: true }))
  assert.equal(withReferenceNotLive.delta, true)
})

test('delta switch off hides it even with a reference', () => {
  const switchOff = resolveHudVisibility(visibilityInput({ deltaReferenceActive: true, overlayState: { delta: false } }))
  assert.equal(switchOff.delta, true)
})

test('editing delta shows it without a reference', () => {
  const editingNormal = resolveHudVisibility(visibilityInput({ deltaReferenceActive: false, editingTargets: ['delta'] }))
  assert.equal(editingNormal.delta, false)

  const editingWithoutTelemetry = resolveHudVisibility(visibilityInput({ telemetryVisible: false, deltaReferenceActive: false, editingTargets: ['delta'] }))
  assert.equal(editingWithoutTelemetry.delta, false)
})

test('multiple edit targets show all their sections and containers', () => {
  const visibility = resolveHudVisibility(visibilityInput({ telemetryVisible: false, mode: 'freeform', state: { tires: true, pedals: false, steering: false, gear: true, engine: true, history: false }, editingTargets: ['tires', 'gear', 'delta'] }))
  assert.equal(visibility.delta, false, 'delta visible')
  assert.equal(visibility.sections.tires, false, 'tires visible despite no telemetry')
  assert.equal(visibility.sections.gear, false, 'gear visible despite no telemetry')
  assert.equal(visibility.sections.steering, true, 'steering hidden by its switch')
  assert.equal(visibility.sections.pedals, true, 'pedals hidden by its switch')
  assert.equal(visibility.sections.engine, false, 'engine visible by its switch')
  assert.equal(visibility.sections.history, true, 'history hidden by its switch')
  assert.equal(visibility.hud, false, 'hud visible because a target is being edited')
  assert.equal(visibility.hudFrame, false, 'hudFrame visible because a target is being edited')
})

test('the edit hotkey edits every enabled target at once and saves on the second press', () => {
  withOverlayRuntime(({ element, counters }) => {
    HudLayout.setMode('freeform')
    HudPreferences.setVisibility('tires', false)
    HudPreferences.setTelemetryVisible(false)

    assert.equal(HudLayout.toggleEditSession(), 'started')
    assert.deepEqual(HudLayout.getEditingTargets(), ['pedals', 'steering', 'gear', 'engine', 'history', 'delta'])
    assert.equal(HudLayout.getEditingTarget(), 'pedals')
    assert.equal(element('hud-tires').hidden, true, 'a switched-off block stays out of the edit')
    assert.equal(element('hud-gear').hidden, false)
    assert.equal(element('delta-strip').hidden, false, 'Delta is editable without an Event')

    // EDIT in Configuration selects within the running edit instead of restarting it.
    HudLayout.enterEditMode('gear')
    assert.equal(HudLayout.getEditingTarget(), 'gear')
    assert.equal(HudLayout.getEditingTargets().length, 6)

    assert.equal(HudLayout.toggleEditSession(), 'saved')
    assert.deepEqual(HudLayout.getEditingTargets(), [])
    assert.equal(element('hud-frame').hidden, true, 'non-live telemetry hides the HUD again')
    assert.ok(counters.storageWrites > 0)
  })
})

test('cancel restores every target and a reset inside the edit is not saved early', () => {
  withOverlayRuntime(({ counters }) => {
    HudLayout.setMode('grouped')
    const before = HudLayout.getPosition('hud')
    HudLayout.toggleEditSession()
    const writes = counters.storageWrites
    HudLayout.resetPosition('hud')
    assert.equal(counters.storageWrites, writes)
    HudLayout.cancelEditMode()
    assert.deepEqual(HudLayout.getPosition('hud'), before)
  })
})

test('the edit hotkey does nothing when every target is switched off', () => {
  withOverlayRuntime(() => {
    HudLayout.setMode('grouped')
    HudPreferences.setOverlayVisibility('hud', false)
    HudPreferences.setOverlayVisibility('delta', false)
    assert.equal(HudLayout.toggleEditSession(), 'unavailable')
    assert.deepEqual(HudLayout.getEditingTargets(), [])
  })
})

test('snap is enabled by default and can be toggled', () => {
  withOverlayRuntime(({ element, counters }) => {
    assert.equal(HudLayout.isSnapEnabled(), true)
    HudLayout.setSnapEnabled(false)
    assert.equal(HudLayout.isSnapEnabled(), false)
    assert.equal(counters.storageWrites > 0, true)
    HudLayout.setSnapEnabled(true)
    assert.equal(HudLayout.isSnapEnabled(), true)
  })
})

test('grid shows when edit session starts with snap enabled and hides when snap is disabled', () => {
  withOverlayRuntime(({ element }) => {
    HudLayout.setSnapEnabled(true)
    assert.equal(element('layout-grid').hidden, true, 'grid hidden before edit')

    HudLayout.toggleEditSession()
    assert.equal(element('layout-grid').hidden, false, 'grid shown after edit starts with snap on')

    HudLayout.setSnapEnabled(false)
    assert.equal(element('layout-grid').hidden, true, 'grid hidden when snap disabled')

    HudLayout.setSnapEnabled(true)
    assert.equal(element('layout-grid').hidden, false, 'grid shown again when snap enabled')

    HudLayout.cancelEditMode()
    assert.equal(element('layout-grid').hidden, true, 'grid hidden after edit ends')
  })
})

test('snap preference persists in storage', () => {
  let savedValue = null
  withOverlayRuntime(({ element, counters }) => {
    const initialWrites = counters.storageWrites
    HudLayout.setSnapEnabled(false)
    assert(counters.storageWrites > initialWrites, 'storage write occurred')
    // Capture what was written to storage
    const storage = global.localStorage
    savedValue = storage.getItem('fdc.layout-snap.v1')
  })

  assert.equal(savedValue, 'off', 'snap preference written to storage as off')
})

test('startEditSession() returns started then active on a second call', () => {
  withOverlayRuntime(() => {
    HudLayout.setMode('grouped')
    assert.equal(HudLayout.startEditSession(), 'started', 'first call starts session')
    assert.equal(HudLayout.startEditSession(), 'active', 'second call returns active')
    HudLayout.cancelEditMode()
  })
})

test('startEditSession() returns unavailable when every target is disabled', () => {
  withOverlayRuntime(() => {
    HudLayout.setMode('freeform')
    HudPreferences.setVisibility('tires', false)
    HudPreferences.setVisibility('pedals', false)
    HudPreferences.setVisibility('steering', false)
    HudPreferences.setVisibility('gear', false)
    HudPreferences.setVisibility('engine', false)
    HudPreferences.setVisibility('history', false)
    HudPreferences.setOverlayVisibility('delta', false)
    HudPreferences.apply()
    assert.equal(HudLayout.startEditSession(), 'unavailable', 'returns unavailable when no targets available')
  })
})

test('resetAllPositions() during session ends it and clears all positions', () => {
  withOverlayRuntime(({ element }) => {
    HudLayout.setMode('grouped')
    const freshlyCaptured = HudLayout.getPosition('hud')

    // Modify and then reset
    HudLayout.startEditSession()
    const originalPos = HudLayout.getPosition('hud')
    assert.ok(originalPos.x !== undefined && originalPos.y !== undefined, 'position has coordinates')

    HudLayout.resetAllPositions()
    assert.deepEqual(HudLayout.getEditingTargets(), [], 'session is ended')

    // Get fresh runtime position to compare against
    const afterReset = HudLayout.getPosition('hud')
    assert.deepEqual(afterReset, freshlyCaptured, 'position matches fresh runtime default')
  })
})

test('snap buttons show GRID ON when enabled and GRID OFF when disabled', () => {
  withOverlayRuntime(({ element }) => {
    // Check initial state - snap is enabled by default
    assert.equal(element('delta-snap').textContent, 'GRID ON', 'delta snap button shows GRID ON initially')
    assert.equal(element('hud-snap').textContent, 'GRID ON', 'hud snap button shows GRID ON initially')

    HudLayout.setSnapEnabled(false)
    assert.equal(element('delta-snap').textContent, 'GRID OFF', 'delta snap button shows GRID OFF after disable')
    assert.equal(element('hud-snap').textContent, 'GRID OFF', 'hud snap button shows GRID OFF after disable')

    HudLayout.setSnapEnabled(true)
    assert.equal(element('delta-snap').textContent, 'GRID ON', 'delta snap button shows GRID ON after enable')
    assert.equal(element('hud-snap').textContent, 'GRID ON', 'hud snap button shows GRID ON after enable')
  })
})

test('the Shift Bar follows its switch and telemetry, and shows during an edit without telemetry', () => {
  assert.equal(resolveHudVisibility(visibilityInput()).shiftBar, false)
  assert.equal(resolveHudVisibility(visibilityInput({ overlayState: { shiftBar: false } })).shiftBar, true)
  assert.equal(resolveHudVisibility({ ...visibilityInput(), overlayState: { delta: true, hud: true } }).shiftBar, true, 'a missing key is off')
  assert.equal(resolveHudVisibility(visibilityInput({ telemetryVisible: false })).shiftBar, true)
  assert.equal(resolveHudVisibility(visibilityInput({ state: ALL_HIDDEN })).shiftBar, false, 'Speed, Gear and RPM do not hide it')
  assert.equal(resolveHudVisibility(visibilityInput({ telemetryVisible: false, editingTargets: ['shiftBar'] })).shiftBar, false)
  assert.equal(resolveHudVisibility(visibilityInput({ telemetryVisible: false, editingTargets: ['delta'] })).shiftBar, true)
})

// A rect in stage space, as getBoundingClientRect reports it on a 1920 x 1080 monitor.
function rect(left, top, width, height) {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

test('Shift Bar defaults above the HUD, and Delta sits above the bar only while the bar is on', () => {
  withOverlayRuntime(({ element }) => {
    // HUD scale is 2 here: the HUD is 1472 x 138 at the bottom, 28 px above the edge.
    element('hud-frame').getBoundingClientRect = () => rect(224, 914, 1472, 138)
    // The default Shift Bar size is 0.5: 736 x 60 at HUD scale 2.
    element('shift-bar').getBoundingClientRect = () => rect(592, 844, 736, 60)
    element('delta-strip').getBoundingClientRect = () => rect(224, 786, 1472, 60)
    // Delta is hidden without an Event reference, so its place is only applied with one.
    HudPreferences.setDeltaReferenceActive(true)

    HudPreferences.setOverlayVisibility('shiftBar', true)
    assert.equal(element('shift-bar').style.left, '592px', 'centered on the HUD: 224 + 736 - 368')
    assert.equal(element('shift-bar').style.top, '844px', 'a 10 px gap above the HUD: 914 - 10 - 60')
    assert.equal(element('delta-strip').style.top, '774px', 'Delta 10 px above the bar: 914 - 10 - 60 - 10 - 60')

    // Turning the bar off moves an unsaved Delta back above the HUD, because defaults are not stored.
    HudPreferences.setOverlayVisibility('shiftBar', false)
    assert.equal(element('shift-bar').hidden, true)
    assert.equal(element('delta-strip').style.top, '844px', 'Delta 10 px above the HUD: 914 - 10 - 60')
  })
})

test('a never-resized Shift Bar uses the 0.5 user scale, and a stored size below 0.5 reads as 0.5', () => {
  const cases = [
    [undefined, '0.5'],
    [0.3, '0.5'],
    [1.2, '1.2']
  ]
  for (const [storedSize, expectedScale] of cases) {
    const shared = storedSize === undefined ? {} : { shiftBar: { x: 0.25, y: 0.5, size: storedSize } }
    const seed = {
      'fdc.overlay-visibility.v1': JSON.stringify({ shiftBar: true }),
      'fdc.layout.v2': JSON.stringify({ version: 2, shared, grouped: {}, freeform: {} })
    }
    withOverlayRuntime(({ element }) => {
      const props = {}
      element('shift-bar').style.setProperty = (name, value) => { props[name] = value }
      HudLayout.refreshLayout()
      assert.equal(props['--shift-bar-user-scale'], expectedScale, `stored size ${storedSize}`)
    }, seed)
  }
})

test('a never-resized Delta keeps the default user scale 1 while the Shift Bar defaults to 0.5', () => {
  withOverlayRuntime(({ element }) => {
    const props = {}
    element('delta-strip').style.setProperty = (name, value) => { props[name] = value }
    element('shift-bar').style.setProperty = (name, value) => { props[`shift:${name}`] = value }
    // Delta and the Shift Bar are applied only while visible: Delta needs an Event reference.
    HudPreferences.setDeltaReferenceActive(true)
    HudPreferences.setOverlayVisibility('shiftBar', true)
    HudLayout.refreshLayout()
    assert.equal(props['--delta-user-scale'], '1')
    assert.equal(props['shift:--shift-bar-user-scale'], '0.5')
  })
})

test('a saved Shift Bar size sets its user scale, and RESET returns it to the default place', () => {
  const seed = {
    'fdc.overlay-visibility.v1': JSON.stringify({ shiftBar: true }),
    'fdc.layout.v2': JSON.stringify({ version: 2, shared: { shiftBar: { x: 0.25, y: 0.5, size: 1.5 } }, grouped: {}, freeform: {} })
  }
  withOverlayRuntime(({ element }) => {
    const props = {}
    element('shift-bar').style.setProperty = (name, value) => { props[name] = value }
    HudLayout.refreshLayout()
    assert.equal(props['--shift-bar-user-scale'], '1.5')
    assert.deepEqual(HudLayout.getPosition('shiftBar'), { x: 0.25, y: 0.5, size: 1.5 })

    HudLayout.resetPosition('shiftBar')
    assert.equal(HudLayout.getPosition('shiftBar').size, 0)
    assert.equal(props['--shift-bar-user-scale'], '0.5', 'RESET returns the Shift Bar to its 0.5 default')
  }, seed)
})

test('RESET LAYOUT clears a saved Shift Bar place along with Delta and the HUD', () => {
  const seed = {
    'fdc.overlay-visibility.v1': JSON.stringify({ shiftBar: true }),
    'fdc.layout.v2': JSON.stringify({ version: 2, shared: { shiftBar: { x: 0.3, y: 0.3, size: 1 }, delta: { x: 0.1, y: 0.1, size: 0 } }, grouped: {}, freeform: {} })
  }
  withOverlayRuntime(() => {
    HudLayout.resetAllPositions()
    assert.equal(HudLayout.getPosition('shiftBar').size, 0)
    assert.equal(HudLayout.getPosition('delta').size, 0)
  }, seed)
})

test('the Shift Bar joins a layout edit only while its switch is on', () => {
  withOverlayRuntime(({ element }) => {
    HudLayout.setMode('grouped')
    HudLayout.enterEditMode('shiftBar')
    assert.equal(HudLayout.isEditing('shiftBar'), false, 'a switched-off bar stays out of the edit')
    assert.equal(element('shift-bar').hidden, true)

    HudPreferences.setOverlayVisibility('shiftBar', true)
    assert.equal(HudLayout.startEditSession(), 'started')
    assert.deepEqual(HudLayout.getEditingTargets(), ['hud', 'delta', 'shiftBar'])
    assert.equal(element('shift-bar').hidden, false)
    assert.equal(element('shift-bar').classList.contains('is-editing'), true)
    HudLayout.cancelEditMode()
  })
})

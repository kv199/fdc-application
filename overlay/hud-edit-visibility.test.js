const test = require('node:test')
const assert = require('node:assert/strict')

const { COMPONENTS } = require('./hud-widgets.js')
const { resolveHudVisibility } = require('./hud-preferences.js')

const EDIT_CASES = [
  ['grouped', 'delta'],
  ['freeform', 'delta'],
  ['grouped', 'hud'],
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
    overlayState: { delta: true, hud: true, ...overrides.overlayState }
  }
}

// Hidden flags that must all be false for an edit target to be on screen.
function editChain(visibility, target) {
  if (target === 'delta') return [visibility.delta]
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
  return {
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
    set innerHTML(_) {}
  }
}

const RUNTIME_GLOBALS = ['document', 'window', 'location', 'addEventListener', 'requestAnimationFrame', 'localStorage', 'HudWidgets', 'HudLayout', 'HudPreferences']
const RUNTIME_MODULES = ['./hud-widgets.js', './hud-layout.js', './hud-preferences.js'].map(file => require.resolve(file))

// Loads the real overlay layout and visibility modules on a minimal DOM, in
// the index.html script order.
function withOverlayRuntime(run) {
  const previous = Object.fromEntries(RUNTIME_GLOBALS.map(name => [name, global[name]]))
  const ids = ['delta-strip', 'hud-frame', 'hud', ...COMPONENTS.map(name => `hud-${name}`)]
  for (const name of ['delta', 'hud']) ids.push(`${name}-edit-tools`, `${name}-reset`, `${name}-cancel`, `${name}-save`)
  const elements = new Map(ids.map(id => [id, createFakeElement()]))
  const storage = new Map()
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
  if (target === 'hud') return ['hud-frame']
  return [`hud-${target}`, 'hud', 'hud-frame']
}

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
        const outerId = target === 'delta' ? 'delta-strip' : 'hud-frame'
        assert.equal(element(outerId).hidden, true, `${mode} ${target}: #${outerId} after ${finish}`)
      }
    }
  })
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

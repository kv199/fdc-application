const test = require('node:test')
const assert = require('node:assert/strict')

// Runs the real layout module against a minimal DOM and a fake Tauri bridge,
// so the stage sync, window bounds and restaging paths execute as in the HUD.
const GLOBALS = ['document', 'window', 'location', 'addEventListener', 'requestAnimationFrame', 'localStorage',
  'setTimeout', 'clearTimeout', 'HudWidgets', 'HudGrid', 'HudLayout', 'HudTauriEvents', '__TAURI_INTERNALS__', 'devicePixelRatio']
const MODULES = ['./hud-grid.js', './hud-widgets.js', './hud-layout.js'].map(file => require.resolve(file))
const BLOCK_IDS = ['delta-strip', 'hud-frame', 'hud-tires', 'hud-pedals', 'hud-steering', 'hud-gear', 'hud-engine', 'hud-history', 'hud']

const tick = () => new Promise(resolve => setImmediate(resolve))

function fakeElement() {
  const classes = new Set()
  return {
    hidden: false,
    dataset: {},
    rect: { left: 0, top: 0, width: 0, height: 0 },
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
    setPointerCapture() {},
    releasePointerCapture() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect() {
      return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }
    },
    set innerHTML(_) {}
  }
}

async function withStageRuntime(run) {
  const previous = Object.fromEntries(GLOBALS.map(name => [name, global[name]]))
  const elements = new Map(BLOCK_IDS.map(id => [id, fakeElement()]))
  const shell = fakeElement()
  const props = {}
  const calls = []
  const listeners = {}
  const frames = []
  const stageReply = { stageWidth: 1920, stageHeight: 1080, offsetX: 0, offsetY: 0 }
  const documentElement = {
    clientWidth: 1920,
    clientHeight: 1080,
    style: { setProperty: (name, value) => { props[name] = value }, removeProperty() {} }
  }
  const sent = () => calls.filter(call => call.command === 'set_hud_window_bounds')
  // The restaging safety timeout is driven by the test, never by real time.
  const timers = new Map()
  let timerId = 0
  try {
    Object.assign(global, {
      document: {
        readyState: 'complete',
        getElementById: id => elements.get(id) || null,
        createElement: fakeElement,
        querySelector: selector => (selector === '.hud-shell' ? shell : null),
        querySelectorAll: () => [],
        body: fakeElement(),
        documentElement
      },
      location: { search: '' },
      setTimeout: callback => { timerId += 1; timers.set(timerId, callback); return timerId },
      clearTimeout: id => { timers.delete(id) },
      addEventListener() {},
      requestAnimationFrame: callback => { frames.push(callback); return frames.length },
      localStorage: { getItem: () => null, setItem() {} },
      __TAURI_INTERNALS__: {
        invoke: (command, args) => {
          calls.push({ command, args })
          if (command === 'get_hud_stage') return Promise.resolve({ ...stageReply })
          return Promise.resolve(null)
        }
      },
      HudTauriEvents: {
        getEventApi: () => ({ listen: async (name, handler) => { listeners[name] = handler } })
      }
    })
    global.window = global
    for (const name of ['HudWidgets', 'HudGrid', 'HudLayout']) delete global[name]
    for (const modulePath of MODULES) {
      delete require.cache[modulePath]
      require(modulePath)
    }
    const flushFrames = () => { while (frames.length) frames.shift()() }
    const emitStage = payload => listeners.hud_stage({ payload })
    const runTimers = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback() } }
    return await run({ elements, shellClasses: shell.classList, props, calls, sent, flushFrames, emitStage, runTimers })
  } finally {
    for (const modulePath of MODULES) delete require.cache[modulePath]
    for (const name of GLOBALS) {
      if (previous[name] === undefined) delete global[name]
      else global[name] = previous[name]
    }
  }
}

function setRect(element, left, top, width, height) {
  element.rect = { left, top, width, height }
}

test('the native physical pixels follow the page pixel ratio, Windows text size included', async () => {
  await withStageRuntime(async ({ elements, props, sent, flushFrames }) => {
    global.devicePixelRatio = 1.25
    await tick()
    assert.equal(props['--stage-width'], '1536px')
    assert.equal(props['--stage-height'], '864px')

    setRect(elements.get('hud-frame'), 400, 700, 920, 69)
    HudLayout.refreshLayout()
    flushFrames()
    assert.deepEqual(sent().at(-1).args, { bounds: { left: 490, top: 865, width: 1170, height: 106.25 } })
  })
})

test('the stage starts at the monitor and follows the native stage reply', async () => {
  await withStageRuntime(async ({ props, calls }) => {
    await tick()
    assert.ok(calls.some(call => call.command === 'get_hud_stage'))
    assert.equal(props['--stage-width'], '1920px')
    assert.equal(props['--stage-height'], '1080px')
    assert.equal(props['--stage-offset-x'], '0px')
    assert.equal(props['--stage-offset-y'], '0px')
  })
})

test('a refresh sends the padded visible blocks in stage space and restages the shell', async () => {
  await withStageRuntime(async ({ elements, sent, flushFrames, shellClasses, emitStage }) => {
    await tick()
    flushFrames()
    assert.equal(sent().length, 0, 'no visible block yet')

    setRect(elements.get('hud-frame'), 500, 900, 920, 69)
    HudLayout.refreshLayout()
    flushFrames()
    assert.deepEqual(sent().at(-1).args, { bounds: { left: 492, top: 892, width: 936, height: 85 } })
    assert.equal(shellClasses.contains('is-restaging'), true, 'the shell waits for the native move')

    setRect(elements.get('hud-frame'), 8, 8, 920, 69)
    emitStage({ stageWidth: 1920, stageHeight: 1080, offsetX: 492, offsetY: 892 })
    flushFrames()
    assert.equal(shellClasses.contains('is-restaging'), false)
  })
})

test('the restaging class ends by the safety timeout when the native side reports nothing', async () => {
  await withStageRuntime(async ({ elements, flushFrames, shellClasses, runTimers }) => {
    await tick()
    setRect(elements.get('hud-frame'), 500, 900, 920, 69)
    HudLayout.refreshLayout()
    flushFrames()
    assert.equal(shellClasses.contains('is-restaging'), true)
    runTimers()
    assert.equal(shellClasses.contains('is-restaging'), false)
  })
})

test('the window offset shifts the page but not the stage coordinates of the bounds', async () => {
  await withStageRuntime(async ({ elements, sent, flushFrames, props, emitStage }) => {
    await tick()
    setRect(elements.get('hud-frame'), 500, 900, 920, 69)
    HudLayout.refreshLayout()
    flushFrames()
    const count = sent().length

    setRect(elements.get('hud-frame'), 8, 8, 920, 69)
    emitStage({ stageWidth: 1920, stageHeight: 1080, offsetX: 492, offsetY: 892 })
    flushFrames()
    assert.equal(props['--stage-offset-x'], '492px')
    assert.equal(props['--stage-offset-y'], '892px')
    assert.equal(sent().length, count, 'the same stage bounds are not sent again')
  })
})

test('hidden blocks keep the current window and a monitor switch sends bounds again', async () => {
  await withStageRuntime(async ({ elements, sent, flushFrames, emitStage }) => {
    await tick()
    setRect(elements.get('hud-frame'), 500, 900, 920, 69)
    HudLayout.refreshLayout()
    flushFrames()
    const count = sent().length

    setRect(elements.get('hud-frame'), 0, 0, 0, 0)
    HudLayout.refreshLayout()
    flushFrames()
    assert.equal(sent().length, count, 'no visible block sends nothing')

    setRect(elements.get('hud-frame'), 500, 900, 920, 69)
    emitStage({ stageWidth: 2560, stageHeight: 1440, offsetX: 0, offsetY: 0 })
    flushFrames()
    assert.equal(sent().length, count + 1, 'the new monitor gets fresh bounds')
  })
})

test('placing the HUD again on the same monitor sends the cropped bounds again', async () => {
  await withStageRuntime(async ({ elements, sent, flushFrames, emitStage }) => {
    await tick()
    setRect(elements.get('hud-frame'), 500, 900, 920, 69)
    HudLayout.refreshLayout()
    flushFrames()
    const count = sent().length

    // The native reply to those bounds, rounded to physical pixels, sends nothing new.
    setRect(elements.get('hud-frame'), 8.4, 8, 920, 69)
    emitStage({ stageWidth: 1920, stageHeight: 1080, offsetX: 491.6, offsetY: 892 })
    flushFrames()
    assert.equal(sent().length, count, 'a sub-pixel offset is the same window')

    // HUD DISPLAY picks the same monitor: the window covers it again.
    setRect(elements.get('hud-frame'), 500, 900, 920, 69)
    emitStage({ stageWidth: 1920, stageHeight: 1080, offsetX: 0, offsetY: 0 })
    flushFrames()
    assert.equal(sent().length, count + 1)
    assert.deepEqual(sent().at(-1).args, { bounds: { left: 492, top: 892, width: 936, height: 85 } })
  })
})

test('editing keeps the whole monitor and the cropped bounds return after the edit', async () => {
  await withStageRuntime(async ({ elements, sent, flushFrames, calls, shellClasses, emitStage }) => {
    await tick()
    setRect(elements.get('hud-frame'), 500, 900, 920, 69)
    HudLayout.refreshLayout()
    flushFrames()
    const count = sent().length

    HudLayout.enterEditMode('hud')
    HudLayout.refreshLayout()
    flushFrames()
    assert.equal(sent().length, count, 'no bounds are sent while editing')
    assert.ok(calls.some(call => call.command === 'set_window_edit_mode' && call.args.enabled === true))

    HudLayout.cancelEditMode()
    assert.ok(calls.some(call => call.command === 'set_window_edit_mode' && call.args.enabled === false))
    assert.equal(shellClasses.contains('is-restaging'), true, 'the native side restores the cropped window')
    flushFrames()
    assert.equal(sent().length, count, 'the unchanged bounds are not sent again')

    setRect(elements.get('hud-frame'), 8, 8, 920, 69)
    emitStage({ stageWidth: 1920, stageHeight: 1080, offsetX: 492, offsetY: 892 })
    flushFrames()
    assert.equal(shellClasses.contains('is-restaging'), false)
  })
})

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  LIMITER_RPM_FRACTION,
  SEGMENT_COUNT,
  createShiftBar,
  fillFraction,
  filledSegments,
  limiterRpm,
  resolveSignal,
  resolveThresholdRpm,
  segmentTransform
} = require('./shift-bar.js')

// Minimal DOM: elements, attributes, a classList, and a count of every
// mutating call so tests can assert that unchanged renders write nothing.
function createFakeDocument() {
  const counter = { writes: 0 }
  const byId = new Map()

  class FakeClassList {
    constructor(owner) {
      this.owner = owner
      this.names = new Set()
    }

    add(name) {
      counter.writes += 1
      this.names.add(name)
    }

    remove(name) {
      counter.writes += 1
      this.names.delete(name)
    }

    toggle(name, force) {
      counter.writes += 1
      const on = force === undefined ? !this.names.has(name) : Boolean(force)
      if (on) this.names.add(name)
      else this.names.delete(name)
      return on
    }

    contains(name) {
      return this.names.has(name)
    }
  }

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName
      this.attributes = new Map()
      this.children = []
      this.classList = new FakeClassList(this)
    }

    setAttribute(name, value) {
      counter.writes += 1
      if (name === 'class') {
        this.classList.names = new Set(String(value).split(/\s+/).filter(Boolean))
        return
      }
      this.attributes.set(name, String(value))
    }

    getAttribute(name) {
      if (name === 'class') return [...this.classList.names].join(' ')
      return this.attributes.has(name) ? this.attributes.get(name) : null
    }

    appendChild(child) {
      counter.writes += 1
      this.children.push(child)
      return child
    }
  }

  const doc = {
    counter,
    createElement: tagName => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName),
    registerId: (id, element) => byId.set(id, element),
    getElementById: id => byId.get(id) ?? null
  }
  return doc
}

function withFakeDocument(run) {
  const fake = createFakeDocument()
  const previous = globalThis.document
  globalThis.document = fake
  try {
    return run(fake)
  } finally {
    if (previous === undefined) delete globalThis.document
    else globalThis.document = previous
  }
}

function mountBar(doc) {
  const root = doc.createElement('section')
  root.setAttribute('id', 'shift-bar')
  root.setAttribute('class', 'shift-bar')
  const segments = doc.createElement('div')
  segments.setAttribute('id', 'shift-bar-segments')
  segments.setAttribute('class', 'shift-bar__segments')
  doc.registerId('shift-bar', root)
  doc.registerId('shift-bar-segments', segments)
  return { root, segments }
}

function litCount(segments) {
  return segments.children.filter(segment => segment.classList.contains('is-filled')).length
}

test('fillFraction is 0 at idle and 1 at the threshold', () => {
  assert.equal(fillFraction({ rpm: 900, rpmIdle: 900, thresholdRpm: 6500 }), 0)
  assert.equal(fillFraction({ rpm: 6500, rpmIdle: 900, thresholdRpm: 6500 }), 1)
})

test('fillFraction clamps to 0..1 below idle and above the threshold', () => {
  assert.equal(fillFraction({ rpm: 300, rpmIdle: 900, thresholdRpm: 6500 }), 0)
  assert.equal(fillFraction({ rpm: 9000, rpmIdle: 900, thresholdRpm: 6500 }), 1)
})

test('fillFraction is halfway at the midpoint between idle and the threshold', () => {
  // (3450 - 900) / (6000 - 900) = 0.5.
  assert.equal(fillFraction({ rpm: 3450, rpmIdle: 900, thresholdRpm: 6000 }), 0.5)
})

test('fillFraction treats a missing idle RPM as zero', () => {
  // 4250 / 6800 = 0.625.
  assert.equal(fillFraction({ rpm: 4250, thresholdRpm: 6800 }), 0.625)
})

test('fillFraction returns 0 when RPM or the threshold is missing or not above idle', () => {
  assert.equal(fillFraction({ rpm: null, rpmIdle: 900, thresholdRpm: 6500 }), 0)
  assert.equal(fillFraction({ rpm: 5000, rpmIdle: 900 }), 0)
  assert.equal(fillFraction({ rpm: 5000, rpmIdle: 900, thresholdRpm: 900 }), 0)
  assert.equal(fillFraction({ rpm: 5000, rpmIdle: 900, thresholdRpm: 0 }), 0)
  assert.equal(fillFraction(), 0)
})

test('limiterRpm prefers a positive usable ceiling over the game max RPM', () => {
  assert.equal(limiterRpm({ usableCeiling: 7400, rpmMax: 8000 }), 7400)
  assert.equal(limiterRpm({ usableCeiling: null, rpmMax: 8000 }), 8000)
  assert.equal(limiterRpm({ usableCeiling: 0, rpmMax: 8000 }), 8000)
  assert.equal(limiterRpm({ usableCeiling: -5, rpmMax: 8000 }), 8000)
  assert.equal(limiterRpm({ usableCeiling: '', rpmMax: 8000 }), 8000)
  assert.equal(limiterRpm({ usableCeiling: null, rpmMax: null }), null)
  assert.equal(limiterRpm(), null)
})

test('the limiter fraction is 97 percent', () => {
  assert.equal(LIMITER_RPM_FRACTION, 0.97)
})

test('resolveSignal is normal below the limiter flash point and shows no approach signal', () => {
  assert.equal(resolveSignal({ rpm: 7000, rpmMax: 8000 }), 'normal')
  // 85% of max, the old steady red point, is no longer a signal.
  assert.equal(resolveSignal({ rpm: 6800, rpmMax: 8000, shiftPhase: 'approach', shiftCueEnabled: true }), 'normal')
  assert.equal(resolveSignal({ rpm: 7759, rpmMax: 8000 }), 'normal')
})

test('resolveSignal is redline from 97 percent of the limiter', () => {
  assert.equal(resolveSignal({ rpm: 7760, rpmMax: 8000 }), 'redline')
  assert.equal(resolveSignal({ rpm: 8100, rpmMax: 8000 }), 'redline')
})

test('resolveSignal measures redline against the usable ceiling, then against rpmMax', () => {
  // 97% of 7400 = 7178: the measured ceiling wins over the game's 8000.
  assert.equal(resolveSignal({ rpm: 7178, rpmMax: 8000, usableCeiling: 7400 }), 'redline')
  assert.equal(resolveSignal({ rpm: 7177, rpmMax: 8000, usableCeiling: 7400 }), 'normal')
  assert.equal(resolveSignal({ rpm: 7760, rpmMax: 8000, usableCeiling: null }), 'redline')
  assert.equal(resolveSignal({ rpm: 7000, rpmMax: 8000, usableCeiling: 0 }), 'normal')
})

test('resolveSignal shows no redline without a limiter or RPM', () => {
  assert.equal(resolveSignal({ rpm: 9000 }), 'normal')
  assert.equal(resolveSignal({ rpm: null, rpmMax: 8000 }), 'normal')
  assert.equal(resolveSignal(), 'normal')
})

test('resolveSignal is shift at the Shift Light cue when the cue is enabled', () => {
  assert.equal(resolveSignal({ rpm: 6500, rpmMax: 8000, shiftCueEnabled: true, shiftPhase: 'shift' }), 'shift')
  assert.equal(resolveSignal({ rpm: 6500, rpmMax: 8000, shiftCueEnabled: true, shiftPhase: 'normal' }), 'normal')
})

test('resolveSignal shows no shift when the cue is disabled, including the last known gear', () => {
  // The caller passes shiftCueEnabled false for FDC Shift Light off and for the last known gear.
  assert.equal(resolveSignal({ rpm: 6500, rpmMax: 8000, shiftCueEnabled: false, shiftPhase: 'shift' }), 'normal')
  assert.equal(resolveSignal({ rpm: 6500, rpmMax: 8000, shiftPhase: 'shift' }), 'normal')
})

test('resolveSignal keeps the limiter red with the cue disabled', () => {
  assert.equal(resolveSignal({ rpm: 7800, rpmMax: 8000, shiftCueEnabled: false, shiftPhase: 'shift' }), 'redline')
  assert.equal(resolveSignal({ rpm: 7800, rpmMax: 8000, shiftCueEnabled: false }), 'redline')
})

test('resolveSignal gives redline priority over shift', () => {
  assert.equal(resolveSignal({ rpm: 7800, rpmMax: 8000, shiftCueEnabled: true, shiftPhase: 'shift' }), 'redline')
  // An early learned target leaves red at 97% of the limiter.
  assert.equal(resolveSignal({ rpm: 7760, rpmMax: 8000, shiftCueEnabled: true, shiftPhase: 'shift', effectiveTargetRpm: 7000 }), 'redline')
})

test('resolveSignal keeps purple until RPM passes a shift target at the limiter', () => {
  // Target 7950 lies above 97% (7760), so red waits for the target.
  const atLimiter = { rpmMax: 8000, shiftCueEnabled: true, shiftPhase: 'shift', effectiveTargetRpm: 7950 }
  assert.equal(resolveSignal({ ...atLimiter, rpm: 7800 }), 'shift')
  assert.equal(resolveSignal({ ...atLimiter, rpm: 7950 }), 'redline')
  // Red never waits past the limiter itself.
  assert.equal(resolveSignal({ ...atLimiter, effectiveTargetRpm: 8400, rpm: 8000 }), 'redline')
  // Without the cue the target is ignored.
  assert.equal(resolveSignal({ ...atLimiter, shiftCueEnabled: false, rpm: 7800 }), 'redline')
})

test('resolveThresholdRpm is the Shift Light cue-on RPM while the cue is enabled', () => {
  assert.equal(resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: true, lightOnRpm: 6400, effectiveTargetRpm: 6500 }), 6400)
})

test('resolveThresholdRpm falls back to the effective target when lightOnRpm is missing', () => {
  assert.equal(resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: true, lightOnRpm: null, effectiveTargetRpm: 6500 }), 6500)
  assert.equal(resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: true, lightOnRpm: 0, effectiveTargetRpm: 6500 }), 6500)
})

test('resolveThresholdRpm is 97 percent of the limiter without the cue', () => {
  assert.equal(resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: false, lightOnRpm: 6400 }), 7760)
  assert.equal(resolveThresholdRpm({ rpmMax: 8000, usableCeiling: 7400, shiftCueEnabled: false }), 7178)
  assert.equal(resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: true }), 7760)
})

test('resolveThresholdRpm is null without a cue or limiter', () => {
  assert.equal(resolveThresholdRpm({ shiftCueEnabled: false }), null)
  assert.equal(resolveThresholdRpm(), null)
})

test('the Shift Bar fill runs from idle to the signal point', () => {
  // Cue at 6400 with idle 900: 3650 is halfway, (3650 - 900) / (6400 - 900) = 0.5.
  const cueThreshold = resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: true, lightOnRpm: 6400 })
  assert.equal(fillFraction({ rpm: 3650, rpmIdle: 900, thresholdRpm: cueThreshold }), 0.5)
  // Without the cue the bar fills to 97% of the limiter, so the cue point is past it.
  const limiterThreshold = resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: false, lightOnRpm: 6400 })
  assert.equal(fillFraction({ rpm: 6400, rpmIdle: 900, thresholdRpm: limiterThreshold }) < 1, true)
})

test('filledSegments floors the fraction to whole segments', () => {
  assert.equal(filledSegments(0), 0)
  assert.equal(filledSegments(0.5), 18)
  assert.equal(filledSegments(0.999), 35)
  assert.equal(filledSegments(1), SEGMENT_COUNT)
  assert.equal(filledSegments(1.5), SEGMENT_COUNT)
  assert.equal(filledSegments(-1), 0)
  assert.equal(filledSegments(Number.NaN), 0)
  assert.equal(filledSegments(undefined), 0)
  // Float error must not drop a segment: 10 / 36 * 36 is not exactly 10.
  assert.equal(filledSegments(10 / 36), 10)
})

test('segments alternate apex up and apex down', () => {
  assert.equal(segmentTransform(0), null)
  assert.equal(segmentTransform(1), 'rotate(180 24 16)')
  assert.equal(segmentTransform(34), null)
  assert.equal(segmentTransform(35), 'rotate(180 24 16)')
})

test('overlay.js no longer uses the steady 85 percent redline threshold', () => {
  const overlay = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')
  assert.doesNotMatch(overlay, /REDLINE_RPM_FRACTION/)
  assert.doesNotMatch(overlay, /0\.85/)
  assert.doesNotMatch(overlay, /getShiftLightSignal|getRpmSignal|getLearnedShiftRpm/)
})

test('overlay.js drives the Gear block and the Shift Bar from the shared signal', () => {
  const overlay = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')
  assert.match(overlay, /const signal = DEMO_MODE \? demoSignal : getHudSignal\(telemetry\)/)
  assert.match(overlay, /renderShiftBar\(telemetry, signal\)/)
  assert.match(overlay, /thresholdRpm: getShiftBarThresholdRpm\(telemetry\)/)
  assert.match(overlay, /shiftCueEnabled: isShiftCueEnabled\(\)/)
  assert.match(overlay, /latestShiftLight\.lastKnownGear !== true/)
})

test('createShiftBar builds 36 triangle segments once in the segment container', () => {
  withFakeDocument(doc => {
    const { segments } = mountBar(doc)
    createShiftBar()
    assert.equal(segments.children.length, SEGMENT_COUNT)
    for (const segment of segments.children) {
      assert.equal(segment.getAttribute('class'), 'shift-bar__segment')
      assert.equal(segment.getAttribute('aria-hidden'), 'true')
      assert.equal(segment.children[0].children[0].getAttribute('class'), 'shift-bar__empty')
      assert.equal(segment.children[0].children[1].getAttribute('class'), 'shift-bar__fill')
    }
    assert.equal(segments.children[1].children[0].getAttribute('transform'), 'rotate(180 24 16)')
    assert.equal(segments.children[0].children[0].getAttribute('transform'), null)
  })
})

test('render lights segments for the fill and writes the signal attribute', () => {
  withFakeDocument(doc => {
    const { root, segments } = mountBar(doc)
    const bar = createShiftBar()
    assert.deepEqual(bar.render({ fraction: 0.5, signal: 'normal' }), {
      filledSegments: 18,
      segmentCount: SEGMENT_COUNT,
      signal: 'normal'
    })
    assert.equal(litCount(segments), 18)
    assert.equal(root.getAttribute('data-signal'), 'normal')
  })
})

test('render shows the whole row for redline and shift and writes the signal', () => {
  withFakeDocument(doc => {
    const { root, segments } = mountBar(doc)
    const bar = createShiftBar()
    bar.render({ fraction: 0.2, signal: 'normal' })
    bar.render({ fraction: 0.2, signal: 'redline' })
    assert.equal(litCount(segments), SEGMENT_COUNT)
    assert.equal(root.getAttribute('data-signal'), 'redline')
    bar.render({ fraction: 0.2, signal: 'shift' })
    assert.equal(litCount(segments), SEGMENT_COUNT)
    assert.equal(root.getAttribute('data-signal'), 'shift')
  })
})

test('an unknown signal value renders as normal', () => {
  withFakeDocument(doc => {
    const { root } = mountBar(doc)
    const bar = createShiftBar()
    assert.equal(bar.render({ fraction: 1, signal: 'purple' }).signal, 'normal')
    assert.equal(root.getAttribute('data-signal'), 'normal')
  })
})

test('render writes nothing when the fill and signal are unchanged', () => {
  withFakeDocument(doc => {
    mountBar(doc)
    const bar = createShiftBar()
    bar.render({ fraction: 0.5, signal: 'normal' })
    const before = doc.counter.writes
    bar.render({ fraction: 0.5, signal: 'normal' })
    bar.render({ fraction: 0.5001, signal: 'normal' })
    assert.equal(doc.counter.writes, before)
  })
})

test('render changes only the segments whose state differs', () => {
  withFakeDocument(doc => {
    const { segments } = mountBar(doc)
    const bar = createShiftBar()
    bar.render({ fraction: 10 / 36, signal: 'normal' })
    const before = doc.counter.writes
    bar.render({ fraction: 12 / 36, signal: 'normal' })
    assert.equal(doc.counter.writes - before, 2)
    assert.equal(litCount(segments), 12)
    const beforeReturn = doc.counter.writes
    bar.render({ fraction: 0, signal: 'normal' })
    assert.equal(doc.counter.writes - beforeReturn, 12)
    assert.equal(litCount(segments), 0)
  })
})

test('the bar returns to the fill after a redline or shift signal ends', () => {
  withFakeDocument(doc => {
    const { root, segments } = mountBar(doc)
    const bar = createShiftBar()
    bar.render({ fraction: 0.5, signal: 'shift' })
    assert.equal(litCount(segments), SEGMENT_COUNT)
    bar.render({ fraction: 0.5, signal: 'normal' })
    assert.equal(litCount(segments), 18)
    assert.equal(root.getAttribute('data-signal'), 'normal')
  })
})

test('render without a container or root does not throw and reports state', () => {
  const bar = createShiftBar({ root: null, segments: null })
  assert.deepEqual(bar.render({ fraction: 1, signal: 'redline' }), {
    filledSegments: SEGMENT_COUNT,
    segmentCount: SEGMENT_COUNT,
    signal: 'redline'
  })
})

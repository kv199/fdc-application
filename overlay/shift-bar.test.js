const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  SEGMENT_COUNT,
  SHIFT_FALLBACK_FRACTION,
  createShiftBar,
  fillFraction,
  filledSegments,
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

test('fillFraction is 0 at idle and 1 at the learned shift RPM', () => {
  assert.equal(fillFraction({ rpm: 900, rpmIdle: 900, rpmMax: 8000, shiftRpm: 6500 }), 0)
  assert.equal(fillFraction({ rpm: 6500, rpmIdle: 900, rpmMax: 8000, shiftRpm: 6500 }), 1)
})

test('fillFraction clamps to 0..1 below idle and above the threshold', () => {
  assert.equal(fillFraction({ rpm: 300, rpmIdle: 900, rpmMax: 8000, shiftRpm: 6500 }), 0)
  assert.equal(fillFraction({ rpm: 9000, rpmIdle: 900, rpmMax: 8000, shiftRpm: 6500 }), 1)
})

test('fillFraction uses the learned shift RPM when one is supplied', () => {
  // (3450 - 900) / (6000 - 900) = 0.5, not the 85% fallback.
  assert.equal(fillFraction({ rpm: 3450, rpmIdle: 900, rpmMax: 8000, shiftRpm: 6000 }), 0.5)
})

test('fillFraction falls back to 85% of max RPM without a learned shift RPM', () => {
  assert.equal(SHIFT_FALLBACK_FRACTION, 0.85)
  // Threshold 0.85 * 8000 = 6800, so (3850 - 900) / (6800 - 900) = 0.5.
  assert.equal(fillFraction({ rpm: 3850, rpmIdle: 900, rpmMax: 8000, shiftRpm: null }), 0.5)
  assert.equal(fillFraction({ rpm: 3850, rpmIdle: 900, rpmMax: 8000 }), 0.5)
  assert.equal(fillFraction({ rpm: 3850, rpmIdle: 900, rpmMax: 8000, shiftRpm: 0 }), 0.5)
})

test('fillFraction treats a missing idle RPM as zero', () => {
  // 4250 / (0.85 * 8000) = 0.625.
  assert.equal(fillFraction({ rpm: 4250, rpmMax: 8000 }), 0.625)
})

test('fillFraction returns 0 when RPM or every threshold source is missing', () => {
  assert.equal(fillFraction({ rpm: null, rpmIdle: 900, rpmMax: 8000, shiftRpm: 6500 }), 0)
  assert.equal(fillFraction({ rpm: undefined, rpmMax: 8000 }), 0)
  assert.equal(fillFraction({ rpm: 5000, rpmIdle: 900 }), 0)
  assert.equal(fillFraction({ rpm: 5000, rpmIdle: 900, rpmMax: 0 }), 0)
  assert.equal(fillFraction(), 0)
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

test('the module keeps the overlay redline fraction in step', () => {
  const overlay = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')
  const match = overlay.match(/const REDLINE_RPM_FRACTION = ([0-9.]+)/)
  assert.ok(match, 'overlay.js must declare REDLINE_RPM_FRACTION')
  assert.equal(Number(match[1]), SHIFT_FALLBACK_FRACTION)
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

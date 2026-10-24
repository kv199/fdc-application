const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { readHudScripts } = require('../tools/test-sources.cjs')

const {
  LIMITER_RPM_FRACTION,
  LIMITER_ESTIMATE_FRACTION,
  SEGMENT_COUNT,
  createShiftBar,
  fillFraction,
  filledSegments,
  limiterRpm,
  resolveSignal,
  resolveThresholdRpm,
  segmentGeometry
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
      const values = new Map()
      this.style = {
        setProperty(name, value) {
          counter.writes += 1
          values.set(name, String(value))
        },
        getPropertyValue(name) {
          return values.get(name) ?? ''
        }
      }
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

// Segments are <g> elements inside the single row svg in the container.
function litCount(segments) {
  return segments.children
    .flatMap(row => row.children)
    .filter(segment => segment.classList.contains('is-filled')).length
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

test('limiterRpm prefers a measured limiter and otherwise estimates 89 percent of the game max RPM', () => {
  assert.equal(limiterRpm({ usableCeiling: 7400, rpmMax: 8000 }), 7400)
  assert.equal(limiterRpm({ provisionalCeiling: 7300, rpmMax: 8000 }), 7300)
  assert.equal(limiterRpm({ usableCeiling: 7400, provisionalCeiling: 7300, rpmMax: 8000 }), 7400)
  assert.ok(Math.abs((limiterRpm({ usableCeiling: null, rpmMax: 8000 })) - (8000 * LIMITER_ESTIMATE_FRACTION)) < 1e-6)
  assert.ok(Math.abs((limiterRpm({ usableCeiling: 0, rpmMax: 8000 })) - (7120)) < 1e-6)
  assert.ok(Math.abs((limiterRpm({ usableCeiling: -5, rpmMax: 8000 })) - (7120)) < 1e-6)
  assert.ok(Math.abs((limiterRpm({ usableCeiling: '', rpmMax: 8000 })) - (7120)) < 1e-6)
  assert.equal(limiterRpm({ usableCeiling: null, rpmMax: null }), null)
  assert.equal(limiterRpm(), null)
  assert.equal(LIMITER_ESTIMATE_FRACTION, 0.89)
})

test('the limiter fraction is 97 percent', () => {
  assert.equal(LIMITER_RPM_FRACTION, 0.97)
})

test('resolveSignal is normal below the limiter flash point and shows no approach signal', () => {
  // Before any limiter hit the limiter is estimated at 89% of 8000 = 7120, so red starts at 6906.4.
  assert.equal(resolveSignal({ rpm: 6800, rpmMax: 8000 }), 'normal')
  // The approach phase is no signal of its own.
  assert.equal(resolveSignal({ rpm: 6800, rpmMax: 8000, shiftPhase: 'approach', shiftCueEnabled: true }), 'normal')
  assert.equal(resolveSignal({ rpm: 6906, rpmMax: 8000 }), 'normal')
})

test('resolveSignal is redline from 97 percent of the limiter', () => {
  assert.equal(resolveSignal({ rpm: 6907, rpmMax: 8000 }), 'redline')
  assert.equal(resolveSignal({ rpm: 7178, rpmMax: 8000, usableCeiling: 7400 }), 'redline')
  assert.equal(resolveSignal({ rpm: 8100, rpmMax: 8000 }), 'redline')
})

test('resolveSignal measures redline against the usable ceiling, then against the estimate', () => {
  // 97% of 7400 = 7178: the measured ceiling wins over the estimate from the game's 8000.
  assert.equal(resolveSignal({ rpm: 7178, rpmMax: 8000, usableCeiling: 7400 }), 'redline')
  assert.equal(resolveSignal({ rpm: 7177, rpmMax: 8000, usableCeiling: 7400 }), 'normal')
  assert.equal(resolveSignal({ rpm: 6907, rpmMax: 8000, usableCeiling: null }), 'redline')
  assert.equal(resolveSignal({ rpm: 6800, rpmMax: 8000, usableCeiling: 0 }), 'normal')
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

test('resolveSignal keeps purple until RPM passes a shift target at a measured limiter', () => {
  // Measured limiter 8000: target 7950 lies above 97% (7760), so red waits for the target.
  const atLimiter = { rpmMax: 8500, usableCeiling: 8000, shiftCueEnabled: true, shiftPhase: 'shift', effectiveTargetRpm: 7950 }
  assert.equal(resolveSignal({ ...atLimiter, rpm: 7800 }), 'shift')
  assert.equal(resolveSignal({ ...atLimiter, rpm: 7950 }), 'redline')
  // Red never waits past the limiter itself.
  assert.equal(resolveSignal({ ...atLimiter, effectiveTargetRpm: 8400, rpm: 8000 }), 'redline')
  // Without the cue the target is ignored.
  assert.equal(resolveSignal({ ...atLimiter, shiftCueEnabled: false, rpm: 7800 }), 'redline')
})

test('with only the estimate red does not wait for the unreached game max target', () => {
  // Before any hit the cue target is the game's 10000; red starts at 97% of the 8900 estimate.
  const first = { rpmMax: 10000, shiftCueEnabled: true, shiftPhase: 'normal', effectiveTargetRpm: 10000 }
  assert.equal(resolveSignal({ ...first, rpm: 8600 }), 'normal')
  assert.equal(resolveSignal({ ...first, rpm: 8634 }), 'redline')
})

test('with only the estimate red waits for a learned shift target', () => {
  // Game max 10000, estimated limiter 8900, 97% is 8633. A learned target of 8858
  // with the cue on at 8658 must show purple before red.
  const learned = { rpmMax: 10000, shiftCueEnabled: true, shiftPhase: 'shift', effectiveTargetRpm: 8858, learnedTarget: true }
  assert.equal(resolveSignal({ ...learned, rpm: 8658 }), 'shift')
  assert.equal(resolveSignal({ ...learned, rpm: 8700 }), 'shift')
  assert.equal(resolveSignal({ ...learned, rpm: 8857 }), 'shift')
  assert.equal(resolveSignal({ ...learned, rpm: 8858 }), 'redline')
})

test('with only the estimate an unlearned target keeps red at 97 percent of the estimate', () => {
  const unlearned = { rpmMax: 10000, shiftCueEnabled: true, shiftPhase: 'shift', effectiveTargetRpm: 8858 }
  assert.equal(resolveSignal({ ...unlearned, rpm: 8632 }), 'shift')
  assert.equal(resolveSignal({ ...unlearned, rpm: 8634 }), 'redline')
  assert.equal(resolveSignal({ ...unlearned, learnedTarget: false, rpm: 8700 }), 'redline')
})

test('a learned target above the estimated limiter is capped at the estimated limiter', () => {
  const above = { rpmMax: 10000, shiftCueEnabled: true, shiftPhase: 'shift', effectiveTargetRpm: 9200, learnedTarget: true }
  assert.equal(resolveSignal({ ...above, rpm: 8899 }), 'shift')
  assert.equal(resolveSignal({ ...above, rpm: 8900 }), 'redline')
})

test('a learned target is ignored while the cue is disabled', () => {
  const disabled = { rpmMax: 10000, shiftCueEnabled: false, shiftPhase: 'shift', effectiveTargetRpm: 8858, learnedTarget: true }
  assert.equal(resolveSignal({ ...disabled, rpm: 8632 }), 'normal')
  assert.equal(resolveSignal({ ...disabled, rpm: 8634 }), 'redline')
})

test('resolveThresholdRpm is the Shift Light cue-on RPM while the cue is enabled', () => {
  assert.equal(resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: true, lightOnRpm: 6400, effectiveTargetRpm: 6500 }), 6400)
})

test('resolveThresholdRpm falls back to the effective target when lightOnRpm is missing', () => {
  assert.equal(resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: true, lightOnRpm: null, effectiveTargetRpm: 6500 }), 6500)
  assert.equal(resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: true, lightOnRpm: 0, effectiveTargetRpm: 6500 }), 6500)
})

test('resolveThresholdRpm is where red starts without the cue', () => {
  assert.ok(Math.abs((resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: false, lightOnRpm: 6400 })) - (8000 * 0.89 * 0.97)) < 1e-6)
  assert.equal(resolveThresholdRpm({ rpmMax: 8000, usableCeiling: 7400, shiftCueEnabled: false }), 7178)
  assert.ok(Math.abs((resolveThresholdRpm({ rpmMax: 8000, shiftCueEnabled: true })) - (8000 * 0.89 * 0.97)) < 1e-6)
})

test('resolveThresholdRpm never fills later than red starts', () => {
  // Before any hit the cue-on point (game max minus lead) is unreachable; the bar is full where red starts.
  assert.ok(Math.abs((resolveThresholdRpm({ rpmMax: 10000, shiftCueEnabled: true, lightOnRpm: 9500 })) - (10000 * 0.89 * 0.97)) < 1e-6)
  // With an earlier learned cue the bar fills to the cue.
  assert.equal(resolveThresholdRpm({ rpmMax: 10000, usableCeiling: 9190, shiftCueEnabled: true, lightOnRpm: 8300, effectiveTargetRpm: 8500 }), 8300)
})

test('resolveThresholdRpm uses the redline that waits for a learned target', () => {
  // Estimated limiter 8900: with a learned target of 8858 red starts at 8858, so the bar fills to the 8658 cue.
  const learned = { rpmMax: 10000, shiftCueEnabled: true, lightOnRpm: 8658, effectiveTargetRpm: 8858 }
  assert.equal(resolveThresholdRpm({ ...learned, learnedTarget: true }), 8658)
  // Unlearned, red starts at 97% of the estimate, before the cue.
  assert.ok(Math.abs(resolveThresholdRpm(learned) - (10000 * 0.89 * 0.97)) < 1e-6)
  // A learned cue past the capped redline still fills by the time red starts.
  assert.equal(resolveThresholdRpm({ rpmMax: 10000, shiftCueEnabled: true, lightOnRpm: 9000, effectiveTargetRpm: 9200, learnedTarget: true }), 8900)
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

// The segment box and path as the formulas give them, for a row of this width in device pixels.
function expectedSegment(width, height) {
  const unit = width / 410
  const box = (width + 35 * 1.5 * unit) / 36
  const shapeWidth = box * 2 / 3
  const shapeHeight = Math.min(height, Math.round(box * 4 / 3))
  const round3 = value => Number(value.toFixed(3))
  return {
    box,
    shapeWidth,
    path: `M${round3(box / 3)} 0 H${round3(box)} L${round3(shapeWidth)} ${shapeHeight} H0 Z`
  }
}

test('segmentGeometry places 36 equal parallelograms at whole device-pixel steps', () => {
  const geometry = segmentGeometry(695, 33)
  const expected = expectedSegment(695, 33)
  // 0.5 bar at HUD scale 2: step 19 device px, 2 px top margin.
  assert.equal(geometry.step, 19)
  assert.equal(geometry.left, 4)
  assert.equal(geometry.top, 2)
  assert.equal(geometry.path, 'M7.259 0 H21.778 L14.518 29 H0 Z')
  assert.equal(geometry.path, expected.path)
  for (let index = 0; index < SEGMENT_COUNT; index += 1) {
    assert.ok(Number.isInteger(geometry.left + index * geometry.step))
  }
  // The horizontal gap between a segment's bottom-right corner and the next segment's start is the same everywhere.
  const gaps = []
  for (let index = 0; index < SEGMENT_COUNT - 1; index += 1) {
    const end = geometry.left + index * geometry.step + expected.shapeWidth
    gaps.push(geometry.left + (index + 1) * geometry.step - end)
  }
  for (const gap of gaps) assert.ok(Math.abs(gap - (geometry.step - expected.shapeWidth)) < 1e-9)
})

test('segmentGeometry steps 29 device px at the 0.75 bar and 38 at 1390 px', () => {
  const geometry = segmentGeometry(1043, 33)
  const expected = expectedSegment(1043, 33)
  assert.equal(geometry.step, 29)
  assert.equal(geometry.path, 'M10.894 0 H32.682 L21.788 33 H0 Z')
  assert.equal(geometry.path, expected.path)
  assert.equal(segmentGeometry(1390, 66).step, 38)
  assert.equal(segmentGeometry(1390, 66).path, 'M14.518 0 H43.555 L29.037 58 H0 Z')
})

test('segmentGeometry is null unless width and height are finite and above zero', () => {
  assert.equal(segmentGeometry(0, 33), null)
  assert.equal(segmentGeometry(-5, 33), null)
  assert.equal(segmentGeometry(Number.NaN, 33), null)
  assert.equal(segmentGeometry(Number.POSITIVE_INFINITY, 33), null)
  assert.equal(segmentGeometry(695, 0), null)
  assert.equal(segmentGeometry(695, -1), null)
  assert.equal(segmentGeometry(695, Number.NaN), null)
  assert.equal(segmentGeometry(), null)
})

test('overlay.js no longer uses the steady 85 percent redline threshold', () => {
  const overlay = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')
  assert.doesNotMatch(overlay, /REDLINE_RPM_FRACTION/)
  assert.doesNotMatch(overlay, /0\.85/)
  assert.doesNotMatch(overlay, /getShiftLightSignal|getRpmSignal|getLearnedShiftRpm/)
})

test('the HUD page scripts drive the Gear block and the Shift Bar from the shared signal', () => {
  const overlay = readHudScripts()
  assert.match(overlay, /const signal = DEMO_MODE \? demoSignal : getHudSignal\(telemetry\)/)
  assert.match(overlay, /renderShiftBar\(telemetry, signal\)/)
  assert.match(overlay, /thresholdRpm: getShiftBarThresholdRpm\(telemetry\)/)
  assert.match(overlay, /shiftCueEnabled: isShiftCueEnabled\(\)/)
  assert.match(overlay, /latestShiftLight\.lastKnownGear !== true/)
})

test('createShiftBar builds one row svg of 36 segment groups in the segment container', () => {
  withFakeDocument(doc => {
    const { segments } = mountBar(doc)
    createShiftBar()
    assert.equal(segments.children.length, 1)
    const row = segments.children[0]
    assert.equal(row.tagName, 'svg')
    assert.equal(row.getAttribute('class'), 'shift-bar__row')
    assert.equal(row.getAttribute('aria-hidden'), 'true')
    assert.equal(row.getAttribute('preserveAspectRatio'), 'none')
    assert.equal(row.children.length, SEGMENT_COUNT)
    for (const segment of row.children) {
      assert.equal(segment.tagName, 'g')
      assert.equal(segment.getAttribute('class'), 'shift-bar__segment')
      assert.equal(segment.children.length, 2)
      assert.equal(segment.children[0].tagName, 'path')
      assert.equal(segment.children[0].getAttribute('class'), 'shift-bar__empty')
      assert.equal(segment.children[1].tagName, 'path')
      assert.equal(segment.children[1].getAttribute('class'), 'shift-bar__fill')
    }
  })
})

test('layout sets the row viewBox and places each segment at its integer step', () => {
  withFakeDocument(doc => {
    const { segments } = mountBar(doc)
    const bar = createShiftBar()
    const row = segments.children[0]
    const geometry = bar.layout(695, 33)
    assert.equal(geometry.step, 19)
    assert.equal(row.getAttribute('viewBox'), '0 0 695 33')
    // Without a device pixel ratio the CSS size is the device size, so the SVG is not stretched.
    assert.equal(row.style.getPropertyValue('width'), '695px')
    assert.equal(row.style.getPropertyValue('height'), '33px')
    row.children.forEach((segment, index) => {
      assert.equal(segment.getAttribute('transform'), `translate(${geometry.left + 19 * index} ${geometry.top})`)
      assert.equal(segment.children[0].getAttribute('d'), geometry.path)
      assert.equal(segment.children[1].getAttribute('d'), geometry.path)
    })
  })
})

test('layout sizes the row in CSS px from device px at the display scale', () => {
  const previous = globalThis.devicePixelRatio
  globalThis.devicePixelRatio = 1.25
  try {
    withFakeDocument(doc => {
      const { segments } = mountBar(doc)
      const bar = createShiftBar()
      const row = segments.children[0]
      bar.layout(870, 41)
      assert.equal(row.getAttribute('viewBox'), '0 0 870 41')
      assert.equal(row.style.getPropertyValue('width'), '696px')
      assert.equal(row.style.getPropertyValue('height'), '32.8px')
      // The same device size at another display scale is written again.
      const before = doc.counter.writes
      globalThis.devicePixelRatio = 1.5
      bar.layout(870, 41)
      assert.equal(row.style.getPropertyValue('width'), '580px')
      assert.ok(doc.counter.writes > before)
    })
  } finally {
    if (previous === undefined) delete globalThis.devicePixelRatio
    else globalThis.devicePixelRatio = previous
  }
})

test('layout writes nothing for an unchanged size and returns null for an empty box', () => {
  withFakeDocument(doc => {
    mountBar(doc)
    const bar = createShiftBar()
    bar.layout(695, 33)
    const before = doc.counter.writes
    bar.layout(695, 33)
    assert.equal(doc.counter.writes, before)
    assert.equal(bar.layout(0, 33), null)
    assert.equal(doc.counter.writes, before)
    bar.layout(1043, 33)
    assert.ok(doc.counter.writes > before)
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

test('a provisional ceiling sets red and the fill until the usable ceiling is trusted', () => {
  // Real limiter 9195 under a reported 10000: the 8900 estimate turns red at 8633, a first hit refines it.
  assert.equal(resolveSignal({ rpm: 8600, rpmMax: 10000 }), 'normal')
  assert.equal(resolveSignal({ rpm: 8900, rpmMax: 10000 }), 'redline')
  assert.equal(resolveSignal({ rpm: 8920, rpmMax: 10000, provisionalCeiling: 9195 }), 'redline')
  assert.equal(resolveSignal({ rpm: 8900, rpmMax: 10000, provisionalCeiling: 9195 }), 'normal')
  assert.equal(resolveSignal({ rpm: 8920, rpmMax: 10000, provisionalCeiling: 9300 }), 'normal')
  assert.equal(resolveThresholdRpm({ rpmMax: 10000, provisionalCeiling: 9195 }), 9195 * LIMITER_RPM_FRACTION)
  // A trusted ceiling wins over the provisional one.
  assert.equal(resolveThresholdRpm({ rpmMax: 10000, usableCeiling: 9000, provisionalCeiling: 9195 }), 9000 * LIMITER_RPM_FRACTION)
})

test('the Shift Bar CSS and layout share the 434 px design geometry at the 736 px base', () => {
  const css = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8')
  const layout = fs.readFileSync(path.join(__dirname, 'hud-layout.js'), 'utf8')
  // Design units (px at 434 wide): 12 px side padding leaves 410 for the row, and 36 boxes overlap by 1.5.
  const unitsPerDesignPx = 736 / 434
  const segmentWidth = (410 + 35 * 1.5) / 36
  const baseHeight = (16 + 1.5 * segmentWidth) * unitsPerDesignPx
  assert.ok(Math.abs(baseHeight - 60) < 0.25, `base height ${baseHeight} rounds to 60`)
  // The segments fit inside the vertical padding.
  assert.ok(1.5 * segmentWidth * unitsPerDesignPx <= 60 - 16 * unitsPerDesignPx)
  assert.match(layout, /const SHIFT_BAR_BASE_HEIGHT = 60\n/)
  assert.match(css, /--shift-bar-unit: calc\(736px \/ 434 \* var\(--shift-bar-scale\)\);/)
  assert.match(css, /padding: calc\(8 \* var\(--shift-bar-unit\)\) calc\(12 \* var\(--shift-bar-unit\)\);/)
  assert.match(css, /height: calc\(60px \* var\(--hud-scale\) \* var\(--shift-bar-user-scale, 0\.5\)\);/)
  assert.match(css, /\.shift-bar__empty \{\s*fill: var\(--hud-shift-empty\);\s*stroke: none;\s*\}/)
  // The row is one SVG sized to the container; segments are positioned in script, not by CSS flex.
  assert.match(css, /\.shift-bar__row \{\s*display: block;\s*width: 100%;\s*height: 100%;\s*overflow: visible;\s*\}/)
  assert.doesNotMatch(css, /\.shift-bar__segment \{/)
  assert.doesNotMatch(css, /\.shift-bar__segment \+ \.shift-bar__segment/)
})

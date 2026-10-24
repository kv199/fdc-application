const assert = require('node:assert/strict')
const test = require('node:test')

const BrakeMarks = require('./brake-marks.js')

function createStorage(initialValue = null) {
  let value = initialValue
  return {
    getItem: key => key === BrakeMarks.STORAGE_KEY ? value : null,
    setItem: (key, nextValue) => {
      if (key === BrakeMarks.STORAGE_KEY) value = nextValue
    },
    value: () => value
  }
}

test('uses the fresh brake marks storage key and the agreed constants', () => {
  assert.equal(BrakeMarks.STORAGE_KEY, 'fdc.brake-marks.v1')
  assert.equal(BrakeMarks.MIN_PERCENT, 5)
  assert.equal(BrakeMarks.MAX_PERCENT, 100)
  assert.equal(BrakeMarks.PERCENT_STEP, 5)
  assert.equal(BrakeMarks.PEAK_START_LEVEL, 0.05)
  assert.equal(BrakeMarks.PEAK_MERGE_GAP_MS, 300)
  assert.equal(BrakeMarks.PEAK_MIN_STOP_MS, 200)
})

test('defaults both marks to off with a 70 percent target', () => {
  assert.deepEqual(BrakeMarks.DEFAULTS, { targetEnabled: false, targetPercent: 70, peakEnabled: false })
  assert.equal(Object.isFrozen(BrakeMarks.DEFAULTS), true)
  assert.deepEqual(BrakeMarks.read(createStorage()), { targetEnabled: false, targetPercent: 70, peakEnabled: false })
})

test('normalizes the target to 5 percent steps clamped to 5..100', () => {
  assert.equal(BrakeMarks.normalize({ targetPercent: 72 }).targetPercent, 70)
  assert.equal(BrakeMarks.normalize({ targetPercent: 73 }).targetPercent, 75)
  assert.equal(BrakeMarks.normalize({ targetPercent: 12.5 }).targetPercent, 15)
  assert.equal(BrakeMarks.normalize({ targetPercent: '42' }).targetPercent, 40)
  assert.equal(BrakeMarks.normalize({ targetPercent: 2 }).targetPercent, 5)
  assert.equal(BrakeMarks.normalize({ targetPercent: -40 }).targetPercent, 5)
  assert.equal(BrakeMarks.normalize({ targetPercent: 101 }).targetPercent, 100)
  assert.equal(BrakeMarks.normalize({ targetPercent: 999 }).targetPercent, 100)
})

test('falls back to the 70 percent target for missing or non-numeric values', () => {
  for (const targetPercent of [undefined, null, '', '   ', 'high', NaN, Infinity, {}, [], true]) {
    assert.equal(BrakeMarks.normalize({ targetPercent }).targetPercent, 70, String(targetPercent))
  }
})

test('turns the marks on only for a literal true', () => {
  assert.deepEqual(BrakeMarks.normalize({ targetEnabled: true, peakEnabled: true }), {
    targetEnabled: true,
    targetPercent: 70,
    peakEnabled: true
  })
  for (const flag of ['true', 1, 'yes', null, undefined]) {
    assert.equal(BrakeMarks.normalize({ targetEnabled: flag }).targetEnabled, false, String(flag))
    assert.equal(BrakeMarks.normalize({ peakEnabled: flag }).peakEnabled, false, String(flag))
  }
})

test('accepts null and garbage candidates and returns the defaults', () => {
  for (const candidate of [null, undefined, 0, 'brake', [], () => {}]) {
    assert.deepEqual(BrakeMarks.normalize(candidate), { targetEnabled: false, targetPercent: 70, peakEnabled: false })
  }
})

test('reads back exactly what was written and writes a normalized record', () => {
  const storage = createStorage()
  const written = BrakeMarks.write({ targetEnabled: true, targetPercent: 43, peakEnabled: true }, storage)

  assert.deepEqual(written, { targetEnabled: true, targetPercent: 45, peakEnabled: true })
  assert.deepEqual(JSON.parse(storage.value()), written)
  assert.deepEqual(BrakeMarks.read(storage), written)
})

test('falls back to the defaults when the stored record is malformed', () => {
  assert.deepEqual(BrakeMarks.read(createStorage('{not-json')), BrakeMarks.DEFAULTS)
  assert.deepEqual(BrakeMarks.read(createStorage(JSON.stringify({ targetPercent: 'x', targetEnabled: 1 }))), BrakeMarks.DEFAULTS)
})

test('ignores storage failures on write and read', () => {
  const failing = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') }
  }
  assert.deepEqual(BrakeMarks.write({ targetEnabled: true }, failing), { targetEnabled: true, targetPercent: 70, peakEnabled: false })
  assert.deepEqual(BrakeMarks.read(failing), BrakeMarks.DEFAULTS)
})

// Feeds one sample per entry, each as [timestampMs, brake], with a live race and one car.
function feed(tracker, samples, carKey = 'car-1') {
  let peak = null
  for (const [timestampMs, brake] of samples) {
    peak = tracker.update({ brake, timestampMs, isRaceOn: true, carKey })
  }
  return peak
}

test('shows no peak until braking reaches the start level', () => {
  const tracker = BrakeMarks.createPeakTracker()
  assert.equal(tracker.peak(), null)
  assert.equal(feed(tracker, [[0, 0], [100, 0.049], [200, 0.049], [300, 0.049]]), null)

  // Exactly 0.05 starts a stop, and it is confirmed 200 ms after its first braking sample.
  assert.equal(feed(tracker, [[400, 0.05], [600, 0.05]]), 0.05)
  assert.equal(tracker.peak(), 0.05)
})

test('keeps the previous peak while a new stop is unconfirmed, then rises live once confirmed', () => {
  const tracker = BrakeMarks.createPeakTracker()
  feed(tracker, [[0, 0.5], [200, 0.5]])
  assert.equal(tracker.peak(), 0.5)

  // A new stop below its confirmation time keeps the displayed peak.
  feed(tracker, [[1000, 0.2]])
  assert.equal(feed(tracker, [[1100, 0.9]]), 0.5)

  // Once the stop lasts 200 ms, its running max is shown and rises live.
  assert.equal(feed(tracker, [[1200, 0.3]]), 0.9)
  assert.equal(feed(tracker, [[1250, 0.95]]), 0.95)
  assert.equal(feed(tracker, [[1300, 0.4]]), 0.95)
})

test('a release shorter than 300 ms stays in the same stop', () => {
  const tracker = BrakeMarks.createPeakTracker()
  // The first part of the stop has the highest brake. The 299 ms release keeps the stop
  // alive, so the confirmed peak still includes it.
  assert.equal(feed(tracker, [[0, 0.8], [150, 0], [299, 0.1]]), 0.8)
})

test('a release of 300 ms or more ends the stop', () => {
  const tracker = BrakeMarks.createPeakTracker()
  // The new stop starts at 300 ms, so the 0.8 stop was never merged with it. It was
  // unconfirmed and is discarded, so no peak is shown.
  assert.equal(feed(tracker, [[0, 0.8], [150, 0], [300, 0.1]]), null)
  assert.equal(tracker.peak(), null)
})

test('a long release ends a confirmed stop, and its peak stays until a new stop is confirmed', () => {
  const tracker = BrakeMarks.createPeakTracker()
  assert.equal(feed(tracker, [[0, 0.8], [200, 0.8]]), 0.8)
  assert.equal(feed(tracker, [[400, 0], [500, 0]]), 0.8)

  // A new stop at 700 ms starts unconfirmed, so the previous peak stays.
  assert.equal(feed(tracker, [[700, 0.3]]), 0.8)
  assert.equal(feed(tracker, [[850, 0.3]]), 0.8)
})

test('a short tap is ignored and keeps the previous peak', () => {
  const tracker = BrakeMarks.createPeakTracker()
  feed(tracker, [[0, 0.5], [200, 0.5]])
  assert.equal(tracker.peak(), 0.5)

  // A single sample of 0.9 is a tap. It ends after the release gap without being confirmed.
  assert.equal(feed(tracker, [[700, 0.9], [1100, 0]]), 0.5)

  // A tap of 150 ms (under 200 ms) is also discarded, even at a high brake.
  assert.equal(feed(tracker, [[1300, 0.95], [1450, 0.95], [1800, 0]]), 0.5)
  assert.equal(tracker.peak(), 0.5)
})

test('a new confirmed stop replaces the old peak', () => {
  const tracker = BrakeMarks.createPeakTracker()
  feed(tracker, [[0, 0.5], [200, 0.5]])
  feed(tracker, [[600, 0]])

  // The new stop is unconfirmed at 700 ms, so the old peak stays.
  assert.equal(feed(tracker, [[700, 0.9]]), 0.5)
  // Confirmed at 900 ms: the new stop's running max replaces the old peak, even when it is lower.
  assert.equal(feed(tracker, [[900, 0.2]]), 0.9)
  assert.equal(tracker.peak(), 0.9)
})

test('a new confirmed stop can be lower than the old peak', () => {
  const tracker = BrakeMarks.createPeakTracker()
  feed(tracker, [[0, 0.9], [200, 0.9]])
  feed(tracker, [[600, 0]])
  assert.equal(feed(tracker, [[700, 0.3], [900, 0.3]]), 0.3)
})

test('resets to no peak when the race is not live', () => {
  const tracker = BrakeMarks.createPeakTracker()
  feed(tracker, [[0, 0.5], [200, 0.5]])
  assert.equal(tracker.peak(), 0.5)

  assert.equal(tracker.update({ brake: 0.6, timestampMs: 300, isRaceOn: false, carKey: 'car-1' }), null)
  assert.equal(tracker.peak(), null)

  // Live braking after the reset starts over, so the previous peak is not restored.
  assert.equal(feed(tracker, [[400, 0.2]]), null)
})

test('treats an isRaceOn value that is not exactly true as not live', () => {
  const tracker = BrakeMarks.createPeakTracker()
  feed(tracker, [[0, 0.5], [200, 0.5]])
  assert.equal(tracker.update({ brake: 0.5, timestampMs: 300, isRaceOn: 'true', carKey: 'car-1' }), null)
  assert.equal(tracker.peak(), null)
})

test('resets to no peak when the car identity changes', () => {
  const tracker = BrakeMarks.createPeakTracker()
  feed(tracker, [[0, 0.5], [200, 0.5]], 'car-1')
  assert.equal(tracker.peak(), 0.5)

  assert.equal(feed(tracker, [[300, 0]], 'car-2'), null)
  assert.equal(tracker.peak(), null)
})

test('a car change during an unconfirmed stop discards that stop', () => {
  const tracker = BrakeMarks.createPeakTracker()
  feed(tracker, [[0, 0.8]], 'car-1')
  assert.equal(feed(tracker, [[100, 0.8]], 'car-2'), null)
  // Counted from car-1's start at 0 ms this stop would be confirmed by 250 ms; counted
  // from the car-2 start at 100 ms it is only 150 ms long.
  assert.equal(feed(tracker, [[250, 0.8]], 'car-2'), null)
})

test('reset clears the displayed peak and any running stop', () => {
  const tracker = BrakeMarks.createPeakTracker()
  feed(tracker, [[0, 0.5], [200, 0.5]])
  tracker.reset()
  assert.equal(tracker.peak(), null)
  assert.equal(feed(tracker, [[400, 0.5]]), null)
})

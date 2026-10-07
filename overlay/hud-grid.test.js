const test = require('node:test')
const assert = require('node:assert/strict')
const grid = require('./hud-grid.js')

test('exports constants', () => {
  assert.equal(grid.MAJOR_DIVISIONS, 4)
  assert.equal(grid.MINOR_ROWS, 36)
  assert.equal(grid.SNAP_THRESHOLD, 8)
})

test('1920x1080: computes step, offset, and lines correctly', () => {
  const g = grid.computeGrid({ width: 1920, height: 1080 })

  assert.equal(g.step, 30)
  assert.equal(g.centerX, 960)
  assert.equal(g.centerY, 540)
  assert.equal(g.offsetX, 0)
  assert.equal(g.offsetY, 0)

  assert.deepEqual(g.majorX, [0, 480, 960, 1440, 1920])
  assert.deepEqual(g.majorY, [0, 270, 540, 810, 1080])

  // Minor lines are every 30px, starting from 0 to 1920 on X
  assert.equal(g.minorX[0], 0)
  assert.equal(g.minorX[g.minorX.length - 1], 1920)
  assert.equal(g.minorX.length, 65) // 0, 30, 60, ..., 1920 = 1920/30 + 1 = 65
  assert(g.minorX.includes(960)) // center is a minor line
  assert(g.minorX.every((line, i) => line % 30 === 0)) // all divisible by 30

  assert.equal(g.minorY[0], 0)
  assert.equal(g.minorY[g.minorY.length - 1], 1080)
  assert.equal(g.minorY.length, 37) // 0, 30, ..., 1080 = 1080/30 + 1 = 37
  assert(g.minorY.includes(540)) // center is a minor line
})

test('2560x1440: computes step 40', () => {
  const g = grid.computeGrid({ width: 2560, height: 1440 })

  assert.equal(g.step, 40)
  assert.equal(g.centerX, 1280)
  assert.equal(g.centerY, 720)
  assert.equal(g.offsetX, 0)
  assert.equal(g.offsetY, 0)

  assert.deepEqual(g.majorX, [0, 640, 1280, 1920, 2560])
  assert(g.minorX.includes(1280)) // center is a minor line
  assert(g.minorX.every((line, i) => line % 40 === 0))
})

test('3840x2160: computes step 60', () => {
  const g = grid.computeGrid({ width: 3840, height: 2160 })

  assert.equal(g.step, 60)
  assert.equal(g.centerX, 1920)
  assert.equal(g.centerY, 1080)
  assert.equal(g.offsetX, 0)
  assert.equal(g.offsetY, 0)

  assert.deepEqual(g.majorX, [0, 960, 1920, 2880, 3840])
})

test('1366x768 (odd size): handles non-zero offset', () => {
  const g = grid.computeGrid({ width: 1366, height: 768 })

  assert.equal(g.step, 21)
  assert.equal(g.centerX, 683)
  assert.equal(g.centerY, 384)
  // offsetX = ((683 % 21) + 21) % 21 = (11 + 21) % 21 = 11
  assert.equal(g.offsetX, 11)
  // offsetY = ((384 % 21) + 21) % 21 = (6 + 21) % 21 = 6
  assert.equal(g.offsetY, 6)

  assert.deepEqual(g.majorX, [0, 341.5, 683, 1024.5, 1366])

  // First minor line should be at offsetX = 11
  assert.equal(g.minorX[0], 11)
  // Center should be a minor line
  assert(g.minorX.includes(683))
  // All minor lines should differ by step
  for (let i = 1; i < g.minorX.length; i++) {
    assert.equal(g.minorX[i] - g.minorX[i - 1], 21)
  }
})

test('handles non-finite or zero dimensions as 1', () => {
  const g1 = grid.computeGrid({ width: 0, height: 100 })
  assert.equal(g1.centerX, 0.5)

  const g2 = grid.computeGrid({ width: -50, height: 100 })
  assert.equal(g2.centerX, 0.5)

  const g3 = grid.computeGrid({ width: Number.NaN, height: 100 })
  assert.equal(g3.centerX, 0.5)

  const g4 = grid.computeGrid({ width: 100, height: Number.Infinity })
  assert(g4.step >= 4)
})

test('snapRect: snaps left edge to major line', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block at left=960, width=30, top=200: left anchor is exactly on major line 960
  // Y anchors: 200, 225, 250 - all > 8 away from nearest lines (180, 210, 240, etc.)
  const rect = { left: 960, top: 200, width: 30, height: 50 }

  const result = grid.snapRect(rect, viewport)

  assert.equal(result.left, 960)
  assert.equal(result.top, 200)
  assert.equal(result.lineX, 960)
  assert.equal(result.lineY, null)
})

test('snapRect: snaps to minor line', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block at left=925, width=10, top=200: center at 930 (minor line), distance 0
  const rect = { left: 925, top: 200, width: 10, height: 50 }

  const result = grid.snapRect(rect, viewport)

  // Center anchor at 930 is exactly on the minor line 930
  // Anchors: 925, 930, 935. Best is (930, 930) at distance 0
  // new_left = 925 + (930 - 930) = 925
  assert.equal(result.left, 925)
  assert.equal(result.top, 200)
  assert.equal(result.lineX, 930)
  assert.equal(result.lineY, null)
})

test('snapRect: does not snap when distance exceeds threshold', () => {
  const viewport = { width: 1920, height: 1080 }
  // In the 1920x1080 grid with step 30, the farthest from any line is 15px.
  // So with threshold 3, we can find positions that don't snap.
  // Position 816: distance to 810 is 6, to 840 is 24
  // With threshold 3, neither snaps.
  const rect = { left: 816, top: 100, width: 1, height: 50 }
  const result = grid.snapRect(rect, viewport, 3)

  assert.equal(result.left, 816)
  assert.equal(result.lineX, null)
})

test('snapRect: snaps right edge to viewport edge', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block at left=1810, width=110: right edge at 1920, snaps to major line 1920
  const rect = { left: 1810, top: 100, width: 110, height: 50 }

  const result = grid.snapRect(rect, viewport)

  assert.equal(result.left, 1810 + (1920 - 1920))
  assert.equal(result.lineX, 1920)
})

test('snapRect: snaps center to major line', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block at left=910, width=100: center at 960 (major line), snaps to 960
  const rect = { left: 910, top: 100, width: 100, height: 50 }

  const result = grid.snapRect(rect, viewport)

  assert.equal(result.left, 910) // center is already at 960, no shift needed
  assert.equal(result.lineX, 960)
})

test('snapRect: snaps Y axis independently', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block at (903, 537): center at (928, 562)
  // X: center 928 is 32 away from 960, not within threshold 8
  // Y: center 562 is 22 away from 540, not within threshold 8
  // Let's use a better position: (903, 512)
  // X: center 928 is still 32 away
  // Y: center 537 is 3 away from 540 (snaps)
  const rect = { left: 903, top: 512, width: 50, height: 50 }

  const result = grid.snapRect(rect, viewport)

  // X axis: anchors at 903, 928, 953
  // 903 to 900: 3, 928 to 930: 2, 953 to 960: 7
  // Closest is 928 to 930 at distance 2, snaps to 930
  // new_left = 903 + (930 - 928) = 905
  // Y axis: anchors at 512, 537, 562
  // 512 to 510: 2, 537 to 540: 3, 562 to 570: 8
  // Closest is 512 to 510 at distance 2, snaps to 510
  // new_top = 512 + (510 - 512) = 510
  assert.equal(result.left, 905)
  assert.equal(result.top, 510)
  assert.equal(result.lineX, 930)
  assert.equal(result.lineY, 510)
})

test('snapRect: prefers major line on distance tie', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block where an anchor is equidistant from major and minor lines
  // At position 945: to 930 (minor): 15, to 960 (major): 15
  // With threshold=15, both are candidates, major (960) should be chosen
  const rect = { left: 945, top: 200, width: 0, height: 1 }

  const result = grid.snapRect(rect, viewport, 15)

  // All anchors at 945, equidistant from 930 and 960
  // Major line 960 is preferred
  // new_left = 945 + (960 - 945) = 960
  assert.equal(result.left, 960)
  assert.equal(result.lineX, 960)
})

test('snapRect: threshold 0 requires exact match', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block at left=960 (exactly on major line)
  const rect = { left: 960, top: 540, width: 100, height: 50 }

  const result = grid.snapRect(rect, viewport, 0)

  // Left anchor at 960 is exactly on 960 (major)
  assert.equal(result.left, 960)
  assert.equal(result.lineX, 960)
  // Top anchor at 540 is exactly on 540 (major)
  assert.equal(result.top, 540)
  assert.equal(result.lineY, 540)
})

test('snapRect: threshold 0 does not snap off-by-one', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block at left=961 (1px off major line)
  const rect = { left: 961, top: 100, width: 100, height: 50 }

  const result = grid.snapRect(rect, viewport, 0)

  // No anchor is exactly on a line
  assert.equal(result.left, 961)
  assert.equal(result.lineX, null)
})

test('snapRect: guards against non-finite input', () => {
  const viewport = { width: 1920, height: 1080 }

  const rect1 = { left: Number.NaN, top: 100, width: 100, height: 50 }
  const result1 = grid.snapRect(rect1, viewport)
  assert.ok(Number.isNaN(result1.left))
  assert.equal(result1.lineX, null)
  assert.equal(result1.lineY, null)

  const rect2 = { left: 100, top: Number.Infinity, width: 100, height: 50 }
  const result2 = grid.snapRect(rect2, viewport)
  assert.equal(result2.left, 100)
  assert.equal(result2.lineX, null)
  assert.ok(Number.isFinite(result2.top) === false)
  assert.equal(result2.lineY, null)
})

test('snapRect: does not clamp to viewport', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block far to the right, outside viewport
  const rect = { left: 2000, top: 100, width: 100, height: 50 }

  const result = grid.snapRect(rect, viewport)

  // Should snap to the nearest line without clamping
  // 2000 to 1920 (major): 80 away (> 8, no snap)
  // 2000 to 1890 (minor, if exists): 110 away
  // Let me check: 1920 is in majorX, 1890 is not (1920 - 30 = 1890, which is 960 + k*30)
  // Actually, 1890 = 960 - 30*(-2.3), doesn't work out evenly. Let me recalculate.
  // Minor lines are 960 + k*30 for integer k.
  // k such that 960 + k*30 = 1890: k = 930/30 = 31, so 1890 = 960 + 31*30, yes
  // So 1890 is a minor line.
  // 2000 to 1890: 110 away (too far)
  // Actually, 2000 to 1920: 80, to 1890: 110, neither snaps.
  // But let's check all anchors: left=2000, center=2050, right=2100
  // For right=2100 to 2040: probably doesn't exist. Let me be more careful.
  // 2100 to 2070 (960 + 37*30): 30 away (> 8, no snap)
  // So all anchors fail to snap with threshold 8.

  assert.equal(result.left, 2000)
  assert.equal(result.lineX, null)
})

test('computeGrid returns frozen object', () => {
  const g = grid.computeGrid({ width: 1920, height: 1080 })
  // Frozen objects silently fail to update in non-strict mode
  g.step = 10 // should be ignored
  assert.equal(g.step, 30) // unchanged
  // In strict mode, it would throw a TypeError
})

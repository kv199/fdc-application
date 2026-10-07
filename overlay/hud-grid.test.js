const test = require('node:test')
const assert = require('node:assert/strict')
const grid = require('./hud-grid.js')

test('exports constants', () => {
  assert.equal(grid.MAJOR_DIVISIONS, 4)
  assert.equal(grid.MINOR_ROWS, 36)
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

test('snapRect: corner snaps to nearest minor line', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block 100x50 at left=47, top=1000
  // rawCenterX = 47 + 50 = 97; closest interior major 480 is 383 away, >15, so no center snap
  // Corner snap to nearest minorX: |47-30|=17, |47-60|=13 → snap to 60
  // rawCenterY = 1000 + 25 = 1025; closest interior major 810 is 215 away, >15, so no center snap
  // Corner snap to nearest minorY: |1000-990|=10, |1000-1020|=20 → snap to 990
  const rect = { left: 47, top: 1000, width: 100, height: 50 }

  const result = grid.snapRect(rect, viewport)

  assert.equal(result.left, 60)
  assert.equal(result.top, 990)
  assert.equal(result.lineX, 60)
  assert.equal(result.lineY, 990)
})

test('snapRect: center detent on interior major line within step/2', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block 100x50 with rawCenter 955 (left 905)
  // rawCenterX = 955; closest interior majorX 960 is 5 away, <=15, so CENTER on 960
  // left = 960 - 50 = 910
  // rawCenterY = 1000 + 25 = 1025; closest interior majorY 810 is 215 away, >15, corner snap
  // Corner snap to nearest minorY: |1000-1020|=20, |1000-990|=10 → snap to 990
  const rect = { left: 905, top: 1000, width: 100, height: 50 }

  const result = grid.snapRect(rect, viewport)

  assert.equal(result.left, 910)
  assert.equal(result.lineX, 960)
  assert.equal(result.top, 990)
  assert.equal(result.lineY, 990)
})

test('snapRect: no center detent when beyond step/2 threshold', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block 100-wide with rawCenter 976 (left 926)
  // rawCenterX = 976; closest interior majorX 960 is 16 away, >15, so NO center snap
  // Corner snap to nearest minorX: |926-900|=26, |926-930|=4 → snap to 930
  const rect = { left: 926, top: 500, width: 100, height: 50 }

  const result = grid.snapRect(rect, viewport)

  assert.equal(result.left, 930)
  assert.equal(result.lineX, 930)
})

test('snapRect: Y axis independent of X axis', () => {
  const viewport = { width: 1920, height: 1080 }
  // Test that X and Y snap independently
  // Block 50x50 at left=503, top=537
  // rawCenterX = 503 + 25 = 528; closest interior majorX 480 is 48 away, >15, corner snap
  // Corner snap to nearest minorX: |503-480|=23, |503-510|=7 → snap to 510
  // rawCenterY = 537 + 25 = 562; closest interior majorY 540 is 22 away, >15, corner snap
  // Corner snap to nearest minorY: |537-540|=3... wait, let me recalculate
  // Actually, |537-540| = 3, but we're looking for NEAREST, so check more
  // Nearest minorY to 537: minorY are at multiples of 30 from center 540
  // 540-30=510, 540+0=540, 540+30=570...
  // So minorY includes: ..., 510, 540, 570, ...
  // |537-540|=3, |537-510|=27 → nearest is 540
  // So top = 540, lineY = 540
  // But wait, 540 is also a major line. Let me re-check: does minor snap or major center win?
  // The algorithm first checks if center can snap to major. If not, it snaps corner to minor.
  // So rawCenterY = 562. Interior majorY = [270, 540, 810]. Closest = 540 at distance 22 > 15.
  // So NO center snap. Now snap corner to nearest minor.
  // But 540 is BOTH a major and minor line. So it will be returned as a minor snap.
  // Let me recalculate: corner is at top=537. Nearest minorY lines are 540, 510.
  // Distance to 540: 3. Distance to 510: 27. So nearest is 540, lineY = 540.

  // Let me reconsider the test. I'll use different values to avoid edge cases.
  // Block 50x50 at left=513, top=517
  // rawCenterX = 513 + 25 = 538; closest interior majorX 480 is 58 away, >15, corner snap
  // Corner snap to nearest minorX: |513-510|=3, |513-540|=27 → snap to 510
  // rawCenterY = 517 + 25 = 542; closest interior majorY 540 is 2 away, <=15, CENTER on 540
  // top = 540 - 25 = 515, lineY = 540
  const rect = { left: 513, top: 517, width: 50, height: 50 }

  const result = grid.snapRect(rect, viewport)

  assert.equal(result.left, 510)
  assert.equal(result.lineX, 510)
  assert.equal(result.top, 515)
  assert.equal(result.lineY, 540)
})

test('snapRect: does not center on edge major lines', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block 100x100 near left edge
  // If we position it with rawCenter at 5, it should NOT center on 0 (edge major)
  // rawCenterX = 5; interior majorX = [480, 960, 1440], none within 15, corner snap
  // Corner snap to nearest minorX: nearest to -45 (left=-45) is 0
  const rect = { left: -45, top: 100, width: 100, height: 100 }

  const result = grid.snapRect(rect, viewport)

  assert.equal(result.left, 0)
  assert.equal(result.lineX, 0)
})

test('snapRect: does not center on right edge major line', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block 100-wide near right edge
  // rawCenterX = 1920 - 50 = 1870 (left 1820, width 100)
  // Interior majorX = [480, 960, 1440], closest 1440 is 430 away, >15, corner snap
  // Corner snap to nearest minorX: |1820-1800|=20, |1820-1830|=10 → snap to 1830
  const rect = { left: 1820, top: 100, width: 100, height: 100 }

  const result = grid.snapRect(rect, viewport)

  assert.equal(result.left, 1830)
  assert.equal(result.lineX, 1830)
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
  // Block far to the right, outside viewport. Grid only extends to 1920.
  // rawCenterX = 2050; interior majorX closest 1440 is 610 away, >15, corner snap
  // Corner snap to nearest minorX: grid extends to 1920, so nearest is 1920 (distance 80)
  const rect = { left: 2000, top: 100, width: 100, height: 50 }

  const result = grid.snapRect(rect, viewport)

  assert.equal(result.left, 1920)
  assert.equal(result.lineX, 1920)
})

test('snapRect: center detent on interior Y major', () => {
  const viewport = { width: 1920, height: 1080 }
  // Block 50-tall with rawCenter 548 (top 523)
  // rawCenterY = 548; interior majorY 540 is 8 away, <=15, CENTER on 540
  // top = 540 - 25 = 515, lineY = 540
  const rect = { left: 500, top: 523, width: 100, height: 50 }

  const result = grid.snapRect(rect, viewport)

  assert.equal(result.top, 515)
  assert.equal(result.lineY, 540)
})

test('snapRect: computeGrid returns frozen object', () => {
  const g = grid.computeGrid({ width: 1920, height: 1080 })
  // Frozen objects silently fail to update in non-strict mode
  g.step = 10 // should be ignored
  assert.equal(g.step, 30) // unchanged
  // In strict mode, it would throw a TypeError
})

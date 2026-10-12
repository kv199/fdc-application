const test = require('node:test')
const assert = require('node:assert/strict')
const TraceMapZoom = require('./trace-map-zoom.js')

const base = { x: 0, y: 0, width: 1000, height: 600 }

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`)
}

test('createView starts at the whole-lap base and every view keeps the base aspect ratio', () => {
  const view = TraceMapZoom.createView(base)
  assert.deepEqual(view, { x: 0, y: 0, width: 1000, height: 600 })
  assert.notEqual(view, base, 'the view is a new object')
  const zoomed = TraceMapZoom.zoomAt(view, base, { x: 500, y: 300 }, 2)
  near(zoomed.height / zoomed.width, base.height / base.width, 'aspect')
})

test('zoomAt keeps the point under the cursor fixed', () => {
  const view = TraceMapZoom.createView(base)
  const point = { x: 250, y: 450 }
  const zoomed = TraceMapZoom.zoomAt(view, base, point, 2)
  near(zoomed.width, 500, 'width halves')
  near((point.x - zoomed.x) / zoomed.width, (point.x - view.x) / view.width, 'horizontal fraction')
  near((point.y - zoomed.y) / zoomed.height, (point.y - view.y) / view.height, 'vertical fraction')
  // A second zoom around a different point keeps that point fixed too.
  const next = { x: 400, y: 200 }
  const deeper = TraceMapZoom.zoomAt(zoomed, base, next, 1.5)
  near((next.x - deeper.x) / deeper.width, (next.x - zoomed.x) / zoomed.width, 'second zoom keeps the point')
})

test('zoom limits: the maximum is twelve times the whole-lap view and the minimum is the base', () => {
  const view = TraceMapZoom.createView(base)
  const max = TraceMapZoom.zoomAt(view, base, { x: 500, y: 300 }, 1000)
  near(max.width, base.width / 12, 'maximum width')
  near(TraceMapZoom.zoomLevel(max, base), 12, 'maximum level')
  const out = TraceMapZoom.zoomAt(max, base, { x: 500, y: 300 }, 0.001)
  assert.equal(out.width, base.width, 'zooming out past the base stops at the base')
  assert.equal(TraceMapZoom.isAtBase(out, base), true)
})

test('zooming out while at base stays at base and does not move the window', () => {
  const view = TraceMapZoom.createView(base)
  const out = TraceMapZoom.zoomAt(view, base, { x: 100, y: 100 }, 1 / 1.5)
  assert.deepEqual(out, view)
  assert.equal(TraceMapZoom.isAtBase(out, base), true)
})

test('clampView keeps the window inside the base and resizes it to the limits', () => {
  const offEdge = TraceMapZoom.clampView({ x: -200, y: 900, width: 500, height: 300 }, base)
  assert.equal(offEdge.x, 0)
  near(offEdge.y, 600 - 300, 'bottom edge')
  assert.equal(offEdge.width, 500)
  const tooBig = TraceMapZoom.clampView({ x: 0, y: 0, width: 5000, height: 3000 }, base)
  assert.deepEqual(tooBig, { x: 0, y: 0, width: 1000, height: 600 })
  const tooSmall = TraceMapZoom.clampView({ x: 10, y: 10, width: 1, height: 0.6 }, base)
  near(tooSmall.width, 1000 / 12, 'minimum width')
  near(tooSmall.height, 600 / 12, 'minimum height')
})

test('panBy moves the window and clamps it at the edges of the base', () => {
  const zoomed = TraceMapZoom.zoomAt(TraceMapZoom.createView(base), base, { x: 500, y: 300 }, 2)
  const moved = TraceMapZoom.panBy(zoomed, base, 50, -20)
  near(moved.x, zoomed.x + 50, 'pan x')
  near(moved.y, zoomed.y - 20, 'pan y')
  assert.equal(moved.width, zoomed.width)
  const far = TraceMapZoom.panBy(zoomed, base, 10000, -10000)
  near(far.x, base.width - zoomed.width, 'clamped right edge')
  assert.equal(far.y, 0, 'clamped top edge')
  // At the whole-lap view nothing can pan.
  assert.deepEqual(TraceMapZoom.panBy(TraceMapZoom.createView(base), base, 80, 80), TraceMapZoom.createView(base))
})

test('fitBounds centres the bounds with padding and keeps the aspect ratio', () => {
  const bounds = { minX: 100, minY: 100, maxX: 300, maxY: 200 }
  const view = TraceMapZoom.fitBounds(base, bounds, 20)
  near(view.height / view.width, base.height / base.width, 'aspect')
  // The padded width (200 + 40) is wider than the padded height (100 + 40) over 0.6 at this aspect.
  near(view.width, 240, 'padded width')
  near(view.x + view.width / 2, 200, 'centre x')
  near(view.y + view.height / 2, 150, 'centre y')
})

test('fitBounds grows the window to the bounds height when the bounds are tall', () => {
  const bounds = { minX: 400, minY: 0, maxX: 420, maxY: 600 }
  const view = TraceMapZoom.fitBounds(base, bounds, 0)
  near(view.height, 600, 'the tall bounds set the height')
  near(view.width, 1000, 'and the width follows the aspect ratio')
  near(view.x, 0, 'clamped inside the base')
})

test('fitBounds clamps to the maximum zoom and to the base for empty bounds', () => {
  const tiny = TraceMapZoom.fitBounds(base, { minX: 500, minY: 300, maxX: 500, maxY: 300 }, 0)
  near(tiny.width, 1000 / 12, 'a point fits at the maximum zoom')
  near(TraceMapZoom.zoomLevel(tiny, base), 12, 'maximum level')
  const wide = TraceMapZoom.fitBounds(base, { minX: 0, minY: 0, maxX: 1000, maxY: 600 }, 24)
  assert.deepEqual(wide, TraceMapZoom.createView(base))
})

test('isAtBase tells the whole-lap view from a zoomed view', () => {
  assert.equal(TraceMapZoom.isAtBase(TraceMapZoom.createView(base), base), true)
  const zoomed = TraceMapZoom.zoomAt(TraceMapZoom.createView(base), base, { x: 500, y: 300 }, 1.5)
  assert.equal(TraceMapZoom.isAtBase(zoomed, base), false)
  assert.equal(TraceMapZoom.isAtBase(TraceMapZoom.panBy(zoomed, base, 1, 0), base), false)
})

test('wheelZoomFactor scales deltas by delta mode: a mouse notch is about x1.2 and lines and pages are normalized', () => {
  near(TraceMapZoom.wheelZoomFactor(0, 0), 1, 'no delta')
  const notch = TraceMapZoom.wheelZoomFactor(-100, 0)
  assert.ok(notch > 1.15 && notch < 1.2, `mouse notch ${notch}`)
  near(TraceMapZoom.wheelZoomFactor(100, 0), 1 / notch, 'opposite direction is the inverse')
  near(TraceMapZoom.wheelZoomFactor(-3, 1), Math.exp(3 * 16 * 0.0015), 'line mode counts 16 px')
  near(TraceMapZoom.wheelZoomFactor(-1, 2, 500), Math.exp(500 * 0.0015), 'page mode counts the window height')
})

test('fitBoundsPx pads the bounds by screen pixels of the resulting view', () => {
  const bounds = { minX: 400, maxX: 600, minY: 200, maxY: 300 }
  // Both scales give the same margin in pixels: the window width grows the margin in units.
  for (const pixelsPerBaseUnit of [1, 2, 0.5]) {
    const view = TraceMapZoom.fitBoundsPx(base, bounds, 24, pixelsPerBaseUnit)
    const paddingPx = (view.width - (bounds.maxX - bounds.minX)) / 2 * (pixelsPerBaseUnit * base.width / view.width)
    near(paddingPx, 24, `horizontal padding at ${pixelsPerBaseUnit} px per unit`)
    near(view.width, view.height * base.width / base.height, 'base aspect ratio kept')
    near(view.x + view.width / 2, 500, 'centred horizontally')
  }
})

test('fitBoundsPx keeps the window inside the base and stops at the base when padding is too large', () => {
  const edge = { minX: 0, maxX: 100, minY: 0, maxY: 60 }
  const view = TraceMapZoom.fitBoundsPx(base, edge, 24, 1)
  assert.ok(view.x >= base.x && view.x + view.width <= base.x + base.width)
  assert.ok(view.y >= base.y && view.y + view.height <= base.y + base.height)
  assert.deepEqual(TraceMapZoom.fitBoundsPx(base, edge, 2000, 1), base)
})

test('fitBoundsPx never zooms past the maximum zoom', () => {
  const tiny = { minX: 500, maxX: 501, minY: 300, maxY: 300.5 }
  const view = TraceMapZoom.fitBoundsPx(base, tiny, 0, 1)
  near(view.width, base.width / TraceMapZoom.MAX_ZOOM, 'width at the maximum zoom')
})

(function (globalScope) {
  'use strict'

  const MAJOR_DIVISIONS = 4
  const MINOR_ROWS = 36

  function positive(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : 1
  }

  function majorLines(length) {
    return Array.from({ length: MAJOR_DIVISIONS + 1 }, (_, index) => length * index / MAJOR_DIVISIONS)
  }

  // Minor lines start at the center, so mirrored placements land on the grid too.
  function minorLines(length, step) {
    const center = length / 2
    const lines = []
    for (let k = Math.ceil(-center / step); center + k * step <= length; k += 1) lines.push(center + k * step)
    return lines
  }

  function computeGrid(viewport) {
    const width = positive(viewport?.width)
    const height = positive(viewport?.height)
    const step = Math.max(4, Math.round(height / MINOR_ROWS))
    const centerX = width / 2
    const centerY = height / 2
    return Object.freeze({
      step,
      centerX,
      centerY,
      offsetX: ((centerX % step) + step) % step,
      offsetY: ((centerY % step) + step) % step,
      majorX: Object.freeze(majorLines(width)),
      majorY: Object.freeze(majorLines(height)),
      minorX: Object.freeze(minorLines(width, step)),
      minorY: Object.freeze(minorLines(height, step))
    })
  }

  function nearest(value, lines) {
    return lines.reduce((best, line) => (best === null || Math.abs(value - line) < Math.abs(value - best) ? line : best), null)
  }

  // The start edge sits on the nearest dot, unless the center is within half a
  // step of a major line inside the screen; then the block centers on it.
  function snapAxis(start, size, majors, minors, step) {
    const center = start + size / 2
    const major = nearest(center, majors.slice(1, -1))
    if (major !== null && Math.abs(center - major) <= step / 2) return { start: major - size / 2, line: major }
    const minor = nearest(start, minors)
    return minor === null ? { start, line: null } : { start: minor, line: minor }
  }

  function snapRect(rect, viewport) {
    if (!Number.isFinite(rect?.left) || !Number.isFinite(rect?.top)) {
      return { left: rect?.left, top: rect?.top, lineX: null, lineY: null }
    }
    const grid = computeGrid(viewport)
    const x = snapAxis(rect.left, Number(rect.width) || 0, grid.majorX, grid.minorX, grid.step)
    const y = snapAxis(rect.top, Number(rect.height) || 0, grid.majorY, grid.minorY, grid.step)
    return { left: x.start, top: y.start, lineX: x.line, lineY: y.line }
  }

  const api = Object.freeze({ MAJOR_DIVISIONS, MINOR_ROWS, computeGrid, snapRect })

  if (typeof globalScope !== 'undefined') globalScope.HudGrid = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)

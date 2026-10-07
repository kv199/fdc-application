(function (globalScope) {
  'use strict'

  const MAJOR_DIVISIONS = 4
  const MINOR_ROWS = 36
  const SNAP_THRESHOLD = 8

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

  // Moves the nearest of the start edge, center, and end edge onto the nearest
  // line within the threshold; a major line wins a tie.
  function snapAxis(start, size, majors, minors, threshold) {
    let best = null
    for (const anchor of [start, start + size / 2, start + size]) {
      for (const [lines, major] of [[majors, true], [minors, false]]) {
        for (const line of lines) {
          const distance = Math.abs(anchor - line)
          if (!best || distance < best.distance || (distance === best.distance && major && !best.major)) {
            best = { distance, line, shift: line - anchor, major }
          }
        }
      }
    }
    return best && best.distance <= threshold
      ? { start: start + best.shift, line: best.line }
      : { start, line: null }
  }

  function snapRect(rect, viewport, threshold = SNAP_THRESHOLD) {
    if (!Number.isFinite(rect?.left) || !Number.isFinite(rect?.top)) {
      return { left: rect?.left, top: rect?.top, lineX: null, lineY: null }
    }
    const grid = computeGrid(viewport)
    const x = snapAxis(rect.left, Number(rect.width) || 0, grid.majorX, grid.minorX, threshold)
    const y = snapAxis(rect.top, Number(rect.height) || 0, grid.majorY, grid.minorY, threshold)
    return { left: x.start, top: y.start, lineX: x.line, lineY: y.line }
  }

  const api = Object.freeze({ MAJOR_DIVISIONS, MINOR_ROWS, SNAP_THRESHOLD, computeGrid, snapRect })

  if (typeof globalScope !== 'undefined') globalScope.HudGrid = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)

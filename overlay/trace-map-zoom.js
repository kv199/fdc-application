(function (globalScope, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.TraceMapZoom = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict'

  // The whole-lap view is the base. The view is a window on the base viewBox; its width sets the zoom level.
  const MAX_ZOOM = 12
  // Per wheel unit: a mouse notch (100 px) is about x1.2, and trackpad deltas stay smooth.
  const WHEEL_ZOOM_RATE = 0.0015
  const LINE_HEIGHT_PX = 16
  const RELATIVE_TOLERANCE = 1e-6

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value))
  }

  function createView(base) {
    return { x: base.x, y: base.y, width: base.width, height: base.height }
  }

  // Keeps the base aspect ratio, limits the width to the base down to base / maxZoom, and keeps the window inside
  // the base.
  function clampView(view, base, maxZoom = MAX_ZOOM) {
    const ratio = base.height / base.width
    const width = clamp(view.width, base.width / maxZoom, base.width)
    const height = width * ratio
    const x = clamp(view.x, base.x, base.x + base.width - width)
    const y = clamp(view.y, base.y, base.y + base.height - height)
    return { x, y, width, height }
  }

  // Zooms by factor (above 1 zooms in) around point, given in viewBox units: the point keeps its place on the map
  // unless the clamp moves the window.
  function zoomAt(view, base, point, factor, maxZoom = MAX_ZOOM) {
    if (!(factor > 0) || !Number.isFinite(factor)) return clampView(view, base, maxZoom)
    const ratio = base.height / base.width
    const width = clamp(view.width / factor, base.width / maxZoom, base.width)
    const scale = width / view.width
    return clampView({
      x: point.x - (point.x - view.x) * scale,
      y: point.y - (point.y - view.y) * scale,
      width,
      height: width * ratio
    }, base, maxZoom)
  }

  // Shifts the window by (dx, dy) in viewBox units and keeps it inside the base.
  function panBy(view, base, dx, dy, maxZoom = MAX_ZOOM) {
    return clampView({ x: view.x + dx, y: view.y + dy, width: view.width, height: view.height }, base, maxZoom)
  }

  // Fits bounds ({ minX, minY, maxX, maxY } in viewBox units) with paddingUnits of margin on every side. The fitted
  // window is centred on the bounds and keeps the base aspect ratio; it never zooms in past maxZoom.
  function fitBounds(base, bounds, paddingUnits = 0, maxZoom = MAX_ZOOM) {
    const ratio = base.height / base.width
    const padding = Math.max(0, paddingUnits)
    const boundsWidth = Math.max(0, bounds.maxX - bounds.minX) + padding * 2
    const boundsHeight = Math.max(0, bounds.maxY - bounds.minY) + padding * 2
    const width = clamp(Math.max(boundsWidth, boundsHeight / ratio), base.width / maxZoom, base.width)
    const height = width * ratio
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    return clampView({ x: centerX - width / 2, y: centerY - height / 2, width, height }, base, maxZoom)
  }

  function isAtBase(view, base) {
    return Math.abs(view.width - base.width) <= base.width * RELATIVE_TOLERANCE
      && Math.abs(view.x - base.x) <= base.width * RELATIVE_TOLERANCE
      && Math.abs(view.y - base.y) <= base.height * RELATIVE_TOLERANCE
  }

  function zoomLevel(view, base) {
    return base.width / view.width
  }

  // Wheel deltas become a zoom factor: lines count 16 px and pages count one window height.
  function wheelZoomFactor(deltaY, deltaMode = 0, pageHeight = 800) {
    const unit = deltaMode === 1 ? LINE_HEIGHT_PX : deltaMode === 2 ? pageHeight : 1
    return Math.exp(-deltaY * unit * WHEEL_ZOOM_RATE)
  }

  return {
    MAX_ZOOM,
    WHEEL_ZOOM_RATE,
    createView,
    clampView,
    zoomAt,
    panBy,
    fitBounds,
    isAtBase,
    zoomLevel,
    wheelZoomFactor
  }
}))

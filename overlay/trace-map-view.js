(function (globalScope, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.TraceMapView = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict'

  // Selected trace map layers shared by every lap until the window reloads; null shows all layers.
  let traceMapLayerSelection = null

  // These mirror the settings.js helpers of the same names until the Events code moves into a module.
  function finiteNumber(value) {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function normalizePedal(value) {
    const number = finiteNumber(value)
    if (number === null) return 0
    return Math.max(0, Math.min(1, number > 1 ? number / 100 : number))
  }

  const TRACE_COLORS = {
    throttle: '#69e83f',
    brake: '#ef4444',
    coast: '#facc15'
  }

  function traceState(point) {
    // Braking wins when both pedals are pressed, matching the HUD's safety-first
    // interpretation of overlapping inputs.
    if (normalizePedal(point?.brake) >= 0.05) return 'brake'
    if (normalizePedal(point?.throttle) >= 0.05) return 'throttle'
    return 'coast'
  }

  function traceStats(points, lapTimeMs = null) {
    const totals = { throttle: 0, brake: 0, coast: 0 }
    const firstElapsed = finiteNumber(points[0]?.elapsedMs)
    if (Number.isFinite(firstElapsed) && firstElapsed > 0) {
      totals[traceState(points[0])] += firstElapsed
    }
    for (let index = 0; index < points.length - 1; index += 1) {
      const elapsed = finiteNumber(points[index + 1]?.elapsedMs) - finiteNumber(points[index]?.elapsedMs)
      if (!Number.isFinite(elapsed) || elapsed <= 0) continue
      totals[traceState(points[index])] += elapsed
    }
    const lastElapsed = finiteNumber(points.at(-1)?.elapsedMs)
    const remaining = Number.isFinite(lapTimeMs) && Number.isFinite(lastElapsed)
      ? Math.max(0, lapTimeMs - lastElapsed)
      : 0
    if (remaining > 0 && points.length) totals[traceState(points.at(-1))] += remaining
    const total = Object.values(totals).reduce((sum, value) => sum + value, 0)
    if (total <= 0) return null
    const exact = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value / total * 100]))
    const rounded = Object.fromEntries(Object.entries(exact).map(([key, value]) => [key, Math.floor(value)]))
    let remainder = 100 - Object.values(rounded).reduce((sum, value) => sum + value, 0)
    for (const [key] of Object.entries(exact).sort((left, right) => right[1] - Math.floor(right[1]) - (left[1] - Math.floor(left[1])))) {
      if (remainder <= 0) break
      rounded[key] += 1
      remainder -= 1
    }
    return rounded
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name)
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
    return element
  }

  // Sector ticks are drawn at the view's base scale: half-length and the label gap are in whole-lap view units.
  const SECTOR_TICK_HALF_UNITS = 11
  // On screen, a sector tick reaches 11 px either side of the trace and its label starts 6 px beyond it.
  const SECTOR_TICK_HALF_PX = 11
  const SECTOR_LABEL_GAP_PX = 6
  // Matches the sector label's CSS font size, which is also in screen pixels.
  const SECTOR_LABEL_FONT_PX = 13

  // The sectors are thirds of the distance of one span (see EventTraceMap.sectorSpan). Each tick crosses the trace at
  // the span point nearest its third, and each point is searched only inside the span.
  function traceSectorTicks(points, span, project) {
    const ticks = []
    // The tick points are the sector boundaries (EventTraceMap.sectorBoundaries), so a focused sector ends at its tick.
    const boundaries = globalThis.EventTraceMap?.sectorBoundaries(points, span)
    if (!boundaries) return ticks
    boundaries.ticks.forEach((nearestIndex, sectorIndex) => {
      const sector = sectorIndex + 1
      const previous = project(points[Math.max(span.startIndex, nearestIndex - 1)])
      const next = project(points[Math.min(span.endIndex, nearestIndex + 1)])
      const current = project(points[nearestIndex])
      const dx = next.x - previous.x
      const dz = next.y - previous.y
      const length = Math.hypot(dx, dz) || 1
      const normalX = -dz / length * SECTOR_TICK_HALF_UNITS
      const normalY = dx / length * SECTOR_TICK_HALF_UNITS
      ticks.push({
        x1: current.x - normalX,
        y1: current.y - normalY,
        x2: current.x + normalX,
        y2: current.y + normalY,
        label: `S${sector}`
      })
    })
    return ticks
  }

  // Events lap maps and Driver Analysis drive maps share this map and its sector ticks. Events lap maps use the
  // defaults. Driver Analysis drive maps pass marks (problem segments and clean checks), their own layer selection, and
  // requireFinish, which keeps an unfinished drive without a completed lap free of sector ticks.
  function renderTraceMap(points, lapTimeMs, options = {}) {
    const marks = options.marks || null
    // Sector focus is only for Events lap maps (options.sectorFocus). Driver Analysis drive maps never set it.
    const sectorFocus = options.sectorFocus === true
    const selection = options.selection || {
      get: () => traceMapLayerSelection,
      set: value => { traceMapLayerSelection = value }
    }
    const map = document.createElement('div')
    map.className = 'events-lap-detail__map'
    if (points.length < 2) {
      if (sectorFocus) {
        map.append(renderTraceUnavailable())
      } else {
        const empty = document.createElement('p')
        empty.className = 'events-lap-detail__empty'
        empty.textContent = options.emptyText || 'NO TRACE DATA SAVED FOR THIS LAP'
        map.append(empty)
      }
      // A map without a trace has nothing to zoom or focus, but callers can still call these methods.
      map.zoomToBounds = () => {}
      map.resetZoom = () => {}
      map.focusSector = () => {}
      map.getSectorFocus = () => null
      return map
    }
    const coordinates = points.map(point => ({ x: point.positionX, z: point.positionZ }))
    const minX = Math.min(...coordinates.map(point => point.x))
    const maxX = Math.max(...coordinates.map(point => point.x))
    const minZ = Math.min(...coordinates.map(point => point.z))
    const maxZ = Math.max(...coordinates.map(point => point.z))
    // The viewBox follows the track's shape so any layout fills the width; CSS caps the rendered height.
    const width = 1000
    const padding = 36
    const spanX = Math.max(1, maxX - minX)
    const spanZ = Math.max(1, maxZ - minZ)
    const height = Math.round(Math.min(1400, Math.max(360, (width - padding * 2) * spanZ / spanX + padding * 2)))
    const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanZ)
    const offsetX = (width - spanX * scale) / 2
    const offsetY = (height - spanZ * scale) / 2
    const project = point => ({
      x: offsetX + (point.positionX - minX) * scale,
      y: height - offsetY - (point.positionZ - minZ) * scale
    })
    const projected = points.map(project)
    // The zoom view is a window on this whole-lap viewBox; the zoom math lives in TraceMapZoom.
    const zoom = globalThis.TraceMapZoom
    const base = { x: 0, y: 0, width, height }
    let view = zoom.createView(base)
    let drag = null
    // Sector focus state: the focused sector (1 to 3, or null for the whole lap) and whether FIT SECTOR has fitted it.
    let focusedSector = null
    let sectorFitted = false

    // Check if extended telemetry is available
    const hasExtended = globalThis.EventTraceMap?.hasExtendedTelemetry(points) ?? false

    const markLayers = marks
      ? [
          ...(globalThis.DriverAnalysisMap?.ERROR_TYPES || []).filter(kind => marks.errors.some(mark => mark.kind === kind)),
          ...(marks.clean.length > 0 ? ['clean'] : [])
        ]
      : []
    const available = [
      ...markLayers,
      ...(globalThis.EventTraceMap?.TRACE_LAYERS.filter(layer => layer !== 'slip' || hasExtended) ?? ['throttle', 'brake', 'coast'])
    ]

    const svg = svgElement('svg', {
      class: 'events-lap-detail__svg',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': 'Throttle, brake, coast, and slip trace map'
    })
    svg.append(svgElement('rect', { class: 'events-lap-detail__surface', x: 0, y: 0, width, height, rx: 2 }))

    // The outline, slip, and pedal layers of the points from..to (inclusive). Run indexes are offset back to the whole lap,
    // so the same builder draws the whole lap and the focused sector.
    const traceLayers = (from, to) => {
      const outlineGroup = svgElement('g', { class: 'events-lap-detail__outline-group' })
      outlineGroup.append(svgElement('polyline', {
        class: 'events-lap-detail__outline',
        points: projected.slice(from, to + 1).map((p) => `${p.x},${p.y}`).join(' ')
      }))
      const layers = { outline: outlineGroup, slip: null, pedals: [] }
      const rangePoints = points.slice(from, to + 1)

      // Slip layer (drawn under pedal lines)
      if (hasExtended) {
        const slipGroup = svgElement('g', { class: 'events-lap-detail__slip-group', 'data-layer-group': 'slip' })
        const slipRuns = globalThis.EventTraceMap?.groupRuns(rangePoints, (p) => globalThis.EventTraceMap?.isSlipPoint(p) ? 'slip' : 'no-slip') ?? []
        for (const run of slipRuns) {
          if (run.key !== 'slip') continue
          const runPoints = projected.slice(from + run.startIndex, from + run.endIndex + 1)
          const pointsStr = runPoints.map((p) => `${p.x},${p.y}`).join(' ')
          slipGroup.append(svgElement('polyline', {
            class: 'events-lap-detail__slip-line',
            points: pointsStr
          }))
        }
        layers.slip = slipGroup
      }

      // Pedal layers
      for (const pedal of ['throttle', 'brake', 'coast']) {
        const group = svgElement('g', { class: `events-lap-detail__pedal-group events-lap-detail__pedal-group--${pedal}`, 'data-layer-group': pedal })
        const runs = globalThis.EventTraceMap?.groupRuns(rangePoints, (p) => globalThis.EventTraceMap?.pedalState(p)) ?? []
        for (const run of runs) {
          if (run.key !== pedal) continue
          const runPoints = projected.slice(from + run.startIndex, from + run.endIndex + 1)
          if (runPoints.length < 2) continue
          const pointsStr = runPoints.map((p) => `${p.x},${p.y}`).join(' ')
          group.append(svgElement('polyline', {
            class: `events-lap-detail__trace events-lap-detail__trace--${pedal}`,
            points: pointsStr
          }))
        }
        layers.pedals.push(group)
      }
      return layers
    }
    // Whole-lap layers: the white track outline is always visible, and sector focus dims it and the pedal lines.
    const fullLayers = traceLayers(0, points.length - 1)
    svg.append(fullLayers.outline)
    if (fullLayers.slip) svg.append(fullLayers.slip)
    svg.append(...fullLayers.pedals)
    // The focused sector is drawn on top of the dimmed whole lap. It is rebuilt whenever the focus changes.
    const focusGroup = sectorFocus ? svgElement('g', { class: 'events-lap-detail__focus' }) : null
    if (focusGroup) svg.append(focusGroup)

    if (marks) svg.append(...renderTraceMarks(marks, projected))

    // Sector ticks and labels (on top)
    const span = globalThis.EventTraceMap?.sectorSpan(points, { requireFinish: options.requireFinish === true }) ?? null
    const ticks = traceSectorTicks(points, span, project)
    // The focusable sectors are the ranges between the ticks. Without sector focus there are none.
    const sectorRangeList = sectorFocus ? globalThis.EventTraceMap?.sectorRanges(points, span) ?? [] : []
    // Each tick keeps its midpoint, half-vector, and unit normal, so zooming can redraw it at the same on-screen size.
    const scaledTicks = []
    for (const tick of ticks) {
      const line = svgElement('line', {
        class: 'events-lap-detail__sector-tick',
        x1: tick.x1,
        y1: tick.y1,
        x2: tick.x2,
        y2: tick.y2
      })
      const label = svgElement('text', { class: 'events-lap-detail__sector-label' })
      label.textContent = tick.label
      svg.append(line, label)
      const halfX = (tick.x2 - tick.x1) / 2
      const halfY = (tick.y2 - tick.y1) / 2
      const halfLength = Math.hypot(halfX, halfY) || 1
      const unitX = halfX / halfLength
      const unitY = halfY / halfLength
      // The label sits beyond the outer end, anchored on the side it faces so it clears the tick and the trace.
      if (Math.abs(unitX) >= Math.abs(unitY)) {
        label.setAttribute('text-anchor', unitX >= 0 ? 'start' : 'end')
        label.setAttribute('dominant-baseline', 'central')
      } else {
        label.setAttribute('text-anchor', 'middle')
        label.setAttribute('dominant-baseline', unitY >= 0 ? 'hanging' : 'alphabetic')
      }
      scaledTicks.push({
        line,
        label,
        midX: (tick.x1 + tick.x2) / 2,
        midY: (tick.y1 + tick.y2) / 2,
        halfX,
        halfY,
        unitX,
        unitY
      })
    }

    // Start marker
    const start = project(points[0])
    svg.append(svgElement('circle', { class: 'events-lap-detail__start', cx: start.x, cy: start.y, r: 3 }))

    // POINT DATA panel beside the map: it shows the hovered point while the pointer is over the map layout.
    const inspectorTitle = document.createElement('span')
    inspectorTitle.className = 'events-lap-detail__inspector-title'
    inspectorTitle.textContent = 'POINT DATA'
    const inspectorBody = document.createElement('div')
    inspectorBody.className = 'events-lap-detail__inspector-body'
    const inspector = document.createElement('aside')
    inspector.className = 'events-lap-detail__inspector'
    inspector.setAttribute('aria-live', 'polite')
    inspector.setAttribute('aria-label', 'Point data')
    inspector.append(inspectorTitle, inspectorBody)
    // Zoom controls sit over the SVG's top-right corner, beside the POINT DATA panel rather than inside it.
    const zoomControls = document.createElement('div')
    zoomControls.className = 'events-lap-detail__zoom'
    zoomControls.setAttribute('role', 'group')
    zoomControls.setAttribute('aria-label', 'Map zoom')
    const zoomInButton = renderZoomButton('+', 'Zoom in')
    const zoomOutButton = renderZoomButton('−', 'Zoom out')
    const fitButton = renderZoomButton('FIT', 'Show whole lap')
    zoomControls.append(zoomInButton, zoomOutButton, fitButton)
    // Sector focus adds the FIT SECTOR button over the map's top-left corner and the distance caption over its bottom-left.
    const sectorFitButton = sectorFocus ? renderSectorFitButton() : null
    const distanceCaption = sectorFocus ? document.createElement('span') : null
    if (distanceCaption) distanceCaption.className = 'events-lap-detail__distance'
    const canvas = document.createElement('div')
    canvas.className = 'events-lap-detail__canvas'
    canvas.append(svg, zoomControls, ...[sectorFitButton, distanceCaption].filter(Boolean))
    const layout = document.createElement('div')
    layout.className = 'events-lap-detail__map-layout'
    layout.append(canvas, inspector)
    // The controls row above the map: FULL LAP (or FULL RUN), SECTOR 1 to SECTOR 3, and CLEAR FOCUS while focused.
    const fullLabel = options.fullLabel || 'FULL LAP'
    const sectorControls = sectorFocus ? renderSectorControls(fullLabel) : null

    // Hover functionality
    const markerCircle = svgElement('circle', { class: 'events-lap-detail__hover-marker', cx: 0, cy: 0, r: 4 })
    markerCircle.style.display = 'none'
    svg.append(markerCircle)

    // Hover is computed at most once per frame from the latest pointer position. shownHoverKey is the point the
    // panel and marker show now; it is reset whenever they are cleared, so an unchanged point is not redrawn.
    let hoverFrame = null
    let hoverPointer = null
    let shownHoverKey = null
    const cancelHoverFrame = () => {
      if (hoverFrame === null) return
      cancelAnimationFrame(hoverFrame)
      hoverFrame = null
    }
    const updateHover = () => {
      hoverFrame = null
      if (drag) return
      // The viewBox is letterboxed inside the padded element, so map through the screen matrix.
      const matrix = svg.getScreenCTM()
      if (!matrix) return
      const cursor = new DOMPoint(hoverPointer.x, hoverPointer.y).matrixTransform(matrix.inverse())
      const x = cursor.x
      const y = cursor.y

      const nearestIdx = (marks ? globalThis.DriverAnalysisMap?.nearestErrorIndex(marks, projected, x, y, hoverReach()) : null)
        ?? hoverIndex(x, y, hoverReach()) ?? null
      if (nearestIdx !== null) {
        const errorMark = marks ? globalThis.DriverAnalysisMap?.errorAt(marks, nearestIdx) : null
        // The panel depends only on the point and whether it is a problem mark, so the key fixes what is shown.
        const key = `${nearestIdx}:${errorMark ? 'error' : 'point'}`
        if (key === shownHoverKey) return
        shownHoverKey = key

        const p = projected[nearestIdx]
        markerCircle.setAttribute('cx', p.x)
        markerCircle.setAttribute('cy', p.y)

        const tooltipData = errorMark
          ? globalThis.DriverAnalysisMap.errorTooltipModel(errorMark, points)
          : globalThis.EventTraceMap?.tooltipModel(points[nearestIdx], points[0].distanceM ?? 0) ?? { rows: [], wheelTable: [] }
        renderTooltip(inspectorBody, tooltipData)
        markerCircle.style.display = 'block'
      } else {
        shownHoverKey = null
        inspectorBody.replaceChildren()
        markerCircle.style.display = 'none'
      }
    }
    svg.addEventListener('pointermove', (event) => {
      // A pan keeps the hover marker and POINT DATA hidden until the pointer is released.
      if (drag) return
      hoverPointer = { x: event.clientX, y: event.clientY }
      if (hoverFrame === null) hoverFrame = requestAnimationFrame(updateHover)
    })

    // The panel sits beside the SVG, so leaving the whole layout (not just the SVG) clears it.
    // A frame still pending from the last move must not re-show the panel after the pointer left.
    layout.addEventListener('pointerleave', () => {
      cancelHoverFrame()
      shownHoverKey = null
      inspectorBody.replaceChildren()
      markerCircle.style.display = 'none'
    })

    // Zoom and pan. Every change goes through applyView, which moves the viewBox and counter-scales the elements whose
    // on-screen size must not change: k is the view width over the whole-lap width. Stroke widths are scaled in CSS
    // through --map-k, and the circles, sector ticks, and labels are scaled here from their base geometry.
    const circleRadii = new Map([...svg.querySelectorAll('circle')].map(circle => [circle, Number(circle.getAttribute('r'))]))
    const currentK = () => view.width / base.width
    // Hover reach stays 14 screen pixels, which is 14 viewBox units at the whole-lap view.
    const hoverReach = () => 14 * currentK()
    // Sector ticks and labels are sized in screen pixels, not viewBox units, so they read the same at every window
    // width and zoom. Before the SVG is laid out there is no screen matrix, and the viewBox scale stands in.
    const sectorScale = () => {
      const matrix = svg.getScreenCTM()
      const pixelsPerUnit = matrix ? Math.hypot(matrix.a, matrix.b) : 0
      return pixelsPerUnit > 0 ? 1 / pixelsPerUnit : currentK()
    }
    const applySectorScale = () => {
      const s = sectorScale()
      svg.style.setProperty('--map-sector-k', String(s))
      for (const tick of scaledTicks) {
        const half = SECTOR_TICK_HALF_PX * s
        const labelOffset = (SECTOR_TICK_HALF_PX + SECTOR_LABEL_GAP_PX) * s
        tick.line.setAttribute('x1', tick.midX - tick.unitX * half)
        tick.line.setAttribute('y1', tick.midY - tick.unitY * half)
        tick.line.setAttribute('x2', tick.midX + tick.unitX * half)
        tick.line.setAttribute('y2', tick.midY + tick.unitY * half)
        // A label that would leave the visible map, such as one beside a tick on the map edge, goes to the tick's
        // other side instead. Its box is estimated from the font size: two condensed glyphs are about 1.4 em wide.
        const fontUnits = SECTOR_LABEL_FONT_PX * s
        const fits = side => {
          const x = tick.midX + tick.unitX * labelOffset * side
          const y = tick.midY + tick.unitY * labelOffset * side
          const width = fontUnits * 1.4
          const horizontal = Math.abs(tick.unitX) >= Math.abs(tick.unitY)
          const left = horizontal ? (tick.unitX * side >= 0 ? x : x - width) : x - width / 2
          const top = horizontal ? y - fontUnits / 2 : (tick.unitY * side >= 0 ? y : y - fontUnits)
          return left >= view.x && left + width <= view.x + view.width
            && top >= view.y && top + fontUnits <= view.y + view.height
        }
        const side = fits(1) || !fits(-1) ? 1 : -1
        tick.label.setAttribute('x', tick.midX + tick.unitX * labelOffset * side)
        tick.label.setAttribute('y', tick.midY + tick.unitY * labelOffset * side)
        if (Math.abs(tick.unitX) >= Math.abs(tick.unitY)) {
          tick.label.setAttribute('text-anchor', tick.unitX * side >= 0 ? 'start' : 'end')
        } else {
          tick.label.setAttribute('dominant-baseline', tick.unitY * side >= 0 ? 'hanging' : 'alphabetic')
        }
      }
    }
    if (scaledTicks.length > 0 && typeof ResizeObserver === 'function') {
      new ResizeObserver(() => applySectorScale()).observe(svg)
    }
    const applyView = () => {
      const k = currentK()
      svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.width} ${view.height}`)
      svg.style.setProperty('--map-k', String(k))
      for (const [circle, radius] of circleRadii) circle.setAttribute('r', radius * k)
      applySectorScale()
      const atBase = zoom.isAtBase(view, base)
      svg.classList.toggle('is-zoomed', !atBase)
      zoomInButton.disabled = zoom.zoomLevel(view, base) >= zoom.MAX_ZOOM - 1e-6
      zoomOutButton.disabled = atBase
      fitButton.disabled = atBase
      if (sectorFitButton) {
        sectorFitButton.hidden = focusedSector === null
        sectorFitButton.textContent = sectorFitted ? 'SHOW FULL ROUTE' : 'FIT SECTOR'
      }
    }
    // Every view change is a manual one unless it is the sector fit, so only the sector fit keeps its FIT state.
    const setView = (next, fitted = false) => {
      view = next
      sectorFitted = fitted
      applyView()
    }
    const viewPoint = (clientX, clientY) => {
      const matrix = svg.getScreenCTM()
      if (!matrix) return null
      const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
      return { x: point.x, y: point.y }
    }
    const zoomAtPoint = (point, factor) => setView(zoom.zoomAt(view, base, point, factor))
    const zoomAtCenter = factor => zoomAtPoint({ x: view.x + view.width / 2, y: view.y + view.height / 2 }, factor)

    // Wheel over the map zooms about the pointer. At the whole-lap view a zoom-out wheel is left to the page, so the
    // page keeps scrolling.
    svg.addEventListener('wheel', event => {
      if (event.deltaY === 0) return
      const factor = zoom.wheelZoomFactor(event.deltaY, event.deltaMode, window.innerHeight)
      if (factor < 1 && zoom.isAtBase(view, base)) return
      const point = viewPoint(event.clientX, event.clientY)
      if (!point) return
      event.preventDefault()
      zoomAtPoint(point, factor)
    }, { passive: false })

    // Dragging pans only while zoomed. The inverse matrix is taken at the start, so the pan follows the pointer.
    const endDrag = event => {
      if (!drag || event.pointerId !== drag.pointerId) return
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId)
      drag = null
      svg.classList.remove('is-panning')
    }
    svg.addEventListener('pointerdown', event => {
      if (event.button !== 0 || zoom.isAtBase(view, base)) return
      const matrix = svg.getScreenCTM()
      if (!matrix) return
      drag = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        startView: view,
        inverse: matrix.inverse()
      }
      svg.setPointerCapture(event.pointerId)
      svg.classList.add('is-panning')
      shownHoverKey = null
      inspectorBody.replaceChildren()
      markerCircle.style.display = 'none'
    })
    svg.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.pointerId) return
      const start = new DOMPoint(drag.clientX, drag.clientY).matrixTransform(drag.inverse)
      const now = new DOMPoint(event.clientX, event.clientY).matrixTransform(drag.inverse)
      // The content follows the pointer, so the window moves the opposite way.
      setView(zoom.panBy(drag.startView, base, start.x - now.x, start.y - now.y))
    })
    svg.addEventListener('pointerup', endDrag)
    svg.addEventListener('pointercancel', endDrag)

    // Double-click zooms in twice as far around the clicked point.
    svg.addEventListener('dblclick', event => {
      const point = viewPoint(event.clientX, event.clientY)
      if (point) zoomAtPoint(point, 2)
    })

    zoomInButton.addEventListener('click', () => zoomAtCenter(1.5))
    zoomOutButton.addEventListener('click', () => zoomAtCenter(1 / 1.5))
    fitButton.addEventListener('click', () => setView(zoom.createView(base)))

    // Bounds are viewBox units and the padding is screen pixels of the resulting view. The current screen scale is
    // taken back to the whole-lap view's scale, and fitBoundsPx solves the window width from it.
    const fitToBounds = (bounds, paddingPx, fitted) => {
      const matrix = svg.getScreenCTM()
      const pixelsNow = matrix ? Math.hypot(matrix.a, matrix.b) : 0
      const pixelsPerBaseUnit = pixelsNow > 0 ? pixelsNow * view.width / base.width : 1
      setView(zoom.fitBoundsPx(base, bounds, paddingPx, pixelsPerBaseUnit, zoom.MAX_ZOOM), fitted)
    }
    map.zoomToBounds = (bounds, paddingPx = 24) => fitToBounds(bounds, paddingPx, false)
    map.resetZoom = () => setView(zoom.createView(base))
    applyView()

    const legend = renderTraceLegend(points, lapTimeMs, available, marks)
    const applyLayers = () => {
      const visible = globalThis.EventTraceMap?.visibleLayers(selection.get(), available) ?? available
      for (const group of svg.querySelectorAll('[data-layer-group]')) {
        group.style.display = visible.includes(group.getAttribute('data-layer-group')) ? '' : 'none'
      }
      for (const button of legend.querySelectorAll('[data-layer]')) {
        button.setAttribute('aria-pressed', String(visible.includes(button.dataset.layer)))
      }
    }
    legend.addEventListener('click', event => {
      const button = event.target.closest('button')
      if (!button || button.disabled) return
      selection.set(button.dataset.layer
        ? globalThis.EventTraceMap?.nextLayerSelection(selection.get(), button.dataset.layer, available) ?? null
        : null)
      applyLayers()
    })
    applyLayers()

    // Sector focus. The focused sector keeps its own outline, slip, and pedal runs at full strength while the whole lap
    // is dimmed, and the legend counts only that sector's time. Focus never zooms by itself: FIT SECTOR is a separate
    // action, and any other view change returns it to FIT SECTOR. Without sectorFocus there are no sector ranges, so
    // every function below does nothing.
    const rangeOf = sector => (Number.isInteger(sector) ? sectorRangeList[sector - 1] : undefined) || null
    const boundsOf = range => {
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const point of projected.slice(range.startIndex, range.endIndex + 1)) {
        minX = Math.min(minX, point.x)
        maxX = Math.max(maxX, point.x)
        minY = Math.min(minY, point.y)
        maxY = Math.max(maxY, point.y)
      }
      return { minX, maxX, minY, maxY }
    }
    // While a sector is focused only its points can be picked; the whole lap is searched otherwise.
    const hoverIndex = (x, y, reach) => {
      const range = rangeOf(focusedSector)
      if (!range) return globalThis.EventTraceMap?.nearestPointIndex(projected, x, y, reach) ?? null
      return globalThis.EventTraceMap?.nearestPointIndex(projected, x, y, reach, range.startIndex, range.endIndex) ?? null
    }
    const rebuildFocus = () => {
      if (!focusGroup) return
      focusGroup.replaceChildren()
      const range = rangeOf(focusedSector)
      if (range) {
        const focused = traceLayers(range.startIndex, range.endIndex)
        focusGroup.append(focused.outline, ...(focused.slip ? [focused.slip] : []), ...focused.pedals)
      }
      const dimmed = range !== null
      fullLayers.outline.classList.toggle('events-lap-detail__layer--dimmed', dimmed)
      for (const group of fullLayers.pedals) group.classList.toggle('events-lap-detail__layer--dimmed', dimmed)
      fullLayers.slip?.classList.toggle('events-lap-detail__layer--hidden', dimmed)
      svg.classList.toggle('is-sector-focused', dimmed)
      applyLayers()
    }
    const scopeWord = fullLabel === 'FULL RUN' ? 'RUN' : 'LAP'
    const legendLabel = document.createElement('span')
    legendLabel.className = 'events-lap-detail__legend-label'
    const fullShareText = Object.fromEntries(['throttle', 'brake', 'coast', 'slip'].map(key => [
      key,
      legend.querySelector(`[data-layer="${key}"] .events-lap-detail__stat-value`)?.textContent ?? '—'
    ]))
    // The controls, caption, legend label, and shares all follow the focused sector (or the whole lap).
    const syncSectorFocusUi = () => {
      if (!sectorControls) return
      const range = rangeOf(focusedSector)
      for (const button of sectorControls.querySelectorAll('.events-lap-detail__sector-button')) {
        const sector = Number(button.dataset.sector)
        button.setAttribute('aria-pressed', String(sector === (focusedSector ?? 0)))
        button.disabled = sector > 0 && !rangeOf(sector)
      }
      sectorControls.querySelector('.events-lap-detail__clear-focus').hidden = !range
      const unit = (globalThis.FdcUnits?.distanceLabel() || '').toUpperCase()
      if (range) {
        const from = traceMapDistance(range.startDistanceM)
        const to = traceMapDistance(range.endDistanceM)
        distanceCaption.textContent = from !== null && to !== null
          ? `SECTOR ${focusedSector} · ${from}–${to} ${unit}`
          : `SECTOR ${focusedSector}`
        legendLabel.textContent = `SECTOR ${focusedSector} INPUT TIME`
      } else {
        const total = sectorRangeList.length > 0 ? traceMapDistance(sectorRangeList[2].endDistanceM) : null
        distanceCaption.textContent = total !== null ? `${fullLabel.toUpperCase()} · ${total} ${unit}` : fullLabel.toUpperCase()
        legendLabel.textContent = `${scopeWord} INPUT TIME`
      }
      const shares = range
        ? globalThis.EventTraceMap?.sectorTimeShares(points, lapTimeMs, range, { final: focusedSector === 3 }) ?? null
        : null
      for (const key of ['throttle', 'brake', 'coast', 'slip']) {
        const output = legend.querySelector(`[data-layer="${key}"] .events-lap-detail__stat-value`)
        if (output) output.textContent = range ? traceShareText(shares?.[key]) : fullShareText[key]
      }
    }
    const focusSector = (sector, { notify = false } = {}) => {
      const number = Number(sector)
      const next = rangeOf(number) ? number : null
      if (next === focusedSector) return
      focusedSector = next
      sectorFitted = false
      // POINT DATA and its marker belong to the previous focus, so they clear with it.
      shownHoverKey = null
      inspectorBody.replaceChildren()
      markerCircle.style.display = 'none'
      rebuildFocus()
      applyView()
      syncSectorFocusUi()
      if (notify) options.onSectorChange?.(next)
    }
    if (sectorFocus) {
      legend.prepend(legendLabel)
      sectorControls.addEventListener('click', event => {
        const button = event.target.closest('button')
        if (!button || button.disabled) return
        const clear = button.classList.contains('events-lap-detail__clear-focus')
        focusSector(clear ? null : Number(button.dataset.sector), { notify: true })
      })
      sectorFitButton.addEventListener('click', () => {
        if (focusedSector === null) return
        if (sectorFitted) map.resetZoom()
        else fitToBounds(boundsOf(rangeOf(focusedSector)), 24, true)
      })
      syncSectorFocusUi()
      focusSector(options.initialSector ?? null)
    }
    map.focusSector = sector => focusSector(sector)
    map.getSectorFocus = () => focusedSector

    map.append(...(sectorControls ? [sectorControls] : []), layout, legend)
    if (marks && marks.errors.length > 0) map.append(renderTraceErrorList(marks, points, svg))
    return map
  }

  // Distance for the map caption: two decimals in the display unit, or null without a finite distance.
  function traceMapDistance(meters) {
    const value = globalThis.FdcUnits?.convertDistance(meters)
    return Number.isFinite(value) ? value.toFixed(2) : null
  }

  // A shares value for the legend: whole percent, or a dash when the lap or sector has no time to share.
  function traceShareText(value) {
    return Number.isFinite(value) ? `${value}%` : '—'
  }

  // The sector controls above the map. CLEAR FOCUS is hidden until a sector is focused.
  function renderSectorControls(fullLabel) {
    const row = document.createElement('div')
    row.className = 'events-lap-detail__tools'
    const group = document.createElement('div')
    group.className = 'events-lap-detail__sector-controls'
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', 'Map sector')
    const sectorButton = (sector, text) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'events-lap-detail__sector-button'
      button.dataset.sector = String(sector)
      button.setAttribute('aria-pressed', 'false')
      button.textContent = text
      return button
    }
    group.append(
      sectorButton(0, fullLabel),
      sectorButton(1, 'SECTOR 1'),
      sectorButton(2, 'SECTOR 2'),
      sectorButton(3, 'SECTOR 3')
    )
    const clear = document.createElement('button')
    clear.type = 'button'
    clear.className = 'events-lap-detail__clear-focus'
    clear.textContent = 'CLEAR FOCUS'
    clear.hidden = true
    row.append(group, clear)
    return row
  }

  // FIT SECTOR sits over the map's top-left corner, clear of the zoom controls at the top-right.
  function renderSectorFitButton() {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'events-lap-detail__fit-sector'
    button.textContent = 'FIT SECTOR'
    button.hidden = true
    return button
  }

  // The legacy state for a lap saved before traces were recorded, shown in place of the map when sector focus is on.
  function renderTraceUnavailable() {
    const wrap = document.createElement('div')
    wrap.className = 'events-lap-detail__unavailable'
    const title = document.createElement('h3')
    title.textContent = 'TRACE UNAVAILABLE'
    const text = document.createElement('p')
    text.textContent = 'Sector times are saved. This older lap has no recorded trace.'
    wrap.append(title, text)
    return wrap
  }

  function renderZoomButton(text, label) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'events-lap-detail__zoom-button'
    button.textContent = text
    button.setAttribute('aria-label', label)
    return button
  }

  // Problem segments are drawn thick over a dark casing, one group per problem type; clean checks are small dots.
  function renderTraceMarks(marks, projected) {
    const groups = new Map()
    const groupFor = key => {
      if (!groups.has(key)) groups.set(key, svgElement('g', { class: 'events-lap-detail__marks', 'data-layer-group': key }))
      return groups.get(key)
    }
    marks.errors.forEach((mark, index) => {
      const pointsText = projected.slice(mark.startIndex, mark.endIndex + 1).map(point => `${point.x},${point.y}`).join(' ')
      const group = groupFor(mark.kind)
      group.append(
        svgElement('polyline', { class: 'events-lap-detail__mark-casing', points: pointsText, 'data-mark-index': index }),
        svgElement('polyline', { class: `events-lap-detail__mark events-lap-detail__mark--${mark.kind}`, points: pointsText, 'data-mark-index': index })
      )
    })
    for (const mark of marks.clean) {
      const point = projected[mark.index]
      groupFor('clean').append(svgElement('circle', { class: 'events-lap-detail__clean', cx: point.x, cy: point.y, r: 5 }))
    }
    const order = [...(globalThis.DriverAnalysisMap?.ERROR_TYPES || []), 'clean']
    return [...groups.entries()].sort(([left], [right]) => order.indexOf(right) - order.indexOf(left)).map(([, group]) => group)
  }

  // Every problem of the drive in order; selecting one highlights it on the map.
  function renderTraceErrorList(marks, points, svg) {
    const list = document.createElement('div')
    list.className = 'events-lap-detail__errors'
    marks.errors.forEach((mark, index) => {
      const model = globalThis.DriverAnalysisMap?.errorTooltipModel(mark, points)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'events-lap-detail__error'
      button.setAttribute('aria-pressed', 'false')
      const swatch = document.createElement('span')
      swatch.className = `events-lap-detail__swatch events-lap-detail__swatch--${mark.kind}`
      swatch.setAttribute('aria-hidden', 'true')
      const name = document.createElement('span')
      name.className = 'events-lap-detail__error-name'
      name.textContent = model?.heading || mark.kind
      const where = document.createElement('span')
      where.className = 'events-lap-detail__error-where'
      where.textContent = model?.subtitle || ''
      button.append(swatch, name, where)
      button.addEventListener('click', () => {
        const selected = button.getAttribute('aria-pressed') !== 'true'
        for (const other of list.querySelectorAll('.events-lap-detail__error')) other.setAttribute('aria-pressed', 'false')
        button.setAttribute('aria-pressed', String(selected))
        for (const line of svg.querySelectorAll('[data-mark-index]')) {
          line.classList.toggle('is-selected', selected && line.getAttribute('data-mark-index') === String(index))
        }
      })
      list.append(button)
    })
    return list
  }

  // One row under the map: each pedal layer with its share of lap time, SLIP with its time above 100% combined
  // slip, and ALL to show every layer again. The buttons also select the visible layers.
  function renderTraceLegend(points, lapTimeMs, available, marks = null) {
    const legend = document.createElement('div')
    legend.className = 'events-lap-detail__legend'
    if (marks) {
      const counts = globalThis.DriverAnalysisMap?.errorCounts(marks) || {}
      for (const key of available.filter(layer => !['throttle', 'brake', 'coast', 'slip'].includes(layer))) {
        const label = key === 'clean' ? 'CLEAN' : globalThis.DriverAnalysisMap?.ERROR_SHORT_LABELS?.[key] || key.toUpperCase()
        legend.append(renderLegendButton(key, label, String(key === 'clean' ? marks.clean.length : counts[key] || 0)))
      }
    }
    const pedalShares = traceStats(points, lapTimeMs)
    const slipShare = globalThis.EventTraceMap?.slipTimeShare(points, lapTimeMs) ?? null
    const labels = [
      ['throttle', 'THROTTLE'],
      ['brake', 'BRAKE'],
      ['coast', 'COAST'],
      ['slip', 'SLIP']
    ]
    for (const [key, label] of labels) {
      const share = key === 'slip' ? slipShare : pedalShares?.[key]
      const button = renderLegendButton(key, label, Number.isFinite(share) ? `${share}%` : '—')
      if (!available.includes(key)) {
        button.disabled = true
        button.title = 'Extended telemetry was not recorded for this lap'
      }
      legend.append(button)
    }
    const all = document.createElement('button')
    all.type = 'button'
    all.className = 'events-lap-detail__legend-all'
    all.textContent = 'ALL'
    legend.append(all)
    return legend
  }

  function renderLegendButton(key, label, valueText) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `events-lap-detail__stat events-lap-detail__stat--${key}`
    button.dataset.layer = key
    const swatch = document.createElement('span')
    swatch.className = `events-lap-detail__swatch events-lap-detail__swatch--${key}`
    swatch.setAttribute('aria-hidden', 'true')
    const name = document.createElement('span')
    name.className = 'events-lap-detail__stat-name'
    name.textContent = label
    const value = document.createElement('output')
    value.className = 'events-lap-detail__stat-value'
    value.textContent = valueText
    button.append(swatch, name, value)
    return button
  }

  function renderErrorTooltip(container, model) {
    const heading = document.createElement('div')
    heading.className = `events-lap-detail__tooltip-heading events-lap-detail__tooltip-heading--${model.kind}`
    heading.textContent = model.heading
    const subtitle = document.createElement('div')
    subtitle.className = 'events-lap-detail__tooltip-caption'
    subtitle.textContent = model.subtitle
    container.append(heading, subtitle)
    for (const text of model.lines || []) {
      const line = document.createElement('div')
      line.className = 'events-lap-detail__tooltip-line'
      line.textContent = text
      container.append(line)
    }
    if (model.instruction) {
      const instruction = document.createElement('div')
      instruction.className = 'events-lap-detail__tooltip-instruction'
      instruction.textContent = `→ ${model.instruction}`
      container.append(instruction)
    }
  }

  function renderTooltip(container, model) {
    container.replaceChildren()
    if (model.heading) {
      renderErrorTooltip(container, model)
      return
    }

    // DIST and TIME lead the panel in large type; the other values sit in two columns below.
    const appendMetrics = (className, rows) => {
      if (!rows.length) return
      const group = document.createElement('div')
      group.className = className
      for (const row of rows) {
        const metric = document.createElement('div')
        metric.className = 'events-lap-detail__point-metric'
        const label = document.createElement('span')
        label.className = 'events-lap-detail__tooltip-label'
        label.textContent = row.label
        const value = document.createElement('span')
        value.className = 'events-lap-detail__tooltip-value'
        value.textContent = row.value
        metric.append(label, value)
        group.append(metric)
      }
      container.append(group)
    }
    const isLead = row => row.label === 'DIST' || row.label === 'TIME'
    appendMetrics('events-lap-detail__point-lead', model.rows.filter(isLead))
    appendMetrics('events-lap-detail__point-metrics', model.rows.filter(row => !isLead(row)))

    // Wheel table
    if (model.wheelTable.length > 0) {
      const table = document.createElement('table')
      table.className = 'events-lap-detail__tooltip-table'
      const headerRow = document.createElement('tr')
      const headerLabel = document.createElement('th')
      headerLabel.textContent = ''
      headerRow.append(headerLabel)
      for (const wheel of ['Fl', 'Fr', 'Rl', 'Rr']) {
        const th = document.createElement('th')
        th.textContent = wheel.toUpperCase()
        headerRow.append(th)
      }
      table.append(headerRow)

      for (const row of model.wheelTable) {
        const tr = document.createElement('tr')
        const labelTd = document.createElement('td')
        labelTd.className = 'events-lap-detail__tooltip-wheel-label'
        labelTd.textContent = row.label
        tr.append(labelTd)
        for (const wheel of ['Fl', 'Fr', 'Rl', 'Rr']) {
          const td = document.createElement('td')
          td.textContent = row.values?.[wheel] ?? '—'
          tr.append(td)
        }
        table.append(tr)
      }
      container.append(table)
    }

    // Curb row
    if (model.curbRow) {
      const div = document.createElement('div')
      div.className = 'events-lap-detail__tooltip-row'
      const label = document.createElement('span')
      label.className = 'events-lap-detail__tooltip-label'
      label.textContent = model.curbRow.label
      const value = document.createElement('span')
      value.className = 'events-lap-detail__tooltip-value'
      value.textContent = model.curbRow.wheels.map(wheel => wheel.toUpperCase()).join(', ')
      div.append(label, value)
      container.append(div)
    }

    // Puddle row
    if (model.puddleRow) {
      const div = document.createElement('div')
      div.className = 'events-lap-detail__tooltip-row'
      const label = document.createElement('span')
      label.className = 'events-lap-detail__tooltip-label'
      label.textContent = model.puddleRow.label
      const value = document.createElement('span')
      value.className = 'events-lap-detail__tooltip-value'
      value.textContent = Object.entries(model.puddleRow.wheels).map(([w, d]) => `${w.toUpperCase()} ${d}`).join(', ')
      div.append(label, value)
      container.append(div)
    }

    if (model.notes?.length) {
      const notes = document.createElement('div')
      notes.className = 'events-lap-detail__point-notes'
      for (const note of model.notes) {
        const caption = document.createElement('div')
        caption.className = 'events-lap-detail__tooltip-caption'
        caption.textContent = note
        notes.append(caption)
      }
      container.append(notes)
    }
  }

  return {
    renderTraceMap,
    traceStats,
    traceState,
    traceMapDistance,
    traceShareText
  }
}))

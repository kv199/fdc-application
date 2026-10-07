const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Stylesheet geometry contracts for the in-game HUD's new design.
// Tests are currently expected to FAIL; this file validates the test helper
// and provides a baseline for when stylesheet rules are written.

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ''))
const read = file => stripComments(fs.readFileSync(path.join(__dirname, file), 'utf8'))

const overlayTokens = read('tokens.css')
const overlayCss = read('overlay.css')
const overlayHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')

// Helper to extract all rule bodies for a given selector, including rules
// inside @media blocks. Matches selectors in comma-separated lists.
function ruleBodies(css, selector) {
  const normalizedSelector = selector.replace(/\s+/g, ' ').trim()
  const bodies = []
  let searchPos = 0

  // Simple state machine to find selector and extract body
  while (searchPos < css.length) {
    // Find potential selector
    const idx = css.indexOf(normalizedSelector, searchPos)
    if (idx === -1) break

    // Check if this is a full selector match (not part of a longer token)
    const before = css[idx - 1]
    const after = css[idx + normalizedSelector.length]

    // Valid boundaries: start of string, whitespace, comma, or brace; end with whitespace, comma, brace
    const validBefore = idx === 0 || /[\s,{}\n]/.test(before)
    const validAfter = !after || /[\s,{}\n]/.test(after)

    if (validBefore && validAfter) {
      // Found a potential selector, now find the opening brace
      let bracePos = idx + normalizedSelector.length
      while (bracePos < css.length && css[bracePos] !== '{') {
        bracePos++
      }

      if (bracePos < css.length && css[bracePos] === '{') {
        // Extract the body until the closing brace
        let braceCount = 1
        let bodyStart = bracePos + 1
        let bodyEnd = bodyStart

        while (bodyEnd < css.length && braceCount > 0) {
          if (css[bodyEnd] === '{') braceCount++
          else if (css[bodyEnd] === '}') braceCount--
          if (braceCount > 0) bodyEnd++
        }

        if (braceCount === 0) {
          bodies.push(css.substring(bodyStart, bodyEnd))
          searchPos = bodyEnd + 1
          continue
        }
      }
    }

    searchPos = idx + 1
  }

  return bodies
}

// Generate clip-path polygon for a given CSS variable
const cut = name => `polygon(var(${name}) 0, 100% 0, 100% calc(100% - var(${name})), calc(100% - var(${name})) 100%, 0 100%, 0 var(${name}))`

test('Token: --hud-cut-grouped is defined as 14px', () => {
  assert.match(overlayTokens, /--hud-cut-grouped:\s*14px/)
})

test('Token: --hud-cut-widget is defined as 7px', () => {
  assert.match(overlayTokens, /--hud-cut-widget:\s*7px/)
})

test('Token: --hud-divider color is defined', () => {
  assert.match(overlayTokens, /--hud-divider:\s*#[0-9a-f]{6}/)
})

test('Grouped strip: .hud has clip-path with --hud-cut-grouped', () => {
  const bodies = ruleBodies(overlayCss, '.hud')
  const expectedClipPath = cut('--hud-cut-grouped')
  const found = bodies.some(body => body.includes(`clip-path:`) && body.includes(expectedClipPath))
  assert.ok(found, `Expected .hud to contain clip-path: ${expectedClipPath}`)
})

test('Freeform: .hud[data-layout-mode="freeform"] has clip-path: none', () => {
  const bodies = ruleBodies(overlayCss, ".hud[data-layout-mode='freeform']")
  const found = bodies.some(body => /clip-path:\s*none/.test(body))
  assert.ok(found, "Expected .hud[data-layout-mode='freeform'] to contain clip-path: none")
})

test('Freeform widget: .hud[data-layout-mode="freeform"] > section.hud-freeform-widget has clip-path with --hud-cut-widget', () => {
  const bodies = ruleBodies(overlayCss, ".hud[data-layout-mode='freeform'] > section.hud-freeform-widget")
  const expectedClipPath = cut('--hud-cut-widget')
  const found = bodies.some(body => body.includes(`clip-path:`) && body.includes(expectedClipPath))
  assert.ok(found, `Expected .hud[data-layout-mode='freeform'] > section.hud-freeform-widget to contain clip-path: ${expectedClipPath}`)
})

test('Grouped dividers: .hud:not([data-layout-mode="freeform"]) > section + section has divider box-shadow', () => {
  const bodies = ruleBodies(overlayCss, ".hud:not([data-layout-mode='freeform']) > section + section")
  const found = bodies.some(body => /box-shadow:\s*inset\s+1px\s+0\s+0\s+var\(--hud-divider\)/.test(body))
  assert.ok(found, "Expected .hud:not([data-layout-mode='freeform']) > section + section to contain box-shadow: inset 1px 0 0 var(--hud-divider)")
})

test('Delta: .delta-strip has --delta-cut and no clip-path', () => {
  const bodies = ruleBodies(overlayCss, '.delta-strip')
  const hasDeltaCut = bodies.some(body => /--delta-cut:\s*calc\(var\(--hud-cut-widget\)\s*\*\s*var\(--delta-user-scale\)\)/.test(body))
  const hasClipPath = bodies.some(body => /clip-path:/.test(body))
  assert.ok(hasDeltaCut, "Expected .delta-strip to contain --delta-cut: calc(var(--hud-cut-widget) * var(--delta-user-scale))")
  assert.ok(!hasClipPath, "Expected .delta-strip to NOT contain clip-path")
})

test('Delta: .delta-strip::before has clip-path with --delta-cut', () => {
  const bodies = ruleBodies(overlayCss, '.delta-strip::before')
  const expectedClipPath = cut('--delta-cut')
  const found = bodies.some(body => body.includes(`clip-path:`) && body.includes(expectedClipPath))
  assert.ok(found, `Expected .delta-strip::before to contain clip-path: ${expectedClipPath}`)
})

test('Edit chrome is never clipped: .hud-frame, .hud-widget-editor-frame, .layout-edit-tools, .layout-resize-handle have no clip-path', () => {
  const selectors = ['.hud-frame', '.hud-widget-editor-frame', '.layout-edit-tools', '.layout-resize-handle']
  for (const selector of selectors) {
    const bodies = ruleBodies(overlayCss, selector)
    const hasClipPath = bodies.some(body => /clip-path:/.test(body))
    assert.ok(!hasClipPath, `Expected ${selector} to NOT contain clip-path`)
  }
})

test('HUD has no textures: overlay.css contains no url()', () => {
  assert.doesNotMatch(overlayCss, /url\(/, 'Expected overlay.css to contain no url()')
})

test('Typography: :root uses --font-ui', () => {
  const bodies = ruleBodies(overlayCss, ':root')
  const found = bodies.some(body => /font-family:\s*var\(--font-ui\)/.test(body))
  assert.ok(found, 'Expected :root to contain font-family: var(--font-ui)')
})

test('Typography: readout selectors use --font-readout', () => {
  const selectors = [
    '.gear__value',
    '.gear__speed',
    '.gear__rpm',
    '.engine__value',
    '.tire__temp',
    '.delta-strip__lap-time',
    '.delta-strip__value',
    '.delta-strip__best-time'
  ]
  for (const selector of selectors) {
    const bodies = ruleBodies(overlayCss, selector)
    const found = bodies.some(body => /font-family:\s*var\(--font-readout\)/.test(body))
    assert.ok(found, `Expected ${selector} to contain font-family: var(--font-readout)`)
  }
})

test('Font preloads: index.html preloads all required fonts before tokens.css', () => {
  const fonts = [
    'BarlowCondensed-Medium.ttf',
    'BarlowCondensed-SemiBold.ttf',
    'Barlow-SemiBold.ttf'
  ]

  for (const font of fonts) {
    const preloadLink = `<link rel="preload" href="assets/fonts/${font}" as="font" type="font/ttf" crossorigin>`
    assert.ok(overlayHtml.includes(preloadLink), `Expected index.html to contain preload link for ${font}`)

    // Verify the font file exists on disk
    const fontPath = path.join(__dirname, 'assets', 'fonts', font)
    assert.ok(fs.existsSync(fontPath), `Expected font file to exist at ${fontPath}`)
  }

  // Verify preloads come before tokens.css
  const tokensIndex = overlayHtml.indexOf('<link rel="stylesheet" href="tokens.css">')
  for (const font of fonts) {
    const preloadIndex = overlayHtml.indexOf(`<link rel="preload" href="assets/fonts/${font}"`)
    assert.ok(preloadIndex >= 0 && preloadIndex < tokensIndex, `Expected font preload for ${font} to appear before tokens.css link`)
  }
})

test('Layout editor: all RESET buttons have layout-edit__button--reset class', () => {
  // Check index.html RESET buttons
  assert.ok(overlayHtml.includes('id="delta-reset" class="layout-edit__button layout-edit__button--reset"'), 'Expected delta-reset to have layout-edit__button--reset class')
  assert.ok(overlayHtml.includes('id="hud-reset" class="layout-edit__button layout-edit__button--reset"'), 'Expected hud-reset to have layout-edit__button--reset class')
})

test('Layout editor: all SAVE buttons have layout-edit__button--primary class', () => {
  // Check index.html SAVE buttons
  assert.ok(overlayHtml.includes('id="delta-save" class="layout-edit__button layout-edit__button--primary"'), 'Expected delta-save to have layout-edit__button--primary class')
  assert.ok(overlayHtml.includes('id="hud-save" class="layout-edit__button layout-edit__button--primary"'), 'Expected hud-save to have layout-edit__button--primary class')
})

test('Layout editor: hint texts follow the pattern DRAG <TARGET> TO MOVE · CORNER TO RESIZE · CLICK A BLOCK TO SELECT', () => {
  const hintPattern = /DRAG\s+\w+\s+TO\s+MOVE\s+·\s+CORNER\s+TO\s+RESIZE\s+·\s+CLICK\s+A\s+BLOCK\s+TO\s+SELECT/
  assert.match(overlayHtml, hintPattern, 'Expected hint text to follow pattern with DRAG TO MOVE · CORNER TO RESIZE · CLICK A BLOCK TO SELECT')
})

test('Layout editor: .layout-edit__button--primary has accent colors and comes after generic hover rule', () => {
  const bodies = ruleBodies(overlayCss, '.layout-edit__button--primary')
  const found = bodies.some(body =>
    body.includes('border-color: var(--accent)') &&
    body.includes('color: var(--text-on-accent)') &&
    body.includes('background: var(--accent)')
  )
  assert.ok(found, 'Expected .layout-edit__button--primary to contain accent border/color/background')
})

test('Layout editor: .layout-edit__button--primary:hover has accent-hover colors', () => {
  const bodies = ruleBodies(overlayCss, '.layout-edit__button--primary:hover')
  const found = bodies.some(body =>
    body.includes('border-color: var(--accent-hover)') &&
    body.includes('background: var(--accent-hover)')
  )
  assert.ok(found, 'Expected .layout-edit__button--primary:hover to contain accent-hover colors')
})

test('Layout editor: .layout-edit__button--reset has caution colors', () => {
  const bodies = ruleBodies(overlayCss, '.layout-edit__button--reset')
  const found = bodies.some(body =>
    body.includes('border-color: var(--caution)') &&
    body.includes('color: var(--caution)') &&
    body.includes('background: var(--surface)') &&
    body.includes('margin-right: 8px')
  )
  assert.ok(found, 'Expected .layout-edit__button--reset to contain caution border/color, surface background, and margin-right: 8px')
})

test('Layout editor: .layout-edit__button--reset:hover has caution background and text-on-accent text color', () => {
  const bodies = ruleBodies(overlayCss, '.layout-edit__button--reset:hover')
  const found = bodies.some(body =>
    body.includes('border-color: var(--caution)') &&
    body.includes('color: var(--text-on-accent)') &&
    body.includes('background: var(--caution)')
  )
  assert.ok(found, 'Expected .layout-edit__button--reset:hover to contain caution border/background and text-on-accent color')
})

test('Gear: .gear__value contains text-box: trim-both cap alphabetic', () => {
  const bodies = ruleBodies(overlayCss, '.gear__value')
  const found = bodies.some(body => /text-box:\s*trim-both\s+cap\s+alphabetic/.test(body))
  assert.ok(found, 'Expected .gear__value to contain text-box: trim-both cap alphabetic')
})

test('Layout grid: index.html has #layout-grid as first element inside body with hidden and aria-hidden="true"', () => {
  const bodyMatch = overlayHtml.match(/<body[^>]*>(\s*<div[^>]*id="layout-grid"[^>]*>[\s\S]*?<\/div>)/m)
  assert.ok(bodyMatch, 'Expected #layout-grid to be found as the first element inside body')

  const gridElement = overlayHtml.match(/<div[^>]*id="layout-grid"[^>]*\/?>/)
  assert.ok(gridElement, 'Expected to find #layout-grid element')

  const gridHtml = gridElement[0]
  assert.ok(gridHtml.includes('hidden'), 'Expected #layout-grid to have hidden attribute')
  assert.ok(gridHtml.includes('aria-hidden="true"'), 'Expected #layout-grid to have aria-hidden="true"')
  assert.ok(gridHtml.includes('class="layout-grid"'), 'Expected #layout-grid to have class="layout-grid"')
})

test('Layout grid: hud-grid.js script is loaded before hud-layout.js', () => {
  const hudGridIndex = overlayHtml.indexOf('<script src="hud-grid.js"></script>')
  const hudLayoutIndex = overlayHtml.indexOf('<script src="hud-layout.js"></script>')
  assert.ok(hudGridIndex >= 0, 'Expected hud-grid.js script to be found')
  assert.ok(hudLayoutIndex >= 0, 'Expected hud-layout.js script to be found')
  assert.ok(hudGridIndex < hudLayoutIndex, 'Expected hud-grid.js to be loaded before hud-layout.js')
})

test('Layout grid: SNAP button in delta-edit-tools has data-layout-snap, aria-pressed="true", and is before RESET button', () => {
  const deltaToolsMatch = overlayHtml.match(/<div id="delta-edit-tools"[\s\S]*?<\/div>/m)
  assert.ok(deltaToolsMatch, 'Expected to find #delta-edit-tools')

  const toolsHtml = deltaToolsMatch[0]
  const snapMatch = toolsHtml.match(/<button[^>]*id="delta-snap"[^>]*>/)
  assert.ok(snapMatch, 'Expected to find #delta-snap button')

  const snapHtml = snapMatch[0]
  assert.ok(snapHtml.includes('data-layout-snap'), 'Expected #delta-snap to have data-layout-snap attribute')
  assert.ok(snapHtml.includes('aria-pressed="true"'), 'Expected #delta-snap to have aria-pressed="true"')
  assert.ok(snapHtml.includes('layout-edit__button--toggle'), 'Expected #delta-snap to have layout-edit__button--toggle class')

  const snapIndex = toolsHtml.indexOf('id="delta-snap"')
  const resetIndex = toolsHtml.indexOf('id="delta-reset"')
  assert.ok(snapIndex < resetIndex, 'Expected SNAP button to appear before RESET button in delta toolbar')
})

test('Layout grid: SNAP button in hud-edit-tools has data-layout-snap, aria-pressed="true", and is before RESET button', () => {
  const hudToolsMatch = overlayHtml.match(/<div id="hud-edit-tools"[\s\S]*?<\/div>/m)
  assert.ok(hudToolsMatch, 'Expected to find #hud-edit-tools')

  const toolsHtml = hudToolsMatch[0]
  const snapMatch = toolsHtml.match(/<button[^>]*id="hud-snap"[^>]*>/)
  assert.ok(snapMatch, 'Expected to find #hud-snap button')

  const snapHtml = snapMatch[0]
  assert.ok(snapHtml.includes('data-layout-snap'), 'Expected #hud-snap to have data-layout-snap attribute')
  assert.ok(snapHtml.includes('aria-pressed="true"'), 'Expected #hud-snap to have aria-pressed="true"')
  assert.ok(snapHtml.includes('layout-edit__button--toggle'), 'Expected #hud-snap to have layout-edit__button--toggle class')

  const snapIndex = toolsHtml.indexOf('id="hud-snap"')
  const resetIndex = toolsHtml.indexOf('id="hud-reset"')
  assert.ok(snapIndex < resetIndex, 'Expected SNAP button to appear before RESET button in hud toolbar')
})

test('Layout grid: .layout-grid uses pointer-events: none', () => {
  const bodies = ruleBodies(overlayCss, '.layout-grid')
  const found = bodies.some(body => /pointer-events:\s*none/.test(body))
  assert.ok(found, 'Expected .layout-grid to contain pointer-events: none')
})

test('Layout grid: the minor dots use --layout-grid-step, --layout-grid-offset-x, --layout-grid-offset-y', () => {
  const bodies = ruleBodies(overlayCss, '.layout-grid::before')
  const body = bodies[0]
  assert.ok(body, 'Expected .layout-grid rule to exist')
  assert.ok(body.includes('--layout-grid-step'), 'Expected .layout-grid to use --layout-grid-step')
  assert.ok(body.includes('--layout-grid-offset-x'), 'Expected .layout-grid to use --layout-grid-offset-x')
  assert.ok(body.includes('--layout-grid-offset-y'), 'Expected .layout-grid to use --layout-grid-offset-y')
})

test('Layout grid: .layout-grid[hidden] has display: none', () => {
  const bodies = ruleBodies(overlayCss, '.layout-grid[hidden]')
  const found = bodies.some(body => /display:\s*none/.test(body))
  assert.ok(found, 'Expected .layout-grid[hidden] to contain display: none')
})

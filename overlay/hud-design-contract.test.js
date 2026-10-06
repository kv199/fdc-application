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

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const stylesDir = process.env.FDC_STYLES_DIR || __dirname
const read = file => fs.readFileSync(path.join(stylesDir, file), 'utf8')
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ''))

// Calls callback(selector, body, line) for every style rule, including rules
// inside @media and @supports. `line` is the line of the rule's opening brace,
// where its body starts. @keyframes and @font-face blocks are not style rules.
const walkRules = (css, callback) => {
  const lineAt = index => css.slice(0, index).split('\n').length
  const closingBrace = open => {
    let depth = 1
    let index = open + 1
    while (depth > 0 && index < css.length) {
      if (css[index] === '{') depth++
      if (css[index] === '}') depth--
      index++
    }
    return index - 1
  }
  const walk = (start, end) => {
    let index = start
    while (index < end) {
      const open = css.indexOf('{', index)
      if (open === -1 || open >= end) return
      const close = closingBrace(open)
      const prelude = css.slice(index, open).trim()
      if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
        walk(open + 1, close)
      } else if (!prelude.startsWith('@') && prelude) {
        callback(prelude, css.slice(open + 1, close), lineAt(open))
      }
      index = close + 1
    }
  }
  walk(0, css.length)
}

test('Square corners: border-radius is 0 or 50%', () => {
  for (const file of ['settings.css', 'overlay.css']) {
    const css = stripComments(read(file))
    const offenders = []

    walkRules(css, (selector, body, line) => {
      const allowedSelectors = file === 'overlay.css' ? ['.tire', '.pedal__track'] : []
      const isAllowed = allowedSelectors.some(s => selector.includes(s))
      if (isAllowed) return

      const matches = body.matchAll(/border-radius\s*:\s*([^;]+)/g)
      for (const match of matches) {
        const value = match[1].trim()
        if (value !== '0' && value !== '50%' && value !== 'inherit') {
          const bodyLines = body.split('\n')
          const matchLine = line + body.slice(0, match.index).split('\n').length - 1
          offenders.push(`${file}:${matchLine}: ${match[0].trim()}`)
        }
      }
    })

    assert.deepEqual(offenders, [], `Square corners violation in ${file}:\n${offenders.join('\n')}`)
  }
})

test('Visible focus: no outline:none on :focus-visible', () => {
  const offenders = []

  for (const file of ['settings.css', 'overlay.css']) {
    const css = stripComments(read(file))
    walkRules(css, (selector, body, line) => {
      if (!selector.includes(':focus-visible')) return

      const outlineMatches = body.matchAll(/outline\s*:\s*(?:none|0)(?:\s|;|$)/gi)
      for (const match of outlineMatches) {
        const bodyLines = body.split('\n')
        const matchLine = line + body.slice(0, match.index).split('\n').length - 1
        offenders.push(`${file}:${matchLine}: ${match[0].trim()}`)
      }
    })
  }

  assert.deepEqual(offenders, [], `Visible focus violation:\n${offenders.join('\n')}`)
})

test('Flat surfaces: no glow shadow, radial-gradient, or var(--accent) in linear-gradient', () => {
  const offenders = []

  for (const file of ['settings.css', 'overlay.css']) {
    const css = stripComments(read(file))
    walkRules(css, (selector, body, line) => {
      const boxShadowMatches = body.matchAll(/box-shadow\s*:\s*([^;]+)/g)
      for (const match of boxShadowMatches) {
        const value = match[1].trim()
        // A glow has no offset and a blur; `0 0 0 2px` is a crisp ring and is allowed.
        if (/(?:^|,)\s*(?:inset\s+)?0(?:px)?\s+0(?:px)?\s+(?!0(?:px)?\b)\d*\.?\d+px/i.test(value)) {
          const matchLine = line + body.slice(0, match.index).split('\n').length - 1
          offenders.push(`${file}:${matchLine}: glow shadow: ${value}`)
        }
      }

      const radialMatches = body.matchAll(/radial-gradient\s*\(/gi)
      for (const match of radialMatches) {
        const matchLine = line + body.slice(0, match.index).split('\n').length - 1
        offenders.push(`${file}:${matchLine}: radial-gradient found`)
      }

      const linearMatches = body.matchAll(/linear-gradient\s*\([^)]*var\(--accent\)[^)]*\)/g)
      for (const match of linearMatches) {
        const isSliderFill = selector.includes('input') && body.includes('--brightness-fill')
        if (!isSliderFill) {
          const matchLine = line + body.slice(0, match.index).split('\n').length - 1
          offenders.push(`${file}:${matchLine}: linear-gradient with var(--accent): ${match[0].trim()}`)
        }
      }
    })
  }

  assert.deepEqual(offenders, [], `Flat surfaces violation:\n${offenders.join('\n')}`)
})

test('Fonts by token: font-family uses var(--font-*) or inherit', () => {
  const offenders = []

  for (const file of ['settings.css', 'overlay.css']) {
    const css = stripComments(read(file))
    walkRules(css, (selector, body, line) => {
      const fontFamilyMatches = body.matchAll(/font\s*:\s*([^;]+)/g)
      for (const match of fontFamilyMatches) {
        const value = match[1].trim()
        if (value.includes('inherit')) continue
        const hasFontFamily = /font-family/.test(value)
        if (hasFontFamily && !/var\(--font-/.test(value)) {
          const matchLine = line + body.slice(0, match.index).split('\n').length - 1
          offenders.push(`${file}:${matchLine}: ${match[0].trim()}`)
        }
      }

      const fontFamilyOnlyMatches = body.matchAll(/font-family\s*:\s*([^;]+)/g)
      for (const match of fontFamilyOnlyMatches) {
        const value = match[1].trim()
        if (value !== 'inherit' && !/var\(--font-/.test(value)) {
          const matchLine = line + body.slice(0, match.index).split('\n').length - 1
          offenders.push(`${file}:${matchLine}: ${match[0].trim()}`)
        }
      }
    })
  }

  assert.deepEqual(offenders, [], `Fonts by token violation:\n${offenders.join('\n')}`)
})

test('No textures outside header: url() restricted', () => {
  const offenders = []
  const css = {
    'settings.css': stripComments(read('settings.css')),
    'overlay.css': stripComments(read('overlay.css'))
  }

  walkRules(css['settings.css'], (selector, body, line) => {
    if (!selector.includes('.settings-header::before')) {
      const urlMatches = body.matchAll(/url\s*\(/gi)
      for (const match of urlMatches) {
        const matchLine = line + body.slice(0, match.index).split('\n').length - 1
        offenders.push(`settings.css:${matchLine}: url() outside .settings-header::before in ${selector}`)
      }
    }
  })

  walkRules(css['overlay.css'], (selector, body, line) => {
    const urlMatches = body.matchAll(/url\s*\(/gi)
    for (const match of urlMatches) {
      const matchLine = line + body.slice(0, match.index).split('\n').length - 1
      offenders.push(`overlay.css:${matchLine}: url() found in ${selector}`)
    }
  })

  assert.deepEqual(offenders, [], `Texture violation:\n${offenders.join('\n')}`)
})

test('No disabled hover fills: .settings-button hover/focus needs :not(:disabled)', () => {
  const offenders = []
  const css = stripComments(read('settings.css'))

  walkRules(css, (selector, body, line) => {
    const hasHoverOrFocus = /:(?:hover|focus-visible)/.test(selector)
    const isSettingsButton = /\.settings-button/.test(selector)

    if (hasHoverOrFocus && isSettingsButton) {
      const hasNotDisabled = /:not\(\s*:disabled\s*\)/.test(selector)
      if (!hasNotDisabled) {
        offenders.push(`settings.css:${line}: ${selector}`)
      }
    }
  })

  assert.deepEqual(offenders, [], `Disabled hover fills violation:\n${offenders.join('\n')}`)
})

// A state class on a .settings-button element (RECORD RUN, a dialog's YES or
// NO, ...) must win over the base lime hover rule; otherwise its own hover or
// focus color silently never shows.
test('Button state hovers are not shadowed by the base button hover', () => {
  const css = stripComments(read('settings.css'))
  const markup = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8') +
    fs.readFileSync(path.join(__dirname, 'settings.js'), 'utf8')
  const partners = new Set()
  for (const match of markup.matchAll(/["'`]([^"'`]*\bsettings-button\b[^"'`]*)["'`]/g)) {
    for (const name of match[1].split(/\s+/)) {
      if (/^[a-z][\w-]*$/.test(name) && name !== 'settings-button') partners.add(name)
    }
  }
  const specificity = selector => {
    const flat = selector.replace(/:not\(([^)]*)\)/g, ' $1')
    return (flat.match(/#[\w-]+/g) || []).length * 100 +
      (flat.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length
  }
  const baseSelector = '.settings-button:not(:disabled):hover'
  let baseLine = 0
  walkRules(css, (selector, body, line) => {
    if (selector.split(',').some(part => part.trim() === baseSelector)) baseLine = line
  })
  assert.ok(baseLine, `Expected the base ${baseSelector} rule`)

  const offenders = []
  walkRules(css, (selector, body, line) => {
    if (!/background|color|border/.test(body)) return
    for (const part of selector.split(',').map(item => item.trim())) {
      if (!/:hover|:focus-visible/.test(part)) continue
      if (![...part.matchAll(/\.([\w-]+)/g)].some(match => partners.has(match[1]))) continue
      const spec = specificity(part)
      const baseSpec = specificity(baseSelector)
      if (spec < baseSpec || (spec === baseSpec && line < baseLine)) offenders.push(`settings.css:${line}: ${part}`)
    }
  })
  assert.deepEqual(offenders, [], `Give these a compound .settings-button selector:\n${offenders.join('\n')}`)
})

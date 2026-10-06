const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Stylesheet colors live in tokens.css. These checks keep literals from
// creeping back and catch token typos, which would silently drop a color.
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8')
const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ''))
const declared = css => new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(match => match[1]))

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/
const tokens = declared(stripComments(read('tokens.css')))
const stylesheets = ['settings.css', 'overlay.css']
// Custom properties the runtime sets on elements, e.g. --hud-widget-scale.
const runtimeProperties = new Set(fs.readdirSync(__dirname)
  .filter(file => file.endsWith('.js') && !file.endsWith('.test.js'))
  .flatMap(file => [...read(file).matchAll(/setProperty\(\s*['"](--[a-z0-9-]+)['"]/g)].map(match => match[1])))

test('Stylesheets use color tokens instead of color literals', () => {
  for (const file of stylesheets) {
    const offenders = stripComments(read(file))
      .split('\n')
      .flatMap((line, index) => COLOR_LITERAL.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])
    assert.deepEqual(offenders, [], `Move these colors to tokens.css:\n${offenders.join('\n')}`)
  }
})

test('Stylesheets reference only defined tokens or custom properties', () => {
  for (const file of stylesheets) {
    const css = stripComments(read(file))
    const local = declared(css)
    // A reference with a fallback, var(--name, value), is defined by its fallback.
    const missing = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)].map(match => match[1]))]
      .filter(name => !tokens.has(name) && !local.has(name) && !runtimeProperties.has(name))
    assert.deepEqual(missing, [], `${file} references undefined custom properties`)
  }
})

test('Both pages load tokens.css before their own stylesheet', () => {
  for (const [page, stylesheet] of [['settings.html', 'settings.css'], ['index.html', 'overlay.css']]) {
    const html = read(page)
    const tokensLink = html.indexOf('<link rel="stylesheet" href="tokens.css">')
    assert.ok(tokensLink >= 0, `${page} must link tokens.css`)
    assert.ok(tokensLink < html.indexOf(`href="${stylesheet}"`), `${page} must link tokens.css before ${stylesheet}`)
  }
})

// Test helper: reads an overlay stylesheet with its color tokens resolved, so
// tests can assert color contracts by value while the stylesheet uses tokens.
const fs = require('node:fs')
const path = require('node:path')

const overlayDir = path.join(__dirname, '..', 'overlay')

function readTokens() {
  const css = fs.readFileSync(path.join(overlayDir, 'tokens.css'), 'utf8')
  return new Map([...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]))
}

function hexToRgb(hex) {
  const digits = hex.length === 4 ? [...hex.slice(1)].map(digit => digit + digit).join('') : hex.slice(1)
  return [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16)).join(' ')
}

// Replaces token references with their values and writes a translucent token
// mix back in its literal form: color-mix(in srgb, #e2e8f0 18%, transparent)
// becomes rgb(226 232 240 / 18%).
function resolveTokens(css, tokens = readTokens()) {
  let previous
  do {
    previous = css
    css = css.replace(/var\((--[a-z0-9-]+)\)/g, (match, name) => tokens.get(name) ?? match)
  } while (css !== previous)
  return css.replace(
    /color-mix\(in srgb, (#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}) (\d+(?:\.\d+)?%), transparent\)/g,
    (match, hex, amount) => `rgb(${hexToRgb(hex)} / ${amount})`
  )
}

function readResolvedStylesheet(file) {
  return resolveTokens(fs.readFileSync(path.join(overlayDir, file), 'utf8'))
}

module.exports = { readTokens, resolveTokens, readResolvedStylesheet }

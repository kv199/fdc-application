import { build } from 'esbuild'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const source = resolve(root, 'tools/shift-light/shift-light.ts')
const output = resolve(root, 'overlay/shift-light-engine.js')

await build({
  entryPoints: [source],
  bundle: true,
  format: 'iife',
  globalName: 'HudShiftLight',
  platform: 'browser',
  outfile: output,
  legalComments: 'inline',
  banner: {
    js: '// FDC-owned Shift Light utility; keep this browser module self-contained.'
  },
  footer: {
    js: 'if (typeof globalThis !== "undefined") globalThis.HudShiftLight = HudShiftLight; if (typeof module !== "undefined") module.exports = HudShiftLight;'
  }
})

console.log(`Shift Light bundle generated: ${output}`)

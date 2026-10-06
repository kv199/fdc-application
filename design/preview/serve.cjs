// Local preview server for the design book and the real FDC screens.
//
//   node design/preview/serve.cjs [port]
//
// It serves the repository root on 127.0.0.1 (default port 5320):
//   /                     -> the design book (design/fdc-dark/index.html)
//   /preview/settings     -> overlay/settings.html with a mock Tauri backend
//   /preview/hud          -> overlay/index.html with the HUD state helper
// The preview pages are the real application files; the server only adds a
// <base> tag and the preview scripts from this folder while serving them, so
// nothing is copied into overlay/. Nothing here ships with FDC.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')
const port = Number(process.argv[2]) || 5320
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf'
}

// The mock must exist before the application scripts run, so it goes in
// <head>; the state helpers run after the page has loaded.
const previews = {
  '/preview/settings': {
    page: 'overlay/settings.html',
    head: ['/design/preview/settings-mock.js'],
    body: ['/design/preview/settings-states.js']
  },
  '/preview/hud': {
    page: 'overlay/index.html',
    head: [],
    body: ['/design/preview/hud-states.js']
  }
}

function renderPreview({ page, head, body }) {
  const scripts = list => list.map(src => `<script src="${src}"></script>`).join('')
  return fs.readFileSync(path.join(root, page), 'utf8')
    .replace('<head>', `<head><base href="/overlay/">${scripts(head)}`)
    .replace('</body>', `${scripts(body)}</body>`)
}

const server = http.createServer((request, response) => {
  const url = decodeURIComponent(request.url.split('?')[0])
  if (url === '/') {
    response.writeHead(302, { Location: '/design/fdc-dark/index.html' })
    return response.end()
  }
  if (previews[url]) {
    response.writeHead(200, { 'Content-Type': types['.html'], 'Cache-Control': 'no-store' })
    return response.end(renderPreview(previews[url]))
  }
  const file = path.join(root, url)
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(403)
    return response.end()
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404)
      return response.end()
    }
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    })
    response.end(data)
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`FDC design preview: http://127.0.0.1:${port}/`)
})

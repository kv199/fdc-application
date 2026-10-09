// Checks the design book without generating files:
//   node design/fdc-dark/verify.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = __dirname;
const repo = path.resolve(root, '..', '..');
const exists = relative => fs.existsSync(path.join(root, relative));
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const context = { window: {} };
vm.createContext(context);

for (const file of ['screens.js', 'screens-current.js', 'foundations.js', 'style-spec.js', 'overlays.js', 'light-theme.js', 'icon/icon.js']) {
  vm.runInContext(read(file), context, { filename: file });
}

const boards = [...context.window.FDC_SCREENS, ...context.window.FDC_FOUNDATIONS];
const ids = new Set(boards.map(board => board.id));
if (boards.length !== 24 || ids.size !== 24) throw Error('Expected 24 unique boards');

for (const board of boards) {
  if (!board.html || !board.description) throw Error(`Empty board: ${board.id}`);
  for (const match of board.html.matchAll(/href="\?board=([^"]+)"/g)) {
    if (!ids.has(match[1])) throw Error(`Broken board link: ${board.id} -> ${match[1]}`);
  }
  for (const match of board.html.matchAll(/href="(\.\.\/\.\.\/[^"]+)"/g)) {
    if (!exists(match[1])) throw Error(`Missing app file linked from ${board.id}: ${match[1]}`);
  }
}

// The book has no copies of app assets: it uses the app's tokens, fonts, and texture.
for (const file of ['index.html', 'book.css', 'design-system.css', 'light-theme.css', 'icon/icon.css', 'icon/fdc-icon.svg', 'icon/fdc-icon.png', 'icon/fdc-icon.ico', 'icon/fdc-icon-pulse.svg', 'icon/fdc-icon-pulse.png', 'icon/fdc-icon-pulse.ico', 'icon/fdc-icon-lift.svg', 'icon/fdc-icon-lift.png', 'icon/fdc-icon-lift.ico', 'icon/fdc-icon-lift-mark.svg', 'icon/fdc-icon-chroma.svg', 'icon/fdc-icon-chroma.png', 'icon/fdc-icon-chroma.ico', 'icon/fdc-icon-spectrum.svg', 'icon/fdc-icon-spectrum.png', 'icon/fdc-icon-spectrum.ico', 'icon/fdc-icon-chroma-light.svg', 'icon/fdc-icon-chroma-light.png', 'icon/fdc-icon-chroma-light.ico', 'icon/fdc-icon-chroma-black.svg', 'icon/fdc-icon-chroma-black.png', 'icon/fdc-icon-chroma-black.ico', 'icon/fdc-icon-split.svg', 'icon/fdc-icon-split.png', 'icon/fdc-icon-split.ico', 'icon/fdc-icon-chroma-fdc.svg', 'icon/fdc-icon-chroma-fdc.png', 'icon/fdc-icon-chroma-fdc.ico', 'icon/fdc-icon-chroma-fdc-texture.jpg', 'icon/fdc-icon-chroma-fdc-texture-source.png', 'book.js', 'overlays.js', 'README.md', 'IMPLEMENTATION.md', 'LIGHT_THEME.md']) {
  if (!exists(file)) throw Error(`Missing book file: ${file}`);
}
if (!fs.existsSync(path.join(repo, 'overlay', 'assets', 'textures', 'paint.jpg'))) throw Error('Missing FDC paint texture used by the icon finish preview');
for (const file of ['fonts', 'paint.png']) {
  if (exists(file)) throw Error(`Duplicate of an app asset in the book: ${file}`);
}
for (const css of ['book.css', 'design-system.css', 'light-theme.css', 'icon/icon.css']) {
  for (const match of read(css).matchAll(/url\(([^)]+)\)/g)) {
    if (!exists(match[1])) throw Error(`Broken asset in ${css}: ${match[1]}`);
  }
}

const index = read('index.html');
if (!index.includes('href="../../overlay/tokens.css"')) throw Error('The book must load overlay/tokens.css');
for (const match of index.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const target = match[1];
  if (target.startsWith('?') || target.startsWith('/') || /^[a-z]+:/i.test(target)) continue;
  if (!exists(target)) throw Error(`Broken index link: ${target}`);
}

// Every token the specification board names is defined by the app or the book.
const defined = new Set([
  ...fs.readFileSync(path.join(repo, 'overlay', 'tokens.css'), 'utf8').matchAll(/(--[\w-]+)\s*:/g),
  ...read('design-system.css').matchAll(/(--[\w-]+)\s*:/g)
].map(match => match[1]));
const spec = boards.find(board => board.id === 'foundation-spec');
for (const match of spec.html.matchAll(/data-token="(--[\w-]+)"/g)) {
  if (!defined.has(match[1])) throw Error(`Specification names an undefined token: ${match[1]}`);
}

const light = boards.find(board => board.id === 'foundation-light');
if (!light || light.status !== 'proposal') throw Error('Light Configuration board must be marked as a proposal');
const lightCss = read('light-theme.css');
if (!lightCss.includes('.app--light-proposal {')) throw Error('Light tokens must be scoped to the proposal board');
if (/(?:--hud-[\w-]+|--telemetry-[\w-]+|--paint)\s*:/.test(lightCss)) throw Error('Light proposal must not redefine HUD, telemetry, or painted header tokens');
for (const match of light.html.matchAll(/data-light-token="(--[\w-]+)"/g)) {
  if (!lightCss.includes(`${match[1]}:`)) throw Error(`Light specification names an undefined token: ${match[1]}`);
}
const icon = boards.find(board => board.id === 'foundation-icon');
if (!icon || icon.status !== 'proposal') throw Error('Application icon board must be marked as a proposal');
const iconColors = new Set([...fs.readFileSync(path.join(repo, 'overlay', 'tokens.css'), 'utf8').matchAll(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?(?![0-9a-fA-F])/g)].map(match => match[0].toLowerCase()));
for (const file of ['icon/fdc-icon-chroma-light.svg', 'icon/fdc-icon-chroma-black.svg', 'icon/fdc-icon-split.svg', 'icon/fdc-icon-chroma-fdc.svg']) {
  for (const match of read(file).matchAll(/(?:stop-color|fill|stroke)="(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?)"/g)) {
    if (!iconColors.has(match[1].toLowerCase())) throw Error(`${file} uses an unknown color: ${match[1]}`);
  }
}
for (const match of icon.html.matchAll(/(?:src|href)="(icon\/[^\"]+)"/g)) {
  if (!exists(match[1])) throw Error(`Missing proposed icon asset: ${match[1]}`);
}

if (!boards.find(board => board.id === 'settings').html.includes('DISTANCE UNIT')) {
  throw Error('Settings specimen is missing the distance unit');
}
if (!boards.find(board => board.id === 'driver-list').html.includes('Ctrl + Shift + F9')) {
  throw Error('Driver specimen shows the wrong default hotkey');
}

console.log('FDC design book: 22 implemented boards, 2 proposals, links, app assets, and specification tokens verified.');

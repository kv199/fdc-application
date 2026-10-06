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

for (const file of ['screens.js', 'screens-current.js', 'foundations.js', 'style-spec.js', 'overlays.js']) {
  vm.runInContext(read(file), context, { filename: file });
}

const boards = [...context.window.FDC_SCREENS, ...context.window.FDC_FOUNDATIONS];
const ids = new Set(boards.map(board => board.id));
if (boards.length !== 22 || ids.size !== 22) throw Error('Expected 22 unique boards');

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
for (const file of ['index.html', 'book.css', 'design-system.css', 'book.js', 'overlays.js', 'README.md', 'IMPLEMENTATION.md']) {
  if (!exists(file)) throw Error(`Missing book file: ${file}`);
}
for (const file of ['fonts', 'paint.png']) {
  if (exists(file)) throw Error(`Duplicate of an app asset in the book: ${file}`);
}
for (const css of ['book.css', 'design-system.css']) {
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

if (!boards.find(board => board.id === 'settings').html.includes('DISTANCE UNIT')) {
  throw Error('Settings specimen is missing the distance unit');
}
if (!boards.find(board => board.id === 'driver-list').html.includes('Ctrl + Shift + F9')) {
  throw Error('Driver specimen shows the wrong default hotkey');
}

console.log('FDC Dark book: 22 boards, links, app assets, and specification tokens verified.');

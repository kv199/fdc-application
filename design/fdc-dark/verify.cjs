const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = __dirname;
const exists = relative => fs.existsSync(path.join(root, relative));
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const context = { window: {} };
vm.createContext(context);

for (const file of ['screens.js', 'screens-current.js', 'foundations.js', 'style-spec.js']) {
  vm.runInContext(read(file), context, { filename: file });
}

const boards = [...context.window.FDC_SCREENS, ...context.window.FDC_FOUNDATIONS];
const ids = new Set(boards.map(board => board.id));
if (boards.length !== 21 || ids.size !== 21) throw Error('Expected 21 unique boards');

for (const board of boards) {
  if (!board.html || !board.description) throw Error(`Empty board: ${board.id}`);
  for (const match of board.html.matchAll(/href="\?board=([^"]+)"/g)) {
    if (!ids.has(match[1])) throw Error(`Broken board link: ${board.id} -> ${match[1]}`);
  }
  for (const match of board.html.matchAll(/href="(fonts\/[^"]+)"/g)) {
    if (!exists(match[1])) throw Error(`Missing font or notice: ${match[1]}`);
  }
}

for (const file of [
  'index.html', 'book.css', 'design-system.css', 'book.js', 'paint.png',
  'README.md', 'IMPLEMENTATION.md',
  'fonts/Barlow-Regular.ttf', 'fonts/Barlow-SemiBold.ttf',
  'fonts/BarlowCondensed-Medium.ttf', 'fonts/BarlowCondensed-SemiBold.ttf',
  'fonts/barlow-OFL.txt', 'fonts/barlowcondensed-OFL.txt'
]) {
  if (!exists(file)) throw Error(`Missing source asset: ${file}`);
}

const index = read('index.html');
for (const match of index.matchAll(/(?:href|src)="([^"]+)"/g)) {
  const target = match[1];
  if (target.startsWith('?') || /^[a-z]+:/i.test(target)) continue;
  if (!exists(target)) throw Error(`Broken index link: ${target}`);
}

const css = read('design-system.css');
const spec = boards.find(board => board.id === 'foundation-spec');
for (const match of spec.html.matchAll(/<code>(--[\w-]+) · (#[\da-f]{6})<\/code>/gi)) {
  const declaration = new RegExp(`${match[1]}:\\s*${match[2]}\\s*;`, 'i');
  if (!declaration.test(css)) throw Error(`Style page and CSS disagree: ${match[1]}`);
}

if (!boards.find(board => board.id === 'settings').html.includes('DISTANCE UNIT')) {
  throw Error('Settings specimen is missing the distance unit');
}
if (!boards.find(board => board.id === 'driver-list').html.includes('Ctrl + Shift + F9')) {
  throw Error('Driver specimen shows the wrong default hotkey');
}

console.log('FDC Dark source: 21 boards, links, assets, and exact style values verified.');

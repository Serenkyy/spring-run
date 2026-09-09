/**
 * 把 index.html + core.js + game.js + 图标 打包成一个自包含的 ziyi-run.html。
 * 用法: node tools/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let html = read('index.html');
const core = read('core.js');
const game = read('game.js');
const icon = fs.readFileSync(path.join(root, 'icon-180.png')).toString('base64');

html = html
  .replace('<link rel="manifest" href="manifest.webmanifest">', '')
  .replace('<link rel="apple-touch-icon" href="icon-180.png">',
    '<link rel="apple-touch-icon" href="data:image/png;base64,' + icon + '">')
  .replace('<link rel="icon" href="icon-180.png">',
    '<link rel="icon" href="data:image/png;base64,' + icon + '">')
  .replace('<script src="core.js"></script>',
    '<script>' + core + '</script>')
  .replace('<script src="game.js"></script>',
    '<script>' + game + '</script>');

const out = path.join(root, 'ziyi-run.html');
fs.writeFileSync(out, html);
console.log('ziyi-run.html 已生成 (' + (html.length / 1024).toFixed(0) + ' KB，单文件，可直接发给别人)');

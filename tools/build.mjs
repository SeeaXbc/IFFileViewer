/**
 * 連結ビルド：src/app.html の //@SCRIPT@ プレースホルダに src/js/*.js を
 * ファイル名順で連結して埋め込み、配布物（ルートの単一HTML）を生成する。
 * バンドラ不使用（全ファイルが同一グローバルスコープを共有する前提）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'IFファイルビューア.html');

const tpl = fs.readFileSync(path.join(ROOT, 'src', 'app.html'), 'utf8');
const jsDir = path.join(ROOT, 'src', 'js');
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort();
if (!files.length) { console.error('src/js/*.js が見つかりません'); process.exit(1); }

const js = files.map(f => fs.readFileSync(path.join(jsDir, f), 'utf8')).join('');
if (!tpl.includes('//@SCRIPT@\n')) { console.error('src/app.html に //@SCRIPT@ プレースホルダがありません'); process.exit(1); }
const out = tpl.replace('//@SCRIPT@\n', () => js);  // 関数形式: JS中の $& 等が置換パターン解釈されるのを防ぐ

fs.writeFileSync(OUT, out);
console.log(`built: ${path.basename(OUT)}（${files.length} ファイル連結・${out.split('\n').length.toLocaleString()} 行）`);

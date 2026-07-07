/**
 * 単一HTML内の <script> を抽出して tsc --checkJs で型検査する。
 * 既存コードを一括修正せずに導入するため「ベースライン方式」を採る：
 *   - エラー件数が tools/tsc-baseline.json の件数を超えたら失敗（新規エラーの混入を防ぐ）
 *   - 件数が減ったらベースラインの更新を促す（実行時に --update で更新）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HTML = path.join(ROOT, 'IFファイルビューア.html');
const OUTDIR = path.join(ROOT, '.typecheck');
const BASELINE = path.join(ROOT, 'tools', 'tsc-baseline.json');

const html = fs.readFileSync(HTML, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) { console.error('HTMLから<script>を抽出できませんでした'); process.exit(1); }

fs.mkdirSync(OUTDIR, { recursive: true });
const jsPath = path.join(OUTDIR, 'app.js');
fs.writeFileSync(jsPath, scripts.join('\n'));

const tscBin = require.resolve('typescript/bin/tsc');
const res = spawnSync(process.execPath, [
  tscBin, '--noEmit', '--allowJs', '--checkJs',
  '--target', 'es2022', '--lib', 'es2022,dom,dom.iterable',
  '--strict', 'false',
  jsPath,
], { encoding: 'utf8', cwd: ROOT });

const out = (res.stdout || '') + (res.stderr || '');
const errors = out.split('\n').filter(l => / error TS\d+: /.test(l));
const count = errors.length;

let baseline = { count: 0 };
try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch { /* 初回 */ }

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE, JSON.stringify({ count }, null, 2) + '\n');
  console.log(`ベースラインを ${count} 件に更新しました`);
  process.exit(0);
}

console.log(`tsc エラー: ${count} 件（ベースライン: ${baseline.count} 件）`);
if (count > baseline.count) {
  console.error('\n新規の型エラーが混入しています。以下を修正するか、意図的な場合は');
  console.error('`node tools/typecheck.mjs --update` でベースラインを更新してください。\n');
  console.error(errors.slice(0, 40).join('\n'));
  process.exit(1);
}
if (count < baseline.count) {
  console.log('エラーが減っています。`node tools/typecheck.mjs --update` でベースラインを下げてください（ラチェット）。');
}

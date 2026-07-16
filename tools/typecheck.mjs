/**
 * src/js/*.js を tsc --checkJs で型検査する（全ファイル同時コンパイル＝
 * 共有グローバルスコープの相互参照が解決される）。
 * ベースライン方式: エラー件数が tools/tsc-baseline.json を超えたら失敗。
 * 件数が減ったら --update でベースラインを下げる（ラチェット）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BASELINE = path.join(ROOT, 'tools', 'tsc-baseline.json');

const jsDir = path.join(ROOT, 'src', 'js');
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort()
  .map(f => path.join('src', 'js', f));
if (!files.length) { console.error('src/js/*.js が見つかりません'); process.exit(1); }

const tscBin = require.resolve('typescript/bin/tsc');
const res = spawnSync(process.execPath, [
  tscBin, '--noEmit', '--allowJs', '--checkJs',
  '--target', 'es2022', '--lib', 'es2022,dom,dom.iterable',
  '--strict', 'false',
  ...files,
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

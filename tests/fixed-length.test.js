/* 固定長ファイル対応（要件定義書 §4.6）：バイト幅分割・幅維持編集・保存整合 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchViewer, openBytes, readSample } = require('./_helper');

let browser, page, errors;
before(async () => {
  ({ browser, page, errors } = await launchViewer());
  await page.evaluate(() => {
    defs = [{
      name: '固定長テスト', match: 'IF_FIXED_*', encoding: 'shift_jis',
      headers: [['伝票番号', '取引先名', '数量', '単価']],
      widths: [6, 20, 5, 9],
      rules: [{ col: 1, required: true, pattern: '^D\\d{5}$' },
              { col: 3, type: 'number', required: true },
              { col: 4, type: 'number' }],
    }];
  });
});
after(async () => { await browser.close(); });

test('SJISのバイト幅で列分割される（全角=2バイト・半角カナ=1バイト）', async () => {
  const orig = readSample('IF_FIXED_20260707');
  await openBytes(page, 'IF_FIXED_20260707', orig);
  const r = await page.evaluate(() => {
    const c = prepText(curTab());
    return { rows0: c.rows[0], rows1: c.rows[1], nCols: c.colW.length,
             chip: document.querySelector('.fixedTag')?.textContent };
  });
  assert.deepEqual(r.rows0, ['D00001', '東京商事株式会社    ', '00100', '000012500']);
  assert.deepEqual(r.rows1, ['D00002', 'ｵｵｻｶﾌﾞｯｻﾝ           ', '00005', '000000980']);
  assert.equal(r.nCols, 4);
  assert.match(String(r.chip), /固定長: 4列 \/ 計40バイト/);
});

test('固定長編集: 幅超過は拒否、短い値は右パディング、未編集部分はバイト一致', async () => {
  const orig = readSample('IF_FIXED_20260707');
  const r = await page.evaluate((orig) => {
    const t = curTab();
    enterEditMode(t);
    if (!t.edit) return { fail: 'edit mode' };
    const out0 = buildSaveBytes(t);
    const o = new Uint8Array(orig);
    const identical0 = out0.length === o.length && out0.every((x, i) => x === o[i]);
    const errOver = commitCellEdit(t, 0, 2, '123456');   // 5バイト幅に6バイト
    const errOk = commitCellEdit(t, 0, 2, '42');
    const padded = t._cache.rows[0][2];
    const errZen = commitCellEdit(t, 0, 1, '大阪産業');  // 8バイト → 12バイトパディング
    const zenLen = t._cache.rows[0][1].length;
    const out = buildSaveBytes(t);
    const lineLen = 6 + 20 + 5 + 9 + 2; // 1行 + CRLF
    let untouched = out.length === o.length;
    if (untouched) for (let i = lineLen; i < o.length; i++) if (out[i] !== o[i]) { untouched = false; break; }
    exitEditMode(t);
    return { identical0, errOver, errOk, padded, errZen, zenLen, untouched };
  }, [...orig]);
  assert.equal(r.identical0, true, '未編集保存は全バイト一致');
  assert.match(String(r.errOver), /超えています/);
  assert.equal(r.errOk, null);
  assert.equal(r.padded, '42   ', '5バイト幅へ右パディング');
  assert.equal(r.errZen, null);
  assert.equal(r.zenLen, 4 + 12, '全角4文字(8バイト)+スペース12');
  assert.equal(r.untouched, true, '2行目以降はバイト一致');
});

test('ページエラーが発生していない', () => {
  assert.deepEqual(errors, []);
});

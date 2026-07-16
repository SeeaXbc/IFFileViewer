/* 編集モードのバイト完全性（要件定義書 §9.2 / 受け入れ基準10・12） */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchViewer, openBytes, readSample } = require('./_helper');

let browser, page, errors;
before(async () => { ({ browser, page, errors } = await launchViewer()); });
after(async () => { await browser.close(); });

const CASES = [
  { name: 'IF_ORDER_20260705',        enc: null },        // SJIS・LF
  { name: 'IF_STOCK_EUC_20260706',    enc: 'euc-jp' },    // EUC-JP 明示指定
  { name: 'IF_UTF16LE_20260706.csv',  enc: null },        // UTF-16LE BOM
  { name: 'IF_ORDER_UTF8BOM_20260706',enc: null },        // UTF-8 BOM
  { name: '改行混在.txt',              enc: null },        // CRLF/LF/CR 混在
];

test('未編集のまま保存すると全バイトが元ファイルと一致する', async () => {
  for (const cs of CASES) {
    const orig = readSample(cs.name);
    await openBytes(page, cs.name, orig);
    const identical = await page.evaluate(({ enc, orig }) => {
      const t = curTab();
      if (enc) { t.encSel = enc; t._cache = {}; t._dec = null; prepText(t); rebuildTextSearch(t); renderAll(); }
      enterEditMode(t);
      if (!t.edit) return 'edit mode failed';
      const out = buildSaveBytes(t);
      const o = new Uint8Array(orig);
      exitEditMode(t);
      return out.length === o.length && out.every((x, i) => x === o[i]);
    }, { enc: cs.enc, orig: [...orig] });
    assert.equal(identical, true, `${cs.name}: 全バイト一致すべき`);
  }
});

test('SJIS: セル編集後も未編集行のバイトは完全一致し、編集値は正しくエンコードされる', async () => {
  const orig = readSample('IF_ORDER_20260705');
  await openBytes(page, 'IF_ORDER_sjis_edit', orig);
  const r = await page.evaluate((orig) => {
    const t = curTab();
    enterEditMode(t);
    const e1 = commitCellEdit(t, 1, 1, '20991231');
    const e2 = commitCellEdit(t, 2, 0, 'テスト株式会社');
    const out = [...buildSaveBytes(t)];
    return { e1, e2, out, edits: t.edit.edits.size };
  }, [...orig]);
  assert.equal(r.e1, null);
  assert.equal(r.e2, null);
  assert.equal(r.edits, 2);

  const splitNl = buf => { // 0x0A 区切り（改行保持）
    const a = []; let s = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) { a.push(buf.slice(s, i + 1)); s = i + 1; }
    if (s < buf.length) a.push(buf.slice(s));
    return a;
  };
  const ol = splitNl(orig), nl = splitNl(Buffer.from(r.out));
  assert.equal(ol.length, nl.length, '行数維持');
  for (let i = 0; i < ol.length; i++) {
    if (i === 1 || i === 2) continue; // 編集行
    assert.ok(ol[i].equals(nl[i]), `未編集行 ${i + 1} はバイト一致すべき`);
  }
  // 「テスト株式会社」の正しい CP932 バイト列で始まる
  const sjis = Buffer.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x8A, 0x94, 0x8E, 0xAE, 0x89, 0xEF, 0x8E, 0xD0]);
  assert.ok(nl[2].subarray(0, sjis.length).equals(sjis), '編集値がCP932でエンコードされるべき');
});

test('EUC-JP: 編集値が正しいEUCバイト列になり、表現不可文字は拒否される', async () => {
  const orig = readSample('IF_STOCK_EUC_20260706');
  await openBytes(page, 'IF_STOCK_euc_edit', orig);
  const r = await page.evaluate((orig) => {
    const t = curTab();
    t.encSel = 'euc-jp'; t._cache = {}; t._dec = null;
    prepText(t); rebuildTextSearch(t); renderAll();
    enterEditMode(t);
    const err1 = commitCellEdit(t, 0, 1, '鰺の開き');
    const err2 = commitCellEdit(t, 0, 1, '𩸽テスト');   // JIS外 → 拒否
    const out = [...buildSaveBytes(t)];
    return { err1, err2, out };
  }, [...orig]);
  assert.equal(r.err1, null);
  assert.match(String(r.err2), /表現できない文字/);
  const line0 = Buffer.from(r.out.slice(0, r.out.indexOf(10)));
  // 鰺(F2CD) の(A4CE) 開(B3AB) き(A4AD)
  assert.ok(line0.includes(Buffer.from([0xF2, 0xCD, 0xA4, 0xCE, 0xB3, 0xAB, 0xA4, 0xAD])),
    '編集値がEUC-JPでエンコードされるべき');
});

test('確定バリデーション: 区切り文字・改行・エンコード不可文字を拒否する', async () => {
  const orig = readSample('IF_ORDER_20260705');
  await openBytes(page, 'IF_ORDER_valid', orig);
  const r = await page.evaluate(() => {
    const t = curTab();
    enterEditMode(t);
    return {
      delim: commitCellEdit(t, 0, 0, 'a,b'),
      nl: commitCellEdit(t, 0, 0, 'a\nb'),
      unenc: commitCellEdit(t, 0, 0, '𩸽'),
      ok: commitCellEdit(t, 0, 0, 'C999'),
    };
  });
  assert.match(String(r.delim), /区切り文字/);
  assert.match(String(r.nl), /改行/);
  assert.match(String(r.unenc), /表現できない文字/);
  assert.equal(r.ok, null);
});

test('ページエラーが発生していない', () => {
  assert.deepEqual(errors, []);
});

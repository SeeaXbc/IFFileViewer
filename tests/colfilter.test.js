/* 列フィルタ（要件定義書 §4.10）：Excelオートフィルタ相当 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchViewer } = require('./_helper');

let browser, page, errors;
before(async () => {
  ({ browser, page, errors } = await launchViewer());
  page.on('dialog', d => d.accept());
  await page.evaluate(async () => {
    const lines = [
      'C001,20260701,1000,東京',
      'C002,20260702,2000,大阪',
      'C003,20260703,1000,東京',
      'C004,20260704,3000,名古屋',
      'C005,20260705,1000,大阪',
      'C006,20260706,2000,東京',
    ];
    await openFiles([new File([new TextEncoder().encode(lines.join('\n'))], 'CF_TEST')]);
  });
  await page.waitForSelector('.trow');
});
after(async () => { await browser.close(); });

test('フィルタ行の表示: 列数分の▼ボタンが出る', async () => {
  await page.click('#btnColFilter');
  const r = await page.evaluate(() => ({
    on: curTab().colFilterOn,
    btns: paneContent(0).querySelectorAll('.cfbtn').length,
    toggled: $('#btnColFilter').classList.contains('on'),
  }));
  assert.equal(r.on, true);
  assert.equal(r.btns, 4);
  assert.equal(r.toggled, true);
});

test('ポップアップ: ユニーク値と件数が表示され、チェックで絞り込める', async () => {
  await page.locator('.cfbtn').nth(3).click();   // 第4列（地名）
  await page.waitForSelector('#cfPop', { state: 'visible' });
  const list = await page.evaluate(() =>
    [...document.querySelectorAll('#cfList .cfitem')].map(e => [e.querySelector('.v').textContent, e.querySelector('.n').textContent]));
  /* 並び順はロケール依存のため集合として検証 */
  assert.deepEqual(list.slice().sort((a,b)=>a[0].localeCompare(b[0])),
    [['名古屋','1'], ['大阪','2'], ['東京','3']].sort((a,b)=>a[0].localeCompare(b[0])));

  /* 東京のみに絞る: すべて解除 → 東京だけチェック → OK */
  await page.click('#cfAll');   // 全解除
  await page.locator('#cfList .cfitem', { hasText: '東京' }).locator('input').check();
  await page.click('#cfOk');
  const r = await page.evaluate(() => ({
    rows: [...paneContent(0).querySelectorAll('.trow')].map(e => +e.dataset.l),
    active: colFilterActive(curTab()),
    btnLabel: paneContent(0).querySelectorAll('.cfbtn')[3].textContent,
    status: $('#status').textContent.includes('列フィルタ'),
  }));
  assert.deepEqual(r.rows, [0, 2, 5], '東京の行のみ（行番号は元のまま）');
  assert.equal(r.active, true);
  assert.equal(r.btnLabel, '▼1');
  assert.equal(r.status, true);
});

test('複数列AND: 金額1000∩東京', async () => {
  const r = await page.evaluate(() => {
    applyColFilter(curTab(), 2, new Set(['1000']));
    return [...paneContent(0).querySelectorAll('.trow')].map(e => +e.dataset.l);
  });
  assert.deepEqual(r, [0, 2], '東京かつ1000のみ');
});

test('検索ヒット行フィルタとの積集合', async () => {
  const r = await page.evaluate(() => {
    const t = curTab();
    t.query = 'C003'; rebuildTextSearch(t);
    t.filterHits = true; renderAll(true);
    const rows = [...paneContent(0).querySelectorAll('.trow')].map(e => +e.dataset.l);
    t.filterHits = false; t.query = ''; rebuildTextSearch(t); renderAll(true);
    return rows;
  });
  assert.deepEqual(r, [2], '列フィルタ∩検索ヒット');
});

test('全解除ボタンとポップアップの「この列を解除」', async () => {
  const r = await page.evaluate(() => {
    const t = curTab();
    applyColFilter(t, 2, null);                    // 金額の解除
    const after1 = t.colFilters.size;
    clearColFilters(t);                            // 全解除
    return { after1, size: t.colFilters.size,
             rows: paneContent(0).querySelectorAll('.trow').length };
  });
  assert.equal(r.after1, 1);
  assert.equal(r.size, 0);
  assert.equal(r.rows, 6, '全行に戻る');
});

test('列構成の変更（区切り変更）でフィルタが自己解除される', async () => {
  const r = await page.evaluate(() => {
    const t = curTab();
    applyColFilter(t, 3, new Set(['東京']));
    const before = paneContent(0).querySelectorAll('.trow').length;
    t.delims = ['\t']; t._cache.cellsKey = null; renderAll(true);   // タブ区切りへ変更 → 1列になる
    const cleared = !colFilterActive(t);
    const after = paneContent(0).querySelectorAll('.trow').length;
    t.delims = [',']; t._cache.cellsKey = null; renderAll(true);    // 戻す
    return { before, cleared, after };
  });
  assert.equal(r.before, 3);
  assert.equal(r.cleared, true, '列の意味が変わったら解除');
  assert.equal(r.after, 6);
});

test('フィルタ行トグルOFFで絞り込みも解除される', async () => {
  const r = await page.evaluate(() => {
    const t = curTab();
    applyColFilter(t, 3, new Set(['大阪']));
    toggleColFilterRow();   // OFF
    return { on: t.colFilterOn, active: colFilterActive(t),
             rows: paneContent(0).querySelectorAll('.trow').length,
             cfrow: !!paneContent(0).querySelector('.cfrow') };
  });
  assert.equal(r.on, false);
  assert.equal(r.active, false);
  assert.equal(r.rows, 6);
  assert.equal(r.cfrow, false);
});

test('▼ボタンの幅と位置がデータセルと一致する（グリッド/桁揃え両方式）', async () => {
  const measure = () => page.evaluate(() => {
    const t = curTab();
    if(!t.colFilterOn) toggleColFilterRow();
    const btns = [...paneContent(0).querySelectorAll('.cfbtn')];
    const cells = [...paneContent(0).querySelector('.trow').querySelectorAll('[data-c]')];
    return btns.map((b, i) => {
      const br = b.getBoundingClientRect(), cr = cells[i].getBoundingClientRect();
      return { dLeft: Math.abs(br.left - cr.left), dWidth: Math.abs(br.width - cr.width) };
    });
  });
  for (const style of ['excel', 'em']) {
    await page.evaluate(s => { const t = curTab(); t.style = s; renderAll(true); }, style);
    const diffs = await measure();
    for (const [i, d] of diffs.entries()) {
      assert.ok(d.dLeft <= 1.5, `${style}: 第${i+1}列の位置ずれ ${d.dLeft.toFixed(1)}px`);
      assert.ok(d.dWidth <= 1.5, `${style}: 第${i+1}列の幅ずれ ${d.dWidth.toFixed(1)}px`);
    }
  }
  /* ズーム変更後も一致すること（chスケール追従の確認） */
  await page.evaluate(() => { settings.zoom = 150; applyDisplaySettings(); renderAll(true); });
  const diffs = await measure();
  for (const d of diffs) assert.ok(d.dLeft <= 1.5 && d.dWidth <= 1.5, 'ズーム150%でもずれない');
  await page.evaluate(() => {
    settings.zoom = 100; applyDisplaySettings();
    const t = curTab(); t.style = 'excel'; toggleColFilterRow(); renderAll(true);
  });
});

test('ページエラーが発生していない', () => {
  assert.deepEqual(errors, []);
});

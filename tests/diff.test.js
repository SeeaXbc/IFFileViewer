/* 比較（差分）機能（要件定義書 §4.9）＋ NG/差分エクスポート */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchViewer } = require('./_helper');

let browser, page, errors;
before(async () => {
  ({ browser, page, errors } = await launchViewer({ clipboard: true }));
  page.on('dialog', d => d.accept());
  /* 左: 基準 / 右: 2行目の金額違い・3行目の区分違い・5行目が右のみ */
  await page.evaluate(async () => {
    const L = 'C001,20260701,1000,1\nC002,20260702,2000,1\nC003,20260703,3000,1\nC004,20260704,4000,2';
    const R = 'C001,20260701,1000,1\nC002,20260702,9999,1\nC003,20260703,3000,9\nC004,20260704,4000,2\nC005,20260705,5000,1';
    await openFiles([new File([new TextEncoder().encode(L)], 'diff_L')]);
    setLayout('cols');
    setActivePane(1);
    await openFiles([new File([new TextEncoder().encode(R)], 'diff_R')]);
  });
});
after(async () => { await browser.close(); });

test('比較ON: セル差分と相手なし行を検出し、両ペインにハイライトされる', async () => {
  const r = await page.evaluate(() => {
    toggleDiff();
    const dm = ensureDiff();
    return {
      on: diffOn,
      cells: [...dm.cells].sort(),
      rows: [...dm.rows].sort((a,b)=>a-b),
      miss1: [...dm.miss1],
      df0: paneContent(0).querySelectorAll('.dfcell').length,
      df1: paneContent(1).querySelectorAll('.dfcell').length,
      missRow1: paneContent(1).querySelectorAll('.trow.dfmiss').length,
      btn: $('#btnDiff').textContent,
      status: $('#status').textContent.includes('差分'),
    };
  });
  assert.equal(r.on, true);
  assert.deepEqual(r.cells, ['1:2', '2:3'], '金額(2行目3列)と区分(3行目4列)が差分');
  assert.deepEqual(r.rows, [1, 2, 4]);
  assert.deepEqual(r.miss1, [4], '5行目は右ペインのみ');
  assert.equal(r.df0, 2, '左ペインにも差分セルが表示される');
  assert.equal(r.df1, 2);
  assert.equal(r.missRow1, 1, '右ペインの5行目が相手なし行表示');
  assert.match(r.btn, /3行/);
  assert.equal(r.status, true);
});

test('差分行のみフィルタ: 両ペインが差分行に絞られ、行番号は元のまま', async () => {
  const r = await page.evaluate(() => {
    toggleDiffFilter();
    const rows0 = [...paneContent(0).querySelectorAll('.trow')].map(e => +e.dataset.l);
    const rows1 = [...paneContent(1).querySelectorAll('.trow')].map(e => +e.dataset.l);
    toggleDiffFilter();
    return { rows0, rows1 };
  });
  assert.deepEqual(r.rows0, [1, 2], '左は差分行のみ（5行目は存在しない）');
  assert.deepEqual(r.rows1, [1, 2, 4], '右は相手なし行も含む');
});

test('差分行ジャンプ: 両ペインが同じ行へスクロール・強調される', async () => {
  await page.evaluate(() => jumpNextDiff());
  await page.waitForSelector('.pane[data-p="0"] .trow[data-l="1"].flash');
  await page.waitForSelector('.pane[data-p="1"] .trow[data-l="1"].flash');
});

test('編集で差分が解消される（相手ペインの表示も更新）', async () => {
  const r = await page.evaluate(() => {
    setActivePane(1);
    const t = curTab();
    enterEditMode(t);
    const err = commitCellEdit(t, 1, 2, '2000');   // 左と同値にする
    const dm = ensureDiff();
    const out = {
      err,
      cells: [...dm.cells].sort(),
      df0: paneContent(0).querySelectorAll('.dfcell').length,
      df1: paneContent(1).querySelectorAll('.dfcell').length,
    };
    revertAllEdits(t); exitEditMode(t);
    return out;
  });
  assert.equal(r.err, null);
  assert.deepEqual(r.cells, ['2:3'], '2行目の差分が解消される');
  assert.equal(r.df0, 1, '左ペインの表示も更新される');
  assert.equal(r.df1, 1);
});

test('エクスポート: 差分一覧のTSVがクリップボードに入る', async () => {
  const r = await page.evaluate(async () => {
    const rows = diffExportRows();
    await exportRows(rows, 'x.csv', false);
    const clip = await navigator.clipboard.readText();
    return { rows, clip };
  });
  assert.equal(r.rows[0][0], '行');
  assert.deepEqual(r.rows[1], [2, 3, '2000', '9999']);
  assert.deepEqual(r.rows[2], [3, 4, '1', '9']);
  assert.deepEqual(r.rows[3], [5, '-', '（行なし）', '（行あり）']);
  assert.match(r.clip, /^行\t列\t/);
  assert.match(r.clip, /2\t3\t2000\t9999/);
});

test('エクスポート: 検査NG一覧（rules付き定義）', async () => {
  const r = await page.evaluate(() => {
    defs = [{ name: 'D', match: 'diff_*', headers: [['ID','日付','金額','区分']],
              rules: [{ col: 3, type: 'number' }, { col: 4, pattern: '^[12]$' }] }];
    const t = paneTab(1);   // diff_R: 区分9 がNG
    t.defSel = 'auto';      // test4の編集モード開始で'none'に固定されているため戻す
    t._cache.cellsKey = null; renderAllPanes(true);
    setActivePane(1); toggleValidation();
    const rows = valExportRows(t);
    const btnVisible = !$('#btnValExp').classList.contains('hiddenCtl');
    toggleValidation();
    defs = []; LS.set('ifv_defs', defs);
    return { rows, btnVisible };
  });
  assert.deepEqual(r.rows[0], ['行','列','列名','値','理由']);
  assert.equal(r.rows[1][0], 3);
  assert.equal(r.rows[1][2], '区分');
  assert.equal(r.rows[1][3], '9');
  assert.match(r.rows[1][4], /パターン不一致/);
  assert.equal(r.btnVisible, true);
});

test('分割解除で比較が自動OFFになる', async () => {
  const r = await page.evaluate(() => {
    setLayout('single');
    updateToolbar();
    return { diffOn, diffFilter, btnHidden: $('#btnDiff').classList.contains('hiddenCtl') };
  });
  assert.equal(r.diffOn, false);
  assert.equal(r.diffFilter, false);
  assert.equal(r.btnHidden, true);
});

test('ページエラーが発生していない', () => {
  assert.deepEqual(errors, []);
});

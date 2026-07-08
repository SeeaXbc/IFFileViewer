/* 列プロファイル・検査・行フィルタ・Undo/Redo・ジャンプ・列コピー（§4.7・§6・§9） */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchViewer, openBytes, readSample } = require('./_helper');

let browser, page, errors;
before(async () => {
  ({ browser, page, errors } = await launchViewer({ clipboard: true }));
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

test('検査: rules に基づき NG セルを検出し赤枠表示する', async () => {
  await openBytes(page, 'IF_FIXED_20260707', readSample('IF_FIXED_20260707'));
  await page.waitForSelector('.trow');
  const r = await page.evaluate(() => {
    toggleValidation();
    const t = curTab();
    return {
      ng: [...t._cache.valNG.entries()].sort(),
      btn: $('#btnVal').textContent,
      cells: document.querySelectorAll('.ngcell').length,
      status: $('#status').textContent.includes('検査NG'),
    };
  });
  // 3行目: 数量が空欄(必須NG)・単価に英字(数値NG)
  assert.deepEqual(r.ng.map(x => x[0]), ['2:2', '2:3']);
  assert.match(r.ng[0][1], /必須/);
  assert.match(r.ng[1][1], /数値/);
  assert.equal(r.cells, 2);
  assert.match(r.btn, /NG:2/);
  assert.equal(r.status, true);
  await page.evaluate(() => toggleValidation());
});

test('列プロファイル: 空欄・ユニーク・文字数・型推定を集計する', async () => {
  const rows = await page.evaluate(() => {
    openProfile();
    const rows = [...document.querySelectorAll('#profBody .ptable tr')].map(tr => [...tr.children].map(td => td.textContent));
    $('#profBack').classList.remove('show');
    return rows;
  });
  assert.equal(rows.length, 5); // ヘッダー + 4列
  const qty = rows[3]; // 数量列
  assert.equal(qty[1], '数量');
  assert.equal(qty[3], '1');       // 空欄1
  assert.equal(qty[6], '数値');    // 空欄以外はすべて数値
  const price = rows[4]; // 単価列（英字混入 → 文字）
  assert.equal(price[6], '文字');
});

test('編集モードの Undo/Redo が editsマップと値を正しく往復させる', async () => {
  const r = await page.evaluate(() => {
    const t = curTab();
    enterEditMode(t);
    commitCellEdit(t, 0, 2, '77');
    commitCellEdit(t, 1, 2, '88');
    const s0 = t.edit.edits.size;
    undoEdit(t);
    const s1 = t.edit.edits.size, v1 = t._cache.rows[1][2];
    redoEdit(t);
    const s2 = t.edit.edits.size, v2 = t._cache.rows[1][2];
    undoEdit(t); undoEdit(t);
    const s3 = t.edit.edits.size;
    exitEditMode(t);
    return { s0, s1, v1, s2, v2, s3 };
  });
  assert.equal(r.s0, 2);
  assert.equal(r.s1, 1);
  assert.equal(r.v1, '00005');
  assert.equal(r.s2, 2);
  assert.equal(r.v2, '88   ');
  assert.equal(r.s3, 0);
});

test('行フィルタ: 検索ヒット行のみ表示し、行番号は元ファイルのまま', async () => {
  await openBytes(page, 'IF_ORDER_feat', readSample('IF_ORDER_20260705'));
  await page.waitForSelector('.trow');
  const r = await page.evaluate(() => {
    const t = curTab();
    t.query = 'C00'; rebuildTextSearch(t);
    t.filterHits = true; renderAll(true);
    const rows = [...document.querySelectorAll('.trow')].map(e => +e.dataset.l);
    const status = $('#status').textContent.includes('ヒット行のみ表示');
    t.filterHits = false; t.query = ''; rebuildTextSearch(t); renderAll(true);
    return { rows, status, total: t._cache.lines.length };
  });
  assert.ok(r.rows.length > 0 && r.rows.length < r.total, 'ヒット行のみに絞られる');
  assert.equal(r.status, true);
});

test('Ctrl+G: 行番号ジャンプで対象行が表示・強調される', async () => {
  page.once('dialog', d => d.accept('3'));
  await page.keyboard.press('Control+g');
  await page.waitForSelector('.trow[data-l="2"].flash');
});

test('列コピー: Alt+クリックで列の全値がクリップボードに入る', async () => {
  await page.locator('.trow[data-l="0"] [data-c="1"]').click({ modifiers: ['Alt'] });
  await page.waitForTimeout(200);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(text.split('\n').length, 5);
  assert.match(text, /^20260701\n/);
});

test('定義の削除: インデックス補正・使用中タブの自動フォールバック・編集モード中はブロック', async () => {
  const onDialog = d => d.accept();
  page.on('dialog', onDialog);
  const r = await page.evaluate(() => {
    /* 3件の定義を登録。IF_ORDER_* には2番目(index1)が自動一致する */
    defs = [
      { name: 'DefA', match: 'ZZZ_A_*', headers: [['a']] },
      { name: 'DefB', match: 'IF_ORDER_*', headers: [['b']] },
      { name: 'DefC', match: 'ZZZ_C_*', headers: [['c']] },
    ];
    const t = curTab();               // IF_ORDER_feat タブ
    t.defSel = 'auto'; t._cache.cellsKey = null; renderAll(true);

    /* 編集モード中は使用定義の削除がブロックされる */
    enterEditMode(t);
    const defSelPinned = t.defSel;    // 「自動」でなく具体的な選択に固定される
    deleteDef(1);                     // confirmは出る前にブロックされる想定
    const blockedLen = defs.length;
    exitEditMode(t);

    /* 通常時: index0 を削除 → 手動選択(1)が繰り下がって同じ定義を指し続ける */
    deleteDef(0);                     // dialogハンドラがconfirmを承認
    const afterLen = defs.length;
    const stillDefB = resolvedDef(t)?.name;
    const defSelNow = t.defSel;

    /* 使用中の定義そのものを削除 → 自動へ戻る */
    deleteDef(0);                     // DefB を削除
    const fallback = t.defSel;
    const restLen = defs.length;
    defs = []; LS.set('ifv_defs', defs); t.defSel = 'auto'; renderAll(true);
    return { defSelPinned, blockedLen, afterLen, stillDefB, defSelNow, fallback, restLen };
  });
  page.off('dialog', onDialog);
  assert.equal(r.defSelPinned, 1, '編集開始で自動→具体的な選択に固定');
  assert.equal(r.blockedLen, 3, '編集モード中は削除がブロックされる');
  assert.equal(r.afterLen, 2);
  assert.equal(r.stillDefB, 'DefB', '手動選択はインデックス補正で同じ定義を指す');
  assert.equal(r.defSelNow, 0);
  assert.equal(r.fallback, 'auto', '使用中定義の削除で自動へ戻る');
  assert.equal(r.restLen, 1);
});

test('ページエラーが発生していない', () => {
  assert.deepEqual(errors, []);
});

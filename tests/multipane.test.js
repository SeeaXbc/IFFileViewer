/* マルチカラム表示（要件定義書 §4.8）：分割・タブ移動・独立/同期スクロール */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchViewer } = require('./_helper');

let browser, page, errors;
before(async () => {
  ({ browser, page, errors } = await launchViewer());
  page.on('dialog', d => d.accept());   // 編集破棄・クローズ等の confirm を承認
});
after(async () => { await browser.close(); });

/* ページ内でスクロール可能なテストデータを生成して開く（大きなサンプルの転送を避ける） */
const openGenerated = (name) => page.evaluate(async (name) => {
  const lines = Array.from({ length: 3000 }, (_, i) => `C${String(i).padStart(5, '0')},データ${i},${'x'.repeat(300)}`);
  await openFiles([new File([new TextEncoder().encode(lines.join('\n'))], name)]);
}, name);

test('左右分割: 各ペインに別ファイルを開き、独立してスクロールできる', async () => {
  await openGenerated('left_file');
  await page.click('#layCols');
  const r1 = await page.evaluate(() => ({
    layout, single: $('#panes').classList.contains('single'),
    badge: !!document.querySelector('.tab .pbadge'),
    syncBtnVisible: !$('#btnSync').classList.contains('hiddenCtl'),
  }));
  assert.equal(r1.layout, 'cols');
  assert.equal(r1.single, false);
  assert.equal(r1.badge, true, '分割中はタブにペインバッジが付く');
  assert.equal(r1.syncBtnVisible, true);

  // 右ペインをアクティブにして2つ目のファイルを開く
  await page.evaluate(() => setActivePane(1));
  await openGenerated('right_file');

  const r2 = await page.evaluate(() => ({
    p0: paneTab(0)?.name, p1: paneTab(1)?.name, active: activePane,
    rows0: paneContent(0).querySelectorAll('.trow').length,
    rows1: paneContent(1).querySelectorAll('.trow').length,
  }));
  assert.equal(r2.p0, 'left_file');
  assert.equal(r2.p1, 'right_file');
  assert.equal(r2.active, 1);
  assert.ok(r2.rows0 > 0 && r2.rows1 > 0, '両ペインに行が描画される');

  // 独立スクロール（同期OFF）
  const r3 = await page.evaluate(async () => {
    paneContent(0).scrollTop = 500;
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
    return { t0: paneContent(0).scrollTop, t1: paneContent(1).scrollTop };
  });
  assert.equal(r3.t0, 500);
  assert.equal(r3.t1, 0, '同期OFFでは他方は動かない');
});

test('🔗同期ON: 縦横のスクロールが他方へミラーされ、OFFで独立に戻る', async () => {
  const r = await page.evaluate(async () => {
    paneContent(0).scrollTop = 300; paneContent(1).scrollTop = 0;
    toggleSyncScroll();   // ON（アクティブペイン=1 の位置 0 に揃う）
    await new Promise(r => setTimeout(r, 80));
    const aligned = paneContent(0).scrollTop;
    setActivePane(0);
    paneContent(0).scrollTop = 800; paneContent(0).scrollLeft = 40;
    await new Promise(r => setTimeout(r, 120));
    const src = { t: paneContent(0).scrollTop, l: paneContent(0).scrollLeft };
    const t1 = paneContent(1).scrollTop, l1 = paneContent(1).scrollLeft, srcL = src.l;
    toggleSyncScroll();   // OFF
    paneContent(0).scrollTop = 100;
    await new Promise(r => setTimeout(r, 120));
    const t1b = paneContent(1).scrollTop;
    return { aligned, t1, l1, srcL, t1b, syncOff: !syncScroll };
  });
  assert.equal(r.aligned, 0, 'ON時にアクティブペインの位置へ揃う');
  assert.equal(r.t1, 800, '縦スクロールがミラーされる');
  assert.ok(r.srcL > 0, '横スクロール可能なコンテンツであること');
  assert.equal(r.l1, r.srcL, '横スクロールがミラーされる');
  assert.equal(r.t1b, 800, 'OFF後は追随しない');
  assert.equal(r.syncOff, true);
});

test('タブ移動: 反対ペインへ移動すると所属と表示が追随する', async () => {
  const r = await page.evaluate(() => {
    const i = tabs.findIndex(t => t.name === 'right_file');
    moveTabToPane(i, 0);
    return {
      pane: tabs[i].pane,
      p0name: paneTab(0)?.name,
      p1name: paneTab(1)?.name ?? null,
      active: activePane,
      dropHint: !!paneContent(1).querySelector('.drop'),
    };
  });
  assert.equal(r.pane, 0);
  assert.equal(r.p0name, 'right_file', '移動先ペインの表示タブになる');
  assert.equal(r.p1name, null);
  assert.equal(r.dropHint, true, '空いたペインはドロップヒント表示');
  // 戻す
  await page.evaluate(() => moveTabToPane(tabs.findIndex(t => t.name === 'right_file'), 1));
});

test('分割中の検索・編集はアクティブペインのタブに作用する', async () => {
  const r = await page.evaluate(() => {
    setActivePane(1);
    const t = curTab();
    t.query = 'C00001'; rebuildTextSearch(t);
    const hits1 = t.hits.length;
    const hits0 = paneTab(0).hits.length;   // 左ペインのタブには影響しない
    enterEditMode(t);
    const editOn = !!t.edit && !paneTab(0).edit;
    const err = commitCellEdit(t, 0, 0, 'X9999');
    const edited = t._cache.rows[0][0];
    exitEditMode(t);
    t.query = ''; rebuildTextSearch(t);
    return { hits1, hits0, editOn, err, edited };
  });
  assert.ok(r.hits1 > 0);
  assert.equal(r.hits0, 0);
  assert.equal(r.editOn, true);
  assert.equal(r.err, null);
  assert.equal(r.edited, 'X9999');
});

test('上下分割へ切替→分割解除で全タブが左ペインへ集約される', async () => {
  const r = await page.evaluate(() => {
    setLayout('rows');
    const rows = { layout, cls: $('#panes').classList.contains('rows') };
    setLayout('single');
    return {
      rows,
      layout, allPane0: tabs.every(t => t.pane === 0),
      p1cur: panes[1].cur, active: activePane,
      curName: curTab()?.name,
      syncOff: !syncScroll,
    };
  });
  assert.equal(r.rows.layout, 'rows');
  assert.equal(r.rows.cls, true);
  assert.equal(r.layout, 'single');
  assert.equal(r.allPane0, true);
  assert.equal(r.p1cur, -1);
  assert.equal(r.active, 0);
  assert.ok(r.curName, '表示中タブが維持される');
  assert.equal(r.syncOff, true, '分割解除で同期もOFF');
});

test('分割中にタブを閉じても両ペインのインデックスが正しく補正される', async () => {
  const r = await page.evaluate(async () => {
    setLayout('cols');
    // 左に tab A(既存2つ), 右に新規 C を開く
    setActivePane(1);
    await openFiles([new File([new TextEncoder().encode('c1,c2\nc3,c4')], 'close_test_C')]);
    const iLeft = tabs.findIndex(t => t.pane === 0);  // 先頭の左タブを閉じる
    const rightName = paneTab(1).name;
    closeTab(iLeft);
    const out = {
      rightStill: paneTab(1)?.name === rightName,   // 右ペインの表示は不変
      leftName: paneTab(0)?.name ?? null,           // 左は残りタブへ
      consistent: panes.every(pn => pn.cur === -1 || (tabs[pn.cur] && true)),
    };
    // 後片付け
    setLayout('single');
    while (tabs.length) closeTab(0);
    return out;
  });
  assert.equal(r.rightStill, true);
  assert.ok(r.leftName);
  assert.equal(r.consistent, true);
});

test('ページエラーが発生していない', () => {
  assert.deepEqual(errors, []);
});

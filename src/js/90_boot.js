/* =====================================================================
 * 全体描画 / 遅延描画 / マルチペイン初期化(4.8)
 * =================================================================== */
const _observers = [null, null];   // 遅延描画のIntersectionObserver（ペインごと）
function setupSentinel(tab, loadMore){
  const p = tab.pane;
  if(_observers[p]) _observers[p].disconnect();
  const root = paneContent(p);
  const sent = root.querySelector('.sentinel'); if(!sent) return;
  _observers[p] = new IntersectionObserver(es=>{
    for(const en of es) if(en.isIntersecting){
      let guard=0;
      while(en.isIntersecting && loadMore() && ++guard<4){} /* 画面が埋まるまで数回 */
    }
  }, {root, rootMargin:'600px'});
  _observers[p].observe(sent);
}
/* ペインpに panes[p].cur のタブを描画する（空ならドロップヒント） */
function renderPane(p, keepScroll){
  const tab = paneTab(p);
  const content = paneContent(p);
  if(!tab){
    content.textContent='';
    content.appendChild(buildDropHint());
    return;
  }
  if(tab.mode==='text'){ prepText(tab); if(!tab.hits.length&&tab.query)rebuildTextSearch(tab); buildTextView(tab, keepScroll); }
  else { makeBinHitSet(tab); buildBinView(tab, keepScroll); }
}
function renderAll(keepScroll){
  updateToolbar(); renderSide();
  renderPane(activePane, keepScroll);
  updateStatus();
}
function renderAllPanes(keepScroll){
  updateToolbar(); renderSide();
  renderPane(0, keepScroll);
  if(layout!=='single') renderPane(1, keepScroll);
  updateStatus();
}
function buildDropHint(){
  const d = el('div','drop');
  d.innerHTML = `
    <div class="big">ここにファイルをドラッグ&amp;ドロップ</div>
    <div>または左上の「📂 開く」から選択（拡張子なしのIFファイル可・複数可）</div>
    <div>クリップボードから <b>Ctrl+V</b> でも開けます（Excelの範囲コピー等）</div>
    <div>ヘッダー定義JSONファイルをドロップすると定義として読み込みます</div>
    <div style="margin-top:6px">🔒 読み取り専用ビューアです。元ファイルへの書き込みは一切行いません。</div>`;
  return d;
}

/* ---------- D&D ---------- */
function initDnD(){
  window.addEventListener('dragover', e=>{ e.preventDefault(); document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', e=>{ if(e.target===document.body||e.relatedTarget==null) document.body.classList.remove('dragging'); });
  window.addEventListener('drop', e=>{
    e.preventDefault(); document.body.classList.remove('dragging');
    const files = [...(e.dataTransfer?.files||[])];
    if(!files.length) return;
    /* 分割中はドロップした側のペインに開く(4.8) */
    const paneEl = /** @type {any} */(e.target instanceof Element ? e.target.closest('#panes .pane') : null);
    if(paneEl && layout!=='single') setActivePane(+paneEl.dataset.p);
    openFiles(files);
  });
  document.addEventListener('paste', handlePaste);  // Ctrl+V でクリップボードから開く
}

/* ---------- マルチペイン(4.8)：アクティブ切替・境界ドラッグ ---------- */
function initPanes(){
  document.querySelectorAll('#panes .pane').forEach((pel,p)=>{
    pel.addEventListener('mousedown', ()=>setActivePane(p));
  });
  const dv = $('#divider'), pn = $('#panes');
  let dragging = false;
  dv.addEventListener('mousedown', e=>{
    e.preventDefault(); dragging = true;
    dv.classList.add('drag'); document.body.style.userSelect='none';
  });
  window.addEventListener('mousemove', e=>{
    if(!dragging) return;
    const r = pn.getBoundingClientRect();
    let ratio = layout==='rows' ? (e.clientY-r.top)/r.height : (e.clientX-r.left)/r.width;
    ratio = Math.max(0.2, Math.min(0.8, ratio));
    pn.querySelector('.pane').style.flex = `0 0 calc(${(ratio*100).toFixed(2)}% - 3px)`;
  });
  window.addEventListener('mouseup', ()=>{
    if(dragging){ dragging=false; dv.classList.remove('drag'); document.body.style.userSelect=''; }
  });
  dv.addEventListener('dblclick', resetPaneSizes);
}

/* ---------- 起動 ---------- */
initToolbar(); initSettings(); initDnD(); initBinSelect(); initPanes();
$('#helpVer').textContent = 'v'+APP_VERSION;
applyDisplaySettings();
renderAll();
if(!LS.ok) console.warn('localStorage が使用できません。設定はセッション内のみ有効です。');

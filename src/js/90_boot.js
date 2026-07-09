/* =====================================================================
 * 全体描画 / 遅延描画
 * =================================================================== */
let observer=null;
function setupSentinel(loadMore){
  if(observer) observer.disconnect();
  const sent = $('#sentinel'); if(!sent) return;
  observer = new IntersectionObserver(es=>{
    for(const en of es) if(en.isIntersecting){
      let guard=0;
      while(en.isIntersecting && loadMore() && ++guard<4){} /* 画面が埋まるまで数回 */
    }
  }, {root:$('#content'), rootMargin:'600px'});
  observer.observe(sent);
}
function renderAll(keepScroll){
  const tab = curTab();
  updateToolbar(); renderSide();
  const content = $('#content');
  if(!tab){
    content.textContent='';
    content.appendChild(buildDropHint());
    updateStatus(); return;
  }
  if(tab.mode==='text'){ prepText(tab); if(!tab.hits.length&&tab.query)rebuildTextSearch(tab); buildTextView(tab, keepScroll); }
  else { makeBinHitSet(tab); buildBinView(tab, keepScroll); }
  updateStatus();
}
function buildDropHint(){
  const d = el('div'); d.id='drop';
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
    if(files.length) openFiles(files);
  });
  document.addEventListener('paste', handlePaste);  // Ctrl+V でクリップボードから開く
}

/* ---------- 起動 ---------- */
initToolbar(); initSettings(); initDnD(); initBinSelect();
$('#helpVer').textContent = 'v'+APP_VERSION;
applyDisplaySettings();
renderAll();
if(!LS.ok) console.warn('localStorage が使用できません。設定はセッション内のみ有効です。');

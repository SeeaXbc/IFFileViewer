/* =====================================================================
 * 列フィルタ(4.10)：Excelのオートフィルタ相当。列ごとの値チェックリストで
 * 行を絞り込む（複数列はAND）。検索ヒット行・差分行フィルタとは積集合。
 * =================================================================== */
const CF_LIST_CAP = 5000;   // ポップアップに表示するユニーク値の上限

/* タブ状態: tab.colFilterOn(フィルタ行の表示) / tab.colFilters(Map ci→Set(許可値)) */
function colFilterActive(tab){
  return !!(tab.colFilters && tab.colFilters.size);
}
function toggleColFilterRow(){
  const t = curTab(); if(!t || t.mode!=='text') return;
  t.colFilterOn = !t.colFilterOn;
  if(!t.colFilterOn && colFilterActive(t)){
    t.colFilters.clear();               // フィルタ行を隠すときは絞り込みも解除
    toast('列フィルタを解除しました');
  }
  closeColFilterPop();
  renderAll(true);
}
function clearColFilters(tab){
  if(!colFilterActive(tab)) return;
  tab.colFilters.clear();
  closeColFilterPop();
  renderAll(true);
  toast('列フィルタをすべて解除しました');
}
/* 値集合を適用（null/全値選択なら解除）。UIとテストの共通入口 */
function applyColFilter(tab, ci, valueSet){
  if(!tab.colFilters) tab.colFilters = new Map();
  if(!valueSet) tab.colFilters.delete(ci);
  else tab.colFilters.set(ci, valueSet);
  tab._cfKey = tab._cache.cellsKey;     // 列構成の変更検知用(4.10)
  renderAll(true);
}
/* フィルタ通過行の列挙（複数列AND）。行番号は元ファイルのまま */
function colFilterRows(tab){
  const c = tab._cache, out = [];
  const fs = [...tab.colFilters.entries()];
  for(let li=0; li<c.rows.length; li++){
    const r = c.rows[li];
    let ok = true;
    for(const [ci,set] of fs){ if(!set.has(r[ci] ?? '')){ ok = false; break; } }
    if(ok) out.push(li);
  }
  return out;
}
/* 表示行リストの合成(4.5/4.9/4.10)：列フィルタ ∩ 検索ヒット行 ∩ 差分行 */
function filterLinesFor(tab){
  /* 列構成が変わっていたら列フィルタを自己解除（列番号の意味が変わるため） */
  if(colFilterActive(tab) && tab._cfKey !== tab._cache.cellsKey){
    tab.colFilters.clear();
    toast('列構成が変わったため列フィルタを解除しました');
  }
  let list = null;
  if(colFilterActive(tab)) list = colFilterRows(tab);
  if(tab.filterHits){
    const hits = [...tab.hitsByLine.keys()].sort((a,b)=>a-b);
    list = list ? intersectSorted(list, hits) : hits;
  }
  const dr = diffRowsForFilter(tab);
  if(dr) list = list ? intersectSorted(list, dr) : dr;
  return list;
}
function intersectSorted(a, b){
  const out = []; let i=0, j=0;
  while(i<a.length && j<b.length){
    if(a[i]===b[j]){ out.push(a[i]); i++; j++; }
    else if(a[i]<b[j]) i++; else j++;
  }
  return out;
}

/* --- フィルタ行（▼ボタンの行）。ヘッダーブロック内に置いてsticky固定 --- */
function buildColFilterRow(tab, c){
  const r = el('div','cfrow');
  const g = makeLn(tab,'');
  if(colFilterActive(tab)){
    const x = el('button','cfclear','✕');
    x.title = '列フィルタをすべて解除';
    x.onclick = ()=>clearColFilters(tab);
    g.appendChild(x); g.title='';
  }
  r.appendChild(g);
  for(let i=0; i<c.colW.length; i++){
    const set = tab.colFilters?.get(i);
    const b = el('button','cfbtn'+(set?' on':''), set ? `▼${set.size}` : '▼');
    b.style.width = `calc(${cellOuterW(tab,c,i)||1}ch + ${tab.style==='excel'?9:0}px)`;
    b.title = set ? `第${i+1}列: ${set.size} 値で絞り込み中（クリックで変更）` : `第${i+1}列のフィルタ`;
    b.onclick = ev=>{ ev.stopPropagation(); openColFilterPop(tab, i, b); };
    r.appendChild(b);
  }
  return r;
}

/* --- 値リストのポップアップ（Excelのオートフィルタ相当） --- */
let _cfCtx = null;   // {tab, ci, counts, order, checked}
function ensureCfPop(){
  let pop = $('#cfPop');
  if(pop) return pop;
  pop = el('div'); pop.id = 'cfPop';
  pop.innerHTML = `
    <input type="text" id="cfSearch" placeholder="値を検索" spellcheck="false">
    <label class="cfall"><input type="checkbox" id="cfAll" checked> (すべて選択)</label>
    <div id="cfList"></div>
    <div id="cfNote"></div>
    <div class="cfft">
      <button id="cfOk" class="on">OK</button>
      <button id="cfClear">この列を解除</button>
      <button id="cfCancel">キャンセル</button>
    </div>`;
  document.body.appendChild(pop);
  pop.addEventListener('mousedown', e=>e.stopPropagation());
  $('#cfSearch').oninput = renderCfList;
  $('#cfSearch').onkeydown = e=>{
    if(e.isComposing || e.keyCode===229) return;
    if(e.key==='Enter'){ e.preventDefault(); cfApply(); }
    if(e.key==='Escape'){ e.preventDefault(); closeColFilterPop(); }
  };
  $('#cfAll').onchange = ()=>{
    const on = $('#cfAll').checked;
    for(const v of cfVisibleValues()){ if(on) _cfCtx.checked.add(v); else _cfCtx.checked.delete(v); }
    renderCfList();
  };
  $('#cfOk').onclick = cfApply;
  $('#cfClear').onclick = ()=>{ if(_cfCtx) applyColFilter(_cfCtx.tab, _cfCtx.ci, null); closeColFilterPop(); };
  $('#cfCancel').onclick = closeColFilterPop;
  document.addEventListener('mousedown', e=>{
    if(_cfCtx && !(e.target instanceof Element && e.target.closest('#cfPop,.cfbtn'))) closeColFilterPop();
  });
  return pop;
}
function collectColValues(tab, ci){
  const counts = new Map();
  for(const r of tab._cache.rows){
    const v = r[ci] ?? '';
    counts.set(v, (counts.get(v)||0)+1);
  }
  /* 並び順: 全て数値なら数値順、それ以外は文字列順（Excel同様の感覚） */
  const keys = [...counts.keys()];
  const NUM = /^[+-]?\d+(\.\d+)?$/;
  const allNum = keys.every(k=>k==='' || NUM.test(k.trim()));
  keys.sort(allNum
    ? (a,b)=> a==='' ? 1 : b==='' ? -1 : (+a)-(+b)
    : (a,b)=> a.localeCompare(b,'ja'));
  return {counts, order:keys};
}
function openColFilterPop(tab, ci, btnEl){
  const pop = ensureCfPop();
  const {counts, order} = collectColValues(tab, ci);
  const cur = tab.colFilters?.get(ci);
  _cfCtx = {tab, ci, counts, order, checked: new Set(cur ?? order)};
  $('#cfSearch').value = '';
  renderCfList();
  pop.style.display = 'block';
  const r = btnEl.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - pw - 8)) + 'px';
  pop.style.top = (r.bottom + ph > window.innerHeight - 8 ? Math.max(4, r.top - ph - 2) : r.bottom + 2) + 'px';
  $('#cfSearch').focus();
}
function cfVisibleValues(){
  const q = $('#cfSearch').value.toLowerCase();
  return _cfCtx.order.filter(v=>!q || v.toLowerCase().includes(q));
}
function renderCfList(){
  if(!_cfCtx) return;
  const list = $('#cfList'); list.textContent = '';
  const vis = cfVisibleValues();
  const shown = vis.slice(0, CF_LIST_CAP);
  for(const v of shown){
    const lb = el('label','cfitem');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = _cfCtx.checked.has(v);
    cb.onchange = ()=>{ cb.checked ? _cfCtx.checked.add(v) : _cfCtx.checked.delete(v); syncCfAll(); };
    lb.appendChild(cb);
    lb.appendChild(el('span','v', v==='' ? '(空白)' : v));
    lb.appendChild(el('span','n', _cfCtx.counts.get(v).toLocaleString()));
    list.appendChild(lb);
  }
  $('#cfNote').textContent =
    (vis.length > CF_LIST_CAP ? `値が多いため先頭 ${CF_LIST_CAP.toLocaleString()} 件を表示（検索で絞り込めます）。` : '') +
    `ユニーク ${_cfCtx.order.length.toLocaleString()} 値`;
  syncCfAll();
}
function syncCfAll(){
  const vis = cfVisibleValues();
  $('#cfAll').checked = vis.length>0 && vis.every(v=>_cfCtx.checked.has(v));
}
function cfApply(){
  if(!_cfCtx) return;
  const {tab, ci, order, checked} = _cfCtx;
  if(checked.size===0){ toast('少なくとも1つの値を選択してください'); return; }
  const all = order.every(v=>checked.has(v));
  applyColFilter(tab, ci, all ? null : new Set(checked));
  closeColFilterPop();
}
function closeColFilterPop(){
  _cfCtx = null;
  const pop = $('#cfPop');
  if(pop) pop.style.display = 'none';
}

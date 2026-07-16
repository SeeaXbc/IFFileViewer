/* =====================================================================
 * 比較（差分）(4.9)：分割中の2ペインを行番号ベースでセル単位比較
 * ＋ 検査NG・差分のエクスポート（TSVクリップボード / CSV保存）
 * =================================================================== */
let diffOn = false;        // ⇄ 比較トグル（セッション内のみ）
let diffFilter = false;    // 差分行のみ表示
let _diff = null;          // 比較結果キャッシュ {t0,t1,k0,k1,cells,rows,miss0,miss1,over}
let _diffCur = -1;         // 差分行ジャンプの現在位置
const DIFF_CELL_CAP = 200000;  // セル差分ハイライトの上限（異種ファイル比較の暴走対策）

function diffActive(){
  return diffOn && layout!=='single'
    && !!paneTab(0) && !!paneTab(1) && paneTab(0)!==paneTab(1)
    && paneTab(0).mode==='text' && paneTab(1).mode==='text';
}
/* 状態の自己修復：分割解除・タブクローズ等で比較が成立しなくなったらOFFへ */
function syncDiffState(){
  if(diffOn && !diffActive()){ diffOn=false; diffFilter=false; _diff=null; }
}
function ensureDiff(){
  if(!diffActive()) return null;
  const t0 = paneTab(0), t1 = paneTab(1);
  const c0 = prepText(t0), c1 = prepText(t1);
  if(_diff && !_diff.dirty && _diff.t0===t0 && _diff.t1===t1
     && _diff.k0===c0.cellsKey && _diff.k1===c1.cellsKey) return _diff;
  const cells = new Set(), rows = new Set(), miss0 = new Set(), miss1 = new Set();
  const n0 = c0.rows.length, n1 = c1.rows.length, n = Math.max(n0, n1);
  const MISSING = '\u0000';  // 「列なし」と空文字を区別する番兵
  let over = false;
  for(let li=0; li<n; li++){
    if(li>=n1){ miss0.add(li); rows.add(li); continue; }
    if(li>=n0){ miss1.add(li); rows.add(li); continue; }
    const r0 = c0.rows[li], r1 = c1.rows[li];
    const nc = Math.max(r0.length, r1.length);
    let d = false;
    for(let ci=0; ci<nc; ci++){
      if((r0[ci]??MISSING)!==(r1[ci]??MISSING)){
        d = true;
        if(cells.size<DIFF_CELL_CAP) cells.add(li+':'+ci); else over = true;
      }
    }
    if(d) rows.add(li);
  }
  _diff = {t0, t1, k0:c0.cellsKey, k1:c1.cellsKey, cells, rows, miss0, miss1, over, dirty:false};
  return _diff;
}
/* 行フィルタ(4.5)への供給：差分行のみ表示（tabの行数内にクランプ） */
function diffRowsForFilter(tab){
  if(!diffFilter) return null;
  const dm = ensureDiff(); if(!dm) return null;
  if(paneTab(tab.pane)!==tab) return null;
  const max = tab._cache.lines.length;
  return [...dm.rows].filter(li=>li<max).sort((a,b)=>a-b);
}
function toggleDiff(){
  if(!diffOn){
    if(layout==='single'){ toast('比較は分割表示中に使用できます'); return; }
    if(!paneTab(0) || !paneTab(1)){ toast('両方のペインにファイルを開いてください'); return; }
    if(paneTab(0).mode!=='text' || paneTab(1).mode!=='text'){ toast('比較はテキストモードのみ対応です'); return; }
    if(paneTab(0)===paneTab(1)){ toast('別々のタブを表示してください'); return; }
    diffOn = true; _diff = null; _diffCur = -1;
    const dm = ensureDiff();
    toast(dm.rows.size
      ? `差分: ${dm.cells.size.toLocaleString()}${dm.over?'+':''} セル / ${dm.rows.size.toLocaleString()} 行（行番号ベースの比較）`
      : '差分はありません（全行一致）');
  }else{
    diffOn = false; diffFilter = false; _diff = null;
  }
  renderAllPanes(true);
}
function toggleDiffFilter(){
  if(!diffActive()) return;
  diffFilter = !diffFilter;
  renderAllPanes(true);
}
function jumpNextDiff(){
  const dm = ensureDiff(); if(!dm || !dm.rows.size) return;
  const t = curTab(); if(!t || t.mode!=='text') return;
  const lines = [...dm.rows].filter(li=>li<t._cache.lines.length).sort((a,b)=>a-b);
  if(!lines.length) return;
  _diffCur = (_diffCur+1) % lines.length;
  const li = lines[_diffCur];
  /* 同期OFFでも両ペインを同じ行へ揃える */
  for(const p of [0,1]){
    const pt = paneTab(p);
    if(!pt || pt.mode!=='text' || li>=pt._cache.lines.length) continue;
    ensureTextRows(pt, li+1);
    const row = contentOf(pt).querySelector(`[data-l="${li}"]`);
    if(row){ row.scrollIntoView({block:'center'}); flashRow(row); }
  }
}
/* 編集コミット等での行内容変更時に呼ぶ：差分を再計算対象にし、相手ペインの表示も更新 */
function diffInvalidate(changedTab){
  if(!diffOn) return;
  if(_diff) _diff.dirty = true;
  _diffCur = -1;
  if(changedTab && diffActive()){
    const other = paneTab(1-changedTab.pane);
    if(other && other!==changedTab && other.mode==='text') refreshRenderedTextRows(other);
  }
}

/* --- エクスポート(4.7/4.9)：TSVをクリップボードへ。Ctrl+クリックでCSV保存 --- */
function tsvEscape(v){ return String(v??'').replace(/[\t\r\n]/g,' '); }
async function exportRows(rows, csvName, viaCtrl){
  if(!rows || rows.length<=1){ toast('出力する行がありません'); return; }
  if(viaCtrl){
    /* CSVファイルとして保存先フォルダへ（UTF-8 BOM付き・Excel向け） */
    if(!fsaAvailable()){ toast('CSV保存はChrome/Edgeのみ対応です（通常クリックでコピーは可能）'); return; }
    await restoreSaveDir();
    if(!saveDir){ await pickSaveDir(); if(!saveDir) return; }
    if(!(await ensureDirPermission())){ toast('保存先フォルダへのアクセスが許可されませんでした'); return; }
    const csv = '\uFEFF' + rows.map(r=>r.map(v=>{
      v = String(v??'');
      return /[",\r\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v;
    }).join(',')).join('\r\n');
    try{
      const finalName = await uniqueName(saveDir, csvName);
      const fh = await saveDir.getFileHandle(finalName, {create:true});
      const w = await fh.createWritable();
      await w.write(new TextEncoder().encode(csv));
      await w.close();
      toast(`「${finalName}」を保存しました（${(rows.length-1).toLocaleString()} 件）`);
    }catch(e){ toast('保存に失敗しました: '+e.message); }
    return;
  }
  const tsv = rows.map(r=>r.map(tsvEscape).join('\t')).join('\r\n');
  let ok = true;
  try{ await navigator.clipboard.writeText(tsv); }
  catch(err){
    const ta = el('textarea'); ta.value = tsv; ta.style.cssText='position:fixed;left:-9999px';
    document.body.appendChild(ta); ta.select();
    try{ ok = document.execCommand('copy'); }catch(e2){ ok = false; }
    document.body.removeChild(ta);
  }
  toast(ok ? `${(rows.length-1).toLocaleString()} 件をコピーしました（TSV・Excelへ貼り付け可）` : 'コピーに失敗しました');
}
function valExportRows(t){
  const c = t._cache;
  ensureValidation(t);
  if(!c.valNG || !c.valNG.size) return null;
  const def = resolvedDef(t);
  const hdr0 = (def && def.headers && def.headers[0]) || [];
  const rows = [['行','列','列名','値','理由']];
  [...c.valNG.entries()]
    .map(([k,reason])=>{ const [li,ci]=k.split(':').map(Number); return {li,ci,reason}; })
    .sort((a,b)=>a.li-b.li || a.ci-b.ci)
    .forEach(({li,ci,reason})=>rows.push([li+1, ci+1, hdr0[ci]??'', c.rows[li]?.[ci]??'', reason]));
  return rows;
}
function diffExportRows(){
  const dm = ensureDiff(); if(!dm) return null;
  const c0 = dm.t0._cache, c1 = dm.t1._cache;
  const rows = [['行','列',`${paneLabel(0)}: ${dm.t0.name}`,`${paneLabel(1)}: ${dm.t1.name}`]];
  [...dm.cells]
    .map(k=>{ const [li,ci]=k.split(':').map(Number); return {li,ci}; })
    .sort((a,b)=>a.li-b.li || a.ci-b.ci)
    .forEach(({li,ci})=>rows.push([li+1, ci+1, c0.rows[li]?.[ci]??'（列なし）', c1.rows[li]?.[ci]??'（列なし）']));
  for(const li of [...dm.miss0].sort((a,b)=>a-b)) rows.push([li+1,'-','（行あり）','（行なし）']);
  for(const li of [...dm.miss1].sort((a,b)=>a-b)) rows.push([li+1,'-','（行なし）','（行あり）']);
  return rows;
}

/* =====================================================================
 * ツールバー / ステータスバー
 * =================================================================== */
function initToolbar(){
  const se = $('#selEnc');
  const oa = el('option',null,'自動判定'); oa.value='auto'; se.appendChild(oa);
  for(const [v,l] of ENCODINGS){ const o=el('option',null,l); o.value=v; se.appendChild(o); }

  $('#btnOpen').onclick = ()=>$('#fileInput').click();
  $('#fileInput').onchange = e=>{ openFiles([...e.target.files]); e.target.value=''; };
  $('#btnPaste').onclick = pasteFromClipboardButton;

  $('#btnText').onclick = ()=>setMode('text');
  $('#btnBin').onclick  = ()=>setMode('bin');
  se.onchange = ()=>{ const t=curTab(); if(!t)return; t.encSel=se.value; t._cache={}; t._dec=null;
    rebuildTextSearch(t); renderAll(true); };
  $('#delimAdd').onchange = ()=>{
    const t=curTab(); if(!t)return;
    const v=$('#delimAdd').value;
    if(!v) return;
    /* 任意区切り文字は登録して選択肢に保持し、即座に有効化する(4.1) */
    if(!DELIM_PRESETS.some(p=>p[0]===v) && !customDelims.includes(v)){
      customDelims.push(v); LS.set('ifv_delims', customDelims);
    }
    if(!t.delims.includes(v)) t.delims.push(v);
    $('#delimAdd').value='';
    t._cache.cellsKey=null; renderAll(true);
  };
  $('#selNl').onchange = ()=>{
    const t=curTab(); if(!t)return;
    t.nlSel = $('#selNl').value;
    t._cache.linesKey=null;
    rebuildTextSearch(t);
    renderAll(true);
  };
  $('#btnExcel').onclick = ()=>setStyle('excel');
  $('#btnEm').onclick    = ()=>setStyle('em');
  $('#selGap').onchange = ()=>{
    let g = Math.round(+$('#selGap').value||0);
    g = Math.max(0, Math.min(16, g));
    $('#selGap').value = g;
    settings.delimGap = g; LS.set('ifv_settings', settings);
    applyDisplaySettings();
    const t=curTab();
    if(t && t.mode==='text') renderAllPanes(true); // 列幅・ヘッダー幅の再計算（両ペイン）
  };
  $('#btnWs').onclick = ()=>{
    settings.showWs = !settings.showWs; LS.set('ifv_settings', settings);
    const t=curTab();
    if(t && t.mode==='text') renderAllPanes(true); else updateToolbar();
  };
  const zoomStep = d=>{
    let i = ZOOMS.indexOf(settings.zoom); if(i<0) i = ZOOMS.indexOf(100);
    i = Math.max(0, Math.min(ZOOMS.length-1, i+d));
    settings.zoom = ZOOMS[i]; LS.set('ifv_settings', settings); applyDisplaySettings();
  };
  $('#zoomIn').onclick  = ()=>zoomStep(1);
  $('#zoomOut').onclick = ()=>zoomStep(-1);
  $('#zoomReset').onclick = ()=>{ settings.zoom=100; LS.set('ifv_settings', settings); applyDisplaySettings(); };
  $('#selDef').onchange = ()=>{
    const t=curTab(); if(!t)return;
    const v=$('#selDef').value;
    t.defSel = (v==='auto'||v==='none') ? v : +v;
    t._cache.cellsKey=null;
    renderAll(true);
  };

  let debounce=null;
  $('#searchBox').oninput = ()=>{
    clearTimeout(debounce);
    debounce = setTimeout(()=>{
      const t=curTab(); if(!t)return;
      if(t.mode==='text'){ t.query=$('#searchBox').value; rebuildTextSearch(t); afterSearchChange(t); }
      else { t.binQuery=$('#searchBox').value; rebuildBinSearch(t); refreshRenderedBinRows(t); }
    },250);
  };
  $('#searchBox').onkeydown = e=>{
    if(e.isComposing || e.keyCode===229) return;  // 日本語IMEの変換確定Enterでは検索しない
    if(e.key==='Enter'){ e.preventDefault(); doSearch(e.shiftKey?-1:1); }
  };
  $('#chkCase').onchange = ()=>{ const t=curTab(); if(!t)return;
    t.queryCase=$('#chkCase').checked; rebuildTextSearch(t); afterSearchChange(t); };
  $('#btnRegex').onclick = ()=>{ const t=curTab(); if(!t)return;
    t.queryRegex = !t.queryRegex;
    $('#btnRegex').classList.toggle('on', t.queryRegex);
    $('#searchBox').placeholder = t.queryRegex ? '正規表現' : '文字列';
    rebuildTextSearch(t); afterSearchChange(t); };
  $('#btnNext').onclick = ()=>doSearch(1);
  $('#btnPrev').onclick = ()=>doSearch(-1);
  $('#btnFilter').onclick = ()=>{
    const t=curTab(); if(!t)return;
    t.filterHits = !t.filterHits;
    renderAll(true);
  };

  /* 列情報・検査(4.7) */
  $('#btnProf').onclick = openProfile;
  $('#btnProfClose').onclick = ()=>$('#profBack').classList.remove('show');
  $('#profBack').onclick = e=>{ if(e.target===$('#profBack')) $('#profBack').classList.remove('show'); };
  $('#btnVal').onclick = toggleValidation;
  $('#btnValJump').onclick = jumpNextNG;

  /* 編集モード(9章) */
  $('#btnEditMode').onclick = ()=>{ const t=curTab(); if(!t)return; t.edit ? exitEditMode(t) : enterEditMode(t); };
  $('#saveNameIn').onchange = ()=>{ const t=curTab(); if(t&&t.edit) t.edit.saveName=$('#saveNameIn').value; };
  $('#btnSaveDir').onclick = ()=>pickSaveDir();
  $('#btnSaveFile').onclick = ()=>{ const t=curTab(); if(t&&t.edit) saveEditedFile(t); };
  $('#btnRevertAll').onclick = ()=>{
    const t=curTab();
    if(t&&t.edit&&t.edit.edits.size&&confirm(`${t.edit.edits.size} セルの編集をすべて元に戻しますか？`)) revertAllEdits(t);
  };
  window.addEventListener('beforeunload', e=>{
    if(tabs.some(t=>t.edit&&t.edit.edits.size&&t.edit.unsaved)){ e.preventDefault(); e.returnValue=''; }
  });

  /* マルチペイン(4.8) */
  $('#laySingle').onclick = ()=>setLayout('single');
  $('#layCols').onclick = ()=>setLayout('cols');
  $('#layRows').onclick = ()=>setLayout('rows');
  $('#btnSync').onclick = toggleSyncScroll;

  $('#btnSide').onclick = ()=>{ $('#side').classList.toggle('hidden'); };
  $('#btnSettings').onclick = openSettings;
  $('#btnHelp').onclick = ()=>$('#helpBack').classList.add('show');
  $('#btnHelpClose').onclick = ()=>$('#helpBack').classList.remove('show');
  $('#helpBack').onclick = e=>{ if(e.target===$('#helpBack')) $('#helpBack').classList.remove('show'); };

  document.addEventListener('keydown', e=>{
    if(e.key==='F3'){ e.preventDefault(); doSearch(e.shiftKey?-1:1); }
    if(e.ctrlKey||e.metaKey){
      const k = e.key.toLowerCase();
      if(k==='f'){ e.preventDefault(); $('#searchBox').focus(); $('#searchBox').select(); }
      else if(k==='g'){ e.preventDefault(); gotoPrompt(); }
      else if(k==='z'||k==='y'){
        /* 編集モードのUndo/Redo(9章)。input内は各inputのネイティブ動作を優先 */
        const t = curTab();
        const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
        if(t && t.edit && !inInput){
          e.preventDefault();
          if(k==='y' || (k==='z'&&e.shiftKey)) redoEdit(t); else undoEdit(t);
        }
      }
    }
  });
}
function afterSearchChange(t){
  /* ヒット集合が変わったときの再描画：フィルタ中は表示行自体が変わるため全再構築 */
  if(t.filterHits) renderAll(true);
  else refreshRenderedTextRows(t);
}
function doSearch(dir){
  const t=curTab(); if(!t)return;
  if(t.mode==='text'){
    if(t.query!==$('#searchBox').value){ t.query=$('#searchBox').value; rebuildTextSearch(t); if(t.filterHits) renderAll(true); }
    gotoTextHit(dir); refreshRenderedTextRows(t);
    const h=t.hits[t.curHit]; if(h){ const row=contentOf(t).querySelector(`[data-l="${h.line}"]`); if(row)row.scrollIntoView({block:'center'}); }
  }else{
    if(t.binQuery!==$('#searchBox').value){ t.binQuery=$('#searchBox').value; rebuildBinSearch(t); }
    gotoBinHit(dir);
  }
}
function setMode(m){
  const t=curTab(); if(!t||t.mode===m)return;
  if(t.edit){ toast('編集モード中はモードを切り替えられません'); return; }
  t.mode=m; renderAll();
}
function setStyle(s){
  const t=curTab(); if(!t||t.style===s)return;
  t.style=s; LS.set('ifv_style',s); renderAll(true);
}
/* --- マルチペイン(4.8)：レイアウト切替・同期スクロール --- */
function setLayout(l){
  if(layout===l) return;
  closeCellEd(true);
  layout = l;
  const pn = $('#panes');
  pn.classList.toggle('single', l==='single');
  pn.classList.toggle('rows', l==='rows');
  resetPaneSizes();
  if(l==='single'){
    /* 分割解除：全タブを左ペインへ集約。表示中タブは維持する */
    const keep = paneTab(0) || paneTab(1);
    tabs.forEach(t=>{ t.pane = 0; });
    panes[0].cur = keep ? tabs.indexOf(keep) : -1;
    panes[1].cur = -1;
    activePane = 0;
    syncScroll = false;
  }
  paneActClass();
  renderTabs(); renderAllPanes(true);
}
function toggleSyncScroll(){
  if(layout==='single') return;
  syncScroll = !syncScroll;
  if(syncScroll) syncPaneScroll(paneContent(activePane));  // ONにした瞬間に位置を揃える
  updateToolbar();
  toast(syncScroll ? 'スクロール同期: ON（縦・横）' : 'スクロール同期: OFF');
}
let _syncing = false;
function syncPaneScroll(srcEl){
  if(!syncScroll || layout==='single' || _syncing) return;
  const other = paneContent(srcEl===paneContent(0) ? 1 : 0);
  _syncing = true;
  other.scrollTop = srcEl.scrollTop;
  other.scrollLeft = srcEl.scrollLeft;
  _syncing = false;
}
function resetPaneSizes(){
  document.querySelectorAll('#panes .pane').forEach((/** @type {any} */p)=>{ p.style.flex=''; });
}
function updateToolbar(){
  const t = curTab();
  const has = !!t;
  /* レイアウト・同期(4.8)：タブの有無と無関係に操作可能 */
  $('#laySingle').classList.toggle('on', layout==='single');
  $('#layCols').classList.toggle('on', layout==='cols');
  $('#layRows').classList.toggle('on', layout==='rows');
  $('#btnSync').classList.toggle('hiddenCtl', layout==='single');
  $('#btnSync').classList.toggle('on', !!syncScroll);
  ['#btnText','#btnBin','#selEnc','#selNl','#delimAdd','#btnExcel','#btnEm','#selDef','#btnWs','#searchBox','#btnPrev','#btnNext','#chkCase','#btnRegex','#btnEditMode','#btnFilter','#btnProf','#btnVal']
    .forEach(s=>{ $(s).disabled=!has; });
  $('#toolbar2').style.display = (has && t.mode==='text') ? '' : 'none';
  updateEditCtls();
  if(!has){ $('#searchCount').textContent=''; return; }
  /* 編集モード中は前提条件（区切り・文字コード・改行・定義・モード固定）を担保するためロック(9章) */
  const lock = !!t.edit;
  ['#selEnc','#selNl','#delimAdd','#selDef','#btnText','#btnBin'].forEach(s=>{ $(s).disabled = lock; });
  $('#btnText').classList.toggle('on', t.mode==='text');
  $('#btnBin').classList.toggle('on', t.mode==='bin');
  document.querySelectorAll('.text-only').forEach((/** @type {any} */e)=>{ e.style.display = t.mode==='text'?'':'none'; });
  $('#selEnc').value = t.encSel;
  renderDelimChips(t);
  $('#selNl').value = t.nlSel||'auto';
  $('#selGap').value = String(+settings.delimGap||0);
  $('#btnWs').classList.toggle('on', !!settings.showWs);
  $('#btnExcel').classList.toggle('on', t.style==='excel');
  $('#btnEm').classList.toggle('on', t.style==='em');
  $('#searchBox').placeholder = t.mode==='text' ? (t.queryRegex?'正規表現':'文字列') : '16進 例: 0D 0A';
  $('#searchBox').value = t.mode==='text'?t.query:t.binQuery;
  $('#chkCase').checked = t.queryCase;
  $('#btnRegex').classList.toggle('on', !!t.queryRegex);
  $('#btnFilter').classList.toggle('on', !!t.filterHits);
  updateValCtls(t);
  /* ヘッダー定義セレクト */
  const sd = $('#selDef'); sd.textContent='';
  const ai = matchDef(t.name);
  const o1 = el('option',null, ai>=0?`自動: ${defs[ai].name||defs[ai].match}`:'自動 (一致なし)'); o1.value='auto'; sd.appendChild(o1);
  const o2 = el('option',null,'なし'); o2.value='none'; sd.appendChild(o2);
  defs.forEach((d,i)=>{ const o=el('option',null,d.name||d.match); o.value=String(i); sd.appendChild(o); });
  sd.value = String(t.defSel);
  updateSearchCount();
}
function updateValCtls(t){
  /* 検査ボタン(4.7)：rules を持つ定義が有効なときのみ表示 */
  const rules = t ? valRules(t) : [];
  $('#btnVal').style.display = rules.length ? '' : 'none';
  $('#btnVal').classList.toggle('on', !!(t && t.valOn));
  const ngc = (t && t.valOn && t._cache.valNG) ? t._cache.valNG.size : 0;
  $('#btnVal').textContent = (t && t.valOn) ? `✔ 検査 NG:${ngc.toLocaleString()}` : '✔ 検査';
  $('#btnValJump').classList.toggle('hiddenCtl', !ngc);
  $('#btnValJump').textContent = 'NG行へ▼';
}
function delimChipLabel(v){
  if(v===',') return ',';
  if(v==='\t') return 'Tab';
  if(v===';') return ';';
  if(v==='|') return '|';
  if(v===' ') return '空白';
  return v;
}
function renderDelimChips(tab){
  /* プリセット + 登録済み任意区切りをチップ表示。クリックで有効/無効（複数同時可） */
  const box = $('#delimChips'); box.textContent='';
  const fixed = fixedWidths(tab);
  $('#delimAdd').style.display = fixed ? 'none' : '';
  if(fixed){  // 固定長定義(4.6)適用中は区切りではなく幅で分割
    box.appendChild(el('span','fixedTag', `固定長: ${fixed.length}列 / 計${fixed.reduce((a,b)=>a+b,0)}バイト`));
    return;
  }
  const vals = [...DELIM_PRESETS.map(p=>p[0]), ...customDelims];
  for(const v of tab.delims) if(!vals.includes(v)) vals.push(v);  // 定義由来などの未登録値
  for(const v of vals){
    const b = el('button','dchip'+(tab.delims.includes(v)?' on':''), delimChipLabel(v));
    b.disabled = !!tab.edit;  // 編集モード中は区切り変更不可(9章)
    b.title = tab.edit ? '編集モード中は変更できません' : (tab.delims.includes(v) ? 'クリックで無効化' : 'クリックで有効化');
    b.onclick = ()=>{
      const i = tab.delims.indexOf(v);
      if(i>=0) tab.delims.splice(i,1); else tab.delims.push(v);
      tab._cache.cellsKey=null; renderAll(true);
    };
    if(customDelims.includes(v)){
      b.title += '／右クリックで登録解除';
      b.oncontextmenu = e=>{
        e.preventDefault();
        customDelims.splice(customDelims.indexOf(v),1); LS.set('ifv_delims', customDelims);
        tabs.forEach(t=>{
          const k = t.delims.indexOf(v);
          if(k>=0){ t.delims.splice(k,1); t._cache.cellsKey=null; }
        });
        renderAllPanes(true);
        toast(`区切り文字「${v}」を登録解除しました`);
      };
    }
    box.appendChild(b);
  }
}
function applyDisplaySettings(){
  const css = settings.font==='custom' ? (settings.fontCustom || FONTS.biz.css) : (FONTS[settings.font]||FONTS.biz).css;
  document.documentElement.style.setProperty('--mono', css);
  document.documentElement.style.setProperty('--dgap', (+settings.delimGap||0)+'ch');
  document.querySelectorAll('#panes .pane > .content').forEach((/** @type {any} */c)=>{ c.style.fontSize = (13*settings.zoom/100).toFixed(1)+'px'; });
  $('#zoomReset').textContent = settings.zoom+'%';
}
function updateSearchCount(){
  const t=curTab(); const s=$('#searchCount');
  const err = !!(t && t.mode==='text' && t.queryError);
  s.classList.toggle('err', err);
  $('#searchBox').classList.toggle('err', err);
  if(!t){ s.textContent=''; return; }
  if(err){ s.textContent='無効'; s.title='正規表現エラー: '+t.queryError; return; }
  s.title='';
  const hits = t.mode==='text'?t.hits:t.binHits;
  const curI = t.mode==='text'?t.curHit:t.binCurHit;
  const q = t.mode==='text'?t.query:t.binQuery;
  s.textContent = q ? `${hits.length?curI+1:0}/${hits.length}` : '';
}
function updateStatus(){
  const t = curTab(); const sb=$('#status');
  if(!t){ sb.innerHTML = `<span>${layout!=='single' ? paneLabel(activePane)+'ペイン: ' : ''}ファイル未読み込み</span>`; return; }
  const enc = resolvedEnc(t);
  const items = [];
  if(layout!=='single') items.push(`<b>${paneLabel(activePane)}ペイン</b>`);
  items.push(...[
    `<b>${escText(t.name)}</b>`,
    `${fmtSize(t.bytes.length)}`,
    `モード: <b>${t.mode==='text'?'テキスト':'バイナリ'}</b>`,
    `文字コード: <b>${escText(encLabel(enc))}${t.encSel==='auto'?' (自動)':''}</b>`
  ]);
  if(t.mode==='text'){
    const c = t._cache;
    if(c.lines){
      const nl=c.nl, kinds=[]; if(nl.crlf)kinds.push('CRLF×'+nl.crlf); if(nl.lf)kinds.push('LF×'+nl.lf); if(nl.cr)kinds.push('CR×'+nl.cr);
      items.push(`${c.lines.length.toLocaleString()} 行 / ${c.colW?c.colW.length:0} 列`);
      if(t.filterHits) items.push(`⊜ <b>ヒット行のみ表示</b>（${totalTextRows(t).toLocaleString()} 行）`);
      if(t.valOn && c.valNG) items.push(c.valNG.size ? `✔ 検査NG: <b>${c.valNG.size.toLocaleString()} セル</b>` : '✔ 検査OK');
      if(fixedWidths(t)) items.push('固定長');
      const nlHead = (t.nlSel&&t.nlSel!=='auto') ? `<b>${t.nlSel.toUpperCase()} 指定</b> / 検出: ` : '';
      items.push(`改行: ${nlHead}${kinds.length?kinds.join(' '):'なし'}${kinds.length>1?' (混在)':''} / 末尾改行: ${c.trailingNL?'あり':'なし'}`);
    }
    const def = resolvedDef(t);
    if(def) items.push(`定義: <b>${escText(def.name||def.match)}</b>`);
  }else{
    items.push(`表示: 先頭 ${fmtSize(Math.min(t.binLimit,t.bytes.length))} / ${fmtSize(t.bytes.length)}`);
    if(t.selA!=null){
      const bs = [...t.bytes.slice(t.selA, t.selB)].map(x=>x.toString(16).toUpperCase().padStart(2,'0')).join(' ');
      const st = t._dec;
      const ch = (st && st.types[t.selA]===1) ? (st.chars.get(t.selA)||'') : '';
      items.push(`選択: <b>0x${t.selA.toString(16).toUpperCase().padStart(8,'0')}</b> (${t.selA}) [${bs}]${ch?` 「${escText(ch)}」`:''} — Escで解除`);
    }
  }
  const ed = t && t.edit;
  if(ed) items.push(`✏ <b>編集モード</b>（元ファイルは変更されません）${ed.edits.size?` / 編集済み ${ed.edits.size} セル${ed.unsaved?'<b>（未保存）</b>':'（保存済み）'}`:''}`);
  else items.push('🔒 読み取り専用');
  sb.innerHTML = items.map(x=>`<span>${x}</span>`).join('');
}
function escText(s){ const d=el('div'); d.textContent=s; return d.innerHTML; }


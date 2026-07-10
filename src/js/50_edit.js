/* =====================================================================
 * 編集モード(9章)：セル単位編集＋所定フォルダへの保存
 * 完全性保証：未編集行・改行・BOMは元バイトを無加工でコピーする。
 * 編集行はコミット前に「デコード→再エンコード＝元バイト」の可逆性を検証する。
 * =================================================================== */

/* --- エンコーダ（TextDecoderを逆用した実行時逆引き表。テーブル埋め込み不要） --- */
const _encCache = {};
function makeEncoder(enc){
  if(_encCache[enc] !== undefined) return _encCache[enc];
  let e = null;
  if(enc==='utf-8'){
    const te = new TextEncoder();
    e = { encode(s){ return {bytes:te.encode(s)}; },
          chLen(ch){ const cp=ch.codePointAt(0); return cp<0x80?1:cp<0x800?2:cp<0x10000?3:4; } };
  }else if(enc==='utf-16le' || enc==='utf-16be'){
    const le = enc==='utf-16le';
    e = { encode(s){
      const b = new Uint8Array(s.length*2);
      for(let i=0;i<s.length;i++){ const c=s.charCodeAt(i);
        if(le){ b[i*2]=c&0xFF; b[i*2+1]=c>>8; } else { b[i*2]=c>>8; b[i*2+1]=c&0xFF; } }
      return {bytes:b};
    }, chLen(ch){ return ch.length*2; } };
  }else if(enc==='ascii'){
    e = { encode(s){
      const b = new Uint8Array(s.length);
      for(let i=0;i<s.length;i++){ const c=s.charCodeAt(i);
        if(c===9||c===10||c===13||(c>=0x20&&c<=0x7E)) b[i]=c; else return {bad:s[i]}; }
      return {bytes:b};
    }, chLen(){ return 1; } };
  }else{
    const map = buildReverseTable(enc);
    if(map) e = { encode(s){
      const out=[];
      for(const ch of s){
        const b = map.get(ch);
        if(!b) return {bad:ch};
        for(const x of b) out.push(x);
      }
      return {bytes:new Uint8Array(out)};
    }, chLen(ch){ const b=map.get(ch); return b?b.length:2; } };  // 未知文字は全角=2バイト仮定
  }
  _encCache[enc] = e;
  return e;
}
function buildReverseTable(enc){
  let dec;
  try{ dec = new TextDecoder(enc); }catch(err){ return null; }
  const map = new Map();
  const put = (s,bytes)=>{ if(s.length===1 && s!=='�' && !map.has(s)) map.set(s,bytes); };
  const b1 = new Uint8Array(1);
  for(let a=0;a<256;a++){ b1[0]=a; put(dec.decode(b1),[a]); }
  const b2 = new Uint8Array(2);
  for(let a=0x80;a<256;a++) for(let c=0;c<256;c++){ b2[0]=a; b2[1]=c; put(dec.decode(b2),[a,c]); }
  if(enc==='euc-jp'){ /* JIS X 0212（SS3 0x8F 先行の3バイト） */
    const b3 = new Uint8Array(3); b3[0]=0x8F;
    for(let a=0xA1;a<=0xFE;a++) for(let c=0xA1;c<=0xFE;c++){ b3[1]=a; b3[2]=c; put(dec.decode(b3),[0x8F,a,c]); }
  }
  return map;
}
function bytesEqual(a,b){
  if(a.length!==b.length) return false;
  for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return false;
  return true;
}

/* --- バイトレベル行分割：tab.bytes を c.lines と1:1対応の行別バイト列に分割する。
   改行バイト(0x0A/0x0D)は対応エンコーディングのマルチバイト文字の途中に現れないため
   バイト走査で安全に分割できる（UTF-16は2バイト単位で判定）。BOMは別途保持 --- */
function splitLineBytes(tab){
  const enc = resolvedEnc(tab);
  const b = tab.bytes;
  const mode = tab.nlSel||'auto';
  let start = 0;
  if(enc==='utf-8' && b.length>=3 && b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF) start=3;
  else if(enc==='utf-16le' && b.length>=2 && b[0]===0xFF&&b[1]===0xFE) start=2;
  else if(enc==='utf-16be' && b.length>=2 && b[0]===0xFE&&b[1]===0xFF) start=2;
  const u16 = enc==='utf-16le'||enc==='utf-16be';
  const step = u16?2:1;
  const at = !u16 ? i=>b[i]
    : enc==='utf-16le' ? i=>(b[i+1]===0 ? b[i] : -1)
    : i=>(b[i]===0 ? b[i+1] : -1);
  const n = u16 ? start + Math.floor((b.length-start)/2)*2 : b.length; // 端数バイトは最終行へ
  const segs=[];
  const CR=13, LF=10;
  let i=start, ls=start;
  while(i<n){
    const ch = at(i);
    let tl=0, ts='';
    if(mode==='auto'){
      if(ch===CR){ if(i+step<n && at(i+step)===LF){tl=step*2;ts='\r\n';} else {tl=step;ts='\r';} }
      else if(ch===LF){ tl=step; ts='\n'; }
    }else if(mode==='crlf'){ if(ch===CR && i+step<n && at(i+step)===LF){tl=step*2;ts='\r\n';} }
    else if(mode==='lf'){ if(ch===LF){tl=step;ts='\n';} }
    else { if(ch===CR){tl=step;ts='\r';} }
    if(tl){ segs.push({bytes:b.subarray(ls,i), term:b.subarray(i,i+tl), termStr:ts}); i+=tl; ls=i; }
    else i+=step;
  }
  if(ls < b.length) segs.push({bytes:b.subarray(ls), term:b.subarray(b.length), termStr:''});
  return {bom:b.subarray(0,start), segs};
}

/* --- 編集モードの開始/終了 --- */
function enterEditMode(tab){
  if(tab.mode!=='text'){ toast('編集はテキストモードでのみ使用できます'); return; }
  const enc = resolvedEnc(tab);
  const encr = makeEncoder(enc);
  if(!encr){ toast(`${encLabel(enc)} の書き戻しには対応していません`); return; }
  const c = prepText(tab);
  const sp = splitLineBytes(tab);
  /* 整合性検証：バイト分割から再構成したテキストがデコード結果と完全一致すること */
  const ok = sp.segs.length===c.lines.length
    && sp.segs.map((s,i)=>c.lines[i]+s.termStr).join('') === c.text;
  if(!ok){ toast('このファイルは編集モードを開始できません（行の対応付けに失敗しました）'); return; }
  /* 「自動」の定義を具体的な選択に固定：編集中に定義の追加で一致先が変わるのを防ぐ */
  if(tab.defSel==='auto'){ const di = matchDef(tab.name); tab.defSel = di>=0 ? di : 'none'; }
  tab.edit = { enc, segs:sp.segs, bom:sp.bom, edits:new Map(), lineOk:new Map(),
               hist:[], histI:0, unsaved:false, saveName:tab.name };
  restoreSaveDir();
  renderAll(true);
  toast('編集モード: セルをダブルクリックで編集できます（元ファイルは変更されません）');
}
function exitEditMode(tab){
  const ed = tab.edit; if(!ed) return;
  if(ed.edits.size && ed.unsaved
     && !confirm(`未保存の編集が ${ed.edits.size} セルあります。編集を破棄して読み取り専用に戻りますか？`)) return;
  closeCellEd(false);
  tab.edit = null;
  if(ed.edits.size){
    tab._cache = {};            // 元バイトから再デコードして確実に原本表示へ戻す
    prepText(tab);
    rebuildTextSearch(tab);
    toast('編集モードを終了しました（表示は元ファイルの内容に戻ります）');
  }
  renderAll(true);
}

/* 行の編集可否：初回編集時に「エンコード＝元バイト」の可逆性を検証（結果はキャッシュ） */
function lineEditable(tab, li){
  const ed = tab.edit; if(!ed) return false;
  if(ed.lineOk.has(li)) return ed.lineOk.get(li);
  const r = makeEncoder(ed.enc).encode(tab._cache.lines[li]);
  const ok = !!r.bytes && bytesEqual(r.bytes, ed.segs[li].bytes);
  ed.lineOk.set(li, ok);
  return ok;
}

/* --- セル値の確定 --- */
function commitCellEdit(tab, li, ci, val){
  const ed = tab.edit, c = tab._cache;
  const cur = c.rows[li][ci];
  const fixed = fixedWidths(tab);
  if(fixed){
    if(/[\r\n]/.test(val)) return '改行を含む値は確定できません';
    const r0 = makeEncoder(ed.enc).encode(val);
    if(!r0.bytes) return `「${r0.bad}」は ${encLabel(ed.enc)} で表現できない文字です`;
    if(ci<fixed.length){  // 余り列（定義超過分）は幅制約なし
      const w = fixed[ci], bl = r0.bytes.length;
      const sp = (ed.enc==='utf-16le'||ed.enc==='utf-16be') ? 2 : 1;  // 半角スペースのバイト数
      if(bl>w) return `固定長フィールド第${ci+1}列（${w}バイト）を超えています（${bl}バイト）`;
      if(bl<w){
        if((w-bl)%sp) return `第${ci+1}列の幅 ${w}バイトに揃えられません`;
        val += ' '.repeat((w-bl)/sp);  // 右側を半角スペースでパディングして幅を維持
      }
    }
  }else{
    for(const d of tab.delims) if(d && val.includes(d))
      return `区切り文字「${delimChipLabel(d)}」を含む値は確定できません（列構造が変わるため）`;
    if(/[\r\n]/.test(val)) return '改行を含む値は確定できません';
    const r = makeEncoder(ed.enc).encode(val);
    if(!r.bytes) return `「${r.bad}」は ${encLabel(ed.enc)} で表現できない文字です`;
  }
  if(val===cur) return null;
  pushHist(ed, {li, ci, before:cur, after:val});
  setCellRaw(tab, li, ci, val);
  finishCellChanges(tab);
  return null;
}
/* セル値の低レベル反映：rows/lines/edits台帳/列幅を更新（履歴・再描画は呼び出し側） */
function setCellRaw(tab, li, ci, val){
  const c = tab._cache, ed = tab.edit;
  const key = li+':'+ci, rec = ed.edits.get(key);
  if(rec){ if(rec.orig===val) ed.edits.delete(key); }
  else if(c.rows[li][ci]!==val) ed.edits.set(key, {orig:c.rows[li][ci]});
  c.rows[li][ci] = val;
  c.lines[li] = joinRowLine(c.rows[li], c.rowDelims[li]);
  if(tab.valOn) revalidateLine(tab, li);
  const w = strW(val);
  if(c.colW && ci<c.colW.length){ if(w>c.colW[ci]){ c.colW[ci]=Math.min(w,MAX_COLW); tab._growW=true; } }
  else tab._growW = true;
}
function finishCellChanges(tab){
  const c = tab._cache, ed = tab.edit;
  ed.unsaved = true;
  c.text = c.lines.map((l,i)=>l+ed.segs[i].termStr).join('');  // マーカー件数等の整合
  c.lower = null;
  recountTextMarkers(tab);
  rebuildTextSearch(tab);
  if(paneTab(tab.pane)===tab){  // 所属ペインに表示中でなければDOMを触らない
    if(tab._growW){ tab._growW=false; renderPane(tab.pane, true); }
    else refreshRenderedTextRows(tab);
    if(curTab()===tab){ updateStatus(); updateEditCtls(); }
  } else tab._growW = false;
}
function joinRowLine(f, ds){
  let s = f[0]||'';
  for(let k=0;k<ds.length;k++) s += ds[k] + (f[k+1]??'');
  return s;
}
/* --- 編集履歴（Undo/Redo） --- */
function pushHist(ed, entry){
  ed.hist.length = ed.histI;         // Redo分岐を破棄
  ed.hist.push(entry);
  if(ed.hist.length>500) ed.hist.shift();
  ed.histI = ed.hist.length;
}
function undoEdit(tab){
  const ed = tab.edit; if(!ed) return;
  if(!closeCellEd(true)) return;
  if(ed.histI<=0){ toast('取り消す編集はありません'); return; }
  const en = ed.hist[--ed.histI];
  for(const op of (en.ops||[en])) setCellRaw(tab, op.li, op.ci, op.before);
  finishCellChanges(tab);
  toast('編集を1つ元に戻しました（Ctrl+Y でやり直し）');
}
function redoEdit(tab){
  const ed = tab.edit; if(!ed) return;
  if(!closeCellEd(true)) return;
  if(ed.histI>=ed.hist.length){ toast('やり直す編集はありません'); return; }
  const en = ed.hist[ed.histI++];
  for(const op of (en.ops||[en])) setCellRaw(tab, op.li, op.ci, op.after);
  finishCellChanges(tab);
  toast('編集をやり直しました');
}
function revertCell(tab, li, ci){
  const rec = tab.edit.edits.get(li+':'+ci); if(!rec) return;
  pushHist(tab.edit, {li, ci, before:tab._cache.rows[li][ci], after:rec.orig});
  setCellRaw(tab, li, ci, rec.orig);
  finishCellChanges(tab);
  toast('セルを元に戻しました');
}
function revertAllEdits(tab){
  const ed = tab.edit, c = tab._cache;
  if(!ed.edits.size) return;
  const ops = [...ed.edits.entries()].map(([k,rec])=>{
    const [li,ci] = k.split(':').map(Number);
    return {li, ci, before:c.rows[li][ci], after:rec.orig};
  });
  pushHist(ed, {ops});
  for(const op of ops) setCellRaw(tab, op.li, op.ci, op.after);
  finishCellChanges(tab);
}

/* --- インラインセルエディタ（セルに重ねる固定位置input） --- */
let _cellEd=null, _cellEdCtx=null;
function ensureCellEd(){
  if(_cellEd) return _cellEd;
  _cellEd = el('input'); _cellEd.id='cellEd'; _cellEd.spellcheck=false;
  _cellEd.addEventListener('keydown', e=>{
    if(e.isComposing || e.keyCode===229) return;  // 日本語IMEの変換確定Enterでは確定しない
    if(e.key==='Enter'){ e.preventDefault(); closeCellEd(true); }
    else if(e.key==='Escape'){ e.preventDefault(); closeCellEd(false); }
    else if(e.key==='Tab'){ e.preventDefault(); const ctx=_cellEdCtx; if(closeCellEd(true)) moveCellEd(ctx, e.shiftKey?-1:1); }
  });
  _cellEd.addEventListener('blur', ()=>{ if(_cellEdCtx) closeCellEd(true); });
  document.body.appendChild(_cellEd);
  return _cellEd;
}
function openCellEditor(tab, cellEl, li, ci){
  if(!tab.edit || isNaN(li) || isNaN(ci)) return;
  const c = tab._cache;
  if(!c.rows[li] || ci>=c.rows[li].length) return;
  if(!lineEditable(tab, li)){ toast('この行はデコードが非可逆のため編集できません'); return; }
  closeCellEd(false);
  const inp = ensureCellEd();
  const r = cellEl.getBoundingClientRect();
  inp.style.font = getComputedStyle(cellEl).font;
  inp.style.left = r.left+'px';
  inp.style.top = (r.top-2)+'px';
  inp.style.width = Math.max(80, r.width+14)+'px';
  inp.style.height = (r.height+4)+'px';
  inp.value = c.rows[li][ci];
  inp.style.display = 'block';
  _cellEdCtx = {tab, li, ci};
  inp.focus(); inp.select();
}
function closeCellEd(commit){
  const ctx = _cellEdCtx; if(!ctx) return true;
  if(commit){
    const err = commitCellEdit(ctx.tab, ctx.li, ctx.ci, _cellEd.value);
    if(err){ toast(err); _cellEd.focus(); return false; }
  }
  _cellEdCtx = null;
  _cellEd.style.display = 'none';
  return true;
}
function moveCellEd(ctx, d){
  const c = ctx.tab._cache;
  let {li,ci} = ctx; ci += d;
  while(true){
    if(ci<0){ li--; if(li<0)return; ci=(c.rows[li]?.length||1)-1; }
    else if(ci>=(c.rows[li]?.length||0)){ li++; if(li>=c.rows.length)return; ci=0; }
    else break;
  }
  ensureTextRows(ctx.tab, li+1);
  const row = contentOf(ctx.tab).querySelector(`[data-l="${li}"]`); if(!row) return;
  const cell = row.querySelector(`[data-c="${ci}"]`); if(!cell) return;
  cell.scrollIntoView({block:'nearest', inline:'nearest'});
  openCellEditor(ctx.tab, cell, li, ci);
}

/* --- 保存バイト列の構築：未編集行・改行・BOMは元バイトを無加工コピー --- */
function buildSaveBytes(tab){
  const ed = tab.edit, c = tab._cache, encr = makeEncoder(ed.enc);
  const editedLines = new Set();
  for(const k of ed.edits.keys()) editedLines.add(+k.split(':')[0]);
  const parts = [ed.bom];
  for(let li=0; li<ed.segs.length; li++){
    const seg = ed.segs[li];
    if(editedLines.has(li)){
      const r = encr.encode(c.lines[li]);
      if(!r.bytes) throw new Error(`${li+1} 行目をエンコードできません`);
      parts.push(r.bytes);
    }else parts.push(seg.bytes);
    parts.push(seg.term);
  }
  let total=0; for(const p of parts) total+=p.length;
  const out = new Uint8Array(total); let o=0;
  for(const p of parts){ out.set(p,o); o+=p.length; }
  return out;
}

/* --- 保存先フォルダ（File System Access API）＋IndexedDBで権限ハンドル永続化 --- */
/* FSAはlib.domに型がないため any 経由で参照する */
function fsaAvailable(){ return typeof (/** @type {any} */(window)).showDirectoryPicker === 'function'; }
let saveDir=null, _saveDirTried=false;
function idbKV(op, key, val){
  return new Promise(res=>{
    let q;
    try{ q = indexedDB.open('ifv_fs', 1); }catch(e){ res(undefined); return; }
    q.onupgradeneeded = ()=>q.result.createObjectStore('kv');
    q.onerror = ()=>res(undefined);
    q.onsuccess = ()=>{
      const db = q.result;
      try{
        const st = db.transaction('kv', op==='get'?'readonly':'readwrite').objectStore('kv');
        const r = op==='get' ? st.get(key) : st.put(val, key);
        r.onsuccess = ()=>{ res(op==='get'?r.result:true); db.close(); };
        r.onerror = ()=>{ res(undefined); db.close(); };
      }catch(e){ res(undefined); db.close(); }
    };
  });
}
async function restoreSaveDir(){
  if(saveDir || _saveDirTried) return;
  _saveDirTried = true;
  const h = await idbKV('get','dir');
  if(h && h.queryPermission) saveDir = h;
  updateEditCtls();
}
async function pickSaveDir(){
  if(!fsaAvailable()) return;
  try{
    const h = await (/** @type {any} */(window)).showDirectoryPicker({mode:'readwrite'});
    saveDir = h;
    await idbKV('set','dir',h);
    updateEditCtls();
    toast(`保存先フォルダ: ${h.name}`);
  }catch(e){ /* キャンセル */ }
}
async function ensureDirPermission(){
  try{
    let p = await saveDir.queryPermission({mode:'readwrite'});
    if(p==='prompt') p = await saveDir.requestPermission({mode:'readwrite'});
    return p==='granted';
  }catch(e){ return false; }
}
async function uniqueName(dir, name){
  const exists = async n=>{ try{ await dir.getFileHandle(n); return true; }catch(e){ return false; } };
  if(!await exists(name)) return name;
  const m = name.match(/^(.*?)(\.[^.]*)?$/);
  const base = m[1], ext = m[2]||'';
  for(let i=1;;i++){ const n = `${base} (${i})${ext}`; if(!await exists(n)) return n; }
}
async function saveEditedFile(tab){
  const ed = tab.edit; if(!ed) return;
  if(!closeCellEd(true)) return;
  if(!fsaAvailable()){ toast('このブラウザはフォルダ保存に未対応です（Chrome/Edge を使用してください）'); return; }
  await restoreSaveDir();
  if(!saveDir){ await pickSaveDir(); if(!saveDir) return; }
  if(!(await ensureDirPermission())){ toast('保存先フォルダへのアクセスが許可されませんでした。「📁」から選び直してください。'); return; }
  let name = (ed.saveName||tab.name).trim() || tab.name;
  name = name.replace(/[\\/:*?"<>|]/g,'_');
  try{
    const bytes = buildSaveBytes(tab);
    const finalName = await uniqueName(saveDir, name);
    const fh = await saveDir.getFileHandle(finalName, {create:true});
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
    ed.unsaved = false;
    toast(`「${finalName}」として保存しました（${bytes.length.toLocaleString()} バイト）`);
    updateEditCtls(); updateStatus();
  }catch(e){
    toast('保存に失敗しました: '+e.message);
  }
}

/* --- 編集モードUIの表示更新 --- */
function updateEditCtls(){
  const t = curTab();
  const on = !!(t && t.edit);
  $('#btnEditMode').classList.toggle('on', on);
  $('#editCtls').classList.toggle('hiddenCtl', !on);
  if(!on) return;
  if(document.activeElement !== $('#saveNameIn')) $('#saveNameIn').value = t.edit.saveName;
  $('#editCount').textContent = t.edit.edits.size
    ? `編集済み ${t.edit.edits.size} セル${t.edit.unsaved?'':'（保存済み）'}` : '';
  $('#btnRevertAll').disabled = !t.edit.edits.size;
  const fsa = fsaAvailable();
  $('#btnSaveFile').disabled = !fsa;
  $('#btnSaveDir').disabled = !fsa;
  $('#btnSaveFile').title = fsa ? '保存先フォルダに新規ファイルとして保存（元ファイルは変更されません）'
                                : 'このブラウザはフォルダ保存に未対応です（Chrome/Edge を使用）';
  $('#btnSaveDir').textContent = saveDir ? `📁 ${saveDir.name}` : '📁 保存先...';
  $('#btnSaveDir').title = saveDir ? `保存先フォルダ: ${saveDir.name}（クリックで変更）` : '保存先フォルダを選択';
}


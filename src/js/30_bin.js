/* =====================================================================
 * バイナリモード (5章)
 * =================================================================== */
function decState(tab){
  const enc = resolvedEnc(tab);
  if(!tab._dec || tab._dec.enc!==enc){
    tab._dec = { enc, pos:0, runStart:0,
      types:new Uint8Array(tab.bytes.length),   // 0:不正/未確定 1:先頭 2:継続
      chars:new Map(),
      td: enc==='ascii' ? null : new TextDecoder(enc) };
  }
  return tab._dec;
}
/* 増分デコード(5.3実装注記)：1バイトずつ stream で流し込み文字確定位置を検出 */
function extendDecodeMap(tab, upto){
  const st = decState(tab), b = tab.bytes;
  upto = Math.min(upto, b.length);
  if(st.pos>=upto) return;
  if(!st.td){ /* ASCII 自前実装(2章注記) */
    for(let i=st.pos;i<upto;i++){
      const c=b[i];
      if(c>=0x20&&c<=0x7E){ st.types[i]=1; st.chars.set(i,String.fromCharCode(c)); }
    }
    st.pos=upto; return;
  }
  for(let i=st.pos;i<upto;i++){
    const out = st.td.decode(b.subarray(i,i+1), {stream:true});
    if(out.length){
      const clean = out.replace(/�/g,'');
      if(clean){
        st.types[st.runStart]=1; st.chars.set(st.runStart, clean);
        for(let j=st.runStart+1;j<=i;j++) st.types[j]=2;
      } /* 全て不正 → types=0 のまま */
      st.runStart=i+1;
    }
  }
  st.pos=upto;
  if(upto===b.length){ try{st.td.decode();}catch(e){} st.runStart=upto; }
}
function binCharFor(tab, i){
  /* 戻り値: {ch, cont, w} セル表示文字と桁数 */
  const st = tab._dec;
  const t = st.types[i];
  if(t===2) return {ch: settings.contDot?'·':' ', cont:true, w:1};
  if(t!==1) return {ch:'.', cont:false, w:1};
  let s = st.chars.get(i)||'.';
  /* 制御文字は '.' 表示(5.3) */
  let vis='';
  for(const c of s){ const cp=c.codePointAt(0); if(cp>=0x20 && cp!==0x7F) vis+=c; }
  if(!vis) return {ch:'.', cont:false, w:1};
  const w = Math.min(2, strW(vis));
  if(strW(vis)>2) vis = vis[0]; // 超幅は先頭文字のみ（レア）
  return {ch:vis, cont:false, w};
}

/* --- バイナリのマーク(5.4)/検索：バッファ全体対象の一致マップ --- */
function parseHexPattern(s){
  const t = s.replace(/\s+/g,'').toLowerCase();
  if(!t || t.length%2 || /[^0-9a-f]/.test(t)) return null;
  const a=[]; for(let i=0;i<t.length;i+=2) a.push(parseInt(t.substr(i,2),16));
  return a;
}
function findPattern(bytes, pat){
  const starts=[]; const n=bytes.length, m=pat.length;
  outer:
  for(let i=0;i+m<=n;i++){
    for(let j=0;j<m;j++) if(bytes[i+j]!==pat[j]) continue outer;
    starts.push(i); i+=m-1;   // 重複なしカウント
  }
  return starts;
}
function byteHist(tab){
  if(!tab._hist){
    const h = new Uint32Array(256), b = tab.bytes;
    for(let i=0;i<b.length;i++) h[b[i]]++;
    tab._hist = h;
  }
  return tab._hist;
}
function rebuildBinMarkerMap(tab){
  const n = tab.bytes.length;
  if(!tab._mkMap || tab._mkMap.length!==n) tab._mkMap = new Uint8Array(n);
  else tab._mkMap.fill(0);
  tab.binMarkers.forEach((m,idx)=>{
    m.count = 0;
    const pat = parseHexPattern(m.value); if(!pat) return;
    /* 1バイトパターンのOFF時はヒストグラムで件数のみ算出（プリセット多数でも全走査しない） */
    if(pat.length===1 && !m.enabled){ m.count = byteHist(tab)[pat[0]]; return; }
    const starts = findPattern(tab.bytes, pat);
    m.count = starts.length;
    if(!m.enabled) return;
    for(const s of starts) for(let j=s;j<s+pat.length;j++) if(!tab._mkMap[j]) tab._mkMap[j]=idx+1; // 先勝ち
  });
}
function rebuildBinSearch(tab){
  tab.binHits=[]; tab.binCurHit=-1; tab.binSearchLen=0;
  const pat = parseHexPattern(tab.binQuery);
  if(pat){ tab.binHits = findPattern(tab.bytes, pat); tab.binSearchLen = pat.length; }
  updateSearchCount();
}
function gotoBinHit(dir){
  const tab=curTab(); if(!tab||!tab.binHits.length) return;
  tab.binCurHit = (tab.binCurHit + dir + tab.binHits.length) % tab.binHits.length;
  const off = tab.binHits[tab.binCurHit];
  const need = off + tab.binSearchLen;
  if(need > tab.binLimit){
    const newLimit = Math.min(tab.bytes.length, Math.ceil(need/BIN_STEP)*BIN_STEP);
    if(newLimit - tab.binLimit > BIN_JUMP_CONFIRM &&
       !confirm(`該当位置まで表示を ${fmtSize(newLimit)} に拡張します。行数が多くなり動作が重くなる可能性があります。続行しますか？`)){
      updateSearchCount(); return;
    }
    tab.binLimit = newLimit;
  }
  const row = Math.floor(off/16);
  ensureBinRows(tab, row+1);
  refreshRenderedBinRows(tab);
  const rowEl = contentOf(tab).querySelector(`[data-r="${row}"]`);
  if(rowEl) rowEl.scrollIntoView({block:'center'});
  updateSearchCount();
}

/* --- バイナリ描画 --- */
function buildBinView(tab, keepScroll){
  const content = contentOf(tab);
  const st = keepScroll ? {t:content.scrollTop,l:content.scrollLeft} : null;
  content.textContent='';
  rebuildBinMarkerMap(tab);

  /* ルーラー */
  const ruler = el('div','bruler');
  ruler.appendChild(el('span','boff','OFFSET  '));
  let rh='';
  for(let j=0;j<16;j++){ rh += j.toString(16).toUpperCase().padStart(2,'0'); rh += (j===7?'  ':' '); }
  ruler.appendChild(el('span','bhex',rh));
  ruler.appendChild(el('span',null,`デコード: ${encLabel(resolvedEnc(tab))}`));
  content.appendChild(ruler);

  const rowsDiv = el('div'); rowsDiv.className='rows';
  content.appendChild(rowsDiv);
  const moreWrap = el('div'); moreWrap.className='moreWrap';
  content.appendChild(moreWrap);
  const sent = el('div'); sent.className='sentinel'; sent.style.height='1px';
  content.appendChild(sent);

  tab.renderedBin = 0;
  const totalRows = Math.ceil(tab.binLimit/16);
  const target = Math.max(CHUNK_BIN, Math.min(tab._keepBinRows||0, totalRows));
  while(tab.renderedBin < Math.min(target, totalRows)) appendBinRows(tab, CHUNK_BIN);

  setupSentinel(tab, ()=>{
    const tr = Math.ceil(tab.binLimit/16);
    if(tab.renderedBin < tr){ appendBinRows(tab, CHUNK_BIN); return true; }
    updateMoreButton(tab); return false;
  });
  updateMoreButton(tab);
  if(st){ content.scrollTop=st.t; content.scrollLeft=st.l; }
}
function updateMoreButton(tab){
  const w = contentOf(tab).querySelector('.moreWrap'); if(!w) return;
  w.textContent='';
  const tr = Math.ceil(tab.binLimit/16);
  if(tab.renderedBin>=tr && tab.binLimit < tab.bytes.length){
    const b = el('button','more',
      `さらに表示 (+${fmtSize(Math.min(BIN_STEP, tab.bytes.length-tab.binLimit))} / 残り ${fmtSize(tab.bytes.length-tab.binLimit)})`);
    b.onclick = ()=>{
      tab.binLimit = Math.min(tab.bytes.length, tab.binLimit+BIN_STEP);
      appendBinRows(tab, CHUNK_BIN);
      updateMoreButton(tab); updateStatus();
    };
    w.appendChild(b);
  }
}
function appendBinRows(tab, n){
  const rowsDiv = contentOf(tab).querySelector('.rows'); if(!rowsDiv) return;
  const totalRows = Math.ceil(tab.binLimit/16);
  const end = Math.min(tab.renderedBin+n, totalRows);
  extendDecodeMap(tab, Math.min(end*16, tab.bytes.length));
  const frag = document.createDocumentFragment();
  for(let r=tab.renderedBin; r<end; r++) frag.appendChild(buildBinRow(tab, r));
  rowsDiv.appendChild(frag);
  tab.renderedBin = end;
  tab._keepBinRows = end;
  updateStatus();
}
const BSEL = {t:'bsel'};  // クリック選択（対応ハイライト）用番兵
function binStyleAt(tab, i){
  /* 選択 > 検索(現在>ヒット) > マーカー の順で前面 */
  if(tab.selA!=null && i>=tab.selA && i<tab.selB) return BSEL;
  if(tab.binSearchLen && tab.binCurHit>=0){
    const c = tab.binHits[tab.binCurHit];
    if(i>=c && i<c+tab.binSearchLen) return SEARCH_CUR;
  }
  if(tab.binSearchLen && tab._binHitSet && tab._binHitSet(i)) return SEARCH;
  const mi = tab._mkMap ? tab._mkMap[i] : 0;
  return mi ? tab.binMarkers[mi-1] : null;
}
function binRowStrings(tab, r){
  /* 1行分のHEX/デコード文字列と、各バイト→文字列内位置の対応表 */
  const b = tab.bytes;
  const s = r*16, e = Math.min(s+16, Math.min(b.length, tab.binLimit));
  /* HEX（1バイト=2桁+空白、8バイト目の後に追加空白） */
  let hex=''; const hpos=[];
  for(let j=0;j<16;j++){
    hpos[j]=hex.length;
    if(s+j<e) hex += b[s+j].toString(16).toUpperCase().padStart(2,'0');
    else hex += '  ';
    hex += (j===7?'  ':' ');
  }
  /* デコード（各バイト=2桁分。全角は1文字で2桁、半角は+空白） */
  let chs=''; const cpos=[];
  for(let j=0;j<16;j++){
    cpos[j]=chs.length;
    if(s+j<e){
      const d = binCharFor(tab, s+j);
      chs += d.ch + (d.w===1?' ':'');
      if(d.cont) cpos[j] = {p:cpos[j], cont:true};
    } else chs+='  ';
  }
  cpos[16]=chs.length; hpos[16]=hex.length;
  return {s, e, hex, hpos, chs, cpos};
}
function buildBinRow(tab, r){
  const {s, e, hex, hpos, chs, cpos} = binRowStrings(tab, r);
  const row = el('div','brow'); row.dataset.r = r;
  row.appendChild(el('span','boff', s.toString(16).toUpperCase().padStart(8,'0')));
  const posOf = p => (typeof p==='object'?p.p:p);

  /* バイト単位のスタイルを連続区間にまとめて span 化 */
  const hexSp = el('span','bhex'), chSp = el('span','bch');
  let j=0;
  while(j<16){
    const idx=s+j;
    const st = idx<e ? binStyleAt(tab, idx) : null;
    let k=j+1;
    while(k<16 && s+k<e && binStyleAt(tab,s+k)===st) k++;
    if(s+j>=e) k=16;
    const hseg = hex.slice(hpos[j], k<16?hpos[k]:hex.length);
    const cseg = chs.slice(posOf(cpos[j]), k<16?posOf(cpos[k]):chs.length);
    if(!st){
      hexSp.appendChild(document.createTextNode(hseg));
      /* 継続セルは淡色表示：無スタイル区間でも継続セルだけ色を変える */
      appendContAware(chSp, tab, s, j, Math.min(k, Math.ceil((e-s))), chs, cpos, e);
      if(k>Math.ceil(e-s)) chSp.appendChild(document.createTextNode(chs.slice(posOf(cpos[Math.max(j,Math.ceil(e-s))])||chs.length)));
    }else{
      const cls = st===BSEL?'bsel':(st===SEARCH?'hit':(st===SEARCH_CUR?'hit cur':''));
      const h2 = el('span', cls, hseg); const c2 = el('span', cls, cseg);
      if(!cls){ h2.style.background=st.color; c2.style.background=st.color; }
      hexSp.appendChild(h2); chSp.appendChild(c2);
    }
    j=k;
  }
  row.appendChild(hexSp); row.appendChild(chSp);
  return row;
}
function appendContAware(parent, tab, s, j0, j1, chs, cpos, e){
  /* 無スタイル区間のデコード文字列を、継続セルのみ .cont で淡色化して追加 */
  const posOf = p => (typeof p==='object'?p.p:p);
  let j=j0;
  while(j<j1 && s+j<e){
    const isCont = typeof cpos[j]==='object';
    let k=j+1;
    while(k<j1 && s+k<e && (typeof cpos[k]==='object')===isCont) k++;
    const seg = chs.slice(posOf(cpos[j]), posOf(cpos[k])!==undefined?posOf(cpos[k]):chs.length);
    if(isCont) parent.appendChild(el('span','cont',seg));
    else parent.appendChild(document.createTextNode(seg));
    j=k;
  }
}
function refreshRenderedBinRows(tab){
  const rowsDiv = contentOf(tab).querySelector('.rows'); if(!rowsDiv) return;
  makeBinHitSet(tab);
  const rows = rowsDiv.children;
  for(let k=0;k<rows.length;k++){
    const r = +rows[k].dataset.r;
    rowsDiv.replaceChild(buildBinRow(tab, r), rows[k]);
  }
}
function ensureBinRows(tab, upto){
  while(tab.renderedBin < upto && tab.renderedBin < Math.ceil(tab.binLimit/16))
    appendBinRows(tab, Math.max(CHUNK_BIN, upto-tab.renderedBin));
}
function makeBinHitSet(tab){
  /* 検索ヒットのバイト判定（二分探索） */
  const hits = tab.binHits, len = tab.binSearchLen;
  if(!hits.length || !len){ tab._binHitSet=null; return; }
  tab._binHitSet = i=>{
    let lo=0, hi=hits.length-1, best=-1;
    while(lo<=hi){ const mid=(lo+hi)>>1; if(hits[mid]<=i){best=mid;lo=mid+1;}else hi=mid-1; }
    return best>=0 && i < hits[best]+len;
  };
}

/* --- クリック選択：HEX側⇔デコード側の対応ハイライト --- */
function caretOffsetIn(elm, x, y){
  let node, offset;
  if(document.caretRangeFromPoint){
    const r = document.caretRangeFromPoint(x,y); if(!r) return null;
    node = r.startContainer; offset = r.startOffset;
  }else if(document.caretPositionFromPoint){
    const p = document.caretPositionFromPoint(x,y); if(!p) return null;
    node = p.offsetNode; offset = p.offset;
  }else return null;
  if(!elm.contains(node)) return null;
  const rng = document.createRange();
  rng.selectNodeContents(elm); rng.setEnd(node, offset);
  return rng.toString().length;
}
function binSelectByte(tab, i){
  /* マルチバイト文字なら文字全体のバイト範囲に拡張して選択 */
  const st = tab._dec;
  let a=i, b=i+1;
  if(st && i<st.pos){
    while(a>0 && st.types[a]===2) a--;
    b=a+1; while(b<st.pos && st.types[b]===2) b++;
  }
  if(tab.selA===a && tab.selB===b){ clearBinSel(tab); return; } // 再クリックで解除
  const oa=tab.selA, ob=tab.selB;
  tab.selA=a; tab.selB=b;
  refreshBinRange(tab, oa, ob);
  refreshBinRange(tab, a, b);
  updateStatus();
}
function clearBinSel(tab){
  if(tab.selA==null) return;
  const a=tab.selA, b=tab.selB;
  tab.selA=tab.selB=null;
  refreshBinRange(tab, a, b);
  updateStatus();
}
function refreshBinRange(tab, a, b){
  if(a==null) return;
  const rowsDiv = contentOf(tab).querySelector('.rows'); if(!rowsDiv) return;
  for(let r=Math.floor(a/16); r<=Math.floor((b-1)/16); r++){
    const old = rowsDiv.querySelector(`[data-r="${r}"]`);
    if(old) rowsDiv.replaceChild(buildBinRow(tab, r), old);
  }
}
function initBinSelect(){
  document.querySelectorAll('#panes .pane > .content').forEach(cEl=>cEl.addEventListener('click', (/** @type {any} */e)=>{
    const t = curTab(); if(!t || t.mode!=='bin') return;
    const row = e.target.closest('.brow');
    if(!row){ if(!e.target.closest('.more')) clearBinSel(t); return; }
    const pane = e.target.closest('.bhex') ? 'hex' : (e.target.closest('.bch') ? 'ch' : null);
    if(!pane){ clearBinSel(t); return; }
    const paneEl = pane==='hex' ? row.children[1] : row.children[2];
    const off = caretOffsetIn(paneEl, e.clientX, e.clientY);
    if(off==null) return;
    const r = +row.dataset.r;
    const {s, e:end, hpos, cpos} = binRowStrings(t, r);
    const posOf = p => (typeof p==='object'?p.p:p);
    const arr = pane==='hex' ? hpos : cpos;
    let j=0;
    for(let k=0;k<16;k++) if(posOf(arr[k])<=off) j=k;
    if(s+j>=end){ clearBinSel(t); return; }
    binSelectByte(t, s+j);
  }));
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'){
      /* ダイアログが開いていればそちらを閉じる */
      if($('#helpBack').classList.contains('show')){ $('#helpBack').classList.remove('show'); return; }
      if($('#modalBack').classList.contains('show')){ $('#modalBack').classList.remove('show'); return; }
      if($('#profBack').classList.contains('show')){ $('#profBack').classList.remove('show'); return; }
      const t=curTab(); if(t) clearBinSel(t);
    }
  });
}


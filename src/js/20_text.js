/* =====================================================================
 * テキストモード
 * =================================================================== */
function resolvedEnc(tab){ return tab.encSel==='auto' ? (tab._detEnc||(tab._detEnc=detectEncoding(tab.bytes))) : tab.encSel; }
function resolvedDef(tab){
  if(tab.defSel==='none') return null;
  if(tab.defSel==='auto'){ const i=matchDef(tab.name); return i>=0?defs[i]:null; }
  return defs[tab.defSel]||null;
}

/* 複数区切り文字での分割。長い区切りを優先（longest match） */
function tokenize(line, delims){
  if(!delims.length) return {f:[line], d:[]};
  const fields=[], ds=[];
  let start=0, i=0;
  while(i<line.length){
    let hit=null;
    for(const dl of delims){ if(line.startsWith(dl,i)){ hit=dl; break; } }
    if(hit){ fields.push(line.slice(start,i)); ds.push(hit); i+=hit.length; start=i; }
    else i++;
  }
  fields.push(line.slice(start));
  return {f:fields, d:ds};
}

/* --- 固定長分割(4.6)：定義JSONの widths（バイト幅）で分割。バイト幅は
   エンコーディング依存のため、編集モードと同じエンコーダの文字バイト長を使う --- */
function fixedWidths(tab){
  const def = resolvedDef(tab);
  if(!def || !Array.isArray(def.widths) || !def.widths.length) return null;
  const w = def.widths.map(Number);
  return w.every(x=>Number.isFinite(x)&&x>0) ? w : null;
}
function encCharLen(enc){
  const e = makeEncoder(enc);
  if(e) return e.chLen;
  return ch=>chW(ch.codePointAt(0));  // 未対応エンコーディングは表示幅で近似
}
function splitFixed(line, widths, chLen){
  const f = [];
  let i = 0;
  for(let w=0; w<widths.length; w++){
    let remain = widths[w];
    const start = i;
    while(i<line.length && remain>0){
      const ch = String.fromCodePoint(line.codePointAt(i));
      const b = chLen(ch);
      if(b>remain) break;  // フィールド境界をまたぐ文字は次列へ（レイアウト不正の可視化）
      remain -= b; i += ch.length;
    }
    f.push(line.slice(start, i));
  }
  if(i<line.length) f.push(line.slice(i));  // 定義超過分は余り列として表示
  return {f, d:new Array(f.length-1).fill('')};
}
const NL_TERMS = {crlf:'\r\n', lf:'\n', cr:'\r'};

function prepText(tab){
  const enc = resolvedEnc(tab), c = tab._cache;
  if(c.textEnc !== enc){
    c.textEnc = enc;
    c.text = decodeText(tab.bytes, enc);
    c.lower = null;
    let crlf=0, lf=0, cr=0;
    const t = c.text;
    for(let i=0;i<t.length;i++){
      const ch=t.charCodeAt(i);
      if(ch===13){ if(t.charCodeAt(i+1)===10){crlf++;i++;} else cr++; }
      else if(ch===10) lf++;
    }
    c.nl = {crlf,lf,cr};
    c.linesKey = null;
  }
  /* 行分割：自動判定（全種を行区切り扱い）または指定改行のみで分割(4.1) */
  const nlKey = tab.nlSel||'auto';
  if(c.linesKey !== nlKey){
    c.linesKey = nlKey;
    const term = NL_TERMS[nlKey];
    c.lines = term ? c.text.split(term) : c.text.split(/\r\n|\r|\n/);
    c.trailingNL = c.lines.length>1 && c.lines[c.lines.length-1]==='';
    if(c.trailingNL) c.lines.pop();
    if(c.lines.length===1 && c.lines[0]==='') c.lines=[];
    c.cellsKey = null; // 再パース要
  }
  const delims = tab.delims.filter(Boolean).slice().sort((a,b)=>b.length-a.length);
  const def = resolvedDef(tab);
  const fixed = fixedWidths(tab);
  const cellsKey = (fixed ? 'F|'+enc+'|'+JSON.stringify(fixed) : 'D|'+JSON.stringify(delims))
                 + '|' + (def ? JSON.stringify([def.headers, def.rules||null]) : '');
  if(c.cellsKey !== cellsKey){
    c.cellsKey = cellsKey;
    c.rows = []; c.rowDelims = [];
    const chLen = fixed ? encCharLen(enc) : null;
    for(const l of c.lines){
      const {f,d} = fixed ? splitFixed(l, fixed, chLen) : tokenize(l, delims);
      c.rows.push(f); c.rowDelims.push(d);
    }
    c.valKey = null;  // 検査結果は再パースで無効化(4.7)
    /* 列幅計算：全データ + ヘッダー定義（幅は最大値、上限あり）。dW=各境界の区切り文字の最大幅 */
    let nc = 0;
    for(const r of c.rows) if(r.length>nc) nc=r.length;
    const hdr = def ? def.headers : [];
    for(const h of hdr) if(h.length>nc) nc=h.length;
    const w = new Array(nc).fill(1);
    const dw = new Array(Math.max(0,nc-1)).fill(0);
    for(let ri=0; ri<c.rows.length; ri++){
      const r=c.rows[ri], ds=c.rowDelims[ri];
      for(let i=0;i<r.length;i++){ const x=strW(r[i]); if(x>w[i]) w[i]=x; }
      for(let i=0;i<ds.length;i++){ const x=strW(ds[i]); if(x>dw[i]) dw[i]=x; }
    }
    for(const h of hdr) for(let i=0;i<h.length;i++){ const x=strW(String(h[i])); if(x>w[i]) w[i]=x; }
    for(let i=0;i<nc;i++) if(w[i]>MAX_COLW) w[i]=MAX_COLW;
    c.colW = w; c.dW = dw;
  }
  return c;
}

/* --- マーカー(4.4) --- */
function parseNumSpec(s){ /* "3,10-20" → 判定関数と列挙 */
  const parts = String(s).split(',').map(x=>x.trim()).filter(Boolean);
  const ranges=[];
  for(const p of parts){
    const m = p.match(/^(\d+)(?:-(\d+))?$/); if(!m) continue;
    const a=+m[1], b=m[2]?+m[2]:+m[1];
    ranges.push([Math.min(a,b), Math.max(a,b)]);
  }
  return {
    test(n){ return ranges.some(r=>n>=r[0]&&n<=r[1]); },
    countIn(max){ let c=0; for(const r of ranges){ const lo=Math.max(1,r[0]), hi=Math.min(max,r[1]); if(hi>=lo)c+=hi-lo+1; } return c; },
    empty: ranges.length===0
  };
}
function countOcc(hay, needle){
  if(!needle) return 0;
  let c=0,i=0;
  while((i=hay.indexOf(needle,i))>=0){ c++; i+=needle.length; }
  return c;
}
function recountTextMarkers(tab){
  const c = prepText(tab);
  for(const m of tab.markers){
    if(m.type==='string'){
      if(m.regex){
        const re = markerRe(m);
        if(!re){ m.count = null; continue; }   // 不正パターン
        let n=0;
        for(const line of c.lines) for(const mt of line.matchAll(re)) if(mt[0].length) n++;
        m.count = n;
      }
      else if(m.caseSensitive) m.count = countOcc(c.text, m.value);
      else { if(c.lower==null) c.lower=c.text.toLowerCase(); m.count = countOcc(c.lower, m.value.toLowerCase()); }
    }else if(m.type==='line'){
      m.count = parseNumSpec(m.value).countIn(c.lines.length);
    }else{ /* col: 対象列が存在する行数 × 列数 */
      const spec = parseNumSpec(m.value); let n=0;
      for(const r of c.rows) for(let i=0;i<r.length;i++) if(spec.test(i+1)) n++;
      m.count = n;
    }
  }
}

/* --- 検査(4.7)：定義JSONの rules によるセル単位バリデーション --- */
function valRules(tab){
  const def = resolvedDef(tab);
  if(!def || !Array.isArray(def.rules)) return [];
  return def.rules.filter(r=>r && typeof r==='object' && Number.isFinite(+r.col) && +r.col>=1);
}
function isDateLike(s){
  const m = s.match(/^(\d{4})([-\/]?)(\d{2})\2(\d{2})$/);
  if(!m) return false;
  const y=+m[1], mo=+m[3], d=+m[4];
  return mo>=1 && mo<=12 && d>=1 && d<=new Date(y, mo, 0).getDate();
}
function checkRule(rule, v){
  if(v==null) return rule.required ? '列がありません' : null;
  const tv = v.trim();
  if(rule.required && !tv) return '必須項目が空です';
  if(tv){
    if(rule.type==='number' && !/^[+-]?\d+(\.\d+)?$/.test(tv)) return '数値ではありません';
    if(rule.type==='date' && !isDateLike(tv)) return '日付（YYYYMMDD等）ではありません';
  }
  if(rule.pattern){
    try{ if(!new RegExp(rule.pattern).test(v)) return `パターン不一致: ${rule.pattern}`; }
    catch(err){ /* 不正な正規表現ルールは無視 */ }
  }
  return null;
}
function checkLineRules(tab, rules, li, map){
  const r = tab._cache.rows[li];
  for(const rule of rules){
    const ci = +rule.col - 1;
    const reason = checkRule(rule, r[ci]);
    if(reason) map.set(li+':'+ci, reason);
  }
}
function ensureValidation(tab){
  const c = tab._cache;
  if(c.valKey === c.cellsKey && c.valNG) return;
  const rules = valRules(tab);
  const map = new Map();
  for(let li=0; li<c.rows.length; li++) checkLineRules(tab, rules, li, map);
  c.valNG = map; c.valKey = c.cellsKey;
}
function revalidateLine(tab, li){
  const c = tab._cache; if(!c.valNG) return;
  const rules = valRules(tab); if(!rules.length) return;
  for(const k of [...c.valNG.keys()]) if(k.startsWith(li+':')) c.valNG.delete(k);
  checkLineRules(tab, rules, li, c.valNG);
}
function toggleValidation(){
  const t = curTab(); if(!t || t.mode!=='text') return;
  t.valOn = !t.valOn;
  if(t.valOn){
    prepText(t); ensureValidation(t);
    toast(t._cache.valNG.size ? `検査NG ${t._cache.valNG.size} セル（赤枠表示）` : '検査OK：NGセルはありません');
  }
  t._valCur = -1;
  renderAll(true);
}
function jumpNextNG(){
  const t = curTab(); if(!t || !t.valOn || !t._cache.valNG || !t._cache.valNG.size) return;
  const lines = [...new Set([...t._cache.valNG.keys()].map(k=>+k.split(':')[0]))].sort((a,b)=>a-b);
  t._valCur = ((t._valCur??-1)+1) % lines.length;
  const li = lines[t._valCur];
  ensureTextRows(t, li+1);
  const row = contentOf(t).querySelector(`[data-l="${li}"]`);
  if(row){ row.scrollIntoView({block:'center'}); flashRow(row); }
  updateToolbar();
}
function flashRow(row){
  row.classList.remove('flash'); void row.offsetWidth;  // アニメーション再発火
  row.classList.add('flash');
  setTimeout(()=>row.classList.remove('flash'), 1300);
}

/* --- 行/オフセットジャンプ（Ctrl+G） --- */
function gotoPrompt(){
  const t = curTab(); if(!t) return;
  if(t.mode==='text'){
    const c = prepText(t);
    if(!c.lines.length) return;
    const s = prompt(`行番号へジャンプ（1〜${c.lines.length.toLocaleString()}）`);
    if(!s) return;
    const n = Math.max(1, Math.min(c.lines.length, parseInt(s.replace(/[,，\s]/g,''),10)||1));
    if(t.filterHits && t._flist && !t.hitsByLine.has(n-1)){
      t.filterHits = false; renderAll(true);  // フィルタ外の行へはフィルタを解除して移動
      toast('ヒット行フィルタを解除しました');
    }
    ensureTextRows(t, n);
    const row = contentOf(t).querySelector(`[data-l="${n-1}"]`);
    if(row){ row.scrollIntoView({block:'center'}); flashRow(row); }
  }else{
    const s = prompt(`オフセットへジャンプ（10進 または 16進 0x…、0〜${(t.bytes.length-1).toLocaleString()}）`);
    if(!s) return;
    const v = s.trim();
    const n = /^0x/i.test(v) ? parseInt(v,16) : parseInt(v.replace(/[,，\s]/g,''),10);
    if(!isNaN(n)) gotoBinOffset(t, n);
  }
}
function gotoBinOffset(tab, off){
  off = Math.max(0, Math.min(tab.bytes.length-1, off));
  if(off+1 > tab.binLimit){
    tab.binLimit = Math.min(tab.bytes.length, Math.ceil((off+1)/BIN_STEP)*BIN_STEP);
    buildBinView(tab, false);
  }
  const row = Math.floor(off/16);
  ensureBinRows(tab, row+1);
  const rowEl = contentOf(tab).querySelector(`[data-r="${row}"]`);
  if(rowEl){ rowEl.scrollIntoView({block:'center'}); flashRow(rowEl); }
}

/* --- 列コピー：ヘッダークリック / Alt+セルクリック --- */
async function copyColumn(tab, ci){
  if(!(ci>=0)) return;
  const c = prepText(tab);
  const text = c.rows.map(r=>r[ci]??'').join('\n');
  let ok = true;
  try{ await navigator.clipboard.writeText(text); }
  catch(err){
    const ta = el('textarea'); ta.value = text; ta.style.cssText='position:fixed;left:-9999px';
    document.body.appendChild(ta); ta.select();
    try{ ok = document.execCommand('copy'); }catch(e2){ ok = false; }
    document.body.removeChild(ta);
  }
  toast(ok ? `第${ci+1}列（${c.rows.length.toLocaleString()} 行）をコピーしました` : 'コピーに失敗しました');
}

/* --- 列プロファイル(4.7)：列ごとの統計 --- */
function computeProfile(tab, startRow){
  const c = prepText(tab);
  const nc = c.colW.length;
  const NUMRE = /^[+-]?\d+(\.\d+)?$/;
  const cols = Array.from({length:nc}, ()=>({n:0, empty:0, uniq:new Set(), over:false, minL:Infinity, maxL:0, num:0, date:0}));
  for(let ri=startRow||0; ri<c.rows.length; ri++){
    const r = c.rows[ri];
    for(let i=0; i<r.length && i<nc; i++){
      const v = r[i], t = cols[i], tv = v.trim();
      t.n++;
      if(!tv) t.empty++;
      else { if(NUMRE.test(tv)) t.num++; if(isDateLike(tv)) t.date++; }
      if(v.length<t.minL) t.minL = v.length;
      if(v.length>t.maxL) t.maxL = v.length;
      if(!t.over){ t.uniq.add(v); if(t.uniq.size>5000){ t.over=true; t.uniq.clear(); } }
    }
  }
  return cols;
}
function openProfile(){
  const t = curTab(); if(!t || t.mode!=='text') return;
  const cols = computeProfile(t);
  const c = t._cache;
  const def = resolvedDef(t);
  const hdr0 = (def && def.headers && def.headers[0]) || [];
  const total = c.rows.length;
  const body = $('#profBody'); body.textContent='';
  const info = el('div', null, `${t.name} — ${c.lines.length.toLocaleString()} 行 × ${cols.length} 列`);
  info.style.cssText = 'color:var(--sub);font-size:12px';
  body.appendChild(info);
  const wrap = el('div'); wrap.style.overflow='auto';
  const tbl = el('table','ptable');
  const thr = el('tr');
  for(const h of ['列','ヘッダー','値あり','空欄','ユニーク','文字数','型推定']) thr.appendChild(el('th',null,h));
  tbl.appendChild(thr);
  cols.forEach((col,i)=>{
    const filled = col.n - col.empty;
    const miss = total - col.n;
    let type = '文字';
    if(filled===0) type = '（全て空）';
    else if(col.date===filled) type = '日付';
    else if(col.num===filled) type = '数値';
    else if(col.num>=filled*0.9) type = `ほぼ数値（例外${filled-col.num}件）`;
    else if(col.date>=filled*0.9) type = `ほぼ日付（例外${filled-col.date}件）`;
    const tr = el('tr');
    const cells = [
      String(i+1), String(hdr0[i]??''),
      filled.toLocaleString(),
      col.empty.toLocaleString() + (miss>0?`（列なし${miss.toLocaleString()}）`:''),
      col.over ? '5000超' : String(col.uniq.size),
      col.n ? (col.minL===col.maxL ? String(col.maxL) : `${col.minL}〜${col.maxL}`) : '-',
      type
    ];
    for(const v of cells) tr.appendChild(el('td',null,v));
    tbl.appendChild(tr);
  });
  wrap.appendChild(tbl);
  body.appendChild(wrap);
  $('#profBack').classList.add('show');
}

/* --- 検索(6章) --- */
function rebuildTextSearch(tab){
  const c = prepText(tab);
  tab.hits=[]; tab.hitsByLine=new Map(); tab.curHit=-1; tab.queryError=null;
  const q = tab.query;
  if(!q){ updateSearchCount(); return; }
  const MAXHIT = 100000;
  const addHit = (li,s,e)=>{
    const h={line:li, s, e};
    tab.hits.push(h);
    let a=tab.hitsByLine.get(li); if(!a){a=[];tab.hitsByLine.set(li,a);} a.push(h);
    return tab.hits.length<MAXHIT;
  };
  if(tab.queryRegex){
    /* 正規表現検索(6章)：行単位で照合。長さ0の一致は無視 */
    let re;
    try{ re = new RegExp(q, tab.queryCase?'g':'gi'); }
    catch(err){ tab.queryError = err.message; updateSearchCount(); return; }
    outer1:
    for(let li=0; li<c.lines.length; li++){
      for(const m of c.lines[li].matchAll(re)){
        if(!m[0].length) continue;
        if(!addHit(li, m.index, m.index+m[0].length)) break outer1;
      }
    }
  }else{
    const needle = tab.queryCase ? q : q.toLowerCase();
    outer2:
    for(let li=0; li<c.lines.length; li++){
      const line = tab.queryCase ? c.lines[li] : c.lines[li].toLowerCase();
      let i=0;
      while((i=line.indexOf(needle,i))>=0){
        if(!addHit(li, i, i+q.length)) break outer2;
        i+=Math.max(1,q.length);
      }
    }
  }
  updateSearchCount();
}
function gotoTextHit(dir){
  const tab=curTab(); if(!tab||!tab.hits.length){ return; }
  tab.curHit = (tab.curHit + dir + tab.hits.length) % tab.hits.length;
  const h = tab.hits[tab.curHit];
  ensureTextRows(tab, h.line+1);
  refreshRenderedTextRows(tab);
  const row = contentOf(tab).querySelector(`[data-l="${h.line}"]`);
  if(row) row.scrollIntoView({block:'center'});
  updateSearchCount();
}

/* --- 描画 --- */
function markerRe(m){
  /* 正規表現マーカーのコンパイル結果をキャッシュ（行ごとの再コンパイルを避ける） */
  const key = (m.caseSensitive?'s':'i')+' '+m.value;
  if(m._reKey !== key){
    m._reKey = key;
    try{ m._re = new RegExp(m.value, m.caseSensitive?'g':'gi'); m._reErr = null; }
    catch(err){ m._re = null; m._reErr = err.message; }
  }
  return m._re;
}
function styleArrForLine(tab, li, len){
  /* 行文字列の各文字に対するハイライト（文字列マーカー→検索が上書き） */
  let arr = null;
  const c = tab._cache;
  const mk = tab.markers.filter(m=>m.enabled && m.type==='string' && m.value);
  const line = c.lines[li];
  for(const m of mk){
    if(m.regex){
      const re = markerRe(m); if(!re) continue;
      for(const mt of line.matchAll(re)){
        if(!mt[0].length) continue;   // 長さ0の一致は無視
        if(!arr) arr = new Array(len).fill(null);
        for(let j=mt.index;j<mt.index+mt[0].length && j<len;j++) if(!arr[j]) arr[j]=m; // 先勝ち
      }
      continue;
    }
    const hay = m.caseSensitive ? line : line.toLowerCase();
    const nd  = m.caseSensitive ? m.value : m.value.toLowerCase();
    let i=0;
    while((i=hay.indexOf(nd,i))>=0){
      if(!arr) arr = new Array(len).fill(null);
      for(let j=i;j<i+m.value.length && j<len;j++) if(!arr[j]) arr[j]=m;   // 先勝ち
      i+=Math.max(1,m.value.length);
    }
  }
  const hits = tab.hitsByLine.get(li);
  if(hits){
    if(!arr) arr = new Array(len).fill(null);
    for(const h of hits){
      const st = (tab.hits[tab.curHit]===h) ? SEARCH_CUR : SEARCH;
      for(let j=h.s;j<h.e && j<len;j++) arr[j]=st;                          // 検索が前面(6章)
    }
  }
  return arr;
}
function appendVis(parent, s){
  /* 不可視文字の可視化(4.x)：該当文字を .ws スパンで包む（文字自体は本物のまま） */
  if(!settings.showWs){ parent.appendChild(document.createTextNode(s)); return; }
  let last=0;
  for(let i=0;i<s.length;i++){
    const ch=s[i]; let cls=null;
    if(ch===' ') cls='ws-sp';
    else if(ch==='\t') cls='ws-tab';
    else if(ch==='　') cls='ws-zsp';
    else if(ch==='\r') cls='ws-cr';
    if(cls){
      if(i>last) parent.appendChild(document.createTextNode(s.slice(last,i)));
      parent.appendChild(el('span','ws '+cls, ch));
      last=i+1;
    }
  }
  if(last<s.length) parent.appendChild(document.createTextNode(s.slice(last)));
}
function appendRuns(parent, text, arr, s, e){
  /* text[s..e) を arr のスタイル区間ごとに span/テキストノードで追加 */
  if(!arr){ appendVis(parent, text.slice(s,e)); return; }
  let i=s;
  while(i<e){
    const st=arr[i]; let j=i+1;
    while(j<e && arr[j]===st) j++;
    const seg = text.slice(i,j);
    if(!st) appendVis(parent, seg);
    else{
      const sp = el('span', st===SEARCH?'hit':(st===SEARCH_CUR?'hit cur':(st===DIFFCH?'dfch':'')));
      if(st!==SEARCH && st!==SEARCH_CUR && st!==DIFFCH) sp.style.background = st.color;
      appendVis(sp, seg);
      parent.appendChild(sp);
    }
    i=j;
  }
}

/* 仮想ヘッダーの列詳細ツールチップ(4.3)：表示層のみ。textContentで構築しHTMLは注入しない */
function showHdrTip(cell, def){
  const i = +cell.dataset.col;
  const det = Array.isArray(def.details) ? def.details[i] : null;
  if(det==null || String(det)==='') return;
  const tip = $('#hdrTip');
  tip.textContent='';
  const name = (def.headers[0] && def.headers[0][i]!=null && String(def.headers[0][i])!=='') ? String(def.headers[0][i]) : '';
  const t = el('div','t', name || `第${i+1}列`);
  if(name) t.appendChild(el('span','cno', `第${i+1}列`));
  tip.appendChild(t);
  tip.appendChild(el('div','d', String(det)));
  tip.classList.add('show');
  const r = cell.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = Math.max(4, Math.min(r.left, window.innerWidth - tw - 8));
  let y = r.bottom + 4;
  if(y + th > window.innerHeight - 4) y = Math.max(4, r.top - th - 4);
  tip.style.left = x+'px';
  tip.style.top = y+'px';
}
function hideHdrTip(){ $('#hdrTip').classList.remove('show'); }
document.querySelectorAll('#panes .pane > .content').forEach(c=>{
  c.addEventListener('scroll', ()=>{
    hideHdrTip();
    if(_cellEdCtx) closeCellEd(true);  // スクロールでセルエディタは確定して閉じる（固定位置のため）
    syncPaneScroll(c);                 // 同期スクロール(4.8)
  }, {passive:true});
});

function buildTextView(tab, keepScroll){
  const content = contentOf(tab);
  const st = keepScroll ? {t:content.scrollTop,l:content.scrollLeft} : null;
  content.textContent='';
  const c = prepText(tab);
  recountTextMarkers(tab);
  if(tab.valOn) ensureValidation(tab);
  /* 行フィルタ(6章)：検索ヒット行のみ／差分行のみ(4.9)。表示行リストを毎ビルドで再計算 */
  tab._flist = tab.filterHits ? [...tab.hitsByLine.keys()].sort((a,b)=>a-b) : diffRowsForFilter(tab);
  const def = resolvedDef(tab);
  tab._lnW = Math.max(3, String(c.lines.length).length);

  /* 仮想ヘッダー(4.3)：表示層のみ・sticky */
  hideHdrTip();
  if(tab.mode==='text' && def && def.headers && def.headers.length){
    const hb = el('div','hdrblock');
    const dets = Array.isArray(def.details) ? def.details : null;
    for(const hrow of def.headers){
      const r = el('div','hdrrow');
      r.appendChild(makeLn(tab,''));
      for(let i=0;i<c.colW.length;i++){
        const txt = i<hrow.length ? String(hrow[i]) : '';
        const cellw = cellOuterW(tab,c,i);
        const s = el('span','hcell',txt);
        s.style.width = `calc(${cellw}ch + ${tab.style==='excel'?9:0}px)`;
        /* 列詳細(4.3)：details がある列は目印を付け、マウスオーバーで表示 */
        if(dets && dets[i]!=null && String(dets[i])!==''){ s.classList.add('hasdet'); s.dataset.col = i; }
        r.appendChild(s);
      }
      hb.appendChild(r);
    }
    hb.addEventListener('mouseover', e=>{
      const cell = e.target.closest('.hcell.hasdet');
      if(cell) showHdrTip(cell, def);
    });
    hb.addEventListener('mouseout', e=>{
      if(e.target.closest('.hcell.hasdet') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.hcell.hasdet'))) hideHdrTip();
    });
    /* ヘッダークリックで列コピー */
    hb.addEventListener('click', e=>{
      const cell = e.target.closest('.hcell'); if(!cell) return;
      const i = [...cell.parentNode.children].indexOf(cell) - 1;  // 先頭は行番号セル
      if(i>=0) copyColumn(tab, i);
    });
    content.appendChild(hb);
  }
  const rowsDiv = el('div'); rowsDiv.className='rows';
  /* 編集モード(9章)：ダブルクリックでセル編集、編集済みセルは右クリックで元に戻す */
  if(tab.edit){
    rowsDiv.addEventListener('dblclick', e=>{
      const cell = e.target.closest('.xcell,.cell'), row = e.target.closest('.trow');
      if(cell && row) openCellEditor(tab, cell, +row.dataset.l, +cell.dataset.c);
    });
    rowsDiv.addEventListener('contextmenu', e=>{
      const cell = e.target.closest('.xcell,.cell'), row = e.target.closest('.trow');
      if(cell && row && tab.edit.edits.has(row.dataset.l+':'+cell.dataset.c)){
        e.preventDefault();
        revertCell(tab, +row.dataset.l, +cell.dataset.c);
      }
    });
  }
  /* Alt+クリックで列コピー（編集モード以外でも有効） */
  rowsDiv.addEventListener('click', e=>{
    if(!e.altKey) return;
    const cell = e.target.closest('.xcell,.cell'); if(!cell) return;
    e.preventDefault();
    copyColumn(tab, +cell.dataset.c);
  });
  content.appendChild(rowsDiv);
  const sent = el('div'); sent.className='sentinel'; sent.style.height='1px';
  content.appendChild(sent);

  const total = totalTextRows(tab);
  if(tab.filterHits && !total){
    const hint = el('div', null, tab.query ? '検索ヒット行がありません（⊜ ヒット行フィルタ中）' : '検索語を入力するとヒット行のみ表示されます（⊜ ヒット行フィルタ中）');
    hint.style.cssText = 'color:var(--sub);padding:14px';
    rowsDiv.appendChild(hint);
  }
  tab.renderedText = 0;
  const target = Math.max(CHUNK_TEXT, Math.min(tab._keepTextRows||0, total));
  while(tab.renderedText < Math.min(target, total)) appendTextRows(tab, CHUNK_TEXT);

  setupSentinel(tab, ()=>{ if(tab.renderedText < totalTextRows(tab)){ appendTextRows(tab, CHUNK_TEXT); return true; } return false; });
  if(st){ content.scrollTop=st.t; content.scrollLeft=st.l; }
}
function totalTextRows(tab){
  return tab._flist ? tab._flist.length : tab._cache.lines.length;
}
function cellOuterW(tab,c,i){
  /* 桁揃えはセル幅=値幅+区切り最大幅+区切り後間隔（最終列は値幅のみ）。
     グリッドは値幅+区切り後間隔(＋CSS padding) */
  const gap = +settings.delimGap||0;
  if(tab.style==='excel') return c.colW[i]+gap;
  const dw = i<c.colW.length-1 ? (c.dW[i]||0)+gap : 0;
  return c.colW[i]+dw;
}
function makeLn(tab, text){
  const s = el('span','ln', text);
  s.style.width = (tab._lnW+2)+'ch';
  return s;
}
function appendTextRows(tab, n){
  const rowsDiv = contentOf(tab).querySelector('.rows'); if(!rowsDiv) return;
  const src = tab._flist;  // 行フィルタ中は表示行リスト経由
  const frag = document.createDocumentFragment();
  const end = Math.min(tab.renderedText+n, totalTextRows(tab));
  for(let k=tab.renderedText; k<end; k++) frag.appendChild(buildTextRow(tab, src ? src[k] : k));
  rowsDiv.appendChild(frag);
  tab.renderedText = end;
  tab._keepTextRows = end;
  updateStatus();
}
function buildTextRow(tab, li){
  const c = tab._cache;
  const line = c.lines[li], cells = c.rows[li];
  const row = el('div','trow'); row.dataset.l = li;
  /* 行マーカー(4.4) */
  const lineMk = tab.markers.find(m=>m.enabled&&m.type==='line'&&parseNumSpec(m.value).test(li+1));
  if(lineMk) row.style.background = lineMk.color;
  /* 比較(4.9)：差分セル・相手なし行のハイライト */
  const dm = ensureDiff();
  if(dm && (tab.pane===0 ? dm.miss0 : dm.miss1).has(li)) row.classList.add('dfmiss');
  const colMks = tab.markers.filter(m=>m.enabled&&m.type==='col');
  row.appendChild(makeLn(tab, String(li+1)));
  let arr = styleArrForLine(tab, li, line.length);
  const otherRows = dm ? paneTab(1-tab.pane)?._cache.rows : null;
  const ds = c.rowDelims[li];
  let off=0;
  for(let i=0;i<cells.length;i++){
    const v = cells[i], vs=off, ve=off+v.length;
    const dl = i<cells.length-1 ? ds[i] : null;
    const colMk = colMks.find(m=>parseNumSpec(m.value).test(i+1));
    const ngReason = (tab.valOn && c.valNG) ? c.valNG.get(li+':'+i) : null;
    const isDiff = dm && dm.cells.has(li+':'+i);
    /* 差分セル内の「実際に違う文字」だけを濃色ハイライト(4.9) */
    if(isDiff && otherRows){
      const ov = otherRows[li]?.[i];
      if(typeof ov==='string'){
        const [ds,de] = charDiffRange(v, ov);
        if(de>ds){
          if(!arr) arr = new Array(line.length).fill(null);
          for(let j=vs+ds; j<vs+de && j<line.length; j++) if(!arr[j]) arr[j]=DIFFCH;
        }
      }
    }
    if(tab.style==='excel'){
      const cell = el('span','xcell');
      cell.dataset.c = i;
      if(tab.edit && tab.edit.edits.has(li+':'+i)) cell.classList.add('edcell');
      if(ngReason){ cell.classList.add('ngcell'); cell.title = '検査NG: '+ngReason; }
      if(isDiff) cell.classList.add('dfcell');
      cell.style.width = `calc(${cellOuterW(tab,c,i)||1}ch + 9px)`;
      if(colMk) cell.style.background = colMk.color;
      appendRuns(cell, line, arr, vs, ve);
      row.appendChild(cell);
    }else{
      const cell = el('span','cell');
      cell.dataset.c = i;
      if(tab.edit && tab.edit.edits.has(li+':'+i)) cell.classList.add('edcell');
      if(ngReason){ cell.classList.add('ngcell'); cell.title = '検査NG: '+ngReason; }
      if(isDiff) cell.classList.add('dfcell');
      if(colMk) cell.style.background = colMk.color;
      const vsp = el('span','v');
      vsp.style.minWidth = (c.colW[i]||1)+'ch';
      appendRuns(vsp, line, arr, vs, ve);
      cell.appendChild(vsp);
      if(dl!=null){
        const dsp = el('span','dl');
        dsp.style.minWidth = (c.dW[i]||0)+'ch';   // 区切り幅が行ごとに違っても揃える
        appendRuns(dsp, line, arr, ve, ve+dl.length);
        cell.appendChild(dsp);
      }
      row.appendChild(cell);
    }
    off = ve + (dl!=null ? dl.length : 0);
  }
  return row;
}
function refreshRenderedTextRows(tab){
  /* 描画済み行のみ再構築（マーカー/検索変更時） */
  const rowsDiv = contentOf(tab).querySelector('.rows'); if(!rowsDiv) return;
  const rows = rowsDiv.children;
  for(let k=0;k<rows.length;k++){
    const li = +rows[k].dataset.l;
    if(isNaN(li)) continue;  // フィルタ時のヒント表示等はスキップ
    rowsDiv.replaceChild(buildTextRow(tab, li), rows[k]);
  }
}
function ensureTextRows(tab, upto){
  /* upto は「行番号 upto-1 まで表示する」の意。フィルタ中は表示リスト上の位置に変換 */
  let need = upto;
  if(tab._flist){
    const li = upto-1;
    let lo=0, hi=tab._flist.length;
    while(lo<hi){ const m=(lo+hi)>>1; if(tab._flist[m]<li) lo=m+1; else hi=m; }
    need = Math.min(tab._flist.length, lo+1);
  }
  const total = totalTextRows(tab);
  while(tab.renderedText < need && tab.renderedText < total)
    appendTextRows(tab, Math.max(CHUNK_TEXT, need-tab.renderedText));
}


/* =====================================================================
 * タブ / ファイルオープン
 * =================================================================== */
function looksLikeDefs(j){
  const arr = Array.isArray(j)?j:[j];
  return arr.length>0 && arr.every(d => d && typeof d==='object' && typeof d.match==='string' && Array.isArray(d.headers));
}
function wildcardToRe(pat){
  return new RegExp('^'+pat.replace(/[.+^${}()[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$','i');
}
function matchDef(name){
  for(let i=0;i<defs.length;i++){ try{ if(wildcardToRe(defs[i].match).test(name)) return i; }catch(e){} }
  return -1;
}

async function openFiles(fileList){
  for(const f of fileList){
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
    /* 定義JSONファイル判定：.json かつ定義スキーマに合致 → 定義として読み込む(4.3) */
    if(/\.json$/i.test(f.name)){
      try{
        const j = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        if(looksLikeDefs(j)){
          const arr = Array.isArray(j)?j:[j];
          defs = arr.concat(defs);
          LS.set('ifv_defs', defs);
          toast(`ヘッダー定義 ${arr.length} 件を読み込みました（${f.name}）`);
          /* 先頭に追加されるため、手動選択済みのインデックスをずらして維持する */
          tabs.forEach(t=>{ if(typeof t.defSel==='number') t.defSel += arr.length; });
          tabs.forEach(t=>{ if(t.defSel==='auto') t._dirtyView=true; });
          if(curTab()) renderAll();
          continue;
        }
      }catch(e){ /* JSONでなければ通常ファイルとして開く */ }
    }
    const tab = createTab(f.name, bytes);
    tabs.push(tab); cur = tabs.length-1;
  }
  renderTabs(); renderAll();
}

/* --- クリップボードから開く ---
   テキストはコピー元でデコード済み（元バイト・元文字コードは失われている）ため、
   UTF-8で符号化したバイト列を合成して通常タブとして開く。
   ファイルのコピー（エクスプローラー等）は実バイトが取れるので openFiles に渡す */
let pasteSeq = 0;
function openPastedText(text){
  if(!text){ toast('クリップボードにテキストがありません'); return; }
  const bytes = new TextEncoder().encode(text);
  const name = `貼り付け${++pasteSeq}`;
  const tab = createTab(name, bytes);
  tab.encSel = 'utf-8';                          // 合成バイト列はUTF-8（表示を明確化）
  if(text.includes('\t')) tab.delims = ['\t'];   // Excelの範囲コピー(TSV)はタブ区切りを初期適用
  tabs.push(tab); cur = tabs.length-1;
  renderTabs(); renderAll();
  toast(`クリップボードの内容を「${name}」として開きました（${bytes.length.toLocaleString()} バイト・UTF-8）`);
}
function handlePaste(e){
  const t = e.target;
  if(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;  // 入力欄は通常の貼り付け
  const dt = e.clipboardData;
  if(!dt) return;
  if(dt.files && dt.files.length){ e.preventDefault(); openFiles([...dt.files]); return; }
  const text = dt.getData('text/plain');
  if(text){ e.preventDefault(); openPastedText(text); }
}
async function pasteFromClipboardButton(){
  /* ボタン経由は Async Clipboard API。権限がない環境は Ctrl+V を案内 */
  try{
    const text = await navigator.clipboard.readText();
    openPastedText(text);
  }catch(err){
    toast('クリップボードを読み取れませんでした。画面上で Ctrl+V を押してください');
  }
}

function createTab(name, bytes){
  const tab = {
    name, bytes,
    mode: detectMode(bytes),
    encSel: 'auto',                 // 'auto' or ラベル
    nlSel: 'auto',                  // 'auto' | 'crlf' | 'lf' | 'cr'
    delims: [','],                  // 同時に有効な区切り文字（複数可）
    style: LS.get('ifv_style','excel'),
    defSel: 'auto',                 // 'auto' | 'none' | index
    markers: [], binMarkers: [],
    binLimit: Math.min(BIN_STEP, bytes.length),
    renderedText: 0, renderedBin: 0,
    query:'', queryCase:true, queryRegex:false, queryError:null, hits:[], hitsByLine:new Map(), curHit:-1,
    binQuery:'', binHits:[], binCurHit:-1, binSearchLen:0,
    selA:null, selB:null,
    _cache:{}
  };
  /* 自動一致した定義の delimiter/encoding を初期値として適用(4.3) */
  const di = matchDef(name);
  if(di>=0){
    const d = defs[di];
    if(typeof d.delimiter==='string' && d.delimiter) tab.delims = [d.delimiter];
    /* BOM付きファイルはBOM判定が確定的なので、定義の encoding より優先する */
    const hasBOM = (bytes.length>=2 && ((bytes[0]===0xFF&&bytes[1]===0xFE)||(bytes[0]===0xFE&&bytes[1]===0xFF)))
                || (bytes.length>=3 && bytes[0]===0xEF&&bytes[1]===0xBB&&bytes[2]===0xBF);
    if(d.encoding && !hasBOM && ENCODINGS.some(e=>e[0]===d.encoding)) tab.encSel = d.encoding;
  }
  /* 制御コードのマーク候補（初期OFF）(5.4) */
  tab.binMarkers = CTRL_PRESETS.map(([v,l],i)=>
    ({id:++mkSeq, value:v, label:l, preset:true, color:PALETTE[i%PALETTE.length], enabled:false, count:0}));
  return tab;
}

function renderTabs(){
  const bar = $('#tabbar');
  bar.querySelectorAll('.tab').forEach(e=>e.remove());
  const open = $('#btnOpen');
  tabs.forEach((t,i)=>{
    const d = el('div','tab'+(i===cur?' on':''));
    d.appendChild(el('span','name',t.name));
    const x = el('button','x','✕'); x.title='閉じる';
    x.onclick = ev=>{ ev.stopPropagation(); closeTab(i); };
    d.appendChild(x);
    d.onclick = ()=>{ if(cur!==i){ cur=i; renderTabs(); renderAll(); } };
    bar.insertBefore(d, open);
  });
}
function closeTab(i){
  const t = tabs[i];
  if(t && t.edit && t.edit.edits.size && t.edit.unsaved
     && !confirm(`「${t.name}」に未保存の編集が ${t.edit.edits.size} セルあります。破棄して閉じますか？`)) return;
  closeCellEd(false);
  tabs.splice(i,1);
  if(cur>=tabs.length) cur=tabs.length-1;
  renderTabs(); renderAll();
}


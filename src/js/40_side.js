/* =====================================================================
 * サイドパネル（マーカー管理）
 * =================================================================== */
function renderSide(){
  const tab = curTab();
  const form = $('#mkForm'), list = $('#mkList');
  form.textContent=''; list.textContent='';
  if(!tab){ $('#sideTitle').textContent='マーカー'; return; }
  const isBin = tab.mode==='bin';
  $('#sideTitle').textContent = isBin ? 'マーク（バイト列パターン）' : 'マーカー（テキスト）';

  if(isBin){
    const r1 = el('div','row');
    const inp = el('input'); inp.type='text'; inp.placeholder='16進 例: 0D 0A';
    const btn = el('button',null,'追加');
    r1.appendChild(inp); r1.appendChild(btn); form.appendChild(r1);
    const note = el('div',null,'空白・大文字小文字は任意（内部で正規化）');
    note.style.cssText='font-size:11px;color:var(--sub)';
    form.appendChild(note);
    const add = ()=>{
      const pat = parseHexPattern(inp.value);
      if(!pat){ toast('16進バイト列を入力してください（例: 0D 0A）'); return; }
      const norm = pat.map(x=>x.toString(16).toUpperCase().padStart(2,'0')).join(' ');
      const ex = tab.binMarkers.find(m=>m.value===norm);
      if(ex){ ex.enabled=true; inp.value=''; onBinMarkersChanged(tab); toast('既存のマークを有効にしました'); return; }
      tab.binMarkers.push({id:++mkSeq, value:norm,
        color:PALETTE[tab.binMarkers.length%PALETTE.length], enabled:true, count:0});
      inp.value='';
      onBinMarkersChanged(tab);
    };
    btn.onclick=add; inp.onkeydown=e=>{ if(e.key==='Enter')add(); };
    /* ユーザー登録分を上に、制御コード候補は折りたたみで下に */
    for(const m of tab.binMarkers.filter(m=>!m.preset)) list.appendChild(markerRow(tab, m, true));
    const presets = tab.binMarkers.filter(m=>m.preset);
    if(presets.length){
      const det = document.createElement('details');
      const onCount = presets.filter(m=>m.enabled).length;
      det.appendChild(el('summary', null, `制御コード候補 (${presets.length}件${onCount?` / ${onCount} ON`:''})`));
      if(onCount) det.open = true;
      for(const m of presets) det.appendChild(markerRow(tab, m, true));
      list.appendChild(det);
    }
  }else{
    const r1 = el('div','row');
    const sel = el('select');
    [['string','文字列'],['line','行番号'],['col','列番号']].forEach(([v,l])=>{ const o=el('option',null,l); o.value=v; sel.appendChild(o); });
    const cs = el('label','chk'); const csi = el('input'); csi.type='checkbox'; csi.checked=true;
    cs.appendChild(csi); cs.appendChild(document.createTextNode('Aa')); cs.title='大文字小文字を区別';
    const rx = el('button',null,'.*'); rx.title='正規表現でマークする（クリックで切替）';
    rx.style.cssText='font-family:var(--mono);padding:1px 7px';
    r1.appendChild(sel); r1.appendChild(cs); r1.appendChild(rx); form.appendChild(r1);
    const r2 = el('div','row');
    const inp = el('input'); inp.type='text'; inp.placeholder='文字列';
    const btn = el('button',null,'追加');
    r2.appendChild(inp); r2.appendChild(btn); form.appendChild(r2);
    let rxOn = false;
    const syncPh = ()=>{
      inp.placeholder = sel.value==='string' ? (rxOn?'正規表現 例: \\d{8}':'文字列')
                      : (sel.value==='line'?'行番号 例: 3,10-20':'列番号 例: 2,5-7');
      cs.style.visibility = rx.style.visibility = sel.value==='string'?'visible':'hidden';
    };
    rx.onclick = ()=>{ rxOn=!rxOn; rx.classList.toggle('on', rxOn); syncPh(); };
    sel.onchange = syncPh;
    const add = ()=>{
      const v = inp.value; if(!v){ toast('値を入力してください'); return; }
      if(sel.value!=='string' && parseNumSpec(v).empty){ toast('数値または範囲（例: 3,10-20）を入力してください'); return; }
      const isRx = sel.value==='string' && rxOn;
      if(isRx){ try{ new RegExp(v); }catch(err){ toast('正規表現が不正です: '+err.message); return; } }
      tab.markers.push({id:++mkSeq, type:sel.value, value:v, caseSensitive:csi.checked, regex:isRx,
        color:PALETTE[tab.markers.length%PALETTE.length], enabled:true, count:0});
      inp.value='';
      onTextMarkersChanged(tab);
    };
    btn.onclick=add; inp.onkeydown=e=>{ if(e.key==='Enter')add(); };
    for(const m of tab.markers) list.appendChild(markerRow(tab, m, false));
  }
}
function markerRow(tab, m, isBin){
  const d = el('div','mk'+(m.enabled?'':' off'));
  const en = el('input'); en.type='checkbox'; en.checked=m.enabled; en.title='有効/無効';
  en.onchange = ()=>{ m.enabled=en.checked; isBin?onBinMarkersChanged(tab):onTextMarkersChanged(tab); };
  const col = el('input'); col.type='color'; col.value=toHexColor(m.color); col.title='色';
  col.oninput = ()=>{ m.color=col.value; isBin?onBinMarkersChanged(tab):onTextMarkersChanged(tab); };
  const kind = el('span','kind', isBin?(m.preset?'CTRL':'HEX')
    :(m.type==='string'?((m.regex?'正規':'文字')+(m.caseSensitive?'Aa':'')):(m.type==='line'?'行':'列')));
  const val = el('span','val', m.label ? `${m.label}  ${m.value}` : m.value); val.title=m.value;
  const cnt = el('span','cnt', m.count==null?'無効':m.count+'件');
  if(m.count==null){ cnt.style.color='#c00'; cnt.title='正規表現エラー: '+(m._reErr||''); }
  const x = el('button','x','✕'); x.title='登録解除';
  x.onclick = ()=>{
    const a = isBin?tab.binMarkers:tab.markers;
    a.splice(a.indexOf(m),1);
    isBin?onBinMarkersChanged(tab):onTextMarkersChanged(tab);
  };
  [en,col,kind,val,cnt,x].forEach(e=>d.appendChild(e));
  return d;
}
function toHexColor(c){
  if(/^#[0-9a-f]{6}$/i.test(c)) return c;
  const x = el('div'); x.style.color=c; document.body.appendChild(x);
  const m = getComputedStyle(x).color.match(/\d+/g); document.body.removeChild(x);
  return m ? '#'+m.slice(0,3).map(v=>(+v).toString(16).padStart(2,'0')).join('') : '#ffe066';
}
function onTextMarkersChanged(tab){
  recountTextMarkers(tab);
  refreshRenderedTextRows(tab);
  renderSide();
}
function onBinMarkersChanged(tab){
  rebuildBinMarkerMap(tab);
  refreshRenderedBinRows(tab);
  renderSide();
}


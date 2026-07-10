/* =====================================================================
 * 設定モーダル
 * =================================================================== */
const SAMPLE_DEFS = [{
  name:'受注IF', match:'IF_ORDER_*', delimiter:',', encoding:'shift_jis',
  headers:[['顧客ID','受注日','金額','区分'],['必須','YYYYMMDD','整数','1=通常/2=返品']],
  details:[
    '顧客マスタのID。数字8桁固定・先頭0埋め。\n存在しないIDは取込エラーとなる。',
    '受注日。YYYYMMDD形式（例: 20260401）。\n未来日付は不可。',
    '税込金額。整数のみ（カンマ・小数点不可）。\nマイナスは返品時のみ許容。',
    '受注区分。1=通常 / 2=返品。\nそれ以外の値は取込エラー。'
  ],
  rules:[
    {col:1, required:true, pattern:'^C?\\d+$'},
    {col:2, type:'date', required:true},
    {col:3, type:'number'},
    {col:4, pattern:'^[12]$'}
  ]
},{
  name:'固定長IFの例', match:'IF_FIXED_*', encoding:'shift_jis',
  headers:[['伝票番号','取引先名','数量','単価']],
  widths:[6, 20, 5, 9],
  rules:[{col:1, required:true}, {col:3, type:'number'}]
}];
/* --- 定義の自動ドラフト生成(4.3)：開いているタブの状態から定義JSONを起こす --- */
function looksLikeHeaderRow(tab){
  /* 1行目がヘッダーらしいか：数値/日付が9割を占める列すべてで「1行目だけ非数値」なら真 */
  const c = prepText(tab);
  if(c.rows.length<2) return false;
  const first = c.rows[0];
  if(first.length<2 || first.some(v=>!v.trim())) return false;  // ヘッダーに空欄はない前提
  const NUM = /^[+-]?\d+(\.\d+)?$/;
  const isDataLike = v => NUM.test(v)||isDateLike(v);
  let evidence=0, checked=0;
  for(let i=0;i<first.length;i++){
    let num=0, n=0;
    for(let li=1; li<Math.min(c.rows.length,101); li++){
      const v=(c.rows[li][i]??'').trim(); if(!v) continue;
      n++; if(isDataLike(v)) num++;
    }
    if(n>=1 && num/n>=0.9){ checked++; if(!isDataLike(first[i].trim())) evidence++; }
  }
  return checked>0 && evidence===checked;
}
function makeDefDraft(tab){
  const c = prepText(tab);
  /* match: ファイル名末尾の日付・連番（6桁以上の数字）を * に置換 */
  const m = tab.name.match(/^(.*?)(\d{6,})(\.[^.]*)?$/);
  const match = m ? m[1]+'*'+(m[3]||'') : tab.name;
  const useFirst = looksLikeHeaderRow(tab);
  const nc = c.colW.length;
  const first = c.rows[0]||[];
  const headers = [Array.from({length:nc}, (_,i)=> useFirst ? String(first[i]??`列${i+1}`).trim() : `列${i+1}`)];
  /* rules: 列プロファイルの型推定から提案（ヘッダー行と判定した場合は1行目を除外して集計） */
  const prof = computeProfile(tab, useFirst?1:0);
  const rules = [];
  prof.forEach((col,i)=>{
    const filled = col.n - col.empty;
    if(!filled) return;
    const r = {col:i+1};
    let has = false;
    if(col.date===filled){ r.type='date'; has=true; }
    else if(col.num===filled){ r.type='number'; has=true; }
    if(col.empty===0 && col.n>=2){ r.required=true; has=true; }
    if(has) rules.push(r);
  });
  const draft = {
    name: (m ? m[1].replace(/[_\-]+$/,'') : tab.name) + '（自動生成）',
    match,
    headers,
  };
  const fw = fixedWidths(tab);
  if(fw) draft.widths = fw;
  else if(tab.delims[0]) draft.delimiter = tab.delims[0];   // 複数有効時は先頭を採用
  draft.encoding = resolvedEnc(tab);
  if(rules.length) draft.rules = rules;
  return {draft, useFirst};
}
function openDefDraft(){
  const t = curTab();
  if(!t || t.mode!=='text'){ toast('テキストモードのファイルを開いてから使用してください'); return; }
  const {draft, useFirst} = makeDefDraft(t);
  openSettings();
  $('#defsTa').value = JSON.stringify([draft, ...defs], null, 2);
  $('#defsErr').textContent =
    `「${t.name}」からドラフトを先頭に挿入しました（ヘッダー: ${useFirst?'1行目から取り込み':'列番号プレースホルダ'}／検査ルール: ${draft.rules?draft.rules.length+'件を型推定から提案':'なし'}）。`
    + ' 名前・ヘッダーを整えて「保存して閉じる」で登録されます。';
  $('#defsTa').scrollTop = 0;
}

function openSettings(){
  $('#lsWarn').classList.toggle('hiddenCtl', LS.ok);
  $('#chkContDot').checked = settings.contDot;
  $('#selFont').value = FONTS[settings.font] ? settings.font : 'biz';
  $('#fontCustom').value = settings.fontCustom||'';
  $('#fontCustom').classList.toggle('hiddenCtl', settings.font!=='custom');
  renderDelimList();
  renderDefList();
  $('#defsTa').value = JSON.stringify(defs, null, 2);
  $('#defsErr').textContent='';
  $('#modalBack').classList.add('show');
}

/* --- ヘッダー定義の一覧・削除(4.3) --- */
function defIndexFor(tab){
  /* タブが現在使用している定義のインデックス（なしは -1） */
  if(tab.defSel==='none') return -1;
  if(tab.defSel==='auto') return matchDef(tab.name);
  return typeof tab.defSel==='number' ? tab.defSel : -1;
}
function renderDefList(){
  const box = $('#defList'); box.textContent='';
  if(!defs.length){
    const n = el('span',null,'（なし — 下のJSONを編集するか、定義JSONファイルをドロップで登録できます）');
    n.style.cssText='color:var(--sub);font-size:12px';
    box.appendChild(n);
    return;
  }
  defs.forEach((d,i)=>{
    const chip = el('span','chip');
    const label = el('span',null, (d.name||d.match) + (d.widths?'［固定長］':''));
    label.title = `match: ${d.match}`;
    chip.appendChild(label);
    const x = el('button','x','✕');
    x.title = 'この定義を削除';
    x.onclick = ()=>deleteDef(i);
    chip.appendChild(x);
    box.appendChild(chip);
  });
  if(defs.length>1){
    const all = el('button',null,'すべて削除');
    all.onclick = ()=>deleteDef(-1);
    box.appendChild(all);
  }
}
function deleteDef(i){
  /* i=-1 で全削除。編集モード中のタブが使用している定義は削除不可（列構造が変わるため） */
  const targets = i<0 ? defs.map((_,k)=>k) : [i];
  const locked = tabs.find(t=>t.edit && targets.includes(defIndexFor(t)));
  if(locked){
    toast(`定義を使用中の編集タブ「${locked.name}」があります。編集モードを終了してから削除してください`);
    return;
  }
  const delName = i>=0 ? (defs[i].name||defs[i].match) : '';
  if(i>=0){ if(!confirm(`ヘッダー定義「${delName}」を削除しますか？`)) return; }
  else { if(!confirm(`ヘッダー定義 ${defs.length} 件をすべて削除しますか？`)) return; }
  if(i<0) defs = [];
  else defs.splice(i,1);
  LS.set('ifv_defs', defs);
  /* 開いているタブの手動選択インデックスを補正し、再パースさせる */
  tabs.forEach(t=>{
    if(typeof t.defSel==='number'){
      if(i<0 || t.defSel===i) t.defSel='auto';
      else if(t.defSel>i) t.defSel--;
    }
    t._cache.cellsKey = null;
    if(t.valOn && !valRules(t).length) t.valOn = false;  // 検査ルールが消えたら検査もOFF
  });
  $('#defsTa').value = JSON.stringify(defs, null, 2);
  $('#defsErr').textContent='';
  renderDefList();
  renderAllPanes(true);
  toast(i<0 ? 'ヘッダー定義をすべて削除しました' : `定義「${delName}」を削除しました`);
}
function renderDelimList(){
  const box = $('#delimList'); box.textContent='';
  if(!customDelims.length){
    const n = el('span',null,'（なし — ツールバーの「任意を追加…」から登録できます）');
    n.style.cssText='color:var(--sub);font-size:12px'; box.appendChild(n); return;
  }
  customDelims.forEach((v,i)=>{
    const chip = el('span','chip', `「${v}」`);
    const x = el('button','x','✕'); x.title='登録解除';
    x.onclick = ()=>{
      customDelims.splice(i,1); LS.set('ifv_delims', customDelims);
      /* 使用中のタブからも外して再パース */
      tabs.forEach(t=>{
        const k = t.delims.indexOf(v);
        if(k>=0){ t.delims.splice(k,1); t._cache.cellsKey=null; }
      });
      renderDelimList(); renderAllPanes(true);
    };
    chip.appendChild(x); box.appendChild(chip);
  });
}
function initSettings(){
  const sf = $('#selFont');
  for(const k of Object.keys(FONTS)){ const o=el('option',null,FONTS[k].label); o.value=k; sf.appendChild(o); }
  sf.onchange = ()=>$('#fontCustom').classList.toggle('hiddenCtl', sf.value!=='custom');
  $('#btnModalClose').onclick = ()=>$('#modalBack').classList.remove('show');
  $('#modalBack').onclick = e=>{ if(e.target===$('#modalBack')) $('#modalBack').classList.remove('show'); };
  $('#btnDefsSample').onclick = ()=>{ $('#defsTa').value = JSON.stringify(SAMPLE_DEFS,null,2); };
  $('#btnDefsSave').onclick = ()=>{
    let j;
    try{ j = JSON.parse($('#defsTa').value || '[]'); }
    catch(e){ $('#defsErr').textContent='JSONエラー: '+e.message; return; }
    if(!Array.isArray(j)) j=[j];
    if(j.length && !looksLikeDefs(j)){ $('#defsErr').textContent='各定義に match(文字列) と headers(配列) が必要です。'; return; }
    const changed = JSON.stringify(j) !== JSON.stringify(defs);
    if(changed){
      const locked = tabs.find(t=>t.edit && defIndexFor(t)>=0);
      if(locked){ $('#defsErr').textContent=`定義を使用中の編集タブ「${locked.name}」があります。編集モードを終了してから定義を変更してください。`; return; }
    }
    defs = j; LS.set('ifv_defs', defs);
    /* 手動選択インデックスが新しい定義数を超えたら自動へ戻す */
    tabs.forEach(t=>{ if(typeof t.defSel==='number' && t.defSel>=defs.length) t.defSel='auto'; });
    settings.contDot = $('#chkContDot').checked;
    settings.font = $('#selFont').value;
    settings.fontCustom = $('#fontCustom').value;
    LS.set('ifv_settings', settings);
    applyDisplaySettings();
    $('#modalBack').classList.remove('show');
    tabs.forEach(t=>{ t._cache.cellsKey=null; });
    renderAllPanes(true);
    toast(LS.ok?'保存しました':'このセッション内でのみ有効です（localStorage不可）');
  };
  $('#defsFile').onchange = async e=>{
    const f = e.target.files[0]; if(!f) return;
    try{
      const j = JSON.parse(await f.text());
      if(!looksLikeDefs(j)) throw new Error('定義スキーマに一致しません');
      $('#defsTa').value = JSON.stringify(Array.isArray(j)?j:[j], null, 2);
      $('#defsErr').textContent='読み込みました。「保存して閉じる」で適用します。';
    }catch(err){ $('#defsErr').textContent='読み込み失敗: '+err.message; }
    e.target.value='';
  };
}


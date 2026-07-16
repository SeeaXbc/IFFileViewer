'use strict';
/* =====================================================================
 * IFファイルビューア — 単一HTML・読み取り専用
 * 要件定義書: IFファイルビューア_要件定義書.md
 * 開発: src/ を編集し npm run build で単一HTMLを生成（tools/build.mjs）。型検査: npm run typecheck
 * =================================================================== */

/* ---------- 主要データ構造（JSDoc型。エディタの補完とtsc検査に使用） ----------
 * @typedef {Object} HeaderDef  仮想ヘッダー定義(4.3/4.6/4.7)
 * @property {string}     match      ファイル名ワイルドカード
 * @property {string}     [name]
 * @property {string[][]} headers    ヘッダー行（外=行、内=列）
 * @property {string}     [delimiter]
 * @property {string}     [encoding]
 * @property {string[]}   [details]  列ごとの説明（ツールチップ）
 * @property {number[]}   [widths]   固定長レイアウトのバイト幅(4.6)
 * @property {{col:number,type?:string,required?:boolean,pattern?:string}[]} [rules] 検査ルール(4.7)
 *
 * @typedef {Object} EditState  編集モード状態(9章)
 * @property {string} enc                    編集開始時に固定した文字コード
 * @property {{bytes:Uint8Array,term:Uint8Array,termStr:string}[]} segs 行別の元バイト（未編集行は保存時に無加工コピー）
 * @property {Uint8Array} bom
 * @property {Map<string,{orig:string}>} edits   'li:ci' → 元の値
 * @property {Map<number,boolean>} lineOk        行の可逆性検証キャッシュ
 * @property {Array<Object>} hist  Undo/Redo履歴
 * @property {number} histI
 * @property {boolean} unsaved
 * @property {string} saveName
 *
 * Tab: createTab() が生成。_cache は派生キャッシュ（text/lines/rows/colW/valNG等）
 * ------------------------------------------------------------------- */

/* ---------- 小道具 ---------- */
/** @type {(s:string)=>any} */
const $ = s => document.querySelector(s);
/** @type {(tag:string, cls?:string|null, text?:any)=>any} */
function el(tag, cls, text){ const e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=text; return e; }
function fmtSize(n){ if(n<1024)return n+' B'; if(n<1048576)return (n/1024).toFixed(1)+' KB'; return (n/1048576).toFixed(2)+' MB'; }
let toastTimer=null;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),3000); }

/* localStorage ラッパ（file:// では無効な環境があるため必ず try/catch） */
const LS = {
  ok:(()=>{ try{ localStorage.setItem('__ifv_t','1'); localStorage.removeItem('__ifv_t'); return true; }catch(e){ return false; } })(),
  get(k,d){ if(!this.ok) return d; try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ if(!this.ok) return; try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
};

/* ---------- 状態 ---------- */
const APP_VERSION = '1.7.0';     // ヘルプに表示。更新履歴は要件定義書末尾を参照
const CHUNK_TEXT = 500;          // テキスト行の追加描画単位
const CHUNK_BIN  = 512;          // バイナリ行(16B)の追加描画単位
const BIN_STEP   = 256*1024;     // バイナリ初期表示・追加読み込み単位(5.5)
const BIN_JUMP_CONFIRM = 2*1024*1024; // これを超える表示拡張は確認する
const MAX_COLW   = 400;          // 列幅の上限(ch) 異常データ対策
const PALETTE = ['#ffe066','#a5d8ff','#b2f2bb','#ffc9c9','#e599f7','#ffd8a8','#99e9f2','#d8f5a2'];

const FONTS = {
  biz:      {label:'BIZ UDゴシック（既定・0/O判別しやすい）', css:'"BIZ UDGothic","BIZ UDゴシック","MS Gothic","ＭＳ ゴシック",monospace'},
  msgothic: {label:'MS ゴシック', css:'"MS Gothic","ＭＳ ゴシック",monospace'},
  msmincho: {label:'MS 明朝', css:'"MS Mincho","ＭＳ 明朝",monospace'},
  custom:   {label:'カスタム…', css:''}
};
const ZOOMS = [50,60,70,80,90,100,110,125,150,175,200,250,300];
const DELIM_PRESETS = [[',','カンマ ,'],['\t','タブ'],[';','セミコロン ;'],['|','パイプ |'],[' ','スペース']];
/* 一般的な制御コード：マーク候補としてプリセット（初期OFF）(5.4) */
const CTRL_PRESETS = [
  ['00','NUL'],['01','SOH'],['02','STX'],['03','ETX'],['04','EOT'],['05','ENQ'],['06','ACK'],
  ['09','TAB'],['0A','LF'],['0D','CR'],['0D 0A','CRLF'],['10','DLE'],['15','NAK'],['16','SYN'],
  ['1B','ESC'],['1C','FS'],['1D','GS'],['1E','RS'],['1F','US']
];

let defs = LS.get('ifv_defs', []);            // 仮想ヘッダー定義(4.3)
let customDelims = LS.get('ifv_delims', []);  // 登録済みの任意区切り文字
let settings = Object.assign({contDot:true, zoom:100, font:'biz', fontCustom:'', delimGap:0, showWs:false}, LS.get('ifv_settings', {}));
const tabs = [];
/* マルチペイン(4.8)：2ペインまで。panes[p].cur は tabs のインデックス（-1=空） */
const panes = [{cur:-1},{cur:-1}];
let activePane = 0;
let layout = 'single';        // 'single' | 'cols'(左右) | 'rows'(上下)
let syncScroll = false;       // 分割中のスクロール同期（セッション内のみ・保存しない）
let mkSeq = 0;
const SEARCH = {t:'s'}, SEARCH_CUR = {t:'sc'};  // ハイライト用番兵

function curTab(){ return tabs[panes[activePane].cur] || null; }
function paneTab(p){ return tabs[panes[p].cur] || null; }
let _paneEls = null;
function paneContent(p){
  if(!_paneEls) _paneEls = [...document.querySelectorAll('#panes .pane > .content')];
  return _paneEls[p];
}
function contentOf(tab){ return paneContent(tab.pane); }
function paneLabel(p){ return layout==='rows' ? (p===0?'上':'下') : (p===0?'左':'右'); }

/* ---------- 文字コード ---------- */
const ENCODINGS = [
  ['shift_jis','Shift-JIS (CP932)'],
  ['utf-8','UTF-8'],
  ['utf-16le','UTF-16LE'],
  ['utf-16be','UTF-16BE'],
  ['euc-jp','EUC-JP'],
  ['windows-1252','Latin-1 (CP1252)'],
  ['ascii','ASCII']
];
function encLabel(v){ const e=ENCODINGS.find(x=>x[0]===v); return e?e[1]:v; }

function isValidUtf8(b, limit){
  const n = Math.min(b.length, limit); let multi=false;
  for(let i=0;i<n;){
    const c=b[i];
    if(c<0x80){ i++; continue; }
    let len; if((c&0xE0)===0xC0)len=2; else if((c&0xF0)===0xE0)len=3; else if((c&0xF8)===0xF0)len=4; else return null;
    if(i+len>n){ break; } // 末尾切れは許容
    for(let j=1;j<len;j++) if((b[i+j]&0xC0)!==0x80) return null;
    multi=true; i+=len;
  }
  return {multi};
}
/* BOM判定＋簡易推定(6章) */
function detectEncoding(b){
  if(b.length>=3 && b[0]===0xEF&&b[1]===0xBB&&b[2]===0xBF) return 'utf-8';
  if(b.length>=2 && b[0]===0xFF&&b[1]===0xFE) return 'utf-16le';
  if(b.length>=2 && b[0]===0xFE&&b[1]===0xFF) return 'utf-16be';
  const r = isValidUtf8(b, 65536);
  if(r) return 'utf-8';           // 純ASCII含む
  return 'shift_jis';             // 日本語業務ファイル前提の既定
}
function decodeText(bytes, enc){
  if(enc==='ascii'){
    let s=''; for(let i=0;i<bytes.length;i++){ const b=bytes[i];
      s += (b===0x0A||b===0x0D||b===0x09||(b>=0x20&&b<=0x7E)) ? String.fromCharCode(b) : '.'; }
    return s;
  }
  try{ return new TextDecoder(enc).decode(bytes); }
  catch(e){ return new TextDecoder('utf-8').decode(bytes); }
}
/* 初期モードの簡易判定(3章) */
function detectMode(b){
  if(b.length>=2 && ((b[0]===0xFF&&b[1]===0xFE)||(b[0]===0xFE&&b[1]===0xFF))) return 'text'; // UTF-16 BOM
  const n=Math.min(b.length,4096); if(n===0) return 'text';
  let bad=0;
  for(let i=0;i<n;i++){ const c=b[i];
    if(c===0) { bad+=4; continue; }
    if(c<0x20 && c!==9 && c!==10 && c!==13 && c!==27) bad++;
  }
  return (bad/n > 0.02) ? 'bin' : 'text';
}

/* ---------- 表示幅（MS Gothic 前提: 半角1/全角2） ---------- */
function chW(cp){
  if(cp<0x2000) return 1;                       // Latin/ギリシャ/キリル等
  if(cp>=0xFF61&&cp<=0xFF9F) return 1;          // 半角カナ
  if(cp>=0xFFE8&&cp<=0xFFEE) return 1;
  if(cp>=0x2000&&cp<0x2E80&&!(cp>=0x2500&&cp<0x2600)) return 1; // 記号類は概ね半角扱い
  return 2;
}
function strW(s){ let w=0; for(const c of s) w+=chW(c.codePointAt(0)); return w; }


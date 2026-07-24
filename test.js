/**
 * calendar.html のロジックを検証する。
 *
 *   node test.js
 *
 * コピーではなく index.html / calendar.html の中身をそのまま読み込んで動かす。
 * （コピーを置くと本体と少しずつズレて、テストが通るのに壊れている状態になるため）
 *
 * ブラウザが無いので、読み込みに必要な最低限の DOM だけ偽物を用意している。
 * 画面まわりは検証しない。日付・重なり・変換といった、目で見て確かめにくい部分が対象。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

/* ---------- 本体を読み込む ---------- */
const FILE = ['index.html', 'calendar.html']
  .map(f => path.join(__dirname, f))
  .find(fs.existsSync);

if(!FILE){
  console.error('index.html も calendar.html も見つからない。リポジトリ直下で実行してね。');
  process.exit(1);
}

const html = fs.readFileSync(FILE, 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if(!m){ console.error('<script> が見つからない'); process.exit(1); }

// 起動処理は画面が無いと動かないので外す。関数の定義だけ読み込みたい
let code = m[1].replace(/\(async function init\(\)\{[\s\S]*$/, '');

// 中の関数を取り出すための受け渡し口
code += `
;globalThis.__T = {
  layoutBand, layoutDay, toGoogle, fromGoogle, itemsOn, barItems, gridItems,
  endOf, isMulti, fmt, parse, addDays, diffDays, toMin, migrate,
  tasks, openTasks, isPicked, pickedToday, today,
  catOf, dueLabel, CONFIG, NO_CAT, catTint, catInk,
  narrowScreen, DAY_HOUR_PX, gridItems,
  setCats: list => { cats = list; },
  setItems: list => { items = list; },
  DAY_START, DAY_END, HOUR_PX, PERIODS
};`;

/* ---------- 最低限の偽DOM ---------- */
const stubEl = () => new Proxy({}, {
  get(t, k){
    if(k === 'addEventListener' || k === 'appendChild' || k === 'setAttribute') return () => {};
    if(k === 'querySelectorAll') return () => [];
    if(k === 'closest') return () => null;
    if(k === 'classList') return { toggle(){}, add(){}, remove(){} };
    if(k === 'dataset') return {};
    if(k === 'style') return {};
    if(k in t) return t[k];
    return '';
  },
  set(t, k, v){ t[k] = v; return true; }
});

const store = new Map();
let CALM = false;                       // 動きを控える設定
const sandbox = {
  matchMedia: q => ({ matches: CALM && q.includes('reduced-motion'),
                      addEventListener(){}, addListener(){} }),
  addEventListener: () => {},
  removeEventListener: () => {},
  console,
  document: {
    getElementById: stubEl,
    querySelector: stubEl,
    querySelectorAll: () => [],
    createElement: stubEl,
    head: stubEl(),
    body: stubEl()
  },
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v)
  },
  Intl, Date, Math, JSON, URLSearchParams, Promise, RegExp, Object, Array, String, Number,
  setTimeout, clearTimeout,
  fetch: () => { throw new Error('テスト中に通信しようとした'); }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

try{
  vm.runInNewContext(code, sandbox);
}catch(err){
  console.error('読み込みに失敗した:', err.message);
  process.exit(1);
}

const T = sandbox.__T;

/* ---------- ちいさなテスト道具 ---------- */
let pass = 0, fail = 0;
const results = [];

function test(name, fn){
  try{
    fn();
    pass++; results.push(['OK ', name, null]);
  }catch(err){
    fail++; results.push(['NG ', name, err.message]);
  }
}
function eq(actual, expected, what){
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if(a !== b) throw new Error(`${what || ''} 期待 ${b} / 実際 ${a}`);
}
function ok(cond, msg){ if(!cond) throw new Error(msg); }

/* ==========================================================
   0. 画面の要素がそろっているか
   ----------------------------------------------------------
   getElementById が1つでも null を返すと、その行で止まって
   以降の処理が丸ごと動かなくなる。見た目には「機能が無い」ように見えるだけで
   エラーも出ないので、機械的に照合しておく
   ========================================================== */
test('画面：JSが参照しているIDがHTMLに全部ある', () => {
  const body = html.slice(0, html.indexOf('<script>'));
  const used = [...new Set([...m[1].matchAll(/getElementById\('([^']+)'\)/g)].map(x => x[1]))];
  const have = new Set([...body.matchAll(/id="([^"]+)"/g)].map(x => x[1]));
  const missing = used.filter(u => !have.has(u));
  eq(missing, [], 'HTMLに無いIDを参照している');
  ok(used.length > 20, '照合できた数が少なすぎる（正規表現が壊れている可能性）');
});

/* ==========================================================
   0-2. 明るい版／暗い版
   ========================================================== */
function rgbOf(str){
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(str);
  ok(m, `色の形式が違う: ${str}`);
  return [+m[1], +m[2], +m[3]];
}
function contrast(a, b){
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; };
                     return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]); };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('テーマ：色がすべて変数になっている（直書きが残っていない）', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const after = style.slice(style.indexOf('*{box-sizing'));   // :root の定義より後ろ
  const raw = [...new Set([...after.matchAll(/#[0-9A-Fa-f]{3,6}\b/g)].map(x => x[0]))];
  eq(raw, [], '変数の外に色が直書きされている（片方の版だけ壊れる）');
});

test('テーマ：一本で、OSの設定に振り回されない', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
                    .replace(/\/\*[\s\S]*?\*\//g, '');     // コメントは除く
  ok(!/prefers-color-scheme/.test(style),
     'OSの明暗設定で切り替わる指定が残っている（明るい版を足すときはこのテストも直す）');
  const root = style.slice(style.indexOf(':root{'), style.indexOf('}', style.indexOf(':root{')));
  for(const v of ['--paper','--card','--ink','--rule','--accent','--done','--on-fill']){
    ok(root.includes(v + ':'), `${v} が定義されていない`);
  }
});

test('テーマ：種類の色が、地の上で読める濃さになる', () => {
  for(const c of T.CONFIG.categories){
    const d = contrast(rgbOf(T.catTint(c)), rgbOf(T.catInk(c)));
    ok(d >= 4.5, `${c.name} が読みにくい（コントラスト比 ${d.toFixed(1)}）`);
  }
});

test('テーマ：種類の背景が地から浮きすぎない', () => {
  // 明るい地なので、種類の背景もごく薄くする。
  // 濃く塗ると予定が並んだときに画面が騒がしくなる
  for(const c of T.CONFIG.categories){
    const [r, g, b] = rgbOf(T.catTint(c));
    ok(r + g + b > 600, `${c.name} の背景が濃すぎる（明るい地に合わない）`);
  }
});

test('表示：0時から24時まで出る', () => {
  eq(T.DAY_START, 0, '開始時刻');
  eq(T.DAY_END, 24, '終了時刻');
});

test('見やすさ：小さすぎる文字を使っていない', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
                    .replace(/\/\*[\s\S]*?\*\//g, '');
  const small = [...new Set([...style.matchAll(/font-size:\s*([\d.]+)px/g)]
    .map(x => parseFloat(x[1])).filter(v => v < 12))];
  eq(small.sort(), [], '12px未満の文字がある。読みやすさを優先する方針に反する');
});

test('見やすさ：本文と地の明暗差が十分ある', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const root = style.slice(style.indexOf(':root{'), style.indexOf('}', style.indexOf(':root{')));
  const get = v => /#([0-9A-Fa-f]{6})/.exec(root.slice(root.indexOf(v + ':')))[1];
  const rgb = h => [0,2,4].map(i => parseInt(h.slice(i,i+2),16));
  const lum = c => { const f = v => { v/=255; return v<=0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4; };
                     return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]); };
  const [x, y] = [lum(rgb(get('--ink'))), lum(rgb(get('--paper')))].sort((a,b) => b-a);
  const ratio = (x + 0.05) / (y + 0.05);
  ok(ratio >= 12, `本文と地のコントラスト比が低い（${ratio.toFixed(1)}）`);
});

test('デザイン：角に丸みを持たせる（硬い印象を避ける）', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  const root = style.slice(style.indexOf(':root{'), style.indexOf('}', style.indexOf(':root{')));
  const r = parseFloat(/--radius:\s*([\d.]+)px/.exec(root)[1]);
  ok(r >= 10, `カードの丸みが小さい（${r}px）。柔らかい印象にする方針に反する`);
  ok(/--radius-pill:/.test(root), '丸ボタン用の指定が無い');
});

test('デザイン：タスクはカレンダー側に出さない', () => {
  const body = html.slice(0, html.indexOf('<script>'));
  ok(!/id="rail/.test(body), 'カレンダー画面にタスク欄が残っている');
  const js = m[1];
  ok(!js.includes('renderRail'), 'タスク欄の描画処理が残っている');
  // 今日ビューの中の「今日やる」は残す（ここで管理するため）
  const fn = js.slice(js.indexOf('function renderDay'), js.indexOf('function renderWeek'));
  ok(fn.includes('pickedToday'), '今日ビューから「今日やる」が消えている');
});

test('見やすさ：日/週/月は上段の右端に置く', () => {
  const body = html.slice(0, html.indexOf('<script>'));
  const rows = [...body.matchAll(/<div class="mrow[^"]*"[^>]*>([\s\S]*?)<\/header>|<div class="mrow[^"]*"[^>]*>([\s\S]*?)(?=<div class="mrow)/g)];
  const first = body.slice(body.indexOf('<div class="mrow'), body.indexOf('<div class="mrow sub'));
  ok(first.includes('id="viewtabs"'), '日/週/月が上段に無い');
  ok(first.indexOf('id="viewtabs"') > first.indexOf('class="spacer"'),
     '日/週/月が右端に寄っていない');
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  ok(/\.viewtabs\{[^}]*margin-left:auto/.test(style), '右端に固定する指定が無い');
});

test('見やすさ：今日ビューは表ではなくリストで組む', () => {
  const js = m[1];
  const fn = js.slice(js.indexOf('function renderDay'), js.indexOf('function renderWeek'));
  ok(fn.includes('dlist') && fn.includes('drow'), 'リストで組んでいない');
  ok(!fn.includes('DAY_HOUR_PX'), '時間軸の表が残っている（読むものを増やす）');
});

test('認証：トークンを保存して使い回す（毎回聞きに行かない）', () => {
  const js = m[1];
  ok(/TOKEN_KEY/.test(js), 'トークンの保存先が無い');
  ok(/loadToken|saveToken/.test(js), 'トークンを保存する処理が無い');
  const fn = js.slice(js.indexOf('async connect(interactive)'));
  ok(/if\(!interactive && await this\.loadToken\(\)\) return;/.test(fn.slice(0, 600)),
     '保存済みトークンがあってもGoogleへ聞きに行ってしまう');
});

test('認証：期限切れの手前で取り直す', () => {
  const js = m[1];
  const fn = js.slice(js.indexOf('async loadToken'), js.indexOf('async saveToken'));
  ok(/exp\s*-\s*\d+/.test(fn), '切れる直前を期限切れ扱いにしていない（操作中に切れる）');
});

test('認証：解除したら保存してある認証も消す', () => {
  const js = m[1];
  ok(/clearToken\(\)/.test(js), '認証を消す処理が無い');
});

/* ==========================================================
   0-3. 手触り
   ========================================================== */
test('手触り：動きを控える設定に対応している', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  ok(/prefers-reduced-motion/.test(style), '動きを止める指定が無い');
  ok(/calmly\s*\(\s*\)/.test(m[1]), 'JS側で動きを控える判定をしていない');
});

test('手触り：押せる部品に当たり判定の拡張がある', () => {
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  for(const cls of ['tcheck', 'tpick']){
    ok(new RegExp(`\\.${cls}[^{]*::after`).test(style) ||
       new RegExp(`::after[^}]*}`).test(style) && style.includes(`.${cls}::after`),
       `.${cls} の当たり判定が広がっていない`);
  }
});

test('手触り：現在時刻へのスクロールが週ビューだけで働く', () => {
  const js = m[1];
  const fn = js.slice(js.indexOf('function scrollToNow'));
  ok(/state\.view\s*!==\s*'week'/.test(fn.slice(0, 400)), '週ビュー以外でも動いてしまう');
  ok(/nowline/.test(fn.slice(0, 500)), '今日が無い週で何もしない判定が無い');
});

/* ==========================================================
   0-4. PCとスマホのすみわけ
   ========================================================== */
test('すみわけ：狭い画面では今日ビュー、広い画面では週ビューが既定', () => {
  const js = m[1];
  ok(/narrowScreen\s*\(\s*\)\s*\?\s*'day'\s*:\s*'week'/.test(js),
     '画面幅で初期表示を選んでいない');
  ok(/max-width/.test(js), '画面幅ではなく端末の種類で判定している可能性');
});

test('すみわけ：3つの表示がすべて存在する', () => {
  const js = m[1];
  for(const f of ['renderDay', 'renderWeek', 'renderMonth']){
    ok(js.includes('function ' + f), `${f} が無い`);
  }
  const body = html.slice(0, html.indexOf('<script>'));
  for(const id of ['tabDay', 'tabWeek', 'tabMonth']){
    ok(body.includes(`id="${id}"`), `${id} のボタンが無い`);
  }
});

test('すみわけ：今日ビューは1画面で読み切れる量に絞る', () => {
  const js = m[1];
  const fn = js.slice(js.indexOf('function renderDay'), js.indexOf('function renderWeek'));
  // 次の予定・終日・このあと・今日やる の4つだけ
  const secs = [...fn.matchAll(/dsec">([^<]+)</g)].map(x => x[1]);
  ok(secs.length <= 3, `見出しが多すぎる（${secs.join(' / ')}）`);
  ok(fn.includes('つぎ'), '「つぎ」が無い');
});

test('すみわけ：今日ビューと週ビューが同じ振り分けを使う', () => {
  T.setItems([
    {id:'c1', kind:'class', title:'授業', weekday:1, start:'09:00', end:'10:30', termEnd:null},
    {id:'t1', kind:'task',  title:'タスク', date:'2026-07-20', endDate:'2026-07-20', done:false},
  ]);
  const ids = T.gridItems('2026-07-20').map(x => x.id);
  eq(ids, ['c1'], '今日ビューにタスクが出る／授業が出ない');
});

/* ==========================================================
   1. 帯（日をまたぐ予定）の段組み
   ========================================================== */
const week = n => {
  const base = T.parse('2026-07-20');           // 月曜
  return Array.from({length:7}, (_,i) => T.fmt(T.addDays(base, i + n*7)));
};

test('帯：重なる予定が同じ段に来ない', () => {
  const cols = week(0);
  const list = [
    {id:'a', kind:'event', title:'合宿',   date:'2026-07-22', endDate:'2026-07-24'},
    {id:'b', kind:'event', title:'健診',   date:'2026-07-22', endDate:'2026-07-22'},
    {id:'c', kind:'event', title:'提出',   date:'2026-07-23', endDate:'2026-07-23'},
  ];
  const { placed } = T.layoutBand(list, cols);
  for(const p of placed) for(const q of placed){
    if(p === q || p.lane !== q.lane) continue;
    ok(p.i1 < q.i0 || q.i1 < p.i0, `${p.it.title} と ${q.it.title} が同じ段で重なった`);
  }
});

test('帯：週をはみ出すと端の印が立つ', () => {
  const cols = week(0);                         // 07-20 〜 07-26
  const { placed } = T.layoutBand([
    {id:'a', kind:'event', title:'帰省', date:'2026-07-18', endDate:'2026-07-21'},
    {id:'b', kind:'event', title:'旅行', date:'2026-07-25', endDate:'2026-08-02'},
  ], cols);
  const home = placed.find(p => p.it.title === '帰省');
  const trip = placed.find(p => p.it.title === '旅行');
  ok(home.cutL && !home.cutR, '左にはみ出す判定がおかしい');
  ok(trip.cutR && !trip.cutL, '右にはみ出す判定がおかしい');
  eq([home.i0, home.i1], [0, 1], '帰省の位置');
  eq([trip.i0, trip.i1], [5, 6], '旅行の位置');
});

/* ==========================================================
   2. 時間軸の左右振り分け
   ========================================================== */
test('時間軸：重ならない予定は幅いっぱい', () => {
  const r = T.layoutDay([
    {id:'a', kind:'event', title:'1限', start:'09:00', end:'10:30'},
    {id:'b', kind:'event', title:'2限', start:'10:40', end:'12:10'},
  ]);
  for(const ev of r) eq(ev.cols, 1, ev.it.title);
});

test('時間軸：重なる予定が同じ列に来ない', () => {
  const r = T.layoutDay([
    {id:'a', kind:'event', title:'当番', start:'09:00', end:'17:00'},
    {id:'b', kind:'event', title:'面談', start:'10:00', end:'11:00'},
    {id:'c', kind:'event', title:'講義', start:'11:00', end:'12:00'},
  ]);
  for(const p of r) for(const q of r){
    if(p === q || p.col !== q.col) continue;
    ok(p.e <= q.s || q.e <= p.s, `${p.it.title} と ${q.it.title} が同じ列で重なった`);
  }
  eq(r.find(x => x.it.title === '当番').cols, 2, '列数');
});

test('時間軸：終了時刻が無くても潰れない', () => {
  const r = T.layoutDay([{id:'a', kind:'event', title:'集合', start:'08:00', end:''}]);
  ok(r[0].e > r[0].s, '高さが0になっている');
});

/* ==========================================================
   3. Googleカレンダーとの相互変換（往復して元に戻るか）
   ========================================================== */
const ROUND = [
  ['授業（期限なし）',   {kind:'class', title:'授業A', memo:'教室', weekday:1, start:'10:40', end:'12:10', termEnd:null}],
  ['授業（期末あり）',   {kind:'class', title:'授業B', memo:'',     weekday:3, start:'09:00', end:'10:30', termEnd:'2026-09-30'}],
  ['予定（時刻あり）',   {kind:'event', title:'予定A', memo:'',     date:'2026-07-24', endDate:'2026-07-24', start:'17:00', end:'21:00'}],
  ['予定（日またぎ）',   {kind:'event', title:'予定B', memo:'',     date:'2026-07-28', endDate:'2026-07-30', start:'09:00', end:'15:00'}],
  ['予定（終日・複数日）',{kind:'event', title:'予定C', memo:'',    date:'2026-08-01', endDate:'2026-08-05', start:'', end:''}],
  ['タスク（期限時刻あり）',{kind:'task', title:'タスクA', memo:'メモ', date:'2026-07-26', endDate:'2026-07-26', start:'23:59', end:'', done:false}],
  ['タスク（期限時刻なし）',{kind:'task', title:'タスクB', memo:'',     date:'2026-08-10', endDate:'2026-08-10', start:'', end:'', done:false}],
  ['タスク（完了済み）',    {kind:'task', title:'タスクC', memo:'',     date:'2026-07-01', endDate:'2026-07-01', start:'', end:'', done:true}],
  ['タスク（今日やる）',    {kind:'task', title:'タスクD', memo:'',     date:'2026-07-30', endDate:'2026-07-30', start:'', end:'', done:false, today:'2026-07-23'}],
  ['カテゴリつきの予定',    {kind:'event', title:'バイト', memo:'',     date:'2026-07-24', endDate:'2026-07-24', start:'17:00', end:'21:00', cat:'baito'}],
];
const KEYS = ['kind','title','memo','weekday','start','end','date','endDate','termEnd','done','today','cat'];

for(const [name, it] of ROUND){
  test(`変換：${name} が往復して元に戻る`, () => {
    const ev = T.toGoogle({ id:'x', ...it });
    ev.id = 'x';
    const back = T.fromGoogle(ev);
    ok(back, '逆変換がnullを返した');
    for(const k of KEYS){
      if(it[k] === undefined) continue;
      eq(back[k] ?? null, it[k] ?? null, `${name} の ${k}`);
    }
  });
}

test('変換：キャンセル済みの予定は取り込まない', () => {
  eq(T.fromGoogle({ id:'x', status:'cancelled', start:{date:'2026-07-01'}, end:{date:'2026-07-02'} }), null);
});

test('変換：毎週以外のくり返しは取り込まない', () => {
  eq(T.fromGoogle({
    id:'x', summary:'毎月', recurrence:['RRULE:FREQ=MONTHLY'],
    start:{dateTime:'2026-07-01T09:00:00+09:00'}, end:{dateTime:'2026-07-01T10:00:00+09:00'}
  }), null);
});

/* ==========================================================
   4. その日に何を出すか
   ========================================================== */
test('表示：授業は同じ曜日にだけ出る', () => {
  T.setItems([{id:'a', kind:'class', title:'授業', weekday:1, start:'09:00', end:'10:30', termEnd:null}]);
  eq(T.itemsOn('2026-07-20').length, 1, '月曜');   // 月曜
  eq(T.itemsOn('2026-07-21').length, 0, '火曜');   // 火曜
});

test('表示：授業は termEnd を過ぎたら出ない', () => {
  T.setItems([{id:'a', kind:'class', title:'授業', weekday:1, start:'09:00', end:'10:30', termEnd:'2026-07-20'}]);
  eq(T.itemsOn('2026-07-20').length, 1, '期限当日');
  eq(T.itemsOn('2026-07-27').length, 0, '期限翌週');
});

test('表示：日をまたぐ予定は途中の日にも出る', () => {
  T.setItems([{id:'a', kind:'event', title:'合宿', date:'2026-07-22', endDate:'2026-07-24', start:'', end:''}]);
  for(const d of ['2026-07-22','2026-07-23','2026-07-24']) eq(T.itemsOn(d).length, 1, d);
  eq(T.itemsOn('2026-07-25').length, 0, '範囲外');
});

/* ==========================================================
   5. 帯と時間軸で二重に出ていないか（AGENTS.md の約束）
   ========================================================== */
test('週ビュー：授業が時間軸に出る', () => {
  T.setItems([
    {id:'c1', kind:'class', title:'授業', weekday:1, start:'09:00', end:'10:30', termEnd:null},
  ]);
  const ids = T.gridItems('2026-07-20').map(x => x.id);   // 月曜
  ok(ids.includes('c1'), '授業が時間軸から消えている');
  eq(T.gridItems('2026-07-21').length, 0, '別の曜日に出ている');
});

test('週ビュー：時間軸に出るものと帯に出るものが排他', () => {
  const cols = week(0);
  const shown = [
    {id:'a', kind:'class', title:'授業',   weekday:1, start:'09:00', end:'10:30', termEnd:null},
    {id:'b', kind:'event', title:'バイト', date:'2026-07-21', endDate:'2026-07-21', start:'17:00', end:'21:00'},
    {id:'c', kind:'event', title:'合宿',   date:'2026-07-22', endDate:'2026-07-24', start:'09:00', end:'15:00'},
    {id:'d', kind:'event', title:'終日',   date:'2026-07-23', endDate:'2026-07-23', start:'', end:''},
  ];
  T.setItems(shown);

  const inBand = new Set(T.barItems(cols).map(x => x.id));
  const inGrid = new Set();
  for(const ds of cols) for(const it of T.gridItems(ds)) inGrid.add(it.id);

  for(const id of inBand) ok(!inGrid.has(id), `${id} が帯と時間軸の両方に出ている`);
  // 例外なく、全部どちらかに出ていること（授業も含めて確認する）
  for(const it of shown){
    ok(inBand.has(it.id) || inGrid.has(it.id), `${it.title} がどこにも出ていない`);
  }
});

/* ==========================================================
   5-2. タスクはカレンダーに出さない（分離の約束）
   ========================================================== */
test('分離：タスクはカレンダーの描画対象に入らない', () => {
  const cols = week(0);
  T.setItems([
    {id:'t1', kind:'task',  title:'タスク', date:'2026-07-22', endDate:'2026-07-22', start:'23:59', end:'', done:false},
    {id:'e1', kind:'event', title:'予定',   date:'2026-07-22', endDate:'2026-07-22', start:'10:00', end:'11:00'},
  ]);
  const onDay = T.itemsOn('2026-07-22').map(x => x.id);
  ok(!onDay.includes('t1'), 'タスクが itemsOn に出ている');
  ok(onDay.includes('e1'), '予定が itemsOn に出ていない');
  ok(!T.barItems(cols).some(x => x.id === 't1'), 'タスクが帯に出ている');
  ok(!T.gridItems('2026-07-22').some(x => x.id === 't1'), 'タスクが時間軸に出ている');
});

test('タスク：未完了だけが期限順に並ぶ', () => {
  T.setItems([
    {id:'a', kind:'task', title:'あと',  date:'2026-08-01', done:false},
    {id:'b', kind:'task', title:'さき',  date:'2026-07-25', done:false},
    {id:'c', kind:'task', title:'済み',  date:'2026-07-20', done:true},
    {id:'d', kind:'event', title:'予定', date:'2026-07-22', endDate:'2026-07-22', start:'10:00', end:'11:00'},
  ]);
  eq(T.tasks().length, 3, 'タスクの総数');
  eq(T.openTasks().map(x => x.id), ['b','a'], '未完了が期限順');
});

/* ==========================================================
   5-3. 「今日やる」
   ========================================================== */
test('今日やる：今日の日付のものだけが選択中になる', () => {
  const t  = T.today();
  const y  = T.fmt(T.addDays(T.parse(t), -1));
  T.setItems([
    {id:'a', kind:'task', title:'今日選んだ',   date:'2026-12-01', done:false, today:t},
    {id:'b', kind:'task', title:'昨日選んだ',   date:'2026-12-01', done:false, today:y},
    {id:'c', kind:'task', title:'選んでない',   date:'2026-12-01', done:false, today:''},
  ]);
  eq(T.pickedToday().map(x => x.id), ['a'], '選択中のもの');
});

test('今日やる：日付が変われば自動で外れる（書き込み不要）', () => {
  const y = T.fmt(T.addDays(T.parse(T.today()), -1));
  const it = {id:'a', kind:'task', title:'昨日の選択', date:'2026-12-01', done:false, today:y};
  ok(!T.isPicked(it), '昨日の選択が残っている');
});

test('今日やる：完了したものは選択中に残らない', () => {
  const t = T.today();
  const it = {id:'a', kind:'task', title:'済み', date:'2026-12-01', done:true, today:t};
  ok(!T.isPicked(it), '完了済みなのに選択中になっている');
});

test('今日やる：予定や授業は対象外', () => {
  const t = T.today();
  ok(!T.isPicked({id:'e', kind:'event', title:'予定', date:'2026-12-01', today:t}), '予定が選択中になっている');
  ok(!T.isPicked({id:'c', kind:'class', title:'授業', weekday:1, today:t}), '授業が選択中になっている');
});

/* ==========================================================
   5-4. カテゴリと期限の表し方
   ========================================================== */
test('カテゴリ：idから定義を引ける／未知のidは未分類に落ちる', () => {
  const first = T.CONFIG.categories[0];
  eq(T.catOf({cat:first.id}).name, first.name, '定義が引けない');
  eq(T.catOf({cat:'zzz'}).id, '', '未知のidが未分類にならない');
  eq(T.catOf({}).id, '', '未設定が未分類にならない');
});

// 色の見た目の近さ（redmean近似）。RGBの単純な差より人の感覚に近い
function colorDist(a, b){
  const p = h => { const n = parseInt(h.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255]; };
  const [r1,g1,b1] = p(a), [r2,g2,b2] = p(b);
  const rm = (r1+r2)/2;
  return Math.round(Math.sqrt(
    (2+rm/256)*(r1-r2)**2 + 4*(g1-g2)**2 + (2+(255-rm)/256)*(b1-b2)**2));
}
const MIN_DIST = 115;   // これを下回ると見分けがつきにくい

test('カテゴリ：役割が決まっている色と混同しない', () => {
  // 赤（--accent）は「いま・今日・選択中」、緑（--done）は「完了」に予約してある。
  // 種類の色をここに近づけると、何を表す色か判別できなくなる
  const reserved = { '「いま」の赤': '#C4303A', '「完了」の緑': '#3EBFA0' };
  for(const c of T.CONFIG.categories){
    for(const [name, hex] of Object.entries(reserved)){
      const d = colorDist(c.color, hex);
      ok(d >= MIN_DIST, `${c.name}(${c.color}) が ${name} に近すぎる（距離 ${d}）`);
    }
  }
});

test('カテゴリ：idが重複していない', () => {
  const ids = T.CONFIG.categories.map(c => c.id);
  eq(ids.length, new Set(ids).size, 'idが重複している');
  ok(!ids.includes(''), '空のidが混ざっている（未分類と衝突する）');
});

test('期限の表し方：D-n ではなく普通の日本語で出る', () => {
  const strip = h => h.replace(/<[^>]*>/g, '');
  eq(strip(T.dueLabel(0, false)),  '今日');
  eq(strip(T.dueLabel(1, false)),  '明日');
  eq(strip(T.dueLabel(5, false)),  'あと5日');
  eq(strip(T.dueLabel(-2, false)), '2日すぎ');
  eq(strip(T.dueLabel(3, true)),   '済');
  ok(!strip(T.dueLabel(5, false)).includes('D-'), 'D-表記が残っている');
});

test('カテゴリ：名前や色を変えても、登録済みの予定は付け替え不要', () => {
  const before = T.CONFIG.categories[0];
  T.setItems([{id:'a', kind:'event', title:'予定', date:'2026-07-24', cat:before.id}]);

  // 同じidのまま名前と色だけ変える
  T.setCats([{ id:before.id, name:'新しい名前', color:'#123456' }]);
  eq(T.catOf({cat:before.id}).name,  '新しい名前', '名前が反映されない');
  eq(T.catOf({cat:before.id}).color, '#123456',   '色が反映されない');

  // 種類ごと消したら未分類に落ちる（予定は消えない）
  T.setCats([]);
  eq(T.catOf({cat:before.id}).id, '', '消したあと未分類にならない');

  T.setCats(T.CONFIG.categories.map(c => ({...c})));   // 後続のテストのため戻す
});

test('緊急度：期限切れでも取り消し線の対象にしない', () => {
  const strip = h => h.replace(/<[^>]*>/g, '');
  // 取り消し線は「完了」だけの意味。期限切れは未完了なので混同させない
  eq(strip(T.dueLabel(-3, false)), '3日すぎ', '期限切れの文言');
  eq(strip(T.dueLabel(-3, true)),  '済',     '完了の文言');
});

/* ==========================================================
   6. 古いデータの取り込み
   ========================================================== */
test('移行：時限番号しか無い授業が時刻に変換される', () => {
  const { out, changed } = T.migrate([{id:'a', kind:'class', title:'授業', weekday:1, period:2, termEnd:null}]);
  ok(changed, '変換されなかった');
  eq(out[0].start, T.PERIODS[1].s, '開始時刻');
  eq(out[0].end,   T.PERIODS[1].e, '終了時刻');
});

test('移行：締切(due)がタスク(task)に変換される', () => {
  const { out, changed } = T.migrate([
    {id:'a', kind:'due', title:'旧締切', date:'2026-07-26', endDate:'2026-07-26', start:'23:59', end:''}
  ]);
  ok(changed, '変換されなかった');
  eq(out[0].kind, 'task', '種別');
  eq(out[0].done, false, '完了状態の初期値');
  eq(out[0].start, '23:59', '期限時刻が保たれていない');
});

test('移行：Google側の旧 due も task として読める', () => {
  const back = T.fromGoogle({
    id:'x', summary:'旧締切',
    start:{date:'2026-07-26'}, end:{date:'2026-07-27'},
    extendedProperties:{private:{kind:'due', dueTime:'23:59'}}
  });
  eq(back.kind, 'task');
  eq(back.start, '23:59');
});

test('移行：endDate が無い古い予定も期間として扱える', () => {
  eq(T.endOf({date:'2026-07-22'}), '2026-07-22');
  eq(T.isMulti({date:'2026-07-22'}), false);
});

/* ---------- 結果 ---------- */
console.log(`\n${path.basename(FILE)} を検証\n`);
for(const [mark, name, err] of results){
  console.log(`  ${mark} ${name}`);
  if(err) console.log(`       ${err}`);
}
console.log(`\n  ${pass} 件成功 / ${fail} 件失敗\n`);
process.exit(fail ? 1 : 0);

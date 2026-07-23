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
  catOf, dueLabel, CONFIG, NO_CAT,
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
const sandbox = {
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

test('カテゴリ：完了の緑と混同しない', () => {
  // 緊急度を色で表すのをやめたので、赤は種類に使ってよい。
  // 緑だけは「今日・完了」で使い続けているので離す
  for(const c of T.CONFIG.categories){
    const d = colorDist(c.color, '#0E8F7E');
    ok(d >= MIN_DIST, `${c.name}(${c.color}) が完了の緑に近すぎる（距離 ${d}）`);
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

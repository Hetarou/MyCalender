/**
 * 画面ごと動かして確かめる（任意）
 *
 *   npm install jsdom
 *   node smoke.js                    … 実行時エラーと画面の中身を出す
 *   node smoke.js path/to/old.html   … 別の版と見比べる
 *
 * test.js は画面を見ないので、こちらは補助。
 * 特に整理（リファクタリング）のあと、「見た目を変えずに中身だけ直せたか」を
 * 確かめるのに使う。変更前のファイルをコピーしておいて、引数に渡せば差分が出る。
 *
 * 注意：url を指定しないと about:blank になり、保存領域が使えず
 * 「保存できない」状態を再現してしまう。アプリのバグと間違えないこと。
 */
const fs = require('fs');
const path = require('path');

let JSDOM;
try{
  ({ JSDOM } = require('jsdom'));
}catch(e){
  console.error('jsdom が要る。  npm install jsdom');
  process.exit(1);
}

const APP = ['index.html', 'calendar.html']
  .map(f => path.join(__dirname, f))
  .find(fs.existsSync);

if(!APP){ console.error('index.html も calendar.html も見つからない'); process.exit(1); }

function load(file){
  return new Promise(resolve => {
    const errors = [];
    const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
      url: 'https://example.com/',          // これが無いと保存領域が使えない
      runScripts: 'dangerously',
      beforeParse(w){
        // jsdom は dialog を実装していないので最低限だけ足す
        w.HTMLDialogElement.prototype.showModal = function(){ this.open = true; };
        w.HTMLDialogElement.prototype.close     = function(){ this.open = false; };
        w.addEventListener('error', e => errors.push(e.message));
        w.console.error = (...a) => errors.push('console.error: ' + a.join(' '));
      }
    });

    setTimeout(() => {
      const d = dom.window.document;
      const text = el => el.textContent.replace(/\s+/g, ' ').trim();
      const snap = { errors };

      snap['週ビューの予定'] = [...d.querySelectorAll('#grid .ev')].map(e => {
        const cat = /--cat:([^;]+)/.exec(e.getAttribute('style') || '');
        return text(e) + ' [' + (cat ? cat[1] : '未分類') + ']';
      });
      snap['帯'] = [...d.querySelectorAll('#grid .bar')].map(text);
      snap['右レーン'] = [...d.querySelectorAll('#rail .rail-item')].map(text);

      d.getElementById('tabTask').click();
      snap['タスクの見出し'] = [...d.querySelectorAll('#grid .tgroup h3')].map(text);
      snap['タスク'] = [...d.querySelectorAll('#grid .trow')].map(text);

      d.getElementById('tabCal').click();
      d.getElementById('tabMonth').click();
      snap['月ビュー'] = [...d.querySelectorAll('#grid .chip, #grid .bar')].map(text);

      d.getElementById('tabWeek').click();
      d.getElementById('catOpen').click();
      snap['種類の編集'] = [...d.querySelectorAll('#catEdit .cat-row')].map(r =>
        r.querySelector('input[type=text]').value + ' ' + r.querySelector('input[type=color]').value);

      resolve(snap);
    }, 800);
  });
}

(async () => {
  const now = await load(APP);

  if(now.errors.length){
    console.log('実行時エラー:');
    now.errors.forEach(e => console.log('  ' + e));
    console.log('');
  }else{
    console.log('実行時エラー: なし\n');
  }

  const other = process.argv[2];
  if(!other){
    for(const [k, v] of Object.entries(now)){
      if(k === 'errors') continue;
      console.log(`■ ${k} (${v.length}件)`);
      v.forEach(x => console.log('   - ' + x));
      console.log('');
    }
    process.exit(now.errors.length ? 1 : 0);
  }

  // 見比べる
  const before = await load(path.resolve(other));
  let same = true;
  for(const k of Object.keys(now)){
    if(k === 'errors') continue;
    const a = JSON.stringify(before[k]), b = JSON.stringify(now[k]);
    console.log(`${a === b ? '一致  ' : '相違!!'} ${k} (${now[k].length}件)`);
    if(a !== b){
      same = false;
      console.log('   前: ' + a.slice(0, 200));
      console.log('   後: ' + b.slice(0, 200));
    }
  }
  console.log('\n' + (same ? '画面の中身は同じ' : '差分あり — 意図した変更か確かめること'));
  process.exit(same ? 0 : 1);
})();

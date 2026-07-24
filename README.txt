# 配置方法

次のファイルをGitHub Pagesで公開している同じフォルダへ置いてください。

- index.html
- manifest.json
- sw.js
- icon-192.png
- icon-512.png

既存のindex.htmlとmanifest.jsonは、今回のファイルで置き換えます。

## 初回確認

1. GitHubへCommit / Push
2. 公開ページを開く
3. F12 → Application → Service Workers
4. activated and is running を確認
5. Application → Manifestでアイコンを確認

古いService Workerが残る場合:
Application → Storage → Clear site data の後、再読み込みしてください。

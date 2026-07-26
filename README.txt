# schedule PWA v1.3.2 — iPhone Google同期修正

## 修正内容

iPhone / Safari / ホーム画面PWAでGoogle OAuthのポップアップが開けないことがある問題を修正しました。

原因:
Google Identity Services の requestAccessToken() より前に storage への await や
スクリプト読み込みを行っていたため、iPhoneでは「ユーザーがボタンを押した操作」が
失効してポップアップを開始できないことがありました。

対策:
- GISスクリプトをアプリ起動時に事前ロード
- TokenClientを事前初期化
- 「Googleカレンダーとつなぐ」押下後は、awaitを挟まず直ちに requestAccessToken()
- Googleアクセストークンの期限切れ後は、勝手なsilent refreshをせず再接続を案内

## 配置

GitHub Pagesの公開フォルダへ以下を上書きしてください。

- index.html
- manifest.json
- sw.js
- icon-192.png
- icon-512.png

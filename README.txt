# schedule PWA v1.3.0 — Phase 3

Phase 3で追加したもの:
- 通知設定画面
- 通知許可の状態表示 / 有効・停止
- テスト通知
- 予定・授業: 開始時 / 5 / 10 / 15 / 30 / 60分前
- タスク: 期限日の指定時刻
- タスク: 前日の指定時刻
- 通知を押したとき、該当するタスク/カレンダー画面へ移動
- Googleカレンダー連携時:
  - 開始時刻のある予定・授業へGoogle Calendar remindersを反映
  - タスクの前日通知をGoogle Calendar remindersへ反映
  - 「Googleへ反映」ボタンで既存予定にも通知設定を再適用
- Service Workerにnotificationclickを追加
- 将来のWeb Push用pushイベント受け口を追加
- PWAキャッシュをv1.3.0へ更新

## iPhoneでの通知について

1. scheduleをホーム画面へ追加して、ホーム画面のアイコンから起動
2. 設定 → 通知 → 「通知を有効にする」
3. iPhoneの許可ダイアログで「許可」
4. 「テスト通知」で確認

このv1.3.0でPWA自身が時刻を確認して出す通知は、アプリが動作中または復帰したときに機能します。
静的なGitHub Pagesだけでは、アプリが完全に終了している状態に指定時刻でWeb Pushを送る送信サーバーを持てません。

Googleカレンダーに接続している場合は、
- 予定・授業の開始前通知
- タスクの前日通知
をGoogle Calendar側にも反映できるため、バックグラウンド通知にはこちらを併用してください。

※ タスクの「当日朝」は、タスクをGoogle上で終日予定として保持している現在の設計上、
Google Calendar remindersだけでは同じ形に変換できないため、PWA側通知です。

## 配置

GitHub Pagesの同じフォルダへ以下を上書きしてPushしてください。

- index.html
- manifest.json
- sw.js
- icon-192.png
- icon-512.png

更新後、旧Service Workerが残っている場合はブラウザを再読み込みし、
設定 → アプリ → 「更新を確認」を押してください。

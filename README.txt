# schedule PWA v1.3.3 — Google同期エラー修正

## 修正した不具合

v1.3.1でPWA内の予約通知エンジンを削除した際、
`handleNotificationUrl()` の定義まで削除されていましたが、
Google同期完了後の `useBackend()` には呼び出しが残っていました。

その結果:

1. Google認証は成功
2. Google Calendarから予定も読み込み
3. 最後に `handleNotificationUrl()` を呼ぶ
4. `Can't find variable: handleNotificationUrl`
5. UI上では「つなげなかった」と表示

という状態になっていました。

v1.3.3では通知タップ時の画面遷移処理として
`handleNotificationUrl()` / `openNotificationTarget()` を復元し、
Service Workerからの通知クリックメッセージにも対応しています。

## テスト

更新後は次を確認してください。

1. Googleカレンダーとつなぐ → エラーなし
2. 設定 > 通知 > 5分前
3. 新しい時刻付き予定を作成
4. Google Calendar側でその予定に「5分前」の通知が付いている

既存予定には「既存の予定へ反映」を押してください。

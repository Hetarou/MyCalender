schedule PWA v1.4.0-a1 — Phase 4A1 Web Push通知基盤

追加:
- Cloudflare Worker + Durable Object AlarmによるWeb Push基盤
- 端末PushSubscription登録
- 10秒後のバックグラウンド通知テスト
- Web Push接続解除
- 既存のGoogle Calendar通知はそのまま維持

重要:
このZIPだけではWeb Pushはまだ動きません。
PUSH_SETUP.md に従って push-worker をCloudflareへデプロイし、
index.html の CONFIG.pushApiBase にWorker URLを設定してください。

A1では「閉じた状態へPushが届く通信経路」だけを検証します。
予定・タスクとの自動連携は次段階です。

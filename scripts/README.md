# 運営用 監視スクリプト

よみ人しらず の Firestore データをローカルから監視するための CLI。
Firebase Admin SDK を使用して読み取るため、アプリのセキュリティルールを経由せず全件アクセスできる。**運営者のみが使用する前提**。

## セットアップ

1. **サービスアカウントキーを生成**
   Firebase Console → プロジェクト設定 → サービスアカウント → 「新しい秘密鍵の生成」→ JSON をダウンロード。

2. **リポジトリ外の場所に保存**（絶対にコミットしない）
   例: `C:\Users\<you>\secrets\yomibito-admin.json`

3. **依存インストール**
   ```powershell
   cd scripts
   npm install
   ```

4. **環境変数を設定**（実行する度、または PowerShell プロファイルに追記）
   ```powershell
   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\Users\<you>\secrets\yomibito-admin.json"
   ```

## コマンド

| コマンド | 説明 |
|---|---|
| `node monitor.js latest [N]` | 最新 N 件（デフォルト50）の歌を全歌会から表示 |
| `node monitor.js watch` | 新着投稿をリアルタイム表示（Ctrl+C で終了） |
| `node monitor.js hogo` | 裁き済み（反故）投稿の一覧 |
| `node monitor.js group <groupId> [N]` | 指定歌会の最近 N 件（デフォルト30）を表示 |
| `node monitor.js public` | 公開歌会の一覧（趣意書つき） |
| `node monitor.js reports [N]` | 未処理通報の一覧（デフォルト50）。末尾に同一作者が複数回通報されているケースのサマリも表示 |
| `node monitor.js user <uid> [N]` | 指定ユーザーの profile・参加歌会・直近の歌（N件、デフォルト20）・直近 rateLimits・本人が発した通報を表示 |
| `node monitor.js ratelimits [YYYY-MM-DD] [N]` | 指定日（省略時は今日 JST）の投稿数/評数/通報発信数 Top N（デフォルト10）。悪用アカウント候補の発見用 |
| `node monitor.js suspend <uid> <reason> [--yes]` | ユーザーを凍結: Firebase Auth `disabled: true` + refresh token revoke + `users/{uid}.suspended` 記録 |
| `node monitor.js unsuspend <uid> [--yes]` | 凍結解除 |
| `node monitor.js purge <uid> <reason> [--yes] [--dry-run]` | 指定ユーザーの過去投稿を一括反故化（原文は `posts/{postId}/private/archivedBody` に退避） |

### 悪用アカウント調査〜処分ワークフロー

1. `node monitor.js reports` で未処理通報を一覧 → 複数通報されている作者 uid をピックアップ
2. `node monitor.js ratelimits` で当日の投稿/評/通報発信の Top を見て、異常に多い uid がいないか確認
3. 候補 uid について `node monitor.js user <uid>` で歌の中身・参加歌会・行動パターンを確認
4. 処分決定なら `node monitor.js suspend <uid> "<理由>"` → 確認プロンプトに `y` で実行
   - `--yes` を末尾に付けると確認プロンプトをスキップ（スクリプト化用・通常は手動で確認推奨）
5. 過去の公開歌会に残るスパム投稿も消したい場合は `node monitor.js purge <uid> "<理由>" --dry-run` で影響範囲を確認 → 問題なければ `--dry-run` を外して実行
6. 誤凍結だった場合は `node monitor.js unsuspend <uid>` で解除（`purge` した投稿は手動で原文を復元する必要あり: `posts/{postId}/private/archivedBody`）

### suspend の挙動と注意点

`suspend` は以下を同時に行う:

1. **`admin.auth().updateUser(uid, { disabled: true })`** — 以降、当該ユーザーは ID トークンを再取得できなくなる
2. **`admin.auth().revokeRefreshTokens(uid)`** — 既存の refresh token を無効化（次の自動更新で失敗→サインアウト）
3. **`users/{uid}.suspended = true` + `suspendedAt` + `suspendedReason`** — 監査ログ兼、将来的に rules から参照できる目印

**即時性の限界**: Firebase が発行済みの ID トークン（JWT, TTL 最長 ~1 時間）は、`revokeRefreshTokens` しても Firestore ルール側で自動的に拒否されない。つまり凍結後 ~1 時間は当該ユーザーが Firestore に書き込み続ける可能性がある。即時遮断が必要な場合は、別途 `firestore.rules` で `users/{uid}.suspended` を参照する強化を入れる（現状未実装）。

**Auth ユーザー削除との違い**: `suspend` はアカウントを残す凍結。完全削除（`deleteUser`）は退会フローで行われるため、運用からは通常 suspend のみで十分。

### purge の挙動と注意点

`purge` は指定ユーザーの過去投稿をまとめて反故化する:

- 対象は `users/{uid}/myPosts` に記録された投稿のみ（**評は対象外**）
- 各投稿について:
  1. `posts/{postId}/private/archivedBody` に原文を退避（`{body, archivedAt}`）
  2. `posts/{postId}` を `body: ""`, `hogo: true`, `hogoType: "ban"`, `hogoReason: <理由>` に更新
- クライアント上では既存の反故投稿と同じく「反故——{理由}」として表示される（`hogoType: 'ban'` を再利用）
- 既に反故の投稿（`hogo: true`）はスキップ（原文退避を二重化しない）
- `posts/{postId}` が存在しない（本人が削除済み）エントリもスキップ
- Firestore batch 上限（500 ops）対策として 200 件ずつコミット
- `--dry-run` で書き込みゼロのプレビューのみ
- 確認プロンプトなし（`--yes`）で自動化可能。ただし通常は `--dry-run` → 手動確認 → 本番実行 の流れを推奨

**復元**: 誤実行した場合、`posts/{postId}/private/archivedBody.body` に原文が残っているので手動で書き戻し可能（自動復元コマンドは未実装）。

### 初回のみ: Firestore インデックスのデプロイ

`reports`・`user` コマンドは追加の composite index を使うため、初回のみルールと同じ要領でインデックスをデプロイする:
```bash
firebase deploy --only firestore:indexes
```

## 出力フォーマット

`latest` / `watch` / `group` / `hogo`:
```
[2026-04-18 22:15:03] [β歌会] ひっそりと文字を重ねて夜ふけまで
[2026-04-18 22:17:41] [ヤバいヤツ] [裁き:caution / 解題:山田#123456] (反故)
```

- 時刻（ローカル）
- 歌会名
- フラグ: `裁き:caution`, `裁き:ban`, `解題:名前#ID` など
- 歌本体（裁き済みは `(反故)`）

`reports` の各エントリ:
```
[2026-04-20 10:33:12] [β歌会] post 裁き:pending
  通報理由: spam / 繰り返し同じ文面を投稿
  対象: 今すぐ登録！無料プレゼント… (通報数:3)
  作者uid: abc123...
  通報者uid: xyz789...
  reportId: report_xxx
```

## 注意

- **秘密鍵は絶対にコミットしない**。`.gitignore` で `*-admin.json` / `*service-account*.json` を弾くようにしてある
- 運用 PC 以外では実行しない（鍵の扱いに注意）
- 大量の歌を読み出すコマンドは Firestore の読み取りコストを消費する。頻度はほどほどに

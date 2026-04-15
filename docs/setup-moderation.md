# モデレーション機能 セットアップ手順書

Phase 1（authorHandle + 事前フィルタ）導入に必要な、**コードのデプロイ前に行う手作業**の手順をまとめたものです。

## 1. OpenAI アカウント準備と Tier1 昇格

### 1.1 API キー取得
1. https://platform.openai.com/ にログイン（未登録なら作成）
2. 左メニュー「API keys」→「Create new secret key」
3. 名前を `yomibito-moderation` 等にし、`All` permission で作成
4. 表示されたキー（`sk-...`）を安全な場所にコピー。**この画面を閉じると二度と見れません**

### 1.2 Tier1 昇格のための最低課金
1. 左メニュー「Settings」→「Billing」
2. 「Add to credit balance」から **$5** をプリペイドチャージ
3. auto-recharge は**OFF**にしておく（月額課金ではなく一度だけの支払いで完了させるため）
4. 初回支払いから **7日後** に自動的に Tier1 に昇格する（手動操作不要）
5. 昇格状況は「Settings」→「Limits」の Usage tier で確認可能

**注意**: Moderation API は完全無料で、チャージした $5 は消費されない。クレジットは残高として残り続け、Tier1 昇格の条件を満たすためだけの支払い。

### 1.3 Moderation API の利用規約確認
https://openai.com/policies/usage-policies で「Moderation エンドポイントへの送信データは学習に使用されない」ことを確認。

## 2. Firebase Functions Secrets 登録

### 2.1 OPENAI_API_KEY
プロジェクトルートで以下を実行:

```bash
firebase functions:secrets:set OPENAI_API_KEY
```

プロンプトに上記 1.1 で取得した `sk-...` を貼り付け。

### 2.2 AUTHOR_HANDLE_SALT
ランダムな 64 文字の hex 文字列を生成する:

```bash
# macOS/Linux
openssl rand -hex 32

# Windows PowerShell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })

# または Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

生成された文字列を以下のコマンドで登録:

```bash
firebase functions:secrets:set AUTHOR_HANDLE_SALT
```

**重要**:
- この値は**絶対に外部に漏らさない**。漏洩すると全ユーザーの `authorHandle` が第三者により逆算される可能性がある（ユーザー名などの情報にはつながらないが、歌会横断で同一投稿者の識別が可能になってしまう）
- 登録後は**変更しない**。変更すると全ユーザーのブロックリストが無効化される
- 手元にも別途バックアップを保管（パスワードマネージャ等）

### 2.3 登録確認
```bash
firebase functions:secrets:access OPENAI_API_KEY
firebase functions:secrets:access AUTHOR_HANDLE_SALT
```

それぞれ値が表示されれば成功。

## 3. デプロイ

```bash
cd functions
npm run build
firebase deploy --only functions
```

デプロイ時、Firebase CLI が自動的に `createPost` / `createComment` 関数に必要な secret を紐付ける（`defineSecret` の宣言に基づく）。

この時点から、**新規の投稿・評には自動で `authorHandle` が埋まり、モデレーションも動作する**ようになります。既存の投稿・評には `authorHandle` が埋まっていない状態なので、次の手順 4 で一括で埋めます。

## 4. バックフィル（既存の投稿・評へ authorHandle を埋める）

既存の投稿・評に `authorHandle` を埋めるバックフィルスクリプトを**一度だけ**実行します。

スクリプトは冪等（既に `authorHandle` がある投稿はスキップ）なので、失敗しても安全に再実行できます。

### 4.1 事前準備: サービスアカウント鍵の取得

スクリプトは Firebase Admin SDK 経由で Firestore に書き込むため、サービスアカウント認証が必要です。

1. Firebase Console → プロジェクト設定（歯車アイコン）→「サービスアカウント」タブ
2. 「新しい秘密鍵の生成」ボタンをクリック
3. ダウンロードされた JSON ファイルを安全な場所に保管（例: `~/keys/yomibito-service-account.json`）

**注意**: この JSON ファイルは**絶対に Git にコミットしない**。`.gitignore` に該当パスが含まれていることを確認してください。

### 4.2 環境変数の設定

ターミナルを開き、サービスアカウント JSON のパスと AUTHOR_HANDLE_SALT の値を環境変数にセットします。

**macOS / Linux (bash/zsh)**:
```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/yomibito-service-account.json
export AUTHOR_HANDLE_SALT=$(firebase functions:secrets:access AUTHOR_HANDLE_SALT)
```

**Windows (PowerShell)**:
```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\yomibito-service-account.json"
$env:AUTHOR_HANDLE_SALT = (firebase functions:secrets:access AUTHOR_HANDLE_SALT)
```

**Windows (Git Bash)**:
```bash
export GOOGLE_APPLICATION_CREDENTIALS="/c/path/to/yomibito-service-account.json"
export AUTHOR_HANDLE_SALT=$(firebase functions:secrets:access AUTHOR_HANDLE_SALT)
```

### 4.3 スクリプトの実行

```bash
cd functions
npx ts-node src/scripts/backfillAuthorHandle.ts
```

処理件数が 50 件ごとに進捗表示され、最後に「全て完了」と出れば成功。

## 5. 動作確認

### 5.1 事前フィルタが動いているか
1. アプリで明らかに不適切な内容（例: 性的露骨な表現）を投稿してみる
2. エラーダイアログ「この内容は投稿できません。表現をお確かめください。」が出ることを確認
3. 通常の短歌は問題なく投稿できることを確認

### 5.2 authorHandle が埋まっているか
Firebase Console → Firestore → `posts/{任意のpostId}` を開き、`authorHandle` フィールドが存在することを確認（12文字の hex 文字列）。

### 5.3 Fail-open の確認
（任意）`OPENAI_API_KEY` を一時的に無効な値に差し替え、投稿が通ることと Cloud Logging に warning が出ることを確認。確認後は正しい値に戻す。

## 6. トラブルシューティング

### デプロイ時に `secret not found` エラー
→ `firebase functions:secrets:access OPENAI_API_KEY` で登録されているか確認。プロジェクト ID が正しいかも確認。

### 投稿が全部「投稿できません」で拒否される
→ OpenAI API キーが無効になっている可能性。`openaiModeration.ts` の閾値 `THRESHOLDS` が厳しすぎる可能性。Cloud Logging で `[moderation]` ログを確認。

### バックフィルスクリプトが `GOOGLE_APPLICATION_CREDENTIALS` エラー
→ 4.1 のサービスアカウント JSON のパス指定が必要。Firebase Console → プロジェクト設定 → サービスアカウント → 新しい秘密鍵を生成。

## 7. 参考リンク

- OpenAI Moderation API: https://platform.openai.com/docs/guides/moderation
- Firebase Functions Secrets: https://firebase.google.com/docs/functions/config-env#secret-manager
- OpenAI Usage Tiers: https://platform.openai.com/docs/guides/rate-limits/usage-tiers

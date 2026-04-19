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

## 出力フォーマット

```
[2026-04-18 22:15:03] [β歌会] ひっそりと文字を重ねて夜ふけまで
[2026-04-18 22:17:41] [ヤバいヤツ] [裁き:caution / 解題:山田#123456] (反故)
```

- 時刻（ローカル）
- 歌会名
- フラグ: `裁き:caution`, `裁き:ban`, `解題:名前#ID` など
- 歌本体（裁き済みは `(反故)`）

## 注意

- **秘密鍵は絶対にコミットしない**。`.gitignore` で `*-admin.json` / `*service-account*.json` を弾くようにしてある
- 運用 PC 以外では実行しない（鍵の扱いに注意）
- 大量の歌を読み出すコマンドは Firestore の読み取りコストを消費する。頻度はほどほどに

# よみ人しらず

## セットアップ

### 前提条件

- Node.js 18+（Cloud Functions のビルド・デプロイを行う場合は Node.js 22。`functions/package.json` の `engines.node` が 22 のため）
- Firebase プロジェクト
- Google Cloud Console で OAuth 2.0 クライアント ID を取得済み
- iOS ビルドを行う場合は Xcode と CocoaPods、および Apple Developer アカウント（`usesAppleSignIn: true` のため Sign in with Apple の Capability が必要）
- EAS Build / Submit を使う場合は `eas-cli` と Expo アカウント

### 手順

1. 依存関係のインストール
   ```bash
   npm install
   cd functions && npm install
   ```

2. Firebase 設定ファイルを配置
   - Android: `google-services.json` をプロジェクトルートに配置
   - iOS: `GoogleService-Info.plist` をプロジェクトルートに配置

3. 環境変数を設定
   ```bash
   cp .env.local.example .env.local
   ```
   `.env.local` に Firebase の設定値を記入:
   ```
   FIREBASE_API_KEY=...
   FIREBASE_AUTH_DOMAIN=...
   FIREBASE_PROJECT_ID=...
   FIREBASE_STORAGE_BUCKET=...
   FIREBASE_MESSAGING_SENDER_ID=...
   FIREBASE_APP_ID=...
   FIREBASE_MEASUREMENT_ID=...
   GOOGLE_WEB_CLIENT_ID=...
   ```

4. Cloud Functions をデプロイ
   ```bash
   cd functions && npm run build && firebase deploy --only functions
   ```

5. Firestore Security Rules / インデックスをデプロイ
   ```bash
   firebase deploy --only firestore:rules
   firebase deploy --only firestore:indexes
   ```

6. 開発サーバーを起動
   ```bash
   npx expo start
   ```

7. Android ビルド（初回のみ）
   ```bash
   npx expo prebuild --clean && npx expo run:android --device
   ```

8. iOS ビルド（初回のみ、macOS 環境）
   ```bash
   npx expo prebuild --clean && npx expo run:ios --device
   ```

### 補足

- `app.config.ts` は `.env.local` の値を `expo.extra` に流し込む仕組み。`dotenv/config` を読み込んでいるので、`expo start` 実行時にも自動で反映される。
- `google-services.json` / `GoogleService-Info.plist` の配置先は環境変数 `GOOGLE_SERVICES_JSON` / `GOOGLE_SERVICES_INFO_PLIST` で上書き可能（EAS Build ではこちらを使う想定）。
- `plugins/` 配下の自作 Expo Config Plugin（`with-firebase-static-framework`, `with-android-japanese-locale`）は `app.config.ts` から参照されているので、リポジトリのルートから実行する必要がある。
- リリースビルドは EAS（`eas.json` に設定済み）を利用。例：`eas build -p android --profile production`。Google Play への自動 submit には `./google-play-key.json` が必要。

## ライセンス

[MIT](LICENSE)

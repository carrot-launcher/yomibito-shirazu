# よみ人しらず

## セットアップ

### 前提条件

- Node.js 18+
- Firebase プロジェクト
- Google Cloud Console で OAuth 2.0 クライアント ID を取得済み

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

5. Firestore Security Rules をデプロイ
   ```bash
   firebase deploy --only firestore:rules
   ```

6. 開発サーバーを起動
   ```bash
   npx expo start
   ```

7. Android ビルド（初回のみ）
   ```bash
   npx expo prebuild --clean && npx expo run:android --device
   ```

## ライセンス

[MIT](LICENSE)

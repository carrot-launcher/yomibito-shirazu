# 詠み人知らず — セットアップガイド（Windows / PowerShell）

## 前提条件
- Node.js 24 LTS（nvm-windows 経由推奨）
- Android Studio インストール済み（エミュレータ設定済み）
- Google アカウント

---

## Step 1: 依存パッケージのインストール

```powershell
cd C:\Users\<ユーザー名>\bin\yomibito-shirazu
npm install
```

これだけでアプリ側の準備は完了です。

## Step 2: Firebase プロジェクト作成

1. https://console.firebase.google.com/ にアクセス
2. 「プロジェクトを追加」→ プロジェクト名「yomibito-shirazu」
3. Google Analytics は有効でも無効でもOK

### 2a. Firestore を有効化
1. 左メニュー「Firestore Database」→「データベースを作成」
2. ロケーション: `asia-northeast1`（東京）
3. 「テストモードで開始」→ 後でルールを設定

### 2b. Authentication を有効化
1. 左メニュー「Authentication」→「始める」
2. 「Sign-in method」タブ → Google を有効化
3. プロジェクトのサポートメール（自分のGmail）を設定

### 2c. Android アプリを登録
1. プロジェクト概要 → 「Android」アイコンをクリック
2. パッケージ名: `com.yomibito.shirazu`
3. アプリのニックネーム: `詠み人知らず`
4. SHA-1 フィンガープリントの取得:
   ```powershell
   keytool -list -v `
     -keystore "$env:USERPROFILE\.android\debug.keystore" `
     -alias androiddebugkey `
     -storepass android `
     -keypass android
   ```
   表示される `SHA1:` の値をコピーして Firebase Console に貼り付け。
   keytool が見つからない場合:
   ```powershell
   $javaHome = (Get-ChildItem "C:\Program Files\Android\Android Studio\jbr" -Directory | Select-Object -First 1).FullName
   & "$javaHome\bin\keytool.exe" -list -v `
     -keystore "$env:USERPROFILE\.android\debug.keystore" `
     -alias androiddebugkey `
     -storepass android `
     -keypass android
   ```
5. `google-services.json` をダウンロード → プロジェクトルートに配置:
   ```powershell
   Move-Item ~\Downloads\google-services.json C:\Users\<ユーザー名>\bin\yomibito-shirazu\
   ```

### 2d. Web クライアント ID を確認
1. https://console.cloud.google.com/ にアクセス
2. 上部で Firebase プロジェクトを選択
3. 「APIとサービス」→「認証情報」
4. OAuth 2.0 クライアント ID から「Web client」の「クライアント ID」をコピー

### 2e. ウェブアプリを登録（設定値取得のため）
1. Firebase Console → ⚙️「プロジェクトの設定」→「全般」タブ
2. 下部の「マイアプリ」→「アプリを追加」→ ウェブ（`</>`アイコン）
3. アプリ名を入力して登録
4. 表示される `firebaseConfig` の値をメモ

## Step 3: 設定ファイルを編集

`src/config/firebase.ts` を開いて、Step 2e と 2d の値を貼り付け:

```typescript
const firebaseConfig = {
  apiKey: "ここにコピーした値",
  authDomain: "yomibito-shirazu.firebaseapp.com",
  projectId: "yomibito-shirazu",
  storageBucket: "yomibito-shirazu.appspot.com",
  messagingSenderId: "ここにコピーした値",
  appId: "ここにコピーした値"
};

export const WEB_CLIENT_ID = "Step 2d でコピーした値.apps.googleusercontent.com";
```

## Step 4: Firestore セキュリティルールをデプロイ

```powershell
# Firebase CLI インストール（未インストールの場合）
npm install -g firebase-tools

# ログイン（ブラウザが開く）
firebase login

# プロジェクト初期化
firebase init
# → 「Firestore」と「Functions」にスペースキーでチェックを入れて Enter
# → 「Use an existing project」→ yomibito-shirazu を選択
# → 各ファイルの上書き確認が出たら N（No）で既存ファイルを保持

# セキュリティルールとインデックスをデプロイ
firebase deploy --only firestore
```

## Step 5: Cloud Functions デプロイ

```powershell
cd functions
npm install
cd ..
firebase deploy --only functions
```

注意: Cloud Functions のデプロイには Firebase の Blaze プラン（従量課金）へのアップグレードが必要です。
仲間内の使用量なら無料枠内に収まります。

## Step 6: アプリを起動

```powershell
npx expo start
# ターミナルに表示されるメニューで「a」キーを押す
# → Android エミュレータでアプリが起動
```

## Step 7: 動作確認

1. アプリが起動したら Google ログイン
2. 歌会を作成 → 招待コードが表示される
3. 別アカウントで招待コードを入力して参加
4. 短歌を詠んでタイムラインに表示されることを確認

---

## トラブルシューティング

### Google ログインが失敗する
- SHA-1 フィンガープリントが正しいか確認
- `google-services.json` を再ダウンロードして配置し直す
- Firebase Console で Google ログインが有効になっているか確認

### keytool が見つからない
```powershell
$env:JAVA_HOME
Get-ChildItem "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe"
```

### Firestore のアクセスが拒否される
```powershell
firebase deploy --only firestore:rules
```

### Cloud Functions がエラーになる
- Firebase Console で Blaze プラン（従量課金）にアップグレードが必要
```powershell
firebase deploy --only functions
```

### エミュレータが起動しない
```powershell
$env:ANDROID_HOME
& "$env:ANDROID_HOME\emulator\emulator.exe" -list-avds
```

### npm のパスがおかしい
```powershell
node -v
npm -v
Get-Command node | Format-List Source
Get-Command npm | Format-List Source
nvm use 24.14.1
```

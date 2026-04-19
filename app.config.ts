import "dotenv/config";

export default {
  expo: {
    name: "よみ人しらず",
    slug: "yomibito-shirazu",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "yomibitoshirazu",
    userInterfaceStyle: "automatic",
    ios: {
      icon: "./assets/images/icon-ios.png",
      bundleIdentifier: "com.yomibito.shirazu",
      googleServicesFile: process.env.GOOGLE_SERVICES_INFO_PLIST ?? './GoogleService-Info.plist',
      "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false,
        "NSPhotoLibraryAddUsageDescription": "詠んだ歌のスクリーンショット画像を端末の写真ライブラリに保存するために使用します。"
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#F5F0E8",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      blockedPermissions: [
        // 写真・動画・音声の読み取りは不要（保存のみ）
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_AUDIO",
        // 写真の EXIF 位置情報は使わない
        "android.permission.ACCESS_MEDIA_LOCATION",
        // 広告IDは使わない（Firebase Analytics SDK が自動注入するので明示的に除去）
        "com.google.android.gms.permission.AD_ID",
      ],
      predictiveBackGestureEnabled: false,
      package: "com.yomibito.shirazu",
      softwareKeyboardLayoutMode: "resize",
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    },
    plugins: [
      [
        "expo-splash-screen",
        {
          backgroundColor: "#F5F0E8",
          image: "./assets/images/splash-icon.png",
          imageWidth: 140,
          dark: {
            backgroundColor: "#1A1510",
            image: "./assets/images/splash-icon-dark.png",
            imageWidth: 140,
          },
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/notification-icon.png",
          color: "#F5F0E8",
        },
      ],
      "@react-native-google-signin/google-signin",
      "expo-sharing",
      "expo-web-browser",
      "@react-native-firebase/app",
      "@react-native-firebase/messaging",
      "@react-native-firebase/crashlytics",
      "./plugins/with-firebase-static-framework",
      // NOTE: useFrameworks: static を外している
      //   @react-native-firebase v24 + Expo SDK 55 では static framework にすると
      //   RNFBApp と React-Core のモジュール干渉で iOS ビルドが失敗する。
      //   google-signin v16+ は use_frameworks を要求しないので外して OK。
    ],
    experiments: {
      reactCompiler: true,
    },
    extra: {
      firebaseApiKey: process.env.FIREBASE_API_KEY,
      firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN,
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
      firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      firebaseAppId: process.env.FIREBASE_APP_ID,
      firebaseMeasurementId: process.env.FIREBASE_MEASUREMENT_ID,
      googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID,
      eas: {
        "projectId": "5b336a72-97e2-4648-abfb-985fe57ebc2a",
      },
    },
  },
};

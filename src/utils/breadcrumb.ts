// Crashlytics の breadcrumb（行動履歴）を残す軽量ヘルパー。
// エラー発生時、直前の最大 64 行がレポートに同梱される。
//
// 書式ガイド:
//   'アクション:サブアクション [簡単な context]'
//   例: 'react:toggle post=xyz', 'compose:submit group=abc len=30'
//
// 注意: 長文や個人情報（生テキスト、email など）は書かない。
//        あくまで「何をしようとしたか」を短く、デバッグ用途で。
import { getCrashlytics, log } from '@react-native-firebase/crashlytics';

// インスタンスは singleton（getCrashlytics は毎回同じ参照を返すが、
// 念のためモジュールロード時に 1 度だけ解決しておく）。
const crashlyticsInstance = getCrashlytics();

export function breadcrumb(message: string) {
  try {
    log(crashlyticsInstance, message);
  } catch {
    // Crashlytics 未初期化など。breadcrumb は best-effort なので黙殺。
  }
}

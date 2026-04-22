// エラーオブジェクトをユーザー向けの日本語 { title, message } に変換する。
//
// 対応範囲:
//   - Firebase Auth SDK (auth/*)
//   - Firestore SDK (permission-denied, unavailable, not-found など)
//   - Cloud Functions HttpsError (functions/*) — e.message は server 側で日本語化済みなのでそのまま使う
//   - 上記以外 — 汎用エラー文言 + Crashlytics に非致命エラーとして自動送信
//
// 呼び出し側:
//   try { ... } catch (e) {
//     const { title, message } = describeError(e);
//     alert(title, message);
//   }
//
// NOTE: 既知コード（レート制限・ブロック・認証失敗など期待挙動）は Crashlytics に
// 送らない。ダッシュボードが運用上のノイズで埋もれるのを避けるため、原因不明の
// エラーに限定して自動送信する。
import { getCrashlytics, recordError } from '@react-native-firebase/crashlytics';

const crashlyticsInstance = getCrashlytics();

export function describeError(error: any): { title: string; message: string } {
  const code: string | undefined = error?.code;
  const rawMessage: string | undefined = error?.message;

  // --- Firebase Auth ---
  if (code === 'auth/user-disabled') {
    return {
      title: 'ログインできません',
      message: 'このアカウントは停止されています。心当たりがない場合は運営までお問い合わせください。',
    };
  }
  if (code === 'auth/network-request-failed') {
    return {
      title: 'ネットワークエラー',
      message: '通信状態をご確認のうえ、もう一度お試しください。',
    };
  }
  if (code === 'auth/too-many-requests') {
    return {
      title: 'ログインできません',
      message: '試行回数が多すぎます。少し時間をおいてからお試しください。',
    };
  }

  // --- Firestore SDK（直接読み書き時）---
  if (code === 'permission-denied') {
    // 具体原因（ブロック、追放、歌会解散など）は伝えない。
    // ブロックされている場合、そのことを相手（ブロックされた側）に明示的に知らせると
    // 匿名ブロックの前提が崩れるため、中立的な表現に留める。
    return {
      title: '操作できません',
      message: 'この操作は現在できません。少し時間をおいてお試しください。',
    };
  }
  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return {
      title: '通信エラー',
      message: 'サーバーに接続できませんでした。しばらく経ってからお試しください。',
    };
  }
  if (code === 'not-found') {
    return {
      title: '見つかりません',
      message: '対象が既に削除されているかもしれません。',
    };
  }
  if (code === 'resource-exhausted') {
    return {
      title: '上限に達しました',
      message: rawMessage || '本日の上限に達しました。',
    };
  }

  // --- Cloud Functions HttpsError ---
  // サーバー側で日本語メッセージを throw しているので、そのまま使う。
  if (typeof code === 'string' && code.startsWith('functions/')) {
    return {
      title: 'エラー',
      message: rawMessage || 'エラーが発生しました。',
    };
  }

  // --- 上記いずれにも該当しないもの ---
  // Crashlytics に非致命エラーとして自動送信する。ユーザーには簡潔な日本語のみ。
  try {
    const err = error instanceof Error
      ? error
      : new Error(typeof rawMessage === 'string' ? rawMessage : JSON.stringify(error));
    if (code && !err.message.includes(code)) {
      err.message = `[${code}] ${err.message}`;
    }
    recordError(crashlyticsInstance, err);
  } catch {
    // Crashlytics 自体が落ちても UI は出す
  }
  return {
    title: 'エラーが発生しました',
    message: '時間をおいてもう一度お試しください。問題が続くようでしたら運営までお知らせください。',
  };
}

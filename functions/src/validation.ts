import { HttpsError } from "firebase-functions/v2/https";

// ===== 入力検証ヘルパー =====
// callable 関数は TypeScript 型が実行時には効かない（any のデータが来る）ので、
// 全パラメータを明示的に検証してからビジネスロジックに進める。
// 単体テスト可能にするため、admin SDK を触らない純粋関数として切り出している。

export function assertString(
  val: unknown,
  name: string,
  opts?: { min?: number; max?: number; pattern?: RegExp }
): string {
  if (typeof val !== "string") {
    throw new HttpsError("invalid-argument", `${name} は文字列で指定してください`);
  }
  if (opts?.min !== undefined && val.length < opts.min) {
    throw new HttpsError("invalid-argument", `${name} は${opts.min}文字以上で入力してください`);
  }
  if (opts?.max !== undefined && val.length > opts.max) {
    throw new HttpsError("invalid-argument", `${name} は${opts.max}文字以内で入力してください`);
  }
  if (opts?.pattern && !opts.pattern.test(val)) {
    throw new HttpsError("invalid-argument", `${name} の形式が不正です`);
  }
  return val;
}

export function assertOptionalString(
  val: unknown,
  name: string,
  opts?: { max?: number; pattern?: RegExp }
): string | undefined {
  if (val === undefined || val === null) return undefined;
  return assertString(val, name, opts);
}

export function assertEnum<T extends string>(
  val: unknown,
  allowed: readonly T[],
  name: string
): T {
  if (typeof val !== "string" || !(allowed as readonly string[]).includes(val)) {
    throw new HttpsError(
      "invalid-argument",
      `${name} は ${allowed.join("/")} のいずれかで指定してください`
    );
  }
  return val as T;
}

export function assertOptionalBoolean(
  val: unknown,
  name: string,
  defaultVal: boolean
): boolean {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val !== "boolean") {
    throw new HttpsError("invalid-argument", `${name} は真偽値で指定してください`);
  }
  return val;
}

// Firestore ドキュメントID 用（安全な文字のみ、パストラバーサル対策）
export const DOC_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
export function assertDocId(val: unknown, name: string): string {
  return assertString(val, name, { min: 1, max: 128, pattern: DOC_ID_PATTERN });
}
export function assertOptionalDocId(val: unknown, name: string): string | undefined {
  if (val === undefined || val === null) return undefined;
  return assertDocId(val, name);
}

// 文字列の末尾を省略（ログや通知プレビュー用）
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// JST で当日の日付キー（rateLimits/...daily/{today} のパスに使う）
export function todayKey(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

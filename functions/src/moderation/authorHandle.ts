import { createHmac } from "crypto";
import { defineSecret } from "firebase-functions/params";

export const AUTHOR_HANDLE_SALT = defineSecret("AUTHOR_HANDLE_SALT");

/**
 * uid から authorHandle を導出する。
 * HMAC-SHA256(salt, uid).slice(0, 12)
 * - 一方向（salt なしには逆算不可）
 * - 決定的（同じ uid → 同じ handle、ブロックが機能する）
 */
export function deriveAuthorHandle(uid: string): string {
  const salt = AUTHOR_HANDLE_SALT.value();
  return createHmac("sha256", salt).update(uid).digest("hex").slice(0, 12);
}

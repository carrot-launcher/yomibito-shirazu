/**
 * 既存の posts / comments に authorHandle をバックフィルするスクリプト。
 *
 * 実行方法:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   export AUTHOR_HANDLE_SALT=<secret の値>
 *   cd functions
 *   npx ts-node src/scripts/backfillAuthorHandle.ts
 *
 * 冪等: 既に authorHandle が埋まっているドキュメントはスキップする。
 */

import * as admin from "firebase-admin";
import { createHmac } from "crypto";

const SALT = process.env.AUTHOR_HANDLE_SALT;
if (!SALT) {
  console.error("[backfill] AUTHOR_HANDLE_SALT env var が設定されていません。");
  console.error("firebase functions:secrets:access AUTHOR_HANDLE_SALT で取得して export してください。");
  process.exit(1);
}

function deriveHandle(uid: string): string {
  return createHmac("sha256", SALT!).update(uid).digest("hex").slice(0, 12);
}

admin.initializeApp();
const db = admin.firestore();

async function backfillPosts(): Promise<void> {
  console.log("[backfill] posts を処理中...");
  let processed = 0;
  let skipped = 0;
  let missing = 0;
  const snap = await db.collection("posts").get();
  for (const doc of snap.docs) {
    if (doc.data().authorHandle) {
      skipped++;
      continue;
    }
    const authorSnap = await db.doc(`posts/${doc.id}/private/author`).get();
    const authorId = authorSnap.data()?.authorId as string | undefined;
    if (!authorId) {
      console.warn(`[backfill] posts/${doc.id} に authorId がありません。スキップ。`);
      missing++;
      continue;
    }
    await doc.ref.update({ authorHandle: deriveHandle(authorId) });
    processed++;
    if (processed % 50 === 0) console.log(`[backfill]   posts 処理済み: ${processed}`);
  }
  console.log(`[backfill] posts 完了: 更新=${processed}, スキップ=${skipped}, authorId欠損=${missing}`);
}

async function backfillComments(): Promise<void> {
  console.log("[backfill] comments を処理中（collectionGroup）...");
  let processed = 0;
  let skipped = 0;
  let missing = 0;
  const snap = await db.collectionGroup("comments").get();
  for (const doc of snap.docs) {
    // private/author サブコレクションは除外
    if (doc.ref.parent.parent?.parent.id !== "posts") continue;
    if (doc.data().authorHandle) {
      skipped++;
      continue;
    }
    const authorSnap = await doc.ref.collection("private").doc("author").get();
    const authorId = authorSnap.data()?.authorId as string | undefined;
    if (!authorId) {
      console.warn(`[backfill] ${doc.ref.path} に authorId がありません。スキップ。`);
      missing++;
      continue;
    }
    await doc.ref.update({ authorHandle: deriveHandle(authorId) });
    processed++;
    if (processed % 50 === 0) console.log(`[backfill]   comments 処理済み: ${processed}`);
  }
  console.log(`[backfill] comments 完了: 更新=${processed}, スキップ=${skipped}, authorId欠損=${missing}`);
}

(async () => {
  try {
    await backfillPosts();
    await backfillComments();
    console.log("[backfill] 全て完了");
    process.exit(0);
  } catch (err) {
    console.error("[backfill] エラー:", err);
    process.exit(1);
  }
})();

/**
 * 既存の users/{uid}/myPosts/* について、doc ID を postId と一致させる
 * バックフィルスクリプト。
 *
 * 背景:
 *   createPost で従来 auto-generated ID を使っていたが、Firestore ルールから
 *   exists(/users/$(uid)/myPosts/$(postId)) で「自分の歌か」を判定したいので
 *   doc ID = postId へ寄せる。
 *
 * 実行方法:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *   cd functions
 *   npx ts-node src/scripts/backfillMyPostsDocId.ts
 *
 * 冪等:
 *   - doc.id === data.postId のエントリはスキップ
 *   - 移行先（users/{uid}/myPosts/{postId}）が既に存在する場合は、旧エントリのみ削除
 *   - 何度流しても壊れない
 *
 * 注意:
 *   サブコレクションを走査するため collectionGroup('myPosts') を使うが、同名の
 *   サブコレクションが他で存在しないことに依拠している（このリポジトリでは users/ 配下のみ）。
 */

import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

type MyPostData = {
  postId?: string;
  groupId?: string;
  groupName?: string;
  tankaBody?: string;
  batchId?: string | null;
  convertHalfSpace?: boolean;
  convertLineBreak?: boolean;
  createdAt?: admin.firestore.Timestamp;
};

async function backfill(): Promise<void> {
  console.log("[backfill-myPosts] myPosts を処理中...");
  let aligned = 0;      // 既に doc ID == postId
  let migrated = 0;     // 旧エントリを新エントリに移行した
  let deduped = 0;      // 新エントリが既に存在しており旧エントリを削除した
  let missingPostId = 0; // postId フィールドが無い異常データ
  let errors = 0;

  const snap = await db.collectionGroup("myPosts").get();
  for (const docSnap of snap.docs) {
    // users/{uid}/myPosts/{id} 以外のパスは無視（念のため）。
    const parent = docSnap.ref.parent.parent;
    if (!parent || parent.parent.id !== "users") continue;

    const data = docSnap.data() as MyPostData;
    const postId = data.postId;
    if (!postId) {
      console.warn(`[backfill-myPosts] ${docSnap.ref.path} に postId フィールドがありません。スキップ。`);
      missingPostId++;
      continue;
    }

    if (docSnap.id === postId) {
      aligned++;
      continue;
    }

    const targetRef = parent.collection("myPosts").doc(postId);
    try {
      await db.runTransaction(async (tx) => {
        const targetSnap = await tx.get(targetRef);
        if (targetSnap.exists) {
          // 既に postId を doc ID とするエントリがある（重複）。旧エントリだけ落とす。
          tx.delete(docSnap.ref);
          return "deduped";
        }
        tx.set(targetRef, data);
        tx.delete(docSnap.ref);
        return "migrated";
      }).then((result) => {
        if (result === "deduped") deduped++;
        else migrated++;
      });
    } catch (e) {
      console.error(`[backfill-myPosts] ${docSnap.ref.path} の移行失敗:`, e);
      errors++;
    }

    const done = aligned + migrated + deduped + missingPostId + errors;
    if (done % 100 === 0) {
      console.log(`[backfill-myPosts]   処理済み: ${done}`);
    }
  }

  console.log(
    `[backfill-myPosts] 完了: 既に整合=${aligned}, 移行=${migrated}, 重複削除=${deduped}, ` +
    `postId欠損=${missingPostId}, エラー=${errors}`
  );
}

(async () => {
  try {
    await backfill();
    console.log("[backfill-myPosts] 全て完了");
    process.exit(0);
  } catch (err) {
    console.error("[backfill-myPosts] エラー:", err);
    process.exit(1);
  }
})();

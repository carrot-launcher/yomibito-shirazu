import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();

/**
 * getReactionDetails — 詠み人のみリアクション詳細を取得
 */
export const getReactionDetails = functions
  .region("asia-northeast1")
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.HttpsError("unauthenticated", "ログインが必要です");
    const { postId } = data;
    if (!postId) throw new functions.HttpsError("invalid-argument", "postId が必要です");

    const authorSnap = await db.doc(`posts/${postId}/private/author`).get();
    if (!authorSnap.exists) throw new functions.HttpsError("not-found", "投稿が見つかりません");

    if (context.auth.uid !== authorSnap.data()?.authorId) {
      return { reactions: [] };
    }

    const reactionsSnap = await db.collection(`posts/${postId}/reactions`).orderBy("createdAt", "desc").get();
    return {
      reactions: reactionsSnap.docs.map((doc) => ({
        emoji: doc.data().emoji,
        createdAt: doc.data().createdAt?.toDate()?.toISOString() || null,
      })),
    };
  });

/**
 * deletePost — 歌会単位で自分の投稿を削除
 */
export const deletePost = functions
  .region("asia-northeast1")
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.HttpsError("unauthenticated", "ログインが必要です");
    const { postId } = data;
    if (!postId) throw new functions.HttpsError("invalid-argument", "postId が必要です");

    const authorSnap = await db.doc(`posts/${postId}/private/author`).get();
    if (!authorSnap.exists) throw new functions.HttpsError("not-found", "投稿が見つかりません");
    const authorId = authorSnap.data()?.authorId;
    if (context.auth.uid !== authorId) throw new functions.HttpsError("permission-denied", "自分の投稿のみ削除できます");

    const batch = db.batch();
    const reactionsSnap = await db.collection(`posts/${postId}/reactions`).get();
    reactionsSnap.docs.forEach((doc) => batch.delete(doc.ref));
    const commentsSnap = await db.collection(`posts/${postId}/comments`).get();
    for (const commentDoc of commentsSnap.docs) {
      const privateSnap = await db.collection(`posts/${postId}/comments/${commentDoc.id}/private`).get();
      privateSnap.docs.forEach((doc) => batch.delete(doc.ref));
      batch.delete(commentDoc.ref);
    }
    batch.delete(db.doc(`posts/${postId}/private/author`));
    batch.delete(db.doc(`posts/${postId}`));
    await batch.commit();

    const myPostsSnap = await db.collection(`users/${authorId}/myPosts`).where("postId", "==", postId).get();
    const batch2 = db.batch();
    myPostsSnap.docs.forEach((doc) => batch2.delete(doc.ref));
    await batch2.commit();

    return { success: true };
  });

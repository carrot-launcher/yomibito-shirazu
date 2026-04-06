import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";

admin.initializeApp();
const db = admin.firestore();

/**
 * getReactionDetails — 詠み人のみリアクション詳細を取得
 */
export const getReactionDetails = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const { postId } = request.data;
    if (!postId) throw new HttpsError("invalid-argument", "postId が必要です");

    const authorSnap = await db.doc(`posts/${postId}/private/author`).get();
    if (!authorSnap.exists) throw new HttpsError("not-found", "投稿が見つかりません");

    if (request.auth.uid !== authorSnap.data()?.authorId) {
      return { reactions: [] };
    }

    const reactionsSnap = await db.collection(`posts/${postId}/reactions`).orderBy("createdAt", "desc").get();
    return {
      reactions: reactionsSnap.docs.map((doc) => ({
        emoji: doc.data().emoji,
        createdAt: doc.data().createdAt?.toDate()?.toISOString() || null,
      })),
    };
  }
);

/**
 * deletePost — 歌会単位で自分の投稿を削除
 */
export const deletePost = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const { postId } = request.data;
    if (!postId) throw new HttpsError("invalid-argument", "postId が必要です");

    const authorSnap = await db.doc(`posts/${postId}/private/author`).get();
    if (!authorSnap.exists) throw new HttpsError("not-found", "投稿が見つかりません");
    const authorId = authorSnap.data()?.authorId;
    if (request.auth.uid !== authorId) throw new HttpsError("permission-denied", "自分の投稿のみ削除できます");

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
  }
);

/**
 * deleteComment — 自分の評を削除
 */
export const deleteComment = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const { postId, commentId } = request.data;
    if (!postId || !commentId) throw new HttpsError("invalid-argument", "postId と commentId が必要です");

    const authorSnap = await db.doc(`posts/${postId}/comments/${commentId}/private/author`).get();
    if (!authorSnap.exists) throw new HttpsError("not-found", "評が見つかりません");
    if (request.auth.uid !== authorSnap.data()?.authorId) {
      throw new HttpsError("permission-denied", "自分の評のみ削除できます");
    }

    const batch = db.batch();
    batch.delete(db.doc(`posts/${postId}/comments/${commentId}/private/author`));
    batch.delete(db.doc(`posts/${postId}/comments/${commentId}`));
    await batch.commit();

    await db.doc(`posts/${postId}`).update({
      commentCount: admin.firestore.FieldValue.increment(-1),
    });

    return { success: true };
  }
);

/**
 * dissolveGroup — 歌会を解散（オーナーのみ）
 * 歌会に関するすべてのデータを削除する
 */
export const dissolveGroup = onCall(
  { region: "asia-northeast1", timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const { groupId, confirmName, deletePosts } = request.data;
    if (!groupId) throw new HttpsError("invalid-argument", "groupId が必要です");

    // オーナーか確認
    const memberSnap = await db.doc(`groups/${groupId}/members/${request.auth.uid}`).get();
    if (!memberSnap.exists || memberSnap.data()?.role !== "owner") {
      throw new HttpsError("permission-denied", "オーナーのみ歌会を解散できます");
    }

    // 歌会名の一致確認（二重チェック）
    const groupSnap = await db.doc(`groups/${groupId}`).get();
    if (!groupSnap.exists) throw new HttpsError("not-found", "歌会が見つかりません");
    if (groupSnap.data()?.name !== confirmName) {
      throw new HttpsError("invalid-argument", "歌会の名前が一致しません");
    }

    // 1. 歌会の全投稿を処理
    if (deletePosts) {
      const postsSnap = await db.collection("posts").where("groupId", "==", groupId).get();
      for (const postDoc of postsSnap.docs) {
        const postId = postDoc.id;

        // リアクション削除
        const reactionsSnap = await db.collection(`posts/${postId}/reactions`).get();
        const batch1 = db.batch();
        reactionsSnap.docs.forEach((d) => batch1.delete(d.ref));
        if (reactionsSnap.size > 0) await batch1.commit();

        // 評削除（+ private/author）
        const commentsSnap = await db.collection(`posts/${postId}/comments`).get();
        for (const commentDoc of commentsSnap.docs) {
          const privSnap = await db.collection(`posts/${postId}/comments/${commentDoc.id}/private`).get();
          const batchC = db.batch();
          privSnap.docs.forEach((d) => batchC.delete(d.ref));
          batchC.delete(commentDoc.ref);
          await batchC.commit();
        }

        // private/author 削除
        const authorSnap = await db.doc(`posts/${postId}/private/author`).get();
        if (authorSnap.exists) await authorSnap.ref.delete();

        // 投稿本体削除
        await postDoc.ref.delete();
      }
    }

    // 2. メンバー全員の joinedGroups から削除（myPostsは歌集に残す）
    const membersSnap = await db.collection(`groups/${groupId}/members`).get();
    for (const memberDoc of membersSnap.docs) {
      const userId = memberDoc.id;

      // joinedGroups 更新
      await db.doc(`users/${userId}`).update({
        joinedGroups: admin.firestore.FieldValue.arrayRemove(groupId),
      });

      // 歌を消す場合のみブックマークも削除
      if (deletePosts) {
        const bookmarksSnap = await db
          .collection(`users/${userId}/bookmarks`)
          .where("groupId", "==", groupId)
          .get();
        const batchB = db.batch();
        bookmarksSnap.docs.forEach((d) => batchB.delete(d.ref));
        if (bookmarksSnap.size > 0) await batchB.commit();
      }

      // メンバードキュメント削除
      await memberDoc.ref.delete();
    }

    // 3. 歌会本体を削除
    await db.doc(`groups/${groupId}`).delete();

    return { success: true };
  }
);

/**
 * kickMember — メンバーを追放（オーナーのみ）
 */
export const kickMember = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const { groupId, targetUserId } = request.data;
    if (!groupId || !targetUserId) throw new HttpsError("invalid-argument", "groupId と targetUserId が必要です");

    // オーナーか確認
    const callerSnap = await db.doc(`groups/${groupId}/members/${request.auth.uid}`).get();
    if (!callerSnap.exists || callerSnap.data()?.role !== "owner") {
      throw new HttpsError("permission-denied", "オーナーのみ追放できます");
    }

    // 対象がオーナーでないか確認
    const targetSnap = await db.doc(`groups/${groupId}/members/${targetUserId}`).get();
    if (!targetSnap.exists) throw new HttpsError("not-found", "メンバーが見つかりません");
    if (targetSnap.data()?.role === "owner") {
      throw new HttpsError("permission-denied", "オーナーは追放できません");
    }

    // 追放情報を保存（名前とID）
    const targetData = targetSnap.data()!;
    const displayName = targetData.displayName || "";
    const userCode = targetData.userCode || "";

    // メンバー削除
    await db.doc(`groups/${groupId}/members/${targetUserId}`).delete();

    // グループの memberCount をデクリメント & bannedUsers に追加
    await db.doc(`groups/${groupId}`).update({
      memberCount: admin.firestore.FieldValue.increment(-1),
      [`bannedUsers.${targetUserId}`]: { displayName, userCode },
    });

    // 対象ユーザーの joinedGroups から削除
    await db.doc(`users/${targetUserId}`).update({
      joinedGroups: admin.firestore.FieldValue.arrayRemove(groupId),
    });

    return { success: true };
  }
);

/**
 * unbanMember — 追放解除（オーナーのみ）
 */
export const unbanMember = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const { groupId, targetUserId } = request.data;
    if (!groupId || !targetUserId) throw new HttpsError("invalid-argument", "groupId と targetUserId が必要です");

    // オーナーか確認
    const callerSnap = await db.doc(`groups/${groupId}/members/${request.auth.uid}`).get();
    if (!callerSnap.exists || callerSnap.data()?.role !== "owner") {
      throw new HttpsError("permission-denied", "オーナーのみ追放解除できます");
    }

    await db.doc(`groups/${groupId}`).update({
      [`bannedUsers.${targetUserId}`]: admin.firestore.FieldValue.delete(),
    });

    return { success: true };
  }
);
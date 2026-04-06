import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

admin.initializeApp();
const db = admin.firestore();

// ===== 通知ヘルパー =====

async function createNotification(
  targetUserId: string,
  type: "new_post" | "reaction" | "comment",
  data: {
    postId: string;
    groupId: string;
    groupName: string;
    tankaBody: string;
    emoji?: string;
    commentBody?: string;
  }
) {
  const userSnap = await db.doc(`users/${targetUserId}`).get();
  const userData = userSnap.data();
  if (!userData) return;

  const settings = userData.notificationSettings || {};
  if (type === "new_post" && !settings.newPost) return;
  if (type === "reaction" && !settings.reaction) return;
  if (type === "comment" && !settings.comment) return;

  // FCM送信（毎回）
  const fcmToken = userData.fcmToken;
  if (fcmToken) {
    let title = "";
    let body = "";
    let channelId = "";
    switch (type) {
      case "new_post":
        title = `${data.groupName}に新しい歌が詠まれました`;
        body = data.tankaBody.slice(0, 20);
        channelId = "new-tanka";
        break;
      case "reaction":
        title = "あなたの歌に🌸が届きました";
        body = data.tankaBody.slice(0, 20);
        channelId = "reactions";
        break;
      case "comment":
        title = "あなたの歌に評が届きました";
        body = (data.commentBody || "").slice(0, 20);
        channelId = "comments";
        break;
    }
    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: { title, body },
        android: {
          notification: {
            channelId,
            visibility: "private" as const,
          },
        },
        data: { postId: data.postId, groupId: data.groupId, type },
      });
    } catch (e: any) {
      if (
        e.code === "messaging/invalid-registration-token" ||
        e.code === "messaging/registration-token-not-registered"
      ) {
        await db.doc(`users/${targetUserId}`).update({ fcmToken: "" });
      }
    }
  }

  // たよりdoc作成（リアクションはまとめる）
  if (type === "reaction") {
    const lastReadAt =
      userData.tayoriLastReadAt || new admin.firestore.Timestamp(0, 0);
    const existing = await db
      .collection(`users/${targetUserId}/notifications`)
      .where("type", "==", "reaction")
      .where("postId", "==", data.postId)
      .where("createdAt", ">", lastReadAt)
      .limit(1)
      .get();

    if (!existing.empty) {
      await existing.docs[0].ref.update({
        reactionCount: admin.firestore.FieldValue.increment(1),
        createdAt: admin.firestore.Timestamp.now(),
      });
    } else {
      await db.collection(`users/${targetUserId}/notifications`).add({
        type: "reaction",
        ...data,
        reactionCount: 1,
        createdAt: admin.firestore.Timestamp.now(),
      });
    }
  } else {
    await db.collection(`users/${targetUserId}/notifications`).add({
      type,
      ...data,
      createdAt: admin.firestore.Timestamp.now(),
    });
  }
}

// ===== 通知トリガー =====

/**
 * onNewPost — 新しい歌が投稿されたとき、歌会メンバーに通知
 * private/author の作成をトリガーにすることで、post本体が確実に存在する
 */
export const onNewPost = onDocumentCreated(
  { document: "posts/{postId}/private/author", region: "asia-northeast1" },
  async (event) => {
    const authorId = event.data?.data()?.authorId;
    const postId = event.params.postId;
    if (!authorId) return;

    const postSnap = await db.doc(`posts/${postId}`).get();
    if (!postSnap.exists) return;
    const post = postSnap.data()!;

    const groupSnap = await db.doc(`groups/${post.groupId}`).get();
    if (!groupSnap.exists) return;
    const groupName = groupSnap.data()!.name || "";

    const membersSnap = await db
      .collection(`groups/${post.groupId}/members`)
      .get();
    await Promise.all(
      membersSnap.docs
        .filter((m) => m.id !== authorId)
        .map((m) =>
          createNotification(m.id, "new_post", {
            postId,
            groupId: post.groupId,
            groupName,
            tankaBody: post.body,
          })
        )
    );
  }
);

/**
 * onNewReaction — リアクションが付いたとき、歌の詠み人に通知
 */
export const onNewReaction = onDocumentCreated(
  {
    document: "posts/{postId}/reactions/{reactionId}",
    region: "asia-northeast1",
  },
  async (event) => {
    const reactionData = event.data?.data();
    const postId = event.params.postId;
    if (!reactionData) return;

    const authorSnap = await db.doc(`posts/${postId}/private/author`).get();
    const authorId = authorSnap.data()?.authorId;
    if (!authorId || authorId === reactionData.userId) return;

    const postSnap = await db.doc(`posts/${postId}`).get();
    if (!postSnap.exists) return;
    const post = postSnap.data()!;

    const groupSnap = await db.doc(`groups/${post.groupId}`).get();
    const groupName = groupSnap.exists ? groupSnap.data()!.name || "" : "";

    await createNotification(authorId, "reaction", {
      postId,
      groupId: post.groupId,
      groupName,
      tankaBody: post.body,
      emoji: reactionData.emoji,
    });
  }
);

/**
 * onNewComment — 評が付いたとき、歌の詠み人に通知
 * comment/private/author の作成をトリガーにする
 */
export const onNewComment = onDocumentCreated(
  {
    document: "posts/{postId}/comments/{commentId}/private/author",
    region: "asia-northeast1",
  },
  async (event) => {
    const commentAuthorId = event.data?.data()?.authorId;
    const { postId, commentId } = event.params;
    if (!commentAuthorId) return;

    const postAuthorSnap = await db.doc(`posts/${postId}/private/author`).get();
    const postAuthorId = postAuthorSnap.data()?.authorId;
    if (!postAuthorId || postAuthorId === commentAuthorId) return;

    const postSnap = await db.doc(`posts/${postId}`).get();
    if (!postSnap.exists) return;
    const post = postSnap.data()!;

    const commentSnap = await db
      .doc(`posts/${postId}/comments/${commentId}`)
      .get();
    const commentBody = commentSnap.data()?.body || "";

    const groupSnap = await db.doc(`groups/${post.groupId}`).get();
    const groupName = groupSnap.exists ? groupSnap.data()!.name || "" : "";

    await createNotification(postAuthorId, "comment", {
      postId,
      groupId: post.groupId,
      groupName,
      tankaBody: post.body,
      commentBody,
    });
  }
);

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
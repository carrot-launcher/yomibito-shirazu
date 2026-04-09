import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

admin.initializeApp();
const db = admin.firestore();

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

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
        body = data.tankaBody;
        channelId = "new-tanka";
        break;
      case "reaction":
        title = "あなたの歌に🌸が届きました";
        body = data.tankaBody;
        channelId = "reactions";
        break;
      case "comment":
        title = "あなたの歌に評が届きました";
        body = truncate(data.commentBody || "", 50);
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

// ===== レートリミット付き作成 =====

function todayKey(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/**
 * createPost — 歌の投稿（レートリミット付き）
 */
export const createPost = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const uid = request.auth.uid;
    const { groupId, body, batchId, convertHalfSpace, convertLineBreak } = request.data;
    if (!groupId || typeof body !== "string") throw new HttpsError("invalid-argument", "groupId と body が必要です");
    const trimmed = body.trim();
    if (trimmed.length < 2 || trimmed.length > 50) throw new HttpsError("invalid-argument", "歌は2〜50文字で入力してください");

    // メンバーシップ確認
    const memberSnap = await db.doc(`groups/${groupId}/members/${uid}`).get();
    if (!memberSnap.exists) throw new HttpsError("permission-denied", "この歌会のメンバーではありません");

    // グループ名を取得（myPosts用）
    const groupSnap = await db.doc(`groups/${groupId}`).get();
    const groupName = groupSnap.data()?.name || "";

    const today = todayKey();
    const userCounterRef = db.doc(`rateLimits/${uid}/daily/${today}`);
    const groupCounterRef = db.doc(`rateLimits/group_${groupId}/daily/${today}`);

    // レートリミット確認 + 投稿作成をトランザクションで
    const postId = await db.runTransaction(async (tx) => {
      const userCounter = await tx.get(userCounterRef);
      const groupCounter = await tx.get(groupCounterRef);
      const userPostCount = userCounter.data()?.postCount || 0;
      const groupPostCount = groupCounter.data()?.postCount || 0;

      if (userPostCount > 30) throw new HttpsError("resource-exhausted", "本日の投稿上限に達しました");
      if (groupPostCount > 200) throw new HttpsError("resource-exhausted", "この歌会の本日の投稿上限に達しました");

      const postRef = db.collection("posts").doc();
      tx.set(postRef, {
        groupId, body: trimmed, batchId: batchId || null,
        convertHalfSpace: convertHalfSpace ?? true,
        convertLineBreak: convertLineBreak ?? true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        reactionSummary: {}, commentCount: 0,
      });
      tx.set(db.doc(`posts/${postRef.id}/private/author`), { authorId: uid });
      tx.set(db.collection(`users/${uid}/myPosts`).doc(), {
        postId: postRef.id, groupId, groupName,
        tankaBody: trimmed, batchId: batchId || null,
        convertHalfSpace: convertHalfSpace ?? true,
        convertLineBreak: convertLineBreak ?? true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // カウンタ更新
      tx.set(userCounterRef, { postCount: (userPostCount + 1), commentCount: userCounter.data()?.commentCount || 0 }, { merge: true });
      tx.set(groupCounterRef, { postCount: (groupPostCount + 1) }, { merge: true });

      // 歌会の最終投稿時刻を更新
      tx.update(db.doc(`groups/${groupId}`), {
        lastPostAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      // 投稿者本人の lastReadAt も同時に更新（自分の投稿で未読扱いにならないように）
      tx.update(db.doc(`groups/${groupId}/members/${uid}`), {
        lastReadAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return postRef.id;
    });

    return { postId };
  }
);

/**
 * createComment — 評の投稿（レートリミット付き）
 */
export const createComment = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const uid = request.auth.uid;
    const { postId, body } = request.data;
    if (!postId || typeof body !== "string") throw new HttpsError("invalid-argument", "postId と body が必要です");
    const trimmed = body.trim();
    if (trimmed.length < 1 || trimmed.length > 500) throw new HttpsError("invalid-argument", "評は1〜500文字で入力してください");

    // 投稿の存在とメンバーシップ確認
    const postSnap = await db.doc(`posts/${postId}`).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "投稿が見つかりません");
    const groupId = postSnap.data()?.groupId;
    const memberSnap = await db.doc(`groups/${groupId}/members/${uid}`).get();
    if (!memberSnap.exists) throw new HttpsError("permission-denied", "この歌会のメンバーではありません");

    const today = todayKey();
    const userCounterRef = db.doc(`rateLimits/${uid}/daily/${today}`);

    const commentId = await db.runTransaction(async (tx) => {
      const userCounter = await tx.get(userCounterRef);
      const commentCount = userCounter.data()?.commentCount || 0;

      if (commentCount > 50) throw new HttpsError("resource-exhausted", "本日の評の上限に達しました");

      const commentRef = db.collection(`posts/${postId}/comments`).doc();
      tx.set(commentRef, {
        body: trimmed,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      tx.set(db.doc(`posts/${postId}/comments/${commentRef.id}/private/author`), { authorId: uid });
      tx.update(db.doc(`posts/${postId}`), { commentCount: admin.firestore.FieldValue.increment(1) });

      // カウンタ更新
      tx.set(userCounterRef, { commentCount: (commentCount + 1), postCount: userCounter.data()?.postCount || 0 }, { merge: true });

      return commentRef.id;
    });

    return { commentId };
  }
);

/**
 * createGroup — 歌会の作成（上限チェック付き）
 */
export const createGroup = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const uid = request.auth.uid;
    const { groupName, displayName } = request.data;
    if (!groupName?.trim() || !displayName?.trim()) throw new HttpsError("invalid-argument", "歌会名と表示名が必要です");
    if (groupName.trim().length > 16) throw new HttpsError("invalid-argument", "歌会名は16文字以内にしてください");
    if (displayName.trim().length > 16) throw new HttpsError("invalid-argument", "表示名は16文字以内にしてください");

    // ユーザーコードを取得
    const userSnap = await db.doc(`users/${uid}`).get();
    const userCode = userSnap.data()?.userCode || "000000";

    // 作成済み歌会数チェック
    const ownedSnap = await db.collection("groups").where("createdBy", "==", uid).count().get();
    if (ownedSnap.data().count > 10) throw new HttpsError("resource-exhausted", "歌会の作成上限に達しています");

    // 招待コード生成
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let inviteCode = "";
    for (let i = 0; i < 6; i++) inviteCode += chars[Math.floor(Math.random() * chars.length)];

    const groupRef = db.collection("groups").doc();
    const batch = db.batch();
    batch.set(groupRef, {
      name: groupName.trim(), inviteCode, memberCount: 1,
      createdBy: uid, createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(db.doc(`groups/${groupRef.id}/members/${uid}`), {
      displayName: displayName.trim(), userCode,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(), role: "owner",
    });
    batch.update(db.doc(`users/${uid}`), {
      joinedGroups: admin.firestore.FieldValue.arrayUnion(groupRef.id),
    });
    await batch.commit();

    return { groupId: groupRef.id, inviteCode };
  }
);

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

    // 0. 解散通知を全メンバーに送信（オーナー以外）
    const membersSnap = await db.collection(`groups/${groupId}/members`).get();
    const groupName = groupSnap.data()?.name || "";
    for (const memberDoc of membersSnap.docs) {
      if (memberDoc.id === request.auth.uid) continue;
      try {
        const userSnap = await db.doc(`users/${memberDoc.id}`).get();
        const userData = userSnap.data();
        if (!userData) continue;
        const settings = userData.notificationSettings || {};
        if (settings.other === false) continue;
        await db.collection(`users/${memberDoc.id}/notifications`).add({
          type: "dissolve",
          groupName,
          createdAt: admin.firestore.Timestamp.now(),
        });
        const fcmToken = userData.fcmToken;
        if (fcmToken) {
          await admin.messaging().send({
            token: fcmToken,
            notification: {
              title: `${groupName}が解散しました`,
              body: "歌会のオーナーが歌会を解散しました",
            },
            android: { notification: { channelId: "other", visibility: "private" as const } },
            data: { type: "dissolve" },
          }).catch(() => {});
        }
      } catch {
        // 通知失敗は解散処理を止めない
      }
    }

    // 1. メンバー全員の joinedGroups から削除（先に実行し、ゾンビ化を防ぐ）
    for (const memberDoc of membersSnap.docs) {
      const userId = memberDoc.id;
      await db.doc(`users/${userId}`).update({
        joinedGroups: admin.firestore.FieldValue.arrayRemove(groupId),
      });
      if (deletePosts) {
        const bookmarksSnap = await db
          .collection(`users/${userId}/bookmarks`)
          .where("groupId", "==", groupId)
          .get();
        const batchB = db.batch();
        bookmarksSnap.docs.forEach((d) => batchB.delete(d.ref));
        if (bookmarksSnap.size > 0) await batchB.commit();
      }
      await memberDoc.ref.delete();
    }

    // 2. 歌会本体を削除
    await db.doc(`groups/${groupId}`).delete();

    // 2.5. グループのレートリミット削除
    try {
      const groupDailySnap = await db.collection(`rateLimits/group_${groupId}/daily`).get();
      if (groupDailySnap.size > 0) {
        const b = db.batch();
        groupDailySnap.docs.forEach((d) => b.delete(d.ref));
        b.delete(db.doc(`rateLimits/group_${groupId}`));
        await b.commit();
      }
    } catch {}

    // 3. 投稿を削除（個別にtry/catchし、1件の失敗で全体が止まらないように）
    if (deletePosts) {
      const postsSnap = await db.collection("posts").where("groupId", "==", groupId).get();
      for (const postDoc of postsSnap.docs) {
        try {
          const postId = postDoc.id;
          const reactionsSnap = await db.collection(`posts/${postId}/reactions`).get();
          const batch1 = db.batch();
          reactionsSnap.docs.forEach((d) => batch1.delete(d.ref));
          if (reactionsSnap.size > 0) await batch1.commit();

          const commentsSnap = await db.collection(`posts/${postId}/comments`).get();
          for (const commentDoc of commentsSnap.docs) {
            const privSnap = await db.collection(`posts/${postId}/comments/${commentDoc.id}/private`).get();
            const batchC = db.batch();
            privSnap.docs.forEach((d) => batchC.delete(d.ref));
            batchC.delete(commentDoc.ref);
            await batchC.commit();
          }

          const authorSnap = await db.doc(`posts/${postId}/private/author`).get();
          if (authorSnap.exists) await authorSnap.ref.delete();
          await postDoc.ref.delete();
        } catch {
          // 個別の投稿削除失敗は無視して続行
        }
      }
    }

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
 * judgeContent — 歌や評を裁く（戒告・破門）（オーナーのみ）
 */
export const judgeContent = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const { groupId, postId, commentId, type, reason } = request.data as {
      groupId: string;
      postId: string;
      commentId?: string;
      type: "caution" | "ban";
      reason: string;
    };
    if (!groupId || !postId || !type) throw new HttpsError("invalid-argument", "必須パラメータが不足しています");

    // オーナーか確認
    const callerSnap = await db.doc(`groups/${groupId}/members/${request.auth.uid}`).get();
    if (!callerSnap.exists || callerSnap.data()?.role !== "owner") {
      throw new HttpsError("permission-denied", "オーナーのみ裁くことができます");
    }

    // 対象コンテンツを取得
    const isComment = !!commentId;
    const contentPath = isComment
      ? `posts/${postId}/comments/${commentId}`
      : `posts/${postId}`;
    const contentSnap = await db.doc(contentPath).get();
    if (!contentSnap.exists) throw new HttpsError("not-found", "対象が見つかりません");
    const contentData = contentSnap.data()!;

    // 既に反故なら裁けない
    if (contentData.hogo) throw new HttpsError("already-exists", "既に反故になっています");

    // 著者を特定
    const authorPath = isComment
      ? `posts/${postId}/comments/${commentId}/private/author`
      : `posts/${postId}/private/author`;
    const authorSnap = await db.doc(authorPath).get();
    if (!authorSnap.exists) throw new HttpsError("not-found", "著者情報が見つかりません");
    const authorId = authorSnap.data()!.authorId;

    // 歌会情報取得
    const groupSnap = await db.doc(`groups/${groupId}`).get();
    if (!groupSnap.exists) throw new HttpsError("not-found", "歌会が見つかりません");
    const groupName = groupSnap.data()!.name || "";

    // 著者のメンバー情報取得
    const authorMemberSnap = await db.doc(`groups/${groupId}/members/${authorId}`).get();
    const currentCautionCount = authorMemberSnap.data()?.cautionCount || 0;

    const hogoReason = (reason?.trim() || "仔細あり").slice(0, 50);
    let effectiveType = type;

    // 戒告の場合、カウント確認
    if (type === "caution") {
      const newCount = currentCautionCount + 1;
      if (newCount >= 3) {
        effectiveType = "ban"; // 3回目の戒告で自動破門
      }
      // cautionCount を更新（メンバーがまだ存在する場合）
      if (authorMemberSnap.exists) {
        await db.doc(`groups/${groupId}/members/${authorId}`).update({
          cautionCount: newCount,
        });
      }
    }

    // コンテンツを反故にする（bodyを消去）
    await db.doc(contentPath).update({
      hogo: true,
      hogoReason,
      hogoType: type, // 元の裁きタイプを記録
      body: "",
    });

    // 元の本文を通知用に保存
    const originalBody = isComment ? contentData.body : contentData.body;

    if (effectiveType === "ban") {
      // 破門処理
      const authorUserSnap = await db.doc(`users/${authorId}`).get();
      const authorData = authorMemberSnap.exists ? authorMemberSnap.data()! : null;
      const bannedDisplayName = authorData?.displayName || "名無し";
      const bannedUserCode = authorData?.userCode || authorUserSnap.data()?.userCode || "---";
      const bannedUserName = `${bannedDisplayName}#${bannedUserCode}`;

      if (authorId === request.auth.uid) {
        // オーナーが自身を破門 → 歌会解散（歌は削除しない）
        const membersSnap = await db.collection(`groups/${groupId}/members`).get();

        // 全メンバーに破門通知を送信（解散前に）
        await Promise.all(
          membersSnap.docs.map((m) =>
            createBanNotification(m.id, {
              postId,
              groupId,
              groupName,
              bannedUserName,
            })
          )
        );

        // メンバー全員の joinedGroups から削除
        for (const memberDoc of membersSnap.docs) {
          await db.doc(`users/${memberDoc.id}`).update({
            joinedGroups: admin.firestore.FieldValue.arrayRemove(groupId),
          });
          await memberDoc.ref.delete();
        }

        // 歌会本体を削除
        await db.doc(`groups/${groupId}`).delete();
      } else {
        // 通常の破門：kickMember と同じ処理
        if (authorMemberSnap.exists) {
          await db.doc(`groups/${groupId}/members/${authorId}`).delete();
          await db.doc(`groups/${groupId}`).update({
            memberCount: admin.firestore.FieldValue.increment(-1),
            [`bannedUsers.${authorId}`]: { displayName: bannedDisplayName, userCode: bannedUserCode },
          });
          await db.doc(`users/${authorId}`).update({
            joinedGroups: admin.firestore.FieldValue.arrayRemove(groupId),
          });
        }

        // 全メンバー + 破門された人に通知
        const membersSnap = await db.collection(`groups/${groupId}/members`).get();
        const notifyTargets = [...membersSnap.docs.map((m) => m.id), authorId];
        const uniqueTargets = [...new Set(notifyTargets)];
        await Promise.all(
          uniqueTargets.map((uid) =>
            createBanNotification(uid, {
              postId,
              groupId,
              groupName,
              bannedUserName,
            })
          )
        );
      }
    } else {
      // 戒告のみ（破門に至らず）
      const newCount = currentCautionCount + 1;
      await createCautionNotification(authorId, {
        postId,
        groupId,
        groupName,
        tankaBody: originalBody || "",
        cautionCount: newCount,
      });
    }

    // 破門時はユーザー名を返す（オーナーへの表示用）
    const resultBannedUserName = effectiveType === "ban"
      ? `${(authorMemberSnap.exists ? authorMemberSnap.data()?.displayName : null) || "名無し"}#${(authorMemberSnap.exists ? authorMemberSnap.data()?.userCode : null) || "---"}`
      : undefined;
    return { success: true, effectiveType, bannedUserName: resultBannedUserName };
  }
);

// 戒告の通知（本人のみ）
async function createCautionNotification(
  targetUserId: string,
  data: { postId: string; groupId: string; groupName: string; tankaBody: string; cautionCount: number }
) {
  const userSnap = await db.doc(`users/${targetUserId}`).get();
  const userData = userSnap.data();
  if (!userData) return;

  const settings = userData.notificationSettings || {};
  if (settings.other === false) return;

  // FCM送信
  const fcmToken = userData?.fcmToken;
  if (fcmToken) {
    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: `${data.groupName}で戒告されました（${data.cautionCount}/3）`,
          body: truncate(data.tankaBody, 50),
        },
        android: {
          notification: {
            channelId: "other",
            visibility: "private" as const,
          },
        },
        data: { postId: data.postId, groupId: data.groupId, type: "caution" },
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

  // たよりdoc作成
  await db.collection(`users/${targetUserId}/notifications`).add({
    type: "caution",
    postId: data.postId,
    groupId: data.groupId,
    groupName: data.groupName,
    tankaBody: data.tankaBody,
    cautionCount: data.cautionCount,
    createdAt: admin.firestore.Timestamp.now(),
  });
}

// 破門の通知（全員に）
async function createBanNotification(
  targetUserId: string,
  data: { postId: string; groupId: string; groupName: string; bannedUserName: string }
) {
  const userSnap = await db.doc(`users/${targetUserId}`).get();
  const userData = userSnap.data();
  if (!userData) return;

  const settings = userData.notificationSettings || {};
  if (settings.other === false) return;

  // FCM送信
  const fcmToken = userData?.fcmToken;
  if (fcmToken) {
    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: `${data.groupName}にて事変が発生しました`,
          body: `${data.bannedUserName}が破門されました`,
        },
        android: {
          notification: {
            channelId: "other",
            visibility: "private" as const,
          },
        },
        data: { postId: data.postId, groupId: data.groupId, type: "ban" },
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

  // たよりdoc作成
  await db.collection(`users/${targetUserId}/notifications`).add({
    type: "ban",
    postId: data.postId,
    groupId: data.groupId,
    groupName: data.groupName,
    tankaBody: "",
    bannedUserName: data.bannedUserName,
    createdAt: admin.firestore.Timestamp.now(),
  });
}

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

/**
 * revealAuthor — 解題（作者名の開示）
 */
export const revealAuthor = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const { postId } = request.data;
    if (!postId) throw new HttpsError("invalid-argument", "postId が必要です");

    // 著者確認
    const authorSnap = await db.doc(`posts/${postId}/private/author`).get();
    if (!authorSnap.exists) throw new HttpsError("not-found", "投稿が見つかりません");
    const authorId = authorSnap.data()?.authorId;
    if (request.auth.uid !== authorId) throw new HttpsError("permission-denied", "自分の歌のみ解題できます");

    // 投稿データ取得
    const postSnap = await db.doc(`posts/${postId}`).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "投稿が見つかりません");
    const postData = postSnap.data()!;
    if (postData.revealedAuthorName) throw new HttpsError("already-exists", "既に解題されています");

    // 表示名を取得
    const memberSnap = await db.doc(`groups/${postData.groupId}/members/${authorId}`).get();
    const displayName = memberSnap.data()?.displayName || "名無し";
    const userCode = memberSnap.data()?.userCode || "---";

    await db.doc(`posts/${postId}`).update({
      revealedAuthorName: displayName,
      revealedAuthorCode: userCode,
    });

    return { success: true };
  }
);

/**
 * deleteAccount — ユーザーデータ全消去「消息を絶つ」
 */
export const deleteAccount = onCall(
  { region: "asia-northeast1", timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const uid = request.auth.uid;

    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) throw new HttpsError("not-found", "ユーザーが見つかりません");
    const joinedGroups: string[] = userSnap.data()?.joinedGroups || [];

    // 1. 所有歌会をソフト解散（通知なし、投稿は残す）
    const ownedSnap = await db.collection("groups").where("createdBy", "==", uid).get();
    for (const groupDoc of ownedSnap.docs) {
      const groupId = groupDoc.id;
      try {
        const membersSnap = await db.collection(`groups/${groupId}/members`).get();
        for (const memberDoc of membersSnap.docs) {
          const memberId = memberDoc.id;
          await db.doc(`users/${memberId}`).update({
            joinedGroups: admin.firestore.FieldValue.arrayRemove(groupId),
          }).catch(() => {});
          await memberDoc.ref.delete();
        }
        await groupDoc.ref.delete();
        // グループのレートリミット削除
        const groupDailySnap = await db.collection(`rateLimits/group_${groupId}/daily`).get();
        if (groupDailySnap.size > 0) {
          const b = db.batch();
          groupDailySnap.docs.forEach((d) => b.delete(d.ref));
          b.delete(db.doc(`rateLimits/group_${groupId}`));
          await b.commit();
        }
      } catch {
        // 個別の歌会解散失敗は続行
      }
    }

    // 2. 他の参加歌会から脱退
    for (const groupId of joinedGroups) {
      try {
        const memberRef = db.doc(`groups/${groupId}/members/${uid}`);
        const memberSnap = await memberRef.get();
        if (memberSnap.exists) {
          await memberRef.delete();
          await db.doc(`groups/${groupId}`).update({
            memberCount: admin.firestore.FieldValue.increment(-1),
          }).catch(() => {});
        }
      } catch {
        // 歌会が既に存在しない場合など
      }
    }

    // 3. ユーザーの投稿を全削除
    const myPostsSnap = await db.collection(`users/${uid}/myPosts`).get();
    const deletedPostIds = new Set<string>();
    for (const myPost of myPostsSnap.docs) {
      const postId = myPost.data().postId;
      if (deletedPostIds.has(postId)) continue;
      deletedPostIds.add(postId);
      try {
        // リアクション削除
        const reactionsSnap = await db.collection(`posts/${postId}/reactions`).get();
        const rBatch = db.batch();
        reactionsSnap.docs.forEach((d) => rBatch.delete(d.ref));
        if (reactionsSnap.size > 0) await rBatch.commit();

        // コメント削除
        const commentsSnap = await db.collection(`posts/${postId}/comments`).get();
        for (const commentDoc of commentsSnap.docs) {
          const privSnap = await db.collection(`posts/${postId}/comments/${commentDoc.id}/private`).get();
          const cBatch = db.batch();
          privSnap.docs.forEach((d) => cBatch.delete(d.ref));
          cBatch.delete(commentDoc.ref);
          await cBatch.commit();
        }

        // 投稿本体削除
        await db.doc(`posts/${postId}/private/author`).delete().catch(() => {});
        await db.doc(`posts/${postId}`).delete();
      } catch {
        // 個別の投稿削除失敗は続行
      }
    }

    // 4. ユーザーの評を全削除（collectionGroupでauthor検索）
    try {
      const authorSnap = await db.collectionGroup("author")
        .where("authorId", "==", uid).get();
      for (const authorDoc of authorSnap.docs) {
        const path = authorDoc.ref.path;
        // comments内のauthorのみ処理（投稿のauthorはステップ3で処理済み）
        if (!path.includes("/comments/")) continue;
        try {
          // パス: posts/{postId}/comments/{commentId}/private/author
          const parts = path.split("/");
          const postId = parts[1];
          const commentId = parts[3];
          await authorDoc.ref.delete();
          await db.doc(`posts/${postId}/comments/${commentId}`).delete();
          await db.doc(`posts/${postId}`).update({
            commentCount: admin.firestore.FieldValue.increment(-1),
          }).catch(() => {});
        } catch {
          // 個別の評削除失敗は続行
        }
      }
    } catch {
      // collectionGroupクエリ失敗は続行
    }

    // 5. 他ユーザーの投稿へのリアクション削除
    try {
      const reactionsSnap = await db.collectionGroup("reactions")
        .where("userId", "==", uid).get();
      for (const reactionDoc of reactionsSnap.docs) {
        try {
          const emoji = reactionDoc.data().emoji;
          // パス: posts/{postId}/reactions/{reactionId}
          const postId = reactionDoc.ref.parent.parent?.id;
          await reactionDoc.ref.delete();
          if (postId && emoji) {
            const postRef = db.doc(`posts/${postId}`);
            const postSnap = await postRef.get();
            if (postSnap.exists) {
              const current = postSnap.data()?.reactionSummary?.[emoji] || 0;
              if (current > 0) {
                await postRef.update({
                  [`reactionSummary.${emoji}`]: Math.max(0, current - 1),
                });
              }
            }
          }
        } catch {
          // 個別のリアクション削除失敗は続行
        }
      }
    } catch {
      // collectionGroupクエリ失敗は続行
    }

    // 6. サブコレクション削除
    const subcollections = ["myPosts", "bookmarks", "notifications"];
    for (const sub of subcollections) {
      const snap = await db.collection(`users/${uid}/${sub}`).get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      if (snap.size > 0) await batch.commit();
    }

    // 7. レートリミット削除
    try {
      const dailySnap = await db.collection(`rateLimits/${uid}/daily`).get();
      const rlBatch = db.batch();
      dailySnap.docs.forEach((d) => rlBatch.delete(d.ref));
      rlBatch.delete(db.doc(`rateLimits/${uid}`));
      await rlBatch.commit();
    } catch {
      // rateLimitsが存在しない場合
    }

    // 8. ユーザードキュメント削除
    await db.doc(`users/${uid}`).delete();

    // 9. Firebase Auth ユーザー削除
    await admin.auth().deleteUser(uid);

    return { success: true };
  }
);

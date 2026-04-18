import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { moderate, OPENAI_API_KEY } from "./moderation/openaiModeration";
import { deriveAuthorHandle, AUTHOR_HANDLE_SALT } from "./moderation/authorHandle";
import {
  assertString,
  assertOptionalString,
  assertEnum,
  assertOptionalBoolean,
  assertDocId,
  assertOptionalDocId,
  truncate,
  todayKey as _todayKeyPure,
} from "./validation";

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
    commentId?: string; // comment 通知の場合、削除検知用に保存
    actorHandle?: string; // 投稿者/リアクター/コメント者の authorHandle（ブロック判定用、保存はしない）
  }
) {
  const userSnap = await db.doc(`users/${targetUserId}`).get();
  const userData = userSnap.data();
  if (!userData) return;

  const settings = userData.notificationSettings || {};
  if (type === "new_post" && !settings.newPost) return;
  if (type === "reaction" && !settings.reaction) return;
  if (type === "comment" && !settings.comment) return;

  // ブロック関係チェック：相手（actor）との間に双方向のいずれかのブロックがあれば通知しない
  if (data.actorHandle) {
    const blocked = (userData.blockedHandles as Record<string, unknown> | undefined) || {};
    const blockedBy = (userData.blockedByHandles as Record<string, unknown> | undefined) || {};
    if (blocked[data.actorHandle] || blockedBy[data.actorHandle]) {
      return;
    }
  }
  // actorHandle はクライアントに見せる情報ではないので保存データから除外
  const { actorHandle: _omit, ...persistData } = data;
  void _omit;

  // FCM送信（毎回）
  const fcmToken = userData.fcmToken;
  if (fcmToken) {
    let title = "";
    let body = "";
    let channelId = "";
    switch (type) {
      case "new_post":
        title = `${data.groupName}で歌が詠まれました`;
        body = data.tankaBody;
        channelId = "new-tanka";
        break;
      case "reaction":
        title = `あなたの歌に${data.emoji || "🌸"}が贈られました`;
        body = data.tankaBody;
        channelId = "reactions";
        break;
      case "comment":
        title = "あなたの歌に評が寄せられました";
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
        ...persistData,
        reactionCount: 1,
        createdAt: admin.firestore.Timestamp.now(),
      });
    }
  } else {
    await db.collection(`users/${targetUserId}/notifications`).add({
      type,
      ...persistData,
      createdAt: admin.firestore.Timestamp.now(),
    });
  }
}

// ===== 通知の状態書き換え =====
// 反故/削除が起きたとき、該当する投稿/評について既に配信済みの通知ドキュメントを
// 「本文を見せない」状態に書き換える（履歴は残す）。
// 対象タイプは new_post / reaction / comment のみ（caution/ban 等は残す）。

type TargetState = "hogo" | "deleted";

// 投稿（post）が反故/削除されたときに、歌を参照する通知（new_post / reaction）を書き換える。
// comment 型通知の tankaBody は「評が付いた歌」を示すものなので、
// ここでは触らない（評自体は独立に生存するため）。
async function markNotificationsForPost(
  postId: string,
  state: TargetState,
  hogoReason?: string
) {
  const snap = await db
    .collectionGroup("notifications")
    .where("postId", "==", postId)
    .get();

  const updates: Record<string, unknown> = {
    targetState: state,
    tankaBody: "",
  };
  if (state === "hogo") updates.targetHogoReason = hogoReason || "仔細あり";

  const batchSize = 400;
  for (let i = 0; i < snap.docs.length; i += batchSize) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + batchSize)) {
      const t = d.data()?.type;
      if (t !== "new_post" && t !== "reaction") continue;
      batch.update(d.ref, updates);
    }
    await batch.commit();
  }
}

// 評（comment）が反故/削除されたときに、comment 型通知の commentBody を書き換える。
async function markNotificationsForComment(
  commentId: string,
  state: TargetState,
  hogoReason?: string
) {
  const snap = await db
    .collectionGroup("notifications")
    .where("commentId", "==", commentId)
    .get();

  const updates: Record<string, unknown> = {
    targetState: state,
    commentBody: "",
  };
  if (state === "hogo") updates.targetHogoReason = hogoReason || "仔細あり";

  const batchSize = 400;
  for (let i = 0; i < snap.docs.length; i += batchSize) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + batchSize)) {
      if (d.data()?.type !== "comment") continue;
      batch.update(d.ref, updates);
    }
    await batch.commit();
  }
}

// pending 解除時に通知の書き換えを戻す（tankaBody を復元＋状態フラグ削除）。
async function unmarkNotificationsForPost(
  postId: string,
  restoredTankaBody: string
) {
  const snap = await db
    .collectionGroup("notifications")
    .where("postId", "==", postId)
    .get();

  const batchSize = 400;
  for (let i = 0; i < snap.docs.length; i += batchSize) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + batchSize)) {
      const t = d.data()?.type;
      if (t !== "new_post" && t !== "reaction") continue;
      batch.update(d.ref, {
        tankaBody: restoredTankaBody,
        targetState: admin.firestore.FieldValue.delete(),
        targetHogoReason: admin.firestore.FieldValue.delete(),
      });
    }
    await batch.commit();
  }
}

async function unmarkNotificationsForComment(
  commentId: string,
  restoredCommentBody: string
) {
  const snap = await db
    .collectionGroup("notifications")
    .where("commentId", "==", commentId)
    .get();

  const batchSize = 400;
  for (let i = 0; i < snap.docs.length; i += batchSize) {
    const batch = db.batch();
    for (const d of snap.docs.slice(i, i + batchSize)) {
      if (d.data()?.type !== "comment") continue;
      batch.update(d.ref, {
        commentBody: restoredCommentBody,
        targetState: admin.firestore.FieldValue.delete(),
        targetHogoReason: admin.firestore.FieldValue.delete(),
      });
    }
    await batch.commit();
  }
}

// ===== レートリミット付き作成 =====

const todayKey = () => _todayKeyPure();

/**
 * createPost — 歌の投稿（レートリミット付き）
 */
export const createPost = onCall(
  { region: "asia-northeast1", secrets: [OPENAI_API_KEY, AUTHOR_HANDLE_SALT] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const uid = request.auth.uid;
    const groupId = assertDocId(request.data?.groupId, "groupId");
    const body = assertString(request.data?.body, "body", { min: 2, max: 50 });
    const batchId = assertOptionalString(request.data?.batchId, "batchId", { max: 64 });
    const convertHalfSpace = assertOptionalBoolean(request.data?.convertHalfSpace, "convertHalfSpace", false);
    const convertLineBreak = assertOptionalBoolean(request.data?.convertLineBreak, "convertLineBreak", false);
    const trimmed = body.trim();
    if (trimmed.length < 2) throw new HttpsError("invalid-argument", "歌は2〜50文字で入力してください");

    // メンバーシップ確認
    const memberSnap = await db.doc(`groups/${groupId}/members/${uid}`).get();
    if (!memberSnap.exists) throw new HttpsError("permission-denied", "この歌会のメンバーではありません");

    // グループ名・公開状態を取得
    const groupSnap = await db.doc(`groups/${groupId}`).get();
    const groupData = groupSnap.data();
    const groupName = groupData?.name || "";

    // 公開歌会の場合は kill switch を確認
    if (groupData?.isPublic === true) {
      const cfgSnap = await db.doc("config/publicGroups").get();
      if (cfgSnap.exists && cfgSnap.data()?.enabled === false) {
        throw new HttpsError("failed-precondition", "公開歌会への投稿は現在停止しています");
      }
    }

    // 事前モデレーション（Fail-open）
    const mod = await moderate(trimmed);
    if (!mod.ok) {
      throw new HttpsError("failed-precondition", "この内容は投稿できません。表現をお確かめください。");
    }

    const authorHandle = deriveAuthorHandle(uid);
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
        authorHandle,
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

      // 歌会の最終投稿時刻と累計投稿数を更新。
      // lastPostsByHandle は "handle → その人の最終投稿時刻" のマップで、
      // クライアント側でブロック関係を除外した未読判定に使う。
      tx.update(db.doc(`groups/${groupId}`), {
        lastPostAt: admin.firestore.FieldValue.serverTimestamp(),
        [`lastPostsByHandle.${authorHandle}`]: admin.firestore.FieldValue.serverTimestamp(),
        postCount: admin.firestore.FieldValue.increment(1),
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
  { region: "asia-northeast1", secrets: [OPENAI_API_KEY, AUTHOR_HANDLE_SALT] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const uid = request.auth.uid;
    const postId = assertDocId(request.data?.postId, "postId");
    const body = assertString(request.data?.body, "body", { min: 1, max: 500 });
    const trimmed = body.trim();
    if (trimmed.length < 1) throw new HttpsError("invalid-argument", "評は1〜500文字で入力してください");

    // 投稿の存在とメンバーシップ確認
    const postSnap = await db.doc(`posts/${postId}`).get();
    if (!postSnap.exists) throw new HttpsError("not-found", "投稿が見つかりません");
    const groupId = postSnap.data()?.groupId;
    const memberSnap = await db.doc(`groups/${groupId}/members/${uid}`).get();
    if (!memberSnap.exists) throw new HttpsError("permission-denied", "この歌会のメンバーではありません");

    // ブロック関係チェック（双方向）：投稿者とコメント者のどちらかが相手をブロック中なら拒否
    const authorSnap = await db.doc(`posts/${postId}/private/author`).get();
    const postAuthorId = authorSnap.data()?.authorId as string | undefined;
    if (postAuthorId && postAuthorId !== uid) {
      const myHandle = deriveAuthorHandle(uid);
      const authorHandleForBlock = deriveAuthorHandle(postAuthorId);
      const [myUserSnap, authorUserSnap] = await Promise.all([
        db.doc(`users/${uid}`).get(),
        db.doc(`users/${postAuthorId}`).get(),
      ]);
      const iBlockedAuthor = !!(myUserSnap.data()?.blockedHandles || {})[authorHandleForBlock];
      const authorBlockedMe = !!(authorUserSnap.data()?.blockedHandles || {})[myHandle];
      if (iBlockedAuthor || authorBlockedMe) {
        throw new HttpsError("permission-denied", "この歌には評を送れません");
      }
    }

    // 公開歌会の場合は kill switch を確認
    const groupSnap = await db.doc(`groups/${groupId}`).get();
    if (groupSnap.data()?.isPublic === true) {
      const cfgSnap = await db.doc("config/publicGroups").get();
      if (cfgSnap.exists && cfgSnap.data()?.enabled === false) {
        throw new HttpsError("failed-precondition", "公開歌会への投稿は現在停止しています");
      }
    }

    // 事前モデレーション（Fail-open）
    const mod = await moderate(trimmed);
    if (!mod.ok) {
      throw new HttpsError("failed-precondition", "この内容は投稿できません。表現をお確かめください。");
    }

    const authorHandle = deriveAuthorHandle(uid);
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
        authorHandle,
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
    const groupName = assertString(request.data?.groupName, "groupName", { max: 16 });
    const displayName = assertString(request.data?.displayName, "displayName", { max: 16 });
    const isPublic = assertOptionalBoolean(request.data?.isPublic, "isPublic", false);
    if (groupName.trim().length < 1) throw new HttpsError("invalid-argument", "歌会名を入力してください");
    if (displayName.trim().length < 1) throw new HttpsError("invalid-argument", "表示名を入力してください");

    // 公開歌会固有のチェック
    let trimmedPurpose = "";
    if (isPublic) {
      // 設定読み込み（kill switch ＋ 経過日数しきい値）
      const configSnap = await db.doc("config/publicGroups").get();
      const configData = configSnap.exists ? configSnap.data() : {};
      if (configData?.enabled === false) {
        throw new HttpsError("failed-precondition", "公開歌会の作成は現在停止しています");
      }

      // 趣意書チェック
      const purpose = assertString(request.data?.purpose, "purpose", { min: 10, max: 200 });
      trimmedPurpose = purpose.trim();
      if (trimmedPurpose.length < 10) {
        throw new HttpsError("invalid-argument", "趣意書は10〜200文字で入力してください");
      }
      // URL や HTML タグを含まない
      if (/https?:\/\//i.test(trimmedPurpose) || /<[^>]+>/.test(trimmedPurpose)) {
        throw new HttpsError("invalid-argument", "趣意書にURLやHTMLタグは使えません");
      }

      // アカウント作成からの経過日数要件（既定7日、config で上書き可能）
      const minAgeDays = typeof configData?.minAccountAgeDays === "number"
        ? configData.minAccountAgeDays
        : 7;
      if (minAgeDays > 0) {
        const userRecord = await admin.auth().getUser(uid);
        const creationTimeMs = new Date(userRecord.metadata.creationTime).getTime();
        const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;
        if (Date.now() - creationTimeMs < minAgeMs) {
          throw new HttpsError("failed-precondition", `公開歌会の作成はアカウント作成から${minAgeDays}日後以降に可能になります`);
        }
      }

      // 自分が作成した公開歌会は最大3つ
      const publicOwnedSnap = await db.collection("groups")
        .where("createdBy", "==", uid).where("isPublic", "==", true).count().get();
      if (publicOwnedSnap.data().count >= 3) {
        throw new HttpsError("resource-exhausted", "公開歌会は1人につき3つまで作成できます");
      }
    }

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
    const groupData: Record<string, unknown> = {
      name: groupName.trim(), inviteCode, memberCount: 1,
      createdBy: uid, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      isPublic, postCount: 0,
      ownerDisplayName: displayName.trim(),
      ownerUserCode: userCode,
    };
    if (isPublic) {
      groupData.purpose = trimmedPurpose;
    }
    batch.set(groupRef, groupData);
    batch.set(db.doc(`groups/${groupRef.id}/members/${uid}`), {
      displayName: displayName.trim(), userCode,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(), role: "owner",
    });
    batch.update(db.doc(`users/${uid}`), {
      joinedGroups: admin.firestore.FieldValue.arrayUnion(groupRef.id),
    });
    await batch.commit();

    return { groupId: groupRef.id, inviteCode, isPublic };
  }
);

/**
 * getPublicGroupPreview — 公開歌会のプレビュー情報と最新10首を取得
 * 非メンバーでも呼べる。isPublic===true のグループのみ。
 */
export const getPublicGroupPreview = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const uid = request.auth.uid;
    const groupId = assertDocId(request.data?.groupId, "groupId");

    // Kill switch
    const cfgSnap = await db.doc("config/publicGroups").get();
    if (cfgSnap.exists && cfgSnap.data()?.enabled === false) {
      throw new HttpsError("failed-precondition", "公開歌会は現在停止しています");
    }

    // レート制限: 60回/日
    const today = todayKey();
    const counterRef = db.doc(`rateLimits/${uid}/daily/${today}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(counterRef);
      const count = snap.data()?.previewCount || 0;
      if (count >= 60) throw new HttpsError("resource-exhausted", "本日のプレビュー上限に達しました");
      tx.set(counterRef, { previewCount: count + 1 }, { merge: true });
    });

    // 歌会取得
    const groupSnap = await db.doc(`groups/${groupId}`).get();
    if (!groupSnap.exists) throw new HttpsError("not-found", "歌会が見つかりません");
    const groupData = groupSnap.data()!;
    if (groupData.isPublic !== true) throw new HttpsError("permission-denied", "この歌会は公開されていません");

    // 最新10首
    const postsSnap = await db.collection("posts")
      .where("groupId", "==", groupId)
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();
    const posts = postsSnap.docs.map((d) => {
      const p = d.data();
      return {
        postId: d.id,
        body: p.hogo ? "" : p.body,
        hogo: p.hogo || false,
        convertHalfSpace: p.convertHalfSpace ?? true,
        convertLineBreak: p.convertLineBreak ?? true,
        createdAt: p.createdAt?.toMillis?.() || null,
        batchId: p.batchId || null,
      };
    });

    // 自分のメンバーシップ / 追放状態
    const memberSnap = await db.doc(`groups/${groupId}/members/${uid}`).get();
    const alreadyMember = memberSnap.exists;
    const banned = !!(groupData.bannedUsers && uid in groupData.bannedUsers);

    // オーナー情報は GroupDoc の非正規化フィールドから。古いドキュメントにはフィールドが
    // 無い可能性があるので、その場合のみ members コレクションから拾う。
    let ownerDisplayName: string = groupData.ownerDisplayName || "";
    let ownerUserCode: string = groupData.ownerUserCode || "";
    if ((!ownerDisplayName || !ownerUserCode) && groupData.createdBy) {
      const ownerSnap = await db.doc(`groups/${groupId}/members/${groupData.createdBy}`).get();
      if (ownerSnap.exists) {
        ownerDisplayName = ownerSnap.data()?.displayName || ownerDisplayName;
        ownerUserCode = ownerSnap.data()?.userCode || ownerUserCode;
      }
    }

    return {
      group: {
        id: groupId,
        name: groupData.name,
        purpose: groupData.purpose || "",
        memberCount: groupData.memberCount || 0,
        postCount: groupData.postCount || 0,
      },
      owner: ownerDisplayName ? { displayName: ownerDisplayName, userCode: ownerUserCode } : null,
      posts,
      alreadyMember,
      banned,
      full: (groupData.memberCount || 0) >= 500,
    };
  }
);

/**
 * updatePurpose — 公開歌会の趣意書をオーナーが更新
 */
export const updatePurpose = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const uid = request.auth.uid;
    const groupId = assertDocId(request.data?.groupId, "groupId");
    const purpose = assertString(request.data?.purpose, "purpose", { min: 10, max: 200 });
    const trimmed = purpose.trim();
    if (trimmed.length < 10) {
      throw new HttpsError("invalid-argument", "趣意書は10〜200文字で入力してください");
    }
    if (/https?:\/\//i.test(trimmed) || /<[^>]+>/.test(trimmed)) {
      throw new HttpsError("invalid-argument", "趣意書にURLやHTMLタグは使えません");
    }

    const memberSnap = await db.doc(`groups/${groupId}/members/${uid}`).get();
    if (!memberSnap.exists || memberSnap.data()?.role !== "owner") {
      throw new HttpsError("permission-denied", "この歌会のオーナーのみが趣意書を編集できます");
    }
    const groupSnap = await db.doc(`groups/${groupId}`).get();
    if (!groupSnap.exists || groupSnap.data()?.isPublic !== true) {
      throw new HttpsError("failed-precondition", "公開歌会のみ趣意書を設定できます");
    }

    await db.doc(`groups/${groupId}`).update({ purpose: trimmed });
    return { ok: true };
  }
);

// ===== 通知トリガー =====

/**
 * onNewPost — 新しい歌が投稿されたとき、歌会メンバーに通知
 * private/author の作成をトリガーにすることで、post本体が確実に存在する
 */
export const onNewPost = onDocumentCreated(
  { document: "posts/{postId}/private/author", region: "asia-northeast1", secrets: [AUTHOR_HANDLE_SALT] },
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
    const actorHandle = deriveAuthorHandle(authorId);
    await Promise.all(
      membersSnap.docs
        .filter((m) => m.id !== authorId && !m.data()?.muted)
        .map((m) =>
          createNotification(m.id, "new_post", {
            postId,
            groupId: post.groupId,
            groupName,
            tankaBody: post.body,
            actorHandle,
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
    secrets: [AUTHOR_HANDLE_SALT],
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

    // ミュートチェック
    const memberSnap = await db.doc(`groups/${post.groupId}/members/${authorId}`).get();
    if (memberSnap.data()?.muted) return;

    await createNotification(authorId, "reaction", {
      postId,
      groupId: post.groupId,
      groupName,
      tankaBody: post.body,
      emoji: reactionData.emoji,
      actorHandle: deriveAuthorHandle(reactionData.userId),
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
    secrets: [AUTHOR_HANDLE_SALT],
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

    // ミュートチェック
    const memberSnap = await db.doc(`groups/${post.groupId}/members/${postAuthorId}`).get();
    if (memberSnap.data()?.muted) return;

    await createNotification(postAuthorId, "comment", {
      postId,
      commentId,
      groupId: post.groupId,
      groupName,
      tankaBody: post.body,
      commentBody,
      actorHandle: deriveAuthorHandle(commentAuthorId),
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
    const postId = assertDocId(request.data?.postId, "postId");

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
    const postId = assertDocId(request.data?.postId, "postId");

    const authorSnap = await db.doc(`posts/${postId}/private/author`).get();
    if (!authorSnap.exists) throw new HttpsError("not-found", "投稿が見つかりません");
    const authorId = authorSnap.data()?.authorId;
    if (request.auth.uid !== authorId) throw new HttpsError("permission-denied", "自分の投稿のみ削除できます");

    // 歌会の postCount を減らすため groupId を先に取得
    const postSnap = await db.doc(`posts/${postId}`).get();
    const groupId = postSnap.data()?.groupId;

    const batch = db.batch();
    const reactionsSnap = await db.collection(`posts/${postId}/reactions`).get();
    reactionsSnap.docs.forEach((doc) => batch.delete(doc.ref));
    const commentsSnap = await db.collection(`posts/${postId}/comments`).get();
    for (const commentDoc of commentsSnap.docs) {
      const privateSnap = await db.collection(`posts/${postId}/comments/${commentDoc.id}/private`).get();
      privateSnap.docs.forEach((doc) => batch.delete(doc.ref));
      batch.delete(commentDoc.ref);
    }
    // private サブコレクション全体を削除（author + archivedBody 等、今後追加されるものも含む）
    const postPrivateSnap = await db.collection(`posts/${postId}/private`).get();
    postPrivateSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(db.doc(`posts/${postId}`));
    // 歌会の累計投稿数をデクリメント（歌会がまだ存在する場合のみ）
    if (groupId) {
      const groupSnap = await db.doc(`groups/${groupId}`).get();
      if (groupSnap.exists) {
        batch.update(db.doc(`groups/${groupId}`), {
          postCount: admin.firestore.FieldValue.increment(-1),
        });
      }
    }
    // レートリミット (rateLimits/.../daily/*.postCount) は意図的に減算しない。
    // 削除→再投稿で日次上限を回復できると abuse ループ（spam → 削除 → spam）を
    // 許してしまうため、「創作行為のペース」は createしか累積しない設計。
    await batch.commit();

    // たより（通知）の本文を「削除済み」に書き換え（履歴は残す）
    try {
      await markNotificationsForPost(postId, "deleted");
    } catch (e) {
      console.error("[deletePost] mark notifications failed", e);
    }

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
    const postId = assertDocId(request.data?.postId, "postId");
    const commentId = assertDocId(request.data?.commentId, "commentId");

    const authorSnap = await db.doc(`posts/${postId}/comments/${commentId}/private/author`).get();
    if (!authorSnap.exists) throw new HttpsError("not-found", "評が見つかりません");
    if (request.auth.uid !== authorSnap.data()?.authorId) {
      throw new HttpsError("permission-denied", "自分の評のみ削除できます");
    }

    // 原子的に削除＋表示カウンタ減算（batch は全成功か全失敗）。
    // なお rateLimits/...daily.commentCount は意図的に減算しない（abuse 防止）。
    const batch = db.batch();
    batch.delete(db.doc(`posts/${postId}/comments/${commentId}/private/author`));
    batch.delete(db.doc(`posts/${postId}/comments/${commentId}`));
    batch.update(db.doc(`posts/${postId}`), {
      commentCount: admin.firestore.FieldValue.increment(-1),
    });
    await batch.commit();

    // たより通知の本文を「削除済み」に書き換え
    try {
      await markNotificationsForComment(commentId, "deleted");
    } catch (e) {
      console.error("[deleteComment] mark notifications failed", e);
    }

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
    const groupId = assertDocId(request.data?.groupId, "groupId");
    const confirmName = assertString(request.data?.confirmName, "confirmName", { max: 64 });
    const deletePosts = assertOptionalBoolean(request.data?.deletePosts, "deletePosts", false);

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
      if (memberDoc.data()?.muted) continue;
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
    const groupId = assertDocId(request.data?.groupId, "groupId");
    const targetUserId = assertDocId(request.data?.targetUserId, "targetUserId");

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
    const groupId = assertDocId(request.data?.groupId, "groupId");
    const postId = assertDocId(request.data?.postId, "postId");
    const commentId = assertOptionalDocId(request.data?.commentId, "commentId");
    const type = assertEnum(request.data?.type, ["caution", "ban"] as const, "type");
    const reason = assertOptionalString(request.data?.reason, "reason", { max: 50 }) ?? "";

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

    // 既に反故なら裁けない（ただし pending からの昇格は許可）
    if (contentData.hogo && contentData.hogoType !== "pending") {
      throw new HttpsError("already-exists", "既に反故になっています");
    }

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

    // コンテンツを反故にする（bodyを退避＋消去）
    // 既に pending から昇格する場合は archivedBody が存在するはず。無ければ今作成。
    const archivedRef = db.doc(`${contentPath}/private/archivedBody`);
    const archivedSnap = await archivedRef.get();
    if (!archivedSnap.exists) {
      const currentBody = (contentData.body as string) || "";
      await archivedRef.set({
        body: currentBody,
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await db.doc(contentPath).update({
      hogo: true,
      hogoReason,
      hogoType: type, // 元の裁きタイプを記録
      body: "",
    });

    // たより通知の本文を「反故」に書き換え
    try {
      if (isComment) {
        await markNotificationsForComment(commentId!, "hogo", hogoReason);
      } else {
        await markNotificationsForPost(postId, "hogo", hogoReason);
      }
    } catch (e) {
      console.error("[judgeContent] mark notifications failed", e);
    }

    // 関連 reports を resolved にマーク（pending からの昇格ケースも含む）
    try {
      const reportTargetId = isComment ? commentId! : postId;
      const reportsSnap = await db
        .collection("reports")
        .where("targetId", "==", reportTargetId)
        .where("status", "==", "pending")
        .get();
      if (!reportsSnap.empty) {
        const batch = db.batch();
        reportsSnap.docs.forEach((d) => batch.update(d.ref, { status: "resolved" }));
        await batch.commit();
      }
    } catch (e) {
      console.error("[judgeContent] resolve reports failed", e);
    }

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
  // ミュートチェック
  const memberSnap = await db.doc(`groups/${data.groupId}/members/${targetUserId}`).get();
  if (memberSnap.data()?.muted) return;

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
  // ミュートチェック
  const memberSnap = await db.doc(`groups/${data.groupId}/members/${targetUserId}`).get();
  if (memberSnap.data()?.muted) return;

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
    const groupId = assertDocId(request.data?.groupId, "groupId");
    const targetUserId = assertDocId(request.data?.targetUserId, "targetUserId");

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
    const postId = assertDocId(request.data?.postId, "postId");

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
 * deleteAccount — アカウント削除とデータ消去
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
    const deletionsByGroup = new Map<string, number>(); // groupId -> 削除件数
    for (const myPost of myPostsSnap.docs) {
      const postId = myPost.data().postId;
      const postGroupId = myPost.data().groupId;
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

        if (postGroupId) {
          deletionsByGroup.set(postGroupId, (deletionsByGroup.get(postGroupId) || 0) + 1);
        }
      } catch {
        // 個別の投稿削除失敗は続行
      }
    }

    // 3b. 歌会ごとに postCount をまとめて減算（歌会がまだ存在するもののみ）
    for (const [gid, count] of deletionsByGroup) {
      try {
        const gSnap = await db.doc(`groups/${gid}`).get();
        if (gSnap.exists) {
          await db.doc(`groups/${gid}`).update({
            postCount: admin.firestore.FieldValue.increment(-count),
          });
        }
      } catch { /* 歌会が既に消えているなど */ }
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

// ===== 通報（全ユーザー開放） =====

const REPORT_REASONS = ["inappropriate", "spam", "harassment", "other"] as const;
const REPORT_DAILY_LIMIT = 20;
const AUTO_PENDING_THRESHOLD = 2;

/**
 * reportContent — 全ユーザーからの通報
 *  - 同一投稿への重複通報禁止
 *  - 1日 20 件まで
 *  - reason enum 必須
 *  - ユニーク reporter が閾値に達すると自動で hogo=true, hogoType='pending'
 */
export const reportContent = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const uid = request.auth.uid;
    const groupId = assertDocId(request.data?.groupId, "groupId");
    const postId = assertDocId(request.data?.postId, "postId");
    const commentId = assertOptionalDocId(request.data?.commentId, "commentId");
    const reason = assertEnum(request.data?.reason, REPORT_REASONS, "reason");
    const detail = assertOptionalString(request.data?.detail, "detail", { max: 2000 });

    // メンバーシップ確認はしない（閲覧者も通報できる）が、歌会の存在だけは確認
    const groupSnap = await db.doc(`groups/${groupId}`).get();
    if (!groupSnap.exists) throw new HttpsError("not-found", "歌会が見つかりません");

    const targetType: "post" | "comment" = commentId ? "comment" : "post";
    const targetId = commentId || postId;
    const contentPath = commentId
      ? `posts/${postId}/comments/${commentId}`
      : `posts/${postId}`;
    const contentSnap = await db.doc(contentPath).get();
    if (!contentSnap.exists) throw new HttpsError("not-found", "対象が見つかりません");

    // 自投稿は通報できない
    const authorPath = commentId
      ? `posts/${postId}/comments/${commentId}/private/author`
      : `posts/${postId}/private/author`;
    const authorSnap = await db.doc(authorPath).get();
    if (authorSnap.exists && authorSnap.data()?.authorId === uid) {
      throw new HttpsError("failed-precondition", "自分の投稿は通報できません");
    }

    // 重複通報チェック
    const dupSnap = await db
      .collection("reports")
      .where("reporterId", "==", uid)
      .where("targetId", "==", targetId)
      .limit(1)
      .get();
    if (!dupSnap.empty) {
      throw new HttpsError("already-exists", "この投稿は既に通報済みです");
    }

    // detail サニタイズ（other のときのみ）
    let trimmedDetail: string | undefined;
    if (reason === "other" && typeof detail === "string") {
      trimmedDetail = detail
        .trim()
        .replace(/<[^>]+>/g, "")
        .replace(/https?:\/\/\S+/gi, "")
        .slice(0, 500);
    }

    const today = todayKey();
    const reporterRateRef = db.doc(`rateLimits/${uid}/daily/${today}`);
    const reportRef = db.collection("reports").doc();
    const contentRef = db.doc(contentPath);

    // トランザクション: レート制限確認 + reports 作成 + reportCount インクリメント + 閾値到達なら pending 化
    const willBecomePending = await db.runTransaction(async (tx) => {
      const rateSnap = await tx.get(reporterRateRef);
      const reportCount = (rateSnap.data()?.reportCount as number) || 0;
      if (reportCount >= REPORT_DAILY_LIMIT) {
        throw new HttpsError("resource-exhausted", "本日の通報上限に達しました");
      }

      const contentNow = await tx.get(contentRef);
      if (!contentNow.exists) throw new HttpsError("not-found", "対象が見つかりません");
      const currentReportCount = (contentNow.data()?.reportCount as number) || 0;
      const newReportCount = currentReportCount + 1;
      const alreadyHogo = contentNow.data()?.hogo === true;
      const shouldPending = !alreadyHogo && newReportCount >= AUTO_PENDING_THRESHOLD;

      tx.set(reportRef, {
        targetType,
        targetId,
        postId,
        groupId,
        reporterId: uid,
        reason,
        ...(trimmedDetail ? { detail: trimmedDetail } : {}),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "pending",
      });

      // カウンタ更新（既存フィールドを壊さないように merge）
      tx.set(
        reporterRateRef,
        {
          reportCount: reportCount + 1,
          postCount: rateSnap.data()?.postCount || 0,
          commentCount: rateSnap.data()?.commentCount || 0,
        },
        { merge: true }
      );

      const contentUpdate: Record<string, unknown> = {
        reportCount: newReportCount,
      };
      if (shouldPending) {
        // body を原文として退避し、公開 body を空文字化（メンバーには反故プレースホルダのみ見える）
        const originalBody = (contentNow.data()?.body as string) || "";
        tx.set(db.doc(`${contentPath}/private/archivedBody`), {
          body: originalBody,
          archivedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        contentUpdate.body = "";
        contentUpdate.hogo = true;
        contentUpdate.hogoType = "pending";
        contentUpdate.hogoReason = "確認中";
      }
      tx.update(contentRef, contentUpdate);

      return shouldPending;
    });

    // 閾値到達時の後処理（通知書き換え + オーナー通知）
    if (willBecomePending) {
      // たより通知の本文を「反故（確認中）」に書き換え
      try {
        if (commentId) {
          await markNotificationsForComment(commentId, "hogo", "確認中");
        } else {
          await markNotificationsForPost(postId, "hogo", "確認中");
        }
      } catch (e) {
        console.error("[reportContent] mark notifications failed", e);
      }
      try {
        const ownerId = groupSnap.data()?.createdBy as string | undefined;
        if (ownerId) {
          const originalBody =
            (contentSnap.data()?.body as string | undefined) || "";
          await createReportNotification(ownerId, {
            postId,
            commentId,
            groupId,
            groupName: (groupSnap.data()?.name as string) || "",
            tankaBody: truncate(originalBody, 50),
          });
        }
      } catch (e) {
        // 通知失敗は通報成功を妨げない
        console.error("[reportContent] notify owner failed", e);
      }
    }

    return { success: true, pending: willBecomePending };
  }
);

// 通報でオーナーに届ける通知
async function createReportNotification(
  ownerId: string,
  data: {
    postId: string;
    commentId?: string;
    groupId: string;
    groupName: string;
    tankaBody: string;
  }
) {
  const userSnap = await db.doc(`users/${ownerId}`).get();
  const userData = userSnap.data();
  if (!userData) return;

  const fcmToken = userData.fcmToken;
  if (fcmToken) {
    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: `${data.groupName}に通報が入りました`,
          body: "確認してください",
        },
        android: {
          notification: {
            channelId: "other",
            visibility: "private" as const,
          },
        },
        data: {
          postId: data.postId,
          commentId: data.commentId || "",
          groupId: data.groupId,
          type: "report",
        },
      });
    } catch (e: any) {
      if (
        e.code === "messaging/invalid-registration-token" ||
        e.code === "messaging/registration-token-not-registered"
      ) {
        await db.doc(`users/${ownerId}`).update({ fcmToken: "" });
      }
    }
  }

  await db.collection(`users/${ownerId}/notifications`).add({
    type: "report",
    postId: data.postId,
    ...(data.commentId ? { commentId: data.commentId } : {}),
    groupId: data.groupId,
    groupName: data.groupName,
    tankaBody: data.tankaBody,
    createdAt: admin.firestore.Timestamp.now(),
  });
}

// ===== ブロック機能 =====

const BLOCK_LIMIT = 200;

/**
 * getMyAuthorHandle — 自分の authorHandle を返す
 *   - 自投稿を除外するためのクライアント側フィルタに必要
 */
export const getMyAuthorHandle = onCall(
  { region: "asia-northeast1", secrets: [AUTHOR_HANDLE_SALT] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    return { handle: deriveAuthorHandle(request.auth.uid) };
  }
);

/**
 * blockAuthor — 特定の詠み人を双方向ブロック
 *   - postId または commentId を受け取り、対象の UID を Cloud Function 側で解決する
 *   - users/{blocker}.blockedHandles[targetHandle] に追加（targetUid を内部保持）
 *   - users/{target}.blockedByHandles[blockerHandle] に追加（逆方向検知用）
 *   - ルールで reactions/comments 作成を相互に遮断できるようにする
 */
export const blockAuthor = onCall(
  { region: "asia-northeast1", secrets: [AUTHOR_HANDLE_SALT] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const uid = request.auth.uid;
    const postId = assertDocId(request.data?.postId, "postId");
    const commentId = assertOptionalDocId(request.data?.commentId, "commentId");
    const sampleBody = assertOptionalString(request.data?.sampleBody, "sampleBody", { max: 500 });

    // 対象の UID を server-side で確定（クライアントの入力を信用しない）
    const authorPath = commentId
      ? `posts/${postId}/comments/${commentId}/private/author`
      : `posts/${postId}/private/author`;
    const authorSnap = await db.doc(authorPath).get();
    if (!authorSnap.exists) throw new HttpsError("not-found", "対象の著者情報が見つかりません");
    const targetUid = authorSnap.data()?.authorId as string | undefined;
    if (!targetUid) throw new HttpsError("not-found", "対象の著者が不明です");
    if (targetUid === uid) {
      throw new HttpsError("failed-precondition", "自分自身はブロックできません");
    }

    const blockerHandle = deriveAuthorHandle(uid);
    const targetHandle = deriveAuthorHandle(targetUid);

    const blockerRef = db.doc(`users/${uid}`);
    const targetRef = db.doc(`users/${targetUid}`);

    await db.runTransaction(async (tx) => {
      const [blockerSnap, targetSnap] = await Promise.all([
        tx.get(blockerRef),
        tx.get(targetRef),
      ]);
      if (!blockerSnap.exists) throw new HttpsError("not-found", "ユーザーが見つかりません");

      const current = (blockerSnap.data()?.blockedHandles as Record<string, unknown>) || {};
      if (current[targetHandle]) {
        // 既にブロック済み → no-op（相互記録は既にある想定）
        return;
      }
      if (Object.keys(current).length >= BLOCK_LIMIT) {
        throw new HttpsError("resource-exhausted", `ブロックは最大${BLOCK_LIMIT}人までです`);
      }

      const blockerEntry: Record<string, unknown> = {
        blockedAt: admin.firestore.Timestamp.now(),
        targetUid, // 解除時に相手側のドキュメントを更新するため
      };
      if (typeof sampleBody === "string" && sampleBody.trim().length > 0) {
        blockerEntry.sampleBody = sampleBody.trim().slice(0, 80);
      }
      tx.update(blockerRef, { [`blockedHandles.${targetHandle}`]: blockerEntry });

      if (targetSnap.exists) {
        tx.update(targetRef, {
          [`blockedByHandles.${blockerHandle}`]: {
            blockedAt: admin.firestore.Timestamp.now(),
          },
        });
      } else {
        // 対象ユーザーのドキュメントが存在しないケース（通常は無いが保険）
        tx.set(
          targetRef,
          {
            blockedByHandles: {
              [blockerHandle]: { blockedAt: admin.firestore.Timestamp.now() },
            },
          },
          { merge: true }
        );
      }
    });
    return { success: true };
  }
);

/**
 * unblockAuthor — 双方向ブロックを解除
 *   - blocker.blockedHandles[handle] から targetUid を取り出して相手側も掃除
 */
export const unblockAuthor = onCall(
  { region: "asia-northeast1", secrets: [AUTHOR_HANDLE_SALT] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const uid = request.auth.uid;
    const handle = assertString(request.data?.handle, "handle", { pattern: /^[0-9a-f]{12}$/ });

    const blockerRef = db.doc(`users/${uid}`);
    const blockerSnap = await blockerRef.get();
    const entry = (blockerSnap.data()?.blockedHandles as Record<string, any> | undefined)?.[handle];
    const targetUid = entry?.targetUid as string | undefined;
    const blockerHandle = deriveAuthorHandle(uid);

    const batch = db.batch();
    batch.update(blockerRef, {
      [`blockedHandles.${handle}`]: admin.firestore.FieldValue.delete(),
    });
    if (targetUid) {
      batch.update(db.doc(`users/${targetUid}`), {
        [`blockedByHandles.${blockerHandle}`]: admin.firestore.FieldValue.delete(),
      });
    }
    await batch.commit();
    return { success: true };
  }
);

/**
 * resolveReports — オーナーが仮非表示を解除する（裁きはしない）
 *  - hogo/hogoType='pending' の投稿・評を通常状態に戻す
 *  - 関連する reports の status を 'resolved' にする
 */
export const resolveReports = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const groupId = assertDocId(request.data?.groupId, "groupId");
    const postId = assertDocId(request.data?.postId, "postId");
    const commentId = assertOptionalDocId(request.data?.commentId, "commentId");

    // オーナーチェック
    const callerSnap = await db.doc(`groups/${groupId}/members/${request.auth.uid}`).get();
    if (!callerSnap.exists || callerSnap.data()?.role !== "owner") {
      throw new HttpsError("permission-denied", "オーナーのみ解除できます");
    }

    const targetId = commentId || postId;
    const contentPath = commentId
      ? `posts/${postId}/comments/${commentId}`
      : `posts/${postId}`;
    const contentSnap = await db.doc(contentPath).get();
    if (!contentSnap.exists) throw new HttpsError("not-found", "対象が見つかりません");

    const data = contentSnap.data()!;
    if (data.hogoType !== "pending") {
      throw new HttpsError("failed-precondition", "仮非表示状態ではありません");
    }

    // 退避してあった原文 body を復元し、仮非表示を解除
    const archivedRef = db.doc(`${contentPath}/private/archivedBody`);
    const archivedSnap = await archivedRef.get();
    const restoredBody = (archivedSnap.data()?.body as string | undefined) ?? "";

    const batch0 = db.batch();
    batch0.update(db.doc(contentPath), {
      body: restoredBody,
      hogo: admin.firestore.FieldValue.delete(),
      hogoType: admin.firestore.FieldValue.delete(),
      hogoReason: admin.firestore.FieldValue.delete(),
    });
    if (archivedSnap.exists) {
      batch0.delete(archivedRef);
    }
    await batch0.commit();

    // 反故化時に書き換えた通知を元に戻す
    try {
      if (commentId) {
        await unmarkNotificationsForComment(commentId, restoredBody);
      } else {
        await unmarkNotificationsForPost(postId, restoredBody);
      }
    } catch (e) {
      console.error("[resolveReports] unmark notifications failed", e);
    }

    // 関連 reports を resolved にマーク
    const reportsSnap = await db
      .collection("reports")
      .where("targetId", "==", targetId)
      .where("status", "==", "pending")
      .get();
    const batch = db.batch();
    reportsSnap.docs.forEach((d) => batch.update(d.ref, { status: "resolved" }));
    await batch.commit();

    return { success: true, resolvedCount: reportsSnap.size };
  }
);

/**
 * getArchivedBody — 反故投稿/評の退避済み原文を取得
 *  - 歌会オーナーのみが呼び出せる（通報レビュー用）
 *  - hogoType === 'pending' のコンテンツに限定
 */
export const getArchivedBody = onCall(
  { region: "asia-northeast1" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です");
    const groupId = assertDocId(request.data?.groupId, "groupId");
    const postId = assertDocId(request.data?.postId, "postId");
    const commentId = assertOptionalDocId(request.data?.commentId, "commentId");

    // オーナーチェック
    const callerSnap = await db.doc(`groups/${groupId}/members/${request.auth.uid}`).get();
    if (!callerSnap.exists || callerSnap.data()?.role !== "owner") {
      throw new HttpsError("permission-denied", "オーナーのみ取得できます");
    }

    const contentPath = commentId
      ? `posts/${postId}/comments/${commentId}`
      : `posts/${postId}`;
    const contentSnap = await db.doc(contentPath).get();
    if (!contentSnap.exists) throw new HttpsError("not-found", "対象が見つかりません");
    if (contentSnap.data()?.hogoType !== "pending") {
      throw new HttpsError("failed-precondition", "仮非表示状態ではありません");
    }

    const archivedSnap = await db.doc(`${contentPath}/private/archivedBody`).get();
    return { body: (archivedSnap.data()?.body as string | undefined) ?? "" };
  }
);

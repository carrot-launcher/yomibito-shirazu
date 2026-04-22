#!/usr/bin/env node
// 運営用監視スクリプト。サービスアカウントキーで Firebase に接続する。
// キーのパスは環境変数 GOOGLE_APPLICATION_CREDENTIALS で渡す。
//
// 使い方:
//   node scripts/monitor.js latest [TYPE] [N]        TYPE: posts(既定) | comments | all
//   node scripts/monitor.js watch [TYPE]
//   node scripts/monitor.js hogo [TYPE]
//   node scripts/monitor.js group <groupId> [N]
//   node scripts/monitor.js public
//   node scripts/monitor.js reports [N]
//   node scripts/monitor.js user <uid> [N]
//   node scripts/monitor.js ratelimits [YYYY-MM-DD] [N]
//   node scripts/monitor.js suspend <uid> <reason> [--yes]
//   node scripts/monitor.js unsuspend <uid> [--yes]
//   node scripts/monitor.js purge <uid> <reason> [--yes] [--dry-run]
//   node scripts/monitor.js orphans [--yes] [--dry-run]
const admin = require('firebase-admin');
const readline = require('readline');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('環境変数 GOOGLE_APPLICATION_CREDENTIALS にサービスアカウントキーのパスを設定してください。');
  process.exit(1);
}

admin.initializeApp();
const db = admin.firestore();

// フラグ --yes は args から除く（コマンドの位置引数を壊さないため）
const rawArgs = process.argv.slice(3);
const flags = new Set(rawArgs.filter((a) => a.startsWith('--')));
const positional = rawArgs.filter((a) => !a.startsWith('--'));
const cmd = process.argv[2];
const args = positional;

function confirm(message) {
  if (flags.has('--yes')) return Promise.resolve(true);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N]: `, (ans) => {
      rl.close();
      const a = (ans || '').trim().toLowerCase();
      resolve(a === 'y' || a === 'yes');
    });
  });
}

function fmtTime(ts) {
  if (!ts) return '?';
  const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
  return d.toLocaleString('ja-JP', { hour12: false });
}

// ANSI カラー。NO_COLOR / FORCE_COLOR 環境変数と TTY 判定に従う。
const useColor = process.env.NO_COLOR
  ? false
  : process.env.FORCE_COLOR
    ? true
    : !!process.stdout.isTTY;

const C = useColor
  ? {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      gray: '\x1b[90m',
    }
  : { reset: '', bold: '', dim: '', red: '', green: '', yellow: '', blue: '', magenta: '', cyan: '', gray: '' };

// group doc 自体を丸ごとキャッシュする（pastMembers / bannedUsers 参照にも使う）。
const groupDocCache = new Map();
async function getGroupDoc(groupId) {
  if (!groupId) return null;
  if (groupDocCache.has(groupId)) return groupDocCache.get(groupId);
  const snap = await db.doc(`groups/${groupId}`).get();
  const d = snap.exists ? snap.data() : null;
  groupDocCache.set(groupId, d);
  return d;
}

async function getGroupName(groupId) {
  const d = await getGroupDoc(groupId);
  return d ? (d.name || '?') : '(解散済み)';
}

// JST の当日キー（functions/src/validation.ts の todayKey と同一フォーマット）
function todayKeyJst() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

function truncate(s, max = 40) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// 投稿または評の authorId（private/author）を取る。反故や欠損時は null。
async function getContentAuthorId({ targetType, targetId, postId }) {
  const path = targetType === 'comment'
    ? `posts/${postId}/comments/${targetId}/private/author`
    : `posts/${targetId}/private/author`;
  try {
    const snap = await db.doc(path).get();
    return snap.exists ? (snap.data().authorId || null) : null;
  } catch {
    return null;
  }
}

// 歌会内でのユーザー表示情報（displayName + userCode）を取る。
// displayName は歌会ごとに異なるので (gid, uid) の組でキャッシュする。
// 現メンバーでなければ group doc の pastMembers / bannedUsers からフォールバック。
const authorInfoCache = new Map();
async function getAuthorInfo(gid, uid) {
  if (!gid || !uid) return null;
  const key = `${gid}:${uid}`;
  if (authorInfoCache.has(key)) return authorInfoCache.get(key);

  let info = null;
  try {
    const memberSnap = await db.doc(`groups/${gid}/members/${uid}`).get();
    if (memberSnap.exists) {
      const d = memberSnap.data();
      info = {
        displayName: d.displayName || '(名無し)',
        userCode: d.userCode || '------',
      };
    }
  } catch {}

  if (!info) {
    const g = await getGroupDoc(gid);
    const past = g?.pastMembers?.[uid];
    const banned = g?.bannedUsers?.[uid];
    if (past) {
      info = {
        displayName: `${past.displayName || '(名無し)'} [離脱済み]`,
        userCode: past.userCode || '------',
      };
    } else if (banned) {
      info = {
        displayName: `${banned.displayName || '(名無し)'} [追放済み]`,
        userCode: banned.userCode || '------',
      };
    }
  }

  // 最終フォールバック: users/{uid}.userCode だけでも拾う
  if (!info) {
    try {
      const userSnap = await db.doc(`users/${uid}`).get();
      if (userSnap.exists) {
        const d = userSnap.data();
        info = { displayName: '(歌会外)', userCode: d.userCode || '------' };
      }
    } catch {}
  }

  authorInfoCache.set(key, info);
  return info;
}

// 歌会の文脈がない場面（user / suspend / ratelimits など）で使う代表ラベル。
// users/{uid} には displayName が無いので、joinedGroups の先頭の歌会から拾う。
async function getUserPrimaryLabel(uid) {
  try {
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      return { displayName: '(存在しない)', userCode: '------', userCodeFromUser: '------' };
    }
    const u = userSnap.data();
    const userCode = u.userCode || '------';
    const joined = u.joinedGroups || [];
    if (joined.length > 0) {
      const info = await getAuthorInfo(joined[0], uid);
      if (info) {
        return {
          displayName: info.displayName,
          userCode: info.userCode || userCode,
          userCodeFromUser: userCode,
          multiGroup: joined.length > 1,
        };
      }
    }
    return { displayName: '(歌会未参加)', userCode, userCodeFromUser: userCode };
  } catch {
    return { displayName: '(取得不可)', userCode: '------', userCodeFromUser: '------' };
  }
}

// post doc を renderPost が使える形に整える（author 情報も resolve する）。
async function enrichPost(postDoc) {
  const p = postDoc.data();
  const [gName, authorId] = await Promise.all([
    getGroupName(p.groupId),
    getContentAuthorId({ targetType: 'post', targetId: postDoc.id }),
  ]);
  const authorInfo = authorId ? await getAuthorInfo(p.groupId, authorId) : null;
  return {
    p,
    postId: postDoc.id,
    gId: p.groupId,
    gName,
    uid: authorId,
    authorInfo,
  };
}

function renderPost({ p, gId, gName, uid, authorInfo }) {
  const flags = [];
  if (p.hogo) {
    flags.push(`裁き:${p.hogoType || '?'}${p.hogoReason ? `(${p.hogoReason})` : ''}`);
  }
  if (p.revealedAuthorName) flags.push(`解題:${p.revealedAuthorName}#${p.revealedAuthorCode || ''}`);
  const flagStr = flags.length ? ` ${C.yellow}[${flags.join(' / ')}]${C.reset}` : '';

  const groupPart = `[${gName}${C.dim} / ${gId || '?'}${C.reset}]`;
  const authorPart = uid
    ? ` [${authorInfo?.displayName || '(名無し)'}#${authorInfo?.userCode || '------'}${C.dim} / ${uid}${C.reset}]`
    : ` ${C.dim}[作者不明]${C.reset}`;
  const bodyStr = p.body
    ? `${C.bold}${p.body}${C.reset}`
    : `${C.red}(反故)${C.reset}`;
  const typeMarker = `${C.cyan}${C.bold}歌${C.reset}`;
  const timeStr = `${C.dim}[${fmtTime(p.createdAt)}]${C.reset}`;
  return `${timeStr} ${typeMarker} ${groupPart}${authorPart}${flagStr} ${bodyStr}`;
}

// 評 (comment) を enrich する。comment は posts/{postId}/comments/{commentId} に
// ぶら下がるので、postId → post → groupId → groupName の連鎖を解決する。
async function enrichComment(commentDoc) {
  const c = commentDoc.data();
  const postId = commentDoc.ref.parent.parent?.id;
  if (!postId) return null;
  const [postSnap, authorId] = await Promise.all([
    db.doc(`posts/${postId}`).get(),
    getContentAuthorId({ targetType: 'comment', targetId: commentDoc.id, postId }),
  ]);
  const p = postSnap.exists ? postSnap.data() : null;
  const gId = p?.groupId || null;
  const gName = gId ? await getGroupName(gId) : '(投稿欠損)';
  const authorInfo = authorId && gId ? await getAuthorInfo(gId, authorId) : null;
  return {
    c,
    commentId: commentDoc.id,
    postId,
    postBody: p?.body || null,
    gId,
    gName,
    uid: authorId,
    authorInfo,
  };
}

function renderComment({ c, postBody, gId, gName, uid, authorInfo }) {
  const flags = [];
  if (c.hogo) {
    flags.push(`裁き:${c.hogoType || '?'}${c.hogoReason ? `(${c.hogoReason})` : ''}`);
  }
  const flagStr = flags.length ? ` ${C.yellow}[${flags.join(' / ')}]${C.reset}` : '';

  const groupPart = `[${gName}${C.dim} / ${gId || '?'}${C.reset}]`;
  const authorPart = uid
    ? ` [${authorInfo?.displayName || '(名無し)'}#${authorInfo?.userCode || '------'}${C.dim} / ${uid}${C.reset}]`
    : ` ${C.dim}[作者不明]${C.reset}`;
  const postRef = `${C.dim}→[${postBody ? truncate(postBody, 20) : '投稿欠損'}]${C.reset} `;
  const bodyStr = c.body
    ? `${C.bold}${c.body}${C.reset}`
    : `${C.red}(反故)${C.reset}`;
  const typeMarker = `${C.magenta}${C.bold}評${C.reset}`;
  const timeStr = `${C.dim}[${fmtTime(c.createdAt)}]${C.reset}`;
  return `${timeStr} ${typeMarker} ${groupPart}${authorPart}${flagStr} ${postRef}${bodyStr}`;
}

async function cmdLatest(type, n) {
  if (type === 'comments') {
    const snap = await db.collectionGroup('comments')
      .orderBy('createdAt', 'desc').limit(n).get();
    const enriched = await Promise.all(snap.docs.map(enrichComment));
    for (const e of enriched) if (e) console.log(renderComment(e));
    return;
  }
  if (type === 'all') {
    // 歌 + 評を時系列でマージ。各コレクションから N 件ずつ取り、全体を時刻順にソート。
    const [postsSnap, commentsSnap] = await Promise.all([
      db.collection('posts').orderBy('createdAt', 'desc').limit(n).get(),
      db.collectionGroup('comments').orderBy('createdAt', 'desc').limit(n).get(),
    ]);
    const items = [];
    for (const doc of postsSnap.docs) items.push({ kind: 'post', doc });
    for (const doc of commentsSnap.docs) items.push({ kind: 'comment', doc });
    items.sort((a, b) => {
      const aT = a.doc.data()?.createdAt?.toMillis?.() || 0;
      const bT = b.doc.data()?.createdAt?.toMillis?.() || 0;
      return bT - aT;
    });
    const top = items.slice(0, n);
    for (const item of top) {
      if (item.kind === 'post') {
        const e = await enrichPost(item.doc);
        console.log(renderPost(e));
      } else {
        const e = await enrichComment(item.doc);
        if (e) console.log(renderComment(e));
      }
    }
    return;
  }
  // 既定: posts
  const snap = await db.collection('posts').orderBy('createdAt', 'desc').limit(n).get();
  const enriched = await Promise.all(snap.docs.map(enrichPost));
  for (const e of enriched) console.log(renderPost(e));
}

async function cmdWatch(type) {
  console.log(`${C.green}監視中${C.reset} (${C.cyan}${type}${C.reset})... ${C.dim}(Ctrl+C で終了)${C.reset}\n`);
  const subscribePosts = () => {
    let initialized = false;
    const seen = new Set();
    db.collection('posts').orderBy('createdAt', 'desc').limit(20).onSnapshot(async (snap) => {
      if (!initialized) {
        for (const doc of snap.docs) seen.add(doc.id);
        initialized = true;
        return;
      }
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue;
        if (seen.has(change.doc.id)) continue;
        seen.add(change.doc.id);
        const e = await enrichPost(change.doc);
        console.log(renderPost(e));
      }
    }, (err) => {
      console.error('watch posts error:', err.message);
      process.exit(1);
    });
  };
  const subscribeComments = () => {
    let initialized = false;
    const seen = new Set();
    db.collectionGroup('comments').orderBy('createdAt', 'desc').limit(20).onSnapshot(async (snap) => {
      if (!initialized) {
        for (const doc of snap.docs) seen.add(doc.id);
        initialized = true;
        return;
      }
      for (const change of snap.docChanges()) {
        if (change.type !== 'added') continue;
        if (seen.has(change.doc.id)) continue;
        seen.add(change.doc.id);
        const e = await enrichComment(change.doc);
        if (e) console.log(renderComment(e));
      }
    }, (err) => {
      console.error('watch comments error:', err.message);
      process.exit(1);
    });
  };
  if (type !== 'comments') subscribePosts();
  if (type !== 'posts') subscribeComments();
}

async function cmdHogo(type) {
  const doPosts = async () => {
    const snap = await db.collection('posts')
      .where('hogo', '==', true)
      .orderBy('createdAt', 'desc').limit(100).get();
    const enriched = await Promise.all(snap.docs.map(enrichPost));
    for (const e of enriched) console.log(renderPost(e));
    return snap.size;
  };
  const doComments = async () => {
    const snap = await db.collectionGroup('comments')
      .where('hogo', '==', true)
      .orderBy('createdAt', 'desc').limit(100).get();
    const enriched = await Promise.all(snap.docs.map(enrichComment));
    for (const e of enriched) if (e) console.log(renderComment(e));
    return snap.size;
  };
  let total = 0;
  if (type !== 'comments') total += await doPosts();
  if (type !== 'posts') total += await doComments();
  if (total === 0) console.log('裁き済みのコンテンツはありません。');
}

async function cmdGroup(groupId, n) {
  if (!groupId) {
    console.error('使い方: node monitor.js group <groupId> [N]');
    process.exit(1);
  }
  const groupSnap = await db.doc(`groups/${groupId}`).get();
  if (!groupSnap.exists) {
    console.log(`歌会 ${groupId} は存在しません（解散済みの可能性）。`);
    return;
  }
  const g = groupSnap.data();
  console.log(`${C.cyan}${C.bold}=== ${g.name}${C.reset}${C.dim} (${groupId})${C.reset} ${C.cyan}${C.bold}===${C.reset}`);
  console.log(`  ${C.dim}種類:${C.reset} ${g.isPublic ? C.green + '公開' + C.reset : '非公開'}`);
  console.log(`  ${C.dim}主宰:${C.reset} ${g.ownerDisplayName || '?'} #${g.ownerUserCode || '?'}`);
  console.log(`  ${C.dim}メンバー数:${C.reset} ${g.memberCount || 0} ${C.dim}/${C.reset} ${C.dim}投稿数:${C.reset} ${g.postCount || 0}`);
  if (g.purpose) console.log(`  ${C.dim}趣意:${C.reset} ${g.purpose}`);
  console.log('');
  const postsSnap = await db.collection('posts')
    .where('groupId', '==', groupId)
    .orderBy('createdAt', 'desc')
    .limit(n)
    .get();
  const enriched = await Promise.all(postsSnap.docs.map(enrichPost));
  for (const e of enriched) console.log(renderPost(e));
}

async function cmdPublic() {
  const snap = await db.collection('groups')
    .where('isPublic', '==', true)
    .orderBy('createdAt', 'desc')
    .get();
  if (snap.empty) {
    console.log('公開歌会はありません。');
    return;
  }
  for (const doc of snap.docs) {
    const g = doc.data();
    console.log(`${C.cyan}${C.bold}── ${g.name}${C.reset} ${C.dim}(${doc.id})${C.reset}`);
    console.log(`   ${C.dim}主宰:${C.reset} ${g.ownerDisplayName || '?'} #${g.ownerUserCode || '?'}`);
    console.log(`   ${g.memberCount || 0}${C.dim}人 / ${C.reset}${g.postCount || 0}${C.dim}首${C.reset}`);
    if (g.purpose) console.log(`   ${C.dim}趣意:${C.reset} ${g.purpose}`);
    console.log('');
  }
}

async function cmdReports(n) {
  const snap = await db.collection('reports')
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'desc')
    .limit(n)
    .get();
  if (snap.empty) {
    console.log('未処理の通報はありません。');
    return;
  }

  // 対象コンテンツと作者 uid を並列で引く
  const enriched = await Promise.all(snap.docs.map(async (d) => {
    const r = d.data();
    const [gName, authorId, contentSnap] = await Promise.all([
      getGroupName(r.groupId),
      getContentAuthorId({ targetType: r.targetType, targetId: r.targetId, postId: r.postId }),
      (r.targetType === 'comment'
        ? db.doc(`posts/${r.postId}/comments/${r.targetId}`).get()
        : db.doc(`posts/${r.targetId}`).get()),
    ]);
    const content = contentSnap.exists ? contentSnap.data() : null;
    return { id: d.id, r, gName, authorId, content };
  }));

  for (const { id, r, gName, authorId, content } of enriched) {
    const body = content?.body || '(反故)';
    const reportCount = content?.reportCount ?? '?';
    const hogo = content?.hogo ? ` ${C.yellow}裁き:${content.hogoType || '?'}${C.reset}` : '';
    const typeMarker = r.targetType === 'comment'
      ? `${C.magenta}${C.bold}評${C.reset}`
      : `${C.cyan}${C.bold}歌${C.reset}`;
    const countColored = typeof reportCount === 'number'
      ? (reportCount >= 3 ? `${C.red}${reportCount}${C.reset}` : `${C.yellow}${reportCount}${C.reset}`)
      : reportCount;
    const bodyStr = content?.body
      ? `${C.bold}${truncate(body, 60)}${C.reset}`
      : `${C.red}${body}${C.reset}`;
    console.log(`${C.dim}[${fmtTime(r.createdAt)}]${C.reset} [${gName}] ${typeMarker}${hogo}`);
    console.log(`  ${C.dim}通報理由:${C.reset} ${C.yellow}${r.reason}${C.reset}${r.detail ? ` / ${truncate(r.detail, 60)}` : ''}`);
    console.log(`  ${C.dim}対象:${C.reset} ${bodyStr} ${C.dim}(通報数:${C.reset}${countColored}${C.dim})${C.reset}`);
    console.log(`  ${C.dim}作者uid:${C.reset} ${authorId || C.dim + '(取得不可)' + C.reset}`);
    console.log(`  ${C.dim}通報者uid: ${r.reporterId}${C.reset}`);
    console.log(`  ${C.dim}reportId: ${id}${C.reset}`);
    console.log('');
  }

  // 同一作者が複数通報されている場合のサマリ
  const byAuthor = new Map();
  for (const { authorId } of enriched) {
    if (!authorId) continue;
    byAuthor.set(authorId, (byAuthor.get(authorId) || 0) + 1);
  }
  const multi = [...byAuthor.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
  if (multi.length) {
    console.log(`${C.yellow}── 複数通報されている作者 ──${C.reset}`);
    for (const [uid, count] of multi) {
      console.log(`  ${uid}  ${C.red}(${count}件)${C.reset}`);
    }
  }
}

async function cmdUser(uid, n) {
  if (!uid) {
    console.error('使い方: node monitor.js user <uid> [N]');
    process.exit(1);
  }
  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    console.log(`ユーザー ${uid} は存在しません。`);
    return;
  }
  const u = userSnap.data();
  const primary = await getUserPrimaryLabel(uid);
  const multiMark = primary.multiGroup ? ` ${C.dim}※歌会ごとに別名あり${C.reset}` : '';
  console.log(`${C.cyan}${C.bold}=== ${primary.displayName}#${primary.userCode}${C.reset}${C.dim} (${uid})${C.reset}${multiMark} ${C.cyan}${C.bold}===${C.reset}`);
  if (u.suspended) {
    console.log(`  ${C.red}${C.bold}⚠ suspended:${C.reset} ${C.red}${u.suspendedReason || '(理由なし)'}${C.reset} ${C.dim}@ ${fmtTime(u.suspendedAt)}${C.reset}`);
  }
  console.log(`  ${C.dim}参加歌会:${C.reset} ${(u.joinedGroups || []).length}件`);
  for (const gid of u.joinedGroups || []) {
    const [gName, info] = await Promise.all([
      getGroupName(gid),
      getAuthorInfo(gid, uid),
    ]);
    const nameInGroup = info ? ` ${C.dim}[${info.displayName}#${info.userCode}]${C.reset}` : '';
    console.log(`    - ${gName} ${C.dim}(${gid})${C.reset}${nameInGroup}`);
  }
  const blockedCount = Object.keys(u.blockedHandles || {}).length;
  const blockedByCount = Object.keys(u.blockedByHandles || {}).length;
  console.log(`  ${C.dim}ブロック:${C.reset} 自分が${blockedCount}人 ${C.dim}/${C.reset} 自分が${blockedByCount}人に`);
  console.log('');

  // 直近 N 件の自分の歌
  const postsSnap = await db.collection(`users/${uid}/myPosts`)
    .orderBy('createdAt', 'desc')
    .limit(n)
    .get();
  console.log(`${C.gray}── 直近の歌 (${postsSnap.size}件) ──${C.reset}`);
  for (const d of postsSnap.docs) {
    const my = d.data();
    const postSnap = await db.doc(`posts/${my.postId}`).get();
    const p = postSnap.exists ? postSnap.data() : null;
    const status = !postSnap.exists
      ? `${C.dim}(削除済み)${C.reset}`
      : p.hogo
        ? `${C.yellow}裁き:${p.hogoType || '?'}${C.reset} ${C.dim}通報数:${p.reportCount || 0}${C.reset}`
        : `${C.dim}通報数:${p.reportCount || 0}${C.reset}`;
    const bodyStr = my.tankaBody
      ? `${C.bold}${truncate(my.tankaBody, 50)}${C.reset}`
      : `${C.dim}(空)${C.reset}`;
    console.log(`  ${C.dim}[${fmtTime(my.createdAt)}]${C.reset} [${my.groupName || '?'}] ${status} ${bodyStr}`);
  }
  console.log('');

  // 直近 7 日分の rateLimits
  // document ID（YYYY-MM-DD）でしかソートできず、降順は Firestore がインデックス要求してくるため
  // 全件取ってクライアント側で降順ソートする。1ユーザーあたり高々数十件なので問題なし。
  const dailySnap = await db.collection(`rateLimits/${uid}/daily`).get();
  console.log(`${C.gray}── 直近の rateLimits (最大7日) ──${C.reset}`);
  if (dailySnap.empty) {
    console.log(`  ${C.dim}(データなし)${C.reset}`);
  } else {
    const sorted = dailySnap.docs
      .slice()
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, 7);
    for (const d of sorted) {
      const r = d.data();
      console.log(`  ${C.dim}${d.id}${C.reset}  投稿:${r.postCount || 0} 評:${r.commentCount || 0} 通報発信:${r.reportCount || 0}`);
    }
  }
  console.log('');

  // このユーザーが通報者として出している通報（濫用チェック用）
  const filedSnap = await db.collection('reports')
    .where('reporterId', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();
  console.log(`${C.gray}── 本人が発した通報 (直近10件) ──${C.reset}`);
  if (filedSnap.empty) {
    console.log(`  ${C.dim}(なし)${C.reset}`);
  } else {
    for (const d of filedSnap.docs) {
      const r = d.data();
      const statusColored = r.status === 'pending' ? `${C.yellow}${r.status}${C.reset}` : `${C.green}${r.status}${C.reset}`;
      const typeMarker = r.targetType === 'comment' ? `${C.magenta}評${C.reset}` : `${C.cyan}歌${C.reset}`;
      console.log(`  ${C.dim}[${fmtTime(r.createdAt)}]${C.reset} status:${statusColored} ${typeMarker} ${C.dim}理由:${C.reset}${C.yellow}${r.reason}${C.reset}`);
    }
  }
}

async function cmdRatelimits(dateKey, n) {
  const key = dateKey || todayKeyJst();
  // collectionGroup + FieldPath.documentId() は完全パスでの一致が必要なため使えない。
  // daily サブコレクション全件を取り、document ID（日付キー）で自前フィルタする。
  // 1日=ユーザー数ぶんのドキュメントなので、小〜中規模のうちはこれで十分。
  const all = await db.collectionGroup('daily').get();
  const docs = all.docs.filter((d) => d.id === key);
  const userRows = docs
    .map((d) => ({
      uid: d.ref.parent.parent.id,
      ...d.data(),
    }))
    .filter((row) => !row.uid.startsWith('group_'));

  if (userRows.length === 0) {
    console.log(`${key} の rateLimits 記録はありません。`);
    return;
  }

  console.log(`${C.cyan}${C.bold}=== rateLimits ${key}${C.reset} ${C.dim}(${userRows.length}人)${C.reset} ${C.cyan}${C.bold}===${C.reset}\n`);

  const labelCache = new Map();
  async function labelFor(uid) {
    if (labelCache.has(uid)) return labelCache.get(uid);
    const primary = await getUserPrimaryLabel(uid);
    // suspended 状態は users/{uid} を別途見る（getUserPrimaryLabel は参照してない）
    const userSnap = await db.doc(`users/${uid}`).get();
    const susp = userSnap.exists && userSnap.data()?.suspended ? ` ${C.red}${C.bold}[SUSP]${C.reset}` : '';
    const label = `${primary.displayName}#${primary.userCode}${susp}`;
    labelCache.set(uid, label);
    return label;
  }

  async function renderTop(title, field) {
    const sorted = userRows
      .filter((r) => (r[field] || 0) > 0)
      .sort((a, b) => (b[field] || 0) - (a[field] || 0))
      .slice(0, n);
    console.log(`${C.gray}── ${title} Top${n} ──${C.reset}`);
    if (sorted.length === 0) {
      console.log(`  ${C.dim}(該当なし)${C.reset}`);
    } else {
      for (const r of sorted) {
        const label = await labelFor(r.uid);
        const count = r[field];
        // 閾値に応じて色付け: 50+ 赤、10+ 黄、それ以外 default
        const countColored = count >= 50
          ? `${C.red}${C.bold}${String(count).padStart(4)}${C.reset}`
          : count >= 10
            ? `${C.yellow}${String(count).padStart(4)}${C.reset}`
            : `${String(count).padStart(4)}`;
        console.log(`  ${countColored}  ${label}  ${C.dim}${r.uid}${C.reset}`);
      }
    }
    console.log('');
  }

  await renderTop('投稿数', 'postCount');
  await renderTop('評数', 'commentCount');
  await renderTop('通報発信数', 'reportCount');
}

async function cmdSuspend(uid, reason) {
  if (!uid || !reason) {
    console.error('使い方: node monitor.js suspend <uid> <reason> [--yes]');
    process.exit(1);
  }
  // 1. Firebase Auth 側にユーザーが居るか
  let authUser;
  try {
    authUser = await admin.auth().getUser(uid);
  } catch (e) {
    console.error(`Firebase Auth に uid=${uid} が見つかりません: ${e.message}`);
    process.exit(1);
  }
  // 2. Firestore プロフィールを引いて現状表示
  const userSnap = await db.doc(`users/${uid}`).get();
  const u = userSnap.exists ? userSnap.data() : {};
  const primary = await getUserPrimaryLabel(uid);
  const label = `${primary.displayName}#${primary.userCode}${primary.multiGroup ? ' (歌会ごとに別名あり)' : ''}`;
  console.log(`=== suspend 対象 ===`);
  console.log(`  uid: ${uid}`);
  console.log(`  name: ${label}`);
  console.log(`  email: ${authUser.email || '(なし)'}`);
  console.log(`  Firebase Auth disabled: ${authUser.disabled}`);
  console.log(`  Firestore suspended: ${u.suspended ? `true (${u.suspendedReason || ''})` : 'false'}`);
  console.log(`  参加歌会: ${(u.joinedGroups || []).length}件`);
  console.log(`  理由: ${reason}`);
  console.log('');
  console.log('この操作で起きること:');
  console.log('  1. admin.auth().updateUser(uid, { disabled: true })');
  console.log('  2. admin.auth().revokeRefreshTokens(uid)  ← 以降トークン再取得が失敗');
  console.log('  3. users/' + uid + ' に suspended=true / suspendedAt / suspendedReason を記録');
  console.log('  ※ 発行済み ID トークンは最長 ~1 時間有効なため、即時サインアウトにはならない');
  console.log('');

  const ok = await confirm('実行しますか？');
  if (!ok) {
    console.log('中止しました。');
    return;
  }

  await admin.auth().updateUser(uid, { disabled: true });
  await admin.auth().revokeRefreshTokens(uid);
  await db.doc(`users/${uid}`).set({
    suspended: true,
    suspendedAt: admin.firestore.FieldValue.serverTimestamp(),
    suspendedReason: reason,
  }, { merge: true });
  console.log(`✓ ${uid} を suspend しました。`);
}

async function cmdUnsuspend(uid) {
  if (!uid) {
    console.error('使い方: node monitor.js unsuspend <uid> [--yes]');
    process.exit(1);
  }
  let authUser;
  try {
    authUser = await admin.auth().getUser(uid);
  } catch (e) {
    console.error(`Firebase Auth に uid=${uid} が見つかりません: ${e.message}`);
    process.exit(1);
  }
  const userSnap = await db.doc(`users/${uid}`).get();
  const u = userSnap.exists ? userSnap.data() : {};
  const primary = await getUserPrimaryLabel(uid);
  console.log(`=== unsuspend 対象 ===`);
  console.log(`  uid: ${uid}`);
  console.log(`  name: ${primary.displayName}#${primary.userCode}${primary.multiGroup ? ' (歌会ごとに別名あり)' : ''}`);
  console.log(`  Firebase Auth disabled: ${authUser.disabled}`);
  console.log(`  Firestore suspended: ${u.suspended ? `true (${u.suspendedReason || ''} @ ${fmtTime(u.suspendedAt)})` : 'false'}`);
  console.log('');

  if (!authUser.disabled && !u.suspended) {
    console.log('既に解除済みです。');
    return;
  }

  const ok = await confirm('unsuspend（凍結解除）を実行しますか？');
  if (!ok) {
    console.log('中止しました。');
    return;
  }

  await admin.auth().updateUser(uid, { disabled: false });
  // revoke は逆操作が無いため、ユーザーは再サインインで新しいトークンを取得できる
  await db.doc(`users/${uid}`).set({
    suspended: admin.firestore.FieldValue.delete(),
    suspendedAt: admin.firestore.FieldValue.delete(),
    suspendedReason: admin.firestore.FieldValue.delete(),
  }, { merge: true });
  console.log(`✓ ${uid} を unsuspend しました。`);
}

async function cmdPurge(uid, reason) {
  if (!uid || !reason) {
    console.error('使い方: node monitor.js purge <uid> <reason> [--yes] [--dry-run]');
    process.exit(1);
  }
  const dryRun = flags.has('--dry-run');

  const userSnap = await db.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    console.error(`Firestore に users/${uid} が存在しません。`);
    process.exit(1);
  }
  const u = userSnap.data();
  const primary = await getUserPrimaryLabel(uid);
  console.log(`=== purge 対象 ===`);
  console.log(`  uid: ${uid}`);
  console.log(`  name: ${primary.displayName}#${primary.userCode}${primary.multiGroup ? ' (歌会ごとに別名あり)' : ''}`);
  console.log(`  suspended: ${u.suspended ? 'true' : 'false'}`);
  console.log(`  理由: ${reason}`);
  console.log(`  mode: ${dryRun ? 'DRY-RUN (書き込みなし)' : '本番実行'}`);
  console.log('');

  // myPosts が歌集（過去投稿）のインデックス。
  const myPostsSnap = await db.collection(`users/${uid}/myPosts`).get();
  console.log(`myPosts エントリ: ${myPostsSnap.size}件`);

  // 実在する posts/{postId} を引いてバケット分け。
  const toPurge = [];       // 未裁きの実在投稿 → 反故化対象
  const alreadyHogo = [];   // 既に反故（pending / caution / ban）→ 変更不要
  const missing = [];       // posts/{postId} が存在しない（作者が削除済み など）

  await Promise.all(myPostsSnap.docs.map(async (d) => {
    const my = d.data();
    const postId = my.postId || d.id;
    const postSnap = await db.doc(`posts/${postId}`).get();
    if (!postSnap.exists) { missing.push({ postId, my }); return; }
    const p = postSnap.data();
    if (p.hogo) { alreadyHogo.push({ postId, p, my }); return; }
    toPurge.push({ postId, p, my });
  }));

  console.log(`  → 反故化対象: ${toPurge.length}件`);
  console.log(`  → 既に反故: ${alreadyHogo.length}件 (変更なし)`);
  console.log(`  → 欠損: ${missing.length}件 (スキップ)`);
  console.log('');

  if (toPurge.length > 0) {
    console.log('── 反故化される投稿 (先頭10件プレビュー) ──');
    for (const { p, my } of toPurge.slice(0, 10)) {
      console.log(`  [${fmtTime(my.createdAt)}] [${my.groupName || '?'}] ${truncate(p.body || '', 50)}`);
    }
    if (toPurge.length > 10) console.log(`  ...他 ${toPurge.length - 10}件`);
    console.log('');
  }

  if (toPurge.length === 0) {
    console.log('反故化対象がありません。終了します。');
    return;
  }

  console.log('この操作で起きること:');
  console.log('  各投稿について:');
  console.log('    - posts/{postId}/private/archivedBody に原文を退避');
  console.log('    - posts/{postId} を body="" / hogo=true / hogoType="ban" / hogoReason=<理由> に更新');
  console.log('  ※ 評 (comments) は対象外。必要なら別途対応');
  console.log('');

  if (dryRun) {
    console.log('DRY-RUN モードのため書き込みは行いません。');
    return;
  }

  const ok = await confirm(`${toPurge.length}件の投稿を反故化します。実行しますか？`);
  if (!ok) {
    console.log('中止しました。');
    return;
  }

  // Firestore の batch は 500 ops 上限。1 投稿あたり 2 write なので 200 件 / batch。
  const BATCH_SIZE = 200;
  let processed = 0;
  for (let i = 0; i < toPurge.length; i += BATCH_SIZE) {
    const slice = toPurge.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { postId, p } of slice) {
      batch.set(db.doc(`posts/${postId}/private/archivedBody`), {
        body: p.body || '',
        archivedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      batch.update(db.doc(`posts/${postId}`), {
        body: '',
        hogo: true,
        hogoType: 'ban',
        hogoReason: reason,
      });
    }
    await batch.commit();
    processed += slice.length;
    console.log(`  ${processed}/${toPurge.length} 件 commit`);
  }
  console.log(`✓ ${processed}件の投稿を反故化しました。`);
}

// latest / watch / hogo の第 1 引数が `posts` | `comments` | `all` なら type として扱う。
// 数値や省略時は既存互換で type=posts。N は常にその次の引数 or 単独の数値として解釈。
function parseTypeAndN(rawArgs, defaultN) {
  const a0 = rawArgs[0];
  if (a0 === 'posts' || a0 === 'comments' || a0 === 'all') {
    return { type: a0, n: parseInt(rawArgs[1]) || defaultN };
  }
  return { type: 'posts', n: parseInt(a0) || defaultN };
}

async function cmdOrphans() {
  const dryRun = flags.has('--dry-run');
  console.log(`=== orphan 評スキャン (${dryRun ? 'DRY-RUN' : '本番実行'}) ===`);
  console.log('全ての評を走査し、作者 users/{authorId} が存在しないものを列挙します。');
  console.log('');

  // データ構造: posts/{postId}/comments/{commentId}/private/author
  // コレクション名は `private`（`author` はドキュメント ID）なので
  // collectionGroup('private') で走査する。
  const privateSnap = await db.collectionGroup('private').get();
  console.log(`private サブコレクション ドキュメント総数: ${privateSnap.size}`);

  // 評の author ドキュメントのみ抽出（authorId フィールドを持ち、パスに /comments/ を含む）
  const commentAuthors = privateSnap.docs.filter((d) =>
    d.ref.path.includes('/comments/') && d.data()?.authorId
  );
  console.log(`評の author: ${commentAuthors.length}`);

  // 作者別にグルーピング（同一作者の複数評を一括判定）
  const byAuthor = new Map();
  for (const d of commentAuthors) {
    const uid = d.data()?.authorId;
    if (!uid) continue;
    if (!byAuthor.has(uid)) byAuthor.set(uid, []);
    byAuthor.get(uid).push(d);
  }
  console.log(`ユニーク作者数: ${byAuthor.size}`);
  console.log('');

  // 各作者の users doc を確認
  const orphans = [];
  for (const [uid, docs] of byAuthor) {
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) {
      orphans.push({ uid, docs });
    }
  }

  if (orphans.length === 0) {
    console.log('orphan 評はありません。');
    return;
  }

  const totalOrphanComments = orphans.reduce((sum, o) => sum + o.docs.length, 0);
  console.log(`── orphan 作者: ${orphans.length}人 / orphan 評: ${totalOrphanComments}件 ──`);
  for (const { uid, docs } of orphans) {
    console.log(`  ${uid}  評${docs.length}件`);
  }
  console.log('');

  if (dryRun) {
    console.log('DRY-RUN モードのため削除しません。');
    return;
  }

  const ok = await confirm(`${totalOrphanComments}件の orphan 評を削除しますか？`);
  if (!ok) {
    console.log('中止しました。');
    return;
  }

  let processed = 0;
  for (const { docs } of orphans) {
    for (const authorDoc of docs) {
      const path = authorDoc.ref.path;
      try {
        const parts = path.split('/');
        const postId = parts[1];
        const commentId = parts[3];
        await authorDoc.ref.delete();
        await db.doc(`posts/${postId}/comments/${commentId}`).delete();
        // commentCount をデクリメント（post が存在する場合のみ）
        await db.doc(`posts/${postId}`).update({
          commentCount: admin.firestore.FieldValue.increment(-1),
        }).catch(() => {});
        processed++;
      } catch (e) {
        console.error(`  failed: ${path}`, e.message);
      }
    }
  }
  console.log(`✓ ${processed}/${totalOrphanComments} 件の orphan 評を削除しました。`);
}

async function main() {
  try {
    switch (cmd) {
      case 'latest': {
        const { type, n } = parseTypeAndN(args, 50);
        await cmdLatest(type, n);
        process.exit(0);
      }
      case 'watch': {
        const { type } = parseTypeAndN(args, 0);
        await cmdWatch(type);
        // watch は onSnapshot で常駐
        break;
      }
      case 'hogo': {
        const { type } = parseTypeAndN(args, 0);
        await cmdHogo(type);
        process.exit(0);
      }
      case 'group':
        await cmdGroup(args[0], parseInt(args[1]) || 30);
        process.exit(0);
      case 'public':
        await cmdPublic();
        process.exit(0);
      case 'reports':
        await cmdReports(parseInt(args[0]) || 50);
        process.exit(0);
      case 'user':
        await cmdUser(args[0], parseInt(args[1]) || 20);
        process.exit(0);
      case 'ratelimits':
        // 第1引数が日付っぽければ日付、そうでなければ件数として扱う
        {
          const maybeDate = args[0];
          const isDate = typeof maybeDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(maybeDate);
          const dateArg = isDate ? maybeDate : null;
          const nArg = parseInt(isDate ? args[1] : args[0]) || 10;
          await cmdRatelimits(dateArg, nArg);
        }
        process.exit(0);
      case 'suspend':
        await cmdSuspend(args[0], args.slice(1).join(' '));
        process.exit(0);
      case 'unsuspend':
        await cmdUnsuspend(args[0]);
        process.exit(0);
      case 'purge':
        await cmdPurge(args[0], args.slice(1).join(' '));
        process.exit(0);
      case 'orphans':
        await cmdOrphans();
        process.exit(0);
      default:
        console.error('使い方: node scripts/monitor.js <command> [args]');
        console.error('');
        console.error('  latest [TYPE] [N]            最新N件（デフォルト50）を全歌会から表示');
        console.error('                                TYPE: posts(既定) | comments | all');
        console.error('  watch [TYPE]                 新着をリアルタイム表示（Ctrl+C で終了、TYPEは上に同じ）');
        console.error('  hogo [TYPE]                  裁き済みコンテンツの一覧（TYPEは上に同じ）');
        console.error('  group <groupId> [N]          指定歌会の最近N件（デフォルト30）');
        console.error('  public                       公開歌会の一覧（趣意書つき）');
        console.error('  reports [N]                  未処理通報の一覧（デフォルト50）+ 複数通報作者サマリ');
        console.error('  user <uid> [N]               指定ユーザーの歌(直近N,デフォルト20)・rateLimits・発信通報を一覧');
        console.error('  ratelimits [YYYY-MM-DD] [N]  指定日（デフォルト今日 JST）の投稿/評/通報発信 Top N (デフォルト10)');
        console.error('  suspend <uid> <reason>       ユーザーを凍結: Auth disabled + refresh token revoke + users/{uid}.suspended 記録');
        console.error('  unsuspend <uid>              凍結解除');
        console.error('  purge <uid> <reason>         指定ユーザーの過去投稿を一括反故化（原文は archivedBody に退避）');
        console.error('  orphans                      作者 users/{authorId} が存在しない評を検出・削除');
        console.error('');
        console.error('  共通: --yes で確認プロンプトをスキップ');
        console.error('  purge / orphans: --dry-run で書き込みなしプレビューのみ');
        process.exit(1);
    }
  } catch (e) {
    // Firestore の index 不足エラーなどは e.details や e.metadata に
    // 作成用 URL が入っていることがあるので、あるだけ全部出す。
    console.error('Error:', e.message || '(no message)');
    if (e.code !== undefined) console.error('  code:', e.code);
    if (e.details) console.error('  details:', e.details);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  }
}

main();

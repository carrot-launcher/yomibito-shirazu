#!/usr/bin/env node
// 運営用監視スクリプト。サービスアカウントキーで Firebase に接続する。
// キーのパスは環境変数 GOOGLE_APPLICATION_CREDENTIALS で渡す。
//
// 使い方:
//   node scripts/monitor.js latest [N]
//   node scripts/monitor.js watch
//   node scripts/monitor.js hogo
//   node scripts/monitor.js group <groupId> [N]
//   node scripts/monitor.js public
//   node scripts/monitor.js reports [N]
//   node scripts/monitor.js user <uid> [N]
//   node scripts/monitor.js ratelimits [YYYY-MM-DD] [N]
//   node scripts/monitor.js suspend <uid> <reason> [--yes]
//   node scripts/monitor.js unsuspend <uid> [--yes]
//   node scripts/monitor.js purge <uid> <reason> [--yes] [--dry-run]
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

const groupNameCache = new Map();
async function getGroupName(groupId) {
  if (groupNameCache.has(groupId)) return groupNameCache.get(groupId);
  const snap = await db.doc(`groups/${groupId}`).get();
  const name = snap.exists ? snap.data().name || '?' : '(解散済み)';
  groupNameCache.set(groupId, name);
  return name;
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

function renderPost(p, gName) {
  const flags = [];
  if (p.hogo) flags.push(`裁き:${p.hogoType || '?'}`);
  if (p.revealedAuthorName) flags.push(`解題:${p.revealedAuthorName}#${p.revealedAuthorCode || ''}`);
  const flagStr = flags.length ? ` [${flags.join(' / ')}]` : '';
  return `[${fmtTime(p.createdAt)}] [${gName}]${flagStr} ${p.body || '(反故)'}`;
}

async function cmdLatest(n) {
  const snap = await db.collection('posts').orderBy('createdAt', 'desc').limit(n).get();
  for (const doc of snap.docs) {
    const p = doc.data();
    const gName = await getGroupName(p.groupId);
    console.log(renderPost(p, gName));
  }
}

async function cmdWatch() {
  console.log('監視中... (Ctrl+C で終了)\n');
  // 最新20件を初期バッファに。既存分は表示せず、あとから来たものだけ表示する。
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
      const p = change.doc.data();
      const gName = await getGroupName(p.groupId);
      console.log(renderPost(p, gName));
    }
  }, (err) => {
    console.error('watch error:', err.message);
    process.exit(1);
  });
}

async function cmdHogo() {
  const snap = await db.collection('posts')
    .where('hogo', '==', true)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  if (snap.empty) {
    console.log('裁き済みの投稿はありません。');
    return;
  }
  for (const doc of snap.docs) {
    const p = doc.data();
    const gName = await getGroupName(p.groupId);
    console.log(`[${fmtTime(p.createdAt)}] [${gName}] 裁き:${p.hogoType || '?'} 理由:${p.hogoReason || '(なし)'}`);
  }
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
  console.log(`=== ${g.name} (${groupId}) ===`);
  console.log(`  種類: ${g.isPublic ? '公開' : '非公開'}`);
  console.log(`  主宰: ${g.ownerDisplayName || '?'} #${g.ownerUserCode || '?'}`);
  console.log(`  メンバー数: ${g.memberCount || 0} / 投稿数: ${g.postCount || 0}`);
  if (g.purpose) console.log(`  趣意: ${g.purpose}`);
  console.log('');
  const postsSnap = await db.collection('posts')
    .where('groupId', '==', groupId)
    .orderBy('createdAt', 'desc')
    .limit(n)
    .get();
  for (const doc of postsSnap.docs) {
    const p = doc.data();
    console.log(renderPost(p, ''));
  }
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
    console.log(`── ${g.name} (${doc.id})`);
    console.log(`   主宰: ${g.ownerDisplayName || '?'} #${g.ownerUserCode || '?'}`);
    console.log(`   ${g.memberCount || 0}人 / ${g.postCount || 0}首`);
    if (g.purpose) console.log(`   趣意: ${g.purpose}`);
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
    const hogo = content?.hogo ? ` 裁き:${content.hogoType || '?'}` : '';
    console.log(`[${fmtTime(r.createdAt)}] [${gName}] ${r.targetType}${hogo}`);
    console.log(`  通報理由: ${r.reason}${r.detail ? ` / ${truncate(r.detail, 60)}` : ''}`);
    console.log(`  対象: ${truncate(body, 60)} (通報数:${reportCount})`);
    console.log(`  作者uid: ${authorId || '(取得不可)'}`);
    console.log(`  通報者uid: ${r.reporterId}`);
    console.log(`  reportId: ${id}`);
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
    console.log('── 複数通報されている作者 ──');
    for (const [uid, count] of multi) {
      console.log(`  ${uid}  (${count}件)`);
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
  console.log(`=== ${u.displayName || '(名無し)'} #${u.userCode || '------'} (${uid}) ===`);
  if (u.suspended) console.log(`  ⚠ suspended: ${u.suspendedReason || '(理由なし)'} @ ${fmtTime(u.suspendedAt)}`);
  console.log(`  参加歌会: ${(u.joinedGroups || []).length}件`);
  for (const gid of u.joinedGroups || []) {
    const gName = await getGroupName(gid);
    console.log(`    - ${gName} (${gid})`);
  }
  const blockedCount = Object.keys(u.blockedHandles || {}).length;
  const blockedByCount = Object.keys(u.blockedByHandles || {}).length;
  console.log(`  ブロック: 自分が${blockedCount}人 / 自分が${blockedByCount}人に`);
  console.log('');

  // 直近 N 件の自分の歌
  const postsSnap = await db.collection(`users/${uid}/myPosts`)
    .orderBy('createdAt', 'desc')
    .limit(n)
    .get();
  console.log(`── 直近の歌 (${postsSnap.size}件) ──`);
  for (const d of postsSnap.docs) {
    const my = d.data();
    const postSnap = await db.doc(`posts/${my.postId}`).get();
    const p = postSnap.exists ? postSnap.data() : null;
    const status = !postSnap.exists
      ? '(削除済み)'
      : p.hogo
        ? `裁き:${p.hogoType || '?'} 通報数:${p.reportCount || 0}`
        : `通報数:${p.reportCount || 0}`;
    console.log(`  [${fmtTime(my.createdAt)}] [${my.groupName || '?'}] ${status} ${truncate(my.tankaBody || '', 50)}`);
  }
  console.log('');

  // 直近 7 日分の rateLimits
  // document ID（YYYY-MM-DD）でしかソートできず、降順は Firestore がインデックス要求してくるため
  // 全件取ってクライアント側で降順ソートする。1ユーザーあたり高々数十件なので問題なし。
  const dailySnap = await db.collection(`rateLimits/${uid}/daily`).get();
  console.log(`── 直近の rateLimits (最大7日) ──`);
  if (dailySnap.empty) {
    console.log('  (データなし)');
  } else {
    const sorted = dailySnap.docs
      .slice()
      .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, 7);
    for (const d of sorted) {
      const r = d.data();
      console.log(`  ${d.id}  投稿:${r.postCount || 0} 評:${r.commentCount || 0} 通報発信:${r.reportCount || 0}`);
    }
  }
  console.log('');

  // このユーザーが通報者として出している通報（濫用チェック用）
  const filedSnap = await db.collection('reports')
    .where('reporterId', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();
  console.log(`── 本人が発した通報 (直近10件) ──`);
  if (filedSnap.empty) {
    console.log('  (なし)');
  } else {
    for (const d of filedSnap.docs) {
      const r = d.data();
      console.log(`  [${fmtTime(r.createdAt)}] status:${r.status} ${r.targetType} 理由:${r.reason}`);
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

  console.log(`=== rateLimits ${key} (${userRows.length}人) ===\n`);

  const displayNameCache = new Map();
  async function labelFor(uid) {
    if (displayNameCache.has(uid)) return displayNameCache.get(uid);
    const s = await db.doc(`users/${uid}`).get();
    const d = s.exists ? s.data() : {};
    const label = `${d.displayName || '(名無し)'} #${d.userCode || '------'}${d.suspended ? ' [SUSP]' : ''}`;
    displayNameCache.set(uid, label);
    return label;
  }

  async function renderTop(title, field) {
    const sorted = userRows
      .filter((r) => (r[field] || 0) > 0)
      .sort((a, b) => (b[field] || 0) - (a[field] || 0))
      .slice(0, n);
    console.log(`── ${title} Top${n} ──`);
    if (sorted.length === 0) {
      console.log('  (該当なし)');
    } else {
      for (const r of sorted) {
        const label = await labelFor(r.uid);
        console.log(`  ${String(r[field]).padStart(4)}  ${label}  ${r.uid}`);
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
  const label = `${u.displayName || authUser.displayName || '(名無し)'} #${u.userCode || '------'}`;
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
  console.log(`=== unsuspend 対象 ===`);
  console.log(`  uid: ${uid}`);
  console.log(`  name: ${u.displayName || '(名無し)'} #${u.userCode || '------'}`);
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
  console.log(`=== purge 対象 ===`);
  console.log(`  uid: ${uid}`);
  console.log(`  name: ${u.displayName || '(名無し)'} #${u.userCode || '------'}`);
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

async function main() {
  try {
    switch (cmd) {
      case 'latest':
        await cmdLatest(parseInt(args[0]) || 50);
        process.exit(0);
      case 'watch':
        await cmdWatch();
        // watch は onSnapshot で常駐
        break;
      case 'hogo':
        await cmdHogo();
        process.exit(0);
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
      default:
        console.error('使い方: node scripts/monitor.js <command> [args]');
        console.error('');
        console.error('  latest [N]                   最新N件（デフォルト50）を全歌会から表示');
        console.error('  watch                        新着投稿をリアルタイム表示（Ctrl+C で終了）');
        console.error('  hogo                         裁き済み投稿の一覧');
        console.error('  group <groupId> [N]          指定歌会の最近N件（デフォルト30）');
        console.error('  public                       公開歌会の一覧（趣意書つき）');
        console.error('  reports [N]                  未処理通報の一覧（デフォルト50）+ 複数通報作者サマリ');
        console.error('  user <uid> [N]               指定ユーザーの歌(直近N,デフォルト20)・rateLimits・発信通報を一覧');
        console.error('  ratelimits [YYYY-MM-DD] [N]  指定日（デフォルト今日 JST）の投稿/評/通報発信 Top N (デフォルト10)');
        console.error('  suspend <uid> <reason>       ユーザーを凍結: Auth disabled + refresh token revoke + users/{uid}.suspended 記録');
        console.error('  unsuspend <uid>              凍結解除');
        console.error('  purge <uid> <reason>         指定ユーザーの過去投稿を一括反故化（原文は archivedBody に退避）');
        console.error('');
        console.error('  共通: --yes で確認プロンプトをスキップ');
        console.error('  purge: --dry-run で書き込みなしプレビューのみ');
        process.exit(1);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();

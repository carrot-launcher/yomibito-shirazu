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
const admin = require('firebase-admin');

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('環境変数 GOOGLE_APPLICATION_CREDENTIALS にサービスアカウントキーのパスを設定してください。');
  process.exit(1);
}

admin.initializeApp();
const db = admin.firestore();

const [, , cmd, ...args] = process.argv;

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
      default:
        console.error('使い方: node scripts/monitor.js <latest|watch|hogo|group|public> [args]');
        console.error('');
        console.error('  latest [N]           最新N件（デフォルト50）を全歌会から表示');
        console.error('  watch                新着投稿をリアルタイム表示（Ctrl+C で終了）');
        console.error('  hogo                 裁き済み投稿の一覧');
        console.error('  group <groupId> [N]  指定歌会の最近N件（デフォルト30）');
        console.error('  public               公開歌会の一覧（趣意書つき）');
        process.exit(1);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();

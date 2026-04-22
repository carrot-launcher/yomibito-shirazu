// triage.js
// monitor.js から import されて、インタラクティブな管理 REPL（triage）を提供する。
//
// モード構成:
//   - list   : posts / reports の一覧
//   - tanka  : 1 件の詠草 / 評の詳細
//   - user   : 1 人のユーザーの詳細
// list → tanka → user のように積み上がり、q / Esc で戻る（スタック）。
//
// レンダリング戦略:
//   - alt-screen バッファ（\x1b[?1049h）に入り、終了時に完全リストア → 画面に何も残さない
//   - 各モード遷移で画面を clear + 全面再描画
//   - status bar を最下行に固定（ANSI cursor 位置移動で実現）
//   - ページサイズは端末の縦幅に応じて動的に変わる（ただし 1-9,0 キー選択のため最大 10）

module.exports = async function runTriage(deps) {
  const {
    db,
    C,
    // 汎用フォーマッタ
    fmtTime,
    displayWidth,
    padRightToWidth,
    toDim,
    flattenBody,
    truncate,
    // プレースホルダ系
    formatGroupPill,
    formatAuthorPill,
    formatPrimaryLabel,
    // Firestore データ取得
    getGroupName,
    getAuthorInfo,
    getUserPrimaryLabel,
    enrichPost,
    enrichComment,
    // 委譲先コマンド
    cmdGroup,
    cmdSuspend,
    cmdUnsuspend,
    cmdPurge,
    // state
    loadTriageState,
    saveTriageState,
  } = deps;

  const state = loadTriageState();
  let view = 'posts'; // 'posts' | 'reports'
  let items = [];
  let page = 0;
  const suspendedCache = new Map(); // uid -> boolean
  // 「このセッション開始時に最も新しかったアイテムの createdAt」を view 毎に記録する。
  // q で「既読にしますか？」に y と答えたらこの値まで lastSeen を進める。
  // 最後に見ていたページではなく、開いた瞬間の直近地点を閾値にする。
  const sessionTopMs = new Map(); // view -> createdAtMs

  // ==========================================================================
  // list 行レンダラ
  // { time, group, author, extras, inlineN, body, trailing } を返す
  // renderListBody が各列をパディングして本文始点を縦に揃える
  // ==========================================================================

  // 行番号 n を padWidth 幅の右寄せ文字列にしてブラケットで囲む。
  const fmtIdx = (n, padWidth) => String(n).padStart(padWidth);

  function renderTriagePost({ p, gName, uid, authorInfo }, n, padWidth) {
    const revealed = !!p.revealedAuthorName;
    const flags = [];
    if (p.hogo) flags.push(`裁き:${p.hogoType || '?'}${p.hogoReason ? `(${p.hogoReason})` : ''}`);
    const extras = flags.length ? `${C.yellow}[${flags.join(' / ')}]${C.reset}` : '';
    const groupStr = formatGroupPill(gName);
    const authorStr = uid
      ? formatAuthorPill(authorInfo?.displayName, authorInfo?.userCode, { revealed })
      : `${C.dim}[〈作者不明〉]${C.reset}`;
    const bodyStr = p.body
      ? `${C.bold}${flattenBody(p.body)}${C.reset}`
      : `${C.red}(反故)${C.reset}`;
    const timeStr = `${C.dim}[${fmtTime(p.createdAt)}]${C.reset}`;
    const inlineN = `${C.bold}[${fmtIdx(n, padWidth)}]${C.reset}`;
    return { time: timeStr, group: groupStr, author: authorStr, extras, inlineN, body: bodyStr, trailing: '' };
  }

  function renderTriageComment({ c, postBody, gName, uid, authorInfo }, n, padWidth) {
    const flags = [];
    if (c.hogo) flags.push(`裁き:${c.hogoType || '?'}${c.hogoReason ? `(${c.hogoReason})` : ''}`);
    const extras = flags.length ? `${C.yellow}[${flags.join(' / ')}]${C.reset}` : '';
    const groupStr = formatGroupPill(gName);
    const authorStr = uid
      ? formatAuthorPill(authorInfo?.displayName, authorInfo?.userCode)
      : `${C.dim}[〈作者不明〉]${C.reset}`;
    const postRef = `${C.dim}→[${postBody ? truncate(flattenBody(postBody), 20) : '〈投稿欠損〉'}]${C.reset}`;
    const bodyStr = c.body
      ? `${C.bold}${flattenBody(c.body)}${C.reset}`
      : `${C.red}(反故)${C.reset}`;
    const timeStr = `${C.dim}[${fmtTime(c.createdAt)}]${C.reset}`;
    const inlineN = `${C.bold}[${fmtIdx(n, padWidth)}]${C.reset}`;
    return { time: timeStr, group: groupStr, author: authorStr, extras, inlineN, body: bodyStr, trailing: ` ${postRef}` };
  }

  function renderReportRow(item, n, padWidth) {
    const r = item.r;
    const bodyStr = item.content?.body
      ? `${C.bold}${flattenBody(item.content.body)}${C.reset}`
      : `${C.red}(反故)${C.reset}`;
    const authorStr = item.uid
      ? formatAuthorPill(item.authorInfo?.displayName, item.authorInfo?.userCode)
      : `${C.dim}[〈作者不明〉]${C.reset}`;
    const count = item.content?.reportCount ?? '?';
    const countStr = typeof count === 'number' && count >= 3
      ? `${C.red}${count}${C.reset}`
      : `${C.yellow}${count}${C.reset}`;
    const detail = r.detail ? ` / ${truncate(r.detail, 30)}` : '';
    const groupStr = formatGroupPill(item.gName);
    const timeStr = `${C.dim}[${fmtTime(r.createdAt)}]${C.reset}`;
    const inlineN = `${C.bold}[${fmtIdx(n, padWidth)}]${C.reset}`;
    const extras = `${C.yellow}[${r.reason}${detail}]${C.reset} ${C.dim}通報:${C.reset}${countStr}`;
    return { time: timeStr, group: groupStr, author: authorStr, extras, inlineN, body: bodyStr, trailing: '' };
  }

  // ==========================================================================
  // データロード
  // ==========================================================================

  async function enrichSuspendedState(list) {
    const uids = [...new Set(list.map((i) => i.uid).filter(Boolean))];
    const toFetch = uids.filter((u) => !suspendedCache.has(u));
    await Promise.all(toFetch.map(async (uid) => {
      try {
        const s = await db.doc(`users/${uid}`).get();
        suspendedCache.set(uid, s.exists && !!s.data()?.suspended);
      } catch {
        suspendedCache.set(uid, false);
      }
    }));
    for (const item of list) {
      item.isSuspended = item.uid ? !!suspendedCache.get(item.uid) : false;
    }
  }

  async function loadPosts() {
    const [postsSnap, commentsSnap] = await Promise.all([
      db.collection('posts').orderBy('createdAt', 'desc').limit(100).get(),
      db.collectionGroup('comments').orderBy('createdAt', 'desc').limit(100).get(),
    ]);
    const raw = [];
    for (const d of postsSnap.docs) raw.push({ kind: 'post', doc: d });
    for (const d of commentsSnap.docs) raw.push({ kind: 'comment', doc: d });
    // top=new: 新しいものを上に
    raw.sort((a, b) => {
      const at = a.doc.data()?.createdAt?.toMillis?.() || 0;
      const bt = b.doc.data()?.createdAt?.toMillis?.() || 0;
      return bt - at;
    });
    const enriched = await Promise.all(raw.map(async (it) => {
      const e = it.kind === 'post' ? await enrichPost(it.doc) : await enrichComment(it.doc);
      if (!e) return null;
      return { ...e, kind: it.kind, createdAtMs: it.doc.data()?.createdAt?.toMillis?.() || 0 };
    }));
    items = enriched.filter(Boolean);
    await enrichSuspendedState(items);
  }

  async function loadReports() {
    const snap = await db.collection('reports')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    // Firestore 側で DESC 済みなのでそのまま使う（top=new）
    const enriched = await Promise.all(snap.docs.map(async (d) => {
      const r = d.data();
      const [gName, authorId, contentSnap] = await Promise.all([
        getGroupName(r.groupId),
        deps.getContentAuthorId({ targetType: r.targetType, targetId: r.targetId, postId: r.postId }),
        (r.targetType === 'comment'
          ? db.doc(`posts/${r.postId}/comments/${r.targetId}`).get()
          : db.doc(`posts/${r.targetId}`).get()),
      ]);
      const content = contentSnap.exists ? contentSnap.data() : null;
      const authorInfo = authorId ? await getAuthorInfo(r.groupId, authorId) : null;
      return {
        kind: 'report',
        reportId: d.id,
        r,
        gName,
        gId: r.groupId,
        uid: authorId,
        authorInfo,
        content,
        createdAtMs: r.createdAt?.toMillis?.() || 0,
      };
    }));
    items = enriched;
    await enrichSuspendedState(items);
  }

  async function reload() {
    if (view === 'posts') await loadPosts();
    else await loadReports();
    // top=new なので常にページ 0（= 最新）に着地。
    page = 0;
    // この view を今セッションで初めて開いた場合のみ、当時の最新 createdAt を記録。
    // 後から view を再訪（h ↔ l の往復）しても上書きしないことで、
    // quit 時の既読閾値がブレないようにする。
    if (!sessionTopMs.has(view) && items.length > 0) {
      sessionTopMs.set(view, items[0].createdAtMs || 0);
    }
  }

  async function loadUserCtx(uid) {
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    const joinedGroups = userData?.joinedGroups || [];
    const groupMemberships = await Promise.all(joinedGroups.map(async (gid) => {
      const [gName, info] = await Promise.all([
        getGroupName(gid),
        getAuthorInfo(gid, uid),
      ]);
      return { gid, gName, info };
    }));
    const postsSnap = await db.collection(`users/${uid}/myPosts`)
      .orderBy('createdAt', 'desc').limit(10).get();
    const myPosts = await Promise.all(postsSnap.docs.map(async (d) => {
      const my = d.data();
      const postSnap = await db.doc(`posts/${my.postId}`).get();
      return { my, post: postSnap.exists ? postSnap.data() : null, exists: postSnap.exists };
    }));
    const dailySnap = await db.collection(`rateLimits/${uid}/daily`).get();
    const dailies = dailySnap.docs.slice()
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, 7)
      .map((d) => ({ id: d.id, ...d.data() }));
    const primary = await getUserPrimaryLabel(uid);
    return { uid, userData, primary, groupMemberships, myPosts, dailies };
  }

  // ==========================================================================
  // 端末 / alt-screen ユーティリティ
  // ==========================================================================

  const termRows = () => process.stdout.rows || 24;
  // ヘッダ 2 行 + 空行 1 + 件数サマリ 1 + 本文ヘッダ 1 + ステータスバー 1 ≈ 6 行のマージン。
  // 1 桁キー(1-9,0) で先頭 10 行は即時選択、それ以降は `i` で複数桁入力する。
  const pageSize = () => Math.max(5, termRows() - 6);
  const enterAlt = () => process.stdout.write('\x1b[?1049h\x1b[H\x1b[2J');
  const leaveAlt = () => process.stdout.write('\x1b[?1049l');
  const clearScreen = () => process.stdout.write('\x1b[H\x1b[2J');
  const moveToRow = (r) => process.stdout.write(`\x1b[${r};1H`);

  // ==========================================================================
  // モード・スタック
  // ==========================================================================

  let mode = 'list';          // 'list' | 'tanka' | 'user'
  const modeStack = [];
  let tankaItem = null;
  let userCtx = null;

  function pushMode(newMode) {
    modeStack.push({ mode, tankaItem, userCtx });
    mode = newMode;
  }
  function popMode() {
    if (modeStack.length === 0) return false;
    const s = modeStack.pop();
    mode = s.mode;
    tankaItem = s.tankaItem;
    userCtx = s.userCtx;
    return true;
  }

  // ==========================================================================
  // 既読 操作
  // ==========================================================================

  // top=new + 単一カットポイントだと「見たところまで既読」の mark は構造的に表現不能
  // （ページの天井を lastSeen にすると、それより新しい未読ページが道連れで既読化される）。
  // なので mark は廃止。既読化は q → y で session top まで一気に進めるのみ。
  // u だけは page 単位で正しく動く: lastSeen を現在ページの底より 1ms 前まで下げる
  // → 現在ページと、より新しい（= 上の）ページが全て未読扱いに戻る。
  function stateKeyForView() {
    return view === 'posts' ? 'lastSeenPostAt' : 'lastSeenReportAt';
  }
  function doUnmarkList() {
    const ps = pageSize();
    const pageItems = items.slice(page * ps, (page + 1) * ps);
    if (pageItems.length === 0) return;
    const pageBottom = pageItems[pageItems.length - 1].createdAtMs || 0;
    const target = Math.max(0, pageBottom - 1);
    const key = stateKeyForView();
    state[key] = Math.min(state[key], target);
    saveTriageState(state);
  }
  // quit 時に両 view のセッション最新地点まで lastSeen を進める。
  // ユーザが quit 時に y と答えた場合のみ呼ばれる。
  function commitAllSessionTops() {
    const postTop = sessionTopMs.get('posts');
    if (postTop !== undefined) {
      state.lastSeenPostAt = Math.max(state.lastSeenPostAt, postTop);
    }
    const reportTop = sessionTopMs.get('reports');
    if (reportTop !== undefined) {
      state.lastSeenReportAt = Math.max(state.lastSeenReportAt, reportTop);
    }
  }

  // ==========================================================================
  // レンダリング
  // ==========================================================================

  function renderHeader(title, breadcrumbParts) {
    const bc = breadcrumbParts.length
      ? `${C.dim} < ${breadcrumbParts.join(' < ')}${C.reset}`
      : '';
    console.log(`${C.cyan}${C.bold}${title}${C.reset}${bc}`);
  }

  function renderListBody() {
    const ps = pageSize();
    const lastSeen = view === 'posts' ? state.lastSeenPostAt : state.lastSeenReportAt;
    const totalPages = Math.max(1, Math.ceil(items.length / ps));
    const pageItems = items.slice(page * ps, (page + 1) * ps);
    const newCount = items.filter((i) => (i.createdAtMs || 0) > lastSeen).length;
    const readCount = items.length - newCount;

    console.log(`${C.dim}new:${C.reset}${newCount > 0 ? C.cyan + newCount + C.reset : C.dim + '0' + C.reset}${C.dim} / read:${readCount} / total:${items.length} / page ${page + 1}/${totalPages}${C.reset}`);
    console.log('');

    if (pageItems.length === 0) {
      console.log(`  ${C.dim}(なし)${C.reset}`);
      return;
    }
    // 行番号のゼロ詰め幅。pageItems.length が 10 なら最終 index は 9 で幅 1、
    // 11 以上なら幅 2、100 以上なら幅 3。1 桁キー選択可能数を超えるケースの見た目を揃える。
    const padWidth = Math.max(1, String(Math.max(0, pageItems.length - 1)).length);
    const parts = pageItems.map((item, i) =>
      view === 'posts'
        ? (item.kind === 'post' ? renderTriagePost(item, i, padWidth) : renderTriageComment(item, i, padWidth))
        : renderReportRow(item, i, padWidth)
    );
    const maxGroupW = Math.max(...parts.map((p) => displayWidth(p.group)));
    const maxAuthorW = Math.max(...parts.map((p) => displayWidth(p.author)));
    const maxExtrasW = Math.max(...parts.map((p) => displayWidth(p.extras || '')));
    const hasExtras = maxExtrasW > 0;

    for (let i = 0; i < pageItems.length; i++) {
      const item = pageItems[i];
      const read = (item.createdAtMs || 0) <= lastSeen;
      const { time, group, author, extras, inlineN, body, trailing } = parts[i];
      const pGroup = padRightToWidth(group, maxGroupW);
      const pAuthor = padRightToWidth(author, maxAuthorW);
      const extrasCol = hasExtras ? ' ' + padRightToWidth(extras || '', maxExtrasW) : '';
      const susp = item.isSuspended ? ` ${C.red}${C.bold}[SUSP]${C.reset}` : '';
      const idx = `[${fmtIdx(i, padWidth)}]`;
      const base = `${time} ${pGroup} ${pAuthor}${extrasCol} ${inlineN} ${body}${trailing}`;
      const line = read
        ? `${C.dim}${idx}${C.reset} ${toDim(base)}${susp}`
        : `${C.bold}${idx}${C.reset} ${base}${susp}`;
      console.log(line);
    }
  }

  function renderTankaBody() {
    if (!tankaItem) return;
    const item = tankaItem;
    const isComment = item.kind === 'comment';
    const doc = isComment ? item.c : item.p;

    const timeStr = fmtTime(doc?.createdAt);
    const groupStr = formatGroupPill(item.gName);
    const revealed = !!doc?.revealedAuthorName;
    const authorStr = item.uid
      ? formatAuthorPill(item.authorInfo?.displayName, item.authorInfo?.userCode, { revealed })
      : `${C.dim}[〈作者不明〉]${C.reset}`;
    const susp = item.isSuspended ? ` ${C.red}${C.bold}[SUSP]${C.reset}` : '';
    const kindLabel = isComment ? `${C.magenta}${C.bold}評${C.reset}` : `${C.cyan}${C.bold}歌${C.reset}`;

    console.log(`${kindLabel}  ${C.dim}[${timeStr}]${C.reset}  ${groupStr}  ${authorStr}${susp}`);

    if (doc?.hogo) {
      console.log(`${C.yellow}裁き: ${doc.hogoType || '?'}${doc.hogoReason ? ` / ${doc.hogoReason}` : ''}${C.reset}`);
    }
    console.log('');

    if (doc?.body) {
      for (const line of doc.body.split(/\r?\n/)) console.log(`  ${C.bold}${line}${C.reset}`);
    } else {
      console.log(`  ${C.red}(反故)${C.reset}`);
    }
    console.log('');

    if (isComment && item.postBody) {
      console.log(`${C.dim}→ 元の詠草:${C.reset}`);
      for (const line of item.postBody.split(/\r?\n/)) console.log(`  ${C.dim}${line}${C.reset}`);
      console.log('');
    }

    if (!isComment && doc?.reactionSummary) {
      const reacts = Object.entries(doc.reactionSummary)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}${v}`)
        .join(' ');
      if (reacts) console.log(`${C.dim}リアクション:${C.reset} ${reacts}`);
    }
    const rc = doc?.reportCount;
    if (typeof rc === 'number' && rc > 0) {
      console.log(`${C.dim}通報数:${C.reset} ${C.red}${rc}${C.reset}`);
    }
    if (!isComment && doc?.revealedAuthorName) {
      console.log(`${C.dim}解題:${C.reset} ${C.yellow}${doc.revealedAuthorName}#${doc.revealedAuthorCode || ''}${C.reset}`);
    }
    console.log('');
    console.log(`${C.dim}postId:${C.reset} ${item.postId || '?'}`);
    console.log(`${C.dim}groupId:${C.reset} ${item.gId || '?'}`);
    console.log(`${C.dim}authorId:${C.reset} ${item.uid || '?'}`);
    if (isComment) console.log(`${C.dim}commentId:${C.reset} ${item.commentId}`);
  }

  function renderUserBody() {
    if (!userCtx) return;
    const { uid, userData, primary, groupMemberships, myPosts, dailies } = userCtx;
    if (!userData) {
      console.log(`${C.dim}〈存在しない〉 uid=${uid}${C.reset}`);
      return;
    }
    const multiMark = primary.multiGroup ? ` ${C.dim}※歌会ごとに別名あり${C.reset}` : '';
    console.log(`${formatPrimaryLabel(primary)} ${C.dim}(${uid})${C.reset}${multiMark}`);
    if (userData.suspended) {
      console.log(`${C.red}${C.bold}⚠ suspended:${C.reset} ${C.red}${userData.suspendedReason || '(理由なし)'}${C.reset} ${C.dim}@ ${fmtTime(userData.suspendedAt)}${C.reset}`);
    }
    console.log('');
    console.log(`${C.dim}参加歌会:${C.reset} ${groupMemberships.length}件`);
    for (const { gid, gName, info } of groupMemberships) {
      const nameInGroup = info ? ` ${C.dim}[${info.displayName}#${info.userCode}]${C.reset}` : '';
      console.log(`  - ${formatGroupPill(gName)}${nameInGroup}`);
    }
    const blockedCount = Object.keys(userData.blockedHandles || {}).length;
    const blockedByCount = Object.keys(userData.blockedByHandles || {}).length;
    console.log(`${C.dim}ブロック:${C.reset} 自分が${blockedCount}人 ${C.dim}/${C.reset} 自分が${blockedByCount}人に`);
    console.log('');
    console.log(`${C.gray}── 直近の歌 (最大10件、番号で選択可) ──${C.reset}`);
    if (myPosts.length === 0) {
      console.log(`  ${C.dim}(なし)${C.reset}`);
    } else {
      for (let i = 0; i < myPosts.length; i++) {
        const idx = `[${i}]`;
        const { my, post, exists } = myPosts[i];
        const status = !exists
          ? `${C.dim}(削除済み)${C.reset}`
          : post?.hogo
            ? `${C.yellow}裁き:${post.hogoType || '?'}${C.reset}`
            : '';
        const bodyStr = my.tankaBody
          ? `${C.bold}${truncate(flattenBody(my.tankaBody), 50)}${C.reset}`
          : `${C.dim}(空)${C.reset}`;
        console.log(`  ${C.bold}${idx}${C.reset} ${C.dim}[${fmtTime(my.createdAt)}]${C.reset} ${formatGroupPill(my.groupName || '?')} ${status} ${bodyStr}`);
      }
    }
    console.log('');
    console.log(`${C.gray}── 直近の rateLimits (最大7日) ──${C.reset}`);
    if (dailies.length === 0) {
      console.log(`  ${C.dim}(データなし)${C.reset}`);
    } else {
      for (const d of dailies) {
        console.log(`  ${C.dim}${d.id}${C.reset}  投稿:${d.postCount || 0} 評:${d.commentCount || 0} 通報発信:${d.reportCount || 0}`);
      }
    }
  }

  function statusBarFor(m) {
    const k = (label, letter) => `${C.cyan}${letter}${C.dim}:${label}`;
    if (m === 'list') {
      return ` ${k('next', 'j')} ${k('prev', 'k')} ${k('詳細', '0-9')} ${k('任意番号', 'i')} ${k('unmark', 'u')} ${k('posts', 'h')} ${k('reports', 'l')} ${k('refresh', 'r')} ${k('quit', 'q')} ${k('help', '?')}`;
    }
    if (m === 'tanka') {
      return ` ${k('user', 'u')} ${k('group', 'g')} ${k('purge', 'p')} ${k('back', 'q')} ${k('help', '?')}`;
    }
    if (m === 'user') {
      return ` ${k('suspend', 's')} ${k('unsuspend', 'U')} ${k('歌を選択', '0-9/i')} ${k('refresh', 'r')} ${k('back', 'q')} ${k('help', '?')}`;
    }
    return '';
  }

  function drawStatusBar(m) {
    const rows = termRows();
    const bar = statusBarFor(m);
    moveToRow(rows);
    process.stdout.write(`\x1b[K${C.dim}${bar}${C.reset}`);
  }

  async function redraw() {
    clearScreen();
    if (mode === 'list') {
      const viewLabel = view === 'posts' ? 'posts' : 'reports';
      renderHeader(viewLabel, []);
      console.log('');
      renderListBody();
    } else if (mode === 'tanka') {
      const crumbs = modeStack.map((s) => s.mode);
      renderHeader('tanka', crumbs);
      console.log('');
      renderTankaBody();
    } else if (mode === 'user') {
      const crumbs = modeStack.map((s) => s.mode);
      renderHeader('user', crumbs);
      console.log('');
      renderUserBody();
    }
    drawStatusBar(mode);
  }

  function showHelp() {
    clearScreen();
    console.log(`${C.bold}triage ヘルプ${C.reset}`);
    console.log('');
    console.log(`${C.cyan}[list mode]${C.reset}  posts / reports の一覧（新しいほど上）`);
    console.log(`  ${C.cyan}0-9${C.reset}  先頭 10 行を即時選択 → tanka モードへ`);
    console.log(`  ${C.cyan}i${C.reset}    任意の行番号を入力（複数桁対応、Enter 確定 / Esc 中止）`);
    console.log(`  ${C.cyan}j${C.reset} 次ページ（遡る） / ${C.cyan}k${C.reset} 前ページ（戻る）`);
    console.log(`  ${C.cyan}u${C.reset} 現在ページ＋それより新しいページを未読に戻す`);
    console.log(`  ${C.cyan}h${C.reset} posts ビュー  ${C.cyan}l${C.reset} reports ビュー`);
    console.log(`  ${C.cyan}r${C.reset} refresh  ${C.cyan}q${C.reset} 終了（landing 時の最新まで既読にするか確認）`);
    console.log('');
    console.log(`${C.cyan}[tanka mode]${C.reset}  1 件の詠草/評の詳細`);
    console.log(`  ${C.cyan}u${C.reset} 作者の詳細 (user モード)`);
    console.log(`  ${C.cyan}g${C.reset} 歌会の詳細`);
    console.log(`  ${C.cyan}p${C.reset} purge（理由を入力）`);
    console.log(`  ${C.cyan}q${C.reset} / ${C.cyan}Esc${C.reset} 前のモードに戻る`);
    console.log('');
    console.log(`${C.cyan}[user mode]${C.reset}  ユーザー詳細`);
    console.log(`  ${C.cyan}s${C.reset} suspend（理由を入力）`);
    console.log(`  ${C.cyan}U${C.reset} unsuspend`);
    console.log(`  ${C.cyan}0-9${C.reset}  直近の歌から選択 → tanka モード`);
    console.log(`  ${C.cyan}i${C.reset}    任意の歌番号を入力`);
    console.log(`  ${C.cyan}r${C.reset} refresh  ${C.cyan}q${C.reset} 戻る`);
    console.log('');
    console.log(`${C.dim}共通: Ctrl+C で中断（既読保存なし）${C.reset}`);
    console.log('');
    console.log(`${C.dim}(任意のキーで戻る)${C.reset}`);
  }

  // ==========================================================================
  // インライン入力・破壊系コマンドの alt-screen 内実行
  // ==========================================================================

  // 最下行にインライン入力プロンプトを表示し、Enter で確定・Esc でキャンセル。
  // alt-screen を抜けないのでチラつかない。
  // validate: (ch, buf) => true/false — 受け入れる文字か判定する関数
  // 返り値: 入力文字列（trim 済み）、または null（キャンセル・空）
  async function promptInline(label, validate) {
    let buf = '';
    const draw = () => {
      const rows = termRows();
      moveToRow(rows);
      process.stdout.write(`\x1b[K${C.cyan}${label}:${C.reset} ${buf}${C.dim}_ (Enter確定 / Esc中止)${C.reset}`);
    };
    draw();
    try {
      while (true) {
        const key = await waitKey();
        if (key === '\r' || key === '\n') {
          const v = buf.trim();
          return v || null;
        }
        // bare Esc でキャンセル。arrow key 等の ESC シーケンス (\x1b[A など) は無視。
        if (key === '\x1b') return null;
        if (key.startsWith('\x1b')) continue;
        if (key === '\u0003') throw new Error('interrupted');
        if (key === '\x7f' || key === '\b') {
          const chars = Array.from(buf);
          chars.pop();
          buf = chars.join('');
          draw();
          continue;
        }
        if (validate(key, buf)) {
          buf += key;
          draw();
          continue;
        }
      }
    } finally {
      // 最下行を status bar 復元のためクリア（呼び出し側で drawStatusBar or redraw）
    }
  }

  async function promptNumber(label) {
    const s = await promptInline(label, (ch, buf) => /^[0-9]$/.test(ch) && buf.length < 6);
    if (s === null) return null;
    const v = parseInt(s, 10);
    return Number.isFinite(v) ? v : null;
  }

  async function promptText(label, maxLen = 200) {
    return await promptInline(label, (ch, buf) => {
      // 印字可能な UTF-8 文字を受け入れる。制御文字（code < 0x20）は拒否。
      if (buf.length >= maxLen) return false;
      const cp = ch.codePointAt(0);
      return cp !== undefined && cp >= 0x20;
    });
  }

  // y/N をインラインに 1 キーで受ける（Enter = N, y = Y, Esc = N）。
  async function promptYesNo(label) {
    const rows = termRows();
    moveToRow(rows);
    process.stdout.write(`\x1b[K${C.cyan}${label}${C.reset} ${C.dim}(y/N):${C.reset} `);
    while (true) {
      const key = await waitKey();
      if (key === '\u0003') throw new Error('interrupted');
      if (/^[yY]$/.test(key)) return true;
      if (/^[nN]$/.test(key) || key === '\r' || key === '\n' || key === '\x1b') return false;
    }
  }

  // 破壊系コマンドを alt-screen 内で実行する。
  // ・まず画面をクリア（ヘッダ等を消して出力スペースを確保）
  // ・fn にはフェイク rl を渡す。rl.question("...[y/N]: ") はインライン y/N に差し替わる
  // ・終了後に「任意キーで戻る」を最下行に出して待機 → redraw で元モードに復帰
  async function runInAlt(fn) {
    clearScreen();
    const fakeRl = {
      question: (prompt, cb) => {
        const label = String(prompt || '').replace(/\s*\[y\/N\]:\s*$/i, '').trim();
        promptYesNo(label)
          .then((yes) => cb(yes ? 'y' : 'n'))
          .catch(() => cb('n'));
      },
      close: () => {},
    };
    try {
      await fn(fakeRl);
    } finally {
      moveToRow(termRows());
      process.stdout.write(`\x1b[K${C.dim}(任意のキーで戻る)${C.reset}`);
      await waitKey();
      await redraw();
    }
  }

  // ==========================================================================
  // キー処理
  // ==========================================================================

  async function selectListRow(n) {
    const ps = pageSize();
    if (n < 0 || n >= ps) return;
    const absIdx = page * ps + n;
    if (absIdx < 0 || absIdx >= items.length) return;
    const item = items[absIdx];
    if (item.kind === 'report') {
      try {
        const postId = item.r.postId;
        const commentId = item.r.targetType === 'comment' ? item.r.targetId : null;
        let enriched;
        if (commentId) {
          const commentSnap = await db.doc(`posts/${postId}/comments/${commentId}`).get();
          if (!commentSnap.exists) return;
          enriched = await enrichComment(commentSnap);
          if (enriched) {
            enriched.kind = 'comment';
            enriched.createdAtMs = commentSnap.data()?.createdAt?.toMillis?.() || 0;
          }
        } else {
          const postSnap = await db.doc(`posts/${postId}`).get();
          if (!postSnap.exists) return;
          enriched = await enrichPost(postSnap);
          if (enriched) {
            enriched.kind = 'post';
            enriched.createdAtMs = postSnap.data()?.createdAt?.toMillis?.() || 0;
          }
        }
        if (!enriched) return;
        await enrichSuspendedState([enriched]);
        pushMode('tanka');
        tankaItem = enriched;
        await redraw();
      } catch {}
      return;
    }
    pushMode('tanka');
    tankaItem = item;
    await redraw();
  }

  async function handleListKey(key) {
    const ps = pageSize();
    if (/^[0-9]$/.test(key)) {
      await selectListRow(parseInt(key, 10));
      return;
    }
    if (key === 'i') {
      const n = await promptNumber('行番号');
      if (n !== null) await selectListRow(n);
      return;
    }
    if (key === 'q') {
      const yes = await promptYesNo('最新地点まで既読にしますか？');
      if (yes) commitAllSessionTops();
      saveTriageState(state);
      return 'quit-all';
    }
    if (key === 'j') {
      const totalPages = Math.max(1, Math.ceil(items.length / ps));
      if (page + 1 < totalPages) { page++; await redraw(); }
      return;
    }
    if (key === 'k') {
      if (page > 0) { page--; await redraw(); }
      return;
    }
    if (key === 'u') { doUnmarkList(); await redraw(); return; }
    if (key === 'h') {
      if (view !== 'posts') { view = 'posts'; await reload(); }
      await redraw();
      return;
    }
    if (key === 'l') {
      if (view !== 'reports') { view = 'reports'; await reload(); }
      await redraw();
      return;
    }
    if (key === 'r') { await reload(); await redraw(); return; }
    if (key === '?') { showHelp(); await waitKey(); await redraw(); return; }
  }

  async function handleTankaKey(key) {
    if (!tankaItem) return;
    if (key === 'q' || key === '\x1b') { popMode(); await redraw(); return; }
    if (key === 'u') {
      if (!tankaItem.uid) return;
      pushMode('user');
      try { userCtx = await loadUserCtx(tankaItem.uid); }
      catch (e) { popMode(); return; }
      await redraw();
      return;
    }
    if (key === 'g') {
      if (!tankaItem.gId) return;
      await runInAlt(async () => {
        await cmdGroup(tankaItem.gId, 30);
      });
      return;
    }
    if (key === 'p') {
      if (!tankaItem.uid) return;
      const reason = await promptText('purge 理由');
      if (!reason) { await redraw(); return; }
      await runInAlt(async (rl) => {
        await cmdPurge(tankaItem.uid, reason, rl);
      });
      return;
    }
    if (key === '?') { showHelp(); await waitKey(); await redraw(); return; }
  }

  async function handleUserKey(key) {
    if (!userCtx) return;
    if (key === 'q' || key === '\x1b') { popMode(); await redraw(); return; }
    if (key === 's') {
      const reason = await promptText('suspend 理由');
      if (!reason) { await redraw(); return; }
      await runInAlt(async (rl) => {
        await cmdSuspend(userCtx.uid, reason, rl);
      });
      suspendedCache.delete(userCtx.uid);
      try { userCtx = await loadUserCtx(userCtx.uid); } catch {}
      await redraw();
      return;
    }
    if (key === 'U') {
      await runInAlt(async (rl) => {
        await cmdUnsuspend(userCtx.uid, rl);
      });
      suspendedCache.delete(userCtx.uid);
      try { userCtx = await loadUserCtx(userCtx.uid); } catch {}
      await redraw();
      return;
    }
    if (key === 'r') {
      try { userCtx = await loadUserCtx(userCtx.uid); } catch {}
      await redraw();
      return;
    }
    if (/^[0-9]$/.test(key) || key === 'i') {
      let n;
      if (key === 'i') {
        n = await promptNumber('歌番号');
        if (n === null) return;
      } else {
        n = parseInt(key, 10);
      }
      const entry = userCtx.myPosts[n];
      if (!entry || !entry.exists) return;
      const postId = entry.my.postId;
      const postSnap = await db.doc(`posts/${postId}`).get();
      if (!postSnap.exists) return;
      const enriched = await enrichPost(postSnap);
      if (!enriched) return;
      enriched.kind = 'post';
      enriched.createdAtMs = postSnap.data()?.createdAt?.toMillis?.() || 0;
      await enrichSuspendedState([enriched]);
      pushMode('tanka');
      tankaItem = enriched;
      await redraw();
      return;
    }
    if (key === '?') { showHelp(); await waitKey(); await redraw(); return; }
  }

  async function handleKey(key) {
    if (mode === 'list') return await handleListKey(key);
    if (mode === 'tanka') return await handleTankaKey(key);
    if (mode === 'user') return await handleUserKey(key);
  }

  // ==========================================================================
  // Main loop
  // ==========================================================================

  const stdin = process.stdin;
  if (!stdin.isTTY) {
    console.error('このコマンドは TTY 環境でのみ動作します。');
    return;
  }

  const waitKey = () => new Promise((resolve) => {
    stdin.once('data', (d) => resolve(d.toString()));
  });

  await reload();

  enterAlt();
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  const onResize = () => { redraw().catch(() => {}); };
  process.stdout.on('resize', onResize);

  try {
    await redraw();
    while (true) {
      const key = await waitKey();
      if (key === '\u0003') break;  // Ctrl+C
      try {
        const result = await handleKey(key);
        if (result === 'quit-all') break;
      } catch (e) {
        moveToRow(termRows());
        process.stdout.write(`\x1b[K${C.red}エラー: ${e.message}${C.reset}`);
        await waitKey();
        await redraw();
      }
    }
  } finally {
    process.stdout.off('resize', onResize);
    try { stdin.setRawMode(false); } catch {}
    stdin.pause();
    leaveAlt();
  }
};

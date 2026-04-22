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
  // グローバル匿名化トグル。デフォルト ON で displayName を '〈匿名〉' に差し替える。
  // 〈名無し〉〈離脱済み〉等のプレースホルダは対象外（既に匿名扱い）。
  // e キーでトグル。userCode と歌会名は常に顕名のまま。
  let anonymize = true;

  const isAnonCandidate = (s) => typeof s === 'string' && s.length > 0 && !s.includes('〈');
  function authorPill(displayName, userCode, opts) {
    if (anonymize && isAnonCandidate(displayName)) {
      return formatAuthorPill('〈匿名〉', userCode, opts);
    }
    return formatAuthorPill(displayName, userCode, opts);
  }
  function primaryLabel(primary) {
    if (anonymize && isAnonCandidate(primary.displayName)) {
      return formatPrimaryLabel({ ...primary, displayName: '〈匿名〉' });
    }
    return formatPrimaryLabel(primary);
  }
  function nameInGroupText(info) {
    if (!info) return '';
    const name = anonymize && isAnonCandidate(info.displayName) ? '〈匿名〉' : info.displayName;
    return ` ${C.dim}[${name}#${info.userCode}]${C.reset}`;
  }
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
      ? authorPill(authorInfo?.displayName, authorInfo?.userCode, { revealed })
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
      ? authorPill(authorInfo?.displayName, authorInfo?.userCode)
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
      ? authorPill(item.authorInfo?.displayName, item.authorInfo?.userCode)
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

  const USER_FEED_PAGE = 20;

  // myPosts 1 ドキュメントから feed 表示用のエントリに変換する。
  // exists: true ならフル enrichPost 済み（作者情報・グループ情報込み）
  async function enrichMyPost(myDoc) {
    const my = myDoc.data();
    const postSnap = await db.doc(`posts/${my.postId}`).get();
    if (!postSnap.exists) return { my, exists: false, doc: myDoc };
    const enriched = await enrichPost(postSnap);
    if (!enriched) return { my, exists: false, doc: myDoc };
    return {
      my,
      exists: true,
      doc: myDoc,
      enriched: { ...enriched, kind: 'post', createdAtMs: postSnap.data()?.createdAt?.toMillis?.() || 0 },
    };
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
      .orderBy('createdAt', 'desc').limit(USER_FEED_PAGE).get();
    const myPosts = await Promise.all(postsSnap.docs.map(enrichMyPost));
    const feedCursor = postsSnap.docs[postsSnap.docs.length - 1] || null;
    const feedHasMore = postsSnap.docs.length === USER_FEED_PAGE;
    const dailySnap = await db.collection(`rateLimits/${uid}/daily`).get();
    const dailies = dailySnap.docs.slice()
      .sort((a, b) => (a.id < b.id ? 1 : -1))
      .slice(0, 7)
      .map((d) => ({ id: d.id, ...d.data() }));
    const primary = await getUserPrimaryLabel(uid);
    const feedAuthorSuspended = !!userData?.suspended;
    return {
      uid, userData, primary, groupMemberships, myPosts, dailies,
      feedCursor, feedHasMore, feedAuthorSuspended,
    };
  }

  async function loadMoreUserFeed() {
    if (!userCtx || !userCtx.feedHasMore || !userCtx.feedCursor) return false;
    let q = db.collection(`users/${userCtx.uid}/myPosts`)
      .orderBy('createdAt', 'desc')
      .startAfter(userCtx.feedCursor)
      .limit(USER_FEED_PAGE);
    const snap = await q.get();
    const more = await Promise.all(snap.docs.map(enrichMyPost));
    userCtx.myPosts.push(...more);
    userCtx.feedCursor = snap.docs[snap.docs.length - 1] || userCtx.feedCursor;
    userCtx.feedHasMore = snap.docs.length === USER_FEED_PAGE;
    return more.length > 0;
  }

  const GROUP_FEED_PAGE = 20;

  async function enrichGroupPost(postDoc) {
    const e = await enrichPost(postDoc);
    if (!e) return null;
    return {
      ...e,
      kind: 'post',
      createdAtMs: postDoc.data()?.createdAt?.toMillis?.() || 0,
      doc: postDoc,
    };
  }

  async function loadGroupCtx(gid) {
    const [groupDocSnap, postsSnap] = await Promise.all([
      db.doc(`groups/${gid}`).get(),
      db.collection('posts')
        .where('groupId', '==', gid)
        .orderBy('createdAt', 'desc')
        .limit(GROUP_FEED_PAGE)
        .get(),
    ]);
    const groupData = groupDocSnap.exists ? groupDocSnap.data() : null;
    const posts = (await Promise.all(postsSnap.docs.map(enrichGroupPost))).filter(Boolean);
    await enrichSuspendedState(posts);
    const postCursor = postsSnap.docs[postsSnap.docs.length - 1] || null;
    const postHasMore = postsSnap.docs.length === GROUP_FEED_PAGE;
    return { gid, groupData, posts, postCursor, postHasMore };
  }

  async function loadMoreGroupPosts() {
    if (!groupCtx || !groupCtx.postHasMore || !groupCtx.postCursor) return false;
    const snap = await db.collection('posts')
      .where('groupId', '==', groupCtx.gid)
      .orderBy('createdAt', 'desc')
      .startAfter(groupCtx.postCursor)
      .limit(GROUP_FEED_PAGE)
      .get();
    const more = (await Promise.all(snap.docs.map(enrichGroupPost))).filter(Boolean);
    await enrichSuspendedState(more);
    groupCtx.posts.push(...more);
    groupCtx.postCursor = snap.docs[snap.docs.length - 1] || groupCtx.postCursor;
    groupCtx.postHasMore = snap.docs.length === GROUP_FEED_PAGE;
    return more.length > 0;
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

  // mode: 'list' | 'tanka' | 'group'
  // tanka モードは「投稿詳細 + 作者情報（参加歌会/ブロック/rateLimits/歌）」の統合ビュー。
  // userCtx は tanka モードで並行保持され、作者の情報セクションをレンダリングする。
  let mode = 'list';
  let tankaItem = null;
  let userCtx = null;
  let groupCtx = null;
  // ドキュメントスクロールの viewport offset（行単位）。
  // list モードは page ベースなので未使用。tanka/user で j/k が scrollOffset を動かす。
  let scrollOffset = 0;

  // ブラウザ風 back/forward 履歴。
  //  - 新しい画面に進む (navigateTo): 現在のスナップショットを back に積み、forward をクリア
  //  - h: back から pop → 現在を forward に積む → 復元
  //  - l: forward から pop → 現在を back に積む → 復元
  //  - p/r (posts/reports への jump): 両 stack をクリアして list ルートへ
  const backStack = [];
  const forwardStack = [];

  function snapshot() {
    return { mode, tankaItem, userCtx, groupCtx, view, page, scrollOffset };
  }
  function restoreSnapshot(s) {
    mode = s.mode;
    tankaItem = s.tankaItem;
    userCtx = s.userCtx;
    groupCtx = s.groupCtx;
    view = s.view;
    page = s.page;
    scrollOffset = s.scrollOffset || 0;
  }
  function navigateTo(newMode) {
    backStack.push(snapshot());
    forwardStack.length = 0;
    mode = newMode;
    scrollOffset = 0;
  }
  function goBack() {
    if (backStack.length === 0) return false;
    forwardStack.push(snapshot());
    restoreSnapshot(backStack.pop());
    return true;
  }
  function goForward() {
    if (forwardStack.length === 0) return false;
    backStack.push(snapshot());
    restoreSnapshot(forwardStack.pop());
    return true;
  }
  async function jumpToListRoot(newView) {
    backStack.length = 0;
    forwardStack.length = 0;
    mode = 'list';
    tankaItem = null;
    userCtx = null;
    groupCtx = null;
    scrollOffset = 0;
    if (view !== newView) {
      view = newView;
      await reload();
    }
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

  // renderer は行配列 (string[]) を返す。redraw で連結 → viewport で slice → 出力。

  // renderTriagePost/Comment/Report が返した parts dict から 1 行文字列を組み立てる。
  // omitAuthor/omitGroup でカラムを抑制できる（user 画面では作者が自明、group 画面では歌会が自明）。
  function computeWidths(partsList, { omitAuthor = false, omitGroup = false } = {}) {
    const safeMax = (arr) => arr.length === 0 ? 0 : Math.max(...arr);
    return {
      group: omitGroup ? 0 : safeMax(partsList.map((p) => displayWidth(p.group))),
      author: omitAuthor ? 0 : safeMax(partsList.map((p) => displayWidth(p.author))),
      extras: safeMax(partsList.map((p) => displayWidth(p.extras || ''))),
    };
  }
  function assembleRow(parts, widths, opts = {}) {
    const { idx, isRead = false, isSuspended = false, omitAuthor = false, omitGroup = false } = opts;
    const { time, group, author, extras, inlineN, body, trailing } = parts;
    const cols = [time];
    if (!omitGroup) cols.push(padRightToWidth(group, widths.group));
    if (!omitAuthor) cols.push(padRightToWidth(author, widths.author));
    const extrasCol = widths.extras > 0 ? ' ' + padRightToWidth(extras || '', widths.extras) : '';
    const susp = isSuspended ? ` ${C.red}${C.bold}[SUSP]${C.reset}` : '';
    const base = `${cols.join(' ')}${extrasCol} ${inlineN} ${body}${trailing}`;
    return isRead
      ? `${C.dim}${idx}${C.reset} ${toDim(base)}${susp}`
      : `${C.bold}${idx}${C.reset} ${base}${susp}`;
  }

  function renderHeader(title, breadcrumbParts) {
    const bc = breadcrumbParts.length
      ? `${C.dim} < ${breadcrumbParts.join(' < ')}${C.reset}`
      : '';
    return [`${C.cyan}${C.bold}${title}${C.reset}${bc}`];
  }

  function renderListBody() {
    const out = [];
    const ps = pageSize();
    const lastSeen = view === 'posts' ? state.lastSeenPostAt : state.lastSeenReportAt;
    const totalPages = Math.max(1, Math.ceil(items.length / ps));
    const pageItems = items.slice(page * ps, (page + 1) * ps);
    const newCount = items.filter((i) => (i.createdAtMs || 0) > lastSeen).length;
    const readCount = items.length - newCount;

    out.push(`${C.dim}new:${C.reset}${newCount > 0 ? C.cyan + newCount + C.reset : C.dim + '0' + C.reset}${C.dim} / read:${readCount} / total:${items.length} / page ${page + 1}/${totalPages}${C.reset}`);
    out.push('');

    if (pageItems.length === 0) {
      out.push(`  ${C.dim}(なし)${C.reset}`);
      return out;
    }
    const padWidth = Math.max(1, String(Math.max(0, pageItems.length - 1)).length);
    const parts = pageItems.map((item, i) =>
      view === 'posts'
        ? (item.kind === 'post' ? renderTriagePost(item, i, padWidth) : renderTriageComment(item, i, padWidth))
        : renderReportRow(item, i, padWidth)
    );
    const widths = computeWidths(parts);
    for (let i = 0; i < pageItems.length; i++) {
      const item = pageItems[i];
      out.push(assembleRow(parts[i], widths, {
        idx: `[${fmtIdx(i, padWidth)}]`,
        isRead: (item.createdAtMs || 0) <= lastSeen,
        isSuspended: item.isSuspended,
      }));
    }
    return out;
  }

  function renderTankaBody() {
    const out = [];
    if (!tankaItem) return out;
    const item = tankaItem;
    const isComment = item.kind === 'comment';
    const doc = isComment ? item.c : item.p;

    const timeStr = fmtTime(doc?.createdAt);
    const groupStr = formatGroupPill(item.gName);
    const revealed = !!doc?.revealedAuthorName;
    const authorStr = item.uid
      ? authorPill(item.authorInfo?.displayName, item.authorInfo?.userCode, { revealed })
      : `${C.dim}[〈作者不明〉]${C.reset}`;
    const susp = item.isSuspended ? ` ${C.red}${C.bold}[SUSP]${C.reset}` : '';
    const kindLabel = isComment ? `${C.magenta}${C.bold}評${C.reset}` : `${C.cyan}${C.bold}歌${C.reset}`;

    out.push(`${kindLabel}  ${C.dim}[${timeStr}]${C.reset}  ${groupStr}  ${authorStr}${susp}`);
    if (doc?.hogo) {
      out.push(`${C.yellow}裁き: ${doc.hogoType || '?'}${doc.hogoReason ? ` / ${doc.hogoReason}` : ''}${C.reset}`);
    }
    out.push('');

    if (doc?.body) {
      for (const line of doc.body.split(/\r?\n/)) out.push(`  ${C.bold}${line}${C.reset}`);
    } else {
      out.push(`  ${C.red}(反故)${C.reset}`);
    }
    out.push('');

    if (isComment && item.postBody) {
      out.push(`${C.dim}→ 元の詠草:${C.reset}`);
      for (const line of item.postBody.split(/\r?\n/)) out.push(`  ${C.dim}${line}${C.reset}`);
      out.push('');
    }

    if (!isComment && doc?.reactionSummary) {
      const reacts = Object.entries(doc.reactionSummary)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}${v}`)
        .join(' ');
      if (reacts) out.push(`${C.dim}リアクション:${C.reset} ${reacts}`);
    }
    const rc = doc?.reportCount;
    if (typeof rc === 'number' && rc > 0) {
      out.push(`${C.dim}通報数:${C.reset} ${C.red}${rc}${C.reset}`);
    }
    if (!isComment && doc?.revealedAuthorName) {
      out.push(`${C.dim}解題:${C.reset} ${C.yellow}${doc.revealedAuthorName}#${doc.revealedAuthorCode || ''}${C.reset}`);
    }
    out.push('');
    out.push(`${C.dim}postId:${C.reset} ${item.postId || '?'}`);
    out.push(`${C.dim}groupId:${C.reset} ${item.gId || '?'}`);
    out.push(`${C.dim}authorId:${C.reset} ${item.uid || '?'}`);
    if (isComment) out.push(`${C.dim}commentId:${C.reset} ${item.commentId}`);

    // 統合ビュー: 作者情報を下に追加
    if (userCtx) {
      out.push('');
      out.push(`${C.gray}══════════════════ 作者情報 ══════════════════${C.reset}`);
      out.push('');
      out.push(...renderUserBody());
    }
    return out;
  }

  function renderGroupBody() {
    const out = [];
    if (!groupCtx) return out;
    const { gid, groupData, posts, postHasMore } = groupCtx;
    if (!groupData) {
      out.push(`${C.dim}〈解散済み〉 gid=${gid}${C.reset}`);
      return out;
    }
    const name = groupData.name || '〈無名の歌会〉';
    const isPublic = !!groupData.isPublic;
    const badge = isPublic ? `${C.green}[公開]${C.reset}` : `${C.dim}[非公開]${C.reset}`;
    out.push(`${formatGroupPill(name)} ${badge} ${C.dim}(${gid})${C.reset}`);
    if (groupData.description) {
      for (const line of String(groupData.description).split(/\r?\n/)) {
        out.push(`  ${C.dim}${line}${C.reset}`);
      }
    }
    out.push('');

    out.push(`${C.gray}── 概要 ──${C.reset}`);
    const memberCount = Array.isArray(groupData.members) ? groupData.members.length
      : (typeof groupData.memberCount === 'number' ? groupData.memberCount : '?');
    out.push(`  ${C.dim}メンバ数:${C.reset} ${memberCount}`);
    if (groupData.createdAt) out.push(`  ${C.dim}作成:${C.reset} ${fmtTime(groupData.createdAt)}`);
    if (groupData.lastPostAt) out.push(`  ${C.dim}最終投稿:${C.reset} ${fmtTime(groupData.lastPostAt)}`);
    if (groupData.ownerId) out.push(`  ${C.dim}オーナー:${C.reset} ${groupData.ownerId}`);
    out.push('');

    // --- 歌（歌会名は自明なので omitGroup） ---
    out.push(`${C.gray}── 歌 (${posts.length}件${postHasMore ? '+' : ''}、番号で選択可) ──${C.reset}`);
    if (posts.length === 0) {
      out.push(`  ${C.dim}(なし)${C.reset}`);
    } else {
      const padWidth = Math.max(1, String(Math.max(0, posts.length - 1)).length);
      const parts = posts.map((p, i) => renderTriagePost(p, i, padWidth));
      const widths = computeWidths(parts, { omitGroup: true });
      for (let i = 0; i < posts.length; i++) {
        out.push('  ' + assembleRow(parts[i], widths, {
          idx: `[${fmtIdx(i, padWidth)}]`,
          isSuspended: posts[i].isSuspended,
          omitGroup: true,
        }));
      }
      if (postHasMore) {
        out.push(`  ${C.dim}(下にスクロールして更に読込)${C.reset}`);
      }
    }
    return out;
  }

  function renderUserBody() {
    const out = [];
    if (!userCtx) return out;
    const { uid, userData, primary, groupMemberships, myPosts, dailies, feedHasMore } = userCtx;
    if (!userData) {
      out.push(`${C.dim}〈存在しない〉 uid=${uid}${C.reset}`);
      return out;
    }
    const multiMark = primary.multiGroup ? ` ${C.dim}※歌会ごとに別名あり${C.reset}` : '';
    out.push(`${primaryLabel(primary)} ${C.dim}(${uid})${C.reset}${multiMark}`);
    if (userData.suspended) {
      out.push(`${C.red}${C.bold}⚠ suspended:${C.reset} ${C.red}${userData.suspendedReason || '(理由なし)'}${C.reset} ${C.dim}@ ${fmtTime(userData.suspendedAt)}${C.reset}`);
    }
    out.push('');

    // --- 参加歌会 ---
    out.push(`${C.gray}── 参加歌会 (${groupMemberships.length}件) ──${C.reset}`);
    if (groupMemberships.length === 0) {
      out.push(`  ${C.dim}(なし)${C.reset}`);
    } else {
      for (const { gName, info } of groupMemberships) {
        out.push(`  - ${formatGroupPill(gName)}${nameInGroupText(info)}`);
      }
    }
    out.push('');

    // --- ブロック ---
    const blockedCount = Object.keys(userData.blockedHandles || {}).length;
    const blockedByCount = Object.keys(userData.blockedByHandles || {}).length;
    out.push(`${C.gray}── ブロック ──${C.reset}`);
    out.push(`  自分が${blockedCount}人 ${C.dim}/${C.reset} 自分が${blockedByCount}人に`);
    out.push('');

    // --- rateLimits ---
    out.push(`${C.gray}── 直近の rateLimits (最大7日) ──${C.reset}`);
    if (dailies.length === 0) {
      out.push(`  ${C.dim}(データなし)${C.reset}`);
    } else {
      for (const d of dailies) {
        out.push(`  ${C.dim}${d.id}${C.reset}  投稿:${d.postCount || 0} 評:${d.commentCount || 0} 通報発信:${d.reportCount || 0}`);
      }
    }
    out.push('');

    // --- 歌（posts 同形式で表示。作者列は自明なので省略） ---
    out.push(`${C.gray}── 歌 (${myPosts.length}件${feedHasMore ? '+' : ''}、番号で選択可) ──${C.reset}`);
    if (myPosts.length === 0) {
      out.push(`  ${C.dim}(なし)${C.reset}`);
    } else {
      const padWidth = Math.max(1, String(Math.max(0, myPosts.length - 1)).length);
      // 表示可能な post entry のみを parts 変換。削除済みは別行で出す。
      const partsAndIdx = [];
      for (let i = 0; i < myPosts.length; i++) {
        const entry = myPosts[i];
        if (!entry.exists) continue;
        partsAndIdx.push({ i, parts: renderTriagePost(entry.enriched, i, padWidth) });
      }
      const widths = computeWidths(partsAndIdx.map((p) => p.parts), { omitAuthor: true });
      let partsCursor = 0;
      for (let i = 0; i < myPosts.length; i++) {
        const entry = myPosts[i];
        const idxLabel = `[${fmtIdx(i, padWidth)}]`;
        if (!entry.exists) {
          const t = entry.my?.createdAt ? `${C.dim}[${fmtTime(entry.my.createdAt)}]${C.reset}` : '';
          const g = entry.my?.groupName ? formatGroupPill(entry.my.groupName) : '';
          out.push(`  ${C.dim}${idxLabel}${C.reset} ${t} ${g} ${C.red}(削除済み)${C.reset}`);
          continue;
        }
        const { parts } = partsAndIdx[partsCursor++];
        out.push('  ' + assembleRow(parts, widths, {
          idx: idxLabel,
          isSuspended: false, // feed 内のアイテム作者は同じユーザー。上部ヘッダで既に表示済み。
          omitAuthor: true,
        }));
      }
      if (feedHasMore) {
        out.push(`  ${C.dim}(下にスクロールして更に読込)${C.reset}`);
      }
    }
    return out;
  }

  function statusBarFor(m) {
    const k = (label, letter) => `${C.cyan}${letter}${C.dim}:${label}`;
    // 全モード共通のグローバル key
    const anonMark = anonymize ? `${C.green}匿${C.reset}` : `${C.yellow}顕${C.reset}`;
    const globals = ` ${k('next', 'j')} ${k('prev', 'k')} ${k('back', 'h')} ${k('fwd', 'l')} ${k('posts', 'p')} ${k('reports', 'r')} ${k('refresh', 'R')} ${k('expand', 'e')}[${anonMark}] ${k('quit', 'q')} ${k('help', '?')}`;
    if (m === 'list') {
      return `${globals} ${C.dim}|${C.reset} ${k('詳細', '0-9')} ${k('任意番号', 'i')} ${k('unmark', 'u')}`;
    }
    if (m === 'tanka') {
      return `${globals} ${C.dim}|${C.reset} ${k('group', 'g')} ${k('purge', 'P')} ${k('suspend', 'S')} ${k('unsuspend', 'U')} ${k('歌', '0-9/i')}`;
    }
    if (m === 'group') {
      return `${globals} ${C.dim}|${C.reset} ${k('歌', '0-9/i')}`;
    }
    return '';
  }

  function drawStatusBar(m) {
    const rows = termRows();
    const bar = statusBarFor(m);
    moveToRow(rows);
    process.stdout.write(`\x1b[K${C.dim}${bar}${C.reset}`);
  }

  // 現在のモード・状態から全ボディ行を生成する。viewport は redraw 側で切り出す。
  function buildBodyLines() {
    const lines = [];
    if (mode === 'list') {
      const viewLabel = view === 'posts' ? 'posts' : 'reports';
      lines.push(...renderHeader(viewLabel, []));
      lines.push('');
      lines.push(...renderListBody());
    } else if (mode === 'tanka') {
      lines.push(...renderHeader('tanka', backStack.map((s) => s.mode)));
      lines.push('');
      lines.push(...renderTankaBody());
    } else if (mode === 'group') {
      lines.push(...renderHeader('group', backStack.map((s) => s.mode)));
      lines.push('');
      lines.push(...renderGroupBody());
    }
    return lines;
  }

  // モードごとのドキュメントスクロール許容判定。list は page ベースなので対象外。
  const isScrollableMode = () => mode === 'tanka' || mode === 'group';

  async function redraw() {
    const lines = buildBodyLines();
    const maxBodyRows = Math.max(1, termRows() - 1);
    const maxOffset = Math.max(0, lines.length - maxBodyRows);
    if (!isScrollableMode()) scrollOffset = 0;
    scrollOffset = Math.min(Math.max(0, scrollOffset), maxOffset);
    const body = lines.slice(scrollOffset, scrollOffset + maxBodyRows).join('\n');
    clearScreen();
    process.stdout.write(body);
    drawStatusBar(mode);
  }

  function showHelp() {
    clearScreen();
    console.log(`${C.bold}triage ヘルプ${C.reset}`);
    console.log('');
    console.log(`${C.cyan}[グローバル]${C.reset} どのモードでも有効`);
    console.log(`  ${C.cyan}j${C.reset} スクロール下（次ページ/遡る） / ${C.cyan}k${C.reset} スクロール上（前ページ/戻る）`);
    console.log(`  ${C.cyan}h${C.reset} / ${C.cyan}Esc${C.reset}  戻る（履歴を 1 つ戻る）`);
    console.log(`  ${C.cyan}l${C.reset}       進む（h で戻った履歴を復元）`);
    console.log(`  ${C.cyan}p${C.reset} posts ルートへジャンプ（履歴消去）`);
    console.log(`  ${C.cyan}r${C.reset} reports ルートへジャンプ（履歴消去）`);
    console.log(`  ${C.cyan}R${C.reset} 現在の画面を再読込`);
    console.log(`  ${C.cyan}e${C.reset} 匿名化トグル（デフォルト ON: 作者の displayName を '〈匿名〉' に差し替え。userCode と歌会名は常に顕名）`);
    console.log(`  ${C.cyan}q${C.reset} 終了（landing 時の最新まで既読にするか確認）`);
    console.log(`  ${C.cyan}?${C.reset} このヘルプ`);
    console.log('');
    console.log(`${C.cyan}[list mode]${C.reset}  posts / reports 一覧（新しいほど上）`);
    console.log(`  ${C.cyan}0-9${C.reset}  先頭 10 行を即時選択 → tanka モードへ`);
    console.log(`  ${C.cyan}i${C.reset}    任意の行番号を入力（複数桁対応、Enter 確定 / Esc 中止）`);
    console.log(`  ${C.cyan}u${C.reset}    現在ページ＋それより新しいページを未読に戻す`);
    console.log('');
    console.log(`${C.cyan}[tanka mode]${C.reset}  詠草/評の詳細 + 作者情報統合ビュー`);
    console.log(`                 作者情報セクション: 参加歌会 / ブロック / rateLimits / 歌`);
    console.log(`  ${C.cyan}g${C.reset} 歌会の詳細へ`);
    console.log(`  ${C.cyan}P${C.reset} purge（大文字、理由を入力）`);
    console.log(`  ${C.cyan}S${C.reset} suspend（大文字、理由を入力）`);
    console.log(`  ${C.cyan}U${C.reset} unsuspend`);
    console.log(`  ${C.cyan}0-9${C.reset}  作者の歌から選択 → 別の tanka へ（同一作者なら userCtx 再利用）`);
    console.log(`  ${C.cyan}i${C.reset}    任意の歌番号を入力`);
    console.log(`  ${C.cyan}j${C.reset} スクロール下（作者の歌の底で自動 load-more）`);
    console.log('');
    console.log(`${C.cyan}[group mode]${C.reset}  歌会詳細（概要 + 歌）`);
    console.log(`  ${C.cyan}0-9${C.reset}  歌から選択 → tanka モード`);
    console.log(`  ${C.cyan}i${C.reset}    任意の歌番号を入力`);
    console.log(`  ${C.cyan}j${C.reset} スクロール下（底で自動 load-more）`);
    console.log('');
    console.log(`${C.dim}Ctrl+C で中断（既読保存なし）${C.reset}`);
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
        await openTanka(enriched);
      } catch {}
      return;
    }
    await openTanka(item);
  }

  // R キー: 現在の画面を再取得
  async function refreshCurrent() {
    if (mode === 'list') {
      await reload();
    } else if (mode === 'group' && groupCtx) {
      try { groupCtx = await loadGroupCtx(groupCtx.gid); } catch {}
    } else if (mode === 'tanka' && tankaItem) {
      try {
        if (tankaItem.kind === 'comment') {
          const snap = await db.doc(`posts/${tankaItem.postId}/comments/${tankaItem.commentId}`).get();
          if (snap.exists) {
            const e = await enrichComment(snap);
            if (e) tankaItem = { ...e, kind: 'comment', createdAtMs: snap.data()?.createdAt?.toMillis?.() || 0 };
          }
        } else {
          const snap = await db.doc(`posts/${tankaItem.postId}`).get();
          if (snap.exists) {
            const e = await enrichPost(snap);
            if (e) tankaItem = { ...e, kind: 'post', createdAtMs: snap.data()?.createdAt?.toMillis?.() || 0 };
          }
        }
      } catch {}
      // 統合ビューなので作者情報も同時に再取得
      if (tankaItem?.uid) {
        try { userCtx = await loadUserCtx(tankaItem.uid); } catch {}
      }
    }
    await redraw();
  }

  // j/k のスクロール。list は page ベース、それ以外はドキュメント行単位。
  // user モードで底に達したら自動 load-more。
  async function handleScrollDown() {
    if (mode === 'list') {
      const ps = pageSize();
      const totalPages = Math.max(1, Math.ceil(items.length / ps));
      if (page + 1 < totalPages) { page++; await redraw(); }
      return;
    }
    const lines = buildBodyLines();
    const maxBodyRows = Math.max(1, termRows() - 1);
    const maxOffset = Math.max(0, lines.length - maxBodyRows);
    const step = Math.max(1, maxBodyRows - 1); // 1 行オーバーラップしてページ送り
    if (scrollOffset < maxOffset) {
      scrollOffset = Math.min(scrollOffset + step, maxOffset);
      await redraw();
      return;
    }
    // 既に底。作者の歌 / 歌会の歌を追加ロード。
    let added = false;
    if (mode === 'tanka' && userCtx?.feedHasMore) added = await loadMoreUserFeed();
    else if (mode === 'group' && groupCtx?.postHasMore) added = await loadMoreGroupPosts();
    if (added) {
      const nextLines = buildBodyLines();
      const nextMax = Math.max(0, nextLines.length - maxBodyRows);
      scrollOffset = Math.min(scrollOffset + step, nextMax);
      await redraw();
    }
  }
  async function handleScrollUp() {
    if (mode === 'list') {
      if (page > 0) { page--; await redraw(); }
      return;
    }
    if (scrollOffset > 0) {
      const maxBodyRows = Math.max(1, termRows() - 1);
      const step = Math.max(1, maxBodyRows - 1);
      scrollOffset = Math.max(0, scrollOffset - step);
      await redraw();
    }
  }

  async function handleListKey(key) {
    if (/^[0-9]$/.test(key)) { await selectListRow(parseInt(key, 10)); return; }
    if (key === 'i') {
      const n = await promptNumber('行番号');
      if (n !== null) await selectListRow(n);
      return;
    }
    if (key === 'u') { doUnmarkList(); await redraw(); return; }
  }

  async function openGroupMode(gid) {
    if (!gid) return;
    navigateTo('group');
    try { groupCtx = await loadGroupCtx(gid); }
    catch (e) { goBack(); return false; }
    await redraw();
    return true;
  }

  // tanka + user 統合ビューへ遷移。tankaItem と（作者 uid があれば）userCtx を揃える。
  // navigateTo 前後で userCtx の状態を見て、同じ作者なら再 fetch を省く。
  async function openTanka(tanka) {
    const nextUid = tanka?.uid || null;
    const keepUserCtx = nextUid && userCtx && userCtx.uid === nextUid ? userCtx : null;
    navigateTo('tanka');
    tankaItem = tanka;
    if (keepUserCtx) {
      userCtx = keepUserCtx;
    } else if (nextUid) {
      try { userCtx = await loadUserCtx(nextUid); }
      catch { userCtx = null; }
    } else {
      userCtx = null;
    }
    await redraw();
  }

  async function handleTankaKey(key) {
    if (!tankaItem) return;
    if (key === 'g') {
      await openGroupMode(tankaItem.gId);
      return;
    }
    if (key === 'P') {
      if (!tankaItem.uid) return;
      const reason = await promptText('purge 理由');
      if (!reason) { await redraw(); return; }
      await runInAlt(async (rl) => { await cmdPurge(tankaItem.uid, reason, rl); });
      return;
    }
    // 以下は統合された user 操作（作者が存在する場合のみ）。
    if (!userCtx) return;
    if (key === 'S') {
      const reason = await promptText('suspend 理由');
      if (!reason) { await redraw(); return; }
      await runInAlt(async (rl) => { await cmdSuspend(userCtx.uid, reason, rl); });
      suspendedCache.delete(userCtx.uid);
      try { userCtx = await loadUserCtx(userCtx.uid); } catch {}
      await redraw();
      return;
    }
    if (key === 'U') {
      await runInAlt(async (rl) => { await cmdUnsuspend(userCtx.uid, rl); });
      suspendedCache.delete(userCtx.uid);
      try { userCtx = await loadUserCtx(userCtx.uid); } catch {}
      await redraw();
      return;
    }
    // 作者の歌セクションから別の歌へ（同じ作者なので userCtx は再利用される）。
    if (/^[0-9]$/.test(key) || key === 'i') {
      let n;
      if (key === 'i') {
        n = await promptNumber('歌番号');
        if (n === null) return;
      } else {
        n = parseInt(key, 10);
      }
      const entry = userCtx.myPosts[n];
      if (!entry || !entry.exists || !entry.enriched) return;
      const enriched = { ...entry.enriched };
      await enrichSuspendedState([enriched]);
      await openTanka(enriched);
      return;
    }
  }

  // グローバル key 優先、その後モード固有へ委譲。
  async function handleKey(key) {
    if (key === '?') { showHelp(); await waitKey(); await redraw(); return; }
    if (key === 'q') {
      const yes = await promptYesNo('最新地点まで既読にしますか？');
      if (yes) commitAllSessionTops();
      saveTriageState(state);
      return 'quit-all';
    }
    // back: h または Esc。ルートでは no-op。
    if (key === 'h' || key === '\x1b') { if (goBack()) await redraw(); return; }
    if (key === 'l') { if (goForward()) await redraw(); return; }
    // jump to list root（履歴消去）
    if (key === 'p') { await jumpToListRoot('posts'); await redraw(); return; }
    if (key === 'r') { await jumpToListRoot('reports'); await redraw(); return; }
    if (key === 'R') { await refreshCurrent(); return; }
    if (key === 'e') { anonymize = !anonymize; await redraw(); return; }
    if (key === 'j') { await handleScrollDown(); return; }
    if (key === 'k') { await handleScrollUp(); return; }

    if (mode === 'list') return await handleListKey(key);
    if (mode === 'tanka') return await handleTankaKey(key);
    if (mode === 'group') return await handleGroupKey(key);
  }

  async function handleGroupKey(key) {
    if (!groupCtx) return;
    if (/^[0-9]$/.test(key) || key === 'i') {
      let n;
      if (key === 'i') {
        n = await promptNumber('歌番号');
        if (n === null) return;
      } else {
        n = parseInt(key, 10);
      }
      const entry = groupCtx.posts[n];
      if (!entry) return;
      const picked = { ...entry };
      await enrichSuspendedState([picked]);
      await openTanka(picked);
      return;
    }
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

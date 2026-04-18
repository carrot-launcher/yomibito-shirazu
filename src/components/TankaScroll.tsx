import React, { useEffect, useMemo, useRef } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { TankaCard } from '../types';
import { formatTankaBody } from '../utils/formatTanka';

interface Props {
  cards: TankaCard[];
  onTap: (postId: string, groupId: string, batchId?: string) => void;
  onLongPress?: (postId: string, groupId: string, batchId?: string) => void;
  mode: 'timeline' | 'myPosts' | 'bookmarks';
  onLoadMore?: () => void;
  generation?: number;
  newArrivals?: TankaCard[];
  arrivalGen?: number;
  unreadSince?: Date | null;
  changedCards?: TankaCard[];
  removedIds?: string[];
  updateGen?: number;
}

const screenWidth = Dimensions.get('window').width;
const scale = screenWidth / 390;
const tankaFontSize = Math.round(20 * (scale < 1 ? scale : 1 + (scale - 1) * 0.7));
const metaFontSize = Math.round(11 * Math.max(screenWidth / 390, 1));

function serializeCards(cards: TankaCard[]) {
  return cards.map(c => ({
    ...c,
    body: c.hogo ? '' : formatTankaBody(c.body, 'timeline', {
      convertHalfSpace: (c as any).convertHalfSpace,
      convertLineBreak: (c as any).convertLineBreak,
    }),
    createdAt: c.createdAt?.toISOString?.() || new Date().toISOString(),
    bookmarkedAt: c.bookmarkedAt?.toISOString?.() || null,
  }));
}

function buildHtml(cards: TankaCard[], mode: string, hasLoadMore: boolean, colors: ThemeColors): string {
  const cardsJson = JSON.stringify(serializeCards(cards));

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    height: 100%;
    background: ${colors.webViewBg};
    font-family: "Noto Serif JP", "Yu Mincho", "Hiragino Mincho Pro", serif;
    overflow-x: auto;
    overflow-y: hidden;
  }
  body { visibility: hidden; }
  .container {
    display: inline-flex;
    flex-direction: row-reverse;
    align-items: stretch;
    height: 100%;
    min-width: 100%;
    padding: 8px 0px;
    gap: 0;
  }
  .tanka-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 64px;
    flex: none;
    padding: 8px 18px;
    cursor: pointer;
    transition: background 0.2s;
    border-right: 1px solid ${colors.border};
  }
  .tanka-card:first-child { border-right: none; }
  .tanka-card:active { background: ${colors.cardPress}; }
  .tanka-card.unread { background: ${colors.unread}; }
  .tanka-body {
    writing-mode: vertical-rl;
    font-size: ${tankaFontSize}px;
    line-height: 2.0;
    letter-spacing: 0.1em;
    color: ${colors.text};
    flex: 1;
    overflow: hidden;
  }
  .tanka-body.hogo {
    font-style: italic;
    color: ${colors.textTertiary};
    font-size: ${Math.round(tankaFontSize * 0.8)}px;
  }
  rt { font-size: 0.45em; letter-spacing: 0; }
  .tanka-meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin-top: 12px;
    font-size: ${metaFontSize}px;
    color: ${colors.textSecondary};
    width: 0;
    min-width: 100%;
  }
  .reactions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .reaction-item { white-space: nowrap; }
  .group-info {
    font-size: ${metaFontSize - 1}px;
    color: ${colors.textTertiary};
    text-align: center;
    word-break: break-all;
  }
  .comment-count { font-size: ${metaFontSize}px; color: ${colors.textSecondary}; }
  .revealed-author { font-size: ${metaFontSize}px; color: ${colors.text}; }
  .time-ago { font-size: ${metaFontSize - 1}px; color: ${colors.textTertiary}; margin-top: 2px; }
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    color: ${colors.textTertiary};
    font-size: 17px;
    font-family: "Noto Serif JP", "Yu Mincho", "Hiragino Mincho Pro", serif;
  }
</style>
</head>
<body>
<div class="container" id="container"></div>
<script>
var cards = ${cardsJson};
var mode = "${mode}";
var hasLoadMore = ${hasLoadMore};
var unreadSinceMs = null;
var container = document.getElementById("container");
var cardCount = 0;
var loadMoreRequested = false;

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function rubyToHtml(escaped) {
  return escaped.replace(/\\{([^|{}]+)\\|([^|{}]+)\\}/g,
    '<ruby>$1<rp>(</rp><rt>$2</rt><rp>)</rp></ruby>');
}

function getTimeAgo(date) {
  var now = new Date();
  var diff = now - date;
  var min = Math.floor(diff / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return min + '分前';
  var hr = Math.floor(min / 60);
  if (hr < 24) return hr + '時間前';
  var day = Math.floor(hr / 24);
  if (day < 30) return day + '日前';
  return Math.floor(day / 30) + 'ヶ月前';
}

function createCardEl(card, index) {
  var el = document.createElement("div");
  var t = new Date(card.createdAt).getTime();
  el.setAttribute('data-created-at', String(t));
  el.setAttribute('data-post-id', card.postId);
  var isUnread = unreadSinceMs !== null && t > unreadSinceMs;
  el.className = isUnread ? "tanka-card unread" : "tanka-card";
  var fade = Math.max(0.6, 1 - (index / 8) * 0.7);
  el.style.opacity = fade;
  // 評の長押しと同じパターン: 500ms 以上で長押し → postMenu。それ以外は短押しで navigate。
  var cardPressTimer = null;
  var cardLongPressed = false;
  el.addEventListener('touchstart', function() {
    cardLongPressed = false;
    cardPressTimer = setTimeout(function() {
      cardLongPressed = true;
      var msg = { action: 'postMenu', postId: card.postId, groupId: card.groupId };
      if (mode === 'myPosts' && card.batchId) msg.batchId = card.batchId;
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }, 500);
  });
  el.addEventListener('touchend', function() {
    clearTimeout(cardPressTimer);
    if (!cardLongPressed) {
      var msg = { postId: card.postId, groupId: card.groupId };
      if (mode === 'myPosts' && card.batchId) msg.batchId = card.batchId;
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  });
  el.addEventListener('touchmove', function() { clearTimeout(cardPressTimer); });

  var metaHtml = '';
  if (mode === 'timeline') {
    var reactions = Object.entries(card.reactionSummary || {})
      .filter(function(e) { return e[1] > 0; })
      .map(function(e) { return e[0] + e[1]; })
      .join(' ');
    var timeAgo = getTimeAgo(new Date(card.createdAt));
    metaHtml = (card.revealedAuthorName ? '<div class="revealed-author">' + escapeHtml(card.revealedAuthorName) + '</div>' : '') +
      '<div class="reactions">' +
      (reactions ? '<div class="reaction-item">' + reactions + '</div>' : '') +
      (card.commentCount > 0 ? '<div class="comment-count">評 ' + card.commentCount + '</div>' : '') +
      '</div>' +
      '<div class="time-ago">' + timeAgo + '</div>';
  } else if (mode === 'myPosts' && card.groups) {
    var merged = {};
    var totalComments = 0;
    card.groups.forEach(function(g) {
      Object.entries(g.reactionSummary || {}).forEach(function(e) {
        merged[e[0]] = (merged[e[0]] || 0) + e[1];
      });
      totalComments += g.commentCount || 0;
    });
    var reactions = Object.entries(merged)
      .filter(function(e) { return e[1] > 0; })
      .map(function(e) { return e[0] + e[1]; })
      .join(' ');
    var groupNames = card.groups.map(function(g) { return g.groupName; }).join('・');
    if (groupNames.length > 50) groupNames = groupNames.slice(0, 50) + '…';
    metaHtml = '<div class="reactions">' +
      (reactions ? '<div class="reaction-item">' + reactions + '</div>' : '') +
      (totalComments > 0 ? '<div class="comment-count">評 ' + totalComments + '</div>' : '') +
      '</div>' +
      '<div class="group-info">' + groupNames + '</div>';
  } else if (mode === 'bookmarks') {
    var d = new Date(card.bookmarkedAt || card.createdAt);
    var timeAgo = getTimeAgo(d);
    var bmGroupName = card.groupName || '';
    if (bmGroupName.length > 50) bmGroupName = bmGroupName.slice(0, 50) + '…';
    metaHtml = (card.revealedAuthorName ? '<div class="revealed-author">' + escapeHtml(card.revealedAuthorName) + '</div>' : '') +
      '<div class="group-info">' + bmGroupName + '</div>' +
      '<div class="group-info">' + timeAgo + '</div>';
  }

  if (card.hogo) {
    var label = card.hogoType === 'pending'
      ? '現在確認中です'
      : '反故——' + escapeHtml(card.hogoReason || '仔細あり');
    el.innerHTML =
      '<div class="tanka-body hogo">' + label + '</div>' +
      '<div class="tanka-meta">' + metaHtml + '</div>';
  } else {
    el.innerHTML =
      '<div class="tanka-body">' + rubyToHtml(escapeHtml(card.body)) + '</div>' +
      '<div class="tanka-meta">' + metaHtml + '</div>';
  }
  return el;
}

if (cards.length === 0) {
  container.innerHTML = '<div class="empty-state">' +
    (mode === 'timeline' ? '詠草がありません' :
     mode === 'myPosts' ? '詠草がありません' :
     '栞がありません') + '</div>';
  container.style.justifyContent = 'center';
} else {
  var displayCards = cards;
  if (mode === 'myPosts') {
    var grouped = {};
    cards.forEach(function(c) {
      var key = c.batchId || c.postId;
      if (!grouped[key]) grouped[key] = Object.assign({}, c, { groups: [] });
      grouped[key].groups.push({
        groupName: c.groupName || '',
        groupId: c.groupId,
        postId: c.postId,
        reactionSummary: c.reactionSummary || {},
        commentCount: c.commentCount || 0,
      });
    });
    displayCards = Object.values(grouped);
  }

  displayCards.forEach(function(card, index) {
    container.appendChild(createCardEl(card, index));
    cardCount++;
  });
}

// Scroll edge detection for loading more (左端 = 古い投稿側)
if (hasLoadMore) {
  document.body.addEventListener('scroll', function() {
    if (document.body.scrollLeft < 300 && !loadMoreRequested) {
      loadMoreRequested = true;
      window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'loadMore' }));
    }
  });
}

// 古い履歴を左端に追加（loadMore）
// row-reverse + appendChild では既存カードが右にシフトするため scrollLeft 補正が必要
window.appendCards = function(newCards) {
  var oldScrollLeft = document.body.scrollLeft;
  var oldScrollWidth = document.body.scrollWidth;

  newCards.forEach(function(card) {
    container.appendChild(createCardEl(card, cardCount));
    cardCount++;
  });

  var delta = document.body.scrollWidth - oldScrollWidth;
  document.body.scrollLeft = oldScrollLeft + delta;

  loadMoreRequested = false;
};

window.applyUnread = function(ms) {
  unreadSinceMs = ms;
  var els = container.querySelectorAll('.tanka-card');
  els.forEach(function(el) {
    var t = parseInt(el.getAttribute('data-created-at') || '0', 10);
    if (ms !== null && t > ms) {
      el.classList.add('unread');
    } else {
      el.classList.remove('unread');
    }
  });
};

// 既存カードの内容を置換（modified イベント用）
window.updateCards = function(updatedCards) {
  updatedCards.forEach(function(card) {
    var oldEl = container.querySelector('[data-post-id="' + card.postId + '"]');
    if (!oldEl) return;
    var index = 0;
    var children = container.children;
    for (var i = 0; i < children.length; i++) {
      if (children[i] === oldEl) { index = i; break; }
    }
    var newEl = createCardEl(card, index);
    // 既存の opacity を保持
    newEl.style.opacity = oldEl.style.opacity;
    container.replaceChild(newEl, oldEl);
  });
};

// カード削除（removed イベント用）
window.removeCards = function(postIds) {
  postIds.forEach(function(postId) {
    var el = container.querySelector('[data-post-id="' + postId + '"]');
    if (el) el.remove();
  });
};

// 新着を右端に追加（リアルタイム新着）
// row-reverse + insertBefore では既存カードのピクセル位置が変わらない
// ユーザーが右端にいた場合のみ追従して新着を見せる
window.prependCards = function(newCards) {
  var atRightEdge = (document.body.scrollLeft + document.body.clientWidth >= document.body.scrollWidth - 10);

  var fragment = document.createDocumentFragment();
  newCards.forEach(function(card) {
    fragment.appendChild(createCardEl(card, 0));
    cardCount++;
  });
  container.insertBefore(fragment, container.firstChild);

  if (atRightEdge) {
    requestAnimationFrame(function() {
      document.body.scrollLeft = document.body.scrollWidth;
    });
  }
};

// 初期スクロール: カード生成完了後、右端にスクロール（visibility は onLoadEnd 側で visible に）
requestAnimationFrame(function() {
  document.body.scrollLeft = document.body.scrollWidth;
});
</script>
</body>
</html>`;
}

export default function TankaScroll({ cards, onTap, onLongPress, mode, onLoadMore, generation, newArrivals, arrivalGen, unreadSince, changedCards, removedIds, updateGen }: Props) {
  const { colors } = useTheme();
  const webViewRef = useRef<WebView>(null);
  const renderedCountRef = useRef(0);
  const webViewReadyRef = useRef(false);
  const isTimeline = mode === 'timeline';
  const unreadSinceMs = unreadSince ? unreadSince.getTime() : null;

  // For timeline: memoize HTML on generation change only (not on cards change)
  // For other modes: rebuild HTML on any cards change
  const timelineHtml = useMemo(
    () => isTimeline ? buildHtml(cards, mode, !!onLoadMore, colors) : '',
    [generation, isTimeline, colors],
  );
  const otherHtml = useMemo(
    () => !isTimeline ? buildHtml(cards, mode, false, colors) : '',
    [cards, mode, isTimeline, colors],
  );
  const html = isTimeline ? timelineHtml : otherHtml;

  const webViewKey = isTimeline
    ? `tl-${generation ?? 0}`
    : cards.map(c => `${c.postId}:${c.commentCount || 0}:${JSON.stringify(c.reactionSummary || {})}`).join(',');

  // Reset rendered count when generation changes (full refresh)
  useEffect(() => {
    renderedCountRef.current = cards.length;
  }, [generation]);

  // WebView リロード時に ready フラグをリセット
  useEffect(() => {
    webViewReadyRef.current = false;
  }, [generation]);

  // 未読強調を適用（unreadSince変更時 + 新着追加時 + loadMore時）
  // WebView が ready になっていない間は呼ばない（onLoadEnd で再実行される）
  useEffect(() => {
    if (!isTimeline) return;
    if (unreadSinceMs === null) return;
    if (!webViewReadyRef.current) return;
    const js = `window.applyUnread && window.applyUnread(${unreadSinceMs}); true;`;
    webViewRef.current?.injectJavaScript(js);
  }, [unreadSinceMs, isTimeline, arrivalGen, cards.length]);

  // 変更されたカードを WebView に反映（modified / removed イベント）
  useEffect(() => {
    if (!isTimeline || !updateGen) return;
    if (!webViewReadyRef.current) return;
    if (changedCards && changedCards.length > 0) {
      const serialized = serializeCards(changedCards);
      const js = `window.updateCards && window.updateCards(${JSON.stringify(serialized)}); true;`;
      webViewRef.current?.injectJavaScript(js);
    }
    if (removedIds && removedIds.length > 0) {
      const js = `window.removeCards && window.removeCards(${JSON.stringify(removedIds)}); true;`;
      webViewRef.current?.injectJavaScript(js);
    }
  }, [updateGen, isTimeline, changedCards, removedIds]);

  // Prepend new real-time arrivals (declare BEFORE append effect)
  useEffect(() => {
    if (!isTimeline || !newArrivals?.length || !arrivalGen) return;
    if (renderedCountRef.current === 0) return; // 空のWebViewにはprependしない
    const serialized = serializeCards(newArrivals);
    const js = `window.prependCards(${JSON.stringify(serialized)}); true;`;
    webViewRef.current?.injectJavaScript(js);
    renderedCountRef.current += newArrivals.length;
  }, [arrivalGen, isTimeline, newArrivals]);

  // For timeline: inject new cards when cards array grows from loadMore (append)
  useEffect(() => {
    if (!isTimeline) return;
    const prevCount = renderedCountRef.current;
    if (cards.length > prevCount && prevCount > 0) {
      const newCards = serializeCards(cards.slice(prevCount));
      const js = `window.appendCards(${JSON.stringify(newCards)}); true;`;
      webViewRef.current?.injectJavaScript(js);
      renderedCountRef.current = cards.length;
    }
  }, [cards, isTimeline]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.action === 'loadMore') {
        onLoadMore?.();
        return;
      }
      if (data.action === 'postMenu') {
        onLongPress?.(data.postId, data.groupId, data.batchId);
        return;
      }
      onTap(data.postId, data.groupId, data.batchId);
    } catch {}
  };

  return (
    <View style={styles.container}>
      <WebView
        key={webViewKey}
        ref={webViewRef}
        source={{ html }}
        style={[styles.webview, { backgroundColor: colors.webViewBg }]}
        onMessage={handleMessage}
        onLoadEnd={() => {
          webViewReadyRef.current = true;
          // タイムラインでもそれ以外でも、右端へのスクロールと visibility 設定を一括で行う
          // unreadSinceMs があれば applyUnread も同時に実行
          const applyUnreadJs = isTimeline && unreadSinceMs !== null
            ? `window.applyUnread && window.applyUnread(${unreadSinceMs});`
            : '';
          const js = `
            document.body.scrollLeft = document.body.scrollWidth;
            ${applyUnreadJs}
            document.body.style.visibility = 'visible';
            true;
          `;
          webViewRef.current?.injectJavaScript(js);
        }}
        scrollEnabled={true}
        nestedScrollEnabled={true}
        showsHorizontalScrollIndicator={false}
        javaScriptEnabled={true}
        originWhitelist={['*']}
        androidLayerType="software"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
});

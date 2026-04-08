import React, { useEffect, useMemo, useRef } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { ThemeColors } from '../theme/colors';
import { useTheme } from '../theme/ThemeContext';
import { TankaCard } from '../types';

interface Props {
  cards: TankaCard[];
  onTap: (postId: string, groupId: string, batchId?: string) => void;
  mode: 'timeline' | 'myPosts' | 'bookmarks';
  onLoadMore?: () => void;
  generation?: number;
  newArrivals?: TankaCard[];
  arrivalGen?: number;
}

const screenWidth = Dimensions.get('window').width;
const scale = screenWidth / 390;
const tankaFontSize = Math.round(20 * (scale < 1 ? scale : 1 + (scale - 1) * 0.7));
const metaFontSize = Math.round(11 * Math.max(screenWidth / 390, 1));

function serializeCards(cards: TankaCard[]) {
  return cards.map(c => ({
    ...c,
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
  .container {
    display: inline-flex;
    flex-direction: row;
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
  .tanka-card:last-child { border-right: none; }
  .tanka-card:active { background: ${colors.cardPress}; }
  .tanka-body {
    writing-mode: vertical-rl;
    font-size: ${tankaFontSize}px;
    line-height: 2.0;
    letter-spacing: 0.1em;
    color: ${colors.text};
    flex: 1;
    display: flex;
    align-items: flex-start;
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
  el.className = "tanka-card";
  var fade = Math.max(0.6, 1 - (index / 8) * 0.7);
  el.style.opacity = fade;
  el.onclick = function() {
    var msg = { postId: card.postId, groupId: card.groupId };
    if (mode === 'myPosts' && card.batchId) msg.batchId = card.batchId;
    window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  };

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
    el.innerHTML =
      '<div class="tanka-body hogo">反故——' + escapeHtml(card.hogoReason || '仔細あり') + '</div>' +
      '<div class="tanka-meta">' + metaHtml + '</div>';
  } else {
    var displayBody = card.body.replace(/[\\n\\r]+/g, '\\u3000');
    el.innerHTML =
      '<div class="tanka-body">' + rubyToHtml(escapeHtml(displayBody)) + '</div>' +
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

// Scroll edge detection for loading more
if (hasLoadMore) {
  document.body.addEventListener('scroll', function() {
    var scrollRight = document.body.scrollWidth - document.body.scrollLeft - document.body.clientWidth;
    if (scrollRight < 300 && !loadMoreRequested) {
      loadMoreRequested = true;
      window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'loadMore' }));
    }
  });
}

window.appendCards = function(newCards) {
  newCards.forEach(function(card) {
    container.appendChild(createCardEl(card, cardCount));
    cardCount++;
  });
  loadMoreRequested = false;
};

window.prependCards = function(newCards) {
  var scrollEl = document.body;
  var oldScrollLeft = scrollEl.scrollLeft;
  var oldScrollWidth = scrollEl.scrollWidth;

  var fragment = document.createDocumentFragment();
  newCards.forEach(function(card) {
    fragment.appendChild(createCardEl(card, 0));
    cardCount++;
  });
  container.insertBefore(fragment, container.firstChild);

  if (oldScrollLeft > 0) {
    var delta = scrollEl.scrollWidth - oldScrollWidth;
    scrollEl.scrollLeft = oldScrollLeft + delta;
  }
};
</script>
</body>
</html>`;
}

export default function TankaScroll({ cards, onTap, mode, onLoadMore, generation, newArrivals, arrivalGen }: Props) {
  const { colors } = useTheme();
  const webViewRef = useRef<WebView>(null);
  const renderedCountRef = useRef(0);
  const isTimeline = mode === 'timeline';

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

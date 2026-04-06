import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { TankaCard } from '../types';

interface Props {
  cards: TankaCard[];
  onTap: (postId: string, groupId: string) => void;
  mode: 'timeline' | 'myPosts' | 'bookmarks';
}

function buildHtml(cards: TankaCard[], mode: string): string {
  const cardsJson = JSON.stringify(cards.map(c => ({
    ...c,
    createdAt: c.createdAt?.toISOString?.() || new Date().toISOString(),
    bookmarkedAt: c.bookmarkedAt?.toISOString?.() || null,
  })));

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    height: 100%;
    background: #F5F0E8;
    font-family: "Noto Serif JP", "Yu Mincho", "Hiragino Mincho Pro", serif;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .container {
    display: inline-flex;
    flex-direction: row-reverse;
    align-items: stretch;
    height: 100%;
    min-width: 100%;
    padding: 8px 12px;
    gap: 2px;
  }
  .tanka-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 64px;
    padding: 8px 8px 8px;
    border-right: 1px solid rgba(0,0,0,0.06);
    cursor: pointer;
    transition: background 0.2s;
  }
  .tanka-card:first-child { border-right: none; }
  .tanka-card:active { background: rgba(0,0,0,0.04); }
  .tanka-body {
    writing-mode: vertical-rl;
    font-size: 20px;
    line-height: 1.8;
    letter-spacing: 0.1em;
    color: #2C2418;
    flex: 1;
    display: flex;
    align-items: flex-start;
  }
  .tanka-meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin-top: 12px;
    font-size: 11px;
    color: #8B7E6A;
  }
  .reactions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .reaction-item { white-space: nowrap; }
  .group-info {
    font-size: 10px;
    color: #A69880;
    text-align: center;
    max-width: 56px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .comment-count { font-size: 11px; color: #8B7E6A; }
  .time-ago { font-size: 10px; color: #A69880; margin-top: 2px; }
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    color: #A69880;
    font-size: 16px;
  }
  .group-reactions {
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items: center;
  }
  .group-reaction-row {
    font-size: 10px;
    color: #8B7E6A;
    text-align: center;
    white-space: nowrap;
  }
</style>
</head>
<body>
<div class="container" id="container"></div>
<script>
const cards = ${cardsJson};
const mode = "${mode}";
const container = document.getElementById("container");

if (cards.length === 0) {
  container.innerHTML = '<div class="empty-state">' +
    (mode === 'timeline' ? 'まだ歌が詠まれていません' :
     mode === 'myPosts' ? 'まだ歌を詠んでいません' :
     '栞はまだありません') + '</div>';
  container.style.flexDirection = 'row';
  container.style.justifyContent = 'center';
} else {
  let displayCards = cards;
  if (mode === 'myPosts') {
    const grouped = {};
    cards.forEach(c => {
      const key = c.batchId || c.postId;
      if (!grouped[key]) grouped[key] = { ...c, groups: [] };
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

  const total = displayCards.length;
  displayCards.forEach((card, index) => {
    const el = document.createElement("div");
    el.className = "tanka-card";
    const fade = Math.max(0.55, 1 - (index / 8) * 0.65);
    el.style.opacity = fade;
    el.onclick = () => {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        postId: card.postId,
        groupId: card.groupId,
      }));
    };

    let metaHtml = '';
    if (mode === 'timeline') {
      const reactions = Object.entries(card.reactionSummary || {})
        .filter(([,v]) => v > 0)
        .map(([emoji, count]) => emoji + count)
        .join(' ');
      const timeAgo = getTimeAgo(new Date(card.createdAt));
      metaHtml = '<div class="reactions">' +
        (reactions ? '<div class="reaction-item">' + reactions + '</div>' : '') +
        (card.commentCount > 0 ? '<div class="comment-count">評 ' + card.commentCount + '</div>' : '') +
        '</div>' +
        '<div class="time-ago">' + timeAgo + '</div>';
    } else if (mode === 'myPosts' && card.groups) {
      metaHtml = '<div class="group-reactions">' +
        card.groups.map(g => {
          const r = Object.entries(g.reactionSummary || {})
            .filter(([,v]) => v > 0)
            .map(([emoji, count]) => emoji + count)
            .join('');
          return '<div class="group-reaction-row">' + g.groupName +
            (r ? ' ' + r : '') +
            (g.commentCount > 0 ? ' 評 ' + g.commentCount : '') +
            '</div>';
        }).join('') +
        '</div>';
    } else if (mode === 'bookmarks') {
      const d = new Date(card.bookmarkedAt || card.createdAt);
      const timeAgo = getTimeAgo(d);
      metaHtml = '<div class="group-info">' + (card.groupName || '') + '</div>' +
        '<div class="group-info">' + timeAgo + '</div>';
    }

    el.innerHTML =
      '<div class="tanka-body">' + escapeHtml(card.body) + '</div>' +
      '<div class="tanka-meta">' + metaHtml + '</div>';
    container.appendChild(el);
  });

  setTimeout(() => { document.body.scrollLeft = document.body.scrollWidth; }, 50);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getTimeAgo(date) {
  const now = new Date();
  const diff = now - date;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return min + '分前';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + '時間前';
  const day = Math.floor(hr / 24);
  if (day < 30) return day + '日前';
  return Math.floor(day / 30) + 'ヶ月前';
}
</script>
</body>
</html>`;
}

export default function TankaScroll({ cards, onTap, mode }: Props) {
  const webViewRef = useRef<WebView>(null);
  const html = buildHtml(cards, mode);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      onTap(data.postId, data.groupId);
    } catch {}
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html }}
        style={styles.webview}
        onMessage={handleMessage}
        scrollEnabled={true}
        nestedScrollEnabled={true}
        showsHorizontalScrollIndicator={false}
        javaScriptEnabled={true}
        originWhitelist={['*']}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1, backgroundColor: '#F5F0E8' },
});

import React, { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { TankaCard } from '../types';

interface Props {
  cards: TankaCard[];
  onTap: (postId: string, groupId: string, batchId?: string) => void;
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
    background: transparent;
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
    font-size: 10px;
    color: #A69880;
    text-align: center;
    word-break: break-all;
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

  displayCards.forEach((card, index) => {
    const el = document.createElement("div");
    el.className = "tanka-card";
    const fade = Math.max(0.6, 1 - (index / 12) * 0.6);
    el.style.opacity = fade;
    el.onclick = () => {
      const msg = { postId: card.postId, groupId: card.groupId };
      if (mode === 'myPosts' && card.batchId) msg.batchId = card.batchId;
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
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
      // Merge reactions and comments across all groups
      const merged = {};
      let totalComments = 0;
      card.groups.forEach(g => {
        Object.entries(g.reactionSummary || {}).forEach(([emoji, count]) => {
          merged[emoji] = (merged[emoji] || 0) + count;
        });
        totalComments += g.commentCount || 0;
      });
      const reactions = Object.entries(merged)
        .filter(([,v]) => v > 0)
        .map(([emoji, count]) => emoji + count)
        .join(' ');
      let groupNames = card.groups.map(g => g.groupName).join('・');
      if (groupNames.length > 50) groupNames = groupNames.slice(0, 50) + '…';
      metaHtml = '<div class="reactions">' +
        (reactions ? '<div class="reaction-item">' + reactions + '</div>' : '') +
        (totalComments > 0 ? '<div class="comment-count">評 ' + totalComments + '</div>' : '') +
        '</div>' +
        '<div class="group-info">' + groupNames + '</div>';
    } else if (mode === 'bookmarks') {
      const d = new Date(card.bookmarkedAt || card.createdAt);
      const timeAgo = getTimeAgo(d);
      let bmGroupName = card.groupName || '';
      if (bmGroupName.length > 50) bmGroupName = bmGroupName.slice(0, 50) + '…';
      metaHtml = '<div class="group-info">' + bmGroupName + '</div>' +
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
  const webViewKey = cards.map(c => `${c.postId}:${c.commentCount || 0}:${JSON.stringify(c.reactionSummary || {})}`).join(',');

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      onTap(data.postId, data.groupId, data.batchId);
    } catch {}
  };

  return (
    <View style={styles.container}>
      <WebView
        key={webViewKey}
        ref={webViewRef}
        source={{ html }}
        style={styles.webview}
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
  webview: { flex: 1, backgroundColor: 'transparent' },
});

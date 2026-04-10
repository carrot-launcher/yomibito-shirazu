import * as MediaLibrary from 'expo-media-library';
import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { WebView } from 'react-native-webview';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { useTheme } from '../theme/ThemeContext';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
// 縦方向の予算: 画面高さ - ヘッダー(56) - ボタン領域(約100) - 余白(24)
const MAX_CARD_HEIGHT = SCREEN_HEIGHT - 56 - 100 - 24;
const MAX_CARD_WIDTH_FROM_HEIGHT = MAX_CARD_HEIGHT * (9 / 16);
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, MAX_CARD_WIDTH_FROM_HEIGHT);
const CARD_HEIGHT = CARD_WIDTH * (16 / 9);
// カード幅に応じてフォントサイズを動的に決定
// 基準: CARD_WIDTH=320 のとき font-size=15
const TANKA_FONT_SIZE = Math.round(15 * (CARD_WIDTH / 320));
const AUTHOR_FONT_SIZE = Math.round(12 * (CARD_WIDTH / 320));

function buildScreenshotHtml(body: string, revealedAuthorName: string | undefined, tankaFontSize: number, authorFontSize: number): string {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const rubyBody = escapeHtml(body).replace(/\{([^|{}]+)\|([^|{}]+)\}/g,
    '<ruby>$1<rp>(</rp><rt>$2</rt><rp>)</rp></ruby>');

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    height: 100%;
    background: #FBF7F0;
    overflow: hidden;
  }
  .card {
    width: 100%;
    aspect-ratio: 9/16;
    background: #FBF7F0;
    display: flex;
    flex-direction: column;
    padding: 10% 0;
    position: relative;
  }
  .tanka-area {
    flex: 1;
    display: flex;
    justify-content: center;
    min-height: 0;
  }
  .tanka {
    -webkit-writing-mode: vertical-rl;
    writing-mode: vertical-rl;
    font-family: "Noto Serif JP", "Yu Mincho", "Hiragino Mincho Pro", serif;
    font-size: ${tankaFontSize}px;
    line-height: 2.0;
    letter-spacing: 0.04em;
    color: #2C2418;
    white-space: pre-wrap;
    height: 100%;
  }
  .tanka rt { font-size: 0.45em; letter-spacing: 0; }
  .revealed-author {
    -webkit-writing-mode: vertical-rl;
    writing-mode: vertical-rl;
    font-family: "Noto Serif JP", "Yu Mincho", "Hiragino Mincho Pro", serif;
    font-size: ${authorFontSize}px;
    line-height: 2.0;
    letter-spacing: 0.04em;
    color: #2C2418;
    position: absolute;
    left: 25%;
    bottom: 10%;
  }
</style>
</head>
<body>
<div class="card" id="card">
  <div class="tanka-area"><div class="tanka">${rubyBody}</div></div>
  ${revealedAuthorName ? '<div class="revealed-author">' + escapeHtml(revealedAuthorName) + '</div>' : ''}
</div>
</body>
</html>`;
}

export default function ScreenshotScreen({ route }: any) {
  const { body, revealedAuthorName } = route.params;
  const captureContainerRef = useRef<View>(null);
  const { alert } = useAlert();
  const { colors } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 200);
    return () => clearTimeout(timer);
  }, []);

  const handleCapture = async () => {
    if (!captureContainerRef.current) return;
    try {
      const uri = await captureRef(captureContainerRef.current, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: CARD_WIDTH * 3,
        height: CARD_HEIGHT * 3,
      });
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        alert('写真へのアクセス許可が必要です');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      alert('保存しました', '画像をギャラリーに保存しました');
    } catch (e: any) {
      alert('エラー', e?.message || '保存に失敗しました');
    }
  };

  const html = buildScreenshotHtml(body, revealedAuthorName, TANKA_FONT_SIZE, AUTHOR_FONT_SIZE);

  return (
    <GradientBackground style={styles.container}>
      <View ref={captureContainerRef} collapsable={false} style={styles.cardWrapper}>
        {mounted ? (
          <WebView
            source={{ html }}
            style={[styles.webview, { backgroundColor: colors.webViewBg }]}
            onLoadEnd={() => setReady(true)}
            scrollEnabled={false}
            javaScriptEnabled={true}
            originWhitelist={['*']}
            androidLayerType="software"
          />
        ) : (
          <View style={[styles.webview, { backgroundColor: colors.webViewBg }]} />
        )}
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.accent }, !ready && styles.saveBtnDisabled]} onPress={handleCapture} disabled={!ready}>
          <Text style={[styles.saveBtnText, { color: colors.accentText }]}>画像を保存</Text>
        </TouchableOpacity>
      </View>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardWrapper: { width: CARD_WIDTH, height: CARD_HEIGHT, borderRadius: 4, overflow: 'hidden' },
  webview: { flex: 1 },
  buttonRow: { marginTop: 24, alignItems: 'center' },
  saveBtn: { borderRadius: 10, paddingHorizontal: 28, paddingVertical: 14 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 16, lineHeight: 22, fontFamily: 'NotoSerifJP_400Regular' },
});

import { File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { useTheme } from '../theme/ThemeContext';
import { stripRuby } from '../utils/formatTanka';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_WIDTH = SCREEN_WIDTH - 48;
const CARD_HEIGHT = CARD_WIDTH * (4 / 3);

function buildScreenshotHtml(body: string): string {
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
    aspect-ratio: 3/4;
    background: #FBF7F0;
    display: flex;
    justify-content: center;
    padding: 10% 0;
  }
  .tanka {
    -webkit-writing-mode: vertical-rl;
    writing-mode: vertical-rl;
    font-family: "Noto Serif JP", "Yu Mincho", "Hiragino Mincho Pro", serif;
    font-size: 14px;
    line-height: 2.0;
    letter-spacing: 0.04em;
    color: #2C2418;
    white-space: pre-wrap;
    height: 100%;
  }
</style>
</head>
<body>
<div class="card" id="card">
  <div class="tanka">${escapeHtml(body)}</div>
</div>
<script>
function capture() {
  try {
    const card = document.getElementById('card');
    const scale = 3;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    ctx.fillStyle = '#FBF7F0';
    ctx.fillRect(0, 0, w, h);

    const tanka = document.querySelector('.tanka');
    const text = tanka.textContent;
    const style = getComputedStyle(tanka);
    const fontSize = parseFloat(style.fontSize);
    const charSpacing = fontSize * 0.04;
    const colSpacing = fontSize * 2.0;
    ctx.font = fontSize + 'px "Noto Serif JP", "Yu Mincho", "Hiragino Mincho Pro", serif';
    ctx.fillStyle = '#2C2418';
    ctx.textBaseline = 'top';

    const maxHeight = h * 0.80;
    const charStep = fontSize + charSpacing;
    const charsPerCol = Math.floor(maxHeight / charStep);

    // Split by line breaks first, then wrap each line into columns
    const lines = text.split('\\n');
    const columns = [];
    lines.forEach(function(line) {
      var lineChars = line.split('');
      if (lineChars.length === 0) {
        columns.push([]);
      } else {
        for (var i = 0; i < lineChars.length; i += charsPerCol) {
          columns.push(lineChars.slice(i, i + charsPerCol));
        }
      }
    });

    const totalCols = columns.length;
    const totalWidth = totalCols * colSpacing;
    const startX = w / 2 + totalWidth / 2 - colSpacing + (colSpacing - fontSize) / 2;
    const startY = h * 0.10;

    columns.forEach(function(col, colIdx) {
      col.forEach(function(ch, rowIdx) {
        const x = startX - colIdx * colSpacing;
        const y = startY + rowIdx * charStep;
        ctx.fillText(ch, x, y);
      });
    });

    const dataUrl = canvas.toDataURL('image/png');
    window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'captured', data: dataUrl.split(',')[1] }));
  } catch(e) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'error', message: e.message }));
  }
}
</script>
</body>
</html>`;
}

export default function ScreenshotScreen({ route }: any) {
  const { body } = route.params;
  const webViewRef = useRef<WebView>(null);
  const { alert } = useAlert();
  const { colors } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 200);
    return () => clearTimeout(timer);
  }, []);

  const handleCapture = () => {
    webViewRef.current?.injectJavaScript('capture(); true;');
  };

  const handleMessage = async (event: any) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.action === 'error') {
        alert('エラー', msg.message);
        return;
      }
      if (msg.action === 'captured' && msg.data) {
        const bytes = Uint8Array.from(atob(msg.data), c => c.charCodeAt(0));
        const file = new File(Paths.cache, 'tanka_' + Date.now() + '.png');
        file.write(bytes);
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== 'granted') {
          alert('写真へのアクセス許可が必要です');
          return;
        }
        await MediaLibrary.saveToLibraryAsync(file.uri);
        alert('保存しました', '画像をギャラリーに保存しました');
      }
    } catch (e: any) {
      alert('エラー', e.message);
    }
  };

  const html = buildScreenshotHtml(stripRuby(body));

  return (
    <GradientBackground style={styles.container}>
      <View style={styles.cardWrapper}>
        {mounted ? (
          <WebView
            ref={webViewRef}
            source={{ html }}
            style={[styles.webview, { backgroundColor: colors.webViewBg }]}
            onMessage={handleMessage}
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

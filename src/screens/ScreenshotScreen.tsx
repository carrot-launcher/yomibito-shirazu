import * as MediaLibrary from 'expo-media-library';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { WebView } from 'react-native-webview';
import { AppButton } from '../components/AppButton';
import { AppText } from '../components/AppText';
import { useAlert } from '../components/CustomAlert';
import GradientBackground from '../components/GradientBackground';
import { useTheme } from '../theme/ThemeContext';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
// ヘッダ(56) + 下コントロール 1 行(約70) + 上下余白(32) + セーフエリア(約34)
const MAX_CARD_HEIGHT = SCREEN_HEIGHT - 56 - 70 - 32 - 34;
const MAX_CARD_WIDTH_FROM_HEIGHT = MAX_CARD_HEIGHT * (9 / 16);
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, MAX_CARD_WIDTH_FROM_HEIGHT);
const CARD_HEIGHT = CARD_WIDTH * (16 / 9);
// カード幅に応じた基準フォントサイズ
const BASE_TANKA_FONT = Math.round(15 * (CARD_WIDTH / 320));
const BASE_AUTHOR_FONT = Math.round(12 * (CARD_WIDTH / 320));

interface Preset {
  key: string;
  label: string;
  bgTop: string;
  bgBottom: string;
  text: string;
}

const PRESETS: Preset[] = [
  { key: 'kinari',    label: '生成り', bgTop: '#FBF7F0', bgBottom: '#EFE7D2', text: '#2C2418' },
  { key: 'sumi',      label: '墨',     bgTop: '#2E2822', bgBottom: '#14100C', text: '#F0E6D4' },
  { key: 'yukishiro', label: '雪白',   bgTop: '#ECF1F5', bgBottom: '#CFD8DE', text: '#2A3640' },
  { key: 'sakura',    label: '桜',     bgTop: '#F7D6DD', bgBottom: '#ECBCC9', text: '#5C2438' },
  { key: 'wakakusa',  label: '若草',   bgTop: '#D2E198', bgBottom: '#A6C562', text: '#2C3914' },
  { key: 'matcha',    label: '抹茶',   bgTop: '#D0DDA7', bgBottom: '#A7B67A', text: '#2D3319' },
  { key: 'uguisu',    label: '鶯',     bgTop: '#B3B070', bgBottom: '#8A8649', text: '#2A2412' },
  { key: 'ai',        label: '藍',     bgTop: '#233B69', bgBottom: '#152753', text: '#F3EFE3' },
  { key: 'shu',       label: '朱',     bgTop: '#C04A35', bgBottom: '#992F20', text: '#FAE9DC' },
  { key: 'momiji',    label: '紅葉',   bgTop: '#D66146', bgBottom: '#A0601F', text: '#F6E6CE' },
  { key: 'kakishibu', label: '柿渋',   bgTop: '#9E582D', bgBottom: '#6E3B1A', text: '#E8D1A8' },
  { key: 'yozakura',  label: '夜桜',   bgTop: '#2A2338', bgBottom: '#1A1428', text: '#EEDBE5' },
];

type FontSizeKey = 'small' | 'medium' | 'large';
const FONT_MULTIPLIER: Record<FontSizeKey, number> = {
  small: 0.85,
  medium: 1.0,
  large: 1.25,
};
// 「あ」をサイズ感ごとに可視化するためのピクセル値（UI 表示用、プレビュー用の本文サイズとは別）
const SIZE_VISUAL_PX: Record<FontSizeKey, number> = { small: 13, medium: 16, large: 20 };

function buildScreenshotHtml(
  body: string,
  revealedAuthorName: string | undefined,
  tankaFontSize: number,
  authorFontSize: number,
  preset: Preset,
): string {
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
    overflow: hidden;
  }
  body {
    background: linear-gradient(to bottom, ${preset.bgTop}, ${preset.bgBottom});
  }
  .card {
    width: 100%;
    aspect-ratio: 9/16;
    display: flex;
    flex-direction: column;
    padding: 14% 0 10% 0;
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
    color: ${preset.text};
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
    color: ${preset.text};
    position: absolute;
    left: 28%;
    bottom: 8%;
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

export default function ScreenshotScreen({ route, navigation }: any) {
  const { body, revealedAuthorName } = route.params;
  const captureContainerRef = useRef<View>(null);
  const { alert } = useAlert();
  const { colors } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);

  const [presetKey, setPresetKey] = useState<string>(PRESETS[0].key);
  const [fontSizeKey, setFontSizeKey] = useState<FontSizeKey>('medium');

  const preset = useMemo(
    () => PRESETS.find(p => p.key === presetKey) || PRESETS[0],
    [presetKey],
  );
  const tankaFont = Math.round(BASE_TANKA_FONT * FONT_MULTIPLIER[fontSizeKey]);
  const authorFont = Math.round(BASE_AUTHOR_FONT * FONT_MULTIPLIER[fontSizeKey]);

  const html = useMemo(
    () => buildScreenshotHtml(body, revealedAuthorName, tankaFont, authorFont, preset),
    [body, revealedAuthorName, tankaFont, authorFont, preset],
  );

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // プリセット／サイズ変更のたびに ready をリセット（描画完了前に保存させない）
  useEffect(() => {
    setReady(false);
  }, [presetKey, fontSizeKey]);

  const handleCapture = useCallback(async () => {
    if (!captureContainerRef.current) return;
    try {
      const uri = await captureRef(captureContainerRef.current, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: CARD_WIDTH * 3,
        height: CARD_HEIGHT * 3,
      });
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        alert('写真への保存権限が必要です');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      alert('保存しました', '画像をギャラリーに保存しました');
    } catch (e: any) {
      alert('エラー', e?.message || '保存に失敗しました');
    }
  }, [alert]);

  // 保存ボタンをヘッダー右側に配置。
  // iOS はシステムの Liquid Glass ピルがヘッダー要素を囲むのでプレーンテキストで充分。
  // Android は囲みが無いので AppButton（secondary）でアプリ共通のボタン見た目に統一する。
  useEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        Platform.OS === 'android' ? (
          <AppButton
            label="保存"
            variant="secondary"
            size="xs"
            onPress={handleCapture}
            disabled={!ready}
          />
        ) : (
          <TouchableOpacity
            onPress={handleCapture}
            disabled={!ready}
            hitSlop={8}
            style={{ paddingHorizontal: 12, paddingVertical: 6 }}
            activeOpacity={0.5}
          >
            <AppText
              variant="buttonLabel"
              weight="medium"
              tone={ready ? 'primary' : 'tertiary'}
            >
              保存
            </AppText>
          </TouchableOpacity>
        ),
    });
  }, [navigation, ready, handleCapture]);

  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <GradientBackground style={styles.container}>
      <View ref={captureContainerRef} collapsable={false} style={styles.cardWrapper}>
        {mounted ? (
          <WebView
            source={{ html }}
            style={styles.webview}
            onLoadEnd={() => setReady(true)}
            scrollEnabled={false}
            javaScriptEnabled={true}
            originWhitelist={['*']}
            androidLayerType="software"
          />
        ) : (
          <View style={[styles.webview, { backgroundColor: preset.bgTop }]} />
        )}
      </View>

      <View style={styles.controlRow}>
        <View style={styles.sizeGroup}>
          {(Object.keys(SIZE_VISUAL_PX) as FontSizeKey[]).map((k) => (
            <TouchableOpacity
              key={k}
              style={[
                styles.sizeBtn,
                k === fontSizeKey && { backgroundColor: colors.activeHighlight, borderColor: colors.text },
              ]}
              onPress={() => setFontSizeKey(k)}
              activeOpacity={0.6}
            >
              <AppText
                style={{
                  fontFamily: 'NotoSerifJP_400Regular',
                  fontSize: SIZE_VISUAL_PX[k],
                  color: colors.text,
                  includeFontPadding: false,
                } as any}
              >
                あ
              </AppText>
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presetRow}
          style={styles.presetScroll}
        >
          {PRESETS.map((p) => (
            <TouchableOpacity
              key={p.key}
              onPress={() => setPresetKey(p.key)}
              activeOpacity={0.7}
              style={[
                styles.presetChip,
                {
                  borderColor: p.key === presetKey ? colors.text : colors.border,
                  borderWidth: p.key === presetKey ? 2 : 1,
                },
              ]}
            >
              <View style={[styles.presetSwatch, { backgroundColor: p.bgTop }]}>
                <View style={[styles.presetSwatchBottom, { backgroundColor: p.bgBottom }]} />
                <AppText style={[styles.presetLetter, { color: p.text }]}>歌</AppText>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </GradientBackground>
  );
}

function makeStyles(colors: any) {
  return StyleSheet.create({
    container: { flex: 1, alignItems: 'center' },
    cardWrapper: {
      width: CARD_WIDTH, height: CARD_HEIGHT,
      borderRadius: 4, overflow: 'hidden', marginTop: 16,
    },
    webview: { flex: 1, backgroundColor: 'transparent' },
    controlRow: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      marginTop: 16,
      gap: 10,
    },
    sizeGroup: { flexDirection: 'row', gap: 4 },
    sizeBtn: {
      width: 36, height: 36,
      alignItems: 'center', justifyContent: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    divider: { width: StyleSheet.hairlineWidth, height: 28, marginHorizontal: 4 },
    presetScroll: { flex: 1 },
    presetRow: { gap: 8, alignItems: 'center', paddingRight: 8 },
    presetChip: {
      borderRadius: 6,
      padding: 2,
    },
    presetSwatch: {
      width: 30, height: 42,
      borderRadius: 3,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      position: 'relative',
    },
    presetSwatchBottom: {
      position: 'absolute',
      left: 0, right: 0, bottom: 0,
      height: '50%',
      opacity: 0.6,
    },
    presetLetter: { fontSize: 15, fontFamily: 'NotoSerifJP_400Regular' },
  });
}

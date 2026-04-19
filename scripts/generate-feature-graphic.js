/**
 * Google Play Store 用のフィーチャーグラフィックを生成する。
 *
 * 実行:
 *   cd scripts
 *   node generate-feature-graphic.js
 *
 * 出力先: store-assets/feature.png
 * 仕様: 1024 x 500 px, PNG（Play Store 要件 15MB 以下）
 * 中央に衡山草書で「よみ人しらず」を配置。
 */

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

const FONT_PATH = path.resolve(__dirname, '../assets/fonts/KouzanSousho.otf');
const OUT_PATH = path.resolve(__dirname, '../store-assets/feature.png');

GlobalFonts.registerFromPath(FONT_PATH, 'KouzanSousho');

const WIDTH = 1024;
const HEIGHT = 500;
const BG = '#14100C';       // ダークテーマ gradientBottom 相当の暗い地
const FG = '#F0E6D4';       // アプリのダーク時テキスト色（明るい生成り）
const TEXT = 'よみ人しらず';

// テキストが横幅のこの比率以内に収まるように font-size を自動調整
const TARGET_WIDTH_RATIO = 0.90;
// 上下方向の中心は草書の字面が上寄りがちなのでやや下に寄せる
const BASELINE_Y_RATIO = 0.51;

const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext('2d');

// 背景（単色ベタ。グラデーションは feature 画像では逆にノイズになるので避ける）
ctx.fillStyle = BG;
ctx.fillRect(0, 0, WIDTH, HEIGHT);

// 自動フィット: 指定幅に収まる最大の font-size を探す
const targetWidth = WIDTH * TARGET_WIDTH_RATIO;
let fontSize = 260;
for (; fontSize > 60; fontSize -= 2) {
  ctx.font = `${fontSize}px KouzanSousho`;
  const metrics = ctx.measureText(TEXT);
  if (metrics.width <= targetWidth) break;
}

ctx.fillStyle = FG;
ctx.font = `${fontSize}px KouzanSousho`;
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText(TEXT, WIDTH / 2, HEIGHT * BASELINE_Y_RATIO);

fs.writeFileSync(OUT_PATH, canvas.toBuffer('image/png'));
console.log(`✓ store-assets/feature.png (${WIDTH}x${HEIGHT}) fontSize=${fontSize}`);

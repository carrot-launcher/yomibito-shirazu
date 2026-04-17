/**
 * KouzanSousho フォントでアプリアイコン・スプラッシュを再生成する。
 *
 * 実行:
 *   cd scripts
 *   node generate-app-icons.js
 *
 * 出力先: assets/images/
 *   - icon.png / icon-ios.png (1024x1024, 文字を大きく)
 *   - splash-icon.png / splash-icon-dark.png (400x400)
 */

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

const FONT_PATH = path.resolve(__dirname, '../assets/fonts/KouzanSousho.otf');
const ASSETS = path.resolve(__dirname, '../assets/images');

GlobalFonts.registerFromPath(FONT_PATH, 'KouzanSousho');

/**
 * アプリアイコン (文字を大きく描画)
 * @param {number} size 出力 px
 * @param {string} filename
 * @param {object} opts
 *   - charRatio: 文字サイズ / size (0.85 くらいが見栄え良い)
 *   - bg: 背景色 (null = 透過)
 *   - fg: 前景色
 *   - baselineY: 文字中心の Y 座標比率 (0.5 が中央だが草書は上寄りなので 0.56 前後)
 */
function render(size, filename, opts) {
  const { charRatio = 0.85, bg = '#F5F0E8', fg = '#2C2418', baselineY = 0.56 } = opts || {};
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
  }

  const fontSize = Math.round(size * charRatio);
  ctx.fillStyle = fg;
  ctx.font = `${fontSize}px KouzanSousho`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('詠', size / 2, size * baselineY);

  const outPath = path.join(ASSETS, filename);
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log(`✓ ${filename} (${size}x${size})`);
}

// ===== iOS / 汎用アイコン (1024×1024、文字 85%) =====
render(1024, 'icon.png', { charRatio: 0.85 });
render(1024, 'icon-ios.png', { charRatio: 0.85 });

// ===== スプラッシュ (ライト背景、文字 85%) =====
render(400, 'splash-icon.png', { charRatio: 0.85, bg: null });  // 背景は app.config で #F5F0E8

// ===== スプラッシュ ダーク版 (透過、文字色を明るく) =====
render(400, 'splash-icon-dark.png', { charRatio: 0.85, bg: null, fg: '#E8E0D0' });

// ===== Android adaptive icon foreground =====
// Android のランチャーは foreground を中央 66% にクロップする (safe area)。
// 文字サイズは 0.60 程度が無難 (safe area にぴったり収まりつつ見栄えが良い)。
render(1024, 'android-icon-foreground.png', { charRatio: 0.60, bg: null });

// ===== Android monochrome icon (Android 13+ のテーマ化アイコン用) =====
// システムが自動で色を置き換えるので、黒で描画しておけば OK。
render(1024, 'android-icon-monochrome.png', { charRatio: 0.60, bg: null, fg: '#000000' });

console.log('done.');

/**
 * KouzanSousho フォントで「詠」の favicon PNG を生成する。
 *
 * 実行:
 *   cd scripts
 *   node generate-favicon.js
 *
 * 出力: docs/favicon.png (複数サイズ)
 */

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

const FONT_PATH = path.resolve(__dirname, '../assets/fonts/KouzanSousho.otf');
const OUTPUT_DIR = path.resolve(__dirname, '../docs');

// フォント登録
GlobalFonts.registerFromPath(FONT_PATH, 'KouzanSousho');

/**
 * 指定サイズで favicon を生成
 * @param {number} size - 出力 PNG の一辺 (px)
 * @param {string} filename - 保存ファイル名
 */
function generate(size, filename) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // 背景（角丸はブラウザで自動的にかからないので矩形のまま。iOSは自動で角丸にする）
  ctx.fillStyle = '#F5EFDF';
  ctx.fillRect(0, 0, size, size);

  // 「詠」を中央にでっかく描画
  const fontSize = Math.round(size * 0.95);
  ctx.fillStyle = '#2C2418';
  ctx.font = `${fontSize}px KouzanSousho`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 草書の「詠」は全体的に上寄りになりがちなので、少し下に補正
  ctx.fillText('詠', size / 2, size * 0.54);

  const outPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log(`✓ ${filename} (${size}x${size})`);
}

generate(32, 'favicon-32.png');
generate(180, 'favicon-180.png');  // Apple touch icon
generate(512, 'favicon-512.png');  // 高解像度
generate(180, 'favicon.png');       // デフォルト
console.log('done.');

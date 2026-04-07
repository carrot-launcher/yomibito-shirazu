import { Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

// 基準幅: 390dp (標準的なスマホ)
const BASE_WIDTH = 390;

/**
 * 画面幅に応じたフォントサイズスケーリング
 * factor: 0 = 固定サイズ, 1 = 完全にスケール, 0.4 = 控えめにスケール
 */
export function fs(size: number, factor = 0.4): number {
  const scale = width / BASE_WIDTH;
  return Math.round(size + (scale - 1) * factor * size);
}

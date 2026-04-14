// @react-native-firebase + useFrameworks:static の組み合わせで起きる
// "non-modular header inside framework module" エラーを回避するため、Podfile を調整する plugin。
//   1) 先頭に $RNFirebaseAsStaticFramework = true を追記
//   2) 先頭に use_modular_headers! を追記（React-Core などのヘッダをモジュラー扱いに）
//   3) post_install で RNFB* の pod に CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES=YES を設定（保険）
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const STATIC_MARKER = '$RNFirebaseAsStaticFramework';
const MODULAR_MARKER = 'use_modular_headers!';
const POST_INSTALL_MARKER = 'RNFB_NON_MODULAR_FIX';

module.exports = function withFirebaseStaticFramework(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      // (1) & (2) Podfile 先頭に追記
      const header = [];
      if (!contents.includes(STATIC_MARKER)) header.push(`${STATIC_MARKER} = true`);
      if (!contents.includes(MODULAR_MARKER)) header.push(MODULAR_MARKER);
      if (header.length > 0) {
        contents = header.join('\n') + '\n\n' + contents;
      }

      // (3) post_install に RNFB* 向けフラグ追加（保険）
      if (!contents.includes(POST_INSTALL_MARKER)) {
        const hook = `
  # ${POST_INSTALL_MARKER}: allow non-modular includes in RNFB* framework pods
  installer.pods_project.targets.each do |target|
    if target.name.start_with?('RNFB')
      target.build_configurations.each do |config|
        config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
      end
    end
  end
`;
        // 既存の post_install do |installer| があればそこに追記、無ければ末尾に追加
        if (/post_install\s+do\s+\|installer\|/.test(contents)) {
          contents = contents.replace(/post_install\s+do\s+\|installer\|/, (m) => m + hook);
        } else {
          contents += `\npost_install do |installer|${hook}end\n`;
        }
      }

      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);
};

// @react-native-firebase + useFrameworks:static の組み合わせで起きる
// "non-modular header inside framework module" エラーを回避するため、Podfile を調整する plugin。
//   1) 先頭に $RNFirebaseAsStaticFramework = true を追記
//   2) post_install で全ての pods に CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES = YES を設定
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const STATIC_MARKER = '$RNFirebaseAsStaticFramework';
const POST_INSTALL_MARKER = 'RNFB_NON_MODULAR_FIX';

module.exports = function withFirebaseStaticFramework(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      if (!contents.includes(STATIC_MARKER)) {
        contents = `${STATIC_MARKER} = true\n\n` + contents;
      }

      if (!contents.includes(POST_INSTALL_MARKER)) {
        const hook = `
  # ${POST_INSTALL_MARKER}: allow non-modular includes for every pod (fixes @react-native-firebase with use_frameworks!:static)
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
    end
  end
`;
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

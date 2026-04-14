// iOS の Podfile を調整する config plugin。
// useFrameworks を使わない構成で Firebase の Swift pods をビルドするため、
// GoogleUtilities 等の非モジュラー pod を modular headers で扱うよう設定する。
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODULAR_MARKER = 'use_modular_headers!';

module.exports = function withFirebaseStaticFramework(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      if (!contents.includes(MODULAR_MARKER)) {
        contents = `${MODULAR_MARKER}\n\n` + contents;
        fs.writeFileSync(podfilePath, contents);
      }
      return cfg;
    },
  ]);
};

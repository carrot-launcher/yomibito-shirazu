// @react-native-firebase + useFrameworks:static の
// "non-modular header" エラーを回避するため、Podfile 先頭に
// $RNFirebaseAsStaticFramework = true を追記する config plugin。
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '$RNFirebaseAsStaticFramework';

module.exports = function withFirebaseStaticFramework(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (!contents.includes(MARKER)) {
        contents = `${MARKER} = true\n\n${contents}`;
        fs.writeFileSync(podfilePath, contents);
      }
      return cfg;
    },
  ]);
};

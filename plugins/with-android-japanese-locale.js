// Android リソースに values-ja/strings.xml を追加する config plugin。
//
// 経緯: values/ にしかリソースが無いと、Google Play のリソーススキャナが
// 「このアプリは明示的なロケール指定なし」と解釈し、ストア上で既定言語が
// 英語として扱われてしまう（Testers Community から "The app sets English as
// the default language" と指摘された）。
// values-ja/strings.xml を置くことで「日本語をサポートしている」と明示する。
//
// values/ も日本語のままにしておくことで、未知ロケール端末でもフォールバックで
// 日本語が出る挙動は維持する（英語 strings.xml を作るのはこのアプリでは不要）。
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const STRINGS_XML = `<resources>
  <string name="app_name">よみ人しらず</string>
</resources>
`;

module.exports = function withAndroidJapaneseLocale(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const resDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'res', 'values-ja'
      );
      fs.mkdirSync(resDir, { recursive: true });
      fs.writeFileSync(path.join(resDir, 'strings.xml'), STRINGS_XML);
      return cfg;
    },
  ]);
};

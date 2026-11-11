const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withXcodeCloud(config) {
  config = withXcodeProject(config, (mod) => {
    const entries = Object.values(mod.modResults.pbxXCBuildConfigurationSection());
    for (const entry of entries) {
      const settings = entry?.buildSettings;
      if (!settings?.PRODUCT_BUNDLE_IDENTIFIER) continue;
      settings.CODE_SIGN_STYLE = 'Automatic';
      settings.MARKETING_VERSION = config.version;
    }
    return mod;
  });
  return withDangerousMod(config, ['ios', async (mod) => {
    const root = mod.modRequest.projectRoot;
    const ios = mod.modRequest.platformProjectRoot;
    const scripts = path.join(ios, 'ci_scripts');
    fs.mkdirSync(scripts, { recursive: true });
    for (const name of ['ci_post_clone.sh']) {
      fs.copyFileSync(path.join(root, 'ci', 'xcode-cloud', name), path.join(scripts, name));
      fs.chmodSync(path.join(scripts, name), 0o755);
    }
    // Expo's template includes an XCTest target reference without an XCTest target.
    // There are JS tests in post-clone; do not advertise a nonexistent native test suite.
    const scheme = path.join(ios, 'PuntosFieles.xcodeproj', 'xcshareddata', 'xcschemes', 'PuntosFieles.xcscheme');
    fs.writeFileSync(scheme, fs.readFileSync(scheme, 'utf8').replace(/<Testables>[\s\S]*?<\/Testables>/, '<Testables></Testables>'));
    // Check in the workspace entry point so Xcode Cloud can discover it before Pods install.
    const workspace = path.join(ios, 'PuntosFieles.xcworkspace');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'contents.xcworkspacedata'), `<?xml version="1.0" encoding="UTF-8"?>
<Workspace version="1.0">
  <FileRef location="group:PuntosFieles.xcodeproj"></FileRef>
  <FileRef location="group:Pods/Pods.xcodeproj"></FileRef>
</Workspace>
`);
    return mod;
  }]);
};

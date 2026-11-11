const { withAppBuildGradle, withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const marker = '// PuntosFieles release signing';

function configureReleaseGradle(contents) {
  if (contents.includes(marker)) return contents;
  const releaseSigner = /release\s*\{\s*(?:\/\/[^\n]*\n\s*)*signingConfig signingConfigs\.debug/;
  if (!releaseSigner.test(contents) || !contents.includes('    signingConfigs {') || !/versionCode \d+/.test(contents)) {
    throw new Error('Unrecognized Expo Android Gradle template; review release signing before building');
  }
  const guard = `
${marker}
def pfVersionCode = System.getenv('PF_ANDROID_VERSION_CODE')
if (pfVersionCode != null && (!(pfVersionCode ==~ /[1-9][0-9]*/) || pfVersionCode.toBigInteger() > 2100000000)) {
    throw new GradleException('Invalid PF_ANDROID_VERSION_CODE')
}
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.project == project && it.name.toLowerCase().contains('release') }) {
        ['PF_ANDROID_KEYSTORE_PATH', 'PF_ANDROID_STORE_PASSWORD', 'PF_ANDROID_KEY_PASSWORD', 'PF_ANDROID_KEY_ALIAS', 'PF_ANDROID_VERSION_CODE'].each { name ->
            if (!System.getenv(name)?.trim()) throw new GradleException('Missing ' + name + ' for release signing')
        }
        if (System.getenv('PF_ANDROID_KEY_ALIAS').equalsIgnoreCase('androiddebugkey')) throw new GradleException('Debug keys are forbidden for release')
        if (!['PKCS12', 'JKS'].contains(System.getenv('PF_ANDROID_STORE_TYPE') ?: 'PKCS12')) throw new GradleException('Invalid PF_ANDROID_STORE_TYPE')
        if (!file(System.getenv('PF_ANDROID_KEYSTORE_PATH')).isFile()) throw new GradleException('Release keystore file is missing')
    }
}
`;
  return contents.replace('\nandroid {', `${guard}\nandroid {`)
    .replace(/versionCode \d+/, 'versionCode pfVersionCode != null ? pfVersionCode.toInteger() : 1')
    .replace('    signingConfigs {', `    signingConfigs {
        pfRelease {
            def keystorePath = System.getenv('PF_ANDROID_KEYSTORE_PATH')
            storeFile keystorePath ? file(keystorePath) : null
            storePassword System.getenv('PF_ANDROID_STORE_PASSWORD')
            keyAlias System.getenv('PF_ANDROID_KEY_ALIAS')
            keyPassword System.getenv('PF_ANDROID_KEY_PASSWORD')
            storeType System.getenv('PF_ANDROID_STORE_TYPE') ?: 'PKCS12'
        }`)
    .replace(releaseSigner, 'release {\n            signingConfig signingConfigs.pfRelease');
}

module.exports = function withAndroidRelease(config) {
  config = withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('Android release signing expects the Expo Groovy template');
    mod.modResults.contents = configureReleaseGradle(mod.modResults.contents);
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    // expo-notifications is retained for iOS APNs. Android push is unsupported.
    for (const name of ['firebase_messaging_auto_init_enabled', 'firebase_analytics_collection_enabled']) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(application, name, 'false');
    }
    return mod;
  });
};
module.exports.configureReleaseGradle = configureReleaseGradle;

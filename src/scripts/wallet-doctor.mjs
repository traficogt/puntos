import 'dotenv/config';
import { loadNativeWalletConfig } from '../app/services/native-wallet/config.js';

const settings=loadNativeWalletConfig();
const report={
  apple:{enabled:settings.apple.enabled,locallyReady:settings.apple.ready,issues:settings.apple.errors},
  google:{enabled:settings.google.enabled,locallyReady:settings.google.ready,issues:settings.google.errors},
  verification:'Local configuration only. Issuer permissions, publishing approval, installation and push delivery require real account/device checks.'
};
console.log(JSON.stringify(report,null,2));
if ([settings.apple,settings.google].some(p=>p.enabled&&!p.ready)) process.exitCode=1;

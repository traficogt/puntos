#!/usr/bin/env node
import { parseArguments, runLocalAndroid } from './android-local-lib.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(`Manual local Android builder (Linux)

  node apps/customer/scripts/android-local.mjs doctor
  node apps/customer/scripts/android-local.mjs setup
  node apps/customer/scripts/android-local.mjs build --version-code 13

Optional flags:
  --state-dir ABSOLUTE_PATH     Private state/cache directory outside the repository
  --keystore ABSOLUTE_PATH      Existing private PKCS12 upload key
  --password-file ABSOLUTE_PATH Existing private password file
  --key-alias ALIAS             Existing upload alias (default: pf-upload)

Doctor is read-only. Setup requires 25 GiB free on the state and Docker filesystems.
Setup/build require root and hold /run/puntos-android-builder.lock across all states.
If container cleanup cannot be confirmed, workspace/locks and recovery details remain.
Build also requires 4.5 GiB available RAM. Version 13 is a verification build;
choose a deliberate higher version for a future Play upload. No uploads occur.`);
} else {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const options = parseArguments(args);
    const result = await runLocalAndroid(options, { signal: controller.signal });
    if (options.command === 'doctor') {
      console.log(result.ready ? 'Local Android builder is ready.' : 'Local Android builder needs preparation:');
      for (const issue of result.issues) console.log(`- ${issue}`);
      if (!result.ready) process.exitCode = 1;
    } else {
      console.log(options.command === 'setup' ? 'Local Android toolchain setup completed.' : `Validated Android artifacts: ${result.artifactDirectory}`);
      console.log(`Private diagnostic log: ${result.logFile}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

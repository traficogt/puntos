# Lemon Squeezy Review Cuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce clean 60-second and 90-second English-captioned product demo videos for Lemon Squeezy review using the existing browser-based recorder, verify the output artifacts, and upload both files to the provided Nextcloud share.

**Architecture:** Extend the existing Playwright recorder into profile-based review cuts instead of building a second recorder. Keep one reproducible capture script, add timing profiles for `short60` and `review90`, emit separate filenames automatically, and verify both artifacts before upload.

**Tech Stack:** Node.js, Playwright, existing Docker app stack, WebM video capture, curl/WebDAV upload to Nextcloud share

---

### Task 1: Add Review-Cut Profiles To The Recorder

**Files:**
- Modify: `scripts/record-lemon-demo.mjs`
- Test: `node scripts/record-lemon-demo.mjs --profile short60`
- Test: `node scripts/record-lemon-demo.mjs --profile review90`

- [ ] **Step 1: Add profile parsing and output naming**

Update the recorder so it accepts `--profile short60` and `--profile review90`, with sensible defaults and filenames.

```js
function getArg(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return String(argv[index + 1] || fallback).trim();
}

function resolveProfile(argv) {
  const profile = getArg(argv, "--profile", "review90");
  if (!["short60", "review90"].includes(profile)) {
    throw new Error("Invalid --profile. Use short60 or review90.");
  }
  return profile;
}

function outputFilenameForProfile(profile) {
  if (profile === "short60") return "puntosfieles-demo-60s-captioned-en.webm";
  return "puntosfieles-demo-90s-captioned-en.webm";
}
```

- [ ] **Step 2: Define scene-timing profiles**

Add one object that controls scene timing rather than hardcoding wait values everywhere.

```js
const reviewProfiles = {
  short60: {
    landing: { settle: 1400, scrollDown: 700, scrollPause: 800, scrollUp: 700 },
    wallet: { intro: 1500, qr: 1800, rewardsDown: 900, rewardsPause: 1000, rewardsUp: 700 },
    staff: { intro: 1400, afterSelect: 1200, afterRegister: 1800 },
    walletRefresh: { intro: 1200, afterRefresh: 1800, scrollDown: 900, endPause: 1000 },
    dashboard: { intro: 1600, scroll: 900, endPause: 1200 }
  },
  review90: {
    landing: { settle: 2200, scrollDown: 1200, scrollPause: 1200, scrollUp: 900 },
    wallet: { intro: 1800, qr: 2400, rewardsDown: 1400, rewardsPause: 1600, rewardsUp: 1000 },
    staff: { intro: 1800, afterSelect: 1600, afterRegister: 2200 },
    walletRefresh: { intro: 1500, afterRefresh: 2400, scrollDown: 1200, endPause: 1400 },
    dashboard: { intro: 2000, scroll: 1400, endPause: 1600 }
  }
};
```

- [ ] **Step 3: Replace hardcoded waits with profile values**

Use the selected profile to drive every `waitForTimeout` and scroll amount that affects runtime.

```js
const profileName = resolveProfile(process.argv.slice(2));
const profile = reviewProfiles[profileName];

await page.goto(marketingOrigin, { waitUntil: "domcontentloaded" });
await setCaption(page, "PuntosFieles helps businesses turn loyalty activity into repeat visits, rewards, and measurable growth.");
await page.waitForTimeout(profile.landing.settle);
await page.mouse.wheel(0, 640);
await page.waitForTimeout(profile.landing.scrollDown);
await page.mouse.wheel(0, -220);
await page.waitForTimeout(profile.landing.scrollUp);
```

Repeat this replacement pattern for the wallet, staff, refresh, and dashboard scenes.

- [ ] **Step 4: Rename the output file per profile**

Replace the fixed output filename with the profile-specific one.

```js
const finalPath = path.join(outputDir, outputFilenameForProfile(profileName));
await rename(savedPath, finalPath).catch(() => {});
console.log(`video_path: ${finalPath}`);
console.log(`profile: ${profileName}`);
```

- [ ] **Step 5: Run the short profile to ensure the recorder completes**

Run: `node scripts/record-lemon-demo.mjs --profile short60`

Expected:
- command exits `0`
- output includes `video_path: /opt/puntos/artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm`

- [ ] **Step 6: Run the 90-second profile to ensure the recorder completes**

Run: `node scripts/record-lemon-demo.mjs --profile review90`

Expected:
- command exits `0`
- output includes `video_path: /opt/puntos/artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm`

- [ ] **Step 7: Commit**

```bash
git add scripts/record-lemon-demo.mjs
git commit -m "feat: add lemon review video profiles"
```

### Task 2: Verify The Generated Review Artifacts

**Files:**
- Inspect: `artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm`
- Inspect: `artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm`

- [ ] **Step 1: Check both files exist and have non-trivial size**

Run:

```bash
ls -lh artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm
ls -lh artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm
```

Expected:
- both files exist
- each file is clearly larger than `1MB`

- [ ] **Step 2: Confirm both outputs are valid WebM artifacts**

Run:

```bash
file artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm
file artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm
```

Expected:
- each command reports `WebM`

- [ ] **Step 3: Sanity-check the recorder logs for the selected business**

Run:

```bash
node scripts/record-lemon-demo.mjs --profile short60
node scripts/record-lemon-demo.mjs --profile review90
```

Expected in both outputs:
- `business: Test Café`
- `customer_phone: 50255555555` or the current test customer phone

- [ ] **Step 4: Commit only if verification required code edits**

```bash
git status --short
```

Expected:
- no new code changes from verification alone

### Task 3: Upload Both Review Cuts To The Nextcloud Share

**Files:**
- Upload: `artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm`
- Upload: `artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm`

- [ ] **Step 1: Upload the 60-second cut**

Run:

```bash
curl -u 'TdeMiPsdzQXR9jQ:' -T artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm 'https://valoracion.xyz/public.php/dav/files/TdeMiPsdzQXR9jQ/puntosfieles-demo-60s-captioned-en.webm'
```

Expected:
- curl exits `0`

- [ ] **Step 2: Upload the 90-second cut**

Run:

```bash
curl -u 'TdeMiPsdzQXR9jQ:' -T artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm 'https://valoracion.xyz/public.php/dav/files/TdeMiPsdzQXR9jQ/puntosfieles-demo-90s-captioned-en.webm'
```

Expected:
- curl exits `0`

- [ ] **Step 3: Verify the 60-second uploaded file is reachable**

Run:

```bash
curl -I -u 'TdeMiPsdzQXR9jQ:' 'https://valoracion.xyz/public.php/dav/files/TdeMiPsdzQXR9jQ/puntosfieles-demo-60s-captioned-en.webm'
```

Expected:
- `HTTP/2 200`
- `content-type: video/webm`

- [ ] **Step 4: Verify the 90-second uploaded file is reachable**

Run:

```bash
curl -I -u 'TdeMiPsdzQXR9jQ:' 'https://valoracion.xyz/public.php/dav/files/TdeMiPsdzQXR9jQ/puntosfieles-demo-90s-captioned-en.webm'
```

Expected:
- `HTTP/2 200`
- `content-type: video/webm`

- [ ] **Step 5: Commit only if upload work required code changes after capture**

```bash
git status --short
```

Expected:
- only intended code changes, no accidental artifact staging

### Task 4: Final Verification And Handoff

**Files:**
- Modify: `scripts/record-lemon-demo.mjs`
- Verify: `src/app/routes/public-routes.js`
- Verify: `src/config/index.js`

- [ ] **Step 1: Run focused regression tests for the magic-link and local-capture path**

Run:

```bash
node --test tests/unit/internal-magic-link-routes.test.js tests/unit/internal-magic-link-service.test.js tests/unit/create-magic-link-script.test.js
```

Expected:
- all tests pass

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected:
- exits `0`

- [ ] **Step 3: Confirm the branch is clean and synced**

Run:

```bash
git status --short --branch
```

Expected:
- `## main...origin/main`

- [ ] **Step 4: Report the uploaded filenames explicitly**

Provide these exact outputs in the final handoff:

```text
Uploaded:
- puntosfieles-demo-60s-captioned-en.webm
- puntosfieles-demo-90s-captioned-en.webm
```

- [ ] **Step 5: Final commit if any capture-profile code changed after Task 1**

```bash
git add scripts/record-lemon-demo.mjs
git commit -m "chore: finalize lemon review video profiles"
```


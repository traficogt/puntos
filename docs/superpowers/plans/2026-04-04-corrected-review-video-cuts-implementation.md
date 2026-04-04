# Corrected Review Video Cuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the 60-second and 90-second Lemon Squeezy review videos so the captions are reviewer-oriented and the delivered runtimes land close to the promised durations.

**Architecture:** Keep one Playwright recorder, but replace the loose timing model with explicit per-scene duration budgets and reviewer-oriented caption text. Regenerate both video cuts, measure the actual durations, and overwrite the uploaded files in the Nextcloud share.

**Tech Stack:** Node.js, Playwright, existing Docker app stack, WebM browser capture, ffprobe or browser-based duration check, curl/WebDAV upload to Nextcloud share

---

### Task 1: Rewrite Recorder Profiles Around Explicit Duration Budgets

**Files:**
- Modify: `scripts/record-lemon-demo.mjs`
- Test: `node scripts/record-lemon-demo.mjs --profile short60`
- Test: `node scripts/record-lemon-demo.mjs --profile review90`

- [ ] **Step 1: Replace profile metadata with scene-budgeted configuration**

Refactor the profile object so each profile contains:
- `filename`
- `targetSeconds`
- `scenes` with reviewer-oriented captions and duration budgets

Use a structure like:

```js
const reviewProfiles = {
  short60: {
    filename: "puntosfieles-demo-60s-captioned-en.webm",
    targetSeconds: 60,
    scenes: {
      landing: {
        caption: "This is the public landing page for the loyalty platform.",
        totalMs: 8000,
        settleMs: 1800,
        scrollDownMs: 1800,
        scrollUpMs: 1400,
        endPauseMs: 3000
      },
      wallet: {
        caption: "This is the customer wallet, where members view points, rewards, and their QR.",
        totalMs: 16000,
        introMs: 2600,
        qrMs: 3400,
        rewardsDownMs: 2800,
        rewardsUpMs: 1800,
        endPauseMs: 5400
      }
    }
  },
  review90: {
    filename: "puntosfieles-demo-90s-captioned-en.webm",
    targetSeconds: 90,
    scenes: {
      landing: {
        caption: "This is the public landing page for the loyalty platform.",
        totalMs: 12000,
        settleMs: 2600,
        scrollDownMs: 2600,
        scrollUpMs: 2200,
        endPauseMs: 4600
      }
    }
  }
};
```

- [ ] **Step 2: Rewrite every caption in reviewer-oriented English**

Update the caption strings so they describe the role and fulfillment clearly.

Use text along these lines:

```js
landing.caption = "This is the public landing page for the loyalty platform.";
wallet.caption = "This is the customer wallet, where members view points, rewards, and their QR.";
staff.caption = "This is the staff workflow for identifying a customer and recording loyalty activity.";
walletRefresh.caption = "After staff records activity, the customer can refresh the wallet and see the updated balance.";
dashboard.caption = "This is the owner dashboard for monitoring growth, retention, and reward performance.";
```

- [ ] **Step 3: Use scene-budget values consistently in playback timing**

Replace the current timing reads so each scene uses the new explicit budget fields.

Example pattern:

```js
await setCaption(page, profile.scenes.landing.caption);
await page.waitForTimeout(profile.scenes.landing.settleMs);
await page.mouse.wheel(0, 640);
await page.waitForTimeout(profile.scenes.landing.scrollDownMs);
await page.mouse.wheel(0, -220);
await page.waitForTimeout(profile.scenes.landing.scrollUpMs);
await page.waitForTimeout(profile.scenes.landing.endPauseMs);
```

Do the same for wallet, staff, wallet refresh, and dashboard.

- [ ] **Step 4: Preserve profile-specific output files and legacy alias**

Keep the output behavior already added:
- profile-specific filenames for the new cuts
- legacy copy to `puntosfieles-demo-captioned-en.webm`

Expected final behavior:

```js
const finalPath = path.join(outputDir, profile.filename);
await rename(savedPath, finalPath).catch(() => {});
if (finalPath !== path.join(outputDir, legacyOutputFilename)) {
  await copyFile(finalPath, path.join(outputDir, legacyOutputFilename)).catch(() => {});
}
```

- [ ] **Step 5: Run the 60-second profile**

Run: `node scripts/record-lemon-demo.mjs --profile short60`

Expected:
- exits `0`
- reports `video_path: /opt/puntos/artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm`

- [ ] **Step 6: Run the 90-second profile**

Run: `node scripts/record-lemon-demo.mjs --profile review90`

Expected:
- exits `0`
- reports `video_path: /opt/puntos/artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm`

- [ ] **Step 7: Commit**

```bash
git add scripts/record-lemon-demo.mjs
git commit -m "feat: correct review video timing and captions"
```

### Task 2: Measure Actual Runtime And Confirm It Matches The Promise

**Files:**
- Inspect: `artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm`
- Inspect: `artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm`

- [ ] **Step 1: Verify both output files exist and are WebM files**

Run:

```bash
ls -lh artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm
ls -lh artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm
file artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm
file artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm
```

Expected:
- both files exist
- both report `WebM`

- [ ] **Step 2: Measure the 60-second cut duration**

Preferred command if available:

```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm
```

Expected:
- duration lands close to `60` seconds, within a small tolerance like about `57-63s`

If `ffprobe` is not available, use a browser/video-metadata fallback and report the measured number.

- [ ] **Step 3: Measure the 90-second cut duration**

Preferred command if available:

```bash
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm
```

Expected:
- duration lands close to `90` seconds, within a small tolerance like about `87-93s`

If `ffprobe` is not available, use a browser/video-metadata fallback and report the measured number.

- [ ] **Step 4: If a cut misses target materially, adjust timings and rerun only that profile**

Example rerun commands:

```bash
node scripts/record-lemon-demo.mjs --profile short60
node scripts/record-lemon-demo.mjs --profile review90
```

Expected:
- regenerate only the profile that missed target
- re-measure until the cut lands close to the promised duration

### Task 3: Re-Upload The Corrected Cuts To The Share

**Files:**
- Upload: `artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm`
- Upload: `artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm`

- [ ] **Step 1: Upload the corrected 60-second cut**

Run:

```bash
curl -u 'TdeMiPsdzQXR9jQ:' -T artifacts/lemon-squeezy-demo/puntosfieles-demo-60s-captioned-en.webm 'https://valoracion.xyz/public.php/dav/files/TdeMiPsdzQXR9jQ/puntosfieles-demo-60s-captioned-en.webm'
```

Expected:
- exits `0`

- [ ] **Step 2: Upload the corrected 90-second cut**

Run:

```bash
curl -u 'TdeMiPsdzQXR9jQ:' -T artifacts/lemon-squeezy-demo/puntosfieles-demo-90s-captioned-en.webm 'https://valoracion.xyz/public.php/dav/files/TdeMiPsdzQXR9jQ/puntosfieles-demo-90s-captioned-en.webm'
```

Expected:
- exits `0`

- [ ] **Step 3: Verify the corrected 60-second upload**

Run:

```bash
curl -I -u 'TdeMiPsdzQXR9jQ:' 'https://valoracion.xyz/public.php/dav/files/TdeMiPsdzQXR9jQ/puntosfieles-demo-60s-captioned-en.webm'
```

Expected:
- `HTTP/2 200`
- `content-type: video/webm`

- [ ] **Step 4: Verify the corrected 90-second upload**

Run:

```bash
curl -I -u 'TdeMiPsdzQXR9jQ:' 'https://valoracion.xyz/public.php/dav/files/TdeMiPsdzQXR9jQ/puntosfieles-demo-90s-captioned-en.webm'
```

Expected:
- `HTTP/2 200`
- `content-type: video/webm`

### Task 4: Final Verification And Handoff

**Files:**
- Modify: `scripts/record-lemon-demo.mjs`
- Verify: `src/app/routes/public-routes.js`
- Verify: `src/config/index.js`

- [ ] **Step 1: Run focused regression tests**

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

- [ ] **Step 4: Report the corrected uploaded filenames and measured durations**

Provide these exact outputs in the final handoff:

```text
Uploaded:
- puntosfieles-demo-60s-captioned-en.webm
- puntosfieles-demo-90s-captioned-en.webm
```

Also report the measured durations for both files.


# Project working instructions

## Website and app release cadence

Owner decision on November 10, 2026: iterate on the website first and bring
selected changes to the native apps only when the owner explicitly requests it.
The owner has no Mac and wants to conserve Codemagic's free build minutes.

- Default work targets the public website, browser application screens, and
  necessary server changes. Website work does not authorize matching changes to
  the iOS or Android apps under `apps/customer`.
- Keep native app features, dependencies, and release versions unchanged until
  the owner explicitly requests app work. Do not automatically port website
  changes, rebuild the apps, upload new binaries, or send over-the-air updates.
- Do not start Codemagic or other cloud native workflows during website
  iteration. This includes simulator builds and dependency-resolution jobs.
  Use local checks and browser testing appropriate to the website change.
- When the owner requests an app release, collect the selected changes into a
  deliberate release, run applicable local checks first, then use native build
  minutes for the requested platforms. Keep cloud build triggers manual.
- Preserve backward compatibility of shared APIs and stored data with installed
  app versions. A website deployment must not require customers to update their
  native apps. Browser tests do not establish native device behavior.

The current native baseline is iOS **0.1.0 (3)** in TestFlight and Android
**0.1.0 (13)** on Google Play's internal-testing track.

## Android build infrastructure

Android builds use the manual local Linux builder documented in
`apps/customer/docs/ANDROID_LOCAL.md`. Codemagic is reserved for explicitly
requested iOS builds. Keep the website-first release cadence above: local
build capacity does not authorize automatic Android releases during website
work. Local verification artifacts do not authorize Google Play uploads.

## Article citations and scientific rigor

Owner requirement on November 14, 2026: every article must include in-text
citations and an APA-style reference list at the end. This is mandatory for
article drafts as well as published articles.

- Use author–date citations beside the claims they support and complete APA-style
  references, including verified DOI links or source URLs where applicable.
- Check that every citation has a matching reference and that the reference list
  contains the sources actually cited. Identify any further reading separately.
- Verify source metadata and the relevant original passages. Never invent
  references, findings, quotations, or page numbers; disclose limited access.
- Preserve the scientific distinctions between association and causation,
  measured outcomes and estimates, and research findings and PF's own proposals.
  Include relevant methods, context, uncertainty, and contrary or null findings.
- Write accessibly for business owners while retaining this scientific standard.
  Research informing a PF design does not establish PF's commercial effectiveness.

## Article prose reference

Owner instruction on November 14, 2026: use the writing style of
https://edu.tallerlumiere.com/ for article prose. Read suitable technical and
historical articles there when preparing a draft, using the designated material
as the style reference. Preserve original wording for PF's own subject matter;
do not transfer the reference author's experiences or factual claims to PF.
The mandatory author–date citations and APA-style reference list above continue
to apply, regardless of how references are formatted on the example site.

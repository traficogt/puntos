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

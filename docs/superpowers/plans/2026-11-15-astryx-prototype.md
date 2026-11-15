# Astryx prototype implementation plan

**Goal:** Demonstrate the locally installed Astryx design system in a complete PF landing concept and working browser components.

**Architecture:** An isolated React/Vite application in `web/astryx-prototype`; generated static files are published only under an unlisted review path. All customer, campaign and business data is fictional and held in browser memory. No production APIs, account changes, native changes or cloud native builds.

**Tech stack:** Astryx 0.7.16, its neutral theme, React 19, Vite, existing self-hosted PF fonts and approved editorial artwork.

1. Inspect the installed CLI, component documentation and side-gallery/dashboard templates. Preserve the existing visual identity; use a split editorial landing composition and a task-oriented dashboard.
2. Create isolated dependencies and the landing, dashboard, campaign dialog, loyalty card and component playground. Include filters, light/dark mode, form validation and an explicit reset.
3. Build static output, inspect desktop/mobile screenshots, exercise every important interaction, check keyboard behavior and accessibility, and review the rendered design independently.
4. Publish only the static preview directory with noindex. Verify the live page and preserve the current website and native release cadence.
5. Only after the prototype is complete, install and run the user-requested Cloudflare security-audit skill against PF. Keep its findings distinct from this exploratory design.

Acceptance: a shareable URL; actual Astryx components and theme provider; no console exceptions, overflow or broken controls at mobile/desktop widths; no backend mutations; build reproducible from the isolated package lock. Root package edits belong to the user's installation and remain untouched.

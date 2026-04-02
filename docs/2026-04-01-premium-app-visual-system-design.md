# Premium App Visual System Design

**Date:** 2026-04-01  
**Status:** Approved in conversation, pending implementation  
**Scope:** Product UI design system and shell refresh for application surfaces

## Goal

Move the application toward a premium, high-trust product UI that feels calm, expensive, intentional, and operationally clear without turning it into a generic SaaS dashboard.

This design applies to the product application surfaces, not the public marketing site.

It also includes a small brand-consistency correction:

- the canonical PF icon remains the motion-study version, unchanged
- favicon and app-icon PNG exports must preserve transparent corners

## Product Boundary

PuntosFieles should operate as two visual environments:

- `puntosfieles.com` = marketing / sales surface
- `app.puntosfieles.com` = product application shell

These surfaces should feel related, but not identical.

The marketing site can remain warmer and more editorial.

The application should move into a darker, calmer, more operational visual system.

## Platform Constraint

This redesign must remain PWA-first and native-ready.

That means:

- application surfaces must continue to work as installable web experiences first
- theme, shell, and navigation choices must not assume a browser-only environment
- the design must remain compatible with a future Capacitor or similar native wrapper
- browser metadata, icons, theme colors, safe spacing, and shell primitives should be suitable for both installed PWAs and future native shells

This pass must not introduce:

- browser-only UI assumptions that break in a native webview
- route structures that depend on marketing-site context to function
- visual treatments that only work when multiple browser tabs/windows are visible

## Core Design Direction

The application should feel like a premium operational product:

- dark, high-trust, and production-grade
- restrained instead of flashy
- strong hierarchy instead of many equal-weight panels
- typography-led rather than decoration-led
- calm in passive states
- explicit and meaningful in active states

It must avoid:

- generic startup dashboard patterns
- template-looking equal-weight card grids
- decorative gradients without structural purpose
- passive UI animation
- loud badge clutter
- default bright blue SaaS styling

## Typography System

Typography should be tokenized so the font stack can be swapped later without a full redesign.

Current practical stack:

- `brand` = `Bricolage Grotesque`
- `display` = `Fraunces`
- `ui/body` = `Inter`
- `mono` = system monospace for codes, timestamps, IDs, counters, and machine-like metadata

Usage rules:

- `Bricolage Grotesque` should remain primarily the brand wordmark face
- `Fraunces` should carry major display moments, state titles, and selected hero/empty-state headings inside the app
- `Inter` should handle navigation, forms, buttons, labels, tables, metrics, and operational text
- monospace should be used only where the content is machine-like

Fonts must be consumed through global tokens, not hardcoded ad hoc in individual components.

## Theme System

The application should support both dark and light themes where it makes sense, but through one shared design system.

Rules:

- one component system
- one layout system
- one typography system
- one interaction model
- two token sets: `dark` and `light`

Dark is the design anchor.

Light is a first-class companion theme, not a separate redesign.

Theme resolution order:

1. saved user preference
2. system preference
3. dark fallback

Theme support should apply to:

- app shell
- merchant dashboard
- staff flow
- customer wallet
- join flow

Theme support must not create:

- theme-specific layouts
- theme-specific route forks
- theme-specific UX structures

## Color System

The application should use a dark-first palette with subtle depth and disciplined semantic color use.

Recommended semantic rules:

- emerald/green = healthy, approved, success, connected, live
- red = denial, destructive, critical, error
- amber = caution, degraded, fallback, pending manual review
- neutral steel/gray = processing, validating, loading, inactive support states

Avoid default bright SaaS blue unless there is a specific, defensible reason.

The PF icon itself remains the existing motion-study palette:

- deep navy background
- ivory structural stroke
- gold accents

The surrounding UI should adapt to the icon, not recolor the icon to match a page.

## Screen Architecture

Every important application screen should have one dominant focal area.

The product should stop feeling like many equal-weight cards arranged in a grid.

Recommended shell model:

- top bar for program/account/section context
- restrained nav rail or stable secondary navigation zone
- one dominant work area per screen
- optional supporting context zone only when it has a real job

By surface:

### Merchant dashboard

- primary operational workspace first
- analytics and supporting material are visually subordinate
- fewer, larger, stronger panels

### Staff flow

- nearly single-task
- optimized around scan, validation, reward, and decision moments
- minimal distraction

### Customer wallet and join

- same product language as the app
- slightly softer and more ceremonial than merchant surfaces
- still dark-first and premium

### Marketing site

- out of scope for this system beyond brand consistency

## Controls And Interaction Hierarchy

Controls should feel deliberate, custom, and product-specific.

Action hierarchy:

- primary command
- quiet secondary action
- utility/support action
- danger/destructive action

Design constraints:

- no generic blue primary buttons
- secondary controls should feel quieter and more restrained
- destructive actions must be explicit and visually distinct
- controls must not feel like a default component-library demo

## Motion Rules

Motion must explain state, not decorate the interface.

Allowed purposes:

- loading
- validating
- approved
- denied
- degraded / offline

Rules:

- no passive decorative pulsing in nav, cards, or shell chrome
- success and failure motion should play once and settle
- motion should clarify the state transition, not simply add energy

## Implementation Scope

This pass should cover:

- shared app theme tokens
- dark/light theme infrastructure
- product typography tokens
- application shell styling direction
- merchant dashboard visual refresh
- staff flow visual refresh
- customer wallet/join visual refresh
- favicon transparency/export correction

This pass should not cover:

- a full marketing-site redesign
- arbitrary tenant theme customization
- theme-specific route forks
- a second component library
- font experiments hardcoded into components

## Technical Guidance

Implementation should prefer:

- CSS variables for theme tokens
- tokenized typography roles
- stable semantic utility classes only where they reinforce the system
- minimal runtime theme mutations beyond root-level theme switching

The theme system should be able to support future font swaps by changing imports and token assignments rather than rewriting screens.

## Rollout Order

Recommended order:

1. fix favicon transparency and icon export path
2. introduce shared typography and theme tokens
3. refresh shared controls and shell primitives
4. redesign merchant dashboard shell
5. redesign staff flow
6. redesign customer wallet and join within the same app language
7. evaluate whether the marketing site should be visually adjusted later for stronger continuity

## Language Rule

This remains a Spanish-first product.

All new or revised user-facing copy in application surfaces should default to Spanish unless there is a specific operational reason not to.

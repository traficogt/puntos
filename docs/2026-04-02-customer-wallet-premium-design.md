# Customer Wallet Premium Design

Date: 2026-04-02

## Goal

Redesign the customer wallet at `/c` so it feels like a premium loyalty product rather than a generic utility screen. The wallet should present one active program clearly, prioritize fast comprehension, and reinforce the product split between marketing and app surfaces.

This pass is presentation-first, not a route or data-model redesign. The wallet remains PWA-first, Spanish-first, and native-ready.

## Scope

In scope:

- the logged-in wallet shell at `/c`
- the logged-out entry shell at `/c`
- information hierarchy inside the customer wallet
- visual treatment of the main loyalty card, progress, rewards, activity, and account sections
- Spanish-first labels and customer-facing copy adjustments

Out of scope:

- multi-business wallet switching
- route changes
- auth flow redesign
- new backend APIs
- native-app-specific UI
- merchant/staff/admin dashboards

## Product Intent

`/c` should feel like the customer's active loyalty card for one business. It should communicate:

- what program is active
- how many points are available
- what the next reward is
- how to use the QR right now
- what happened recently

It should not feel like a dense dashboard with many equal-weight cards.

## Information Architecture

### 1. Dominant wallet hero

The first screenful should be led by one dominant premium card containing:

- active program label
- business name
- customer identity
- connection / sync state
- large available points balance
- QR generation area and status

This card is the focal area of the screen.

### 2. Progress band

Immediately after the hero, the wallet should surface progress and momentum:

- next reward summary
- level / tier name
- multiplier
- progress message
- progress bar

The goal is to make the next meaningful milestone obvious without scrolling through all rewards equally.

### 3. Secondary content zone

Below the main wallet and progress band, the page should show supporting information in descending importance:

- rewards
- recent activity
- referrals
- achievements

These should be visually quieter than the hero and avoid reading like a generic analytics grid.

### 4. Quiet account utilities

Data export and account deletion remain available, but they should live at the bottom in a clearly separated, low-emphasis account section.

## Visual Direction

### Wallet tone

The wallet should feel closer to a premium pass than to a SaaS card stack:

- one large dominant card
- strong vertical rhythm
- fewer, stronger surfaces
- subdued metadata
- clear visual separation between primary and secondary information

### Hierarchy

Primary emphasis:

- points balance
- business identity
- QR action
- next reward

Secondary emphasis:

- tier progress
- rewards list
- recent activity

Quiet emphasis:

- achievements
- referral utilities
- export / deletion

### Typography

Use the existing tokenized font roles:

- display face for major value moments such as points and the most important reward/progress headlines
- UI sans for labels, body text, controls, and structured content
- no decorative typography changes outside those roles

The design must remain easy to retheme later through font tokens.

### Motion

The wallet shell itself should remain calm. No decorative pulsing or ambient animation should be added.

Allowed motion in this pass:

- QR generation state
- sync / online state transitions if already present
- one-shot success/error feedback already tied to actions

## Behavioral Rules

### Logged-out state

The logged-out version of `/c` should remain a clean entry shell with two paths:

- go to `registro/:slug`
- log in with phone + code

This state should feel supportive, not like an error screen.

### Logged-in state

If the customer is signed in, `/c` opens directly into the active wallet. There is no business-switching UI in this pass.

### QR usage

The QR remains a primary action. Its state should be obvious:

- before generation
- after generation
- when expiry/sync state matters

### Rewards and activity

The wallet should highlight the next realistic reward instead of flattening all rewards into the same visual level. Recent activity should be easier to scan than raw text dumps, but this pass should reuse existing data and frontend behavior.

## Implementation Notes

The redesign should favor structural HTML/CSS changes with minimal JavaScript churn.

Expected code touchpoints:

- `public/customer.html`
- `public/styles/pages.css`
- small copy/layout adjustments in `public/customer/index.js` only if needed to support clearer section labels or placeholders

## Testing

Before implementation, add a wallet shell contract test that verifies:

- one dominant wallet hero remains present
- progress / next reward is surfaced near the top
- account utilities stay in a lower-priority section
- logged-out entry shell still exposes registration and login paths
- customer-facing copy remains Spanish-first

The redesign should preserve existing wallet behavior while tightening hierarchy.

## Success Criteria

This pass is successful if:

- `/c` reads as a premium loyalty wallet in one quick scan
- the customer can immediately understand their active program, balance, QR action, and next reward
- the lower sections no longer compete equally with the hero
- the page feels calmer, clearer, and less like a generic admin interface

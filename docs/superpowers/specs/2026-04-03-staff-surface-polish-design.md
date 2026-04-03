# Staff Surface Polish Design

Date: 2026-04-03

## Goal

Refine `/staff` into a faster, clearer in-store surface without changing the core staff workflow that was already corrected earlier.

The page should feel customer-centered, operational, and hard to misuse. Staff should immediately understand:

- who they are serving
- whether the customer is ready for action
- whether they are about to register points or redeem a reward
- what just happened after an action completes

This is a hierarchy and interaction pass, not a new redemption system.

## Product Intent

`/staff` is not a dashboard. It is the operator surface for an in-progress customer interaction.

The dominant mental model should be:

1. Select the customer
2. Confirm the active customer state
3. Perform one action
4. See the updated result immediately

The page should stop feeling like several equal-weight cards and start feeling like one focused customer transaction workspace.

## Chosen Direction

The approved layout direction is **cliente dominante**.

That means the visual hierarchy becomes:

1. Customer selection area
2. Active customer summary
3. Action rail for `Registrar puntos` and `Canjear recompensa`
4. Lower-priority support and operational sections

The scanner is still important, but it should no longer dominate the screen once a customer has been selected.

## Screen Structure

### Primary workspace

The top of the page becomes a two-column workspace:

- left: customer selection
- right: active customer state and actions

#### Left column: `Seleccionar cliente`

This column contains:

- camera selection and camera stage
- manual token input
- scan/start/pause controls
- quiet sync or offline state

This column’s job is only to identify the customer and load them into the active state.

#### Right column: `Cliente activo`

This is the dominant panel after selection.

It should show:

- customer name
- phone or customer identifier
- current points balance
- immediate reward eligibility signal
- a strong ready state when the customer can be acted on

The tone should be operational and calm, not decorative.

### Action rail

Below the active customer summary, place the working actions in a compact shared area:

- `Registrar puntos`
- `Canjear recompensa`
- `Gift card` only if relevant and visually subordinate

These actions should read as operations being performed on the selected customer, not as unrelated panels.

`Registrar` and `Canjear` should remain distinct, but their visual treatment should feel like two modes of work under the same customer.

### Secondary sections

Support, security, analytics, and owner-oriented sections remain on the page but move below the primary workspace and become quieter.

They should never compete with:

- customer identity
- current points
- reward eligibility
- award/redeem controls

## Interaction Behavior

### Before a customer is selected

The page should clearly say that staff must first identify a customer.

Recommended copy direction:

- `Escanea o ingresa el código del cliente para continuar.`

Before selection:

- customer summary shows an empty state
- action controls are visibly inactive or disabled
- reward redeem controls do not look ready

### After a customer is selected

The page should switch into a clear active state.

Recommended cues:

- a visible ready indicator such as `Cliente listo`
- populated customer details
- current points total
- immediate callout if one or more rewards are redeemable now

The operator should be able to tell at a glance whether the next step is:

- register points
- redeem a reward

### During actions

Important actions should not rely on generic toast feedback alone.

While an action is in flight, the relevant area should communicate that directly:

- `Registrando puntos...`
- `Canjeando recompensa...`

Success and failure should still be toast-capable, but the primary feedback should appear in the working surface itself where possible.

### After actions

After a successful award or redemption:

- customer points should update in place
- reward eligibility should refresh immediately
- redemption code, when relevant, should remain visible in context
- the surface should settle into the new state instead of feeling transient

## Existing Logic To Preserve

This pass must preserve the corrected flow already in place:

- scan/select customer only
- do not auto-award on scan
- `Registrar` requires a selected customer
- `Canjear` requires a selected customer
- reward options remain sorted by eligibility

No backend model changes are required for this pass.

## Scope

### In scope

- `/staff` layout hierarchy
- selected customer summary treatment
- clearer ready/disabled states
- clearer in-surface action feedback
- calmer visual treatment for secondary sections
- copy adjustments for operational clarity

### Out of scope

- new reward redemption architecture
- new customer QR/token model
- cart or POS sale modeling
- analytics backend changes
- owner dashboard changes

## Testing And Verification

The implementation plan should include:

- contract coverage for the new hierarchy markers in `public/staff.html`
- behavioral tests for selection-required states
- checks that award/redeem readiness remains correct
- verification that key strings and states remain Spanish-first

Manual verification should cover:

- before selection state
- selecting a customer
- registering points
- redeeming an eligible reward
- offline or sync-warning visibility

## Success Criteria

The pass is successful when:

- staff immediately understands that the page revolves around the active customer
- the next valid action is obvious
- award vs redeem is harder to confuse
- important results are visible in the workspace without depending only on toasts
- the page feels faster and calmer for real in-store use

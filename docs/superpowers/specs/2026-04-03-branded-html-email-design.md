# Branded HTML Email Design

## Objective

Add branded HTML email support to the existing messaging pipeline without breaking non-email delivery channels. Every email-capable message should render as:

- `subject`
- `text`
- `html`

SMTP should send multipart email with plain-text fallback. WhatsApp, WAHA, Baileys, and Twilio remain text-only.

## Why

The current messaging pipeline is text-only. That is functional, but it wastes an obvious trust and brand surface:

- verification codes look generic
- security notifications look generic
- lifecycle and churn messages do not reflect business branding
- the app already has tenant branding data that can be reused safely for email

The goal is to make email messages look intentional and premium while staying robust in real email clients.

## Existing Context

Current message routing:

- `sendMessage()` in `src/app/services/messaging-service.js`
- SMTP provider in `src/app/services/messaging/providers/smtp-provider.js`
- routed providers:
  - `dev`
  - `smtp_email`
  - `whatsapp_cloud`
  - `waha`
  - `twilio`
  - `baileys`

Current message/event coverage in code:

- `verify`
- `security`
- `lifecycle`
  - birthday
  - winback
  - suspicious digest / alert-style sends
- `CHURN`

Current branding source:

- `business.customer_branding_json`
- normalized customer-facing brand tokens already exist in frontend code, but email should use a smaller, email-safe subset

## Design Choice

Use one shared branded email shell with typed message renderers underneath it.

This is preferable to:

- one generic HTML renderer for everything, which becomes too rigid
- fully custom templates per message, which duplicates layout and branding rules

The design keeps:

- one consistent premium email look
- message-specific copy and layout blocks
- plain-text fallback everywhere

## Branding Rules

Email branding uses a conservative subset of business branding:

- business/program name
- business logo URL
- primary color
- accent color
- `powered_by_visible`

Fallback behavior:

- if business context is missing, use PuntosFieles defaults
- if logo URL is missing or unsafe, render text brand only
- if colors are missing, use safe platform defaults

Brand ownership must follow message ownership:

- **platform / PuntosFieles context**:
  - use PuntosFieles branding
  - examples:
    - PF-level security or operational notices
    - PF-level prospect/customer emails not tied to one business
- **business / tenant context**:
  - use that business's branding
  - examples:
    - verification codes for a specific business
    - lifecycle and churn emails for a specific business
    - customer communication sent on behalf of that business

This pass includes tenant-aware email rendering logic from the start. What it does **not** include is a self-serve email-template editor in the dashboard.

Email must not depend on:

- external web fonts
- fragile gradients
- app-like layout complexity
- dynamic client-side rendering

The look should be premium and branded, but email-safe first.

## Rendering Contract

Introduce a message rendering contract that can represent both legacy text-only messages and richer email messages.

Target shape:

- `subject`
- `text`
- `html`

Backward compatibility:

- existing callers that only send `body` must continue to work
- if only `body` is provided, the system generates:
  - `text = body`
  - `html = simple branded wrapper around body`
  - `subject = sensible default based on channel`

Structured callers can provide richer content for better HTML rendering.

## Template Coverage

The first HTML template set should cover all real email-capable messages currently emitted by the app:

### Verification

- channel: `verify`
- use case: customer code delivery
- structure:
  - title
  - business/program context
  - prominent code block
  - expiry/help text

### Security

- channel: `security`
- use case: account/security notifications
- structure:
  - alert title
  - explanatory body
  - footer guidance

### Lifecycle

- channel: `lifecycle`
- supported events:
  - birthday
  - winback
  - suspicious digest / alert-style business sends
- structure varies by event type, but all share the same shell

### Churn

- channel: `CHURN`
- use case: re-engagement
- structure:
  - comeback headline
  - short incentive copy
  - business context

## Architecture

### 1. Email Brand Resolver

Add a small server-side branding resolver for email templates.

Responsibilities:

- accept a business record or `businessId`
- resolve safe branding tokens
- apply fallbacks
- return email-safe brand values

Resolution rule:

- if `businessId` or a business record is present, resolve tenant branding first
- otherwise resolve platform branding

This should stay separate from the frontend branding helper because:

- email rendering is server-side
- email needs a smaller and more conservative token set
- frontend-specific UI text should not leak into email rendering

### 2. Email Template Renderer

Add a renderer layer that builds:

- `subject`
- `text`
- `html`

Structure:

- base shell renderer
- typed message renderers for the supported events

The shell handles:

- header / logo / brand name
- outer layout
- footer
- accent treatment

Typed renderers supply:

- title
- intro
- body blocks
- optional emphasis block
- optional callout / code card

### 3. Messaging Service Upgrade

Upgrade `sendMessage()` so it can work with either:

- legacy `body`
- structured email content

The service should normalize message content before routing. Email providers receive:

- `subject`
- `text`
- `html`

Non-email providers continue to use:

- text only

### 4. SMTP Provider Upgrade

Upgrade the SMTP provider to send multipart email:

- `subject`
- `text`
- `html`

If `html` is missing, it should still send `text`.

### 5. Caller Integration

Update current message callers to use richer content where appropriate:

- verification requests
- security notifications
- churn
- lifecycle notifications

This should be done incrementally, without changing message routing semantics.

## Maintainability And Future Changes

Business-branded email changes should be easy after this pass because the system is intentionally layered:

- brand tokens live in one resolver
- shell layout lives in one base template
- message-specific copy/layout lives in typed renderers

That means most future changes fall into one of these buckets:

- **change branding values**
  - easy
  - update tenant branding data or platform defaults
- **change the shared email look**
  - easy to moderate
  - update the base shell once and all templates inherit it
- **change one message type**
  - easy
  - update the typed renderer for that message only
- **add a new message type**
  - moderate
  - add one renderer and plug it into the same shell/resolver contract

This keeps email branding adaptable without requiring a template editor or a rewrite every time copy or presentation changes.

## Error Handling

If email branding/template rendering fails:

- fall back to plain text
- do not block message delivery if a plain-text path still exists

If branding lookup fails:

- use platform defaults

If logo rendering is unsafe or invalid:

- omit the image
- keep text brand only

Delivery reliability wins over presentation.

## Testing

Add focused unit coverage for:

- SMTP provider includes HTML when available
- legacy text-only callers still work
- verification email renders code and text fallback
- security email renders a branded alert shell
- churn/lifecycle renderers produce subject/text/html
- branding fallback works with missing business branding
- invalid logo URL does not break email rendering

Verification before completion should include:

- focused unit tests for email rendering/provider behavior
- lint
- a real SMTP send through the app transport, using the configured relay

## Scope Boundaries

Included in this pass:

- branded HTML email infrastructure
- server-side branding resolver for email
- multipart SMTP delivery
- coverage for all current email-capable message types

Not included in this pass:

- MJML / React email pipeline
- self-serve business email template editor
- per-business custom copy management UI
- tracking pixels / analytics instrumentation for emails
- image hosting or upload pipeline changes

## Success Criteria

The feature is successful when:

- email messages are branded and consistent
- SMTP sends multipart `text + html`
- plain-text fallback remains intact
- existing non-email providers keep working unchanged
- all current app email-capable messages can render through the new system

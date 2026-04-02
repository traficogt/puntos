# Customer Auth And Message Routing Design

Date: 2026-04-02

## Goal

Make customer access reliable and Spanish-first while introducing a delivery architecture that can support multiple verification channels without changing the core customer model every time a provider changes.

The immediate business goal is:

- keep customer identity phone-first
- make customer entry and return access explicit
- support SMTP as the reliable baseline delivery path
- support WAHA/Baileys, Meta WhatsApp Cloud, and Twilio as pluggable delivery options
- ensure provider flakiness does not block customer access when fallback channels are available

## Current Problems

The current implementation has several structural issues:

- customer access is split awkwardly between `/registro/:slug` and `/c`
- there is no separate customer login route
- the current verification flow is phone-only, so email cannot be used as a fallback channel cleanly
- messaging is controlled by one global `MESSAGE_PROVIDER`, which is too rigid
- the SMTP path assumes auth is always required, which does not match the available SMTP server
- several customer-facing auth errors still surface in English

## Product Decision

### Customer routes

Customer routes are business-specific and Spanish-first:

- `/registro/:slug`
  - first-time activation
  - requests and verifies a code
- `/ingresar/:slug`
  - returning customer login
  - requests and verifies a code
- `/c`
  - wallet only
  - never acts like a generic login screen

### Customer identity

Customer identity remains phone-first.

Email is supported as an optional delivery fallback input during verification, but it is not the primary customer identity in this pass.

### Delivery strategy

Verification uses one code per request and routes delivery through an ordered provider chain.

The router may attempt, in order:

- `waha`
- `baileys`
- `whatsapp_cloud`
- `twilio`
- `smtp_email`

The exact order is configurable by platform defaults, and businesses may later have a preferred delivery policy layered on top.

SMTP is the safe baseline and must support:

- host `10.10.1.20`
- port `26`
- `secure: false`
- no auth when username and password are empty

## Architecture

### 1. Message router

Replace the single-provider assumption with a message router that:

- receives one logical send request
- determines eligible providers for that message
- tries them in configured order
- stops on first success
- records attempts and final outcome

The rest of the app should still call one messaging entry point. Provider-specific behavior stays behind adapters.

### 2. Provider adapters

Create isolated adapters for:

- `smtp_email`
- `waha`
- `baileys`
- `whatsapp_cloud`
- `twilio`
- `dev`

Each adapter should answer one question: can it send this message with the currently available destination data and configuration?

Examples:

- `smtp_email` requires an email destination
- WhatsApp and Twilio adapters require a phone destination
- SMTP must omit the `auth` block when credentials are empty
- Baileys should be an adapter boundary, even if the initial implementation delegates to an HTTP bridge or local worker later

### 3. Delivery policy

Introduce a delivery policy abstraction with two layers:

- platform defaults
  - global provider order
  - credentials and endpoints
  - fallback behavior
- business policy
  - optional preferred verification channel
  - optional permission to fall back to email
  - premium-only provider enablement such as Twilio later

This pass only needs enough business policy structure to avoid boxing the system in. A full business-facing messaging settings UI is out of scope.

### 4. Verification request model

Customer verification request payloads should support:

- required `phone`
- optional `email`
- optional `name`

The verification service should:

- normalize and validate contact fields
- create one verification code
- hand the send request to the message router with both contact options available
- return a Spanish error if no configured channel can deliver the code

Email is for delivery fallback in this pass. It does not need to become part of the permanent customer record yet.

## Route Behavior

### `/registro/:slug`

Purpose:

- first-time activation

Behavior:

- collect phone
- optionally collect email
- request code
- verify code
- on success, create or attach customer session and redirect to `/c`

Copy should make the channel behavior explicit in Spanish, for example:

- `Te enviaremos un código por WhatsApp o correo, según la configuración del negocio.`

### `/ingresar/:slug`

Purpose:

- returning customer login

Behavior:

- collect phone
- optionally collect email
- request code
- verify code
- on success, restore customer session and redirect to `/c`

This is intentionally similar to registration, but with different framing and copy.

### `/c`

Purpose:

- wallet only

Behavior:

- if customer session exists, open wallet
- if session is missing and an active business slug is known, redirect to `/ingresar/:slug`
- if neither exists, show a minimal Spanish message explaining that the customer must enter from the business link

`/c` must not contain signup or pseudo-login controls.

## Error Handling

All customer-facing verification and auth errors must be Spanish-first.

At minimum, these current English cases need to be normalized:

- `Business not found`
- `Phone required`
- `Code required`
- `No valid code. Request a new one.`
- `Invalid code`
- rate-limit responses related to verification
- provider misconfiguration and provider failure responses

Backend responses may still use stable internal error semantics, but anything surfaced to the customer UI must be rendered in Spanish.

## Logging And Observability

Message logging should record:

- logical message type, such as `verify`
- destination type used
- provider attempts
- winning provider
- failure reason when all providers fail

Verification success and failure should remain auditable without leaking raw codes into logs.

## Security

- verification code remains one code per request regardless of delivery channel
- codes remain short-lived and single-use
- failures should not expose provider secrets or internal credentials
- SMTP credentials should be optional, not assumed
- Twilio and WhatsApp providers should remain disabled unless explicitly configured

## Scope

Included in this pass:

- provider router and adapter boundary
- SMTP no-auth support
- WAHA adapter
- Baileys adapter boundary
- WhatsApp Cloud adapter alignment
- Twilio adapter
- `/registro/:slug` and `/ingresar/:slug` split
- `/c` fallback cleanup
- Spanish customer auth errors

Not included in this pass:

- full per-business messaging admin UI
- permanent customer email identity model
- multi-business customer switching
- billing/checkout for premium providers
- full provider analytics dashboard

## Testing

Add or update tests for:

- message router fallback order
- SMTP sending without auth credentials
- provider selection based on available destination fields
- `/registro/:slug` customer flow
- `/ingresar/:slug` customer flow
- `/c` redirect behavior when session is missing
- Spanish rendering for customer auth errors

Manual smoke should cover:

- registration via business route
- returning login via business route
- wallet reopen after successful verification
- fallback to email when a phone channel is unavailable

## Rollout

Recommended rollout:

1. keep `dev` working for local/testing flows
2. enable `smtp_email` as the baseline production-capable provider
3. wire WAHA, Baileys, WhatsApp Cloud, and Twilio behind config flags
4. activate additional providers only when their credentials and operational support are ready

This gives the product a reliable baseline now without blocking future channel upgrades.

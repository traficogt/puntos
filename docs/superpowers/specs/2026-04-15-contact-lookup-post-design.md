# Contact Lookup POST Design

## Goal

Replace `GET /api/v1/public/contacts/{customerId}` with `POST /api/v1/public/contacts/lookup` so contact lookup remains compatible with the current raw-body HMAC model without relying on a GET request body.

## Decision

Make this a clean breaking change:

- remove `GET /api/v1/public/contacts/{customerId}`
- add `POST /api/v1/public/contacts/lookup`

No compatibility route will be kept because integrations are still early and the GET contract is an awkward fit for the security model.

## Request Contract

`POST /api/v1/public/contacts/lookup`

Request body:

- `businessSlug`
- `customerId`

Rules:

- `customerId` must be a UUID
- `businessSlug` is required
- `x-signature` is required
- the HMAC must be computed over the exact raw JSON request body

## Response Contract

The response shape stays the same as the current lookup route:

- `ok`
- `contact`
- `identifiers`

Errors stay aligned with the current public integration style:

- `400` for validation errors
- `401` for invalid signature
- `404` for missing business or missing customer

## Security

This change preserves the stronger and simpler security model:

- request identity lives in the JSON body
- signature verification is over the raw JSON body
- no special-case GET-body handling
- no mismatch between the signed payload and the effective lookup target

This is intentionally closer to the Orders API pattern than the prior GET lookup shape.

## Implementation Notes

Change areas:

- `src/app/routes/contact-sync-routes.js`
- `src/scripts/generate-openapi.mjs`
- `tests/unit/contact-sync-routes.test.js`
- `tests/unit/openapi-contract.test.js`

The old GET route should be removed entirely, not left deprecated.

## Verification

Minimum verification:

- route unit tests cover:
  - successful lookup
  - invalid signature
  - invalid UUID
- OpenAPI contract tests assert the new `POST /api/v1/public/contacts/lookup` path
- old GET lookup path is no longer documented

## Risks

This is a breaking API change for any external client already using the GET lookup route.

That risk is acceptable here because:

- the route is new
- no UI depends on it
- carrying both contracts would keep unnecessary surface area and ambiguity

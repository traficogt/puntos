# ADR 0001: External Secret Files

## Status
Accepted

## Context
The application previously allowed repo-local secrets and inline environment values to drift into normal development and deployment workflows. That created avoidable leakage risk and made it too easy for documentation, compose files, and bootstrap scripts to disagree on the source of truth.

## Decision
Runtime secrets are loaded from external files via `*_FILE` configuration. The repo may contain examples and test-only defaults, but live secrets must be provisioned outside the checkout and mounted into the containers or host process.

## Consequences
- Bootstrapping, compose, and docs must all describe the same external-secret model.
- CI may use ephemeral test secrets, but production and shared environments must never rely on repo-local secret files.
- Any future feature that adds a secret must provide a `*_FILE` path and update the operator docs in the same change.

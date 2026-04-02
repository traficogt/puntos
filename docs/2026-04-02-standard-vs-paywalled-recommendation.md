# Standard vs Paywalled Recommendation

## Goal
Optimize for higher revenue per business while keeping the product credible and usable on the base plan.

## Existing plan-gated features found in code
- gift_cards
- rewards
- redemptions
- program_rules
- staff_management
- fraud_monitoring
- lifecycle_automation
- customer_export
- rbac_matrix
- analytics
- tiers
- referrals
- gamification
- multi_branch
- webhooks
- external_awards
- campaign_rules

## Recommended packaging

### EMPRENDEDOR
Keep included:
- QR and customer wallet
- points, rewards, and redemptions
- basic program rules
- one location
- basic staff access
- core platform safety protections in the background

Do not include:
- analytics
- tiers
- referrals
- customer export
- multi-branch
- gift cards
- campaign rules
- webhooks
- lifecycle automation
- advanced branding controls
- external awards
- gamification

### NEGOCIO
Include everything in EMPRENDEDOR plus:
- analytics
- tiers
- referrals
- customer export
- multi-branch
- gift cards
- campaigns
- webhooks
- automations
- advanced RBAC
- premium branding for customer-facing surfaces

This should be the practical target plan for serious businesses.

### EMPRESA
Include everything in NEGOCIO plus:
- gamification
- external awards / external event-driven point issuance
- advanced branding
- future custom domain
- future QR logo embedding
- enterprise-heavy controls as they are added later

## Recommendation notes
- `lifecycle_automation` is already false for EMPRENDEDOR in code; keep visible/admin-facing lifecycle automation in paid tiers and retain background safety protections for all plans.
- Match the pricing docs: advanced RBAC belongs in NEGOCIO and EMPRESA, and future custom domain plus future QR logo embedding belong under EMPRESA.

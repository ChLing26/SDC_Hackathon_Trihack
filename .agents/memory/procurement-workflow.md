---
name: SME procurement workflow
description: Business audience and intended procurement journey.
---

The product serves SMEs and procurement teams who currently find suppliers, compare quotes, and manage approvals manually.

The requested journey is requirements (item, quantity, budget, delivery date), supplier matching with shipping, speed and proximity, an average option score, purchasing-manager review, then signed e-invoices for both parties and recommendations based on historical choices.

**Why:** These are the user's stated product goals, not an assumption that this is only a supplier directory.

**How to apply:** Preserve the end-to-end journey when extending the product. Do not present illustrative supplier quotes, self-entered approver identity, or integrity hashes as live supplier integration, authenticated authorization, or legally certified signatures. Production supplier access and e-invoice jurisdiction/provider still require clarification.

## Account scope

Accounts provide access to one shared procurement workspace, not private datasets or purchasing-manager authority.

**Why:** The user explicitly required the existing shared-workspace model to remain intact when adding login. Self-entered manager names are not verified account identities or authorization.

**How to apply:** Do not silently introduce record ownership, organizations, or manager-only permissions. Any such change requires a separate product decision and must update the disclosures.

## Signed invoice corrections

Treat an invoice's electronic signature as permanent consent evidence. Future corrections should use an explicit amendment or reissue process rather than replacing the original signer or signed document.

**Why:** Downloaded PDF copies can remain outside the workspace. Silently replacing a signature or changing signed content would leave conflicting versions of the same invoice.

**How to apply:** Preserve the original signed evidence when adding invoice editing, countersigning, or reissuing. An internal account signature must not be described as verified supplier consent or certificate-backed legal certification.

## Supplier signature scope

The supplier signature is an internal typed entry recorded by a signed-in workspace account, not an independently authenticated supplier action. The user confirmed this scope rather than supplier invitations or public signing links.

**Why:** The entered representative and recording account can be different people. Treating the entry as verified supplier identity or authority would overstate the evidence.

**How to apply:** Keep representative identity separate from recording identity and disclose that supplier identity and authority are unverified. Do not add supplier roles, portals, invitations, or legal certification without a new product decision.

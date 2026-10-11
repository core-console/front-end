# Finance v1 design authority

## Authority

Start with the
[approved Finance interaction specification](../../finance-v1-frontend-interaction-spec.md)
and the repository's [Finance visual authority](../../../DESIGN.md#finance-v1-authority).
Before integration work, also read the current
[Finance backend/OpenAPI integration status](../../../README.md#finance-v1-integration-status).

The approved interaction specification owns frontend workflows, interaction
behavior, user-facing state transitions, navigation semantics, required
responsive behavior, and state presentation. `DESIGN.md`, the existing Core
Console shell, checked-in shadcn components, and semantic design tokens own
the global visual and implementation constraints within which Finance is built.

The 13 historical Finance v1 PNG mockups have been retired. They no longer
define current UI authority for information architecture, page composition,
major desktop layout relationships, or visual direction. Follow the approved
specifications and `DESIGN.md` for those requirements.

Spacing, density, borders, radii, typography, responsive behavior, and component
composition may
be refined toward a neutral, restrained, data-dense enterprise UI similar in
character to PrimeVue. Continue using the existing React, shadcn, and
design-token system; do not introduce PrimeVue or another UI framework.

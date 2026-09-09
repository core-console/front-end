# Finance v1 visual references

## Authority

Use this complete reference set together with the
[approved Finance interaction specification](../../finance-v1-frontend-interaction-spec.md)
and the repository's [Finance visual authority](../../../DESIGN.md#finance-v1-authority).
Before integration work, also read the current
[Finance backend/OpenAPI integration status](../../../README.md#finance-v1-integration-status).

The interaction specification owns frontend workflows, interaction behavior,
user-facing state transitions, and navigation semantics. These images own
Finance information architecture, page composition, major desktop layout
relationships, and visual direction. When they appear to conflict, preserve
the interaction behavior from the specification and use the images for
structural and visual guidance.

The images are not pixel-perfect implementation requirements. Spacing, density,
borders, radii, typography, responsive behavior, and component composition may
be refined toward a neutral, restrained, data-dense enterprise UI similar in
character to PrimeVue. Continue using the existing React, shadcn, and
design-token system; do not introduce PrimeVue or another UI framework.

## Complete reference set

### Destinations

- [Overview](overview.png)
- [Transactions](transactions.png)
- [Accounts](accounts.png)
- [Categories](categories.png)

### Transaction workflows

- [Record transaction](record-transaction.png)
- [Expense](expense.png)
- [Income](income.png)
- [Internal transfer](internal-transfer.png)
- [Balance adjustment](balance-adjustment.png)
- [Balance adjustment conflict](balance-adjustment-conflict.png)

### Account and category workflows

- [Add account](account-add.png)
- [Correct account semantics](account-correction.png)
- [Add category](category-add.png)

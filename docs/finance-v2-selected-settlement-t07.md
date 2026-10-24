# Finance v2 T07 selected repayment candidate

The canonical issue is [45](https://github.com/core-console/front-end/issues/45).
The immutable backend specification at
`e206bdd5af48a3f6b3b9b525c27fa6178220bdc7` remains the product authority.

The existing Repayments route now offers All eligible debt or Selected Obligations
only. Selection uses checkboxes labelled by source date, remaining Money and
stable Obligation identity. Only the chosen Participant's outstanding debt in the
receiving currency and eligible receipt date is selectable. Selected capacity and
excess are shown using exact decimal arithmetic. No debt is preselected in subset
mode. Unavailable selections require explicit removal; refreshing never adds debt.

Choosing more debt removes confirmation until another preview is reviewed.
Retained credit and accepted Income remain explicit choices. The existing Income
amount and Category intent are never automatically adjusted. Preview rejects an
Allocation outside the submitted subset. Confirmed history shows the complete
retained selection separately from actual Allocations. Gross debt composition and
available credit remain visible separately, including at zero net exposure.

The durable browser journal selects Settlement command version 4 only when
`selectedObligationIds` is present. It retains the entire original body, key,
version and owner namespace across pending, uncertain, reload, lookup and explicit
retry paths. Existing versions 1–3 and T01–T06 workflows remain supported.

The synchronized contract and Fetch/Query/Zod/MSW/Faker artifacts were regenerated
with `pnpm api:update` from the clean sibling backend at delivered producer P
`119dacf8283a44bc8f14cd93777cc4c9f92541d7`. Parsed OpenAPI equality was checked
against `git show P:openapi/openapi.json`. Regeneration reproduced the existing
candidate's generated artifacts without changes. The consumer remains uncommitted;
no delivered consumer C is claimed.

## Verification

Run `pnpm check` before production-preview tests; both rebuild `dist` and must
not overlap. Routed tests cover submitted scope and retained history. Existing
repayment, Income and durable-journal tests cover compatibility. The T07 browser
suite exercises real backend behavior, keyboard/focus, axe, exact Account effects,
gross debt/credit and response loss observed independently in PostgreSQL. Contract
checks cover the 39-operation Finance inventory, all six legacy/selected Settlement
source variants, and nested version-4 unfinished/created/rejected lookup outcomes.
The browser suite verifies confirmed expanded-scope Allocation order, original
command/owner recovery after reload, and correlated stale-preview rejection with
the exact expected HTTP 409 console diagnostic. Additional browser errors fail.

To run the real local candidate pair, first finish all backend PostgreSQL tests.
From the backend root, with its existing dedicated `TEST_DATABASE_URL` configured:

```powershell
.agent/toolchain/Scripts/uv.exe run --frozen python ../front-end/e2e/support/selected-settlement-backend.py
```

That helper uses the backend's guarded test fixture to reset/migrate only the
dedicated test target, then listens on `127.0.0.1:8297`. In the frontend root:

```powershell
$env:FINANCE_T07_TEST_BACKEND = 'http://127.0.0.1:8297'
pnpm e2e e2e/selected-settlements-integrated.spec.ts --workers=1
```

The suite is opt-in in ordinary CI because that isolated server is external to
the frontend runner; local explicit execution is required for this candidate's
pair evidence. Its test-only diagnostic endpoint is never installed in the
production backend. Stop the helper before resetting the target again.

This uncommitted consumer candidate is based on
`81a5c8d6900c5f708cb869bce14f65d089d3528b`; the recorded incoming digest was
`f71d90023cb3a78ea4707a8276339f56958915ae19528be5bb516b3aa7bfd9bb`.
Committed-P synchronization is complete. Local pair evidence does not satisfy
consumer delivery, exact-C CI, consumer publication evidence or delivered-pair
acceptance. No issue mutation or production activation is included.

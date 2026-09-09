# Finance v1 frontend interaction specification

Status: approved interaction specification

## 1. Purpose and authority

This document owns Finance v1 frontend workflows, interaction behavior,
user-facing state transitions, and navigation semantics. It also defines
required responsive behavior and state presentation.
The [Finance reference images](design/finance-v1/README.md) own visual
direction, major desktop layout relationships, page composition, and
information architecture as represented visually. They do not impose a
pixel-perfect layout or frontend implementation architecture.

The backend Finance foundation at commit
`144267b51ec59300d1708f6b2046183ba9d35dc0` and the backend Finance v1 Product
and API Specification at commit
`42c10d7fdb03032f7ba7fd60fc8d14a5b9758791` remain authoritative for Finance
vocabulary, product and domain semantics, business and domain rules, validation
semantics, and API behavior. This document translates those settled
capabilities into frontend behavior; it does not copy or redefine the backend
contract.

[DESIGN.md](../DESIGN.md) remains authoritative for the Core Console shell
and visual language. Finance belongs to that existing product. This document
does not redesign the global shell, product identity, typography system,
navigation language, or implemented Users visual conventions.

Finance v1 is desktop-first and supports viewport widths `>=1024px`. The
minimum-width requirement applies to the real Core Console shell with its
default expanded sidebar, not to an isolated 1024px Finance canvas. There is no
mobile-specific Finance product in v1.

## 2. Finance navigation and workflow structure

### 2.1 Global and local navigation

Core Console global navigation adds one destination: `Finance`.

Finance provides persistent, browser-addressable local destinations inside the
existing content area:

- Overview;
- Transactions;
- Accounts; and
- Categories.

The global shell/header identifies the product area as `Finance`. The Finance
content heading identifies the current local destination. The destination name
is not duplicated into both hierarchy levels merely for visual symmetry.

The exact composition of Finance-local navigation may be refined from the
Finance reference images within the visual authority defined in `DESIGN.md`.
It must not become four global navigation entries or a second application
sidebar. Internal Transfer and Balance Adjustment are operations, not
destinations.

Transaction detail is a browser-addressable subview under Transactions. It is
not an additional persistent Finance-local navigation destination.

### 2.2 Shared Ledger context

Every Finance destination keeps the selected Ledger visible and switchable. A
shared Finance context region provides direct access to:

- switch Ledger;
- create Ledger; and
- rename the current Ledger.

Selector or menu surfaces close before Create or Rename opens. Ledger
management must not create nested overlay chains.

When no Ledger exists, explicit first-Ledger onboarding replaces normal
Ledger-scoped Finance content.

### 2.3 Browser-addressable and remembered state

Browser-addressable Finance navigation state includes, where relevant:

- active Finance destination;
- selected Ledger;
- selected Overview month;
- selected Overview date; and
- applied Transaction-history filters.

This state supports reload, Back/Forward, deep navigation, and bookmarking. The
exact URL topology is not fixed here; in particular, this specification does
not decide whether Ledger identity is represented by a path segment or query
parameter.

The frontend may remember the last valid selected Ledger across Finance visits.
Ledger selection resolution begins only after the Ledger list loads
successfully. Navigation-addressable Ledger context takes precedence. When
navigation explicitly identifies a Ledger, the frontend selects it only when it
is valid; the Ledger-unavailable behavior below applies when it is not. When
navigation does not explicitly identify a Ledger, selection falls back in this
order:

1. the last remembered valid Ledger;
2. the deterministic first available Ledger; or
3. first-Ledger onboarding when none exists.

If navigation explicitly identifies a missing, inaccessible, or otherwise
unavailable Ledger, the frontend must not silently substitute another Ledger.
It shows a Ledger-unavailable state with the shared Ledger selector and safe
paths to select another Ledger or create the first Ledger when none exists. It
must not reveal whether an unavailable identifier exists under another Local
User or ownership scope.

Incomplete form drafts are local and temporary. They are not URL state, do not
survive reload, and are not restored after leaving and later returning to their
workflow. Within-Overview month/date history behavior is defined in section 7.3.

### 2.4 Ledger-switch state rules

Switching Ledger preserves state that remains semantically meaningful across
Ledgers:

- selected Overview month;
- selected date;
- generic Transaction-history date filters;
- Transaction-kind filter; and
- an Uncategorized filter.

It clears state that references the previous Ledger:

- Quick Entry Account and Category;
- Account-specific Transaction filter;
- Category-specific Transaction filter;
- selected Account or Category management resource; and
- any incomplete draft containing values from the previous Ledger.

A draft is never submitted or migrated across a Ledger boundary.

When the current Finance context is tied to a Transaction from the previous
Ledger, switching Ledger also:

- clears the addressed Transaction identifier;
- clears Transaction-detail state tied to the previous Ledger;
- clears any Edit, Delete, or Balance Adjustment replacement mutation state
  tied to that Transaction; and
- navigates to the new Ledger's Transactions destination.

The old Transaction detail URL or state is never carried into the new Ledger,
and the Transaction is never migrated, substituted, or reinterpreted there. An
active overlay mutation workflow is abandoned without submission. Portable
generic Transaction filters remain portable under the rules above, while
Account and Category resource-identifier filters remain cleared. This
Transaction-specific navigation rule does not change normal Ledger switching
from unrelated Finance destinations.

## 3. Ledger onboarding and management

First-Ledger onboarding is an inline Finance replacement state, not a dialog
over an empty Ledger-scoped page. It offers an editable Ledger name with
`Personal` as a suggestion. The Ledger is never created implicitly.

After first-Ledger creation, the frontend:

- selects the new Ledger;
- updates browser-addressable Ledger context;
- enters Overview; and
- initializes the local current month and calendar date.

Additional Ledger creation uses one dialog opened from the shared Finance
context. Successful creation selects the new Ledger, updates addressable state,
and applies the Ledger-switch rules above.

Rename uses a separate one-field dialog. Create and Rename conflicts preserve
the entered name, keep the user in the active workflow, and present contextual
safe feedback. Ledger archive and delete are not available in v1.

## 4. Finance Overview

### 4.1 Responsibilities and hierarchy

Overview answers four primary questions:

1. What is my current financial position?
2. What are this selected month's Income and Expense?
3. What happened on the selected date?
4. Can I record an ordinary Income or Expense immediately?

Its behavioral hierarchy is:

1. Finance-local navigation and Ledger context.
2. Present/current financial position.
3. Selected-month Income, Expense, and net with month navigation.
4. Seven-day Calendar as the dominant exploration workspace.
5. Inline keyboard-first Income/Expense Quick Entry for the selected date.
6. Selected-day Transaction detail.
7. Compact Account-level current-balance summary.

Selected-day detail remains part of the primary Calendar workflow. It may be
adjacent to the Calendar where space permits and reflows below Quick Entry at
the minimum supported width. The Calendar must not be compressed merely to keep
every region above the fold. Overview is not a generic analytics dashboard.

### 4.2 Current position versus selected-month activity

`Current financial position` is present/current information even while the user
browses an older month. It remains visually and semantically distinct from
`Selected-month activity`.

Already-recorded future-dated Transactions participate in present Current
Balances. The frontend must not relabel them as scheduled or pending execution.

Current financial position shows Asset total, Liability total, and net position
separately for each represented currency. Selected-month activity shows Income,
Expense, and net separately for each represented currency. Transfer and Balance
Adjustment activity never contributes to Income, Expense, or net.

The Account summary is secondary to the summaries, Calendar, selected-day
workflow, and Quick Entry. It contains every Account rather than an unexplained
ranked subset. Each Account communicates:

- name;
- present Current Balance;
- currency;
- Account Nature; and
- active or archived status.

Accounts owns full management. At narrower supported widths, the Account
summary moves below the primary Calendar workspace instead of narrowing the
Calendar.

### 4.3 Initial and month-navigation behavior

The initial Overview selects the frontend's local current month and date.

Explicit month controls are the only way to cross month boundaries in the
Calendar. Month navigation preserves the selected day-of-month when it exists
in the destination month and otherwise clamps it to the final valid day. The
resulting month and selected date update browser-addressable state.

Changing month or selected date updates both selected-day detail and the
effective Quick Entry Transaction Date. Calendar focus behavior is defined in
section 5.

## 5. Calendar interaction

### 5.1 Grid and selectable dates

The Calendar preserves a functional seven-day month structure. Only dates in
the selected month are selectable day cells. Leading and trailing positions are
inert placeholders. They do not display adjacent-month dates as apparently
empty Finance days and are not keyboard-selectable dates.

Every in-month date is selectable, including a date with no Finance
Transactions.

Calendar day state distinguishes:

- date;
- today;
- selected date;
- keyboard focus; and
- Finance activity.

These states must not rely on color alone.

### 5.2 Activity information

An active date communicates at least:

- total Finance Transaction count; and
- presence of relevant Transaction kinds.

A day containing only Internal Transfer or Balance Adjustment remains visibly
active even though Income and Expense totals are zero. A no-activity date has
no activity indicator but remains selectable for selected-day inspection and
Quick Entry.

Monetary information in Calendar cells is secondary:

- A one-currency day may show currency-labelled Income, Expense, or net where
  space permits.
- Multi-currency monetary detail appears only when every applicable currency
  group can be represented coherently.
- The Calendar never shows an unexplained partial subset of currencies or
  amounts.

Where detail must reduce, it degrades in this order when practical:

1. complete coherent monetary information;
2. involved currency codes, such as `CNY · USD`; and
3. a currency count, such as `2 currencies`.

At the 1024px real-shell width, date, selection, focus, activity, Transaction
count, and Transaction-kind presence take priority over cell-level Money.
Selected-day detail owns complete amounts and currencies.

### 5.3 Keyboard focus and selection

The Calendar has one keyboard entry point. Focus and selected date are distinct:

- Arrow keys move day focus within the displayed month.
- Home and End move within the current week.
- Enter or Space selects the focused date.
- Focus movement alone does not update selected-day detail, Quick Entry date,
  or browser-addressable selected-date state.
- Arrow keys do not silently cross a month boundary.

After explicit month navigation, focus returns to the preserved or clamped
selected date when focus remains in the Calendar workflow.

An accessible day name communicates the full date, today state, selected state,
activity count, and Transaction-kind presence where applicable.

## 6. Selected-day detail

Selected-day detail begins with the full selected calendar date and total
Finance Transaction count. Transactions appear in the backend's stable returned
order. The UI must not imply a time-of-day sequence or same-day economic
chronology.

Every Transaction item makes these common facts understandable without another
screen merely to decode it:

- textual Transaction kind;
- amount and currency meaning;
- relevant Account information; and
- note when present.

Kind-specific information is:

- **Income / Expense:** Economic Amount, Account, Category or explicit
  `Uncategorized`, and archived Account or Category status where applicable.
- **Internal Transfer:** source Account, destination Account, amount and
  currency, and optional note.
- **Balance Adjustment:** signed correction delta, Account, and optional note.
  It never presents target balance as persistent data.

Transaction kind and monetary direction cannot rely only on sign, color, or
iconography.

Each item provides direct paths to View details, Edit, and Delete without first
requiring an intermediate detail overlay. Existing contextual-action patterns
may be used. The interaction must avoid nested detail-to-edit-to-confirmation
overlay chains; destructive confirmation remains independently required.

If a day exceeds one backend page, selected-day detail provides explicit
incremental loading. It does not assume the full day is returned at once.

A no-Transaction selected date keeps the date visible, presents a clear empty
state, and offers `Record for this date`. That action does not change the date;
it moves focus to Quick Entry Amount.

Selected-day loading and errors remain isolated to this region. Calendar,
summaries, and Quick Entry remain available. Retry affects only the failed
selected-day request.

## 7. Keyboard-first Quick Entry

### 7.1 Availability and fields

Quick Entry is the primary everyday Expense and Income workflow. Expense is the
initial kind. It is unavailable when the selected Ledger has no active Account;
the unavailable state explains why and provides a path to create or unarchive
an Account.

The selected Calendar date supplies Transaction Date. Quick Entry displays that
effective date directly and programmatically associates it with the workflow.
It does not duplicate the date as an independently editable common-path field.

The semantic and keyboard order is:

1. Expense / Income kind choice.
2. Positive Amount.
3. Active Account.
4. Optional Category, including explicit `Uncategorized`.
5. Optional single-line note.
6. Submit.

Amount currency comes from the selected Account and is not a separate currency
choice. Category is optional; no Category or seeded default is required to
record Income or Expense.

Switching Expense/Income preserves Amount, Account, Category, and note. Category
remains economically neutral even if later visual design varies its suggestion
order by Transaction kind.

### 7.2 Focus and Enter behavior

Overview load does not autofocus Quick Entry. Deliberately entering the workflow
or activating `Record for this date` focuses Amount.

When an Account or Category picker is open, Enter selects its highlighted option
instead of submitting. Otherwise, Enter submits a valid Quick Entry without
pointer interaction. Pending submission prevents duplicates.

Client validation preserves the draft and focuses the first invalid field.
Backend validation or conflict preserves every entered value and the current
Ledger, month, and date context, and displays an actionable contextual error.

After successful submission, the frontend:

- keeps Ledger;
- keeps selected date;
- keeps Expense/Income kind;
- keeps Account;
- keeps Category;
- clears Amount;
- clears note;
- provides accessible success feedback;
- returns focus to Amount; and
- refreshes the affected financial position, month summary, Calendar activity,
  Account balances, and selected-day detail.

### 7.3 Draft transitions

While remaining in Overview, selected month/date navigation preserves the active
draft values and deliberately retargets the draft to the navigated selected
date. This applies to Calendar selection, explicit month navigation, and
same-session browser Back or Forward transitions that resolve to another
month/date within Overview. The effective Transaction Date updates immediately
and remains clearly visible. The frontend never submits automatically and does
not interrupt ordinary date changes with a confirmation dialog.

Browser history is not draft-version history. A Back or Forward transition does
not restore an older draft snapshot associated with the historical month/date
entry; it retargets the one currently active draft.

Switching Ledger clears the Ledger-scoped draft and never migrates or submits it.
Navigating away from Overview means leaving the Overview destination for another
Finance destination or subview, or otherwise leaving that workflow. It abandons
the temporary draft. Returning to Overview after abandonment does not restore
it. Drafts are not serialized into route state or persisted across route
changes, reloads, sessions, or later visits.

If a selected Account or Category becomes archived while a draft exists, the
frontend preserves and visibly marks the unavailable selection and prevents
submission. The user must select an active replacement Account. Category may be
replaced with an active Category or explicit `Uncategorized`. No resource is
silently cleared or substituted.

## 8. Transaction creation and secondary workflows

### 8.1 Entry points

Overview provides:

- inline Expense/Income Quick Entry; and
- one secondary transaction-actions entry point for Internal Transfer and
  Balance Adjustment.

Transactions provides one page-level `Record transaction` action for Expense,
Income, Internal Transfer, and Balance Adjustment. Expense and Income launched
there use a complete entry dialog rather than duplicating Overview's inline
composition. That dialog contains fixed Expense/Income kind context, positive
Amount, active Account, optional Category or `Uncategorized`, optional note, and
an explicitly editable Transaction Date initialized to the frontend's local
current calendar date. Amount currency comes from the selected Account.

Contextual Account shortcuts such as `Adjust balance`, `Transfer from this
Account`, or `Transfer to this Account` may be added when useful and may
preselect the relevant Account role. They are optional in v1 and must not expand
Accounts merely for shortcut completeness.

### 8.2 Internal Transfer

Internal Transfer uses one modal dialog with:

- active source Account;
- distinct active destination Account;
- positive amount;
- editable Transaction Date;
- optional note;
- contextual validation; and
- explicit submission.

Overview preloads the selected Calendar date. A surface without an active
Calendar selection initializes to the frontend's local current calendar date.

After source selection, destination choices contain only distinct active
Accounts using the same currency. If no compatible pair exists, the dialog
explains why Transfer cannot be completed and provides a path to Accounts where
appropriate. It does not create invalid choices.

Transfer amount currency comes from the selected source Account and is not an
independent currency choice.

Transfer has no Category, available-balance warning, or insufficient-funds
warning. It remains one atomic Finance Transaction, never two independent
entries.

### 8.3 Balance Adjustment

Balance Adjustment uses one modal workflow surface with progressive states:

1. Account and Transaction Date selection.
2. Context loading.
3. Derived comparison balance and Account Nature review.
4. Target actual balance and optional note.
5. Optional correction-delta preview.
6. Explicit submission.

Creating a new Balance Adjustment requires an active Account. Archived Accounts
do not appear as valid creation choices, and creation is unavailable when the
Ledger has no active Accounts.

When replacing an existing Balance Adjustment, its exact existing archived
Account may remain selected in the same role and is visibly identified as
archived. Changing the Account requires an active replacement; another archived
Account is not offered as a replacement choice. The workflow never silently
substitutes an Account.

Target balance is workflow input, never a second persistent Account balance.
Editing an existing Adjustment reuses this surface and its replacement context.
Overview initializes Transaction Date from the selected Calendar date. A
surface without an active Calendar selection initializes to the frontend's
local current date; the date remains editable. Target and comparison currency
come from the selected Account.

For a historical Transaction Date, target balance means the known actual
end-of-day Account Balance on that date. The displayed comparison includes
Opening Balance where applicable and Account Movements through that date, and
excludes later-dated movements. The workflow must not imply intra-day ordering.

For `account_balance_changed` or `finance_account_semantics_changed`, the same
surface:

- refreshes context;
- preserves target balance and note;
- identifies the changed comparison balance and/or Account Nature;
- invalidates any preview calculated from the old context;
- recomputes a preview only after fresh context is available; and
- requires a new explicit submission.

It never automatically resubmits or silently reuses the target against changed
semantics. The `created`, `updated`, `removed`, and `noChange` outcomes receive
distinct accessible feedback. The workflow is not a route wizard or dialog
chain.

## 9. Transaction detail, edit, and delete

### 9.1 Detail

Transaction detail is a browser-addressable subview within Transactions. It
shows the complete kind-specific public projection and direct Edit and Delete
actions.

View details from Overview or history preserves addressable originating context
so browser Back returns naturally to the originating Overview month/date or
applied history filters. A direct bookmark or pasted detail URL also provides a
stable path to that Ledger's Transactions destination; leaving detail must not
depend on an existing browser-history entry.

If the Transaction is unavailable, the subview shows `Transaction unavailable`,
does not substitute another Transaction, and provides the stable Transactions
path.

### 9.2 Edit

Income, Expense, and Internal Transfer edits use a modal dialog appropriate to
the immutable stored kind. Kind is fixed context and cannot be converted. The
form performs complete same-kind replacement and exposes the applicable
Account role or roles, amount, editable Transaction Date, optional Category for
Income/Expense, and optional note.

An existing archived Account or Category may remain selected in its existing
role and is visibly identified as archived. Alternative Account choices contain
active Accounts only. Alternative Category choices contain active Categories
and explicit `Uncategorized`.

Balance Adjustment editing uses the specialized context-aware workflow.

If Edit discovers that the Transaction no longer exists, it stops, exits the
obsolete mutation state safely, and reports the unavailable result. It never
recreates or substitutes a Transaction.

### 9.3 Delete

Deletion uses a separate accessible confirmation dialog. It communicates:

- Transaction Date;
- textual kind;
- amount and currency meaning;
- affected Account context;
- that deletion immediately changes derived balances and statistics; and
- that Finance v1 provides no undo or restore.

Initial focus is the non-destructive Cancel action. Delete is never placed inside
an already-open Edit dialog, and Edit never chains into Delete confirmation.

If Delete discovers that the Transaction no longer exists, it stops and reports
the unavailable result without recreating or substituting anything.

## 10. Transactions destination

### 10.1 Result hierarchy and ordering

History follows the backend's fixed newest-date-first ordering. Results may be
grouped or clearly associated by Transaction Date. The UI does not imply
time-of-day chronology, user-configurable ordering within a date, or sortable
headers.

Every result communicates:

- Transaction Date;
- textual Transaction kind;
- amount and currency meaning;
- Account or source-to-destination relationship;
- archived-reference status where applicable;
- Category or explicit `Uncategorized` for Income/Expense;
- note presence or a short excerpt where space permits; and
- View details, Edit, and Delete paths.

Balance Adjustment uses textual Adjustment semantics, signed correction delta,
and affected Account. It never implies a persistent target balance.

### 10.2 Filters

History provides:

- inclusive From date;
- inclusive To date;
- Account;
- Transaction kind; and
- Category / Uncategorized.

Account choices include active and archived Accounts with visible status.
Category uses one control containing active Categories, archived Categories with
visible status, and explicit `Uncategorized`. This prevents a simultaneous
Category identifier and Uncategorized filter by construction.

The Account filter means Transactions involving that Account, including either
side of an Internal Transfer. Category and `Uncategorized` apply to Income and
Expense; Transfer and Balance Adjustment are not classified as uncategorized.

Filter editing uses explicit Apply and Clear actions. Editing fields does not
replace results before Apply. Only applied filters become browser-addressable;
unsubmitted edits remain temporary local state.

Ledger switching preserves generic applied date, kind, and Uncategorized
filters and clears Account and Category identifiers.

Transactions does not expose generic search, note/full-text search,
user-configurable sorting, or an advanced query builder.

### 10.3 Pagination and navigation return

History uses explicit `Load more` cursor pagination. A successful request
appends results in fixed backend order, preserves loaded results, prevents
duplicate pending requests, and announces newly loaded results accessibly.

Changing applied filters or Ledger resets loaded pagination state. During the
same frontend session, returning from detail preserves the loaded result set and
scroll position where practical.

Cursor, number of loaded pages, and scroll position are temporary presentation
state, not browser-addressable Finance state. Reload reconstructs history from
the applied filters beginning with the first page. The UI does not invent page
numbers, total pages, or total result count.

## 11. Accounts destination

Accounts are organized first by lifecycle status:

- Active Accounts; and
- Archived Accounts.

Within each lifecycle section, Asset and Liability are clearly distinguished.
Currency is not the primary management grouping. Backend deterministic ordering
is retained where applicable; the frontend does not invent a ranking.

Every Account directly communicates name, present Current Balance, currency,
Nature, and lifecycle status. Name and Current Balance are primary. Opening
Balance and Tracking Start Date are secondary management details. Accounts does
not add charts, Account analytics, spending summaries, or cross-currency totals.

### 11.1 Create and ordinary edit

`Create account` opens one dialog containing name, Nature, currency, Opening
Balance, and Tracking Start Date. Zero Opening Balance in the selected currency
and the frontend's local current date may be prefilled, but both remain visible
and editable.

`Edit account` opens one ordinary-edit dialog for name, Opening Balance, and
Tracking Start Date. Current Nature and currency appear as read-only semantic
context. Current Balance is presented as derived and is not editable.

Validation and backend conflicts remain inside the active dialog and preserve
entered values. Ordinary Edit must not imply that Nature or currency is normally
mutable.

### 11.2 Correct nature or currency

`Correct nature or currency` is a separate secondary workflow, never nested
inside ordinary Edit. It explains that correction is allowed only while
Opening Balance is zero and no Finance Transaction history exists. The backend
remains authoritative.

On `finance_account_semantics_locked`, the workflow preserves attempted values,
explains that established financial position or history prevents
reinterpretation, and provides a safe return to Account management without
opening another dialog.

Currency correction is denomination correction for a zero-position,
history-free Account. It is never FX or conversion. It does not preserve a
non-zero nominal amount in a new currency or reinterpret history. For example,
zero CNY may become zero JPY.

### 11.3 Archive, unarchive, and history

Archive requires confirmation explaining that it:

- does not delete the Account;
- does not remove historical Transactions;
- does not remove the Account from current financial-position calculations;
  and
- excludes the Account from ordinary new Transaction references.

Archiving remains available when Current Balance is non-zero and does not show
an insufficient-funds or must-be-zero warning.

Unarchive is a direct contextual action with accessible success/error feedback
and no destructive confirmation.

`View transactions` navigates to Transactions with the Account filter applied
in browser-addressable state. Finance v1 has no Account-detail, Account-register,
or Account-analytics screen.

## 12. Categories destination

Categories are organized only by lifecycle:

- Active; and
- Archived.

They are not divided into Income and Expense. The UI does not imply permanent
kind ownership and does not introduce Category hierarchy, semantic icons,
colors, or taxonomy.

The zero-Category state explains that Categories are optional,
`Uncategorized` Income and Expense are valid, and Categories are an
organizational convenience rather than an onboarding requirement. The frontend
does not assume or implicitly create backend-seeded default Categories.

Within each lifecycle section, the backend's deterministic Category order is
retained rather than replaced by a frontend ranking.

Create and Rename use simple one-field dialogs. Conflicts preserve the entered
name, keep the dialog open, and explain the conflict.

Archive uses confirmation explaining that historical Category Allocations keep
the Category, it remains readable in history, and it disappears from ordinary
new-entry suggestions.

Unarchive is a direct contextual action. If its existing name conflicts, the
Categories context remains, the conflict is explained, and a separate Rename
path is offered. The UI does not silently rename or chain Unarchive to Rename
and back to Unarchive. The user explicitly retries Unarchive after resolving the
name.

`View transactions` applies the Category filter in browser-addressable
Transactions state. Finance v1 has no Category-detail or Category-analytics
screen.

## 13. Multi-currency presentation

Supported Finance v1 currencies are CNY, USD, and JPY. Currency identity is
always unambiguous.

A standalone monetary value includes its currency code, conceptually:

- `1,250.00 CNY`;
- `500.00 USD`; and
- `12,000 JPY`.

Symbols may supplement codes but never replace them as the only identity.
Within a region unambiguously labelled as one currency, repeated visible codes
may be omitted when group association remains clear and accessible naming still
contains the currency.

Formatting follows the backend-owned supported-currency catalog:

- CNY: two fractional digits;
- USD: two fractional digits; and
- JPY: zero fractional digits.

A one-currency Ledger uses one compact currency context rather than visually
heavy repeated group containers. A multi-currency Ledger shows separate,
equally legible groups. Overview currency groups use currency-code ascending
order: CNY, JPY, USD for the initial catalog. Current financial position and
selected-month activity use the same order.

Unlike currencies are never aligned, labelled, or presented as contributors to
one total. Finance has no hidden default currency, cross-currency total, or
currency carousel that hides current groups by default. At 1024px, groups wrap
or stack in full.

Account Current Balances retain signed account-relative backend semantics.
Liability balances are not visually negated to imitate another product's
convention. Monthly Income and Expense are non-negative; monthly net may be
negative, zero, or positive. Labels, Nature, and signs communicate meaning
without relying on color.

These currency rules apply to Overview, Accounts, Calendar monetary detail,
selected-day items, history, Transaction detail, create/edit workflows, and
destructive confirmations.

## 14. Loading, empty, error, conflict, and stale states

### 14.1 Loading boundaries

Finance uses independent loading boundaries:

- Initial Ledger-list loading never flashes first-Ledger onboarding or resolves
  remembered/deterministic Ledger fallback before the list is known.
- Initial Overview loading preserves the shell, Finance navigation, and resolved
  Ledger context while financial position, month summary, Calendar, and Account
  summary are pending.
- A month change immediately establishes the new month/date context and never
  labels old statistics or activity as the new month. Affected regions remain
  pending while month controls remain usable.
- Selected-day loading is isolated and does not disable Calendar selection or
  Quick Entry.
- Initial history loading preserves Ledger context and applied filters.
- `Load more` preserves existing results and marks only the appended request as
  pending.
- Accounts and Categories load inside their destinations.

Loading representations preserve layout. Exact skeleton, spinner, progress, and
transition styling remains open.

### 14.2 Empty states

Distinct empty conditions have distinct remedies:

- **No Ledgers:** inline first-Ledger onboarding.
- **No Accounts:** readable Overview, empty currency groups, unavailable
  Transaction creation, and direct Create Account path.
- **Only archived Accounts:** show balances and present position; all new
  Transaction creation is unavailable, including Income, Expense, Internal
  Transfer, and Balance Adjustment creation; offer Create Account and
  Accounts/Unarchive paths. Existing Transactions remain editable under their
  archived-reference retention rules, including replacement of an existing
  Balance Adjustment while retaining its own archived Account.
- **Accounts but no Transactions:** zero monthly values for represented
  currencies, no Calendar activity cues, selected-day empty state, and usable
  Quick Entry when an active Account exists.
- **Selected date empty:** keep the date and provide `Record for this date`.
- **No Categories:** Quick Entry remains usable with `Uncategorized`; Categories
  explains optional categorization.
- **No active Categories:** archived Categories remain manageable and ordinary
  new entry offers `Uncategorized`.
- **No history at all:** explain where recorded Finance activity appears and
  provide `Record transaction`.
- **No filter matches:** show `No matching transactions` and Clear filters, not
  first-use onboarding.

No state collapses into a generic `No data` message.

### 14.3 Error containment

Errors recover the smallest meaningful region:

- Initial Ledger-list failure preserves the Core Console shell and Finance
  product-area context, shows a safe Finance-level error with Retry, and does
  not show first-Ledger onboarding, select a remembered Ledger, select a
  deterministic first Ledger, or silently fall back. Only a successful
  Ledger-list response permits explicit valid selection or, when no Ledger is
  explicitly addressed, remembered valid selection, deterministic first-Ledger
  selection, and finally first-Ledger onboarding. An explicitly addressed
  invalid Ledger after successful resolution continues to use the
  Ledger-unavailable state.
- Overview failure retains Finance navigation, explicit Ledger, month/date
  context, safe feedback, and Retry. It never switches Ledger.
- Selected-day failure remains in selected-day detail with Retry.
- Initial history failure retains Ledger and applied filters.
- Pagination failure retains loaded results and retries only the failed page.
- Accounts/Categories list failure remains in its destination and must not show
  stale information as confirmed-current.
- Form or mutation failure remains in the active workflow and preserves values.
- Failed mutations are never announced as success.

Generic backend or database unavailability uses safe product language and never
exposes database detail, backend exceptions, stacks, or internal implementation
information.

### 14.4 Conflict and stale-resource behavior

Stale Balance Adjustment behavior follows section 8.3. Archived Account or
Category conflicts preserve the affected draft, identify the unavailable field,
and require explicit correction. Account semantics-lock conflict remains in the
correction workflow. Ledger and Category naming conflicts remain in their
create/rename workflow. Category unarchive conflict remains on Categories with
the separate Rename path.

If a Transaction disappears during detail, Edit, or Delete, the obsolete action
stops, reports the unavailable result, and never recreates or substitutes a
Transaction. If an explicitly addressed Ledger becomes unavailable, the
Ledger-unavailable state applies without fallback.

## 15. Responsive behavior

Exact breakpoints are visual-design decisions. The following representative
width behaviors are required.

### 15.1 Wide desktop

- Current financial position and selected-month groups may share horizontal
  space.
- Calendar remains the dominant exploration region.
- Quick Entry and selected-day detail may occupy an adjacent secondary region.
- Account summary follows the primary Calendar workspace.
- Transaction history may use a full table or comparably dense representation.

### 15.2 Typical approximately 1280px desktop

- Summary groups may share or wrap.
- The seven-day Calendar remains fully usable.
- Quick Entry and selected-day detail may share a following region or stack
  without changing semantics.
- Dense history may retain columns while note excerpts and secondary metadata
  wrap or reduce.

### 15.3 Supported minimum 1024px real-shell viewport

With the default expanded Core Console sidebar, Overview uses this vertical
semantic hierarchy:

1. Finance-local navigation and Ledger context.
2. Current financial position.
3. Selected-month Income, Expense, and net with month controls.
4. Full available-width seven-day Calendar.
5. Quick Entry.
6. Selected-day detail.
7. Account summary.

`Calendar → Quick Entry → selected-day detail` is deliberate: a long day list
must not push the primary entry workflow excessively far down the page.

At this width:

- Finance navigation and Ledger context may wrap into separate rows but never
  disappear.
- Currency groups stack or wrap in full.
- Quick Entry fields wrap or stack in their semantic keyboard order.
- History becomes structured multi-line items instead of a horizontally
  scrolling wide table.
- History always retains date, textual kind, amount/currency, required Account
  relationship, archived status, and actions.
- Income/Expense retains Category or `Uncategorized`, potentially on a secondary
  line.
- Transfer retains both source and destination.
- Adjustment retains textual semantics and signed correction delta.
- Note excerpts may be omitted because View details remains available.
- Filters may wrap, stack, or use one inline expandable region, while Ledger,
  Apply, Clear, active-filter state, keyboard access, and Load more remain
  reachable.
- Accounts and Categories reflow dense representations into structured
  multi-line items.
- Dialogs fit horizontally and may scroll vertically internally.

There is no page-level horizontal scrolling. The collapsed sidebar must also
remain functional, but its extra width is not a substitute for passing the
expanded-shell case. Responsiveness is not achieved merely by shrinking text,
controls, or Calendar cells.

Semantic DOM and focus order remain stable when regions are visually
repositioned.

## 16. Accessibility-relevant interaction requirements

The later design must preserve:

- one unique page heading;
- distinct global and Finance-local navigation labels;
- current-destination semantics at both navigation levels;
- visible keyboard focus for every interactive control;
- the Calendar focus-versus-selection model in section 5;
- logical DOM/focus order after reflow;
- persistent accessible labels rather than placeholder-only labels;
- programmatic association of Quick Entry date, currency, field errors, and
  archived-selection conflicts;
- accessible dialog names/descriptions, contained focus, Escape cancellation
  where allowed, and focus restoration to the invoker or a stable replacement;
- initial Cancel focus and explicit action in destructive confirmation;
- contextual action names identifying the affected Ledger, Account, Category,
  or Transaction;
- busy-state exposure without repeated focus stealing; and
- programmatically available validation, conflict, success, pagination, and
  stale-context feedback without disruptive focus changes, except focusing the
  first invalid field.

Transaction kind, monetary direction, lifecycle, archived status, selection,
and Calendar activity never rely only on color, sign, or icon. Accessible Money
names retain currency even when a repeated visible code is omitted inside a
clearly labelled currency group.

## 17. Visual implementation freedoms and limits

Within the authority of the Finance reference images and Core Console
`DESIGN.md`, implementation may refine:

- exact Finance-local navigation composition;
- grouping surfaces, including card-like versus flatter sections;
- typography hierarchy within the existing system;
- spacing and density;
- permitted dividers, elevation, and token use;
- exact wide-layout proportions;
- exact breakpoints between the representative width behaviors;
- Calendar cell composition and activity markers;
- table versus dense-list treatment where either meets the interaction rules;
- dialog dimensions and internal composition;
- icon choices;
- restrained motion; and
- visual emphasis of Money and primary actions.

These refinements remain subordinate to the existing global shell, product
identity, typography, navigation language, and neutral, restrained, data-dense
enterprise character. PrimeVue is a character reference only; implementation
must continue to use the existing React, shadcn, and design-token system and
must not add PrimeVue or another UI framework.

Implementation must not redefine Finance destinations, workflow boundaries,
field order, Calendar or selected-day behavior, browser-addressable state,
Ledger safety, currency semantics, responsive hierarchy, required states, or
accessibility interactions. The reference set is not authorization for another
product-design round.

## 18. Explicit Finance v1 frontend non-goals

Finance v1 does not add frontend workflows, navigation, placeholders, or
disabled future tabs for:

- Ledger archive or delete;
- Account or Category delete;
- budgets or budget limits;
- reports center, trends, charts, or advanced analytics;
- investments or portfolio tracking;
- recurring Transactions or scheduled execution;
- bank synchronization or import;
- FX conversion, reporting currency, or cross-currency totals;
- cross-currency Transfer;
- full split editing;
- dedicated AA/shared-expense orchestration;
- loan-management UI;
- Refund, reversal, void, reconciliation, undo, restore, or audit history;
- Transaction-kind conversion;
- same-day time ordering;
- generic or note/full-text search;
- configurable sorting or query builder;
- Category hierarchy, kind ownership, icons, colors, tags, or automation;
- tax functionality;
- merchant or Counterparty database;
- attachments, OCR, or AI categorization;
- notifications;
- Finance sharing, multi-owner Ledgers, or Finance RBAC;
- mobile-specific behavior below 1024px; or
- a replacement global shell or Finance-specific application shell.

The Finance backend implementation and backend-owned OpenAPI contract exist.
The frontend's synchronized `openapi/openapi.json` snapshot does not yet include
the Finance paths, so its checked-in generated artifacts do not yet expose the
Finance client surface. Finance integration must follow the established
backend-owned OpenAPI to synchronized frontend snapshot to generated artifacts
workflow. This specification does not authorize a handwritten Finance API
client, invented request/response types, generated placeholders, or production
mocks.

# Architecture Decisions

**Status**: Discovery phase documentation only. TypeScript + Bun is owner-selected. No implementation is authorized until Sudhanshu reviews and confirms the remaining prerequisites.

## Status Definitions

- **SETTLED**: Already chosen by Sudhanshu or documented in existing discovery docs (see [decisions.md](decisions.md)).
- **RECOMMENDED**: Chosen as a working default for the future architecture, but Sudhanshu may override before implementation begins. A RECOMMENDED library is not approved for use.
- **OPEN RESEARCH**: External law, portal specification, or runtime fact that cannot be decided by preference; requires external verification before a gate can be satisfied.
- **DEFERRED**: Intentionally outside the current implementation boundary; preserved with extension seams for future work.

## Debate Disclosure

Sudhanshu requested multi-position debates to be conducted as part of architecture planning. However, this discovery session has only apprentice-tier workers available, while the required [Neta](https://neta.dev) decide playbook mandates architect-tier debaters for credible architecture decisions.

**Therefore**: No debate was performed for the remaining RECOMMENDED entries below. Each records the strongest viable alternative and reversal trigger so architect-tier debates can resume later if needed. TypeScript + Bun is owner-selected and is not part of a pending routine stack decision. Sudhanshu will have the final say on the remaining recommendations during review.

## Non-Negotiable Settled Constraints

These are confirmed by Sudhanshu or existing discovery docs and form the foundation for all RECOMMENDED entries below.

- **Product identity** ([decisions.md § Confirmed](decisions.md#confirmed)): Package/product/repository name is `agent-bahi`. The owner-selected runtime is TypeScript + Bun. ORM, CLI parser, validator, decimal math, database driver, migration, and build/package libraries remain unapproved candidates and are individually proof-gated. Gate0 must establish the authoritative latest stable Bun release and record its exact version, `bun --revision`, artifact checksums, and lockfile/CI/release pins; do not hard-code a guessed current version today. Gate0 is mandatory evidence before implementation, but requires explicit owner authorization and does not authorize Phase 1 or approve libraries.

- **Engine and skills separation** ([decisions.md § Confirmed](decisions.md#confirmed)): Deterministic accounting/compliance engine owns rules, calculations, permissions/gates, and invariants. Versioned skills orchestrate, gather evidence, propose actions, and verify work; they never embed accounting law.

- **Tenant independence** ([decisions.md § Confirmed](decisions.md#confirmed)): One legal entity equals one independent tenant. Sudhanshu has three legal entities (two private limited companies and one sole proprietorship); these are three separate tenants with no cross-tenant relationships or paired entries.

- **Multi-GSTIN within tenant** ([decisions.md § Confirmed](decisions.md#confirmed)): One tenant may contain multiple GST registrations; GST work is GSTIN-scoped. See [gst-compliance-matrix.md § Minimum Model Requirements](gst-compliance-matrix.md#minimum-model-requirements).

- **Tenant selection policy** ([decisions.md § Confirmed](decisions.md#confirmed)): If exactly one active tenant exists, commands work without a `--tenant` flag. When more than one active tenant exists, they require an explicit `--tenant` flag or explicit named session context. Inactive tenants do not create ambiguity. This is not negotiable.

- **Canonical ledger, report views** ([decisions.md § Confirmed](decisions.md#confirmed)): Invoices, bills, payments, and ledger postings are stored once. Cash-basis and accrual-basis reporting are views over the same canonical data; posting is never duplicated.

- **Double-entry, immutable correction lineage** ([decisions.md § Confirmed](decisions.md#confirmed)): Posted changes use reversal + replacement; the original, reversal, replacement, and reason remain immutably linked.

- **Inventory deferred** ([decisions.md § Confirmed](decisions.md#confirmed)): No inventory accounting in v1; document lines may carry item, description, quantity, unit, rate, tax treatment, and account references, but never stock, warehouse, valuation, COGS, batches, serials, or manufacturing behavior.

- **Reporting allocations explicit** ([decisions.md § Confirmed](decisions.md#confirmed)): Tenants may define optional reporting dimensions (tags). When one amount is allocated across tags, it must use explicit split source lines (e.g., ₹60,000 Project A + ₹40,000 Project B), with one unambiguous tag per split and totals reconciling to the source.

- **Bank matches as evidence** ([decisions.md § Confirmed](decisions.md#confirmed)): Agent/skill-proposed bank matches remain non-posting suggestions. They become facts only after a recorded human confirmation is cryptographically or deterministically bound to the exact plan ID/digest, bank source line, target document/payment, amount, currency and FX snapshot, expected versions, tenant, actor, and timestamp; missing, stale, or mismatched confirmation returns `RECONCILIATION_CONFIRMATION_REQUIRED`, `STALE_RECONCILIATION_PLAN`, or `RECONCILIATION_PLAN_MISMATCH` and fails closed. The engine contains no hidden AI matching decision.

- **Payroll boundary** ([decisions.md § Confirmed](decisions.md#confirmed)): Attendance/leave/HRMS and employee portal are out. Payroll consumes approved pay inputs, generates payslips, bank CSV, and statutory outputs.

- **GSTR-1 boundary** ([decisions.md § Confirmed](decisions.md#confirmed)): GSTR-1 produces GST Portal-compatible JSON and human-readable reconciliation; the user or CA uploads and files on the portal; agent-bahi records evidence and ARN. This is not a global rule for GSTR-3B, e-invoice, e-way bill, or other filings.

- **Zoho import final** ([decisions.md § Confirmed](decisions.md#confirmed)): Zoho Books is the validated migration source but remains the final phase and must not drive the canonical model.

- **RBAC deferred** ([decisions.md § Current implementation context](decisions.md#current-implementation-context)): RBAC remains unimplemented in v1, but every mutation accepts actor and source context; application services contain authorization hooks for future implementation.

## RECOMMENDED Decisions

Each RECOMMENDED entry includes an ID, recommendation, strongest viable alternative, rationale, silent failure prevented, and reversal trigger. These are working defaults for the architecture and subject to Sudhanshu's review and override.

### Architecture / Core

**ARC-001: Modular monolith with ports/adapters pattern**

- **Recommendation**: One in-process TypeScript application core with CLI as the primary adapter. No microservices, daemon, or web server in v1. Application services and ports remain reusable by a future API layer.
- **Alternative**: Immediate web API as the primary interface with CLI as a thin wrapper.
- **Rationale**: CLI-first keeps the initial surface deterministic, fully testable locally, and aligned with agent orchestration patterns. API can be added later when web clients exist; reusable application services make this non-breaking.
- **Silent failure prevented**: Distributed failures, API auth/timeout/retries masking accounting errors, or unclear determinism boundaries.
- **Reversal trigger**: Once a web API client exists and needs real-time integration, consider promoting API to a co-primary adapter; the decision point is when external systems require live push/pull rather than CLI command orchestration.

**ARC-002: Persistence topology with tenant-scoped data isolation**

- **Recommendation**: One configured database may contain multiple independent tenants. Every business aggregate and unique constraint is tenant-scoped. Every repository operation requires `TenantContext`. Only tenant listing/creation may run outside one tenant. Optional database-per-tenant deployment may be added later without changing application code.
- **Alternative**: Database-per-tenant from the start; single logical database with tenant-row-filtering.
- **Rationale**: Tenant-scoped aggregates force explicit context threading; tenant listing and admin operations remain testable and simple. Database-per-tenant is a deployment option, not a code-level choice. Never allow cross-tenant queries in product workflows.
- **Silent failure prevented**: Accidental cross-tenant leaks, missing tenant checks, queries that invisibly return wrong tenant's data.
- **Reversal trigger**: After initial implementation, if database-per-tenant deployment is chosen, verify that zero code paths bypass the `TenantContext` requirement.

**ARC-003: Relational current state with immutable accounting journal**

- **Recommendation**: Relational current-state tables (accounts, entities, postings) plus immutable accounting journal, audit log, and domain-event/outbox records. Do not use full event sourcing. Balances are derived from postings; read models/caches are non-authoritative and rebuildable.
- **Alternative**: Full event-sourcing; immutable ledger only with no current-state tables.
- **Rationale**: Current-state tables allow direct queries for reports and reconciliation. Balances derived from postings remain auditable. The journal is the audit trail. Event sourcing adds replay/projection complexity not needed for a deterministic system; start with immutable postings and event records instead.
- **Silent failure prevented**: Expensive balance recalculation on every report, unclear lineage between current state and journal, projection inconsistency.
- **Reversal trigger**: If long-running reconciliations or large historical queries become a bottleneck, consider materialized views/snapshots; this is an optimization, not a change to the model.

**ARC-004: Draft editable, finalization creates atomic canonical entries**

- **Recommendation**: Draft documents are editable and never post ledger entries. Finalization atomically creates canonical ledger entries and audit records. Posted documents are immutable except through reversal/replacement lineage.
- **Alternative**: All documents (draft and posted) immutable from creation; post edits create new versions.
- **Rationale**: Users need to compose drafts without ledger noise. Atomic finalization prevents partial posts. Reversal + replacement preserves history without mutable overwrites.
- **Silent failure prevented**: Silent partial posts, audit trail gaps between draft edits and posting, unclear which document version was the actual ledger source.
- **Reversal trigger**: If user workflows require checkpoint-style intermediate posts (e.g., approval gates that post intermediate values), model those as explicit document state transitions, not mutations of finalized posts.

**ARC-005: Command envelope with metadata**

- **Recommendation**: Every mutation has a command envelope: request/idempotency ID, tenant, actor or scheduler, source, reason (where required), expected version, timestamp, and schema version. CLI may generate a request ID if the caller omits it and must return it in output.
- **Alternative**: Implicit context from session state; optional request ID.
- **Rationale**: Explicit envelopes enable safe retries, audit trails, and future multi-source integration. Deterministic request ID generation keeps CLI single-user workflows idempotent.
- **Silent failure prevented**: Silent replay/duplication, unclear audit source, impossible to retry safely.
- **Reversal trigger**: If external systems/APIs become primary sources (not just CLI), may need request ID validation against external systems; the envelope structure supports this.

<a id="arc-006-optimistic-concurrency-with-explicit-locks-for-high-consequence-mutations"></a>
**ARC-006: Optimistic concurrency with explicit locks for high-consequence mutations**

- **Recommendation**: Use optimistic concurrency (version checks) generally. Serialize (exclusive locks) on posting-number allocation, document finalization, period locks/unlocks, payroll finalization, reconciliation decisions, and filing snapshots. Period locks reject all ledger/settlement mutations: create/edit/delete/issue/post/void/reverse, payment creation/posting, allocation/deallocation/reallocation, bank reconciliation/unreconciliation, notes, refunds, write-offs, reclassification, depreciation, FX adjustments, disposal, tax/payroll journals, opening balances, and journal imports/posting; evidence-only attachments/imports are the sole exception. Conflicts fail visibly; never last-write-wins.
- **Alternative**: Pessimistic locking everywhere; or no locking (last-write-wins).
- **Rationale**: Optimistic concurrency scales for routine edits. Exclusive locks for high-consequence operations (posting, period close) prevent silent conflicts and make serialization explicit in the code.
- **Silent failure prevented**: Two agents finalizing the same document with different line items, two users closing a month and only one taking effect.
- **Reversal trigger**: If true concurrent user access (not just agent/scheduler) becomes common, measure lock contention; if high, consider domain partitioning (e.g., lock by document type or date range).

**ARC-007: Number sequences scoped and allocated at legal issue**

- **Recommendation**: Number sequences are scoped by tenant, applicable GSTIN, document family/series, and financial year. Allocate at legal issue/finalization (not at draft). Never reuse a voided/cancelled number. Preserve gaps with explicit reasons.
- **Alternative**: Global sequences; reuse cancelled numbers; allocate at creation.
- **Rationale**: Statutory compliance (esp. GST invoice numbering) requires continuity within a series/year/GSTIN. Gaps with reasons support audit. Allocation at finalization avoids unused draft numbers.
- **Silent failure prevented**: Numbering gaps that breach GST continuity rules, duplicate numbers across series, silent number reuse.
- **Reversal trigger**: If a filing requirement changes the sequence scope (e.g., per-month instead of per-year), update the allocation logic; the scoping framework supports this.

**ARC-008: Currency-aware integer minor units with exact decimal intermediates**

- **Recommendation**: Posted money uses currency-aware integer minor units (e.g., paise for INR). Rate/tax/FX intermediates use a domain wrapper around exact decimal arithmetic, never binary floating point. Preserve original currency, base-currency result, rate, source, timestamp, and rounding rule.
- **Alternative**: Binary floats throughout; or big decimal everywhere including postings.
- **Rationale**: Integer postings eliminate rounding ambiguity in balances. Decimal intermediates allow exact tax/rate calculations before rounding to posting units. Preserved metadata enables auditability and rule changes.
- **Silent failure prevented**: Rounding loss in balance checks, unclear which rate was used, unable to recalculate with a different rule.
- **Reversal trigger**: If non-INR multi-currency flows become complex, may need to revisit decimal precision; the metadata framework supports rate/source audit.

**ARC-009: Calendar dates, UTC timestamps, tenant timezone context**

- **Recommendation**: Accounting dates are calendar dates (no time component). Event timestamps are UTC. Each tenant has an IANA timezone and effective fiscal-year settings. Never derive document dates from server timezone.
- **Alternative**: All timestamps inclusive of time; server timezone as implicit context.
- **Rationale**: Accounting is date-based; time precision is unnecessary and creates ambiguity. UTC timestamps are unambiguous; tenant timezone is for display only. Fiscal-year settings are tenant configuration, not hardcoded.
- **Silent failure prevented**: Documents misdated due to timezone drift, end-of-day cutoff confusion, incorrect fiscal-year boundaries.
- **Reversal trigger**: If multi-timezone settlement reconciliation becomes complex (e.g., settlement at 23:59 in one timezone crosses into the next day in another), document the timezone-aware settlement rule explicitly.

**ARC-010: Content-addressed immutable evidence via storage port**

- **Recommendation**: Evidence (receipts, bank statements, e-invoice responses, etc.) uses content-addressed immutable blobs through a storage port. Default is local filesystem beside the app data directory; metadata, hash, and lineage stored in SQL. Remote object storage (S3, etc.) adapter is a future option. No mutable overwrite.
- **Alternative**: Database BLOBs; mutable file storage; no version/hash tracking.
- **Rationale**: Immutable content-addressed storage prevents accidental evidence mutation. Local filesystem is simple for single-tenant deployments. Port abstraction allows cloud storage later without application rewrites.
- **Silent failure prevented**: Evidence mutation without audit record, loss of audit trail on evidence rename/delete, unclear which version of evidence was used for a decision.
- **Reversal trigger**: If compliance audits demand remote evidence archival, the storage port can be swapped for a cloud adapter without application code changes.

**ARC-011: Backup/restore with verification gates**

- **Recommendation**: Backup covers database plus evidence manifest and rule/skill versions. Restore occurs in isolation first; verify tenant isolation, debit=credit balance, row counts, hashes, and migration version before activation. Never restore over production without isolation verification.
- **Alternative**: Backup application data only; restore directly; assume integrity.
- **Rationale**: Tenant isolation and balance integrity are non-negotiable. Restoring in isolation lets you catch corruption before it spreads. Hashes and migration version ensure you restore compatible data.
- **Silent failure prevented**: Cross-tenant leaks from a corrupted backup, balance errors after restore, silent schema drift.
- **Reversal trigger**: If restore time becomes a critical path issue, consider incremental backups or differential snapshots; verify integrity remains a gate.

**ARC-012: Fixed assets as separate module**

- **Recommendation**: Fixed assets are a separate module (future Phase) with asset lifecycle, configurable book/tax depreciation schedules, depreciation runs, and traceable journals. The separate schedule model and SLM as default book method are **T-003 OWNER-APPROVED**; exact statutory methods and tax rule-pack contents remain **OPEN RESEARCH**.
- **Alternative**: Defer fixed assets entirely; model as expense only.
- **Rationale**: India compliance requires asset register and depreciation. Separate module prevents ledger coupling. Statutory method research is genuinely external; do not guess.
- **Silent failure prevented**: Incomplete asset tracking, depreciation method audit failures, inability to support book vs. tax schedules.
- **Reversal trigger**: Research and settle exact methods before Phase implementation; the module boundary is stable regardless of method choice.

**ARC-013: Inventory deferred with extension seams**

- **Recommendation**: Inventory remains a future module; v1 catalog/lines carry stable item, description, quantity, unit, rate, tax, and account references but never stock, warehouse, valuation, COGS, batches, serials, or manufacturing. Future inventory should use stable item/line references and modular extension boundaries, not speculative placeholder tables now.
- **Alternative**: Placeholder inventory tables now; invoice lines embed stock movement logic; COGS auto-posted.
- **Rationale**: Placeholder tables couple invoicing to inventory prematurely and add unresolved complexity. Stable item/line references enable clean inventory integration later without ledger migration.
- **Silent failure prevented**: Unnecessary COGS complexity in drafts, mixed invoicing/inventory concerns, difficult-to-reverse inventory decisions.
- **Reversal trigger**: When a real inventory requirement arrives (tracking, valuation, COGS), use the item/line references as seams; implement inventory as a peer module, not embedded in documents.

**ARC-014: External network calls outside transaction scope**

- **Recommendation**: External network calls (bank APIs, IRPs, government portals) never occur inside the accounting database transaction. Use durable request/response evidence and idempotent outbox/saga-style state transitions. An external success is not a ledger fact until explicitly recorded.
- **Alternative**: Inline external calls inside transactions; treat external success as immediate ledger fact.
- **Rationale**: Network failures are independent of database failures. Durable evidence and idempotent retries prevent lost requests or duplicate postings. Explicit recording ensures the ledger reflects what actually persisted.
- **Silent failure prevented**: Network timeout leaving a partial ledger post, silent duplicate posts on external retry, unclear which external response was used.
- **Reversal trigger**: If synchronous external APIs become required (not just batch/async), use saga-style compensations; the outbox/evidence pattern scales to this.

### CLI / Agents

**CLI-001: Product binary and command registry**

- **Recommendation**: The product binary/package name is `agent-bahi`. Use noun/verb command groups (e.g., `agent-bahi invoice create`, `agent-bahi gst compute`), backed by a domain-owned command registry that generates parser bindings, human help, JSON schemas, and skill references. Do not make the CLI library (e.g., Clipanion) the source of truth for commands; keep commands declarative.
- **Alternative**: CLI framework as source of truth; flat command list.
- **Rationale**: Command registry separates intent from presentation. Schemas enable JSON output, external tooling, and skill integration. Noun/verb grouping scales to many operations.
- **Silent failure prevented**: Inconsistent command names, skills unable to find/invoke commands, no stable schema for external tools.
- **Reversal trigger**: If a web API becomes primary, the same command registry can generate OpenAPI schemas alongside CLI bindings.

**CLI-002: Tenant and GSTIN selection with explicit ambiguity resolution**

- **Recommendation**: Auto-select tenant only when exactly one active tenant exists; when more than one active tenant exists, require `--tenant` or an explicit named session context. Inactive tenants do not create ambiguity. Echo the effective tenant in output. For GST-scoped commands, auto-select when exactly one active, applicable GSTIN exists for that tenant; when more than one active, applicable GSTIN exists, require `--gstin` or explicit named session context. Echo the effective GSTIN in output. Never remember an ambiguous last choice silently.
- **Alternative**: Implicit session state; remember last choice; optional flags.
- **Rationale**: Explicit selection prevents silent cross-tenant mistakes. Echo in output confirms intent. Auto-select one is safe because it's unambiguous.
- **Silent failure prevented**: Silent post-to-wrong-tenant, user unaware which tenant/GSTIN was used, unsafe replay of commands across tenants.
- **Reversal trigger**: If a persistent session/profile system exists, explicitly tie session to tenant; do not allow session/tenant mismatch.

**CLI-003: Human and JSON output modes**

- **Recommendation**: Human output is default for an interactive terminal; explicit JSON mode (e.g., `--json`) returns a stable versioned envelope. Stdout contains only the result; stderr contains progress/warnings. Return effective tenant, GSTIN (when applicable), basis, period/date range, request ID, rule versions, warnings/exceptions, and evidence references.
- **Alternative**: Single output format; human and structured output in stdout mixed.
- **Rationale**: Human output is readable; JSON is stable for agents/tools. Separation of stderr/stdout allows scripting. Returned metadata enables traceability and future replay.
- **Silent failure prevented**: Parsing machine output that changes with cosmetic tweaks, unclear which rule version was used, lost request ID on retry.
- **Reversal trigger**: If a web API becomes primary, use the same versioned JSON envelope as the API response body.

<a id="cli-004-explicit-exit-code-taxonomy"></a>
**CLI-004: Explicit exit-code taxonomy**

- **Recommendation**: Publish a stable exit-code taxonomy: 0 (success), 1 (validation error), 2 (ambiguity/selection required), 3 (conflict/lock), 4 (compliance gate), 5 (external retryable), 6 (external terminal), 7 (permission denied), 8 (internal error). Never exit zero for partial or failed work.
- **Alternative**: Generic exit codes; success/failure only.
- **Rationale**: Structured exit codes let external orchestration (scripts, agents, CI) decide recovery/retry strategy without parsing output.
- **Silent failure prevented**: Silent partial success treated as full success, agent unable to distinguish recoverable vs. terminal failures, unclear whether to retry.
- **Reversal trigger**: If status/state polling becomes common (not just exit codes), add an explicit `--wait-state` option that blocks until a final state is reached.

**CLI-005: High-consequence flows use prepare/commit pattern with hashing**

- **Recommendation**: High-consequence flows (period close, payroll finalization, filing snapshot, bank reconciliation) use prepare/preview -> validate -> commit with a content hash/plan ID. Low-risk drafts (invoice create, memo entry) may commit directly under policy. `--dry-run` is side-effect free. Skills cannot skip a required gate.
- **Alternative**: All operations direct/atomic; skills can opt-out of gates.
- **Rationale**: Hash-based plan IDs enable safe two-phase commits and audit trails. Dry-run lets users preview before committing. High-consequence gates prevent silent cascading errors.
- **Silent failure prevented**: Silent partial period close, payroll run unnoticed to affect 100 employees, skill bypassing approval gate.
- **Reversal trigger**: If approval workflows become complex (multi-level, timed), model approvals as explicit document state transitions, not cli flags.

<a id="cli-006-batch-atomicity-declared-per-operation"></a>
**CLI-006: Batch atomicity declared per operation**

- **Recommendation**: Batch commands declare atomicity. Source ingestion is atomic per file/snapshot. Accounting proposals return per-item outcomes and commit only explicitly selected items. Never hide partial success or silently apply a majority rule.
- **Alternative**: Batch operations all-or-nothing; or silent best-effort.
- **Rationale**: Per-item outcomes let users understand what succeeded/failed. Atomic per-file prevents corrupted partial imports. Explicit commit prevents silent application.
- **Silent failure prevented**: 900 of 1000 transactions imported without user knowledge, batch failure silent/partial.
- **Reversal trigger**: If rollback-on-first-failure becomes a policy, make it explicit per batch operation, not inferred.

**CLI-007: Deterministic listing and cursor pagination**

- **Recommendation**: List/report output has deterministic ordering (e.g., by ID, date, then name) and cursor-based pagination. Never use offset-only pagination for agent workflows; offsets drift when data is added/removed.
- **Alternative**: Offset pagination; last-one-wins ordering.
- **Rationale**: Cursor pagination is stable across concurrent additions. Deterministic ordering prevents missed/duplicate rows. Agents can safely paginate.
- **Silent failure prevented**: Agent skipping rows or double-processing on pagination, offset-based list returning gaps as new data is added.
- **Reversal trigger**: If result sets become extremely large (millions of rows), consider streaming/subscription endpoints alongside pagination; the underlying order remains deterministic.

**CLI-008: Deterministic tenant company-health status snapshot**

- **Recommendation**: The owner-approved global contract is canonical in [CLI-008](accounting-contracts.md#cli-008): `agent-bahi status` is a top-level, tenant-scoped, read-only command producing one immutable snapshot of company health. One active tenant works without `--tenant`; multiple tenants require explicit selection. Snapshot includes ID, as-of timestamp, schema version, rule-pack versions, content hash, and immutable source/evidence references. Human and `--json` render from the same snapshot with identical facts, amounts, dates, and drill-down commands (never shell strings or secrets). Required sections: command/operation failures, blocks and partial completions, unreconciled bank lines, overdue customer invoices, unpaid vendor bills, missing evidence and pending approvals, compliance obligations with due dates and earliest deadlines, other material exceptions. Each section shows counts, material amounts in currency, urgency/severity, earliest due date, argv-array drill-down command, known `health`, and an `outcome` of `COMPLETE`, `PARTIAL`, `FAILED`, `DATA_UNAVAILABLE`, or `APPLICABILITY_UNKNOWN`; each section, item, and summary card carries source/evidence IDs plus immutable hashes or equivalent refs. Urgency is deterministic: statutory due dates and block state first, then tenant-configured materiality rules. Known business `health` is `HEALTHY`, `ACTION_REQUIRED`, or `BLOCKED`; `completeness` is `COMPLETE`, `PARTIAL`, or `FAILED`. Partial/failed snapshots never report `HEALTHY` conclusively and surface `UNKNOWN`/`INCOMPLETE` facts. A fully computed unhealthy snapshot exits 0; partial/failed acquisition returns a distinct nonzero shell result, with its numeric value internal/TBD until implemented and visible to the shell once implemented. No mutations, reconciliation triggers, approval, filing, or posting. This owner approval does not authorize implementation, Gate0/phase work, or PT-014 behavior.
- **Alternative**: Embedded health check in application startup or periodic background task; no explicit read-only command.
- **Rationale**: Owner-approved contract enables agent-friendly deterministic health queries without hidden side effects. Immutable snapshots prevent query-time divergence; identical drill-downs enable navigation. Partial snapshots reveal incomplete data rather than silently inferring healthy.
- **Silent failure prevented**: Query-time mutation triggered by health check, health state inferred from missing data, drill-down command containing secrets or shell code, divergence between human and JSON representations.
- **Reversal trigger**: Health query becomes frequently called and performance-critical; consider materialized view or separate health-update job, with snapshot freshness as a configurable parameter.

### Skills

**SKL-001: Versioned skill manifests with settled rules**

- **Recommendation**: Every skill has a versioned manifest: purpose, compatible engine/rule versions, required commands, inputs, evidence, deterministic gates, permitted external calls, approval policy, exception routes, verification, and outputs. Accounting/compliance law never lives only in prompts; law is in the rules engine or declared rules packages.
- **Alternative**: Skills as free-form prompts; law embedded in prompts.
- **Rationale**: Manifests make skills auditable, reviewable, and reproducible. Versioning enables safe upgrades. Laws in the engine are immutable/versioned; laws in prompts are fragile.
- **Silent failure prevented**: Skill silently changing calculation method on prompt tweaks, untraced law version, impossible to dispute a skill decision.
- **Reversal trigger**: If skills become very simple (just evidence gathering, no calculation), manifest can be lightweight; the versioning structure remains.

**SKL-002: Allowlist-based skill loading**

- **Recommendation**: Load skills/adapters only from an explicit allowlist/configuration with hashes and provenance. Do not auto-execute arbitrary discovered code from the filesystem or external sources.
- **Alternative**: Auto-load skills from a directory; trust filesystem.
- **Rationale**: Explicit allowlist prevents accidental execution of untrusted or incorrect skill versions. Hashes detect tampering. Provenance enables audit.
- **Silent failure prevented**: Accidental loading of outdated/malicious skill, no audit trail of which skill version ran.
- **Reversal trigger**: If a plugin trust/signing governance model is needed (e.g., signed skill packages), build on top of the allowlist (verify signature before adding to allowlist).

**SKL-003: Agent confidence is not authorization**

- **Recommendation**: Skills propose explicit candidates/evidence; deterministic engine rules and a per-action automation policy decide whether work may auto-commit. Ambiguous/high-consequence actions stop for review. Confidence percentages do not bypass gates.
- **Alternative**: Confidence threshold above which skills auto-commit; implicit automation.
- **Rationale**: Deterministic engine rules are auditable; heuristic confidence is not. Explicit automation policy separates decision logic from agent guessing.
- **Silent failure prevented**: Silent auto-commit of a wrong match because confidence was high, ambiguous reconciliation applied without review.
- **Reversal trigger**: If multiple competing candidates exist (e.g., bank match candidates), return ranked candidates and let the user/automation policy choose.

**SKL-004: Standard exception classes with remediation context**

- **Recommendation**: Raise standard exception classes: validation/blocking, missing evidence, ambiguity/selection, review required, retryable external, terminal external, conflict/lock, permission, internal invariant. Preserve remediation data (e.g., candidates for selection, retry-after timestamp).
- **Alternative**: Free-form error messages; or silent failures.
- **Rationale**: Structured exceptions enable consistent handling. Remediation data guides next steps (e.g., "pick one of these candidates").
- **Silent failure prevented**: Skill failure unclear whether to retry, missing data to present user with next action, external system error treated as application error.
- **Reversal trigger**: If exception recovery becomes very complex (e.g., multi-step escalation), model recovery as an explicit workflow step, not exception handling.

**SKL-005: Resumable skill runs with durable checkpoints**

- **Recommendation**: Skill runs are resumable with durable checkpoints: command request IDs, inputs/evidence hashes, engine/rule/skill versions, outcomes, and explicit state (completed/exception/failed/cancelled). Do not lose resumption context on infrastructure restart.
- **Alternative**: Fire-and-forget skills; retries from the start.
- **Rationale**: Long-running skills (import, reconciliation, batch posting) must survive restarts. Hashes and versions ensure idempotent replay.
- **Silent failure prevented**: Long import killed mid-way, silent re-process of part of the batch on restart, unclear progress state.
- **Reversal trigger**: If skills become very fast (sub-second), resumption overhead may outweigh benefit; the framework still supports it, just may not be needed.

### Security / Secrets

**SEC-001: Secrets as external references**

- **Recommendation**: Secrets (API keys, DSCs, bank credentials, vault tokens) are references to environment variables, OS keychain, or external vault providers. Never persist secrets in accounting rows, logs, exports, skills, or audit bundles. Remote SQL/API transports require TLS; redact credentials from connection strings in logs.
- **Alternative**: Secrets embedded in environment files; or stored in config tables.
- **Rationale**: External secret stores are safer than application storage. References + redaction prevent leaks in logs/exports/audits.
- **Silent failure prevented**: Secrets in a database dump, credentials leaked in debug logs or audit exports, unclear secret rotation policy.
- **Reversal trigger**: If credential rotation becomes complex (e.g., per-tenant credentials), establish a rotation policy tied to secret store; the reference-based model supports this.

**SEC-002: Authorization hooks for future RBAC**

- **Recommendation**: RBAC remains unimplemented in v1. Every mutation accepts actor, source, and future permission context; application services contain authorization hooks (e.g., `checkPermission(actor, action)`). Do not bake single-user assumptions into domain entities.
- **Alternative**: Single-user design; no auth hooks.
- **Rationale**: Hooks are a no-op for single-user but enable RBAC/audit later. Baking single-user assumptions requires migration later.
- **Silent failure prevented**: Impossible to add RBAC without rewriting all command handlers, unclear audit trail of who changed what.
- **Reversal trigger**: When RBAC is implemented, fill in the hooks; the structure is already in place.

### Observability

**OBS-001: Redacted operational logs by default**

- **Recommendation**: Operational logs and metrics redact financial values, PII, bank data, tokens, and documents by default. The audit/evidence subsystem retains authorized detail separately. Include only request ID, actor, source, action, timestamp, and outcome in operational logs.
- **Alternative**: Full context in logs; or no redaction.
- **Rationale**: Operational logs are for troubleshooting; sensitive detail is in audit. Redaction prevents accidental log-based data leaks.
- **Silent failure prevented**: Bank account numbers in a log export, salary amounts visible in metrics dashboards, tokens in a debug trace.
- **Reversal trigger**: If forensic investigation requires sensitive detail, query the audit/evidence system separately with proper authorization, not operational logs.

### Compliance

**CMP-001: Versioned compliance rule packages**

- **Recommendation**: Compliance rules are versioned packages: immutable manifest (jurisdiction, applicability dates, official source/provenance, checksum/signature) plus declarative tables (rates, slabs, dates) and pure deterministic calculators. Prompts are never the rules engine. All golden tests must be public and reproducible.
- **Alternative**: Rules embedded in skill prompts; heuristic calculations.
- **Rationale**: Versioned, immutable rules are auditable. Declarative tables and calculators are testable. Prompts are fragile and non-reproducible.
- **Silent failure prevented**: Tax rule changed in a prompt tweak, calculation unauditable, golden tests secret/unreproducible.
- **Reversal trigger**: If a rule becomes too complex for a calculator (e.g., conditional multi-step rules), keep the high-level calculation as a function; preserve traceability to the rule source.

**CMP-002: Fail-closed on stale/missing rules**

- **Recommendation**: Fail closed when a stale, missing, or ambiguous rule affects statutory finalization (tax claims, payroll finalization, filing artifacts, e-invoice, e-way bill). Drafts and unrelated bookkeeping may continue with an explicit warning/exception. Never silently use the newest or previous rule.
- **Alternative**: Use newest rule automatically; or continue silently with a warning.
- **Rationale**: Statutory operations must be based on known-good rules. Explicit failure forces resolution; silent fallback risks legal non-compliance.
- **Silent failure prevented**: Filed return computed with a stale/wrong rule version, payroll run with unknown tax rule, e-invoice issued under unknown ITC/rate rules.
- **Reversal trigger**: If users need to override for testing/adjustment, model the override as an explicit command (e.g., `--use-legacy-rule`) with an audit note, not silent fallback.

**CMP-003: Obligation engine with effective-dated rules**

- **Recommendation**: An obligation engine derives tenant/GSTIN/employer obligations from effective registrations and facts, snapshots the selected rule version and due date, models predecessor gates (e.g., GSTR-1 before GSTR-3B), and records extensions as new sourced rule versions. Obligations are not derived from skill assumptions.
- **Alternative**: Skills infer obligations from context; no formal obligation model.
- **Rationale**: Formal obligations are auditable and contractible with filings. Effective-dated rules handle retroactive changes. Predecessor gates prevent filing out-of-order.
- **Silent failure prevented**: Obligation missed because skill didn't mention it, extension not properly versioned, GSTR-3B filed before GSTR-1 without detection.
- **Reversal trigger**: If multi-state or multi-jurisdiction complexity grows, the obligation engine can be extended with jurisdiction/state predicates; the structure scales.

**CMP-004: Filing snapshots as immutable evidenced records**

- **Recommendation**: Return/filing snapshots and lifecycle observations are immutable, evidence-backed, and distinct from ledger truth. Amendments link to originals; filed snapshots never mutate. A filing snapshot is not a ledger fact until explicitly posted.
- **Alternative**: Filed returns mutate on revision; or no distinction from ledger.
- **Rationale**: Audit trail must match what was filed, not what you'd file today. Amendments linked to originals preserve history. Distinct from ledger prevents filing-driven ledger rewrites.
- **Silent failure prevented**: Snapshot mutated after filing with no amendment record, unclear what was actually filed, filing snapshot leaking into ledger.
- **Reversal trigger**: If amendments become common, model amendments as explicit document types (return amendment, revision notice) with their own due dates/obligations.

**CMP-005: GSTR-3B default (manual portal)**

- **Recommendation**: GSTR-3B v1 default: Deterministic locked working paper/reconciliation from ledger, GSTR-1, and GSTR-2B; user/CA reviews and files manually via GST Portal; agent-bahi records evidence/ARN. Direct GSP submission and stable third-party artifacts remain **OPEN RESEARCH**. This is the default for GSTR-3B and does not apply to GSTR-1, e-invoice, e-way bill, or other filings (see their individual entries).
- **Alternative**: Direct GSP submission; automated portal filing.
- **Rationale**: Manual portal filing is lowest-risk; ARN is the canonical evidence. GSTR-1 is a prerequisite gate. GSP submission adds infrastructure/credential complexity not yet researched.
- **Silent failure prevented**: Filing submitted with wrong data because reconciliation was skipped, missing GSTR-1 filing detected too late, GSP transmission failure with no rollback.
- **Reversal trigger**: Once GSP integration/artifact format is researched and tested, the decision point is whether to add direct submission as an optional feature (not a requirement).

<a id="cmp-006-e-invoice-default-irp-via-configured-adapter"></a>
**CMP-006: E-invoice default (IRP via configured adapter)—RESEARCH-GATED and DEFERRED**

**Status**: TENTATIVE_AGENT_DEFAULT (with significant OPEN_RESEARCH component) — **NOT OWNER-APPROVED**

- **Recommendation**: When applicable (B2B, exports, stock transfers, etc.) and when applicability/transport/state research is complete and owner-approved, use a configured IRP adapter for direct submission with export/upload/import-response fallback. Do not issue/finalize the invoice until IRN and signed QR evidence are recorded. Transport retries are idempotent and cannot duplicate IRNs. E-invoice is not mandatory for all invoices; applicability rules remain **OPEN RESEARCH** until satisfactory closed.
- **Deferred Gate**: This adapter remains **RESEARCH-GATED and NOT V1-AUTHORIZED** until:
  1. E-invoice applicability (B2B thresholds, exports, stock transfers, state-specific exemptions) is verified from official GST Portal/GSTN sources.
  2. IRP credential provisioning, submission transport, and error-handling are researched and documented.
  3. Sudhanshu explicitly approves this adapter after research closure.
- **Until research completion**: Agent-bahi will not invoke e-invoice adapters. GSTR-1 B2B invoices are prepared and validated normally; users must handle e-invoice submission separately outside agent-bahi or wait for research completion and owner approval. See [T-005](tentative-decisions.md#t-005) for V1 scope and [architecture-decisions.md § Open Research](architecture-decisions.md#open-research--deferred-list) for pending e-invoice research.
- **Alternative**: Manual e-invoice generation and upload outside agent-bahi; or no e-invoice support until researched.
- **Rationale**: Direct IRP submission is automated if available after research confirms applicability; fallback is manual. Recorded evidence (IRN, QR) is the canonical proof. Idempotent retries prevent duplicates. Research closure and explicit owner approval are prerequisites; no tentative assumptions about IRP credentials or applicability may enter V1.
- **Silent failure prevented**: Invoice issued with unauthorized e-invoice when not applicable, duplicate IRN on retry, credentials exposed, or unapproved adapter invoked despite research gaps.
- **Reversal trigger**: After research closure and owner approval, if IRP credentials/onboarding proves complex, make credential provisioning an explicit setup step separate from invoice finalization.

<a id="cmp-007-e-way-bill-default-configured-api-with-state-specific-rules-open-research"></a>
**CMP-007: E-way bill default (configured API with state-specific rules)—RESEARCH-GATED and DEFERRED**

**Status**: TENTATIVE_AGENT_DEFAULT (with significant OPEN_RESEARCH component) — **NOT OWNER-APPROVED**

- **Recommendation**: After applicability/transport/state research is complete and owner-approved, use a configured API adapter for e-way bill with manual fallback. When effective-dated applicable rules determine that an e-way bill is required, block movement/dispatch until valid EWB evidence is recorded. Thresholds, exemptions, state-specific rules, and which movements/modes require EWB remain **OPEN RESEARCH** until satisfactory closed.
- **Deferred Gate**: This adapter remains **RESEARCH-GATED and NOT V1-AUTHORIZED** until:
  1. E-way bill applicability (inter-state vs. intra-state, value thresholds, exempt movements, state-specific exemptions) is verified from official GST Portal/state authority sources.
  2. State-specific rules and carrier/mode applicability are documented per origin state, destination state, and movement type.
  3. E-way-bill API credentials, submission transport, and error-handling are researched.
  4. Sudhanshu explicitly approves this adapter after research closure.
- **Until research completion**: Agent-bahi will not invoke e-way-bill adapters. Movements and dispatch are prepared normally; users must handle e-way-bill generation and submission separately outside agent-bahi or wait for research completion and owner approval. See [T-005](tentative-decisions.md#t-005) for V1 scope and [architecture-decisions.md § Open Research](architecture-decisions.md#open-research--deferred-list) for pending e-way-bill research.
- **Alternative**: No e-way bill support in V1; manual e-way-bill generation outside agent-bahi until researched.
- **Rationale**: API is the preferred path if implemented after research confirms applicability per state and movement type. Applicability, thresholds, exemptions, and state-specific rules are determined by effective-dated compliance rules and remain unresolved; research is required per state and applicability scenario. Research closure and explicit owner approval are prerequisites; no tentative assumptions about state rules or API credentials may enter V1.
- **Silent failure prevented**: Movement/dispatch blocked forever because state rule is unknown, EWB issued for exempt movement, or unapproved adapter invoked despite research gaps.
- **Reversal trigger**: Once state rules are researched and keyed (e.g., by origin state, destination state, value), implement as a compliance rule package with effective dates.

**CMP-008: CA handoff bundle per period**

- **Recommendation**: Generate one immutable CA handoff bundle per period/filing snapshot: manifest, hashes, JSON/CSV/PDF/Markdown working papers, reconciliations, exceptions, rule versions, evidence index, and portal acknowledgements/ARN. Credentials are never included; amendments create new linked bundles.
- **Alternative**: Ad-hoc export of files; or single consolidated file.
- **Rationale**: Manifest + hashes enable CA to verify integrity. Linked amendments preserve audit trail. No credentials prevents accidental exposure.
- **Silent failure prevented**: CA unsure which artifacts were authoritative, amendments losing link to original bundle, credentials leaked in export.
- **Reversal trigger**: If CA feedback requires iterative bundles (e.g., for draft review before filing), model each bundle as a versioned snapshot with the CA's sign-off recorded separately.

**CMP-009: Filing submission is opt-in per filing through approved adapter**

- **Recommendation**: Government transmission is opt-in per filing through an explicitly approved adapter. Absence of an approved adapter means prepare/validate/export/manual portal/record evidence; this does not generalize the GSTR-1 choice or claim all filings are manual forever. Each filing (GSTR-3B, TDS, income-tax, MCA, etc.) has its own decision recorded in discovery docs.
- **Alternative**: Global submission policy; or no submission option.
- **Rationale**: Filings vary by format, gateway, credentials, and risk. Each decision is distinct. GSTR-1 manual portal is not a template for all filings.
- **Silent failure prevented**: Filing submitted through wrong gateway because a global policy was assumed, unreviewed assumption about TDS portal that did not hold.
- **Reversal trigger**: As each filing decision is made, document it explicitly in discovery docs, cross-linked from this docket.

### Persistence / Technology Stack

**STK-001: Pinned Bun version**

- **Recommendation**: At authorized Gate0 execution time, resolve the authoritative latest stable Bun release from official Bun release metadata. Record its exact version, `bun --revision`, and official Bun artifact checksum(s). Pin that version and checksum in the lockfile, CI workflows, and release metadata; use Bun workspaces and the lockfile for dependency consistency. Reference: [https://bun.com/docs/pm/lockfile](https://bun.com/docs/pm/lockfile).
- **Alternative**: None within Gate0. No placeholder or rolling release selector is permitted. A different exact Bun release requires a new explicit owner decision.
- **Rationale**: Exact pin ensures reproducible builds. Workspaces enable monorepo patterns (e.g., shared domain package + CLI + skills).
- **Silent failure prevented**: CI using a different Bun version than developer laptops, breaking changes in a Bun minor version.
- **Reversal trigger**: Upgrade Bun intentionally and test; do not auto-upgrade.

**STK-002: ORM-free domain/application layers with proof-gated persistence candidates**

- **Recommendation**: Domain and application layers have no ORM imports. Prefer Bun-native database APIs first. Drizzle ([https://orm.drizzle.team](https://orm.drizzle.team)), Kysely ([https://kysely.dev](https://kysely.dev)), better-sqlite3, and other npm-compatible ORM/driver candidates may be evaluated only when needed, one candidate at a time, under the pinned Bun runtime. No candidate is approved until the all-dialect proof passes on bun-sqlite, PostgreSQL, and MySQL, including unit/integration behavior and migration handling.
- **Alternative**: Other ORMs (TypeORM, Prisma, Sequelize); hand-written SQL; another Bun-native adapter.
- **Rationale**: ORM-free domain/application enables future adapter swaps. Bun-native APIs minimize runtime and dependency risk; any package candidate must prove it executes correctly under pinned Bun without introducing a separate runtime.
- **Silent failure prevented**: Domain logic coupled to ORM, migration locking, dialect-specific bugs discovered mid-implementation.
- **Reversal trigger**: If a candidate fails any dialect, migration, target-platform, or Bun-runtime proof, stop that path and obtain a new owner decision before selecting another candidate.

**STK-003: SQLite with strict settings**

- **Recommendation**: SQLite uses `foreign_keys=ON`, WAL mode on local filesystems, one serialized writer, short transactions, explicit `BEGIN IMMEDIATE` where needed, bounded and visible SQLITE_BUSY handling, and no silent retry/reordering. Reference: [https://www.sqlite.org/wal.html](https://www.sqlite.org/wal.html).
- **Alternative**: Default SQLite settings; implicit retries.
- **Rationale**: `foreign_keys=ON` enforces referential integrity. WAL enables concurrent readers. Explicit `BEGIN IMMEDIATE` serializes high-consequence writes. Visible BUSY handling forces resolution, not silent hanging.
- **Silent failure prevented**: Orphaned foreign keys, silent writes dropped on BUSY, deadlock not surfaced to application.
- **Reversal trigger**: Settings remain stable; do not weaken BUSY handling or disable foreign keys.

**STK-004: Separate migration histories with shared logical checksums**

- **Recommendation**: Commit separate SQLite, PostgreSQL, and MySQL migration histories (e.g., `migrations/sqlite/`, `migrations/postgres/`, `migrations/mysql/`) with shared logical migration IDs and checksums. Never use production schema push/sync. Run fresh-install and every-supported-upgrade tests on all dialects before release. Migration libraries are unapproved candidates and must individually prove Bun execution, dialect behavior, and checksum/replay safety before use.
- **Alternative**: Single migration language; or schema auto-migration.
- **Rationale**: Dialect-specific migrations catch issues early. Shared checksums enable verification that all dialects apply equivalent changes. Testing all upgrades prevents production surprises.
- **Silent failure prevented**: SQLite migration succeeding but PostgreSQL failing undetected, auto-migration drifting schema from intent, upgrade path broken for existing data.
- **Reversal trigger**: After all dialects are validated, migration changes can be versioned/deployed with confidence.

**STK-005: Bun-native-first, individually proof-gated libraries**

- **Recommendation**: Prefer Bun-native APIs and `bun:test` first. If a third-party npm-compatible TypeScript package is needed, evaluate it individually through a proof spike and run it under the pinned Bun runtime. Clipanion (parser), Zod (validation), decimal.js (exact decimal), database drivers such as better-sqlite3, migration libraries, and build libraries remain candidates only; none is pre-approved. Keep every selected package behind a domain-owned contract where applicable.
- **Alternative**: Bun-native implementation; another package that passes the same proof; no package where the native API is sufficient.
- **Rationale**: Individual proof gates prevent an untested package from silently becoming part of the runtime or accounting path.
- **Silent failure prevented**: Tight coupling to a library version, breaking changes in library forcing full rewrite.
- **Reversal trigger**: If a package fails Bun execution, correctness, security, licensing, or target-platform proof, stop and require a new owner decision before adopting an alternative.

**STK-006: Bun-embedded single-file distribution**

- **Recommendation**: Release one Bun-embedded, platform-specific single-file executable for each supported target: macOS arm64, Linux x64, and Linux arm64. The released executable must not require or invoke a separately installed Node runtime, Node subprocess, Node lifecycle hook, separately installed Bun runtime, Bun subprocess, or Bun lifecycle hook; externally bundled npm-compatible packages may be included only after individual Bun proof. This does not prohibit proof-gated third-party packages bundled into the single executable, nor the packaged `agent-bahi` binary being invoked by skills. No source distribution or package/bin fallback is permitted. PostgreSQL and MySQL are supported product dialects: prove their required drivers, migrations, conformance, and target-platform behavior on each target. A user may optionally configure a remote database, but these release proofs are mandatory. Reference: [https://bun.com/docs/bundler/executables](https://bun.com/docs/bundler/executables).
- **Alternative**: None for released operation; a proof failure blocks release and requires a new owner decision.
- **Rationale**: A Bun-embedded executable makes the runtime boundary explicit and keeps the shipped operation identical across supported platforms.
- **Silent failure prevented**: A release silently depending on an unpinned runtime, Node/npm script, missing database driver, or platform-incompatible migration asset.
- **Reversal trigger**: A blocker in packaging or target-platform proof stops release and requires a new owner decision; it does not authorize a source/runtime or package/bin fallback.

### Quality / Testing

**QA-001: Dialect-agnostic invariant test suite**

- **Recommendation**: One repository/domain invariant suite runs against SQLite, PostgreSQL, and MySQL: debit=credit balance, idempotency (request ID retries produce same result), concurrency (simultaneous commands don't corrupt state), numbering continuity, locking correctness, decimal precision, migrations (fresh install + every upgrade path), deterministic JSON output, and tenant isolation. Failures on any dialect block release.
- **Alternative**: SQLite-only tests; dialect-specific test suites.
- **Rationale**: Invariants are dialect-agnostic; running the same suite validates all dialects. Shared test suite prevents dialect-specific bugs.
- **Silent failure prevented**: Bug in PostgreSQL version working in SQLite, tenant isolation failure on MySQL undetected, decimal rounding differences between dialects.
- **Reversal trigger**: Tests remain stable even if library/driver changes; test intent is immutable.

**QA-002: Layered testing strategy**

- **Recommendation**: Testing layers (in order of tightness to business logic):
  1. Pure domain/property tests (no I/O, tax rules, posting logic).
  2. Posting golden tests (canonical posting sequences with expected outcomes).
  3. Command contract snapshots (CLI input/output verification).
  4. Repository/dialect contracts (CRUD correctness on each dialect).
  5. Migration/restore tests (schema changes, data integrity on upgrade).
  6. Rule-pack official fixtures (compliance rules against known-good outputs).
  7. End-to-end workflow tests (full invoice-to-cash flows).
  8. External adapter contract/sandbox tests (bank API mocking, IRP sandbox, etc.).
  - Zoho import validation may use a backup fixture but must not be the core accounting oracle.
- **Alternative**: Single integration test; or only unit tests.
- **Rationale**: Layers catch bugs at the appropriate level. Pure tests run fastest; end-to-end tests catch integration issues. Fixtures are reproducible.
- **Silent failure prevented**: Bug in posting logic not caught by CLI tests, migration breaking existing data, skill using wrong rule version.
- **Reversal trigger**: Test layers remain even as features scale; add new tests at the right layer.

**QA-003: Versioned schemas and compatibility**

- **Recommendation**: Version JSON schemas, command definitions, rule packs, skills, and evidence bundle manifests independently with compatibility ranges. Deprecations warn for at least one documented compatibility window; removals are explicit breaking changes with a release note.
- **Alternative**: No versioning; or version everything as one.
- **Rationale**: Independent versioning enables safe updates. Compatibility ranges let users/skills adapt gradually. Documented deprecation prevents silent breaks.
- **Silent failure prevented**: Command removed without warning, skill failing because a schema field vanished, no way to know if a version is compatible.
- **Reversal trigger**: Once a version is released, compatibility windows are binding; they are not negotiable.

<a id="open-research--deferred-list"></a>
## Open Research / Deferred List

The following are external facts that cannot be decided by preference and must be researched with official/primary sources before being settled:

- **GSTR-9 exemption for FY 2025-26**: Confirm whether composition/small businesses are exempt from GSTR-9 in the 2025-26 financial year; official notification required.
- **Composition scheme (CMP-08, GSTR-4)**: Research composition taxpayer GST rules, GSTR-4 filing, and interaction with GSTR-1/GSTR-2B and deemed ITC.
- **Stable official GSTR-3B artifact**: Confirm whether a stable/machine-readable GSTR-3B export (analogous to GSTR-1 JSON) exists on GST Portal or via GSP; if not, manual portal filing remains the standard.
- **E-invoice applicability and exemptions**: Confirm exact applicability (B2B thresholds, exports, stock transfers, etc.) and state-specific exemptions for the current financial year.
- **E-way bill state-specific rules**: Research applicability (inter-state, intra-state exemptions), value thresholds, and carrier/mode rules per state.
- **Bank CSV preset formats**: Document actual bank export formats (NEFT, RTGS, IMPS batch formats) from major banks; validate via test files.
- **TDS/TCS rules and forms**: Confirm current TDS rates, applicable sections, statutory receipts, quarterly statements, and Form 26QB/26QC formats; use official IT/CBDT sources only.
- **Income-tax statutory forms and thresholds**: Confirm current Form 130, Form 138, ITR schema, and AMT/dividend/foreign-income thresholds; use official sources or documented legal references.
- **PT/LWF/ESI thresholds and rates**: Research current professional tax, leave-and-welfare fund, and ESI contribution thresholds and rates per state/year.
- **Payroll statutory forms**: Confirm current Form 16, quarterly TDS statements, PF challan formats, and ESI/PT remittance formats per state.
- **Fixed-asset depreciation methods**: Research book and tax depreciation methods under Companies Act (SLM, WDV, block assets) and Income-tax Act; confirm current rules and any recent amendments.
- **Exchange-rate provider selection**: Define which rate source (RBI, IEXAPIS, bank rates, spot market) is authoritative for each currency pair and effective date; no automatic provider.
- **Evidence retention periods**: Research statutory evidence retention (invoices, bills, bank statements, payroll, GST, tax) per authority (GST, Income-tax, ROC, etc.); India-specific rules.
- **IRP/E-way bill credential provisioning and cancellation**: Confirm credential/onboarding process for IRPs (e-invoice issuers) and e-way bill APIs; cancellation/revocation process.
- **Dynamic plugin trust/signing governance**: Design and research plugin/skill signing and trust model if external skills/adapters become a feature.
- **Inventory accounting**: Module design including stock movements, warehouse management, valuation methods (FIFO, LIFO, WAV), COGS automation, and batch/serial tracking; deferred until a real requirement arrives.
- **Zoho Books import**: Full import design including data model mapping, duplicate handling, referential integrity, and post-import reconciliation; deferred to final phase.

## Official Technology Links

- Bun runtime: [https://bun.com/docs/runtime](https://bun.com/docs/runtime)
- Bun workspaces: [https://bun.com/docs/pm/workspaces](https://bun.com/docs/pm/workspaces)
- Bun lockfile: [https://bun.com/docs/pm/lockfile](https://bun.com/docs/pm/lockfile)
- Drizzle ORM (SQLite): [https://orm.drizzle.team/docs/get-started/bun-sqlite-new](https://orm.drizzle.team/docs/get-started/bun-sqlite-new)
- Drizzle ORM (Bun SQL / PostgreSQL): [https://orm.drizzle.team/docs/connect-bun-sql](https://orm.drizzle.team/docs/connect-bun-sql)
- Drizzle ORM (MySQL): [https://orm.drizzle.team/docs/get-started/mysql-existing](https://orm.drizzle.team/docs/get-started/mysql-existing)
- Kysely (multi-dialect): [https://kysely.dev/docs/dialects](https://kysely.dev/docs/dialects)
- Clipanion CLI framework: [https://github.com/arcanis/clipanion](https://github.com/arcanis/clipanion)
- Clipanion API docs: [https://mael.dev/clipanion/docs/api/builtins/](https://mael.dev/clipanion/docs/api/builtins/)
- Zod schema validation: [https://zod.dev](https://zod.dev)
- decimal.js: [https://github.com/MikeMcl/decimal.js](https://github.com/MikeMcl/decimal.js)
- Bun test runner: [https://bun.com/docs/guides/test/run-tests](https://bun.com/docs/guides/test/run-tests)
- SQLite WAL: [https://www.sqlite.org/wal.html](https://www.sqlite.org/wal.html)
- Bun executables: [https://bun.com/docs/bundler/executables](https://bun.com/docs/bundler/executables)

---

**This architecture record remains documentation-only. Sudhanshu reviews, adjusts, and confirms the remaining recommendations and prerequisites before implementation can proceed.**

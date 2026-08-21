# Agent Skills Architecture

Skills orchestrate the [Accounting Contracts](accounting-contracts.md) through
the CLI. That contract owns domain states, posting templates, evidence gates,
idempotency, and ledger invariants; this document owns the skill/engine/agent
boundary and versioned job shape.

## Purpose

agent-bahi is a deterministic accounting and compliance engine plus a set of
versioned agent job skills. A skill coordinates a workflow and verifies its
result. It is not a second accounting engine: accounting rules, tax
calculations, permissions and gates, and ledger invariants stay in the engine.

The initial target is routine, high-confidence work. When the evidence is
incomplete, conflicting, or ambiguous, the workflow must produce an explicit
exception rather than silently guessing.

## Responsibilities

### Engine

- Own the canonical data model and ledger state.
- Apply accounting rules and tax calculations deterministically.
- Own base-currency conversion, immutable document rate snapshots, settlement
  application rates, realized exchange gain/loss, bank-fee separation, and
  auditable period-end revaluation adjustments.
- Own the asset register, automatic depreciation postings, disposal tracking,
  and the policy/configuration boundary for **T-003 TENTATIVE - NOT
  OWNER-APPROVED** depreciation methods and separate book-versus-tax schedules.
  This choice is reversible and must not be treated as implementation
  authorization.
- Enforce permissions, safety gates, document state rules, and ledger
  invariants, including inclusive global or module-specific period locks.
- Expose authoritative validation results and durable audit metadata.

### CLI

- Provide the explicit command surface used by people and skills.
- Parse and validate command inputs before asking the engine to mutate state.
- Make previews, requested changes, validation, and outcomes inspectable.
- Validate and persist explicit bank-reconciliation matches, including tenant,
  account, currency, amount, status, idempotency, and provenance checks.
- Expose lock, unlock, and bounded partial-unlock previews and require the
  reason and actor metadata needed by the engine.
- Return stable success, failure, and exception information for callers.

The CLI is a boundary and an interface, not an owner of accounting policy.

### Skill

- Describe one repeatable job and its intended outcome.
- Check prerequisites and gather the required inputs and evidence.
- Invoke only allowed, explicit CLI commands in the prescribed order.
- Verify the engine's result against the skill's validation checklist.
- Stop and route an exception when the automation gate is not satisfied.
- Return outputs and audit metadata tied to the skill version.
- For bank reconciliation, gather evidence and propose candidate matches; a
  proposal may be non-deterministic, but acceptance is an explicit validated
  CLI operation rather than a hidden engine decision.
- For late documents in a locked period, guide the user through controlled
  reopen/original-date posting or a current-period adjustment; never choose
  automatically.

### Agent

- Select an applicable skill and provide its inputs.
- Gather or point to evidence without inventing missing facts.
- Follow the skill's ordered procedure and command limits.
- Surface failures and exceptions with enough context for review.
- Never bypass the CLI, engine gates, or validation checklist.

## Not magic

Every skill run must make the following visible:

- **Evidence required**: the run identifies the source evidence it relied on;
  missing or conflicting evidence is not silently filled in.
- **Explicit commands**: the run uses named CLI commands, with inputs and
  outcomes that can be inspected.
- **Verification checklist**: the run checks its expected result after the
  engine responds.
- **Failure and exception conditions**: the run states what stops automation
  and where the unresolved work goes.
- **Versioning**: the skill definition and the run identify the skill version.
- **Audit metadata**: the run records relevant actor, entity, timestamps,
  evidence references, commands, validation, and outcome metadata.
- **Deterministic posting**: once a match or accounting choice is explicit and
  validated, posting behavior is deterministic. A skill's candidate ranking
  cannot alter ledger rules.

These requirements make a skill a bounded, reviewable workflow rather than an
instruction for an agent to improvise accounting behavior.

## Proposed skill contract

Each skill should define the following fields. This is a contract shape for
discovery; it does not prescribe detailed accounting procedures yet.

| Field | Required content |
| --- | --- |
| `purpose` | The job the skill performs and the intended outcome |
| `prerequisites` | Preconditions that must be true before the run starts |
| `inputs` | User, entity, period, records, and other supplied inputs |
| `evidence` | Required source evidence, references, and evidence-quality expectations |
| `allowed_commands` | The explicit CLI commands the skill may invoke |
| `ordered_procedure` | The ordered workflow steps, including where to pause |
| `validation` | Checks that establish whether the intended outcome was achieved |
| `automation_gate` | The high-confidence conditions required for automatic execution |
| `exception_routes` | Named routes for missing evidence, ambiguity, failure, or required review |
| `outputs` | Records, reports, exceptions, and audit metadata returned by the run |
| `version` | The immutable skill version used for the run |
| `effective_from` / `effective_to` | The dates during which that version is applicable; an open end date is allowed |

The engine remains authoritative when a contract field overlaps with an
accounting rule or safety boundary. A skill may request an engine operation;
it may not redefine the operation's meaning.

## Initial skill catalog

The initial catalog is intentionally a set of job boundaries, not a collection
of invented procedures:

- Daily bookkeeper
- Accounts payable
- Accounts receivable
- Expense review
- Bank reconciliation
- Fixed assets
- Payroll accounting
- Month-end close
- Year-end close
- GST
- TDS/TCS
- Compliance calendar
- Audit preparation
- Management reporting

### Bank reconciliation boundary

The bank-reconciliation skill is invoked by a scheduler or user. Its ordered
workflow is to gather bank statement evidence and open-item evidence, produce
one or more candidate matches, show the evidence and uncertainty, and invoke
the explicit CLI persistence operation only after a recorded explicit human
confirmation is bound to the exact selected candidate/proposal. No workflow,
skill, scheduler, or agent authorization substitutes for that confirmation.
The CLI validates tenant, bank account, currency, amount, status, and
idempotency, then persists the match and provenance. Replaying the same
idempotent request must not create a second match. The engine never silently
chooses a match or runs an AI decision inside posting.

### Period-close and locking boundary

The skill may prepare a lock or a late-document decision, but the engine owns
the inclusive `locked-through` rule. Create, edit, delete, and void operations
inside the locked range fail. Full unlock uses
`period unlock preview|commit`; bounded partial unlock uses
`period partial-unlock preview|commit`. Both require tenant/scope, current
lock version, explicit range, non-empty reason, impact preview, and recorded
explicit human confirmation at commit; stale previews return
`UNLOCK_PREVIEW_REQUIRED`, invalid ranges return `PARTIAL_UNLOCK_INVALID`, and
version changes return `UNLOCK_CONFLICT`. A late document is routed to an
explicit controlled-reopen/original-date-posting choice or a
current-period-adjustment choice; no skill may turn that choice into an
automatic posting policy.

Zoho Books automation parity is the minimum initial automation baseline. It is
the baseline for deciding whether these skills cover the first useful set of
automated work; it does not move the Zoho import ahead of the final roadmap
phase.

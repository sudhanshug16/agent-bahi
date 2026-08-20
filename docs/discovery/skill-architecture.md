# Agent Skills Architecture

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
- Enforce permissions, safety gates, document state rules, and ledger
  invariants.
- Expose authoritative validation results and durable audit metadata.

### CLI

- Provide the explicit command surface used by people and skills.
- Parse and validate command inputs before asking the engine to mutate state.
- Make previews, requested changes, validation, and outcomes inspectable.
- Return stable success, failure, and exception information for callers.

The CLI is a boundary and an interface, not an owner of accounting policy.

### Skill

- Describe one repeatable job and its intended outcome.
- Check prerequisites and gather the required inputs and evidence.
- Invoke only allowed, explicit CLI commands in the prescribed order.
- Verify the engine's result against the skill's validation checklist.
- Stop and route an exception when the automation gate is not satisfied.
- Return outputs and audit metadata tied to the skill version.

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

Zoho Books automation parity is the minimum initial automation baseline. It is
the baseline for deciding whether these skills cover the first useful set of
automated work; it does not move the Zoho import ahead of the final roadmap
phase.

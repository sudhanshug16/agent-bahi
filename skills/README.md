# Agent-Bahi skill guides

Each guide is a repository-distributed entrypoint for the typed canonical
registry in `src/transport/skills.ts`. The validator checks the header,
operation markers, ordered step markers, explicit external boundaries, and
required safety guidance. Edit the registry first, then update the matching
`SKILL.md` and run `bun run validate:skills`.

Guides are instructions for deterministic operations, not dynamic execution.
Agents must inspect status first, provide explicit tenant/BookSet/TaxCase
scope for mutations, preview before irreversible or human-gated actions,
preserve evidence and result hashes, never equate export with government
submission, and surface typed blockers instead of guessing.

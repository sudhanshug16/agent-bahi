#!/bin/bash

# Superseded compatibility entrypoint. The Bun integration test owns the
# UUID-scoped, digest-pinned lifecycle and fail-closed migration contract.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

exec bun run test:gate0:integration

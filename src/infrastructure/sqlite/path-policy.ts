import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { DomainError } from "../../core/types.ts";

/**
 * Validate and canonicalize a local SQLite database path before Bun opens it.
 *
 * This policy intentionally retains the existing explicit network-like path
 * prefixes and cloud-sync path checks. It does not attempt cross-platform
 * mount detection; network mounts and filesystem changes after validation
 * remain outside this lexical/synchronous policy's guarantees (TOCTOU).
 */
export function assertSafeSqlitePath(path: string): string {
  if (typeof path !== "string" || path.length === 0) {
    throwUnsafePath("SQLite database path must be a non-empty string", path);
  }

  if (path.includes("\0")) {
    throwUnsafePath("SQLite database path contains a NUL character", path);
  }

  if (!isAbsolute(path)) {
    throwUnsafePath("SQLite database path must be absolute", path);
  }

  if (isExplicitlyRejectedPath(path)) {
    throwUnsafePath("SQLite database path uses an explicitly rejected network or sync location", path);
  }

  if (path.split(/[\\/]+/).some((component) => component === "..")) {
    throwUnsafePath("SQLite database path contains a traversal component", path);
  }

  const normalizedPath = normalize(path);
  const parentPath = dirname(normalizedPath);
  const filename = basename(normalizedPath);

  let canonicalParent: string;
  try {
    canonicalParent = realpathSync(parentPath);
  } catch {
    throwUnsafePath("SQLite database parent directory must exist", path);
  }

  try {
    if (!lstatSync(canonicalParent).isDirectory()) {
      throwUnsafePath("SQLite database parent path must be a directory", path);
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throwUnsafePath("SQLite database parent directory could not be inspected", path);
  }

  if (isExplicitlyRejectedPath(canonicalParent)) {
    throwUnsafePath("SQLite database canonical parent uses an explicitly rejected network or sync location", path);
  }

  const canonicalPath = join(canonicalParent, filename);
  try {
    const target = lstatSync(canonicalPath);
    if (target.isSymbolicLink()) {
      throwUnsafePath("SQLite database final target must not be a symlink", path);
    }
    if (!target.isFile()) {
      throwUnsafePath("SQLite database final target must be a regular file", path);
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (isMissingPathError(error)) return canonicalPath;
    throwUnsafePath("SQLite database final target could not be inspected", path);
  }

  return canonicalPath;
}

function isExplicitlyRejectedPath(path: string): boolean {
  return path.startsWith("//")
    || ["/net/", "/afs/", "/mnt/", "/media/", "/Volumes/"]
      .some((prefix) => path.startsWith(prefix))
    || path.includes("/Library/Mobile Documents/")
    || path.includes("/iCloud Drive/");
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

function throwUnsafePath(reason: string, path: unknown): never {
  throw new DomainError(
    "SQLITE_UNSAFE_PATH",
    `SQLite database path rejected for safety: ${reason}`,
    { path },
  );
}

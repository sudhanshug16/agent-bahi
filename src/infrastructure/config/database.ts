import { DomainError } from "../../core/types.ts";
import { chmodSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, posix, win32 } from "node:path";

export type DatabasePathSource = "explicit" | "environment" | "platform-default";

export interface DatabasePathResolution {
  readonly path: string;
  readonly source: DatabasePathSource;
}

export interface DatabasePathResolverOptions {
  /** Explicit --database value. It wins even when an environment override exists. */
  readonly explicitPath?: string;
  /** Injected environment for deterministic tests. `environment` is an alias. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Injected platform name (`darwin`, `linux`, `win32`, or another value). */
  readonly platform?: string;
  /** Injected home directory. When omitted, the host home is used only for the live process. */
  readonly home?: string;
}

const DEFAULT_FILENAME = "agent-bahi.sqlite";

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value;
}

function requireHome(value: string | undefined, platform: string): string {
  const home = nonEmpty(value);
  const absolute = platform === "win32" ? win32.isAbsolute(home ?? "") : posix.isAbsolute(home ?? "");
  if (!home || !absolute) {
    throw new DomainError(
      "DATABASE_HOME_UNAVAILABLE",
      "A non-empty absolute home directory is required to resolve the platform-default SQLite database; set HOME (or USERPROFILE on Windows) or pass --database PATH.",
      { platform },
    );
  }
  return home;
}

function platformDefaultPath(platform: string, environment: Readonly<Record<string, string | undefined>>, home: string): string {
  if (platform === "darwin") return posix.join(home, "Library", "Application Support", "agent-bahi", DEFAULT_FILENAME);
  if (platform === "win32") {
    const localAppData = nonEmpty(environment.LOCALAPPDATA);
    const base = localAppData && win32.isAbsolute(localAppData) ? localAppData : win32.join(home, "AppData", "Local");
    return win32.join(base, "agent-bahi", DEFAULT_FILENAME);
  }
  if (platform === "linux") {
    const xdgDataHome = nonEmpty(environment.XDG_DATA_HOME);
    const base = xdgDataHome && posix.isAbsolute(xdgDataHome) ? xdgDataHome : posix.join(home, ".local", "share");
    return posix.join(base, "agent-bahi", DEFAULT_FILENAME);
  }
  return posix.join(home, ".local", "share", "agent-bahi", DEFAULT_FILENAME);
}

/**
 * Resolve the SQLite file without touching the filesystem. The live CLI/MCP
 * wrappers supply process environment and host home; tests can inject all
 * inputs for a pure deterministic matrix.
 */
export function resolveDatabasePath(options: DatabasePathResolverOptions = {}): DatabasePathResolution {
  const injectedEnvironment = options.env ?? options.environment;
  const environment = injectedEnvironment ?? process.env;
  const platform = options.platform ?? process.platform;

  if (options.explicitPath !== undefined) {
    if (options.explicitPath.trim() === "") {
      throw new DomainError("INVALID_DATABASE_PATH", "--database requires a non-empty path", { source: "explicit" });
    }
    return { path: options.explicitPath, source: "explicit" };
  }

  const environmentPath = nonEmpty(environment.AGENT_BAHI_DATABASE);
  if (environmentPath) return { path: environmentPath, source: "environment" };

  const configuredHome = options.home !== undefined
    ? options.home
    : injectedEnvironment
      ? (platform === "win32" ? environment.USERPROFILE ?? environment.HOME : environment.HOME)
      : homedir();
  return { path: platformDefaultPath(platform, environment, requireHome(configuredHome, platform)), source: "platform-default" };
}

/** Ensure a platform-default parent is owned, directory-only, and private. */
export function ensurePlatformDefaultDatabaseParent(databasePath: string): void {
  const parentPath = dirname(databasePath);
  const absoluteParent = process.platform === "win32" ? win32.isAbsolute(parentPath) : posix.isAbsolute(parentPath);
  if (!absoluteParent) throw new DomainError("DATABASE_DEFAULT_PATH_INVALID", "Platform-default SQLite parent must be absolute", { path: databasePath });

  const root = process.platform === "win32" ? win32.parse(parentPath).root : posix.parse(parentPath).root;
  const relative = process.platform === "win32" ? win32.relative(root, parentPath) : posix.relative(root, parentPath);
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = process.platform === "win32" ? win32.join(current, part) : posix.join(current, part);
    try {
      const stats = lstatSync(current);
      if (stats.isSymbolicLink()) {
        if (current === parentPath) throw new DomainError("SQLITE_UNSAFE_PATH", "Platform-default SQLite parent must not be a symlink", { path: databasePath });
        try {
          if (!lstatSync(realpathSync(current)).isDirectory()) throw new Error("not-directory");
        } catch {
          throw new DomainError("SQLITE_UNSAFE_PATH", "Platform-default SQLite parent symlink must resolve to a directory", { path: databasePath });
        }
        continue;
      }
      if (!stats.isDirectory()) throw new DomainError("SQLITE_UNSAFE_PATH", "Platform-default SQLite parent collision must be a directory", { path: databasePath });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if ((error as { code?: string }).code !== "ENOENT") throw new DomainError("SQLITE_UNSAFE_PATH", "Platform-default SQLite parent could not be inspected", { path: databasePath });
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (mkdirError) {
        if ((mkdirError as { code?: string }).code !== "EEXIST") throw new DomainError("SQLITE_UNSAFE_PATH", "Platform-default SQLite parent could not be created", { path: databasePath });
        const stats = lstatSync(current);
        if (stats.isSymbolicLink() || !stats.isDirectory()) throw new DomainError("SQLITE_UNSAFE_PATH", "Platform-default SQLite parent collision must be a real directory", { path: databasePath });
      }
    }
  }

  try {
    if (lstatSync(parentPath).isSymbolicLink()) throw new DomainError("SQLITE_UNSAFE_PATH", "Platform-default SQLite parent must not be a symlink", { path: databasePath });
    if (process.platform !== "win32") chmodSync(parentPath, 0o700);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("SQLITE_UNSAFE_PATH", "Platform-default SQLite parent could not be finalized", { path: databasePath });
  }
}

export function chmodInitializedDatabase(databasePath: string): void {
  if (process.platform !== "win32") chmodSync(databasePath, 0o600);
}

export interface DatabaseConfig {
  dialect: "sqlite";
  sqlite: SqliteConfig;
}

export interface SqliteConfig {
  path: string;
}

/**
 * Parse database URL into typed configuration.
 * Supports only sqlite:///path/to/db.sqlite (file path, must be absolute).
 */
export function parseDatabaseUrl(url: string): DatabaseConfig {
  if (!url) {
    throw new DomainError(
      "INVALID_DATABASE_URL",
      "Database URL is required",
    );
  }

  try {
    const parsed = new URL(url);

    switch (parsed.protocol.toLowerCase().replace(":", "")) {
      case "sqlite": {
        if (parsed.hostname && parsed.hostname !== "localhost") {
          throw new Error(`SQLite URL host ${parsed.hostname} is rejected; only local files are supported`);
        }
        if (parsed.username || parsed.password || parsed.port) {
          throw new Error("SQLite URL credentials and ports are rejected; only local files are supported");
        }

        // sqlite:///path/to/db.sqlite → pathname is /path/to/db.sqlite
        let path = decodeURIComponent(parsed.pathname);
        if (!path.startsWith("/")) {
          path = "/" + path;
        }

        if (!path || path === "/") {
          throw new Error("SQLite path is required");
        }

        return {
          dialect: "sqlite",
          sqlite: { path },
        };
      }

      case "postgresql":
      case "postgres":
      case "mysql":
      case "http":
      case "https":
        throw new Error(`Database scheme ${parsed.protocol} is explicitly rejected; only local SQLite file URLs are supported`);

      default:
        throw new Error(`Database scheme ${parsed.protocol} is unsupported; only local SQLite file URLs are supported`);
    }
  } catch (error) {
    if (error instanceof DomainError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new DomainError(
      "INVALID_DATABASE_URL",
      `Failed to parse database URL: ${message}`,
    );
  }
}

/**
 * Host platform-default SQLite path for callers that do not need source metadata.
 */
export function getDefaultSqlitePath(): string {
  return resolveDatabasePath().path;
}

/**
 * Validate database config has required fields.
 */
export function validateDatabaseConfig(config: DatabaseConfig): void {
  if (config.dialect !== "sqlite") {
    throw new DomainError("UNSUPPORTED_DATABASE_DIALECT", `Database dialect ${String(config.dialect)} is rejected; only sqlite is supported`);
  }
  if (!config.sqlite) {
    throw new DomainError("INVALID_DATABASE_CONFIG", "SQLite config required for sqlite dialect");
  }
}

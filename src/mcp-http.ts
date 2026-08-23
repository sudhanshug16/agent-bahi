import { timingSafeEqual, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { basename } from "node:path";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { inspectSqliteApplicationCompatibility } from "./application/application.ts";
import { parseDatabaseUrl } from "./infrastructure/config/database.ts";
import { OperationDispatcher } from "./transport/dispatcher.ts";
import { createMcpServer } from "./transport/mcp-server.ts";

export const DEFAULT_MCP_HTTP_HOST = "127.0.0.1";
export const DEFAULT_MCP_HTTP_PORT = 8787;
export const MCP_HTTP_MAX_BODY_BYTES = 1_048_576;
export const MCP_HTTP_TIMEOUT_MS = 30_000;
const MCP_HTTP_MAX_SESSIONS = 64;
const MCP_HTTP_MAX_IN_FLIGHT = 32;
const MCP_HTTP_SESSION_TTL_MS = 30 * 60_000;
let portAllocationLock: Promise<void> = Promise.resolve();

export interface RemoteMcpOptions {
  readonly databasePath: string;
  readonly host?: string;
  readonly port?: number;
  readonly allowRemote?: boolean;
  readonly allowInsecureNoAuth?: boolean;
  readonly token?: string;
  readonly tokenFile?: string;
  readonly allowedHosts?: readonly string[];
  readonly requestTimeoutMs?: number;
}

export interface RemoteMcpServer {
  readonly url: string;
  readonly port: number;
  readonly authMode: "none" | "bearer";
  readonly databasePath: string;
  stop(): Promise<void>;
}

interface McpSession {
  readonly server: ReturnType<typeof createMcpServer>;
  readonly transport: WebStandardStreamableHTTPServerTransport;
  lastUsedAt: number;
}

interface NormalizedRemoteMcpOptions {
  readonly databasePath: string;
  readonly host: string;
  readonly port: number;
  readonly allowRemote: boolean;
  readonly allowInsecureNoAuth: boolean;
  readonly token?: string;
  readonly allowedHosts: readonly string[];
  readonly requestTimeoutMs: number;
}

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function errorResponse(status: number, error: string): Response {
  return jsonResponse({ ok: false, error }, status);
}

function isLoopbackBind(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

function hostAllowed(request: Request, options: NormalizedRemoteMcpOptions): boolean {
  const actual = request.headers.get("host");
  if (!actual) return false;
  const actualNormalized = normalizeHost(actual);
  const configured = new Set<string>();
  const add = (value: string) => {
    const normalized = normalizeHost(value);
    if (!normalized) return;
    configured.add(normalized);
  };

  const bindHost = options.host.includes(":") && !options.host.startsWith("[") ? `[${options.host}]` : options.host;
  add(`${bindHost}:${options.port}`);
  add(options.host);
  for (const value of options.allowedHosts) {
    add(value);
    add(`${value.includes(":") && !value.startsWith("[") ? `[${value}]` : value}:${options.port}`);
  }
  if (isLoopbackBind(options.host)) {
    for (const value of ["localhost", "127.0.0.1", "[::1]"]) {
      add(`${value}:${options.port}`);
    }
  }
  return configured.has(actualNormalized);
}

function originAllowed(request: Request, options: NormalizedRemoteMcpOptions): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const originHost = normalizeHost(parsed.host);
    const hostRequest = new Request(request.url, { headers: { host: originHost } });
    return hostAllowed(hostRequest, options);
  } catch {
    return false;
  }
}

function sha256(value: string): Uint8Array {
  return createHash("sha256").update(value).digest();
}

function tokenMatches(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

function authorizationAllowed(request: Request, options: NormalizedRemoteMcpOptions): boolean {
  if (!options.token) return isLoopbackBind(options.host) || options.allowInsecureNoAuth;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const candidate = authorization.slice("Bearer ".length).trim();
  return candidate.length > 0 && tokenMatches(candidate, options.token);
}

function resolveDatabasePath(value: string): string {
  if (value.toLowerCase().startsWith("sqlite:")) return parseDatabaseUrl(value).sqlite.path;
  return value;
}

async function readTokenFile(path: string): Promise<string> {
  try {
    const token = (await readFile(path, "utf8")).trim();
    if (!token || /[\r\n]/.test(token)) throw new Error("token file is empty or contains multiple lines");
    return token;
  } catch {
    throw new Error("MCP bearer token file could not be read");
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback()), timeoutMs); })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function normalizeOptions(input: RemoteMcpOptions): Promise<NormalizedRemoteMcpOptions> {
  const host = input.host ?? process.env.AGENT_BAHI_MCP_HOST ?? DEFAULT_MCP_HTTP_HOST;
  const port = input.port ?? Number(process.env.AGENT_BAHI_MCP_PORT ?? DEFAULT_MCP_HTTP_PORT);
  if (!host || host.startsWith("-")) throw new Error("MCP host must be a nonblank value");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("MCP port must be an integer from 0 through 65535");
  const remote = !isLoopbackBind(host);
  const allowRemote = input.allowRemote ?? false;
  const allowInsecureNoAuth = input.allowInsecureNoAuth ?? false;
  if (remote && !allowRemote) throw new Error("non-loopback MCP bind requires --allow-remote");
  const token = input.tokenFile
    ? await readTokenFile(input.tokenFile)
    : process.env.AGENT_BAHI_MCP_TOKEN_FILE
      ? await readTokenFile(process.env.AGENT_BAHI_MCP_TOKEN_FILE)
      : input.token ?? process.env.AGENT_BAHI_MCP_TOKEN;
  if (remote && !token && !allowInsecureNoAuth) throw new Error("non-loopback MCP bind requires a bearer token via AGENT_BAHI_MCP_TOKEN or --token-file");
  return {
    databasePath: resolveDatabasePath(input.databasePath),
    host,
    port,
    allowRemote,
    allowInsecureNoAuth,
    ...(token ? { token } : {}),
    allowedHosts: input.allowedHosts ?? [],
    requestTimeoutMs: input.requestTimeoutMs ?? MCP_HTTP_TIMEOUT_MS,
  };
}

async function findFreePort(): Promise<number> {
  const probe = createNetServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve());
  });
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("could not allocate an MCP port");
  return address.port;
}

async function readBoundedJson(request: Request, timeoutMs: number): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MCP_HTTP_MAX_BODY_BYTES)) throw new Error("request body exceeds limit");
  if (!request.body) throw new Error("request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      const remaining = Math.max(1, deadline - Date.now());
      const result = await withTimeout(reader.read(), remaining, () => { throw new Error("request body timed out"); });
      if (result.done) break;
      total += result.value.byteLength;
      if (total > MCP_HTTP_MAX_BODY_BYTES) throw new Error("request body exceeds limit");
      chunks.push(result.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new Error("request body is not valid JSON");
  }
}

function isInitializationBody(body: unknown): boolean {
  return Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body);
}

function remediationFor(status: string): string {
  return status === "UNINITIALIZED"
    ? "Run agent-bahi database.init explicitly before starting MCP."
    : "Run agent-bahi database.upgrade --backup ABS_PATH explicitly; MCP never upgrades databases.";
}

export async function startRemoteMcpServer(input: RemoteMcpOptions): Promise<RemoteMcpServer> {
  const normalized = await normalizeOptions(input);
  let releasePortAllocation: (() => void) | undefined;
  if (normalized.port === 0) {
    const previous = portAllocationLock;
    portAllocationLock = new Promise<void>((resolve) => { releasePortAllocation = resolve; });
    await previous;
  }
  let options: NormalizedRemoteMcpOptions;
  try {
    options = { ...normalized, port: normalized.port === 0 ? await findFreePort() : normalized.port };
  } catch (error) {
    releasePortAllocation?.();
    throw error;
  }
  const sessions = new Map<string, McpSession>();
  let inFlightRequests = 0;
  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - MCP_HTTP_SESSION_TTL_MS;
    for (const [id, session] of sessions) {
      if (session.lastUsedAt < cutoff) {
        sessions.delete(id);
        void session.server.close();
      }
    }
  }, 60_000);
  cleanupTimer.unref?.();

  const requireRequestGuards = (request: Request): Response | undefined => {
    if (!hostAllowed(request, options) || !originAllowed(request, options)) return errorResponse(403, "forbidden");
    if (!authorizationAllowed(request, options)) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json; charset=utf-8", "www-authenticate": "Bearer" } });
    return undefined;
  };

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: options.host,
      port: options.port,
      maxRequestBodySize: MCP_HTTP_MAX_BODY_BYTES,
      websocket: { message() {} },
      fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/healthz") return request.method === "GET" ? jsonResponse({ ok: true, status: "LIVE" }) : errorResponse(405, "method_not_allowed");
      if (url.pathname === "/readyz") {
        if (request.method !== "GET") return errorResponse(405, "method_not_allowed");
        const guard = requireRequestGuards(request);
        if (guard) return guard;
        try {
          const compatibility = await inspectSqliteApplicationCompatibility(options.databasePath);
          const ready = compatibility.status === "READY";
          return jsonResponse({ ok: ready, status: ready ? "READY" : "NOT_READY", compatibility, ...(ready ? {} : { error: { code: compatibility.status, remediation: remediationFor(compatibility.status) } }) }, ready ? 200 : 503);
        } catch {
          return errorResponse(503, "database_unavailable");
        }
      }
      if (url.pathname !== "/mcp") return errorResponse(404, "not_found");
      const guard = requireRequestGuards(request);
      if (guard) return guard;
      if (!["POST", "GET", "DELETE"].includes(request.method)) return errorResponse(405, "method_not_allowed");
      if (request.method === "POST") {
        const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (contentType !== "application/json") return errorResponse(415, "unsupported_media_type");
        const accept = request.headers.get("accept") ?? "";
        if (!accept.includes("application/json") || !accept.includes("text/event-stream")) return errorResponse(406, "not_acceptable");
      }

      let body: unknown;
      if (request.method === "POST") {
        try { body = await readBoundedJson(request, options.requestTimeoutMs); }
        catch (error) { return errorResponse(error instanceof Error && error.message.includes("exceeds") ? 413 : error instanceof Error && error.message.includes("timed out") ? 408 : 400, error instanceof Error && error.message.includes("exceeds") ? "request_too_large" : error instanceof Error && error.message.includes("timed out") ? "request_timeout" : "invalid_json"); }
      }

      if (inFlightRequests >= MCP_HTTP_MAX_IN_FLIGHT) return errorResponse(503, "server_busy");
      inFlightRequests += 1;
      try {
        const sessionId = request.headers.get("mcp-session-id");
        let session = sessionId ? sessions.get(sessionId) : undefined;
        if (request.method === "POST" && isInitializationBody(body)) {
          if (sessions.size >= MCP_HTTP_MAX_SESSIONS) return errorResponse(429, "session_limit_reached");
          const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID(), enableJsonResponse: true });
          const mcpServer = createMcpServer(new OperationDispatcher({ databasePath: options.databasePath, allowOperatorOperations: false, source: "MCP" }));
          await mcpServer.connect(transport);
          session = { server: mcpServer, transport, lastUsedAt: Date.now() };
          const response = await withTimeout(
            transport.handleRequest(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) }), { parsedBody: body }),
            options.requestTimeoutMs,
            () => errorResponse(504, "request_timeout"),
          );
          if (transport.sessionId) sessions.set(transport.sessionId, session);
          return response;
        }
        if (!session) return errorResponse(400, "session_required");
        session.lastUsedAt = Date.now();
        if (request.method === "DELETE") {
          sessions.delete(sessionId!);
          await session.server.close();
          return new Response(null, { status: 200 });
        }
        if (request.method === "GET") return new Response(null, { status: 405, headers: { allow: "POST, DELETE" } });
        const downstream = request.method === "POST"
          ? new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) })
          : request;
        return await withTimeout(
          session.transport.handleRequest(downstream, request.method === "POST" ? { parsedBody: body } : undefined),
          options.requestTimeoutMs,
          () => errorResponse(504, "request_timeout"),
        );
      } finally {
        inFlightRequests -= 1;
      }
      },
    });
  } finally {
    releasePortAllocation?.();
  }

  const port = server.port ?? options.port;
  const bindHost = options.host.includes(":") && !options.host.startsWith("[") ? `[${options.host}]` : options.host;
  return {
    url: `http://${bindHost}:${port}/mcp`,
    port,
    authMode: options.token ? "bearer" : "none",
    databasePath: options.databasePath,
    stop: async () => {
      clearInterval(cleanupTimer);
      for (const session of sessions.values()) await session.server.close();
      sessions.clear();
      await server.stop(true);
    },
  };
}

export async function runRemoteMcp(options: RemoteMcpOptions): Promise<void> {
  const server = await startRemoteMcpServer(options);
  const safeDatabase = `${basename(server.databasePath)} (path redacted)`;
  const compatibility = await inspectSqliteApplicationCompatibility(server.databasePath).catch(() => ({ status: "UNAVAILABLE" }));
  const authMode = server.authMode === "bearer" ? "bearer-token" : options.allowInsecureNoAuth ? "INSECURE_NO_AUTH" : "none-loopback";
  process.stderr.write(`${JSON.stringify({ event: "mcp.server.started", bindUrl: server.url, authMode, database: safeDatabase, schemaCompatibility: compatibility, sessionMode: "bounded-stateful", warning: authMode === "INSECURE_NO_AUTH" ? "INSECURE_NO_AUTH_ENABLED" : undefined })}\n`);
  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = (signal: string) => {
      if (stopping) return;
      stopping = true;
      process.stderr.write(`${JSON.stringify({ event: "mcp.server.stopping", signal })}\n`);
      void server.stop().then(resolve);
    };
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));
  });
}

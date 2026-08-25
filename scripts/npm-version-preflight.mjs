const REGISTRY_URL = "https://registry.npmjs.org/";
const REQUEST_TIMEOUT_MS = 10_000;

function fail(message, cause) {
  const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : "";
  throw new Error(`${message}${detail}`);
}

function packumentUrl(registryUrl, packageName) {
  let base;
  try {
    base = new URL(registryUrl.endsWith("/") ? registryUrl : `${registryUrl}/`);
  } catch (error) {
    fail("registry URL is invalid", error);
  }
  return new URL(encodeURIComponent(packageName), base);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {{ packageName: string, packageVersion: string, fetchImpl?: typeof fetch, registryUrl?: string }} options
 * @returns {Promise<"exists" | "absent">}
 */
export async function checkNpmVersion({ packageName, packageVersion, fetchImpl = fetch, registryUrl = REGISTRY_URL }) {
  if (!packageName || !packageVersion) fail("package name and version are required");

  const url = packumentUrl(registryUrl, packageName);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    fail("registry request failed", error);
  }

  if (response.status === 404) return "absent";
  if (!response.ok) fail(`registry returned HTTP ${response.status}`);

  let packument;
  try {
    packument = await response.json();
  } catch (error) {
    fail("registry returned malformed JSON", error);
  }
  if (!isRecord(packument) || !isRecord(packument.versions)) fail("registry packument is malformed");

  return Object.hasOwn(packument.versions, packageVersion) ? "exists" : "absent";
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [, , packageName, packageVersion] = process.argv;
  checkNpmVersion({ packageName, packageVersion, registryUrl: process.env.NPM_REGISTRY_URL ?? REGISTRY_URL })
    .then((result) => process.stdout.write(`${result}\n`))
    .catch((error) => {
      process.stderr.write(`npm version preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

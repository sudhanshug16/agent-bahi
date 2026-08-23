import { createHash } from "node:crypto";
import { canonicalJson } from "../commands.ts";
import { DomainError } from "../../core/types.ts";

export type JsonObject = Record<string, unknown>;
export type Schema = JsonObject;
export type Mapping = JsonObject;
export type Diagnostic = { pointer: string; code: string; message: string };
export const MAX_ARTIFACT_JSON = 256_000;
const MAX_DEPTH = 16;
const MAX_NODES = 512;
const MAX_DIAGNOSTICS = 128;
const SCHEMA_KEYS = ["type", "properties", "required", "items", "enum", "pattern", "minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "additionalProperties", "integerEncoding", "encoding"] as const;

function object(value: unknown, field: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("INVALID_RETURN_ARTIFACT_SCHEMA", `${field} must be an object`);
  return value as JsonObject;
}
function text(value: unknown, field: string, max = 256): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new DomainError("INVALID_RETURN_ARTIFACT_SCHEMA", `${field} must be a bounded nonblank string`);
  return value.trim();
}
function keysOnly(row: JsonObject, allowed: readonly string[], field: string): void {
  if (Object.keys(row).some((key) => !allowed.includes(key))) throw new DomainError("RETURN_SCHEMA_UNSUPPORTED_KEYWORD", `${field} contains an unsupported key`);
}

export function validateSchema(value: unknown, path = "", depth = 0, counter = { count: 0 }): Schema {
  if (depth > MAX_DEPTH) throw new DomainError("RETURN_SCHEMA_DEPTH_EXCEEDED", "validation schema depth exceeds the V1 bound", { path });
  counter.count += 1;
  if (counter.count > MAX_NODES) throw new DomainError("RETURN_SCHEMA_NODES_EXCEEDED", "validation schema node count exceeds the V1 bound");
  const row = object(value, path || "validationSchema");
  keysOnly(row, SCHEMA_KEYS, path || "validationSchema");
  const type = String(row.type);
  if (!["object", "array", "string", "integer", "boolean", "null"].includes(type)) throw new DomainError("RETURN_SCHEMA_UNSUPPORTED_TYPE", `${path || "/"}.type is unsupported`);
  if (row.additionalProperties !== undefined && row.additionalProperties !== false) throw new DomainError("RETURN_SCHEMA_UNSUPPORTED_KEYWORD", "additionalProperties must be false");
  if (row.required !== undefined && (!Array.isArray(row.required) || row.required.some((key) => typeof key !== "string"))) throw new DomainError("RETURN_SCHEMA_INVALID_REQUIRED", `${path || "/"}.required must be string names`);
  if (row.enum !== undefined && (!Array.isArray(row.enum) || row.enum.length > 64)) throw new DomainError("RETURN_SCHEMA_INVALID_ENUM", `${path || "/"}.enum must be a bounded array`);
  for (const name of ["minLength", "maxLength", "minItems", "maxItems"] as const) if (row[name] !== undefined && (!Number.isSafeInteger(row[name]) || Number(row[name]) < 0 || Number(row[name]) > 100_000)) throw new DomainError("RETURN_SCHEMA_INVALID_BOUND", `${path || "/"}.${name} must be a safe nonnegative integer`);
  for (const name of ["minimum", "maximum"] as const) if (row[name] !== undefined && (typeof row[name] !== "string" || !/^-?(?:0|[1-9][0-9]*)$/.test(row[name]))) throw new DomainError("RETURN_SCHEMA_INVALID_BOUND", `${path || "/"}.${name} must be a decimal string`);
  if (row.pattern !== undefined && (typeof row.pattern !== "string" || row.pattern.length > 256)) throw new DomainError("RETURN_SCHEMA_INVALID_PATTERN", `${path || "/"}.pattern is invalid`);
  if (typeof row.pattern === "string") { try { new RegExp(row.pattern, "u"); } catch { throw new DomainError("RETURN_SCHEMA_INVALID_PATTERN", `${path || "/"}.pattern is invalid`); } }
  if (type === "object") {
    const properties = row.properties === undefined ? {} : object(row.properties, `${path || "/"}.properties`);
    for (const [key, child] of Object.entries(properties)) { if (key.length > 128 || key.includes("\0")) throw new DomainError("RETURN_SCHEMA_INVALID_PROPERTY", "schema property name is invalid"); validateSchema(child, `${path}/${key}`, depth + 1, counter); }
    if (Array.isArray(row.required) && new Set(row.required).size !== row.required.length) throw new DomainError("RETURN_SCHEMA_INVALID_REQUIRED", "required contains duplicate names");
    if (Array.isArray(row.required) && row.required.some((key) => !Object.prototype.hasOwnProperty.call(properties, key))) throw new DomainError("RETURN_SCHEMA_INVALID_REQUIRED", "required names must be declared properties");
  } else if (type === "array") {
    if (row.items === undefined) throw new DomainError("RETURN_SCHEMA_ITEMS_REQUIRED", `${path || "/"}.items is required for arrays`);
    validateSchema(row.items, `${path}/*`, depth + 1, counter);
  } else if (row.properties !== undefined || row.items !== undefined || row.required !== undefined || row.additionalProperties !== undefined) throw new DomainError("RETURN_SCHEMA_KEYWORD_TYPE_MISMATCH", `${path || "/"} uses object/array keywords for a scalar`);
  if (type !== "string" && (row.minLength !== undefined || row.maxLength !== undefined)) throw new DomainError("RETURN_SCHEMA_KEYWORD_TYPE_MISMATCH", `${path || "/"} uses string length bounds for a non-string`);
  if (type !== "array" && (row.minItems !== undefined || row.maxItems !== undefined)) throw new DomainError("RETURN_SCHEMA_KEYWORD_TYPE_MISMATCH", `${path || "/"} uses item bounds for a non-array`);
  if (type !== "integer" && (row.minimum !== undefined || row.maximum !== undefined)) throw new DomainError("RETURN_SCHEMA_KEYWORD_TYPE_MISMATCH", `${path || "/"} uses value bounds for a non-integer`);
  if (type === "integer") { const encoding = row.integerEncoding ?? row.encoding; if (encoding !== "DECIMAL_STRING" && encoding !== "SAFE_JSON_INTEGER") throw new DomainError("RETURN_SCHEMA_INTEGER_ENCODING_REQUIRED", `${path || "/"} must explicitly declare integerEncoding`); }
  else if (row.integerEncoding !== undefined || row.encoding !== undefined) throw new DomainError("RETURN_SCHEMA_INTEGER_ENCODING_INVALID", `${path || "/"} declares integer encoding for a non-integer`);
  return row;
}

export function validateMapping(value: unknown, allowedRoots: readonly string[] = ["identity", "taxCase", "selectedForm", "filingSnapshot", "worksheet", "eligibility", "computation"], path = "mappingSpec", depth = 0, counter = { count: 0 }): Mapping {
  if (depth > MAX_DEPTH) throw new DomainError("RETURN_MAPPING_DEPTH_EXCEEDED", "mapping depth exceeds the V1 bound");
  counter.count += 1; if (counter.count > MAX_NODES) throw new DomainError("RETURN_MAPPING_NODES_EXCEEDED", "mapping node count exceeds the V1 bound");
  const row = object(value, path); const kind = row.type ?? (row.pointer !== undefined ? "pointer" : row.value !== undefined ? "constant" : undefined);
  if (!["object", "array", "constant", "pointer"].includes(String(kind))) throw new DomainError("RETURN_MAPPING_OPERATOR_INVALID", `${path}.type is unsupported`);
  if (kind === "object") { keysOnly(row, ["type", "properties"], path); const properties = object(row.properties, `${path}.properties`); for (const [key, child] of Object.entries(properties)) { if (key.length > 128 || key.includes("\0")) throw new DomainError("RETURN_MAPPING_INVALID_PROPERTY", `${path}.${key} is invalid`); validateMapping(child, allowedRoots, `${path}.properties.${key}`, depth + 1, counter); } }
  else if (kind === "array") { keysOnly(row, ["type", "items"], path); if (!Array.isArray(row.items) || row.items.length === 0 || row.items.length > 256) throw new DomainError("RETURN_MAPPING_ARRAY_INVALID", `${path}.items must be a bounded non-empty array`); row.items.forEach((child, index) => validateMapping(child, allowedRoots, `${path}.items[${index}]`, depth + 1, counter)); }
  else if (kind === "constant") { keysOnly(row, ["type", "value", "convert"], path); if (row.convert !== undefined && !["string", "integer", "boolean", "null"].includes(String(row.convert))) throw new DomainError("RETURN_MAPPING_CONVERSION_INVALID", `${path}.convert is unsupported`); }
  else { keysOnly(row, ["type", "pointer", "convert"], path); const pointer = text(row.pointer, `${path}.pointer`); const rootPattern = allowedRoots.map((root) => root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"); if (!new RegExp(`^/(${rootPattern})(/[^/]+)*$`, "u").test(pointer)) throw new DomainError("RETURN_MAPPING_POINTER_INVALID", `pointer is not whitelisted: ${pointer}`); if (row.convert !== undefined && !["string", "integer", "boolean", "null"].includes(String(row.convert))) throw new DomainError("RETURN_MAPPING_CONVERSION_INVALID", `${path}.convert is unsupported`); }
  return { ...row, type: kind };
}

function pointerValue(root: JsonObject, pointer: string): unknown { let value: unknown = root; for (const part of pointer.slice(1).split("/").map((item) => item.replaceAll("~1", "/").replaceAll("~0", "~"))) { if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, part)) throw new DomainError("RETURN_MAPPING_POINTER_MISSING", `bound pointer is unavailable: ${pointer}`); value = (value as JsonObject)[part]; } return value; }
function convert(value: unknown, conversion: unknown, path: string): unknown { if (conversion === undefined) return value; if (conversion === "null") return null; if (conversion === "string") { if (typeof value === "string") return value; if (typeof value === "number" && Number.isSafeInteger(value)) return String(value); if (typeof value === "boolean") return value ? "true" : "false"; } else if (conversion === "boolean") { if (typeof value === "boolean") return value; if (value === "true" || value === "false") return value === "true"; } else if (conversion === "integer") { if (typeof value === "string" && /^-?(?:0|[1-9][0-9]*)$/.test(value)) return value; if (typeof value === "number" && Number.isSafeInteger(value)) return value; throw new DomainError("RETURN_MAPPING_UNSAFE_INTEGER", `${path} cannot convert to integer safely`); } throw new DomainError("RETURN_MAPPING_CONVERSION_INVALID", `${path} cannot convert to ${String(conversion)}`); }
export function evaluateMapping(node: Mapping, root: JsonObject, path = "mappingSpec"): unknown { if (node.type === "object") { const output: JsonObject = {}; for (const [key, child] of Object.entries(object(node.properties, `${path}.properties`))) output[key] = evaluateMapping(child as Mapping, root, `${path}.${key}`); return output; } if (node.type === "array") return (node.items as unknown[]).map((child, index) => evaluateMapping(child as Mapping, root, `${path}[${index}]`)); if (node.type === "constant") return convert(node.value, node.convert, path); return convert(pointerValue(root, String(node.pointer)), node.convert, path); }

function compareDecimalInteger(left: string, right: string): number { const normalize = (value: string) => { const negative = value.startsWith("-"); const digits = (negative ? value.slice(1) : value).replace(/^0+(?=\d)/, ""); return { negative: negative && digits !== "0", digits }; }; const a = normalize(left); const b = normalize(right); if (a.negative !== b.negative) return a.negative ? -1 : 1; const sign = a.negative ? -1 : 1; if (a.digits.length !== b.digits.length) return (a.digits.length < b.digits.length ? -1 : 1) * sign; return (a.digits === b.digits ? 0 : a.digits < b.digits ? -1 : 1) * sign; }
export function validateValue(schema: Schema, value: unknown, pointer = "", diagnostics: Diagnostic[] = []): Diagnostic[] { if (diagnostics.length >= MAX_DIAGNOSTICS) return diagnostics; const fail = (code: string, message: string) => { if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push({ pointer: pointer || "/", code, message }); }; const type = String(schema.type); if (type === "null" && value !== null) { fail("TYPE", "expected null"); return diagnostics; } if (type === "boolean" && typeof value !== "boolean") { fail("TYPE", "expected boolean"); return diagnostics; } if (type === "string" && typeof value !== "string") { fail("TYPE", "expected string"); return diagnostics; } if (type === "integer") { const encoding = schema.integerEncoding ?? schema.encoding; const valid = encoding === "DECIMAL_STRING" ? typeof value === "string" && /^-?(?:0|[1-9][0-9]*)$/.test(value) : typeof value === "number" && Number.isSafeInteger(value); if (!valid) { fail("TYPE", `expected ${String(encoding)}`); return diagnostics; } const comparable = typeof value === "string" ? value : String(value); if (schema.minimum !== undefined && compareDecimalInteger(comparable, String(schema.minimum)) < 0) fail("MINIMUM", "integer is below minimum"); if (schema.maximum !== undefined && compareDecimalInteger(comparable, String(schema.maximum)) > 0) fail("MAXIMUM", "integer is above maximum"); } if (type === "string" && typeof value === "string") { if (schema.minLength !== undefined && value.length < Number(schema.minLength)) fail("MIN_LENGTH", "string is shorter than minLength"); if (schema.maxLength !== undefined && value.length > Number(schema.maxLength)) fail("MAX_LENGTH", "string is longer than maxLength"); if (schema.pattern !== undefined && !(new RegExp(String(schema.pattern), "u")).test(value)) fail("PATTERN", "string does not match pattern"); } if (schema.enum !== undefined && !(schema.enum as unknown[]).some((candidate) => canonicalJson(candidate) === canonicalJson(value))) fail("ENUM", "value is not in enum"); if (type === "object" && value && typeof value === "object" && !Array.isArray(value)) { const row = value as JsonObject; const properties = (schema.properties ?? {}) as JsonObject; for (const required of (schema.required as string[] | undefined) ?? []) if (!Object.prototype.hasOwnProperty.call(row, required)) fail("REQUIRED", `required property is missing: ${required}`); if (schema.additionalProperties === false) for (const key of Object.keys(row)) if (!Object.prototype.hasOwnProperty.call(properties, key)) fail("ADDITIONAL_PROPERTY", `additional property is not allowed: ${key}`); for (const [key, child] of Object.entries(properties)) if (Object.prototype.hasOwnProperty.call(row, key)) validateValue(child as Schema, row[key], `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, diagnostics); } if (type === "array" && Array.isArray(value)) { if (schema.minItems !== undefined && value.length < Number(schema.minItems)) fail("MIN_ITEMS", "array has fewer than minItems"); if (schema.maxItems !== undefined && value.length > Number(schema.maxItems)) fail("MAX_ITEMS", "array has more than maxItems"); for (const [index, item] of value.entries()) validateValue(schema.items as Schema, item, `${pointer}/${index}`, diagnostics); } return diagnostics; }

export function hashCanonical(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }

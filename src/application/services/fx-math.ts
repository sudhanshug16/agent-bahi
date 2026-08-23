import { DomainError } from "../../core/types.ts";

export type FxRoundingPolicy = "HALF_UP" | "HALF_EVEN" | "FLOOR" | "CEILING";

export interface ExactRate {
  decimal: string;
  numerator: bigint;
  scale: number;
}

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** Parse only canonical decimal strings. Numbers are intentionally rejected. */
export function parseExactRate(value: unknown): ExactRate {
  if (typeof value !== "string" || !DECIMAL.test(value) || value.trim() !== value) {
    throw new DomainError("INVALID_FX_RATE", "FX rate must be a canonical non-negative decimal string; numbers are not accepted");
  }
  const [whole, fraction = ""] = value.split(".");
  const scale = fraction.length;
  if (scale > 18 || (whole === "0" && fraction.length === 0)) throw new DomainError("INVALID_FX_RATE", "FX rate must be positive with at most 18 decimal places");
  const numerator = BigInt(`${whole}${fraction}`);
  if (numerator <= 0n) throw new DomainError("INVALID_FX_RATE", "FX rate must be positive");
  const decimal = scale === 0 ? whole : `${whole}.${fraction}`;
  return { decimal, numerator, scale };
}

export function canonicalRate(value: ExactRate): string {
  let decimal = value.decimal;
  if (decimal.includes(".")) decimal = decimal.replace(/0+$/, "").replace(/\.$/, "");
  return decimal;
}

function rounded(numerator: bigint, denominator: bigint, policy: FxRoundingPolicy): bigint {
  if (denominator <= 0n) throw new DomainError("INVALID_FX_RATE", "FX denominator must be positive");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  if (policy === "FLOOR") return quotient;
  if (policy === "CEILING") return quotient + 1n;
  const twice = remainder * 2n;
  if (twice > denominator) return quotient + 1n;
  if (twice < denominator) return quotient;
  return policy === "HALF_EVEN" && quotient % 2n === 0n ? quotient : quotient + 1n;
}

export function convertForeignMinor(foreignMinor: bigint, rate: ExactRate, policy: FxRoundingPolicy, baseExponent: number, foreignExponent = 2): bigint {
  if (foreignMinor <= 0n) throw new DomainError("INVALID_AMOUNT", "foreign amount must be positive");
  const exponentFactor = baseExponent >= foreignExponent ? 10n ** BigInt(baseExponent - foreignExponent) : 1n;
  const denominatorFactor = foreignExponent > baseExponent ? 10n ** BigInt(foreignExponent - baseExponent) : 1n;
  return rounded(foreignMinor * rate.numerator * exponentFactor, 10n ** BigInt(rate.scale) * denominatorFactor, policy);
}

/** Allocate one document-level rounded total without floating point. */
export function convertDocumentLines(foreignMinor: readonly bigint[], rate: ExactRate, policy: FxRoundingPolicy, baseExponent: number, foreignExponent = 2): bigint[] {
  if (foreignMinor.length === 0 || foreignMinor.some((amount) => amount <= 0n)) throw new DomainError("INVALID_AMOUNT", "document lines must contain positive amounts");
  const exponentFactor = baseExponent >= foreignExponent ? 10n ** BigInt(baseExponent - foreignExponent) : 1n;
  const denominatorFactor = foreignExponent > baseExponent ? 10n ** BigInt(foreignExponent - baseExponent) : 1n;
  const denominator = 10n ** BigInt(rate.scale) * denominatorFactor;
  const exact = foreignMinor.map((amount) => ({ amount, numerator: amount * rate.numerator * exponentFactor }));
  const base = exact.map((line) => line.numerator / denominator);
  const target = rounded(exact.reduce((sum, line) => sum + line.numerator, 0n), denominator, policy);
  let remainder = target - base.reduce((sum, amount) => sum + amount, 0n);
  if (remainder < 0n || remainder > BigInt(foreignMinor.length)) throw new DomainError("FX_ROUNDING_UNREPRESENTABLE", "document rounding cannot be allocated deterministically");
  const ranked = exact.map((line, index) => ({ index, fraction: line.numerator % denominator })).sort((left, right) => right.fraction === left.fraction ? left.index - right.index : right.fraction > left.fraction ? 1 : -1);
  const result = [...base];
  while (remainder > 0n) {
    for (const line of ranked) {
      if (remainder === 0n) break;
      result[line.index] += 1n;
      remainder -= 1n;
    }
  }
  if (policy === "FLOOR" && result.some((value, index) => value !== base[index])) throw new DomainError("FX_ROUNDING_POLICY", "FLOOR cannot allocate a positive document remainder");
  return result;
}

export function proportionalCarryingBase(totalBase: bigint, totalForeign: bigint, priorForeign: bigint, allocationForeign: bigint): bigint {
  if (totalBase <= 0n || totalForeign <= 0n || priorForeign < 0n || allocationForeign <= 0n || priorForeign + allocationForeign > totalForeign) throw new DomainError("INVALID_FX_ALLOCATION", "invalid proportional FX allocation");
  if (priorForeign + allocationForeign === totalForeign) return totalBase - (totalBase * priorForeign / totalForeign);
  return totalBase * allocationForeign / totalForeign;
}

export function safeNumber(value: bigint, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new DomainError("INVALID_AMOUNT", `${field} exceeds safe integer range`);
  return number;
}

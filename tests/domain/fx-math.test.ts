import { describe, expect, it } from "bun:test";
import { convertDocumentLines, convertForeignMinor, parseExactRate, proportionalCarryingBase } from "../../src/application/services/fx-math.ts";

describe("exact foreign-currency math", () => {
  it("rejects JavaScript numbers and preserves decimal direction", () => {
    expect(() => parseExactRate(83.125)).toThrow();
    const rate = parseExactRate("83.125");
    expect(rate.numerator).toBe(83125n);
    expect(rate.scale).toBe(3);
    expect(convertForeignMinor(10_000n, rate, "HALF_UP", 2, 2)).toBe(831_250n);
  });

  it("handles zero-decimal foreign currencies and document remainder deterministically", () => {
    const rate = parseExactRate("0.55");
    expect(convertForeignMinor(100n, rate, "HALF_UP", 2, 0)).toBe(5_500n);
    expect(convertDocumentLines([1n, 1n, 1n], parseExactRate("0.5"), "HALF_UP", 2, 2)).toEqual([1n, 1n, 0n]);
    expect(proportionalCarryingBase(831_250n, 10_000n, 0n, 4_000n)).toBe(332_500n);
    expect(proportionalCarryingBase(831_250n, 10_000n, 4_000n, 6_000n)).toBe(498_750n);
  });
});

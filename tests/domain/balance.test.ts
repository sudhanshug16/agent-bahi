import { describe, expect, test } from "bun:test";
import { isBalanced, type PostingAmount } from "../../src/domain/ledger/balance.ts";

describe("isBalanced function", () => {
  test("returns false for empty array", () => {
    expect(isBalanced([])).toBe(false);
  });

  test("returns false if any posting has negative debit", () => {
    const postings: PostingAmount[] = [
      { debitMinorUnits: -100n, creditMinorUnits: 0n },
    ];
    expect(isBalanced(postings)).toBe(false);
  });

  test("returns false if any posting has negative credit", () => {
    const postings: PostingAmount[] = [
      { debitMinorUnits: 0n, creditMinorUnits: -100n },
    ];
    expect(isBalanced(postings)).toBe(false);
  });

  test("returns false if any posting has both debit and credit positive", () => {
    const postings: PostingAmount[] = [
      { debitMinorUnits: 100n, creditMinorUnits: 100n },
    ];
    expect(isBalanced(postings)).toBe(false);
  });

  test("returns false if any posting has both debit and credit zero", () => {
    const postings: PostingAmount[] = [
      { debitMinorUnits: 0n, creditMinorUnits: 0n },
    ];
    expect(isBalanced(postings)).toBe(false);
  });

  test("returns true for single debit posting with matching credit", () => {
    const postings: PostingAmount[] = [
      { debitMinorUnits: 100n, creditMinorUnits: 0n },
      { debitMinorUnits: 0n, creditMinorUnits: 100n },
    ];
    expect(isBalanced(postings)).toBe(true);
  });

  test("returns true for multiple postings that balance", () => {
    const postings: PostingAmount[] = [
      { debitMinorUnits: 100n, creditMinorUnits: 0n },
      { debitMinorUnits: 50n, creditMinorUnits: 0n },
      { debitMinorUnits: 0n, creditMinorUnits: 75n },
      { debitMinorUnits: 0n, creditMinorUnits: 75n },
    ];
    expect(isBalanced(postings)).toBe(true);
  });

  test("returns false for unbalanced postings", () => {
    const postings: PostingAmount[] = [
      { debitMinorUnits: 100n, creditMinorUnits: 0n },
      { debitMinorUnits: 0n, creditMinorUnits: 99n },
    ];
    expect(isBalanced(postings)).toBe(false);
  });

  test("handles large BigInt values correctly", () => {
    const largeValue = 9007199254740992n;
    const postings: PostingAmount[] = [
      { debitMinorUnits: largeValue, creditMinorUnits: 0n },
      { debitMinorUnits: 0n, creditMinorUnits: largeValue },
    ];
    expect(isBalanced(postings)).toBe(true);
  });
});

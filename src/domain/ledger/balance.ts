export type PostingAmount = {
  debitMinorUnits: bigint;
  creditMinorUnits: bigint;
};

export function isBalanced(postings: readonly PostingAmount[]): boolean {
  if (postings.length === 0) {
    return false;
  }

  let totalDebit = 0n;
  let totalCredit = 0n;

  for (const posting of postings) {
    const debit = posting.debitMinorUnits;
    const credit = posting.creditMinorUnits;

    if (debit < 0n || credit < 0n) {
      return false;
    }

    if (debit > 0n && credit > 0n) {
      return false;
    }

    if (debit === 0n && credit === 0n) {
      return false;
    }

    totalDebit += debit;
    totalCredit += credit;
  }

  return totalDebit === totalCredit;
}

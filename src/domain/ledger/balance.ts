export type PostingAmount = {
  debitMinorUnits: bigint;
  creditMinorUnits: bigint;
};

export function isBalanced(postings: readonly PostingAmount[]): boolean {
  const debit = postings.reduce((sum, posting) => sum + posting.debitMinorUnits, 0n);
  const credit = postings.reduce((sum, posting) => sum + posting.creditMinorUnits, 0n);
  return debit === credit;
}

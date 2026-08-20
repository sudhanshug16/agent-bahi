# Expense Evidence Policy

## Scope and governing rule

There is no single universal rupee threshold that makes expense evidence
optional. Evidence follows statutory rules first. A tenant-configured amount
threshold may add a stricter review or evidence workflow only where the law is
silent; it may never waive or weaken a document, voucher, retention, or GST
input-tax-credit (ITC) requirement.

This document separates legal-source facts from product decisions. Legal
behavior must be stored with jurisdiction, source, rule version, and effective
start/end dates so a later rule change does not reinterpret an old posting.

## Legal-source facts

- For a company, books of account and relevant vouchers are retained for eight
  financial years under section 128 of the Companies Act, 2013. See the
  [official Companies Act, 2013 PDF](https://www.mca.gov.in/Ministry/pdf/CompaniesAct2013.pdf).
- GST ITC is claimed on prescribed documents and applicable particulars. The
  [official CBIC input-tax-credit rules](https://cbic-gst.gov.in/input-tax-credit-rules.html)
  identify the documentary basis, while the [official CBIC tax-invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html)
  prescribe invoice particulars.
- Income-tax cash-payment disallowance is a separate payment-mode validation.
  It is not permission to omit evidence. The cash rule must be represented as
  an effective-dated, jurisdiction-scoped rule with its statutory exceptions;
  product documentation must not present one cash threshold as universal. The
  [official notified Income-tax Rules, 2026](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf)
  is the source for the 2026 rule version.

These legal-source facts are a product input, not legal advice. The engine
must retain the source URI, source title, version or notification identifier,
jurisdiction, and effective dates for each rule it applies.

## Product decisions

Expense evidence is represented independently from the expense amount. An
attachment stores document type, issuer, issuer reference, document date,
checksum, storage reference, tax eligibility, validation status, rule source,
rule version, and rule effective dates. A legally allowed exception stores a
reason, actor, authority, timestamp, scope, and expiry or review date.

GST input tax is always a separate eligibility decision. Without a valid
statutory document and applicable validation, the product may allow gross
expense booking only through an explicit evidence exception where lawful; it
must BLOCK GST ITC. The exception cannot make the missing document valid or
erase a retention obligation.

The product exposes three runtime outcomes:

- **BLOCK**: the command cannot post the affected expense or tax component
  until the statutory requirement is satisfied.
- **WARN/REASONED_EXCEPTION**: the user may proceed only where the rule source
  permits an exception, and the reasoned exception is recorded with its
  provenance and review data. This outcome never silently grants GST ITC.
- **CONFIGURED_REVIEW**: a tenant threshold or policy adds review, approval,
  or evidence requirements. It can tighten the statutory baseline but can
  never relax it.

Payment-mode checks, including cash disallowance, run separately from evidence
checks. Passing a payment-mode check does not make evidence optional, and an
evidence exception does not make a disallowed payment mode deductible.

## Runtime and audit requirements

The engine evaluates the applicable jurisdiction and effective-dated rules at
the command's relevant date, records the rule versions and evidence state, and
returns the outcome before mutation. A posted expense links its evidence,
validation result, exception (if any), tax eligibility decision, and ledger
posting. Later corrections use explicit reversal and corrected-version lineage;
they do not overwrite the evidence history.

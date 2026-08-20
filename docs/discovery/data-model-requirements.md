# Data Model Requirements

## Optional Reporting Tags/Dimensions

### Overview

Tenants can optionally define custom reporting tags (also called dimensions) to organize and filter transactions for reporting purposes. These tags provide flexible grouping and analysis capabilities without affecting core accounting mechanics.

### What Tags Are

Reporting tags are optional, tenant-scoped metadata that can be attached to transactions and document lines. Common examples include:

- **Location**: Physical branch, warehouse, or geographic region
- **Project**: Client project, internal initiative, or cost center
- **Department**: Organizational unit, team, or functional area
- **Cost Center**: Internal cost allocation group
- **Customer Segment**: Market segment, product line, or customer type

### Key Characteristics

1. **Optional**: Tags are entirely optional. Tenants with simple reporting needs require no tag setup or usage.

2. **Tenant-Scoped**: Tag definitions and values are specific to each tenant. One tenant's "Project" tags are isolated from another tenant's "Project" tags.

3. **Attachment Points**: Tags can be attached at:
   - Transaction level (applying to the entire document)
   - Document line level (applying to individual line items)
   - Both levels (tag hierarchies or filtering at multiple levels)

4. **Reporting Applications**: Tags enable:
   - Filtering revenue by location, project, or department
   - Grouping expenses by cost center or customer segment
   - Organizing profit/loss analysis by business unit or product line
   - Drill-down analytics and cross-dimensional queries

### Invariant: No Impact on Core Accounting

Tags **do not** affect:

- Account posting or ledger entries
- Debit/credit balance calculations
- Tax treatment or tax computation
- Compliance calculations (GST, TDS, TCS, withholding, etc.)
- Audit trail or document state

Tags are purely reporting metadata and remain orthogonal to the engine's accounting and compliance functions.

### Undecided Aspects

The following aspects are explicitly **not settled** and remain for future design:

- **Multi-Tag Allocation**: How (or if) to allocate a single transaction across multiple tags simultaneously (e.g., splitting an expense across projects).
- **Mandatory Tag Policies**: Whether (or when) tenants can enforce that certain documents or lines must have a tag attached.

These will be addressed when reporting and allocation workflows are defined.

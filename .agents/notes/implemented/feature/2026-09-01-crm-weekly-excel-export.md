# Agent Note: CRM weekly Excel export

Status: implemented

English | [中文](2026-09-01-crm-weekly-excel-export.zh.md)

## Problem

The CRM weekly report is inspectable in the conversation but cannot be delivered as a reusable workbook. A safe export must preserve the fixed report definitions, avoid customer identifiers, disclose unavailable sections, and provide an authenticated browser download without exposing an arbitrary filesystem or query interface.

## Decision

The CRM example adds `crm_export_weekly_excel`. It accepts only a date, retrieves the same fixed sales, lifecycle, product-series and product-SKU reports as the conversation tools, and passes their structured results to a workbook renderer. The model cannot supply cells, formulas, paths, indices, fields, ECharts options or Elasticsearch DSL.

The renderer uses the deployment-configured `@oai/artifact-tool` module. It creates a workbook with Definition, Sales Overview, Lifecycle, Traffic, Product Series, Product SKU and Recommendations sheets. Source measures are typed numeric cells. Derived comparison rates use guarded formulas so a zero or unavailable base does not produce formula errors. The workbook includes source coverage, incomplete-period markers, unavailable reasons, truncation warnings and the unresolved refund, cancellation, currency, minimum-order, repeat-purchaser and identity definitions. It contains no customer identifiers or raw source records.

A Host-owned export registry writes generated files below a deployment-configured export root using random opaque ids and fixed `.xlsx` names. It registers one authenticated `/api/crm.export` fetch route through the existing connection service. The route accepts only an opaque id, rejects traversal and unknown or expired entries, and sends the workbook with an attachment content type and disposition. Entries expire after a configured lifetime and plugin disposal removes registered files. The tool result persists only the opaque id, filename, byte count, expiration and workbook summary. The Client validates that metadata and renders a download button targeting the authenticated route.

Recommendations remain evidence-bound. The export tool accepts an optional bounded list of already-written recommendation records with observation, evidence, labeled hypothesis, action, validation metric and limitation. These strings are workbook data only and cannot affect queries, paths, formulas or layout. When no recommendations are supplied, the sheet explains that recommendations should be generated in the conversation and re-exported.

## Consequences

The CRM weekly workflow can now deliver the same fixed, source-backed report as a reusable workbook without exposing a general spreadsheet or filesystem tool. Web deployments provide an authenticated expiring download; headless deployments retain analysis tools but reject export because they have no download route. Deployment owners must provide the private artifact-tool module and a writable export directory.

## Testing

- The export tool reuses fixed weekly report acquisition and never accepts query or workbook code.
- The workbook contains auditable numeric inputs, guarded formulas, visible source limitations and no customer-level data.
- The browser downloads only registered, unexpired files through the authenticated CRM route.
- Client metadata validation rejects malformed ids, filenames, sizes and expirations.
- Tests cover workbook sections, formula guards, privacy, path confinement, expiry, route disposal, UI download behavior and the Web loader path.

## Alternatives considered

**Model-authored workbook JSON or formulas.** This would support arbitrary layouts, but it would let untrusted model output control executable spreadsheet content, paths and potentially customer-level data. The fixed renderer keeps layout and formulas in reviewed code.

**Public static files.** Serving the export directory directly would bypass the authenticated connection route and make expiry harder to enforce. The opaque registry keeps local paths private and resolves only active ids.

**Generate the workbook in the browser.** Client-side generation would duplicate report validation and move deployment-specific spreadsheet infrastructure into the Web bundle. Host generation keeps one audited implementation and returns a normal attachment.

## Risks

`@oai/artifact-tool` is private deployment infrastructure and therefore must be configured explicitly; missing or incompatible runtimes fail at export time without disabling CRM analysis. Generated workbooks capture live paginated reads rather than a point-in-time snapshot. Files occupy local disk until expiry or shutdown. Spreadsheet programs may render charts differently, so the source tables remain authoritative.

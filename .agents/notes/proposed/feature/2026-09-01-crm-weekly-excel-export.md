# Agent Note: CRM weekly Excel export

Status: proposed

English | [中文](2026-09-01-crm-weekly-excel-export.zh.md)

## Problem

The CRM weekly report is inspectable in the conversation but cannot be delivered as a reusable workbook. A safe export must preserve the fixed report definitions, avoid customer identifiers, disclose unavailable sections, and provide an authenticated browser download without exposing an arbitrary filesystem or query interface.

## Proposal

The CRM example adds `crm_export_weekly_excel`. It accepts only a date, retrieves the same fixed sales, lifecycle, product-series and product-SKU reports as the conversation tools, and passes their structured results to a workbook renderer. The model cannot supply cells, formulas, paths, indices, fields, ECharts options or Elasticsearch DSL.

The renderer uses the deployment-configured `@oai/artifact-tool` module. It creates a workbook with Definition, Sales Overview, Lifecycle, Traffic, Product Series, Product SKU and Recommendations sheets. Source measures are typed numeric cells. Derived comparison rates use guarded formulas so a zero or unavailable base does not produce formula errors. The workbook includes source coverage, incomplete-period markers, unavailable reasons, truncation warnings and the unresolved refund, cancellation, currency, minimum-order, repeat-purchaser and identity definitions. It contains no customer identifiers or raw source records.

A Host-owned export registry writes generated files below a deployment-configured export root using random opaque ids and fixed `.xlsx` names. It registers one authenticated `/api/crm.export` fetch route through the existing connection service. The route accepts only an opaque id, rejects traversal and unknown or expired entries, and sends the workbook with an attachment content type and disposition. Entries expire after a configured lifetime and plugin disposal removes registered files. The tool result persists only the opaque id, filename, byte count, expiration and workbook summary. The Client validates that metadata and renders a download button targeting the authenticated route.

Recommendations remain evidence-bound. The export tool accepts an optional bounded list of already-written recommendation records with observation, evidence, labeled hypothesis, action, validation metric and limitation. These strings are workbook data only and cannot affect queries, paths, formulas or layout. When no recommendations are supplied, the sheet explains that recommendations should be generated in the conversation and re-exported.

## Acceptance criteria

- The export tool reuses fixed weekly report acquisition and never accepts query or workbook code.
- The workbook contains auditable numeric inputs, guarded formulas, visible source limitations and no customer-level data.
- The browser downloads only registered, unexpired files through the authenticated CRM route.
- Client metadata validation rejects malformed ids, filenames, sizes and expirations.
- Tests cover workbook sections, formula guards, privacy, path confinement, expiry, route disposal, UI download behavior and the Web loader path.

## Risks

`@oai/artifact-tool` is private deployment infrastructure and therefore must be configured explicitly; missing or incompatible runtimes fail at export time without disabling CRM analysis. Generated workbooks capture live paginated reads rather than a point-in-time snapshot. Files occupy local disk until expiry or shutdown. Spreadsheet programs may render charts differently, so the source tables remain authoritative.

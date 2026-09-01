# CRM Weekly Excel Export Implementation Plan

English | [中文](2026-09-01-crm-weekly-excel-export.zh.md)

> Use the executing-plans workflow and preserve all existing CRM work.

**Goal:** Export the fixed source-backed CRM weekly report as an authenticated downloadable `.xlsx` from the current DSH Web application.

**Design:** Extend the CRM example plugin with a workbook renderer, expiring export registry, fixed export tool and authenticated connection fetch route. Extend the CRM Client card with validated export metadata and a download action.

**Reference:** [Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-crm-weekly-excel-export.md)

1. Write red tests for workbook-model projection, formula guards and identifier omission; implement `weekly-workbook.ts` with a configured artifact-tool import.
2. Write red tests for export root confinement, random ids, expiry and cleanup; implement `excel-exports.ts`.
3. Add `crm_export_weekly_excel` to `crm-tools.ts`, register `/api/crm.export`, and extend preset configuration with explicit renderer/export settings.
4. Add validated `excel` CRM metadata and a localized download button to `ui-crm`; cover malformed metadata and click behavior.
5. Update the weekly Skill, CRM guide, package README, Web mount test and keyless session snapshot.
6. Run focused unit/UI/Web tests, real Elasticsearch export, workbook inspect/error scan/render, type checks, lint, doc gates and code review; restart the CRM Web process.

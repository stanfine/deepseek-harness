# CRM MA Campaign Draft Creation Design

English | [中文](2026-09-03-crm-ma-campaign-draft-design.zh.md)

## Status

Approved in conversation; pending written-spec review before implementation planning.

## Goal

Extend the CRM marketing recommendation workflow so a user can preview a governed single-path campaign canvas and, after a second explicit confirmation, create a real but inactive MA audience and campaign draft. Draft creation never starts delivery.

## Relationship to the Recommendation Design

This design extends the [CRM marketing recommendation design](2026-09-02-crm-marketing-recommendations-design.md). It replaces that design's prohibition on marketing-platform writes only for the explicit `crm_campaign_create_draft` operation defined here. Recommendation evaluation and campaign-plan generation remain aggregate-only and read-only.

## Deployment Scope

The deployment uses `tenantId=mkt`, `buCode=catering`, and `collectionId=mkt_catering_loyalty`. MA owns the first execution path's audience, so CDP does not create or snapshot that audience. MA creates the audience and inactive campaign draft. LOYALTY supplies allowlisted coupon-template metadata and aggregate fulfillment results; draft creation never issues a coupon.

The first release excludes approval submission, campaign start, pause, resume, stop, direct message delivery, direct coupon issuance, arbitrary canvas editing, customer export, and automatic cleanup.

## Architecture

MA and LOYALTY each use a complete Service Definition, Provider, and Consumer capability seam. Providers own HTTP protocol details, credentials, timeouts, response limits, remote error conversion, and deployment configuration. Consumers expose closed business operations to the CRM plugin instead of raw HTTP requests.

The MA provider reads governed catalogs, estimates audiences, validates and predicts canvases, creates audiences, creates inactive campaign drafts, and reads campaign and reach status. The LOYALTY provider reads allowlisted coupon templates and aggregate participation, receipt, and redemption results. Neither provider returns customer records to the model.

Endpoints and credentials are deployment-owned. A deployment without authentication must set `allowUnauthenticated: true`; otherwise missing credentials fail provider configuration.

## Governed Audience Creation

Each marketing opportunity references one configured audience policy. A policy allowlists MA tags or fields, operators, evidence-to-value mappings, mandatory exclusions, maximum estimated size, and permitted actions. Deterministic code resolves the policy from persisted recommendation evidence.

The model cannot provide an MA expression, arbitrary field, operator, tag, customer id, or complete `AudienceInfo` body. Provider code converts the resolved policy into the MA protocol. Missing conditions or an excessive estimated audience make the plan unavailable for creation.

The preview contains only aggregate counts and bounded distributions. The first execution path does not create a CDP snapshot, export an audience, or retrieve MA audience members.

## Governed Single-Path Canvas

The canvas contains one MA audience entry, at most one configured condition, one action, and one end node. The action is either one approved MA delivery template or one approved LOYALTY coupon template referenced through an allowlisted MA benefit capability.

Configuration owns node types, connectors, capability ids, template ids, variable schemas, and permitted date behavior. The model selects only logical allowlist ids and bounded user-visible values. Code generates all nodes and edges; the model and user cannot submit canvas JSON.

The planner validates the referenced catalogs, calls MA canvas validation, and runs MA prediction before it marks the plan ready. Any failed validation, unavailable template, invalid date, audience-limit violation, or prediction error keeps the plan unavailable with a concrete reason.

## Explicit Draft Creation

`crm_campaign_plan` persists the preview and an opaque plan id without external writes. A localized `Create campaign draft` button prepares a visible confirmation request but never submits it. The user must submit that request before the agent can call `crm_campaign_create_draft`.

`crm_campaign_create_draft` accepts only a current-session plan id and an explicit confirmation value. It rejects evidence, audience rules, fields, tags, templates, canvas nodes, endpoints, and provider bodies supplied by the model. The host approval mechanism guards the external write.

The operation revalidates the plan, audience estimate, catalogs, canvas validation, and prediction. It then creates or reuses the MA audience and creates an inactive MA campaign draft. The result contains only the external audience id, campaign id, inactive status, safe lookup metadata, and bounded warnings.

## Idempotency and Partial Failure

The idempotency key is a digest of the tenant, recommendation id, plan version, audience-policy digest, selected action template, and campaign dates. Session events retain the key, resolved-input digest, MA audience id, MA campaign id, operation state, and bounded failure details.

A completed match returns its recorded result. If audience creation succeeds and campaign creation fails, a retry reuses the recorded audience. An ambiguous timeout requires lookup by an external business key before retry; when the provider cannot resolve that key, the operation reports manual reconciliation instead of repeating the write.

Conflicting records for one key fail closed. The system does not automatically delete an external audience because deletion is a separate destructive operation.

## Result Collection

Read-only tools resolve recorded campaign ids and combine MA campaign status, flow status, and reach summaries with aggregate LOYALTY participation and coupon results. CRM order metrics provide the conversion outcome only when a configured attribution window and campaign reference exist.

The report retains periods, coverage, attribution rules, and limitations. It claims incremental effect only when a valid holdout or comparison design exists. Delivery or redemption totals alone do not prove incremental sales.

## Security and Failure Handling

Configuration errors fail at startup. Unknown or cross-session ids, arbitrary audience fields, expressions, non-allowlisted templates, malformed dates, oversized results, and customer-bearing results fail before publication. Remote errors expose a safe service, operation, status class, and correlation id without copying response bodies into model-visible output.

Credentials use the repository credential service or named environment variables and never enter model input, session events, logs, or client metadata. Providers use explicit HTTP allowance, bounded reads, configured timeouts, and separate read and write credentials where the deployment supports them.

## Testing

Provider tests use local HTTP fixtures and assert exact protocol without real writes. Configuration tests reject arbitrary fields, expressions, nodes, templates, credentials, and implicit unauthenticated access. Unit tests cover audience policies, canvas generation, idempotency, ambiguous writes, partial failures, and current-session resolution.

Tool and client tests cover approval, result limits, event persistence, replay, localized confirmation, fallback rendering, and accessibility. Web composition and keyless snapshots pin the model-visible flow. Real-environment acceptance creates one clearly named inactive MA audience and campaign draft only after the user confirms the final preview, and records ids for manual cleanup.

## Documentation

The CRM guide will explain governed audience rules, canvas previews, explicit draft creation, inactive status, recovery, and result interpretation. Provider package READMEs will document configuration, authentication, protocol ownership, errors, idempotency support, and external-system limitations. An implemented Agent Note will own the separation between evidence, plan preview, explicit external write, and delivery execution.

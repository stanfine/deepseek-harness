# CRM Marketing Recommendations Design

English | [中文](2026-09-02-crm-marketing-recommendations-design.zh.md)

## Status

Approved in conversation; pending written-spec review before implementation planning.

## Goal

Extend the opt-in CRM example so a user can analyze aggregate data, receive up to three source-backed marketing opportunities, select one opportunity from a card, and generate a draft campaign plan with an aggregate audience preview. The first implementation never exports customer records, publishes a campaign, or writes to a marketing platform.

## Scope

The first implementation supports the existing CRM semantic catalog, analysis executor, Web preset, and persisted CRM cards. It adds configured opportunity types, deterministic candidate rules, model-assisted explanations, recommendation cards, draft campaign plans, and aggregate audience previews. Customer identity export, message content generation, approval workflows, budgets, delivery connectors, audience materialization, writeback, scheduling, attribution, and automatic execution remain outside this implementation.

## User Flow

The user first requests an analysis through the existing CRM tools. The user then asks for marketing recommendations for a defined period and comparison. The system evaluates configured opportunity types with fresh semantic queries, returns no more than three evidence-backed recommendations, and explains unavailable types. A recommendation card button writes a localized campaign-plan request into the input draft. The system creates a draft plan only after the user submits that request.

## Design Principles

The recommendation engine treats analysis as evidence rather than permission to act. Deployment configuration owns every opportunity type, required metric, dimension, threshold, activity mechanism, primary metric, guardrail metric, and permitted audience condition. Deterministic code decides whether a candidate exists and assigns its evidence score. The model can explain and order valid candidates but cannot create a new activity type, change a threshold, submit a source field, or turn a draft into an executable campaign.

## Opportunity Catalog

The configuration defines a closed catalog of `reactivation`, `repurchase_growth`, `channel_optimization`, `store_improvement`, `atv_growth`, and `items_per_order_growth`. Each definition contains a stable id, localized name and description, required semantic metrics and dimensions, comparison kind, minimum coverage, bounded rules, supported channels or mechanisms, audience-condition ids, primary metrics, guardrail metrics, and limitations. Startup validation rejects duplicate ids, unavailable semantic dependencies, cross-dataset requirements, unsupported comparisons, invalid thresholds, unknown audience conditions, and rules that cannot produce evidence.

An opportunity is available only when its required semantic concepts are available from one logical dataset and its source coverage satisfies the configured minimum. Member reactivation and high-value repurchase remain unavailable when the deployment cannot prove recency, historical spend, consent, or customer identity requirements. The catalog reports this as a governed refusal rather than a zero opportunity.

## Recommendation Evaluation

`crm_recommend_opportunities` accepts an inclusive start date, exclusive end date, comparison kind, and an optional bounded list of opportunity ids. The schema accepts no index, physical field, formula, script, DSL, arbitrary rule, or activity type. The evaluator expands every selected opportunity into fixed semantic analysis requests, executes them through the existing planner and provider, validates coverage and completeness, applies configured rules, and retains the normalized requests as evidence references.

Each candidate receives a deterministic score from evidence strength, estimated impact, completeness, and configured risk. The evaluator returns no more than three candidates ordered by that score, with a configured title and action template plus calculated evidence fields. The model can summarize these persisted fields in its assistant response but cannot write free text into the recommendation object or introduce unsupported metrics, audience conditions, channels, or mechanisms.

## Tool Interfaces

`crm_opportunity_catalog` returns opportunity ids, business descriptions, required concepts, availability, unavailable reasons, primary metrics, guardrails, and limitations. `crm_recommend_opportunities` returns versioned recommendations and persists `{ crmRecommendations: { version: 1, request, data } }`. `crm_campaign_plan` accepts only a recommendation id that resolves to a valid persisted recommendation in the current session and persists `{ crmCampaignPlan: { version: 1, recommendationId, data } }`.

The tool owner resolves opaque recommendation ids from the session log. A caller cannot supply recommendation evidence, scores, audience counts, activity mechanisms, source requests, or plan status. This keeps model-visible inputs small and ensures every model-visible recommendation and plan can be reconstructed from recorded events.

## Recommendation Result

Each recommendation contains a stable recommendation id, configured type, deterministic priority and score, evidence records, aggregate audience conditions, estimated audience preview, suggested channel and mechanism, primary and guardrail metrics, limitations, and normalized source requests. Evidence records contain logical metric and dimension ids, current and comparison values, coverage, completeness, and unavailable reasons. They contain no physical fields, provider requests, credentials, customer ids, or customer records.

## Campaign Plan

The campaign planner converts one persisted recommendation into a `draft` plan. The plan contains the objective, evidence hypothesis, configured audience conditions, aggregate audience size and distribution preview, exclusion checklist, suggested channel and mechanism, proposed period, experiment and holdout guidance, primary metrics, guardrail metrics, limitations, risks, and an execution-readiness checklist. The first implementation exposes no state other than `draft` and no operation that publishes, approves, exports, schedules, sends, or mutates the plan.

Audience preview uses configured aggregate semantic queries. It returns counts, bounded distributions, coverage, and unavailable reasons. It never returns names, phone numbers, email addresses, customer ids, document previews, or leaf records. A condition that cannot be evaluated returns an unavailable reason and prevents the plan from claiming an executable audience.

## Client Presentation

The CRM Client validates recommendation and campaign-plan metadata as untrusted persisted JSON. It enforces versions, byte and item limits, id formats, known opportunity types, logical metric and dimension ids, evidence consistency, audience-condition allowlists, draft-only plan status, and the absence of customer records or execution fields. Invalid metadata falls back to textual tool output.

The recommendation presenter renders up to three accessible opportunity cards with priority, evidence, coverage, audience conditions, estimated scale, proposed mechanism, metrics, risks, and limitations. The `Generate campaign plan` button calls `inputActions.setDraft()` with the recommendation id and visible business context. It never submits the draft or calls a tool. The plan presenter renders the aggregate preview, experiment guidance, metric definitions, risks, and readiness checklist. Persisted metadata remains the source for replay after refresh or restart.

## Agent Behavior

The CRM persona first uses existing analysis tools to answer the user's data question. It calls the opportunity catalog and recommendation evaluator only after the user asks for marketing advice. It distinguishes observed evidence from a proposed intervention, explains unavailable opportunity types, and never claims expected uplift without an experiment. After the user selects a recommendation, it calls `crm_campaign_plan` only from the submitted draft and describes the result as preparation for human execution.

## Failure Handling

Configuration errors fail at startup. Unsupported opportunity types, invalid periods, unavailable concepts, cross-dataset requirements, excessive requests, missing persisted recommendation ids, and oversized results fail before publication. Incomplete but usable evidence produces a recommendation only when its configured rule permits partial coverage and the result preserves warnings. A required condition or aggregate audience estimate that is unavailable prevents the campaign plan from claiming readiness.

## Security and Privacy

All data access reuses the semantic allowlist, provider timeouts, response limits, date limits, credential isolation, and aggregate-only result rules. The model cannot introduce a query expression, customer identifier, delivery target, content payload, budget, executable action, or external endpoint. The first implementation adds no write credential and no connector with mutation authority. Recommendation and plan buttons prepare user-editable drafts and never perform network actions.

## Testing

Unit tests cover configuration validation, unavailable types, deterministic rule evaluation, score ordering, the three-result limit, evidence consistency, session-scoped recommendation resolution, aggregate audience previews, and draft-only plans. Runtime tests prove closed tool schemas, pre-network rejection, result-size limits, disposal, and the absence of physical or customer fields. Client tests cover persisted validation, cards, localized draft construction, replay, invalid metadata fallback, and accessibility. Loader-based Web composition and keyless snapshots pin the tools, persona, representative recommendations, plans, and persisted metadata. Browser testing verifies analysis-to-recommendation, card selection, draft confirmation, plan rendering, and restart replay without publishing an activity.

## Documentation

The CRM guide will describe the recommendations-first workflow, configured opportunity types, unavailable-data behavior, aggregate audience previews, and the boundary between a draft plan and campaign execution. The client package README will document metadata validation and card behavior. An implemented Agent Note will own the decision to separate evidence, deterministic candidate selection, model explanation, human selection, and execution.

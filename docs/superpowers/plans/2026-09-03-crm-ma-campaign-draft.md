# CRM MA Campaign Draft Implementation Plan

English | [中文](2026-09-03-crm-ma-campaign-draft.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recommendations-first CRM workflow that creates a governed MA audience and a real but inactive single-path MA campaign draft after explicit user approval.

**Architecture:** Deterministic CRM modules turn aggregate semantic evidence into recommendations, audience policies, and a generated canvas. Separate MA and LOYALTY service/provider modules own remote protocols; a session-backed coordinator provides idempotent draft creation and read-only result collection. The CRM tools and Client expose versioned, replayable projections without customer records or raw provider bodies.

**Tech Stack:** TypeScript, Cordis services and scoped tools, Schemastery, DSH credentials and approval services, native `fetch`, React, ECharts, Vitest, keyless session snapshots.

**Specs:** [Recommendation design](../specs/2026-09-02-crm-marketing-recommendations-design.md) and [MA draft creation design](../specs/2026-09-03-crm-ma-campaign-draft-design.md).

## Global Constraints

- Use deployment values `tenantId=mkt`, `buCode=catering`, and `collectionId=mkt_catering_loyalty`; model-visible schemas never expose endpoints or credentials.
- Draft creation may create an MA audience and an inactive MA campaign only. It never submits approval, starts delivery, sends a message, issues a coupon, edits the created draft, or deletes external data.
- Audience rules, MA nodes, connectors, capabilities, delivery templates, and LOYALTY coupon templates come from exact deployment allowlists. The model cannot submit expressions, fields, operators, tags, canvas JSON, or provider bodies.
- Every model-visible result is logged and replayable. External writes resolve a current-session plan id, pass `tools/pre-execute` approval, and use a deterministic idempotency key.
- Providers resolve credentials once per operation, cap response bytes, apply a configured timeout, redact remote bodies, and require explicit `allowHttp` and `allowUnauthenticated` settings.
- Results contain aggregate values and opaque external ids only; they contain no customer id, name, phone, email, audience member, or source record.
- Client metadata is untrusted JSON and falls back to text when validation fails. Product copy uses typed locale dictionaries.
- Every behavior change follows test-first RED/GREEN cycles. The final change includes an Agent Note, keyless snapshots, bilingual documentation, and a user-confirmed real-environment draft-creation test.

---

### Task 1: Complete deterministic recommendation evaluation

**Files:** Create `apps/cli/config/examples/crm/opportunity-evaluator.ts`; create `apps/cli/tests/crm-opportunity-evaluator.spec.ts`; modify `apps/cli/config/examples/crm/semantic-analysis.ts`.

**Interfaces:** Produce `evaluateOpportunities(model, request, analyze, signal): Promise<RecommendationResultV1>` where `OpportunityRequest` contains only `start`, `end`, `comparison`, and bounded `opportunityIds`; `RecommendationResultV1` contains at most three deterministic aggregate recommendations.

- [ ] Write failing tests for closed request validation, fixed analysis expansion, missing values, coverage, thresholds, scoring, tie order, three-result cap, evidence retention, and absence of provider or customer fields.
- [ ] Run `pnpm exec vitest run apps/cli/tests/crm-opportunity-evaluator.spec.ts` and confirm the assertions fail because scoring, evidence, and ids are incomplete.
- [ ] Implement evidence extraction and deterministic scoring; derive `recommendationId` as `rec_` plus base64url SHA-256 over version, opportunity id, normalized request, and evidence.
- [ ] Enforce one-dataset requests, known returned metric ids, bounded rows, complete serialized-result budget, and missing-data refusal.
- [ ] Run `pnpm exec vitest run apps/cli/tests/crm-opportunity-evaluator.spec.ts apps/cli/tests/crm-semantic-analysis.spec.ts apps/cli/tests/crm-analysis-planner.spec.ts`, targeted Oxlint, and `git diff --check`; commit `feat(crm): evaluate marketing opportunities`.

```text
export type AnalyzeOpportunity = (request: AnalysisRequest, signal: AbortSignal) => Promise<SemanticAnalysisResultV1>
export function evaluateOpportunities(model: MarketingModel, request: OpportunityRequest, analyze: AnalyzeOpportunity, signal: AbortSignal): Promise<RecommendationResultV1>
```

### Task 2: Build session-backed campaign plans

**Files:** Create `apps/cli/config/examples/crm/campaign-planner.ts`; create `apps/cli/tests/crm-campaign-planner.spec.ts`.

**Interfaces:** Produce `findRecommendation(session, recommendationId)` and `createCampaignPlan(model, recommendation, analyze, signal): Promise<CampaignPlanResultV1>`; the result has an opaque `planId`, `status: 'preview'`, aggregate audience preview, logical action choices, dates, metrics, and readiness reasons.

- [ ] Write failing tests using real committed `tool/result` events for valid lookup, missing and cross-session ids, malformed metadata, digest mismatch, conflicts, aggregate previews, and unavailable conditions.
- [ ] Run the planner test and confirm RED for the missing planner behavior.
- [ ] Implement fail-closed event scanning and deterministic plan ids; never use an in-memory recommendation registry.
- [ ] Expand only configured aggregate audience conditions and preserve coverage, warnings, exclusions, holdout guidance, primary metrics, guardrails, and limitations.
- [ ] Run planner and session tests, targeted Oxlint, and `git diff --check`; commit `feat(crm): prepare governed campaign plans`.

```text
export interface CampaignPlanResultV1 { version: 1; planId: string; recommendationId: string; status: 'preview'; readyForCreation: boolean; readinessReasons: readonly string[] }
```

### Task 3: Add the MA service and HTTP provider

**Files:** Create `apps/cli/config/examples/crm/ma-service.ts`; create `apps/cli/config/examples/crm/ma-http-provider.ts`; create `apps/cli/tests/crm-ma-provider.spec.ts`; modify `apps/cli/config/examples/crm/cordis.yml`.

**Interfaces:** Register `ctx.crmMa` with catalog reads, `countAudience`, `validateCanvas`, `predictCanvas`, `createAudience`, `findAudienceByBusinessKey`, `createCampaignDraft`, `findCampaignByBusinessKey`, `campaignStatus`, and `reachSummary`. All requests use resolved logical specs, not raw bodies.

- [ ] Write failing local-server tests for exact paths under `/api/ma-manage/{tenantId}/{buCode}`, method and body mapping, response limits, timeout, abort, non-2xx redaction, HTTP policy, authentication resolution, and explicit unauthenticated mode.
- [ ] Run `pnpm exec vitest run apps/cli/tests/crm-ma-provider.spec.ts` and confirm RED for missing service/provider modules.
- [ ] Implement the Cordis service contract and provider with per-operation credential resolution, bounded JSON reads, safe errors, and branded external ids.
- [ ] Add explicit provider configuration for the MA endpoint and `mkt/catering`; keep write methods inaccessible through generic web fetch.
- [ ] Run the provider test, targeted Oxlint, and `git diff --check`; commit `feat(crm): add MA campaign provider`.

```text
export abstract class CrmMaService extends Service { abstract createAudience(spec: ResolvedMaAudience, key: string, signal: AbortSignal): Promise<MaAudienceRef>; abstract createCampaignDraft(spec: ResolvedMaCampaign, key: string, signal: AbortSignal): Promise<MaCampaignRef> }
```

### Task 4: Add the LOYALTY read provider

**Files:** Create `apps/cli/config/examples/crm/loyalty-service.ts`; create `apps/cli/config/examples/crm/loyalty-http-provider.ts`; create `apps/cli/tests/crm-loyalty-provider.spec.ts`; modify `apps/cli/config/examples/crm/cordis.yml`.

**Interfaces:** Register `ctx.crmLoyalty` with `couponTemplate`, `activitySummary`, `participationSummary`, and `couponSummary`; no method creates an activity, issues a coupon, or returns a member.

- [ ] Write failing HTTP fixture tests for allowlisted coupon lookup, aggregate participation and redemption mapping, response limits, timeout, authentication, redacted errors, and rejection of customer-bearing responses.
- [ ] Confirm RED, then implement the read-only service and provider using branded template ids and aggregate result types.
- [ ] Configure the LOYALTY endpoint and `mkt/catering`; reject an allowlisted template whose returned identity or status differs from configuration.
- [ ] Run provider tests, targeted Oxlint, and `git diff --check`; commit `feat(crm): add LOYALTY campaign reads`.

```text
export abstract class CrmLoyaltyService extends Service { abstract couponTemplate(id: LoyaltyCouponTemplateId, signal: AbortSignal): Promise<LoyaltyCouponTemplate>; abstract couponSummary(request: LoyaltySummaryRequest, signal: AbortSignal): Promise<LoyaltyCouponSummary> }
```

### Task 5: Resolve governed MA audiences and canvases

**Files:** Create `apps/cli/config/examples/crm/audience-policy.ts`; create `apps/cli/config/examples/crm/campaign-canvas.ts`; create `apps/cli/tests/crm-audience-policy.spec.ts`; create `apps/cli/tests/crm-campaign-canvas.spec.ts`; modify `apps/cli/config/examples/crm/marketing-model.ts` and the CRM preset.

**Interfaces:** Produce `resolveAudiencePolicy(config, marketingModel)`, `buildMaAudience(policy, recommendation)`, and `buildSinglePathCanvas(config, plan, action)`; outputs are immutable resolved protocol-independent values.

- [ ] Write failing tests for exact configuration keys, known opportunity ids, allowlisted tags and fields, closed operators, evidence-to-value mappings, mandatory exclusions, audience caps, approved delivery templates, approved coupon templates, and exact entry/condition/action/end topology.
- [ ] Confirm RED, then implement immutable policy resolution and deterministic audience conditions without MA expressions.
- [ ] Implement canvas generation with stable node ids and exactly one action; validate MA delivery and LOYALTY coupon actions against their separate allowlists.
- [ ] Add explicit example mappings for executable opportunities; keep member opportunities unavailable until their required concepts and mappings exist.
- [ ] Run both new suites plus marketing-model tests, targeted Oxlint, and `git diff --check`; commit `feat(crm): generate governed MA campaigns`.

```text
export type CampaignAction = { kind: 'ma_delivery'; templateId: string } | { kind: 'loyalty_coupon'; templateId: string; capabilityId: string }
export function buildSinglePathCanvas(config: CanvasConfig, plan: CampaignPlanResultV1, action: CampaignAction): ResolvedMaCanvas
```

### Task 6: Implement idempotent draft creation

**Files:** Create `packages/examples/crm-campaign/src/index.ts` and its package scaffold; create `apps/cli/config/examples/crm/campaign-draft-creator.ts`; create package and CLI creator tests; regenerate `packages/core/session/src/known-event-types.ts` and the persistence catalog; update TypeScript and Python SDK expected projections required by the session vocabulary.

**Interfaces:** Produce `findCampaignPlan(session, planId)` and `createCampaignDraft(session, services, plan, signal): Promise<CampaignDraftResultV1>`; append versioned progress events before and after each remote write.

- [ ] Write failing tests for current-session lookup, deterministic idempotency keys, completed replay, audience reuse after campaign failure, ambiguous timeout lookup, unsupported reconciliation, conflicting records, cancellation, and bounded safe errors.
- [ ] Confirm RED, then define required-on-read session events for started, audience-created, campaign-created, and failed states in the CRM example package; run `pnpm run gen-persistence-catalog` and update both SDK projections in the same change.
- [ ] Implement the coordinator so it revalidates catalogs, audience count, canvas validation, and prediction before writes, and never compensates with deletion.
- [ ] Enforce lookup by external business key before retrying an ambiguous write; return manual reconciliation when lookup is unavailable.
- [ ] Run creator, session, SDK expected-output, and focused snapshot tests; commit `feat(crm): create idempotent MA campaign drafts`.

```text
export interface CampaignDraftResultV1 { version: 1; planId: string; idempotencyKey: string; audienceId: string; campaignId: string; status: 'inactive'; created: boolean; warnings: readonly string[] }
```

### Task 7: Register closed tools and approval policy

**Files:** Modify `apps/cli/config/examples/crm/crm-tools.ts`; create `apps/cli/tests/crm-marketing-tools.spec.ts`; modify `apps/web/tests/crm-preset.e2e.ts` and the CRM persona.

**Interfaces:** Register `crm_opportunity_catalog`, `crm_recommend_opportunities`, `crm_campaign_plan`, `crm_campaign_create_draft`, `crm_campaign_status`, and `crm_campaign_results`. Persist versioned presentation metadata for every result.

- [ ] Write failing actual ToolRuntime tests for exact schemas, lifecycle disposal, retained-size budgets, current-session resolution, metadata, and recursive absence of physical fields, provider bodies, customer values, approval/start/send/issue arguments.
- [ ] Add a scoped `tools/pre-execute` listener that returns `{ kind: 'ask' }` only for `crm_campaign_create_draft` and delegates with `next()` for every other tool.
- [ ] Register the tools, wire MA/LOYALTY services, and require the literal confirmation enum `['create_inactive_draft']`; keep all read tools approval-free.
- [ ] Update the persona to explain preview, external-write approval, inactive status, and refusal to start or send; extend Web composition assertions.
- [ ] Run CLI and Web focused tests, targeted Oxlint, and `git diff --check`; commit `feat(crm): expose MA campaign draft workflow`.

```text
parameters: { planId: { type: 'string', required: true }, confirmation: { type: 'string', enum: ['create_inactive_draft'], required: true } }
```

### Task 8: Validate and render campaign workflow cards

**Files:** Create `packages/client/ui-crm/src/client/campaign-model.ts`; create recommendation, plan, and draft card components under `packages/client/ui-crm/src/client/`; modify locale dictionaries and presenter registration; add corresponding tests under `packages/client/ui-crm/tests/`.

**Interfaces:** Validate untrusted `crmRecommendations`, `crmCampaignPlan`, and `crmCampaignDraft` metadata; buttons call `inputActions.setDraft()` with localized prompts and never submit.

- [ ] Write failing validator tests for versions, byte and item limits, id formats, exact keys, evidence consistency, single-path topology, inactive-only status, and rejection of customer or execution fields.
- [ ] Write failing component tests for evidence cards, audience count, canvas preview, readiness reasons, creation confirmation draft, success ids, fallback rendering, keyboard access, and Chinese/English copy.
- [ ] Implement validators and cards using existing CRM primitives; render the four-node canvas as an accessible compact flow and use ECharts only for quantitative distributions.
- [ ] Register presenters and typed locale strings; ensure replay uses persisted metadata rather than component state.
- [ ] Run all `ui-crm` tests, i18n verification, targeted Oxlint, and `git diff --check`; commit `feat(crm): render MA campaign draft cards`.

### Task 9: Collect aggregate campaign results

**Files:** Create `apps/cli/config/examples/crm/campaign-results.ts`; create `apps/cli/tests/crm-campaign-results.spec.ts`; modify CRM tools and client result cards.

**Interfaces:** Produce `collectCampaignResults(recordedDraft, attributionConfig, ma, loyalty, analyze, signal): Promise<CampaignResultsV1>` with MA status and reach totals, LOYALTY aggregate participation/redemption, CRM conversion metrics, and explicit incrementality availability.

- [ ] Write failing tests for recorded-id lookup, date windows, reach totals, coupon summaries, attribution requirements, absent holdout, source coverage, partial provider failure, and absence of customer records.
- [ ] Confirm RED, then implement read-only collection with independent source availability and no cross-source customer join in model-visible data.
- [ ] Add result metadata validation and cards; label conversion as attributed only under configured rules and incrementality as unavailable without a holdout.
- [ ] Run result, tool, client, and semantic-analysis tests; commit `feat(crm): report aggregate campaign results`.

### Task 10: Complete docs, snapshots, and real-environment acceptance

**Files:** Modify CRM user-guide pair, `packages/client/ui-crm/README.md` pair, CRM skills and persona snapshots; create an implemented Agent Note and its Chinese counterpart if required by its classification; update relevant snapshot fixtures.

**Interfaces:** Document the exact analysis → recommendation → preview → approval → inactive draft → results workflow and the explicit boundary before delivery.

- [ ] Add failing keyless snapshot expectations for catalog, recommendations, plan, approval request, inactive draft metadata, status, results, and refusal to start or issue.
- [ ] Update fixtures and documentation owners; record bilingual pairs and add an Agent Note for deterministic evidence, governed generation, explicit write approval, idempotency, and execution separation.
- [ ] Run focused unit and Web tests, keyless snapshots, `pnpm run test:docs`, `pnpm run doc-sync`, `pnpm run build`, targeted lint, and `git diff --check`.
- [ ] Start the CRM Web profile with read credentials and verify recommendation, plan, canvas, and approval UI without a write.
- [ ] After the user approves the final visible preview, create exactly one clearly named inactive test audience and campaign draft; verify their ids and inactive status through read APIs, record cleanup ids, and do not approve or start them.
- [ ] Commit `feat(crm): complete MA campaign draft workflow` and run the repository pre-push workflow before any requested push.

# CRM Marketing Recommendations Implementation Plan
English | [中文](2026-09-02-crm-marketing-recommendations.zh.md)
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recommendations-first CRM workflow that evaluates configured marketing opportunities from aggregate semantic evidence and produces draft campaign plans with aggregate audience previews.

**Architecture:** A closed marketing model validates opportunity definitions against the existing semantic catalog. A deterministic evaluator executes fixed semantic requests, scores no more than three candidates, and persists evidence; a campaign planner resolves one opaque recommendation id from the current session and creates a draft-only plan. Client validators and presenters render replayable cards whose buttons only prepare localized input drafts.

**Tech Stack:** TypeScript, Cordis configuration, Schemastery, existing CRM semantic planner and Elasticsearch executor, DSH session events, React, ECharts card primitives, Vitest, keyless session snapshots.

**Spec:** `docs/superpowers/specs/2026-09-02-crm-marketing-recommendations-design.md`

## Global Constraints

- The first implementation never exports customer records, publishes a campaign, writes to a marketing platform, schedules delivery, or adds a write credential.
- Model-visible schemas contain only configured business ids and bounded scalar values; they contain no index, field, formula, script, DSL, path, endpoint, arbitrary rule, or arbitrary activity type.
- Recommendation and campaign-plan results contain aggregates and logical ids only; they contain no customer id, name, phone number, email address, document preview, or leaf record.
- Deterministic code owns candidate eligibility, scores, order, configured titles, and action templates. Model prose can summarize persisted fields but cannot enter the recommendation object.
- Every model-visible value is logged and replayable. A campaign plan resolves its recommendation id from the current session and rejects cross-session or missing ids.
- Client code treats persisted metadata as untrusted JSON, enforces complete retained-size and item limits, and falls back to text on validation failure.
- Product copy uses typed locale dictionaries. English and Chinese documentation pairs update and re-record together.

---

### Task 1: Closed marketing model and opportunity catalog

**Files:**
- Create: `apps/cli/config/examples/crm/marketing-model.ts`
- Create: `apps/cli/tests/crm-marketing-model.spec.ts`
- Modify: `apps/cli/config/examples/crm/crm-tools.ts`
- Modify: `apps/cli/config/examples/crm/presets/crm/agent.cordis.yml`

**Interfaces:**
- Consumes: `SemanticModel` from `semantic-model.ts` and configured metric and dimension ids.
- Produces: `resolveMarketingModel(config, semanticModel): MarketingModel`, `MarketingModel.opportunityCatalog()`, `MarketingModel.resolveOpportunity(id)`, and immutable `OpportunityDefinition` values.

- [ ] **Step 1: Write failing configuration tests.** Add fixtures that accept the six configured ids and reject duplicate ids, unknown metrics or dimensions, cross-dataset requirements, unsupported comparisons, unknown audience conditions, out-of-range thresholds, empty rules, and an executable member opportunity without required recency, consent, spend, or identity concepts.

```ts
expect(() => resolveMarketingModel({ opportunities: [valid, { ...valid }] }, semanticModel)).toThrow(/Duplicate opportunity id/)
expect(resolveMarketingModel(config, semanticModel).opportunityCatalog().find(item => item.id === 'reactivation'))
  .toMatchObject({ available: false, unavailableReason: expect.stringContaining('recency') })
```

- [ ] **Step 2: Run the model test and confirm RED.** Run `pnpm exec vitest run apps/cli/tests/crm-marketing-model.spec.ts`; expect failure because `marketing-model.ts` and the config section do not exist.

- [ ] **Step 3: Implement the immutable closed model.** Define discriminated rule kinds such as `decline`, `growth`, `above_average`, and `below_average`; require exact keys per kind; validate finite bounded thresholds and one-dataset dependencies; resolve unsupported member opportunities as unavailable rather than deleting them.

```ts
export interface MarketingModel {
  opportunityCatalog(): readonly OpportunityCatalogItem[]
  resolveOpportunity(id: string): OpportunityDefinition
}
export function resolveMarketingModel(config: MarketingConfig, semantic: SemanticModel): MarketingModel
```

- [ ] **Step 4: Add explicit preset configuration.** Configure all six opportunity ids. Make channel, store, ATV, and items-per-order opportunities executable from the current `orders` dataset; keep reactivation and repurchase unavailable with concrete missing-concept reasons.

- [ ] **Step 5: Run focused tests and commit.** Run the new model test, existing semantic-model tests, targeted Oxlint, and `git diff --check`; commit `feat(crm): define governed marketing opportunities`.

---

### Task 2: Deterministic opportunity evaluator

**Files:**
- Create: `apps/cli/config/examples/crm/opportunity-evaluator.ts`
- Create: `apps/cli/tests/crm-opportunity-evaluator.spec.ts`
- Modify: `apps/cli/config/examples/crm/semantic-analysis.ts`

**Interfaces:**
- Consumes: `MarketingModel`, `resolveAnalysisPlan`, `executeSemanticAnalysis`, and `OpportunityRequest { start, end, comparison, opportunityIds? }`.
- Produces: `evaluateOpportunities(model, request, analyze, signal): Promise<RecommendationResultV1>` with at most three deterministic `RecommendationV1` records.

- [ ] **Step 1: Write failing evaluator tests.** Cover closed request validation, fixed request expansion, unavailable types, incomplete coverage, rule thresholds, deterministic scores, stable ordering, ties by opportunity id, maximum three results, source-request retention, and absence of provider fields or customer values.

```ts
const result = await evaluateOpportunities(model, request, analyzeFixture, signal)
expect(result.recommendations).toHaveLength(3)
expect(result.recommendations.map(item => item.score)).toEqual([...result.recommendations.map(item => item.score)].sort((a, b) => b - a))
expect(JSON.stringify(result)).not.toMatch(/index|field|customerId|dsl|script/)
```

- [ ] **Step 2: Run the evaluator test and confirm RED.** Run `pnpm exec vitest run apps/cli/tests/crm-opportunity-evaluator.spec.ts`; expect the missing evaluator failure.

- [ ] **Step 3: Implement fixed analysis expansion and evidence extraction.** Construct requests only from resolved definitions. Reuse the existing planner and executor callback, require configured comparison coverage, and copy logical metric values, coverage, completeness, warnings, and normalized requests into bounded evidence records.

```ts
export interface OpportunityRequest {
  start: string
  end: string
  comparison: 'previous_period' | 'prior_year'
  opportunityIds?: string[]
}
export type RecommendationEvidence = Pick<SemanticAnalysisResultV1,
  'request' | 'columns' | 'rows' | 'coverage' | 'completeness' | 'warnings'>
export interface AggregateAudienceCondition {
  id: string
  label: string
  available: boolean
  estimatedCount: number | null
  unavailableReason?: string
  limitations: readonly string[]
}
export interface AggregateAudiencePreview {
  count: number | null
  distributions: readonly { dimension: string; rows: readonly { value: string; count: number }[] }[]
  unavailableReason?: string
}
export interface UnavailableOpportunity { opportunityId: string; reason: string }
export interface RecommendationV1 {
  recommendationId: string
  opportunityId: string
  score: number
  priority: 1 | 2 | 3
  title: string
  actionTemplate: string
  evidence: readonly RecommendationEvidence[]
  audienceConditions: readonly AggregateAudienceCondition[]
  estimatedAudience: AggregateAudiencePreview
  primaryMetrics: readonly string[]
  guardrailMetrics: readonly string[]
  limitations: readonly string[]
}
export interface RecommendationResultV1 {
  version: 1
  request: OpportunityRequest
  recommendations: readonly RecommendationV1[]
  unavailable: readonly UnavailableOpportunity[]
}
export type AnalyzeOpportunity = (request: AnalysisRequest, signal: AbortSignal) => Promise<SemanticAnalysisResultV1>
export function evaluateOpportunities(
  model: MarketingModel, request: OpportunityRequest, analyze: AnalyzeOpportunity, signal: AbortSignal,
): Promise<RecommendationResultV1>
```

- [ ] **Step 4: Implement deterministic scoring and ids.** Calculate scores from configured impact weight, evidence magnitude, completeness penalty, and risk weight. Derive `recommendationId` as `rec_` plus a base64url SHA-256 digest of the canonical version, opportunity id, normalized request, and evidence; never include provider or customer data.

- [ ] **Step 5: Enforce result limits.** Reject oversized complete results, excessive evidence rows, unknown returned metric ids, unavailable required operands, and a rule that would treat missing data as zero.

- [ ] **Step 6: Run evaluator, semantic executor, and planner tests; commit.** Run `pnpm exec vitest run apps/cli/tests/crm-opportunity-evaluator.spec.ts apps/cli/tests/crm-semantic-analysis.spec.ts apps/cli/tests/crm-analysis-planner.spec.ts`; commit `feat(crm): evaluate evidence-backed marketing opportunities`.

---

### Task 3: Session-scoped draft campaign planner

**Files:**
- Create: `apps/cli/config/examples/crm/campaign-planner.ts`
- Create: `apps/cli/tests/crm-campaign-planner.spec.ts`
- Modify: `apps/cli/tests/crm-tools.spec.ts`

**Interfaces:**
- Consumes: persisted `crmRecommendations` metadata from the current `Agent.session.events`, `MarketingModel`, and the aggregate semantic-analysis callback.
- Produces: `findRecommendation(session, recommendationId): RecommendationV1` and `createCampaignPlan(model, recommendation, analyze, signal): Promise<CampaignPlanResultV1>`.

- [ ] **Step 1: Write failing session-resolution tests.** Build real tool-call and tool-result session events. Accept one valid current-session id and reject a missing id, a cross-session id, malformed metadata, duplicate conflicting ids, oversized metadata, and an id whose digest does not match its evidence.

```ts
expect(findRecommendation(session, validId).recommendationId).toBe(validId)
expect(() => findRecommendation(otherSession, validId)).toThrow(/current session/)
```

- [ ] **Step 2: Write failing plan tests.** Cover `draft` as the only status, configured objective and mechanism, aggregate audience count and bounded distributions, unavailable conditions, exclusions, holdout guidance, primary and guardrail metrics, readiness checks, and the absence of export, publish, send, schedule, budget, endpoint, content, and customer fields.

- [ ] **Step 3: Run the planner test and confirm RED.** Run `pnpm exec vitest run apps/cli/tests/crm-campaign-planner.spec.ts`; expect missing planner functions.

- [ ] **Step 4: Implement fail-closed event scanning.** Scan only committed `tool/result` events for `crm_recommend_opportunities`, validate the full versioned projection, verify the digest, and select exactly one matching recommendation. Do not maintain an in-memory registry that would disappear on restart.

- [ ] **Step 5: Implement aggregate audience preview.** Expand only configured audience conditions into semantic requests, return counts and bounded distributions, and set `readyForHumanExecution: false` when any required condition or estimate is unavailable.

```ts
export interface CampaignPlanResultV1 {
  version: 1
  recommendationId: string
  status: 'draft'
  audiencePreview: AggregateAudiencePreview
  readyForHumanExecution: false
}
```

- [ ] **Step 6: Run campaign, tools, and session fixture tests; commit.** Run `pnpm exec vitest run apps/cli/tests/crm-campaign-planner.spec.ts apps/cli/tests/crm-tools.spec.ts`; commit `feat(crm): prepare draft campaign plans`.

---

### Task 4: Register closed recommendation and plan tools

**Files:**
- Modify: `apps/cli/config/examples/crm/crm-tools.ts`
- Modify: `apps/cli/tests/crm-elasticsearch.spec.ts`
- Modify: `apps/web/tests/crm-preset.e2e.ts`

**Interfaces:**
- Produces tools `crm_opportunity_catalog`, `crm_recommend_opportunities`, and `crm_campaign_plan`.
- Persists `{ crmRecommendations: { version: 1, request, data } }` and `{ crmCampaignPlan: { version: 1, recommendationId, data } }`.

- [ ] **Step 1: Extend actual ToolRuntime tests and confirm RED.** Assert all three tools are absent before implementation, then specify exact closed schemas. Recursively reject names `index`, `field`, `formula`, `script`, `dsl`, `path`, `endpoint`, `customer`, `publish`, `send`, and `export` from model-visible parameters and results.

- [ ] **Step 2: Add execution and lifecycle tests.** Execute catalog, recommendations, and a plan through the actual registry. Assert pre-network rejection, session-scoped id lookup, retained-size enforcement over final `{ content, meta }`, correct metadata, and removal of all three tools after disposal.

- [ ] **Step 3: Implement tool registrations.** Obtain `exec.agent.session` at the campaign-plan orchestration entry, keep session ownership explicit, reuse the semantic executor callback, and apply the lower of deployment and one-MiB retained-result budgets.

```ts
async execute(args, exec) {
  const recommendation = findRecommendation(exec.agent.session, args.recommendationId)
  return json(await createCampaignPlan(marketingModel, recommendation, analyze, exec.signal))
}
```

- [ ] **Step 4: Extend real Web composition.** Assert tool registration, absence of coding or write tools, one unavailable member opportunity, one executable channel opportunity, versioned recommendation metadata, current-session plan resolution, and no customer fields.

- [ ] **Step 5: Run CLI and Web tests; commit.** Run `pnpm exec vitest run apps/cli/tests/crm-marketing-model.spec.ts apps/cli/tests/crm-opportunity-evaluator.spec.ts apps/cli/tests/crm-campaign-planner.spec.ts apps/cli/tests/crm-elasticsearch.spec.ts` and `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/crm-preset.e2e.ts`; commit `feat(crm): expose marketing recommendation tools`.

---

### Task 5: Persisted recommendation and plan validation

**Files:**
- Create: `packages/client/ui-crm/src/client/marketing-model.ts`
- Create: `packages/client/ui-crm/tests/crm-marketing-model.client.spec.ts`
- Modify: `packages/client/ui-crm/src/client/locales.ts`

**Interfaces:**
- Produces `readRecommendations(meta): RecommendationReport | null`, `readCampaignPlan(meta): CampaignPlanReport | null`, and `campaignPlanDraft(recommendation, labels): string`.
- Consumes persisted JSON only; it has no Cordis context, source field mapping, or provider request.

- [ ] **Step 1: Write validator tests and confirm RED.** Accept representative available and unavailable recommendations plus one draft plan. Reject wrong versions, extra keys, duplicate ids, unstable order, more than three recommendations, invalid scores, unknown logical ids, evidence/request mismatch, unbounded strings or arrays, customer-like keys, execution fields, non-draft status, malformed audience previews, digest mismatch, and oversized UTF-8 projections.

```ts
expect(readRecommendations(validMeta)?.recommendations).toHaveLength(2)
expect(readRecommendations({ ...validMeta, customerId: 'x' })).toBeNull()
expect(readCampaignPlan({ ...validPlanMeta, status: 'published' })).toBeNull()
```

- [ ] **Step 2: Write localized draft tests.** Verify the draft includes recommendation id, configured title, period, evidence metrics, audience conditions, and an explicit request for a draft plan; verify it contains no provider field, customer id, publish command, or automatic submission instruction.

- [ ] **Step 3: Implement exact-key, size, and cross-field validation.** Reuse the existing local helpers only where their contracts match. Validate recommendation ids by recomputing the documented digest, require score ordering, bind plan metrics and conditions to the selected recommendation, and preserve all limitations.

- [ ] **Step 4: Add typed locale strings.** Add card headings, unavailable labels, aggregate-audience labels, experiment guidance, draft action text, readiness text, and textual-fallback accessibility labels in both locales.

- [ ] **Step 5: Run all ui-crm tests and typecheck; commit.** Run `pnpm exec vitest run packages/client/ui-crm/tests` and `pnpm run typecheck`; commit `feat(crm): validate marketing recommendation metadata`.

---

### Task 6: Recommendation and campaign-plan cards

**Files:**
- Create: `packages/client/ui-crm/src/client/CrmRecommendationsRow.tsx`
- Create: `packages/client/ui-crm/src/client/CrmCampaignPlanRow.tsx`
- Create: `packages/client/ui-crm/tests/crm-recommendations-row.client.spec.tsx`
- Create: `packages/client/ui-crm/tests/crm-campaign-plan-row.client.spec.tsx`
- Modify: `packages/client/ui-crm/src/client/CrmRow.module.css`
- Modify: `packages/client/ui-crm/src/client/index.ts`
- Modify: `packages/client/ui-crm/tests/plugin.client.spec.ts`
- Modify: `packages/client/ui-crm/README.md`
- Modify: `packages/client/ui-crm/README.zh.md`
- Modify: `packages/client/ui-crm/README.i18n.yaml`

**Interfaces:**
- Produces keyed presenters for `crm_recommend_opportunities` and `crm_campaign_plan`.
- Uses `inputActions.setDraft()` only; no card action submits input or performs a network call.

- [ ] **Step 1: Write recommendation-card tests and confirm RED.** Render three candidates and assert priority, evidence, coverage, aggregate scale, mechanism, primary and guardrail metrics, risks, limitations, and unavailable types. Click `Generate campaign plan` and assert exactly one localized draft call with no submit call.

- [ ] **Step 2: Write plan-card tests and confirm RED.** Render objective, evidence hypothesis, aggregate count and distribution, exclusions, holdout guidance, metric definitions, risks, unavailable conditions, and readiness checklist. Assert no export, publish, send, schedule, or approval button exists.

- [ ] **Step 3: Implement memoized accessible presenters.** Validate metadata before deriving view values, use semantic lists and tables with visible values that do not require hover, preserve partial and unavailable states, and stack content for mobile portrait.

- [ ] **Step 4: Register both presenters reversibly.** Add keyed slot registrations and disposal assertions. Invalid metadata returns no CRM presenter so the existing textual tool result remains visible.

- [ ] **Step 5: Update the README pair.** Document metadata, draft-only interaction, model-visible effects, aggregate privacy, replay, and the deferred execution connector. Re-record the bilingual pair.

- [ ] **Step 6: Run Client tests and catalogs; commit.** Run `pnpm exec vitest run packages/client/ui-crm/tests`, `pnpm run gen-client-catalog`, `pnpm run verify-client-catalog`, translation pairing, targeted Oxlint, and `git diff --check`; commit `feat(crm): render marketing opportunity plans`.

---

### Task 7: Persona, snapshots, documentation, and browser acceptance

**Files:**
- Modify: `apps/cli/config/examples/crm/presets/crm/agent.cordis.yml`
- Modify: `apps/cli/config/examples/crm/skills/beauty-crm-monthly/SKILL.md`
- Modify: `snapshots/session/crm-catalog/**`
- Modify: `snapshots/session/headless.snapshot.ts`
- Modify: `docs/user/guide/crm-monthly.md`
- Modify: `docs/user/guide/crm-monthly.zh.md`
- Modify: `docs/user/guide/crm-monthly.i18n.yaml`
- Create: `.agents/notes/implemented/feature/2026-09-02-crm-marketing-recommendations.md`
- Create: `.agents/notes/implemented/feature/2026-09-02-crm-marketing-recommendations.zh.md`
- Create: `.agents/notes/implemented/feature/2026-09-02-crm-marketing-recommendations.i18n.yaml`

**Interfaces:**
- Pins the complete analysis-to-recommendation-to-plan flow and documents the boundary before activity execution.

- [ ] **Step 1: Add persona and Skill assertions.** In the real Web composition, require analysis before advice, require the opportunity catalog and evaluator only after a recommendation request, forbid uplift claims without experiments, and require `crm_campaign_plan` only after the user submits a selected recommendation draft.

- [ ] **Step 2: Extend only the `crm-catalog` keyless scenario.** Record catalog execution, one available and one unavailable opportunity, a two-card recommendation result, a selected recommendation id, a draft campaign plan, warnings, and both persisted metadata objects. Recursively assert forbidden schema keys are absent. Confirm no SDK or unrelated snapshot changes.

- [ ] **Step 3: Add the implemented Agent Note pair.** Record why deterministic eligibility and scoring precede model explanation, why ids resolve from session events, why buttons prepare drafts, alternatives rejected, privacy consequences, and the later requirements for approval and execution connectors. Audit related active notes and re-record the pair.

- [ ] **Step 4: Update the CRM guide pair.** Add the recommendations-first workflow, prompt examples, configured types, unavailable member cases, aggregate audience semantics, card selection, draft plan interpretation, and the explicit absence of export and execution. Re-record the pair.

- [ ] **Step 5: Run browser acceptance.** Start the real CRM preset without exposing credentials. Analyze a covered period, request recommendations, verify no more than three cards and one unavailable type, click one card, confirm the input draft, submit it, verify the aggregate draft plan, refresh or restart, and verify replay. Confirm the console has no new errors and no activity is published.

- [ ] **Step 6: Run focused verification.** Run all new CRM marketing tests, existing semantic and ui-crm tests, the Web composition, `pnpm run test:snapshot -- -t crm-catalog`, `pnpm run typecheck`, `pnpm run build`, `pnpm run doc-sync`, targeted Oxlint, and `git diff --check`.

- [ ] **Step 7: Apply the repository pre-push workflow and commit.** Inspect the changed scope against the verified base, report only commands run, and commit `feat(crm): add evidence-backed marketing recommendations`. Do not push without explicit user authorization.

# Agent Note: Governed CRM recommendations create inactive MA drafts

Status: implemented

English | [中文](2026-09-03-governed-crm-ma-drafts.zh.md)

## Problem

CRM reports could explain aggregate performance but could not turn a supported finding into a reviewable marketing object. Allowing a model to submit MA request bodies or canvases would let generated fields select customers and delivery behavior. Retrying a remote write after a timeout could also duplicate audiences or campaigns.

## Decision

The CRM example uses a recommendation-first workflow. Deterministic evaluators turn bounded semantic aggregates into recorded recommendations. A current-session recommendation becomes a preview plan with an aggregate audience estimate and explicit readiness reasons. Deployment configuration owns evidence mappings, mandatory exclusions, audience caps, MA node and connector ids, and action template and capability allowlists.

`crm_campaign_create_draft` accepts only a current-session plan id and the literal `create_inactive_draft`. A scoped `tools/pre-execute` listener asks for host approval at that write and delegates every read. The coordinator revalidates the audience count, creates or reconciles the audience, compiles MA `AudienceInfo` and X6 `flowData`, validates that flow, records progress events, and creates the inactive campaign with a deterministic business key. It does not call MA pre-execution. No exposed service or tool approves, starts, sends, issues benefits, edits, or deletes.

Campaign status and result tools resolve external ids from the current session. Result collection keeps MA and LOYALTY aggregate availability independent and does not expose customers or infer a cross-system join. Conversion and incrementality report explicit unavailability until deployment-owned attribution and holdout rules exist. Client cards validate persisted metadata and reject active drafts, executable fields, and customer-bearing results.

`crm_activation_catalog` reads bounded safe projections from the configured MA and CDP systems. The Agent passes selected MA group, category, and content ids to `crm_campaign_plan`. Planning derives the audience from recorded recommendation evidence and deployment-owned policy, queries the live MA catalog again, rejects missing or disabled delivery entries, requires the content's MA flow-node capability, and returns the reviewable canvas with the safe resolved values. Draft creation compiles a new MA audience and consumes only that recorded selection. CDP catalog availability does not control planning readiness, and catalog reads never return tag conditions or customer records.

The production channel opportunity uses the same order-item source that supports the covered weekly reporting period. Its governed audience estimate metric is explicit because a generic purchaser metric can belong to a different dataset. MA catalog limits apply independently to groups, categories, and content so one large kind cannot hide the others.

## Alternatives considered

- **Let the model generate MA JSON and canvas options** — this moves customer selection and execution behavior outside deployment review.
- **Create campaigns directly from narrative suggestions** — this skips the stable preview reviewed by the user and cannot prove which aggregate evidence authorized a write.
- **Retry timed-out writes without lookup** — this can duplicate external objects. The workflow uses deterministic business keys and stops for manual reconciliation when lookup is unavailable.
- **Join MA, LOYALTY, and CRM customer records in the Agent** — identity matching and attribution require governed source semantics. The result remains aggregate and source-separated.

## Consequences

The example can create a real but inactive MA draft from a reviewed CRM finding while binding the write to live MA delivery values and a configured audience policy. Durable events support replay and partial recovery, and partial result failures remain visible without leaking provider bodies. The MA catalog must expose the selected delivery entries before creation becomes ready. The adapter derives stable 22-character MA ids, accepts empty successful audience responses, supplies a configurable future campaign window, and includes the configured delivery reach field. Deployments must also supply valid MA audience fields, attribution, and holdout definitions before the corresponding operations can succeed.

---
description: "Persisted progress events for governed CRM campaign-draft creation and safe retry."
kind: "package-reference"
---

# @deepseek-ai/dsh-crm-campaign

English | [中文](README.zh.md)

## Summary

`dsh-crm-campaign` owns the persisted event vocabulary for governed CRM campaign-draft creation. It records opaque ids, deterministic operation keys, progress, and bounded failure codes without provider bodies, credentials, customer records, or audience members.

## Table of Contents

- [Use this package](#use-this-package)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Import the package before appending CRM campaign events. Append `draft-started` before writes, `audience-created` after MA resolves an audience, and `draft-created` only after MA returns an inactive campaign. Use `draft-failed` for safe retry and manual reconciliation without automatic deletion.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The persistence catalog generator reads the declaration merge in `src/index.ts`; regenerate the catalog whenever this vocabulary changes.

</details>

<a id="model-experience"></a>
## Model Experience

### Campaign draft progress events

#### What the model sees

Nothing directly. The `crm-campaign/*` events are log-only; CRM tools separately project bounded validated results, while replay uses the events to prevent repeated external writes.

#### Token effect

None. The events do not enter derived model history.

#### KV Cache effect

No direct effect; the events are excluded from derived model history.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The package records draft creation only. It has no events for approval, campaign start, delivery, coupon issuance, customer export, or deletion.

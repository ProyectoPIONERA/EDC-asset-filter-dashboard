# DataDashboard Customizations

This file tracks the dashboard changes made in this workspace (compared to upstream DataDashboard defaults).

## UI routes and pages

- Added `ML Assets` route: `/ml-assets`
- Added `Model Execution` route: `/model-execution`
- Added `Model Benchmarking` route: `/model-benchmarking`
- Added `Model Observer` route: `/model-observer`
- Added menu entries in `DataDashboard/public/config/app-config.json`

## ML Assets page

- Implemented merged asset view:
  - external assets from filter extension
  - local assets from management API
- Added server-driven and client-side filters (tasks, libraries, frameworks, formats, source)
- Added Catalog-style connector selection and manual catalog request
- Added `View Details` modal with compacted and expanded JSON-LD rendering
- Added local asset actions in ML cards using the same icon/button pattern as `Assets`:
  - details (`info`)
  - edit (`edit`)
  - delete (`delete`)
- Local edit/delete in ML page reuses dashboard-core assets components/services for consistency:
  - `AssetCreateComponent`
  - `AssetService`
  - `DeleteConfirmComponent`
  - `AssetCardComponent`

## Local assets page (`Assets`)

- Kept default asset create/edit flow and added optional ML metadata helper fields.
- Helper maps metadata to Daimo properties (`daimo:*`) without removing generic property editing.
- Asset search now matches Daimo metadata values to locate local model assets faster.
- Added input contract authoring fields in ML helper:
  - schema draft
  - JSON Schema input contract
  - input example JSON
  - interactive field builder for schema generation
  - quick templates with prefilled schema + examples
  - auto-derived `daimo:input_features` from schema

## Negotiation flow in ML Assets

- Reused Catalog negotiation UX pattern for ML Assets:
  - negotiation form modal with offer selection
  - negotiation progress stepper modal
- Added gating on action buttons:
  - no negotiation for local assets
  - no negotiation when agreement already exists
  - no negotiation while another negotiation is in progress
- Terminal negotiation states update the ML asset card state

## Extension integration

- Filter endpoint: `POST {defaultUrl}/api/filter/catalog`
- Infer endpoint: `POST {defaultUrl}/api/infer`
- Model observer endpoint: `{defaultUrl}/api/model-observer`
- Catalog-query evidence is logged as `CATALOG_QUERY_COMPLETED`, not as asset lifecycle evidence.
- Management fallback for external catalog when filtered response is empty:
  - `POST {managementUrl}/v3/catalog/request`

## Model Benchmarking page

- Added benchmark page to compare multiple executable assets on one dataset.
- Dataset upload supports `.json`, `.jsonl`, `.csv`.
- Execution loop reuses infer endpoint (`/api/infer`) and model execution service.
- Added schema validation gate before execution:
  - each model must have input schema metadata
  - selected models must be schema-compatible
  - dataset rows must satisfy required fields/type checks
- Added optional payload/label mapping:
  - input path
  - expected path
  - prediction path
- Added metrics and ranking:
  - success rate
  - average and p95 latency
  - throughput
  - optional accuracy
  - score-based ranking and top model summary
- Added CSV export of benchmark results.
- Benchmark completion/failure is posted to the model observer journal.

## Model Observer page

- Added model lifecycle evidence browser with views for:
  - event ledger
  - asset timeline
  - agreement evidence
  - benchmark history
  - participant summaries
- Added dashboard service for `/api/model-observer` and connector-context URL resolution.
- Asset, policy, contract-definition, negotiation, and transfer lifecycle evidence is captured by
  the connector-side EDC event-router observer, so lifecycle facts are not limited to DataDashboard.

## Policy compatibility patch (dashboard-core)

- Patched `DataDashboard/projects/dashboard-core/catalog/src/catalog.service.ts`
- `getOfferMap(...)` keeps offer policies as-is and injects only missing mandatory fields:
  - `@context`
  - `assigner`
  - `target`

This avoids provider-side strict policy mismatch failures while keeping negotiation valid.

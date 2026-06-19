# DataDashboard Implementation History

This document is the consolidated record of what was implemented and adjusted in this workspace for the DataDashboard-based GUI.

## 1) DataDashboard-Based GUI

- DataDashboard is the only maintained GUI in this repository.
- Custom ML features are implemented in DataDashboard wrapper routes/components.

## 2) Routing and navigation

- Added custom routes:
  - `/ml-assets`
  - `/model-execution`
  - `/model-benchmarking`
- Added corresponding menu entries in:
  - `DataDashboard/public/config/app-config.json`

## 3) Connector configuration and frontend startup fixes

- Updated connector config format and values in:
  - `DataDashboard/public/config/edc-connector-config.json`
- Added optional base-href config file to remove 404 noise:
  - `DataDashboard/public/config/APP_BASE_HREF.txt`
- Documented local storage reset when stale connector configs are cached:
  - `edc_local_configs`
  - `currentConnector`

## 4) CORS and API-key compatibility

- Root cause identified for health-check/management failures from browser:
  - missing `x-api-key` in CORS allowed headers.
- Required connector-side CORS update documented for both connectors:
  - allow origin `http://localhost:4200`
  - include `x-api-key` in `edc.web.rest.cors.headers`

## 5) Negotiation reliability fixes

- Identified strict provider validation failure:
  - agreement policy must match offer policy shape.
- Patched catalog negotiation policy handling in:
  - `DataDashboard/projects/dashboard-core/catalog/src/catalog.service.ts`
- Behavior after patch:
  - keep offer policy mostly as-is
  - inject only mandatory missing fields (`@context`, `assigner`, `target`)

## 6) ML Assets page feature parity with catalog

- Implemented connector selection + manual request flow aligned with catalog view.
- Implemented merged list:
  - local assets from management API
  - external assets from filter extension (with management fallback)
- Added filtering facets:
  - search
  - source
  - task category
  - task type
  - modality
  - subtask
  - endpoint behavior
  - library
  - language
  - license
  - storage type
  - format
- Added details modal with tabs and JSON-LD rendering aligned with catalog behavior.

## 7) ML Assets negotiation UX

- Reused catalog-like negotiation form and progress modal for external assets.
- Added gating:
  - no negotiation for local assets
  - no negotiation if agreement already exists
  - no negotiation while negotiation is in progress

## 8) Local asset management enhancements

- Enhanced `Assets` create/edit modal with optional ML metadata helper mapped to Daimo fields.
- Extended local asset search to include Daimo metadata values.
- Added local actions in `ML Assets` cards (same action style as `Assets`):
  - details
  - edit
  - delete
- Reused existing asset components/services for consistency:
  - `AssetCreateComponent`
  - `AssetService`
  - `DeleteConfirmComponent`
  - `AssetCardComponent`
- Added input contract metadata fields in ML helper:
  - `daimo:inputSchemaDraft`
  - `daimo:inputSchema`
  - `daimo:inputExample`

## 9) Model execution

- Added model execution page integrated with `/api/infer`.
- Execution eligibility logic:
  - local assets are executable
  - external assets require negotiated agreement
- Inference path resolution from metadata with fallback `/infer`.

## 10) Model benchmarking

- Added benchmark page integrated with existing infer flow (`/api/infer`), without requiring new connector endpoints.
- Added model multi-selection and dataset upload (`.json`, `.jsonl`, `.csv`).
- Added schema-validation gate:
  - blocks benchmark when selected models have no schema metadata
  - blocks benchmark when selected schemas are incompatible
  - validates dataset payload rows against required fields and basic types
- Added optional mapping paths:
  - input path (dataset row -> infer payload)
  - expected path (dataset row -> ground truth)
  - prediction path (infer output -> predicted value)
- Added runtime benchmark metrics:
  - success rate
  - avg latency
  - p95 latency
  - throughput
  - local classification/regression metrics when label/prediction values are resolvable
- Added metric selection, metric/evaluator model support, ranking score + results table + CSV export.

## 11) Benchmarking UX, reliability, and performance upgrade

- Model selection now blocks incompatibilities immediately:
  - model without schema metadata cannot be selected
  - model with non-matching input contract cannot be selected
  - model with non-matching request shape cannot be selected
  - output and metric/evaluator benchmark models cannot be mixed
- Added benchmark model picker enhancements:
  - search by name/id/tags/tasks
  - task filter (`All`, `Classification`, `Regression`, `NLP`, `Vision`, `Other`)
  - optional auto-filter to show only schema-compatible models
- Added `Validate Input` action:
  - executes first sample rows (`1..3`) against selected models
  - fails fast before full benchmark when payload/mapping/runtime is invalid
- Switched benchmark execution from sequential per-row calls to bounded parallel execution per model.
- Extended executable asset view-model to include `tasks` for filtering.
- Extended executable asset view-model with `requestShape`, `benchmarkModelType`, and `supportedMetrics`.
- Updated benchmark documentation with current UX flow and tuning knobs.

## 12) Dataspace dataset selection for benchmark

- Added benchmark dataset asset picker (search + selection) alongside file upload flow.
- Added dataspace dataset loading pipeline:
  - for external datasets: resolve finalized consumer agreement, start pull transfer, wait for ready state, download via EDR
  - for local datasets: parse inline dataset payload metadata when available
- Integrated loaded dataspace dataset into existing benchmark parsing, preview, mapping, validation, and scoring flow.
- Added benchmark dataset asset request pack:
  - `resources/requests/ai-datasets/` with 5 dataset asset definitions
  - `tools/register-benchmark-dataset-assets.sh` to register them quickly

## 13) Operational constraint found (important)

- Transfer may fail with:
  - `No Endpoint generator function registered for transfer type destination 'HttpData'`
- Meaning:
  - connector runtime used as consumer is missing the data-plane transfer capability required for that destination type in this direction.
- Consequence:
  - provider->consumer flow can work while reverse direction fails unless both runtimes have symmetric data-plane/transfer support.

## Key code areas touched

- `DataDashboard/src/app/features/ml-assets-browser/`
- `DataDashboard/src/app/features/ml-contract-negotiation/`
- `DataDashboard/src/app/features/ml-negotiation-progress/`
- `DataDashboard/src/app/features/model-execution/`
- `DataDashboard/src/app/features/model-benchmarking/`
- `DataDashboard/src/app/services/dashboard-ml-browser.service.ts`
- `DataDashboard/src/app/services/dashboard-model-execution.service.ts`
- `DataDashboard/projects/dashboard-core/catalog/src/catalog.service.ts`
- `DataDashboard/projects/dashboard-core/assets/src/asset-create/asset-create.component.ts`
- `DataDashboard/projects/dashboard-core/assets/src/asset-view/asset-view.component.ts`

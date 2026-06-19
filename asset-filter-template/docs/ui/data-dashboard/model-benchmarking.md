# Model Benchmarking (DataDashboard)

## Route

- `/model-benchmarking`

## Purpose

Compare multiple executable models using a shared dataset, using the existing infer extension.

## Implemented behavior

- Reuses executable asset discovery from model execution service.
- Allows multi-select of executable models with immediate schema gating:
  - selecting a model without schema metadata is blocked immediately
  - selecting a model with incompatible schema is blocked immediately
  - selecting a model with a different `daimo:requestShape` is blocked immediately
  - selecting a model with a different benchmark type (`output` vs `metric/evaluator`) is blocked immediately
  - once a reference model is selected, the list can auto-filter to compatible models
- Adds model discovery controls:
  - search (name/id/tags/tasks)
  - task filter (`All`, `Classification`, `Regression`, `NLP`, `Vision`, `Other`)
- Supports dataset upload:
  - `.json` (array, object, or object containing `rows`/`data`/`items`/`dataset`/`samples`)
  - `.jsonl`
  - `.csv` (header + rows)
- Adds dataspace dataset selection:
  - searchable dataset asset list (local + external)
  - explicit dataset selection (radio)
  - load selected dataset into benchmark rows
- Supports optional mapping fields:
  - `inputPath`: dataset field declared by `daimo:input`; fallback is full row
  - `expectedPath`: dataset field declared by `daimo:label`; used for local metrics
  - `predictionPath`: optional response path override; otherwise common output keys are inspected
- Supports metric selection:
  - output classification models: `Accuracy`, `Precision`, `Recall`, `F1 Score`
  - output regression models: `RMSE`, `MAE`, `MSE`, `R2`
  - metric/evaluator models: metrics declared by `daimo:metrics`
- Enforces schema requirements before benchmark execution:
  - each selected model must provide input contract metadata `daimo:inputSchema`
  - selected models must share the same input schema contract
  - selected models must share the same `daimo:requestShape`
  - selected models must all be output models or all be metric/evaluator models
  - dataset rows must satisfy required fields and basic type checks
- Adds a **Validate Input** action before benchmark:
  - executes `1..3` sample dataset rows against selected models
  - uses same mapping + timeout settings
  - reports pass/fail quickly before full benchmark
- Calls infer endpoint for each output model row or batch:
  - `POST {activeDefaultUrl}/api/infer`
  - body includes `assetId`, `path`, `payload`
- For metric/evaluator models, sends the loaded dataset rows in one request and reads the returned selected metrics.
- Executes requests in bounded parallel mode per model (`benchmarkParallelism`) instead of strictly sequential row-by-row calls.
- Tracks progress:
  - `completedRequests / totalRequests`
  - progress bar and status message
- Captures sampled execution errors for visibility.
- Produces ranked results table and CSV export.
- Lets users click metric/result columns to rank by that metric; lower-is-better metrics such as `RMSE`, `MAE`, `MSE`, and latencies are inverted.

## UX flow (current)

1. Load executable models.
2. Optionally search and filter by task.
3. Select models:
   - first selected model becomes compatibility reference
   - only models with equivalent input feature contract are selectable
4. Select dataset source:
   - pick and load a dataspace dataset asset, or
   - upload dataset file manually
5. Review mapping (`inputPath`, optional `expectedPath` + `predictionPath`) and timeout.
6. Select metrics to compare.
7. Run **Validate Input**:
  - executes up to first 3 dataset rows against all selected models
  - confirms runtime compatibility before full benchmark
8. Run full benchmark:
  - executes all rows per model with bounded parallel requests
9. Review ranking, click a metric column to change the ranking, and export CSV.

## Compatibility model (how selection is blocked)

- A model is immediately rejected if it has no normalized `daimo:inputSchema` metadata.
- A model is immediately rejected if its normalized schema signature differs from the reference selected model.
- A model is immediately rejected if its `daimo:requestShape` differs from the reference selected model.
- A model is immediately rejected if its benchmark type (`output` vs `metric/evaluator`) differs from the reference selected model.
- Schema signature uses:
  - field name (case-insensitive)
  - normalized type (for example `int -> integer`, `float/double -> number`)
  - required flag
- `Select All` only selects schema-compatible models from the currently filtered list.
- Optional toggle `Auto-filter compatible schema` hides non-compatible models from the selector UI.

## Search and task filter behavior

- Search matches concatenated model `name`, `id`, `tags`, and `tasks`.
- Task categories are heuristic and mapped to:
  - `classification`
  - `regression`
  - `nlp`
  - `vision`
  - `other`
- Task detection uses model metadata tokens (`tasks`, `subtasks`, `keywords`) and name text.

## Validate Input behavior

- Validate Input runs lightweight probes before full benchmark:
  - sample size: `1..3` rows (currently first rows in dataset)
  - checks all selected models
  - uses same infer path, mapping, timeout
- Purpose:
  - fail fast on payload/mapping/runtime issues
  - reduce wasted full-benchmark runs
- Validation does not produce ranking results; it only confirms operational readiness.

## Dataspace dataset sourcing behavior

- Dataspace dataset list is derived from ML browser assets with dataset-oriented metadata heuristics.
- External dataset loading requires an existing finalized **consumer** agreement for that asset id.
- External load path:
  - resolve matching agreement/negotiation
  - initiate pull transfer
  - wait until transfer reaches `STARTED`/`COMPLETED`
  - download via EDR and parse payload as `json/jsonl/csv`
- Local load path:
  - attempts to parse inline dataset payload metadata from asset properties (`dataset/data/samples` and benchmark-specific keys)
  - if no inline payload exists, user must upload file manually (or use external agreed dataset)

## Parallel execution strategy

- Benchmark is executed per selected model.
- For each model, dataset rows are executed with bounded parallelism (worker pool).
- This replaces strict sequential row-by-row execution and improves throughput.
- Concurrency is intentionally bounded to avoid overloading connector/model runtime.

## Metrics produced

- `successRate`: successful requests over total samples
- `averageLatencyMs`
- `p95LatencyMs`
- `throughputRps`
- `accuracyPercent` when classification accuracy can be calculated
- selected classification metrics for output models: `Accuracy`, `Precision`, `Recall`, `F1 Score`
- selected regression metrics for output models: `RMSE`, `MAE`, `MSE`, `R2`
- selected metrics returned by metric/evaluator models declared with `daimo:metrics`

## Ranking score

- The active ranking metric defaults to the first selected metric.
- Clicking a metric/result column changes the active ranking metric.
- `score` is a relative 0-100 score using the active metric, success rate, and average latency.
- Lower-is-better metrics (`RMSE`, `MAE`, `MSE`, `averageLatencyMs`, `p95LatencyMs`) are inverted for ranking.
- If no selected metric value can be calculated, ranking falls back to success rate and latency.

## Key files

- `DataDashboard/src/app/features/model-benchmarking/model-benchmarking.component.ts`
- `DataDashboard/src/app/features/model-benchmarking/model-benchmarking.component.html`
- `DataDashboard/src/app/services/dashboard-model-execution.service.ts`
- `DataDashboard/src/app/models/ml-gui-asset.ts`
- `DataDashboard/src/app/app.routes.ts`
- `DataDashboard/public/config/app-config.json`

## Notes

- This feature runs entirely in dashboard frontend code and does not require new connector endpoints.
- It depends on already available endpoints:
  - `POST /api/infer`
  - executable discovery path already used by model execution page
  - transfer/edr management APIs used by dashboard-core transfer module for dataspace dataset download
- Input schema metadata is authored in asset create/edit ML helper and stored as:
  - `daimo:inputSchema`
  - `daimo:inputSchemaDraft`
  - `daimo:inputExample`
- Benchmark result summaries are emitted to the Model Observer extension; export CSV for table-level analysis.
- Benchmark tuning constants are currently set in component state:
  - `benchmarkParallelism = 8`
  - `validationParallelism = 6`
  - `validationSampleRows = 3`

## Local benchmark model pack (5 models)

The repository includes a local pack designed for this page:
- `resources/requests/ai-models/create-asset-infer-benchmark-text-keyword-v1.json`
- `resources/requests/ai-models/create-asset-infer-benchmark-text-bayes-v1.json`
- `resources/requests/ai-models/create-asset-infer-benchmark-text-linear-v1.json`
- `resources/requests/ai-models/create-asset-infer-benchmark-tabular-linear-v1.json`
- `resources/requests/ai-models/create-asset-infer-benchmark-tabular-tree-v1.json`

It is split into 2 shared input-contract groups:
- 3 text classification models (`urn:pionera:schema:text-classification:v1`)
- 2 tabular regression models (`urn:pionera:schema:tabular-regression:v1`)

Run from `asset-filter-template/`:

```bash
./tools/start-benchmark-model-servers.sh
./tools/register-benchmark-model-assets.sh
```

Stop:

```bash
./tools/stop-benchmark-model-servers.sh
```

Reference:
- `resources/requests/ai-models/README-benchmark-inference.md`

## Local benchmark datasets

Dataset pack location:
- `resources/benchmark-datasets/`
- `resources/benchmark-datasets/README.md`
- Dataset asset requests:
  - `resources/requests/ai-datasets/`
  - `resources/requests/ai-datasets/README-benchmark-datasets.md`

Main files:
- `resources/benchmark-datasets/text-benchmark-v1.json`
- `resources/benchmark-datasets/text-benchmark-v1.jsonl`
- `resources/benchmark-datasets/text-benchmark-v1-input-only.csv`
- `resources/benchmark-datasets/tabular-benchmark-v1.json`
- `resources/benchmark-datasets/tabular-benchmark-v1.jsonl`
- `resources/benchmark-datasets/tabular-benchmark-v1-input-only.csv`

Dataset asset metadata:
- Text JSON/JSONL dataset assets declare `daimo:input=["input"]` and `daimo:label="expected_label"`.
- Tabular JSON/JSONL dataset assets declare `daimo:input=["input"]`.
- `daimo:benchmark_dataset_mapping` remains available for response `predictionPath` hints such as `result.label` or `result.value`.

Register dataset assets (from `asset-filter-template/`):

```bash
./tools/register-benchmark-dataset-assets.sh
```

Behavior note:
- If a dataset asset contains inline `daimo:benchmark_dataset` rows, DataDashboard loads those rows directly (for local and external assets) before attempting transfer.
- This avoids browser-side downloads from dataplane `/public` for inline benchmark packs, which can otherwise fail due to CORS/network setup.

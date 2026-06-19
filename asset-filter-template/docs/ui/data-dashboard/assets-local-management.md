# Assets (Local Management)

This page documents local asset creation and lookup behavior in DataDashboard `Assets`.

## Scope

- Route/module: built-in `Assets` page from `dashboard-core`
- Covers local asset create, update, delete, and filter

## ML metadata helper in create/edit modal

The asset create/update modal includes an optional **ML Metadata** helper.

- Toggle: `Enable ML metadata helper`
- UI labels are business labels only (no ontology names shown in the form)
- DAIMO metadata is written under `assetData.JS_DAIMO_Model` or `assetData.JS_DAIMO_Dataset`; DCAT/DCT fields remain in top-level `properties`.

## Basic fields (always visible)

- Short Description (free text)
- Version (string)
- Task (single select, controlled list)
- Task Type (single select, controlled list)
- Modality (multi select): `tabular`, `text`, `image`, `audio`, `video`, `multimodal`
- Subtask (single select, controlled list)
- Endpoint Behavior (single select): `inference`, `metric`, `evaluator`
- Request Shape (single select): `single`, `batch`
- Keywords (multi select, example vocabulary)
- License (single select, SPDX-style common values)
- Maturity Status (single select): `experimental`, `validated`, `production`, `deprecated`

## Advanced fields (collapsible)

- Library / Runtime (multi select)
- Languages (multi select, shown when modality includes `text` or `multimodal`)
- Model Size:
  - Parameters
  - Artifact Size (MB)
  - Quantization (single select)
- Evaluation Metadata:
  - Supported Metrics
  - Report URL
- Service Integration:
  - Model Format (single select)
  - Inference Path (single select)
  - Input Schema Draft (single select)
  - Input Schema (JSON Schema textarea, advanced mode)
  - Input Example (JSON textarea, advanced mode)
  - Interactive input-field builder (path/type/required/example/description)
  - Quick schema templates with ready-to-use examples (classification, embeddings, chat, tabular)
- Intended Use (text)
- Limitations (text)
- Safety / Compliance flags (checkboxes):
  - PII-safe
  - Regulated domain
  - Human-in-the-loop required
- Cost & SLO:
  - Latency p95 (ms)
  - Throughput (rps)
  - Rate limits
  - Availability tier

## Daimo mapping used by the helper

- Short Description -> `shortDescription`
- Version -> `daimo:modelVersion`
- Task -> `daimo:taskCategory`
- Task Type -> `daimo:taskType`
- Modality -> `daimo:modality`
- Subtask -> `daimo:subtask`
- Endpoint Behavior -> `daimo:endpointBehavior`
- Request Shape -> `daimo:requestShape`
- Keywords -> `dcat:keyword`
- License -> `dct:license`
- Maturity Status -> `daimo:maturityStatus`
- Library / Runtime -> `daimo:libraryName`
- Languages -> `dct:language`
- Model Format -> `dct:format`
- Inference Path -> `daimo:inferencePath`
- Input Schema Draft -> `daimo:inputSchemaDraft`
- Input Schema -> `daimo:inputSchema`
- Input Example -> `daimo:inputExample`
- Parameters -> `daimo:parameterCount`
- Artifact Size -> `daimo:artifactSizeMb`
- Quantization -> `daimo:quantization`
- Supported Metrics -> `daimo:metrics`
- Performance Report -> `daimo:performanceReport`
- Intended Use -> `daimo:intendedUse`
- Limitations -> `daimo:limitations`
- PII-safe -> `daimo:piiSafe`
- Regulated domain -> `daimo:regulatedDomain`
- Human-in-the-loop required -> `daimo:humanInTheLoopRequired`
- Latency p95 -> `daimo:latencyP95Ms`
- Throughput -> `daimo:throughputRps`
- Rate limits -> `daimo:rateLimits`
- Availability tier -> `daimo:availabilityTier`

## Filtering local assets

Asset list search now matches:

- ID, Name, Type, Content-Type
- plus the Daimo metadata fields above

This allows local discovery by ML metadata terms (task, runtime, modality, maturity, evaluation metadata, safety flags, and SLO hints).

## Files

- `DataDashboard/projects/dashboard-core/assets/src/asset-create/asset-create.component.ts`
- `DataDashboard/projects/dashboard-core/assets/src/asset-create/asset-create.component.html`
- `DataDashboard/projects/dashboard-core/assets/src/asset-view/asset-view.component.ts`
- `DataDashboard/projects/dashboard-core/assets/src/asset-view/asset-view.component.html`

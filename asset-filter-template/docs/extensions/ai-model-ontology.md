# Daimo-Style AI Model Metadata Template (EDC + JSON-LD)

This document defines a practical, Daimo-style metadata schema for AI model assets in EDC. Daimo is our namespace for HF-style fields, renamed for this project. It explains the JSON-LD vocabulary, how fields are stored, how they appear in catalogs, and how they are used by the filtering extension.

---

## 1) Goal and scope

We want metadata that is:
- Consistent and filterable
- Easy to evolve
- Compatible with JSON-LD and EDC catalogs

This template targets AI model assets but is general enough for other ML assets.

## 2) JSON-LD basics (what EDC stores)

EDC assets use JSON-LD. The most important part is the `@context` section, which declares a base vocabulary and any custom prefixes.

Minimal example:
```json
{
  "@context": {
    "@vocab": "https://w3id.org/edc/v0.0.1/ns/",
    "daimo": "https://w3id.org/pionera/daimo#"
  },
  "@id": "model-example",
  "properties": {
    "name": "Example Model",
    "contenttype": "application/octet-stream",
    "daimo:taskCategory": "text-classification"
  },
  "dataAddress": {
    "type": "HttpData",
    "baseUrl": "https://example.com/model.bin",
    "proxyPath": "true"
  }
}
```

Key points:
- `@vocab` sets the default namespace for EDC fields.
- Custom prefixes like `daimo:` let you define your own fields.
- `properties` holds all custom metadata fields.

## 3) Recommended Daimo-style namespace

Use a custom namespace you control:
```text
https://w3id.org/pionera/daimo#
```

Then define fields with `daimo:` inside `properties`.

## 4) Core Daimo-style fields

These are the main facets used in AI catalogs:

| Field | Type | Example | Purpose |
| --- | --- | --- | --- |
| `daimo:assetType` | string | `machineLearning` | ML asset discriminator |
| `daimo:taskCategory` | string | `text-classification` | Task category |
| `daimo:taskType` | string | `classification` | Task type |
| `daimo:modality` | string | `text` | Data modality |
| `daimo:subtask` | string | `sentiment-analysis` | More specific task |
| `daimo:endpointBehavior` | string | `inference` | Endpoint role (`inference`, `metric`, `evaluator`) |
| `daimo:requestShape` | string | `single` | Endpoint payload shape (`single` or `batch`) |
| `daimo:libraryName` | string | `scikit-learn` | Library |
| `dct:license` | string | `Apache-2.0` | License |
| `dcat:keyword` | array | `["demo","multiclass"]` | Keywords |
| `dct:language` | array | `["en"]` | Language |
| `dct:format` | string | `json` | Asset format |

## 4b) Extended ML metadata fields (optional)

The UI mirrors ML metadata into `daimo:*` fields for completeness. These do not affect filtering unless you add filter rules for them.

| Field | Type | Example | Source |
| --- | --- | --- | --- |
| `daimo:inputSchema` | object | JSON Schema | Model input contract |
| `daimo:inputExample` | object | `{ "text": "hello" }` | Example request payload |
| `daimo:metrics` | array/object | `["Accuracy", "F1 Score"]` | Supported metrics for metric/evaluator endpoints or model evaluation metadata |
| `daimo:input` | array | `["input"]` | Dataset input field hints |
| `daimo:label` | string | `expected_label` | Dataset label field hint |

## 5) Performance metadata

Optional fields for metric/evaluator endpoints and benchmark metric selection:

```json
"daimo:metrics": ["Accuracy", "Precision", "Recall", "F1 Score"]
```

`daimo:metrics` can also be an object when publishing precomputed model metadata. Use numeric values if you want range filtering.

## 6) Inference endpoint assets

If the asset is an HTTP inference endpoint, include:
- `contenttype: application/json`
- `daimo:inferencePath: "/infer"`

Example:
```json
{
  "@context": {
    "@vocab": "https://w3id.org/edc/v0.0.1/ns/",
    "daimo": "https://w3id.org/pionera/daimo#"
  },
  "@id": "model-mock-infer-v1",
  "properties": {
    "name": "Mock Inference Model v1",
    "contenttype": "application/json",
    "daimo:taskCategory": "text-classification",
    "daimo:taskType": "classification",
    "daimo:modality": "text",
    "daimo:subtask": "sentiment-analysis",
    "daimo:endpointBehavior": "inference",
    "daimo:requestShape": "single",
    "dct:license": "Apache-2.0",
    "dcat:keyword": ["mock","inference","demo"],
    "daimo:libraryName": "custom",
    "dct:language": ["en"],
    "daimo:inferencePath": "/infer"
  },
  "dataAddress": {
    "type": "HttpData",
    "baseUrl": "http://localhost:9000",
    "proxyPath": "true"
  }
}
```

## 7) How fields appear in catalog output

JSON-LD can expand compact keys into full IRIs. Example:

Compact form (input):
```text
"daimo:taskCategory": "text-classification"
```

Expanded form (catalog output):
```text
"https://w3id.org/pionera/daimo#taskCategory": "text-classification"
```

Our filtering extension supports both forms.

## 8) Daimo profile mapping in filtering

When `profile=daimo`:
- `task|taskCategory` maps to `daimo:taskCategory`
- `taskType` maps to `daimo:taskType`
- `modality` maps to `daimo:modality`
- `subtask` maps to `daimo:subtask`
- `subtaskDescription` maps to `daimo:subtaskDescription`
- `endpointBehavior` maps to `daimo:endpointBehavior`
- `requestShape` maps to `daimo:requestShape`
- `inputSchema` maps to `daimo:inputSchema`
- `inputExample` maps to `daimo:inputExample`
- `metrics` maps to `daimo:metrics`
- `library|libraryName` maps to `daimo:libraryName`
- `language` maps to `dct:language`
- `license` maps to `dct:license`
- `format` maps to `dct:format`
- `keyword|tag` maps to `dcat:keyword`
- `input` maps to `daimo:input`
- `label` maps to `daimo:label`
- `labelType` maps to `daimo:labelType`
- `datasetVersion`, `datasetRole`, `protocol`, and `randomSeed` map to their DAIMO dataset metadata fields

## 9) Generic filters (any asset)

You can also filter any field directly:
```text
?filter=properties.dct:license=MIT
?filter=properties.dcat:keyword~demo
?filter=https://w3id.org/pionera/daimo#metrics.accuracy>=0.9
```

## 10) Common pitfalls

- If `contenttype` is missing, the UI may not recognize the asset.
- If metrics are strings, numeric range filters will not work.
- If `dcat:keyword` is a string instead of an array, tag filters will fail.
- If `daimo:inferencePath` is missing, inference defaults to `/infer`.

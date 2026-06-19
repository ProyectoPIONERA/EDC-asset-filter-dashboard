# Filtering Extension (Consumer-Side)

This document describes the connector-side filtering extension used to query catalogs and apply Daimo-style facets. It runs inside the consumer connector and exposes a single API endpoint.

---

## 1) Endpoint

```text
POST /api/filter/catalog
```

Example:
```bash
curl -X POST "http://localhost:29191/api/filter/catalog?profile=daimo&task=text-classification" \
  -H 'Content-Type: application/json' \
  -d @./resources/requests/fetch-catalog.json -s | jq
```

## 2) Required request body

The body must include `counterPartyAddress` and `protocol`.

Example body:
```json
{
  "@context": { "@vocab": "https://w3id.org/edc/v0.0.1/ns/" },
  "counterPartyAddress": "http://localhost:19194/protocol",
  "protocol": "dataspace-protocol-http"
}
```

If either field is missing, the API returns:
```json
{"error":"Invalid catalog request"}
```

## 3) What the extension does

1. Accepts a catalog request body
2. Calls consumer management API `/v3/catalog/request`
3. Extracts datasets from the catalog
4. Applies connector-side filters and sorting to the catalog response
5. Returns a catalog with only matching datasets

Unlike the AIModelHub SQL search extension, this proxy endpoint does not push DAIMO predicates into a SQL asset index. It filters the returned catalog payload inside the connector extension.

## 4) Daimo profile filters

Use `profile=daimo` to enable Daimo-style params.

| Query param | Mapped field |
| --- | --- |
| `assetType` | `assetType` |
| `description` | `dct:description` |
| `format` | `dct:format` |
| `keyword`, `keywords`, `tag`, `tags` | `dcat:keyword` |
| `language` | `dct:language` |
| `license` | `dct:license` |
| `library`, `libraryName` | `daimo:libraryName` |
| `metrics` | `daimo:metrics` |
| `modality` | `daimo:modality` |
| `name` | `name` |
| `requestShape` | `daimo:requestShape` |
| `task` | `daimo:taskCategory` |
| `taskCategory` | `daimo:taskCategory` |
| `taskType` | `daimo:taskType` |
| `subtask` | `daimo:subtask` |
| `subtaskDescription` | `daimo:subtaskDescription` |
| `endpointBehavior` | `daimo:endpointBehavior` |
| `inputSchema` | `daimo:inputSchema` |
| `inputExample` | `daimo:inputExample` |
| `input` | `daimo:input` |
| `label` | `daimo:label` |
| `labelType` | `daimo:labelType` |
| `datasetVersion` | `daimo:datasetVersion` |
| `datasetRole` | `daimo:datasetRole` |
| `protocol` | `daimo:protocol` |
| `randomSeed` | `daimo:randomSeed` |

Example:
```text
?profile=daimo&task=text-classification
```

Multi-value OR:
```text
?profile=daimo&task=text-classification,feature-extraction
```

## 5) Generic filters

Use one or more `filter=` parameters for any field:

```text
?filter=properties.dct:license=MIT,Apache-2.0
?filter=properties.dcat:keyword~demo
?filter=https://w3id.org/pionera/daimo#metrics.accuracy>=0.90
```

Operators:
- `=` equals (case-insensitive)
- `~` contains (case-insensitive)
- `>`, `>=`, `<`, `<=` numeric ranges

Multiple `filter=` parameters are ANDed.
Comma-separated values are ORed.

## 6) Search query

```text
?q=embedding
```

Search is applied to:
- `name`
- `id`
- `assetType`
- `description` / `dct:description`
- `dcat:keyword`
- `daimo:taskCategory`
- `daimo:taskType`
- `daimo:modality`
- `daimo:subtask`
- `daimo:subtaskDescription`
- `daimo:endpointBehavior`
- `daimo:requestShape`
- `daimo:libraryName`
- `dct:language`
- `dct:license`
- `dct:format`
- `daimo:input`
- `daimo:label`
- `daimo:labelType`
- `daimo:metrics`

## 7) Sorting

```text
?sort=name
?sort=license&order=desc
?sort=metrics.accuracy&order=desc
```

Strings are compared case-insensitively. Numbers are compared as doubles.

## 8) JSON-LD expansion note

Catalog outputs may expand `daimo:` keys into full IRIs:
- `daimo:taskCategory` becomes `https://w3id.org/pionera/daimo#taskCategory`

The filter handles both compact and expanded forms.

## 9) Files

- `connector/src/main/java/com/pionera/assetfilter/filter/AssetFilterExtension.java`
- `connector/src/main/java/com/pionera/assetfilter/filter/AssetFilterController.java`

## 10) Common failures

Empty catalog:
- Provider not running
- Assets not created
- Policy/contract definition missing

Invalid catalog request:
- `counterPartyAddress` or `protocol` missing from request body

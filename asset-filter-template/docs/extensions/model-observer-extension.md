# Model Observer Extension

The model observer extension is a local clearing-house journal for AI model lifecycle evidence in the asset-filter connector.

It is inspired by the INESData `model-observer-dsp-events` extension, but adapted for this project by storing events locally and exposing query APIs for DataDashboard.

## Scope

The extension records:

- EDC asset lifecycle events
- EDC policy lifecycle events
- EDC contract-definition lifecycle events
- DSP contract negotiation events
- DSP transfer process events
- external catalog queries from `/api/filter/catalog`
- model execution outcomes from `/api/infer`
- benchmark run results posted by DataDashboard

Events are normalized around common correlation fields:

- `assetId` / `modelId`
- `agreementId`
- `negotiationId`
- `transferProcessId`
- `usageSessionId`
- `benchmarkRunId`
- `participantId`
- `category`

## Configuration

Provider and consumer configs include defaults:

```properties
asset.model.observer.enabled=true
asset.model.observer.storage.file=./.state/consumer-model-observer-events.json
asset.model.observer.max.events=5000
asset.model.observer.source.component=asset-filter-consumer:model-observer
```

Use separate storage files for separate connector runtimes.

## Endpoints

Base path:

```text
/api/model-observer
```

Available endpoints:

- `POST /events` records a custom event.
- `GET /events` queries the event ledger.
- `GET /assets/{assetId}/timeline` returns chronological asset evidence.
- `GET /agreements/{agreementId}/evidence` returns chronological agreement evidence.
- `GET /benchmarks?assetId=...` returns benchmark events.
- `GET /participants` returns participant summaries.
- `GET /summary` returns ledger counts and recent events.

Query filters for `GET /events`:

- `eventType`
- `category`
- `assetId`
- `agreementId`
- `participantId`
- `negotiationId`
- `transferProcessId`
- `usageSessionId`
- `benchmarkRunId`
- `q`
- `limit`

## Example

```bash
curl "http://localhost:29191/api/model-observer/events?assetId=provider~benchmark-text-linear-v1&limit=50"
```

```bash
curl -X POST "http://localhost:29191/api/model-observer/events" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "BENCHMARK_COMPLETED",
    "assetId": "provider~benchmark-text-linear-v1",
    "benchmarkRunId": "run-001",
    "status": "COMPLETED",
    "metrics": { "bestScore": 94.2, "sampleCount": 30 }
  }'
```

## Event taxonomy

Catalog query evidence is intentionally separate from asset lifecycle evidence.
Legacy `ASSET_DISCOVERY_COMPLETED` journal entries are normalized to `CATALOG_QUERY_COMPLETED`
when the journal is loaded.

Catalog:

- `CATALOG_QUERY_COMPLETED`

Asset lifecycle:

- `ASSET_REGISTERED`
- `ASSET_UPDATED`
- `ASSET_DELETED`

Governance:

- `POLICY_CREATED`
- `POLICY_UPDATED`
- `POLICY_DELETED`
- `CONTRACT_DEFINITION_CREATED`
- `CONTRACT_DEFINITION_UPDATED`
- `CONTRACT_DEFINITION_DELETED`

Contracts and transfers:

- `CONTRACT_NEGOTIATION_INITIATED`
- `CONTRACT_NEGOTIATION_REQUESTED`
- `CONTRACT_NEGOTIATION_OFFERED`
- `CONTRACT_NEGOTIATION_ACCEPTED`
- `CONTRACT_NEGOTIATION_AGREED`
- `CONTRACT_NEGOTIATION_VERIFIED`
- `CONTRACT_NEGOTIATION_FINALIZED`
- `CONTRACT_NEGOTIATION_TERMINATED`
- `TRANSFER_PROCESS_STARTED`
- `TRANSFER_PROCESS_COMPLETED`
- `TRANSFER_PROCESS_TERMINATED`

Execution:

- `MODEL_EXECUTION_COMPLETED`
- `MODEL_EXECUTION_FAILED`

Benchmark:

- `BENCHMARK_COMPLETED`
- `BENCHMARK_FAILED`

## Implementation

Source files:

- `connector/src/main/java/com/pionera/assetfilter/modelobserver/`
- `final-connector/src/main/java/com/pionera/assetfilter/modelobserver/`
- `DataDashboard/src/app/features/model-observer/`
- `DataDashboard/src/app/services/dashboard-model-observer.service.ts`

Asset, policy, contract-definition, negotiation, and transfer events come from EDC's event router.
The dashboard does not invent lifecycle facts; it queries the clearing house and only posts benchmark
summary events, because benchmarking is performed by the dashboard.

The extension is registered through:

- `connector/src/main/resources/META-INF/services/org.eclipse.edc.spi.system.ServiceExtension`
- `final-connector/src/main/resources/META-INF/services/org.eclipse.edc.spi.system.ServiceExtension`

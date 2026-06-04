# Model Observer

Route:

- `/model-observer`

Connector endpoint:

- `/api/model-observer`

## Views

- **Ledger**: filter events by type, asset/model, agreement, participant, and free-text query.
- **Asset Timeline**: inspect chronological evidence for a model or asset ID.
- **Agreement Evidence**: inspect events tied to a contract agreement.
- **Benchmarks**: inspect benchmark run history posted by DataDashboard.
- **Participants**: summarize participant-level event counts, assets, agreements, and event mix.

## Event Sources

DataDashboard and the connector write to the same journal:

- external catalog browsing records `CATALOG_QUERY_COMPLETED`
- connector asset events record `ASSET_REGISTERED`, `ASSET_UPDATED`, and `ASSET_DELETED`
- connector policy events record `POLICY_CREATED`, `POLICY_UPDATED`, and `POLICY_DELETED`
- connector contract-definition events record create/update/delete governance evidence
- inference calls record `MODEL_EXECUTION_COMPLETED` or `MODEL_EXECUTION_FAILED`
- benchmark runs record `BENCHMARK_COMPLETED` or `BENCHMARK_FAILED`
- connector DSP events record contract negotiation and transfer process evidence

## Files

- `DataDashboard/src/app/features/model-observer/`
- `DataDashboard/src/app/services/dashboard-model-observer.service.ts`
- `DataDashboard/src/app/services/dashboard-connector-context.service.ts`
- `DataDashboard/public/config/app-config.json`

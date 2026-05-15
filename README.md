# AIModelHub

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Java 21](https://img.shields.io/badge/Java-21-orange.svg)](https://adoptium.net/)
[![Angular 20](https://img.shields.io/badge/Angular-20-DD0031.svg)](https://angular.dev/)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB.svg)](https://www.python.org/)
![CI](https://img.shields.io/badge/CI-not%20configured-lightgrey)
![Status](https://img.shields.io/badge/status-research%20prototype-orange)

**Dataspace-native discovery, execution, and benchmarking for AI models and datasets.**

AIModelHub is a research-oriented platform developed within the PIONERA project for publishing, discovering, negotiating, executing, and benchmarking AI assets across Eclipse EDC-based dataspace connectors.

The repository combines an Angular dashboard with EDC runtime extensions so teams can explore AI assets end to end: from catalog filtering and contract negotiation to model inference and side-by-side benchmark runs.

> [!IMPORTANT]
> AIModelHub is a research and integration prototype. The platform is functional for local development, experimentation, and validation workflows, but the current runtime is **not production-ready** yet.

## Overview

| Component | Purpose |
| --- | --- |
| `DataDashboard/` | Angular UI for ML asset browsing, contract negotiation, model execution, and model benchmarking |
| `asset-filter-template/` | Eclipse EDC-based connector runtime with custom filtering, inference, observability, and proxy extensions |
| `asset-filter-template/resources/` | Sample asset definitions, benchmark datasets, configuration files, and request payloads |
| `asset-filter-template/tools/` | Local mock servers and asset registration scripts for repeatable demos |

## Features

- Discover AI models and datasets across provider and consumer connectors.
- Filter catalogs using Daimo-style metadata such as task, tags, license, dataset, language, and base model.
- Execute inference through a single `/api/infer` endpoint using only an `assetId`.
- Benchmark multiple executable models against the same dataset with latency, throughput, success-rate, and optional accuracy metrics.
- Load benchmark datasets either from local files or dataspace assets.
- Extend the platform with custom EDC connector logic, proxy data planes, and dashboard customizations.

## Installation

### Prerequisites

| Dependency | Recommended version | Used for |
| --- | --- | --- |
| Java | 21 | EDC connector runtime |
| Node.js | 20+ | Angular dashboard development |
| npm | 10+ | Dashboard dependencies |
| Python | 3.10+ | Local benchmark and mock model servers |
| Docker + Docker Compose | Latest | Optional containerized connector setup |
| `curl` + `jq` | Latest | Sample requests and asset registration scripts |

### Clone the repository

```bash
git clone https://github.com/ProyectoPIONERA/AIModelHub.git
cd AIModelHub
```

### Install dashboard dependencies

```bash
cd DataDashboard
npm install
cd ..
```

### Build the connector runtime

```bash
cd asset-filter-template
./scripts/build-final-connector.sh
cd ..
```

## Quick Start

The fastest local setup uses Docker for the provider and consumer connectors, Python scripts for the benchmark model pack, and the Angular dev server for the dashboard.

### 1. Start the connectors

```bash
cd asset-filter-template
docker compose -f docker-compose.connectors.yml up
```

### 2. Register demo benchmark assets

In a second terminal:

```bash
cd asset-filter-template
./tools/start-benchmark-model-servers.sh
./tools/register-benchmark-model-assets.sh
./tools/register-benchmark-dataset-assets.sh
```

### 3. Start the dashboard library watcher

In a third terminal:

```bash
cd DataDashboard
npm run lib-start
```

### 4. Start the dashboard app

In a fourth terminal:

```bash
cd DataDashboard
npm start
```

Open `http://localhost:4200`, select the `Consumer` connector, and explore:

- `ML Assets` to browse local and remote AI assets
- `Model Execution` to run inference
- `Model Benchmarking` to compare multiple models on the same dataset

> [!TIP]
> If you prefer not to use Docker, you can run the connectors locally with `./scripts/run-final-provider.sh` and `./scripts/run-final-consumer.sh` from `asset-filter-template/`.

## Minimal Working Example

Once the stack is running, test catalog filtering from the consumer connector:

```bash
curl -X POST "http://localhost:29191/api/filter/catalog?profile=daimo&task=text-classification" \
  -H "Content-Type: application/json" \
  -d @asset-filter-template/resources/requests/fetch-catalog.json
```

Then run inference against one of the registered benchmark models:

```bash
curl -X POST "http://localhost:29191/api/infer" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "provider~benchmark-text-keyword-v1",
    "method": "POST",
    "path": "/infer",
    "headers": { "Content-Type": "application/json" },
    "payload": { "text": "This service is excellent and very fast" }
  }'
```

## Benchmark Packs

AIModelHub includes ready-to-use synthetic assets for local validation and demos.

| Pack | Location | Contents |
| --- | --- | --- |
| Benchmark model assets | `asset-filter-template/resources/requests/ai-models/` | 5 executable model assets for text classification and tabular regression |
| Benchmark dataset assets | `asset-filter-template/resources/requests/ai-datasets/` | 5 dataset assets with inline rows and benchmark mappings |
| Raw benchmark datasets | `asset-filter-template/resources/benchmark-datasets/` | JSON, JSONL, and CSV datasets for text and tabular tasks |

## Project Structure

```text
AIModelHub/
├── DataDashboard/
│   ├── public/config/
│   ├── src/app/features/
│   └── projects/dashboard-core/
└── asset-filter-template/
    ├── connector/
    ├── final-connector/
    ├── provider-proxy-data-plane/
    ├── docs/
    ├── resources/
    ├── scripts/
    └── tools/
```

## Usage Examples

### Filter an external catalog

```bash
curl -X POST "http://localhost:29191/api/filter/catalog?profile=daimo&license=Apache-2.0&sort=name&order=asc" \
  -H "Content-Type: application/json" \
  -d @asset-filter-template/resources/requests/fetch-catalog.json
```

### Execute a model by asset ID

```bash
curl -X POST "http://localhost:29191/api/infer" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "provider~benchmark-text-bayes-v1",
    "payload": { "text": "The workflow is clean and helpful" }
  }'
```

### Run benchmarks in the UI

1. Open `http://localhost:4200`.
2. Choose the `Consumer` connector.
3. Navigate to `Model Benchmarking`.
4. Select at least two models.
5. Upload a local dataset or pick a dataspace benchmark dataset.
6. Run `Validate Input`, then launch the full benchmark.

## Configuration

### Main configuration files

| File | What you can configure |
| --- | --- |
| `DataDashboard/public/config/app-config.json` | Menu items, dashboard title, theme, user configuration, health check interval |
| `DataDashboard/public/config/edc-connector-config.json` | Preconfigured dashboard connectors and their management/default/protocol URLs |
| `asset-filter-template/resources/configuration/provider-configuration.properties` | Provider ports, API paths, DSP callback, CORS origins |
| `asset-filter-template/resources/configuration/consumer-configuration.properties` | Consumer ports, API paths, DSP callback, CORS origins, infer defaults |
| `asset-filter-template/docker-compose.connectors.yml` | Local container topology for provider and consumer runtimes |

### Default local ports

| Runtime | API | Management | Protocol | Public |
| --- | --- | --- | --- | --- |
| Provider | `19191` | `19193` | `19194` | `19291` |
| Consumer | `29191` | `29193` | `29194` | `29291` |

## Documentation

- [Documentation map](asset-filter-template/docs/README.md)
- [Filtering and inference developer guide](asset-filter-template/docs/extensions/developer-extensions-guide.md)
- [AI model ontology notes](asset-filter-template/docs/extensions/ai-model-ontology.md)
- [DataDashboard integration docs](asset-filter-template/docs/ui/data-dashboard/README.md)
- [Model benchmarking guide](asset-filter-template/docs/ui/data-dashboard/model-benchmarking.md)
- [Production readiness notes](asset-filter-template/docs/extensions/production-readiness.md)
- [Known UI limitations](asset-filter-template/docs/ui/data-dashboard/known-issues.md)

## Contributing

Contributions are welcome.

1. Open an issue before large feature additions or API changes.
2. Keep documentation and request examples in sync with code changes.
3. Include verification steps for connector and UI changes.
4. Follow the project code style and respect the [Code of Conduct](DataDashboard/CODE_OF_CONDUCT.md).

For bug reports and feature requests, please use the repository issue tracker.

## Maintainers

For technical questions, collaboration inquiries, or repository-related communication, please contact the project maintainers.

| Name | Role | Contact |
| --- | --- | --- |
| Jiayun Liu | Maintainer | [jiayun.liu@upm.es](mailto:jiayun.liu@upm.es) |
| Edmundo de Elvira Mori Orrillo | Maintainer | [edmundo.mori.orrillo@upm.es](mailto:edmundo.mori.orrillo@upm.es) |

## Paper

AIModelHub is developed as part of the PIONERA research project. A dedicated paper is not linked from this repository yet. If you use AIModelHub in academic or industrial research, please cite the software entry below and acknowledge the PIONERA project funding.

---

## Funding

This work has received funding from the PIONERA project (Enhancing interoperability in data spaces through artificial intelligence), a project funded in the context of the call for Technological Products and Services for Data Spaces of the Ministry for Digital Transformation and Public Administration within the framework of the PRTR funded by the European Union (NextGenerationEU)

<div align="center">
  <img src="funding_label.png" alt="Logos financiación" width="900" />
</div>

## License

This repository is licensed under the [Apache License 2.0](LICENSE).

The platform builds on the Eclipse EDC ecosystem and extends the EDC Data Dashboard with AI asset discovery, execution, and benchmarking capabilities.

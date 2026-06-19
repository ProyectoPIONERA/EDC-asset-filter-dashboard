import { HttpEventType } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalAndAlertService } from '@eclipse-edc/dashboard-core';
import { ContractAndTransferService } from '@eclipse-edc/dashboard-core/transfer';
import {
  ContractAgreement,
  ContractNegotiation,
  IdResponse,
  TransferProcessStates,
} from '@think-it-labs/edc-connector-client';
import { Subject, filter, firstValueFrom, map, takeUntil, timeout } from 'rxjs';
import { ExecutableAsset, InputSchemaFieldSpec, MlGuiAsset } from '../../models/ml-gui-asset';
import { DashboardMlBrowserService } from '../../services/dashboard-ml-browser.service';
import { DashboardModelExecutionService } from '../../services/dashboard-model-execution.service';
import { DashboardModelObserverService } from '../../services/dashboard-model-observer.service';

interface BenchmarkResultRow {
  rank: number;
  assetId: string;
  modelName: string;
  benchmarkModelType: 'output' | 'metric';
  sampleCount: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  throughputRps: number;
  accuracyPercent: number | null;
  metrics: Record<string, number>;
  score: number;
}

interface BenchmarkAccumulator {
  assetId: string;
  modelName: string;
  benchmarkModelType: 'output' | 'metric';
  sampleCount: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  throughputRps: number;
  accuracyPercent: number | null;
  metrics: Record<string, number>;
}

type TaskFilter = 'all' | 'classification' | 'regression' | 'nlp' | 'vision' | 'other';

const TASK_FILTER_OPTIONS: { value: TaskFilter; label: string }[] = [
  { value: 'all', label: 'All Tasks' },
  { value: 'classification', label: 'Classification' },
  { value: 'regression', label: 'Regression' },
  { value: 'nlp', label: 'NLP' },
  { value: 'vision', label: 'Vision' },
  { value: 'other', label: 'Other' },
];

interface ProbeResult {
  success: boolean;
  latencyMs: number;
  evaluated: boolean;
  correct: boolean;
  output?: unknown;
  errorMessage?: string;
}

interface ObserverRunContext {
  benchmarkRunId?: string;
  correlationId?: string;
}

interface AgreementPair {
  agreement: ContractAgreement;
  negotiation: ContractNegotiation;
}

@Component({
  selector: 'app-model-benchmarking',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './model-benchmarking.component.html',
})
export class ModelBenchmarkingComponent implements OnInit, OnDestroy {
  private readonly executionService = inject(DashboardModelExecutionService);
  private readonly browserService = inject(DashboardMlBrowserService);
  private readonly observerService = inject(DashboardModelObserverService);
  private readonly transferService = inject(ContractAndTransferService);
  private readonly modalAndAlertService = inject(ModalAndAlertService);
  private readonly destroy$ = new Subject<void>();

  executableAssets: ExecutableAsset[] = [];
  selectedAssetIds = new Set<string>();
  searchKeyword = '';
  activeTaskFilter: TaskFilter = 'all';
  showOnlyCompatibleModels = true;
  readonly taskFilterOptions = TASK_FILTER_OPTIONS;
  dataspaceDatasetAssets: MlGuiAsset[] = [];
  selectedDataspaceDatasetId = '';
  dataspaceDatasetSearch = '';
  datasetRows: Record<string, unknown>[] = [];
  datasetFileName = '';
  datasetParseMessage = '';
  datasetPreview = '';

  loadingAssets = false;
  loadingDataspaceDatasets = false;
  loadingDatasetFromDataspace = false;
  runningBenchmark = false;
  runningValidation = false;
  errorMessage = '';
  benchmarkErrors: string[] = [];
  results: BenchmarkResultRow[] = [];
  availableMetrics: string[] = [];
  selectedMetrics: string[] = [];
  rankingMetric = 'score';

  completedRequests = 0;
  totalRequests = 0;
  statusMessage = 'Select at least two models, load/upload a dataset, and run benchmark.';

  inputPath = '';
  expectedPath = '';
  predictionPath = '';
  requestTimeoutMs = 15000;
  benchmarkParallelism = 8;
  validationParallelism = 6;
  validationSampleRows = 3;
  private readonly batchBenchmarkSize = 64;
  private readonly transferPollIntervalMs = 500;
  private readonly transferPollTimeoutMs = 120000;
  private readonly metricDefaults: Record<'classification' | 'regression', string[]> = {
    classification: ['Accuracy', 'Precision', 'Recall', 'F1 Score'],
    regression: ['RMSE', 'MAE', 'MSE', 'R2'],
  };
  private readonly lowerIsBetterMetrics = ['RMSE', 'MAE', 'MSE', 'averageLatencyMs', 'p95LatencyMs'];

  ngOnInit(): void {
    this.loadExecutableAssets();
    this.loadDataspaceDatasets();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get selectedModelCount(): number {
    return this.selectedAssetIds.size;
  }

  get filteredExecutableAssets(): ExecutableAsset[] {
    const query = this.searchKeyword.trim().toLowerCase();
    const reference = this.getCompatibilityReferenceAsset();

    return this.executableAssets.filter(asset => {
      if (query.length > 0) {
        const haystack = [
          asset.name,
          asset.id,
          ...(asset.tags || []),
          ...(asset.tasks || []),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }

      const task = this.detectAssetTask(asset);
      if (this.activeTaskFilter !== 'all' && task !== this.activeTaskFilter) {
        return false;
      }

      if (this.showOnlyCompatibleModels && reference && !this.selectedAssetIds.has(asset.id)) {
        return this.areAssetsCompatible(reference, asset);
      }

      return true;
    });
  }

  get filteredDataspaceDatasetAssets(): MlGuiAsset[] {
    const query = this.dataspaceDatasetSearch.trim().toLowerCase();
    return this.dataspaceDatasetAssets.filter(asset => {
      if (!this.isDataspaceDatasetLoadable(asset)) {
        return false;
      }
      if (!query.length) {
        return true;
      }
      const haystack = [
        asset.name,
        asset.id,
        asset.description,
        ...(asset.keywords || []),
        ...(asset.tasks || []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  get canLoadSelectedDataspaceDataset(): boolean {
    return (
      !!this.selectedDataspaceDatasetId &&
      !this.runningBenchmark &&
      !this.runningValidation &&
      !this.loadingDatasetFromDataspace
    );
  }

  get canValidateInput(): boolean {
    return (
      this.selectedModelCount > 0 &&
      this.datasetRows.length > 0 &&
      !this.runningBenchmark &&
      !this.runningValidation &&
      !this.loadingDatasetFromDataspace
    );
  }

  get canRunBenchmark(): boolean {
    return (
      this.selectedModelCount >= 2 &&
      this.datasetRows.length > 0 &&
      this.selectedMetrics.length > 0 &&
      !this.runningBenchmark &&
      !this.runningValidation &&
      !this.loadingDatasetFromDataspace
    );
  }

  get progressPercent(): number {
    if (this.totalRequests <= 0) {
      return 0;
    }
    return Math.min(100, Math.round((this.completedRequests / this.totalRequests) * 100));
  }

  get topResult(): BenchmarkResultRow | null {
    return this.results.length > 0 ? this.results[0] : null;
  }

  get hasAccuracy(): boolean {
    return this.results.some(result => result.accuracyPercent !== null);
  }

  loadExecutableAssets(): void {
    this.loadingAssets = true;
    this.errorMessage = '';

    this.executionService
      .getExecutableAssets()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: assets => {
          this.executableAssets = assets;
          this.selectedAssetIds = this.sanitizeSelectedAssetIds(this.selectedAssetIds, assets);
          this.syncMetricSelection();
          this.loadingAssets = false;
          if (assets.length === 0) {
            this.statusMessage = 'No executable assets found for benchmark.';
          }
        },
        error: error => {
          this.loadingAssets = false;
          this.errorMessage = this.toErrorMessage(error, 'Failed to load executable assets.');
        },
      });
  }

  refreshAssetSources(): void {
    this.loadExecutableAssets();
    this.loadDataspaceDatasets();
  }

  loadDataspaceDatasets(): void {
    this.loadingDataspaceDatasets = true;
    this.errorMessage = '';

    this.browserService
      .getMachineLearningAssets()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: assets => {
          const datasetAssets = assets
            .filter(asset => this.looksLikeDatasetAsset(asset))
            .filter(asset => this.isDataspaceDatasetLoadable(asset))
            .sort((left, right) => left.name.localeCompare(right.name));
          this.dataspaceDatasetAssets = datasetAssets;

          if (this.selectedDataspaceDatasetId && !datasetAssets.some(asset => asset.id === this.selectedDataspaceDatasetId)) {
            this.selectedDataspaceDatasetId = '';
          }

          this.loadingDataspaceDatasets = false;
        },
        error: error => {
          this.loadingDataspaceDatasets = false;
          this.errorMessage = this.toErrorMessage(error, 'Failed to load dataspace datasets.');
        },
      });
  }

  onAssetSelectionChange(assetId: string, event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const checked = input?.checked ?? false;
    const asset = this.executableAssets.find(item => item.id === assetId);
    if (!asset) {
      return;
    }

    if (checked) {
      const selectable = this.isAssetSelectable(asset);
      if (!selectable.allowed) {
        if (input) {
          input.checked = false;
        }
        this.modalAndAlertService.showAlert(selectable.reason, 'Incompatible model', 'warning', 5);
        return;
      }
      this.selectedAssetIds.add(assetId);
      this.syncMetricSelection();
      return;
    }

    this.selectedAssetIds.delete(assetId);
    this.syncMetricSelection();
  }

  setTaskFilter(filter: TaskFilter): void {
    this.activeTaskFilter = filter;
  }

  clearSearch(): void {
    this.searchKeyword = '';
  }

  isAssetDisabledForSelection(asset: ExecutableAsset): boolean {
    if (this.runningBenchmark || this.runningValidation || this.loadingDatasetFromDataspace) {
      return true;
    }
    if (this.selectedAssetIds.has(asset.id)) {
      return false;
    }
    return !this.isAssetSelectable(asset).allowed;
  }

  getAssetTaskLabel(asset: ExecutableAsset): string {
    const task = this.detectAssetTask(asset);
    if (task === 'all') {
      return 'other';
    }
    return task;
  }

  clearSelection(): void {
    this.selectedAssetIds.clear();
    this.syncMetricSelection();
  }

  selectAllAssets(): void {
    const candidates = this.filteredExecutableAssets;
    if (candidates.length === 0) {
      return;
    }

    const current = this.getSelectedAssetsInOrder();
    const reference = current[0] || candidates.find(asset => this.normalizeSchemaFields(asset.inputSchemaFields || []).length > 0);
    if (!reference) {
      this.modalAndAlertService.showAlert(
        'No model with input schema metadata is available for benchmark selection.',
        'Missing schema',
        'warning',
        5,
      );
      return;
    }

    const compatible = candidates.filter(asset => this.areAssetsCompatible(reference, asset));
    this.selectedAssetIds = new Set(compatible.map(asset => asset.id));
    this.syncMetricSelection();
  }

  toggleMetric(metric: string): void {
    if (this.runningBenchmark || this.runningValidation || this.loadingDatasetFromDataspace) {
      return;
    }

    if (this.selectedMetrics.includes(metric)) {
      this.selectedMetrics = this.selectedMetrics.filter(item => item !== metric);
    } else {
      this.selectedMetrics = [...this.selectedMetrics, metric];
    }

    if (this.selectedMetrics.length === 0) {
      this.rankingMetric = 'score';
      return;
    }

    if (this.rankingMetric !== 'score' && !this.selectedMetrics.includes(this.rankingMetric)) {
      this.rankingMetric = this.selectedMetrics[0];
    }
  }

  sortResultsBy(metric: string): void {
    this.rankingMetric = metric;
    if (this.results.length > 0) {
      this.results = this.rankResults(this.results);
    }
  }

  isMetricSelected(metric: string): boolean {
    return this.selectedMetrics.includes(metric);
  }

  isAssetSelected(assetId: string): boolean {
    return this.selectedAssetIds.has(assetId);
  }

  onDataspaceDatasetSelectionChange(assetId: string): void {
    this.selectedDataspaceDatasetId = assetId;
    const asset = this.dataspaceDatasetAssets.find(item => item.id === assetId);
    if (asset) {
      this.applyDatasetMappingHints(asset);
    }
  }

  clearDataspaceDatasetSearch(): void {
    this.dataspaceDatasetSearch = '';
  }

  getDataspaceDatasetSource(asset: MlGuiAsset): string {
    return asset.isLocal ? 'local' : 'external';
  }

  isDataspaceDatasetLoadable(asset: MlGuiAsset): boolean {
    if (asset.isLocal) {
      return true;
    }
    return !!asset.hasAgreement;
  }

  async loadSelectedDatasetFromDataspace(): Promise<void> {
    this.errorMessage = '';
    this.datasetParseMessage = '';
    this.results = [];

    if (!this.selectedDataspaceDatasetId) {
      this.errorMessage = 'Select a dataspace dataset first.';
      return;
    }

    const selectedAsset = this.dataspaceDatasetAssets.find(asset => asset.id === this.selectedDataspaceDatasetId);
    if (!selectedAsset) {
      this.errorMessage = 'Selected dataspace dataset no longer exists.';
      return;
    }

    if (!this.isDataspaceDatasetLoadable(selectedAsset)) {
      this.errorMessage =
        'Selected external dataset has no contract agreement. Negotiate and finalize a consumer agreement first.';
      return;
    }

    this.loadingDatasetFromDataspace = true;
    this.statusMessage = `Loading dataset from dataspace asset "${selectedAsset.name}"...`;

    try {
      const datasetFileName = this.resolveDatasetAssetFileName(selectedAsset);
      this.applyDatasetMappingHints(selectedAsset);
      const inlineRows = this.extractInlineDatasetRows(selectedAsset, datasetFileName);

      if (inlineRows) {
        const sourceLabel = selectedAsset.isLocal ? '[dataspace-local]' : '[dataspace-inline]';
        this.applyLoadedDataset(inlineRows, `${sourceLabel} ${datasetFileName}`);
      } else if (selectedAsset.isLocal) {
        throw new Error(
          'Local dataset asset does not include inline dataset payload metadata. Upload a file or use an external agreed dataset.',
        );
      } else {
        const pair = await this.resolveAgreementForAsset(selectedAsset.id);
        const transferId = await this.startPullTransfer(pair);
        await this.waitForTransferReady(transferId.id);
        const blob = await this.downloadTransferBlob(transferId.id);
        const text = await blob.text();
        const rows = this.parseDataset(datasetFileName, text);
        this.applyLoadedDataset(rows, `[dataspace] ${datasetFileName}`);
      }

      this.datasetParseMessage = `Loaded ${this.datasetRows.length} rows from dataspace asset "${selectedAsset.name}".`;
      this.statusMessage = 'Dataset loaded from dataspace. Select models and run benchmark.';
      this.modalAndAlertService.showAlert('Dataset loaded from dataspace asset.', 'Dataset', 'success', 4);
    } catch (error) {
      this.datasetRows = [];
      this.datasetFileName = '';
      this.datasetPreview = '';
      this.datasetParseMessage = '';
      const resolvedMessage = this.toErrorMessage(error, 'Failed to load dataset from dataspace asset.');
      this.errorMessage = /\/public.*unknown error/i.test(resolvedMessage)
        ? 'Dataset download failed at data plane /public endpoint (network/CORS or transfer source issue). For benchmark datasets, prefer assets with inline "daimo:benchmark_dataset" rows.'
        : resolvedMessage;
      this.statusMessage = 'Dataset load from dataspace failed.';
    } finally {
      this.loadingDatasetFromDataspace = false;
    }
  }

  onDatasetFileChange(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.item(0);
    if (!file) {
      return;
    }

    void this.readDatasetFile(file);
  }

  clearDataset(): void {
    this.datasetRows = [];
    this.datasetFileName = '';
    this.datasetParseMessage = '';
    this.datasetPreview = '';
    this.results = [];
    this.errorMessage = '';
  }

  async validateInput(): Promise<void> {
    this.errorMessage = '';
    this.benchmarkErrors = [];

    if (this.selectedModelCount === 0) {
      this.errorMessage = 'Select at least one model before validating input.';
      return;
    }
    if (this.datasetRows.length === 0) {
      this.errorMessage = 'Upload a dataset before validating input.';
      return;
    }

    const selectedAssets = this.getSelectedAssetsInOrder();
    this.syncMetricSelection();
    const sampleRows = this.datasetRows.slice(0, Math.max(1, Math.min(this.validationSampleRows, this.datasetRows.length)));
    const schemaValidationErrors = this.validateBenchmarkSchema(selectedAssets, sampleRows);
    if (schemaValidationErrors.length > 0) {
      this.errorMessage = schemaValidationErrors[0];
      this.benchmarkErrors = schemaValidationErrors.slice(0, 25);
      this.statusMessage = 'Input validation failed.';
      return;
    }

    this.runningValidation = true;
    this.totalRequests = selectedAssets.length * sampleRows.length;
    this.completedRequests = 0;
    this.statusMessage = `Validating input with ${sampleRows.length} sample row(s)...`;

    const checks: { asset: ExecutableAsset; row: Record<string, unknown>; rowIndex: number }[] = [];
    selectedAssets.forEach(asset => {
      sampleRows.forEach((row, rowIndex) => {
        checks.push({ asset, row, rowIndex });
      });
    });

    try {
      const outcomes = await this.mapWithConcurrency(
        checks,
        Math.max(1, this.validationParallelism),
        async check => {
          const result = await this.executeProbe(check.asset, check.row);
          this.completedRequests += 1;
          if (this.completedRequests % 25 === 0) {
            await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
          if (!result.success && result.errorMessage) {
            this.recordBenchmarkError(check.asset.name, result.errorMessage);
          }
          return result;
        },
      );

      const successCount = outcomes.filter(outcome => outcome.success).length;
      const failureCount = outcomes.length - successCount;
      if (failureCount === 0) {
        this.statusMessage = `Input validation passed (${successCount}/${outcomes.length} checks succeeded).`;
        this.modalAndAlertService.showAlert('Input validation passed for selected models.', 'Validation', 'success', 4);
      } else {
        this.statusMessage = `Input validation found issues (${failureCount}/${outcomes.length} checks failed).`;
        this.modalAndAlertService.showAlert(
          `Input validation found ${failureCount} failing sample request(s).`,
          'Validation',
          'warning',
          5,
        );
      }
    } catch (error) {
      this.errorMessage = this.toErrorMessage(error, 'Input validation failed unexpectedly.');
      this.statusMessage = 'Input validation failed.';
    } finally {
      this.runningValidation = false;
    }
  }

  async runBenchmark(): Promise<void> {
    this.errorMessage = '';
    this.benchmarkErrors = [];
    this.results = [];

    if (this.selectedModelCount < 2) {
      this.errorMessage = 'Select at least two models to benchmark.';
      return;
    }
    if (this.datasetRows.length === 0) {
      this.errorMessage = 'Upload a dataset before running benchmark.';
      return;
    }

    const selectedAssets = this.getSelectedAssetsInOrder();
    this.syncMetricSelection();
    const schemaValidationErrors = this.validateBenchmarkSchema(selectedAssets, this.datasetRows);
    if (schemaValidationErrors.length > 0) {
      this.errorMessage = schemaValidationErrors[0];
      this.benchmarkErrors = schemaValidationErrors.slice(0, 25);
      this.statusMessage = 'Benchmark blocked: schema validation failed.';
      return;
    }

    this.totalRequests = selectedAssets.length * this.datasetRows.length;
    this.completedRequests = 0;
    this.runningBenchmark = true;
    this.statusMessage = `Benchmark running (${this.benchmarkParallelism} parallel requests/model)...`;

    const accumulators: BenchmarkAccumulator[] = [];
    const benchmarkRunId = this.createRunId();
    const correlationId = this.createRunId();

    try {
      for (const asset of selectedAssets) {
        this.statusMessage = `Benchmarking ${asset.name}...`;
        const accumulator = await this.runBenchmarkForAsset(asset, { benchmarkRunId, correlationId });
        accumulators.push(accumulator);
      }

      this.results = this.rankResults(accumulators);
      const best = this.results[0];
      this.statusMessage = best
        ? `Benchmark completed. Best model: ${best.modelName} (score ${best.score.toFixed(2)}).`
        : 'Benchmark completed.';
      this.recordBenchmarkObserverEvent('BENCHMARK_COMPLETED', benchmarkRunId, correlationId, selectedAssets);
      this.modalAndAlertService.showAlert('Benchmark completed successfully.', 'Benchmark', 'success', 4);
    } catch (error) {
      this.errorMessage = this.toErrorMessage(error, 'Benchmark failed unexpectedly.');
      this.statusMessage = 'Benchmark failed.';
      this.recordBenchmarkObserverEvent(
        'BENCHMARK_FAILED',
        benchmarkRunId,
        correlationId,
        selectedAssets,
        this.errorMessage,
      );
    } finally {
      this.runningBenchmark = false;
    }
  }

  private async runBenchmarkForAsset(
    asset: ExecutableAsset,
    observerContext: ObserverRunContext,
  ): Promise<BenchmarkAccumulator> {
    if (this.isMetricBenchmarkModel(asset)) {
      return this.runMetricBenchmarkForAsset(asset, observerContext);
    }

    const modelStart = performance.now();
    const outcomes = asset.requestShape === 'batch'
      ? await this.runBatchBenchmarkForAsset(asset, observerContext)
      : await this.runSingleBenchmarkForAsset(asset, observerContext);

    const latencies = outcomes.filter(outcome => outcome.success).map(outcome => outcome.latencyMs);
    const successCount = outcomes.filter(outcome => outcome.success).length;
    const errorCount = outcomes.length - successCount;
    const evaluatedCount = outcomes.filter(outcome => outcome.evaluated).length;
    const correctCount = outcomes.filter(outcome => outcome.evaluated && outcome.correct).length;
    const outputs = outcomes.map(outcome => outcome.output);
    const metrics = this.calculateLocalMetrics(asset, this.datasetRows, outputs);

    const elapsedMs = Math.max(1, performance.now() - modelStart);
    const sampleCount = this.datasetRows.length;
    const successRate = sampleCount > 0 ? (successCount / sampleCount) * 100 : 0;
    const accuracyMetric = this.findMetricValue(metrics, 'Accuracy');
    const accuracyPercent = Number.isFinite(accuracyMetric)
      ? accuracyMetric * 100
      : evaluatedCount > 0
        ? (correctCount / evaluatedCount) * 100
        : null;

    return {
      assetId: asset.id,
      modelName: asset.name,
      benchmarkModelType: asset.benchmarkModelType || 'output',
      sampleCount,
      successCount,
      errorCount,
      successRate,
      averageLatencyMs: this.average(latencies),
      p95LatencyMs: this.percentile(latencies, 0.95),
      throughputRps: successCount / (elapsedMs / 1000),
      accuracyPercent,
      metrics,
    };
  }

  private async runMetricBenchmarkForAsset(
    asset: ExecutableAsset,
    observerContext: ObserverRunContext,
  ): Promise<BenchmarkAccumulator> {
    const startedAt = performance.now();
    try {
      const response = await firstValueFrom(
        this.executionService
          .executeModel({
            assetId: asset.id,
            modelName: asset.name,
            payload: this.datasetRows,
            path: asset.executionPath,
            benchmarkRunId: observerContext.benchmarkRunId,
            correlationId: observerContext.correlationId,
            usageSessionId: observerContext.correlationId,
          })
          .pipe(timeout(this.requestTimeoutMs)),
      );

      const elapsedMs = Math.max(0, performance.now() - startedAt);
      this.completedRequests += this.datasetRows.length;
      await this.yieldProgressIfNeeded();
      const metrics = this.extractMetricModelMetrics(response.output);
      if (Object.keys(metrics).length === 0) {
        throw new Error('Metric model did not return any selected benchmark metric.');
      }

      return {
        assetId: asset.id,
        modelName: asset.name,
        benchmarkModelType: 'metric',
        sampleCount: this.datasetRows.length,
        successCount: this.datasetRows.length,
        errorCount: 0,
        successRate: 100,
        averageLatencyMs: elapsedMs / Math.max(this.datasetRows.length, 1),
        p95LatencyMs: elapsedMs,
        throughputRps: this.datasetRows.length / Math.max(elapsedMs / 1000, 0.001),
        accuracyPercent: this.metricAsPercent(metrics, 'Accuracy'),
        metrics,
      };
    } catch (error) {
      const message = this.toErrorMessage(error, 'Metric model execution failed.');
      this.recordBenchmarkError(asset.name, message);
      return {
        assetId: asset.id,
        modelName: asset.name,
        benchmarkModelType: 'metric',
        sampleCount: this.datasetRows.length,
        successCount: 0,
        errorCount: this.datasetRows.length,
        successRate: 0,
        averageLatencyMs: Math.max(0, performance.now() - startedAt),
        p95LatencyMs: Math.max(0, performance.now() - startedAt),
        throughputRps: 0,
        accuracyPercent: null,
        metrics: {},
      };
    }
  }

  private async runSingleBenchmarkForAsset(
    asset: ExecutableAsset,
    observerContext: ObserverRunContext,
  ): Promise<ProbeResult[]> {
    return this.mapWithConcurrency(
      this.datasetRows,
      Math.max(1, this.benchmarkParallelism),
      async row => {
        const result = await this.executeProbe(asset, row, observerContext);
        this.completedRequests += 1;
        await this.yieldProgressIfNeeded();
        if (!result.success && result.errorMessage) {
          this.recordBenchmarkError(asset.name, result.errorMessage);
        }
        return result;
      },
    );
  }

  private async runBatchBenchmarkForAsset(
    asset: ExecutableAsset,
    observerContext: ObserverRunContext,
  ): Promise<ProbeResult[]> {
    const batches = this.chunkRows(this.datasetRows, this.batchBenchmarkSize);
    const batchOutcomes = await this.mapWithConcurrency(
      batches,
      Math.max(1, this.benchmarkParallelism),
      async rows => {
        const results = await this.executeBatchProbe(asset, rows, observerContext);
        this.completedRequests += rows.length;
        await this.yieldProgressIfNeeded();
        results.forEach(result => {
          if (!result.success && result.errorMessage) {
            this.recordBenchmarkError(asset.name, result.errorMessage);
          }
        });
        return results;
      },
    );

    return batchOutcomes.flat();
  }

  private async yieldProgressIfNeeded(): Promise<void> {
    if (this.completedRequests % 25 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }

  private chunkRows<T>(rows: T[], size: number): T[][] {
    const chunks: T[][] = [];
    const chunkSize = Math.max(1, size);
    for (let index = 0; index < rows.length; index += chunkSize) {
      chunks.push(rows.slice(index, index + chunkSize));
    }
    return chunks;
  }

  private recordBenchmarkObserverEvent(
    eventType: 'BENCHMARK_COMPLETED' | 'BENCHMARK_FAILED',
    benchmarkRunId: string,
    correlationId: string,
    selectedAssets: ExecutableAsset[],
    errorMessage = '',
  ): void {
    const best = this.results[0] || null;
    const primaryAsset = best
      ? selectedAssets.find(asset => asset.id === best.assetId) || selectedAssets[0] || null
      : selectedAssets[0] || null;

    this.observerService
      .recordEvent({
        eventType,
        category: 'benchmark',
        sourceComponent: 'data-dashboard:model-benchmarking',
        benchmarkRunId,
        correlationId,
        assetId: best?.assetId || primaryAsset?.id || '',
        modelId: best?.assetId || primaryAsset?.id || '',
        modelName: best?.modelName || primaryAsset?.name || '',
        taskType: this.primaryTaskType(primaryAsset),
        datasetFingerprint: this.datasetFingerprint(),
        datasetRowCount: this.datasetRows.length,
        selectedMetrics: this.selectedBenchmarkMetrics(),
        benchmarkSummary: this.benchmarkSummary(best, selectedAssets, errorMessage),
        latencyMs: best?.averageLatencyMs ?? undefined,
        status: eventType === 'BENCHMARK_COMPLETED' ? 'COMPLETED' : 'FAILED',
        details: {
          correlationId,
          datasetFileName: this.datasetFileName,
          selectedDatasetAssetId: this.selectedDataspaceDatasetId,
          selectedModels: selectedAssets.map(asset => ({
            assetId: asset.id,
            name: asset.name,
            tasks: asset.tasks,
            tags: asset.tags,
          })),
          mapping: {
            inputPath: this.inputPath,
            expectedPath: this.expectedPath,
            predictionPath: this.predictionPath,
          },
          results: this.results,
          errors: this.benchmarkErrors,
          error: errorMessage,
        },
        metrics: {
          modelCount: selectedAssets.length,
          sampleCount: this.datasetRows.length,
          bestScore: best?.score ?? null,
          bestSuccessRate: best?.successRate ?? null,
          bestAverageLatencyMs: best?.averageLatencyMs ?? null,
          bestP95LatencyMs: best?.p95LatencyMs ?? null,
          bestAccuracyPercent: best?.accuracyPercent ?? null,
          timeoutMs: this.requestTimeoutMs,
          benchmarkParallelism: this.benchmarkParallelism,
        },
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        error: error => {
          this.recordBenchmarkError('Model Observer', this.toErrorMessage(error, 'Failed to record benchmark event.'));
        },
      });
  }

  private primaryTaskType(asset: ExecutableAsset | null): string {
    const task = (asset?.tasks || []).find(value => value.trim().length > 0);
    if (task) {
      return task;
    }
    return this.activeTaskFilter === 'all' ? '' : this.activeTaskFilter;
  }

  private selectedBenchmarkMetrics(): string[] {
    return ['successRate', 'averageLatencyMs', 'p95LatencyMs', 'throughputRps', ...this.selectedMetrics];
  }

  private benchmarkSummary(
    best: BenchmarkResultRow | null,
    selectedAssets: ExecutableAsset[],
    errorMessage: string,
  ): Record<string, unknown> {
    return {
      bestAssetId: best?.assetId || '',
      bestModelName: best?.modelName || '',
      modelCount: selectedAssets.length,
      sampleCount: this.datasetRows.length,
      bestScore: best?.score ?? null,
      bestSuccessRate: best?.successRate ?? null,
      bestAverageLatencyMs: best?.averageLatencyMs ?? null,
      bestP95LatencyMs: best?.p95LatencyMs ?? null,
      bestAccuracyPercent: best?.accuracyPercent ?? null,
      error: errorMessage,
    };
  }

  private datasetFingerprint(): string {
    const raw = JSON.stringify({
      datasetFileName: this.datasetFileName,
      selectedDatasetAssetId: this.selectedDataspaceDatasetId,
      rowCount: this.datasetRows.length,
      rows: this.datasetRows,
    });
    return `fnv1a32:${this.hashText(raw)}`;
  }

  private hashText(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  private createRunId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `benchmark-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  exportResultsCsv(): void {
    if (this.results.length === 0) {
      return;
    }

    const headers = [
      'rank',
      'modelName',
      'assetId',
      'benchmarkModelType',
      'samples',
      'successes',
      'errors',
      'successRate',
      'avgLatencyMs',
      'p95LatencyMs',
      'throughputRps',
      'accuracyPercent',
      ...this.selectedMetrics,
      'score',
    ];

    const lines = this.results.map(result =>
      [
        result.rank,
        result.modelName,
        result.assetId,
        result.benchmarkModelType,
        result.sampleCount,
        result.successCount,
        result.errorCount,
        result.successRate.toFixed(2),
        result.averageLatencyMs.toFixed(2),
        result.p95LatencyMs.toFixed(2),
        result.throughputRps.toFixed(2),
        result.accuracyPercent === null ? '' : result.accuracyPercent.toFixed(2),
        ...this.selectedMetrics.map(metric => result.metrics[metric] === undefined ? '' : result.metrics[metric].toFixed(6)),
        result.score.toFixed(2),
      ]
        .map(value => this.toCsvValue(value))
        .join(','),
    );

    const csvContent = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `model-benchmark-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private looksLikeDatasetAsset(asset: MlGuiAsset): boolean {
    const tokens = [
      asset.name,
      asset.description,
      asset.format,
      asset.contentType,
      ...(asset.keywords || []),
      ...(asset.tasks || []),
    ]
      .join(' ')
      .toLowerCase();

    const hasDatasetSignal =
      /\b(dataset|benchmark|ground[- ]truth|samples|evaluation|test[- ]set)\b/.test(tokens) ||
      /\b(csv|json|jsonl|ndjson)\b/.test(tokens);

    const hasModelSignal =
      /\b(inference|endpoint|model-serving|serve|predictor)\b/.test(tokens) || this.hasInferenceMetadata(asset);

    return hasDatasetSignal && !hasModelSignal;
  }

  private hasInferenceMetadata(asset: MlGuiAsset): boolean {
    const direct = asset.rawProperties || {};
    const nested = (asset.rawProperties?.['properties'] as Record<string, unknown>) || {};
    const directDaimo = this.extractDaimoMetadata(direct);
    const nestedDaimo = this.extractDaimoMetadata(nested);
    const keys = [
      'https://w3id.org/pionera/daimo#inferencePath',
      'daimo:inferencePath',
      'inferencePath',
      'path',
    ];
    return keys.some(key => {
      const directDaimoValue = directDaimo[key];
      if (typeof directDaimoValue === 'string' && directDaimoValue.trim().length > 0) {
        return true;
      }
      const nestedDaimoValue = nestedDaimo[key];
      if (typeof nestedDaimoValue === 'string' && nestedDaimoValue.trim().length > 0) {
        return true;
      }
      const directValue = direct[key];
      if (typeof directValue === 'string' && directValue.trim().length > 0) {
        return true;
      }
      const nestedValue = nested[key];
      return typeof nestedValue === 'string' && nestedValue.trim().length > 0;
    });
  }

  private resolveDatasetAssetFileName(asset: MlGuiAsset): string {
    const name = (asset.fileName || asset.name || asset.id || 'dataspace-dataset').trim();
    if (/\.(jsonl|json|csv)$/i.test(name)) {
      return name;
    }

    const formatHint = [asset.format, asset.contentType].join(' ').toLowerCase();
    if (formatHint.includes('jsonl') || formatHint.includes('ndjson')) {
      return `${name}.jsonl`;
    }
    if (formatHint.includes('csv')) {
      return `${name}.csv`;
    }
    if (formatHint.includes('json')) {
      return `${name}.json`;
    }
    return `${name}.json`;
  }

  private extractInlineDatasetRows(asset: MlGuiAsset, datasetFileName: string): Record<string, unknown>[] | null {
    const sources: Record<string, unknown>[] = [];
    if (this.isRecord(asset.rawProperties)) {
      sources.push(asset.rawProperties);
      sources.push(this.extractDaimoMetadata(asset.rawProperties));
    }
    const nested = asset.rawProperties?.['properties'];
    if (this.isRecord(nested)) {
      sources.push(nested);
      sources.push(this.extractDaimoMetadata(nested));
    }
    if (this.isRecord(asset.assetData)) {
      sources.push(asset.assetData);
    }

    const candidateKeys = [
      'daimo:benchmark_dataset',
      'https://w3id.org/pionera/daimo#benchmark_dataset',
      'benchmark_dataset',
      'benchmarkDataset',
      'dataset',
      'data',
      'samples',
    ];

    for (const source of sources) {
      for (const key of candidateKeys) {
        if (!(key in source)) {
          continue;
        }
        const value = source[key];
        if (value === undefined || value === null) {
          continue;
        }

        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (!trimmed.length) {
            continue;
          }
          try {
            return this.parseDataset(datasetFileName, trimmed);
          } catch {
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
              return this.parseDataset(`${datasetFileName}.json`, trimmed);
            }
          }
          continue;
        }

        if (Array.isArray(value) || this.isRecord(value)) {
          const jsonText = JSON.stringify(value);
          return this.parseDataset(`${datasetFileName}.json`, jsonText);
        }
      }
    }

    return null;
  }

  private applyDatasetMappingHints(asset: MlGuiAsset): void {
    const mapping = this.extractDatasetMappingHints(asset);
    if (!mapping) {
      return;
    }

    if (!this.inputPath.trim() && mapping.inputPath) {
      this.inputPath = mapping.inputPath;
    }
    if (!this.expectedPath.trim() && mapping.expectedPath) {
      this.expectedPath = mapping.expectedPath;
    }
    if (!this.predictionPath.trim() && mapping.predictionPath) {
      this.predictionPath = mapping.predictionPath;
    }
  }

  private extractDatasetMappingHints(asset: MlGuiAsset): {
    inputPath: string;
    expectedPath: string;
    predictionPath: string;
  } | null {
    const sources: Record<string, unknown>[] = [];
    if (this.isRecord(asset.rawProperties)) {
      sources.push(asset.rawProperties);
      sources.push(this.extractDaimoMetadata(asset.rawProperties));
    }
    const nested = asset.rawProperties?.['properties'];
    if (this.isRecord(nested)) {
      sources.push(nested);
      sources.push(this.extractDaimoMetadata(nested));
    }
    if (this.isRecord(asset.assetData)) {
      sources.push(asset.assetData);
    }

    const mappingKeys = [
      'daimo:benchmark_dataset_mapping',
      'https://w3id.org/pionera/daimo#benchmark_dataset_mapping',
      'benchmark_dataset_mapping',
      'benchmarkDatasetMapping',
      'mapping',
    ];

    const explicitInputPath = this.readFirstFieldPath(sources, [
      'daimo:input',
      'https://w3id.org/pionera/daimo#input',
      'input',
    ]);
    const explicitExpectedPath = this.readFirstFieldPath(sources, [
      'daimo:label',
      'https://w3id.org/pionera/daimo#label',
      'label',
    ]);

    for (const source of sources) {
      for (const key of mappingKeys) {
        if (!(key in source)) {
          continue;
        }
        const raw = source[key];
        const mapping = this.parseDatasetMappingValue(raw);
        if (!mapping) {
          continue;
        }

        const inputPath = this.readMappingPath(mapping, ['input', 'inputPath']);
        const expectedPath = this.readMappingPath(mapping, [
          'label',
          'expectedPath',
        ]);
        const predictionPath = this.readMappingPath(mapping, [
          'predictionPath',
        ]);

        if (inputPath || expectedPath || predictionPath) {
          return {
            inputPath: explicitInputPath || inputPath,
            expectedPath: explicitExpectedPath || expectedPath,
            predictionPath,
          };
        }
      }
    }

    if (explicitInputPath || explicitExpectedPath) {
      return {
        inputPath: explicitInputPath,
        expectedPath: explicitExpectedPath,
        predictionPath: '',
      };
    }

    return null;
  }

  private parseDatasetMappingValue(value: unknown): Record<string, unknown> | null {
    if (this.isRecord(value)) {
      return value;
    }
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed.length) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return this.isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private readMappingPath(mapping: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
      const value = mapping[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return '';
  }

  private readFirstFieldPath(sources: Record<string, unknown>[], keys: string[]): string {
    for (const source of sources) {
      for (const key of keys) {
        const fieldPath = this.readFieldPathValue(source[key]);
        if (fieldPath) {
          return fieldPath;
        }
      }
    }
    return '';
  }

  private readFieldPathValue(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const first = value.find(item => typeof item === 'string' && item.trim().length > 0);
      return typeof first === 'string' ? first.trim() : '';
    }
    return '';
  }

  private applyLoadedDataset(rows: Record<string, unknown>[], fileName: string): void {
    this.datasetRows = rows;
    this.datasetFileName = fileName;
    this.datasetPreview = JSON.stringify(rows.slice(0, 3), null, 2);
    this.results = [];
    this.errorMessage = '';
  }

  private async resolveAgreementForAsset(assetId: string): Promise<AgreementPair> {
    const negotiations = await this.transferService.getAllContractNegotiations({
      sortField: 'createdAt',
      sortOrder: 'DESC',
      filterExpression: [
        {
          operandLeft: 'type',
          operator: '=',
          operandRight: 'CONSUMER',
        },
        {
          operandLeft: 'state',
          operator: '=',
          operandRight: 1200,
        },
      ],
    });

    for (const negotiation of negotiations) {
      try {
        const agreement = await this.transferService.getAgreementForNegotiation(negotiation.id);
        if (agreement.assetId !== assetId) {
          continue;
        }
        const negotiationByAgreement = await this.transferService.getNegotiationByAgreement(agreement.id);
        return {
          agreement,
          negotiation: negotiationByAgreement,
        };
      } catch {
        // Try next finalized negotiation if this one cannot be resolved.
      }
    }

    throw new Error(`No finalized consumer contract agreement found for dataset asset "${assetId}".`);
  }

  private async startPullTransfer(pair: AgreementPair): Promise<IdResponse> {
    const types = await this.transferService.getPossibleTransferTypes(pair.agreement, pair.negotiation);
    const pullType = types.find(type => type.toLowerCase().includes('pull'));
    if (!pullType) {
      throw new Error('No pull transfer type available for selected dataset agreement.');
    }
    if (!pair.negotiation.counterPartyAddress) {
      throw new Error('Selected dataset negotiation has no counterparty address.');
    }

    return this.transferService.initiateTransferProcess({
      transferType: pullType,
      assetId: pair.agreement.assetId,
      contractId: pair.agreement.id,
      counterPartyAddress: pair.negotiation.counterPartyAddress,
    });
  }

  private async waitForTransferReady(transferId: string): Promise<void> {
    const deadline = Date.now() + this.transferPollTimeoutMs;

    while (Date.now() < deadline) {
      const state = await this.transferService.getTransferProcessState(transferId);
      const stateName = String(state.state || '').toUpperCase();

      if (stateName === TransferProcessStates.STARTED || stateName === TransferProcessStates.COMPLETED) {
        return;
      }

      if (
        stateName === TransferProcessStates.TERMINATED ||
        stateName === TransferProcessStates.SUSPENDED ||
        stateName === TransferProcessStates.DEPROVISIONED
      ) {
        throw new Error(`Transfer failed with state ${stateName}.`);
      }

      await this.sleep(this.transferPollIntervalMs);
    }

    throw new Error('Transfer timed out before dataset became available.');
  }

  private async downloadTransferBlob(transferId: string): Promise<Blob> {
    const download$ = await this.transferService.downloadDataset(transferId);
    return firstValueFrom(
      download$.pipe(
        filter(event => event.type === HttpEventType.Response),
        map(event => event.body as Blob),
        timeout(this.transferPollTimeoutMs),
      ),
    );
  }

  private sleep(durationMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, durationMs));
  }

  private async readDatasetFile(file: File): Promise<void> {
    try {
      this.errorMessage = '';
      this.datasetParseMessage = '';
      this.results = [];

      const text = await file.text();
      const rows = this.parseDataset(file.name, text);
      this.datasetRows = rows;
      this.datasetFileName = file.name;
      this.datasetPreview = JSON.stringify(rows.slice(0, 3), null, 2);
      this.datasetParseMessage = `Loaded ${rows.length} rows from ${file.name}.`;
      this.statusMessage = 'Dataset loaded. Select models and run benchmark.';
    } catch (error) {
      this.datasetRows = [];
      this.datasetFileName = '';
      this.datasetPreview = '';
      this.datasetParseMessage = '';
      this.errorMessage = this.toErrorMessage(error, 'Failed to parse dataset file.');
    }
  }

  private parseDataset(fileName: string, text: string): Record<string, unknown>[] {
    const normalized = fileName.toLowerCase();
    if (normalized.endsWith('.jsonl')) {
      return this.parseJsonlDataset(text);
    }
    if (normalized.endsWith('.csv')) {
      return this.parseCsvDataset(text);
    }
    if (normalized.endsWith('.json')) {
      return this.parseJsonDataset(text);
    }

    try {
      return this.parseJsonDataset(text);
    } catch {
      try {
        return this.parseJsonlDataset(text);
      } catch {
        return this.parseCsvDataset(text);
      }
    }
  }

  private parseJsonDataset(text: string): Record<string, unknown>[] {
    const parsed = JSON.parse(text) as unknown;

    if (Array.isArray(parsed)) {
      return this.normalizeRows(parsed);
    }

    if (this.isRecord(parsed)) {
      const collectionCandidates = ['rows', 'data', 'items', 'dataset', 'samples'];
      for (const key of collectionCandidates) {
        const value = parsed[key];
        if (Array.isArray(value)) {
          return this.normalizeRows(value);
        }
      }
      return this.normalizeRows([parsed]);
    }

    return this.normalizeRows([parsed]);
  }

  private parseJsonlDataset(text: string): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return;
      }
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (this.isRecord(parsed)) {
          rows.push(parsed);
        } else {
          rows.push({ value: parsed });
        }
      } catch {
        throw new Error(`Invalid JSONL at line ${index + 1}.`);
      }
    });

    if (rows.length === 0) {
      throw new Error('JSONL dataset is empty.');
    }

    return rows;
  }

  private parseCsvDataset(text: string): Record<string, unknown>[] {
    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length < 2) {
      throw new Error('CSV dataset must include header and at least one data row.');
    }

    const headers = this.splitCsvLine(lines[0]).map((header, index) => header || `column_${index + 1}`);
    const rows: Record<string, unknown>[] = [];

    for (let index = 1; index < lines.length; index += 1) {
      const cells = this.splitCsvLine(lines[index]);
      const row: Record<string, unknown> = {};
      headers.forEach((header, columnIndex) => {
        row[header] = this.parseCsvValue(cells[columnIndex] || '');
      });
      rows.push(row);
    }

    return rows;
  }

  private splitCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        const next = line[index + 1];
        if (inQuotes && next === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
        continue;
      }

      current += char;
    }

    values.push(current);
    return values.map(value => value.trim());
  }

  private parseCsvValue(value: string): unknown {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return '';
    }

    if (/^(true|false)$/i.test(trimmed)) {
      return trimmed.toLowerCase() === 'true';
    }

    if (/^[-+]?\d+(\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }
    }

    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  private resolveInputPayload(row: Record<string, unknown>): unknown {
    const trimmedPath = this.inputPath.trim();
    if (trimmedPath.length === 0) {
      return row;
    }

    const value = this.getValueAtPath(row, trimmedPath);
    return value === undefined ? row : value;
  }

  private getValueAtPath(source: unknown, path: string): unknown {
    const normalizedPath = path.trim();
    if (normalizedPath.length === 0) {
      return source;
    }

    const segments = normalizedPath.split('.').map(segment => segment.trim()).filter(segment => segment.length > 0);
    let current: unknown = source;

    for (const segment of segments) {
      if (Array.isArray(current) && /^\d+$/.test(segment)) {
        current = current[Number(segment)];
        continue;
      }

      if (this.isRecord(current) && segment in current) {
        current = current[segment];
        continue;
      }

      return undefined;
    }

    return current;
  }

  private async executeProbe(
    asset: ExecutableAsset,
    row: Record<string, unknown>,
    observerContext: ObserverRunContext = {},
  ): Promise<ProbeResult> {
    const rowPayload = this.resolveInputPayload(row);
    const payload = asset.requestShape === 'batch' ? [rowPayload] : rowPayload;
    const startedAt = performance.now();

    try {
      const response = await firstValueFrom(
        this.executionService
          .executeModel({
            assetId: asset.id,
            modelName: asset.name,
            payload,
            path: asset.executionPath,
            benchmarkRunId: observerContext.benchmarkRunId,
            correlationId: observerContext.correlationId,
            usageSessionId: observerContext.correlationId,
          })
          .pipe(timeout(this.requestTimeoutMs)),
      );

      const output = asset.requestShape === 'batch'
        ? this.expandBatchOutputs(response.output, 1)[0]
        : response.output;
      let evaluated = false;
      let correct = false;
      if (this.expectedPath.trim().length > 0 && this.predictionPath.trim().length > 0) {
        const expected = this.getValueAtPath(row, this.expectedPath);
        const predicted = this.getValueAtPath(output, this.predictionPath);
        if (expected !== undefined && predicted !== undefined) {
          evaluated = true;
          correct = this.sameValue(expected, predicted);
        }
      }

      return {
        success: true,
        latencyMs: Math.max(0, performance.now() - startedAt),
        evaluated,
        correct,
        output,
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Math.max(0, performance.now() - startedAt),
        evaluated: false,
        correct: false,
        errorMessage: this.toErrorMessage(error, 'Execution request failed.'),
      };
    }
  }

  private async executeBatchProbe(
    asset: ExecutableAsset,
    rows: Record<string, unknown>[],
    observerContext: ObserverRunContext = {},
  ): Promise<ProbeResult[]> {
    const payload = rows.map(row => this.resolveInputPayload(row));
    const startedAt = performance.now();

    try {
      const response = await firstValueFrom(
        this.executionService
          .executeModel({
            assetId: asset.id,
            modelName: asset.name,
            payload,
            path: asset.executionPath,
            benchmarkRunId: observerContext.benchmarkRunId,
            correlationId: observerContext.correlationId,
            usageSessionId: observerContext.correlationId,
          })
          .pipe(timeout(this.requestTimeoutMs)),
      );

      const elapsed = Math.max(0, performance.now() - startedAt);
      const perRowLatencyMs = elapsed / Math.max(rows.length, 1);
      const outputs = this.expandBatchOutputs(response.output, rows.length);

      return rows.map((row, index) => {
        const output = outputs[index];
        if (output === undefined || output === null) {
          return {
            success: false,
            latencyMs: perRowLatencyMs,
            evaluated: false,
            correct: false,
            errorMessage: 'Batch response did not contain an output for this row.',
          };
        }

        let evaluated = false;
        let correct = false;
        if (this.expectedPath.trim().length > 0 && this.predictionPath.trim().length > 0) {
          const expected = this.getValueAtPath(row, this.expectedPath);
          const predicted = this.getValueAtPath(output, this.predictionPath);
          if (expected !== undefined && predicted !== undefined) {
            evaluated = true;
            correct = this.sameValue(expected, predicted);
          }
        }

        return {
          success: true,
          latencyMs: perRowLatencyMs,
          evaluated,
          correct,
          output,
        };
      });
    } catch (error) {
      const perRowLatencyMs = Math.max(0, performance.now() - startedAt) / Math.max(rows.length, 1);
      const errorMessage = this.toErrorMessage(error, 'Batch execution request failed.');
      return rows.map(() => ({
        success: false,
        latencyMs: perRowLatencyMs,
        evaluated: false,
        correct: false,
        errorMessage,
      }));
    }
  }

  private expandBatchOutputs(output: unknown, expectedCount: number): unknown[] {
    if (Array.isArray(output)) {
      return output;
    }

    if (this.isRecord(output)) {
      for (const key of ['predictions', 'outputs', 'results', 'data', 'items', 'values']) {
        const nested = output[key];
        if (Array.isArray(nested)) {
          return nested;
        }
      }
    }

    return expectedCount === 1 ? [output] : [];
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    if (items.length === 0) {
      return [];
    }

    const boundedConcurrency = Math.max(1, Math.min(concurrency, items.length));
    const output: R[] = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: boundedConcurrency }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        if (currentIndex >= items.length) {
          return;
        }
        nextIndex += 1;
        output[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    });

    await Promise.all(workers);
    return output;
  }

  private recordBenchmarkError(modelName: string, message: string): void {
    if (this.benchmarkErrors.length >= 25) {
      return;
    }
    this.benchmarkErrors.push(`[${modelName}] ${message}`);
  }

  private sameValue(left: unknown, right: unknown): boolean {
    if (typeof left === 'number' && typeof right === 'number') {
      return Math.abs(left - right) < 1e-9;
    }

    return this.normalizeComparableValue(left) === this.normalizeComparableValue(right);
  }

  private normalizeComparableValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value.trim().toLowerCase();
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  private getSelectedAssetsInOrder(): ExecutableAsset[] {
    const byId = new Map(this.executableAssets.map(asset => [asset.id, asset]));
    return Array.from(this.selectedAssetIds)
      .map(id => byId.get(id))
      .filter((asset): asset is ExecutableAsset => !!asset);
  }

  private getCompatibilityReferenceAsset(): ExecutableAsset | null {
    const selected = this.getSelectedAssetsInOrder();
    return selected.length > 0 ? selected[0] : null;
  }

  private syncMetricSelection(): void {
    const nextAvailable = this.getAvailableMetricsForSelection(this.getSelectedAssetsInOrder());
    this.availableMetrics = nextAvailable;
    this.selectedMetrics = this.selectedMetrics.filter(metric => nextAvailable.includes(metric));

    if (this.selectedMetrics.length === 0) {
      this.selectedMetrics = [...nextAvailable];
    }

    if (this.rankingMetric !== 'score' && !this.selectedMetrics.includes(this.rankingMetric)) {
      this.rankingMetric = this.selectedMetrics[0] || 'score';
    }
  }

  private getAvailableMetricsForSelection(selectedAssets: ExecutableAsset[]): string[] {
    if (selectedAssets.length === 0) {
      return [];
    }

    if (selectedAssets.every(asset => this.isMetricBenchmarkModel(asset))) {
      const declared = selectedAssets
        .map(asset => this.uniqueStrings(asset.supportedMetrics || []))
        .filter(metrics => metrics.length > 0);

      if (declared.length === 0) {
        return [];
      }

      const [first, ...remaining] = declared;
      const common = first.filter(metric =>
        remaining.every(metrics => metrics.some(candidate => this.normalizeMetricName(candidate) === this.normalizeMetricName(metric))),
      );
      return common.length > 0 ? common : this.uniqueStrings(declared.flat());
    }

    const task = this.detectComparableTask(selectedAssets);
    return task === 'classification' || task === 'regression' ? [...this.metricDefaults[task]] : [];
  }

  private detectComparableTask(selectedAssets: ExecutableAsset[]): 'classification' | 'regression' | 'unsupported' {
    const tasks = selectedAssets
      .filter(asset => !this.isMetricBenchmarkModel(asset))
      .map(asset => this.detectAssetTask(asset))
      .map(task => {
        if (task === 'classification') {
          return 'classification' as const;
        }
        if (task === 'regression') {
          return 'regression' as const;
        }
        return 'unsupported' as const;
      });

    const unique = Array.from(new Set(tasks));
    return unique.length === 1 ? unique[0] : 'unsupported';
  }

  private isMetricBenchmarkModel(asset: ExecutableAsset): boolean {
    return (asset.benchmarkModelType || 'output') === 'metric';
  }

  private sanitizeSelectedAssetIds(current: Set<string>, availableAssets: ExecutableAsset[]): Set<string> {
    const availableById = new Map(availableAssets.map(asset => [asset.id, asset]));
    const nextSelection: string[] = [];
    let reference: ExecutableAsset | null = null;

    Array.from(current).forEach(id => {
      const asset = availableById.get(id);
      if (!asset) {
        return;
      }

      if (this.normalizeSchemaFields(asset.inputSchemaFields || []).length === 0) {
        return;
      }

      if (!reference) {
        reference = asset;
        nextSelection.push(asset.id);
        return;
      }

      if (this.areAssetsCompatible(reference, asset)) {
        nextSelection.push(asset.id);
      }
    });

    return new Set(nextSelection);
  }

  private isAssetSelectable(asset: ExecutableAsset): { allowed: boolean; reason: string } {
    const features = this.normalizeSchemaFields(asset.inputSchemaFields || []);
    if (features.length === 0) {
      return {
        allowed: false,
        reason: `Model "${asset.name}" has no input schema metadata. Add daimo:inputSchema first.`,
      };
    }

    const reference = this.getCompatibilityReferenceAsset();
    if (!reference || reference.id === asset.id) {
      return { allowed: true, reason: '' };
    }

    if (!this.areAssetsCompatible(reference, asset)) {
      return {
        allowed: false,
        reason: `Schema/request shape/benchmark type mismatch: "${asset.name}" is not compatible with "${reference.name}".`,
      };
    }

    return { allowed: true, reason: '' };
  }

  private areAssetsCompatible(reference: ExecutableAsset, candidate: ExecutableAsset): boolean {
    if (reference.id === candidate.id) {
      return true;
    }

    if ((reference.requestShape || 'single') !== (candidate.requestShape || 'single')) {
      return false;
    }

    if ((reference.benchmarkModelType || 'output') !== (candidate.benchmarkModelType || 'output')) {
      return false;
    }

    const referenceSchemaFields = this.normalizeSchemaFields(reference.inputSchemaFields || []);
    const candidateSchemaFields = this.normalizeSchemaFields(candidate.inputSchemaFields || []);
    if (referenceSchemaFields.length === 0 || candidateSchemaFields.length === 0) {
      return false;
    }

    return this.schemaFieldsSignature(referenceSchemaFields) === this.schemaFieldsSignature(candidateSchemaFields);
  }

  private detectAssetTask(asset: ExecutableAsset): TaskFilter {
    const tokens = [
      asset.name,
      ...(asset.tasks || []),
      ...(asset.tags || []),
    ]
      .join(' ')
      .toLowerCase();

    if (
      /\b(classification|classifier|sentiment|spam|topic|label)\b/.test(tokens)
    ) {
      return 'classification';
    }
    if (
      /\b(regression|forecast|time-series|timeseries|prediction|estimation)\b/.test(tokens)
    ) {
      return 'regression';
    }
    if (
      /\b(nlp|language|text|llm|chat|translation|summarization|embedding)\b/.test(tokens)
    ) {
      return 'nlp';
    }
    if (
      /\b(vision|image|object[- ]detection|segmentation|ocr|cv)\b/.test(tokens)
    ) {
      return 'vision';
    }

    return 'other';
  }

  private validateBenchmarkSchema(
    selectedAssets: ExecutableAsset[],
    rowsToValidate: Record<string, unknown>[],
  ): string[] {
    const errors: string[] = [];
    const normalizedFeatureSets = selectedAssets.map(asset => ({
      assetId: asset.id,
      modelName: asset.name,
      features: this.normalizeSchemaFields(asset.inputSchemaFields || []),
    }));

    normalizedFeatureSets.forEach(item => {
      if (item.features.length === 0) {
        errors.push(
          `Model "${item.modelName}" has no input schema metadata. Add "daimo:inputSchema" in asset metadata.`,
        );
      }
    });

    if (errors.length > 0) {
      return errors;
    }

    const reference = normalizedFeatureSets[0];
    const selectedRequestShapes = new Set(selectedAssets.map(asset => asset.requestShape || 'single'));
    if (selectedRequestShapes.size > 1) {
      errors.push('Request shape mismatch: selected models must all use the same daimo:requestShape.');
    }

    const selectedBenchmarkModelTypes = new Set(selectedAssets.map(asset => asset.benchmarkModelType || 'output'));
    if (selectedBenchmarkModelTypes.size > 1) {
      errors.push('Benchmark model type mismatch: selected models must all be output models or metric/evaluator models.');
    }

    const referenceSignature = this.schemaFieldsSignature(reference.features);
    normalizedFeatureSets.slice(1).forEach(item => {
      const currentSignature = this.schemaFieldsSignature(item.features);
      if (currentSignature !== referenceSignature) {
        errors.push(
          `Schema mismatch: "${item.modelName}" is not compatible with "${reference.modelName}". Selected models must share the same input feature contract.`,
        );
      }
    });

    if (errors.length > 0) {
      return errors;
    }

    if (this.selectedMetrics.length === 0) {
      errors.push('Select at least one benchmark metric.');
      return errors;
    }

    const comparableTask = this.detectComparableTask(selectedAssets);
    if (!selectedAssets.every(asset => this.isMetricBenchmarkModel(asset)) && comparableTask === 'unsupported') {
      errors.push('Local benchmark metrics are only available for classification or regression output models.');
      return errors;
    }

    for (let index = 0; index < rowsToValidate.length; index += 1) {
      const row = rowsToValidate[index];
      const payload = this.resolveInputPayload(row);
      errors.push(...this.validatePayloadAgainstSchemaFields(payload, reference.features, index + 1));

      if (errors.length >= 25) {
        break;
      }
    }

    return errors;
  }

  private normalizeSchemaFields(features: InputSchemaFieldSpec[]): InputSchemaFieldSpec[] {
    const seen = new Set<string>();
    const normalized: InputSchemaFieldSpec[] = [];

    features.forEach(feature => {
      const name = (feature.name || '').trim();
      if (!name) {
        return;
      }

      const type = this.normalizeSchemaType(feature.type);
      const required = feature.required === true;
      const signature = `${name.toLowerCase()}|${type}|${required ? '1' : '0'}`;

      if (seen.has(signature)) {
        return;
      }
      seen.add(signature);

      normalized.push({
        name,
        type,
        required,
        description: feature.description,
      });
    });

    return normalized.sort((left, right) => left.name.localeCompare(right.name));
  }

  private schemaFieldsSignature(features: InputSchemaFieldSpec[]): string {
    return features
      .map(feature => `${feature.name.toLowerCase()}|${this.normalizeSchemaType(feature.type)}|${feature.required ? '1' : '0'}`)
      .sort()
      .join(';');
  }

  private normalizeSchemaType(type: string | undefined): string {
    const normalized = (type || 'any').trim().toLowerCase();
    if (normalized === 'int') {
      return 'integer';
    }
    if (normalized === 'float' || normalized === 'double') {
      return 'number';
    }
    if (!normalized) {
      return 'any';
    }
    return normalized;
  }

  private validatePayloadAgainstSchemaFields(payload: unknown, features: InputSchemaFieldSpec[], rowIndex: number): string[] {
    const errors: string[] = [];
    if (!this.isRecord(payload)) {
      return [`Dataset row #${rowIndex}: payload must be a JSON object after applying input path.`];
    }

    for (const feature of features) {
      const featureValue = this.getValueAtSchemaPath(payload, feature.name);
      const fieldLabel = `Dataset row #${rowIndex} field "${feature.name}"`;

      if (feature.required && (featureValue === undefined || featureValue === null)) {
        errors.push(`${fieldLabel} is required but missing.`);
        continue;
      }

      if (featureValue === undefined || featureValue === null) {
        continue;
      }

      if (!this.matchesSchemaType(featureValue, feature.type)) {
        errors.push(
          `${fieldLabel} has invalid type. Expected "${this.normalizeSchemaType(feature.type)}", got "${this.describeType(featureValue)}".`,
        );
      }
    }

    return errors;
  }

  private getValueAtSchemaPath(source: unknown, schemaPath: string): unknown {
    const normalizedPath = schemaPath.trim();
    if (!normalizedPath.length) {
      return source;
    }

    const segments = normalizedPath.split('.').map(segment => segment.trim()).filter(segment => segment.length > 0);
    let current: unknown = source;

    for (const segment of segments) {
      const arraySegment = segment.endsWith('[]');
      const key = arraySegment ? segment.slice(0, -2) : segment;

      if (Array.isArray(current) && /^\d+$/.test(key)) {
        current = current[Number(key)];
      } else if (this.isRecord(current) && key in current) {
        current = current[key];
      } else {
        return undefined;
      }

      if (arraySegment) {
        if (!Array.isArray(current) || current.length === 0) {
          return undefined;
        }
        current = current[0];
      }
    }

    return current;
  }

  private matchesSchemaType(value: unknown, expectedType: string | undefined): boolean {
    const normalized = this.normalizeSchemaType(expectedType);
    switch (normalized) {
      case 'any':
      case 'unknown':
      case 'enum':
        return true;
      case 'string':
        return typeof value === 'string';
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value);
      case 'number':
        return typeof value === 'number' && !Number.isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return this.isRecord(value);
      case 'null':
        return value === null;
      default:
        return true;
    }
  }

  private describeType(value: unknown): string {
    if (value === null) {
      return 'null';
    }
    if (Array.isArray(value)) {
      return 'array';
    }
    if (this.isRecord(value)) {
      return 'object';
    }
    return typeof value;
  }

  private calculateLocalMetrics(
    asset: ExecutableAsset,
    rows: Record<string, unknown>[],
    outputs: unknown[],
  ): Record<string, number> {
    const task = this.detectComparableTask([asset]);
    if (task === 'classification') {
      return this.calculateClassificationMetrics(rows, outputs);
    }
    if (task === 'regression') {
      return this.calculateRegressionMetrics(rows, outputs);
    }
    return {};
  }

  private calculateClassificationMetrics(rows: Record<string, unknown>[], outputs: unknown[]): Record<string, number> {
    const pairs = rows
      .map((row, index) => ({
        actual: this.normalizeClassValue(this.extractExpectedValue(row)),
        predicted: this.normalizeClassValue(this.extractPredictedValue(outputs[index])),
      }))
      .filter((pair): pair is { actual: string; predicted: string } => !!pair.actual && !!pair.predicted);

    const metrics: Record<string, number> = {};
    const accuracy = this.computeClassificationAccuracy(pairs);
    const precision = this.computeMacroPrecision(pairs);
    const recall = this.computeMacroRecall(pairs);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

    this.selectedMetrics.forEach(metric => {
      switch (this.normalizeMetricName(metric)) {
        case 'accuracy':
          metrics[metric] = accuracy;
          break;
        case 'precision':
          metrics[metric] = precision;
          break;
        case 'recall':
          metrics[metric] = recall;
          break;
        case 'f1':
          metrics[metric] = f1;
          break;
      }
    });

    return metrics;
  }

  private calculateRegressionMetrics(rows: Record<string, unknown>[], outputs: unknown[]): Record<string, number> {
    const pairs = rows
      .map((row, index) => ({
        actual: this.readNumericValue(this.extractExpectedValue(row)),
        predicted: this.readNumericValue(this.extractPredictedValue(outputs[index])),
      }))
      .filter(pair => Number.isFinite(pair.actual) && Number.isFinite(pair.predicted));

    const metrics: Record<string, number> = {};
    const mae = pairs.length === 0
      ? 0
      : pairs.reduce((sum, pair) => sum + Math.abs(pair.actual - pair.predicted), 0) / pairs.length;
    const mse = pairs.length === 0
      ? 0
      : pairs.reduce((sum, pair) => {
        const diff = pair.actual - pair.predicted;
        return sum + diff * diff;
      }, 0) / pairs.length;
    const rmse = Math.sqrt(mse);
    const r2 = this.computeR2(pairs);

    this.selectedMetrics.forEach(metric => {
      switch (this.normalizeMetricName(metric)) {
        case 'mae':
          metrics[metric] = mae;
          break;
        case 'mse':
          metrics[metric] = mse;
          break;
        case 'rmse':
          metrics[metric] = rmse;
          break;
        case 'r2':
          metrics[metric] = r2;
          break;
      }
    });

    return metrics;
  }

  private extractExpectedValue(row: Record<string, unknown>): unknown {
    const mapped = this.expectedPath.trim() ? this.getValueAtPath(row, this.expectedPath) : undefined;
    if (mapped !== undefined) {
      return mapped;
    }

    return this.findComparableValue(row, ['label', 'target', 'expected', 'expected_label', 'ground_truth', 'groundTruth', 'actual', 'y', 'value']);
  }

  private extractPredictedValue(output: unknown): unknown {
    if (this.predictionPath.trim()) {
      const mapped = this.getValueAtPath(output, this.predictionPath);
      if (mapped !== undefined) {
        return mapped;
      }
    }

    if (Array.isArray(output)) {
      for (const item of output) {
        const value = this.extractPredictedValue(item);
        if (value !== undefined && value !== null && value !== '') {
          return value;
        }
      }
      return undefined;
    }

    if (!this.isRecord(output)) {
      return output;
    }

    return this.findComparableValue(output, ['prediction', 'label', 'target', 'category', 'class', 'decision', 'result', 'value', 'score']);
  }

  private findComparableValue(record: unknown, keys: string[]): unknown {
    if (!this.isRecord(record)) {
      return undefined;
    }

    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }

    return undefined;
  }

  private normalizeClassValue(value: unknown): string | null {
    if (value === undefined || value === null || value === '' || typeof value === 'object') {
      return null;
    }
    return String(value).trim().toLowerCase();
  }

  private computeClassificationAccuracy(pairs: { actual: string; predicted: string }[]): number {
    if (pairs.length === 0) {
      return 0;
    }
    return pairs.filter(pair => pair.actual === pair.predicted).length / pairs.length;
  }

  private computeMacroPrecision(pairs: { actual: string; predicted: string }[]): number {
    const labels = this.collectDistinctLabels(pairs);
    if (labels.length === 0) {
      return 0;
    }
    return labels.reduce((sum, label) => {
      const tp = pairs.filter(pair => pair.actual === label && pair.predicted === label).length;
      const fp = pairs.filter(pair => pair.actual !== label && pair.predicted === label).length;
      return sum + (tp + fp === 0 ? 0 : tp / (tp + fp));
    }, 0) / labels.length;
  }

  private computeMacroRecall(pairs: { actual: string; predicted: string }[]): number {
    const labels = this.collectDistinctLabels(pairs);
    if (labels.length === 0) {
      return 0;
    }
    return labels.reduce((sum, label) => {
      const tp = pairs.filter(pair => pair.actual === label && pair.predicted === label).length;
      const fn = pairs.filter(pair => pair.actual === label && pair.predicted !== label).length;
      return sum + (tp + fn === 0 ? 0 : tp / (tp + fn));
    }, 0) / labels.length;
  }

  private collectDistinctLabels(pairs: { actual: string; predicted: string }[]): string[] {
    return Array.from(new Set(pairs.flatMap(pair => [pair.actual, pair.predicted]).filter(Boolean)));
  }

  private computeR2(pairs: { actual: number; predicted: number }[]): number {
    if (pairs.length === 0) {
      return 0;
    }
    const meanActual = pairs.reduce((sum, pair) => sum + pair.actual, 0) / pairs.length;
    const ssRes = pairs.reduce((sum, pair) => sum + ((pair.actual - pair.predicted) ** 2), 0);
    const ssTot = pairs.reduce((sum, pair) => sum + ((pair.actual - meanActual) ** 2), 0);
    if (ssTot === 0) {
      return ssRes === 0 ? 1 : 0;
    }
    return 1 - (ssRes / ssTot);
  }

  private readNumericValue(value: unknown): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : Number.NaN;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  private extractMetricModelMetrics(output: unknown): Record<string, number> {
    const source = this.findMetricOutputSource(output);
    const metrics: Record<string, number> = {};
    this.selectedMetrics.forEach(metric => {
      const value = this.readMetricOutputValue(source, metric);
      if (Number.isFinite(value)) {
        metrics[metric] = value;
      }
    });
    return metrics;
  }

  private findMetricOutputSource(output: unknown): unknown {
    if (Array.isArray(output)) {
      return output.length === 1 ? this.findMetricOutputSource(output[0]) : output;
    }
    if (typeof output === 'string') {
      const trimmed = output.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          return this.findMetricOutputSource(JSON.parse(trimmed));
        } catch {
          return output;
        }
      }
    }
    if (!this.isRecord(output)) {
      return output;
    }
    for (const key of ['metrics', 'scores', 'evaluation', 'benchmark']) {
      if (output[key] !== undefined) {
        return output[key];
      }
    }
    for (const key of ['result', 'results', 'data', 'body']) {
      if (output[key] !== undefined) {
        return this.findMetricOutputSource(output[key]);
      }
    }
    return output;
  }

  private readMetricOutputValue(source: unknown, metric: string): number {
    if (source === undefined || source === null) {
      return Number.NaN;
    }
    if (Array.isArray(source)) {
      for (const item of source) {
        const value = this.readMetricOutputValue(item, metric);
        if (Number.isFinite(value)) {
          return value;
        }
      }
      return Number.NaN;
    }
    if (!this.isRecord(source)) {
      return this.readNumericValue(source);
    }
    const expectedKey = this.normalizeMetricName(metric);
    for (const [key, value] of Object.entries(source)) {
      if (this.normalizeMetricName(key) === expectedKey) {
        return this.readMetricNumericValue(value);
      }
    }
    const metricName = source['metric'] || source['name'] || source['key'];
    if (typeof metricName === 'string' && this.normalizeMetricName(metricName) === expectedKey) {
      return this.readMetricNumericValue(source['value'] ?? source['score'] ?? source['result']);
    }
    return Number.NaN;
  }

  private readMetricNumericValue(value: unknown): number {
    const direct = this.readNumericValue(value);
    if (Number.isFinite(direct)) {
      return direct;
    }
    if (!this.isRecord(value)) {
      return Number.NaN;
    }
    return this.readNumericValue(value['value'] ?? value['score'] ?? value['result']);
  }

  private normalizeMetricName(value: string): string {
    const normalized = String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized === 'f1score' ? 'f1' : normalized;
  }

  private uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(value => value.trim()).filter(value => value.length > 0)));
  }

  private findMetricValue(metrics: Record<string, number>, metric: string): number {
    const normalized = this.normalizeMetricName(metric);
    for (const [key, value] of Object.entries(metrics)) {
      if (this.normalizeMetricName(key) === normalized) {
        return value;
      }
    }
    return Number.NaN;
  }

  private metricAsPercent(metrics: Record<string, number>, metric: string): number | null {
    const value = this.findMetricValue(metrics, metric);
    if (!Number.isFinite(value)) {
      return null;
    }
    return value <= 1 ? value * 100 : value;
  }

  private rankResults(raw: BenchmarkAccumulator[]): BenchmarkResultRow[] {
    if (raw.length === 0) {
      return [];
    }

    const latencies = raw.map(row => row.averageLatencyMs);
    const minLatency = Math.min(...latencies);
    const maxLatency = Math.max(...latencies);
    const rankingMetric = this.rankingMetric === 'score' ? this.getDefaultRankingMetric() : this.rankingMetric;
    const lowerIsBetter = this.isLowerBetterMetric(rankingMetric);
    const metricValues = raw
      .map(row => this.getSortableMetricValue(row, rankingMetric))
      .filter((value): value is number => value !== null);
    const minMetric = metricValues.length ? Math.min(...metricValues) : 0;
    const maxMetric = metricValues.length ? Math.max(...metricValues) : 1;

    const withScore = raw
      .map(row => {
        const latencyScore = this.normalizeInverseScore(row.averageLatencyMs, minLatency, maxLatency);
        const metricValue = this.getSortableMetricValue(row, rankingMetric);
        const metricScore = metricValue === null
          ? 0
          : lowerIsBetter
            ? this.normalizeInverseScore(metricValue, minMetric, maxMetric)
            : this.normalizeDirectScore(metricValue, minMetric, maxMetric);
        const score = metricValues.length > 0
          ? metricScore * 0.7 + row.successRate * 0.2 + latencyScore * 0.1
          : row.successRate * 0.7 + latencyScore * 0.3;

        return { ...row, score };
      })
      .sort((left, right) => {
        const leftMetric = this.getSortableMetricValue(left, rankingMetric);
        const rightMetric = this.getSortableMetricValue(right, rankingMetric);
        if (leftMetric !== null && rightMetric !== null && leftMetric !== rightMetric) {
          return lowerIsBetter ? leftMetric - rightMetric : rightMetric - leftMetric;
        }
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (right.successRate !== left.successRate) {
          return right.successRate - left.successRate;
        }
        return left.averageLatencyMs - right.averageLatencyMs;
      });

    return withScore.map((row, index) => ({
      rank: index + 1,
      assetId: row.assetId,
      modelName: row.modelName,
      benchmarkModelType: row.benchmarkModelType,
      sampleCount: row.sampleCount,
      successCount: row.successCount,
      errorCount: row.errorCount,
      successRate: row.successRate,
      averageLatencyMs: row.averageLatencyMs,
      p95LatencyMs: row.p95LatencyMs,
      throughputRps: row.throughputRps,
      accuracyPercent: row.accuracyPercent,
      metrics: row.metrics,
      score: row.score,
    }));
  }

  private getDefaultRankingMetric(): string {
    return this.selectedMetrics[0] || 'successRate';
  }

  private getSortableMetricValue(row: BenchmarkAccumulator, metric: string): number | null {
    switch (metric) {
      case 'successRate':
        return row.successRate;
      case 'averageLatencyMs':
        return row.averageLatencyMs;
      case 'p95LatencyMs':
        return row.p95LatencyMs;
      case 'throughputRps':
        return row.throughputRps;
      case 'score':
        return 'score' in row && typeof (row as BenchmarkResultRow).score === 'number' ? (row as BenchmarkResultRow).score : null;
      default: {
        const value = this.findMetricValue(row.metrics || {}, metric);
        return Number.isFinite(value) ? value : null;
      }
    }
  }

  private isLowerBetterMetric(metric: string): boolean {
    const normalized = this.normalizeMetricName(metric);
    return this.lowerIsBetterMetrics.some(candidate => this.normalizeMetricName(candidate) === normalized);
  }

  private normalizeInverseScore(value: number, min: number, max: number): number {
    if (Math.abs(max - min) < 1e-9) {
      return 100;
    }
    return ((max - value) / (max - min)) * 100;
  }

  private normalizeDirectScore(value: number, min: number, max: number): number {
    if (Math.abs(max - min) < 1e-9) {
      return 100;
    }
    return ((value - min) / (max - min)) * 100;
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private percentile(values: number[], ratio: number): number {
    if (values.length === 0) {
      return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index];
  }

  private normalizeRows(rows: unknown[]): Record<string, unknown>[] {
    return rows.map(row => (this.isRecord(row) ? row : { value: row }));
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private extractDaimoMetadata(source: Record<string, unknown>): Record<string, unknown> {
    const assetData = this.isRecord(source['assetData'])
      ? source['assetData']
      : this.isRecord(source['edc:assetData'])
        ? source['edc:assetData']
        : this.isRecord(source['https://w3id.org/edc/v0.0.1/ns/assetData'])
          ? source['https://w3id.org/edc/v0.0.1/ns/assetData']
          : {};

    if (this.isRecord(assetData['JS_DAIMO_Model'])) {
      return assetData['JS_DAIMO_Model'];
    }

    if (this.isRecord(assetData['JS_DAIMO_Dataset'])) {
      return assetData['JS_DAIMO_Dataset'];
    }

    return {};
  }

  private toCsvValue(value: unknown): string {
    const text = value === undefined || value === null ? '' : String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  private toErrorMessage(error: unknown, fallback: string): string {
    if (!error || typeof error !== 'object') {
      return fallback;
    }

    const record = error as Record<string, unknown>;
    const direct = record['message'];
    if (typeof direct === 'string' && direct.trim().length > 0) {
      return direct;
    }

    const nested = record['error'];
    if (nested && typeof nested === 'object') {
      const nestedRecord = nested as Record<string, unknown>;
      const nestedMessage = nestedRecord['message'];
      if (typeof nestedMessage === 'string' && nestedMessage.trim().length > 0) {
        return nestedMessage;
      }

      const nestedError = nestedRecord['error'];
      if (typeof nestedError === 'string' && nestedError.trim().length > 0) {
        return nestedError;
      }
    }

    return fallback;
  }
}

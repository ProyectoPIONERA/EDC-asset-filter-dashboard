import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ExecutableAsset } from '../../models/ml-gui-asset';
import { DashboardModelExecutionService } from '../../services/dashboard-model-execution.service';
import { DashboardStateService, ModalAndAlertService } from '@eclipse-edc/dashboard-core';

@Component({
  selector: 'app-model-execution',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './model-execution.component.html',
})
export class ModelExecutionComponent implements OnInit, OnDestroy {
  private readonly executionService = inject(DashboardModelExecutionService);
  private readonly stateService = inject(DashboardStateService);
  private readonly modalAndAlertService = inject(ModalAndAlertService);
  private readonly destroy$ = new Subject<void>();
  private currentConnectorName = '';

  executableAssets: ExecutableAsset[] = [];
  selectedAssetId = '';
  selectedAsset: ExecutableAsset | null = null;

  loading = false;
  executing = false;
  errorMessage = '';
  outputJson = '';

  inputJson = JSON.stringify(
    {
      inputs: 'Hello from DataDashboard',
    },
    null,
    2,
  );

  ngOnInit(): void {
    this.stateService.currentEdcConfig$.pipe(takeUntil(this.destroy$)).subscribe(config => {
      const connectorName = config?.connectorName || '';
      if (connectorName === this.currentConnectorName) {
        return;
      }
      this.currentConnectorName = connectorName;
      this.loadExecutableAssets();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadExecutableAssets(): void {
    this.loading = true;
    this.errorMessage = '';

    this.executionService
      .getExecutableAssets()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: assets => {
          this.executableAssets = assets;
          if (this.selectedAssetId) {
            this.selectAsset(this.selectedAssetId);
          }
          this.loading = false;
        },
        error: error => {
          this.loading = false;
          this.errorMessage = this.toErrorMessage(error, 'Failed to load executable assets.');
        },
      });
  }

  selectAsset(assetId: string): void {
    this.selectedAssetId = assetId;
    this.selectedAsset = this.executableAssets.find(asset => asset.id === assetId) || null;
    this.outputJson = '';
    this.errorMessage = '';
  }

  execute(): void {
    this.errorMessage = '';
    this.outputJson = '';

    if (!this.selectedAsset) {
      this.errorMessage = 'Select an executable asset first.';
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(this.inputJson);
    } catch {
      this.errorMessage = 'Input is not valid JSON.';
      return;
    }

    this.executing = true;

    this.executionService
      .executeModel({
        assetId: this.selectedAsset.id,
        payload,
        path: this.selectedAsset.executionPath,
        agreementId: this.selectedAsset.agreementId,
        contractId: this.selectedAsset.contractId,
        connectorId: this.selectedAsset.connectorId,
        providerId: this.selectedAsset.providerId,
        consumerId: this.selectedAsset.consumerId,
        counterPartyAddress: this.selectedAsset.counterPartyAddress,
        protocol: this.selectedAsset.protocol,
        transferType: this.selectedAsset.transferType,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.executing = false;
          this.outputJson = JSON.stringify(response.output ?? response, null, 2);
          this.modalAndAlertService.showAlert('Model execution completed successfully.', 'Execution', 'success', 4);
        },
        error: error => {
          this.executing = false;
          this.errorMessage = this.toErrorMessage(error, 'Model execution failed.');
        },
      });
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

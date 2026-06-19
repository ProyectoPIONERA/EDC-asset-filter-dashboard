import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DashboardStateService,
  DeleteConfirmComponent,
  EdcConfig,
  FilterInputComponent,
  ItemCountSelectorComponent,
  ModalAndAlertService,
  PaginationComponent,
} from '@eclipse-edc/dashboard-core';
import { CatalogRequestFormComponent, CatalogService } from '@eclipse-edc/dashboard-core/catalog';
import { Router } from '@angular/router';
import { combineLatest, Subject, takeUntil } from 'rxjs';
import { Asset, IdResponse, JsonLdObject } from '@think-it-labs/edc-connector-client';
import { MlGuiAsset, MlGuiAssetFilter } from '../../models/ml-gui-asset';
import { Policy } from '@think-it-labs/edc-connector-client/dist/src/entities/policy';
import { DashboardMlBrowserService } from '../../services/dashboard-ml-browser.service';
import { MlCatalogDataset } from '../../models/ml-catalog-dataset';
import { MlAssetDetailsModalComponent } from '../ml-asset-details-modal/ml-asset-details-modal.component';
import { CatalogRequest } from '@think-it-labs/edc-connector-client/dist/src/entities/catalog';
import { MlContractNegotiationComponent } from '../ml-contract-negotiation/ml-contract-negotiation.component';
import { MlNegotiationProgressComponent } from '../ml-negotiation-progress/ml-negotiation-progress.component';
import { AssetCardComponent, AssetCreateComponent, AssetService } from '@eclipse-edc/dashboard-core/assets';

@Component({
  selector: 'app-ml-assets-browser',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    FilterInputComponent,
    ItemCountSelectorComponent,
    PaginationComponent,
  ],
  templateUrl: './ml-assets-browser.component.html',
})
export class MlAssetsBrowserComponent implements OnInit, OnDestroy {
  private readonly service = inject(DashboardMlBrowserService);
  private readonly catalogService = inject(CatalogService);
  private readonly assetService = inject(AssetService);
  readonly stateService = inject(DashboardStateService);
  private readonly modalAndAlertService = inject(ModalAndAlertService);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  allAssets: MlGuiAsset[] = [];
  assets: MlGuiAsset[] = [];
  pageAssets: MlGuiAsset[] = [];

  isLoading = false;
  errorMsg = '';

  pageItemCount = 12;
  searchTerm = '';
  protocol = 'dataspace-protocol-http';
  selectedConnector?: EdcConfig;
  manualCounterPartyAddress?: string;

  selectedTasks: string[] = [];
  selectedTaskTypes: string[] = [];
  selectedSubtasks: string[] = [];
  selectedModalities: string[] = [];
  selectedEndpointBehaviors: string[] = [];
  selectedLicenses: string[] = [];
  selectedLanguages: string[] = [];
  selectedLibraries: string[] = [];
  selectedFormats: string[] = [];
  selectedStorageTypes: string[] = [];
  selectedAssetSources: string[] = [];

  availableTasks: string[] = [];
  availableTaskTypes: string[] = [];
  availableSubtasks: string[] = [];
  availableModalities: string[] = [];
  availableEndpointBehaviors: string[] = [];
  availableLicenses: string[] = [];
  availableLanguages: string[] = [];
  availableLibraries: string[] = [];
  availableFormats: string[] = [];
  availableStorageTypes: string[] = [];
  availableAssetSources: string[] = [];
  private currentConnectorName = '';

  ngOnInit(): void {
    combineLatest([this.stateService.currentEdcConfig$, this.stateService.edcConfigs$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([currentConfig, configs]) => {
        const connectorName = currentConfig?.connectorName || '';
        const availableCounterParties = (configs || []).filter(config => config.connectorName !== connectorName);

        if (connectorName === this.currentConnectorName && this.selectedConnector) {
          return;
        }

        this.currentConnectorName = connectorName;
        this.selectedConnector = availableCounterParties[0];
        this.manualCounterPartyAddress = undefined;
        this.loadFilterBaseline();
        this.loadAssets();
      });
  }

  onConnectorSelected(): void {
    this.manualCounterPartyAddress = undefined;
    this.loadFilterBaseline();
    this.loadAssets();
  }

  openRequestForm(): void {
    this.modalAndAlertService.openModal(CatalogRequestFormComponent, undefined, {
      request: (request: CatalogRequest) => {
        this.modalAndAlertService.closeModal();
        this.selectedConnector = undefined;
        this.manualCounterPartyAddress = request.counterPartyAddress;
        this.loadFilterBaseline();
        this.loadAssets();
      },
    });
  }

  onSearch(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.loadAssets();
  }

  toggleLicense(license: string, selected: boolean): void {
    this.selectedLicenses = this.toggleValue(this.selectedLicenses, license, selected);
    this.loadAssets();
  }

  toggleLanguage(language: string, selected: boolean): void {
    this.selectedLanguages = this.toggleValue(this.selectedLanguages, language, selected);
    this.loadAssets();
  }

  toggleTask(task: string, selected: boolean): void {
    this.selectedTasks = this.toggleValue(this.selectedTasks, task, selected);
    this.loadAssets();
  }

  toggleTaskType(taskType: string, selected: boolean): void {
    this.selectedTaskTypes = this.toggleValue(this.selectedTaskTypes, taskType, selected);
    this.loadAssets();
  }

  toggleSubtask(subtask: string, selected: boolean): void {
    this.selectedSubtasks = this.toggleValue(this.selectedSubtasks, subtask, selected);
    this.loadAssets();
  }

  toggleModality(modality: string, selected: boolean): void {
    this.selectedModalities = this.toggleValue(this.selectedModalities, modality, selected);
    this.loadAssets();
  }

  toggleEndpointBehavior(endpointBehavior: string, selected: boolean): void {
    this.selectedEndpointBehaviors = this.toggleValue(this.selectedEndpointBehaviors, endpointBehavior, selected);
    this.loadAssets();
  }

  toggleLibrary(library: string, selected: boolean): void {
    this.selectedLibraries = this.toggleValue(this.selectedLibraries, library, selected);
    this.loadAssets();
  }

  toggleFormat(format: string, selected: boolean): void {
    this.selectedFormats = this.toggleValue(this.selectedFormats, format, selected);
    this.loadAssets();
  }

  toggleStorageType(storageType: string, selected: boolean): void {
    this.selectedStorageTypes = this.toggleValue(this.selectedStorageTypes, storageType, selected);
    this.loadAssets();
  }

  toggleAssetSource(assetSource: string, selected: boolean): void {
    this.selectedAssetSources = this.toggleValue(this.selectedAssetSources, assetSource, selected);
    this.loadAssets();
  }

  onPageItems(pageItems: MlGuiAsset[]): void {
    this.pageAssets = pageItems;
  }

  openDetails(asset: MlGuiAsset): void {
    this.modalAndAlertService.openModal(MlAssetDetailsModalComponent, { asset });
  }

  createContract(asset: MlGuiAsset): void {
    if (!asset.isLocal) {
      return;
    }
    this.router.navigate(['/contract-definitions']);
    this.modalAndAlertService.showAlert(
      `Open Contract Definitions to create a contract for asset '${asset.name}'.`,
      'Create Contract',
      'info',
      5,
    );
  }

  async editAsset(asset: MlGuiAsset): Promise<void> {
    if (!asset.isLocal) {
      return;
    }

    try {
      const localAsset = await this.resolveLocalAsset(asset.id);
      if (!localAsset) {
        this.modalAndAlertService.showAlert(
          `Asset '${asset.id}' not found in local assets.`,
          'Edit Not Possible',
          'warning',
          5,
        );
        return;
      }

      this.modalAndAlertService.openModal(
        AssetCreateComponent,
        { asset: localAsset },
        {
          updated: () => {
            this.modalAndAlertService.closeModal();
            this.modalAndAlertService.showAlert(`Asset with ID '${asset.id}'`, 'updated successfully', 'success', 5);
            this.loadFilterBaseline();
            this.loadAssets();
          },
        },
      );
    } catch {
      this.modalAndAlertService.showAlert(
        `Could not load asset '${asset.id}' for editing.`,
        'Edit Failed',
        'error',
        5,
      );
    }
  }

  async deleteAsset(asset: MlGuiAsset): Promise<void> {
    if (!asset.isLocal) {
      return;
    }

    try {
      const localAsset = await this.resolveLocalAsset(asset.id);
      if (!localAsset) {
        this.modalAndAlertService.showAlert(
          `Asset '${asset.id}' not found in local assets.`,
          'Delete Not Possible',
          'warning',
          5,
        );
        return;
      }

      this.modalAndAlertService.openModal(
        DeleteConfirmComponent,
        {
          customText: 'Do you really want to delete this Asset?',
          componentType: AssetCardComponent,
          componentInputs: { asset: localAsset, showButtons: false },
        },
        {
          canceled: () => this.modalAndAlertService.closeModal(),
          confirm: () => {
            this.modalAndAlertService.closeModal();
            this.assetService
              .deleteAsset(localAsset.id)
              .then(() => {
                this.modalAndAlertService.showAlert(`Asset '${localAsset.id}' deleted successfully`, undefined, 'success', 5);
                this.loadFilterBaseline();
                this.loadAssets();
              })
              .catch(() => {
                this.modalAndAlertService.showAlert(`Deletion of asset '${localAsset.id}' failed`, undefined, 'error', 5);
              });
          },
        },
      );
    } catch {
      this.modalAndAlertService.showAlert(
        `Could not load asset '${asset.id}' for deletion.`,
        'Delete Failed',
        'error',
        5,
      );
    }
  }

  async negotiate(asset: MlGuiAsset): Promise<void> {
    if (asset.isLocal || asset.hasAgreement || asset.negotiationInProgress) {
      return;
    }

    const counterPartyAddress = asset.counterPartyAddress || this.resolveCounterPartyAddress();
    if (!counterPartyAddress) {
      this.modalAndAlertService.showAlert(
        `No counterparty address available for asset '${asset.name}'.`,
        'Negotiation Not Possible',
        'warning',
        5,
      );
      return;
    }

    const catalogDataset = await this.resolveCatalogDataset(asset, counterPartyAddress);
    if (catalogDataset.offers.size === 0) {
      this.modalAndAlertService.showAlert(
        `No contract offers available for asset '${asset.name}'.`,
        'Negotiation Not Possible',
        'warning',
        5,
      );
      return;
    }

    this.modalAndAlertService.openModal(MlContractNegotiationComponent, { catalogDataset }, {
      negotiationRequested: (idResponse: IdResponse) => {
        this.setNegotiationInProgress(asset.id, true);
        this.modalAndAlertService.openModal(
          MlNegotiationProgressComponent,
          { negotiationId: idResponse },
          {
            stateChanged: (state: string) => this.onNegotiationStateChanged(asset.id, state),
          },
          true,
          () => {
            if (this.isNegotiationInProgress(asset.id)) {
              this.setNegotiationInProgress(asset.id, false);
              this.loadAssets();
            }
          },
        );
      },
    });
  }

  retry(): void {
    this.loadAssets();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedTasks = [];
    this.selectedTaskTypes = [];
    this.selectedSubtasks = [];
    this.selectedModalities = [];
    this.selectedEndpointBehaviors = [];
    this.selectedLicenses = [];
    this.selectedLanguages = [];
    this.selectedLibraries = [];
    this.selectedFormats = [];
    this.selectedStorageTypes = [];
    this.selectedAssetSources = [];
    this.loadAssets();
  }

  get hasActiveFilters(): boolean {
    return (
      this.searchTerm.trim().length > 0 ||
      this.selectedTasks.length > 0 ||
      this.selectedTaskTypes.length > 0 ||
      this.selectedSubtasks.length > 0 ||
      this.selectedModalities.length > 0 ||
      this.selectedEndpointBehaviors.length > 0 ||
      this.selectedLicenses.length > 0 ||
      this.selectedLanguages.length > 0 ||
      this.selectedLibraries.length > 0 ||
      this.selectedFormats.length > 0 ||
      this.selectedStorageTypes.length > 0 ||
      this.selectedAssetSources.length > 0
    );
  }

  get noResultsMessage(): string {
    if (this.hasActiveFilters) {
      return 'No assets match the selected search and filters.';
    }
    if (!this.resolveCounterPartyAddress()) {
      return 'No assets available. Select a connector or request one manually to query external catalog assets.';
    }
    return 'No assets available.';
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadFilterBaseline(): void {
    this.service
      .getMachineLearningAssets(undefined, undefined, this.resolveCounterPartyAddress())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: assets => {
          this.allAssets = assets;
          this.availableTasks = this.extractUnique(assets.flatMap(asset => asset.tasks || []));
          this.availableTaskTypes = this.extractUnique(assets.flatMap(asset => asset.taskTypes || []));
          this.availableSubtasks = this.extractUnique(assets.flatMap(asset => asset.subtasks || []));
          this.availableModalities = this.extractUnique(assets.flatMap(asset => asset.modalities || []));
          this.availableEndpointBehaviors = this.extractUnique(assets.flatMap(asset => asset.endpointBehaviors || []));
          this.availableLicenses = this.extractUnique(assets.flatMap(asset => asset.licenses || []));
          this.availableLanguages = this.extractUnique(assets.flatMap(asset => asset.languages || []));
          this.availableLibraries = this.extractUnique(assets.flatMap(asset => asset.libraries || []));
          this.availableFormats = this.extractUnique(assets.map(asset => asset.format || '').filter(Boolean));
          this.availableStorageTypes = this.extractUnique(assets.map(asset => asset.storageType || '').filter(Boolean));
          this.availableAssetSources = this.extractUnique(
            assets.map(asset => (asset.isLocal ? 'Local Asset' : 'External Asset')),
          );
        },
      });
  }

  private loadAssets(): void {
    this.isLoading = true;
    this.errorMsg = '';

    this.service
      .getMachineLearningAssets(this.currentFilters(), this.searchTerm, this.resolveCounterPartyAddress())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: assets => {
          this.assets = assets;
          this.isLoading = false;
        },
        error: error => {
          this.errorMsg = this.toErrorMessage(error, 'Failed to load ML assets.');
          this.assets = [];
          this.pageAssets = [];
          this.isLoading = false;
        },
      });
  }

  private currentFilters(): MlGuiAssetFilter {
    return {
      licenses: [...this.selectedLicenses],
      languages: [...this.selectedLanguages],
      tasks: [...this.selectedTasks],
      taskTypes: [...this.selectedTaskTypes],
      subtasks: [...this.selectedSubtasks],
      modalities: [...this.selectedModalities],
      endpointBehaviors: [...this.selectedEndpointBehaviors],
      libraries: [...this.selectedLibraries],
      formats: [...this.selectedFormats],
      storageTypes: [...this.selectedStorageTypes],
      assetSources: [...this.selectedAssetSources],
    };
  }

  private async resolveCatalogDataset(asset: MlGuiAsset, counterPartyAddress: string): Promise<MlCatalogDataset> {
    try {
      const catalogDatasets = await this.catalogService.getCatalogDataset({ counterPartyAddress });
      const catalogDataset = catalogDatasets.find(dataset => dataset.assetId === asset.id);

      if (catalogDataset) {
        return {
          id: catalogDataset.id,
          participantId: catalogDataset.participantId,
          assetId: catalogDataset.assetId,
          dataset: catalogDataset.dataset as unknown as JsonLdObject,
          offers: catalogDataset.offers as Map<string, Policy>,
          originator: catalogDataset.originator || counterPartyAddress,
        };
      }
    } catch {
      // Fallback to locally available asset payload.
    }

    return this.buildFallbackCatalogDataset(asset, counterPartyAddress);
  }

  private buildFallbackCatalogDataset(asset: MlGuiAsset, counterPartyAddress: string): MlCatalogDataset {
    const participantId = (asset.participantId || 'counterparty').trim() || 'counterparty';

    return {
      id: asset.id,
      participantId,
      assetId: asset.id,
      dataset: (asset.assetData || asset.rawProperties || {}) as unknown as JsonLdObject,
      offers: this.buildOfferMap(asset, participantId),
      originator: counterPartyAddress,
    };
  }

  private buildOfferMap(asset: MlGuiAsset, participantId: string): Map<string, Policy> {
    const offers = Array.isArray(asset.contractOffers) ? asset.contractOffers : [];
    const map = new Map<string, Policy>();

    offers.forEach((rawOffer, index) => {
      const policy = this.normalizePolicy(rawOffer, asset.id, participantId);
      map.set(String(index + 1), policy);
    });

    return map;
  }

  private normalizePolicy(rawOffer: unknown, assetId: string, participantId: string): Policy {
    const policy = { ...(rawOffer as Record<string, unknown>) } as Record<string, unknown>;
    policy['@context'] = policy['@context'] ?? 'http://www.w3.org/ns/odrl.jsonld';

    if (!this.hasPolicyProperty(policy, 'assigner')) {
      policy['assigner'] = participantId;
    }
    if (!this.hasPolicyProperty(policy, 'target')) {
      policy['target'] = assetId;
    }

    return policy as Policy;
  }

  private hasPolicyProperty(policy: Record<string, unknown>, name: 'assigner' | 'target'): boolean {
    const expandedName = `http://www.w3.org/ns/odrl/2/${name}`;
    return policy[name] != null || policy[expandedName] != null;
  }

  private onNegotiationStateChanged(assetId: string, state: string): void {
    if (state === 'FINALIZED') {
      this.setNegotiationInProgress(assetId, false);
      this.setAgreement(assetId, true);
      return;
    }

    if (state === 'TERMINATED' || state === 'DECLINED' || state === 'ERROR') {
      this.setNegotiationInProgress(assetId, false);
      this.loadAssets();
    }
  }

  private isNegotiationInProgress(assetId: string): boolean {
    return this.assets.some(asset => asset.id === assetId && !!asset.negotiationInProgress);
  }

  private setNegotiationInProgress(assetId: string, inProgress: boolean): void {
    this.assets = this.assets.map(asset =>
      asset.id === assetId && !asset.isLocal ? { ...asset, negotiationInProgress: inProgress } : asset,
    );
    this.pageAssets = this.pageAssets.map(asset =>
      asset.id === assetId && !asset.isLocal ? { ...asset, negotiationInProgress: inProgress } : asset,
    );
  }

  private setAgreement(assetId: string, hasAgreement: boolean): void {
    this.assets = this.assets.map(asset =>
      asset.id === assetId && !asset.isLocal
        ? { ...asset, hasAgreement, negotiationInProgress: false }
        : asset,
    );
    this.pageAssets = this.pageAssets.map(asset =>
      asset.id === assetId && !asset.isLocal
        ? { ...asset, hasAgreement, negotiationInProgress: false }
        : asset,
    );
  }

  private extractUnique(values: string[]): string[] {
    return Array.from(new Set(values.filter(value => !!value && value.trim().length > 0))).sort();
  }

  private async resolveLocalAsset(assetId: string): Promise<Asset | undefined> {
    const allAssets = await this.assetService.getAllAssets();
    return allAssets.find(localAsset => localAsset.id === assetId);
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
      const nestedMessage = (nested as Record<string, unknown>)['message'];
      if (typeof nestedMessage === 'string' && nestedMessage.trim().length > 0) {
        return nestedMessage;
      }
    }

    return fallback;
  }

  private toggleValue(items: string[], value: string, selected: boolean): string[] {
    const set = new Set(items);
    if (selected) {
      set.add(value);
    } else {
      set.delete(value);
    }
    return Array.from(set);
  }

  private resolveCounterPartyAddress(): string | null {
    if (this.selectedConnector?.protocolUrl) {
      return this.selectedConnector.protocolUrl;
    }
    if (this.manualCounterPartyAddress && this.manualCounterPartyAddress.trim().length > 0) {
      return this.manualCounterPartyAddress.trim();
    }
    return null;
  }
}

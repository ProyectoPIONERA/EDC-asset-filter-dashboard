/*
 *  Copyright (c) 2025 Fraunhofer-Gesellschaft zur Förderung der angewandten Forschung e.V.
 *
 *  This program and the accompanying materials are made available under the
 *  terms of the Apache License, Version 2.0 which is available at
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 *  SPDX-License-Identifier: Apache-2.0
 *
 *  Contributors:
 *       Fraunhofer-Gesellschaft zur Förderung der angewandten Forschung e.V. - initial API and implementation
 *
 */

import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { AssetService } from '../asset.service';
import { AsyncPipe } from '@angular/common';
import { Asset, IdResponse } from '@think-it-labs/edc-connector-client';
import { from, map, Observable, of, Subject, takeUntil } from 'rxjs';
import {
  DashboardStateService,
  DeleteConfirmComponent,
  FilterInputComponent,
  ItemCountSelectorComponent,
  JsonldViewerComponent,
  ModalAndAlertService,
  PaginationComponent,
} from '@eclipse-edc/dashboard-core';
import { AssetCreateComponent } from '../asset-create/asset-create.component';
import { AssetCardComponent } from '../asset-card/asset-card.component';

const DAIMO_FILTER_KEYS = [
  'daimo:shortDescription',
  'https://w3id.org/pionera/daimo#shortDescription',
  'daimo:modelVersion',
  'https://w3id.org/pionera/daimo#modelVersion',
  'daimo:taskCategory',
  'https://w3id.org/pionera/daimo#taskCategory',
  'daimo:taskType',
  'https://w3id.org/pionera/daimo#taskType',
  'daimo:modality',
  'https://w3id.org/pionera/daimo#modality',
  'daimo:subtask',
  'https://w3id.org/pionera/daimo#subtask',
  'daimo:endpointBehavior',
  'https://w3id.org/pionera/daimo#endpointBehavior',
  'daimo:requestShape',
  'https://w3id.org/pionera/daimo#requestShape',
  'dcat:keyword',
  'http://www.w3.org/ns/dcat#keyword',
  'dct:license',
  'dcterms:license',
  'http://purl.org/dc/terms/license',
  'daimo:maturityStatus',
  'https://w3id.org/pionera/daimo#maturityStatus',
  'daimo:libraryName',
  'https://w3id.org/pionera/daimo#libraryName',
  'dct:language',
  'dcterms:language',
  'http://purl.org/dc/terms/language',
  'dct:format',
  'dcterms:format',
  'http://purl.org/dc/terms/format',
  'daimo:inferencePath',
  'https://w3id.org/pionera/daimo#inferencePath',
  'daimo:parameterCount',
  'https://w3id.org/pionera/daimo#parameterCount',
  'daimo:artifactSizeMb',
  'https://w3id.org/pionera/daimo#artifactSizeMb',
  'daimo:quantization',
  'https://w3id.org/pionera/daimo#quantization',
  'daimo:metrics',
  'https://w3id.org/pionera/daimo#metrics',
  'daimo:performanceReport',
  'https://w3id.org/pionera/daimo#performanceReport',
  'daimo:intendedUse',
  'https://w3id.org/pionera/daimo#intendedUse',
  'daimo:limitations',
  'https://w3id.org/pionera/daimo#limitations',
  'daimo:piiSafe',
  'https://w3id.org/pionera/daimo#piiSafe',
  'daimo:regulatedDomain',
  'https://w3id.org/pionera/daimo#regulatedDomain',
  'daimo:humanInTheLoopRequired',
  'https://w3id.org/pionera/daimo#humanInTheLoopRequired',
  'daimo:latencyP95Ms',
  'https://w3id.org/pionera/daimo#latencyP95Ms',
  'daimo:throughputRps',
  'https://w3id.org/pionera/daimo#throughputRps',
  'daimo:rateLimits',
  'https://w3id.org/pionera/daimo#rateLimits',
  'daimo:availabilityTier',
  'https://w3id.org/pionera/daimo#availabilityTier',
];

@Component({
  selector: 'lib-asset-view',
  standalone: true,
  imports: [AsyncPipe, FilterInputComponent, PaginationComponent, AssetCardComponent, ItemCountSelectorComponent],
  templateUrl: './asset-view.component.html',
  styleUrl: './asset-view.component.css',
})
export class AssetViewComponent implements OnInit, OnDestroy {
  private readonly assetService = inject(AssetService);
  private readonly modalAndAlertService = inject(ModalAndAlertService);
  private readonly stateService = inject(DashboardStateService);

  private readonly destroy$ = new Subject<void>();

  assets$: Observable<Asset[]> = of([]);
  filteredAssets$: Observable<Asset[]> = of([]);
  pageAssets$: Observable<Asset[]> = of([]);
  fetched = false;
  pageItemCount = 15;

  constructor() {
    this.stateService.currentEdcConfig$.pipe(takeUntil(this.destroy$)).subscribe(this.fetchAssets.bind(this));
  }

  async ngOnInit() {
    this.fetchAssets();
  }

  filter(searchText: string) {
    if (searchText) {
      const lower = searchText.toLowerCase();
      this.filteredAssets$ = this.assets$.pipe(
        map(assets =>
          assets.filter(asset => this.matchesFilter(asset, lower)),
        ),
      );
    } else {
      this.filteredAssets$ = this.assets$;
    }
  }

  paginationEvent(pageItems: Asset[]) {
    this.pageAssets$ = of(pageItems);
  }

  createAsset() {
    const callbacks = {
      created: (id: IdResponse) => {
        this.modalAndAlertService.closeModal();
        this.modalAndAlertService.showAlert(`Asset with ID '${id.id}'`, 'created successfully', 'success', 5);
        this.fetchAssets();
      },
    };
    this.modalAndAlertService.openModal(AssetCreateComponent, undefined, callbacks);
  }

  editAsset(asset: Asset) {
    const callbacks = {
      updated: () => {
        this.modalAndAlertService.closeModal();
        this.modalAndAlertService.showAlert(`Asset with ID '${asset.id}'`, 'updated successfully', 'success', 5);
        this.fetchAssets();
      },
    };
    this.modalAndAlertService.openModal(AssetCreateComponent, { asset: asset }, callbacks);
  }

  deleteAsset(asset: Asset) {
    this.modalAndAlertService.openModal(
      DeleteConfirmComponent,
      {
        customText: 'Do you really want to delete this Asset?',
        componentType: AssetCardComponent,
        componentInputs: { asset: asset, showButtons: false },
      },
      {
        canceled: () => this.modalAndAlertService.closeModal(),
        confirm: () => {
          this.modalAndAlertService.closeModal();
          this.assetService
            .deleteAsset(asset.id)
            .then(() => {
              const msg = `Asset '${asset.id}' deleted successfully`;
              this.modalAndAlertService.showAlert(msg, undefined, 'success', 5);
              this.fetchAssets();
            })
            .catch(error => {
              console.error(error);
              const msg = `Deletion of asset '${asset.id}' failed`;
              this.modalAndAlertService.showAlert(msg, undefined, 'error', 5);
            });
        },
      },
    );
  }

  openDetails(asset: Asset) {
    this.modalAndAlertService.openModal(JsonldViewerComponent, { jsonLdObject: asset });
  }

  private fetchAssets() {
    this.fetched = false;
    this.assets$ = this.filteredAssets$ = of([]);
    this.assets$ = this.filteredAssets$ = from(this.assetService.getAllAssets().finally(() => (this.fetched = true)));
  }

  private matchesFilter(asset: Asset, lowerQuery: string): boolean {
    const id = (asset.id || '').toLowerCase();
    const name = (asset.properties.optionalValue<string>('edc', 'name') || '').toLowerCase();
    const contentType = (asset.properties.optionalValue<string>('edc', 'contenttype') || '').toLowerCase();
    const dataAddressType = (asset.dataAddress.mandatoryValue<string>('edc', 'type') || '').toLowerCase();
    if (
      id.includes(lowerQuery) ||
      name.includes(lowerQuery) ||
      contentType.includes(lowerQuery) ||
      dataAddressType.includes(lowerQuery)
    ) {
      return true;
    }

    const mlMetadata = this.getMlMetadataValues(asset);
    return mlMetadata.some(value => value.toLowerCase().includes(lowerQuery));
  }

  private getMlMetadataValues(asset: Asset): string[] {
    const properties = asset.properties as unknown as Record<string, unknown>;
    const values: string[] = [];
    const daimoMetadataNodes = this.getDaimoMetadataNodes(properties);
    DAIMO_FILTER_KEYS.forEach(key => {
      values.push(...this.extractStrings(properties[key]));
      daimoMetadataNodes.forEach(node => values.push(...this.extractStrings(node[key])));
    });
    return values;
  }

  private getDaimoMetadataNodes(properties: Record<string, unknown>): Record<string, unknown>[] {
    const assetData = properties['assetData'];
    if (!assetData || typeof assetData !== 'object' || Array.isArray(assetData)) {
      return [];
    }

    const assetDataRecord = assetData as Record<string, unknown>;
    return ['JS_DAIMO_Model', 'JS_DAIMO_Dataset']
      .map(nodeName => assetDataRecord[nodeName])
      .filter((node): node is Record<string, unknown> => !!node && typeof node === 'object' && !Array.isArray(node));
  }

  private extractStrings(value: unknown): string[] {
    if (value == null) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.flatMap(item => this.extractStrings(item));
    }
    if (typeof value === 'string') {
      return value.trim().length > 0 ? [value.trim()] : [];
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return [String(value)];
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (record['@value'] !== undefined) {
        return this.extractStrings(record['@value']);
      }
      return [];
    }
    return [];
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}

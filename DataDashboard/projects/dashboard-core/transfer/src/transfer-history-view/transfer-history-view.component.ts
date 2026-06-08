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
import { QuerySpec, TransferProcess } from '@think-it-labs/edc-connector-client';
import { BehaviorSubject, Subject, takeUntil } from 'rxjs';
import { TransferHistoryTableComponent } from '../transfer-history-table/transfer-history-table.component';
import { AsyncPipe } from '@angular/common';
import {
  ConsumerProviderSwitchComponent,
  DashboardStateService,
  FilterInputComponent,
  ItemCountSelectorComponent,
  ModalAndAlertService,
  PaginationComponent,
} from '@eclipse-edc/dashboard-core';
import { ContractAndTransferService } from '../contract-and-transfer.service';

@Component({
  selector: 'lib-transfer-history',
  templateUrl: './transfer-history-view.component.html',
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
    `,
  ],
  imports: [
    TransferHistoryTableComponent,
    AsyncPipe,
    PaginationComponent,
    FilterInputComponent,
    ItemCountSelectorComponent,
    ConsumerProviderSwitchComponent,
  ],
})
export class TransferHistoryViewComponent implements OnInit, OnDestroy {
  private readonly transferProcessService = inject(ContractAndTransferService);
  private readonly modalAndAlertService = inject(ModalAndAlertService);
  private readonly stateService = inject(DashboardStateService);

  private readonly destroy$ = new Subject<void>();

  transferProcesses$ = new BehaviorSubject<TransferProcess[]>([]);
  filteredTransferProcesses$ = new BehaviorSubject<TransferProcess[]>([]);
  pageTransferProcesses$ = new BehaviorSubject<TransferProcess[]>([]);

  pageItemCount = 20;
  initialized = false;
  contractType: 'CONSUMER' | 'PROVIDER' = 'CONSUMER';

  async ngOnInit(): Promise<void> {
    await this.fetchHistory();
    this.stateService.currentEdcConfig$.pipe(takeUntil(this.destroy$)).subscribe(this.fetchHistory.bind(this));
  }

  private async fetchHistory() {
    const transferProcesses = await this.fetchTransferHistory();
    this.transferProcesses$.next(transferProcesses);
    this.filteredTransferProcesses$.next(transferProcesses);
    this.pageTransferProcesses$.next(this.firstPage(transferProcesses));
  }

  private async fetchTransferHistory(): Promise<TransferProcess[]> {
    const filtered = await this.transferProcessService.getAllTransferProcesses(this.transferHistoryQuery(true));
    if (filtered.length > 0) {
      return filtered;
    }

    const unfiltered = await this.transferProcessService.getAllTransferProcesses(this.transferHistoryQuery(false));
    const typeAware = unfiltered.filter(transferProcess => this.matchesContractType(transferProcess));
    return typeAware.length > 0 ? typeAware : unfiltered;
  }

  private transferHistoryQuery(includeTypeFilter: boolean): QuerySpec {
    const querySpec: QuerySpec = {
      sortField: 'stateTimestamp',
      sortOrder: 'DESC',
    };

    if (includeTypeFilter) {
      querySpec.filterExpression = [
        {
          operandLeft: 'type',
          operator: '=',
          operandRight: this.contractType,
        },
      ];
    }

    return querySpec;
  }

  private matchesContractType(transferProcess: TransferProcess): boolean {
    const type = this.transferProcessValue(transferProcess, [
      'type',
      'edc:type',
      'https://w3id.org/edc/v0.0.1/ns/type',
    ]).toUpperCase();
    return type.length > 0 && type.includes(this.contractType);
  }

  paginationEvent(pageItems: TransferProcess[]) {
    this.pageTransferProcesses$.next(pageItems ?? []);
  }

  filter(searchText: string) {
    if (searchText) {
      const lower = searchText.toLowerCase();
      this.filteredTransferProcesses$.next(
        this.transferProcesses$.value.filter(
          transferProcess =>
            this.transferProcessValue(transferProcess, ['assetId']).toLowerCase().includes(lower) ||
            this.transferProcessValue(transferProcess, ['state']).toLowerCase().includes(lower) ||
            this.transferProcessValue(transferProcess, [
              'transferType',
              'edc:transferType',
              'https://w3id.org/edc/v0.0.1/ns/transferType',
            ]).toLowerCase().includes(lower) ||
            this.transferProcessValue(transferProcess, ['contractId']).toLowerCase().includes(lower) ||
            this.transferProcessValue(transferProcess, ['id', '@id']).toLowerCase().includes(lower),
        ),
      );
      this.pageTransferProcesses$.next(this.firstPage(this.filteredTransferProcesses$.value));
    } else {
      this.filteredTransferProcesses$.next(this.transferProcesses$.value);
      this.pageTransferProcesses$.next(this.firstPage(this.filteredTransferProcesses$.value));
    }
  }

  private firstPage(transferProcesses: TransferProcess[]): TransferProcess[] {
    return transferProcesses.slice(0, this.pageItemCount);
  }

  async onTypeChange(type: 'CONSUMER' | 'PROVIDER') {
    this.contractType = type;
    await this.fetchHistory();
  }

  async onDeprovision(transferProcess: TransferProcess) {
    this.transferProcessService
      .deprovisionTransferProcess(transferProcess.id)
      .then(async () => {
        const msg = `Deprovisioning of transfer process '${transferProcess.id}' requested successfully`;
        this.modalAndAlertService.showAlert(msg, undefined, 'success', 5);
        await this.fetchHistory();
      })
      .catch(error => {
        console.error(error);
        const msg = `Requesting deprovisioning of transfer process '${transferProcess.id}' failed`;
        this.modalAndAlertService.showAlert(msg, undefined, 'error', 5);
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.transferProcesses$.complete();
    this.filteredTransferProcesses$.complete();
    this.pageTransferProcesses$.complete();
  }

  private transferProcessValue(transferProcess: TransferProcess, keys: string[]): string {
    const record = transferProcess as unknown as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    const mandatory = transferProcess as unknown as {
      mandatoryValue?: <T>(namespace: string, key: string) => T;
    };
    for (const key of keys) {
      try {
        const normalized = key.includes(':') ? key.split(':').pop() || key : key;
        const value = mandatory.mandatoryValue?.<string>('edc', normalized);
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      } catch {
        // Older runtimes may not expose optional fields through mandatoryValue.
      }
    }

    return '';
  }
}

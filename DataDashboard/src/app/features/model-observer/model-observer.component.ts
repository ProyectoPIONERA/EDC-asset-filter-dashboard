import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DashboardStateService } from '@eclipse-edc/dashboard-core';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import {
  DashboardModelObserverService,
  ModelObserverEvent,
  ModelObserverEventFilters,
  ModelObserverParticipantSummary,
  ModelObserverSummary,
} from '../../services/dashboard-model-observer.service';

type ObserverView = 'ledger' | 'asset' | 'agreement' | 'benchmarks' | 'participants';

@Component({
  selector: 'app-model-observer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './model-observer.component.html',
})
export class ModelObserverComponent implements OnInit, OnDestroy {
  private readonly observerService = inject(DashboardModelObserverService);
  private readonly stateService = inject(DashboardStateService);
  private readonly destroy$ = new Subject<void>();
  private currentConnectorName = '';

  readonly views: Array<{ value: ObserverView; label: string }> = [
    { value: 'ledger', label: 'Ledger' },
    { value: 'asset', label: 'Asset Timeline' },
    { value: 'agreement', label: 'Agreement Evidence' },
    { value: 'benchmarks', label: 'Benchmarks' },
    { value: 'participants', label: 'Participants' },
  ];

  activeView: ObserverView = 'ledger';
  summary: ModelObserverSummary | null = null;
  events: ModelObserverEvent[] = [];
  assetTimelineEvents: ModelObserverEvent[] = [];
  agreementEvidenceEvents: ModelObserverEvent[] = [];
  benchmarkEvents: ModelObserverEvent[] = [];
  participants: ModelObserverParticipantSummary[] = [];

  eventTypeFilter = '';
  categoryFilter = '';
  assetIdFilter = '';
  agreementIdFilter = '';
  participantIdFilter = '';
  modelNameFilter = '';
  correlationIdFilter = '';
  statusFilter = '';
  searchFilter = '';
  assetTimelineId = '';
  agreementEvidenceId = '';
  benchmarkAssetId = '';
  limit = 200;

  loading = false;
  errorMessage = '';

  ngOnInit(): void {
    this.stateService.currentEdcConfig$.pipe(takeUntil(this.destroy$)).subscribe(config => {
      const connectorName = config?.connectorName || '';
      if (connectorName === this.currentConnectorName) {
        return;
      }
      this.currentConnectorName = connectorName;
      this.refreshAll();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get eventTypeOptions(): string[] {
    if (!this.summary) {
      return [];
    }
    return Object.keys(this.summary.eventTypes || {}).sort((left, right) => left.localeCompare(right));
  }

  get totalEvents(): number {
    return this.summary?.totalEvents || 0;
  }

  setView(view: ObserverView): void {
    this.activeView = view;
  }

  refreshAll(): void {
    this.loading = true;
    this.errorMessage = '';

    forkJoin({
      summary: this.observerService.getSummary(),
      events: this.observerService.getEvents(this.currentFilters()),
      benchmarks: this.observerService.getBenchmarks(this.benchmarkAssetId, this.limit),
      participants: this.observerService.getParticipants(),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: result => {
          this.summary = result.summary;
          this.events = result.events;
          this.benchmarkEvents = result.benchmarks;
          this.participants = result.participants;
          this.loading = false;
        },
        error: error => {
          this.loading = false;
          this.errorMessage = this.toErrorMessage(error, 'Failed to load model observer data.');
        },
      });
  }

  loadEvents(): void {
    this.loading = true;
    this.errorMessage = '';
    this.observerService
      .getEvents(this.currentFilters())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: events => {
          this.events = events;
          this.loading = false;
        },
        error: error => {
          this.loading = false;
          this.errorMessage = this.toErrorMessage(error, 'Failed to load event ledger.');
        },
      });
  }

  loadAssetTimeline(): void {
    if (!this.assetTimelineId.trim()) {
      this.assetTimelineEvents = [];
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    this.observerService
      .getAssetTimeline(this.assetTimelineId.trim(), this.limit)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: events => {
          this.assetTimelineEvents = events;
          this.loading = false;
        },
        error: error => {
          this.loading = false;
          this.errorMessage = this.toErrorMessage(error, 'Failed to load asset timeline.');
        },
      });
  }

  loadAgreementEvidence(): void {
    if (!this.agreementEvidenceId.trim()) {
      this.agreementEvidenceEvents = [];
      return;
    }
    this.loading = true;
    this.errorMessage = '';
    this.observerService
      .getAgreementEvidence(this.agreementEvidenceId.trim(), this.limit)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: events => {
          this.agreementEvidenceEvents = events;
          this.loading = false;
        },
        error: error => {
          this.loading = false;
          this.errorMessage = this.toErrorMessage(error, 'Failed to load agreement evidence.');
        },
      });
  }

  loadBenchmarks(): void {
    this.loading = true;
    this.errorMessage = '';
    this.observerService
      .getBenchmarks(this.benchmarkAssetId.trim(), this.limit)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: events => {
          this.benchmarkEvents = events;
          this.loading = false;
        },
        error: error => {
          this.loading = false;
          this.errorMessage = this.toErrorMessage(error, 'Failed to load benchmark history.');
        },
      });
  }

  clearFilters(): void {
    this.eventTypeFilter = '';
    this.categoryFilter = '';
    this.assetIdFilter = '';
    this.agreementIdFilter = '';
    this.participantIdFilter = '';
    this.modelNameFilter = '';
    this.correlationIdFilter = '';
    this.statusFilter = '';
    this.searchFilter = '';
    this.loadEvents();
  }

  eventPrimaryId(event: ModelObserverEvent): string {
    return event.assetId || event.modelId || event.agreementId || event.transferProcessId || event.negotiationId || '-';
  }

  eventParticipantLabel(event: ModelObserverEvent): string {
    const participants = [
      event.participantId,
      event.providerParticipantId,
      event.consumerParticipantId,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    return participants.length > 0 ? Array.from(new Set(participants)).join(' / ') : '-';
  }

  eventModelLabel(event: ModelObserverEvent): string {
    return this.firstText(
      event.modelName,
      this.detailValue(event, 'modelName'),
      this.detailValue(event, 'assetName'),
      event.modelId,
      event.assetId,
    );
  }

  eventTaskTypeLabel(event: ModelObserverEvent): string {
    return this.firstText(event.taskType, this.detailValue(event, 'task'), this.detailValue(event, 'taskType'));
  }

  eventCorrelationLabel(event: ModelObserverEvent): string {
    return this.firstText(
      event.correlationId,
      event.usageSessionId,
      event.benchmarkRunId,
      event.transferProcessId,
      event.negotiationId,
      event.agreementId,
      event.eventId,
    );
  }

  eventHttpStatusLabel(event: ModelObserverEvent): string {
    return this.firstText(event.httpStatus, event.metrics?.['httpStatus']);
  }

  eventLatencyLabel(event: ModelObserverEvent): string {
    const value = this.firstValue(event.latencyMs, event.metrics?.['latencyMs'], event.metrics?.['durationMs']);
    if (value === undefined || value === null || String(value).trim().length === 0) {
      return '-';
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return `${numeric.toFixed(0)} ms`;
    }
    return String(value);
  }

  eventProcessLabel(event: ModelObserverEvent): string {
    return this.firstText(event.transferProcessId, event.negotiationId, event.usageSessionId);
  }

  openAgreementEvidence(event: ModelObserverEvent): void {
    const agreementId = this.cleanText(event.agreementId);
    if (!agreementId) {
      return;
    }
    this.agreementEvidenceId = agreementId;
    this.setView('agreement');
    this.loadAgreementEvidence();
  }

  openParticipantEvents(event: ModelObserverEvent): void {
    const participantId = this.cleanText(
      event.participantId || event.providerParticipantId || event.consumerParticipantId,
    );
    if (!participantId) {
      return;
    }
    this.participantIdFilter = participantId;
    this.setView('ledger');
    this.loadEvents();
  }

  openBenchmarkHistory(event: ModelObserverEvent): void {
    const assetId = this.cleanText(event.assetId || event.modelId);
    if (!assetId) {
      return;
    }
    this.benchmarkAssetId = assetId;
    this.setView('benchmarks');
    this.loadBenchmarks();
  }

  eventDetailsJson(event: ModelObserverEvent): string {
    const details = {
      details: event.details || {},
      metrics: event.metrics || {},
    };
    return JSON.stringify(details, null, 2);
  }

  eventStatusClass(event: ModelObserverEvent): string {
    const status = (event.status || '').toLowerCase();
    const type = (event.eventType || '').toLowerCase();
    if (status.includes('fail') || type.includes('failed') || type.includes('terminated')) {
      return 'badge-error';
    }
    if (status.includes('complete') || status.includes('final') || type.includes('completed')) {
      return 'badge-success';
    }
    return 'badge-ghost';
  }

  metricValue(event: ModelObserverEvent, key: string): string {
    const value = event.metrics?.[key];
    if (value === undefined || value === null || value === '') {
      return '-';
    }
    if (typeof value === 'number') {
      return value.toFixed(2);
    }
    return String(value);
  }

  trackEvent(_index: number, event: ModelObserverEvent): string {
    return event.eventId || `${event.eventType || 'event'}-${event.occurredAt || _index}`;
  }

  private currentFilters(): ModelObserverEventFilters {
    return {
      eventType: this.eventTypeFilter.trim() || undefined,
      category: this.categoryFilter.trim() || undefined,
      assetId: this.assetIdFilter.trim() || undefined,
      agreementId: this.agreementIdFilter.trim() || undefined,
      participantId: this.participantIdFilter.trim() || undefined,
      modelName: this.modelNameFilter.trim() || undefined,
      correlationId: this.correlationIdFilter.trim() || undefined,
      status: this.statusFilter.trim() || undefined,
      q: this.searchFilter.trim() || undefined,
      limit: this.limit,
    };
  }

  private detailValue(event: ModelObserverEvent, key: string): unknown {
    return event.details?.[key];
  }

  private firstText(...values: unknown[]): string {
    const value = this.firstValue(...values);
    if (value === undefined || value === null) {
      return '-';
    }
    const text = String(value).trim();
    return text.length > 0 ? text : '-';
  }

  private firstValue(...values: unknown[]): unknown {
    return values.find(value => {
      if (value === undefined || value === null) {
        return false;
      }
      if (typeof value === 'string') {
        return value.trim().length > 0;
      }
      return true;
    });
  }

  private cleanText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
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

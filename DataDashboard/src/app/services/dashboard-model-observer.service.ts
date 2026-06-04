import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EdcConfig } from '@eclipse-edc/dashboard-core';
import { Observable, combineLatest, switchMap, take } from 'rxjs';
import { DashboardConnectorContextService } from './dashboard-connector-context.service';

export interface ModelObserverEvent {
  eventId?: string;
  eventType?: string;
  category?: string;
  occurredAt?: string;
  sourceComponent?: string;
  participantId?: string;
  providerParticipantId?: string;
  consumerParticipantId?: string;
  assetId?: string;
  modelId?: string;
  agreementId?: string;
  negotiationId?: string;
  transferProcessId?: string;
  usageSessionId?: string;
  benchmarkRunId?: string;
  correlationId?: string;
  modelName?: string;
  httpStatus?: number | string;
  latencyMs?: number | string;
  executionMode?: string;
  endpointKind?: string;
  taskType?: string;
  datasetFingerprint?: string;
  datasetRowCount?: number;
  selectedMetrics?: string[];
  benchmarkSummary?: Record<string, unknown>;
  status?: string;
  details?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ModelObserverEventFilters {
  eventType?: string;
  category?: string;
  assetId?: string;
  agreementId?: string;
  participantId?: string;
  negotiationId?: string;
  transferProcessId?: string;
  usageSessionId?: string;
  benchmarkRunId?: string;
  correlationId?: string;
  modelName?: string;
  status?: string;
  q?: string;
  limit?: number;
}

export interface ModelObserverSummary {
  totalEvents: number;
  assetCount: number;
  agreementCount: number;
  usageSessionCount: number;
  participantCount: number;
  eventTypes: Record<string, number>;
  categories?: Record<string, number>;
  recentEvents: ModelObserverEvent[];
}

export interface ModelObserverParticipantSummary {
  participantId: string;
  eventCount: number;
  assetCount: number;
  agreementCount: number;
  firstSeen: string;
  lastSeen: string;
  eventTypes: Record<string, number>;
}

@Injectable({
  providedIn: 'root',
})
export class DashboardModelObserverService {
  private readonly http = inject(HttpClient);
  private readonly context = inject(DashboardConnectorContextService);

  getSummary(): Observable<ModelObserverSummary> {
    return this.withContext((activeConfig, apiUrl) => {
      const headers = this.context.withApiTokenHeader(activeConfig, { accept: 'application/json' });
      return this.http.get<ModelObserverSummary>(`${apiUrl}/summary`, { headers });
    });
  }

  getEvents(filters: ModelObserverEventFilters = {}): Observable<ModelObserverEvent[]> {
    return this.withContext((activeConfig, apiUrl) => {
      const headers = this.context.withApiTokenHeader(activeConfig, { accept: 'application/json' });
      const params = this.toHttpParams(filters);
      return this.http.get<ModelObserverEvent[]>(`${apiUrl}/events`, { headers, params });
    });
  }

  getAssetTimeline(assetId: string, limit = 200): Observable<ModelObserverEvent[]> {
    return this.withContext((activeConfig, apiUrl) => {
      const headers = this.context.withApiTokenHeader(activeConfig, { accept: 'application/json' });
      const params = new HttpParams().set('limit', String(limit));
      return this.http.get<ModelObserverEvent[]>(`${apiUrl}/assets/${encodeURIComponent(assetId)}/timeline`, {
        headers,
        params,
      });
    });
  }

  getAgreementEvidence(agreementId: string, limit = 200): Observable<ModelObserverEvent[]> {
    return this.withContext((activeConfig, apiUrl) => {
      const headers = this.context.withApiTokenHeader(activeConfig, { accept: 'application/json' });
      const params = new HttpParams().set('limit', String(limit));
      return this.http.get<ModelObserverEvent[]>(`${apiUrl}/agreements/${encodeURIComponent(agreementId)}/evidence`, {
        headers,
        params,
      });
    });
  }

  getBenchmarks(assetId = '', limit = 200): Observable<ModelObserverEvent[]> {
    return this.withContext((activeConfig, apiUrl) => {
      const headers = this.context.withApiTokenHeader(activeConfig, { accept: 'application/json' });
      let params = new HttpParams().set('limit', String(limit));
      if (assetId.trim().length > 0) {
        params = params.set('assetId', assetId.trim());
      }
      return this.http.get<ModelObserverEvent[]>(`${apiUrl}/benchmarks`, { headers, params });
    });
  }

  getParticipants(): Observable<ModelObserverParticipantSummary[]> {
    return this.withContext((activeConfig, apiUrl) => {
      const headers = this.context.withApiTokenHeader(activeConfig, { accept: 'application/json' });
      return this.http.get<ModelObserverParticipantSummary[]>(`${apiUrl}/participants`, { headers });
    });
  }

  recordEvent(event: ModelObserverEvent): Observable<ModelObserverEvent> {
    return this.withContext((activeConfig, apiUrl) => {
      const headers = this.context.withApiTokenHeader(activeConfig, {
        'content-type': 'application/json',
        accept: 'application/json',
      });
      return this.http.post<ModelObserverEvent>(`${apiUrl}/events`, event, { headers });
    });
  }

  private withContext<T>(request: (activeConfig: EdcConfig, apiUrl: string) => Observable<T>): Observable<T> {
    return combineLatest([this.context.activeConfig$, this.context.modelObserverApiUrl$]).pipe(
      take(1),
      switchMap(([activeConfig, apiUrl]) => request(activeConfig, apiUrl)),
    );
  }

  private toHttpParams(filters: ModelObserverEventFilters): HttpParams {
    let params = new HttpParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value === undefined || value === null) {
        return;
      }
      const text = String(value).trim();
      if (text.length === 0) {
        return;
      }
      params = params.set(key, text);
    });
    return params;
  }
}

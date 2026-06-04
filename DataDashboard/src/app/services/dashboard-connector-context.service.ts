import { Injectable, inject } from '@angular/core';
import { DashboardStateService, EdcConfig } from '@eclipse-edc/dashboard-core';
import { combineLatest, filter, map, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class DashboardConnectorContextService {
  private readonly state = inject(DashboardStateService);

  readonly activeConfig$: Observable<EdcConfig> = this.state.currentEdcConfig$.pipe(
    filter((config): config is EdcConfig => !!config),
  );

  readonly allConfigs$: Observable<EdcConfig[]> = this.state.edcConfigs$;

  readonly counterPartyConfig$: Observable<EdcConfig | undefined> = combineLatest([
    this.activeConfig$,
    this.allConfigs$,
  ]).pipe(map(([active, configs]) => this.resolveCounterPartyConfig(active, configs)));

  readonly filterApiUrl$: Observable<string> = this.activeConfig$.pipe(
    map(config => this.buildDefaultApiUrl(config.defaultUrl, '/filter/catalog')),
  );

  readonly inferApiUrl$: Observable<string> = this.activeConfig$.pipe(
    map(config => this.buildDefaultApiUrl(config.defaultUrl, '/infer')),
  );

  readonly modelObserverApiUrl$: Observable<string> = this.activeConfig$.pipe(
    map(config => this.buildDefaultApiUrl(config.defaultUrl, '/model-observer')),
  );

  readonly managementUrl$: Observable<string> = this.activeConfig$.pipe(
    map(config => this.trimTrailingSlash(config.managementUrl)),
  );

  readonly counterPartyProtocolUrl$: Observable<string> = this.counterPartyConfig$.pipe(
    map(config => this.trimTrailingSlash(config?.protocolUrl || '')),
  );

  withApiTokenHeader(config: EdcConfig, headers: Record<string, string>): Record<string, string> {
    if (!config.apiToken) {
      return headers;
    }
    return {
      ...headers,
      'x-api-key': config.apiToken,
    };
  }

  private resolveCounterPartyConfig(active: EdcConfig, configs: EdcConfig[]): EdcConfig | undefined {
    const withoutCurrent = configs.filter(config => config.connectorName !== active.connectorName);
    if (withoutCurrent.length === 0) {
      return undefined;
    }

    const activeRole = this.inferRole(active.connectorName);
    if (activeRole === 'provider') {
      return withoutCurrent.find(config => this.inferRole(config.connectorName) === 'consumer') || withoutCurrent[0];
    }
    if (activeRole === 'consumer') {
      return withoutCurrent.find(config => this.inferRole(config.connectorName) === 'provider') || withoutCurrent[0];
    }

    return withoutCurrent[0];
  }

  private inferRole(connectorName: string): 'provider' | 'consumer' | 'unknown' {
    const normalized = (connectorName || '').toLowerCase();
    if (normalized.includes('provider')) {
      return 'provider';
    }
    if (normalized.includes('consumer')) {
      return 'consumer';
    }
    return 'unknown';
  }

  private trimTrailingSlash(value: string): string {
    return (value || '').replace(/\/+$/, '');
  }

  private buildDefaultApiUrl(defaultUrl: string, suffix: string): string {
    const base = this.trimTrailingSlash(defaultUrl);
    if (base.endsWith('/api')) {
      return `${base}${suffix}`;
    }
    return `${base}/api${suffix}`;
  }
}

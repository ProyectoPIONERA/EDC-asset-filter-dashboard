import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { EdcConfig } from '@eclipse-edc/dashboard-core';
import { combineLatest, forkJoin, map, Observable, of, switchMap, take } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { DashboardConnectorContextService } from './dashboard-connector-context.service';
import { MlGuiAsset, MlGuiAssetFilter } from '../models/ml-gui-asset';

const DEFAULT_CONTEXT = { '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' } };

@Injectable({
  providedIn: 'root',
})
export class DashboardMlBrowserService {
  private readonly http = inject(HttpClient);
  private readonly context = inject(DashboardConnectorContextService);

  getMachineLearningAssets(
    filters?: MlGuiAssetFilter,
    searchTerm?: string,
    counterPartyAddress?: string | null,
  ): Observable<MlGuiAsset[]> {
    return combineLatest([
      this.context.activeConfig$,
      this.context.filterApiUrl$,
      this.context.managementUrl$,
      this.context.counterPartyProtocolUrl$,
    ]).pipe(
      take(1),
      switchMap(([activeConfig, filterApiUrl, managementUrl, autoCounterPartyProtocolUrl]) => {
        const resolvedCounterPartyAddress =
          counterPartyAddress === undefined ? autoCounterPartyProtocolUrl : (counterPartyAddress || '');

        const external$ = resolvedCounterPartyAddress
          ? this.fetchExternalCatalogAssets(
              activeConfig,
              filterApiUrl,
              managementUrl,
              resolvedCounterPartyAddress,
              filters,
              searchTerm,
            ).pipe(catchError(() => of([] as MlGuiAsset[])))
          : of([] as MlGuiAsset[]);

        return forkJoin({
          external: external$,
          local: this.fetchLocalAssets(activeConfig, managementUrl).pipe(catchError(() => of([] as MlGuiAsset[]))),
          agreedAssetIds: this.getAgreedAssetIds(activeConfig, managementUrl).pipe(
            catchError(() => of(new Set<string>())),
          ),
        }).pipe(
          map(({ external, local, agreedAssetIds }) => {
            const merged = this.mergeAssets(local, external);
            merged.forEach(asset => {
              asset.hasAgreement = asset.isLocal ? true : agreedAssetIds.has(asset.id);
              asset.negotiationInProgress = false;
            });
            return this.applyClientFilters(merged, filters, searchTerm);
          }),
        );
      }),
    );
  }

  getAgreedAssetIdsForCurrentConnector(): Observable<Set<string>> {
    return combineLatest([this.context.activeConfig$, this.context.managementUrl$]).pipe(
      take(1),
      switchMap(([activeConfig, managementUrl]) => this.getAgreedAssetIds(activeConfig, managementUrl)),
    );
  }

  initiateNegotiation(
    asset: MlGuiAsset,
    offerId: string,
    counterPartyAddress?: string | null,
  ): Observable<string | null> {
    return combineLatest([
      this.context.activeConfig$,
      this.context.managementUrl$,
      this.context.counterPartyProtocolUrl$,
    ]).pipe(
      take(1),
      switchMap(([activeConfig, managementUrl, autoCounterPartyProtocolUrl]) => {
        const headers = this.context.withApiTokenHeader(activeConfig, {
          'content-type': 'application/json',
          accept: 'application/json',
        });

        const resolvedCounterPartyAddress =
          counterPartyAddress || asset.counterPartyAddress || autoCounterPartyProtocolUrl;
        const policyAssigner = asset.participantId || this.inferCounterPartyId(activeConfig.connectorName);
        const body = {
          ...DEFAULT_CONTEXT,
          '@type': 'ContractRequest',
          counterPartyAddress: resolvedCounterPartyAddress,
          protocol: 'dataspace-protocol-http',
          policy: {
            '@context': 'http://www.w3.org/ns/odrl.jsonld',
            '@id': offerId,
            '@type': 'Offer',
            assigner: policyAssigner,
            target: asset.id,
          },
        };

        return this.http
          .post<unknown>(`${managementUrl}/v3/contractnegotiations`, body, { headers })
          .pipe(map(response => this.extractId(response)));
      }),
    );
  }

  getNegotiationState(negotiationId: string): Observable<string> {
    return combineLatest([this.context.activeConfig$, this.context.managementUrl$]).pipe(
      take(1),
      switchMap(([activeConfig, managementUrl]) => {
        const headers = this.context.withApiTokenHeader(activeConfig, { accept: 'application/json' });
        return this.http
          .get<unknown>(`${managementUrl}/v3/contractnegotiations/${encodeURIComponent(negotiationId)}`, { headers })
          .pipe(map(response => this.extractNegotiationState(response)));
      }),
    );
  }

  private fetchExternalCatalogAssets(
    activeConfig: EdcConfig,
    filterApiUrl: string,
    managementUrl: string,
    counterPartyAddress: string,
    filters?: MlGuiAssetFilter,
    searchTerm?: string,
  ): Observable<MlGuiAsset[]> {
    const query = this.buildFilterQuery(filters, searchTerm);
    const hasServerFilterQuery = query !== 'profile=daimo';
    const url = query.length > 0 ? `${filterApiUrl}?${query}` : filterApiUrl;

    const body: Record<string, unknown> = {
      ...DEFAULT_CONTEXT,
      counterPartyAddress,
      protocol: 'dataspace-protocol-http',
    };

    const headers = this.context.withApiTokenHeader(activeConfig, {
      'content-type': 'application/json',
      accept: 'application/json',
    });

    return this.http
      .post<unknown>(url, body, { headers })
      .pipe(
        map(response => this.parseCatalogResponse(response, counterPartyAddress)),
        switchMap(assets => {
          if (assets.length > 0 || hasServerFilterQuery) {
            return of(assets);
          }
          // Fallback to management catalog request when filter endpoint returns empty base list.
          return this.fetchCatalogAssetsFromManagement(activeConfig, managementUrl, counterPartyAddress).pipe(
            catchError(() => of(assets)),
          );
        }),
      );
  }

  private fetchCatalogAssetsFromManagement(
    activeConfig: EdcConfig,
    managementUrl: string,
    counterPartyAddress: string,
  ): Observable<MlGuiAsset[]> {
    const body: Record<string, unknown> = {
      ...DEFAULT_CONTEXT,
      counterPartyAddress,
      protocol: 'dataspace-protocol-http',
    };

    const headers = this.context.withApiTokenHeader(activeConfig, {
      'content-type': 'application/json',
      accept: 'application/json',
    });

    return this.http
      .post<unknown>(`${managementUrl}/v3/catalog/request`, body, { headers })
      .pipe(map(response => this.parseCatalogResponse(response, counterPartyAddress)));
  }

  private fetchLocalAssets(activeConfig: EdcConfig, managementUrl: string): Observable<MlGuiAsset[]> {
    const body = {
      ...DEFAULT_CONTEXT,
      offset: 0,
      limit: 1000,
    };

    const headers = this.context.withApiTokenHeader(activeConfig, {
      'content-type': 'application/json',
      accept: 'application/json',
    });

    return this.http.post<unknown>(`${managementUrl}/v3/assets/request`, body, { headers }).pipe(
      map(response => this.normalizeArray(response).map(item => this.parseLocalAsset(this.asRecord(item), activeConfig))),
    );
  }

  private getAgreedAssetIds(activeConfig: EdcConfig, managementUrl: string): Observable<Set<string>> {
    const body = {
      ...DEFAULT_CONTEXT,
      filterExpression: [],
    };

    const headers = this.context.withApiTokenHeader(activeConfig, {
      'content-type': 'application/json',
      accept: 'application/json',
    });

    return this.http.post<unknown>(`${managementUrl}/v3/contractagreements/request`, body, { headers }).pipe(
      map(response => {
        const ids = new Set<string>();
        this.normalizeArray(response).forEach(item => {
          const assetId = this.extractAgreementAssetId(this.asRecord(item));
          if (assetId) {
            ids.add(assetId);
          }
        });
        return ids;
      }),
    );
  }

  private extractAgreementAssetId(agreement: Record<string, unknown>): string | null {
    const directCandidates = [
      agreement['assetId'],
      agreement['edc:assetId'],
      agreement['https://w3id.org/edc/v0.0.1/ns/assetId'],
    ];

    for (const value of directCandidates) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    const assetNode = agreement['asset'] || agreement['edc:asset'];
    if (typeof assetNode === 'string' && assetNode.trim().length > 0) {
      return assetNode.trim();
    }

    if (assetNode && typeof assetNode === 'object') {
      const nested = this.asRecord(assetNode);
      const nestedId = nested['@id'] || nested['id'] || nested['assetId'];
      if (typeof nestedId === 'string' && nestedId.trim().length > 0) {
        return nestedId.trim();
      }
    }

    return null;
  }

  private parseCatalogResponse(response: unknown, counterPartyAddress: string): MlGuiAsset[] {
    const catalog = this.asRecord(response);
    const datasetsRaw = catalog['dcat:dataset'] || catalog['dataset'];
    const datasets = this.normalizeArray(datasetsRaw);
    const catalogParticipantId = this.extractCatalogParticipantId(catalog);

    return datasets.map(dataset =>
      this.parseCatalogDataset(this.asRecord(dataset), catalogParticipantId, counterPartyAddress),
    );
  }

  private parseCatalogDataset(
    dataset: Record<string, unknown>,
    catalogParticipantId: string,
    counterPartyAddress: string,
  ): MlGuiAsset {
    const id = this.firstString(dataset['@id'], dataset['id']) || 'unknown';
    const name = this.firstString(dataset['name']) || id;

    const daimoMetadata = this.extractDaimoMetadata(dataset);
    const metadataSources = [daimoMetadata, dataset];

    const keywords = this.readFirstList(metadataSources, ['dcat:keyword', 'keywords']);
    const licenses = this.readFirstList(metadataSources, ['dct:license', 'dcterms:license', 'http://purl.org/dc/terms/license', 'license']);
    const languages = this.readFirstList(metadataSources, ['dct:language', 'dcterms:language', 'http://purl.org/dc/terms/language', 'language']);

    const taskCategory = this.readFirstString(metadataSources, ['daimo:taskCategory', 'https://w3id.org/pionera/daimo#taskCategory', 'taskCategory']);
    const taskType = this.readFirstString(metadataSources, ['daimo:taskType', 'https://w3id.org/pionera/daimo#taskType', 'taskType']);
    const libraryName = this.readFirstString(metadataSources, ['daimo:libraryName', 'https://w3id.org/pionera/daimo#libraryName', 'libraryName']);
    const subtasks = this.readFirstList(metadataSources, ['daimo:subtask', 'https://w3id.org/pionera/daimo#subtask', 'subtask']);
    const modalities = this.readFirstList(metadataSources, ['daimo:modality', 'https://w3id.org/pionera/daimo#modality', 'modality']);
    const endpointBehaviors = this.readFirstList(metadataSources, ['daimo:endpointBehavior', 'https://w3id.org/pionera/daimo#endpointBehavior', 'endpointBehavior']);

    const contentType = this.firstString(dataset['contenttype']);
    const storageInfo = this.extractStorageInfoFromCatalogDataset(dataset);
    const transferFormat = this.extractTransferFormatFromCatalogDataset(dataset);
    const byteSize = this.extractDatasetByteSize(dataset);
    const participantId = this.extractParticipantId(dataset, catalogParticipantId);

    const policyRaw = dataset['odrl:hasPolicy'];
    const contractOffers = this.normalizeArray(policyRaw);

    return {
      id,
      name,
      version: 'N/A',
      description: '',
      shortDescription: '',
      assetType: 'machineLearning',
      contentType: contentType || '',
      byteSize,
      format: transferFormat,
      keywords,
      licenses,
      languages,
      tasks: taskCategory ? [taskCategory] : [],
      taskTypes: taskType ? [taskType] : [],
      subtasks,
      modalities,
      endpointBehaviors,
      libraries: libraryName ? [libraryName] : [],
      modelType: '',
      storageType: storageInfo.storageType,
      fileName: storageInfo.fileName,
      owner: participantId,
      isLocal: false,
      hasContractOffers: contractOffers.length > 0,
      contractOffers,
      endpointUrl: undefined,
      participantId,
      counterPartyAddress,
      assetData: dataset,
      rawProperties: dataset,
      originator: 'Federated Catalog',
    };
  }

  private parseLocalAsset(asset: Record<string, unknown>, activeConfig: EdcConfig): MlGuiAsset {
    const properties = this.asRecord(asset['edc:properties'] || asset['properties']);
    const dataAddress = this.asRecord(asset['edc:dataAddress'] || asset['dataAddress']);

    const daimoMetadata = this.extractDaimoMetadata(properties);
    const sources: Record<string, unknown>[] = [daimoMetadata, properties, asset];

    const readText = (keys: string[], fallback = ''): string => {
      for (const source of sources) {
        for (const key of keys) {
          const value = source[key];
          if (typeof value === 'string' && value.trim().length > 0) {
            return value;
          }
        }
      }
      return fallback;
    };

    const readList = (keys: string[]): string[] => {
      for (const source of sources) {
        for (const key of keys) {
          const value = source[key];
          if (Array.isArray(value)) {
            return value.map(item => String(item)).filter(Boolean);
          }
          if (typeof value === 'string' && value.trim().length > 0) {
            return [value];
          }
        }
      }
      return [];
    };

    const readListFromDaimo = (key: string): string[] =>
      readList([`daimo:${key}`, `https://w3id.org/pionera/daimo#${key}`, key]);

    const id = this.firstString(asset['@id'], asset['id']) || 'unknown-local';
    const name = readText(['name', 'asset:prop:name', 'dct:title'], id);
    const contentType = readText([
      'contenttype',
      'asset:prop:contenttype',
    ]);

    const version = readText(['version', 'asset:prop:version'], 'N/A');
    const explicitDescription = readText(['description', 'asset:prop:description', 'dcterms:description']);
    const shortDescription = readText(['shortDescription', 'asset:prop:shortDescription'], explicitDescription);
    const task = readText(['daimo:taskCategory', 'taskCategory', 'https://w3id.org/pionera/daimo#taskCategory']);
    const taskType = readText(['daimo:taskType', 'taskType', 'https://w3id.org/pionera/daimo#taskType']);
    const library = readText(['daimo:libraryName', 'libraryName', 'https://w3id.org/pionera/daimo#libraryName']);

    const keywords = readList(['dcat:keyword', 'keywords', 'asset:prop:keywords']);
    const licenses = readList(['dct:license', 'dcterms:license', 'http://purl.org/dc/terms/license', 'license']);
    const languages = readList(['dct:language', 'dcterms:language', 'http://purl.org/dc/terms/language', 'language']);
    const tasks = [...(task ? [task] : [])];
    const taskTypes = [...(taskType ? [taskType] : [])];
    const subtasks = readListFromDaimo('subtask');
    const modalities = readListFromDaimo('modality');
    const endpointBehaviors = readListFromDaimo('endpointBehavior');
    const libraries = [...(library ? [library] : [])];

    const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

    return {
      id,
      name,
      version,
      description: explicitDescription,
      shortDescription: shortDescription || explicitDescription,
      assetType: readText(['asset:prop:type', 'type'], 'machineLearning'),
      contentType,
      byteSize: readText(['asset:prop:byteSize', 'byteSize']),
      format: readText(['format', 'asset:prop:format', 'dct:format', 'dcterms:format', 'http://purl.org/dc/terms/format'], this.firstString(dataAddress['type']) || ''),
      keywords: unique(keywords),
      licenses: unique(licenses),
      languages: unique(languages),
      tasks: unique(tasks),
      taskTypes: unique(taskTypes),
      subtasks: unique(subtasks),
      modalities: unique(modalities),
      endpointBehaviors: unique(endpointBehaviors),
      libraries: unique(libraries),
      modelType: '',
      storageType: this.firstString(dataAddress['type'], dataAddress['@type']) || '',
      fileName: this.firstString(dataAddress['keyName'], dataAddress['s3Key'], dataAddress['fileName']) || '',
      owner: activeConfig.connectorName,
      isLocal: true,
      hasContractOffers: false,
      contractOffers: [],
      endpointUrl: undefined,
      participantId: '',
      counterPartyAddress: undefined,
      assetData: asset,
      rawProperties: {
        ...asset,
        properties,
      },
      originator: 'Local Connector',
    };
  }

  private buildFilterQuery(filters?: MlGuiAssetFilter, searchTerm?: string): string {
    const params: string[] = ['profile=daimo'];

    if (searchTerm && searchTerm.trim().length > 0) {
      params.push(`q=${encodeURIComponent(searchTerm.trim())}`);
    }

    if (filters?.licenses?.length) {
      params.push(`license=${encodeURIComponent(filters.licenses.join(','))}`);
    }

    if (filters?.languages?.length) {
      params.push(`language=${encodeURIComponent(filters.languages.join(','))}`);
    }

    if (filters?.tasks?.length) {
      params.push(`task=${encodeURIComponent(filters.tasks.join(','))}`);
    }

    if (filters?.taskTypes?.length) {
      params.push(`tasktype=${encodeURIComponent(filters.taskTypes.join(','))}`);
    }

    if (filters?.subtasks?.length) {
      params.push(`subtask=${encodeURIComponent(filters.subtasks.join(','))}`);
    }

    if (filters?.libraries?.length) {
      params.push(`library=${encodeURIComponent(filters.libraries.join(','))}`);
    }

    if (filters?.modalities?.length) {
      params.push(`modality=${encodeURIComponent(filters.modalities.join(','))}`);
    }

    if (filters?.endpointBehaviors?.length) {
      params.push(`endpointbehavior=${encodeURIComponent(filters.endpointBehaviors.join(','))}`);
    }

    if (filters?.formats?.length) {
      params.push(`format=${encodeURIComponent(filters.formats.join(','))}`);
    }

    return params.join('&');
  }

  private extractTransferFormatFromCatalogDataset(dataset: Record<string, unknown>): string {
    const distributions = this.normalizeArray(dataset['dcat:distribution'] || dataset['distribution']);

    for (const distributionRaw of distributions) {
      const distribution = this.asRecord(distributionRaw);
      const format = this.firstString(
        this.asRecord(distribution['dct:format'])['@id'],
        this.asRecord(distribution['dct:format'])['id'],
      );
      if (format) {
        return format;
      }
    }

    return '';
  }

  private extractDatasetByteSize(dataset: Record<string, unknown>): string {
    const candidates = [dataset['dcat:byteSize'], dataset['byteSize']];
    return this.firstString(...candidates) || '';
  }

  private extractCatalogParticipantId(catalog: Record<string, unknown>): string {
    const keys = [
      'dspace:participantId',
      'participantId',
      'participant_id',
      'https://w3id.org/dspace/v0.8/participantId',
      'https://w3id.org/dspace/2024/1/participantId',
      'https://w3id.org/dspace/2025/1/participantId',
    ];

    for (const key of keys) {
      const value = catalog[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return '';
  }

  private extractParticipantId(dataset: Record<string, unknown>, catalogParticipantId: string): string {
    const readText = (obj: Record<string, unknown>): string =>
      this.firstString(
        obj['dspace:participantId'],
        obj['participantId'],
        obj['participant_id'],
        obj['https://w3id.org/dspace/v0.8/participantId'],
        obj['https://w3id.org/dspace/2024/1/participantId'],
        obj['https://w3id.org/dspace/2025/1/participantId'],
      ) || '';

    const direct = readText(dataset);
    if (direct) {
      return direct;
    }

    const fromProps = readText(this.asRecord(dataset['properties'] || dataset['edc:properties']));
    if (fromProps) {
      return fromProps;
    }

    if (catalogParticipantId) {
      return catalogParticipantId;
    }

    return 'counterparty';
  }

  private extractStorageInfoFromCatalogDataset(dataset: Record<string, unknown>): { storageType: string; fileName: string } {
    const normalizeType = (value: string): string => {
      const lower = value.toLowerCase();
      if (lower.includes('http')) {
        return 'HttpData';
      }
      if (lower.includes('s3') || lower.includes('amazon')) {
        return 'AmazonS3';
      }
      if (lower.includes('dataspaceprototypestore')) {
        return 'DataSpacePrototypeStore';
      }
      return value;
    };

    const explicitType = this.firstString(
      dataset['storageType'],
      dataset['edc:dataAddressType'],
    );
    if (explicitType) {
      return { storageType: normalizeType(explicitType), fileName: '' };
    }

    const distributions = this.normalizeArray(dataset['dcat:distribution'] || dataset['distribution']);
    for (const distributionRaw of distributions) {
      const distribution = this.asRecord(distributionRaw);

      const type = this.firstString(distribution['type'], distribution['edc:dataAddressType']);
      const fileName = this.firstString(
        distribution['fileName'],
        distribution['name'],
        distribution['s3Key'],
        distribution['keyName'],
      );

      if (type) {
        return { storageType: normalizeType(type), fileName: fileName || '' };
      }

      const accessServices = this.normalizeArray(distribution['dcat:accessService'] || distribution['accessService']);
      for (const serviceRaw of accessServices) {
        const service = this.asRecord(serviceRaw);
        const bucket = this.firstString(service['bucketName']);
        const keyName = this.firstString(service['s3Key'], service['keyName'], service['fileName'], service['name']);
        const endpoint = this.firstString(
          service['dcat:endpointURL'],
          service['dcat:endpointUrl'],
          service['endpointURL'],
          service['endpointUrl'],
          service['baseUrl'],
          service['endpoint'],
        );

        if (bucket || keyName) {
          return { storageType: 'AmazonS3', fileName: keyName || '' };
        }

        if (endpoint) {
          return { storageType: 'HttpData', fileName: '' };
        }
      }
    }

    return { storageType: '', fileName: '' };
  }

  private mergeAssets(localAssets: MlGuiAsset[], externalAssets: MlGuiAsset[]): MlGuiAsset[] {
    const merged = new Map<string, MlGuiAsset>();
    [...externalAssets, ...localAssets].forEach(asset => {
      const key = `${asset.id}::${asset.isLocal ? 'local' : 'external'}`;
      merged.set(key, asset);
    });
    return Array.from(merged.values());
  }

  private applyClientFilters(assets: MlGuiAsset[], filters?: MlGuiAssetFilter, searchTerm?: string): MlGuiAsset[] {
    let result = [...assets];
    const term = (searchTerm || '').trim().toLowerCase();

    if (term.length > 0) {
      result = result.filter(asset =>
        (asset.name || '').toLowerCase().includes(term) ||
        (asset.id || '').toLowerCase().includes(term) ||
        (asset.description || '').toLowerCase().includes(term) ||
        (asset.shortDescription || '').toLowerCase().includes(term) ||
        (asset.keywords || []).some(keyword => keyword.toLowerCase().includes(term)) ||
        (asset.tasks || []).some(task => task.toLowerCase().includes(term)) ||
        (asset.taskTypes || []).some(taskType => taskType.toLowerCase().includes(term)) ||
        (asset.subtasks || []).some(subtask => subtask.toLowerCase().includes(term)) ||
        (asset.modalities || []).some(modality => modality.toLowerCase().includes(term)) ||
        (asset.endpointBehaviors || []).some(endpointBehavior => endpointBehavior.toLowerCase().includes(term)) ||
        (asset.libraries || []).some(library => library.toLowerCase().includes(term)),
      );
    }

    if (filters?.licenses?.length) {
      result = result.filter(asset => (asset.licenses || []).some(license => filters.licenses!.includes(license)));
    }
    if (filters?.languages?.length) {
      result = result.filter(asset => (asset.languages || []).some(language => filters.languages!.includes(language)));
    }
    if (filters?.tasks?.length) {
      result = result.filter(asset => (asset.tasks || []).some(task => filters.tasks!.includes(task)));
    }
    if (filters?.taskTypes?.length) {
      result = result.filter(asset => (asset.taskTypes || []).some(taskType => filters.taskTypes!.includes(taskType)));
    }
    if (filters?.subtasks?.length) {
      result = result.filter(asset => (asset.subtasks || []).some(subtask => filters.subtasks!.includes(subtask)));
    }
    if (filters?.modalities?.length) {
      result = result.filter(asset => (asset.modalities || []).some(modality => filters.modalities!.includes(modality)));
    }
    if (filters?.endpointBehaviors?.length) {
      result = result.filter(asset =>
        (asset.endpointBehaviors || []).some(endpointBehavior => filters.endpointBehaviors!.includes(endpointBehavior)),
      );
    }
    if (filters?.libraries?.length) {
      result = result.filter(asset => (asset.libraries || []).some(library => filters.libraries!.includes(library)));
    }
    if (filters?.formats?.length) {
      result = result.filter(asset => !!asset.format && filters.formats!.includes(asset.format));
    }
    if (filters?.storageTypes?.length) {
      result = result.filter(asset => !!asset.storageType && filters.storageTypes!.includes(asset.storageType));
    }
    if (filters?.assetSources?.length) {
      result = result.filter(asset => {
        const source = asset.isLocal ? 'Local Asset' : 'External Asset';
        return filters.assetSources!.includes(source);
      });
    }

    return result;
  }

  private extractNegotiationState(response: unknown): string {
    const item = this.asRecord(response);
    const candidates = [
      item['state'],
      item['edc:state'],
      item['negotiationState'],
      item['edc:negotiationState'],
      item['https://w3id.org/edc/v0.0.1/ns/state'],
    ];

    const state = this.firstString(...candidates);
    return (state || 'UNKNOWN').toUpperCase();
  }

  private extractId(response: unknown): string | null {
    const item = this.asRecord(response);
    const value = this.firstString(item['@id'], item['id']);
    return value || null;
  }

  private inferCounterPartyId(connectorName: string): string {
    const normalized = connectorName.toLowerCase();
    if (normalized.includes('provider')) {
      return 'consumer';
    }
    if (normalized.includes('consumer')) {
      return 'provider';
    }
    return 'counterparty';
  }

  private normalizeArray(value: unknown): unknown[] {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value;
    }

    const asRecord = this.asRecord(value);
    if (Array.isArray(asRecord['results'])) {
      return asRecord['results'] as unknown[];
    }
    if (Array.isArray(asRecord['items'])) {
      return asRecord['items'] as unknown[];
    }
    if (Array.isArray(asRecord['contractAgreements'])) {
      return asRecord['contractAgreements'] as unknown[];
    }
    if (Array.isArray(asRecord['@graph'])) {
      return asRecord['@graph'] as unknown[];
    }

    return [value];
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object') {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private extractDaimoMetadata(source: Record<string, unknown>): Record<string, unknown> {
    const rawAssetData = source['assetData']
      || source['edc:assetData']
      || source['https://w3id.org/edc/v0.0.1/ns/assetData'];
    const assetData = this.normalizeAssetData(rawAssetData);

    return this.asRecord(assetData['JS_DAIMO_Model'] || assetData['JS_DAIMO_Dataset']);
  }

  private normalizeAssetData(assetData: unknown): Record<string, unknown> {
    if (typeof assetData === 'string') {
      try {
        return this.asRecord(JSON.parse(assetData));
      } catch {
        return {};
      }
    }

    return this.asRecord(assetData);
  }

  private readFirstString(sources: Record<string, unknown>[], keys: string[]): string {
    for (const source of sources) {
      const value = this.firstString(...keys.map(key => source[key]));
      if (value) {
        return value;
      }
    }
    return '';
  }

  private readFirstList(sources: Record<string, unknown>[], keys: string[]): string[] {
    for (const source of sources) {
      const value = this.readCatalogList(source, keys);
      if (value.length > 0) {
        return value;
      }
    }
    return [];
  }

  private readCatalogList(dataset: Record<string, unknown>, keys: string[]): string[] {
    for (const key of keys) {
      const value = dataset[key];
      if (Array.isArray(value)) {
        return value.map(item => String(item)).filter(Boolean);
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        return [value.trim()];
      }
    }
    return [];
  }

  private firstString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'number') {
        return String(value);
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { combineLatest, map, Observable, switchMap, take } from 'rxjs';
import {
  BenchmarkModelType,
  ExecutableAsset,
  InputSchemaFieldSpec,
  MlGuiAsset,
  ModelRequestShape,
  ModelExecutionRequest,
  ModelExecutionResult,
} from '../models/ml-gui-asset';
import { DashboardConnectorContextService } from './dashboard-connector-context.service';
import { DashboardMlBrowserService } from './dashboard-ml-browser.service';

@Injectable({
  providedIn: 'root',
})
export class DashboardModelExecutionService {
  private readonly http = inject(HttpClient);
  private readonly context = inject(DashboardConnectorContextService);
  private readonly browserService = inject(DashboardMlBrowserService);

  getExecutableAssets(): Observable<ExecutableAsset[]> {
    return this.browserService.getMachineLearningAssets().pipe(
      map(assets =>
        assets
          .filter(asset => this.isTechnicallyExecutable(asset))
          .filter(asset => !!asset.isLocal || !!asset.hasAgreement)
          .map(asset => this.toExecutableAsset(asset)),
      ),
    );
  }

  executeModel(request: ModelExecutionRequest): Observable<ModelExecutionResult> {
    return combineLatest([this.context.activeConfig$, this.context.inferApiUrl$]).pipe(
      take(1),
      switchMap(([activeConfig, inferApiUrl]) => {
        const headers = this.context.withApiTokenHeader(activeConfig, {
          'content-type': 'application/json',
          accept: 'application/json',
        });

        const body: Record<string, unknown> = {
          assetId: request.assetId,
          method: request.method || 'POST',
          path: request.path || '/infer',
          headers: request.headers || { 'Content-Type': 'application/json' },
          payload: request.payload,
        };
        this.addOptional(body, 'modelName', request.modelName);
        this.addOptional(body, 'usageSessionId', request.usageSessionId);
        this.addOptional(body, 'correlationId', request.correlationId);
        this.addOptional(body, 'benchmarkRunId', request.benchmarkRunId);

        return this.http.post<unknown>(inferApiUrl, body, { headers }).pipe(
          map(response => ({
            status: 'success' as const,
            assetId: request.assetId,
            output: response,
            timestamp: new Date().toISOString(),
          })),
        );
      }),
    );
  }

  private addOptional(target: Record<string, unknown>, key: string, value: unknown): void {
    if (typeof value === 'string' && value.trim().length === 0) {
      return;
    }
    if (value !== undefined && value !== null) {
      target[key] = value;
    }
  }

  private isTechnicallyExecutable(asset: MlGuiAsset): boolean {
    const tags = (asset.keywords || []).map(tag => tag.toLowerCase());
    const hasInferenceTag = tags.includes('inference') || tags.includes('endpoint') || tags.includes('model-serving');
    const hasInferencePathMetadata = this.hasInferencePathMetadata(asset);
    return hasInferenceTag || hasInferencePathMetadata;
  }

  private hasInferencePathMetadata(asset: MlGuiAsset): boolean {
    const value = this.readAssetValue(asset, [
      'https://w3id.org/pionera/daimo#inferencePath',
      'daimo:inferencePath',
      'inferencePath',
    ]);
    return typeof value === 'string' && value.trim().length > 0;
  }

  private toExecutableAsset(asset: MlGuiAsset): ExecutableAsset {
    const inputSchema = this.extractInputSchema(asset);
    const inputSchemaFields = this.extractInputSchemaFields(asset, inputSchema);

    return {
      id: asset.id,
      name: asset.name,
      executionPath: this.extractInferencePath(asset),
      contentType: asset.contentType,
      tags: asset.keywords,
      tasks: [...(asset.tasks || []), ...(asset.subtasks || [])],
      isLocal: !!asset.isLocal,
      inputSchema,
      inputSchemaFields,
      inputSchemaDraft: this.extractSchemaDraft(asset),
      inputExample: this.extractInputExample(asset),
      requestShape: this.extractRequestShape(asset, inputSchema),
      benchmarkModelType: this.extractBenchmarkModelType(asset),
      supportedMetrics: this.extractSupportedMetrics(asset),
    };
  }

  private extractInferencePath(asset: MlGuiAsset): string {
    const candidates = [
      'https://w3id.org/pionera/daimo#inferencePath',
      'daimo:inferencePath',
      'inferencePath',
      'path',
    ];

    const read = (record: Record<string, unknown>): string | null => {
      for (const key of candidates) {
        const value = record[key];
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }
      return null;
    };

    const direct = read(asset.rawProperties || {});
    if (direct) {
      return direct.startsWith('/') ? direct : `/${direct}`;
    }

    const nested = read((asset.rawProperties?.['properties'] as Record<string, unknown>) || {});
    if (nested) {
      return nested.startsWith('/') ? nested : `/${nested}`;
    }

    return '/infer';
  }

  private extractInputSchema(asset: MlGuiAsset): Record<string, unknown> | null {
    const value = this.readAssetValue(asset, [
      'daimo:inputSchema',
      'https://w3id.org/pionera/daimo#inputSchema',
      'inputSchema',
    ]);

    const parsed = this.parseJsonLikeValue(value);
    return this.isRecord(parsed) ? parsed : null;
  }

  private extractInputSchemaFields(
    asset: MlGuiAsset,
    inputSchema: Record<string, unknown> | null,
  ): InputSchemaFieldSpec[] {
    if (!inputSchema) {
      return [];
    }

    return this.buildInputSchemaFieldsFromSchema(inputSchema);
  }

  private extractSchemaDraft(asset: MlGuiAsset): string {
    const value = this.readAssetValue(asset, [
      'inputSchemaDraft',
    ]);
    return typeof value === 'string' ? value.trim() : '';
  }

  private extractInputExample(asset: MlGuiAsset): unknown {
    const value = this.readAssetValue(asset, [
      'daimo:inputExample',
      'https://w3id.org/pionera/daimo#inputExample',
      'inputExample',
    ]);
    return this.parseJsonLikeValue(value);
  }

  private extractRequestShape(
    asset: MlGuiAsset,
    inputSchema: Record<string, unknown> | null,
  ): ModelRequestShape {
    const value = this.readAssetValue(asset, [
      'daimo:requestShape',
      'https://w3id.org/pionera/daimo#requestShape',
      'requestShape',
    ]);
    const parsed = this.parseJsonLikeValue(value);

    if (typeof parsed === 'boolean') {
      return parsed ? 'batch' : 'single';
    }

    if (typeof parsed === 'string') {
      const normalized = parsed.trim().toLowerCase();
      if (['batch', 'array', 'list', 'records', 'rows'].includes(normalized)) {
        return 'batch';
      }
      if (['single', 'object', 'record', 'row'].includes(normalized)) {
        return 'single';
      }
    }

    return inputSchema && this.isArraySchema(inputSchema) ? 'batch' : 'single';
  }

  private extractBenchmarkModelType(asset: MlGuiAsset): BenchmarkModelType {
    const value = this.readAssetValue(asset, [
      'daimo:endpointBehavior',
      'https://w3id.org/pionera/daimo#endpointBehavior',
      'endpointBehavior',
    ]);
    const normalized = String(this.parseJsonLikeValue(value) || '').trim().toLowerCase().replace(/[\s_-]/g, '');
    return ['metric', 'metrics', 'evaluator', 'evaluation'].includes(normalized) ? 'metric' : 'output';
  }

  private extractSupportedMetrics(asset: MlGuiAsset): string[] {
    const value = this.readAssetValue(asset, [
      'daimo:metrics',
      'https://w3id.org/pionera/daimo#metrics',
      'metrics',
    ]);
    return this.collectMetricNames(this.parseJsonLikeValue(value));
  }

  private collectMetricNames(value: unknown): string[] {
    if (value === undefined || value === null) {
      return [];
    }

    if (typeof value === 'string') {
      return this.uniqueTextValues(value.split(','));
    }

    if (Array.isArray(value)) {
      return this.uniqueTextValues(value.flatMap(item => this.collectMetricNames(item)));
    }

    if (!this.isRecord(value)) {
      return [];
    }

    const directName = value['metric'] || value['name'] || value['key'] || value['id'];
    if (typeof directName === 'string' && directName.trim().length > 0) {
      return [directName.trim()];
    }

    return this.uniqueTextValues(
      Object.entries(value).flatMap(([key, nested]) => {
        if (typeof nested === 'number' || typeof nested === 'boolean' || typeof nested === 'string') {
          return [key];
        }
        return this.collectMetricNames(nested);
      }),
    );
  }

  private uniqueTextValues(values: string[]): string[] {
    return Array.from(new Set(values.map(value => value.trim()).filter(value => value.length > 0)));
  }

  private readAssetValue(asset: MlGuiAsset, keys: string[]): unknown {
    const directRecord = asset.rawProperties || {};
    const nestedRecord = (asset.rawProperties?.['properties'] as Record<string, unknown>) || {};
    const directDaimoRecord = this.extractDaimoMetadata(directRecord);
    const nestedDaimoRecord = this.extractDaimoMetadata(nestedRecord);

    for (const key of keys) {
      if (key in directDaimoRecord) {
        return directDaimoRecord[key];
      }
      if (key in nestedDaimoRecord) {
        return nestedDaimoRecord[key];
      }
      if (key in directRecord) {
        return directRecord[key];
      }
      if (key in nestedRecord) {
        return nestedRecord[key];
      }
    }

    return undefined;
  }

  private extractDaimoMetadata(source: Record<string, unknown>): Record<string, unknown> {
    const assetData = this.asRecord(
      source['assetData']
      || source['edc:assetData']
      || source['https://w3id.org/edc/v0.0.1/ns/assetData'],
    );
    return this.asRecord(assetData['JS_DAIMO_Model'] || assetData['JS_DAIMO_Dataset']);
  }

  private parseJsonLikeValue(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    }

    return value;
  }

  private buildInputSchemaFieldsFromSchema(schema: Record<string, unknown>): InputSchemaFieldSpec[] {
    const features: InputSchemaFieldSpec[] = [];
    if (this.isArraySchema(schema) && this.isRecord(schema['items'])) {
      this.collectInputSchemaFields(schema['items'], '', new Set<string>(), features);
    } else {
      this.collectInputSchemaFields(schema, '', new Set<string>(), features);
    }
    return features;
  }

  private isArraySchema(schema: Record<string, unknown>): boolean {
    const typeNode = schema['type'];
    if (typeof typeNode === 'string') {
      return typeNode.trim().toLowerCase() === 'array';
    }
    return Array.isArray(typeNode) && typeNode.some(item => typeof item === 'string' && item.trim().toLowerCase() === 'array');
  }

  private collectInputSchemaFields(
    schemaNode: Record<string, unknown>,
    prefix: string,
    requiredByParent: Set<string>,
    target: InputSchemaFieldSpec[],
  ): void {
    const propertiesNode = schemaNode['properties'];
    if (!this.isRecord(propertiesNode)) {
      return;
    }

    const requiredSet = new Set<string>([
      ...requiredByParent,
      ...this.readRequiredFields(schemaNode['required']),
    ]);

    Object.entries(propertiesNode).forEach(([propertyName, propertySchema]) => {
      const path = prefix ? `${prefix}.${propertyName}` : propertyName;
      const schemaRecord = this.isRecord(propertySchema) ? propertySchema : {};
      const inferredType = this.inferSchemaType(schemaRecord);
      const description = typeof schemaRecord['description'] === 'string' ? schemaRecord['description'] : undefined;

      target.push({
        name: path,
        type: inferredType,
        required: requiredSet.has(propertyName),
        description,
      });

      if (inferredType === 'object' && this.isRecord(schemaRecord['properties'])) {
        this.collectInputSchemaFields(schemaRecord, path, new Set<string>(), target);
      }

      if (inferredType === 'array' && this.isRecord(schemaRecord['items'])) {
        const itemSchema = schemaRecord['items'] as Record<string, unknown>;
        if (this.isRecord(itemSchema['properties'])) {
          this.collectInputSchemaFields(itemSchema, `${path}[]`, new Set<string>(), target);
        }
      }
    });
  }

  private inferSchemaType(schemaNode: Record<string, unknown>): string {
    const typeNode = schemaNode['type'];
    if (typeof typeNode === 'string' && typeNode.trim().length > 0) {
      return typeNode.trim().toLowerCase();
    }

    if (Array.isArray(typeNode)) {
      const first = typeNode.find(item => typeof item === 'string' && item.trim().length > 0);
      if (typeof first === 'string') {
        return first.trim().toLowerCase();
      }
    }

    if (Array.isArray(schemaNode['enum'])) {
      return 'enum';
    }

    if (this.isRecord(schemaNode['properties'])) {
      return 'object';
    }

    return 'any';
  }

  private readRequiredFields(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter(field => typeof field === 'string' && field.trim().length > 0)
      .map(field => (field as string).trim());
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return this.isRecord(value) ? value : {};
  }
}

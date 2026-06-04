import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { combineLatest, map, Observable, switchMap, take } from 'rxjs';
import {
  ExecutableAsset,
  InputFeatureSpec,
  MlGuiAsset,
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
      'https://pionera.ai/edc/daimo#inference_path',
      'daimo:inference_path',
      'inference_path',
      'inferencePath',
    ]);
    return typeof value === 'string' && value.trim().length > 0;
  }

  private toExecutableAsset(asset: MlGuiAsset): ExecutableAsset {
    const inputSchema = this.extractInputSchema(asset);
    const inputFeatures = this.extractInputFeatures(asset, inputSchema);

    return {
      id: asset.id,
      name: asset.name,
      executionPath: this.extractInferencePath(asset),
      contentType: asset.contentType,
      tags: asset.keywords,
      tasks: [...(asset.tasks || []), ...(asset.subtasks || [])],
      isLocal: !!asset.isLocal,
      inputSchema,
      inputFeatures,
      inputSchemaDraft: this.extractSchemaDraft(asset),
      inputExample: this.extractInputExample(asset),
    };
  }

  private extractInferencePath(asset: MlGuiAsset): string {
    const candidates = [
      'https://pionera.ai/edc/daimo#inference_path',
      'daimo:inference_path',
      'inference_path',
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
      'daimo:input_schema',
      'https://pionera.ai/edc/daimo#input_schema',
      'input_schema',
      'inputSchema',
    ]);

    const parsed = this.parseJsonLikeValue(value);
    return this.isRecord(parsed) ? parsed : null;
  }

  private extractInputFeatures(
    asset: MlGuiAsset,
    inputSchema: Record<string, unknown> | null,
  ): InputFeatureSpec[] {
    const direct = this.readAssetValue(asset, [
      'daimo:input_features',
      'https://pionera.ai/edc/daimo#input_features',
      'input_features',
      'inputFeatures',
    ]);

    const parsedDirect = this.parseInputFeatures(direct);
    if (parsedDirect.length > 0) {
      return parsedDirect;
    }

    if (!inputSchema) {
      return [];
    }

    return this.buildInputFeaturesFromSchema(inputSchema);
  }

  private extractSchemaDraft(asset: MlGuiAsset): string {
    const value = this.readAssetValue(asset, [
      'daimo:input_schema_draft',
      'https://pionera.ai/edc/daimo#input_schema_draft',
      'input_schema_draft',
      'inputSchemaDraft',
    ]);
    return typeof value === 'string' ? value.trim() : '';
  }

  private extractInputExample(asset: MlGuiAsset): unknown {
    const value = this.readAssetValue(asset, [
      'daimo:input_example',
      'https://pionera.ai/edc/daimo#input_example',
      'input_example',
      'inputExample',
    ]);
    return this.parseJsonLikeValue(value);
  }

  private readAssetValue(asset: MlGuiAsset, keys: string[]): unknown {
    const directRecord = asset.rawProperties || {};
    const nestedRecord = (asset.rawProperties?.['properties'] as Record<string, unknown>) || {};

    for (const key of keys) {
      if (key in directRecord) {
        return directRecord[key];
      }
      if (key in nestedRecord) {
        return nestedRecord[key];
      }
    }

    return undefined;
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

  private parseInputFeatures(value: unknown): InputFeatureSpec[] {
    const parsed = this.parseJsonLikeValue(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const features: InputFeatureSpec[] = [];
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim().length > 0) {
        features.push({ name: item.trim(), type: 'any', required: false });
        continue;
      }

      if (!this.isRecord(item)) {
        continue;
      }

      const nameRaw = item['name'] ?? item['field'] ?? item['path'];
      const typeRaw = item['type'] ?? item['dataType'] ?? item['dtype'];
      const requiredRaw = item['required'];
      const descriptionRaw = item['description'];

      if (typeof nameRaw !== 'string' || nameRaw.trim().length === 0) {
        continue;
      }

      features.push({
        name: nameRaw.trim(),
        type: typeof typeRaw === 'string' && typeRaw.trim().length > 0 ? typeRaw.trim().toLowerCase() : 'any',
        required: requiredRaw === true,
        description:
          typeof descriptionRaw === 'string' && descriptionRaw.trim().length > 0 ? descriptionRaw.trim() : undefined,
      });
    }

    return features;
  }

  private buildInputFeaturesFromSchema(schema: Record<string, unknown>): InputFeatureSpec[] {
    const features: InputFeatureSpec[] = [];
    this.collectSchemaFeatures(schema, '', new Set<string>(), features);
    return features;
  }

  private collectSchemaFeatures(
    schemaNode: Record<string, unknown>,
    prefix: string,
    requiredByParent: Set<string>,
    target: InputFeatureSpec[],
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
        this.collectSchemaFeatures(schemaRecord, path, new Set<string>(), target);
      }

      if (inferredType === 'array' && this.isRecord(schemaRecord['items'])) {
        const itemSchema = schemaRecord['items'] as Record<string, unknown>;
        if (this.isRecord(itemSchema['properties'])) {
          this.collectSchemaFeatures(itemSchema, `${path}[]`, new Set<string>(), target);
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
}

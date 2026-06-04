export interface MlGuiAsset {
  id: string;
  name: string;
  version: string;
  description: string;
  shortDescription: string;
  assetType: string;
  contentType: string;
  byteSize: string;
  format: string;
  keywords: string[];
  licenses: string[];
  languages: string[];
  tasks: string[];
  subtasks: string[];
  algorithms: string[];
  libraries: string[];
  frameworks: string[];
  modelType: string;
  storageType?: string;
  fileName?: string;
  owner?: string;
  isLocal?: boolean;
  hasContractOffers?: boolean;
  contractOffers?: unknown[];
  hasAgreement?: boolean;
  negotiationInProgress?: boolean;
  endpointUrl?: string;
  participantId?: string;
  counterPartyAddress?: string;
  assetData: Record<string, unknown>;
  rawProperties: Record<string, unknown>;
  originator: string;
}

export interface InputFeatureSpec {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface MlGuiAssetFilter {
  licenses?: string[];
  languages?: string[];
  tasks?: string[];
  libraries?: string[];
  frameworks?: string[];
  assetSources?: string[];
  formats?: string[];
}

export interface ExecutableAsset {
  id: string;
  name: string;
  executionPath: string;
  contentType?: string;
  tags?: string[];
  tasks?: string[];
  isLocal: boolean;
  inputSchema?: Record<string, unknown> | null;
  inputFeatures?: InputFeatureSpec[];
  inputSchemaDraft?: string;
  inputExample?: unknown;
}

export interface ModelExecutionRequest {
  assetId: string;
  payload: unknown;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  modelName?: string;
  usageSessionId?: string;
  correlationId?: string;
  benchmarkRunId?: string;
}

export interface ModelExecutionResult {
  status: 'success' | 'error';
  assetId: string;
  output?: unknown;
  error?: string;
  timestamp: string;
}

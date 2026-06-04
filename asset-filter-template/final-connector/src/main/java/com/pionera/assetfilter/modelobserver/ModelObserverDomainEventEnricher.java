/*
 *  Copyright (c) 2026 Pionera
 *
 *  This program and the accompanying materials are made available under the
 *  terms of the Apache License, Version 2.0 which is available at
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 *  SPDX-License-Identifier: Apache-2.0
 *
 *  Contributors:
 *       Pionera - initial API and implementation
 *
 */

package com.pionera.assetfilter.modelobserver;

import org.eclipse.edc.connector.controlplane.asset.spi.domain.Asset;
import org.eclipse.edc.connector.controlplane.asset.spi.index.AssetIndex;
import org.eclipse.edc.connector.controlplane.contract.spi.offer.store.ContractDefinitionStore;
import org.eclipse.edc.connector.controlplane.contract.spi.types.offer.ContractDefinition;
import org.eclipse.edc.connector.controlplane.policy.spi.PolicyDefinition;
import org.eclipse.edc.connector.controlplane.policy.spi.store.PolicyDefinitionStore;
import org.eclipse.edc.policy.model.Policy;
import org.eclipse.edc.spi.monitor.Monitor;
import org.eclipse.edc.spi.query.Criterion;
import org.eclipse.edc.transaction.spi.TransactionContext;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Supplier;

public class ModelObserverDomainEventEnricher {
    private final Monitor monitor;
    private final TransactionContext transactionContext;
    private final AssetIndex assetIndex;
    private final PolicyDefinitionStore policyDefinitionStore;
    private final ContractDefinitionStore contractDefinitionStore;

    public ModelObserverDomainEventEnricher(Monitor monitor,
                                            TransactionContext transactionContext,
                                            AssetIndex assetIndex,
                                            PolicyDefinitionStore policyDefinitionStore,
                                            ContractDefinitionStore contractDefinitionStore) {
        this.monitor = monitor;
        this.transactionContext = transactionContext;
        this.assetIndex = assetIndex;
        this.policyDefinitionStore = policyDefinitionStore;
        this.contractDefinitionStore = contractDefinitionStore;
    }

    public Map<String, Object> assetDetails(String assetId) {
        if (assetIndex == null || assetId == null || assetId.isBlank()) {
            return Map.of();
        }

        var asset = inTransaction(() -> assetIndex.findById(assetId), "asset", assetId);
        if (asset == null) {
            return Map.of();
        }
        return assetSummary(asset);
    }

    public Map<String, Object> policyDefinitionDetails(String policyDefinitionId) {
        if (policyDefinitionStore == null || policyDefinitionId == null || policyDefinitionId.isBlank()) {
            return Map.of();
        }

        var policyDefinition = inTransaction(() -> policyDefinitionStore.findById(policyDefinitionId),
                "policy definition", policyDefinitionId);
        if (policyDefinition == null) {
            return Map.of();
        }
        return policyDefinitionSummary(policyDefinition);
    }

    public Map<String, Object> contractDefinitionDetails(String contractDefinitionId) {
        if (contractDefinitionStore == null || contractDefinitionId == null || contractDefinitionId.isBlank()) {
            return Map.of();
        }

        var contractDefinition = inTransaction(() -> contractDefinitionStore.findById(contractDefinitionId),
                "contract definition", contractDefinitionId);
        if (contractDefinition == null) {
            return Map.of();
        }
        return contractDefinitionSummary(contractDefinition);
    }

    private Map<String, Object> assetSummary(Asset asset) {
        var properties = asset.getProperties() == null ? Map.<String, Object>of() : asset.getProperties();
        var dataAddress = asset.getDataAddress();
        var tags = listValue(firstNonBlank(
                properties.get("daimo:tags"),
                properties.get("https://pionera.ai/edc/daimo#tags")
        ));
        var assetKind = firstNonBlank(
                properties.get("daimo:asset_kind"),
                properties.get("https://pionera.ai/edc/daimo#asset_kind"),
                inferAssetKind(properties, tags)
        );

        return compactMap(
                "assetId", asset.getId(),
                "assetName", firstNonBlank(asset.getName(), properties.get("name"), properties.get("dct:title")),
                "assetKind", assetKind,
                "assetType", firstNonBlank(properties.get("type"), properties.get("asset:prop:type"), "machineLearning"),
                "contentType", firstNonBlank(asset.getContentType(), properties.get("contenttype"), properties.get("daimo:contenttype")),
                "task", firstNonBlank(properties.get("daimo:pipeline_tag"),
                        properties.get("https://pionera.ai/edc/daimo#pipeline_tag")),
                "library", firstNonBlank(properties.get("daimo:library_name"),
                        properties.get("https://pionera.ai/edc/daimo#library_name")),
                "tags", tags,
                "license", listValue(firstNonBlank(
                        properties.get("daimo:license"),
                        properties.get("https://pionera.ai/edc/daimo#license")
                )),
                "hasInputSchema", hasAny(properties,
                        "daimo:input_schema",
                        "https://pionera.ai/edc/daimo#input_schema",
                        "input_schema",
                        "inputSchema"),
                "hasInputFeatures", hasAny(properties,
                        "daimo:input_features",
                        "https://pionera.ai/edc/daimo#input_features",
                        "input_features",
                        "inputFeatures"),
                "dataAddressType", dataAddress == null ? null : dataAddress.getType()
        );
    }

    private Map<String, Object> policyDefinitionSummary(PolicyDefinition policyDefinition) {
        return compactMap(
                "policyDefinitionId", policyDefinition.getId(),
                "policyShape", policyShape(policyDefinition.getPolicy())
        );
    }

    private Map<String, Object> contractDefinitionSummary(ContractDefinition contractDefinition) {
        var selector = contractDefinition.getAssetsSelector() == null
                ? List.<Criterion>of()
                : contractDefinition.getAssetsSelector();
        return compactMap(
                "contractDefinitionId", contractDefinition.getId(),
                "accessPolicyId", contractDefinition.getAccessPolicyId(),
                "contractPolicyId", contractDefinition.getContractPolicyId(),
                "selectedAssetIds", selectedAssetIds(selector),
                "assetSelectorCount", selector.size()
        );
    }

    private Map<String, Integer> policyShape(Policy policy) {
        var shape = new LinkedHashMap<String, Integer>();
        shape.put("permissions", policy == null || policy.getPermissions() == null ? 0 : policy.getPermissions().size());
        shape.put("prohibitions", policy == null || policy.getProhibitions() == null ? 0 : policy.getProhibitions().size());
        shape.put("obligations", policy == null || policy.getObligations() == null ? 0 : policy.getObligations().size());
        return shape;
    }

    private List<String> selectedAssetIds(List<Criterion> selector) {
        var assetIds = new ArrayList<String>();
        for (Criterion criterion : selector) {
            if (!"id".equalsIgnoreCase(stringValue(criterion.getOperandLeft()))) {
                continue;
            }
            if (!"=".equals(stringValue(criterion.getOperator()))) {
                continue;
            }
            var assetId = stringValue(criterion.getOperandRight());
            if (!assetId.isBlank()) {
                assetIds.add(assetId);
            }
        }
        return assetIds;
    }

    private String inferAssetKind(Map<String, Object> properties, List<String> tags) {
        var tokens = String.join(" ", List.of(
                String.join(" ", tags),
                stringValue(firstNonBlank(properties.get("daimo:pipeline_tag"),
                        properties.get("https://pionera.ai/edc/daimo#pipeline_tag"))),
                stringValue(firstNonBlank(properties.get("daimo:benchmark_dataset"),
                        properties.get("benchmark_dataset")))
        )).toLowerCase(Locale.ROOT);

        if (tokens.matches(".*\\b(dataset|benchmark_dataset|samples|ground[- ]truth)\\b.*")) {
            return "dataset";
        }
        return "model";
    }

    private boolean hasAny(Map<String, Object> properties, String... keys) {
        for (String key : keys) {
            var value = properties.get(key);
            if (value == null) {
                continue;
            }
            if (!(value instanceof String text) || !text.trim().isEmpty()) {
                return true;
            }
        }
        return false;
    }

    private List<String> listValue(Object value) {
        if (value instanceof List<?> list) {
            return list.stream()
                    .map(this::stringValue)
                    .filter(item -> !item.isBlank())
                    .toList();
        }

        var text = stringValue(value);
        return text.isBlank() ? List.of() : List.of(text);
    }

    private <T> T inTransaction(Supplier<T> supplier, String entityType, String entityId) {
        try {
            if (transactionContext == null) {
                return supplier.get();
            }
            return transactionContext.execute(supplier::get);
        } catch (Exception exception) {
            monitor.debug("Model observer could not enrich " + entityType + " " + entityId + ": " +
                    exception.getMessage());
            return null;
        }
    }

    private Map<String, Object> compactMap(Object... keyValues) {
        var map = new LinkedHashMap<String, Object>();
        for (int index = 0; index + 1 < keyValues.length; index += 2) {
            var value = keyValues[index + 1];
            if (value != null) {
                map.put(String.valueOf(keyValues[index]), value);
            }
        }
        return map;
    }

    private Object firstNonBlank(Object... values) {
        for (Object value : values) {
            var text = stringValue(value);
            if (!text.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private String stringValue(Object value) {
        if (value == null) {
            return "";
        }
        return String.valueOf(value).trim();
    }
}

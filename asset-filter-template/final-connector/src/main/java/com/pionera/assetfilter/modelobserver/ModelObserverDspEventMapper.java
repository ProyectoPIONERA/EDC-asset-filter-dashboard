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

import org.eclipse.edc.connector.controlplane.asset.spi.event.AssetCreated;
import org.eclipse.edc.connector.controlplane.asset.spi.event.AssetDeleted;
import org.eclipse.edc.connector.controlplane.asset.spi.event.AssetEvent;
import org.eclipse.edc.connector.controlplane.asset.spi.event.AssetUpdated;
import org.eclipse.edc.connector.controlplane.contract.spi.event.contractdefinition.ContractDefinitionCreated;
import org.eclipse.edc.connector.controlplane.contract.spi.event.contractdefinition.ContractDefinitionDeleted;
import org.eclipse.edc.connector.controlplane.contract.spi.event.contractdefinition.ContractDefinitionEvent;
import org.eclipse.edc.connector.controlplane.contract.spi.event.contractdefinition.ContractDefinitionUpdated;
import org.eclipse.edc.connector.controlplane.contract.spi.event.contractnegotiation.ContractNegotiationEvent;
import org.eclipse.edc.connector.controlplane.contract.spi.event.contractnegotiation.ContractNegotiationFinalized;
import org.eclipse.edc.connector.controlplane.policy.spi.event.PolicyDefinitionCreated;
import org.eclipse.edc.connector.controlplane.policy.spi.event.PolicyDefinitionDeleted;
import org.eclipse.edc.connector.controlplane.policy.spi.event.PolicyDefinitionEvent;
import org.eclipse.edc.connector.controlplane.policy.spi.event.PolicyDefinitionUpdated;
import org.eclipse.edc.connector.controlplane.transfer.spi.event.TransferProcessCompleted;
import org.eclipse.edc.connector.controlplane.transfer.spi.event.TransferProcessEvent;
import org.eclipse.edc.connector.controlplane.transfer.spi.event.TransferProcessStarted;
import org.eclipse.edc.connector.controlplane.transfer.spi.event.TransferProcessTerminated;
import org.eclipse.edc.spi.event.Event;
import org.eclipse.edc.spi.event.EventEnvelope;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

public class ModelObserverDspEventMapper {
    private final String participantId;
    private final String sourceComponent;
    private final ModelObserverDomainEventEnricher enricher;

    public ModelObserverDspEventMapper(String participantId,
                                       String sourceComponent,
                                       ModelObserverDomainEventEnricher enricher) {
        this.participantId = participantId;
        this.sourceComponent = sourceComponent;
        this.enricher = enricher;
    }

    public <E extends Event> Map<String, Object> map(EventEnvelope<E> envelope) {
        if (envelope.getPayload() instanceof AssetEvent payload) {
            return mapAssetEvent(envelope, payload);
        }

        if (envelope.getPayload() instanceof PolicyDefinitionEvent payload) {
            return mapPolicyDefinitionEvent(envelope, payload);
        }

        if (envelope.getPayload() instanceof ContractDefinitionEvent payload) {
            return mapContractDefinitionEvent(envelope, payload);
        }

        if (envelope.getPayload() instanceof ContractNegotiationEvent payload) {
            return mapContractNegotiation(envelope, payload);
        }

        if (envelope.getPayload() instanceof TransferProcessEvent payload) {
            return mapTransferProcess(envelope, payload);
        }

        return null;
    }

    private Map<String, Object> mapAssetEvent(EventEnvelope<?> envelope, AssetEvent payload) {
        var assetId = payload.getAssetId();
        var status = assetStatus(payload);
        var details = merge(compactMap(
                "sourceEventClass", payload.getClass().getName(),
                "state", payload.getClass().getSimpleName(),
                "assetId", assetId
        ), enricher.assetDetails(assetId));

        var event = baseEvent(assetEventType(payload), envelope);
        event.put("category", "asset-lifecycle");
        promoteAssetContext(event, details, assetId);
        event.put("status", status);
        event.put("details", details);
        event.put("rawEvent", compactMap(
                "assetId", assetId,
                "state", payload.getClass().getSimpleName()
        ));
        return event;
    }

    private Map<String, Object> mapPolicyDefinitionEvent(EventEnvelope<?> envelope, PolicyDefinitionEvent payload) {
        var policyDefinitionId = payload.getPolicyDefinitionId();
        var event = baseEvent(policyDefinitionEventType(payload), envelope);
        event.put("category", "governance");
        event.put("policyDefinitionId", policyDefinitionId);
        event.put("status", policyDefinitionStatus(payload));
        event.put("details", merge(compactMap(
                "sourceEventClass", payload.getClass().getName(),
                "state", payload.getClass().getSimpleName(),
                "policyDefinitionId", policyDefinitionId
        ), enricher.policyDefinitionDetails(policyDefinitionId)));
        event.put("rawEvent", compactMap(
                "policyDefinitionId", policyDefinitionId,
                "state", payload.getClass().getSimpleName()
        ));
        return event;
    }

    private Map<String, Object> mapContractDefinitionEvent(EventEnvelope<?> envelope, ContractDefinitionEvent payload) {
        var contractDefinitionId = payload.getContractDefinitionId();
        var event = baseEvent(contractDefinitionEventType(payload), envelope);
        event.put("category", "governance");
        event.put("contractDefinitionId", contractDefinitionId);
        event.put("status", contractDefinitionStatus(payload));
        event.put("details", merge(compactMap(
                "sourceEventClass", payload.getClass().getName(),
                "state", payload.getClass().getSimpleName(),
                "contractDefinitionId", contractDefinitionId
        ), enricher.contractDefinitionDetails(contractDefinitionId)));
        event.put("rawEvent", compactMap(
                "contractDefinitionId", contractDefinitionId,
                "state", payload.getClass().getSimpleName()
        ));
        return event;
    }

    private Map<String, Object> mapContractNegotiation(EventEnvelope<?> envelope, ContractNegotiationEvent payload) {
        var eventState = payload.getClass().getSimpleName();
        var agreement = payload instanceof ContractNegotiationFinalized finalized
                ? finalized.getContractAgreement()
                : null;
        var offers = payload.getContractOffers();
        var offer = offers == null || offers.isEmpty() ? null : payload.getLastContractOffer();
        var agreementId = agreement == null ? null : agreement.getId();
        var assetId = firstNonBlank(
                agreement == null ? null : agreement.getAssetId(),
                offer == null ? null : offer.getAssetId()
        );
        var details = merge(compactMap(
                "sourceEventClass", payload.getClass().getName(),
                "counterPartyId", payload.getCounterPartyId(),
                "counterPartyAddress", payload.getCounterPartyAddress(),
                "protocol", payload.getProtocol(),
                "state", eventState,
                "agreementId", agreementId,
                "offerId", offer == null ? null : offer.getId(),
                "offerAssetId", offer == null ? null : offer.getAssetId(),
                "contractSigningDate", agreement == null ? null : agreement.getContractSigningDate()
        ), enricher.assetDetails(assetId));

        var event = baseEvent(contractNegotiationEventType(payload), envelope);
        event.put("category", "contract-transfer");
        event.put("negotiationId", payload.getContractNegotiationId());
        event.put("participantId", participantId);
        putIfPresent(event, "providerParticipantId", agreement == null ? payload.getCounterPartyId() : agreement.getProviderId());
        putIfPresent(event, "consumerParticipantId", agreement == null ? participantId : agreement.getConsumerId());
        putIfPresent(event, "agreementId", agreementId);
        promoteAssetContext(event, details, assetId);
        event.put("status", contractNegotiationStatus(payload));
        event.put("details", details);
        event.put("rawEvent", compactMap(
                "contractNegotiationId", payload.getContractNegotiationId(),
                "counterPartyId", payload.getCounterPartyId(),
                "counterPartyAddress", payload.getCounterPartyAddress(),
                "protocol", payload.getProtocol(),
                "state", eventState,
                "agreementId", agreementId,
                "assetId", assetId
        ));
        return event;
    }

    private Map<String, Object> mapTransferProcess(EventEnvelope<?> envelope, TransferProcessEvent payload) {
        var details = merge(compactMap(
                "sourceEventClass", payload.getClass().getName(),
                "transferType", payload.getType(),
                "state", payload.getClass().getSimpleName(),
                "assetId", payload.getAssetId(),
                "reason", payload instanceof TransferProcessTerminated terminated ? terminated.getReason() : null
        ), enricher.assetDetails(payload.getAssetId()));

        var event = baseEvent(transferProcessEventType(payload), envelope);
        event.put("category", "contract-transfer");
        event.put("agreementId", payload.getContractId());
        event.put("transferProcessId", payload.getTransferProcessId());
        promoteAssetContext(event, details, payload.getAssetId());
        event.put("participantId", participantId);
        event.put("status", transferProcessStatus(payload));
        event.put("details", details);
        event.put("rawEvent", compactMap(
                "transferProcessId", payload.getTransferProcessId(),
                "contractId", payload.getContractId(),
                "assetId", payload.getAssetId(),
                "type", payload.getType(),
                "state", payload.getClass().getSimpleName()
        ));
        return event;
    }

    private String assetEventType(AssetEvent payload) {
        if (payload instanceof AssetCreated) {
            return "ASSET_REGISTERED";
        }
        if (payload instanceof AssetUpdated) {
            return "ASSET_UPDATED";
        }
        if (payload instanceof AssetDeleted) {
            return "ASSET_DELETED";
        }
        return "ASSET_" + stateSuffix(payload.getClass().getSimpleName(), "Asset");
    }

    private String assetStatus(AssetEvent payload) {
        if (payload instanceof AssetCreated) {
            return "REGISTERED";
        }
        return stateSuffix(payload.getClass().getSimpleName(), "Asset");
    }

    private String policyDefinitionEventType(PolicyDefinitionEvent payload) {
        if (payload instanceof PolicyDefinitionCreated) {
            return "POLICY_CREATED";
        }
        if (payload instanceof PolicyDefinitionUpdated) {
            return "POLICY_UPDATED";
        }
        if (payload instanceof PolicyDefinitionDeleted) {
            return "POLICY_DELETED";
        }
        return "POLICY_" + stateSuffix(payload.getClass().getSimpleName(), "PolicyDefinition");
    }

    private String policyDefinitionStatus(PolicyDefinitionEvent payload) {
        return stateSuffix(payload.getClass().getSimpleName(), "PolicyDefinition");
    }

    private String contractDefinitionEventType(ContractDefinitionEvent payload) {
        if (payload instanceof ContractDefinitionCreated) {
            return "CONTRACT_DEFINITION_CREATED";
        }
        if (payload instanceof ContractDefinitionUpdated) {
            return "CONTRACT_DEFINITION_UPDATED";
        }
        if (payload instanceof ContractDefinitionDeleted) {
            return "CONTRACT_DEFINITION_DELETED";
        }
        return "CONTRACT_DEFINITION_" + stateSuffix(payload.getClass().getSimpleName(), "ContractDefinition");
    }

    private String contractDefinitionStatus(ContractDefinitionEvent payload) {
        return stateSuffix(payload.getClass().getSimpleName(), "ContractDefinition");
    }

    private String contractNegotiationEventType(ContractNegotiationEvent payload) {
        return "CONTRACT_NEGOTIATION_" + stateSuffix(payload.getClass().getSimpleName(), "ContractNegotiation");
    }

    private String contractNegotiationStatus(ContractNegotiationEvent payload) {
        return stateSuffix(payload.getClass().getSimpleName(), "ContractNegotiation");
    }

    private String transferProcessEventType(TransferProcessEvent payload) {
        if (payload instanceof TransferProcessStarted) {
            return "TRANSFER_PROCESS_STARTED";
        }
        if (payload instanceof TransferProcessCompleted) {
            return "TRANSFER_PROCESS_COMPLETED";
        }
        if (payload instanceof TransferProcessTerminated) {
            return "TRANSFER_PROCESS_TERMINATED";
        }
        return "TRANSFER_PROCESS_" + stateSuffix(payload.getClass().getSimpleName(), "TransferProcess");
    }

    private String transferProcessStatus(TransferProcessEvent payload) {
        return stateSuffix(payload.getClass().getSimpleName(), "TransferProcess");
    }

    private String stateSuffix(String className, String prefix) {
        var state = className == null ? "" : className.replaceFirst("^" + prefix, "");
        return toUpperSnakeCase(state.isBlank() ? className : state);
    }

    private Map<String, Object> baseEvent(String eventType, EventEnvelope<?> envelope) {
        var event = new LinkedHashMap<String, Object>();
        event.put("eventId", firstNonBlank(envelope == null ? null : envelope.getId(), UUID.randomUUID().toString()));
        event.put("eventType", eventType);
        event.put("occurredAt", occurredAt(envelope));
        event.put("sourceComponent", sourceComponent);
        event.put("participantId", participantId);
        return event;
    }

    private String occurredAt(EventEnvelope<?> envelope) {
        var at = envelope == null ? 0L : envelope.getAt();
        if (at > 0L) {
            return Instant.ofEpochMilli(at).toString();
        }
        return Instant.now().toString();
    }

    private Map<String, Object> merge(Map<String, Object> first, Map<String, Object> second) {
        var result = new LinkedHashMap<String, Object>();
        result.putAll(first);
        result.putAll(second);
        return result;
    }

    private void promoteAssetContext(Map<String, Object> event, Map<String, Object> details, String assetId) {
        putIfPresent(event, "assetId", assetId);
        if (!"dataset".equalsIgnoreCase(stringValue(details.get("assetKind")))) {
            putIfPresent(event, "modelId", assetId);
            putIfPresent(event, "modelName", firstNonBlank(details.get("assetName"), assetId));
        }
        putIfPresent(event, "taskType", firstNonBlank(details.get("task"), details.get("taskType")));
    }

    private void putIfPresent(Map<String, Object> target, String key, Object value) {
        if (!stringValue(value).isBlank()) {
            target.put(key, value);
        }
    }

    private Map<String, Object> compactMap(Object... keyValues) {
        var map = new LinkedHashMap<String, Object>();
        for (int index = 0; index + 1 < keyValues.length; index += 2) {
            var value = keyValues[index + 1];
            if (value != null && !stringValue(value).isBlank()) {
                map.put(String.valueOf(keyValues[index]), value);
            }
        }
        return map;
    }

    private String firstNonBlank(Object... values) {
        for (Object value : values) {
            var text = stringValue(value);
            if (!text.isBlank()) {
                return text;
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

    private String toUpperSnakeCase(String value) {
        if (value == null || value.isBlank()) {
            return "UNKNOWN";
        }

        return value
                .replaceAll("([a-z0-9])([A-Z])", "$1_$2")
                .replace('-', '_')
                .replace(' ', '_')
                .toUpperCase(Locale.ROOT);
    }
}

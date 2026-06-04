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

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.eclipse.edc.spi.monitor.Monitor;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

public class ModelObserverJournal {
    private static final int DEFAULT_QUERY_LIMIT = 200;
    private static final List<String> PARTICIPANT_FIELDS = List.of(
            "participantId", "providerParticipantId", "consumerParticipantId", "counterPartyId"
    );

    private final ObjectMapper mapper;
    private final Monitor monitor;
    private final Path storagePath;
    private final int maxEvents;
    private final String participantId;
    private final String sourceComponent;
    private final List<Map<String, Object>> events = new ArrayList<>();

    public ModelObserverJournal(ObjectMapper mapper,
                                Monitor monitor,
                                String storageFilePath,
                                int maxEvents,
                                String participantId,
                                String sourceComponent) {
        this.mapper = mapper;
        this.monitor = monitor;
        this.storagePath = Path.of(storageFilePath);
        this.maxEvents = Math.max(100, maxEvents);
        this.participantId = participantId;
        this.sourceComponent = sourceComponent;
        load();
    }

    public synchronized Map<String, Object> record(Map<String, Object> rawEvent) {
        var event = new LinkedHashMap<String, Object>();
        if (rawEvent != null) {
            event.putAll(rawEvent);
        }

        event.put("eventId", defaultText(event.get("eventId"), UUID.randomUUID().toString()));
        var existing = findByEventId(String.valueOf(event.get("eventId")));
        if (existing != null) {
            return copy(existing);
        }

        event.put("eventType", normalizeEventType(defaultText(event.get("eventType"), "CUSTOM_EVENT")));
        event.put("occurredAt", defaultText(event.get("occurredAt"), Instant.now().toString()));
        event.put("sourceComponent", defaultText(event.get("sourceComponent"), sourceComponent));
        event.put("participantId", defaultText(event.get("participantId"), participantId));

        events.add(0, event);
        while (events.size() > maxEvents) {
            events.remove(events.size() - 1);
        }
        persist();
        return copy(event);
    }

    public synchronized List<Map<String, Object>> query(Map<String, String> filters, int requestedLimit) {
        var limit = requestedLimit > 0 ? Math.min(requestedLimit, maxEvents) : DEFAULT_QUERY_LIMIT;
        var result = new ArrayList<Map<String, Object>>();

        for (Map<String, Object> event : events) {
            if (!matches(event, filters)) {
                continue;
            }
            result.add(copy(event));
            if (result.size() >= limit) {
                break;
            }
        }

        return result;
    }

    public synchronized List<Map<String, Object>> timelineByAsset(String assetId, int requestedLimit) {
        var filters = new HashMap<String, String>();
        filters.put("assetId", assetId);
        var result = query(filters, requestedLimit);
        result.sort(Comparator.comparing(event -> stringValue(event.get("occurredAt"))));
        return result;
    }

    public synchronized List<Map<String, Object>> evidenceByAgreement(String agreementId, int requestedLimit) {
        var filters = new HashMap<String, String>();
        filters.put("agreementId", agreementId);
        var result = query(filters, requestedLimit);
        result.sort(Comparator.comparing(event -> stringValue(event.get("occurredAt"))));
        return result;
    }

    public synchronized List<Map<String, Object>> benchmarkHistory(String assetId, int requestedLimit) {
        var filters = new HashMap<String, String>();
        filters.put("eventFamily", "BENCHMARK");
        if (assetId != null && !assetId.isBlank()) {
            filters.put("assetId", assetId);
        }
        return query(filters, requestedLimit);
    }

    public synchronized Map<String, Object> summary() {
        var byEventType = new LinkedHashMap<String, Integer>();
        var byCategory = new LinkedHashMap<String, Integer>();
        var assetIds = new ArrayList<String>();
        var agreementIds = new ArrayList<String>();
        var usageSessionIds = new ArrayList<String>();

        for (Map<String, Object> event : events) {
            var eventType = stringValue(event.get("eventType"));
            byEventType.put(eventType, byEventType.getOrDefault(eventType, 0) + 1);
            var category = stringValue(event.get("category"));
            if (!category.isBlank()) {
                byCategory.put(category, byCategory.getOrDefault(category, 0) + 1);
            }
            addUnique(assetIds, stringValue(firstNonBlank(event, "assetId", "modelId")));
            addUnique(agreementIds, stringValue(event.get("agreementId")));
            addUnique(usageSessionIds, stringValue(event.get("usageSessionId")));
        }

        var summary = new LinkedHashMap<String, Object>();
        summary.put("totalEvents", events.size());
        summary.put("eventTypes", byEventType);
        summary.put("categories", byCategory);
        summary.put("assetCount", assetIds.size());
        summary.put("agreementCount", agreementIds.size());
        summary.put("usageSessionCount", usageSessionIds.size());
        summary.put("participantCount", participantSummaries().size());
        summary.put("recentEvents", query(Map.of(), 8));
        return summary;
    }

    public synchronized List<Map<String, Object>> participantSummaries() {
        var participants = new LinkedHashMap<String, ParticipantAccumulator>();

        for (Map<String, Object> event : events) {
            for (String field : PARTICIPANT_FIELDS) {
                var participant = stringValue(event.get(field));
                if (participant.isBlank()) {
                    continue;
                }
                participants.computeIfAbsent(participant, ParticipantAccumulator::new).accept(event);
            }
        }

        return participants.values().stream()
                .map(ParticipantAccumulator::toMap)
                .sorted(Comparator.<Map<String, Object>, String>comparing(item -> stringValue(item.get("lastSeen"))).reversed())
                .toList();
    }

    private boolean matches(Map<String, Object> event, Map<String, String> filters) {
        if (filters == null || filters.isEmpty()) {
            return true;
        }

        for (Map.Entry<String, String> entry : filters.entrySet()) {
            var value = entry.getValue();
            if (value == null || value.isBlank()) {
                continue;
            }

            var normalizedValue = value.trim();
            var key = entry.getKey();
            var matched = switch (key) {
                case "eventType" -> stringValue(event.get("eventType")).equalsIgnoreCase(normalizedValue);
                case "eventFamily" -> stringValue(event.get("eventType")).toUpperCase(Locale.ROOT)
                        .startsWith(normalizedValue.toUpperCase(Locale.ROOT));
                case "assetId" -> fieldOrNestedMatches(event, normalizedValue, "assetId", "modelId");
                case "agreementId" -> fieldOrNestedMatches(event, normalizedValue, "agreementId", "contractId", "contractAgreementId");
                case "participantId" -> fieldOrNestedMatches(event, normalizedValue,
                        "participantId", "providerParticipantId", "consumerParticipantId", "counterPartyId");
                case "negotiationId" -> fieldOrNestedMatches(event, normalizedValue, "negotiationId", "contractNegotiationId");
                case "transferProcessId" -> fieldOrNestedMatches(event, normalizedValue, "transferProcessId", "transferId");
                case "usageSessionId" -> fieldOrNestedMatches(event, normalizedValue, "usageSessionId");
                case "benchmarkRunId" -> fieldOrNestedMatches(event, normalizedValue, "benchmarkRunId");
                case "correlationId" -> fieldOrNestedMatches(event, normalizedValue, "correlationId", "requestId");
                case "modelName" -> fieldOrNestedMatches(event, normalizedValue, "modelName", "assetName", "name");
                case "status" -> fieldOrNestedMatches(event, normalizedValue, "status", "state");
                case "q" -> containsText(event, normalizedValue.toLowerCase(Locale.ROOT));
                default -> fieldOrNestedMatches(event, normalizedValue, key);
            };

            if (!matched) {
                return false;
            }
        }

        return true;
    }

    private boolean fieldOrNestedMatches(Map<String, Object> event, String expected, String... fields) {
        for (String field : fields) {
            var value = stringValue(event.get(field));
            if (!value.isBlank() && value.equalsIgnoreCase(expected)) {
                return true;
            }
        }
        return nestedFieldMatches(event.get("details"), expected, fields) ||
                nestedFieldMatches(event.get("rawEvent"), expected, fields) ||
                nestedFieldMatches(event.get("metrics"), expected, fields);
    }

    private boolean nestedFieldMatches(Object node, String expected, String... fields) {
        if (node instanceof Map<?, ?> map) {
            for (String field : fields) {
                var value = stringValue(map.get(field));
                if (!value.isBlank() && value.equalsIgnoreCase(expected)) {
                    return true;
                }
            }
            for (Object value : map.values()) {
                if (nestedFieldMatches(value, expected, fields)) {
                    return true;
                }
            }
        } else if (node instanceof List<?> list) {
            for (Object item : list) {
                if (nestedFieldMatches(item, expected, fields)) {
                    return true;
                }
            }
        } else {
            return stringValue(node).equalsIgnoreCase(expected);
        }
        return false;
    }

    private boolean containsText(Object node, String query) {
        if (node == null || query.isBlank()) {
            return false;
        }
        if (node instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (containsText(entry.getKey(), query) || containsText(entry.getValue(), query)) {
                    return true;
                }
            }
            return false;
        }
        if (node instanceof List<?> list) {
            for (Object item : list) {
                if (containsText(item, query)) {
                    return true;
                }
            }
            return false;
        }
        return String.valueOf(node).toLowerCase(Locale.ROOT).contains(query);
    }

    private Map<String, Object> findByEventId(String eventId) {
        if (eventId == null || eventId.isBlank()) {
            return null;
        }
        for (Map<String, Object> event : events) {
            if (eventId.equals(stringValue(event.get("eventId")))) {
                return event;
            }
        }
        return null;
    }

    private void load() {
        try {
            if (!Files.exists(storagePath)) {
                return;
            }
            var raw = Files.readString(storagePath, StandardCharsets.UTF_8);
            if (raw == null || raw.isBlank()) {
                return;
            }
            var loaded = mapper.readValue(raw, new TypeReference<List<Map<String, Object>>>() {});
            loaded.forEach(this::normalizeLegacyEvent);
            events.clear();
            events.addAll(loaded);
            monitor.info("Loaded model observer journal from " + storagePath + " (" + events.size() + " events)");
        } catch (Exception e) {
            monitor.warning("Failed to load model observer journal: " + e.getMessage());
        }
    }

    private void persist() {
        try {
            var parent = storagePath.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            var raw = mapper.writerWithDefaultPrettyPrinter().writeValueAsString(events);
            Files.writeString(storagePath, raw, StandardCharsets.UTF_8);
        } catch (IOException e) {
            monitor.warning("Failed to persist model observer journal: " + e.getMessage());
        }
    }

    private Map<String, Object> copy(Map<String, Object> event) {
        return new LinkedHashMap<>(event);
    }

    private void normalizeLegacyEvent(Map<String, Object> event) {
        if (!"ASSET_DISCOVERY_COMPLETED".equalsIgnoreCase(stringValue(event.get("eventType")))) {
            return;
        }

        event.put("eventType", "CATALOG_QUERY_COMPLETED");
        event.putIfAbsent("category", "catalog");
        if (event.get("details") instanceof Map<?, ?> details) {
            var normalizedDetails = stringKeyedMap(details);
            normalizeLegacyCatalogDetails(normalizedDetails);
            event.put("details", normalizedDetails);
            event.putIfAbsent("status", legacyCatalogStatus(normalizedDetails));
        } else {
            event.putIfAbsent("status", "COMPLETED");
        }
    }

    private Map<String, Object> stringKeyedMap(Map<?, ?> source) {
        var target = new LinkedHashMap<String, Object>();
        source.forEach((key, value) -> target.put(String.valueOf(key), value));
        return target;
    }

    private void normalizeLegacyCatalogDetails(Map<String, Object> details) {
        details.putIfAbsent("direction", "external-catalog");
        if (details.containsKey("assetIds") && !details.containsKey("returnedAssetIds")) {
            details.put("returnedAssetIds", details.get("assetIds"));
        }
    }

    private String legacyCatalogStatus(Map<String, Object> details) {
        var returnedAssetCount = stringValue(details.get("returnedAssetCount"));
        if ("0".equals(returnedAssetCount)) {
            return "EMPTY";
        }
        return "COMPLETED";
    }

    private String normalizeEventType(String value) {
        return value.trim()
                .replace('-', '_')
                .replace(' ', '_')
                .toUpperCase(Locale.ROOT);
    }

    private String defaultText(Object value, String fallback) {
        var text = stringValue(value);
        return text.isBlank() ? fallback : text;
    }

    private Object firstNonBlank(Map<String, Object> event, String... fields) {
        for (String field : fields) {
            var value = stringValue(event.get(field));
            if (!value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private void addUnique(List<String> values, String candidate) {
        if (candidate == null || candidate.isBlank() || values.contains(candidate)) {
            return;
        }
        values.add(candidate);
    }

    private String stringValue(Object value) {
        if (value == null) {
            return "";
        }
        return String.valueOf(value).trim();
    }

    private static class ParticipantAccumulator {
        private final String participantId;
        private final Map<String, Integer> eventTypes = new LinkedHashMap<>();
        private final List<String> assetIds = new ArrayList<>();
        private final List<String> agreementIds = new ArrayList<>();
        private int eventCount;
        private String firstSeen = "";
        private String lastSeen = "";

        ParticipantAccumulator(String participantId) {
            this.participantId = participantId;
        }

        void accept(Map<String, Object> event) {
            eventCount += 1;
            var eventType = stringValue(event.get("eventType"));
            eventTypes.put(eventType, eventTypes.getOrDefault(eventType, 0) + 1);
            addUnique(assetIds, stringValue(firstNonBlank(event, "assetId", "modelId")));
            addUnique(agreementIds, stringValue(event.get("agreementId")));

            var occurredAt = stringValue(event.get("occurredAt"));
            if (!occurredAt.isBlank() && (firstSeen.isBlank() || occurredAt.compareTo(firstSeen) < 0)) {
                firstSeen = occurredAt;
            }
            if (!occurredAt.isBlank() && (lastSeen.isBlank() || occurredAt.compareTo(lastSeen) > 0)) {
                lastSeen = occurredAt;
            }
        }

        Map<String, Object> toMap() {
            var summary = new LinkedHashMap<String, Object>();
            summary.put("participantId", participantId);
            summary.put("eventCount", eventCount);
            summary.put("assetCount", assetIds.size());
            summary.put("agreementCount", agreementIds.size());
            summary.put("firstSeen", firstSeen);
            summary.put("lastSeen", lastSeen);
            summary.put("eventTypes", eventTypes);
            return summary;
        }

        private static Object firstNonBlank(Map<String, Object> event, String... fields) {
            for (String field : fields) {
                var value = stringValue(event.get(field));
                if (!value.isBlank()) {
                    return value;
                }
            }
            return "";
        }

        private static void addUnique(List<String> values, String candidate) {
            if (candidate == null || candidate.isBlank() || values.contains(candidate)) {
                return;
            }
            values.add(candidate);
        }

        private static String stringValue(Object value) {
            if (value == null) {
                return "";
            }
            return String.valueOf(value).trim();
        }
    }
}

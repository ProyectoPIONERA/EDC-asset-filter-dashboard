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

package com.pionera.assetfilter.filter;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.pionera.assetfilter.modelobserver.ModelObserverRegistry;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import org.eclipse.edc.spi.monitor.Monitor;
import org.eclipse.edc.spi.types.TypeManager;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static jakarta.ws.rs.core.HttpHeaders.CONTENT_TYPE;

@Path("/filter")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class AssetFilterController {

    private static final String DAIMO_NAMESPACE = "https://w3id.org/pionera/daimo#";
    private static final String DCT_NAMESPACE = "http://purl.org/dc/terms/";
    private static final String DCAT_NAMESPACE = "http://www.w3.org/ns/dcat#";
    private static final Set<String> DAIMO_FILTER_KEYS = Set.of(
            "assettype", "daimo:assettype",
            "description", "daimo:description",
            "format", "daimo:format",
            "keyword", "keywords", "tag", "tags", "daimo:keyword", "daimo:keywords",
            "language", "daimo:language", "dct:language", "dcterms:language",
            "license", "daimo:license", "dct:license", "dcterms:license",
            "library", "libraryname", "daimo:libraryname",
            "metrics", "daimo:metrics",
            "modality", "daimo:modality",
            "name", "daimo:name",
            "requestshape", "daimo:requestshape",
            "task", "taskcategory", "daimo:taskcategory",
            "tasktype", "daimo:tasktype",
            "subtask", "daimo:subtask",
            "subtaskdescription", "daimo:subtaskdescription",
            "endpointbehavior", "daimo:endpointbehavior",
            "inputschema", "daimo:inputschema",
            "inputexample", "daimo:inputexample",
            "input", "daimo:input",
            "label", "daimo:label",
            "labeltype", "daimo:labeltype",
            "datasetversion", "daimo:datasetversion",
            "datasetrole", "daimo:datasetrole",
            "protocol", "daimo:protocol",
            "randomseed", "daimo:randomseed"
    );

    private final ObjectMapper mapper;
    private final Monitor monitor;
    private final String managementBaseUrl;
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public AssetFilterController(TypeManager typeManager, Monitor monitor, String managementBaseUrl) {
        this.mapper = typeManager.getMapper();
        this.monitor = monitor;
        this.managementBaseUrl = managementBaseUrl;
    }

    @POST
    @Path("/catalog")
    public Response filterCatalog(String requestBody, @Context UriInfo uriInfo) {
        if (requestBody == null || requestBody.isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("{\"error\":\"Invalid catalog request\"}")
                    .build();
        }

        try {
            var requestNode = mapper.readTree(requestBody);
            if (!hasRequiredCatalogFields(requestNode)) {
                monitor.warning("Catalog request validation failed: mandatory value 'counterPartyAddress' or 'protocol' missing");
                return Response.status(Response.Status.BAD_REQUEST)
                        .entity("{\"error\":\"Invalid catalog request\"}")
                        .build();
            }

            var responseNode = fetchCatalog(requestBody);
            if (responseNode == null || responseNode.isNull()) {
                return Response.status(Response.Status.BAD_GATEWAY)
                        .entity("{\"error\":\"Failed to fetch catalog\"}")
                        .build();
            }

            var datasets = extractDatasets(responseNode);
            var filtered = applyFilters(datasets, uriInfo.getQueryParameters());
            var sorted = applySorting(filtered, uriInfo.getQueryParameters());
            var result = rebuildCatalog(responseNode, sorted);

            recordDiscoveryEvent(requestNode, uriInfo, datasets, sorted);
            return Response.ok(mapper.writeValueAsString(result)).build();
        } catch (Exception e) {
            monitor.warning("Catalog filter failed: " + e.getMessage());
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity("{\"error\":\"Catalog filter failed\"}")
                    .build();
        }
    }

    private JsonNode fetchCatalog(String requestBody) throws Exception {
        var request = HttpRequest.newBuilder()
                .uri(URI.create(managementBaseUrl + "/v3/catalog/request"))
                .header(CONTENT_TYPE, MediaType.APPLICATION_JSON)
                .POST(HttpRequest.BodyPublishers.ofString(requestBody, StandardCharsets.UTF_8))
                .build();

        var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() / 100 != 2) {
            monitor.warning("Catalog request failed: " + response.body());
            return null;
        }
        return mapper.readTree(response.body());
    }

    private void recordDiscoveryEvent(JsonNode requestNode,
                                      UriInfo uriInfo,
                                      List<JsonNode> discoveredDatasets,
                                      List<JsonNode> returnedDatasets) {
        if (!ModelObserverRegistry.isReady()) {
            return;
        }

        var event = new LinkedHashMap<String, Object>();
        event.put("eventType", "CATALOG_QUERY_COMPLETED");
        event.put("category", "catalog");
        event.put("status", returnedDatasets.isEmpty() ? "EMPTY" : "COMPLETED");
        event.put("counterPartyAddress", firstNonBlank(
                textValue(requestNode, "counterPartyAddress", "edc:counterPartyAddress",
                        "https://w3id.org/edc/v0.0.1/ns/counterPartyAddress"), null));
        event.put("protocol", firstNonBlank(
                textValue(requestNode, "protocol", "edc:protocol",
                        "https://w3id.org/edc/v0.0.1/ns/protocol"), null));
        event.put("details", Map.of(
                "direction", "external-catalog",
                "discoveredAssetCount", discoveredDatasets.size(),
                "returnedAssetCount", returnedDatasets.size(),
                "queryParameters", sanitizeQueryParameters(uriInfo),
                "returnedAssetIds", returnedDatasets.stream()
                        .map(this::extractDatasetId)
                        .filter(value -> value != null && !value.isBlank())
                        .limit(100)
                        .toList()
        ));
        ModelObserverRegistry.record(event);
    }

    private Map<String, List<String>> sanitizeQueryParameters(UriInfo uriInfo) {
        var result = new LinkedHashMap<String, List<String>>();
        if (uriInfo == null || uriInfo.getQueryParameters() == null) {
            return result;
        }
        uriInfo.getQueryParameters().forEach((key, values) -> result.put(key, List.copyOf(values)));
        return result;
    }

    private String extractDatasetId(JsonNode dataset) {
        return firstNonBlank(textValue(dataset, "@id", "id"), null);
    }

    private boolean hasRequiredCatalogFields(JsonNode requestNode) {
        if (requestNode == null || requestNode.isNull()) {
            return false;
        }
        return (hasField(requestNode, "counterPartyAddress") && hasField(requestNode, "protocol")) ||
                (hasField(requestNode, "https://w3id.org/edc/v0.0.1/ns/counterPartyAddress") &&
                        hasField(requestNode, "https://w3id.org/edc/v0.0.1/ns/protocol")) ||
                (hasField(requestNode, "edc:counterPartyAddress") && hasField(requestNode, "edc:protocol"));
    }

    private boolean hasField(JsonNode node, String key) {
        return node.has(key) && !node.get(key).isNull() && !node.get(key).asText().isBlank();
    }

    private List<JsonNode> extractDatasets(JsonNode catalog) {
        var datasetsNode = firstNode(catalog, "dcat:dataset", "dataset", "datasets");
        var result = new ArrayList<JsonNode>();
        if (datasetsNode == null || datasetsNode.isNull()) {
            return result;
        }
        if (datasetsNode.isArray()) {
            datasetsNode.forEach(result::add);
        } else {
            result.add(datasetsNode);
        }
        return result;
    }

    private JsonNode rebuildCatalog(JsonNode original, List<JsonNode> datasets) {
        var root = original.deepCopy();
        if (root instanceof ObjectNode obj) {
            var array = mapper.createArrayNode();
            datasets.forEach(array::add);
            obj.set("dcat:dataset", array);
            obj.set("dataset", array);
            return obj;
        }
        return original;
    }

    private List<JsonNode> applyFilters(List<JsonNode> datasets, Map<String, List<String>> queryParams) {
        if (queryParams == null || queryParams.isEmpty()) {
            return datasets;
        }

        var filters = new ArrayList<FilterCondition>();
        var profile = firstQueryValue(queryParams, "profile");

        for (Map.Entry<String, List<String>> entry : queryParams.entrySet()) {
            var key = entry.getKey();
            if (key == null) {
                continue;
            }
            if (key.equalsIgnoreCase("profile") || key.equalsIgnoreCase("sort") || key.equalsIgnoreCase("order")) {
                continue;
            }

            if (key.equalsIgnoreCase("filter")) {
                for (var raw : entry.getValue()) {
                    var parsed = parseFilterExpression(raw);
                    if (parsed != null) {
                        filters.add(normalizeFilterCondition(parsed));
                    }
                }
                continue;
            }

            if (key.equalsIgnoreCase("q")) {
                filters.add(new FilterCondition("q", "~", List.of(entry.getValue().get(0))));
                continue;
            }

            if ("daimo".equalsIgnoreCase(profile) && DAIMO_FILTER_KEYS.contains(key.toLowerCase(Locale.ROOT))) {
                var daimoKey = mapDaimoKey(key);
                filters.add(new FilterCondition(daimoKey, "=", splitValues(entry.getValue())));
                continue;
            }
        }

        if (filters.isEmpty()) {
            return datasets;
        }

        var result = new ArrayList<JsonNode>();
        for (JsonNode dataset : datasets) {
            if (matchesAll(dataset, filters)) {
                result.add(dataset);
            }
        }
        return result;
    }

    private FilterCondition normalizeFilterCondition(FilterCondition filter) {
        if (filter == null || filter.key == null) {
            return filter;
        }
        var normalizedKey = filter.key.startsWith("properties.")
                ? filter.key.substring("properties.".length())
                : filter.key;
        if (DAIMO_FILTER_KEYS.contains(normalizedKey.toLowerCase(Locale.ROOT))) {
            return new FilterCondition(mapDaimoKey(normalizedKey), filter.operator, filter.values);
        }
        return filter;
    }

    private boolean matchesAll(JsonNode dataset, List<FilterCondition> filters) {
        for (FilterCondition filter : filters) {
            if (!matches(dataset, filter)) {
                return false;
            }
        }
        return true;
    }

    private boolean matches(JsonNode dataset, FilterCondition filter) {
        if (filter.key.equals("q")) {
            return matchesSearch(dataset, filter.values.get(0));
        }

        var values = extractValues(dataset, filter.key);
        if (values.isEmpty()) {
            return false;
        }

        return switch (filter.operator) {
            case "~" -> matchesContains(values, filter.values);
            case "=", "==" -> matchesEquals(values, filter.values);
            case ">", ">=", "<", "<=" -> matchesRange(values, filter.operator, filter.values);
            default -> false;
        };
    }

    private boolean matchesSearch(JsonNode dataset, String query) {
        if (query == null || query.isBlank()) {
            return true;
        }
        var q = query.toLowerCase(Locale.ROOT);
        return containsValue(extractValues(dataset, "name"), q) ||
                containsValue(extractValues(dataset, "id"), q) ||
                containsValue(extractValues(dataset, "assetType"), q) ||
                containsValue(extractValues(dataset, "description"), q) ||
                containsValue(extractValues(dataset, "dct:description"), q) ||
                containsValue(extractValues(dataset, "dcat:keyword"), q) ||
                containsValue(extractValues(dataset, "daimo:taskCategory"), q) ||
                containsValue(extractValues(dataset, "daimo:taskType"), q) ||
                containsValue(extractValues(dataset, "daimo:modality"), q) ||
                containsValue(extractValues(dataset, "daimo:subtask"), q) ||
                containsValue(extractValues(dataset, "daimo:subtaskDescription"), q) ||
                containsValue(extractValues(dataset, "daimo:endpointBehavior"), q) ||
                containsValue(extractValues(dataset, "daimo:requestShape"), q) ||
                containsValue(extractValues(dataset, "daimo:libraryName"), q) ||
                containsValue(extractValues(dataset, "dct:language"), q) ||
                containsValue(extractValues(dataset, "dct:license"), q) ||
                containsValue(extractValues(dataset, "dct:format"), q) ||
                containsValue(extractValues(dataset, "daimo:input"), q) ||
                containsValue(extractValues(dataset, "daimo:label"), q) ||
                containsValue(extractValues(dataset, "daimo:labelType"), q) ||
                containsValue(extractValues(dataset, "daimo:metrics"), q);
    }

    private boolean matchesContains(List<JsonNode> values, List<String> targets) {
        for (String target : targets) {
            if (target == null) {
                continue;
            }
            var q = target.toLowerCase(Locale.ROOT);
            if (containsValue(values, q)) {
                return true;
            }
        }
        return false;
    }

    private boolean containsValue(List<JsonNode> values, String query) {
        for (JsonNode value : values) {
            if (value == null || value.isNull()) {
                continue;
            }
            if (value.isTextual()) {
                if (value.asText().toLowerCase(Locale.ROOT).contains(query)) {
                    return true;
                }
            } else if (value.isNumber()) {
                if (String.valueOf(value.asDouble()).contains(query)) {
                    return true;
                }
            }
        }
        return false;
    }

    private boolean matchesEquals(List<JsonNode> values, List<String> targets) {
        for (String target : targets) {
            if (target == null) {
                continue;
            }
            for (JsonNode value : values) {
                if (value == null || value.isNull()) {
                    continue;
                }
                if (value.isNumber() && isNumeric(target)) {
                    if (Double.compare(value.asDouble(), Double.parseDouble(target)) == 0) {
                        return true;
                    }
                } else {
                    if (value.asText().equalsIgnoreCase(target)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private boolean matchesRange(List<JsonNode> values, String operator, List<String> targets) {
        if (targets.isEmpty()) {
            return false;
        }
        var threshold = targets.get(0);
        if (!isNumeric(threshold)) {
            return false;
        }
        var limit = Double.parseDouble(threshold);
        for (JsonNode value : values) {
            if (value == null || value.isNull() || !value.isNumber()) {
                continue;
            }
            var numeric = value.asDouble();
            boolean ok = switch (operator) {
                case ">" -> numeric > limit;
                case ">=" -> numeric >= limit;
                case "<" -> numeric < limit;
                case "<=" -> numeric <= limit;
                default -> false;
            };
            if (ok) {
                return true;
            }
        }
        return false;
    }

    private List<JsonNode> applySorting(List<JsonNode> datasets, Map<String, List<String>> queryParams) {
        var sortKey = firstQueryValue(queryParams, "sort");
        if (sortKey == null || sortKey.isBlank()) {
            return datasets;
        }
        var order = Optional.ofNullable(firstQueryValue(queryParams, "order"))
                .map(s -> s.toLowerCase(Locale.ROOT))
                .orElse("asc");

        var sorted = new ArrayList<>(datasets);
        Comparator<JsonNode> comparator = Comparator.comparing(
                dataset -> extractSortValue(dataset, sortKey),
                Comparator.nullsLast(String::compareToIgnoreCase)
        );

        if ("desc".equals(order)) {
            comparator = comparator.reversed();
        }

        sorted.sort(comparator);
        return sorted;
    }

    private String extractSortValue(JsonNode dataset, String sortKey) {
        var values = extractValues(dataset, sortKey);
        if (values.isEmpty()) {
            return null;
        }
        var first = values.get(0);
        if (first.isNumber()) {
            return String.format(Locale.ROOT, "%020.10f", first.asDouble());
        }
        return first.asText();
    }

    private List<JsonNode> extractValues(JsonNode dataset, String rawKey) {
        if (dataset == null || rawKey == null) {
            return List.of();
        }
        var key = rawKey.trim();
        if (key.isEmpty()) {
            return List.of();
        }

        var baseNodes = new ArrayList<JsonNode>();
        baseNodes.add(dataset);
        var props = firstNode(dataset, "properties");
        if (props != null && props.isObject()) {
            baseNodes.add(props);
            addDaimoAssetDataNodes(baseNodes, props);
        }

        var result = new ArrayList<JsonNode>();

        var path = normalizeKeyPath(key);
        for (JsonNode base : baseNodes) {
            var node = resolveByPath(base, path);
            if (node != null && !node.isNull()) {
                collectValues(result, node);
            }
        }

        return result;
    }

    private void addDaimoAssetDataNodes(List<JsonNode> baseNodes, JsonNode properties) {
        var assetData = firstNode(properties, "assetData", "edc:assetData", "https://w3id.org/edc/v0.0.1/ns/assetData");
        if (assetData == null || !assetData.isObject()) {
            return;
        }

        var modelNode = firstNode(assetData, "JS_DAIMO_Model");
        if (modelNode != null && modelNode.isObject()) {
            baseNodes.add(modelNode);
        }

        var datasetNode = firstNode(assetData, "JS_DAIMO_Dataset");
        if (datasetNode != null && datasetNode.isObject()) {
            baseNodes.add(datasetNode);
        }
    }

    private List<String> normalizeKeyPath(String key) {
        var trimmed = key;
        if (trimmed.startsWith("properties.")) {
            trimmed = trimmed.substring("properties.".length());
        }

        if (trimmed.contains("://") && trimmed.contains("#") && trimmed.contains(".")) {
            var hashIndex = trimmed.indexOf('#');
            var dotIndex = trimmed.indexOf('.', hashIndex);
            if (dotIndex > hashIndex) {
                var first = trimmed.substring(0, dotIndex);
                var second = trimmed.substring(dotIndex + 1);
                return List.of(first, second);
            }
        }

        if (trimmed.contains(".")) {
            var parts = trimmed.split("\\.");
            var list = new ArrayList<String>();
            for (String part : parts) {
                if (!part.isBlank()) {
                    list.add(part);
                }
            }
            return list;
        }

        return List.of(trimmed);
    }

    private JsonNode resolveByPath(JsonNode base, List<String> path) {
        JsonNode current = base;
        for (int i = 0; i < path.size(); i++) {
            if (current == null || current.isNull()) {
                return null;
            }
            var segment = path.get(i);
            var node = resolveSegment(current, segment, i == 0);
            if (node == null) {
                return null;
            }
            current = node;
        }
        return current;
    }

    private JsonNode resolveSegment(JsonNode node, String segment, boolean isFirst) {
        var candidates = new ArrayList<String>();
        candidates.add(segment);

        if (segment.startsWith("daimo:")) {
            candidates.add(DAIMO_NAMESPACE + segment.substring(6));
        } else if (segment.startsWith("dct:") || segment.startsWith("dcterms:")) {
            candidates.add(DCT_NAMESPACE + segment.substring(segment.indexOf(':') + 1));
        } else if (segment.startsWith("dcat:")) {
            candidates.add(DCAT_NAMESPACE + segment.substring(5));
        } else if (isFirst && "metrics".equals(segment)) {
            candidates.add(DAIMO_NAMESPACE + "metrics");
        }

        for (String candidate : candidates) {
            if (node.has(candidate)) {
                return node.get(candidate);
            }
        }

        return null;
    }

    private void collectValues(List<JsonNode> result, JsonNode node) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isArray()) {
            node.forEach(item -> collectValues(result, item));
            return;
        }
        result.add(node);
    }

    private FilterCondition parseFilterExpression(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        var input = raw.trim();
        var operators = List.of(">=", "<=", ">", "<", "=", "~");
        for (String op : operators) {
            var index = input.indexOf(op);
            if (index > 0) {
                var key = input.substring(0, index).trim();
                var value = input.substring(index + op.length()).trim();
                if (!key.isEmpty() && !value.isEmpty()) {
                    return new FilterCondition(key, op, splitValues(value));
                }
            }
        }
        return null;
    }

    private String mapDaimoKey(String key) {
        return switch (key.toLowerCase(Locale.ROOT)) {
            case "assettype", "daimo:assettype" -> "assetType";
            case "description", "daimo:description" -> "dct:description";
            case "format", "daimo:format" -> "dct:format";
            case "keyword", "keywords", "tag", "tags", "daimo:keyword", "daimo:keywords" -> "dcat:keyword";
            case "language", "daimo:language", "dct:language", "dcterms:language" -> "dct:language";
            case "license", "daimo:license", "dct:license", "dcterms:license" -> "dct:license";
            case "library", "libraryname", "daimo:libraryname" -> "daimo:libraryName";
            case "metrics", "daimo:metrics" -> "daimo:metrics";
            case "modality", "daimo:modality" -> "daimo:modality";
            case "name", "daimo:name" -> "name";
            case "requestshape", "daimo:requestshape" -> "daimo:requestShape";
            case "task", "taskcategory" -> "daimo:taskCategory";
            case "daimo:taskcategory" -> "daimo:taskCategory";
            case "tasktype", "daimo:tasktype" -> "daimo:taskType";
            case "subtask", "daimo:subtask" -> "daimo:subtask";
            case "subtaskdescription", "daimo:subtaskdescription" -> "daimo:subtaskDescription";
            case "endpointbehavior", "daimo:endpointbehavior" -> "daimo:endpointBehavior";
            case "inputschema", "daimo:inputschema" -> "daimo:inputSchema";
            case "inputexample", "daimo:inputexample" -> "daimo:inputExample";
            case "input", "daimo:input" -> "daimo:input";
            case "label", "daimo:label" -> "daimo:label";
            case "labeltype", "daimo:labeltype" -> "daimo:labelType";
            case "datasetversion", "daimo:datasetversion" -> "daimo:datasetVersion";
            case "datasetrole", "daimo:datasetrole" -> "daimo:datasetRole";
            case "protocol", "daimo:protocol" -> "daimo:protocol";
            case "randomseed", "daimo:randomseed" -> "daimo:randomSeed";
            default -> key;
        };
    }

    private List<String> splitValues(List<String> rawValues) {
        var result = new ArrayList<String>();
        for (String raw : rawValues) {
            result.addAll(splitValues(raw));
        }
        return result;
    }

    private List<String> splitValues(String raw) {
        if (raw == null) {
            return List.of();
        }
        var parts = raw.split(",");
        var result = new ArrayList<String>();
        for (String part : parts) {
            var trimmed = part.trim();
            if (!trimmed.isEmpty()) {
                result.add(trimmed);
            }
        }
        return result;
    }

    private boolean isNumeric(String value) {
        try {
            Double.parseDouble(value);
            return true;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private String firstQueryValue(Map<String, List<String>> queryParams, String key) {
        if (queryParams == null) {
            return null;
        }
        var values = queryParams.get(key);
        if (values == null || values.isEmpty()) {
            return null;
        }
        return values.get(0);
    }

    private String textValue(JsonNode node, String... keys) {
        var valueNode = firstNode(node, keys);
        if (valueNode == null || valueNode.isNull()) {
            return null;
        }
        if (valueNode.isTextual()) {
            return valueNode.asText();
        }
        return valueNode.toString();
    }

    private String firstNonBlank(String first, String fallback) {
        if (first != null && !first.isBlank()) {
            return first;
        }
        return fallback;
    }

    private JsonNode firstNode(JsonNode node, String... keys) {
        if (node == null || keys == null) {
            return null;
        }
        for (String key : keys) {
            if (node.has(key)) {
                return node.get(key);
            }
        }
        return null;
    }

    private record FilterCondition(String key, String operator, List<String> values) {
    }
}

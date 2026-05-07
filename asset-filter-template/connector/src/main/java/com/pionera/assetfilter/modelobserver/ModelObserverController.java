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
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.edc.spi.monitor.Monitor;

import java.util.LinkedHashMap;
import java.util.Map;

@Path("/model-observer")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class ModelObserverController {
    private final ObjectMapper mapper;
    private final Monitor monitor;
    private final ModelObserverJournal journal;

    public ModelObserverController(ObjectMapper mapper, Monitor monitor, ModelObserverJournal journal) {
        this.mapper = mapper;
        this.monitor = monitor;
        this.journal = journal;
    }

    @POST
    @Path("/events")
    public Response recordEvent(String requestBody) {
        if (requestBody == null || requestBody.isBlank()) {
            return error(Response.Status.BAD_REQUEST, "Missing event body");
        }

        try {
            var event = mapper.readValue(requestBody, new TypeReference<Map<String, Object>>() {});
            var recorded = journal.record(event);
            return Response.status(Response.Status.CREATED)
                    .entity(mapper.writeValueAsString(recorded))
                    .build();
        } catch (Exception e) {
            monitor.warning("Failed to record model observer event: " + e.getMessage());
            return error(Response.Status.BAD_REQUEST, "Invalid event body");
        }
    }

    @GET
    @Path("/events")
    public Response events(@QueryParam("eventType") String eventType,
                           @QueryParam("category") String category,
                           @QueryParam("assetId") String assetId,
                           @QueryParam("agreementId") String agreementId,
                           @QueryParam("participantId") String participantId,
                           @QueryParam("negotiationId") String negotiationId,
                           @QueryParam("transferProcessId") String transferProcessId,
                           @QueryParam("usageSessionId") String usageSessionId,
                           @QueryParam("benchmarkRunId") String benchmarkRunId,
                           @QueryParam("correlationId") String correlationId,
                           @QueryParam("modelName") String modelName,
                           @QueryParam("status") String status,
                           @QueryParam("q") String query,
                           @QueryParam("limit") @DefaultValue("200") int limit) {
        var filters = filters(
                "eventType", eventType,
                "category", category,
                "assetId", assetId,
                "agreementId", agreementId,
                "participantId", participantId,
                "negotiationId", negotiationId,
                "transferProcessId", transferProcessId,
                "usageSessionId", usageSessionId,
                "benchmarkRunId", benchmarkRunId,
                "correlationId", correlationId,
                "modelName", modelName,
                "status", status,
                "q", query
        );
        return json(journal.query(filters, limit));
    }

    @GET
    @Path("/assets/{assetId}/timeline")
    public Response assetTimeline(@PathParam("assetId") String assetId,
                                  @QueryParam("limit") @DefaultValue("200") int limit) {
        return json(journal.timelineByAsset(assetId, limit));
    }

    @GET
    @Path("/agreements/{agreementId}/evidence")
    public Response agreementEvidence(@PathParam("agreementId") String agreementId,
                                      @QueryParam("limit") @DefaultValue("200") int limit) {
        return json(journal.evidenceByAgreement(agreementId, limit));
    }

    @GET
    @Path("/benchmarks")
    public Response benchmarks(@QueryParam("assetId") String assetId,
                               @QueryParam("limit") @DefaultValue("200") int limit) {
        return json(journal.benchmarkHistory(assetId, limit));
    }

    @GET
    @Path("/participants")
    public Response participants() {
        return json(journal.participantSummaries());
    }

    @GET
    @Path("/summary")
    public Response summary() {
        return json(journal.summary());
    }

    private Map<String, String> filters(String... keyValues) {
        var filters = new LinkedHashMap<String, String>();
        for (int index = 0; index + 1 < keyValues.length; index += 2) {
            var value = keyValues[index + 1];
            if (value != null && !value.isBlank()) {
                filters.put(keyValues[index], value.trim());
            }
        }
        return filters;
    }

    private Response json(Object value) {
        try {
            return Response.ok(mapper.writeValueAsString(value)).build();
        } catch (Exception e) {
            monitor.warning("Failed to serialize model observer response: " + e.getMessage());
            return error(Response.Status.INTERNAL_SERVER_ERROR, "Failed to serialize response");
        }
    }

    private Response error(Response.Status status, String message) {
        try {
            return Response.status(status)
                    .entity(mapper.writeValueAsString(Map.of("error", message)))
                    .build();
        } catch (Exception ignored) {
            return Response.status(status).entity("{\"error\":\"" + message + "\"}").build();
        }
    }
}

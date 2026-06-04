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

import org.eclipse.edc.connector.controlplane.asset.spi.index.AssetIndex;
import org.eclipse.edc.connector.controlplane.contract.spi.offer.store.ContractDefinitionStore;
import org.eclipse.edc.connector.controlplane.policy.spi.store.PolicyDefinitionStore;
import org.eclipse.edc.runtime.metamodel.annotation.Extension;
import org.eclipse.edc.runtime.metamodel.annotation.Inject;
import org.eclipse.edc.runtime.metamodel.annotation.Setting;
import org.eclipse.edc.spi.event.Event;
import org.eclipse.edc.spi.event.EventRouter;
import org.eclipse.edc.spi.monitor.Monitor;
import org.eclipse.edc.spi.system.ServiceExtension;
import org.eclipse.edc.spi.system.ServiceExtensionContext;
import org.eclipse.edc.spi.types.TypeManager;
import org.eclipse.edc.transaction.spi.TransactionContext;
import org.eclipse.edc.web.spi.WebService;

@Extension(value = ModelObserverExtension.NAME)
public class ModelObserverExtension implements ServiceExtension {
    public static final String NAME = "Pionera Model Observer Extension";

    @Setting(value = "Enable or disable the local model observer journal.", defaultValue = "true")
    public static final String OBSERVER_ENABLED = "asset.model.observer.enabled";

    @Setting(value = "Local JSON file used by the model observer journal.", defaultValue = "./.state/model-observer-events.json")
    public static final String OBSERVER_STORAGE_FILE = "asset.model.observer.storage.file";

    @Setting(value = "Maximum model observer events retained locally.", defaultValue = "5000")
    public static final String OBSERVER_MAX_EVENTS = "asset.model.observer.max.events";

    @Setting(value = "Source component value written into model observer events.", defaultValue = "asset-filter:model-observer")
    public static final String SOURCE_COMPONENT = "asset.model.observer.source.component";

    @Inject
    private WebService webService;
    @Inject
    private TypeManager typeManager;
    @Inject
    private Monitor monitor;
    @Inject
    private EventRouter eventRouter;
    @Inject(required = false)
    private TransactionContext transactionContext;
    @Inject(required = false)
    private AssetIndex assetIndex;
    @Inject(required = false)
    private PolicyDefinitionStore policyDefinitionStore;
    @Inject(required = false)
    private ContractDefinitionStore contractDefinitionStore;

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public void initialize(ServiceExtensionContext context) {
        var config = context.getConfig();
        var enabled = Boolean.parseBoolean(config.getString(OBSERVER_ENABLED, "true"));
        if (!enabled) {
            monitor.warning("Model observer extension is disabled by configuration.");
            return;
        }

        var storageFile = config.getString(OBSERVER_STORAGE_FILE, "./.state/model-observer-events.json");
        var maxEvents = config.getInteger(OBSERVER_MAX_EVENTS, 5000);
        var sourceComponent = config.getString(SOURCE_COMPONENT, "asset-filter:model-observer");
        var participantId = config.getString("edc.participant.id", context.getParticipantId());

        var journal = new ModelObserverJournal(typeManager.getMapper(), monitor, storageFile, maxEvents,
                participantId, sourceComponent);
        ModelObserverRegistry.initialize(journal);
        webService.registerResource(new ModelObserverController(typeManager.getMapper(), monitor, journal));

        var enricher = new ModelObserverDomainEventEnricher(monitor, transactionContext, assetIndex,
                policyDefinitionStore, contractDefinitionStore);
        var mapper = new ModelObserverDspEventMapper(participantId, sourceComponent + ":event-router", enricher);
        var subscriber = new ModelObserverDspEventSubscriber(monitor, mapper, journal);
        eventRouter.register(Event.class, subscriber);
        eventRouter.registerSync(Event.class, subscriber);

        monitor.info("Model observer journal ready at /api/model-observer/* (storage: " + storageFile + ")");
    }
}

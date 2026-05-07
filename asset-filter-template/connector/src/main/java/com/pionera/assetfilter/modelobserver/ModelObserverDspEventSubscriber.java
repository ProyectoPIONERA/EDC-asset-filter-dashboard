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

import org.eclipse.edc.spi.event.Event;
import org.eclipse.edc.spi.event.EventEnvelope;
import org.eclipse.edc.spi.event.EventSubscriber;
import org.eclipse.edc.spi.monitor.Monitor;

public class ModelObserverDspEventSubscriber implements EventSubscriber {
    private final Monitor monitor;
    private final ModelObserverDspEventMapper mapper;
    private final ModelObserverJournal journal;

    public ModelObserverDspEventSubscriber(Monitor monitor,
                                           ModelObserverDspEventMapper mapper,
                                           ModelObserverJournal journal) {
        this.monitor = monitor;
        this.mapper = mapper;
        this.journal = journal;
    }

    @Override
    public <E extends Event> void on(EventEnvelope<E> event) {
        var modelObserverEvent = mapper.map(event);
        if (modelObserverEvent == null) {
            return;
        }

        var recorded = journal.record(modelObserverEvent);
        monitor.debug("Recorded model observer DSP event: " + recorded.get("eventType"));
    }
}

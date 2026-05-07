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

import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

public final class ModelObserverRegistry {
    private static final AtomicReference<ModelObserverJournal> JOURNAL = new AtomicReference<>();

    private ModelObserverRegistry() {
    }

    public static void initialize(ModelObserverJournal journal) {
        JOURNAL.set(journal);
    }

    public static boolean record(Map<String, Object> event) {
        var journal = JOURNAL.get();
        if (journal == null) {
            return false;
        }
        journal.record(event);
        return true;
    }

    public static boolean isReady() {
        return JOURNAL.get() != null;
    }
}

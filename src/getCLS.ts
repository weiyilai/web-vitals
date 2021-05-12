/*
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {getVisibilityWatcher} from './lib/getVisibilityWatcher.js';
import {initMetric} from './lib/initMetric.js';
import {observe, PerformanceEntryHandler} from './lib/observe.js';
import {onHidden} from './lib/onHidden.js';
import {onBFCacheRestore} from './lib/onBFCacheRestore.js';
import {bindReporter} from './lib/bindReporter.js';
import {ReportHandler} from './types.js';


// https://wicg.github.io/layout-instability/#sec-layout-shift
interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

export const getCLS = (onReport: ReportHandler, reportAllChanges?: boolean) => {
  const visibilityWatcher = getVisibilityWatcher();

  const onReportWrapped: ReportHandler = (arg) => {
    // Only report if the page was visible at some point in its lifecycle.
    // Note: this doesn't technically match the current behavior of CrUX, which
    // only includes pages that report FCP. However, we plan to change the
    // behavior of CrUX in the future, and matching it would couple CLS to FCP
    // in an awkward way, so in this library we only ignore CLS if the page
    // was never visible (which should be the same as CrUX in most)
    if (visibilityWatcher.firstVisibleTime < performance.now()) {
      onReport(arg);
    }
  };

  let metric = initMetric('CLS', 0);
  let report: ReturnType<typeof bindReporter>;

  let sessionValue = 0;
  let sessionEntries: PerformanceEntry[] = [];

  const entryHandler = (entry: LayoutShift) => {
    // Only count layout shifts without recent user input.
    if (!entry.hadRecentInput) {
      const firstSessionEntry = sessionEntries[0];
      const lastSessionEntry = sessionEntries[sessionEntries.length - 1];

      // If the entry is part of the current session, add it.
      // Otherwise, start a new session.
      if (sessionValue &&
          entry.startTime - lastSessionEntry.startTime < 1000 &&
          entry.startTime - firstSessionEntry.startTime < 5000) {
        sessionValue += entry.value;
        sessionEntries.push(entry);
      } else {
        sessionValue = entry.value;
        sessionEntries = [entry];
      }

      if (sessionValue > metric.value) {
        metric.value = sessionValue;
        metric.entries = sessionEntries;

        report();
      }
    }
  };

  const po = observe('layout-shift', entryHandler as PerformanceEntryHandler);
  if (po) {
    report = bindReporter(onReportWrapped, metric, reportAllChanges);

    onHidden(() => {
      po.takeRecords().map(entryHandler as PerformanceEntryHandler);
      report();
    });

    onBFCacheRestore(() => {
      sessionValue = 0;
      metric = initMetric('CLS', 0);
      report = bindReporter(onReportWrapped, metric, reportAllChanges);
    });
  }
};

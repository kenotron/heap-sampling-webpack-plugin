import { Compiler } from "webpack";
import inspector from "inspector";
import path from "path";
import { promisify } from "util";
import { mkdirpSync } from "webpack/lib/util/fs";

import fs from 'fs';

export interface HeapSamplingPluginOptions {
  checkPeakMemory?: boolean;
  checkPeakMemoryInterval?: number;
  heapProfile?: boolean;
  allocationTracking?: boolean;
  allocationOutputPath?: string;
  outputPath?: string;
}

export class HeapSamplingPlugin {
  private session: inspector.Session;
  private peakMemory = 0;

  constructor(private options: HeapSamplingPluginOptions) {
    this.session = new inspector.Session();
    this.session.connect();

    if (!this.options) {
      this.options = {};
    }

    // TODO: figure out to config this outputpath
    this.options.allocationOutputPath = "v8-allocation-profile.json";

    if (!this.options.outputPath) {
      this.options.outputPath = "v8-heap-sample.heapprofile";
    }

    if (typeof this.options.checkPeakMemoryInterval === "undefined") {
      this.options.checkPeakMemoryInterval = 1000;
    }
  }

  initializeMemoryChecker() {
    const peakMemoryInterval = setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const heapTotal = memoryUsage.heapTotal;

      if (heapTotal > this.peakMemory) {
        this.peakMemory = heapTotal;
      }
    }, this.options.checkPeakMemoryInterval);

    return () => peakMemoryInterval.unref();
  }

  apply(compiler: Compiler): void {
    const fs = compiler.intermediateFileSystem;
    const logger = compiler.getInfrastructureLogger("heap-sampling-plugin");
    const writeFile = promisify(fs.writeFile);

    let disposeMemoryChecker: () => void;

    if (!this.options.outputPath) {
      this.options.outputPath = compiler.options.output.path;
    }

    compiler.hooks.beforeRun.tapPromise("HeapSamplingPlugin", async (_compiler) => {
      if (this.options.heapProfile || this.options.allocationTracking) {
        const heapProfilerEnable = promisify(this.session.post.bind(this.session, "HeapProfiler.enable"));
        await heapProfilerEnable();
      }

      if (this.options.heapProfile) {
        const heapProfilerStartSampling = promisify(this.session.post.bind(this.session, "HeapProfiler.startSampling"));
        await heapProfilerStartSampling();
      }

      if (this.options.allocationTracking) {
        const heapAllocationStartTracking = promisify(this.session.post.bind(this.session, "HeapProfiler.startTrackingHeapObjects"));
        await heapAllocationStartTracking(true);
      }

      if (this.options.checkPeakMemory) {
        disposeMemoryChecker = this.initializeMemoryChecker();
      }
    });

    compiler.hooks.done.tapPromise("HeapSamplingPlugin", async (stats) => {
      if (this.options.heapProfile) {
        const { outputPath } = this.options;

        const heapProfilerStopSampling = promisify(this.session.post.bind(this.session, "HeapProfiler.stopSampling"));
        const heapProfilerDisable = promisify(this.session.post.bind(this.session, "HeapProfiler.disable"));

        const { profile } = await heapProfilerStopSampling();
        await heapProfilerDisable();

        if (/\/|\\/.test(outputPath)) {
          const dirPath = path.dirname(outputPath);
          mkdirpSync(fs, dirPath);
        }

        await writeFile(this.options.outputPath, JSON.stringify(profile));
      }

      
      if (this.options.allocationTracking) {
        const heapAllocationStopTracking = promisify(this.session.post.bind(this.session, "HeapProfiler.stopTrackingHeapObjects"));
        await heapAllocationStopTracking();
      }

      if (this.options.checkPeakMemory) {
        logger.info(`Max memory used for webpack: ${(this.peakMemory / 1024 / 1024).toFixed(2)}MB`);
        disposeMemoryChecker();
      }
    });

    setTimeout(async() => {
      const takeHeapSnapshot = promisify(this.session.post.bind(this.session, "HeapProfiler.takeHeapSnapshot"));
      const writer = fs.createWriteStream("v8-heap-snapshot.heapsnapshot");

      this.session.on("HeapProfiler.addHeapSnapshotChunk", (event: any) => {
        try {
          writer.write(event.params.chunk)
        } catch (e) {
          console.error(e);
        }
      })

      console.time('takeHeapSnapshot');
      await takeHeapSnapshot(null, (err, data) => {
        writer.end();
      });
      console.timeEnd('takeHeapSnapshot');

    }, 35000)
  }
}

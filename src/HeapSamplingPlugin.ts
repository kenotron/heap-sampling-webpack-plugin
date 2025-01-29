import { Compiler } from "webpack";
import inspector from "inspector";
import path from "path";
import { promisify } from "util";
import { mkdirpSync } from "webpack/lib/util/fs";

export interface HeapSamplingPluginOptions {
  checkPeakMemory?: boolean;
  checkPeakMemoryInterval?: number;
  heapProfile?: boolean;
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
    const fs = compiler.outputFileSystem;
    const logger = compiler.getInfrastructureLogger("heap-sampling-plugin");
    const writeFile = promisify(fs.writeFile);

    let disposeMemoryChecker: () => void;

    if (!this.options.outputPath) {
      this.options.outputPath = compiler.options.output.path;
    }

    compiler.hooks.beforeRun.tapPromise("HeapSamplingPlugin", async (_compiler) => {
      if (this.options.heapProfile) {
        const heapProfilerEnable = promisify(this.session.post.bind(this.session, "HeapProfiler.enable"));
        const heapProfilerStartSampling = promisify(this.session.post.bind(this.session, "HeapProfiler.startSampling"));
        await heapProfilerEnable();
        await heapProfilerStartSampling();
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

      if (this.options.checkPeakMemory) {
        logger.info(`Max memory used for webpack: ${(this.peakMemory / 1024 / 1024).toFixed(2)}MB`);
        disposeMemoryChecker();
      }
    });
  }
}

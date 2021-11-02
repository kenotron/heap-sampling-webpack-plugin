import { Compiler } from "webpack";
import inspector from "inspector";
import path from "path";
import { promisify } from "util";
import { mkdirpSync } from "webpack/lib/util/fs";

export interface HeapSamplingPluginOptions {
  checkPeakMemory?: boolean;
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
  }

  initializeMemoryChecker() {
    const peakMemoryInterval = setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const heapTotal = memoryUsage.heapTotal;

      if (heapTotal > this.peakMemory) {
        this.peakMemory = heapTotal;
      }
    }, 1000);

    return () => peakMemoryInterval.unref();
  }

  apply(compiler: Compiler): void {
    const fs = compiler.intermediateFileSystem;
    const logger = compiler.getInfrastructureLogger("heap-sampling-plugin");
    const writeFile = promisify(fs.writeFile);

    let disposeMemoryChecker: () => void;

    if (this.options.checkPeakMemory) {
      disposeMemoryChecker = this.initializeMemoryChecker();
    }

    if (!this.options.outputPath) {
      this.options.outputPath = compiler.options.output.path;
    }

    compiler.hooks.beforeRun.tapPromise("HeapSamplingPlugin", async (_compiler) => {
      const heapProfilerEnable = promisify(this.session.post.bind(this.session, "HeapProfiler.enable"));
      const heapProfilerStartSampling = promisify(this.session.post.bind(this.session, "HeapProfiler.startSampling"));
      await heapProfilerEnable();
      await heapProfilerStartSampling();
    });

    compiler.hooks.afterEmit.tapPromise("HeapSamplingPlugin", async (stats) => {
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

      if (this.options.checkPeakMemory) {
        logger.info(`Max memory usaged for webpack: ${(this.peakMemory / 1024 / 1024).toFixed(2)}MB`);
        disposeMemoryChecker();
      }
    });
  }
}

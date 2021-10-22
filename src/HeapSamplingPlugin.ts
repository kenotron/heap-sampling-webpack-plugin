import { Compiler } from "webpack";
import inspector from "inspector";
import fs from "fs";
import path from "path";
import { promisify } from "util";

export interface HeapSamplingPluginOptions {
  outputPath?: string;
}

export class HeapSamplingPlugin {
  private session: inspector.Session;

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

  apply(compiler: Compiler): void {
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
      const writeFile = promisify(fs.writeFile);
      const heapProfilerStopSampling = promisify(this.session.post.bind(this.session, "HeapProfiler.stopSampling"));
      const heapProfilerDisable = promisify(this.session.post.bind(this.session, "HeapProfiler.disable"));
      
      const { profile } = await heapProfilerStopSampling();
      await heapProfilerDisable();

      if (/\/|\\/.test(outputPath)) {
        const dirPath = path.dirname(outputPath);
        fs.mkdirSync(dirPath, { recursive: true });
      }

      await writeFile(this.options.outputPath, JSON.stringify(profile));
    });
  }
}

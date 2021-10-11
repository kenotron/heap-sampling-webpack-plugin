import { Compiler } from "webpack";
import inspector from "inspector";
import fs from "fs";

export class V8ProfilePlugin {
  private session: inspector.Session;

  constructor(_options: any) {
    this.session = new inspector.Session();
    this.session.connect();
  }

  /**
   * Apply the plugin
   */
  apply(compiler: Compiler): void {
    compiler.hooks.beforeRun.tapAsync("V8ProfilePlugin", (_compiler) => {
      return new Promise<void>((resolve, reject) => {
        this.session.post("HeapProfiler.enable", (err) => {
          if (!err) {
            this.session.post("HeapProfiler.startSampling");
            resolve();
          } else {
            reject();
          }
        });
      });
    });

    compiler.hooks.done.tapAsync("V8ProfilePlugin", async (_stats) => {
      return new Promise<void>((resolve, reject) => {
        this.session.post("HeapProfiler.stopSampling", (err, { profile }) => {
          // Write profile to disk, upload, etc.
          if (!err) {
            fs.writeFileSync("./profile.heapprofile", JSON.stringify(profile));
            this.session.post("HeapProfiler.disable");
            return resolve();
          }

          reject();
        });
      });
    });
  }
}

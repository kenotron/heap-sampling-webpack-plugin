# Heap Sampling Webpack Plugin

Webpack provides a really detailed `webpack.debug.ProfilingPlugin`, but it only does CPU Profiling. There are more to performance tuning with Webpack than CPU profile. This plugin provides heap sample information to show where memory is allocated after a successful build. The method used is through the Inspector session's `HeapProfiler.startSampling`. This is a sampling profiler, therefore, it CAN be used in production builds to check your memory consumption in your build machines.

The generated file has a `.heapprofile` extension and can be opened in the "Memory" tab under a Chromium based devtool to show what is taking up all that memory in your webpack run.

## How to configure

Plug this into your webpack configuration like so:

```js
const HeapSamplingPlugin = require("heap-sampling-webpack-plugin");

module.exports = {
  plugins: [
    new HeapSamplingPlugin();
  ]
}
```

You may want to specify an option with this plugin:

```js
new HeapSamplingPlugin({
  outputPath: "/some/place/my.heapprofile"
})
```
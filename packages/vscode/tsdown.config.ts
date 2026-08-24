import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { extension: "src/extension.ts" },
  clean: true,
  deps: { neverBundle: ["vscode"] },
  dts: false,
  format: "cjs",
  platform: "node",
  sourcemap: true,
  target: "node20",
});

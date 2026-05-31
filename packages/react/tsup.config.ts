import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // Dual-publish so both ESM (`import`) and CommonJS (`require`) consumers work.
  // With "type":"module" in package.json, tsup emits index.js (ESM) + index.cjs (CJS),
  // and index.d.ts / index.d.cts for the matching types conditions.
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // React (and the automatic JSX runtime) are provided by the host app.
  external: ['react', 'react-dom', 'react/jsx-runtime'],
});

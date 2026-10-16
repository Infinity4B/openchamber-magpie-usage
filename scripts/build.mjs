// Bundles the pages into classic IIFE scripts (the sandboxed iframe cannot load
// modules) and the service into one ESM file for the app's Node runtime.
// OpenChamber never builds an extension, so the outputs are committed.
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

const page = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
};

const configs = [
  { ...page, entryPoints: ['src/status/main.ts'], outfile: 'status/main.js' },
  { ...page, entryPoints: ['src/panel/main.ts'], outfile: 'panel/main.js' },
  {
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'info',
    entryPoints: ['src/service/main.ts'],
    outfile: 'service/main.js',
  },
];

if (watch) {
  for (const config of configs) {
    const ctx = await context(config);
    await ctx.watch();
  }
} else {
  await Promise.all(configs.map((config) => build(config)));
}

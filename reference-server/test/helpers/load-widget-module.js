import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Run the widget's TypeScript helpers without depending on emitted identifiers
// or formatting. Renaming locals here also guards against the original failure.
export async function loadWidgetModule(name) {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL(`../../embed/src/${name}`, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    minifyIdentifiers: true,
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

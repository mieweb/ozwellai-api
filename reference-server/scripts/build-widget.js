const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '..');
const entryPoint = path.join(projectRoot, 'embed/src/main.tsx');
const outfile = path.join(projectRoot, 'embed/ozwell.js');

function inlineCssPlugin() {
  return {
    name: 'inline-css',
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = await fs.readFile(args.path, 'utf8');
        const marker = `ozwell-style:${path.relative(projectRoot, args.path)}`;
        const contents = `
          (() => {
            const marker = ${JSON.stringify(marker)};
            if (document.head.querySelector('style[data-ozwell-style="' + marker + '"]')) return;
            const style = document.createElement('style');
            style.dataset.ozwellStyle = marker;
            style.textContent = ${JSON.stringify(css)};
            document.head.appendChild(style);
          })();
        `;
        return { contents, loader: 'js' };
      });
    },
  };
}

async function build() {
  await esbuild.build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    format: 'iife',
    globalName: 'OzwellWidgetBundle',
    platform: 'browser',
    target: ['es2020'],
    jsx: 'automatic',
    minify: false,
    sourcemap: false,
    logLevel: 'info',
    external: [
      '@esheet/builder',
      '@esheet/renderer',
      '@ozwell/react',
      'ag-grid-community',
      'ag-grid-react',
      'datavis-ace',
      'wavesurfer.js',
    ],
    plugins: [inlineCssPlugin()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    },
  });
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});

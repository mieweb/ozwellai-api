const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(projectRoot, '..');
const entryPoint = path.join(projectRoot, 'embed/src/main.tsx');
const outfile = path.join(projectRoot, 'embed/ozwell.js');
const localMiewebUiRoot = path.join(repoRoot, 'vendor/mieweb-ui');
const localMiewebUiDist = path.join(repoRoot, 'vendor/mieweb-ui/dist');
const rootRequire = require('node:module').createRequire(path.join(repoRoot, 'package.json'));

function inlineCssPlugin() {
  return {
    name: 'inline-css',
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = await fsPromises.readFile(args.path, 'utf8');
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

function resolveMiewebUiSubpath(subpath) {
  const normalized = subpath.replace(/^\//, '');
  if (!normalized) return path.join(localMiewebUiDist, 'index.js');
  if (normalized === 'styles' || normalized === 'styles.css') {
    return path.join(localMiewebUiDist, 'styles.css');
  }
  if (normalized === 'markdown.css') {
    return path.join(localMiewebUiDist, 'components/Markdown/styles.css');
  }
  if (normalized.endsWith('.css')) {
    return path.join(localMiewebUiDist, normalized);
  }

  const directFile = path.join(localMiewebUiDist, `${normalized}.js`);
  if (fs.existsSync(directFile)) return directFile;

  return path.join(localMiewebUiDist, normalized, 'index.js');
}

function localMiewebUiPlugin() {
  const hasLocalSource = fs.existsSync(path.join(localMiewebUiRoot, 'package.json'));
  const hasLocalBuild = fs.existsSync(path.join(localMiewebUiDist, 'index.js'));

  return {
    name: 'local-mieweb-ui',
    setup(build) {
      if (!hasLocalBuild) {
        if (hasLocalSource) {
          console.warn(
            '[build-widget] Local mieweb/ui submodule is present but not built; using installed @mieweb/ui package.'
          );
        } else {
          console.warn('[build-widget] Local mieweb/ui submodule not found; using installed @mieweb/ui package.');
        }
        return;
      }

      build.onResolve({ filter: /^@mieweb\/ui(?:\/.*)?$/ }, (args) => {
        const subpath = args.path.slice('@mieweb/ui'.length);
        return { path: resolveMiewebUiSubpath(subpath) };
      });

      build.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
        path: rootRequire.resolve(args.path),
      }));

      build.onResolve({ filter: /^react-dom(?:\/.*)?$/ }, (args) => ({
        path: rootRequire.resolve(args.path),
      }));
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
    plugins: [localMiewebUiPlugin(), inlineCssPlugin()],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    },
  });
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});

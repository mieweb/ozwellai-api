const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(projectRoot, '..');
const entryPoint = path.join(projectRoot, 'embed/src/main.tsx');
const outfile = path.join(projectRoot, 'embed/ozwell.js');
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
  const hasLocalBuild = fs.existsSync(path.join(localMiewebUiDist, 'index.js'));

  return {
    name: 'local-mieweb-ui',
    setup(build) {
      if (!hasLocalBuild) {
        throw new Error(
          '[build-widget] Build the pinned UI first: git submodule update --init --recursive && ' +
          './scripts/ci/build-pinned-ui.sh'
        );
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
    entryPoints: [path.join(projectRoot, 'embed/src/desktop-login.tsx')],
    outfile: path.join(projectRoot, 'embed/desktop-login.js'),
    bundle: true, format: 'iife', platform: 'browser', target: ['es2020'], jsx: 'automatic',
    plugins: [inlineCssPlugin()],
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production') },
  });
  if (process.argv.includes('--desktop-only')) return;
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

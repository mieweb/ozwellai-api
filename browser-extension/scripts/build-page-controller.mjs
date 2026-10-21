#!/usr/bin/env node
// Rebuild the checked-in extension artifact from the exact #326 distribution.
// This command reads installed dependencies; it never fetches or executes controller code.
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = resolve(extensionDir, '..');
const commit = 'cf185d55a44ecd46eb38a9feb296dbbc7b3485ce';
const upstreamCommit = '9eb6b6646500264d9034dd466a4270cb9fc1ef1e';
const dependency = `git+https://github.com/mieweb/page-agent.git#${commit}`;
let packageDir = join(repositoryDir, 'landing-page/node_modules/@mieweb/page-controller');
for (let index = 2; index < process.argv.length; index++) {
  if (process.argv[index] === '--help') {
    process.stdout.write('Usage: node scripts/build-page-controller.mjs [--package-dir PATH]\n');
    process.exit(0);
  }
  if (process.argv[index] !== '--package-dir' || !process.argv[index + 1]) {
    throw new Error(`Unknown or incomplete option: ${process.argv[index]}`);
  }
  packageDir = resolve(process.argv[++index]);
}

const sha256 = content => createHash('sha256').update(content).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const manifest = await json(join(repositoryDir, 'landing-page/package.json'));
const lock = await json(join(repositoryDir, 'landing-page/package-lock.json'));
const lockedPackage = lock.packages['node_modules/@mieweb/page-controller'];
if (manifest.dependencies['@mieweb/page-controller'] !== dependency || lockedPackage?.resolved !== dependency) {
  throw new Error(`Controller dependency must remain pinned to ${commit} in the landing-page manifest and lockfile.`);
}

// These hashes were verified against the files at the pinned Git commit. Check
// the distribution and legal notices rather than trusting a package directory's
// name or its self-reported version. Updating the pin requires reviewing them.
const expectedHashes = {
  'package.json': '69aa430109876ea0d21b54be2e301e314451b2deb4347b8395f6c0dce21d785f',
  'dist/page-controller.js': 'fffc37b74720b5ce4f3363fe99586e47d731596639b60761d1242b88a0bd8ea0',
  'CONTROLLER-DISTRIBUTION.md': '43ab842e49e43c1eb6ff0ae0346c909b0d84ee637532f1659698fb02bbfcd03b',
  LICENSE: '393ad563ce5dd0bbe283ec40f9f5d631817262bc9bbd5eb17ed038a9d9f44803',
  'THIRD_PARTY_NOTICES.md': 'f0b4832cd9b24df11e97f438c7026db73b39dc68040a86cedc678baac52d84d7',
  'licenses/ai-motion-LICENSE': 'df71b50b0d46b282e5ed6fe67c1c23874b10b2a1512a4658d3aafa9fb9d23b76',
};
const files = {};
for (const [name, expected] of Object.entries(expectedHashes)) {
  let content;
  try { content = await readFile(join(packageDir, name), 'utf8'); }
  catch (error) { throw new Error(`Cannot read pinned controller ${name}. Install landing-page dependencies or pass --package-dir PATH.`, { cause: error }); }
  if (sha256(content) !== expected) throw new Error(`Pinned controller file does not match ${commit}: ${name}`);
  files[name] = content;
}
if (!files['CONTROLLER-DISTRIBUTION.md'].includes(upstreamCommit)) {
  throw new Error('Controller upstream provenance is missing.');
}

let source = files['dist/page-controller.js'];
function patch(before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`Expected one pinned patch location: ${label}`);
  source = source.replace(before, after);
}

patch(
  '  async executeJavascript(script, signal) {\n    try {\n      const asyncFunction = eval(`(async (signal) => { ${script} })`);\n      const result = await asyncFunction(signal);\n      return {\n        success: true,\n        message: `\\u2705 Executed JavaScript. Result: ${result}`\n      };\n    } catch (error) {\n      return {\n        success: false,\n        message: `\\u274C Error executing JavaScript: ${error}`\n      };\n    }\n  }',
  '  async executeJavascript() {\n    throw new Error("Arbitrary JavaScript execution is unavailable in the browser extension.");\n  }',
  'disable arbitrary JavaScript execution',
);
patch(
  '    if (node.dataset?.browserUseIgnore === "true" || node.dataset?.pageAgentIgnore === "true") {',
  '    if (node.nodeType === Node.ELEMENT_NODE && typeof args.excludeElements === "function" && args.excludeElements(node)) {\n      return null;\n    }\n    if (node.dataset?.browserUseIgnore === "true" || node.dataset?.pageAgentIgnore === "true") {',
  'prune excluded subtrees before traversal and indexing',
);
patch(
  '    rootElement: config.rootElement,\n    doHighlightElements: true,',
  '    rootElement: config.rootElement,\n    excludeElements: config.excludeElements,\n    doHighlightElements: config.doHighlightElements ?? !((config.highlightOpacity ?? 0) === 0 && (config.highlightLabelOpacity ?? 0.1) === 0),',
  'forward exclusion callback and avoid invisible highlight DOM',
);
patch(
  '            highlightElement(node, nodeData.highlightIndex, parentIframe);\n          }\n          return true;\n        }\n      } else {',
  '            highlightElement(node, nodeData.highlightIndex, parentIframe);\n          }\n        }\n        return true;\n      } else {',
  'preserve indexed parent grouping when highlights are disabled',
);
patch(
  'function flatTreeToString(flatTree, includeAttributes = [], keepSemanticTags = false) {',
  'function flatTreeToString(flatTree, includeAttributes = [], keepSemanticTags = false, omitAttributes = []) {',
  'attribute omission parameter',
);
patch(
  '  const includeAttrs = [...includeAttributes, ...DEFAULT_INCLUDE_ATTRIBUTES];',
  '  const omittedAttrs = new Set(omitAttributes);\n  const includeAttrs = [...includeAttributes, ...DEFAULT_INCLUDE_ATTRIBUTES].filter(name => !omittedAttrs.has(name));',
  'remove omitted attributes from defaults and requested attributes',
);
patch(
  '          const attributesToInclude = matchAttributes(node.attributes, includeAttrs);',
  '          const attributesToInclude = matchAttributes(node.attributes, includeAttrs);\n          for (const name of omittedAttrs) delete attributesToInclude[name];',
  'prevent wildcard attribute requests from restoring omitted values',
);
patch(
  '      if (elementNode.children) {\n        for (const childId of elementNode.children) {',
  '      if (elementNode.children && !(omittedAttrs.has("value") && elementNode.tagName === "textarea")) {\n        for (const childId of elementNode.children) {',
  'omit textarea default-value text when values are omitted',
);
patch(
  '      this.config.includeAttributes,\n      this.config.keepSemanticTags\n    );',
  '      this.config.includeAttributes,\n      this.config.keepSemanticTags,\n      this.config.omitAttributes\n    );',
  'forward omission configuration from updateTree',
);
patch(
  'export {\n  PageController,\n  clickElement,\n  getElementByIndex,\n  inputTextElement,\n  scrollHorizontally,\n  scrollIntoViewIfNeeded,\n  scrollVertically,\n  selectOptionElement\n};',
  'export { PageController };',
  'export only the controller constructor',
);
source = source.replace('//# sourceMappingURL=page-controller.js.map\n', '');

const require = createRequire(join(repositoryDir, 'package.json'));
const esbuild = require('esbuild');
const buildLock = await json(join(repositoryDir, 'package-lock.json'));
if (esbuild.version !== buildLock.packages['node_modules/esbuild']?.version) {
  throw new Error('Install the repository locked esbuild version before rebuilding the controller.');
}
const result = await esbuild.build({
  absWorkingDir: repositoryDir,
  stdin: { contents: source, sourcefile: 'page-controller.pinned.js', loader: 'js' },
  bundle: true,
  format: 'iife',
  globalName: 'OzwellPageController',
  platform: 'browser',
  target: ['chrome102', 'safari16.4'],
  minify: true,
  legalComments: 'eof',
  write: false,
  banner: { js: `/*! @mieweb/page-controller 1.12.4-mie.1; ${commit}; MIT. See vendor/LICENSE and vendor/THIRD_PARTY_NOTICES.md. */` },
  footer: { js: 'globalThis.OzwellPageController = Object.freeze(OzwellPageController);' },
});
const bundle = result.outputFiles[0].text;
if (/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/.test(bundle)) {
  throw new Error('Controller bundle contains dynamic JavaScript execution.');
}
if (/\bimport\s*\(/.test(bundle)) throw new Error('Controller bundle contains a runtime module import.');

const destination = join(extensionDir, 'vendor');
await mkdir(destination, { recursive: true });
await writeFile(join(destination, 'page-controller.js'), bundle);
for (const [origin, name] of [['LICENSE', 'LICENSE'], ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'], ['licenses/ai-motion-LICENSE', 'ai-motion-LICENSE']]) {
  await writeFile(join(destination, name), files[origin]);
}
await writeFile(join(destination, 'PROVENANCE.json'), JSON.stringify({
  package: '@mieweb/page-controller', version: '1.12.4-mie.1',
  repository: 'https://github.com/mieweb/page-agent', commit, upstreamCommit,
  lockIntegrity: lockedPackage.integrity,
  sourceFiles: expectedHashes,
  esbuild: esbuild.version, target: ['chrome102', 'safari16.4'],
  patches: [
    'Disable executeJavascript; no evaluation or dynamic module imports in output.',
    'Forward excludeElements(Element) and prune its matching subtrees before extraction/indexing.',
    'Forward omitAttributes and remove matching attributes from defaults, explicit and wildcard serialization; omit textarea default text when value is omitted.',
    'Skip invisible highlight DOM while preserving indexed parent grouping.',
    'Export only PageController as globalThis.OzwellPageController.PageController.',
  ],
  bundle: { file: 'page-controller.js', bytes: Buffer.byteLength(bundle), sha256: sha256(bundle) },
}, null, 2) + '\n');
process.stdout.write(`Built vendor/page-controller.js (${Buffer.byteLength(bundle)} bytes; sha256 ${sha256(bundle)})\n`);

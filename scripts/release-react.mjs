#!/usr/bin/env node
// Release @ozwell/react (packages/react) to npm.
//
// Usage:
//   node scripts/release-react.mjs [--dry-run] [--bump=major|minor|patch|prerelease]
//
// Without --bump, the bump is derived from conventional commits that touched
// packages/react since the last react-v* tag. Stable releases go to the npm
// `latest` tag and are tagged react-v<version>; prereleases (x.y.z-N) go to
// the `next` tag and are not git-tagged.
//
// Order: checks → build → preflight publish → publish → commit/tag/push, so a
// failed publish never lands a version bump on main. Not atomic: if a git step
// fails after npm accepts the package, the next run resumes from the npm version.
//
// No GitHub Release is created: this repo's other publish workflows trigger on
// any published release and would republish unrelated packages.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG_DIR = 'packages/react';
const TAG_PREFIX = 'react-v';
const BUMPS = ['major', 'minor', 'patch', 'prerelease'];

const DRY_RUN = process.argv.includes('--dry-run');
const bumpArg = process.argv.find((a) => a.startsWith('--bump='));
const MANUAL_BUMP = bumpArg ? bumpArg.split('=')[1] : null;

if (MANUAL_BUMP && !BUMPS.includes(MANUAL_BUMP)) {
  fail(`Invalid --bump=${MANUAL_BUMP}. Use one of: ${BUMPS.join(', ')}.`);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

function exec(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function tryRun(cmd, opts) {
  try {
    return run(cmd, opts);
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`\n❌  ${message}`);
  process.exit(1);
}

function readPkg() {
  return JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
}

// --- semver helpers (x.y.z with an optional numeric prerelease: x.y.z-N) ----

function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/.exec(version);
  if (!match) fail(`Unsupported version format "${version}" (expected x.y.z or x.y.z-N).`);
  const [, major, minor, patch, pre] = match;
  return { major: +major, minor: +minor, patch: +patch, pre: pre === undefined ? null : +pre };
}

function format({ major, minor, patch, pre }) {
  return `${major}.${minor}.${patch}${pre === null ? '' : `-${pre}`}`;
}

// Positive when a > b. A stable version outranks prereleases of the same base.
function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key];
  }
  return (pa.pre ?? Infinity) - (pb.pre ?? Infinity);
}

// Matches `npm version` semantics for the numeric prerelease form.
function applyBump(version, bump) {
  const v = parse(version);
  const isPre = v.pre !== null;
  switch (bump) {
    case 'prerelease':
      return format(isPre ? { ...v, pre: v.pre + 1 } : { ...v, patch: v.patch + 1, pre: 0 });
    case 'patch':
      return format(isPre ? { ...v, pre: null } : { ...v, patch: v.patch + 1 });
    case 'minor':
      return format(isPre && v.patch === 0
        ? { ...v, pre: null }
        : { ...v, minor: v.minor + 1, patch: 0, pre: null });
    case 'major':
      return format(isPre && v.minor === 0 && v.patch === 0
        ? { ...v, pre: null }
        : { major: v.major + 1, minor: 0, patch: 0, pre: null });
    default:
      return fail(`Unknown bump "${bump}".`);
  }
}

// --- 1. Resolve current version ----------------------------------------------

const pkg = readPkg();
const lastTag = tryRun(`git describe --tags --abbrev=0 --match "${TAG_PREFIX}*"`);

// If an earlier run published but failed to push its version bump, npm is ahead
// of package.json; start from the highest known version so we never collide.
const publishedJson = tryRun(`npm view ${pkg.name} versions --json`);
const published = publishedJson ? [].concat(JSON.parse(publishedJson)) : [];
const candidates = [pkg.version, ...published.filter((v) => /^\d+\.\d+\.\d+(-\d+)?$/.test(v))];
const currentVersion = candidates.reduce((max, v) => (compare(v, max) > 0 ? v : max));

console.log(`Package:         ${pkg.name}`);
console.log(`Last tag:        ${lastTag || '(none)'}`);
console.log(`package.json:    ${pkg.version}`);
console.log(`Latest on npm:   ${published.at(-1) || '(none)'}`);
console.log(`Current version: ${currentVersion}`);

// --- 2. Collect conventional commits that touched the package ----------------

const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
const rawLog = tryRun(`git log ${range} --format=%H%x1f%s%x1f%b%x1e -- ${PKG_DIR}`) || '';

const commits = rawLog
  .split('\x1e')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [hash, subject, body = ''] = entry.split('\x1f');
    const match = /^(\w+)(?:\([^)]*\))?(!)?:\s*(.+)$/.exec(subject);
    return {
      hash: hash.slice(0, 7),
      subject,
      type: match ? match[1] : 'other',
      description: match ? match[3] : subject,
      breaking: Boolean(match?.[2]) || /BREAKING[ -]CHANGE/.test(body),
    };
  })
  .filter((c) => !/^chore\(react\): release /.test(c.subject));

if (!commits.length) {
  console.log(`\nNo commits touched ${PKG_DIR} since ${lastTag || 'the beginning'} — nothing to release.`);
  process.exit(0);
}

// --- 3. Determine bump and new version ----------------------------------------

function determineBump() {
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  return 'patch';
}

const bump = MANUAL_BUMP ?? determineBump();
const newVersion = applyBump(currentVersion, bump);
const IS_PRERELEASE = parse(newVersion).pre !== null;
const distTag = IS_PRERELEASE ? 'next' : 'latest';

if (compare(newVersion, currentVersion) <= 0) {
  fail(`Computed version ${newVersion} is not greater than ${currentVersion}.`);
}
if (tryRun(`npm view ${pkg.name}@${newVersion} version`)) {
  fail(`${pkg.name}@${newVersion} is already published.`);
}

console.log(`\nCommits:     ${commits.length}`);
console.log(`Bump:        ${bump}${MANUAL_BUMP ? '' : ' (auto-detected)'}`);
console.log(`New version: ${newVersion} → npm tag "${distTag}"${DRY_RUN ? '  [DRY RUN]' : ''}\n`);

// --- 4. Install, lint and build ------------------------------------------------

exec('npm ci', { cwd: PKG_DIR });
exec('npm run lint', { cwd: PKG_DIR });
exec('npm run build', { cwd: PKG_DIR });

// --- 5. Bump version and write the changelog -----------------------------------

const changelogPath = join(PKG_DIR, 'CHANGELOG.md');

function buildChangelogEntry() {
  const sections = [
    ['Breaking Changes', commits.filter((c) => c.breaking)],
    ['Features', commits.filter((c) => !c.breaking && c.type === 'feat')],
    ['Fixes', commits.filter((c) => !c.breaking && ['fix', 'perf'].includes(c.type))],
    ['Other', commits.filter((c) => !c.breaking && !['feat', 'fix', 'perf'].includes(c.type))],
  ];
  const date = new Date().toISOString().slice(0, 10);
  let entry = `## ${newVersion} (${date})\n\n`;
  for (const [title, items] of sections) {
    if (!items.length) continue;
    entry += `### ${title}\n\n${items.map((c) => `- ${c.description} (${c.hash})`).join('\n')}\n\n`;
  }
  return entry;
}

if (DRY_RUN) {
  console.log(`[DRY RUN] Would set ${PKG_DIR}/package.json version to ${newVersion}`);
  if (!IS_PRERELEASE) console.log(`[DRY RUN] CHANGELOG entry:\n\n${buildChangelogEntry()}`);
} else {
  exec(`npm version ${newVersion} --no-git-tag-version`, { cwd: PKG_DIR });
  if (!IS_PRERELEASE) {
    const header = '# Changelog\n\n';
    const existing = existsSync(changelogPath)
      ? readFileSync(changelogPath, 'utf8').replace(/^# Changelog\n+/, '')
      : '';
    writeFileSync(changelogPath, `${header}${buildChangelogEntry()}${existing}`);
    console.log(`✍  Updated ${changelogPath}`);
  }
}

// --- 6. Preflight, then publish ------------------------------------------------

if (DRY_RUN) {
  // package.json is not bumped in a dry run, so only preview the tarball.
  exec('npm pack --dry-run', { cwd: PKG_DIR });
  console.log(`\n[DRY RUN] Would publish ${pkg.name}@${newVersion} with tag "${distTag}"`);
} else {
  exec(`npm publish --dry-run --tag ${distTag}`, { cwd: PKG_DIR });
  // Provenance needs GitHub Actions OIDC; skip it for manual local releases.
  const provenance = process.env.GITHUB_ACTIONS ? '--provenance' : '';
  exec(`npm publish ${provenance} --tag ${distTag}`.replace(/\s+/g, ' '), { cwd: PKG_DIR });
}

// --- 7. Commit, tag and push (only reached after a successful publish) ---------

const tag = `${TAG_PREFIX}${newVersion}`;
const files = [`${PKG_DIR}/package.json`, `${PKG_DIR}/package-lock.json`];
if (!IS_PRERELEASE) files.push(changelogPath);

if (DRY_RUN) {
  console.log(`[DRY RUN] Would commit ${files.join(', ')}${IS_PRERELEASE ? '' : `, tag ${tag},`} and push to main`);
} else {
  exec(`git add ${files.join(' ')}`);
  exec(`git commit -m "chore(react): release ${pkg.name}@${newVersion}"`);
  exec('git push origin HEAD:main');
  if (!IS_PRERELEASE) {
    exec(`git tag ${tag}`);
    exec(`git push origin ${tag}`);
  }
}

console.log(`\n✅  ${DRY_RUN ? 'Dry run complete for' : 'Released'} ${pkg.name}@${newVersion}`);

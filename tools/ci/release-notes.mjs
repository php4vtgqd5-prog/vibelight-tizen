#!/usr/bin/env node
// Print the notes of a GitHub release from the section of CHANGELOG.md for its version:
//
//   node tools/ci/release-notes.mjs 2.0.0 > notes.md
//   node tools/ci/release-notes.mjs 2.0.0 v2.0.0-beta.1 > notes.md   (a pre-release of 2.0.0)
//
// The in-app update dialog shows the list under "## What's Changed:" (see extractReleaseNotes()
// in wasm/platform/index.js), so the entries of every category are listed there as bullets.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'php4vtgqd5-prog/vibelight-tizen';

export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## v${version}`);
  if (start === -1) {
    return null;
  }
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

// The tag defaults to the one of the version, and differs for a pre-release such as v2.0.0-beta.1
export function releaseNotes(changelog, version, tag = `v${version}`) {
  const section = changelogSection(changelog, version);
  if (!section) {
    throw new Error(`CHANGELOG.md has no section for v${version}`);
  }
  const entries = section.filter((line) => line.startsWith('- ')).map((line) => line.trim());
  if (entries.length === 0) {
    throw new Error(`The section of v${version} in CHANGELOG.md has no entries`);
  }
  return [
    `# VibeLight v${version}`,
    '',
    `- Install \`VibeLight.wgt\` on your TV with one of the methods of the [installation guide](https://github.com/${REPOSITORY}#installation).`,
    '- `VibeLight-GameMode.wgt` always asks the TV for Game Mode, for TVs that do not enter it from the app setting.',
    '',
    "## What's Changed:",
    '',
    ...entries,
    '',
    `**Full Changelog**: https://github.com/${REPOSITORY}/blob/${tag}/CHANGELOG.md`,
    '',
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const version = (process.argv[2] || '').replace(/^v/, '');
  if (!version) {
    console.error('Usage: node tools/ci/release-notes.mjs <version> [tag]');
    process.exit(2);
  }
  const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  process.stdout.write(releaseNotes(changelog, version, process.argv[3] || undefined));
}

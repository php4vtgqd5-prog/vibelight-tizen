import test from 'node:test';
import assert from 'node:assert/strict';
import { changelogSection, releaseNotes } from '../../tools/ci/release-notes.mjs';

const CHANGELOG = `# Changelog

## v2.0.0

### Added
- Added Auto-Tune

### Fixed
- Fixed a leak

## v1.17.1

### Fixed
- Fixed something older
`;

test('changelogSection returns the lines of one version', () => {
  assert.deepEqual(changelogSection(CHANGELOG, '2.0.0').filter((line) => line.startsWith('- ')), ['- Added Auto-Tune', '- Fixed a leak']);
  assert.equal(changelogSection(CHANGELOG, '3.0.0'), null);
});

test('releaseNotes lists the entries under the heading the update dialog reads', () => {
  const notes = releaseNotes(CHANGELOG, '2.0.0');
  assert.match(notes, /^# VibeLight v2\.0\.0/);
  assert.match(notes, /## What's Changed:\n\n- Added Auto-Tune\n- Fixed a leak\n\n\*\*Full Changelog\*\*/);
  assert.doesNotMatch(notes, /older/);
});

test('releaseNotes fails for a version without entries', () => {
  assert.throws(() => releaseNotes(CHANGELOG, '9.9.9'), /no section/);
});

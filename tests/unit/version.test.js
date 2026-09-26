'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..', '..');
const read = (file) => readFileSync(join(root, file), 'utf8');

// The release workflow reads the version from res/config.xml, the TV shows it, and npm keeps its own
const widgetVersion = read('res/config.xml').match(/<widget\b[^>]*\bversion="([^"]+)"/)[1];

test('package.json and package-lock.json have the version of the widget', () => {
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(JSON.parse(read('package.json')).version, widgetVersion);
  assert.equal(lock.version, widgetVersion);
  assert.equal(lock.packages[''].version, widgetVersion);
});

test('CHANGELOG.md has a section for the version of the widget', () => {
  assert.ok(read('CHANGELOG.md').split(/\r?\n/).includes(`## v${widgetVersion}`),
    `CHANGELOG.md has no "## v${widgetVersion}" section, which the release notes are written from`);
});

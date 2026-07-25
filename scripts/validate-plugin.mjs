#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillNames = [
  'setup',
  'ios-release',
  'testflight',
  'appstore-screenshots',
  'appstore-info',
  'appstore-release',
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

const [
  codexManifest,
  claudeManifest,
  cursorManifest,
  marketplace,
  packageJson,
  fixtureMarker,
] = await Promise.all([
  readJson('.codex-plugin/plugin.json'),
  readJson('.claude-plugin/plugin.json'),
  readJson('.cursor-plugin/plugin.json'),
  readJson('.claude-plugin/marketplace.json'),
  readJson('package.json'),
  readJson('fixtures/sample-expo-app/.release-fixture.json'),
  ]);

assert.equal(codexManifest.name, 'expo-ios-release');
assert.equal(claudeManifest.name, codexManifest.name);
assert.equal(cursorManifest.name, codexManifest.name);
assert.equal(packageJson.version, codexManifest.version);
assert.equal(claudeManifest.version, codexManifest.version);
assert.equal(cursorManifest.version, codexManifest.version);
assert.equal(marketplace.name, codexManifest.name);
assert.equal(marketplace.plugins[0].name, codexManifest.name);
assert.equal(marketplace.plugins[0].version, codexManifest.version);
assert.equal(codexManifest.skills, './skills/');
assert.equal(claudeManifest.skills, './skills/');
assert.equal(cursorManifest.skills, './skills/');
assert.equal(codexManifest.license, 'MIT');
assert.equal(claudeManifest.license, 'MIT');
assert.equal(cursorManifest.license, 'MIT');
assert.equal(packageJson.license, 'MIT');
assert.equal(
  packageJson.repository.url,
  'https://github.com/884js/expo-ios-release-agent-plugin.git',
);
assert.equal(fixtureMarker.fixtureOnly, true);
assert.equal(fixtureMarker.externalActionsAllowed, false);

for (const skillName of skillNames) {
  const contents = await readFile(
    path.join(root, 'skills', skillName, 'SKILL.md'),
    'utf8',
  );
  assert.match(contents, /^---\n/);
  assert.match(contents, new RegExp(`\\nname: ${skillName}\\n`));
  assert.match(contents, /\ndescription: .+\n/);
}

console.log(
  `plugin.json 3件とSKILL.md ${skillNames.length}件を確認しました。`,
);

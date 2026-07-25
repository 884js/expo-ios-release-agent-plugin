import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(name) {
  return JSON.parse(await readFile(path.join(root, name), 'utf8'));
}

const [marker, appConfig, easConfig, storeConfig] = await Promise.all([
  readJson('.release-fixture.json'),
  readJson('app.json'),
  readJson('eas.json'),
  readJson('store.config.json'),
]);

assert.equal(marker.fixtureOnly, true);
assert.equal(marker.externalActionsAllowed, false);
assert.equal(appConfig.expo.version, storeConfig.apple.version);
assert.equal(appConfig.expo.ios.buildNumber, '42');
assert.match(appConfig.expo.ios.bundleIdentifier, /^com\.example\./);
assert.equal(easConfig.submit.testflight.ios.ascAppId, '0000000000');
assert.equal(
  easConfig.build.testflight.metadataPath,
  './store.config.json',
);

console.log('fixture設定を確認しました。外部操作は無効です。');

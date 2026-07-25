import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(name) {
  return JSON.parse(await readFile(path.join(root, name), 'utf8'));
}

test('バージョンとリリース設定が揃っている', async () => {
  const [appConfig, storeConfig] = await Promise.all([
    readJson('app.json'),
    readJson('store.config.json'),
  ]);

  assert.equal(appConfig.expo.version, '2.4.0');
  assert.equal(storeConfig.apple.version, appConfig.expo.version);
  assert.equal(storeConfig.apple.release.automaticRelease, true);
});

test('実環境へ接続しないサンプル値だけを使う', async () => {
  const [marker, appConfig, easConfig] = await Promise.all([
    readJson('.release-fixture.json'),
    readJson('app.json'),
    readJson('eas.json'),
  ]);

  assert.equal(marker.externalActionsAllowed, false);
  assert.match(appConfig.expo.ios.bundleIdentifier, /^com\.example\./);
  assert.equal(easConfig.submit.testflight.ios.ascAppId, '0000000000');
});

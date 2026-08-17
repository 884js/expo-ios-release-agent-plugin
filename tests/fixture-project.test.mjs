import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'fixtures', 'sample-expo-app');

async function readJson(name) {
  return JSON.parse(await readFile(path.join(fixtureRoot, name), 'utf8'));
}

test('fixtureは外部操作を禁止した架空の設定だけを持つ', async () => {
  const [marker, appConfig, easConfig, storeConfig, screenshotConfig] =
    await Promise.all([
      readJson('.release-fixture.json'),
      readJson('app.json'),
      readJson('eas.json'),
      readJson('store.config.json'),
      readJson('appstore-screenshots.json'),
    ]);

  assert.equal(marker.fixtureOnly, true);
  assert.equal(marker.externalActionsAllowed, false);
  assert.equal(appConfig.expo.version, storeConfig.apple.version);
  assert.match(appConfig.expo.ios.bundleIdentifier, /^com\.example\./);
  assert.equal(easConfig.submit.testflight.ios.ascAppId, '0000000000');
  assert.equal(screenshotConfig.targets[0].displayType, 'IPHONE_69');
});

test('fixture自身の検証コマンドが成功する', async () => {
  for (const script of ['typecheck', 'lint', 'test']) {
    await execFileAsync('npm', ['run', script], {
      cwd: fixtureRoot,
    });
  }
});

test('App Store提出スクリプトもfixtureでは外部接続しない', async () => {
  const scriptPath = path.join(
    root,
    'skills',
    'appstore-release',
    'scripts',
    'appstore-release.mjs',
  );
  const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
    cwd: fixtureRoot,
  });

  assert.match(stdout, /Fixtureモード: 外部操作は無効です/);
  assert.match(stdout, /App Store Connect APIへの接続は行っていません/);
});

test('提出前診断もfixtureでは読み取り専用で実行できる', async () => {
  const scriptPath = path.join(
    root,
    'skills',
    'appstore-preflight',
    'scripts',
    'appstore-preflight.mjs',
  );
  await assert.rejects(
    execFileAsync(process.execPath, [scriptPath], { cwd: fixtureRoot }),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /提出前診断: BLOCKED/);
      assert.match(error.stdout, /App Reviewへ提出できません/);
      assert.match(error.stdout, /Fixtureの値なので実際のApp IDではありません/);
      assert.match(error.stdout, /ローカル値だけでは確定できません/);
      assert.match(error.stdout, /Fixtureのため外部接続せず/);
      assert.match(error.stdout, /読み取り専用/);
      return true;
    },
  );
});

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'appstore-preflight.mjs',
);

async function createWorkspace({
  appVersion = '3.1.0',
  storeVersion = '3.1.0',
  review = {
    firstName: 'Review',
    lastName: 'Contact',
    email: 'review@example.com',
    phone: '+81 3 0000 0000',
    demoRequired: true,
    demoUsername: 'reviewer',
    demoPassword: 'private-password',
  },
  localeInfo = {
    title: '記録ノート',
    description: '毎日の記録を端末内へ安全に保存するアプリです。',
    releaseNotes: '記録画面の操作性を改善しました。',
    supportUrl: 'https://example.com/support',
    privacyPolicyUrl: 'https://example.com/privacy',
  },
  easConfig = {
    build: {
      testflight: {
        distribution: 'store',
        metadataPath: './store.config.json',
      },
    },
    submit: {
      testflight: { ios: { ascAppId: '1234567890' } },
    },
  },
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'preflight-'));
  await Promise.all([
    writeFile(
      path.join(directory, 'app.json'),
      JSON.stringify({
        expo: {
          owner: 'sample-owner',
          slug: 'sample-app',
          version: appVersion,
          ios: {
            bundleIdentifier: 'com.example.sampleapp',
            buildNumber: '18',
          },
        },
      }),
    ),
    writeFile(
      path.join(directory, 'eas.json'),
      JSON.stringify(easConfig),
    ),
    writeFile(
      path.join(directory, 'store.config.json'),
      JSON.stringify({
        configVersion: 0,
        apple: {
          version: storeVersion,
          info: { ja: localeInfo },
          review,
          release: { automaticRelease: false },
        },
      }),
    ),
  ]);
  return directory;
}

async function runScript(workspace, args = []) {
  return execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: workspace,
  });
}

test('ローカル設定を変更せず自動確認と手動確認を分ける', async () => {
  const workspace = await createWorkspace();
  const before = await readFile(
    path.join(workspace, 'store.config.json'),
    'utf8',
  );
  const { stdout } = await runScript(workspace);
  const after = await readFile(
    path.join(workspace, 'store.config.json'),
    'utf8',
  );

  assert.match(stdout, /提出前診断: NEEDS_REVIEW/);
  assert.match(stdout, /PASS \d+ \/ BLOCKED 0 \/ MANUAL \d+/);
  assert.doesNotMatch(stdout, /\[PASS\]/);
  assert.match(stdout, /\[MANUAL\] 申告・契約情報/);
  assert.match(stdout, /読み取り専用/);
  assert.equal(stdout.includes('private-password'), false);
  assert.equal(after, before);

  const { stdout: verboseStdout } = await runScript(workspace, ['--verbose']);
  assert.match(verboseStdout, /\[PASS\] App Storeバージョン/);
  assert.equal(verboseStdout.includes('private-password'), false);
});

test('versionが一致しない場合はBLOCKEDで終了する', async () => {
  const workspace = await createWorkspace({ storeVersion: '3.0.0' });

  await assert.rejects(runScript(workspace), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /提出前診断: BLOCKED/);
    assert.match(error.stdout, /app\.json=3\.1\.0, EAS Metadata=3\.0\.0/);
    return true;
  });
});

test('審査用ログインが必須なのに認証情報がない場合はBLOCKEDにする', async () => {
  const workspace = await createWorkspace({
    review: {
      firstName: 'Review',
      lastName: 'Contact',
      email: 'review@example.com',
      phone: '+81 3 0000 0000',
      demoRequired: true,
    },
  });

  await assert.rejects(runScript(workspace), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /demoRequiredですがログイン情報が不足/);
    return true;
  });
});

test('JSON出力は対象と分類を機械可読で返す', async () => {
  const workspace = await createWorkspace();
  const { stdout } = await runScript(workspace, ['--json']);
  const report = JSON.parse(stdout);

  assert.equal(report.status, 'NEEDS_REVIEW');
  assert.equal(report.version, '3.1.0');
  assert.equal(report.buildNumber, '18');
  assert.equal(
    report.checks.some(
      (check) => check.id === 'compliance' && check.status === 'MANUAL',
    ),
    true,
  );
  assert.equal(stdout.includes('private-password'), false);
});

test('処理済みビルドを確認する場合はbuildプロファイルを必須にしない', async () => {
  const workspace = await createWorkspace({
    review: {
      firstName: 'Review',
      lastName: 'Contact',
      email: 'review@example.com',
      phone: '+81 3 0000 0000',
      demoRequired: false,
    },
    easConfig: {
      submit: {
        testflight: { ios: { ascAppId: '1234567890' } },
      },
    },
  });
  const { stdout } = await runScript(workspace, ['--json']);
  const report = JSON.parse(stdout);

  assert.equal(report.status, 'NEEDS_REVIEW');
  assert.equal(
    report.checks.find((check) => check.id === 'build-profile').status,
    'MANUAL',
  );
  assert.equal(
    report.checks.find((check) => check.id === 'review-account').status,
    'PASS',
  );
});

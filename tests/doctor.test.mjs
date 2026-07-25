import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doctorPath = path.join(root, 'scripts', 'doctor.mjs');

async function createProject({
  includeStore = true,
  appVersion = '2.4.0',
  storeVersion = '2.4.0',
  locale = 'ja',
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'release-doctor-'));
  const writes = [
    writeFile(
      path.join(directory, 'app.json'),
      JSON.stringify({
        expo: {
          owner: 'sample-owner',
          slug: 'sample-journal',
          version: appVersion,
          ios: {
            bundleIdentifier: 'com.example.samplejournal',
            buildNumber: '42',
          },
        },
      }),
    ),
    writeFile(
      path.join(directory, 'eas.json'),
      JSON.stringify({
        build: {
          base: { distribution: 'store' },
          testflight: {
            extends: 'base',
            metadataPath: './store.config.json',
          },
        },
        submit: {
          base: { ios: { ascAppId: '1234567890' } },
          testflight: { extends: 'base' },
        },
      }),
    ),
  ];

  if (includeStore) {
    writes.push(
      writeFile(
        path.join(directory, 'store.config.json'),
        JSON.stringify({
          configVersion: 0,
          apple: {
            version: storeVersion,
            info: {
              [locale]: {
                title: 'Sample Journal',
                releaseNotes: 'Improved the journal view',
              },
            },
          },
        }),
      ),
    );
  }

  await Promise.all(writes);
  return directory;
}

function cleanEnvironment(overrides = {}) {
  const environment = { ...process.env };
  for (const name of [
    'ASC_TOKEN',
    'ASC_ISSUER_ID',
    'ASC_KEY_ID',
    'ASC_PRIVATE_KEY_PATH',
    'ASC_APP_ID',
    'EAS_RELEASE_PROFILE',
    'IOS_RELEASE_LOCALE',
  ]) {
    delete environment[name];
  }

  return {
    ...environment,
    EAS_CLI_PATH: process.execPath,
    ...overrides,
  };
}

async function runDoctor(projectDir, args = [], environment = {}) {
  try {
    const result = await execFileAsync(
      process.execPath,
      [
        doctorPath,
        '--project-dir',
        projectDir,
        '--json',
        ...args,
      ],
      {
        env: cleanEnvironment(environment),
      },
    );
    return { exitCode: 0, report: JSON.parse(result.stdout) };
  } catch (error) {
    return {
      exitCode: error.code,
      report: JSON.parse(error.stdout),
    };
  }
}

test('全設定が揃っていればREADYになる', async () => {
  const project = await createProject();
  const { exitCode, report } = await runDoctor(project, [], {
    ASC_TOKEN: 'test-token',
  });

  assert.equal(exitCode, 0);
  assert.equal(report.status, 'READY');
  assert.equal(report.capability, 'all');
  assert.equal(
    report.checks.some((check) => check.status === 'MISSING'),
    false,
  );
});

test('ファイルがないプロジェクトはNEEDS_SETUPになる', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'release-doctor-empty-'));
  const { exitCode, report } = await runDoctor(project);

  assert.equal(exitCode, 2);
  assert.equal(report.status, 'NEEDS_SETUP');
  assert.equal(
    report.checks.some(
      (check) => check.id === 'app-json' && check.status === 'MISSING',
    ),
    true,
  );
});

test('App Storeバージョンの不一致はBLOCKEDになる', async () => {
  const project = await createProject({ storeVersion: '2.3.9' });
  const { exitCode, report } = await runDoctor(project, [], {
    ASC_TOKEN: 'test-token',
  });

  assert.equal(exitCode, 1);
  assert.equal(report.status, 'BLOCKED');
  assert.equal(
    report.checks.some(
      (check) => check.id === 'version-match' && check.status === 'BLOCKED',
    ),
    true,
  );
});

test('testflight診断ではApp Store情報ファイルを必須にしない', async () => {
  const project = await createProject({ includeStore: false });
  const { exitCode, report } = await runDoctor(project, [
    '--capability',
    'testflight',
  ]);

  assert.equal(exitCode, 0);
  assert.equal(report.status, 'READY');
  assert.equal(
    report.checks.some((check) => check.id === 'appstore-info-file'),
    false,
  );
});

test('appstore-info診断では対象ロケールを確認する', async () => {
  const project = await createProject({ locale: 'en-US' });
  const { exitCode, report } = await runDoctor(project, [
    '--capability',
    'appstore-info',
  ]);

  assert.equal(exitCode, 2);
  assert.equal(report.status, 'NEEDS_SETUP');
  assert.equal(
    report.checks.some(
      (check) => check.id === 'locale' && check.status === 'MISSING',
    ),
    true,
  );
});

test('fixtureは外部操作不可としてBLOCKEDになる', async () => {
  const project = path.join(root, 'fixtures', 'sample-expo-app');
  const { exitCode, report } = await runDoctor(project, [
    '--capability',
    'testflight',
  ]);

  assert.equal(exitCode, 1);
  assert.equal(report.status, 'BLOCKED');
  assert.equal(
    report.checks.some(
      (check) => check.id === 'fixture' && check.status === 'BLOCKED',
    ),
    true,
  );
});

test('App Store Connect環境変数の一部だけがある場合はBLOCKEDになる', async () => {
  const project = await createProject();
  const { exitCode, report } = await runDoctor(
    project,
    ['--capability', 'appstore-release'],
    {
      ASC_KEY_ID: 'KEY1234567',
    },
  );

  assert.equal(exitCode, 1);
  assert.equal(report.status, 'BLOCKED');
  assert.equal(
    report.checks.some(
      (check) => check.id === 'asc-auth' && check.status === 'BLOCKED',
    ),
    true,
  );
});

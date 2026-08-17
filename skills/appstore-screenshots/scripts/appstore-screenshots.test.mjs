import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';

import {
  createMaestroTestArgs,
  ensureSafeWritePath,
  finalizeMaestroOutput,
  inspectPngBuffer,
  loadPlan,
  requiredTargetIssues,
  resolveMetadataLocale,
  validateScreenshotDirectory,
  versionAtLeast,
} from './appstore-screenshots.mjs';

const execFileAsync = promisify(execFile);
const skillRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const pluginRoot = path.resolve(skillRoot, '..', '..');
const fixtureRoot = path.join(pluginRoot, 'fixtures', 'sample-expo-app');
const scriptPath = path.join(
  skillRoot,
  'scripts',
  'appstore-screenshots.mjs',
);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), data.length + 8);
  return chunk;
}

function pngBuffer(width, height, colorType = 2, transparency = false) {
  const channels = colorType === 6 ? 4 : 3;
  const rowLength = width * channels + 1;
  const pixels = Buffer.alloc(rowLength * height);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = colorType;
  const chunks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdrData),
  ];
  if (transparency) {
    chunks.push(pngChunk('tRNS', Buffer.alloc(6)));
  }
  chunks.push(pngChunk('IDAT', deflateSync(pixels)));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

async function createMetadataExportProject() {
  const project = await mkdtemp(
    path.join(os.tmpdir(), 'appstore-screenshots-export-'),
  );
  const flowDirectory = path.join(project, '.maestro');
  const sourceDirectory = path.join(project, 'screenshots');
  await Promise.all([
    mkdir(flowDirectory, { recursive: true }),
    mkdir(sourceDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, 'app.json'),
      JSON.stringify({
        expo: { ios: { bundleIdentifier: 'com.example.metadata' } },
      }),
    ),
    writeFile(
      path.join(flowDirectory, 'capture.yml'),
      'appId: ${APP_ID}\n---\n- setOrientation: PORTRAIT',
    ),
    writeFile(
      path.join(project, 'appstore-screenshots.json'),
      JSON.stringify({
        configVersion: 1,
        targets: [
          {
            id: 'iphone-69-ja',
            displayType: 'IPHONE_69',
            device: 'iPhone 17 Pro Max',
            locale: 'ja_JP',
            orientation: 'portrait',
            flow: '.maestro/capture.yml',
          },
        ],
      }),
    ),
    writeFile(
      path.join(project, 'store.config.json'),
      JSON.stringify({
        configVersion: 0,
        apple: {
          info: {
            ja: {
              title: 'サンプルアプリ',
              screenshots: {
                APP_IPHONE_55: ['store/apple/screenshot/ja/old.png'],
              },
            },
          },
        },
      }),
    ),
    writeFile(
      path.join(sourceDirectory, '01-home.png'),
      pngBuffer(1320, 2868),
    ),
    writeFile(
      path.join(sourceDirectory, '02-create.png'),
      pngBuffer(1320, 2868),
    ),
  ]);
  return { project, sourceDirectory };
}

test('PNGの寸法と透過情報を読み取る', () => {
  assert.deepEqual(inspectPngBuffer(pngBuffer(1320, 2868)), {
    width: 1320,
    height: 2868,
    hasTransparency: false,
  });
  assert.equal(
    inspectPngBuffer(pngBuffer(1320, 2868, 6)).hasTransparency,
    true,
  );
  assert.equal(
    inspectPngBuffer(pngBuffer(1320, 2868, 2, true)).hasTransparency,
    true,
  );
});

test('Maestro CLI 2.3.0以上だけを許可する', () => {
  assert.equal(versionAtLeast([2, 3, 0], [2, 3, 0]), true);
  assert.equal(versionAtLeast([2, 5, 1], [2, 3, 0]), true);
  assert.equal(versionAtLeast([2, 2, 9], [2, 3, 0]), false);
});

test('撮影時にMaestro Driverを再インストールしない', () => {
  assert.deepEqual(
    createMaestroTestArgs({
      deviceId: 'SIMULATOR-UDID',
      bundleIdentifier: 'com.example.capture',
      testOutputDir: 'screenshots/report',
      flowPath: '.maestro/capture.yml',
    }),
    [
      '--device',
      'SIMULATOR-UDID',
      'test',
      '--no-reinstall-driver',
      '-e',
      'APP_ID=com.example.capture',
      '--test-output-dir=screenshots/report',
      '.maestro/capture.yml',
    ],
  );
});

test('撮影ロケールを既存のEAS Metadataロケールへ解決する', () => {
  assert.equal(
    resolveMetadataLocale(
      { id: 'english', locale: 'en_US' },
      { 'en-US': {} },
    ),
    'en-US',
  );
  assert.equal(
    resolveMetadataLocale(
      { id: 'japanese', locale: 'ja_JP' },
      { ja: {}, 'en-US': {} },
    ),
    'ja',
  );
  assert.equal(
    resolveMetadataLocale(
      {
        id: 'explicit',
        locale: 'zh_CN',
        metadataLocale: 'zh-Hans',
      },
      { 'zh-Hans': {}, 'zh-Hant': {} },
    ),
    'zh-Hans',
  );
  assert.throws(
    () =>
      resolveMetadataLocale(
        { id: 'ambiguous', locale: 'zh_CN' },
        { 'zh-Hans': {}, 'zh-Hant': {} },
      ),
    /metadataLocaleを指定してください/,
  );
});

test('6.9インチiPhone用の連番PNGを検証する', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'appstore-screenshots-valid-'),
  );
  await Promise.all([
    writeFile(path.join(directory, '01-home.png'), pngBuffer(1320, 2868)),
    writeFile(path.join(directory, '02-create.png'), pngBuffer(1320, 2868)),
  ]);

  const result = await validateScreenshotDirectory(directory, {
    displayType: 'IPHONE_69',
    orientation: 'portrait',
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.count, 2);
});

test('MaestroレポートからtakeScreenshot画像だけを直下へ整理する', async () => {
  const runDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'appstore-screenshots-maestro-'),
  );
  const reportDirectory = path.join(runDirectory, '.maestro-report');
  const takeScreenshotDirectory = path.join(
    reportDirectory,
    'run',
    'flow',
    'takeScreenshot',
  );
  const diagnosticDirectory = path.join(
    reportDirectory,
    'run',
    'flow',
    'screenshots',
  );
  await Promise.all([
    mkdir(takeScreenshotDirectory, { recursive: true }),
    mkdir(diagnosticDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(takeScreenshotDirectory, '01-home.png'),
      pngBuffer(1320, 2868),
    ),
    writeFile(
      path.join(diagnosticDirectory, 'step-001-launch.png'),
      pngBuffer(1320, 2868),
    ),
    writeFile(path.join(reportDirectory, 'commands.json'), '{}'),
  ]);

  const result = await finalizeMaestroOutput(
    reportDirectory,
    runDirectory,
    {
      displayType: 'IPHONE_69',
      orientation: 'portrait',
    },
  );

  assert.equal(result.status, 'READY');
  assert.equal(result.count, 1);
  assert.deepEqual(
    await readdir(runDirectory),
    ['01-home.png'],
  );
});

test('検証失敗時はMaestroレポートを原因調査用に残す', async () => {
  const runDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'appstore-screenshots-maestro-invalid-'),
  );
  const reportDirectory = path.join(runDirectory, '.maestro-report');
  const takeScreenshotDirectory = path.join(
    reportDirectory,
    'run',
    'flow',
    'takeScreenshot',
  );
  await mkdir(takeScreenshotDirectory, { recursive: true });
  await writeFile(
    path.join(takeScreenshotDirectory, '01-home.png'),
    pngBuffer(1179, 2556),
  );

  await assert.rejects(
    finalizeMaestroOutput(reportDirectory, runDirectory, {
      displayType: 'IPHONE_69',
      orientation: 'portrait',
    }),
    /許可寸法ではありません/,
  );
  assert.deepEqual(
    (await readdir(runDirectory)).sort(),
    ['.maestro-report', '01-home.png'],
  );
});

test('検証対象はディレクトリ直下のPNGだけに限定する', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'appstore-screenshots-direct-'),
  );
  const nestedDirectory = path.join(directory, 'nested');
  await mkdir(nestedDirectory);
  await writeFile(
    path.join(nestedDirectory, '01-home.png'),
    pngBuffer(1320, 2868),
  );

  await assert.rejects(
    validateScreenshotDirectory(directory, {
      displayType: 'IPHONE_69',
      orientation: 'portrait',
    }),
    /現在は0枚です/,
  );
});

test('透過、寸法、欠番をまとめて拒否する', async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'appstore-screenshots-invalid-'),
  );
  await Promise.all([
    writeFile(path.join(directory, '01-home.png'), pngBuffer(1179, 2556)),
    writeFile(path.join(directory, '03-create.png'), pngBuffer(1320, 2868, 6)),
  ]);

  await assert.rejects(
    validateScreenshotDirectory(directory, {
      displayType: 'IPHONE_69',
      orientation: 'portrait',
    }),
    (error) => {
      assert.match(error.message, /掲載順に欠番があります/);
      assert.match(error.message, /透過情報を含めないでください/);
      assert.match(error.message, /許可寸法ではありません/);
      return true;
    },
  );
});

test('CLIから既存のスクリーンショットだけを検証する', async () => {
  const project = await mkdtemp(
    path.join(os.tmpdir(), 'appstore-screenshots-cli-'),
  );
  const flowDirectory = path.join(project, '.maestro');
  const outputDirectory = path.join(project, 'screenshots');
  await Promise.all([
    mkdir(flowDirectory, { recursive: true }),
    mkdir(outputDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      path.join(project, 'app.json'),
      JSON.stringify({
        expo: { ios: { bundleIdentifier: 'com.example.capture' } },
      }),
    ),
    writeFile(
      path.join(flowDirectory, 'capture.yml'),
      'appId: ${APP_ID}\n---\n- setOrientation: PORTRAIT',
    ),
    writeFile(
      path.join(project, 'appstore-screenshots.json'),
      JSON.stringify({
        configVersion: 1,
        targets: [
          {
            id: 'iphone-69-ja',
            displayType: 'IPHONE_69',
            device: 'iPhone 17 Pro Max',
            locale: 'ja_JP',
            orientation: 'portrait',
            flow: '.maestro/capture.yml',
          },
        ],
      }),
    ),
    writeFile(
      path.join(outputDirectory, '01-home.png'),
      pngBuffer(1320, 2868),
    ),
  ]);

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    '--project-dir',
    project,
    '--validate',
    '--target',
    'iphone-69-ja',
    '--output-dir',
    'screenshots',
  ]);

  assert.match(stdout, /状態: READY/);
  assert.match(stdout, /枚数: 1/);
});

test('検証済み画像をEAS Metadata用に世代保存して設定を更新する', async () => {
  const { project, sourceDirectory } =
    await createMetadataExportProject();

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    '--project-dir',
    project,
    '--export-eas-metadata',
    '--target',
    'iphone-69-ja',
    '--output-dir',
    'screenshots',
    '--confirm',
    'iphone-69-ja',
    '--json',
  ]);

  const report = JSON.parse(stdout);
  assert.equal(report.status, 'EXPORTED');
  assert.equal(report.metadataLocale, 'ja');
  assert.equal(report.easDisplayType, 'APP_IPHONE_67');
  assert.equal(report.count, 2);
  assert.deepEqual(await readdir(sourceDirectory), [
    '01-home.png',
    '02-create.png',
  ]);
  assert.deepEqual(await readdir(report.exportDir), [
    '01-home.png',
    '02-create.png',
  ]);

  const metadata = JSON.parse(
    await readFile(path.join(project, 'store.config.json'), 'utf8'),
  );
  assert.equal(metadata.apple.info.ja.title, 'サンプルアプリ');
  assert.deepEqual(metadata.apple.info.ja.screenshots.APP_IPHONE_55, [
    'store/apple/screenshot/ja/old.png',
  ]);
  assert.deepEqual(
    metadata.apple.info.ja.screenshots.APP_IPHONE_67,
    report.files.map((file) => file.path),
  );
  assert.ok(
    report.files.every((file) =>
      file.path.startsWith(
        'store/apple/screenshot/ja/APP_IPHONE_67/',
      ),
    ),
  );
});

test('確認文字列なしではEAS Metadata設定を変更しない', async () => {
  const { project } = await createMetadataExportProject();
  const metadataPath = path.join(project, 'store.config.json');
  const before = await readFile(metadataPath, 'utf8');

  await assert.rejects(
    execFileAsync(process.execPath, [
      scriptPath,
      '--project-dir',
      project,
      '--export-eas-metadata',
      '--target',
      'iphone-69-ja',
      '--output-dir',
      'screenshots',
    ]),
    /--confirm iphone-69-ja/,
  );

  assert.equal(await readFile(metadataPath, 'utf8'), before);
});

test('fixtureの撮影設定を読み取る', async () => {
  const plan = await loadPlan({
    projectDir: fixtureRoot,
    config: 'appstore-screenshots.json',
  });

  assert.equal(plan.fixtureOnly, true);
  assert.equal(plan.targets[0].id, 'iphone-69-ja');
  assert.equal(plan.bundleIdentifier, 'com.example.releaselabjournal');
});

test('iPad対応アプリでは13インチiPad用targetを要求する', () => {
  assert.deepEqual(
    requiredTargetIssues({
      supportsTablet: true,
      targets: [{ displayType: 'IPHONE_69' }],
    }),
    ['13インチiPad用target'],
  );
});

test('fixtureでは外部操作を行わず撮影計画だけを表示する', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [scriptPath, '--project-dir', fixtureRoot],
  );

  assert.match(stdout, /状態: BLOCKED/);
  assert.match(stdout, /Fixtureモード: Simulator操作と撮影は無効です/);
  assert.match(stdout, /対象: iphone-69-ja/);
});

test('fixtureではcaptureを明示してもMaestroを起動しない', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      scriptPath,
      '--project-dir',
      fixtureRoot,
      '--capture',
      '--target',
      'iphone-69-ja',
      '--confirm',
      'iphone-69-ja',
    ]),
    /FixtureモードではSimulator操作とスクリーンショット撮影を行いません/,
  );
});

test('fixtureではEAS Metadata用書き出しを行わない', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      scriptPath,
      '--project-dir',
      fixtureRoot,
      '--export-eas-metadata',
      '--target',
      'iphone-69-ja',
      '--output-dir',
      'screenshots',
      '--confirm',
      'iphone-69-ja',
    ]),
    /FixtureモードではEAS Metadata用ファイルを書き出しません/,
  );
});

test('出力先がプロジェクト外を指す設定を拒否する', async () => {
  const project = await mkdtemp(
    path.join(os.tmpdir(), 'appstore-screenshots-project-'),
  );
  await mkdir(path.join(project, '.maestro'), { recursive: true });
  await Promise.all([
    writeFile(
      path.join(project, 'app.json'),
      JSON.stringify({
        expo: { ios: { bundleIdentifier: 'com.example.capture' } },
      }),
    ),
    writeFile(
      path.join(project, '.maestro', 'capture.yml'),
      'appId: ${APP_ID}\n---\n- setOrientation: PORTRAIT',
    ),
    writeFile(
      path.join(project, 'appstore-screenshots.json'),
      JSON.stringify({
        configVersion: 1,
        outputDir: '../outside',
        targets: [
          {
            id: 'iphone-69-ja',
            displayType: 'IPHONE_69',
            device: 'iPhone 17 Pro Max',
            locale: 'ja_JP',
            orientation: 'portrait',
            flow: '.maestro/capture.yml',
          },
        ],
      }),
    ),
  ]);

  await assert.rejects(
    loadPlan({
      projectDir: project,
      config: 'appstore-screenshots.json',
    }),
    /出力先はプロジェクト内を指定してください/,
  );
});

test('出力先に含まれるシンボリックリンクを拒否する', async () => {
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), 'appstore-screenshots-link-'),
  );
  const project = path.join(workspace, 'project');
  const external = path.join(workspace, 'external');
  await Promise.all([
    mkdir(project, { recursive: true }),
    mkdir(external, { recursive: true }),
  ]);
  const output = path.join(project, 'screenshots');
  await symlink(external, output, 'dir');

  await assert.rejects(
    ensureSafeWritePath(project, output),
    /出力先にシンボリックリンクがあります/,
  );
});

test('プロジェクト外を参照するFlowを拒否する', async () => {
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), 'appstore-screenshots-flow-link-'),
  );
  const project = path.join(workspace, 'project');
  const flowDirectory = path.join(project, '.maestro');
  const externalFlow = path.join(workspace, 'capture.yml');
  await mkdir(flowDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(project, 'app.json'),
      JSON.stringify({
        expo: { ios: { bundleIdentifier: 'com.example.capture' } },
      }),
    ),
    writeFile(
      path.join(project, 'appstore-screenshots.json'),
      JSON.stringify({
        configVersion: 1,
        targets: [
          {
            id: 'iphone-69-ja',
            displayType: 'IPHONE_69',
            device: 'iPhone 17 Pro Max',
            locale: 'ja_JP',
            orientation: 'portrait',
            flow: '.maestro/capture.yml',
          },
        ],
      }),
    ),
    writeFile(
      externalFlow,
      'appId: ${APP_ID}\n---\n- setOrientation: PORTRAIT',
    ),
  ]);
  await symlink(externalFlow, path.join(flowDirectory, 'capture.yml'));

  await assert.rejects(
    loadPlan({
      projectDir: project,
      config: 'appstore-screenshots.json',
    }),
    /Flowはプロジェクト内を指定してください/,
  );
});

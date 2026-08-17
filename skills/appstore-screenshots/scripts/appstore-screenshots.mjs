#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const APPLE_SPEC_CHECKED_AT = '2026-07-25';
const MINIMUM_MAESTRO_VERSION = [2, 3, 0];
const EAS_DISPLAY_TYPES = {
  IPHONE_69: 'APP_IPHONE_67',
  IPAD_13: 'APP_IPAD_PRO_3GEN_129',
};
const DISPLAY_TYPES = {
  IPHONE_69: {
    label: '6.9インチiPhone',
    portraitSizes: [
      [1260, 2736],
      [1290, 2796],
      [1320, 2868],
    ],
  },
  IPAD_13: {
    label: '13インチiPad',
    portraitSizes: [
      [2064, 2752],
      [2048, 2732],
    ],
  },
};

function printHelp() {
  console.log(`Usage:
  node appstore-screenshots.mjs --check
  node appstore-screenshots.mjs --capture --target ID [--device UDID] --confirm ID
  node appstore-screenshots.mjs --validate --target ID --output-dir PATH
  node appstore-screenshots.mjs --export-eas-metadata --target ID --output-dir PATH --confirm ID

Options:
  --check                依存関係と撮影設定を読み取り専用で確認する
  --capture              Maestroで撮影し、生成画像を検証する
  --validate             既存の撮影ディレクトリだけを検証する
  --export-eas-metadata  検証済み画像をEAS Metadata用にローカル書き出しする
  --project-dir          Expoプロジェクトのルート。既定は現在のディレクトリ
  --config               撮影設定。既定はappstore-screenshots.json
  --metadata-config      EAS Metadata設定。既定はstore.config.json
  --target               appstore-screenshots.json内の対象ID
  --device               起動済みiOS SimulatorのUDID
  --output-dir           検証または書き出すプロジェクト内ディレクトリ
  --confirm              --captureまたは書き出し対象の確認文字列
  --json                 JSONで結果を表示する
  --help                 このヘルプを表示する`);
}

export function parseArgs(argv) {
  const options = {
    action: 'check',
    projectDir: process.cwd(),
    config: 'appstore-screenshots.json',
    metadataConfig: 'store.config.json',
    targetId: null,
    deviceId: null,
    outputDir: null,
    confirm: null,
    json: false,
  };
  let explicitAction = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (
      [
        '--check',
        '--capture',
        '--validate',
        '--export-eas-metadata',
      ].includes(arg)
    ) {
      const action = arg.slice(2);
      if (explicitAction && explicitAction !== action) {
        throw new Error('実行モードは1つだけ指定してください。');
      }
      explicitAction = action;
      options.action = action;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help') {
      printHelp();
      return null;
    } else if (
      [
        '--project-dir',
        '--config',
        '--metadata-config',
        '--target',
        '--device',
        '--output-dir',
        '--confirm',
      ].includes(arg)
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} の値が必要です。`);
      }
      index += 1;
      if (arg === '--project-dir') options.projectDir = value;
      if (arg === '--config') options.config = value;
      if (arg === '--metadata-config') options.metadataConfig = value;
      if (arg === '--target') options.targetId = value;
      if (arg === '--device') options.deviceId = value;
      if (arg === '--output-dir') options.outputDir = value;
      if (arg === '--confirm') options.confirm = value;
    } else {
      throw new Error(`不明なオプションです: ${arg}`);
    }
  }

  options.projectDir = path.resolve(options.projectDir);
  return options;
}

function isWithinDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function resolveProjectPath(projectDir, candidate, label) {
  const resolved = path.resolve(projectDir, candidate);
  if (!isWithinDirectory(projectDir, resolved)) {
    throw new Error(`${label}はプロジェクト内を指定してください: ${candidate}`);
  }
  return resolved;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${label}が見つかりません: ${filePath}`);
    }
    throw new Error(`${label}を読み込めません: ${error.message}`);
  }
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function validateTarget(target, seenIds) {
  if (!target || typeof target !== 'object') {
    throw new Error('targetsにはオブジェクトを指定してください。');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(target.id ?? '')) {
    throw new Error(`target.idが不正です: ${target.id ?? '未設定'}`);
  }
  if (seenIds.has(target.id)) {
    throw new Error(`target.idが重複しています: ${target.id}`);
  }
  seenIds.add(target.id);
  if (!DISPLAY_TYPES[target.displayType]) {
    throw new Error(`未対応のdisplayTypeです: ${target.displayType}`);
  }
  if (!target.device || typeof target.device !== 'string') {
    throw new Error(`${target.id}.deviceが必要です。`);
  }
  if (!/^[a-z]{2}_[A-Z]{2}$/.test(target.locale ?? '')) {
    throw new Error(`${target.id}.localeはja_JP形式で指定してください。`);
  }
  if (!['portrait', 'landscape'].includes(target.orientation)) {
    throw new Error(
      `${target.id}.orientationはportraitまたはlandscapeを指定してください。`,
    );
  }
  if (!target.flow || typeof target.flow !== 'string') {
    throw new Error(`${target.id}.flowが必要です。`);
  }
  if (
    target.metadataLocale !== undefined &&
    (typeof target.metadataLocale !== 'string' ||
      !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(target.metadataLocale))
  ) {
    throw new Error(`${target.id}.metadataLocaleが不正です。`);
  }
}

export async function loadPlan(options) {
  const projectDir = await realpath(path.resolve(options.projectDir));
  const configPath = resolveProjectPath(
    projectDir,
    options.config,
    '撮影設定',
  );
  const [appConfig, config, fixture] = await Promise.all([
    readJson(path.join(projectDir, 'app.json'), 'app.json'),
    readJson(configPath, '撮影設定'),
    readOptionalJson(path.join(projectDir, '.release-fixture.json')),
  ]);

  const bundleIdentifier = appConfig?.expo?.ios?.bundleIdentifier;
  const supportsTablet = appConfig?.expo?.ios?.supportsTablet === true;
  if (!bundleIdentifier) {
    throw new Error('app.jsonのexpo.ios.bundleIdentifierが必要です。');
  }
  if (config.configVersion !== 1) {
    throw new Error(
      `未対応のconfigVersionです: ${config.configVersion ?? '未設定'}`,
    );
  }
  if (!Array.isArray(config.targets) || config.targets.length === 0) {
    throw new Error('targetsを1件以上設定してください。');
  }

  const seenIds = new Set();
  for (const target of config.targets) validateTarget(target, seenIds);

  const outputRoot = resolveProjectPath(
    projectDir,
    config.outputDir ?? 'app-store-screenshots',
    '出力先',
  );
  const targets = await Promise.all(
    config.targets.map(async (target) => {
      const flowPath = resolveProjectPath(projectDir, target.flow, 'Flow');
      let flowContents;
      let resolvedFlowPath;
      try {
        await access(flowPath);
        resolvedFlowPath = await realpath(flowPath);
      } catch {
        throw new Error(`${target.id}のFlowが見つかりません: ${target.flow}`);
      }
      if (!isWithinDirectory(projectDir, resolvedFlowPath)) {
        throw new Error(
          `${target.id}のFlowはプロジェクト内を指定してください: ${target.flow}`,
        );
      }
      flowContents = await readFile(resolvedFlowPath, 'utf8');
      const expectedOrientations =
        target.orientation === 'portrait'
          ? ['PORTRAIT']
          : ['LANDSCAPE_LEFT', 'LANDSCAPE_RIGHT'];
      const orientationPattern = new RegExp(
        `^\\s*-\\s*setOrientation:\\s*(${expectedOrientations.join('|')})\\s*$`,
        'mi',
      );
      if (!orientationPattern.test(flowContents)) {
        throw new Error(
          `${target.id}のFlowに${expectedOrientations.join('または')}のsetOrientationが必要です。`,
        );
      }
      return {
        ...target,
        flowPath: resolvedFlowPath,
        outputRoot: path.join(
          outputRoot,
          target.locale,
          target.displayType.toLowerCase(),
        ),
      };
    }),
  );

  return {
    projectDir,
    configPath,
    bundleIdentifier,
    supportsTablet,
    fixtureOnly: fixture?.externalActionsAllowed === false,
    targets,
  };
}

export function requiredTargetIssues(plan) {
  const issues = [];
  if (!plan.targets.some(({ displayType }) => displayType === 'IPHONE_69')) {
    issues.push('6.9インチiPhone用target');
  }
  if (
    plan.supportsTablet &&
    !plan.targets.some(({ displayType }) => displayType === 'IPAD_13')
  ) {
    issues.push('13インチiPad用target');
  }
  return issues;
}

function selectTarget(plan, targetId) {
  if (!targetId && plan.targets.length === 1) return plan.targets[0];
  if (!targetId) {
    throw new Error(
      `--targetが必要です。候補: ${plan.targets.map(({ id }) => id).join(', ')}`,
    );
  }
  const target = plan.targets.find(({ id }) => id === targetId);
  if (!target) {
    throw new Error(
      `targetが見つかりません: ${targetId}。候補: ${plan.targets
        .map(({ id }) => id)
        .join(', ')}`,
    );
  }
  return target;
}

async function findExecutable(name) {
  try {
    const { stdout } = await execFileAsync('which', [name]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export function versionAtLeast(version, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    const current = version[index] ?? 0;
    if (current > minimum[index]) return true;
    if (current < minimum[index]) return false;
  }
  return true;
}

export function createMaestroTestArgs({
  deviceId,
  bundleIdentifier,
  testOutputDir,
  flowPath,
}) {
  return [
    '--device',
    deviceId,
    'test',
    '--no-reinstall-driver',
    '-e',
    `APP_ID=${bundleIdentifier}`,
    `--test-output-dir=${testOutputDir}`,
    flowPath,
  ];
}

async function readMaestroVersion(maestroPath) {
  const { stdout, stderr } = await execFileAsync(maestroPath, ['--version']);
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(`${stdout}\n${stderr}`);
  if (!match) throw new Error('Maestro CLIのバージョンを確認できません。');
  return {
    text: match[0],
    parts: match.slice(1).map(Number),
  };
}

async function collectPngFilesRecursively(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
        files.push(entryPath);
      }
    }
  }
  await visit(directory);
  return files.sort((left, right) => left.localeCompare(right));
}

async function collectPngFiles(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() && entry.name.toLowerCase().endsWith('.png'),
    )
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export async function finalizeMaestroOutput(
  maestroOutputDirectory,
  runDirectory,
  target,
) {
  const relativeReportPath = path.relative(
    runDirectory,
    maestroOutputDirectory,
  );
  if (
    !relativeReportPath ||
    relativeReportPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeReportPath)
  ) {
    throw new Error('Maestro出力先は実行ディレクトリ内に指定してください。');
  }

  const screenshots = (
    await collectPngFilesRecursively(maestroOutputDirectory)
  ).filter((filePath) =>
    filePath.split(path.sep).includes('takeScreenshot'),
  );
  if (screenshots.length === 0) {
    throw new Error('MaestroのtakeScreenshot画像が見つかりません。');
  }

  const names = screenshots.map((filePath) => path.basename(filePath));
  if (new Set(names).size !== names.length) {
    throw new Error('Maestroのスクリーンショット名が重複しています。');
  }

  for (const screenshot of screenshots) {
    await copyFile(
      screenshot,
      path.join(runDirectory, path.basename(screenshot)),
    );
  }

  const result = await validateScreenshotDirectory(runDirectory, target);
  await rm(maestroOutputDirectory, { recursive: true });
  return result;
}

export function inspectPngBuffer(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error('PNGとして読み込めません。');
  }

  let offset = 8;
  let width = null;
  let height = null;
  let colorType = null;
  let hasTransparencyChunk = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const nextOffset = dataStart + length + 4;
    if (nextOffset > buffer.length) {
      throw new Error('PNGチャンクが壊れています。');
    }
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('PNGのIHDRが不正です。');
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      colorType = buffer[dataStart + 9];
    }
    if (type === 'tRNS') hasTransparencyChunk = true;
    offset = nextOffset;
    if (type === 'IEND') break;
  }

  if (!width || !height || colorType === null) {
    throw new Error('PNGのIHDRが見つかりません。');
  }

  return {
    width,
    height,
    hasTransparency:
      colorType === 4 || colorType === 6 || hasTransparencyChunk,
  };
}

async function inspectPngFile(filePath) {
  const parsed = inspectPngBuffer(await readFile(filePath));
  let stdout;
  try {
    ({ stdout } = await execFileAsync('/usr/bin/sips', [
      '-g',
      'pixelWidth',
      '-g',
      'pixelHeight',
      '-g',
      'hasAlpha',
      filePath,
    ]));
  } catch {
    throw new Error('macOSで画像をデコードできません。');
  }
  const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1]);
  const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1]);
  const hasAlpha = /hasAlpha:\s*(yes|true)/i.test(stdout);
  if (
    !width ||
    !height ||
    width !== parsed.width ||
    height !== parsed.height
  ) {
    throw new Error('PNGの実データとヘッダーが一致しません。');
  }
  return {
    width,
    height,
    hasTransparency: parsed.hasTransparency || hasAlpha,
  };
}

function acceptedSize(target, width, height) {
  const sizes = DISPLAY_TYPES[target.displayType].portraitSizes;
  return sizes.some(([portraitWidth, portraitHeight]) =>
    target.orientation === 'portrait'
      ? width === portraitWidth && height === portraitHeight
      : width === portraitHeight && height === portraitWidth,
  );
}

export async function validateScreenshotDirectory(directory, target) {
  const pngFiles = await collectPngFiles(directory);
  const errors = [];
  if (pngFiles.length < 1 || pngFiles.length > 10) {
    errors.push(`枚数は1〜10枚にしてください。現在は${pngFiles.length}枚です。`);
  }

  const numberedFiles = pngFiles.map((filePath) => {
    const fileName = path.basename(filePath);
    const match = /^(0[1-9]|10)-[A-Za-z0-9][A-Za-z0-9_-]*\.png$/.exec(
      fileName,
    );
    if (!match) {
      errors.push(
        `ファイル名は01-name.pngから10-name.pngの形式にしてください: ${fileName}`,
      );
      return { filePath, fileName, order: null };
    }
    return { filePath, fileName, order: Number(match[1]) };
  });

  const validOrders = numberedFiles
    .map(({ order }) => order)
    .filter((order) => order !== null)
    .sort((left, right) => left - right);
  validOrders.forEach((order, index) => {
    if (order !== index + 1) {
      errors.push('スクリーンショットの掲載順に欠番があります。');
    }
  });

  const files = [];
  for (const { filePath, fileName } of numberedFiles) {
    try {
      const image = await inspectPngFile(filePath);
      if (image.hasTransparency) {
        errors.push(`透過情報を含めないでください: ${fileName}`);
      }
      if (!acceptedSize(target, image.width, image.height)) {
        errors.push(
          `${DISPLAY_TYPES[target.displayType].label}の許可寸法ではありません: ${fileName} (${image.width}x${image.height})`,
        );
      }
      files.push({ name: fileName, width: image.width, height: image.height });
    } catch (error) {
      errors.push(`${fileName}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `スクリーンショットを検証できません:\n${[
        ...new Set(errors),
      ]
        .map((error) => `- ${error}`)
        .join('\n')}`,
    );
  }

  return {
    status: 'READY',
    displayType: target.displayType,
    orientation: target.orientation,
    count: files.length,
    files,
    specificationCheckedAt: APPLE_SPEC_CHECKED_AT,
  };
}

export function resolveMetadataLocale(target, appleInfo) {
  if (!appleInfo || typeof appleInfo !== 'object' || Array.isArray(appleInfo)) {
    throw new Error('store.config.jsonのapple.infoが必要です。');
  }
  const locales = Object.keys(appleInfo);
  const findCaseInsensitive = (candidate) =>
    locales.filter(
      (locale) => locale.toLowerCase() === candidate.toLowerCase(),
    );

  if (target.metadataLocale) {
    const matches = findCaseInsensitive(target.metadataLocale);
    if (matches.length !== 1) {
      throw new Error(
        `${target.id}.metadataLocaleに対応するapple.infoが見つかりません: ${target.metadataLocale}`,
      );
    }
    return matches[0];
  }

  const normalized = target.locale.replace('_', '-');
  const exactMatches = findCaseInsensitive(normalized);
  if (exactMatches.length === 1) return exactMatches[0];

  const language = normalized.split('-')[0].toLowerCase();
  const languageMatches = locales.filter(
    (locale) => locale.split('-')[0].toLowerCase() === language,
  );
  if (languageMatches.length === 1) return languageMatches[0];

  throw new Error(
    `${target.id}.metadataLocaleを指定してください。apple.info候補: ${
      locales.join(', ') || 'なし'
    }`,
  );
}

async function listBootedDevices(xcrunPath) {
  const { stdout } = await execFileAsync(
    xcrunPath,
    ['simctl', 'list', 'devices', 'booted', '--json'],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout);
  return Object.values(result.devices ?? {})
    .flat()
    .filter(
      (device) => device.state === 'Booted' && device.isAvailable !== false,
    );
}

async function listDeviceTypeNames(xcrunPath) {
  const { stdout } = await execFileAsync(
    xcrunPath,
    ['simctl', 'list', 'devicetypes', '--json'],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout);
  return new Set((result.devicetypes ?? []).map(({ name }) => name));
}

export async function ensureSafeWritePath(projectDir, candidate) {
  const relative = path.relative(projectDir, candidate);
  let current = projectDir;
  for (const segment of relative.split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(`出力先にシンボリックリンクがあります: ${current}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

function chooseDevice(devices, target, deviceId) {
  if (deviceId) {
    const selected = devices.find(({ udid }) => udid === deviceId);
    if (!selected) {
      throw new Error(`起動済みSimulatorにUDIDが見つかりません: ${deviceId}`);
    }
    if (selected.name !== target.device) {
      throw new Error(
        `Simulatorの機種が設定と異なります: ${selected.name} / ${target.device}`,
      );
    }
    return selected;
  }

  const candidates = devices.filter(({ name }) => name === target.device);
  if (candidates.length === 0) {
    throw new Error(
      `${target.device}のSimulatorを起動し、--deviceでUDIDを指定してください。`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `${target.device}が複数起動しています。--deviceでUDIDを指定してください。`,
    );
  }
  return candidates[0];
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace('.', '-');
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`状態: ${result.status}`);
  if (result.message) console.log(result.message);
  if (result.outputDir) console.log(`出力先: ${result.outputDir}`);
  if (result.exportDir) console.log(`EAS Metadata画像: ${result.exportDir}`);
  if (result.metadataConfig) {
    console.log(`EAS Metadata設定: ${result.metadataConfig}`);
  }
  if (result.metadataLocale) {
    console.log(`Metadataロケール: ${result.metadataLocale}`);
  }
  if (result.easDisplayType) {
    console.log(`EAS表示タイプ: ${result.easDisplayType}`);
  }
  if (result.count !== undefined) console.log(`枚数: ${result.count}`);
  for (const target of result.targets ?? []) {
    console.log(
      `対象: ${target.id} / ${target.device} / ${target.locale} / ${target.displayType}`,
    );
  }
  for (const file of result.files ?? []) {
    console.log(`画像: ${file.name} (${file.width}x${file.height})`);
  }
  console.log(`Apple仕様確認日: ${APPLE_SPEC_CHECKED_AT}`);
}

async function runCheck(options) {
  const plan = await loadPlan(options);
  const [xcrunPath, maestroPath] = plan.fixtureOnly
    ? [null, null]
    : await Promise.all([
        findExecutable('xcrun'),
        findExecutable('maestro'),
      ]);
  const missing = [];
  let maestroVersion = null;
  if (!plan.fixtureOnly) {
    if (process.platform !== 'darwin') missing.push('macOS');
    if (!xcrunPath) missing.push('Xcode Command Line Tools');
    if (!maestroPath) {
      missing.push('Maestro CLI 2.3.0以上');
    } else {
      try {
        maestroVersion = await readMaestroVersion(maestroPath);
        if (
          !versionAtLeast(maestroVersion.parts, MINIMUM_MAESTRO_VERSION)
        ) {
          missing.push('Maestro CLI 2.3.0以上');
        }
      } catch {
        missing.push('Maestro CLI 2.3.0以上');
      }
    }
    missing.push(...requiredTargetIssues(plan));
    if (xcrunPath) {
      try {
        const deviceTypeNames = await listDeviceTypeNames(xcrunPath);
        for (const { device } of plan.targets) {
          if (!deviceTypeNames.has(device)) {
            missing.push(`Simulator機種 ${device}`);
          }
        }
      } catch {
        missing.push('iOS Simulator');
      }
    }
  }

  const result = {
    status: plan.fixtureOnly
      ? 'BLOCKED'
      : missing.length > 0
        ? 'NEEDS_SETUP'
        : 'READY',
    message: plan.fixtureOnly
      ? 'Fixtureモード: Simulator操作と撮影は無効です。'
      : missing.length > 0
        ? `不足しています: ${missing.join(', ')}`
        : '撮影設定と必須ツールを確認しました。',
    bundleIdentifier: plan.bundleIdentifier,
    supportsTablet: plan.supportsTablet,
    maestroVersion: maestroVersion?.text ?? null,
    targets: plan.targets.map(
      ({ id, device, locale, displayType, orientation, flowPath }) => ({
        id,
        device,
        locale,
        displayType,
        orientation,
        flow: path.relative(plan.projectDir, flowPath),
      }),
    ),
    specificationCheckedAt: APPLE_SPEC_CHECKED_AT,
  };
  printResult(result, options.json);
  return result;
}

async function runValidate(options) {
  if (!options.outputDir) {
    throw new Error('--validateには--output-dirが必要です。');
  }
  const plan = await loadPlan(options);
  const target = selectTarget(plan, options.targetId);
  const outputDir = resolveProjectPath(
    plan.projectDir,
    options.outputDir,
    '検証対象',
  );
  const result = await validateScreenshotDirectory(outputDir, target);
  const report = { ...result, outputDir };
  printResult(report, options.json);
  return report;
}

function toProjectRelativePath(projectDir, filePath) {
  return path.relative(projectDir, filePath).split(path.sep).join('/');
}

async function runExportEasMetadata(options) {
  if (!options.outputDir) {
    throw new Error('--export-eas-metadataには--output-dirが必要です。');
  }
  const plan = await loadPlan(options);
  const target = selectTarget(plan, options.targetId);
  if (plan.fixtureOnly) {
    throw new Error(
      'FixtureモードではEAS Metadata用ファイルを書き出しません。',
    );
  }
  if (options.confirm !== target.id) {
    throw new Error(
      `EAS Metadata用書き出しには --confirm ${target.id} を指定してください。`,
    );
  }

  const sourceDir = resolveProjectPath(
    plan.projectDir,
    options.outputDir,
    '書き出し元',
  );
  await ensureSafeWritePath(plan.projectDir, sourceDir);
  const resolvedSourceDir = await realpath(sourceDir).catch(() => {
    throw new Error(`書き出し元が見つかりません: ${sourceDir}`);
  });
  if (!isWithinDirectory(plan.projectDir, resolvedSourceDir)) {
    throw new Error('書き出し元はプロジェクト内を指定してください。');
  }
  const validation = await validateScreenshotDirectory(
    resolvedSourceDir,
    target,
  );

  const metadataConfig = resolveProjectPath(
    plan.projectDir,
    options.metadataConfig,
    'EAS Metadata設定',
  );
  await ensureSafeWritePath(plan.projectDir, metadataConfig);
  const metadata = await readJson(metadataConfig, 'EAS Metadata設定');
  const appleInfo = metadata?.apple?.info;
  const metadataLocale = resolveMetadataLocale(target, appleInfo);
  if (
    !appleInfo[metadataLocale] ||
    typeof appleInfo[metadataLocale] !== 'object' ||
    Array.isArray(appleInfo[metadataLocale])
  ) {
    throw new Error(`apple.info.${metadataLocale}が不正です。`);
  }
  const existingScreenshots = appleInfo[metadataLocale].screenshots;
  if (
    existingScreenshots !== undefined &&
    (typeof existingScreenshots !== 'object' ||
      existingScreenshots === null ||
      Array.isArray(existingScreenshots))
  ) {
    throw new Error(`apple.info.${metadataLocale}.screenshotsが不正です。`);
  }

  const easDisplayType = EAS_DISPLAY_TYPES[target.displayType];
  const exportRoot = resolveProjectPath(
    plan.projectDir,
    path.join(
      'store',
      'apple',
      'screenshot',
      metadataLocale,
      easDisplayType,
    ),
    'EAS Metadata画像出力先',
  );
  const exportDir = path.join(exportRoot, timestamp());
  await ensureSafeWritePath(plan.projectDir, exportDir);
  await mkdir(exportRoot, { recursive: true });
  await mkdir(exportDir);

  const exportedFiles = [];
  for (const file of validation.files) {
    const destination = path.join(exportDir, file.name);
    await copyFile(path.join(resolvedSourceDir, file.name), destination);
    exportedFiles.push({
      ...file,
      path: toProjectRelativePath(plan.projectDir, destination),
    });
  }

  appleInfo[metadataLocale].screenshots = {
    ...(existingScreenshots ?? {}),
    [easDisplayType]: exportedFiles.map((file) => file.path),
  };
  const temporaryConfig = `${metadataConfig}.${timestamp()}.tmp`;
  try {
    await writeFile(
      temporaryConfig,
      `${JSON.stringify(metadata, null, 2)}\n`,
      { flag: 'wx' },
    );
    await rename(temporaryConfig, metadataConfig);
  } finally {
    await rm(temporaryConfig, { force: true });
  }

  const report = {
    status: 'EXPORTED',
    target: target.id,
    sourceDir: resolvedSourceDir,
    exportDir,
    metadataConfig,
    metadataLocale,
    easDisplayType,
    count: exportedFiles.length,
    files: exportedFiles,
    specificationCheckedAt: APPLE_SPEC_CHECKED_AT,
  };
  printResult(report, options.json);
  return report;
}

async function runCapture(options) {
  const plan = await loadPlan(options);
  const target = selectTarget(plan, options.targetId);
  if (plan.fixtureOnly) {
    throw new Error(
      'FixtureモードではSimulator操作とスクリーンショット撮影を行いません。',
    );
  }
  if (options.confirm !== target.id) {
    throw new Error(
      `撮影には --confirm ${target.id} を指定してください。`,
    );
  }

  const [xcrunPath, maestroPath] = await Promise.all([
    findExecutable('xcrun'),
    findExecutable('maestro'),
  ]);
  if (!xcrunPath) {
    throw new Error('Xcode Command Line Toolsが見つかりません。');
  }
  if (!maestroPath) {
    throw new Error('Maestro CLI 2.3.0以上が見つかりません。');
  }
  const maestroVersion = await readMaestroVersion(maestroPath);
  if (!versionAtLeast(maestroVersion.parts, MINIMUM_MAESTRO_VERSION)) {
    throw new Error(
      `Maestro CLI 2.3.0以上が必要です。現在は${maestroVersion.text}です。`,
    );
  }

  const device = chooseDevice(
    await listBootedDevices(xcrunPath),
    target,
    options.deviceId,
  );
  const { stdout: localeOutput } = await execFileAsync(xcrunPath, [
    'simctl',
    'spawn',
    device.udid,
    'defaults',
    'read',
    'NSGlobalDomain',
    'AppleLocale',
  ]);
  const deviceLocale = localeOutput.trim().replaceAll('"', '');
  if (!deviceLocale.startsWith(target.locale)) {
    throw new Error(
      `Simulatorのロケールが設定と異なります: ${deviceLocale} / ${target.locale}`,
    );
  }
  try {
    await execFileAsync(xcrunPath, [
      'simctl',
      'get_app_container',
      device.udid,
      plan.bundleIdentifier,
    ]);
  } catch {
    throw new Error(
      `${target.device}に${plan.bundleIdentifier}がインストールされていません。`,
    );
  }

  const runDirectory = path.join(target.outputRoot, timestamp());
  await ensureSafeWritePath(plan.projectDir, target.outputRoot);
  await mkdir(target.outputRoot, { recursive: true });
  await mkdir(runDirectory);
  let statusBarOverridden = false;
  try {
    try {
      await execFileAsync(xcrunPath, [
        'simctl',
        'status_bar',
        device.udid,
        'override',
        '--time',
        '9:41',
        '--wifiBars',
        '3',
        '--cellularBars',
        '4',
        '--batteryLevel',
        '100',
      ]);
      statusBarOverridden = true;
    } catch {
      console.error(
        '警告: ステータスバーを固定できなかったため、現在の表示で撮影します。',
      );
    }

    const maestroOutputDirectory = path.join(
      runDirectory,
      '.maestro-report',
    );
    const relativeOutput = path.relative(
      plan.projectDir,
      maestroOutputDirectory,
    );
    const { stdout } = await execFileAsync(
      maestroPath,
      createMaestroTestArgs({
        deviceId: device.udid,
        bundleIdentifier: plan.bundleIdentifier,
        testOutputDir: relativeOutput,
        flowPath: target.flowPath,
      }),
      {
        cwd: plan.projectDir,
        env: {
          ...process.env,
          MAESTRO_CLI_NO_ANALYTICS: '1',
        },
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (stdout.trim()) console.log(stdout.trim());
  } finally {
    if (statusBarOverridden) {
      try {
        await execFileAsync(xcrunPath, [
          'simctl',
          'status_bar',
          device.udid,
          'clear',
        ]);
      } catch {
        console.error('警告: Simulatorのステータスバー固定を解除できませんでした。');
      }
    }
  }

  const result = await finalizeMaestroOutput(
    path.join(runDirectory, '.maestro-report'),
    runDirectory,
    target,
  );
  const report = {
    ...result,
    target: target.id,
    device: device.name,
    deviceId: device.udid,
    locale: target.locale,
    outputDir: runDirectory,
  };
  printResult(report, options.json);
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return;
  if (options.action === 'check') {
    await runCheck(options);
  } else if (options.action === 'validate') {
    await runValidate(options);
  } else if (options.action === 'export-eas-metadata') {
    await runExportEasMetadata(options);
  } else {
    await runCapture(options);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    console.error(`エラー: ${error.message}`);
    process.exitCode = 1;
  });
}

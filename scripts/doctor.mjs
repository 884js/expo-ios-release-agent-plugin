#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CAPABILITIES = new Set([
  'all',
  'testflight',
  'appstore-info',
  'appstore-release',
]);

function printHelp() {
  console.log(`Usage:
  node scripts/doctor.mjs [--capability CAPABILITY]
                          [--project-dir PATH]
                          [--profile PROFILE]
                          [--locale LOCALE]
                          [--live]
                          [--json]

Capabilities:
  all               iOSリリース全体
  testflight        EAS BuildとTestFlight提出
  appstore-info     App Store情報の更新
  appstore-release  ビルド選択とApp Review提出

Options:
  --project-dir  Expoプロジェクトのルート。既定は現在のディレクトリ
  --profile      EASプロファイル。既定はEAS_RELEASE_PROFILEまたはtestflight
  --locale       App Storeのロケール。既定はIOS_RELEASE_LOCALEまたはja
  --live         eas whoamiでEASログイン状態も確認する
  --json         機械可読なJSONで出力する
  --help         このヘルプを表示する

Exit codes:
  0  READY
  1  BLOCKED
  2  NEEDS_SETUP`);
}

function parseArgs(argv) {
  const options = {
    capability: 'all',
    projectDir: process.cwd(),
    profile: process.env.EAS_RELEASE_PROFILE ?? 'testflight',
    locale: process.env.IOS_RELEASE_LOCALE ?? 'ja',
    live: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--live') {
      options.live = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (
      arg === '--capability' ||
      arg === '--project-dir' ||
      arg === '--profile' ||
      arg === '--locale'
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} の値が必要です。`);
      }
      index += 1;
      if (arg === '--capability') options.capability = value;
      if (arg === '--project-dir') options.projectDir = value;
      if (arg === '--profile') options.profile = value;
      if (arg === '--locale') options.locale = value;
    } else {
      throw new Error(`不明なオプションです: ${arg}`);
    }
  }

  if (!CAPABILITIES.has(options.capability)) {
    throw new Error(`未対応のcapabilityです: ${options.capability}`);
  }

  options.projectDir = path.resolve(options.projectDir);
  return options;
}

async function readOptionalJson(filePath) {
  try {
    return {
      value: JSON.parse(await readFile(filePath, 'utf8')),
      error: null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { value: null, error: null };
    return { value: null, error };
  }
}

function resolveProfile(profiles, profileName, seen = new Set()) {
  const profile = profiles?.[profileName];
  if (!profile) return null;
  if (!profile.extends) return profile;
  if (seen.has(profileName)) {
    throw new Error(`プロファイル継承が循環しています: ${profileName}`);
  }

  const nextSeen = new Set(seen).add(profileName);
  const parent = resolveProfile(profiles, profile.extends, nextSeen);
  if (!parent) {
    throw new Error(`継承元プロファイルが見つかりません: ${profile.extends}`);
  }

  return {
    ...parent,
    ...profile,
    ios: {
      ...parent.ios,
      ...profile.ios,
    },
  };
}

async function findEasCli() {
  if (process.env.EAS_CLI_PATH) return process.env.EAS_CLI_PATH;

  try {
    const { stdout } = await execFileAsync('which', ['eas']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function requiredFor(capability, ...targets) {
  return capability === 'all' || targets.includes(capability);
}

function resultStatus(checks) {
  if (checks.some((check) => check.status === 'BLOCKED')) return 'BLOCKED';
  if (checks.some((check) => check.status === 'MISSING')) return 'NEEDS_SETUP';
  return 'READY';
}

function addCheck(checks, id, label, status, detail, remediation = null) {
  checks.push({ id, label, status, detail, remediation });
}

async function diagnose(options) {
  const checks = [];
  const root = options.projectDir;
  const [appResult, easResult, storeDefaultResult, fixtureResult] =
    await Promise.all([
      readOptionalJson(path.join(root, 'app.json')),
      readOptionalJson(path.join(root, 'eas.json')),
      readOptionalJson(path.join(root, 'store.config.json')),
      readOptionalJson(path.join(root, '.release-fixture.json')),
    ]);

  addCheck(
    checks,
    'node',
    'Node.js',
    Number(process.versions.node.split('.')[0]) >= 18 ? 'PASS' : 'BLOCKED',
    `Node.js ${process.versions.node}`,
    'Node.js 18以上へ更新する',
  );

  const easCli = await findEasCli();
  addCheck(
    checks,
    'eas-cli',
    'EAS CLI',
    easCli ? 'PASS' : 'MISSING',
    easCli ? 'easコマンドを利用できます' : 'easコマンドが見つかりません',
    'EAS CLIをインストールする',
  );

  const fixtureMarker = fixtureResult.value;
  if (
    fixtureMarker?.fixtureOnly === true &&
    fixtureMarker?.externalActionsAllowed === false
  ) {
    addCheck(
      checks,
      'fixture',
      'Fixture',
      'BLOCKED',
      'オフライン評価用fixtureのため外部操作は無効です',
      '実際のExpoプロジェクトへ切り替える',
    );
  } else {
    addCheck(
      checks,
      'fixture',
      'Fixture',
      'PASS',
      '実プロジェクトとして確認します',
    );
  }

  if (appResult.error) {
    addCheck(
      checks,
      'app-json',
      'app.json',
      'BLOCKED',
      `JSONを読み込めません: ${appResult.error.message}`,
      'app.jsonの構文を修正する',
    );
  } else if (!appResult.value) {
    addCheck(
      checks,
      'app-json',
      'app.json',
      'MISSING',
      'app.jsonが見つかりません',
      'Expoプロジェクトのルートで実行する',
    );
  } else {
    addCheck(checks, 'app-json', 'app.json', 'PASS', 'app.jsonを確認しました');
  }

  if (easResult.error) {
    addCheck(
      checks,
      'eas-json',
      'eas.json',
      'BLOCKED',
      `JSONを読み込めません: ${easResult.error.message}`,
      'eas.jsonの構文を修正する',
    );
  } else if (!easResult.value) {
    addCheck(
      checks,
      'eas-json',
      'eas.json',
      'MISSING',
      'eas.jsonが見つかりません',
      'eas build:configureでEAS Buildを設定する',
    );
  } else {
    addCheck(checks, 'eas-json', 'eas.json', 'PASS', 'eas.jsonを確認しました');
  }

  const appConfig = appResult.value;
  const easConfig = easResult.value;
  const expo = appConfig?.expo;
  const requiredAppFields = [
    ['expo.owner', expo?.owner],
    ['expo.slug', expo?.slug],
    ['expo.version', expo?.version],
    ['expo.ios.bundleIdentifier', expo?.ios?.bundleIdentifier],
  ];

  if (appConfig) {
    const missingFields = requiredAppFields
      .filter(([, value]) => !value)
      .map(([name]) => name);
    addCheck(
      checks,
      'app-fields',
      'Expo設定',
      missingFields.length === 0 ? 'PASS' : 'MISSING',
      missingFields.length === 0
        ? 'owner、slug、version、Bundle IDが設定済みです'
        : `不足しています: ${missingFields.join(', ')}`,
      'app.jsonへ不足項目を追加する',
    );
  }

  let buildProfile = null;
  let submitProfile = null;
  if (easConfig) {
    try {
      buildProfile = resolveProfile(easConfig.build, options.profile);
      submitProfile = resolveProfile(easConfig.submit, options.profile);
    } catch (error) {
      addCheck(
        checks,
        'profile-inheritance',
        'EASプロファイル継承',
        'BLOCKED',
        error.message,
        'eas.jsonのextendsを修正する',
      );
    }

    if (
      requiredFor(
        options.capability,
        'testflight',
        'appstore-info',
      )
    ) {
      addCheck(
        checks,
        'build-profile',
        'EAS Buildプロファイル',
        buildProfile ? 'PASS' : 'MISSING',
        buildProfile
          ? `${options.profile}を利用します`
          : `build.${options.profile}が見つかりません`,
        `eas.jsonへbuild.${options.profile}を追加する`,
      );
    }

    if (
      requiredFor(
        options.capability,
        'testflight',
        'appstore-release',
      )
    ) {
      addCheck(
        checks,
        'submit-profile',
        'EAS Submitプロファイル',
        submitProfile ? 'PASS' : 'MISSING',
        submitProfile
          ? `${options.profile}を利用します`
          : `submit.${options.profile}が見つかりません`,
        `eas.jsonへsubmit.${options.profile}を追加する`,
      );
    }
  }

  if (
    requiredFor(options.capability, 'testflight', 'appstore-release') &&
    easConfig
  ) {
    const appId = process.env.ASC_APP_ID ?? submitProfile?.ios?.ascAppId;
    addCheck(
      checks,
      'asc-app-id',
      'App Store Connect App ID',
      appId ? 'PASS' : 'MISSING',
      appId
        ? 'ASC_APP_IDまたはsubmitプロファイルに設定済みです'
        : 'App Store Connect App IDが見つかりません',
      `ASC_APP_IDまたはsubmit.${options.profile}.ios.ascAppIdを設定する`,
    );
  }

  if (requiredFor(options.capability, 'appstore-info')) {
    const metadataPath =
      buildProfile?.metadataPath ?? path.join(root, 'store.config.json');
    const resolvedMetadataPath = path.isAbsolute(metadataPath)
      ? metadataPath
      : path.resolve(root, metadataPath);
    const storeResult =
      resolvedMetadataPath === path.join(root, 'store.config.json')
        ? storeDefaultResult
        : await readOptionalJson(resolvedMetadataPath);

    if (storeResult.error) {
      addCheck(
        checks,
        'appstore-info-file',
        'App Store情報ファイル',
        'BLOCKED',
        `JSONを読み込めません: ${storeResult.error.message}`,
        'App Store情報ファイルの構文を修正する',
      );
    } else if (!storeResult.value) {
      addCheck(
        checks,
        'appstore-info-file',
        'App Store情報ファイル',
        'MISSING',
        `${path.relative(root, resolvedMetadataPath)}が見つかりません`,
        'eas metadata:pullまたは新規作成で用意する',
      );
    } else {
      addCheck(
        checks,
        'appstore-info-file',
        'App Store情報ファイル',
        'PASS',
        path.relative(root, resolvedMetadataPath),
      );

      const storeVersion = storeResult.value.apple?.version;
      const appVersion = expo?.version;
      addCheck(
        checks,
        'version-match',
        'App Storeバージョン',
        appVersion && storeVersion && appVersion !== storeVersion
          ? 'BLOCKED'
          : appVersion && storeVersion
            ? 'PASS'
            : 'MISSING',
        appVersion && storeVersion
          ? `app.json=${appVersion}, App Store情報=${storeVersion}`
          : '比較に必要なバージョンが不足しています',
        'app.jsonとApp Store情報ファイルのバージョンを揃える',
      );

      const localeInfo = storeResult.value.apple?.info?.[options.locale];
      addCheck(
        checks,
        'locale',
        'App Storeロケール',
        localeInfo ? 'PASS' : 'MISSING',
        localeInfo
          ? `${options.locale}が設定済みです`
          : `${options.locale}が見つかりません`,
        `apple.info.${options.locale}を追加する`,
      );
    }
  }

  if (requiredFor(options.capability, 'appstore-release')) {
    const environmentCredentials = [
      process.env.ASC_ISSUER_ID,
      process.env.ASC_KEY_ID,
      process.env.ASC_PRIVATE_KEY_PATH,
    ];
    const providedCredentialCount = environmentCredentials.filter(Boolean).length;

    if (process.env.ASC_TOKEN) {
      addCheck(
        checks,
        'asc-auth',
        'App Store Connect認証',
        'PASS',
        'ASC_TOKENを利用します',
      );
    } else if (providedCredentialCount === 3) {
      addCheck(
        checks,
        'asc-auth',
        'App Store Connect認証',
        'PASS',
        '環境変数のAPIキーを利用します',
      );
    } else if (providedCredentialCount > 0) {
      addCheck(
        checks,
        'asc-auth',
        'App Store Connect認証',
        'BLOCKED',
        'APIキー用の環境変数が一部だけ設定されています',
        'ASC_ISSUER_ID、ASC_KEY_ID、ASC_PRIVATE_KEY_PATHをすべて設定する',
      );
    } else {
      addCheck(
        checks,
        'asc-auth',
        'App Store Connect認証',
        'WARN',
        'EAS Submit用として保存済みのAPIキーを実行時に確認します',
      );
    }
  }

  if (options.live && easCli && fixtureMarker?.externalActionsAllowed !== false) {
    try {
      const { stdout } = await execFileAsync(easCli, [
        'whoami',
        '--non-interactive',
      ]);
      addCheck(
        checks,
        'eas-login',
        'EASログイン',
        'PASS',
        stdout.trim() ? 'EASへログイン済みです' : 'EAS認証を確認しました',
      );
    } catch {
      addCheck(
        checks,
        'eas-login',
        'EASログイン',
        'MISSING',
        'EASログインを確認できませんでした',
        'eas loginを実行するかEXPO_TOKENを設定する',
      );
    }
  } else if (!options.live) {
    addCheck(
      checks,
      'eas-login',
      'EASログイン',
      'WARN',
      '--liveを指定していないため確認していません',
    );
  }

  return {
    status: resultStatus(checks),
    capability: options.capability,
    projectDir: root,
    profile: options.profile,
    locale: options.locale,
    live: options.live,
    checks,
  };
}

function printHumanReport(report) {
  console.log(`セットアップ状態: ${report.status}`);
  console.log(`対象: ${report.capability}`);
  console.log(`EASプロファイル: ${report.profile}`);
  console.log(`ロケール: ${report.locale}`);

  for (const check of report.checks) {
    console.log(`[${check.status}] ${check.label}: ${check.detail}`);
    if (
      check.remediation &&
      (check.status === 'MISSING' || check.status === 'BLOCKED')
    ) {
      console.log(`  対応: ${check.remediation}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await diagnose(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  if (report.status === 'BLOCKED') process.exitCode = 1;
  if (report.status === 'NEEDS_SETUP') process.exitCode = 2;
}

main().catch((error) => {
  console.error(`エラー: ${error.message}`);
  process.exitCode = 1;
});

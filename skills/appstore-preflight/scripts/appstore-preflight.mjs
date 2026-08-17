#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

function printHelp() {
  console.log(`Usage:
  node appstore-preflight.mjs [--project-dir PATH] [--profile PROFILE]
                              [--locale LOCALE] [--verbose] [--json]

Options:
  --project-dir  Expoプロジェクトのルート。既定は現在のディレクトリ
  --profile      EASプロファイル。既定はEAS_RELEASE_PROFILEまたはtestflight
  --locale       App Storeのロケール。既定はIOS_RELEASE_LOCALEまたはja
  --verbose      PASSと対応案を含む全項目を表示する
  --json         機械可読なJSONで出力する
  --help         このヘルプを表示する

Exit codes:
  0  BLOCKEDなし
  1  BLOCKEDあり`);
}

function parseArgs(argv) {
  const options = {
    projectDir: process.cwd(),
    profile: process.env.EAS_RELEASE_PROFILE ?? 'testflight',
    locale: process.env.IOS_RELEASE_LOCALE ?? 'ja',
    verbose: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (
      arg === '--project-dir' ||
      arg === '--profile' ||
      arg === '--locale'
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} の値が必要です。`);
      }
      index += 1;
      if (arg === '--project-dir') options.projectDir = value;
      if (arg === '--profile') options.profile = value;
      if (arg === '--locale') options.locale = value;
    } else {
      throw new Error(`不明なオプションです: ${arg}`);
    }
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
    throw new Error(`EASプロファイル継承が循環しています: ${profileName}`);
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

function isPresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' ? value.trim().length > 0 : value != null;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function addCheck(checks, id, label, status, detail, remediation = null) {
  checks.push({
    id,
    label,
    status,
    detail,
    remediation: status === 'PASS' ? null : remediation,
  });
}

function reportStatus(checks) {
  if (checks.some((check) => check.status === 'BLOCKED')) return 'BLOCKED';
  if (checks.some((check) => check.status === 'MANUAL')) return 'NEEDS_REVIEW';
  return 'READY';
}

function validateLength(checks, field, label, value, { min = 0, max }) {
  if (!isPresent(value)) return;
  const length = [...String(value)].length;
  const valid = length >= min && (max == null || length <= max);
  addCheck(
    checks,
    `metadata-${field}`,
    label,
    valid ? 'PASS' : 'BLOCKED',
    valid ? `${length}文字` : `${length}文字で許容範囲外です`,
    max == null
      ? `${min}文字以上に修正する`
      : `${min}〜${max}文字に修正する`,
  );
}

async function diagnose(options) {
  const checks = [];
  const root = options.projectDir;
  const fixtureResult = await readOptionalJson(
    path.join(root, '.release-fixture.json'),
  );
  const [appResult, easResult] = await Promise.all([
    readOptionalJson(path.join(root, 'app.json')),
    readOptionalJson(path.join(root, 'eas.json')),
  ]);

  const fixture =
    fixtureResult.value?.fixtureOnly === true &&
    fixtureResult.value?.externalActionsAllowed === false;
  if (fixtureResult.error) {
    addCheck(
      checks,
      'fixture',
      'Fixture設定',
      'BLOCKED',
      `JSONを読み込めません: ${fixtureResult.error.message}`,
      '.release-fixture.jsonの構文を修正する',
    );
  } else if (fixture) {
    addCheck(
      checks,
      'fixture',
      'Fixture設定',
      'BLOCKED',
      'オフライン評価用FixtureのためApp Reviewへ提出できません',
      '実際のExpoプロジェクトへ切り替える',
    );
  }

  for (const [id, label, result] of [
    ['app-json', 'app.json', appResult],
    ['eas-json', 'eas.json', easResult],
  ]) {
    if (result.error) {
      addCheck(
        checks,
        id,
        label,
        'BLOCKED',
        `JSONを読み込めません: ${result.error.message}`,
        `${label}の構文を修正する`,
      );
    } else if (!result.value) {
      addCheck(
        checks,
        id,
        label,
        'BLOCKED',
        `${label}が見つかりません`,
        'Expoプロジェクトのルートで実行する',
      );
    } else {
      addCheck(checks, id, label, 'PASS', `${label}を読み込みました`);
    }
  }

  const appConfig = appResult.value;
  const easConfig = easResult.value;
  const expo = appConfig?.expo;
  const appVersion = isPresent(expo?.version) ? String(expo.version) : null;
  const bundleIdentifier = expo?.ios?.bundleIdentifier;
  const missingCoreAppFields = [
    ['expo.version', appVersion],
    ['expo.ios.bundleIdentifier', bundleIdentifier],
  ]
    .filter(([, value]) => !isPresent(value))
    .map(([name]) => name);

  if (appConfig) {
    addCheck(
      checks,
      'expo-fields',
      'Expo設定',
      missingCoreAppFields.length === 0 ? 'PASS' : 'BLOCKED',
      missingCoreAppFields.length === 0
        ? 'versionとBundle IDが設定済みです'
        : `不足しています: ${missingCoreAppFields.join(', ')}`,
      'app.jsonへ不足項目を追加する',
    );
    const missingEasIdentity = [
      ['expo.owner', expo?.owner],
      ['expo.slug', expo?.slug],
    ]
      .filter(([, value]) => !isPresent(value))
      .map(([name]) => name);
    addCheck(
      checks,
      'eas-identity',
      'EASプロジェクト識別子',
      missingEasIdentity.length === 0 ? 'PASS' : 'MANUAL',
      missingEasIdentity.length === 0
        ? 'ownerとslugが設定済みです'
        : `EAS保存済み認証を使う場合に必要です: ${missingEasIdentity.join(', ')}`,
      '使用するApp Store Connect認証方式とEASプロジェクトを確認する',
    );
  }

  const localBuildNumber = expo?.ios?.buildNumber;
  addCheck(
    checks,
    'build-number',
    'build番号',
    isPresent(localBuildNumber) ? 'PASS' : 'MANUAL',
    isPresent(localBuildNumber)
      ? 'ローカル設定にbuild番号があります'
      : 'EASのリモートバージョン管理または処理済みビルドで確認が必要です',
    'App Store Connect上の処理済みbuild番号を確認する',
  );

  let buildProfile = null;
  let submitProfile = null;
  if (easConfig) {
    try {
      buildProfile = resolveProfile(easConfig.build, options.profile);
      submitProfile = resolveProfile(easConfig.submit, options.profile);
      addCheck(
        checks,
        'build-profile',
        'EAS Buildプロファイル',
        buildProfile ? 'PASS' : 'MANUAL',
        buildProfile
          ? `${options.profile}を利用します`
          : `build.${options.profile}がなく、既存の処理済みビルドを確認します`,
        '新しいビルドが必要ならEAS Buildプロファイルを設定する',
      );
      addCheck(
        checks,
        'submit-profile',
        'EAS Submitプロファイル',
        submitProfile || buildProfile ? 'PASS' : 'BLOCKED',
        submitProfile
          ? `${options.profile}を利用します`
          : buildProfile
            ? `submit.${options.profile}はなく、buildプロファイルと環境変数を確認します`
            : `build.${options.profile}とsubmit.${options.profile}が見つかりません`,
        `eas.jsonへbuildまたはsubmitの${options.profile}を追加する`,
      );
      if (
        buildProfile?.autoIncrement ||
        easConfig.cli?.appVersionSource === 'remote'
      ) {
        addCheck(
          checks,
          'build-number-source',
          '提出対象build番号',
          'MANUAL',
          'EAS側でbuild番号が決まるため、ローカル値だけでは確定できません',
          'EAS BuildとApp Store Connectの処理済みbuild番号を照合する',
        );
      }
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
  }

  if (easConfig) {
    const appId = process.env.ASC_APP_ID ?? submitProfile?.ios?.ascAppId;
    addCheck(
      checks,
      'asc-app-id',
      'App Store Connect App ID',
      isPresent(appId) ? (fixture ? 'MANUAL' : 'PASS') : 'BLOCKED',
      isPresent(appId)
        ? fixture
          ? 'Fixtureの値なので実際のApp IDではありません'
          : 'App IDが設定済みです'
        : 'App IDが見つかりません',
      `ASC_APP_IDまたはsubmit.${options.profile}.ios.ascAppIdを設定する`,
    );
  }

  const configuredMetadataPath =
    buildProfile?.metadataPath ?? path.join(root, 'store.config.json');
  const metadataPath = path.isAbsolute(configuredMetadataPath)
    ? configuredMetadataPath
    : path.resolve(root, configuredMetadataPath);
  const storeResult = await readOptionalJson(metadataPath);
  const storeConfig = storeResult.value;

  if (storeResult.error) {
    addCheck(
      checks,
      'metadata-file',
      'EAS Metadata設定',
      'BLOCKED',
      `JSONを読み込めません: ${storeResult.error.message}`,
      'EAS Metadata設定の構文を修正する',
    );
  } else if (!storeConfig) {
    addCheck(
      checks,
      'metadata-file',
      'EAS Metadata設定',
      'MANUAL',
      `${path.relative(root, metadataPath)}が見つからないためApp Store Connect上で確認が必要です`,
      'App Store Connectで掲載情報と審査情報を確認する',
    );
  } else {
    addCheck(
      checks,
      'metadata-file',
      'EAS Metadata設定',
      'PASS',
      path.relative(root, metadataPath),
    );
    addCheck(
      checks,
      'metadata-schema',
      'EAS Metadataスキーマ',
      storeConfig.configVersion === 0 ? 'PASS' : 'BLOCKED',
      storeConfig.configVersion === 0
        ? 'configVersion 0'
        : `未対応のconfigVersionです: ${String(storeConfig.configVersion)}`,
      'EAS Metadataの現行スキーマに合わせる',
    );

    const storeVersion = isPresent(storeConfig.apple?.version)
      ? String(storeConfig.apple.version)
      : null;
    addCheck(
      checks,
      'version-match',
      'App Storeバージョン',
      appVersion && storeVersion
        ? appVersion === storeVersion
          ? 'PASS'
          : 'BLOCKED'
        : 'MANUAL',
      appVersion && storeVersion
        ? `app.json=${appVersion}, EAS Metadata=${storeVersion}`
        : 'EAS Metadata側のversionをApp Store Connectで確認します',
      'app.json、EAS Metadata、App Store Connectのversionを揃える',
    );

    const localeInfo = storeConfig.apple?.info?.[options.locale];
    if (!localeInfo) {
      addCheck(
        checks,
        'locale-info',
        '対象ロケールの掲載情報',
        'MANUAL',
        `apple.info.${options.locale}がないためApp Store Connect上で確認が必要です`,
        `${options.locale}の掲載情報を確認する`,
      );
    } else {
      const requiredLocalizedFields = [
        ['title', localeInfo.title],
        ['description', localeInfo.description],
        ['keywords', localeInfo.keywords],
        ['supportUrl', localeInfo.supportUrl],
        ['privacyPolicyUrl', localeInfo.privacyPolicyUrl],
      ];
      const missingLocalizedFields = requiredLocalizedFields
        .filter(([, value]) => !isPresent(value))
        .map(([name]) => name);
      addCheck(
        checks,
        'locale-info',
        '対象ロケールの掲載情報',
        missingLocalizedFields.length === 0 ? 'PASS' : 'MANUAL',
        missingLocalizedFields.length === 0
          ? `${options.locale}の主要項目が設定済みです`
          : `ローカル設定で未確認です: ${missingLocalizedFields.join(', ')}`,
        'App Store Connect上の必須掲載情報を確認する',
      );

      for (const [field, label] of [
        ['supportUrl', 'サポートURL'],
        ['privacyPolicyUrl', 'プライバシーポリシーURL'],
      ]) {
        const value = localeInfo[field];
        if (isPresent(value)) {
          const validUrl = isHttpUrl(value);
          addCheck(
            checks,
            `${field}-format`,
            label,
            validUrl ? 'PASS' : 'BLOCKED',
            validUrl ? 'HTTP(S) URLです' : 'URL形式が不正です',
            `${field}を有効なHTTP(S) URLへ修正する`,
          );
        }
      }

      validateLength(checks, 'title', 'App名', localeInfo.title, {
        min: 2,
        max: 30,
      });
      validateLength(
        checks,
        'description',
        '説明文',
        localeInfo.description,
        { min: 10, max: 4000 },
      );
      validateLength(
        checks,
        'release-notes',
        'リリースノート',
        localeInfo.releaseNotes,
        { min: 1, max: 4000 },
      );
      validateLength(
        checks,
        'promo-text',
        'プロモーションテキスト',
        localeInfo.promoText,
        { min: 0, max: 170 },
      );
      if ('promotionalText' in localeInfo) {
        addCheck(
          checks,
          'promotional-text-key',
          'プロモーションテキストのキー',
          'BLOCKED',
          'promotionalTextはEAS Metadataのキーではありません',
          'promoTextへ変更する',
        );
      }
      if (!isPresent(localeInfo.releaseNotes)) {
        addCheck(
          checks,
          'release-notes',
          'リリースノート',
          'MANUAL',
          'アップデートでは必須のためApp Store Connect上で確認が必要です',
          '対象バージョンの「このバージョンの新機能」を確認する',
        );
      }
    }

    const review = storeConfig.apple?.review;
    const reviewFields = [
      ['firstName', review?.firstName],
      ['lastName', review?.lastName],
      ['email', review?.email],
      ['phone', review?.phone],
    ];
    const presentReviewFields = reviewFields.filter(([, value]) =>
      isPresent(value),
    );
    if (presentReviewFields.length === 0) {
      addCheck(
        checks,
        'review-contact',
        'App Review連絡先',
        'MANUAL',
        'ローカル設定にないためApp Store Connect上で確認が必要です',
        '審査連絡先の氏名、メール、電話番号を確認する',
      );
    } else {
      const missingReviewFields = reviewFields
        .filter(([, value]) => !isPresent(value))
        .map(([name]) => name);
      addCheck(
        checks,
        'review-contact',
        'App Review連絡先',
        missingReviewFields.length === 0 ? 'PASS' : 'BLOCKED',
        missingReviewFields.length === 0
          ? '審査連絡先が設定済みです'
          : `不足しています: ${missingReviewFields.join(', ')}`,
        '審査連絡先の必須項目を揃える',
      );
    }

    if (review?.demoRequired === true) {
      const hasCredentials =
        isPresent(review.demoUsername) && isPresent(review.demoPassword);
      addCheck(
        checks,
        'review-account',
        '審査用アカウント',
        hasCredentials ? 'PASS' : 'BLOCKED',
        hasCredentials
          ? 'ログイン情報が設定済みです'
          : 'demoRequiredですがログイン情報が不足しています',
        '有効な審査用ユーザー名とパスワードを設定する',
      );
    } else if (review?.demoRequired === false) {
      addCheck(
        checks,
        'review-account',
        '審査用アカウント',
        'PASS',
        'ログイン不要として設定済みです',
      );
    } else {
      addCheck(
        checks,
        'review-account',
        '審査用アカウント',
        'MANUAL',
        'ログインが必要かを実際のアプリ動作から確認します',
        'ログインが必要なら有効な審査用アカウントを設定する',
      );
    }

    const automaticRelease = storeConfig.apple?.release?.automaticRelease;
    const validRelease =
      typeof automaticRelease === 'boolean' ||
      (typeof automaticRelease === 'string' &&
        Number.isFinite(Date.parse(automaticRelease)));
    addCheck(
      checks,
      'release-method',
      '公開方式',
      automaticRelease == null
        ? 'MANUAL'
        : validRelease
          ? 'PASS'
          : 'BLOCKED',
      automaticRelease == null
        ? 'App Store Connect上で確認が必要です'
        : validRelease
          ? '公開方式が設定済みです'
          : 'automaticReleaseの値が不正です',
      '自動公開、手動公開、公開日時のいずれかを確認する',
    );
  }

  addCheck(
    checks,
    'appstore-final-state',
    'App Store Connect最終状態',
    'MANUAL',
    fixture
      ? 'Fixtureのため外部接続せず、実プロジェクトで再確認します'
      : 'version、処理済みbuild、紐付け、審査状態、掲載画像を確認します',
  );

  for (const [id, label, detail] of [
    [
      'compliance',
      '申告・契約情報',
      'App Privacy、輸出、年齢区分、権利、配信地域、契約・規制情報を確認します',
    ],
    [
      'review-readiness',
      '審査動作確認',
      '対象build、審査用アクセス、In-App Purchaseなどの同時提出項目を確認します',
    ],
  ]) {
    addCheck(checks, id, label, 'MANUAL', detail);
  }

  return {
    status: reportStatus(checks),
    projectDir: root,
    profile: options.profile,
    locale: options.locale,
    version: appVersion,
    buildNumber: isPresent(localBuildNumber)
      ? String(localBuildNumber)
      : null,
    fixture,
    checks,
  };
}

function printHumanReport(report, verbose) {
  const counts = { PASS: 0, BLOCKED: 0, MANUAL: 0 };
  for (const check of report.checks) counts[check.status] += 1;
  console.log(
    `提出前診断: ${report.status} ` +
      `(PASS ${counts.PASS} / BLOCKED ${counts.BLOCKED} / MANUAL ${counts.MANUAL})`,
  );
  console.log(
    `対象: version ${report.version ?? '未特定'} / build ${report.buildNumber ?? '要確認'} / ${report.profile} / ${report.locale}`,
  );

  const visibleChecks = verbose
    ? report.checks
    : report.checks.filter((check) => check.status !== 'PASS');
  for (const check of visibleChecks) {
    console.log(`[${check.status}] ${check.label}: ${check.detail}`);
    if (verbose && check.remediation) {
      console.log(`  確認: ${check.remediation}`);
    }
  }

  if (!verbose) console.log('詳細: --verbose または --json');
  console.log('読み取り専用。ファイルやApp Store Connectは変更していません。');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await diagnose(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report, options.verbose);
  }

  if (report.status === 'BLOCKED') process.exitCode = 1;
}

main().catch((error) => {
  console.error(`エラー: ${error.message}`);
  process.exitCode = 1;
});

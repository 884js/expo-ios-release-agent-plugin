#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { sign } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

const DEFAULT_API_BASE_URL = 'https://api.appstoreconnect.apple.com';
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const EDITABLE_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
]);

function printHelp() {
  console.log(`Usage:
  node appstore-release.mjs [--version VERSION] [--build-number NUMBER]
  node appstore-release.mjs --submit --confirm VERSION/BUILD

Options:
  --project-dir    Expoプロジェクトのルート。既定は現在のディレクトリ
  --profile        eas.jsonのbuild／submitプロファイル。既定はEAS_RELEASE_PROFILEまたはtestflight
  --version        app.jsonとは異なるApp Storeバージョンを確認する
  --build-number   対象build番号。省略時はapp.jsonの値または最新の処理済みビルド
  --submit         ビルドを紐付けてApp Reviewへ提出する
  --confirm        VERSION/BUILD形式の実行確認
  --help           このヘルプを表示する`);
}

function parseArgs(argv) {
  const options = {
    submit: false,
    confirm: null,
    projectDir: null,
    profile: null,
    version: null,
    buildNumber: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--submit') {
      options.submit = true;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (
      arg === '--confirm' ||
      arg === '--project-dir' ||
      arg === '--profile' ||
      arg === '--version' ||
      arg === '--build-number'
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} の値が必要です。`);
      }
      index += 1;
      if (arg === '--confirm') options.confirm = value;
      if (arg === '--project-dir') options.projectDir = value;
      if (arg === '--profile') options.profile = value;
      if (arg === '--version') options.version = value;
      if (arg === '--build-number') options.buildNumber = value;
    } else {
      throw new Error(`不明なオプションです: ${arg}`);
    }
  }

  return options;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveProfile(profiles, profileName, seen = new Set()) {
  const profile = profiles?.[profileName];
  if (!profile) return null;
  if (!profile.extends) return profile;
  if (seen.has(profileName)) {
    throw new Error(`eas.jsonのプロファイル継承が循環しています: ${profileName}`);
  }

  const nextSeen = new Set(seen).add(profileName);
  const parent = resolveProfile(profiles, profile.extends, nextSeen);
  if (!parent) {
    throw new Error(
      `eas.jsonの継承元プロファイルが見つかりません: ${profile.extends}`,
    );
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

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

async function findEasCliRoot() {
  const easCliPath =
    process.env.EAS_CLI_PATH ??
    (await execFileAsync('which', ['eas'])).stdout.trim();

  if (!easCliPath) {
    throw new Error('easコマンドが見つかりません。');
  }

  const resolvedPath = await realpath(easCliPath);
  return path.dirname(path.dirname(resolvedPath));
}

async function loadEasCredentials(appConfig) {
  const owner = appConfig.expo.owner;
  const projectName = appConfig.expo.slug;
  const bundleIdentifier = appConfig.expo.ios?.bundleIdentifier;

  if (!owner || !projectName || !bundleIdentifier) {
    throw new Error(
      'app.jsonのexpo.owner、expo.slug、expo.ios.bundleIdentifierが必要です。',
    );
  }

  const easCliRoot = await findEasCliRoot();
  const loadEasModule = (modulePath) =>
    require(path.join(easCliRoot, 'build', modulePath));
  const SessionManager = loadEasModule('user/SessionManager.js').default;
  const { createGraphqlClient } = loadEasModule(
    'commandUtils/context/contextUtils/createGraphqlClient.js',
  );
  const { getAscApiKeyForAppSubmissionsAsync } = loadEasModule(
    'credentials/ios/api/GraphqlClient.js',
  );
  const { AppStoreConnectApiKeyQuery } = loadEasModule(
    'graphql/queries/AppStoreConnectApiKeyQuery.js',
  );
  const sessionManager = new SessionManager({ setActor() {} });
  const { authenticationInfo } = await sessionManager.ensureLoggedInAsync({
    nonInteractive: true,
  });
  const graphqlClient = createGraphqlClient(authenticationInfo);
  const assignedKey = await getAscApiKeyForAppSubmissionsAsync(graphqlClient, {
    account: { name: owner },
    projectName,
    bundleIdentifier,
  });

  if (!assignedKey) {
    throw new Error(
      'このプロジェクトにEAS Submit用のAPIキーが設定されていません。',
    );
  }

  const key = await AppStoreConnectApiKeyQuery.getByIdAsync(
    graphqlClient,
    assignedKey.id,
  );

  if (!key.issuerIdentifier || !key.keyIdentifier || !key.keyP8) {
    throw new Error('EASに保存されたAPIキーの情報が不足しています。');
  }

  return {
    issuerId: key.issuerIdentifier,
    keyId: key.keyIdentifier,
    privateKey: key.keyP8,
  };
}

async function loadEnvironmentCredentials() {
  const issuerId = process.env.ASC_ISSUER_ID;
  const keyId = process.env.ASC_KEY_ID;
  const privateKeyPath = process.env.ASC_PRIVATE_KEY_PATH;
  const provided = [issuerId, keyId, privateKeyPath].filter(Boolean);

  if (provided.length === 0) return null;

  const missing = [
    ['ASC_ISSUER_ID', issuerId],
    ['ASC_KEY_ID', keyId],
    ['ASC_PRIVATE_KEY_PATH', privateKeyPath],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `App Store Connect APIの環境変数が不足しています: ${missing.join(', ')}`,
    );
  }

  return {
    issuerId,
    keyId,
    privateKey: await readFile(privateKeyPath, 'utf8'),
  };
}

function createTokenFromCredentials({ issuerId, keyId, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(
    JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }),
  );
  const payload = base64Url(
    JSON.stringify({
      iss: issuerId,
      iat: now - 30,
      exp: now + 19 * 60,
      aud: 'appstoreconnect-v1',
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${signature.toString('base64url')}`;
}

async function resolveAuthentication(appConfig) {
  if (process.env.ASC_TOKEN) {
    return { token: process.env.ASC_TOKEN, source: '指定されたAPIトークン' };
  }

  const environmentCredentials = await loadEnvironmentCredentials();
  if (environmentCredentials) {
    return {
      token: createTokenFromCredentials(environmentCredentials),
      source: '環境変数のAPIキー',
    };
  }

  try {
    const easCredentials = await loadEasCredentials(appConfig);
    return {
      token: createTokenFromCredentials(easCredentials),
      source: 'EASに保存済みのAPIキー',
    };
  } catch (error) {
    throw new Error(
      `EASに保存済みのAPIキーを取得できませんでした: ${error.message}\n` +
        'eas loginとEAS Submit用キーの設定を確認してください。環境変数での指定も利用できます。',
    );
  }
}

function describeApiError(body, status) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  if (errors.length === 0)
    return `App Store Connect APIでエラーが発生しました (${status})`;

  return errors
    .map((error) =>
      [error.code, error.title, error.detail].filter(Boolean).join(': '),
    )
    .join('\n');
}

function createApiClient(token) {
  const baseUrl = process.env.ASC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

  return async function request(endpoint, { method = 'GET', body } = {}) {
    const response = await fetch(new URL(endpoint, baseUrl), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error(describeApiError(parsed, response.status));
    }

    return parsed;
  };
}

function withQuery(endpoint, params) {
  const query = new URLSearchParams(params);
  return `${endpoint}?${query.toString()}`;
}

async function findAppStoreVersion(request, appId, version) {
  const response = await request(
    withQuery(`/v1/apps/${appId}/appStoreVersions`, {
      'filter[platform]': 'IOS',
      'filter[versionString]': version,
      limit: '10',
    }),
  );
  const versions = response?.data ?? [];
  const exact = versions.filter(
    (item) =>
      item.attributes?.versionString === version &&
      item.attributes?.platform === 'IOS',
  );

  if (exact.length === 0) {
    throw new Error(`App Store ConnectにiOS ${version}が見つかりません。`);
  }

  return (
    exact.find((item) =>
      EDITABLE_STATES.has(item.attributes?.appVersionState),
    ) ?? exact[0]
  );
}

async function findBuild(request, appId, version, buildNumber) {
  const params = {
    'filter[app]': appId,
    limit: '50',
    sort: '-uploadedDate',
  };
  if (buildNumber) params['filter[version]'] = buildNumber;

  const response = await request(
    withQuery('/v1/builds', params),
  );
  const candidates = (response?.data ?? []).filter(
    (item) =>
      (!buildNumber || item.attributes?.version === buildNumber) &&
      item.attributes?.processingState === 'VALID',
  );

  for (const build of candidates) {
    const preReleaseVersion = await request(
      `/v1/builds/${build.id}/preReleaseVersion`,
    );
    if (preReleaseVersion?.data?.attributes?.version === version) return build;
  }

  throw new Error(
    buildNumber
      ? `処理済みの${version} build ${buildNumber}が見つかりません。TestFlightの処理完了を確認してください。`
      : `処理済みの${version}のビルドが見つかりません。TestFlightの処理完了を確認してください。`,
  );
}

async function getCurrentBuildId(request, appStoreVersionId) {
  const response = await request(
    `/v1/appStoreVersions/${appStoreVersionId}/relationships/build`,
  );
  return response?.data?.id ?? null;
}

async function getLatestReviewSubmission(request, appId) {
  const response = await request(
    withQuery(`/v1/apps/${appId}/reviewSubmissions`, {
      limit: '10',
    }),
  );
  const submissions = response?.data ?? [];
  return (
    submissions.find((item) => item.attributes?.state === 'READY_FOR_REVIEW') ??
    submissions[0] ??
    null
  );
}

async function findOrCreateReadySubmission(request, appId, latestSubmission) {
  if (latestSubmission?.attributes?.state === 'READY_FOR_REVIEW')
    return latestSubmission;

  const response = await request('/v1/reviewSubmissions', {
    method: 'POST',
    body: {
      data: {
        type: 'reviewSubmissions',
        relationships: {
          app: {
            data: { type: 'apps', id: appId },
          },
        },
      },
    },
  });
  return response.data;
}

async function ensureSubmissionItem(
  request,
  reviewSubmissionId,
  appStoreVersionId,
) {
  const response = await request(
    withQuery(`/v1/reviewSubmissions/${reviewSubmissionId}/items`, {
      include: 'appStoreVersion',
      limit: '200',
    }),
  );
  const includedVersionIds = new Set(
    (response?.included ?? [])
      .filter((item) => item.type === 'appStoreVersions')
      .map((item) => item.id),
  );
  const hasVersion =
    includedVersionIds.has(appStoreVersionId) ||
    (response?.data ?? []).some(
      (item) =>
        item.relationships?.appStoreVersion?.data?.id === appStoreVersionId,
    );

  if (hasVersion) return;

  await request('/v1/reviewSubmissionItems', {
    method: 'POST',
    body: {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: {
            data: { type: 'reviewSubmissions', id: reviewSubmissionId },
          },
          appStoreVersion: {
            data: { type: 'appStoreVersions', id: appStoreVersionId },
          },
        },
      },
    },
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(options.projectDir ?? process.cwd());
  const [appConfig, storeConfig, easConfig, fixtureMarker] = await Promise.all([
    readJson(path.join(root, 'app.json')),
    readOptionalJson(path.join(root, 'store.config.json')),
    readJson(path.join(root, 'eas.json')),
    readOptionalJson(path.join(root, '.release-fixture.json')),
  ]);
  const profile =
    options.profile ?? process.env.EAS_RELEASE_PROFILE ?? 'testflight';
  const appVersion = appConfig.expo?.version
    ? String(appConfig.expo.version)
    : null;
  const storeVersion = storeConfig?.apple?.version
    ? String(storeConfig.apple.version)
    : null;

  if (appVersion && storeVersion && appVersion !== storeVersion && !options.version) {
    throw new Error(
      `app.json (${appVersion}) と store.config.json (${storeVersion}) のバージョンが一致していません。`,
    );
  }

  const version = options.version ?? appVersion ?? storeVersion;
  if (!version) {
    throw new Error(
      '対象バージョンを取得できません。app.jsonにexpo.versionを設定するか、--versionを指定してください。',
    );
  }
  const configuredBuildNumber =
    options.buildNumber ?? appConfig.expo?.ios?.buildNumber ?? null;
  const submitProfile = resolveProfile(easConfig.submit, profile);
  const buildProfile = resolveProfile(easConfig.build, profile);
  if (!submitProfile && !buildProfile) {
    throw new Error(
      `eas.jsonにbuildまたはsubmitの${profile}プロファイルが見つかりません。`,
    );
  }
  const appId = String(
    process.env.ASC_APP_ID ?? submitProfile?.ios?.ascAppId ?? '',
  );

  if (!appId) {
    throw new Error(
      `ASC_APP_IDまたはeas.jsonのsubmit.${profile}.ios.ascAppIdが必要です。`,
    );
  }

  if (
    fixtureMarker?.fixtureOnly === true &&
    fixtureMarker?.externalActionsAllowed === false
  ) {
    if (options.submit) {
      throw new Error(
        'Fixtureでは外部操作が無効です。App Review提出には実プロジェクトを使用してください。',
      );
    }

    console.log('Fixtureモード: 外部操作は無効です。');
    console.log(`EASプロファイル: ${profile}`);
    console.log(`App Storeバージョン: ${version}`);
    console.log(
      `build番号: ${configuredBuildNumber ?? 'App Store Connectでの確認が必要'}`,
    );
    console.log('App Store Connect APIへの接続は行っていません。');
    return;
  }

  const authentication = await resolveAuthentication(appConfig);
  const request = createApiClient(authentication.token);
  const appStoreVersion = await findAppStoreVersion(request, appId, version);
  const build = await findBuild(
    request,
    appId,
    version,
    configuredBuildNumber ? String(configuredBuildNumber) : null,
  );
  const buildNumber = String(build.attributes.version);
  const [currentBuildId, latestSubmission] = await Promise.all([
    getCurrentBuildId(request, appStoreVersion.id),
    getLatestReviewSubmission(request, appId),
  ]);
  const state = appStoreVersion.attributes?.appVersionState ?? 'UNKNOWN';
  const automaticRelease = storeConfig?.apple?.release?.automaticRelease;
  const needsBuildChange = currentBuildId !== build.id;

  console.log(`認証: ${authentication.source}`);
  console.log(`EASプロファイル: ${profile}`);
  console.log(`App Storeバージョン: ${version}`);
  console.log(`build番号: ${buildNumber}`);
  console.log(`バージョン状態: ${state}`);
  console.log(`ビルド紐付け: ${needsBuildChange ? '変更が必要' : '設定済み'}`);
  console.log(
    `公開方式: ${
      automaticRelease === true
        ? '審査承認後に自動公開'
        : automaticRelease === false
          ? '審査承認後に手動公開'
          : 'store.config.jsonから判定できません'
    }`,
  );
  console.log(
    `直近の審査状態: ${latestSubmission?.attributes?.state ?? 'なし'}`,
  );

  if (!options.submit) {
    console.log('状態確認のみ。App Store Connectへの変更は行っていません。');
    return;
  }

  const expectedConfirmation = `${version}/${buildNumber}`;
  if (options.confirm !== expectedConfirmation) {
    throw new Error(`申請には --confirm ${expectedConfirmation} が必要です。`);
  }

  if (!EDITABLE_STATES.has(state)) {
    throw new Error(
      `現在のバージョン状態 (${state}) ではビルド変更や審査提出を行えません。`,
    );
  }

  if (needsBuildChange) {
    await request(
      `/v1/appStoreVersions/${appStoreVersion.id}/relationships/build`,
      {
        method: 'PATCH',
        body: {
          data: { type: 'builds', id: build.id },
        },
      },
    );
    console.log('ビルドをApp Storeバージョンへ紐付けました。');
  }

  const reviewSubmission = await findOrCreateReadySubmission(
    request,
    appId,
    latestSubmission,
  );
  await ensureSubmissionItem(request, reviewSubmission.id, appStoreVersion.id);
  const submitted = await request(
    `/v1/reviewSubmissions/${reviewSubmission.id}`,
    {
      method: 'PATCH',
      body: {
        data: {
          type: 'reviewSubmissions',
          id: reviewSubmission.id,
          attributes: { submitted: true },
        },
      },
    },
  );

  console.log(`審査提出: ${submitted?.data?.attributes?.state ?? '完了'}`);
  console.log(
    `App Store Connect: https://appstoreconnect.apple.com/apps/${appId}/appstore`,
  );
}

main().catch((error) => {
  console.error(`エラー: ${error.message}`);
  process.exitCode = 1;
});

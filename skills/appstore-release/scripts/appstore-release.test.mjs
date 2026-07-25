import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'appstore-release.mjs',
);

async function createWorkspace({
  includeStoreConfig = true,
  buildNumber = '42',
  easConfig = {
    submit: { testflight: { ios: { ascAppId: 'app-123' } } },
  },
} = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'appstore-release-'));
  const ios = {
    bundleIdentifier: 'com.example.samplejournal',
  };
  if (buildNumber) ios.buildNumber = buildNumber;

  const writes = [
    writeFile(
      path.join(directory, 'app.json'),
      JSON.stringify({
        expo: {
          owner: 'sample-owner',
          slug: 'sample-journal',
          version: '2.4.0',
          ios,
        },
      }),
    ),
    writeFile(path.join(directory, 'eas.json'), JSON.stringify(easConfig)),
  ];
  if (includeStoreConfig) {
    writes.push(
      writeFile(
        path.join(directory, 'store.config.json'),
        JSON.stringify({
          apple: { version: '2.4.0', release: { automaticRelease: true } },
        }),
      ),
    );
  }
  await Promise.all(writes);
  return directory;
}

async function createMockApi({
  expectedAuthorization = 'Bearer test-token',
} = {}) {
  const requests = [];
  let submissionCreated = false;

  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body =
      chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const url = new URL(request.url, 'http://localhost');
    requests.push({ method: request.method, path: url.pathname, body });

    if (expectedAuthorization) {
      assert.equal(request.headers.authorization, expectedAuthorization);
    } else {
      assert.match(request.headers.authorization, /^Bearer /);
    }

    const send = (status, payload) => {
      response.writeHead(
        status,
        payload ? { 'Content-Type': 'application/json' } : {},
      );
      response.end(payload ? JSON.stringify(payload) : undefined);
    };

    if (
      request.method === 'GET' &&
      url.pathname === '/v1/apps/app-123/appStoreVersions'
    ) {
      send(200, {
        data: [
          {
            type: 'appStoreVersions',
            id: 'version-1',
            attributes: {
              versionString: '2.4.0',
              platform: 'IOS',
              appVersionState: 'PREPARE_FOR_SUBMISSION',
            },
          },
        ],
      });
    } else if (request.method === 'GET' && url.pathname === '/v1/builds') {
      send(200, {
        data: [
          {
            type: 'builds',
            id: 'build-42',
            attributes: { version: '42', processingState: 'VALID' },
          },
        ],
      });
    } else if (
      request.method === 'GET' &&
      url.pathname === '/v1/builds/build-42/preReleaseVersion'
    ) {
      send(200, {
        data: {
          type: 'preReleaseVersions',
          id: 'pre-1',
          attributes: { version: '2.4.0' },
        },
      });
    } else if (
      request.method === 'GET' &&
      url.pathname === '/v1/appStoreVersions/version-1/relationships/build'
    ) {
      send(200, { data: null });
    } else if (
      request.method === 'PATCH' &&
      url.pathname === '/v1/appStoreVersions/version-1/relationships/build'
    ) {
      send(204);
    } else if (
      request.method === 'GET' &&
      url.pathname === '/v1/apps/app-123/reviewSubmissions'
    ) {
      send(200, {
        data: submissionCreated
          ? [
              {
                type: 'reviewSubmissions',
                id: 'submission-1',
                attributes: { state: 'READY_FOR_REVIEW' },
              },
            ]
          : [],
      });
    } else if (
      request.method === 'POST' &&
      url.pathname === '/v1/reviewSubmissions'
    ) {
      submissionCreated = true;
      send(201, {
        data: {
          type: 'reviewSubmissions',
          id: 'submission-1',
          attributes: { state: 'READY_FOR_REVIEW' },
        },
      });
    } else if (
      request.method === 'GET' &&
      url.pathname === '/v1/reviewSubmissions/submission-1/items'
    ) {
      send(200, { data: [], included: [] });
    } else if (
      request.method === 'POST' &&
      url.pathname === '/v1/reviewSubmissionItems'
    ) {
      send(201, { data: { type: 'reviewSubmissionItems', id: 'item-1' } });
    } else if (
      request.method === 'PATCH' &&
      url.pathname === '/v1/reviewSubmissions/submission-1'
    ) {
      send(200, {
        data: {
          type: 'reviewSubmissions',
          id: 'submission-1',
          attributes: { state: 'WAITING_FOR_REVIEW' },
        },
      });
    } else {
      send(404, { errors: [{ title: `${request.method} ${url.pathname}` }] });
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function runScript(
  workspace,
  baseUrl,
  args = [],
  environment = { ASC_TOKEN: 'test-token' },
) {
  const env = { ...process.env };
  for (const name of [
    'ASC_TOKEN',
    'ASC_ISSUER_ID',
    'ASC_KEY_ID',
    'ASC_PRIVATE_KEY_PATH',
    'ASC_APP_ID',
    'EAS_CLI_PATH',
    'EAS_RELEASE_PROFILE',
  ]) {
    delete env[name];
  }

  return execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: workspace,
    env: {
      ...env,
      ASC_API_BASE_URL: baseUrl,
      ...environment,
    },
  });
}

async function createMockEasCli(workspace) {
  const easRoot = path.join(workspace, 'mock-eas-cli');
  const easCliPath = path.join(easRoot, 'bin', 'run');
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const keyP8 = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const modules = new Map([
    [
      'user/SessionManager.js',
      `module.exports.default = class {
        async ensureLoggedInAsync() {
          return { authenticationInfo: { accessToken: 'expo-token', sessionSecret: null } };
        }
      };`,
    ],
    [
      'commandUtils/context/contextUtils/createGraphqlClient.js',
      'module.exports.createGraphqlClient = () => ({});',
    ],
    [
      'credentials/ios/api/GraphqlClient.js',
      `module.exports.getAscApiKeyForAppSubmissionsAsync = async (_client, params) => {
        if (params.account.name !== 'sample-owner') throw new Error('unexpected owner');
        if (params.projectName !== 'sample-journal') throw new Error('unexpected project');
        if (params.bundleIdentifier !== 'com.example.samplejournal') throw new Error('unexpected bundle');
        return { id: 'eas-key-1' };
      };`,
    ],
    [
      'graphql/queries/AppStoreConnectApiKeyQuery.js',
      `module.exports.AppStoreConnectApiKeyQuery = {
        getByIdAsync: async () => ({
          issuerIdentifier: 'issuer-1',
          keyIdentifier: 'KEY1234567',
          keyP8: ${JSON.stringify(keyP8)},
        }),
      };`,
    ],
  ]);

  await mkdir(path.dirname(easCliPath), { recursive: true });
  await writeFile(easCliPath, '');
  await Promise.all(
    [...modules].map(async ([modulePath, contents]) => {
      const filePath = path.join(easRoot, 'build', modulePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents);
    }),
  );

  return easCliPath;
}

test('通常実行では状態確認だけを行う', async () => {
  const workspace = await createWorkspace();
  const api = await createMockApi();

  try {
    const { stdout } = await runScript(workspace, api.baseUrl);
    assert.match(stdout, /App Storeバージョン: 2\.4\.0/);
    assert.match(stdout, /状態確認のみ/);
    assert.equal(
      api.requests.some((request) => request.method !== 'GET'),
      false,
    );
  } finally {
    await api.close();
  }
});

test('確認文字列が一致した時だけビルドを紐付けて審査へ提出する', async () => {
  const workspace = await createWorkspace();
  const api = await createMockApi();

  try {
    const { stdout } = await runScript(workspace, api.baseUrl, [
      '--submit',
      '--confirm',
      '2.4.0/42',
    ]);
    assert.match(stdout, /ビルドをApp Storeバージョンへ紐付けました/);
    assert.match(stdout, /審査提出: WAITING_FOR_REVIEW/);
    assert.deepEqual(
      api.requests
        .filter((request) => request.method !== 'GET')
        .map((request) => `${request.method} ${request.path}`),
      [
        'PATCH /v1/appStoreVersions/version-1/relationships/build',
        'POST /v1/reviewSubmissions',
        'POST /v1/reviewSubmissionItems',
        'PATCH /v1/reviewSubmissions/submission-1',
      ],
    );
  } finally {
    await api.close();
  }
});

test('確認文字列が異なる場合は変更しない', async () => {
  const workspace = await createWorkspace();
  const api = await createMockApi();

  try {
    await assert.rejects(
      runScript(workspace, api.baseUrl, ['--submit', '--confirm', '2.4.0/41']),
      /--confirm 2\.4\.0\/42/,
    );
    assert.equal(
      api.requests.some((request) => request.method !== 'GET'),
      false,
    );
  } finally {
    await api.close();
  }
});

test('EASに保存されたAPIキーを使って状態確認できる', async () => {
  const workspace = await createWorkspace();
  const easCliPath = await createMockEasCli(workspace);
  const api = await createMockApi({ expectedAuthorization: null });

  try {
    const { stdout } = await runScript(workspace, api.baseUrl, [], {
      EAS_CLI_PATH: easCliPath,
    });
    assert.match(stdout, /認証: EASに保存済みのAPIキー/);
    assert.match(stdout, /状態確認のみ/);
    assert.equal(
      api.requests.some((request) => request.method !== 'GET'),
      false,
    );
  } finally {
    await api.close();
  }
});

test('store.config.jsonとローカルbuild番号がなくても最新ビルドを確認できる', async () => {
  const workspace = await createWorkspace({
    includeStoreConfig: false,
    buildNumber: null,
  });
  const api = await createMockApi();

  try {
    const { stdout } = await runScript(workspace, api.baseUrl);
    assert.match(stdout, /build番号: 42/);
    assert.match(stdout, /公開方式: store\.config\.jsonから判定できません/);
    assert.equal(
      api.requests.some((request) => request.method !== 'GET'),
      false,
    );
  } finally {
    await api.close();
  }
});

test('継承した任意のsubmitプロファイルからApp IDを取得できる', async () => {
  const workspace = await createWorkspace({
    easConfig: {
      submit: {
        base: { ios: { ascAppId: 'app-123' } },
        release: { extends: 'base' },
      },
    },
  });
  const api = await createMockApi();

  try {
    const { stdout } = await runScript(workspace, api.baseUrl, [
      '--profile',
      'release',
    ]);
    assert.match(stdout, /EASプロファイル: release/);
    assert.match(stdout, /状態確認のみ/);
  } finally {
    await api.close();
  }
});

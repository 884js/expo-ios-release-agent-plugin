import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installerPath = path.join(root, 'scripts', 'install.mjs');

async function runInstaller(projectDir) {
  return execFileAsync(
    process.execPath,
    [
      installerPath,
      '--target',
      'codex',
      '--scope',
      'project',
      '--project-dir',
      projectDir,
    ],
  );
}

test('projectスコープでプロジェクト内にスキルを配置する', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'release-install-'));

  await runInstaller(project);

  for (const skillName of [
    'setup',
    'appstore-screenshots',
    'appstore-preflight',
  ]) {
    const destination = path.join(
      project,
      '.agents',
      'skills',
      skillName,
    );
    const stats = await lstat(destination);
    assert.equal(stats.isSymbolicLink(), true);
    assert.equal(
      path.resolve(path.dirname(destination), await readlink(destination)),
      path.join(root, 'skills', skillName),
    );
  }
});

test('projectスコープで親ディレクトリのシンボリックリンクを拒否する', async () => {
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), 'release-install-link-'),
  );
  const project = path.join(workspace, 'project');
  const external = path.join(workspace, 'external');
  await Promise.all([mkdir(project), mkdir(external)]);
  await symlink(external, path.join(project, '.agents'), 'dir');

  await assert.rejects(
    runInstaller(project),
    /親ディレクトリにシンボリックリンクがあります/,
  );

  await assert.rejects(
    lstat(path.join(external, 'skills', 'setup')),
    (error) => error.code === 'ENOENT',
  );
});

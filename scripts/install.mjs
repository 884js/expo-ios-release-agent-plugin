#!/usr/bin/env node

import {
  cp,
  lstat,
  mkdir,
  readlink,
  realpath,
  rm,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const skillsRoot = path.join(pluginRoot, 'skills');
const skillNames = [
  'setup',
  'ios-release',
  'testflight',
  'appstore-screenshots',
  'appstore-info',
  'appstore-release',
];
const supportedTargets = new Set(['codex', 'claude', 'cursor', 'all']);

function printHelp() {
  console.log(`Usage:
  node scripts/install.mjs [--target codex|claude|cursor|all]
                           [--scope user|project]
                           [--project-dir PATH]
                           [--copy]
                           [--force]

Options:
  --target       インストール先。既定はall
  --scope        userは全プロジェクト、projectは指定プロジェクトだけ。既定はuser
  --project-dir  projectスコープの対象。既定は現在のディレクトリ
  --copy         シンボリックリンクではなくコピーする
  --force        このプラグインが作成したリンク、または既存コピーを置き換える
  --help         このヘルプを表示する`);
}

function parseArgs(argv) {
  const options = {
    target: 'all',
    scope: 'user',
    projectDir: process.cwd(),
    copy: false,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--copy') {
      options.copy = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (
      arg === '--target' ||
      arg === '--scope' ||
      arg === '--project-dir'
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} の値が必要です。`);
      }
      index += 1;
      if (arg === '--target') options.target = value;
      if (arg === '--scope') options.scope = value;
      if (arg === '--project-dir') options.projectDir = value;
    } else {
      throw new Error(`不明なオプションです: ${arg}`);
    }
  }

  if (!supportedTargets.has(options.target)) {
    throw new Error(`未対応のtargetです: ${options.target}`);
  }
  if (!['user', 'project'].includes(options.scope)) {
    throw new Error(`未対応のscopeです: ${options.scope}`);
  }

  return options;
}

async function targetDirectories(options) {
  const targets =
    options.target === 'all'
      ? ['codex', 'claude', 'cursor']
      : [options.target];
  const projectDir =
    options.scope === 'project'
      ? await realpath(path.resolve(options.projectDir))
      : null;

  return targets.map((target) => {
    if (options.scope === 'user') {
      const directories = {
        codex: path.join(os.homedir(), '.codex', 'skills'),
        claude: path.join(os.homedir(), '.claude', 'skills'),
        cursor: path.join(os.homedir(), '.cursor', 'skills'),
      };
      return [target, directories[target], null];
    }

    const directories = {
      codex: path.join(projectDir, '.agents', 'skills'),
      claude: path.join(projectDir, '.claude', 'skills'),
      cursor: path.join(projectDir, '.cursor', 'skills'),
    };
    return [target, directories[target], projectDir];
  });
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

async function ensureSafeProjectParent(projectRoot, destination) {
  const parent = path.dirname(destination);
  if (!isWithinDirectory(projectRoot, parent)) {
    throw new Error(`プロジェクト外にはインストールできません: ${parent}`);
  }

  const segments = path.relative(projectRoot, parent).split(path.sep);
  let current = projectRoot;
  for (const segment of segments) {
    if (!segment) continue;
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `インストール先の親ディレクトリにシンボリックリンクがあります: ${current}`,
        );
      }
      if (!stats.isDirectory()) {
        throw new Error(
          `インストール先の親パスがディレクトリではありません: ${current}`,
        );
      }
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }

  await mkdir(parent, { recursive: true });
  const resolvedParent = await realpath(parent);
  if (!isWithinDirectory(projectRoot, resolvedParent)) {
    throw new Error(
      `インストール先がプロジェクト外を参照しています: ${parent}`,
    );
  }
}

async function existingEntry(destination) {
  try {
    const stats = await lstat(destination);
    return {
      stats,
      linkTarget: stats.isSymbolicLink() ? await readlink(destination) : null,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function installSkill(source, destination, options, projectRoot) {
  if (projectRoot) {
    await ensureSafeProjectParent(projectRoot, destination);
  }

  const existing = await existingEntry(destination);
  if (existing) {
    const resolvedExistingTarget = existing.linkTarget
      ? path.resolve(path.dirname(destination), existing.linkTarget)
      : null;
    const ownedLink =
      existing.stats.isSymbolicLink() &&
      resolvedExistingTarget === path.resolve(source);

    if (!options.force) {
      if (ownedLink) return '変更なし';
      throw new Error(
        `既存のスキルを上書きしません: ${destination}\n置き換える場合は内容を確認して--forceを指定してください。`,
      );
    }
    await rm(destination, { recursive: true, force: true });
  }

  await mkdir(path.dirname(destination), { recursive: true });
  if (options.copy) {
    await cp(source, destination, { recursive: true });
    return 'コピー';
  }

  await symlink(source, destination, 'dir');
  return 'リンク';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  for (const [target, directory, projectRoot] of await targetDirectories(
    options,
  )) {
    for (const skillName of skillNames) {
      const source = path.join(skillsRoot, skillName);
      const destination = path.join(directory, skillName);
      const result = await installSkill(
        source,
        destination,
        options,
        projectRoot,
      );
      console.log(`${target}: ${skillName} -> ${destination} (${result})`);
    }
  }
}

main().catch((error) => {
  console.error(`エラー: ${error.message}`);
  process.exitCode = 1;
});

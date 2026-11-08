#!/usr/bin/env node
/**
 * Rebuild the parts of `.git` that sometimes go missing on this machine.
 *
 * Three times now `git status` has answered "not a git repository" while
 * `.git/objects` and `.git/refs` were intact: `HEAD`, `config` and `index` had been
 * removed, which makes git refuse to run at all (even with an explicit --git-dir).
 * The object database was never damaged, so the history can be recovered by writing
 * those three files back:
 *
 *   node dev/git-repair.mjs          # repair in place
 *   node dev/git-repair.mjs --check  # only report
 *
 * The remote URL is taken from `package.json`'s `repository`, so no secret or
 * machine-specific path is baked into this script.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gitDir = join(root, '.git');
const checkOnly = process.argv.includes('--check');

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function healthy() {
  try {
    return git(['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

function refFile(ref) {
  const path = join(gitDir, ref);
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
}

function packedRef(ref) {
  const path = join(gitDir, 'packed-refs');
  if (!existsSync(path)) return '';
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const [sha, name] = line.trim().split(/\s+/);
    if (name === ref && /^[0-9a-f]{40}$/.test(sha || '')) return sha;
  }
  return '';
}

/** The branch with the most recent commit wins; `main` breaks ties. */
function pickBranch() {
  const heads = join(gitDir, 'refs', 'heads');
  if (!existsSync(heads)) return { branch: 'main', sha: packedRef('refs/heads/main') };
  const names = readdirSync(heads, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const ranked = names
    .map((name) => ({ name, sha: refFile(`refs/heads/${name}`), mtime: statSync(join(heads, name)).mtimeMs }))
    .filter((entry) => /^[0-9a-f]{40}$/.test(entry.sha))
    .sort((a, b) => b.mtime - a.mtime || (a.name === 'main' ? -1 : 1));
  const best = ranked[0];
  if (!best) return { branch: 'main', sha: packedRef('refs/heads/main') };
  return { branch: best.name, sha: best.sha };
}

function remoteUrl() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
  const repository = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository && pkg.repository.url) || '';
  return repository.replace(/^git\+/, '');
}

const branch = pickBranch();
const report = {
  gitDir,
  healthy: healthy(),
  head: existsSync(join(gitDir, 'HEAD')),
  config: existsSync(join(gitDir, 'config')),
  index: existsSync(join(gitDir, 'index')),
  objects: existsSync(join(gitDir, 'objects')),
  branch: branch.branch,
  commit: branch.sha || null,
  remote: remoteUrl() || null,
};
console.log(JSON.stringify(report, null, 2));

if (report.healthy) {
  console.log('git: healthy, nothing to do');
  process.exit(0);
}
if (checkOnly) {
  console.log('git: broken — run `node dev/git-repair.mjs` to rebuild HEAD/config/index');
  process.exit(1);
}
if (!report.objects || !branch.sha) {
  console.error('git: .git/objects or the branch ref is missing; restore from a `git bundle` backup instead');
  process.exit(1);
}

writeFileSync(join(gitDir, 'HEAD'), `ref: refs/heads/${branch.branch}\n`);
if (!report.config) {
  const url = remoteUrl();
  const lines = [
    '[core]',
    '\trepositoryformatversion = 0',
    '\tfilemode = false',
    '\tbare = false',
    '\tlogallrefupdates = true',
    '\tignorecase = true',
  ];
  if (url) {
    lines.push(
      '[remote "origin"]',
      `\turl = ${url}`,
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      `[branch "${branch.branch}"]`,
      '\tremote = origin',
      `\tmerge = refs/heads/${branch.branch}`,
    );
  }
  writeFileSync(join(gitDir, 'config'), `${lines.join('\n')}\n`);
}

git(['reset', '--mixed', 'HEAD']);
console.log(`git: repaired — on ${branch.branch} at ${branch.sha.slice(0, 7)}; index rebuilt from HEAD`);
console.log('git: run `git status` to confirm, then `git push` if the remote is behind');

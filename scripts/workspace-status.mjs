#!/usr/bin/env node
/**
 * Every control repository in the workspace, and what has not reached the
 * hub yet — by what each commit since the last tag touched.
 *
 *   node _template/scripts/workspace-status.mjs            # from the workspace
 *   node ../_template/scripts/workspace-status.mjs         # from inside a repository
 *   node _template/scripts/workspace-status.mjs --json     # the same, as data
 *   node _template/scripts/workspace-status.mjs --strict   # exit 1 if anything is owed
 *
 * **"Clean, tagged and pushed" is three questions, and the third hid one.**
 * On 2026-10-15 every repository was clean and pushed and 25 of 31 carried
 * commits after their last tag. Nearly all were tooling — rig sweeps, line
 * endings — which a release would only republish. Four were not: control
 * source in pcf-lookup-search, pcf-star-rating, pcf-toolkit and
 * pcf-action-button, committed and pushed and on no release, so on no form.
 * `git status` and `git describe` both said the workspace was fine.
 *
 * What the hub reads decides the classes (SKILL.md, *Release and the hub
 * contract*):
 *
 *   release   reaches a maker only through a tag — the control's own source,
 *             its manifest (the API reference is read at the tag), the
 *             solution, the build's config, and package.json when its
 *             `dependencies` changed (they are in the bundle)
 *   live      read from the default branch on every sync — docs/, pcfhub.json,
 *             media/, demo/ — so pushed is published
 *   tooling   reaches nobody — scripts/, dev/, SPEC.md, the README, CI, the
 *             lockfile, line endings
 *
 * A commit is the highest class of any path it touched. A path this script
 * does not recognise counts as release, marked as a guess: it is cheaper to
 * look at one than to miss one.
 *
 * Template-side, like sync-rig.mjs: setup.mjs removes it from an adopted
 * repository. Writes nothing.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: workspace-status.mjs [--dir <workspace>] [--json] [--strict]');
    console.log('  --dir     the workspace (default: the nearest one up from here that holds _template/pcfhub.json)');
    console.log('  --json    print the result as JSON instead of a table');
    console.log('  --strict  exit 1 when any repository is dirty, unpushed, or has release commits since its tag');
    process.exit(0);
}

function option(name, fallback) {
    const at = args.indexOf(name);

    return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
}

/** A directory that is a workspace: it holds the template. */
function isWorkspace(where) {
    return existsSync(join(where, '_template', 'pcfhub.json'));
}

/**
 * The nearest workspace walking up from `start`: the directory itself, or
 * the one subdirectory of it that is one (hub-downloads.mjs's rule).
 */
function workspaceRoot(start) {
    let here = resolve(start);

    for (;;) {
        if (isWorkspace(here)) {
            return here;
        }

        let children = [];

        try {
            children = readdirSync(here, { withFileTypes: true })
                .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
                .map((d) => join(here, d.name))
                .filter(isWorkspace);
        } catch {
            children = [];
        }

        if (children.length === 1) {
            return children[0];
        }

        const up = dirname(here);

        if (up === here) {
            return null;
        }

        here = up;
    }
}

function git(repo, gitArgs) {
    try {
        return execFileSync('git', ['-C', repo, ...gitArgs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r/g, '');
    } catch {
        return null;
    }
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'bin', 'obj', 'generated']);

/** Every folder holding a ControlManifest.Input.xml, relative and with forward slashes. */
function controlDirs(repo, dir = repo, found = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
            controlDirs(repo, join(dir, entry.name), found);
        } else if (entry.name === 'ControlManifest.Input.xml') {
            found.push(relative(repo, dir).replace(/\\/g, '/'));
        }
    }

    return found;
}

const LIVE = [/^docs\//, /^pcfhub\.json$/, /^media\//, /^demo\//];
const TOOLING = [
    /^scripts\//, /^dev\//, /^\.github\//, /^\.claude\//, /^\.vscode\//,
    /^SPEC\.md$/, /^README\.md$/, /^LICENSE/, /^package-lock\.json$/,
    /^\.gitattributes$/, /^\.gitignore$/, /^\.eslint/, /^eslint\.config\./, /^\.prettier/, /^\.release-notes/,
];
const BUILD = [/^Solution\//, /^shared\//, /\.pcfproj$/, /^tsconfig\.json$/, /^pcfconfig\.json$/, /^webpack/];

const RANK = { tooling: 0, live: 1, release: 2 };

/** Whether package.json's `dependencies` differ across a commit — they ship in the bundle. */
function dependenciesChanged(repo, hash) {
    const read = (rev) => {
        const text = git(repo, ['show', `${rev}:package.json`]);

        try {
            return JSON.stringify(JSON.parse(text ?? '{}').dependencies ?? {});
        } catch {
            return null;
        }
    };

    return read(`${hash}^`) !== read(hash);
}

/** One path's class, and whether that was a guess. */
function classify(path, controls, repo, hash) {
    if (controls.some((c) => c !== '' && path.startsWith(`${c}/`)) || BUILD.some((r) => r.test(path))) {
        return { cls: 'release', guess: false };
    }
    if (path === 'package.json') {
        return { cls: dependenciesChanged(repo, hash) ? 'release' : 'tooling', guess: false };
    }
    if (LIVE.some((r) => r.test(path))) {
        return { cls: 'live', guess: false };
    }
    if (TOOLING.some((r) => r.test(path))) {
        return { cls: 'tooling', guess: false };
    }

    return { cls: 'release', guess: true };
}

function statusOf(repo) {
    const name = basename(repo);
    const dirty = (git(repo, ['status', '--porcelain']) ?? '').split('\n').filter(Boolean).length;
    const counts = git(repo, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
    const [behind, ahead] = counts ? counts.trim().split(/\s+/).map(Number) : [null, null];
    const tag = (git(repo, ['describe', '--tags', '--abbrev=0']) ?? '').trim() || null;
    let version = null;

    try {
        version = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version ?? null;
    } catch {
        version = null;
    }

    const controls = controlDirs(repo);
    const log = git(repo, ['log', '--no-merges', '--format=%x1e%h%x1f%s', '--name-only', ...(tag ? [`${tag}..HEAD`] : ['HEAD'])]) ?? '';
    const commits = log.split('\x1e').filter((block) => block.trim() !== '').map((block) => {
        const [head, ...rest] = block.split('\n');
        const [hash, subject] = head.split('\x1f');
        const paths = rest.map((p) => p.trim()).filter(Boolean);
        const classes = paths.map((path) => ({ path, ...classify(path, controls, repo, hash) }));
        const cls = classes.reduce((top, c) => (RANK[c.cls] > RANK[top] ? c.cls : top), 'tooling');

        return {
            hash,
            subject,
            class: cls,
            releasePaths: classes.filter((c) => c.cls === 'release').map((c) => (c.guess ? `${c.path} (?)` : c.path)),
        };
    });

    const tally = { release: 0, live: 0, tooling: 0 };
    commits.forEach((c) => (tally[c.class] += 1));

    return {
        name,
        tag,
        version,
        versionTagged: tag !== null && version !== null && tag.replace(/^v/, '') === version,
        dirty,
        ahead,
        behind,
        commits,
        tally,
    };
}

const workspace = option('--dir', null) ? resolve(option('--dir', '.')) : workspaceRoot(process.cwd());

if (!workspace) {
    console.error(`No workspace found from ${process.cwd()}: nothing up from here holds _template/pcfhub.json. Pass --dir.`);
    process.exit(2);
}

const repos = readdirSync(workspace, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_template')
    .map((d) => join(workspace, d.name))
    .filter((dir) => existsSync(join(dir, 'pcfhub.json')) && existsSync(join(dir, '.git')))
    .filter((dir) => {
        try {
            return !String(JSON.parse(readFileSync(join(dir, 'pcfhub.json'), 'utf8')).slug ?? '').includes('__');
        } catch {
            return true;
        }
    })
    .sort();

const results = repos.map(statusOf);
const template = statusOf(join(workspace, '_template'));
const owed = results.filter((r) => r.tally.release > 0);
const unsettled = results.filter((r) => r.dirty > 0 || (r.ahead ?? 0) > 0 || (r.behind ?? 0) > 0);
const untaggedVersion = results.filter((r) => r.tag !== null && !r.versionTagged);

if (args.includes('--json')) {
    console.log(JSON.stringify({ workspace, template: { dirty: template.dirty, ahead: template.ahead, behind: template.behind }, repositories: results }, null, 2));
} else {
    console.log(`Workspace: ${workspace}\n`);

    const header = ['repository', 'tag', 'package', 'dirty', 'ahead', 'release', 'live', 'tooling'];
    const rows = results.map((r) => [
        r.name,
        r.tag ?? '—',
        r.versionTagged ? '=' : (r.version ?? '—'),
        r.dirty ? String(r.dirty) : '',
        r.ahead === null ? 'no upstream' : (r.ahead || r.behind ? `${r.ahead}↑ ${r.behind}↓` : ''),
        r.tally.release ? String(r.tally.release) : '',
        r.tally.live ? String(r.tally.live) : '',
        r.tally.tooling ? String(r.tally.tooling) : '',
    ]);
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
    const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');

    console.log(line(header));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    rows.forEach((row) => console.log(line(row)));
    console.log('\nCommits since each tag: release = reaches a maker only through a tag; live = read from the');
    console.log('default branch, so published once pushed; tooling = reaches nobody. "=" = package.json matches the tag.');

    if (owed.length > 0) {
        console.log(`\nNeeds a release (${owed.length}):`);
        for (const r of owed) {
            console.log(`  ${r.name} — since ${r.tag ?? 'the first commit'}:`);
            r.commits.filter((c) => c.class === 'release').forEach((c) => {
                const paths = c.releasePaths.slice(0, 3).join(', ') + (c.releasePaths.length > 3 ? `, +${c.releasePaths.length - 3}` : '');
                console.log(`    ${c.hash} ${c.subject}  [${paths}]`);
            });
        }
    } else {
        console.log('\nNeeds a release: none.');
    }

    if (untaggedVersion.length > 0) {
        console.log(`\nVersion bumped past its tag: ${untaggedVersion.map((r) => `${r.name} (${r.version} vs ${r.tag})`).join(', ')}`);
    }
    if (unsettled.length > 0) {
        console.log(`\nNot clean or not pushed: ${unsettled.map((r) => `${r.name}${r.dirty ? ` (${r.dirty} dirty)` : ''}${r.ahead ? ` (${r.ahead} unpushed)` : ''}${r.behind ? ` (${r.behind} behind)` : ''}`).join(', ')}`);
    }
    if (template.dirty || template.ahead || template.behind) {
        console.log(`\n_template: ${template.dirty} dirty, ${template.ahead ?? '?'} unpushed, ${template.behind ?? '?'} behind.`);
    }
    console.log(`\n${results.length} repositories; ${owed.length} owe a release; ${unsettled.length} not clean or not pushed.`);
}

if (args.includes('--strict') && (owed.length > 0 || unsettled.length > 0)) {
    process.exit(1);
}

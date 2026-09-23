#!/usr/bin/env node
/**
 * Bring an adopted repository's shared tooling up to the template's current
 * copy, without overwriting anything anybody changed on purpose.
 *
 *   node ../_template/scripts/sync-rig.mjs --into .                 # update what is safe
 *   node ../_template/scripts/sync-rig.mjs --into . --dry-run       # say what it would do
 *   node ../_template/scripts/sync-rig.mjs --into . --add-missing   # and copy absent files in
 *   node ../_template/scripts/sync-rig.mjs --into . --force dev/dom.js
 *   node ../_template/scripts/sync-rig.mjs --report ..              # one line per repository, writes nothing
 *
 * **Why this exists.** An adopted repository's `scripts/` and `dev/` are copies,
 * not links, and nothing ever refreshed them. Measured 2026-09-23 across the 29
 * repositories beside the template: not one carried the current
 * `check-template.mjs`. So the checks a green `npm run check` stands for were
 * whatever the template checked on the day that repository was adopted.
 *
 * ## Stale is not the same as modified, and git history tells them apart
 *
 * A file that differs from the template's current copy is one of two things:
 * an old copy nobody touched (safe to replace), or a copy somebody changed
 * (not safe). The difference is decidable. Every version the template ever
 * shipped is in its own git history, so a target file equal to **any** of them
 * was never edited, only left behind. Equal to none of them, it was edited, and
 * it is reported with a diff summary and left alone unless `--force` names it.
 *
 * The comparison is made *after* the target's own token substitution, because
 * `setup.mjs` rewrites `__CONTROL__` and its siblings in every file it adopts —
 * including comments in `check-template.mjs` — and an adopted copy is therefore
 * never byte-equal to a template blob. Line endings are normalised on both
 * sides for the same reason: `core.autocrlf` rewrites them on checkout.
 *
 * Measured on the same day by `--report`, that split was lopsided in a useful
 * way — most out-of-date copies are safe to replace, and the host never is:
 *
 *   check-template.mjs  26 stale, 3 modified      dom.js    12 stale, 4 modified
 *   serve.js            10 stale, 2 modified      host.js    0 stale, 26 modified
 *
 * ## Files this never writes
 *
 * `dev/host.js`, `fixture.js`, `smoke.js` and the harness pages belong to the
 * control. Every repository has edited its host (the table above), and a
 * suite or fixture is written *for* the control by definition. They are
 * reported, with the template file to compare against, and never touched —
 * merging a newer host into a customised one is a reading job, not a copy.
 *
 * ## Why it runs from the template
 *
 * For the reason `adopt.mjs` and `add-control.mjs` do: it needs the template's
 * git history and its `variants/`, and an adopted repository has neither.
 * `setup.mjs` deletes it on adoption.
 *
 * Like `add-control.mjs`, it refuses a dirty target tree (unless `--force`) so
 * a sync lands as its own reviewable diff.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const template = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What the template owns in an adopted repository. `source` is where the
 * current copy lives in the template, when that differs from `path`; `when`
 * narrows a file to the shapes that carry it; `needs` to the repositories that
 * have the file it serves.
 */
const MANAGED = [
    { path: 'scripts/check-template.mjs' },
    { path: 'scripts/version.mjs' },
    { path: 'scripts/release.mjs' },
    { path: 'scripts/templates/migration.md' },
    // Not for a grid customizer: setup.mjs replaces its dev/ outright with a harness
    // and a suite, because a customizer touches no DOM and nothing there loads these.
    // Loaded by the suite, so only added where the suite loads them: a suite that never
    // loads the bundle (Code-Editor-PCF transpiles pure modules instead) has no use for either.
    { path: 'dev/dom.js', when: notCustomizer, loadedBy: 'dev/smoke.js' },
    { path: 'dev/clock.js', when: notCustomizer, loadedBy: 'dev/smoke.js' },
    { path: 'dev/serve.js', when: notCustomizer },
    // Both exist to serve dev/harness.html; a React repository without the page has no use for either.
    { path: 'dev/fluent-stub.js', source: 'variants/react/dev/fluent-stub.js', when: isReactForm, needs: 'dev/harness.html' },
    { path: 'dev/virtual-bundle.js', source: 'variants/react/dev/virtual-bundle.js', when: isReactForm, needs: 'dev/harness.html' },
];

/** Written for the control; reported against the template's copy for its shape, never written. */
const OWNED = ['dev/host.js', 'dev/fixture.js', 'dev/smoke.js', 'dev/harness.html', 'dev/harness.js'];

/** `--add-missing` adds these to package.json when absent, and never replaces one that is there. */
const SCRIPTS = {
    check: 'node scripts/check-template.mjs',
    bump: 'node scripts/version.mjs',
    release: 'node scripts/release.mjs',
    smoke: 'node dev/smoke.js',
    harness: 'node dev/serve.js',
};

const args = parseArgs(process.argv.slice(2));

/* ---- one repository ------------------------------------------------------ */

function sync(target) {
    const shape = readShape(target);
    const dryRun = Boolean(args['dry-run']);
    const forceAll = args.force.includes(true);

    if (!dryRun && !forceAll) {
        const dirty = gitStatus(target);

        if (dirty !== '') {
            fail(
                `${basename(target)} has uncommitted changes. Commit or stash first so the sync is reviewable\n`
                + `  as its own diff, or pass --force if you are certain.\n\n  ${dirty.split('\n').slice(0, 8).join('\n  ')}`,
            );
        }
    }

    console.log(`\n${basename(target)} (${shape.type}/${shape.framework})${dryRun ? ' — dry run, nothing is written' : ''}\n`);

    let changed = 0;
    let held = 0;

    const entries = classify(target, shape);

    for (const entry of entries) {
        const label = entry.path.padEnd(34);

        if (entry.state === 'current') {
            console.log(`  current    ${label}`);
        } else if (entry.state === 'stale' || (entry.state === 'modified' && (forceAll || args.force.includes(entry.path)))) {
            const verb = entry.state === 'stale' ? 'update ' : 'FORCED ';
            console.log(`  ${verb}    ${label} ${entry.note}`);
            changed += 1;

            if (!dryRun) {
                write(target, entry.path, entry.wanted);
            }
        } else if (entry.state === 'modified') {
            console.log(`  modified   ${label} ${entry.note} — kept; --force ${entry.path} to replace`);
            held += 1;
        } else if (entry.state === 'unused') {
            console.log(`  not used   ${label} — dev/smoke.js never loads it, so it is not added`);
        } else if (entry.state === 'missing') {
            if (args['add-missing']) {
                console.log(`  add        ${label}`);
                changed += 1;

                if (!dryRun) {
                    write(target, entry.path, entry.wanted);
                }
            } else {
                console.log(`  missing    ${label} — --add-missing to copy it in`);
            }
        }
    }

    for (const entry of owned(target, shape)) {
        console.log(`  owned      ${entry.path.padEnd(34)} ${entry.note}`);
    }

    const arriving = args['add-missing'] ? entries.filter((e) => e.state === 'missing').map((e) => e.path) : [];

    changed += syncScripts(target, dryRun, arriving);

    console.log(
        `\n  ${changed} change(s)${dryRun ? ' planned' : ''}, ${held} locally modified file(s) kept.`
        + (changed > 0 && !dryRun ? ' Run npm run check and npm run smoke before committing.' : '')
        + '\n',
    );
}

/**
 * Each managed file for this shape, with the state it is in and the content it
 * should have. `wanted` is the template's current copy with the target's
 * tokens substituted — what `setup.mjs` would have written today.
 */
function classify(target, shape) {
    const tokens = tokensFor(shape);

    return MANAGED.filter((m) => (!m.when || m.when(shape)) && (!m.needs || existsSync(join(target, m.needs)))).map((m) => {
        const source = m.source ?? m.path;
        const wanted = substitute(readFileSync(join(template, source), 'utf8'), tokens);
        const file = join(target, m.path);

        if (!existsSync(file)) {
            const suite = m.loadedBy ? join(target, m.loadedBy) : null;

            // A require, not a mention: a suite explaining why it does *not* load dom.js names it.
            const name = basename(m.path).replace(/\.js$/, '');
            const loads = new RegExp(String.raw`require\(\s*['"]\./${name}(\.js)?['"]\s*\)`);

            if (suite && existsSync(suite) && !loads.test(readFileSync(suite, 'utf8'))) {
                return { path: m.path, state: 'unused', wanted };
            }

            return { path: m.path, state: 'missing', wanted };
        }

        const have = normalise(readFileSync(file, 'utf8'));

        if (have === normalise(wanted)) {
            return { path: m.path, state: 'current', wanted };
        }

        const past = history(source).map((blob) => normalise(substitute(blob, tokens)));

        if (past.includes(have)) {
            const age = past.length - 1 - past.lastIndexOf(have);

            return { path: m.path, state: 'stale', wanted, note: `(${age} template change(s) behind)` };
        }

        return { path: m.path, state: 'modified', wanted, note: lineDelta(have, normalise(wanted)) };
    });
}

function owned(target, shape) {
    const variant = shape.type === 'dataset' ? 'variants/dataset/dev' : shape.type === 'grid_customizer' ? 'variants/grid-customizer/dev' : 'dev';

    return OWNED.filter((p) => existsSync(join(target, p))).map((p) => {
        const donor = `${variant}/${basename(p)}`;
        const reference = existsSync(join(template, donor)) ? donor : p;

        if (!existsSync(join(template, reference))) {
            return { path: p, note: 'the control\'s own; no template counterpart' };
        }

        const same = normalise(readFileSync(join(target, p), 'utf8')) === normalise(readFileSync(join(template, reference), 'utf8'));

        return { path: p, note: same ? 'matches the template' : `the control's own; compare with _template/${reference} by hand` };
    });
}

function syncScripts(target, dryRun, arriving) {
    const file = join(target, 'package.json');

    if (!existsSync(file)) {
        return 0;
    }

    const raw = readFileSync(file, 'utf8');
    const pkg = JSON.parse(raw);
    const absent = Object.keys(SCRIPTS).filter((name) => {
        if (pkg.scripts?.[name] !== undefined) {
            return false;
        }

        // Only offer a script whose file will be there to run: already present, or
        // arriving with this sync. A customizer has no serve.js, so no harness script.
        const script = SCRIPTS[name].split(' ')[1];

        return existsSync(join(target, script)) || arriving.includes(script);
    });

    if (absent.length === 0) {
        return 0;
    }

    if (!args['add-missing']) {
        console.log(`  missing    package.json scripts: ${absent.join(', ')} — --add-missing to add them`);

        return 0;
    }

    console.log(`  add        package.json scripts: ${absent.join(', ')}`);

    if (!dryRun) {
        pkg.scripts = pkg.scripts ?? {};

        for (const name of absent) {
            pkg.scripts[name] = SCRIPTS[name];
        }

        const eol = raw.includes('\r\n') ? '\r\n' : '\n';
        writeFileSync(file, JSON.stringify(pkg, null, 2).replace(/\n/g, eol) + eol);
    }

    return 1;
}

/* ---- every repository beside the template ------------------------------- */

function report(dir) {
    const repos = readdirSync(dir)
        .map((name) => join(dir, name))
        .filter((p) => p !== template && statSync(p).isDirectory() && existsSync(join(p, 'pcfhub.json')));

    const width = Math.max(...repos.map((p) => basename(p).length), 10);

    console.log(`\n${'repository'.padEnd(width)}  stale  modified  missing  current`);

    const totals = new Map();

    for (const repo of repos) {
        let entries;

        try {
            entries = classify(repo, readShape(repo));
        } catch (error) {
            console.log(`${basename(repo).padEnd(width)}  unreadable: ${error.message}`);
            continue;
        }

        const count = (state) => entries.filter((e) => e.state === state);
        const stale = count('stale');
        const modified = count('modified');

        for (const e of entries) {
            const t = totals.get(e.path) ?? { stale: 0, modified: 0 };
            if (e.state === 'stale' || e.state === 'modified') {
                t[e.state] += 1;
            }
            totals.set(e.path, t);
        }

        console.log(
            `${basename(repo).padEnd(width)}  ${String(stale.length).padStart(5)}  ${String(modified.length).padStart(8)}`
            + `  ${String(count('missing').length).padStart(7)}  ${String(count('current').length).padStart(7)}`
            + (modified.length > 0 ? `   modified: ${modified.map((e) => basename(e.path)).join(', ')}` : ''),
        );
    }

    console.log('\nper file (stale = safe to update; modified = edited in that repository):\n');

    for (const [path, t] of totals) {
        console.log(`  ${path.padEnd(34)} ${String(t.stale).padStart(3)} stale  ${String(t.modified).padStart(3)} modified`);
    }

    console.log('\nNothing was written. Run with --into <repo> to update one.\n');
}

/* ---- helpers ------------------------------------------------------------- */

function readShape(target) {
    const file = join(target, 'pcfhub.json');

    if (!existsSync(file)) {
        fail(`${basename(target)} has no pcfhub.json — adopt it first (scripts/adopt.mjs).`);
    }

    const manifest = JSON.parse(readFileSync(file, 'utf8'));

    return {
        type: manifest.control?.type ?? 'field',
        framework: manifest.control?.framework ?? 'standard',
        constructor: manifest.control?.constructor,
        namespace: manifest.control?.namespace,
        slug: manifest.slug,
        title: manifest.name,
    };
}

function notCustomizer(shape) {
    return shape.type !== 'grid_customizer';
}

function isReactForm(shape) {
    return shape.framework === 'react_virtual' && shape.type !== 'grid_customizer';
}

/** The substitutions `setup.mjs` made in this repository, as far as `pcfhub.json` can say. */
function tokensFor(shape) {
    const pairs = [
        ['__CONTROL__', shape.constructor],
        ['__NAMESPACE__', shape.namespace],
        ['__SLUG__', shape.slug],
        ['__TITLE__', shape.title],
    ].filter(([, value]) => typeof value === 'string' && value !== '');

    // Longest first, as setup.mjs does, so a short token cannot eat a longer one.
    return pairs.sort((a, b) => b[0].length - a[0].length);
}

function substitute(text, tokens) {
    return tokens.reduce((out, [token, value]) => out.split(token).join(value), text);
}

function normalise(text) {
    return text.replace(/\r\n/g, '\n');
}

const historyCache = new Map();

/**
 * Every version of a template file, oldest first, following renames — a file
 * that moved (a rig that started life at the root and now lives in a variant)
 * still counts its old copies as the template's.
 */
function history(path) {
    if (historyCache.has(path)) {
        return historyCache.get(path);
    }

    let log = '';

    try {
        log = execFileSync('git', ['log', '--follow', '--format=%H', '--name-only', '--', path], {
            cwd: template, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024,
        });
    } catch {
        log = '';
    }

    const blobs = [];
    const lines = log.split('\n').filter((line) => line.trim() !== '');

    for (let i = 0; i + 1 < lines.length; i += 2) {
        try {
            blobs.push(execFileSync('git', ['show', `${lines[i]}:${lines[i + 1]}`], {
                cwd: template, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024,
            }));
        } catch {
            // A commit that deleted the file has no blob at that path; skip it.
        }
    }

    blobs.reverse();
    historyCache.set(path, blobs);

    return blobs;
}

function lineDelta(have, wanted) {
    const a = new Set(have.split('\n'));
    const b = new Set(wanted.split('\n'));
    const onlyHere = [...a].filter((line) => !b.has(line)).length;
    const onlyThere = [...b].filter((line) => !a.has(line)).length;

    return `(${onlyHere} line(s) only here, ${onlyThere} only in the template)`;
}

function write(target, path, content) {
    const file = join(target, path);
    const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const eol = existing.includes('\r\n') ? '\r\n' : '\n';

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, normalise(content).replace(/\n/g, eol));
}

function gitStatus(target) {
    try {
        return execFileSync('git', ['status', '--porcelain'], { cwd: target, encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch {
        return '';
    }
}

/** `--force` alone forces everything; `--force <path>` one file, and may repeat. */
function parseArgs(argv) {
    const out = { force: [] };

    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i].startsWith('--') ? argv[i].slice(2) : null;

        if (key === null) {
            continue;
        }

        if (key === 'dry-run' || key === 'add-missing') {
            out[key] = true;
        } else if (key === 'force') {
            const next = argv[i + 1];

            if (next !== undefined && !next.startsWith('--')) {
                out.force.push(next.replace(/\\/g, '/'));
                i += 1;
            } else {
                out.force.push(true);
            }
        } else {
            out[key] = argv[i + 1];
            i += 1;
        }
    }

    return out;
}

function fail(message) {
    console.error(`\n  ${message}\n`);
    process.exit(1);
}

/* ---- run ----------------------------------------------------------------- */

// Last, so every module-level constant above exists before anything reads it.
if (args.report) {
    report(resolve(process.cwd(), args.report));
} else if (args.into) {
    sync(resolve(process.cwd(), args.into));
} else {
    fail('--into <repo> or --report <dir> is required.');
}

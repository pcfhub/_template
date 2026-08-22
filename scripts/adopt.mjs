#!/usr/bin/env node
/**
 * Copy this template's hub contract into a PCF repository that already exists.
 *
 *   node scripts/adopt.mjs --into ../Code-Editor-PCF --dry-run
 *   node scripts/adopt.mjs --into ../Code-Editor-PCF \
 *     --tagline "Edit JSON and XML in a multiline column." --category text-editors
 *
 * This is the counterpart to setup.mjs, not a mode of it. setup.mjs adopts *this
 * template* by rewriting placeholders in place; it assumes template-shaped
 * filenames, and it deletes TEMPLATE.md, variants/ and docs/migration.md on the
 * way through. Pointed at a working repository it would find no placeholders to
 * fill and files it should not remove. So adoption runs the other way round:
 * the template is the donor, `--into` is the target, and nothing already in the
 * target is ever overwritten.
 *
 * Every write is additive. A file that exists is left alone and reported as
 * skipped, which makes the script safe to re-run as the gaps get filled in.
 * Anything that cannot be derived from the target is asked for, or — under
 * `--yes` — required as a flag, exactly as in setup.mjs.
 *
 * What it deliberately does not do:
 *
 *   - Guess `demo.fidelity`. It writes "none", which is where the template
 *     starts and the only value that is honest without reading the control.
 *   - Rewrite an existing pcfhub.json, workflow, or doc page.
 *   - Decide `release.artifacts` silently. It reads the target's release
 *     workflow and reports what it concluded, because the answer depends on
 *     what that workflow *attaches*, not on what msbuild produces.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const template = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = parseArgs(process.argv.slice(2));

if (!args.into) {
    fail('--into <path> is required: the existing repository to adopt.');
}

const target = resolve(process.cwd(), args.into);

if (!existsSync(target)) {
    fail(`--into points at "${args.into}", which does not exist.`);
}

if (target === template) {
    fail('--into points at the template itself. Use scripts/setup.mjs to adopt this template in place.');
}

const dryRun = Boolean(args['dry-run']);

const SKIP = new Set(['.git', 'node_modules', 'out', 'bin', 'obj', 'generated']);

// ---------------------------------------------------------------- discovery
//
// Everything below is read out of the target rather than asked for. A repo that
// builds already knows its own namespace, constructor and control type — asking
// the user to retype them invites a disagreement between pcfhub.json and the
// manifest, which is the one class of mistake the hub resolves silently in
// favour of the manifest.

const manifestPath = findManifest(target);

if (!manifestPath) {
    fail(`No */ControlManifest.Input.xml under ${basename(target)}. Is this a PCF repository?`);
}

const manifestXml = readFileSync(join(target, manifestPath), 'utf8');
const controlDir = manifestPath.split('/')[0];

const constructor = attr(manifestXml, 'constructor') ?? controlDir;
const namespace = attr(manifestXml, 'namespace');
const manifestVersion = attr(manifestXml, 'version');
const declaredType = attr(manifestXml, 'control-type') ?? 'standard';

if (!namespace) {
    fail(`${manifestPath} has no namespace attribute on <control>.`);
}

/*
 * The hub's ControlManifestParser resolves dataset -> virtual -> field, in that
 * order, and re-derives it at every release regardless of what pcfhub.json
 * says. Deriving it the same way here is the only way the two can agree.
 */
const controlType = /<data-set[\s>]/.test(manifestXml)
    ? 'dataset'
    : declaredType === 'virtual'
      ? 'virtual'
      : 'field';

/*
 * `react` (bundled) is the case the manifest cannot express: a virtual control
 * declares platform libraries, but a control that packages React into its own
 * bundle looks exactly like a standard one from here. So it is read off
 * package.json dependencies — a runtime `react` dependency in a non-virtual
 * control is the signature — and reported rather than assumed.
 */
const pkgPath = join(target, 'package.json');
const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};
const bundlesReact = Boolean(pkg.dependencies?.react);

const framework = declaredType === 'virtual'
    ? 'react_virtual'
    : bundlesReact
      ? 'react'
      : 'standard';

const solutionDir = findSolutionDir(target);
const solutionProject = solutionDir ? findSolutionProject(target, solutionDir) : null;
const solutionVersion = solutionDir ? solutionXmlVersion(target, solutionDir) : null;

const remote = gitRemote(target);

// ------------------------------------------------------------------ answers
//
// Same shape as setup.mjs: derive where the target can answer, prompt where it
// cannot, and under --yes require a flag rather than falling back to a default.
// TAGLINE and CATEGORY have no derive for the same reason they have none there
// — nothing in the repository knows them, and a guess would ship to the hub.

const rules = {
    SLUG: {
        question: 'Hub slug (the /components/… URL, and the pcfhub.json slug)',
        derive: () => (remote?.repo ? kebab(remote.repo) : kebab(constructor)),
        test: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        hint: 'lowercase words separated by single hyphens',
    },
    TITLE: {
        question: 'Display name',
        derive: () => title(constructor),
        test: /^.{1,191}$/,
        hint: 'up to 191 characters',
    },
    TAGLINE: {
        question: 'One-line description',
        example: 'Edit JSON, XML and other code in a multiline text column.',
        test: /^.{1,255}$/,
        hint: 'up to 255 characters',
    },
    CATEGORY: {
        question: 'Hub category slug',
        example: 'text-editors',
        test: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        hint: 'lowercase words separated by single hyphens',
    },
    OWNER: {
        question: 'GitHub owner',
        derive: () => remote?.owner ?? null,
        test: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
        hint: 'a GitHub user or organisation',
    },
    REPO: {
        question: 'GitHub repository name',
        derive: (a) => remote?.repo ?? a.SLUG,
        test: /^[A-Za-z0-9._-]+$/,
        hint: 'the repository name only, not the URL',
    },
};

const answers = {};
const rl = args.yes || dryRun ? null : createInterface({ input: process.stdin, output: process.stdout });

for (const [token, rule] of Object.entries(rules)) {
    const fallback = args[token.toLowerCase()] ?? rule.derive?.(answers) ?? null;

    for (;;) {
        let value = fallback;

        if (rl) {
            const suffix = fallback ? ` [${fallback}]` : rule.example ? ` (e.g. ${rule.example})` : '';
            const typed = (await rl.question(`${rule.question}${suffix}: `)).trim();
            value = typed === '' ? fallback : typed;
        }

        if (value && rule.test.test(value)) {
            answers[token] = value;
            break;
        }

        const problem = value ? `"${value}" is not valid — expected ${rule.hint}.` : 'A value is required.';

        if (!rl) {
            fail(`${token}: ${problem}${dryRun ? ' Pass it as a flag to preview the full plan.' : ''}`);
        }

        console.error(`  ${problem}`);
    }
}

rl?.close();

answers.CONTROL = constructor;
answers.NAMESPACE = namespace;

// -------------------------------------------------------------------- plan

const written = [];
const skipped = [];
const notes = [];

/*
 * pcfhub.json first, because it is the only file the hub strictly requires and
 * the only one this script composes rather than copies. Everything it names —
 * the manifest path, the docs directory, the logo — is written to match what
 * the target actually has, so `npm run check` passes on the result.
 */
put('pcfhub.json', () => `${JSON.stringify({
    schemaVersion: 1,
    slug: answers.SLUG,
    name: answers.TITLE,
    tagline: answers.TAGLINE,
    category: answers.CATEGORY,
    tags: [],
    control: {
        namespace,
        constructor,
        type: controlType,
        framework,
        manifestPath,
    },
    links: {
        homepage: `https://github.com/${answers.OWNER}/${answers.REPO}`,
        support: `https://github.com/${answers.OWNER}/${answers.REPO}/issues`,
        license: 'MIT',
    },
    docs: { path: 'docs' },
    media: { logo: 'media/logo.png', screenshots: [] },
    demo: { fidelity: 'none', presets: [] },
}, null, 4)}\n`);

// The one script that catches the rest of this list going stale.
put('scripts/check-template.mjs', () => readFileSync(join(template, 'scripts', 'check-template.mjs'), 'utf8'));

put('SPEC.md', () => substitute(readFileSync(join(template, 'SPEC.md'), 'utf8')));

for (const page of readdirSync(join(template, 'docs'))) {
    // migration.md ships pinned to ">=1.0.0" and matches no release of a
    // control below 1.0.0 — the same reason setup.mjs deletes it. An adopted
    // control may well be past 1.0.0, but whether it has anything to migrate
    // from is a question only its author can answer.
    if (page === 'migration.md') {
        continue;
    }

    put(`docs/${page}`, () => substitute(readFileSync(join(template, 'docs', page), 'utf8')));
}

for (const asset of readdirSync(join(template, 'media'))) {
    put(`media/${asset}`, null, join(template, 'media', asset));
}

/*
 * Workflows are copied only into a repository that has none — `put` skips what
 * exists, and a repo that already releases has a workflow that works.
 *
 * When it does copy, the solution directory is substituted alongside the
 * control name, because the template hardcodes both and
 * `working-directory: Solution` is otherwise wrong in every adopted repo.
 */
for (const flow of ['build.yml', 'release.yml']) {
    put(`.github/workflows/${flow}`, () => substituteWorkflow(
        readFileSync(join(template, '.github', 'workflows', flow), 'utf8'),
    ));
}

// ------------------------------------------------------ package.json scripts
//
// check and lint, because neither exists in a repo scaffolded by `pac pcf init`
// and check-template.mjs is inert without the first. The lint glob is pointed
// at the real control directory — the template's is `eslint __CONTROL__`, which
// in an adopted repo lints nothing and exits green.

if (existsSync(pkgPath)) {
    const before = readFileSync(pkgPath, 'utf8');
    const scripts = { ...(pkg.scripts ?? {}) };
    const added = [];

    if (!scripts.check) {
        scripts.check = 'node scripts/check-template.mjs';
        added.push('check');
    }

    if (!scripts.lint) {
        scripts.lint = `eslint ${controlDir} --ext .ts,.tsx`;
        added.push('lint');
    }

    if (added.length > 0) {
        const indent = /^\{\r?\n(\s+)"/.exec(before)?.[1]?.length ?? 2;

        if (!dryRun) {
            writeFileSync(pkgPath, `${JSON.stringify({ ...pkg, scripts }, null, indent)}\n`);
        }

        written.push(`package.json (added ${added.join(', ')})`);
    } else {
        skipped.push('package.json (check and lint already present)');
    }
}

// ------------------------------------------------------------------- notes
//
// Findings rather than actions: things a human has to decide, gathered while
// the target was being read so that nobody has to go looking for them.

const features = [...manifestXml.matchAll(/<uses-feature\s+name="([^"]+)"/g)].map((m) => m[1]);

if (features.length > 0) {
    const used = grepControl(target, controlDir, /context\.(device|webAPI|utils)\b/);

    notes.push(used.length === 0
        ? `${manifestPath} declares ${features.length} <uses-feature> (${features.join(', ')}) and the control `
          + 'calls none of context.device, context.webAPI or context.utils. Every entry is an install-time '
          + 'permission prompt for the customer. Delete the ones nothing uses.'
        : `${manifestPath} declares ${features.length} <uses-feature>. Cross-check them against the `
          + `${used.length} call site(s) found and delete any that are unused.`);
}

notes.push(releaseArtifactsNote());

if (manifestVersion && solutionVersion && manifestVersion !== solutionVersion) {
    notes.push(`Version disagreement: ${manifestPath} says ${manifestVersion}, `
        + `${solutionDir}/src/Other/Solution.xml says ${solutionVersion}. CI checks the tag against both.`);
}

if (pkg.version && manifestVersion && pkg.version !== manifestVersion) {
    notes.push(`Version disagreement: package.json says ${pkg.version}, ${manifestPath} says ${manifestVersion}.`);
}

const pcfproj = findPcfproj(target);

if (pcfproj && !/<PcfBuildMode>\s*production\s*<\/PcfBuildMode>/.test(readFileSync(join(target, pcfproj), 'utf8'))) {
    notes.push(`${pcfproj} does not set <PcfBuildMode>production</PcfBuildMode>, so the packed solution `
        + 'ships a development bundle — eval-wrapped and roughly twice the size.');
}

/*
 * Everything below is about pcfhub.json, and which half applies depends on
 * whether this run wrote it. On a re-run — or on a repo that was adopted by
 * hand — it did not, and saying "written as none" about a file left untouched
 * sends the reader looking for an edit that is not there. So the existing file
 * is read back and compared against what discovery concluded instead.
 */
if (written.includes('pcfhub.json')) {
    if (framework === 'react') {
        notes.push('control.framework was written as "react" (bundled) because package.json has a runtime '
            + 'react dependency. If the platform supplies React instead, this should be react_virtual — say why '
            + 'in SPEC.md either way.');
    }

    notes.push('demo.fidelity was written as "none". Nothing here can tell whether the control can run in '
        + "the hub's harness — read the demo section of the skill and set it deliberately.");
} else {
    notes.push(...comparePcfhubJson());
}

// ------------------------------------------------------------------ report

console.log(`\n  ${dryRun ? 'Would adopt' : 'Adopted'} ${basename(target)} as a ${framework} ${controlType} control.\n`);
console.log(`    control          ${namespace}.${constructor} (${manifestPath})`);
console.log(`    solution         ${solutionProject ?? '(none found)'}`);
console.log(`    slug             ${answers.SLUG}\n`);

if (written.length > 0) {
    console.log(`  ${dryRun ? 'Would write' : 'Written'} (${written.length}):`);
    for (const line of written) {
        console.log(`    + ${line}`);
    }
    console.log('');
}

if (skipped.length > 0) {
    console.log(`  Left alone (${skipped.length}) — nothing here is ever overwritten:`);
    for (const line of skipped) {
        console.log(`    · ${line}`);
    }
    console.log('');
}

console.log('  Needs a decision:');
for (const note of notes.filter(Boolean)) {
    console.log(`    ! ${note.replace(/\s+/g, ' ')}`);
}

console.log(`
Next:
  1. npm run check — it should pass. If it does not, the message names the gap.
  2. Fill in the docs pages that were copied in; delete the ones that do not
     apply rather than shipping them with placeholder text.
  3. Replace media/logo.png — the one copied in is the template's placeholder.
  4. Work the "needs a decision" list above.
  5. Add the repository to PCFHub with the slug "${answers.SLUG}".
`);

// ------------------------------------------------------------------ helpers

/** Write `relative` in the target, unless it already exists. Never overwrites. */
function put(relative, render, copyFrom) {
    const path = join(target, relative);

    if (existsSync(path)) {
        skipped.push(relative);
        return;
    }

    if (!dryRun) {
        mkdirSync(dirname(path), { recursive: true });

        if (copyFrom) {
            cpSync(copyFrom, path);
        } else {
            writeFileSync(path, render());
        }
    }

    written.push(relative);
}

function substitute(text) {
    let out = text;

    for (const [token, value] of Object.entries(answers)) {
        out = out.split(`__${token}__`).join(value);
    }

    return out;
}

/*
 * The template's workflows hardcode `Solution` as a directory name in two
 * shapes. Anchored replacements rather than a blanket rename, because the word
 * also appears in prose and in `Solution.xml`, whose name is fixed by the
 * solution format and must survive.
 */
function substituteWorkflow(text) {
    let out = substitute(text);

    if (solutionDir && solutionDir !== 'Solution') {
        out = out.split('Solution/').join(`${solutionDir}/`);
        out = out.split('working-directory: Solution').join(`working-directory: ${solutionDir}`);
    }

    if (solutionProject && solutionProject !== 'Solution.cdsproj') {
        out = out.split('Solution.cdsproj').join(solutionProject);
    }

    return out;
}

/*
 * Whether pcfhub.json needs an explicit `release.artifacts` block depends on
 * what the release workflow *attaches*, not on what msbuild names. The hub's
 * defaults are `*_managed.zip` and `*_unmanaged.zip`; msbuild names the
 * unmanaged zip after the project file, so a workflow that attaches it under
 * that raw name matches neither pattern and needs the block. The template's
 * workflow renames it to `<BaseName>_unmanaged.zip` by glob, which normalises
 * any project name — so a repo that copies it in needs no block at all.
 */
function releaseArtifactsNote() {
    const flow = join(target, '.github', 'workflows', 'release.yml');

    if (!existsSync(flow)) {
        return "No .github/workflows/release.yml was present, so the template's was copied in. It renames "
            + 'the unmanaged zip to *_unmanaged.zip by glob, so pcfhub.json needs no release.artifacts block.';
    }

    const yml = readFileSync(flow, 'utf8');

    if (/_unmanaged\.zip/.test(yml)) {
        return "The existing release.yml attaches a *_unmanaged.zip, which matches the hub's default glob. "
            + 'No release.artifacts block needed — leave it out.';
    }

    return "The existing release.yml does not attach anything matching *_unmanaged.zip, so the hub's "
        + 'default glob will find no unmanaged download. Add an explicit release.artifacts block to '
        + 'pcfhub.json naming the zips it does attach, or make the workflow rename them.';
}

/*
 * A pcfhub.json that was already here is the interesting case, not the boring
 * one: it was written by hand or by an earlier run, and the values this script
 * derives from the manifest are the ones the hub will derive too. Where the two
 * disagree the manifest wins silently on the hub, so a disagreement is worth
 * more than the file being present is.
 */
function comparePcfhubJson() {
    let existing;

    try {
        existing = JSON.parse(readFileSync(join(target, 'pcfhub.json'), 'utf8'));
    } catch (error) {
        return [`pcfhub.json is already here but is not readable as JSON: ${error.message}`];
    }

    const found = [];
    const compare = [
        ['control.type', existing.control?.type, controlType],
        ['control.framework', existing.control?.framework, framework],
        ['control.constructor', existing.control?.constructor, constructor],
        ['control.namespace', existing.control?.namespace, namespace],
        ['control.manifestPath', existing.control?.manifestPath, manifestPath],
    ];

    for (const [key, was, derived] of compare) {
        if (was !== undefined && was !== derived) {
            found.push(`pcfhub.json says ${key} is "${was}", but ${manifestPath} describes "${derived}". `
                + 'The hub re-derives this from the manifest at every release, so the manifest wins.');
        }
    }

    if (existing.media === undefined) {
        found.push('pcfhub.json has no media block, so the component page publishes with no logo. '
            + 'check-template.mjs optional-chains it, so this passes the check rather than failing it.');
    }

    if (existing.demo?.fidelity === undefined) {
        found.push('pcfhub.json has no demo.fidelity, so the hub shows no demo. That may be right — but it '
            + 'is worth being a decision rather than an omission.');
    }

    return found;
}

function findManifest(dir) {
    for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry) || !isDir(join(dir, entry))) {
            continue;
        }

        if (existsSync(join(dir, entry, 'ControlManifest.Input.xml'))) {
            return `${entry}/ControlManifest.Input.xml`;
        }
    }

    return null;
}

function findSolutionDir(dir) {
    for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry) || !isDir(join(dir, entry))) {
            continue;
        }

        if (existsSync(join(dir, entry, 'src', 'Other', 'Solution.xml'))) {
            return entry;
        }
    }

    return null;
}

function findSolutionProject(dir, solution) {
    return readdirSync(join(dir, solution)).find((entry) => entry.endsWith('.cdsproj')) ?? null;
}

function findPcfproj(dir) {
    return readdirSync(dir).find((entry) => entry.endsWith('.pcfproj')) ?? null;
}

function solutionXmlVersion(dir, solution) {
    const path = join(dir, solution, 'src', 'Other', 'Solution.xml');

    return existsSync(path) ? (/<Version>([^<]+)<\/Version>/.exec(readFileSync(path, 'utf8'))?.[1] ?? null) : null;
}

/** The `<control>` element's attributes — matched, not parsed, as elsewhere. */
function attr(xml, name) {
    const element = /<control\b[^>]*>/.exec(xml)?.[0] ?? '';

    return new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(element)?.[1] ?? null;
}

function grepControl(dir, control, pattern) {
    const hits = [];

    for (const path of walk(join(dir, control))) {
        if (/\.tsx?$/.test(path) && pattern.test(readFileSync(path, 'utf8'))) {
            hits.push(path);
        }
    }

    return hits;
}

function gitRemote(dir) {
    try {
        const url = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();

        const match = /github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);

        return match ? { owner: match[1], repo: match[2] } : null;
    } catch {
        return null;
    }
}

function* walk(dir) {
    if (!existsSync(dir)) {
        return;
    }

    for (const entry of readdirSync(dir)) {
        if (SKIP.has(entry)) {
            continue;
        }

        const path = join(dir, entry);

        if (isDir(path)) {
            yield* walk(path);
        } else {
            yield path;
        }
    }
}

function isDir(path) {
    return statSync(path).isDirectory();
}

function kebab(value) {
    return value
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[_\s]+/g, '-')
        .toLowerCase();
}

function title(value) {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
}

function parseArgs(argv) {
    const out = {};

    for (let i = 0; i < argv.length; i += 1) {
        if (!argv[i].startsWith('--')) {
            continue;
        }

        const key = argv[i].slice(2);

        if (key === 'yes' || key === 'dry-run') {
            out[key] = true;
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

#!/usr/bin/env node
/**
 * Add a second control to a repository that has already been adopted.
 *
 *   node scripts/add-control.mjs --into ../pcf-toolkit --control LinkColumn --type dataset
 *   node scripts/add-control.mjs --into ../pcf-toolkit --control LinkColumn --type dataset \
 *     --title "Link Column" --tagline "Render a URL column as a link." --dry-run
 *
 * **One repository may hold more than one control, and almost nothing about the
 * build had to change for that to be true.** `pcf-scripts` finds controls by
 * walking the project for directories containing a `ControlManifest.Input.xml`
 * (`node_modules/pcf-scripts/buildContext.js`, `findControlFolders`) and builds
 * each into `out/controls/<Constructor>/`. The `.pcfproj` globs the whole
 * directory and the `.cdsproj` references the `.pcfproj`, so neither names a
 * control at all. Nothing here edits either of them, and that is not an
 * omission — there is nothing in them to edit.
 *
 * What *is* one-per-repository is the hub. `pcfhub.json` is read from the
 * repository root, holds a single `control` object, and its `slug` must match
 * the component being published. So a second control ships inside the same
 * solution and is invisible on PCFHub except in prose. This script does not
 * touch `pcfhub.json` for that reason; it prints what the author now has to
 * decide instead. See the note it ends on.
 *
 * ## Why this is a separate script, and why it runs from the template
 *
 * The same reasoning as `adopt.mjs`, arrived at from the other direction.
 * `setup.mjs` rewrites *this template* in place and, on the way through,
 * deletes `variants/` — the donor sources for every shape but the field one.
 * A script living inside an adopted repository would therefore have nothing
 * left to copy from. So this runs the way `adopt.mjs` does: the template is the
 * donor, `--into` is the target, and every write is additive.
 *
 * ## One .pcfproj per control, which is not optional
 *
 * A code component project may hold **exactly one** control. Microsoft's ALM
 * guidance says so outright — a solution project references many component
 * projects, "whereas code component projects may only contain a single code
 * component" — and three separate pieces of tooling enforce it:
 *
 *   - `pac pcf push` refuses a project with two manifests: "Found more than one
 *     project source file named 'ControlManifest.Input.xml'." That is the inner
 *     development loop, so a repository that breaks it is unusable day to day.
 *   - `Microsoft.PowerApps.MSBuild.Pcf.targets` globs `**\/ControlManifest.Input.xml`
 *     from the project directory and runs `npm run build` there.
 *   - The solution packer enumerates the *subfolders* of a referenced project's
 *     `OutputPath` as controls, so `OutputPath` has to be a controls root with
 *     the control one level below it.
 *
 * So this script does not merely add a directory. It puts every control in its
 * own project folder, `<Control>/<Control>/`, with a `.pcfproj` beside it, and
 * has `Solution.cdsproj` reference each one. `npm run build` at the repository
 * root then runs each project in turn, and all of them still write into the one
 * `out/controls/<Constructor>/` that the dev rigs, `pcfhub.json` and both shared
 * workflows already read.
 *
 * **That means the first control moves too, and this script is therefore not
 * purely additive.** A repository adopted from the template has its control at
 * the root beside a root `.pcfproj`, which is correct while there is one control
 * and wrong the moment there are two. Migrating it is the only way to get a
 * layout the platform tooling accepts, so the script refuses to run against a
 * dirty git tree — the move should be reviewable as its own diff.
 *
 * **Beyond that migration, nothing already in the target is overwritten**, and
 * the protection is in two layers rather than one:
 *
 *   - A control directory that already exists is a hard `fail()`. By the time
 *     anyone re-runs this, `<Control>/index.ts` is the file they have been
 *     writing, and merging a fresh scaffold into it half-way is worse than
 *     refusing. Delete the directory and re-run if that is really what you want.
 *   - Everywhere else, a file that exists is left alone and reported as skipped
 *     — so a run interrupted part-way through the *shared* files (`demo/`,
 *     `package.json`) picks up where it stopped.
 *
 * `setup.mjs` deletes this file on adoption, alongside `adopt.mjs` and
 * `verify-adoption.mjs`, for the reason written there: it is a template-side
 * tool, and it carries placeholder tokens in its own source that
 * `check-template.mjs` would otherwise fail on.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const template = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Kept in step with setup.mjs and check-template.mjs. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'bin', 'obj', 'generated']);

/** See setup.mjs, where these are explained at length. Same values, on purpose. */
const REACT_VERSION = '16.14.0';
const FLUENT_VERSION = '9.46.2';

const args = parseArgs(process.argv.slice(2));

if (!args.into) {
    fail('--into <path> is required: the adopted repository to add a control to.');
}

const target = resolve(process.cwd(), args.into);

if (!existsSync(target)) {
    fail(`--into points at "${args.into}", which does not exist.`);
}

if (target === template) {
    fail(
        '--into points at the template itself. The template has one control by design; '
        + 'adopt it with scripts/setup.mjs first, then add a sibling to the result.',
    );
}

const dryRun = Boolean(args['dry-run']);

/*
 * This script moves the first control's sources, so the working tree has to be
 * clean going in — a migration mixed into unrelated edits is one nobody can
 * review, and `git status` is the only undo it has.
 *
 * A target that is not a git repository is allowed through: the check is a
 * courtesy where it can be offered, not a requirement of its own.
 */
if (!dryRun && !args.force) {
    let dirty = '';

    try {
        dirty = execFileSync('git', ['status', '--porcelain'], { cwd: target, encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch {
        dirty = '';
    }

    if (dirty !== '') {
        fail(
            `${basename(target)} has uncommitted changes, and this script moves the first control's sources\n`
            + '  into a project folder of its own. Commit or stash first so the move is reviewable as its\n'
            + `  own diff, or pass --force if you are certain.\n\n  ${dirty.split('\n').slice(0, 8).join('\n  ')}`,
        );
    }
}

// --------------------------------------------------------------------- shape

const type = args.type ?? 'field';
const framework = args.framework ?? 'standard';

if (type === 'grid-customizer') {
    fail(
        'A grid customizer cannot be added as a sibling, and the reason is structural rather than\n'
        + '  an omission. Scaffolding one replaces dev/ outright (a customizer touches no DOM, so the\n'
        + '  form-shaped host and dom.js are files nothing would load) and rewrites pcfhub.json\'s\n'
        + '  control.type, framework and demo.host. Every one of those is destructive, and this script\n'
        + '  never overwrites. Scaffold a customizer into its own repository with\n'
        + '  `setup.mjs --type grid-customizer`.',
    );
}

if (!['field', 'dataset'].includes(type)) {
    fail(`--type must be "field" or "dataset", not "${type}".`);
}

if (!['standard', 'react'].includes(framework)) {
    fail(`--framework must be "standard" or "react", not "${framework}".`);
}

/*
 * Where each shape's sources come from, and which half of the dev rig travels
 * with them.
 *
 * `dom.js`, `clock.js` and `serve.js` are deliberately *not* in any of these
 * lists. They are the same files for every DOM shape and already sit at `dev/`
 * in the target, so copying them into the sibling's directory would be a second
 * copy that drifts — the exact thing setup.mjs's dataset branch avoids by
 * overlaying its rig rather than replacing it.
 *
 * A react sibling gets no `harness.html` or `harness.js`, for the reason
 * setup.mjs gives: a virtual bundle expects Fluent under a global, and
 * `@fluentui/react-components` ships no UMD build to put in a `<script src>`.
 */
const DONORS = {
    'field:standard': {
        sources: '__CONTROL__',
        dev: 'dev',
        devFiles: ['harness.html', 'harness.js', 'host.js', 'smoke.js'],
    },
    'field:react': {
        sources: '__CONTROL__',
        react: join('variants', 'react'),
        dev: 'dev',
        devFiles: ['host.js', 'smoke.js'],
    },
    'dataset:standard': {
        sources: join('variants', 'dataset'),
        dev: join('variants', 'dataset', 'dev'),
        devFiles: ['fixture.js', 'harness.html', 'harness.js', 'host.js', 'smoke.js'],
    },
    'dataset:react': {
        sources: join('variants', 'dataset'),
        react: join('variants', 'dataset', 'react'),
        dev: join('variants', 'dataset', 'dev'),
        devFiles: ['fixture.js', 'host.js', 'smoke.js'],
    },
};

const donor = DONORS[`${type}:${framework}`];

if (!existsSync(join(template, donor.sources))) {
    fail(
        `This template has no ${donor.sources}/ to copy from. Run this from a checkout of `
        + 'pcfhub/_template, not from a repository that has already been adopted — setup.mjs '
        + 'deletes variants/ on the way through.',
    );
}

// ----------------------------------------------------------------- discovery
//
// Read out of the target rather than asked for, the way adopt.mjs does it. A
// repository that builds already knows its own namespace, and retyping it is
// how a sibling ends up in a different namespace from its own solution — which
// nothing would fail on and nobody would notice until the control picker showed
// two publishers.

const existing = findControlFolders(target);

if (existing.length === 0) {
    fail(
        `No */ControlManifest.Input.xml under ${basename(target)}. This adds a control to a repository `
        + 'that already has one; scaffold the first with scripts/setup.mjs.',
    );
}

const firstManifest = readFileSync(join(target, existing[0], 'ControlManifest.Input.xml'), 'utf8');
const namespace = attr(firstManifest, 'namespace');

if (!namespace) {
    fail(`${existing[0]}/ControlManifest.Input.xml has no namespace attribute on <control>.`);
}

const constructors = existing.map((dir) => {
    const xml = readFileSync(join(target, dir, 'ControlManifest.Input.xml'), 'utf8');

    return attr(xml, 'constructor') ?? dir;
});

// ------------------------------------------------------------------ the name

const control = args.control;

if (!control) {
    fail('--control <PascalCase> is required: the constructor of the control being added.');
}

if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(control)) {
    fail(`--control must be letters, digits and underscores starting with a letter, not "${control}".`);
}

if (existsSync(join(target, control))) {
    fail(`${basename(target)}/${control}/ already exists. Pick another name, or delete it and re-run.`);
}

if (constructors.includes(control)) {
    fail(
        `${basename(target)} already declares a control named "${control}". Two controls in one solution `
        + 'cannot share a constructor: the logical name is {prefix}_{namespace}.{constructor}, so the '
        + 'second would collide with the first at import.',
    );
}

const answers = {
    CONTROL: control,
    NAMESPACE: namespace,
    TITLE: args.title ?? title(control),
    TAGLINE: args.tagline ?? `The ${title(control).toLowerCase()} control.`,
};

// Longest first, so `__CONTROL__` cannot eat the front of a longer token that
// happens to share its prefix. Same rule, same reason, as setup.mjs.
const tokens = Object.entries(answers).map(([name, value]) => [`__${name}__`, value]);

tokens.sort((a, b) => b[0].length - a[0].length);

// ------------------------------------------------------------------- writing

const written = [];
const skipped = [];

/*
 * The first control moves into a project folder of its own, if it has not
 * already. See the header: one .pcfproj may hold one control, so a repository
 * gaining a second one has to stop keeping the first at the root.
 */
const migrated = migrateRootControl();

/*
 * The control's own sources, under `<Control>/<Control>/`. Only the four things
 * a control *is* — the manifest, the entry point, its stylesheet and its strings.
 *
 * `variants/dataset/` also carries `demo/`, `docs/` and `dev/`, and none of them
 * belongs inside a control directory: the first two are repository-level and the
 * target already has them, and the third is handled separately below.
 */
const sources = join(control, control);

copyFile(join(donor.sources, 'ControlManifest.Input.xml'), join(sources, 'ControlManifest.Input.xml'));
copyFile(join(donor.sources, 'index.ts'), join(sources, 'index.ts'));
copyTree(join(donor.sources, 'css'), join(sources, 'css'));
copyTree(join(donor.sources, 'strings'), join(sources, 'strings'));

// The four files that make the directory a project rather than a folder.
writeProjectFiles(control);

/*
 * The react entry point, overlaid on top of the sources just copied.
 *
 * Copied second rather than instead, because only `index.ts` differs: the
 * manifest, the CSS and the five `.resx` are the same files either way, and they
 * are most of what a control directory is.
 */
if (donor.react) {
    copyFile(join(donor.react, 'index.ts'), join(sources, 'index.ts'), { overwrite: true });
    copyTree(join(donor.react, 'components'), join(sources, 'components'));
}

/*
 * The dev rig, in a directory of its own.
 *
 * **The asymmetry here is deliberate.** The first control's rig stays flat at
 * `dev/` where setup.mjs put it, and siblings nest under `dev/<Constructor>/`.
 * Unlike the control sources, nothing in the platform tooling requires the rig
 * to move — and these are the files most likely to have been customised — so the
 * first control keeps the repository's default harness and every sibling is
 * named. `npm run harness` serves both.
 */
for (const file of donor.devFiles) {
    copyFile(join(donor.dev, file), join('dev', control, file), { rewrite: rewriteDevPath });
}

/*
 * A dataset control needs a fixture to render anything, and the target may not
 * have one — a repository whose first control is a field control has no `demo/`
 * at all, because `datasetFixture` is read only for dataset controls.
 *
 * Additive like everything else: an existing `demo/` is left exactly as it is.
 * Note the hub reads *one* `demo.datasetFixture`, so this is the sibling's local
 * rig talking, not a second hub demo.
 */
if (type === 'dataset') {
    copyTree(join(donor.sources, 'demo'), 'demo');
}

// ------------------------------------------------------------ manifest patch
//
// The react half of the manifest, which is the same patch setup.mjs applies and
// is written here rather than shared because the two scripts copy from
// different roots. Kept literally identical in effect: control-type, and the two
// platform libraries ahead of the first <resx>.

if (framework === 'react' && !dryRun) {
    edit(join(sources, 'ControlManifest.Input.xml'), (text) =>
        text
            .replace('control-type="standard"', 'control-type="virtual"')
            .replace(
                '<resx path=',
                `<platform-library name="React" version="${REACT_VERSION}" />\n`
                + `      <platform-library name="Fluent" version="${FLUENT_VERSION}" />\n`
                + '      <resx path=',
            ));
}

// -------------------------------------------------------------- package.json
//
// Two scripts name control directories one at a time, so both have to learn the
// sibling or it is never linted and never smoke-tested — and a smoke suite
// nothing runs is worse than none, because the repository looks covered.

if (!dryRun) {
    edit('package.json', (text) => {
        const pkg = JSON.parse(text);

        /*
         * `eslint <dirs> --ext .ts,.tsx`. Matched rather than rebuilt, because a
         * repository may have added its own flags and this is not the place to
         * decide they were wrong.
         */
        if (typeof pkg.scripts?.lint === 'string' && !new RegExp(`\\b${control}\\b`).test(pkg.scripts.lint)) {
            pkg.scripts.lint = pkg.scripts.lint.replace(/^(eslint\s+)(.*?)(\s+--)/, `$1$2 ${control}$3`);
        }

        /*
         * Chained with `&&` so a failure in the first suite stops the run. Two
         * suites joined by `;` would report the second's exit code and hide the
         * first's failure, which is the kind of green build that costs a release.
         */
        if (typeof pkg.scripts?.smoke === 'string' && !pkg.scripts.smoke.includes(`dev/${control}/smoke.js`)) {
            pkg.scripts.smoke = `${pkg.scripts.smoke} && node dev/${control}/smoke.js`;
        }

        /*
         * The root package.json stops building and starts orchestrating. Each
         * control is its own npm project now, and `--prefix` runs that project's
         * script with its directory as the working directory — which is what the
         * manifest glob and `pcfconfig.json` both key off.
         *
         * `start` is dropped rather than chained: `pcf-scripts start` hosts one
         * control, so "start them all" is not a thing to offer. Run it from the
         * control's own directory.
         */
        const projects = [...constructors, control];

        for (const script of ['build', 'clean', 'rebuild', 'refreshTypes']) {
            pkg.scripts[script] = projects.map((name) => `npm run ${script} --prefix ${name}`).join(' && ');
        }

        delete pkg.scripts.start;

        return `${JSON.stringify(pkg, null, 2)}\n`;
    });

    // Every control project, referenced by the one solution. This is the
    // one-to-many relationship the ALM guidance describes.
    addProjectReference();

    if (framework === 'react') {
        applyReactTooling();
    }
}

// -------------------------------------------------------------------- report

console.log('');
for (const [token, value] of tokens) {
    console.log(`  ${token.padEnd(16)} ${value}`);
}

// Deduped because the react overlay lands on an `index.ts` this same run just
// wrote, which is one file written twice rather than two files.
const wrote = [...new Set(written)];

console.log(`\n  ${wrote.length} files written${dryRun ? ' (dry run — nothing was)' : ''}:`);
for (const path of wrote) {
    console.log(`    ${path}`);
}

if (skipped.length > 0) {
    console.log(`\n  ${skipped.length} left alone because they already exist:`);
    for (const path of skipped) {
        console.log(`    ${path}`);
    }
}

console.log(`
Added ${namespace}.${control} as a ${framework} ${type} control.
${basename(target)} now holds ${existing.length + 1}: ${[...constructors, control].join(', ')}.

Next:
  1. npm run build — and confirm there is now an out/controls/<Constructor>/
     directory per control. That is the whole of the multi-control claim.
  2. Write ${control}/index.ts and dev/${control}/smoke.js.
  3. npm run lint && npm run smoke — both now cover ${control}; check that they
     actually name it before trusting a green run.
  4. npm run harness — the sibling's page is at dev/${control}/harness.html.

Two things this script deliberately did not do, because both are decisions:

  * **pcfhub.json is untouched.** The hub reads one manifest from the repository
    root, with one \`control\` object and one \`slug\`, so it publishes exactly one
    component per repository. ${control} ships inside the same solution and is
    invisible on the hub except in prose. Decide which control the API reference
    covers, and say what the other one is in docs/ and demo.limitations.

  * **Solution/src/Other/Solution.xml is untouched.** Its <UniqueName> was
    generated from the *first* control's name, which in a repository with two
    now names one of two. Rename it if — and only if — nothing has been released
    yet: after a release, changing it makes the next import create a second
    solution rather than upgrade the first.
`);

// ------------------------------------------------------------------ helpers

/**
 * The four files that turn a directory into a code component project.
 *
 * None of them is optional. The `.pcfproj` is what msbuild and `pac pcf push`
 * act on; `package.json` is where the targets run `npm run build`;
 * `pcfconfig.json` is what a bare `npm run build` reads for its output
 * directory; `tsconfig.json` is what the compiler picks up from the project
 * directory.
 */
function writeProjectFiles(name) {
    const files = {
        [`${name}.pcfproj`]: projectFile(name),
        'package.json': `${JSON.stringify({
            name: `${basename(target).toLowerCase()}-${name.toLowerCase()}`,
            version: '0.1.0',
            private: true,
            description: `The ${name} control project. Dependencies live in ../package.json.`,
            scripts: {
                build: 'pcf-scripts build',
                clean: 'pcf-scripts clean',
                rebuild: 'pcf-scripts rebuild',
                start: 'pcf-scripts start',
                refreshTypes: 'pcf-scripts refreshTypes',
            },
        }, null, 2)}\n`,
        'pcfconfig.json': `${JSON.stringify({ outDir: '../out/controls' }, null, 4)}\n`,
        'tsconfig.json': `${JSON.stringify({ extends: '../tsconfig.json' }, null, 4)}\n`,
    };

    for (const [file, content] of Object.entries(files)) {
        const destination = join(target, name, file);
        const shown = `${name}/${file}`;

        if (existsSync(destination)) {
            skipped.push(shown);
            continue;
        }

        if (!dryRun) {
            mkdirSync(dirname(destination), { recursive: true });
            writeFileSync(destination, content);
        }

        written.push(shown);
    }
}

/**
 * A .pcfproj for one control.
 *
 * Two properties carry the whole arrangement. `OutputPath` is a controls
 * *root* one level above the project — the solution packer enumerates its
 * subfolders as controls, so pointing it at the control's own folder makes the
 * packer read `css/` as a control and fail. And `PcfEnableAutoNpmInstall` is
 * off because the dependencies are installed once at the repository root; left
 * on, msbuild runs `npm install` here and grows a second `node_modules` per
 * control.
 */
function projectFile(name) {
    return `<?xml version="1.0" encoding="utf-8"?>
<Project ToolsVersion="15.0" DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
  <PropertyGroup>
    <PowerAppsTargetsPath>$(MSBuildExtensionsPath)\\Microsoft\\VisualStudio\\v$(VisualStudioVersion)\\PowerApps</PowerAppsTargetsPath>
  </PropertyGroup>

  <Import Project="$(MSBuildExtensionsPath)\\$(MSBuildToolsVersion)\\Microsoft.Common.props" />
  <Import Project="$(PowerAppsTargetsPath)\\Microsoft.PowerApps.VisualStudio.Pcf.props" Condition="Exists('$(PowerAppsTargetsPath)\\Microsoft.PowerApps.VisualStudio.Pcf.props')" />

  <!--
    One project, one control. The msbuild targets glob
    **/ControlManifest.Input.xml from this directory and \`pac pcf push\` refuses
    when that returns more than one, so the control sits in ${name}/ below and
    nothing else here carries a manifest.

    Several controls still ship together: Solution/Solution.cdsproj references
    each project, which is the one-to-many relationship between a solution
    project and its component projects.
  -->
  <PropertyGroup>
    <Name>${name}</Name>
    <ProjectGuid>${randomUUID()}</ProjectGuid>
    <!--
      A controls ROOT, not this control's folder. The solution packer treats
      every subfolder of OutputPath as a control, so pointing this one level
      deeper makes it read css/ as a control and fail the pack. Up one level
      also means every control in the repository lands in the same
      out/controls/<Constructor>/ that the dev rigs, pcfhub.json and both shared
      workflows already read.
    -->
    <OutputPath>$(MSBuildThisFileDirectory)..\\out\\controls</OutputPath>
    <!-- production, not debug: the bundle that ships is the one CI packs. -->
    <PcfBuildMode>production</PcfBuildMode>
    <!-- The dependencies are installed once, at the repository root. -->
    <PcfEnableAutoNpmInstall>false</PcfEnableAutoNpmInstall>
  </PropertyGroup>

  <PropertyGroup>
    <TargetFrameworkVersion>v4.6.2</TargetFrameworkVersion>
    <TargetFramework>net462</TargetFramework>
    <RestoreProjectStyle>PackageReference</RestoreProjectStyle>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.PowerApps.MSBuild.Pcf" Version="1.*" />
    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.0" PrivateAssets="All" />
  </ItemGroup>

  <ItemGroup>
    <ExcludeDirectories Include="$(MSBuildThisFileDirectory)\\bin\\**" />
    <ExcludeDirectories Include="$(MSBuildThisFileDirectory)\\obj\\**" />
    <ExcludeDirectories Include="$(OutputPath)\\**" />
    <ExcludeDirectories Include="$(MSBuildThisFileDirectory)\\*.pcfproj" />
    <ExcludeDirectories Include="$(MSBuildThisFileDirectory)\\*.pcfproj.user" />
  </ItemGroup>

  <ItemGroup>
    <None Include="$(MSBuildThisFileDirectory)\\**" Exclude="@(ExcludeDirectories)" />
  </ItemGroup>

  <Import Project="$(MSBuildToolsPath)\\Microsoft.Common.targets" />
  <Import Project="$(PowerAppsTargetsPath)\\Microsoft.PowerApps.VisualStudio.Pcf.targets" Condition="Exists('$(PowerAppsTargetsPath)\\Microsoft.PowerApps.VisualStudio.Pcf.targets')" />

</Project>
`;
}

/**
 * Move the repository's first control into a project folder of its own.
 *
 * A repository adopted from the template has `<Control>/` and `<Control>.pcfproj`
 * at the root, which is correct for one control and wrong for two — the root
 * project's manifest glob would find both. So the sources move down a level and
 * the root project file is replaced by one inside the new project folder.
 *
 * Returns the control it migrated, or null when there was nothing to do.
 */
function migrateRootControl() {
    const rootProject = readdirSync(target).find((entry) => entry.endsWith('.pcfproj'));

    if (!rootProject) {
        return null;
    }

    const first = existing[0];

    // Already nested — `<Control>/<Control>/ControlManifest.Input.xml` — so the
    // repository has been through this before and only the root project file
    // would be stale, which cannot happen.
    if (first.includes('/')) {
        return null;
    }

    if (dryRun) {
        written.push(`${first}/ → ${first}/${first}/ (migration)`);

        return first;
    }

    const from = join(target, first);
    const to = join(target, first, first);
    const moved = readdirSync(from);

    mkdirSync(to, { recursive: true });

    for (const entry of moved) {
        renameSync(join(from, entry), join(to, entry));
    }

    /*
     * The shared-module import, if the control has one, is a level further away.
     * Only `../` at the start of a specifier is rewritten: a deeper relative
     * path inside the control's own directory is unaffected by the move.
     */
    const index = join(to, 'index.ts');

    if (existsSync(index)) {
        const before = readFileSync(index, 'utf8');
        const after = before.replace(/from '\.\.\/(?!\.)/g, "from '../../");

        if (after !== before) {
            writeFileSync(index, after);
        }
    }

    rmSync(join(target, rootProject));
    rmSync(join(target, 'pcfconfig.json'), { force: true });

    /*
     * `pcfhub.json`'s `control.manifestPath` now points at a file that moved.
     *
     * This is the one key this script touches, and it is not a decision — it is
     * repairing a path the migration above invalidated. Everything else in that
     * manifest stays the author's: which control the hub publishes, what the
     * demo claims, what goes in `demo.limitations`. Left stale, the hub imports
     * every release with no properties at all and says so only in an ingestion
     * run nobody is watching; `npm run check` catches it too, which is how it
     * was found.
     */
    edit('pcfhub.json', (text) => {
        const manifest = JSON.parse(text);
        const stale = manifest.control?.manifestPath;

        if (typeof stale !== 'string' || !stale.startsWith(`${first}/`)) {
            return text;
        }

        manifest.control.manifestPath = `${first}/${stale}`;

        return `${JSON.stringify(manifest, null, 2)}\n`;
    });

    writeProjectFiles(first);

    written.push(`${first}/ → ${first}/${first}/ (migration)`);

    return first;
}

/** Reference every control project from the one solution. */
function addProjectReference() {
    const cdsproj = join('Solution', 'Solution.cdsproj');
    const projects = [...constructors, control];

    edit(cdsproj, (text) => {
        const refs = projects
            .map((name) => `    <ProjectReference Include="..\\${name}\\${name}.pcfproj" />`)
            .join('\n');

        return text.replace(
            /  <ItemGroup>\s*\r?\n(?:\s*<ProjectReference Include="[^"]*" \/>\s*\r?\n)+  <\/ItemGroup>/,
            `  <!--
    One reference per control project, each holding exactly one control.
  -->\n  <ItemGroup>\n${refs}\n  </ItemGroup>`,
        );
    });
}

/**
 * Copy one file, substituting placeholders and renaming as it goes.
 *
 * `overwrite` exists for exactly one caller: the react entry point, which
 * deliberately lands on the `index.ts` copied a moment earlier from the same
 * run. It is not a general escape hatch — nothing this script found already in
 * the target is ever passed it.
 */
function copyFile(from, to, { overwrite = false, rewrite = null } = {}) {
    const source = join(template, from);
    const destination = join(target, substitute(to));
    const shown = substitute(to).replace(/\\/g, '/');

    if (!existsSync(source)) {
        fail(`This template has no ${from.replace(/\\/g, '/')} to copy from.`);
    }

    if (existsSync(destination) && !overwrite) {
        skipped.push(shown);

        return;
    }

    let text = substitute(readFileSync(source, 'utf8'));

    if (rewrite) {
        text = rewrite(text, basename(destination));
    }

    if (!dryRun) {
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, text);
    }

    written.push(shown);
}

/** Copy a directory of files, one at a time, so the additive rule holds per file. */
function copyTree(from, to) {
    const source = join(template, from);

    if (!existsSync(source)) {
        return;
    }

    for (const entry of readdirSync(source).sort()) {
        const path = join(source, entry);

        if (statSync(path).isDirectory()) {
            copyTree(join(from, entry), join(to, entry));
        } else {
            copyFile(join(from, entry), join(to, entry));
        }
    }
}

/**
 * Move a dev file down one directory.
 *
 * The rig is written to sit at `dev/`, so every path in it that reaches *out* of
 * its own directory is one level short once it lands in `dev/<Constructor>/`.
 * There are exactly four such paths, and they are rewritten rather than
 * generalised because a loose `../` → `../../` would also rewrite the ones
 * inside comments explaining the layout.
 *
 * `./host.js`, `./fixture.js`, `./harness.js` are untouched on purpose: those
 * travel with the rig into the same directory.
 */
function rewriteDevPath(text, file) {
    if (file === 'smoke.js') {
        return text
            .replace("const root = path.join(__dirname, '..');", "const root = path.join(__dirname, '..', '..');")
            .replace("require('./dom.js')", "require('../dom.js')")
            .replace("require('./clock.js')", "require('../clock.js')");
    }

    if (file === 'harness.html') {
        // The stylesheet is two hops away and then inside the project folder:
        // dev/<C>/harness.html -> ../../<C>/<C>/css/<C>.css. The bundle is not,
        // because every control still builds into one out/ at the root.
        return text
            .replace(`href="../${control}/css/`, `href="../../${control}/${control}/css/`)
            .replace('src="../out/controls/', 'src="../../out/controls/');
    }

    return text;
}

function substitute(text) {
    let out = text;

    for (const [token, value] of tokens) {
        out = out.split(token).join(value);
    }

    return out;
}

/**
 * The React devDependencies and the ESLint plugin, added only where they are
 * missing.
 *
 * Unlike setup.mjs's copy this merges rather than sets: the target may already
 * be a React repository whose first control pinned these, and overwriting a
 * pinned version from a sibling scaffold would be a dependency change nobody
 * asked for.
 */
function applyReactTooling() {
    edit('package.json', (text) => {
        const pkg = JSON.parse(text);
        const wanted = {
            '@fluentui/react-components': FLUENT_VERSION,
            '@types/react': '^16.14.62',
            '@types/react-dom': '^16.9.24',
            'eslint-plugin-react-hooks': '^4.6.0',
            react: REACT_VERSION,
            'react-dom': REACT_VERSION,
        };

        const merged = { ...pkg.devDependencies };

        for (const [name, version] of Object.entries(wanted)) {
            merged[name] ??= version;
        }

        pkg.devDependencies = Object.fromEntries(
            Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
        );

        return `${JSON.stringify(pkg, null, 2)}\n`;
    });

    // Without the plugin, an `eslint-disable react-hooks/exhaustive-deps`
    // comment fails the build with "Definition for rule was not found" — which
    // reads as a config error rather than a missing dependency.
    edit('.eslintrc.json', (text) => {
        const config = JSON.parse(text);

        config.parserOptions = { ...config.parserOptions, ecmaFeatures: { jsx: true } };
        config.plugins = [...new Set([...(config.plugins ?? []), 'react-hooks'])];
        config.rules = {
            ...config.rules,
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        };

        return `${JSON.stringify(config, null, 4)}\n`;
    });
}

/**
 * Rewrite a file in the target.
 *
 * Unlike setup.mjs's `edit`, a no-op is *not* a failure here. That script is
 * replacing text it shipped itself, so "changed nothing" means the template
 * moved underneath it. This one is editing a repository somebody else has been
 * working in, where a `lint` script already naming the control, or an eslintrc
 * already carrying the plugin, is a correct state rather than a broken one.
 */
function edit(relative, transform) {
    const path = join(target, relative);

    if (!existsSync(path)) {
        fail(`${basename(target)} has no ${relative}, so it cannot be an adopted repository.`);
    }

    const before = readFileSync(path, 'utf8');
    const after = transform(before);

    if (after !== before) {
        writeFileSync(path, after);
        written.push(relative);
    }
}

/**
 * The controls in a repository, found the way `pcf-scripts` finds them.
 *
 * Mirrors `findControlFolders` in `node_modules/pcf-scripts/buildContext.js`: a
 * control folder is one containing a `ControlManifest.Input.xml`, and a folder
 * that is one is not descended into. Deriving this any other way is how a check
 * ends up disagreeing with the build about what the repository contains.
 */
function findControlFolders(dir, base = dir, found = []) {
    if (existsSync(join(dir, 'ControlManifest.Input.xml'))) {
        found.push(dir.slice(base.length + 1).replace(/\\/g, '/'));

        return found;
    }

    for (const entry of readdirSync(dir).sort()) {
        if (SKIP_DIRS.has(entry)) {
            continue;
        }

        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
            findControlFolders(path, base, found);
        }
    }

    return found;
}

function attr(xml, name) {
    return new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(xml)?.[1] ?? null;
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

        if (key === 'dry-run' || key === 'yes') {
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

#!/usr/bin/env node
/**
 * Adopt this template into a scratch directory and check what comes out.
 *
 * **The template cannot check itself, and that is not a detail.**
 * `check-template.mjs` exists to fail while a repository still carries
 * placeholders, so running it here exits 1 by design — which means
 * `build.yml`'s first job has never passed on this repository, and the Windows
 * build behind `needs: template` has never run. The template that thirteen
 * repositories were cloned from had, in effect, no CI at all.
 *
 * That is exactly how two bugs lived here unnoticed until somebody adopted the
 * template by hand and read the result:
 *
 *   - `setup.mjs` replaced `__CONTROL__` inside a *comment* that was talking
 *     about placeholders, so every adopted repository ended up claiming its
 *     checkout was full of placeholders named after its own control.
 *   - `setup.mjs` never deleted `release-reusable.yml`, so every repository
 *     adopted after the shared pipeline landed inherited a second, unreferenced
 *     copy of it — recreating, one `gh repo create` at a time, the drift that
 *     had just been removed from eleven repositories.
 *
 * Neither is visible from inside the template. Both are obvious one second
 * after adoption. So this script constructs the state nothing else constructs,
 * and asserts the things that were wrong.
 *
 *   node scripts/verify-adoption.mjs
 *
 * It writes to a temporary directory and removes it, and never touches the
 * repository it is run from.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Answers that exercise the renaming paths — a control name unlike the slug. */
const ANSWERS = {
    control: 'ColorPicker',
    namespace: 'PCFHub',
    slug: 'pcf-color-picker',
    title: 'Color Picker',
    tagline: 'A verification fixture, adopted and thrown away.',
    category: 'pickers',
    owner: 'pcfhub',
    repo: 'pcf-color-picker',
    publisher: 'PCFHub',
    prefix: 'pcfhub',
};

/** Never copied into the scratch adoption: build output and dependencies. */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'out', 'bin', 'obj', 'generated']);

/**
 * Placeholders the author is *supposed* to be left holding.
 *
 * README.md ships prompts for the three sections nobody but the author can
 * write, and `check-template.mjs` fails until they are replaced. They are the
 * one case where a surviving token means the template worked.
 */
const AUTHORING_PROMPTS = new Set(['__WHAT_IT_DOES__', '__PROPERTIES__', '__ON_THE_HUB__']);

const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;

const failures = [];

function check(description, condition, detail = '') {
    if (condition) {
        console.log(`  ok    ${description}`);

        return;
    }

    failures.push(detail === '' ? description : `${description}\n          ${detail}`);
    console.log(`  FAIL  ${description}`);
}

function walk(dir, base = dir, files = []) {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) {
            continue;
        }

        const full = join(dir, entry);

        if (statSync(full).isDirectory()) {
            walk(full, base, files);
        } else {
            files.push(full.slice(base.length + 1).replace(/\\/g, '/'));
        }
    }

    return files;
}

/*
 * Checked on the template rather than on the adoption, because after
 * substitution the evidence is gone — the comment reads as ordinary prose about
 * a control, and only its strangeness gives it away.
 *
 * **Not every token in a comment is wrong, and the first version of this check
 * got that wrong.** `# __CONTROL__.pcfproj sets PcfBuildMode=production` is
 * correct: the file really is renamed, so substitution makes the sentence true.
 * The bug is narrower — prose that *mentions* placeholders while containing
 * one, as in "a checkout still full of `__CONTROL__` placeholders", where the
 * token stands for the idea of a token rather than for the control. Substituted,
 * it becomes a claim that a finished repository is full of placeholders named
 * after its own control.
 *
 * So the rule is the co-occurrence, not the token. A comment that talks about
 * placeholders should say so in words that survive being rewritten.
 */
function commentsDoNotCarryPlaceholders() {
    const offenders = [];

    for (const file of walk(root)) {
        if (!/\.(ya?ml|json)$/.test(file) || file === 'package-lock.json') {
            continue;
        }

        readFileSync(join(root, file), 'utf8')
            .split('\n')
            .forEach((line, i) => {
                const isComment = /^\s*#/.test(line);
                const mentionsPlaceholders = /placeholder/i.test(line);

                PLACEHOLDER.lastIndex = 0;

                if (isComment && mentionsPlaceholders && PLACEHOLDER.test(line)) {
                    offenders.push(`${file}:${i + 1} ${line.trim().slice(0, 78)}`);
                }

                PLACEHOLDER.lastIndex = 0;
            });
    }

    check(
        'no comment explains placeholders using a placeholder',
        offenders.length === 0,
        offenders.join('\n          '),
    );
}

/**
 * Adopt once more, with shape flags, and hand back a reader.
 *
 * The caller owns the scratch directory and must remove it.
 */
function adoptWith(extra) {
    const scratch = mkdtempSync(join(tmpdir(), 'pcfhub-adopt-'));

    cpSync(root, scratch, {
        recursive: true,
        filter: (src) => !SKIP_DIRS.has(src.split(/[\\/]/).pop()),
    });

    execFileSync(
        process.execPath,
        [
            join(scratch, 'scripts', 'setup.mjs'),
            '--yes',
            ...Object.entries(ANSWERS).flatMap(([k, v]) => [`--${k}`, v]),
            ...extra,
        ],
        { cwd: scratch, stdio: 'pipe' },
    );

    return {
        scratch,
        has: (p) => existsSync(join(scratch, p)),
        read: (p) => readFileSync(join(scratch, p), 'utf8'),
    };
}

/**
 * The two shapes CI has never adopted.
 *
 * Everything above this runs `setup.mjs` with no shape flags, which is
 * field + standard — so the dataset dev overlay and the React patch have
 * shipped to every repository built on them without a single automated
 * assertion. Two of the three things checked here are *deletions*, which is the
 * class of bug that looks like nothing: `--framework react` removing a harness
 * it should keep, or keeping one that cannot work, both produce a repository
 * that installs and builds.
 *
 * The dataset+react combination is deliberate rather than thorough.
 * `applyType` copies the dataset browser harness in and `applyFramework` then
 * deletes it, so the two run in an order that matters and only this shape
 * exercises it.
 */
function verifyOtherShapes() {
    console.log('\nAdopting as a dataset control…\n');

    const dataset = adoptWith(['--type', 'dataset']);

    try {
        check('the dataset control lands', dataset.has(`${ANSWERS.control}/index.ts`));
        check('the dataset fixture lands', dataset.has('dev/fixture.js'));
        check('the hub fixture lands', dataset.has('demo/records.json'));
        check(
            'the shared dev files survive the overlay',
            dataset.has('dev/dom.js') && dataset.has('dev/clock.js') && dataset.has('dev/serve.js'),
        );
        check(
            'a dataset control keeps the browser harness',
            dataset.has('dev/harness.html') && dataset.has('dev/harness.js'),
        );

        const manifest = dataset.read(`${ANSWERS.control}/ControlManifest.Input.xml`);
        check('the manifest declares a data-set', /<data-set\s/.test(manifest));

        const hub = JSON.parse(dataset.read('pcfhub.json'));
        check('pcfhub.json says dataset', hub.control.type === 'dataset', hub.control.type);
        /*
         * The key `check-template.mjs` cannot miss for you: it validates
         * `demo.datasetFixture` when it is present and says nothing when it is
         * absent, so every dataset repository wrote it by hand until setup
         * started writing it here.
         */
        check(
            'and points demo.datasetFixture at the fixture it just copied',
            hub.demo.datasetFixture === 'demo/records.json' && dataset.has(hub.demo.datasetFixture),
            String(hub.demo.datasetFixture),
        );
    } finally {
        rmSync(dataset.scratch, { recursive: true, force: true });
    }

    console.log('\nAdopting as a React (virtual) dataset control…\n');

    const react = adoptWith(['--type', 'dataset', '--framework', 'react']);

    try {
        check(
            'the browser harness is removed for a React control',
            !react.has('dev/harness.html') && !react.has('dev/harness.js'),
            'Fluent 9 ships no UMD build, so there is nothing to put in a script tag.',
        );
        check(
            'and the rest of the rig stays, because npm run smoke still works',
            react.has('dev/smoke.js') && react.has('dev/host.js') && react.has('dev/fixture.js'),
        );
        check('the React entry point lands', react.has(`${ANSWERS.control}/index.ts`));
        check(
            'the React component lands',
            react.has(`${ANSWERS.control}/components/${ANSWERS.control}Control.tsx`),
        );

        const manifest = react.read(`${ANSWERS.control}/ControlManifest.Input.xml`);
        check('the manifest becomes control-type="virtual"', /control-type="virtual"/.test(manifest));
        check(
            'and declares both platform libraries',
            /<platform-library\s+name="React"/.test(manifest) && /<platform-library\s+name="Fluent"/.test(manifest),
        );

        const hub = JSON.parse(react.read('pcfhub.json'));
        check('pcfhub.json says react_virtual', hub.control.framework === 'react_virtual', hub.control.framework);
        /*
         * And still `dataset`. The hub resolves dataset → virtual → field, so
         * a React dataset control is typed by its data, not by its framework —
         * which is why `applyFramework` skips the type replace for this shape
         * and why getting it wrong here would be invisible until the hub
         * rendered the wrong demo.
         */
        check('and still dataset, not virtual', hub.control.type === 'dataset', hub.control.type);

        const pkg = JSON.parse(react.read('package.json'));
        check(
            'React and Fluent are pinned in devDependencies',
            pkg.devDependencies.react === '16.14.0' && '@fluentui/react-components' in pkg.devDependencies,
        );
    } finally {
        rmSync(react.scratch, { recursive: true, force: true });
    }
}

/**
 * Adopt, then add a second control to the result.
 *
 * **This is the only thing that ever runs `add-control.mjs`.** It is also the
 * only place the two-control shape exists at all: every repository in the
 * catalogue holds one control, so nothing else would notice that shape breaking.
 *
 * Note where it runs the script *from*. `adoptWith` copies the template into a
 * scratch directory and runs `setup.mjs` there, and setup deletes
 * `scripts/add-control.mjs` on the way through — so the copy inside the scratch
 * repository is gone by design. It is invoked from **this** template, pointed
 * `--into` the scratch, which is exactly how an author reaches it.
 *
 * Three of the assertions below are about paths, and they are the reason this
 * pass is worth its runtime. A sibling's dev rig is written to sit at `dev/` and
 * lands one directory deeper, so every path in it that reaches out of its own
 * folder is one `../` short. All three failures are silent: the smoke suite
 * would resolve `root` to `dev/` and report a missing bundle, and the harness
 * would 404 the bundle in a browser nobody has open in CI.
 */
function verifySibling() {
    console.log('\nAdopting, then adding a second control…\n');

    const SIBLING = 'LinkColumn';
    const repo = adoptWith([]);

    const add = (extra = []) => {
        try {
            return {
                status: 0,
                out: execFileSync(
                    process.execPath,
                    [
                        join(root, 'scripts', 'add-control.mjs'),
                        '--into', repo.scratch,
                        '--control', SIBLING,
                        '--type', 'dataset',
                        ...extra,
                    ],
                    { cwd: root, stdio: 'pipe', encoding: 'utf8' },
                ),
            };
        } catch (error) {
            return { status: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
        }
    };

    try {
        const first = add();

        check('add-control.mjs succeeds against a freshly adopted repository', first.status === 0,
            first.out.trim().split('\n').slice(-6).join('\n          '));

        check('the sibling control lands in a project folder of its own',
            repo.has(`${SIBLING}/${SIBLING}/index.ts`)
            && repo.has(`${SIBLING}/${SIBLING}/ControlManifest.Input.xml`));
        check('with its own stylesheet, named after it',
            repo.has(`${SIBLING}/${SIBLING}/css/${SIBLING}.css`));

        /*
         * The reason the layout is shaped this way, and the thing nothing else
         * here would notice breaking: **a .pcfproj may hold exactly one
         * control.** `pac pcf push` refuses two manifests in one project —
         * "Pcf projects should only contain a single source manifest file" —
         * and the msbuild targets glob the project directory the same way. The
         * build and the solution pack both tolerated two; the inner development
         * loop did not, which is how this was found.
         */
        check('each control is its own project',
            repo.has(`${SIBLING}/${SIBLING}.pcfproj`)
            && repo.has(`${ANSWERS.control}/${ANSWERS.control}.pcfproj`));
        check('and the first control migrated out of the repository root',
            !repo.has(`${ANSWERS.control}.pcfproj`)
            && repo.has(`${ANSWERS.control}/${ANSWERS.control}/index.ts`));
        check('each project carries what msbuild and pcf-scripts need there',
            [`${SIBLING}/package.json`, `${SIBLING}/pcfconfig.json`, `${SIBLING}/tsconfig.json`]
                .every((f) => repo.has(f)));

        /*
         * OutputPath is a controls ROOT one level up, not the control's own
         * folder. The solution packer enumerates its subfolders as controls, so
         * a deeper path makes it read `css/` as a control and fail the pack with
         * "ControlManifest.xml not found".
         */
        const proj = repo.read(`${SIBLING}/${SIBLING}.pcfproj`);

        check('the project writes into the shared out/controls root',
            proj.includes('<OutputPath>$(MSBuildThisFileDirectory)..\\out\\controls</OutputPath>'),
            /<OutputPath>[^<]*<\/OutputPath>/.exec(proj)?.[0]);
        check('and does not grow a second node_modules',
            proj.includes('<PcfEnableAutoNpmInstall>false</PcfEnableAutoNpmInstall>'));

        const cds = repo.read('Solution/Solution.cdsproj');

        check('the solution references every control project',
            cds.includes(`..\\${ANSWERS.control}\\${ANSWERS.control}.pcfproj`)
            && cds.includes(`..\\${SIBLING}\\${SIBLING}.pcfproj`),
            (cds.match(/<ProjectReference[^>]*>/g) || []).join(' '));

        /*
         * All five, not "some". A language on disk that the manifest does not
         * list is never packed, and one the manifest lists that is not on disk
         * fails the build — check-template.mjs enforces both, so a sibling
         * scaffolded with four of five is a repository that cannot pass its own
         * gate.
         */
        const langs = ['1031', '1033', '1036', '1041', '3082'];
        const resx = (lcid) => `${SIBLING}/${SIBLING}/strings/${SIBLING}.${lcid}.resx`;

        check('with all five languages',
            langs.every((lcid) => repo.has(resx(lcid))),
            langs.filter((lcid) => !repo.has(resx(lcid))).join(', '));

        const manifest = repo.read(`${SIBLING}/${SIBLING}/ControlManifest.Input.xml`);
        check('the sibling is a dataset control', /<data-set\s/.test(manifest));
        check('under its own constructor', new RegExp(`constructor="${SIBLING}"`).test(manifest));
        /*
         * The namespace is read out of the *first* control rather than asked
         * for. Two controls in one solution under different namespaces would
         * install, and the mistake would surface as two publishers in the
         * control picker.
         */
        check('and in the namespace the first control already uses',
            new RegExp(`namespace="${ANSWERS.namespace}"`).test(manifest));

        const leftovers = [...manifest.matchAll(PLACEHOLDER)].map((m) => m[0]);
        check('no placeholder survives in the sibling manifest', leftovers.length === 0, leftovers.join(', '));

        // ---- the dev rig, and the paths that had to move down a directory

        check('the sibling gets a dev rig of its own',
            ['smoke.js', 'host.js', 'harness.html', 'harness.js', 'fixture.js']
                .every((f) => repo.has(`dev/${SIBLING}/${f}`)));

        check('and does not carry a second copy of the shared files',
            !repo.has(`dev/${SIBLING}/dom.js`) && !repo.has(`dev/${SIBLING}/clock.js`),
            'dom.js is the same file for every DOM shape; a second copy is one that drifts.');

        check('the first control keeps the repository default harness',
            repo.has('dev/harness.html') && repo.has('dev/dom.js') && repo.has('dev/smoke.js'));

        const smoke = repo.read(`dev/${SIBLING}/smoke.js`);
        check("the sibling's smoke suite reaches the repository root, not dev/",
            smoke.includes("path.join(__dirname, '..', '..')"),
            'Left at one ../ it resolves root to dev/ and reports a missing bundle.');
        check('and requires the shared rig one level up',
            smoke.includes("require('../dom.js')") && smoke.includes("require('../clock.js')"));
        check('while keeping its own host and fixture local',
            smoke.includes("require('./host.js')") && smoke.includes("require('./fixture.js')"));

        const harness = repo.read(`dev/${SIBLING}/harness.html`);
        check("the sibling's harness points at its own bundle, two levels up",
            harness.includes(`src="../../out/controls/${SIBLING}/bundle.js"`));
        check('and at its own stylesheet, inside the project folder',
            harness.includes(`href="../../${SIBLING}/${SIBLING}/css/${SIBLING}.css"`),
            /href="[^"]*\.css"/.exec(harness)?.[0]);

        // ---- the two scripts that name control directories one at a time

        const pkg = JSON.parse(repo.read('package.json'));
        check('npm run build runs every control project rather than globbing',
            pkg.scripts.build.includes(`--prefix ${ANSWERS.control}`)
            && pkg.scripts.build.includes(`--prefix ${SIBLING}`),
            pkg.scripts.build);
        check('and npm start is dropped, because it hosts one control',
            pkg.scripts.start === undefined);
        check('npm run lint covers both controls',
            new RegExp(`\\b${ANSWERS.control}\\b`).test(pkg.scripts.lint)
            && new RegExp(`\\b${SIBLING}\\b`).test(pkg.scripts.lint),
            pkg.scripts.lint);
        check('npm run smoke runs both suites, chained so the first failure stops it',
            pkg.scripts.smoke.includes('dev/smoke.js')
            && pkg.scripts.smoke.includes(`dev/${SIBLING}/smoke.js`)
            && pkg.scripts.smoke.includes('&&'),
            pkg.scripts.smoke);

        /*
         * A field-first repository has no `demo/` at all, because
         * `datasetFixture` is read only for dataset controls. Adding a dataset
         * sibling to one has to bring a fixture or the sibling's harness renders
         * an empty table and nothing says why.
         */
        check('a dataset sibling brings a fixture into a repo that had none',
            repo.has('demo/records.json'));

        /*
         * The hub reads one manifest, with one `control` object and one `slug`.
         * Rewriting it to name the sibling would silently move the published
         * component; leaving it is the only correct behaviour, and it is a
         * decision rather than an oversight — so it is asserted.
         */
        const hub = JSON.parse(repo.read('pcfhub.json'));
        check('pcfhub.json still names the first control, untouched',
            hub.control.constructor === ANSWERS.control && hub.control.type === 'field',
            `${hub.control.constructor} / ${hub.control.type}`);

        /*
         * The gate has to survive the sibling. `check-template.mjs` walks every
         * file for placeholders, so a sibling scaffolded with one left in it
         * turns a passing repository into a failing one — and the failure would
         * name the sibling's file rather than the script that wrote it.
         */
        let gate = { status: 0, out: '' };

        try {
            gate.out = execFileSync(process.execPath, [join(repo.scratch, 'scripts', 'check-template.mjs')], {
                cwd: repo.scratch, stdio: 'pipe', encoding: 'utf8',
            });
        } catch (error) {
            gate = { status: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
        }

        check('check-template still fails only on the README, not on the sibling',
            gate.status === 1 && !new RegExp(SIBLING).test(gate.out),
            gate.out.trim().split('\n').slice(0, 6).join('\n          '));

        /*
         * And now the half that assertion cannot reach.
         *
         * `check-template.mjs` walks for placeholders first and exits 1 the
         * moment it finds any — so on a freshly adopted repository, whose README
         * still carries its three authoring prompts, **it never reaches the
         * per-control checks at all**. Asserting "it did not complain about the
         * sibling" above is therefore true whatever those checks do, including
         * nothing.
         *
         * So: fill in the prompts, break one of the sibling's translations, and
         * require the gate to name it. Before the loop this replaced, the
         * localisation, feature and licensing checks all read the single manifest
         * `pcfhub.json` points at — which is never the sibling — and a control
         * shipping half a language file passed silently.
         */
        writeFileSync(
            join(repo.scratch, 'README.md'),
            repo.read('README.md').replace(/__WHAT_IT_DOES__|__PROPERTIES__|__ON_THE_HUB__/g, 'Written by the author.'),
        );

        /*
         * `spawnSync`, not `execFileSync`, and the difference is load-bearing.
         *
         * `check-template.mjs` reports problems with `console.error` and warnings
         * with `console.warn` — both stderr — while its success line goes to
         * stdout. `execFileSync` returns *stdout only*, so a helper built on it
         * reads the warnings on the failure path (where they arrive via the
         * thrown error's `stderr`) and silently loses them on the success path.
         * Which is exactly the path a warning is emitted on: this script prints
         * warnings only when it found no problems.
         */
        const runGate = () => {
            const run = spawnSync(process.execPath, [join(repo.scratch, 'scripts', 'check-template.mjs')], {
                cwd: repo.scratch, encoding: 'utf8',
            });

            return { status: run.status, out: `${run.stdout ?? ''}${run.stderr ?? ''}` };
        };

        /*
         * Checked while the repository is still *correct*, and that ordering is
         * the point rather than a detail: `check-template.mjs` prints warnings
         * only when it has found no problems, because it exits at the first
         * batch of those. Asserting this alongside a deliberately broken resx
         * would be asserting something that cannot happen.
         */
        const clean = runGate();

        check('a healthy two-control repository passes the gate',
            clean.status === 0,
            clean.out.trim().split('\n').slice(0, 8).join('\n          '));

        check('and it says out loud that the hub publishes only one of the two',
            /publishes one component per repository/.test(clean.out),
            clean.out.trim().split('\n').slice(0, 8).join('\n          '));

        const german = join(repo.scratch, SIBLING, SIBLING, 'strings', `${SIBLING}.1031.resx`);
        const dropped = readFileSync(german, 'utf8').replace(/\s*<data name="[^"]+"[^>]*>\s*<value>[\s\S]*?<\/value>\s*<\/data>/, '');

        writeFileSync(german, dropped);

        const sibling = runGate();

        check("check-template reads the sibling's translations, not just the published control's",
            sibling.status === 1 && new RegExp(`${SIBLING}\\.1031\\.resx`).test(sibling.out),
            sibling.out.trim().split('\n').slice(0, 8).join('\n          '));

        // ---- and the guard, which is the half that protects written code

        const second = add();

        check('adding the same control twice refuses rather than merging',
            second.status === 1 && /already exists/.test(second.out),
            second.out.trim());
    } finally {
        rmSync(repo.scratch, { recursive: true, force: true });
    }
}

function main() {
    console.log('\nAdopting the template into a scratch directory…\n');

    const scratch = mkdtempSync(join(tmpdir(), 'pcfhub-adopt-'));

    try {
        cpSync(root, scratch, {
            recursive: true,
            filter: (src) => !SKIP_DIRS.has(src.split(/[\\/]/).pop()),
        });

        execFileSync(
            process.execPath,
            [
                join(scratch, 'scripts', 'setup.mjs'),
                '--yes',
                ...Object.entries(ANSWERS).flatMap(([k, v]) => [`--${k}`, v]),
            ],
            { cwd: scratch, stdio: 'pipe' },
        );

        const has = (p) => existsSync(join(scratch, p));
        const read = (p) => readFileSync(join(scratch, p), 'utf8');

        // --- what adoption must remove -----------------------------------
        //
        // release-reusable.yml is the one this script was written for. The
        // shared pipeline lives in the template and is called by `uses:` at a
        // tag; a copy in an adopted repository is a second definition of the
        // release that nothing references and everything can drift from.
        check('release-reusable.yml is not inherited', !has('.github/workflows/release-reusable.yml'));
        check('build-reusable.yml is not inherited', !has('.github/workflows/build-reusable.yml'));
        check('adopt.mjs is removed', !has('scripts/adopt.mjs'));
        check('the variants directory is removed', !has('variants'));
        check('TEMPLATE.md is removed', !has('TEMPLATE.md'));
        check('migration.md is removed', !has('docs/migration.md'));

        const workflows = readdirSync(join(scratch, '.github/workflows')).sort();
        check(
            'an adopted repository has exactly build.yml and release.yml',
            workflows.join(',') === 'build.yml,release.yml',
            `found: ${workflows.join(', ')}`,
        );

        // --- what adoption must produce ----------------------------------
        check(`the control directory is named ${ANSWERS.control}`, has(ANSWERS.control));
        check('the control manifest is renamed', has(`${ANSWERS.control}/ControlManifest.Input.xml`));
        check('the stylesheet is renamed', has(`${ANSWERS.control}/css/${ANSWERS.control}.css`));
        check('the string table is renamed', has(`${ANSWERS.control}/strings/${ANSWERS.control}.1033.resx`));
        check('the pcfproj is renamed', has(`${ANSWERS.control}.pcfproj`));

        /*
         * The dev rig, which is the only thing in an adopted repository that
         * asserts anything about the control.
         *
         * `npm run smoke` is wired in the shared package.json and run by CI
         * after the msbuild pack, so a rig that failed to land would take the
         * repository's only assertions with it and still go green — the script
         * would simply not be there to fail. The three checks are the three
         * ways that happens: the file missing, the script missing, and the
         * script pointing somewhere the file is not.
         */
        // `clock.js` is named here rather than left to `dev/` landing wholesale:
        // `smoke.js` requires it at the top and the teardown assertion is
        // written against it, so an adoption that dropped it would fail at the
        // first line rather than at the assertion that needs it.
        check(
            'the dev rig lands',
            has('dev/smoke.js') && has('dev/host.js') && has('dev/dom.js') && has('dev/clock.js'),
        );

        check('the browser harness lands for a standard control', has('dev/harness.html') && has('dev/harness.js'));

        const pkg = JSON.parse(read('package.json'));

        check(
            'package.json runs the smoke suite',
            pkg.scripts.smoke === 'node dev/smoke.js',
            pkg.scripts.smoke,
        );

        // Once build.yml became a six-line caller, "does it contain the smoke
        // step" stopped being answerable from this repository — the step lives
        // in build-reusable.yml now. What an adopted repository can still be
        // held to is that it calls the shared build, and that it does not opt
        // out of the suite it ships: `smoke` defaults to true, so a fresh
        // adoption naming it at all can only be turning it off.
        const build = read('.github/workflows/build.yml');
        check(
            'build.yml calls the shared workflow at a pinned tag',
            /uses:\s*pcfhub\/_template\/\.github\/workflows\/build-reusable\.yml@v\d/.test(build),
        );
        check(
            'and CI runs the smoke suite after the pack, where the production bundle is',
            !/smoke:\s*false/.test(build),
            build.match(/smoke:.*/)?.[0],
        );
        check(
            'the local reference the template uses is rewritten on adoption',
            !build.includes('./.github/workflows/') && !build.includes('adopt-first'),
        );

        // The caller has to name the directory that actually exists. A wrong
        // control-dir fails at release time, on a Windows runner, minutes in.
        const release = read('.github/workflows/release.yml');
        check(
            `release.yml passes control-dir: ${ANSWERS.control}`,
            new RegExp(`control-dir:\\s*${ANSWERS.control}\\b`).test(release),
        );
        check(
            'release.yml still calls the shared workflow at a pinned tag',
            /uses:\s*pcfhub\/_template\/\.github\/workflows\/release-reusable\.yml@v\d/.test(release),
        );

        const solutionDir = release.match(/solution-dir:\s*(\S+)/)?.[1];
        check(
            `the solution directory release.yml names (${solutionDir}) exists`,
            solutionDir !== undefined && has(`${solutionDir}/src/Other/Solution.xml`),
        );

        // --- nothing left half-substituted -------------------------------
        const leftovers = [];

        for (const file of walk(scratch)) {
            if (file === 'package-lock.json' || /\.(png|jpe?g|gif|webp|ico|woff2?|zip)$/i.test(file)) {
                continue;
            }

            const found = (read(file).match(PLACEHOLDER) ?? []).filter((t) => !AUTHORING_PROMPTS.has(t));

            if (found.length > 0) {
                leftovers.push(`${file}: ${[...new Set(found)].join(', ')}`);
            }
        }

        check(
            'no placeholder survives adoption except the README authoring prompts',
            leftovers.length === 0,
            leftovers.join('\n          '),
        );

        // --- the adopted repository's own gate still works ----------------
        //
        // It must still fail, and for exactly one reason: the README sections
        // only the author can write. A pass here would mean the gate stopped
        // gating; a failure naming anything else would mean adoption left work
        // behind that it should have finished.
        let gate = { status: 0, out: '' };

        try {
            gate.out = execFileSync(process.execPath, [join(scratch, 'scripts', 'check-template.mjs')], {
                cwd: scratch,
                stdio: 'pipe',
                encoding: 'utf8',
            });
        } catch (error) {
            gate = { status: error.status, out: `${error.stdout ?? ''}${error.stderr ?? ''}` };
        }

        check('check-template still fails on a freshly adopted repository', gate.status === 1);
        check(
            'and fails only on the README sections the author must write',
            gate.status === 1 && /README\.md/.test(gate.out) && !/still contains __(?!WHAT_IT_DOES|PROPERTIES|ON_THE_HUB)/.test(gate.out),
            gate.out.trim().split('\n').slice(0, 6).join('\n          '),
        );
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }

    verifyOtherShapes();
    verifySibling();

    console.log('\nChecking the template itself…\n');
    commentsDoNotCarryPlaceholders();

    if (failures.length > 0) {
        console.error(`\n${failures.length} check(s) failed:\n`);
        for (const f of failures) {
            console.error(`  - ${f}`);
        }
        console.error('');
        process.exit(1);
    }

    console.log('\nAdoption produces a repository that builds, releases and gates correctly.\n');
}

main();

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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
 * write, and pcfhub.json one for the summary the hub shows under "Overview".
 * `check-template.mjs` fails until they are replaced. They are the one case
 * where a surviving token means the template worked.
 *
 * The summary joined them on 2026-10-01. Until the hub read that key the field
 * could only be typed into its admin form, and twenty-seven of twenty-eight
 * published components had none: nothing in a repository said it was missing.
 */
const AUTHORING_PROMPTS = new Set(['__WHAT_IT_DOES__', '__PROPERTIES__', '__ON_THE_HUB__', '__SUMMARY__']);

const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;

const failures = [];

/** Checks that answer later (a stand-in Web API resolves a promise), awaited before the verdict. */
const pending = [];

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
 * The field rig's organisation row carries the fiscal year the way a real
 * organisation's Web API answers it (read on 2026-10-29): `fiscalcalendarstart`
 * an ISO instant — UserLocal behind a Date Only format, so the month is the
 * user's zone's, not the string's — `fiscalperiodtype` 2002 (quarters) and
 * `fiscalyeardisplaycode` 1. A control that reads the fiscal year
 * (pcf-date-range-picker 0.4.0) is tested against this row; a rig that
 * dropped the columns would answer `undefined` and every fiscal range would
 * quietly fall back to January.
 */
async function fieldRigAnswersTheFiscalYear() {
    const require = createRequire(import.meta.url);
    const host = require(join(root, 'dev', 'host.js'));
    const fixture = require(join(root, 'dev', 'fixture.js'));
    const context = host.createContext({ fixture, clientUrl: host.nextClientUrl() });
    const answer = await context.webAPI.retrieveMultipleRecords(
        'organization',
        '?$select=fiscalcalendarstart,fiscalperiodtype,fiscalyeardisplaycode',
    );
    const row = answer.entities[0] ?? {};

    check(
        'the field rig\'s organisation row answers the fiscal year as the server holds it',
        row.fiscalcalendarstart === '2022-01-01T10:59:00Z' && row.fiscalperiodtype === 2002 && row.fiscalyeardisplaycode === 1,
        JSON.stringify(row),
    );

    const april = host.createContext({ fixture, clientUrl: host.nextClientUrl(), fiscalStart: '2026-04-01T09:00:00Z' });
    const moved = (await april.webAPI.retrieveMultipleRecords('organization', '?$select=fiscalcalendarstart')).entities[0] ?? {};

    check('…and `fiscalStart` moves it', moved.fiscalcalendarstart === '2026-04-01T09:00:00Z', JSON.stringify(moved));
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

    try {
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
    } catch (error) {
        // A refused adoption is a result some callers want; the copy is not.
        rmSync(scratch, { recursive: true, force: true });
        throw error;
    }

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
/**
 * The dataset rig's linking (`dev/linked.js`), driven through an adopted
 * copy — the only place `host.js` and `linked.js` sit in one folder. Every
 * expected number is the fixture's: nine records point at Parent 1, three at
 * Parent 2, and Parent 1 is under Holding. What each case reproduces was
 * measured by pcf-data-table's 0.7.3 probe (its SPEC.md 0.8.0).
 */
function verifyLinking(scratch) {
    console.log('\nChecking the dataset rig\'s linking…\n');

    const load = createRequire(join(scratch, 'dev', 'smoke.js'));
    const host = load('./host.js');
    const fixture = load('./fixture.js');
    const HOLDING = 'c0ffee00-0000-4000-8000-000000000000';
    const PARENT1 = 'c0ffee00-0000-4000-8000-000000000001';
    const PARENT2 = 'c0ffee00-0000-4000-8000-000000000002';
    const toParent = { name: 'account', from: 'accountid', to: 'parentaccountid', linkType: 'inner', alias: 'p' };

    /** A fresh form host, linked to the parent, filtered by one condition on it, fetched. */
    const linkedBy = (operator, value) => {
        const h = host.createHost(fixture, { pageSize: 50 });
        const ds = h.dataset;
        ds.linking.addLinkedEntity(toParent);
        ds.filtering.setFilter({ conditions: [{ attributeName: 'accountid', conditionOperator: operator, value, entityAliasName: 'p' }], filterOperator: 0 });
        ds.paging.reset();
        ds.refresh();
        return ds;
    };

    const form = host.createHost(fixture, { pageSize: 50 });
    check('linking is on a form\'s dataset, and starts empty', typeof form.dataset.linking.addLinkedEntity === 'function' && form.dataset.linking.getLinkedEntities().length === 0);
    check('and absent on canvas, as Learn says', host.createHost(fixture, { host: 'canvas' }).dataset.linking === undefined);

    const unrefreshed = host.createHost(fixture, { pageSize: 50 }).dataset;
    unrefreshed.linking.addLinkedEntity(toParent);
    unrefreshed.filtering.setFilter({ conditions: [{ attributeName: 'accountid', conditionOperator: 0, value: PARENT1, entityAliasName: 'p' }], filterOperator: 0 });
    check('a link and its condition change nothing until a fetch', unrefreshed.paging.totalResultCount === 12, String(unrefreshed.paging.totalResultCount));

    const equal = linkedBy(0, PARENT1);
    check('a condition on the link\'s alias is judged at the other end (P1): 9 of 12 have Parent 1', equal.paging.totalResultCount === 9 && equal.error === false, String(equal.paging.totalResultCount));
    check('getLinkedEntities answers the measured shape', JSON.stringify(equal.linking.getLinkedEntities()[0]) === JSON.stringify({ ...toParent, filtering: { aliasMap: {} }, linking: {}, sorting: [] }), JSON.stringify(equal.linking.getLinkedEntities()));

    // P2: the dataset's numbering — 75 Above, 76 Under, 77 NotUnder, 78 AboveOrEqual, 79 UnderOrEqual.
    const counts = {
        75: linkedBy(75, PARENT1).paging.totalResultCount,
        76: linkedBy(76, HOLDING).paging.totalResultCount,
        77: linkedBy(77, HOLDING).paging.totalResultCount,
        78: linkedBy(78, PARENT1).paging.totalResultCount,
        79: linkedBy(79, HOLDING).paging.totalResultCount,
    };
    check('the hierarchy operators are numbered the dataset\'s way, not the SDK\'s (P2)', JSON.stringify(counts) === JSON.stringify({ 75: 0, 76: 9, 77: 3, 78: 9, 79: 9 }), JSON.stringify(counts));

    const root = host.createHost(fixture, { pageSize: 50 }).dataset;
    root.filtering.setFilter({ conditions: [{ attributeName: 'accountid', conditionOperator: 76, value: PARENT2 }], filterOperator: 0 });
    root.paging.reset();
    root.refresh();
    check('a hierarchy operator on the bound table walks its own rows', root.paging.totalResultCount === 3, String(root.paging.totalResultCount));

    const twice = linkedBy(0, PARENT1);
    twice.linking.addLinkedEntity(toParent);
    twice.refresh();
    check('the same link added again is kept once (P5)', twice.linking.getLinkedEntities().length === 1 && twice.paging.totalResultCount === 9);

    twice.linking.addLinkedEntity({ ...toParent, to: 'masterid' });
    twice.refresh();
    check('a different link under the same alias is appended and refused (P5)',
        twice.linking.getLinkedEntities().length === 2 && twice.error === true && twice.errorMessage === '0x80041103 Query Builder Error' && twice.sortedRecordIds.length === 0,
        JSON.stringify({ links: twice.linking.getLinkedEntities().length, error: twice.error, message: twice.errorMessage, rows: twice.sortedRecordIds.length }));
    check('…with the rows cleared and the total left as it was (P11)', twice.paging.totalResultCount === 9 && Object.keys(twice.records).length === 0, String(twice.paging.totalResultCount));

    const chained = linkedBy(0, PARENT1);
    chained.linking.addLinkedEntity({ name: 'account', from: 'accountid', to: 'p.parentaccountid', linkType: 'inner', alias: 'q' });
    chained.refresh();
    check('a link chained from another link\'s alias is refused (P6)', chained.error === true && chained.sortedRecordIds.length === 0);

    const missing = host.createHost(fixture, { pageSize: 50 }).dataset;
    missing.linking.addLinkedEntity({ ...toParent, to: 'nosuchcolumn' });
    missing.refresh();
    check('a link to a column the table does not have is refused (P11)', missing.error === true && missing.errorMessage === '0x80041103 Query Builder Error' && missing.paging.totalResultCount === 12);

    const fetchXml = (xml) => form.context.webAPI.retrieveMultipleRecords('account', `?fetchXml=${xml}`);

    return Promise.all([
        fetchXml(`<fetch aggregate='true'><entity name='account'><attribute name='accountid' aggregate='count' alias='n'/><link-entity name='account' from='accountid' to='parentaccountid' alias='p'><filter><condition attribute='accountid' operator='eq-or-under' value='${HOLDING}'/></filter></link-entity></entity></fetch>`),
        fetchXml(`<fetch aggregate='true'><entity name='account'><attribute name='accountid' aggregate='count' alias='n'/><link-entity name='account' from='accountid' to='parentaccountid' alias='p' link-type='outer'><filter><condition attribute='accountid' operator='eq' value='${PARENT2}'/></filter></link-entity></entity></fetch>`),
    ]).then(([inner, outer]) => {
        check('FetchXML: an inner link-entity\'s filter is judged at its other end', inner.entities[0].n === 9, JSON.stringify(inner.entities));
        check('FetchXML: an outer one narrows nothing', outer.entities[0].n === 12, JSON.stringify(outer.entities));
    });
}

function verifyOtherShapes() {
    console.log('\nAdopting as a dataset control…\n');

    const dataset = adoptWith(['--type', 'dataset']);

    try {
        check('the dataset control lands', dataset.has(`${ANSWERS.control}/index.ts`));
        check('the dataset fixture lands', dataset.has('dev/fixture.js'));
        check('the hub fixture lands', dataset.has('demo/records.json'));
        check(
            'the shared dev files survive the overlay',
            dataset.has('dev/dom.js') && dataset.has('dev/clock.js') && dataset.has('dev/serve.js') && dataset.has('dev/modules.js'),
        );
        check(
            'a dataset control keeps the browser harness',
            dataset.has('dev/harness.html') && dataset.has('dev/harness.js'),
        );
        /*
         * The preview a dataset control gets is the dataset rig's, card per
         * state. Until 2026-10-05 every scaffold inherited pcf-data-table's own
         * preview — React tags, pinning and filter switches, `.DataTable-*`
         * selectors — which worked for no control but that one.
         */
        check(
            'a dataset control gets the dataset preview, mounted through the dataset rig',
            dataset.read('dev/preview.html').includes('host.createHost(')
                && dataset.read('dev/preview.html').includes("{ id: 'view'")
                && !dataset.read('dev/preview.html').includes('DataTable'),
        );
        check(
            'and its shots frame the preview\'s view card',
            dataset.read('dev/shots.js').includes("page: 'dev/preview.html'") && dataset.read('dev/shots.js').includes("frame: '#view'"),
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

        check('the dataset rig carries dev/linked.js, and its host requires it', dataset.has('dev/linked.js') && /require\('\.\/linked'\)/.test(dataset.read('dev/host.js')));
        check('and the harness and preview load it before the host', ['dev/harness.html', 'dev/preview.html'].every((page) => {
            const html = dataset.read(page);
            const at = (file) => html.search(new RegExp(`<script src="${file.replace('.', '\\.')}"`));
            return at('linked.js') !== -1 && at('linked.js') < at('host.js');
        }));

        pending.push(verifyLinking(dataset.scratch));
    } finally {
        rmSync(dataset.scratch, { recursive: true, force: true });
    }

    console.log('\nAdopting as a React (virtual) dataset control…\n');

    const react = adoptWith(['--type', 'dataset', '--framework', 'react']);

    try {
        check(
            'the browser harness survives for a React control',
            react.has('dev/harness.html') && react.has('dev/harness.js'),
            'Fluent 9 ships no UMD build, so dev/fluent-stub.js stands in for it.',
        );
        check(
            'and the two files that make that possible land beside it',
            react.has('dev/fluent-stub.js') && react.has('dev/virtual-bundle.js'),
        );
        check(
            'the preview is patched for a virtual control: React on the page, the bundle through virtual-bundle.js',
            react.read('dev/preview.html').includes('<script src="virtual-bundle.js"></script>')
                && react.read('dev/preview.html').includes('<script src="fluent-stub.js"></script>')
                && !/\/bundle\.js"><\/script>/.test(react.read('dev/preview.html'))
                && react.read('dev/preview.html').includes('host.createHost('),
        );
        check(
            'and the rest of the rig stays, because npm run smoke still works',
            react.has('dev/smoke.js') && react.has('dev/host.js') && react.has('dev/fixture.js'),
        );

        /*
         * The dataset rig's seam is in `mount` and `pump`, not in `render`.
         * `host.drive` owns the loop and already hands back the element the last
         * pass returned; what the patch adds is putting it on the page — and
         * dropping the `innerHTML = ''` that would leave React reconciling
         * against nodes it no longer owns.
         */
        const datasetRig = react.read('dev/harness.js');
        check(
            'the dataset rig renders what drive() returned',
            datasetRig.includes('ReactDOM.render(driven.element, container)'),
        );
        check(
            'and stops emptying the container by hand',
            !datasetRig.includes("container.innerHTML = ''")
            && datasetRig.includes('ReactDOM.unmountComponentAtNode(container)'),
        );
        check(
            'and inits without a container, which a virtual control never gets',
            datasetRig.includes('instance.init(handle.context, function () {});'),
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

    /*
     * The fourth combination, which had no pass of its own until the browser
     * rig started surviving `--framework react`.
     *
     * It needed none while the react branch only *deleted* files: whatever it
     * did to a dataset repository it did to a field one. Now the two rigs are
     * patched in different places — the field one in `render` and in
     * `__harnessStart`, the dataset one in `mount` and `pump` — and every one of
     * those patches throws if the template moves under it. A throw is a failed
     * adoption, so this pass is what turns "setup.mjs still runs" into an
     * assertion for the shape most React controls actually are.
     */
    console.log('\nAdopting as a React (virtual) field control…\n');

    const virtual = adoptWith(['--framework', 'react']);

    try {
        check(
            'the field preview is patched for a virtual control too',
            virtual.read('dev/preview.html').includes('<script src="virtual-bundle.js"></script>')
                && virtual.read('dev/preview.html').includes('<script src="fluent-stub.js"></script>')
                && !/\/bundle\.js"><\/script>/.test(virtual.read('dev/preview.html'))
                && virtual.read('dev/preview.html').includes('host.createContext('),
        );
        check(
            'the browser harness survives here too',
            virtual.has('dev/harness.html')
            && virtual.has('dev/harness.js')
            && virtual.has('dev/fluent-stub.js')
            && virtual.has('dev/virtual-bundle.js')
            && virtual.has('dev/fixture.js'),
        );

        const page = virtual.read('dev/harness.html');
        check(
            'the page loads React and the Fluent stand-in',
            page.includes('react/umd/react.development.js')
            && page.includes('react-dom/umd/react-dom.development.js')
            && page.includes('src="fluent-stub.js"'),
        );
        /*
         * The bundle tag has to be *gone*, not merely joined by the loader. A
         * `<script src>` runs the bundle before any global is defined, and the
         * first import throws a ReferenceError naming `Reactv16` — a string
         * that appears nowhere in the repository.
         */
        check(
            'and no longer loads the bundle with a script tag',
            !page.includes(`out/controls/${ANSWERS.control}/bundle.js"></script>`)
            && page.includes('src="virtual-bundle.js"'),
            'A script tag runs the bundle before the globals it imports exist.',
        );

        const loader = virtual.read('dev/virtual-bundle.js');
        check(
            'the loader points at this control\'s bundle',
            loader.includes(`../out/controls/${ANSWERS.control}/bundle.js`),
        );
        check(
            'and reads the version-encoded globals out of it rather than naming them',
            loader.includes('Reactv') && loader.includes('FluentUIReact')
            && !loader.includes('window.Reactv16 ='),
        );

        const rig = virtual.read('dev/harness.js');
        check(
            'the field rig renders what updateView returned',
            rig.includes('ReactDOM.render(instance.updateView(context), container)')
            && rig.includes('ReactDOM.render(returned, container)'),
        );
        check(
            'and inits without a container',
            rig.includes('instance.init(context, notifyOutputChanged, {});'),
        );
        /*
         * The bail inverts rather than disappearing: this page now refuses a
         * control whose `updateView` returned *nothing*, which is a standard
         * control on a virtual page. Left pointing the old way it would refuse
         * every control the page can actually render.
         */
        check(
            'and the shape guard now points the other way',
            rig.includes('if (returned === undefined) {') && !rig.includes('if (returned !== undefined) {'),
        );

        const stub = virtual.read('dev/fluent-stub.js');
        check(
            'the stub says what it is less capable than the real Fluent at',
            stub.includes('Nothing is portalled')
            && stub.includes('No focus trap and no Escape'),
            'A stub that quietly does more than the real thing certifies a control that does not work.',
        );

        check(
            'setup removes the shared patch module it imported',
            !virtual.has('scripts/virtual-harness.mjs'),
        );
    } finally {
        rmSync(virtual.scratch, { recursive: true, force: true });
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
/**
 * `sync-rig.mjs` against a repository whose copies have aged in the three ways
 * a real one does: one file an old template version nobody touched (`dom.js`; `clock.js` has never changed), one edited
 * by hand, and a host that belongs to the control. Only the first may move,
 * and a dry run may move nothing.
 *
 * The old copy is written with CRLF endings on purpose — that is how
 * `core.autocrlf` leaves it on a Windows checkout of a repository that has
 * not taken the template's `.gitattributes` yet, and a comparison that did
 * not normalise would call every such file "modified" and update none.
 */
/**
 * `--bind number` and `--bind yesno`, adopted and read.
 *
 * Each rewrites five places — the manifest, the entry point, every language's
 * resx, the suite's COLUMN line and worked example, the harness's COLUMN line
 * — and a rewrite that misses one still produces a repository that installs.
 * The suites themselves are proven by building them, which this script does
 * not do; these checks prove the adoption put each piece where the build will
 * find it, and that the combinations `--bind` refuses are refused.
 */
function verifyBindings() {
    console.log('\nAdopting with --bind number…\n');

    const number = adoptWith(['--bind', 'number']);
    const control = ANSWERS.control;
    const languages = ['1033', '3082', '1036', '1031', '1041'];

    try {
        const manifest = number.read(`${control}/ControlManifest.Input.xml`);

        check(
            'the value property binds the four-type number group, Decimal first (the hub demos the first member)',
            /<type-group name="number">\s*<type>Decimal<\/type>\s*<type>Whole\.None<\/type>\s*<type>FP<\/type>\s*<type>Currency<\/type>\s*<\/type-group>/.test(manifest)
                && /<property name="value"[^>]*of-type-group="number"/.test(manifest)
                && !/name="value"[^>]*of-type="SingleLine\.Text"/.test(manifest),
        );
        check('and keeps the placeholder input, which a number box can show', /<property name="placeholder"/.test(manifest));

        const entry = number.read(`${control}/index.ts`);

        check('the number entry point lands, named for the control', entry.includes(`export class ${control}`) && entry.includes('numberFormattingInfo'));
        check(
            'every language gains the number strings',
            languages.every((lcid) => /<data name="ColorPicker_NotANumber"[\s\S]*?<data name="ColorPicker_OutOfRange"/.test(number.read(`${control}/strings/${control}.${lcid}.resx`))),
        );

        const smoke = number.read('dev/smoke.js');

        check(
            'the suite mounts a Decimal column through the group, and runs the number example',
            /const COLUMN = \{ valueType: 'Decimal', value: 1234\.5, typeGroup: \['Decimal', 'Whole\.None', 'FP', 'Currency'\] \};/.test(smoke)
                && smoke.includes("a German user's 2.500,75 is 2500.75")
                && !smoke.includes("'shows the value the platform supplied'")
                && smoke.includes("what destroy owes") && smoke.includes("THE RIG'S OWN CLAIMS"),
        );
        check(
            'and the harness stands in for the same column',
            number.read('dev/harness.js').includes("var COLUMN = { valueType: 'Decimal', value: 1234.5"),
        );
        check(
            'and so does every card of the preview',
            number.read('dev/preview.html').includes("var COLUMN = { valueType: 'Decimal', value: 1234.5"),
        );
    } finally {
        rmSync(number.scratch, { recursive: true, force: true });
    }

    console.log('\nAdopting with --bind yesno…\n');

    const yesno = adoptWith(['--bind', 'yesno']);

    try {
        const manifest = yesno.read(`${control}/ControlManifest.Input.xml`);

        check('the value property binds TwoOptions', /<property name="value"[^>]*of-type="TwoOptions"/.test(manifest));
        check(
            'the placeholder input goes, from the manifest and from every language',
            !/name="placeholder"/.test(manifest)
                && languages.every((lcid) => !yesno.read(`${control}/strings/${control}.${lcid}.resx`).includes('placeholder_')),
        );
        check(
            'every language gains Yes and No',
            languages.every((lcid) => /<data name="ColorPicker_Yes"[\s\S]*?<data name="ColorPicker_No"/.test(yesno.read(`${control}/strings/${control}.${lcid}.resx`))),
        );
        check('the stylesheet gains the checkbox rules', yesno.read(`${control}/css/${control}.css`).includes('.ColorPicker .ColorPicker-check'));
        check(
            'the suite and the harness stand in for a yes/no column',
            yesno.read('dev/smoke.js').includes("const COLUMN = { valueType: 'TwoOptions', value: false };")
                && yesno.read('dev/harness.js').includes("var COLUMN = { valueType: 'TwoOptions', value: false };")
                && yesno.read('dev/preview.html').includes("var COLUMN = { valueType: 'TwoOptions', value: false };"),
        );
    } finally {
        rmSync(yesno.scratch, { recursive: true, force: true });
    }

    console.log('\nRefusing --bind where it does not apply…\n');

    for (const extra of [['--bind', 'number', '--type', 'dataset'], ['--bind', 'yesno', '--framework', 'react'], ['--bind', 'date']]) {
        let refused = null;
        let scratch = null;

        try {
            scratch = adoptWith(extra).scratch;
        } catch (error) {
            refused = String(error.stderr || error.message);
        } finally {
            if (scratch) {
                rmSync(scratch, { recursive: true, force: true });
            }
        }

        check(`setup refuses ${extra.join(' ')}, with a reason`, refused !== null && /--bind/.test(refused), refused ? refused.trim().split('\n')[0] : 'adopted');
    }
}

function verifySync() {
    console.log('\nAdopting, ageing the rig, then syncing it…\n');

    const repo = adoptWith([]);
    const file = (p) => join(repo.scratch, p);
    const lf = (text) => text.replace(/\r\n/g, '\n');

    const run = (extra = []) => {
        const result = spawnSync(process.execPath, [join(root, 'scripts', 'sync-rig.mjs'), '--into', repo.scratch, ...extra], {
            cwd: root, encoding: 'utf8',
        });

        return { status: result.status, out: `${result.stdout}${result.stderr}` };
    };

    try {
        const versions = execFileSync('git', ['log', '--format=%H', '--', 'dev/dom.js'], { cwd: root, encoding: 'utf8' })
            .split('\n').filter(Boolean);
        const current = lf(readFileSync(join(root, 'dev/dom.js'), 'utf8'));
        const older = versions
            .map((sha) => lf(execFileSync('git', ['show', `${sha}:dev/dom.js`], { cwd: root, encoding: 'utf8' })))
            .find((text) => text !== current);

        check('the template has an older dev/dom.js to age the rig with', older !== undefined);

        if (older === undefined) {
            return;
        }

        writeFileSync(file('dev/dom.js'), older.replace(/\n/g, '\r\n'));
        writeFileSync(file('dev/serve.js'), `${repo.read('dev/serve.js')}\n// edited in this repository\n`);
        const host = `${repo.read('dev/host.js')}\n// the control's own\n`;
        writeFileSync(file('dev/host.js'), host);

        const dry = run(['--dry-run']);
        check('a dry run exits 0', dry.status === 0, dry.out);
        check('and writes nothing', lf(repo.read('dev/dom.js')) === older);

        const sync = run();
        check('a sync exits 0', sync.status === 0, sync.out);
        check('an old, untouched copy is updated', lf(repo.read('dev/dom.js')) === current);
        check('keeping the line endings it had', repo.read('dev/dom.js').includes('\r\n'));
        check('an edited copy is kept', repo.read('dev/serve.js').includes('// edited in this repository'));
        check('and reported as modified', /modified\s+dev\/serve\.js/.test(sync.out), sync.out);
        check('the control\'s own host is never written', repo.read('dev/host.js') === host);
        check('a substituted file the adoption wrote counts as current', /current\s+scripts\/check-template\.mjs/.test(sync.out), sync.out);

        const forced = run(['--force', 'dev/serve.js']);
        check('--force <path> replaces that one edited file', forced.status === 0 && !repo.read('dev/serve.js').includes('// edited in this repository'));
        check('and still not the host', repo.read('dev/host.js') === host);

        /*
         * dom.js and clock.js are added back only where the suite requires
         * them. A suite that never loads the bundle (Code-Editor-PCF
         * transpiles pure modules) may still *name* dom.js in a comment, and
         * a mention is not a require.
         */
        rmSync(file('dev/clock.js'));
        const planned = () => spawnSync(
            process.execPath,
            [join(root, 'scripts', 'sync-rig.mjs'), '--into', repo.scratch, '--dry-run', '--add-missing'],
            { cwd: root, encoding: 'utf8' },
        ).stdout;

        check('--add-missing restores a clock.js the suite requires', /add\s+dev\/clock\.js/.test(planned()), planned());

        writeFileSync(file('dev/smoke.js'), '// This suite never loads clock.js or the bundle.\n');
        check('and skips one the suite only mentions', /not used\s+dev\/clock\.js/.test(planned()), planned());

        /*
         * modules.js by the same rule, from the other side: a suite that
         * drives pure modules instead of the bundle requires the loader and
         * nothing else of the rig — the shape pcf-code-editor has.
         */
        rmSync(file('dev/modules.js'));
        writeFileSync(file('dev/smoke.js'), "const { createLoader } = require('./modules');\n");
        check('--add-missing restores a modules.js the suite requires, without the .js', /add\s+dev\/modules\.js/.test(planned()), planned());
        check('while dom.js, which that suite never loads, stays out', !/add\s+dev\/dom\.js/.test(planned()), planned());

        /*
         * keys.js is loaded by a walk of its own, never by the suite, so its
         * `loadedBy` is the folder: any file in dev/ that requires it. Twenty
         * repositories read it as missing until 2026-10-17, none of which
         * presses a key.
         */
        if (existsSync(file('dev/keys.js'))) {
            rmSync(file('dev/keys.js'));
        }

        check('keys.js is not used where nothing in dev/ requires it', /not used\s+dev\/keys\.js\s+— nothing in dev\/ loads it/.test(planned()), planned());

        writeFileSync(file('dev/keys-walk.js'), "const { press } = require('./keys');\n");
        check('and restored once a walk in dev/ requires it', /add\s+dev\/keys\.js/.test(planned()), planned());
        rmSync(file('dev/keys-walk.js'));

        /*
         * The shared view-aggregate library is control code, not rig: it
         * arrives only in a control that has adopted it — its folder exists —
         * and lands under the control's own name.
         */
        const control = JSON.parse(repo.read('pcfhub.json')).control.constructor;
        const libDir = `${control}/lib/view-aggregate`;

        check('the view-aggregate library stays out of a control that has not adopted it', !/lib\/view-aggregate/.test(planned()), planned());

        mkdirSync(file(libDir), { recursive: true });

        const adopting = run(['--add-missing']);
        const lifted = ['types', 'fetchXml', 'rows', 'parent', 'aggregate'];

        check(
            'and arrives under the control\'s own folder once that folder exists',
            adopting.status === 0 && lifted.every((name) => existsSync(file(`${libDir}/${name}.ts`))),
            adopting.out,
        );
        check(
            'as the template\'s own copy',
            lifted.every((name) => lf(repo.read(`${libDir}/${name}.ts`)) === lf(readFileSync(join(root, 'variants/lib/view-aggregate', `${name}.ts`), 'utf8'))),
        );

        /*
         * tree-keys by the same rule: out until its folder exists, then the
         * template's copy, both files.
         */
        const keysDir = `${control}/lib/tree-keys`;

        check('the tree-keys library stays out of a control that has not adopted it', !/lib\/tree-keys/.test(planned()), planned());

        mkdirSync(file(keysDir), { recursive: true });

        const keysAdopted = run(['--add-missing']);

        check(
            'and arrives as the template\'s own copy once its folder exists',
            keysAdopted.status === 0
                && ['keys', 'typeAhead'].every((name) => existsSync(file(`${keysDir}/${name}.ts`))
                    && lf(repo.read(`${keysDir}/${name}.ts`)) === lf(readFileSync(join(root, 'variants/lib/tree-keys', `${name}.ts`), 'utf8'))),
            keysAdopted.out,
        );
    } finally {
        rmSync(repo.scratch, { recursive: true, force: true });
    }

    /*
     * A grid customizer's dev/ is a harness and a suite and nothing else —
     * setup.mjs replaces it outright, because nothing a customizer runs loads
     * dom.js. --add-missing must not put the form rig back, nor a harness
     * script with no serve.js to run.
     */
    const customizer = adoptWith(['--type', 'grid-customizer']);

    try {
        const planned = spawnSync(
            process.execPath,
            [join(root, 'scripts', 'sync-rig.mjs'), '--into', customizer.scratch, '--dry-run', '--add-missing'],
            { cwd: root, encoding: 'utf8' },
        );

        check(
            '--add-missing brings no form rig into a grid customizer',
            planned.status === 0 && !/add\s+dev\//.test(planned.stdout),
            planned.stdout,
        );
        check('nor a harness script it has no server for', !/scripts:.*harness/.test(planned.stdout), planned.stdout);

        const scripts = JSON.parse(customizer.read('package.json')).scripts;

        check(
            'and no browser tools: a customizer\'s demo is the hub\'s grid',
            !customizer.has('dev/cdp.js') && !customizer.has('dev/hub-demo.html') && !customizer.has('dev/preview.html')
                && scripts.shots === undefined && scripts['demo-check'] === undefined,
            JSON.stringify(scripts),
        );
    } finally {
        rmSync(customizer.scratch, { recursive: true, force: true });
    }
}

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
        /*
         * Move the repository off 0.1.0 *before* adding the sibling, or the
         * version check below cannot tell the right answer from the wrong one:
         * a freshly adopted repo is at 0.1.0 and so is the donor manifest, so
         * a sibling left at the donor's number would pass by coincidence.
         *
         * 0.5.0 rather than 0.2.0 because it is the real case — the repository
         * this was found in.
         */
        execFileSync(process.execPath, [join(root, 'scripts', 'version.mjs'), '--into', repo.scratch, '0.5.0'], {
            cwd: root,
            stdio: 'pipe',
        });

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

        /*
         * The sibling is born at the repository's version, not the donor's
         * 0.1.0.
         *
         * This was a latent release failure for as long as add-control.mjs
         * existed: `release-reusable.yml` checks the tag against **every**
         * manifest in the tree, so a sibling added to a repo at 0.5.0 and left
         * at 0.1.0 throws on the next tag — on a Windows runner, after the
         * pack, on a tag already pushed. A second control in one solution is
         * one shipped artifact with one version; there is no arrangement in
         * which it has a number of its own.
         */
        const siblingVersion = /<control\b[^>]*>/.exec(manifest)?.[0].match(/\bversion\s*=\s*"([^"]*)"/)?.[1];
        const repoVersion = JSON.parse(repo.read('package.json')).version;

        check(
            `the sibling is born at the repository's version (${repoVersion}), not the donor's 0.1.0`,
            siblingVersion === repoVersion,
            `sibling manifest says ${siblingVersion}, package.json says ${repoVersion}`,
        );

        check(
            "and its project package.json agrees",
            JSON.parse(repo.read(`${SIBLING}/package.json`)).version === repoVersion,
        );
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
         * and pcfhub.json still carry their authoring prompts, **it never reaches
         * the per-control checks at all**. Asserting "it did not complain about the
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
        writeFileSync(
            join(repo.scratch, 'pcfhub.json'),
            repo.read('pcfhub.json').replace('__SUMMARY__', 'Written by the author.'),
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

        /*
         * A preset may name a fixture of its own (`presets[].datasetFixture`,
         * 2026-10-12), and the gate has to open that file too. Until it did, a
         * typo in a preset's path passed here and cost the preset its rows on
         * the hub, in an ingestion run nobody is watching. Asserted on the
         * healthy repository for the reason above: the gate reaches no file
         * check while a placeholder remains.
         */
        const published = repo.read('pcfhub.json');
        const withPresetFixture = (path) => {
            const manifest = JSON.parse(published);

            manifest.demo = {
                ...manifest.demo,
                presets: [{ slug: 'own-rows', name: 'Its own rows', props: {}, datasetFixture: path }],
            };
            writeFileSync(join(repo.scratch, 'pcfhub.json'), `${JSON.stringify(manifest, null, 4)}\n`);

            return runGate();
        };

        const absent = withPresetFixture('demo/no-such-rows.json');

        check("check-template opens a preset's own fixture, and names the key when the file is not there",
            absent.status === 1
            && /demo\.presets\[0\]\.datasetFixture as "demo\/no-such-rows\.json", which does not exist/.test(absent.out),
            absent.out.trim().split('\n').slice(0, 8).join('\n          '));

        // The published control here is a field control, which reads only a
        // `dataverse` or `services` section — and the sibling's fixture is rows.
        const rows = withPresetFixture('demo/records.json');

        check("and holds it to the shape the demo's own fixture is held to",
            rows.status === 1
            && /demo\.presets\[0\]\.datasetFixture "demo\/records\.json" must have a dataverse object/.test(rows.out),
            rows.out.trim().split('\n').slice(0, 8).join('\n          '));

        writeFileSync(join(repo.scratch, 'pcfhub.json'), published);

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

/**
 * The shared libraries' own behaviour, from `variants/lib/` as they stand.
 *
 * `setup.mjs` deletes `variants/` on adoption, so nothing the Windows build
 * runs ever loads a library: until a control adopts one and its own suite
 * reaches it, a broken edit here ships to every adopter on the next sync.
 * close-when-hidden went out on 2026-10-14 tested only inside
 * pcf-lookup-search. These are those tests, held by the template.
 *
 * Loaded through `dev/modules.js`, which needs `typescript`. The template
 * job installs that one package into a folder of its own and points
 * NODE_PATH at it, rather than installing the whole toolchain a pack needs;
 * locally, `npm install` in the template is enough.
 */
function verifyLibs() {
    console.log('\nChecking the shared libraries…\n');

    const require = createRequire(import.meta.url);
    let createLoader;
    try {
        ({ createLoader } = require(join(root, 'dev', 'modules.js')));
        createLoader({ root: join(root, 'dev') });
    } catch (error) {
        check('typescript can be loaded, so the libraries can be (npm install, or NODE_PATH at a folder that has it)', false, String(error.message).split('\n')[0]);

        return;
    }
    const loadFrom = (lib) => createLoader({
        root: join(root, 'variants', 'lib', lib),
        forbid: [[/react|fluentui/, 'stay free of React'], [/^[^.]/, 'any package']],
    });

    // --- tree-keys -------------------------------------------------------
    const keys = loadFrom('tree-keys')('keys');
    const ahead = loadFrom('tree-keys')('typeAhead');

    /*
     * The tree pcf-code-editor's suite walked, as generic rows:
     *   $ (open) › a (closed), b (leaf), c (closed)
     * and the same with a opened:  $ › a › a.x, a.y (closed) › b › c
     */
    const row = (id, level, expanded) => ({ id, level, expanded, name: id.split('.').pop() });
    const closed = [row('$', 1, true), row('a', 2, false), row('b', 2, undefined), row('c', 2, false)];
    const opened = [row('$', 1, true), row('a', 2, true), row('a.x', 3, undefined), row('a.y', 3, false), row('b', 2, undefined), row('c', 2, false)];
    const go = (rows, focus, key, extra) => keys.treeKey(rows, focus, { key, ...(extra || {}) }, 3);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    check('tree-keys: Down and Up move one row and stop at the ends', same(
        [go(opened, 0, 'ArrowDown').focus, go(opened, 1, 'ArrowUp').focus, go(opened, 0, 'ArrowUp').focus, go(opened, 5, 'ArrowDown').focus],
        [1, 0, 0, 5],
    ));
    check('tree-keys: Home, End, and Page Down/Up by the page given', same(
        [go(opened, 2, 'Home').focus, go(opened, 0, 'End').focus, go(opened, 0, 'PageDown').focus, go(opened, 3, 'PageUp').focus],
        [0, 5, 3, 0],
    ));
    check('tree-keys: Right on a closed node names it to open, focus stays', same(
        (({ focus, open, close, handled }) => [focus, open, close, handled])(go(closed, 1, 'ArrowRight')),
        [1, ['a'], [], true],
    ));
    check('tree-keys: Right on an open node moves to its first child', go(opened, 1, 'ArrowRight').focus === 2);
    check('tree-keys: …but not past an open node whose children are not drawn yet', go([row('a', 1, true), row('b', 1, undefined)], 0, 'ArrowRight').focus === 0);
    check('tree-keys: Right on a leaf moves nothing and is still taken', same([go(opened, 2, 'ArrowRight').focus, go(opened, 2, 'ArrowRight').handled], [2, true]));
    check('tree-keys: Left on a leaf goes to its parent; on an open node names it to close', same(
        [go(opened, 2, 'ArrowLeft').focus, go(opened, 1, 'ArrowLeft').close, go(opened, 1, 'ArrowLeft').focus],
        [1, ['a'], 1],
    ));
    check('tree-keys: Left on the open top node closes it — there is no parent', same(go(opened, 0, 'ArrowLeft').close, ['$']));
    check('tree-keys: * opens every closed sibling, and only siblings, focus stays', same(
        [go(opened, 4, '*').open, go(opened, 4, '*').focus, go(opened, 2, '*').open],
        [['c'], 4, ['a.y']],
    ));
    check('tree-keys: Enter asks for the row\'s action, Ctrl+C and Cmd+C for a copy', same(
        [go(opened, 4, 'Enter').action, go(opened, 4, 'c', { ctrl: true }).action, go(opened, 4, 'C', { meta: true }).action],
        ['activate', 'copy', 'copy'],
    ));
    check('tree-keys: every other shortcut is the host\'s, untouched', [
        go(opened, 4, 's', { ctrl: true }), go(opened, 4, 'c', { ctrl: true, alt: true }), go(opened, 4, 'ArrowDown', { alt: true }),
    ].every((r) => !r.handled && r.focus === 4));
    check('tree-keys: Space is taken and moves nothing', same([go(opened, 4, ' ').handled, go(opened, 4, ' ').focus], [true, 4]));
    check('tree-keys: Escape, Tab and F2 are not the tree\'s', ['Escape', 'Tab', 'F2'].every((k) => !go(opened, 4, k).handled));
    check('tree-keys: no rows, nothing taken', keys.treeKey([], 0, { key: 'ArrowDown' }).handled === false);
    check('tree-keys: parentIndex and siblingIndexes', same(
        [keys.parentIndex(opened, 3), keys.parentIndex(opened, 1), keys.parentIndex(opened, 0), keys.siblingIndexes(opened, 4), keys.siblingIndexes(opened, 0)],
        [1, 0, -1, [1, 4, 5], [0]],
    ));

    check('tree-keys: type-ahead — a first letter searches from the next row, wrapping', same(
        [ahead.typeAhead(opened, 0, 'b'), ahead.typeAhead(opened, 4, 'b'), ahead.typeAhead(opened, 0, 'q'), ahead.typeAhead(opened, 0, 'C')],
        [4, 4, -1, 5],
    ));
    {
        const two = [row('beta', 1, undefined), row('bravo', 1, undefined)];
        check('tree-keys: …one letter again moves on; a growing buffer searches from where it is', same(
            [ahead.typeAhead(two, 0, 'b'), ahead.typeAhead(two, 0, 'be'), ahead.typeAhead(two, 0, 'br')],
            [1, 0, 1],
        ));
    }
    check('tree-keys: what counts as type-ahead: one character, no shortcut, not Space or *', same(
        ['a', 'é', ' ', '*', 'Enter'].map((key) => ahead.isTypeAhead({ key })).concat(ahead.isTypeAhead({ key: 'a', ctrl: true })),
        [true, true, false, false, false, false],
    ));
    {
        const first = ahead.nextBuffer(null, 'b', 1000);
        const grown = ahead.nextBuffer(first, 'r', 1400);
        const fresh = ahead.nextBuffer(grown, 'c', 1400 + ahead.TYPE_AHEAD_QUIET_MS + 1);
        check('tree-keys: the buffer grows within the quiet time and starts again after it', same(
            [first.text, grown.text, fresh.text, fresh.at],
            ['b', 'br', 'c', 1901],
        ));
    }

    // --- view-aggregate: the operator table -------------------------------
    {
        const fx = loadFrom('view-aggregate')('fetchXml');
        const spelled = (operator) => fx.filterToFetchXml({ conditions: [{ attributeName: 'accountid', conditionOperator: operator, value: 'x' }], filterOperator: 0 }).xml.match(/operator='([^']+)'/)[1];
        check('view-aggregate: a dataset\'s 75–79 are spelled the dataset\'s way, not the SDK\'s (pcf-data-table P2)', same(
            [75, 76, 77, 78, 79].map(spelled),
            ['above', 'under', 'not-under', 'eq-or-above', 'eq-or-under'],
        ));
    }

    // --- related-rows ----------------------------------------------------
    {
        const { parseRelated, isInlineFragment } = loadFrom('related-rows')('fragment');
        const ID = '{7DE84297-9486-EC11-93B0-000D3A5C8441}';
        const one = parseRelated("<link-entity name='account' from='accountid' to='cll_customer'><filter><condition attribute='accountid' operator='eq-or-under' value='{id}'/></filter></link-entity>", 'cll_account');
        check('related-rows: a link with {id} becomes one inner link, aliased rel0', one.ok && same(one.plan.links, [{ name: 'account', from: 'accountid', to: 'cll_customer', linkType: 'inner', alias: 'rel0' }]) && one.plan.usesRecord === true, JSON.stringify(one));
        check('related-rows: …a condition on rel0 with the dataset\'s number for eq-or-under (79) and the id bare', one.ok && same(one.plan.conditionsFor(ID), [{ attributeName: 'accountid', conditionOperator: 79, value: '7de84297-9486-ec11-93b0-000d3a5c8441', entityAliasName: 'rel0' }]));
        check('related-rows: …and the same link as FetchXML, for an aggregate', one.ok && one.plan.fetchXml(ID) === "<link-entity name='account' from='accountid' to='cll_customer' alias='rel0' link-type='inner'><filter type='and'><condition attribute='accountid' operator='eq-or-under' value='7de84297-9486-ec11-93b0-000d3a5c8441'/></filter></link-entity>", one.ok ? one.plan.fetchXml(ID) : '');
        check('related-rows: …and the names to check against the definitions', one.ok && same(one.plan.names.map((n) => `${n.role}:${n.table}.${n.column}`), ['to:cll_account.cll_customer', 'from:account.accountid', 'condition:account.accountid']));

        const two = parseRelated(`<link-entity name="account" from="accountid" to="cll_customer" alias="acc"><filter type="and"><condition attribute="statecode" operator="eq" value="0"/></filter></link-entity>
            <link-entity name="systemuser" from="systemuserid" to="ownerid"><filter><condition attribute="isdisabled" operator="eq" value="0"/><condition attribute="businessunitid" operator="in"><value>b1</value><value>b2</value></condition></filter></link-entity>`, 'cll_account');
        check('related-rows: sibling links keep their alias or get the next free one; in takes a list', two.ok && same(two.plan.links.map((l) => l.alias), ['acc', 'rel0']) && same(two.plan.conditionsFor('x').map((c) => [c.entityAliasName, c.conditionOperator, c.value]), [['acc', 0, '0'], ['rel0', 0, '0'], ['rel0', 8, ['b1', 'b2']]]) && two.plan.usesRecord === false, JSON.stringify(two));

        const refused = (text) => { const r = parseRelated(text, 'cll_account'); return r.ok ? 'ok' : r.problem; };
        const link = (inner, attrs = "name='account' from='accountid' to='cll_customer'") => `<link-entity ${attrs}>${inner}</link-entity>`;
        const cond = "<filter><condition attribute='accountid' operator='eq' value='{id}'/></filter>";
        check('related-rows: refuses by name — nested, outer, chained, no condition, or-filter, columns, operator, name, empty, not a link', same(
            [
                refused(link(cond + link(cond))),
                refused(link(cond, "name='account' from='accountid' to='cll_customer' link-type='outer'")),
                refused(link(cond, "name='account' from='accountid' to='rel0.parentaccountid'")),
                refused(link('')),
                refused(link("<filter type='or'><condition attribute='accountid' operator='eq' value='1'/></filter>")),
                refused(link("<attribute name='name'/>" + cond)),
                refused(link("<filter><condition attribute='name' operator='begins-with' value='a'/></filter>")),
                refused(link("<filter><condition attribute='Account Id' operator='eq' value='1'/></filter>")),
                refused('   '),
                refused("<fetch><entity name='account'/></fetch>"),
            ],
            ['nested', 'outer', 'nested', 'no-condition', 'or-filter', 'columns', 'operator', 'name', 'empty', 'not-a-link'],
        ));
        check('related-rows: <filter> with no-value operators and missing values are told apart', same(
            [refused(link("<filter><condition attribute='parentaccountid' operator='null'/></filter>")), refused(link("<filter><condition attribute='accountid' operator='eq'/></filter>"))],
            ['ok', 'value'],
        ));
        check('related-rows: inline means it starts with <', isInlineFragment('  <link-entity/>') && !isInlineFragment('pcfhub_/related.xml'));
    }

    // --- config-source ---------------------------------------------------
    {
        const { classifySource, loadSource, webResourceUrl } = loadFrom('config-source')('load');
        const inline = (text) => text.startsWith('<');
        check('config-source: blank is none, inline is answered at once, anything else is a name', same(
            [classifySource('  ', inline), classifySource(' <x/> ', inline), classifySource('pcfhub_/a b.xml', inline), classifySource(undefined, inline)],
            [{ kind: 'none' }, { kind: 'inline', text: '<x/>' }, { kind: 'named', name: 'pcfhub_/a b.xml' }, { kind: 'none' }],
        ));
        check('config-source: a web resource address encodes each segment', webResourceUrl('pcfhub_/a b.xml', 'https://org.crm.dynamics.com/') === 'https://org.crm.dynamics.com/WebResources/pcfhub_/a%20b.xml');
        const answer = (status, body = '') => () => Promise.resolve({ status, ok: status >= 200 && status < 300, text: () => Promise.resolve(body) });
        pending.push(Promise.all([
            loadSource('pcfhub_x.xml', inline, 'https://org', answer(200, '<link-entity/>')),
            loadSource('pcfhub_x.xml', inline, 'https://org', answer(404)),
            loadSource('pcfhub_x.xml', inline, 'https://org', answer(403)),
            loadSource('pcfhub_x.xml', inline, 'https://org', answer(500)),
            loadSource('pcfhub_x.xml', inline, 'https://org', () => Promise.reject(new TypeError('Failed to fetch'))),
            loadSource('pcfhub_x.xml', inline, null, answer(200)),
            loadSource('<inline/>', inline, null, undefined),
        ]).then((states) => {
            check('config-source: ready, notFound, denied, failed, offline, noHost — and inline needs no host', same(
                states.map((s) => s.state + (s.from ? ':' + s.from : '')),
                ['ready:webresource', 'notFound', 'denied', 'failed', 'offline', 'noHost', 'ready:inline'],
            ), JSON.stringify(states));
        }));
    }

    // --- web-api-action --------------------------------------------------
    {
        const lib = loadFrom('web-api-action');
        const { actionPath, actionBody, readRefusal, readResult, callAction } = lib('action');
        const { loadRecordKeys } = lib('keys');
        const { organisationUrl } = lib('clientUrl');
        const keys = { table: 'account', set: 'accounts', primaryId: 'accountid' };
        const id = '{AAAA0000-0000-0000-0000-000000000001}';
        const bound = { name: 'pcfhub_Run', bound: true, parameters: { Note: 'from {id}', Target: '{record}', List: ['{record}'] }, result: 'Message' };
        const unbound = { name: 'pcfhub_Ping', bound: false, parameters: {}, result: null };
        check('web-api-action: bound is the set, the bare id and the qualified name; unbound is the name alone', same(
            [actionPath(bound, keys, id), actionPath(unbound, keys, id)],
            ['accounts(AAAA0000-0000-0000-0000-000000000001)/Microsoft.Dynamics.CRM.pcfhub_Run', 'pcfhub_Ping'],
        ));
        const reference = { '@odata.type': 'Microsoft.Dynamics.CRM.account', accountid: 'AAAA0000-0000-0000-0000-000000000001' };
        check('web-api-action: {id} is filled in text, {record} becomes a typed reference, deep', same(
            actionBody(bound.parameters, keys, id),
            { Note: 'from AAAA0000-0000-0000-0000-000000000001', Target: reference, List: [reference] },
        ));
        const payload = JSON.stringify({ error: { code: '0x80048d19', message: "Error identified in Payload provided by the user for Entity :''  ---->  InnerException : Microsoft.OData.ODataException: Cannot convert the literal 'x' to the expected type 'Edm.Guid'. ---> stack" } });
        const missing = JSON.stringify({ error: { code: '0x80060888', message: "Resource not found for the segment 'Microsoft.Dynamics.CRM.pcfhub_Run'" } });
        check('web-api-action: a payload refusal reads as the exception\'s own sentence; a qualified 404 is a wrong name; an empty 401 says its status', same(
            [readRefusal(400, payload, bound).sentence, readRefusal(404, missing, bound).nameWrong, readRefusal(401, '', bound).sentence],
            ["Cannot convert the literal 'x' to the expected type 'Edm.Guid'.", true, 'HTTP 401'],
        ));
        check('web-api-action: a named result is read as text, a 204 and an unnamed one as null', same(
            [readResult('{"Message":"Sent"}', 'Message'), readResult('', 'Message'), readResult('{"Message":"x"}', null)],
            ['Sent', null, null],
        ));
        check('web-api-action: no page and no Xrm is no organisation; a throwing getClientUrl is an answer, not a crash', same(
            [organisationUrl({}), organisationUrl({ page: { getClientUrl: () => { throw new Error('Method not implemented.'); } } }), organisationUrl({ page: { getClientUrl: () => 'https://org' } })],
            [null, null, 'https://org'],
        ));
        const sent = [];
        const reply = (status, body = '') => (url, init) => {
            sent.push({ url, init });
            return Promise.resolve({ status, text: () => Promise.resolve(body) });
        };
        pending.push(Promise.all([
            callAction(reply(200, '{"Message":"Done"}'), 'https://org', bound, keys, id),
            callAction(reply(204), 'https://org', unbound, keys, id),
            callAction(reply(404, missing), 'https://org', bound, keys, id),
            callAction(() => Promise.reject(new TypeError('Failed to fetch')), 'https://org', bound, keys, id),
            loadRecordKeys({ getEntityMetadata: () => Promise.resolve({ EntitySetName: 'accounts', PrimaryIdAttribute: 'accountid' }) }, null, undefined, 'account'),
            loadRecordKeys({ getEntityMetadata: () => Promise.resolve({}) }, 'https://org', () => Promise.resolve({ ok: true, json: () => Promise.resolve({ EntitySetName: 'cll_accounts', PrimaryIdAttribute: 'cll_accountid' }) }), 'cll_account'),
            loadRecordKeys(undefined, null, undefined, 'account'),
        ]).then(([ok, empty, wrong, offline, fromMeta, fromDefinitions, none]) => {
            check('web-api-action: 200 with its result, 204 with none, a 404 refused as a wrong name, offline as status 0', same(
                [ok, empty.ok && empty.result, wrong.ok || wrong.refusal.nameWrong, offline.ok || offline.refusal.status],
                [{ ok: true, status: 200, result: 'Done' }, null, true, 0],
            ), JSON.stringify([ok, empty, wrong, offline]));
            check('web-api-action: every call is a same-origin POST with Content-Type JSON', sent.every((s) => s.init.method === 'POST' && s.init.credentials === 'same-origin' && /application\/json/.test(s.init.headers['Content-Type'])));
            check('web-api-action: keys come from metadata, else from EntityDefinitions, else null', same(
                [fromMeta, fromDefinitions, none],
                [keys, { table: 'cll_account', set: 'cll_accounts', primaryId: 'cll_accountid' }, null],
            ));
        }));
    }

    // --- close-when-hidden ----------------------------------------------
    const watch = loadFrom('close-when-hidden')('watch');
    let fire = null;
    const asked = [];
    let disconnected = 0;
    class FakeObserver {
        constructor(callback, options) {
            fire = callback;
            asked.push(options.threshold);
        }
        observe(target) {
            asked.push(target);
        }
        disconnect() {
            disconnected += 1;
        }
    }
    let hidden = 0;
    const stop = watch.watchAnchor('anchor', () => (hidden += 1), FakeObserver);
    fire([{ intersectionRatio: 0.6 }]);
    const keptOpen = hidden === 0;
    fire([{ intersectionRatio: 0.49 }]);
    check('close-when-hidden: more than half in view keeps the surface; less closes it', keptOpen && hidden === 1);
    check('close-when-hidden: watches the anchor at 0, the line and 1', same(asked, [[0, watch.VISIBLE_AT_LEAST, 1], 'anchor']));
    stop();
    check('close-when-hidden: the returned function disconnects', disconnected === 1);
    check('close-when-hidden: a host without IntersectionObserver gets a no-op', typeof watch.watchAnchor('anchor', () => undefined, undefined) === 'function');

    /*
     * The guard itself, or the two checks above prove nothing: a library
     * that imports a package must throw by name here.
     */
    const scratch = mkdtempSync(join(tmpdir(), 'pcfhub-lib-'));
    try {
        writeFileSync(join(scratch, 'leaky.ts'), "import * as React from 'react';\nexport const leak = React;\n");
        let refused = '';
        try {
            createLoader({ root: scratch, forbid: [[/react|fluentui/, 'stay free of React']] })('leaky');
        } catch (error) {
            refused = String(error.message);
        }
        check('a library that imports React is refused by name', /leaky\.ts imports react/.test(refused), refused);
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

async function main() {
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
        check('the workspace tools are not inherited', !has('scripts/sync-rig.mjs') && !has('scripts/workspace-status.mjs'));
        check('adopt.mjs is removed', !has('scripts/adopt.mjs'));
        check('sync-rig.mjs is removed', !has('scripts/sync-rig.mjs'));
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
        // LF in every working tree (2026-10-09): what lets sync-rig's copies
        // compare equal to the template's byte for byte. It is a dotfile, the
        // kind a hand-written copy step forgets.
        check(
            '.gitattributes is kept, as the template has it',
            has('.gitattributes') && read('.gitattributes') === readFileSync(join(root, '.gitattributes'), 'utf8'),
        );

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
            has('dev/smoke.js') && has('dev/host.js') && has('dev/dom.js') && has('dev/clock.js') && has('dev/modules.js'),
        );

        /*
         * The field rig answers the Web API from a fixture too, since the first
         * field control that read a hierarchy through it. A rig without the
         * file fails at `require` rather than at the assertion that needs it.
         */
        check(
            'the field fixture lands and the page loads it before the host',
            has('dev/fixture.js')
            && read('dev/harness.html').indexOf('src="fixture.js"') !== -1
            && read('dev/harness.html').indexOf('src="fixture.js"') < read('dev/harness.html').indexOf('src="host.js"'),
        );

        check('the browser harness lands for a standard control', has('dev/harness.html') && has('dev/harness.js'));

        /*
         * The browser tools: the engine, the screenshot recipes that frame this
         * shape's harness, and the hub-demo stand-in with its checker. A recipe
         * framing an element the harness does not have fails every retake.
         */
        check(
            'the browser tools land',
            has('dev/cdp.js') && has('dev/shots.js') && has('dev/hub-demo.html') && has('dev/demo-check.js'),
        );
        check(
            'the field preview lands: cards mounted through the field rig, from the column --bind rewrites',
            read('dev/preview.html').includes('host.createContext(')
                && read('dev/preview.html').includes('var COLUMN = { valueType: host.DEFAULTS.valueType, value: host.DEFAULTS.value };')
                && !read('dev/preview.html').includes('DataTable'),
        );
        check(
            'and the shots frame its cards',
            read('dev/shots.js').includes("page: 'dev/preview.html'") && read('dev/shots.js').includes("frame: '.card'"),
        );

        const pkg = JSON.parse(read('package.json'));

        check(
            'package.json runs both',
            pkg.scripts.shots === 'node dev/shots.js' && pkg.scripts['demo-check'] === 'node dev/demo-check.js',
            JSON.stringify(pkg.scripts),
        );

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

        /*
         * `scripts/templates/` survives adoption on purpose: it holds donor
         * pages that `version.mjs` writes out when a release needs one, and it
         * carries `__VERSION__` for the same reason the adoption scripts carry
         * `__CONTROL__` — it is the thing that fills it in. The two scripts
         * that name the token in a comment are exempt for the same reason.
         */
        const CARRIES_TOKENS = new Set([
            'scripts/templates/migration.md', 'scripts/version.mjs', 'scripts/check-template.mjs',
        ]);

        for (const file of walk(scratch)) {
            if (file === 'package-lock.json' || /\.(png|jpe?g|gif|webp|ico|woff2?|zip)$/i.test(file)) {
                continue;
            }

            if (CARRIES_TOKENS.has(file)) {
                continue;
            }

            const found = (read(file).match(PLACEHOLDER) ?? []).filter((t) => !AUTHORING_PROMPTS.has(t));

            if (found.length > 0) {
                leftovers.push(`${file}: ${[...new Set(found)].join(', ')}`);
            }
        }

        check(
            'no placeholder survives adoption except the authoring prompts',
            leftovers.length === 0,
            leftovers.join('\n          '),
        );

        // --- the adopted repository's own gate still works ----------------
        //
        // It must still fail, and for exactly one reason: the prose only the
        // author can write — the README's sections and pcfhub.json's summary. A
        // pass here would mean the gate stopped gating; a failure naming
        // anything else would mean adoption left work behind that it should
        // have finished.
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
            'and fails only on the prose the author must write',
            gate.status === 1 && /README\.md/.test(gate.out) && !/still contains __(?!WHAT_IT_DOES|PROPERTIES|ON_THE_HUB|SUMMARY)/.test(gate.out),
            gate.out.trim().split('\n').slice(0, 6).join('\n          '),
        );

        /*
         * The summary is the one prompt outside the README, so it is the one
         * that can be mistaken for a repository that never ran setup — whose
         * pcfhub.json is full of tokens — and be told to run a script that
         * will not help.
         */
        check(
            'names the unwritten summary, says what belongs there, and does not send the author back to setup',
            /pcfhub\.json still contains __SUMMARY__/.test(gate.out)
                && /under "Overview"/.test(gate.out)
                && !/npm run setup/.test(gate.out),
            gate.out.trim().split('\n').slice(0, 12).join('\n          '),
        );
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }

    verifyOtherShapes();
    verifyBindings();
    verifySibling();
    verifySync();
    verifyLibs();
    await Promise.all(pending);

    console.log('\nChecking the template itself…\n');
    commentsDoNotCarryPlaceholders();
    await fieldRigAnswersTheFiscalYear();

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

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

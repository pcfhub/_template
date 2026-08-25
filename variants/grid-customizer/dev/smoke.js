/*
 * Drives the real built bundle outside a browser.
 *
 *     npm run build && npm run smoke
 *
 * What it does: stubs the globals the platform provides, loads
 * `out/controls/__CONTROL__/bundle.js` exactly as the grid would, lets the
 * control fire its payload, then calls the overrides the way the grid calls
 * them and inspects the React elements that come back.
 *
 * Why it exists alongside `dev/harness.html`: the harness shows you a grid, and
 * a customizer's real behaviour is a set of decisions taken per cell — which
 * cells it declines, what geometry it computes, which class it puts on an
 * element. Those are invisible in a rendered grid unless you happen to be
 * looking at the right cell, and they are exactly what regresses. Here they are
 * assertions with an exit code.
 *
 * Why no test framework: there is none in this repository, and adding one to
 * run a handful of assertions against a bundle would be a dependency, a config
 * file and a second build pipeline for something `node` already does. It also
 * runs the **built bundle** rather than the TypeScript sources, which is the
 * part worth checking — webpack, the externals and the manifest all sit between
 * the source and what a grid actually loads. CI runs it *after* the msbuild
 * pack, so there it drives the production bundle.
 *
 * **What passing here does NOT mean.** Every value below is supplied by this
 * file. It cannot tell you whether the platform calls your overrides, what a
 * real cell's `value` looks like, or whether metadata resolves — and it cannot
 * produce `validationError`, `secured` or `isRequired`, which makes the
 * branches handling those the ones it cannot check. Keep the answers to those
 * in SPEC.md under "Not verified".
 *
 * **And a stub must never be more capable than the thing it stands in for.**
 * That is not a style note here; it is how this file once passed a customizer
 * that did nothing at all on a real grid, twice, because its metadata stub
 * answered for columns the real API answers nothing for. When you stub a
 * platform call, stub its refusals first — the argument it requires, the fields
 * it omits, the empty collection it hands back. If you cannot say what the real
 * call withholds, the stub is a guess and the assertions resting on it prove
 * nothing.
 *
 * ---
 *
 * **The assertions below the divider are a worked example. Replace them.**
 * Everything above the divider is plumbing that works for any customizer; the
 * examples exercise the scaffolded `Text` override and are meant to be thrown
 * away with it.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Resolved from this file rather than from the working directory, so the script
// behaves the same run directly or through npm.
const root = path.join(__dirname, '..');
const React = require(path.join(root, 'node_modules', 'react'));

const BUNDLE = path.join(root, 'out', 'controls', '__CONTROL__', 'bundle.js');

if (!fs.existsSync(BUNDLE)) {
    console.error('\n  No bundle at out/controls/__CONTROL__. Run npm run build first.\n');
    process.exit(1);
}

/* ----------------------------------------------------------- the platform */

global.Reactv16 = React;
global.self = global;
global.window = global;

// `publishTheme` writes a theme attribute to the document during init. Two
// methods are all it touches.
global.document = {
    documentElement: { setAttribute() {}, removeAttribute() {} },
};

/*
 * Fluent, stubbed rather than loaded.
 *
 * The manifest declares Fluent 8 as a `<platform-library>`, so the bundle
 * expects a `FluentUIReactv81211` global and does not carry one. Requiring the
 * real package here would drag a browser-shaped library into Node for no gain:
 * these assertions are about the decisions this control makes, not about how
 * Fluent renders them.
 *
 * Every component resolves to its own name as an element type, so
 * `React.createElement(Label, …)` produces `{ type: 'Label', props }` — the
 * props your override passed survive intact, which is what gets inspected. If
 * you ever need real Fluent behaviour, that is the point at which this stops
 * being a smoke test.
 */
global.FluentUIReactv81211 = new Proxy(
    {},
    { get: (_target, name) => (typeof name === 'string' ? name : undefined) },
);

let registered = null;

// Two arguments, not three: pcf-scripts emits
// registerControl('__NAMESPACE__.__CONTROL__', ctor) with the name already
// joined. Reading the constructor from a third parameter gets `undefined`, and
// it surfaces later as "registered is not a constructor".
global.ComponentFramework = {
    registerControl: (fullName, ctor) => {
        registered = ctor;
    },
};

let payload = null;

/*
 * `getString` returns a marked-up key rather than a real string, so an
 * assertion can tell "read from the .resx" apart from "hardcoded in the
 * source" — which would otherwise look identical in the output.
 */
const context = {
    parameters: { EventName: { raw: 'smoke-event' } },
    factory: {
        fireEvent: (name, fired) => {
            payload = fired;
        },
        requestRender() {},
    },
    resources: { getString: (key) => `resx:${key}` },
    fluentDesignLanguage: { isDarkTheme: false },

    /*
     * Answers nothing, on purpose, and this stub is load-bearing.
     *
     * `getEntityMetadata` is the obvious call for a control that needs a
     * column's range and it cannot supply one — twice over, silently. With no
     * `attributes` argument it resolves to an entity whose `Attributes`
     * collection is empty. Name the columns and the attribute metadata still
     * carries no `MinValue`/`MaxValue`: the client-API surface is
     * `AttributeType`, `DisplayName`, `EntityLogicalName`, `LogicalName` and
     * option-set extras, nothing numeric.
     *
     * A stub answering anyway would be *more capable than the platform*, which
     * does not merely miss a bug — it manufactures a green suite for a control
     * with no working path at all. That has happened here before. Ranges come
     * from the `fetch` stub below.
     */
    utils: {
        getEntityMetadata: () => Promise.resolve({ Attributes: { get: () => undefined } }),
    },

    // Confirmed on a real grid: this carries the table's logical name on a
    // customizer, and is the only route to it — a customizer binds no dataset,
    // so there is no `getTargetEntityType()`.
    mode: { contextInfo: { entityTypeName: 'account' } },
    page: { getClientUrl: () => 'https://contoso.crm.dynamics.com' },
};

/*
 * The Dataverse metadata endpoint.
 *
 * A numeric range lives only on the *typed* metadata entities, so it is read
 * through `fetch` against
 * `EntityDefinitions(LogicalName=…)/Attributes/Microsoft.Dynamics.CRM.
 * {Integer,Decimal,Double,Money}AttributeMetadata?$select=LogicalName,MinValue,
 * MaxValue` — one request per column type, because the cast is per request.
 *
 * Keyed by cast so it answers only for the one it was actually given: a stub
 * that returned the same rows for every URL would pass a control that built the
 * wrong request. Delete this and `METADATA` if your customizer reads no
 * metadata; add rows as your overrides start needing them.
 */
const METADATA = {
    MoneyAttributeMetadata: [
        { LogicalName: 'creditlimit', MinValue: 0, MaxValue: 250000 },
    ],
    IntegerAttributeMetadata: [
        { LogicalName: 'satisfaction', MinValue: 0, MaxValue: 100 },
    ],
    DecimalAttributeMetadata: [
        { LogicalName: 'variance', MinValue: -50, MaxValue: 50 },
    ],
};

/** Every metadata URL this run requested, for assertions about the request. */
const metadataCalls = [];

global.fetch = (url) => {
    metadataCalls.push(String(url));

    const cast = /Microsoft\.Dynamics\.CRM\.(\w+)/.exec(String(url));

    return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ value: (cast && METADATA[cast[1]]) || [] }),
    });
};

vm.runInThisContext(fs.readFileSync(BUNDLE, 'utf8'), { filename: 'bundle.js' });

const results = [];

function check(label, ok, detail) {
    results.push({ ok, label, detail });
}

check('bundle registered a control', typeof registered === 'function');

if (typeof registered !== 'function') {
    report();
}

const instance = new registered();

instance.init(context, () => {}, {}, {});
instance.updateView(context);

check('control fired a payload', payload !== null);

const renderers = (payload && payload.cellRendererOverrides) || {};
const editors = (payload && payload.cellEditorOverrides) || {};

// `gridCustomizer` is deliberately not accepted here as a surface on its own.
// The shipping grid ignores that key (verified 2026-08-25 — see the header of
// `customizers/GridCustomizerOverrides.tsx`), so a control whose only output is
// the chrome members passes every local check and does nothing in a real grid.
// Requiring a cell override is what stops this file from certifying that.
check(
    'the payload carries at least one cell override',
    Object.keys(renderers).length + Object.keys(editors).length > 0,
    `renderers: ${Object.keys(renderers).join(', ') || 'none'}; editors: ${Object.keys(editors).join(', ') || 'none'}`,
);

/**
 * Call a cell renderer the way the grid does.
 *
 * `colDefs` and `columnIndex` are the only route to a column's logical name, so
 * an override that narrows by name reads them from here.
 */
function renderCell(dataType, value, options = {}) {
    const colDefs = options.colDefs ?? [{ name: 'name', dataType: 'SingleLine.Text', isPrimary: true }];

    return renderers[dataType](
        {
            value,
            formattedValue: options.formattedValue ?? (value === null || value === undefined ? '' : String(value)),
            columnDataType: dataType,
            isRightAligned: options.isRightAligned ?? false,
            rowHeight: 42,
            validationError: options.validationError ?? null,
        },
        {
            colDefs,
            columnIndex: options.columnIndex ?? 0,
            rowData: { __rec_id: '1' },
            allowTabKeyNavigation: false,
        },
    );
}

/* ======================================================================== *
 *  WORKED EXAMPLE — replace everything below with assertions for your own
 *  overrides. It exercises the scaffolded `Text` renderer, which draws an em
 *  dash for an empty value and declines everything else.
 * ======================================================================== */

if (typeof renderers.Text !== 'function') {
    // The scaffolded override is gone, which is the expected end state — this
    // file is supposed to describe your control, not the template's example.
    check('worked example replaced (no scaffolded Text override remains)', true);
} else {
    check(
        'declines an ordinary value, leaving the grid to draw it',
        renderCell('Text', 'Contoso Ltd') === undefined,
    );

    const empty = renderCell('Text', '');

    check('renders an element for an empty value', React.isValidElement(empty));

    check(
        'the empty-value element is labelled for a screen reader',
        Boolean(empty) && empty.props['aria-label'] === 'No value',
        empty && empty.props['aria-label'],
    );

    check(
        'the empty-value element is scoped to this control',
        Boolean(empty) && /__CONTROL__-/.test(empty.props.className),
        empty && empty.props.className,
    );

    // The state most first drafts render straight through. An element returned
    // here replaces the whole cell, taking the grid's error border and the
    // message at `cellErrorLabelId` with it — so the cell ends up quietly
    // invalid and looking fine.
    check(
        'declines a cell carrying a validation error',
        renderCell('Text', '', { validationError: new Error('invalid') }) === undefined,
    );
}

report();

function report() {
    const failed = results.filter((result) => !result.ok);

    for (const result of results) {
        const detail = result.detail ? `  — ${result.detail}` : '';

        console.log(`  ${result.ok ? 'ok  ' : 'FAIL'}  ${result.label}${detail}`);
    }

    console.log(
        failed.length > 0
            ? `\n  ${failed.length} of ${results.length} failed\n`
            : `\n  ${results.length} passed — the control's own decisions only; see SPEC.md for what a real grid still has to confirm\n`,
    );

    process.exit(failed.length > 0 ? 1 : 0);
}

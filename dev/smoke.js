/*
 * Drives the real built bundle outside a browser.
 *
 *     npm run build && npm run smoke
 *
 * What it does: installs the DOM and the platform globals, loads
 * `out/controls/__CONTROL__/bundle.js` the way a form would, drives the control
 * through the states a form can put it in, and asserts what it did.
 *
 * Why it exists alongside `npm start` and `dev/harness.html`: both of those
 * *show* you the control, and the states that matter most are ones nobody
 * thinks to look at — a column the user cannot read, a business rule that
 * failed, a host with no column metadata, a cleared value that has to travel
 * back as `null` rather than `undefined`. Those are decisions, they are what
 * regresses, and here they are assertions with an exit code.
 *
 * Why no test framework: there is none in this repository, and adding one to
 * run a handful of assertions against a bundle would be a dependency, a config
 * file and a second build pipeline for something `node` already does. It also
 * runs the **built bundle** rather than the TypeScript sources, which is the
 * part worth checking — webpack, the externals and the manifest all sit between
 * the source and what a form actually loads. CI runs it after the msbuild pack,
 * so there it drives the production bundle.
 *
 * **What passing here does NOT mean.** Every value below is supplied by this
 * file. It cannot tell you that the control looks right, that the stylesheet
 * applies, that focus order works, that a real form hands down what these
 * fixtures hand down, or that a save persists anything. Keep the answers to
 * those in SPEC.md under "Not verified".
 *
 * **And a stub must never be more capable than the thing it stands in for.**
 * `dev/host.js` withholds `security`, `attributes` and `fluentDesignLanguage`
 * exactly where the platform withholds them. When you add to it, stub the
 * refusals first — the argument the call requires, the field it omits, the
 * empty collection it hands back. If you cannot say what the real call
 * withholds, the stub is a guess and the assertions resting on it prove
 * nothing.
 *
 * ---
 *
 * **The assertions below the divider are a worked example. Replace them.**
 * Everything above the divider is plumbing that works for any field control;
 * the examples exercise the scaffolded control and are meant to be thrown away
 * with it.
 */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Resolved from this file rather than from the working directory, so the script
// behaves the same run directly or through npm.
const root = path.join(__dirname, '..');
const dom = require('./dom.js');
const host = require('./host.js');
const clock = require('./clock.js');

const BUNDLE = path.join(root, 'out', 'controls', '__CONTROL__', 'bundle.js');

if (!fs.existsSync(BUNDLE)) {
    console.error('\n  No bundle at out/controls/__CONTROL__. Run npm run build first.\n');
    process.exit(1);
}

/* ----------------------------------------------------------- the platform */

dom.install(global);

/*
 * Time, replaced with something the test drives.
 *
 * `vm.runInThisContext` below evaluates the bundle in *this* realm, so the
 * `Date`, `setInterval` and `setTimeout` the control closes over are the ones
 * installed here. That is what makes a control with a clock testable without
 * an injectable clock parameter — which would be production code bent to suit
 * a harness, and the only reason that seam would exist.
 *
 * A control with no timers is unaffected by this: nothing schedules, nothing
 * fires, and `time.pending()` stays at zero. Keep it anyway — the teardown
 * assertion at the bottom of this file is written against it, and it is the
 * assertion worth keeping when the worked example goes.
 *
 * The start value is arbitrary and fixed. A suite that starts at "now" asserts
 * something slightly different every time it runs.
 */
const time = clock.install(Date.UTC(2026, 0, 1, 12, 0, 0), global);

const registration = host.captureRegistration(global);

const source = fs.readFileSync(BUNDLE, 'utf8');

/*
 * The platform libraries, supplied under the names the bundle actually asks
 * for — read out of the bundle rather than written down here.
 *
 * A `<platform-library>` entry becomes a webpack external, and the global it
 * compiles to carries a version in its name. **That version is not the one the
 * manifest declares.** `pcf-scripts` maps a declared version onto the platform
 * build it supports, so Fluent `9.46.2` arrives as `FluentUIReactv940` and
 * React `16.14.0` as `Reactv16`. Hardcoding either is a trap that springs on
 * the next version bump, with a `ReferenceError` naming a global that appears
 * nowhere in the repository.
 *
 * A standard control has no externals at all, in which case both lists are
 * empty and nothing below runs.
 */
const reactGlobals = [...new Set(source.match(/\bReactv[\w]*\b/g) || [])];
const fluentGlobals = [...new Set(source.match(/\bFluentUIReact[\w]*\b/g) || [])];

let React = null;

if (reactGlobals.length > 0) {
    React = require(path.join(root, 'node_modules', 'react'));
    reactGlobals.forEach((name) => {
        global[name] = React;
    });
}

/*
 * Fluent is stubbed rather than loaded, the way the grid rig stubs it: every
 * component resolves to its own name as an element type, so
 * `React.createElement(Input, …)` produces `{ type: 'Input', props }` and the
 * props the control passed survive for inspection. These assertions are about
 * the control's decisions, not about how Fluent renders them — and Fluent 9
 * ships no UMD build, so there is nothing to load in a browser either.
 */
const fluent = new Proxy({}, { get: (_target, name) => (typeof name === 'string' ? name : undefined) });

fluentGlobals.forEach((name) => {
    global[name] = fluent;
});

vm.runInThisContext(source, { filename: 'bundle.js' });

/* ---------------------------------------------------------------- harness */

const results = [];

function check(label, ok, detail) {
    results.push({ ok, label, detail });
}

// `getString` returns a marked key rather than a real string, so an assertion
// can tell "read from the .resx" apart from "hardcoded in the source" — which
// would otherwise look identical in the output.
const marked = (key) => `resx:${key}`;

/**
 * Mount a fresh control in a given state and hand back everything worth
 * asserting about it.
 *
 * A new instance per state on purpose: `init` runs once per control on a real
 * form, so a suite that reused one instance would be testing a sequence the
 * platform never produces. Where the *sequence* is the point — a value arriving
 * after an edit — drive `updateView` again through the returned handle.
 */
/**
 * Every control mounted and not yet destroyed.
 *
 * A suite that mounts and walks away is testing something other than what it
 * says: an abandoned control keeps its interval and its `document` listeners,
 * so the next section's counts include them and the next event dispatched at
 * `document` reaches all of them. That is the leak the teardown assertion
 * exists to catch, and asserting it from inside one proves nothing.
 */
const live = [];

function disposeAll() {
    while (live.length > 0) {
        live.pop().destroy();
    }
}

function mount(options) {
    const container = dom.createElement('div');
    const calls = [];
    // `getString` first, so a single assertion can override it — the marked key
    // proves a string came from the .resx, but it cannot prove a `{0}` was
    // substituted, because a marked key has no `{0}` in it to substitute.
    const context = host.createContext({ getString: marked, ...options, calls });
    const instance = new registration.ctor();

    let notifications = 0;

    instance.init(context, () => {
        notifications += 1;
    }, {}, container);

    // A standard control returns nothing and has written into `container`; a
    // virtual one returns the element it wants rendered and was handed no
    // container at all.
    const element = instance.updateView(context);

    const handle = {
        instance,
        container,
        element,
        props: () => (element && element.props) || {},
        outputs: () => instance.getOutputs(),
        notifications: () => notifications,
        /** `trackContainerResize` / `setFullScreen` calls the control made. */
        calls: () => calls,
        /** Re-render in a new state, as the platform does on every change. */
        update: (next) => instance.updateView(host.createContext({ getString: marked, ...options, ...next })),
        /** Unmount, as the platform does when the form closes or navigates. */
        destroy: () => {
            instance.destroy();

            const at = live.indexOf(handle);

            if (at !== -1) {
                live.splice(at, 1);
            }
        },
        find: (selector) => container.querySelector(selector),
    };

    live.push(handle);

    return handle;
}

check('bundle registered a control', typeof registration.ctor === 'function');

if (typeof registration.ctor !== 'function') {
    report();
}

/* ======================================================================== *
 *  WORKED EXAMPLE — replace everything below with assertions about your own
 *  control. It exercises the scaffolded field control, whose whole job is to
 *  render one text input and honour the states a form puts it in.
 *
 *  It comes in two halves because the scaffolded control does. A **standard**
 *  control writes into the container it was handed, so the assertions read the
 *  DOM it built. A **virtual** one returns an element, so they read the props
 *  it passed down — which is the better test of the two: the props are the
 *  control's decisions, where the DOM is one rendering of them.
 *
 *  Keep the half that matches your control and delete the other. What follows
 *  both halves applies either way.
 * ======================================================================== */

const plain = mount({});

if (plain.element !== undefined) {
    /* ------------------------------------------------- a virtual control */

    check(
        'hands the component the value the platform supplied',
        plain.props().value === 'Contoso Ltd',
        JSON.stringify(plain.props().value),
    );

    /*
     * The information bug. A user denied read access gets `raw === null`, which
     * is indistinguishable from an empty column unless `security.readable` is
     * checked — so an unchecked control renders "no value" where the truth is
     * "not allowed to see it".
     */
    const denied = mount({ security: 'no-access', value: null });

    check('a column the user cannot read is marked unreadable', denied.props().readable === false);

    check(
        'and the message it will show comes from the .resx, not from the source',
        denied.props().noAccessText === 'resx:__CONTROL___NoAccess',
        denied.props().noAccessText,
    );

    /*
     * Two independent reasons to be read-only, and conflating them is a real
     * bug: the form's `isControlDisabled` and the column's `security.editable`.
     * This asserts the second on a form that is otherwise editable.
     */
    check(
        'a read-only column disables the control on an editable form',
        mount({ security: 'read-only' }).props().disabled === true,
    );

    /*
     * The platform's own validation. A failing business rule is silent inside a
     * code component unless the control passes it on.
     */
    check(
        'a validation error reaches the component',
        mount({ error: true }).props().errorMessage === host.DEFAULTS.errorMessage,
        mount({ error: true }).props().errorMessage,
    );

    check('and there is none to show when the platform reported none', plain.props().errorMessage === null);

    /*
     * The canvas/model-driven split, which is what every `?.` in the control is
     * about. A canvas app publishes no column metadata, and a control that
     * requires it breaks on a host half its users are on.
     */
    check(
        'does not invent a maxLength on a host that publishes no column metadata',
        mount({ host: 'canvas' }).props().maxLength === undefined,
        String(mount({ host: 'canvas' }).props().maxLength),
    );

    /*
     * The accessible name comes from the maker's label for this field, not from
     * the .resx — the resource string cannot know what the field is called on
     * this form, so it is the fallback rather than the default.
     */
    check("passes down the form's own label", plain.props().label === 'Account name');

    check('and a fallback for a form that gives none', plain.props().fallbackLabel === 'resx:__CONTROL___Name');

    // The edit path: the component reports a change, the control notifies, and
    // what it hands back is what the platform writes to the column.
    const edited = mount({});

    edited.props().onChange('Fabrikam');

    check('an edit notifies the platform exactly once', edited.notifications() === 1);

    check(
        'and getOutputs hands back what was typed',
        edited.outputs().value === 'Fabrikam',
        JSON.stringify(edited.outputs()),
    );
} else {
    /* ------------------------------------------------ a standard control */

    check(
        'renders an input inside the field surface',
        Boolean(plain.find('.__CONTROL__-field')) && Boolean(plain.find('input')),
    );

    check(
        'shows the value the platform supplied',
        plain.find('input') && plain.find('input').value === 'Contoso Ltd',
        plain.find('input') && plain.find('input').value,
    );

    /*
     * The accessible name comes from the maker's label for this field, not from
     * the .resx — the resource string cannot know what the field is called on
     * this form, so it is the fallback rather than the default.
     */
    check(
        "the input's accessible name is the form's own label",
        plain.find('input') && plain.find('input').getAttribute('aria-label') === 'Account name',
        plain.find('input') && plain.find('input').getAttribute('aria-label'),
    );

    check(
        'and falls back to the .resx when the form gives no label',
        mount({ label: '' }).find('input').getAttribute('aria-label') === 'resx:__CONTROL___Name',
    );

    /*
     * The information bug. A user denied read access gets `raw === null`, which
     * is indistinguishable from an empty column unless `security.readable` is
     * checked — so an unchecked control renders "no value" where the truth is
     * "not allowed to see it".
     */
    const denied = mount({ security: 'no-access', value: null });

    check(
        'a column the user cannot read says so rather than rendering as empty',
        denied.find('.__CONTROL__-message')
            && denied.find('.__CONTROL__-message').textContent === 'resx:__CONTROL___NoAccess',
        denied.find('.__CONTROL__-message') && denied.find('.__CONTROL__-message').textContent,
    );

    check(
        'and hides the field surface rather than leaving an empty box above the message',
        denied.find('.__CONTROL__-field') && denied.find('.__CONTROL__-field').hidden === true,
    );

    /*
     * Two independent reasons to be read-only, and conflating them is a real
     * bug: the form's `isControlDisabled` and the column's `security.editable`.
     */
    check(
        'a read-only column disables the input on an editable form',
        mount({ security: 'read-only' }).find('input').disabled === true,
    );

    check(
        'and the disabled state reaches the surface, not just the input',
        mount({ security: 'read-only' }).container.classList.contains('__CONTROL__--disabled'),
    );

    /*
     * The platform's own validation. A failing business rule is silent inside a
     * code component unless the control gives it somewhere to go.
     */
    const invalid = mount({ error: true });

    check(
        'a validation error is shown to the user',
        invalid.find('.__CONTROL__-message')
            && invalid.find('.__CONTROL__-message').textContent === host.DEFAULTS.errorMessage,
        invalid.find('.__CONTROL__-message') && invalid.find('.__CONTROL__-message').textContent,
    );

    check(
        'and is announced rather than only coloured',
        invalid.find('input') && invalid.find('input').getAttribute('aria-invalid') === 'true',
    );

    /*
     * The canvas/model-driven split, which is what every `?.` in the control is
     * about. A canvas app publishes no column metadata and no theme.
     */
    const canvas = mount({ host: 'canvas' });

    check('renders on a host that publishes no column metadata', Boolean(canvas.find('input')));

    check(
        'does not invent a maxLength the host never supplied',
        canvas.find('input') && !canvas.find('input').maxLength,
        canvas.find('input') && String(canvas.find('input').maxLength),
    );

    check(
        'takes no position on the theme when the host publishes none',
        !canvas.container.classList.contains('__CONTROL__--dark'),
        canvas.container.className,
    );

    check(
        'and follows the host theme where there is one',
        mount({ host: 'model-driven', dark: true }).container.classList.contains('__CONTROL__--dark'),
    );

    /*
     * The edit path, end to end: the user types, the control notifies, and what
     * it hands back is what the platform will write to the column.
     */
    const edited = mount({});
    const input = edited.find('input');

    input.value = 'Fabrikam';
    input.dispatchEvent({ type: 'input', target: input });

    check('typing notifies the platform exactly once', edited.notifications() === 1, String(edited.notifications()));

    check(
        'and getOutputs hands back what was typed',
        edited.outputs().value === 'Fabrikam',
        JSON.stringify(edited.outputs()),
    );

    /*
     * `updateView` runs on every change to any bound value, including ones this
     * control caused itself — so a control that writes the input unconditionally
     * moves the caret to the end of the field on every keystroke. The guard is
     * invisible in a rendered form and visible here: a render that changes
     * nothing must not touch the value the user is holding.
     */
    const typing = mount({});
    const held = typing.find('input');

    held.value = 'Half-typed';
    typing.update({});

    check(
        'a re-render with an unchanged value leaves what the user is typing alone',
        held.value === 'Half-typed',
        held.value,
    );
}

/* ------------------------------------------------------------ either shape */

/*
 * **`null` is not `undefined`, and this is the assertion worth keeping when the
 * rest of the example goes.**
 *
 * The generated `IOutputs` types every bound value as optional, so
 * `this.value ?? undefined` type-checks cleanly and means the opposite of what
 * a clear needs: `undefined` is "no change". A canvas app honours that strictly
 * and the field simply refuses to empty, while a model-driven form is more
 * forgiving — so the bug hides on the host most people test first.
 * `pcf-star-rating` shipped exactly this and its clear button did nothing.
 */
const cleared = mount({ value: null });

check(
    'a cleared column produces an output the platform can act on, not "no change"',
    cleared.outputs().value !== undefined,
    `getOutputs() returned ${JSON.stringify(cleared.outputs())}`,
);

/*
 * The resize contract, which is a pair and fails silently when half of it is
 * missing.
 *
 * `mode.allocatedWidth` is `-1` until the control calls
 * `mode.trackContainerResize(true)`, so a control that reflows on width without
 * asking lays out against -1 on every host and always picks its narrowest
 * branch. The scaffolded control reflows on neither, so all this can honestly
 * assert is that a narrow phone-sized container does not break it; the detail
 * line reports whether the control asked, which is the interesting half.
 *
 * **The moment your control reads `allocatedWidth` or `getFormFactor`, replace
 * this with the pair** — that it called `trackContainerResize(true)`, and that
 * it lays out differently at 320 than at 1200. `getFormFactor` is 0 unknown,
 * 1 desktop, 2 tablet, 3 phone: web is 1, and 3 is a phone, which is the
 * comparison people get backwards.
 */
const sized = mount({ width: 320, formFactor: 'phone' });

check(
    'renders in a phone-sized container',
    sized.element !== undefined ? sized.element !== null : Boolean(sized.find('input')),
    `trackContainerResize: ${sized.calls().some((call) => call.indexOf('trackContainerResize') === 0) ? 'called' : 'never called'}`,
);

/*
 * Hidden is a state, not an absence. Canvas relies on `mode.isVisible` — a
 * model-driven form hides the section itself — and a control that ignores it
 * stays on screen in a canvas app that asked for it to go.
 */
check(
    'renders nothing visible when the host says it is hidden',
    (() => {
        const hidden = mount({ visible: false });

        return hidden.element !== undefined
            ? hidden.props().visible === false
            : hidden.container.classList.contains('__CONTROL__--hidden');
    })(),
);

/* ---------------------------------------------------- what destroy owes */

/*
 * **Keep this when the worked example above goes.** It is written against no
 * particular control and needs no knowledge of what yours takes.
 *
 * `destroy` is the lifecycle method with nothing visible riding on it, so it is
 * the one that quietly does nothing. A control that takes an interval, a
 * `requestAnimationFrame` loop, or a listener on `document` or `window` owes
 * each of them back — and none of the three shows up on a form. The interval
 * keeps firing against a container the platform has already thrown away; the
 * document listener keeps the whole control reachable, so nothing about it is
 * ever collected. On a form somebody leaves open all afternoon, or a subgrid
 * that re-renders its rows, they accumulate.
 *
 * Counting before and after is the whole trick. The scaffolded control takes
 * neither, so both numbers are zero and this passes trivially — which is the
 * point: it starts passing for a real reason the moment somebody adds a timer,
 * and fails the moment they forget the other half.
 */
disposeAll();

const timersBefore = time.pending();
const listenersBefore = Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0);

const disposable = mount({});

disposable.destroy();

check(
    'destroy() releases every timer the control took',
    time.pending() === timersBefore,
    `${timersBefore} → ${time.pending()}`,
);

check(
    'and every document-level listener',
    Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0) === listenersBefore,
    `${listenersBefore} → ${Object.values(dom.document.listeners).reduce((total, list) => total + list.length, 0)}`,
);

/*
 * The other half, and the leak this shape is famous for. `updateView` runs on
 * every change to any bound value, so a `setInterval` reached from the render
 * path adds a timer per render rather than replacing one.
 */
const rerendered = mount({});
const afterFirst = time.pending();

rerendered.update({});
rerendered.update({});
rerendered.update({});

check(
    'and re-rendering does not add another one',
    time.pending() === afterFirst,
    `${afterFirst} → ${time.pending()}`,
);

disposeAll();

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
            : `\n  ${results.length} passed — the control's own decisions only; see SPEC.md for what a real form still has to confirm\n`,
    );

    process.exit(failed.length > 0 ? 1 : 0);
}

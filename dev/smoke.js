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
 * **If the bundle will not load here at all**, because it carries a browser
 * application that reads `document` at module scope — a Monaco, a map, a
 * charting library — do not grow `dom.js` to meet it. Keep the control's
 * decisions in modules that import nothing of the library, and drive those
 * instead, through `dev/modules.js`: it transpiles them with the TypeScript
 * already in devDependencies and refuses one that imports the library
 * (`pcf-code-editor` is the worked example). The skill has the shape under
 * *When the bundle cannot load in Node*.
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
const fixture = require('./fixture.js');

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
/*
 * **A stand-in component per name, not the name as the element type.** React
 * lower-cases an unknown element, so `MenuItem` became `<menuitem>` — which
 * HTML treats as a void element, and `renderToStaticMarkup` throws rather
 * than give it children. Every capitalised export is therefore a function
 * component rendering a `<div data-fluent="Name">` with the string, number
 * and boolean props the control passed — className, aria-*, title, disabled
 * — so `renderDeep` can look for them; a lower-case export (`webLightTheme`,
 * `tokens`) is a plain object. Found by `pcf-calendar-view`, whose move menu
 * was the first `MenuItem` a suite tried to render.
 */
const standIns = new Map();

function fluentStandIn(name) {
    if (!standIns.has(name)) {
        const StandIn = (props) => {
            const passed = { 'data-fluent': name };

            Object.keys(props || {}).forEach((key) => {
                const value = props[key];

                if (key !== 'children' && ['string', 'number', 'boolean'].includes(typeof value)) {
                    passed[key] = value;
                }
            });

            return React.createElement('div', passed, props.children);
        };

        StandIn.displayName = name;
        standIns.set(name, StandIn);
    }

    return standIns.get(name);
}

const fluent = new Proxy({}, {
    get: (_target, name) => {
        if (typeof name !== 'string') {
            return undefined;
        }

        return /^[A-Z]/.test(name) ? fluentStandIn(name) : {};
    },
});

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

/*
 * The bound column every mount starts from, before its own options: its type
 * and value, and the type group the manifest declares. Empty is the rig's
 * default text column. `setup.mjs --bind` rewrites this line, so a number or a
 * yes/no control is mounted on its own kind of column throughout — the
 * teardown checks below included — rather than handed "Contoso Ltd".
 */
const COLUMN = {};

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
    /*
     * What is the *instance's* rather than the render's: the call log, the
     * organisation URL and the rows behind the Web API. `createContext` runs
     * per render, so these are decided once here and handed to every context
     * this mount builds — `update()` included, which used to drop `calls` and
     * so could not record what a re-render made the control do.
     */
    const site = { calls: [], clientUrl: options.clientUrl || host.nextClientUrl(), fixture: options.fixture || fixture };
    // `getString` first, so a single assertion can override it — the marked key
    // proves a string came from the .resx, but it cannot prove a `{0}` was
    // substituted, because a marked key has no `{0}` in it to substitute.
    const context = host.createContext({ getString: marked, ...COLUMN, ...options, ...site });
    const instance = new registration.ctor();

    let notifications = 0;

    /*
     * The third argument is the state a previous mount handed to
     * `mode.setControlState`, and it was hard-coded to `{}` here — which made
     * the *return* half of that API unreachable from a suite. Pass `state` in
     * `options` to mount a control the way the platform remounts one after a
     * form tab switch. `{}` remains the default, because that is a first mount.
     */
    instance.init(context, () => {
        notifications += 1;
    }, options.state || {}, container);

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
        /** Every platform call the control made, on any pass. */
        calls: () => site.calls,
        /** The organisation URL this instance's `page.getClientUrl()` answers. */
        clientUrl: site.clientUrl,
        /** Re-render in a new state, as the platform does on every change. */
        update: (next) => instance.updateView(host.createContext({ getString: marked, ...COLUMN, ...options, ...site, ...next })),
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
     * A column with no profile arrives as an *object* with `secured: false` on
     * a real form (measured 2026-09-13), and `undefined` on other hosts. A read
     * of `security.readable` as a boolean is right on both — and wrong on the
     * third shape, an unmapped optional bound property's `{}`. Only an
     * explicit `false` is a denial.
     */
    check(
        'an unsecured column reported as an object, not undefined, is readable and editable',
        mount({ security: 'unsecured' }).props().readable === true
            && mount({ security: 'unsecured' }).props().disabled === false,
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

    /*
     * The platform echoes writes back late and **out of order** — typing "pase
     * laur" on a real form produced passes carrying "pase laur", "pase lau",
     * "pase laur". A control that adopts any value differing from the last one
     * the platform sent hands the late echo down as a new prop, the
     * component's resync effect puts it in the box, and the last character
     * typed is gone.
     */
    const echoed = mount({ value: '' });

    echoed.props().onChange('ab');
    echoed.props().onChange('abc');
    echoed.update({ value: 'abc' });
    echoed.update({ value: 'ab' });

    check(
        'a late echo of an earlier keystroke is not handed down as a new value',
        echoed.update({ value: 'ab' }).props.value === 'abc',
        JSON.stringify(echoed.update({ value: 'ab' }).props.value),
    );

    check(
        'but a value the control never wrote is taken from the form',
        echoed.update({ value: 'Changed by a script' }).props.value === 'Changed by a script',
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

    // The same three shapes — see the virtual half above.
    check(
        'an unsecured column reported as an object, not undefined, renders the field enabled',
        mount({ security: 'unsecured' }).find('.__CONTROL__-field').hidden === false
            && mount({ security: 'unsecured' }).find('input').disabled === false,
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
    const edited = mount({ value: null });
    const input = edited.find('input');

    // `dom.user` types the way a person does — beforeinput, the edit at the
    // cursor, input — rather than assigning `value` and firing a bare event,
    // which is a sequence no browser produces. See `dev/dom.js`.
    dom.user.type(input, 'Fabrikam');

    check(
        'typing notifies the platform once per keystroke',
        edited.notifications() === 'Fabrikam'.length,
        String(edited.notifications()),
    );

    check(
        'and getOutputs hands back what was typed',
        edited.outputs().value === 'Fabrikam',
        JSON.stringify(edited.outputs()),
    );

    /*
     * `updateView` runs on every change to any bound value, including ones this
     * control caused itself — and the platform's echoes of those changes arrive
     * late and **out of order** (typing "pase laur" on a real form produced
     * passes carrying "pase laur", "pase lau", "pase laur"). A browser moves the
     * caret to the end whenever `value` is assigned something *different* from
     * what the box holds, so a control that takes a late echo loses the
     * characters typed after it and throws the user to the end of the field.
     *
     * Typed in the middle on purpose: at the end of the field a caret jump is
     * invisible, which is how this passes a suite that only ever appends.
     */
    const typing = mount({ value: 'Contoso' });
    const held = typing.find('input');

    held.setSelectionRange(3, 3);
    dom.user.type(held, 'xyz');

    // Every echo of what was typed — the earliest one last, as measured.
    typing.update({ value: 'Conxyztoso' });
    typing.update({ value: 'Conxytoso' });
    typing.update({ value: 'Conxtoso' });

    check(
        'a late echo of an earlier keystroke does not undo what was typed after it',
        held.value === 'Conxyztoso',
        held.value,
    );

    check(
        'and leaves the caret where the user was typing',
        held.selectionStart === 6 && held.selectionEnd === 6,
        `${held.selectionStart}–${held.selectionEnd}`,
    );

    check(
        'and getOutputs still hands back the latest value, not the echo',
        typing.outputs().value === 'Conxyztoso',
        JSON.stringify(typing.outputs()),
    );

    /*
     * PCFHub's demo never writes a control's output back, and re-renders — on
     * a width change, a theme toggle, a locale — with the preset's value as it
     * always was (measured on pcf-input-mask's demo, 2026-09-28). A host saying
     * again what it said last time is not news, or every such re-render wipes
     * what the visitor typed.
     */
    const demo = mount({ value: 'Contoso' });
    const demoInput = demo.find('input');

    demoInput.setSelectionRange(7, 7);
    dom.user.type(demoInput, ' Ltd');
    demo.update({ value: 'Contoso', dark: true });

    check(
        'a host repeating its last value does not undo the edit — the hub demo re-renders that way',
        demoInput.value === 'Contoso Ltd' && demo.outputs().value === 'Contoso Ltd',
        demoInput.value,
    );

    /*
     * The other half of the guard: a value the control never wrote is the
     * form's — a script, a business rule, a refresh — and must win, or the
     * control shows a value the column no longer holds.
     */
    typing.update({ value: 'Changed by a script' });

    check(
        'a value the control never wrote is taken from the form',
        held.value === 'Changed by a script',
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

/* ======================================================================== *
 *  THE RIG'S OWN CLAIMS — keep these. They are about `dev/host.js`, not about
 *  the control, and they exist because a rig that silently answers the wrong
 *  host's question certifies whatever it is handed. Each one was a real bug in
 *  a sibling repository's rig before it was an assertion here.
 * ======================================================================== */

/*
 * The table-definition reads, in the shapes a form gave them
 * (pcf-code-editor SPEC.md, the 1.4.9 probe, 2026-10-01). A control that
 * completes or validates names leans on each of these; the rig is proven
 * here before any control relies on it.
 */
async function metadataSelfCheck() {
    const ctx = host.createContext({ fixture, clientUrl: host.nextClientUrl() });
    const api = `${ctx.page.getClientUrl()}/api/data/v9.2/`;
    const get = async (path, context = ctx) => {
        const r = await fetch(`${context.page.getClientUrl()}/api/data/v9.2/${path}`);
        return { status: r.status, body: await r.json() };
    };

    const list = await get("EntityDefinitions?$select=LogicalName,DisplayName,PrimaryIdAttribute,IsIntersect&$filter=IsPrivate eq false&LabelLanguages=1033");
    const names = list.body.value.map((t) => t.LogicalName);
    check(
        'rig: the table list is every non-private table, sorted, with only what $select named beside MetadataId',
        list.status === 200 && names.join(',') === 'account,cll_account_tag,cll_tag,contact'
            && list.body.value.every((t) => typeof t.MetadataId === 'string' && t.EntitySetName === undefined),
        names.join(','),
    );
    const account = list.body.value.find((t) => t.LogicalName === 'account');
    const intersect = list.body.value.find((t) => t.LogicalName === 'cll_account_tag');
    check(
        "rig: LabelLanguages narrows a Label to that language; a table with no label has UserLocalizedLabel null (1.4.9 P5)",
        account.DisplayName.UserLocalizedLabel.Label === 'Account' && account.DisplayName.LocalizedLabels.length === 1
            && intersect.DisplayName.UserLocalizedLabel === null && intersect.IsIntersect === true,
    );
    const everyLanguage = await get('EntityDefinitions?$select=LogicalName,DisplayName&$filter=IsPrivate eq false');
    check('rig: …and without it every language comes back', everyLanguage.body.value.find((t) => t.LogicalName === 'account').DisplayName.LocalizedLabels.length === 2);
    const spanish = host.createContext({ fixture, clientUrl: host.nextClientUrl(), languageId: 3082 });
    const inSpanish = await get('EntityDefinitions?$select=LogicalName,DisplayName&$filter=IsPrivate eq false', spanish);
    check(
        "rig: UserLocalizedLabel is the user's language (languageId), and missing where the table has no label in it",
        spanish.userSettings.languageId === 3082
            && inSpanish.body.value.find((t) => t.LogicalName === 'account').DisplayName.UserLocalizedLabel.Label === 'Cuenta'
            && inSpanish.body.value.find((t) => t.LogicalName === 'contact').DisplayName.UserLocalizedLabel === null,
    );
    const advanced = await get('EntityDefinitions?$select=LogicalName&$filter=IsValidForAdvancedFind eq true');
    check('rig: the Advanced Find list leaves the intersect table out (1.4.9 P1: 0 of 689)', !advanced.body.value.some((t) => t.LogicalName === 'cll_account_tag'), advanced.body.value.map((t) => t.LogicalName).join(','));

    const columns = await get("EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName,AttributeType,AttributeTypeName,DisplayName,IsValidForRead,AttributeOf,IsLogical&LabelLanguages=1033");
    const column = (name) => columns.body.value.find((c) => c.LogicalName === name);
    check(
        'rig: a shadow column has AttributeOf, IsLogical and no label; one not valid for read says so; a multi-select is Virtual underneath (1.4.9 P2)',
        column('primarycontactidname').AttributeOf === 'primarycontactid' && column('primarycontactidname').IsLogical === true
            && column('primarycontactidname').DisplayName.UserLocalizedLabel === null
            && column('isprivate').IsValidForRead === false
            && column('cll_classification').AttributeType === 'Virtual' && column('cll_classification').AttributeTypeName.Value === 'MultiSelectPicklistType'
            && column('name').IsValidForUpdate === undefined,
    );

    const relationships = await get("EntityDefinitions(LogicalName='account')?$select=LogicalName,PrimaryIdAttribute&$expand=ManyToOneRelationships($select=SchemaName,ReferencedEntity,ReferencedAttribute,ReferencingAttribute),OneToManyRelationships($select=SchemaName,ReferencingEntity,ReferencingAttribute),ManyToManyRelationships($select=SchemaName,Entity1LogicalName,Entity2LogicalName,IntersectEntityName,Entity1IntersectAttribute,Entity2IntersectAttribute)");
    const m2o = relationships.body.ManyToOneRelationships.find((r) => r.ReferencingAttribute === 'primarycontactid');
    check(
        'rig: the three relationship kinds answer in one $expand, each narrowed by its own $select (1.4.9 P3)',
        relationships.status === 200 && relationships.body.PrimaryIdAttribute === 'accountid' && relationships.body.EntitySetName === undefined && m2o.ReferencedEntity === 'contact' && m2o.ReferencedAttribute === 'contactid' && m2o.ReferencingEntityNavigationPropertyName === undefined
            && relationships.body.OneToManyRelationships.some((r) => r.ReferencingAttribute === 'parentaccountid')
            && relationships.body.ManyToManyRelationships[0].IntersectEntityName === 'cll_account_tag',
    );
    const m2m = await get("EntityDefinitions(LogicalName='cll_tag')/ManyToManyRelationships");
    check('rig: …and many-to-many alone lists the relationship from either side', m2m.status === 200 && m2m.body.value[0].Entity1LogicalName === 'account');

    const cast = (columnName, type, inner = '$select=Options') => get(`EntityDefinitions(LogicalName='account')/Attributes(LogicalName='${columnName}')/Microsoft.Dynamics.CRM.${type}AttributeMetadata?$select=LogicalName&$expand=OptionSet(${inner}),GlobalOptionSet(${inner})&LabelLanguages=1033`);
    const industry = await cast('industrycode', 'Picklist');
    const state = await cast('statecode', 'State');
    const status = await cast('statuscode', 'Status');
    const yesNo = await cast('donotemail', 'Boolean', '$select=TrueOption,FalseOption');
    const multi = await cast('cll_classification', 'MultiSelectPicklist');
    check(
        "rig: a choice's options come through its cast, in the measured keys; State and Status options carry more (1.4.9 P4)",
        industry.body.OptionSet.Options.length === 3 && industry.body.GlobalOptionSet === null
            && Object.keys(industry.body.OptionSet.Options[0]).sort().join() === 'Color,Description,ExternalValue,HasChanged,IsHidden,IsManaged,Label,MetadataId,ParentValues,Tag,Value'
            && industry.body.OptionSet.Options[0].Label.UserLocalizedLabel.Label === 'Accounting'
            && state.body.OptionSet.Options[0].DefaultStatus === 1 && status.body.OptionSet.Options[1].State === 1
            && yesNo.body.OptionSet.TrueOption.Value === 1 && yesNo.body.OptionSet.FalseOption.Label.UserLocalizedLabel.Label === 'Allow'
            && multi.body.OptionSet.Options.length === 3,
    );
    const wrongCast = await cast('statecode', 'Picklist');
    check("rig: a cast that is not the column's kind is refused (unmeasured on a form)", wrongCast.status === 404);

    const refused = host.createContext({ fixture, clientUrl: host.nextClientUrl(), metadataStatus: 403 });
    const offline = host.createContext({ fixture, clientUrl: host.nextClientUrl(), metadataStatus: 0 });
    const refusal = await get('EntityDefinitions?$select=LogicalName&$filter=IsPrivate eq false', refused);
    let fault = null;
    await fetch(`${offline.page.getClientUrl()}/api/data/v9.2/EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName`).catch((e) => { fault = e; });
    check('rig: metadataStatus 403 refuses with an error body, 0 rejects with a TypeError', refusal.status === 403 && refusal.body.error && fault instanceof TypeError);
    check('rig: a canvas host has no context.page, so nothing can address the table definitions', host.createContext({ fixture, host: 'canvas' }).page === undefined && api.startsWith('https://'));
}

/*
 * A File or Image column through the Web API — `GET …/$value`, `PATCH`,
 * `DELETE` — the route Learn documents for a column no manifest can bind.
 * Measured on a form by pcf-file-preview's probe (2026-10-02); `fileAnswer`
 * in `dev/host.js` says which parts are still Learn's.
 */
const dispositionName = (header) => {
    const word = /filename="=\?utf-8\?B\?([^?]*)\?="/i.exec(header || '');

    return word ? Buffer.from(word[1], 'base64').toString('utf8') : (/filename=([^;]+)/.exec(header || '') || [])[1];
};

async function fileColumnSelfCheck() {
    const ctx = host.createContext({ fixture, clientUrl: host.nextClientUrl() });
    const base = `${ctx.page.getClientUrl()}/api/data/v9.2/`;
    const call = (path, init, context = ctx) => fetch(`${context.page.getClientUrl()}/api/data/v9.2/${path}`, init);

    const pdf = await call('accounts(c1)/cll_filenative/$value');
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    const pdfBlob = await (await call('accounts(c1)/cll_filenative/$value')).blob();
    check(
        'rig: a File column downloads its bytes with x-ms-file-size, mimetype and its name — and an untyped blob, which a control types from mimetype',
        pdf.status === 200 && pdf.headers.get('mimetype') === 'application/pdf'
            && Number(pdf.headers.get('x-ms-file-size')) === pdfBytes.byteLength && String.fromCharCode(...pdfBytes.slice(0, 5)) === '%PDF-'
            && pdfBlob.type === 'application/octet-stream' && pdfBlob.size === pdfBytes.byteLength,
        `${pdf.status} ${pdf.headers.get('mimetype')} ${pdfBlob.type}`,
    );
    check(
        'rig: a name outside ASCII is mangled in x-ms-file-name and right in Content-Disposition, as measured; an ASCII one is bare in both',
        dispositionName(pdf.headers.get('content-disposition')) === 'Contoso DE — Rahmenvertrag 2026.pdf'
            // "—" as the probe saw it: Ã¢â¬â plus three invisible C1 controls.
            && pdf.headers.get('x-ms-file-name') === 'Contoso DE Ã¢â\u0082¬â\u0080\u009d Rahmenvertrag 2026.pdf',
        `${pdf.headers.get('x-ms-file-name')} | ${pdf.headers.get('content-disposition')}`,
    );

    const empty = await call('accounts(k1)/cll_filenative/$value');
    const emptyImage = await call('accounts(k1)/cll_photo/$value');
    const emptyFull = await call('accounts(k1)/cll_photo/$value?size=full');
    const nobody = await call('accounts(nosuch)/cll_filenative/$value');
    const notFile = await call('accounts(c1)/name/$value').then(() => 'answered', (e) => e.message);
    check(
        "rig: an empty File column is 404 0x80040217 and an empty Image column 204 to both requests (measured), a record that is not there 404, and a column that is not a file the stub's refusal",
        empty.status === 404 && (await empty.json()).error.code === '0x80040217' && emptyImage.status === 204 && emptyFull.status === 204
            && nobody.status === 404 && /No fetch for/.test(notFile),
        `${empty.status} ${emptyImage.status} ${emptyFull.status} ${nobody.status} ${notFile}`,
    );

    const thumb = await call('accounts(c1)/cll_photo/$value');
    const full = await call('accounts(c1)/cll_photo/$value?size=full');
    const noFull = await call('accounts(c1)/entityimage/$value?size=full');
    check(
        'rig: an Image column answers its thumbnail by default and the full copy with ?size=full — 204 where it keeps none',
        thumb.status === 200 && full.status === 200 && (await thumb.arrayBuffer()).byteLength < (await full.arrayBuffer()).byteLength
            && noFull.status === 204,
        `${thumb.status} ${full.status} ${noFull.status}`,
    );

    const limits = await (await call("EntityDefinitions(LogicalName='account')/Attributes(LogicalName='cll_photo')/Microsoft.Dynamics.CRM.ImageAttributeMetadata?$select=MaxSizeInKB,CanStoreFullImage")).json();
    const fileLimit = await (await call("EntityDefinitions(LogicalName='account')/Attributes(LogicalName='cll_filenative')/Microsoft.Dynamics.CRM.FileAttributeMetadata?$select=MaxSizeInKB")).json();
    const org = await ctx.webAPI.retrieveMultipleRecords('organization', '?$select=blockedattachments');
    const fetchedOrg = await (await call('organizations?$select=blockedattachments')).json();
    check(
        "rig: MaxSizeInKB and CanStoreFullImage come through the column's cast, and blockedattachments off the organisation row — queried or fetched",
        limits.MaxSizeInKB === 10240 && limits.CanStoreFullImage === true && fileLimit.MaxSizeInKB === 32768 && fileLimit.CanStoreFullImage === undefined
            && /(^|;)exe(;|$)/.test(org.entities[0].blockedattachments) && fetchedOrg.value[0].blockedattachments === org.entities[0].blockedattachments,
        JSON.stringify([limits, fileLimit]),
    );

    // The round trip, and the name in the query when it is not ASCII.
    const upload = new Blob(['Neue Fassung'], { type: 'text/plain' });
    const put = await call('accounts(k1)/cll_filenative', { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream', 'x-ms-file-name': 'v2.txt' }, body: upload });
    const after = await call('accounts(k1)/cll_filenative/$value');
    const nonAscii = await call(`accounts(k2)/cll_filenative?x-ms-file-name=${encodeURIComponent('Übersicht.txt')}`, { method: 'PATCH', body: 'ü' });
    const named = await call('accounts(k2)/cll_filenative/$value');
    const inHeader = await call('accounts(k2)/cll_filenative', { method: 'PATCH', headers: { 'x-ms-file-name': 'Отчёт.txt' }, body: 'x' }).then(() => 'sent', (e) => e);
    check(
        'rig: a PATCH answers 204 and the next GET has the new bytes and name; a non-ASCII name goes in the query, because a header holding one never leaves the browser',
        put.status === 204 && after.status === 200 && (await after.text()) === 'Neue Fassung' && after.headers.get('x-ms-file-name') === 'v2.txt'
            && after.headers.get('content-disposition') === 'inline; filename=v2.txt'
            && after.headers.get('mimetype') === 'text/plain' && nonAscii.status === 204
            && dispositionName(named.headers.get('content-disposition')) === 'Übersicht.txt' && inHeader instanceof TypeError,
        `${put.status} ${after.status} ${nonAscii.status} ${inHeader}`,
    );

    const big = await call('accounts(k1)/cll_photo', { method: 'PATCH', headers: { 'x-ms-file-name': 'huge.png' }, body: new Uint8Array(10240 * 1024 + 1) });
    const blocked = await call('accounts(k1)/cll_filenative', { method: 'PATCH', headers: { 'x-ms-file-name': 'setup.EXE' }, body: 'MZ' });
    const unnamed = await call('accounts(k1)/cll_filenative', { method: 'PATCH', body: 'x' });
    const notImage = await call('accounts(k1)/cll_photo', { method: 'PATCH', headers: { 'x-ms-file-name': 'notes.txt' }, body: 'text' });
    const denied = host.createContext({ fixture, clientUrl: host.nextClientUrl(), fileWrite: false });
    const deniedPut = await call('accounts(k1)/cll_filenative', { method: 'PATCH', headers: { 'x-ms-file-name': 'a.txt' }, body: 'x' }, denied);
    const deniedRead = await call('accounts(c1)/cll_filenative/$value', undefined, denied);
    check(
        "rig: a PATCH over MaxSizeInKB is 0x80044a02, a blocked extension is refused whatever its case, a nameless one 400, a non-image into an Image column 400, and without Write it is 403 while the read still answers",
        big.status === 400 && (await big.json()).error.code === '0x80044a02' && blocked.status === 400 && unnamed.status === 400 && notImage.status === 400
            && deniedPut.status === 403 && deniedRead.status === 200,
        [big.status, blocked.status, unnamed.status, deniedPut.status, deniedRead.status].join(' '),
    );

    const removed = await call('accounts(c1)/cll_filenative', { method: 'DELETE' });
    const gone = await call('accounts(c1)/cll_filenative/$value');
    const again = await call('accounts(c1)/cll_filenative', { method: 'DELETE' });
    const elsewhere = host.createContext({ fixture, clientUrl: host.nextClientUrl() });
    const untouched = await call('accounts(c1)/cll_filenative/$value', undefined, elsewhere);
    check(
        "rig: a DELETE answers 204 and empties the column; a second one finds nothing; another host's copy still has the file",
        removed.status === 204 && gone.status === 404 && again.status === 404 && untouched.status === 200 && fixture.files['account|c1|cll_filenative'] !== undefined,
        [removed.status, gone.status, again.status, untouched.status].join(' '),
    );

    const offline = host.createContext({ fixture, clientUrl: host.nextClientUrl(), filesStatus: 0 });
    const refusing = host.createContext({ fixture, clientUrl: host.nextClientUrl(), filesStatus: 503 });
    let fault = null;
    await call('accounts(c1)/cll_filenative/$value', undefined, offline).catch((e) => { fault = e; });
    const unavailable = await call('accounts(c1)/cll_filenative/$value', undefined, refusing);
    const calls = [];
    const logged = host.createContext({ fixture, clientUrl: host.nextClientUrl(), calls });
    await call('accounts(c1)/cll_filenative/$value', undefined, logged);
    await call('accounts(k1)/cll_filenative', { method: 'DELETE' }, logged);
    const opened = [];
    const opener = host.createContext({ fixture, clientUrl: host.nextClientUrl(), calls: opened });
    await opener.navigation.openFile({ fileName: 'a.pdf', fileSize: 1, mimeType: 'application/pdf', fileContent: 'JVBERg==' }, { openMode: 2 });
    let canvasThrew = false;
    try {
        host.createContext({ fixture, host: 'canvas' }).navigation.openFile({ fileName: 'a.pdf' }, { openMode: 2 });
    } catch (e) {
        canvasThrew = true;
    }
    check(
        'rig: navigation.openFile logs what describes the file, not its content; canvas publishes it and throws; openFile: false leaves it out',
        opened.join() === 'navigation.openFile({"fileName":"a.pdf","fileSize":1,"mimeType":"application/pdf","openMode":2})'
            && canvasThrew && host.createContext({ fixture, openFile: false }).navigation.openFile === undefined,
        opened.join(),
    );

    check(
        'rig: filesStatus 0 rejects with a TypeError, another number refuses; the log carries the verb of anything but a GET',
        fault instanceof TypeError && unavailable.status === 503 && base.startsWith('https://')
            && calls.join() === 'fetch("/api/data/v9.2/accounts(c1)/cll_filenative/$value"),fetch("DELETE /api/data/v9.2/accounts(k1)/cll_filenative")',
        calls.join(),
    );
}

async function rigSelfCheck() {
    const relationships = (url) => `${url}/api/data/v9.2/EntityDefinitions(LogicalName='account')/OneToManyRelationships`;

    /*
     * Two hosts, two answers. The fetch stub is one global routed by origin,
     * and before it was, the stub belonged to whichever host a suite created
     * last — so a second mount's refusal became every mount's refusal.
     */
    const open = mount({});
    const refused = mount({ relationshipsStatus: 403 });
    const [a, b] = await Promise.all([fetch(relationships(open.clientUrl)), fetch(relationships(refused.clientUrl))]);

    check('rig: each host answers its own metadata fetch', a.status === 200 && b.status === 403, `${a.status} / ${b.status}`);
    check(
        "rig: a fresh host does not inherit an earlier host's answers",
        (await a.json()).value.some((row) => row.ReferencingAttribute === 'parentaccountid' && row.IsHierarchical === true),
    );

    let foreign = 'resolved';
    await fetch('https://nowhere.invalid/api/data/v9.2/x').catch((error) => { foreign = error.constructor.name; });
    // Whatever `fetch` was there before answers — Node's own, here, which cannot
    // resolve the name — and the claim is only that the rig did not answer it.
    check("rig: a URL on no host's origin is refused, not answered", foreign !== 'resolved', foreign);

    const ctx = host.createContext({ fixture, clientUrl: host.nextClientUrl() });
    const xml = "<fetch><entity name='account'><attribute name='accountid'/><attribute name='name'/><attribute name='accountid' rowaggregate='CountChildren' alias='children'/><filter><condition attribute='accountid' operator='eq-or-above' value='c1'/></filter></entity></fetch>";
    const chain = await ctx.webAPI.retrieveMultipleRecords('account', `?fetchXml=${encodeURIComponent(xml)}`);

    check(
        'rig: eq-or-above answers the record and every ancestor, with child counts',
        chain.entities.map((row) => `${row.accountid}:${row.children}`).sort().join(',') === 'c1:2,p1:2,r1:2',
        JSON.stringify(chain.entities.map((row) => [row.accountid, row.children])),
    );

    let fault = null;
    await host.createContext({ fixture, clientUrl: host.nextClientUrl(), hierarchical: false })
        .webAPI.retrieveMultipleRecords('account', `?fetchXml=${encodeURIComponent(xml)}`)
        .catch((error) => { fault = error; });
    check(
        'rig: a hierarchical operator on a table that is not hierarchical is refused as a plain object',
        fault !== null && !(fault instanceof Error) && typeof fault.errorCode === 'number' && typeof fault.message === 'string',
        fault && fault.constructor.name,
    );

    const page = await ctx.webAPI.retrieveMultipleRecords('account', "?$select=accountid,name&$filter=_parentaccountid_value eq c1&$orderby=name asc", 1);
    check('rig: maxPageSize truncates and says there is more', page.entities.length === 1 && typeof page.nextLink === 'string', JSON.stringify(page));

    /*
     * The audit half: rows through `webAPI`, values through the two functions
     * on the fetch stub. The `nextLink` has to carry the query, because a
     * control hands it straight back — before it did, page two of a filtered
     * list answered an unfiltered one.
     */
    const auditQuery = '?$select=auditid,createdon,action,_objectid_value,_userid_value&$filter=_objectid_value eq c1&$orderby=createdon desc';
    const first = await ctx.webAPI.retrieveMultipleRecords('audit', auditQuery, 10);
    check(
        'rig: the audit table ignores maxPageSize — every row, newest first, nextLink an empty string (measured)',
        first.entities.length === 26 && first.nextLink === '' && first.entities[0].createdon > first.entities[25].createdon
            && first.entities.every((row) => row._objectid_value === 'c1'),
        `${first.entities.length} ${JSON.stringify(first.nextLink)}`,
    );
    const paged = await ctx.webAPI.retrieveMultipleRecords('account', '?$select=accountid,name&$filter=_parentaccountid_value eq r1&$orderby=name asc', 1);
    const next = await ctx.webAPI.retrieveMultipleRecords('account', paged.nextLink, 1);
    check(
        'rig: any other table pages by a nextLink that carries the filter and the order',
        paged.entities.length === 1 && next.entities.length === 1 && paged.entities[0].accountid === 'o1' && next.entities[0].accountid === 'p1',
        JSON.stringify([paged.entities, next.entities]),
    );

    const api = `${ctx.page.getClientUrl()}/api/data/v9.2`;
    const detail = await fetch(`${api}/audits(${first.entities[1].auditid})/Microsoft.Dynamics.CRM.RetrieveAuditDetails`, { headers: { Prefer: 'odata.include-annotations="*"' } }).then((r) => r.json());
    const plain = await fetch(`${api}/audits(${first.entities[1].auditid})/Microsoft.Dynamics.CRM.RetrieveAuditDetails`).then((r) => r.json());
    check(
        'rig: RetrieveAuditDetails answers by audit id with the AuditRecord — who, when, action — annotated only under Prefer',
        detail.AuditDetail['@odata.type'] === '#Microsoft.Dynamics.CRM.AttributeAuditDetail'
            && detail.AuditDetail.NewValue['_parentaccountid_value@Microsoft.Dynamics.CRM.lookuplogicalname'] === 'account'
            && detail.AuditDetail.AuditRecord.auditid === first.entities[1].auditid
            && detail.AuditDetail.AuditRecord['_userid_value@OData.Community.Display.V1.FormattedValue'] === 'Priya Raman'
            && plain.AuditDetail.AuditRecord.auditid === first.entities[1].auditid
            && plain.AuditDetail.AuditRecord['_userid_value@OData.Community.Display.V1.FormattedValue'] === undefined,
        JSON.stringify(Object.keys(detail.AuditDetail)),
    );
    const unknown = await fetch(`${api}/audits(00000000-0000-0000-0000-0000000000ff)/Microsoft.Dynamics.CRM.RetrieveAuditDetails`);
    check('rig: an audit id the fixture does not hold is a 404', unknown.status === 404, String(unknown.status));

    const target = encodeURIComponent("{'@odata.id':'accounts(c1)'}");
    const paging = encodeURIComponent(JSON.stringify({ PageNumber: 2, Count: 10, ReturnTotalRecordCount: true }));
    const history = await fetch(`${api}/RetrieveRecordChangeHistory(Target=@t,PagingInfo=@p)?@t=${target}&@p=${paging}`).then((r) => r.json());
    check(
        'rig: RetrieveRecordChangeHistory pages by @p, counts the whole history, and every detail carries its AuditRecord',
        history.AuditDetailCollection.AuditDetails.length === 10 && history.AuditDetailCollection.TotalRecordCount === 26
            && history.AuditDetailCollection.MoreRecords === true
            && history.AuditDetailCollection.AuditDetails.every((d) => typeof d.AuditRecord?.auditid === 'string')
            && history.AuditDetailCollection.AuditDetails[0].AuditRecord.auditid === first.entities[10].auditid,
        JSON.stringify([history.AuditDetailCollection.AuditDetails.length, history.AuditDetailCollection.TotalRecordCount]),
    );

    const definition = await fetch(`${api}/EntityDefinitions(LogicalName='account')?$select=IsAuditEnabled`).then((r) => r.json());
    const off = host.createContext({ fixture, clientUrl: host.nextClientUrl(), auditEnabled: { org: false, table: false }, auditStatus: 403, auditSummary: false });
    const offApi = `${off.page.getClientUrl()}/api/data/v9.2`;
    const offDefinition = await fetch(`${offApi}/EntityDefinitions(LogicalName='account')?$select=IsAuditEnabled`).then((r) => r.json());
    const offOrg = await off.webAPI.retrieveMultipleRecords('organization', '?$select=isauditenabled&$top=1');
    check(
        'rig: IsAuditEnabled is a managed property that follows the switch, on the table and the organisation',
        definition.IsAuditEnabled.Value === true && offDefinition.IsAuditEnabled.Value === false && offOrg.entities[0].isauditenabled === false,
        JSON.stringify([definition.IsAuditEnabled, offDefinition.IsAuditEnabled, offOrg.entities[0]]),
    );

    const refusedDetail = await fetch(`${offApi}/audits(${first.entities[1].auditid})/Microsoft.Dynamics.CRM.RetrieveAuditDetails`);
    let summaryFault = null;
    await off.webAPI.retrieveMultipleRecords('audit', auditQuery, 10).catch((error) => { summaryFault = error; });
    check(
        'rig: the two audit privileges refuse separately — a 403 body on the function, a plain-object fault on the query',
        refusedDetail.status === 403 && summaryFault !== null && !(summaryFault instanceof Error) && typeof summaryFault.errorCode === 'number',
        `${refusedDetail.status} / ${summaryFault && summaryFault.constructor.name}`,
    );

    let offline = 'resolved';
    const dark = host.createContext({ fixture, clientUrl: host.nextClientUrl(), auditStatus: 0 });
    await fetch(`${dark.page.getClientUrl()}/api/data/v9.2/audits(${first.entities[1].auditid})/Microsoft.Dynamics.CRM.RetrieveAuditDetails`)
        .catch((error) => { offline = error.constructor.name; });
    check('rig: auditStatus 0 is the offline shape, a TypeError', offline === 'TypeError', offline);

    /*
     * A write is applied to this host's own rows and audited, the way the
     * platform does it — so a control that writes can be shown its write on
     * the next read — and never reaches the shared fixture.
     */
    const F = '@OData.Community.Display.V1.FormattedValue';
    const writeCtx = host.createContext({ fixture, clientUrl: host.nextClientUrl() });
    const rowsBefore = (await writeCtx.webAPI.retrieveMultipleRecords('audit', auditQuery)).entities.length;
    await writeCtx.webAPI.updateRecord('account', 'c1', { name: 'Renamed', 'parentaccountid@odata.bind': '/accounts(r1)' });
    const written = await writeCtx.webAPI.retrieveRecord('account', 'c1', '?$select=name,_parentaccountid_value');
    const audited = (await writeCtx.webAPI.retrieveMultipleRecords('audit', auditQuery)).entities;
    const auditedDetail = await (await fetch(`${writeCtx.page.getClientUrl()}/api/data/v9.2/audits(${audited[0].auditid})/Microsoft.Dynamics.CRM.RetrieveAuditDetails`, { headers: { Prefer: 'odata.include-annotations="*"' } })).json();
    check(
        "rig: updateRecord applies to this host's row — a primitive under its key, a bind as the lookup with its annotations — and audits it as the newest row by the rig user",
        written.name === 'Renamed' && written._parentaccountid_value === 'r1' && written['_parentaccountid_value' + F] === 'Contoso Holdings'
            && audited.length === rowsBefore + 1 && audited[0]['_userid_value' + F] === 'Rig User' && audited[0].action === 2
            && auditedDetail.AuditDetail.OldValue.name === 'Contoso Deutschland GmbH' && auditedDetail.AuditDetail.NewValue.name === 'Renamed'
            && auditedDetail.AuditDetail.OldValue._parentaccountid_value === 'p1' && auditedDetail.AuditDetail.NewValue['_parentaccountid_value@Microsoft.Dynamics.CRM.associatednavigationproperty'] === 'parentaccountid',
        JSON.stringify([written, audited[0], auditedDetail.AuditDetail]),
    );
    check("rig: the shared fixture is untouched by a host's write, and a fresh host starts from it", fixture.tables.account.find((r) => r.accountid === 'c1').name === 'Contoso Deutschland GmbH' && !fixture.tables.audit.some((r) => r.auditid.startsWith('ffffffff'))
        && (await host.createContext({ fixture, clientUrl: host.nextClientUrl() }).webAPI.retrieveRecord('account', 'c1', '?$select=name')).name === 'Contoso Deutschland GmbH');
    let bindFault = null;
    await writeCtx.webAPI.updateRecord('account', 'c1', { 'nosuch@odata.bind': '/accounts(r1)' }).catch((e) => { bindFault = e; });
    let refFault = null;
    await writeCtx.webAPI.updateRecord('account', 'c1', { 'parentaccountid@odata.bind': '/accounts(nosuchid)' }).catch((e) => { refFault = e; });
    check('rig: an undeclared bind and a bind to a missing record refuse the way the server does', bindFault && /undeclared property 'nosuch'/.test(bindFault.message) && refFault && refFault.title === 'Record Is Unavailable', JSON.stringify([bindFault && bindFault.errorCode, refFault && refFault.errorCode]));
    let dropped = null;
    await writeCtx.webAPI.updateRecord('account', 'c1', { address1_composite: 'probe', name: 'Kept' }).then((r) => { dropped = r; });
    const afterDrop = await writeCtx.webAPI.retrieveRecord('account', 'c1', '?$select=name,address1_composite');
    check("rig: a write to a column the metadata marks not updatable resolves and changes nothing — the server's way — while the rest of the payload lands", dropped !== null && afterDrop.name === 'Kept' && afterDrop.address1_composite === undefined, JSON.stringify(afterDrop));
    const attrs = await (await fetch(`${writeCtx.page.getClientUrl()}/api/data/v9.2/EntityDefinitions(LogicalName='account')/Attributes?$select=LogicalName,AttributeType,IsValidForUpdate`)).json();
    check("rig: EntityDefinitions/Attributes lists every labelled column as updatable and the fixture's frozen ones as not", attrs.value.some((x) => x.LogicalName === 'name' && x.IsValidForUpdate === true) && attrs.value.some((x) => x.LogicalName === 'address1_composite' && x.IsValidForUpdate === false && x.AttributeType === 'Memo'), String(attrs.value.length));
    check('rig: userSettings names the user the write is audited as', writeCtx.userSettings.userName === 'Rig User' && typeof writeCtx.userSettings.userId === 'string');
    check("rig: getEntityMetadata(target).EntitySetName is the target's, from the fixture", (await writeCtx.utils.getEntityMetadata('contact')).EntitySetName === 'contacts' && (await writeCtx.utils.getEntityMetadata('account')).EntitySetName === 'accounts');

    const metadata = await ctx.utils.getEntityMetadata('account', ['name', 'revenue', 'nosuchcolumn']);
    check(
        'rig: getEntityMetadata(table, columns).Attributes is an item collection of the columns asked for that the fixture names',
        metadata.Attributes.get('name').DisplayName === 'Account Name' && metadata.Attributes.getAll().length === 2 && metadata.Attributes.get('nosuchcolumn') === undefined,
        JSON.stringify(metadata.Attributes.getAll()),
    );

    const wrUrl = host.nextClientUrl();
    const wrCtx = host.createContext({ fixture, clientUrl: wrUrl });
    const wrFound = await fetch(`${wrCtx.page.getClientUrl()}/WebResources/new_/config/settings.json`);
    const wrMissing = await fetch(`${wrCtx.page.getClientUrl()}/WebResources/new_/config/missing.json`);
    check(
        'rig: a web resource answers 200 text/jscript with its text; a missing one 404 with an empty body — as a form did',
        wrFound.status === 200 && wrFound.headers.get('content-type') === 'text/jscript' && JSON.parse(await wrFound.text()).pageSize === 25
            && wrMissing.status === 404 && (await wrMissing.text()) === '',
        [wrFound.status, wrMissing.status].join(' / '),
    );
    const wrOffline = host.createContext({ fixture, clientUrl: host.nextClientUrl(), webResourceStatus: 0 });
    let wrFault = null;
    await fetch(`${wrOffline.page.getClientUrl()}/WebResources/new_/config/settings.json`).catch((e) => { wrFault = e; });
    const wrDenied = host.createContext({ fixture, clientUrl: host.nextClientUrl(), webResourceStatus: 403 });
    const wrDeniedReply = await fetch(`${wrDenied.page.getClientUrl()}/WebResources/new_/config/settings.json`);
    check('rig: webResourceStatus 0 rejects with a TypeError (offline), 403 refuses', wrFault instanceof TypeError && wrDeniedReply.status === 403);

    await metadataSelfCheck();
    await fileColumnSelfCheck();
    typedColumnSelfCheck();

    checkModuleLoader();
    checkDomCollections();
    checkDomCursor();

    disposeAll();
}

/*
 * Number and yes/no columns, and the formatting a control reads them with.
 * Every member here is the typings' word or a measurement named in
 * `dev/host.js`; the rig proves it hands them over before a control's suite
 * rests on them — and that a text column's shape did not move.
 */
function typedColumnSelfCheck() {
    const context = (options) => host.createContext({ calls: [], clientUrl: host.nextClientUrl(), ...options });
    const value = (options) => context(options).parameters.value;
    const keys = (object) => Object.keys(object || {}).sort().join();

    const text = value({});
    check(
        "rig: a text column's value keeps its shape — MaxLength and the two names, no formatted",
        keys(text.attributes) === 'DisplayName,LogicalName,MaxLength' && !('formatted' in text),
        keys(text.attributes),
    );

    const decimal = value({ valueType: 'Decimal', value: 1234.5, minValue: 0, maxValue: 10, precision: 1 });
    const whole = value({ valueType: 'Whole.None', value: 42 });
    const fp = value({ valueType: 'FP', value: null });
    const money = value({ valueType: 'Currency', value: 1500 });
    check(
        'rig: a number column carries its range, and Precision (Decimal, FP, Currency) or Format (whole) — never both',
        decimal.attributes.MinValue === 0 && decimal.attributes.MaxValue === 10 && decimal.attributes.Precision === 1 && !('Format' in decimal.attributes)
            && whole.attributes.Format === 'None' && !('Precision' in whole.attributes)
            && 'Precision' in fp.attributes && 'Precision' in money.attributes,
    );
    check(
        'rig: …and the platform default range where nobody declared one — FP from 0, not the type limit',
        whole.attributes.MinValue === -2147483648 && whole.attributes.MaxValue === 2147483647
            && fp.attributes.MinValue === 0 && fp.attributes.MaxValue === 1000000000
            && money.attributes.MaxValue === 922337203685477,
    );
    check(
        "rig: a number column's formatted is the platform's string: grouped, to its precision, currency with its symbol; empty is undefined",
        decimal.formatted === '1,234.5' && whole.formatted === '42' && money.formatted === '$1,500.00' && fp.formatted === undefined && fp.raw === null,
        [decimal.formatted, whole.formatted, money.formatted, fp.formatted].join(' | '),
    );
    check(
        'rig: a canvas host hands a number column no attributes at all',
        value({ valueType: 'Decimal', value: 3, host: 'canvas' }).attributes === undefined,
    );

    const group = ['Whole.None', 'Decimal', 'FP', 'Currency'];
    check(
        "rig: a type group's `type` is the member, the whole group, or another member — the three measured hosts",
        value({ valueType: 'Whole.None', value: 1, typeGroup: group }).type === 'Whole.None'
            && value({ valueType: 'Whole.None', value: 1, typeGroup: group, typeReport: 'group' }).type === group.join(',')
            && value({ valueType: 'Whole.None', value: 1, typeGroup: group, typeReport: 'wrong-member' }).type === 'Decimal'
            && value({ valueType: 'Decimal', value: 1, typeReport: 'group' }).type === 'Decimal',
    );

    const yesNo = value({ valueType: 'TwoOptions', value: false, optionLabels: ['Allow', 'Do Not Allow'] });
    check(
        "rig: a yes/no column carries its two options, false first, with the maker's labels, and formatted is the label",
        yesNo.raw === false && yesNo.attributes.Options.map((o) => `${o.Value}:${o.Label}`).join() === '0:Allow,1:Do Not Allow'
            && yesNo.attributes.DefaultValue === false && yesNo.formatted === 'Allow',
    );

    const calls = [];
    const german = host.createContext({ calls, clientUrl: host.nextClientUrl(), locale: 'de-DE' });
    const formatted = [
        german.formatting.formatDecimal(1234.5, 1),
        german.formatting.formatInteger(1234567),
        german.formatting.formatCurrency(-99.5),
    ];
    check(
        "rig: context.formatting writes the user's locale, and every call is logged",
        formatted.join(' | ') === '1.234,5 | 1.234.567 | -99,50\u00a0€'
            && calls.join() === 'formatting.formatDecimal([1234.5,1]),formatting.formatInteger(1234567),formatting.formatCurrency([-99.5,null,null])',
        formatted.join(' | '),
    );
    check(
        'rig: …and the platform made the bound value\'s formatted without a logged call — the control did not ask for it',
        (() => {
            const own = [];
            host.createContext({ calls: own, clientUrl: host.nextClientUrl(), valueType: 'Currency', value: 5 });
            return own.every((call) => !call.startsWith('formatting.'));
        })(),
    );
    const info = german.userSettings.numberFormattingInfo;
    check(
        'rig: numberFormattingInfo has every member the typings declare, and de-DE swaps the separators',
        Object.keys(info).length === 26 && info.numberDecimalSeparator === ',' && info.numberGroupSeparator === '.'
            && info.currencySymbol === '€' && context({}).userSettings.numberFormattingInfo.numberDecimalSeparator === '.',
        String(Object.keys(info).length),
    );

    const range = context({
        valueType: 'Whole.None',
        value: 10,
        bound: {
            upperValue: { type: 'Whole.None', raw: 400, column: 'cll_maxseats', minValue: 0, maxValue: 500 },
            spare: 'unmapped',
        },
    }).parameters;
    check(
        'rig: a second bound number column has its own range and formatted; an unmapped one is still the eight-key shape',
        range.upperValue.attributes.MaxValue === 500 && range.upperValue.attributes.LogicalName === 'cll_maxseats'
            && range.upperValue.formatted === '400' && range.spare.type === null && keys(range.spare.attributes) === '',
    );
}

/*
 * The text entry cursor and `dom.user`, proved on bare elements — every caret
 * assertion a control's suite makes rests on these being a browser's rules
 * (see *The text entry cursor* in `dev/dom.js`).
 */
function checkDomCursor() {
    const box = dom.createElement('input');
    box.type = 'text';
    box.value = 'abcdef';

    check('rig: assigning a different value moves the cursor to the end', box.selectionStart === 6 && box.selectionEnd === 6);

    box.setSelectionRange(2, 2);
    box.value = 'abcdef';
    check('rig: assigning the same value leaves the cursor where it was', box.selectionStart === 2, String(box.selectionStart));

    box.setSelectionRange(9, 4);
    check('rig: setSelectionRange clamps to the length and pulls a start past the end back to it', box.selectionStart === 4 && box.selectionEnd === 4, `${box.selectionStart}–${box.selectionEnd}`);

    box.value = 'one\ntwo';
    check('rig: a single-line input strips line breaks, as its value sanitisation does', box.value === 'onetwo', JSON.stringify(box.value));

    const email = dom.createElement('input');
    email.type = 'email';
    let refused = null;
    try {
        email.setSelectionRange(0, 0);
    } catch (error) {
        refused = error;
    }
    check('rig: an email input has no cursor — selectionStart null, setSelectionRange throws InvalidStateError', email.selectionStart === null && refused !== null && refused.name === 'InvalidStateError');

    const seen = [];
    const typed = dom.createElement('input');
    ['beforeinput', 'input', 'focus', 'paste', 'change', 'compositionstart', 'compositionupdate', 'compositionend'].forEach((type) => {
        typed.addEventListener(type, (event) => seen.push(`${type}:${event.inputType || ''}:${event.data === undefined ? '' : event.data}:${event.isComposing ? 'c' : ''}`));
    });
    typed.value = 'Contoso';
    typed.setSelectionRange(3, 3);
    dom.user.type(typed, 'xy');
    check('rig: user.type edits at the cursor and leaves it after what was typed', typed.value === 'Conxytoso' && typed.selectionStart === 5, `${typed.value} @${typed.selectionStart}`);
    check('rig: …focusing first, then beforeinput and input per character with inputType and data', seen.join(' ') === 'focus::: beforeinput:insertText:x: input:insertText:x: beforeinput:insertText:y: input:insertText:y:', seen.join(' '));

    const blocked = dom.createElement('input');
    blocked.addEventListener('beforeinput', (event) => event.preventDefault());
    blocked.value = 'ab';
    check('rig: preventDefault on beforeinput stops the edit', dom.user.type(blocked, 'c') === false && blocked.value === 'ab');

    typed.setSelectionRange(3, 3);
    dom.user.backspace(typed);
    check('rig: backspace deletes the character before the cursor', typed.value === 'Coxytoso' && typed.selectionStart === 2, `${typed.value} @${typed.selectionStart}`);
    typed.setSelectionRange(0, 0);
    check('rig: backspace at the start deletes nothing and fires nothing', dom.user.backspace(typed) === false);
    typed.setSelectionRange(2, 4);
    dom.user.del(typed);
    check('rig: delete removes a selection', typed.value === 'Cotoso', typed.value);

    const limited = dom.createElement('input');
    limited.maxLength = 3;
    dom.user.type(limited, 'abcdef');
    dom.user.paste(limited, 'zz');
    check('rig: maxLength limits what the user types and pastes', limited.value === 'abc', limited.value);

    typed.focus();
    seen.length = 0;
    typed.value = '';
    dom.user.paste(typed, 'line one\nline two');
    check('rig: paste fires paste, then beforeinput/input insertFromPaste, one line', typed.value === 'line oneline two' && seen[0].indexOf('paste:') === 0 && seen[1].indexOf('beforeinput:insertFromPaste:') === 0, seen.join(' | '));

    seen.length = 0;
    typed.value = '';
    dom.user.compose(typed, ['k', 'ka'], 'か');
    check('rig: compose replaces its own run, ending on the committed text', typed.value === 'か' && typed.selectionStart === 1, typed.value);
    check(
        'rig: …and the last input arrives, still composing, before compositionend — as in Chromium',
        seen[0].indexOf('compositionstart') === 0 && seen[seen.length - 2] === 'input:insertCompositionText:か:c' && seen[seen.length - 1].indexOf('compositionend') === 0,
        seen.join(' '),
    );

    seen.length = 0;
    dom.user.autofill(typed, '555-0100');
    check('rig: autofill replaces the value with an input that has no inputType and no beforeinput, then change', typed.value === '555-0100' && seen.join(' ') === 'input::: change:::', seen.join(' '));

    seen.length = 0;
    typed.setSelectionRange(4, 4);
    check('rig: undo not cancelled changes nothing and leaves the cursor at 0, with an input historyUndo — as measured', dom.user.undo(typed) === false && typed.value === '555-0100' && typed.selectionStart === 0 && seen.join(' ') === 'beforeinput:historyUndo:null: input:historyUndo:null:', seen.join(' '));

    const undone = dom.createElement('input');
    undone.addEventListener('beforeinput', (event) => {
        if (event.inputType === 'historyUndo') {
            event.preventDefault();
        }
    });
    check('rig: undo cancelled is reported and fires no input', dom.user.undo(undone) === true);

    const off = dom.createElement('input');
    off.disabled = true;
    check('rig: a disabled input takes no typing', dom.user.type(off, 'a') === false && off.value === '');

    const focusLog = [];
    const first = dom.createElement('input');
    const second = dom.createElement('input');
    first.addEventListener('blur', () => focusLog.push('first:blur'));
    second.addEventListener('focus', () => focusLog.push('second:focus'));
    first.focus();
    second.focus();
    second.focus();
    check('rig: moving focus blurs what had it, and focusing twice fires once', focusLog.join(' ') === 'first:blur second:focus', focusLog.join(' '));
    second.blur();
}

/*
 * `dev/dom.js` hands back what a browser hands back, and no more: a control
 * that calls `.map` on `querySelectorAll` or `.forEach` on `children` fails
 * on a form, so it has to fail here too.
 */
function checkDomCollections() {
    const root = dom.createElement('div');
    const a = root.appendChild(dom.createElement('span'));
    a.className = 'x';
    root.appendChild(dom.createElement('span')).setAttribute('id', 'second');
    a.appendChild(dom.createElement('span')).className = 'x';

    const all = root.querySelectorAll('span');
    check('rig: querySelectorAll is a NodeList — indexable, length, item, forEach, iterable', all.length === 3 && all[0] === a && typeof all.item === 'function' && all.item(5) === null
        && typeof all.forEach === 'function' && Array.from(all).length === 3 && Object.prototype.toString.call(all) === '[object NodeList]');
    check('rig: …with no Array methods, as in a browser', all.map === undefined && all.filter === undefined && all.find === undefined && !Array.isArray(all));
    check('rig: querySelectorAll walks depth-first, in document order', Array.from(root.querySelectorAll('.x')).length === 2 && root.querySelector('.x') === a);

    const kids = root.children;
    check('rig: children is an HTMLCollection — indexable, item, namedItem, iterable, no forEach', kids.length === 2 && kids[1].getAttribute('id') === 'second'
        && typeof kids.namedItem === 'function' && kids.namedItem('second') === kids[1] && [...kids].length === 2 && kids.forEach === undefined && kids.map === undefined);
}

/*
 * `dev/modules.js`, the loader for a control whose bundle cannot load here
 * (see its header). Nothing in this suite needs it, so it is proved on three
 * throwaway modules rather than left untested until the day one does: a
 * relative import is followed, a type annotation is stripped, and a package
 * the caller forbids is refused by name.
 */
function checkModuleLoader() {
    const os = require('os');
    const { createLoader } = require('./modules.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcf-modules-'));

    try {
        fs.writeFileSync(path.join(dir, 'rule.ts'), 'import { limit } from "./limit";\nexport function clamp(n: number): number { return Math.min(n, limit); }\n');
        fs.writeFileSync(path.join(dir, 'limit.ts'), 'export const limit: number = 5;\n');
        fs.writeFileSync(path.join(dir, 'leaky.ts'), 'import * as lib from "some-browser-library";\nexport const x = lib;\n');

        fs.writeFileSync(path.join(dir, 'unused.ts'), 'import * as lib from "some-browser-library";\nexport const y = 1;\n');
        fs.writeFileSync(path.join(dir, 'reach.ts'), 'import { View } from "./components/View";\nexport const z = View;\n');

        const load = createLoader({ root: dir, forbid: [/some-browser-library/, [/components\//, 'the component tree']] });
        check('rig: modules.js transpiles a decision module and follows its relative import', load('rule').clamp(9) === 5);

        let refused = null;
        try {
            load('leaky');
        } catch (error) {
            refused = error;
        }
        check('rig: modules.js refuses a forbidden import by name, rather than failing on its absence', refused !== null && /imports some-browser-library/.test(refused.message), String(refused && refused.message));

        let reached = null;
        try {
            load('reach');
        } catch (error) {
            reached = error;
        }
        check('rig: modules.js refuses a relative import into a forbidden path, naming what it is', reached !== null && /stay free of the component tree/.test(reached.message), String(reached && reached.message));
        check('rig: an import nothing uses is elided before the guard sees it — mutation-test the guard with a used import', load('unused').y === 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

rigSelfCheck().then(report, (error) => {
    check('rig: the self-check ran to the end', false, String(error && error.stack || error));
    report();
});

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

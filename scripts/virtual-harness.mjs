/**
 * The browser rig's react (virtual) patch, as pure text transforms.
 *
 * A virtual control differs from a standard one in exactly two places on this
 * page: the bundle cannot be loaded with a `<script src>` (React and Fluent
 * have to be defined under version-encoded globals first), and `updateView`
 * *returns* an element instead of writing into a container. Everything else on
 * `harness.html` — every switch, every readout, the whole of `host.js` — is the
 * same file for both shapes.
 *
 * **Why this one is shared when the manifest patch beside it is not.**
 * `add-control.mjs` duplicates setup.mjs's manifest patch deliberately, because
 * the two scripts copy from different roots and the patch is eight lines. This
 * one is neither: it takes *text* rather than paths, so the different-roots
 * objection does not apply to it, and at six separate replaces two copies
 * would drift. Both callers apply it their own way.
 *
 * Every transform throws rather than returning the text unchanged. A silent
 * no-op here ships a harness page that loads a bundle nobody defined the
 * globals for, and the symptom is a `ReferenceError` naming a global that
 * appears nowhere in the repository.
 */

/**
 * Patch on `\n` whatever the file is stored as, then put it back.
 *
 * The template has no `.gitattributes` and its files are a mix — `dev/host.js`
 * is CRLF, `dev/serve.js` is LF — so a marker written with `\n` matches half of
 * them and silently misses the rest. Normalising here is cheaper than writing
 * every marker twice, and rewriting a whole file's endings as a side effect of
 * a six-line patch would bury the diff.
 */
function withNewlines(text, transform) {
    const crlf = text.includes('\r\n');
    const patched = transform(crlf ? text.split('\r\n').join('\n') : text);

    return crlf ? patched.split('\n').join('\r\n') : patched;
}

/** Replace exactly one occurrence, or say which marker moved. */
function replace(text, from, to, what) {
    if (!text.includes(from)) {
        throw new Error(
            `Could not patch ${what} — the text this script rewrites was not found.\n`
            + `Looked for:\n${from.split('\n').slice(0, 3).join('\n')}…`,
        );
    }

    return text.replace(from, to);
}

/** Rows of markup at the page's body indentation; `''` is a blank line. */
function lines(...rows) {
    return rows.map((row) => (row === '' ? '\n' : `        ${row}\n`)).join('');
}

/**
 * `dev/harness.html` for a virtual control.
 *
 * `control` is the constructor name, already substituted into the page by the
 * caller — the bundle tag being removed carries it.
 */
export function patchHarnessHtml(text, control) {
    return withNewlines(text, (source) => patchHtml(source, control));
}

function patchHtml(text, control) {
    const withGlobals = replace(
        text,
        lines('<p class="harness-note" id="harness-status"></p>'),
        lines(
            '<p class="harness-note" id="harness-status"></p>',
            '',
            '<!--',
            '    The platform globals this bundle turned out to want, filled in by',
            '    virtual-bundle.js once it has read them out of the bundle text. An',
            '    empty list means the control imports neither React nor Fluent,',
            '    which for a virtual control means the build is stale.',
            '-->',
            '<p class="harness-note">',
            '    Platform globals in this bundle: <code id="harness-globals">…</code>',
            '</p>',
        ),
        'dev/harness.html (the status line)',
    );

    /*
     * React goes *ahead of host.js*, not merely ahead of the bundle.
     *
     * `harness.js` reads `window.__harnessReactDOM` into a local the moment it
     * loads, so React arriving after that file is React arriving too late — and
     * the symptom is one line, "Cannot read properties of undefined (reading
     * 'render')", with nothing on the page to say why.
     */
    const staged = replace(
        withGlobals,
        lines('<script src="host.js"></script>'),
        lines(
            '<!--',
            '    React and the Fluent stand-in ahead of host.js, because harness.js',
            '    reads both into locals the moment it loads.',
            '',
            '    Aliased onto `__harnessReact` rather than left as `window.React`:',
            '    the names the bundle actually imports are version-encoded',
            '    (`Reactv16`, `FluentUIReactv940`), so virtual-bundle.js reads them',
            '    out of the bundle and defines them itself. Writing them down here',
            '    is a trap that springs on the next version bump.',
            '',
            '    The development builds, not the minified ones. This is a debugging',
            "    surface, and React's warnings only exist in the development build.",
            '-->',
            '<script src="../node_modules/react/umd/react.development.js"></script>',
            '<script src="../node_modules/react-dom/umd/react-dom.development.js"></script>',
            '<script>',
            '    window.__harnessReact = window.React;',
            '    window.__harnessReactDOM = window.ReactDOM;',
            '</script>',
            '<script src="fluent-stub.js"></script>',
            '',
            '<script src="host.js"></script>',
        ),
        'dev/harness.html (the React tags)',
    );

    return replace(
        staged,
        lines(
            '<script src="harness.js"></script>',
            `<script src="../out/controls/${control}/bundle.js"></script>`,
            '<script>',
            '    window.__harnessStart();',
            '</script>',
        ),
        lines(
            '<script src="harness.js"></script>',
            '',
            '<!--',
            "    The bundle, fetched rather than `<script src>`'d: the globals it",
            '    imports have to exist before its first line runs, and their names',
            '    can only be read out of the bundle text. Calls __harnessStart()',
            '    once the control has registered.',
            '-->',
            '<script src="virtual-bundle.js"></script>',
        ),
        'dev/harness.html (the bundle tag)',
    );
}

/**
 * `dev/harness.js` for a virtual control.
 *
 * `type` is `'field'` or `'dataset'`; the two rigs mount and re-render through
 * different code, so the seam goes in a different place in each.
 */
export function patchHarnessJs(text, type) {
    return withNewlines(text, (source) => patchJs(source, type));
}

function patchJs(text, type) {
    const out = replace(
        text,
        '    var registration = host.captureRegistration(window);\n',
        '    var registration = host.captureRegistration(window);\n'
        + '\n'
        + '    /*\n'
        + '     * The page renders this control; on a form the platform would.\n'
        + '     *\n'
        + '     * A virtual control is never handed a container — `init` takes none, and\n'
        + '     * `updateView` returns an element for its caller to render. See\n'
        + '     * dev/virtual-bundle.js for how React gets onto the page at all, and\n'
        + '     * dev/fluent-stub.js for what stands in for Fluent while it is here.\n'
        + '     */\n'
        + '    var ReactDOM = window.__harnessReactDOM;\n',
        'dev/harness.js (the ReactDOM declaration)',
    );

    return type === 'dataset' ? patchDatasetHarnessJs(out) : patchFieldHarnessJs(out);
}

function patchFieldHarnessJs(text) {
    const rendered = replace(
        text,
        '        var context = host.createContext(options());\n'
        + '\n'
        + '        instance.updateView(context);\n',
        '        var context = host.createContext(options());\n'
        + '\n'
        + '        ReactDOM.render(instance.updateView(context), container);\n',
        'dev/harness.js (render)',
    );

    /*
     * The bail inverts rather than going away.
     *
     * The standard page refuses a control whose `updateView` returned something;
     * this one refuses a control whose `updateView` returned nothing. Both are
     * the same mistake seen from opposite sides — a page and a control that
     * disagree about which shape this is — and it is worth catching, because the
     * symptom otherwise is an empty stage with no error at all.
     */
    return replace(
        rendered,
        '        /*\n'
        + '         * A virtual (React) control returns an element from `updateView` and is\n'
        + '         * never handed a container, so it cannot be driven from a page that has\n'
        + '         * no React on it. `--framework react` removes this file for that\n'
        + '         * reason; if you are reading this inside a React control, the harness\n'
        + '         * was reinstated by hand and needs React and Fluent on the page before\n'
        + '         * it can work. `npm run smoke` covers that shape without a browser.\n'
        + '         */\n'
        + '        instance.init(context, notifyOutputChanged, {}, container);\n'
        + '\n'
        + '        var returned = instance.updateView(context);\n'
        + '\n'
        + '        if (returned !== undefined) {\n'
        + '            status.textContent =\n'
        + "                'updateView returned a value — this is a virtual control, and this page cannot render one. Use npm start and npm run smoke.';\n"
        + '\n'
        + '            return;\n'
        + '        }\n',
        '        // No container: a virtual control never receives one.\n'
        + '        instance.init(context, notifyOutputChanged, {});\n'
        + '\n'
        + '        var returned = instance.updateView(context);\n'
        + '\n'
        + '        if (returned === undefined) {\n'
        + '            status.textContent =\n'
        + "                'updateView returned nothing — this page renders a virtual control, and this one wrote into a container instead. Check control-type in the manifest.';\n"
        + '\n'
        + '            return;\n'
        + '        }\n'
        + '\n'
        + '        ReactDOM.render(returned, container);\n',
        'dev/harness.js (__harnessStart)',
    );
}

function patchDatasetHarnessJs(text) {
    const mounted = replace(
        text,
        "        container = document.getElementById('harness-root');\n"
        + "        container.innerHTML = '';\n"
        + '\n'
        + '        instance = new registration.ctor();\n'
        + '        instance.init(handle.context, function () {}, {}, container);\n',
        "        container = document.getElementById('harness-root');\n"
        + '\n'
        + "        // Not `innerHTML = ''`: React marks its container with an internal root\n"
        + '        // property, so emptying the children by hand leaves the next render\n'
        + '        // reconciling against nodes that are no longer in the document.\n'
        + '        ReactDOM.unmountComponentAtNode(container);\n'
        + '\n'
        + '        instance = new registration.ctor();\n'
        + '        instance.init(handle.context, function () {});\n',
        'dev/harness.js (mount)',
    );

    /*
     * `drive()` already hands back the element the last pass returned — it was
     * written that way so one set of assertions could read either shape — so
     * the whole dataset seam is putting that element on the page.
     */
    return replace(
        mounted,
        '        var driven = host.drive(instance, handle, 10);\n',
        '        var driven = host.drive(instance, handle, 10);\n'
        + '\n'
        + '        // What the last pass returned. `drive` runs the loop; rendering the\n'
        + "        // result is the caller's job on this shape.\n"
        + '        ReactDOM.render(driven.element, container);\n',
        'dev/harness.js (pump)',
    );
}

/*
 * The platform, stood in for: everything a field control reads off `context`,
 * built from a set of switches.
 *
 * Loaded by both `harness.html` in a browser and `smoke.js` in Node, which is
 * why it attaches to `window` *and* assigns `module.exports` and requires
 * neither to exist. One definition of the host is the point — a browser mock
 * and a Node mock that drifted apart would let the same control pass one and
 * fail the other for reasons that are about the mocks.
 *
 * ---
 *
 * **Why this exists when `npm start` already hosts a field control.**
 *
 * `pcf-start` gives you a property panel and a real render, and for the happy
 * path it is the better tool — use it. What it cannot put the control into is
 * every state a form can:
 *
 *   - **field-level security** — `security.readable === false` is what a user
 *     denied read access gets, and it arrives as `raw === null`, which is
 *     indistinguishable from "empty" to a control that does not check;
 *   - **platform validation** — `error` / `errorMessage`, set by a business
 *     rule the harness has no way to run;
 *   - **a host theme** — `fluentDesignLanguage.isDarkTheme`, published by a
 *     model-driven form and by nothing else;
 *   - **the canvas/model-driven split** — `attributes` is column metadata, and
 *     a canvas app has none. Every `?.` in the control is about this, and
 *     `npm start` only ever shows you one side of it.
 *
 * Those are the branches nobody exercises and customers find. Here they are
 * checkboxes.
 *
 * ---
 *
 * **A stub must never be more capable than the thing it stands in for.** Where
 * the platform withholds something, this withholds it: `security` is
 * `undefined` on a column with no field-level security, `attributes` is
 * `undefined` on canvas, `fluentDesignLanguage` is `undefined` on a host that
 * publishes no theme. Filling those in "so the control has something to read"
 * is how a control that cannot work on a real form passes every local check.
 */

(function (root, factory) {
    'use strict';

    var api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.__pcfHost = api;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    /*
     * What `context.resources.getString` answers.
     *
     * The keys are the ones in `strings/__CONTROL__.1033.resx`, and a key that
     * is not here falls back to the key itself — which is what the platform
     * does for a key missing from the .resx, so a typo looks here the way it
     * looks in production rather than throwing.
     */
    var STRINGS = {
        __CONTROL___Name: '__TITLE__',
        __CONTROL___NoAccess: 'You do not have access to this field.',
    };

    /**
     * The two hosts, and the difference that matters.
     *
     * A model-driven form mounts a `FluentProvider` above every code component
     * and hands down column metadata; a canvas app does neither. Anything the
     * control reads with `?.` is reading across this line.
     */
    var HOSTS = {
        'model-driven': {
            label: 'model-driven form',
            // Published as CSS custom properties by the provider the form
            // already mounts, which is what the stylesheet reads through
            // `var()`. The control itself only needs the boolean.
            publishesTheme: true,
            // `attributes` on a bound property: MaxLength, Precision, the
            // option set for a choice column.
            publishesMetadata: true,
        },
        canvas: {
            label: 'canvas app',
            publishesTheme: false,
            publishesMetadata: false,
        },
    };

    /**
     * How the column's field-level security is configured.
     *
     * `none` is the common case and the one worth defaulting to: a column with
     * no FLS profile reports `security === undefined`, not an object with every
     * flag true. A control that reads `parameter.security.readable` without
     * guarding throws on the *ordinary* column, not on the secured one.
     */
    var SECURITY = {
        none: undefined,
        'read-only': { editable: false, readable: true, secured: true },
        'no-access': { editable: false, readable: false, secured: true },
    };

    /**
     * `context.client.getFormFactor()`, which is a number and not the one most
     * people guess.
     *
     * **0 Unknown, 1 Desktop, 2 Tablet, 3 Phone.** Web is `1`, and `3` — the
     * value that looks like it ought to mean "the big one" — is a phone. A
     * control that compares against the wrong number reflows backwards, on the
     * client it was least likely to be tested on.
     *
     * This and `allocatedWidth` are the pair the platform's own guidance uses
     * together: form factor alone cannot tell a narrow container on a desktop
     * from a wide one, so responsive controls test both.
     */
    var FORM_FACTORS = { unknown: 0, desktop: 1, tablet: 2, phone: 3 };

    var DEFAULTS = {
        host: 'model-driven',
        /** One of FORM_FACTORS above, by name. */
        formFactor: 'desktop',
        /**
         * `mode.allocatedWidth` / `allocatedHeight`.
         *
         * **-1 is a real value and the default one**: the platform reports it
         * until the control asks for resize notifications with
         * `mode.trackContainerResize(true)`. A control that reads the width
         * without asking gets -1 forever and reflows to its narrowest layout on
         * every host — which is why `tracked` below records the request.
         */
        width: -1,
        height: -1,
        /** What the column holds. `null` is a cleared column. */
        value: 'Contoso Ltd',
        placeholder: 'Type a value',
        /** The maker's label for this field on this form. */
        label: 'Account name',
        visible: true,
        /** The form's read-only state. Not the column's — see `security`. */
        disabled: false,
        security: 'none',
        /** A business rule that failed. */
        error: false,
        errorMessage: 'Enter a value with at least three characters.',
        /**
         * `undefined` means the host published no theme, which is a real state
         * and the one canvas is always in. Absent is not the same as light.
         */
        dark: undefined,
        rtl: false,
        maxLength: 100,
    };

    /**
     * Build a `context` for a field control.
     *
     * Anything not named in `options` comes from DEFAULTS, so a caller states
     * only the state it is interested in — which is what lets an assertion in
     * `smoke.js` read as a sentence about one branch.
     */
    function createContext(options) {
        var o = Object.assign({}, DEFAULTS, options || {});
        var host = HOSTS[o.host] || HOSTS['model-driven'];
        var security = SECURITY[o.security];

        var getString =
            o.getString
            || function (key) {
                return STRINGS[key] !== undefined ? STRINGS[key] : key;
            };

        return {
            parameters: {
                value: {
                    raw: o.value,
                    /*
                     * Present only where the host has column metadata.
                     *
                     * The control reads `parameter.attributes?.MaxLength`, and
                     * that single `?` is the whole canvas/model-driven
                     * difference. Supplying it on canvas would hide the one bug
                     * this switch exists to find.
                     */
                    attributes: host.publishesMetadata
                        ? { MaxLength: o.maxLength, LogicalName: 'name', DisplayName: o.label }
                        : undefined,
                    /*
                     * `undefined` unless the column carries a field-level
                     * security profile — see SECURITY above. The common case is
                     * absence, and absence is what unguarded code breaks on.
                     */
                    security: security,
                    error: o.error,
                    // The platform sets no message when there is no error.
                    errorMessage: o.error ? o.errorMessage : undefined,
                    type: 'SingleLine.Text',
                },
                placeholder: { raw: o.placeholder, type: 'SingleLine.Text' },
            },

            mode: {
                isVisible: o.visible,
                isControlDisabled: o.disabled,
                label: o.label,
                /*
                 * Recorded, not delivered.
                 *
                 * The platform sends `allocatedWidth` only to a control that
                 * asked, and asking is this call — so "did it ask" is a
                 * decision worth asserting, while "did the width then change"
                 * is a platform behaviour this file cannot honestly reproduce.
                 * Set `width` to drive the second.
                 */
                trackContainerResize: function (value) {
                    if (o.tracked) {
                        o.tracked.push(value);
                    }
                },
                setFullScreen: function (value) {
                    if (o.tracked) {
                        o.tracked.push('setFullScreen:' + value);
                    }
                },
                allocatedWidth: o.width,
                allocatedHeight: o.height,
            },

            resources: { getString: getString },

            /*
             * Absent on a host that publishes no theme, which is what the
             * control's `applyTheme` is written for: `isDarkTheme === undefined`
             * means take no position and let the stylesheet's own fallbacks
             * stand.
             */
            fluentDesignLanguage: host.publishesTheme ? { isDarkTheme: Boolean(o.dark) } : undefined,

            userSettings: {
                isRTL: o.rtl,
                languageId: 1033,
                // Read by any control that formats a number or a date.
                numberFormattingInfo: { numberDecimalSeparator: '.', numberGroupSeparator: ',' },
            },

            client: {
                getClient: function () {
                    return o.formFactor === 'phone' || o.formFactor === 'tablet' ? 'Mobile' : 'Web';
                },
                getFormFactor: function () {
                    return FORM_FACTORS[o.formFactor] !== undefined ? FORM_FACTORS[o.formFactor] : 1;
                },
                isOffline: function () {
                    return false;
                },
            },

            /*
             * `updatedProperties` is how the platform says *what* changed since
             * the last pass, and it is the cheap way out of doing work on every
             * `updateView`. Empty unless a caller sets it, because that is what
             * the first call carries.
             */
            updatedProperties: o.updatedProperties || [],
        };
    }

    /**
     * Capture the constructor the bundle registers when it loads.
     *
     * `pcf-scripts` emits `registerControl('__NAMESPACE__.__CONTROL__', ctor)`
     * — **two arguments**, the namespace and the constructor name already
     * joined into one string. Reading the constructor from a third parameter
     * gets `undefined`, and the failure surfaces later as "registered is not a
     * constructor" rather than here.
     */
    function captureRegistration(global) {
        var box = { name: null, ctor: null };

        global.ComponentFramework = global.ComponentFramework || {};
        global.ComponentFramework.registerControl = function (fullName, ctor) {
            box.name = fullName;
            box.ctor = ctor;
        };

        return box;
    }

    return {
        HOSTS: HOSTS,
        SECURITY: SECURITY,
        STRINGS: STRINGS,
        DEFAULTS: DEFAULTS,
        FORM_FACTORS: FORM_FACTORS,
        createContext: createContext,
        captureRegistration: captureRegistration,
    };
});

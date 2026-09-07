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

        /**
         * What the platform hands `init()` as its third argument.
         *
         * `null` is the honest default and means "nothing was saved" — a first
         * mount, or a host that does not persist. Set it to whatever a previous
         * mount passed to `mode.setControlState` to reproduce the return half of
         * a form tab switch.
         */
        state: null,

        /**
         * Whether `mode.setControlState` succeeds.
         *
         * `false` is a host that took the call and saved nothing, which is the
         * state a control cannot see except by reading the return value.
         */
        stateWritable: true,

        /**
         * The control's own input properties, merged into `parameters`.
         *
         * The scaffolded control has only `placeholder`, and every real one
         * grows more — including further *bound* properties, which arrive the
         * same way. Pass them as raw values — `{ maxSizeKb: 512 }` — and they
         * reach the control as `{ raw: … }` where it expects them.
         *
         * Passing them rather than editing this file is what keeps a repo's
         * copy of the rig close enough to the template's to update by copying.
         */
        inputs: {},

        /**
         * What `context.device.pickFile()` resolves with — an array of
         * `FileObject` — or `null` to reject.
         *
         * **`null` is the default, and that is not pessimism.** Every device
         * method rejects outside a real device origin: the hub's demo sandbox,
         * `npm start`, a canvas app in a browser tab. A control that treats the
         * rejection as an error state rather than as an ordinary outcome shows
         * a red message to most of the people who ever run it.
         *
         * Note `fileSize` is in **KB**, not bytes. It is the one field of a
         * `FileObject` that reads like it means something else, and a size
         * check written against bytes lets a file a thousand times too large
         * straight through.
         */
        pickFile: null,

        /**
         * What `context.device.captureImage()` resolves with — **one**
         * `FileObject`, not an array — or `null` to reject.
         *
         * The arity is the trap. `pickFile` resolves with `FileObject[]` and
         * this resolves with a single object, so the reflex that worked on the
         * picker (`files[0]`) reads `undefined` here and the control uploads
         * nothing, silently. Both are stubbed so that mistake is available to
         * make locally rather than on a phone.
         *
         * Rejects by default for the reason `pickFile` does, and rather more
         * strongly: there is no camera anywhere this rig runs.
         */
        captureImage: null,

        /**
         * Whether `context.device` exists at all.
         *
         * **Absence is a fourth state, and it is not a refusal.** A refusal is
         * the platform saying no; absence is the API never having been there,
         * which is what `<uses-feature required="false">` buys and what Power
         * Pages does to every `Device.*` method unconditionally. A control has
         * to say something different in each case — "not on this client" is
         * actionable on another one, "that did not work" is not — and it cannot
         * be tested for that without being able to reach both.
         */
        device: true,

        /**
         * What `context.device.getCurrentPosition()` does.
         *
         * Either an object of coordinates to resolve with —
         * `{ latitude, longitude, accuracy }`, the rest filled in — or one of
         * three **named refusals**, because the refusals are not
         * interchangeable and a control that handles one handles none:
         *
         *   'denied'      -> rejects with `{ code, message }`, a plain object.
         *                    The user, or the client, said no.
         *   'unavailable' -> rejects with **`null`**. Documented: an older
         *                    model-driven mobile client, or a device with no
         *                    geolocation capability at all, passes `null` to
         *                    the error callback and nothing else.
         *   'no-bridge'   -> rejects with an `Error`. A browser tab with no
         *                    native host: `npm start`, the hub's sandbox.
         *   'absent'      -> **the method is not on the bag at all.** Not a
         *                    rejection: `typeof device.getCurrentPosition` is
         *                    'undefined', and a control that calls it without
         *                    checking throws a TypeError rather than reaching
         *                    any catch block it wrote.
         *
         * **'no-bridge' is the default**, because it is what every host this rig
         * can imitate actually does — and because `getCurrentPosition` is
         * narrower than it looks. It is canvas apps and the model-driven
         * **mobile** client only; a model-driven form in a *browser* has no
         * location at all, which is the degradation most geo controls never
         * test because it is the one they were written on.
         *
         * `'unavailable'` is the one to write a test for first. A
         * `catch (error)` that reads `error.message` throws on `null` — so the
         * handler for the failure fails, and the control hangs on its own
         * promise instead of showing the state it has for exactly this.
         */
        position: 'no-bridge',

        /**
         * Whether `context.webAPI` exists at all.
         *
         * The same switch, and the same reasoning, as the dataset rig's: WebAPI
         * is Dataverse-dependent and **not available in canvas apps**, so a
         * control that reaches for it unguarded works everywhere it was tested
         * and nowhere else.
         */
        webAPI: true,

        /**
         * What `webAPI.createRecord` resolves with — an id — or `null` to
         * reject.
         *
         * Success is the default, unlike every device switch above, and the
         * difference is honest rather than inconsistent: a create against a
         * model-driven form's Dataverse ordinarily works, so the rejection is
         * the exception and the exception is what a caller asks for.
         */
        createRecord: '11111111-2222-3333-4444-555555555555',

        /** What `webAPI.retrieveRecord` resolves with, or `null` to reject. */
        retrieveRecord: {},

        /** Whether `webAPI.updateRecord` resolves. `false` rejects. */
        updateRecord: true,

        /**
         * Whether `context.utils` exists, and the entity set its metadata
         * answers with.
         *
         * `getEntityMetadata` is **model-driven only** and gated behind the
         * `Utility` feature, so absence is a real host. See `utils` in the
         * context below for the shape it answers with, which is not the shape
         * it looks like.
         */
        utils: true,
        entitySetName: 'accounts',

        /**
         * What `utils.hasEntityPrivilege` answers.
         *
         * **Synchronous, and a boolean rather than a promise** — the one member
         * of `context.utils` that is. It answers about the *user's roles*, not
         * about the host, so `false` is an ordinary answer and not a failure:
         * a control that gates an affordance on it has a branch that only a
         * differently-privileged user ever reaches, which is exactly the branch
         * nobody tests.
         *
         * It lives under `utils`, so `utils: false` removes it along with
         * everything else — which is the host distinction that matters, since
         * "the user may not" and "this host cannot say" call for different
         * behaviour and a control that conflates them hides itself in canvas.
         */
        hasPrivilege: true,

        /**
         * Whether `context.navigation` exists at all.
         *
         * Typed non-optional, which is a claim about the type definitions
         * rather than about the host. A control that reads
         * `context.navigation.openConfirmDialog` through an unguarded bag
         * throws a TypeError rather than degrading, and a rig that cannot
         * remove the bag cannot tell the two apart.
         */
        hasNavigation: true,

        /**
         * What the platform dialogs do, and there are four answers rather than
         * two.
         *
         *   'confirmed' -> `openConfirmDialog` resolves `{ confirmed: true }`
         *   'cancelled' -> resolves `{ confirmed: false }` — **a resolve, not a
         *                  reject.** A control that treats a cancel as a
         *                  failure reports an error the user did not cause,
         *                  and this is the single easiest thing to get wrong
         *                  about the dialog API.
         *   'rejected'  -> the promise rejects, which is what a dialog the host
         *                  refuses to open does
         *   'absent'    -> the three dialog methods are **deleted from the
         *                  bag**, which is what canvas is. Absence is a
         *                  different state from refusal, and only one of the
         *                  two is ever a bug in the control.
         *
         * The same four answers as the dataset rig's, deliberately: an
         * assertion about a confirmation should read identically in both.
         */
        dialogs: 'confirmed',

        /**
         * `context.mode.contextInfo`, or `null` for a host without it.
         *
         * **`null` is the default, and this member is the reason.** It is
         * absent from `@types/powerapps-component-framework` altogether, so
         * every use of it is an untyped cast; and the platform's own FAQ says
         * code components deliberately do *not* carry the record's identity,
         * pointing at bound `entityId` / `entityName` input properties instead.
         * Defaulting it to absent puts the documented fallback under test rather
         * than the undocumented happy path.
         *
         * Set it to `{ entityId, entityTypeName }` to get the other branch.
         */
        contextInfo: null,

        /** `context.client.isOffline()`. A phone out in a field is this one. */
        offline: false,

        /**
         * What `context.resources.getResource()` hands to its success callback,
         * or `null` to call the failure callback instead.
         *
         * `null` by default for the same reason: an `<img>` resource resolves
         * on a model-driven form and is not something to count on elsewhere, so
         * a control whose empty state depends on one has no empty state on the
         * hosts that matter most for a demo.
         */
        resource: null,
    };

    /**
     * `context.navigation`, assembled method by method.
     *
     * **Presence is per method, not per bag**, and that is the whole reason
     * this is a function rather than an object literal. `openUrl` is there on
     * every host; `openForm`, `openWebResource` and `openFile` are documented
     * model-driven only; the three dialogs are a model-driven affordance that
     * canvas does not have. A control that checks `context.navigation` once and
     * then calls a method through it passes on the host it was written on and
     * throws a TypeError on the next one — so each of these is removed
     * independently here, because each is removed independently in the world.
     *
     * The same shape as the dataset rig's, so an assertion reads the same in
     * both.
     */
    function buildNavigation(o, log) {
        if (!o.hasNavigation) {
            return undefined;
        }

        var navigation = {
            /**
             * **Returns `void`, not a promise.** The odd one out in this bag,
             * and `void openUrl(...)` in the type definitions — so `await`ing
             * it is harmless and `.catch()` on it is a TypeError. There is also
             * no failure channel: a URL the host refuses to open reports
             * nothing back, which is why a control has to decide the URL is
             * acceptable *before* it calls.
             */
            openUrl: function (url) {
                log('navigation.openUrl', url);
            },
        };

        /*
         * `openForm` is deliberately NOT here, and its absence is the rule
         * rather than an omission.
         *
         * It is model-driven only, and no field control in the catalogue opens
         * a form — the ones that do are dataset controls, whose rig has it. A
         * stub for a method nothing calls is a stub nobody maintains, and it
         * would sit here reading as though the field rig models a capability it
         * has never been asked to model. Add it *with* the control that needs
         * it, behind its own switch, the way the dataset rig has `openFile`.
         */

        /*
         * 'absent' removes the three rather than making them fail, because
         * those are different states and only one of them is a bug in the
         * control. This is the state canvas is in.
         */
        if (o.dialogs === 'absent') {
            return navigation;
        }

        var refused = function () {
            return Promise.reject({
                errorCode: 2147746581,
                message: 'The dialog could not be opened.',
            });
        };

        navigation.openAlertDialog = function (alertStrings) {
            log('navigation.openAlertDialog', (alertStrings || {}).text);
            return o.dialogs === 'rejected' ? refused() : Promise.resolve();
        };

        /**
         * The one that matters, and the one everybody gets wrong.
         *
         * **Cancel is a resolve.** `{ confirmed: false }` comes back through the
         * success path, not through `catch` — so a control that puts its action
         * inside `.then()` without reading `confirmed` does the thing the user
         * just declined, and a control that treats the cancel as a failure
         * shows an error for something the user did on purpose. Both are one
         * line away from correct and neither shows up without this switch.
         */
        navigation.openConfirmDialog = function (confirmStrings) {
            log('navigation.openConfirmDialog', (confirmStrings || {}).text);

            return o.dialogs === 'rejected'
                ? refused()
                : Promise.resolve({ confirmed: o.dialogs === 'confirmed' });
        };

        navigation.openErrorDialog = function (errorOptions) {
            /*
             * `details` is logged, and that is not tidiness.
             *
             * The control writes its own sentence into `message` and the
             * *platform's* explanation into `details`, so an assertion that
             * reads only `message` is reading a slot the platform never filled
             * — it passes whether or not the rejection was ever decoded, which
             * makes "and NOT [object Object]" a claim about nothing. Both
             * halves are recorded so both can be asserted.
             */
            log('navigation.openErrorDialog', {
                message: (errorOptions || {}).message,
                details: (errorOptions || {}).details,
                errorCode: (errorOptions || {}).errorCode,
            });

            return o.dialogs === 'rejected' ? refused() : Promise.resolve();
        };

        return navigation;
    }

    /**
     * `context.events`, from either an array of names or an object of handlers.
     *
     * See the comment at the `events:` member for why both shapes exist. A
     * handler that throws is **not** caught here: the platform does not promise
     * to catch a maker's handler either, and a control that raises an event
     * without a `try` around it should fail this rig rather than production.
     */
    function buildEvents(events, log) {
        if (events === null || events === undefined) {
            return undefined;
        }

        var names = Array.isArray(events) ? events : Object.keys(events);

        return names.reduce(function (bag, name) {
            var handler = Array.isArray(events) ? undefined : events[name];

            bag[name] = function (payload) {
                log('events.' + name, payload);

                if (typeof handler === 'function') {
                    handler(payload);
                }
            };

            return bag;
        }, {});
    }

    /**
     * Build a `context` for a field control.
     *
     * Anything not named in `options` comes from DEFAULTS, so a caller states
     * only the state it is interested in — which is what lets an assertion in
     * `smoke.js` read as a sentence about one branch.
     */
    function createContext(options) {
        var o = Object.assign({}, DEFAULTS, options || {});

        /*
         * Every platform call the control made, in order, with its argument.
         *
         * The same shape and the same formatting as the dataset rig's, so an
         * assertion reads the same in both: `trackContainerResize(true)`,
         * `events.OnSelect()`. The array is supplied by the caller rather than
         * held here, because `createContext` is called afresh for every render
         * and a log that reset with it could not span one.
         */
        function log(name, argument) {
            if (o.calls) {
                o.calls.push(argument === undefined ? name : name + '(' + JSON.stringify(argument) + ')');
            }
        }

        var host = HOSTS[o.host] || HOSTS['model-driven'];
        var security = SECURITY[o.security];

        var getString =
            o.getString
            || function (key) {
                return STRINGS[key] !== undefined ? STRINGS[key] : key;
            };

        // The control's own inputs, wrapped the way the platform hands them
        // over. A raw `null` is a real value here — a property the maker left
        // unset — so it is passed through rather than defaulted.
        var parameters = {};

        Object.keys(o.inputs).forEach(function (name) {
            parameters[name] = { raw: o.inputs[name] };
        });

        return {
            /*
             * The literals FIRST and `parameters` second, so `options.inputs`
             * wins — which is what the `inputs` comment in DEFAULTS already
             * claims. The other order shipped, and it meant a control with its
             * own `placeholder` input could not be tested with a different
             * placeholder: the literal below silently overwrote it.
             */
            parameters: Object.assign({
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
            }, parameters),

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
                    log('trackContainerResize', value);
                },
                setFullScreen: function (value) {
                    log('setFullScreen', value);
                },

                /*
                 * `mode.setControlState` — the only way a control keeps anything
                 * of its own across a remount.
                 *
                 * The remount people forget is a **form tab switch**: moving to
                 * another tab and back destroys the control and inits a new one,
                 * so an unsaved edit, a scroll position or an expanded section
                 * is gone unless it was handed to the platform here. It comes
                 * back as `init`'s third argument, which is the parameter almost
                 * every control names `_state` and ignores.
                 *
                 * **It returns a boolean and the boolean is not decoration.**
                 * The platform refuses when it has nowhere to put the state, and
                 * a control that assumes success renders a restored view that
                 * was never saved. `stateWritable: false` reproduces the refusal.
                 *
                 * Recorded rather than stored: what regresses is *what the
                 * control chose to persist*, and the round trip is the suite's
                 * to make — mount, read the call, mount again with `state` set
                 * to what it saved. Keeping a bag here would hide the half of
                 * that contract the control is actually responsible for.
                 */
                setControlState: function (state) {
                    log('setControlState', state);

                    return o.stateWritable !== false;
                },

                allocatedWidth: o.width,
                allocatedHeight: o.height,

                /*
                 * The record this control is sitting on — undocumented, untyped,
                 * and absent by default.
                 *
                 * `ComponentFramework.Mode` does not declare this member, so
                 * reading it costs a cast; and the platform's own FAQ says code
                 * components are not given the record's identity "because they
                 * need to be supported on multiple surfaces where this
                 * information may not be available", naming bound input
                 * properties as the supported route instead. Both are real, the
                 * cast is what everybody actually writes, and only one of them
                 * survives canvas — so a control that needs identity should try
                 * this and fall back, and the default here is what makes it
                 * write the fallback.
                 */
                contextInfo: o.contextInfo || undefined,
            },

            resources: {
                getString: getString,

                /*
                 * Callback-style, not a promise — the one API on `context` that
                 * is, which is why code around it tends to be written as though
                 * it returned something and silently gets `undefined`.
                 *
                 * The failure path is the default. See `resource` in DEFAULTS.
                 */
                getResource: function (name, success, failure) {
                    log('getResource', name);

                    if (o.resource === null || o.resource === undefined) {
                        if (failure) {
                            failure();
                        }

                        return;
                    }

                    if (success) {
                        success(o.resource);
                    }
                },
            },

            /*
             * Every method rejects unless the caller supplied something for it
             * to resolve with, which is what a browser without the host's
             * native bridge does. A control that declares
             * `<uses-feature required="false">` and degrades is testable here;
             * one that assumes the call succeeds hangs on its own promise.
             *
             * **The refusals are not one refusal.** A device API can fail three
             * distinguishable ways and only one of them is an `Error`, so a
             * stub that rejected uniformly would let a control pass here with a
             * handler that throws in two of the three states a real device puts
             * it in. See `position` in DEFAULTS for what each one means.
             */
            device: !o.device ? undefined : {
                pickFile: function (pickOptions) {
                    log('pickFile', pickOptions || {});

                    return o.pickFile
                        ? Promise.resolve(o.pickFile)
                        : Promise.reject(new Error('No file picker on this host.'));
                },

                /*
                 * Resolves with **one** `FileObject`, where `pickFile` resolves
                 * with an array of them. That asymmetry is the platform's, not
                 * this file's, and it is why both are stubbed rather than one.
                 */
                captureImage: function (imageOptions) {
                    log('captureImage', imageOptions || {});

                    return o.captureImage
                        ? Promise.resolve(o.captureImage)
                        : Promise.reject(new Error('No camera on this host.'));
                },

                getBarcodeValue: function () {
                    log('getBarcodeValue');

                    return Promise.reject(new Error('No scanner on this host.'));
                },

                /*
                 * Geolocation, and its three separate refusals.
                 *
                 * The resolved shape is the one worth reading twice.
                 * `Position.timestamp` is typed `Date` by
                 * `@types/powerapps-component-framework` and documented, on the
                 * very same page, as a DOMTimeStamp — which is a **number**. The
                 * platform sends the number, so that is what this sends, and
                 * `position.timestamp.toISOString()` therefore compiles against
                 * the types and throws against the host. Handing back a real
                 * `Date` here to match the type would make this rig the only
                 * place that bug cannot be found.
                 *
                 * `coords` carries every member the interface declares, because
                 * they are all non-optional there while `altitude`, `heading`
                 * and `speed` are routinely null on a device standing still —
                 * another lie in the types, and one a control that formats them
                 * has to survive.
                 */
                getCurrentPosition: o.position === 'absent' ? undefined : function () {
                    log('getCurrentPosition');

                    if (o.position === 'denied') {
                        /*
                         * A plain object, not an `Error` — the Client API's
                         * `errorCallback` documents `code` and `message`. Note
                         * `code`, where a webAPI rejection says `errorCode`:
                         * two platform APIs, two names, and one error reader
                         * that has to know both.
                         */
                        return Promise.reject({
                            code: 1,
                            message: 'The user denied access to their location.',
                        });
                    }

                    if (o.position === 'unavailable') {
                        // Documented, and the shape nothing survives by accident.
                        return Promise.reject(null);
                    }

                    if (o.position === 'no-bridge' || !o.position) {
                        return Promise.reject(new Error('No geolocation on this host.'));
                    }

                    return Promise.resolve({
                        coords: {
                            latitude: o.position.latitude,
                            longitude: o.position.longitude,
                            accuracy: o.position.accuracy !== undefined ? o.position.accuracy : 20,
                            altitude: o.position.altitude !== undefined ? o.position.altitude : null,
                            altitudeAccuracy:
                                o.position.altitudeAccuracy !== undefined ? o.position.altitudeAccuracy : null,
                            heading: o.position.heading !== undefined ? o.position.heading : null,
                            speed: o.position.speed !== undefined ? o.position.speed : null,
                        },
                        // A number. See above.
                        timestamp: o.position.timestamp !== undefined ? o.position.timestamp : Date.now(),
                    });
                },
            },

            /*
             * The Web API, absent when the host has none.
             *
             * The same switch and the same rejection shape as the dataset rig's,
             * so an assertion reads the same in both: **a rejection is a plain
             * object carrying `errorCode` and `message`, not an `Error`.** A
             * stub that rejected with an `Error` would pass a control that
             * renders the string "[object Object]" where the platform's
             * explanation belongs.
             */
            webAPI: o.webAPI
                ? {
                    createRecord: function (entityType, data) {
                        log('webAPI.createRecord', entityType);

                        if (o.createRecord === null || o.createRecord === undefined) {
                            return Promise.reject({
                                errorCode: 2147746581,
                                message: 'The record could not be created.',
                            });
                        }

                        /*
                         * The platform resolves with an `EntityReference`, whose
                         * `id` is an **object with a `guid` on it**, not a
                         * string — so `String(reference.id)` is "[object
                         * Object]" and the id the control stored is useless.
                         * Reproduced rather than flattened, for that reason.
                         */
                        return Promise.resolve({
                            entityType: entityType,
                            id: { guid: o.createRecord },
                            name: (data && data.subject) || '',
                        });
                    },

                    updateRecord: function (entityType, id, data) {
                        log('webAPI.updateRecord', entityType + ' ' + id + ' ' + Object.keys(data || {}).join(','));

                        return o.updateRecord
                            ? Promise.resolve({ entityType: entityType, id: { guid: id }, name: '' })
                            : Promise.reject({
                                errorCode: 2147746581,
                                message: 'The record could not be updated.',
                            });
                    },

                    retrieveRecord: function (entityType, id, options) {
                        log('webAPI.retrieveRecord', entityType + ' ' + id + ' ' + (options || ''));

                        return o.retrieveRecord === null || o.retrieveRecord === undefined
                            ? Promise.reject({
                                errorCode: 2147746581,
                                message: 'The record could not be retrieved.',
                            })
                            : Promise.resolve(o.retrieveRecord);
                    },
                }
                : undefined,

            /*
             * Navigation, assembled method by method — see `buildNavigation`.
             *
             * Recorded rather than performed: there is nowhere to navigate to
             * here, and what regresses is what the control *handed over*, not
             * the platform's ability to act on it.
             */
            navigation: buildNavigation(o, log),

            /*
             * `context.utils`, absent on a host without the `Utility` feature.
             *
             * **`getEntityMetadata` resolves with a class instance, not a plain
             * object**, and this reproduces that rather than flattening it: the
             * own enumerable properties are private fields, and the public
             * members are getters on the prototype. Code that walks
             * `Object.keys` sees `_entityDescriptor` and concludes the entity
             * has no entity set, while reading `metadata.EntitySetName` by name
             * works perfectly well — because property *access* traverses the
             * prototype chain and enumeration does not.
             *
             * A flat object here would let that code pass locally and fail on a
             * form, which is the most expensive thing a stub can do.
             */
            utils: o.utils
                ? {
                    getEntityMetadata: function (entityName, attributes) {
                        log('getEntityMetadata', entityName);

                        function Metadata() {
                            // Private fields, and the only things Object.keys sees.
                            this._entityDescriptor = { EntityLogicalName: entityName };
                            // The argument is a *request*, not a result. It reads
                            // exactly like an answer, which is the trap.
                            this._attributes = attributes || [];
                        }

                        Object.defineProperty(Metadata.prototype, 'EntitySetName', {
                            get: function () {
                                return o.entitySetName;
                            },
                        });

                        Object.defineProperty(Metadata.prototype, 'PrimaryIdAttribute', {
                            get: function () {
                                return entityName + 'id';
                            },
                        });

                        return Promise.resolve(new Metadata());
                    },

                    /**
                     * **Synchronous, and returns a boolean.** The only member
                     * of this bag that is not a promise, which is easy to miss
                     * beside `getEntityMetadata` and produces a control that
                     * gates on a truthy `Promise` and therefore never gates at
                     * all.
                     *
                     * The arguments are numeric enums, not strings:
                     * `PrivilegeType` is 0 None, 1 Create, 2 Read, 3 Write,
                     * 4 Delete, 5 Assign, 6 Share, 7 Append, 8 AppendTo;
                     * `PrivilegeDepth` is -1 None, 0 Basic, 1 Local, 2 Deep,
                     * 3 Global. Both are logged so an assertion can be about
                     * which privilege the control actually asked for — passing
                     * Read where Write was meant is invisible otherwise,
                     * because almost every user has Read.
                     */
                    hasEntityPrivilege: function (entityTypeName, privilegeType, privilegeDepth) {
                        log('utils.hasEntityPrivilege', {
                            entityTypeName: entityTypeName,
                            privilegeType: privilegeType,
                            privilegeDepth: privilegeDepth,
                        });

                        return Boolean(o.hasPrivilege);
                    },
                }
                : undefined,

            /*
             * The event bag, or nothing at all.
             *
             * `undefined` is a real host: the platform types promise this
             * member unconditionally, and neither the manifest nor the
             * generated types are evidence that a name declared in the manifest
             * arrives here as a callable. A control that feature-detects passes
             * both ways; one that does not fails on the host it was never run
             * on.
             *
             * **Two shapes, and the second one is the point.** An array of
             * names binds each to a logger, which is all a canvas-shaped event
             * needs — there is no Power Fx here to run. An object of
             * `name -> function` binds the caller's own handler *as well as*
             * the logger, which is what a model-driven event needs, because
             * `addEventHandler` hands the handler a payload and the payload can
             * carry callbacks the handler calls straight back into the control.
             * A rig that could only log could never exercise the half of that
             * contract the control implements.
             *
             * The handler runs **after** the log entry, so `calls` records the
             * raise in the order it happened even when the handler re-enters
             * the control.
             */
            events: buildEvents(o.events, log),

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
                    return o.offline;
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

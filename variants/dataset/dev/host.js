/*
 * The platform, stood in for: a working `DataSet` with real paging, real
 * sorting and real filtering, plus the switches for the ways a real one
 * misbehaves.
 *
 * Loaded by both `harness.html` in a browser and `smoke.js` in Node, which is
 * why it attaches to `window` *and* assigns `module.exports` and requires
 * neither to exist.
 *
 * ---
 *
 * **Why this exists.** Every dataset control in the catalogue is published at
 * `demo.fidelity: "limited"` for the same reason: the hub's harness seeds a
 * single page, reports no next or previous page, and discards sorting between
 * renders. `npm start` is not much better — it will bind a CSV, but it will not
 * put the control on page three of a sorted view and then change the page size
 * underneath it.
 *
 * So the paging and sorting code in a dataset control — which is most of the
 * hard code in a dataset control — has never been exercised by anything before
 * this file. It ships with twelve records and a page size of five for exactly
 * that reason: three pages is the smallest number that tells you whether page
 * two came from the platform or from a slice.
 *
 * Filtering is thinner still everywhere else: the hub's harness and `npm start`
 * both accept a `setFilter` call and discard it, so a filtered view is one of
 * the few things a control can get *completely* wrong and still demo. Here the
 * expression is applied, the counts follow it, and forgetting the `refresh()`
 * afterwards shows up as a set of rows that did not change.
 *
 * ---
 *
 * **The `quirks` switches are the point, not a curiosity.**
 *
 * The scaffolded control carries three repairs for behaviour observed on a real
 * model-driven form, and each one looks like superstition until you can turn
 * the behaviour on:
 *
 *   - `loadNextPage(true)` **ignores its argument** and hands back the whole
 *     range from page one, so `sortedRecordIds` accumulates instead of
 *     replacing. This is why the control slices.
 *   - `hasPreviousPage` **stays false** after paging forward, so a pager driven
 *     by it can never go back. This is why the control counts pages itself.
 *   - `firstPageNumber` **disagrees with the ids**, which is how a range like
 *     "4–9 of 6" gets printed. This is why the label is built from the
 *     control's own counter.
 *
 * Default them to the observed behaviour, not the documented one. A harness
 * that models the platform as it is written down will pass a control that
 * cannot page on a real form — which is the exact failure these switches exist
 * to prevent.
 *
 * ---
 *
 * **A stub must never be more capable than the thing it stands in for.**
 * `refresh()` here does not re-render; it records that a render is owed, and
 * the driver decides when to run it. That is deliberate. A `refresh()` that
 * re-entered `updateView` immediately would hide the loop a guarded mutator
 * exists to prevent, and would make an infinite one look like a hang instead of
 * a count.
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

    /** `SortDirection` is a numeric union: 0 ascending, 1 descending. */
    var ASCENDING = 0;
    var DESCENDING = 1;

    /**
     * `FilterOperator`, which combines the conditions of one expression.
     *
     * 0 And, 1 Or — and the default matters: an expression that omits
     * `filterOperator` is `And`, so a search that meant "this term in any of
     * four columns" and forgot to say `Or` matches nothing and looks like a
     * broken query rather than a missing field.
     */
    var AND = 0;
    var OR = 1;

    /**
     * The `ConditionOperator` values this stand-in honours, out of the ~90 the
     * platform defines.
     *
     * These are the ones a control can use on **both** hosts. The rest of the
     * enum is where the hosts disagree, and the disagreement is not symmetric:
     * `NotLike` (7) and `NotNull` (13) are canvas-only, while `Yesterday` (14),
     * `Today` (15) and `Tomorrow` (16) are model-driven-only. A control that
     * reaches past this object is choosing a host, and should say so in
     * `docs/limitations.md`.
     *
     * `GreaterEqual` (4) and `LessEqual` (5) were missing here while being in
     * the both-host list, which is worse than an omission: an unhonoured
     * operator *passes* by the rule below, so a `>=` filter looked filtered
     * while filtering nothing.
     *
     * `On` (25), `OnOrBefore` (26) and `OnOrAfter` (27) are past the
     * both-host set and are here because `pcf-data-table` 0.4.0 sends them.
     * Measured on a model-driven subgrid 2026-09-11 with `value:
     * 'yyyy-MM-dd'`: all three narrow, `dataset.error` stays false, and the
     * day is compared in the **user's** zone, not UTC — a record stamped
     * 04:30Z came back for `On` the previous day, because that is 11:30 PM
     * where the user sits. `holds()` models exactly that. Canvas has not
     * been asked; a control sending these there is choosing a host.
     */
    var OPERATOR = {
        Equal: 0,
        NotEqual: 1,
        GreaterThan: 2,
        LessThan: 3,
        GreaterEqual: 4,
        LessEqual: 5,
        Like: 6,
        In: 8,
        Null: 12,
        NotNull: 13,
        On: 25,
        OnOrBefore: 26,
        OnOrAfter: 27,
    };

    /**
     * `dateFormattingInfo` as an en-US tenant publishes it. Every key is
     * present on a real tenant under both Pascal and camel spellings; the
     * camel ones are what the typings name and what a control should read.
     */
    var DATE_FORMATTING = {
        amDesignator: 'AM',
        pmDesignator: 'PM',
        dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        abbreviatedDayNames: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        shortestDayNames: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
        monthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', ''],
        abbreviatedMonthNames: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', ''],
        firstDayOfWeek: 0,
        shortDatePattern: 'M/d/yyyy',
        longDatePattern: 'dddd, MMMM d, yyyy',
        shortTimePattern: 'h:mm tt',
        longTimePattern: 'h:mm:ss tt',
        dateSeparator: '/',
        timeSeparator: ':',
    };

    /**
     * `context.userSettings`, with the two members a date control reads.
     *
     * **`getTimeZoneOffsetMinutes()` without a date answers the *standard*
     * offset**, measured on a form (`pcf-date-range-picker`, 2026-09): `-360`
     * on a day the dated call answered `-300`. The rig reproduces that with an
     * hour's difference whenever a zone is set — and with the browser zone's
     * own standard offset when none is — so a control that drops the argument
     * is caught by any day in daylight time, which is most of them.
     */
    function buildUserSettings(o, log) {
        var zone = o.userTimeZoneOffset;

        return {
            isRTL: o.rtl,
            languageId: 1033,
            getTimeZoneOffsetMinutes: function (date) {
                // Logged, because the call is not free on every tenant: a zone with no
                // DST rule on file for the year logs a platform error per call, so a
                // suite can assert a control asks once per day rather than per event.
                if (log) {
                    log('userSettings.getTimeZoneOffsetMinutes', date instanceof Date ? 'dated' : 'bare');
                }

                if (typeof zone === 'number') {
                    return date instanceof Date ? zone : zone - 60;
                }

                if (date instanceof Date) {
                    return -date.getTimezoneOffset();
                }

                // The standard offset is the one further from UTC across the year.
                var year = new Date().getFullYear();

                return -Math.max(new Date(year, 0, 1).getTimezoneOffset(), new Date(year, 6, 1).getTimezoneOffset());
            },
            dateFormattingInfo: o.dateFormattingInfo === false
                ? undefined
                : Object.assign({}, DATE_FORMATTING, o.dateFormattingInfo || {}),
            numberFormattingInfo: { numberDecimalSeparator: '.', numberGroupSeparator: ',' },
        };
    }

    var STRINGS = {
        __CONTROL___Name: '__TITLE__',
        __CONTROL___Empty: 'No records.',
        __CONTROL___Error: 'The records could not be loaded.',
        __CONTROL___Loading: 'Loading…',
        __CONTROL___NoColumns: 'No columns have been chosen for this control.',
        __CONTROL___Next: 'Next',
        __CONTROL___Previous: 'Previous',
        __CONTROL___OpenRecord: 'Open {0}',
        __CONTROL___SortBy: 'Sort by {0}',
        __CONTROL___PageStatus: 'Page {0}',
        __CONTROL___RangeStatus: '{0}–{1} of {2}',
    };

    var HOSTS = {
        'model-driven': { label: 'model-driven form', publishesTheme: true },
        canvas: { label: 'canvas app', publishesTheme: false },
    };

    /**
     * `context.client.getFormFactor()`, which is a number and not the one most
     * people guess.
     *
     * **0 Unknown, 1 Desktop, 2 Tablet, 3 Phone.** Web is `1`, and `3` — the
     * value that looks like it ought to mean "the big one" — is a phone. A
     * dataset control that drops columns on a narrow client is comparing
     * against one of these, and comparing against the wrong one drops them
     * everywhere except where it meant to.
     */
    var FORM_FACTORS = { unknown: 0, desktop: 1, tablet: 2, phone: 3 };

    var DEFAULTS = {
        host: 'model-driven',
        formFactor: 'desktop',
        /**
         * `mode.allocatedWidth` / `allocatedHeight`.
         *
         * **-1 until the control calls `mode.trackContainerResize(true)`**, and
         * that is the default here because it is the platform's. A table that
         * decides its column widths from a width it never asked for lays out
         * against -1 on every host.
         */
        width: -1,
        height: -1,
        /**
         * The size the **platform** is paging at, which is what
         * `paging.pageSize` reports — a main grid's *Rows per page*, a
         * subgrid's form-designer setting.
         *
         * Not the control's `pageSize` input; that is `inputs.pageSize` and it
         * defaults to unset. See `createContext`.
         */
        pageSize: 5,
        visible: true,
        /** `mode.isControlDisabled` — a read-only form, or a canvas DisplayMode. */
        disabled: false,
        dark: undefined,
        /**
         * `fluentDesignLanguage.tokenTheme` — the Fluent theme object a
         * model-driven host hands a virtual control to put on its own
         * `FluentProvider`. Undefined by default, which is what the hub's
         * demo harness and `npm start` publish; a page that wants the
         * control drawn in a theme passes one (the harness passes
         * `fluent-stub.js`'s `webDarkTheme` under `?dark=1`).
         */
        tokenTheme: undefined,
        rtl: false,
        /**
         * The Dataverse user's time zone, as `userSettings.getTimeZoneOffsetMinutes`
         * answers it: minutes *ahead* of UTC in the platform's sign — `-300`
         * for UTC-5, the opposite of `Date.prototype.getTimezoneOffset`.
         *
         * `null` is the browser's own zone, which is what nearly every host
         * has: the user set their personal options where they sit. A number
         * is the state only this rig reaches — a user whose Dataverse zone is
         * not the machine's. A calendar shows one day per event, and a
         * control reading the browser's zone puts an evening appointment on
         * the wrong day for that user without anything failing.
         */
        userTimeZoneOffset: null,
        /**
         * `userSettings.dateFormattingInfo` — the names and patterns a date
         * control draws from. `{}` is the en-US shape below; an object here is
         * merged over it (`{ firstDayOfWeek: 1, shortTimePattern: 'HH:mm' }`
         * is a European user); `false` withholds the bag entirely, which is
         * what the hub's demo harness does.
         */
        dateFormattingInfo: {},
        /** No records yet, which is the state of the first `updateView`. */
        loading: false,
        error: false,
        errorMessage: 'The records could not be loaded.',
        /** Replace with `[]` to see the empty state, or with a subset. */
        records: null,
        columns: null,

        /**
         * The control's own input properties, merged into `parameters`.
         *
         * The scaffolded control has only `pageSize`, and every real one grows
         * more. Pass them as raw values — `{ selectionMode: 'multiple' }` — and
         * they arrive as `{ raw: … }` where the control expects them.
         *
         * Passing them rather than editing this file is what keeps a repo's
         * copy of the rig close enough to the template's to update by copying.
         */
        inputs: {},

        /**
         * Whether `context.webAPI` exists at all.
         *
         * Absent is a real host and it is the reason a control declares
         * `<uses-feature required="false">`: WebAPI is Dataverse-dependent and is
         * not available in canvas apps, so a control that reaches for it
         * unguarded works everywhere it was tested and nowhere else.
         */
        webAPI: true,

        /**
         * Whether `context.navigation.openFile` exists.
         *
         * Separate from `webAPI` because it is absent for a different reason:
         * `openFile` is documented model-driven apps only, while
         * `context.navigation` itself is present either way. A control that
         * checks the bag rather than the method passes on a host that cannot
         * open a file.
         */
        openFile: true,

        /**
         * Whether `context.navigation` exists at all.
         *
         * Typed non-optional, which is a claim about the type definitions
         * rather than about the host — the same claim `loadExactPage` and
         * `setFullScreen` make, and the reason both have a switch. A control
         * that reads `context.navigation.openForm` through an unguarded bag
         * throws a TypeError rather than degrading, and a rig that cannot
         * remove the bag cannot tell the two apart.
         */
        hasNavigation: true,

        /**
         * What `navigation.openForm` resolves with.
         *
         * Measured 2026-09-11 on a quick create form opened with
         * `useQuickCreateForm: true`: **Save** resolves `{
         * savedEntityReference: [{ id: "{436E09A8-…}", entityType, name }] }`
         * — the GUID braced and upper-case, unlike anything `getValue` or
         * `contextInfo` return — and **dismissing the form resolves `{
         * savedEntityReference: null }`**, not `[]` and not a rejection. The
         * dismissal is the default here because it is the branch a control
         * forgets, and `null` rather than `[]` because a reader written as
         * `saved[0]` throws on it. An ordinary (non-quick-create) form
         * resolves with an empty array.
         */
        openFormReturns: { savedEntityReference: null },

        /**
         * `mode.contextInfo` — the record a form subgrid sits on, or `null`
         * for a main grid, which has none. Untyped on the platform; measured
         * on a form subgrid 2026-09-11 as `{ entityTypeName: 'account',
         * entityId: '85f6…', entityRecordName: '…' }`, the GUID unbraced. A
         * control passes it to `openForm` as `createFromEntity` so a
         * quick-created row lands in the subgrid it was asked for from.
         */
        contextInfo: null,

        /**
         * Whether `context.utils` exists at all.
         *
         * It does not on canvas, whatever the manifest declares, and a
         * model-driven host may leave it out when the `Utility` feature is
         * declared `required="false"`. Forced absent under `host: 'canvas'`
         * however this is set, so a control cannot be told it is on canvas
         * and then handed a metadata call canvas does not have.
         */
        utils: true,

        /**
         * Whether the writes — `webAPI.createRecord`, `updateRecord`,
         * `deleteRecord` — and `retrieveMultipleRecords` reject.
         *
         * A write is the one place a rejection is not an edge case: a delete
         * fails on a cascade restriction, a create on a missing privilege or
         * an attachment over the organisation's ceiling, and all of those are
         * ordinary. The rejection is a plain object carrying `errorCode` and
         * `message`, never an `Error` — see the note on `retrieveRecord`
         * below. One switch for all of them, because a suite that needs the
         * delete to succeed while the create fails is a suite for two
         * controls.
         */
        webApiFails: false,

        /**
         * A `FilterExpression` the **host** holds on the view, which the
         * control never set: a subgrid's relationship to its parent record,
         * a quick-find the user typed into the grid's own box. It narrows the
         * rows the dataset shows and — the part that matters to a control
         * re-deriving the view's records — comes back from
         * `filtering.getFilter()` merged with whatever the control set.
         * Whether a real subgrid reports its relationship this way is
         * **unmeasured** (pcf-chart-view SPEC.md P2); `null` models the host
         * that does not, which is the host every control must survive.
         */
        hostFilter: null,

        /**
         * What `getViewId()` answers. `undefined` is the fixture's own id;
         * `null` is the measured answer on a bound lookup's dataset
         * (pcf-hierarchy-view, 2026-09-17), against typings that say `string`.
         */
        viewId: undefined,

        /**
         * Whether `retrieveRecord('savedquery' | 'userquery', id)` answers.
         * `false` refuses both the way a record the user cannot read is
         * refused — a personal view belonging to somebody else.
         */
        viewsReadable: true,

        /**
         * The most rows an aggregate FetchXML may cover before the server
         * refuses with `AggregateQueryRecordLimit exceeded` (0x8004E023;
         * 50,000 on a standard environment). Set it low to reach the
         * refusal on a twelve-row fixture. The refusal's exact shape is
         * **unmeasured** (pcf-chart-view SPEC.md P7); the rig uses the
         * documented code and the fault shape every other refusal has.
         */
        aggregateLimit: 50000,

        /** Whether every aggregate FetchXML is refused, whatever it covers. */
        aggregateRefused: false,

        /**
         * Whether `context.page` exists. Its `getClientUrl()` is how a control
         * finds the organisation for a same-origin metadata `fetch` — the only
         * way to reach `EntityDefinitions`, which `context.webAPI` cannot
         * address. Not in the typings; absent on canvas and here under `false`.
         */
        page: true,

        /**
         * Whether `utils.lookupObjects` exists while `utils` itself does. A
         * host can withhold the dialog on its own, so a control detects the
         * method and not the bag.
         */
        lookupObjects: true,

        /**
         * What `utils.lookupObjects` resolves with. Measured 2026-09-11: a
         * pick is `[{ id: "{8FE84297-…}", entityType, name }]` — an array,
         * GUID **braced and upper-case**, the opposite of what `getValue`
         * reports — and a **cancel resolves `[]`**, not `undefined` and not a
         * rejection. The default is the cancel, because that is the branch a
         * control forgets. Pass `{ id, entityType, name }` for a pick; the rig
         * braces and upper-cases the id itself.
         */
        lookupPick: null,

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
         *                  different state from refusal — it is the state
         *                  `<uses-feature required="false">` is actually about
         *                  — and `pcf-geo-stamp` found that out the hard way on
         *                  the device APIs.
         */
        dialogs: 'confirmed',

        quirks: {
            /**
             * `loadNextPage(true)` returns the whole range from page one rather
             * than only the new page. Observed on a real form; defaulted on
             * because that is what a real form does.
             */
            accumulatePages: true,
            /** `hasPreviousPage` never becomes true. Observed on a real form. */
            previousPageStuck: true,
            /** `totalResultCount` is -1 — common on large views. */
            uncounted: false,
            /**
             * Whether `paging.loadExactPage` exists at all. It is typed as
             * required, which is a claim about the type definitions rather than
             * about the host, so a control that calls it unguarded is worth
             * being able to break here.
             */
            hasLoadExactPage: true,

            /**
             * Whether `dataset.addColumn` exists at all.
             *
             * Typed optional in @types/powerapps-component-framework, which is
             * the rare case of the type definitions being honest — so a control
             * that calls it unguarded is worth being able to break here.
             */
            hasAddColumn: true,

            /**
             * Whether `mode.setFullScreen` exists at all. The same claim as
             * `loadExactPage` makes: typed as always present, which is a
             * statement about the type definitions rather than about the host,
             * so a control that calls it unguarded is worth being able to break
             * here. Canvas is the known case.
             */
            hasFullScreen: true,

            /**
             * Whether `dataset.sorting` exists at all.
             *
             * **This one is not hypothetical, and it is not the platform — it
             * is `npm start`.** The local test harness's dataset mock sets
             * `sorting: undefined`, so `dataset.sorting.find(...)` throws a
             * TypeError that the harness swallows: the control renders as an
             * empty box with nothing in the console. A freshly scaffolded
             * dataset control did exactly that until this switch existed to
             * catch it.
             *
             * Off by default because a real form supplies the array — the
             * default models the platform, and the assertion in `smoke.js`
             * covers the one host known to deviate.
             */
            sortingAbsent: false,

            /**
             * `mode.allocatedHeight` stays -1 however the host is sized, and
             * however politely the control asks.
             *
             * **This is a main grid, and it is by design rather than a
             * timing problem.** A control on a table's main grid is handed a
             * measured *width* and never a height: `trackContainerResize(true)`
             * changes the width and leaves the height at -1 for the life of the
             * control. So the shape a suite has to be able to build is one
             * axis answered and the other permanently not — which two plain
             * `width`/`height` options can express only by coincidence, and
             * which nothing in this rig previously named.
             *
             * It matters because "-1 means the host has not measured *yet*" is
             * the natural reading, and a control that waits for a positive
             * number waits forever. `pcf-row-commands` gated its scroll layout
             * on a measured height and ran twenty-five rows off the bottom of a
             * main grid, taking the pager — the only route to page two — with
             * them. The fix was to stop waiting: apply the layout always and
             * let the measurement decide only whether the height is a pixel
             * number or inherited from the stylesheet.
             *
             * Off by default, because a form subgrid does measure both.
             */
            heightUnmeasured: false,

            /**
             * Whether `dataset.filtering` exists at all.
             *
             * Same shape of risk as `sortingAbsent`, one step less certain: the
             * type definitions declare `filtering` as always present, and a
             * control that calls `dataset.filtering.setFilter(...)` without
             * checking has taken the types at their word. Turn this on to find
             * out what that costs before a host does it for you.
             *
             * Off by default, because a real form supplies it.
             */
            filteringAbsent: false,

            /**
             * Whether the record carries the write half of `EntityRecord` at
             * all — `setValue`, `save`, `isDirty`, `isEditable`.
             *
             * Off by default, because a real model-driven subgrid has them:
             * measured 2026-09-09, and again 2026-09-11 for a Choice column.
             * On, it models the host that does not, which a control has to
             * survive by offering no editors rather than by offering ones
             * that discard what is typed. None of these methods is in the
             * typings, so "the host has them" is a claim about a measurement
             * rather than about a contract.
             */
            editableAbsent: false,

            /** `save()` rejects. The path a rollback exists for. */
            saveRejects: false,

            /**
             * Columns `isEditable` answers `false` for.
             *
             * Not hypothetical: on the measured subgrid `statecode` and
             * `statuscode` came back `false` while a Choice column on the
             * same row came back `true` — and all three report the same
             * `dataType`, `OptionSet`. Editability is per column *and* per
             * record, invisible on `Column`, and a control that inferred it
             * from the type would offer an editor over exactly this case.
             */
            readOnlyColumns: ['statecode'],

            /** `utils.getEntityMetadata` rejects — a table the user cannot read, a network fault. */
            metadataRejects: false,

            /** `getEntityMetadata(table).EntitySetName` answers `undefined` — a table the fixture does not know. */
            entitySetAbsent: false,

            /** The HTTP status the relationships `fetch` answers with; anything but 200 is a refusal. */
            relationshipsStatus: 200,
        },
    };

    /**
     * The organisation `page.getClientUrl()` answers — **one per host**, so
     * the single global `fetch` can route a metadata read to the host whose
     * context made it. A host, not a path.
     *
     * Installed per host, the stub belonged to whichever host a suite created
     * *last*: it answered another host's read from the wrong fixture and
     * logged it on the wrong call list. Found by a suite that bound five views
     * and then dropped a file on the first — the create succeeded and the
     * assertion that two fetches had been made found none.
     */
    var hostsByUrl = {};
    var hostCount = 0;

    function clientUrlFor(index) {
        return 'https://rig' + (index === 1 ? '' : index) + '.crm.invalid';
    }

    /**
     * The `message` of a payload fault, verbatim from a probe (`pcf-data-table`
     * 0.4.2, 2026-09-13) up to the first line of the stack trace — the shape a
     * control has to find one readable sentence in. The useful part sits
     * after the second `InnerException :` and before `\r\n`.
     */
    var PAYLOAD_FAULT =
        "Error identified in Payload provided by the user for Entity :'', For more information on "
        + 'this error please follow this help link https://go.microsoft.com/fwlink/?linkid=%5BPlaceholderString-22%5D'
        + '  ---->  InnerException : Microsoft.OData.ODataException: An undeclared property '
        + "'cll_PrimaryContact' which only has property annotations in the payload but no property "
        + 'value was found in the payload. In OData, only declared navigation properties and declared '
        + 'named streams can be represented as properties without values.\r\n   at '
        + 'Microsoft.OData.JsonLight.ODataJsonLightResourceDeserializer.ReadUndeclaredProperty(…)';

    /**
     * A `webAPI` rejection in the measured shape: `{ errorCode, message,
     * code, title, raw }`, a plain object and **not an `Error`**. `title` is
     * `''` on a payload fault and a phrase on a server fault ("Record Is
     * Unavailable").
     */
    function webApiFault(code, title, message) {
        return {
            errorCode: code,
            message: message,
            code: code,
            title: title,
            raw: JSON.stringify({ errorCode: code, message: message, title: title }),
        };
    }

    function formatted(value) {
        return value === null || value === undefined ? '' : String(value);
    }

    /**
     * Build the dataset and the context around it.
     *
     * The returned handle carries the engine's own view of the world —
     * `refreshes`, `calls`, the true page — so an assertion can be about what
     * the control *asked the platform to do*, which is the half that a rendered
     * table never shows.
     */
    function createHost(fixture, options) {
        var o = Object.assign({}, DEFAULTS, options || {});
        var CLIENT_URL = clientUrlFor((hostCount += 1));
        var quirks = Object.assign({}, DEFAULTS.quirks, (options || {}).quirks);
        var hostKind = HOSTS[o.host] || HOSTS['model-driven'];

        /*
         * **Each host gets its own row objects, not just its own array.**
         * `concat` below keeps the fixture's *array* unmutated across binds,
         * and for a long time that looked like enough. It is not:
         * `record.save()` commits into the row and `reread()` writes the
         * commit into `row.values` — the same object every later host reads
         * its records from. `pcf-kanban-board` found it the hard way: one
         * suite moved a card to lane 3, and every host created after it
         * started with that card already in lane 3, so "move it to 3" became
         * a no-op that passed as "a refused write put it back". Seven
         * assertions failed in a pattern that pointed at the control.
         *
         * Copied one level deep, which is as deep as a fixture row goes.
         * `staged` and `committed` are reset for the same reason: a row
         * that arrives mid-save from another host is a host that never
         * existed.
         */
        var allRecords = (o.records || fixture.records).map(function (row) {
            return Object.assign({}, row, { values: Object.assign({}, row.values), staged: null, committed: null });
        });
        var columns = (o.columns || fixture.columns).slice();

        /*
         * By logical name, because `getValue` and `getFormattedValue` shape
         * a value by its column's type — a choice's integer becomes a string
         * on read and a label on display. Read from the live `columns` so a
         * column `addColumn` brings in later is typed too.
         */
        var types = {};

        function typeOf(name) {
            if (!Object.prototype.hasOwnProperty.call(types, name)) {
                var column = columns.filter(function (candidate) {
                    return candidate.name === name;
                })[0];

                types[name] = column ? column.dataType || '' : '';
            }

            return types[name];
        }

        /**
         * Logical names handed to `addColumn` and not yet fetched.
         *
         * Requested rather than added, because that is what the platform does:
         * the column appears in the *next* result, not in the call. A stub that
         * added it synchronously would pass a control that never refreshed.
         */
        var requestedColumns = [];

        var state = {
            /** The page the platform believes it is on. */
            page: 1,
            /**
             * The page size actually in force, which is not the one most
             * recently requested — `setPageSize` does nothing until the next
             * fetch, and that gap is where a mutator loop lives.
             */
            pageSize: o.pageSize,
            requestedPageSize: o.pageSize,
            refreshes: 0,
            /** Every row `webAPI.createRecord` made, fetched or not, in order. */
            created: [],
            renderOwed: false,
            /** Every mutator the control called, in order, with its argument. */
            calls: [],
            /** Inputs `setInput` changed since the last context — what the next `updatedProperties` names. */
            changedInputs: [],
        };

        var sorting = [];

        /**
         * The selected ids, held rather than counted.
         *
         * This used to be a hardcoded `[]` with a `setSelectedRecordIds` that
         * logged only `ids.length`, which meant a control could set a selection
         * and read back nothing — so "selects the row it just acted on" was
         * unassertable and every control that tried looked correct while doing
         * nothing. The platform keeps the ids; so does this.
         */
        var selected = [];

        /**
         * The expression the control last set, and the one the data actually
         * reflects — which are not the same thing between a `setFilter` and the
         * `refresh()` that follows it.
         *
         * Two variables for the same reason `pageSize` and `requestedPageSize`
         * are two: filtering is server-side, so setting one changes nothing
         * until a fetch. **A control that calls `setFilter` and forgets
         * `refresh()` must see its rows stay exactly as they were**, because
         * that is what a real host does and it is the single easiest thing to
         * get wrong — a stub that filtered on `setFilter` alone would pass a
         * control that never refreshes.
         *
         * Once applied, the filter is the *server's* result set: the record
         * map, `totalResultCount` and `hasNextPage` all follow it. The reason a
         * control's pager breaks under a filter is almost always a total that
         * did not.
         */
        var requestedFilter = null;
        var filter = null;

        /**
         * Records deleted on the server, and records the client knows are gone.
         *
         * Two lists for the same reason `pageSize` and `requestedPageSize` are
         * two: a delete is a round trip, and the row does not leave the data
         * this control is holding until the next fetch. `deleteRecord` adds to
         * the pending list and `fetched()` moves it across — so **a control
         * that deletes and forgets `dataset.refresh()` sees the row still on
         * screen**, which is what a real form does and the single easiest thing
         * to get wrong. A stub that removed the row on the call would pass that
         * control.
         */
        var removedPending = [];
        var removed = [];

        /**
         * Records created on the server and not yet fetched — the same split
         * as `removedPending`, from the other direction. `createRecord`
         * resolves with the new id, and the row is *not* in the dataset until
         * `fetched()` moves it across, so a control that creates and forgets
         * `dataset.refresh()` sees a list one row short — which is what a real
         * form does. Only rows created on the bound table arrive at all: a
         * Note created from a control bound to something else lands in a
         * different subgrid.
         */
        var createdPending = [];
        var createdCount = 0;

        function log(name, argument) {
            state.calls.push(argument === undefined ? name : name + '(' + JSON.stringify(argument) + ')');
        }

        /*
         * **The metadata read a control cannot make through `context.webAPI`.**
         * `EntityDefinitions` is reachable only by a same-origin `fetch` of the
         * organisation URL, so the rig answers that URL and delegates every
         * other one to whatever `fetch` was there before. Installed per host
         * rather than once, so `relationshipsStatus` is the quirk of the host
         * under test. Two shapes are answered:
         *
         *   `EntityDefinitions(LogicalName='x')/ManyToOneRelationships` — from
         *   `fixture.relationships`, the way `pcf-data-table` reads a lookup's
         *   navigation property.
         *
         *   `EntityDefinitions(LogicalName='x')?$select=EntitySetName` — from
         *   `fixture.entitySets` (`{ account: 'accounts' }`), which is how a
         *   control builds a `/<set>(<id>)` bind value **without declaring
         *   the `Utility` feature** for `getEntityMetadata`. A table the
         *   fixture does not know answers 404, the way the server answers an
         *   unknown logical name; `entitySetAbsent` answers 200 with the
         *   property missing, the same shape `getEntityMetadata` gives under
         *   that quirk.
         */
        (function installFetch() {
            var scope = typeof globalThis !== 'undefined' ? globalThis : root;
            var prefix = CLIENT_URL + "/api/data/v9.2/EntityDefinitions(LogicalName='";

            function reply(status, body) {
                return Promise.resolve({
                    ok: status >= 200 && status < 300,
                    status: status,
                    json: function () {
                        return Promise.resolve(body);
                    },
                    text: function () {
                        return Promise.resolve(JSON.stringify(body));
                    },
                });
            }

            hostsByUrl[CLIENT_URL] = function (url, init) {
                var address = String(url);

                if (address.indexOf(prefix) !== 0) {
                    return Promise.reject(new Error('No fetch for ' + address));
                }

                log('fetch', address.slice(CLIENT_URL.length));

                var definition = address.slice(prefix.length).match(/^([a-z0-9_]+)'\)(\?\$select=EntitySetName)?$/i);

                if (definition) {
                    var set = (fixture.entitySets || {})[definition[1]];

                    if (set === undefined) {
                        return reply(404, {
                            error: {
                                code: '0x80060888',
                                message: "Could not find a property named '" + definition[1] + "'.",
                            },
                        });
                    }

                    return reply(200, quirks.entitySetAbsent
                        ? { LogicalName: definition[1] }
                        : { LogicalName: definition[1], EntitySetName: set });
                }

                var status = quirks.relationshipsStatus;
                var body = status === 200
                    ? {
                        value: (fixture.relationships || []).map(function (row) {
                            return {
                                ReferencingAttribute: row.column,
                                ReferencedEntity: row.target,
                                ReferencingEntityNavigationPropertyName: row.navigationProperty,
                            };
                        }),
                    }
                    : { error: { code: '0x80040220', message: 'Refused by the rig.' } };

                return reply(status, body);
            };

            if (!scope.__pcfHostFetch) {
                var previous = scope.fetch;

                scope.__pcfHostFetch = function (url, init) {
                    var address = String(url);
                    var origin = Object.keys(hostsByUrl).filter(function (candidate) {
                        return address.indexOf(candidate + '/') === 0;
                    })[0];

                    if (origin) {
                        return hostsByUrl[origin](url, init);
                    }

                    return previous
                        ? previous.call(scope, url, init)
                        : Promise.reject(new Error('No fetch for ' + address));
                };
                scope.fetch = scope.__pcfHostFetch;
            }
        })();

        /**
         * One `ConditionExpression` against one row.
         *
         * `Like` takes SQL wildcards rather than a substring — `dana%` is a
         * prefix match and `%dana%` a contains — and is case-insensitive, which
         * is Dataverse's default collation. A control that lowercases the term
         * itself and expects an exact match here is testing something the
         * server does not do.
         */
        function holds(row, condition) {
            var actual = row.values[condition.attributeName];

            // A lookup cell is an EntityReference; a condition on it names the GUID.
            if (actual && typeof actual === 'object' && actual.id && typeof actual.id.guid === 'string') {
                actual = actual.id.guid;
            }

            var left = formatted(actual).toLowerCase().replace(/[{}]/g, '');
            var right = formatted(condition.value).toLowerCase().replace(/[{}]/g, '');

            switch (condition.conditionOperator) {
                case OPERATOR.Equal:
                    return left === right;
                case OPERATOR.NotEqual:
                    return left !== right;
                case OPERATOR.NotNull:
                    return !(actual === null || actual === undefined || actual === '');
                case OPERATOR.In:
                    return (Array.isArray(condition.value) ? condition.value : [condition.value]).some(function (candidate) {
                        return formatted(candidate).toLowerCase().replace(/[{}]/g, '') === left;
                    });
                case OPERATOR.GreaterThan:
                    return Number(actual) > Number(condition.value);
                case OPERATOR.LessThan:
                    return Number(actual) < Number(condition.value);
                case OPERATOR.GreaterEqual:
                    return Number(actual) >= Number(condition.value);
                case OPERATOR.LessEqual:
                    return Number(actual) <= Number(condition.value);
                case OPERATOR.Null:
                    return actual === null || actual === undefined || actual === '';
                case OPERATOR.Like:
                    return likePattern(right).test(left);
                /*
                 * Whole days, compared as `yyyy-MM-dd` in the *local* zone —
                 * the platform's behaviour with the user's zone standing in
                 * for the machine's. An empty cell matches nothing under any
                 * of the three, as it does on the server.
                 */
                case OPERATOR.On:
                    return dayOf(actual) !== null && dayOf(actual) === dayOf(condition.value);
                case OPERATOR.OnOrBefore:
                    return dayOf(actual) !== null && dayOf(actual) <= dayOf(condition.value);
                case OPERATOR.OnOrAfter:
                    return dayOf(actual) !== null && dayOf(actual) >= dayOf(condition.value);
                default:
                    /*
                     * Unhonoured operators pass rather than fail, so an
                     * assertion about a filter this file cannot model reads as
                     * "no filtering happened" instead of "everything vanished".
                     * The second is indistinguishable from a control that
                     * filtered its own rows away.
                     *
                     * **That default is also how a filter that filtered
                     * nothing got certified.** Before the three date operators
                     * were modelled above, a control sending them passed every
                     * row through here and read as "working" to any assertion
                     * that counted rows. An operator a control sends has to be
                     * in this switch, or the rig is more generous than the
                     * platform — the failure this whole file exists to prevent.
                     */
                    return true;
            }
        }

        /**
         * A value's calendar day as `yyyy-MM-dd`, or `null` for no value.
         *
         * A date-only string is already a day and is taken as one — parsing
         * it through `Date` would make it UTC midnight and shift it west of
         * Greenwich, the bug `pcf-date-range-picker` paid for three times.
         * Anything else is a timestamp, and its day is the local one.
         */
        function dayOf(value) {
            if (value === null || value === undefined || value === '') {
                return null;
            }

            var text = String(value);

            // A bare day, or a day at UTC midnight — which is how a DateOnly
            // column hands its day over. Either is the day as written.
            if (/^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/.test(text)) {
                return text.slice(0, 10);
            }

            var date = value instanceof Date ? value : new Date(text);

            if (isNaN(date.getTime())) {
                return null;
            }

            /*
             * The platform compares an instant by the calendar day in the
             * **user's** zone (measured, `pcf-data-table` 2026-09-11: a record
             * at 04:30Z matched `On` the previous day for a UTC-5 user). So
             * when the rig has a user zone the day is read there, and only
             * otherwise in the machine's — which is the same thing on every
             * host whose user sits where the browser does.
             */
            if (typeof o.userTimeZoneOffset === 'number') {
                var shifted = new Date(date.getTime() + o.userTimeZoneOffset * 60000);
                var uMonth = String(shifted.getUTCMonth() + 1);
                var uDay = String(shifted.getUTCDate());

                return shifted.getUTCFullYear() + '-' + (uMonth.length < 2 ? '0' + uMonth : uMonth) + '-' + (uDay.length < 2 ? '0' + uDay : uDay);
            }

            var month = String(date.getMonth() + 1);
            var day = String(date.getDate());

            return date.getFullYear() + '-' + (month.length < 2 ? '0' + month : month) + '-' + (day.length < 2 ? '0' + day : day);
        }

        function escapeForRegExp(part) {
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }

        /**
         * A SQL `LIKE` pattern as a regular expression.
         *
         * Three things are special and the third is the one people miss:
         * `%` is any run, `_` is any single character, and **`[c]` is a literal
         * `c`** — which is how a search term containing a wildcard is escaped,
         * because a backslash is not an escape character here.
         *
         * Without the bracket case a control that correctly escapes a typed `%`
         * to `[%]` looks broken against this stand-in while being right on the
         * server, which is the worst way for a harness to be wrong.
         */
        function likePattern(pattern) {
            var source = '^';

            for (var at = 0; at < pattern.length; at += 1) {
                var character = pattern.charAt(at);

                if (character === '[' && pattern.charAt(at + 2) === ']') {
                    source += escapeForRegExp(pattern.charAt(at + 1));
                    at += 2;
                } else if (character === '%') {
                    source += '.*';
                } else if (character === '_') {
                    source += '.';
                } else {
                    source += escapeForRegExp(character);
                }
            }

            return new RegExp(source + '$');
        }

        /** A `FilterExpression`, including any child `filters`, against one row. */
        function passes(row, expression) {
            if (!expression) {
                return true;
            }

            var conditions = expression.conditions || [];
            var children = expression.filters || [];

            var results = conditions
                .map(function (condition) {
                    return holds(row, condition);
                })
                .concat(
                    children.map(function (child) {
                        return passes(row, child);
                    }),
                );

            if (results.length === 0) {
                return true;
            }

            // Undeclared is `And` — see the note on FilterOperator above.
            var operator = expression.filterOperator === undefined ? AND : expression.filterOperator;

            return operator === OR ? results.some(Boolean) : results.every(Boolean);
        }

        /** Every record the current filter admits — the server's result set. */
        function matching() {
            var alive = removed.length === 0
                ? allRecords
                : allRecords.filter(function (row) {
                    return removed.indexOf(row.id) === -1;
                });

            var narrowed = o.hostFilter
                ? alive.filter(function (row) {
                    return passes(row, o.hostFilter);
                })
                : alive;

            return filter
                ? narrowed.filter(function (row) {
                    return passes(row, filter);
                })
                : narrowed;
        }

        /** All matching records in the order the current sort puts them. */
        function ordered() {
            var rows = matching().slice();

            if (sorting.length === 0) {
                return rows;
            }

            /*
             * Only the first entry is honoured, and that is not a shortcut: a
             * view's ORDER BY is what `dataset.sorting` holds, and a control
             * that pushes instead of replacing builds a three-deep sort nobody
             * asked for. Sorting by one column here makes that visible as a
             * wrong order rather than hiding it behind a stable tie-break.
             */
            var by = sorting[0];

            return rows.sort(function (a, b) {
                var left = formatted(a.values[by.name]);
                var right = formatted(b.values[by.name]);
                var compared = left.localeCompare(right);

                return by.sortDirection === DESCENDING ? -compared : compared;
            });
        }

        /**
         * What `sortedRecordIds` holds.
         *
         * With `accumulatePages` on — the observed platform behaviour — it is
         * every id from page one to the current page, which is why a control
         * that renders the array directly stacks page two under page one.
         */
        function visibleIds() {
            var rows = ordered();
            var end = state.page * state.pageSize;
            var start = quirks.accumulatePages ? 0 : (state.page - 1) * state.pageSize;

            return rows.slice(start, end).map(function (row) {
                return row.id;
            });
        }

        /**
         * One attribute's metadata node, in the shape measured 2026-09-11.
         *
         * A real node carries a Choice's option list twice —
         * `attributeDescriptor.OptionSet` as an array of `{ Label, Value,
         * IsHidden }` in the maker's order, and `OptionSet` as a **map keyed
         * by value** of `{ text, value }` — with no `Options` array anywhere
         * and no `GlobalOptionSet`. That is not the shape the reference page
         * describes, and not the one `pcf-kanban-board` documented. The
         * fixture asks for one shape per column so that a control reading only
         * one route is caught by the column carrying the other. Labels are
         * plain strings on both.
         *
         * A lookup carries `Targets` at the top of the node for a
         * `Lookup.Simple`, and only under `attributeDescriptor` for a
         * `Lookup.Customer`; both are served so a reader has to try both.
         */
        function attributeNode(name) {
            var entry = (fixture.metadata || {})[name];

            if (!entry) {
                return undefined;
            }

            var node = {
                LogicalName: name,
                AttributeTypeName: typeOf(name),
                attributeDescriptor: { LogicalName: name },
            };

            if (entry.targets) {
                node.attributeDescriptor.Targets = entry.targets.slice();

                if (entry.shape !== 'customer') {
                    node.Targets = entry.targets.slice();
                }
            }

            if (entry.options && entry.shape === 'descriptor') {
                node.attributeDescriptor.OptionSet = entry.options.map(function (option) {
                    var described = { Label: option.label, Value: option.value, IsHidden: false };

                    /*
                     * **`Color` is on the descriptor array only, never on the
                     * value-keyed map** — measured 2026-09-14 on
                     * `pcf-kanban-board`'s lane column, where the map had none
                     * and the array carried `#0078D4`-style strings. A fixture
                     * option with no `color` has no key at all, which is what a
                     * column whose options were never coloured looks like.
                     */
                    if (typeof option.color === 'string') {
                        described.Color = option.color;
                    }

                    return described;
                });
            }

            /*
             * A datetime node. `Behavior` (1 User Local, 2 Date Only, 3 Time
             * Zone Independent) and `Format` ('date' | 'dateandtime') are on
             * the node itself, beside `AttributeType: 2` — measured on a form
             * (`pcf-date-range-picker`; `pcf-data-table` 2026-09-11). They are
             * the only way to tell a Date Only *behaviour* from a Date Only
             * *format* on a User Local column, which is the pairing the
             * platform's own guidance warns against and real tables carry.
             */
            if (entry.behavior !== undefined) {
                node.AttributeType = 2;
                // Lower-case on a real form (measured 2026-09-16, cll_event.cll_starts); the SDK's `DateTimeType` casing is not what the client hands over.
                node.AttributeTypeName = 'datetime';
                node.Behavior = entry.behavior;
                node.Format = entry.format || 'dateandtime';
            }

            if (entry.options && entry.shape === 'map') {
                node.OptionSet = {};
                entry.options.forEach(function (option) {
                    node.OptionSet[option.value] = { text: option.label, value: option.value };
                });
            }

            return node;
        }

        /** The label a Choice's integer renders as, from `fixture.metadata`. */
        function optionLabel(name, value) {
            var options = ((fixture.metadata || {})[name] || {}).options || [];
            var match = options.filter(function (option) {
                return String(option.value) === String(value);
            })[0];

            return match ? match.label : String(value);
        }

        function recordFor(row) {
            var record = {
                getRecordId: function () {
                    return row.id;
                },
                /*
                 * **A choice reads back as a string.** `getValue` on an
                 * `OptionSet` column returned `"3"` on the measured subgrid,
                 * not `3`, while `setValue` wants the integer — so a control
                 * comparing what it wrote with what it reads has to coerce,
                 * and a rig that handed back the fixture's number would let
                 * one that does not pass. A lookup reads back as the
                 * `EntityReference` the fixture holds: `{ id: { guid }, etn,
                 * name }`, GUID unbraced and lower-case.
                 */
                getValue: function (name) {
                    var value = row.values[name];

                    if (typeof value === 'number' && typeOf(name) === 'OptionSet') {
                        return String(value);
                    }

                    return value;
                },
                getFormattedValue: function (name) {
                    /*
                     * A row may carry its own `formatted` bag, and it exists so a
                     * fixture can make the formatted value differ from the raw one
                     * — "$1,204.75" against 1204.75. Without that, a control that
                     * plots the formatted string and one that plots the number are
                     * indistinguishable from any assertion, and only one of them
                     * is right.
                     */
                    if (row.formatted && Object.prototype.hasOwnProperty.call(row.formatted, name)) {
                        return row.formatted[name];
                    }

                    var value = row.values[name];
                    var type = typeOf(name);

                    // The platform never shows a choice as its integer or a
                    // lookup as its object; `String({ id: … })` is
                    // `[object Object]` in a cell.
                    if (value !== null && value !== undefined && type === 'OptionSet') {
                        return optionLabel(name, value);
                    }

                    if (value && typeof value === 'object' && type.indexOf('Lookup') === 0) {
                        return formatted(value.name);
                    }

                    return formatted(value);
                },
                getNamedReference: function () {
                    return { id: row.id, name: formatted(row.values.name), etn: fixture.targetEntityType };
                },
            };

            /*
             * **The write half of `EntityRecord`, which the type definitions
             * do not declare.** Measured on a real model-driven subgrid: a
             * live record carries twenty-three methods where the typings
             * declare four, and `setValue` + `save` committed a value that
             * survived a reload — a text cell 2026-09-09, a Choice integer
             * 2026-09-11. It is worth a control reaching past the typings for,
             * because the alternative, `webAPI.updateRecord`, needs
             * `<uses-feature name="WebAPI" />` and does nothing in canvas.
             *
             * **It does not stage a Lookup.** Five value shapes were tried on
             * a `Lookup.Simple` column and every `save()` was refused with
             * "Invalid snapshot"; the stored value never moved. This rig
             * accepts a lookup write like any other, which is the one place it
             * is more generous than the platform — deliberately, because
             * refusing it here would be modelling one host's failure as a
             * contract. A control that writes lookups through `setValue` has
             * to prove it on a form.
             */
            if (quirks.editableAbsent) {
                return record;
            }

            // Staged, not applied: `setValue` on the platform does not commit.
            row.staged = row.staged || {};

            /*
             * **Returns `undefined`, because the platform does.** Microsoft's
             * reference page types it `Promise`; a rig that returned one let
             * `pcf-data-table` chain `.then` off it for three releases and
             * ship a write that could never work.
             */
            record.setValue = function (name, value) {
                // The value too, so a suite can assert *what* was written and not only where — a Date serialises as its ISO instant.
                log('record.setValue', name + '=' + JSON.stringify(value));
                row.staged[name] = value;

                return undefined;
            };

            record.save = function () {
                log('record.save', row.id);

                if (quirks.saveRejects) {
                    row.staged = {};

                    return Promise.reject(new Error('The platform refused this write.'));
                }

                /*
                 * **Resolving is not applying.** A resolved `save()` is
                 * Dataverse accepting the write; the dataset re-reads on a
                 * separate fetch, and until `handle.reread()` the record
                 * still reports the old value — which is the window an
                 * optimistic control has to hold its own value across.
                 */
                row.committed = Object.assign(row.committed || {}, row.staged);
                row.staged = {};

                return Promise.resolve();
            };

            record.isDirty = function () {
                return Promise.resolve(Object.keys(row.staged).length > 0);
            };

            /*
             * **A Promise, because the platform's is.** An unawaited call is a
             * truthy Promise, so `if (record.isEditable(name))` is true for
             * every column; returning a bare boolean here would let that pass.
             */
            record.isEditable = function (name) {
                return Promise.resolve(quirks.readOnlyColumns.indexOf(name) === -1);
            };

            return record;
        }

        var filtering = {
            /*
             * Returns what was set, which is how a control tells "the filter I
             * am about to apply" from "the filter already in force". Without
             * that comparison, re-applying on every `updateView` is an
             * unbounded refresh loop — the one `drive()` counts passes to
             * catch.
             */
            getFilter: function () {
                if (o.hostFilter && requestedFilter) {
                    // Both in force, as one `And` of two children — a shape a
                    // control translating filters has to handle either way.
                    return { conditions: [], filterOperator: AND, filters: [o.hostFilter, requestedFilter] };
                }

                return requestedFilter || o.hostFilter || undefined;
            },

            setFilter: function (expression) {
                log('filtering.setFilter', (expression && expression.conditions ? expression.conditions.length : 0));
                // Requested, not applied. Nothing changes until a fetch.
                requestedFilter = expression || null;
            },

            clearFilter: function () {
                log('filtering.clearFilter');
                requestedFilter = null;
            },
        };

        var dataset = {
            get columns() {
                return columns;
            },

            get sortedRecordIds() {
                return o.loading || o.error ? [] : visibleIds();
            },

            /*
             * Keyed by id and containing only the records of the current page,
             * because that is what the platform hands over — a control that
             * reaches for a record it was not given gets `undefined`, and the
             * scaffolded table's `if (!record) continue` is written for exactly
             * that.
             */
            get records() {
                var map = {};

                visibleIds().forEach(function (id) {
                    var row = allRecords.filter(function (candidate) {
                        return candidate.id === id;
                    })[0];

                    if (row) {
                        map[id] = recordFor(row);
                    }
                });

                return map;
            },

            /**
             * Mutated in place by the control. That is the documented API —
             * and `undefined` under `sortingAbsent`, which is what `npm start`
             * hands over.
             */
            get sorting() {
                return quirks.sortingAbsent ? undefined : sorting;
            },

            /**
             * Real filtering, and `undefined` under `filteringAbsent`.
             *
             * **Setting a filter is not a fetch.** `setFilter` records the
             * expression and not one row moves until the control calls
             * `refresh()` — which is the platform's contract and the half
             * people leave out, because a control that forgets the refresh
             * looks exactly like one whose filter did not match anything.
             *
             * Nor does it reset the page. Filter from page three and the
             * control is asking for page three of a result set that may have
             * one page in it; the platform will happily hand back nothing at
             * all. `paging.reset()` before `refresh()` is the control's job,
             * and leaving it out here is what makes the omission visible.
             */
            get filtering() {
                return quirks.filteringAbsent ? undefined : filtering;
            },

            paging: {
                get pageSize() {
                    return state.pageSize;
                },

                /*
                 * The *filtered* total, not the view's. A server counts what it
                 * returned; a control that filters and then prints "of 12" is
                 * reading a number the platform never gave it.
                 */
                get totalResultCount() {
                    return quirks.uncounted ? -1 : matching().length;
                },

                get hasNextPage() {
                    return state.page * state.pageSize < matching().length;
                },

                /*
                 * False after paging forward, as observed. The platform treats
                 * the load as the range 1..N, and a range beginning at page one
                 * truthfully has nothing before it — so a pager driven by this
                 * can go forward and never come back.
                 */
                get hasPreviousPage() {
                    return quirks.previousPageStuck ? false : state.page > 1;
                },

                /*
                 * Disagrees with the ids when pages accumulate: it reports the
                 * current page while `sortedRecordIds` holds every page up to
                 * it. A label that takes its start from here and its row count
                 * from the array prints a range past its own total.
                 */
                get firstPageNumber() {
                    return state.page;
                },

                setPageSize: function (size) {
                    log('setPageSize', size);
                    // Requested, not applied. Nothing changes until a fetch.
                    state.requestedPageSize = size;
                },

                loadNextPage: function (loadOnlyNewPage) {
                    log('loadNextPage', loadOnlyNewPage);
                    state.page += 1;
                    fetched();
                },

                loadPreviousPage: function (loadOnlyNewPage) {
                    log('loadPreviousPage', loadOnlyNewPage);
                    state.page = Math.max(1, state.page - 1);
                    fetched();
                },

                loadExactPage: quirks.hasLoadExactPage
                    ? function (page) {
                        log('loadExactPage', page);
                        state.page = Math.max(1, page);
                        fetched();
                    }
                    : undefined,

                reset: function () {
                    log('paging.reset');
                    state.page = 1;
                    fetched();
                },
            },

            get loading() {
                return o.loading;
            },

            get error() {
                return o.error;
            },

            get errorMessage() {
                return o.errorMessage;
            },

            getTitle: function () {
                return fixture.title;
            },

            getTargetEntityType: function () {
                return fixture.targetEntityType;
            },

            /**
             * The bound view's id. Typed `string`; measured `null` on the
             * dataset under a bound lookup. A control reads it to fetch the
             * view's own FetchXML from `savedquery` — see `retrieveRecord`.
             */
            getViewId: function () {
                return o.viewId === undefined ? fixture.viewId || null : o.viewId;
            },

            refresh: function () {
                log('refresh');
                fetched();
            },

            openDatasetItem: function (reference) {
                log('openDatasetItem', reference && reference.id);
            },

            getSelectedRecordIds: function () {
                /*
                 * A copy, because the platform's is not the control's to
                 * mutate. A control that pushes onto the array it was handed
                 * changes the host's selection without calling the setter, and
                 * on a real form that write is simply lost.
                 */
                return selected.slice();
            },

            setSelectedRecordIds: function (ids) {
                log('setSelectedRecordIds', ids.length);
                selected = (ids || []).slice();
            },

            clearSelectedRecordIds: function () {
                log('clearSelectedRecordIds');
                selected = [];
            },

            addColumn: function (name) {
                log('addColumn', name);

                /*
                 * Only a column the table actually has can arrive. `catalogue`
                 * on the fixture is the set of columns that exist but are not on
                 * the view — ask for anything else and nothing comes back,
                 * which is what a real table does with a name that is not one of
                 * its own. The control has to cope with having asked and not
                 * received.
                 */
                if (requestedColumns.indexOf(name) === -1) {
                    requestedColumns.push(name);
                }
            },
        };

        /*
         * Deleted rather than never defined, so the literal above stays one
         * readable shape.
         */
        if (!quirks.hasAddColumn) {
            delete dataset.addColumn;
        }

        /**
         * A round trip to the server: the requested page size takes effect and
         * a render is owed.
         *
         * Owed rather than performed, so that a control which refreshes from
         * inside `updateView` shows up as a count instead of a stack overflow.
         */
        function fetched() {
            /*
             * Columns asked for since the last fetch arrive now, if the table
             * has them. `fixture.catalogue` holds the columns that exist on the
             * table but are not on the bound view — which is the whole reason
             * `addColumn` exists.
             */
            var catalogue = fixture.catalogue || {};

            requestedColumns.forEach(function (name) {
                var definition = catalogue[name];
                var already = columns.some(function (column) {
                    return column.name === name;
                });

                if (definition && !already) {
                    columns.push(definition);
                }
            });

            requestedColumns = [];

            // Deletes the server has taken arrive with this fetch and not
            // before it. See the note on `removedPending`.
            removed = removed.concat(removedPending);
            removedPending = [];

            // Creates likewise. `concat` rather than `push`, so the fixture's
            // own array is never mutated across binds.
            if (createdPending.length > 0) {
                allRecords = allRecords.concat(createdPending);
                createdPending = [];
            }

            state.pageSize = state.requestedPageSize;
            filter = requestedFilter;
            state.refreshes += 1;
            state.renderOwed = true;
        }

        /* ------------------------------------------------------------------ */
        /* FetchXML through the Web API                                         */
        /* ------------------------------------------------------------------ */

        /**
         * The FetchXML operator names → the `ConditionOperator` numbers
         * `holds()` already evaluates, so a FetchXML condition and a dataset
         * filter condition are judged by the same code. A name not here is
         * **unhonoured, and passes every row** — the same rule as `holds()`'s
         * default, for the same reason: "no filtering happened" is a failure
         * a suite can see, "everything vanished" is not.
         */
        var FETCH_OPERATORS = {
            'eq': OPERATOR.Equal,
            'ne': OPERATOR.NotEqual,
            'neq': OPERATOR.NotEqual,
            'gt': OPERATOR.GreaterThan,
            'lt': OPERATOR.LessThan,
            'ge': OPERATOR.GreaterEqual,
            'le': OPERATOR.LessEqual,
            'like': OPERATOR.Like,
            'in': OPERATOR.In,
            'null': OPERATOR.Null,
            'not-null': OPERATOR.NotNull,
            'on': OPERATOR.On,
            'on-or-before': OPERATOR.OnOrBefore,
            'on-or-after': OPERATOR.OnOrAfter,
        };

        function xmlAttr(tag, name) {
            var m = tag.match(new RegExp('\\b' + name + "=['\"]([^'\"]*)['\"]"));
            return m ? m[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : undefined;
        }

        /**
         * A `<filter>` element and everything inside it → a `FilterExpression`
         * `passes()` reads. Nested filters nest; a `<condition>` with
         * `<value>` children is an `in`. Conditions inside a `<link-entity>`
         * are dropped with the link-entity, because the rig has no joined
         * rows to judge them against — a suite asserting a linked filter's
         * effect is asserting nothing here, and the header says so.
         */
        function parseFilter(xml) {
            var withoutLinks = xml.replace(/<link-entity\b[^>]*\/>/g, '').replace(/<link-entity\b[^>]*>[\s\S]*?<\/link-entity>/g, '');
            var filters = [];

            // Top-level filters only: nested ones are parsed by recursion on the body.
            var depth = 0;
            var body = '';
            var open = '';
            var tokens = withoutLinks.match(/<\/?filter\b[^>]*>|[^<]+|<[^>]+>/g) || [];

            tokens.forEach(function (token) {
                if (/^<filter\b/.test(token)) {
                    if (depth === 0) {
                        open = token;
                        body = '';
                    } else {
                        body += token;
                    }
                    depth += 1;
                } else if (/^<\/filter>/.test(token)) {
                    depth -= 1;
                    if (depth === 0) {
                        filters.push(filterOf(open, body));
                    } else {
                        body += token;
                    }
                } else if (depth > 0) {
                    body += token;
                }
            });

            return filters;
        }

        function filterOf(openTag, body) {
            var conditions = [];
            var conditionPattern = /<condition\b([^>]*?)(\/>|>([\s\S]*?)<\/condition>)/g;
            var outer = body.replace(/<filter\b[^>]*>[\s\S]*?<\/filter>/g, '');
            var m;

            while ((m = conditionPattern.exec(outer)) !== null) {
                var operator = xmlAttr(m[1], 'operator');
                var values = [];
                var valuePattern = /<value>([\s\S]*?)<\/value>/g;
                var v;

                while (m[3] && (v = valuePattern.exec(m[3])) !== null) {
                    values.push(v[1]);
                }

                conditions.push({
                    attributeName: xmlAttr(m[1], 'attribute'),
                    conditionOperator: Object.prototype.hasOwnProperty.call(FETCH_OPERATORS, operator) ? FETCH_OPERATORS[operator] : -1,
                    value: values.length > 0 ? values : xmlAttr(m[1], 'value'),
                });
            }

            return {
                conditions: conditions,
                filterOperator: (xmlAttr(openTag, 'type') || 'and').toLowerCase() === 'or' ? OR : AND,
                filters: parseFilter(body),
            };
        }

        /**
         * The rows a FetchXML query is judged against: the bound table's own
         * rows (`allRecords`, minus deletes — **not** narrowed by the host's
         * filter, because a query carries its own conditions), or a flat
         * `fixture.tables` row wrapped to look like one.
         */
        function fetchRows(entityType) {
            if (entityType === fixture.targetEntityType) {
                return allRecords.filter(function (row) {
                    return removed.indexOf(row.id) === -1;
                });
            }

            return ((fixture.tables || {})[entityType] || []).map(function (source) {
                return { id: source[entityType + 'id'] || '', values: source };
            });
        }

        /** The `dategrouping` bucket of a value, in the user's zone — the server groups by the user's calendar. */
        function dateBucket(value, grouping) {
            var day = dayOf(value);

            if (day === null) {
                return null;
            }

            var year = Number(day.slice(0, 4));
            var month = Number(day.slice(5, 7));
            var date = Number(day.slice(8, 10));

            switch (grouping) {
                case 'year': return { bucket: year, year: year, month: month };
                case 'quarter': return { bucket: Math.floor((month - 1) / 3) + 1, year: year, month: month };
                case 'day': return { bucket: date, year: year, month: month };
                case 'week': {
                    // SQL Server's DATEPART(week): Sunday start, week 1 holds 1 January.
                    var jan1 = Date.UTC(year, 0, 1);
                    var at = Date.UTC(year, month - 1, date);
                    var dow = new Date(jan1).getUTCDay();
                    return { bucket: Math.floor((Math.floor((at - jan1) / 86400000) + dow) / 7) + 1, year: year, month: month };
                }
                case 'month':
                default: return { bucket: month, year: year, month: month };
            }
        }

        /**
         * The label the server annotates a group with — a Choice's label, a
         * lookup's name, Yes/No — under `<alias>@OData.Community.Display.V1
         * .FormattedValue`. A date bucket gets none: what the platform sends
         * there is unmeasured (pcf-chart-view SPEC.md P5), and a control
         * that builds its own label from the bucket needs nothing.
         */
        function groupLabel(name, raw) {
            if (raw && typeof raw === 'object' && typeof raw.name === 'string') {
                return raw.name;
            }

            var type = typeOf(name);

            if (type === 'OptionSet' && typeof raw === 'number') {
                return optionLabel(name, raw);
            }

            if (type === 'TwoOptions') {
                return raw === true || raw === 1 ? 'Yes' : 'No';
            }

            return undefined;
        }

        /**
         * Answer a `?fetchXml=` query from the rows: the entity's conditions
         * applied (link-entities and their conditions ignored — said above),
         * then either the plain rows or, under `aggregate='true'`, one row
         * per distinct combination of the `groupby` attributes carrying each
         * aggregate under its alias.
         *
         * Reproduced on purpose, because a control that does not expect them
         * is wrong on a form: **a FetchXML result omits null-valued
         * properties**, so a blank group has no `g` at all; a Choice group's
         * value is its **integer**; a lookup group's is the bare GUID with the
         * name in the annotation; a `sum`/`avg`/`min`/`max` over no values
         * is omitted the same way; and `count` on the primary key counts
         * rows while `countcolumn` counts non-null values. What the server
         * puts under a `dategrouping` alias — the bucket number, assumed — is
         * the P5 question.
         */
        function answerFetchXml(entityType, xml) {
            var entityTag = xml.match(/<entity\b[^>]*>/);
            var entity = entityTag ? xmlAttr(entityTag[0], 'name') : entityType;
            var fetchTag = xml.match(/<fetch\b[^>]*>/);
            var aggregate = fetchTag ? xmlAttr(fetchTag[0], 'aggregate') === 'true' : false;
            var rootOnly = xml.replace(/<link-entity\b[^>]*\/>/g, '').replace(/<link-entity\b[^>]*>[\s\S]*?<\/link-entity>/g, '');
            var attributes = (rootOnly.match(/<attribute\b[^>]*\/>/g) || []).map(function (tag) {
                return {
                    name: xmlAttr(tag, 'name'),
                    alias: xmlAttr(tag, 'alias'),
                    groupby: xmlAttr(tag, 'groupby') === 'true',
                    aggregate: xmlAttr(tag, 'aggregate'),
                    dategrouping: xmlAttr(tag, 'dategrouping'),
                };
            });
            var filters = parseFilter(rootOnly);
            var expression = filters.length === 0 ? null : filters.length === 1 ? filters[0] : { conditions: [], filterOperator: AND, filters: filters };
            var rows = fetchRows(entity).filter(function (row) {
                return passes(row, expression);
            });

            log('webAPI.fetchXml', { entity: entity, aggregate: aggregate, attributes: attributes.length, conditions: filters.length, rows: rows.length });

            if (!aggregate) {
                return Promise.resolve({
                    entities: rows.map(function (row) {
                        var out = {};
                        Object.keys(row.values).forEach(function (key) {
                            var keep = attributes.length === 0 || attributes.some(function (a) { return a.name === key; });
                            if (keep && row.values[key] !== null && row.values[key] !== undefined) {
                                out[key] = row.values[key];
                            }
                        });
                        return out;
                    }),
                });
            }

            if (o.aggregateRefused || rows.length > o.aggregateLimit) {
                /*
                 * 0x8004E023 = 2147164195, "AggregateQueryRecordLimit
                 * exceeded. Cannot perform this operation." — the documented
                 * code and message; the object shape is the one every other
                 * refusal here has. Unmeasured: SPEC.md P7.
                 */
                return Promise.reject(webApiFault(2147164195, '', 'AggregateQueryRecordLimit exceeded. Cannot perform this operation.'));
            }

            var groupAttributes = attributes.filter(function (a) { return a.groupby; });
            var aggregateAttributes = attributes.filter(function (a) { return !a.groupby && a.aggregate; });
            var groups = {};
            var order = [];

            rows.forEach(function (row) {
                var keys = groupAttributes.map(function (a) {
                    var raw = row.values[a.name];

                    if (raw && typeof raw === 'object' && raw.id && typeof raw.id.guid === 'string') {
                        raw = raw.id.guid.toLowerCase();
                    }

                    if (a.dategrouping) {
                        var bucket = dateBucket(raw, a.dategrouping);
                        return bucket === null ? null : bucket.bucket;
                    }

                    return raw === undefined || raw === '' ? null : raw;
                });
                var id = JSON.stringify(keys);

                if (!groups[id]) {
                    groups[id] = { keys: keys, rows: [] };
                    order.push(id);
                }

                groups[id].rows.push(row);
            });

            return Promise.resolve({
                entities: order.map(function (id) {
                    var group = groups[id];
                    var out = {};

                    groupAttributes.forEach(function (a, index) {
                        var key = group.keys[index];

                        if (key === null) {
                            return;
                        }

                        out[a.alias] = key;

                        var label = a.dategrouping ? undefined : groupLabel(a.name, group.rows[0].values[a.name]);

                        if (label !== undefined) {
                            out[a.alias + '@OData.Community.Display.V1.FormattedValue'] = label;
                        }
                    });

                    aggregateAttributes.forEach(function (a) {
                        var values = group.rows.map(function (row) {
                            return row.values[a.name];
                        });
                        var numbers = values.filter(function (v) {
                            return typeof v === 'number' && isFinite(v);
                        });
                        var result;

                        switch (a.aggregate) {
                            case 'count':
                                result = group.rows.length;
                                break;
                            case 'countcolumn':
                                result = values.filter(function (v) { return v !== null && v !== undefined && v !== ''; }).length;
                                break;
                            case 'sum':
                                result = numbers.length === 0 ? undefined : numbers.reduce(function (s, v) { return s + v; }, 0);
                                break;
                            case 'avg':
                                result = numbers.length === 0 ? undefined : numbers.reduce(function (s, v) { return s + v; }, 0) / numbers.length;
                                break;
                            case 'min':
                                result = numbers.length === 0 ? undefined : Math.min.apply(null, numbers);
                                break;
                            case 'max':
                                result = numbers.length === 0 ? undefined : Math.max.apply(null, numbers);
                                break;
                            default:
                                result = undefined;
                        }

                        if (result !== undefined) {
                            out[a.alias] = result;
                        }
                    });

                    return out;
                }),
            });
        }

        /**
         * `context.navigation`, assembled method by method.
         *
         * **Presence is per method, not per bag**, and that is the whole reason
         * this is a function rather than an object literal. `openUrl` is
         * there on every host; `openForm` and `openFile` are documented
         * model-driven only; the three dialogs are a model-driven affordance
         * that canvas does not have. A control that checks `context.navigation`
         * once and then calls four methods through it passes on the host it was
         * written on and throws on the next one — so each of these can be
         * removed independently here, because each is removed independently in
         * the world.
         *
         * Nothing is performed. Every call is recorded, so an assertion can be
         * about what the control *handed over* — which is the half that
         * regresses.
         */
        function buildNavigation() {
            if (!o.hasNavigation) {
                return undefined;
            }

            var navigation = {
                /**
                 * **Returns `void`, not a promise.** The odd one out in this
                 * bag, and `void openUrl(...)` in the type definitions — so
                 * `await`ing it is harmless and `.catch()` on it is a
                 * TypeError. There is also no failure channel: a URL the host
                 * refuses to open reports nothing back, which is why the
                 * control has to decide the URL is acceptable *before* it calls.
                 */
                openUrl: function (url) {
                    log('navigation.openUrl', url);
                },
            };

            // Model-driven only, on the same rule as `openFile` below.
            if (o.host !== 'canvas') {
                /**
                 * Logged in full, **both arguments**, because the options
                 * *are* the behaviour: whether `useQuickCreateForm` was set,
                 * whether `createFromEntity` named the parent, whether
                 * `entityId` was left out for a create — and what the second
                 * argument carried. `openForm(options, parameters)` takes a
                 * `{ [column]: string }` of field values the form opens
                 * with, and it is how a quick create arrives with a column
                 * already set (`pcf-kanban-board`'s "+" passes the lane).
                 * A stub that logged the options alone would certify a
                 * button that opens a blank form. Logged as one object so a
                 * suite can `JSON.parse` the call. Resolves
                 * `o.openFormReturns` — see DEFAULTS for the measured shapes.
                 */
                navigation.openForm = function (formOptions, parameters) {
                    log('navigation.openForm', { options: formOptions, parameters: parameters });

                    return Promise.resolve(o.openFormReturns);
                };
            }

            // Documented model-driven apps only, and a canvas host has no
            // switch to say otherwise — `openFile: true` under `host: 'canvas'`
            // would be a host that does not exist.
            if (o.openFile && o.host !== 'canvas') {
                navigation.openFile = function (file, fileOptions) {
                    log('navigation.openFile', {
                        fileName: (file || {}).fileName,
                        fileSize: (file || {}).fileSize,
                        mimeType: (file || {}).mimeType,
                        openMode: (fileOptions || {}).openMode,
                    });

                    return Promise.resolve();
                };
            }

            /*
             * 'absent' removes the three rather than making them fail, because
             * those are different states and only one of them is a bug in the
             * control.
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
             * **Cancel is a resolve.** `{ confirmed: false }` comes back through
             * the success path, not through `catch` — so a control that puts
             * its delete inside `.then()` without reading `confirmed` deletes
             * the record the user just declined to delete, and a control that
             * treats the cancel as a failure shows an error for something the
             * user did on purpose. Both are one line away from correct and
             * neither shows up without this switch.
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
                 * reads only `message` is reading a slot the platform never
                 * filled — it passes whether or not the rejection was ever
                 * decoded, which makes "and NOT [object Object]" a claim about
                 * nothing. Both halves are recorded so both can be asserted.
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

        function createContext() {
            var parameters = {
                records: dataset,

                /*
                 * **The control's `pageSize` input is not the host's page size,
                 * and this rig used to hand over one number for both.**
                 *
                 * `o.pageSize` is what the *platform* is paging at — it is what
                 * `paging.pageSize` reports, the way a main grid reports the
                 * user's *Rows per page*. The input below is what the *maker*
                 * typed into the property, and the whole point of that property
                 * carrying no `default-value` is that leaving it alone is a
                 * state the control can see. Seeding it from `o.pageSize` made
                 * that state unreachable: every mount looked like a maker who
                 * had deliberately asked for exactly what the host was already
                 * doing, so the adopt-the-host path was never once exercised.
                 *
                 * `null` is therefore the default, because unset is what a
                 * fresh install looks like. Pass `inputs: { pageSize: 10 }` for
                 * the maker who overrode it.
                 */
                pageSize: {
                    raw: Object.hasOwn(o.inputs, 'pageSize') ? o.inputs.pageSize : null,
                    type: 'Whole.None',
                },
            };

            // The control's own inputs, wrapped the way the platform hands them
            // over. A raw `null` is a real value here — an input the maker left
            // unset — so it is passed through rather than defaulted.
            Object.keys(o.inputs).forEach(function (name) {
                parameters[name] = { raw: o.inputs[name], type: (parameters[name] || {}).type };
            });

            var context = {
                parameters: parameters,

                mode: {
                    isVisible: o.visible,
                    /*
                     * Hardcoded `false` until now, which meant no dataset
                     * control could be asserted against a read-only form at
                     * all — the state a maker produces by unchecking one box,
                     * and the one where a control that still lets you press
                     * things is a real bug rather than a cosmetic one.
                     *
                     * Distinct from `isVisible`: a hidden control renders
                     * nothing, a disabled one renders everything and acts on
                     * none of it.
                     */
                    isControlDisabled: o.disabled,
                    label: fixture.title,
                    // Recorded rather than delivered — "did the control ask for
                    // resize notifications" is a decision worth asserting; the
                    // resize itself comes from the `width` option.
                    trackContainerResize: function (value) {
                        log('trackContainerResize', value);
                    },
                    setFullScreen: function (value) {
                        log('setFullScreen', value);
                    },
                    allocatedWidth: o.width,
                    // Pinned at -1 under `heightUnmeasured`, whatever `height`
                    // says — a main grid answers the width and never this.
                    allocatedHeight: quirks.heightUnmeasured ? -1 : o.height,
                    // The parent record of a form subgrid, `undefined` on a
                    // main grid. See DEFAULTS.
                    contextInfo: o.contextInfo
                        ? {
                            entityTypeName: o.contextInfo.entityTypeName,
                            entityId: o.contextInfo.entityId,
                            entityRecordName: o.contextInfo.entityRecordName,
                        }
                        : undefined,
                },

                /**
                 * `context.utils`, absent on canvas and under `utils: false`.
                 *
                 * **`getEntityMetadata` resolves with a class instance, not a
                 * plain object**, and this reproduces that rather than
                 * flattening it: the own enumerable properties are private
                 * fields and the public members are getters on the prototype,
                 * so code that walks `Object.keys` sees `_entityDescriptor`
                 * and concludes there is nothing there, while reading
                 * `metadata.Attributes` by name works. A flat object here
                 * would let that code pass locally and fail on a form.
                 *
                 * `Attributes.get(column)` returns the node `attributeNode`
                 * builds from `fixture.metadata`, and `undefined` for a
                 * column the fixture says nothing about — what a real node
                 * does for a column that is not a choice or a lookup.
                 */
                utils: o.utils && o.host !== 'canvas'
                    ? {
                        getEntityMetadata: function (entityName, attributes) {
                            log('utils.getEntityMetadata', { entity: entityName, attributes: attributes });

                            if (quirks.metadataRejects) {
                                return Promise.reject(new Error('Metadata for ' + entityName + ' could not be read.'));
                            }

                            function Metadata() {
                                this._entityDescriptor = { EntityLogicalName: entityName };
                                this._attributes = attributes || [];
                            }

                            Object.defineProperty(Metadata.prototype, 'Attributes', {
                                get: function () {
                                    return {
                                        get: function (name) {
                                            return attributeNode(name);
                                        },
                                    };
                                },
                            });

                            /*
                             * `EntitySetName` — the plural an `@odata.bind`
                             * value is spelled with — and `PrimaryNameAttribute`,
                             * as getters on the prototype like the rest.
                             * Measured 2026-09-13: `contacts` / `fullname`,
                             * `accounts` / `name`. A table the fixture does
                             * not know answers `undefined`, which a control
                             * refuses rather than guessing `${table}s` from.
                             */
                            Object.defineProperty(Metadata.prototype, 'EntitySetName', {
                                get: function () {
                                    if (quirks.entitySetAbsent) {
                                        return undefined;
                                    }

                                    if (entityName === fixture.targetEntityType) {
                                        return fixture.entitySetName || fixture.targetEntityType + 's';
                                    }

                                    var related = (fixture.related || {})[entityName];

                                    return related ? related.entitySet : undefined;
                                },
                            });

                            Object.defineProperty(Metadata.prototype, 'PrimaryNameAttribute', {
                                get: function () {
                                    return entityName === 'contact' ? 'fullname' : 'name';
                                },
                            });

                            return Promise.resolve(new Metadata());
                        },

                        /**
                         * The platform's lookup dialog. Logged in full — the
                         * `entityTypes` offered are the decision — and resolved
                         * from `o.lookupPick`, braced and upper-cased the way
                         * the platform hands a pick over; `[]` for a cancel,
                         * which is the default. Absent under
                         * `lookupObjects: false` while `utils` stays.
                         */
                        lookupObjects: o.lookupObjects
                            ? function (lookupOptions) {
                                log('utils.lookupObjects', lookupOptions);

                                var pick = o.lookupPick;

                                return Promise.resolve(pick
                                    ? [{
                                        id: '{' + String(pick.id).toUpperCase() + '}',
                                        entityType: pick.entityType,
                                        name: pick.name,
                                    }]
                                    : []);
                            }
                            : undefined,
                    }
                    : undefined,

                /**
                 * `context.page`, which is not in the typings. Its
                 * `getClientUrl` is how a control finds the organisation for a
                 * metadata `fetch`; absent on canvas and under `page: false`.
                 */
                page: o.page && o.host !== 'canvas'
                    ? {
                        getClientUrl: function () {
                            return CLIENT_URL;
                        },
                    }
                    : undefined,

                /*
                 * The Web API, with its refusals modelled first.
                 *
                 * `retrieveRecord` answers from the fixture row rather than from
                 * a table of its own, so one place describes each row and the
                 * four outcomes are expressed by what that row carries:
                 *
                 *   body absent   -> resolves with the property MISSING, which
                 *                    is what a column nobody populated does
                 *   body ''       -> resolves with an empty string, which is a
                 *                    zero-byte file and not the same thing
                 *   body null     -> REJECTS
                 *   body '…'      -> resolves with it
                 *
                 * **The rejection is a plain object, not an `Error`, and that is
                 * the point of it.** `context.webAPI` rejects with an object
                 * carrying `errorCode` and `message`, exactly as the Client
                 * API's `errorCallback` documents — so a stub that rejected with
                 * an `Error` would pass a control that renders the string
                 * "[object Object]" where the platform's explanation belongs.
                 */
                // Forced absent on canvas however the switch is set, on the
                // same rule as `utils` and `page`: WebAPI is Dataverse-dependent
                // and is not available in canvas apps, whatever the manifest
                // declares. A rig that could be told "canvas, with a Web API"
                // would pass a control that works nowhere.
                webAPI: o.webAPI && o.host !== 'canvas'
                    ? {
                        /**
                         * **The row arrives on the next fetch, not on the
                         * call.** `createRecord` resolves with the new id and
                         * nothing else changes until `fetched()` moves the row
                         * across — so a control that creates and forgets
                         * `dataset.refresh()` draws a list one row short here,
                         * which is exactly what a real form does. A stub that
                         * pushed straight into the dataset would pass it.
                         *
                         * A row lands in *this* dataset only when it was
                         * created on the bound table (`fixture.targetEntityType`)
                         * — a Note created from a control bound to Contacts is
                         * in somebody else's subgrid. Its values are what the
                         * control wrote, with `@odata.bind` keys resolved
                         * through `fixture.relationships` into the lookup they
                         * stand for and refused the way `updateRecord` refuses
                         * them, plus whatever `fixture.computed(data)` adds —
                         * the server's own columns (`createdon`, an
                         * attachment's `filesize`) are the table's business,
                         * and the fixture is where the table lives. `body`
                         * comes from the column `fixture.bodyColumn` names, so
                         * `retrieveRecord` can hand the bytes back the way the
                         * download half reads them.
                         *
                         * Resolves `{ entityType, id }` — the typings say
                         * `LookupValue`, so `name` may also be there on a real
                         * host; this stub leaves it out so a control does not
                         * come to rely on it. **Not yet measured on a form.**
                         */
                        createRecord: function (entityType, data) {
                            // The body is logged as a length: a dropped file in
                            // the browser harness is megabytes of base64, and the
                            // call log is read by people. `state.created` keeps it.
                            var logged = Object.assign({}, data);

                            if (fixture.bodyColumn && typeof logged[fixture.bodyColumn] === 'string') {
                                logged[fixture.bodyColumn] = '<' + logged[fixture.bodyColumn].length + ' base64 chars>';
                            }

                            log('webAPI.createRecord', { entity: entityType, data: logged });

                            if (o.webApiFails) {
                                return Promise.reject(webApiFault(
                                    2147746581,
                                    '',
                                    'The record could not be created.',
                                ));
                            }

                            var id = 'created-' + (createdCount += 1);
                            var values = {};
                            var failure = null;
                            var body;

                            Object.keys(data || {}).forEach(function (key) {
                                if (failure) {
                                    return;
                                }

                                var bind = key.match(/^(.+)@odata\.bind$/);

                                if (!bind) {
                                    if (key === fixture.bodyColumn) {
                                        body = data[key];
                                    } else {
                                        values[key] = data[key];
                                    }

                                    return;
                                }

                                var relationship = (fixture.relationships || []).filter(function (candidate) {
                                    return candidate.navigationProperty === bind[1];
                                })[0];

                                if (!relationship) {
                                    failure = webApiFault(2147781913, '', PAYLOAD_FAULT.replace('cll_PrimaryContact', bind[1]));

                                    return;
                                }

                                var reference = String(data[key]).match(/^\/([^(]+)\(([^)]+)\)$/);
                                var related = (fixture.related || {})[relationship.target];
                                var target = reference && related && related.entitySet === reference[1]
                                    ? related.rows.filter(function (candidate) {
                                        return candidate.id === reference[2];
                                    })[0]
                                    : null;

                                if (!target) {
                                    failure = webApiFault(
                                        2147746327,
                                        'Record Is Unavailable',
                                        'The requested record was not found.',
                                    );

                                    return;
                                }

                                values[relationship.column] = {
                                    id: { guid: target.id },
                                    etn: relationship.target,
                                    name: target.name,
                                };
                            });

                            if (failure) {
                                return Promise.reject(failure);
                            }

                            if (typeof fixture.computed === 'function') {
                                Object.assign(values, fixture.computed(data) || {});
                            }

                            var row = { id: id, values: values, created: true };

                            if (body !== undefined) {
                                row.body = body;
                            }

                            state.created.push(row);

                            if (entityType === fixture.targetEntityType) {
                                createdPending.push(row);
                            }

                            return Promise.resolve({ entityType: entityType, id: id });
                        },

                        /**
                         * A query, answered from `fixture.tables[entity]` —
                         * rows keyed by logical name — with the `$select` and
                         * `$top` honoured and everything else ignored. Not the
                         * bound view, which is `dataset`; this is for the
                         * *other* table a control reads once, the way an
                         * uploader reads `organization.maxuploadfilesize` to
                         * refuse a file before encoding it. An unknown table
                         * answers no rows rather than refusing, because that
                         * is what a `$filter` matching nothing looks like and
                         * the control has to handle it either way.
                         */
                        retrieveMultipleRecords: function (entityType, options) {
                            log('webAPI.retrieveMultipleRecords', entityType + ' ' + (options || ''));

                            if (o.webApiFails) {
                                return Promise.reject(webApiFault(
                                    2147746581,
                                    '',
                                    'The records could not be retrieved.',
                                ));
                            }

                            var query = String(options || '');

                            if (/^\?fetchXml=/i.test(query)) {
                                var xml = query.slice(query.indexOf('=') + 1);

                                if (xml.charAt(0) !== '<') {
                                    xml = decodeURIComponent(xml);
                                }

                                return answerFetchXml(entityType, xml);
                            }

                            var top = query.match(/\$top=(\d+)/);
                            var select = query.match(/\$select=([^&]+)/);
                            var wanted = select ? select[1].split(',') : null;
                            var rows = ((fixture.tables || {})[entityType] || []).slice(0, top ? Number(top[1]) : undefined);

                            return Promise.resolve({
                                entities: rows.map(function (source) {
                                    var entity = {};

                                    Object.keys(source).forEach(function (key) {
                                        if (!wanted || wanted.indexOf(key) !== -1) {
                                            entity[key] = source[key];
                                        }
                                    });

                                    return entity;
                                }),
                            });
                        },

                        /**
                         * **Applies a bind the way the server did, and refuses
                         * the way it did** — the only write a dataset record
                         * cannot make itself is a Lookup (see `record.setValue`
                         * above), and this is its route. A key is
                         * `<navigationProperty>@odata.bind`; the property is
                         * looked up in `fixture.relationships` to find the
                         * column and target it stands for, and the value
                         * `/<set>(<id>)` is checked against `fixture.related`.
                         * An unknown property is refused as the platform
                         * refused `cll_PrimaryContact` — "undeclared property"
                         * — and an unknown id as it refused a zero GUID. Both
                         * are the measured `{ errorCode, message, title, code,
                         * raw }` shape. `null` clears. Any other key is written
                         * as a plain attribute value.
                         *
                         * Resolves `{ id, entityType }` and **no `name`**,
                         * measured 2026-09-13 — so a control's pending label
                         * has to come from the pick. Committed values wait for
                         * `handle.reread()` like `save()`'s do: a resolved
                         * write is not a re-read.
                         */
                        updateRecord: function (entityType, id, data) {
                            log('webAPI.updateRecord', { entity: entityType, id: id, data: data });

                            if (o.webApiFails) {
                                return Promise.reject(webApiFault(2147781913, '', PAYLOAD_FAULT));
                            }

                            var row = allRecords.filter(function (candidate) {
                                return candidate.id === id;
                            })[0];

                            if (!row) {
                                return Promise.reject(webApiFault(
                                    2147746327,
                                    'Record Is Unavailable',
                                    'The requested record was not found.',
                                ));
                            }

                            var failure = null;

                            row.committed = row.committed || {};

                            Object.keys(data || {}).forEach(function (key) {
                                if (failure) {
                                    return;
                                }

                                var bind = key.match(/^(.+)@odata\.bind$/);

                                if (!bind) {
                                    row.committed[key] = data[key];

                                    return;
                                }

                                var relationship = (fixture.relationships || []).filter(function (candidate) {
                                    return candidate.navigationProperty === bind[1];
                                })[0];

                                if (!relationship) {
                                    failure = webApiFault(2147781913, '', PAYLOAD_FAULT.replace('cll_PrimaryContact', bind[1]));

                                    return;
                                }

                                if (data[key] === null) {
                                    row.committed[relationship.column] = null;

                                    return;
                                }

                                var reference = String(data[key]).match(/^\/([^(]+)\(([^)]+)\)$/);
                                var related = (fixture.related || {})[relationship.target];
                                var target = reference && related && related.entitySet === reference[1]
                                    ? related.rows.filter(function (candidate) {
                                        return candidate.id === reference[2];
                                    })[0]
                                    : null;

                                if (!target) {
                                    failure = webApiFault(
                                        2147746327,
                                        'Record Is Unavailable',
                                        'The requested record was not found.',
                                    );

                                    return;
                                }

                                row.committed[relationship.column] = {
                                    id: { guid: target.id },
                                    etn: relationship.target,
                                    name: target.name,
                                };
                            });

                            return failure
                                ? Promise.reject(failure)
                                : Promise.resolve({ id: id, entityType: entityType });
                        },

                        retrieveRecord: function (entityType, id, options) {
                            log('webAPI.retrieveRecord', entityType + ' ' + id + ' ' + (options || ''));

                            /*
                             * A saved query is an ordinary table: `savedquery`
                             * for a system view, `userquery` for a personal
                             * one, and a control that wants the view's own
                             * FetchXML reads `fetchxml` off it by the id
                             * `getViewId()` gave. Answered from
                             * `fixture.views`, keyed by id and naming the
                             * table each lives in; an id in the other table
                             * is "not found", which is how a control learns to
                             * try both.
                             */
                            if (entityType === 'savedquery' || entityType === 'userquery') {
                                var view = (fixture.views || {})[String(id).replace(/[{}]/g, '').toLowerCase()];

                                if (!o.viewsReadable || !view || (view.table || 'savedquery') !== entityType) {
                                    return Promise.reject(webApiFault(2147746581, 'Record Is Unavailable', 'The requested record was not found.'));
                                }

                                var viewRow = { fetchxml: view.fetchxml, name: view.name || fixture.title };
                                viewRow[entityType + 'id'] = id;

                                return Promise.resolve(viewRow);
                            }

                            var match = null;

                            (fixture.records || []).concat(state.created).forEach(function (row) {
                                if (row.id === id) {
                                    match = row;
                                }
                            });

                            if (!match || match.body === null) {
                                return Promise.reject({
                                    errorCode: 2147746581,
                                    message: 'The record could not be retrieved.',
                                });
                            }

                            var selected = String(options || '').replace(/^\?\$select=/, '') || 'documentbody';
                            var answer = {};

                            if (match.body !== undefined) {
                                answer[selected] = match.body;
                            }

                            return Promise.resolve(answer);
                        },

                        /**
                         * The last `webAPI` method the catalogue had never
                         * called, and the only destructive one.
                         *
                         * Three things here are not obvious from the name:
                         *
                         * **It resolves with a `LookupValue`, not with
                         * nothing.** `Promise<LookupValue>` in the type
                         * definitions — `{ entityType, id, name }` for the
                         * record that is now gone. A control that awaits it
                         * expecting `void` is not wrong, but one that wants to
                         * name the deleted record in a message does not have to
                         * remember it first.
                         *
                         * **The row disappears from the fetch, not from the
                         * call.** `allRecords` is reassigned here, but the
                         * dataset does not re-read it until `fetched()` — so a
                         * control that deletes and forgets `dataset.refresh()`
                         * sees the row still on screen, which is exactly what a
                         * real form does. A stub that spliced the visible page
                         * would pass that control.
                         *
                         * **The rejection is a plain object.** See the note on
                         * `retrieveRecord` above; `webApiFails` is the switch.
                         */
                        deleteRecord: function (entityType, id) {
                            log('webAPI.deleteRecord', entityType + ' ' + id);

                            if (o.webApiFails) {
                                return Promise.reject({
                                    errorCode: 2147746581,
                                    message: 'The record could not be deleted.',
                                });
                            }

                            var gone = allRecords.filter(function (row) {
                                return row.id === id;
                            })[0];

                            if (removedPending.indexOf(id) === -1 && removed.indexOf(id) === -1) {
                                removedPending.push(id);
                            }

                            selected = selected.filter(function (chosen) {
                                return chosen !== id;
                            });

                            var primary = columns.filter(function (column) {
                                return column.isPrimary;
                            })[0];

                            return Promise.resolve({
                                entityType: entityType,
                                id: id,
                                name: gone && primary ? formatted(gone.values[primary.name]) : '',
                            });
                        },
                    }
                    : undefined,

                navigation: buildNavigation(),

                resources: {
                    getString:
                        o.getString
                        || function (key) {
                            return STRINGS[key] !== undefined ? STRINGS[key] : key;
                        },
                },

                // Absent on a host that publishes no theme — canvas, and the
                // hub's own demo harness.
                fluentDesignLanguage: hostKind.publishesTheme
                    ? { isDarkTheme: Boolean(o.dark), tokenTheme: o.tokenTheme }
                    : undefined,

                userSettings: buildUserSettings(o, log),

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
                 * What changed since the last pass, the way the platform says
                 * it: the names `setInput` set since the previous context,
                 * handed over once and then cleared. Empty on every pass a
                 * caller did not change an input before, which is what the
                 * first call carries too.
                 */
                updatedProperties: state.changedInputs.splice(0),
            };

            /*
             * Deleted rather than never defined, so the literal above stays one
             * readable shape. A host that lacks full screen is a real host.
             */
            if (!quirks.hasFullScreen) {
                delete context.mode.setFullScreen;
            }

            return context;
        }

        return {
            dataset: dataset,
            context: createContext(),
            /** A fresh context object, as the platform hands down each pass. */
            nextContext: createContext,
            /**
             * Change one of the control's inputs on a **mounted** control —
             * the host the hub's demo is, and neither a form nor this rig
             * was until 2026-09-17.
             *
             * On a form an input is set at design time and never moves. The
             * hub's demo switches presets on a control that is already
             * mounted, and `pcf-calendar-view` 0.1.3 found that a value read
             * into React state once, at mount, stayed on the old preset while
             * the property panel said otherwise. The next context carries
             * the new `raw` and names the input in `updatedProperties`; a
             * control that copied its inputs in `init` and never reads them
             * again is what an assertion on the props after `settle()`
             * catches. Whether a component *re-applies* a changed prop to
             * its own state is React's half, and a static render cannot
             * hold state between passes — that half is the hub's demo to
             * verify, and this half is what stops the control from being
             * the reason it fails.
             */
            setInput: function (name, value) {
                o.inputs[name] = value;
                state.changedInputs.push(name);
                state.renderOwed = true;
            },
            state: state,
            quirks: quirks,
            options: o,
            /** True while the control has asked for data it has not re-rendered against. */
            renderOwed: function () {
                return state.renderOwed;
            },
            settled: function () {
                state.renderOwed = false;
            },
            /**
             * The host re-reading after a write — a separate fetch from the
             * `save()` that resolved.
             *
             * Values committed by `record.save()` become visible on the
             * records only here. Until it is called, a control's own override
             * is the only thing holding the new value on screen, which is the
             * state a control that retires its override too early gets wrong:
             * on a form the cell visibly jumps back and then forward.
             */
            reread: function () {
                allRecords.forEach(function (row) {
                    if (!row.committed) {
                        return;
                    }

                    Object.keys(row.committed).forEach(function (name) {
                        row.values[name] = row.committed[name];
                    });
                    row.committed = null;
                });

                state.renderOwed = true;
            },
            /**
             * What the server holds for one cell, untouched by `getValue`'s
             * shaping. `getValue` on a choice hands back a string, as the
             * platform does, so it cannot say whether the control *wrote* the
             * integer `setValue` wants — this can.
             */
            stored: function (id, name) {
                var row = allRecords.filter(function (candidate) {
                    return candidate.id === id;
                })[0];

                return row ? row.values[name] : undefined;
            },
        };
    }

    /**
     * Render until the control stops asking for more, and say how many passes
     * it took.
     *
     * This is the single most useful thing this file does. A dataset control's
     * mutators — `setPageSize`, `refresh`, `loadExactPage` — all end in a new
     * `updateView`, so an unguarded one is an infinite loop that a browser
     * shows as a hang and a rendered table shows as nothing at all. Here it is
     * a number: **a settled control renders twice** (once, then once more for
     * the page size it asked for), and anything that keeps climbing to the
     * limit is the loop.
     */
    function drive(instance, handle, limit) {
        var passes = 0;
        var max = limit || 10;
        var element;

        do {
            handle.settled();
            element = instance.updateView(handle.nextContext());
            passes += 1;
        } while (handle.renderOwed() && passes < max);

        /*
         * `element` is what a *virtual* control returned on the last pass, and
         * `undefined` for a standard one, which wrote into its container
         * instead. Handing it back is what lets one set of assertions read
         * either shape — a virtual dataset control's decisions are all in the
         * props it passed down.
         */
        return { passes: passes, looping: handle.renderOwed(), element: element };
    }

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
        ASCENDING: ASCENDING,
        DESCENDING: DESCENDING,
        AND: AND,
        OR: OR,
        OPERATOR: OPERATOR,
        FORM_FACTORS: FORM_FACTORS,
        HOSTS: HOSTS,
        STRINGS: STRINGS,
        DEFAULTS: DEFAULTS,
        createHost: createHost,
        drive: drive,
        captureRegistration: captureRegistration,
    };
});

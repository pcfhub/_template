/*
 * The stand-in grid: enough of the host for a customizer to run against.
 *
 * Loaded before the control bundle, because the bundle registers itself on load
 * and needs somewhere to register. Everything it needs is set up here and the
 * page calls `window.__harnessStart()` once the bundle has run.
 *
 * Read `harness.html` first — it says what this is for and what it is not.
 */

(function () {
    'use strict';

    /* ------------------------------------------------------------- fixture */

    /*
     * One row shape covering the column types a customizer is most likely to
     * override, with values chosen to hit the edges rather than the middle:
     * a zero, a negative, a null, a value above its declared maximum, and a
     * value that is exactly the declared minimum.
     *
     * Inline rather than read from `demo/`, because this page runs over
     * `file://` where `fetch` is blocked. When you change one, consider whether
     * the other wants the same change — they describe the same grid for two
     * different harnesses.
     */
    var COLUMNS = [
        { name: 'name', displayName: 'Account', dataType: 'SingleLine.Text', columnDataType: 'Text', isPrimary: true },
        { name: 'creditlimit', displayName: 'Credit limit', dataType: 'Currency', columnDataType: 'Currency', isPrimary: false, rightAligned: true },
        { name: 'satisfaction', displayName: 'Satisfaction', dataType: 'Decimal', columnDataType: 'Decimal', isPrimary: false, rightAligned: true },
        { name: 'variance', displayName: 'Variance', dataType: 'Decimal', columnDataType: 'Decimal', isPrimary: false, rightAligned: true },
        { name: 'employees', displayName: 'Employees', dataType: 'Whole.None', columnDataType: 'Integer', isPrimary: false, rightAligned: true },
    ];

    var ROWS = [
        { __rec_id: '1', name: 'Northwind Traders', creditlimit: 125000, satisfaction: 88, variance: 12.5, employees: 420 },
        { __rec_id: '2', name: 'Contoso Ltd', creditlimit: 250000, satisfaction: 100, variance: -38, employees: 1800 },
        { __rec_id: '3', name: 'Fabrikam', creditlimit: 0, satisfaction: 0, variance: 0, employees: 12 },
        { __rec_id: '4', name: 'Adventure Works', creditlimit: 410000, satisfaction: 61, variance: -4.25, employees: 95 },
        { __rec_id: '5', name: 'Litware', creditlimit: null, satisfaction: 44, variance: 27, employees: null },
    ];

    /*
     * The ranges the fake metadata declares, and the reason the "Columns
     * declare a range" switch exists: a control that reads
     * `MinValue`/`MaxValue` has two behaviours, and the one where the metadata
     * says nothing is the one that ships to most columns on most tables. It is
     * worth being able to see it on purpose.
     *
     * `employees` is deliberately left out — an unbounded column beside bounded
     * ones, which is what a real table looks like.
     */
    var BOUNDS = {
        creditlimit: { MinValue: 0, MaxValue: 250000 },
        satisfaction: { MinValue: 0, MaxValue: 100 },
        variance: { MinValue: -50, MaxValue: 50 },
    };

    var STRINGS = {
        Loading_Label: 'Loading rows',
        NoRows_Title: 'This view is empty',
        NoRows_Body: 'There is nothing to show with the current view and filters.',
    };

    /* ------------------------------------------------------- host plumbing */

    var registered = null;
    var payload = null;

    /*
     * What the bundle looks for on load. The real platform defines this; so
     * does PCFHub's demo harness, which is why the release workflow can attach
     * the ordinary build output and have it work as a demo.
     *
     * **Two arguments, not three.** `pcf-scripts` emits
     * `registerControl('Namespace.Control', ctor)` — the namespace and the
     * constructor name arrive already joined into one string. Reading the
     * constructor from a third parameter yields `undefined`, and the failure
     * surfaces later as "registered is not a constructor" rather than here.
     */
    window.ComponentFramework = window.ComponentFramework || {};
    window.ComponentFramework.registerControl = function (fullName, ctor) {
        registered = ctor;
    };

    function buildContext(options) {
        return {
            parameters: {
                // Any non-empty string. The control does not invent one and
                // returns at its own guard if this is empty — which is exactly
                // what it should do anywhere that is not a customized grid.
                EventName: { raw: 'harness-customizer-event' },
            },

            factory: {
                fireEvent: function (name, fired) {
                    payload = fired;
                },
                requestRender: function () {},
            },

            resources: {
                getString: function (key) {
                    // Falls back to the key, which is what the platform does
                    // for a key missing from a `.resx` — so a typo looks here
                    // the way it looks in production.
                    return STRINGS[key] !== undefined ? STRINGS[key] : key;
                },
            },

            utils: {
                getEntityMetadata: function () {
                    return Promise.resolve({
                        // `.get()` rather than a plain object, because that is
                        // the shape the platform returns: the public surface is
                        // prototype getters and a `Map`-like `Attributes`
                        // collection, and code that walks it with `Object.keys`
                        // sees private fields instead. A fixture that used a
                        // plain object would let that mistake pass here and
                        // fail on a real grid.
                        Attributes: {
                            get: function (columnName) {
                                if (!options.bounds) {
                                    return undefined;
                                }

                                return BOUNDS[columnName];
                            },
                        },
                    });
                },
            },

            // Both candidates a customizer has for learning its own table.
            // Neither is declared in @types/powerapps-component-framework, so
            // both are guesses until confirmed on a real grid — see SPEC.md.
            mode: { contextInfo: { entityTypeName: 'account' } },
            page: { entityTypeName: 'account' },

            fluentDesignLanguage: { isDarkTheme: options.dark },

            userSettings: { languageId: 1033 },
        };
    }

    /* ------------------------------------------------------------ rendering */

    function cellRendererFor(columnDataType) {
        var overrides = (payload && payload.cellRendererOverrides) || {};

        return overrides[columnDataType];
    }

    function renderCell(column, columnIndex, row) {
        var override = cellRendererFor(column.columnDataType);
        var value = row[column.name];
        var formatted = value === null || value === undefined ? '' : String(value);

        if (override) {
            var element = override(
                {
                    value: value,
                    formattedValue: formatted,
                    columnDataType: column.columnDataType,
                    isRightAligned: Boolean(column.rightAligned),
                    rowHeight: 42,
                    columnEditable: true,
                    isRTLMode: false,
                    // Always clear here. A fixture carries no attribute
                    // metadata and no save, so `validationError`, `secured` and
                    // `isRequired` are states this harness cannot produce —
                    // which means the branches that handle them are exactly the
                    // ones it cannot check. Confirm those on a real grid.
                    validationError: null,
                },
                {
                    colDefs: COLUMNS,
                    columnIndex: columnIndex,
                    rowData: { __rec_id: row.__rec_id },
                    allowTabKeyNavigation: false,
                },
            );

            // `undefined` or `null` means "the grid draws this one" — the
            // documented way to decline, and the common answer rather than the
            // exceptional one. The plain text below is this harness standing in
            // for the grid's own rendering.
            if (element !== undefined && element !== null) {
                return element;
            }
        }

        return formatted;
    }

    function gridTemplate() {
        return { display: 'grid', gridTemplateColumns: '2fr repeat(' + (COLUMNS.length - 1) + ', 1fr)' };
    }

    function renderGrid() {
        var React = window.React;

        var header = React.createElement(
            'div',
            { className: 'harness-headrow', style: gridTemplate() },
            COLUMNS.map(function (column) {
                return React.createElement('div', { className: 'harness-cell', key: column.name }, column.displayName);
            }),
        );

        var rows = ROWS.map(function (row) {
            return React.createElement(
                'div',
                { className: 'harness-row', style: gridTemplate(), key: row.__rec_id },
                COLUMNS.map(function (column, index) {
                    return React.createElement(
                        'div',
                        { className: 'harness-cell', key: column.name },
                        renderCell(column, index, row),
                    );
                }),
            );
        });

        return React.createElement('div', { className: 'harness-grid' }, [header].concat(rows));
    }

    /*
     * The `gridCustomizer` half of the payload — the members PCFHub's harness
     * does not call, which is most of the reason this file exists.
     */
    function renderChrome() {
        var React = window.React;
        var customizer = (payload && payload.gridCustomizer) || {};
        var panels = [];

        if (customizer.GetLoadingRowRenderer) {
            panels.push(React.createElement('h2', { key: 'lh' }, 'Loading row'));
            panels.push(
                React.createElement(
                    'div',
                    { className: 'harness-grid', key: 'lb' },
                    [0, 1, 2, 3].map(function (index) {
                        return React.createElement(
                            'div',
                            { className: 'harness-slot', key: index },
                            customizer.GetLoadingRowRenderer(),
                        );
                    }),
                ),
            );
        }

        if (customizer.GetNoRowsOverlayConfiguration) {
            var config = customizer.GetNoRowsOverlayConfiguration();

            panels.push(React.createElement('h2', { key: 'eh' }, 'No rows overlay'));
            panels.push(
                React.createElement(
                    'div',
                    { className: 'harness-grid harness-overlay', key: 'eb' },
                    config.component
                        ? React.createElement(config.component, config.props)
                        : 'GetNoRowsOverlayConfiguration returned no component.',
                ),
            );
        }

        if (customizer.GetHeaderRenderer) {
            panels.push(React.createElement('h2', { key: 'hh' }, 'Header'));
            panels.push(
                React.createElement(
                    'div',
                    { className: 'harness-headrow harness-grid', style: gridTemplate(), key: 'hb' },
                    COLUMNS.map(function (column, index) {
                        return React.createElement(
                            'div',
                            { className: 'harness-cell', key: column.name },
                            customizer.GetHeaderRenderer({
                                colDefs: COLUMNS,
                                columnIndex: index,
                                isFirstVisualColumn: index === 0,
                                isLastVisualColumn: index === COLUMNS.length - 1,
                                isRTLMode: false,
                                allowTabKeyNavigation: false,
                            }),
                        );
                    }),
                ),
            );
        }

        return panels;
    }

    /* --------------------------------------------------------------- driver */

    var instance = null;

    function run() {
        var React = window.React;
        var options = {
            dark: document.getElementById('harness-dark').checked,
            bounds: document.getElementById('harness-bounds').checked,
        };

        payload = null;

        if (instance && instance.destroy) {
            instance.destroy();
        }

        var context = buildContext(options);

        instance = new registered();
        instance.init(context, function () {}, {}, document.createElement('div'));
        instance.updateView(context);

        var status = document.getElementById('harness-status');

        if (!payload) {
            status.textContent = 'The control fired nothing — check its EventName guard.';

            return;
        }

        status.textContent =
            'Fired: ' +
            Object.keys(payload)
                .filter(function (key) {
                    return payload[key];
                })
                .join(', ');

        /*
         * A tick before rendering, because the metadata a customizer may depend
         * on resolves from a promise and nothing can force the grid to redraw
         * when it lands — see the control's SPEC.md. Waiting here is this
         * harness being *kinder* than the platform: on a real grid the first
         * paint may genuinely happen before the metadata arrives.
         */
        setTimeout(function () {
            window.ReactDOM.render(
                React.createElement(
                    'div',
                    null,
                    [React.createElement('h2', { key: 'ch' }, 'Cells'), renderGrid()].concat(renderChrome()),
                ),
                document.getElementById('harness-root'),
            );
        }, 0);
    }

    window.__harnessStart = function () {
        if (!registered) {
            document.getElementById('harness-status').textContent =
                'No control registered — run npm run build, then reload.';

            return;
        }

        document.getElementById('harness-dark').addEventListener('change', run);
        document.getElementById('harness-bounds').addEventListener('change', run);

        run();
    };
})();

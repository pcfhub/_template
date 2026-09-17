/*
 * What the Web API answers from — the rows behind `retrieveRecord` and
 * `retrieveMultipleRecords` — and what the same-origin metadata `fetch`
 * describes. Loaded by `harness.html` in a browser and `smoke.js` in Node, so
 * it attaches to `window` *and* assigns `module.exports`, like `host.js`.
 *
 * Rows are in the **Web API's own shape**, because that is what a control
 * reads: the primary key under its logical name, a lookup as
 * `_<column>_value`, a formatted value under `<column>@OData.Community.
 * Display.V1.FormattedValue`. A fixture in a tidier shape would let a control
 * pass here that reads `row.parentaccountid` and gets `undefined` on a form.
 *
 * `hierarchy` names the parent column per table — how the rig knows what
 * `above` and `under` mean — and `relationships` is what
 * `EntityDefinitions(…)/OneToManyRelationships` lists, with `IsHierarchical`
 * read off `hierarchical`. `masterid` is there on purpose: a second
 * self-referential lookup on the same table that is *not* hierarchical, so a
 * control can be shown taking the other route.
 *
 * Nine accounts, four levels deep. `c1` is the record most suites sit on: it
 * has a parent, a grandparent, a sibling, two children and a grandchild. One
 * row has a null detail and one has a name long enough to wrap.
 */
(function (root, factory) {
    'use strict';

    var api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.__pcfFixture = api;
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    var F = '@OData.Community.Display.V1.FormattedValue';

    function account(id, name, parent, city, revenue) {
        var row = { accountid: id, name: name, _parentaccountid_value: parent };

        row['_parentaccountid_value' + F] = parent === null ? undefined : NAMES[parent];
        row.address1_city = city;
        row.revenue = revenue;
        row['revenue' + F] = revenue === null ? undefined : '$' + revenue.toLocaleString('en-US', { minimumFractionDigits: 2 });

        // A null column has no formatted value, and the Web API omits the
        // annotation rather than sending it empty.
        Object.keys(row).forEach(function (key) {
            if (row[key] === undefined) {
                delete row[key];
            }
        });

        return row;
    }

    var NAMES = {
        r1: 'Contoso Holdings',
        p1: 'Contoso Europe',
        c1: 'Contoso Deutschland GmbH',
        s1: 'Contoso France SARL',
        k1: 'Contoso Berlin',
        k2: 'Contoso München — Niederlassung Süd, Vertrieb und Service',
        g1: 'Contoso Berlin Mitte',
        o1: 'Contoso Americas',
        o2: 'Contoso Canada',
    };

    return {
        tables: {
            account: [
                account('r1', NAMES.r1, null, 'Redmond', 1200000000),
                account('p1', NAMES.p1, 'r1', 'Amsterdam', 340000000),
                account('c1', NAMES.c1, 'p1', 'Frankfurt', 120000000),
                account('s1', NAMES.s1, 'p1', 'Paris', 98000000),
                account('k1', NAMES.k1, 'c1', 'Berlin', 15000000),
                account('k2', NAMES.k2, 'c1', null, null),
                account('g1', NAMES.g1, 'k1', 'Berlin', 2000000),
                account('o1', NAMES.o1, 'r1', 'New York', 610000000),
                account('o2', NAMES.o2, 'o1', 'Toronto', 74000000),
            ],
        },

        hierarchy: {
            account: { id: 'accountid', parent: 'parentaccountid', name: 'name' },
        },

        relationships: [
            {
                entity: 'account',
                column: 'parentaccountid',
                target: 'account',
                navigationProperty: 'parentaccountid',
                schemaName: 'account_parent_account',
                hierarchical: true,
            },
            {
                entity: 'account',
                column: 'masterid',
                target: 'account',
                navigationProperty: 'masterid',
                schemaName: 'account_master_account',
                hierarchical: false,
            },
            {
                entity: 'account',
                column: 'primarycontactid',
                target: 'contact',
                navigationProperty: 'primarycontactid',
                schemaName: 'account_primary_contact',
                hierarchical: false,
            },
        ],

        entitySets: {
            account: 'accounts',
            contact: 'contacts',
        },

        /** The record most suites sit on, and its parent as the bound lookup would hand it over. */
        current: 'c1',
        parentLookup: [{ id: 'p1', name: NAMES.p1, entityType: 'account' }],
    };
});

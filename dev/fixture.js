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
 *
 * `tables.audit` is the audit table as `retrieveMultipleRecords('audit', …)`
 * answers it — twenty-six rows on `c1` (three pages of ten), three on `p1` —
 * and `audits.details` is what the `RetrieveAuditDetails` function answers
 * per row, keyed by `auditid`: a Create, Updates that set a lookup, clear a
 * column, change a choice and reassign the owner, a Memo cut at the 5 KB cap,
 * a status change, a Share and a Relationship. The who and the when live on
 * the row only — no `AuditDetail` carries an `AuditRecord`, which is the
 * documented shape and the reason a control reads both.
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
    var L = '@Microsoft.Dynamics.CRM.lookuplogicalname';
    var N = '@Microsoft.Dynamics.CRM.associatednavigationproperty';

    function account(id, name, parent, city, revenue) {
        var row = { accountid: id, name: name, _parentaccountid_value: parent };

        row['_parentaccountid_value' + F] = parent === null ? undefined : NAMES[parent];
        // A populated lookup arrives with its two annotations beside the
        // formatted value — the platform's own shape on a retrieveRecord,
        // and what an audit's old side carries for a lookup (SPEC.md P5).
        row['_parentaccountid_value' + L] = parent === null ? undefined : 'account';
        row['_parentaccountid_value' + N] = parent === null ? undefined : 'parentaccountid';
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

    var T = '@odata.type';

    var USERS = {
        alex: { id: 'u0000000-0000-0000-0000-00000000000a', name: 'Alex Chen' },
        priya: { id: 'u0000000-0000-0000-0000-00000000000b', name: 'Priya Raman' },
        system: { id: 'u0000000-0000-0000-0000-000000000001', name: 'SYSTEM' },
    };

    var ACTIONS = {
        1: 'Create', 2: 'Update', 3: 'Delete', 12: 'Merge', 13: 'Assign', 14: 'Share',
        33: 'Associate Entities', 34: 'Disassociate Entities', 41: 'Set State', 48: 'Modify Share', 49: 'Unshare',
    };

    /** An audit row in the Web API's shape, its `createdon` `hours` before the newest. */
    function audit(n, hours, user, action, objectId, mask) {
        var when = new Date(Date.UTC(2026, 8, 18, 14, 5, 0) - hours * 3600 * 1000);
        var row = {
            auditid: 'a0000000-0000-0000-0000-' + ('000000000000' + n).slice(-12),
            createdon: when.toISOString().replace(/\.\d{3}Z$/, 'Z'),
            action: action,
            operation: action === 1 ? 1 : action === 3 ? 3 : 2,
            _userid_value: user.id,
            _objectid_value: objectId,
            objecttypecode: 'account',
            transactionid: 't0000000-0000-0000-0000-' + ('000000000000' + n).slice(-12),
            attributemask: mask || ',10,',
        };
        var pad = function (v) { return v < 10 ? '0' + v : String(v); };
        var h = when.getUTCHours();

        row['createdon' + F] = (when.getUTCMonth() + 1) + '/' + when.getUTCDate() + '/' + when.getUTCFullYear()
            + ' ' + (h % 12 || 12) + ':' + pad(when.getUTCMinutes()) + ' ' + (h < 12 ? 'AM' : 'PM');
        row['action' + F] = ACTIONS[action] || String(action);
        row['operation' + F] = row.operation === 1 ? 'Create' : row.operation === 3 ? 'Delete' : 'Update';
        row['_userid_value' + F] = user.name;
        row['_userid_value' + L] = 'systemuser';
        row['_objectid_value' + F] = NAMES[objectId];
        row['_objectid_value' + L] = 'account';

        return row;
    }

    /** An AttributeAuditDetail from two plain bags — the `@odata.type` the server adds is added here. */
    function change(oldBag, newBag, deleted) {
        var typed = function (bag) {
            var out = {};
            out[T] = '#Microsoft.Dynamics.CRM.account';
            Object.keys(bag || {}).forEach(function (key) { out[key] = bag[key]; });
            return out;
        };
        var detail = {};

        detail[T] = '#Microsoft.Dynamics.CRM.AttributeAuditDetail';
        detail.InvalidNewValueAttributes = [];
        detail.LocLabelLanguageCode = 0;
        detail.DeletedAttributes = { Count: (deleted || []).length, Keys: deleted || [], Values: (deleted || []).map(function () { return ''; }) };
        detail.OldValue = typed(oldBag);
        detail.NewValue = typed(newBag);

        return detail;
    }

    function lookupBag(column, id, name, table) {
        var bag = {};
        bag['_' + column + '_value'] = id;
        bag['_' + column + '_value' + F] = name;
        bag['_' + column + '_value' + N] = column;
        bag['_' + column + '_value' + L] = table;
        return bag;
    }

    function choiceBag(column, value, label) {
        var bag = {};
        bag[column] = value;
        bag[column + F] = label;
        return bag;
    }

    var LONG = (function () {
        var text = '';
        while (text.length < 4999) {
            text += 'The quick brown fox jumps over the lazy dog. ';
        }
        return text.slice(0, 4999) + '…';
    })();

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

    /*
     * [row, detail] pairs, newest first. Every plain Update below is one
     * column; #25 is two at once, #26 is the Create at the bottom of the
     * history. The cleared column (#3) is modelled as absent from NewValue
     * with its key in DeletedAttributes — pcf-audit-history's SPEC.md P5
     * records the shape the form actually sends, and this follows it.
     */
    var HISTORY = [
        [audit(1, 0, USERS.alex, 2, 'c1'), change({ name: 'Contoso Deutschland' }, { name: NAMES.c1 })],
        [audit(2, 2, USERS.priya, 2, 'c1'), change({}, lookupBag('parentaccountid', 'p1', NAMES.p1, 'account'))],
        [audit(3, 5, USERS.alex, 2, 'c1'), change({ websiteurl: 'https://www.contoso.de' }, {}, ['websiteurl'])],
        [audit(4, 9, USERS.alex, 2, 'c1'), change(choiceBag('industrycode', 1, 'Accounting'), choiceBag('industrycode', 3, 'Business Services'))],
        [audit(5, 26, USERS.priya, 2, 'c1'), change({ description: 'German subsidiary.' }, { description: LONG })],
        [audit(6, 30, USERS.system, 41, 'c1'), change(
            Object.assign(choiceBag('statecode', 0, 'Active'), choiceBag('statuscode', 1, 'Active')),
            Object.assign(choiceBag('statecode', 1, 'Inactive'), choiceBag('statuscode', 2, 'Inactive')))],
        [audit(7, 50, USERS.alex, 13, 'c1'), change(
            lookupBag('ownerid', USERS.alex.id, USERS.alex.name, 'systemuser'),
            lookupBag('ownerid', 'e0000000-0000-0000-0000-000000000005', 'Sales EMEA', 'team'))],
        [audit(8, 52, USERS.priya, 14, 'c1'), (function () {
            var d = {};
            d[T] = '#Microsoft.Dynamics.CRM.ShareAuditDetail';
            d.OldPrivileges = 'None';
            d.NewPrivileges = 'ReadAccess, WriteAccess';
            d.Principal = { '@odata.type': '#Microsoft.Dynamics.CRM.systemuser', systemuserid: USERS.alex.id, fullname: USERS.alex.name };
            return d;
        })()],
        [audit(9, 75, USERS.alex, 33, 'c1'), (function () {
            var d = {};
            d[T] = '#Microsoft.Dynamics.CRM.RelationshipAuditDetail';
            d.RelationshipName = 'accountleads_association';
            d.TargetRecords = [{ '@odata.type': '#Microsoft.Dynamics.CRM.lead', leadid: 'l0000000-0000-0000-0000-000000000001', fullname: 'Nina Vogel' }];
            return d;
        })()],
        [audit(10, 80, USERS.alex, 2, 'c1'), change(
            { revenue: 100000000, 'revenue@OData.Community.Display.V1.FormattedValue': '$100,000,000.00' },
            { revenue: 120000000, 'revenue@OData.Community.Display.V1.FormattedValue': '$120,000,000.00' })],
        [audit(11, 100, USERS.priya, 2, 'c1'), change({ address1_city: 'Bonn' }, { address1_city: 'Frankfurt' })],
        [audit(12, 120, USERS.alex, 2, 'c1'), change({ telephone1: '+49 69 1234' }, { telephone1: '+49 69 5678' })],
        [audit(13, 140, USERS.alex, 2, 'c1'), change({ emailaddress1: 'info@contoso.de' }, { emailaddress1: 'hello@contoso.de' })],
        [audit(14, 160, USERS.priya, 2, 'c1'), change(
            { numberofemployees: 120, 'numberofemployees@OData.Community.Display.V1.FormattedValue': '120' },
            { numberofemployees: 150, 'numberofemployees@OData.Community.Display.V1.FormattedValue': '150' })],
        [audit(15, 180, USERS.alex, 2, 'c1'), change({ name: 'Contoso DE' }, { name: 'Contoso Deutschland' })],
        [audit(16, 200, USERS.priya, 2, 'c1'), change({ fax: '+49 69 0000' }, { fax: '+49 69 0001' })],
        [audit(17, 220, USERS.alex, 2, 'c1'), change(
            { creditlimit: 50000, 'creditlimit@OData.Community.Display.V1.FormattedValue': '$50,000.00' },
            { creditlimit: 75000, 'creditlimit@OData.Community.Display.V1.FormattedValue': '$75,000.00' })],
        [audit(18, 240, USERS.system, 2, 'c1'), change({ address1_postalcode: '60306' }, { address1_postalcode: '60311' })],
        [audit(19, 260, USERS.alex, 2, 'c1'), change({ websiteurl: 'https://contoso.de' }, { websiteurl: 'https://www.contoso.de' })],
        [audit(20, 280, USERS.priya, 2, 'c1'), change(choiceBag('accountcategorycode', 2, 'Standard'), choiceBag('accountcategorycode', 1, 'Preferred Customer'))],
        [audit(21, 300, USERS.alex, 2, 'c1'), change({ address1_line1: 'Hauptstraße 1' }, { address1_line1: 'Hauptstraße 12' })],
        [audit(22, 320, USERS.alex, 2, 'c1'), change({ telephone1: '+49 69 0000' }, { telephone1: '+49 69 1234' })],
        [audit(23, 340, USERS.priya, 2, 'c1'), change({ tickersymbol: 'CNTS' }, { tickersymbol: 'CTSO' })],
        [audit(24, 360, USERS.alex, 2, 'c1'), change(choiceBag('donotemail', false, 'Allow'), choiceBag('donotemail', true, 'Do Not Allow'))],
        [audit(25, 400, USERS.priya, 2, 'c1', ',10,42,'), change(
            { address1_city: 'Berlin', address1_postalcode: '10115' },
            { address1_city: 'Bonn', address1_postalcode: '60306' })],
        [audit(26, 480, USERS.alex, 1, 'c1'), change({}, Object.assign(
            { name: 'Contoso DE', address1_city: 'Berlin', revenue: 100000000, 'revenue@OData.Community.Display.V1.FormattedValue': '$100,000,000.00' },
            choiceBag('statecode', 0, 'Active')))],
        [audit(27, 3, USERS.priya, 2, 'p1'), change({ address1_city: 'Rotterdam' }, { address1_city: 'Amsterdam' })],
        [audit(28, 90, USERS.alex, 2, 'p1'), change({ name: 'Contoso EMEA' }, { name: NAMES.p1 })],
        [audit(29, 500, USERS.alex, 1, 'p1'), change({}, { name: 'Contoso EMEA', address1_city: 'Rotterdam' })],
    ];

    var DETAILS = {};
    HISTORY.forEach(function (pair) { DETAILS[pair[0].auditid] = pair[1]; });

    return {
        tables: {
            audit: HISTORY.map(function (pair) { return pair[0]; }),
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
            audit: 'audits',
        },

        /** What `audits(<id>)/Microsoft.Dynamics.CRM.RetrieveAuditDetails` answers, by row. */
        audits: { details: DETAILS },

        /** Display names `utils.getEntityMetadata(table, columns).Attributes` answers, per table. */
        labels: {
            account: {
                name: 'Account Name',
                parentaccountid: 'Parent Account',
                websiteurl: 'Website',
                industrycode: 'Industry',
                description: 'Description',
                statecode: 'Status',
                statuscode: 'Status Reason',
                ownerid: 'Owner',
                revenue: 'Annual Revenue',
                address1_city: 'Address 1: City',
                address1_line1: 'Address 1: Street 1',
                address1_postalcode: 'Address 1: ZIP/Postal Code',
                telephone1: 'Main Phone',
                fax: 'Fax',
                emailaddress1: 'Email',
                numberofemployees: 'Number of Employees',
                creditlimit: 'Credit Limit',
                accountcategorycode: 'Category',
                tickersymbol: 'Ticker Symbol',
                donotemail: 'Email',
            },
        },

        /** The users the audit rows name, for a suite that asserts on them. */
        users: USERS,

        /** The record most suites sit on, and its parent as the bound lookup would hand it over. */
        current: 'c1',
        parentLookup: [{ id: 'p1', name: NAMES.p1, entityType: 'account' }],
    };
});

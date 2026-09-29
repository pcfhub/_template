/*
 * _template/variants/lib/view-aggregate — the shapes
 *
 * SHARED. Copied into a control as <Control>/lib/view-aggregate/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Lifted 2026-09-29 from pcf-data-table 0.7.1 (itself generalised from
 * pcf-chart-view), whose SPEC.md carries every measurement cited below.
 */

/**
 * The shapes grouping is built out of. Pure types and two tables; no
 * `context`, no dataset, no DOM.
 *
 * Everything here is decided by what the probe measured on a real subgrid,
 * 2026-09-20 — see pcf-data-table SPEC.md 0.6.0. The two that shaped the file:
 *
 * - **A Choice group arrives as a `number` from the aggregate and can be the
 *   string `"1"` from a dataset record.** The same value, two types, depending
 *   which route read it. `GroupReading` is where that is reconciled, and it is
 *   the only place it can be, which is why both routes are made to produce this
 *   shape rather than their own.
 * - **A group whose value is null has its alias omitted from the row
 *   entirely** — not present-and-null. So a reading's value is `null` for a
 *   blank group, and the reader gets there by asking whether the key was
 *   there at all.
 */

/**
 * What a group column is, which decides three separate things: how its value
 * is read off an aggregate row, how the same value is read off a dataset
 * record, and whether a group of that kind can be **expanded** — because
 * expansion is a `FilterExpression` condition, and a kind that cannot be
 * spelled as one gets a header with no chevron rather than a chevron that
 * does nothing.
 */
export type GroupKind = 'text' | 'number' | 'choice' | 'boolean' | 'lookup' | 'date' | 'unsupported';

/**
 * The aggregate functions FetchXML offers that this control emits.
 *
 * `count` is not in the list because it is not a choice: it is asked for on
 * every query, over the primary key, whatever else is. A maker choosing
 * "count" is choosing *no measure*, which is the empty measure list.
 */
export type Aggregate = 'sum' | 'avg' | 'min' | 'max';

/** One measure: a function over a column, rendered as one extra column per group. */
export interface MeasureSpec {
    column: string;
    aggregate: Aggregate;
}

/** What the maker asked for, resolved against the view's real columns. */
export interface GroupSpec {
    /** The bound table's logical name. */
    entity: string;
    /**
     * The primary key, which `count` is taken over.
     *
     * **Not readable from `dataset.columns`** — measured: the layout carries
     * ten columns and the primary key is not among them, though the view's own
     * FetchXML selects it. So this is resolved from metadata or derived, and
     * `{entity}id` is wrong for every activity table.
     */
    primaryId: string;
    groups: { column: string; kind: GroupKind }[];
    measures: MeasureSpec[];
}

/**
 * The aliases one query uses, generated from the spec rather than fixed.
 *
 * `pcf-chart-view` froze five names because it groups by one column and
 * measures one thing. A table wants N and M, so the names are positional —
 * `g0`, `g1`, `m0`, `m1` — and the same plan is handed to the query builder
 * and to the row reader, so neither can disagree with the other about what a
 * key means. It also turns the reader from a switch into a loop.
 *
 * Short for the same reason chart-view's were short, and **never a column
 * name**: an alias that collided with one would be ambiguous in the row.
 */
export interface AliasPlan {
    groups: { alias: string; column: string; kind: GroupKind }[];
    /** Always present. The caption and every header need it whatever the measures are. */
    count: string;
    measures: { alias: string; column: string; aggregate: Aggregate }[];
}

/**
 * One group, as either route produces it.
 *
 * **This is the seam.** The server route builds it from an aggregate row and
 * the browser route builds it from the loaded records, and the arithmetic and
 * rendering downstream cannot tell which — that is what makes a fixture-driven
 * assertion a fair test of the server path, and what makes "the two routes
 * agree" a thing a suite can check rather than a thing to hope for.
 */
export interface GroupReading {
    /**
     * The per-column keys joined with `\u0000`.
     *
     * Not `|`, and not `-`: a text group can contain any character a user can
     * type, so any printable separator is one a group value can also hold, and
     * two different groupings would collide on one key. A NUL cannot appear in
     * a Dataverse string.
     */
    key: string;
    /** One per group column, normalised: a Choice is always a number here, never `"1"`. */
    values: (string | number | null)[];
    /** One per group column, from the row's own `FormattedValue` — free on the server route. */
    labels: string[];
    /** The group's record count. 1 per record on the browser route; the server's `n` on the other. */
    count: number;
    /** One per measure, raw. A date measure is an ISO string; a numeric one is a number. */
    measures: (string | number | null)[];
    /**
     * One per measure, formatted.
     *
     * Kept rather than derived, because a date aggregate comes back as UTC
     * while its `FormattedValue` is in the Dataverse user's zone — measured
     * five hours apart. Rendering the raw would be wrong for every user not
     * sitting in UTC.
     */
    measureLabels: string[];
}

/** Which route answered, and therefore what the caption is allowed to claim. */
export type GroupSource = 'server' | 'client' | 'client-refused';

/** The joiner for a multi-column key. See `GroupReading.key`. */
export const KEY_SEPARATOR = '\u0000';

/**
 * The `dataType`s each kind covers, and the single place the mapping lives.
 *
 * `MultiSelectPicklist` is deliberately **absent from every entry**, so it
 * falls through to `unsupported` and is refused before a query is built. That
 * is a measured decision rather than a cautious one: the server does refuse it
 * (*"groupby cannot be specified for attribute type MultiSelectPickList"*),
 * but the refusal the *control* receives is a message template with an
 * unsubstituted `{0}` in it, which cannot be shown to anybody. So the question
 * is never asked.
 */
const KINDS: { kind: GroupKind; types: string[] }[] = [
    { kind: 'text', types: ['SingleLine.Text', 'SingleLine.TextArea', 'SingleLine.Email', 'SingleLine.Phone', 'SingleLine.URL', 'SingleLine.Ticker', 'Multiple'] },
    { kind: 'number', types: ['Whole.None', 'Decimal', 'Currency', 'FP'] },
    { kind: 'choice', types: ['OptionSet'] },
    { kind: 'boolean', types: ['TwoOptions'] },
    { kind: 'lookup', types: ['Lookup.Simple', 'Lookup.Customer', 'Lookup.Owner'] },
    { kind: 'date', types: ['DateAndTime.DateOnly', 'DateAndTime.DateAndTime'] },
];

/**
 * A column's `dataType` → the kind it groups as, vetoing what it does not
 * know rather than guessing — the same rule `filterKindFor` applies, for the
 * same reason: a wrong guess here becomes a server query, and a server query's
 * refusal is not always renderable.
 */
export function groupKindFor(dataType: string): GroupKind {
    const found = KINDS.find((entry) => entry.types.indexOf(dataType) !== -1);

    return found ? found.kind : 'unsupported';
}

/**
 * The numeric `dataType`s, which are the only ones `sum` and `avg` accept.
 *
 * Measured: `sum` over the primary key is refused outright — *"Aggregate AVG
 * or SUM is not supported for attribute of type primarykey"* — and the refusal
 * takes **the whole query** with it, group counts included. So a measure that
 * cannot be spelled is refused locally, or one bad measure costs the table its
 * rows rather than one column.
 */
export function measurableWith(dataType: string, aggregate: Aggregate): boolean {
    if (aggregate === 'min' || aggregate === 'max') {
        // Measured: min/max over a DateAndTime column is accepted, and is how
        // the M-measure half of the alias plan was proven on a table with no
        // numeric column at all.
        return groupKindFor(dataType) === 'number' || groupKindFor(dataType) === 'date';
    }

    return groupKindFor(dataType) === 'number';
}

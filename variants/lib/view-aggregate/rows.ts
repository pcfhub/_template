/*
 * _template/variants/lib/view-aggregate — an aggregate row, read
 *
 * SHARED. Copied into a control as <Control>/lib/view-aggregate/ and kept
 * current by `node ../_template/scripts/sync-rig.mjs --into .`. Edit the
 * template's copy and sync, never this one: an edited copy stops syncing.
 * Lifted 2026-09-29 from pcf-data-table 0.7.1 (itself generalised from
 * pcf-chart-view), whose SPEC.md carries every measurement cited below.
 */

/**
 * An aggregate result row → a `GroupReading`. The **server route**'s half of
 * the seam; `group/group.ts` is the other half and must agree with it.
 *
 * Pure. Every shape here was read off a real response on 2026-09-20 (SPEC.md
 * 0.6.0) rather than taken from documentation, and three of them are not what
 * the documentation would have suggested:
 *
 * - **A group whose value is null has its alias omitted from the row
 *   entirely** — no `g0`, and no `g0@…` annotations either. So "is this the
 *   blank group" is `hasOwnProperty`, never `=== null`.
 * - **Every alias carries its own `FormattedValue`**, groups and count alike,
 *   not just the first. Labels are free, which is why the server route needs
 *   no metadata call to name a group.
 * - **A lookup group carries a third annotation**, `lookuplogicalname`, naming
 *   the target table. So the annotation count per alias is two or three, and a
 *   reader assuming two is wrong on every lookup.
 */

import { AliasPlan, GroupKind, GroupReading, KEY_SEPARATOR } from './types';

const FORMATTED = '@OData.Community.Display.V1.FormattedValue';
const ATTRIBUTE_NAME = '@OData.Community.Display.V1.AttributeName';
const LOOKUP_TABLE = '@Microsoft.Dynamics.CRM.lookuplogicalname';

/** One aggregate row, as the Web API hands it over. */
export type AggregateRow = Record<string, unknown>;

const has = (row: AggregateRow, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(row, key);

const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value));

/**
 * A group value, normalised so the two routes cannot disagree about its type.
 *
 * **The measured problem this exists for:** a Choice arrives from the
 * aggregate as the number `1`, and from a dataset record as the string `"1"`.
 * Same column, same value, two types. Left alone, the server route and the
 * browser route would produce different keys for the same group and every
 * assertion that they agree would fail for a reason having nothing to do with
 * grouping.
 *
 * A lookup normalises to its bare lower-case GUID, which is what the aggregate
 * sends and what `group.ts` digs out of `{ etn, id: { guid }, name }`.
 */
export function readGroupValue(raw: unknown, kind: GroupKind): string | number | null {
    if (raw === null || raw === undefined) {
        return null;
    }

    if (kind === 'choice' || kind === 'number') {
        const asNumber = typeof raw === 'number' ? raw : Number(raw);

        return Number.isFinite(asNumber) ? asNumber : null;
    }

    if (kind === 'boolean') {
        // TwoOptions arrives as `true`/`false` from a record and as 0/1 from
        // the aggregate. Both become 0/1, because that is what a condition
        // takes when the group is expanded.
        if (typeof raw === 'boolean') {
            return raw ? 1 : 0;
        }

        const asNumber = Number(raw);

        return Number.isFinite(asNumber) ? asNumber : null;
    }

    if (kind === 'lookup') {
        return text(raw).replace(/[{}]/g, '').toLowerCase();
    }

    return text(raw);
}

/**
 * The key for one group: the per-column keys joined with NUL.
 *
 * `\u0000` rather than any printable separator, because a text group can hold
 * anything a user can type — including whatever separator looked safe — and
 * two different groupings colliding on one key is a wrong answer with no
 * symptom. A NUL cannot occur in a Dataverse string.
 *
 * A blank group's segment is the empty string, which is distinguishable from
 * a group whose text value *is* empty only by the `values` array beside it;
 * that is deliberate, since the two are the same group as far as a filter is
 * concerned.
 */
export const groupKeyOf = (values: (string | number | null)[]): string =>
    values.map((value) => (value === null ? '' : String(value))).join(KEY_SEPARATOR);

/**
 * One aggregate row → one reading.
 *
 * `blankLabel` is what a group with no value is called; it is passed in rather
 * than chosen here so the string stays in the resx with every other one.
 */
export function toGroupReading(row: AggregateRow, plan: AliasPlan, blankLabel: string): GroupReading {
    const values: (string | number | null)[] = [];
    const labels: string[] = [];

    for (const group of plan.groups) {
        if (!has(row, group.alias)) {
            // The blank group. The alias is absent, not null — measured.
            values.push(null);
            labels.push(blankLabel);

            continue;
        }

        values.push(readGroupValue(row[group.alias], group.kind));

        const formatted = text(row[`${group.alias}${FORMATTED}`]);

        // A text group has no FormattedValue distinct from its value, so fall
        // back to the value itself rather than rendering an empty header.
        labels.push(formatted !== '' ? formatted : text(row[group.alias]));
    }

    const rawCount = row[plan.count];
    const count = typeof rawCount === 'number' ? rawCount : Number(rawCount);

    const measures: (string | number | null)[] = [];
    const measureLabels: string[] = [];

    for (const measure of plan.measures) {
        if (!has(row, measure.alias)) {
            // A measure over a group whose every row is null comes back absent
            // in exactly the same way a blank group does — while `n` still
            // stands, because count counts rows rather than values.
            measures.push(null);
            measureLabels.push('');

            continue;
        }

        const raw = row[measure.alias];

        measures.push(typeof raw === 'number' || typeof raw === 'string' ? raw : null);

        /*
         * The formatted value is kept rather than derived. A date measure
         * comes back as UTC — `"2026-09-11T13:00:00Z"` — while its
         * FormattedValue reads `"9/11/2026 8:00 AM"`, five hours apart for
         * this user. Rendering the raw would be wrong for everyone outside
         * UTC, and re-deriving the offset here would duplicate work
         * `offsetReader` already does with the user's own setting.
         */
        measureLabels.push(text(row[`${measure.alias}${FORMATTED}`]));
    }

    return {
        key: groupKeyOf(values),
        values,
        labels,
        count: Number.isFinite(count) ? count : 0,
        measures,
        measureLabels,
    };
}

/**
 * The target table of a lookup group, from the row's own annotation.
 *
 * Free, and worth having: it is what an expansion or a navigation would
 * otherwise read from `ManyToOneRelationships` at the cost of a round trip.
 * Absent for every other kind.
 */
export const lookupTableOf = (row: AggregateRow, alias: string): string | null => {
    const value = row[`${alias}${LOOKUP_TABLE}`];

    return typeof value === 'string' && value !== '' ? value : null;
};

/**
 * Whether the response describes the query that was sent.
 *
 * Every alias comes back with an `AttributeName` annotation naming the column
 * it came from, so the response is self-describing and a mis-built query can
 * be *caught* rather than rendered as a mislabelled column. Cheap, and the
 * only integrity check available on a route whose output is otherwise
 * plausible whatever went in.
 *
 * An empty row list is not a disagreement — there is nothing to check.
 */
export function describesPlan(rows: AggregateRow[], plan: AliasPlan): boolean {
    const first = rows[0];

    if (!first) {
        return true;
    }

    const named = (alias: string, expected: string): boolean => {
        const actual = first[`${alias}${ATTRIBUTE_NAME}`];

        return typeof actual !== 'string' || actual === expected;
    };

    return plan.groups.every((group) => named(group.alias, group.column))
        && plan.measures.every((measure) => named(measure.alias, measure.column));
}

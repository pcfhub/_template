import { Label } from '@fluentui/react';
import * as React from 'react';
import { CellRendererOverrides, CellRendererProps } from '../types';

/**
 * How each column type draws when the cell is *not* being edited.
 *
 * Keyed by the grid's own column data type, so an override applies to every
 * column of that type on the grid the control is assigned to. Narrowing to one
 * column is done inside the function, off `colDefs[columnIndex].name` — the
 * second argument exists for exactly that, and it is almost always what you
 * want, because a customizer sees every column of that type on the table.
 *
 * Four rules from the platform documentation shape everything here, and each
 * one is easy to break without noticing:
 *
 *   1. **Return null or undefined to decline.** That is not a failure path — it
 *      is how a customizer says "this column is fine as it is", and the grid
 *      then draws the cell itself. A good customizer declines most cells.
 *   2. **These functions must be pure.** The grid calls them repeatedly, in an
 *      order it does not promise, and expects the same element back for the
 *      same inputs. No state, no side effects, no writing to the record.
 *   3. **Never render a different value than the cell holds.** Sorting and
 *      filtering happen on the server against the real value, so a cell that
 *      displays something else produces a grid that sorts "wrongly" in front of
 *      a user who is reading the thing it sorted. This is the rule that reads
 *      as a style note and is not — it is why the override below declines an
 *      unset value rather than inventing a display for it.
 *   4. **Stay cheap.** These run per cell, on a surface that re-renders as it
 *      scrolls. Anything you would not do in a scroll handler does not belong
 *      here — including measuring text.
 *
 * Replace the example below with the types you actually want to change. Every
 * `ColumnDataType` in `../types.ts` is a valid key.
 */
export const cellRendererOverrides: CellRendererOverrides = {
    /**
     * Text: an em dash for empty, and nothing else.
     *
     * A deliberately small example, because the shape matters more than the
     * styling: it declines far more cells than it draws. An override returning
     * an element for every text cell would replace the grid's own virtualized
     * rendering with this one on every row of every text column, for no visible
     * difference.
     */
    Text: (props) => {
        if (defersToGrid(props)) {
            return undefined;
        }

        const value = props.formattedValue ?? '';

        if (value !== '') {
            // The grid's own rendering is correct here; say so by declining.
            return undefined;
        }

        return (
            <Label className="__CONTROL__-cell __CONTROL__-empty" aria-label="No value">
                &mdash;
            </Label>
        );
    },
};

/**
 * Whether this cell is in a state the grid draws better than an override can.
 *
 * A renderer that returns an element replaces the *whole* cell, and the grid's
 * error affordance goes with it — the border, and the message the grid wired to
 * `cellErrorLabelId`. That label is an element the customizer does not own and
 * cannot rebuild, so a customizer that renders straight through a validation
 * error produces a cell that is quietly invalid and looks fine: nothing tells
 * the user, and the first signal that anything is wrong is a save that fails.
 *
 * Open every override with this check. It is the single most common thing a
 * customizer written from the sample gets wrong, because the sample's overrides
 * do not read `validationError` at all and nothing complains.
 */
function defersToGrid(props: CellRendererProps): boolean {
    return props.validationError != null;
}

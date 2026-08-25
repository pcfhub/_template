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
 *
 *      But **never decline because an answer has not arrived yet.** Declining
 *      is permanent for that cell: it becomes the grid's own, this control
 *      never hears about it again, and a customizer has no way to ask for a
 *      repaint — `PAOneGridCustomizer` carries no `PAGridAPI`, and re-firing
 *      the event does not redraw anything. A renderer that declines while
 *      waiting on a fetch produces a decoration that appears only on cells the
 *      user has clicked, and looks perfectly correct everywhere else. Keep the
 *      cell instead, render `props.formattedValue` alone, and have the element
 *      subscribe for the answer.
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
 * A fifth rule the documentation does not state, learned the hard way: an
 * element replaces the cell's **interactions** as well as its pixels, and the
 * one that goes is editing. Spread `cellHandlers(props)` onto whatever you
 * return — see its comment below.
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
            <Label
                className="__CONTROL__-cell __CONTROL__-empty"
                aria-label="No value"
                {...cellHandlers(props)}
            >
                &mdash;
            </Label>
        );
    },
};

/**
 * Everything the cell you replaced was doing besides drawing.
 *
 * **Spread this onto every element an override returns.** Returning an element
 * replaces the grid's own cell *and its interactions*, and the one that goes is
 * editing. Row selection survives, because the grid owns the row — so the cell
 * still highlights, takes a focus ring and looks entirely alive while refusing
 * to open an editor. A user clicks a value they can see is editable and nothing
 * happens, on every customized column, with nothing logged. It is invisible in
 * `dev/harness.html`, in a screenshot and in review.
 *
 * This is what those three fields on `CellRendererProps` are for.
 * `onCellClicked` is documented as "callback indicating the grid cell has been
 * clicked" — once you have drawn your own element, nothing else can raise it.
 * `startEditing` opens the editor directly, and `columnEditable` says whether
 * there is one to open. Both gestures are wired because which one the grid
 * turns into an edit is its own business and can differ between a grid with
 * *Enable editing* set and one without; `startEditing` on a cell already
 * editing is a no-op, so the overlap costs nothing.
 *
 * Do not add `tabIndex` or key handlers here. The grid owns cell focus and
 * keyboard navigation at the row level, so Enter and F2 never reached this
 * element, and a tabbable node inside the cell adds a second stop to a
 * roving-tabindex surface a customizer does not own.
 */
function cellHandlers(props: CellRendererProps): {
    onClick?: (event: React.MouseEvent<HTMLElement>) => void;
    onDoubleClick?: () => void;
} {
    return {
        onClick: props.onCellClicked,
        onDoubleClick: props.columnEditable
            ? () => props.startEditing?.()
            : undefined,
    };
}

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

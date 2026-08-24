import { ITextFieldStyles, TextField } from '@fluentui/react';
import * as React from 'react';
import { CellEditorOverrides, GetEditorParams } from '../types';

/**
 * How each column type behaves once the cell *is* being edited.
 *
 * The contract is small and every part of it matters:
 *
 *   - `props.onChange(value)` stages a value. It does not commit one, and it
 *     does not close the editor.
 *   - `params.stopEditing()` commits and closes; `params.stopEditing(true)`
 *     discards and closes. An editor that never calls it is an editor the user
 *     cannot leave.
 *   - `props.charPress` is the keystroke that opened the cell, if the user
 *     started typing rather than clicking. Ignoring it swallows that first
 *     character, which reads as dropped input.
 *   - `props.secured` is field-level security, not disablement. A secured cell
 *     is one this user may not write, and an override that ignores it hands
 *     them a working editor for a value the save will reject.
 *   - `props.isRequired` and `props.rowHeight` are the two the platform hands
 *     over and a first draft always drops. The first is an affordance the grid
 *     would have drawn; the second is why an editor looks the wrong size in a
 *     grid configured for tall rows.
 *   - The grid may unmount an editor at any time. Nothing here may hold state
 *     that has to be flushed on the way out.
 *
 * Override only the types with something to add. Everything else falls through
 * to the grid's own editor, which already knows how to edit a lookup, a date or
 * an option set against real metadata — none of which a customizer is handed.
 * That is not a gap to work around: a hand-built choice picker with no
 * option-set metadata behind it is worse than the one the grid ships.
 */
export const cellEditorOverrides: CellEditorOverrides = {
    /**
     * Text: the platform's editor, with the contract wired up.
     *
     * Uncontrolled on purpose. A controlled input would need state, and state
     * in a cell editor is state the grid can unmount mid-keystroke; letting the
     * DOM hold the draft and staging every change through `onChange` keeps this
     * a pure function of its props, which is what the grid asks for.
     */
    Text: (props, params) => {
        if (props.secured) {
            return undefined;
        }

        const close = closeOnce(params);

        return (
            <TextField
                className="__CONTROL__-editor"
                autoFocus
                defaultValue={
                    // charPress is the character that opened the editor.
                    // Without this line the user types "F" to start editing and
                    // the editor opens showing the old value, having eaten the
                    // F.
                    props.charPress ?? String(props.value ?? '')
                }
                borderless
                underlined
                required={props.isRequired}
                ariaLabel="Edit value"
                styles={fieldStyles(props.rowHeight)}
                onChange={(_event, next) => props.onChange(next ?? '')}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        close(false);
                    }

                    if (event.key === 'Escape') {
                        event.preventDefault();
                        close(true);
                    }
                }}
                // Clicking away is a commit everywhere else in a grid, so it is
                // one here too. Without it the editor stays open behind the
                // user.
                onBlur={() => close(false)}
            />
        );
    },
};

/**
 * A one-shot wrapper around `stopEditing`, per mounted editor.
 *
 * Escape discards through `stopEditing(true)` — and closing the editor also
 * blurs the input, so the blur handler fires immediately afterwards and commits
 * the very value Escape just threw away. The user presses Escape and watches
 * their edit save. Enter has the same shape: commit, then blur, then commit
 * again.
 *
 * Any editor that both handles Escape and commits on blur has this bug, which
 * is most of them, which is why it is in the template rather than in one
 * control. The latch lives in a closure created per call rather than in module
 * scope: one call still returns one element with one flag of its own, and two
 * cells editing at once do not share it.
 */
function closeOnce(params: GetEditorParams): (cancel: boolean) => void {
    let closed = false;

    return (cancel) => {
        if (closed) {
            return;
        }

        closed = true;
        params.stopEditing(cancel);
    };
}

/**
 * Size the input to the row the grid actually drew.
 *
 * The CSS carries a fixed fallback height because `rowHeight` is optional in
 * the contract, but a grid configured for tall rows draws a short editor inside
 * a tall cell, which reads as a rendering bug in the control. When the grid
 * says how tall the row is, that wins.
 */
const EDITOR_INSET_PX = 8;

function fieldStyles(rowHeight?: number): Partial<ITextFieldStyles> | undefined {
    if (rowHeight === undefined) {
        return undefined;
    }

    return { fieldGroup: { height: Math.max(rowHeight - EDITOR_INSET_PX, 20) } };
}

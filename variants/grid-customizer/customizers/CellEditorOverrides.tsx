import { ITextFieldStyles, TextField } from '@fluentui/react';
import * as React from 'react';
import { CellEditorOverrides, CellEditorProps, GetEditorParams } from '../types';

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
 *     character, which reads as dropped input — and *showing* it without also
 *     staging it is a different bug with the same ending, see below.
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
 *
 * Each override is a thin, pure function returning one element; the behaviour
 * lives in the components below. That split is not decoration. The grid calls
 * these functions repeatedly for the same cell and requires them to be pure, so
 * anything that has to exist *once per open editor* — a focus call, a one-shot
 * latch, the staging of `charPress` — cannot live in the function body. It has
 * to hang off a mount, which is what a component with hooks gives us. The
 * elements are rendered by the host's React instance (see the manifest's
 * platform-library comment), so hooks inside them dispatch through the same
 * instance the grid is using.
 */
export const cellEditorOverrides: CellEditorOverrides = {
    Text: (props, params) => {
        if (props.secured) {
            return undefined;
        }

        return <TextCellEditor cell={props} params={params} />;
    },
};

interface EditorProps {
    readonly cell: CellEditorProps;
    readonly params: GetEditorParams;
}

/**
 * Text: the platform's editor, with the contract wired up.
 *
 * Uncontrolled on purpose. A controlled input would need state, and state in a
 * cell editor is state the grid can unmount mid-keystroke; letting the DOM hold
 * the draft and staging every change through `onChange` is what the platform's
 * "dispose at any time" rule asks for.
 */
function TextCellEditor({ cell, params }: EditorProps): React.ReactElement {
    const close = useCloseOnce(params);

    // `charPress` is the character that opened the editor, and seeding the
    // input with it is only half the job — seeding is not staging. The grid
    // holds the value `stopEditing` commits, and nothing has told it about this
    // character. Without the effect below the user types "F", presses Enter,
    // and watches the old value come back, having had "F" on screen the whole
    // time. It hides almost perfectly: a second keystroke fires `onChange` with
    // the whole field, so it only ever shows when the first character typed is
    // also the last.
    //
    // In an effect rather than in the body above because the override has to
    // stay pure. Mount-only because re-staging on a later render would
    // overwrite whatever the user has typed since.
    const initialValue = cell.charPress ?? String(cell.value ?? '');

    React.useEffect(() => {
        if (cell.charPress) {
            cell.onChange(cell.charPress);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <TextField
            className="__CONTROL__-editor"
            autoFocus
            defaultValue={initialValue}
            borderless
            underlined
            required={cell.isRequired}
            ariaLabel="Edit value"
            styles={fieldStyles(cell.rowHeight)}
            onChange={(_event, next) => cell.onChange(next ?? '')}
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
            // Clicking away is a commit everywhere else in a grid, so it is one
            // here too. Without it the editor stays open behind the user.
            onBlur={() => close(false)}
        />
    );
}

/**
 * A one-shot `stopEditing`, scoped to one open editor.
 *
 * Escape discards through `stopEditing(true)` — and closing the editor also
 * blurs the input, so the blur handler fires immediately afterwards and commits
 * the very value Escape just threw away. The user presses Escape and watches
 * their edit save. Enter has the same shape: commit, then blur, then commit
 * again.
 *
 * Any editor that both handles Escape and commits on blur has this bug, which
 * is most of them, which is why it is in the template rather than in one
 * control.
 *
 * The latch is a ref rather than a closure created while rendering, and that
 * distinction is the whole reason this is a hook. The grid may call an override
 * again for a cell that is already editing; a closure made per *call* starts
 * over at `false` and hands React fresh handlers, so an Escape followed by a
 * re-render followed by the blur commits after all — the bug the latch exists
 * to prevent, restored by the way the latch was built. A ref survives the
 * re-render and is created once per mounted editor, which is the lifetime this
 * is actually about. Two cells editing at once still get one each.
 */
function useCloseOnce(params: GetEditorParams): (cancel: boolean) => void {
    const closed = React.useRef(false);

    return React.useCallback(
        (cancel: boolean) => {
            if (closed.current) {
                return;
            }

            closed.current = true;
            params.stopEditing(cancel);
        },
        [params],
    );
}

/*
 * Adding an editor whose control does not focus itself? Give it a way out that
 * is not a commit.
 *
 * `TextField` above carries `autoFocus`, so Escape has a keyboard target and
 * clicking away produces a blur. A `Toggle`, a `Dropdown` or a `Rating` has
 * neither unless you arrange it, and an editor that calls `stopEditing` only
 * from its own `onChange` traps a user who opened the cell and changed their
 * mind — the "editor the user cannot leave" named at the top of this file.
 *
 * The shape that works: focus the control on mount through `componentRef`, and
 * wrap it in an element carrying the Escape and blur handlers.
 *
 *     const toggle = React.useRef<IToggle>(null);
 *     React.useEffect(() => { toggle.current?.focus(); }, []);
 *
 *     <div
 *         className="__CONTROL__-editor"
 *         onKeyDown={(event) => {
 *             if (event.key === 'Escape') {
 *                 event.preventDefault();
 *                 close(true);
 *             }
 *         }}
 *         onBlur={(event) => {
 *             // Focus moving *within* the wrapper is not the user leaving.
 *             // React's blur bubbles, so without this the editor closes on any
 *             // internal focus move the Fluent control makes.
 *             if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
 *                 return;
 *             }
 *
 *             // Discards rather than commits: nothing was staged, so a cell
 *             // opened and abandoned should read as untouched, not as a
 *             // decision.
 *             close(true);
 *         }}
 *     >
 *         <Toggle componentRef={toggle} … onChange={(_event, checked) => {
 *             cell.onChange(checked === true);
 *             close(false);
 *         }} />
 *     </div>
 */

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

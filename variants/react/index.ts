import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { __CONTROL__Control, IProps } from './components/__CONTROL__Control';

/**
 * A virtual (React) field control.
 *
 * The difference from the standard control is the whole point: `updateView`
 * *returns* an element instead of writing into a container, so the platform
 * owns reconciliation and React never enters the bundle — it is declared as a
 * `<platform-library>` and resolved at runtime by the host.
 *
 * `updateView` still runs on every change to any bound value, including ones
 * this control caused itself. With React that shows up as a controlled-input
 * problem rather than a caret-jumping one: derive state from props, and resync
 * on the *content* of a prop rather than its identity, since every pass hands
 * down fresh objects.
 *
 * The state read below is the same set the standard `index.ts` handles, and it
 * is here for the same reason: every branch is a state a real form puts a
 * control into, and each one is invisible until a customer hits it.
 */
export class __CONTROL__ implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged!: () => void;
    private value = '';

    /**
     * The last value the *platform* supplied, as opposed to the one the user
     * typed. Without this guard, `updateView` running after our own
     * `notifyOutputChanged` re-adopts the platform's value and discards the
     * edit that caused it — which in a canvas app bound to a constant is every
     * edit, and the control reads as frozen rather than as misconfigured.
     */
    private lastIncoming: string | undefined = undefined;

    public init(
        _context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
    ): void {
        // No container: a virtual control never receives one.
        this.notifyOutputChanged = notifyOutputChanged;
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const parameter = context.parameters.value;
        const incoming = parameter.raw ?? '';

        if (incoming !== this.lastIncoming) {
            this.lastIncoming = incoming;
            this.value = incoming;
        }

        // Field-level security is NOT the form's read-only state, and
        // conflating them is a real information bug: a user denied read access
        // gets `raw === null`, indistinguishable from "empty" unless
        // `security.readable` is checked.
        const security = parameter.security;

        const props: IProps = {
            value: this.value,
            placeholder: context.parameters.placeholder.raw ?? '',
            visible: context.mode.isVisible,
            readable: security === undefined || security.readable,
            // Two independent reasons to be read-only: the form's, and the
            // column's.
            disabled:
                context.mode.isControlDisabled
                || (security !== undefined && !security.editable),
            // The platform's own validation. Without somewhere to put it, a
            // failing business rule is silent inside a code component.
            errorMessage: parameter.error ? parameter.errorMessage : null,
            // `attributes` is optional because a canvas app has no column
            // metadata at all. That single `?` is the whole canvas versus
            // model-driven difference: narrow when it is present, never require
            // it.
            maxLength: parameter.attributes?.MaxLength,
            // The label the maker gave the field on this form is a better
            // accessible name than anything shipped in the .resx, which cannot
            // know what the field is called.
            label: context.mode.label,
            isRTL: context.userSettings.isRTL,
            noAccessText: context.resources.getString('__CONTROL___NoAccess'),
            fallbackLabel: context.resources.getString('__CONTROL___Name'),
            onChange: (next: string): void => {
                this.value = next;
                this.notifyOutputChanged();
            },
        };

        return React.createElement(__CONTROL__Control, props);
    }

    public getOutputs(): IOutputs {
        return { value: this.value };
    }

    public destroy(): void {
        // Usually empty for a virtual control: React unmounts its own tree, and
        // anything added outside it in `init` would be released here.
    }
}

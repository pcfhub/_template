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
 */
export class __CONTROL__ implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged!: () => void;
    private value = '';

    public init(
        _context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
    ): void {
        // No container: a virtual control never receives one.
        this.notifyOutputChanged = notifyOutputChanged;
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        this.value = context.parameters.value.raw ?? '';

        const props: IProps = {
            value: this.value,
            placeholder: context.parameters.placeholder.raw ?? '',
            disabled: context.mode.isControlDisabled,
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

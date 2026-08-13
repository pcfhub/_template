import { IInputs, IOutputs } from './generated/ManifestTypes';

/**
 * A standard (non-virtual) field control.
 *
 * The four lifecycle methods below are the whole contract with the platform.
 * The one thing worth knowing that the docs bury: `updateView` runs on every
 * change to *any* bound value, including ones this control caused itself, so
 * anything expensive belongs behind a comparison rather than at the top.
 */
export class __CONTROL__ implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container!: HTMLDivElement;
    private input!: HTMLInputElement;
    private notifyOutputChanged!: () => void;
    private value = '';

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.container = container;
        this.notifyOutputChanged = notifyOutputChanged;

        this.input = document.createElement('input');
        this.input.className = '__CONTROL__-input';
        this.input.type = 'text';
        this.input.addEventListener('input', this.onInput);

        this.container.classList.add('__CONTROL__');
        this.container.appendChild(this.input);

        this.render(context);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.render(context);
    }

    public getOutputs(): IOutputs {
        return { value: this.value };
    }

    public destroy(): void {
        this.input.removeEventListener('input', this.onInput);
    }

    private render(context: ComponentFramework.Context<IInputs>): void {
        const incoming = context.parameters.value.raw ?? '';

        // Guarded, not assigned unconditionally: writing `value` while the user
        // is typing moves the caret to the end of the field on every keystroke.
        if (incoming !== this.value) {
            this.value = incoming;
            this.input.value = incoming;
        }

        this.input.placeholder = context.parameters.placeholder.raw ?? '';
        this.input.disabled = context.mode.isControlDisabled;
    }

    private onInput = (): void => {
        this.value = this.input.value;
        this.notifyOutputChanged();
    };
}

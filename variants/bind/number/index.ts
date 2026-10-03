import { IInputs, IOutputs } from './generated/ManifestTypes';

/**
 * A standard field control bound to a **number** column — the scaffold
 * `setup.mjs --bind number` writes.
 *
 * The text scaffold's shape, with the three things a number adds:
 *
 * - **It is typed in the user's format.** `1.234,5` is a German user's 1234.5,
 *   and a parser written against '.' reads it as 1.2345 without a word. The
 *   separators come from `userSettings.numberFormattingInfo`, and a group
 *   separator is accepted only where it groups.
 * - **The column says what it can hold.** `attributes` carries the range, and
 *   then either `Precision` (Decimal, FP, Currency) or `Format` (a whole
 *   number). A value outside the range is refused here, at the box, rather
 *   than at Save; a fraction in a whole-number column is refused, not
 *   rounded, because rounding changes what the user typed without saying so.
 * - **It commits; it does not stream.** Half a number — `1.` — is not a value,
 *   so the box writes on Enter or when it loses focus, never per keystroke.
 *
 * The bound property is a `<type-group>` (see the manifest), which is why the
 * column's kind is read from `attributes` and `type` is trusted only to forbid:
 * a host may report the whole group, or another member of it, as `type`.
 */
type Kind = 'whole' | 'fractional' | 'unknown';

/** What a number column's `attributes` can carry; every member may be absent. */
interface NumberAttributes {
    MinValue?: number;
    MaxValue?: number;
    Precision?: number;
    Format?: string;
}

export class __CONTROL__ implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container!: HTMLDivElement;
    /** The filled surface the input sits in. See the stylesheet. */
    private field!: HTMLDivElement;
    private input!: HTMLInputElement;
    private message!: HTMLParagraphElement;
    private notifyOutputChanged!: () => void;
    private context!: ComponentFramework.Context<IInputs>;

    private value: number | null = null;

    /**
     * Every value this control handed the platform recently, newest last — the
     * text scaffold's guard, for the same reason: the platform echoes a write
     * late and out of order, and an echo taken for the form's own change puts
     * an older number back in the box. A box that commits on blur writes
     * rarely, but a user who presses Enter twice in a second writes twice.
     */
    private written: (number | null)[] = [];

    /**
     * The value the host handed over last time. A value equal to it is not
     * news: PCFHub's demo re-renders with its preset's value on a width
     * change, and taking that for the form's change wipes what was committed.
     */
    private lastIncoming: number | null | undefined = undefined;

    /** The resx key of the control's own refusal, while the box holds one. */
    private fault: string | null = null;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.container = container;
        this.notifyOutputChanged = notifyOutputChanged;
        this.context = context;

        this.input = document.createElement('input');
        this.input.className = '__CONTROL__-input';
        // `text`, not `number`: a number input refuses the user's own decimal
        // separator in half the locales a form runs in, and reports what it
        // refused as an empty value.
        this.input.type = 'text';
        this.input.inputMode = 'decimal';
        this.input.addEventListener('focus', this.onFocus);
        this.input.addEventListener('blur', this.onBlur);
        this.input.addEventListener('keydown', this.onKeyDown);

        this.message = document.createElement('p');
        this.message.className = '__CONTROL__-message';

        this.field = document.createElement('div');
        this.field.className = '__CONTROL__-field';
        this.field.append(this.input);

        this.container.classList.add('__CONTROL__');
        this.container.append(this.field, this.message);

        this.render(context);
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        this.render(context);
    }

    public getOutputs(): IOutputs {
        // `null` clears the column; `undefined` would mean "no change". The
        // generated type is narrower than the contract — see SKILL.md.
        return { value: this.value === null ? (null as unknown as undefined) : this.value };
    }

    public destroy(): void {
        this.input.removeEventListener('focus', this.onFocus);
        this.input.removeEventListener('blur', this.onBlur);
        this.input.removeEventListener('keydown', this.onKeyDown);
    }

    private render(context: ComponentFramework.Context<IInputs>): void {
        this.context = context;

        const parameter = context.parameters.value;

        this.applyTheme(context);
        this.container.classList.toggle('__CONTROL__--hidden', !context.mode.isVisible);

        if (!context.mode.isVisible) {
            return;
        }

        // Denied read arrives as `raw === null`, which is not an empty column.
        const security = parameter.security;

        if (security?.readable === false) {
            this.field.hidden = true;
            this.message.hidden = false;
            this.message.textContent = context.resources.getString('__CONTROL___NoAccess');

            return;
        }

        this.field.hidden = false;

        const incoming = typeof parameter.raw === 'number' ? parameter.raw : null;
        const repeated = incoming === this.lastIncoming;

        this.lastIncoming = incoming;

        if (!repeated && incoming !== this.value && !this.written.includes(incoming)) {
            this.written = [];
            this.value = incoming;
            this.fault = null;
        }

        // While the user is in the box it holds what they typed, and after a
        // refusal it keeps the text being corrected; the form's number
        // replaces it once they leave with nothing refused.
        if (document.activeElement !== this.input && this.fault === null) {
            this.input.value = this.display();
        }

        this.input.placeholder = context.parameters.placeholder.raw ?? '';
        this.input.disabled = context.mode.isControlDisabled || security?.editable === false;
        this.container.classList.toggle('__CONTROL__--disabled', this.input.disabled);
        this.input.setAttribute(
            'aria-label',
            context.mode.label || context.resources.getString('__CONTROL___Name'),
        );
        this.container.dir = context.userSettings.isRTL ? 'rtl' : 'ltr';

        this.showMessage();
    }

    /** The control's own refusal first; the platform's validation otherwise. */
    private showMessage(): void {
        const parameter = this.context.parameters.value;
        const text = this.fault !== null ? this.describe(this.fault) : parameter.error ? parameter.errorMessage : '';
        const invalid = this.fault !== null || parameter.error;

        this.container.classList.toggle('__CONTROL__--invalid', invalid);
        this.input.setAttribute('aria-invalid', String(invalid));
        this.message.hidden = text === '';
        this.message.textContent = text;
    }

    private describe(key: string): string {
        const text = this.context.resources.getString(key);
        const bounds = this.bounds();

        return bounds === null
            ? text
            : text.replace('{0}', this.format(bounds.min)).replace('{1}', this.format(bounds.max));
    }

    private attributes(): NumberAttributes {
        return (this.context.parameters.value.attributes ?? {}) as NumberAttributes;
    }

    /**
     * Whether this column can hold a fraction.
     *
     * `attributes` is the evidence: `Precision` exists on the fractional
     * types and `Format` on a whole number. Without it — a canvas app — `type`
     * is consulted only to forbid. An exact `Whole.None` is a whole number;
     * a group string, or nothing, is not evidence either way, and the box
     * takes what the user typed.
     */
    private kind(): Kind {
        const attributes = this.attributes();

        if (typeof attributes.Precision === 'number') {
            return 'fractional';
        }

        if (typeof attributes.Format === 'string') {
            return 'whole';
        }

        return (this.context.parameters.value.type ?? '').trim() === 'Whole.None' ? 'whole' : 'unknown';
    }

    private bounds(): { min: number; max: number } | null {
        const attributes = this.attributes();

        return typeof attributes.MinValue === 'number' && typeof attributes.MaxValue === 'number'
            ? { min: attributes.MinValue, max: attributes.MaxValue }
            : null;
    }

    /**
     * What the box shows at rest. The platform's own `formatted` while the
     * value is still the one it handed over — it knows the record's currency
     * symbol, which nothing else here does — and `context.formatting` for a
     * value this control has just written and the form has not yet echoed.
     */
    private display(): string {
        if (this.value === null) {
            return '';
        }

        const parameter = this.context.parameters.value;

        if (this.value === parameter.raw && typeof parameter.formatted === 'string' && parameter.formatted !== '') {
            return parameter.formatted;
        }

        return this.format(this.value);
    }

    /** Through `context.formatting`, so it follows the user's settings, not the browser's. */
    private format(value: number): string {
        const precision = this.attributes().Precision;

        if (this.kind() === 'whole') {
            return this.context.formatting.formatInteger(value);
        }

        return this.context.formatting.formatDecimal(value, precision ?? decimalsOf(value));
    }

    /** What the box shows while being edited: no grouping, the user's decimal separator. */
    private plain(value: number): string {
        return String(value).replace('.', this.context.userSettings.numberFormattingInfo.numberDecimalSeparator);
    }

    private commit(): void {
        const parsed = parse(this.input.value, this.context.userSettings.numberFormattingInfo);

        if (parsed === undefined) {
            this.refuse('__CONTROL___NotANumber');

            return;
        }

        if (parsed !== null && this.kind() === 'whole' && !Number.isInteger(parsed)) {
            this.refuse('__CONTROL___WholeOnly');

            return;
        }

        const bounds = this.bounds();

        if (parsed !== null && bounds !== null && (parsed < bounds.min || parsed > bounds.max)) {
            this.refuse('__CONTROL___OutOfRange');

            return;
        }

        const precision = this.attributes().Precision;
        const next = parsed === null || precision === undefined ? parsed : Number(parsed.toFixed(precision));

        this.fault = null;

        if (next !== this.value) {
            this.value = next;

            // Bounded, as in the text scaffold.
            this.written.push(next);

            if (this.written.length > 32) {
                this.written.shift();
            }

            this.notifyOutputChanged();
        }

        this.showMessage();
    }

    /** Keep what the user typed, so they can correct it, and say why it was not taken. */
    private refuse(key: string): void {
        this.fault = key;
        this.showMessage();
    }

    private onFocus = (): void => {
        if (this.fault === null) {
            this.input.value = this.value === null ? '' : this.plain(this.value);
        }
    };

    private onBlur = (): void => {
        this.commit();

        if (this.fault === null) {
            this.input.value = this.display();
        }
    };

    private onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Enter') {
            this.commit();

            if (this.fault === null) {
                this.input.value = this.value === null ? '' : this.plain(this.value);
            }
        } else if (event.key === 'Escape' && this.fault !== null) {
            // Back to the column's value; the refusal goes with what caused it.
            this.fault = null;
            this.input.value = this.value === null ? '' : this.plain(this.value);
            this.showMessage();
        }
    };

    /** See the text scaffold: only the fallbacks follow this; the tokens win where published. */
    private applyTheme(context: ComponentFramework.Context<IInputs>): void {
        const isDarkTheme = context.fluentDesignLanguage?.isDarkTheme;

        if (isDarkTheme === undefined) {
            return;
        }

        this.container.classList.toggle('__CONTROL__--dark', isDarkTheme);
    }
}

/** Decimal places in a number as JavaScript writes it — 2 for 0.25, 0 for 3. */
function decimalsOf(value: number): number {
    const text = String(value);
    const point = text.indexOf('.');

    return point === -1 || text.includes('e') ? 0 : text.length - point - 1;
}

/**
 * A typed number in the user's format: a number, `null` for an empty box, or
 * `undefined` for text that is not one.
 *
 * The group separator is accepted only where it groups — `1.234,5` in German,
 * never `1.5`, which a German user did not mean as fifteen and an English one
 * could not have meant as anything else. Spaces of every width go first: some
 * locales group with a no-break space.
 */
function parse(text: string, info: ComponentFramework.UserSettingApi.NumberFormattingInfo): number | null | undefined {
    const compact = text.replace(/[\s\u00a0\u202f]/g, '');

    if (compact === '') {
        return null;
    }

    const negative = compact.startsWith('-') || compact.startsWith(info.negativeSign);
    const unsigned = compact.replace(/^[-+]/, '').replace(new RegExp(`^${literal(info.negativeSign)}`), '');
    const parts = unsigned.split(info.numberDecimalSeparator);

    if (parts.length > 2) {
        return undefined;
    }

    let whole = parts[0];
    const group = info.numberGroupSeparator;

    if (group !== '' && whole.includes(group)) {
        if (!new RegExp(`^\\d{1,3}(${literal(group)}\\d{3})+$`).test(whole)) {
            return undefined;
        }

        whole = whole.split(group).join('');
    }

    const normal = parts.length === 2 ? `${whole}.${parts[1]}` : whole;

    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(normal)) {
        return undefined;
    }

    const value = Number(normal);

    return negative ? -value : value;
}

/** `text` as a regular expression matches it, character for character. */
function literal(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

import * as React from 'react';

export interface IProps {
    value: string;
    placeholder: string;
    visible: boolean;
    readable: boolean;
    disabled: boolean;
    errorMessage: string | null;
    maxLength: number | undefined;
    label: string;
    isRTL: boolean;
    noAccessText: string;
    fallbackLabel: string;
    onChange: (next: string) => void;
}

/**
 * Selection and edit state live here rather than on the control class.
 *
 * On a real form either would work, because the platform re-renders after
 * `notifyOutputChanged()`. PCFHub's demo harness does not: its
 * `notifyOutputChanged` posts the outputs to the parent window and neither
 * re-renders nor writes the value back. A component that rendered straight from
 * props would therefore look dead in the published demo — every keystroke
 * accepted, nothing changing.
 *
 * The effect resyncs when the platform hands down a genuinely different value,
 * so a form-driven change still wins over local state.
 */
export function __CONTROL__Control(props: IProps): React.ReactElement | null {
    const [value, setValue] = React.useState(props.value);

    React.useEffect(() => {
        setValue(props.value);
    }, [props.value]);

    // Canvas relies on this; a model-driven form hides the section itself, so
    // honouring it costs a line and covers both hosts.
    if (!props.visible) {
        return null;
    }

    // A user denied read access must not be shown an empty field, which reads
    // as "no value" rather than as "not allowed to see it".
    if (!props.readable) {
        return <p className="__CONTROL__-message">{props.noAccessText}</p>;
    }

    return (
        <div className="__CONTROL__" dir={props.isRTL ? 'rtl' : 'ltr'}>
            <input
                className="__CONTROL__-input"
                type="text"
                value={value}
                placeholder={props.placeholder}
                disabled={props.disabled}
                maxLength={props.maxLength}
                aria-label={props.label || props.fallbackLabel}
                aria-invalid={props.errorMessage !== null}
                onChange={(event) => {
                    setValue(event.target.value);
                    props.onChange(event.target.value);
                }}
            />

            {props.errorMessage !== null && (
                <p className="__CONTROL__-message" role="alert">
                    {props.errorMessage}
                </p>
            )}
        </div>
    );
}

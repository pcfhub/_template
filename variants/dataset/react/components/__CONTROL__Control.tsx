import * as React from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';

type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;
type DataSet = ComponentFramework.PropertyTypes.DataSet;

export interface IProps {
    dataset: DataSet;
    columns: Column[];
    pageIds: string[];
    page: number;
    pageSize: number;
    visible: boolean;
    disabled: boolean;
    isRTL: boolean;
    theme: Record<string, string> | undefined;
    getString: (id: string) => string;
    onSort: (columnName: string) => void;
    onNextPage: () => void;
    onPreviousPage: () => void;
    onOpenRecord: (id: string) => void;
}

/**
 * `visualSizeFactor` as percentage widths for a `<colgroup>`.
 *
 * Canvas reports every factor as 0 — there is no view designer there to have
 * set them — in which case there is nothing to distribute and the browser's own
 * table layout is a better answer than dividing by zero.
 */
function columnWidths(columns: Column[]): string[] | null {
    const total = columns.reduce((sum, column) => sum + (column.visualSizeFactor || 0), 0);

    if (total <= 0) {
        return null;
    }

    return columns.map((column) => `${((column.visualSizeFactor || 0) / total) * 100}%`);
}

/**
 * `totalResultCount` is -1 when the platform did not count the rows, which is
 * common on large views. Printing "of -1" is the tell that nobody checked, so
 * name the page instead of the range.
 *
 * Both ends are clamped to the total. `props.page` is the control's own counter
 * and `pageIds.length` is what survived the slice, and combining two numbers
 * that came from different places is how this printed **"4–9 of 6"** on a real
 * form. The clamp is cheap; a range past its own total is not recoverable by
 * the reader.
 */
function pagerLabel(props: IProps): string {
    const total = props.dataset.paging.totalResultCount;

    if (total < 0) {
        return props.getString('__CONTROL___PageStatus').replace('{0}', String(props.page));
    }

    const start = (props.page - 1) * props.pageSize + 1;

    return props
        .getString('__CONTROL___RangeStatus')
        .replace('{0}', String(Math.min(start, total)))
        .replace('{1}', String(Math.min(start + props.pageIds.length - 1, total)))
        .replace('{2}', String(total));
}

export function __CONTROL__Control(props: IProps): React.ReactElement | null {
    const { dataset, columns, pageIds, getString } = props;

    // Canvas relies on this; a model-driven form hides the section itself, so
    // honouring it costs a line and covers both hosts.
    if (!props.visible) {
        return null;
    }

    /**
     * Every return path goes through here.
     *
     * FluentProvider is what emits the Fluent design tokens as CSS custom
     * properties on its wrapper — which is how a hand-rolled <table> inherits
     * the host's theme without importing a single Fluent component. Miss it on
     * one branch and that branch renders unthemed.
     */
    const frame = (content: React.ReactElement): React.ReactElement => (
        <FluentProvider theme={props.theme ?? webLightTheme} dir={props.isRTL ? 'rtl' : 'ltr'}>
            <div className="__CONTROL__">{content}</div>
        </FluentProvider>
    );

    if (dataset.error) {
        return frame(
            <p className="__CONTROL__-message __CONTROL__-error">
                {dataset.errorMessage || getString('__CONTROL___Error')}
            </p>,
        );
    }

    // A canvas app supplies only the columns the maker picked in the Items
    // Fields flyout. None picked is a real state, and an empty <table> reads as
    // a broken control rather than as an unfinished configuration.
    if (columns.length === 0) {
        return frame(
            <p className="__CONTROL__-message">
                {dataset.loading ? getString('__CONTROL___Loading') : getString('__CONTROL___NoColumns')}
            </p>,
        );
    }

    // `loading` is true on the first updateView, before any records arrive, so
    // rendering the empty state here flashes "No records" on every load.
    if (pageIds.length === 0) {
        return frame(
            <p className="__CONTROL__-message">
                {dataset.loading ? getString('__CONTROL___Loading') : getString('__CONTROL___Empty')}
            </p>,
        );
    }

    const widths = columnWidths(columns);
    const primary = columns.find((column) => column.isPrimary) ?? columns[0];

    return frame(
        <>
            <div className={dataset.loading ? '__CONTROL__-scroll is-loading' : '__CONTROL__-scroll'}>
                <table className="__CONTROL__-table">
                    <caption className="__CONTROL__-caption">{dataset.getTitle()}</caption>

                    {widths && (
                        <colgroup>
                            {widths.map((width, index) => (
                                <col key={columns[index].name} style={{ width }} />
                            ))}
                        </colgroup>
                    )}

                    <thead>
                        <tr>
                            {columns.map((column) => {
                                const status = dataset.sorting.find((entry) => entry.name === column.name);
                                const sorted = status
                                    ? status.sortDirection === 1
                                        ? 'descending'
                                        : 'ascending'
                                    : 'none';

                                return (
                                    <th
                                        key={column.name}
                                        scope="col"
                                        aria-sort={column.disableSorting ? undefined : sorted}
                                    >
                                        {column.disableSorting ? (
                                            column.displayName
                                        ) : (
                                            // A real <button>, so sorting is
                                            // reachable by keyboard.
                                            <button
                                                type="button"
                                                className="__CONTROL__-sort"
                                                title={getString('__CONTROL___SortBy').replace(
                                                    '{0}',
                                                    column.displayName,
                                                )}
                                                onClick={(): void => props.onSort(column.name)}
                                            >
                                                {column.displayName}
                                            </button>
                                        )}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>

                    <tbody>
                        {pageIds.map((id) => {
                            const record = dataset.records[id];

                            if (!record) {
                                return null;
                            }

                            return (
                                <tr key={id}>
                                    {columns.map((column) => (
                                        <td key={column.name}>
                                            {column.name === primary.name ? (
                                                <button
                                                    type="button"
                                                    className="__CONTROL__-open"
                                                    title={getString('__CONTROL___OpenRecord').replace(
                                                        '{0}',
                                                        record.getFormattedValue(primary.name),
                                                    )}
                                                    onClick={(): void => props.onOpenRecord(id)}
                                                >
                                                    {record.getFormattedValue(column.name)}
                                                </button>
                                            ) : (
                                                // `getFormattedValue` takes the
                                                // column's *name*. With
                                                // property-set roles you find
                                                // the column by `alias` and read
                                                // it by `name`; backwards, it
                                                // renders zero rows against real
                                                // data and looks fine in a demo.
                                                record.getFormattedValue(column.name)
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="__CONTROL__-pager">
                <button
                    type="button"
                    // Not `hasPreviousPage`: it stays false after paging
                    // forward on a real form, so Previous never unlocks. The
                    // control's own page counter is the honest answer.
                    disabled={props.disabled || props.page <= 1}
                    onClick={props.onPreviousPage}
                >
                    {getString('__CONTROL___Previous')}
                </button>

                <span className="__CONTROL__-pagerStatus" aria-live="polite">
                    {pagerLabel(props)}
                </span>

                <button
                    type="button"
                    disabled={props.disabled || !dataset.paging.hasNextPage}
                    onClick={props.onNextPage}
                >
                    {getString('__CONTROL___Next')}
                </button>
            </div>
        </>,
    );
}

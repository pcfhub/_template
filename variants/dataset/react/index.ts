import * as React from 'react';
import { IInputs, IOutputs } from './generated/ManifestTypes';
import { __CONTROL__Control, IProps } from './components/__CONTROL__Control';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type SortDirection = ComponentFramework.PropertyHelper.DataSetApi.Types.SortDirection;

/** `SortDirection` is a numeric union, not an enum object — there is nothing to import. */
const ASCENDING = 0 as SortDirection;
const DESCENDING = 1 as SortDirection;

/** The platform's ceiling on a page. Not in the type definitions. */
const MAX_PAGE_SIZE = 250;

/**
 * A virtual (React) dataset control.
 *
 * Everything that talks to the platform lives in this file. The component never
 * sees `context` or the dataset — every call reaches it as a callback prop.
 * That is not tidiness: it keeps the whole platform surface in one file that
 * can be read against the type definitions in a single pass, which is the only
 * way to be sure about an API this narrow.
 *
 * The rule the rest of this class is shaped by: **`updateView` runs on every
 * change to any bound value, including the ones this control caused itself.**
 * A dataset has mutators — `setPageSize`, `refresh`, `loadNextPage` — and
 * calling any of them unguarded from `updateView` is an infinite loop, not a
 * slow render.
 */
export class __CONTROL__ implements ComponentFramework.ReactControl<IInputs, IOutputs> {
    private notifyOutputChanged!: () => void;
    private openedRecordId = '';

    /**
     * The page size this control has already asked the platform for.
     *
     * Guarding on this rather than on `ds.paging.pageSize` is the whole trick:
     * the platform's own value will not equal the requested one until the
     * refresh lands, so comparing against it re-fires at least once more — and
     * if the platform clamps the request, it never converges at all.
     */
    private appliedPageSize = 0;

    private page = 1;

    public init(
        _context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
    ): void {
        // No container: a virtual control never receives one.
        this.notifyOutputChanged = notifyOutputChanged;
    }

    public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
        const dataset = context.parameters.records;

        this.applyPageSize(context, dataset);

        const props: IProps = {
            dataset,
            // `isHidden` and `order` are the maker's decisions in the view
            // designer; a table that ignores either looks broken to whoever set
            // them.
            columns: (dataset.columns ?? [])
                .filter((column) => !column.isHidden)
                .sort((a, b) => a.order - b.order),
            pageIds: dataset.sortedRecordIds ?? [],
            page: this.currentPage(dataset),
            pageSize: this.appliedPageSize,
            visible: context.mode.isVisible,
            disabled: context.mode.isControlDisabled,
            isRTL: context.userSettings.isRTL,
            // Typed as of @types/powerapps-component-framework 1.3.18, so no
            // cast is needed — but absent in PCFHub's demo harness, which is
            // why the component falls back to Fluent's own light theme.
            theme: context.fluentDesignLanguage?.tokenTheme,
            getString: (id: string): string => context.resources.getString(id),
            onSort: (columnName: string): void => this.sortBy(dataset, columnName),
            onNextPage: (): void => this.nextPage(dataset),
            onPreviousPage: (): void => this.previousPage(dataset),
            onOpenRecord: (id: string): void => this.openRecord(dataset, id),
        };

        return React.createElement(__CONTROL__Control, props);
    }

    /**
     * `null` is not `undefined` here: the generated `IOutputs` types every
     * output as optional, and `undefined` means "no change" — so a cleared
     * value would be unobservable. Emit the empty string instead.
     */
    public getOutputs(): IOutputs {
        return { openedRecordId: this.openedRecordId };
    }

    public destroy(): void {
        // The platform unmounts the React tree for a virtual control, and this
        // control holds no listeners, timers or observers of its own.
    }

    /** Ask for a new page size, but only when it actually changed. See the note above. */
    private applyPageSize(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const raw = context.parameters.pageSize.raw ?? 25;
        const wanted = Math.min(Math.max(Math.trunc(raw), 1), MAX_PAGE_SIZE);

        if (wanted === this.appliedPageSize) {
            return;
        }

        this.appliedPageSize = wanted;
        dataset.paging.setPageSize(wanted);
        dataset.refresh();
    }

    /**
     * With `loadNextPage(true)` the loaded range is a single page, so
     * `firstPageNumber` should be the current page — but that is an inference
     * from the naming rather than something the types promise, so the local
     * counter is the fallback rather than the other way round.
     */
    private currentPage(dataset: DataSet): number {
        const first = dataset.paging.firstPageNumber;

        return typeof first === 'number' && first >= 1 ? first : this.page;
    }

    /**
     * Sorting is server-side, applied across every page — which is the reason
     * not to sort in the browser: a client-side sort reorders the rows on
     * screen, 25 out of 240, a wrong answer that looks completely right.
     *
     * `dataset.sorting` is an array you mutate in place and it is the whole
     * ORDER BY, so replace rather than append.
     */
    private sortBy(dataset: DataSet, columnName: string): void {
        const current = dataset.sorting.find((status) => status.name === columnName);
        const direction: SortDirection = current?.sortDirection === ASCENDING ? DESCENDING : ASCENDING;

        dataset.sorting.length = 0;
        dataset.sorting.push({ name: columnName, sortDirection: direction });

        // A new order makes "page 4" meaningless.
        this.page = 1;
        dataset.paging.reset();
        dataset.refresh();
    }

    /**
     * `loadNextPage()` with no argument is infinite scroll, not paging: the
     * type definition says it returns results for the whole page range, so
     * `sortedRecordIds` accumulates pages 1..N and the table grows instead of
     * turning. `true` limits it to the newly loaded page.
     */
    private nextPage(dataset: DataSet): void {
        if (!dataset.paging.hasNextPage) {
            return;
        }

        this.page += 1;
        dataset.paging.loadNextPage(true);
    }

    private previousPage(dataset: DataSet): void {
        if (!dataset.paging.hasPreviousPage) {
            return;
        }

        this.page = Math.max(1, this.page - 1);
        dataset.paging.loadPreviousPage(true);
    }

    /**
     * Notify before opening, so the output is observable even on a host where
     * `openDatasetItem` does nothing — which is the canvas case.
     *
     * It takes an EntityReference, and `getNamedReference()` is the only way to
     * build one; there is no id-based overload.
     */
    private openRecord(dataset: DataSet, id: string): void {
        const record = dataset.records[id];

        if (!record) {
            return;
        }

        this.openedRecordId = id;
        this.notifyOutputChanged();
        dataset.openDatasetItem(record.getNamedReference());
    }
}

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
 * **What `--type dataset` scaffolds is a table**, with sortable headers, a pager
 * and an open-record button. That is the right default and its comments are the
 * traps a dataset control hits — but a dataset control that is *not* a table
 * replaces most of this file rather than adjusting it. A board, a calendar or a
 * chart keeps the paging and mutator discipline below and little else. Knowing
 * that now is cheaper than discovering it after the manifest is written.
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
 *
 * The second is why the pager reads none of `hasPreviousPage`, `firstPageNumber`
 * or the raw length of `sortedRecordIds`. Observed on a real model-driven form:
 * `loadNextPage(true)` ignores its argument and returns the whole page range,
 * `hasPreviousPage` stays false so Previous never unlocks, and `firstPageNumber`
 * disagrees with the ids badly enough to print a range past its own total. The
 * page number is this control's own counter, and `currentPage()` cuts the
 * accumulated array back down. Both are commented where they are.
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
            pageIds: this.currentPage(dataset.sortedRecordIds ?? []),
            page: this.page,
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
        const raw = context.parameters.pageSize.raw;

        /*
         * **The platform already has a page size, and it is usually the right
         * one.** `paging.pageSize` is the size the host is actually retrieving
         * with — a main grid's *Rows per page* personalisation, a subgrid's
         * form-designer setting, the canvas default.
         *
         * So the property carries no `default-value`: unset, adopt what the
         * host is doing and **never call `setPageSize` at all**; set, override.
         * Adopting still records the number, because `currentPage()` needs to
         * know how big a page is — reading it is not the same as asking for it.
         * See the manifest for why the default was removed.
         */
        if (raw === null || raw === undefined) {
            // `0` is "the host did not say", not "one row per page".
            this.appliedPageSize = dataset.paging.pageSize > 0 ? dataset.paging.pageSize : 0;

            return;
        }

        const wanted = Math.min(Math.max(Math.trunc(raw), 1), MAX_PAGE_SIZE);

        if (wanted === this.appliedPageSize) {
            return;
        }

        this.appliedPageSize = wanted;
        dataset.paging.setPageSize(wanted);
        dataset.refresh();
    }

    /**
     * The records belonging to the page the pager says it is on.
     *
     * **This is the one place a dataset control should slice
     * `sortedRecordIds`, and the usual rule is never to do it.** On a platform
     * that honours `loadOnlyNewPage`, that array already *is* the current page,
     * and slicing hides records the platform paged for. A single-page demo
     * fixture tempts you into it and the temptation is wrong.
     *
     * Except that the flag is not honoured. Observed on a real model-driven
     * form: `loadNextPage(true)` from page 1 of a 6-record view at page size 3
     * returned all six ids, and page 2 rendered under page 1. The argument is
     * documented, typed, passed and ignored.
     *
     * So the slice is a repair for one specific platform behaviour, written to
     * disappear the moment that behaviour changes: when the array is no longer
     * than a page it already is the page, and nothing is cut. Slicing by page
     * offset rather than taking the tail is what makes it right going backwards
     * as well as forwards.
     *
     * A control that *wants* the accumulation — a "load more" list, where the
     * point is that earlier records stay on screen — should not call this.
     */
    private currentPage(ids: string[]): string[] {
        // `0` is "the host reported no page size" — see `applyPageSize`. There
        // is no page to cut to, so draw everything that arrived.
        if (this.appliedPageSize <= 0 || ids.length <= this.appliedPageSize) {
            return ids;
        }

        const start = (this.page - 1) * this.appliedPageSize;
        const slice = ids.slice(start, start + this.appliedPageSize);

        // Never empty the table: showing the wrong page is recoverable by
        // clicking, showing nothing looks like data loss.
        return slice.length > 0 ? slice : ids.slice(-this.appliedPageSize);
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
        const sorting = dataset.sorting;

        /*
         * Typed as required, absent on `npm start`.
         *
         * The order is expressed by mutating this array in place, so with no
         * array there is nothing to express it through — and the local harness
         * cannot sort anyway. Decline rather than throw.
         */
        if (!sorting) {
            return;
        }

        const current = sorting.find((status) => status.name === columnName);
        const direction: SortDirection = current?.sortDirection === ASCENDING ? DESCENDING : ASCENDING;

        sorting.length = 0;
        sorting.push({ name: columnName, sortDirection: direction });

        // A new order makes "page 4" meaningless.
        this.page = 1;
        dataset.paging.reset();
        dataset.refresh();
    }

    /**
     * `hasNextPage` has behaved, and it is the only available answer to "is
     * there more" — a local counter cannot supply that one.
     */
    private nextPage(dataset: DataSet): void {
        if (!dataset.paging.hasNextPage) {
            return;
        }

        this.goToPage(dataset, this.page + 1);
    }

    /*
     * `hasPreviousPage` answers a different question than it appears to.
     *
     * Observed on a real model-driven form: after paging forward it stays
     * false, so Previous never unlocks and there is no way back. The platform
     * treats the load as the *range* pages 1..N, and a range beginning at page
     * 1 truthfully has nothing before it.
     *
     * The control's own counter is what answers "is there a page before this
     * one", so that is what gates this — and the button, in the component.
     */
    private previousPage(dataset: DataSet): void {
        if (this.page <= 1) {
            return;
        }

        this.goToPage(dataset, this.page - 1);
    }

    /**
     * Turn to an absolute page.
     *
     * `loadExactPage` says what a pager means, and it is the documented
     * fallback for a host that ignores `loadOnlyNewPage` — which real ones do.
     * It is typed as required and feature-detected anyway: a required member is
     * a claim about the type definitions, not about the host, and this method
     * exists because one of those claims did not hold.
     */
    private goToPage(dataset: DataSet, target: number): void {
        const back = target < this.page;

        this.page = Math.max(1, target);

        if (typeof dataset.paging.loadExactPage === 'function') {
            dataset.paging.loadExactPage(this.page);
            return;
        }

        if (back) {
            dataset.paging.loadPreviousPage(true);
        } else {
            dataset.paging.loadNextPage(true);
        }
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

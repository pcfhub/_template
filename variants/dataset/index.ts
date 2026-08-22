import { IInputs, IOutputs } from './generated/ManifestTypes';

type DataSet = ComponentFramework.PropertyTypes.DataSet;
type Column = ComponentFramework.PropertyHelper.DataSetApi.Column;
type SortDirection = ComponentFramework.PropertyHelper.DataSetApi.Types.SortDirection;

/** `SortDirection` is a numeric union, not an enum object — there is nothing to import. */
const ASCENDING = 0 as SortDirection;
const DESCENDING = 1 as SortDirection;

/** The platform's ceiling on a page. Not in the type definitions. */
const MAX_PAGE_SIZE = 250;

/**
 * A standard (DOM) dataset control.
 *
 * A dataset control binds a collection — a view, a subgrid, a canvas table —
 * rather than a single column, and the difference is not just the shape of the
 * data. **A dataset has mutators**, and that changes what `updateView` means.
 *
 * `updateView` runs on every change to any bound value, including the ones this
 * control caused itself. For a field control that shows up as a jumping caret.
 * Here it is an infinite loop: `setPageSize()` does nothing until the next
 * fetch, so it has to be followed by `refresh()` — and `refresh()` fires
 * `updateView`. Every mutator call below is either guarded or in an event
 * handler, and that is the single most important thing to preserve when you
 * edit this file.
 *
 * The second thing to preserve is smaller and easier to lose: this control
 * rebuilds its whole DOM on every render, so **anything the user was focused on
 * ceases to exist**. That is fine for the records, which change wholesale
 * anyway, and wrong for the buttons in the chrome — clicking Next destroys the
 * Next button mid-interaction. `restoreFocus` below is how that is paid for,
 * and any control you add with a persistent action needs the same.
 */
export class __CONTROL__ implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private container!: HTMLDivElement;
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

    /**
     * Which chrome button to put focus back on after the next render.
     *
     * Set in a click handler, consumed once at the end of `render()`. Paging
     * with the keyboard is otherwise a one-shot: the button is destroyed by the
     * render its own click caused, focus falls back to `<body>`, and turning a
     * second page means tabbing in from the top of the form again.
     */
    private restoreFocus: 'previous' | 'next' | null = null;

    public init(
        _context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        _state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
        this.container = container;
        this.container.classList.add('__CONTROL__');
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        const dataset = context.parameters.records;

        this.applyPageSize(context, dataset);
        this.render(context, dataset);
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
        // Listeners are attached to elements inside `container`, which the
        // platform removes — but the container itself is reused, so clear it.
        this.container.innerHTML = '';
    }

    /**
     * Ask for a new page size, but only when it actually changed. See the note
     * above.
     *
     * If you add a **second** guarded mutator to `updateView` — a paging mode, a
     * filter, anything that ends in `refresh()` — make it skip its own first
     * run. On the very first `updateView` every "applied" field still holds its
     * initial value, so every guard fires at once and each one refreshes: one
     * load, several round trips. Guarding on `applied === ''` (or a `-1`
     * sentinel) rather than on a real default is what distinguishes "nobody has
     * asked yet" from "the answer changed".
     */
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

    private render(context: ComponentFramework.Context<IInputs>, dataset: DataSet): void {
        const getString = (id: string): string => context.resources.getString(id);

        this.container.innerHTML = '';

        // Canvas relies on this; a model-driven form hides the section itself.
        if (!context.mode.isVisible) {
            return;
        }

        if (dataset.error) {
            this.message(dataset.errorMessage || getString('__CONTROL___Error'));
            return;
        }

        // `isHidden` and `order` are the maker's decisions in the view
        // designer. A table that ignores either looks broken to whoever set
        // them.
        const columns = (dataset.columns ?? [])
            .filter((column) => !column.isHidden)
            .sort((a, b) => a.order - b.order);

        // A canvas app supplies only the columns picked in the Items Fields
        // flyout. None picked is a real state, and an empty <table> reads as a
        // broken control rather than as an unfinished configuration.
        if (columns.length === 0) {
            this.message(
                dataset.loading ? getString('__CONTROL___Loading') : getString('__CONTROL___NoColumns'),
            );
            return;
        }

        // `loading` is true on the first updateView, before any records arrive,
        // so rendering the empty state here flashes "No records" on every load.
        const ids = dataset.sortedRecordIds ?? [];

        if (ids.length === 0) {
            this.message(dataset.loading ? getString('__CONTROL___Loading') : getString('__CONTROL___Empty'));
            return;
        }

        this.container.appendChild(this.table(dataset, columns, ids, getString));
        this.container.appendChild(this.pager(dataset, ids.length, getString));

        // The button that caused this render no longer exists. Put focus on its
        // replacement, or fall back to the other one when this page turn was
        // the last: a disabled button cannot take focus, and silently doing
        // nothing here would strand the keyboard at <body>.
        if (this.restoreFocus) {
            const wanted = this.restoreFocus;
            this.restoreFocus = null;

            const button =
                this.container.querySelector<HTMLButtonElement>(`.__CONTROL__-${wanted}`);
            const other = this.container.querySelector<HTMLButtonElement>(
                `.__CONTROL__-${wanted === 'next' ? 'previous' : 'next'}`,
            );

            (button?.disabled ? other : button)?.focus();
        }
    }

    private message(text: string): void {
        const p = document.createElement('p');
        p.className = '__CONTROL__-message';
        p.textContent = text;
        this.container.appendChild(p);
    }

    private table(
        dataset: DataSet,
        columns: Column[],
        ids: string[],
        getString: (id: string) => string,
    ): HTMLElement {
        const table = document.createElement('table');
        table.className = '__CONTROL__-table';

        const caption = document.createElement('caption');
        caption.className = '__CONTROL__-caption';
        caption.textContent = dataset.getTitle();
        table.appendChild(caption);

        const head = table.createTHead().insertRow();

        for (const column of columns) {
            const th = document.createElement('th');
            th.scope = 'col';

            // The fixture format cannot express a non-sortable column, so
            // `undefined` means sortable — which is what a view reports for an
            // ordinary column too.
            if (column.disableSorting) {
                th.textContent = column.displayName;
            } else {
                const status = dataset.sorting.find((entry) => entry.name === column.name);
                th.setAttribute(
                    'aria-sort',
                    status ? (status.sortDirection === DESCENDING ? 'descending' : 'ascending') : 'none',
                );

                // A real <button>, so sorting is reachable by keyboard. A click
                // handler on the <th> is not.
                const button = document.createElement('button');
                button.type = 'button';
                button.className = '__CONTROL__-sort';
                button.textContent = column.displayName;
                button.title = getString('__CONTROL___SortBy').replace('{0}', column.displayName);
                button.addEventListener('click', () => this.sortBy(dataset, column.name));
                th.appendChild(button);
            }

            head.appendChild(th);
        }

        const body = table.createTBody();
        const primary = columns.find((column) => column.isPrimary) ?? columns[0];

        for (const id of ids) {
            const record = dataset.records[id];

            if (!record) {
                continue;
            }

            const row = body.insertRow();

            for (const column of columns) {
                const cell = row.insertCell();

                if (column.name === primary.name) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = '__CONTROL__-open';
                    button.textContent = record.getFormattedValue(column.name);
                    button.title = getString('__CONTROL___OpenRecord').replace(
                        '{0}',
                        record.getFormattedValue(primary.name),
                    );
                    button.addEventListener('click', () => this.openRecord(dataset, id));
                    cell.appendChild(button);
                } else {
                    // `getFormattedValue` takes the column's *name*. With
                    // property-set roles the column is found by `alias` and read
                    // by `name`, and getting that backwards renders zero rows
                    // against real data while looking fine in a demo fixture.
                    cell.textContent = record.getFormattedValue(column.name);
                }
            }
        }

        const scroll = document.createElement('div');
        scroll.className = dataset.loading ? '__CONTROL__-scroll is-loading' : '__CONTROL__-scroll';
        scroll.appendChild(table);

        return scroll;
    }

    private pager(dataset: DataSet, rowsOnPage: number, getString: (id: string) => string): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = '__CONTROL__-pager';

        const previous = document.createElement('button');
        previous.type = 'button';
        previous.className = '__CONTROL__-previous';
        previous.textContent = getString('__CONTROL___Previous');
        previous.disabled = !dataset.paging.hasPreviousPage;
        previous.addEventListener('click', () => {
            if (!dataset.paging.hasPreviousPage) {
                return;
            }

            this.page = Math.max(1, this.page - 1);
            this.restoreFocus = 'previous';
            dataset.paging.loadPreviousPage(true);
        });

        const status = document.createElement('span');
        status.className = '__CONTROL__-pagerStatus';
        status.setAttribute('aria-live', 'polite');
        status.textContent = this.pagerLabel(dataset, rowsOnPage, getString);

        const next = document.createElement('button');
        next.type = 'button';
        next.className = '__CONTROL__-next';
        next.textContent = getString('__CONTROL___Next');
        next.disabled = !dataset.paging.hasNextPage;
        next.addEventListener('click', () => {
            if (!dataset.paging.hasNextPage) {
                return;
            }

            this.page += 1;
            this.restoreFocus = 'next';

            // `loadNextPage()` with no argument is infinite scroll, not paging:
            // the type definition says it returns results for the whole page
            // range, so `sortedRecordIds` accumulates pages 1..N and the table
            // grows instead of turning. `true` limits it to the new page.
            dataset.paging.loadNextPage(true);
        });

        wrap.append(previous, status, next);

        return wrap;
    }

    /**
     * `totalResultCount` is -1 when the platform did not count the rows, which
     * is common on large views. Printing "of -1" is the tell that nobody
     * checked, so name the page instead of the range.
     */
    private pagerLabel(dataset: DataSet, rowsOnPage: number, getString: (id: string) => string): string {
        const total = dataset.paging.totalResultCount;
        const first = dataset.paging.firstPageNumber;
        const page = typeof first === 'number' && first >= 1 ? first : this.page;

        if (total < 0) {
            return getString('__CONTROL___PageStatus').replace('{0}', String(page));
        }

        const start = (page - 1) * this.appliedPageSize + 1;

        return getString('__CONTROL___RangeStatus')
            .replace('{0}', String(start))
            .replace('{1}', String(start + rowsOnPage - 1))
            .replace('{2}', String(total));
    }

    /**
     * Sorting is server-side, applied across every page.
     *
     * That is the reason not to sort in the browser: a client-side sort
     * reorders the rows on screen — 25 out of 240 — which is a wrong answer
     * that looks completely right.
     *
     * `dataset.sorting` is an array you mutate in place, and it is the whole
     * ORDER BY. Replacing rather than appending is what stops three clicks
     * building a three-deep sort nobody asked for.
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

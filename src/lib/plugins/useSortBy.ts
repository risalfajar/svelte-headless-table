import type { BodyRow } from '$lib/bodyRows';
import type { TablePlugin, NewTablePropSet, DeriveRowsFn } from '$lib/types/TablePlugin';
import { compare } from '$lib/utils/compare';
import { derived, writable, type Readable, type Writable } from 'svelte/store';

export interface SortByConfig {
	initialSortKeys?: SortKey[];
	disableMultiSort?: boolean;
	isMultiSortEvent?: (event: Event) => boolean;
}

export interface SortByState<Item> {
	sortKeys: WritableSortKeys;
	preSortedRows: Readable<BodyRow<Item>[]>;
}

export interface SortByColumnOptions {
	disable?: boolean;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getSortValue?: (value: any) => string | number | (string | number)[];
	invert?: boolean;
}

export type SortByPropSet = NewTablePropSet<{
	'thead.tr.th': {
		order: 'asc' | 'desc' | undefined;
		toggle: (event: Event) => void;
		clear: () => void;
		disabled: boolean;
	};
	'tbody.tr.td': {
		order: 'asc' | 'desc' | undefined;
	};
}>;

export interface SortKey {
	id: string;
	order: 'asc' | 'desc';
}

export const useSortKeys = (initKeys: SortKey[]): WritableSortKeys => {
	const { subscribe, update, set } = writable(initKeys);
	const toggleId = (id: string, { multiSort = true }: ToggleOptions = {}) => {
		update(($sortKeys) => {
			const keyIdx = $sortKeys.findIndex((key) => key.id === id);
			if (!multiSort) {
				if (keyIdx === -1) {
					return [{ id, order: 'asc' }];
				}
				const key = $sortKeys[keyIdx];
				if (key.order === 'asc') {
					return [{ id, order: 'desc' }];
				}
				return [];
			}
			if (keyIdx === -1) {
				return [...$sortKeys, { id, order: 'asc' }];
			}
			const key = $sortKeys[keyIdx];
			if (key.order === 'asc') {
				return [
					...$sortKeys.slice(0, keyIdx),
					{ id, order: 'desc' },
					...$sortKeys.slice(keyIdx + 1),
				];
			}
			return [...$sortKeys.slice(0, keyIdx), ...$sortKeys.slice(keyIdx + 1)];
		});
	};
	const clearId = (id: string) => {
		update(($sortKeys) => {
			const keyIdx = $sortKeys.findIndex((key) => key.id === id);
			if (keyIdx === -1) {
				return $sortKeys;
			}
			return [...$sortKeys.slice(0, keyIdx), ...$sortKeys.slice(keyIdx + 1)];
		});
	};
	return {
		subscribe,
		update,
		set,
		toggleId,
		clearId,
	};
};

interface ToggleOptions {
	multiSort?: boolean;
}

export type WritableSortKeys = Writable<SortKey[]> & {
	toggleId: (id: string, options: ToggleOptions) => void;
	clearId: (id: string) => void;
};

const isShiftClick = (event: Event) => {
	if (!(event instanceof MouseEvent)) return false;
	return event.shiftKey;
};

export const useSortBy =
	<Item>({
		initialSortKeys = [],
		disableMultiSort = false,
		isMultiSortEvent = isShiftClick,
	}: SortByConfig = {}): TablePlugin<Item, SortByState<Item>, SortByColumnOptions, SortByPropSet> =>
	({ columnOptions }) => {
		const disabledSortIds = Object.entries(columnOptions)
			.filter(([, option]) => option.disable === true)
			.map(([columnId]) => columnId);

		const sortKeys = useSortKeys(initialSortKeys);
		const preSortedRows = writable<BodyRow<Item>[]>([]);
		const sortedRows = writable<BodyRow<Item>[]>([]);

		const deriveRows: DeriveRowsFn<Item> = (rows) => {
			return derived([rows, sortKeys], ([$rows, $sortKeys]) => {
				preSortedRows.set($rows);
				const _sortedRows = [...$rows];
				_sortedRows.sort((a, b) => {
					for (const key of $sortKeys) {
						const invert = columnOptions[key.id]?.invert ?? false;
						const cellA = a.cellForId[key.id];
						const cellB = b.cellForId[key.id];
						let order = 0;
						// Only need to check properties of `cellA` as both should have the same
						// properties.
						const getSortValue = columnOptions[cellA.id]?.getSortValue;
						if (getSortValue !== undefined) {
							const sortValueA = getSortValue(cellA.value);
							const sortValueB = getSortValue(cellB.value);
							order = compare(sortValueA, sortValueB);
						} else if (typeof cellA.value === 'string' || typeof cellA.value === 'number') {
							// typeof `cellB.value` is logically equal to `cellA.value`.
							order = compare(cellA.value, cellB.value as string | number);
						}
						if (order !== 0) {
							let orderFactor = 1;
							// If the current key order is `'desc'`, reverse the order.
							if (key.order === 'desc') {
								orderFactor *= -1;
							}
							// If `invert` is `true`, we want to invert the sort without
							// affecting the view model's indication.
							if (invert) {
								orderFactor *= -1;
							}
							return order * orderFactor;
						}
					}
					return 0;
				});
				sortedRows.set(_sortedRows);
				return _sortedRows;
			});
		};

		const pluginState: SortByState<Item> = { sortKeys, preSortedRows };

		return {
			pluginState,
			deriveRows,
			hooks: {
				'thead.tr.th': (cell) => {
					const disabled = disabledSortIds.includes(cell.id);
					const props = derived(sortKeys, ($sortKeys) => {
						const key = $sortKeys.find((k) => k.id === cell.id);
						const toggle = (event: Event) => {
							if (!cell.isData) return;
							if (disabledSortIds.includes(cell.id)) return;
							sortKeys.toggleId(cell.id, {
								multiSort: disableMultiSort ? false : isMultiSortEvent(event),
							});
						};
						const clear = () => {
							if (!cell.isData) return;
							if (disabledSortIds.includes(cell.id)) return;
							sortKeys.clearId(cell.id);
						};
						return {
							order: key?.order,
							toggle,
							clear,
							disabled,
						};
					});
					return { props };
				},
				'tbody.tr.td': (cell) => {
					const props = derived(sortKeys, ($sortKeys) => {
						const key = $sortKeys.find((k) => k.id === cell.id);
						return {
							order: key?.order,
						};
					});
					return { props };
				},
			},
		};
	};

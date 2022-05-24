import { derived } from 'svelte/store';
import { BodyCell, DataBodyCell, DisplayBodyCell } from './bodyCells';
import { DataColumn, DisplayColumn, type FlatColumn } from './columns';
import { TableComponent } from './tableComponent';
import type { AnyPlugins } from './types/TablePlugin';
import { nonUndefined } from './utils/filter';

export interface DataBodyRowInit<Item, Plugins extends AnyPlugins = AnyPlugins> {
	id: string;
	original: Item;
	cells: BodyCell<Item, Plugins>[];
	cellForId: Record<string, BodyCell<Item, Plugins>>;
	depth?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-interface
export interface DataBodyRowAttributes<Item, Plugins extends AnyPlugins = AnyPlugins> {}

interface BodyRowCloneProps {
	includeCells?: boolean;
}

export class DataBodyRow<Item, Plugins extends AnyPlugins = AnyPlugins> extends TableComponent<
	Item,
	Plugins,
	'tbody.tr'
> {
	original: Item;
	cells: BodyCell<Item, Plugins>[];
	/**
	 * Get the cell with a given column id.
	 *
	 * **This includes hidden cells.**
	 */
	cellForId: Record<string, BodyCell<Item, Plugins>>;
	depth: number;
	subRows?: DataBodyRow<Item, Plugins>[];
	constructor({ id, original, cells, cellForId, depth = 0 }: DataBodyRowInit<Item, Plugins>) {
		super({ id });
		this.original = original;
		this.cells = cells;
		this.cellForId = cellForId;
		this.depth = depth;
	}

	attrs() {
		return derived([], () => {
			return {};
		});
	}

	clone({ includeCells = false }: BodyRowCloneProps = {}): DataBodyRow<Item, Plugins> {
		const clonedRow = new DataBodyRow({
			id: this.id,
			cellForId: this.cellForId,
			cells: this.cells,
			original: this.original,
			depth: this.depth,
		});
		clonedRow.metadataForName = this.metadataForName;
		if (!includeCells) {
			return clonedRow;
		}
		const clonedCellsForId = Object.fromEntries(
			Object.entries(clonedRow.cellForId).map(([id, cell]) => {
				const clonedCell = cell.clone();
				clonedCell.row = clonedRow;
				return [id, clonedCell];
			})
		);
		const clonedCells = clonedRow.cells.map(({ id }) => clonedCellsForId[id]);
		clonedRow.cellForId = clonedCellsForId;
		clonedRow.cells = clonedCells;
		return clonedRow;
	}
}

/**
 * Converts an array of items into an array of table `BodyRow`s based on the column structure.
 * @param data The data to display.
 * @param flatColumns The column structure.
 * @returns An array of `BodyRow`s representing the table structure.
 */
export const getBodyRows = <Item, Plugins extends AnyPlugins = AnyPlugins>(
	data: Item[],
	/**
	 * Flat columns before column transformations.
	 */
	flatColumns: FlatColumn<Item, Plugins>[]
): DataBodyRow<Item, Plugins>[] => {
	const rows: DataBodyRow<Item, Plugins>[] = data.map((item, idx) => {
		return new DataBodyRow({
			id: idx.toString(),
			original: item,
			cells: [],
			cellForId: {},
		});
	});
	data.forEach((item, rowIdx) => {
		const cells = flatColumns.map((col) => {
			if (col instanceof DataColumn) {
				const dataCol = col as DataColumn<Item, Plugins>;
				const value = dataCol.getValue(item);
				return new DataBodyCell<Item, Plugins>({
					row: rows[rowIdx],
					column: dataCol,
					label: col.cell,
					value,
				});
			}
			if (col instanceof DisplayColumn) {
				const displayCol = col as DisplayColumn<Item, Plugins>;
				return new DisplayBodyCell<Item, Plugins>({
					row: rows[rowIdx],
					column: displayCol,
					label: col.cell,
				});
			}
			throw new Error('Unrecognized `FlatColumn` implementation');
		});
		rows[rowIdx].cells = cells;
		flatColumns.forEach((c, colIdx) => {
			rows[rowIdx].cellForId[c.id] = cells[colIdx];
		});
	});
	return rows;
};

/**
 * Arranges and hides columns in an array of `BodyRow`s based on
 * `columnIdOrder` by transforming the `cells` property of each row.
 *
 * `cellForId` should remain unaffected.
 *
 * @param rows The rows to transform.
 * @param columnIdOrder The column order to transform to.
 * @returns A new array of `BodyRow`s with corrected row references.
 */
export const getColumnedBodyRows = <Item, Plugins extends AnyPlugins = AnyPlugins>(
	rows: DataBodyRow<Item, Plugins>[],
	columnIdOrder: string[]
): DataBodyRow<Item, Plugins>[] => {
	const columnedRows: DataBodyRow<Item, Plugins>[] = rows.map(
		({ id, original }) => new DataBodyRow({ id, original, cells: [], cellForId: {} })
	);
	if (rows.length === 0 || columnIdOrder.length === 0) return rows;
	rows.forEach((row, rowIdx) => {
		// Create a shallow copy of `row.cells` to reassign each `cell`'s `row`
		// reference.
		const cells = row.cells.map((cell) => {
			const clonedCell = cell.clone();
			clonedCell.row = columnedRows[rowIdx];
			return clonedCell;
		});
		const visibleCells = columnIdOrder
			.map((cid) => {
				return cells.find((c) => c.id === cid);
			})
			.filter(nonUndefined);
		columnedRows[rowIdx].cells = visibleCells;
		// Include hidden cells in `cellForId` to allow row transformations on
		// hidden cells.
		cells.forEach((cell) => {
			columnedRows[rowIdx].cellForId[cell.id] = cell;
		});
	});
	return columnedRows;
};

/**
 * Converts an array of items into an array of table `BodyRow`s based on a parent row.
 * @param subItems The sub data to display.
 * @param parentRow The parent row.
 * @returns An array of `BodyRow`s representing the child rows of `parentRow`.
 */
export const getSubRows = <Item, Plugins extends AnyPlugins = AnyPlugins>(
	subItems: Item[],
	parentRow: DataBodyRow<Item, Plugins>
): DataBodyRow<Item, Plugins>[] => {
	const subRows = subItems.map((item, idx) => {
		const id = `${parentRow.id}>${idx}`;
		return new DataBodyRow<Item, Plugins>({
			id,
			original: item,
			cells: [],
			cellForId: {},
			depth: parentRow.depth + 1,
		});
	});
	subItems.forEach((item, rowIdx) => {
		// parentRow.cells only include visible cells.
		// We have to derive all cells from parentRow.cellForId
		const cellForId = Object.fromEntries(
			Object.values(parentRow.cellForId).map((cell) => {
				const { column } = cell;
				if (column instanceof DataColumn) {
					const dataCol = column as DataColumn<Item, Plugins>;
					const value = dataCol.getValue(item);
					return [
						column.id,
						new DataBodyCell({ row: subRows[rowIdx], column, label: column.cell, value }),
					];
				}
				if (column instanceof DisplayColumn) {
					return [
						column.id,
						new DisplayBodyCell({ row: subRows[rowIdx], column, label: column.cell }),
					];
				}
				throw new Error('Unrecognized `FlatColumn` implementation');
			})
		);
		subRows[rowIdx].cellForId = cellForId;
		const cells = parentRow.cells.map((cell) => {
			return cellForId[cell.id];
		});
		subRows[rowIdx].cells = cells;
	});
	return subRows;
};

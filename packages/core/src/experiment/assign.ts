import type { ExperimentCondition, ExperimentModule, OrderVariant } from '@eduforge/db';

/**
 * D-30: every participant does both topics, one with the method and one as control, in some order.
 * That makes four cells (order × which topic gets the method); new participants go to the emptiest one,
 * so after any N the cells differ by at most one person and so do conditions and orders.
 */
export interface Cell {
  orderVariant: OrderVariant;
  /** The condition of topic A; topic B always gets the other one. */
  aCondition: ExperimentCondition;
}

export const CELLS: readonly Cell[] = [
  { orderVariant: 'A_then_B', aCondition: 'method' },
  { orderVariant: 'A_then_B', aCondition: 'control' },
  { orderVariant: 'B_then_A', aCondition: 'method' },
  { orderVariant: 'B_then_A', aCondition: 'control' },
];

export const cellIndex = (c: Cell) =>
  CELLS.findIndex((x) => x.orderVariant === c.orderVariant && x.aCondition === c.aCondition);

/** The next cell: one of those with the fewest participants so far, picked at random among them. */
export function chooseCell(counts: readonly number[], rng: () => number = Math.random): Cell {
  const min = Math.min(...CELLS.map((_, i) => counts[i] ?? 0));
  const open = CELLS.filter((_, i) => (counts[i] ?? 0) === min);
  return open[Math.floor(rng() * open.length)]!;
}

export interface ModuleAssignment {
  module: ExperimentModule;
  condition: ExperimentCondition;
  period: 1 | 2;
}

export function assignmentsOf(cell: Cell): ModuleAssignment[] {
  const other = (c: ExperimentCondition): ExperimentCondition =>
    c === 'method' ? 'control' : 'method';
  const aFirst = cell.orderVariant === 'A_then_B';
  return [
    { module: 'A', condition: cell.aCondition, period: aFirst ? 1 : 2 },
    { module: 'B', condition: other(cell.aCondition), period: aFirst ? 2 : 1 },
  ];
}

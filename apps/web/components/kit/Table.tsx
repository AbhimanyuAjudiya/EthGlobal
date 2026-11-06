import type { ReactNode } from 'react';

export interface TableColumn {
  key: string;
  label: ReactNode;
  /** Numbers right-aligned, tabular. */
  numeric?: boolean;
}

export interface TableProps {
  columns: readonly TableColumn[];
  rows: readonly Readonly<Record<string, ReactNode>>[];
  /** The table's caption (visually hidden unless `showCaption`). */
  caption: string;
  showCaption?: boolean;
  /** Row keys; default the index. */
  rowKey?: (row: Readonly<Record<string, ReactNode>>, index: number) => string;
  'data-testid'?: string;
}

/** Console: 44 px rows, sticky header, numbers right; scrolls sideways inside its own focusable box. */
export function Table({
  columns,
  rows,
  caption,
  showCaption = false,
  rowKey,
  'data-testid': testId,
}: TableProps) {
  return (
    // a scrollable region must be reachable by keyboard (axe scrollable-region-focusable)
    <div className="kit-table" tabIndex={0} role="region" aria-label={caption} data-testid={testId}>
      <table>
        <caption className={showCaption ? 'kit-table__caption t-label' : 'ui-visually-hidden'}>
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" data-numeric={c.numeric ? true : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : i}>
              {columns.map((c) => (
                <td key={c.key} data-numeric={c.numeric ? true : undefined}>
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

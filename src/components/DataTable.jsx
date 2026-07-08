import React from 'react';

export default function DataTable({ columns, data, onRowClick, emptyMessage = 'Keine Daten vorhanden' }) {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">{emptyMessage}</div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-teal-primary text-white">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2.5 text-left font-semibold whitespace-nowrap"
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => (
            <tr
              key={row.id || idx}
              onClick={() => onRowClick?.(row)}
              className={`border-t border-gray-100 ${
                onRowClick ? 'cursor-pointer hover:bg-teal-50' : ''
              } ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
            >
              {columns.map((col) => (
                <td key={col.key} className="px-3 py-2 whitespace-nowrap">
                  {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

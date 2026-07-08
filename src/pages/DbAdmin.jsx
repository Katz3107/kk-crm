import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Database, ChevronRight, RefreshCw, Plus, Trash2, Save, X, AlertTriangle } from 'lucide-react';

// Formatiert einen Zellwert zur Anzeige
function formatCell(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

// Parst einen Eingabewert zurueck in den passenden Typ
function parseInput(val, dataType) {
  if (val === '' || val === null || val === undefined) return null;
  if (dataType === 'integer' || dataType === 'bigint' || dataType === 'smallint') {
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  }
  if (dataType === 'numeric' || dataType === 'real' || dataType === 'double precision') {
    const n = parseFloat(String(val).replace(',', '.'));
    return isNaN(n) ? null : n;
  }
  if (dataType === 'boolean') {
    if (val === 'true' || val === true) return true;
    if (val === 'false' || val === false) return false;
    return null;
  }
  if (dataType === 'json' || dataType === 'jsonb') {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

export default function DbAdmin() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTable = searchParams.get('t') || null;

  const [tables, setTables] = useState([]);
  const [tableData, setTableData] = useState(null); // { columns, pkColumns, rows, truncated }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // { rowIdx, col, value }
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [showNewRow, setShowNewRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState({});

  // Tabellen-Liste laden
  useEffect(() => {
    fetch('/api/db-admin/tables')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTables(data);
        else setError(data.error || 'Fehler beim Laden');
      })
      .catch((e) => setError(e.message));
  }, []);

  // Ausgewaehlte Tabelle laden
  const loadTable = (name) => {
    setLoading(true);
    setError(null);
    setEditing(null);
    setShowNewRow(false);
    setNewRowValues({});
    fetch(`/api/db-admin/tables/${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setTableData(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (selectedTable) loadTable(selectedTable);
    else setTableData(null);
  }, [selectedTable]);

  // Filter auf Zeilen
  const filteredRows = useMemo(() => {
    if (!tableData || !filter.trim()) return tableData?.rows || [];
    const f = filter.toLowerCase();
    return tableData.rows.filter((row) =>
      Object.values(row).some((v) => formatCell(v).toLowerCase().includes(f))
    );
  }, [tableData, filter]);

  // PK-Map einer Zeile extrahieren
  const pkOf = (row) => {
    const pk = {};
    (tableData?.pkColumns || []).forEach((c) => { pk[c] = row[c]; });
    return pk;
  };

  // Zelle speichern
  const saveCell = async () => {
    if (!editing || !tableData) return;
    const { rowIdx, col, value } = editing;
    const row = filteredRows[rowIdx];
    const colMeta = tableData.columns.find((c) => c.column_name === col);
    const parsed = parseInput(value, colMeta?.data_type);
    if (parsed === row[col]) { setEditing(null); return; }

    if (tableData.pkColumns.length === 0) {
      alert('Diese Tabelle hat keinen Primary Key - Bearbeitung nicht moeglich.');
      setEditing(null);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/db-admin/tables/${encodeURIComponent(selectedTable)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pk: pkOf(row), updates: { [col]: parsed } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler beim Speichern');
      // Row im State aktualisieren
      setTableData((td) => ({
        ...td,
        rows: td.rows.map((r) => (r === row ? data : r)),
      }));
      setEditing(null);
    } catch (e) {
      alert('Fehler: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Zeile loeschen
  const deleteRow = async (row) => {
    if (!tableData || tableData.pkColumns.length === 0) {
      alert('Diese Tabelle hat keinen Primary Key - Loeschen nicht moeglich.');
      return;
    }
    const pk = pkOf(row);
    const pkStr = Object.entries(pk).map(([k, v]) => `${k}=${v}`).join(', ');
    if (!confirm(`Zeile wirklich loeschen?\n\n${pkStr}`)) return;
    try {
      const res = await fetch(`/api/db-admin/tables/${encodeURIComponent(selectedTable)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pk }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler beim Loeschen');
      setTableData((td) => ({ ...td, rows: td.rows.filter((r) => r !== row) }));
    } catch (e) {
      alert('Fehler: ' + e.message);
    }
  };

  // Neue Zeile speichern
  const saveNewRow = async () => {
    if (!tableData) return;
    const parsed = {};
    for (const col of tableData.columns) {
      const raw = newRowValues[col.column_name];
      if (raw !== undefined && raw !== '') {
        parsed[col.column_name] = parseInput(raw, col.data_type);
      }
    }
    if (Object.keys(parsed).length === 0) { alert('Keine Werte eingegeben'); return; }
    try {
      const res = await fetch(`/api/db-admin/tables/${encodeURIComponent(selectedTable)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler beim Einfuegen');
      setTableData((td) => ({ ...td, rows: [...td.rows, data] }));
      setShowNewRow(false);
      setNewRowValues({});
    } catch (e) {
      alert('Fehler: ' + e.message);
    }
  };

  // === Tabellen-Liste (wenn keine ausgewaehlt) ===
  if (!selectedTable) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <Database size={28} className="text-violet-600" />
          <h2 className="text-2xl font-bold text-teal-dark">DB-Admin (Notfall)</h2>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <strong>Achtung:</strong> Direkter Zugriff auf die Datenbank. Aenderungen sind sofort wirksam und koennen nicht rueckgaengig gemacht werden.
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4">{error}</div>}

        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 font-semibold text-sm text-gray-700">
            {tables.length} Tabellen
          </div>
          <ul className="divide-y divide-gray-100">
            {tables.map((t) => (
              <li key={t.table_name}>
                <button
                  onClick={() => setSearchParams({ t: t.table_name })}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-violet-50 transition-colors text-left"
                >
                  <span className="font-mono text-sm text-gray-800">{t.table_name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">~{t.approx_rows ?? '?'} Zeilen</span>
                    <ChevronRight size={16} className="text-gray-400" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // === Tabellen-Ansicht ===
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => setSearchParams({})}
          className="text-sm text-violet-600 hover:underline"
        >
          &larr; Tabellen
        </button>
        <Database size={22} className="text-violet-600" />
        <h2 className="text-xl font-bold text-teal-dark font-mono">{selectedTable}</h2>
        <button
          onClick={() => loadTable(selectedTable)}
          className="p-1.5 rounded hover:bg-gray-100"
          title="Neu laden"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded mb-4">{error}</div>}

      {tableData && (
        <>
          <div className="flex items-center gap-3 mb-3">
            <input
              type="text"
              placeholder="Filter (durchsucht alle Spalten)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm w-80"
            />
            <span className="text-sm text-gray-500">
              {filteredRows.length} / {tableData.rows.length} Zeilen
              {tableData.truncated && <span className="text-amber-600 ml-2">(abgeschnitten bei 5000)</span>}
            </span>
            <button
              onClick={() => setShowNewRow(true)}
              className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white rounded text-sm hover:bg-violet-700"
            >
              <Plus size={14} /> Neue Zeile
            </button>
          </div>

          {tableData.pkColumns.length === 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm p-2 rounded mb-3">
              Diese Tabelle hat keinen Primary Key - Bearbeiten/Loeschen ist nicht moeglich.
            </div>
          )}

          {/* Scroll-Container mit Sticky Header + Sticky erster Spalte */}
          <div className="border border-gray-200 rounded-lg bg-white shadow overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
            <table className="text-xs border-collapse" style={{ borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th
                    className="bg-gray-100 border-b border-r border-gray-300 px-2 py-2 text-left font-semibold text-gray-700"
                    style={{ position: 'sticky', top: 0, left: 0, zIndex: 30, minWidth: 60 }}
                  >
                    #
                  </th>
                  {tableData.columns.map((col) => (
                    <th
                      key={col.column_name}
                      className="bg-gray-100 border-b border-r border-gray-300 px-2 py-2 text-left font-semibold text-gray-700 whitespace-nowrap"
                      style={{ position: 'sticky', top: 0, zIndex: 20 }}
                    >
                      <div className="flex flex-col">
                        <span className={tableData.pkColumns.includes(col.column_name) ? 'text-violet-700' : ''}>
                          {col.column_name}
                          {tableData.pkColumns.includes(col.column_name) && ' 🔑'}
                        </span>
                        <span className="text-[10px] font-normal text-gray-500">{col.data_type}</span>
                      </div>
                    </th>
                  ))}
                  <th
                    className="bg-gray-100 border-b border-gray-300 px-2 py-2"
                    style={{ position: 'sticky', top: 0, zIndex: 20, minWidth: 50 }}
                  />
                </tr>
              </thead>
              <tbody>
                {showNewRow && (
                  <tr className="bg-green-50">
                    <td
                      className="border-b border-r border-gray-200 px-2 py-1 text-gray-500 font-mono"
                      style={{ position: 'sticky', left: 0, zIndex: 10, background: '#f0fdf4' }}
                    >
                      neu
                    </td>
                    {tableData.columns.map((col) => (
                      <td key={col.column_name} className="border-b border-r border-gray-200 px-1 py-1">
                        <input
                          type="text"
                          value={newRowValues[col.column_name] || ''}
                          onChange={(e) => setNewRowValues({ ...newRowValues, [col.column_name]: e.target.value })}
                          placeholder={col.column_default || ''}
                          className="w-full px-1 py-0.5 border border-gray-300 rounded text-xs"
                          style={{ minWidth: 100 }}
                        />
                      </td>
                    ))}
                    <td className="border-b border-gray-200 px-1 py-1 whitespace-nowrap">
                      <button onClick={saveNewRow} className="p-1 text-green-600 hover:bg-green-100 rounded" title="Speichern">
                        <Save size={14} />
                      </button>
                      <button onClick={() => { setShowNewRow(false); setNewRowValues({}); }} className="p-1 text-gray-500 hover:bg-gray-100 rounded" title="Abbrechen">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                )}
                {filteredRows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-violet-50/30">
                    <td
                      className="border-b border-r border-gray-200 px-2 py-1 text-gray-500 font-mono bg-white"
                      style={{ position: 'sticky', left: 0, zIndex: 10 }}
                    >
                      {rowIdx + 1}
                    </td>
                    {tableData.columns.map((col) => {
                      const isEditing = editing && editing.rowIdx === rowIdx && editing.col === col.column_name;
                      const val = row[col.column_name];
                      return (
                        <td
                          key={col.column_name}
                          className="border-b border-r border-gray-200 px-2 py-1 align-top cursor-cell"
                          onClick={() => {
                            if (tableData.pkColumns.length === 0) return;
                            if (tableData.pkColumns.includes(col.column_name)) return; // PK nicht editieren
                            setEditing({ rowIdx, col: col.column_name, value: formatCell(val) });
                          }}
                          style={{ maxWidth: 300 }}
                        >
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                autoFocus
                                value={editing.value}
                                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveCell();
                                  if (e.key === 'Escape') setEditing(null);
                                }}
                                className="w-full px-1 py-0.5 border border-violet-400 rounded text-xs"
                                disabled={saving}
                              />
                              <button onClick={(e) => { e.stopPropagation(); saveCell(); }} className="text-green-600 hover:bg-green-100 rounded p-0.5">
                                <Save size={12} />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); setEditing(null); }} className="text-gray-500 hover:bg-gray-100 rounded p-0.5">
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <div className="truncate" title={formatCell(val)}>
                              {val === null ? <span className="text-gray-400 italic">null</span> : formatCell(val)}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-gray-200 px-1 py-1 whitespace-nowrap bg-white">
                      <button
                        onClick={() => deleteRow(row)}
                        className="p-1 text-red-500 hover:bg-red-50 rounded"
                        title="Zeile loeschen"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 text-xs text-gray-500">
            Tipp: Zelle anklicken zum Bearbeiten &middot; Enter = Speichern &middot; Esc = Abbrechen &middot; PK-Spalten (🔑) sind gesperrt
          </div>
        </>
      )}
    </div>
  );
}

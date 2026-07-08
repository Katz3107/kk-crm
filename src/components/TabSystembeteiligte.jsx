import React, { useState, useEffect } from 'react';
import { Plus, Save, X, Edit2 } from 'lucide-react';
import { getSystembeteiligte, createSystembeteiligter, updateSystembeteiligter } from '../lib/api.js';
import { stripHtml, containsHtml, sanitizeHtml } from '../lib/format.js';

const emptyRow = { kuerzel: '', name: '', funktion: '', beschreibung: '' };

/** Modal fuer Systembeteiligte-Details */
function SystembeteiligteDetailModal({ row, onClose, onSave }) {
  const [data, setData] = useState({ ...row });

  const handleSave = async () => {
    await onSave(data);
    onClose();
  };

  const hasHtml = containsHtml(row.beschreibung);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-teal-primary text-white rounded-t-xl">
          <h3 className="font-semibold">Systembeteiligte - Details</h3>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Kuerzel</label>
              <div className="px-2.5 py-1.5 border border-gray-200 rounded-md text-sm bg-gray-50">{row.kuerzel || '-'}</div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <div className="px-2.5 py-1.5 border border-gray-200 rounded-md text-sm bg-gray-50">{row.name || '-'}</div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Funktion</label>
              <div className="px-2.5 py-1.5 border border-gray-200 rounded-md text-sm bg-gray-50">{row.funktion || '-'}</div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Beschreibung</label>
            {hasHtml && row.beschreibung ? (
              <div
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 min-h-[10rem] overflow-y-auto max-h-64 richtext-display"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(row.beschreibung) }}
              />
            ) : (
              <div className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 min-h-[10rem] whitespace-pre-wrap">
                {row.beschreibung || '-'}
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-3 px-5 py-3 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100"
          >
            Schliessen
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TabSystembeteiligte({ kontaktId, kuerzel }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newData, setNewData] = useState({ ...emptyRow, kuerzel: kuerzel || '' });
  const [detailRow, setDetailRow] = useState(null);

  const load = () => {
    setLoading(true);
    getSystembeteiligte(kontaktId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [kontaktId]);

  const handleSaveNew = async () => {
    try {
      await createSystembeteiligter(kontaktId, newData);
      setShowNew(false);
      setNewData({ ...emptyRow, kuerzel: kuerzel || '' });
      load();
    } catch (e) { alert('Fehler: ' + e.message); }
  };

  const handleSaveEdit = async () => {
    try {
      await updateSystembeteiligter(editId, editData);
      setEditId(null);
      setEditData(null);
      load();
    } catch (e) { alert('Fehler: ' + e.message); }
  };

  const truncateText = (text) => {
    if (!text) return '';
    const plain = containsHtml(text) ? stripHtml(text) : text;
    return plain.length > 80 ? plain.substring(0, 80) + '...' : plain;
  };

  const InlineInput = ({ value, onChange, className = 'w-full' }) => (
    <input
      type="text"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className={`px-1.5 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-teal-primary/40 ${className}`}
    />
  );

  if (loading) return <div className="text-center py-8 text-gray-400">Laden...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-teal-dark">Systembeteiligte ({data.length})</h3>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover"
        >
          <Plus size={16} />
          Neuer Eintrag
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-teal-primary text-white">
              <th className="px-3 py-2 text-left">Kuerzel</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Funktion</th>
              <th className="px-3 py-2 text-left">Beschreibung</th>
              <th className="px-3 py-2 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {showNew && (
              <tr className="bg-teal-50 border-t">
                <td className="px-2 py-1"><InlineInput value={newData.kuerzel} onChange={(v) => setNewData({...newData, kuerzel: v})} /></td>
                <td className="px-2 py-1"><InlineInput value={newData.name} onChange={(v) => setNewData({...newData, name: v})} /></td>
                <td className="px-2 py-1"><InlineInput value={newData.funktion} onChange={(v) => setNewData({...newData, funktion: v})} /></td>
                <td className="px-2 py-1"><InlineInput value={newData.beschreibung} onChange={(v) => setNewData({...newData, beschreibung: v})} /></td>
                <td className="px-2 py-1 flex gap-1">
                  <button onClick={handleSaveNew} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save size={14} /></button>
                  <button onClick={() => setShowNew(false)} className="p-1 text-red-500 hover:bg-red-50 rounded"><X size={14} /></button>
                </td>
              </tr>
            )}
            {data.map((row, idx) => {
              const isEditing = editId === row.id;
              const d = isEditing ? editData : row;
              return (
                <tr
                  key={row.id}
                  className={`border-t ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} ${isEditing ? '!bg-yellow-50' : 'cursor-pointer hover:bg-teal-50/50'}`}
                  onDoubleClick={() => !isEditing && setDetailRow(row)}
                >
                  {isEditing ? (
                    <>
                      <td className="px-2 py-1"><InlineInput value={d.kuerzel} onChange={(v) => setEditData({...d, kuerzel: v})} /></td>
                      <td className="px-2 py-1"><InlineInput value={d.name} onChange={(v) => setEditData({...d, name: v})} /></td>
                      <td className="px-2 py-1"><InlineInput value={d.funktion} onChange={(v) => setEditData({...d, funktion: v})} /></td>
                      <td className="px-2 py-1"><InlineInput value={d.beschreibung} onChange={(v) => setEditData({...d, beschreibung: v})} /></td>
                      <td className="px-2 py-1 flex gap-1">
                        <button onClick={handleSaveEdit} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save size={14} /></button>
                        <button onClick={() => { setEditId(null); setEditData(null); }} className="p-1 text-red-500 hover:bg-red-50 rounded"><X size={14} /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2">{row.kuerzel}</td>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2">{row.funktion}</td>
                      <td className="px-3 py-2 max-w-[300px] truncate" title={stripHtml(row.beschreibung)}>{truncateText(row.beschreibung)}</td>
                      <td className="px-3 py-2">
                        <button onClick={() => { setEditId(row.id); setEditData({...row}); }} className="p-1 text-gray-400 hover:text-teal-primary hover:bg-teal-50 rounded"><Edit2 size={14} /></button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {data.length === 0 && !showNew && (
              <tr><td colSpan={5} className="text-center py-8 text-gray-400">Keine Systembeteiligten vorhanden</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Modal */}
      {detailRow && (
        <SystembeteiligteDetailModal
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onSave={async (updatedData) => {
            try {
              await updateSystembeteiligter(detailRow.id, updatedData);
              load();
            } catch (e) {
              alert('Fehler: ' + e.message);
            }
          }}
        />
      )}
    </div>
  );
}

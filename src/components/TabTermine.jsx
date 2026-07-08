import React, { useState, useEffect } from 'react';
import { Plus, Save, X, Edit2, Trash2 } from 'lucide-react';
import { getTermine, createTermin, updateTermin, deleteTermin } from '../lib/api.js';
import { formatDate, formatDateTime, formatCurrency, stripHtml, containsHtml, sanitizeHtml } from '../lib/format.js';

const emptyTermin = {
  kuerzel: '',
  einzel_paket: '',
  aktion: '',
  datum: '',
  inhalt: '',
  hausaufgabe: '',
  uebung: '',
  einzelpreis: '',
  einzeldauer: '',
  logbuch_versendet_am: '',
};

/** InlineInput AUSSERHALB der Komponente — verhindert Fokus-Verlust */
function InlineInput({ value, onChange, type = 'text', className = 'w-full' }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      className={`px-1.5 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-teal-primary/40 ${className}`}
    />
  );
}

/** Modal fuer Termin-Details (alle Felder gross anzeigen, editierbar) */
function TerminDetailModal({ termin, onClose, onSave }) {
  const [data, setData] = useState(() => ({
    ...termin,
    inhalt: containsHtml(termin.inhalt) ? stripHtml(termin.inhalt) : (termin.inhalt || ''),
    hausaufgabe: containsHtml(termin.hausaufgabe) ? stripHtml(termin.hausaufgabe) : (termin.hausaufgabe || ''),
    uebung: containsHtml(termin.uebung) ? stripHtml(termin.uebung) : (termin.uebung || ''),
  }));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(data);
      onClose();
    } catch (e) {
      alert('Fehler beim Speichern: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleField = (field, value) => setData(prev => ({ ...prev, [field]: value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-6xl mx-4 flex flex-col h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-teal-primary text-white rounded-t-xl">
          <h3 className="font-semibold">Termin bearbeiten</h3>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-4 min-h-0">
          {/* Kopf-Infos — editierbar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Kuerzel</label>
              <input type="text" value={data.kuerzel || ''} onChange={e => handleField('kuerzel', e.target.value)}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Einzel/Paket</label>
              <input type="text" value={data.einzel_paket || ''} onChange={e => handleField('einzel_paket', e.target.value)}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Aktion</label>
              <input type="text" value={data.aktion || ''} onChange={e => handleField('aktion', e.target.value)}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Datum</label>
              <input type="datetime-local" value={data.datum ? data.datum.substring(0, 16) : ''} onChange={e => handleField('datum', e.target.value)}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40" />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Einzelpreis</label>
              <input type="number" value={data.einzelpreis || ''} onChange={e => handleField('einzelpreis', e.target.value)}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">E-dauer</label>
              <input type="text" value={data.einzeldauer || ''} onChange={e => handleField('einzeldauer', e.target.value)}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Logbuch versendet am</label>
              <input type="date" value={data.logbuch_versendet_am || ''} onChange={e => handleField('logbuch_versendet_am', e.target.value)}
                className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40" />
            </div>
          </div>

          {/* Grosse Textfelder — editierbar, teilen sich den restlichen Platz */}
          <div className="flex flex-col flex-1 gap-3 min-h-0">
            <div className="flex flex-col flex-1 min-h-[200px]">
              <label className="block text-xs text-gray-500 mb-1 font-medium">Inhalt</label>
              <textarea value={data.inhalt} onChange={e => handleField('inhalt', e.target.value)}
                className="w-full flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40 resize-none" />
            </div>
            <div className="flex flex-col flex-1 min-h-[200px]">
              <label className="block text-xs text-gray-500 mb-1 font-medium">Hausaufgabe</label>
              <textarea value={data.hausaufgabe} onChange={e => handleField('hausaufgabe', e.target.value)}
                className="w-full flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40 resize-none" />
            </div>
            <div className="flex flex-col flex-1 min-h-[200px]">
              <label className="block text-xs text-gray-500 mb-1 font-medium">Uebung</label>
              <textarea value={data.uebung} onChange={e => handleField('uebung', e.target.value)}
                className="w-full flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40 resize-none" />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-5 py-3 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TabTermine({ kontaktId, kuerzel, onOpenTermin }) {
  const [termine, setTermine] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newData, setNewData] = useState({ ...emptyTermin, kuerzel: kuerzel || '' });
  const [detailTermin, setDetailTermin] = useState(null); // Fallback wenn kein onOpenTermin

  const load = () => {
    setLoading(true);
    getTermine(kontaktId)
      .then(setTermine)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [kontaktId]);

  const handleEdit = (termin, e) => {
    e.stopPropagation();
    setEditId(termin.id);
    setEditData({ ...termin });
  };

  const handleSaveEdit = async () => {
    try {
      await updateTermin(editId, editData);
      setEditId(null);
      setEditData(null);
      load();
    } catch (e) {
      alert('Fehler: ' + e.message);
    }
  };

  const handleStartNew = () => {
    // Default einzel_paket vom letzten (neuesten) Termin uebernehmen
    const defaultEinzelPaket = termine.length > 0 ? (termine[0].einzel_paket || '') : '';
    setNewData({ ...emptyTermin, kuerzel: kuerzel || '', einzel_paket: defaultEinzelPaket });
    setShowNew(true);
  };

  const handleSaveNew = async () => {
    try {
      await createTermin(kontaktId, newData);
      setShowNew(false);
      setNewData({ ...emptyTermin, kuerzel: kuerzel || '' });
      load();
    } catch (e) {
      alert('Fehler: ' + e.message);
    }
  };

  const handleDelete = async (termin, e) => {
    e.stopPropagation();
    const desc = termin.datum ? formatDateTime(termin.datum) : termin.kuerzel || `#${termin.id}`;
    if (!confirm(`Termin "${desc}" wirklich loeschen?`)) return;
    try {
      await deleteTermin(termin.id);
      load();
    } catch (e) {
      alert('Fehler beim Loeschen: ' + e.message);
    }
  };

  const handleRowClick = (termin) => {
    if (editId === termin.id) return;
    if (onOpenTermin) {
      onOpenTermin(termin, load);
    } else {
      setDetailTermin(termin);
    }
  };

  const truncateText = (text) => {
    if (!text) return '';
    const plain = containsHtml(text) ? stripHtml(text) : text;
    return plain.length > 50 ? plain.substring(0, 50) + '...' : plain;
  };

  // Stabiler onChange fuer editData — verhindert Fokus-Verlust
  const handleEditField = (field, value) => {
    setEditData(prev => ({ ...prev, [field]: value }));
  };

  const handleNewField = (field, value) => {
    setNewData(prev => ({ ...prev, [field]: value }));
  };

  if (loading) return <div className="text-center py-8 text-gray-400">Laden...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-teal-dark">Termine ({termine.length})</h3>
        <button
          onClick={handleStartNew}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover"
        >
          <Plus size={16} />
          Neuer Termin
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-teal-primary text-white">
              <th className="px-2 py-2 text-left">Kuerzel</th>
              <th className="px-2 py-2 text-left">Einzel/Paket</th>
              <th className="px-2 py-2 text-left">Aktion</th>
              <th className="px-2 py-2 text-left">Datum</th>
              <th className="px-2 py-2 text-left">Inhalt</th>
              <th className="px-2 py-2 text-left">Hausaufgabe</th>
              <th className="px-2 py-2 text-left">Uebung</th>
              <th className="px-2 py-2 text-right">Einzelpreis</th>
              <th className="px-2 py-2 text-left">E-dauer</th>
              <th className="px-2 py-2 text-left">Logbuch versendet</th>
              <th className="px-2 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {/* New row */}
            {showNew && (
              <tr className="bg-teal-50 border-t">
                <td className="px-2 py-1"><InlineInput value={newData.kuerzel} onChange={(v) => handleNewField('kuerzel', v)} /></td>
                <td className="px-2 py-1"><InlineInput value={newData.einzel_paket} onChange={(v) => handleNewField('einzel_paket', v)} /></td>
                <td className="px-2 py-1"><InlineInput value={newData.aktion} onChange={(v) => handleNewField('aktion', v)} /></td>
                <td className="px-2 py-1"><InlineInput value={newData.datum} onChange={(v) => handleNewField('datum', v)} type="datetime-local" /></td>
                <td className="px-2 py-1"><InlineInput value={newData.inhalt} onChange={(v) => handleNewField('inhalt', v)} /></td>
                <td className="px-2 py-1"><InlineInput value={newData.hausaufgabe} onChange={(v) => handleNewField('hausaufgabe', v)} /></td>
                <td className="px-2 py-1"><InlineInput value={newData.uebung} onChange={(v) => handleNewField('uebung', v)} /></td>
                <td className="px-2 py-1"><InlineInput value={newData.einzelpreis} onChange={(v) => handleNewField('einzelpreis', v)} type="number" /></td>
                <td className="px-2 py-1"><InlineInput value={newData.einzeldauer} onChange={(v) => handleNewField('einzeldauer', v)} /></td>
                <td className="px-2 py-1"><InlineInput value={newData.logbuch_versendet_am} onChange={(v) => handleNewField('logbuch_versendet_am', v)} type="date" /></td>
                <td className="px-2 py-1 flex gap-1">
                  <button onClick={handleSaveNew} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save size={14} /></button>
                  <button onClick={() => setShowNew(false)} className="p-1 text-red-500 hover:bg-red-50 rounded"><X size={14} /></button>
                </td>
              </tr>
            )}
            {termine.map((t, idx) => {
              const isEditing = editId === t.id;
              return (
                <tr
                  key={t.id}
                  className={`border-t ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} ${isEditing ? '!bg-yellow-50' : 'cursor-pointer hover:bg-teal-50/50'}`}
                  onClick={() => !isEditing && handleRowClick(t)}
                >
                  {isEditing ? (
                    <>
                      <td className="px-2 py-1"><InlineInput value={editData.kuerzel} onChange={(v) => handleEditField('kuerzel', v)} /></td>
                      <td className="px-2 py-1"><InlineInput value={editData.einzel_paket} onChange={(v) => handleEditField('einzel_paket', v)} /></td>
                      <td className="px-2 py-1"><InlineInput value={editData.aktion} onChange={(v) => handleEditField('aktion', v)} /></td>
                      <td className="px-2 py-1"><InlineInput value={editData.datum ? editData.datum.substring(0,16) : ''} onChange={(v) => handleEditField('datum', v)} type="datetime-local" /></td>
                      <td className="px-2 py-1"><InlineInput value={editData.inhalt} onChange={(v) => handleEditField('inhalt', v)} /></td>
                      <td className="px-2 py-1"><InlineInput value={editData.hausaufgabe} onChange={(v) => handleEditField('hausaufgabe', v)} /></td>
                      <td className="px-2 py-1"><InlineInput value={editData.uebung} onChange={(v) => handleEditField('uebung', v)} /></td>
                      <td className="px-2 py-1"><InlineInput value={editData.einzelpreis} onChange={(v) => handleEditField('einzelpreis', v)} type="number" /></td>
                      <td className="px-2 py-1"><InlineInput value={editData.einzeldauer} onChange={(v) => handleEditField('einzeldauer', v)} /></td>
                      <td className="px-2 py-1"><InlineInput value={editData.logbuch_versendet_am || ''} onChange={(v) => handleEditField('logbuch_versendet_am', v)} type="date" /></td>
                      <td className="px-2 py-1 flex gap-1">
                        <button onClick={handleSaveEdit} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Save size={14} /></button>
                        <button onClick={() => { setEditId(null); setEditData(null); }} className="p-1 text-red-500 hover:bg-red-50 rounded"><X size={14} /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-1.5">{t.kuerzel}</td>
                      <td className="px-2 py-1.5">{t.einzel_paket}</td>
                      <td className="px-2 py-1.5">{t.aktion}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{formatDateTime(t.datum)}</td>
                      <td className="px-2 py-1.5 max-w-[150px] truncate" title={stripHtml(t.inhalt)}>{truncateText(t.inhalt)}</td>
                      <td className="px-2 py-1.5 max-w-[120px] truncate" title={stripHtml(t.hausaufgabe)}>{truncateText(t.hausaufgabe)}</td>
                      <td className="px-2 py-1.5 max-w-[100px] truncate" title={stripHtml(t.uebung)}>{truncateText(t.uebung)}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatCurrency(t.einzelpreis)}</td>
                      <td className="px-2 py-1.5">{t.einzeldauer}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(t.logbuch_versendet_am)}</td>
                      <td className="px-2 py-1.5 flex gap-1">
                        <button onClick={(e) => handleEdit(t, e)} className="p-1 text-gray-400 hover:text-teal-primary hover:bg-teal-50 rounded" title="Bearbeiten"><Edit2 size={14} /></button>
                        <button onClick={(e) => handleDelete(t, e)} className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded" title="Loeschen"><Trash2 size={14} /></button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {termine.length === 0 && !showNew && (
              <tr><td colSpan={11} className="text-center py-8 text-gray-400">Keine Termine vorhanden</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Modal */}
      {detailTermin && (
        <TerminDetailModal
          termin={detailTermin}
          onClose={() => setDetailTermin(null)}
          onSave={async (updatedData) => {
            try {
              await updateTermin(detailTermin.id, updatedData);
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

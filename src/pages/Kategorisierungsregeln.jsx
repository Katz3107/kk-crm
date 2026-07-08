import React, { useState, useEffect } from 'react';
import { getKategorisierungsregeln, createKategorisierungsregel, updateKategorisierungsregel, deleteKategorisierungsregel, getVerschluesselungVorschlaege } from '../lib/api.js';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Save, X, ToggleLeft, ToggleRight, ArrowLeft } from 'lucide-react';

const leer = { name_pattern: '', zweck_pattern: '', betrag_von: '', betrag_bis: '', steuerschluessel: '', schluessel: '', beschreibung: '', prioritaet: 50 };

export default function Kategorisierungsregeln() {
  const navigate = useNavigate();
  const [regeln, setRegeln] = useState([]);
  const [vorschlaege, setVorschlaege] = useState({ steuerschluessel: [], schluessel: [], beschreibung: [], kombinationen: [] });
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState(null);
  const [editData, setEditData] = useState({});
  const [neuRegel, setNeuRegel] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filterSchluessel, setFilterSchluessel] = useState('');

  const load = () => {
    setLoading(true);
    getKategorisierungsregeln()
      .then(setRegeln)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    getVerschluesselungVorschlaege().then(setVorschlaege).catch(console.error);
  }, []);

  const beschreibungsVorschlaege = (currentSchluessel) => {
    if (!currentSchluessel) return vorschlaege.beschreibung;
    const passend = vorschlaege.kombinationen
      .filter(k => k.schluessel === currentSchluessel && k.beschreibung)
      .map(k => k.beschreibung);
    return passend.length > 0 ? [...new Set(passend)].sort() : vorschlaege.beschreibung;
  };

  const stSchlFuerSchluessel = (schl) => {
    if (!schl) return null;
    const stschls = [...new Set(
      vorschlaege.kombinationen
        .filter(k => k.schluessel === schl && k.steuerschluessel)
        .map(k => k.steuerschluessel)
    )];
    return stschls.length === 1 ? stschls[0] : null;
  };

  const startEdit = (r) => {
    setEditId(r.id);
    setNeuRegel(null);
    setEditData({
      name_pattern: r.name_pattern || '',
      zweck_pattern: r.zweck_pattern || '',
      betrag_von: r.betrag_von ?? '',
      betrag_bis: r.betrag_bis ?? '',
      steuerschluessel: r.steuerschluessel || '',
      schluessel: r.schluessel || '',
      beschreibung: r.beschreibung || '',
      prioritaet: r.prioritaet ?? 50,
    });
  };

  const cancelEdit = () => { setEditId(null); setEditData({}); };

  const saveEdit = async () => {
    setSaving(true);
    try {
      const payload = {
        ...editData,
        betrag_von: editData.betrag_von !== '' ? parseFloat(editData.betrag_von) : null,
        betrag_bis: editData.betrag_bis !== '' ? parseFloat(editData.betrag_bis) : null,
        prioritaet: parseInt(editData.prioritaet) || 50,
      };
      await updateKategorisierungsregel(editId, payload);
      setEditId(null);
      load();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (r) => {
    try {
      await updateKategorisierungsregel(r.id, { ...r, aktiv: !r.aktiv });
      load();
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  };

  const handleDelete = async (r) => {
    if (!confirm(`Regel "${r.schluessel} / ${r.name_pattern || r.zweck_pattern}" wirklich loeschen?`)) return;
    try {
      await deleteKategorisierungsregel(r.id);
      load();
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  };

  const startNeu = () => {
    setEditId(null);
    setNeuRegel({ ...leer });
  };

  const saveNeu = async () => {
    setSaving(true);
    try {
      const payload = {
        ...neuRegel,
        betrag_von: neuRegel.betrag_von !== '' ? parseFloat(neuRegel.betrag_von) : null,
        betrag_bis: neuRegel.betrag_bis !== '' ? parseFloat(neuRegel.betrag_bis) : null,
        prioritaet: parseInt(neuRegel.prioritaet) || 50,
      };
      await createKategorisierungsregel(payload);
      setNeuRegel(null);
      load();
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e, saveFn) => {
    if (e.key === 'Enter') saveFn();
    if (e.key === 'Escape') { setEditId(null); setNeuRegel(null); }
  };

  // Alle vorhandenen Schluessel fuer Filter
  const alleSchluessel = [...new Set(regeln.map(r => r.schluessel).filter(Boolean))].sort();

  const filtered = filterSchluessel
    ? regeln.filter(r => r.schluessel === filterSchluessel)
    : regeln;

  const inputCls = 'px-1.5 py-0.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-teal-primary focus:border-teal-primary';

  const renderEditRow = (data, setData, onSave, onCancel, key) => (
    <tr key={key} className="bg-teal-50 border-t border-gray-100">
      <td className="px-2 py-1.5 text-center">
        <div className="flex gap-1">
          <button onClick={onSave} disabled={saving} className="text-emerald-600 hover:text-emerald-800" title="Speichern"><Save size={14} /></button>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600" title="Abbrechen"><X size={14} /></button>
        </div>
      </td>
      <td className="px-1 py-1"><input value={data.name_pattern} onChange={e => setData(d => ({ ...d, name_pattern: e.target.value }))} onKeyDown={e => handleKeyDown(e, onSave)} className={`${inputCls} w-full`} placeholder="Name..." /></td>
      <td className="px-1 py-1"><input value={data.zweck_pattern} onChange={e => setData(d => ({ ...d, zweck_pattern: e.target.value }))} onKeyDown={e => handleKeyDown(e, onSave)} className={`${inputCls} w-full`} placeholder="Zweck..." /></td>
      <td className="px-1 py-1"><input value={data.betrag_von} onChange={e => setData(d => ({ ...d, betrag_von: e.target.value }))} onKeyDown={e => handleKeyDown(e, onSave)} className={`${inputCls} w-16`} placeholder="von" /></td>
      <td className="px-1 py-1"><input value={data.betrag_bis} onChange={e => setData(d => ({ ...d, betrag_bis: e.target.value }))} onKeyDown={e => handleKeyDown(e, onSave)} className={`${inputCls} w-16`} placeholder="bis" /></td>
      <td className="px-1 py-1"><input list="dl-stschl" value={data.steuerschluessel} onChange={e => setData(d => ({ ...d, steuerschluessel: e.target.value }))} onKeyDown={e => handleKeyDown(e, onSave)} className={`${inputCls} w-16`} /></td>
      <td className="px-1 py-1"><input list="dl-schluessel" value={data.schluessel} onChange={e => {
        const v = e.target.value;
        setData(d => {
          const auto = stSchlFuerSchluessel(v);
          return { ...d, schluessel: v, steuerschluessel: d.steuerschluessel || auto || '' };
        });
      }} onKeyDown={e => handleKeyDown(e, onSave)} className={`${inputCls} w-24`} /></td>
      <td className="px-1 py-1">
        <input list={`dl-beschr-${data.schluessel || 'all'}`} value={data.beschreibung} onChange={e => setData(d => ({ ...d, beschreibung: e.target.value }))} onKeyDown={e => handleKeyDown(e, onSave)} className={`${inputCls} w-full`} />
        <datalist id={`dl-beschr-${data.schluessel || 'all'}`}>
          {beschreibungsVorschlaege(data.schluessel).map(b => <option key={b} value={b} />)}
        </datalist>
      </td>
      <td className="px-1 py-1"><input type="number" value={data.prioritaet} onChange={e => setData(d => ({ ...d, prioritaet: e.target.value }))} onKeyDown={e => handleKeyDown(e, onSave)} className={`${inputCls} w-12`} /></td>
      <td></td>
    </tr>
  );

  if (loading) return <div className="text-center py-12 text-gray-400">Laden...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/bereich/finanzen')} className="text-gray-400 hover:text-teal-600"><ArrowLeft size={20} /></button>
          <h2 className="text-2xl font-bold text-teal-dark">Kategorisierungsregeln</h2>
        </div>
        <button onClick={startNeu} className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-primary text-white rounded-md hover:bg-teal-hover text-sm font-medium">
          <Plus size={14} /> Neue Regel
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-4">{regeln.length} Regeln — Niedrigere Prioritaet = wird zuerst geprueft</p>

      {/* Filter */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-xs font-medium text-gray-500">Filter Schluessel:</label>
        <select
          value={filterSchluessel}
          onChange={e => setFilterSchluessel(e.target.value)}
          className="px-2 py-1 border border-gray-200 rounded-md text-sm"
        >
          <option value="">Alle ({regeln.length})</option>
          {alleSchluessel.map(s => (
            <option key={s} value={s}>{s} ({regeln.filter(r => r.schluessel === s).length})</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-teal-primary text-white">
              <th className="px-2 py-2.5 w-16"></th>
              <th className="px-2 py-2.5 text-left font-semibold">Name-Pattern</th>
              <th className="px-2 py-2.5 text-left font-semibold">Zweck-Pattern</th>
              <th className="px-2 py-2.5 text-left font-semibold">Betrag von</th>
              <th className="px-2 py-2.5 text-left font-semibold">Betrag bis</th>
              <th className="px-2 py-2.5 text-left font-semibold">StSchl</th>
              <th className="px-2 py-2.5 text-left font-semibold">Schluessel</th>
              <th className="px-2 py-2.5 text-left font-semibold">Beschreibung</th>
              <th className="px-2 py-2.5 text-center font-semibold">Prio</th>
              <th className="px-2 py-2.5 text-center font-semibold">Aktiv</th>
            </tr>
          </thead>
          <tbody>
            {/* Neue Regel Zeile */}
            {neuRegel && renderEditRow(
              neuRegel,
              (fn) => setNeuRegel(prev => typeof fn === 'function' ? fn(prev) : fn),
              saveNeu,
              () => setNeuRegel(null),
              'neu'
            )}

            {filtered.map((r, idx) => {
              if (editId === r.id) {
                return renderEditRow(editData, setEditData, saveEdit, cancelEdit, r.id);
              }

              return (
                <tr key={r.id} className={`border-t border-gray-100 ${!r.aktiv ? 'opacity-40' : ''} ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-teal-50/50`}>
                  <td className="px-2 py-1.5 text-center">
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(r)} className="text-gray-300 hover:text-teal-600" title="Bearbeiten"><Pencil size={13} /></button>
                      <button onClick={() => handleDelete(r)} className="text-gray-300 hover:text-red-500" title="Loeschen"><Trash2 size={13} /></button>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-xs font-mono">{r.name_pattern}</td>
                  <td className="px-2 py-1.5 text-xs font-mono">{r.zweck_pattern}</td>
                  <td className="px-2 py-1.5 text-xs text-right">{r.betrag_von != null ? r.betrag_von : ''}</td>
                  <td className="px-2 py-1.5 text-xs text-right">{r.betrag_bis != null ? r.betrag_bis : ''}</td>
                  <td className="px-2 py-1.5 text-xs text-gray-500">{r.steuerschluessel}</td>
                  <td className="px-2 py-1.5 text-xs font-medium">{r.schluessel}</td>
                  <td className="px-2 py-1.5 text-xs text-gray-600">{r.beschreibung}</td>
                  <td className="px-2 py-1.5 text-xs text-center">{r.prioritaet}</td>
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => handleToggle(r)} className={r.aktiv ? 'text-emerald-500' : 'text-gray-300'} title={r.aktiv ? 'Deaktivieren' : 'Aktivieren'}>
                      {r.aktiv ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Globale Datalists fuer Comboboxen */}
      <datalist id="dl-stschl">
        {vorschlaege.steuerschluessel.map((s) => <option key={s} value={s} />)}
      </datalist>
      <datalist id="dl-schluessel">
        {vorschlaege.schluessel.map((s) => <option key={s} value={s} />)}
      </datalist>
    </div>
  );
}

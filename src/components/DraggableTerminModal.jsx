import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Save, GripHorizontal, Maximize2, Minimize2 } from 'lucide-react';
import { updateTermin } from '../lib/api.js';
import { containsHtml, stripHtml } from '../lib/format.js';

export default function DraggableTerminModal({ termin, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [maximized, setMaximized] = useState(false);

  // Position + Drag
  const [pos, setPos] = useState({ x: 120, y: 80 });
  const [size, setSize] = useState({ w: 900, h: 620 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Beim Oeffnen: Termin-Daten laden, HTML strippen
  useEffect(() => {
    if (!termin) return;
    setData({
      ...termin,
      inhalt: containsHtml(termin.inhalt) ? stripHtml(termin.inhalt) : (termin.inhalt || ''),
      hausaufgabe: containsHtml(termin.hausaufgabe) ? stripHtml(termin.hausaufgabe) : (termin.hausaufgabe || ''),
      uebung: containsHtml(termin.uebung) ? stripHtml(termin.uebung) : (termin.uebung || ''),
    });
  }, [termin]);

  const handleField = (field, value) => setData(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateTermin(data.id, data);
      if (onSaved) onSaved();
      onClose();
    } catch (e) {
      alert('Fehler beim Speichern: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  // Drag handlers
  const onMouseDown = useCallback((e) => {
    if (maximized) return;
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos, maximized]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      setPos({
        x: Math.max(0, e.clientX - dragOffset.current.x),
        y: Math.max(0, e.clientY - dragOffset.current.y),
      });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  if (!termin || !data) return null;

  const style = maximized
    ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60 }
    : { position: 'fixed', top: pos.y, left: pos.x, width: size.w, zIndex: 60 };

  return (
    <>
      {/* Kein Overlay — Hintergrund bleibt klickbar */}
      <div
        style={style}
        className="bg-white rounded-xl shadow-2xl border border-gray-300 flex flex-col"
      >
        {/* Titelleiste — draggable */}
        <div
          onMouseDown={onMouseDown}
          className="flex items-center justify-between px-4 py-2.5 bg-teal-primary text-white rounded-t-xl cursor-move select-none"
        >
          <div className="flex items-center gap-2">
            <GripHorizontal size={16} className="opacity-60" />
            <h3 className="font-semibold text-sm">
              Termin: {data.kuerzel || ''} — {data.datum ? new Date(data.datum).toLocaleDateString('de-DE') : 'kein Datum'}
            </h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMaximized(!maximized)}
              className="p-1 hover:bg-white/20 rounded"
              title={maximized ? 'Verkleinern' : 'Maximieren'}
            >
              {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button onClick={onClose} className="p-1 hover:bg-white/20 rounded" title="Schliessen">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Inhalt */}
        <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3" style={maximized ? {} : { maxHeight: size.h - 90 }}>
          {/* Kopf-Felder */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ModalField label="Kürzel" value={data.kuerzel} onChange={v => handleField('kuerzel', v)} />
            <ModalField label="Einzel/Paket" value={data.einzel_paket} onChange={v => handleField('einzel_paket', v)} />
            <ModalField label="Aktion" value={data.aktion} onChange={v => handleField('aktion', v)} />
            <ModalField label="Datum" value={data.datum ? data.datum.substring(0, 16) : ''} onChange={v => handleField('datum', v)} type="datetime-local" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ModalField label="Einzelpreis" value={data.einzelpreis} onChange={v => handleField('einzelpreis', v)} type="number" />
            <ModalField label="E-dauer" value={data.einzeldauer} onChange={v => handleField('einzeldauer', v)} />
            <ModalField label="Logbuch versendet am" value={data.logbuch_versendet_am} onChange={v => handleField('logbuch_versendet_am', v)} type="date" className="col-span-2" />
          </div>

          {/* Grosse Textfelder */}
          <div className="flex flex-col flex-1 gap-3 min-h-0">
            <ModalTextarea label="Inhalt" value={data.inhalt} onChange={v => handleField('inhalt', v)} />
            <ModalTextarea label="Hausaufgabe" value={data.hausaufgabe} onChange={v => handleField('hausaufgabe', v)} />
            <ModalTextarea label="Übung" value={data.uebung} onChange={v => handleField('uebung', v)} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-2.5 border-t bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100">
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </div>
    </>
  );
}

function ModalField({ label, value, onChange, type = 'text', className = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40"
      />
    </div>
  );
}

function ModalTextarea({ label, value, onChange }) {
  return (
    <div className="flex flex-col flex-1 min-h-[120px]">
      <label className="block text-xs text-gray-500 mb-1 font-medium">{label}</label>
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40 resize-none"
      />
    </div>
  );
}

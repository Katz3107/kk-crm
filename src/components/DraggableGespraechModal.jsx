import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Save, GripHorizontal, Maximize2, Minimize2, Video } from 'lucide-react';
import { updateInteressentenGespraech } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';

export default function DraggableGespraechModal({ gespraech, onClose, onSaved }) {
  const [data, setData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [maximized, setMaximized] = useState(false);

  // Position + Drag
  const [pos, setPos] = useState({ x: 100, y: 60 });
  const [size] = useState({ w: 950, h: 650 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!gespraech) return;
    setData({
      protokoll_eigen: gespraech.protokoll_eigen || '',
      protokoll_zoom: gespraech.protokoll_zoom || '',
      typ: gespraech.typ || 'Erstgespraech',
      datum: gespraech.datum || '',
      meeting_url: gespraech.meeting_url || '',
    });
    setSaved(false);
  }, [gespraech]);

  const handleField = (field, value) => {
    setData(prev => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateInteressentenGespraech(gespraech.id, data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      if (onSaved) onSaved();
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

  if (!gespraech || !data) return null;

  const style = maximized
    ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 60 }
    : { position: 'fixed', top: pos.y, left: pos.x, width: size.w, zIndex: 60 };

  return (
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
            Gespräch: {data.typ || ''} — {formatDateTime(data.datum) || 'kein Datum'}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          {gespraech.meeting_url && (
            <a
              href={gespraech.meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-white/20 hover:bg-white/30"
            >
              <Video size={14} />
              Zoom
            </a>
          )}
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
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Typ</label>
            <select
              value={data.typ}
              onChange={e => handleField('typ', e.target.value)}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40"
            >
              <option value="Erstgespraech">Erstgespräch</option>
              <option value="Zweitgespraech">Zweitgespräch</option>
              <option value="Telefonat">Telefonat</option>
              <option value="Follow-up">Follow-up</option>
              <option value="E-Mail">E-Mail</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Datum</label>
            <input
              type="datetime-local"
              value={data.datum ? data.datum.substring(0, 16) : ''}
              onChange={e => handleField('datum', e.target.value)}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Meeting-URL</label>
            <input
              type="text"
              value={data.meeting_url}
              onChange={e => handleField('meeting_url', e.target.value)}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40"
            />
          </div>
        </div>

        {/* Grosse Textfelder */}
        <div className="flex flex-col flex-1 gap-3 min-h-0">
          <div className="flex flex-col flex-1 min-h-[150px]">
            <label className="block text-xs text-gray-500 mb-1 font-medium">Eigene Notizen / Protokoll</label>
            <textarea
              value={data.protokoll_eigen}
              onChange={e => handleField('protokoll_eigen', e.target.value)}
              placeholder="Notizen zum Gespräch hier eingeben..."
              className="w-full flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40 resize-none"
            />
          </div>
          <div className="flex flex-col flex-1 min-h-[150px]">
            <label className="block text-xs text-gray-500 mb-1 font-medium">Zoom-Transkript / KI-Zusammenfassung</label>
            <textarea
              value={data.protokoll_zoom}
              onChange={e => handleField('protokoll_zoom', e.target.value)}
              placeholder="Zoom-Transkript oder KI-Zusammenfassung hier einfügen..."
              className="w-full flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-teal-primary/40 resize-none"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 px-4 py-2.5 border-t bg-gray-50 rounded-b-xl">
        <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-100">
          Schliessen
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50"
        >
          <Save size={14} />
          {saving ? 'Speichern...' : saved ? 'Gespeichert!' : 'Speichern'}
        </button>
      </div>
    </div>
  );
}

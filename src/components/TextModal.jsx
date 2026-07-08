import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { stripHtml, containsHtml } from '../lib/format.js';

export default function TextModal({ title, value, onSave, onClose }) {
  const [text, setText] = useState('');

  useEffect(() => {
    // Wenn der Wert HTML enthaelt, fuer die Bearbeitung als Plain-Text anzeigen
    const cleanValue = containsHtml(value) ? stripHtml(value) : (value || '');
    setText(cleanValue);
  }, [value]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b bg-teal-primary text-white rounded-t-xl">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="hover:bg-white/20 p-1 rounded">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 flex-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full h-64 border border-gray-300 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40 resize-y"
          />
        </div>
        <div className="flex justify-end gap-3 px-5 py-3 border-t bg-gray-50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-100"
          >
            Abbrechen
          </button>
          <button
            onClick={() => { onSave(text); onClose(); }}
            className="px-4 py-2 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover"
          >
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

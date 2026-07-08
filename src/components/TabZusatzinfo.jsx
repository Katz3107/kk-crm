import React, { useState } from 'react';
import TextModal from './TextModal.jsx';
import { containsHtml, sanitizeHtml } from '../lib/format.js';

export default function TabZusatzinfo({ kontakt, onChange }) {
  const [modal, setModal] = useState(null);

  const hasHtml = containsHtml(kontakt.zusatzinfos);

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-600 mb-2">
          Zusatzinformationen (Doppelklick = grosser Editor)
        </label>
        {hasHtml && kontakt.zusatzinfos ? (
          <div
            onDoubleClick={() => setModal({ field: 'zusatzinfos', title: 'Zusatzinformationen' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white cursor-pointer hover:border-teal-primary/40 min-h-[10rem] overflow-y-auto max-h-96 richtext-display"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(kontakt.zusatzinfos) }}
          />
        ) : (
          <div
            onDoubleClick={() => setModal({ field: 'zusatzinfos', title: 'Zusatzinformationen' })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white cursor-pointer hover:border-teal-primary/40 min-h-[10rem] whitespace-pre-wrap"
          >
            {kontakt.zusatzinfos || ''}
          </div>
        )}
      </div>

      {modal && (
        <TextModal
          title={modal.title}
          value={kontakt[modal.field]}
          onSave={(val) => onChange(modal.field, val)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

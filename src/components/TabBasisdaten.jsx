import React, { useState } from 'react';
import { Copy, Check, FolderOpen, User, Phone, Briefcase, FileText, Image, Eye, EyeOff } from 'lucide-react';
import TextModal from './TextModal.jsx';
import KontaktBilder from './KontaktBilder.jsx';
import { stripHtml, containsHtml, sanitizeHtml, toDateInputValue } from '../lib/format.js';

const STATUS_OPTIONS = ['aktiv', 'beendet', 'pausiert', 'storniert'];

function Field({ label, value, onChange, type = 'text', options, className = '', name }) {
  if (type === 'checkbox') {
    return (
      <label className={`flex items-center gap-2 py-1 ${className}`}>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 accent-teal-600 rounded"
        />
        <span className="text-sm text-gray-600">{label}</span>
      </label>
    );
  }

  if (type === 'select') {
    return (
      <div className={className}>
        <label className="block text-xs text-gray-500 mb-1">{label}</label>
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
        >
          <option value="">-- Bitte waehlen --</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  // Fuer date-Felder: Wert in yyyy-MM-dd konvertieren
  const displayValue = type === 'date' ? toDateInputValue(value) : (value || '');

  // Autofill verhindern: eigener name + autoComplete-Wert, den Browser nicht zuordnen
  const safeName = `kk-${name || label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className={className}>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type={type === 'email' ? 'text' : type}
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        name={safeName}
        autoComplete="off"
        data-lpignore="true"
        data-form-type="other"
        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
      />
    </div>
  );
}

/** Zeigt Richtext-Felder an: HTML wird gerendert, Doppelklick oeffnet Editor */
function RichTextArea({ label, value, onDoubleClick, rows = 3 }) {
  const hasHtml = containsHtml(value);

  if (hasHtml && value) {
    return (
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label} (Doppelklick = grosser Editor)</label>
        <div
          onDoubleClick={onDoubleClick}
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm bg-white cursor-pointer hover:border-teal-primary/40 min-h-[4rem] overflow-y-auto max-h-48 richtext-display"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
        />
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label} (Doppelklick = grosser Editor)</label>
      <div
        onDoubleClick={onDoubleClick}
        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm bg-white cursor-pointer hover:border-teal-primary/40 min-h-[4rem] whitespace-pre-wrap"
      >
        {value || ''}
      </div>
    </div>
  );
}

/** Dateipfad als kopierbarer Text mit Kopieren- und Oeffnen-Button */
function DateipfadField({ value, onChange }) {
  const [copied, setCopied] = useState(false);
  const [openerMsg, setOpenerMsg] = useState(null);

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpen = async () => {
    if (!value) return;
    setOpenerMsg(null);
    try {
      const res = await fetch(`http://localhost:3099/open?path=${encodeURIComponent(value)}`);
      const data = await res.json();
      if (res.ok) {
        setOpenerMsg({ type: 'ok', text: 'Geoeffnet' });
      } else {
        setOpenerMsg({ type: 'error', text: data.message || 'Fehler' });
      }
    } catch {
      setOpenerMsg({ type: 'error', text: 'Pfad-Oeffner nicht aktiv' });
    }
    setTimeout(() => setOpenerMsg(null), 3000);
  };

  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">Dateipfad</label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="z.B. G:\Kunden\Nachname Vorname"
          className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
        />
        {value && (
          <>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-100 whitespace-nowrap"
              title="Pfad kopieren"
            >
              {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
            <button
              onClick={handleOpen}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-300 rounded-md hover:bg-gray-100 whitespace-nowrap"
              title="Im Explorer oeffnen"
            >
              <FolderOpen size={14} />
              Oeffnen
            </button>
            {openerMsg && (
              <span className={`text-xs px-2 py-1 rounded whitespace-nowrap ${openerMsg.type === 'ok' ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>
                {openerMsg.text}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Sektion mit Titel, Icon und abgesetzter Flaeche */
function Section({ icon: Icon, title, children, className = '' }) {
  return (
    <div className={`bg-gray-50/70 border border-gray-200 rounded-lg p-3 ${className}`}>
      <div className="flex items-center gap-1.5 mb-2 pb-1.5 border-b border-gray-200">
        {Icon && <Icon size={13} className="text-teal-primary" />}
        <h3 className="text-[11px] font-semibold text-gray-700 uppercase tracking-wide">{title}</h3>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

/** Feld mit verdecktem Wert — zeigt Platzhalter, bis "Anzeigen" geklickt wird */
function MaskedField({ label, value, onChange, revealed, onReveal }) {
  if (revealed) {
    return (
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label}</label>
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
        />
      </div>
    );
  }
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <button
        type="button"
        onClick={onReveal}
        className="w-full px-2.5 py-1.5 border border-dashed border-gray-300 rounded-md text-sm bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600 text-left"
        title="Klicken zum Anzeigen"
      >
        {value ? '••••••••' : '—'}
      </button>
    </div>
  );
}

export default function TabBasisdaten({ kontakt, onChange }) {
  const [modal, setModal] = useState(null);
  const [revealName, setRevealName] = useState(false);

  const f = (field) => ({
    value: kontakt[field],
    onChange: (val) => onChange(field, val),
  });

  return (
    <div className="space-y-3">
      {/* Obere Reihe: Person+Adresse (wide) + Kommunikation + Bild (narrow) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <Section icon={User} title="Person & Adresse" className="lg:col-span-6">
          <div className="flex justify-end -mt-1 mb-1">
            <button
              type="button"
              onClick={() => setRevealName((v) => !v)}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] border border-gray-300 rounded hover:bg-gray-100 text-gray-600"
              title={revealName ? 'Namen ausblenden' : 'Namen anzeigen'}
            >
              {revealName ? <EyeOff size={12} /> : <Eye size={12} />}
              {revealName ? 'Name verdecken' : 'Name anzeigen'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MaskedField
              label="Vorname"
              value={kontakt.vorname}
              onChange={(val) => onChange('vorname', val)}
              revealed={revealName}
              onReveal={() => setRevealName(true)}
            />
            <MaskedField
              label="Nachname"
              value={kontakt.nachname}
              onChange={(val) => onChange('nachname', val)}
              revealed={revealName}
              onReveal={() => setRevealName(true)}
            />
            <Field label="Kuerzel" {...f('kuerzel')} />
            <Field label="Lebenszahl" {...f('lebenszahl')} />
            <Field label="Geburtsdatum" {...f('geburtsdatum')} type="date" />
            <div />
            <Field label="Strasse" {...f('strasse')} className="col-span-2" />
            <Field label="Ort" {...f('ort')} />
            <Field label="Land" {...f('land')} />
          </div>
          <DateipfadField value={kontakt.dateipfad} onChange={(val) => onChange('dateipfad', val)} />
        </Section>

        <Section icon={Phone} title="Kommunikation" className="lg:col-span-4">
          <Field label="E-Mail" {...f('email')} type="email" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Mobilfon" {...f('mobilfon')} />
            <Field label="Telefon" {...f('telefon')} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">In Quentn</label>
            <select
              value={kontakt.in_quentn === true ? 'ja' : kontakt.in_quentn === false ? 'nein' : ''}
              onChange={(e) => {
                const v = e.target.value;
                onChange('in_quentn', v === 'ja' ? true : v === 'nein' ? false : null);
              }}
              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
            >
              <option value="">-- unbekannt --</option>
              <option value="ja">Ja</option>
              <option value="nein">Nein</option>
            </select>
          </div>
        </Section>

        <Section icon={Image} title="Bild" className="lg:col-span-2">
          <KontaktBilder kontaktId={kontakt.id} />
        </Section>
      </div>

      {/* Coaching in einer Zeile */}
      <Section icon={Briefcase} title="Coaching">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Field label="Status" {...f('status')} type="select" options={STATUS_OPTIONS} />
          <Field label="Paket" {...f('paket')} />
          <Field label="Quelle" {...f('quelle')} />
          <Field label="GP" {...f('gespraechspartner')} />
          <Field label="Onboarding" {...f('onboardingdatum')} type="date" />
          <Field label="EG geb" {...f('eg_geb')} type="date" />
          <Field label="EG am" {...f('eg_am')} type="date" />
          <Field label="Coaching geb. am" {...f('geb_am')} type="date" />
        </div>
      </Section>

      {/* Notizen & Nebenabreden */}
      <Section icon={FileText} title="Notizen">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RichTextArea
            label="Hinweise"
            value={kontakt.hinweise}
            onDoubleClick={() => setModal({ field: 'hinweise', title: 'Hinweise' })}
          />
          <RichTextArea
            label="Anmerkungen"
            value={kontakt.anmerkungen}
            onDoubleClick={() => setModal({ field: 'anmerkungen', title: 'Anmerkungen' })}
          />
          <RichTextArea
            label="aktueller Stand"
            value={kontakt.aktueller_stand}
            onDoubleClick={() => setModal({ field: 'aktueller_stand', title: 'aktueller Stand' })}
          />
        </div>
        <RichTextArea
          label="Nebenabreden"
          value={kontakt.nebenabreden}
          onDoubleClick={() => setModal({ field: 'nebenabreden', title: 'Nebenabreden' })}
        />
      </Section>

      {/* Text Modal */}
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

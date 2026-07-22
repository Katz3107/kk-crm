import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, RotateCcw, ChevronDown, ChevronUp, ExternalLink, Video, Plus, Calendar, Trash2 } from 'lucide-react';
import { getInteressent, createInteressent, deleteInteressent, updateInteressent, createInteressentenGespraech, updateInteressentenGespraech, deleteInteressentenGespraech, getInteressentMails, generateFollowupEntwurf, sendFollowupMail } from '../lib/api.js';
import { formatDate, formatDateTime } from '../lib/format.js';
import DraggableGespraechModal from '../components/DraggableGespraechModal.jsx';

const STAND_OPTIONS = [
  { value: 'EG', label: 'EG geplant' },
  { value: 'Schwebe', label: 'Schwebe' },
  { value: 'Gebucht', label: 'Gebucht' },
  { value: 'Nicht gebucht', label: 'Nicht gebucht' },
  { value: 'Abgesagt', label: 'Abgesagt' },
  { value: 'No-Show', label: 'No-Show' },
  { value: 'ZG', label: 'Zweitgespraech' },
  { value: 'KE', label: 'Kein Interesse' },
  { value: 'Kein Zielkunde', label: 'Kein Zielkunde' },
  { value: 'Storno', label: 'Storno' },
  { value: 'KU', label: 'Wurde Kunde' },
  { value: 'AB', label: 'Abgeschlossen' },
];

const TABS = [
  { key: 'basisdaten', label: 'Basisdaten' },
  { key: 'antworten', label: 'TidyCal-Antworten' },
  { key: 'gespraeche', label: 'Gespraeche' },
  { key: 'followup', label: 'Follow-Up' },
];

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, type = 'text', ...props }) {
  // Autofill verhindern: email->text, random name, autoComplete=off
  return (
    <input
      type={type === 'email' ? 'text' : type}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
      data-lpignore="true"
      data-form-type="other"
      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
      {...props}
    />
  );
}

// Kuerzel-Vorschlag aus Vor-/Nachname (z.B. Andrea Hofmann -> AnHo)
function vorschlagKuerzel(kontakt) {
  const v = (kontakt.vorname || '').trim();
  const n = (kontakt.nachname || '').trim();
  if (!v || !n) return '';
  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : '';
  return cap(v.substring(0, 2)) + cap(n.substring(0, 2));
}

// Ist der aktuelle Stand ein Pflichtstand fuer Kuerzel? (Gebucht/KU triggern Auto-Promotion)
function isUmwandlungspflichtig(kontakt) {
  return kontakt.stand_interessent === 'Gebucht' || kontakt.stand_interessent === 'KU';
}

// --- Tab: Basisdaten ---
function TabBasisdaten({ kontakt, onChange }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
      <Field label="Vorname">
        <TextInput value={kontakt.vorname} onChange={(v) => onChange('vorname', v)} />
      </Field>
      <Field label="Nachname">
        <TextInput value={kontakt.nachname} onChange={(v) => onChange('nachname', v)} />
      </Field>
      <Field label={`Kuerzel ${isUmwandlungspflichtig(kontakt) ? '(Pflicht vor Umwandlung zum Kunden)' : ''}`}>
        <div className="flex gap-2">
          <TextInput
            value={kontakt.kuerzel}
            onChange={(v) => onChange('kuerzel', v)}
            placeholder={vorschlagKuerzel(kontakt)}
            maxLength={20}
          />
          {!kontakt.kuerzel && vorschlagKuerzel(kontakt) && (
            <button
              type="button"
              onClick={() => onChange('kuerzel', vorschlagKuerzel(kontakt))}
              className="px-2 py-1 text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 rounded whitespace-nowrap"
              title="Vorschlag uebernehmen"
            >
              uebernehm.
            </button>
          )}
        </div>
        {isUmwandlungspflichtig(kontakt) && !kontakt.kuerzel && (
          <p className="mt-1 text-xs text-amber-700">Stand ist {kontakt.stand_interessent} — Kuerzel muss gesetzt sein, sonst schlaegt die Umwandlung zur Kundin fehl.</p>
        )}
      </Field>
      <Field label="E-Mail">
        <TextInput value={kontakt.email} onChange={(v) => onChange('email', v)} type="email" />
      </Field>
      <Field label="Telefon">
        <TextInput value={kontakt.telefon} onChange={(v) => onChange('telefon', v)} />
      </Field>
      <Field label="Mobilfon">
        <TextInput value={kontakt.mobilfon} onChange={(v) => onChange('mobilfon', v)} />
      </Field>
      <Field label="Quelle">
        <TextInput value={kontakt.quelle} onChange={(v) => onChange('quelle', v)} />
      </Field>
      <Field label="Stand">
        <select
          value={kontakt.stand_interessent || ''}
          onChange={(e) => onChange('stand_interessent', e.target.value)}
          className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
        >
          <option value="">-- waehlen --</option>
          {STAND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Datum Erstkontakt">
        <input
          type="date"
          value={(kontakt.datum_erstkontakt || '').substring(0, 10)}
          onChange={(e) => onChange('datum_erstkontakt', e.target.value)}
          className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
        />
      </Field>
      <Field label="Naechste Aktion (Follow-up)">
        <input
          type="date"
          value={(kontakt.datum_naechste_aktion || '').substring(0, 10)}
          onChange={(e) => onChange('datum_naechste_aktion', e.target.value)}
          className={`w-full px-3 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40 ${
            kontakt.datum_naechste_aktion && new Date(kontakt.datum_naechste_aktion) <= new Date()
              ? 'border-red-400 bg-red-50'
              : 'border-gray-300'
          }`}
        />
      </Field>
      <Field label="Strasse">
        <TextInput value={kontakt.strasse} onChange={(v) => onChange('strasse', v)} />
      </Field>
      <Field label="Ort">
        <TextInput value={kontakt.ort} onChange={(v) => onChange('ort', v)} />
      </Field>
      <Field label="Land">
        <TextInput value={kontakt.land} onChange={(v) => onChange('land', v)} />
      </Field>
      <div className="md:col-span-2">
        <Field label="Notizen">
          <textarea
            value={kontakt.notizen || ''}
            onChange={(e) => onChange('notizen', e.target.value)}
            rows={6}
            className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
            placeholder="Allgemeine Notizen, Hinweise, Eindrucke..."
          />
        </Field>
      </div>
    </div>
  );
}

// --- Tab: TidyCal-Antworten ---
function TabAntworten({ antworten, kontaktId, onChanged }) {
  const [editing, setEditing] = useState({});
  const [saving, setSaving] = useState({});
  const [showNew, setShowNew] = useState(false);
  const [newFrage, setNewFrage] = useState('');
  const [newAntwort, setNewAntwort] = useState('');
  const [creating, setCreating] = useState(false);

  const handleEdit = (id, field, value) => {
    setEditing((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || {}), [field]: value },
    }));
  };

  const handleSave = async (a) => {
    const draft = editing[a.id];
    if (!draft) return;
    setSaving((prev) => ({ ...prev, [a.id]: true }));
    try {
      await fetch(`/api/tidycal-antworten/${a.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frage: draft.frage ?? a.frage, antwort: draft.antwort ?? a.antwort }),
      });
      setEditing((prev) => { const n = { ...prev }; delete n[a.id]; return n; });
      if (onChanged) onChanged();
    } catch (err) { console.error(err); }
    finally { setSaving((prev) => ({ ...prev, [a.id]: false })); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Diese Antwort loeschen?')) return;
    try {
      await fetch(`/api/tidycal-antworten/${id}`, { method: 'DELETE' });
      if (onChanged) onChanged();
    } catch (err) { console.error(err); }
  };

  const handleCreate = async () => {
    if (!newFrage.trim()) return;
    setCreating(true);
    try {
      await fetch(`/api/interessenten/${kontaktId}/antworten`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frage: newFrage, antwort: newAntwort }),
      });
      setNewFrage('');
      setNewAntwort('');
      setShowNew(false);
      if (onChanged) onChanged();
    } catch (err) { console.error(err); }
    finally { setCreating(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover"
        >
          <Plus size={14} />
          Neue Antwort
        </button>
      </div>

      {showNew && (
        <div className="border border-teal-200 rounded-lg p-4 bg-teal-50/30 space-y-3">
          <Field label="Frage">
            <TextInput value={newFrage} onChange={setNewFrage} placeholder="z.B. Schildere deinen beruflichen Werdegang" />
          </Field>
          <Field label="Antwort">
            <textarea
              value={newAntwort}
              onChange={(e) => setNewAntwort(e.target.value)}
              rows={4}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
              placeholder="Antwort eingeben..."
            />
          </Field>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowNew(false)} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Abbrechen</button>
            <button onClick={handleCreate} disabled={creating || !newFrage.trim()} className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50">
              <Save size={14} />
              {creating ? 'Speichern...' : 'Speichern'}
            </button>
          </div>
        </div>
      )}

      {(!antworten || antworten.length === 0) && !showNew && (
        <div className="text-gray-400 py-8 text-center">Keine TidyCal-Antworten vorhanden.</div>
      )}

      {antworten && antworten.map((a) => {
        const draft = editing[a.id];
        const isEditing = !!draft;
        return (
          <div key={a.id} className="border border-gray-200 rounded-lg p-4 bg-white">
            {isEditing ? (
              <div className="space-y-2">
                <Field label="Frage">
                  <TextInput value={draft.frage ?? a.frage} onChange={(v) => handleEdit(a.id, 'frage', v)} />
                </Field>
                <Field label="Antwort">
                  <textarea
                    value={draft.antwort ?? a.antwort}
                    onChange={(e) => handleEdit(a.id, 'antwort', e.target.value)}
                    rows={4}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
                  />
                </Field>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditing((prev) => { const n = { ...prev }; delete n[a.id]; return n; })} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Abbrechen</button>
                  <button onClick={() => handleSave(a)} disabled={saving[a.id]} className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50">
                    <Save size={14} />
                    {saving[a.id] ? 'Speichern...' : 'Speichern'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex justify-between items-start">
                  <div className="text-xs font-medium text-gray-500 mb-1">{a.frage}</div>
                  <div className="flex gap-1">
                    <button onClick={() => handleEdit(a.id, '_init', true)} className="text-gray-400 hover:text-teal-600 p-1" title="Bearbeiten">
                      <RotateCcw size={14} />
                    </button>
                    <button onClick={() => handleDelete(a.id)} className="text-gray-400 hover:text-red-600 p-1" title="Loeschen">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="text-sm text-gray-800 whitespace-pre-wrap">{a.antwort}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Tab: Gespraeche ---
function TabGespraeche({ gespraeche, kontaktId, onGespraechAdded, onGespraechDeleted, drafts, setDrafts, onOpenGespraech }) {
  const [expanded, setExpanded] = useState({});
  const [saving, setSaving] = useState({});
  const [savedMsg, setSavedMsg] = useState({});
  const [showNew, setShowNew] = useState(false);
  const [newGespraech, setNewGespraech] = useState({
    datum: '', typ: 'Erstgespraech', meeting_url: '', protokoll_eigen: '',
  });
  const [creating, setCreating] = useState(false);

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
    if (!expanded[id]) {
      const g = gespraeche.find((x) => x.id === id);
      if (g && !drafts[id]) {
        setDrafts((prev) => ({
          ...prev,
          [id]: { protokoll_eigen: g.protokoll_eigen || '', protokoll_zoom: g.protokoll_zoom || '', typ: g.typ || 'Erstgespraech' },
        }));
      }
    }
  };

  const handleDraftChange = (id, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const handleSaveGespraech = async (id) => {
    setSaving((prev) => ({ ...prev, [id]: true }));
    try {
      await updateInteressentenGespraech(id, drafts[id]);
      setSavedMsg((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => setSavedMsg((prev) => ({ ...prev, [id]: false })), 2000);
    } catch (err) {
      console.error('Fehler beim Speichern:', err);
    } finally {
      setSaving((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleDeleteGespraech = async (id) => {
    if (!window.confirm('Dieses Gespraech wirklich loeschen?')) return;
    try {
      await deleteInteressentenGespraech(id);
      if (onGespraechDeleted) onGespraechDeleted();
    } catch (err) {
      console.error('Fehler beim Loeschen:', err);
    }
  };

  const handleCreateGespraech = async () => {
    if (!newGespraech.datum) return;
    setCreating(true);
    try {
      await createInteressentenGespraech(kontaktId, newGespraech);
      setNewGespraech({ datum: '', typ: 'Erstgespraech', meeting_url: '', protokoll_eigen: '' });
      setShowNew(false);
      if (onGespraechAdded) onGespraechAdded();
    } catch (err) {
      console.error('Fehler beim Anlegen:', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Neues Gespraech Button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowNew(!showNew)}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover"
        >
          <Plus size={14} />
          Neues Gespraech
        </button>
      </div>

      {/* Neues Gespraech Formular */}
      {showNew && (
        <div className="border border-teal-200 rounded-lg p-4 bg-teal-50/30 space-y-3">
          <h4 className="text-sm font-semibold text-teal-dark">Neues Gespraech anlegen</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Datum und Uhrzeit">
              <input
                type="datetime-local"
                value={newGespraech.datum}
                onChange={(e) => setNewGespraech((prev) => ({ ...prev, datum: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
              />
            </Field>
            <Field label="Typ">
              <select
                value={newGespraech.typ}
                onChange={(e) => setNewGespraech((prev) => ({ ...prev, typ: e.target.value }))}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
              >
                <option value="Erstgespraech">Erstgespraech</option>
                <option value="Zweitgespraech">Zweitgespraech</option>
                <option value="Telefonat">Telefonat</option>
                <option value="Follow-up">Follow-up</option>
                <option value="E-Mail">E-Mail</option>
              </select>
            </Field>
            <Field label="Meeting-URL (optional)">
              <TextInput
                value={newGespraech.meeting_url}
                onChange={(v) => setNewGespraech((prev) => ({ ...prev, meeting_url: v }))}
                placeholder="https://zoom.us/..."
              />
            </Field>
          </div>
          <Field label="Notizen (optional)">
            <textarea
              value={newGespraech.protokoll_eigen}
              onChange={(e) => setNewGespraech((prev) => ({ ...prev, protokoll_eigen: e.target.value }))}
              rows={3}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
              placeholder="Vorab-Notizen..."
            />
          </Field>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowNew(false)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Abbrechen
            </button>
            <button
              onClick={handleCreateGespraech}
              disabled={creating || !newGespraech.datum}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50"
            >
              <Save size={14} />
              {creating ? 'Anlegen...' : 'Gespraech anlegen'}
            </button>
          </div>
        </div>
      )}

      {/* Bestehende Gespraeche */}
      {(!gespraeche || gespraeche.length === 0) && !showNew && (
        <div className="text-gray-400 py-8 text-center">Keine Gespraeche vorhanden.</div>
      )}

      {gespraeche && gespraeche.map((g) => {
        const isOpen = expanded[g.id];
        const draft = drafts[g.id] || { protokoll_eigen: g.protokoll_eigen || '', protokoll_zoom: g.protokoll_zoom || '' };
        const isCancelled = !!g.cancelled_at;

        return (
          <div key={g.id} className={`border rounded-lg overflow-hidden ${isCancelled ? 'border-red-200 bg-red-50/30' : 'border-gray-200 bg-white'}`}>
            {/* Header */}
            <button
              onClick={() => onOpenGespraech ? onOpenGespraech(g) : toggleExpand(g.id)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <span className={`text-sm font-medium ${isCancelled ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                  {formatDateTime(g.datum)}
                </span>
                <span className="text-sm text-gray-500">{g.typ || 'Gespraech'}</span>
                {isCancelled && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Abgesagt</span>
                )}
                {g.protokoll_eigen && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600">Notizen</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {g.meeting_url && (
                  <a
                    href={g.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded bg-blue-50 hover:bg-blue-100"
                  >
                    <Video size={14} />
                    Zoom
                  </a>
                )}
                {isOpen ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
              </div>
            </button>

            {/* Expanded Content */}
            {isOpen && (
              <div className="px-4 pb-4 border-t border-gray-100 pt-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Field label="Typ">
                    <select
                      value={draft.typ || g.typ || 'Erstgespraech'}
                      onChange={(e) => handleDraftChange(g.id, 'typ', e.target.value)}
                      className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
                    >
                      <option value="Erstgespraech">Erstgespraech</option>
                      <option value="Zweitgespraech">Zweitgespraech</option>
                      <option value="Telefonat">Telefonat</option>
                      <option value="Follow-up">Follow-up</option>
                      <option value="E-Mail">E-Mail</option>
                    </select>
                  </Field>
                </div>
                <Field label="Eigene Notizen / Protokoll">
                  <textarea
                    value={draft.protokoll_eigen}
                    onChange={(e) => handleDraftChange(g.id, 'protokoll_eigen', e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
                    placeholder="Notizen zum Gespraech hier eingeben..."
                  />
                </Field>
                <Field label="Zoom-Transkript / KI-Zusammenfassung">
                  <textarea
                    value={draft.protokoll_zoom}
                    onChange={(e) => handleDraftChange(g.id, 'protokoll_zoom', e.target.value)}
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
                    placeholder="Zoom-Transkript oder KI-Zusammenfassung hier einfuegen..."
                  />
                </Field>
                <div className="flex justify-between">
                  <button
                    onClick={() => handleDeleteGespraech(g.id)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                    Loeschen
                  </button>
                  <button
                    onClick={() => handleSaveGespraech(g.id)}
                    disabled={saving[g.id]}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50"
                  >
                    <Save size={14} />
                    {saving[g.id] ? 'Speichern...' : savedMsg[g.id] ? 'Gespeichert!' : 'Notizen speichern'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Tab: Follow-Up ---
function TabFollowUp({ kontakt, kontaktId }) {
  const [mails, setMails] = useState([]);
  const [loadingMails, setLoadingMails] = useState(true);
  const [syncFehler, setSyncFehler] = useState(null);
  const [anrede, setAnrede] = useState('du');
  const [datumEG, setDatumEG] = useState(kontakt.eg_am ? kontakt.eg_am.slice(0, 10) : '');
  const [stichworte, setStichworte] = useState('');
  const [entwurf, setEntwurf] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [entwurfFehler, setEntwurfFehler] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendFehler, setSendFehler] = useState(null);
  const [gesendet, setGesendet] = useState(false);

  // Nur echte Erstgespraech-Eintraege beruecksichtigen (beide Schreibweisen in
  // der Praxis: "Erstgespraech" und "Erstgespräch"), keine Follow-up/Notiz/
  // E-Mail-Eintraege, auch wenn die neuer sind und protokoll_eigen gefuellt haben.
  const egZusammenfassung = (kontakt.gespraeche || [])
    .filter((g) => g.protokoll_eigen && (g.typ || '').toLowerCase().includes('erstgespr'))
    .sort((a, b) => new Date(b.datum) - new Date(a.datum))[0]?.protokoll_eigen || '';

  useEffect(() => {
    let cancelled = false;
    setLoadingMails(true);
    getInteressentMails(kontaktId)
      .then((res) => {
        if (cancelled) return;
        setMails(res.mails || []);
        setSyncFehler(res.syncFehler || null);
      })
      .catch((err) => !cancelled && setSyncFehler(err.message))
      .finally(() => !cancelled && setLoadingMails(false));
    return () => { cancelled = true; };
  }, [kontaktId]);

  const handleGenerate = async () => {
    if (!stichworte.trim()) return;
    setGenerating(true);
    setEntwurfFehler(null);
    setGesendet(false);
    setSendFehler(null);
    try {
      const result = await generateFollowupEntwurf(kontaktId, { anrede, datumEG, stichworte });
      setEntwurf(result);
    } catch (err) {
      setEntwurfFehler(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!entwurf) return;
    const empfaenger = kontakt.email || '(keine E-Mail hinterlegt)';
    if (!window.confirm(`Mail wirklich an ${empfaenger} senden?`)) return;
    setSending(true);
    setSendFehler(null);
    try {
      await sendFollowupMail(kontaktId, { betreff: entwurf.betreff, text: entwurf.text });
      setGesendet(true);
    } catch (err) {
      setSendFehler(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Linke Seite: Mail-Verlauf */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-700">Mail-Verlauf</h4>
        {syncFehler && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg">
            Mail-Abruf nicht vollstaendig: {syncFehler}
          </div>
        )}
        {loadingMails ? (
          <div className="text-sm text-gray-400">Lade Mails...</div>
        ) : mails.length === 0 ? (
          <div className="text-sm text-gray-400">Keine Mail-Korrespondenz gefunden.</div>
        ) : (
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {mails.map((m) => (
              <div
                key={m.id}
                className={`p-3 rounded-lg text-sm border ${
                  m.richtung === 'eingehend' ? 'bg-gray-50 border-gray-200' : 'bg-teal-50/40 border-teal-100'
                }`}
              >
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                  <span>{m.richtung === 'eingehend' ? 'Von ihr' : 'Von Kirsten'}</span>
                  <span>{formatDateTime(m.datum)}</span>
                </div>
                <div className="font-medium text-gray-700 mb-1">{m.betreff}</div>
                <div className="text-gray-600 whitespace-pre-wrap">{m.inhalt || ''}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rechte Seite: Entwurf erstellen */}
      <div className="space-y-4">
        {egZusammenfassung && (
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-1.5">Zusammenfassung Erstgespraech</h4>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 whitespace-pre-wrap">
              {egZusammenfassung}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Anrede">
            <TextInput value={anrede} onChange={setAnrede} />
          </Field>
          <Field label="Datum Erstgespraech">
            <input
              type="date"
              value={datumEG}
              onChange={(e) => setDatumEG(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
            />
          </Field>
        </div>

        <Field label="Stichworte fuer diese Follow-up-Mail">
          <textarea
            value={stichworte}
            onChange={(e) => setStichworte(e.target.value)}
            rows={4}
            placeholder="z.B. hat sich noch nicht gemeldet, wollte sich Zeit nehmen, freundlich nachfassen"
            className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
          />
        </Field>

        <button
          onClick={handleGenerate}
          disabled={generating || !stichworte.trim()}
          className="px-4 py-2 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? 'Entwurf wird erstellt...' : 'Entwurf erstellen'}
        </button>

        {entwurfFehler && (
          <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">{entwurfFehler}</div>
        )}

        {entwurf && (
          <div className="border border-teal-200 rounded-lg p-4 bg-teal-50/30 space-y-3">
            <Field label="Betreff">
              <TextInput value={entwurf.betreff} onChange={(v) => setEntwurf({ ...entwurf, betreff: v })} />
            </Field>
            <Field label="Text (editierbar)">
              <textarea
                value={entwurf.text}
                onChange={(e) => { setEntwurf({ ...entwurf, text: e.target.value }); setGesendet(false); }}
                rows={14}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
              />
            </Field>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSend}
                disabled={sending || gesendet || !kontakt.email}
                className="px-4 py-2 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? 'Wird gesendet...' : gesendet ? 'Gesendet' : `An ${kontakt.email || 'keine E-Mail'} senden`}
              </button>
              {gesendet && <span className="text-sm text-teal-dark">Mail wurde verschickt.</span>}
            </div>
            {sendFehler && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">{sendFehler}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const emptyInteressent = {
  typ: 'interessent',
  vorname: '', nachname: '', kuerzel: '', email: '', telefon: '', mobilfon: '',
  strasse: '', ort: '', land: '', quelle: '', stand_interessent: 'EG',
  hinweise: '', anmerkungen: '', notizen: '', datum_erstkontakt: '',
  tidycal_antworten: [], gespraeche: [],
};

// --- Hauptkomponente ---
export default function InteressentenDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'neu';
  const [kontakt, setKontakt] = useState(isNew ? { ...emptyInteressent } : null);
  const [original, setOriginal] = useState(null);
  const [activeTab, setActiveTab] = useState('basisdaten');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [gespraechDrafts, setGespraechDrafts] = useState({});
  const [openGespraech, setOpenGespraech] = useState(null);

  const load = useCallback(() => {
    if (isNew) return;
    getInteressent(id)
      .then((data) => {
        setKontakt(data);
        setOriginal(JSON.parse(JSON.stringify(data)));
      })
      .catch((e) => setError(e.message));
  }, [id, isNew]);

  useEffect(() => { load(); }, [load]);

  const handleChange = (field, value) => {
    setKontakt((prev) => ({ ...prev, [field]: value }));
    setSaved(false);
  };

  const handleSave = async () => {
    // Client-seitige Pflichtfeld-Pruefung: Kuerzel vor Umwandlung zur Kundin
    if (isUmwandlungspflichtig(kontakt) && !(kontakt.kuerzel || '').trim()) {
      setError(`Kuerzel fehlt. Bei Stand "${kontakt.stand_interessent}" wird der Interessent automatisch zur Kundin — ohne Kuerzel geht das nicht. Bitte Kuerzel eintragen.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const created = await createInteressent(kontakt);
        navigate(`/interessenten/${created.id}`, { replace: true });
      } else {
        // Kontaktdaten speichern
        const updated = await updateInteressent(id, kontakt);
        setKontakt((prev) => ({ ...prev, ...updated }));
        setOriginal((prev) => ({ ...prev, ...updated }));

        // Alle offenen Gespraech-Drafts mitspeichern
        const draftEntries = Object.entries(gespraechDrafts);
        for (const [gId, draft] of draftEntries) {
          await updateInteressentenGespraech(gId, draft);
        }

        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        // Neu laden damit Gespraeche aktuell sind
        if (draftEntries.length > 0) load();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (isNew) {
      setKontakt({ ...emptyInteressent });
    } else if (original) {
      setKontakt(JSON.parse(JSON.stringify(original)));
    }
    setSaved(false);
  };

  const handleDelete = async () => {
    if (!window.confirm(`"${displayName}" wirklich loeschen? Alle Gespraeche und Antworten werden ebenfalls geloescht.`)) return;
    try {
      await deleteInteressent(id);
      navigate(-1);
    } catch (e) {
      setError(e.message);
    }
  };

  if (!isNew && !kontakt) {
    return <div className="text-center py-12 text-gray-400">{error || 'Laden...'}</div>;
  }

  const displayName = isNew ? 'Neuer Interessent' : (`${kontakt.vorname || ''} ${kontakt.nachname || ''}`.trim() || kontakt.name || 'Interessent');

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-teal-dark">{displayName}</h2>
            {kontakt.datum_letzte_aenderung && (
              <p className="text-xs text-gray-400">
                Letzte Aenderung: {formatDateTime(kontakt.datum_letzte_aenderung)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
            >
              <Trash2 size={16} />
              Loeschen
            </button>
          )}
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <RotateCcw size={16} />
            Zuruecksetzen
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Speichern...' : saved ? 'Gespeichert!' : 'Speichern'}
          </button>
        </div>
      </div>

      {/* Termin-Info */}
      {!isNew && kontakt.gespraeche && kontakt.gespraeche.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          {kontakt.datum_erstkontakt && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-lg">
              <Calendar size={14} className="text-gray-500" />
              <span className="text-gray-500">Erstkontakt:</span>
              <span className="font-medium">{formatDate(kontakt.datum_erstkontakt)}</span>
            </div>
          )}
          {(() => {
            const next = kontakt.gespraeche
              .filter((g) => !g.cancelled_at && g.datum && new Date(g.datum) >= new Date())
              .sort((a, b) => new Date(a.datum) - new Date(b.datum))[0];
            if (next) return (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                <Calendar size={14} className="text-blue-600" />
                <span className="text-blue-600">Naechster Termin:</span>
                <span className="font-medium text-blue-700">{formatDateTime(next.datum)}</span>
                <span className="text-blue-500">({next.typ})</span>
                {next.meeting_url && (
                  <a href={next.meeting_url} target="_blank" rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 underline ml-1">Zoom</a>
                )}
              </div>
            );
            return null;
          })()}
          {(() => {
            const last = kontakt.gespraeche
              .filter((g) => !g.cancelled_at && g.datum && new Date(g.datum) < new Date())
              .sort((a, b) => new Date(b.datum) - new Date(a.datum))[0];
            if (last) return (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 rounded-lg">
                <Calendar size={14} className="text-gray-400" />
                <span className="text-gray-500">Letztes Gespraech:</span>
                <span className="font-medium text-gray-700">{formatDate(last.datum)}</span>
              </div>
            );
            return null;
          })()}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-teal-primary text-teal-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'basisdaten' && (
        <TabBasisdaten kontakt={kontakt} onChange={handleChange} />
      )}
      {activeTab === 'antworten' && (
        <TabAntworten antworten={kontakt.tidycal_antworten} kontaktId={id} onChanged={load} />
      )}
      {activeTab === 'gespraeche' && !isNew && (
        <TabGespraeche gespraeche={kontakt.gespraeche} kontaktId={id} onGespraechAdded={load} onGespraechDeleted={load} drafts={gespraechDrafts} setDrafts={setGespraechDrafts} onOpenGespraech={(g) => setOpenGespraech(g)} />
      )}
      {activeTab === 'followup' && !isNew && (
        <TabFollowUp kontakt={kontakt} kontaktId={id} />
      )}

      {/* Draggable Gespraech-Modal — bleibt offen beim Tab-Wechsel */}
      {openGespraech && (
        <DraggableGespraechModal
          gespraech={openGespraech}
          onClose={() => setOpenGespraech(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

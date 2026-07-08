import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, RotateCcw, Copy, Check, FolderOpen } from 'lucide-react';
import { getKontakt, updateKontakt, createKontakt } from '../lib/api.js';
import { formatDate, formatDateTime } from '../lib/format.js';
import TabBasisdaten from '../components/TabBasisdaten.jsx';
import TabTermine from '../components/TabTermine.jsx';
import TabRechnungen from '../components/TabRechnungen.jsx';
import TabSystembeteiligte from '../components/TabSystembeteiligte.jsx';
import TabZusatzinfo from '../components/TabZusatzinfo.jsx';
import DraggableTerminModal from '../components/DraggableTerminModal.jsx';

const TABS = [
  { key: 'basisdaten', label: 'Basisdaten' },
  { key: 'termine', label: 'Termine' },
  { key: 'rechnungen', label: 'Rechnungen' },
  { key: 'systembeteiligte', label: 'Systembeteiligte' },
  { key: 'zusatzinfo', label: 'Zusatzinformation EG/usw.' },
];

const emptyKontakt = {
  typ: 'kunde',
  vorname: '', nachname: '', kuerzel: '', land: '', mobilfon: '', telefon: '',
  email: '', strasse: '', ort: '', lebenszahl: '', status: 'aktiv',
  onboardingdatum: '', geburtsdatum: '', eg_geb: '', eg_am: '', geb_am: '', nebenabreden: '',
  quelle: '', gespraechspartner: 'Kirsten', paket: '', karriere_kompass_infos: '',
  aktiv: true, in_quentn: null, hinweise: '', anmerkungen: '', aktueller_stand: '',
  zusatzinfos: '', dateipfad: '',
};

export default function Kundendetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = id === 'neu';
  const [kontakt, setKontakt] = useState(isNew ? { ...emptyKontakt } : null);
  const [original, setOriginal] = useState(null);
  const [activeTab, setActiveTab] = useState('basisdaten');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [pathCopied, setPathCopied] = useState(false);
  const [pathOpenerMsg, setPathOpenerMsg] = useState(null);
  const [openTermin, setOpenTermin] = useState(null);
  const [terminReload, setTerminReload] = useState(null);

  const load = useCallback(() => {
    if (isNew) return;
    getKontakt(id)
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
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const created = await createKontakt(kontakt);
        navigate(`/kunden/${created.id}`, { replace: true });
      } else {
        const updated = await updateKontakt(id, kontakt);
        setKontakt(updated);
        setOriginal(JSON.parse(JSON.stringify(updated)));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (original) {
      setKontakt(JSON.parse(JSON.stringify(original)));
      setSaved(false);
    }
  };

  if (!isNew && !kontakt) {
    return <div className="text-center py-12 text-gray-400">{error || 'Laden...'}</div>;
  }

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
            <h2 className="text-2xl font-bold text-teal-dark">
              {isNew ? 'Neuer Kunde' : (kontakt.kuerzel || 'Kunde')}
            </h2>
            {kontakt.datum_letzte_aenderung && (
              <p className="text-xs text-gray-400">
                Letzte Aenderung: {formatDateTime(kontakt.datum_letzte_aenderung)}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {kontakt.dateipfad && (
            <>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(kontakt.dateipfad);
                    setPathCopied(true);
                    setTimeout(() => setPathCopied(false), 2000);
                  } catch {
                    const ta = document.createElement('textarea');
                    ta.value = kontakt.dateipfad;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    setPathCopied(true);
                    setTimeout(() => setPathCopied(false), 2000);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                title={kontakt.dateipfad}
              >
                {pathCopied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                {pathCopied ? 'Kopiert!' : 'Pfad kopieren'}
              </button>
              <button
                onClick={async () => {
                  setPathOpenerMsg(null);
                  try {
                    const res = await fetch(`http://localhost:3099/open?path=${encodeURIComponent(kontakt.dateipfad)}`);
                    const data = await res.json();
                    if (res.ok) {
                      setPathOpenerMsg({ type: 'ok', text: 'Ordner geoeffnet' });
                    } else {
                      setPathOpenerMsg({ type: 'error', text: data.message || 'Fehler' });
                    }
                  } catch {
                    setPathOpenerMsg({ type: 'error', text: 'Pfad-Oeffner nicht aktiv (pfad-oeffner.py starten)' });
                  }
                  setTimeout(() => setPathOpenerMsg(null), 3000);
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                title="Im Explorer oeffnen"
              >
                <FolderOpen size={16} />
                Oeffnen
              </button>
              {pathOpenerMsg && (
                <span className={`text-xs px-2 py-1 rounded ${pathOpenerMsg.type === 'ok' ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>
                  {pathOpenerMsg.text}
                </span>
              )}
            </>
          )}
          {!isNew && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              <RotateCcw size={16} />
              Zuruecksetzen
            </button>
          )}
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
      {activeTab === 'termine' && !isNew && (
        <TabTermine kontaktId={id} kuerzel={kontakt.kuerzel} onOpenTermin={(t, reloadFn) => { setOpenTermin(t); setTerminReload(() => reloadFn); }} />
      )}
      {activeTab === 'rechnungen' && !isNew && (
        <TabRechnungen kontaktId={id} kontakt={kontakt} />
      )}
      {activeTab === 'systembeteiligte' && !isNew && (
        <TabSystembeteiligte kontaktId={id} kuerzel={kontakt.kuerzel} />
      )}
      {activeTab === 'zusatzinfo' && (
        <TabZusatzinfo kontakt={kontakt} onChange={handleChange} />
      )}

      {/* Draggable Termin-Modal — bleibt offen beim Tab-Wechsel */}
      {openTermin && (
        <DraggableTerminModal
          termin={openTermin}
          onClose={() => setOpenTermin(null)}
          onSaved={() => { if (terminReload) terminReload(); }}
        />
      )}
    </div>
  );
}

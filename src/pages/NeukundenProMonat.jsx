import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, Save, Check, ExternalLink } from 'lucide-react';
import { getNeukundenProMonat, updateKontakt } from '../lib/api.js';
import { formatDate } from '../lib/format.js';

const MONATS_NAMEN = [
  'Januar', 'Februar', 'Maerz', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function monatLabel(yyyyMm) {
  if (!yyyyMm || yyyyMm.length !== 7) return yyyyMm;
  const [yy, mm] = yyyyMm.split('-');
  const idx = parseInt(mm, 10) - 1;
  return `${MONATS_NAMEN[idx] || mm} ${yy}`;
}

function isoDate(v) {
  if (!v) return '';
  return typeof v === 'string' ? v.substring(0, 10) : new Date(v).toISOString().substring(0, 10);
}

export default function NeukundenProMonat() {
  const navigate = useNavigate();
  const [daten, setDaten] = useState({ monate: [], ohneDatum: [] });
  const [loading, setLoading] = useState(true);
  const [offenesJahr, setOffenesJahr] = useState(null);

  // Inline-Edit-State fuer "Ohne Datum"
  const [entwurf, setEntwurf] = useState({}); // { [id]: 'YYYY-MM-DD' }
  const [speichernLaeuft, setSpeichernLaeuft] = useState({}); // { [id]: true }
  const [gespeichert, setGespeichert] = useState({}); // { [id]: true }

  const load = () => {
    setLoading(true);
    getNeukundenProMonat()
      .then(setDaten)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Nach Jahr gruppieren (neueste Jahre oben)
  const jahre = useMemo(() => {
    const map = new Map();
    for (const m of daten.monate) {
      const jahr = m.monat.substring(0, 4);
      if (!map.has(jahr)) map.set(jahr, { jahr, monate: [], summe: 0 });
      const eintrag = map.get(jahr);
      eintrag.monate.push(m);
      eintrag.summe += m.anzahl;
    }
    return [...map.values()].sort((a, b) => b.jahr.localeCompare(a.jahr));
  }, [daten.monate]);

  const maxAnzahl = useMemo(() => {
    return daten.monate.reduce((max, m) => Math.max(max, m.anzahl), 0) || 1;
  }, [daten.monate]);

  const gesamtKunden = daten.monate.reduce((sum, m) => sum + m.anzahl, 0);

  useEffect(() => {
    if (jahre.length > 0 && offenesJahr === null) {
      setOffenesJahr(jahre[0].jahr);
    }
  }, [jahre, offenesJahr]);

  const speichereGebAm = async (kunde) => {
    const wert = entwurf[kunde.id];
    if (!wert) return;
    setSpeichernLaeuft((s) => ({ ...s, [kunde.id]: true }));
    try {
      await updateKontakt(kunde.id, { ...kunde, geb_am: wert });
      setGespeichert((s) => ({ ...s, [kunde.id]: true }));
      setTimeout(() => {
        setGespeichert((s) => {
          const { [kunde.id]: _, ...rest } = s;
          return rest;
        });
      }, 1500);
      // Liste neu laden — der Kunde wandert in seinen Monat
      load();
      setEntwurf((e) => {
        const { [kunde.id]: _, ...rest } = e;
        return rest;
      });
    } catch (err) {
      alert('Fehler beim Speichern: ' + err.message);
    } finally {
      setSpeichernLaeuft((s) => {
        const { [kunde.id]: _, ...rest } = s;
        return rest;
      });
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-400">Laden...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/bereich/kunden')} className="text-gray-400 hover:text-teal-600">
          <ArrowLeft size={20} />
        </button>
        <TrendingUp size={24} className="text-teal-primary" />
        <h2 className="text-2xl font-bold text-teal-dark">Neukunden pro Monat</h2>
        <span className="text-sm text-gray-500 ml-2">
          Basis: <span className="font-medium">gebucht am</span> — {gesamtKunden} Kunden gesamt (Kika ausgeschlossen)
        </span>
      </div>

      <div className="space-y-4">
        {jahre.map((j) => {
          const offen = offenesJahr === j.jahr;
          return (
            <div key={j.jahr} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setOffenesJahr(offen ? null : j.jahr)}
                className="w-full flex items-center justify-between px-4 py-3 bg-teal-primary text-white hover:bg-teal-hover"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold">{j.jahr}</span>
                  <span className="text-sm opacity-90">{j.monate.length} Monate</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 bg-white/20 rounded-full text-sm font-semibold">
                    {j.summe} Neukunden
                  </span>
                  <span className="text-sm">{offen ? '▲' : '▼'}</span>
                </div>
              </button>

              {offen && (
                <div className="divide-y divide-gray-100">
                  {j.monate.map((m) => (
                    <div key={m.monat} className="px-4 py-3 hover:bg-gray-50">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-36 font-semibold text-gray-700">
                          {monatLabel(m.monat)}
                        </div>
                        <div className="flex-1 flex items-center gap-2">
                          <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                            <div
                              className="bg-teal-primary h-full flex items-center justify-end pr-2 text-white text-xs font-semibold transition-all"
                              style={{ width: `${(m.anzahl / maxAnzahl) * 100}%` }}
                            >
                              {m.anzahl}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="ml-36 flex flex-wrap gap-1.5">
                        {m.kunden.map((k) => (
                          <button
                            key={k.id}
                            onClick={() => navigate(`/kunden/${k.id}`)}
                            className="px-2 py-0.5 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded text-xs font-medium transition"
                            title={`${k.paket || ''}${k.quelle ? ' / Quelle: ' + k.quelle : ''} — gebucht am ${formatDate(k.geb_am)}`}
                          >
                            {k.kuerzel}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Kunden ohne gebucht-am Datum — inline nachtragen */}
      {daten.ohneDatum.length > 0 && (
        <div className="mt-8 bg-amber-50 border border-amber-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-amber-100 border-b border-amber-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-amber-900">
                {daten.ohneDatum.length} Kunden ohne "gebucht am"
              </h3>
              <span className="text-xs text-amber-700">
                Datum eintragen und mit dem Speichern-Knopf bestaetigen
              </span>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="bg-amber-50 text-amber-900 text-xs">
                <th className="px-3 py-2 text-left font-semibold">Kuerzel</th>
                <th className="px-3 py-2 text-left font-semibold">Name</th>
                <th className="px-3 py-2 text-left font-semibold">Paket</th>
                <th className="px-3 py-2 text-left font-semibold">Quelle</th>
                <th className="px-3 py-2 text-left font-semibold">Onboarding</th>
                <th className="px-3 py-2 text-left font-semibold">EG am / geb</th>
                <th className="px-3 py-2 text-left font-semibold w-56">gebucht am (eintragen)</th>
                <th className="px-3 py-2 text-left font-semibold w-10"></th>
              </tr>
            </thead>
            <tbody>
              {daten.ohneDatum.map((k) => {
                const wert = entwurf[k.id] ?? '';
                const laeuft = speichernLaeuft[k.id];
                const fertig = gespeichert[k.id];
                // Vorschlag: das aeltest bekannte Datum als Start
                const vorschlag = isoDate(k.onboardingdatum) || isoDate(k.eg_am) || isoDate(k.eg_geb) || '';
                return (
                  <tr key={k.id} className="border-t border-amber-200 hover:bg-amber-100/50">
                    <td className="px-3 py-1.5 font-mono font-semibold text-teal-800">
                      <button
                        onClick={() => navigate(`/kunden/${k.id}`)}
                        className="hover:underline inline-flex items-center gap-1"
                        title="Zum Kunden"
                      >
                        {k.kuerzel} <ExternalLink size={11} className="opacity-50" />
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-gray-700">
                      {[k.vorname, k.nachname].filter(Boolean).join(' ')}
                    </td>
                    <td className="px-3 py-1.5 text-gray-600">{k.paket || ''}</td>
                    <td className="px-3 py-1.5 text-gray-600">{k.quelle || ''}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-500">{formatDate(k.onboardingdatum)}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-500">
                      {formatDate(k.eg_am)}{k.eg_geb ? ` / ${formatDate(k.eg_geb)}` : ''}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="date"
                          value={wert}
                          placeholder={vorschlag}
                          onChange={(e) => setEntwurf((s) => ({ ...s, [k.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') speichereGebAm(k); }}
                          className="px-2 py-1 border border-amber-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        {vorschlag && !wert && (
                          <button
                            onClick={() => setEntwurf((s) => ({ ...s, [k.id]: vorschlag }))}
                            className="text-[10px] text-amber-700 hover:text-amber-900 underline whitespace-nowrap"
                            title="Onboarding-/EG-Datum uebernehmen"
                          >
                            uebernehm.
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => speichereGebAm(k)}
                        disabled={!wert || laeuft}
                        className={`p-1 rounded ${
                          fertig
                            ? 'bg-emerald-500 text-white'
                            : wert
                            ? 'bg-teal-primary text-white hover:bg-teal-hover'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                        title="Speichern"
                      >
                        {fertig ? <Check size={14} /> : <Save size={14} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

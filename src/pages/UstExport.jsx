import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { downloadUstExport } from '../lib/api.js';

export default function UstExport() {
  const navigate = useNavigate();
  const aktuellesJahr = new Date().getFullYear();
  const [von, setVon] = useState(`${aktuellesJahr}-01-01`);
  const [bis, setBis] = useState(`${aktuellesJahr}-12-31`);
  const [loading, setLoading] = useState(false);
  const [fehler, setFehler] = useState(null);

  const setQuartal = (q) => {
    const monatStart = (q - 1) * 3 + 1;
    const monatEnd = q * 3;
    const pad = (n) => String(n).padStart(2, '0');
    setVon(`${aktuellesJahr}-${pad(monatStart)}-01`);
    const letzterTag = new Date(aktuellesJahr, monatEnd, 0).getDate();
    setBis(`${aktuellesJahr}-${pad(monatEnd)}-${letzterTag}`);
  };

  const handleDownload = async () => {
    setFehler(null);
    setLoading(true);
    try {
      await downloadUstExport({ von, bis });
    } catch (err) {
      setFehler('Download fehlgeschlagen: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/bereich/finanzen')} className="text-gray-400 hover:text-teal-600">
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-2xl font-bold text-teal-dark">USt-Export</h2>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg">
        <p className="text-sm text-gray-600 mb-5">
          Exportiert alle Buchungen im gewählten Zeitraum als CSV-Datei für die Umsatzsteuererklärung.
          Netto und MwSt werden mit 19&nbsp;% berechnet. Die Spalten <em>gezVorsteuer</em> und <em>EÜR</em> bleiben leer und können in Excel befüllt werden.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          {[1, 2, 3, 4].map((q) => (
            <button
              key={q}
              onClick={() => setQuartal(q)}
              className="px-3 py-1.5 bg-slate-100 border border-slate-300 text-slate-700 rounded-md hover:bg-slate-200 text-sm font-medium"
            >
              Q{q} {aktuellesJahr}
            </button>
          ))}
          <button
            onClick={() => { setVon(`${aktuellesJahr}-01-01`); setBis(`${aktuellesJahr}-12-31`); }}
            className="px-3 py-1.5 bg-slate-100 border border-slate-300 text-slate-700 rounded-md hover:bg-slate-200 text-sm font-medium"
          >
            Ganzes Jahr {aktuellesJahr}
          </button>
        </div>

        <div className="flex gap-4 mb-6">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Von</label>
            <input
              type="date"
              value={von}
              onChange={(e) => setVon(e.target.value)}
              className="px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-teal-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Bis</label>
            <input
              type="date"
              value={bis}
              onChange={(e) => setBis(e.target.value)}
              className="px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:ring-1 focus:ring-teal-primary"
            />
          </div>
        </div>

        {fehler && (
          <p className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-800 rounded text-sm">{fehler}</p>
        )}

        <button
          onClick={handleDownload}
          disabled={loading || !von || !bis}
          className="flex items-center gap-2 px-5 py-2.5 bg-teal-primary text-white rounded-lg hover:bg-teal-hover disabled:opacity-50 font-medium"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          CSV herunterladen
        </button>
      </div>
    </div>
  );
}

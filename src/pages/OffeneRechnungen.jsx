import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getOffeneRechnungen } from '../lib/api.js';
import { formatDate, formatCurrency } from '../lib/format.js';
import { ArrowLeft } from 'lucide-react';

const todayStr = () => new Date().toLocaleDateString('sv-SE');

export default function OffeneRechnungen() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getOffeneRechnungen()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const heute = todayStr();

  // Faellige = gestellt_am <= heute, Zukuenftige = gestellt_am > heute
  const faellige = data.filter((r) => r.gestellt_am && r.gestellt_am.substring(0, 10) <= heute);
  const zukuenftige = data.filter((r) => !r.gestellt_am || r.gestellt_am.substring(0, 10) > heute);

  const totalFaellig = faellige.reduce((sum, r) => sum + (parseFloat(r.betrag) || 0), 0);
  const totalZukuenftig = zukuenftige.reduce((sum, r) => sum + (parseFloat(r.betrag) || 0), 0);

  // Ueberfaellig = faellig_am < heute (also Faelligkeit ist verstrichen)
  const isUeberfaellig = (r) => r.faellig_am && r.faellig_am.substring(0, 10) < heute;
  const countUeberfaellig = faellige.filter(isUeberfaellig).length;
  const totalUeberfaellig = faellige.filter(isUeberfaellig).reduce((sum, r) => sum + (parseFloat(r.betrag) || 0), 0);
  const tageUeberfaellig = (fallDate) => {
    if (!fallDate) return 0;
    const diff = (new Date(heute).getTime() - new Date(fallDate.substring(0, 10)).getTime()) / (1000 * 60 * 60 * 24);
    return Math.floor(diff);
  };

  const columns = [
    { key: 'kuerzel', label: 'Kuerzel' },
    { key: 'vorname', label: 'Vorname' },
    { key: 'nachname', label: 'Nachname' },
    { key: 'rg_nr', label: 'RgNr' },
    { key: 'betrag', label: 'Betrag', render: (v) => formatCurrency(v) },
    { key: 'gestellt_am', label: 'gestellt am', render: (v) => formatDate(v) },
    { key: 'faellig_am', label: 'faellig am', render: (v, row) => {
        if (!v) return '';
        const tage = tageUeberfaellig(v);
        if (tage > 0) {
          return (
            <span className="font-semibold text-red-700">
              {formatDate(v)} <span className="text-[11px] font-normal">({tage} T. ueberfaellig)</span>
            </span>
          );
        }
        return formatDate(v);
      }
    },
    { key: 'produkt_kuerzel', label: 'Produkt' },
  ];

  const renderTable = (rows) => {
    if (rows.length === 0) return <div className="text-center py-6 text-gray-400">Keine Rechnungen</div>;
    return (
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-teal-primary text-white">
              {columns.map((col) => (
                <th key={col.key} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const ueberfaellig = isUeberfaellig(row);
              const rowCls = ueberfaellig
                ? 'bg-red-50 hover:bg-red-100 border-l-4 border-l-red-500'
                : (idx % 2 === 0 ? 'bg-white hover:bg-teal-50' : 'bg-gray-50/50 hover:bg-teal-50');
              return (
                <tr
                  key={row.id || idx}
                  onClick={() => navigate(`/kunden/${row.kontakt_id}`)}
                  className={`border-t border-gray-100 cursor-pointer ${rowCls}`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-2 whitespace-nowrap">
                      {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  if (loading) return <div className="text-center py-12 text-gray-400">Laden...</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/bereich/kunden')} className="text-gray-400 hover:text-teal-600"><ArrowLeft size={20} /></button>
        <h2 className="text-2xl font-bold text-teal-dark">Offene Rechnungen</h2>
      </div>

      {/* Faellige Rechnungen */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-800">Faellig ({faellige.length})</h3>
          <div className="flex items-center gap-2">
            {countUeberfaellig > 0 && (
              <div className="px-3 py-1.5 bg-red-100 border border-red-300 rounded-lg text-sm font-semibold text-red-800">
                Ueberfaellig: {countUeberfaellig} / {formatCurrency(totalUeberfaellig)}
              </div>
            )}
            {faellige.length > 0 && (
              <div className="px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg text-sm font-medium text-red-700">
                Summe: {formatCurrency(totalFaellig)}
              </div>
            )}
          </div>
        </div>
        {renderTable(faellige)}
      </div>

      {/* Zukuenftige Rechnungen */}
      {zukuenftige.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-800">Zukuenftig ({zukuenftige.length})</h3>
            <div className="px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-sm font-medium text-emerald-700">
              Summe: {formatCurrency(totalZukuenftig)}
            </div>
          </div>
          {renderTable(zukuenftige)}
        </div>
      )}
    </div>
  );
}

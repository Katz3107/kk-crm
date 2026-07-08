import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Users, Euro, CheckCircle2, Clock, FileText } from 'lucide-react';
import { getKursTeilnehmer } from '../lib/api.js';
import { formatDate, formatCurrency } from '../lib/format.js';

const KURS_KUERZEL = 'KNeu';

export default function KursNeuorientierung() {
  const [teilnehmer, setTeilnehmer] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    getKursTeilnehmer(KURS_KUERZEL)
      .then(setTeilnehmer)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const s = {
      anzahl: teilnehmer.length,
      gesamt: 0,
      bezahlt: 0,
      offen: 0,
      vollstaendig: 0,
    };
    for (const t of teilnehmer) {
      const ges = parseFloat(t.preis_gesamt) || 0;
      const bez = parseFloat(t.preis_bezahlt) || 0;
      s.gesamt += ges;
      s.bezahlt += bez;
      s.offen += Math.max(0, ges - bez);
      if (bez >= ges && ges > 0) s.vollstaendig++;
    }
    return s;
  }, [teilnehmer]);

  if (loading) return <div className="p-6 text-gray-400">Laden...</div>;
  if (error) return <div className="p-6 text-red-600">Fehler: {error}</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-teal-dark">Kurs Neuorientierung 45+</h1>
        <p className="text-sm text-gray-500 mt-1">
          Teilnehmerliste (Käufe über Copecart). Bei einem Kauf wird der Kontakt automatisch angelegt oder mit einem bestehenden Interessenten verknüpft.
        </p>
      </div>

      {/* Kennzahlen */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KennzahlCard
          icon={Users}
          label="Teilnehmer"
          value={stats.anzahl}
          color="teal"
        />
        <KennzahlCard
          icon={CheckCircle2}
          label="Voll bezahlt"
          value={stats.vollstaendig}
          color="emerald"
        />
        <KennzahlCard
          icon={Euro}
          label="Eingenommen"
          value={formatCurrency(stats.bezahlt)}
          color="blue"
        />
        <KennzahlCard
          icon={Clock}
          label="Noch offen"
          value={formatCurrency(stats.offen)}
          color="amber"
        />
      </div>

      {/* Tabelle */}
      {teilnehmer.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          Noch keine Teilnehmer eingetragen.
          <br />
          <span className="text-xs">Sobald jemand über Copecart kauft, erscheint er hier automatisch.</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-teal-primary text-white">
                <th className="px-3 py-2 text-left">Kaufdatum</th>
                <th className="px-3 py-2 text-left">Kürzel</th>
                <th className="px-3 py-2 text-right">Gesamt</th>
                <th className="px-3 py-2 text-right">Bezahlt</th>
                <th className="px-3 py-2 text-right">Offen</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-left">Zahlungsart</th>
                <th className="px-3 py-2 text-left">Copecart-Order</th>
              </tr>
            </thead>
            <tbody>
              {teilnehmer.map((t, idx) => {
                const ges = parseFloat(t.preis_gesamt) || 0;
                const bez = parseFloat(t.preis_bezahlt) || 0;
                const offen = Math.max(0, ges - bez);
                const voll = bez >= ges && ges > 0;
                const fullName = [t.vorname, t.nachname].filter(Boolean).join(' ');
                // Anzeige: nur Kürzel; falls kein Kürzel hinterlegt, fallback auf Name (kursiv).
                return (
                  <tr key={t.id} className={`border-t ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(t.gekauft_am)}</td>
                    <td className="px-3 py-2">
                      {t.kontakt_id ? (
                        <Link
                          to={`/kunden/${t.kontakt_id}`}
                          className="text-teal-primary hover:underline"
                          title={fullName || t.email}
                        >
                          {t.kontakt_kuerzel || <span className="italic text-gray-500">{fullName || '(kein Name)'}</span>}
                        </Link>
                      ) : (
                        <span className="italic text-gray-500" title={fullName || t.email}>
                          {fullName || '(kein Name)'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatCurrency(ges)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatCurrency(bez)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {offen > 0 ? (
                        <span className="text-amber-700">{formatCurrency(offen)}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {voll ? (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs">
                          voll bezahlt
                        </span>
                      ) : bez > 0 ? (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
                          Teilzahlung
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs">
                          offen
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {t.payment_plan === 'breakdown_payment'
                        ? `Raten (${t.anzahl_raten_bezahlt || 0} bezahlt)`
                        : t.payment_plan === 'single_payment'
                        ? 'Einmalzahlung'
                        : t.payment_plan || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-400 font-mono">{t.copecart_order_id || '—'}</td>
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

function KennzahlCard({ icon: Icon, label, value, color }) {
  const colors = {
    teal: 'bg-teal-50 text-teal-dark border-teal-primary/20',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[color] || colors.teal}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide opacity-70">
        <Icon size={14} />
        {label}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

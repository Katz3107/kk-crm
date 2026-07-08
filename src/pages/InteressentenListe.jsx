import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, UserPlus, Filter, X, ArrowLeft } from 'lucide-react';
import { getInteressenten } from '../lib/api.js';
import { formatDate, formatDateTime } from '../lib/format.js';
import DataTable from '../components/DataTable.jsx';

const standLabels = {
  EG: 'EG geplant',
  Schwebe: 'Schwebe',
  ZG: 'Zweitgespraech',
  AB: 'Abgeschlossen',
  KE: 'Kein Interesse',
  KU: 'Wurde Kunde',
  'Gebucht': 'Gebucht',
  'Nicht gebucht': 'Nicht gebucht',
  'Abgesagt': 'Abgesagt',
  'No-Show': 'No-Show',
  'Kein Zielkunde': 'Kein Zielkunde',
  'Storno': 'Storno',
  '2G': 'Zweitgespraech',
};

const standColors = {
  EG: 'bg-blue-100 text-blue-700',
  Schwebe: 'bg-yellow-100 text-yellow-700',
  ZG: 'bg-purple-100 text-purple-700',
  AB: 'bg-gray-100 text-gray-600',
  KE: 'bg-red-100 text-red-700',
  KU: 'bg-emerald-100 text-emerald-700',
  'Gebucht': 'bg-green-100 text-green-700',
  'Nicht gebucht': 'bg-orange-100 text-orange-700',
  'Abgesagt': 'bg-red-100 text-red-600',
  'No-Show': 'bg-red-100 text-red-700',
  'Kein Zielkunde': 'bg-gray-100 text-gray-500',
  'Storno': 'bg-gray-100 text-gray-500',
  '2G': 'bg-purple-100 text-purple-700',
};

const columns = [
  { key: 'vorname', label: 'Vorname' },
  { key: 'email', label: 'E-Mail' },
  { key: 'quelle', label: 'Quelle', render: (val) => val || <span className="text-gray-300">-</span> },
  { key: 'erstellungsdatum', label: 'Erstellt', render: (val) => val ? formatDate(val) : <span className="text-gray-300">-</span> },
  {
    key: 'naechster_termin',
    label: 'Naechster Termin',
    render: (val) => {
      if (!val) return <span className="text-gray-400">-</span>;
      return formatDateTime(val);
    },
  },
  {
    key: 'datum_naechste_aktion',
    label: 'Follow-up',
    render: (val) => {
      if (!val) return <span className="text-gray-300">-</span>;
      const fuStr = val.substring(0, 10);
      const todayStr = new Date().toLocaleDateString('sv-SE');
      const isOverdue = fuStr <= todayStr;
      return (
        <span className={`text-xs font-medium ${isOverdue ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
          {formatDate(val)}
          {isOverdue && ' !'}
        </span>
      );
    },
  },
  {
    key: 'stand_interessent',
    label: 'Stand',
    render: (val) => {
      const label = standLabels[val] || val || 'Neu';
      const color = standColors[val] || 'bg-gray-100 text-gray-600';
      return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
          {label}
        </span>
      );
    },
  },
];

export default function InteressentenListe() {
  const [allData, setAllData] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter-State
  const [filterStand, setFilterStand] = useState(searchParams.get('stand') || '');
  const [filterTermin, setFilterTermin] = useState(searchParams.get('termin') || '');
  const [filterFU, setFilterFU] = useState(searchParams.get('fu') || (searchParams.get('filter') === 'followup' ? 'faellig' : ''));
  const [filterZeitraum, setFilterZeitraum] = useState(searchParams.get('zeitraum') || '');

  // Daten laden
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      getInteressenten(search)
        .then(setAllData)
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Alle vorhandenen Stand-Werte aus den Daten ermitteln
  const availableStands = useMemo(() => {
    const stands = new Map();
    allData.forEach((i) => {
      const s = i.stand_interessent || '';
      if (s && !stands.has(s)) {
        stands.set(s, standLabels[s] || s);
      }
    });
    // Sortiert nach Haeufigkeit
    const counts = {};
    allData.forEach((i) => { const s = i.stand_interessent || ''; counts[s] = (counts[s] || 0) + 1; });
    return [...stands.entries()].sort((a, b) => (counts[b[0]] || 0) - (counts[a[0]] || 0));
  }, [allData]);

  // Zeitraum-Grenzen berechnen
  const zeitraumRange = useMemo(() => {
    if (!filterZeitraum) return null;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-basiert
    const q = Math.floor(m / 3);
    switch (filterZeitraum) {
      case 'diese-woche': {
        const d = new Date(now); d.setDate(d.getDate() - d.getDay() + 1); // Montag
        const von = d.toLocaleDateString('sv-SE');
        const bis = new Date(d); bis.setDate(bis.getDate() + 6);
        return { von, bis: bis.toLocaleDateString('sv-SE') };
      }
      case 'letzte-woche': {
        const d = new Date(now); d.setDate(d.getDate() - d.getDay() - 6); // letzter Montag
        const von = d.toLocaleDateString('sv-SE');
        const bis = new Date(d); bis.setDate(bis.getDate() + 6);
        return { von, bis: bis.toLocaleDateString('sv-SE') };
      }
      case 'dieser-monat':
        return { von: `${y}-${String(m+1).padStart(2,'0')}-01`, bis: `${y}-${String(m+1).padStart(2,'0')}-31` };
      case 'letzter-monat': {
        const lm = m === 0 ? 11 : m - 1;
        const ly = m === 0 ? y - 1 : y;
        return { von: `${ly}-${String(lm+1).padStart(2,'0')}-01`, bis: `${ly}-${String(lm+1).padStart(2,'0')}-31` };
      }
      case 'dieses-quartal':
        return { von: `${y}-${String(q*3+1).padStart(2,'0')}-01`, bis: `${y}-${String(q*3+3).padStart(2,'0')}-31` };
      case 'letztes-quartal': {
        const lq = q === 0 ? 3 : q - 1;
        const lqy = q === 0 ? y - 1 : y;
        return { von: `${lqy}-${String(lq*3+1).padStart(2,'0')}-01`, bis: `${lqy}-${String(lq*3+3).padStart(2,'0')}-31` };
      }
      case 'dieses-jahr':
        return { von: `${y}-01-01`, bis: `${y}-12-31` };
      case 'letztes-jahr':
        return { von: `${y-1}-01-01`, bis: `${y-1}-12-31` };
      default: return null;
    }
  }, [filterZeitraum]);

  // Filtern
  const filtered = useMemo(() => {
    const todayStr = new Date().toLocaleDateString('sv-SE');

    return allData.filter((i) => {
      // Stand-Filter
      if (filterStand && (i.stand_interessent || '') !== filterStand) return false;

      // Termin-Filter
      if (filterTermin === 'mit' && !i.naechster_termin) return false;
      if (filterTermin === 'ohne' && i.naechster_termin) return false;

      // Zeitraum-Filter (auf Erstellungsdatum)
      if (zeitraumRange) {
        if (!i.erstellungsdatum) return false;
        const erstellt = i.erstellungsdatum.substring(0, 10);
        if (erstellt < zeitraumRange.von || erstellt > zeitraumRange.bis) return false;
      }

      // Follow-up-Filter
      if (filterFU === 'faellig') {
        if (!i.datum_naechste_aktion) return false;
        const fuStr = i.datum_naechste_aktion.substring(0, 10);
        if (fuStr > todayStr) return false;
      } else if (filterFU === 'geplant') {
        if (!i.datum_naechste_aktion) return false;
        const fuStr = i.datum_naechste_aktion.substring(0, 10);
        if (fuStr <= todayStr) return false;
      } else if (filterFU === 'ohne') {
        if (i.datum_naechste_aktion) return false;
      } else if (filterFU === 'mit') {
        if (!i.datum_naechste_aktion) return false;
      }

      return true;
    });
  }, [allData, filterStand, filterTermin, filterFU, zeitraumRange]);

  // URL-Params synchronisieren
  useEffect(() => {
    const params = {};
    if (filterStand) params.stand = filterStand;
    if (filterTermin) params.termin = filterTermin;
    if (filterFU) params.fu = filterFU;
    if (filterZeitraum) params.zeitraum = filterZeitraum;
    setSearchParams(params, { replace: true });
  }, [filterStand, filterTermin, filterFU, filterZeitraum]);

  const hasFilters = filterStand || filterTermin || filterFU || filterZeitraum;

  const clearFilters = () => {
    setFilterStand('');
    setFilterTermin('');
    setFilterFU('');
    setFilterZeitraum('');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/bereich/interessenten')} className="text-gray-400 hover:text-teal-600"><ArrowLeft size={20} /></button>
          <h2 className="text-2xl font-bold text-teal-dark">Interessenten</h2>
        </div>
        <button
          onClick={() => navigate('/interessenten/neu')}
          className="flex items-center gap-2 px-4 py-2 bg-teal-primary text-white rounded-lg hover:bg-teal-hover text-sm"
        >
          <UserPlus size={16} />
          Neuer Interessent
        </button>
      </div>

      {/* Suchfeld */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="text"
          placeholder="Suchen (Name, E-Mail...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-primary/40 text-sm"
        />
      </div>

      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Filter size={16} className="text-gray-400" />

        {/* Stand */}
        <select
          value={filterStand}
          onChange={(e) => setFilterStand(e.target.value)}
          className={`text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-primary/40 ${
            filterStand ? 'border-teal-primary bg-teal-50 text-teal-700 font-medium' : 'border-gray-300 text-gray-600'
          }`}
        >
          <option value="">Alle Staende</option>
          {availableStands.map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>

        {/* Termin */}
        <select
          value={filterTermin}
          onChange={(e) => setFilterTermin(e.target.value)}
          className={`text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-primary/40 ${
            filterTermin ? 'border-teal-primary bg-teal-50 text-teal-700 font-medium' : 'border-gray-300 text-gray-600'
          }`}
        >
          <option value="">Termin: Alle</option>
          <option value="mit">Mit Termin</option>
          <option value="ohne">Ohne Termin</option>
        </select>

        {/* Zeitraum (Erstellungsdatum) */}
        <select
          value={filterZeitraum}
          onChange={(e) => setFilterZeitraum(e.target.value)}
          className={`text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-primary/40 ${
            filterZeitraum ? 'border-teal-primary bg-teal-50 text-teal-700 font-medium' : 'border-gray-300 text-gray-600'
          }`}
        >
          <option value="">Erstellt: Alle</option>
          <option value="diese-woche">Diese Woche</option>
          <option value="letzte-woche">Letzte Woche</option>
          <option value="dieser-monat">Dieser Monat</option>
          <option value="letzter-monat">Letzter Monat</option>
          <option value="dieses-quartal">Dieses Quartal</option>
          <option value="letztes-quartal">Letztes Quartal</option>
          <option value="dieses-jahr">Dieses Jahr</option>
          <option value="letztes-jahr">Letztes Jahr</option>
        </select>

        {/* Follow-up */}
        <select
          value={filterFU}
          onChange={(e) => setFilterFU(e.target.value)}
          className={`text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-primary/40 ${
            filterFU ? 'border-rose-500 bg-rose-50 text-rose-700 font-medium' : 'border-gray-300 text-gray-600'
          }`}
        >
          <option value="">Follow-up: Alle</option>
          <option value="faellig">Faellig / Ueberfaellig</option>
          <option value="geplant">Geplant (Zukunft)</option>
          <option value="mit">Mit FU-Datum</option>
          <option value="ohne">Ohne FU-Datum</option>
        </select>

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 ml-1"
          >
            <X size={14} />
            Filter zuruecksetzen
          </button>
        )}

        <span className="text-xs text-gray-400 ml-auto">
          {filtered.length} von {allData.length}
        </span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Laden...</div>
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          onRowClick={(row) => navigate(`/interessenten/${row.id}`)}
          emptyMessage="Keine Interessenten gefunden"
        />
      )}
    </div>
  );
}

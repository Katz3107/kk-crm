import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserPlus, ArrowLeft } from 'lucide-react';
import { getKontakte } from '../lib/api.js';
import { formatDate } from '../lib/format.js';
import DataTable from '../components/DataTable.jsx';

const columns = [
  { key: 'kuerzel', label: 'Kuerzel', width: '90px' },
  { key: 'status', label: 'Status', width: '100px', render: (val) => {
    const colors = {
      aktiv: 'bg-emerald-100 text-emerald-700',
      beendet: 'bg-gray-100 text-gray-600',
      pausiert: 'bg-amber-100 text-amber-700',
      storniert: 'bg-red-100 text-red-700',
    };
    return val ? (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[val] || 'bg-gray-100 text-gray-600'}`}>
        {val}
      </span>
    ) : '';
  }},
  { key: 'paket', label: 'Paket' },
  { key: 'erster_termin_typ', label: 'Start', width: '70px', render: (val) => {
    if (!val) return <span className="text-gray-300">–</span>;
    const colors = val === 'E'
      ? 'bg-sky-100 text-sky-700'
      : 'bg-violet-100 text-violet-700';
    return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors}`}>{val}</span>;
  }},
  { key: 'anzahl_termine', label: 'Termine', width: '90px', render: (val) => {
    const n = Number(val) || 0;
    return <span className="font-medium tabular-nums">{n}</span>;
  }},
  { key: 'quelle', label: 'Quelle' },
  { key: 'geb_am', label: 'Buchung', render: (val) => formatDate(val) },
  { key: 'letzter_termin', label: 'Letzter Termin', render: (val) => formatDate(val) },
];

export default function Kundenliste() {
  const [kunden, setKunden] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('aktiv');
  const [quelleFilter, setQuelleFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      getKontakte(search, statusFilter)
        .then(setKunden)
        .catch(console.error)
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [search, statusFilter]);

  // Verfuegbare Quellen aus den geladenen Daten ermitteln (sortiert nach Haeufigkeit)
  const availableQuellen = useMemo(() => {
    const counts = new Map();
    kunden.forEach((k) => {
      const q = (k.quelle || '').trim();
      if (q) counts.set(q, (counts.get(q) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [kunden]);

  const filteredKunden = useMemo(() => {
    if (!quelleFilter) return kunden;
    return kunden.filter((k) => (k.quelle || '').trim() === quelleFilter);
  }, [kunden, quelleFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/bereich/kunden')} className="text-gray-400 hover:text-teal-600"><ArrowLeft size={20} /></button>
          <h2 className="text-2xl font-bold text-teal-dark">Kundenuebersicht</h2>
          {!loading && (
            <span className="text-sm text-gray-500 font-normal">({filteredKunden.length})</span>
          )}
        </div>
        <button
          onClick={() => navigate('/kunden/neu')}
          className="flex items-center gap-2 px-4 py-2 bg-teal-primary text-white rounded-lg hover:bg-teal-hover text-sm"
        >
          <UserPlus size={16} />
          Neuer Kunde
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Suchen (Name, Kuerzel, E-Mail, Paket...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-primary/40 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40"
        >
          <option value="aktiv">Nur aktive</option>
          <option value="inaktiv">Nur inaktive</option>
          <option value="alle">Alle</option>
        </select>
        <select
          value={quelleFilter}
          onChange={(e) => setQuelleFilter(e.target.value)}
          className={`px-3 py-2.5 border rounded-lg bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-primary/40 ${
            quelleFilter ? 'border-teal-primary text-teal-700 font-medium' : 'border-gray-300'
          }`}
        >
          <option value="">Quelle: Alle</option>
          {availableQuellen.map(([q, count]) => (
            <option key={q} value={q}>{q} ({count})</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Laden...</div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredKunden}
          onRowClick={(row) => navigate(`/kunden/${row.id}`)}
          emptyMessage="Keine Kunden gefunden"
        />
      )}
    </div>
  );
}

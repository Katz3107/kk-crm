import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTerminanzahl } from '../lib/api.js';
import DataTable from '../components/DataTable.jsx';

const columns = [
  { key: 'kuerzel', label: 'Kuerzel' },
  { key: 'vorname', label: 'Vorname' },
  { key: 'nachname', label: 'Nachname' },
  { key: 'paket', label: 'Paket' },
  { key: 'anzahl_termine', label: 'Anzahl Termine', render: (v) => (
    <span className="font-semibold">{v}</span>
  )},
];

export default function Terminanzahl() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getTerminanzahl()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold text-teal-dark mb-6">Terminanzahl pro Kunde</h2>
      {loading ? (
        <div className="text-center py-12 text-gray-400">Laden...</div>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          onRowClick={(row) => navigate(`/kunden/${row.kontakt_id}`)}
          emptyMessage="Keine Termine vorhanden"
        />
      )}
    </div>
  );
}

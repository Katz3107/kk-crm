import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getOffeneLogbuecher } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import DataTable from '../components/DataTable.jsx';

const columns = [
  { key: 'kuerzel', label: 'Kuerzel' },
  { key: 'vorname', label: 'Vorname' },
  { key: 'nachname', label: 'Nachname' },
  { key: 'aktion', label: 'Aktion' },
  { key: 'datum', label: 'Datum', render: (v) => formatDateTime(v) },
  { key: 'inhalt', label: 'Inhalt', render: (v) => v ? (v.length > 60 ? v.substring(0, 60) + '...' : v) : '' },
];

export default function OffeneLogbuecher() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getOffeneLogbuecher()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold text-teal-dark mb-6">Offene Logbuecher</h2>
      <p className="text-sm text-gray-500 mb-4">Kundentermine, bei denen das Logbuch noch nicht versendet wurde.</p>
      {loading ? (
        <div className="text-center py-12 text-gray-400">Laden...</div>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          onRowClick={(row) => navigate(`/kunden/${row.kontakt_id}`)}
          emptyMessage="Keine offenen Logbuecher"
        />
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getNeukunden } from '../lib/api.js';
import { formatDate } from '../lib/format.js';
import DataTable from '../components/DataTable.jsx';

const columns = [
  { key: 'kuerzel', label: 'Kuerzel' },
  { key: 'vorname', label: 'Vorname' },
  { key: 'nachname', label: 'Nachname' },
  { key: 'paket', label: 'Paket' },
  { key: 'email', label: 'E-Mail' },
  { key: 'onboardingdatum', label: 'Onboarding', render: (v) => formatDate(v) },
  { key: 'quelle', label: 'Quelle' },
];

export default function Neukunden() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getNeukunden()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold text-teal-dark mb-6">Neukunden</h2>
      <p className="text-sm text-gray-500 mb-4">Aktive Kunden, sortiert nach Onboardingdatum (neueste zuerst).</p>
      {loading ? (
        <div className="text-center py-12 text-gray-400">Laden...</div>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          onRowClick={(row) => navigate(`/kunden/${row.id}`)}
          emptyMessage="Keine Neukunden"
        />
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getOffeneBetraege } from '../lib/api.js';
import { formatDate, formatCurrency } from '../lib/format.js';
import DataTable from '../components/DataTable.jsx';

const columns = [
  { key: 'kuerzel', label: 'Kuerzel' },
  { key: 'vorname', label: 'Vorname' },
  { key: 'nachname', label: 'Nachname' },
  { key: 'rg_nr', label: 'RgNr' },
  { key: 'betrag', label: 'Betrag', render: (v) => formatCurrency(v) },
  { key: 'gestellt_am', label: 'gestellt am', render: (v) => formatDate(v) },
  { key: 'produkt_kuerzel', label: 'Produkt' },
];

export default function OffeneBetraege() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getOffeneBetraege()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const total = data.reduce((sum, r) => sum + (parseFloat(r.betrag) || 0), 0);

  return (
    <div>
      <h2 className="text-2xl font-bold text-teal-dark mb-2">Offene Betraege</h2>
      <p className="text-sm text-gray-500 mb-4">Rechnungen, bei denen noch kein Zahlungseingang verbucht wurde.</p>
      {!loading && data.length > 0 && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
          <strong>Gesamtsumme offen:</strong> {formatCurrency(total)}
        </div>
      )}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Laden...</div>
      ) : (
        <DataTable
          columns={columns}
          data={data}
          onRowClick={(row) => navigate(`/kunden/${row.kontakt_id}`)}
          emptyMessage="Keine offenen Betraege"
        />
      )}
    </div>
  );
}

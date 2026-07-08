import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import BereichInteressenten from './pages/BereichInteressenten.jsx';
import BereichKunden from './pages/BereichKunden.jsx';
import BereichFinanzen from './pages/BereichFinanzen.jsx';
import Kundenliste from './pages/Kundenliste.jsx';
import Kundendetail from './pages/Kundendetail.jsx';
import OffeneLogbuecher from './pages/OffeneLogbuecher.jsx';
import OffeneBetraege from './pages/OffeneBetraege.jsx';
import Terminanzahl from './pages/Terminanzahl.jsx';
import OffeneRechnungen from './pages/OffeneRechnungen.jsx';
import Neukunden from './pages/Neukunden.jsx';
import NeukundenProMonat from './pages/NeukundenProMonat.jsx';
import InteressentenListe from './pages/InteressentenListe.jsx';
import InteressentenDetail from './pages/InteressentenDetail.jsx';
import Zahlungsabgleich from './pages/Zahlungsabgleich.jsx';
import Kontobewegungen from './pages/Kontobewegungen.jsx';
import Kategorisierungsregeln from './pages/Kategorisierungsregeln.jsx';
import DbAdmin from './pages/DbAdmin.jsx';
import KursNeuorientierung from './pages/KursNeuorientierung.jsx';
import UstExport from './pages/UstExport.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/bereich/interessenten" element={<BereichInteressenten />} />
        <Route path="/bereich/kunden" element={<BereichKunden />} />
        <Route path="/bereich/finanzen" element={<BereichFinanzen />} />
        <Route path="/kunden" element={<Kundenliste />} />
        <Route path="/kunden/:id" element={<Kundendetail />} />
        <Route path="/interessenten" element={<InteressentenListe />} />
        <Route path="/interessenten/:id" element={<InteressentenDetail />} />
        <Route path="/offene-logbuecher" element={<OffeneLogbuecher />} />
        <Route path="/offene-betraege" element={<OffeneBetraege />} />
        <Route path="/terminanzahl" element={<Terminanzahl />} />
        <Route path="/offene-rechnungen" element={<OffeneRechnungen />} />
        <Route path="/neukunden" element={<Neukunden />} />
        <Route path="/neukunden-pro-monat" element={<NeukundenProMonat />} />
        <Route path="/zahlungsabgleich" element={<Zahlungsabgleich />} />
        <Route path="/kontobewegungen" element={<Kontobewegungen />} />
        <Route path="/kategorisierungsregeln" element={<Kategorisierungsregeln />} />
        <Route path="/db-admin" element={<DbAdmin />} />
        <Route path="/kurs/neuorientierung" element={<KursNeuorientierung />} />
        <Route path="/ust-export" element={<UstExport />} />
      </Route>
    </Routes>
  );
}

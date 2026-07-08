import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Home, Users, UserSearch, Wallet } from 'lucide-react';

// Erkennt die Staging-Umgebung zur Laufzeit an Hostname/Port, statt an einer
// separat gepflegten Build-Konstante - so bleibt derselbe Code in Test und
// Produktion identisch, nur die tatsaechliche URL entscheidet.
function isStaging() {
  if (typeof window === 'undefined') return false;
  return window.location.hostname === 'crm-test.katzenmayer-coaching.com' || window.location.port === '3105';
}

export default function Layout() {
  const location = useLocation();
  const path = location.pathname;

  const navLinks = [
    { to: '/bereich/kunden', label: 'Kunden', icon: Users, match: ['/bereich/kunden', '/kunden'] },
    { to: '/bereich/interessenten', label: 'Interessenten', icon: UserSearch, match: ['/bereich/interessenten', '/interessenten'] },
    { to: '/bereich/finanzen', label: 'Finanzen', icon: Wallet, match: ['/bereich/finanzen', '/offene-rechnungen', '/offene-betraege', '/zahlungsabgleich', '/kontobewegungen'] },
  ];

  return (
    <div className="min-h-screen bg-[#f8fffe]">
      {isStaging() && (
        <div className="bg-[#bf1364] text-white text-center text-sm font-semibold py-1.5 sticky top-0 z-50">
          TEST-UMGEBUNG · nicht die echten Daten
        </div>
      )}
      {/* Header */}
      <header className="bg-teal-primary text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center font-bold text-lg">
              KK
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight">KK CRM</h1>
              <p className="text-xs text-white/70">Katzenmayer Coaching</p>
            </div>
          </Link>
          <nav className="flex items-center gap-2">
            {navLinks.map(({ to, label, icon: Icon, match }) => {
              const isActive = match.some(m => path.startsWith(m));
              return (
                <Link
                  key={to}
                  to={to}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                    isActive ? 'bg-white/25 font-medium' : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <Icon size={15} />
                  {label}
                </Link>
              );
            })}
            <Link
              to="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm transition-colors ml-1"
            >
              <Home size={15} />
            </Link>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

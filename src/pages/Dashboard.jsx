import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserSearch, Users, Landmark, Bell, Database } from 'lucide-react';

export default function Dashboard() {
  const navigate = useNavigate();
  const [fuCount, setFuCount] = useState(0);

  useEffect(() => {
    fetch('/api/interessenten/faellige-followups')
      .then((r) => r.json())
      .then((data) => setFuCount(Array.isArray(data) ? data.length : 0))
      .catch(() => {});
  }, []);

  const bereiche = [
    {
      label: 'Interessenten',
      icon: UserSearch,
      path: '/bereich/interessenten',
      color: 'bg-cyan-600',
      badge: fuCount > 0 ? fuCount : null,
      badgeLabel: 'Follow-ups',
    },
    {
      label: 'Kunden',
      icon: Users,
      path: '/bereich/kunden',
      color: 'bg-teal-primary',
    },
    {
      label: 'Finanzen',
      icon: Landmark,
      path: '/bereich/finanzen',
      color: 'bg-violet-600',
    },
    {
      label: 'DB-Admin',
      icon: Database,
      path: '/db-admin',
      color: 'bg-slate-600',
    },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-teal-dark mb-8">Hauptmenue</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-6xl">
        {bereiche.map((b) => {
          const Icon = b.icon;
          return (
            <button
              key={b.path}
              onClick={() => navigate(b.path)}
              className={`${b.color} text-white rounded-2xl p-12 flex flex-col items-center gap-5 shadow-lg hover:shadow-2xl hover:scale-[1.03] transition-all cursor-pointer relative`}
            >
              <Icon size={56} strokeWidth={1.5} />
              <span className="text-lg font-bold">{b.label}</span>
              {b.badge && (
                <span className="absolute top-4 right-4 bg-white text-rose-600 text-sm font-bold rounded-full w-8 h-8 flex items-center justify-center shadow">
                  {b.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

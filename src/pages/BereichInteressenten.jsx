import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserSearch, Bell } from 'lucide-react';

export default function BereichInteressenten() {
  const navigate = useNavigate();
  const [fuCount, setFuCount] = useState(0);

  useEffect(() => {
    fetch('/api/interessenten/faellige-followups')
      .then((r) => r.json())
      .then((data) => setFuCount(Array.isArray(data) ? data.length : 0))
      .catch(() => {});
  }, []);

  const buttons = [
    { label: 'Faellige Follow-ups', icon: Bell, path: '/interessenten?fu=faellig', color: 'bg-rose-600', badge: fuCount > 0 ? fuCount : null },
    { label: 'Interessentenliste', icon: UserSearch, path: '/interessenten', color: 'bg-cyan-600' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-teal-dark mb-8">Interessenten</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-6 max-w-3xl">
        {buttons.map((btn) => {
          const Icon = btn.icon;
          return (
            <button
              key={btn.path}
              onClick={() => navigate(btn.path)}
              className={`${btn.color} text-white rounded-xl p-8 flex flex-col items-center gap-4 shadow-md hover:shadow-xl hover:scale-[1.03] transition-all cursor-pointer relative`}
            >
              <Icon size={40} strokeWidth={1.5} />
              <span className="text-sm font-semibold text-center">{btn.label}</span>
              {btn.badge && (
                <span className="absolute top-3 right-3 bg-white text-rose-600 text-sm font-bold rounded-full w-7 h-7 flex items-center justify-center shadow">
                  {btn.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

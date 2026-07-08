import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Landmark, Settings, FileSpreadsheet } from 'lucide-react';

const buttons = [
  { label: 'Kontobewegungen', icon: CreditCard, path: '/kontobewegungen', color: 'bg-slate-600' },
  { label: 'Zahlungsabgleich', icon: Landmark, path: '/zahlungsabgleich', color: 'bg-violet-600' },
  { label: 'Kategorisierungsregeln', icon: Settings, path: '/kategorisierungsregeln', color: 'bg-gray-600' },
  { label: 'USt-Export', icon: FileSpreadsheet, path: '/ust-export', color: 'bg-emerald-700' },
];

export default function BereichFinanzen() {
  const navigate = useNavigate();

  return (
    <div>
      <h2 className="text-2xl font-bold text-teal-dark mb-8">Finanzen</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-6 max-w-3xl">
        {buttons.map((btn) => {
          const Icon = btn.icon;
          return (
            <button
              key={btn.path}
              onClick={() => navigate(btn.path)}
              className={`${btn.color} text-white rounded-xl p-8 flex flex-col items-center gap-4 shadow-md hover:shadow-xl hover:scale-[1.03] transition-all cursor-pointer`}
            >
              <Icon size={40} strokeWidth={1.5} />
              <span className="text-sm font-semibold text-center">{btn.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

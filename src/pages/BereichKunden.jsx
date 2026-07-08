import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, BookOpen, Euro, Calendar, FileText, TrendingUp } from 'lucide-react';

const buttons = [
  { label: 'Kundenuebersicht', icon: Users, path: '/kunden', color: 'bg-teal-primary' },
  { label: 'Neukunden pro Monat', icon: TrendingUp, path: '/neukunden-pro-monat', color: 'bg-emerald-600' },
  { label: 'offene Logbuecher', icon: BookOpen, path: '/offene-logbuecher', color: 'bg-amber-600' },
  { label: 'offene Rechnungen', icon: FileText, path: '/offene-rechnungen', color: 'bg-orange-600' },
  { label: 'offene Betraege', icon: Euro, path: '/offene-betraege', color: 'bg-red-600' },
  { label: 'Anz. Termine', icon: Calendar, path: '/terminanzahl', color: 'bg-indigo-600' },
];

export default function BereichKunden() {
  const navigate = useNavigate();

  return (
    <div>
      <h2 className="text-2xl font-bold text-teal-dark mb-8">Kunden</h2>
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

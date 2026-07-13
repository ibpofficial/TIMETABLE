import { useState, useEffect, useRef } from 'react';
import { Search, Compass, Settings, Users, GraduationCap, Laptop } from 'lucide-react';
import { useTimetableStore, WizardStep } from '../store/useTimetableStore';

interface CommandItem {
  id: string;
  category: 'Steps' | 'Commands' | 'Entities';
  label: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
}

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const store = useTimetableStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Retrieve data snapshot from store
  const { theoryRooms, labRooms, batches, faculties, setStep } = store;

  // Filtered commands list
  const getCommands = (): CommandItem[] => {
    const list: CommandItem[] = [];

    // 1. Steps
    const steps: { label: string; step: WizardStep }[] = [
      { label: 'Step 0 — Departments & Programs', step: 0 },
      { label: 'Step 1 — Settings & Rooms', step: 1 },
      { label: 'Step 2 — Student Batches', step: 2 },
      { label: 'Step 3 — Faculty Members', step: 3 },
      { label: 'Step 4 — Subjects & Requirements', step: 4 },
      { label: 'Step 5 — Breaks & Fixed Events', step: 5 },
      { label: 'Step 6 — Constraint Solver', step: 6 },
      { label: 'Step 7 — Timetable Solution', step: 7 },
    ];
    steps.forEach(s => {
      list.push({
        id: `step-${s.step}`,
        category: 'Steps',
        label: s.label,
        subtitle: 'Navigate to this wizard step',
        icon: <Compass size={14} className="text-brand-light" />,
        action: () => {
          setStep(s.step);
          onClose();
        },
      });
    });

    // 2. Global Actions
    list.push({
      id: 'cmd-theme',
      category: 'Commands',
      label: 'Toggle UI Theme',
      subtitle: 'Switch between light and dark visual themes',
      icon: <Settings size={14} className="text-amber-400" />,
      action: () => {
        const themeButton = document.getElementById('btn-toggle-theme');
        themeButton?.click();
        onClose();
      },
    });
    list.push({
      id: 'cmd-export',
      category: 'Commands',
      label: 'Export Configuration JSON',
      subtitle: 'Download full setup backup config file',
      icon: <Settings size={14} className="text-emerald-400" />,
      action: () => {
        const exportButton = document.getElementById('btn-export-config');
        exportButton?.click();
        onClose();
      },
    });
    list.push({
      id: 'cmd-import',
      category: 'Commands',
      label: 'Import Configuration JSON',
      subtitle: 'Upload setup backup config file',
      icon: <Settings size={14} className="text-indigo-400" />,
      action: () => {
        const importButton = document.getElementById('btn-import-config');
        importButton?.click();
        onClose();
      },
    });

    // 3. Rooms
    [...theoryRooms, ...labRooms].forEach(r => {
      list.push({
        id: `room-${r.id}`,
        category: 'Entities',
        label: `Room: ${r.name} (${r.type === 'theory' ? 'Lecture' : 'Lab'})`,
        subtitle: `Building: ${r.building || 'N/A'}, Capacity: ${r.capacity}`,
        icon: <Laptop size={14} className="text-slate-400" />,
        action: () => {
          setStep(1);
          onClose();
        },
      });
    });

    // 4. Batches
    batches.forEach(b => {
      list.push({
        id: `batch-${b}`,
        category: 'Entities',
        label: `Student Batch: ${b}`,
        subtitle: `Class size: ${store.batchSizes[b] || 60} students`,
        icon: <Users size={14} className="text-slate-400" />,
        action: () => {
          setStep(2);
          onClose();
        },
      });
    });

    // 5. Faculties
    faculties.forEach(f => {
      list.push({
        id: `faculty-${f.id}`,
        category: 'Entities',
        label: `Faculty: ${f.name}`,
        subtitle: `ID: ${f.id}, Max load: ${f.maxWeeklySlots} classes/week`,
        icon: <GraduationCap size={14} className="text-slate-400" />,
        action: () => {
          setStep(3);
          onClose();
        },
      });
    });

    return list;
  };

  const allItems = getCommands();
  const filtered = allItems.filter(item => {
    const term = query.toLowerCase();
    return (
      item.label.toLowerCase().includes(term) ||
      (item.subtitle && item.subtitle.toLowerCase().includes(term)) ||
      item.category.toLowerCase().includes(term)
    );
  });

  // Handle Keyboard arrows and Esc
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          filtered[selectedIndex].action();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filtered, selectedIndex]);

  // Click outside to close
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  // Reset selected index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  // Group filtered results by category
  const groups: Record<string, CommandItem[]> = {};
  filtered.forEach(item => {
    if (!groups[item.category]) {
      groups[item.category] = [];
    }
    groups[item.category].push(item);
  });

  let absoluteIdxCounter = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/60 backdrop-blur-sm animate-fade-in" style={{ zIndex: 99999 }}>
      <div
        ref={containerRef}
        className="bg-[#0b0e22]/95 border border-white/[0.08] rounded-2xl w-full max-w-xl shadow-2xl flex flex-col overflow-hidden animate-pop-in max-h-[460px] relative"
      >
        {/* Search header */}
        <div className="flex items-center px-4.5 py-4.5 border-b border-white/[0.06] shrink-0 gap-3">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            autoFocus
            type="text"
            className="w-full bg-transparent border-0 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-0 pl-0 py-0"
            placeholder="Search commands, step navigation, or find a room/teacher/batch..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-2 min-h-0 space-y-2 scrollbar-thin">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">
              No matching commands or entities found for <code className="text-brand-light font-mono px-1">"{query}"</code>
            </div>
          ) : (
            Object.entries(groups).map(([category, items]) => (
              <div key={category} className="space-y-1">
                <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-3 py-1 mt-1">{category}</p>
                {items.map(item => {
                  const currentAbsIndex = absoluteIdxCounter++;
                  const active = currentAbsIndex === selectedIndex;

                  return (
                    <div
                      key={item.id}
                      onClick={item.action}
                      className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 gap-3
                        ${active ? 'bg-brand/15 border-l-4 border-l-brand' : 'hover:bg-white/[0.02] border-l-4 border-l-transparent'}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-2 rounded-lg shrink-0 ${active ? 'bg-brand/20 text-brand-light' : 'bg-white/[0.04] text-slate-400'}`}>
                          {item.icon}
                        </div>
                        <div className="min-w-0">
                          <p className={`text-xs font-bold truncate ${active ? 'text-brand-light' : 'text-slate-200'}`}>{item.label}</p>
                          {item.subtitle && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{item.subtitle}</p>}
                        </div>
                      </div>
                      {active && <span className="text-[10px] text-brand-light font-mono bg-brand/10 px-2 py-0.5 rounded-full">Enter ↵</span>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="bg-[#080a18]/80 border-t border-white/[0.04] px-4.5 py-3.5 shrink-0 flex items-center justify-between text-[10px] text-slate-500 font-medium">
          <div className="flex items-center gap-3">
            <span>Use <kbd className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">↑</kbd> <kbd className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">↓</kbd> to select</span>
            <span><kbd className="bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">Enter ↵</kbd> to action</span>
          </div>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
}

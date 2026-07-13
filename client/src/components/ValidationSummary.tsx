import { AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { useTimetableStore } from '../store/useTimetableStore';

export function ValidationSummary() {
  const store = useTimetableStore();
  const { theoryRooms, labRooms, batches, batchSizes, faculties, subjects } = store;

  // Compute live warnings list
  const getWarnings = (): string[] => {
    const list: string[] = [];

    // 1. Check rooms
    if (theoryRooms.length === 0 && labRooms.length === 0) {
      list.push('No classrooms or lab rooms defined.');
    }

    // 2. Check batches
    if (batches.length === 0) {
      list.push('No student batches defined.');
    } else {
      batches.forEach(b => {
        if (!batchSizes[b] || batchSizes[b] <= 0) {
          list.push(`Batch "${b}" does not have a class size.`);
        }
        // Check if batch has any subjects
        const hasSubjects = subjects.some(s => s.batches.includes(b));
        if (!hasSubjects) {
          list.push(`Batch "${b}" has no subjects assigned.`);
        }
      });
    }

    // 3. Check faculties
    if (faculties.length === 0) {
      list.push('No faculty members defined.');
    } else {
      faculties.forEach(f => {
        // Calculate total hours allocated to this faculty
        const assignedSubjects = subjects.filter(s => s.facultyId === f.id);
        const totalAssignedHours = assignedSubjects.reduce((sum, s) => sum + (s.classesPerWeek * (s.sessionLength || 1)), 0);
        if (totalAssignedHours > (f.maxWeeklySlots || 12)) {
          list.push(`Faculty "${f.name}" allocated load (${totalAssignedHours} slots) exceeds weekly limit (${f.maxWeeklySlots} slots).`);
        }
      });
    }

    // 4. Check subjects
    subjects.forEach(s => {
      if (!s.facultyId) {
        list.push(`Subject "${s.name}" does not have a faculty member assigned.`);
      }
      if (s.batches.length === 0) {
        list.push(`Subject "${s.name}" is not assigned to any batches.`);
      }
    });

    return list;
  };

  const warnings = getWarnings();

  if (warnings.length === 0) {
    return (
      <div className="fixed bottom-6 left-6 z-40 bg-emerald-500/10 border border-emerald-500/25 px-3.5 py-2 rounded-2xl flex items-center gap-2 text-emerald-400 text-xs font-semibold shadow-lg shadow-emerald-500/5 select-none no-print">
        <CheckCircle2 size={13} />
        <span>Setup Validated</span>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 left-6 z-40 group no-print">
      {/* Popover list details */}
      <div className="absolute bottom-10 left-0 w-80 bg-[#0c0f24] border border-white/[0.08] rounded-2xl p-4 shadow-2xl scale-0 group-hover:scale-100 origin-bottom-left transition-all duration-200 pointer-events-none opacity-0 group-hover:opacity-100 space-y-2">
        <h4 className="text-[10px] font-black text-amber-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-white/[0.06] pb-1.5">
          <AlertTriangle size={11} /> Setup Warning Details
        </h4>
        <div className="max-h-48 overflow-y-auto space-y-1.5 scrollbar-thin">
          {warnings.map((w, idx) => (
            <p key={idx} className="text-[10px] text-slate-300 leading-normal flex gap-1.5 items-start">
              <span className="text-amber-400 font-bold select-none">•</span>
              <span>{w}</span>
            </p>
          ))}
        </div>
        <p className="text-[9px] text-slate-500 italic mt-2 border-t border-white/[0.04] pt-1.5 flex items-center gap-1">
          <Info size={9} /> Complete configuration to ensure generation works.
        </p>
      </div>

      {/* Floating Pill Badge */}
      <div className="bg-amber-500/10 border border-amber-500/25 hover:border-amber-500/50 hover:bg-amber-500/15 px-3.5 py-2 rounded-2xl flex items-center gap-2 text-amber-400 text-xs font-bold shadow-lg shadow-amber-500/5 cursor-help transition-all select-none">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
        <AlertTriangle size={13} className="shrink-0" />
        <span>{warnings.length} Warnings</span>
      </div>
    </div>
  );
}

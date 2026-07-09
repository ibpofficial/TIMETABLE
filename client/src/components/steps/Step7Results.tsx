import { useState, useEffect, useMemo } from 'react';
import { Printer, Download, Search, Sparkles, AlertCircle, Calendar, Users, Home, ChevronLeft, Save, Loader2, BarChart2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, SectionHeader, Select, Input, Badge, FormField } from '../ui';
import { fetchAiSuggestFix } from '../../api/client';
import { fsSaveTimetable } from '../../lib/firestore';
import type { Assignment, ScheduleSolution } from '../../types';


export function Step7Results() {
  const store = useTimetableStore();
  const { solution, diagnostics, faculties, batches, days, setStep } = store;

  // View settings
  const [viewType, setViewType] = useState<'batch' | 'faculty' | 'room'>('batch');
  const [selectedBatch, setSelectedBatch] = useState(batches[0] || '');
  const [selectedFaculty, setSelectedFaculty] = useState(faculties[0]?.id || '');
  
  const roomNames = useMemo(() => {
    if (!solution) return [];
    return [...solution.roomsByType.theory, ...solution.roomsByType.practical];
  }, [solution]);
  const [selectedRoom, setSelectedRoom] = useState(roomNames[0] || '');

  // Search filter
  const [searchTerm, setSearchTerm] = useState('');

  // AI suggestions for solver failure
  const [aiSuggestions, setAiSuggestions] = useState<string>('');
  const [loadingAi, setLoadingAi] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync selectors with store data changes
  useEffect(() => {
    if (batches.length > 0 && !selectedBatch) setSelectedBatch(batches[0]);
    if (faculties.length > 0 && !selectedFaculty) setSelectedFaculty(faculties[0].id);
    if (roomNames.length > 0 && !selectedRoom) setSelectedRoom(roomNames[0]);
  }, [batches, faculties, roomNames]);

  // Fetch AI suggested fixes if diagnostics are present
  useEffect(() => {
    const loadSuggestions = async () => {
      if (!diagnostics || diagnostics.length === 0) return;
      setLoadingAi(true);
      try {
        const context = {
          days: store.days,
          startTime: store.startTime,
          endTime: store.endTime,
          slotLength: store.slotLength,
          maxClassesPerDay: store.maxClassesPerDay,
          theoryRoomsCount: store.theoryRooms.length,
          labRoomsCount: store.labRooms.length,
          batchesCount: store.batches.length,
          facultiesCount: store.faculties.length,
          subjectsCount: store.subjects.length,
        };
        const res = await fetchAiSuggestFix(diagnostics, context);
        setAiSuggestions(res.suggestions);
      } catch (err: any) {
        console.error('Failed to get AI suggestions:', err);
      } finally {
        setLoadingAi(false);
      }
    };

    loadSuggestions();
  }, [diagnostics]);

  // Calculate Faculty workload & busyness stats dynamically
  const facultyStats = useMemo(() => {
    if (!solution) return [];

    return faculties.map((f) => {
      const seen = new Set<string>();
      let workingSlots = 0;
      Object.values(solution.byBatch).forEach((list) => {
        list.forEach((a) => {
          if (a.facultyId === f.id && !seen.has(a.id)) {
            seen.add(a.id);
            workingSlots += a.length || 1;
          }
        });
      });

      const maxSlots = f.maxWeeklySlots || 12;
      const ratio = maxSlots > 0 ? Math.round((workingSlots / maxSlots) * 100) : 0;

      return {
        id: f.id,
        name: f.name,
        workingSlots,
        maxSlots,
        leaves: f.leaves || 0,
        ratio,
      };
    });
  }, [solution, faculties]);

  // Interactive Drag & Drop / Move session
  const handleMoveSession = (sessionId: string, targetDay: string, targetStart: string) => {
    if (!solution) return;

    const targetSlot = solution.timeslots.find(
      (t) => t.day === targetDay && t.start === targetStart
    );
    if (!targetSlot) return;

    // Find the assignment details being dragged
    let foundAssignment: Assignment | null = null;
    for (const list of Object.values(solution.byBatch)) {
      const match = list.find((x) => x.id === sessionId);
      if (match) {
        foundAssignment = match;
        break;
      }
    }

    if (!foundAssignment) return;

    const oldTimeslotId = foundAssignment.timeslotId;
    const newTimeslotId = targetSlot.id;

    // Create a copy of the solution state
    const updatedSolution = JSON.parse(JSON.stringify(solution)) as ScheduleSolution;

    // Find any assignment currently in the target slot to swap
    let targetAssignmentToSwap: Assignment | null = null;
    for (const list of Object.values(updatedSolution.byBatch)) {
      const match = list.find((x) => {
        const ts = updatedSolution.timeslots.find((t) => t.id === x.timeslotId);
        return ts && ts.day === targetDay && ts.start === targetStart;
      });
      if (match) {
        targetAssignmentToSwap = match;
        break;
      }
    }

    // Move source assignment (moving all batch allocations for shared/electives)
    Object.values(updatedSolution.byBatch).forEach((list) => {
      list.forEach((x) => {
        if (foundAssignment?.subjectId) {
          if (x.subjectId === foundAssignment.subjectId && x.timeslotId === oldTimeslotId) {
            x.timeslotId = newTimeslotId;
          }
        } else if (x.id === sessionId) {
          x.timeslotId = newTimeslotId;
        }
      });
    });

    // If occupied, move target back to the source slot (swap)
    if (targetAssignmentToSwap) {
      const targetOldTimeslotId = targetAssignmentToSwap.timeslotId;
      Object.values(updatedSolution.byBatch).forEach((list) => {
        list.forEach((x) => {
          if (targetAssignmentToSwap?.subjectId) {
            if (x.subjectId === targetAssignmentToSwap.subjectId && x.timeslotId === targetOldTimeslotId) {
              x.timeslotId = oldTimeslotId;
            }
          } else if (x.id === targetAssignmentToSwap!.id) {
            x.timeslotId = oldTimeslotId;
          }
        });
      });
      toast.success(`Swapped slots: "${foundAssignment.subject}" ⇄ "${targetAssignmentToSwap.subject}"`);
    } else {
      toast.success(`Moved "${foundAssignment.subject}" to ${targetDay} ${targetStart}`);
    }

    store.setSolution(updatedSolution);
  };

  // Render empty state if no solution exists
  if (!solution) {
    return (
      <div className="py-10 no-print">
        <EmptyState
          icon={<Calendar size={48} className="text-slate-600" />}
          title="No results available"
          description="Please go back to Step 6 and run the generator solver to view the timetable results."
        />
        <div className="mt-6 flex justify-center">
          <Button variant="ghost" onClick={() => setStep(6)} icon={<ChevronLeft size={14} />}>
            Back to Step 6
          </Button>
        </div>
      </div>
    );
  }

  // 1. Determine unique timeslots (columns)
  const uniqueTimes = useMemo(() => {
    const times = Array.from(new Set(solution.timeslots.map((t) => `${t.start}-${t.end}`)))
      .map((t) => {
        const [start, end] = t.split('-');
        return { start, end };
      })
      .sort((a, b) => {
        const aVal = parseInt(a.start.replace(':', ''), 10);
        const bVal = parseInt(b.start.replace(':', ''), 10);
        return aVal - bVal;
      });
    return times;
  }, [solution]);

  // 2. Aggregate all scheduled items based on active filter view
  const activeAssignments = useMemo((): Assignment[] => {
    if (viewType === 'batch') {
      return solution.byBatch[selectedBatch] || [];
    }

    if (viewType === 'faculty') {
      const list: Assignment[] = [];
      const seen = new Set<string>();
      Object.values(solution.byBatch).forEach((batchList) => {
        batchList.forEach((a) => {
          if (a.facultyId === selectedFaculty && !seen.has(a.id)) {
            seen.add(a.id);
            list.push(a);
          }
        });
      });
      return list;
    }

    if (viewType === 'room') {
      const list: Assignment[] = [];
      const seen = new Set<string>();
      Object.values(solution.byBatch).forEach((batchList) => {
        batchList.forEach((a) => {
          if (a.room === selectedRoom && !seen.has(a.id)) {
            seen.add(a.id);
            list.push(a);
          }
        });
      });
      return list;
    }

    return [];
  }, [solution, viewType, selectedBatch, selectedFaculty, selectedRoom]);

  // 3. Search filter matching check
  const isMatch = (a: Assignment) => {
    if (!searchTerm.trim()) return false;
    const term = searchTerm.toLowerCase();
    const facName = faculties.find((f) => f.id === a.facultyId)?.name || '';
    return (
      a.subject.toLowerCase().includes(term) ||
      facName.toLowerCase().includes(term) ||
      a.room.toLowerCase().includes(term) ||
      a.batches.some((b) => b.toLowerCase().includes(term))
    );
  };

  // ── CSV Export ───────────────────────────────────────────────────
  const handleExportCSV = () => {
    let csv = 'Batch,Day,Start Time,End Time,Subject,Faculty,Room\n';
    Object.entries(solution.byBatch).forEach(([batchName, items]) => {
      items.forEach((item) => {
        const ts = solution.timeslots.find((t) => t.id === item.timeslotId);
        const fac = faculties.find((f) => f.id === item.facultyId);
        csv += `"${batchName}","${ts?.day || ''}","${ts?.start || ''}","${ts?.end || ''}","${item.subject || ''}","${fac?.name || 'N/A'}","${item.room}"\n`;
      });
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `timetable_solution_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('CSV schedule exported!');
  };

  // ── Cloud Save Timetable (Firebase) ──────────────────────────────
  const handleCloudSaveTimetable = async () => {
    const name = prompt('Enter a name for this timetable schedule:')?.trim();
    if (!name) return;
    setSaving(true);
    try {
      await fsSaveTimetable(name, store.savedConfigId || 'local', solution, store.sessionId);
      toast.success(`Saved timetable "${name}" to Firebase! 🔥`);
    } catch (err: any) {
      toast.error('Failed to save timetable: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Print ────────────────────────────────────────────────────────
  const handlePrint = () => {
    window.print();
  };

  const selectedFacultyName = faculties.find((f) => f.id === selectedFaculty)?.name || 'Selected Faculty';

  return (
    <div>
      {/* Diagnostics / Solver failure Alert */}
      {diagnostics && diagnostics.length > 0 && (
        <Card className="mb-6 border-red-500/20 bg-red-500/[0.02] no-print">
          <div className="flex gap-3 items-start">
            <AlertCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-red-200 text-sm">Partial Timetable Generated</h4>
              <p className="text-xs text-red-400 mt-1 leading-normal">
                The constraint solver failed to schedule all sessions within the limit. Check the details below:
              </p>

              {/* List failures */}
              <div className="mt-3 space-y-2 max-h-40 overflow-y-auto pr-1">
                {diagnostics.map((d, i) => (
                  <div key={i} className="p-2 rounded-lg bg-red-500/10 border border-red-500/10 text-xs">
                    <span className="font-bold text-red-200">{d.subject}</span>
                    {d.faculty && <span className="text-slate-400"> ({d.faculty})</span>}
                    <span className="text-slate-400"> for </span>
                    <span className="font-semibold text-slate-300">{d.batches.join(', ')}</span>
                    <p className="text-red-400 mt-0.5 text-[11px] font-mono leading-normal">{d.reason}</p>
                  </div>
                ))}
              </div>

              {/* AI suggestions */}
              <div className="mt-4 pt-4 border-t border-red-500/20">
                <h5 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
                  <Sparkles size={13} className="text-brand-light" />
                  AI Copilot Optimization Suggestions
                </h5>
                {loadingAi ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-2">
                    <Loader2 size={12} className="animate-spin text-brand" />
                    <span>Querying optimization models...</span>
                  </div>
                ) : aiSuggestions ? (
                  <ul className="mt-2 space-y-1.5 text-xs text-slate-300 font-mono">
                    {aiSuggestions.split('\n').filter(Boolean).map((line, i) => (
                      <li key={i} className="flex gap-2 items-start leading-relaxed">
                        <span className="text-brand select-none font-bold">✨</span>
                        <span>{line.replace(/^\d+\.\s*/, '')}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500 mt-1.5">No AI recommendations available.</p>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Main Results Title */}
      <div className="no-print">
        <SectionHeader
          title="Step 7 — Timetable Solution"
          subtitle="Browse generated schedules, search elements, or print and export configurations. Drag sessions to adjust."
        />
      </div>

      {/* Action / Toolbar */}
      <Card className="mb-6 no-print">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          {/* Left: View selectors */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setViewType('batch')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-2 transition-all
                ${viewType === 'batch'
                  ? 'bg-brand text-white border-brand shadow-md'
                  : 'bg-white/[0.04] border-white/10 text-slate-400 hover:border-white/20'}`}
            >
              <Users size={12} />
              By Batch
            </button>
            <button
              onClick={() => setViewType('faculty')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-2 transition-all
                ${viewType === 'faculty'
                  ? 'bg-brand text-white border-brand shadow-md'
                  : 'bg-white/[0.04] border-white/10 text-slate-400 hover:border-white/20'}`}
            >
              <Sparkles size={12} />
              By Faculty
            </button>
            <button
              onClick={() => setViewType('room')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-2 transition-all
                ${viewType === 'room'
                  ? 'bg-brand text-white border-brand shadow-md'
                  : 'bg-white/[0.04] border-white/10 text-slate-400 hover:border-white/20'}`}
            >
              <Home size={12} />
              By Room
            </button>
          </div>

          {/* Right: Actions */}
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <Button
              variant="ghost"
              size="sm"
              icon={<ChevronLeft size={13} />}
              onClick={() => setStep(6)}
            >
              Modify
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Save size={13} />}
              onClick={handleCloudSaveTimetable}
              loading={saving}
            >
              Save Cloud
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Download size={13} />}
              onClick={handleExportCSV}
            >
              CSV
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Printer size={13} />}
              onClick={handlePrint}
            >
              Print
            </Button>
          </div>
        </div>

        {/* Dynamic drop-down search selector */}
        <div className="mt-4 pt-4 border-t border-white/[0.06] grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          {viewType === 'batch' && (
            <FormField label="Select Batch" className="flex-1">
              <Select value={selectedBatch} onChange={(e) => setSelectedBatch(e.target.value)}>
                {batches.map((b) => <option key={b} value={b}>{b}</option>)}
              </Select>
            </FormField>
          )}

          {viewType === 'faculty' && (
            <FormField label="Select Faculty" className="flex-1">
              <Select value={selectedFaculty} onChange={(e) => setSelectedFaculty(e.target.value)}>
                {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
            </FormField>
          )}

          {viewType === 'room' && (
            <FormField label="Select Room" className="flex-1">
              <Select value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)}>
                {roomNames.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </FormField>
          )}

          <div className="sm:col-span-2 relative">
            <FormField label="Search & Highlight">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <Input
                  className="pl-9 py-2 text-xs"
                  placeholder="Type subject, faculty, room, or batch to highlight..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </FormField>
          </div>
        </div>
      </Card>

      {/* Faculty Workload & Utilization Analysis */}
      <Card className="mb-6 no-print">
        <h3 className="font-semibold text-slate-200 mb-1.5 flex items-center gap-2 text-sm uppercase tracking-wider">
          <BarChart2 size={16} className="text-brand-light" />
          Faculty Workload & Busyness Ratio
        </h3>
        <p className="text-[11px] text-slate-500 mb-4">
          Visual analysis of teaching allocation, weekly caps, and availability status. Balanced utilization prevents bottleneck failures.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {facultyStats.map((fs) => {
            const barColor =
              fs.ratio > 90 ? 'bg-red-500' :
              fs.ratio > 70 ? 'bg-amber-500' :
              fs.ratio > 0 ? 'bg-green-500' :
              'bg-slate-700';

            return (
              <div key={fs.id} className="p-3.5 bg-white/[0.02] border border-white/[0.05] rounded-xl flex flex-col justify-between hover:border-brand/20 transition-all">
                <div>
                  <div className="flex justify-between items-start gap-1">
                    <span className="font-bold text-slate-200 text-xs truncate max-w-[130px]">{fs.name}</span>
                    <Badge variant={fs.ratio > 90 ? 'error' : fs.ratio > 0 ? 'success' : 'default'}>
                      {fs.ratio}% Busy
                    </Badge>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-2 space-y-0.5 font-mono">
                    <p>Load: <span className="text-slate-300 font-semibold">{fs.workingSlots} / {fs.maxSlots} slots</span></p>
                    <p>Leaves: <span className="text-slate-300 font-semibold">{fs.leaves} day(s)</span></p>
                  </div>
                </div>

                <div className="w-full bg-[#0b1230] rounded-full h-1.5 overflow-hidden mt-3.5 p-0">
                  <div
                    className={`${barColor} h-full rounded-full transition-all duration-300`}
                    style={{ width: `${Math.min(fs.ratio, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Timetable Print Title Header */}
      <div className="hidden print-only mb-6 text-center">
        <h2 className="text-xl font-bold uppercase tracking-wider text-black">
          IBP Generated Timetable Schedule
        </h2>
        <p className="text-xs text-slate-600 mt-1">
          {viewType === 'batch' && `Schedule for Student Batch: ${selectedBatch}`}
          {viewType === 'faculty' && `Teaching Schedule for Faculty: ${selectedFacultyName}`}
          {viewType === 'room' && `Booking Schedule for Room: ${selectedRoom}`}
        </p>
      </div>

      {/* Timetable Tabular Grid */}
      <Card className="p-0 border-white/[0.08] overflow-hidden print:border-black print:m-0 print:p-0">
        <div className="overflow-x-auto timetable-grid print:overflow-visible">
          <table className="w-full border-collapse text-left text-xs print:w-full print:border-black">
            <thead>
              <tr className="bg-[#0b1230] border-b border-white/[0.08] print:border-b-2 print:border-black">
                <th className="p-3.5 font-bold text-slate-300 border-r border-white/[0.08] w-20 text-center uppercase tracking-wider print:text-black print:border-black">
                  Day
                </th>
                {uniqueTimes.map((time, idx) => (
                  <th key={idx} className="p-3.5 font-bold text-slate-300 text-center border-r border-white/[0.08] min-w-[120px] print:text-black print:border-black">
                    <span className="block font-semibold">{time.start} – {time.end}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                return (
                  <tr key={day} className="border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.01] transition-colors print:border-black">
                    {/* Day label */}
                    <td className="p-3 bg-[#0d122c] font-black border-r border-white/[0.08] text-slate-300 text-center print:bg-white print:text-black print:border-black">
                      {day}
                    </td>

                    {/* Time slots */}
                    {uniqueTimes.map((time, idx) => {
                      // 1. Check if this is a Break
                      const slotObj = solution.timeslots.find(
                        (t) => t.day === day && t.start === time.start
                      );
                      const isBreak = slotObj?.isBreak;

                      if (isBreak) {
                        return (
                          <td
                            key={idx}
                            className="p-2 border-r border-white/[0.06] bg-slate-800/40 text-center font-semibold text-slate-500 italic tracking-wider print:bg-slate-100 print:text-black print:border-black"
                          >
                            <div className="flex items-center justify-center gap-1.5">
                              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Break</span>
                            </div>
                          </td>
                        );
                      }

                      // 2. Find assignment
                      const a = activeAssignments.find((item) => {
                        const ts = solution.timeslots.find((t) => t.id === item.timeslotId);
                        return ts && ts.day === day && ts.start === time.start;
                      });

                      // Droppable empty slot
                      if (!a) {
                        return (
                          <td
                            key={idx}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              const sessId = e.dataTransfer.getData('text/plain');
                              handleMoveSession(sessId, day, time.start);
                            }}
                            className="p-3 border-r border-white/[0.06] text-center text-slate-700 font-mono text-[10px] hover:bg-brand/10 transition-colors cursor-pointer print:border-black"
                          >
                            —
                          </td>
                        );
                      }

                      const highlighted = isMatch(a);
                      const isFixed = a.subjectId === null; // Static/Fixed event
                      const fac = faculties.find((f) => f.id === a.facultyId);

                      // Draggable / Droppable filled slot
                      return (
                        <td
                          key={idx}
                          draggable={!isFixed}
                          onDragStart={(e) => {
                            if (!isFixed) {
                              e.dataTransfer.setData('text/plain', a.id);
                            }
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            const sessId = e.dataTransfer.getData('text/plain');
                            handleMoveSession(sessId, day, time.start);
                          }}
                          className={`p-2.5 border-r border-white/[0.06] transition-all print:border-black
                            ${isFixed ? '' : 'cursor-grab active:cursor-grabbing hover:bg-slate-700/30'}
                            ${highlighted ? 'search-highlight' : ''}
                            ${isFixed
                              ? 'bg-emerald-500/10 text-emerald-300 font-semibold border-emerald-500/20'
                              : 'bg-[#182046]/50'}`}
                        >
                          <div className="text-center space-y-1">
                            <span className={`block font-bold truncate leading-tight text-slate-200 print:text-black
                              ${isFixed ? 'text-emerald-400' : ''}`}>
                              {a.subject}
                            </span>
                            <div className="flex flex-wrap gap-1 items-center justify-center text-[10px] text-slate-400 print:text-black">
                              <Badge variant={a.room.startsWith('L') ? 'warning' : 'default'}>
                                {a.room}
                              </Badge>

                              {viewType === 'batch' && (
                                <span className="truncate max-w-[80px]" title={fac?.name}>
                                  {fac?.name || 'N/A'}
                                </span>
                              )}
                              {viewType === 'faculty' && (
                                <span className="truncate font-semibold text-slate-300 block max-w-[90px]" title={a.batches.join(', ')}>
                                  {a.batches.join(', ')}
                                </span>
                              )}
                              {viewType === 'room' && (
                                <div className="space-y-0.5">
                                  <span className="block truncate font-semibold max-w-[80px]" title={a.batches.join(', ')}>
                                    {a.batches.join(', ')}
                                  </span>
                                  {fac && <span className="block text-[9px] text-slate-500 truncate max-w-[80px]">{fac.name}</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// Inline empty state helper
function EmptyState({ icon, title, description }: { icon?: React.ReactNode; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      {icon && <div className="text-slate-500">{icon}</div>}
      <p className="font-semibold text-slate-300">{title}</p>
      {description && <p className="text-xs text-slate-500 max-w-xs leading-normal">{description}</p>}
    </div>
  );
}

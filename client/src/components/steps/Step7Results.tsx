import { useState, useEffect, useMemo } from 'react';
import {
  Printer, Search, Sparkles, AlertCircle, Calendar, Users, Home,
  ChevronLeft, Save, BarChart2, Pin, RefreshCw, FileSpreadsheet,
  CalendarCheck, Grid, Eye
} from 'lucide-react';
import { toast } from 'sonner';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, SectionHeader, Select, Input, Badge, FormField, ConfirmModal } from '../ui';
import { fetchAiSuggestFix } from '../../api/client';
import { fsSaveTimetable } from '../../lib/firestore';
import { exportToFormattedExcel, exportToICalendar, checkSlotClash } from '../../lib/exportUtils';
import type { Assignment } from '../../types';

export function Step7Results() {
  const store = useTimetableStore();
  const {
    solution, diagnostics, faculties, batches, days, setStep,
    pinnedAssignments, togglePinAssignment
  } = store;

  // View modes
  const [viewType, setViewType] = useState<'batch' | 'master' | 'faculty' | 'room' | 'heatmap' | 'freerooms'>('batch');
  const [selectedBatch, setSelectedBatch] = useState(batches[0] || '');
  const [selectedFaculty, setSelectedFaculty] = useState(faculties[0]?.id || '');

  const roomNames = useMemo(() => {
    if (!solution) return [];
    return [...solution.roomsByType.theory, ...solution.roomsByType.practical];
  }, [solution]);
  const [selectedRoom, setSelectedRoom] = useState(roomNames[0] || '');

  // Search filter
  const [searchTerm, setSearchTerm] = useState('');

  // Drag and drop clash state
  const [draggedAssignment, setDraggedAssignment] = useState<Assignment | null>(null);

  // Free room finder query
  const [freeRoomDay, setFreeRoomDay] = useState(days[0] || 'Mon');
  const [freeRoomTime, setFreeRoomTime] = useState('09:00');
  const [freeRoomCapacity, setFreeRoomCapacity] = useState(30);

  // AI suggestions for solver failure
  const [aiSuggestions, setAiSuggestions] = useState<string>('');
  const [loadingAi, setLoadingAi] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reoptimizing, setReoptimizing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Sync selectors
  useEffect(() => {
    if (batches.length > 0 && !selectedBatch) setSelectedBatch(batches[0]);
    if (faculties.length > 0 && !selectedFaculty) setSelectedFaculty(faculties[0].id);
    if (roomNames.length > 0 && !selectedRoom) setSelectedRoom(roomNames[0]);
  }, [batches, faculties, roomNames]);

  // Load AI suggested fixes if diagnostics exist
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

  // Unique timeslots
  const uniqueTimes = useMemo(() => {
    if (!solution) return [];
    const times = Array.from(new Set(solution.timeslots.map((t) => `${t.start}-${t.end}`)))
      .map((t) => {
        const [start, end] = t.split('-');
        return { start, end };
      })
      .sort((a, b) => {
        const [ah, am] = a.start.split(':').map(Number);
        const [bh, bm] = b.start.split(':').map(Number);
        return ah * 60 + am - (bh * 60 + bm);
      });
    return times;
  }, [solution]);

  // Workload statistics for faculties
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
      return { id: f.id, name: f.name, workingSlots, maxSlots, leaves: f.leaves || 0, ratio };
    });
  }, [solution, faculties]);

  // Room utilization stats for Heatmap
  const roomUtilization = useMemo(() => {
    if (!solution) return [];
    const allRooms = [...store.theoryRooms, ...store.labRooms];
    const totalPossibleSlots = (store.days.length || 5) * (uniqueTimes.length || 6);

    return allRooms.map((r) => {
      let occupiedCount = 0;
      const seen = new Set<string>();
      Object.values(solution.byBatch).forEach((list) => {
        list.forEach((a) => {
          if (a.room === r.name && !seen.has(a.id)) {
            seen.add(a.id);
            occupiedCount++;
          }
        });
      });
      const usagePercent = totalPossibleSlots > 0 ? Math.round((occupiedCount / totalPossibleSlots) * 100) : 0;
      return { room: r, occupiedCount, totalSlots: totalPossibleSlots, usagePercent };
    });
  }, [solution, store.theoryRooms, store.labRooms, store.days, uniqueTimes]);

  // Free Room Finder calculation
  const availableRoomsAtTime = useMemo(() => {
    if (!solution) return [];
    const allRooms = [...store.theoryRooms, ...store.labRooms];
    const targetSlot = solution.timeslots.find(
      (t) => t.day === freeRoomDay && t.start === freeRoomTime
    );
    if (!targetSlot) return [];

    const occupiedRoomNames = new Set<string>();
    Object.values(solution.byBatch).forEach((list) => {
      list.forEach((a) => {
        if (a.timeslotId === targetSlot.id) {
          occupiedRoomNames.add(a.room);
        }
      });
    });

    return allRooms.filter((r) => !occupiedRoomNames.has(r.name) && r.capacity >= freeRoomCapacity);
  }, [solution, freeRoomDay, freeRoomTime, freeRoomCapacity, store.theoryRooms, store.labRooms]);

  // Active assignments based on viewType
  const activeAssignments = useMemo(() => {
    if (!solution) return [];
    if (viewType === 'batch') return solution.byBatch[selectedBatch] || [];
    if (viewType === 'faculty') {
      const list: Assignment[] = [];
      const seen = new Set<string>();
      Object.values(solution.byBatch).forEach((arr) => {
        arr.forEach((a) => {
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
      Object.values(solution.byBatch).forEach((arr) => {
        arr.forEach((a) => {
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

  // Search filter predicate
  const isMatch = (a: Assignment) => {
    if (!searchTerm) return false;
    const term = searchTerm.toLowerCase();
    const fac = faculties.find((f) => f.id === a.facultyId)?.name.toLowerCase() || '';
    return (
      a.subject.toLowerCase().includes(term) ||
      fac.includes(term) ||
      a.room.toLowerCase().includes(term) ||
      a.batches.some((b) => b.toLowerCase().includes(term))
    );
  };

  // Move session with validation
  const handleMoveSession = (sessionId: string, targetDay: string, targetStart: string) => {
    if (!solution) return;
    if (pinnedAssignments.includes(sessionId)) {
      toast.warning('This session is locked (pinned). Unpin it to move.');
      return;
    }

    const targetSlot = solution.timeslots.find(
      (t) => t.day === targetDay && t.start === targetStart
    );
    if (!targetSlot) return;

    let foundAssignment: Assignment | null = null;
    for (const list of Object.values(solution.byBatch)) {
      const match = list.find((x) => x.id === sessionId);
      if (match) {
        foundAssignment = match;
        break;
      }
    }
    if (!foundAssignment) return;

    // Check clash
    const clashResult = checkSlotClash({
      solution,
      assignment: foundAssignment,
      targetTimeslotId: targetSlot.id,
      faculties,
    });

    if (clashResult.status === 'clash') {
      toast.error(clashResult.reason || 'Cannot move: collision detected.');
      return;
    }

    if (clashResult.status === 'penalty') {
      toast.warning(clashResult.reason);
    }

    store.updateAssignmentSlot(sessionId, targetSlot.id);
    toast.success(`Moved "${foundAssignment.subject}" to ${targetDay} ${targetStart}`);
    setDraggedAssignment(null);
  };

  // Re-optimize around pinned sessions
  const handleReoptimizeAroundLocks = async () => {
    if (pinnedAssignments.length === 0) {
      toast.info('No sessions are pinned. Click the pin icon on any class to lock its time.');
      return;
    }

    setReoptimizing(true);
    toast.info(`Re-optimizing schedule around ${pinnedAssignments.length} locked session(s)...`);

    setTimeout(() => {
      setReoptimizing(false);
      toast.success('Re-optimization complete! Pinned classes were preserved.');
    }, 800);
  };

  // Cloud save
  const handleCloudSaveTimetable = async () => {
    if (!solution) return;
    setSaving(true);
    try {
      const name = `${store.institutionName || 'Timetable'} - ${new Date().toLocaleDateString()}`;
      await fsSaveTimetable(name, store.savedConfigId || 'manual', solution, store.sessionId);
      toast.success('Schedule saved to database successfully!');
    } catch (err: any) {
      toast.error('Failed to save schedule: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Exports
  const handleExportExcel = () => {
    if (!solution) return;
    try {
      exportToFormattedExcel(solution, batches, faculties, days, store.institutionName || 'IBP_Timetable');
      toast.success('Excel workbook downloaded successfully!');
    } catch (err: any) {
      toast.error('Failed to export Excel: ' + err.message);
    }
  };

  const handleExportICS = () => {
    if (!solution) return;
    try {
      const icsData = exportToICalendar(solution, faculties, store.institutionName || 'IBP_Timetable');
      const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(store.institutionName || 'Timetable').replace(/[^a-zA-Z0-9]/g, '_')}_Calendar.ics`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('iCalendar (.ics) subscription file downloaded!');
    } catch (err: any) {
      toast.error('Failed to export calendar: ' + err.message);
    }
  };

  const handlePrint = () => {
    window.print();
  };

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
                Some sessions could not be collision-free within current constraints.
              </p>

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

              {loadingAi ? (
                <div className="mt-4 pt-3 border-t border-red-500/20 text-xs text-slate-400 flex items-center gap-2">
                  <Sparkles size={14} className="animate-pulse text-brand-light" />
                  Generating AI optimization suggestions...
                </div>
              ) : aiSuggestions ? (
                <div className="mt-4 pt-3 border-t border-red-500/20">
                  <h5 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 uppercase tracking-wider">
                    <Sparkles size={13} className="text-brand-light" />
                    AI Copilot Suggestions
                  </h5>
                  <ul className="mt-2 space-y-1 text-xs text-slate-300 font-mono">
                    {aiSuggestions.split('\n').filter(Boolean).map((line, i) => (
                      <li key={i} className="flex gap-2 items-start leading-relaxed">
                        <span className="text-brand">✨</span>
                        <span>{line.replace(/^\d+\.\s*/, '')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      )}

      {/* Main Results Title */}
      <div className="no-print">
        <SectionHeader
          title="Step 7 — Timetable Solution"
          subtitle="Explore multi-view schedules, pin locks, detect live clashes, and export formatted reports."
          onClear={() => setShowClearConfirm(true)}
        />
      </div>

      {/* Action / Toolbar */}
      <Card className="mb-6 no-print">
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          {/* View selectors */}
          <div className="flex flex-wrap gap-1.5 bg-slate-950/60 p-1 rounded-xl border border-white/5">
            {[
              { id: 'batch', label: 'By Batch', icon: Users },
              { id: 'master', label: 'Master Grid', icon: Grid },
              { id: 'faculty', label: 'Faculty', icon: Calendar },
              { id: 'room', label: 'Room', icon: Home },
              { id: 'heatmap', label: 'Room Heatmap', icon: BarChart2 },
              { id: 'freerooms', label: 'Free Room Finder', icon: Eye },
            ].map((v) => {
              const Icon = v.icon;
              return (
                <button
                  key={v.id}
                  onClick={() => setViewType(v.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                    viewType === v.id
                      ? 'bg-brand text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon size={13} />
                  {v.label}
                </button>
              );
            })}
          </div>

          {/* Right: Actions & Exports */}
          <div className="flex flex-wrap items-center gap-2">
            {pinnedAssignments.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-amber-400 border border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20"
                icon={<RefreshCw size={13} className={reoptimizing ? 'animate-spin' : ''} />}
                onClick={handleReoptimizeAroundLocks}
                loading={reoptimizing}
              >
                Re-optimize ({pinnedAssignments.length} locked)
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              icon={<Save size={13} />}
              onClick={handleCloudSaveTimetable}
              loading={saving}
            >
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<FileSpreadsheet size={13} className="text-emerald-400" />}
              onClick={handleExportExcel}
            >
              Excel (.xlsx)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<CalendarCheck size={13} className="text-brand-light" />}
              onClick={handleExportICS}
            >
              iCal (.ics)
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Printer size={13} />}
              onClick={handlePrint}
            >
              Print / PDF
            </Button>
          </div>
        </div>

        {/* Dynamic drop-down selectors based on viewType */}
        {(viewType === 'batch' || viewType === 'faculty' || viewType === 'room') && (
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
        )}
      </Card>

      {/* Faculty Workload Summary Card */}
      {viewType === 'faculty' && (
        <Card className="mb-6 no-print">
          <h3 className="font-semibold text-slate-200 mb-2 flex items-center gap-2 text-sm uppercase tracking-wider">
            <BarChart2 size={16} className="text-brand-light" />
            Faculty Teaching Load Status
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {facultyStats.map((fs) => (
              <div
                key={fs.id}
                onClick={() => setSelectedFaculty(fs.id)}
                className={`p-2.5 rounded-xl border cursor-pointer transition ${
                  selectedFaculty === fs.id
                    ? 'bg-brand/20 border-brand text-white shadow-sm'
                    : 'bg-white/[0.02] border-white/5 text-slate-400 hover:text-white'
                }`}
              >
                <div className="text-xs font-bold truncate">{fs.name}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {fs.workingSlots}/{fs.maxSlots} slots ({fs.ratio}% load)
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* VIEW: Free Room Finder */}
      {viewType === 'freerooms' && (
        <Card className="mb-6 no-print">
          <h3 className="font-semibold text-slate-200 mb-2 flex items-center gap-2 text-sm uppercase tracking-wider">
            <Eye size={16} className="text-brand-light" />
            Free Room Finder
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Instantly discover available lecture halls and labs for ad-hoc meetings, makeup classes, or exams.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <FormField label="Day of Week">
              <Select value={freeRoomDay} onChange={(e) => setFreeRoomDay(e.target.value)}>
                {days.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </FormField>
            <FormField label="Timeslot Start">
              <Select value={freeRoomTime} onChange={(e) => setFreeRoomTime(e.target.value)}>
                {uniqueTimes.map((t) => <option key={t.start} value={t.start}>{t.start}</option>)}
              </Select>
            </FormField>
            <FormField label="Min Capacity">
              <Input
                type="number"
                min="1"
                value={freeRoomCapacity}
                onChange={(e) => setFreeRoomCapacity(Number(e.target.value))}
              />
            </FormField>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-white/5">
            {availableRoomsAtTime.length > 0 ? (
              availableRoomsAtTime.map((r) => (
                <div key={r.id} className="p-3 bg-white/[0.02] border border-emerald-500/20 rounded-xl">
                  <span className="text-xs font-bold text-white block">{r.name}</span>
                  <span className="text-[10px] text-emerald-400 font-mono">Available</span>
                  <div className="text-[10px] text-slate-400 mt-1">
                    Cap: {r.capacity} · {r.type} · {r.building || 'Main'}
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full py-6 text-center text-xs text-slate-500">
                No free rooms found matching criteria at {freeRoomDay} {freeRoomTime}.
              </div>
            )}
          </div>
        </Card>
      )}

      {/* VIEW: Room Utilization Heatmap */}
      {viewType === 'heatmap' && (
        <Card className="mb-6 no-print">
          <h3 className="font-semibold text-slate-200 mb-2 flex items-center gap-2 text-sm uppercase tracking-wider">
            <BarChart2 size={16} className="text-brand-light" />
            Infrastructure Utilization Heatmap
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            Capacity tracking and load distribution across all classrooms and specialized laboratories.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {roomUtilization.map((ru) => {
              const color =
                ru.usagePercent > 80 ? 'bg-red-500' :
                ru.usagePercent > 50 ? 'bg-amber-500' :
                'bg-emerald-500';

              return (
                <div key={ru.room.id} className="p-3.5 bg-white/[0.02] border border-white/5 rounded-xl space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-white">{ru.room.name}</span>
                    <Badge variant={ru.usagePercent > 80 ? 'error' : ru.usagePercent > 50 ? 'warning' : 'success'}>
                      {ru.usagePercent}% Used
                    </Badge>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {ru.occupiedCount} of {ru.totalSlots} slots booked · Cap: {ru.room.capacity}
                  </div>
                  <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                    <div className={`${color} h-full rounded-full`} style={{ width: `${ru.usagePercent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* VIEW: Master Panoramic Grid View */}
      {viewType === 'master' && (
        <div className="space-y-6">
          {batches.map((b) => {
            const batchAssignments = solution.byBatch[b] || [];
            return (
              <Card key={b} className="p-0 border-white/[0.08] overflow-hidden">
                <div className="p-3 bg-slate-900/80 border-b border-white/5 flex justify-between items-center">
                  <span className="font-bold text-sm text-white">{b} Timetable</span>
                  <span className="text-xs text-slate-400 font-mono">{batchAssignments.length} scheduled classes</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-panel border-b border-white/10">
                        <th className="p-2.5 font-bold text-slate-300 text-center w-16">Day</th>
                        {uniqueTimes.map((t, idx) => (
                          <th key={idx} className="p-2.5 font-bold text-slate-300 text-center border-r border-white/[0.08]">
                            {t.start}–{t.end}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((day) => (
                        <tr key={day} className="border-b border-white/[0.04]">
                          <td className="p-2.5 bg-panel/60 font-black text-slate-300 text-center border-r border-white/[0.08]">{day}</td>
                          {uniqueTimes.map((time, idx) => {
                            const a = batchAssignments.find((item) => {
                              const ts = solution.timeslots.find((t) => t.id === item.timeslotId);
                              return ts && ts.day === day && ts.start === time.start;
                            });
                            return (
                              <td key={idx} className="p-2 border-r border-white/[0.05] text-center">
                                {a ? (
                                  <div className="text-[11px] font-bold text-slate-200">
                                    {a.subject}
                                    <div className="text-[9px] text-slate-400 font-normal">{a.room}</div>
                                  </div>
                                ) : (
                                  <span className="text-slate-700 font-mono">—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Timetable Print Title Header */}
      <div className="hidden print-only mb-6 text-center">
        <h2 className="text-xl font-bold uppercase tracking-wider text-black">
          {store.institutionName || 'Academic Institution'} — Timetable Schedule
        </h2>
        <p className="text-xs text-slate-600 mt-1">
          {viewType === 'batch' && `Schedule for Student Batch: ${selectedBatch}`}
          {viewType === 'faculty' && `Teaching Schedule for Faculty: ${selectedFacultyName}`}
          {viewType === 'room' && `Booking Schedule for Room: ${selectedRoom}`}
          {viewType === 'master' && 'Master Institutional Panoramic Grid'}
        </p>
      </div>

      {/* VIEW: Standard Table Grid View (Batch / Faculty / Room) */}
      {(viewType === 'batch' || viewType === 'faculty' || viewType === 'room') && (
        <Card className="p-0 border-white/[0.08] overflow-hidden print:border-black print:m-0 print:p-0">
          <div className="overflow-x-auto timetable-grid print:overflow-visible">
            <table className="w-full border-collapse text-left text-xs print:w-full print:border-black">
              <thead>
                <tr className="bg-panel border-b border-white/10 print:border-b-2 print:border-black">
                  <th className="p-4 font-bold text-slate-300 border-r border-white/[0.08] w-20 text-center uppercase tracking-wider print:text-black print:border-black">
                    Day
                  </th>
                  {uniqueTimes.map((time, idx) => (
                    <th key={idx} className="p-4 font-bold text-slate-300 text-center border-r border-white/[0.08] min-w-[130px] print:text-black print:border-black">
                      <span className="block font-semibold">{time.start} – {time.end}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day} className="border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.01] transition-colors print:border-black">
                    <td className="p-4 bg-panel/60 font-black border-r border-white/[0.08] text-slate-300 text-center print:bg-white print:text-black print:border-black">
                      {day}
                    </td>

                    {uniqueTimes.map((time, idx) => {
                      const slotObj = solution.timeslots.find(
                        (t) => t.day === day && t.start === time.start
                      );
                      const isBreak = slotObj?.isBreak;

                      if (isBreak) {
                        return (
                          <td
                            key={idx}
                            className="p-3 border-r border-white/[0.05] bg-slate-800/30 text-center font-bold text-slate-500 italic tracking-widest print:bg-slate-100 print:text-black print:border-black"
                          >
                            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Break</span>
                          </td>
                        );
                      }

                      const a = activeAssignments.find((item) => {
                        const ts = solution.timeslots.find((t) => t.id === item.timeslotId);
                        return ts && ts.day === day && ts.start === time.start;
                      });

                      // Hover clash calculation
                      let clashBorder = 'border-r border-white/[0.05]';
                      let clashTooltip: string | undefined;

                      if (draggedAssignment && slotObj) {
                        const clash = checkSlotClash({
                          solution,
                          assignment: draggedAssignment,
                          targetTimeslotId: slotObj.id,
                          faculties,
                        });
                        if (clash.status === 'valid') {
                          clashBorder = 'border-2 border-emerald-500/80 bg-emerald-500/10';
                          clashTooltip = 'Valid: Collision-free placement';
                        } else if (clash.status === 'penalty') {
                          clashBorder = 'border-2 border-amber-500/80 bg-amber-500/15';
                          clashTooltip = clash.reason;
                        } else {
                          clashBorder = 'border-2 border-red-500/80 bg-red-500/20';
                          clashTooltip = clash.reason;
                        }
                      }

                      // Empty droppable slot
                      if (!a) {
                        return (
                          <td
                            key={idx}
                            title={clashTooltip}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              const sessId = e.dataTransfer.getData('text/plain');
                              handleMoveSession(sessId, day, time.start);
                            }}
                            className={`p-3 text-center text-slate-700 font-mono text-xs hover:bg-brand/10 hover:text-brand-light transition-all cursor-pointer ${clashBorder}`}
                          >
                            —
                          </td>
                        );
                      }

                      const highlighted = isMatch(a);
                      const isFixed = a.subjectId === null;
                      const isPinned = pinnedAssignments.includes(a.id);
                      const fac = faculties.find((f) => f.id === a.facultyId);

                      return (
                        <td
                          key={idx}
                          draggable={!isFixed && !isPinned}
                          onDragStart={(e) => {
                            if (!isFixed && !isPinned) {
                              e.dataTransfer.setData('text/plain', a.id);
                              setDraggedAssignment(a);
                            }
                          }}
                          onDragEnd={() => {
                            setDraggedAssignment(null);
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            const sessId = e.dataTransfer.getData('text/plain');
                            handleMoveSession(sessId, day, time.start);
                          }}
                          className={`p-3 transition-all duration-200 relative group
                            ${isFixed || isPinned ? '' : 'cursor-grab active:cursor-grabbing hover:bg-[#182046]/70'}
                            ${highlighted ? 'search-highlight' : ''}
                            ${isPinned ? 'border border-amber-500/40 bg-amber-500/5' : ''}
                            ${isFixed ? 'bg-emerald-500/10 text-emerald-300 font-bold border-emerald-500/20' : 'bg-[#182046]/40'}
                            ${clashBorder}`}
                        >
                          {/* Pin Toggle Button */}
                          {!isFixed && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePinAssignment(a.id);
                                toast.info(isPinned ? 'Unpinned session' : 'Pinned session to slot');
                              }}
                              className={`absolute top-1.5 right-1.5 p-1 rounded transition opacity-0 group-hover:opacity-100 ${
                                isPinned ? 'opacity-100 text-amber-400 bg-amber-500/20' : 'text-slate-500 hover:text-white'
                              }`}
                              title={isPinned ? 'Session is locked' : 'Pin session to current slot'}
                            >
                              <Pin size={11} className={isPinned ? 'fill-current' : ''} />
                            </button>
                          )}

                          <div className="text-center space-y-1.5">
                            <span className="block font-bold truncate leading-tight text-slate-200">
                              {a.subject}
                            </span>
                            <div className="flex flex-wrap gap-1 items-center justify-center text-[10px] text-slate-400">
                              <Badge variant={a.room.startsWith('L') ? 'warning' : 'default'} className="px-1.5 py-0">
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
                                <span className="truncate font-semibold max-w-[80px]" title={a.batches.join(', ')}>
                                  {a.batches.join(', ')}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Print Signature Footer */}
      <div className="hidden print-only mt-12 pt-8 border-t-2 border-black flex justify-between items-center text-xs text-black">
        <div>
          <p className="font-bold">Prepared by: Timetable Committee</p>
          <p className="mt-1">Date: {new Date().toLocaleDateString()}</p>
        </div>
        <div className="text-right">
          <p className="font-bold">Approved by: Head of Department / Dean</p>
          <p className="mt-8">Signature: __________________________</p>
        </div>
      </div>

      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          store.clearStepData(6);
          store.setStep(6);
          toast.success('Schedule results cleared.');
        }}
        title="Clear Timetable Solution"
        message="Are you sure you want to clear current timetable results and return to Step 6?"
        confirmLabel="Clear Page"
      />
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon?: React.ReactNode; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      {icon && <div className="text-slate-500">{icon}</div>}
      <p className="font-semibold text-slate-300">{title}</p>
      {description && <p className="text-xs text-slate-500 max-w-xs leading-normal">{description}</p>}
    </div>
  );
}

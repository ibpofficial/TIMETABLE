import { useEffect, useState, useRef } from 'react';
import { Play, Settings, X, Activity, Layers, ShieldAlert, ChevronRight, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, Input, SectionHeader, Modal, ConfirmModal } from '../ui';
import { StepNav } from './StepNav';
import { startGeneration, pollJob, cancelJob } from '../../api/client';
import type { SchedulerConfig } from '../../types';

export function Step6Generate() {
  const store = useTimetableStore();
  const [loading, setLoading] = useState(false);
  const [valErrors, setValErrors] = useState<any[]>([]);
  const [valWarnings, setValWarnings] = useState<any[]>([]);
  const [showValModal, setShowValModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Read config summary details
  const totalClasses = store.subjects.reduce((acc, s) => acc + s.classesPerWeek, 0);
  const totalDuration = store.subjects.reduce((acc, s) => acc + s.classesPerWeek * s.sessionLength * store.slotLength, 0);

  // Solver local options
  const [maxAttempts, setMaxAttempts] = useState(store.solverOptions.maxAttempts || 5000);
  const [balance, setBalance] = useState(store.solverOptions.balanceAcrossWeek);

  // Set store options when inputs change
  useEffect(() => {
    store.setSolverOptions({ maxAttempts, balanceAcrossWeek: balance });
  }, [maxAttempts, balance]);

  // Clean up poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Sync polling state if jobId is already in store
  useEffect(() => {
    if (store.jobId && !pollIntervalRef.current) {
      startPolling(store.jobId);
    }
  }, [store.jobId]);

  const handleGenerate = async (force: boolean = false) => {
    if (!force) {
      const errorsList = [];
      const warningsList = [];

      if (store.days.length === 0) {
        errorsList.push({ step: 1, text: 'No teaching days selected. You must define at least one teaching day.', action: 'Select Days' });
      }
      if (store.theoryRooms.length + store.labRooms.length === 0) {
        errorsList.push({ step: 1, text: 'No classrooms or labs created. The solver needs rooms to place classes.', action: 'Configure Rooms' });
      }
      if (store.batches.length === 0) {
        errorsList.push({ step: 2, text: 'No student batches defined. Timetables are generated per batch.', action: 'Configure Batches' });
      }
      if (store.faculties.length === 0) {
        errorsList.push({ step: 3, text: 'No teaching staff added. You must have teachers to assign to subjects.', action: 'Add Faculties' });
      }
      if (store.subjects.length === 0) {
        errorsList.push({ step: 4, text: 'No subjects have been defined. You must have course subjects to schedule.', action: 'Add Subjects' });
      }

      const unassignedCount = store.subjects.filter(s => !s.facultyId).length;
      if (unassignedCount > 0) {
        warningsList.push({ step: 4, text: `${unassignedCount} subject(s) have no teacher assigned. These subjects will be ignored during scheduling.`, action: 'Assign Teachers' });
      }

      if (errorsList.length > 0 || warningsList.length > 0) {
        setValErrors(errorsList);
        setValWarnings(warningsList);
        setShowValModal(true);
        return;
      }
    }

    setShowValModal(false);
    setLoading(true);
    store.resetResults();

    const config: SchedulerConfig = {
      days: store.days,
      startTime: store.startTime,
      endTime: store.endTime,
      slotLength: store.slotLength,
      maxClassesPerDay: store.maxClassesPerDay,
      rooms: {
        theoryList: store.theoryRooms,
        labList: store.labRooms,
      },
      batches: store.batches,
      batchSizes: store.batchSizes,
      faculties: store.faculties,
      subjects: store.subjects,
      breaks: store.breaks,
      events: store.events,
      options: {
        maxAttempts,
        balanceAcrossWeek: balance,
      },
    };

    try {
      const response = await startGeneration(config);
      store.setJobId(response.jobId);
      toast.info('Optimization solver started.');
      startPolling(response.jobId);
    } catch (err: any) {
      toast.error('Failed to start generator: ' + err.message);
      setLoading(false);
    }
  };

  const startPolling = (jobId: string) => {
    setLoading(true);
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await pollJob(jobId);
        store.setJobStatus(status);

        if (status.status === 'success') {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          store.setSolution(status.solution || null);
          store.setJobId(null);
          setLoading(false);
          toast.success('Timetable successfully generated!');
          store.setStep(7); // Auto advance to results
        } else if (status.status === 'failed') {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          store.setSolution(status.solution || null);
          store.setDiagnostics(status.diagnostics || null);
          store.setJobId(null);
          setLoading(false);
          toast.warning('Generated partial timetable (some constraints couldn\'t be fully resolved).');
          store.setStep(7); // Auto advance to show partial schedule and diagnostics
        } else if (status.status === 'error') {
          clearInterval(pollIntervalRef.current!);
          pollIntervalRef.current = null;
          store.setJobId(null);
          setLoading(false);
          toast.error('Scheduler crashed: ' + (status.error || 'Unknown solver error.'));
        }
      } catch (err: any) {
        clearInterval(pollIntervalRef.current!);
        pollIntervalRef.current = null;
        store.setJobId(null);
        setLoading(false);
        toast.error('Network error during polling: ' + err.message);
      }
    }, 500);
  };

  const handleCancel = async () => {
    if (!store.jobId) return;
    try {
      await cancelJob(store.jobId);
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      store.resetResults();
      setLoading(false);
      toast.info('Generation cancelled.');
    } catch (err: any) {
      toast.error('Cancellation failed: ' + err.message);
    }
  };

  const isGenerating = !!store.jobId;
  const progressPercent = store.jobStatus
    ? Math.round((store.jobStatus.placedSessions / (store.jobStatus.totalSessions || 1)) * 100)
    : 0;

  return (
    <div>
      <SectionHeader
        title="Step 6 — Review & Generate"
        subtitle="Review your scheduling inputs, adjust optimization settings, and run the CSP solver."
        onClear={() => setShowClearConfirm(true)}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Wizard Inputs Summary */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Layers size={18} className="text-brand" />
              Configuration Summary
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl text-center">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Active Days</span>
                <p className="text-lg font-bold text-slate-200 mt-1">{store.days.length} days</p>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {store.startTime} – {store.endTime}
                </span>
              </div>

              <div className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl text-center">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Infrastructure</span>
                <p className="text-lg font-bold text-slate-200 mt-1">
                  {store.theoryRooms.length + store.labRooms.length} Rooms
                </p>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {store.theoryRooms.length} Theory • {store.labRooms.length} Labs
                </span>
              </div>

              <div className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl text-center">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Student Batches</span>
                <p className="text-lg font-bold text-slate-200 mt-1">{store.batches.length} groups</p>
                <span className="text-[10px] text-slate-400 block mt-0.5 truncate max-w-full">
                  {store.batches.join(', ') || 'None'}
                </span>
              </div>

              <div className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl text-center">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Instruction Staff</span>
                <p className="text-lg font-bold text-slate-200 mt-1">{store.faculties.length} teachers</p>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {store.faculties.filter((f) => f.unavail?.length > 0).length} with time blocks
                </span>
              </div>

              <div className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl text-center">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Subjects / Courses</span>
                <p className="text-lg font-bold text-slate-200 mt-1">{store.subjects.length} courses</p>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {store.subjects.filter((s) => s.type === 'practical').length} lab practicals
                </span>
              </div>

              <div className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl text-center">
                <span className="text-[10px] text-slate-500 uppercase font-semibold">Weekly Load</span>
                <p className="text-lg font-bold text-slate-200 mt-1">{totalClasses} classes</p>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {Math.round(totalDuration / 60)} hrs instruction
                </span>
              </div>
            </div>

            {/* Incomplete Wizard warnings */}
            {(store.batches.length === 0 || store.faculties.length === 0 || store.subjects.length === 0) && (
              <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex gap-3 items-start">
                <ShieldAlert size={18} className="shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Missing configuration details:</span>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5 text-xs text-red-400">
                    {store.batches.length === 0 && <li>Create at least one student batch.</li>}
                    {store.faculties.length === 0 && <li>Add teaching staff.</li>}
                    {store.subjects.length === 0 && <li>Add course subjects.</li>}
                  </ul>
                </div>
              </div>
            )}
          </Card>

          {/* Running solver state progress */}
          {isGenerating && (
            <Card glow className="border-brand/40 shadow-brand/10 bg-brand/[0.02]">
              <div className="flex justify-between items-start gap-4">
                <div className="flex gap-3 items-center">
                  <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-brand/10">
                    <Activity size={18} className="text-brand animate-pulse" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-100">Solving Scheduling Constraints...</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Running recursive backtracking and constraint-propagation search
                    </p>
                  </div>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleCancel}
                  icon={<X size={12} />}
                >
                  Cancel
                </Button>
              </div>

              {/* Progress bar */}
              <div className="mt-5 space-y-2">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-400">Placed Sessions:</span>
                  <span className="text-brand-light font-bold">
                    {store.jobStatus?.placedSessions ?? 0} / {store.jobStatus?.totalSessions ?? 0} ({progressPercent}%)
                  </span>
                </div>
                <div className="w-full bg-[#0b1230] border border-white/5 rounded-full h-3.5 overflow-hidden p-0.5">
                  <div
                    className="bg-gradient-to-r from-brand to-brand-light h-full rounded-full transition-all duration-300 shadow-inner"
                    style={{ width: `${Math.min(progressPercent, 100)}%` }}
                  />
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Right: Solver settings & Trigger */}
        <div>
          <Card className="h-full flex flex-col">
            <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Settings size={18} className="text-brand" />
              Solver Parameters
            </h3>

            <div className="space-y-4 flex-1">
              {/* Max Attempts parameter */}
              <div className="p-4 bg-white/[0.02] border border-white/[0.05] rounded-xl space-y-3">
                <div>
                  <label htmlFor="maxAttempts" className="text-xs font-bold text-slate-200 block">
                    Optimization Search Depth (Backtracks)
                  </label>
                  <span className="text-[10px] text-slate-500 block mt-1 leading-normal">
                    Controls how exhaustively the scheduler attempts to swap slots to resolve overlaps. Set to 1,000–5,000 for standard timetables, or higher (10,000+) if you have strict teacher/room availability conflicts.
                  </span>
                </div>
                <Input
                  id="maxAttempts"
                  type="number"
                  min="50"
                  max="100000"
                  step="100"
                  className="text-xs font-mono py-1.5"
                  value={maxAttempts}
                  disabled={isGenerating}
                  onChange={(e) => setMaxAttempts(Number(e.target.value))}
                />
              </div>

              {/* Symmetrical Spreading parameter */}
              <div className="p-4 bg-white/[0.02] border border-white/[0.05] rounded-xl flex items-start gap-3 hover:border-brand/20 transition-all">
                <input
                  id="balanceCheck"
                  type="checkbox"
                  checked={balance}
                  disabled={isGenerating}
                  onChange={(e) => setBalance(e.target.checked)}
                  className="accent-brand w-4.5 h-4.5 mt-0.5 cursor-pointer"
                />
                <div>
                  <label htmlFor="balanceCheck" className="text-xs font-bold text-slate-200 cursor-pointer block select-none">
                    Symmetrical Class Spreading
                  </label>
                  <span className="text-[10px] text-slate-500 block mt-1 leading-normal">
                    Distribute lectures of the same subject across different days (e.g. Monday, Wednesday, Friday) instead of clustering them on a single day. This is highly recommended to improve student retention and avoid burnout.
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/[0.06]">
              <Button
                variant="primary"
                className="w-full py-3.5 text-base justify-center shadow-lg"
                icon={<Play size={16} fill="currentColor" />}
                onClick={() => handleGenerate(false)}
                loading={isGenerating || loading}
                disabled={isGenerating}
              >
                Generate Timetable
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <StepNav />

      {/* Descriptive Validation Check Modal */}
      <Modal
        isOpen={showValModal}
        onClose={() => setShowValModal(false)}
        title="Timetable Validation Pre-check"
      >
        <div className="space-y-6">
          <p className="text-xs text-slate-500 leading-normal">
            We analyzed your scheduling inputs. Please resolve any critical errors below before starting the solver.
          </p>

          {/* Critical Errors */}
          {valErrors.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle size={14} /> Critical Requirements ({valErrors.length})
              </h4>
              <div className="space-y-2">
                {valErrors.map((err, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 p-3 bg-red-500/5 border border-red-500/10 rounded-xl">
                    <p className="text-xs text-red-200 leading-normal">{err.text}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowValModal(false);
                        store.setStep(err.step);
                      }}
                      className="shrink-0 text-xs border-red-500/20 text-red-300 hover:bg-red-500/10"
                    >
                      {err.action} <ChevronRight size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {valWarnings.length > 0 && (
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle size={14} /> Optimization Warnings ({valWarnings.length})
              </h4>
              <div className="space-y-2">
                {valWarnings.map((warn, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
                    <p className="text-xs text-amber-200 leading-normal">{warn.text}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowValModal(false);
                        store.setStep(warn.step);
                      }}
                      className="shrink-0 text-xs border-amber-500/20 text-amber-300 hover:bg-amber-500/10"
                    >
                      {warn.action} <ChevronRight size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-white/[0.06]">
            <Button variant="ghost" onClick={() => setShowValModal(false)}>
              Go Back
            </Button>
            {valErrors.length === 0 && (
              <Button
                variant="primary"
                onClick={() => handleGenerate(true)}
              >
                Proceed & Generate anyway
              </Button>
            )}
          </div>
        </div>
      </Modal>
      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          store.clearStepData(6);
          toast.success('Generated solution results cleared.');
        }}
        title="Clear Optimization Results"
        message="Are you sure you want to clear the previously generated solver solutions and diagnostics? This will reset the results tab."
        confirmLabel="Clear Page"
      />
    </div>
  );
}

import { useEffect, useState, useRef } from 'react';
import { Play, Settings, X, Activity, Layers, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, FormField, Input, SectionHeader } from '../ui';
import { StepNav } from './StepNav';
import { startGeneration, pollJob, cancelJob } from '../../api/client';
import type { SchedulerConfig } from '../../types';

export function Step6Generate() {
  const store = useTimetableStore();
  const [loading, setLoading] = useState(false);
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

  const handleGenerate = async () => {
    if (store.subjects.length === 0) {
      toast.error('Add at least one subject before generating a schedule.');
      return;
    }

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
              <FormField
                label="Maximum Backtracks"
                htmlFor="maxAttempts"
                hint="Higher limit resolves hard bottlenecks but takes longer."
              >
                <Input
                  id="maxAttempts"
                  type="number"
                  min="50"
                  max="100000"
                  step="100"
                  value={maxAttempts}
                  disabled={isGenerating}
                  onChange={(e) => setMaxAttempts(Number(e.target.value))}
                />
              </FormField>

              <div className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl flex items-start gap-3">
                <input
                  id="balanceCheck"
                  type="checkbox"
                  checked={balance}
                  disabled={isGenerating}
                  onChange={(e) => setBalance(e.target.checked)}
                  className="accent-brand w-4.5 h-4.5 mt-0.5 cursor-pointer"
                />
                <div>
                  <label htmlFor="balanceCheck" className="text-sm font-semibold text-slate-200 cursor-pointer block select-none">
                    Spread subjects weekly
                  </label>
                  <span className="text-[10px] text-slate-500 block mt-0.5 leading-normal">
                    Pushes the optimizer to distribute the same subject on different days rather than squeezing them into a single day.
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/[0.06]">
              <Button
                variant="primary"
                className="w-full py-3.5 text-base justify-center shadow-lg"
                icon={<Play size={16} fill="currentColor" />}
                onClick={handleGenerate}
                loading={isGenerating || loading}
                disabled={
                  isGenerating ||
                  store.batches.length === 0 ||
                  store.faculties.length === 0 ||
                  store.subjects.length === 0
                }
              >
                Generate Timetable
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <StepNav />
    </div>
  );
}

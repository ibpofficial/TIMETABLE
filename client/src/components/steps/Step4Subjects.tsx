import { useState } from 'react';
import { BookOpen, Trash2, ChevronDown, ChevronUp, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, Chip, EmptyState, FormField, Input, Select, SectionHeader, Badge } from '../ui';
import { StepNav } from './StepNav';
import type { Subject, UnavailabilityWindow } from '../../types';

let subjIdCounter = 1;
const genSubjId = () => `S${subjIdCounter++}_${Date.now().toString(36)}`;

export function Step4Subjects() {
  const { subjects, faculties, batches, days, addSubject, removeSubject, slotLength, startTime, endTime, maxClassesPerDay } = useTimetableStore();

  const [form, setForm] = useState({
    selectedBatches: [] as string[],
    name: '',
    type: 'theory' as 'theory' | 'practical',
    classesPerWeek: 3,
    sessionLength: 1,
    facultyId: '',
    hasFixed: false,
    fixedDay: days[0] || 'Mon',
    fixedStart: '09:00',
    fixedLength: 1,
  });

  const [subUnavails, setSubUnavails] = useState<UnavailabilityWindow[]>([]);
  const [unvDay, setUnvDay] = useState(days[0] || 'Mon');
  const [unvStart, setUnvStart] = useState('');
  const [unvEnd, setUnvEnd] = useState('');

  const [formError, setFormError] = useState<Record<string, string>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Feasibility check: can the weekly demand be satisfied?
  const checkFeasibility = (s: typeof form): string | null => {
    const t2m = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const dayMins = t2m(endTime) - t2m(startTime);
    const slotsPerDay = Math.floor(dayMins / slotLength);
    const maxSlotsPerWeek = days.length * Math.min(slotsPerDay, maxClassesPerDay);
    const neededSlots = s.classesPerWeek * s.sessionLength;
    if (neededSlots > maxSlotsPerWeek) {
      return `This subject needs ${neededSlots} total slot(s)/week but the schedule only has ${maxSlotsPerWeek} available.`;
    }
    return null;
  };

  const handleAdd = () => {
    const errors: Record<string, string> = {};
    if (form.selectedBatches.length === 0) errors.batch = 'Select at least one batch.';
    if (!form.name.trim()) errors.name = 'Subject name is required.';
    if (form.classesPerWeek < 1) errors.cpw = 'Must have at least 1 class per week.';
    if (form.sessionLength < 1) errors.sl = 'Session length must be at least 1 slot.';

    // Validate fixed slot assignment doesn't conflict with existing fixed subjects
    if (form.hasFixed) {
      const conflict = subjects.find((s) =>
        s.fixed &&
        s.fixedDay === form.fixedDay &&
        s.fixedStart === form.fixedStart &&
        s.batches.some((b) => form.selectedBatches.includes(b)) &&
        s.facultyId === form.facultyId
      );
      if (conflict) errors.fixed = `Fixed slot conflicts with "${conflict.name}" on ${form.fixedDay} at ${form.fixedStart}.`;
    }

    if (Object.keys(errors).length > 0) { setFormError(errors); return; }

    const feasibilityWarning = checkFeasibility(form);
    if (feasibilityWarning) {
      toast.warning(feasibilityWarning, { duration: 6000 });
    }

    const newSubject: Subject = {
      id: genSubjId(),
      name: form.name.trim(),
      type: form.type,
      classesPerWeek: form.classesPerWeek,
      sessionLength: form.sessionLength,
      facultyId: form.facultyId || null,
      batches: form.selectedBatches,
      unavail: [...subUnavails],
      ...(form.hasFixed ? {
        fixed: true,
        fixedDay: form.fixedDay,
        fixedStart: form.fixedStart,
        fixedLength: form.fixedLength,
      } : {}),
    };

    addSubject(newSubject);
    setForm({ ...form, name: '', classesPerWeek: 3, sessionLength: 1, hasFixed: false, selectedBatches: [] });
    setSubUnavails([]);
    setFormError({});
    toast.success(`Added "${newSubject.name}"`);
  };

  const handleAddUnavail = () => {
    if (!unvStart || !unvEnd) { toast.error('Select start and end time.'); return; }
    const startM = parseInt(unvStart.replace(':', ''));
    const endM = parseInt(unvEnd.replace(':', ''));
    if (endM <= startM) { toast.error('End time must be after start time.'); return; }
    setSubUnavails((prev) => [...prev, { day: unvDay, start: unvStart, end: unvEnd }]);
    setUnvStart(''); setUnvEnd('');
  };

  const toggleBatch = (b: string) => {
    setForm((f) => ({
      ...f,
      selectedBatches: f.selectedBatches.includes(b)
        ? f.selectedBatches.filter((x) => x !== b)
        : [...f.selectedBatches, b],
    }));
  };

  const isElective = form.selectedBatches.length > 1;

  return (
    <div>
      <SectionHeader
        title="Step 4 — Subjects"
        subtitle="Define courses per batch. Select multiple batches to create a shared elective."
      />

      {/* Add Form */}
      <Card className="mb-5">
        <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
          Add Subject
          {isElective && (
            <Badge variant="warning">
              <Link2 size={10} className="mr-1" /> Elective (shared across {form.selectedBatches.length} batches)
            </Badge>
          )}
        </h3>

        {/* Batch selection */}
        <FormField label="Assign to Batch(es)" error={formError.batch}>
          <div className="flex flex-wrap gap-2">
            {batches.map((b) => (
              <button
                key={b}
                onClick={() => toggleBatch(b)}
                aria-pressed={form.selectedBatches.includes(b)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                  ${form.selectedBatches.includes(b)
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white/[0.04] border-white/10 text-slate-400 hover:border-white/20'}
                `}
              >
                {b}
              </button>
            ))}
            {batches.length === 0 && <span className="text-xs text-slate-500">No batches defined. Go back to Step 2.</span>}
          </div>
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          <FormField label="Subject Name" htmlFor="subjName" error={formError.name} className="sm:col-span-2 lg:col-span-1">
            <Input
              id="subjName"
              value={form.name}
              onChange={(e) => { setForm({ ...form, name: e.target.value }); setFormError((x) => ({ ...x, name: '' })); }}
              placeholder="e.g., Data Structures"
              error={!!formError.name}
            />
          </FormField>
          <FormField label="Type" htmlFor="subjType">
            <Select
              id="subjType"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as 'theory' | 'practical' })}
            >
              <option value="theory">Theory</option>
              <option value="practical">Practical (Lab)</option>
            </Select>
          </FormField>
          <FormField label="Faculty" htmlFor="subjFaculty">
            <Select
              id="subjFaculty"
              value={form.facultyId}
              onChange={(e) => setForm({ ...form, facultyId: e.target.value })}
            >
              <option value="">— Unassigned —</option>
              {faculties.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Classes / Week" htmlFor="subjCpw" error={formError.cpw}>
            <Input
              id="subjCpw"
              type="number"
              min="1"
              value={form.classesPerWeek}
              onChange={(e) => setForm({ ...form, classesPerWeek: Number(e.target.value) })}
              error={!!formError.cpw}
            />
          </FormField>
          <FormField label="Session Length (slots)" htmlFor="subjSl" error={formError.sl} hint={`1 slot = ${slotLength} min`}>
            <Input
              id="subjSl"
              type="number"
              min="1"
              value={form.sessionLength}
              onChange={(e) => setForm({ ...form, sessionLength: Number(e.target.value) })}
              error={!!formError.sl}
            />
          </FormField>
        </div>

        {/* Advanced: Fixed slot + unavailability */}
        <button
          onClick={() => setShowAdvanced((x) => !x)}
          className="mt-4 flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Advanced constraints (fixed slot, unavailability windows)
        </button>

        {showAdvanced && (
          <div className="mt-4 p-4 bg-white/[0.02] rounded-xl border border-white/[0.06] animate-fade-in space-y-4">
            {/* Fixed slot */}
            <div className="flex items-center gap-3">
              <input
                id="hasFixed"
                type="checkbox"
                checked={form.hasFixed}
                onChange={(e) => setForm({ ...form, hasFixed: e.target.checked })}
                className="accent-brand w-4 h-4"
              />
              <label htmlFor="hasFixed" className="text-sm text-slate-300">Pin to a fixed time slot</label>
            </div>

            {form.hasFixed && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <FormField label="Day" error={formError.fixed}>
                  <Select value={form.fixedDay} onChange={(e) => setForm({ ...form, fixedDay: e.target.value })}>
                    {days.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </FormField>
                <FormField label="Start Time">
                  <Input type="time" value={form.fixedStart} onChange={(e) => setForm({ ...form, fixedStart: e.target.value })} />
                </FormField>
                <FormField label="Length (slots)">
                  <Input type="number" min="1" value={form.fixedLength} onChange={(e) => setForm({ ...form, fixedLength: Number(e.target.value) })} />
                </FormField>
              </div>
            )}

            {/* Unavailability */}
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-2">Subject Unavailability Windows</p>
              {subUnavails.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {subUnavails.map((u, i) => (
                    <Chip key={i} label={`${u.day} ${u.start}–${u.end}`} onRemove={() => setSubUnavails((a) => a.filter((_, j) => j !== i))} color="red" />
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                <FormField label="Day">
                  <Select value={unvDay} onChange={(e) => setUnvDay(e.target.value)}>
                    {days.map((d) => <option key={d}>{d}</option>)}
                  </Select>
                </FormField>
                <FormField label="From">
                  <Input type="time" value={unvStart} onChange={(e) => setUnvStart(e.target.value)} />
                </FormField>
                <FormField label="To">
                  <Input type="time" value={unvEnd} onChange={(e) => setUnvEnd(e.target.value)} />
                </FormField>
                <Button variant="ghost" size="sm" onClick={handleAddUnavail} className="mb-1">Add Block</Button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button id="btn-add-subject" variant="primary" onClick={handleAdd}>Add Subject</Button>
        </div>
      </Card>

      {/* Subject list */}
      {subjects.length === 0 ? (
        <EmptyState icon={<BookOpen size={36} className="text-slate-600" />} title="No subjects yet" description="Add theory or practical subjects. Practicals with session length > 1 are automatically scheduled as contiguous blocks." />
      ) : (
        <div className="grid gap-3">
          {subjects.map((s) => {
            const fac = faculties.find((f) => f.id === s.facultyId);
            return (
              <Card key={s.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-200">{s.name}</span>
                    <Badge variant={s.type === 'theory' ? 'default' : 'warning'}>{s.type}</Badge>
                    {s.batches.length > 1 && <Badge variant="success"><Link2 size={10} className="mr-1" />Elective</Badge>}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {s.batches.join(', ')} • {s.classesPerWeek}×/week • {s.sessionLength} slot(s)
                    {fac ? ` • ${fac.name}` : ' • Unassigned'}
                    {s.fixed ? ` • Fixed: ${s.fixedDay} ${s.fixedStart}` : ''}
                    {(s.unavail?.length ?? 0) > 0 ? ` • ${s.unavail!.length} unavail block(s)` : ''}
                  </div>
                </div>
                <button
                  id={`btn-remove-subj-${s.id}`}
                  onClick={() => removeSubject(s.id)}
                  className="shrink-0 p-1.5 rounded-lg hover:bg-red-500/10 text-slate-600 hover:text-red-400 transition-colors"
                  title="Remove subject"
                >
                  <Trash2 size={15} />
                </button>
              </Card>
            );
          })}
        </div>
      )}

      <StepNav />
    </div>
  );
}

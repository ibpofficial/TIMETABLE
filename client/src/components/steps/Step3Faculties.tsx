import { useState } from 'react';
import { UserSquare, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, Chip, EmptyState, FormField, Input, Select, SectionHeader } from '../ui';
import { StepNav } from './StepNav';
import type { Faculty, UnavailabilityWindow } from '../../types';

let facIdCounter = 1;
const genFacId = () => `F${facIdCounter++}_${Date.now().toString(36)}`;

export function Step3Faculties() {
  const { faculties, addFaculty, updateFaculty, removeFaculty, days } = useTimetableStore();

  const [form, setForm] = useState({
    name: '', leaves: 1, maxWeeklySlots: 18, maxDailySlots: '' as string | number,
  });
  const [formError, setFormError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Unavailability window form per faculty card
  const [unvForms, setUnvForms] = useState<Record<string, { day: string; start: string; end: string }>>({});

  const handleAdd = () => {
    if (!form.name.trim()) { setFormError('Faculty name is required.'); return; }
    if (faculties.some((f) => f.name.toLowerCase() === form.name.trim().toLowerCase())) {
      setFormError('Faculty with this name already exists.');
      return;
    }
    const newFac: Faculty = {
      id: genFacId(),
      name: form.name.trim(),
      leaves: form.leaves,
      maxWeeklySlots: form.maxWeeklySlots,
      maxDailySlots: form.maxDailySlots ? Number(form.maxDailySlots) : undefined,
      unavail: [],
    };
    addFaculty(newFac);
    setForm({ name: '', leaves: 1, maxWeeklySlots: 18, maxDailySlots: '' });
    setFormError('');
  };

  const handleAddUnavail = (fac: Faculty) => {
    const uf = unvForms[fac.id] ?? { day: days[0] || 'Mon', start: '', end: '' };
    if (!uf.start || !uf.end) { toast.error('Select start and end time for unavailability.'); return; }

    const startM = parseInt(uf.start.replace(':', ''));
    const endM = parseInt(uf.end.replace(':', ''));
    if (endM <= startM) { toast.error('End time must be after start time.'); return; }

    // Validate no overlap with existing unavailabilities for same day
    const overlap = (fac.unavail || []).some((u) =>
      u.day === uf.day &&
      !(parseInt(uf.end.replace(':', '')) <= parseInt(u.start.replace(':', '')) ||
        parseInt(uf.start.replace(':', '')) >= parseInt(u.end.replace(':', '')))
    );
    if (overlap) { toast.error('This window overlaps with an existing unavailability block.'); return; }

    const newUnavail: UnavailabilityWindow[] = [...(fac.unavail || []), { day: uf.day, start: uf.start, end: uf.end }];
    updateFaculty(fac.id, { unavail: newUnavail });
    setUnvForms((prev) => ({ ...prev, [fac.id]: { day: days[0] || 'Mon', start: '', end: '' } }));
  };

  const handleRemoveUnavail = (fac: Faculty, idx: number) => {
    const updated = (fac.unavail || []).filter((_, i) => i !== idx);
    updateFaculty(fac.id, { unavail: updated });
  };

  const validate = () => {
    if (faculties.length === 0) {
      toast.error('Add at least one faculty member before proceeding.');
      return false;
    }
    return true;
  };

  return (
    <div>
      <SectionHeader
        title="Step 3 — Faculties"
        subtitle="Add teaching staff with their availability constraints and workload limits."
      />

      {/* Add Faculty Form */}
      <Card className="mb-5">
        <h3 className="font-semibold text-slate-200 mb-4">Add Faculty</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FormField label="Name" htmlFor="facName" error={formError} className="sm:col-span-2">
            <Input
              id="facName"
              value={form.name}
              onChange={(e) => { setForm({ ...form, name: e.target.value }); setFormError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="e.g., Dr. A. Sharma"
              error={!!formError}
            />
          </FormField>
          <FormField label="Avg. Leaves / Month" htmlFor="facLeaves">
            <Input
              id="facLeaves"
              type="number"
              min="0"
              value={form.leaves}
              onChange={(e) => setForm({ ...form, leaves: Number(e.target.value) })}
            />
          </FormField>
          <FormField label="Max Weekly Slots" htmlFor="facMaxWeekly">
            <Input
              id="facMaxWeekly"
              type="number"
              min="1"
              value={form.maxWeeklySlots}
              onChange={(e) => setForm({ ...form, maxWeeklySlots: Number(e.target.value) })}
            />
          </FormField>
        </div>
        <div className="mt-3 flex justify-end">
          <Button id="btn-add-faculty" variant="primary" onClick={handleAdd}>Add Faculty</Button>
        </div>
      </Card>

      {/* Faculty List */}
      {faculties.length === 0 ? (
        <EmptyState
          icon={<UserSquare size={36} className="text-slate-600" />}
          title="No faculties added yet"
          description="Add teaching staff above. You can specify availability blocks per faculty."
        />
      ) : (
        <div className="grid gap-4">
          {faculties.map((fac) => {
            const isOpen = expandedId === fac.id;
            const unvForm = unvForms[fac.id] ?? { day: days[0] || 'Mon', start: '', end: '' };

            return (
              <Card key={fac.id} hover className="border-white/[0.08]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-200">{fac.name}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Max {fac.maxWeeklySlots} slots/week
                      {fac.maxDailySlots ? ` • ${fac.maxDailySlots}/day` : ''}
                      {fac.leaves > 0 ? ` • ${fac.leaves} leaves/mo` : ''}
                      {fac.unavail?.length > 0 ? ` • ${fac.unavail.length} blocked window(s)` : ''}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      id={`btn-toggle-fac-${fac.id}`}
                      onClick={() => setExpandedId(isOpen ? null : fac.id)}
                      className="p-1.5 rounded-lg hover:bg-white/[0.06] text-slate-400 hover:text-slate-200 transition-colors"
                      title="Edit unavailability"
                    >
                      {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <button
                      id={`btn-remove-fac-${fac.id}`}
                      onClick={() => {
                        if (!confirm(`Remove ${fac.name} and unassign their subjects?`)) return;
                        removeFaculty(fac.id);
                      }}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                      title="Remove faculty"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-4 pt-4 border-t border-white/[0.06] animate-fade-in">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Unavailability Windows</p>

                    {/* Existing blocks */}
                    {(fac.unavail || []).length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {fac.unavail.map((u, idx) => (
                          <Chip
                            key={idx}
                            label={`${u.day} ${u.start}–${u.end}`}
                            onRemove={() => handleRemoveUnavail(fac, idx)}
                            color="amber"
                          />
                        ))}
                      </div>
                    )}

                    {/* Add new block */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                      <FormField label="Day">
                        <Select
                          value={unvForm.day}
                          onChange={(e) => setUnvForms((prev) => ({ ...prev, [fac.id]: { ...unvForm, day: e.target.value } }))}
                        >
                          {days.map((d) => <option key={d} value={d}>{d}</option>)}
                        </Select>
                      </FormField>
                      <FormField label="From">
                        <Input
                          type="time"
                          value={unvForm.start}
                          onChange={(e) => setUnvForms((prev) => ({ ...prev, [fac.id]: { ...unvForm, start: e.target.value } }))}
                        />
                      </FormField>
                      <FormField label="To">
                        <Input
                          type="time"
                          value={unvForm.end}
                          onChange={(e) => setUnvForms((prev) => ({ ...prev, [fac.id]: { ...unvForm, end: e.target.value } }))}
                        />
                      </FormField>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Plus size={14} />}
                        onClick={() => handleAddUnavail(fac)}
                        className="mb-1"
                      >
                        Block
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <StepNav onNext={validate} />
    </div>
  );
}

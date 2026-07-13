import { useState } from 'react';
import { UserSquare, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, Chip, EmptyState, FormField, Input, Select, SectionHeader, Modal, ConfirmModal } from '../ui';
import { StepNav } from './StepNav';
import type { Faculty, UnavailabilityWindow } from '../../types';
import ImportFacultyExcel from '../ImportFacultyExcel';

let facIdCounter = 1;
const genFacId = () => `F${facIdCounter++}_${Date.now().toString(36)}`;

export function Step3Faculties() {
  const store = useTimetableStore();
  const { faculties, addFaculty, updateFaculty, removeFaculty, days, subjects } = store;
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', leaves: 1, maxWeeklySlots: 18, maxDailySlots: '' as string | number,
  });
  const [formError, setFormError] = useState('');
  const [unavailModalFacId, setUnavailModalFacId] = useState<string | null>(null);
  const [deleteConfirmFacId, setDeleteConfirmFacId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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
      toast.warning('Note: No faculty members added yet.');
    }
    return true;
  };

  const unavailModalFac = faculties.find(f => f.id === unavailModalFacId);
  const unvForm = unavailModalFac ? (unvForms[unavailModalFac.id] ?? { day: days[0] || 'Mon', start: '', end: '' }) : { day: days[0] || 'Mon', start: '', end: '' };

  return (
    <div>
      <SectionHeader
        title="Step 3 — Faculties"
        subtitle="Add teaching staff with their availability constraints and workload limits."
        onClear={() => setShowClearConfirm(true)}
      />

      {/* Add Faculty Form */}
      <Card className="mb-5">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-slate-200">Add Faculty</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsImportOpen(true)}
            icon={<Upload size={14} />}
          >
            Import from Excel
          </Button>
        </div>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {faculties.map((fac) => {
            const blockedCount = (fac.unavail || []).length;

            return (
              <Card key={fac.id} hover className="border-white/[0.06] flex flex-col justify-between h-[190px] p-6 bg-gradient-to-br from-panel to-slate-950/20">
                <div className="space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-brand/10 border border-brand/25 flex items-center justify-center font-black text-brand text-sm shrink-0">
                        {fac.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="font-bold text-slate-200 text-sm truncate" title={fac.name}>
                        {fac.name}
                      </div>
                    </div>
                    
                    <button
                      id={`btn-remove-fac-${fac.id}`}
                      onClick={() => setDeleteConfirmFacId(fac.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors shrink-0 cursor-pointer"
                      title="Remove faculty"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Metadata info */}
                  <div className="space-y-1.5 text-slate-400 text-xs">
                    <div className="flex justify-between">
                      <span>Weekly slots limit:</span>
                      <span className="font-semibold text-slate-300">{fac.maxWeeklySlots} slots</span>
                    </div>
                    {fac.maxDailySlots && (
                      <div className="flex justify-between">
                        <span>Max daily slots:</span>
                        <span className="font-semibold text-slate-300">{fac.maxDailySlots} slots</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Monthly leaves:</span>
                      <span className="font-semibold text-slate-300">{fac.leaves} day(s)</span>
                    </div>
                  </div>
                </div>

                {/* Actions bottom */}
                <div className="flex items-center justify-between pt-3.5 border-t border-white/[0.04] mt-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${blockedCount > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                    {blockedCount > 0 ? `${blockedCount} Blocked` : 'Fully Available'}
                  </span>
                  
                  <button
                    onClick={() => setUnavailModalFacId(fac.id)}
                    className="text-[11px] text-brand hover:text-brand-light font-bold hover:underline transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    Set Availability
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <StepNav onNext={validate} />

      {/* Unavailability Modal */}
      {unavailModalFac && (
        <Modal
          isOpen={!!unavailModalFac}
          onClose={() => setUnavailModalFacId(null)}
          title={`Manage Schedule Unavailability — ${unavailModalFac.name}`}
        >
          <div className="space-y-6">
            <p className="text-xs text-slate-500 leading-normal">
              Block specific days or time windows when this instructor is unavailable (e.g. for administrative work or part-time scheduling).
            </p>

            {/* Existing blocks */}
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Blocked Windows</p>
              {(unavailModalFac.unavail || []).length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {unavailModalFac.unavail.map((u, idx) => (
                    <Chip
                      key={idx}
                      label={`${u.day} ${u.start}–${u.end}`}
                      onRemove={() => handleRemoveUnavail(unavailModalFac, idx)}
                      color="amber"
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-600 italic">No blocked windows configured. This instructor is fully available.</p>
              )}
            </div>

            {/* Add new block */}
            <div className="pt-4 border-t border-white/[0.06] space-y-4">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Block New Window</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <FormField label="Day">
                  <Select
                    value={unvForm.day}
                    onChange={(e) => setUnvForms(prev => ({ ...prev, [unavailModalFac.id]: { ...unvForm, day: e.target.value } }))}
                  >
                    {days.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                </FormField>
                <FormField label="From">
                  <Input
                    type="time"
                    value={unvForm.start}
                    onChange={(e) => setUnvForms(prev => ({ ...prev, [unavailModalFac.id]: { ...unvForm, start: e.target.value } }))}
                  />
                </FormField>
                <FormField label="To">
                  <Input
                    type="time"
                    value={unvForm.end}
                    onChange={(e) => setUnvForms(prev => ({ ...prev, [unavailModalFac.id]: { ...unvForm, end: e.target.value } }))}
                  />
                </FormField>
              </div>
              <div className="flex justify-end pt-2">
                <Button
                  variant="primary"
                  icon={<Plus size={14} />}
                  onClick={() => handleAddUnavail(unavailModalFac)}
                >
                  Block Window
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      <Modal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} title="Import Faculties & Subjects from Excel">
        <ImportFacultyExcel onClose={() => setIsImportOpen(false)} />
      </Modal>

      <ConfirmModal
        isOpen={!!deleteConfirmFacId}
        onClose={() => setDeleteConfirmFacId(null)}
        onConfirm={() => {
          if (deleteConfirmFacId) {
            const facultyToDelete = faculties.find(f => f.id === deleteConfirmFacId);
            if (facultyToDelete) {
              const prevSubjects = [...subjects];
              removeFaculty(deleteConfirmFacId);
              toast.success(`Removed faculty "${facultyToDelete.name}"`, {
                action: {
                  label: 'Undo',
                  onClick: () => {
                    addFaculty(facultyToDelete);
                    useTimetableStore.setState({ subjects: prevSubjects });
                  }
                }
              });
            }
          }
        }}
        title="Delete Faculty Member"
        message={`Are you sure you want to remove this instructor? All of their course subject assignments will be cleared.`}
        confirmLabel="Delete"
      />

      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          useTimetableStore.getState().clearStepData(3);
          toast.success('Faculties list cleared.');
        }}
        title="Clear Faculties Directory"
        message="Are you sure you want to clear the entire teaching staff list? This will also unassign all subjects from teachers."
        confirmLabel="Clear Page"
      />
    </div>
  );
}

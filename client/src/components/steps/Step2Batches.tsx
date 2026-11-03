import { useState } from 'react';
import { Users, Upload, Plus } from 'lucide-react';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, Chip, EmptyState, FormField, Input, SectionHeader, ConfirmModal, Modal } from '../ui';
import { StepNav } from './StepNav';
import { toast } from 'sonner';

export function Step2Batches() {
  const { batches, batchSizes, addBatch, removeBatch } = useTimetableStore();
  const [input, setInput] = useState('');
  const [size, setSize] = useState('60');
  const [error, setError] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkInput, setBulkInput] = useState('');
  const [defaultSize, setDefaultSize] = useState('60');

  const handleAdd = () => {
    const name = input.trim();
    if (!name) { setError('Batch name cannot be empty.'); return; }
    if (batches.includes(name)) { setError(`"${name}" already exists.`); return; }
    if (!/^[A-Za-z0-9\-_\s]+$/.test(name)) { setError('Batch name can only contain letters, numbers, hyphens, or spaces.'); return; }
    
    const parsedSize = parseInt(size, 10);
    if (isNaN(parsedSize) || parsedSize <= 0) {
      toast.error('Student count must be a positive number.');
      return;
    }

    addBatch(name, parsedSize);
    setInput('');
    setSize('60');
    setError('');
  };

  const handleBulkAdd = () => {
    const lines = bulkInput.split('\n');
    let addedCount = 0;
    let skippedCount = 0;
    
    const parsedDefaultSize = parseInt(defaultSize, 10);
    const validDefaultSize = isNaN(parsedDefaultSize) || parsedDefaultSize <= 0 ? 60 : parsedDefaultSize;

    const addedNamesThisRun = new Set<string>();

    lines.forEach((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;

      let name = trimmedLine;
      let size = validDefaultSize;

      if (trimmedLine.includes(',')) {
        const parts = trimmedLine.split(',');
        name = parts[0].trim();
        const sizeStr = parts[1].trim();
        const parsedSize = parseInt(sizeStr, 10);
        if (!isNaN(parsedSize) && parsedSize > 0) {
          size = parsedSize;
        }
      }

      if (!name) {
        skippedCount++;
        return;
      }

      if (!/^[A-Za-z0-9\-_\s]+$/.test(name)) {
        skippedCount++;
        return;
      }

      const nameLower = name.toLowerCase();
      const existsInStore = batches.some(b => b.toLowerCase() === nameLower);
      const existsInRun = addedNamesThisRun.has(nameLower);

      if (existsInStore || existsInRun) {
        skippedCount++;
        return;
      }

      addBatch(name, size);
      addedNamesThisRun.add(nameLower);
      addedCount++;
    });

    toast.success(`Bulk add completed: Added ${addedCount} batches, skipped ${skippedCount} lines/duplicates.`);
    setBulkInput('');
    setIsBulkOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
  };

  const validate = () => {
    if (batches.length === 0) {
      toast.warning('Note: No batches configured yet.');
    }
    return true;
  };

  return (
    <div>
      <SectionHeader
        title="Step 2 — Batches"
        subtitle="Define student groups (e.g. CSE-3A, ECE-2B). Subjects will be assigned per batch."
        onClear={() => setShowClearConfirm(true)}
      />

      <Card className="mb-5">
        <div className="flex justify-between items-center mb-4 border-b border-white/[0.04] pb-3">
          <h3 className="font-semibold text-slate-200">Add Student Batches</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsBulkOpen(true)}
            icon={<Upload size={14} />}
            className="text-xs py-1.5 px-3 flex items-center gap-1 border border-white/10 hover:border-white/20"
          >
            Bulk Add Batches
          </Button>
        </div>

        <div className="flex gap-3 items-end">
          <FormField label="Batch Name" htmlFor="batchNameInput" error={error} className="flex-[2]">
            <Input
              id="batchNameInput"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(''); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g., CSE-3A"
              error={!!error}
            />
          </FormField>
          <FormField label="Student Count" htmlFor="batchSizeInput" className="flex-1">
            <Input
              id="batchSizeInput"
              type="number"
              min="1"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., 60"
            />
          </FormField>
          <Button
            id="btn-add-batch"
            variant="primary"
            onClick={handleAdd}
            className="mb-1"
          >
            Add Batch
          </Button>
        </div>

        {batches.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {batches.map((b) => (
              <Chip
                key={b}
                label={`${b} (${batchSizes[b] || 60} students)`}
                onRemove={() => {
                  const batchToDelete = b;
                  const prevSize = batchSizes[b] || 60;
                  const prevSubjects = [...useTimetableStore.getState().subjects];
                  const prevBatchDetails = { ...useTimetableStore.getState().batchDetails };

                  removeBatch(b);
                  toast.success(`Removed batch "${batchToDelete}"`, {
                    action: {
                      label: 'Undo',
                      onClick: () => {
                        addBatch(batchToDelete, prevSize);
                        useTimetableStore.setState({
                          subjects: prevSubjects,
                          batchDetails: prevBatchDetails
                        });
                      }
                    }
                  });
                }}
                color="blue"
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Users size={32} className="text-slate-600" />}
            title="No batches yet"
            description="Add student groups like CSE-3A, ECE-2B to get started."
          />
        )}
      </Card>

      {/* Lab Sub-Groups & Practical Sections */}
      {batches.length > 0 && (
        <Card className="mb-5 border-white/5 bg-slate-900/30">
          <div className="mb-3">
            <h3 className="font-semibold text-slate-200 text-sm">Lab Sub-Groups & Practical Sections</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Split large cohorts into lab groups (e.g. G1, G2) for practical sessions that have lab room capacity constraints.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {batches.map((b) => {
              const bSize = batchSizes[b] || 60;
              const halfSize = Math.ceil(bSize / 2);
              const storeGroups = useTimetableStore.getState().studentGroups.filter((g) => g.batchId === b);

              return (
                <div key={b} className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-2 min-w-[200px]">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-white">{b}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{bSize} total</span>
                  </div>

                  {storeGroups.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {storeGroups.map((g) => (
                        <span
                          key={g.id}
                          className="text-[10px] bg-brand/20 text-brand-light px-2 py-0.5 rounded border border-brand/30 flex items-center gap-1"
                        >
                          {g.name} ({g.size})
                          <button
                            onClick={() => useTimetableStore.getState().removeStudentGroup(g.id)}
                            className="hover:text-red-400 text-slate-400 ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        useTimetableStore.getState().addStudentGroup({
                          id: `${b}_G1`,
                          name: `${b}-G1`,
                          batchId: b,
                          size: halfSize,
                        });
                        useTimetableStore.getState().addStudentGroup({
                          id: `${b}_G2`,
                          name: `${b}-G2`,
                          batchId: b,
                          size: Math.floor(bSize / 2),
                        });
                        toast.success(`Created 2 lab groups for ${b}`);
                      }}
                      className="text-[11px] text-brand-light bg-brand/10 hover:bg-brand/20 px-2 py-1 rounded border border-brand/20 transition w-full text-center"
                    >
                      + Split into 2 Lab Groups
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="bg-brand/[0.05] border border-brand/20 rounded-xl p-4 text-sm text-slate-400">
        <span className="text-brand font-semibold">Tip:</span> You can configure elective subjects shared across multiple batches in Step 4.
      </div>

      <StepNav onNext={validate} />

      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          useTimetableStore.getState().clearStepData(2);
          toast.success('Batches cleared.');
        }}
        title="Clear Student Batches"
        message="Are you sure you want to clear all batches and student counts? This will also unassign these batches from all course subjects."
        confirmLabel="Clear Page"
      />

      <Modal isOpen={isBulkOpen} onClose={() => setIsBulkOpen(false)} title="Bulk Add Student Batches">
        <div className="space-y-4">
          <p className="text-xs text-slate-400 leading-normal">
            Enter student groups/batches (one per line). You can optionally specify a student count separated by a comma.
            <br />
            Formats: <code>CSE-3A</code> or <code>CSE-3B, 55</code>
          </p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <FormField label="Default Student Count" htmlFor="bulkDefaultSize" className="md:col-span-2">
              <Input
                id="bulkDefaultSize"
                type="number"
                min="1"
                value={defaultSize}
                onChange={(e) => setDefaultSize(e.target.value)}
                placeholder="60"
              />
            </FormField>
          </div>

          <FormField label="Batch List" htmlFor="bulkTextarea">
            <textarea
              id="bulkTextarea"
              rows={8}
              value={bulkInput}
              onChange={(e) => setBulkInput(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-white/10 text-slate-200 text-sm transition-all duration-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
              placeholder="CSE-1A&#10;CSE-1B, 55&#10;ECE-1A, 45&#10;ME-1A"
            />
          </FormField>

          <div className="flex justify-end gap-3 pt-3 border-t border-white/[0.06]">
            <Button variant="ghost" onClick={() => setIsBulkOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleBulkAdd}
              icon={<Plus size={14} />}
            >
              Add Batches
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

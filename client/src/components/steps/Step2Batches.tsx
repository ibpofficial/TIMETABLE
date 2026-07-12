import { useState } from 'react';
import { Users } from 'lucide-react';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, Chip, EmptyState, FormField, Input, SectionHeader, ConfirmModal } from '../ui';
import { StepNav } from './StepNav';
import { toast } from 'sonner';

export function Step2Batches() {
  const { batches, batchSizes, addBatch, removeBatch } = useTimetableStore();
  const [input, setInput] = useState('');
  const [size, setSize] = useState('60');
  const [error, setError] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

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
                onRemove={() => removeBatch(b)}
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
    </div>
  );
}

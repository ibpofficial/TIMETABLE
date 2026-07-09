import { useState } from 'react';
import { Users } from 'lucide-react';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, Chip, EmptyState, FormField, Input, SectionHeader } from '../ui';
import { StepNav } from './StepNav';
import { toast } from 'sonner';

export function Step2Batches() {
  const { batches, addBatch, removeBatch } = useTimetableStore();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const handleAdd = () => {
    const name = input.trim();
    if (!name) { setError('Batch name cannot be empty.'); return; }
    if (batches.includes(name)) { setError(`"${name}" already exists.`); return; }
    if (!/^[A-Za-z0-9\-_\s]+$/.test(name)) { setError('Batch name can only contain letters, numbers, hyphens, or spaces.'); return; }
    addBatch(name);
    setInput('');
    setError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
  };

  const validate = () => {
    if (batches.length === 0) {
      toast.error('Add at least one batch before proceeding.');
      return false;
    }
    return true;
  };

  return (
    <div>
      <SectionHeader
        title="Step 2 — Batches"
        subtitle="Define student groups (e.g. CSE-3A, ECE-2B). Subjects will be assigned per batch."
      />

      <Card className="mb-5">
        <div className="flex gap-3 items-end">
          <FormField label="Batch Name" htmlFor="batchNameInput" error={error} className="flex-1">
            <Input
              id="batchNameInput"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(''); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g., CSE-3A"
              error={!!error}
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
                label={b}
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
    </div>
  );
}

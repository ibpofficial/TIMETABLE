import { useState } from 'react';
import { Building2, FolderOpen, Plus, Trash2, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, Chip, EmptyState, FormField, Input, SectionHeader, ConfirmModal } from '../ui';
import type { Department, Program } from '../../types';

let deptIdCounter = 1;
const genDeptId = () => `D${deptIdCounter++}_${Date.now().toString(36)}`;
let progIdCounter = 1;
const genProgId = () => `P${progIdCounter++}_${Date.now().toString(36)}`;

export function Step0Departments() {
  const { departments, programs, batches, batchDetails,
    addDepartment, removeDepartment, addProgram, removeProgram, setBatchDetails } = useTimetableStore();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const [deptForm, setDeptForm] = useState({ name: '', code: '' });
  const [deptError, setDeptError] = useState('');

  const [progForm, setProgForm] = useState({ name: '', departmentId: '' });
  const [progError, setProgError] = useState('');

  const handleAddDept = () => {
    if (!deptForm.name.trim()) { setDeptError('Department name is required.'); return; }
    if (!deptForm.code.trim()) { setDeptError('Department code is required (e.g. CS, ME).'); return; }
    if (departments.some(d => d.code.toLowerCase() === deptForm.code.toLowerCase())) {
      setDeptError('A department with this code already exists.'); return;
    }
    const dept: Department = { id: genDeptId(), name: deptForm.name.trim(), code: deptForm.code.trim().toUpperCase() };
    addDepartment(dept);
    setDeptForm({ name: '', code: '' });
    setDeptError('');
    toast.success(`Department "${dept.name}" added.`);
  };

  const handleAddProg = () => {
    if (!progForm.name.trim()) { setProgError('Program name is required.'); return; }
    if (!progForm.departmentId) { setProgError('Select a department for this program.'); return; }
    const prog: Program = { id: genProgId(), name: progForm.name.trim(), departmentId: progForm.departmentId };
    addProgram(prog);
    setProgForm({ name: '', departmentId: '' });
    setProgError('');
    toast.success(`Program "${prog.name}" added.`);
  };

  return (
    <div>
      <SectionHeader
        title="Step 0 — Departments & Programs"
        subtitle="Define your college's departmental structure. Batches, subjects, and faculty can be linked to departments for college-wide management."
        onClear={() => setShowClearConfirm(true)}
      />

      {/* ── Add Department ────────────────────────────── */}
      <Card className="mb-5">
        <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Building2 size={16} className="text-brand" /> Add Department
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label="Department Name" htmlFor="deptName" className="sm:col-span-2" error={deptError}>
            <Input
              id="deptName"
              value={deptForm.name}
              onChange={e => { setDeptForm({ ...deptForm, name: e.target.value }); setDeptError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleAddDept()}
              placeholder="e.g. Computer Science & Engineering"
              error={!!deptError}
            />
          </FormField>
          <FormField label="Short Code" htmlFor="deptCode">
            <Input
              id="deptCode"
              value={deptForm.code}
              onChange={e => setDeptForm({ ...deptForm, code: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && handleAddDept()}
              placeholder="e.g. CS"
              maxLength={6}
            />
          </FormField>
        </div>
        <div className="mt-3 flex justify-end">
          <Button id="btn-add-dept" variant="primary" icon={<Plus size={14} />} onClick={handleAddDept}>
            Add Department
          </Button>
        </div>
      </Card>

      {/* ── Departments List ──────────────────────────── */}
      {departments.length === 0 ? (
        <EmptyState
          icon={<Building2 size={36} className="text-slate-600" />}
          title="No departments yet"
          description="Add your first department above. You can skip this step if you don't need department-level grouping."
        />
      ) : (
        <div className="grid gap-4 mb-6">
          {departments.map(dept => {
            const deptPrograms = programs.filter(p => p.departmentId === dept.id);
            return (
              <Card key={dept.id} className="border-white/[0.08]">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand/20 to-brand-light/10 flex items-center justify-center border border-brand/20">
                      <span className="text-xs font-black text-brand">{dept.code}</span>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-200">{dept.name}</p>
                      <p className="text-xs text-slate-500">{deptPrograms.length} program(s)</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!confirm(`Remove department "${dept.name}" and unlink all its programs?`)) return;
                      removeDepartment(dept.id);
                    }}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                {deptPrograms.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {deptPrograms.map(p => (
                      <Chip
                        key={p.id}
                        label={p.name}
                        onRemove={() => removeProgram(p.id)}
                        color="blue"
                      />
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Add Program ──────────────────────────────── */}
      {departments.length > 0 && (
        <Card className="mb-5">
          <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <FolderOpen size={16} className="text-brand" /> Add Program / Degree
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Program Name" htmlFor="progName" className="sm:col-span-2" error={progError}>
              <Input
                id="progName"
                value={progForm.name}
                onChange={e => { setProgForm({ ...progForm, name: e.target.value }); setProgError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleAddProg()}
                placeholder="e.g. B.Tech Computer Science"
                error={!!progError}
              />
            </FormField>
            <FormField label="Department">
              <select
                value={progForm.departmentId}
                onChange={e => setProgForm({ ...progForm, departmentId: e.target.value })}
                className="w-full bg-[#0d1225] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand"
              >
                <option value="">Select department…</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </FormField>
          </div>
          <div className="mt-3 flex justify-end">
            <Button id="btn-add-prog" variant="primary" icon={<Plus size={14} />} onClick={handleAddProg}>
              Add Program
            </Button>
          </div>
        </Card>
      )}

      {/* ── Batch → Program Mapping ───────────────────── */}
      {batches.length > 0 && programs.length > 0 && (
        <Card>
          <h3 className="font-semibold text-slate-200 mb-1 flex items-center gap-2">
            <Tag size={15} className="text-brand" /> Link Batches to Programs
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Assign each batch to a program and semester. This enables department-level filtering on the results dashboard.
          </p>
          <div className="grid gap-3">
            {batches.map(batch => {
              const detail = batchDetails[batch];
              return (
                <div key={batch} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-white/[0.02] rounded-xl border border-white/[0.05]">
                  <span className="font-mono text-sm font-bold text-brand min-w-[100px]">{batch}</span>
                  <div className="flex gap-2 flex-1">
                    <select
                      value={detail?.programId || ''}
                      onChange={e => setBatchDetails(batch, e.target.value, detail?.semester || 1)}
                      className="flex-1 bg-[#0d1225] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      <option value="">No program linked</option>
                      {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <select
                      value={detail?.semester || 1}
                      onChange={e => setBatchDetails(batch, detail?.programId || '', Number(e.target.value))}
                      className="w-28 bg-[#0d1225] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      {[1,2,3,4,5,6,7,8].map(s => <option key={s} value={s}>Sem {s}</option>)}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="mt-6 flex justify-end">
        <Button
          id="btn-dept-skip"
          variant="ghost"
          onClick={() => useTimetableStore.getState().setStep(1)}
        >
          {departments.length === 0 ? 'Skip (No Departments)' : 'Continue to Institution Setup →'}
        </Button>
      </div>
      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          useTimetableStore.getState().clearStepData(0);
          toast.success('Department data cleared.');
        }}
        title="Clear Departments & Programs"
        message="Are you sure you want to clear all departments, programs, and program linkages? This cannot be undone."
        confirmLabel="Clear Page"
      />
    </div>
  );
}

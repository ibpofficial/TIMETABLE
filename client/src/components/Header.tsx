import { useState } from 'react';
import { toast } from 'sonner';
import { Download, Upload, RotateCcw, Save, Database, Trash2, Loader2, Cloud } from 'lucide-react';
import { useTimetableStore } from '../store/useTimetableStore';
import { Button, ConfirmModal } from './ui';
import {
  fsListConfigs, fsSaveConfig, fsUpdateConfig, fsLoadConfig, fsDeleteConfig
} from '../lib/firestore';
import type { SchedulerConfig, SavedConfig } from '../types';

export function Header() {
  const store = useTimetableStore();
  const [saving, setSaving] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Cloud loading state
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [configs, setConfigs] = useState<SavedConfig[]>([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);

  // Build SchedulerConfig from store for export / save
  const buildConfig = (): SchedulerConfig => ({
    days: store.days,
    startTime: store.startTime,
    endTime: store.endTime,
    slotLength: store.slotLength,
    maxClassesPerDay: store.maxClassesPerDay,
    rooms: { theoryList: store.theoryRooms, labList: store.labRooms },
    batches: store.batches,
    batchSizes: store.batchSizes,
    faculties: store.faculties,
    subjects: store.subjects,
    breaks: store.breaks,
    events: store.events,
    options: store.solverOptions,
    departments: store.departments,
    programs: store.programs,
    batchDetails: store.batchDetails,
  });

  // ── Local JSON Export ────────────────────────────────────────────
  const handleLocalExport = () => {
    const cfg = buildConfig();
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ibp-timetable-setup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Configuration exported!');
  };

  // ── Local JSON Import ────────────────────────────────────────────
  const handleLocalImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const cfg: SchedulerConfig = JSON.parse(text);
        store.loadConfig(cfg);
        toast.success('Configuration imported!');
      } catch {
        toast.error('Failed to parse JSON file. Please check the file format.');
      }
    };
    input.click();
  };

  // ── Cloud Save (Firestore) ───────────────────────────────────────
  const handleCloudSave = async () => {
    const name = prompt('Enter a name for this configuration:')?.trim();
    if (!name) return;
    setSaving(true);
    try {
      const cfg = buildConfig();
      // If already saved, update instead of creating duplicate
      if (store.savedConfigId) {
        await fsUpdateConfig(store.savedConfigId, name, cfg);
        toast.success(`Updated "${name}" in Firebase! 🔥`);
      } else {
        const result = await fsSaveConfig(name, cfg, store.sessionId);
        store.setSavedConfigId(result.id);
        toast.success(`Saved "${result.name}" to Firebase! 🔥`);
      }
    } catch (err: any) {
      toast.error('Firebase save failed: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Cloud Load (Firestore) ───────────────────────────────────────
  const handleOpenLoad = async () => {
    setLoadingConfigs(true);
    setShowLoadModal(true);
    try {
      const list = await fsListConfigs(store.sessionId);
      setConfigs(list);
    } catch (err: any) {
      toast.error('Failed to list Firebase configurations: ' + err.message);
    } finally {
      setLoadingConfigs(false);
    }
  };

  const handleLoad = async (id: string) => {
    try {
      const result = await fsLoadConfig(id);
      store.loadConfig(result.data);
      store.setSavedConfigId(result.id);
      setShowLoadModal(false);
      toast.success(`Loaded "${result.name}" from Firebase! 🔥`);
    } catch (err: any) {
      toast.error('Failed to load configuration: ' + err.message);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this configuration?')) return;
    try {
      await fsDeleteConfig(id);
      setConfigs((prev) => prev.filter((c) => c.id !== id));
      if (store.savedConfigId === id) {
        store.setSavedConfigId(null);
      }
      toast.success('Configuration deleted from Firebase.');
    } catch (err: any) {
      toast.error('Failed to delete configuration: ' + err.message);
    }
  };

  // ── Reset All ────────────────────────────────────────────────────
  const handleReset = () => {
    setShowResetConfirm(true);
  };

  const executeReset = () => {
    store.resetAll();
    toast.info('Configuration reset.');
  };

  return (
    <>
      <header className="sticky top-0 z-50 flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-white/[0.07] backdrop-blur-xl bg-[rgba(5,8,20,0.85)] animate-slide-down no-print">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand to-brand-light flex items-center justify-center text-white font-black text-sm shadow-lg hover:rotate-12 transition-transform duration-300 cursor-default">
            IBP
          </div>
          <div className="hidden sm:block">
            <h1 className="text-lg font-bold bg-gradient-to-r from-brand to-brand-light bg-clip-text text-transparent leading-none">
              IBP Timetable Generator
            </h1>
            <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
              Smart constraint-aware scheduling
              <span className="flex items-center gap-1 bg-orange-500/10 text-orange-400 border border-orange-500/20 px-1.5 py-0.5 rounded-full text-[9px] font-bold">
                <Cloud size={8} /> Firebase
              </span>
            </p>
          </div>
        </div>

        {/* Actions */}
        <nav className="flex items-center gap-2" aria-label="Configuration actions">
          <Button
            id="btn-import-config"
            variant="ghost"
            size="sm"
            icon={<Upload size={13} />}
            onClick={handleLocalImport}
            title="Import configuration from JSON file"
          >
            <span className="hidden sm:inline">Import</span>
          </Button>

          <Button
            id="btn-export-config"
            variant="ghost"
            size="sm"
            icon={<Download size={13} />}
            onClick={handleLocalExport}
            title="Export configuration to JSON file"
          >
            <span className="hidden sm:inline">Export</span>
          </Button>

          <Button
            id="btn-cloud-load"
            variant="ghost"
            size="sm"
            icon={<Database size={13} />}
            onClick={handleOpenLoad}
            title="Load configuration from Firebase"
          >
            <span className="hidden sm:inline">Load</span>
          </Button>

          <Button
            id="btn-cloud-save"
            variant="ghost"
            size="sm"
            icon={<Save size={13} />}
            onClick={handleCloudSave}
            loading={saving}
            title="Save configuration to Firebase"
          >
            <span className="hidden sm:inline">Save</span>
          </Button>

          <Button
            id="btn-reset-all"
            variant="danger"
            size="sm"
            icon={<RotateCcw size={13} />}
            onClick={handleReset}
            title="Reset all configuration"
          >
            <span className="hidden sm:inline">Reset</span>
          </Button>
        </nav>
      </header>

      {/* Firebase Load Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 z-55 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in" style={{ zIndex: 9999 }}>
          <div className="bg-[#121832] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl relative animate-pop-in">
            <h3 className="text-lg font-bold text-slate-100 mb-1 flex items-center gap-2">
              <Database size={18} className="text-orange-400" />
              Load from Firebase
            </h3>
            <p className="text-xs text-slate-500 mb-4">Configurations saved to your Firebase project (session: <code className="text-brand text-[10px]">{store.sessionId.slice(0, 16)}…</code>)</p>
            {loadingConfigs ? (
              <div className="flex flex-col items-center py-8 gap-2 text-slate-400">
                <Loader2 className="animate-spin text-orange-400" size={24} />
                <span className="text-xs">Fetching from Firebase…</span>
              </div>
            ) : configs.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                <p>No saved configurations found for this session.</p>
                <p className="text-xs mt-1 text-slate-600">Use "Save" to store your first config to Firebase.</p>
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {configs.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => handleLoad(c.id)}
                    className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-orange-500/20 cursor-pointer transition-all duration-200 group"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-sm font-semibold text-slate-200 truncate group-hover:text-orange-300 transition-colors">{c.name}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Updated: {new Date(c.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={(e) => handleDelete(c.id, e)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                      title="Delete saved configuration"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-5 flex justify-end">
              <Button variant="ghost" onClick={() => setShowLoadModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={executeReset}
        title="Reset Configuration"
        message="Are you sure you want to clear all batches, faculties, subjects, breaks, and events? This configuration data cannot be recovered."
        confirmLabel="Reset All"
      />
    </>
  );
}

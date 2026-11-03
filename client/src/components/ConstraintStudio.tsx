import { useState, useMemo } from 'react';
import { Sliders, Search, Sparkles, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTimetableStore } from '../store/useTimetableStore';
import { Card, Button, Input, Badge } from './ui';
import { parseNaturalLanguageConstraint } from '@ibp/shared';
import type { ConstraintTemplate } from '@ibp/shared';

export function ConstraintStudio() {
  const store = useTimetableStore();
  const { constraints, toggleConstraint, setConstraintWeight, addCustomConstraint } = store;

  const [search, setSearch] = useState('');
  const [selectedScope, setSelectedScope] = useState<string>('all');
  const [selectedKind, setSelectedKind] = useState<string>('all');

  // Natural Language Assistant state
  const [nlPrompt, setNlPrompt] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [previewRule, setPreviewRule] = useState<ConstraintTemplate | null>(null);

  // Filter constraints
  const filteredConstraints = useMemo(() => {
    return constraints.filter((c) => {
      const matchSearch =
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.description.toLowerCase().includes(search.toLowerCase());
      const matchScope = selectedScope === 'all' || c.scope === selectedScope;
      const matchKind = selectedKind === 'all' || c.kind === selectedKind;
      return matchSearch && matchScope && matchKind;
    });
  }, [constraints, search, selectedScope, selectedKind]);

  const activeCount = constraints.filter((c) => c.enabled).length;
  const hardCount = constraints.filter((c) => c.enabled && c.kind === 'HARD').length;
  const softCount = constraints.filter((c) => c.enabled && c.kind === 'SOFT').length;

  const handleParseNl = () => {
    if (!nlPrompt.trim()) return;
    setNlLoading(true);

    try {
      const context = {
        faculties: store.faculties.map((f) => f.name),
        batches: store.batches,
        rooms: [...store.theoryRooms, ...store.labRooms].map((r) => r.name),
        days: store.days,
      };

      const parsed = parseNaturalLanguageConstraint(nlPrompt, context);
      setPreviewRule(parsed);
      toast.info('Rule recognized! Please review preview before applying.');
    } catch (err: any) {
      toast.error('Failed to parse constraint: ' + err.message);
    } finally {
      setNlLoading(false);
    }
  };

  const handleApplyPreviewRule = () => {
    if (!previewRule) return;
    addCustomConstraint(previewRule);
    toast.success(`Constraint "${previewRule.name}" applied successfully!`);
    setPreviewRule(null);
    setNlPrompt('');
  };

  return (
    <div className="space-y-6">
      {/* Header and Stats */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900/60 p-4 rounded-2xl border border-white/5">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Sliders className="text-brand-light" size={20} />
            Constraint Studio
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Configure 30+ industrial scheduling rules, calibrate penalty weights, or formulate custom constraints.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="default" className="text-xs py-1 px-3 bg-brand/20 text-brand-light border-brand/30">
            {activeCount} Active Rules
          </Badge>
          <span className="text-xs text-slate-400 font-mono">
            {hardCount} Hard · {softCount} Soft
          </span>
        </div>
      </div>

      {/* Natural Language Constraint Assistant */}
      <Card className="border-brand/20 bg-gradient-to-r from-brand/5 via-transparent to-brand-light/5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="text-brand-light animate-pulse" size={18} />
            <span className="text-sm font-bold text-white">Natural Language Constraint Assistant</span>
          </div>
          <span className="text-[11px] text-slate-400 font-mono">Instant Regex + Semantic Parser</span>
        </div>

        <div className="flex gap-2">
          <Input
            value={nlPrompt}
            onChange={(e) => setNlPrompt(e.target.value)}
            placeholder="Type a rule (e.g. 'Dr. Rao never teaches after 2pm on Fridays', 'Max 2 consecutive hours for Batch CS')"
            className="flex-1 bg-slate-950/60 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleParseNl();
            }}
          />
          <Button
            onClick={handleParseNl}
            disabled={!nlPrompt.trim() || nlLoading}
            variant="primary"
            className="shrink-0"
          >
            {nlLoading ? 'Parsing...' : 'Preview Rule'}
          </Button>
        </div>

        {/* Prompt Suggestions */}
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="text-[11px] text-slate-500 font-medium">Quick examples:</span>
          {[
            'Dr. Rao never teaches after 2pm on Fridays',
            'Batch A max 2 consecutive classes',
            'No 8am classes for Batch B',
            'Room 101 only for theory',
          ].map((sample, i) => (
            <button
              key={i}
              onClick={() => setNlPrompt(sample)}
              className="text-[11px] px-2.5 py-1 bg-white/[0.03] hover:bg-white/[0.08] text-slate-300 rounded-full border border-white/5 transition"
            >
              "{sample}"
            </button>
          ))}
        </div>

        {/* Preview Card */}
        {previewRule && (
          <div className="mt-4 p-4 rounded-xl bg-slate-950/80 border border-brand/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant={previewRule.kind === 'HARD' ? 'error' : 'warning'}>
                  {previewRule.kind}
                </Badge>
                <span className="text-sm font-semibold text-white">{previewRule.name}</span>
              </div>
              <span className="text-xs text-slate-400 font-mono uppercase">Scope: {previewRule.scope}</span>
            </div>

            <p className="text-xs text-slate-300">{previewRule.description}</p>

            <pre className="text-[11px] font-mono bg-black/40 p-2.5 rounded-lg text-emerald-400 overflow-x-auto border border-white/5">
              {JSON.stringify(previewRule, null, 2)}
            </pre>

            <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
              <Button size="sm" variant="ghost" onClick={() => setPreviewRule(null)}>
                <X size={14} className="mr-1" /> Discard
              </Button>
              <Button size="sm" variant="primary" onClick={handleApplyPreviewRule}>
                <Check size={14} className="mr-1" /> Apply Constraint
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-sm">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={15} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search constraints..."
              className="w-full pl-9 pr-3 py-1.5 bg-slate-950/60 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-brand"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Scope Filters */}
          <div className="flex bg-slate-950/60 p-1 rounded-xl border border-white/5 text-[11px]">
            {['all', 'global', 'faculty', 'batch', 'room', 'subject'].map((scope) => (
              <button
                key={scope}
                onClick={() => setSelectedScope(scope)}
                className={`px-2.5 py-1 rounded-lg capitalize transition ${
                  selectedScope === scope
                    ? 'bg-brand text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {scope}
              </button>
            ))}
          </div>

          {/* Kind Filters */}
          <div className="flex bg-slate-950/60 p-1 rounded-xl border border-white/5 text-[11px]">
            {['all', 'HARD', 'SOFT'].map((kind) => (
              <button
                key={kind}
                onClick={() => setSelectedKind(kind)}
                className={`px-2.5 py-1 rounded-lg transition ${
                  selectedKind === kind
                    ? 'bg-brand text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {kind}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Constraints List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredConstraints.map((constraint) => (
          <div
            key={constraint.id}
            className={`p-4 rounded-xl border transition ${
              constraint.enabled
                ? 'bg-slate-900/40 border-white/10 shadow-sm'
                : 'bg-slate-950/20 border-white/5 opacity-60'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant={constraint.kind === 'HARD' ? 'error' : 'default'} className={constraint.kind === 'SOFT' ? 'bg-brand/20 text-brand-light border-brand/30' : ''}>
                    {constraint.kind}
                  </Badge>
                  <span className="text-[10px] text-slate-500 font-mono uppercase">
                    {constraint.scope}
                  </span>
                  <h4 className="text-sm font-semibold text-white">{constraint.name}</h4>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {constraint.description}
                </p>
              </div>

              {/* Toggle Switch */}
              <button
                onClick={() => toggleConstraint(constraint.id)}
                className={`w-11 h-6 flex items-center rounded-full p-1 transition duration-300 shrink-0 ${
                  constraint.enabled ? 'bg-brand' : 'bg-slate-800'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition duration-300 ${
                    constraint.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Weight Slider for Soft Constraints */}
            {constraint.kind === 'SOFT' && constraint.enabled && (
              <div className="mt-4 pt-3 border-t border-white/5 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-medium">Penalty Weight</span>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-brand-light font-bold">{constraint.weight}</span>
                    <span className="text-[10px] text-slate-500">
                      ({constraint.weight <= 30 ? 'Low' : constraint.weight <= 80 ? 'Medium' : constraint.weight <= 200 ? 'High' : 'Strict'})
                    </span>
                  </div>
                </div>

                <input
                  type="range"
                  min="0"
                  max="1000"
                  step="10"
                  value={constraint.weight}
                  onChange={(e) => setConstraintWeight(constraint.id, parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-brand"
                />

                <div className="flex gap-1.5 pt-1">
                  {[25, 50, 100, 250, 500].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setConstraintWeight(constraint.id, preset)}
                      className={`text-[10px] px-2 py-0.5 rounded font-mono transition ${
                        constraint.weight === preset
                          ? 'bg-brand/30 text-brand-light border border-brand/50'
                          : 'bg-white/[0.03] text-slate-400 hover:text-white'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

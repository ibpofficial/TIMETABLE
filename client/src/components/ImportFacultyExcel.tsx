import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { useTimetableStore } from '../store/useTimetableStore';
import { Button, Select, Input, Badge } from './ui';
import { UploadCloud, Download, AlertTriangle, Check, RefreshCw, X } from 'lucide-react';
import type { Faculty, Subject } from '../types';

interface ParsedSubject {
  name: string;
  type: 'theory' | 'practical';
  existingId: string | null;
}

interface ParsedFacultyRow {
  id: string;
  name: string;
  maxWeeklySlots: number;
  departmentId: string | null;
  isExisting: boolean;
  subjects: ParsedSubject[];
  selected: boolean;
  warnings: string[];
}

interface ImportFacultyExcelProps {
  onClose: () => void;
}

const teacherRegex = /teacher|faculty|name|staff|instructor|prof/i;
const subjectsRegex = /subject|course|class|taught/i;
const typeRegex = /type|category/i;
const deptRegex = /dept|department|program/i;
const maxSlotsRegex = /max.*slots|slots.*week|workload|weekly/i;

const matchHeader = (headers: string[], regex: RegExp): string | null => {
  for (const h of headers) {
    if (regex.test(h.toLowerCase().trim())) {
      return h;
    }
  }
  return null;
};

export default function ImportFacultyExcel({ onClose }: ImportFacultyExcelProps) {
  const store = useTimetableStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [parsedData, setParsedData] = useState<ParsedFacultyRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);

  // Generate Excel template dynamically
  const downloadTemplate = () => {
    const data = [
      {
        'Teacher Name': 'Dr. Alan Turing',
        'Subject(s)': 'Algorithms, Theory of Computation, AI Lab',
        'Type': 'Theory, Theory, Practical',
        'Department': 'CSE',
        'Max Weekly Slots': 18
      },
      {
        'Teacher Name': 'Grace Hopper',
        'Subject(s)': 'Compiler Design, Programming Lab',
        'Type': 'Theory, Practical',
        'Department': 'CSE',
        'Max Weekly Slots': 16
      }
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Faculty_Subjects_Template.xlsx');
    toast.success('Downloaded template successfully!');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setLoading(true);
    setErrors([]);
    setParsedData([]);

    const fileReader = new FileReader();
    fileReader.onload = (evt) => {
      try {
        const buffer = evt.target?.result;
        const workbook = XLSX.read(buffer, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet) as any[];

        if (rawData.length === 0) {
          setErrors(['Spreadsheet contains no data rows.']);
          setLoading(false);
          return;
        }

        const headers = Object.keys(rawData[0]);
        const matchedTeacher = matchHeader(headers, teacherRegex);
        const matchedSubjects = matchHeader(headers, subjectsRegex);
        const matchedType = matchHeader(headers, typeRegex);
        const matchedDept = matchHeader(headers, deptRegex);
        const matchedMaxSlots = matchHeader(headers, maxSlotsRegex);

        if (!matchedTeacher) {
          setErrors(['Could not map a "Teacher Name" column. Please label your column "Teacher Name" or "Name".']);
          setLoading(false);
          return;
        }

        const rows: ParsedFacultyRow[] = [];
        const parseLogs: string[] = [];

        rawData.forEach((row, index) => {
          const rawTeacherName = String(row[matchedTeacher] || '').trim();
          if (!rawTeacherName) {
            parseLogs.push(`Row ${index + 2}: Teacher name is blank, skipped.`);
            return;
          }

          const rawSubjectsStr = matchedSubjects ? String(row[matchedSubjects] || '') : '';
          const rawTypesStr = matchedType ? String(row[matchedType] || '') : '';
          const deptName = matchedDept ? String(row[matchedDept] || '').trim() : '';
          const maxSlotsVal = matchedMaxSlots ? Number(row[matchedMaxSlots]) : 18;

          const parsedSubjects = rawSubjectsStr
            .split(/[,;\n]/)
            .map(s => s.trim())
            .filter(Boolean);

          const parsedTypes = rawTypesStr
            .split(/[,;\n]/)
            .map(t => t.trim().toLowerCase())
            .filter(Boolean);

          const subjectsData = parsedSubjects.map((subName, subIdx) => {
            let guessedType: 'theory' | 'practical' = 'theory';
            if (parsedTypes[subIdx]) {
              const explicitType = parsedTypes[subIdx];
              if (explicitType.includes('lab') || explicitType.includes('prac') || explicitType === 'p' || explicitType.includes('practical')) {
                guessedType = 'practical';
              }
            } else if (/lab|practical|\(p\)/i.test(subName)) {
              guessedType = 'practical';
            }

            const existingSub = store.subjects.find(s => s.name.toLowerCase() === subName.toLowerCase());

            return {
              name: subName,
              type: guessedType,
              existingId: existingSub?.id || null,
            };
          });

          const existingFac = store.faculties.find(f => f.name.toLowerCase() === rawTeacherName.toLowerCase());

          let departmentId: string | null = null;
          if (deptName && store.departments) {
            const matchedDeptObj = store.departments.find(
              d => d.name.toLowerCase() === deptName.toLowerCase() || d.code.toLowerCase() === deptName.toLowerCase()
            );
            if (matchedDeptObj) departmentId = matchedDeptObj.id;
          }

          const rowWarnings: string[] = [];
          if (parsedSubjects.length === 0) rowWarnings.push('No subjects specified.');
          if (deptName && !departmentId) rowWarnings.push(`Department "${deptName}" not matched.`);

          rows.push({
            id: existingFac?.id || `new_fac_${index}_${Math.random().toString(36).slice(2, 6)}`,
            name: rawTeacherName,
            maxWeeklySlots: isNaN(maxSlotsVal) ? 18 : maxSlotsVal,
            departmentId,
            isExisting: !!existingFac,
            subjects: subjectsData,
            selected: true,
            warnings: rowWarnings,
          });
        });

        setParsedData(rows);
        setErrors(parseLogs);
      } catch (err: any) {
        setErrors([`Excel parsing error: ${err.message || String(err)}`]);
      } finally {
        setLoading(false);
      }
    };

    fileReader.readAsBinaryString(file);
  };

  const handleToggleRow = (rowId: string) => {
    setParsedData(prev =>
      prev.map(row => (row.id === rowId ? { ...row, selected: !row.selected } : row))
    );
  };

  const handleUpdateTeacherName = (rowId: string, value: string) => {
    setParsedData(prev =>
      prev.map(row => (row.id === rowId ? { ...row, name: value } : row))
    );
  };

  const handleUpdateWeeklySlots = (rowId: string, value: number) => {
    setParsedData(prev =>
      prev.map(row => (row.id === rowId ? { ...row, maxWeeklySlots: value } : row))
    );
  };

  const handleUpdateSubjectType = (rowId: string, subIdx: number, type: 'theory' | 'practical') => {
    setParsedData(prev =>
      prev.map(row => {
        if (row.id !== rowId) return row;
        const updatedSubs = [...row.subjects];
        updatedSubs[subIdx] = { ...updatedSubs[subIdx], type };
        return { ...row, subjects: updatedSubs };
      })
    );
  };

  const handleCommit = () => {
    const selectedRows = parsedData.filter(r => r.selected);
    if (selectedRows.length === 0) {
      toast.error('Select at least one faculty row to import.');
      return;
    }

    let facultyAddedCount = 0;
    let facultyUpdatedCount = 0;
    let subjectsCreatedCount = 0;

    selectedRows.forEach(row => {
      // 1. Save Faculty
      if (row.isExisting) {
        store.updateFaculty(row.id, {
          name: row.name,
          maxWeeklySlots: row.maxWeeklySlots,
          departmentId: row.departmentId,
        });
        facultyUpdatedCount++;
      } else {
        const newFac: Faculty = {
          id: row.id.startsWith('new_') ? `F_imp_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}` : row.id,
          name: row.name,
          leaves: 1,
          maxWeeklySlots: row.maxWeeklySlots,
          unavail: [],
          departmentId: row.departmentId,
        };
        store.addFaculty(newFac);
        facultyAddedCount++;
        // Update row ID reference for linking subjects next
        row.id = newFac.id;
      }

      // 2. Save Subjects Taught by Faculty
      row.subjects.forEach(sub => {
        // If subject exists, link facultyId to it
        if (sub.existingId) {
          store.updateSubject(sub.existingId, { facultyId: row.id });
        } else {
          // Check if we already created a subject with this name in this import run to prevent duplicates
          const storeSubMatch = store.subjects.find(s => s.name.toLowerCase() === sub.name.toLowerCase());
          if (storeSubMatch) {
            store.updateSubject(storeSubMatch.id, { facultyId: row.id });
          } else {
            const newSub: Subject = {
              id: `S_imp_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`,
              name: sub.name,
              type: sub.type,
              classesPerWeek: sub.type === 'practical' ? 1 : 3,
              sessionLength: sub.type === 'practical' ? 2 : 1,
              facultyId: row.id,
              batches: store.batches.length > 0 ? [store.batches[0]] : [], // fallback to first batch
              unavail: [],
            };
            store.addSubject(newSub);
            subjectsCreatedCount++;
          }
        }
      });
    });

    toast.success(`Import success! Added ${facultyAddedCount} faculty, updated ${facultyUpdatedCount} faculty, and created ${subjectsCreatedCount} new subjects.`);
    onClose();
  };

  return (
    <div className="space-y-6">
      {/* File Dropzone & Guide when no file is uploaded yet */}
      {parsedData.length === 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left panel: Detailed Instructions & Live Template Preview */}
          <div className="lg:col-span-3 space-y-5">
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05] space-y-4">
              <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-brand/10 border border-brand/20 text-[10px] text-brand font-black">1</span>
                How Spreadsheet Import Works
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                The smart importer maps your faculties and their course assignments in bulk. It automatically matches column headers (fuzzy matches like <em>Teacher Name</em>, <em>Staff</em>, <em>Subjects Taught</em>, etc.) and populates the data.
              </p>

              <div className="space-y-2">
                <h5 className="text-[10px] font-black uppercase tracking-wider text-slate-500">Demo Excel Layout format</h5>
                
                {/* Mock spreadsheet preview */}
                <div className="border border-white/[0.08] rounded-xl overflow-hidden bg-black/20 text-[11px] font-mono shadow-inner">
                  <div className="grid grid-cols-5 bg-white/[0.04] border-b border-white/[0.06] font-bold text-slate-300 p-2 text-[10px]">
                    <div className="truncate px-1 border-r border-white/5">Teacher Name</div>
                    <div className="truncate px-1 border-r border-white/5">Subject(s)</div>
                    <div className="truncate px-1 border-r border-white/5">Type</div>
                    <div className="truncate px-1 border-r border-white/5">Department</div>
                    <div className="truncate px-1">Max Slots</div>
                  </div>
                  <div className="grid grid-cols-5 border-b border-white/[0.04] text-slate-400 p-2 text-[10px]">
                    <div className="truncate px-1 border-r border-white/5 text-slate-200 font-sans">Dr. Alan Turing</div>
                    <div className="truncate px-1 border-r border-white/5">Algorithms, AI Lab</div>
                    <div className="truncate px-1 border-r border-white/5">Theory, Practical</div>
                    <div className="truncate px-1 border-r border-white/5">CS</div>
                    <div className="truncate px-1">18</div>
                  </div>
                  <div className="grid grid-cols-5 text-slate-400 p-2 text-[10px]">
                    <div className="truncate px-1 border-r border-white/5 text-slate-200 font-sans">Grace Hopper</div>
                    <div className="truncate px-1 border-r border-white/5">Compiler Design</div>
                    <div className="truncate px-1 border-r border-white/5">Theory</div>
                    <div className="truncate px-1 border-r border-white/5">CS</div>
                    <div className="truncate px-1">16</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-[11px] text-slate-400">
                <div className="p-3 rounded-xl bg-white/[0.01] border border-white/[0.04] space-y-1">
                  <strong className="text-slate-300 block">💡 Multiple Subjects Mapping</strong>
                  Separate multiple subjects with a comma or semi-colon (e.g. <code>Algorithms, AI Lab</code>).
                </div>
                <div className="p-3 rounded-xl bg-white/[0.01] border border-white/[0.04] space-y-1">
                  <strong className="text-slate-300 block">🔍 Auto Lab Detection</strong>
                  Subjects containing 'Lab', 'Practical', or '(P)' are auto-classified as Practicals.
                </div>
              </div>
            </div>
          </div>

          {/* Right panel: Upload / Download Zone */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex flex-col justify-between flex-1 gap-4">
              <div className="space-y-1.5">
                <h4 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-brand/10 border border-brand/20 text-[10px] text-brand font-black">2</span>
                  Action Center
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Download the boilerplate file, add your staff records, and upload it here.
                </p>
              </div>

              <Button
                variant="ghost"
                icon={<Download size={14} />}
                onClick={downloadTemplate}
                className="w-full justify-center bg-white/[0.03] border-white/10 hover:bg-white/[0.06] hover:border-brand/20 text-slate-200 text-xs py-2.5 h-auto font-bold"
              >
                Download Excel Template
              </Button>

              <div className="border-t border-white/[0.06] my-1" />

              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/10 hover:border-brand/40 bg-white/[0.01] hover:bg-brand/[0.01] transition-all rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer text-center group"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="w-11 h-11 rounded-2xl bg-white/[0.04] group-hover:bg-brand/10 border border-white/10 group-hover:border-brand/20 flex items-center justify-center transition-colors">
                  <UploadCloud size={18} className="text-slate-400 group-hover:text-brand" />
                </div>
                {loading ? (
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 justify-center">
                    <RefreshCw size={12} className="animate-spin text-brand" />
                    <span>Analyzing workbook...</span>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-bold text-slate-200">Drag & drop sheet here, or click to browse</p>
                    <p className="text-[10px] text-slate-500 mt-1">Supports XLSX, XLS, and CSV files</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Parsing Errors/Logs */}
      {errors.length > 0 && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl space-y-1 max-h-40 overflow-y-auto">
          <p className="text-xs font-bold text-red-400 flex items-center gap-1">
            <AlertTriangle size={12} /> Spreadsheet Warnings:
          </p>
          <ul className="list-disc pl-4 text-[10px] text-red-300 space-y-0.5">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Interactive Review Table */}
      {parsedData.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">
              Parsed <strong className="text-slate-300">{parsedData.length}</strong> staff rows from <span className="text-brand font-mono">{fileName}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<X size={12} />}
              onClick={() => {
                setParsedData([]);
                setFileName('');
              }}
            >
              Clear
            </Button>
          </div>

          <div className="border border-white/[0.08] rounded-xl overflow-hidden max-h-96 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-white/[0.03] border-b border-white/[0.06] text-slate-400 font-bold sticky top-0 z-10">
                <tr>
                  <th className="p-3 w-10 text-center">Import</th>
                  <th className="p-3">Faculty / Instructor Name</th>
                  <th className="p-3 w-32">Weekly Load</th>
                  <th className="p-3">Courses / Subjects Mapping</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {parsedData.map((row) => (
                  <tr
                    key={row.id}
                    className={`transition-colors hover:bg-white/[0.01] ${!row.selected ? 'opacity-40' : ''}`}
                  >
                    {/* Checkbox */}
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={() => handleToggleRow(row.id)}
                        className="accent-brand cursor-pointer w-4 h-4"
                      />
                    </td>

                    {/* Teacher name & warning badge */}
                    <td className="p-3 space-y-1">
                      <Input
                        type="text"
                        value={row.name}
                        onChange={(e) => handleUpdateTeacherName(row.id, e.target.value)}
                        className="py-1 px-2.5 text-xs h-8 bg-transparent max-w-xs font-semibold"
                        disabled={!row.selected}
                      />
                      {row.warnings.map((w, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded ml-1">
                          ⚠ {w}
                        </span>
                      ))}
                      {row.isExisting && (
                        <Badge variant="success">Matched Staff</Badge>
                      )}
                    </td>

                    {/* Weekly load slots */}
                    <td className="p-3">
                      <div className="flex items-center gap-1 max-w-[80px]">
                        <Input
                          type="number"
                          min="1"
                          max="48"
                          value={row.maxWeeklySlots}
                          onChange={(e) => handleUpdateWeeklySlots(row.id, Number(e.target.value))}
                          className="py-1 px-2 text-xs text-center"
                          disabled={!row.selected}
                        />
                        <span className="text-[10px] text-slate-500">slots</span>
                      </div>
                    </td>

                    {/* Subjects list & toggle type */}
                    <td className="p-3">
                      {row.subjects.length === 0 ? (
                        <span className="text-slate-600 italic">None</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {row.subjects.map((sub, sIdx) => (
                            <div
                              key={sIdx}
                              className="flex items-center gap-1.5 p-1 px-2 rounded-lg bg-white/[0.03] border border-white/[0.06]"
                            >
                              <span className="font-medium text-slate-300">{sub.name}</span>
                              <Select
                                value={sub.type}
                                onChange={(e) => handleUpdateSubjectType(row.id, sIdx, e.target.value as 'theory' | 'practical')}
                                className="py-0 px-1 h-5 text-[9px] bg-panel border-white/5 rounded w-16"
                                disabled={!row.selected}
                              >
                                <option value="theory">Theory</option>
                                <option value="practical">Lab</option>
                              </Select>
                              {sub.existingId ? (
                                <span className="text-[8px] bg-green-500/10 text-green-400 border border-green-500/20 px-1 rounded">
                                  Matched
                                </span>
                              ) : (
                                <span className="text-[8px] bg-brand/10 text-brand border border-brand/20 px-1 rounded">
                                  New
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/[0.06]">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={<Check size={14} />}
              onClick={handleCommit}
            >
              Confirm Import
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

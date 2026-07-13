import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Button, Select, Input, Badge } from './ui';
import { UploadCloud, Download, AlertTriangle, Check, RefreshCw, X } from 'lucide-react';
import type { Room } from '../types';

interface ParsedRoomRow {
  id: string;
  name: string;
  type: string;
  capacity: number;
  building: string;
  floor: number;
  equipment: string[];
  isExisting: boolean;
  selected: boolean;
  warnings: string[];
}

interface ImportRoomsExcelProps {
  onClose: () => void;
  currentRooms: Room[];
  onImport: (importedRooms: Room[]) => void;
}

const ROOM_TYPES = [
  { value: 'lecture_hall', label: 'Lecture Hall (Theory)' },
  { value: 'seminar_room', label: 'Seminar Room (Theory)' },
  { value: 'auditorium', label: 'Auditorium (Theory)' },
  { value: 'theory', label: 'General Classroom (Theory)' },
  { value: 'computer_lab', label: 'Computer Lab (Lab)' },
  { value: 'lab', label: 'Science Lab (Lab)' },
  { value: 'studio', label: 'Studio/Workshop (Lab)' },
  { value: 'practical', label: 'General Lab (Lab)' },
];

const EQUIPMENT_OPTIONS = [
  { value: 'projector', label: 'Projector' },
  { value: 'smart_board', label: 'Smart Board' },
  { value: 'computers', label: 'PCs' },
  { value: 'special_software', label: 'CS Software' },
];

// Fuzzy matching column header regexes
const roomNameRegex = /room.*name|classroom|room.*code|room|name|code/i;
const typeRegex = /type|category|class/i;
const capacityRegex = /capacity|size|seats|student.*count|max.*students/i;
const buildingRegex = /building|block|bld|bldg/i;
const floorRegex = /floor|level/i;
const equipmentRegex = /equipment|tags|facilities|hardware|assets/i;

const matchHeader = (headers: string[], regex: RegExp): string | null => {
  for (const h of headers) {
    if (regex.test(h.toLowerCase().trim())) {
      return h;
    }
  }
  return null;
};

const detectRoomType = (typeStr: string): string => {
  const s = typeStr.toLowerCase().trim();
  if (s.includes('computer')) return 'computer_lab';
  if (s.includes('seminar')) return 'seminar_room';
  if (s.includes('auditorium')) return 'auditorium';
  if (s.includes('studio') || s.includes('workshop')) return 'studio';
  if (s.includes('lecture')) return 'lecture_hall';
  if (s.includes('lab') || s.includes('practical') || s.includes('science')) return 'lab';
  if (s.includes('theory') || s.includes('classroom')) return 'theory';
  return 'theory';
};

export default function ImportRoomsExcel({ onClose, currentRooms, onImport }: ImportRoomsExcelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [parsedData, setParsedData] = useState<ParsedRoomRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);

  // Generate Excel template dynamically
  const downloadTemplate = () => {
    const data = [
      {
        'Room Name': 'SCI-101',
        'Type': 'Lecture Hall',
        'Capacity': 120,
        'Building': 'SCI',
        'Floor': 1,
        'Equipment': 'Projector'
      },
      {
        'Room Name': 'SCI-103',
        'Type': 'Computer Lab',
        'Capacity': 30,
        'Building': 'SCI',
        'Floor': 1,
        'Equipment': 'PCs, Projector'
      },
      {
        'Room Name': 'MAIN-201',
        'Type': 'Seminar Room',
        'Capacity': 60,
        'Building': 'MAIN',
        'Floor': 2,
        'Equipment': 'Projector, Smart Board'
      }
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Rooms_Template.xlsx');
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
        const matchedRoomName = matchHeader(headers, roomNameRegex);
        const matchedType = matchHeader(headers, typeRegex);
        const matchedCapacity = matchHeader(headers, capacityRegex);
        const matchedBuilding = matchHeader(headers, buildingRegex);
        const matchedFloor = matchHeader(headers, floorRegex);
        const matchedEquipment = matchHeader(headers, equipmentRegex);

        if (!matchedRoomName) {
          setErrors(['Could not map a "Room Name" column. Please label your column "Room Name", "Classroom", or "Room Code".']);
          setLoading(false);
          return;
        }

        const rows: ParsedRoomRow[] = [];
        const parseLogs: string[] = [];

        rawData.forEach((row, index) => {
          const rawRoomName = String(row[matchedRoomName] || '').trim();
          if (!rawRoomName) {
            parseLogs.push(`Row ${index + 2}: Room name is blank, skipped.`);
            return;
          }

          const rawTypeStr = matchedType ? String(row[matchedType] || '') : '';
          const detectedType = detectRoomType(rawTypeStr || rawRoomName);

          const rawCapacityVal = matchedCapacity ? Number(row[matchedCapacity]) : 60;
          const capacity = isNaN(rawCapacityVal) || rawCapacityVal <= 0 ? 60 : rawCapacityVal;

          const building = matchedBuilding ? String(row[matchedBuilding] || '').trim().toUpperCase() : 'MAIN';

          const rawFloorVal = matchedFloor ? Number(row[matchedFloor]) : 1;
          const floor = isNaN(rawFloorVal) ? 1 : rawFloorVal;

          let parsedEquipment: string[] = [];
          if (matchedEquipment && row[matchedEquipment]) {
            const eqStr = String(row[matchedEquipment]);
            const parts = eqStr.split(/[,;\n]/).map(e => e.trim().toLowerCase()).filter(Boolean);
            parts.forEach(part => {
              if (part.includes('projector') || part.includes('proj')) {
                if (!parsedEquipment.includes('projector')) parsedEquipment.push('projector');
              }
              if (part.includes('smart') || part.includes('board') || part.includes('interactive')) {
                if (!parsedEquipment.includes('smart_board')) parsedEquipment.push('smart_board');
              }
              if (part.includes('computer') || part.includes('pc') || part.includes('laptop')) {
                if (!parsedEquipment.includes('computers')) parsedEquipment.push('computers');
              }
              if (part.includes('software') || part.includes('special') || part.includes('cs')) {
                if (!parsedEquipment.includes('special_software')) parsedEquipment.push('special_software');
              }
            });
          }

          if (parsedEquipment.length === 0) {
            if (detectedType === 'computer_lab') {
              parsedEquipment = ['computers', 'projector'];
            } else {
              parsedEquipment = ['projector'];
            }
          }

          const existingRoom = currentRooms.find(r => r.name.toLowerCase() === rawRoomName.toLowerCase());

          const rowWarnings: string[] = [];
          let isSelected = true;

          if (existingRoom) {
            rowWarnings.push('Room name already exists.');
            isSelected = false;
          }

          rows.push({
            id: `room_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
            name: rawRoomName.toUpperCase(),
            type: detectedType,
            capacity,
            building,
            floor,
            equipment: parsedEquipment,
            isExisting: !!existingRoom,
            selected: isSelected,
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

  const handleUpdateRoomName = (rowId: string, value: string) => {
    setParsedData(prev =>
      prev.map(row => {
        if (row.id !== rowId) return row;
        const name = value.toUpperCase();
        const existingRoom = currentRooms.find(r => r.name.toLowerCase() === name.toLowerCase());
        const warnings = existingRoom ? ['Room name already exists.'] : [];
        return { ...row, name: value, warnings };
      })
    );
  };

  const handleUpdateRoomType = (rowId: string, value: string) => {
    setParsedData(prev =>
      prev.map(row => (row.id === rowId ? { ...row, type: value } : row))
    );
  };

  const handleUpdateCapacity = (rowId: string, value: number) => {
    setParsedData(prev =>
      prev.map(row => (row.id === rowId ? { ...row, capacity: value } : row))
    );
  };

  const handleUpdateBuilding = (rowId: string, value: string) => {
    setParsedData(prev =>
      prev.map(row => (row.id === rowId ? { ...row, building: value } : row))
    );
  };

  const handleUpdateFloor = (rowId: string, value: number) => {
    setParsedData(prev =>
      prev.map(row => (row.id === rowId ? { ...row, floor: value } : row))
    );
  };

  const handleToggleEquipment = (rowId: string, eq: string) => {
    setParsedData(prev =>
      prev.map(row => {
        if (row.id !== rowId) return row;
        const current = row.equipment || [];
        const updated = current.includes(eq)
          ? current.filter(x => x !== eq)
          : [...current, eq];
        return { ...row, equipment: updated };
      })
    );
  };

  const handleCommit = () => {
    const selectedRows = parsedData.filter(r => r.selected);
    if (selectedRows.length === 0) {
      toast.error('Select at least one room row to import.');
      return;
    }

    // Check for duplicate names among selected rows
    const selectedNames = selectedRows.map(r => r.name.trim().toLowerCase());
    const duplicates = selectedNames.filter((name, idx) => selectedNames.indexOf(name) !== idx);
    if (duplicates.length > 0) {
      const uniqueDupes = Array.from(new Set(duplicates));
      toast.error(`Cannot import: Selected rows contain duplicate room names: ${uniqueDupes.join(', ')}`);
      return;
    }

    // Map to Room objects
    const importedRooms: Room[] = selectedRows.map(row => {
      const name = row.name.trim().toUpperCase();
      return {
        id: row.id,
        name,
        type: row.type,
        capacity: row.capacity,
        building: row.building.trim().toUpperCase() || 'MAIN',
        floor: row.floor,
        roomNumber: name.includes('-') ? name.split('-').pop() || name : name,
        equipment: row.equipment,
      };
    });

    onImport(importedRooms);
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
                How Classroom Import Works
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                The spreadsheet importer maps your classroom names, capacity, types, building, and equipment in bulk. It automatically maps column headers and detects details dynamically.
              </p>

              <div className="space-y-2">
                <h5 className="text-[10px] font-black uppercase tracking-wider text-slate-500">Demo Excel Layout format</h5>
                
                {/* Mock spreadsheet preview */}
                <div className="border border-white/[0.08] rounded-xl overflow-hidden bg-black/20 text-[11px] font-mono shadow-inner">
                  <div className="grid grid-cols-6 bg-white/[0.04] border-b border-white/[0.06] font-bold text-slate-300 p-2 text-[10px]">
                    <div className="truncate px-1 border-r border-white/5">Room Name</div>
                    <div className="truncate px-1 border-r border-white/5">Type</div>
                    <div className="truncate px-1 border-r border-white/5">Capacity</div>
                    <div className="truncate px-1 border-r border-white/5">Building</div>
                    <div className="truncate px-1 border-r border-white/5">Floor</div>
                    <div className="truncate px-1">Equipment</div>
                  </div>
                  <div className="grid grid-cols-6 border-b border-white/[0.04] text-slate-400 p-2 text-[10px]">
                    <div className="truncate px-1 border-r border-white/5 text-slate-200 font-sans">SCI-101</div>
                    <div className="truncate px-1 border-r border-white/5">Lecture Hall</div>
                    <div className="truncate px-1 border-r border-white/5">120</div>
                    <div className="truncate px-1 border-r border-white/5">SCI</div>
                    <div className="truncate px-1 border-r border-white/5">1</div>
                    <div className="truncate px-1">Projector</div>
                  </div>
                  <div className="grid grid-cols-6 text-slate-400 p-2 text-[10px]">
                    <div className="truncate px-1 border-r border-white/5 text-slate-200 font-sans">SCI-103</div>
                    <div className="truncate px-1 border-r border-white/5">Computer Lab</div>
                    <div className="truncate px-1 border-r border-white/5">30</div>
                    <div className="truncate px-1 border-r border-white/5">SCI</div>
                    <div className="truncate px-1 border-r border-white/5">1</div>
                    <div className="truncate px-1">PCs, Projector</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-[11px] text-slate-400">
                <div className="p-3 rounded-xl bg-white/[0.01] border border-white/[0.04] space-y-1">
                  <strong className="text-slate-300 block">💡 Smart Mapping Options</strong>
                  Supports room types like <code>Lecture Hall</code>, <code>Seminar Room</code>, <code>Computer Lab</code>, and <code>Science Lab</code>.
                </div>
                <div className="p-3 rounded-xl bg-white/[0.01] border border-white/[0.04] space-y-1">
                  <strong className="text-slate-300 block">⚙ Custom Equipment Tags</strong>
                  Separate multiple tags with a comma (e.g. <code>PCs, Projector, Smart Board</code>).
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
                  Download the boilerplate file, add your campus room records, and upload it here.
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
              Parsed <strong className="text-slate-300">{parsedData.length}</strong> room rows from <span className="text-brand font-mono">{fileName}</span>
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
                  <th className="p-3">Room Name</th>
                  <th className="p-3">Type</th>
                  <th className="p-3 w-20">Capacity</th>
                  <th className="p-3 w-24">Building</th>
                  <th className="p-3 w-20">Floor</th>
                  <th className="p-3">Equipment</th>
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

                    {/* Room Name & warning badge */}
                    <td className="p-3 space-y-1">
                      <Input
                        type="text"
                        value={row.name}
                        onChange={(e) => handleUpdateRoomName(row.id, e.target.value)}
                        className="py-1 px-2.5 text-xs h-8 bg-transparent max-w-xs font-semibold"
                        disabled={!row.selected}
                      />
                      {row.warnings.map((w, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded ml-1">
                          ⚠ {w}
                        </span>
                      ))}
                      {row.isExisting && (
                        <Badge variant="success">Matched Room</Badge>
                      )}
                    </td>

                    {/* Room Type */}
                    <td className="p-3">
                      <Select
                        value={row.type}
                        onChange={(e) => handleUpdateRoomType(row.id, e.target.value)}
                        className="py-1 px-2 h-8 text-xs bg-slate-950 border-white/5 rounded max-w-[140px]"
                        disabled={!row.selected}
                      >
                        {ROOM_TYPES.map(t => (
                          <option key={t.value} value={t.value}>{t.label.split(' (')[0]}</option>
                        ))}
                      </Select>
                    </td>

                    {/* Capacity */}
                    <td className="p-3">
                      <Input
                        type="number"
                        min="1"
                        value={row.capacity}
                        onChange={(e) => handleUpdateCapacity(row.id, Number(e.target.value))}
                        className="py-1 px-2 text-xs text-center"
                        disabled={!row.selected}
                      />
                    </td>

                    {/* Building */}
                    <td className="p-3">
                      <Input
                        type="text"
                        value={row.building}
                        onChange={(e) => handleUpdateBuilding(row.id, e.target.value)}
                        className="py-1 px-2 text-xs h-8 bg-transparent max-w-[100px] font-semibold"
                        disabled={!row.selected}
                      />
                    </td>

                    {/* Floor */}
                    <td className="p-3">
                      <Input
                        type="number"
                        value={row.floor}
                        onChange={(e) => handleUpdateFloor(row.id, Number(e.target.value))}
                        className="py-1 px-2 text-xs text-center"
                        disabled={!row.selected}
                      />
                    </td>

                    {/* Equipment tags */}
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {EQUIPMENT_OPTIONS.map((opt) => {
                          const active = (row.equipment || []).includes(opt.value);
                          return (
                            <button
                              key={opt.value}
                              onClick={() => handleToggleEquipment(row.id, opt.value)}
                              className={`px-1.5 py-0.5 rounded text-[10px] border transition-all
                                ${active
                                  ? 'bg-brand/20 border-brand text-brand-light font-medium'
                                  : 'bg-white/[0.02] border-white/5 text-slate-500 hover:border-white/15'
                                }`}
                              title={`Toggle ${opt.label}`}
                              disabled={!row.selected}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
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

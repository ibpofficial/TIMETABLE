import { useState, useEffect } from 'react';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, FormField, Input, SectionHeader, ConfirmModal } from '../ui';
import { StepNav } from './StepNav';
import type { Room } from '../../types';
import { Trash2, Plus, Building2 } from 'lucide-react';
import { toast } from 'sonner';

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

export function Step1Institution() {
  const store = useTimetableStore();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const [allRooms, setAllRooms] = useState<Room[]>(() => [
    ...store.theoryRooms,
    ...store.labRooms
  ]);

  useEffect(() => {
    setAllRooms([
      ...store.theoryRooms,
      ...store.labRooms
    ]);
  }, [store.theoryRooms, store.labRooms]);

  // Building generator inputs
  const [bldName, setBldName] = useState('SCI');
  const [bldFloors, setBldFloors] = useState(3);
  const [bldRoomsPerFloor, setBldRoomsPerFloor] = useState(4);
  const [bldDefaultType, setBldDefaultType] = useState('lecture_hall');
  const [bldDefaultCapacity, setBldDefaultCapacity] = useState(60);

  const handleGenerateBuilding = () => {
    const name = bldName.trim().toUpperCase();
    if (!name) { toast.error('Building name/code cannot be empty.'); return; }
    if (!/^[A-Z0-9\-]+$/.test(name)) {
      toast.error('Building name/code must be alphanumeric.');
      return;
    }

    const newGenerated: Room[] = [];
    for (let f = 1; f <= bldFloors; f++) {
      for (let r = 1; r <= bldRoomsPerFloor; r++) {
        const roomNum = `${f}${r.toString().padStart(2, '0')}`;
        const roomName = `${name}-${roomNum}`;
        
        // Skip duplicate names
        if (allRooms.some(room => room.name === roomName)) continue;

        newGenerated.push({
          id: `${name}_${roomNum}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: roomName,
          type: bldDefaultType,
          capacity: bldDefaultCapacity,
          building: name,
          floor: f,
          roomNumber: roomNum,
          equipment: bldDefaultType === 'computer_lab' ? ['computers', 'projector'] : ['projector']
        });
      }
    }

    if (newGenerated.length === 0) {
      toast.error('No new rooms generated (they might already exist).');
      return;
    }

    setAllRooms(prev => [...prev, ...newGenerated]);
    toast.success(`Generated ${newGenerated.length} rooms for Building ${name}!`);
  };

  const handleAddManualRoom = () => {
    const id = `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newRoom: Room = {
      id,
      name: `ROOM-${allRooms.length + 1}`,
      type: 'theory',
      capacity: 60,
      building: 'MAIN',
      floor: 1,
      roomNumber: `${allRooms.length + 1}`,
      equipment: ['projector']
    };
    setAllRooms(prev => [...prev, newRoom]);
    toast.success('Added one custom room.');
  };

  const handleUpdateRoom = (id: string, updates: Partial<Room>) => {
    setAllRooms(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const handleToggleEquipment = (roomId: string, eq: string) => {
    setAllRooms(prev => prev.map(r => {
      if (r.id !== roomId) return r;
      const current = r.equipment || [];
      const updated = current.includes(eq)
        ? current.filter(x => x !== eq)
        : [...current, eq];
      return { ...r, equipment: updated };
    }));
  };

  const handleDeleteRoom = (id: string) => {
    setAllRooms(prev => prev.filter(r => r.id !== id));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    const start = parseInt(store.startTime.replace(':', ''), 10);
    const end = parseInt(store.endTime.replace(':', ''), 10);
    if (start >= end) e.times = 'End time must be after start time.';
    if (store.slotLength < 15) e.slotLength = 'Slot length must be at least 15 minutes.';
    if (store.maxClassesPerDay < 1) e.maxClasses = 'Must allow at least 1 class per day.';
    if (store.days.length === 0) e.days = 'Select at least one working day.';
    if (allRooms.length === 0) e.rooms = 'Configure at least one classroom/room.';

    // Check duplicate names
    const names = allRooms.map(r => r.name.trim().toUpperCase());
    const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
    if (duplicates.length > 0) {
      toast.error(`Duplicate room names found: ${Array.from(new Set(duplicates)).join(', ')}`);
      e.rooms = 'Room names must be unique.';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    validate();

    // Filter rooms into theory and practical Lists based on type
    const theory = allRooms.filter(r => ['theory', 'lecture_hall', 'seminar_room', 'auditorium'].includes(r.type));
    const practical = allRooms.filter(r => ['practical', 'lab', 'computer_lab', 'studio'].includes(r.type));

    store.setTheoryRooms(theory);
    store.setLabRooms(practical);
    return true;
  };

  const toggleDay = (day: string) => {
    if (store.days.includes(day)) {
      store.setDays(store.days.filter((d) => d !== day));
    } else {
      store.setDays([...DAYS_OF_WEEK.filter((d) => [...store.days, day].includes(d))]);
    }
  };

  const handleLoadSampleData = () => {
    const sampleConfig = {
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      startTime: '09:00',
      endTime: '17:00',
      slotLength: 60,
      maxClassesPerDay: 6,
      rooms: {
        theoryList: [
          { id: 'SCI_101', name: 'SCI-101', type: 'lecture_hall', capacity: 120, building: 'SCI', floor: 1, roomNumber: '101', equipment: ['projector'] },
          { id: 'SCI_102', name: 'SCI-102', type: 'lecture_hall', capacity: 120, building: 'SCI', floor: 1, roomNumber: '102', equipment: ['projector'] },
          { id: 'SCI_201', name: 'SCI-201', type: 'seminar_room', capacity: 120, building: 'SCI', floor: 2, roomNumber: '201', equipment: ['projector', 'smart_board'] },
          { id: 'SCI_202', name: 'SCI-202', type: 'seminar_room', capacity: 120, building: 'SCI', floor: 2, roomNumber: '202', equipment: ['projector', 'smart_board'] }
        ],
        labList: [
          { id: 'SCI_103', name: 'SCI-103', type: 'computer_lab', capacity: 30, building: 'SCI', floor: 1, roomNumber: '103', equipment: ['computers', 'projector'] },
          { id: 'SCI_104', name: 'SCI-104', type: 'computer_lab', capacity: 30, building: 'SCI', floor: 1, roomNumber: '104', equipment: ['computers'] }
        ]
      },
      batches: ['CSE-1A', 'CSE-1B', 'ECE-1A', 'ECE-1B'],
      batchSizes: {
        'CSE-1A': 55,
        'CSE-1B': 55,
        'ECE-1A': 45,
        'ECE-1B': 45
      },
      faculties: [
        { id: 'F1', name: 'Dr. Ishant Upadhyay', leaves: 0, maxWeeklySlots: 12, maxDailySlots: 4, unavail: [] },
        { id: 'F2', name: 'Dr. Sarah Smith', leaves: 1, maxWeeklySlots: 12, maxDailySlots: 4, unavail: [] },
        { id: 'F3', name: 'Prof. John Doe', leaves: 0, maxWeeklySlots: 10, maxDailySlots: 3, unavail: [] },
        { id: 'F4', name: 'Dr. Alice Brown', leaves: 0, maxWeeklySlots: 12, maxDailySlots: 4, unavail: [] }
      ],
      subjects: [
        { id: 'SUB_1', name: 'Data Structures', type: 'theory' as const, classesPerWeek: 3, sessionLength: 1, facultyId: 'F1', batches: ['CSE-1A', 'CSE-1B'], preferredRoomTypes: ['lecture_hall'] },
        { id: 'SUB_2', name: 'Algorithms Lab', type: 'practical' as const, classesPerWeek: 2, sessionLength: 2, facultyId: 'F1', batches: ['CSE-1A'], preferredRoomTypes: ['computer_lab'], requiredEquipment: ['computers'] },
        { id: 'SUB_3', name: 'Digital Electronics', type: 'theory' as const, classesPerWeek: 3, sessionLength: 1, facultyId: 'F2', batches: ['ECE-1A', 'ECE-1B'], preferredRoomTypes: ['lecture_hall'] },
        { id: 'SUB_4', name: 'Microprocessors Lab', type: 'practical' as const, classesPerWeek: 2, sessionLength: 2, facultyId: 'F2', batches: ['ECE-1A'], preferredRoomTypes: ['computer_lab'], requiredEquipment: ['computers'] },
        { id: 'SUB_5', name: 'Discrete Mathematics', type: 'theory' as const, classesPerWeek: 3, sessionLength: 1, facultyId: 'F3', batches: ['CSE-1A', 'ECE-1A'], preferredRoomTypes: ['seminar_room'] },
        { id: 'SUB_6', name: 'Communication Networks', type: 'theory' as const, classesPerWeek: 3, sessionLength: 1, facultyId: 'F4', batches: ['ECE-1B'] }
      ],
      breaks: [
        { day: 'Mon', start: '13:00', durationMins: 60 },
        { day: 'Tue', start: '13:00', durationMins: 60 },
        { day: 'Wed', start: '13:00', durationMins: 60 },
        { day: 'Thu', start: '13:00', durationMins: 60 },
        { day: 'Fri', start: '13:00', durationMins: 60 }
      ],
      events: [
        { name: 'Weekly Assembly', day: 'Fri', start: '09:00', length: 1, roomType: 'theory' as const }
      ],
      options: { maxAttempts: 5000, balanceAcrossWeek: true }
    };

    store.loadConfig(sampleConfig);
    setAllRooms([
      ...sampleConfig.rooms.theoryList,
      ...sampleConfig.rooms.labList
    ]);
    toast.success('Successfully loaded sample university data configurations across all steps!');
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
        <SectionHeader
          title="Step 1 — Institution & Time"
          subtitle="Configure your institution's working schedule and building classrooms."
          onClear={() => setShowClearConfirm(true)}
        />
        <Button
          variant="secondary"
          className="bg-brand/20 border border-brand/40 text-brand-light font-bold px-4 py-2 hover:bg-brand/35 text-xs shadow-md shadow-brand/10 transition-all flex items-center gap-1.5 shrink-0"
          onClick={handleLoadSampleData}
        >
          ✨ Load Example University Data
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column: Schedule Settings */}
        <div className="lg:col-span-1 flex flex-col gap-5">
          <Card>
            <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <span className="w-6 h-6 bg-brand/20 text-brand rounded text-xs flex items-center justify-center font-bold">1</span>
              Days of Instruction
            </h3>

            <div className="flex flex-wrap gap-2 mb-2">
              {DAYS_OF_WEEK.map((day) => {
                const active = store.days.includes(day);
                return (
                  <button
                    key={day}
                    id={`day-toggle-${day}`}
                    onClick={() => toggleDay(day)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200
                      ${active
                        ? 'bg-brand text-white border-brand shadow-md shadow-brand/20'
                        : 'bg-white/[0.04] border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                      }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
            {errors.days && <p className="text-xs text-red-400 mt-1">{errors.days}</p>}

            <div className="grid grid-cols-2 gap-4 mt-4">
              <FormField label="Start Time" htmlFor="startTime">
                <Input
                  id="startTime"
                  type="time"
                  value={store.startTime}
                  onChange={(e) => store.setStartTime(e.target.value)}
                />
              </FormField>
              <FormField label="End Time" htmlFor="endTime" error={errors.times}>
                <Input
                  id="endTime"
                  type="time"
                  value={store.endTime}
                  onChange={(e) => store.setEndTime(e.target.value)}
                  error={!!errors.times}
                />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <FormField label="Slot Length (minutes)" htmlFor="slotLength" error={errors.slotLength}>
                <Input
                  id="slotLength"
                  type="number"
                  min="15"
                  step="5"
                  value={store.slotLength}
                  onChange={(e) => store.setSlotLength(Number(e.target.value))}
                  error={!!errors.slotLength}
                />
              </FormField>
              <FormField label="Max Classes / Day" htmlFor="maxClasses" error={errors.maxClasses}>
                <Input
                  id="maxClasses"
                  type="number"
                  min="1"
                  value={store.maxClassesPerDay}
                  onChange={(e) => store.setMaxClassesPerDay(Number(e.target.value))}
                  error={!!errors.maxClasses}
                />
              </FormField>
            </div>
          </Card>

          {/* Building Rooms Auto-Generator */}
          <Card>
            <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Building2 size={18} className="text-brand-light" />
              Building Room Generator
            </h3>
            
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Building Code" htmlFor="bldName">
                  <Input
                    id="bldName"
                    value={bldName}
                    onChange={(e) => setBldName(e.target.value)}
                    placeholder="e.g., SCI"
                  />
                </FormField>
                <FormField label="Floors" htmlFor="bldFloors">
                  <Input
                    id="bldFloors"
                    type="number"
                    min="1"
                    value={bldFloors}
                    onChange={(e) => setBldFloors(Number(e.target.value))}
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Rooms / Floor" htmlFor="bldRoomsPerFloor">
                  <Input
                    id="bldRoomsPerFloor"
                    type="number"
                    min="1"
                    value={bldRoomsPerFloor}
                    onChange={(e) => setBldRoomsPerFloor(Number(e.target.value))}
                  />
                </FormField>
                <FormField label="Default Capacity" htmlFor="bldDefaultCapacity">
                  <Input
                    id="bldDefaultCapacity"
                    type="number"
                    min="5"
                    value={bldDefaultCapacity}
                    onChange={(e) => setBldDefaultCapacity(Number(e.target.value))}
                  />
                </FormField>
              </div>

              <FormField label="Room Type Template" htmlFor="bldDefaultType">
                <select
                  id="bldDefaultType"
                  value={bldDefaultType}
                  onChange={(e) => setBldDefaultType(e.target.value)}
                  className="w-full bg-[#121832] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-brand"
                >
                  {ROOM_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </FormField>

              <Button
                variant="secondary"
                onClick={handleGenerateBuilding}
                className="w-full mt-2"
              >
                Generate Building Rooms
              </Button>
            </div>
          </Card>
        </div>

        {/* Right Column: Interactive Room List & Table */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          <Card className="flex-1 flex flex-col min-h-[500px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-slate-200 flex items-center gap-2">
                <span className="w-6 h-6 bg-brand/20 text-brand rounded text-xs flex items-center justify-center font-bold font-mono">
                  {allRooms.length}
                </span>
                Classrooms & Lecture Halls
              </h3>
              <Button
                variant="ghost"
                onClick={handleAddManualRoom}
                className="text-xs py-1.5 px-3 flex items-center gap-1 border border-white/10 hover:border-white/20"
              >
                <Plus size={14} /> Add Room Manually
              </Button>
            </div>

            {errors.rooms && <p className="text-xs text-red-400 mb-3">{errors.rooms}</p>}

            {allRooms.length > 0 ? (
              <div className="flex-1 overflow-x-auto max-h-[600px] pr-1">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/5 text-slate-500 font-semibold uppercase tracking-wider">
                      <th className="py-2.5 px-2">Room Code</th>
                      <th className="py-2.5 px-2">Type</th>
                      <th className="py-2.5 px-2">Capacity</th>
                      <th className="py-2.5 px-2">Equipment Tags</th>
                      <th className="py-2.5 px-2 text-right">Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allRooms.map((room) => (
                      <tr key={room.id} className="border-b border-white/5 hover:bg-white/[0.01] transition-colors">
                        <td className="py-2 px-1">
                          <input
                            type="text"
                            value={room.name}
                            onChange={(e) => handleUpdateRoom(room.id, { name: e.target.value.trim().toUpperCase() })}
                            className="bg-[#121832] border border-white/5 focus:border-brand rounded px-2 py-1.5 w-[90px] font-mono text-slate-200"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <select
                            value={room.type}
                            onChange={(e) => handleUpdateRoom(room.id, { type: e.target.value })}
                            className="bg-[#121832] border border-white/5 focus:border-brand rounded px-1.5 py-1.5 text-slate-300 max-w-[140px]"
                          >
                            {ROOM_TYPES.map(t => (
                              <option key={t.value} value={t.value}>{t.label.split(' (')[0]}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 px-1">
                          <input
                            type="number"
                            min="1"
                            value={room.capacity}
                            onChange={(e) => handleUpdateRoom(room.id, { capacity: Number(e.target.value) || 0 })}
                            className="bg-[#121832] border border-white/5 focus:border-brand rounded px-2 py-1.5 w-[65px] text-slate-200 text-center"
                          />
                        </td>
                        <td className="py-2 px-1">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {EQUIPMENT_OPTIONS.map((opt) => {
                              const active = (room.equipment || []).includes(opt.value);
                              return (
                                <button
                                  key={opt.value}
                                  onClick={() => handleToggleEquipment(room.id, opt.value)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] border transition-all
                                    ${active
                                      ? 'bg-brand/20 border-brand text-brand-light font-medium'
                                      : 'bg-white/[0.02] border-white/5 text-slate-500 hover:border-white/15'
                                    }`}
                                  title={`Toggle ${opt.label}`}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        <td className="py-2 px-1 text-right">
                          <button
                            onClick={() => handleDeleteRoom(room.id)}
                            className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                            title="Delete Room"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-10 border border-dashed border-white/5 rounded-xl">
                <Building2 size={36} className="text-slate-600 mb-2" />
                <p className="text-sm font-semibold">No classrooms configured</p>
                <p className="text-xs text-slate-500 max-w-xs text-center mt-1">
                  Use the Building Room Generator on the left or add custom rooms manually to populate your campus rooms.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>

      <StepNav onNext={handleNext} />

      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          store.clearStepData(1);
          setAllRooms([]);
          toast.success('Institution and schedule settings cleared.');
        }}
        title="Clear Institution Configuration"
        message="Are you sure you want to clear the working days, times, slots, and classroom directory? This cannot be undone."
        confirmLabel="Clear Page"
      />
    </div>
  );
}

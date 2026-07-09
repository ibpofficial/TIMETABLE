import { useState } from 'react';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Card, FormField, Input, SectionHeader } from '../ui';
import { StepNav } from './StepNav';
import type { Room } from '../../types';

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function generateRooms(count: number, type: 'theory' | 'practical', prefix: string): Room[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    name: `${prefix}${i + 1}`,
    type,
    capacity: type === 'theory' ? 60 : 30,
  }));
}

export function Step1Institution() {
  const store = useTimetableStore();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [theoryCount, setTheoryCount] = useState(store.theoryRooms.length);
  const [theoryPrefix, setTheoryPrefix] = useState('T');
  const [labCount, setLabCount] = useState(store.labRooms.length);
  const [labPrefix, setLabPrefix] = useState('L');

  const validate = () => {
    const e: Record<string, string> = {};
    const start = parseInt(store.startTime.replace(':', ''));
    const end = parseInt(store.endTime.replace(':', ''));
    if (start >= end) e.times = 'End time must be after start time.';
    if (store.slotLength < 15) e.slotLength = 'Slot length must be at least 15 minutes.';
    if (store.maxClassesPerDay < 1) e.maxClasses = 'Must allow at least 1 class per day.';
    if (store.days.length === 0) e.days = 'Select at least one working day.';
    if (theoryCount < 0) e.theory = 'Cannot have negative rooms.';
    if (labCount < 0) e.labs = 'Cannot have negative labs.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (!validate()) return false;
    // Rebuild rooms from count + prefix
    store.setTheoryRooms(generateRooms(theoryCount, 'theory', theoryPrefix));
    store.setLabRooms(generateRooms(labCount, 'practical', labPrefix));
    return true;
  };

  const toggleDay = (day: string) => {
    if (store.days.includes(day)) {
      store.setDays(store.days.filter((d) => d !== day));
    } else {
      store.setDays([...DAYS_OF_WEEK.filter((d) => [...store.days, day].includes(d))]);
    }
  };

  return (
    <div>
      <SectionHeader
        title="Step 1 — Institution & Time"
        subtitle="Configure your institution's working schedule and room infrastructure."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Working Days */}
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
            <FormField label="Max Classes / Day (per batch)" htmlFor="maxClasses" error={errors.maxClasses}>
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

        {/* Rooms / Infrastructure */}
        <Card>
          <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
            <span className="w-6 h-6 bg-brand/20 text-brand rounded text-xs flex items-center justify-center font-bold">2</span>
            Infrastructure
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Theory Rooms" htmlFor="theoryCount" error={errors.theory}>
              <Input
                id="theoryCount"
                type="number"
                min="0"
                value={theoryCount}
                onChange={(e) => setTheoryCount(Number(e.target.value))}
              />
            </FormField>
            <FormField label="Room Prefix" htmlFor="theoryPrefix">
              <Input
                id="theoryPrefix"
                value={theoryPrefix}
                maxLength={4}
                onChange={(e) => setTheoryPrefix(e.target.value || 'T')}
              />
            </FormField>
            <FormField label="Labs (Practicals)" htmlFor="labCount" error={errors.labs}>
              <Input
                id="labCount"
                type="number"
                min="0"
                value={labCount}
                onChange={(e) => setLabCount(Number(e.target.value))}
              />
            </FormField>
            <FormField label="Lab Prefix" htmlFor="labPrefix">
              <Input
                id="labPrefix"
                value={labPrefix}
                maxLength={4}
                onChange={(e) => setLabPrefix(e.target.value || 'L')}
              />
            </FormField>
          </div>

          {/* Room preview */}
          {(theoryCount > 0 || labCount > 0) && (
            <div className="mt-4 p-3 bg-white/[0.03] rounded-lg text-xs text-slate-400 font-mono">
              {theoryCount > 0 && (
                <div>Theory: {Array.from({ length: Math.min(theoryCount, 5) }, (_, i) => `${theoryPrefix}${i + 1}`).join(', ')}{theoryCount > 5 ? ` … ${theoryPrefix}${theoryCount}` : ''}</div>
              )}
              {labCount > 0 && (
                <div>Labs: {Array.from({ length: Math.min(labCount, 5) }, (_, i) => `${labPrefix}${i + 1}`).join(', ')}{labCount > 5 ? ` … ${labPrefix}${labCount}` : ''}</div>
              )}
            </div>
          )}
        </Card>
      </div>

      <StepNav onNext={handleNext} />
    </div>
  );
}

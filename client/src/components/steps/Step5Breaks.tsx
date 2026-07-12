import { useState } from 'react';
import { Plus, Trash2, Coffee, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { useTimetableStore } from '../../store/useTimetableStore';
import { Button, Card, EmptyState, FormField, Input, Select, SectionHeader, ConfirmModal } from '../ui';
import { StepNav } from './StepNav';
import type { FixedEvent } from '../../types';

export function Step5Breaks() {
  const {
    breaks,
    events,
    days,
    addBreak,
    removeBreak,
    addEvent,
    removeEvent,
    slotLength,
  } = useTimetableStore();

  // Break Form State
  const [breakDay, setBreakDay] = useState<'All' | string>('All');
  const [breakStart, setBreakStart] = useState('13:00');
  const [breakDuration, setBreakDuration] = useState(60);

  // Event Form State
  const [eventName, setEventName] = useState('');
  const [eventDay, setEventDay] = useState(days[0] || 'Mon');
  const [eventStart, setEventStart] = useState('09:00');
  const [eventLength, setEventLength] = useState(1);
  const [eventRoomType, setEventRoomType] = useState<'theory' | 'practical'>('theory');

  const [eventError, setEventError] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleAddBreak = () => {
    if (!breakStart) {
      toast.error('Please specify a start time for the break.');
      return;
    }
    if (breakDuration <= 0) {
      toast.error('Break duration must be greater than 0.');
      return;
    }

    const daysToAdd = breakDay === 'All' ? days : [breakDay];

    if (daysToAdd.length === 0) {
      toast.error('No working days available to add breaks.');
      return;
    }

    let addedCount = 0;
    daysToAdd.forEach((d) => {
      // Avoid duplicate breaks at same start time on same day
      const duplicate = breaks.some((b) => b.day === d && b.start === breakStart);
      if (!duplicate) {
        addBreak({
          day: d,
          start: breakStart,
          durationMins: breakDuration,
        });
        addedCount++;
      }
    });

    if (addedCount > 0) {
      toast.success(
        breakDay === 'All'
          ? `Added break to all ${addedCount} working days.`
          : `Added break on ${breakDay} at ${breakStart}.`
      );
    } else {
      toast.error('Break at this time already exists on the selected day(s).');
    }
  };

  const handleAddEvent = () => {
    const trimmedName = eventName.trim();
    if (!trimmedName) {
      setEventError('Event name is required.');
      return;
    }
    if (!eventStart) {
      toast.error('Please select a start time.');
      return;
    }
    if (eventLength < 1) {
      toast.error('Event length must be at least 1 slot.');
      return;
    }

    // Check overlap with existing events on the same day/time
    const duplicate = events.some(
      (ev) => ev.day === eventDay && ev.start === eventStart && ev.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (duplicate) {
      setEventError('An event with this name already exists at the same day and time.');
      return;
    }

    const newEvent: FixedEvent = {
      name: trimmedName,
      day: eventDay,
      start: eventStart,
      length: eventLength,
      roomType: eventRoomType,
    };

    addEvent(newEvent);
    setEventName('');
    setEventError('');
    toast.success(`Added fixed event: "${trimmedName}"`);
  };

  return (
    <div>
      <SectionHeader
        title="Step 5 — Breaks & Recurring Events"
        subtitle="Specify institutional intervals (like lunch breaks) and fixed events (such as assemblies or guest lectures)."
        onClear={() => setShowClearConfirm(true)}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Breaks Management */}
        <div className="space-y-6">
          <Card>
            <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Coffee size={18} className="text-brand" />
              Add Recurrent Break
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField label="Day" htmlFor="breakDay">
                <Select
                  id="breakDay"
                  value={breakDay}
                  onChange={(e) => setBreakDay(e.target.value)}
                >
                  <option value="All">All Days</option>
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Start Time" htmlFor="breakStart">
                <Input
                  id="breakStart"
                  type="time"
                  value={breakStart}
                  onChange={(e) => setBreakStart(e.target.value)}
                />
              </FormField>

              <FormField label="Duration (mins)" htmlFor="breakDuration">
                <Input
                  id="breakDuration"
                  type="number"
                  min="5"
                  step="5"
                  value={breakDuration}
                  onChange={(e) => setBreakDuration(Number(e.target.value))}
                />
              </FormField>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                variant="primary"
                icon={<Plus size={14} />}
                onClick={handleAddBreak}
              >
                Add Break
              </Button>
            </div>
          </Card>

          <Card>
            <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">
              Current Recurrent Breaks
            </h4>
            {breaks.length === 0 ? (
              <EmptyState
                icon={<Coffee size={32} className="text-slate-600 animate-pulse" />}
                title="No breaks configured"
                description="All periods are currently available for scheduling. Add a lunch break or recess block above."
              />
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {/* Group breaks by day for better reading */}
                {days.map((day) => {
                  const dayBreaks = breaks.filter((b) => b.day === day);
                  if (dayBreaks.length === 0) return null;
                  return (
                    <div key={day} className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                      <span className="text-xs font-bold text-brand uppercase">{day}</span>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {dayBreaks.map((b) => {
                          const idx = breaks.findIndex((x) => x.day === b.day && x.start === b.start);
                          return (
                            <div
                              key={b.start}
                              className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-800 text-xs text-slate-200 border border-white/5 hover:border-white/10"
                            >
                              <span>
                                {b.start} ({b.durationMins}m)
                              </span>
                              <button
                                onClick={() => removeBreak(idx)}
                                className="text-slate-500 hover:text-red-400 font-bold transition-colors ml-1"
                                aria-label={`Remove break on ${b.day} at ${b.start}`}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Fixed / Recurring Events */}
        <div className="space-y-6">
          <Card>
            <h3 className="font-semibold text-slate-200 mb-4 flex items-center gap-2">
              <Calendar size={18} className="text-brand" />
              Add Fixed / Recurring Event
            </h3>

            <div className="space-y-4">
              <FormField label="Event Name" htmlFor="eventName" error={eventError}>
                <Input
                  id="eventName"
                  value={eventName}
                  onChange={(e) => {
                    setEventName(e.target.value);
                    setEventError('');
                  }}
                  placeholder="e.g., General Assembly, Seminar"
                  error={!!eventError}
                />
              </FormField>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <FormField label="Day" htmlFor="eventDay">
                  <Select
                    id="eventDay"
                    value={eventDay}
                    onChange={(e) => setEventDay(e.target.value)}
                  >
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </FormField>

                <FormField label="Start Time" htmlFor="eventStart">
                  <Input
                    id="eventStart"
                    type="time"
                    value={eventStart}
                    onChange={(e) => setEventStart(e.target.value)}
                  />
                </FormField>

                <FormField
                  label="Length (slots)"
                  htmlFor="eventLength"
                  hint={`Slot = ${slotLength} min`}
                >
                  <Input
                    id="eventLength"
                    type="number"
                    min="1"
                    value={eventLength}
                    onChange={(e) => setEventLength(Number(e.target.value))}
                  />
                </FormField>

                <FormField label="Room Type" htmlFor="eventRoomType">
                  <Select
                    id="eventRoomType"
                    value={eventRoomType}
                    onChange={(e) => setEventRoomType(e.target.value as 'theory' | 'practical')}
                  >
                    <option value="theory">Theory</option>
                    <option value="practical">Practical</option>
                  </Select>
                </FormField>
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button
                variant="primary"
                icon={<Plus size={14} />}
                onClick={handleAddEvent}
              >
                Add Event
              </Button>
            </div>
          </Card>

          <Card>
            <h4 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">
              Current Fixed Events
            </h4>
            {events.length === 0 ? (
              <EmptyState
                icon={<Calendar size={32} className="text-slate-600" />}
                title="No fixed events scheduled"
                description="Add recurring school-wide activities like physical education blocks or prayer halls."
              />
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-2 pr-1 animate-fade-in">
                {events.map((ev, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.04]"
                  >
                    <div className="min-w-0 pr-2">
                      <span className="font-semibold text-slate-200 text-sm">{ev.name}</span>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {ev.day} • {ev.start} • {ev.length} slot(s) ({ev.length * slotLength} mins) •{' '}
                        <span className="capitalize">{ev.roomType} Room</span>
                      </div>
                    </div>
                    <button
                      onClick={() => removeEvent(idx)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors"
                      title="Remove fixed event"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <StepNav />

      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => {
          useTimetableStore.getState().clearStepData(5);
          toast.success('Breaks and fixed events cleared.');
        }}
        title="Clear Breaks & Events"
        message="Are you sure you want to clear all recess breaks and school-wide fixed activities? This cannot be undone."
        confirmLabel="Clear Page"
      />
    </div>
  );
}

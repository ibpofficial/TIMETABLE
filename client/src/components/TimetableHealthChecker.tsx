import { useMemo } from 'react';
import { useTimetableStore } from '../store/useTimetableStore';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { Card } from './ui';

export function TimetableHealthChecker() {
  const store = useTimetableStore();
  const {
    days,
    startTime,
    endTime,
    slotLength,
    maxClassesPerDay,
    theoryRooms,
    labRooms,
    batches,
    batchSizes = {},
    faculties,
    subjects,
    breaks,
    events
  } = store;

  const warnings = useMemo(() => {
    const list: string[] = [];

    if (days.length === 0 || !startTime || !endTime) return list;

    // Helper: convert time string "HH:MM" to minutes
    const t2m = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };

    const slotsPerDay = Math.floor((t2m(endTime) - t2m(startTime)) / slotLength);
    const maxSlotsPerWeek = days.length * Math.min(slotsPerDay, maxClassesPerDay);

    // 1. Check Batch Slot Overload
    batches.forEach(b => {
      let requiredSlots = 0;
      subjects.forEach(s => {
        if (s.batches.includes(b)) {
          requiredSlots += s.classesPerWeek * s.sessionLength;
        }
      });
      if (requiredSlots > maxSlotsPerWeek) {
        list.push(`Group "${b}" requires ${requiredSlots} slots/week, but the schedule only has ${maxSlotsPerWeek} available periods.`);
      }
    });

    // 2. Room Capacity vs Batch size
    const allRooms = [...theoryRooms, ...labRooms];
    subjects.forEach(s => {
      // Calculate total student size for this subject (attending batches sum)
      let totalStudents = 0;
      s.batches.forEach(b => {
        totalStudents += batchSizes[b] || 0;
      });
      const capacityNeeded = Math.max(totalStudents, s.capacityRequirement || 0);

      if (capacityNeeded > 0 && allRooms.length > 0) {
        // Filter compatible rooms
        let compatible = allRooms;
        if (s.preferredRoomTypes && s.preferredRoomTypes.length > 0) {
          compatible = compatible.filter(r => s.preferredRoomTypes!.includes(r.type));
        } else {
          if (s.type === 'theory') {
            compatible = compatible.filter(r => ['theory', 'lecture_hall', 'seminar_room', 'auditorium'].includes(r.type));
          } else {
            compatible = compatible.filter(r => ['practical', 'lab', 'computer_lab', 'studio'].includes(r.type));
          }
        }

        const fitRoom = compatible.find(r => r.capacity >= capacityNeeded);
        if (!fitRoom) {
          list.push(`Subject "${s.name}" requires a room with capacity of ${capacityNeeded} for student groups (${s.batches.join(', ')}), but no compatible room has a capacity this large.`);
        }
      }
    });

    // 3. Faculty Overload
    faculties.forEach(f => {
      let assignedSlots = 0;
      subjects.forEach(s => {
        if (s.facultyId === f.id) {
          assignedSlots += s.classesPerWeek * s.sessionLength;
        }
      });
      if (assignedSlots > f.maxWeeklySlots) {
        list.push(`Faculty "${f.name}" is assigned ${assignedSlots} teaching slots/week, which exceeds their maximum load limit of ${f.maxWeeklySlots} slots.`);
      }
    });

    // 4. Overbooking of Room categories
    const totalTheorySlots = theoryRooms.length * maxSlotsPerWeek;
    const totalLabSlots = labRooms.length * maxSlotsPerWeek;

    let requiredTheorySlots = 0;
    let requiredLabSlots = 0;

    subjects.forEach(s => {
      const slots = s.classesPerWeek * s.sessionLength;
      if (s.type === 'theory') {
        requiredTheorySlots += slots;
      } else {
        requiredLabSlots += slots;
      }
    });

    if (requiredTheorySlots > totalTheorySlots && theoryRooms.length > 0) {
      list.push(`Total theory subjects require ${requiredTheorySlots} slots/week, but your ${theoryRooms.length} classrooms can host at most ${totalTheorySlots} slots/week.`);
    }
    if (requiredLabSlots > totalLabSlots && labRooms.length > 0) {
      list.push(`Total practical subjects require ${requiredLabSlots} slots/week, but your ${labRooms.length} labs can host at most ${totalLabSlots} slots/week.`);
    }

    // 5. Fixed slot collisions
    const fixedSubjects = subjects.filter(s => s.fixed && s.fixedDay && s.fixedStart);
    for (let i = 0; i < fixedSubjects.length; i++) {
      const s1 = fixedSubjects[i];
      for (let j = i + 1; j < fixedSubjects.length; j++) {
        const s2 = fixedSubjects[j];
        if (s1.fixedDay === s2.fixedDay && s1.fixedStart === s2.fixedStart) {
          // Check batch collision
          const sharedBatch = s1.batches.find(b => s2.batches.includes(b));
          if (sharedBatch) {
            list.push(`Fixed slot collision: Subjects "${s1.name}" and "${s2.name}" are both pinned to ${s1.fixedDay} ${s1.fixedStart} for student group "${sharedBatch}".`);
          }
          // Check faculty collision
          if (s1.facultyId && s2.facultyId && s1.facultyId === s2.facultyId) {
            const fac = faculties.find(f => f.id === s1.facultyId);
            list.push(`Fixed slot collision: Faculty "${fac?.name || 'Same Teacher'}" is pinned to teach both "${s1.name}" and "${s2.name}" at the exact same time (${s1.fixedDay} ${s1.fixedStart}).`);
          }
        }
      }
    }

    return list;
  }, [days, startTime, endTime, slotLength, maxClassesPerDay, theoryRooms, labRooms, batches, batchSizes, faculties, subjects, breaks, events]);

  if (warnings.length === 0) {
    return (
      <div className="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-300 text-xs flex gap-2.5 items-center">
        <CheckCircle size={16} className="text-green-400 shrink-0" />
        <div>
          <span className="font-semibold text-green-200">Schedule Math Check: Passed.</span> No structural conflicts or slot overloads detected. Ready for generation.
        </div>
      </div>
    );
  }

  return (
    <Card className="mb-6 border-amber-500/20 bg-amber-500/[0.02]">
      <div className="flex gap-3 items-start">
        <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-amber-200 text-sm">Timetable Configuration Warnings</h4>
          <p className="text-xs text-amber-400 mt-1 leading-normal">
            We detected potential mathematical layout overloads that could cause generation to fail:
          </p>

          <ul className="mt-3 space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {warnings.map((w, idx) => (
              <li key={idx} className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/10 text-xs text-amber-300 leading-normal flex gap-2 items-start">
                <span className="text-amber-400 select-none">•</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

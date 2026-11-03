import { z } from 'zod';
import { SchedulerInputState, ConstraintTemplate } from './types';
import { zConstraintTemplate } from './schemas';

export const zParsedConstraintDraft = z.object({
  description: z.string().min(3),
  targetType: z.enum(['faculty', 'batch', 'room', 'subject', 'global']),
  targetNameOrId: z.string().min(1),
  action: z.enum(['add_unavailability', 'set_preference', 'limit_consecutive', 'custom_constraint', 'adjust_weight']),
  parameters: z.record(z.any()),
  confidence: z.number().min(0).max(1).default(1.0),
});

export type ParsedConstraintDraft = z.infer<typeof zParsedConstraintDraft>;

export function validateConstraintDraft(input: unknown): { success: boolean; draft?: ParsedConstraintDraft; error?: string } {
  const result = zParsedConstraintDraft.safeParse(input);
  if (!result.success) {
    return {
      success: false,
      error: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
    };
  }
  return { success: true, draft: result.data };
}

/**
 * Applies an approved constraint draft into the SchedulerInputState safely without mutating existing state.
 */
export function applyApprovedConstraint(state: SchedulerInputState, draft: ParsedConstraintDraft): SchedulerInputState {
  const next = JSON.parse(JSON.stringify(state)) as SchedulerInputState;

  if (draft.action === 'add_unavailability') {
    const { day, start, end, reason } = draft.parameters;
    if (draft.targetType === 'faculty') {
      const faculty = next.faculties.find(
        (f) => f.id === draft.targetNameOrId || f.name.toLowerCase() === draft.targetNameOrId.toLowerCase()
      );
      if (faculty) {
        if (!faculty.unavail) faculty.unavail = [];
        faculty.unavail.push({ day, start, end, reason: reason || draft.description });
      }
    } else if (draft.targetType === 'room') {
      const room = [...next.rooms.theoryList, ...next.rooms.labList].find(
        (r) => r.id === draft.targetNameOrId || r.name.toLowerCase() === draft.targetNameOrId.toLowerCase()
      );
      if (room) {
        if (!room.unavail) room.unavail = [];
        room.unavail.push({ day, start, end, reason: reason || draft.description });
      }
    } else if (draft.targetType === 'subject') {
      const subject = next.subjects.find(
        (s) => s.id === draft.targetNameOrId || s.name.toLowerCase() === draft.targetNameOrId.toLowerCase()
      );
      if (subject) {
        if (!subject.unavail) subject.unavail = [];
        subject.unavail.push({ day, start, end, reason: reason || draft.description });
      }
    }
  } else if (draft.action === 'adjust_weight') {
    const { constraintId, weight, enabled } = draft.parameters;
    if (next.constraints) {
      const c = next.constraints.find((item) => item.id === constraintId);
      if (c) {
        if (typeof weight === 'number') c.weight = weight;
        if (typeof enabled === 'boolean') c.enabled = enabled;
      }
    }
  } else if (draft.action === 'custom_constraint') {
    const newConstraint: ConstraintTemplate = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: draft.parameters.name || draft.description,
      kind: draft.parameters.kind || 'SOFT',
      weight: draft.parameters.weight || 50,
      scope: draft.targetType,
      enabled: true,
      description: draft.description,
      params: draft.parameters,
    };
    if (!next.constraints) next.constraints = [];
    next.constraints.push(newConstraint);
  }

  return next;
}


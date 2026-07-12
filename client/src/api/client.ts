import type { JobState, SchedulerConfig } from '../types';
import { TimetableSolver } from '../scheduler/solver';

// Client-side in-memory job store and workers registry
const clientJobs = new Map<string, JobState>();
const clientWorkers = new Map<string, Worker>();

// Helper to run solver inline on the main thread (fallback if Workers are not supported)
function runSolverInline(state: SchedulerConfig, jobId: string) {
  setTimeout(() => {
    const jobState = clientJobs.get(jobId);
    if (!jobState || jobState.status === 'cancelled') return;

    try {
      const solver = new TimetableSolver(state);
      solver.init();

      const solution = solver.solve((placed, total) => {
        const currentJob = clientJobs.get(jobId);
        if (currentJob && currentJob.status === 'running') {
          currentJob.placedSessions = placed;
          currentJob.totalSessions = total;
        }
      });

      const currentJob = clientJobs.get(jobId);
      if (!currentJob || currentJob.status === 'cancelled') return;

      const diagnostics = solver.getDiagnostics();
      if (solution && diagnostics.length === 0) {
        currentJob.status = 'success';
        currentJob.solution = solution;
      } else {
        currentJob.status = 'failed';
        currentJob.solution = solution || solver.getBestPartialSolution();
        currentJob.diagnostics = diagnostics;
      }
    } catch (err: any) {
      const currentJob = clientJobs.get(jobId);
      if (currentJob) {
        currentJob.status = 'error';
        currentJob.error = err.message || String(err);
      }
    }
  }, 0);
}

// ── Solver Jobs ─────────────────────────────────────────────────────────────

export async function startGeneration(state: SchedulerConfig): Promise<{ jobId: string }> {
  const jobId = `job_${Math.random().toString(36).slice(2, 9)}`;
  const total = state.subjects.reduce((sum, s) => sum + s.classesPerWeek, 0);

  const jobState: JobState = {
    id: jobId,
    status: 'running',
    placedSessions: 0,
    totalSessions: total,
  };

  clientJobs.set(jobId, jobState);

  try {
    // Instantiate Web Worker using ESM URL syntax
    const worker = new Worker(
      new URL('../scheduler/worker.ts', import.meta.url),
      { type: 'module' }
    );

    clientWorkers.set(jobId, worker);

    worker.onmessage = (e) => {
      const currentJob = clientJobs.get(jobId);
      if (!currentJob || currentJob.status === 'cancelled') {
        worker.terminate();
        clientWorkers.delete(jobId);
        return;
      }

      const msg = e.data;
      if (msg.type === 'progress') {
        currentJob.placedSessions = msg.placed;
        currentJob.totalSessions = msg.total;
      } else if (msg.type === 'success') {
        currentJob.status = 'success';
        currentJob.solution = msg.solution;
        worker.terminate();
        clientWorkers.delete(jobId);
      } else if (msg.type === 'failed') {
        currentJob.status = 'failed';
        currentJob.solution = msg.solution;
        currentJob.diagnostics = msg.diagnostics;
        worker.terminate();
        clientWorkers.delete(jobId);
      } else if (msg.type === 'error') {
        currentJob.status = 'error';
        currentJob.error = msg.error;
        worker.terminate();
        clientWorkers.delete(jobId);
      }
    };

    worker.onerror = (err) => {
      console.warn('Web Worker crashed, falling back to main-thread solver:', err);
      const currentJob = clientJobs.get(jobId);
      if (currentJob && currentJob.status === 'running') {
        runSolverInline(state, jobId);
      }
      clientWorkers.delete(jobId);
    };

    // Start execution
    worker.postMessage(state);

  } catch (err) {
    console.warn('Failed to start Web Worker, falling back to main-thread solver:', err);
    runSolverInline(state, jobId);
  }

  return { jobId };
}

export async function pollJob(jobId: string): Promise<JobState> {
  const job = clientJobs.get(jobId);
  if (!job) {
    throw new Error('Job not found.');
  }
  // Return a copy of the job state to ensure React triggers state changes cleanly
  return { ...job };
}

export async function cancelJob(jobId: string): Promise<{ message: string }> {
  const job = clientJobs.get(jobId);
  if (job && job.status === 'running') {
    job.status = 'cancelled';
    const worker = clientWorkers.get(jobId);
    if (worker) {
      worker.terminate();
      clientWorkers.delete(jobId);
    }
    return { message: 'Job cancellation requested.' };
  }
  throw new Error('Unable to cancel job (either not running or not found).');
}

// ── AI Gateway Direct Calls ──────────────────────────────────────────────────

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'deepseek/deepseek-chat';

function getApiKey(): string {
  const key = localStorage.getItem('OPENROUTER_API_KEY') || ((import.meta as any).env?.VITE_OPENROUTER_API_KEY as string);
  return key ? key.trim() : '';
}

async function fetchOpenRouterAI(messages: any[], maxTokens = 600, temperature = 0.2, tools?: any[]): Promise<any> {
  const apiKey = getApiKey();
  if (!apiKey || apiKey.includes('your_openrouter_api_key_here')) {
    throw new Error(
      'OpenRouter API key is not configured. Please define VITE_OPENROUTER_API_KEY in your .env file, or set it via browser localStorage (localStorage.setItem("OPENROUTER_API_KEY", "sk-or-v1-...")) to enable AI functionalities.'
    );
  }

  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'IBP Timetable Generator',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
    }),
  });

  if (!response.ok) {
    const rawError = await response.text();
    console.error('OpenRouter API Error:', rawError);
    throw new Error(`AI Gateway request failed: ${response.statusText}`);
  }

  return response.json();
}

// ── AI Copilot Handlers ──────────────────────────────────────────────────────

export async function fetchAiTip(eventName: string, payload: unknown, context: unknown): Promise<{ reply: string }> {
  const sysPrompt = [
    'You are an inline coach for a university timetable builder.',
    'Reply in concise bullet points (3 to 6 lines max).',
    'Each bullet point MUST start with a context-appropriate emoji.',
    'Be extremely specific to the configuration state given, and identify potential overload or layout bottlenecks.',
    'Avoid generic platitudes. Do not use asterisks (*) for styling; use brackets, quotes, or capitalization.',
  ].join(' ');

  const userPrompt = [
    `Event Name: ${eventName}`,
    `Action details: ${JSON.stringify(payload)}`,
    `Context state: ${JSON.stringify(context)}`,
    `Provide immediate, short tactical recommendations for this stage.`,
  ].join('\n');

  try {
    const res = await fetchOpenRouterAI([
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ], 300, 0.2);
    const reply = res?.choices?.[0]?.message?.content?.trim() || '';
    return { reply };
  } catch (err: any) {
    throw new Error(err.message || 'AI request failed.');
  }
}

export async function fetchAiSuggestFix(diagnostics: unknown[], context: unknown): Promise<{ suggestions: string }> {
  const sysPrompt = [
    'You are a scheduling optimizer assistant.',
    'You will be given a list of unplaced courses/sessions and the deterministic reasons why they failed to schedule.',
    'Translate these raw failures into a ranked list of 3-5 clear, conversational, and actionable edits the user can make in the wizard.',
    'Use the imperative tone (e.g. "Increase theory rooms from 3 to 4", "Move Physics to a different day").',
    'Do not invent details or assume conflicts not described in the diagnostics.',
    'Format each item on a single line starting with a number. In parentheses, mention the failure reason.',
    'Do not include markdown headers, bold symbols (*), or intro/outro text. Return only the numbered list.',
  ].join(' ');

  const userPrompt = [
    `Failed Diagnostics: ${JSON.stringify(diagnostics)}`,
    `Active wizard configuration settings: ${JSON.stringify(context)}`,
    `Output 3 to 5 ranked minimal corrections.`,
  ].join('\n');

  try {
    const res = await fetchOpenRouterAI([
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ], 400, 0.1);
    const suggestions = res?.choices?.[0]?.message?.content?.trim() || '';
    return { suggestions };
  } catch (err: any) {
    throw new Error(err.message || 'AI request failed.');
  }
}

// AI Agent Tool definitions
const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'getFacultyLoad',
      description: 'Get the scheduled slot count and workload status for a specific faculty member by their ID or name.',
      parameters: {
        type: 'object',
        properties: {
          facultyName: { type: 'string', description: 'The name of the faculty member.' },
        },
        required: ['facultyName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'findUnusedRoomSlots',
      description: 'Find unused (free) time windows for a specific room or all rooms for a given day.',
      parameters: {
        type: 'object',
        properties: {
          roomName: { type: 'string', description: 'Room name or ID to check. Use "all" for overall summary.' },
          day: { type: 'string', description: 'Day of week (Mon, Tue etc). Optional.' },
        },
        required: ['roomName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'explainFailedSubject',
      description: 'Get the specific constraint violation reason why a subject could not be scheduled.',
      parameters: {
        type: 'object',
        properties: {
          subjectName: { type: 'string', description: 'The name of the subject that failed to schedule.' },
        },
        required: ['subjectName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getConflictReport',
      description: 'Get a full summary of all scheduling conflicts and unplaced sessions in the current timetable.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

// Helper to run local tools on client-side state
function executeAgentTool(name: string, args: any, storeState: any): string {
  const state = storeState || {};
  const diagnostics: any[] = state.diagnostics || [];
  const faculties: any[] = state.faculties || [];
  const theoryRooms: any[] = state.theoryRooms || [];
  const labRooms: any[] = state.labRooms || [];
  const solution = state.solution;

  if (name === 'getFacultyLoad') {
    const fac = faculties.find((f: any) =>
      f.name.toLowerCase().includes(args.facultyName.toLowerCase())
    );
    if (!fac) return `No faculty found matching "${args.facultyName}".`;

    let slots = 0;
    if (solution?.byBatch) {
      const seen = new Set<string>();
      Object.values(solution.byBatch).forEach((list: any) => {
        list.forEach((a: any) => {
          if (a.facultyId === fac.id && !seen.has(a.id)) {
            seen.add(a.id);
            slots += a.length || 1;
          }
        });
      });
    }
    const pct = Math.round((slots / (fac.maxWeeklySlots || 1)) * 100);
    const status = pct >= 90 ? 'OVERLOADED' : pct >= 70 ? 'HIGH' : 'NORMAL';
    return `Faculty: ${fac.name} | Scheduled slots: ${slots} / ${fac.maxWeeklySlots} | Load: ${pct}% (${status}) | Leaves/month: ${fac.leaves}`;
  }

  if (name === 'findUnusedRoomSlots') {
    const allRooms = [...theoryRooms, ...labRooms];
    if (args.roomName === 'all') {
      const stats = allRooms.map((r: any) => {
        let used = 0;
        if (solution?.byBatch) {
          const seen = new Set<string>();
          Object.values(solution.byBatch).forEach((list: any) => {
            list.forEach((a: any) => {
              if (a.room === r.name && !seen.has(a.id)) { seen.add(a.id); used++; }
            });
          });
        }
        const days = state.days?.length || 5;
        const slotsPerDay = 6;
        const total = days * slotsPerDay;
        return `${r.name} (${r.type}): ${used}/${total} slots used (${Math.round((used / total) * 100)}% utilization)`;
      });
      return stats.join('\n');
    }
    const room = allRooms.find((r: any) => r.name.toLowerCase().includes(args.roomName.toLowerCase()));
    if (!room) return `No room found matching "${args.roomName}".`;
    return `Room ${room.name}: capacity ${room.capacity}, type ${room.type}, equipment: ${room.equipment?.join(', ') || 'none'}`;
  }

  if (name === 'explainFailedSubject') {
    if (diagnostics.length === 0) return 'No scheduling failures found — the timetable was generated successfully.';
    const diag = diagnostics.find((d: any) =>
      d.subject.toLowerCase().includes(args.subjectName.toLowerCase())
    );
    if (!diag) return `No scheduling failure found for "${args.subjectName}". Available failures: ${diagnostics.map((d: any) => d.subject).join(', ')}.`;
    return `Subject: ${diag.subject}\nBatches: ${diag.batches.join(', ')}\nFaculty: ${diag.faculty}\nReason: ${diag.reason}`;
  }

  if (name === 'getConflictReport') {
    if (diagnostics.length === 0) return 'No conflicts detected — the timetable was generated successfully with all sessions placed.';
    return diagnostics.map((d: any, i: number) =>
      `${i + 1}. [${d.subject}] for ${d.batches.join('+')} (${d.faculty}): ${d.reason}`
    ).join('\n');
  }

  return 'Unknown tool.';
}

export async function fetchAiAgent(
  messages: Array<{ role: string; content: string }>,
  storeState: unknown
): Promise<{ reply: string; toolsUsed: string[] }> {
  const sysPrompt = [
    'You are an expert college timetable scheduling assistant with access to real tools.',
    'When asked about faculty workloads, room availability, scheduling failures, or conflicts, ALWAYS use the appropriate tool to get accurate data.',
    'Keep answers concise, actionable, and timetable-specific.',
    'Use emojis sparingly for visual clarity. Use bullet points for lists.',
    'When suggesting fixes, be specific about which step in the wizard to go to and what to change.',
    'Do NOT answer questions unrelated to the timetable or scheduling.',
  ].join(' ');

  const fullMessages = [{ role: 'system', content: sysPrompt }, ...messages];

  try {
    const firstRes = await fetchOpenRouterAI(fullMessages, 800, 0.2, AGENT_TOOLS);
    const firstChoice = firstRes?.choices?.[0]?.message;

    // If the model calls tools, execute them locally and make a follow-up call
    if (firstChoice?.tool_calls && firstChoice.tool_calls.length > 0) {
      const toolMessages = [
        ...fullMessages,
        firstChoice,
      ];

      const toolsUsed: string[] = [];

      for (const toolCall of firstChoice.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(toolCall.function.arguments || '{}'); } catch {}
        const result = executeAgentTool(toolCall.function.name, args, storeState);
        toolsUsed.push(toolCall.function.name);

        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      const secondRes = await fetchOpenRouterAI(toolMessages, 800, 0.2);
      const reply = secondRes?.choices?.[0]?.message?.content || 'No response generated.';
      return { reply, toolsUsed };
    }

    const reply = firstChoice?.content || 'No response generated.';
    return { reply, toolsUsed: [] };

  } catch (err: any) {
    throw new Error(err.message || 'AI agent request failed.');
  }
}

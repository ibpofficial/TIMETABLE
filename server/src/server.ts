import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { createJob, getJob, cancelJob } from './jobs';
import { SchedulerInputState } from './types';

// Load environment variables
import path from 'path';
dotenv.config();
if (!process.env.OPENROUTER_API_KEY) {
  dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
}

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Allow large configuration payloads

// Rate limiting for AI routes to prevent API key abuse
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // Limit each IP to 10 requests per windowMs
  message: { error: 'Too many AI requests. Please wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Setup OpenRouter parameters
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'deepseek/deepseek-chat';

// Helper to make API calls to OpenRouter
async function fetchOpenRouterAI(messages: any[], maxTokens = 600, temperature = 0.2): Promise<string> {
  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.includes('your_openrouter_api_key_here')) {
    throw new Error('OpenRouter API key is not configured on the backend server.');
  }

  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'IBP Timetable Generator',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const rawError = await response.text();
    console.error('OpenRouter API Error:', rawError);
    throw new Error(`AI Gateway request failed: ${response.statusText}`);
  }

  const data: any = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

// ==================== Job Scheduler Endpoints ====================

// Start scheduling generation
app.post('/api/schedule/generate', (req, res) => {
  const state: SchedulerInputState = req.body;
  if (!state || !state.subjects || !state.batches) {
    return res.status(400).json({ error: 'Invalid scheduler input configuration.' });
  }

  const jobId = createJob(state);
  return res.status(202).json({ jobId });
});

// Poll job progress or retrieve solution
app.get('/api/schedule/jobs/:id', (req, res) => {
  const jobId = req.params.id;
  const job = getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  return res.json(job);
});

// Cancel a running job
app.post('/api/schedule/jobs/:id/cancel', (req, res) => {
  const jobId = req.params.id;
  const success = cancelJob(jobId);

  if (!success) {
    return res.status(400).json({ error: 'Unable to cancel job (either not running or not found).' });
  }

  return res.json({ message: 'Job cancellation requested.' });
});

// ==================== Saved Configurations Endpoints ====================

// List saved configurations for a browser session
app.get('/api/configs', async (req, res) => {
  const sessionId = (req.query.sessionId as string) || 'default';
  try {
    const configs = await prisma.savedConfig.findMany({
      where: { sessionId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    });
    return res.json(configs);
  } catch (error: any) {
    console.error('Failed to list configs:', error);
    return res.status(500).json({ error: 'Failed to retrieve saved configurations.' });
  }
});

// Save configuration
app.post('/api/configs', async (req, res) => {
  const { name, data, sessionId } = req.body;
  if (!name || !data) {
    return res.status(400).json({ error: 'Missing name or configuration data.' });
  }

  const sessId = sessionId || 'default';

  try {
    const saved = await prisma.savedConfig.create({
      data: {
        name,
        sessionId: sessId,
        data: JSON.stringify(data),
      },
    });
    return res.status(201).json({ id: saved.id, name: saved.name });
  } catch (error: any) {
    console.error('Failed to save config:', error);
    return res.status(500).json({ error: 'Failed to save configuration.' });
  }
});

// Get configuration
app.get('/api/configs/:id', async (req, res) => {
  const configId = req.params.id;
  try {
    const config = await prisma.savedConfig.findUnique({
      where: { id: configId },
    });

    if (!config) {
      return res.status(404).json({ error: 'Saved configuration not found.' });
    }

    return res.json({
      id: config.id,
      name: config.name,
      data: JSON.parse(config.data),
    });
  } catch (error: any) {
    console.error('Failed to get config:', error);
    return res.status(500).json({ error: 'Failed to retrieve configuration.' });
  }
});

// Update configuration
app.put('/api/configs/:id', async (req, res) => {
  const configId = req.params.id;
  const { name, data } = req.body;
  try {
    await prisma.savedConfig.update({
      where: { id: configId },
      data: {
        name,
        data: JSON.stringify(data),
      },
    });
    return res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to update config:', error);
    return res.status(500).json({ error: 'Failed to update configuration.' });
  }
});

// Delete configuration
app.delete('/api/configs/:id', async (req, res) => {
  const configId = req.params.id;
  try {
    await prisma.savedConfig.delete({
      where: { id: configId },
    });
    return res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete config:', error);
    return res.status(500).json({ error: 'Failed to delete configuration.' });
  }
});

// ==================== Saved Timetables Endpoints ====================

// List saved timetables
app.get('/api/timetables', async (req, res) => {
  const sessionId = (req.query.sessionId as string) || 'default';
  try {
    const lists = await prisma.savedTimetable.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, configId: true, createdAt: true },
    });
    return res.json(lists);
  } catch (error) {
    console.error('Failed to list timetables:', error);
    return res.status(500).json({ error: 'Failed to retrieve saved timetables.' });
  }
});

// Save timetable
app.post('/api/timetables', async (req, res) => {
  const { name, configId, data, sessionId } = req.body;
  if (!name || !data || !configId) {
    return res.status(400).json({ error: 'Missing name, configId, or timetable data.' });
  }

  const sessId = sessionId || 'default';

  try {
    const saved = await prisma.savedTimetable.create({
      data: {
        name,
        configId,
        sessionId: sessId,
        data: JSON.stringify(data),
      },
    });
    return res.status(201).json({ id: saved.id, name: saved.name });
  } catch (error) {
    console.error('Failed to save timetable:', error);
    return res.status(500).json({ error: 'Failed to save timetable.' });
  }
});

// Get timetable
app.get('/api/timetables/:id', async (req, res) => {
  const timetableId = req.params.id;
  try {
    const timetable = await prisma.savedTimetable.findUnique({
      where: { id: timetableId },
    });

    if (!timetable) {
      return res.status(404).json({ error: 'Saved timetable not found.' });
    }

    return res.json({
      id: timetable.id,
      name: timetable.name,
      configId: timetable.configId,
      data: JSON.parse(timetable.data),
    });
  } catch (error) {
    console.error('Failed to get timetable:', error);
    return res.status(500).json({ error: 'Failed to retrieve timetable.' });
  }
});

// Delete timetable
app.delete('/api/timetables/:id', async (req, res) => {
  const timetableId = req.params.id;
  try {
    await prisma.savedTimetable.delete({
      where: { id: timetableId },
    });
    return res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete timetable:', error);
    return res.status(500).json({ error: 'Failed to delete timetable.' });
  }
});

// ==================== AI Copilot proxy Endpoints ====================

// Endpoint for live contextual tips
app.post('/api/ai/tip', aiRateLimiter, async (req, res) => {
  const { eventName, payload, context } = req.body;
  if (!eventName) {
    return res.status(400).json({ error: 'Missing eventName parameter.' });
  }

  try {
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

    const reply = await fetchOpenRouterAI([
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ], 300, 0.2);

    return res.json({ reply });
  } catch (error: any) {
    console.error('AI Tip Endpoint Error:', error);
    return res.status(500).json({ error: error.message || 'AI request failed.' });
  }
});

// Endpoint for general AI chat proxy (used by frontend)
app.post('/api/ai/chat', aiRateLimiter, async (req, res) => {
  const { messages, maxTokens, temperature } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing or invalid messages parameter.' });
  }

  try {
    const reply = await fetchOpenRouterAI(messages, maxTokens, temperature);
    return res.json({ reply });
  } catch (error: any) {
    console.error('AI Chat Endpoint Error:', error);
    return res.status(500).json({ error: error.message || 'AI request failed.' });
  }
});

// Endpoint for smart fix suggestions on solver failure
app.post('/api/ai/suggest-fix', aiRateLimiter, async (req, res) => {
  const { diagnostics, context } = req.body;
  if (!diagnostics || !Array.isArray(diagnostics)) {
    return res.status(400).json({ error: 'Missing diagnostics parameter.' });
  }

  try {
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

    const reply = await fetchOpenRouterAI([
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ], 400, 0.1);

    return res.json({ suggestions: reply });
  } catch (error: any) {
    console.error('AI Fix Suggestion Endpoint Error:', error);
    return res.status(500).json({ error: error.message || 'AI request failed.' });
  }
});

// ==================== AI Agent Tool-Calling Endpoint ====================
// Supports structured tool calls so the AI can query live scheduling data

app.post('/api/ai/agent', aiRateLimiter, async (req, res) => {
  const { messages, storeState } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing messages array.' });
  }

  // ── Tool Definitions ─────────────────────────────────────────────────
  const tools = [
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

  // ── Tool Execution ───────────────────────────────────────────────────
  const executeTool = (name: string, args: any): string => {
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
          return `${r.name} (${r.type}): ${used}/${total} slots used (${Math.round((used/total)*100)}% utilization)`;
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
  };

  try {
    const sysPrompt = [
      'You are an expert college timetable scheduling assistant with access to real tools.',
      'When asked about faculty workloads, room availability, scheduling failures, or conflicts, ALWAYS use the appropriate tool to get accurate data.',
      'Keep answers concise, actionable, and timetable-specific.',
      'Use emojis sparingly for visual clarity. Use bullet points for lists.',
      'When suggesting fixes, be specific about which step in the wizard to go to and what to change.',
      'Do NOT answer questions unrelated to the timetable or scheduling.',
    ].join(' ');

    const fullMessages = [{ role: 'system', content: sysPrompt }, ...messages];

    // First call — may return tool_calls
    const firstResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'IBP Timetable Agent',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: fullMessages,
        tools,
        tool_choice: 'auto',
        max_tokens: 800,
        temperature: 0.2,
      }),
    });

    const firstData = await firstResponse.json() as any;
    const firstChoice = firstData.choices?.[0]?.message;

    // If the model wants to call tools, execute them and re-call
    if (firstChoice?.tool_calls && firstChoice.tool_calls.length > 0) {
      const toolMessages: any[] = [
        ...fullMessages,
        firstChoice,
      ];

      for (const toolCall of firstChoice.tool_calls) {
        let args: any = {};
        try { args = JSON.parse(toolCall.function.arguments || '{}'); } catch {}
        const result = executeTool(toolCall.function.name, args);
        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      const secondResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'IBP Timetable Agent',
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: toolMessages,
          max_tokens: 800,
          temperature: 0.2,
        }),
      });

      const secondData = await secondResponse.json() as any;
      const reply = secondData.choices?.[0]?.message?.content || 'No response generated.';
      return res.json({ reply, toolsUsed: firstChoice.tool_calls.map((t: any) => t.function.name) });
    }

    // Direct response (no tools needed)
    const reply = firstChoice?.content || 'No response generated.';
    return res.json({ reply, toolsUsed: [] });

  } catch (error: any) {
    console.error('AI Agent Endpoint Error:', error);
    return res.status(500).json({ error: error.message || 'AI agent request failed.' });
  }
});

// Start listening
const server = app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});

export { app, server, prisma };

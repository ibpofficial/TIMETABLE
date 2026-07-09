import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { createJob, getJob, cancelJob } from './jobs';
import { SchedulerInputState } from './types';

// Load environment variables
dotenv.config();

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

// Start listening
const server = app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});

export { app, server, prisma };

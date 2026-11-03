import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { createJob, getJob, cancelJob, subscribeJobEvents } from './jobs';
import {
  hashPassword,
  comparePassword,
  signToken,
  optionalAuth,
  requireAuth,
  createAuditLog,
} from './auth';
import { SchedulerInputState } from '@ibp/shared';

// Load environment variables
dotenv.config();
if (!process.env.OPENROUTER_API_KEY) {
  dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
}

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5000;
const PYTHON_SOLVER_URL = process.env.PYTHON_SOLVER_URL || 'http://localhost:8000';

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json({ limit: '15mb' })); // Allow large configuration payloads

// Rate limiting for AI routes to prevent API key abuse
const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Too many AI requests. Please wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Setup OpenRouter parameters
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'deepseek/deepseek-chat';

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

// ==================== Health & Monitoring ====================

app.get('/api/health', async (_req, res) => {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {}

  let pythonSolverOk = false;
  try {
    const pyRes = await fetch(`${PYTHON_SOLVER_URL}/health`, { signal: AbortSignal.timeout(1500) });
    pythonSolverOk = pyRes.ok;
  } catch {}

  res.json({
    status: 'ok',
    version: '2.0.0',
    database: dbOk ? 'connected' : 'disconnected',
    pythonSolver: pythonSolverOk ? 'available' : 'unavailable',
    timestamp: new Date().toISOString(),
  });
});

// ==================== Authentication & Organizations ====================

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, orgName } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Missing required registration fields (email, password, name).' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'A user with this email address already exists.' });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: 'OWNER',
      },
    });

    // Create default organization for new user
    const slug = (orgName || `${name}-org`).toLowerCase().replace(/[^a-z0-9]/g, '-');
    const org = await prisma.organization.create({
      data: {
        name: orgName || `${name}'s Organization`,
        slug: `${slug}-${Math.floor(Math.random() * 10000)}`,
        memberships: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
    });

    const token = signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: 'OWNER',
      orgId: org.id,
    });

    await createAuditLog({
      action: 'USER_REGISTER',
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      orgId: org.id,
      details: { email: user.email, orgName: org.name },
    });

    return res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      organization: { id: org.id, name: org.name, slug: org.slug },
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Failed to complete registration.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { include: { organization: true } } },
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const primaryOrg = user.memberships[0]?.organization;
    const token = signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: primaryOrg?.id,
    });

    await createAuditLog({
      action: 'USER_LOGIN',
      entityType: 'auth',
      entityId: user.id,
      userId: user.id,
      orgId: primaryOrg?.id,
    });

    return res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      organization: primaryOrg ? { id: primaryOrg.id, name: primaryOrg.name, slug: primaryOrg.slug } : null,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { memberships: { include: { organization: true } } },
    });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    return res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
      })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch current user profile.' });
  }
});

app.get('/api/orgs', requireAuth, async (req, res) => {
  try {
    const memberships = await prisma.membership.findMany({
      where: { userId: req.user!.userId },
      include: { organization: true },
    });
    return res.json(memberships.map((m) => ({ ...m.organization, userRole: m.role })));
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch organizations.' });
  }
});

// ==================== Job Scheduler Endpoints ====================

// Start scheduling generation with engine selection & fallback
app.post('/api/schedule/generate', optionalAuth, (req, res) => {
  const { state, options } = req.body;
  const inputState: SchedulerInputState = state || req.body;

  if (!inputState || !inputState.subjects || !inputState.batches) {
    return res.status(400).json({ error: 'Invalid scheduler input configuration.' });
  }

  const jobId = createJob(inputState, options);

  if (req.user) {
    createAuditLog({
      action: 'JOB_START',
      entityType: 'job',
      entityId: jobId,
      userId: req.user.userId,
      orgId: req.user.orgId,
      details: { batches: inputState.batches.length, engine: options?.engine || 'auto' },
    });
  }

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

// Stream real-time solver progress via Server-Sent Events (SSE)
app.get('/api/schedule/jobs/:id/events', (req, res) => {
  const jobId = req.params.id;
  const subscribed = subscribeJobEvents(jobId, res);

  if (!subscribed) {
    return res.status(404).json({ error: 'Job not found.' });
  }
});

// Cancel a running job
app.post('/api/schedule/jobs/:id/cancel', optionalAuth, (req, res) => {
  const jobId = req.params.id;
  const success = cancelJob(jobId);

  if (!success) {
    return res.status(400).json({ error: 'Unable to cancel job (either not running or not found).' });
  }

  if (req.user) {
    createAuditLog({
      action: 'JOB_CANCEL',
      entityType: 'job',
      entityId: jobId,
      userId: req.user.userId,
      orgId: req.user.orgId,
    });
  }

  return res.json({ message: 'Job cancellation requested.' });
});

// ==================== Saved Configurations Endpoints (with Versioning) ====================

// List saved configurations (scoped by Organization if authenticated, or sessionId if anonymous)
app.get('/api/configs', optionalAuth, async (req, res) => {
  const sessionId = (req.query.sessionId as string) || 'default';
  const orgId = req.user?.orgId;

  try {
    const whereClause = orgId
      ? { OR: [{ orgId }, { sessionId }] }
      : { sessionId };

    const configs = await prisma.savedConfig.findMany({
      where: whereClause,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        orgId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { versions: true } },
      },
    });

    return res.json(configs);
  } catch (error: any) {
    console.error('Failed to list configs:', error);
    return res.status(500).json({ error: 'Failed to retrieve saved configurations.' });
  }
});

// Save configuration (creates config + Version 1)
app.post('/api/configs', optionalAuth, async (req, res) => {
  const { name, data, sessionId, message } = req.body;
  if (!name || !data) {
    return res.status(400).json({ error: 'Missing name or configuration data.' });
  }

  const sessId = sessionId || 'default';
  const orgId = req.user?.orgId;
  const serialized = typeof data === 'string' ? data : JSON.stringify(data);

  try {
    const saved = await prisma.savedConfig.create({
      data: {
        name,
        sessionId: sessId,
        orgId: orgId || null,
        data: serialized,
        versions: {
          create: {
            version: 1,
            message: message || 'Initial configuration version',
            authorId: req.user?.userId || null,
            data: serialized,
          },
        },
      },
    });

    if (req.user) {
      await createAuditLog({
        action: 'CONFIG_CREATE',
        entityType: 'config',
        entityId: saved.id,
        userId: req.user.userId,
        orgId,
        details: { name: saved.name, version: 1 },
      });
    }

    return res.status(201).json({ id: saved.id, name: saved.name, version: 1 });
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
      include: { _count: { select: { versions: true } } },
    });

    if (!config) {
      return res.status(404).json({ error: 'Saved configuration not found.' });
    }

    return res.json({
      id: config.id,
      name: config.name,
      orgId: config.orgId,
      versionCount: config._count.versions,
      data: JSON.parse(config.data),
    });
  } catch (error: any) {
    console.error('Failed to get config:', error);
    return res.status(500).json({ error: 'Failed to retrieve configuration.' });
  }
});

// Update configuration (creates next version)
app.put('/api/configs/:id', optionalAuth, async (req, res) => {
  const configId = req.params.id;
  const { name, data, message } = req.body;
  const serialized = typeof data === 'string' ? data : JSON.stringify(data);

  try {
    const existing = await prisma.savedConfig.findUnique({
      where: { id: configId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Saved configuration not found.' });
    }

    const nextVersion = (existing.versions[0]?.version || 0) + 1;

    await prisma.$transaction([
      prisma.savedConfig.update({
        where: { id: configId },
        data: {
          name: name || existing.name,
          data: serialized,
        },
      }),
      prisma.configVersion.create({
        data: {
          configId,
          version: nextVersion,
          message: message || `Updated configuration (version ${nextVersion})`,
          authorId: req.user?.userId || null,
          data: serialized,
        },
      }),
    ]);

    if (req.user) {
      await createAuditLog({
        action: 'CONFIG_UPDATE',
        entityType: 'config',
        entityId: configId,
        userId: req.user.userId,
        orgId: existing.orgId || undefined,
        details: { name: name || existing.name, version: nextVersion },
      });
    }

    return res.json({ success: true, version: nextVersion });
  } catch (error: any) {
    console.error('Failed to update config:', error);
    return res.status(500).json({ error: 'Failed to update configuration.' });
  }
});

// Get version history of configuration
app.get('/api/configs/:id/versions', async (req, res) => {
  const configId = req.params.id;
  try {
    const versions = await prisma.configVersion.findMany({
      where: { configId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        version: true,
        message: true,
        authorId: true,
        createdAt: true,
      },
    });

    return res.json(versions);
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to retrieve configuration versions.' });
  }
});

// Rollback configuration to a previous version
app.post('/api/configs/:id/rollback/:version', optionalAuth, async (req, res) => {
  const configId = req.params.id;
  const targetVersion = parseInt(req.params.version, 10);

  try {
    const snapshot = await prisma.configVersion.findFirst({
      where: { configId, version: targetVersion },
    });

    if (!snapshot) {
      return res.status(404).json({ error: `Version ${targetVersion} not found.` });
    }

    const existing = await prisma.savedConfig.findUnique({
      where: { id: configId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });

    const newVersionNum = (existing?.versions[0]?.version || targetVersion) + 1;

    await prisma.$transaction([
      prisma.savedConfig.update({
        where: { id: configId },
        data: { data: snapshot.data },
      }),
      prisma.configVersion.create({
        data: {
          configId,
          version: newVersionNum,
          message: `Rolled back to version ${targetVersion}`,
          authorId: req.user?.userId || null,
          data: snapshot.data,
        },
      }),
    ]);

    return res.json({ success: true, rolledBackTo: targetVersion, currentVersion: newVersionNum });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to rollback configuration.' });
  }
});

// Delete configuration
app.delete('/api/configs/:id', optionalAuth, async (req, res) => {
  const configId = req.params.id;
  try {
    await prisma.savedConfig.delete({
      where: { id: configId },
    });

    if (req.user) {
      await createAuditLog({
        action: 'CONFIG_DELETE',
        entityType: 'config',
        entityId: configId,
        userId: req.user.userId,
      });
    }

    return res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete config:', error);
    return res.status(500).json({ error: 'Failed to delete configuration.' });
  }
});

// ==================== Saved Timetables Endpoints (with Versioning) ====================

// List saved timetables
app.get('/api/timetables', optionalAuth, async (req, res) => {
  const sessionId = (req.query.sessionId as string) || 'default';
  const orgId = req.user?.orgId;

  try {
    const whereClause = orgId
      ? { OR: [{ orgId }, { sessionId }] }
      : { sessionId };

    const lists = await prisma.savedTimetable.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        configId: true,
        orgId: true,
        createdAt: true,
        _count: { select: { versions: true } },
      },
    });
    return res.json(lists);
  } catch (error) {
    console.error('Failed to list timetables:', error);
    return res.status(500).json({ error: 'Failed to retrieve saved timetables.' });
  }
});

// Save timetable (with TimetableVersion)
app.post('/api/timetables', optionalAuth, async (req, res) => {
  const { name, configId, data, sessionId, inputData, solverStats, validationResult } = req.body;
  if (!name || !data || !configId) {
    return res.status(400).json({ error: 'Missing name, configId, or timetable data.' });
  }

  const sessId = sessionId || 'default';
  const orgId = req.user?.orgId;
  const serializedOutput = typeof data === 'string' ? data : JSON.stringify(data);
  const serializedInput = inputData ? (typeof inputData === 'string' ? inputData : JSON.stringify(inputData)) : '{}';

  try {
    const saved = await prisma.savedTimetable.create({
      data: {
        name,
        configId,
        sessionId: sessId,
        orgId: orgId || null,
        data: serializedOutput,
        versions: {
          create: {
            version: 1,
            authorId: req.user?.userId || null,
            inputData: serializedInput,
            outputData: serializedOutput,
            solverStats: solverStats ? JSON.stringify(solverStats) : null,
            validationResult: validationResult ? JSON.stringify(validationResult) : null,
          },
        },
      },
    });

    if (req.user) {
      await createAuditLog({
        action: 'TIMETABLE_SAVE',
        entityType: 'timetable',
        entityId: saved.id,
        userId: req.user.userId,
        orgId,
        details: { name: saved.name, configId },
      });
    }

    return res.status(201).json({ id: saved.id, name: saved.name, version: 1 });
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
      include: { _count: { select: { versions: true } } },
    });

    if (!timetable) {
      return res.status(404).json({ error: 'Saved timetable not found.' });
    }

    return res.json({
      id: timetable.id,
      name: timetable.name,
      configId: timetable.configId,
      orgId: timetable.orgId,
      versionCount: timetable._count.versions,
      data: JSON.parse(timetable.data),
    });
  } catch (error) {
    console.error('Failed to get timetable:', error);
    return res.status(500).json({ error: 'Failed to retrieve timetable.' });
  }
});

// Delete timetable
app.delete('/api/timetables/:id', optionalAuth, async (req, res) => {
  const timetableId = req.params.id;
  try {
    await prisma.savedTimetable.delete({
      where: { id: timetableId },
    });

    if (req.user) {
      await createAuditLog({
        action: 'TIMETABLE_DELETE',
        entityType: 'timetable',
        entityId: timetableId,
        userId: req.user.userId,
      });
    }

    return res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete timetable:', error);
    return res.status(500).json({ error: 'Failed to delete timetable.' });
  }
});

// ==================== Audit Logs Endpoint ====================

app.get('/api/audit-logs', requireAuth, async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const logs = await prisma.auditLog.findMany({
      where: orgId ? { orgId } : { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { user: { select: { name: true, email: true } } },
    });
    return res.json(logs);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to retrieve audit logs.' });
  }
});

// ==================== AI Copilot Proxy Endpoints ====================

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

app.post('/api/ai/agent', aiRateLimiter, async (req, res) => {
  const { messages, storeState } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing messages array.' });
  }

  const tools = [
    {
      type: 'function',
      function: {
        name: 'getFacultyLoad',
        description: 'Get scheduled slot count and workload status for a faculty member.',
        parameters: {
          type: 'object',
          properties: { facultyName: { type: 'string', description: 'Faculty member name.' } },
          required: ['facultyName'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'findUnusedRoomSlots',
        description: 'Find unused time windows for a room or all rooms.',
        parameters: {
          type: 'object',
          properties: {
            roomName: { type: 'string', description: 'Room name or "all"' },
            day: { type: 'string', description: 'Day of week.' },
          },
          required: ['roomName'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'explainFailedSubject',
        description: 'Get constraint violation reasons why a subject could not be scheduled.',
        parameters: {
          type: 'object',
          properties: { subjectName: { type: 'string', description: 'Subject name.' } },
          required: ['subjectName'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'getConflictReport',
        description: 'Summary of all scheduling conflicts and unplaced sessions.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
  ];

  const executeTool = (name: string, args: any): string => {
    const state = storeState || {};
    const diagnostics: any[] = state.diagnostics || [];
    const faculties: any[] = state.faculties || [];
    const theoryRooms: any[] = state.theoryRooms || [];
    const labRooms: any[] = state.labRooms || [];
    const solution = state.solution;

    if (name === 'getFacultyLoad') {
      const fac = faculties.find((f: any) => f.name.toLowerCase().includes(args.facultyName.toLowerCase()));
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
      return `Faculty: ${fac.name} | Scheduled slots: ${slots} / ${fac.maxWeeklySlots} | Load: ${pct}% (${status})`;
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
          const total = (state.days?.length || 5) * 6;
          return `${r.name} (${r.type}): ${used}/${total} slots used (${Math.round((used/total)*100)}% utilization)`;
        });
        return stats.join('\n');
      }
      const room = allRooms.find((r: any) => r.name.toLowerCase().includes(args.roomName.toLowerCase()));
      if (!room) return `No room found matching "${args.roomName}".`;
      return `Room ${room.name}: capacity ${room.capacity}, type ${room.type}`;
    }

    if (name === 'explainFailedSubject') {
      if (diagnostics.length === 0) return 'No scheduling failures found.';
      const diag = diagnostics.find((d: any) => d.subject.toLowerCase().includes(args.subjectName.toLowerCase()));
      if (!diag) return `No scheduling failure found for "${args.subjectName}".`;
      return `Subject: ${diag.subject}\nBatches: ${diag.batches.join(', ')}\nFaculty: ${diag.faculty}\nReason: ${diag.reason}`;
    }

    if (name === 'getConflictReport') {
      if (diagnostics.length === 0) return 'No conflicts detected.';
      return diagnostics.map((d: any, i: number) => `${i + 1}. [${d.subject}] for ${d.batches.join('+')} (${d.faculty}): ${d.reason}`).join('\n');
    }

    return 'Unknown tool.';
  };

  try {
    const sysPrompt = [
      'You are an expert college timetable scheduling assistant with access to real tools.',
      'When asked about faculty workloads, room availability, or conflicts, ALWAYS use the appropriate tool.',
    ].join(' ');

    const fullMessages = [{ role: 'system', content: sysPrompt }, ...messages];

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

    const firstData = (await firstResponse.json()) as any;
    const firstChoice = firstData.choices?.[0]?.message;

    if (firstChoice?.tool_calls && firstChoice.tool_calls.length > 0) {
      const toolMessages: any[] = [...fullMessages, firstChoice];

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

      const secondData = (await secondResponse.json()) as any;
      const reply = secondData.choices?.[0]?.message?.content || 'No response generated.';
      return res.json({ reply, toolsUsed: firstChoice.tool_calls.map((t: any) => t.function.name) });
    }

    const reply = firstChoice?.content || 'No response generated.';
    return res.json({ reply, toolsUsed: [] });
  } catch (error: any) {
    console.error('AI Agent Endpoint Error:', error);
    return res.status(500).json({ error: error.message || 'AI agent request failed.' });
  }
});

// Start listening if not imported by test suite
let server: any;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
  });
}

export { app, server, prisma };

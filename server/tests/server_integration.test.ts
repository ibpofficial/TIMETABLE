import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, prisma } from '../src/server';
import { generateInstance } from '../../tools/generate-instance';

describe('Server Backend Hardening & API Integration Tests', () => {
  let authToken = '';
  let testUserId = '';
  let testOrgId = '';
  let testConfigId = '';
  const testEmail = `test_${Date.now()}@example.com`;

  beforeAll(async () => {
    // Ensure clean test environment
    process.env.NODE_ENV = 'test';
  });

  describe('Health API', () => {
    it('returns healthy status with database status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe('connected');
    });
  });

  describe('Authentication & Multi-Tenant Scoping', () => {
    it('registers a new user and creates organization', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: 'Password123!',
          name: 'Principal Engineer',
          orgName: 'Engineering Academy',
        });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(testEmail);
      expect(res.body.user.role).toBe('OWNER');
      expect(res.body.organization.name).toBe('Engineering Academy');

      authToken = res.body.token;
      testUserId = res.body.user.id;
      testOrgId = res.body.organization.id;
    });

    it('rejects registration with duplicate email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: testEmail,
          password: 'Password123!',
          name: 'Another User',
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already exists');
    });

    it('authenticates user and returns JWT token on login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: testEmail,
          password: 'Password123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.id).toBe(testUserId);
    });

    it('returns profile with organizations for authenticated user', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe(testEmail);
      expect(res.body.organizations.length).toBeGreaterThan(0);
      expect(res.body.organizations[0].id).toBe(testOrgId);
    });
  });

  describe('Configurations with Versioning & Rollback', () => {
    it('creates a configuration and generates version 1 snapshot', async () => {
      const { config } = generateInstance({ seed: 101, tier: 'tiny' });

      const res = await request(app)
        .post('/api/configs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Semester 1 Baseline',
          data: config,
          message: 'Initial draft for engineering dept',
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.version).toBe(1);
      testConfigId = res.body.id;
    });

    it('lists configs scoped to user organization', async () => {
      const res = await request(app)
        .get('/api/configs')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      const found = res.body.find((c: any) => c.id === testConfigId);
      expect(found).toBeDefined();
      expect(found._count.versions).toBe(1);
    });

    it('updates config and creates version 2 snapshot', async () => {
      const { config } = generateInstance({ seed: 102, tier: 'tiny' });

      const res = await request(app)
        .put(`/api/configs/${testConfigId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Semester 1 Revised',
          data: config,
          message: 'Added room adjustments',
        });

      expect(res.status).toBe(200);
      expect(res.body.version).toBe(2);
    });

    it('retrieves version history for a configuration', async () => {
      const res = await request(app).get(`/api/configs/${testConfigId}/versions`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
      expect(res.body[0].version).toBe(2);
      expect(res.body[1].version).toBe(1);
    });

    it('rolls back configuration to version 1', async () => {
      const res = await request(app)
        .post(`/api/configs/${testConfigId}/rollback/1`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.rolledBackTo).toBe(1);
      expect(res.body.currentVersion).toBe(3);
    });
  });

  describe('Scheduling Jobs & Fallback Engine', () => {
    it('creates job, tracks progress, and completes solving', async () => {
      const { config } = generateInstance({ seed: 101, tier: 'tiny' });

      const createRes = await request(app)
        .post('/api/schedule/generate')
        .send({ state: config, options: { engine: 'ts' } });

      expect(createRes.status).toBe(202);
      const jobId = createRes.body.jobId;
      expect(jobId).toBeDefined();

      // Poll until completion (or up to 3 seconds)
      let job: any;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const pollRes = await request(app).get(`/api/schedule/jobs/${jobId}`);
        job = pollRes.body;
        if (job.status === 'success' || job.status === 'failed') break;
      }

      if (job.status === 'failed') {
        console.error('Job failed diagnostics:', JSON.stringify(job.diagnostics, null, 2));
      }
      expect(job.status).toBe('success');
      expect(job.solution).toBeDefined();
      expect(job.solution.score?.metrics?.placedCount || Object.values(job.solution.byBatch).flat().length).toBeGreaterThan(0);
    });

    it('falls back gracefully to TypeScript solver when Python microservice is down', async () => {
      const { config } = generateInstance({ seed: 102, tier: 'tiny' });

      // Request python engine explicitly; since Python solver is not currently running on port 8000,
      // the delegation should catch connection error and seamlessly fall back to TS engine.
      const res = await request(app)
        .post('/api/schedule/generate')
        .send({
          state: config,
          options: { engine: 'python', timeoutSeconds: 1 },
        });

      expect(res.status).toBe(202);
      const jobId = res.body.jobId;

      let job: any;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const pollRes = await request(app).get(`/api/schedule/jobs/${jobId}`);
        job = pollRes.body;
        if (job.status === 'success' || job.status === 'failed') break;
      }

      if (job.status === 'failed') {
        console.error('Job failed diagnostics:', JSON.stringify(job.diagnostics, null, 2));
      }
      expect(job.status).toBe('success');
      expect(job.solution).toBeDefined();
      expect(job.engineUsed).toBe('ts'); // Fallback was utilized
    });

    it('allows job cancellation', async () => {
      const { config } = generateInstance({ seed: 203, tier: 'college' });

      const createRes = await request(app)
        .post('/api/schedule/generate')
        .send({ state: config });

      const jobId = createRes.body.jobId;
      const cancelRes = await request(app).post(`/api/schedule/jobs/${jobId}/cancel`);
      expect(cancelRes.status).toBe(200);

      const pollRes = await request(app).get(`/api/schedule/jobs/${jobId}`);
      expect(['cancelled', 'success']).toContain(pollRes.body.status);
    });
  });

  describe('Audit Logging', () => {
    it('records and returns audit logs for organization actions', async () => {
      const res = await request(app)
        .get('/api/audit-logs')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
      const actions = res.body.map((log: any) => log.action);
      expect(actions).toContain('USER_REGISTER');
      expect(actions).toContain('CONFIG_CREATE');
    });
  });
});

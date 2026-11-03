import { describe, it, expect } from 'vitest';
import { createJob, getJob } from './jobs';
import { generateInstance } from '../../tools/generate-instance';

describe('Server Job Queue & API Engine', () => {
  it('creates and tracks in-memory jobs', () => {
    const { config } = generateInstance({ seed: 42, tier: 'tiny' });
    const jobId = createJob(config);
    expect(jobId).toBeDefined();

    const job = getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.id).toBe(jobId);
    expect(['running', 'success']).toContain(job?.status);
  });
});

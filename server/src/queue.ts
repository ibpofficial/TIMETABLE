import { Queue, Worker as BullWorker, Job as BullJob } from 'bullmq';
import IORedis from 'ioredis';
import EventEmitter from 'events';
import { SchedulerInputState, ScheduleSolution, FailureDiagnostic } from '@ibp/shared';

export interface SolverJobData {
  jobId: string;
  state: SchedulerInputState;
  options?: {
    engine?: 'auto' | 'ts' | 'python';
    maxAttempts?: number;
    timeoutSeconds?: number;
  };
}

export interface SolverJobResult {
  jobId: string;
  status: 'success' | 'failed' | 'error';
  solution?: ScheduleSolution;
  diagnostics?: FailureDiagnostic[];
  error?: string;
  placedSessions: number;
  totalSessions: number;
}

export class JobQueueManager extends EventEmitter {
  private redisConnection: IORedis | null = null;
  private queue: Queue<SolverJobData, SolverJobResult> | null = null;
  private worker: BullWorker<SolverJobData, SolverJobResult> | null = null;
  private isRedisEnabled = false;

  constructor() {
    super();
    this.init();
  }

  private async init() {
    const redisUrl = process.env.REDIS_URL;
    // Only attempt Redis connection if explicitly provided or in production
    if (redisUrl) {
      try {
        const client = new IORedis(redisUrl, {
          maxRetriesPerRequest: null,
          connectTimeout: 2000,
          retryStrategy: () => null, // Don't hang trying to reconnect if down
        });

        client.on('error', (err) => {
          if (!this.isRedisEnabled) {
            // Suppress initial connection failure logs to avoid noise in dev
            return;
          }
          console.warn('[Queue] Redis connection error, using in-memory queue fallback:', err.message);
        });

        await client.ping();
        this.redisConnection = client;
        this.isRedisEnabled = true;

        this.queue = new Queue('ibp-solver-jobs', { connection: this.redisConnection });
        console.log('[Queue] BullMQ + Redis initialized successfully.');
      } catch (err: any) {
        console.log('[Queue] Redis not available, running with in-memory execution fallback.');
        this.isRedisEnabled = false;
        if (this.redisConnection) {
          this.redisConnection.disconnect();
          this.redisConnection = null;
        }
      }
    } else {
      console.log('[Queue] REDIS_URL not set; using zero-dependency in-memory solver queue.');
    }
  }

  public get isDistributed(): boolean {
    return this.isRedisEnabled;
  }

  public registerWorker(processor: (jobData: SolverJobData, onProgress: (placed: number, total: number) => void) => Promise<SolverJobResult>) {
    if (this.isRedisEnabled && this.redisConnection) {
      try {
        this.worker = new BullWorker<SolverJobData, SolverJobResult>(
          'ibp-solver-jobs',
          async (job: BullJob<SolverJobData, SolverJobResult>) => {
            return await processor(job.data, (placed, total) => {
              job.updateProgress({ placed, total });
            });
          },
          { connection: this.redisConnection }
        );

        this.worker.on('completed', (job, result) => {
          this.emit('completed', result);
        });

        this.worker.on('failed', (job, err) => {
          this.emit('failed', { jobId: job?.data.jobId, error: err.message });
        });
      } catch (err) {
        console.warn('[Queue] Failed to start BullMQ worker:', err);
      }
    }
  }

  public async addJob(jobData: SolverJobData): Promise<void> {
    if (this.isRedisEnabled && this.queue) {
      await this.queue.add('solve', jobData, {
        jobId: jobData.jobId,
        removeOnComplete: true,
        removeOnFail: false,
      });
    }
  }

  public async close(): Promise<void> {
    if (this.worker) await this.worker.close();
    if (this.queue) await this.queue.close();
    if (this.redisConnection) await this.redisConnection.quit();
  }
}

export const queueManager = new JobQueueManager();


/**
 * Shared in-memory job store for every video-export path (2D expression,
 * 3D surface, ODE) -- extracted from export-video.ts when the 3D/ODE export
 * paths were added (johnhenry/mallory#3, pass 2) so each path doesn't
 * grow its own Map/sweep/poll plumbing. One store, one poll endpoint
 * (export-video.ts's getExportVideoJob) serves them all: job ids are UUIDs,
 * so there's no collision risk across paths.
 *
 * A plain Map is still the right scale here: this app runs as a single
 * Dokku process (no multi-instance fan-out to coordinate), and jobs are
 * swept on submission so a browser that never polls again doesn't leak a
 * rendered buffer forever. Server-only: imported exclusively by server-fn
 * modules; nothing here is a server fn itself.
 */

export interface ExportVideoResult {
  data: string;
  mimeType: string;
}

export type ExportJob =
  | { status: "pending" }
  | { status: "done"; result: ExportVideoResult }
  | { status: "error"; message: string };

const JOB_TTL_MS = 5 * 60 * 1000;
const jobs = new Map<string, ExportJob>();
const jobCreatedAt = new Map<string, number>();

function sweepExpiredJobs() {
  const now = Date.now();
  for (const [id, createdAt] of jobCreatedAt) {
    if (now - createdAt > JOB_TTL_MS) {
      jobs.delete(id);
      jobCreatedAt.delete(id);
    }
  }
}

/** Register a new pending job (sweeping expired ones first) and return its id. */
export function createExportJob(): string {
  sweepExpiredJobs();
  const jobId = crypto.randomUUID();
  jobs.set(jobId, { status: "pending" });
  jobCreatedAt.set(jobId, Date.now());
  return jobId;
}

export function completeExportJob(jobId: string, result: ExportVideoResult): void {
  jobs.set(jobId, { status: "done", result });
}

export function failExportJob(jobId: string, e: unknown): void {
  jobs.set(jobId, { status: "error", message: e instanceof Error ? e.message : String(e) });
}

export function readExportJob(jobId: string): ExportJob | undefined {
  return jobs.get(jobId);
}

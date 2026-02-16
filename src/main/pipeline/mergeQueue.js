import { EventEmitter } from 'node:events';

export class MergeQueue extends EventEmitter {
  /**
   * @param {{
   *   worker: (jobId: string, notify: (event: { type: string; payload: any }) => void) => Promise<void>;
   * }} payload
   */
  constructor(payload) {
    super();
    this.worker = payload.worker;
    this.pending = [];
    this.running = false;
  }

  /**
   * @param {string} jobId
   */
  enqueue(jobId) {
    this.pending.push(jobId);
    this.emit('queue:updated', { pending: this.pending.length, running: this.running });
    this.#drain().catch((error) => {
      this.emit('queue:error', error);
    });
  }

  async #drain() {
    if (this.running) {
      return;
    }

    this.running = true;
    this.emit('queue:updated', { pending: this.pending.length, running: this.running });

    while (this.pending.length > 0) {
      const jobId = this.pending.shift();
      if (!jobId) {
        continue;
      }

      this.emit('job:started', { jobId });

      try {
        await this.worker(jobId, (event) => this.emit(event.type, event.payload));
        this.emit('job:finished', { jobId });
      } catch (error) {
        this.emit('job:failed', {
          jobId,
          error: error instanceof Error ? error.message : 'Unknown queue error'
        });
      }

      this.emit('queue:updated', { pending: this.pending.length, running: this.running });
    }

    this.running = false;
    this.emit('queue:updated', { pending: this.pending.length, running: this.running });
  }
}

import * as fs from 'fs';
import * as path from 'path';

/**
 * Key-queued asynchronous disk write serializer.
 * Ensures concurrent writes or deletes targeting the same file path execute sequentially,
 * avoiding race conditions during batch scans or concurrent agent updates.
 */
export class AsyncDiskQueue {
  private static instance: AsyncDiskQueue;
  private queues: Map<string, Promise<void>> = new Map();

  public static getInstance(): AsyncDiskQueue {
    if (!AsyncDiskQueue.instance) {
      AsyncDiskQueue.instance = new AsyncDiskQueue();
    }
    return AsyncDiskQueue.instance;
  }

  public enqueue<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const key = path.resolve(filePath);
    const existingQueue = this.queues.get(key) || Promise.resolve();

    const newQueue = existingQueue
      .then(async () => {
        return await operation();
      })
      .catch((err) => {
        throw err;
      })
      .finally(() => {
        if (this.queues.get(key) === newQueue) {
          this.queues.delete(key);
        }
      });

    this.queues.set(key, newQueue.then(() => {}));
    return newQueue as Promise<T>;
  }

  public async writeFile(filePath: string, content: string): Promise<void> {
    return this.enqueue(filePath, async () => {
      const dir = path.dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(filePath, content, 'utf8');
    });
  }

  public async unlinkFile(filePath: string): Promise<void> {
    return this.enqueue(filePath, async () => {
      try {
        await fs.promises.unlink(filePath);
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
    });
  }

  public async readFile(filePath: string): Promise<string | null> {
    return this.enqueue(filePath, async () => {
      try {
        return await fs.promises.readFile(filePath, 'utf8');
      } catch (err: any) {
        if (err.code === 'ENOENT') {
          return null;
        }
        throw err;
      }
    });
  }
}

export const asyncDiskQueue = AsyncDiskQueue.getInstance();

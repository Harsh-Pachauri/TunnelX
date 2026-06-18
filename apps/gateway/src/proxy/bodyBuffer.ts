/** Cap per direction (request or response) — bodies larger than this are not buffered. */
export const BODY_CAP = 64 * 1024; // 64 KB

const BUFFER_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 200;

export interface BufferedRequest {
  requestHeaders: Record<string, string>;
  /** base64-encoded body, or null if absent or exceeded BODY_CAP. */
  requestBody: string | null;
  requestBodyTruncated: boolean;
  responseHeaders: Record<string, string>;
  /** base64-encoded body, or null if absent or exceeded BODY_CAP. */
  responseBody: string | null;
  responseBodyTruncated: boolean;
}

class BodyBuffer {
  private entries = new Map<number, BufferedRequest & { timer: NodeJS.Timeout }>();

  store(logId: number, data: BufferedRequest): void {
    if (this.entries.size >= MAX_ENTRIES) {
      // Map iteration order is insertion order — evict the oldest entry.
      const oldestId = this.entries.keys().next().value as number;
      this.evict(oldestId);
    }
    const timer = setTimeout(() => this.evict(logId), BUFFER_TTL_MS).unref();
    this.entries.set(logId, { ...data, timer });
  }

  get(logId: number): BufferedRequest | null {
    const entry = this.entries.get(logId);
    if (!entry) return null;
    const { timer: _timer, ...data } = entry;
    return data;
  }

  private evict(logId: number): void {
    const entry = this.entries.get(logId);
    if (entry) {
      clearTimeout(entry.timer);
      this.entries.delete(logId);
    }
  }

  size(): number {
    return this.entries.size;
  }
}

export const bodyBuffer = new BodyBuffer();

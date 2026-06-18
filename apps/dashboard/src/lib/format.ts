export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  return `${ms} ms`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function statusCodeClass(statusCode: number | null): string {
  if (statusCode === null) return 'badge-default';
  if (statusCode >= 500) return 'badge-5xx';
  if (statusCode >= 400) return 'badge-4xx';
  if (statusCode >= 300) return 'badge-3xx';
  if (statusCode >= 200) return 'badge-2xx';
  return 'badge-default';
}

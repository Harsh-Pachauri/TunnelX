import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ApiClientError } from '../api/client';
import { getLog, getLogBody } from '../api/logs';
import { StatusBadge } from '../components/StatusBadge';
import { formatBytes, formatDateTime, formatMs, statusCodeClass } from '../lib/format';

function decodeBase64Body(b64: string): string {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return '(binary content — cannot display as text)';
  }
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <p className="muted">No headers captured.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Header</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([name, value]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BodyPreview({ body, truncated }: { body: string | null; truncated: boolean }) {
  if (body === null && !truncated) return <p className="muted">No body.</p>;
  if (truncated && body === null)
    return <p className="muted">Body exceeded 64 KB capture limit and was not stored.</p>;
  const text = body ? decodeBase64Body(body) : '';
  return (
    <>
      {truncated && <p className="muted">Body truncated at 64 KB.</p>}
      <pre className="body-preview">{text}</pre>
    </>
  );
}

export function RequestInspectorPage() {
  const { id } = useParams<{ id: string }>();
  const numId = Number(id);

  const logQuery = useQuery({
    queryKey: ['log', id],
    queryFn: () => getLog(numId),
    enabled: Boolean(id) && Number.isInteger(numId),
  });

  const bodyQuery = useQuery({
    queryKey: ['log-body', id],
    queryFn: () => getLogBody(numId),
    enabled: Boolean(id) && Number.isInteger(numId),
    retry: false,
  });

  if (logQuery.isLoading) {
    return (
      <div className="container">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (logQuery.isError || !logQuery.data) {
    return (
      <div className="container">
        <p className="error-text">Request log not found.</p>
        <Link to="/logs">&larr; Back to logs</Link>
      </div>
    );
  }

  const log = logQuery.data;
  const body = bodyQuery.data ?? null;
  const bodyExpired =
    bodyQuery.isError &&
    bodyQuery.error instanceof ApiClientError &&
    bodyQuery.error.status === 410;

  return (
    <div className="container">
      <div className="page-header">
        <h1>
          <span className="method-label">{log.method}</span> {log.path}
        </h1>
        {log.statusCode !== null && (
          <StatusBadge label={String(log.statusCode)} className={statusCodeClass(log.statusCode)} />
        )}
      </div>

      <div className="card">
        <dl className="detail-grid">
          <div>
            <dt>Time</dt>
            <dd>{formatDateTime(log.createdAt)}</dd>
          </div>
          <div>
            <dt>Tunnel</dt>
            <dd>
              <Link to={`/tunnels/${log.tunnelId}`}>{log.tunnelId.slice(0, 8)}</Link>
            </dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatMs(log.durationMs)}</dd>
          </div>
          <div>
            <dt>Request size</dt>
            <dd>{formatBytes(log.requestBytes)}</dd>
          </div>
          <div>
            <dt>Response size</dt>
            <dd>{formatBytes(log.responseBytes)}</dd>
          </div>
          <div>
            <dt>Client IP</dt>
            <dd>{log.clientIp ?? '—'}</dd>
          </div>
          {log.userAgent && (
            <div>
              <dt>User-Agent</dt>
              <dd>{log.userAgent}</dd>
            </div>
          )}
          {log.error && (
            <div>
              <dt>Error</dt>
              <dd className="error-text">{log.error}</dd>
            </div>
          )}
        </dl>
      </div>

      {bodyExpired && (
        <p className="muted">
          Body preview is no longer available — the in-memory ring buffer entry expired (5-minute
          TTL). Metadata above is from the database and is permanent.
        </p>
      )}

      {bodyQuery.isLoading && <p className="muted">Loading body preview…</p>}

      {body && (
        <>
          <div className="card">
            <h2>Request headers</h2>
            <HeadersTable headers={body.requestHeaders} />
            <h2>Request body</h2>
            <BodyPreview body={body.requestBody} truncated={body.requestBodyTruncated} />
          </div>

          <div className="card">
            <h2>Response headers</h2>
            <HeadersTable headers={body.responseHeaders} />
            <h2>Response body</h2>
            <BodyPreview body={body.responseBody} truncated={body.responseBodyTruncated} />
          </div>
        </>
      )}

      <Link to="/logs">&larr; Back to logs</Link>
    </div>
  );
}

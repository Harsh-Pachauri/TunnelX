import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { listLogs } from '../api/logs';
import { getTunnel } from '../api/tunnels';
import { StatusBadge } from '../components/StatusBadge';
import { formatBytes, formatDateTime, formatMs, statusCodeClass } from '../lib/format';

export function TunnelDetailsPage() {
  const { id } = useParams<{ id: string }>();

  const tunnelQuery = useQuery({
    queryKey: ['tunnel', id],
    queryFn: () => getTunnel(id!),
    enabled: Boolean(id),
  });

  const logsQuery = useQuery({
    queryKey: ['tunnel-logs', id],
    queryFn: () => listLogs({ tunnelId: id, pageSize: 50 }),
    enabled: Boolean(id),
  });

  if (tunnelQuery.isLoading) {
    return (
      <div className="container">
        <p className="muted">Loading tunnel…</p>
      </div>
    );
  }

  if (tunnelQuery.isError || !tunnelQuery.data) {
    return (
      <div className="container">
        <p className="error-text">Tunnel not found.</p>
        <Link to="/">&larr; Back to overview</Link>
      </div>
    );
  }

  const tunnel = tunnelQuery.data;
  const logs = logsQuery.data?.items ?? [];

  return (
    <div className="container">
      <div className="page-header">
        <h1>{tunnel.subdomain}</h1>
        <StatusBadge
          label={tunnel.status}
          className={tunnel.status === 'active' ? 'badge-active' : 'badge-inactive'}
        />
      </div>

      <div className="card">
        <dl className="detail-grid">
          <div>
            <dt>Public URL</dt>
            <dd>
              <a href={tunnel.publicUrl} target="_blank" rel="noreferrer">
                {tunnel.publicUrl}
              </a>
            </dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>localhost:{tunnel.targetPort}</dd>
          </div>
          <div>
            <dt>Latency</dt>
            <dd>{formatMs(tunnel.latencyMs)}</dd>
          </div>
          <div>
            <dt>Connected</dt>
            <dd>{formatDateTime(tunnel.connectedAt)}</dd>
          </div>
          <div>
            <dt>Disconnected</dt>
            <dd>{formatDateTime(tunnel.disconnectedAt)}</dd>
          </div>
          <div>
            <dt>Last heartbeat</dt>
            <dd>{formatDateTime(tunnel.lastHeartbeatAt)}</dd>
          </div>
        </dl>
      </div>

      <div className="card">
        <h2>Recent requests</h2>
        {logsQuery.isLoading && <p className="muted">Loading requests…</p>}
        {logsQuery.isError && <p className="error-text">Failed to load requests.</p>}
        {logsQuery.data && logs.length === 0 && <p className="muted">No requests yet.</p>}
        {logs.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Method</th>
                  <th>Path</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Size</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>{log.method}</td>
                    <td>{log.path}</td>
                    <td>
                      <StatusBadge
                        label={log.statusCode ? String(log.statusCode) : log.error ?? '—'}
                        className={statusCodeClass(log.statusCode)}
                      />
                    </td>
                    <td>{formatMs(log.durationMs)}</td>
                    <td>{formatBytes(log.responseBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Link to="/">&larr; Back to overview</Link>
    </div>
  );
}

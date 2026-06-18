import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { listTunnels } from '../api/tunnels';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, formatMs } from '../lib/format';

export function OverviewPage() {
  const [filter, setFilter] = useState<'active' | 'all'>('active');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['tunnels', filter],
    queryFn: () => listTunnels(filter),
  });

  return (
    <div className="container">
      <div className="page-header">
        <h1>Overview</h1>
        <div className="toggle-group">
          <button type="button" className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>
            Active
          </button>
          <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
            All
          </button>
        </div>
      </div>

      <div className="card">
        {isLoading && <p className="muted">Loading tunnels…</p>}
        {isError && <p className="error-text">Failed to load tunnels.</p>}
        {data && data.length === 0 && (
          <p className="muted">
            No {filter === 'active' ? 'active ' : ''}tunnels yet. Run <code>tunnelx http &lt;port&gt;</code> to create
            one.
          </p>
        )}
        {data && data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Subdomain</th>
                  <th>Public URL</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Latency</th>
                  <th>Connected</th>
                  <th>Disconnected</th>
                </tr>
              </thead>
              <tbody>
                {data.map((tunnel) => (
                  <tr key={tunnel.id}>
                    <td>
                      <Link to={`/tunnels/${tunnel.id}`}>{tunnel.subdomain}</Link>
                    </td>
                    <td>
                      <a href={tunnel.publicUrl} target="_blank" rel="noreferrer">
                        {tunnel.publicUrl}
                      </a>
                    </td>
                    <td>localhost:{tunnel.targetPort}</td>
                    <td>
                      <StatusBadge
                        label={tunnel.status}
                        className={tunnel.status === 'active' ? 'badge-active' : 'badge-inactive'}
                      />
                    </td>
                    <td>{formatMs(tunnel.latencyMs)}</td>
                    <td>{formatDateTime(tunnel.connectedAt)}</td>
                    <td>{formatDateTime(tunnel.disconnectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

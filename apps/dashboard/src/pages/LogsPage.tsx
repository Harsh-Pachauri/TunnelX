import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiClientError } from '../api/client';
import { listLogs } from '../api/logs';
import { listTunnels } from '../api/tunnels';
import { Pagination } from '../components/Pagination';
import { StatusBadge } from '../components/StatusBadge';
import { formatBytes, formatDateTime, formatMs, statusCodeClass } from '../lib/format';
import { useDebouncedValue } from '../lib/useDebouncedValue';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const PAGE_SIZES = [10, 20, 50, 100];

interface Filters {
  tunnelId: string;
  status: string;
  method: string;
  path: string;
  from: string;
  to: string;
}

const emptyFilters: Filters = { tunnelId: '', status: '', method: '', path: '', from: '', to: '' };

export function LogsPage() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const debouncedFilters = useDebouncedValue(filters, 400);

  const tunnelsQuery = useQuery({
    queryKey: ['tunnels', 'all'],
    queryFn: () => listTunnels('all'),
  });

  const logsQuery = useQuery({
    queryKey: ['logs', debouncedFilters, page, pageSize],
    queryFn: () =>
      listLogs({
        tunnelId: debouncedFilters.tunnelId || undefined,
        status: debouncedFilters.status || undefined,
        method: debouncedFilters.method || undefined,
        path: debouncedFilters.path || undefined,
        from: debouncedFilters.from || undefined,
        to: debouncedFilters.to || undefined,
        page,
        pageSize,
      }),
  });

  function updateFilter<K extends keyof Filters>(key: K, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(emptyFilters);
    setPage(1);
  }

  const subdomainById = new Map((tunnelsQuery.data ?? []).map((tunnel) => [tunnel.id, tunnel.subdomain]));
  const logs = logsQuery.data?.items ?? [];

  return (
    <div className="container">
      <h1>Request Logs</h1>

      <div className="card">
        <div className="filters">
          <div className="form-group">
            <label htmlFor="filter-tunnel">Tunnel</label>
            <select
              id="filter-tunnel"
              value={filters.tunnelId}
              onChange={(event) => updateFilter('tunnelId', event.target.value)}
            >
              <option value="">All tunnels</option>
              {(tunnelsQuery.data ?? []).map((tunnel) => (
                <option key={tunnel.id} value={tunnel.id}>
                  {tunnel.subdomain}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="filter-method">Method</label>
            <select
              id="filter-method"
              value={filters.method}
              onChange={(event) => updateFilter('method', event.target.value)}
            >
              <option value="">Any</option>
              {METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="filter-status">Status</label>
            <input
              id="filter-status"
              placeholder="e.g. 404 or 5xx"
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="filter-path">Path contains</label>
            <input
              id="filter-path"
              placeholder="/api/..."
              value={filters.path}
              onChange={(event) => updateFilter('path', event.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="filter-from">From</label>
            <input
              id="filter-from"
              type="datetime-local"
              value={filters.from}
              onChange={(event) => updateFilter('from', event.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="filter-to">To</label>
            <input
              id="filter-to"
              type="datetime-local"
              value={filters.to}
              onChange={(event) => updateFilter('to', event.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="filter-page-size">Page size</label>
            <select
              id="filter-page-size"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn" onClick={clearFilters}>
            Clear filters
          </button>
        </div>

        {logsQuery.isLoading && <p className="muted">Loading…</p>}
        {logsQuery.isError && (
          <p className="error-text">
            {logsQuery.error instanceof ApiClientError ? logsQuery.error.message : 'Failed to load logs.'}
          </p>
        )}
        {logsQuery.data && logs.length === 0 && <p className="muted">No requests match these filters.</p>}
        {logs.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Tunnel</th>
                    <th>Method</th>
                    <th>Path</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Size</th>
                    <th>Client IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatDateTime(log.createdAt)}</td>
                      <td>
                        <Link to={`/tunnels/${log.tunnelId}`}>
                          {subdomainById.get(log.tunnelId) ?? log.tunnelId.slice(0, 8)}
                        </Link>
                      </td>
                      <td>{log.method}</td>
                      <td>
                        <Link to={`/logs/${log.id}`}>{log.path}</Link>
                      </td>
                      <td>
                        <StatusBadge
                          label={log.statusCode ? String(log.statusCode) : log.error ?? '—'}
                          className={statusCodeClass(log.statusCode)}
                        />
                      </td>
                      <td>{formatMs(log.durationMs)}</td>
                      <td>{formatBytes(log.responseBytes)}</td>
                      <td>{log.clientIp ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={logsQuery.data?.total ?? 0} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

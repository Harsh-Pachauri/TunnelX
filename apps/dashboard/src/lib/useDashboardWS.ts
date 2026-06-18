import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getAccessToken } from '../api/client';
import type { DashboardEvent } from '../api/types';
import { useAuth } from '../auth/AuthContext';

const WS_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000').replace(/^http/, 'ws');

/**
 * Opens a WebSocket to /api/ws/dashboard and keeps it alive.
 * On tunnel_status events, invalidates tunnel queries.
 * On new_request events, invalidates log queries.
 * Falls back gracefully to the polling refetchInterval if the WS isn't available.
 */
export function useDashboardWS(): void {
  const { status } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (status !== 'authenticated') return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;
    let stopped = false;

    function connect(): void {
      const token = getAccessToken();
      if (!token || stopped) return;

      ws = new WebSocket(`${WS_BASE}/api/ws/dashboard?token=${encodeURIComponent(token)}`);

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(event.data) as DashboardEvent;
          if (msg.type === 'tunnel_status') {
            void queryClient.invalidateQueries({ queryKey: ['tunnels'] });
            void queryClient.invalidateQueries({ queryKey: ['tunnel', msg.tunnelId] });
          } else if (msg.type === 'new_request') {
            void queryClient.invalidateQueries({ queryKey: ['logs'] });
            void queryClient.invalidateQueries({ queryKey: ['tunnel', msg.log.tunnelId] });
          }
        } catch {
          // malformed message — ignore
        }
      };

      ws.onclose = () => {
        ws = null;
        if (stopped) return;
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
          connect();
        }, reconnectDelay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [status, queryClient]);
}

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type ConnectionState = 'connecting' | 'live' | 'polling';

/**
 * Subscribes to server events over WebSocket and invalidates affected queries. If the socket
 * is unavailable, the UI keeps working through TanStack Query polling (see hooks.ts).
 */
export function useRealtime(): ConnectionState {
  const qc = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let attempts = 0;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/cable`);
      ws.onopen = () => {
        attempts = 0;
        setState('live');
      };
      ws.onmessage = (msg) => {
        try {
          const evt = JSON.parse(String(msg.data)) as { type: string; taskId: number | null };
          if (evt.type === 'connected') return;
          void qc.invalidateQueries({ queryKey: ['dashboard'] });
          void qc.invalidateQueries({ queryKey: ['routing'] });
          void qc.invalidateQueries({ queryKey: ['events'] });
          void qc.invalidateQueries({ queryKey: ['tasks'] });
          if (evt.taskId) void qc.invalidateQueries({ queryKey: ['task', evt.taskId] });
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setState('polling');
        attempts += 1;
        retry = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** attempts));
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [qc]);

  return state;
}

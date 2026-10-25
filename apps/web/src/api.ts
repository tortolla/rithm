import type { Bootstrap, Stats } from './types';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready(): void;
        expand(): void;
        close(): void;
        colorScheme: string;
        HapticFeedback?: { impactOccurred(style: string): void; notificationOccurred(type: string): void };
      };
    };
  }
}

const telegram = window.Telegram?.WebApp;
telegram?.ready();
telegram?.expand();

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set('Content-Type', 'application/json');
  if (telegram?.initData) headers.set('X-Telegram-Init-Data', telegram.initData);
  else headers.set('X-Dev-Telegram-Id', localStorage.getItem('rithm-dev-id') ?? '100000001');
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? 'Не удалось выполнить запрос');
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  settings: (body: object) => request('/api/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  createSprint: (body: object) => request('/api/sprints', { method: 'POST', body: JSON.stringify(body) }),
  habitAction: (id: string, body: object) => request<{ quote?: string }>(`/api/habits/${id}/action`, { method: 'POST', body: JSON.stringify(body) }),
  updateHabit: (id: string, body: object) => request(`/api/habits/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  stats: () => request<Stats | null>('/api/stats'),
  addIdea: (body: object) => request('/api/ideas', { method: 'POST', body: JSON.stringify(body) }),
  updateIdea: (id: string, body: object) => request(`/api/ideas/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteIdea: (id: string) => request(`/api/ideas/${id}`, { method: 'DELETE' }),
  completeSprint: () => request<{ stats: Stats }>('/api/sprints/current/complete', { method: 'POST' })
};

export function haptic(type: 'light' | 'medium' | 'heavy' = 'light') {
  telegram?.HapticFeedback?.impactOccurred(type);
}

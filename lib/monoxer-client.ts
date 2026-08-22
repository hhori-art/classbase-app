type MonoxerClientOptions = {
  baseUrl?: string;
  apiKey?: string;
};

type MonoxerRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
};

export class MonoxerClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(options: MonoxerClientOptions = {}) {
    this.baseUrl = options.baseUrl || process.env.MONOXER_API_BASE_URL || 'https://api.monoxer.example';
    this.apiKey = options.apiKey || process.env.MONOXER_API_KEY || '';
  }

  private async request<T>(path: string, options: MonoxerRequestOptions = {}): Promise<T> {
    if (!this.apiKey) throw new Error('MONOXER_API_KEY is not configured');
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Monoxer request failed: ${res.status}`);
    return data as T;
  }

  createUser(payload: Record<string, unknown>) {
    return this.request('/users', { method: 'POST', body: payload });
  }

  linkClass(payload: Record<string, unknown>) {
    return this.request('/classes/link', { method: 'POST', body: payload });
  }

  fetchLearningData(userId: string) {
    return this.request(`/users/${encodeURIComponent(userId)}/learning-data`);
  }
}


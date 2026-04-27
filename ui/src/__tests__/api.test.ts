import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getConfig,
  putConfig,
  getSuite,
  createTestCase,
  deleteTestCase,
} from '../api';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeOkResponse(body: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as Response;
}

function makeErrorResponse(status: number, statusText: string) {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// getConfig
// ---------------------------------------------------------------------------

describe('getConfig', () => {
  it('calls fetch with GET /api/config and returns parsed JSON', async () => {
    const config = { sources: [{ type: 'local', path: '/sdk' }] };
    mockFetch.mockResolvedValueOnce(makeOkResponse(config));

    const result = await getConfig();

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith('/api/config');
    expect(result).toEqual(config);
  });
});

// ---------------------------------------------------------------------------
// putConfig
// ---------------------------------------------------------------------------

describe('putConfig', () => {
  it('calls fetch with PUT, correct Content-Type header, and serialised body', async () => {
    const config = { sources: [{ type: 'local', path: '/sdk' }] };
    mockFetch.mockResolvedValueOnce(makeOkResponse({ ok: true }));

    const result = await putConfig(config);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/config');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify(config));
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// getSuite
// ---------------------------------------------------------------------------

describe('getSuite', () => {
  it('calls fetch with GET /api/suite and returns array', async () => {
    const suite = [{ id: 'TC-001' }];
    mockFetch.mockResolvedValueOnce(makeOkResponse(suite));

    const result = await getSuite();

    expect(mockFetch).toHaveBeenCalledWith('/api/suite');
    expect(result).toEqual(suite);
  });
});

// ---------------------------------------------------------------------------
// createTestCase
// ---------------------------------------------------------------------------

describe('createTestCase', () => {
  it('calls fetch with POST /api/suite and correct body', async () => {
    const partial = { problemStatement: 'Do something', difficulty: 'easy' as const };
    const created = { id: 'TC-new', ...partial };
    mockFetch.mockResolvedValueOnce(makeOkResponse(created));

    const result = await createTestCase(partial);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/suite');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify(partial));
    expect(result).toEqual(created);
  });
});

// ---------------------------------------------------------------------------
// deleteTestCase
// ---------------------------------------------------------------------------

describe('deleteTestCase', () => {
  it('calls fetch with DELETE /api/suite/:id', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ ok: true }));

    const result = await deleteTestCase('TC-001');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/suite/TC-001');
    expect(init.method).toBe('DELETE');
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('error handling', () => {
  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'));

    await expect(getConfig()).rejects.toThrow('500 Internal Server Error');
  });

  it('throws with correct status text on 404', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(404, 'Not Found'));

    await expect(getSuite()).rejects.toThrow('404 Not Found');
  });
});

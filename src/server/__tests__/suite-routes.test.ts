import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeProjectPaths, makeTestCase } from '../../__tests__/helpers/fixtures.js';
import type { TestCase } from '../../types.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

import { readFile, writeFile } from 'node:fs/promises';
import router from '../routes/suite.js';

function createApp() {
  const paths = makeProjectPaths();
  const app = express();
  app.use(express.json());
  app.locals['paths'] = paths;
  app.use('/', router);
  return app;
}

function setupReadMock(suite: TestCase[]) {
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(suite) as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /suite', () => {
  it('returns array of test cases', async () => {
    const suite = [makeTestCase({ id: 'TC-001' }), makeTestCase({ id: 'TC-002' })];
    setupReadMock(suite);

    const app = createApp();
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('TC-001');
    expect(res.body[1].id).toBe('TC-002');
  });

  it('returns 404 when suite file not found', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const app = createApp();
    const res = await request(app).get('/');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toContain('Could not read suite');
  });
});

describe('POST /suite', () => {
  beforeEach(() => {
    vi.mocked(writeFile).mockResolvedValue(undefined as any);
  });

  it('appends test case with auto-assigned ID', async () => {
    const existingSuite = [makeTestCase({ id: 'TC-001' })];
    setupReadMock(existingSuite);

    const app = createApp();
    const newCase = makeTestCase();
    const { id: _id, ...caseWithoutId } = newCase;

    const res = await request(app)
      .post('/')
      .send(caseWithoutId)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', 'TC-002');
  });

  it('assigns TC-011 when existing IDs include TC-005 and TC-010', async () => {
    const existingSuite = [
      makeTestCase({ id: 'TC-005' }),
      makeTestCase({ id: 'TC-010' }),
    ];
    setupReadMock(existingSuite);

    const app = createApp();
    const { id: _id, ...caseWithoutId } = makeTestCase();

    const res = await request(app)
      .post('/')
      .send(caseWithoutId)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', 'TC-011');
  });
});

describe('GET /suite/:id', () => {
  it('returns single test case by id', async () => {
    const tc = makeTestCase({ id: 'TC-003' });
    setupReadMock([makeTestCase({ id: 'TC-001' }), tc]);

    const app = createApp();
    const res = await request(app).get('/TC-003');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('TC-003');
  });

  it('returns 404 for unknown id', async () => {
    setupReadMock([makeTestCase({ id: 'TC-001' })]);

    const app = createApp();
    const res = await request(app).get('/TC-999');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toContain('TC-999');
  });
});

describe('PUT /suite/:id', () => {
  beforeEach(() => {
    vi.mocked(writeFile).mockResolvedValue(undefined as any);
  });

  it('updates the test case and returns the updated value', async () => {
    const original = makeTestCase({ id: 'TC-001' });
    setupReadMock([original]);

    const updated = { ...original, problemStatement: 'Updated problem' };
    const app = createApp();
    const res = await request(app)
      .put('/TC-001')
      .send(updated)
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('TC-001');
    expect(res.body.problemStatement).toBe('Updated problem');
    expect(writeFile).toHaveBeenCalledOnce();
  });

  it('returns 404 for unknown id', async () => {
    setupReadMock([makeTestCase({ id: 'TC-001' })]);

    const app = createApp();
    const res = await request(app)
      .put('/TC-999')
      .send(makeTestCase({ id: 'TC-999' }))
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toContain('TC-999');
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('DELETE /suite/:id', () => {
  beforeEach(() => {
    vi.mocked(writeFile).mockResolvedValue(undefined as any);
  });

  it('removes the test case and returns { ok: true }', async () => {
    const tc = makeTestCase({ id: 'TC-001' });
    setupReadMock([tc]);

    const app = createApp();
    const res = await request(app).delete('/TC-001');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(writeFile).toHaveBeenCalledOnce();

    // Verify the written suite no longer contains TC-001
    const writtenJson = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const writtenSuite: TestCase[] = JSON.parse(writtenJson);
    expect(writtenSuite.find((t) => t.id === 'TC-001')).toBeUndefined();
  });

  it('returns 404 for unknown id', async () => {
    setupReadMock([makeTestCase({ id: 'TC-001' })]);

    const app = createApp();
    const res = await request(app).delete('/TC-999');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toContain('TC-999');
    expect(writeFile).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeProjectPaths, makeConfig } from '../../__tests__/helpers/fixtures.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

import { readFile, writeFile } from 'node:fs/promises';
import router from '../routes/config.js';

function createApp() {
  const paths = makeProjectPaths();
  const app = express();
  app.use(express.json());
  app.locals['paths'] = paths;
  app.use('/', router);
  return app;
}

describe('GET /config', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns JSON config when file exists', async () => {
    const config = makeConfig();
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(config) as any);

    const app = createApp();
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sources: config.sources,
      targets: config.targets,
    });
    expect(readFile).toHaveBeenCalledWith('/fake/project/config.json', 'utf-8');
  });

  it('returns 404 when file not found', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const app = createApp();
    const res = await request(app).get('/');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toContain('Could not read config');
  });
});

describe('PUT /config', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes JSON and returns { ok: true }', async () => {
    vi.mocked(writeFile).mockResolvedValue(undefined as any);

    const app = createApp();
    const config = makeConfig();
    const res = await request(app).put('/').send(config).set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(writeFile).toHaveBeenCalledWith(
      '/fake/project/config.json',
      JSON.stringify(config, null, 2),
      'utf-8',
    );
  });

  it('returns 500 on write error', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('Permission denied'));

    const app = createApp();
    const res = await request(app).put('/').send(makeConfig()).set('Content-Type', 'application/json');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toContain('Could not write config');
  });
});

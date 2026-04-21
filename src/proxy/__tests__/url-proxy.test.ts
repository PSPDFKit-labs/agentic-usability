import { describe, it, expect } from 'vitest';
import { collectTrackedUrls, makeProxyUrl, rewriteConfigUrlsForProxy } from '../url-proxy.js';
import { makeConfig } from '../../__tests__/helpers/fixtures.js';

describe('url-proxy helpers', () => {
  it('collects URL sources and public docs URLs', () => {
    const config = makeConfig({
      sources: [
        { type: 'local', path: '/tmp/sdk' },
        { type: 'url', url: 'https://docs.example.com/guides', additionalContext: 'guides' },
      ],
      publicInfo: {
        docsUrl: 'https://docs.example.com/api',
        guides: ['https://docs.example.com/tutorial'],
      },
    });

    expect(collectTrackedUrls(config)).toEqual([
      'https://docs.example.com/guides',
      'https://docs.example.com/api',
      'https://docs.example.com/tutorial',
    ]);
  });

  it('rewrites URLs through the local proxy', () => {
    expect(makeProxyUrl('https://www.nutrient.io/guides/web/llms.txt', 'http://127.0.0.1:9000'))
      .toBe('http://127.0.0.1:9000/__agentic_url_proxy__/https/www.nutrient.io/guides/web/llms.txt');
  });

  it('rewrites config URLs and preserves non-URL sources', () => {
    const config = makeConfig({
      sources: [
        { type: 'local', path: '/tmp/sdk' },
        { type: 'url', url: 'https://docs.example.com/guides' },
      ],
      publicInfo: {
        docsUrl: 'https://docs.example.com/api',
        guides: ['https://docs.example.com/tutorial'],
      },
    });

    const rewritten = rewriteConfigUrlsForProxy(config, 'http://127.0.0.1:9000');
    expect(rewritten.sources[0]).toEqual({ type: 'local', path: '/tmp/sdk' });
    expect(rewritten.sources[1]).toEqual({
      type: 'url',
      url: 'http://127.0.0.1:9000/__agentic_url_proxy__/https/docs.example.com/guides',
    });
    expect(rewritten.publicInfo?.docsUrl).toBe('http://127.0.0.1:9000/__agentic_url_proxy__/https/docs.example.com/api');
    expect(rewritten.publicInfo?.guides).toEqual([
      'http://127.0.0.1:9000/__agentic_url_proxy__/https/docs.example.com/tutorial',
    ]);
  });
});

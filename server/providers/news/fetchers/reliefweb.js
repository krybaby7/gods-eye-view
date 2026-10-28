import { fetchNewsBody, httpFailure } from './http.js';
import {
  FETCHER_ITEM_CAP,
  candidate,
  errorMessage,
  sourceStatus,
} from './text.js';

/**
 * ReliefWeb API v2 reports (OCHA, WHO, Red Crescent and partner reports).
 * ReliefWeb requires an approved `appname`; without RELIEFWEB_APPNAME the
 * fetcher stays off and reports itself disabled.
 */

const RELIEFWEB_ENDPOINT = 'https://api.reliefweb.int/v2/reports';
const APPNAME = /^[A-Za-z0-9._-]{1,100}$/;

/** Request body for reports in the theater's countries since `sinceIso`. */
export function reliefwebRequestBody(countries, sinceIso, limit = 60) {
  return {
    filter: {
      operator: 'AND',
      conditions: [
        { field: 'country.iso3', value: countries, operator: 'OR' },
        { field: 'date.created', value: { from: sinceIso } },
      ],
    },
    fields: {
      include: [
        'title',
        'url_alias',
        'url',
        'date.created',
        'date.original',
        'source.name',
        'source.shortname',
        'language.code',
        'body',
      ],
    },
    sort: ['date.created:desc'],
    limit,
  };
}

function plainBody(markdown) {
  return String(markdown || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_>`|]+/g, ' ');
}

function httpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/**
 * Fetch recent reports for one ReliefWeb source. Never throws.
 * @param {object} source Registry source with transport.type 'reliefweb'.
 * @param {{appname?: string, now?: () => number, fetchImpl?: Function, signal?: AbortSignal}} [options]
 */
export async function fetchReliefwebSource(source, options = {}) {
  const { appname, now = Date.now, ...fetchOptions } = options;
  const startedAt = Date.now();
  if (!appname || !APPNAME.test(appname))
    return {
      items: [],
      status: sourceStatus(source, {
        disabled: true,
        error: 'RELIEFWEB_APPNAME not set',
      }),
    };
  const since = new Date(now() - 72 * 3600_000).toISOString();
  try {
    const response = await fetchNewsBody(
      `${RELIEFWEB_ENDPOINT}?appname=${encodeURIComponent(appname)}`,
      {
        ...fetchOptions,
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          reliefwebRequestBody(source.transport.countries, since),
        ),
      },
    );
    if (!response.ok)
      return {
        items: [],
        status: sourceStatus(source, {
          ...httpFailure(response.status),
          durationMs: Date.now() - startedAt,
        }),
      };
    const payload = JSON.parse(response.text || '{}');
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const items = [];
    for (const row of rows) {
      if (items.length >= FETCHER_ITEM_CAP) break;
      const fields = row?.fields || {};
      const url = httpUrl(fields.url_alias) || httpUrl(fields.url);
      if (!url || typeof fields.title !== 'string') continue;
      const authors = (Array.isArray(fields.source) ? fields.source : [])
        .map((entry) => entry?.shortname || entry?.name)
        .filter((name) => typeof name === 'string' && name.trim());
      const issuer = authors.join(', ') || 'ReliefWeb';
      const publishedMs = Date.parse(
        fields.date?.original || fields.date?.created || '',
      );
      items.push(
        candidate(source, {
          title: fields.title,
          snippet: plainBody(fields.body),
          url,
          publishedAt: Number.isNaN(publishedMs)
            ? null
            : new Date(publishedMs).toISOString(),
          language: Array.isArray(fields.language)
            ? fields.language[0]?.code
            : undefined,
          primarySource: { kind: 'report', issuer, url },
        }),
      );
    }
    return {
      items,
      status: sourceStatus(source, {
        ok: true,
        count: items.length,
        durationMs: Date.now() - startedAt,
      }),
    };
  } catch (error) {
    return {
      items: [],
      status: sourceStatus(source, {
        error: errorMessage(error),
        durationMs: Date.now() - startedAt,
      }),
    };
  }
}

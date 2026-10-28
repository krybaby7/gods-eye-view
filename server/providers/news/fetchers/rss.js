import { parseFeedEntries } from '../../common/rss.js';
import { fetchNewsBody, httpFailure } from './http.js';
import {
  FETCHER_ITEM_CAP,
  candidate,
  errorMessage,
  linkedStatement,
  primarySourceFor,
  sourceStatus,
} from './text.js';

/**
 * Fetch one RSS or Atom source. Headline, snippet, link and publisher only.
 * An entry whose text links to an official or armed-group website records
 * that statement as its primary source. Never throws: failures come back as
 * a status record with no items.
 * @param {object} source Registry source with transport.type 'rss'.
 * @param {{fetchImpl?: Function, signal?: AbortSignal, statementHosts?: Map<string, string>}} [options]
 * @returns {Promise<{items: Array<object>, status: object}>}
 */
export async function fetchRssSource(source, options = {}) {
  const { statementHosts = new Map(), ...fetchOptions } = options;
  const startedAt = Date.now();
  try {
    const response = await fetchNewsBody(source.transport.url, {
      ...fetchOptions,
      headers: {
        Accept:
          'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
      },
    });
    if (!response.ok)
      return {
        items: [],
        status: sourceStatus(source, {
          ...httpFailure(response.status),
          durationMs: Date.now() - startedAt,
        }),
      };
    const { language, entries } = parseFeedEntries(response.text);
    if (!entries.length && !/<(rss|feed|rdf:RDF)\b/i.test(response.text))
      return {
        items: [],
        status: sourceStatus(source, {
          error: 'not a feed',
          durationMs: Date.now() - startedAt,
        }),
      };
    const items = entries.slice(0, FETCHER_ITEM_CAP).map((entry) =>
      candidate(source, {
        title: entry.title,
        snippet: entry.description,
        url: entry.url,
        publishedAt: entry.publishedAt,
        language,
        primarySource:
          primarySourceFor(source, entry.url) ??
          linkedStatement(entry.links, statementHosts),
      }),
    );
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

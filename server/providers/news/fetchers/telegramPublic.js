import { decodeEntities } from '../../common/rss.js';
import { fetchNewsBody, httpFailure } from './http.js';
import {
  FETCHER_ITEM_CAP,
  TITLE_MAX,
  candidate,
  clip,
  errorMessage,
  sourceStatus,
} from './text.js';

/**
 * Public Telegram channel previews (https://t.me/s/<channel>): the HTML page
 * Telegram serves without an account. Fragile by nature — markup changes
 * break it — so the status record marks the transport fragile.
 */

function messageText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * Parse a t.me/s preview page into messages, oldest first as served.
 * @param {string} html
 * @param {string} channel Expected channel; posts from other channels
 *   (forwards rendered with a different data-post) are attributed by URL.
 * @returns {Array<{url: string, text: string, publishedAt: ?string}>}
 */
export function parseTelegramPreview(html, channel) {
  const messages = [];
  const page = String(html || '');
  const starts = [
    ...page.matchAll(
      /<div class="tgme_widget_message\b[^"]*"[^>]*\sdata-post="([^"]+)"/g,
    ),
  ];
  for (let index = 0; index < starts.length; index++) {
    const post = starts[index][1];
    const block = page.slice(
      starts[index].index,
      starts[index + 1]?.index ?? page.length,
    );
    const [postChannel, postId] = post.split('/');
    if (!/^\d+$/.test(postId || '')) continue;
    if (postChannel.toLowerCase() !== String(channel).toLowerCase()) continue;
    const textHtml =
      /<div class="tgme_widget_message_text\b[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(
        block,
      )?.[1];
    const text = messageText(textHtml);
    if (!text) continue;
    const datetime = /<time[^>]*\sdatetime="([^"]+)"/.exec(block)?.[1];
    const ms = Date.parse(datetime || '');
    messages.push({
      url: `https://t.me/${postChannel}/${postId}`,
      text,
      publishedAt: Number.isNaN(ms) ? null : new Date(ms).toISOString(),
    });
  }
  return messages;
}

/**
 * Fetch one public channel preview. Never throws.
 * @param {object} source Registry source with transport.type 'telegram-public'.
 * @param {{fetchImpl?: Function, signal?: AbortSignal}} [options]
 */
export async function fetchTelegramSource(source, options = {}) {
  const startedAt = Date.now();
  const channel = source.transport.channel;
  try {
    const response = await fetchNewsBody(
      `https://t.me/s/${encodeURIComponent(channel)}`,
      { ...options, headers: { Accept: 'text/html' } },
    );
    if (!response.ok)
      return {
        items: [],
        status: sourceStatus(source, {
          ...httpFailure(response.status),
          durationMs: Date.now() - startedAt,
        }),
      };
    if (!/tgme_widget_message/.test(response.text))
      return {
        items: [],
        status: sourceStatus(source, {
          error: 'preview markup not found',
          durationMs: Date.now() - startedAt,
        }),
      };
    const items = parseTelegramPreview(response.text, channel)
      .slice(-FETCHER_ITEM_CAP)
      .map((message) => {
        const [firstLine] = message.text.split('\n');
        return candidate(source, {
          title: clip(firstLine, TITLE_MAX),
          snippet: message.text,
          url: message.url,
          publishedAt: message.publishedAt,
        });
      });
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

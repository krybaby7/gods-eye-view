import assert from 'node:assert/strict';
import test from 'node:test';

const now = new Date('2026-11-09T12:00:00Z');
const portrait = (name, licence, thumburl, artist) => ({
  title: 'File:' + name,
  imageinfo: [
    {
      thumburl,
      descriptionurl:
        'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(name),
      extmetadata: {
        LicenseShortName: { value: licence },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' },
        Artist: { value: artist },
      },
    },
  ],
});
const thumb =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Fixture.jpg/120px-Fixture.jpg';
const json = (body, init) => new Response(JSON.stringify(body), init);

test('Commons uses attributed, free thumbnails and skips unusable metadata', async () => {
  const { fetchObservations } = await import('./wikimedia-commons.js');
  const { data, count } = await fetchObservations({
    now,
    features: {
      wikidata: {
        actors: [
          { imageFile: 'Free.jpg' },
          { imageFile: 'Current CDN.jpg' },
          { imageFile: 'Spoof.jpg' },
          { imageFile: 'No licence.jpg' },
          { imageFile: 'Original.jpg' },
          { imageFile: 'No author.jpg' },
        ],
      },
    },
    fetchImpl: async (url) => {
      assert.equal(new URL(url).searchParams.get('iiurlwidth'), '120');
      return json({
        query: {
          pages: [
            portrait(
              'Free.jpg',
              'CC BY 4.0',
              thumb,
              '<a href="/wiki/User:Example">Example &amp; Co</a>',
            ),
            portrait(
              'Current CDN.jpg',
              'CC BY 4.0',
              thumb.replace('upload.wikimedia.org', 'thumb.wikimedia.org') +
                '?utm_source=commons.wikimedia.org',
              'Example',
            ),
            portrait(
              'Spoof.jpg',
              'CC BY 4.0',
              thumb.replace(
                'upload.wikimedia.org',
                'thumb.wikimedia.org.example',
              ),
              'Example',
            ),
            portrait(
              'No licence.jpg',
              'Copyrighted free use',
              thumb,
              'Example',
            ),
            portrait(
              'Original.jpg',
              'CC BY 4.0',
              thumb.replace('/thumb/', '/'),
              'Example',
            ),
            portrait('No author.jpg', 'CC BY 4.0', thumb, '<img src="/x">'),
          ],
        },
      });
    },
  });
  assert.equal(count, 2);
  assert.equal(
    new URL(data.portraits['Current CDN.jpg'].thumbnail).hostname,
    'thumb.wikimedia.org',
  );
  assert.equal(data.portraits['Spoof.jpg'], undefined);
  assert.deepEqual(data.portraits['Free.jpg'], {
    thumbnail: thumb,
    file: 'https://commons.wikimedia.org/wiki/File:Free.jpg',
    licence: 'CC BY 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
    author: 'Example & Co',
  });
});

test('Bluesky normalizes authored posts, ignores reposts, and stops after a 429', async () => {
  const { fetchObservations, shouldCheck } = await import('./bluesky.js');
  const actors = [
    'alpha.example.org',
    'beta.example.org',
    'gamma.example.org',
  ].map((handle, i) => ({
    id: 'Q' + i,
    accounts: { bluesky: 'https://bsky.app/profile/' + handle },
  }));
  const post = {
    uri: 'at://did:plc:fixture/app.bsky.feed.post/key',
    author: { did: 'did:plc:fixture', handle: 'alpha.example.org' },
    record: { text: 'Fixture speech', createdAt: '2026-11-07T13:30:00Z' },
  };
  const calls = [];
  const result = await fetchObservations({
    now,
    features: { wikidata: { actors } },
    fetchImpl: async (url) => {
      const handle = new URL(url).searchParams.get('actor');
      calls.push(handle);
      if (calls.length === 2)
        return json({}, { status: 429, headers: { 'Retry-After': '90' } });
      return json({
        feed: [
          { post },
          {
            post: { ...post, author: { handle: 'other.example.org' } },
            reason: { $type: 'app.bsky.feed.defs#reasonRepost' },
          },
        ],
      });
    },
  });
  assert.deepEqual(calls, ['alpha.example.org', 'beta.example.org']);
  assert.equal(result.count, 1);
  assert.match(result.error, /429/);
  assert.equal(shouldCheck({ now, data: result.data }), false);
  assert.deepEqual(result.data.feeds[actors[0].accounts.bluesky].posts, [
    {
      text: 'Fixture speech',
      url: 'https://bsky.app/profile/did:plc:fixture/post/key',
      publishedAt: '2026-11-07T13:30:00.000Z',
    },
  ]);
});

test('YouTube Atom and official RSS return linked headlines only', async () => {
  const youtube = await import('./youtube-rss.js');
  const government = await import('./government-rss.js');
  const channel = 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv';
  const yt = await youtube.fetchObservations({
    now,
    features: { wikidata: { actors: [{ accounts: { youtube: channel } }] } },
    fetchImpl: async (url) => {
      assert.match(url, /www\.youtube\.com\/feeds\/videos\.xml\?channel_id=UC/);
      return new Response(
        '<feed><entry><title>Fixture &amp; speech</title><link rel="alternate" href="https://www.youtube.com/watch?v=fixture"/><published>2026-11-07T13:30:00Z</published><content>Do not mirror</content></entry></feed>',
      );
    },
  });
  assert.equal(yt.count, 1);
  assert.equal(yt.data.feeds[channel].posts[0].text, 'Fixture & speech');
  const gov = await government.fetchObservations({
    now,
    fetchImpl: async (url) => {
      assert.equal(url, 'https://www.federalreserve.gov/feeds/press_all.xml');
      return new Response(
        '<rss><channel><item><title>Public bulletin</title><link>https://www.federalreserve.gov/newsevents/pressreleases/fixture.htm</link><description>Do not mirror</description></item></channel></rss>',
      );
    },
  });
  assert.equal(gov.count, 1);
  assert.equal(
    gov.data.feeds['https://www.federalreserve.gov/feeds/press_all.xml']
      .posts[0].text,
    'Public bulletin',
  );
});
test('Bluesky treats only the documented missing profile response as unavailable', async () => {
  const { fetchObservations } = await import('./bluesky.js');
  const unavailable = 'https://bsky.app/profile/removed.example.org';
  const other = 'https://bsky.app/profile/other.example.org';
  const { data, detail, error } = await fetchObservations({
    now,
    features: {
      wikidata: { actors: [{ accounts: { bluesky: [unavailable, other] } }] },
    },
    data: { feeds: { [unavailable]: { posts: [{ text: 'Old post' }] } } },
    fetchImpl: async (url) => {
      const removed = new URL(url).searchParams
        .get('actor')
        .startsWith('removed');
      return json(
        {
          error: 'InvalidRequest',
          message: removed ? 'Profile not found' : 'Unexpected parameter',
        },
        { status: 400 },
      );
    },
  });
  assert.deepEqual(data.feeds[unavailable].posts, []);
  assert.equal(data.feeds[other], undefined);
  assert.match(error, /^1 feed request/);
  assert.match(detail, /1 account unavailable/);
});

test('YouTube retries a timed-out request once with a fresh short deadline and preserves posts on failure', async () => {
  const { fetchObservations } = await import('./youtube-rss.js');
  const channel = 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv';
  const signals = [];
  const context = {
    now,
    features: { wikidata: { actors: [{ accounts: { youtube: channel } }] } },
    data: { feeds: { [channel]: { posts: [{ text: 'Last good post' }] } } },
  };
  const recovered = await fetchObservations({
    ...context,
    fetchImpl: async (_url, { signal }) => {
      signals.push(signal);
      if (signals.length === 1)
        throw new DOMException('Deadline', 'TimeoutError');
      return new Response('<feed></feed>');
    },
  });
  assert.equal(recovered.error, undefined);
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  let calls = 0;
  const failed = await fetchObservations({
    ...context,
    fetchImpl: async () => {
      calls += 1;
      throw new DOMException('Deadline', 'TimeoutError');
    },
  });
  assert.equal(calls, 2);
  assert.match(failed.error, /Deadline/);
  assert.deepEqual(
    failed.data.feeds[channel].posts,
    context.data.feeds[channel].posts,
  );
});

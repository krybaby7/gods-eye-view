import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { resolveAllowedHosts } from '../../build/allowedHosts.js';
import { createBrowserViteConfig } from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
import { localMcpPlugin } from '../mcp/plugin.js';
import { apiNotFoundPlugin } from './api-not-found.js';
import { standaloneVoiceTools } from './voiceTools.js';
import { parseLocalReceiverFeeds } from '../providers/local-receivers.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Load this checkout's configuration and attach its local provider middleware. */
export default defineConfig(({ command, mode }) => {
  const loaded = loadEnv(mode, root, '');
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return createBrowserViteConfig({
    plugins: [
      ...localProviderPlugins({ realtime: { tools: standaloneVoiceTools() } }),
      localMcpPlugin(),
      apiNotFoundPlugin(),
    ],
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: process.env.CESIUM_ION_TOKEN,
    mapillaryToken: process.env.MAPILLARY_CLIENT_TOKEN,
    sourceConfiguration: {
      firms: Boolean(String(process.env.FIRMS_MAP_KEY || '').trim()),
      vessels: Boolean(process.env.AISSTREAM_API_KEY),
      localAdsb: parseLocalReceiverFeeds(
        process.env.LOCAL_RECEIVER_FEEDS,
      ).feeds.some((feed) => !feed.reason),
    },
    host: process.env.HOST,
    port: process.env.PORT,
    allowedHosts: resolveAllowedHosts(process.env.GEV_ALLOWED_HOSTS),
    command,
  });
});

import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';

// A failed face must leave icons blank instead of painting their ligature names.
void document.fonts
  .load('400 24px "Material Symbols Outlined"')
  .then((faces) => {
    if (faces.some((face) => face.status === 'loaded')) {
      document.documentElement.classList.add('material-symbols-ready');
    }
  })
  .catch(() => {});

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

application.start().catch((error) => {
  console.error('Global Eye View initialization failed:', error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = `Error: ${describeError(error)}`;
  loaderStatus.style.color = '#ff4444';
});

export { application };

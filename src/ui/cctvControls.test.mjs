import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CctvControls } from './cctvControls.js';

function element() {
  const classes = new Set();
  return {
    dataset: {},
    src: '',
    removeAttribute(name) {
      if (name === 'src') this.src = '';
    },
    classList: {
      add(...values) {
        values.forEach((value) => classes.add(value));
      },
      remove(...values) {
        values.forEach((value) => classes.delete(value));
      },
      contains(value) {
        return classes.has(value);
      },
      toggle(value, enabled) {
        if (enabled) classes.add(value);
        else classes.delete(value);
      },
    },
  };
}
function fixture(t) {
  const prior = globalThis.Image;
  const requests = [];
  globalThis.Image = class {
    constructor() {
      requests.push(this);
    }
  };
  t.after(() => {
    globalThis.Image = prior;
  });
  const controls = new CctvControls({
    elements: { _cctvFrame: element(), _cctvFrameWrap: element() },
    cctv: {},
    actions: { isEnabled: () => true },
  });
  t.after(() => controls.destroy());
  return { controls, requests };
}

test('a late image completion cannot replace a newer camera preview', (t) => {
  const { controls, requests } = fixture(t);
  controls._queueCctvFrame('first.jpg', 'a', true);
  const stale = requests[0].onload;
  controls._queueCctvFrame('second.jpg', 'b', true);
  assert.equal(requests[0].onload, null);
  requests[1].onload();
  stale();
  assert.equal(controls._cctvFrame.src, 'second.jpg');
  assert.equal(controls._cctvFrame.dataset.cameraId, 'b');
});

test('failed refresh preserves settled pixels, but changing cameras clears them', (t) => {
  const { controls, requests } = fixture(t);
  controls._queueCctvFrame('first.jpg', 'a', true);
  requests[0].onload();
  controls._queueCctvFrame('refresh.jpg', 'a', false);
  requests[1].onerror();
  assert.equal(controls._cctvFrame.src, 'first.jpg');
  assert.equal(controls._cctvFrameWrap.classList.contains('has-frame'), true);
  controls._queueCctvFrame('other.jpg', 'b', true);
  assert.equal(controls._cctvFrame.src, '');
  assert.equal(controls._cctvFrameWrap.classList.contains('has-frame'), false);
});

test('destroy invalidates image callbacks and releases each subscription once', (t) => {
  const { controls, requests } = fixture(t);
  let unsubscribed = 0;
  controls.cctv.subscribe = () => () => {
    unsubscribed++;
  };
  controls.connect();
  controls.connect();
  assert.equal(unsubscribed, 1);
  controls._queueCctvFrame('first.jpg', 'a', true);
  const late = requests[0].onload;
  controls.destroy();
  controls.destroy();
  controls.connect();
  late();
  assert.equal(unsubscribed, 2);
  assert.equal(requests[0].onload, null);
  assert.equal(requests[0].onerror, null);
  assert.equal(controls._cctvFrame.src, '');
  controls._queueCctvFrame('late.jpg', 'b', true);
  assert.equal(requests.length, 1);
});

function calibrationFixture(t) {
  const { controls } = fixture(t);
  const prior = globalThis.document;
  const inputs = [];
  globalThis.document = {
    createElement() {
      const input = new EventTarget();
      Object.assign(input, {
        focus() {},
        select() {},
        remove() {
          this.parent.input = null;
        },
      });
      inputs.push(input);
      return input;
    },
  };
  t.after(() => {
    globalThis.document = prior;
  });
  const chip = {
    dataset: { calField: 'heading' },
    textContent: '',
    input: null,
    appendChild(input) {
      this.input = input;
      input.parent = this;
    },
    querySelector() {
      return this.input;
    },
  };
  const patches = [];
  controls.actions.setParams = (params) => patches.push(params);
  controls.actions.setPanelCollapsed = () => {};
  controls._cctvCalReadout = { querySelectorAll: () => [chip] };
  controls._cctvState = {
    enabled: true,
    activeCameraId: 'a',
    activeCamera: { id: 'a', headingDeg: 30, basePose: { headingDeg: 20 } },
  };
  const key = (name) =>
    Object.assign(new Event('keydown', { cancelable: true }), { key: name });
  return { controls, chip, inputs, patches, key };
}

test('calibration commits against the captured camera base and releases its editor', (t) => {
  const { controls, chip, inputs, patches, key } = calibrationFixture(t);
  controls._beginCctvCalValueEdit(chip);
  inputs[0].value = '100';
  controls._cctvState.activeCamera.basePose.headingDeg = 60;
  inputs[0].dispatchEvent(key('Enter'));
  inputs[0].dispatchEvent(new Event('blur'));
  assert.deepEqual(patches, [
    {
      selectedCameraId: 'a',
      calibration: { cameraId: 'a', patch: { headingDeg: 80 } },
    },
  ]);
  assert.equal(controls._calibrationEdit, null);
});

test('a camera switch cancels calibration before old blur can change the new camera', (t) => {
  const { controls, chip, inputs, patches } = calibrationFixture(t);
  controls._beginCctvCalValueEdit(chip);
  inputs[0].value = '100';
  controls._renderCctvState({
    enabled: true,
    activeCameraId: 'b',
    activeCamera: { id: 'b', headingDeg: 200, basePose: { headingDeg: 190 } },
  });
  inputs[0].dispatchEvent(new Event('blur'));
  assert.deepEqual(patches, []);
  assert.equal(chip.input, null);
  assert.equal(chip.textContent, 'Heading 200.0°');
});

test('Escape claims calibration cancellation and disposal prevents late commits', (t) => {
  const { controls, chip, inputs, patches, key } = calibrationFixture(t);
  controls._beginCctvCalValueEdit(chip);
  inputs[0].value = '100';
  const escape = key('Escape');
  inputs[0].dispatchEvent(escape);
  inputs[0].dispatchEvent(new Event('blur'));
  assert.equal(escape.defaultPrevented, true);
  controls._beginCctvCalValueEdit(chip);
  inputs[1].value = '120';
  controls.destroy();
  inputs[1].dispatchEvent(new Event('blur'));
  assert.deepEqual(patches, []);
});

test('disposing during camera enable prevents the delayed focus and future clicks', async () => {
  const button = new EventTarget();
  let resolveEnable;
  let enables = 0;
  let focuses = 0;
  const controls = new CctvControls({
    elements: { _cctvPanel: {}, _cctvNextBtn: button },
    cctv: {},
    actions: {
      isEnabled: () => true,
      syncViewport() {},
      toggleEnabled() {
        enables++;
        return new Promise((resolve) => {
          resolveEnable = resolve;
        });
      },
      runExplicitFocus() {
        focuses++;
      },
    },
  });
  button.dispatchEvent(new Event('click'));
  controls.destroy();
  resolveEnable(true);
  await new Promise((resolve) => setImmediate(resolve));
  button.dispatchEvent(new Event('click'));
  assert.equal(enables, 1);
  assert.equal(focuses, 0);
});
test('preview announces loading and errors separately from the source badge', (t) => {
  const { controls, requests } = fixture(t);
  controls._cctvFrameStatus = element();
  controls._cctvSourceBadge = element();
  const time = {};
  controls._cctvFrameTime = { querySelector: () => time, hidden: true };
  const camera = {
    id: 'a',
    sourceKind: 'snapshot',
    sourceStatus: 'ok',
    frameUrl: 'first.jpg',
  };
  controls._renderCctvState({ enabled: true, activeCamera: camera });
  assert.equal(controls._cctvFrameStatus.textContent, 'Loading frame…');
  assert.equal(controls._cctvSourceBadge.textContent, 'Snapshot · OK');
  assert.equal(controls._cctvFrameTime.hidden, true);
  requests[0].onerror();
  assert.equal(controls._cctvFrameStatus.textContent, 'Frame unavailable');
  assert.equal(controls._cctvFrameStatus.hidden, false);
  controls._renderCctvState({
    enabled: true,
    activeCamera: { ...camera, frameUrl: 'next.jpg' },
  });
  requests[1].onload();
  assert.equal(controls._cctvFrameStatus.hidden, true);
  assert.equal(controls._cctvFrameTime.hidden, false);
  assert.ok(Number.isFinite(Date.parse(time.dateTime)));
  assert.match(time.textContent, / UTC$/);
  controls._renderCctvState({ enabled: false });
  assert.equal(controls._cctvFrameTime.hidden, true);
});

test('video preview waits for a painted frame and rejects callbacks from the prior camera', (t) => {
  const { controls } = fixture(t);
  let nextFrame;
  let draws = 0;
  let clears = 0;
  let video = null;
  const globals = {
    document: { hidden: false },
    requestAnimationFrame: (callback) => {
      nextFrame = callback;
      return 1;
    },
    cancelAnimationFrame: () => {},
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = globalThis[key];
    globalThis[key] = value;
    t.after(() => {
      if (previous === undefined) delete globalThis[key];
      else globalThis[key] = previous;
    });
  }
  controls._cctvFrameStatus = element();
  controls._cctvVideo = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: () => draws++,
      clearRect: () => clears++,
    }),
  };
  controls.cctv.getActiveVideoElement = () => video;
  controls.actions.setPanelCollapsed = () => {};
  const selectVideo = (id) =>
    controls._renderCctvState({
      enabled: true,
      activeCameraId: id,
      activeCamera: { id, isVideo: true },
    });

  selectVideo('a');
  assert.equal(controls._cctvFrameStatus.textContent, 'Waiting for video…');
  nextFrame(0);
  assert.equal(draws, 0);
  video = { readyState: 2, videoWidth: 320, videoHeight: 180, currentTime: 0 };
  nextFrame(100);
  assert.equal(draws, 1);
  assert.equal(controls._cctvFrameStatus.hidden, true);
  const fromPriorCamera = nextFrame;
  const clearsBeforeSwitch = clears;

  video = null;
  selectVideo('b');
  assert.equal(controls._cctvFrameStatus.textContent, 'Waiting for video…');
  assert.equal(clears, clearsBeforeSwitch + 1);
  fromPriorCamera(200);
  assert.equal(draws, 1);
  assert.equal(controls._cctvFrameStatus.textContent, 'Waiting for video…');
  video = { error: { code: 4 } };
  nextFrame(220);
  assert.equal(controls._cctvFrameStatus.textContent, 'Video unavailable');
});

test('the enabled preview shows the loaded count before camera selection', (t) => {
  const { controls } = fixture(t);
  controls._cctvFrameStatus = element();
  controls._renderCctvState({
    enabled: true,
    cameras: [{ id: 'a' }, { id: 'b' }],
  });
  assert.match(controls._cctvFrameStatus.textContent, /^2 cameras loaded/);
});

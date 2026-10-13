import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  OBLIQUE_PITCH,
  STRAIGHT_DOWN_PITCH,
  bindCameraOrientationControls,
  createCameraOrientationAnimator,
  pickViewTarget,
  readCameraTargetFrame,
  resetCameraNorth,
  toggleCameraTilt,
} from './cameraOrientationControls.js';
import { NavigationController } from './navigationController.js';

function createViewer({ cameraPosition, target, pickPosition = null } = {}) {
  const calls = [];
  const changed = new Cesium.Event();
  const surface = target || Cesium.Cartesian3.fromDegrees(0, 0, 0);
  const position = cameraPosition || Cesium.Cartesian3.fromDegrees(0, 0, 1_000);
  const camera = {
    positionWC: position,
    directionWC: new Cesium.Cartesian3(-1, 0, 0),
    upWC: new Cesium.Cartesian3(0, 0, 1),
    heading: Cesium.Math.toRadians(90),
    changed,
    pickEllipsoid: () => surface,
    getPickRay: () => ({}),
    lookAt(targetValue, offset) {
      calls.push({ type: 'lookAt', target: targetValue, offset });
    },
    lookAtTransform(transform) {
      calls.push({ type: 'lookAtTransform', transform });
    },
    setView(view) {
      calls.push({ type: 'setView', view });
    },
  };
  const viewer = {
    camera,
    scene: {
      canvas: { clientWidth: 1_200, clientHeight: 800 },
      pickPositionSupported: Boolean(pickPosition),
      pickPosition: pickPosition || (() => null),
      globe: { pick: () => surface },
      requestRender: () => calls.push({ type: 'requestRender' }),
    },
  };
  return { viewer, calls, target: surface };
}

class FakeButton extends EventTarget {
  constructor() {
    super();
    this.attributes = new Map();
    this.style = {
      setProperty: (name, value) => this.attributes.set(name, value),
    };
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name);
  }
  click() {
    this.dispatchEvent(new Event('click'));
  }
}

/**
 * A real Cesium camera attached to a minimal offscreen scene.
 *
 * The fake above records what lookAt was asked for but never moves, so it
 * cannot show whether a frame written into the camera reads back as the same
 * frame. These cases need the production math on both sides.
 */
function createRealCamera() {
  const scene = {
    canvas: { clientWidth: 1200, clientHeight: 800, width: 1200, height: 800 },
    drawingBufferWidth: 1200,
    drawingBufferHeight: 800,
    mapProjection: new Cesium.GeographicProjection(Cesium.Ellipsoid.WGS84),
    globe: { ellipsoid: Cesium.Ellipsoid.WGS84 },
    mapMode2D: Cesium.MapMode2D.INFINITE_SCROLL,
    // setView converts a world-space direction/up pair into the local frame
    // only in 3D, and the camera derives heading/pitch the same way, so the
    // scene mode is load-bearing here rather than decoration.
    mode: Cesium.SceneMode.SCENE3D,
    pixelRatio: 1,
  };
  const camera = new Cesium.Camera(scene);
  scene.camera = camera;
  return { camera, scene };
}

/** A viewer whose center pick is a fixed ground point and whose camera is real. */
function createRealViewer(target) {
  const { camera, scene } = createRealCamera();
  scene.pickPositionSupported = false;
  scene.pickPosition = () => null;
  scene.globe.pick = () => target;
  scene.requestRender = () => {};
  // The binding drives the needle from the scene's per-frame signal, not from
  // `camera.changed`, so the fixture has to carry one.
  scene.preRender = new Cesium.Event();
  camera.getPickRay = () => ({});
  return { viewer: { camera, scene }, target };
}

/** Place a real camera in an orbit around `target` and release the frame. */
function orbit(viewer, target, headingDeg, pitchRad, range) {
  viewer.camera.lookAt(
    target,
    new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(headingDeg),
      pitchRad,
      range,
    ),
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
}

const AUSTIN_GROUND = Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 0);

test('a heading written into a real camera reads back as the same heading', () => {
  // One oblique heading per quadrant, plus the cardinals, at pitches a user
  // reaches with the tilt control.
  for (const headingDeg of [0, 30, 90, 135, 180, 225, 270, 315, 350]) {
    for (const pitchDeg of [-25, -40, -65]) {
      const { viewer } = createRealViewer(AUSTIN_GROUND);
      viewer.camera.lookAt(
        AUSTIN_GROUND,
        new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(headingDeg),
          Cesium.Math.toRadians(pitchDeg),
          4000,
        ),
      );
      viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

      const frame = readCameraTargetFrame(viewer);
      assert.ok(frame, `no frame at ${headingDeg}/${pitchDeg}`);
      const readDeg = Cesium.Math.toDegrees(frame.heading);
      assert.ok(
        Math.abs(((readDeg - headingDeg + 540) % 360) - 180) < 0.01,
        `heading ${headingDeg} deg at pitch ${pitchDeg} read back as ${readDeg.toFixed(2)} deg`,
      );
      assert.ok(
        Math.abs(Cesium.Math.toDegrees(frame.pitch) - pitchDeg) < 0.01,
        `pitch ${pitchDeg} read back as ${Cesium.Math.toDegrees(frame.pitch).toFixed(2)}`,
      );
      assert.ok(Math.abs(frame.range - 4000) < 1, `range ${frame.range}`);
    }
  }
});

test('north-up really points a real camera north from every quadrant', () => {
  for (const headingDeg of [30, 135, 225, 315]) {
    const { viewer } = createRealViewer(AUSTIN_GROUND);
    viewer.camera.lookAt(
      AUSTIN_GROUND,
      new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(headingDeg),
        Cesium.Math.toRadians(-40),
        4000,
      ),
    );
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

    assert.equal(
      resetCameraNorth(viewer),
      true,
      `reset failed at ${headingDeg}`,
    );
    const after = readCameraTargetFrame(viewer);
    assert.ok(after, `no frame after reset at ${headingDeg}`);
    const readDeg = Cesium.Math.toDegrees(after.heading);
    assert.ok(
      Math.min(readDeg, 360 - readDeg) < 0.01,
      `north-up from ${headingDeg} deg left the camera at ${readDeg.toFixed(2)} deg`,
    );
    assert.ok(
      Math.abs(Cesium.Math.toDegrees(after.pitch) + 40) < 0.01,
      'north-up must not change the pitch',
    );
    assert.ok(
      Math.abs(after.range - 4000) < 1,
      'north-up must not change the range',
    );
  }
});

test('tilt moves a real camera between the two pitches and keeps target and range', () => {
  const { viewer } = createRealViewer(AUSTIN_GROUND);
  viewer.camera.lookAt(
    AUSTIN_GROUND,
    new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(215),
      STRAIGHT_DOWN_PITCH,
      3000,
    ),
  );
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

  const first = toggleCameraTilt(viewer);
  assert.deepEqual(first, { tilted: true, pitch: OBLIQUE_PITCH });
  const tilted = readCameraTargetFrame(viewer);
  assert.ok(Math.abs(tilted.pitch - OBLIQUE_PITCH) < 1e-6);
  assert.ok(Math.abs(tilted.range - 3000) < 1, `range ${tilted.range}`);
  assert.ok(
    Math.abs(Cesium.Math.toDegrees(tilted.heading) - 215) < 0.01,
    'tilt must not rotate the map',
  );

  // Releasing the orbit frame must leave the camera pointing at the same
  // ground, not merely standing in the right place.
  const toTarget = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(
      AUSTIN_GROUND,
      viewer.camera.positionWC,
      new Cesium.Cartesian3(),
    ),
    new Cesium.Cartesian3(),
  );
  const offBy = Cesium.Math.toDegrees(
    Math.acos(
      Cesium.Math.clamp(
        Cesium.Cartesian3.dot(viewer.camera.directionWC, toTarget),
        -1,
        1,
      ),
    ),
  );
  assert.ok(
    offBy < 0.05,
    `camera points ${offBy.toFixed(2)} deg away from its target`,
  );

  const second = toggleCameraTilt(viewer);
  assert.deepEqual(second, { tilted: false, pitch: STRAIGHT_DOWN_PITCH });
  const down = readCameraTargetFrame(viewer);
  assert.ok(Math.abs(down.pitch - STRAIGHT_DOWN_PITCH) < 1e-6);
  assert.ok(Math.abs(down.range - 3000) < 1);
});

test('tilt alternates at globe range, not only at map range', () => {
  // The canonical full-globe view. The camera's own pitch here is tens of
  // degrees away from the orbit pitch, so a control reading the camera would
  // command oblique twice in a row and the map would never come back level.
  for (const range of [3_000, 250_000, 18_000_000]) {
    const { viewer } = createRealViewer(AUSTIN_GROUND);
    orbit(viewer, AUSTIN_GROUND, 0, STRAIGHT_DOWN_PITCH, range);

    const first = toggleCameraTilt(viewer);
    assert.deepEqual(
      first,
      { tilted: true, pitch: OBLIQUE_PITCH },
      `first click at ${range} m must tilt`,
    );
    const second = toggleCameraTilt(viewer);
    assert.deepEqual(
      second,
      { tilted: false, pitch: STRAIGHT_DOWN_PITCH },
      `second click at ${range} m must level (camera pitch reads ${Cesium.Math.toDegrees(viewer.camera.pitch).toFixed(1)} deg)`,
    );
    const third = toggleCameraTilt(viewer);
    assert.deepEqual(
      third,
      { tilted: true, pitch: OBLIQUE_PITCH },
      `third click at ${range} m must tilt again`,
    );
  }
});

test('the button shows the state the next click will produce, at every range', () => {
  for (const range of [3_000, 18_000_000]) {
    const { viewer } = createRealViewer(AUSTIN_GROUND);
    orbit(viewer, AUSTIN_GROUND, 0, STRAIGHT_DOWN_PITCH, range);
    const tiltButton = new FakeButton();
    const controls = bindCameraOrientationControls({
      viewer,
      elements: { tiltButton, northButton: new FakeButton() },
      runNavigation: (_noun, navigate) => navigate(),
    });

    assert.equal(
      tiltButton.getAttribute('aria-pressed'),
      'false',
      `straight down at ${range} m must not read as tilted`,
    );
    tiltButton.click();
    assert.equal(
      tiltButton.getAttribute('aria-pressed'),
      'true',
      `after one click at ${range} m the button must read tilted`,
    );
    // And the exact refresh that runs when the camera settles must agree.
    controls.refreshTilt();
    assert.equal(
      tiltButton.getAttribute('aria-pressed'),
      'true',
      `the settled state at ${range} m must agree with the commanded one`,
    );
    controls.destroy();
  }
});

test('the needle follows a rotation too small for the camera-changed threshold', () => {
  const { viewer } = createRealViewer(AUSTIN_GROUND);
  orbit(viewer, AUSTIN_GROUND, 0, Cesium.Math.toRadians(-80), 5_000);
  const northButton = new FakeButton();
  const controls = bindCameraOrientationControls({
    viewer,
    elements: { tiltButton: new FakeButton(), northButton },
    runNavigation: (_noun, navigate) => navigate(),
  });
  assert.equal(northButton.getAttribute('--camera-heading'), '0deg');

  // Ten degrees is far below Cesium's default percentageChanged, so
  // `camera.changed` may never fire for it; the per-frame signal must.
  let changedFired = 0;
  viewer.camera.changed.addEventListener(() => {
    changedFired += 1;
  });
  orbit(viewer, AUSTIN_GROUND, 10, Cesium.Math.toRadians(-80), 5_000);
  viewer.scene.preRender.raiseEvent();
  assert.equal(
    northButton.getAttribute('--camera-heading'),
    '10deg',
    `needle must follow a 10 degree rotation (camera.changed fired ${changedFired} time(s))`,
  );

  orbit(viewer, AUSTIN_GROUND, 13, Cesium.Math.toRadians(-80), 5_000);
  viewer.scene.preRender.raiseEvent();
  assert.equal(northButton.getAttribute('--camera-heading'), '13deg');
  controls.destroy();
});

test('north-up indicator follows real heading including the 360-degree seam', () => {
  const { viewer } = createRealViewer(AUSTIN_GROUND);
  const northButton = new FakeButton();
  const controls = bindCameraOrientationControls({
    viewer,
    elements: { northButton },
    runNavigation: (_noun, navigate) => navigate(),
  });
  for (const [heading, active] of [
    [0, true],
    [15, false],
    [359.8, true],
    [359, false],
    [360, true],
    [90, false],
  ]) {
    orbit(viewer, AUSTIN_GROUND, heading, Cesium.Math.toRadians(-80), 5_000);
    viewer.scene.preRender.raiseEvent();
    assert.equal(
      northButton.getAttribute('data-north-up'),
      String(active),
      `heading ${heading}`,
    );
  }
  controls.destroy();
});

test('a settled camera writes nothing, and teardown releases every signal', () => {
  const { viewer } = createRealViewer(AUSTIN_GROUND);
  orbit(viewer, AUSTIN_GROUND, 0, Cesium.Math.toRadians(-80), 5_000);
  const tiltButton = new FakeButton();
  const northButton = new FakeButton();
  let writes = 0;
  const count = (element) => {
    const setAttribute = element.setAttribute.bind(element);
    const setProperty = element.style.setProperty.bind(element.style);
    element.setAttribute = (name, value) => {
      writes += 1;
      setAttribute(name, value);
    };
    element.style.setProperty = (name, value) => {
      writes += 1;
      setProperty(name, value);
    };
  };
  count(tiltButton);
  count(northButton);

  const preRenderBefore = viewer.scene.preRender.numberOfListeners;
  const moveEndBefore = viewer.camera.moveEnd.numberOfListeners;
  const controls = bindCameraOrientationControls({
    viewer,
    elements: { tiltButton, northButton },
    runNavigation: (_noun, navigate) => navigate(),
  });
  assert.equal(viewer.scene.preRender.numberOfListeners, preRenderBefore + 1);
  assert.equal(viewer.camera.moveEnd.numberOfListeners, moveEndBefore + 1);

  writes = 0;
  for (let i = 0; i < 60; i += 1) viewer.scene.preRender.raiseEvent();
  assert.equal(writes, 0, '60 frames of a settled camera write nothing');

  orbit(viewer, AUSTIN_GROUND, 47, Cesium.Math.toRadians(-80), 5_000);
  viewer.scene.preRender.raiseEvent();
  assert.ok(writes > 0, 'a rotated camera updates the needle');
  writes = 0;
  for (let i = 0; i < 20; i += 1) viewer.scene.preRender.raiseEvent();
  assert.equal(writes, 0, 'and then goes quiet again');

  controls.destroy();
  assert.equal(viewer.scene.preRender.numberOfListeners, preRenderBefore);
  assert.equal(viewer.camera.moveEnd.numberOfListeners, moveEndBefore);
  writes = 0;
  orbit(viewer, AUSTIN_GROUND, 120, Cesium.Math.toRadians(-80), 5_000);
  viewer.scene.preRender.raiseEvent();
  viewer.camera.moveEnd.raiseEvent();
  tiltButton.click();
  assert.equal(writes, 0, 'a destroyed binding writes nothing');
});

test('a sky-facing camera yields no frame and both actions decline', () => {
  const { camera, scene } = createRealCamera();
  scene.pickPositionSupported = false;
  scene.pickPosition = () => null;
  scene.globe.pick = () => undefined;
  scene.requestRender = () => {};
  camera.getPickRay = () => ({});
  camera.pickEllipsoid = () => undefined;
  const viewer = { camera, scene };

  assert.equal(readCameraTargetFrame(viewer), null);
  assert.equal(toggleCameraTilt(viewer), false);
  assert.equal(resetCameraNorth(viewer), false);
});

test('center picking prefers terrain over the ellipsoid and falls through an invalid depth hit', () => {
  const invalid = new Cesium.Cartesian3(Number.NaN, 0, 0);
  const terrain = Cesium.Cartesian3.fromDegrees(-97.74, 30.27, 400);
  const sea = Cesium.Cartesian3.fromDegrees(-97.74, 30.27, 0);
  const { viewer } = createViewer({ pickPosition: () => invalid });
  viewer.scene.globe.pick = () => terrain;
  viewer.camera.pickEllipsoid = () => sea;
  assert.equal(
    pickViewTarget(viewer),
    terrain,
    'the rendered ground wins over sea level',
  );

  viewer.scene.globe.pick = () => null;
  assert.equal(
    pickViewTarget(viewer),
    sea,
    'the ellipsoid still answers when nothing is under the cursor',
  );
});

test('target frame identifies a straight-down camera in local ENU space', () => {
  const { viewer } = createViewer();
  const frame = readCameraTargetFrame(viewer);
  assert.ok(frame);
  assert.ok(Math.abs(frame.pitch - Cesium.Math.toRadians(-90)) < 0.001);
  assert.ok(frame.range > 999 && frame.range < 1_001);
  assert.equal(frame.heading, Cesium.Math.toRadians(90));
});

test('tilt preserves the picked target and range while choosing oblique pitch', () => {
  const { viewer, calls, target } = createViewer();
  const before = readCameraTargetFrame(viewer);
  const result = toggleCameraTilt(viewer);
  const lookAt = calls.find((call) => call.type === 'lookAt');
  assert.deepEqual(result, { tilted: true, pitch: OBLIQUE_PITCH });
  assert.equal(lookAt.target, target);
  assert.equal(lookAt.offset.range, before.range);
  assert.equal(lookAt.offset.pitch, OBLIQUE_PITCH);
  assert.ok(calls.some((call) => call.type === 'lookAtTransform'));
  assert.ok(calls.some((call) => call.type === 'setView'));
});

test('north-up preserves target pitch and range', () => {
  const { viewer, calls } = createViewer();
  const before = readCameraTargetFrame(viewer);
  assert.equal(resetCameraNorth(viewer), true);
  const lookAt = calls.find((call) => call.type === 'lookAt');
  assert.equal(lookAt.offset.heading, 0);
  assert.equal(lookAt.offset.pitch, before.pitch);
  assert.equal(lookAt.offset.range, before.range);
});

test('bindings route both controls and release every listener on destroy', () => {
  const { viewer } = createViewer();
  const tiltButton = new FakeButton();
  const northButton = new FakeButton();
  const navigations = [];
  const toasts = [];
  const controls = bindCameraOrientationControls({
    viewer,
    elements: { tiltButton, northButton },
    runNavigation(noun, navigate) {
      navigations.push(noun);
      return navigate();
    },
    showToast: (message) => toasts.push(message),
  });

  tiltButton.click();
  northButton.click();
  assert.deepEqual(navigations, ['camera', 'camera']);
  assert.deepEqual(toasts, ['Tilted view', 'North up']);
  // The button shows the state the click just commanded, not a re-measurement.
  assert.equal(tiltButton.getAttribute('aria-pressed'), 'true');
  assert.equal(northButton.getAttribute('--camera-heading'), '90deg');

  viewer.camera.heading = -1e-12;
  controls.sync();
  assert.equal(northButton.getAttribute('--camera-heading'), '0deg');

  controls.destroy();
  tiltButton.click();
  assert.deepEqual(navigations, ['camera', 'camera']);
  assert.equal(STRAIGHT_DOWN_PITCH, Cesium.Math.toRadians(-89));
});

for (const [label, altitude, range] of [
  ['aircraft', 10000, 1500],
  ['satellite', 400000, 1500000],
  ['high satellite', 35786000, 3000000],
]) {
  test(`${label}: animated tilt and north retain a moving EntityView`, (t) => {
    // Use Cesium's built-in TEME fallback without fetching Earth-orientation data.
    t.mock.method(
      Cesium.Transforms,
      'computeFixedToIcrfMatrix',
      () => undefined,
    );
    let target = Cesium.Cartesian3.fromDegrees(-97, 30, altitude);
    const { viewer } = createRealViewer(target);
    viewer.scene.preUpdate = new Cesium.Event();
    viewer.clock = { currentTime: Cesium.JulianDate.now() };
    const entity = new Cesium.Entity({
      position: new Cesium.CallbackPositionProperty(() => target, false),
      trackingReferenceFrame: Cesium.TrackingReferenceFrame.ENU,
    });
    entity.gevDisplayPosition = () => target;
    viewer.trackedEntity = entity;
    const follow = new Cesium.EntityView(entity, viewer.scene);
    follow.update(viewer.clock.currentTime);
    viewer.camera.lookAt(
      target,
      new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(350),
        OBLIQUE_PITCH,
        range,
      ),
    );
    let time = 0;
    const animator = createCameraOrientationAnimator(viewer, {
      now: () => time,
      duration: 1000,
    });
    for (const pitch of [STRAIGHT_DOWN_PITCH, OBLIQUE_PITCH]) {
      const frame = readCameraTargetFrame(viewer);
      animator.animate(frame, { heading: 0, pitch });
      for (const step of [0, 100, 500, 900, 1000]) {
        time = (pitch === STRAIGHT_DOWN_PITCH ? 0 : 1000) + step;
        target = Cesium.Cartesian3.fromDegrees(
          -97 + time / 100000,
          30,
          altitude,
        );
        follow.update(viewer.clock.currentTime);
        const transform = Cesium.Matrix4.clone(viewer.camera.transform);
        viewer.scene.preUpdate.raiseEvent();
        assert.equal(viewer.trackedEntity, entity);
        assert.ok(
          Cesium.Matrix4.equalsEpsilon(
            viewer.camera.transform,
            transform,
            1e-8,
          ),
        );
        const actual = readCameraTargetFrame(viewer);
        const eased = Cesium.EasingFunction.CUBIC_IN_OUT(step / 1000);
        assert.ok(
          Math.abs(actual.pitch - Cesium.Math.lerp(frame.pitch, pitch, eased)) <
            1e-6,
        );
        assert.ok(Math.abs(actual.range - range) < 1e-5);
      }
      assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
    }
    target = Cesium.Cartesian3.fromDegrees(-96, 31, altitude);
    follow.update(viewer.clock.currentTime);
    assert.equal(viewer.trackedEntity, entity);
    assert.ok(Math.abs(readCameraTargetFrame(viewer).range - range) < 1e-5);
  });
}

test('orientation animation cancels on replacement and explicit cancellation', () => {
  const { viewer } = createRealViewer(Cesium.Cartesian3.fromDegrees(0, 0));
  orbit(viewer, Cesium.Cartesian3.fromDegrees(0, 0), 90, OBLIQUE_PITCH, 1000);
  viewer.scene.preUpdate = new Cesium.Event();
  const animator = createCameraOrientationAnimator(viewer);
  const frame = readCameraTargetFrame(viewer);
  animator.animate(frame, { heading: 0, pitch: STRAIGHT_DOWN_PITCH });
  animator.animate(frame, { heading: 0, pitch: OBLIQUE_PITCH });
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 1);
  viewer.trackedEntity = {};
  viewer.scene.preUpdate.raiseEvent();
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
  viewer.trackedEntity = undefined;
  animator.animate(frame, { heading: 0, pitch: STRAIGHT_DOWN_PITCH });
  animator.cancel();
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
});

test('orientation navigation preserves follow and selection; new navigation cancels animation', () => {
  const calls = [];
  const entity = {};
  const viewer = {
    trackedEntity: entity,
    camera: { cancelFlight: () => calls.push('cancel-flight') },
  };
  let cockpit = false;
  const navigation = new NavigationController({
    viewer,
    tracking: {},
    isCockpitActive: () => cockpit,
    cancelOrientation: () => calls.push('cancel-orientation'),
    clearLocation: () => calls.push('clear-location'),
    cancelShareSelection: () => calls.push('clear-selection'),
    interruptCameraMotion: () => calls.push('interrupt-motion'),
    stopOrbit: () => calls.push('stop-orbit'),
    showToast: () => calls.push('toast'),
  });
  assert.equal(
    navigation.runOrientation('camera', () => 'animated'),
    'animated',
  );
  assert.equal(viewer.trackedEntity, entity);
  assert.deepEqual(calls, [
    'cancel-orientation',
    'interrupt-motion',
    'stop-orbit',
    'cancel-flight',
  ]);
  calls.length = 0;
  navigation._stampNavigation({ cancelPendingSelection: false });
  assert.deepEqual(calls, ['cancel-orientation', 'clear-location']);
  calls.length = 0;
  cockpit = true;
  assert.equal(
    navigation.runOrientation('camera', () =>
      assert.fail('cockpit should refuse'),
    ),
    false,
  );
  assert.deepEqual(calls, ['toast']);
});

test('rapid tilt presses reverse direction and north-up keeps the requested tilt', (t) => {
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  const target = Cesium.Cartesian3.fromDegrees(0, 0);
  const { viewer } = createRealViewer(target);
  orbit(viewer, target, 90, OBLIQUE_PITCH, 1000);
  viewer.scene.preUpdate = new Cesium.Event();
  const tiltButton = new FakeButton();
  const northButton = new FakeButton();
  let controls;
  controls = bindCameraOrientationControls({
    viewer,
    elements: { tiltButton, northButton },
    runNavigation: (_noun, navigate) => {
      controls.cancel();
      return navigate();
    },
  });
  tiltButton.click();
  tiltButton.click();
  assert.equal(tiltButton.getAttribute('aria-pressed'), 'true');
  tiltButton.click();
  northButton.click();
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 1);
  time = 650;
  viewer.scene.preUpdate.raiseEvent();
  const frame = readCameraTargetFrame(viewer);
  assert.ok(Math.abs(frame.pitch - STRAIGHT_DOWN_PITCH) < 1e-6);
  assert.ok(Math.abs(frame.heading) < 1e-6);
  controls.destroy();
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
});

function bindRealZoomControls(
  t,
  {
    target = AUSTIN_GROUND,
    range = 4500,
    heading = 215,
    pitch = OBLIQUE_PITCH,
    minimum = 5,
    maximum = 50_000_000,
  } = {},
) {
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  const { viewer } = createRealViewer(target);
  orbit(viewer, target, heading, pitch, range);
  viewer.scene.canvas = Object.assign(new EventTarget(), viewer.scene.canvas);
  viewer.scene.preUpdate = new Cesium.Event();
  viewer.scene.screenSpaceCameraController = {
    minimumZoomDistance: minimum,
    maximumZoomDistance: maximum,
  };
  const elements = {
    zoomInButton: new FakeButton(),
    zoomOutButton: new FakeButton(),
    tiltButton: new FakeButton(),
    tiltLabel: { textContent: '' },
    northButton: new FakeButton(),
  };
  const navigations = [];
  let controls;
  const navigation = new NavigationController({
    viewer,
    tracking: {},
    cancelOrientation: () => controls?.cancel(),
    isCockpitActive: () => false,
    interruptCameraMotion: () => {},
    clearLocation: () => assert.fail('camera controls retain location'),
    cancelShareSelection: () => assert.fail('camera controls retain selection'),
    stopOrbit: () => {},
    showToast: () => {},
  });
  controls = bindCameraOrientationControls({
    viewer,
    elements,
    runNavigation: (noun, navigate) => {
      navigations.push(noun);
      return navigation.runOrientation(noun, navigate);
    },
  });
  t.after(() => controls.destroy());
  return {
    viewer,
    elements,
    controls,
    navigations,
    advance(nextTime) {
      time = nextTime;
      viewer.scene.preUpdate.raiseEvent();
    },
  };
}

function assertOrbit(frame, { target = AUSTIN_GROUND, range, heading, pitch }) {
  assert.ok(frame, 'camera still has a target frame');
  assert.ok(Cesium.Cartesian3.distance(frame.target, target) < 1e-6);
  assert.ok(
    Math.abs(frame.range - range) < 1e-5,
    `range ${frame.range}, expected ${range}`,
  );
  if (heading !== undefined) {
    assert.ok(
      Math.abs(Cesium.Math.negativePiToPi(frame.heading - heading)) < 1e-6,
      `heading ${frame.heading}, expected ${heading}`,
    );
  }
  if (pitch !== undefined) {
    assert.ok(
      Math.abs(frame.pitch - pitch) < 1e-6,
      `pitch ${frame.pitch}, expected ${pitch}`,
    );
  }
}

test('range-only animation eases a real camera while retaining target and orientation', () => {
  const { viewer } = createRealViewer(AUSTIN_GROUND);
  orbit(viewer, AUSTIN_GROUND, 215, OBLIQUE_PITCH, 4500);
  viewer.scene.preUpdate = new Cesium.Event();
  let time = 0;
  const animator = createCameraOrientationAnimator(viewer, {
    now: () => time,
    duration: 1000,
  });
  const frame = readCameraTargetFrame(viewer);
  assert.equal(animator.animate(frame, { range: 3000 }), true);
  assert.equal(animator.destination.heading, frame.heading);
  assert.equal(animator.destination.pitch, frame.pitch);
  assert.equal(animator.destination.range, 3000);
  for (const step of [0, 250, 500, 750, 1000]) {
    time = step;
    viewer.scene.preUpdate.raiseEvent();
    assertOrbit(readCameraTargetFrame(viewer), {
      range: Cesium.Math.lerp(
        4500,
        3000,
        Cesium.EasingFunction.CUBIC_IN_OUT(step / 1000),
      ),
      heading: frame.heading,
      pitch: frame.pitch,
    });
  }
  assert.equal(animator.destination, null);
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
});

test('invalid optional animation coordinates retain the real camera frame', () => {
  const { viewer } = createRealViewer(AUSTIN_GROUND);
  orbit(viewer, AUSTIN_GROUND, 35, OBLIQUE_PITCH, 3000);
  const frame = readCameraTargetFrame(viewer);
  const animator = createCameraOrientationAnimator(viewer, { duration: 0 });
  assert.equal(
    animator.animate(frame, { heading: NaN, pitch: NaN, range: -1 }),
    true,
  );
  assertOrbit(readCameraTargetFrame(viewer), frame);
});

test('zoom buttons ease reciprocal range changes without rotating or changing target', (t) => {
  const { viewer, elements, advance, navigations } = bindRealZoomControls(t);
  const before = readCameraTargetFrame(viewer);
  elements.zoomInButton.click();
  assert.deepEqual(navigations, ['camera']);
  assertOrbit(readCameraTargetFrame(viewer), before);
  advance(325);
  assertOrbit(readCameraTargetFrame(viewer), { ...before, range: 3750 });
  advance(650);
  assertOrbit(readCameraTargetFrame(viewer), { ...before, range: 3000 });
  elements.zoomOutButton.click();
  advance(1300);
  assertOrbit(readCameraTargetFrame(viewer), before);
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
});

test('rapid zoom presses accumulate their destination and reverse from the requested range', (t) => {
  const { viewer, elements, advance } = bindRealZoomControls(t);
  const before = readCameraTargetFrame(viewer);
  elements.zoomInButton.click();
  advance(200);
  elements.zoomInButton.click();
  elements.zoomOutButton.click();
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 1);
  advance(850);
  assertOrbit(readCameraTargetFrame(viewer), { ...before, range: 3000 });
  elements.zoomOutButton.click();
  advance(1500);
  assertOrbit(readCameraTargetFrame(viewer), before);
});

test('tracked zoom destinations obey range bounds and the readable minimum', (t) => {
  const { viewer, elements, advance } = bindRealZoomControls(t, {
    range: 900,
    minimum: 700,
    maximum: 1100,
  });
  const entity = new Cesium.Entity({ position: AUSTIN_GROUND });
  entity.gevDisplayPosition = () => AUSTIN_GROUND;
  viewer.trackedEntity = entity;
  elements.zoomInButton.click();
  elements.zoomInButton.click();
  advance(650);
  assertOrbit(readCameraTargetFrame(viewer), { range: 700 });
  elements.zoomOutButton.click();
  elements.zoomOutButton.click();
  advance(1300);
  assertOrbit(readCameraTargetFrame(viewer), { range: 1100 });
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 5;
  orbit(viewer, AUSTIN_GROUND, 215, OBLIQUE_PITCH, 180);
  elements.zoomInButton.click();
  elements.zoomInButton.click();
  advance(1950);
  assert.equal(viewer.trackedEntity, entity);
  assertOrbit(readCameraTargetFrame(viewer), { range: 150 });
});

test('tilt and north retain a zoom destination across navigation cancellation', (t) => {
  const { viewer, elements, advance } = bindRealZoomControls(t);
  elements.zoomInButton.click();
  advance(100);
  elements.tiltButton.click();
  elements.northButton.click();
  elements.zoomInButton.click();
  advance(750);
  assertOrbit(readCameraTargetFrame(viewer), {
    range: 2000,
    heading: 0,
    pitch: STRAIGHT_DOWN_PITCH,
  });
  assert.equal(elements.tiltLabel.textContent, '3D');
  assert.equal(
    elements.tiltButton.getAttribute('title'),
    'Tilt map to oblique view',
  );
});

test('the angle label and accessible action follow each commanded angle', (t) => {
  const { elements, advance } = bindRealZoomControls(t, {
    pitch: STRAIGHT_DOWN_PITCH,
  });
  assert.equal(elements.tiltLabel.textContent, '3D');
  assert.equal(
    elements.tiltButton.getAttribute('title'),
    elements.tiltButton.getAttribute('aria-label'),
  );
  elements.tiltButton.click();
  assert.equal(elements.tiltLabel.textContent, '2D');
  assert.equal(
    elements.tiltButton.getAttribute('title'),
    'Return map to straight-down view',
  );
  advance(650);
  elements.tiltButton.click();
  assert.equal(elements.tiltLabel.textContent, '3D');
});

for (const gesture of ['pointerdown', 'wheel']) {
  test(`${gesture} stops zoom animation and discards its requested range`, (t) => {
    const { viewer, elements, advance } = bindRealZoomControls(t);
    elements.zoomInButton.click();
    advance(325);
    const interrupted = readCameraTargetFrame(viewer);
    viewer.scene.canvas.dispatchEvent(new Event(gesture));
    assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
    advance(650);
    assertOrbit(readCameraTargetFrame(viewer), interrupted);
    elements.zoomOutButton.click();
    advance(1300);
    assertOrbit(readCameraTargetFrame(viewer), {
      ...interrupted,
      range: interrupted.range * 1.5,
    });
  });
}

for (const [label, altitude, range] of [
  ['aircraft', 10_000, 1500],
  ['satellite', 400_000, 1_500_000],
  ['high satellite', 35_786_000, 3_000_000],
]) {
  test(`${label}: range animation follows moving EntityView and preserves its reference frame`, (t) => {
    t.mock.method(
      Cesium.Transforms,
      'computeFixedToIcrfMatrix',
      () => undefined,
    );
    let target = Cesium.Cartesian3.fromDegrees(-97, 30, altitude);
    const { viewer, elements, advance } = bindRealZoomControls(t, {
      target,
      range,
      heading: 35,
    });
    viewer.clock = { currentTime: Cesium.JulianDate.now() };
    const entity = new Cesium.Entity({
      position: new Cesium.CallbackPositionProperty(() => target, false),
      trackingReferenceFrame: Cesium.TrackingReferenceFrame.ENU,
    });
    entity.gevDisplayPosition = () => target;
    viewer.trackedEntity = entity;
    const follow = new Cesium.EntityView(entity, viewer.scene);
    follow.update(viewer.clock.currentTime);
    viewer.camera.lookAt(
      target,
      new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(35),
        OBLIQUE_PITCH,
        range,
      ),
    );
    const before = readCameraTargetFrame(viewer);
    elements.zoomInButton.click();
    for (const step of [0, 100, 325, 500, 650]) {
      target = Cesium.Cartesian3.fromDegrees(
        -97 + step / 100_000,
        30,
        altitude,
      );
      follow.update(viewer.clock.currentTime);
      const transform = Cesium.Matrix4.clone(viewer.camera.transform);
      advance(step);
      assert.equal(viewer.trackedEntity, entity);
      assert.ok(
        Cesium.Matrix4.equalsEpsilon(viewer.camera.transform, transform, 1e-8),
      );
      assertOrbit(readCameraTargetFrame(viewer), {
        ...before,
        target,
        range: Cesium.Math.lerp(
          range,
          range / 1.5,
          Cesium.EasingFunction.CUBIC_IN_OUT(step / 650),
        ),
      });
    }
    target = Cesium.Cartesian3.fromDegrees(-96.9, 30.1, altitude);
    follow.update(viewer.clock.currentTime);
    assertOrbit(readCameraTargetFrame(viewer), {
      ...before,
      target,
      range: range / 1.5,
    });
    assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
  });
}

test('sky-facing free-view zoom remains usable when scene picking methods are absent', (t) => {
  const { viewer, elements, advance } = bindRealZoomControls(t);
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(0, 0, 10_000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(10), roll: 0 },
  });
  viewer.scene.globe.pick = undefined;
  viewer.scene.pickPosition = undefined;
  viewer.camera.pickEllipsoid = undefined;
  viewer.camera.getPickRay = undefined;
  assert.equal(readCameraTargetFrame(viewer), null);
  const position = Cesium.Cartesian3.clone(viewer.camera.positionWC);
  const direction = Cesium.Cartesian3.clone(viewer.camera.directionWC);
  const up = Cesium.Cartesian3.clone(viewer.camera.upWC);
  elements.zoomInButton.click();
  advance(325);
  const halfway = Cesium.Cartesian3.clone(viewer.camera.positionWC);
  assert.ok(
    Cesium.Cartesian3.distance(halfway, position) > 100,
    'fallback zoom visibly moves the camera',
  );
  elements.zoomOutButton.click();
  advance(975);
  assert.ok(
    Cesium.Cartesian3.distance(viewer.camera.positionWC, position) < 1e-5,
    'reversing the pending zoom returns to its initial position',
  );
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      viewer.camera.directionWC,
      direction,
      1e-10,
    ),
  );
  assert.ok(Cesium.Cartesian3.equalsEpsilon(viewer.camera.upWC, up, 1e-10));
  assert.equal(viewer.scene.preUpdate.numberOfListeners, 0);
});

test('zoom retains a rolled free camera orientation from its first animation frame', (t) => {
  const { viewer, elements, advance } = bindRealZoomControls(t);
  viewer.camera.twistRight(Cesium.Math.toRadians(30));
  const direction = Cesium.Cartesian3.clone(viewer.camera.directionWC);
  const up = Cesium.Cartesian3.clone(viewer.camera.upWC);
  elements.zoomInButton.click();
  for (const step of [0, 100, 325, 650]) {
    advance(step);
    assert.ok(
      Cesium.Cartesian3.equalsEpsilon(
        viewer.camera.directionWC,
        direction,
        1e-10,
      ),
      `direction changed at ${step}`,
    );
    assert.ok(
      Cesium.Cartesian3.equalsEpsilon(viewer.camera.upWC, up, 1e-10),
      `roll changed at ${step}`,
    );
  }
  assertOrbit(readCameraTargetFrame(viewer), { range: 3000 });
});

test('zoom retains tracked local direction and roll while EntityView moves', (t) => {
  t.mock.method(Cesium.Transforms, 'computeFixedToIcrfMatrix', () => undefined);
  let target = Cesium.Cartesian3.fromDegrees(-97, 30, 400_000);
  const { viewer, elements, advance } = bindRealZoomControls(t, {
    target,
    range: 1_500_000,
  });
  viewer.clock = { currentTime: Cesium.JulianDate.now() };
  const entity = new Cesium.Entity({
    position: new Cesium.CallbackPositionProperty(() => target, false),
    trackingReferenceFrame: Cesium.TrackingReferenceFrame.ENU,
  });
  entity.gevDisplayPosition = () => target;
  viewer.trackedEntity = entity;
  const follow = new Cesium.EntityView(entity, viewer.scene);
  follow.update(viewer.clock.currentTime);
  viewer.camera.lookAt(
    target,
    new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(215),
      OBLIQUE_PITCH,
      1_500_000,
    ),
  );
  viewer.camera.twistRight(Cesium.Math.toRadians(30));
  const direction = Cesium.Cartesian3.clone(viewer.camera.direction);
  const up = Cesium.Cartesian3.clone(viewer.camera.up);
  elements.zoomInButton.click();
  for (const step of [0, 100, 325, 650]) {
    target = Cesium.Cartesian3.fromDegrees(-97 + step / 10_000, 30, 400_000);
    follow.update(viewer.clock.currentTime);
    const transform = Cesium.Matrix4.clone(viewer.camera.transform);
    advance(step);
    assert.ok(
      Cesium.Matrix4.equalsEpsilon(viewer.camera.transform, transform, 1e-8),
    );
    assert.ok(
      Cesium.Cartesian3.equalsEpsilon(
        viewer.camera.direction,
        direction,
        1e-10,
      ),
      `tracked direction changed at ${step}`,
    );
    assert.ok(
      Cesium.Cartesian3.equalsEpsilon(viewer.camera.up, up, 1e-10),
      `tracked roll changed at ${step}`,
    );
  }
  assertOrbit(readCameraTargetFrame(viewer), { target, range: 1_000_000 });
});

test('free oblique zoom respects minimum ellipsoid height throughout easing', (t) => {
  const { viewer, elements, advance } = bindRealZoomControls(t, {
    range: 1500,
    minimum: 700,
  });
  elements.zoomInButton.click();
  elements.zoomInButton.click();
  for (const step of [0, 100, 325, 500, 650]) {
    advance(step);
    assert.ok(
      viewer.camera.positionCartographic.height >= 700 - 1e-5,
      `minimum height crossed at ${step}: ${viewer.camera.positionCartographic.height}`,
    );
  }
  assert.ok(
    readCameraTargetFrame(viewer).range > 700,
    'oblique clearance is not an orbit range',
  );
});

for (const source of ['terrain', 'rendered surface']) {
  test(`free zoom clears elevated ${source} through every animation frame`, (t) => {
    const target = Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 1600);
    const { viewer, elements, advance } = bindRealZoomControls(t, {
      target,
      range: 1500,
      minimum: 700,
    });
    const surface = source === 'terrain' ? 1700 : 1750;
    if (source === 'terrain') viewer.scene.globe.getHeight = () => surface;
    else viewer.scene.sampleHeight = () => surface;
    elements.zoomInButton.click();
    for (const step of [0, 100, 325, 500, 650]) {
      advance(step);
      assert.ok(
        viewer.camera.positionCartographic.height - surface >= 700 - 1e-5,
        `surface clearance crossed at ${step}: ${viewer.camera.positionCartographic.height - surface}`,
      );
    }
  });
}

test('free zoom uses maximum height without restricting an oblique orbit to that range', (t) => {
  const { viewer, elements, advance } = bindRealZoomControls(t, {
    range: 1800,
    maximum: 2000,
  });
  elements.zoomOutButton.click();
  for (const step of [0, 100, 325, 500, 650]) {
    advance(step);
    assert.ok(viewer.camera.positionCartographic.height <= 2000 + 1e-5);
  }
  assertOrbit(readCameraTargetFrame(viewer), { range: 2700 });
});

test('a free zoom-out near maximum height can decline without reversing into zoom-in', (t) => {
  const { viewer, elements, advance } = bindRealZoomControls(t, {
    range: 3000,
    maximum: 2000,
  });
  elements.zoomOutButton.click();
  for (const step of [0, 100, 325, 500, 650]) {
    advance(step);
    assert.ok(viewer.camera.positionCartographic.height <= 2000 + 1e-5);
    assert.ok(
      readCameraTargetFrame(viewer).range >= 3000 - 1e-5,
      'zoom-out must not move closer',
    );
  }
});

test('repeated sky-facing zoom-out cannot cross the ellipsoid when surface picks miss', (t) => {
  const { viewer, elements, advance } = bindRealZoomControls(t, {
    minimum: 700,
    maximum: Infinity,
  });
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(0, 0, 10_000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(10), roll: 0 },
  });
  viewer.scene.globe.pick = undefined;
  viewer.camera.pickEllipsoid = undefined;
  viewer.camera.getPickRay = undefined;
  for (let presses = 0; presses < 20; presses += 1)
    elements.zoomOutButton.click();
  for (const step of [0, 100, 325, 500, 650]) {
    advance(step);
    assert.ok(
      viewer.camera.positionCartographic.height >= 700 - 1e-5,
      `fallback crossed the ground at ${step}: ${viewer.camera.positionCartographic.height}`,
    );
  }
});

test('sky-facing zoom-in respects maximum height when moving along the sight line', (t) => {
  const { viewer, elements, advance } = bindRealZoomControls(t, {
    maximum: 10_050,
  });
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(0, 0, 10_000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(10), roll: 0 },
  });
  viewer.scene.globe.pick = undefined;
  viewer.camera.pickEllipsoid = undefined;
  viewer.camera.getPickRay = undefined;
  elements.zoomInButton.click();
  for (const step of [0, 325, 650]) {
    advance(step);
    assert.ok(
      viewer.camera.positionCartographic.height <= 10_050 + 1e-5,
      `fallback crossed the maximum height at ${step}: ${viewer.camera.positionCartographic.height}`,
    );
  }
});

test('free zoom samples rendered ground once per action and keeps animation frames cheap', (t) => {
  const { viewer, elements, advance } = bindRealZoomControls(t);
  let samples = 0;
  viewer.scene.sampleHeight = () => {
    samples += 1;
    return 0;
  };
  elements.zoomInButton.click();
  const actionSamples = samples;
  assert.ok(actionSamples > 0 && actionSamples <= 3);
  for (let step = 0; step <= 650; step += 25) advance(step);
  assert.equal(
    samples,
    actionSamples,
    'rendered-ground sampling must not run on each animation frame',
  );
  assertOrbit(readCameraTargetFrame(viewer), { range: 3000 });
  elements.zoomOutButton.click();
  assert.ok(
    samples > actionSamples && samples <= actionSamples + 3,
    'the next action measures its own floor',
  );
  advance(1300);
  assertOrbit(readCameraTargetFrame(viewer), { range: 4500 });
});

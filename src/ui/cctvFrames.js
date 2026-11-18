const frameClock = new Intl.DateTimeFormat(undefined, {
  timeStyle: 'medium',
  timeZone: 'UTC',
});

export function _clearCctvFrame() {
  this._cctvFrameRequestToken += 1;
  if (this._cctvFramePreloader) {
    this._cctvFramePreloader.onload = null;
    this._cctvFramePreloader.onerror = null;
  }
  this._cctvFramePreloader = null;
  if (this._cctvFrame) {
    this._cctvFrame.classList.remove('active');
    this._cctvFrame.removeAttribute('src');
    this._cctvFrame.hidden = true;
    this._cctvFrame.dataset.cameraId = '';
    this._cctvFrame.dataset.currentSrc = '';
    this._cctvFrame.dataset.loading = '';
    this._cctvFrame.dataset.error = '';
  }
  this._cctvFrameWrap?.classList.remove('loading', 'has-frame');
  if (this._cctvFrameTime) this._cctvFrameTime.hidden = true;
}

export function _queueCctvFrame(src, cameraId, cameraChanged) {
  if (this.destroyed || !this._cctvFrame || !src) return;

  if (cameraChanged) {
    // A different camera gets an honest acquisition state. Never retain
    // the prior camera's pixels under the newly selected metadata.
    this._cctvFrame.classList.remove('active');
    this._cctvFrame.removeAttribute('src');
    this._cctvFrame.hidden = true;
    this._cctvFrameWrap?.classList.remove('has-frame');
    if (this._cctvFrameTime) this._cctvFrameTime.hidden = true;
  }

  if (this._cctvFramePreloader) {
    this._cctvFramePreloader.onload = null;
    this._cctvFramePreloader.onerror = null;
  }
  const token = ++this._cctvFrameRequestToken;
  this._cctvFrame.dataset.cameraId = cameraId;
  this._cctvFrame.dataset.currentSrc = src;
  this._cctvFrame.dataset.loading = 'true';
  this._cctvFrame.dataset.error = '';
  this._cctvFrameWrap?.classList.toggle(
    'loading',
    !this._cctvFrameWrap?.classList.contains('has-frame'),
  );

  const preloader = new Image();
  this._cctvFramePreloader = preloader;
  preloader.onload = () => this._settleCctvFrame(token, src, true);
  preloader.onerror = () => this._settleCctvFrame(token, src, false);
  preloader.src = src;
}

export function _settleCctvFrame(token, src, ok) {
  if (
    this.destroyed ||
    !this._cctvFrame ||
    token !== this._cctvFrameRequestToken
  )
    return;
  if (this._cctvFramePreloader) {
    this._cctvFramePreloader.onload = null;
    this._cctvFramePreloader.onerror = null;
  }
  this._cctvFramePreloader = null;
  this._cctvFrame.dataset.loading = '';
  this._cctvFrameWrap?.classList.remove('loading');

  const syncBadge = () =>
    this._syncCctvSourceBadge(
      this._cctvState?.activeCamera,
      !!this._cctvState?.enabled && !!this.actions.isEnabled(),
    );

  if (!ok) {
    // Leave the element untouched — a settled frame stays on screen.
    this._cctvFrame.dataset.error = 'true';
    syncBadge();
    return;
  }

  this._cctvFrame.dataset.error = '';
  this._cctvFrame.src = src;
  this._cctvFrame.hidden = false;
  if (this._cctvFrameTime) {
    const loaded = new Date();
    const time = this._cctvFrameTime.querySelector('time');
    time.dateTime = loaded.toISOString();
    time.textContent = `${frameClock.format(loaded)} UTC`;
    this._cctvFrameTime.hidden = false;
  }
  this._cctvFrame.classList.add('active');
  this._cctvFrameWrap?.classList.add('has-frame');
  syncBadge();
}

function sentenceCase(value) {
  const label = String(value).replaceAll('-', ' ').toLowerCase();
  return label[0]?.toUpperCase() + label.slice(1);
}

export function _syncCctvSourceBadge(activeCamera, enabled) {
  const selected = enabled && activeCamera;
  if (this._cctvSourceBadge) {
    this._cctvSourceBadge.hidden = !selected;
    if (selected) {
      const kind = sentenceCase(
        activeCamera.sourceKind || activeCamera.feedType || 'unknown source',
      );
      const status = activeCamera.sourceStatus || 'unknown';
      this._cctvSourceBadge.textContent = `${kind} · ${status === 'ok' ? 'OK' : sentenceCase(status)}`;
    }
  }

  const status = this._cctvFrameStatus;
  if (!status) return;
  const hasFrame = this._cctvFrameWrap?.classList.contains('has-frame');
  const frame = this._cctvFrame?.dataset;
  let text = '';
  let state = 'idle';
  if (!enabled) text = 'Cameras are off';
  else if (!selected) {
    const count = this._cctvState?.cameras?.length;
    if (count) {
      text = `${count} ${count === 1 ? 'camera' : 'cameras'} loaded · Select a camera to preview`;
    } else if (this._cctvState?.loading?.active) {
      text = 'Loading cameras…';
      state = 'loading';
    } else if (this._cctvState?.error) {
      text = 'Camera catalog unavailable';
      state = 'error';
    } else text = 'No cameras available';
  } else if (activeCamera.isVideo) {
    if (this._cctvVideoState === 'unavailable') {
      text = 'Video unavailable';
      state = 'error';
    } else if (this._cctvVideoState !== 'ready') {
      text = 'Waiting for video…';
      state = 'loading';
    }
  } else {
    if (frame?.error === 'true') {
      text = hasFrame ? 'Frame refresh failed' : 'Frame unavailable';
      state = 'error';
    } else if (!hasFrame && frame?.loading === 'true') {
      text = 'Loading frame…';
      state = 'loading';
    } else if (!hasFrame) {
      text = 'Frame unavailable';
      state = 'error';
    }
  }
  if (status.textContent !== text) status.textContent = text;
  status.hidden = !text;
  status.dataset.frameState = state;
}

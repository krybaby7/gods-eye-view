import { createCctvVideoSurface } from './cctvVideo.js';
export function _calBadgeLabel(badge) {
  switch (badge) {
    case 'calibrated':
      return 'Calibrated';
    case 'curated':
      return 'Curated';
    case 'raw-prior':
      return 'Raw prior';
    default:
      return '';
  }
}

export function _renderCctvState(state) {
  if (this.destroyed) return;
  if (
    !state?.enabled ||
    !this.actions.isEnabled() ||
    state?.activeCameraId !== this._cctvState?.activeCameraId
  ) {
    this._calibrationEdit?.(false);
  }
  this._cctvState = state || null;
  const cameras = state?.cameras || [];
  const enabled = !!state?.enabled && !!this.actions.isEnabled();
  const activeId = state?.activeCameraId || '';
  const activeCamera = state?.activeCamera || null;

  // Auto-expand the panel when the active camera CHANGES to a new non-null
  // id while the layer is enabled. Covers click-on-globe, panel controls,
  // and voice (selectCamera/cycleCamera/focusNearest all notify through
  // this subscription). The last-seen guard keeps routine notifications
  // from re-expanding a panel the user deliberately collapsed, and timed
  // auto-hop transitions only expand on the first activation so the panel
  // does not pop open on every hop.
  const effectiveActiveId = enabled ? activeId || null : null;
  const isFirstActivation = this._lastSeenCctvActiveId === null;
  if (
    effectiveActiveId &&
    effectiveActiveId !== this._lastSeenCctvActiveId &&
    (!state?.autoHop || isFirstActivation)
  ) {
    this.actions.setPanelCollapsed('cctv-panel', false, {
      explicit: Boolean(state?.explicitSelection),
    });
  }
  this._lastSeenCctvActiveId = effectiveActiveId;

  this._updateCctvSyncChip(state?.loading, enabled);

  if (this._cctvEnableBtn) {
    this._cctvEnableBtn.classList.toggle('active', enabled);
    this._cctvEnableBtn.textContent = enabled ? 'Cameras on' : 'Cameras off';
  }

  if (this._cctvSelect) {
    const shouldRebuild =
      this._cctvSelect.options.length !== cameras.length ||
      cameras.some(
        (cam, idx) => this._cctvSelect.options[idx]?.value !== cam.id,
      );
    if (shouldRebuild) {
      this._cctvSelect.innerHTML = '';
      for (const camera of cameras) {
        const option = document.createElement('option');
        option.value = camera.id;
        option.textContent = `${camera.city} · ${camera.name}`;
        this._cctvSelect.appendChild(option);
      }
    }
    this._cctvSelect.disabled = !enabled || cameras.length === 0;
    if (
      activeId &&
      Array.from(this._cctvSelect.options).some((opt) => opt.value === activeId)
    ) {
      this._cctvSelect.value = activeId;
    } else if (!activeId) {
      this._cctvSelect.selectedIndex = -1;
    }
  }

  for (const btn of [
    this._cctvNearestBtn,
    this._cctvPrevBtn,
    this._cctvNextBtn,
  ]) {
    if (!btn) continue;
    btn.disabled = !enabled || cameras.length === 0;
  }
  if (this._cctvFocusBtn) {
    this._cctvFocusBtn.disabled = !enabled || cameras.length === 0 || !activeId;
  }

  if (this._cctvCoverageBtn) {
    // Tri-state (viewshed design §3b): off → on (wireframes) → viewshed
    // (color-coded volumes). The click handler cycles; this renders.
    const mode = state?.coverageMode || (state?.showCoverage ? 'on' : 'off');
    this._cctvCoverageBtn.classList.toggle('active', mode !== 'off');
    this._cctvCoverageBtn.textContent =
      mode === 'viewshed'
        ? 'Viewshed on'
        : mode === 'on'
          ? 'Coverage on'
          : 'Coverage off';
    this._cctvCoverageBtn.disabled = !enabled;
  }

  if (this._cctvAutoHopBtn) {
    const autoHop = !!state?.autoHop;
    this._cctvAutoHopBtn.classList.toggle('active', autoHop);
    this._cctvAutoHopBtn.textContent = autoHop ? 'Auto hop on' : 'Auto hop off';
    this._cctvAutoHopBtn.disabled = !enabled;
  }

  if (this._cctvProjectionBtn) {
    const showProjection = state?.showProjection !== false;
    this._cctvProjectionBtn.classList.toggle('active', showProjection);
    this._cctvProjectionBtn.textContent = showProjection
      ? 'Projection on'
      : 'Projection off';
    this._cctvProjectionBtn.disabled = !enabled;
  }

  if (this._cctvQualityChip) {
    const badge = activeCamera?.calBadge || null;
    const dirty = !!activeCamera?.calDirty;
    this._cctvQualityChip.textContent = dirty
      ? 'Edited (unsaved)'
      : this._calBadgeLabel(badge);
    this._cctvQualityChip.hidden =
      !enabled || !this._cctvQualityChip.textContent;
    this._cctvQualityChip.dataset.calBadge = dirty ? 'edited' : badge || '';
  }

  this._syncCctvCalReadout(enabled, activeCamera);

  if (this._cctvMeta) {
    const parts =
      enabled && activeCamera
        ? [
            activeCamera.sourceLabel || activeCamera.provider,
            activeCamera.credit,
            activeCamera.sourceMessage,
          ].filter(Boolean)
        : [];
    this._cctvMeta.textContent = [...new Set(parts)].join(' · ');
    this._cctvMeta.hidden = parts.length === 0;
  }

  const liveIntent = enabled && !!activeCamera?.isVideo;
  if (this._cctvVideo) {
    this._cctvVideo.hidden = !liveIntent;
    const visible =
      liveIntent &&
      !document.hidden &&
      !this._cctvPanel?.classList.contains('collapsed');
    if (!visible || this._cctvVideoCameraId !== activeId) {
      this._cctvVideoSurface?.stop();
      this._cctvVideoSurface = null;
      this._cctvVideoState = 'waiting';
    }
    this._cctvVideoCameraId = activeId;
    if (visible && !this._cctvVideoSurface) {
      this._cctvVideoSurface = createCctvVideoSurface(
        this._cctvVideo,
        () => this.cctv.getActiveVideoElement?.(),
        {
          onStateChange: (videoState) => {
            this._cctvVideoState = videoState;
            this._syncCctvSourceBadge(this._cctvState?.activeCamera, true);
          },
        },
      );
    }
  }

  if (this._cctvFrame && !liveIntent) {
    const nextSrc = enabled ? activeCamera?.frameUrl : null;
    const nextCameraId = enabled ? activeCamera?.id || '' : '';
    const cameraChanged = this._cctvFrame.dataset.cameraId !== nextCameraId;
    const frameLoading = this._cctvFrame.dataset.loading === 'true';
    // A same-camera refresh waits for the current image to settle. Replacing
    // src every 10 seconds can cancel a slow but healthy decode forever and
    // leave SNAPSHOT · OK beside a blank/loading preview. Camera changes are
    // immediate so navigation never waits on the prior camera's request.
    if (
      nextSrc &&
      (cameraChanged ||
        (!frameLoading && this._cctvFrame.dataset.currentSrc !== nextSrc))
    ) {
      this._queueCctvFrame(nextSrc, nextCameraId, cameraChanged);
    }
    if (!nextSrc) {
      this._clearCctvFrame();
    }
  } else if (liveIntent) {
    this._clearCctvFrame();
  }

  this._syncCctvSourceBadge(activeCamera, enabled);
  if (this._cctvSummary) {
    this._cctvSummary.textContent =
      enabled && activeCamera
        ? state?.summary || 'No summary available.'
        : 'No camera selected.';
  }
}

export function _updateCctvSyncChip(loading, enabled) {
  if (this.destroyed) return;
  if (!this._cctvSyncChip || !this._cctvSyncLabel || !this._cctvSyncProgress)
    return;
  const total = Number(loading?.total) || 0;
  const loaded = Math.max(0, Math.min(Number(loading?.loaded) || 0, total));
  const busy = !!enabled && !!loading?.active && total > 0;

  if (busy) {
    clearTimeout(this._cctvChipHideTimer);
    this._cctvChipHideTimer = null;
    this._cctvChipWasBusy = true;
    this._cctvSyncLabel.textContent = 'loading frames';
    this._cctvSyncProgress.textContent = `${loaded}/${total}`;
    this._cctvSyncChip.classList.add('visible');
    return;
  }

  if (this._cctvChipWasBusy && enabled && total > 0) {
    // Load just completed — flash the final count, then auto-hide.
    this._cctvChipWasBusy = false;
    this._cctvSyncLabel.textContent = 'camera grid ready';
    this._cctvSyncProgress.textContent = `${total}/${total}`;
    this._cctvSyncChip.classList.add('visible');
    clearTimeout(this._cctvChipHideTimer);
    this._cctvChipHideTimer = window.setTimeout(() => {
      if (this.destroyed) return;
      this._cctvChipHideTimer = null;
      this._cctvSyncChip.classList.remove('visible');
    }, 1500);
    return;
  }

  if (!this._cctvChipHideTimer) {
    this._cctvChipWasBusy = false;
    this._cctvSyncChip.classList.remove('visible');
  }
}

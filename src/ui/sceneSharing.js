/** Small owned modal for scene authoring and import review; text never becomes markup. */
export function createSceneDialog(title, onClose) {
  const dialog = document.createElement('dialog');
  dialog.dataset.directorDialog = '';
  dialog.className = 'director-sharing-dialog kit-panel';
  dialog.setAttribute('aria-label', title);
  const heading = document.createElement('h2');
  heading.textContent = title;
  heading.className = 'kit-panel-title';
  dialog.append(heading);
  const body = document.createElement('div'),
    footer = document.createElement('div'),
    status = document.createElement('p');
  status.setAttribute('role', 'status');
  body.className = 'kit-panel-body';
  status.className = 'kit-note';
  footer.className = 'director-sharing-actions';
  dialog.append(body, status, footer);
  const listeners = [];
  function listen(node, type, fn) {
    node.addEventListener(type, fn);
    listeners.push(() => node.removeEventListener(type, fn));
  }
  function text(value, parent = body) {
    const p = document.createElement('p');
    p.textContent = value;
    p.style.margin = '8px 0';
    parent.append(p);
    return p;
  }
  function button(label, fn, parent = footer) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.className = 'kit-btn';
    listen(b, 'click', fn);
    parent.append(b);
    return b;
  }
  function input(label, value, { type = 'text', multiline = false } = {}) {
    const wrapper = document.createElement('label');
    wrapper.className = 'director-sharing-field';
    wrapper.textContent = label;
    const node = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) node.type = type;
    node.value = value;
    node.setAttribute('aria-label', label);

    if (multiline) node.rows = 9;
    wrapper.append(node);
    body.append(wrapper);
    return node;
  }
  button('Cancel', onClose);
  listen(dialog, 'cancel', (event) => {
    event.preventDefault();
    onClose();
  });
  document.body.append(dialog);
  dialog.showModal();
  return {
    body,
    footer,
    status,
    text,
    button,
    input,
    listen,
    element: dialog,
    dispose() {
      for (const remove of listeners.splice(0)) remove();
      dialog.close();
      dialog.remove();
    },
  };
}

/** Add controls only when their owner is present; dispose removes every listener and element. */
export function mountSceneSharing(
  { edit, share },
  panel = document.getElementById('scene-panel'),
) {
  if (!panel) return () => {};
  const bar = document.createElement('div');
  bar.dataset.directorAuthoring = '';
  bar.className = 'scene-controls';
  const entries = [
    ['Edit details', edit],
    ['Share scene', share],
  ];
  const removers = [];
  for (const [text, fn] of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.className = 'kit-btn scene-btn';
    b.addEventListener('click', fn);
    removers.push(() => b.removeEventListener('click', fn));
    bar.append(b);
  }
  (panel.querySelector?.('.scene-panel-inner') || panel).appendChild(bar);
  return () => {
    for (const remove of removers) remove();
    bar.remove();
  };
}

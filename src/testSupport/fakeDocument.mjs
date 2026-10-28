/**
 * A small DOM for panel tests: elements, text nodes, attributes, classes,
 * events and simple selectors ([attr="value"], .class, tag). Only what the
 * Situation panel uses; not a browser.
 */

class FakeNode {
  constructor(document) {
    this.ownerDocument = document;
    this.parentNode = null;
  }

  get nextSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? (siblings[siblings.indexOf(this) + 1] ?? null) : null;
  }

  remove() {
    const siblings = this.parentNode?.childNodes;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }
}

class FakeText extends FakeNode {
  constructor(document, text) {
    super(document);
    this.nodeType = 3;
    this.data = String(text);
  }

  get textContent() {
    return this.data;
  }
}

const REFLECTED = ['hidden', 'disabled'];

export class FakeElement extends FakeNode {
  constructor(document, tagName) {
    super(document);
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.childNodes = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.style = {};
    this._value = '';
    for (const name of REFLECTED)
      Object.defineProperty(this, name, {
        get: () => this.attributes.has(name),
        set: (on) => {
          if (on) this.attributes.set(name, '');
          else this.attributes.delete(name);
        },
      });
    this.classList = {
      add: (...names) => names.forEach((name) => this.#classes().add(name)),
      remove: (...names) =>
        names.forEach((name) => this.#classes().delete(name)),
      contains: (name) => this.#classes().has(name),
      toggle: (name, force) => {
        const on = force ?? !this.#classes().has(name);
        if (on) this.classList.add(name);
        else this.classList.remove(name);
        return on;
      },
    };
  }

  #classes() {
    const classes = new Set(
      (this.attributes.get('class') || '').split(/\s+/).filter(Boolean),
    );
    const store = {
      add: (name) => {
        classes.add(name);
        this.attributes.set('class', [...classes].join(' '));
      },
      delete: (name) => {
        classes.delete(name);
        this.attributes.set('class', [...classes].join(' '));
      },
      has: (name) => classes.has(name),
    };
    return store;
  }

  get className() {
    return this.attributes.get('class') || '';
  }

  set className(value) {
    this.attributes.set('class', String(value));
  }

  get id() {
    return this.attributes.get('id') || '';
  }

  get title() {
    return this.attributes.get('title') || '';
  }

  set title(value) {
    this.attributes.set('title', String(value));
  }

  get value() {
    return this.tagName === 'OPTION'
      ? (this.attributes.get('value') ?? this.textContent)
      : this._value;
  }

  set value(next) {
    this._value = String(next);
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join('');
  }

  set textContent(text) {
    this.replaceChildren(String(text ?? ''));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  #adopt(node) {
    const child =
      typeof node === 'string' ? new FakeText(this.ownerDocument, node) : node;
    child.parentNode?.childNodes &&
      child.parentNode.childNodes.splice(
        child.parentNode.childNodes.indexOf(child),
        1,
      );
    child.parentNode = this;
    return child;
  }

  append(...nodes) {
    for (const node of nodes) this.childNodes.push(this.#adopt(node));
  }

  replaceChildren(...nodes) {
    for (const node of this.childNodes) node.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }

  insertBefore(node, reference) {
    const child = this.#adopt(node);
    const at = reference ? this.childNodes.indexOf(reference) : -1;
    if (at < 0) this.childNodes.push(child);
    else this.childNodes.splice(at, 0, child);
    return child;
  }

  contains(node) {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) || [])
      listener(event);
    return true;
  }

  /** A user click: disabled controls ignore it, as in a browser. */
  click() {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', preventDefault() {} });
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  scrollIntoView() {}

  /** Every element below this one, depth first. */
  *descendants() {
    for (const node of this.childNodes)
      if (node.nodeType === 1) {
        yield node;
        yield* node.descendants();
      }
  }

  matches(selector) {
    const attribute = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector);
    if (attribute) return this.getAttribute(attribute[1]) === attribute[2];
    const [tag, ...classes] = selector.split('.');
    return (
      (!tag || this.tagName === tag.toUpperCase()) &&
      classes.every((name) => this.classList.contains(name))
    );
  }

  querySelectorAll(selector) {
    return [...this.descendants()].filter((node) => node.matches(selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

/** A document with a body, getElementById and document-level events. */
export function createFakeDocument() {
  const listeners = new Map();
  const document = {
    activeElement: null,
    visibilityState: 'visible',
    createElement: (tag) => new FakeElement(document, tag),
    createTextNode: (text) => new FakeText(document, text),
    getElementById: (id) =>
      [...document.body.descendants()].find((node) => node.id === id) ?? null,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
  };
  document.body = new FakeElement(document, 'body');
  return document;
}

/** A Storage double backed by a Map. */
export function createFakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    entries: () => Object.fromEntries(map),
  };
}

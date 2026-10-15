'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const scope = 'https://forja.example/';

function serviceWorkerHarness() {
  const handlers = new Map(), stores = new Map(), notifications = [], opened = [];
  const keyFor = (request) => typeof request === 'string' ? new URL(request, scope).href : request.url;
  const cache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const values = stores.get(name);
    return {
      async addAll(urls) { for (const url of urls) values.set(new URL(url, scope).href, new Response(`cached:${url}`)); },
      async match(request) { const found = values.get(keyFor(request)); return found?.clone(); },
      async put(request, response) { values.set(keyFor(request), response.clone()); },
      async keys() { return [...values.keys()].map((url) => ({ url })); },
      async delete(request) { return values.delete(keyFor(request)); }
    };
  };
  const caches = {
    open: async (name) => cache(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    async match(request) {
      for (const values of stores.values()) {
        const found = values.get(keyFor(request));
        if (found) return found.clone();
      }
      return undefined;
    }
  };
  const self = {
    location: new URL(scope),
    registration: { scope, showNotification: async (title, options) => notifications.push({ title, options }) },
    clients: { matchAll: async () => [], openWindow: async (url) => opened.push(url), claim: async () => { self.clientsClaimed = true; } },
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: async () => {},
    clientsClaimed: false
  };
  const context = {
    self, caches, Response, URL, Date, Promise, Map, Set, Math,
    fetch: async () => { throw new Error('offline'); },
    console
  };
  vm.runInNewContext(source, context, { filename: 'sw.js' });
  async function dispatch(name, event = {}) {
    const pending = [];
    const handler = handlers.get(name);
    if (!handler) throw new Error(`Missing ${name} handler`);
    handler({ ...event, waitUntil: (promise) => pending.push(Promise.resolve(promise)) });
    await Promise.all(pending);
    return event.responsePromise;
  }
  async function fetchRequest(url, mode = 'same-origin') {
    let responsePromise;
    handlers.get('fetch')({ request: { url: new URL(url, scope).href, method: 'GET', mode }, respondWith: (promise) => { responsePromise = Promise.resolve(promise); } });
    return responsePromise;
  }
  return { handlers, stores, cache, caches, self, notifications, opened, dispatch, fetchRequest, setFetch(fn) { context.fetch = fn; } };
}

test('service worker precaches the complete shell and purges stale shell generations', async () => {
  const sw = serviceWorkerHarness();
  sw.stores.set('forja-shell-old', new Map());
  sw.stores.set('forja-media-old', new Map());
  sw.stores.set('forja-media-v2', new Map());
  sw.stores.set('other-app-cache', new Map());
  await sw.dispatch('install');
  assert.ok(sw.stores.has('forja-shell-v25'));
  assert.equal(sw.stores.get('forja-shell-v25').size, 12);
  await sw.dispatch('activate');
  assert.equal(sw.stores.has('forja-shell-old'), false);
  assert.equal(sw.stores.has('forja-media-old'), false);
  assert.equal(sw.stores.has('forja-media-v2'), true);
  assert.equal(sw.stores.has('other-app-cache'), true);
});

test('offline navigation and cached shell resources remain available without the network', async () => {
  const sw = serviceWorkerHarness();
  await sw.dispatch('install');
  const page = await sw.fetchRequest('/ruta-que-no-existe', 'navigate');
  const manifest = await sw.fetchRequest('/manifest.json');
  assert.match(await page.text(), /cached:\.\/index\.html/);
  assert.match(await manifest.text(), /cached:\.\/manifest\.json/);
});

test('saved exercise media wins offline and missing media returns a useful placeholder', async () => {
  const sw = serviceWorkerHarness();
  await sw.cache('forja-media-v2').put(`${scope}exercise-assets/images/saved.jpg`, new Response('saved-offline'));
  const saved = await sw.fetchRequest('/exercise-assets/images/saved.jpg');
  const missing = await sw.fetchRequest('/exercise-assets/images/missing.jpg');
  assert.equal(await saved.text(), 'saved-offline');
  assert.match(missing.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await missing.text(), /Conéctate para cargar esta imagen/);
});

test('automatic exercise media cache stays within the configured 180-entry limit', async () => {
  const sw = serviceWorkerHarness();
  sw.setFetch(async (request) => new Response(`online:${request.url}`));
  for (let index = 0; index < 181; index++) await sw.fetchRequest(`/exercise-assets/images/${index}.jpg`);
  assert.equal(sw.stores.get('forja-media-v3').size, 180);
  assert.equal(sw.stores.get('forja-media-v3').has(`${scope}exercise-assets/images/0.jpg`), false);
  assert.equal(sw.stores.get('forja-media-v3').has(`${scope}exercise-assets/images/180.jpg`), true);
});

test('push notifications show the server payload with a safe default title', async () => {
  const sw = serviceWorkerHarness();
  await sw.dispatch('push', { data: { json: () => ({ title: 'Aviso de prueba', body: 'Prueba local', url: './progreso' }) } });
  assert.equal(sw.notifications.length, 1);
  assert.equal(sw.notifications[0].title, 'Aviso de prueba');
  assert.equal(sw.notifications[0].options.body, 'Prueba local');
  assert.equal(sw.notifications[0].options.data.url, './progreso');
});

import worker from './worker/index.js';
import assets from './assets.js';

const embeddedAssets = {
  fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, {status: 405, headers: {Allow: 'GET, HEAD'}});
    }
    const {pathname} = new URL(request.url);
    const key = pathname === '/' ? '/index.html' : pathname;
    if (!Object.hasOwn(assets, key)) return new Response('Not found', {status: 404});
    const {type, body} = assets[key];
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: {'Content-Type': type, 'X-Content-Type-Options': 'nosniff'},
    });
  },
};

export default {
  fetch(request, env, context) {
    return worker.fetch(request, {...env, ASSETS: embeddedAssets}, context);
  },
};

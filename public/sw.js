/* The service worker exists for one reason: to catch the multipart POST that a
 * Web Share Target delivers. It does not cache anything -- a stale cache would
 * be far more trouble than offline support is worth at this stage. */
importScripts('/outbox.js');

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share-target') return;

  event.respondWith(
    (async function () {
      try {
        var form = await event.request.formData();
        var stored = 0;

        // Field names in the manifest are a request, not a guarantee -- some
        // platforms rename or merge them, so take every file-shaped entry.
        for (var entry of form.entries()) {
          var value = entry[1];
          var isFile = value && typeof value === 'object' && 'size' in value && 'type' in value;
          if (!isFile || value.size === 0) continue;
          await self.Outbox.add({
            blob: value,
            name: value.name || 'shared-image',
            type: value.type || '',
            size: value.size,
            receivedAt: Date.now()
          });
          stored++;
        }
        return Response.redirect('/?shared=' + stored, 303);
      } catch (err) {
        return Response.redirect('/?share=failed', 303);
      }
    })()
  );
});

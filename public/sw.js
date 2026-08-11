self.addEventListener('push', function (event) {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Nilli Studio', body: event.data.text() }
  }

  const title = payload.title || 'Nilli Studio'
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'nilli-notification',
    renotify: true,
    data: { url: payload.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  var url = event.notification.data && event.notification.data.url || '/'
  // Safety: only ever navigate to same-origin paths. If a payload ever
  // contains an external URL, fall back to the app root instead of opening
  // a potentially malicious site from a trusted-looking notification.
  try {
    var parsed = new URL(url, self.location.origin)
    url = parsed.origin === self.location.origin ? parsed.pathname + parsed.search + parsed.hash : '/'
  } catch (e) {
    url = '/'
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})

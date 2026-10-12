// Membership records and API responses are never stored in Cache Storage.
const offlinePage = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>千丝万缕 · 连接中断</title><body style="margin:0;background:#ffffff;color:#111111;font-family:system-ui;padding:64px 28px"><h1>连接云端后继续</h1><p style="line-height:1.8">目前没有网络，暂时无法读取会员信息或划卡记账。请恢复网络后重新打开。</p><button onclick="location.reload()" style="background:#111111;color:white;border:0;border-radius:12px;padding:14px 24px;font-size:16px">重新连接</button></body></html>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate' && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(fetch(event.request).catch(() => new Response(offlinePage, {status:503, headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
  }
});


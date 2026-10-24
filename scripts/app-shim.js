/* ===== Part 1: runs before the app. Pairing, networking and deep links. ===== */
(function () {
	'use strict';
	var KEY = 'neb_site';
	function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; } }
	var saved = load();
	window.NEBAPP = {
		site: saved.site || '', api: saved.api || '', name: saved.name || '',
		save: function (o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} },
		clear: function () { try { localStorage.removeItem(KEY); localStorage.removeItem('neb_token'); } catch (e) {} }
	};

	/* All network calls go through the phone's native code, so the site needs no CORS settings. */
	var pending = {}, seq = 0, realFetch = window.fetch;
	window.__nebHttp = function (id, status, body) {
		var p = pending[id]; if (!p) { return; } delete pending[id];
		if (status <= 0) { p.rej(new TypeError(body || 'Network error')); return; }
		var empty = status === 204 || status === 205 || status === 304;
		p.res(new Response(empty ? null : body, { status: status, headers: { 'Content-Type': 'application/json' } }));
	};
	window.fetch = function (url, opts) {
		url = String(url);
		if (!window.NebNative || !/^https:\/\//i.test(url)) { return realFetch.apply(window, arguments); }
		opts = opts || {};
		return new Promise(function (res, rej) {
			var id = String(++seq); pending[id] = { res: res, rej: rej };
			NebNative.http(id, opts.method || 'GET', url, JSON.stringify(opts.headers || {}), opts.body == null ? '' : String(opts.body));
		});
	};

	/* Turns what a person types or scans into a site address. */
	window.nebNormalizeSite = function (v) {
		v = String(v || '').trim();
		var m = v.match(/[?&]site=([^&]+)/);
		if (/^nebbadges:/i.test(v) && m) { v = decodeURIComponent(m[1]); }
		if (!v) { return ''; }
		if (!/^[a-z]+:\/\//i.test(v)) { v = 'https://' + v; }
		return v.replace(/[?#].*$/, '').replace(/\/(badge-host|wp-json|wp-admin)(\/.*)?$/i, '').replace(/\/+$/, '');
	};
	window.nebConnect = function (input) {
		var site = nebNormalizeSite(input);
		if (!/^https:\/\/.+\..+/i.test(site)) { return Promise.reject(new Error('Enter your site address, starting with https://')); }
		function ask(u) {
			return fetch(u).then(function (r) { return r.json().then(function (j) { if (!r.ok || j.plugin !== 'nfc-event-badges') { throw new Error('bad'); } return j; }); });
		}
		return ask(site + '/wp-json/neb/v1/app/info').catch(function () { return ask(site + '/?rest_route=/neb/v1/app/info'); }).then(function (j) {
			var o = { site: site, api: j.api, name: j.name || site };
			if (!/^https:\/\//i.test(o.api || '')) { throw new Error('This site is not using HTTPS.'); }
			NEBAPP.clear(); NEBAPP.save(o); NEBAPP.site = o.site; NEBAPP.api = o.api; NEBAPP.name = o.name;
			return o;
		}).catch(function (e) {
			throw new Error(e && /HTTPS/.test(e.message) ? e.message : 'Could not find the NFC Event Badges plugin at that address. Check the address and that the plugin is active.');
		});
	};
	window.__nebLink = function (link) {
		if (!link) { return; }
		var site = nebNormalizeSite(link);
		window.__nebPendingSite = site;
		if (window.__nebOnLink) { window.__nebOnLink(site); }
	};
	if (window.NebNative && NebNative.takeLink) { var first = NebNative.takeLink(); if (first) { window.__nebLink(first); } }
})();

/*@@APP_SCRIPT@@*/
/* ===== Part 2: replaces the browser NFC code inside the app ===== */
function startScan(mode, onRead, onFail) {
	if (!HAS_NFC) { onFail(new Error('NFC is not available on this phone (or switched off).')); return; }
	stopScan();
	window.__nebTagCb = function (uid) { buzz(30); onRead(uid); };
	NebNative.startScan();
	S.scanning = { abort: function () { NebNative.stopScan(); window.__nebTagCb = null; } };
	S.mode = mode;
}
function stopScan() { if (S.scanning) { S.scanning.abort(); S.scanning = null; S.mode = ''; } }

function connectView() {
	var pre = window.__nebPendingSite || '';
	return '<h1>🎟️ Badge Host</h1><p class="sub">Connect the app to your event site.</p>' +
		'<div class="card"><h2>Site address</h2><label>The address of the website that runs the badge plugin</label>' +
		'<input id="c-site" inputmode="url" autocapitalize="none" autocomplete="off" placeholder="https://example.com" value="' + esc(pre) + '">' +
		'<button data-act="connect">Connect</button><p class="sub" id="c-err" style="margin-top:10px"></p></div>' +
		'<p class="sub">Tip: on the website, open <strong>Event Badges → Connect app</strong> and scan the code with this phone\'s camera. It opens this app with the address filled in.</p>';
}
act.connect = function (b) {
	var v = $('c-site').value, e = $('c-err');
	if (b) { b.disabled = true; }
	e.textContent = 'Connecting…';
	nebConnect(v).then(function () { window.__nebPendingSite = ''; location.reload(); }).catch(function (er) { e.textContent = er.message; if (b) { b.disabled = false; } });
};
act.changeSite = function () {
	if (!confirm('Disconnect from ' + NEBAPP.name + '?')) { return; }
	stopScan(); NEBAPP.clear(); location.reload();
};
window.__nebOnLink = function (site) {
	if (NEBAPP.api && NEBAPP.site === site) { return; }
	if (NEBAPP.api && !confirm('Switch to ' + site + '?')) { return; }
	nebConnect(site).then(function () { location.reload(); }).catch(function (er) { toast(er.message); });
};
if (window.__nebPendingSite && !NEBAPP.api) { window.__nebOnLink(window.__nebPendingSite); }

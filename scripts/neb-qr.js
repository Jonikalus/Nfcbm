/* Minimal QR code generator (byte mode, error correction L, versions 1-10). window.nebQR(text) -> { size, get(x,y) } */
(function () {
	'use strict';
	var DATA = [0, 19, 34, 55, 80, 108, 136, 156, 194, 232, 274];
	var ECC = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
	var BLOCKS = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4];
	var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
	var EXP = [], LOG = [], i, x = 1;
	for (i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) { x ^= 0x11d; } }
	function mul(a, b) { return a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0; }
	function rs(data, n) {
		var gen = [1], j, k;
		for (j = 0; j < n; j++) {
			var next = new Array(gen.length + 1).fill(0);
			for (k = 0; k < gen.length; k++) { next[k] ^= gen[k]; next[k + 1] ^= mul(gen[k], EXP[j]); }
			gen = next;
		}
		var res = new Array(n).fill(0);
		data.forEach(function (d) {
			var f = d ^ res.shift(); res.push(0);
			for (var m = 0; m < n; m++) { res[m] ^= mul(gen[m + 1], f); }
		});
		return res;
	}
	function utf8(s) { return Array.prototype.slice.call(new TextEncoder().encode(s)); }
	function bch(value, poly, bits, top) {
		var v = value << bits;
		for (var b = top; b >= bits; b--) { if (v & (1 << b)) { v ^= poly << (b - bits); } }
		return v;
	}
	window.nebQR = function (text) {
		var bytes = utf8(text), ver = 0, v;
		for (v = 1; v <= 10; v++) { var cap = DATA[v] - (v < 10 ? 2 : 3); if (bytes.length <= cap) { ver = v; break; } }
		if (!ver) { throw new Error('Text too long for QR'); }
		var bits = [];
		function put(val, len) { for (var b = len - 1; b >= 0; b--) { bits.push((val >> b) & 1); } }
		put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
		bytes.forEach(function (b) { put(b, 8); });
		var total = DATA[ver] * 8;
		put(0, Math.min(4, total - bits.length));
		while (bits.length % 8) { bits.push(0); }
		var cw = [];
		for (i = 0; i < bits.length; i += 8) { var n = 0; for (var b = 0; b < 8; b++) { n = (n << 1) | bits[i + b]; } cw.push(n); }
		for (var pad = 0; cw.length < DATA[ver]; pad++) { cw.push(pad % 2 ? 0x11 : 0xec); }
		var nb = BLOCKS[ver], base = Math.floor(DATA[ver] / nb), extra = DATA[ver] % nb, blocks = [], ecs = [], pos = 0;
		for (i = 0; i < nb; i++) {
			var len = base + (i >= nb - extra ? 1 : 0), d = cw.slice(pos, pos + len); pos += len;
			blocks.push(d); ecs.push(rs(d, ECC[ver]));
		}
		var out = [], maxd = base + (extra ? 1 : 0), j;
		for (j = 0; j < maxd; j++) { blocks.forEach(function (bl) { if (j < bl.length) { out.push(bl[j]); } }); }
		for (j = 0; j < ECC[ver]; j++) { ecs.forEach(function (e) { out.push(e[j]); }); }
		var size = 17 + 4 * ver, M = [], R = [];
		for (i = 0; i < size; i++) { M.push(new Array(size).fill(0)); R.push(new Array(size).fill(false)); }
		function set(r, c, val) { if (r >= 0 && c >= 0 && r < size && c < size) { M[r][c] = val ? 1 : 0; R[r][c] = true; } }
		function finder(r, c) {
			for (var dr = -1; dr <= 7; dr++) { for (var dc = -1; dc <= 7; dc++) {
				var on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
				set(r + dr, c + dc, on);
			} }
		}
		finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
		var al = ALIGN[ver];
		al.forEach(function (r) { al.forEach(function (c) {
			if (R[r][c]) { return; }
			for (var dr = -2; dr <= 2; dr++) { for (var dc = -2; dc <= 2; dc++) { set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1); } }
		}); });
		for (i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
		set(size - 8, 8, 1);
		for (i = 0; i < 9; i++) { if (!R[8][i]) { set(8, i, 0); } if (!R[i][8]) { set(i, 8, 0); } }
		for (i = 0; i < 8; i++) { if (!R[8][size - 1 - i]) { set(8, size - 1 - i, 0); } if (!R[size - 1 - i][8]) { set(size - 1 - i, 8, 0); } }
		if (ver >= 7) {
			var vi = (ver << 12) | bch(ver, 0x1f25, 12, 17);
			for (i = 0; i < 18; i++) {
				var bit = (vi >> i) & 1, a = Math.floor(i / 3), bb = i % 3 + size - 11;
				set(a, bb, bit); set(bb, a, bit);
			}
		}
		/* data placement */
		var bitIdx = 0, up = true, col, row, dc2;
		var stream = [];
		out.forEach(function (byte) { for (var b = 7; b >= 0; b--) { stream.push((byte >> b) & 1); } });
		for (col = size - 1; col > 0; col -= 2) {
			if (col === 6) { col--; }
			for (i = 0; i < size; i++) {
				row = up ? size - 1 - i : i;
				for (dc2 = 0; dc2 < 2; dc2++) {
					var c = col - dc2;
					if (R[row][c]) { continue; }
					var bitv = bitIdx < stream.length ? stream[bitIdx++] : 0;
					if ((row + c) % 2 === 0) { bitv ^= 1; }
					M[row][c] = bitv;
				}
			}
			up = !up;
		}
		/* format info: EC level L (01), mask 0 */
		var fmt = (((1 << 3) | 0) << 10 | bch((1 << 3) | 0, 0x537, 10, 14)) ^ 0x5412;
		for (i = 0; i < 15; i++) {
			var fb = (fmt >> i) & 1;
			if (i < 6) { M[i][8] = fb; } else if (i < 8) { M[i + 1][8] = fb; } else { M[size - 15 + i][8] = fb; }
			if (i < 8) { M[8][size - 1 - i] = fb; } else if (i < 9) { M[8][15 - i] = fb; } else { M[8][14 - i] = fb; }
		}
		return { size: size, version: ver, get: function (r, c) { return !!M[r][c]; } };
	};
	window.nebQRSvg = function (text, px) {
		var q = window.nebQR(text), n = q.size + 8, d = '', r, c;
		for (r = 0; r < q.size; r++) { for (c = 0; c < q.size; c++) { if (q.get(r, c)) { d += 'M' + (c + 4) + ' ' + (r + 4) + 'h1v1h-1z'; } } }
		return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" width="' + (px || 240) + '" height="' + (px || 240) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
	};
})();

/* Keplr / Web3Auth incident tracker — live wallet watch via public LCDs. */
(function () {
  'use strict';
  var REFRESH_MS = 60000;
  var LS_KEY = 'kt-watchlist-v1';
  var data = null;
  var chains = {};

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function chainFor(addr) {
    if (/^osmo1/i.test(addr)) return chains.osmosis || chains.cosmos;
    if (/^inj1/i.test(addr)) return chains.injective || chains.cosmos;
    if (/^bbn1/i.test(addr)) return chains.babylon || chains.cosmos;
    return chains.cosmos;
  }
  function mintscanAddr(chain, addr) { return chain.explorer + '/address/' + addr; }
  function mintscanTx(chain, hash) { return chain.explorer + '/txs/' + hash; }

  function fmtAmount(amount, denom) {
    var n = Number(amount);
    if (!isFinite(n)) return esc(amount) + ' ' + esc(denom);
    if (denom === 'uatom') return trimNum(n / 1e6) + ' ATOM';
    if (denom === 'uosmo') return trimNum(n / 1e6) + ' OSMO';
    if (denom === 'inj') return trimNum(n / 1e18) + ' INJ';
    if (denom === 'uusdc' || denom === 'uusdt') return trimNum(n / 1e6) + ' ' + denom.slice(1).toUpperCase();
    if (denom.indexOf('ibc/') === 0) return n.toLocaleString('en-US') + ' IBC…' + denom.slice(4, 12);
    return n.toLocaleString('en-US') + ' ' + esc(denom);
  }
  function trimNum(x) {
    return x.toLocaleString('en-US', { maximumFractionDigits: 6 });
  }
  function shortTime(iso) {
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
  }

  /* ---------- static incident data ---------- */
  function renderStatic() {
    var inc = data.incident, t = inc.totals;
    el('statusBadge').textContent = inc.status;
    el('updatedLine').textContent = 'Last data update: ' + shortTime(inc.lastUpdated) + ' • live balances refresh every 60s';
    el('statCards').innerHTML =
      statCard(t.takenUsd, 'total taken — on-chain analysis, Nov 7') +
      statCard(t.walletsDrained, 'wallets drained') +
      statCard(String(t.chains.length), 'chains: ' + esc(t.chains.join(', '))) +
      statCard(t.cashedOutUsd, 'cashed out yet');
    el('takenNote').textContent = t.takenNote + ' ' + t.walletsNote + ' ' + t.cashedOutNote;
    el('controlList').innerHTML =
      kv('Cause', esc(inc.cause)) +
      kv('Attacker', '<span class="unknown">' + esc(inc.attacker) + '</span>') +
      kv('Affected', esc(inc.affected)) +
      kv('Safe', '<span class="safe">' + esc(inc.safe) + '</span>');
    el('flowNote').textContent = 'Flow as reported so far: victims (Google/Apple-login Keplr accounts) → 11 tracked attacker wallets → cash-out: $0 moved yet. When new attacker addresses are published, they appear on this map with live balances.';
    el('timeline').innerHTML = inc.timeline.map(function (ev) {
      return '<li><time>' + esc(ev.time) + '</time>' + esc(ev.event) + '</li>';
    }).join('');
    el('linkList').innerHTML = inc.links.map(function (l) {
      return '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a></li>';
    }).join('');
    el('footerNote').textContent = 'Sources: Keplr and Web3Auth official notices (Nov 6–7, 2026), Keplr co-founder Josh Lee, MBTrace, and community on-chain analysis (Nov 7). Totals and wallet counts are from the on-chain analysis. Live balances come from public chain APIs; if one fails, use the explorer link on each wallet card.';
    renderAttackers();
    renderSuspiciousTxs();
    renderFlowMap();
  }
  function statCard(num, lbl) {
    return '<div class="card"><div class="num">' + esc(num) + '</div><div class="lbl">' + esc(lbl) + '</div></div>';
  }
  function kv(k, v) { return '<dt>' + esc(k) + '</dt><dd>' + v + '</dd>'; }

  function renderSuspiciousTxs() {
    var list = (data.incident && data.incident.suspiciousTxs) || [];
    var panel = el('suspTxPanel');
    if (!panel || !list.length) return;
    panel.innerHTML = '<p style="font-size:14px;margin-bottom:12px">Drain transactions observed on-chain (Cosmos Hub block scan, Nov 7 15:35 UTC). The drain was still active at the last check.</p>' +
      list.map(function (t) {
        return '<div class="threat" style="border-color:rgba(56,189,248,.3);background:rgba(8,16,30,.6)">' +
          '<div class="meta"><span class="chain">' + esc(t.time || '') + '</span><span class="tag warn">HEIGHT ' + esc(String(t.height || '')) + '</span></div>' +
          '<div class="addr" style="color:#7dd3fc">' + esc(t.hash) + '</div>' +
          '<div class="note2">' + esc(t.label || '') + ' — <a href="https://www.mintscan.io/cosmos/tx/' + esc(t.hash) + '" target="_blank" rel="noopener">Mintscan</a></div></div>';
      }).join('');
  }

  function renderAttackers() {
    var list = data.attackerWallets || [];
    if (!list.length) {
      el('attackerPanel').innerHTML = '<p><span class="unknown">No verified attacker wallet addresses have been published yet.</span></p>' +
        '<p>That means no one can yet say exactly which wallets hold the stolen funds. The tracker watches for published addresses — when one is confirmed, it will be added here with a live balance and its in/out flows. ' +
        'Meanwhile, <a href="https://mbtrace.app" target="_blank" rel="noopener">mbtrace.app</a> traces the transaction trail from drained wallets.</p>' +
        '<p class="muted">Do not trust attacker addresses from random posts or DMs — only ones confirmed by Keplr, Web3Auth, or a reputable tracer.</p>';
      return;
    }
    el('attackerPanel').innerHTML = list.map(function (w) {
      var chain = (w.chain || '').toUpperCase();
      return '<div class="threat"><div class="meta"><span class="chain">' + esc(chain) + '</span><span class="tag live">● LIVE — TRACKED</span></div>' +
        '<div class="addr">' + esc(w.address) + '</div>' +
        (w.note ? '<div class="note2">' + esc(w.note) + '</div>' : '') + '</div>';
    }).join('') + '<p class="muted" style="font-size:12px">Reported on X. Treat any other address claiming to be the attacker as unverified until Keplr, Web3Auth, or a reputable tracer confirms it.</p>';
  }

  function renderFlowMap() {
    var t = data.incident.totals;
    el('flowmap').innerHTML =
      '<svg viewBox="0 0 720 300" role="img" aria-label="Money flow map">' +
      '<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#b8f135"/></marker>' +
      '<marker id="arrR" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#ff8a8a"/></marker></defs>' +
      '<style>.fl { stroke-dasharray: 6 6; animation: dash 1.2s linear infinite; } @keyframes dash { to { stroke-dashoffset: -12; } } ' +
      '.n { font: 700 15px sans-serif; fill: #e8e8e8; } .s { font: 12px sans-serif; fill: #9a9a9a; } .big { font: 800 22px sans-serif; fill: #b8f135; } .bad { font: 800 22px sans-serif; fill: #ff8a8a; }</style>' +
      node(20, 30, 190, 96, t.walletsDrained, 'wallets drained', '#b8f135') +
      node(265, 30, 190, 96, 'ATTACKER', '11 wallets tracked', '#ff8a8a') +
      node(510, 30, 190, 96, t.cashedOutUsd, 'cashed out yet', '#8a8a8a') +
      '<line x1="210" y1="78" x2="258" y2="78" stroke="#b8f135" stroke-width="3" class="fl" marker-end="url(#arr)"/>' +
      '<line x1="455" y1="78" x2="503" y2="78" stroke="#555" stroke-width="3" stroke-dasharray="3 6" marker-end="url(#arrR)"/>' +
      '<text x="235" y="66" class="s">Total lost: ' + esc(t.takenUsd) + '</text>' +
      '<text x="478" y="66" class="s">destination: drain wallets</text>' +
      '<text x="20" y="190" class="s">Chains: Cosmos Hub · Osmosis · Injective. Evmos also drained Nov 6.</text>' +
      '<text x="20" y="220" class="s">Money in: victims lost funds to the drain wallets.</text>' +
      '<text x="20" y="242" class="s">Money out: $0 moved — Circle can freeze ~$188K Noble USDC in the Osmosis drain wallet.</text>' +
      '<text x="20" y="264" class="s">Cause: Web3Auth security issue (social-login keys). Seed-phrase &amp; hardware wallets not affected.</text>' +
      '<text x="20" y="286" class="s">Attacker identity: under investigation. 11 wallets tracked live.</text>' +
      '</svg>';
    function node(x, y, w, h, big, small, color) {
      return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="14" fill="#111" stroke="' + color + '" stroke-width="1.5"/>' +
        '<text x="' + (x + 16) + '" y="' + (y + 42) + '" class="' + (color === '#ff8a8a' ? 'bad' : 'big') + '">' + esc(big) + '</text>' +
        '<text x="' + (x + 16) + '" y="' + (y + 68) + '" class="s">' + esc(small) + '</text>';
    }
    function chainChip(x, y, name) {
      return '<g><rect x="' + x + '" y="' + y + '" width="150" height="34" rx="17" fill="#111" stroke="#2a2a2a"/>' +
        '<text x="' + (x + 75) + '" y="' + (y + 22) + '" text-anchor="middle" class="n">' + esc(name) + '</text></g>';
    }
  }

  /* ---------- live wallet watch ---------- */
  function getWatchlist() {
    var base = (data.watchlist || []).slice();
    try {
      var extra = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      extra.forEach(function (w) {
        if (w && w.address && !base.some(function (b) { return b.address === w.address; })) base.push(w);
      });
    } catch (e) {}
    return base;
  }
  function saveExtra(w) {
    var extra = [];
    try { extra = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) {}
    if (!extra.some(function (x) { return x.address === w.address; })) extra.push(w);
    try { localStorage.setItem(LS_KEY, JSON.stringify(extra)); } catch (e) {}
  }
  function removeExtra(addr) {
    var extra = [];
    try { extra = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) {}
    extra = extra.filter(function (x) { return x.address !== addr; });
    try { localStorage.setItem(LS_KEY, JSON.stringify(extra)); } catch (e) {}
  }

  function fetchJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function loadWallet(w, box) {
    var chain = chainFor(w.address);
    var balP = fetchJson(chain.lcd + '/cosmos/bank/v1beta1/balances/' + w.address)
      .then(function (d) { return d.balances || []; })
      .catch(function () { return null; });
    var txP = Promise.all([
      fetchJson(chain.lcd + '/cosmos/tx/v1beta1/txs?events=message.sender%3D%27' + w.address + '%27&order_by=ORDER_BY_DESC&pagination.limit=5').catch(function () { return null; }),
      fetchJson(chain.lcd + '/cosmos/tx/v1beta1/txs?events=transfer.recipient%3D%27' + w.address + '%27&order_by=ORDER_BY_DESC&pagination.limit=5').catch(function () { return null; })
    ]).then(function (pair) {
      var out = [];
      pair.forEach(function (d, i) {
        if (!d || !d.tx_responses) return;
        d.tx_responses.forEach(function (r) {
          var hash = r.txhash;
          if (out.some(function (x) { return x.hash === hash; })) return;
          var dir = 'OUT';
          try {
            var logs = r.logs || [];
            var recips = [];
            logs.forEach(function (lg) { (lg.events || []).forEach(function (ev) { (ev.attributes || []).forEach(function (a) { if (a.key === 'recipient') recips.push(a.value); }); }); });
            if (recips.indexOf(w.address) !== -1) dir = 'IN';
          } catch (e) {}
          out.push({ hash: hash, time: r.timestamp, code: r.code, dir: dir });
        });
      });
      out.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });
      return out.slice(0, 8);
    });
    Promise.all([balP, txP]).then(function (res) {
      var bals = res[0], txs = res[1];
      var html = '<div class="bal">' + (bals === null ? '<small>Balance unavailable — the chain API did not answer. Use the explorer link below.</small>'
        : bals.length ? bals.map(function (b) { return fmtAmount(b.amount, b.denom); }).join(' &nbsp;•&nbsp; ')
        : '0 — no funds in this wallet right now') + '</div>';
      html += '<div class="muted" style="font-size:13px">Chain: ' + esc(chain.name) + ' • <a href="' + esc(mintscanAddr(chain, w.address)) + '" target="_blank" rel="noopener">Open in Mintscan</a></div>';
      if (txs && txs.length) {
        html += '<div class="txs"><table><tr><th>Direction</th><th>Time</th><th>Transaction</th></tr>' +
          txs.map(function (t) {
            return '<tr><td class="' + (t.dir === 'IN' ? 'in' : 'out') + '">' + t.dir + '</td><td>' + esc(shortTime(t.time)) + '</td>' +
              '<td><a class="mono" href="' + esc(mintscanTx(chain, t.hash)) + '" target="_blank" rel="noopener">' + esc(t.hash.slice(0, 16)) + '…</a>' +
              (t.code !== 0 ? ' <span class="out">failed</span>' : '') + '</td></tr>';
          }).join('') + '</table></div>';
      } else {
        html += '<div class="txs muted">No recent transactions returned by the chain API for this address. Balances above are still live — check the Mintscan link for the full history.</div>';
      }
      box.querySelector('.live').innerHTML = html;
    });
  }

  function renderWatchlist() {
    var list = getWatchlist();
    el('watchlist').innerHTML = list.map(function (w, i) {
      var removable = i >= (data.watchlist || []).length;
      return '<div class="wallet" data-addr="' + esc(w.address) + '"><h3>' + esc(w.label || w.address) + '</h3>' +
        '<div class="addr">' + esc(w.address) + '</div><div class="live"><span class="muted">Loading live data…</span></div>' +
        (removable ? '<p style="margin-top:10px"><button class="ghost" type="button" data-remove="' + esc(w.address) + '">Remove</button></p>' : '') +
        '</div>';
    }).join('');
    list.forEach(function (w) {
      var box = el('watchlist').querySelector('[data-addr="' + w.address + '"]');
      if (box) loadWallet(w, box);
    });
    el('watchlist').querySelectorAll('[data-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () { removeExtra(btn.getAttribute('data-remove')); renderWatchlist(); });
    });
  }

  function refreshAll() { renderWatchlist(); }

  /* ---------- boot ---------- */
  fetch('data.json').then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    (data.chains || []).forEach(function (c) { chains[c.id] = c; });
    renderStatic();
    renderWatchlist();
    setInterval(refreshAll, REFRESH_MS);
    el('refreshBtn').addEventListener('click', refreshAll);
    el('addForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var addr = el('addAddr').value.trim();
      var label = el('addLabel').value.trim();
      if (!/^(cosmos1|osmo1|inj1|bbn1)[a-z0-9]{20,}$/i.test(addr)) {
        el('addMsg').textContent = 'That does not look like a Cosmos, Osmosis, Injective or Babylon address. Paste the full address (starts with cosmos1, osmo1, inj1 or bbn1).';
        return;
      }
      saveExtra({ address: addr, label: label || addr, chain: chainFor(addr).id });
      el('addAddr').value = ''; el('addLabel').value = '';
      el('addMsg').textContent = 'Added — now tracking ' + addr;
      renderWatchlist();
    });
  }).catch(function () {
    el('statusBadge').textContent = 'DATA FAILED TO LOAD';
  });
})();

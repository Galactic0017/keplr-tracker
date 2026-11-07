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
    el('timeline').innerHTML = inc.timeline.map(function (ev) {
      return '<li><time>' + esc(ev.time) + '</time>' + esc(ev.event) + '</li>';
    }).join('');
    el('linkList').innerHTML = inc.links.map(function (l) {
      return '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a></li>';
    }).join('');
    el('footerNote').textContent = 'Sources: Keplr and Web3Auth official notices (Nov 6–7, 2026), Keplr co-founder Josh Lee, MBTrace, and community on-chain analysis (Nov 7). Totals and wallet counts are from the on-chain analysis. Live balances come from public chain APIs; if one fails, use the explorer link on each wallet card.';
    renderAttackers();
    renderSuspiciousTxs();
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
        return '<div class="threat" style="border-color:rgba(255,176,32,.35);background:rgba(16,10,10,.6)">' +
          '<div class="meta"><span class="chain">' + esc(t.time || '') + '</span><span class="tag warn">HEIGHT ' + esc(String(t.height || '')) + '</span></div>' +
          '<div class="addr" style="color:#ffb020">' + esc(t.hash) + '</div>' +
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

  /* ---------- LIVE NOW — direct from the chains, every 60s ---------- */
  var DRAIN = [
    { chain: 'cosmos', addr: 'cosmos1atuap9kfnt6y8ykvn3437e7j3z8qffh3qtnmwu', lcd: 'https://lcd-cosmoshub.keplr.app' },
    { chain: 'osmosis', addr: 'osmo1atuap9kfnt6y8ykvn3437e7j3z8qffh3gsqtcw', lcd: 'https://lcd-osmosis.keplr.app' },
    { chain: 'injective', addr: 'inj1lqmdmuczn5rxn5jkc34wwrqdeh70etpf5wvt7g', lcd: 'https://lcd-injective.keplr.app' },
    { chain: 'babylon', addr: 'bbn1atuap9kfnt6y8ykvn3437e7j3z8qffh3h4z239', lcd: 'https://lcd-babylon.keplr.app' }
  ];
  var INCIDENT_START = Date.UTC(2026, 10, 6, 21, 57, 39);
  var liveState = { atom: null, bbn: null, seqs: {}, lastMove: null, lastCheck: null };
  try {
    var saved = JSON.parse(localStorage.getItem('kt-live-v1') || '{}');
    if (saved.atom) liveState.atom = saved.atom;
    if (saved.lastMove) liveState.lastMove = saved.lastMove;
  } catch (e) {}

  function findSeq(d) {
    if (!d || !d.account) return null;
    var a = d.account;
    if (a.sequence != null) return String(a.sequence);
    if (a.value && a.value.sequence != null) return String(a.value.sequence);
    if (a.value && a.value.base_account && a.value.base_account.sequence != null) return String(a.value.base_account.sequence);
    if (a.base_account && a.base_account.sequence != null) return String(a.base_account.sequence);
    return null;
  }
  function fmtClock(ms) {
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400); s -= d * 86400;
    var h = Math.floor(s / 3600); s -= h * 3600;
    var m = Math.floor(s / 60); s -= m * 60;
    return (d ? d + 'd ' : '') + h + 'h ' + (m < 10 ? '0' : '') + m + 'm ' + (s < 10 ? '0' : '') + s + 's';
  }
  function tickClock() {
    var age = el('liveAge'), clk = el('liveClock');
    if (age) age.textContent = fmtClock(Date.now() - INCIDENT_START);
    if (clk) clk.textContent = 'CHECKED ' + new Date().toLocaleTimeString();
  }
  function updateTicker(atomTxt) {
    var t = el('tickerText');
    if (!t) return;
    var parts = [
      '● LIVE — Cosmos drain wallet: ' + (atomTxt || '…'),
      '$0 moved out of any drain wallet',
      '11 wallets tracked',
      '42,363 victim sends observed',
      'Drain still active at last scan (Nov 7 15:33 UTC)'
    ];
    var line = parts.join(' &nbsp;&nbsp;·&nbsp;&nbsp; ') + ' &nbsp;&nbsp;·&nbsp;&nbsp; ';
    t.innerHTML = line + line;
  }
  function fetchLive() {
    tickClock();
    var cosmos = DRAIN[0], bbn = DRAIN[3];
    fetchJson(cosmos.lcd + '/cosmos/bank/v1beta1/balances/' + cosmos.addr + '/by_denom?denom=uatom')
      .then(function (d) {
        var row = d.balance;
        if (!row || row.denom !== 'uatom') return;
        var atom = Number(row.amount) / 1e6;
        var now = Date.now();
        if (liveState.atom != null && atom > liveState.atom + 0.000001) {
          liveState.lastMove = now;
          el('liveAtomSub').textContent = '+' + trimNum(atom - liveState.atom) + ' ATOM arrived since the last check — the drain is still running.';
        } else if (liveState.lastMove) {
          el('liveAtomSub').textContent = 'No new funds since ' + new Date(liveState.lastMove).toLocaleTimeString() + ' — still watching.';
        } else {
          el('liveAtomSub').textContent = 'Updated just now from the Cosmos Hub chain — watching for new arrivals.';
        }
        liveState.atom = atom;
        liveState.lastCheck = now;
        try { localStorage.setItem('kt-live-v1', JSON.stringify({ atom: atom, lastMove: liveState.lastMove })); } catch (e) {}
        el('liveAtom').textContent = trimNum(atom) + ' ATOM';
        updateTicker(trimNum(atom) + ' ATOM');
      })
      .catch(function () {
        if (liveState.atom != null) {
          el('liveAtom').textContent = trimNum(liveState.atom) + ' ATOM';
          el('liveAtomSub').textContent = 'Chain API did not answer this time — showing the last live reading.';
        } else {
          el('liveAtomSub').textContent = 'Chain API did not answer — retrying in 60s.';
        }
      });
    fetchJson(bbn.lcd + '/cosmos/bank/v1beta1/balances/' + bbn.addr + '/by_denom?denom=ubbn')
      .then(function (d) {
        var row = d.balance;
        if (!row || row.denom !== 'ubbn') return;
        el('liveBbn').textContent = trimNum(Number(row.amount) / 1e6) + ' BBN';
        el('liveBbnSub').textContent = 'Updated just now from the Babylon chain.';
      })
      .catch(function () { el('liveBbnSub').textContent = 'Chain API did not answer — retrying in 60s.'; });
    Promise.all(DRAIN.map(function (w) {
      return fetchJson(w.lcd + '/cosmos/auth/v1beta1/accounts/' + w.addr)
        .then(function (d) { return { chain: w.chain, seq: findSeq(d) }; })
        .catch(function () { return { chain: w.chain, seq: null }; });
    })).then(function (res) {
      var moved = res.filter(function (r) { return r.seq != null && r.seq !== '0'; });
      var known = res.filter(function (r) { return r.seq != null; });
      var box = el('liveSeq'), sub = el('liveSeqSub');
      if (!known.length) { box.textContent = '—'; sub.textContent = 'Chain APIs did not answer — retrying in 60s.'; return; }
      if (moved.length) {
        box.textContent = '⚠ MOVING';
        box.classList.add('alert');
        sub.textContent = 'ALERT: ' + moved.map(function (r) { return r.chain + ' seq ' + r.seq; }).join(', ') + ' — a drain wallet has signed a transaction. Funds are moving.';
        el('liveNote').textContent = '⚠ ALERT — a drain wallet has signed an outgoing transaction. Check the wallet watch below and the explorers immediately.';
      } else {
        box.textContent = 'NONE — SEQ 0';
        box.classList.remove('alert');
        sub.textContent = 'All ' + known.length + ' drain wallets checked have never signed a transaction. $0 has moved.';
      }
    });
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

  function refreshAll() { renderWatchlist(); fetchLive(); }

  /* ---------- boot ---------- */
  fetch('data.json').then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    (data.chains || []).forEach(function (c) { chains[c.id] = c; });
    renderStatic();
    renderWatchlist();
    fetchLive();
    setInterval(tickClock, 1000);
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

// ── Constants ────────────────────────────────────────────────────────────
    const AGENTS_META = [
      { id: 0, name: 'CN_Macro',    specialty: 'Chinese Macro & Monetary Policy',    rep: 0.85, walletAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d1476B', usdcBalance: 12000 },
      { id: 1, name: 'Generic_AI',  specialty: 'General Purpose Translation & Markets', rep: 0.60, walletAddress: '0x2195f51119A31F758e5fA215dD9821d7bC12F8AC', usdcBalance: 8000 },
      { id: 2, name: 'Asia_Expert', specialty: 'Asian Geopolitics & Financial Markets',  rep: 0.92, walletAddress: '0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1', usdcBalance: 15000 },
    ];

    const CATEGORY_CLASS = {
      monetary_policy:    'cat-monetary',
      trade_policy:       'cat-trade',
      corporate_earnings: 'cat-earnings',
      geopolitics:        'cat-geopolitics',
      macro_data:         'cat-macro',
      general:            'cat-general',
    };

    // ── State ────────────────────────────────────────────────────────────────
    let newsFeed = [];
    let selectedNewsIndex = 0;
    let agentBalances = { 0: 12000, 1: 8000, 2: 15000 };

    // ── DOM Refs ─────────────────────────────────────────────────────────────
    const newsSelect          = document.getElementById('news-select');
    const runButton           = document.getElementById('run-auction');
    const auctionStatus       = document.getElementById('auction-status');
    const utcClock            = document.getElementById('utc-clock');
    const logStream           = document.getElementById('log-stream');
    const leaderboardBody     = document.getElementById('leaderboard-body');
    const resetStatsBtn       = document.getElementById('btn-reset-stats');
    const newsSource          = document.getElementById('news-source');
    const newsLang            = document.getElementById('news-lang');
    const newsOriginal        = document.getElementById('news-original');
    const newsHint            = document.getElementById('news-hint');
    const winningCardContainer = document.getElementById('winning-card-container');
    const winnerMarketTitle   = document.getElementById('winner-market-title');
    const winnerMarketCriteria = document.getElementById('winner-market-criteria');
    const winnerMarketTags    = document.getElementById('winner-market-tags');
    const winnerConfidenceVal = document.getElementById('winner-confidence-val');
    const winnerConfidenceFill = document.getElementById('winner-confidence-fill');
    const winnerContractWallet = document.getElementById('winner-contract-wallet');

    // ── Clock ────────────────────────────────────────────────────────────────
    function updateClock() {
      const n = new Date();
      const pad = v => String(v).padStart(2, '0');
      utcClock.textContent = `${n.getUTCFullYear()}-${pad(n.getUTCMonth()+1)}-${pad(n.getUTCDate())} ${pad(n.getUTCHours())}:${pad(n.getUTCMinutes())}:${pad(n.getUTCSeconds())} UTC`;
    }
    setInterval(updateClock, 1000);
    updateClock();

    // ── Log ──────────────────────────────────────────────────────────────────
    function printLog(msg) {
      const n = new Date();
      const pad = v => String(v).padStart(2, '0');
      logStream.innerHTML = `<span class="time">[${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}]</span> ${msg}`;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function fmtWallet(addr) { return `${addr.substring(0,6)}...${addr.slice(-4)}`; }
    function fmtUSD(n) { return `$${n.toLocaleString('en-US')} USDC`; }
    function fmtK(n) { return n >= 1000 ? `$${(n/1000).toFixed(0)}K` : `$${n}`; }

    function copyAddress(address, agentName, btn) {
      navigator.clipboard.writeText(address).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'COPIED!';
        btn.style.color = 'var(--terminal-green)';
        printLog(`[WALLET] Copied address for ${agentName}: ${address}`);
        setTimeout(() => { btn.textContent = orig; btn.style.color = 'var(--terminal-cyan)'; }, 1200);
      });
    }
    window.copyAddress = copyAddress;

    function categoryClass(cat) { return CATEGORY_CLASS[cat] || 'cat-general'; }

    // ── Init Agent Cards ──────────────────────────────────────────────────────
    function initAgentColumns() {
      const container = document.getElementById('agent-columns');
      container.innerHTML = '';
      AGENTS_META.forEach(agent => {
        const card = document.createElement('div');
        card.className = 'agent-card';
        card.id = `agent-card-${agent.id}`;
        card.innerHTML = `
          <div class="winner-badge">WINNER</div>
          <div class="agent-header">
            <div class="agent-id">AGENT_0${agent.id} // SECURE_NODE</div>
            <div class="agent-name">${agent.name}</div>
            <div class="agent-spec">${agent.specialty}</div>
          </div>

          <div class="balance-row">
            <span class="balance-label">USDC Balance</span>
            <span class="balance-value" id="agent-balance-${agent.id}">${fmtUSD(agent.usdcBalance)}</span>
          </div>

          <div class="agent-wallet-row">
            <span>ADDR: <span class="wallet-addr" title="${agent.walletAddress}">${fmtWallet(agent.walletAddress)}</span></span>
            <button class="btn-copy" onclick="copyAddress('${agent.walletAddress}','${agent.name}',this)">[COPY]</button>
          </div>

          <div class="agent-stats">
            <div class="stat-box">
              <span class="stat-label">REPUTATION</span>
              <span class="stat-value">${agent.rep.toFixed(2)}</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">BID VALUE</span>
              <span class="stat-value cyan" id="agent-bid-${agent.id}">---</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">CONF. SCORE</span>
              <span class="stat-value" id="agent-conf-${agent.id}">---</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">AUDIT SCORE</span>
              <span class="stat-value" id="agent-score-${agent.id}">---</span>
            </div>
          </div>

          <!-- Bid Rationale Bubble -->
          <div class="bid-rationale-bubble" id="agent-rationale-${agent.id}">
            <span id="agent-rationale-text-${agent.id}">Computing bid strategy...</span>
            <div class="projected-roi" id="agent-roi-${agent.id}" style="display:none;">
              <div class="roi-item">
                <span>Est. Volume</span>
                <span id="agent-exp-vol-${agent.id}">---</span>
              </div>
              <div class="roi-item">
                <span>Est. Royalty</span>
                <span id="agent-exp-roy-${agent.id}">---</span>
              </div>
            </div>
          </div>

          <div class="qual-row">
            <span class="stat-label">QUALIFICATION</span>
            <span id="agent-status-${agent.id}" style="font-weight:bold;font-size:0.7rem;color:#6b7280;">STANDBY</span>
          </div>

          <div class="audit-critique">
            <div class="audit-label">Oracle Audit Critique:</div>
            <div class="audit-text" id="agent-feedback-${agent.id}">Awaiting audit result...</div>
          </div>

          <div class="score-telemetry">
            <div class="score-telemetry-header">
              <span>TRANSLATION QUALITY</span>
              <span class="score-telemetry-value" id="agent-telemetry-val-${agent.id}">0.0000</span>
            </div>
            <div class="score-bar-container">
              <div class="score-bar-fill" id="agent-bar-fill-${agent.id}"></div>
            </div>
          </div>
        `;
        container.appendChild(card);
      });
    }

    // ── Leaderboard ───────────────────────────────────────────────────────────
    async function fetchLeaderboard() {
      try {
        const data = await fetch('/api/leaderboard').then(r => r.json());
        leaderboardBody.innerHTML = '';
        data.forEach((agent, i) => {
          const row = document.createElement('tr');
          row.className = `leaderboard-row-${i}`;
          row.innerHTML = `
            <td class="rank-cell">#0${i+1}</td>
            <td class="agent-cell">${agent.name}</td>
            <td class="wallet-cell" title="${agent.walletAddress}">${fmtWallet(agent.walletAddress)}</td>
            <td class="numeric-cell">${agent.wins}</td>
            <td class="numeric-cell" style="font-weight:bold;">${agent.points}</td>
            <td class="numeric-cell balance-cell">$${Math.round(agent.usdcBalance || 0).toLocaleString()}</td>
            <td class="numeric-cell highlight-usdc">$${agent.usdc}</td>
          `;
          leaderboardBody.appendChild(row);
        });
      } catch (err) { printLog('Error fetching leaderboard.'); }
    }

    // ── History ───────────────────────────────────────────────────────────────
    async function fetchHistory() {
      try {
        const data = await fetch('/api/history').then(r => r.json());
        const body = document.getElementById('history-body');
        if (data.length === 0) {
          body.innerHTML = `<tr><td colspan="7" class="empty-history">No resolved contracts recorded in ledger yet.</td></tr>`;
          return;
        }
        body.innerHTML = '';
        data.forEach(tx => {
          const d = new Date(tx.timestamp);
          const pad = v => String(v).padStart(2, '0');
          const ts = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
          const row = document.createElement('tr');
          row.innerHTML = `
            <td class="tx-cell">TX#${String(tx.id).padStart(4,'0')}</td>
            <td class="time-cell">${ts}</td>
            <td>Feed #${tx.newsIndex}</td>
            <td class="winner-cell-hist">${tx.winnerName}</td>
            <td class="numeric-cell" style="color:var(--terminal-cyan);">${tx.simulatedVolume ? fmtK(tx.simulatedVolume) : '---'}</td>
            <td class="numeric-cell highlight-usdc">$${tx.royaltyUsdc}</td>
            <td><span class="confirmed-badge">[CONFIRMED]</span></td>
          `;
          body.appendChild(row);
        });
      } catch (err) { printLog('Error fetching history.'); }
    }

    // ── Markets Registry ──────────────────────────────────────────────────────
    async function fetchMarkets() {
      try {
        const data = await fetch('/api/markets').then(r => r.json());
        const grid = document.getElementById('markets-grid');
        if (data.length === 0) {
          grid.innerHTML = '<div class="empty-markets">No markets deployed yet. Run an auction to create the first contract.</div>';
          return;
        }
        grid.innerHTML = '';
        data.forEach(m => {
          const div = document.createElement('div');
          div.className = 'market-registry-item';
          const catClass = categoryClass(m.category);
          div.innerHTML = `
            <div class="mri-left">
              <div class="mri-question">${m.question}</div>
              <div class="mri-meta">
                <span style="color:#6b7280;">Creator: <strong style="color:#e5e7eb;">${m.creatorName}</strong></span>
                <span>${fmtWallet(m.creatorWallet)}</span>
                <span class="category-badge ${catClass}">${m.category.replace(/_/g,' ')}</span>
              </div>
            </div>
            <div class="mri-right">
              <span class="mri-volume">${fmtK(m.simulatedVolume)} vol.</span>
              <span class="mri-royalty">+$${m.projectedRoyalty} royalty</span>
              <span style="font-size:0.65rem;color:#4b5563;">${m.volumeConfidence} confidence</span>
            </div>
          `;
          grid.appendChild(div);
        });
      } catch (err) { printLog('Error fetching markets.'); }
    }

    // ── Volume Chart ──────────────────────────────────────────────────────────
    function renderVolumeChart(dailyVolume, peakDay, royalty) {
      const container = document.getElementById('volume-chart-container');
      const barsEl = document.getElementById('chart-bars');
      container.style.display = 'flex';
      barsEl.innerHTML = '';

      const max = Math.max(...dailyVolume, 1);

      dailyVolume.forEach((vol, i) => {
        const bar = document.createElement('div');
        bar.className = 'chart-bar' + (i === peakDay ? ' peak' : '');
        bar.style.height = '0%';
        bar.title = `Day ${i+1}: $${vol.toLocaleString()}`;
        barsEl.appendChild(bar);

        // Animate in staggered
        setTimeout(() => {
          bar.style.height = `${Math.max((vol / max) * 100, 2)}%`;
        }, 50 + i * 20);
      });

      document.getElementById('chart-peak-label').textContent =
        `Peak: Day ${peakDay + 1} — $${dailyVolume[peakDay]?.toLocaleString() || 0}`;

      // Animate royalty counter
      const counter = document.getElementById('royalty-counter');
      counter.textContent = '$0 USDC';
      let current = 0;
      const step = royalty / 60;
      const interval = setInterval(() => {
        current = Math.min(current + step, royalty);
        counter.textContent = `$${Math.round(current).toLocaleString()} USDC`;
        if (current >= royalty) clearInterval(interval);
      }, 30);
    }

    // ── Reset ─────────────────────────────────────────────────────────────────
    resetStatsBtn.addEventListener('click', async () => {
      if (confirm('Confirm clear of all persistent contract ledger and database stats?')) {
        try {
          await fetch('/api/reset', { method: 'POST' });
          // Reset local balances
          agentBalances = { 0: 12000, 1: 8000, 2: 15000 };
          AGENTS_META.forEach(a => {
            const el = document.getElementById(`agent-balance-${a.id}`);
            if (el) el.textContent = fmtUSD(a.usdcBalance);
          });
          printLog('CypherLexicon database tables reset successfully.');
          await fetchLeaderboard();
          await fetchHistory();
          await fetchMarkets();
        } catch { printLog('Error resetting database.'); }
      }
    });

    // ── News Feed ─────────────────────────────────────────────────────────────
    async function loadNewsFeed() {
      try {
        newsFeed = await fetch('/api/news').then(r => r.json());
        newsSelect.innerHTML = '';
        newsFeed.forEach((item, i) => {
          const opt = document.createElement('option');
          opt.value = i;
          opt.textContent = `[${item.lang}] ${item.source} — ${item.hint}`;
          newsSelect.appendChild(opt);
        });
        updateNewsDisplay(0);
        runButton.disabled = false;
        auctionStatus.textContent = 'READY FOR AUCTION';
        printLog('News feed telemetry initialized successfully.');
      } catch {
        auctionStatus.textContent = 'OFFLINE — RETRY IN SECONDS';
        auctionStatus.style.color = 'var(--terminal-red)';
        printLog('Error connecting to server telemetry API.');
      }
    }

    function updateNewsDisplay(index) {
      selectedNewsIndex = parseInt(index);
      const item = newsFeed[selectedNewsIndex];
      if (item) {
        newsSource.textContent = `SOURCE: ${item.source}`;
        newsLang.textContent = item.lang;
        newsOriginal.textContent = item.zh;
        newsHint.textContent = `Transl. Hint: ${item.hint}`;
      }
    }

    newsSelect.addEventListener('change', e => updateNewsDisplay(e.target.value));

    // ── Main Auction Handler ──────────────────────────────────────────────────
    runButton.addEventListener('click', async () => {
      runButton.disabled = true;
      auctionStatus.textContent = 'AGENTS TRANSLATING...';
      auctionStatus.className = 'auction-status blinking-cursor';
      auctionStatus.style.color = 'var(--terminal-amber)';
      winningCardContainer.classList.remove('visible');
      document.getElementById('volume-chart-container').style.display = 'none';

      // Reset agent cards
      for (let id = 0; id < 3; id++) {
        const card = document.getElementById(`agent-card-${id}`);
        card.classList.remove('winner');
        document.getElementById(`agent-bid-${id}`).textContent = '---';
        document.getElementById(`agent-conf-${id}`).textContent = '---';
        document.getElementById(`agent-score-${id}`).textContent = '---';
        document.getElementById(`agent-telemetry-val-${id}`).textContent = '0.0000';
        document.getElementById(`agent-bar-fill-${id}`).style.width = '0%';
        document.getElementById(`agent-rationale-${id}`).classList.remove('visible');
        document.getElementById(`agent-roi-${id}`).style.display = 'none';
        const statusEl = document.getElementById(`agent-status-${id}`);
        statusEl.textContent = 'PENDING...';
        statusEl.style.color = 'var(--terminal-amber)';
        document.getElementById(`agent-feedback-${id}`).textContent = 'Awaiting audit result...';
      }

      printLog(`Initiated contract auction for news item #${selectedNewsIndex}...`);

      try {
        const res = await fetch('/api/auction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newsIndex: selectedNewsIndex }),
        });

        if (!res.ok) throw new Error(`Server error: ${res.status}`);
        const data = await res.json();

        auctionStatus.textContent = 'COMMITTING TRANSACTION...';
        auctionStatus.className = 'auction-status';

        // Phase 1: Show bids + rationale (800ms)
        setTimeout(() => {
          data.agents.forEach((agent, idx) => {
            document.getElementById(`agent-bid-${idx}`).textContent = `$${agent.bid}`;
            document.getElementById(`agent-conf-${idx}`).textContent = `${Math.round(agent.response.confidence_score * 100)}%`;
            document.getElementById(`agent-score-${idx}`).textContent = agent.score.toFixed(4);
            document.getElementById(`agent-telemetry-val-${idx}`).textContent = agent.score.toFixed(4);
            document.getElementById(`agent-bar-fill-${idx}`).style.width = `${Math.min(agent.score * 100, 100)}%`;

            // Bid rationale bubble
            const rationaleEl = document.getElementById(`agent-rationale-${idx}`);
            document.getElementById(`agent-rationale-text-${idx}`).textContent = agent.bidRationale;
            const roiEl = document.getElementById(`agent-roi-${idx}`);
            document.getElementById(`agent-exp-vol-${idx}`).textContent = fmtK(agent.expectedVolume);
            document.getElementById(`agent-exp-roy-${idx}`).textContent = `$${agent.expectedRoyalty}`;
            roiEl.style.display = 'grid';
            rationaleEl.classList.add('visible');

            // Qualification
            const statusEl = document.getElementById(`agent-status-${idx}`);
            statusEl.textContent = agent.isQualified ? 'QUALIFIED' : 'DISQUALIFIED';
            statusEl.style.color = agent.isQualified ? 'var(--terminal-green)' : 'var(--terminal-red)';

            document.getElementById(`agent-feedback-${idx}`).textContent = agent.auditorFeedback;

            // Update balance display
            const newBalance = agentBalances[idx] - (idx === data.winner_index ? agent.bid : 0);
            agentBalances[idx] = newBalance;
            const balEl = document.getElementById(`agent-balance-${idx}`);
            if (balEl) {
              balEl.textContent = fmtUSD(Math.max(newBalance, 0));
              balEl.className = newBalance < 2000 ? 'balance-value depleted' : 'balance-value';
            }
          });

          // Highlight winner card
          const winner = data.agents[data.winner_index];
          document.getElementById(`agent-card-${data.winner_index}`).classList.add('winner');

          // Phase 2: Show winner market card + volume chart (400ms later)
          setTimeout(async () => {
            winnerMarketTitle.textContent = winner.response.title;
            winnerMarketCriteria.textContent = winner.response.resolution_criteria;
            winnerContractWallet.innerHTML = `<span class="wallet-addr" title="${winner.walletAddress}">${winner.walletAddress}</span>`;

            // Category badge
            const badge = document.getElementById('winner-category-badge');
            badge.textContent = data.category_label;
            badge.className = `category-badge ${categoryClass(data.market_category)}`;

            // Volume stats
            document.getElementById('winner-volume').textContent = fmtK(data.simulated_volume);
            document.getElementById('winner-royalty').textContent = `$${data.royalty_usdc}`;
            document.getElementById('winner-vol-confidence').textContent = data.volume_confidence;

            // Tags
            winnerMarketTags.innerHTML = '';
            winner.response.tags.forEach(tag => {
              const span = document.createElement('span');
              span.className = 'market-tag';
              span.textContent = tag;
              winnerMarketTags.appendChild(span);
            });

            // Confidence meter
            const conf = Math.round(winner.response.confidence_score * 100);
            winnerConfidenceVal.textContent = `CONFIDENCE: ${conf}%`;
            winnerConfidenceFill.style.width = `${conf}%`;

            winningCardContainer.classList.add('visible');

            // Volume chart (after card visible)
            setTimeout(() => {
              renderVolumeChart(data.daily_volume, data.peak_day, data.royalty_usdc);
            }, 300);

            // Refresh data
            await fetchLeaderboard();
            await fetchHistory();
            await fetchMarkets();

            auctionStatus.textContent = 'CONTRACT DEPLOYED';
            auctionStatus.style.color = 'var(--terminal-green)';
            printLog(`Contract deployed. Agent [${winner.name}] wins. Volume: ${fmtK(data.simulated_volume)} | Royalty: $${data.royalty_usdc} USDC`);
            runButton.disabled = false;
          }, 400);

        }, 800);

      } catch (err) {
        auctionStatus.textContent = 'TRANSACTION REJECTED';
        auctionStatus.className = 'auction-status';
        auctionStatus.style.color = 'var(--terminal-red)';
        printLog(`Critical smart contract verification failure: ${err.message}`);
        runButton.disabled = false;
      }
    });

    // ── Boot ──────────────────────────────────────────────────────────────────
    initAgentColumns();
    loadNewsFeed();
    fetchLeaderboard();
    fetchHistory();
    fetchMarkets();

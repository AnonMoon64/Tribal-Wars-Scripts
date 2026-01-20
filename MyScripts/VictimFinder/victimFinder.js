/*
 * Script Name: Victim Finder
 * Version: v2.0.0
 * Author: AnonMoon64
 * Description: Correlates ODA and ODD changes to identify attack victims
 */

// Settings - change these before running if needed
if (typeof MIN_CHANGE !== 'number') MIN_CHANGE = 10000;  // Minimum ODA/ODD change
if (typeof MAX_RESULTS !== 'number') MAX_RESULTS = 30;   // Max results to show

$.getScript('https://twscripts.dev/scripts/twSDK.js?url=' + document.currentScript.src, async function () {
    const scriptConfig = {
        scriptData: {
            prefix: 'victimFinder',
            name: 'Victim Finder',
            version: 'v2.0.0',
            author: 'AnonMoon64',
            authorUrl: 'https://github.com/AnonMoon64',
            helpLink: '',
        },
        allowedMarkets: [],
        allowedScreens: [],
        allowedModes: [],
        isDebug: false,
        enableCountApi: false,
    };

    await twSDK.init(scriptConfig);

    const world = game_data.world;
    const worldUrl = window.location.origin;
    const KEYS = {
        oda: 'vf_oda_' + world,
        odd: 'vf_odd_' + world,
        time: 'vf_time_' + world
    };

    // Fetch kill data with 10 second timeout
    async function fetchKillData(type) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject('Timeout'), 10000);
            $.ajax({
                url: worldUrl + '/map/kill_' + type + '.txt',
                type: 'GET',
                dataType: 'text',
                success: function (data) {
                    clearTimeout(timeout);
                    const result = {};
                    data.split('\n').forEach(line => {
                        const p = line.split(',');
                        if (p.length >= 3) result[p[1]] = parseInt(p[2]) || 0;
                    });
                    resolve(result);
                },
                error: function (xhr, status, err) {
                    clearTimeout(timeout);
                    reject(err || status);
                }
            });
        });
    }

    // Find matches
    function findMatches(odaDeltas, oddDeltas) {
        const matches = [];
        for (const [attId, odaGain] of Object.entries(odaDeltas)) {
            if (odaGain < MIN_CHANGE) continue;
            for (const [defId, oddGain] of Object.entries(oddDeltas)) {
                if (oddGain < MIN_CHANGE || attId === defId) continue;
                const diff = Math.abs(odaGain - oddGain);
                const pct = diff / ((odaGain + oddGain) / 2);
                if (pct <= 0.25) {
                    matches.push({
                        attId, odaGain, defId, oddGain,
                        pct: pct * 100,
                        conf: pct < 0.05 ? 'High' : pct < 0.15 ? 'Med' : 'Low'
                    });
                    if (matches.length >= MAX_RESULTS) break;
                }
            }
            if (matches.length >= MAX_RESULTS) break;
        }
        return matches.sort((a, b) => a.pct - b.pct);
    }

    // Calculate deltas
    function calcDeltas(curr, prev) {
        const deltas = {};
        for (const [id, val] of Object.entries(curr)) {
            const delta = val - (prev[id] || 0);
            if (delta >= MIN_CHANGE) deltas[id] = delta;
        }
        return deltas;
    }

    // Run scan
    async function scan() {
        $('#vfContent').html('<div style="padding:20px;text-align:center">⏳ Scanning...</div>');

        try {
            const [odaData, oddData] = await Promise.all([
                fetchKillData('att'),
                fetchKillData('def')
            ]);

            const prevOda = JSON.parse(localStorage.getItem(KEYS.oda) || '{}');
            const prevOdd = JSON.parse(localStorage.getItem(KEYS.odd) || '{}');
            const isFirst = Object.keys(prevOda).length === 0;

            const odaDeltas = calcDeltas(odaData, prevOda);
            const oddDeltas = calcDeltas(oddData, prevOdd);

            console.log('[VF] ODA changes:', Object.keys(odaDeltas).length);
            console.log('[VF] ODD changes:', Object.keys(oddDeltas).length);

            // Save current data
            localStorage.setItem(KEYS.oda, JSON.stringify(odaData));
            localStorage.setItem(KEYS.odd, JSON.stringify(oddData));
            localStorage.setItem(KEYS.time, Date.now());

            if (isFirst) {
                showUI([], true);
            } else {
                const matches = findMatches(odaDeltas, oddDeltas);
                showUI(matches, false);
            }
        } catch (err) {
            $('#vfContent').html('<div style="padding:20px;color:red">❌ Error: ' + err + '</div>');
        }
    }

    // Clear data
    function clear() {
        localStorage.removeItem(KEYS.oda);
        localStorage.removeItem(KEYS.odd);
        localStorage.removeItem(KEYS.time);
        UI.SuccessMessage('Data cleared!');
        showUI([], false, true);
    }

    // Show UI
    function showUI(matches, isFirst, cleared) {
        const lastTime = localStorage.getItem(KEYS.time);
        let html = `
            <div style="padding:8px;background:#f4e4bc;border-bottom:1px solid #c1a264;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:5px">
                <span>🌍 ${world.toUpperCase()} | ⚔️ Min: ${MIN_CHANGE.toLocaleString()} | 📊 Max: ${MAX_RESULTS}</span>
                <div>
                    <button class="btn" onclick="window.vfScan()">🔍 Scan</button>
                    <button class="btn" onclick="window.vfClear()">🗑️ Clear</button>
                </div>
            </div>
        `;

        if (cleared) {
            html += '<div style="padding:30px;text-align:center">Data cleared. Click Scan to start fresh.</div>';
        } else if (isFirst) {
            html += '<div style="padding:30px;text-align:center;background:#cce5ff;color:#004085">✅ Baseline captured! Run again in ~1 hour to see matches.</div>';
        } else if (matches.length === 0) {
            html += '<div style="padding:30px;text-align:center">No matches found. Try again later or lower MIN_CHANGE.</div>';
        } else {
            html += `<table class="vis" style="width:100%"><thead><tr>
                <th>Attacker ID</th><th>ODA+</th><th>Victim ID</th><th>ODD+</th><th>Diff</th><th>Conf</th>
            </tr></thead><tbody>`;
            matches.forEach(m => {
                const confColor = m.conf === 'High' ? '#155724' : m.conf === 'Med' ? '#856404' : '#6c757d';
                html += `<tr>
                    <td><a href="${worldUrl}/guest.php?screen=info_player&id=${m.attId}" target="_blank">${m.attId}</a></td>
                    <td style="color:#c44a4a">+${m.odaGain.toLocaleString()}</td>
                    <td><a href="${worldUrl}/guest.php?screen=info_player&id=${m.defId}" target="_blank">${m.defId}</a></td>
                    <td style="color:#b8860b">+${m.oddGain.toLocaleString()}</td>
                    <td>${m.pct.toFixed(1)}%</td>
                    <td style="color:${confColor};font-weight:bold">${m.conf}</td>
                </tr>`;
            });
            html += '</tbody></table>';
        }

        $('#vfContent').html(html);
    }

    // Expose functions
    window.vfScan = scan;
    window.vfClear = clear;

    // Render widget
    twSDK.renderFixedWidget(
        '<div id="vfContent"></div>',
        'victimFinderWidget',
        'victim-finder',
        ''
    );

    // Show initial UI
    showUI([], false, true);
});

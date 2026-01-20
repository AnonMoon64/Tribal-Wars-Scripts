/*
 * Script Name: Victim Finder
 * Version: v1.0.0
 * Last Updated: 2026-01-20
 * Author: Your Name
 * Author URL: https://github.com/yourusername
 * Author Contact: your_discord
 * Approved: Pending
 * Approved Date: N/A
 * Description: Correlates ODA and ODD changes to identify potential attack victims
 */

/*--------------------------------------------------------------------------------------
 * USAGE (via jsDelivr CDN):
 * javascript:$.getScript('https://cdn.jsdelivr.net/gh/YOUR_USER/YOUR_REPO@latest/victimFinder.js');
 * 
 * This script analyzes publicly available player kill statistics to correlate
 * attack data. It uses the game's public API files (kill_att.txt, kill_def.txt)
 * and stores snapshots locally to calculate changes over time.
 --------------------------------------------------------------------------------------*/

// User Input - Configure these BEFORE running the script
if (typeof DEBUG !== 'boolean') DEBUG = false;
if (typeof DEMO_MODE !== 'boolean') DEMO_MODE = false;
if (typeof RANGE_RADIUS !== 'number') RANGE_RADIUS = 50;      // Coordinate range around player
if (typeof MIN_POINTS !== 'number') MIN_POINTS = 1000;        // Only include players with at least this many points
if (typeof MIN_CHANGE !== 'number') MIN_CHANGE = 10000;       // Minimum ODA/ODD change to report (filters noise)
if (typeof MAX_RESULTS !== 'number') MAX_RESULTS = 50;        // Maximum matches to display

// Script Config
var scriptConfig = {
    scriptData: {
        prefix: 'victimFinder',
        name: 'Victim Finder',
        version: 'v1.0.0',
        author: 'Your Name',
        authorUrl: 'https://github.com/yourusername',
        helpLink: '',
    },
    translations: {
        en_DK: {
            'Victim Finder': 'Victim Finder',
            'Help': 'Help',
            'Scanning...': 'Scanning...',
            'No previous data': 'No previous snapshot. Baseline captured!',
            'Error fetching data': 'Error fetching player data!',
            'Scan Complete': 'Scan Complete',
            'No matches found': 'No potential matches found',
            'First scan': 'First scan - baseline captured. Run again after ~1 hour for comparisons.',
            'Attacker': 'Attacker',
            'Victim': 'Victim',
            'ODA Change': 'ODA Δ',
            'ODD Change': 'ODD Δ',
            'Confidence': 'Confidence',
            'High': 'High',
            'Medium': 'Medium',
            'Low': 'Low',
            'Rescan': 'Rescan',
            'Demo Mode': 'Demo Mode',
            'Clear Data': 'Clear Data',
            'Last scan': 'Last scan',
            'Range': 'Range',
            'matches': 'matches',
        },
    },
    allowedMarkets: [],
    allowedScreens: [],
    allowedModes: [],
    isDebug: DEBUG,
    enableCountApi: false,
};

$.getScript(
    `https://twscripts.dev/scripts/twSDK.js?url=${document.currentScript.src}`,
    async function () {
        // Initialize Library
        await twSDK.init(scriptConfig);
        const scriptInfo = twSDK.scriptInfo();

        // Get world info from game_data
        const { world, market, player, villages } = game_data;
        // Use the current page origin to avoid CORS issues
        const worldUrl = window.location.origin;

        // Debug: Log the URL we're using
        console.log('[VictimFinder] World:', world);
        console.log('[VictimFinder] Using URL:', worldUrl);

        // Storage keys
        const STORAGE_KEYS = {
            lastScan: `victimFinder_lastScan_${world}`,
            odaData: `victimFinder_odaData_${world}`,
            oddData: `victimFinder_oddData_${world}`,
        };

        // Get player's village coordinates for range calculation
        function getPlayerCenter() {
            const villageList = Object.values(villages);
            if (villageList.length === 0) return { x: 500, y: 500 };

            let sumX = 0, sumY = 0;
            villageList.forEach(v => {
                // Village coords are in format "xxx|yyy"
                const coords = v.coord ? v.coord.split('|') : [500, 500];
                sumX += parseInt(coords[0]) || 500;
                sumY += parseInt(coords[1]) || 500;
            });

            return {
                x: Math.round(sumX / villageList.length),
                y: Math.round(sumY / villageList.length)
            };
        }

        // Fetch data using jQuery ajax (better CORS handling in TW)
        function fetchTWData(endpoint) {
            return new Promise((resolve, reject) => {
                const fullUrl = `${worldUrl}/map/${endpoint}`;
                console.log(`[VictimFinder] Fetching: ${fullUrl}`);

                jQuery.ajax({
                    url: fullUrl,
                    type: 'GET',
                    dataType: 'text',
                    success: function (data) {
                        console.log(`[VictimFinder] Got response for ${endpoint}, length: ${data.length}`);
                        console.log(`[VictimFinder] First 100 chars: ${data.substring(0, 100)}`);

                        // Check if we got HTML instead of CSV (means redirect to login)
                        if (data.includes('<!DOCTYPE') || data.includes('<html')) {
                            console.error(`[VictimFinder] Got HTML instead of data for ${endpoint} - may need to be logged in`);
                            reject('Got HTML instead of data - session issue?');
                            return;
                        }

                        resolve(data);
                    },
                    error: function (xhr, status, error) {
                        console.error(`[VictimFinder] Error fetching ${endpoint}:`, status, error);
                        console.error(`[VictimFinder] XHR status: ${xhr.status}, response: ${xhr.responseText?.substring(0, 200)}`);
                        reject(error);
                    }
                });
            });
        }

        // Fetch player kill data from API
        async function fetchKillData(type) {
            try {
                const text = await fetchTWData(`kill_${type}.txt`);
                return parseKillData(text);
            } catch (error) {
                console.error(`${scriptInfo} Error fetching ${type} data:`, error);
                return null;
            }
        }

        // Parse kill data from TW format: rank,id,kills
        function parseKillData(text) {
            const data = {};
            const lines = text.trim().split('\n');
            lines.forEach(line => {
                const parts = line.split(',');
                if (parts.length >= 3) {
                    const playerId = parts[1];
                    const kills = parseInt(parts[2]) || 0;
                    data[playerId] = kills;
                }
            });
            return data;
        }

        // Fetch player info for names
        async function fetchPlayerData() {
            try {
                const text = await fetchTWData('player.txt');
                return parsePlayerData(text);
            } catch (error) {
                console.error(`${scriptInfo} Error fetching player data:`, error);
                return {};
            }
        }

        // Parse player data: id,name,ally,villages,points,rank
        function parsePlayerData(text) {
            const data = {};
            const lines = text.trim().split('\n');
            lines.forEach(line => {
                const parts = line.split(',');
                if (parts.length >= 2) {
                    const playerId = parts[0];
                    const name = decodeURIComponent(parts[1].replace(/\+/g, ' '));
                    data[playerId] = {
                        id: playerId,
                        name: name,
                        tribe: parts[2] || '0',
                        points: parseInt(parts[4]) || 0
                    };
                }
            });
            return data;
        }

        // Fetch village data for coordinate filtering
        async function fetchVillageData() {
            try {
                const text = await fetchTWData('village.txt');
                return parseVillageData(text);
            } catch (error) {
                console.error(`${scriptInfo} Error fetching village data:`, error);
                return {};
            }
        }

        // Parse village data: id,name,x,y,player,points,rank
        function parseVillageData(text) {
            const playerVillages = {}; // playerId -> [{x, y}]
            const lines = text.trim().split('\n');
            lines.forEach(line => {
                const parts = line.split(',');
                if (parts.length >= 5) {
                    const x = parseInt(parts[2]) || 0;
                    const y = parseInt(parts[3]) || 0;
                    const playerId = parts[4];
                    if (playerId && playerId !== '0') {
                        if (!playerVillages[playerId]) {
                            playerVillages[playerId] = [];
                        }
                        playerVillages[playerId].push({ x, y });
                    }
                }
            });
            return playerVillages;
        }

        // Check if player is within range
        function isInRange(playerVillages, center, radius) {
            if (!playerVillages || playerVillages.length === 0) return false;
            return playerVillages.some(v => {
                const dx = Math.abs(v.x - center.x);
                const dy = Math.abs(v.y - center.y);
                return dx <= radius && dy <= radius;
            });
        }

        // Calculate deltas between current and previous data (with MIN_CHANGE filter)
        function calculateDeltas(currentData, previousData) {
            const deltas = {};
            for (const [playerId, currentValue] of Object.entries(currentData)) {
                const previousValue = previousData[playerId] || 0;
                const delta = currentValue - previousValue;
                // Only include if delta exceeds minimum threshold
                if (delta >= MIN_CHANGE) {
                    deltas[playerId] = delta;
                }
            }
            console.log(`[VictimFinder] Found ${Object.keys(deltas).length} players with changes >= ${MIN_CHANGE}`);
            return deltas;
        }

        // Find matches between ODA and ODD changes
        function findMatches(odaDeltas, oddDeltas, players, tolerance = 0.25) {
            const matches = [];

            for (const [attackerId, odaGain] of Object.entries(odaDeltas)) {
                for (const [defenderId, oddGain] of Object.entries(oddDeltas)) {
                    if (attackerId === defenderId) continue;

                    // Skip if player points are below minimum
                    const attackerPoints = players[attackerId]?.points || 0;
                    const defenderPoints = players[defenderId]?.points || 0;
                    if (attackerPoints < MIN_POINTS || defenderPoints < MIN_POINTS) continue;

                    const diff = Math.abs(odaGain - oddGain);
                    const avg = (odaGain + oddGain) / 2;
                    const percentDiff = diff / avg;

                    if (percentDiff <= tolerance) {
                        let confidence = 'Low';
                        let confidenceClass = 'match-low';

                        if (percentDiff < 0.05) {
                            confidence = 'High';
                            confidenceClass = 'match-high';
                        } else if (percentDiff < 0.15) {
                            confidence = 'Medium';
                            confidenceClass = 'match-medium';
                        }

                        matches.push({
                            attackerId,
                            attackerName: players[attackerId]?.name || `Player ${attackerId}`,
                            attackerPoints,
                            odaGain,
                            defenderId,
                            defenderName: players[defenderId]?.name || `Player ${defenderId}`,
                            defenderPoints,
                            oddGain,
                            percentDiff: percentDiff * 100,
                            confidence,
                            confidenceClass
                        });

                        // Limit matches to avoid overwhelming results
                        if (matches.length >= MAX_RESULTS) break;
                    }
                }
                if (matches.length >= MAX_RESULTS) break;
            }

            // Sort by confidence (lowest diff first)
            matches.sort((a, b) => a.percentDiff - b.percentDiff);
            return matches;
        }

        // Generate demo data for testing
        function generateDemoData() {
            const demoOdaDeltas = {
                '12345': 287500,
                '23456': 156000,
                '34567': 423000,
                '45678': 89500,
            };
            const demoOddDeltas = {
                '55555': 285000,  // Matches 12345
                '66666': 160000, // Matches 23456
                '77777': 420000, // Matches 34567
                '88888': 95000,  // Matches 45678
                '99999': 50000,  // No match
            };
            const demoPlayers = {
                '12345': { name: 'DragonSlayer', id: '12345' },
                '23456': { name: 'NightRaider', id: '23456' },
                '34567': { name: 'WarLord99', id: '34567' },
                '45678': { name: 'ShadowKing', id: '45678' },
                '55555': { name: 'IronFist', id: '55555' },
                '66666': { name: 'StormBringer', id: '66666' },
                '77777': { name: 'DeathDealer', id: '77777' },
                '88888': { name: 'BloodHunter', id: '88888' },
                '99999': { name: 'CrimsonTide', id: '99999' },
            };
            return { odaDeltas: demoOdaDeltas, oddDeltas: demoOddDeltas, players: demoPlayers };
        }

        // Format large numbers
        function formatNumber(num) {
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toString();
        }

        // Build the UI content
        function buildContent(matches, lastScan, isFirstScan, isDemo) {
            const playerCenter = getPlayerCenter();

            let statusHtml = '';
            if (isDemo) {
                statusHtml = `<div class="vf-status vf-status-demo">🎮 ${twSDK.tt('Demo Mode')} - Using simulated data</div>`;
            } else if (isFirstScan) {
                statusHtml = `<div class="vf-status vf-status-info">ℹ️ ${twSDK.tt('First scan')} - Run again after ~1 hour for comparisons.</div>`;
            } else {
                statusHtml = `<div class="vf-status vf-status-success">✓ ${twSDK.tt('Scan Complete')} - ${matches.length} ${twSDK.tt('matches')}</div>`;
            }

            const headerHtml = `
                <div class="vf-header">
                    <div class="vf-info">
                        <span>🌍 ${world.toUpperCase()}</span>
                        <span>� Min: ${MIN_POINTS.toLocaleString()} pts</span>
                        <span>⚔️ Min Δ: ${MIN_CHANGE.toLocaleString()}</span>
                        ${lastScan ? `<span>🕐 ${new Date(parseInt(lastScan)).toLocaleTimeString()}</span>` : ''}
                    </div>
                    <div class="vf-buttons">
                        <button class="btn vf-btn-primary" onclick="window.victimFinderScan(false)">🔍 ${twSDK.tt('Rescan')}</button>
                        <button class="btn vf-btn-secondary" onclick="window.victimFinderScan(true)">🎮 ${twSDK.tt('Demo Mode')}</button>
                        <button class="btn vf-btn-danger" onclick="window.victimFinderClear()">🗑️ ${twSDK.tt('Clear Data')}</button>
                    </div>
                </div>
            `;

            let matchesHtml = '';
            if (matches.length === 0 && !isFirstScan) {
                matchesHtml = `
                    <div class="vf-empty">
                        <div class="vf-empty-icon">🔍</div>
                        <p>${twSDK.tt('No matches found')}</p>
                        <p class="vf-empty-sub">No ODA/ODD correlations detected in your range</p>
                    </div>
                `;
            } else if (matches.length > 0) {
                matchesHtml = `
                    <table class="vf-table vis">
                        <thead>
                            <tr>
                                <th>${twSDK.tt('Attacker')}</th>
                                <th>${twSDK.tt('ODA Change')}</th>
                                <th>${twSDK.tt('Victim')}</th>
                                <th>${twSDK.tt('ODD Change')}</th>
                                <th>Diff</th>
                                <th>${twSDK.tt('Confidence')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${matches.slice(0, 20).map(m => `
                                <tr>
                                    <td><a href="${worldUrl}/guest.php?screen=info_player&id=${m.attackerId}" target="_blank">${m.attackerName}</a></td>
                                    <td class="vf-oda">+${formatNumber(m.odaGain)}</td>
                                    <td><a href="${worldUrl}/guest.php?screen=info_player&id=${m.defenderId}" target="_blank">${m.defenderName}</a></td>
                                    <td class="vf-odd">+${formatNumber(m.oddGain)}</td>
                                    <td>${m.percentDiff.toFixed(1)}%</td>
                                    <td><span class="vf-confidence ${m.confidenceClass}">${twSDK.tt(m.confidence)}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `;
            }

            return statusHtml + headerHtml + matchesHtml;
        }

        // Main scan function
        async function runScan(demoMode = false) {
            // Show loading state
            const loadingContent = `<div class="vf-loading"><div class="vf-spinner"></div>${twSDK.tt('Scanning...')}</div>`;
            jQuery('#vfContent').html(loadingContent);

            let matches = [];
            let isFirstScan = false;

            try {
                if (demoMode || DEMO_MODE) {
                    // Demo mode - use fake data
                    const { odaDeltas, oddDeltas, players } = generateDemoData();
                    matches = findMatches(odaDeltas, oddDeltas, players);
                } else {
                    // Real mode - ONLY fetch kill stats (small files, fast)
                    console.log('[VictimFinder] Fetching kill stats only...');

                    const [odaData, oddData] = await Promise.all([
                        fetchKillData('att'),
                        fetchKillData('def')
                    ]);

                    console.log('[VictimFinder] Kill stats loaded');

                    if (!odaData || !oddData) {
                        jQuery('#vfContent').html(`<div class="vf-error">❌ ${twSDK.tt('Error fetching data')}</div>`);
                        return;
                    }

                    // Get previous data from localStorage
                    const prevOdaData = JSON.parse(localStorage.getItem(STORAGE_KEYS.odaData) || '{}');
                    const prevOddData = JSON.parse(localStorage.getItem(STORAGE_KEYS.oddData) || '{}');

                    if (Object.keys(prevOdaData).length === 0) {
                        isFirstScan = true;
                    }

                    // Calculate deltas (using MIN_CHANGE filter)
                    console.log('[VictimFinder] Calculating deltas...');
                    const odaDeltas = calculateDeltas(odaData, prevOdaData);
                    const oddDeltas = calculateDeltas(oddData, prevOddData);

                    // Find matches using empty player data (will show IDs)
                    console.log('[VictimFinder] Finding matches...');
                    if (!isFirstScan) {
                        matches = findMatchesSimple(odaDeltas, oddDeltas);
                    }

                    // Store current data for next comparison
                    localStorage.setItem(STORAGE_KEYS.odaData, JSON.stringify(odaData));
                    localStorage.setItem(STORAGE_KEYS.oddData, JSON.stringify(oddData));
                    localStorage.setItem(STORAGE_KEYS.lastScan, Date.now().toString());
                    console.log('[VictimFinder] Scan complete!');
                }
            } catch (error) {
                console.error('[VictimFinder] Scan error:', error);
                jQuery('#vfContent').html(`<div class="vf-error">❌ Error: ${error}</div>`);
                return;
            }

            const content = buildContent(
                matches,
                localStorage.getItem(STORAGE_KEYS.lastScan),
                isFirstScan,
                demoMode || DEMO_MODE
            );
            jQuery('#vfContent').html(content);
        }

        // Simple match finder without player data (uses IDs)
        function findMatchesSimple(odaDeltas, oddDeltas, tolerance = 0.25) {
            const matches = [];
            const odaEntries = Object.entries(odaDeltas);
            const oddEntries = Object.entries(oddDeltas);

            console.log(`[VictimFinder] Comparing ${odaEntries.length} ODA changes with ${oddEntries.length} ODD changes`);

            for (const [attackerId, odaGain] of odaEntries) {
                for (const [defenderId, oddGain] of oddEntries) {
                    if (attackerId === defenderId) continue;

                    const diff = Math.abs(odaGain - oddGain);
                    const avg = (odaGain + oddGain) / 2;
                    const percentDiff = diff / avg;

                    if (percentDiff <= tolerance) {
                        let confidence = 'Low';
                        let confidenceClass = 'match-low';

                        if (percentDiff < 0.05) {
                            confidence = 'High';
                            confidenceClass = 'match-high';
                        } else if (percentDiff < 0.15) {
                            confidence = 'Medium';
                            confidenceClass = 'match-medium';
                        }

                        matches.push({
                            attackerId,
                            attackerName: `Player ${attackerId}`,
                            odaGain,
                            defenderId,
                            defenderName: `Player ${defenderId}`,
                            oddGain,
                            percentDiff: percentDiff * 100,
                            confidence,
                            confidenceClass
                        });

                        if (matches.length >= MAX_RESULTS) break;
                    }
                }
                if (matches.length >= MAX_RESULTS) break;
            }

            matches.sort((a, b) => a.percentDiff - b.percentDiff);
            return matches;
        }

        // Clear stored data
        function clearData() {
            localStorage.removeItem(STORAGE_KEYS.odaData);
            localStorage.removeItem(STORAGE_KEYS.oddData);
            localStorage.removeItem(STORAGE_KEYS.lastScan);
            UI.SuccessMessage('Data cleared! Next scan will be a fresh baseline.');
        }

        // Expose functions globally
        window.victimFinderScan = runScan;
        window.victimFinderClear = clearData;

        // Custom styles
        const customStyle = `
            <style>
                .vf-container {
                    max-height: 500px;
                    overflow-y: auto;
                }
                .vf-header {
                    padding: 10px;
                    background: #f4e4bc;
                    border-bottom: 1px solid #c1a264;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 10px;
                }
                .vf-info {
                    display: flex;
                    gap: 15px;
                    font-size: 12px;
                    color: #5d4e37;
                }
                .vf-buttons {
                    display: flex;
                    gap: 5px;
                }
                .vf-btn-primary {
                    background: linear-gradient(to bottom, #6a9e1f 0%, #4a7a0f 100%);
                    color: white;
                }
                .vf-btn-secondary {
                    background: linear-gradient(to bottom, #4a90c2 0%, #2a6090 100%);
                    color: white;
                }
                .vf-btn-danger {
                    background: linear-gradient(to bottom, #c44a4a 0%, #902a2a 100%);
                    color: white;
                }
                .vf-status {
                    padding: 10px;
                    text-align: center;
                    font-weight: bold;
                }
                .vf-status-success {
                    background: #d4edda;
                    color: #155724;
                    border-bottom: 1px solid #c3e6cb;
                }
                .vf-status-info {
                    background: #cce5ff;
                    color: #004085;
                    border-bottom: 1px solid #b8daff;
                }
                .vf-status-demo {
                    background: #fff3cd;
                    color: #856404;
                    border-bottom: 1px solid #ffeeba;
                }
                .vf-table {
                    width: 100%;
                    margin: 0;
                }
                .vf-table th {
                    background: #c1a264;
                    color: #3e2e1e;
                    padding: 8px 5px;
                    text-align: center;
                }
                .vf-table td {
                    padding: 6px 5px;
                    text-align: center;
                }
                .vf-oda {
                    color: #c44a4a;
                    font-weight: bold;
                }
                .vf-odd {
                    color: #b8860b;
                    font-weight: bold;
                }
                .vf-confidence {
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 11px;
                    font-weight: bold;
                }
                .match-high {
                    background: #d4edda;
                    color: #155724;
                }
                .match-medium {
                    background: #fff3cd;
                    color: #856404;
                }
                .match-low {
                    background: #e2e3e5;
                    color: #6c757d;
                }
                .vf-loading {
                    padding: 40px;
                    text-align: center;
                    color: #5d4e37;
                }
                .vf-spinner {
                    width: 30px;
                    height: 30px;
                    border: 3px solid #c1a264;
                    border-top-color: #6a9e1f;
                    border-radius: 50%;
                    margin: 0 auto 15px;
                    animation: vf-spin 1s linear infinite;
                }
                @keyframes vf-spin {
                    to { transform: rotate(360deg); }
                }
                .vf-empty {
                    padding: 40px;
                    text-align: center;
                    color: #5d4e37;
                }
                .vf-empty-icon {
                    font-size: 40px;
                    margin-bottom: 10px;
                    opacity: 0.5;
                }
                .vf-empty-sub {
                    font-size: 12px;
                    color: #8b7355;
                }
                .vf-error {
                    padding: 20px;
                    text-align: center;
                    background: #f8d7da;
                    color: #721c24;
                }
            </style>
        `;

        // Render the widget
        const widgetHtml = `
            ${customStyle}
            <div class="vf-container" id="vfContent">
                <div class="vf-loading"><div class="vf-spinner"></div>${twSDK.tt('Scanning...')}</div>
            </div>
        `;

        twSDK.renderFixedWidget(
            widgetHtml,
            'victimFinderWidget',
            'victim-finder-widget',
            ''
        );

        // Auto-run scan on load
        runScan(DEMO_MODE);
    }
);

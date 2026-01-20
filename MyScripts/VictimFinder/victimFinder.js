/*
 * Victim Finder v8.1
 * Features: High Performance, Canvas Overlays, Polished UX, Quick Rescan
 */

(function () {
    'use strict';

    // 1. Defensive Checks
    if (typeof game_data === 'undefined') {
        alert('Run this inside Tribal Wars!');
        return;
    }

    var world = game_data.world;
    var worldUrl = window.location.origin;
    var myPlayerId = game_data.player.id;
    var isMap = game_data.screen === 'map';

    // Globals
    var SETTINGS_KEY = 'vf_settings_' + world;
    var settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {
        minOda: 100,
        maxResults: 50,
        tolerance: 20,
        range: 30,
        maxDist: 15,
        nobleHrs: 24,
        showOda: true,
        showNobles: true
    };

    var playerNames = {};
    var allVillages = {}; // playerId -> [{x,y,id}]
    var villageLookup = {}; // villageId -> {x,y,pid}
    var myCenter = { x: 500, y: 500 };
    var mapData = []; // [{x, y, type, id}]

    // 2. One-time CSS Injection
    if (!document.getElementById('vfStyle')) {
        var style = document.createElement('style');
        style.id = 'vfStyle';
        style.textContent = `
            #vfPopup {position:fixed;top:50px;right:50px;width:650px;max-height:85vh;overflow-y:auto;background:#202225;color:white;border:2px solid #555;z-index:99999;border-radius:4px;box-shadow:0 4px 20px rgba(0,0,0,0.5);font-family:Verdana,sans-serif;font-size:12px;}
            #vfPopup.minimized {width:auto !important;}
            #vfPopup.minimized .content, #vfPopup.minimized .bar {display:none;}
            #vfPopup h3 {margin:0;padding:10px;background:#32353b;border-bottom:1px solid #444;display:flex;justify-content:space-between;align-items:center;color:#eee;}
            #vfPopup .bar {padding:8px;background:#36393f;border-bottom:1px solid #444;}
            #vfPopup .settings {display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-bottom:8px;background:rgba(0,0,0,0.2);padding:5px;border-radius:4px;}
            #vfPopup .settings label {display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#ddd;}
            #vfPopup .settings input[type=number] {width:50px;padding:2px;border:1px solid #555;border-radius:3px;background:#222;color:white;}
            #vfPopup table {width:100%;border-collapse:collapse;color:#ddd;}
            #vfPopup th, #vfPopup td {padding:4px;border:1px solid #444;text-align:center;font-size:10px;}
            #vfPopup th {background:#2a2c31;}
            #vfPopup tr:hover {background-color:#2f3136;cursor:pointer;}
            #vfPopup .btn {padding:5px 10px;cursor:pointer;border:1px solid #777;border-radius:4px;background:#4a4d53;color:white;margin:2px;font-weight:bold;font-size:11px;}
            #vfPopup .btn:hover {background:#5a5d63;}
            #vfPopup .icon-btn {padding:2px 6px;margin-left:4px;font-size:14px;background:transparent;border:none;color:#aaa;}
            #vfPopup .icon-btn:hover {color:white;background:rgba(255,255,255,0.1);}
            #vfPopup a {color:#4aa3ff;text-decoration:none;}
            #vfPopup a:hover {text-decoration:underline;}
            .vf-legend {display:flex;gap:10px;padding:5px;justify-content:center;font-size:10px;}
            .vf-dot {width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:3px;}
        `;
        document.head.appendChild(style);
    }

    // UI Helpers
    function createPopup() {
        var existing = document.getElementById('vfPopup');
        if (existing) existing.remove();

        var popup = document.createElement('div');
        popup.id = 'vfPopup';
        if (isMap) {
            popup.style.top = '50px';
            popup.style.left = '50px';
            popup.style.width = '350px';
        }
        document.body.appendChild(popup);
        return popup;
    }

    function renderUI(content) {
        var popup = document.getElementById('vfPopup');
        if (!popup) popup = createPopup();

        var settingsHtml = `
            <div class="settings">
                <label>Min ODA <input type="number" id="vfMinOda" value="${settings.minOda}"></label>
                <label>Range <input type="number" id="vfRange" value="${settings.range}"></label>
                <label>Max Dist <input type="number" id="vfMaxDist" value="${settings.maxDist}"></label>
                <label>Noble Hrs <input type="number" id="vfNobleHrs" value="${settings.nobleHrs}"></label>
                <label><input type="checkbox" id="vfShowOda" ${settings.showOda ? 'checked' : ''}> Show ODA</label>
                <label><input type="checkbox" id="vfShowNobles" ${settings.showNobles ? 'checked' : ''}> Show Nobles</label>
            </div>
            <div class="vf-legend">
                <span><span class="vf-dot" style="background:red"></span>Attacker</span>
                <span><span class="vf-dot" style="background:blue"></span>Victim</span>
                <span><span class="vf-dot" style="background:purple"></span>Noble</span>
            </div>
        `;

        popup.innerHTML = `
            <h3>
                <span>⚔️ Victim Finder</span>
                <div>
                    <button class="btn icon-btn" id="vfRefreshBtn" title="Rescan Map">🔄</button>
                    <button class="btn icon-btn" id="vfMinBtn" title="Minimize">_</button>
                    <button class="btn icon-btn" id="vfCloseBtn" title="Close">✖</button>
                </div>
            </h3>
            <div class="bar">
                ${settingsHtml}
                <button class="btn" id="vfScanBtn" style="background:#2d7d46">🔍 Scan Map</button>
                <button class="btn" id="vfClearBtn">🧹 Clear</button>
            </div>
            <div class="content">${content}</div>
        `;

        // Event Listeners
        popup.querySelector('#vfMinBtn').addEventListener('click', () => popup.classList.toggle('minimized'));
        popup.querySelector('#vfRefreshBtn').addEventListener('click', runScan); // Quick Rescan
        popup.querySelector('#vfCloseBtn').addEventListener('click', () => { popup.remove(); removeMapOverlay(); });
        popup.querySelector('#vfScanBtn').addEventListener('click', runScan);
        popup.querySelector('#vfClearBtn').addEventListener('click', () => { clearMapData(); if (window.TWMap) TWMap.reload(); });

        // Settings listeners
        var inputs = popup.querySelectorAll('input');
        inputs.forEach(inp => inp.addEventListener('change', saveSettings));
    }

    function saveSettings() {
        settings.minOda = parseInt(document.getElementById('vfMinOda').value) || 100;
        settings.range = parseInt(document.getElementById('vfRange').value) || 30;
        settings.maxDist = parseInt(document.getElementById('vfMaxDist').value) || 15;
        settings.nobleHrs = parseInt(document.getElementById('vfNobleHrs').value) || 24;
        settings.showOda = document.getElementById('vfShowOda').checked;
        settings.showNobles = document.getElementById('vfShowNobles').checked;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    // Data Fetching
    function fetchData(endpoint) {
        return $.ajax({
            url: worldUrl + '/map/' + endpoint,
            type: 'GET',
            dataType: 'text',
            timeout: 30000
        });
    }

    function parseKillData(data) {
        var result = {};
        data.split('\n').forEach(line => {
            var p = line.split(',');
            if (p.length >= 3) {
                var kills = parseInt(p[2]);
                if (kills > 0) result[p[1]] = kills;
            }
        });
        return result;
    }

    function parseVillageData(data) {
        allVillages = {};
        villageLookup = {};
        var myVills = [];

        data.split('\n').forEach(line => {
            var p = line.split(',');
            if (p.length >= 5) {
                var vid = p[0];
                var x = parseInt(p[2]);
                var y = parseInt(p[3]);
                var pid = p[4];

                var v = { id: vid, x: x, y: y, pid: pid };
                villageLookup[vid] = v;

                if (pid && pid !== '0') {
                    if (!allVillages[pid]) allVillages[pid] = [];
                    allVillages[pid].push(v);
                    if (pid == myPlayerId) myVills.push(v);
                }
            }
        });

        if (myVills.length > 0) {
            var sumX = 0, sumY = 0;
            myVills.forEach(v => { sumX += v.x; sumY += v.y; });
            myCenter = { x: Math.round(sumX / myVills.length), y: Math.round(sumY / myVills.length) };
        }
    }

    function parsePlayerData(data) {
        playerNames = {};
        data.split('\n').forEach(line => {
            var p = line.split(',');
            if (p.length >= 2) playerNames[p[0]] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
        });
    }

    function getDistSq(c1, c2) {
        return (c1.x - c2.x) ** 2 + (c1.y - c2.y) ** 2;
    }

    function getCenter(pid) {
        var vills = allVillages[pid];
        if (!vills) return null;
        var sumX = 0, sumY = 0;
        vills.forEach(v => { sumX += v.x; sumY += v.y });
        return { x: Math.round(sumX / vills.length), y: Math.round(sumY / vills.length) };
    }

    // Core Logic
    function runScan() {
        saveSettings();
        clearMapData();
        renderUI('<p style="text-align:center">⏳ Fetching...</p>');

        var files = [fetchData('player.txt'), fetchData('village.txt')];
        if (settings.showOda) { files.push(fetchData('kill_att.txt')); files.push(fetchData('kill_def.txt')); }
        if (settings.showNobles) { files.push(fetchData('conquer.txt')); }

        Promise.all(files).then(results => {
            renderUI('<p style="text-align:center">⏳ Analyzing...</p>');

            parsePlayerData(results[0]);
            parseVillageData(results[1]);

            var matches = [];
            var recentNobles = [];
            var rangeSq = settings.range * settings.range;
            var maxDistSq = settings.maxDist * settings.maxDist;

            if (settings.showOda) {
                var odaData = parseKillData(results[2]);
                var oddData = parseKillData(results[3]);
                var buckets = {};
                for (var did in oddData) {
                    var val = oddData[did];
                    var bin = Math.floor(val / 1000);
                    if (!buckets[bin]) buckets[bin] = [];
                    buckets[bin].push({ id: did, val: val });
                }

                var tolerance = settings.tolerance / 100;

                for (var aid in odaData) {
                    var oda = odaData[aid];
                    if (oda < settings.minOda) continue;

                    var aCenter = getCenter(aid);
                    if (!aCenter || getDistSq(aCenter, myCenter) > rangeSq) continue;

                    var startBin = Math.floor((oda * (1 - tolerance)) / 1000);
                    var endBin = Math.floor((oda * (1 + tolerance)) / 1000);

                    var bestMatch = null;
                    var bestDistSq = Infinity;

                    for (var b = startBin; b <= endBin; b++) {
                        if (!buckets[b]) continue;
                        buckets[b].forEach(cand => {
                            if (cand.id === aid) return;
                            var diff = Math.abs(oda - cand.val);
                            var pct = diff / Math.max(oda, cand.val);
                            if (pct <= tolerance) {
                                var dCenter = getCenter(cand.id);
                                if (!dCenter) return;
                                var distSq = getDistSq(aCenter, dCenter);
                                if (distSq <= maxDistSq) {
                                    if (distSq < bestDistSq) {
                                        bestDistSq = distSq;
                                        bestMatch = { id: aid, defId: cand.id, odd: cand.val, oda: oda, dist: Math.sqrt(distSq) };
                                    }
                                }
                            }
                        });
                    }
                    if (bestMatch) matches.push(bestMatch);
                }

                matches.sort((a, b) => b.oda - a.oda);

                matches.forEach(m => {
                    if (allVillages[m.id]) allVillages[m.id].forEach(v => mapData.push({ x: v.x, y: v.y, type: 'attacker' }));
                    if (allVillages[m.defId]) allVillages[m.defId].forEach(v => mapData.push({ x: v.x, y: v.y, type: 'victim' }));
                });
            }

            if (settings.showNobles) {
                var conquerIdx = settings.showOda ? 4 : 2;
                if (results[conquerIdx]) {
                    var now = Math.floor(Date.now() / 1000);
                    var limit = now - (settings.nobleHrs * 3600);

                    results[conquerIdx].split('\n').forEach(line => {
                        var p = line.split(',');
                        if (p.length >= 3) {
                            var t = parseInt(p[1]);
                            if (t >= limit) {
                                var vid = p[0];
                                var c = villageLookup[vid];
                                if (c && getDistSq(c, myCenter) <= rangeSq) {
                                    recentNobles.push({
                                        vid: vid, time: t, player: p[2], x: c.x, y: c.y
                                    });
                                    mapData.push({ x: c.x, y: c.y, type: 'noble' });
                                }
                            }
                        }
                    });
                }
            }

            var html = '';
            // Only show detailed table if NOT on map, or if result count is small
            if (matches.length > 0) {
                html += `<p><strong>Matches:</strong> ${matches.length}</p>
                <table><thead><tr><th>Attacker</th><th>ODA</th><th>Victim</th><th>Dist</th></tr></thead><tbody>`;
                matches.slice(0, 30).forEach(m => {
                    var aName = playerNames[m.id] || m.id;
                    var dName = playerNames[m.defId] || m.defId;
                    html += `<tr onclick="window.postMessage({type:'vf_focus', id:'${m.id}'}, '*')">
                        <td><a href="${worldUrl}/game.php?screen=info_player&id=${m.id}" target="_blank">${aName}</a></td>
                        <td>${m.oda.toLocaleString()}</td>
                        <td><a href="${worldUrl}/game.php?screen=info_player&id=${m.defId}" target="_blank">${dName}</a></td>
                        <td>${Math.round(m.dist)}</td>
                    </tr>`;
                });
                html += '</tbody></table>';
            }

            if (recentNobles.length > 0) {
                html += `<p><strong>Nobles (${settings.nobleHrs}h):</strong> ${recentNobles.length}</p>
                 <table><thead><tr><th>Village</th><th>Time</th></tr></thead><tbody>`;
                recentNobles.slice(0, 20).forEach(n => {
                    var d = new Date(n.time * 1000);
                    var timeStr = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
                    var pName = playerNames[n.player] || n.player;
                    html += `<tr onclick="if(window.TWMap) TWMap.focus(${n.x},${n.y})">
                        <td><a href="${worldUrl}/game.php?screen=info_village&id=${n.vid}" target="_blank">${n.x}|${n.y}</a> (${pName})</td>
                        <td>${timeStr}</td>
                     </tr>`;
                });
                html += '</tbody></table>';
            }

            if (!matches.length && !recentNobles.length) html = '<p style="text-align:center;padding:20px">No matches found.</p>';

            renderUI(html);

            if (isMap) {
                initMapHandler();
                if (matches.length || recentNobles.length) document.getElementById('vfPopup').classList.add('minimized');
            } else if (mapData.length > 0) {
                document.querySelector('#vfPopup .content').insertAdjacentHTML('beforeend', '<p><i>Go to Map to see highlights</i></p>');
            }

            window.addEventListener('message', (e) => {
                if (e.data.type === 'vf_focus' && window.TWMap && allVillages[e.data.id]) {
                    var v = allVillages[e.data.id][0];
                    TWMap.focus(v.x, v.y);
                }
            });

        }).catch(err => renderUI(`<p style="color:red">Error: ${err}</p>`));
    }

    // Canvas Implementation
    function removeMapOverlay() {
        mapData = [];
        $('.vf_map_canvas').remove();
        if (window.TWMap) TWMap.reload();
    }

    function clearMapData() {
        mapData = [];
        $('.vf_map_canvas').remove();
    }

    function drawSector(canvas, sector) {
        if (!TWMap.map || !TWMap.map.pixelByCoord || !TWMap.tileSize) return;

        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = 3;

        mapData.forEach(d => {
            var pixel = TWMap.map.pixelByCoord(d.x, d.y);
            var st_pixel = TWMap.map.pixelByCoord(sector.x, sector.y);
            var x = (pixel[0] - st_pixel[0]) + (TWMap.tileSize[0] / 2);
            var y = (pixel[1] - st_pixel[1]) + (TWMap.tileSize[1] / 2);

            if (x < -50 || y < -50 || x > canvas.width + 50 || y > canvas.height + 50) return;

            ctx.beginPath();
            ctx.arc(x, y, 18, 0, 2 * Math.PI);
            if (d.type === 'attacker') {
                ctx.strokeStyle = '#ff0000'; ctx.fillStyle = 'rgba(255,0,0,0.2)';
            } else if (d.type === 'victim') {
                ctx.strokeStyle = '#0000ff'; ctx.fillStyle = 'rgba(0,0,255,0.2)';
            } else {
                ctx.strokeStyle = '#800080'; ctx.fillStyle = 'rgba(128,0,128,0.2)';
            }
            ctx.stroke();
            ctx.fill();
            ctx.closePath();
        });
    }

    function initMapHandler() {
        if (!window.TWMap) return;
        if (TWMap.mapHandler._vfSpawned) { TWMap.reload(); return; }

        var originalSpawn = TWMap.mapHandler.spawnSector;
        TWMap.mapHandler.spawnSector = function (data, sector) {
            originalSpawn.call(TWMap.mapHandler, data, sector);

            var elId = 'vf_canvas_' + sector.x + '_' + sector.y;
            if (!document.getElementById(elId)) {
                var canvas = document.createElement('canvas');
                canvas.id = elId;
                canvas.className = 'vf_map_canvas';
                canvas.style.position = 'absolute';
                canvas.style.zIndex = '10';
                canvas.style.pointerEvents = 'none';
                canvas.width = TWMap.map.scale[0] * TWMap.map.sectorSize;
                canvas.height = TWMap.map.scale[1] * TWMap.map.sectorSize;
                sector.appendElement(canvas, 0, 0);
                drawSector(canvas, sector);
            }
        };
        TWMap.mapHandler._vfSpawned = true;
        TWMap.reload();
    }

    // Start
    renderUI('<p style="text-align:center;padding:10px">Ready to scan.</p>');
    if (mapData.length && isMap) initMapHandler();

})();

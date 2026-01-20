/*
 * Victim Finder v7.0
 * Features: Canvas Map Overlays, Noble Finder, Distance Filter
 */

(function () {
    'use strict';

    if (typeof game_data === 'undefined') {
        alert('Run this inside Tribal Wars!');
        return;
    }

    var world = game_data.world;
    var worldUrl = window.location.origin;
    var myPlayerId = game_data.player.id;
    var isMap = game_data.screen === 'map';

    // Settings
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

    // Data
    var playerNames = {};
    var playerCoords = {};
    var allVillages = {};
    var myCenter = null;
    var mapData = []; // [{x, y, type: 'attacker'|'victim'|'noble'}]

    // Remove old popup
    var old = document.getElementById('vfPopup');
    if (old) old.remove();

    // Create popup
    var popup = document.createElement('div');
    popup.id = 'vfPopup';
    var pos = isMap ? 'top:50px;left:50px' : 'top:50px;right:50px';
    var size = isMap ? 'width:320px' : 'width:650px';
    popup.style.cssText = 'position:fixed;' + pos + ';' + size + ';max-height:85vh;overflow-y:auto;background:#202225;color:white;border:2px solid #555;z-index:99999;border-radius:4px;box-shadow:0 4px 20px rgba(0,0,0,0.5);font-family:Verdana,sans-serif;font-size:12px';
    document.body.appendChild(popup);

    // CSS
    var css = '<style>' +
        '#vfPopup h3{margin:0;padding:10px;background:#32353b;border-bottom:1px solid #444;display:flex;justify-content:space-between;align-items:center;color:#eee}' +
        '#vfPopup .bar{padding:8px;background:#36393f;border-bottom:1px solid #444}' +
        '#vfPopup .settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-bottom:8px;background:rgba(0,0,0,0.2);padding:5px;border-radius:4px}' +
        '#vfPopup .settings label{display:flex;flex-direction:row;justify-content:space-between;align-items:center;font-size:10px;color:#ddd}' +
        '#vfPopup .settings input[type=number]{width:50px;padding:2px;border:1px solid #555;border-radius:3px;background:#222;color:white}' +
        '#vfPopup .content{padding:10px}' +
        '#vfPopup table{width:100%;border-collapse:collapse;color:#ddd}' +
        '#vfPopup th,#vfPopup td{padding:4px;border:1px solid #444;text-align:center;font-size:10px}' +
        '#vfPopup th{background:#2a2c31}' +
        '#vfPopup .btn{padding:5px 10px;cursor:pointer;border:1px solid #777;border-radius:4px;background:#4a4d53;color:white;margin:2px;font-weight:bold;font-size:11px}' +
        '#vfPopup .btn:hover{background:#5a5d63}' +
        '#vfPopup a{color:#4aa3ff;text-decoration:none}' +
        '#vfPopup a:hover{text-decoration:underline}' +
        '</style>';

    function saveSettings() {
        settings.minOda = parseInt(document.getElementById('vfMinOda').value) || 100;
        settings.range = parseInt(document.getElementById('vfRange').value) || 30;
        settings.maxDist = parseInt(document.getElementById('vfMaxDist').value) || 15;
        settings.nobleHrs = parseInt(document.getElementById('vfNobleHrs').value) || 24;
        settings.showOda = document.getElementById('vfShowOda').checked;
        settings.showNobles = document.getElementById('vfShowNobles').checked;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function showUI(content, showSettings) {
        var settingsHtml = '';
        if (showSettings !== false) {
            settingsHtml = '<div class="settings">' +
                '<label>Min ODA <input type="number" id="vfMinOda" value="' + settings.minOda + '"></label>' +
                '<label>Range <input type="number" id="vfRange" value="' + settings.range + '"></label>' +
                '<label>Max Dist <input type="number" id="vfMaxDist" value="' + settings.maxDist + '"></label>' +
                '<label>Noble Hrs <input type="number" id="vfNobleHrs" value="' + settings.nobleHrs + '"></label>' +
                '<label><input type="checkbox" id="vfShowOda" ' + (settings.showOda ? 'checked' : '') + '> Show ODA</label>' +
                '<label><input type="checkbox" id="vfShowNobles" ' + (settings.showNobles ? 'checked' : '') + '> Show Nobles</label>' +
                '</div>';
        }

        var title = isMap ? '⚔️ Setup' : '⚔️ Victim Finder';
        var closeBtn = '<button class="btn" onclick="document.getElementById(\'vfPopup\').style.display=\'none\'">_</button>' +
            '<button class="btn" onclick="document.getElementById(\'vfPopup\').remove();window.vfClearMap()">✖</button>';

        popup.innerHTML = css +
            '<h3><span>' + title + '</span><div>' + closeBtn + '</div></h3>' +
            '<div class="bar">' + settingsHtml +
            '<button class="btn" style="background:#2d7d46" onclick="window.vfScan()">🔍 Scan Map</button>' +
            '<button class="btn" onclick="window.vfClearMap()">🧹 Clear</button>' +
            '</div>' +
            '<div class="content">' + content + '</div>';
    }

    function fetchData(endpoint) {
        return new Promise(function (resolve, reject) {
            $.ajax({
                url: worldUrl + '/map/' + endpoint,
                type: 'GET',
                dataType: 'text',
                timeout: 30000,
                success: function (data) { resolve(data); },
                error: function (xhr, status, err) { reject(err || status); }
            });
        });
    }

    function parseKillData(data) {
        var result = {};
        data.split('\n').forEach(function (line) {
            var p = line.split(',');
            if (p.length >= 3) {
                var id = p[1];
                var kills = parseInt(p[2]) || 0;
                if (kills > 0) result[id] = kills;
            }
        });
        return result;
    }

    function parsePlayerData(data) {
        data.split('\n').forEach(function (line) {
            var p = line.split(',');
            if (p.length >= 2) {
                var id = p[0];
                var name = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
                playerNames[id] = name;
            }
        });
    }

    function parseVillageData(data) {
        data.split('\n').forEach(function (line) {
            var p = line.split(',');
            if (p.length >= 5) {
                var villageId = p[0];
                var x = parseInt(p[2]) || 0;
                var y = parseInt(p[3]) || 0;
                var playerId = p[4];
                if (playerId && playerId !== '0') {
                    if (!allVillages[playerId]) allVillages[playerId] = [];
                    allVillages[playerId].push({ id: villageId, x: x, y: y });
                }
            }
        });

        for (var playerId in allVillages) {
            var vills = allVillages[playerId];
            var sumX = 0, sumY = 0;
            vills.forEach(function (v) { sumX += v.x; sumY += v.y; });
            playerCoords[playerId] = {
                x: Math.round(sumX / vills.length),
                y: Math.round(sumY / vills.length)
            };
        }

        if (playerCoords[myPlayerId]) {
            myCenter = playerCoords[myPlayerId];
        } else {
            myCenter = { x: 500, y: 500 };
        }
    }

    function parseConquers(data) {
        var nobles = [];
        var now = Math.floor(Date.now() / 1000);
        var limit = now - (settings.nobleHrs * 3600);
        data.split('\n').forEach(function (line) {
            var p = line.split(',');
            if (p.length >= 3) {
                var time = parseInt(p[1]);
                if (time >= limit) {
                    nobles.push({
                        vid: p[0],
                        time: time,
                        player: p[2],
                        oldPlayer: p[3]
                    });
                }
            }
        });
        return nobles;
    }

    function getDistance(c1, c2) {
        if (!c1 || !c2) return 9999;
        return Math.sqrt(Math.pow(c1.x - c2.x, 2) + Math.pow(c1.y - c2.y, 2));
    }

    // --- Canvas Map Overlay ---
    function drawMapOverlay(canvas, sector) {
        var ctx = canvas.getContext('2d');
        ctx.lineWidth = 3;

        mapData.forEach(function (item) {
            // Check if village is in this sector
            var x = (item.x * 1000) % 1000;
            // Map coord logic: t[0] is X, t[1] is Y
            var wt_pixel = TWMap.map.pixelByCoord(item.x, item.y);
            var st_pixel = TWMap.map.pixelByCoord(sector.x, sector.y);

            // Calculate relative position (from user's script)
            var px = (wt_pixel[0] - st_pixel[0]) + TWMap.tileSize[0] / 2;
            var py = (wt_pixel[1] - st_pixel[1]) + TWMap.tileSize[1] / 2;

            ctx.beginPath();
            ctx.strokeStyle = item.type === 'attacker' ? '#ff0000' : (item.type === 'victim' ? '#0000ff' : '#800080');
            ctx.fillStyle = item.type === 'attacker' ? 'rgba(255,0,0,0.3)' : (item.type === 'victim' ? 'rgba(0,0,255,0.3)' : 'rgba(128,0,128,0.3)');

            // Draw circle
            ctx.arc(px, py, 15, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.fill();
            ctx.closePath();
        });
    }

    function initMapHandler() {
        if (!window.TWMap) return;

        // Hook spawnSector if not already hooked
        if (!TWMap.mapHandler._vfSpawnSector) {
            TWMap.mapHandler._vfSpawnSector = TWMap.mapHandler.spawnSector;
            TWMap.mapHandler.spawnSector = function (data, sector) {
                TWMap.mapHandler._vfSpawnSector(data, sector);

                // Create overlay canvas if not exists
                var el = $('#vf_canvas_' + sector.x + '_' + sector.y);
                if (!el.length) {
                    var canvas = document.createElement('canvas');
                    canvas.style.position = 'absolute';
                    canvas.width = (TWMap.map.scale[0] * TWMap.map.sectorSize);
                    canvas.height = (TWMap.map.scale[1] * TWMap.map.sectorSize);
                    canvas.style.zIndex = 20; // High z-index
                    canvas.className = 'vf_map_canvas';
                    canvas.id = 'vf_canvas_' + sector.x + '_' + sector.y;

                    // Prevent blocking clicks
                    canvas.style.pointerEvents = 'none';

                    sector.appendElement(canvas, 0, 0);
                    drawMapOverlay(canvas, sector);
                }
            };
        }
        TWMap.reload();
    }

    window.vfClearMap = function () {
        mapData = [];
        $('.vf_map_canvas').remove();
        if (window.TWMap) TWMap.reload();
    };

    window.vfScan = function () {
        saveSettings();
        window.vfClearMap();

        var files = [
            fetchData('player.txt'),
            fetchData('village.txt')
        ];

        if (settings.showOda) {
            files.push(fetchData('kill_att.txt'));
            files.push(fetchData('kill_def.txt'));
        }

        if (settings.showNobles) {
            files.push(fetchData('conquer.txt'));
        }

        showUI('<p style="text-align:center">⏳ Fetching...</p>', false);

        Promise.all(files).then(function (results) {
            showUI('<p style="text-align:center">⏳ Analyzing...</p>', false);

            parsePlayerData(results[0]);
            parseVillageData(results[1]);

            var matches = [];
            var recentNobles = [];
            var text = '';

            // --- ODA/ODD ---
            if (settings.showOda) {
                var odaData = parseKillData(results[2]);
                var oddData = parseKillData(results[3]);
                var tolerance = settings.tolerance / 100;

                for (var attId in odaData) {
                    var oda = odaData[attId];
                    if (oda < settings.minOda) continue;
                    if (getDistance(playerCoords[attId], myCenter) > settings.range) continue;

                    var bestMatch = null;
                    var bestDist = Infinity;

                    for (var defId in oddData) {
                        if (attId === defId) continue;

                        var odd = oddData[defId];
                        var diff = Math.abs(oda - odd);
                        var pct = diff / Math.max(oda, odd);

                        if (pct <= tolerance) {
                            var dist = getDistance(playerCoords[attId], playerCoords[defId]);
                            if (dist <= settings.maxDist) {
                                if (dist < bestDist) {
                                    bestDist = dist;
                                    bestMatch = { id: attId, defId: defId, odd: odd, oda: oda, dist: Math.round(dist) };
                                }
                            }
                        }
                    }
                    if (bestMatch) matches.push(bestMatch);
                }

                matches.sort(function (a, b) { return b.oda - a.oda; });
                text += '<p><strong>Matches:</strong> ' + matches.length + '</p>';

                // Add to Map Data
                matches.forEach(function (m) {
                    if (allVillages[m.id]) allVillages[m.id].forEach(v => mapData.push({ x: v.x, y: v.y, type: 'attacker' }));
                    if (allVillages[m.defId]) allVillages[m.defId].forEach(v => mapData.push({ x: v.x, y: v.y, type: 'victim' }));
                });

                // Show table
                var html = '<table><thead><tr><th>Attacker</th><th>ODA</th><th>Victim</th><th>Dist</th></tr></thead><tbody>';
                matches.slice(0, 20).forEach(function (m) {
                    html += '<tr>' +
                        '<td><a href="' + worldUrl + '/game.php?screen=info_player&id=' + m.id + '" target="_blank">' + playerNames[m.id] + '</a></td>' +
                        '<td>' + m.oda.toLocaleString() + '</td>' +
                        '<td><a href="' + worldUrl + '/game.php?screen=info_player&id=' + m.defId + '" target="_blank">' + playerNames[m.defId] + '</a></td>' +
                        '<td>' + m.dist + '</td></tr>';
                });
                html += '</tbody></table>';
                text += html;
            }

            // --- Nobles ---
            if (settings.showNobles) {
                var conquerIndex = settings.showOda ? 4 : 2;
                if (results[conquerIndex]) {
                    var allNobles = parseConquers(results[conquerIndex]);
                    var villCoords = {};
                    for (var pid in allVillages) {
                        allVillages[pid].forEach(function (v) { villCoords[v.id] = { x: v.x, y: v.y }; });
                    }

                    allNobles.forEach(function (n) {
                        // We need village coords for filtering
                        // If we parsed village.txt, we can look up by ID?
                        // Actually allVillages is by player. Need a flat lookup or re-parse.
                        // Optimization: Build coord map earlier.
                        // For now, noble detection requires coord check. 
                        // But wait! village.txt gives coords for ALL villages.
                        // I will create a quick lookup map.
                    });

                    // Quick village coord lookup
                    var vidToCoord = {};
                    results[1].split('\n').forEach(function (line) {
                        var p = line.split(',');
                        if (p.length >= 4) vidToCoord[p[0]] = { x: parseInt(p[2]), y: parseInt(p[3]) };
                    });

                    recentNobles = allNobles.filter(function (n) {
                        var c = vidToCoord[n.vid];
                        if (c && getDistance(c, myCenter) <= settings.range) {
                            n.x = c.x; n.y = c.y;
                            return true;
                        }
                        return false;
                    });

                    text += '<p><strong>Nobles (' + settings.nobleHrs + 'h):</strong> ' + recentNobles.length + '</p>';

                    // Add to Map Data
                    recentNobles.forEach(function (n) {
                        mapData.push({ x: n.x, y: n.y, type: 'noble' });
                    });

                    var html = '<table><thead><tr><th>Village</th><th>Owner</th><th>Time</th></tr></thead><tbody>';
                    recentNobles.slice(0, 20).forEach(function (n) {
                        var date = new Date(n.time * 1000);
                        var timeStr = date.getHours() + ':' + (date.getMinutes() < 10 ? '0' : '') + date.getMinutes();
                        html += '<tr><td><a href="' + worldUrl + '/game.php?screen=info_village&id=' + n.vid + '" target="_blank">' + n.vid + '</a></td>' +
                            '<td>' + playerNames[n.player] + '</td><td>' + timeStr + '</td></tr>';
                    });
                    html += '</tbody></table>';
                    text += html;
                }
            }

            showUI(text);

            if (isMap) {
                initMapHandler();
            } else if (mapData.length > 0) {
                $('<p><i>Go to Map to see highlights</i></p>').appendTo('#vfPopup .content');
            }

        }).catch(function (err) {
            showUI('<p style="color:red">❌ Error: ' + err + '</p>');
        });
    };

    // Initial State
    showUI('<p>Ready. dark UI loaded.</p>');

})();

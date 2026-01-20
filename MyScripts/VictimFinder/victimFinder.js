/*
 * Victim Finder v6.0
 * Features: Noble Finder, Map Integration, Strict Distance Filter
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
        maxDist: 15, // Max distance between attacker and victim
        nobleHrs: 24, // Look for nobles in last X hours
        showOda: true,
        showNobles: true
    };

    // Data
    var playerNames = {};
    var playerCoords = {};
    var allVillages = {};
    var myCenter = null;

    // Remove old popup
    var old = document.getElementById('vfPopup');
    if (old) old.remove();

    // Create popup (minimized if on map)
    var popup = document.createElement('div');
    popup.id = 'vfPopup';
    var pos = isMap ? 'top:50px;left:50px' : 'top:50px;right:50px';
    var size = isMap ? 'width:300px' : 'width:650px';
    popup.style.cssText = 'position:fixed;' + pos + ';' + size + ';max-height:85vh;overflow-y:auto;background:#f4e4bc;border:2px solid #7d510f;z-index:99999;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);font-family:Verdana,sans-serif;font-size:12px';
    document.body.appendChild(popup);

    // CSS
    var css = '<style>' +
        '#vfPopup h3{margin:0;padding:10px;background:#c1a264;border-radius:6px 6px 0 0;display:flex;justify-content:space-between;align-items:center}' +
        '#vfPopup .bar{padding:8px;background:#e8d4a8;border-bottom:1px solid #c1a264}' +
        '#vfPopup .settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;margin-bottom:8px;background:rgba(255,255,255,0.3);padding:5px;border-radius:4px}' +
        '#vfPopup .settings label{display:flex;flex-direction:row;justify-content:space-between;align-items:center;font-size:10px}' +
        '#vfPopup .settings input[type=number]{width:50px;padding:2px;border:1px solid #c1a264;border-radius:3px}' +
        '#vfPopup .content{padding:10px}' +
        '#vfPopup table{width:100%;border-collapse:collapse}' +
        '#vfPopup th,#vfPopup td{padding:4px;border:1px solid #c1a264;text-align:center;font-size:10px}' +
        '#vfPopup th{background:#c1a264}' +
        '#vfPopup .btn{padding:5px 10px;cursor:pointer;border:1px solid #7d510f;border-radius:4px;background:linear-gradient(#f4e4bc,#d4c49c);margin:2px;font-weight:bold;font-size:11px}' +
        '.vf-attacker{background:rgba(255,0,0,0.4)!important;border:2px solid red!important;box-shadow:0 0 10px red!important}' +
        '.vf-victim{background:rgba(0,100,255,0.4)!important;border:2px solid blue!important;box-shadow:0 0 10px blue!important}' +
        '.vf-noble{background:rgba(148,0,211,0.4)!important;border:2px solid purple!important;box-shadow:0 0 15px purple!important}' +
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
                '<label>Range (You) <input type="number" id="vfRange" value="' + settings.range + '"></label>' +
                '<label>Max Dist (A-V) <input type="number" id="vfMaxDist" value="' + settings.maxDist + '"></label>' +
                '<label>Noble Hrs <input type="number" id="vfNobleHrs" value="' + settings.nobleHrs + '"></label>' +
                '<label><input type="checkbox" id="vfShowOda" ' + (settings.showOda ? 'checked' : '') + '> Show ODA</label>' +
                '<label><input type="checkbox" id="vfShowNobles" ' + (settings.showNobles ? 'checked' : '') + '> Show Nobles</label>' +
                '</div>';
        }

        var title = isMap ? '⚔️ Setup' : '⚔️ Victim Finder';
        var closeBtn = '<button class="btn" onclick="document.getElementById(\'vfPopup\').style.display=\'none\'">_</button>' +
            '<button class="btn" onclick="document.getElementById(\'vfPopup\').remove();window.vfClearHighlights()">✖</button>';

        popup.innerHTML = css +
            '<h3><span>' + title + '</span><div>' + closeBtn + '</div></h3>' +
            '<div class="bar">' + settingsHtml +
            '<button class="btn" onclick="window.vfScan()">🔍 Scan Map</button>' +
            '<button class="btn" onclick="window.vfClearHighlights()">🧹 Clear</button>' +
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

        // Calculate center for each player
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
            // Fallback if no center found
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
                var villageId = p[0];
                var time = parseInt(p[1]);
                var newPlayerId = p[2];
                var oldPlayerId = p[3];

                if (time >= limit) {
                    nobles.push({
                        vid: villageId,
                        time: time,
                        player: newPlayerId,
                        oldPlayer: oldPlayerId
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

    function getDistanceFromMe(coord) {
        return getDistance(coord, myCenter);
    }

    window.vfHighlight = function (ids, type) {
        var cls = 'vf-' + type; // attacker, victim, noble

        ids.forEach(function (id) {
            // Support both village IDs and Player IDs (highlights all villages)
            if (type === 'noble') {
                // ID is village ID
                var el = document.querySelector('[data-village-id="' + id + '"]') ||
                    document.querySelector('#map_village_' + id) ||
                    document.querySelector('.village_' + id);
                if (el) el.classList.add(cls);
            } else {
                // ID is player ID
                var vills = allVillages[id] || [];
                vills.forEach(function (v) {
                    var el = document.querySelector('[data-village-id="' + v.id + '"]') ||
                        document.querySelector('#map_village_' + v.id) ||
                        document.querySelector('.village_' + v.id);
                    if (el) el.classList.add(cls);
                });
            }
        });
    };

    window.vfClearHighlights = function () {
        ['vf-attacker', 'vf-victim', 'vf-noble'].forEach(function (cls) {
            document.querySelectorAll('.' + cls).forEach(function (el) { el.classList.remove(cls); });
        });
    };

    window.vfScan = function () {
        saveSettings();
        if (isMap) window.vfClearHighlights();

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

        showUI('<p style="text-align:center">⏳ Fetching data...</p>', false);

        Promise.all(files).then(function (results) {
            showUI('<p style="text-align:center">⏳ Analyzing...</p>', false);

            parsePlayerData(results[0]);
            parseVillageData(results[1]);

            var matches = [];
            var recentNobles = [];
            var text = '';

            // --- ODA/ODD Logic ---
            if (settings.showOda) {
                var odaData = parseKillData(results[2]);
                var oddData = parseKillData(results[3]);
                var tolerance = settings.tolerance / 100;

                for (var attId in odaData) {
                    var oda = odaData[attId];
                    if (oda < settings.minOda) continue;
                    if (getDistanceFromMe(playerCoords[attId]) > settings.range) continue;

                    var bestMatch = null;
                    var bestDist = Infinity;

                    for (var defId in oddData) {
                        if (attId === defId) continue;

                        var odd = oddData[defId];
                        var diff = Math.abs(oda - odd);
                        var pct = diff / Math.max(oda, odd);

                        if (pct <= tolerance) {
                            var dist = getDistance(playerCoords[attId], playerCoords[defId]);
                            // Strict distance filter between attacker and victim
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

                // Sort by ODA size (activity)
                matches.sort(function (a, b) { return b.oda - a.oda; });
                text += '<p><strong>ODA/ODD Pairs:</strong> ' + matches.length + '</p>';

                // Highlight on map
                if (isMap) {
                    matches.forEach(function (m) {
                        window.vfHighlight([m.id], 'attacker');
                        window.vfHighlight([m.defId], 'victim');
                    });
                    if (matches.length > 0) text += '<p style="color:green">Highlighted on map!</p>';
                } else {
                    // Show table if not on map
                    var html = '<table><thead><tr><th>Attacker</th><th>ODA</th><th>Victim</th><th>Dist</th></tr></thead><tbody>';
                    matches.slice(0, 20).forEach(function (m) {
                        html += '<tr><td>' + playerNames[m.id] + '</td><td>' + m.oda.toLocaleString() + '</td><td>' + playerNames[m.defId] + '</td><td>' + m.dist + '</td></tr>';
                    });
                    html += '</tbody></table>';
                    text += html;
                }
            }

            // --- Noble Logic ---
            if (settings.showNobles) {
                // Adjust index based on whether ODA was fetched (offset 2 vs offset 4)
                var conquerIndex = settings.showOda ? 4 : 2;
                if (results[conquerIndex]) {
                    var allNobles = parseConquers(results[conquerIndex]);

                    // Filter by location (village coord lookup)
                    // We need to build a map of villageId -> coord from village.txt parsing
                    var villCoords = {};
                    for (var pid in allVillages) {
                        allVillages[pid].forEach(function (v) {
                            villCoords[v.id] = { x: v.x, y: v.y };
                        });
                    }

                    allNobles.forEach(function (n) {
                        var c = villCoords[n.vid];
                        if (c && getDistanceFromMe(c) <= settings.range) {
                            recentNobles.push(n);
                        }
                    });

                    text += '<p><strong>Recent Nobles (' + settings.nobleHrs + 'h):</strong> ' + recentNobles.length + '</p>';

                    if (isMap) {
                        var nobleVids = recentNobles.map(function (n) { return n.vid; });
                        window.vfHighlight(nobleVids, 'noble');
                    } else {
                        var html = '<table><thead><tr><th>Village</th><th>New Owner</th><th>Time</th></tr></thead><tbody>';
                        recentNobles.slice(0, 20).forEach(function (n) {
                            var date = new Date(n.time * 1000);
                            var timeStr = date.getHours() + ':' + (date.getMinutes() < 10 ? '0' : '') + date.getMinutes();
                            html += '<tr><td>' + n.vid + '</td><td>' + playerNames[n.player] + '</td><td>' + timeStr + '</td></tr>';
                        });
                        html += '</tbody></table>';
                        text += html;
                    }
                }
            }

            showUI(text);

        }).catch(function (err) {
            showUI('<p style="color:red">❌ Error: ' + err + '</p>');
        });
    };

    // Initial State
    showUI('<p>Ready.</p>');

})();

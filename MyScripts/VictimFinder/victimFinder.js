/*
 * Victim Finder v6.1
 * Features: Fixed Map Highlights & Clickable Links
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

    // Remove old popup
    var old = document.getElementById('vfPopup');
    if (old) old.remove();

    // Create popup
    var popup = document.createElement('div');
    popup.id = 'vfPopup';
    var pos = isMap ? 'top:50px;left:50px' : 'top:50px;right:50px';
    var size = isMap ? 'width:320px' : 'width:650px';
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
        '#vfPopup a{color:#603000;text-decoration:none;font-weight:bold}' +
        '#vfPopup a:hover{text-decoration:underline}' +
        // Map Highlights
        '.vf-attacker{outline: 3px solid red !important; z-index: 10 !important; background-color: rgba(255, 0, 0, 0.5) !important;}' +
        '.vf-victim{outline: 3px solid blue !important; z-index: 10 !important; background-color: rgba(0, 0, 255, 0.5) !important;}' +
        '.vf-noble{outline: 3px solid purple !important; z-index: 10 !important; background-color: rgba(128, 0, 128, 0.5) !important;}' +
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

    // ... Parsing functions same as before ...
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

    window.vfHighlight = function (ids, type) {
        if (!game_data.screen === 'map') return;

        var cls = 'vf-' + type;

        // Helper to highlight a specific village element
        function highlightEl(vid) {
            // New Map (TWMap.villages)
            if (window.TWMap && window.TWMap.villages) {
                var v = window.TWMap.villages[vid];
                if (v) {
                    // We can't easily style the canvas, but we can append an overlay
                    if (!document.getElementById('vf_overlay_' + vid)) {
                        var overlay = document.createElement('div');
                        overlay.id = 'vf_overlay_' + vid;
                        overlay.className = cls;
                        overlay.style.position = 'absolute';
                        overlay.style.width = '50px'; // Approx width
                        overlay.style.height = '35px'; // Approx height
                        // Coordinates need to be calculated or hooked. 
                        // EASIER: Target DOM elements if they exist (old map / mobile / certain browsers)
                    }
                }
            }

            // Try standard DOM selectors used in various map versions/scripts
            var el = document.getElementById('map_village_' + vid);
            if (!el) el = document.querySelector('.village_map_village_' + vid); // Some versions
            if (!el) el = document.querySelector('div[data-village-id="' + vid + '"]'); // Newer

            if (el) {
                el.classList.add(cls);
                // Force style if class doesn't take priority
                el.style.outline = (type === 'attacker' ? '3px solid red' : type === 'victim' ? '3px solid blue' : '3px solid purple');
                el.style.zIndex = '20';
            }

            // Try targeting the overlay images (often ID map_village_ID_img)
            var img = document.getElementById('map_village_' + vid + '_img');
            if (img) {
                img.style.outline = (type === 'attacker' ? '3px solid red' : type === 'victim' ? '3px solid blue' : '3px solid purple');
            }
        }

        ids.forEach(function (id) {
            if (type === 'noble') {
                highlightEl(id);
            } else {
                var vills = allVillages[id] || [];
                vills.forEach(function (v) { highlightEl(v.id); });
            }
        });
    };

    window.vfClearHighlights = function () {
        ['vf-attacker', 'vf-victim', 'vf-noble'].forEach(function (cls) {
            document.querySelectorAll('.' + cls).forEach(function (el) {
                el.classList.remove(cls);
                el.style.outline = ''; // Remove inline style too
            });
        });
        // Clear manual image outlines
        document.querySelectorAll('img[id^="map_village_"]').forEach(function (img) {
            img.style.outline = '';
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

                if (isMap) {
                    matches.forEach(function (m) {
                        window.vfHighlight([m.id], 'attacker');
                        window.vfHighlight([m.defId], 'victim');
                    });
                } else {
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
                        var c = villCoords[n.vid];
                        if (c && getDistance(c, myCenter) <= settings.range) {
                            recentNobles.push(n);
                        }
                    });

                    text += '<p><strong>Nobles (' + settings.nobleHrs + 'h):</strong> ' + recentNobles.length + '</p>';

                    if (isMap) {
                        var nobleVids = recentNobles.map(function (n) { return n.vid; });
                        window.vfHighlight(nobleVids, 'noble');
                    } else {
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
            }

            if (isMap && (matches.length > 0 || recentNobles.length > 0)) {
                text += '<p style="color:green;font-weight:bold">Map Updated!</p>';
            }

            showUI(text);

        }).catch(function (err) {
            showUI('<p style="color:red">❌ Error: ' + err + '</p>');
        });
    };

    // Initial State
    showUI('<p>Ready.</p>');

})();

/*
 * Victim Finder v5.0
 * Compares ODA vs ODD, filtered by range, sorted by distance
 * Features: Range filter, distance sorting, player names, map highlighting
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

    // Settings
    var SETTINGS_KEY = 'vf_settings_' + world;
    var settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {
        minOda: 100,
        maxResults: 50,
        tolerance: 20,
        range: 50,
        useRange: true
    };

    // Data storage
    var playerNames = {};
    var playerCoords = {};  // playerId -> {x, y} (average of all villages)
    var allVillages = {};   // playerId -> [{x, y, id}]
    var myCenter = null;

    // Remove old popup
    var old = document.getElementById('vfPopup');
    if (old) old.remove();

    // Create popup
    var popup = document.createElement('div');
    popup.id = 'vfPopup';
    popup.style.cssText = 'position:fixed;top:50px;right:50px;width:650px;max-height:85vh;overflow-y:auto;background:#f4e4bc;border:2px solid #7d510f;z-index:99999;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);font-family:Verdana,sans-serif;font-size:12px';
    document.body.appendChild(popup);

    var css = '<style>' +
        '#vfPopup h3{margin:0;padding:10px;background:#c1a264;border-radius:6px 6px 0 0;display:flex;justify-content:space-between}' +
        '#vfPopup .bar{padding:8px;background:#e8d4a8;border-bottom:1px solid #c1a264}' +
        '#vfPopup .settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:6px;margin-bottom:8px}' +
        '#vfPopup .settings label{display:flex;flex-direction:column;font-size:10px}' +
        '#vfPopup .settings input[type=number]{width:100%;padding:3px;border:1px solid #c1a264;border-radius:3px}' +
        '#vfPopup .content{padding:10px}' +
        '#vfPopup table{width:100%;border-collapse:collapse}' +
        '#vfPopup th,#vfPopup td{padding:4px;border:1px solid #c1a264;text-align:center;font-size:10px}' +
        '#vfPopup th{background:#c1a264}' +
        '#vfPopup .btn{padding:5px 10px;cursor:pointer;border:1px solid #7d510f;border-radius:4px;background:linear-gradient(#f4e4bc,#d4c49c);margin:2px}' +
        '#vfPopup .high{color:#155724;font-weight:bold}' +
        '#vfPopup .med{color:#856404;font-weight:bold}' +
        '#vfPopup .low{color:#6c757d}' +
        '#vfPopup a{color:#603000}' +
        '.vf-attacker{background:rgba(255,0,0,0.3)!important;border:2px solid red!important}' +
        '.vf-victim{background:rgba(0,0,255,0.3)!important;border:2px solid blue!important}' +
        '</style>';

    function saveSettings() {
        settings.minOda = parseInt(document.getElementById('vfMinOda').value) || 100;
        settings.maxResults = parseInt(document.getElementById('vfMaxResults').value) || 50;
        settings.tolerance = parseInt(document.getElementById('vfTolerance').value) || 20;
        settings.range = parseInt(document.getElementById('vfRange').value) || 50;
        settings.useRange = document.getElementById('vfUseRange').checked;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    function showUI(content, showSettings) {
        var centerInfo = myCenter ? ' (Your center: ' + myCenter.x + '|' + myCenter.y + ')' : '';
        var settingsHtml = '';
        if (showSettings !== false) {
            settingsHtml = '<div class="settings">' +
                '<label>Min ODA<input type="number" id="vfMinOda" value="' + settings.minOda + '"></label>' +
                '<label>Max Results<input type="number" id="vfMaxResults" value="' + settings.maxResults + '"></label>' +
                '<label>Tolerance %<input type="number" id="vfTolerance" value="' + settings.tolerance + '"></label>' +
                '<label>Range<input type="number" id="vfRange" value="' + settings.range + '"></label>' +
                '<label style="flex-direction:row;align-items:center;gap:5px"><input type="checkbox" id="vfUseRange" ' + (settings.useRange ? 'checked' : '') + '> Range filter' + centerInfo + '</label>' +
                '</div>';
        }

        popup.innerHTML = css +
            '<h3><span>⚔️ Victim Finder v5.0</span><button class="btn" onclick="document.getElementById(\'vfPopup\').remove();window.vfClearHighlights()">✖</button></h3>' +
            '<div class="bar">' + settingsHtml +
            '<button class="btn" onclick="window.vfScan()">🔍 Find Matches</button>' +
            '<button class="btn" onclick="window.vfClearHighlights()">🧹 Clear Highlights</button>' +
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
        // Collect all villages per player
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

        // Calculate center (average) for each player
        for (var playerId in allVillages) {
            var vills = allVillages[playerId];
            var sumX = 0, sumY = 0;
            vills.forEach(function (v) { sumX += v.x; sumY += v.y; });
            playerCoords[playerId] = {
                x: Math.round(sumX / vills.length),
                y: Math.round(sumY / vills.length)
            };
        }

        // Set my center
        if (playerCoords[myPlayerId]) {
            myCenter = playerCoords[myPlayerId];
        }
    }

    function getDistance(id1, id2) {
        var c1 = playerCoords[id1];
        var c2 = playerCoords[id2];
        if (!c1 || !c2) return 9999;
        return Math.sqrt(Math.pow(c1.x - c2.x, 2) + Math.pow(c1.y - c2.y, 2));
    }

    function getDistanceFromMe(id) {
        if (!myCenter) return 9999;
        var c = playerCoords[id];
        if (!c) return 9999;
        return Math.sqrt(Math.pow(c.x - myCenter.x, 2) + Math.pow(c.y - myCenter.y, 2));
    }

    function isInRange(playerId) {
        if (!settings.useRange || !myCenter) return true;
        return getDistanceFromMe(playerId) <= settings.range;
    }

    function getName(id) {
        return playerNames[id] || ('ID:' + id);
    }

    function getCoordStr(id) {
        var c = playerCoords[id];
        return c ? (c.x + '|' + c.y) : '?';
    }

    // Highlight villages on map
    window.vfHighlight = function (attId, defId) {
        window.vfClearHighlights();

        // Add CSS for highlighting
        var style = document.createElement('style');
        style.id = 'vfHighlightStyle';
        style.textContent = '.vf-attacker{background:rgba(255,0,0,0.4)!important;border:2px solid red!important;box-shadow:0 0 10px red!important}' +
            '.vf-victim{background:rgba(0,100,255,0.4)!important;border:2px solid blue!important;box-shadow:0 0 10px blue!important}';
        document.head.appendChild(style);

        // Find and highlight village elements on map
        var attVills = allVillages[attId] || [];
        var defVills = allVillages[defId] || [];

        attVills.forEach(function (v) {
            var el = document.querySelector('[data-village-id="' + v.id + '"]') ||
                document.querySelector('#map_village_' + v.id) ||
                document.querySelector('.village_' + v.id);
            if (el) el.classList.add('vf-attacker');
        });

        defVills.forEach(function (v) {
            var el = document.querySelector('[data-village-id="' + v.id + '"]') ||
                document.querySelector('#map_village_' + v.id) ||
                document.querySelector('.village_' + v.id);
            if (el) el.classList.add('vf-victim');
        });

        alert('Highlighted: ' + getName(attId) + ' (red) attacking ' + getName(defId) + ' (blue)');
    };

    window.vfClearHighlights = function () {
        document.querySelectorAll('.vf-attacker').forEach(function (el) { el.classList.remove('vf-attacker'); });
        document.querySelectorAll('.vf-victim').forEach(function (el) { el.classList.remove('vf-victim'); });
        var style = document.getElementById('vfHighlightStyle');
        if (style) style.remove();
    };

    window.vfScan = function () {
        saveSettings();
        showUI('<p style="text-align:center">⏳ Loading data...</p>', false);

        Promise.all([
            fetchData('kill_att.txt'),
            fetchData('kill_def.txt'),
            fetchData('player.txt'),
            fetchData('village.txt')
        ]).then(function (results) {
            showUI('<p style="text-align:center">⏳ Processing...</p>', false);

            var odaData = parseKillData(results[0]);
            var oddData = parseKillData(results[1]);
            parsePlayerData(results[2]);
            parseVillageData(results[3]);

            var matches = [];
            var tolerance = settings.tolerance / 100;

            // Find matches
            for (var attId in odaData) {
                var oda = odaData[attId];
                if (oda < settings.minOda) continue;
                if (!isInRange(attId)) continue;

                var bestMatch = null;
                var bestDist = Infinity;

                for (var defId in oddData) {
                    if (attId === defId) continue;
                    if (!isInRange(defId)) continue;

                    var odd = oddData[defId];
                    var diff = Math.abs(oda - odd);
                    var pct = diff / Math.max(oda, odd);

                    if (pct <= tolerance) {
                        var dist = getDistance(attId, defId);
                        // Pick closest match for this attacker
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestMatch = {
                                attId: attId,
                                attName: getName(attId),
                                attCoord: getCoordStr(attId),
                                oda: oda,
                                defId: defId,
                                defName: getName(defId),
                                defCoord: getCoordStr(defId),
                                odd: odd,
                                pct: pct * 100,
                                dist: Math.round(dist),
                                distFromMe: Math.round(getDistanceFromMe(defId)),
                                conf: pct < 0.05 ? 'high' : pct < 0.10 ? 'med' : 'low'
                            };
                        }
                    }
                }

                if (bestMatch) matches.push(bestMatch);
            }

            // Sort by distance from me (closest first)
            matches.sort(function (a, b) { return a.distFromMe - b.distFromMe; });
            matches = matches.slice(0, settings.maxResults);

            if (matches.length === 0) {
                showUI('<p style="text-align:center;padding:20px">No matches found within range.<br>Your center: ' + (myCenter ? myCenter.x + '|' + myCenter.y : 'unknown') + '</p>');
                return;
            }

            var html = '<p>Found ' + matches.length + ' matches (sorted by distance from you):</p>' +
                '<table><thead><tr>' +
                '<th>Attacker</th><th>Coord</th><th>ODA</th><th>Victim</th><th>Coord</th><th>ODD</th><th>Dist</th><th>Conf</th><th>Map</th>' +
                '</tr></thead><tbody>';

            matches.forEach(function (m) {
                html += '<tr>' +
                    '<td><a href="' + worldUrl + '/guest.php?screen=info_player&id=' + m.attId + '" target="_blank">' + m.attName + '</a></td>' +
                    '<td>' + m.attCoord + '</td>' +
                    '<td style="color:#c44a4a">' + m.oda.toLocaleString() + '</td>' +
                    '<td><a href="' + worldUrl + '/guest.php?screen=info_player&id=' + m.defId + '" target="_blank">' + m.defName + '</a></td>' +
                    '<td>' + m.defCoord + '</td>' +
                    '<td style="color:#b8860b">' + m.odd.toLocaleString() + '</td>' +
                    '<td>' + m.dist + '</td>' +
                    '<td class="' + m.conf + '">' + m.conf.toUpperCase() + '</td>' +
                    '<td><button class="btn" onclick="window.vfHighlight(\'' + m.attId + '\',\'' + m.defId + '\')">🗺️</button></td>' +
                    '</tr>';
            });
            html += '</tbody></table>';

            showUI(html);

        }).catch(function (err) {
            showUI('<p style="color:red">❌ Error: ' + err + '</p>');
        });
    };

    // Initial UI
    showUI('<p style="text-align:center;padding:15px">Configure settings and click <strong>Find Matches</strong></p>');

})();

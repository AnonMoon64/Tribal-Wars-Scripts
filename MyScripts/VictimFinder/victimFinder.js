/*
 * Victim Finder v4.0
 * Compares ODA vs ODD to find attacker/victim pairs
 * Features: Range filter, player names, editable settings
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

    // Default settings (saved in localStorage)
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
    var playerCoords = {};  // playerId -> {x, y} (first village coords)
    var myCoords = null;

    // Remove old popup
    var old = document.getElementById('vfPopup');
    if (old) old.remove();

    // Create popup
    var popup = document.createElement('div');
    popup.id = 'vfPopup';
    popup.style.cssText = 'position:fixed;top:50px;right:50px;width:600px;max-height:85vh;overflow-y:auto;background:#f4e4bc;border:2px solid #7d510f;z-index:99999;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);font-family:Verdana,sans-serif;font-size:12px';
    document.body.appendChild(popup);

    var css = '<style>' +
        '#vfPopup h3{margin:0;padding:10px;background:#c1a264;border-radius:6px 6px 0 0;display:flex;justify-content:space-between}' +
        '#vfPopup .bar{padding:8px;background:#e8d4a8;border-bottom:1px solid #c1a264}' +
        '#vfPopup .settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:10px}' +
        '#vfPopup .settings label{display:flex;flex-direction:column;font-size:11px}' +
        '#vfPopup .settings input{width:100%;padding:4px;border:1px solid #c1a264;border-radius:3px}' +
        '#vfPopup .content{padding:10px}' +
        '#vfPopup table{width:100%;border-collapse:collapse}' +
        '#vfPopup th,#vfPopup td{padding:5px;border:1px solid #c1a264;text-align:center;font-size:11px}' +
        '#vfPopup th{background:#c1a264}' +
        '#vfPopup .btn{padding:5px 12px;cursor:pointer;border:1px solid #7d510f;border-radius:4px;background:linear-gradient(#f4e4bc,#d4c49c);margin:2px}' +
        '#vfPopup .btn:hover{background:linear-gradient(#fff,#e4d4bc)}' +
        '#vfPopup .high{color:#155724;font-weight:bold}' +
        '#vfPopup .med{color:#856404;font-weight:bold}' +
        '#vfPopup .low{color:#6c757d}' +
        '#vfPopup a{color:#603000}' +
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
        var settingsHtml = '';
        if (showSettings !== false) {
            settingsHtml = '<div class="settings">' +
                '<label>Min ODA<input type="number" id="vfMinOda" value="' + settings.minOda + '"></label>' +
                '<label>Max Results<input type="number" id="vfMaxResults" value="' + settings.maxResults + '"></label>' +
                '<label>Tolerance %<input type="number" id="vfTolerance" value="' + settings.tolerance + '"></label>' +
                '<label>Range<input type="number" id="vfRange" value="' + settings.range + '"></label>' +
                '<label style="flex-direction:row;align-items:center;gap:5px"><input type="checkbox" id="vfUseRange" ' + (settings.useRange ? 'checked' : '') + '> Filter by range</label>' +
                '</div>';
        }

        popup.innerHTML = css +
            '<h3><span>⚔️ Victim Finder v4.0</span><button class="btn" onclick="document.getElementById(\'vfPopup\').remove()">✖</button></h3>' +
            '<div class="bar">' + settingsHtml +
            '<button class="btn" onclick="window.vfScan()">🔍 Find Matches</button>' +
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
                var x = parseInt(p[2]) || 0;
                var y = parseInt(p[3]) || 0;
                var playerId = p[4];
                if (playerId && playerId !== '0' && !playerCoords[playerId]) {
                    playerCoords[playerId] = { x: x, y: y };
                    if (playerId === myPlayerId && !myCoords) {
                        myCoords = { x: x, y: y };
                    }
                }
            }
        });
    }

    function isInRange(playerId) {
        if (!settings.useRange || !myCoords) return true;
        var coords = playerCoords[playerId];
        if (!coords) return true;  // Include if no coords found
        var dx = Math.abs(coords.x - myCoords.x);
        var dy = Math.abs(coords.y - myCoords.y);
        return dx <= settings.range && dy <= settings.range;
    }

    function getName(id) {
        return playerNames[id] || ('ID:' + id);
    }

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

            for (var attId in odaData) {
                var oda = odaData[attId];
                if (oda < settings.minOda) continue;
                if (!isInRange(attId)) continue;

                for (var defId in oddData) {
                    if (attId === defId) continue;
                    if (!isInRange(defId)) continue;

                    var odd = oddData[defId];
                    var diff = Math.abs(oda - odd);
                    var pct = diff / Math.max(oda, odd);

                    if (pct <= tolerance) {
                        matches.push({
                            attId: attId,
                            attName: getName(attId),
                            oda: oda,
                            defId: defId,
                            defName: getName(defId),
                            odd: odd,
                            pct: pct * 100,
                            conf: pct < 0.05 ? 'high' : pct < 0.10 ? 'med' : 'low'
                        });
                    }
                }
            }

            matches.sort(function (a, b) { return a.pct - b.pct; });
            matches = matches.slice(0, settings.maxResults);

            if (matches.length === 0) {
                var rangeInfo = settings.useRange && myCoords ? ' (within ' + settings.range + ' of ' + myCoords.x + '|' + myCoords.y + ')' : '';
                showUI('<p style="text-align:center;padding:20px">No matches found' + rangeInfo + '.<br>Try adjusting settings.</p>');
                return;
            }

            var html = '<p>Found ' + matches.length + ' matches' + (settings.useRange && myCoords ? ' within range ' + settings.range + ' of ' + myCoords.x + '|' + myCoords.y : '') + ':</p>' +
                '<table><thead><tr>' +
                '<th>Attacker</th><th>ODA</th><th>Victim</th><th>ODD</th><th>Diff</th><th>Conf</th>' +
                '</tr></thead><tbody>';

            matches.forEach(function (m) {
                html += '<tr>' +
                    '<td><a href="' + worldUrl + '/guest.php?screen=info_player&id=' + m.attId + '" target="_blank">' + m.attName + '</a></td>' +
                    '<td style="color:#c44a4a">' + m.oda.toLocaleString() + '</td>' +
                    '<td><a href="' + worldUrl + '/guest.php?screen=info_player&id=' + m.defId + '" target="_blank">' + m.defName + '</a></td>' +
                    '<td style="color:#b8860b">' + m.odd.toLocaleString() + '</td>' +
                    '<td>' + m.pct.toFixed(1) + '%</td>' +
                    '<td class="' + m.conf + '">' + m.conf.toUpperCase() + '</td>' +
                    '</tr>';
            });
            html += '</tbody></table>';

            showUI(html);

        }).catch(function (err) {
            showUI('<p style="color:red">❌ Error: ' + err + '</p>');
        });
    };

    // Initial UI
    showUI('<p style="text-align:center;padding:15px">Configure settings above and click <strong>Find Matches</strong></p>');

})();

/*
 * Victim Finder v2.0
 * Correlates ODA/ODD changes to identify attack victims
 * No external dependencies
 */

(function () {
    'use strict';

    // Settings
    var MIN_CHANGE = window.MIN_CHANGE || 10000;
    var MAX_RESULTS = window.MAX_RESULTS || 30;

    // Check if in TW
    if (typeof game_data === 'undefined') {
        alert('Run this inside Tribal Wars!');
        return;
    }

    var world = game_data.world;
    var worldUrl = window.location.origin;
    var KEYS = {
        oda: 'vf_oda_' + world,
        odd: 'vf_odd_' + world,
        time: 'vf_time_' + world
    };

    // Remove old popup if exists
    var old = document.getElementById('vfPopup');
    if (old) old.remove();

    // Create popup
    var popup = document.createElement('div');
    popup.id = 'vfPopup';
    popup.style.cssText = 'position:fixed;top:50px;right:50px;width:500px;max-height:80vh;overflow-y:auto;background:#f4e4bc;border:2px solid #7d510f;z-index:99999;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);font-family:Verdana,sans-serif;font-size:12px';
    document.body.appendChild(popup);

    // Styles
    var css = '<style>' +
        '#vfPopup h3{margin:0;padding:10px;background:#c1a264;border-radius:6px 6px 0 0}' +
        '#vfPopup .vf-bar{padding:8px;background:#e8d4a8;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:5px;border-bottom:1px solid #c1a264}' +
        '#vfPopup .vf-content{padding:10px}' +
        '#vfPopup table{width:100%;border-collapse:collapse}' +
        '#vfPopup th,#vfPopup td{padding:6px;border:1px solid #c1a264;text-align:center}' +
        '#vfPopup th{background:#c1a264}' +
        '#vfPopup .btn{padding:5px 12px;cursor:pointer;border:1px solid #7d510f;border-radius:4px;background:linear-gradient(#f4e4bc,#d4c49c)}' +
        '#vfPopup .btn:hover{background:linear-gradient(#fff,#e4d4bc)}' +
        '#vfPopup .high{color:#155724;font-weight:bold}' +
        '#vfPopup .med{color:#856404;font-weight:bold}' +
        '#vfPopup .low{color:#6c757d}' +
        '</style>';

    function showUI(content) {
        popup.innerHTML = css +
            '<h3>⚔️ Victim Finder</h3>' +
            '<div class="vf-bar">' +
            '<span>🌍 ' + world.toUpperCase() + ' | ⚔️ Min: ' + MIN_CHANGE.toLocaleString() + '</span>' +
            '<div>' +
            '<button class="btn" onclick="window.vfScan()">🔍 Scan</button> ' +
            '<button class="btn" onclick="window.vfClear()">🗑️ Clear</button> ' +
            '<button class="btn" onclick="document.getElementById(\'vfPopup\').remove()">✖ Close</button>' +
            '</div>' +
            '</div>' +
            '<div class="vf-content">' + content + '</div>';
    }

    function fetchData(type) {
        return new Promise(function (resolve, reject) {
            var timeout = setTimeout(function () { reject('Timeout'); }, 15000);
            $.ajax({
                url: worldUrl + '/map/kill_' + type + '.txt',
                type: 'GET',
                dataType: 'text',
                success: function (data) {
                    clearTimeout(timeout);
                    var result = {};
                    data.split('\n').forEach(function (line) {
                        var p = line.split(',');
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

    function calcDeltas(curr, prev) {
        var deltas = {};
        for (var id in curr) {
            var delta = curr[id] - (prev[id] || 0);
            if (delta >= MIN_CHANGE) deltas[id] = delta;
        }
        return deltas;
    }

    function findMatches(odaDeltas, oddDeltas) {
        var matches = [];
        for (var attId in odaDeltas) {
            var odaGain = odaDeltas[attId];
            for (var defId in oddDeltas) {
                if (attId === defId) continue;
                var oddGain = oddDeltas[defId];
                var diff = Math.abs(odaGain - oddGain);
                var pct = diff / ((odaGain + oddGain) / 2);
                if (pct <= 0.25) {
                    matches.push({
                        attId: attId, odaGain: odaGain,
                        defId: defId, oddGain: oddGain,
                        pct: pct * 100,
                        conf: pct < 0.05 ? 'high' : pct < 0.15 ? 'med' : 'low'
                    });
                    if (matches.length >= MAX_RESULTS) break;
                }
            }
            if (matches.length >= MAX_RESULTS) break;
        }
        return matches.sort(function (a, b) { return a.pct - b.pct; });
    }

    window.vfScan = function () {
        showUI('<p style="text-align:center">⏳ Scanning...</p>');

        Promise.all([fetchData('att'), fetchData('def')]).then(function (results) {
            var odaData = results[0];
            var oddData = results[1];

            var prevOda = JSON.parse(localStorage.getItem(KEYS.oda) || '{}');
            var prevOdd = JSON.parse(localStorage.getItem(KEYS.odd) || '{}');
            var isFirst = Object.keys(prevOda).length === 0;

            var odaDeltas = calcDeltas(odaData, prevOda);
            var oddDeltas = calcDeltas(oddData, prevOdd);

            localStorage.setItem(KEYS.oda, JSON.stringify(odaData));
            localStorage.setItem(KEYS.odd, JSON.stringify(oddData));
            localStorage.setItem(KEYS.time, Date.now());

            if (isFirst) {
                showUI('<p style="text-align:center;padding:20px;background:#cce5ff;border-radius:4px">✅ <strong>Baseline captured!</strong><br>Run again in ~1 hour to see matches.</p>');
                return;
            }

            var matches = findMatches(odaDeltas, oddDeltas);

            if (matches.length === 0) {
                showUI('<p style="text-align:center;padding:20px">No matches found.<br>ODA changes: ' + Object.keys(odaDeltas).length + ' | ODD changes: ' + Object.keys(oddDeltas).length + '</p>');
                return;
            }

            var html = '<table><thead><tr><th>Attacker</th><th>ODA+</th><th>Victim</th><th>ODD+</th><th>Diff</th><th>Conf</th></tr></thead><tbody>';
            matches.forEach(function (m) {
                html += '<tr>' +
                    '<td><a href="' + worldUrl + '/guest.php?screen=info_player&id=' + m.attId + '" target="_blank">' + m.attId + '</a></td>' +
                    '<td style="color:#c44a4a">+' + m.odaGain.toLocaleString() + '</td>' +
                    '<td><a href="' + worldUrl + '/guest.php?screen=info_player&id=' + m.defId + '" target="_blank">' + m.defId + '</a></td>' +
                    '<td style="color:#b8860b">+' + m.oddGain.toLocaleString() + '</td>' +
                    '<td>' + m.pct.toFixed(1) + '%</td>' +
                    '<td class="' + m.conf + '">' + m.conf.toUpperCase() + '</td>' +
                    '</tr>';
            });
            html += '</tbody></table>';
            showUI(html);

        }).catch(function (err) {
            showUI('<p style="color:red;text-align:center">❌ Error: ' + err + '</p>');
        });
    };

    window.vfClear = function () {
        localStorage.removeItem(KEYS.oda);
        localStorage.removeItem(KEYS.odd);
        localStorage.removeItem(KEYS.time);
        showUI('<p style="text-align:center;padding:20px">✅ Data cleared! Click Scan to start fresh.</p>');
    };

    // Show initial UI
    var lastTime = localStorage.getItem(KEYS.time);
    var timeStr = lastTime ? new Date(parseInt(lastTime)).toLocaleString() : 'Never';
    showUI('<p style="text-align:center;padding:20px">Last scan: ' + timeStr + '<br><br>Click <strong>Scan</strong> to capture baseline or compare with previous scan.</p>');

})();

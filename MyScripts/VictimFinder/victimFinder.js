/*
 * Victim Finder v3.0
 * Compares Player A's ODA with Player B's ODD to find attacker/victim pairs
 */

(function () {
    'use strict';

    // Settings
    var MIN_ODA = window.MIN_ODA || 100;         // Minimum ODA to consider
    var MAX_RESULTS = window.MAX_RESULTS || 50;  // Max results to show
    var TOLERANCE = window.TOLERANCE || 0.20;   // 20% tolerance for matching

    if (typeof game_data === 'undefined') {
        alert('Run this inside Tribal Wars!');
        return;
    }

    var world = game_data.world;
    var worldUrl = window.location.origin;

    // Remove old popup
    var old = document.getElementById('vfPopup');
    if (old) old.remove();

    // Create popup
    var popup = document.createElement('div');
    popup.id = 'vfPopup';
    popup.style.cssText = 'position:fixed;top:50px;right:50px;width:550px;max-height:80vh;overflow-y:auto;background:#f4e4bc;border:2px solid #7d510f;z-index:99999;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3);font-family:Verdana,sans-serif;font-size:12px';
    document.body.appendChild(popup);

    var css = '<style>' +
        '#vfPopup h3{margin:0;padding:10px;background:#c1a264;border-radius:6px 6px 0 0}' +
        '#vfPopup .bar{padding:8px;background:#e8d4a8;border-bottom:1px solid #c1a264;display:flex;justify-content:space-between;flex-wrap:wrap;gap:5px}' +
        '#vfPopup .content{padding:10px}' +
        '#vfPopup table{width:100%;border-collapse:collapse}' +
        '#vfPopup th,#vfPopup td{padding:5px;border:1px solid #c1a264;text-align:center}' +
        '#vfPopup th{background:#c1a264}' +
        '#vfPopup .btn{padding:5px 10px;cursor:pointer;border:1px solid #7d510f;border-radius:4px;background:linear-gradient(#f4e4bc,#d4c49c)}' +
        '#vfPopup .high{color:#155724;font-weight:bold}' +
        '#vfPopup .med{color:#856404;font-weight:bold}' +
        '#vfPopup .low{color:#6c757d}' +
        '</style>';

    function showUI(content) {
        popup.innerHTML = css +
            '<h3>⚔️ Victim Finder v3.0</h3>' +
            '<div class="bar">' +
            '<span>🌍 ' + world.toUpperCase() + ' | Min ODA: ' + MIN_ODA.toLocaleString() + ' | Tolerance: ' + (TOLERANCE * 100) + '%</span>' +
            '<div>' +
            '<button class="btn" onclick="window.vfScan()">🔍 Find Matches</button> ' +
            '<button class="btn" onclick="document.getElementById(\'vfPopup\').remove()">✖</button>' +
            '</div>' +
            '</div>' +
            '<div class="content">' + content + '</div>';
    }

    function fetchData(type) {
        return new Promise(function (resolve, reject) {
            $.ajax({
                url: worldUrl + '/map/kill_' + type + '.txt',
                type: 'GET',
                dataType: 'text',
                timeout: 15000,
                success: function (data) {
                    var result = {};
                    data.split('\n').forEach(function (line) {
                        var p = line.split(',');
                        if (p.length >= 3) {
                            var id = p[1];
                            var kills = parseInt(p[2]) || 0;
                            if (kills > 0) result[id] = kills;
                        }
                    });
                    resolve(result);
                },
                error: function (xhr, status, err) {
                    reject(err || status);
                }
            });
        });
    }

    window.vfScan = function () {
        showUI('<p style="text-align:center">⏳ Fetching data...</p>');

        Promise.all([fetchData('att'), fetchData('def')]).then(function (results) {
            var odaData = results[0];  // Player ID -> total ODA
            var oddData = results[1];  // Player ID -> total ODD

            showUI('<p style="text-align:center">⏳ Finding matches...</p>');

            var matches = [];

            // For each player with significant ODA
            for (var attId in odaData) {
                var oda = odaData[attId];
                if (oda < MIN_ODA) continue;

                // Find players whose ODD is close to this ODA
                for (var defId in oddData) {
                    if (attId === defId) continue;

                    var odd = oddData[defId];
                    var diff = Math.abs(oda - odd);
                    var pct = diff / Math.max(oda, odd);

                    if (pct <= TOLERANCE) {
                        matches.push({
                            attId: attId,
                            oda: oda,
                            defId: defId,
                            odd: odd,
                            pct: pct * 100,
                            conf: pct < 0.05 ? 'high' : pct < 0.10 ? 'med' : 'low'
                        });
                    }
                }
            }

            // Sort by lowest difference (highest confidence)
            matches.sort(function (a, b) { return a.pct - b.pct; });
            matches = matches.slice(0, MAX_RESULTS);

            if (matches.length === 0) {
                showUI('<p style="text-align:center;padding:20px">No matches found.<br>Try increasing TOLERANCE or decreasing MIN_ODA.</p>');
                return;
            }

            var html = '<p>Found ' + matches.length + ' potential attacker/victim pairs:</p>' +
                '<table><thead><tr>' +
                '<th>Attacker</th><th>ODA</th><th>Victim</th><th>ODD</th><th>Diff%</th><th>Conf</th>' +
                '</tr></thead><tbody>';

            matches.forEach(function (m) {
                html += '<tr>' +
                    '<td><a href="' + worldUrl + '/guest.php?screen=info_player&id=' + m.attId + '" target="_blank">' + m.attId + '</a></td>' +
                    '<td style="color:#c44a4a">' + m.oda.toLocaleString() + '</td>' +
                    '<td><a href="' + worldUrl + '/guest.php?screen=info_player&id=' + m.defId + '" target="_blank">' + m.defId + '</a></td>' +
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

    // Show initial UI
    showUI('<p style="text-align:center;padding:20px">Click <strong>Find Matches</strong> to compare ODA vs ODD and find attacker/victim pairs.<br><br>This compares Player A\'s total ODA with Player B\'s total ODD.</p>');

})();

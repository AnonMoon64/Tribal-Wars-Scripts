/*
 * Bounce Snipe v1.0
 * Tool to calculate bounce snipe times from incoming attack page
 */

(function () {
    'use strict';

    if (typeof game_data === 'undefined') {
        alert('Run this script on the Incoming Attacks page or Village Info page!');
        return;
    }

    // --- Configuration ---
    var CONFIG = {
        radius: 20, // Search radius for barbs
        worldSpeed: Number(game_data.worldConfig ? game_data.worldConfig.speed : 1), // Try to detect
        unitSpeed: Number(game_data.unitConfig ? game_data.unitConfig.speed : 1)     // Try to detect
    };

    // If config not detected, ask user or default
    if (isNaN(CONFIG.worldSpeed)) CONFIG.worldSpeed = 1;
    if (isNaN(CONFIG.unitSpeed)) CONFIG.unitSpeed = 1;

    // Unit Speeds (minutes per field)
    var UNITS = {
        'spear': 18, 'sword': 22, 'axe': 18, 'archer': 18,
        'spy': 9, 'light': 10, 'marcher': 10, 'heavy': 11,
        'ram': 30, 'catapult': 30, 'knight': 10, 'snob': 35
    };

    // UI Styles
    var STYLE = `
        #bsPopup {
            position: fixed; top: 100px; left: 50%; transform: translateX(-50%);
            width: 700px; max-height: 80vh; overflow-y: auto;
            background: #f4e4bc; border: 3px solid #7d510f; border-radius: 5px;
            box-shadow: 0 0 20px rgba(0,0,0,0.5); z-index: 10000;
            font-family: Verdana, sans-serif; font-size: 12px;
        }
        #bsHeader {
            background: #c1a264; padding: 10px; font-weight: bold;
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 2px solid #7d510f;
        }
        #bsContent { padding: 15px; }
        .bs-btn {
            background: linear-gradient(to bottom, #947a48 0%, #7d510f 100%);
            color: white; border: 1px solid #5c3a0b; padding: 5px 10px;
            cursor: pointer; border-radius: 3px;
        }
        .bs-btn:hover { background: #7d510f; }
        .bs-row { display: flex; justify-content: space-between; margin-bottom: 8px; align-items: center; }
        table.bs-table { width: 100%; border-collapse: collapse; margin-top: 10px; background: #fff5da; }
        table.bs-table th, table.bs-table td { border: 1px solid #dcb; padding: 5px; text-align: center; }
        table.bs-table th { background: #f0d495; }
        .bs-highlight { background-color: #ffffcc; }
        .bs-error { color: red; font-weight: bold; }
        .bs-timer { font-weight: bold; font-size: 14px; color: #a50000; }
    `;

    // --- State ---
    var state = {
        attacks: [],     // Parsed incoming attacks
        selected: [],    // Selected 2 attacks [ms_time1, ms_time2]
        barbs: [],       // Nearby barbarian villages
        currentVillage: game_data.village // {id, x, y}
    };

    // --- Helpers ---
    function formatTime(ms) {
        return new Date(ms).toLocaleString().split(', ')[1]; // "HH:MM:SS"
    }

    // --- Date Parsing Helper ---
    function parseTWDate(dateStr) {
        // Formats:
        // "today at 14:00:05:123"
        // "tomorrow at 14:00:05:123"
        // "on 12.02. at 14:00:05:123" (sometimes year is missing or present)

        var now = new Date();
        var dateText = dateStr.toLowerCase();
        var timePart = dateText.match(/\d{1,2}:\d{2}:\d{2}(?::\d{3})?/);
        if (!timePart) return NaN;

        var timeParts = timePart[0].split(':');
        var h = parseInt(timeParts[0]);
        var m = parseInt(timeParts[1]);
        var s = parseInt(timeParts[2]);
        var ms = timeParts[3] ? parseInt(timeParts[3]) : 0;

        var date = new Date();
        date.setHours(h, m, s, ms);
        date.setMilliseconds(ms); // Ensure MS is set

        if (dateText.includes('tomorrow')) {
            date.setDate(date.getDate() + 1);
        } else if (dateText.includes('on ')) {
            // "on 12.02. at..." or "on 12.02.2025 at..."
            var dPart = dateText.match(/on\s+(\d{1,2})\.(\d{1,2})\.?(\d{2,4})?/);
            if (dPart) {
                date.setDate(parseInt(dPart[1]));
                date.setMonth(parseInt(dPart[2]) - 1);
                if (dPart[3]) {
                    var y = parseInt(dPart[3]);
                    if (y < 100) y += 2000;
                    date.setFullYear(y);
                }
            }
        }

        return date.getTime();
    }

    // --- Core Logic ---

    // 1. Parse Attacks
    function parseAttacks() {
        state.attacks = [];
        var rows = $('#incomings_table tr.nowrap');
        if (rows.length === 0) rows = $('table.vis:contains("Arrival") tr').has('td:contains(":")').slice(1);

        console.log('BS: Found ' + rows.length + ' rows');

        rows.each(function (i) {
            var row = $(this);
            var timerSpan = row.find('span.timer');
            var arrival = 0;

            // Debug the text we are finding
            var text = row.text();

            if (timerSpan.length > 0) {
                var endTime = parseInt(timerSpan.data('endtime'));
                if (endTime) {
                    arrival = endTime * 1000;
                    // Try to add MS from text if present
                    var msMatch = row.text().match(/:(\d{3})/);
                    if (msMatch) arrival += parseInt(msMatch[1]);
                }
            }

            // Fallback to text parsing
            if (!arrival) {
                // Find column with date
                row.find('td').each(function () {
                    var txt = $(this).text().trim();
                    if (txt.includes(':') && (txt.includes('today') || txt.includes('tomorrow') || txt.includes('on '))) {
                        var parsed = parseTWDate(txt);
                        if (!isNaN(parsed)) arrival = parsed;
                    }
                });
            }

            if (arrival) {
                if (row.find('.bs-chk').length === 0) {
                    row.find('td:first').prepend('<input type="checkbox" class="bs-chk" data-time="' + arrival + '"> ');
                } else {
                    row.find('.bs-chk').attr('data-time', arrival);
                }
            } else {
                console.warn('BS: Could not parse date for row ' + i, text);
            }
        });

        // Listener
        $('.bs-chk').off('change').on('change', function () {
            var ms = parseInt($(this).data('time'));
            var label = $(this).closest('tr').find('a').first().text().trim();

            if (isNaN(ms)) {
                alert('Error: Could not parse time for this attack.');
                this.checked = false;
                return;
            }

            if (this.checked) {
                if (state.selected.length >= 2) {
                    this.checked = false;
                    alert('Select only 2 attacks');
                    return;
                }
                state.selected.push({ time: ms, label: label });
            } else {
                state.selected = state.selected.filter(s => s.time !== ms);
            }
            updateGapInfo();
        });
    }

    // 2. Fetch Barbarians
    function fetchBarbs() {
        if (state.barbs.length > 0) return Promise.resolve(state.barbs);

        // Using TWMap logic if available (fastest on cached map)
        if (window.TWMap && TWMap.villages) {
            var barbs = [];
            var cid = state.currentVillage.id;
            var cx = state.currentVillage.x;
            var cy = state.currentVillage.y;

            for (var vid in TWMap.villages) {
                var v = TWMap.villages[vid];
                if (v.owner === "0" || v.id === "0") { // Abandoned
                    var dx = v.x - cx;
                    var dy = v.y - cy;
                    var dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist <= CONFIG.radius) {
                        barbs.push({ id: v.id, x: v.x, y: v.y, dist: dist });
                    }
                }
            }
            barbs.sort((a, b) => a.dist - b.dist);
            state.barbs = barbs;
            return Promise.resolve(barbs);
        }

        // Fallback: Fetch village.txt (slow, reuse logic from VictimFinder if needed)
        // For MVP, assume Map is loaded or user is on a page with map data?
        // Actually, let's just use a simple coordinate input if automatic fail
        return Promise.resolve([]);
    }

    // 3. Calculate Plans
    function calculateSnipe() {
        if (state.selected.length !== 2) return;

        // Sort times
        state.selected.sort((a, b) => a.time - b.time);

        var t1 = state.selected[0].time;
        var t2 = state.selected[1].time;
        var targetReturn = (t1 + t2) / 2; // Aim for dead center
        var gap = t2 - t1;

        var results = [];

        state.barbs.forEach(barb => {
            for (var unit in UNITS) {
                var speed = UNITS[unit];
                // Calculate travel time in minutes
                var durationMin = barb.dist * speed / CONFIG.unitSpeed / CONFIG.worldSpeed;
                var durationSec = Math.round(durationMin * 60);
                var durationMs = durationSec * 1000;

                // Total trip = Out + Back
                var totalTrip = durationMs * 2;

                // Required Launch Time
                var launchTime = targetReturn - totalTrip;

                // Filter impossible launches (past)
                if (launchTime > Date.now()) {
                    results.push({
                        unit: unit,
                        target: barb,
                        launch: launchTime,
                        return: launchTime + totalTrip,
                        duration: durationMs
                    });
                }
            }
        });

        results.sort((a, b) => a.launch - b.launch);
        renderResults(results, t1, t2, targetReturn);
    }

    // --- UI Renderers ---

    function createUI() {
        if ($('#bsPopup').length) return;
        $('head').append(`<style>${STYLE}</style>`);

        var html = `
        <div id="bsPopup">
            <div id="bsHeader">
                <span>🎯 Bounce Snipe Calculator</span>
                <button class="bs-btn" onclick="$('#bsPopup').remove()">✖</button>
            </div>
            <div id="bsContent">
                <div class="bs-row">
                    <span><strong>1. Select Attacks:</strong> Check 2 boxes in the incoming list.</span>
                </div>
                <div id="bsGapInfo" class="bs-row" style="background:#fff; padding:5px; border:1px solid #ccc;">
                    Select start and end attacks...
                </div>
                <div class="bs-row" style="margin-top:10px;">
                    <button class="bs-btn" id="bsFindBarbs">Find Barbs & Calc</button>
                    <span>Radius: <input type="number" id="bsRadius" value="20" style="width:40px"></span>
                </div>
                <div id="bsResults"></div>
            </div>
        </div>`;
        $('body').append(html);

        $('#bsFindBarbs').click(async function () {
            $('#bsResults').html('Scanning for barbs...');
            CONFIG.radius = parseInt($('#bsRadius').val());
            await fetchBarbs();
            calculateSnipe();
        });

        parseAttacks(); // Initial parse
    }

    function updateGapInfo() {
        if (state.selected.length !== 2) {
            $('#bsGapInfo').html('Select 2 attacks provided in the table.');
            return;
        }
        var diff = Math.abs(state.selected[1].time - state.selected[0].time);
        var center = new Date((state.selected[0].time + state.selected[1].time) / 2).toLocaleTimeString();
        $('#bsGapInfo').html(`
            Gap: <strong>${diff}ms</strong><br>
            Aiming to return at: <strong>${center}</strong>
        `);
        // Auto calc if barbs already found
        if (state.barbs.length > 0) calculateSnipe();
    }

    function renderResults(results, t1, t2, target) {
        var html = `<table class="bs-table">
            <thead>
                <tr>
                    <th>Unit</th>
                    <th>Target</th>
                    <th>Launch In</th>
                    <th>Launch Time</th>
                    <th>Return Time</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>`;

        results.slice(0, 15).forEach(r => {
            var timeLeft = Math.round((r.launch - Date.now()) / 1000);
            var timerId = 'bst_' + Math.floor(Math.random() * 10000);

            html += `<tr>
                <td><img src="https://dsen.innogamescdn.com/asset/d25bbc6/graphic/unit/unit_${r.unit}.png"></td>
                <td><a href="/game.php?screen=info_village&id=${r.target.id}">${r.target.x}|${r.target.y}</a> (${r.target.dist.toFixed(1)})</td>
                <td class="bs-timer" id="${timerId}" data-time="${r.launch}">${formatTimer(timeLeft)}</td>
                <td>${new Date(r.launch).toLocaleTimeString()}</td>
                <td>${new Date(r.return).toLocaleTimeString()}</td>
                <td><a href="/game.php?screen=place&target=${r.target.id}" target="_blank" class="bs-btn">Send</a></td>
            </tr>`;
        });
        html += '</tbody></table>';
        $('#bsResults').html(html);

        startTimers();
    }

    function formatTimer(sec) {
        if (sec < 0) return "PASSED";
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }

    function startTimers() {
        if (window.bsInterval) clearInterval(window.bsInterval);
        window.bsInterval = setInterval(() => {
            $('.bs-timer').each(function () {
                var target = parseInt($(this).data('time'));
                var left = Math.round((target - Date.now()) / 1000);
                $(this).text(formatTimer(left));
                if (left <= 5 && left >= 0) $(this).css('color', 'red').css('font-size', '16px');
                else $(this).css('color', '#a50000').css('font-size', '14px');
            });
        }, 1000);
    }

    createUI();

})();

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

    function parseDate(dateStr) {
        // Handle "today at HH:MM:SS" / "tomorrow at..." / "on dd.mm.yyyy at..."
        // This is complex in TW. For MVP, we parse the `data-endtime` attribute if available,
        // or the specific timer span format.
        // Best approach: Parse the countdown timer or `span.timer` content.
        return 0; // implemented in parser
    }

    // --- Core Logic ---

    // 1. Parse Attacks
    function parseAttacks() {
        state.attacks = [];
        // Support standard Incoming Overview table
        var rows = $('#incomings_table tr.nowrap');
        if (rows.length === 0) rows = $('table.vis:contains("Arrival") tr').slice(1); // Fallback

        rows.each(function () {
            var row = $(this);
            var timerSpan = row.find('span.timer');
            var timeText = row.find('td:eq(5)').text(); // Adjust index based on column

            // Try to find arrival time
            var arrival = 0;
            if (timerSpan.length > 0) {
                // Calculate from countdown: Now + remaining seconds
                var seconds = parseInt(timerSpan.data('endtime')) - Math.floor(Date.now() / 1000);
                if (isNaN(seconds)) seconds = parseInt(timerSpan.text().split(':').reduce((acc, time) => (60 * acc) + +time));
                arrival = Date.now() + (seconds * 1000);
            } else {
                // Try parse text "today at 14:00:00:123"
                // This is hard without standardized format. 
                // Let's rely on data-endtime if possible or fallback to asking user to select rows
            }

            // Allow user to select rows manually if auto-parse fails
            // Add checkbox to each row
            if (row.find('.bs-chk').length === 0) {
                row.find('td:first').prepend('<input type="checkbox" class="bs-chk"> ');
            }
        });

        // Listener for checkboxes
        $('.bs-chk').on('change', function () {
            var row = $(this).closest('tr');
            var timer = row.find('span.timer');
            var endTime = timer.data('endtime'); // Unix timestamp (seconds)
            var ms = row.text().match(/:(\d{3})/); // Try to grab MS from text
            var extraMs = ms ? parseInt(ms[1]) : 0;

            var exactTime = (endTime * 1000) + extraMs;

            if (this.checked) {
                if (state.selected.length >= 2) {
                    this.checked = false;
                    alert('Select only 2 attacks (Start and End of gap)');
                    return;
                }
                state.selected.push({ time: exactTime, label: row.find('a').first().text().trim() });
            } else {
                state.selected = state.selected.filter(s => s.time !== exactTime);
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

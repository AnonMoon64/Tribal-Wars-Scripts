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

    // --- Data Fetching Helper ---
    function fetchWorldData(file) {
        return $.ajax({
            url: window.location.origin + '/map/' + file,
            type: 'GET',
            dataType: 'text'
        });
    }

    // 2. Fetch Barbarians
    function fetchBarbs() {
        if (state.barbs.length > 0) return Promise.resolve(state.barbs);

        var cx = state.currentVillage.x;
        var cy = state.currentVillage.y;
        var radiusSq = CONFIG.radius * CONFIG.radius;
        var barbs = [];

        // Fast path: TWMap (if available)
        if (window.TWMap && TWMap.villages) {
            console.log('BS: Using TWMap for barbs');
            for (var vid in TWMap.villages) {
                var v = TWMap.villages[vid];
                if (v.owner === "0" || v.id === "0") {
                    var dx = v.x - cx;
                    var dy = v.y - cy;
                    if ((dx * dx + dy * dy) <= radiusSq) {
                        barbs.push({ id: v.id, x: v.x, y: v.y, dist: Math.sqrt(dx * dx + dy * dy) });
                    }
                }
            }
            barbs.sort((a, b) => a.dist - b.dist);
            state.barbs = barbs;
            return Promise.resolve(barbs);
        }

        // Slow path: Fetch village.txt
        $('#bsResults').html('Fetching world village data (this takes a moment)...');
        return fetchWorldData('village.txt').then(function (data) {
            console.log('BS: Fetched village.txt');
            var lines = data.split('\n');
            lines.forEach(function (line) {
                var p = line.split(',');
                if (p.length >= 5) {
                    var pid = p[4];
                    if (pid === "0") { // Barbarian
                        var x = parseInt(p[2]);
                        var y = parseInt(p[3]);
                        var dx = x - cx;
                        var dy = y - cy;
                        if ((dx * dx + dy * dy) <= radiusSq) {
                            barbs.push({ id: p[0], x: x, y: y, dist: Math.sqrt(dx * dx + dy * dy) });
                        }
                    }
                }
            });
            barbs.sort((a, b) => a.dist - b.dist);
            state.barbs = barbs;
            console.log('BS: Found ' + barbs.length + ' barbs via file');
            return barbs;
        }).catch(function (err) {
            alert('Error fetching village data: ' + err);
            return [];
        });
    }

    // --- Unit & Data Helpers ---
    // --- Unit & Data Helpers ---
    function getUnitCounts() {
        var counts = {};

        // 1. Try game_data.village.unit_counts (often present in automated scripts or certain views)
        if (game_data.village && game_data.village.unit_counts) {
            return game_data.village.unit_counts;
        }

        // 2. DOM Parsing: Standard Header (Top Bar)
        // Look for .box-item or .unit-item
        var found = false;

        // Strategy A: .box-item (Desktop)
        $('.box-item').each(function () {
            var icon = $(this).find('img').attr('src');
            if (icon) {
                var m = icon.match(/unit_(\w+)\.png/);
                if (m) {
                    var txt = $(this).text().trim().replace(/\./g, '');
                    if (txt !== '') {
                        counts[m[1]] = parseInt(txt) || 0;
                        found = true;
                    }
                }
            }
        });

        // Strategy B: Mobile/Responsive Header (.unit_link)
        if (!found) {
            $('.unit_link').each(function () {
                var u = $(this).data('unit');
                var c = parseInt($(this).text().trim().replace(/\./g, ''));
                if (u && !isNaN(c)) {
                    counts[u] = c;
                    found = true;
                }
            });
        }

        // Fallback: Default to "Unknown" (null)
        console.log('BS: Parsed units:', counts);
        return found ? counts : null;
    }

    function getSlowerOrEqualUnits(baseUnit) {
        var baseSpeed = UNITS[baseUnit];
        var group = [];
        for (var u in UNITS) {
            // Include if this unit is faster (lower val) or equal
            // Note: Smaller number = Faster (Minutes per field)
            if (UNITS[u] <= baseSpeed) {
                group.push(u);
            }
        }
        return group;
    }

    // 3. Calculate Plans
    function calculateSnipe() {
        if (state.selected.length !== 2) {
            $('#bsResults').html('<div class="bs-error">Please select exactly 2 attacks first!</div>');
            return;
        }

        if (state.barbs.length === 0) {
            $('#bsResults').html('<div class="bs-error">No barbarian villages found!</div>');
            return;
        }

        state.selected.sort((a, b) => a.time - b.time);

        var t1 = state.selected[0].time;
        var t2 = state.selected[1].time;

        // logic: returns at 00 ms of the second attack
        // t2 is e.g. 10:00:05.123
        // target = 10:00:05.000
        var targetDate = new Date(t2);
        targetDate.setMilliseconds(0);
        var targetReturn = targetDate.getTime();

        // Validation: Is targetReturn actually between t1 and t2?
        // User said "right so it returns at 00 ms of the second attack"
        // If t1=400, t2=800, target=000 (prev second?) 
        // If t2=12:00:05.400, target=12:00:05.000. 
        // If t1=12:00:04.900, then 12:00:05.000 is PERFECT.
        // If t1=12:00:05.100, then 12:00:05.000 is IMPOSSIBLE (before gap).
        var warning = '';
        if (targetReturn <= t1) {
            warning = '<div class="bs-error">Warning: 00ms target is BEFORE the gap start! (Gap: ' + formatTime(t1) + ' - ' + formatTime(t2) + ')</div>';
        }

        var availableUnits = getUnitCounts();
        var now = Date.now();
        var results = [];

        state.barbs.forEach(barb => {
            for (var unit in UNITS) {
                // FILTER: Only show loop if we have this unit
                if (availableUnits && (!availableUnits[unit] || availableUnits[unit] <= 0)) continue;

                var speed = UNITS[unit];
                var dist = barb.dist;
                var travelSeconds = Math.round(dist * speed * 60 / CONFIG.unitSpeed / CONFIG.worldSpeed);
                var travelMs = travelSeconds * 1000;
                var totalTrip = travelMs * 2;
                var launchTime = targetReturn - totalTrip;

                if (launchTime > now) {
                    // Create "Send All" URL
                    // We need to send CURRENT unit + all faster units
                    var sendUnits = getSlowerOrEqualUnits(unit);
                    var urlParams = [];
                    sendUnits.forEach(u => {
                        if (availableUnits && availableUnits[u] > 0) {
                            urlParams.push(u + '=' + availableUnits[u]);
                        } else if (!availableUnits) {
                            // If counts unknown, maybe put empty or 0? 
                            // Better to just not put params and let user fill, or put generic 'all' if script allowed?
                            // Script params usually are distinct. Standard URL is specific counts.
                            // Without counts, we can't fill.
                        }
                    });

                    var url = '/game.php?screen=place&target=' + barb.id;
                    if (urlParams.length > 0) url += '&' + urlParams.join('&');

                    results.push({
                        unit: unit,
                        target: barb,
                        launch: launchTime,
                        return: targetReturn,
                        url: url
                    });
                }
            }
        });

        if (results.length === 0) {
            $('#bsResults').html('<div class="bs-error">No valid snipes found or no troops available!</div>');
            return;
        }

        results.sort((a, b) => a.launch - b.launch);

        var extraHtml = warning ? warning : '';
        if (availableUnits) extraHtml += '<div style="font-size:10px;color:green">Filtered by available troops</div>';

        renderResults(results, extraHtml);
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

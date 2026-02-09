/*
 * Bounce Snipe v1.9
 * Tool to calculate bounce snipe times from incoming attack page
 * AND validate launch times on the confirmation screen.
 */

(function () {
    'use strict';

    if (typeof game_data === 'undefined') {
        alert('Run this script on the Incoming Attacks page, Village Info page, or Confirm Attack page!');
        return;
    }

    // --- Configuration ---
    var CONFIG = {
        radius: 20, // Search radius for barbs
        worldSpeed: Number(game_data.worldConfig ? game_data.worldConfig.speed : 1),
        unitSpeed: Number(game_data.unitConfig ? game_data.unitConfig.speed : 1)
    };
    if (isNaN(CONFIG.worldSpeed)) CONFIG.worldSpeed = 1;
    if (isNaN(CONFIG.unitSpeed)) CONFIG.unitSpeed = 1;

    // Unit Speeds (minutes per field)
    var UNITS = {
        'spear': 18, 'sword': 22, 'axe': 18, 'archer': 18,
        'spy': 9, 'light': 10, 'marcher': 10, 'heavy': 11,
        'ram': 30, 'catapult': 30, 'knight': 10, 'snob': 35
    };

    // --- Time Sync ---
    var serverOffset = 0;
    function syncTime() {
        if (window.Timing && Timing.getCurrentServerTime) {
            serverOffset = Timing.getCurrentServerTime() - Date.now();
            console.log('BS: Server Time Offset:', serverOffset, 'ms');
        }
    }
    syncTime();

    function getNow() {
        return Date.now() + serverOffset;
    }

    // Auto-fill troops from URL params (Fix for "doesn't fill troops")
    function fillTroopsFromUrl() {
        var params = new URLSearchParams(window.location.search);
        var filled = false;
        for (var u in UNITS) {
            if (params.has(u)) {
                var amount = params.get(u);
                $('input[name="' + u + '"]').val(amount);
                filled = true;
            }
        }
        if (filled) {
            UI.InfoMessage('Bounce Snipe: Troops filled. Ready to Attack!', 2000, 'success');
        }
    }

    // --- Mode Detection ---
    function init() {
        // Global event delegation for Send buttons
        $(document).off('click', '.bs-send-btn').on('click', '.bs-send-btn', function () {
            var url = $(this).data('url');
            var ret = $(this).data('return');

            // Save to localStorage
            localStorage.setItem('bs_target', ret);

            // Append hash for reliability (Tribal Wars ignores extra params usually, hash is safer)
            // Use query param for TW? No, hash is client side.
            var fullUrl = url + '#bs=' + ret;

            // Open window
            window.open(fullUrl, '_blank');
        });

        // Check if we are on "Place" screen AND "Confirm" (Attack verification)
        // CRITICAL: Ensure we are NOT on the input screen (which also has #command-data-form)
        // Input screen has unit inputs (id="unit_input_spear"). Confirm screen does not.
        var isPlaceScreen = window.location.href.indexOf('screen=place') > -1;
        var hasCommandForm = $('#command-data-form').length > 0;
        var isConfirmScreen = isPlaceScreen && hasCommandForm && $('#unit_input_spear').length === 0;

        if (isConfirmScreen) {
            runValidator();
        } else {
            if (isPlaceScreen) {
                fillTroopsFromUrl();
            }
            // Only run generator if looking at an incomings table, to avoid popup spam on other Place screens
            if ($('#incomings_table').length > 0 || $('table.vis:contains("Arrival")').length > 0) {
                runGenerator();
            }
        }
    }

    // --- VALIDATOR MODE (Confirm Screen) ---
    function runValidator() {
        // Try getting target from Hash first (most reliable)
        var hashMatch = window.location.hash.match(/bs=(\d+)/);
        var targetReturn = hashMatch ? hashMatch[1] : localStorage.getItem('bs_target');

        if (!targetReturn) {
            UI.InfoMessage('Bounce Snipe: No target return time found. Click "Send All" from the script popup.', 3000, 'error');
            return;
        }

        // Save to localStorage if we got it from hash, so it survives reload
        if (hashMatch) localStorage.setItem('bs_target', targetReturn);

        targetReturn = parseInt(targetReturn);

        // Parse Duration (Robust Method)
        // Try multiple selectors
        var durationText = '';
        var row = $('#command-data-form').find('tr').filter(function () {
            return $(this).text().indexOf('Duration:') > -1 || $(this).text().indexOf('Dauer:') > -1;
        });

        if (row.length > 0) {
            // Usually the second cell has the time
            durationText = row.find('td').last().text().trim();
        } else {
            // Fallback: Try specific cell classes if known? 
            // Try standard table position (usually row 4 or 5)
        }

        if (!durationText || durationText.indexOf(':') === -1) {
            console.error("BS: Could not find duration text", row);
            UI.ErrorMessage('Bounce Snipe Error: Could not read "Duration" from this page. Is the language English?');
            // Show UI anyway so user knows script ran
        }

        var launchTime = 0;
        var validParse = false;

        if (durationText) {
            var parts = durationText.split(':');
            var durationSec = (parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60) + parseInt(parts[2]);
            var durationMs = durationSec * 1000;
            launchTime = targetReturn - (durationMs * 2);
            validParse = true;
        }

        // Create UI Overlay
        var html = `
        <div id="bsValidator" style="position:fixed; top:120px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.85); color:white; padding:20px; border-radius:10px; z-index:99999; text-align:center; border:2px solid #c1a264; box-shadow:0 0 15px black; min-width:300px;">
            <h2 style="color:#f4e4bc; margin:0 0 10px 0; border-bottom:1px solid #7d510f; padding-bottom:5px;">🎯 Snipe Validator</h2>
            
            <div style="margin:10px 0;">
                <div style="font-size:12px; color:#aaa;">Target Return</div>
                <div style="font-size:18px; font-weight:bold; color:#fff;">${new Date(targetReturn).toLocaleTimeString()}.${(targetReturn % 1000).toString().padStart(3, '0')}</div>
            </div>

             <div style="margin:10px 0;">
                <div style="font-size:12px; color:#aaa;">Launch Timer</div>
                <div style="font-size:32px; font-weight:bold; font-family:monospace;" id="bsTimer">--:--:--</div>
            </div>
            
            <div id="bsStatus" style="font-weight:bold; margin-top:10px;">PREPARING...</div>
            <div style="font-size:10px; color:#666; margin-top:5px;">Server Offset: ${serverOffset}ms</div>
             ${!validParse ? '<div style="color:red; font-weight:bold;">ERROR: Duration Not Parsed</div>' : ''}
        </div>`;
        $('body').append(html);

        if (!validParse) return;

        // Timer Loop
        setInterval(function () {
            var now = getNow();
            var diffMs = launchTime - now;
            var absMs = Math.abs(diffMs);
            var sec = Math.floor(absMs / 1000);
            var ms = absMs % 1000;

            var sign = diffMs >= 0 ? '-' : '+';
            var timerText = `${sign}${sec}.${ms.toString().padStart(3, '0')}`;

            var timerEl = $('#bsTimer');
            var statusEl = $('#bsStatus');

            timerEl.text(timerText);

            if (diffMs > 0) {
                if (diffMs < 5000) {
                    timerEl.css('color', '#ff3333'); // Red Warning
                    statusEl.text("GET READY...");
                    statusEl.css('color', '#ffaa00');
                } else {
                    timerEl.css('color', '#fff');
                    statusEl.text("WAITing...");
                    statusEl.css('color', '#ccc');
                }
            } else {
                // Passed launch time
                if (diffMs > -1000) {
                    timerEl.css('color', '#33ff33'); // Green GO
                    statusEl.text("CLICK NOW!");
                    statusEl.css('color', '#33ff33');
                } else {
                    timerEl.css('color', '#888');
                    statusEl.text("MISSED");
                    statusEl.css('color', '#ff0000');
                }
            }
        }, 20); // High refresh for precision
    }

    // --- GENERATOR MODE (Incoming Page) ---
    function runGenerator() {
        createUI();
    }

    // UI Styles for Generator
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

    // --- Date Parsing Helper ---
    function parseTWDate(dateStr) {
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
        date.setMilliseconds(ms);

        if (dateText.includes('tomorrow')) {
            date.setDate(date.getDate() + 1);
        } else if (dateText.includes('on ')) {
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
    function parseAttacks() {
        state.attacks = [];
        var rows = $('#incomings_table tr.nowrap');
        if (rows.length === 0) rows = $('table.vis:contains("Arrival") tr').has('td:contains(":")').slice(1);

        rows.each(function (i) {
            var row = $(this);
            var timerSpan = row.find('span.timer');
            var arrival = 0;

            if (timerSpan.length > 0) {
                var endTime = parseInt(timerSpan.data('endtime'));
                if (endTime) {
                    arrival = endTime * 1000;
                    var msMatch = row.text().match(/:(\d{3})/);
                    if (msMatch) arrival += parseInt(msMatch[1]);
                }
            }
            if (!arrival) {
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
            }
        });

        $('.bs-chk').off('change').on('change', function () {
            var ms = parseInt($(this).data('time'));
            var label = $(this).closest('tr').find('a').first().text().trim();
            if (isNaN(ms)) { alert('Error: Could not parse time.'); this.checked = false; return; }
            if (this.checked) {
                // if (state.selected.length >= 2) { this.checked = false; alert('Select only 2 attacks'); return; }
                state.selected.push({ time: ms, label: label });
            } else {
                state.selected = state.selected.filter(s => s.time !== ms);
            }
            updateGapInfo();
        });
    }

    function fetchWorldData(file) {
        return $.ajax({ url: window.location.origin + '/map/' + file, type: 'GET', dataType: 'text' });
    }

    function fetchBarbs() {
        if (state.barbs.length > 0) return Promise.resolve(state.barbs);
        var cx = state.currentVillage.x;
        var cy = state.currentVillage.y;
        var radiusSq = CONFIG.radius * CONFIG.radius;
        var barbs = [];

        if (window.TWMap && TWMap.villages) {
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

        $('#bsResults').html('Fetching world village data (this takes a moment)...');
        return fetchWorldData('village.txt').then(function (data) {
            var lines = data.split('\n');
            lines.forEach(function (line) {
                var p = line.split(',');
                if (p.length >= 5) {
                    var pid = p[4];
                    if (pid === "0") {
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
            return barbs;
        }).catch(function (err) { alert('Error fetching village data: ' + err); return []; });
    }

    function getUnitCounts() {
        var counts = {};
        if (game_data.village && game_data.village.unit_counts) return game_data.village.unit_counts;
        var found = false;
        $('.box-item').each(function () {
            var icon = $(this).find('img').attr('src');
            if (icon) {
                var m = icon.match(/unit_(\w+)\.png/);
                if (m) {
                    var txt = $(this).text().trim().replace(/\./g, '');
                    if (txt !== '') { counts[m[1]] = parseInt(txt) || 0; found = true; }
                }
            }
        });
        if (!found) {
            $('.unit_link').each(function () {
                var u = $(this).data('unit');
                var c = parseInt($(this).text().trim().replace(/\./g, ''));
                if (u && !isNaN(c)) { counts[u] = c; found = true; }
            });
        }
        return found ? counts : null;
    }

    function getSlowerOrEqualUnits(baseUnit) {
        var baseSpeed = UNITS[baseUnit];
        var group = [];
        for (var u in UNITS) {
            if (UNITS[u] <= baseSpeed) group.push(u);
        }
        return group;
    }

    function calculateSnipe() {
        if (state.selected.length === 0) return $('#bsResults').html('<div class="bs-error">Please select an attack (the one you want to return BEFORE).</div>');
        if (state.barbs.length === 0) return $('#bsResults').html('<div class="bs-error">No barbs found! Increase radius?</div>');

        state.selected.sort((a, b) => a.time - b.time);
        var t2 = state.selected[state.selected.length - 1].time;
        var t1 = state.selected.length > 1 ? state.selected[0].time : 0;

        var targetDate = new Date(t2);
        targetDate.setMilliseconds(0);
        var targetReturn = targetDate.getTime();
        localStorage.setItem('bs_target', targetReturn); // Save for validator

        var warning = '';
        if (t1 > 0 && targetReturn <= t1) warning = '<div class="bs-error">Warning: 00ms target is BEFORE the gap start!</div>';

        var availableUnits = getUnitCounts();
        var now = getNow();
        var results = [];

        state.barbs.forEach(barb => {
            for (var unit in UNITS) {
                if (availableUnits && (!availableUnits[unit] || availableUnits[unit] <= 0)) continue;
                var speed = UNITS[unit];
                var dist = barb.dist;
                var travelSeconds = Math.round(dist * speed * 60 / CONFIG.unitSpeed / CONFIG.worldSpeed);
                var travelMs = travelSeconds * 1000;
                var totalTrip = travelMs * 2;
                var launchTime = targetReturn - totalTrip;

                if (launchTime > now) {
                    var sendUnits = getSlowerOrEqualUnits(unit);
                    var urlParams = [];
                    sendUnits.forEach(u => {
                        if (availableUnits && availableUnits[u] > 0) urlParams.push(u + '=' + availableUnits[u]);
                    });
                    var url = '/game.php?screen=place&target=' + barb.id;
                    if (urlParams.length > 0) url += '&' + urlParams.join('&');

                    results.push({ unit: unit, target: barb, launch: launchTime, return: targetReturn, url: url });
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

    // --- Time Sync & Formatting ---
    var visualServerOffset = 0;

    function calculateVisualOffset() {
        var serverTimeElem = $('#serverTime');
        var serverDateElem = $('#serverDate');
        if (serverTimeElem.length && serverDateElem.length) {
            // Parse Game Date/Time text
            // Format: HH:MM:SS and DD/MM/YYYY
            var timeParts = serverTimeElem.text().split(':');
            var dateParts = serverDateElem.text().split('/');

            if (timeParts.length === 3 && dateParts.length === 3) {
                var now = new Date();
                // Create date object from server text (treating it as local for now to get the timestamp value)
                var serverNow = new Date(
                    parseInt(dateParts[2]),
                    parseInt(dateParts[1]) - 1,
                    parseInt(dateParts[0]),
                    parseInt(timeParts[0]),
                    parseInt(timeParts[1]),
                    parseInt(timeParts[2])
                );

                // Difference between "Server Time (as Date)" and "Local Time (as Date)"
                // This offset, when added to a Local Timestamp, will produce a Date object 
                // that print's the Server's Time when .toLocaleTimeString() is called.
                visualServerOffset = serverNow.getTime() - now.getTime();
                console.log("BS: Visual Offset calculated:", visualServerOffset / 3600000, "hours");
            }
        }
    }

    // Call immediately
    calculateVisualOffset();

    function formatServerTime(ms) {
        // Apply visual offset to get a Date object that LOOKS like server time
        // but is actually a shifted local time.
        // This cheat allows toLocaleTimeString() to output the server string.
        return new Date(ms + visualServerOffset).toLocaleTimeString();
    }

    function formatTimer(sec) {
        if (sec < 0) return "PASSED";
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }

    function renderResults(results, extraHtml) {
        // Recalculate offset in case seconds ticked
        calculateVisualOffset();

        var html = extraHtml + `<table class="bs-table"><thead><tr><th>Unit</th><th>Target (Server Time)</th><th>Travel Duration</th><th>Launch Time</th><th>Wait Time</th><th>Action</th></tr></thead><tbody>`;
        results.slice(0, 15).forEach(r => {
            var now = getNow();
            var timeLeft = Math.round((r.launch - now) / 1000);
            var timerId = 'bst_' + Math.floor(Math.random() * 10000);

            // Calculate one-way travel duration
            var oneWayMs = (r.return - r.launch) / 2;
            var oneWaySec = Math.round(oneWayMs / 1000);
            var oneWayStr = formatTimer(oneWaySec);

            html += `<tr>
                <td><img src="https://dsen.innogamescdn.com/asset/d25bbc6/graphic/unit/unit_${r.unit}.png"></td>
                <td>${new Date(r.return).toLocaleTimeString()}</td>
                <td>${oneWayStr}</td>
                <td>${new Date(r.launch).toLocaleTimeString()}</td>
                <td class="bs-timer" id="${timerId}" data-time="${r.launch}">${formatTimer(timeLeft)}</td>
                <td><button class="bs-btn bs-send-btn" data-url="${r.url}" data-return="${r.return}">Send All</button></td>
            </tr>`;
        });
        html += '</tbody></table>';
        $('#bsResults').html(html);
        startTimers();
    }

    function startTimers() {
        if (window.bsInterval) clearInterval(window.bsInterval);
        window.bsInterval = setInterval(() => {
            $('.bs-timer').each(function () {
                var target = parseInt($(this).data('time'));
                var left = Math.round((target - getNow()) / 1000);
                $(this).text(formatTimer(left));
                if (left <= 5 && left >= 0) $(this).css('color', 'red').css('font-size', '16px');
                else $(this).css('color', '#a50000').css('font-size', '14px');
            });
        }, 1000);
    }

    function createUI() {
        if ($('#bsPopup').length) return;
        $('head').append(`<style>${STYLE}</style>`);
        var html = `
        <div id="bsPopup">
            <div id="bsHeader"><span>🎯 Bounce Snipe Calculator</span><button class="bs-btn" onclick="$('#bsPopup').remove()">✖</button></div>
            <div id="bsContent">
                <div class="bs-row"><span><strong>1. Select Attacks:</strong> Check 2 boxes in the incoming list.</span></div>
                <div id="bsGapInfo" class="bs-row" style="background:#fff; padding:5px; border:1px solid #ccc;">Select start and end attacks...</div>
                <div class="bs-row" style="margin-top:10px;"><button class="bs-btn" id="bsFindBarbs">Find Barbs & Calc</button><span>Radius: <input type="number" id="bsRadius" value="20" style="width:40px"></span></div>
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
        parseAttacks();
    }

    function updateGapInfo() {
        if (state.selected.length === 0) { $('#bsGapInfo').html('Select the incoming Noble you want to bounce between.'); return; }
        state.selected.sort((a, b) => a.time - b.time);
        var t2 = state.selected[state.selected.length - 1].time;
        var info = `Aiming to return at: <strong>${new Date(t2).toLocaleTimeString()}.000</strong>`;
        if (state.selected.length > 1) {
            var diff = Math.abs(state.selected[1].time - state.selected[0].time);
            info += `<br>Gap: <strong>${diff}ms</strong>`;
        }
        $('#bsGapInfo').html(info);
        if (state.barbs.length > 0) calculateSnipe();
    }

    init();
})();

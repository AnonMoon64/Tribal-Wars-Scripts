/*
 * Victim Finder - Minimal Test Version
 */
alert('VictimFinder loaded!');
console.log('VictimFinder: Script started');

if (typeof game_data === 'undefined') {
    alert('Error: Not in Tribal Wars game!');
} else {
    alert('World: ' + game_data.world);

    // Simple popup using TW's built-in UI
    var popup = document.createElement('div');
    popup.id = 'vfPopup';
    popup.style.cssText = 'position:fixed;top:100px;left:100px;width:400px;background:#f4e4bc;border:2px solid #7d510f;padding:20px;z-index:99999;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.3)';
    popup.innerHTML = '<h3 style="margin:0 0 15px 0">⚔️ Victim Finder</h3>' +
        '<p>World: ' + game_data.world + '</p>' +
        '<p>Player: ' + game_data.player.name + '</p>' +
        '<button onclick="document.getElementById(\'vfPopup\').remove()">Close</button>' +
        '<button onclick="vfScan()" style="margin-left:10px">Scan</button>';
    document.body.appendChild(popup);

    // Scan function
    window.vfScan = function () {
        popup.innerHTML = '<h3>⏳ Scanning...</h3>';

        $.get(window.location.origin + '/map/kill_att.txt', function (data) {
            var lines = data.split('\n').length;
            popup.innerHTML = '<h3>✅ Done!</h3><p>Loaded ' + lines + ' lines of ODA data</p>' +
                '<button onclick="document.getElementById(\'vfPopup\').remove()">Close</button>';
        }).fail(function (err) {
            popup.innerHTML = '<h3>❌ Error</h3><p>' + err.statusText + '</p>' +
                '<button onclick="document.getElementById(\'vfPopup\').remove()">Close</button>';
        });
    };
}

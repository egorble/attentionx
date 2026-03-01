// Test all handles for wrong-author tweets from twitterapi.io
const API_KEY = 'new1_d1be13bf77c84f1886c5a79cdb692816';
const API_BASE = 'https://api.twitterapi.io/twitter';

async function fetchAll(userName, date) {
    const nd = (() => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split('T')[0]; })();
    const query = `from:${userName} since:${date}_00:00:00_UTC until:${nd}_00:00:00_UTC -filter:replies`;
    const params = new URLSearchParams({ query, queryType: 'Latest' });
    const url = `${API_BASE}/tweet/advanced_search?${params}`;
    const res = await fetch(url, { headers: { 'X-API-Key': API_KEY } });
    const data = await res.json();
    const tweets = data.tweets || [];

    let wrong = 0;
    for (const t of tweets) {
        const a = (t.author?.userName || '').toLowerCase();
        if (a !== userName.toLowerCase()) wrong++;
    }
    if (tweets.length > 0) {
        console.log(`@${userName} ${date}: ${tweets.length} tweets (${wrong} wrong)`);
        if (wrong > 0) {
            for (const t of tweets) {
                const a = (t.author?.userName || '').toLowerCase();
                if (a !== userName.toLowerCase()) {
                    console.log(`  WRONG: @${t.author?.userName} [${t.lang}] ${(t.text || '').substring(0, 80)}`);
                }
            }
        }
    }
    return wrong;
}

const handles = ['openclaw','lovable_dev','cursor_ai','OpenAI','AnthropicAI','browser_use','dedaluslabs','autumnpricing','AxiomExchange','MultifactorCOM','getdomeapi','GrazeMate','tornyolsystems','heypocket','Caretta','axionorbital','freeportmrkts','ruvopay','lightberryai'];
const dates = ['2026-02-28','2026-02-27','2026-02-26','2026-02-25'];

(async () => {
    let totalWrong = 0;
    for (const h of handles) {
        for (const d of dates) {
            totalWrong += await fetchAll(h, d);
            await new Promise(r => setTimeout(r, 300));
        }
    }
    console.log('');
    console.log('Total wrong-author tweets found NOW: ' + totalWrong);
})();

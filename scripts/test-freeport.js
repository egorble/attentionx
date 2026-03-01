// Quick test: AI scoring for Freeport Markets with updated prompt
import { readFileSync } from 'fs';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });

const API_KEY = 'new1_d1be13bf77c84f1886c5a79cdb692816';
const API_BASE = 'https://api.twitterapi.io/twitter';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

// Read updated prompt from scorer
const scorer = readFileSync(join(__dirname, 'twitter-league-scorer.js'), 'utf8');
const promptMatch = scorer.match(/const AI_SCORER_PROMPT = `([\s\S]*?)`;/);
const AI_SCORER_PROMPT = promptMatch[1];

async function fetchTweets(userName, date) {
    const nd = (() => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().split('T')[0]; })();
    const q = `from:${userName} since:${date}_00:00:00_UTC until:${nd}_00:00:00_UTC -filter:replies`;
    const p = new URLSearchParams({ query: q, queryType: 'Latest' });
    const res = await fetch(`${API_BASE}/tweet/advanced_search?${p}`, { headers: { 'X-API-Key': API_KEY } });
    const data = await res.json();
    const tweets = data.tweets || [];
    return tweets.filter(t => (t.author?.userName || '').toLowerCase() === userName.toLowerCase());
}

async function test() {
    // Try recent dates
    let tweets = [];
    for (const date of ['2026-02-27', '2026-02-24']) {
        tweets = await fetchTweets('freeportmrkts', date);
        if (tweets.length > 0) {
            console.log(`Found ${tweets.length} tweets for ${date}`);
            break;
        }
        await new Promise(r => setTimeout(r, 500));
    }

    if (tweets.length === 0) {
        console.log('No Freeport tweets found');
        return;
    }

    for (const t of tweets) {
        console.log(`  -> ${(t.text || '').substring(0, 120)}`);
    }

    const tweetList = tweets.map((t, i) => {
        return `${i + 1}. [Likes: ${t.likeCount || 0}, RT: ${t.retweetCount || 0}]\n"${(t.text || '').substring(0, 280)}"`;
    }).join('\n\n');

    const prompt = `Analyze these ${tweets.length} tweets from Freeport Markets:\n\n${tweetList}`;

    console.log('\nSending to AI (updated prompt)...');
    const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'arcee-ai/trinity-large-preview:free',
            messages: [{ role: 'user', content: AI_SCORER_PROMPT + '\n\n---\n\n' + prompt }],
            temperature: 0.3, max_tokens: 2000
        })
    });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
        console.log('Empty AI response, status:', res.status);
        console.log('Data:', JSON.stringify(data).substring(0, 300));
        return;
    }

    const cleaned = content.replace(/^```json?\s*/, '').replace(/\s*```$/, '');
    console.log('\nAI Results (with new prompt):');
    try {
        const results = JSON.parse(cleaned);
        for (const r of results) {
            console.log(`  [${r.type} ${r.score}pts] ${r.headline}`);
        }
        const total = results.reduce((s, r) => s + r.score, 0);
        console.log(`  TOTAL: ${total}pts`);
    } catch (e) {
        console.log('Raw:', cleaned.substring(0, 500));
    }
}

test().catch(e => console.error(e));

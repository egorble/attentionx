# Tournament Scoring & Finalization System

## 📅 Daily Scoring (00:00 UTC)

### Automatic Scheduler
```bash
npm run scheduler
```

Scheduler автоматично запускає:
- **00:00 UTC** - Daily scorer (збір поінтів за день)
- **Кожну годину** - Tournament finalizer (перевірка чи турнір закінчився)

### Manual Run
```bash
# Запустити scoring вручну
npm run score

# Запустити finalization вручну
npm run finalize
```

## 🎯 Як працює Daily Scoring

### 1. Збір твітів о 00:00 UTC
- Фетчить твіти за **попередній день**
- Аналізує кожен твіт на події
- Рахує поінти для кожного стартапу

### 2. Event Detection (Розширені синоніми)

**Funding Events** (500+ pts):
- Keywords: raised, funding, seed, series a/b/c, round, investment, venture, capital, fundraising, валуація, led by

**Partnerships** (300+ pts):
- Keywords: partner, partnership, collaboration, teaming up, alliance, integration, working with

**Key Hires** (150+ pts):
- Keywords: hired, joined, welcome, welcoming, appointed, new team member
- Titles: CEO, CTO, CFO, CPO, VP, Chief, Head of, Director

**Product Launches** (250+ pts):
- Keywords: launched, launch, releasing, introducing, now available, shipping, beta, unveiling

**Revenue Milestones** (400+ pts):
- Keywords: ARR, MRR, revenue, profitable, profitability, run rate

**Acquisitions** (2000 pts):
- Keywords: acquired, acquisition, merger, acquiring, takeover

**Media Mentions** (200+ pts):
- Major outlets: TechCrunch, Forbes, WSJ, NYT, Bloomberg, CNBC, Reuters, Wired

**Growth** (200+ pts):
- Keywords: users, milestone, reached, surpassed, doubled, tripled, 10x, scaling

### 3. Logging

Всі твіти логуються в:
```
server/logs/tweets-YYYY-MM-DD.log
```

Формат:
```json
{
  "timestamp": "2026-02-10T00:00:00Z",
  "userName": "OpenAI",
  "tweetId": "123...",
  "tweetText": "We've raised...",
  "likes": 5000,
  "retweets": 1200,
  "analysis": {
    "points": 500,
    "events": ["FUNDING"],
    "details": {...}
  }
}
```

### 4. Database Update

Після аналізу:
- Зберігає daily scores в БД
- Оновлює leaderboard для всіх гравців
- Рахує total score з урахуванням rarity multipliers

## 🏁 Tournament Finalization

### Automatic Check (Hourly)

Scheduler перевіряє кожну годину:
1. Чи є активний турнір?
2. Чи час закінчення минув?
3. Чи турнір вже фіналізований?

### Finalization Process

Коли турнір закінчується:

1. **Останній збір поінтів**
   - Якщо сьогодні ще не було scoring - запускає його

2. **Aggregate Points**
   - Збирає всі daily scores за весь період турніру
   - Сумує поінти для кожного з 19 стартапів

3. **Call Smart Contract**
   ```javascript
   finalizeWithPoints(tournamentId, [
     points_startup_1,  // OpenAI
     points_startup_2,  // Anthropic
     ...
     points_startup_19  // Coinbase
   ])
   ```

4. **Prize Distribution**
   - Smart contract рахує score кожного гравця
   - Розподіляє prize pool пропорційно до scores
   - Розморожує NFT картки
   - Статус → Finalized

5. **Players Claim Prizes**
   - Гравці можуть забрати свої призи через `claimPrize(tournamentId)`

## 🔧 Configuration

### Environment Variables

Create `.env` file:
```bash
# Required for finalization
ADMIN_PRIVATE_KEY=your_admin_private_key_here

# Twitter API (already in code)
TWITTER_API_KEY=new1_d1be13bf77c84f1886c5a79cdb692816
```

### Contract Addresses

In `jobs/daily-scorer.js` and `jobs/finalize-tournament.js`:
```javascript
const PACK_OPENER_ADDRESS = '0x638B92a58a8317e5f47247B5bD47cb16faA87eD9';
const TOURNAMENT_ADDRESS = '0x6036a89aE64cd3A1404E0e093A80622E949942d0';
const NFT_ADDRESS = '0x757e1f6f8c52Cd367fa42cb305de227CDC308140';
```

## 📊 Monitoring

### Check Logs
```bash
# Daily scorer output
tail -f server/logs/tweets-2026-02-10.log

# Scheduler status
# Run scheduler in foreground to see live output
npm run scheduler
```

### Manual Testing
```bash
# Test scoring
npm run score

# Test finalization check
npm run finalize
```

## 🚀 Production Deployment

### Option 1: systemd (Linux)

Create `/etc/systemd/system/fantasyyc-scheduler.service`:
```ini
[Unit]
Description=FantasyYC Tournament Scheduler
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/fantasyyc/server
ExecStart=/usr/bin/node jobs/scheduler.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Start:
```bash
sudo systemctl enable fantasyyc-scheduler
sudo systemctl start fantasyyc-scheduler
```

### Option 2: PM2
```bash
pm2 start jobs/scheduler.js --name fantasyyc-scheduler
pm2 save
pm2 startup
```

### Option 3: Windows Task Scheduler

Create scheduled task:
- Trigger: At system startup
- Action: Start program `node`
- Arguments: `C:\path\to\server\jobs\scheduler.js`
- Start in: `C:\path\to\server`

## 📈 Flow Chart

```
Daily (00:00 UTC)
     ↓
Fetch tweets for 19 startups
     ↓
Analyze for events (with synonyms)
     ↓
Calculate points
     ↓
Log to file
     ↓
Update database
     ↓
Update leaderboard

Hourly Check
     ↓
Tournament ended?
     ↓ Yes
Aggregate all daily scores
     ↓
Call finalizeWithPoints()
     ↓
Smart contract distributes prizes
     ↓
Players can claim
```

## ⚠️ Important Notes

1. **Scheduler must be running** для автоматичного scoring
2. **Admin private key** потрібний для finalization
3. **Logs folder** створюється автоматично
4. **Twitter API credits** - перевіряй баланс
5. **Timezone** - всі часи в UTC

## 🐛 Troubleshooting

### Scorer не запускається
```bash
# Check scheduler status
ps aux | grep scheduler

# Check logs
cat server/logs/tweets-*.log
```

### Finalization fails
```bash
# Check admin key
echo $ADMIN_PRIVATE_KEY

# Check contract addresses
npm run finalize
```

### Missing points
```bash
# Check tweet logs
cat server/logs/tweets-2026-02-10.log | grep "FUNDING"

# Re-run scorer for testing
npm run score
```

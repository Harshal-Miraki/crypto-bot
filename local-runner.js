// Using Node.js native fetch (v18+)

const INTERVAL_MS = 60 * 1000; // 1 Minute (Essential for Trailing Stops)
const BOT_URL = 'http://localhost:3000/api/bot';

console.log(`Starting Local Bot Runner...`);
console.log(`Target: ${BOT_URL}`);
console.log(`Interval: ${INTERVAL_MS / 60000} minutes`);

async function runBot() {
    try {
        const timestamp = new Date().toLocaleString();
        console.log(`[${timestamp}] Triggering Bot...`);
        
        const response = await fetch(BOT_URL);
        const data = await response.json();
        
        if (data.error) {
             console.error(`[${timestamp}] ❌ Error: ${data.error}`);
        } else if (Array.isArray(data)) {
             data.forEach(item => {
                 if (item.error) {
                    console.error(`[${timestamp}] ❌ ${item.symbol}: ${item.error}`);
                 } else {
                    console.log(`[${timestamp}] ✅ ${item.symbol}: ${item.signal} | Price: $${item.price}`);
                    if (item.emailSent) console.log(`   -> 📧 Email Sent for ${item.symbol}!`);
                 }
             });
        }
    } catch (error) {
        console.error(`[${timestamp}] ❌ Network Error: Is the app running?`);
    }
}

// Initial Run
runBot();

// Loop
setInterval(runBot, INTERVAL_MS);

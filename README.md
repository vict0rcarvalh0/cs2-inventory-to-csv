# CSGO Inventory to CSV

Export your CS:GO/CS2 inventory to CSV with live Steam Community Market prices. Free, no API key needed.

## Prerequisites

- [Node.js](https://nodejs.org/en/download) (v16 or higher)
- pnpm, npm, or yarn

## Installation & Usage

### Option 1: From npm (Global Install)

```bash
npm install -g csgo-inventory-csv
csgo-inventory-csv
```

### Option 2: Run Locally (Development)

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Run the built version
node build/index.js

# Or run with verbose logging
node build/index.js --verbose
```

The interactive prompts will guide you through:
1. Enter Steam user IDs (comma-separated)
2. Select currency from the list (USD, EUR, GBP, RUB, BRL, CAD, AUD, CNY, INR, JPY, KRW, TRY, UAH, MXN, ARS, CLP)

Output CSV files will be saved in the current directory with format: `{userId}_{steamId64}_{timestamp}.csv`

### CSV Output Fields
- Type, MarketName, MarketHashName, Marketable
- Exterior, ItemSet, Quality, Rarity, Weapon
- **LowestPrice**, **MedianPrice**, **Volume** (from Steam Market)
- Currency

**Note:** Fetching prices takes ~3 seconds per item (Steam rate limit). Large inventories will take time.

## Demo

View a [sample CSV file](https://github.com/imlokesh/csgo-inventory-csv/blob/master/assets/imlokesh_76561198312488313_1682246447.csv) or watch the demo:

![csgo-inventory-csv demo](https://github.com/imlokesh/csgo-inventory-csv/blob/master/assets/csgo-inventory-csv.gif)

## Price Data Source

Prices are fetched from **Steam Community Market** (official, free):
- Rate limit: ~20 requests/minute
- Automatically retries on rate limits
- Caches prices per session
- No API key required

## Common Issues

### "Inventory is PRIVATE" (401 Error)
The Steam inventory must be set to **public**:
1. Go to your Steam Profile
2. Click "Edit Profile"
3. Go to "Privacy Settings"
4. Set "Game Details" to **Public**
5. Set "Inventory" to **Public**

### Slow price fetching
Steam Market enforces rate limits (3 sec delay per item). This is intentional to avoid bans.

## Security

This project has been hardened with:
- Path traversal protection
- Input validation for Steam IDs
- XML External Entity (XXE) attack prevention
- Updated dependencies with security patches
- Proper User-Agent and headers for API compliance

# CSGO Inventory Exporter

[![npm](https://img.shields.io/npm/v/@vict0rcarvalh0/cs2-inventory-to-csv?style=plastic)](https://www.npmjs.com/package/@vict0rcarvalh0/cs2-inventory-to-csv)
[![npm](https://img.shields.io/npm/dm/@vict0rcarvalh0/cs2-inventory-to-csv?style=plastic)](https://www.npmjs.com/package/@vict0rcarvalh0/cs2-inventory-to-csv)

Export your CS:GO/CS2 inventory to CSV or JSON with live Steam Community Market prices. Free, no API key needed.

## Prerequisites

- [Node.js](https://nodejs.org/en/download) (v16 or higher)
- pnpm, npm, or yarn

## Installation & Usage

### Option 1: From npm (Global Install)

```bash
npm install -g @vict0rcarvalh0/cs2-inventory-to-csv
cs2-inventory-to-csv
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
3. Select export format (CSV, JSON, or ALL)
4. Optional: Filter weapon skins only
5. Optional: Filter by custom price range

Output files will be saved in the current directory with format: `{userId}_{steamId64}_{timestamp}.{csv|json}`

### Output Fields
- Type, MarketName, MarketHashName, Marketable
- Exterior, ItemSet, Quality, Rarity, Weapon
- **LowestPrice**, **MedianPrice**, **Volume** (from Steam Market)
- Currency

Both CSV and JSON formats include the same fields. JSON provides a structured format ideal for programmatic access.

**Note:** Fetching prices takes ~3 seconds per item (Steam rate limit). Large inventories will take time.

## Demo

View a [sample CSV file](https://github.com/vict0rcarvalh0/cs2-inventory-to-csv/blob/main/assets/homerokb_76561198074182328_1759429635.csv)

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

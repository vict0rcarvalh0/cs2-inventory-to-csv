#!/usr/bin/env node

import { stringify } from "csv-stringify/sync";
import * as fs from "fs";
import NodeCache from "node-cache";
import axios from "axios";
import { Inventory, ParsedItem, PriceData } from "./types";
import winston from "winston";
import inquirer from "inquirer";
import { XMLParser } from "fast-xml-parser";

const log = winston.createLogger({
  level: "debug",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    winston.format.printf((info) => `${info.timestamp} [${info.level}] - ${info.message}`)
  ),
  transports: [new winston.transports.Console()],
});

let ids: string[] = Array();
let selectedCurrency: string = "USD";
let steamCurrencyId: number = 1; // Default to USD
let skinsOnly: boolean = false;
let priceRangeFilter: boolean = false;
let minPrice: number = 0;
let maxPrice: number = Infinity;
let exportFormat: string = "csv";

// Map common currency codes to Steam currency IDs
const currencyMap: { [key: string]: number } = {
  'USD': 1,  // US Dollar
  'EUR': 3,  // Euro
  'GBP': 2,  // British Pound
  'RUB': 5,  // Russian Ruble
  'BRL': 7,  // Brazilian Real
  'CAD': 20, // Canadian Dollar
  'AUD': 21, // Australian Dollar
  'CNY': 23, // Chinese Yuan
  'INR': 24, // Indian Rupee
  'JPY': 8,  // Japanese Yen
  'KRW': 9,  // South Korean Won
  'TRY': 17, // Turkish Lira
  'UAH': 18, // Ukrainian Hryvnia
  'MXN': 19, // Mexican Peso
  'ARS': 34, // Argentine Peso
  'CLP': 35, // Chilean Peso
};

await inquirer
  .prompt([
    {
      type: "input",
      message: "Please enter steam user ids separated by comma: ",
      name: "ids",
      validate: (input) => parseIds(input).length > 0 || "Please a valid value. ",
    },
    {
      type: "list",
      message: "Please select currency: ",
      name: "currency",
      default: "USD",
      choices: Object.keys(currencyMap),
    },
    {
      type: "list",
      message: "Please select export format: ",
      name: "exportFormat",
      default: "csv",
      choices: ["csv", "json", "all"],
    },
    {
      type: "confirm",
      message: "Export weapon skins only? (excludes cases, keys, stickers, etc.)",
      name: "skinsOnly",
      default: false,
    },
    {
      type: "confirm",
      message: "Do you want to filter by a specific price range?",
      name: "priceRangeFilter",
      default: false,
    },
    {
      type: "number",
      message: "Initial price range:",
      name: "minPrice",
      default: 0,
      when: (answers) => answers.priceRangeFilter,
      validate: (input) => input >= 0 || "Price must be a positive number",
    },
    {
      type: "number",
      message: "End price range:",
      name: "maxPrice",
      default: 100,
      when: (answers) => answers.priceRangeFilter,
      validate: (input, answers) => {
        if (input <= 0) return "Price must be a positive number";
        if (input <= answers.minPrice) return "End price must be greater than initial price";
        return true;
      },
    },
  ])
  .then((answers) => {
    ids = parseIds(answers.ids);
    selectedCurrency = answers.currency.toUpperCase();
    steamCurrencyId = currencyMap[selectedCurrency] || 1;
    exportFormat = answers.exportFormat;
    skinsOnly = answers.skinsOnly;
    priceRangeFilter = answers.priceRangeFilter;
    
    if (priceRangeFilter) {
      minPrice = answers.minPrice || 0;
      maxPrice = answers.maxPrice || Infinity;
      log.info(`Price range filter: $${minPrice} - $${maxPrice}`);
      if (selectedCurrency !== 'USD') {
        log.warn('Price range filter works best with USD currency!');
      }
    }
    
    log.info(`Using currency: ${selectedCurrency} (Steam ID: ${steamCurrencyId})`);
    log.info(`Export format: ${exportFormat}`);
    log.info(`Skins only mode: ${skinsOnly ? 'enabled' : 'disabled'}`);
  });

log.debug(`Input ids are ${JSON.stringify(ids)}`);

let cache = new NodeCache();

// Add default headers to avoid 403 errors
axios.defaults.headers.common['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
axios.defaults.headers.common['Accept'] = 'application/json';

axios.interceptors.request.use((req) => {
  if (req.transitional) {
    req.transitional.silentJSONParsing = false;
    req.transitional.forcedJSONParsing = false;
  }
  log.debug(`${req.method} ${req.url}`);
  return req;
});

// Delay helper to avoid rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Filter function to check if item is a weapon skin
function isWeaponSkin(desc: any): boolean {
  const type = desc.type?.toLowerCase() || "";
  
  // Exclude non-skin items
  const excludeTypes = [
    "container", "case", "key", "sticker", "graffiti", "patch", 
    "pin", "music kit", "pass", "tool", "gift", "tag", "coin"
  ];
  
  if (excludeTypes.some(excluded => type.includes(excluded))) {
    return false;
  }
  
  // Check if it has a Weapon tag (most reliable indicator)
  const hasWeaponTag = desc.tags?.some((t: any) => t.category === "Weapon");
  
  // Allow items with weapon tags OR items with exterior tags (skins have wear)
  const hasExteriorTag = desc.tags?.some((t: any) => t.category === "Exterior");
  
  return hasWeaponTag || hasExteriorTag;
}

// Parse price string and extract numeric value
function parsePriceValue(priceString: string): number | null {
  if (!priceString) return null;
  
  // Remove currency symbols and common formatting
  // Examples: "$19.50", "19,50€", "R$ 100,00", "¥1,234"
  const cleaned = priceString.replace(/[^0-9.,]/g, '');
  
  // Handle both comma and dot as decimal separator
  // If both exist, assume the last one is decimal separator
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // e.g., "1,234.56" or "1.234,56"
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastDot > lastComma) {
      // "1,234.56" format - remove commas
      normalized = cleaned.replace(/,/g, '');
    } else {
      // "1.234,56" format - remove dots, replace comma with dot
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else if (cleaned.includes(',')) {
    // Only comma - could be decimal or thousands separator
    // If only one comma and it's near the end (last 3 chars), treat as decimal
    const commaPos = cleaned.indexOf(',');
    if (cleaned.length - commaPos <= 3) {
      normalized = cleaned.replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  }
  
  const value = parseFloat(normalized);
  return isNaN(value) ? null : value;
}

// Check if price is in the target range
function isInPriceRange(priceString: string, currencyCode: string, min: number, max: number): boolean {
  const value = parsePriceValue(priceString);
  if (value === null) return false;
  
  // For USD, direct comparison
  if (currencyCode === 'USD') {
    return value >= min && value <= max;
  }
  
  // For other currencies, we can't reliably convert without real-time exchange rates
  // So we'll be permissive and warn the user
  return true;
}

// Fetch price from Steam Community Market
async function getSteamMarketPrice(marketHashName: string, currencyId: number): Promise<any> {
  try {
    // Steam Market API - free and official
    const res = await axios.get('https://steamcommunity.com/market/priceoverview/', {
      params: {
        appid: 730, // CS:GO/CS2
        currency: currencyId,
        market_hash_name: marketHashName
      },
      headers: {
        'Referer': 'https://steamcommunity.com/market/',
      },
      timeout: 15000
    });

    // Parse JSON if it's a string (due to axios transitional settings)
    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    
    log.debug(`Parsed price data for ${marketHashName}: ${JSON.stringify(data)}`);

    if (data?.success) {
      return {
        success: true,
        lowest_price: data.lowest_price || '',
        median_price: data.median_price || '',
        volume: data.volume || '',
      };
    }
    
    return { success: false };
  } catch (error: any) {
    throw error;
  }
}

for (const id of ids) {
  log.info(`Getting SteamId64 for ${id}. `);

  let url = `https://steamcommunity.com/id/${id}?xml=1`;

  let steamId64 = "";

  try {
    let res = await axios.get(url);
    steamId64 = new XMLParser().parse(res.data).profile.steamID64;
    if (steamId64 == undefined) throw new Error("Could not parse SteamID64");
  } catch (error) {
    console.error("Error getting SteamId64. ", error);
    continue;
  }

  let inventoryUrl = `https://steamcommunity.com/inventory/${steamId64}/730/2?l=english&count=200`;

  log.info(`Getting csgo inventory for ${steamId64}`);

  try {
    let res = await axios.get(inventoryUrl);
    let inventoryData = res.data;
    var inventoryItems: Inventory = JSON.parse(inventoryData);
  } catch (error) {
    console.error("Error getting inventory data. ", error);
    continue;
  }

  let parsedItems: ParsedItem[] = new Array();

  for (const asset of inventoryItems.assets) {
    let desc = inventoryItems.descriptions.find((d) => asset.classid == d.classid);

    if (desc == undefined) {
      log.error(`Could not find description for ${JSON.stringify(asset)}`);
      continue;
    }

    // Skip non-skins if skins-only mode is enabled
    if (skinsOnly && !isWeaponSkin(desc)) {
      log.debug(`Skipping non-skin item: ${desc.market_name}`);
      continue;
    }

    let itemId = desc.market_hash_name;
    let priceRes: string | undefined = cache.get(itemId);

    if (desc.marketable && priceRes != undefined) log.debug("CACHE HIT");

    if (desc.marketable && priceRes == undefined) {
      try {
        log.info(`Getting price for ${desc.market_hash_name} from Steam Market...`);
        
        // Steam Market rate limit: ~20 req/min = 3 sec delay to be safe
        await delay(3000);
        
        const priceData = await getSteamMarketPrice(itemId, steamCurrencyId);
        
        if (priceData.success) {
          priceRes = JSON.stringify({
            lowest_price: priceData.lowest_price,
            median_price: priceData.median_price,
            volume: priceData.volume,
            currency: selectedCurrency
          });
          log.debug(`✓ Got price: ${priceData.lowest_price}`);
        } else {
          log.warn(`No market data available for ${desc.market_hash_name}`);
        }
      } catch (error: any) {
        if (error?.response?.status === 429) {
          log.warn(`Rate limited by Steam Market. Waiting 5 seconds...`);
          await delay(5000);
          // Retry once
          try {
            const priceData = await getSteamMarketPrice(itemId, steamCurrencyId);
            if (priceData.success) {
              priceRes = JSON.stringify({
                lowest_price: priceData.lowest_price,
                median_price: priceData.median_price,
                volume: priceData.volume,
                currency: selectedCurrency
              });
            }
          } catch (retryError) {
            log.error(`Retry failed for ${desc.market_hash_name}`);
          }
        } else {
          log.error(`Error getting price for ${desc.market_hash_name}: ${error?.response?.status || error.message}`);
        }
      }
    }

    let priceData: PriceData | null = null;

    try {
      priceData = JSON.parse(priceRes ?? "{}");
      cache.set(itemId, priceRes);
    } catch (error) {
      log.error(`Error parsing price data. Invalid json response. `);
      log.debug(priceRes);
    }

    // Apply price range filter if enabled
    if (priceRangeFilter) {
      const lowestPrice = priceData?.lowest_price || "";
      if (!lowestPrice || !isInPriceRange(lowestPrice, selectedCurrency, minPrice, maxPrice)) {
        log.debug(`Skipping ${desc.market_name} - price ${lowestPrice} outside $${minPrice}-$${maxPrice} range`);
        continue;
      }
      log.debug(`✓ ${desc.market_name} - price ${lowestPrice} is in range`);
    }

    parsedItems.push({
      Type: desc.type,
      MarketName: desc.market_name,
      MarketHashName: desc.market_hash_name,
      Marketable: desc.marketable == 1 ? "Yes" : "No",
      Exterior: desc.tags.find((t) => t.category == "Exterior")?.localized_tag_name || "",
      ItemSet: desc.tags.find((t) => t.category == "ItemSet")?.localized_tag_name || "",
      Quality: desc.tags.find((t) => t.category == "Quality")?.localized_tag_name || "",
      Rarity: desc.tags.find((t) => t.category == "Rarity")?.localized_tag_name || "",
      Weapon: desc.tags.find((t) => t.category == "Weapon")?.localized_tag_name || "",
      LowestPrice: priceData?.lowest_price || "",
      MedianPrice: priceData?.median_price || "",
      Volume: priceData?.volume || "",
      Currency: priceData?.currency || "",
    });
  }
  
  const timestamp = Math.round(new Date().getTime() / 1000);
  const baseFilename = `${id}_${steamId64}_${timestamp}`;
  
  // Export based on selected format
  if (exportFormat === "csv" || exportFormat === "all") {
    const csvFilename = `${baseFilename}.csv`;
    log.info(`Saving CSV data to ${csvFilename}`);
    fs.writeFileSync(csvFilename, stringify(parsedItems, { header: true }));
  }
  
  if (exportFormat === "json" || exportFormat === "all") {
    const jsonFilename = `${baseFilename}.json`;
    log.info(`Saving JSON data to ${jsonFilename}`);
    fs.writeFileSync(jsonFilename, JSON.stringify(parsedItems, null, 2));
  }
}

function parseIds(idstr: string) {
  if (!idstr) return [];
  return idstr
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

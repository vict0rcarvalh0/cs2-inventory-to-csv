#!/usr/bin/env node

import { stringify } from "csv-stringify/sync";
import * as fs from "fs";
import NodeCache from "node-cache";
import axios from "axios";
import { Inventory, ParsedItem, PriceData } from "./types";
import winston from "winston";
import inquirer from "inquirer";
import { XMLParser } from "fast-xml-parser";
import { argv } from "process";

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
  ])
  .then((answers) => {
    ids = parseIds(answers.ids);
    selectedCurrency = answers.currency.toUpperCase();
    steamCurrencyId = currencyMap[selectedCurrency] || 1;
    log.info(`Using currency: ${selectedCurrency} (Steam ID: ${steamCurrencyId})`);
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
  let filename = `${id}_${steamId64}_${Math.round(new Date().getTime() / 1000)}.csv`;
  log.info(`Saving data to ${filename}`);
  fs.writeFileSync(filename, stringify(parsedItems, { header: true }));
}

function parseIds(idstr: string) {
  if (!idstr) return [];
  return idstr
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

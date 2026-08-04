const { PRICE_PROVIDERS } = require("../../constants");
const env = require("../../config/env");
const { toMinor } = require("../../utils/money");

/**
 * Live crypto prices from CoinGecko's public API.
 *
 * Chosen as the one real adapter because it needs no API key, so this code
 * path is verifiable by anyone cloning the repo. Equity providers all require
 * registration; adding one means writing a module with this same shape and
 * listing it in the registry.
 *
 * `providerSymbol` is CoinGecko's id ("bitcoin"), not the ticker ("BTC").
 */
const BATCH_LIMIT = 100;

async function request(path, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${env.prices.coingeckoBaseUrl}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    if (response.status === 429) {
      throw new Error("Rate limited by CoinGecko — back off and retry later");
    }
    if (!response.ok) {
      throw new Error(`CoinGecko responded ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    // A vendor timeout must read as a vendor failure, not a generic abort.
    if (err.name === "AbortError") {
      throw new Error(`CoinGecko timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  name: PRICE_PROVIDERS.COINGECKO,
  requiresNetwork: true,

  async fetchQuote(holding) {
    const [quote] = await this.fetchQuotes([holding]);
    return quote?.quote ?? null;
  },

  /**
   * One request for many symbols. Fetching per holding would multiply the
   * request count by the size of the portfolio and hit the free tier's limit
   * on any account with more than a handful of positions.
   */
  async fetchQuotes(holdings) {
    const wanted = holdings.filter((holding) => holding.providerSymbol);
    if (wanted.length === 0) return [];

    const results = [];

    for (let offset = 0; offset < wanted.length; offset += BATCH_LIMIT) {
      const batch = wanted.slice(offset, offset + BATCH_LIMIT);
      const ids = [...new Set(batch.map((h) => h.providerSymbol.toLowerCase()))];
      const currencies = [...new Set(batch.map((h) => h.currency.toLowerCase()))];

      const data = await request(
        `/simple/price?ids=${encodeURIComponent(ids.join(","))}` +
          `&vs_currencies=${encodeURIComponent(currencies.join(","))}`
      );

      const asOf = new Date();

      for (const holding of batch) {
        const row = data[holding.providerSymbol.toLowerCase()];
        const price = row?.[holding.currency.toLowerCase()];

        results.push({
          holding,
          quote:
            typeof price === "number"
              ? { priceMinor: toMinor(price), currency: holding.currency, asOf }
              : null,
          error:
            typeof price === "number"
              ? null
              : `CoinGecko returned no ${holding.currency} price for "${holding.providerSymbol}"`,
        });
      }
    }

    return results;
  },
};

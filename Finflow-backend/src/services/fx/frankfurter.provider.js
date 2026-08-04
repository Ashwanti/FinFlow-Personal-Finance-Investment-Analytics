const env = require("../../config/env");

/**
 * Live reference rates from frankfurter.app, which republishes the European
 * Central Bank's daily fixings.
 *
 * Chosen for the same reason as CoinGecko on the price side: no API key, so
 * this path is verifiable by anyone cloning the repo rather than being dead
 * code behind a signup.
 *
 * Two things it is not. ECB rates are a daily mid-market fixing, so they are
 * not the rate your bank gave you and they do not move intraday — which is
 * fine for valuing a portfolio and wrong for settling a trade. And its coverage
 * is roughly thirty major currencies; anything outside that stays manual.
 */
async function request(path, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${env.fx.frankfurterBaseUrl}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Frankfurter responded ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Frankfurter timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  name: "frankfurter",
  requiresNetwork: true,

  /**
   * One request covers every quote currency, because the endpoint takes a list.
   *
   * @returns {Promise<{base:string, quote:string, rate:number, asOf:Date}[]>}
   */
  async fetchRates(base, quotes) {
    const wanted = [...new Set(quotes.map((code) => code.toUpperCase()))].filter(
      (code) => code !== base.toUpperCase()
    );
    if (wanted.length === 0) return [];

    const data = await request(
      `/latest?from=${encodeURIComponent(base.toUpperCase())}` +
        `&to=${encodeURIComponent(wanted.join(","))}`
    );

    // `date` is the fixing date, not the fetch time — reporting it honestly is
    // what lets a caller see that Saturday's rate is Friday's rate.
    const asOf = data.date ? new Date(`${data.date}T00:00:00Z`) : new Date();

    return Object.entries(data.rates ?? {})
      .filter(([, rate]) => typeof rate === "number")
      .map(([quote, rate]) => ({ base: base.toUpperCase(), quote, rate, asOf }));
  },
};

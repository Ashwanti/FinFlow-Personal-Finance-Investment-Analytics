const { PRICE_PROVIDERS } = require("../../constants");

/**
 * Prices the user maintains themselves.
 *
 * The default, and the reason the portfolio works with no API key, no network
 * and no vendor account. For an Indian mutual fund or an unlisted holding it
 * is often the only option anyway.
 */
module.exports = {
  name: PRICE_PROVIDERS.MANUAL,
  requiresNetwork: false,

  /** @returns {{priceMinor:number, currency:string, asOf:Date}|null} */
  async fetchQuote(holding) {
    if (holding.manualPriceMinor === null || holding.manualPriceMinor === undefined) {
      return null;
    }

    return {
      priceMinor: holding.manualPriceMinor,
      currency: holding.currency,
      // The price is as current as the user's last edit, not as of now.
      asOf: holding.updatedAt ?? new Date(),
    };
  },
};

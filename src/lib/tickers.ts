/** Company names for common tickers, so "NVDA" also matches headlines that say "Nvidia". */
const ALIASES: Record<string, string[]> = {
  NVDA: ["Nvidia"], AMD: ["AMD", "Advanced Micro"], TSM: ["TSMC", "Taiwan Semiconductor"], AVGO: ["Broadcom"], ASML: ["ASML"],
  MU: ["Micron"], INTC: ["Intel"], QCOM: ["Qualcomm"], ARM: ["Arm Holdings"], SMCI: ["Super Micro", "Supermicro"], MRVL: ["Marvell"],
  AMAT: ["Applied Materials"], LRCX: ["Lam Research"], KLAC: ["KLA"], TXN: ["Texas Instruments"], AAPL: ["Apple"], MSFT: ["Microsoft"],
  GOOGL: ["Google", "Alphabet"], GOOG: ["Google", "Alphabet"], AMZN: ["Amazon"], META: ["Meta", "Facebook"], TSLA: ["Tesla"],
  NFLX: ["Netflix"], ORCL: ["Oracle"], CRM: ["Salesforce"], PLTR: ["Palantir"], COIN: ["Coinbase"], JPM: ["JPMorgan"],
  XOM: ["Exxon"], CVX: ["Chevron"], QQQ: ["Nasdaq"], SPY: ["S&P 500", "S&P"], SOXX: ["chip stocks", "semiconductor", "chipmakers"],
  SMH: ["chip stocks", "semiconductor", "chipmakers"], DIA: ["Dow"], IWM: ["Russell 2000", "small caps"], "BTC-USD": ["Bitcoin"],
  "^VIX": ["VIX", "volatility"], "^TNX": ["Treasury yield", "10-year"], "CL=F": ["oil", "crude"], "GC=F": ["gold"], "DX-Y.NYB": ["dollar"],
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function tickerMatcher(symbol: string): RegExp {
  const terms = [symbol.replace(/^\^/, ""), ...(ALIASES[symbol.toUpperCase()] ?? [])].map(esc);
  return new RegExp(`\\b(${terms.join("|")})\\b`, "i");
}

/** Friendly names for symbols that aren't self-explanatory. Safe to import on the client. */
export const SYMBOL_LABELS: Record<string, string> = {
  // US
  "^GSPC": "S&P 500",
  "^DJI": "Dow Jones",
  "^NDX": "Nasdaq 100",
  "^IXIC": "Nasdaq",
  "^RUT": "Russell 2000",
  // World
  "^STOXX50E": "Euro Stoxx 50",
  "^FTSE": "FTSE 100",
  "^GDAXI": "DAX",
  "^N225": "Nikkei 225",
  "^HSI": "Hang Seng",
  "000001.SS": "Shanghai",
  "^KS11": "KOSPI",
  "^BSESN": "Sensex",
  "005930.KS": "Samsung",
  "0700.HK": "Tencent",
  "7203.T": "Toyota",
  "MC.PA": "LVMH",
  // Vietnam
  "^VNINDEX.VN": "VN-Index",
  "^VN30.VN": "VN30",
  "^HNX.VN": "HNX",
  "^HNX30.VN": "HNX30",
  "^UPCOM.VN": "UPCoM",
  "E1VFVN30.VN": "VN30 ETF",
  // Macro
  "^VIX": "VIX",
  "^TNX": "US 10Y",
  "CL=F": "Oil",
  "GC=F": "Gold",
  "DX-Y.NYB": "Dollar",
  "BTC-USD": "Bitcoin",
  "VND=X": "USD/VND",
  "EURUSD=X": "EUR/USD",
  "JPY=X": "USD/JPY",
  "CNY=X": "USD/CNY",
};

/** "^VNINDEX.VN" → "VN-Index", "FPT.VN" → "FPT", "AAPL" → "AAPL". */
export function symLabel(s: string): string {
  return SYMBOL_LABELS[s] ?? s.replace(/\.VN$/, "");
}

/** Yields are quoted in percent, not price. */
export const isPercentQuote = (s: string) => s === "^TNX";

/** The exchange's time zone, for chart labels ("9:15" in Hanoi, not New York). */
export function exchangeTz(s: string): string {
  if (s.endsWith(".VN")) return "Asia/Ho_Chi_Minh";
  if (s.endsWith(".T") || s === "^N225" || s === "JPY=X") return "Asia/Tokyo";
  if (s.endsWith(".KS") || s === "^KS11") return "Asia/Seoul";
  if (s.endsWith(".HK") || s === "^HSI") return "Asia/Hong_Kong";
  if (s.endsWith(".SS") || s.endsWith(".SZ")) return "Asia/Shanghai";
  if (s.endsWith(".L") || s === "^FTSE") return "Europe/London";
  if (s.endsWith(".DE") || s === "^GDAXI" || s === "^STOXX50E") return "Europe/Berlin";
  if (s.endsWith(".PA")) return "Europe/Paris";
  if (s.endsWith(".BO") || s.endsWith(".NS") || s === "^BSESN") return "Asia/Kolkata";
  return "America/New_York";
}

/**
 * Every listed Vietnamese stock and ETF (HOSE, HNX, UPCoM) for search: VNDirect's public listing,
 * cached for a day in memory and in the store, with a built-in list of the largest names as backup.
 * Matching ignores Vietnamese accents, so "hoa phat", "Hòa Phát" and "HPG" all find Hoa Phat.
 */
import { getJSON, setJSON } from "./store";

export interface VnListing {
  code: string;
  /** Short brand name, e.g. "VINAMILK", "Vietcombank". */
  short: string;
  /** Full legal name in Vietnamese. */
  name: string;
  nameEn?: string;
  floor: string;
  type: "STOCK" | "ETF";
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const KEY = "vnlist";
const TTL_MS = 24 * 3600_000;

/** The biggest names, so search works even if the listing can't be fetched. */
const BUILTIN: [string, string, string][] = [
  ["VCB", "Vietcombank", "HOSE"], ["BID", "BIDV", "HOSE"], ["CTG", "VietinBank", "HOSE"], ["TCB", "Techcombank", "HOSE"], ["MBB", "MB Bank", "HOSE"],
  ["VPB", "VPBank", "HOSE"], ["ACB", "ACB", "HOSE"], ["HDB", "HDBank", "HOSE"], ["STB", "Sacombank", "HOSE"], ["SHB", "SHB", "HOSE"], ["VIB", "VIB", "HOSE"],
  ["TPB", "TPBank", "HOSE"], ["LPB", "LPBank", "HOSE"], ["VIC", "Vingroup", "HOSE"], ["VHM", "Vinhomes", "HOSE"], ["VRE", "Vincom Retail", "HOSE"],
  ["NVL", "Novaland", "HOSE"], ["KDH", "Khang Điền", "HOSE"], ["DXG", "Đất Xanh", "HOSE"], ["FPT", "FPT", "HOSE"], ["MWG", "Thế Giới Di Động", "HOSE"],
  ["PNJ", "PNJ", "HOSE"], ["MSN", "Masan", "HOSE"], ["VNM", "Vinamilk", "HOSE"], ["SAB", "Sabeco", "HOSE"], ["HPG", "Hòa Phát", "HOSE"],
  ["HSG", "Hoa Sen", "HOSE"], ["NKG", "Nam Kim", "HOSE"], ["GAS", "PV Gas", "HOSE"], ["PLX", "Petrolimex", "HOSE"], ["POW", "PV Power", "HOSE"],
  ["GVR", "Cao su Việt Nam", "HOSE"], ["SSI", "Chứng khoán SSI", "HOSE"], ["VND", "VNDirect", "HOSE"], ["VCI", "Vietcap", "HOSE"], ["HCM", "HSC", "HOSE"],
  ["VJC", "Vietjet", "HOSE"], ["HVN", "Vietnam Airlines", "HOSE"], ["DGC", "Hóa chất Đức Giang", "HOSE"], ["REE", "REE", "HOSE"], ["BCM", "Becamex", "HOSE"],
  ["SHS", "Chứng khoán SHS", "HNX"], ["PVS", "PTSC", "HNX"], ["IDC", "IDICO", "HNX"], ["CEO", "C.E.O Group", "HNX"], ["ACV", "Cảng hàng không Việt Nam", "UPCOM"],
  ["BSR", "Lọc hóa dầu Bình Sơn", "HOSE"], ["E1VFVN30", "ETF DCVFMVN30", "HOSE"], ["FUEVFVND", "ETF DCVFMVN Diamond", "HOSE"],
];

let mem: { at: number; list: VnListing[] } | null = null;
/** Tests only. */
export function resetVnList() {
  mem = null;
}

/** Lowercase, strip Vietnamese accents (đ → d), collapse spaces. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Parse VNDirect's /v4/stocks response. Exported for tests. */
export function parseVnList(j: unknown): VnListing[] {
  const rows = ((j as { data?: Record<string, unknown>[] })?.data ?? []) as Record<string, unknown>[];
  return rows
    .filter((r) => typeof r.code === "string" && /^[A-Z0-9]{3,10}$/.test(r.code as string))
    .map((r) => ({
      code: r.code as string,
      short: String(r.shortName ?? r.companyName ?? r.code).trim().replace(/^CTCP\s+/i, ""),
      name: String(r.companyName ?? r.shortName ?? r.code).trim(),
      nameEn: r.companyNameEng ? String(r.companyNameEng).trim() : undefined,
      floor: String(r.floor ?? ""),
      type: r.type === "ETF" ? "ETF" : "STOCK",
    }));
}

export async function vnListings(): Promise<VnListing[]> {
  if (mem && Date.now() - mem.at < TTL_MS) return mem.list;
  const stored = await getJSON<{ at: number; list: VnListing[] }>(KEY).catch(() => null);
  if (stored?.list?.length && Date.now() - stored.at < TTL_MS) {
    mem = stored;
    return stored.list;
  }
  try {
    const res = await fetch(
      "https://api-finfo.vndirect.com.vn/v4/stocks?q=type:STOCK,ETF~status:LISTED&fields=code,companyName,companyNameEng,shortName,floor,type&size=4000",
      { headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://dstock.vndirect.com.vn/" }, cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(String(res.status));
    const list = parseVnList(await res.json());
    if (list.length < 100) throw new Error("short list");
    mem = { at: Date.now(), list };
    await setJSON(KEY, mem).catch(() => {});
    return list;
  } catch {
    if (stored?.list?.length) return stored.list; // old copy beats nothing
    return BUILTIN.map(([code, short, floor]) => ({ code, short, name: short, floor, type: code.startsWith("E1") || code.startsWith("FUE") ? "ETF" : "STOCK" }));
  }
}

/** Name for a VN code if we already have the listing in memory (no network). */
export function vnNameSync(code: string): string | undefined {
  const c = code.replace(/\.VN$/i, "").toUpperCase();
  return mem?.list.find((x) => x.code === c)?.short ?? BUILTIN.find((b) => b[0] === c)?.[1];
}

/** Score a listing for a query (0 = no match). Exported for tests. */
export function scoreVn(l: VnListing, q: string): number {
  const fq = fold(q);
  if (!fq) return 0;
  const code = l.code.toLowerCase();
  if (code === fq.replace(/ /g, "")) return 100;
  if (code.startsWith(fq)) return 80 - code.length;
  const names = [fold(l.short), fold(l.name), fold(l.nameEn ?? "")];
  if (names.some((n) => n === fq)) return 75;
  if (names.some((n) => n.startsWith(fq))) return 65;
  if (names.some((n) => ` ${n}`.includes(` ${fq}`))) return 55; // word start
  if (fq.length >= 3 && names.some((n) => n.includes(fq))) return 35;
  return 0;
}

export async function searchVn(q: string, max = 8): Promise<VnListing[]> {
  const list = await vnListings();
  return list
    .map((l) => ({ l, s: scoreVn(l, q) + (l.floor === "HOSE" ? 2 : 0) + (l.type === "STOCK" ? 1 : 0) }))
    .filter((x) => x.s > 3)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.l);
}

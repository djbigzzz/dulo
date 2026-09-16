/**
 * Static GICS-style sector map for underlying tickers likely to appear as xStocks.
 *
 * The xStocks API carries no sector field, so this is the single source of truth for
 * the "diversified" Play (N assets across M sectors). Unknown tickers map to "Other".
 *
 * Conventions:
 *   - Broad-market / thematic ETFs -> "Index", bond ETFs -> "Bonds", metal ETFs -> "Commodities".
 *   - Crypto-exposed equities (exchanges, treasuries, miners) -> "Crypto" rather than their GICS sector,
 *     because for a stocks-on-Solana audience that is the exposure that matters.
 *   - Everything else follows GICS 2023 (payments in Financials, DG/DLTR in Consumer Staples, UBER in Industrials).
 *
 * Client-safe: no server imports.
 */

export const SECTORS = [
  "Technology",
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Financials",
  "Health Care",
  "Industrials",
  "Energy",
  "Materials",
  "Real Estate",
  "Utilities",
  "Index",
  "Bonds",
  "Commodities",
  "Crypto",
  "Other",
] as const;

export type Sector = (typeof SECTORS)[number];

export const UNKNOWN_SECTOR: Sector = "Other";

const BY_SECTOR: Record<Exclude<Sector, "Other">, readonly string[]> = {
  Technology: [
    "AAPL", "MSFT", "NVDA", "AMD", "INTC", "AVGO", "ORCL", "CRM", "ADBE", "CSCO", "IBM", "QCOM", "TXN", "MU", "ARM",
    "SMCI", "ACN", "NOW", "INTU", "SNOW", "CRWD", "PANW", "NET", "DDOG", "ZM", "DOCU", "IONQ", "QUBT", "RBRK", "U",
    "DOCN", "GDDY", "HUBS", "PLTR", "SHOP", "AMAT", "LRCX", "KLAC", "ADI", "MCHP", "MRVL", "ON", "NXPI", "ASML", "TSM",
    "ANET", "APH", "GLW", "HPQ", "HPE", "DELL", "NTAP", "WDC", "STX", "SNDK", "PSTG", "CDNS", "SNPS", "ADSK", "PTC",
    "TYL", "WDAY", "TEAM", "MDB", "OKTA", "ZS", "FTNT", "AKAM", "GEN", "TWLO", "CIEN", "LITE", "COHR", "AAOI", "FN",
    "JBL", "TER", "ENTG", "ONTO", "MKSI", "AEIS", "LSCC", "MPWR", "MTSI", "SMTC", "SWKS", "QRVO", "GFS", "AMKR",
    "ALAB", "CRWV", "APLD", "NBIS", "TTMI", "AXTI", "CDW", "SNX", "ARW", "CTSH", "IT", "EPAM", "DT", "GWRE", "MANH",
    "FICO", "SSNC", "VRSN", "KEYS", "TRMB", "ZBRA", "TDY", "MSI", "ROP", "IOT", "APP", "UI", "SAIL", "BSY", "AI",
    "NTNX", "ONDS", "INDI", "XRX", "PL", "DUOL", "PATH", "S", "ESTC", "CFLT", "GTLB", "BILL", "PAYC", "PCTY",
    "TOST", "MNDY", "WIX", "SQSP", "ANSS", "IBKR_TECH", "NVMI", "CAMT", "STM", "ARW", "AVT", "WOLF", "COHU",
  ],
  "Communication Services": [
    "GOOGL", "GOOG", "META", "NFLX", "DIS", "T", "VZ", "TMUS", "CMCSA", "CHTR", "EA", "TTWO", "RBLX", "SPOT", "PINS",
    "RDDT", "NWSA", "NWS", "NYT", "LYV", "OMC", "IPG", "FWONK", "FWONA", "WBD", "ROKU", "MTCH", "TKO", "ASTS", "GSAT",
    "DJT", "SNAP", "PARA", "FOX", "FOXA", "LBRDK", "SIRI", "TRIP", "Z", "ZG", "BIDU", "700", "1024",
  ],
  "Consumer Discretionary": [
    "AMZN", "TSLA", "HD", "NKE", "MCD", "SBUX", "LOW", "TJX", "ROST", "BURL", "ULTA", "ABNB", "DASH", "BKNG", "EXPE",
    "MAR", "HLT", "H", "RCL", "CCL", "NCLH", "LVS", "MGM", "WYNN", "CZR", "DKNG", "CMG", "DRI", "TXRH", "DPZ", "YUM",
    "QSR", "WEN", "GM", "F", "RIVN", "LCID", "AZO", "ORLY", "GPC", "CVNA", "EBAY", "ETSY", "CPNG", "GME", "AMC", "RL",
    "TPR", "DECK", "LULU", "PAG", "BBY", "WSM", "TOL", "LEN", "DHI", "NVR", "PHM", "POOL", "HAS", "MAT", "W", "DKS",
    "FIVE", "TSCO", "AS", "VIK", "ONON", "BWA", "APTV", "LKQ", "GRMN", "KMX", "AN", "SCI", "CHWY", "PTON", "SBET_X",
    "3690", "1211", "9992", "2020", "6862", "2313", "175", "1929", "6690", "1928", "1913", "27", "2097", "6181", "9973",
  ],
  "Consumer Staples": [
    "WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "CL", "KMB", "GIS", "K", "KHC", "HSY", "MDLZ", "MKC", "SJM", "CPB",
    "HRL", "TSN", "CAG", "KDP", "STZ", "TAP", "EL", "CHD", "CLX", "KVUE", "KR", "SYY", "USFD", "PFGC", "CASY", "BJ",
    "DG", "DLTR", "TGT", "ADM", "BG", "MNST", "CELH", "KZ", "WBA", "ACI", "SFM", "COKE", "9633", "291", "1876",
    "2319", "322", "288", "6969",
  ],
  Financials: [
    "JPM", "GS", "BAC", "V", "MA", "PYPL", "BRK.B", "BRK.A", "BLK", "SCHW", "AXP", "C", "WFC", "MS", "IVZ", "BEN",
    "AGNC", "NLY", "HOOD", "SOFI", "AFRM", "XYZ", "SQ", "COF", "USB", "PNC", "TFC", "MTB", "FITB", "HBAN", "KEY", "RF",
    "CFG", "ALLY", "EWBC", "FCNCA", "FHN", "PNFP", "BPOP", "SF", "JEF", "EVR", "LPLA", "RJF", "IBKR", "NDAQ", "ICE",
    "CME", "CBOE", "MCO", "MSCI", "FDS", "SPGI", "TW", "KKR", "BX", "APO", "ARES", "CG", "OWL", "BAM", "TPG", "MET",
    "PRU", "AFL", "AIG", "ALL", "PGR", "TRV", "CB", "CINF", "HIG", "L", "CNA", "WRB", "RNR", "MKL", "EG", "AIZ", "AJG",
    "BRO", "MRSH", "MMC", "AON", "WTW", "GL", "UNM", "PFG", "RGA", "CRBG", "EQH", "AMP", "SEIC", "TROW", "NTRS", "STT",
    "BNY", "BK", "SYF", "DFS", "FIS", "FISV", "FI", "GPN", "CPAY", "RYAN", "FRHC", "WRLD", "BETR", "JKHY", "ACGL",
    "VOYA", "LNC", "STRK", "STRC", "1299", "1398", "3988", "939", "2318", "388", "2628", "2328", "966", "1658", "3328",
    "2388",
  ],
  "Health Care": [
    "JNJ", "PFE", "LLY", "UNH", "MRK", "ABBV", "MRNA", "BNTX", "GILD", "AMGN", "REGN", "VRTX", "ABT", "TMO", "DHR",
    "BSX", "MDT", "SYK", "ISRG", "EW", "ZBH", "BDX", "BAX", "RMD", "DXCM", "IDXX", "ALGN", "A", "MTD", "WAT", "WST",
    "RVTY", "ILMN", "BIIB", "INCY", "EXEL", "ALNY", "BMRN", "NBIX", "INSM", "UTHR", "BBIO", "CORT", "AXSM", "ARWR",
    "RVMD", "ROIV", "MDGL", "HALO", "VTRS", "ELAN", "ZTS", "CVS", "CI", "HUM", "ELV", "CNC", "MOH", "HCA", "THC",
    "UHS", "EHC", "DVA", "MCK", "CAH", "COR", "LH", "DGX", "IQV", "MEDP", "VEEV", "GEHC", "HIMS", "TWST", "NTRA",
    "GH", "WGS", "PEN", "GMED", "QURE", "AZN", "NVO", "COO", "HOLX", "PODD", "BMY", "TECH", "CRL", "SRPT", "IONS",
    "RARE", "ACAD", "JAZZ", "TEM", "1177", "1093", "2269", "6618", "2268",
  ],
  Industrials: [
    "BA", "CAT", "DE", "HON", "GE", "LMT", "RTX", "UPS", "FDX", "NOC", "GD", "LHX", "HII", "TDG", "HWM", "HEI", "TXT",
    "CW", "BWXT", "KTOS", "AXON", "RKLB", "ETN", "EMR", "ITW", "PH", "ROK", "AME", "DOV", "IR", "XYL", "PNR", "GWW",
    "FAST", "WSO", "FERG", "WCC", "CTAS", "RSG", "WM", "GFL", "CLH", "UNP", "CSX", "NSC", "ODFL", "JBHT", "KNX", "SAIA",
    "XPO", "CHRW", "EXPD", "UAL", "DAL", "LUV", "AAL", "UBER", "LYFT", "CPRT", "RBA", "URI", "UHAL", "ADP", "PAYX",
    "VRSK", "EFX", "TRU", "BR", "LDOS", "CACI", "BAH", "J", "ACM", "EME", "FIX", "PWR", "MTZ", "STRL", "IESC", "DY",
    "APG", "MLI", "WMS", "OC", "MAS", "ALLE", "LII", "CARR", "TT", "OTIS", "JCI", "GNRC", "HUBB", "NDSN", "GGG", "SNA",
    "SWK", "ITT", "IEX", "RRX", "AIT", "WWD", "CR", "CSL", "PCAR", "CMI", "ALSN", "WAB", "DCI", "ROL", "ARMK", "LECO",
    "DRS", "FLNC", "BE", "JOBY", "ACHR", "SPCE", "RCAT", "FTAI", "VRT", "AOS", "MMM", "VLTO", "AUR", "SMR", "AER",
    "ULS_X", "CNM", "TREX", "AZEK", "BLDR", "TTC", "HRI", "GEV", "1", "66", "1919", "1308", "2618", "3808", "293",
    "144", "267",
  ],
  Energy: [
    "XOM", "CVX", "COP", "EOG", "OXY", "DVN", "APA", "FANG", "EQT", "AR", "EXE", "OVV", "PR", "VNOM", "CTRA", "MPC",
    "PSX", "VLO", "DINO", "HAL", "BKR", "SLB", "KMI", "WMB", "OKE", "LNG", "TRGP", "AM", "TPL", "UUUU", "HES", "MRO",
    "CHRD", "MUR", "SM", "NOV", "FTI", "ET", "EPD", "MPLX", "PAA", "1088", "386", "135",
  ],
  Materials: [
    "LIN", "APD", "SHW", "ECL", "PPG", "DOW", "DD", "LYB", "CTVA", "CF", "MOS", "NUE", "STLD", "RS", "CRS", "ATI",
    "FCX", "SCCO", "NEM", "RGLD", "HL", "CDE", "AA", "CENX", "ALB", "MLM", "VMC", "AVY", "PKG", "IP", "BALL", "CCK",
    "RPM", "MP", "USAR", "METC", "IFF", "PCT", "EXP", "EMN", "CE", "AMR", "HCC", "X", "CLF", "MTX", "SMG", "1378",
    "1818", "2259", "1208",
  ],
  "Real Estate": [
    "PLD", "AMT", "CCI", "SBAC", "EQIX", "DLR", "PSA", "EXR", "O", "SPG", "REG", "KIM", "WELL", "VTR", "DOC", "OHI",
    "AHR", "ARE", "AVB", "EQR", "ESS", "MAA", "UDR", "CPT", "AMH", "INVH", "ELS", "EGP", "HST", "VICI", "GLPI", "IRM",
    "WPC", "LAMR", "CBRE", "JLL", "CSGP", "OPEN", "WY", "BXP", "FRT", "NNN", "ADC", "CUBE", "REXR", "SUI", "RDFN",
    "COMP", "12", "1109", "688", "1209", "1997", "1113", "4", "83", "1972",
  ],
  Utilities: [
    "NEE", "DUK", "SO", "D", "AEP", "EXC", "SRE", "XEL", "PEG", "ED", "PCG", "EIX", "ETR", "ES", "FE", "PPL", "WEC",
    "DTE", "AEE", "CMS", "CNP", "NI", "EVRG", "ATO", "LNT", "PNW", "AWK", "WTRG", "CEG", "VST", "NRG", "TLN", "OKLO",
    "AES", "OGE", "IDA", "POR", "SWX", "NWE", "2688", "2", "3", "1038", "836", "916", "6",
  ],
  Index: [
    "SPY", "QQQ", "VOO", "VTI", "IWM", "IJR", "VUG", "VT", "VXUS", "IEMG", "SCHF", "VGK", "EWG", "EWQ", "EWU", "EWY",
    "EWJ", "FEZ", "TQQQ", "SQQQ", "SPXL", "SOXL", "SOXS", "SOXX", "SMH", "XLE", "XOP", "XLF", "XLK", "XLV", "XLI",
    "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC", "ITA", "NLR", "URA", "COPX", "GDX", "GDXJ", "MOO", "KORU", "DIA", "IVV",
    "VEA", "VWO", "EFA", "EEM", "ARKK", "ARKW", "ARKG", "IBIT_X", "DAX", "MDY", "RSP", "SCHD", "VYM", "VIG", "IWF",
    "IWD", "MTUM", "QUAL", "USMV", "ITB", "XHB", "KRE", "XBI", "IBB", "JETS", "TAN", "ICLN", "LIT", "HACK", "CIBR",
    "BOTZ", "ROBO", "PPA", "XAR", "VNQ", "IYR", "SCHX", "SCHG", "SPLG", "VO", "VB", "VTV", "IWB", "IWR", "IWN", "IWO",
  ],
  Bonds: [
    "TLT", "JPST", "SGOV", "TBLL", "FLBL", "JAAA", "BND", "AGG", "HYG", "LQD", "IEF", "SHY", "TIP", "BIL", "VCIT",
    "VCSH", "BSV", "BIV", "BLV", "MUB", "EMB", "JNK", "TLH", "GOVT", "SHV", "USFR", "TFLO", "MBB", "VMBS", "BNDX",
  ],
  Commodities: ["GLD", "SLV", "PALL", "PPLT", "FGDL", "IAU", "GLDM", "SGOL", "USO", "UNG", "DBC", "PDBC", "CPER", "UCO", "BNO", "DBA", "WEAT", "CORN"],
  Crypto: [
    "COIN", "MSTR", "CRCL", "MARA", "RIOT", "CLSK", "HUT", "IREN", "CORZ", "WULF", "BTBT", "GLXY", "BMNR", "SBET",
    "DFDV", "BITX", "CIFR", "BTDR", "BITF", "HIVE", "BTCS", "IBIT", "FBTC", "GBTC", "ETHA", "BITO", "ARKB", "BSOL",
    "SOLS_X", "STRK_X",
  ],
};

/** Normalise a ticker for lookup: trim, uppercase, strip a leading "$", "-" -> "." (BRK-B -> BRK.B). */
export function normaliseTicker(ticker: string): string {
  return String(ticker ?? "")
    .trim()
    .replace(/^\$/, "")
    .toUpperCase()
    .replace(/-/g, ".");
}

function buildMap(): Readonly<Record<string, Sector>> {
  const out: Record<string, Sector> = {};
  for (const sector of Object.keys(BY_SECTOR) as Array<Exclude<Sector, "Other">>) {
    for (const t of BY_SECTOR[sector]) {
      // Entries suffixed "_X" are placeholders that intentionally never match a real ticker.
      if (t.endsWith("_X") || t.endsWith("_TECH")) continue;
      const key = normaliseTicker(t);
      if (!(key in out)) out[key] = sector;
    }
  }
  return Object.freeze(out);
}

/** Ticker -> sector. Frozen; first listing wins where a ticker appears twice. */
export const SECTOR_MAP: Readonly<Record<string, Sector>> = buildMap();

export function isSector(s: string): s is Sector {
  return (SECTORS as readonly string[]).includes(s);
}

/** All tickers with a known sector. */
export function knownTickers(): string[] {
  return Object.keys(SECTOR_MAP);
}

/**
 * Sector for an UNDERLYING ticker ("TSLA", "brk-b", "SPY"). Case-insensitive.
 * Does NOT strip a trailing "x" — pass the raw ticker; use sectorForXStock for "TSLAx".
 */
export function sectorFor(underlyingTicker: string): Sector {
  const key = normaliseTicker(underlyingTicker);
  if (!key) return UNKNOWN_SECTOR;
  return SECTOR_MAP[key] ?? UNKNOWN_SECTOR;
}

/**
 * Sector for an xStock SYMBOL ("TSLAx", "XRXx", "BRK.Bx"). Strips exactly one trailing "x"/"X"
 * before lookup, so "XRXx" -> "XRX" -> Technology. Never pass a bare underlying ticker here.
 */
export function sectorForXStock(xstockSymbol: string): Sector {
  const s = String(xstockSymbol ?? "").trim();
  const stripped = s.length > 1 && /x$/i.test(s) ? s.slice(0, -1) : s;
  return sectorFor(stripped);
}

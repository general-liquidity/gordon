/**
 * X Context Annotations — Static Entity Map for Trading
 *
 * X automatically tags tweets with "context annotations": structured entity
 * references that let you filter a query down to tweets X has already
 * classified as being about a specific thing (Bitcoin the cryptocurrency,
 * $TSLA the ticker, etc.) rather than just keyword-matching the text.
 *
 * Trading use case: a query like `bitcoin lang:en` returns tweets with the
 * word "bitcoin" anywhere — jokes, news about tangential topics, spam.
 * Adding `context:174.1007360414114435072` restricts to tweets X has
 * classified as about the Bitcoin cryptocurrency entity, which is dramatically
 * higher signal for sentiment and narrative analysis.
 *
 * Source: xdevplatform/twitter-context-annotations (evergreen list, 2022-06-01).
 * We embed only the two domains useful for trading:
 *   - Domain 174 "Cryptocurrencies": 53 curated cryptocurrency entities
 *   - Domain 166 "Ticker Symbol": 107 cashtag entities ($AAPL, $TSLA, $BTC…)
 *
 * Availability: the `context:` search operator works on X API v2 recent
 * search. Filtered stream and full-archive search also support it. Check
 * your X API tier — some context features are gated to Pro/Enterprise.
 */

// ============================================================================
// Types
// ============================================================================

export type XAnnotationCategory =
  | "crypto"
  | "stock"
  | "etf"
  | "index"
  | "forex"
  | "commodity"
  | "generic";

export interface XContextAnnotation {
  /** X domain ID as string: "174" for Cryptocurrencies, "166" for Ticker Symbol. */
  domain: string;
  /** X entity ID (numeric, but kept as string to avoid BigInt issues). */
  entityId: string;
  /** Human-readable entity name as X labels it, e.g. "Bitcoin cryptocurrency". */
  entityName: string;
  /** Normalized trading symbol, e.g. "BTC". */
  symbol: string;
  /** Gordon category hint for routing decisions. */
  category: XAnnotationCategory;
}

// ============================================================================
// Domain 174: Cryptocurrencies (broader — catches tweets about the asset)
// ============================================================================

export const X_CRYPTO_ENTITIES: readonly XContextAnnotation[] = [
  {
    domain: "174",
    entityId: "1007360414114435072",
    entityName: "Bitcoin cryptocurrency",
    symbol: "BTC",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1007361429752594432",
    entityName: "Ethereum cryptocurrency",
    symbol: "ETH",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1468157909318045697",
    entityName: "Solana cryptocurrency",
    symbol: "SOL",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139229372198469633",
    entityName: "Dogecoin cryptocurrency",
    symbol: "DOGE",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1007356280296488961",
    entityName: "Ada cryptocurrency",
    symbol: "ADA",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1007349748829786112",
    entityName: "Ripple (XRP)",
    symbol: "XRP",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1140997714592722944",
    entityName: "Polygon",
    symbol: "MATIC",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1471222864976089089",
    entityName: "Avalanche cryptocurrency",
    symbol: "AVAX",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1007351676301242369",
    entityName: "Litecoin cryptocurrency",
    symbol: "LTC",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139229087682068480",
    entityName: "Tether cryptocurrency",
    symbol: "USDT",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1405571471955533827",
    entityName: "USD Coin",
    symbol: "USDC",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1448236149676261380",
    entityName: "Shiba Inu",
    symbol: "SHIB",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1230878814797828097",
    entityName: "Tezos cryptocurrency",
    symbol: "XTZ",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139199278885163009",
    entityName: "Stellar cryptocurrency",
    symbol: "XLM",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1007358586089979904",
    entityName: "TRON cryptocurrency",
    symbol: "TRX",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139199174212063232",
    entityName: "Monero cryptocurrency",
    symbol: "XMR",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1304115130267963392",
    entityName: "Binance Coin cryptocurrency",
    symbol: "BNB",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1527281457361694720",
    entityName: "Luna cryptocurrency",
    symbol: "LUNA",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1481589516422975490",
    entityName: "ATOM cryptocurrency",
    symbol: "ATOM",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1370077643601711104",
    entityName: "Helium cryptocurrency",
    symbol: "HNT",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1481275803455262722",
    entityName: "Decentraland",
    symbol: "MANA",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1007357552286261248",
    entityName: "IOTA cryptocurrency",
    symbol: "IOTA",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1007354763745288193",
    entityName: "EOSIO cryptocurrency",
    symbol: "EOS",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1006891741532733440",
    entityName: "Dash cryptocurrency",
    symbol: "DASH",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139199225101598720",
    entityName: "NEO cryptocurrency",
    symbol: "NEO",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139198970062725121",
    entityName: "Zcash cryptocurrency",
    symbol: "ZEC",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1403064412877979652",
    entityName: "Zilliqa cryptocurrency",
    symbol: "ZIL",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1423661516251832326",
    entityName: "Nano cryptocurrency",
    symbol: "NANO",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1481581955011411973",
    entityName: "Chiliz",
    symbol: "CHZ",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1481582442792177666",
    entityName: "Holo",
    symbol: "HOT",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1481591916047192066",
    entityName: "Baby Dogecoin",
    symbol: "BABYDOGE",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139229431715602432",
    entityName: "STEEM Cryptocurrency",
    symbol: "STEEM",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139199333440430080",
    entityName: "NEM Cryptocurrency",
    symbol: "XEM",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139199390344593408",
    entityName: "Nxt Cryptocurrency",
    symbol: "NXT",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139199437719232512",
    entityName: "Bytecoin Cryptocurrency",
    symbol: "BCN",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139199527762530305",
    entityName: "Electroneum cryptocurrency",
    symbol: "ETN",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139199573103001602",
    entityName: "Namecoin Cryptocurrency",
    symbol: "NMC",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139215200878395392",
    entityName: "Verge cryptocurrency",
    symbol: "XVG",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139228968123371520",
    entityName: "Peercoin Cryptocurrency",
    symbol: "PPC",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139229240266612737",
    entityName: "Vertcoin Cryptocurrency",
    symbol: "VTC",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139229288454975488",
    entityName: "Gridcoin Cryptocurrency",
    symbol: "GRC",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1139229333375971328",
    entityName: "PotCoin Cryptocurrency",
    symbol: "POT",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1238540537830854657",
    entityName: "Monacoin cryptocurrency",
    symbol: "MONA",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1006894084386983936",
    entityName: "Mithril cryptocurrency",
    symbol: "MITH",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1431295032875634688",
    entityName: "PRCY Coin cryptocurrency",
    symbol: "PRCY",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1465030417329713155",
    entityName: "Saitama Inu cryptocurrency",
    symbol: "SAITAMA",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1470382260511670275",
    entityName: "Wakanda Inu cryptocurrency",
    symbol: "WKD",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1481584103228985345",
    entityName: "Gate.io",
    symbol: "GATEIO",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1481584777178148869",
    entityName: "Radio Caca",
    symbol: "RACA",
    category: "crypto",
  },
  {
    domain: "174",
    entityId: "1493938014296240131",
    entityName: "ASIX",
    symbol: "ASIX",
    category: "crypto",
  },
] as const;

// ============================================================================
// Domain 166: Ticker Symbol (narrower — literal $CASHTAG match on stocks and crypto)
// ============================================================================

const CRYPTO_TICKERS = new Set([
  "BTC",
  "ETH",
  "DOGE",
  "XRP",
  "LTC",
  "EOS",
  "TRX",
  "USDT",
  "BNB",
  "HNT",
  "BTT",
]);
const INDEX_TICKERS = new Set(["DJIA", "DOW", "SPX", "NDX", "VIX", "ES"]);
const ETF_TICKERS = new Set(["SPY", "QQQ", "IWM", "GLD", "SLV", "USO"]);

function categorizeTicker(symbol: string): XAnnotationCategory {
  if (CRYPTO_TICKERS.has(symbol)) return "crypto";
  if (INDEX_TICKERS.has(symbol)) return "index";
  if (ETF_TICKERS.has(symbol)) return "etf";
  return "stock";
}

const RAW_TICKERS: ReadonlyArray<[string, string]> = [
  ["1306667220794105856", "AAL"],
  ["1303003172865105921", "AAPL"],
  ["1306568690641428481", "AMD"],
  ["1303008576286281742", "AMZN"],
  ["1313834799409238016", "ATWT"],
  ["1303032576773255168", "BA"],
  ["1306659423109046272", "BABA"],
  ["1314588207904813058", "BAC"],
  ["1314575248012898304", "BBBY"],
  ["1303005941617491968", "BNB"],
  ["1314242948700139521", "BOXL"],
  ["1301195966125494272", "BTC"],
  ["1303041174123376642", "BTT"],
  ["1306657976795586561", "BYND"],
  ["1313860291667480577", "C"],
  ["1314615915661590533", "CBAT"],
  ["1313557969297043456", "CCL"],
  ["1313873807115907073", "CRM"],
  ["1306690783148273664", "DAL"],
  ["1313875849490264064", "DDOG"],
  ["1303036847111585794", "DIS"],
  ["1314214970763087873", "DJIA"],
  ["1313547069123043328", "DKNG"],
  ["1303026843365171206", "DOGE"],
  ["1314236368982171648", "DOW"],
  ["1313545168679661569", "EMN"],
  ["1314238681188769792", "ENZC"],
  ["1303017378284855296", "EOS"],
  ["1313543681119383553", "ES"],
  ["1306704747827617792", "ET"],
  ["1301229157511168001", "ETH"],
  ["1303021414455238656", "FB"],
  ["1314587316594171905", "FSLY"],
  ["1314602321955844097", "GAXY"],
  ["1306670862485999616", "GE"],
  ["1303048138177933312", "GILD"],
  ["1306645188417171457", "GLD"],
  ["1392564039067176960", "GME"],
  ["1306660832600752129", "GNUS"],
  ["1306652771991478273", "GOLD"],
  ["1306713906467885056", "GOOG"],
  ["1303043039196110848", "GOOGL"],
  ["1306703259956961280", "GROW"],
  ["1314565846677680128", "HD"],
  ["1370075935257415683", "HNT"],
  ["1314222747099168770", "HTSC"],
  ["1306693962762051584", "HTZ"],
  ["1313553552304828417", "HYLN"],
  ["1306573839682342912", "IDEX"],
  ["1313559512255614976", "INO"],
  ["1428417470755348485", "INTU"],
  ["1313821059737505793", "IWM"],
  ["1306665957801115648", "JPM"],
  ["1303031468298436608", "KODK"],
  ["1306689379386011649", "LKNCY"],
  ["1303027811536400386", "LTC"],
  ["1306643567570378752", "MARK"],
  ["1314225402106134529", "MCD"],
  ["1303044849503842304", "MRNA"],
  ["1303029299474100225", "MSFT"],
  ["1314223922645065730", "MU"],
  ["1313807306371461120", "NDX"],
  ["1303039598570819584", "NFLX"],
  ["1313525755347787776", "NIO"],
  ["1303042193133727744", "NKLA"],
  ["1313539885362343936", "NVDA"],
  ["1313858306440454147", "OLL"],
  ["1313856096868601856", "OPTI"],
  ["1314579490010353665", "OXBR"],
  ["1314239634944126979", "OXY"],
  ["1314220370291957764", "PBIO"],
  ["1306701659146301440", "PENN"],
  ["1314583503481102337", "PLL"],
  ["1313831294237773825", "PLTR"],
  ["1313820198793703425", "PTON"],
  ["1314604079088234498", "PYPL"],
  ["1303035954727247872", "QQQ"],
  ["1314221489902682114", "REGN"],
  ["1314599225770954752", "RKT"],
  ["1306651376743714816", "ROKU"],
  ["1314594901586186241", "RVX"],
  ["1306656588225105920", "SHOP"],
  ["1314217292910092289", "SLV"],
  ["1313529974561800192", "SPAQ"],
  ["1303047383169736705", "SPCE"],
  ["1314231553082355713", "SPI"],
  ["1303024103272509441", "SPX"],
  ["1303013359306993665", "SPY"],
  ["1306668868836835328", "SQ"],
  ["1313816298699198464", "SRNE"],
  ["1313868404797759489", "SUNW"],
  ["1302991274786484227", "TRX"],
  ["1301568510271709184", "TSLA"],
  ["1314585105130639360", "TWLO"],
  ["1303034843911995392", "TWTR"],
  ["1306670112099848193", "UBER"],
  ["1302997585569824768", "USDT"],
  ["1306692147026911232", "USO"],
  ["1303049190247866368", "VIX"],
  ["1313550363178405889", "WKHS"],
  ["1313552067407953921", "WMT"],
  ["1313836080639037440", "WWR"],
  ["1313853738210082816", "XOM"],
  ["1301953309872332800", "XRP"],
  ["1314576613627981825", "XSPA"],
  ["1303045873383829504", "ZM"],
  ["1314618364694675458", "ZNGA"],
];

export const X_TICKER_ENTITIES: readonly XContextAnnotation[] = RAW_TICKERS.map(
  ([entityId, symbol]) => ({
    domain: "166",
    entityId,
    entityName: `$${symbol}`,
    symbol,
    category: categorizeTicker(symbol),
  }),
);

// ============================================================================
// Aliases — fuzzy lookup from common names to canonical symbols
// ============================================================================

const ALIAS_MAP: Record<string, string> = {
  // Crypto common names / alt symbols
  bitcoin: "BTC",
  xbt: "BTC",
  ethereum: "ETH",
  ether: "ETH",
  solana: "SOL",
  dogecoin: "DOGE",
  cardano: "ADA",
  ripple: "XRP",
  polygon: "MATIC",
  matic: "MATIC",
  avalanche: "AVAX",
  litecoin: "LTC",
  tether: "USDT",
  "usd coin": "USDC",
  shiba: "SHIB",
  "shiba inu": "SHIB",
  tezos: "XTZ",
  stellar: "XLM",
  lumens: "XLM",
  tron: "TRX",
  monero: "XMR",
  "binance coin": "BNB",
  bnb: "BNB",
  luna: "LUNA",
  terra: "LUNA",
  cosmos: "ATOM",
  atom: "ATOM",
  helium: "HNT",
  decentraland: "MANA",
  mana: "MANA",
  iota: "IOTA",
  eos: "EOS",
  dash: "DASH",
  neo: "NEO",
  zcash: "ZEC",
  zilliqa: "ZIL",
  nano: "NANO",
  chiliz: "CHZ",
  holo: "HOT",
  "baby doge": "BABYDOGE",
  steem: "STEEM",
  // Stocks
  apple: "AAPL",
  microsoft: "MSFT",
  amazon: "AMZN",
  google: "GOOGL",
  alphabet: "GOOGL",
  nvidia: "NVDA",
  tesla: "TSLA",
  meta: "FB",
  facebook: "FB",
  netflix: "NFLX",
  disney: "DIS",
  boeing: "BA",
  jpmorgan: "JPM",
  walmart: "WMT",
  exxon: "XOM",
  coinbase: "COIN",
  gamestop: "GME",
  amd: "AMD",
  palantir: "PLTR",
  shopify: "SHOP",
  uber: "UBER",
  zoom: "ZM",
  roku: "ROKU",
  paypal: "PYPL",
  square: "SQ",
  block: "SQ",
  pelotron: "PTON",
  peloton: "PTON",
  // Indexes / ETFs
  "s&p": "SPY",
  sp500: "SPY",
  "s&p 500": "SPY",
  nasdaq: "QQQ",
  russell: "IWM",
  "dow jones": "DJIA",
  vix: "VIX",
  gold: "GLD",
  silver: "SLV",
  oil: "USO",
};

// ============================================================================
// Lookup indices (built once at module load)
// ============================================================================

const bySymbol: Map<string, XContextAnnotation[]> = new Map();
const byEntityId: Map<string, XContextAnnotation> = new Map();

for (const annotation of [...X_CRYPTO_ENTITIES, ...X_TICKER_ENTITIES]) {
  const key = annotation.symbol.toUpperCase();
  const existing = bySymbol.get(key) ?? [];
  existing.push(annotation);
  bySymbol.set(key, existing);
  byEntityId.set(annotation.entityId, annotation);
}

// ============================================================================
// Resolver — the main public API
// ============================================================================

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/^[@$]/, "");
}

/**
 * Resolve a ticker, symbol, or common name to one or more X context annotations.
 *
 * Returns ALL matching annotations (crypto entities can match both domain 174
 * and domain 166, which we return together so the caller can OR them in the
 * query for maximum recall).
 *
 * Examples:
 *   resolveXContext("BTC")      → [Bitcoin cryptocurrency (174), $BTC (166)]
 *   resolveXContext("bitcoin")  → same as above (aliased)
 *   resolveXContext("TSLA")     → [$TSLA (166)]
 *   resolveXContext("tesla")    → [$TSLA (166)] (aliased)
 *   resolveXContext("???")      → []
 */
export function resolveXContext(input: string): XContextAnnotation[] {
  const normalized = normalize(input);
  if (!normalized) return [];

  // 1. Direct symbol match
  const directKey = normalized.toUpperCase();
  const direct = bySymbol.get(directKey);
  if (direct && direct.length > 0) return [...direct];

  // 2. Alias lookup
  const aliased = ALIAS_MAP[normalized];
  if (aliased) {
    const viaAlias = bySymbol.get(aliased.toUpperCase());
    if (viaAlias && viaAlias.length > 0) return [...viaAlias];
  }

  // 3. Entity-name substring match (last resort, slower)
  const needle = normalized;
  const matches: XContextAnnotation[] = [];
  for (const ann of [...X_CRYPTO_ENTITIES, ...X_TICKER_ENTITIES]) {
    if (ann.entityName.toLowerCase().includes(needle)) {
      matches.push(ann);
    }
  }
  return matches;
}

/**
 * Resolve multiple inputs in a single pass. Returns a map keyed by the
 * original input so callers can tell which resolved and which didn't.
 */
export function resolveXContexts(inputs: string[]): Map<string, XContextAnnotation[]> {
  const result = new Map<string, XContextAnnotation[]>();
  for (const input of inputs) {
    result.set(input, resolveXContext(input));
  }
  return result;
}

/**
 * Build an X API v2 search query fragment that filters by context annotations.
 *
 *   buildContextFilter([btc174, btc166])
 *     → "(context:174.1007360414114435072 OR context:166.1301195966125494272)"
 *
 * Returns an empty string if no annotations — callers should guard on that.
 */
export function buildContextFilter(annotations: readonly XContextAnnotation[]): string {
  if (annotations.length === 0) return "";
  const parts = annotations.map((a) => `context:${a.domain}.${a.entityId}`);
  if (parts.length === 1) return parts[0]!;
  return `(${parts.join(" OR ")})`;
}

/**
 * Look up an annotation by its X entity ID. Useful when post-processing
 * tweets that arrive with context_annotations attached — we can map back
 * to Gordon's category hint.
 */
export function getAnnotationByEntityId(entityId: string): XContextAnnotation | undefined {
  return byEntityId.get(entityId);
}

/**
 * Return the list of supported entities for a given category. Tools can
 * expose this as a discovery helper so the agent knows what's filterable.
 */
export function listXEntities(category?: XAnnotationCategory): XContextAnnotation[] {
  const all = [...X_CRYPTO_ENTITIES, ...X_TICKER_ENTITIES];
  if (!category) return all;
  return all.filter((a) => a.category === category);
}

/**
 * Lightweight discovery summary — one row per symbol, preferring the
 * cryptocurrency-domain entity when both are available.
 */
export function listXEntitySymbols(): Array<{
  symbol: string;
  entityName: string;
  category: XAnnotationCategory;
}> {
  const bySymbolPreferred = new Map<string, XContextAnnotation>();
  for (const ann of [...X_CRYPTO_ENTITIES, ...X_TICKER_ENTITIES]) {
    const existing = bySymbolPreferred.get(ann.symbol);
    if (!existing || (existing.domain === "166" && ann.domain === "174")) {
      bySymbolPreferred.set(ann.symbol, ann);
    }
  }
  return [...bySymbolPreferred.values()]
    .map((a) => ({ symbol: a.symbol, entityName: a.entityName, category: a.category }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

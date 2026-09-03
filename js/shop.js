'use strict';
// THE MERCHANT'S COUNTER: the one place gold turns into goods and goods turn
// back into gold. Each eagle's driver (the `merchant` banner, js/robots.js)
// climbs down at the crash, raises the gate, fells the rim and then keeps to
// the lane mouth - and standing beside it there opens this.
//
// BOTH counters serve EVERYBODY. Your own roost's merchant is the near one and
// the rival's is a walk through their base, but neither asks whose side you
// are on, which is exactly why a merchant cannot be killed (unitAlive,
// js/actions.js): a shop nobody can reach is not a shop.
//
// Three things live in this file, in this order:
//   - the MARKET. Fish and berries have a price that MOVES - a random walk
//     with a pull home and the odd shock - and they are the only two things in
//     the game that do. Everything else is priced once, on its own def
//     (`price` on TOOLS/BITS in js/tools.js, CARD_PRICE in js/player.js).
//   - the STOCK. Twelve offers rolled off the tool, bit and card pools, which
//     turn over every SHOP_RESTOCK seconds - the same twelve at both counters,
//     because there is one market and two shopfronts onto it.
//   - the PANEL. Bought from with a click, sold to by DRAGGING out of the
//     pack, which opens beside it for exactly that reason (bagOpenNow, ui.js).
//
// The counter does not stop the sim, and standing at one does not protect you:
// it is HUD like the backpack and the character sheet, and walking out of
// reach shuts it.
// ------------------------------------------------------------ market
// The market's own rng, seeded off SEED the way the landmarks' is (lmRng,
// js/world.js): prices are the same on every machine playing the same seed,
// and a busy market can never shift the loot rolls by consuming draws out of
// the shared stream.
const mktRng = mulberry32((SEED ^ 0x4D4B5431) >>> 0);

const MKT_STEP = 5;      // s between price moves - the sample pitch of the graphs too
const MKT_DAYS = 3;      // days of history a graph shows
const MKT_HIST = Math.ceil(MKT_DAYS * CYCLE / MKT_STEP); // samples held per good
const MKT_REVERT = 0.05; // share of the gap back to `base` each step: the pull home
const MKT_NEWS = 0.3;    // share of the last headline's price a move must clear to cut a new one

// The two traded goods. `base` is what a thing is worth when nothing is
// happening, `min`/`max` the rails it can never leave, `vol` the ordinary
// step, and `shock` the chance a step is a LURCH instead - straight to `lo` or
// `hi` of where it stood, which is what makes a market worth watching rather
// than a number that drifts. Fish are the money good and berries the small
// change: a fish is worth four or five berries at rest and the gap widens on
// a spike, so a full bag of fish is a real decision about when to sell it.
// `newsMin` is the OTHER half of the headline test: the gold a move must also
// be worth. Without it a berry going 2G -> 3G is a 50% "spike" and the feed
// fills with small change, because a percentage of a cheap thing is nothing.
const GOODS = {
  fish:  { name: 'FISH',    base: 18, min: 5, max: 60, vol: 0.13, shock: 0.05, lo: 0.62, hi: 1.7, newsMin: 4 },
  berry: { name: 'BERRIES', base: 4,  min: 1, max: 15, vol: 0.11, shock: 0.04, lo: 0.66, hi: 1.6, newsMin: 2 },
};
const MKT_ORDER = ['fish', 'berry']; // the order the counter lists them in: the money good first

// The live market. `price` is a float and the whole walk runs on it; what is
// ever PAID is marketPrice() - the rounded coin - so the graph can wander
// between two whole numbers without the counter's price flickering.
// `news` is the price the last headline was cut at, `pop` the seconds of
// highlight left on a row that just made one.
const market = { t: 0, goods: {}, stockT: 0, stock: null, n: 0 };

function marketPrice(id) { return Math.max(1, Math.round(market.goods[id].price)); }
// the goods array a good's graph is drawn from, oldest first
function marketHist(id) { return market.goods[id].hist; }
// is this a traded good rather than a made thing?
function isGood(type) { return !!GOODS[type]; }

// one step of the walk: the pull home, the ordinary drift, then the shock
function marketWalk(id) {
  const g = GOODS[id], r = market.goods[id];
  let p = r.price;
  p += (g.base - p) * MKT_REVERT;
  p *= 1 + (mktRng() * 2 - 1) * g.vol;
  if (mktRng() < g.shock) p *= mktRng() < 0.5 ? g.lo : g.hi;
  r.price = Math.max(g.min, Math.min(g.max, p));
}

// A move worth telling everyone about. The feed is where the game already
// says what just happened to somebody, so it is where the market says what
// just happened to their bag - one line, the good's own colour, and the price
// it landed on. `news` only moves when a line is cut, so a slow climb of ten
// small steps still makes the headline the moment it adds up to MKT_NEWS.
function marketNews(id) {
  const r = market.goods[id], now = marketPrice(id), g = GOODS[id];
  const d = (now - r.news) / Math.max(1, r.news);
  if (Math.abs(d) < MKT_NEWS || Math.abs(now - r.news) < g.newsMin) return;
  const up = d > 0;
  r.news = now;
  r.pop = 3;
  logEvent(GOODS[id].name + (up ? ' SPIKE ' : ' CRASH ') + now + 'G', null,
    { bg: up ? '#14351f' : '#3a1420', edge: up ? '#8fe08a' : '#e0637a', fg: up ? '#b8f0b0' : '#ff9a8a' });
  SFX.market(up);
}

// Three days of trading before anyone landed, so the graphs are graphs on day
// one rather than a flat line that fills in over the first quarter of an hour.
function initMarket() {
  market.t = 0;
  for (const id of MKT_ORDER) {
    const g = GOODS[id];
    const r = { price: g.base, news: g.base, pop: 0, hist: [] };
    market.goods[id] = r;
    for (let i = 0; i < MKT_HIST; i++) { marketWalk(id); r.hist.push(r.price); }
    r.news = marketPrice(id);
  }
  shopRestock(true);
}

// Called once per sim step from updatePlay (js/sim.js), never in practice -
// the training room has no merchants and no clock. Both timers live here: the
// price walk on MKT_STEP, and the counter's own turnover on SHOP_RESTOCK.
function updateMarket(dt) {
  market.t += dt;
  while (market.t >= MKT_STEP) {
    market.t -= MKT_STEP;
    for (const id of MKT_ORDER) {
      const r = market.goods[id];
      marketWalk(id);
      r.hist.push(r.price);
      while (r.hist.length > MKT_HIST) r.hist.shift();
      marketNews(id);
    }
  }
  for (const id of MKT_ORDER) {
    const r = market.goods[id];
    if (r.pop > 0) r.pop = Math.max(0, r.pop - dt);
  }
  market.stockT -= dt;
  if (market.stockT <= 0) shopRestock(false);
  // the counter shuts itself the moment you walk away from it
  if (state.shop && (player.dead || !inReach(player, state.shop))) closeShop();
}

// ------------------------------------------------------------ the counter's stock
// Twelve offers in four sections, rolled off the same pools the world drops
// from and turned over every two minutes. An offer is not a single item: it is
// a LINE the counter is running, so it can be bought from as many times as
// gold and bag room allow until the stock turns over. That is what makes the
// clock matter - what is on the counter is a window, not a queue.
const SHOP_RESTOCK = 120; // s between turnovers
const SHOP_COLS = 3;      // offers in every section
// Cards are rolled by rarity, not by name: an unopened card is what changes
// hands and the pick of three inside it is drawn afterwards (openDraft,
// js/ui.js), so the buyer is paying for the odds. Kinder than a chest's odds
// (CHEST_ODDS, js/world.js) - a counter you can choose to walk to should show
// the better rarities more often than a box you tripped over.
const SHOP_CARD_ODDS = { white: 0.4, green: 0.3, blue: 0.19, purple: 0.09, gold: 0.02 };
// the four sections, in the order the panel stacks them
const SHOP_SECTIONS = [
  { id: 'tools', label: 'TOOLS' },
  { id: 'proj',  label: 'BITS' },
  { id: 'mods',  label: 'MODIFIERS' },
  { id: 'cards', label: 'CARDS' },
];

// n distinct keys off a pool, shuffled on the market's own stream
function shopPick(pool, n) {
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(mktRng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a.slice(0, Math.min(n, a.length));
}
// Turns the counter over. `quiet` is the boot roll - the first stock is not
// news, it is what the shop opened with.
function shopRestock(quiet) {
  market.stock = {
    tools: shopPick(Object.keys(TOOLS), SHOP_COLS),
    proj: shopPick(Object.keys(BITS).filter((k) => BITS[k].proj), SHOP_COLS),
    mods: shopPick(Object.keys(BITS).filter((k) => !BITS[k].proj), SHOP_COLS),
    cards: [],
  };
  for (let i = 0; i < SHOP_COLS; i++) market.stock.cards.push(rollCardRarity(SHOP_CARD_ODDS));
  market.stockT = SHOP_RESTOCK;
  market.n++;
  if (quiet) return;
  logEvent('THE MERCHANTS RESTOCK', null, { bg: '#2a2340', edge: '#c9a227', fg: '#f2cc6a' });
  if (state.shop || merchNear(player)) SFX.place();
}

// One offer, resolved from the stock: { kind, id, type, price }. `type` is the
// ITEMS key it becomes in a bag, which is what every icon, tooltip and bag
// call downstream wants. Returns null for a section that is not stocked.
function shopOffer(sec, i) {
  const st = market.stock;
  const list = st && st[sec];
  const id = list && list[i];
  if (!id) return null;
  if (sec === 'tools') return { kind: 'tool', id, type: toolType(id), price: TOOLS[id].price };
  if (sec === 'cards') return { kind: 'card', id, type: cardKey(id), price: CARD_PRICE[id] };
  return { kind: 'bit', id, type: bitType(id), price: BITS[id].price };
}

// ------------------------------------------------------------ buying and selling
// One price list, read two ways: `itemValue` is what the counter ASKS for one
// of a kind, `sellValue` is what it PAYS for what is in a bag cell. Half, for
// everything that was made - which is the whole margin the merchant lives on,
// and the reason looting is still better than shopping.
//
// The two GOODS are the exception: they trade at the live market price both
// ways, no spread at all. A spread would kill the only thing the market is
// for - buy low, hold, sell high - and there is nothing to protect, since the
// price does the taking all by itself.
const SHOP_REACH = 34; // px from a merchant's body the counter is open

// the merchant whose counter this slot is standing at, or null. Either team's:
// both counters serve everybody.
function merchNear(p) {
  let best = null, bd = SHOP_REACH + PLAYER_R;
  for (const b of robots) {
    if (!b.merchant || b.dead || b.hopT > 0) continue; // mid-hop it is still climbing down
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
// still standing at THIS counter - the check that shuts the panel when you walk off
function inReach(p, b) {
  return !!b && !b.dead && Math.hypot(b.x - p.x, b.y - p.y) <= SHOP_REACH + PLAYER_R;
}
// The other way round: the slot whose counter is OPEN on this merchant, or
// null. updateMerchant (js/robots.js) asks it every frame and drops
// everything - the gate, the felling, the loiter - while somebody is being
// served: a shopkeeper does not walk off mid-sale, and a counter that strolled
// away from its own customer would shut itself in their face while they read
// the prices.
//
// It is the OPEN PANEL and not mere proximity on purpose. Everybody lands at
// the roost together, so a merchant that stopped for anyone standing near it
// would never get its gate up at all.
// The local slot is the only one that can open a counter today; when other
// slots can, this is the one place that has to learn about them.
function shopServing(b) {
  return state.shop === b && player.active && !player.dead ? player : null;
}

// what one of a kind costs at the counter
function itemValue(type) {
  const t = toolIdOf(type); if (t) return TOOLS[t].price;
  const b = bitIdOf(type); if (b) return BITS[b].price;
  const r = CARD_TYPE_RARITY[type]; if (r) return CARD_PRICE[r];
  if (isGood(type)) return marketPrice(type);
  return 0;
}
// a whole bag cell at asking price - a tool carries its loaded bits, and they
// are worth what they are worth, so a loaded weapon is never sold as an empty one
function cellValue(s) {
  if (!s) return 0;
  let v = itemValue(s.type) * s.n;
  if (s.bits) for (const b of s.bits) if (b) v += BITS[b].price;
  return v;
}
// ...and what the merchant hands over for it
function sellValue(s) {
  if (!s) return 0;
  if (isGood(s.type)) return marketPrice(s.type) * s.n;
  return Math.max(1, Math.floor(cellValue(s) / 2));
}

// the local refusals, so a bot's failed order is silent
function shopDeny(p) { if (p === player) SFX.deny(); }
function shopNoRoom(p) { if (p === player) bagDenied(); }

// A LINE off the counter. Reached through runCmd (input.cmd {kind:'shop'}), so
// the HUD click, a bot and anything later all buy the same way - and it
// re-validates the reach itself, exactly as buyGear re-validates its cost, so
// a stale order from a slot that has since walked away is harmless. Nothing is
// contested: the stock is a window, not a queue, and two players at the same
// counter cannot take the same thing from each other.
function shopBuy(p, sec, i) {
  const o = shopOffer(sec, i);
  if (!o || !merchNear(p)) { shopDeny(p); return false; }
  const cost = { gold: o.price };
  if (!canAfford(cost, p)) { shopDeny(p); return false; }
  // room BEFORE money: nothing is ever paid for that cannot be carried
  if (o.kind === 'tool') {
    const cell = makeTool(o.id);
    if (!bagPut(p, cell)) { shopNoRoom(p); return false; }
  } else if (!bagAdd(p, o.type, 1)) {
    shopNoRoom(p);
    return false;
  }
  pay(cost, p);
  noteSeen(p, o.type); // bought counts as held: the tech tree opens on it
  shopFx(p, '-' + o.price, RES_COLORS.gold);
  if (p === player) SFX.coin();
  return true;
}

// A bag cell over the counter. The whole cell goes - an instanced tool cannot
// be split and a stack of berries has no reason to be - and the gold is a
// TRADE, not a payout: see tradeGold (js/player.js) for why a sale earns no
// levels. Returns the gold paid, 0 if nothing happened.
function shopSell(p, s) {
  if (!s || !merchNear(p)) { shopDeny(p); return 0; }
  const v = sellValue(s);
  if (v <= 0) { shopDeny(p); return 0; }
  tradeGold(p, v);
  shopFx(p, '+' + v, RES_COLORS.gold);
  if (p === player) SFX.coin();
  return v;
}
// ...the same sale, addressed by bag index: the path a bot or a later caller
// takes, since only the local human ever has an item on a cursor
function shopSellCell(p, i) {
  const s = p.bag[i];
  if (!s) { shopDeny(p); return 0; }
  const v = shopSell(p, s);
  if (v > 0) p.bag[i] = null;
  return v;
}

// One unit of a traded good, either way, at the live price. `dir` is +1 to buy
// and -1 to sell - one function, because the price is the same number in both
// directions and splitting it would be two ways to read one quantity.
function shopTrade(p, id, dir) {
  if (!isGood(id) || !merchNear(p)) { shopDeny(p); return false; }
  const price = marketPrice(id);
  if (dir > 0) {
    if (!canAfford({ gold: price }, p)) { shopDeny(p); return false; }
    if (!bagAdd(p, id, 1)) { shopNoRoom(p); return false; }
    pay({ gold: price }, p);
    shopFx(p, '-' + price, RES_COLORS[id]);
  } else {
    if (!bagTake(p, id, 1)) { shopDeny(p); return false; }
    tradeGold(p, price);
    shopFx(p, '+' + price, RES_COLORS[id]);
  }
  if (p === player) SFX.coin();
  return true;
}

// the coin popping off the body that traded - the same floater a payout uses,
// so money moving always looks the same wherever it moved
function shopFx(p, txt, col) {
  addFloater(p.x, p.y - 20, txt, col);
  burst(p.x, p.y - 8, col, 5, 40, 0.4);
}

// the one entry point runCmd hands a shop order to (js/ui.js)
function shopCmd(p, c) {
  if (c.act === 'buy') shopBuy(p, c.sec, c.i);
  else if (c.act === 'trade') shopTrade(p, c.good, c.dir);
  else if (c.act === 'sell') shopSellCell(p, c.i);
}

// ------------------------------------------------------------ the shop panel
// The counter, in the character sheet's chrome: one slab, the sim running
// live behind it. It is pinned in the room LEFT of the backpack rather than
// dead centre, because the pack is open beside it the whole time it is up -
// a sale is a DRAG out of the grid and into the sell well, so the grid has to
// be reachable and visible at once.
//
// LEFT: the four sections of the stock, three wells each, every well wearing
// its item's own tier plate and its price on a band along the bottom. A well
// you can afford warms and pulses the way a gear plate does; one you cannot
// goes flat. RIGHT: the SELL well at the top - pack, arrow, coin, and nothing
// written on it - and under it the two market cards, each carrying its live
// price, a three-day graph, and a pair of trade plates whose ARRANGEMENT is
// the direction: coin into item is a buy, item into coin is a sale.
//
// The labelled section headings and the graphs' own numbers are the panel
// carve-out of CLAUDE.md's UI rule, for the reason the practice instruments
// have one: reading a market IS reading numbers, and no shape compares a
// price today against a price yesterday.
// It is WIDE AND SHORT, and pinned near the TOP EDGE rather than centred,
// which is the one piece of this layout that is not taste: the tooltip is
// bottom-left and grows upward off the bottom rim, and a tall centred slab
// puts its own bottom-left corner exactly where a tall tooltip lands - so
// hovering the last row of offers would hide the last row of offers. Pinned
// at the top it ends at 190, and the tooltip that is up while the pointer is
// on the panel's own bottom row - the sell well's, which is three lines -
// tops out forty pixels below that. Only the deepest tooltip in the game (a
// fully loaded tool hovered in the PACK) reaches the strip at all, and that
// is while reading a price, not while dropping the thing on it.
const SHOP_W = 290, SHOP_H = 186, SHOP_Y = 4;
const SHOP_WELL_W = 42, SHOP_WELL_H = 28; // an offer's icon plate...
const SHOP_BAND = 8;                      // ...and the price band under it
const SHOP_SEC_W = SHOP_WELL_W * 3 + 8;   // a section: three wells and the gaps between
const SHOP_SEC_H = 6 + SHOP_WELL_H + SHOP_BAND;  // label + plate + band
const SHOP_CARD_W = 137, SHOP_CARD_H = 48;       // one market card
const SHOP_GRAPH_H = 20;
const SHOP_SELL_H = 16;                   // the sell strip along the bottom rim
const SHOP_BG = '#0a0e23', SHOP_IN = '#10173a';
// A price you cannot pay: the refusal red every other "not enough gold" in the
// game already speaks (tipGear's next-level row, the bag's own denial flash),
// said three ways at once on the well so it cannot be missed at a glance -
// a red rim, a red price band, and the goods themselves greyed back under a
// wash. It does not lift on hover either: a well that does not answer the
// pointer is not a button.
const SHOP_DEAR_RIM = '#6b2230', SHOP_DEAR_BAND = '#3a1420', SHOP_DEAR_INK = '#e0637a';
const SHOP_DEAR_WASH = 'rgba(8,10,26,0.62)';

// the counter is up: the panel is drawn, eats its own clicks, and holds the
// pack open beside it
function shopOpen() {
  return !!state.shop && state.mode === 'play' && !player.dead && !state.paused &&
    !state.mapOpen && !state.settingsOpen && !state.wheel && !window.DBG.hideUI;
}
function openShop(b) {
  if (!b) return false;
  state.shop = b;
  state.charOpen = false; // one slab at a time - they would sit on each other
  SFX.place();
  return true;
}
function closeShop() {
  if (!state.shop) return;
  state.shop = null;
  SFX.pickup();
}

// The whole geometry in one place, top to bottom: a header carrying the
// portrait and the purse; the turnover bar under it; the four sections as a
// 2x2 grid of three-well rows; the two market cards side by side; and the
// SELL strip along the bottom rim, the full width of the slab, because it is
// a drop target and a drop target should be hard to miss with an item on the
// cursor.
function shopLayout() {
  const x = Math.max(2, Math.round((VIEW_W - BAG_W - SHOP_W) / 2));
  const y = SHOP_Y;
  const secs = [];
  for (let i = 0; i < SHOP_SECTIONS.length; i++) {
    const sx = x + 6 + (i % 2) * (SHOP_SEC_W + 10);
    const sy = y + 28 + ((i / 2) | 0) * (SHOP_SEC_H + 2);
    const wells = [];
    for (let k = 0; k < SHOP_COLS; k++) {
      wells.push({ x: sx + k * (SHOP_WELL_W + 4), y: sy + 6, w: SHOP_WELL_W, h: SHOP_WELL_H + SHOP_BAND });
    }
    secs.push({ id: SHOP_SECTIONS[i].id, label: SHOP_SECTIONS[i].label, x: sx, y: sy, wells });
  }
  const cards = [];
  for (let i = 0; i < MKT_ORDER.length; i++) {
    const cx = x + 6 + i * (SHOP_CARD_W + 4), cy = y + 118;
    cards.push({ id: MKT_ORDER[i], x: cx, y: cy, w: SHOP_CARD_W, h: SHOP_CARD_H,
      graph: { x: cx + 3, y: cy + 12, w: SHOP_CARD_W - 6, h: SHOP_GRAPH_H },
      buy: { x: cx + 3, y: cy + 34, w: 64, h: 12 },
      sell: { x: cx + 70, y: cy + 34, w: 64, h: 12 } });
  }
  return {
    panel: { x, y, w: SHOP_W, h: SHOP_H },
    bar: { x: x + 4, y: y + 24, w: SHOP_W - 8, h: 2 },
    secs, cards,
    well: { x: x + 6, y: y + SHOP_H - SHOP_SELL_H - 4, w: SHOP_W - 12, h: SHOP_SELL_H },
    xr: { x: x + SHOP_W - 14, y: y + 4, w: 10, h: 10 },
  };
}

// 'x' | 'panel' | { kind:'buy', sec, i } | { kind:'sell' } |
// { kind:'trade', id, dir } | { kind:'good', id } | null.
// Shared by the click, the cursor and the tooltip, so the three can never
// disagree about what the pointer is on.
function shopHit(mx, my) {
  if (!shopOpen()) return null;
  const L = shopLayout(), p = L.panel;
  if (mx < p.x || mx >= p.x + p.w || my < p.y || my >= p.y + p.h) return null;
  if (hitR(L.xr, mx, my)) return 'x';
  for (const s of L.secs) {
    for (let i = 0; i < s.wells.length; i++) {
      if (hitR(s.wells[i], mx, my) && shopOffer(s.id, i)) return { kind: 'buy', sec: s.id, i };
    }
  }
  if (hitR(L.well, mx, my)) return { kind: 'sell' };
  for (const c of L.cards) {
    if (hitR(c.buy, mx, my)) return { kind: 'trade', id: c.id, dir: 1 };
    if (hitR(c.sell, mx, my)) return { kind: 'trade', id: c.id, dir: -1 };
    if (hitR(c, mx, my)) return { kind: 'good', id: c.id };
  }
  return 'panel';
}
function hitR(r, mx, my) { return mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h; }

// one left press inside the panel; returns whether it was swallowed
function shopClick(h) {
  if (!h) return false;
  if (h === 'x') { closeShop(); return true; }
  if (h.kind === 'buy') { SFX.unlock(); player.input.cmd = { kind: 'shop', act: 'buy', sec: h.sec, i: h.i }; return true; }
  if (h.kind === 'trade') { SFX.unlock(); player.input.cmd = { kind: 'shop', act: 'trade', good: h.id, dir: h.dir }; return true; }
  return true; // the slab eats the rest; the world never sees it
}
// A carried cell let go over the sell well (dragDrop, js/ui.js). It resolves
// on the spot rather than through input.cmd like the buys do: what is on the
// cursor is out of the bag already, and a command the sim might drop that
// frame (pause, the chart) would take the item with it.
function shopDropSell() {
  const d = state.drag;
  if (!d) return;
  if (shopSell(player, d.cell) > 0) state.drag = null;
  else dragReturn();
}

// ---- drawing -------------------------------------------------------------
function drawShopPanel(now) {
  const L = shopLayout(), P = L.panel;
  const h = mouse.inside ? shopHit(mouse.x, mouse.y) : null;
  ctx.fillStyle = 'rgba(4,6,18,0.38)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = 'rgba(4,6,18,0.55)'; chamRect(P.x + 3, P.y + 3, P.w, P.h);
  ctx.fillStyle = SHOP_BG; chamRect(P.x, P.y, P.w, P.h);
  ctx.fillStyle = SHOP_IN; chamRect(P.x + 1, P.y + 1, P.w - 2, P.h - 2);
  ctx.fillStyle = '#35426e';
  ctx.fillRect(P.x + 2, P.y + 1, P.w - 4, 1); ctx.fillRect(P.x + 1, P.y + 2, 1, P.h - 4);
  ctx.fillStyle = '#080c1c';
  ctx.fillRect(P.x + 2, P.y + P.h - 2, P.w - 4, 1); ctx.fillRect(P.x + P.w - 2, P.y + 2, 1, P.h - 4);

  // the header: whose counter this is, in that side's mark, with the purse
  // hard against the right edge - the one number the whole panel is spent from
  const b = state.shop;
  const mark = b ? TEAMS[skin(b.team)].mark : '#f4f7ff';
  if (b) {
    const spr = SPRITES.merchant[skin(b.team)].down[0];
    ctx.drawImage(spr, P.x + 5, P.y + 2, spr.width, spr.height);
  }
  drawPixelTextShadow(ctx, 'MERCHANT', P.x + 23, P.y + 7, mark, SHOP_BG);
  // the purse, right-aligned into the gap before the X - the one number the
  // whole panel is spent out of
  const gold = String(player.inv.gold);
  const gw = pixelTextWidth(gold), gx = P.x + P.w - 18 - gw;
  ctx.drawImage(SPRITES.itemGold, gx - 10, P.y + 5);
  drawPixelTextShadow(ctx, gold, gx, P.y + 7, RES_COLORS.gold, SHOP_BG);

  // the turnover clock: a bar that empties into the next restock. No number
  // and no word - it is a countdown, and a countdown is a length.
  const fr = Math.max(0, Math.min(1, market.stockT / SHOP_RESTOCK));
  ctx.fillStyle = '#141c3c'; ctx.fillRect(L.bar.x, L.bar.y, L.bar.w, L.bar.h);
  ctx.fillStyle = market.stockT < 15 ? (Math.sin(now * 9) > 0 ? '#f2cc6a' : '#8a6a2a') : '#3d4f85';
  ctx.fillRect(L.bar.x, L.bar.y, Math.round(L.bar.w * fr), L.bar.h);

  for (const s of L.secs) drawShopSection(s, h, now);
  for (const c of L.cards) drawMarketCard(c, h, now);
  drawSellWell(L.well, h, now);

  // the X: the drawn way out (ESC, E and walking away all close too)
  const hot = h === 'x';
  ctx.fillStyle = hot ? '#8fa0c8' : '#35426e';
  ctx.fillRect(L.xr.x, L.xr.y, L.xr.w, L.xr.h);
  ctx.fillStyle = '#0f1632';
  ctx.fillRect(L.xr.x + 1, L.xr.y + 1, L.xr.w - 2, L.xr.h - 2);
  ctx.fillStyle = hot ? '#f4f7ff' : '#8fa8d0';
  for (let k = 0; k < 4; k++) {
    ctx.fillRect(L.xr.x + 3 + k, L.xr.y + 3 + k, 1, 1);
    ctx.fillRect(L.xr.x + L.xr.w - 4 - k, L.xr.y + 3 + k, 1, 1);
  }
}

// one section: its name, then its three wells
function drawShopSection(s, h, now) {
  drawPixelTextShadow(ctx, s.label, s.x, s.y, '#7a8bb8', SHOP_BG);
  ctx.fillStyle = '#222c55';
  ctx.fillRect(s.x + pixelTextWidth(s.label) + 4, s.y + 2, SHOP_SEC_W - pixelTextWidth(s.label) - 4, 1);
  for (let i = 0; i < s.wells.length; i++) {
    const o = shopOffer(s.id, i);
    const hot = !!h && h.kind === 'buy' && h.sec === s.id && h.i === i;
    drawShopWell(s.wells[i], o, hot, now);
  }
}

// One offer. The plate is the item's own TIER colour, exactly as it is in
// every other well in the game, so a gilded tool reads as a gilded tool on
// the counter too; the price band under it is the only new part, and it says
// afford / cannot afford in ink alone.
function drawShopWell(r, o, hot, now) {
  const dear = !!o && player.inv.gold < o.price; // out of reach: SHOP_DEAR_* above
  const y = r.y - (hot && !dear ? 1 : 0);
  const iconH = SHOP_WELL_H;
  ctx.fillStyle = 'rgba(4,6,18,0.55)'; ctx.fillRect(r.x + 2, r.y + 2, r.w, r.h);
  if (!o) { // an empty line: a flat well and nothing in it
    ctx.fillStyle = '#232c52'; ctx.fillRect(r.x, y, r.w, r.h);
    ctx.fillStyle = BAG_WELL; ctx.fillRect(r.x + 1, y + 1, r.w - 2, r.h - 2);
    return;
  }
  const tp = tierPlate(o.type, hot);
  ctx.fillStyle = dear ? SHOP_DEAR_RIM : hot ? '#8fa0c8' : tp.rim;
  ctx.fillRect(r.x, y, r.w, r.h);
  ctx.fillStyle = tp.plate;
  ctx.fillRect(r.x + 1, y + 1, r.w - 2, iconH - 1);
  if (!dear) tierShine({ x: r.x, y: r.y, w: r.w, h: iconH }, y, o.type, now); // nothing you cannot buy shines
  // the icon at 2x: a counter shows its goods bigger than a bag cell does,
  // and a whole-number scale is the only one that keeps the pixels square
  const im = SPRITES[ITEMS[o.type].icon];
  if (im) {
    ctx.drawImage(im, r.x + ((r.w - im.width * 2) >> 1), y + ((iconH - im.height * 2) >> 1),
      im.width * 2, im.height * 2);
  }
  // ...under a wash if it is out of reach, so the GOODS grey back with the
  // price rather than the price greying out alone. The tier plate keeps its
  // own hue through it - which tier a thing is stays true whatever it costs.
  if (dear) {
    ctx.fillStyle = SHOP_DEAR_WASH;
    ctx.fillRect(r.x + 1, y + 1, r.w - 2, iconH - 1);
  }
  // the price band, flush along the bottom of the plate
  ctx.fillStyle = dear ? SHOP_DEAR_BAND : '#141c3c';
  ctx.fillRect(r.x + 1, y + iconH, r.w - 2, SHOP_BAND - 1);
  const txt = String(o.price);
  const cx = r.x + ((r.w - (9 + pixelTextWidth(txt))) >> 1);
  ctx.globalAlpha = dear ? 0.5 : 1;
  ctx.drawImage(SPRITES.itemGold, cx, y + iconH);
  ctx.globalAlpha = 1;
  drawPixelText(ctx, txt, cx + 9, y + iconH + 2, dear ? SHOP_DEAR_INK : RES_COLORS.gold);
}

// The SELL strip: the full width of the slab's bottom rim, a recessed well
// with corner brackets, and the word on it. It is the one control here that
// is not a click - you arrive at it holding something - so it says SELL
// rather than trusting a glyph to carry a verb, and it is wide because a drop
// target you are aiming at with an item on the cursor should be hard to miss.
// Idle it is SELL -> a coin; with something in hand it becomes that item ->
// a coin and the gold it fetches, and the whole well lights and pulses.
function drawSellWell(r, h, now) {
  const d = state.drag;
  const hot = !!h && h.kind === 'sell';
  const live = !!d && hot;
  ctx.fillStyle = 'rgba(4,6,18,0.55)'; ctx.fillRect(r.x + 2, r.y + 2, r.w, r.h);
  ctx.fillStyle = live ? (Math.sin(now * 10) > 0 ? '#f2cc6a' : '#c9a227') : d ? '#8fa0c8' : '#35426e';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = BAG_WELL;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  // the four corner brackets that say "a target", the world's own hover mark
  ctx.fillStyle = d ? '#f2cc6a' : '#2c3560';
  for (const [cx, cy, dx, dy] of [[r.x + 3, r.y + 3, 1, 1], [r.x + r.w - 4, r.y + 3, -1, 1],
    [r.x + 3, r.y + r.h - 4, 1, -1], [r.x + r.w - 4, r.y + r.h - 4, -1, -1]]) {
    ctx.fillRect(cx, cy, 4 * dx, 1); ctx.fillRect(cx, cy, 1, 4 * dy);
  }
  // the content, centred as one group: the word, what is going in, the arrow,
  // the coin, and - only while there is something to price - what it fetches
  const im = d ? SPRITES[ITEMS[d.cell.type].icon] : null;
  const txt = d ? '+' + sellValue(d.cell) : '';
  const lab = 'SELL', labW = pixelTextWidth(lab);
  const wide = labW + 6 + (im ? im.width + 4 : 0) + 5 + 4 + 8 + (d ? 4 + pixelTextWidth(txt) : 0);
  let cx = r.x + ((r.w - wide) >> 1);
  const mid = r.y + ((r.h - 5) >> 1);
  drawPixelTextShadow(ctx, lab, cx, mid, d ? '#ffd95c' : '#9fb6d8', SHOP_BG);
  cx += labW + 6;
  if (im) { ctx.drawImage(im, cx, r.y + ((r.h - im.height) >> 1)); cx += im.width + 4; }
  drawTradeArrow(cx, r.y + (r.h >> 1), 1, d ? '#f2cc6a' : '#4a5a8c');
  cx += 5 + 4;
  ctx.globalAlpha = d ? 1 : 0.75;
  ctx.drawImage(SPRITES.itemGold, cx, r.y + ((r.h - 8) >> 1));
  ctx.globalAlpha = 1;
  if (d) drawPixelTextShadow(ctx, txt, cx + 12, mid, RES_COLORS.gold, SHOP_BG);
}

// a 5x5 triangle: the direction a trade runs, and the only thing on a trade
// plate that says which way it goes
function drawTradeArrow(x, y, dir, col) {
  ctx.fillStyle = col;
  for (let i = 0; i < 3; i++) ctx.fillRect(x + (dir > 0 ? i : 2 - i), y - 2 + i, 1, 5 - i * 2);
}

// One traded good: the live price, the three days behind it, and the two
// plates that move it. Nothing here says "buy" or "sell" in words - the coin
// on the left of an arrow is money going out, the coin on the right is money
// coming in.
function drawMarketCard(c, h, now) {
  const g = GOODS[c.id], r = market.goods[c.id];
  const col = RES_COLORS[c.id];
  const price = marketPrice(c.id);
  const hist = r.hist;
  const prev = hist.length > 1 ? hist[hist.length - 2] : r.price;
  const up = r.price >= prev;
  ctx.fillStyle = 'rgba(4,6,18,0.5)'; ctx.fillRect(c.x + 2, c.y + 2, c.w, c.h);
  ctx.fillStyle = r.pop > 0 ? (Math.sin(now * 8) > 0 ? col : '#35426e') : '#35426e';
  ctx.fillRect(c.x, c.y, c.w, c.h);
  ctx.fillStyle = '#0d1229';
  ctx.fillRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);

  // name on the left, price on the right in the direction of the last move
  ctx.drawImage(SPRITES[ITEMS[c.id].icon], c.x + 3, c.y + 2);
  drawPixelTextShadow(ctx, g.name, c.x + 13, c.y + 3, '#9fb6d8', SHOP_BG);
  const pt = String(price);
  const pw = pixelTextWidth(pt, 2);
  drawPixelTextShadow(ctx, pt, c.x + c.w - 4 - pw, c.y + 1, up ? '#8fe08a' : '#e0637a', SHOP_BG, 2);
  drawTrend(c.x + c.w - 10 - pw, c.y + 4, up);

  drawMarketGraph(c.graph, c.id, col);

  // the two plates. Carrying none of a good greys its sale; not affording one
  // greys the buy - the same can/cannot ink every price in the game uses.
  const held = bagCount(player, c.id);
  const dear = player.inv.gold < price; // ...as against merely having no room for one
  drawTradePlate(c.buy, 1, c.id, !dear && bagRoom(player, c.id) > 0,
    !!h && h.kind === 'trade' && h.id === c.id && h.dir > 0, now, dear);
  drawTradePlate(c.sell, -1, c.id, held > 0, !!h && h.kind === 'trade' && h.id === c.id && h.dir < 0, now, false);
  // what you are carrying, on the sale plate's own edge: the number that
  // decides whether the plate is even worth pressing
  if (held > 0) {
    const ht = String(held);
    drawPixelTextShadow(ctx, ht, c.sell.x + c.sell.w - 3 - pixelTextWidth(ht), c.sell.y + 3, col, SHOP_BG);
  }
}

// The last move, as a 5x3 triangle beside the price: apex up on a rise, apex
// down on a fall. Three rows narrowing toward the point, drawn from the row
// the apex is on, so the shape says the direction even in one colour.
function drawTrend(x, y, up) {
  ctx.fillStyle = up ? '#8fe08a' : '#e0637a';
  for (let i = 0; i < 3; i++) {
    const w = up ? 1 + i * 2 : 5 - i * 2;
    ctx.fillRect(x + (up ? 2 - i : i), y + i, w, 1);
  }
}

// A trade plate: coin -> item is a buy, item -> coin is a sale. `on` is
// whether the trade can be made at all; a dead plate goes flat and dark, and
// `dear` says the reason is the PRICE rather than a full pack, so it wears
// the counter's out-of-reach red like an offer well does.
function drawTradePlate(r, dir, id, on, hot, now, dear) {
  const y = r.y - (hot && on ? 1 : 0);
  ctx.fillStyle = 'rgba(4,6,18,0.5)'; ctx.fillRect(r.x + 1, r.y + 1, r.w, r.h);
  ctx.fillStyle = dear ? SHOP_DEAR_RIM : !on ? '#232c52' : hot ? '#8fa0c8' : (Math.sin(now * 6) > 0 ? '#4a5a8c' : '#41527f');
  ctx.fillRect(r.x, y, r.w, r.h);
  ctx.fillStyle = dear ? SHOP_DEAR_BAND : on ? '#141c3c' : '#0c1128';
  ctx.fillRect(r.x + 1, y + 1, r.w - 2, r.h - 2);
  const item = SPRITES[ITEMS[id].icon], coin = SPRITES.itemGold;
  const x0 = r.x + ((r.w - 29) >> 1), iy = y + 2;
  ctx.globalAlpha = on ? 1 : 0.4;
  if (dir > 0) {
    ctx.drawImage(coin, x0, iy);
    drawTradeArrow(x0 + 13, iy + 4, 1, on ? '#f4f7ff' : '#4a5a8c');
    ctx.drawImage(item, x0 + 21, iy);
  } else {
    ctx.drawImage(item, x0, iy);
    drawTradeArrow(x0 + 13, iy + 4, 1, on ? '#f4f7ff' : '#4a5a8c');
    ctx.drawImage(coin, x0 + 21, iy);
  }
  ctx.globalAlpha = 1;
}

// The three-day graph: MKT_HIST samples across the well, the area under the
// line filled in the good's own colour, a dotted line per day boundary so
// three days READ as three days, and the range printed small at the ends -
// a chart with no scale is a squiggle.
function drawMarketGraph(r, id, col) {
  const hist = market.goods[id].hist;
  ctx.fillStyle = BAG_WELL;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = '#151b3a';
  ctx.fillRect(r.x, r.y, r.w, 1); ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
  if (hist.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const v of hist) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 0.5) { hi = lo + 0.5; }
  const n = hist.length;
  const px = (i) => r.x + Math.round(i / (n - 1) * (r.w - 1));
  const py = (v) => r.y + r.h - 2 - Math.round((v - lo) / (hi - lo) * (r.h - 4));
  // the day marks, counted back from now
  const per = CYCLE / MKT_STEP;
  ctx.fillStyle = '#20294f';
  for (let d = 1; d < MKT_DAYS; d++) {
    const i = (n - 1) - d * per;
    if (i < 0) continue;
    const gx = px(i);
    for (let y = r.y + 1; y < r.y + r.h - 1; y += 3) ctx.fillRect(gx, y, 1, 2);
  }
  // the area, then the line over it
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const x = px(i), y = py(hist[i]);
    ctx.fillRect(x, y, 1, r.y + r.h - 1 - y);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = col;
  let lx = px(0), ly = py(hist[0]);
  for (let i = 1; i < n; i++) {
    const x = px(i), y = py(hist[i]);
    // a vertical run between the two samples keeps the line unbroken where it jumps
    const y0 = Math.min(ly, y), y1 = Math.max(ly, y);
    ctx.fillRect(x, y0, 1, y1 - y0 + 1);
    if (x > lx + 1) ctx.fillRect(lx, ly, x - lx, 1);
    lx = x; ly = y;
  }
  // the head of the line, and the range it moved through
  ctx.fillStyle = '#f4f7ff';
  ctx.fillRect(lx - 1, ly - 1, 3, 3);
  ctx.fillStyle = col;
  ctx.fillRect(lx, ly, 1, 1);
  drawPixelTextShadow(ctx, String(Math.round(hi)), r.x + 2, r.y + 2, '#5a6a99', BAG_WELL);
  drawPixelTextShadow(ctx, String(Math.round(lo)), r.x + 2, r.y + r.h - 8, '#5a6a99', BAG_WELL);
}

// ---- tooltips ------------------------------------------------------------
// What the pointer is on at the counter, in the shared descriptor shape
// (tipBase and friends, js/ui.js) - so an offer describes itself with exactly
// the rows the same item shows in the pack, plus what it costs.
function tipShop(h) {
  if (!h || h === 'x' || h === 'panel') return null;
  if (h.kind === 'buy') {
    const o = shopOffer(h.sec, h.i);
    if (!o) return null;
    const d = o.kind === 'tool' ? tipTool(makeTool(o.id))
      : o.kind === 'bit' ? tipBit(o.id, heldTool(player))
      : tipStack({ type: o.type, n: 1 });
    d.rows.unshift(['PRICE', o.price + ' GOLD', player.inv.gold >= o.price ? RES_COLORS.gold : '#e0637a']);
    d.notes.push(['CLICK TO BUY ONE', TIP_DIM]);
    return d;
  }
  if (h.kind === 'sell') {
    const d = { title: 'SELL', tcol: RES_COLORS.gold, kind: 'THE COUNTER', rows: [], notes: [],
      icon: SPRITES.itemGold, plate: BAG_WELL, rim: '#35426e' };
    if (state.drag) {
      d.rows.push(['THIS FETCHES', sellValue(state.drag.cell) + ' GOLD', RES_COLORS.gold]);
      d.notes.push(['LET GO HERE TO SELL IT', TIP_DIM]);
    } else {
      d.notes.push(['DRAG ANYTHING OUT OF THE PACK', TIP_DIM]);
      d.notes.push(['MADE GOODS FETCH HALF THEIR PRICE', TIP_DIM]);
      d.notes.push(['FISH AND BERRIES FETCH THE MARKET', TIP_DIM]);
    }
    return d;
  }
  const id = h.id;
  const g = GOODS[id], r = market.goods[id];
  const price = marketPrice(id);
  let lo = Infinity, hi = -Infinity;
  for (const v of r.hist) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const per = Math.floor(CYCLE / MKT_STEP);
  const back = r.hist.length > per ? r.hist[r.hist.length - 1 - per] : r.hist[0];
  const chg = Math.round((r.price - back) / Math.max(1, back) * 100);
  const d = { title: g.name, tcol: RES_COLORS[id], kind: 'TRADED GOOD', rows: [], notes: [],
    icon: SPRITES[ITEMS[id].icon], plate: BAG_WELL, rim: '#35426e' };
  d.rows.push(['PRICE', price + ' GOLD', RES_COLORS.gold]);
  d.rows.push(['A DAY AGO', (chg >= 0 ? '+' : '') + chg + '%', chg >= 0 ? '#8fe08a' : '#e0637a']);
  d.rows.push([MKT_DAYS + ' DAY HIGH', String(Math.round(hi)), '#f4f7ff']);
  d.rows.push([MKT_DAYS + ' DAY LOW', String(Math.round(lo)), '#f4f7ff']);
  d.rows.push(['CARRIED', String(bagCount(player, id)), '#f4f7ff']);
  if (h.kind === 'trade') d.notes.push([h.dir > 0 ? 'CLICK TO BUY ONE' : 'CLICK TO SELL ONE', TIP_DIM]);
  d.notes.push(['IT TRADES AT ONE PRICE BOTH WAYS', TIP_DIM]);
  return d;
}

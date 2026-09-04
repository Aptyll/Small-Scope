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
  const k = up ? 'spike' : 'crash';
  logEvent(GOODS[id].name + (up ? ' SPIKE ' : ' CRASH ') + now + 'G', null, NOTE_KIND[k]);
  marketNotice(k, now + 'G', id); // ...and the plate under the minimap
  SFX.market(up);
}

// Three days of trading before anyone landed, so the graphs are graphs on day
// one rather than a flat line that fills in over the first quarter of an hour.
function initMarket() {
  market.t = 0;
  notices.length = 0; // a new match starts with a clear corner
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

// ------------------------------------------------------------ market notices
// The market's news as something you SEE, not something you read in a log.
//
// Every headline here leaves its line in the event feed as well (logEvent,
// js/panels.js) - the feed is the match's own record and the market belongs
// in it - but the feed is bottom-left, small, and full of what happened to
// SLOTS. A price is not something that happened to a slot: it is the state of
// the world you are about to sell your bag into, and it has to arrive where
// the other things you glance at mid-fight are. So it also raises a PLATE,
// top-right, hard under the minimap beside the clock and the alive count.
//
// One shape, three notices, read left to right with no sentence in it: the
// merchant's GOLD SACK (the same mark on every plate - this is the shop
// talking), then what it is about (the good's own item icon and the price it
// landed on, or NEW STOCK for a turnover), then one glyph carrying WHICH WAY
// - an arrow up, an arrow down, or a crate. The plate's frame and ink carry
// the same green/red/gold the feed line does, so the two readouts of one
// event never disagree.
const NOTE_MAX = 3;      // plates on screen at once; the oldest falls off the bottom
const NOTE_LIFE = 7;     // s from arrival to gone
const NOTE_IN = 0.3;     // arrival: slides in off the right edge under a white pop
const NOTE_OUT = 0.8;    // ...and fades over its last stretch
const NOTE_W = 76, NOTE_H = 18, NOTE_PITCH = 21;
const NOTE_GAP = 18;     // below the disc's alive/clock row, which ends 14px under it
const notices = [];      // {kind, txt, good, t}; ageNotices runs the clock

// the merchant's mark: a cinched sack of coin, tied at the neck, with one
// piece of gold showing on the belly. 12x12 - the plate's whole height less
// its rim, so the icon IS the left edge of the card
const NOTE_SACK = [
  '....o..o....',
  '...ollllo...',
  '...otttto...',
  '..olccccdo..',
  '.olccccccdo.',
  'olcccccccddo',
  'olcccggcccdo',
  'olccghhgccdo',
  'olccgkkgccdo',
  'olcccggcccdo',
  '.occccccddo.',
  '..oooooooo..',
];
const NOTE_SACK_PAL = { '.': null, o: '#2b1d12', t: '#6f4a26', l: '#e0c088', c: '#c49a56',
  d: '#8a6a34', g: '#f2cc6a', h: '#ffedb0', k: '#b8912f' };
// the tails: which way the price went, or a crate for a counter that just
// turned over. 8x8, the item icons' own grid, so the row reads as one rank.
const NOTE_TAILS = {
  up: ['........', '...aa...', '..ahha..', '.ahhhha.', 'aahhhhaa', '..ahha..', '..ahha..', '..ahha..'],
  down: ['..ahha..', '..ahha..', '..ahha..', 'aahhhhaa', '.ahhhha.', '..ahha..', '...aa...', '........'],
  crate: ['oooooooo', 'owwwwwwo', 'obwbbwbo', 'obwbbwbo', 'obwbbwbo', 'obwbbwbo', 'owwwwwwo', 'oooooooo'],
};
const NOTE_CRATE_PAL = { '.': null, o: '#3a2a16', b: '#8a6a34', w: '#c49a56' };
// One palette per kind, worn by the plate AND handed to logEvent for the feed
// line: bg/edge/fg are exactly the keys logEvent's `o` override reads, so the
// two cannot drift apart.
const NOTE_KIND = {
  spike: { bg: '#14351f', edge: '#8fe08a', fg: '#b8f0b0', tail: 'up',
    tp: { '.': null, a: '#5aa85e', h: '#b8f0b0' } },
  crash: { bg: '#3a1420', edge: '#e0637a', fg: '#ff9a8a', tail: 'down',
    tp: { '.': null, a: '#a83c50', h: '#ff9a8a' } },
  stock: { bg: '#2a2340', edge: '#c9a227', fg: '#f2cc6a', tail: 'crate', tp: NOTE_CRATE_PAL },
};

// raise one. `good` is a GOODS/ITEMS key whose icon rides beside the text, or
// null for a notice about the counter itself.
function marketNotice(kind, txt, good) {
  notices.push({ kind, txt: String(txt).toUpperCase(), good, t: 0 });
  while (notices.length > NOTE_MAX * 2) notices.shift();
}

// Chrome, like the event feed: it ages on WALL time from updateFx (js/sim.js),
// so a plate fades out while the sim is paused rather than hanging there.
function ageNotices(dt) {
  for (let i = notices.length - 1; i >= 0; i--) {
    notices[i].t += dt;
    if (notices[i].t > NOTE_LIFE) notices.splice(i, 1);
  }
}

// the slot a plate rests in, newest first: k = 0 sits under the disc's clock
// row, right edge flush with the disc's own. Off MM_* so it follows the
// minimap wherever the size dial and the view put it.
function noteRect(k) {
  return { x: MM_CX + MM_R - NOTE_W, y: MM_CY + MM_R + NOTE_GAP + k * NOTE_PITCH, w: NOTE_W, h: NOTE_H };
}

// Drawn from renderUI (js/ui.js) after the counter and the character sheet:
// news that arrives mid-trade must not hide behind the thing it is about.
function renderNotices() {
  const n = Math.min(NOTE_MAX, notices.length);
  if (!n) return;
  // the newest arrives at the top and pushes the stack down under it, on the
  // same ease that slides it in - so nothing below it jumps a whole pitch
  const push = easeOut(notices[notices.length - 1].t / NOTE_IN);
  // oldest first, so the newest lands ON TOP of the stack it is pushing down:
  // during the ease the plate below starts under it and slides out from
  // beneath, which is the motion that reads as a shove rather than a collision
  for (let k = n - 1; k >= 0; k--) {
    const e = notices[notices.length - 1 - k], K = NOTE_KIND[e.kind] || NOTE_KIND.stock;
    const slide = 1 - easeOut(e.t / NOTE_IN);
    const a = Math.min(1, e.t / (NOTE_IN * 0.5)) * Math.min(1, (NOTE_LIFE - e.t) / NOTE_OUT);
    if (a <= 0) continue;
    const r = noteRect(k);
    const x = r.x + Math.round(slide * 26); // in off the right edge
    const y = Math.round(r.y - (k ? (1 - push) * NOTE_PITCH : 0));
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(6,9,22,0.8)'; // base: the world must not read through the plate
    ctx.fillRect(x, y, NOTE_W, NOTE_H);
    ctx.globalAlpha = a * 0.85;
    ctx.fillStyle = K.bg;
    ctx.fillRect(x, y, NOTE_W, NOTE_H);
    ctx.globalAlpha = a;
    ctx.fillStyle = K.edge; // a full 1px frame: this is a card, not a feed line
    ctx.fillRect(x, y, NOTE_W, 1); ctx.fillRect(x, y + NOTE_H - 1, NOTE_W, 1);
    ctx.fillRect(x, y, 1, NOTE_H); ctx.fillRect(x + NOTE_W - 1, y, 1, NOTE_H);
    if (slide > 0) { // the arrival pop, as the feed's lines take one
      ctx.globalAlpha = a * 0.55 * slide * slide;
      ctx.fillStyle = '#f4f7ff';
      ctx.fillRect(x + 1, y + 1, NOTE_W - 2, NOTE_H - 2);
      ctx.globalAlpha = a;
    }
    stampGrid(NOTE_SACK, NOTE_SACK_PAL, x + 3, y + 3, 1);
    let tx = x + 18;
    const im = e.good && ITEMS[e.good] && SPRITES[ITEMS[e.good].icon];
    if (im) { ctx.drawImage(im, tx, y + 5); tx += im.width + 2; }
    // the plate is opaque and it fades, so the shadow font, not the outline
    drawPixelTextShadow(ctx, e.txt, tx, y + 7, K.fg, 'rgba(6,9,22,0.9)');
    stampGrid(NOTE_TAILS[K.tail], K.tp, x + NOTE_W - 12, y + 5, 1);
    ctx.globalAlpha = 1;
  }
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
  logEvent('THE MERCHANTS RESTOCK', null, NOTE_KIND.stock);
  // The plate and its cue are NOT gated on standing at a counter the way the
  // old blip was: a turnover is the one market event you might want to walk
  // across the map for, and news you only hear once you are already there is
  // not news.
  marketNotice('stock', 'NEW STOCK', null);
  SFX.restock();
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
// THE TRADING POST: one slab, the sim running live behind it. It is pinned in
// the room LEFT of the backpack rather than dead centre, because the pack is
// open beside it the whole time it is up - a sale is a DRAG out of the grid
// and into the sell well, so the grid has to be reachable and visible at once.
//
// The name is load-bearing. The POST is the shop; the MARKET is one corner of
// it, under its own rule, and it is the only corner whose prices move. Calling
// the whole slab a market would say the twelve offers above it were traded
// goods too, and they are not: every one of them is priced once, on its own def.
//
// Top to bottom: the AWNING - a snow-capped, icicled valance in the counter's
// own team colours, with the shop's sign hung off its hem between two lanterns,
// the merchant's portrait at one end and the purse at the other; the turnover
// bar; the four SECTIONS of the stock, three wells each on a recessed board,
// every well wearing its item's own tier plate with its price on a band along
// the bottom; the MARKET rule and its two cards, each carrying a live price, a
// three-day graph and a pair of trade plates whose ARRANGEMENT is the
// direction; and the SELL well along the counter's edge.
//
// Two rules make the stock read as one grid rather than as twelve loose
// pictures, which is what it looked like before:
//   - EVERY offer's icon is drawn at exactly SHOP_ICON px. The game keeps its
//     icons on two grids, 8x8 and 12x12, so 3x and 2x land both of them on 24 -
//     whole-number scales, square pixels, one silhouette size down the whole
//     counter, instead of a tool with twice the area of the bit beside it.
//   - A price band's coin sits at a FIXED offset and its number is right-
//     aligned to another, so a section's three prices line up as a column
//     instead of three centred groups sliding about with the digit count.
//
// The labelled section headings and the graphs' own numbers are the panel
// carve-out of CLAUDE.md's UI rule, for the reason the practice instruments
// have one: reading a market IS reading numbers, and no shape compares a
// price today against a price yesterday.
//
// It is WIDE AND SHORT, and pinned near the TOP EDGE rather than centred,
// which is the one piece of this layout that is not taste: the tooltip is
// bottom-left and grows upward off the bottom rim, and a tall centred slab
// puts its own bottom-left corner exactly where a tall tooltip lands - so
// hovering the last row of offers would hide the last row of offers. Its
// HEIGHT is spent against the same rule: pinned at the top it ends at 206, and
// the deepest tooltip a well here can raise tops out around 192 on the 480x270
// view a full screen gives - so what a tooltip can ever cover is the sell
// strip's own top edge, never the offers or the cards being read. That is what
// caps the slab at 202 tall while it grew 46 px wider; the room came out of
// the width, which has none of that fight, and out of the layout.
const SHOP_W = 336, SHOP_H = 202, SHOP_Y = 4;
const SHOP_PAD = 8;        // frame edge to content
const SHOP_HEAD = 22;      // the awning band, and the sign row hung off its hem
const SHOP_ICON = 24;      // every offer's icon, whatever grid it was drawn on
const SHOP_WELL_W = 48, SHOP_WELL_H = 28; // an offer's icon plate...
const SHOP_BAND = 9;                      // ...and the price band under it
const SHOP_WELL_GAP = 5;
const SHOP_SEC_W = SHOP_WELL_W * 3 + SHOP_WELL_GAP * 2; // a section: three wells and the gaps between
const SHOP_SEC_HEAD = 8;                                // its name, and the rule off it
const SHOP_SEC_H = SHOP_SEC_HEAD + SHOP_WELL_H + SHOP_BAND;
const SHOP_CARD_W = 157, SHOP_CARD_H = 46;              // one market card
const SHOP_GRAPH_H = 22;
const SHOP_SELL_H = 16;    // the sell strip along the counter's edge
const SHOP_FOOT = 5;       // that counter edge itself; the frame is 3 on the other three sides
const SHOP_BG = '#0a0e23', SHOP_IN = '#10173a';
const SHOP_BOARD = '#0b1030'; // the recess a section's three wells stand on
// The post's TIMBER: the frame, the corner brackets, the section rules, the
// market cards and the counter edge are all cut from it, which is what makes
// the slab read as a shopfront rather than as one more blue HUD panel.
const SHOP_WOOD_D = '#241a12', SHOP_WOOD = '#5c4226', SHOP_WOOD_L = '#8a6142';
const SHOP_LABEL = '#c9a874';  // a heading, in the timber's own ink
const SHOP_SNOW = '#f4f7ff', SHOP_SNOW_D = '#c4d4ea';
const SHOP_CLOTH = '#e0d3ad', SHOP_CLOTH_L = '#f0e6cc', SHOP_CLOTH_D = '#c9b78d'; // the awning's cream stripe
const SHOP_LAMP = '#ffd07a', SHOP_LAMP_D = '#c9832a', SHOP_IRON = '#6c7486', SHOP_IRON_L = '#aeb6c4';
const SHOP_SIGN = 'TRADING POST';
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
// The post has a song of its own, and it takes the music layer for exactly as
// long as the counter is open: SFX.music.hold notes what was playing AND the
// second it had reached, and the release at the far end puts it back there - so
// a trip to the shop costs the match's track the bars it covered rather than
// the whole song (the `music` banner, js/audio.js).
function openShop(b) {
  if (!b) return false;
  state.shop = b;
  state.charOpen = false; // one slab at a time - they would sit on each other
  SFX.place();
  SFX.music.hold('village', { in: 0.6, out: 0.5 });
  return true;
}
function closeShop() {
  if (!state.shop) return;
  state.shop = null;
  SFX.pickup();
  SFX.music.release({ in: 0.8, out: 0.5 });
}

// The whole geometry in one place, top to bottom: the sign row hung off the
// awning, carrying the portrait and the purse; the turnover bar under it; the
// four sections as a 2x2 grid of three-well rows; the MARKET rule and its two
// cards side by side; and the SELL strip along the bottom rim, the full width
// of the slab, because it is a drop target and a drop target should be hard to
// miss with an item on the cursor.
function shopLayout() {
  const x = Math.max(2, Math.round((VIEW_W - BAG_W - SHOP_W) / 2));
  const y = SHOP_Y;
  const cx = x + SHOP_PAD, cw = SHOP_W - SHOP_PAD * 2;
  const secs = [];
  for (let i = 0; i < SHOP_SECTIONS.length; i++) {
    const sx = cx + (i % 2) * (cw - SHOP_SEC_W); // the two columns pinned to the two edges
    const sy = y + SHOP_HEAD + 6 + ((i / 2) | 0) * (SHOP_SEC_H + 3);
    const wells = [];
    for (let k = 0; k < SHOP_COLS; k++) {
      wells.push({ x: sx + k * (SHOP_WELL_W + SHOP_WELL_GAP), y: sy + SHOP_SEC_HEAD,
        w: SHOP_WELL_W, h: SHOP_WELL_H + SHOP_BAND });
    }
    secs.push({ id: SHOP_SECTIONS[i].id, label: SHOP_SECTIONS[i].label, x: sx, y: sy, wells });
  }
  const mkY = y + SHOP_HEAD + 6 + SHOP_SEC_H * 2 + 3 + 3; // under the second row of sections
  const cards = [];
  for (let i = 0; i < MKT_ORDER.length; i++) {
    const kx = cx + i * (cw - SHOP_CARD_W), ky = mkY + 8;
    cards.push({ id: MKT_ORDER[i], x: kx, y: ky, w: SHOP_CARD_W, h: SHOP_CARD_H,
      graph: { x: kx + 3, y: ky + 11, w: SHOP_CARD_W - 6, h: SHOP_GRAPH_H },
      buy: { x: kx + 3, y: ky + 34, w: 73, h: 11 },
      sell: { x: kx + 81, y: ky + 34, w: 73, h: 11 } });
  }
  return {
    panel: { x, y, w: SHOP_W, h: SHOP_H },
    head: { x: cx, y: y + 11, w: cw, h: 11 }, // the sign row, hung off the awning's hem
    bar: { x: cx, y: y + SHOP_HEAD + 2, w: cw, h: 2 },
    mkt: { x: cx, y: mkY, w: cw, h: 8 },
    secs, cards,
    well: { x: cx, y: y + SHOP_H - SHOP_FOOT - SHOP_SELL_H, w: cw, h: SHOP_SELL_H },
    xr: { x: x + SHOP_W - SHOP_PAD - 11, y: y + 11, w: 11, h: 11 },
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
// The post's chrome, baked once a side: the timber frame with its iron corner
// brackets, the striped awning valance with snow on its crown and icicles off
// its scalloped hem, and the counter edge along the bottom rim. The middle is
// CLEARED, so this is a frame and a valance and nothing else and the live pass
// still owns the slab's own ground and every well on it. Keyed by team, because
// the awning's stripes are whose counter this is - the one thing on the panel
// that says it, now the sign carries the shop's name instead.
function shopChromeCv(ti) {
  const cache = shopChromeCv.cache || (shopChromeCv.cache = {});
  if (cache[ti]) return cache[ti];
  const W = SHOP_W, H = SHOP_H, T = TEAMS[ti];
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

  // the frame: a dark outline, a course of timber inside it lit from the upper
  // left, and a thicker course along the bottom - the counter's own edge
  px(0, 0, W, H, SHOP_WOOD_D);
  px(1, 1, W - 2, H - 2, SHOP_WOOD);
  px(1, 1, W - 2, 1, SHOP_WOOD_L); px(1, 1, 1, H - 2, SHOP_WOOD_L);
  px(1, H - 2, W - 2, 1, SHOP_WOOD_D); px(W - 2, 1, 1, H - 2, SHOP_WOOD_D);
  px(1, H - SHOP_FOOT + 1, W - 2, 1, SHOP_WOOD_L); // the counter's lit lip
  for (let x = 3; x < W - 3; x += 2) {              // grain along the lip and the head
    if (hash2(x, 11) > 0.6) px(x, H - SHOP_FOOT + 2, hash2(x, 13) > 0.5 ? 2 : 1, 1, SHOP_WOOD_D);
    if (hash2(x, 19) > 0.72) px(x, 1, 1, 1, SHOP_WOOD_D);
  }
  g.clearRect(3, 3, W - 6, H - 3 - SHOP_FOOT); // the live slab shows through here

  // The awning: a batten, snow along its crown, striped cloth and a scalloped
  // hem with an icicle off the deepest point of every other scallop. The team
  // stripe is the coat's LIT tone rather than the coat: the coat itself is
  // barely a shade off the slab behind it, and a valance that does not read as
  // cloth is just a row of cream teardrops.
  const AX = 3, AW = W - 6, CY = 6, CLOTH = 6, SCAL = 3, PITCH = 14, MID = (PITCH - 1) / 2;
  px(AX, 2, AW, 2, SHOP_WOOD_D);   // the batten the cloth is nailed to
  px(AX, 2, AW, 1, SHOP_WOOD);
  px(AX, 4, AW, 2, SHOP_SNOW);     // the crown, and its shaded underside
  px(AX, 5, AW, 1, SHOP_SNOW_D);
  for (let x = AX; x < AX + AW; x++) if (hash2(x, 17) > 0.62) px(x, 3, 1, 1, SHOP_SNOW); // lumps over the batten
  for (let x = AX; x < AX + AW; x++) {
    const k = (x - AX) % PITCH, s = ((x - AX) / PITCH) | 0, team = s % 2 === 1;
    const base = team ? T.coatL : SHOP_CLOTH, lit = team ? '#8fb3d6' : SHOP_CLOTH_L, dark = team ? T.coat : SHOP_CLOTH_D;
    const d = Math.max(0, SCAL - Math.round(Math.abs(k - MID) / MID * SCAL)); // deepest mid-stripe
    px(x, CY, 1, CLOTH + d, base);
    if (k === 1 || k === 2) px(x, CY, 1, CLOTH + d, lit);   // the lit fold down each seam...
    if (k === PITCH - 1) px(x, CY, 1, CLOTH + d, dark);     // ...and the shaded one
    px(x, CY + CLOTH + d - 1, 1, 1, dark);                  // the hem's own shade
    px(x, CY + CLOTH + d, 1, 1, 'rgba(4,6,18,0.5)');        // ...and the shadow it throws, which seats it
    if (d === SCAL && k === Math.round(MID) && s % 2 === 0) {
      const len = 2 + ((hash2(x, 23) * 3) | 0);             // an icicle off the point, a shoulder then a tip
      px(x - 1, CY + CLOTH + d, 3, 1, '#bcd0e4');
      px(x, CY + CLOTH + d, 1, len, '#bcd0e4');
      px(x, CY + CLOTH + d, 1, Math.max(1, len - 1), SHOP_SNOW);
    }
  }

  // iron corner brackets nailed over the timber - the one hard edge on a slab
  // otherwise made of cloth, snow and wood
  for (const [bx, sx] of [[1, 1], [W - 2, -1]]) {
    for (const [by, sy] of [[1, 1], [H - 2, -1]]) {
      for (let k = 0; k < 6; k++) { px(bx + sx * k, by, 1, 1, SHOP_IRON); px(bx, by + sy * k, 1, 1, SHOP_IRON); }
      for (let k = 0; k < 5; k++) { px(bx + sx * k, by + sy, 1, 1, SHOP_IRON); px(bx + sx, by + sy * k, 1, 1, SHOP_IRON); }
      px(bx + sx, by + sy, 1, 1, SHOP_IRON_L);
      px(bx + sx * 4, by + sy, 1, 1, SHOP_WOOD_D); px(bx + sx, by + sy * 4, 1, 1, SHOP_WOOD_D); // nail heads
    }
  }
  cache[ti] = cv;
  return cv;
}

// A lantern hanging off the awning's hem, one either side of the sign. Its
// flame breathes on its own beat and the glow around it is the only warm light
// on the panel, which is the whole point of it.
function drawShopLantern(x, y, now, beat) {
  const f = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(now * 3.1 + beat));
  ctx.globalAlpha = 0.13 * f;
  ctx.fillStyle = SHOP_LAMP;
  ctx.fillRect(x - 4, y + 1, 13, 9); ctx.fillRect(x - 2, y - 1, 9, 13);
  ctx.globalAlpha = 1;
  ctx.fillStyle = SHOP_IRON;
  ctx.fillRect(x + 2, y - 4, 1, 3);                            // the hook off the hem
  ctx.fillRect(x, y - 1, 5, 1); ctx.fillRect(x, y + 8, 5, 1);  // cap and base
  ctx.fillStyle = SHOP_WOOD_D;
  ctx.fillRect(x, y, 5, 8);
  ctx.fillStyle = SHOP_LAMP_D;
  ctx.fillRect(x + 1, y + 1, 3, 6);                            // the glass
  ctx.fillStyle = SHOP_LAMP;
  ctx.fillRect(x + 2, y + 3, 1, f > 0.9 ? 4 : 3);              // the flame
  ctx.fillStyle = SHOP_IRON_L;
  ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x + 4, y - 1, 1, 1);
}

function drawShopPanel(now) {
  const L = shopLayout(), P = L.panel;
  const h = mouse.inside ? shopHit(mouse.x, mouse.y) : null;
  const b = state.shop;
  const ti = skin(b ? b.team : player.team);
  ctx.fillStyle = 'rgba(4,6,18,0.38)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.fillStyle = 'rgba(4,6,18,0.55)'; ctx.fillRect(P.x + 3, P.y + 3, P.w, P.h); // a square slab throws a square shadow
  ctx.fillStyle = SHOP_BG; ctx.fillRect(P.x, P.y, P.w, P.h);
  ctx.fillStyle = SHOP_IN; ctx.fillRect(P.x + 3, P.y + 3, P.w - 6, P.h - 3 - SHOP_FOOT);
  ctx.drawImage(shopChromeCv(ti), P.x, P.y); // the frame, the awning and the counter edge

  drawShopSign(L, ti, now);

  // the turnover clock: a bar that empties into the next restock. No number
  // and no word - it is a countdown, and a countdown is a length.
  const fr = Math.max(0, Math.min(1, market.stockT / SHOP_RESTOCK));
  ctx.fillStyle = '#141c3c'; ctx.fillRect(L.bar.x, L.bar.y, L.bar.w, L.bar.h);
  ctx.fillStyle = market.stockT < 15 ? (Math.sin(now * 9) > 0 ? '#f2cc6a' : '#8a6a2a') : '#3d4f85';
  ctx.fillRect(L.bar.x, L.bar.y, Math.round(L.bar.w * fr), L.bar.h);

  for (const s of L.secs) drawShopSection(s, h, now);
  drawShopHeading(L.mkt, 'MARKET', true);
  for (const c of L.cards) drawMarketCard(c, h, now);
  drawSellWell(L.well, h, now);

  // the X: the drawn way out (ESC, E and walking away all close too)
  const hot = h === 'x';
  ctx.fillStyle = hot ? SHOP_LAMP : SHOP_WOOD;
  ctx.fillRect(L.xr.x, L.xr.y, L.xr.w, L.xr.h);
  ctx.fillStyle = '#0f1632';
  ctx.fillRect(L.xr.x + 1, L.xr.y + 1, L.xr.w - 2, L.xr.h - 2);
  ctx.fillStyle = hot ? '#f4f7ff' : SHOP_LABEL;
  for (let k = 0; k < 5; k++) {
    ctx.fillRect(L.xr.x + 3 + k, L.xr.y + 3 + k, 1, 1);
    ctx.fillRect(L.xr.x + L.xr.w - 4 - k, L.xr.y + 3 + k, 1, 1);
  }
}

// The sign row, hung off the awning's hem: the merchant's own face in a framed
// portrait at one end, the shop's name on a board between two lanterns, and the
// purse - the one number the whole panel is spent out of - on a plate at the
// other. The board carries the SHOP's name and not the merchant's title: whose
// counter this is is already said, in the awning's colours.
function drawShopSign(L, ti, now) {
  const P = L.panel, R = L.head;
  // the portrait: the merchant's own head off its walking sprite, in a timber
  // frame - the trader is standing behind the counter, not printed on it
  const spr = SPRITES.merchant[ti].down[0];
  ctx.fillStyle = SHOP_WOOD; ctx.fillRect(R.x, R.y - 1, 14, 13);
  ctx.fillStyle = SHOP_WOOD_L; ctx.fillRect(R.x, R.y - 1, 14, 1);
  ctx.fillStyle = SHOP_WOOD_D; ctx.fillRect(R.x, R.y + 11, 14, 1);
  ctx.fillStyle = '#080b1c'; ctx.fillRect(R.x + 1, R.y, 12, 11);
  ctx.drawImage(spr, 2, 0, 12, 11, R.x + 1, R.y, 12, 11);

  // the board: a plank hung off two rings, its name in gold
  const tw = pixelTextWidth(SHOP_SIGN);
  const bw = tw + 18, bx = P.x + ((P.w - bw) >> 1), by = R.y - 1, bh = 13;
  ctx.fillStyle = SHOP_IRON;
  ctx.fillRect(bx + 5, by - 4, 1, 4); ctx.fillRect(bx + bw - 6, by - 4, 1, 4);
  ctx.fillStyle = 'rgba(4,6,18,0.5)'; ctx.fillRect(bx + 2, by + 2, bw, bh);
  ctx.fillStyle = SHOP_WOOD_D; ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = SHOP_WOOD; ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);
  ctx.fillStyle = SHOP_WOOD_L; ctx.fillRect(bx + 1, by + 1, bw - 2, 1);
  ctx.fillStyle = SHOP_WOOD_D; ctx.fillRect(bx + 1, by + bh - 2, bw - 2, 1);
  ctx.fillStyle = '#1c1208'; ctx.fillRect(bx + 3, by + 3, bw - 6, bh - 6);
  drawPixelTextShadow(ctx, SHOP_SIGN, bx + 9, by + 4, '#f2cc6a', '#1c1208');
  drawShopLantern(bx - 14, by, now, 0);
  drawShopLantern(bx + bw + 9, by, now, 1.9);

  // the purse, right-aligned into the gap before the X, on its own plate so the
  // number reads clear of the cloth behind it
  const gold = String(player.inv.gold);
  const pw = pixelTextWidth(gold) + 20, px0 = L.xr.x - 5 - pw;
  ctx.fillStyle = SHOP_WOOD_D; ctx.fillRect(px0, by, pw, bh);
  ctx.fillStyle = '#141c3c'; ctx.fillRect(px0 + 1, by + 1, pw - 2, bh - 2);
  ctx.drawImage(SPRITES.itemGold, px0 + 4, by + 3);
  drawPixelText(ctx, gold, px0 + 15, by + 4, RES_COLORS.gold);
}

// A heading and the rule that runs off it to the block's right edge - the four
// section names and the MARKET rule are one object, so they can never drift
// apart. `sprig` hangs a pine tip off the rule's far end.
function drawShopHeading(r, label, sprig) {
  drawPixelTextShadow(ctx, label, r.x, r.y, SHOP_LABEL, SHOP_BG);
  const lw = pixelTextWidth(label) + 4, x0 = r.x + lw, w = r.w - lw - (sprig ? 10 : 0);
  if (w > 0) {
    ctx.fillStyle = SHOP_WOOD; ctx.fillRect(x0, r.y + 2, w, 1);
    ctx.fillStyle = SHOP_WOOD_D; ctx.fillRect(x0, r.y + 3, w, 1);
  }
  if (!sprig) return;
  // a little pine at the rule's end - the frostlands' own tree, the whole
  // decoration this heading gets
  const sx = r.x + r.w - 7, sy = r.y - 2;
  ctx.fillStyle = '#3c5840';
  for (let k = 0; k < 4; k++) ctx.fillRect(sx + 3 - Math.min(3, k), sy + k * 2, 1 + Math.min(3, k) * 2, 2);
  ctx.fillStyle = '#4f9c55';
  for (let k = 1; k < 4; k++) ctx.fillRect(sx + 3 - Math.min(3, k), sy + k * 2, 1, 1);
  ctx.fillStyle = '#4a3421'; ctx.fillRect(sx + 3, sy + 8, 1, 2);
  ctx.fillStyle = SHOP_SNOW; ctx.fillRect(sx + 3, sy, 1, 1); ctx.fillRect(sx + 1, sy + 4, 1, 1);
}

// one section: its name, then its three wells on a recessed board - the board
// is what groups three offers into a shelf, rather than leaving twelve loose
// plates floating on one slab
function drawShopSection(s, h, now) {
  drawShopHeading({ x: s.x, y: s.y, w: SHOP_SEC_W }, s.label, false);
  const b = { x: s.x - 2, y: s.y + SHOP_SEC_HEAD - 2, w: SHOP_SEC_W + 4, h: SHOP_WELL_H + SHOP_BAND + 4 };
  ctx.fillStyle = SHOP_BOARD; ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.fillStyle = '#070a1e'; ctx.fillRect(b.x, b.y, b.w, 1); ctx.fillRect(b.x, b.y, 1, b.h);
  ctx.fillStyle = '#182148'; ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1); ctx.fillRect(b.x + b.w - 1, b.y, 1, b.h);
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
  modPlate(o.type, r, y, iconH);
  if (!dear) tierShine({ x: r.x, y: r.y, w: r.w, h: iconH }, y, o.type, now); // nothing you cannot buy shines
  // The icon at SHOP_ICON px, whichever grid it was drawn on: the two the game
  // keeps are 8x8 and 12x12, so 3x and 2x land both of them on the same 24, a
  // bit is never half the size of the tool in the well beside it, and the scale
  // is still a whole number, which is the only kind that keeps pixels square.
  const im = SPRITES[ITEMS[o.type].icon];
  if (im) {
    const sc = Math.max(1, Math.round(SHOP_ICON / im.width)), iw = im.width * sc, ih = im.height * sc;
    ctx.drawImage(im, r.x + ((r.w - iw) >> 1), y + ((iconH - ih) >> 1), iw, ih);
  }
  // ...under a wash if it is out of reach, so the GOODS grey back with the
  // price rather than the price greying out alone. The tier plate keeps its
  // own hue through it - which tier a thing is stays true whatever it costs.
  if (dear) {
    ctx.fillStyle = SHOP_DEAR_WASH;
    ctx.fillRect(r.x + 1, y + 1, r.w - 2, iconH - 1);
  }
  // The price band, flush along the bottom of the plate. The coin sits at a
  // FIXED offset and the number is right-aligned to another, so a section's
  // three prices read as a column; the centred group this used to be slid
  // about with the digit count, which is most of what made the counter look
  // unaligned.
  ctx.fillStyle = dear ? SHOP_DEAR_BAND : '#141c3c';
  ctx.fillRect(r.x + 1, y + iconH, r.w - 2, SHOP_BAND - 1);
  const txt = String(o.price);
  ctx.globalAlpha = dear ? 0.5 : 1;
  ctx.drawImage(SPRITES.itemGold, r.x + 4, y + iconH);
  ctx.globalAlpha = 1;
  drawPixelText(ctx, txt, r.x + r.w - 4 - pixelTextWidth(txt), y + iconH + 2, dear ? SHOP_DEAR_INK : RES_COLORS.gold);
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
  ctx.fillStyle = live ? (Math.sin(now * 10) > 0 ? '#f2cc6a' : '#c9a227') : d ? SHOP_LAMP : SHOP_WOOD;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = BAG_WELL;
  ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  // the four corner brackets that say "a target", the world's own hover mark
  ctx.fillStyle = d ? '#f2cc6a' : '#4a3421';
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
  drawPixelTextShadow(ctx, lab, cx, mid, d ? '#ffd95c' : SHOP_LABEL, SHOP_BG);
  cx += labW + 6;
  if (im) { ctx.drawImage(im, cx, r.y + ((r.h - im.height) >> 1)); cx += im.width + 4; }
  drawTradeArrow(cx, r.y + (r.h >> 1), 1, d ? '#f2cc6a' : '#8a6142');
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

// One traded good, in a timber card to match the counter it stands on: the
// live price, the three days behind it, and the two plates that move it.
// Nothing here says "buy" or "sell" in words - the coin on the left of an
// arrow is money going out, the coin on the right is money coming in.
function drawMarketCard(c, h, now) {
  const g = GOODS[c.id], r = market.goods[c.id];
  const col = RES_COLORS[c.id];
  const price = marketPrice(c.id);
  const hist = r.hist;
  const prev = hist.length > 1 ? hist[hist.length - 2] : r.price;
  const up = r.price >= prev;
  ctx.fillStyle = 'rgba(4,6,18,0.5)'; ctx.fillRect(c.x + 2, c.y + 2, c.w, c.h);
  ctx.fillStyle = r.pop > 0 ? (Math.sin(now * 8) > 0 ? col : SHOP_WOOD) : SHOP_WOOD;
  ctx.fillRect(c.x, c.y, c.w, c.h);
  ctx.fillStyle = SHOP_WOOD_L; ctx.fillRect(c.x, c.y, c.w, 1);
  ctx.fillStyle = SHOP_WOOD_D; ctx.fillRect(c.x, c.y + c.h - 1, c.w, 1);
  ctx.fillStyle = '#0d1229';
  ctx.fillRect(c.x + 1, c.y + 1, c.w - 2, c.h - 2);

  // name on the left, price on the right in the direction of the last move
  ctx.drawImage(SPRITES[ITEMS[c.id].icon], c.x + 4, c.y + 2);
  drawPixelTextShadow(ctx, g.name, c.x + 15, c.y + 3, '#9fb6d8', SHOP_BG);
  const pt = String(price);
  const pw = pixelTextWidth(pt, 2);
  // no shadow on the 2x price: at that scale the shadow is 2 px deep and the
  // graph's top rim would clip it, which reads as a clipped NUMBER
  drawPixelText(ctx, pt, c.x + c.w - 5 - pw, c.y + 1, up ? '#8fe08a' : '#e0637a', 2);
  drawTrend(c.x + c.w - 13 - pw, c.y + 4, up);

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

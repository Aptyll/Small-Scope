// All pixel art is defined as character grids and baked to canvases at load.
// This keeps every sprite hand-editable, pixel by pixel.
(function () {
  function bake(rows, pal) {
    const h = rows.length, w = rows[0].length;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < w; x++) {
        const col = pal[row[x]];
        if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
      }
    }
    return c;
  }

  // Per-row [firstX, lastX] of the painted pixels, taken straight off the grid.
  // The game's snow cover needs to know how wide a prone body is on every row;
  // reading that back off the baked canvas would mean a getImageData per pose,
  // and the char grid already knows. Attached to the canvas as `.spans`.
  function spansOf(rows, pal) {
    return rows.map((r) => {
      let lo = 99, hi = -1;
      for (let x = 0; x < r.length; x++) if (pal[r[x]]) { if (x < lo) lo = x; hi = x; }
      return hi < 0 ? null : [lo, hi];
    });
  }
  function bakeSpan(rows, pal) {
    const c = bake(rows, pal);
    c.spans = spansOf(rows, pal);
    return c;
  }

  function flipH(src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.translate(src.width, 0);
    g.scale(-1, 1);
    g.drawImage(src, 0, 0);
    // a mirrored pose's spans mirror with it
    if (src.spans) c.spans = src.spans.map((s) => (s ? [src.width - 1 - s[1], src.width - 1 - s[0]] : null));
    return c;
  }

  // ---------------------------------------------------------------- player
  const PPAL = {
    '.': null,
    'o': '#2e2440', // outline
    't': '#3e8c81', // hat teal
    'T': '#58ab98', // hat light
    'm': '#f6ecd4', // cream (pom, scarf, mittens)
    'M': '#d9c5a0', // cream shade
    'k': '#f2c69b', // skin
    'K': '#d69f72', // skin shade
    'e': '#2e2440', // eye
    'x': '#e8967f', // blush
    'r': '#c9524e', // coat red
    'R': '#df7358', // coat light
    'd': '#96393f', // coat dark
    'p': '#463c5c', // pants
    'b': '#6f4d38', // boots
    'B': '#4a3324', // boots dark
  };

  const downBody = [
    '................',
    '.......mm.......',
    '.......mM.......',
    '.....otttto.....',
    '....otTTTTto....',
    '....otttttto....',
    '....okkkkkko....',
    '....okekkeko....',
    '....oxkKKkxo....',
    '....ommmmmmo....',
    '...orrrRRrrro...',
    '...orrrRRrrro...',
    '...omorrrromo...',
    '....oddddddo....',
  ];
  const playerDownIdle = downBody.concat([
    '.....pp..pp.....',
    '.....bb..bb.....',
  ]);
  const playerDownA = downBody.concat([
    '.....pp..bb.....',
    '.....bb.........',
  ]);
  const playerDownB = downBody.concat([
    '.....bb..pp.....',
    '.........bb.....',
  ]);

  const upBody = [
    '................',
    '.......mm.......',
    '.......mM.......',
    '.....otttto.....',
    '....otTTTTto....',
    '....otttttto....',
    '....otttttto....',
    '....otttttto....',
    '....otttttto....',
    '....ommmmmmo....',
    '...orrrrrrrro...',
    '...orrrrrrrro...',
    '...omorrrromo...',
    '....oddddddo....',
  ];
  const playerUpIdle = upBody.concat([
    '.....pp..pp.....',
    '.....bb..bb.....',
  ]);
  const playerUpA = upBody.concat([
    '.....pp..bb.....',
    '.....bb.........',
  ]);
  const playerUpB = upBody.concat([
    '.....bb..pp.....',
    '.........bb.....',
  ]);

  // side = facing right
  const sideBody = [
    '................',
    '.....mm.........',
    '.....mM.........',
    '.....otttto.....',
    '....otTTTtto....',
    '....otttttto....',
    '....ottkkkko....',
    '....ottkkeko....',
    '....otkKKKko....',
    '....ommmmmmo....',
    '....orrrRRro....',
    '....orrrRRro....',
    '....orrommro....',
    '....odddddo.....',
  ];
  const playerSideIdle = sideBody.concat([
    '......pp.pp.....',
    '......bb.bb.....',
  ]);
  const playerSideA = sideBody.concat([
    '.....pp...pp....',
    '.....bb...bb....',
  ]);
  const playerSideB = sideBody.concat([
    '.......pp.......',
    '.......bb.......',
  ]);

  // ---------------------------------------------------------------- skater (champion 2)
  // Same 16x16 body plan as the player so every pose/frame lines up, but a
  // hood instead of the pom hat, goggles, a long trailing scarf and skate
  // blades under the boots. Extra palette chars: S blade, g/G goggles.
  const SKPAL_EXTRA = { 'S': '#c8d8e8', 'g': '#203a52', 'G': '#8fd8ff' };
  const skDownBody = [
    '................',
    '.....oooooo.....',
    '....otttttto....',
    '....otTTTTto....',
    '....otkkkkto....',
    '....oGgGgGto....',
    '....otkKKkto....',
    '....ommmmmmo....',
    '...ommrrRRrro...',
    '...orrrRRrrro...',
    '...orrrRRrmmo...',
    '...omorrrromo...',
    '....oddddddo....',
    '.....pp..pp.....',
  ];
  const skDownIdle = skDownBody.concat(['.....bb..bb.....', '.....SS..SS.....']);
  const skDownA = skDownBody.concat(['.....bb..SS.....', '.....SS.........']);
  const skDownB = skDownBody.concat(['.....SS..bb.....', '.........SS.....']);
  const skUpBody = [
    '................',
    '.....oooooo.....',
    '....otttttto....',
    '....otTTTTto....',
    '....otttttto....',
    '....otttttto....',
    '....otttttto....',
    '....ommmmmmo....',
    '...orrrmmrrro...',
    '...orrrmmrrro...',
    '...orrrmmrrro...',
    '...omorrmromo...',
    '....oddddddo....',
    '.....pp..pp.....',
  ];
  const skUpIdle = skUpBody.concat(['.....bb..bb.....', '.....SS..SS.....']);
  const skUpA = skUpBody.concat(['.....bb..SS.....', '.....SS.........']);
  const skUpB = skUpBody.concat(['.....SS..bb.....', '.........SS.....']);
  const skSideBody = [
    '................',
    '.....oooooo.....',
    '....otttttto....',
    '....otTTTtto....',
    '....ottttkko....',
    '....otttGgGo....',
    '....otttkKko....',
    '..mmommmmmmo....',
    '.mmmorrrRRro....',
    '....orrrRRro....',
    '....orrommro....',
    '....odddddo.....',
    '....odddddo.....',
    '......pp.pp.....',
  ];
  const skSideIdle = skSideBody.concat(['......bb.bb.....', '......SS.SS.....']);
  const skSideA = skSideBody.concat(['.....bb...bb....', '.....SS...SS....']);
  const skSideB = skSideBody.concat(['.......bb.......', '.......SS.......']);

  // ---------------------------------------------------------------- prone
  // Belly-down in the snow. The same 16x16 cell as every other pose, but the
  // body lies ACROSS it rather than standing up through it, so a player's
  // ground contact stays where the standing feet were and the y-sort never
  // jumps when they drop. Foreshortened, not shrunk - head-on the figure is
  // twelve rows to the standing sixteen - and the whole read comes from
  // segmenting it: boots at the trailing end, a split pair of calves, thighs
  // that widen into the coat hem, elbows out to the full width of the cell, and a
  // small head at the front. Side-on the same body is eight rows deep and fifteen
  // long, with the head propped up and looking where it is going.
  //
  // Three frames a direction - settled, and two of the crawl, which alternates
  // the reaching arm AND the drawn-up knee, because a belly crawl hauls with
  // one arm and pushes off the opposite leg. The 1px inch forward between
  // frames is applied by the renderer, not baked into a second set of grids.
  const pnSideIdle = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '........ommoooo.',
    '.....oooooottTo.',
    '..oooodrrrttTkKo',
    '.oBbbprrrRrtkeko',
    '.oBbbprrrRrtkKko',
    '..obbpdrrrrokKo.',
    '...oooodrroommmo',
    '......oooooooo..',
    '................',
  ];
  const pnSideA = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '........ommoooo.',
    '...oppooooottTo.',
    '..oooodrrrttTkKo',
    '.oBbbprrrRrtkeko',
    '.oBbbprrrRrtkKko',
    '..obbpdrrrrokKo.',
    '...oooodrrommmmo',
    '......oooooooo..',
    '................',
  ];
  const pnSideB = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '........ommoooo.',
    '.....oooooottTo.',
    '..oooodrrrttTkKo',
    '.oBbbprrrRrtkeko',
    '.oBbbprrrRrtkKko',
    '..obbpdrrrrokKo.',
    '...oooodrrooommo',
    '...oppoooooooo..',
    '................',
  ];
  const pnDownIdle = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '....obboobbo....',
    '....oppooppo....',
    '...oppppppppo...',
    '...oddddddddo...',
    'ommorrrrrrrrommo',
    'ommorrrrrrrrommo',
    '...orrrrrrrro...',
    '....otttttto....',
    '....otTTTTto....',
    '....okekkeko....',
  ];
  const pnDownA = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '....obboobbo....',
    '....oppooppo....',
    '...oppppppppo...',
    '...oddddddddommo',
    '...orrrrrrrrommo',
    'ommorrrrrrrro...',
    'ommorrrrrrrro...',
    '....otttttto....',
    '....otTTTTto....',
    '....okekkeko....',
  ];
  const pnDownB = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '....obboobbo....',
    '....oppooppo....',
    '...oppppppppo...',
    'ommoddddddddo...',
    'ommorrrrrrrro...',
    '...orrrrrrrrommo',
    '...orrrrrrrrommo',
    '....otttttto....',
    '....otTTTTto....',
    '....okekkeko....',
  ];
  const pnUpIdle = [
    '................',
    '................',
    '................',
    '................',
    '......ommo......',
    '....oooooooo....',
    '....otttttto....',
    '....otTTTTto....',
    '...ommmmmmmmo...',
    'ommorrrrrrrrommo',
    'ommorrrrrrrrommo',
    '...orrrrrrrro...',
    '...oddddddddo...',
    '...oppppppppo...',
    '....oppooppo....',
    '....obboobbo....',
  ];
  const pnUpA = [
    '................',
    '................',
    '................',
    '................',
    '......ommo......',
    '....oooooooo....',
    '....otttttto....',
    '....otTTTTto....',
    'ommommmmmmmmo...',
    'ommorrrrrrrro...',
    '...orrrrrrrrommo',
    '...orrrrrrrrommo',
    '...oddddddddo...',
    '...oppppppppo...',
    '....oppooppo....',
    '....obboobbo....',
  ];
  const pnUpB = [
    '................',
    '................',
    '................',
    '................',
    '......ommo......',
    '....oooooooo....',
    '....otttttto....',
    '....otTTTTto....',
    '...ommmmmmmmommo',
    '...orrrrrrrrommo',
    'ommorrrrrrrro...',
    'ommorrrrrrrro...',
    '...oddddddddo...',
    '...oppppppppo...',
    '....oppooppo....',
    '....obboobbo....',
  ];

  // The skater lies down the same way: hood instead of the pom hat, the goggle
  // band where the eye is, the scarf flicked out behind her, and the blade
  // showing as a bright plate under each boot.
  const pnSkSideIdle = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....ommmo.oooo.',
    '.....oooooottTo.',
    '..oooodrrrttTkKo',
    '.oBbbprrrRrtGgko',
    '.oBbbprrrRrtkKko',
    '..obbpdrrrrokKo.',
    '...SSSodrroommmo',
    '......oooooooo..',
    '................',
  ];
  const pnSkSideA = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....ommmo.oooo.',
    '...oppooooottTo.',
    '..oooodrrrttTkKo',
    '.oBbbprrrRrtGgko',
    '.oBbbprrrRrtkKko',
    '..obbpdrrrrokKo.',
    '...SSSodrrommmmo',
    '......oooooooo..',
    '................',
  ];
  const pnSkSideB = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....ommmo.oooo.',
    '.....oooooottTo.',
    '..oooodrrrttTkKo',
    '.oBbbprrrRrtGgko',
    '.oBbbprrrRrtkKko',
    '..obbpdrrrrokKo.',
    '...SSSodrrooommo',
    '...oppoooooooo..',
    '................',
  ];
  const pnSkDownIdle = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '....oSSooSSo....',
    '....obboobbo....',
    '...oppppppppo...',
    '...oddddddddo...',
    'ommorrrrrrrrommo',
    'ommorrrrrrrrommo',
    '...orrrrrrrro...',
    '....otttttto....',
    '....otTTTTto....',
    '....oGgGgGgo....',
  ];
  const pnSkDownA = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '....oSSooSSo....',
    '....obboobbo....',
    '...oppppppppo...',
    '...oddddddddommo',
    '...orrrrrrrrommo',
    'ommorrrrrrrro...',
    'ommorrrrrrrro...',
    '....otttttto....',
    '....otTTTTto....',
    '....oGgGgGgo....',
  ];
  const pnSkDownB = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '....oSSooSSo....',
    '....obboobbo....',
    '...oppppppppo...',
    'ommoddddddddo...',
    'ommorrrrrrrro...',
    '...orrrrrrrrommo',
    '...orrrrrrrrommo',
    '....otttttto....',
    '....otTTTTto....',
    '....oGgGgGgo....',
  ];
  const pnSkUpIdle = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '....otttttto....',
    '..mmotTTTTto....',
    '...ommmmmmmmo...',
    'ommorrrrrrrrommo',
    'ommorrrrrrrrommo',
    '...orrrrrrrro...',
    '...oddddddddo...',
    '...oppppppppo...',
    '....obboobbo....',
    '....oSSooSSo....',
  ];
  const pnSkUpA = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '....otttttto....',
    '..mmotTTTTto....',
    'ommommmmmmmmo...',
    'ommorrrrrrrro...',
    '...orrrrrrrrommo',
    '...orrrrrrrrommo',
    '...oddddddddo...',
    '...oppppppppo...',
    '....obboobbo....',
    '....oSSooSSo....',
  ];
  const pnSkUpB = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....oooooooo....',
    '....otttttto....',
    '..mmotTTTTto....',
    '...ommmmmmmmommo',
    '...orrrrrrrrommo',
    'ommorrrrrrrro...',
    'ommorrrrrrrro...',
    '...oddddddddo...',
    '...oppppppppo...',
    '....obboobbo....',
    '....oSSooSSo....',
  ];

  // ---------------------------------------------------------------- raider
  // Player-like night raider: same body grids, hostile palette.
  const RDPAL = {
    '.': null,
    'o': '#1c1826', // outline
    't': '#3c3450', // hood dark
    'T': '#544a70', // hood light
    'm': '#8f8ba0', // wraps gray
    'M': '#6e6a80', // wraps shade
    'k': '#b8c2d2', // pale skin
    'K': '#8c99b0', // skin shade
    'e': '#ff5555', // eyes red
    'x': '#8c99b0', // no blush
    'r': '#3f3a52', // cloak
    'R': '#555070', // cloak light
    'd': '#2c2840', // cloak dark
    'p': '#242032', // pants
    'b': '#3a3040', // boots
    'B': '#241c28', // boots dark
  };

  // ---------------------------------------------------------------- trees
  const TPAL = {
    '.': null,
    'o': '#22383a', // outline
    'g': '#2f5c4b', // pine dark
    'G': '#3f7a5c', // pine mid
    'L': '#549468', // pine light
    'w': '#eef4fb', // snow
    'W': '#ffffff', // snow bright
    's': '#c9dcee', // snow shade
    'u': '#6f4d38', // trunk
    'U': '#4a3324', // trunk dark
    'c': '#d9ad72', // stump cut face
    'C': '#b9884f', // stump ring
    'v': '#503626', // bark dark
  };

  // The living pine: one tree in 16 sway frames, 27x37 on its own palette
  // (TPAL above still dresses the stump it leaves). Wider and taller than the
  // 16x24 pine it replaced, so it draws at (px - 5, py - 21) - base on the
  // tile's bottom edge, canopy overhanging the tile above. Which frame a tree
  // wears is not its own business: treeFrame() in js/draw-world.js reads it off
  // the wind wave crossing the field, so the forest rustles as one.
  const TSPAL = {
    '.': null,
    'o': '#040205', // outline
    'k': '#052122', // deepest shade under a bough
    'd': '#0e3c36', // pine darkest
    'g': '#184b3e', // pine dark
    'h': '#265c47', // pine mid-dark
    'G': '#2e6c44', // pine mid
    'L': '#3a7c4d', // pine light
    'l': '#67a584', // needle highlight
    'm': '#76a9ab', // frosted needle
    's': '#b4dfe6', // snow shade
    'S': '#c7f4e8', // snow mid
    'w': '#d8f8f6', // snow
    'U': '#462422', // trunk dark
    'u': '#6f4a2d', // trunk
  };
  // 16 sway frames of one snowy pine, 27x37, cropped from
  // docs/media/new_media. Source file order is not the animation order:
  // the files are variants, so they are laid out here as a CYCLE (1 2 16 3 15 6 5 13 14 9 10 11 4 12 7 8)
  // sorted so consecutive frames differ least - which also sorted the
  // baked-in 1-2px vertical bob into one smooth rise and fall.
  const treeSway = [
    [ // 0 (001.png)
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '.........okgssggso.........',
      '........ohhggggGggo........',
      '.......owGGGGdGGGGho.......',
      '......owwwGwGGGwwGsso......',
      '......ookhwGGGsGwwkko......',
      '.......ohdwdGwskGwho.......',
      '.......oGdkgGwkdkkLo.......',
      '......owSghwGdgGGGGwo......',
      '.....owwGGwwdgGGGGSwwo.....',
      '....owwGwGGGGGggwGGLwwo....',
      '...oGLLdhwGGdGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsko....',
      '.....odwwhdwwwskGwsddo.....',
      '....ogddwdhdGwskddssdGo....',
      '....ogddkdGddwLdddkdgdo....',
      '...owGGGdLwGdkkgGdGGGGwo...',
      '..owwwwGGGGGhdgdGGGGGwwoo..',
      '..owwsGGwwGGwGgGGwGdGGswo..',
      '.owLGGhwwwwwwlGwwwGdGwGLwo.',
      'oGLgkGwshwsswwGGGssdwGkLLwo',
      '.oooGwlgdwsGssgGGGsdGSkoooo',
      '...oGGGokGGdGsoddLLodLwo...',
      '...oooo.oLLoGoUooGo.oooo...',
      '.........ooUoUUUoo.........',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 1 (002.png)
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '.........okgssggso.........',
      '........ohGggggGggo........',
      '.......owGGGGdGGGGho.......',
      '......owwwGSGGGwwLsso......',
      '......ookGwGGGsLwwkko......',
      '.......ohdwdGwskGwho.......',
      '.......oGddgGwkgkkLo.......',
      '......owSghwGdgGGGGwo......',
      '.....owwGGwwdgLGGGSwwo.....',
      '....owwGwGGGGGgdwGGLwwo....',
      '...oGLLdhwGGgGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsko....',
      '.....odwwGdwwwskLwsddo.....',
      '....ogddwdhdGwskgdssdGo....',
      '....ogddkgGddwLdddkdgdo....',
      '...owLGGgLwGdkkgGdGGGGwo...',
      '..owwwwGGGGGhdgdGGGGGwwoo..',
      '..owwsGGwwGGwGgLGwGdGGswo..',
      '.owLGGGwwwwwwlGSwwGgGwGLwo.',
      'oGLgkGwshwsswwGGGssdwGkLLwo',
      '.oooGwlgdwsGssgGGLsdGSkoooo',
      '...oGGGokGLdGsoddLLodLwo...',
      '...oooo.oLLoGoUooGo.oooo...',
      '.........ooUoUUUoo.........',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 2 (016.png)
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '.........okgssggso.........',
      '........ohGggggGggo........',
      '.......owGGGGdGGGGho.......',
      '......owwwGSGGGwwLsso......',
      '......ookGwGGGsLwwkdo......',
      '.......ohdwdGwskGwho.......',
      '.......oGddgGwkgkkLo.......',
      '......owSghwGdgGGGGwo......',
      '.....owwGGwwggLLGGwwwo.....',
      '....owwGsGGGGGggwGGLwwo....',
      '...oGLLghwGGgGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsko....',
      '.....odwwGdwwwskLwsddo.....',
      '....ogddwdhdLwskgdssdGo....',
      '....ogddkgGddwLdddkdggo....',
      '...owLGGgLwGdkdgGdGGGGwo...',
      '..owwwwGGLLGhdggGGGGGwwoo..',
      '..owwsGLwwGGwGgLGwGdGGswo..',
      '.owLGGGwwwwwwlGwwwGgGwGLwo.',
      'oGLgkGwshwsswwGGGssdwGkLLwo',
      '.oooLwlgdwsGssgGGLsdGSkoooo',
      '...oLLGokGLdGsoddLLodLwo...',
      '...oooo.oLLoGoUooGo.oooo...',
      '.........ooUoUUUoo.........',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 3 (003.png)
      '...........................',
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '.........okgssggso.........',
      '........oGGggggLggo........',
      '.......owGGGGgGGGGho.......',
      '......owwwGSGGGwwLsso......',
      '......ookhwGGGsLwwkdo......',
      '.......ohdwdGwskGwho.......',
      '.......ohddgGwkgkkLo.......',
      '......owSggwGdgGGGGwo......',
      '.....owwGGwwggLLGGwwwo.....',
      '....owwGsGGGGGggwGGLwwo....',
      '...oLLLghwGGgGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsdo....',
      '.....odwwGkwwwskLwsddo.....',
      '....ogddsdhdLwskdkssdGo....',
      '....oggdkghddwLdddkdggo....',
      '...owGGGgLwGdkkgGdhGGGwo...',
      '..owwwwGLSLGhdggGGGGGwwwo..',
      '.owwwsLLwwSGwGgLGwGdGGswwo.',
      'oLwLGGGwwwwwwlGwwwGgGwGLwwo',
      'ooGgkGwsgwsswwGGGssdwGkLGoo',
      '..ooLwmgdSsGssgGGLsdGSkooo.',
      '...oLLGokGLdGsoddLLokLwo...',
      '...oooo.oLLoGoUooGo.oooo...',
      '.........ooUouuUoo.........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 4 (015.png)
      '...........................',
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '.........okgssggso.........',
      '........ohGggggGggo........',
      '.......owLGGGgLGGGho.......',
      '......owwwGSGGGwwLsso......',
      '......ookhwhGGsLwwkko......',
      '.......ohdwdGwskGwho.......',
      '.......oGddgGwkgkkLg.......',
      '......owSghwGdgGGGGwd......',
      '.....owwGGwwggLLGGwwwo.....',
      '....owwGsGGGGGggwGGLwwo....',
      '...oLLLghwGGgGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsko....',
      '.....odwwhdwwwskLwsddo.....',
      '....ohddsdhdGwsddkssdGo....',
      '....ohddkgGddwLdddkdggo....',
      '...owLGGgLwGdkkgGdhGGGwo...',
      '..owwwwGLwGGsdggGGGGGwwwo..',
      '..owwsGLwwwwwlGLGwGdGLsww..',
      '.owLGGGwwwsswlGwwwGgGSGLwo.',
      'oLLgkLwsdwsGswGGGssgSGkLLwo',
      '.oooLwlkkGLdGskGGLsdGSdoooo',
      '...oGho.oLLoGoUogLLoohwo...',
      '....o....ooUoUUUooo...o....',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 5 (006.png)
      '...........................',
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '.........okgssggso.........',
      '........ohGggggGggo........',
      '.......owLGGGgGLGGGo.......',
      '......owwwGSGGGwwLsso......',
      '......ookhwhGGsLwwkko......',
      '.......ohdwdGwskGwho.......',
      '......ohhddhGwkgkkLho......',
      '.....owwSghwGdgGGGGwwo.....',
      '.....owwGGSwggLLGGSwwo.....',
      '....owwGSGGGGGggwGGLwwo....',
      '...oLLLdhwGGgGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsko....',
      '.....odwwhdwwwskLwsddho....',
      '....ogddsdhkGwsddkssdGo....',
      '....ogddkgGddwLdddkdgggo...',
      '...owGGGdLwGdkkgGdhGGLwo...',
      '..owwwwLwwGGwhgLGwGGGwwwo..',
      '..owwsGwwwwwwlGwwwGgGLswwo.',
      '.owLGGwsmwsswwGGGssdswhLwoo',
      'oLLgGwShdwshssgGGLsdLSkhGSo',
      '.oooLSLokGLdGsoddLLodLwoooo',
      '...ohgo.oLLoGoUooGo.oooo...',
      '....oo...ooUoUUUoo.........',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 6 (005.png)
      '...........................',
      '...........................',
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '.........okgssggso.........',
      '........ohGggggGggo........',
      '.......owGGGGgGGGGho.......',
      '......owwwGSGGGwwGsso......',
      '......ookGwhGGsLwwkko......',
      '.......ohdwdGwskGwho.......',
      '......ohGddgGwkgkkLhoU.....',
      '.....owwSghwGkgGGGGwwo.....',
      '.....wwwGGSSggLGGGSwwwU....',
      '....owwGswGGGGgwwLGLwwo....',
      '...oLLLgwwGwLGGGwwGlGGSo...',
      '....ooowwLGwwwshLwsdsko....',
      '....ogddsdgdGwsdghssdGo....',
      '....ogddkdhddwLddddgggo....',
      '...owGGGdLwGdkkgGddGhhwo...',
      '..owwwwGGLLGhdggGGGGGwwwo..',
      '..owwsGLwwGGwGgGGwGdGGswo..',
      '.owSGGGwwwwwwlGwwwGgGSGLwo.',
      'oLLhkGwsgwsswwGGGssgwGkLLwo',
      '.oooLwsgdSsGssgGGGsdGSkoooo',
      '...oLLGokGLdGsoddLLokLwo...',
      '...oooo.oLLoGoUooGo..oo....',
      '.........ooUouuUoo.........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 7 (013.png)
      '...........................',
      '.............o.............',
      '............owo............',
      '...........oowmo...........',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........mwwwwwo..........',
      '.........owwwwswwoo........',
      '........oswgswswsso........',
      '........okkgssggsoo........',
      '........khGggggGggo........',
      '.......owLGGGdLGGGho.......',
      '......owwwGSGGGwwLsso......',
      '......ookGwhGGsLwwkko......',
      '.......ohdwdGwskGwho.......',
      '......ohGddgGwkgkkLho......',
      '.....owwSghwGdgGGGGwmo.....',
      '....owwwGGwwggLLGGwwwmU....',
      '...oswwGsGGGGGggwGGLwwso...',
      '...oGLLghwGGgGGwwGGwGGwo...',
      '....oodgwwGwLGGGwwGdskoo...',
      '....oddwwhdwwwskLwsddGo....',
      '....ogddsdhdGwsddkssggo....',
      '...omhgdkgLddwLdgdkdgGwo...',
      '..omwSGGgLwGdkkgGgGGGwwwo..',
      '..owwwwGwwLGwhgLGwGdGGswoo.',
      'oowwwsGwwwwwwlGSwwGgGSGLwSo',
      'oGLGdGLwswsswwGGGssdwGkLLwo',
      'ooogkLwmdwsGssgGGLsdGSkoooo',
      '...oLSLdkGLdLsodgLLokLwo...',
      '...oGGgooLLoGoUUooo..ooo...',
      '...ooo...ooUUUUUo..........',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 8 (014.png)
      '...........................',
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '.........okgssggso.........',
      '........ohGggggGggo........',
      '.......owGGGGdGGGGho.......',
      '......owwwGSGGGwwLsso......',
      '......ookGwhGGsLwwkko......',
      '.......ohdwdGwskGwho.......',
      '.......oGddgGwkdkkLgo......',
      '......owSghwGdgGGGGwd......',
      '.....owwGGwwggLGGGwwwo.....',
      '....owwGsGGGGGggwGGLwwo....',
      '...oLLLghwGGgGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsko....',
      '....oodwwhdwwwskGwsddoo....',
      '....ohddsdhdGwsddkssdGo....',
      '....ogddkgGddwLdddkdghoo...',
      '...owLGGgLwGdkkgGdhGGwwo...',
      '..owwwwGLwGGwdgLGwGGGwwwo..',
      '..owwsGLwwwwwlGSwwGdGLswwo.',
      '.owLGGGwwwsswwGGGssgLwhLwwo',
      'oLLgkGwsdwsGssgGGLsdGSsGGoo',
      '.oooLwsgdsLdGsoogLLkdLhooo.',
      '...oGGhokGLooUUUooLoooo....',
      '...oooo.oooUUUUUo.o........',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 9 (009.png)
      '...........................',
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '........ookgssggsoo........',
      '........ohhggggGggko.......',
      '.......owGGGGgGGGGGo.......',
      '......owwwGSGGGwwLsso......',
      '......ookGwGGGsLwwkko......',
      '.......ohdwdGwskGwho.......',
      '.......oGddgGwkdkkLg.......',
      '......owSghwGdgGGGGwho.....',
      '.....owwGGwwggGLGGwwwo.....',
      '....owwGSGGGGGggwGGLwwo....',
      '...oLLLghwGGgGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsko....',
      '.....odwwhdwwwskLwsddoo....',
      '....ohddsdhdGwskdkssgGo....',
      '....ohhdkgGddwLdddkdhho....',
      '..oswwGGdLwGdkkgGdGGGwwo...',
      '.owwwwwGwwGGwggGLwGGGwwwwo.',
      'ohwwwsLwwwwwwlGSwwGdGwGSwGo',
      'oGLLkGGwwwsswwGwwwshwGdLLwo',
      '.oogkGwhdwLGssdGGssdGSskoo.',
      '..ooLwlgdLLgGdUoGLlkkGoo...',
      '....khgooooooUUUooooo......',
      '....ooo...oUUUUUo.o........',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 10 (010.png)
      '...........................',
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '...........swwwsU..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '........ookgssggsoo........',
      '.......odhhggggGggdo.......',
      '......oLwGGGGgGGGGGho......',
      '.....oswwwGSGGGwwLssGo.....',
      '......ookGwGGGsLwwkko......',
      '.......ohdwdGwskGwho.......',
      '......ohGddgGwkdkkLgo......',
      '.....omwSghwGdgGGGGwg......',
      '.....owwGGwwggGLGGwwwo.....',
      '....owwGSGGGGGggwGGLwwo....',
      '...oLLLghwGGgGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsko....',
      '.....odwwhdwwwskLwsddo.....',
      '....ogddsdhdGwskdkssdGo....',
      '...oohgdkgGddwLdddkdgho....',
      '...owwGGdLwGdkkgGdGGGwwo...',
      '..owwwwGSSGGsdggGmGGGwwwo..',
      'oowwwsLwwwwSwlhlLwGdGLswwoo',
      'oGlLGGmwwwwwwwGwwwLgLwGLLwo',
      '.oogkLwmgwslwwhGGssdwLkhoo.',
      '...oLwlgdSlhssdGGLsdGSwoo..',
      '...oGGhokGGdGdoodLLooGoo...',
      '....ooo.oooooUUUooo.oo.....',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 11 (011.png)
      '...........................',
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '........ookgssggso.........',
      '........ohGggggGggo........',
      '.......owGGGGdGGGGGo.......',
      '......owwwGSGGGwwLssgo.....',
      '.....ookkGwGGGsLwwkdgo.....',
      '......oohdwdGwskGwhoo......',
      '......ohGddgGwkdkkLgo......',
      '.....oowSghwGdgGGGGwd......',
      '.....mwwGGwwggGLGGSwwo.....',
      '....owwGsGGGGGggwGGLwwo....',
      '...oLLLdhwGGgGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsko....',
      '.....odwwhdwwwskLwsddoo....',
      '....ohddsdhdGwskdkssdGo....',
      '....ohgdkgGddwLdddkdggo....',
      '...owLGGdLwGdkkgGdGGGGwo...',
      '..owwwwGhLLGhdggGGGGGwwwo..',
      '.owwwsGGwwLGwGgGGwGdGLswwo.',
      'oowLGGGwwwwwwlGwwwGgGSGLwoo',
      '.kGhkGwsgwsswwGGGssdwGkGLSo',
      '..ooLSlgdSshssgGGLsdGSkooo.',
      '....oooUoGLdGsodgLLokGwo...',
      '........oLLoGoUUoGo..ooo...',
      '.........ooUouuUoo.........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 12 (004.png)
      '...........................',
      '.............o.............',
      '.............o.............',
      '............owo............',
      '...........omwmo...........',
      '...........owwso...........',
      '...........mwwwm...........',
      '..........oswwwso..........',
      '.........oswwwwwwo.........',
      '........omwwwwswwm.........',
      '........oswgswswsso........',
      '........okkgssggsoo........',
      '.......osGGggggGggkk.......',
      '......omwlGLGgLSlGLho......',
      '.....oswwwGSGGGwwlssmo.....',
      '......ookGwGGGsLwwkko......',
      '.......ohdwdGwskGwho.......',
      '......ohGddgGwkgkkLho......',
      '.....owwSghwGkgLGGGwwo.....',
      '....owwwGGwSggLLsGSwwwo....',
      '...USwwGswGGgGgwwGGLwwso...',
      '...oLLLgwwGwLGGGwwGSGGso...',
      '....ooowwGkwwwskLwsdsko....',
      '....ogddsdgdLwskdkssdGo....',
      '....ogddkdhddwLdddkdggo....',
      '...owGGGdLwGdkkgGdhGGGwo...',
      '..owwwwGGLLGhdggGGGGGwwwo..',
      '.omwwsLLwwLGwGgLGwGdGGswwo.',
      'oGwSGGGwwwwwwlGwwwGgGwGLwso',
      'ogLhkGwsgwsswwGGGssdwGkLLdo',
      '.oooLwsgdwsGssgGGGsdGSkooo.',
      '...oLLGokGLdGsoddLLokLwo...',
      '...oooo.oLLoGoUooGo.oooo...',
      '.........ooUouuUoo.........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 13 (012.png)
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwo...........',
      '..........owwwwso..........',
      '.........owwwwswwo.........',
      '........oswswwswss.........',
      '........ossgswmmsmo........',
      '........ohhgssgGsdo........',
      '.......owGGhhgLGhGGo.......',
      '......owwwGSGGGwwLsso......',
      '.....ommmlSGGGslwwgmo......',
      '......oohgwdGwsgLwho.......',
      '.......ohksdGwddkmLo.......',
      '......oSSddwGmdGGhGwo......',
      '.....owwLhwwgdGLGGSwwo.....',
      '....owwSsGSShGggwGllwwo....',
      '...oswwglwGGgGGSwGGwllwo...',
      '...oGLkgwwGwLGGlwwGssdmo...',
      '....oodmwwkwwwsgSwsdmoo....',
      '....ogdwwhgmlwskgmsddGo....',
      '....ogddsdhdgwlddkssggo....',
      '...owGGGdLwGdsdgGdGGGGwo...',
      '...wwwwGGLlGhdddGGGGGwwwo..',
      '..owwwsGwwGGShgGGwGgGlswwo.',
      '.owSwsGwwwwwwLhlwwGdGwGLSwo',
      'oGLhkGwsgwwwwlGwwwmhwGkGdoo',
      '.oooLSlddwsswwGGGssdGSkoo..',
      '...oLLGoksshssdGhLskkLwo...',
      '...oooo.oGGdGsoooLGo.ooo...',
      '........oGGoGoUUoo.........',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 14 (007.png)
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswhswswss.........',
      '.........okgssggso.........',
      '.........hGghhgGmg.........',
      '........wGGhGgGGGGh........',
      '.......swwGSGGGwwLss.......',
      '......ommlwGGGsLwwdgo......',
      '......oohdwdGwskGwhoo......',
      '.......ohddgGwkdkkLo.......',
      '......owSghwGdgGGGGwo......',
      '.....owwGGwwggLLGGSwwo.....',
      '....owwGSGGGGGggwGGLwwo....',
      '...oLLLdhwGGgGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsko....',
      '.....odwwhdwwwskLwsddo.....',
      '....ohddwdhdGwskddssdGo....',
      '....ogddkdGddwLdddkdgdo....',
      '...owLGGgLwGdkkgGdGGGGwo...',
      '..owwwwGGGGGhdggGGGGGwwoo..',
      '..owwsLLwwGGwGgLGwGdGGswo..',
      '.owLGGGwwwwwwlGwwwGgGwGLwo.',
      'oLLgkGwsgwsswwGGGssdwGkLLwo',
      '.oooLwlgdwshssgGGLsdGSkoooo',
      '...oGGGokGLdGsoddLLodLwo...',
      '...oooo.oLLoGoUooGo.oooo...',
      '.........ooUoUUUoo.........',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
    [ // 15 (008.png)
      '.............o.............',
      '............owo............',
      '............owo............',
      '...........oswso...........',
      '...........owwwo...........',
      '..........oswwwso..........',
      '..........owwwwwo..........',
      '.........owwwwswwo.........',
      '........oswgswswsso........',
      '.........okgssggso.........',
      '........ohhggggGggo........',
      '.......owGGGGdGGGGGo.......',
      '......owwwGSGGGwwLsso......',
      '......ookhwhGGsLwwkko......',
      '.......ohdwdGwskGwho.......',
      '.......ohddgGwkdkkLo.......',
      '......owSghwGdgGGGGwo......',
      '.....owwGGSwggLLGGwwwo.....',
      '....owwGSGGGGGgdwGGLwwo....',
      '...oGLLdhwGGgGGwwGGwGGwo...',
      '....ooogwwGwLGGGwwGdsko....',
      '.....odwwhdwwwskLwsddo.....',
      '....ohddwdhdGwskddssdGo....',
      '....ogddkdGddwLdddkdgdo....',
      '...owGGGgLwGdkkgGdGGGGwo...',
      '..owwwwGGGLGhdggGGGGGwwwo..',
      '..owwsGLwwGGwGgLGwGdGGswo..',
      '.owLGGGwwwwwwlGwwwGgGwGLwo.',
      'oLLgkGwsgwsswwGGGssdwGkLLwo',
      '.oooLwlgdwsGssgGGLsdGSkoooo',
      '...oGLGokGLdGsoddLLodLwo...',
      '...oooo.oLLoGoUooGo.oooo...',
      '.........ooUoUUUoo.........',
      '..........oUUuuUo..........',
      '..........oUuuuUo..........',
      '..........oUuuuUo..........',
      '...........ooooo...........',
    ],
  ];

  const stump = [
    '.....oooooo.....',
    '....occcccco....',
    '....ocCCCCco....',
    '....occCCcco....',
    '....ovuuuuvo....',
    '....ovuUUuvo....',
    '.....ossssÐ¾.....'.replace('Ð¾', 'o'),
    '................',
  ];

  // ---------------------------------------------------------------- rocks
  const RPAL = {
    '.': null,
    'o': '#3a3f52', // outline
    'y': '#8b93a8', // rock mid
    'Y': '#a8b0c4', // rock light
    'v': '#666d84', // rock dark
    'w': '#eef4fb',
    'W': '#ffffff',
    's': '#c9dcee',
  };

  const rock1 = [
    '................',
    '.....owwWo......',
    '....owwwwso.....',
    '...oYwwYyyo.....',
    '..oYYyyyyyvo....',
    '..oYyyyyvvvo....',
    '..oyyyvyvvvo....',
    '...ovvvvvvo.....',
    '....ssssss......',
  ];

  const rock2 = [
    '................',
    '......oWwo......',
    '....owwwwwso....',
    '...oYwwwYyyo....',
    '..oYYwYyyyyvo...',
    '..oYYyyyyvvvo...',
    '..oYyyyvyvvvo...',
    '..oyyvvvvvvvo...',
    '...ovvvvvvvo....',
    '....sssssss.....',
  ];

  // ---------------------------------------------------------------- gold ore
  const GOPAL = {
    '.': null,
    'o': '#3a3f52',
    'y': '#8b93a8',
    'Y': '#a8b0c4',
    'v': '#666d84',
    'w': '#eef4fb',
    'W': '#ffffff',
    's': '#c9dcee',
    'n': '#d8a850', // gold
    'N': '#f2cc6a', // gold bright
  };
  const goldOre = [
    '................',
    '......oWwo......',
    '....owwwwwso....',
    '...oYwwnNYyo....',
    '..oYYwYyNnyvo...',
    '..oYYnNyyvnvo...',
    '..oYynvyNyvvo...',
    '..oyyvnNvyvvo...',
    '...ovvvnvvvo....',
    '....sssssss.....',
  ];

  // ---------------------------------------------------------------- gold mine (32x32, occupies 2x2 tiles)
  const MIPAL = {
    '.': null,
    'o': '#2c2c3c', // outline
    'y': '#8b93a8', // rock mid
    'Y': '#a8b0c4', // rock light
    'v': '#666d84', // rock dark
    'V': '#4e5266', // rock deep
    'k': '#0c0f1e', // shaft black
    'K': '#1d2438', // shaft edge
    'u': '#8a6142', // timber
    'U': '#a3794f', // timber light
    'n': '#d8a850', // gold vein
    'N': '#f2cc6a', // gold bright
    'w': '#eef4fb', // snow
    'W': '#ffffff',
    's': '#c9dcee', // snow shade
  };
  const mine = [
    '..............WWw...............',
    '............owwwwwo.............',
    '...........owwwwwwyo............',
    '..........oYwwwwYyyvo...........',
    '.........oYYwwwYYyyyvo..........',
    '........oYYYwwYYyyyyvvo.........',
    '.......oYYYYYYYyyyyvvvvo........',
    '......oYYYYnYYyyyyyvvvvvo.......',
    '.....oYYYYNnYyyyyyyvvvvvvo......',
    '....oYYYYYnYyyyyyyyyvvvvVVo.....',
    '...oYYYwwYYyyyyNnyyyvvvVVVVo....',
    '..oYYYwwwYyyyyyNyyyyvvvvVVVVo...',
    '..oYYYYYyyyyyyyyyyyyvvvvVVVVo...',
    '.oYYYYYyyyoKKKKKKKKovyvvVVVVVo..',
    '.oYYYnNyyoKkkkkkkkkKovvvVVVVVo..',
    '.oYYYYnyyoUuuuuuuuuUovvVVVVVVo..',
    '.oYYYyyyyoUukkkkkkuUovvvVVVVVo..',
    'oYYYyyyyyoUukkkkkkuUoyvvVVVVVVo.',
    'oYYyyyyyyoUukkkkkkuUovvvVVVVVVo.',
    'oYyyyNnyyoUukkkkkkuUovvVvVVVVVo.',
    'oYyyyynyyoUukkkkkkuUovvvVVVVVVo.',
    'oYyyyyyyyoUukkkkkkuUovvVVVVVVVo.',
    'oyyyyyyyyoUukkkkkkuUonvVVVVVVVo.',
    'oyyyynyyyoUukkkkkkuUoNnVVVVVVVo.',
    'oyyyyyyyyoUukkkkkkuUovvVVVVVVVo.',
    'oyyyyyyyyoUukkkkkkuUovvVVVVVVVo.',
    '.oyyyyyyyoUukkkkkkuUovvVVVVVVo..',
    '.oyyyyyyyoUukkkkkkuUovvVVVVVo...',
    '..ooyyyyyoUukkkkkkuUovvVVVoo....',
    '....ooooooooskkkksoooooooo......',
    '.....ssssssssssssssssssss.......',
    '................................',
  ];

  // ---------------------------------------------------------------- bush
  const BPAL = {
    '.': null,
    'o': '#22383a',
    'g': '#3a6b52',
    'G': '#4c8560',
    'r': '#d6454f', // berry
    'R': '#f2707a', // berry shine
    'w': '#eef4fb',
    's': '#c9dcee',
  };

  const bush = [
    '................',
    '....owwwso......',
    '...ogwGgGgo.....',
    '..ogGrGGgrGo....',
    '..oGgRGgGgGgo...',
    '..ogGgGrGRgGo...',
    '...ogGgGgGgo....',
    '....ssssss......',
  ];
  const bushEmpty = [
    '................',
    '....owwwso......',
    '...ogwGgGgo.....',
    '..ogGgGGggGo....',
    '..oGgGGgGgGgo...',
    '..ogGgGgGGgGo...',
    '...ogGgGgGgo....',
    '....ssssss......',
  ];

  // ---------------------------------------------------------------- imp
  const IPAL = {
    '.': null,
    'o': '#141f3d', // outline
    'i': '#5f8fc0', // ice body mid
    'I': '#8fc2dd', // ice light (top)
    'j': '#41628f', // ice shade
    'e': '#101a33', // eye socket
    'E': '#54f0e6', // eye glow
    'h': '#c6ecf4', // horn
    'H': '#8fc2dd', // horn shade
  };

  const imp1 = [
    '..............',
    '...oo....oo...',
    '..ohho..ohho..',
    '..oHho..oHho..',
    '...oiIIIIio...',
    '..oiIIIIIIio..',
    '.oiIeeIIeeIio.',
    '.oiIeEIIeEIio.',
    '.oiIIIIIIIiÑ˜o.'.replace('Ñ˜', 'j'),
    '.oijIIooIIjjo.',
    '..oijjjjjjjo..',
    '...ooooooÐ¾o...'.replace('Ð¾', 'o'),
    '..ojjo..ojjo..',
    '...oo....oo...',
  ];
  const imp2 = [
    '..............',
    '..............',
    '...oo....oo...',
    '..ohho..ohho..',
    '..oHhooooHho..',
    '..oiIIIIIIio..',
    '.oiIeeIIeeIio.',
    '.oiIeEIIeEIio.',
    '.oiIIIIIIIijo.',
    '.oijIIooIIjjo.',
    '..oijjjjjjjo..',
    '.ojjoooooojjo.',
    '..oo......oo..',
    '..............',
  ];

  // ---------------------------------------------------------------- rabbit
  // Winter hare, side view facing right: white coat, cool blue shading,
  // long ears laid slightly back, pink inner ear.
  const RBPAL = {
    '.': null,
    'o': '#2e2a3a', // outline
    'w': '#eef2fa', // fur
    'W': '#ffffff', // fur highlight
    'd': '#c9d0e2', // fur shade
    'D': '#a4adc6', // fur deep shade
    'p': '#e0a3a8', // inner ear
    'e': '#211d2b', // eye
    'n': '#b97880', // nose
  };

  const rabbitSit = [
    '.....oo.....',
    '....owdo.oo.',
    '....owdoowpo',
    '....owwwwwpo',
    '...owwwwwwwo',
    '..owwwwwWewo',
    '.owwwwwwwWwn',
    '.owwwwwwwWo.',
    'oWwwwwwwdwo.',
    'oDdwwwddwwo.',
    '.odo...odo..',
  ];
  const rabbitHop = [
    '..ooo.........',
    '.owwwoo.......',
    '..oowwwoo.....',
    '...oowwwwwoo..',
    '.oowwwwwwwwwo.',
    'owwwwwwwwWewo.',
    'oWwwwwwwwwwWwn',
    'oDdwwwwddwwwo.',
    '.odo.odo..odo.',
  ];

  // ---------------------------------------------------------------- deer
  // Side view facing right: warm winter coat, cream belly and throat,
  // white rump patch, small antlers, dark slender legs.
  const DEPAL = {
    '.': null,
    'o': '#2f2114', // outline
    'b': '#8a6847', // coat mid
    'B': '#a5825a', // coat light
    'd': '#6d4f34', // coat dark
    'D': '#523a26', // leg dark
    'c': '#e7d9bc', // cream belly / throat
    'a': '#b99f78', // antler
    'A': '#d8c39a', // antler light
    'e': '#1d1710', // eye
    'n': '#241a12', // nose
    'h': '#241a12', // hoof
    'w': '#f4f1e4', // white rump / tail
  };

  const deerHead = [
    '................a...a.....',
    '................aA..aA....',
    '.................a...a....',
    '..............aA.a..aA....',
    '...............oaaoaao....',
    '...............obabao.....',
    '.............odbBBbebo....',
    '...............obBbbbno...',
    '...............odbbcoo....',
    '...............odbbco.....',
    '...............odbco......',
    '....oooooooooooodbco......',
    '...owwdbbbbbbbbbbbBco.....',
    '..owwbbbbbbbbbbbbbBBco....',
    '..owdbbbbbbbbbbbbbBco.....',
    '..odbbbbbbbbbbbbbbco......',
    '...oddbccccccccccdo.......',
  ];
  const deerStand = deerHead.concat([
    '...oddo......oddo.........',
    '....odo......odo..........',
    '....oDo......oDo..........',
    '....oDo......oDo..........',
    '....oho......oho..........',
  ]);
  const deerWalkA = deerHead.concat([
    '...oddo......oddo.........',
    '...odo........odo.........',
    '..oDo..........oDo........',
    '..oDo..........oDo........',
    '..oho..........oho........',
  ]);
  const deerWalkB = deerHead.concat([
    '...oddo......oddo.........',
    '.....odo....odo...........',
    '......oDo....oDo..........',
    '......oDo....oDo..........',
    '......oho....oho..........',
  ]);

  // ---------------------------------------------------------------- wall
  const WPAL = {
    '.': null,
    'o': '#3c2a1e',
    'u': '#8a6142', // wood mid
    'U': '#a3794f', // wood light
    'v': '#6b4a30', // wood dark
    'w': '#eef4fb',
    'W': '#ffffff',
    's': '#c9dcee',
    'k': '#3a4056', // iron fitting dark
    'K': '#5c6884', // iron fitting light
    'e': '#ffd95c', // glow
  };
  // stone + gold tier variants: same grids, remapped material hues
  const WPAL_STONE = {
    '.': null,
    'o': '#2a3040',
    'u': '#8b93a8',
    'U': '#a8b0c4',
    'v': '#666d84',
    'w': '#eef4fb',
    'W': '#ffffff',
    's': '#c9dcee',
    'k': '#3a4056',
    'K': '#5c6884',
    'e': '#8fd8ff',
  };
  const WPAL_GOLD = {
    '.': null,
    'o': '#6b4a1e',
    'u': '#d8a850',
    'U': '#f2cc6a',
    'v': '#b9884f',
    'w': '#fff2c0',
    'W': '#ffffff',
    's': '#c9dcee',
    'k': '#4a3a26',
    'K': '#8a6a3a',
    'e': '#fff2c0',
  };

  const wall = [
    '.Ww.......Ww....',
    'owwo.....owwo...',
    'ouUv..Ww.ouUv...',
    'ouUv.owwoouUv.Ww',
    'ouUvoouUvouUvoww',
    'ouUv.ouUvouUvouv',
    'ouUv.ouUvouUv.uv',
    'oUUUUUUUUUUUUUUÐ¾'.replace('Ð¾', 'o'),
    'ovvvvvvvvvvvvvvo',
    'ouUv.ouUvouUv.uv',
    'ouUv.ouUvouUv.uv',
    'ouUv.ouUvouUv.uv',
    'ouUv.ouUvouUv.uv',
    'ovUv.ovUvovUv.Uv',
    'ovvÐ¾.ovvoovvÐ¾.vÐ¾'.replace(/Ð¾/g, 'o'),
    'ssssssssssssssss',
  ];

  // ------------------------------------------------- tiered structures
  // One 16x16 grid per building, baked with WPAL / WPAL_STONE / WPAL_GOLD.
  // wheel glyph only: the live turret is the 32x32 mount below, too big for a segment
  const turretIcon = [
    '................',
    '.....okkko......',
    '....okKKKko.....',
    '...okKuuKkkkkko.',
    '...okKueKkkkkKo.',
    '...okKuuKkkkkko.',
    '....okKKKko.....',
    '.....okkko......',
    '.....ouUvo......',
    '.....ouUvo......',
    '....oouUvoo.....',
    '....ouuUUvo.....',
    '...oouuUUvoo....',
    '...ouuuUUuvo....',
    '...ovvvvvvvvo...',
    '..ssssssssssss..',
  ];
  // The live turret: a 32x32 armoured mount. Rows 0-15 are deliberately empty -
  // that is where drawTurretHead() rasterises the rotating housing and barrel,
  // pivoting on sprite-local (16, 14) just above the collar. Baking the barrel
  // into the grid would lock the gun to one angle.
  const turret = [
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '..........oooooooooooo..........',
    '.........okkkkkkkkkkkko.........',
    '........okKKKKKKKKKKKKko........',
    '........okKwwwwwwwwwwKko........',
    '........okKKKKKKKKKKKKko........',
    '.........okkkkkkkkkkkko.........',
    '..........oUUUUUUUUUUo..........',
    '..........oUuuuuuuuuUo..........',
    '.........ooUuvvvvvvuUoo.........',
    '.........oUUuveeeevuUUo.........',
    '.........oUuuvvvvvvuuUo.........',
    '........ooUuuuuuuuuuuUoo........',
    '........oUUuukkkkkkuuUUo........',
    '.......ooUvvvvvvvvvvvvUoo.......',
    '.......ovvvvvvvvvvvvvvvvo.......',
    '......ssssssssssssssssssss......',
  ];
  const generator = [
    '................',
    '......kk........',
    '.....okko.......',
    '..oooooooooooo..',
    '.ouUUUUUUUUUUvo.',
    '.ouKkkKuuKkkKvo.',
    '.ouKuuKuuKuuKvo.',
    '.ouKkkKeeKkkKvo.',
    '.ouuuuuuuuuuuvo.',
    '.ouvkkkkkkkkvvo.',
    '.ouvkKKKKKKkvvo.',
    '.ouvkkkkkkkkvvo.',
    '.ovuuuuuuuuuuvo.',
    '.ovvvvvvvvvvvvo.',
    '.oooooooooooooo.',
    '.ssssssssssssss.',
  ];
  const spawner = [
    '................',
    '......oooo......',
    '....ooUUUUoo....',
    '...oUUwwwwUUo...',
    '..oUuuUUUUuuUo..',
    '..ouuUUUUUUuuo..',
    '.ouuUUUUUUUUuuo.',
    '.ouuUUookoUUuuo.',
    '.ouuUUokekoUUuo.',
    '.ouuUuookoUuuuo.',
    '.ovuuookkkoouvo.',
    '.ovuookkkkkouvo.',
    '.ovuokkkkkkovvo.',
    '.ovvokkkkkkovvo.',
    '.oooooooooooooo.',
    '.ssssssssssssss.',
  ];

  // Construction scaffolding, shared by every building. Stage 3 is a mostly
  // transparent lattice drawn over the finished sprite.
  const SCPAL = {
    '.': null,
    'o': '#3c2a1e',
    'u': '#8a6142',
    'U': '#a3794f',
    'v': '#6b4a30',
    's': '#c9dcee',
  };
  const scaffold1 = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '..o..........o..',
    '..u..........u..',
    '..u..........u..',
    '..v..........v..',
    '..u..........u..',
    '..v..........v..',
    '..u...oooo...u..',
    '..v...uUUu...v..',
    '..u..uUuuUu..u..',
    '..vooUuuuuUoov..',
    '.ssssssssssssss.',
  ];
  const scaffold2 = [
    '................',
    '................',
    '................',
    '..oooooooooooo..',
    '..uUUUUUUUUUUu..',
    '..u..........u..',
    '..u..........u..',
    '..uoooooooooou..',
    '..vUUUUUUUUUUv..',
    '..u..........u..',
    '..v..........v..',
    '..uoooooooooou..',
    '..vuuuuuuuuuuv..',
    '..u..uUuuUu..u..',
    '..vooUuuuuUoov..',
    '.ssssssssssssss.',
  ];
  const scaffold3 = [
    '..oooooooooooo..',
    '..uUUUUUUUUUUu..',
    '..uo........ou..',
    '..u.oo....oo.u..',
    '..u..oo..oo..u..',
    '..u...oooo...u..',
    '..u...oooo...u..',
    '..u..oo..oo..u..',
    '..u.oo....oo.u..',
    '..uo........ou..',
    '..u..........u..',
    '..u..........u..',
    '..u..........u..',
    '..u..........u..',
    '..vooooooooooov.',
    '................',
  ];

  // ---------------------------------------------------------------- fish net
  // A fishing net, laid flat over an open water hole (STRUCTS.net, water: true)
  // instead of standing on the snow: it is the one building drawn under
  // everything rather than y-sorted, because a player walks onto it. 14x14 of
  // rope inside a 16x16 tile - a squared frame on four corner floats, a plain
  // orthogonal mesh (a diagonal one turns to mush at this size), and the water
  // showing through every gap. k/K/e are the team fitting/glow keys
  // teamBuildPal swaps, so the frame and the floats carry the owner's colour.
  const NETPAL = {
    '.': null,
    'n': '#c0ab84', // rope
    'N': '#e6d9b6', // rope knot
    'k': '#3a4056', // frame dark  (team fit)
    'K': '#5c6884', // frame light (team fitL)
    'e': '#ffd95c', // corner float (team glow)
  };
  const net = [
    '................',
    '.ekKKKKKKKKKKke.',
    '..k..n..n..n.k..',
    '..K..n..n..n.K..',
    '..k..n..n..n.k..',
    '..knnNnnNnnNnk..',
    '..K..n..n..n.K..',
    '..k..n..n..n.k..',
    '..KnnNnnNnnNnK..',
    '..k..n..n..n.k..',
    '..K..n..n..n.K..',
    '..knnNnnNnnNnk..',
    '..K..n..n..n.K..',
    '..k..n..n..n.k..',
    '.ekKKKKKKKKKKke.',
    '................',
  ];

  // ---------------------------------------------------------------- bot bay
  // The spawner: a 48x38 bot garage on a 3x2 tile footprint (see STRUCTS.spawner
  // w/h), drawn with its snow skirt on the footprint's bottom edge. Steel
  // plate walls; the outline runs along the roof's top edge and a plain two-row snow cap sits on it unoutlined (a few 1px drips),
  // a team-painted lintel band (L/T/t) above a 20px-wide bay with a dark
  // interior and a lit floor lip (doorway cols 14-33, rows 13-35, floor row 36), riveted flanks with a vent grille and a
  // hazard stripe, the mouth open to the ground. One tier, so no WPAL swap -
  // bayTeamPal only paints the band. bayIcon is the 16x16 wheel glyph.
  const BAYPAL = {
    '.': null,
    'o': '#1c2130', // outline
    'S': '#f4f7fc', // snow
    's': '#dce5f0', // snow shade
    'z': '#b9c9db', // snow edge / icicle
    'P': '#b9c1cd', // plate light
    'p': '#98a1b0', // plate
    'q': '#7d8696', // plate shade
    'n': '#5b6473', // seam
    'r': '#d3d9e2', // rivet
    'g': '#3f4755', // grille slot
    'k': '#2c3340', // bay wall
    'K': '#1b202a', // bay deep
    'f': '#3b4150', // bay floor
    'F': '#6c7486', // floor lip
    'y': '#e0b83f', // hazard yellow
    'Y': '#2a2f3a', // hazard dark
    'L': '#df7358', // team light
    'T': '#c9524e', // team
    't': '#96393f', // team dark
    'w': '#c9dcee', // snow skirt
  };
  const bay = [
    '...SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS...',
    '...ssssssssssssssssssssssssssssssssssssssssss...',
    '..oooooooooooooooooooooooooooooooooooooooooooo..',
    '..ozPPPPPPPPPzPPPPPPPPPPPPPPPPzPPPPPPPPPPPPPzo..',
    '..oqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo..',
    '..oPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPo..',
    '..opLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLpo..',
    '..opTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTpo..',
    '..opTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTpo..',
    '..opTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTpo..',
    '..opttttttttttttttttttttttttttttttttttttttttpo..',
    '..onnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnno..',
    '..oPPPPPPPPPPooooooooooooooooooooooPPPPPPPPPPo..',
    '..orpppppppproKKKKKKKKKKKKKKKKKKKKorqqqqqqqqro..',
    '..oppppppppppoKKKKKKKKKKKKKKKKKKKKoqqqqqqqqqqo..',
    '..oppppppppppokkkkkkKkkkkkkKkkkkkkoqqqqqqqqqqo..',
    '..oppppppppppokkkkkkKkkkkkkKkkkkkkoqqqqqqqqqqo..',
    '..oppggggggppokkkkkkKkkkkkkKkkkkkkoqqggggggqqo..',
    '..oppnnnnnnppokkkkkkKkkkkkkKkkkkkkoqqnnnnnnqqo..',
    '..oppggggggppokkkkkkKkkkkkkKkkkkkkoqqggggggqqo..',
    '..oppnnnnnnppokkkkkkKkkkkkkKkkkkkkoqqnnnnnnqqo..',
    '..oppggggggppokkkkkkKkkkkkkKkkkkkkoqqggggggqqo..',
    '..oppppppppppokkkkkkKkkkkkkKkkkkkkoqqqqqqqqqqo..',
    '..oppppppppppokkkkkkKkkkkkkKkkkkkkoqqqqqqqqqqo..',
    '..oppppppppppokkkkkkKkkkkkkKkkkkkkoqqqqqqqqqqo..',
    '..opnnnnnnnnpokkkkkkKkkkkkkKkkkkkkoqnnnnnnnnqo..',
    '..oppppppppppokkkkkkKkkkkkkKkkkkkkoqqqqqqqqqqo..',
    '..oppppppppppokkkkkkKkkkkkkKkkkkkkoqqqqqqqqqqo..',
    '..oppppppppppokkkkkkKkkkkkkKkkkkkkoqqqqqqqqqqo..',
    '..oppppppppppokkkkkkKkkkkkkKkkkkkkoqqqqqqqqqqo..',
    '..oyyYYyyYYyyokkkkkkKkkkkkkKkkkkkkoyyYYyyYYyyo..',
    '..oyYYyyYYyyYokkkkkkKkkkkkkKkkkkkkoyYYyyYYyyYo..',
    '..oYYyyYYyyYYoKKKKKKKKKKKKKKKKKKKKoYYyyYYyyYYo..',
    '..oYyyYYyyYYyoFFFFFFFFFFFFFFFFFFFFoYyyYYyyYYyo..',
    '..oppppppppppoffffffffffffffffffffoqqqqqqqqqqo..',
    '..orpppppppprofffffffffffffffffffforqqqqqqqqro..',
    '..oooooooooooffffffffffffffffffffffooooooooooo..',
    '..wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww..',
  ];
  const bayIcon = [
    '..ssssssssssss..',
    '.oooooooooooooo.',
    '.oqqqqqqqqqqqqo.',
    '.oPPPPPPPPPPPPo.',
    '.oLLLLLLLLLLLLo.',
    '.oTTTTTTTTTTTTo.',
    '.oPPPooooooPPPo.',
    '.opppoKKKKoqqqo.',
    '.opppokkkkoqqqo.',
    '.opppokkkkoqqqo.',
    '.oyYyokkkkoyYyo.',
    '.oYyYokkkkoYyYo.',
    '.opppoffffoqqqo.',
    '.ooooffffffoooo.',
    '.wwwwwwwwwwwwww.',
    '................',
  ];

  // The keep: a 2x2 fortified tower (see STRUCTS.keep w/h), one grid rebaked
  // per tier material like wall/turret/generator (WPAL/WPAL_STONE/WPAL_GOLD)
  // and team-painted through the same k/K/e override teamBuildPal already
  // gives those three - crenellated top, a team banner band, a dark doorway.
  // keepIcon is the 16x16 wheel glyph (the live sprite is too tall for a wedge).
  const keep = [
    'oUUo....oUUo....oUUo....oUUo....',
    'oUUo....oUUo....oUUo....oUUo....',
    'oUUUUUUooUUUUUUooUUUUUUooUUUUUUo',
    'oUUUUUUooUUUUUUooUUUUUUooUUUUUUo',
    'ouuuuuuuuuuuuuuuuuuuuuuuuuuuuuuo',
    'ouuuuuuuuuuuuuuuuuuuuuuuuuuuuuuo',
    'ouuuuuuuuuuuuuuuuuuuuuuuuuuuuuuo',
    'ouuuuuuuuuuuuuuuuuuuuuuuuuuuuuuo',
    'okkkkkkkkkkkkkkkkkkkkkkkkkkkkkko',
    'okkkkkkkkkkkkkkkkkkkkkkkkkkkkkko',
    'oKKeeeeeeeeeeeeeeeeeeeeeeeeeeKKo',
    'oKKeeeeeeeeeeeeeeeeeeeeeeeeeeKKo',
    'okkkkkkkkkkkkkkkkkkkkkkkkkkkkkko',
    'okkkkkkkkkkkkkkkkkkkkkkkkkkkkkko',
    'ouuuuuuuuuuuuuuuuuuuuuuuuuuuuuuo',
    'ouuuuuuuuuuuuuuuuuuuuuuuuuuuuuuo',
    'ouuuuuuuuuuuuuuuuuuuuuuuuuuuuuuo',
    'ouuuuuuuuuuuuuuuuuuuuuuuuuuuuuuo',
    'ouuuuuuuuuuuuuuuuuuuuuuuuuuuuuuo',
    'ouuuuuuuuuuuuuuuuuuuuuuuuuuuuuuo',
    'oUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUo',
    'oUUUUUUUUUUUUUUUUUUUUUUUUUUUUUUo',
    'ovvvvvvvvvvvvvvvvvvvvvvvvvvvvvvo',
    'ovvvvvvvvvvvvvvvvvvvvvvvvvvvvvvo',
    'ouuuuuuuuuuuvvvvvvvvuuuuuuuuuuuo',
    'ouuuuuuuuuvvvvvvvvvvvvuuuuuuuuuo',
    'ouuuuuuuuuvvvvvvvvvvvvuuuuuuuuuo',
    'ssssssssssssssssssssssssssssssss',
  ];
  const keepIcon = [
    '................',
    '....oUUUUUUo....',
    '....oUUUUUUo....',
    '...oUUUUUUUUo...',
    '...ouuuuuuuuo...',
    '...ouuKKKKuuo...',
    '...ouuKKKKuuo...',
    '...ouuuuuuuuo...',
    '...ouuuuuuuuo...',
    '...ouuuuuuuuo...',
    '...ouuuuuuuuo...',
    '...ouuvvvvuuo...',
    '...ouuvvvvuuo...',
    '...ouuvvvvuuo...',
    '...oooooooooo...',
    '...ssssssssss...',
  ];

  // Worker bot: a boxy chassis sitting straight on one full-width tread, stub
  // arms at the sides, no face. One 12x10 grid, two frames (the tread notches
  // shift so it rolls); drawRobot() bobs the whole sprite so body and tread
  // never part. The body (L/T/t) is painted in the team colour.
  const BOTPAL = {
    '.': null,
    'o': '#1c2130', // outline
    'L': '#df7358', // top plate (team light)
    'T': '#c9524e', // body (team)
    't': '#96393f', // body shade (team dark)
    'a': '#b5bcc8', // arm
    'A': '#7d8595', // claw
    'k': '#3b4150', // tread
    'n': '#6c7486', // tread notch
  };
  const botA = [
    '..oooooooo..',
    '.oLLLLLLLLo.',
    'oaoTTTTTToao',
    'oaoTTTTTToao',
    'oAoTTTTTToAo',
    '.oottttttoo.',
    'oooooooooooo',
    'okkkkkkkkkko',
    'oknkknkknkko',
    'oooooooooooo',
  ];
  const botB = botA.slice(0, 8).concat([
    'okknkknkknko',
    'oooooooooooo',
  ]);

  // ---------------------------------------------------------------- spikes
  const SPAL = {
    '.': null,
    'o': '#3c2a1e',
    'u': '#8a6142',
    'U': '#a3794f',
    'v': '#6b4a30',
    's': '#c9dcee',
  };
  const spikes = [
    '................',
    '..o....o....o...',
    '.oUo..oUo..oUo..',
    '.oUv..oUv..oUv..',
    '.oUv..oUv..oUv..',
    '.sos..sos..sos..',
    '................',
    '....o.....o.....',
    '...oUo...oUo....',
    '...oUv...oUv....',
    '...oUv...oUv....',
    '...sos...sos....',
    '................',
    '................',
    '................',
    '................',
  ];

  // ---------------------------------------------------------------- fire
  const FPAL = {
    '.': null,
    'o': '#3c2a1e',
    'u': '#8a6142',
    'U': '#a3794f',
    'v': '#6b4a30',
    'f': '#f2a63c', // flame orange
    'F': '#f6d35c', // flame yellow
    'h': '#e2622e', // flame deep
    'W': '#fff7d9', // flame core
    'y': '#8b93a8', // stone ring
    'Y': '#a8b0c4',
    's': '#c9dcee',
  };

  const fire1 = [
    '................',
    '................',
    '.......f........',
    '......hf........',
    '......hff.......',
    '.....hfFf.......',
    '.....hfFFf......',
    '....hffFWFf.....',
    '....hfFWWFf.....',
    '....hfFWFFfh....',
    '.....ffFFfh.....',
    '..ovuuffuuvo....',
    '.ovuUuUuUuuvo...',
    '..oyossssoyo....',
    '...ssssssss.....',
    '................',
  ];
  const fire2 = [
    '................',
    '................',
    '........f.......',
    '........fh......',
    '.......ffh......',
    '.......fFfh.....',
    '......fFFfh.....',
    '.....ffWFffh....',
    '.....fFWWFfh....',
    '....hfFFWFf.....',
    '.....hfFFff.....',
    '..ovuuffuuvo....',
    '.ovuUuUuUuuvo...',
    '..oyossssoyo....',
    '...ssssssss.....',
    '................',
  ];
  const fire3 = [
    '................',
    '................',
    '................',
    '.......f........',
    '......fFh.......',
    '......fFfh......',
    '.....hfFFf......',
    '.....fFWFfh.....',
    '....hfFWWFf.....',
    '....hffFWFfh....',
    '.....hffFff.....',
    '..ovuuffuuvo....',
    '.ovuUuUuUuuvo...',
    '..oyossssoyo....',
    '...ssssssss.....',
    '................',
  ];

  // fire embers only (for burnt-out look during day it still burns; unused for now)

  // ---------------------------------------------------------------- torch
  const TOPAL = {
    '.': null,
    'o': '#3c2a1e',
    'u': '#8a6142',
    'U': '#a3794f',
    'f': '#f2a63c',
    'F': '#f6d35c',
    'h': '#e2622e',
    'W': '#fff7d9',
    's': '#c9dcee',
  };
  const torch1 = [
    '........',
    '...ff...',
    '..hfFf..',
    '..fFWf..',
    '..hfFh..',
    '...oo...',
    '..ouUo..',
    '...oUo..',
    '...ouo..',
    '...oUo..',
    '...ouo..',
    '...oUo..',
    '..s..s..',
    '........',
  ];
  const torch2 = [
    '........',
    '...f....',
    '..fFfh..',
    '..fWFf..',
    '..hfFh..',
    '...oo...',
    '..ouUo..',
    '...oUo..',
    '...ouo..',
    '...oUo..',
    '...ouo..',
    '...oUo..',
    '..s..s..',
    '........',
  ];

  // ---------------------------------------------------------------- items
  const ITPAL = {
    '.': null,
    'o': '#3c2a1e',
    'u': '#8a6142',
    'U': '#a3794f',
    'v': '#6b4a30',
    'c': '#d9ad72',
    'C': '#b9884f',
    'y': '#8b93a8',
    'Y': '#a8b0c4',
    'k': '#666d84',
    'r': '#d6454f',
    'R': '#f2707a',
    'g': '#3a6b52',
    'O': '#3a3f52',
    'n': '#d8a850', // gold
    'N': '#f2cc6a', // gold bright
    'h': '#fff2c0', // gold shine
  };

  const itemWood = [
    '........',
    '..oooo..',
    '.oUUUuo.',
    'oCcuUuvo',
    'occuuvo.',
    '.ovvvo..',
    '..ooo...',
    '........',
  ];
  const itemStone = [
    '........',
    '..OOO...',
    '.OYYyO..',
    'OYYyyyO.',
    'OYyyykO.',
    '.OykkO..',
    '..OOO...',
    '........',
  ];
  const itemBerry = [
    '........',
    '...og...',
    '..orgo..',
    '.oRrrro.',
    '.orrRro.',
    '..orro..',
    '...oo...',
    '........',
  ];
  const FIPAL = {
    '.': null,
    'o': '#243b52',
    'b': '#4f7ea3',
    'B': '#6f9fc0',
    'w': '#c9dded',
    'e': '#101d2c',
  };
  const itemFish = [
    '........',
    '....oo..',
    '.o.oBBo.',
    '.ooBbBBo',
    '.oBbBeBo',
    '.oowbBBo',
    '.o.oBBo.',
    '....oo..',
  ];
  const itemGold = [
    '........',
    '..oooo..',
    '.onNNno.',
    'onNhNnno',
    'onNNnno.',
    '.onnno..',
    '..ooo...',
    '........',
  ];

  // Roguelike cards: one shared silhouette (a card face with a sparkle pip),
  // five palettes - the rarity IS the card's colour, the way GEAR_MATS tints
  // one gear icon across levels instead of drawing four. 'C' carries the
  // rarity hex, 'G' is a shared white sparkle, 'o' a shared dark rim.
  const itemCard = [
    '........',
    '.oooooo.',
    '.oCCCCo.',
    '.oCCCCo.',
    '.oCGGCo.',
    '.oCGGCo.',
    '.oCCCCo.',
    '.oooooo.',
  ];
  const CARD_PAL = (hex) => ({ '.': null, 'o': '#141c30', 'C': hex, 'G': '#ffffff' });
  const CARD_PALS = {
    white: CARD_PAL('#d9dfe8'), green: CARD_PAL('#5fd18a'), blue: CARD_PAL('#4a90e2'),
    purple: CARD_PAL('#a259e6'), gold: CARD_PAL('#e8a33d'),
  };

  // The backpack's own glyph: 12x12 like a gear icon, because it sits in the
  // same 18px HUD well. Dark flap over a lighter body with a gold buckle.
  const itemBag = [
    '....oooo....',
    '...ovvvvo...',
    '..ovvvvvvo..',
    '.ovvvvvvvvo.',
    '.oovvvvvvoo.',
    '.oUUonnoUUo.',
    '.oUUoNNoUUo.',
    '.oUUUUUUUUo.',
    '.ouUUUUUUuo.',
    '.ouuuuuuuuo.',
    '..ouuuuuuo..',
    '...oooooo...',
  ];

  // ---------------------------------------------------------------- gear icons
  // One 12x12 glyph PER VARIANT (12 total), baked once per material - leather /
  // iron / steel / gold - into SPRITES.gearIcons[slot][variant][material], so
  // the icon carries WHICH piece you chose and its material carries the level.
  // Shared accent chars across every material: w ice-white, r hearth-red.
  const GEAR_MAT_PALS = [
    { '.': null, 'o': '#141a2c', 'm': '#8a6a4a', 'h': '#b08a5e', 'd': '#5f4830', 'w': '#ddf1f8', 'r': '#f2707a' }, // leather
    { '.': null, 'o': '#141a2c', 'm': '#9aa3ad', 'h': '#c8ccd4', 'd': '#646c76', 'w': '#ddf1f8', 'r': '#f2707a' }, // iron
    { '.': null, 'o': '#141a2c', 'm': '#9fc4dd', 'h': '#ddf1f8', 'd': '#5f87a8', 'w': '#ffffff', 'r': '#f2707a' }, // steel
    { '.': null, 'o': '#141a2c', 'm': '#f2cc6a', 'h': '#ffedb0', 'd': '#b8912f', 'w': '#ffffff', 'r': '#f2707a' }, // gold
  ];
  // helmet 0 LONGSIGHT: closed helm, one long glowing sight slit
  const gearLongsight = [
    '...oooooo...',
    '..ommhhmmo..',
    '.ommmmmmmmo.',
    '.ommmmmmmmo.',
    '.oddddddddo.',
    '.owwwwwwwdo.',
    '.oddddddddo.',
    '.ommmmmmmmo.',
    '.ommmmmmmmo.',
    '..odo..odo..',
    '..oo....oo..',
    '............',
  ];
  // helmet 1 QUICKDRAW: winged cap, white wings flared at the temples
  const gearQuickdraw = [
    '............',
    '....oooo....',
    '...ommmmo...',
    '..ommhhmmo..',
    '.oommmmmmoo.',
    'owwommmmowwo',
    'owwwodmowwwo',
    '.oowod.dowo.',
    '...o.oo.o...',
    '............',
    '............',
    '............',
  ];
  // helmet 2 HUNTSMAN: peaked hood with a white feather
  const gearHuntsman = [
    '.........ww.',
    '......o.ww..',
    '.....oowwo..',
    '....ommwo...',
    '...ommmmo...',
    '..ommmmmmo..',
    '.ommmmmmmdo.',
    '.omdddddddo.',
    '.odo.....do.',
    '..oo.....o..',
    '............',
    '............',
  ];
  // chest 0 BULWARK: a kite shield
  const gearBulwark = [
    '.oooooooooo.',
    'omhhhhhhmmdo',
    'ommmmmmmmmdo',
    'ommmmmmmmmdo',
    'ommmmmmmmmdo',
    '.ommmmmmmdo.',
    '.ommmmmmmdo.',
    '..ommmmmdo..',
    '...ommmdo...',
    '....omdo....',
    '.....oo.....',
    '............',
  ];
  // chest 1 IRONHIDE: riveted breastplate with shoulder caps
  const gearIronhide = [
    'ooo......ooo',
    'omdo.oo.omdo',
    '.oommmmmmoo.',
    '.ohmmmmmmdo.',
    '.ommhmmhmmo.',
    '.ommmmmmmdo.',
    '.ommhmmhmmo.',
    '.odmmmmmmdo.',
    '..ommmmmmo..',
    '..oddddddo..',
    '...oooooo...',
    '............',
  ];
  // chest 2 HEARTHWEAVE: quilted tunic with a hearth-red heart
  const gearHearthweave = [
    '.oo......oo.',
    '.omoooooomo.',
    '..ommmmmmo..',
    '.ommmmmmmmo.',
    '.omrrmrrmmo.',
    '.omrrrrrmmo.',
    '.ommrrrmmmo.',
    '.ommmrmmmmo.',
    '..ommmmmmo..',
    '..oddddddo..',
    '...oooooo...',
    '............',
  ];
  // legs 0 STRIDER: greaves with speed ticks streaming off
  const gearStrider = [
    '..oooo.oooo.',
    '..ohmo.ohmo.',
    '..ohmo.ohmo.',
    'w.ommo.ommo.',
    '..oddo.oddo.',
    'w.ommo.ommo.',
    '..ommo.ommo.',
    'w.oddo.oddo.',
    '..oooo.oooo.',
    '............',
    '............',
    '............',
  ];
  // legs 1 SLIDEWORN: greaves riding a slide board, spray behind
  const gearSlideworn = [
    '..oooo.oooo.',
    '..ohmo.ohmo.',
    '..ommo.ommo.',
    '..ommo.ommo.',
    '..oddo.oddo.',
    '..oooo.oooo.',
    '.owwwwwwwwo.',
    '..oooooooo..',
    'w.w.........',
    '............',
    '............',
    '............',
  ];
  // legs 2 PACKMULE: a work belt with two hanging pouches
  const gearPackmule = [
    '............',
    '.oooooooooo.',
    '.ohmmhhmmho.',
    '.oooooooooo.',
    '..oooo.oooo.',
    '..ommo.ommo.',
    '..ommo.ommo.',
    '..oddo.oddo.',
    '...oo...oo..',
    '............',
    '............',
    '............',
  ];
  // boots 0 SKATES: a boot on a white blade
  const gearSkates = [
    '....oooo....',
    '....ohmo....',
    '....ohmo....',
    '....ommo....',
    '....ommo....',
    '....ommooo..',
    '....ommmmdo.',
    '....oddddo..',
    '....o..o....',
    '...wwwwwww..',
    '............',
    '............',
  ];
  // boots 1 DANCER: a light boot mid-step, motion ticks trailing
  const gearDancer = [
    '.....oo.....',
    '.....omo....',
    '....oomo....',
    '....omo.w...',
    '...oomo.....',
    '...omoo.w...',
    '..oommdo....',
    '..ommmdo.w..',
    '..odddo.....',
    '...ooo......',
    '............',
    '............',
  ];
  // boots 2 GHOSTSTEP: a boot beside its fading afterimage
  const gearGhoststep = [
    '.oooo.......',
    '.ohmo..d.d..',
    '.ohmo.......',
    '.ommo..d.d..',
    '.ommoo......',
    '.ommmdo.dd..',
    '.odddo..d.d.',
    '..ooo...dd..',
    '............',
    '............',
    '............',
    '............',
  ];

  // ---------------------------------------------------------------- heart
  const HPAL = {
    '.': null,
    'o': '#5c1f2e',
    'r': '#e04a54',
    'R': '#f78a8a',
    'W': '#ffd9d9',
    'g': '#3a3448', // empty
    'G': '#4a4460',
  };
  const heartFull = [
    '.oo.oo..',
    'orRoRro.',
    'orWRrro.',
    'orrrrro.',
    '.orrro..',
    '..oro...',
    '...o....',
  ];
  const heartHalf = [
    '.oo.oo..',
    'orRoGgo.'.replace('g', 'g'),
    'orWogGo.',
    'orrogGo.',
    '.orogo..',
    '..oro...',
    '...o....',
  ];
  const heartEmpty = [
    '.oo.oo..',
    'oGgÐ¾gGo.'.replace('Ð¾', 'g'),
    'oGgggGo.',
    'ogggggo.',
    '.ogggo..',
    '..ogo...',
    '...o....',
  ];
  const HEPAL = { '.': null, 'o': '#2a2438', 'g': '#3a3448', 'G': '#4a4460', 'r': '#e04a54', 'R': '#f78a8a', 'W': '#ffd9d9' };

  // ---------------------------------------------------------------- axe icon
  const AXPAL = {
    '.': null,
    'o': '#3c2a1e',
    'u': '#8a6142',
    'U': '#a3794f',
    'y': '#8b93a8',
    'Y': '#c4ccdd',
  };
  const itemAxe = [
    '........',
    '..oooo..',
    '.oYYyo..',
    '.oYyyoo.',
    '..oyouo.',
    '...ouUo.',
    '..ouUo..',
    '..oo....',
  ];

  // bow + pickaxe tool icons, same palette as the axe (y/Y double as string/steel)
  const itemBow = [
    '...ou...',
    '..ou.y..',
    '.oU..y..',
    '.oU..y..',
    '.oU..y..',
    '.oU..y..',
    '..ou.y..',
    '...ou...',
  ];
  const itemPick = [
    '..oooo..',
    '.oYyyYo.',
    'oYouuoYo',
    '.o.uu.o.',
    '..ouuo..',
    '..ouuo..',
    '..ouuo..',
    '...oo...',
  ];

  // ---------------------------------------------------------------- cursors
  // Custom in-canvas pointer set, lit from the top-left like the rest of the
  // art: white body, icy right-edge bevel, deep navy outline. Each is drawn
  // over a baked one-colour shadow (same grids, CUSHADOW) offset by a pixel.
  const CUPAL = {
    '.': null,
    'o': '#1c1a30', // outline
    'w': '#f4f7ff', // body
    'b': '#c2d8ee', // icy bevel
    'B': '#8fb3d6', // deep bevel
    's': '#8b93a8', // steel
    'S': '#c4ccdd', // steel light
    'h': '#8a6142', // wood
    'H': '#a3794f', // wood light
  };
  const CUSHADOW = {};
  for (const k in CUPAL) CUSHADOW[k] = CUPAL[k] ? '#0a0e23' : null;

  // plain pointer: menus, overlays, the title screen. Hotspot = tip (0,0).
  const cursorArrow = [
    'o.........',
    'oo........',
    'owo.......',
    'owwo......',
    'owwbo.....',
    'owwwbo....',
    'owwwwbo...',
    'owwwwwbo..',
    'owwwwwwbo.',
    'owwwwwwwbo',
    'owwwbbbBBo',
    'owbowbo...',
    'owo.owbo..',
    'oo...owbo.',
    '.....oBBo.',
    '......oo..',
  ];
  // pointing hand: something under the cursor will react to a click.
  // Hotspot = fingertip (4,0).
  const cursorHand = [
    '....oo.......',
    '...owbo......',
    '...owbo......',
    '...owbooo....',
    '...owbowbooo.',
    '...owbowbowbo',
    '.ooowbowbowbo',
    'owwowbowbowbo',
    'owwwwwwwwwwbo',
    'owwwwwwwwwwbo',
    '.owwwwwwwwbBo',
    '..owwwwwwbBo.',
    '...owwwwbBo..',
    '...oooooooo..',
  ];
  // closed fist: dragging a slider. Hotspot = centre (5,4).
  const cursorGrab = [
    '...oooooo..',
    '..owbwbwbo.',
    '.owbowbowbo',
    'oowwowwowbo',
    'owwwwwwwwbo',
    'owwwwwwwwbo',
    '.owwwwwwbBo',
    '..owwwwbBo.',
    '...oooooo..',
  ];
  // builder's mallet: a stump or structure you can right-click. The head sits
  // top-right so the handle trails away from the hotspot at the face (6,5).
  const cursorHammer = [
    '......oooo..',
    '.....oSSSso.',
    '....oSSSsso.',
    '...oSSSssso.',
    '...ossssssso',
    '..oHoossssso',
    '.oHho.oooooo',
    'oHho........',
    'ohho........',
    'oho.........',
    'oo..........',
  ];

  // ---------------------------------------------------------------- teams
  // Two team presets, RED vs BLUE. A team's colour drives its CHARACTERS
  // (coat, hat, trim), its BUILDINGS (fittings + glow accent, painted over the
  // tier material) and its EAGLE's armour, so a side reads as one side at a
  // glance. The game code reads the names/markers back out of SPRITES.teams -
  // this table is the only place the team palette is written down.
  const TEAM_SKINS = [
    { name: 'RED', mark: '#e05548', // slot 0 - the original red/teal look
      coat: '#c9524e', coatL: '#df7358', coatD: '#96393f', hat: '#3e8c81', hatL: '#58ab98',
      trim: '#f6ecd4', trimD: '#d9c5a0', fit: '#5a3340', fitL: '#8c4f52', glow: '#ff9440' },
    { name: 'BLUE', mark: '#6aa8e8',
      coat: '#3f6fb0', coatL: '#5e93d8', coatD: '#2b4d7d', hat: '#cfe4f2', hatL: '#f4faff',
      trim: '#e8f2fb', trimD: '#bcd0e4', fit: '#2a3a56', fitL: '#4c6a94', glow: '#8fd8ff' },
  ];
  const teamPlayerPal = (t) => Object.assign({}, PPAL, {
    r: t.coat, R: t.coatL, d: t.coatD, t: t.hat, T: t.hatL, m: t.trim, M: t.trimD,
  });
  const teamBuildPal = (base, t) => Object.assign({}, base, { k: t.fit, K: t.fitL, e: t.glow });
  const bayTeamPal = (t) => Object.assign({}, BAYPAL, { L: t.coatL, T: t.coat, t: t.coatD });
  const teamRobotPal = (t) => Object.assign({}, BOTPAL, { L: t.coatL, T: t.coat, t: t.coatD });
  const playerSet = (pal) => ({
    down: [bake(playerDownIdle, pal), bake(playerDownA, pal), bake(playerDownB, pal)],
    up: [bake(playerUpIdle, pal), bake(playerUpA, pal), bake(playerUpB, pal)],
    right: [bake(playerSideIdle, pal), bake(playerSideA, pal), bake(playerSideB, pal)],
    left: [flipH(bake(playerSideIdle, pal)), flipH(bake(playerSideA, pal)), flipH(bake(playerSideB, pal))],
    // belly-down: a sibling of the four walking directions, same frame order
    prone: {
      down: [bakeSpan(pnDownIdle, pal), bakeSpan(pnDownA, pal), bakeSpan(pnDownB, pal)],
      up: [bakeSpan(pnUpIdle, pal), bakeSpan(pnUpA, pal), bakeSpan(pnUpB, pal)],
      right: [bakeSpan(pnSideIdle, pal), bakeSpan(pnSideA, pal), bakeSpan(pnSideB, pal)],
      left: [flipH(bakeSpan(pnSideIdle, pal)), flipH(bakeSpan(pnSideA, pal)), flipH(bakeSpan(pnSideB, pal))],
    },
  });
  const TIER_PALS = [WPAL, WPAL_STONE, WPAL_GOLD];
  const teamPlayers = TEAM_SKINS.map((t) => playerSet(teamPlayerPal(t)));
  const skaterSet = (pal) => {
    const sp = Object.assign({}, pal, SKPAL_EXTRA);
    return {
      down: [bake(skDownIdle, sp), bake(skDownA, sp), bake(skDownB, sp)],
      up: [bake(skUpIdle, sp), bake(skUpA, sp), bake(skUpB, sp)],
      right: [bake(skSideIdle, sp), bake(skSideA, sp), bake(skSideB, sp)],
      left: [flipH(bake(skSideIdle, sp)), flipH(bake(skSideA, sp)), flipH(bake(skSideB, sp))],
      prone: {
        down: [bakeSpan(pnSkDownIdle, sp), bakeSpan(pnSkDownA, sp), bakeSpan(pnSkDownB, sp)],
        up: [bakeSpan(pnSkUpIdle, sp), bakeSpan(pnSkUpA, sp), bakeSpan(pnSkUpB, sp)],
        right: [bakeSpan(pnSkSideIdle, sp), bakeSpan(pnSkSideA, sp), bakeSpan(pnSkSideB, sp)],
        left: [flipH(bakeSpan(pnSkSideIdle, sp)), flipH(bakeSpan(pnSkSideA, sp)), flipH(bakeSpan(pnSkSideB, sp))],
      },
    };
  };
  // champ[c][team] - one full pose set per champion per team colour
  const champPlayers = [teamPlayers, TEAM_SKINS.map((t) => skaterSet(teamPlayerPal(t)))];
  const teamBuild = TEAM_SKINS.map((t) => ({
    wall: TIER_PALS.map((b) => bake(wall, teamBuildPal(b, t))),
    turret: TIER_PALS.map((b) => bake(turret, teamBuildPal(b, t))),
    generator: TIER_PALS.map((b) => bake(generator, teamBuildPal(b, t))),
    spawner: [bake(bay, bayTeamPal(t))],
    net: [bake(net, teamBuildPal(NETPAL, t))],
    keep: TIER_PALS.map((b) => bake(keep, teamBuildPal(b, t))),
    // wheel glyphs for sprites too big to be their own icon
    icon: {
      spawner: bake(bayIcon, bayTeamPal(t)), turret: bake(turretIcon, teamBuildPal(WPAL, t)),
      keep: bake(keepIcon, teamBuildPal(WPAL, t)),
    },
  }));
  const teamRobots = TEAM_SKINS.map((t) => [bake(botA, teamRobotPal(t)), bake(botB, teamRobotPal(t))]);

  // ---------------------------------------------------------------- eagle
  // The drop eagle, seen from above, flying along +x (the game rotates it to
  // its heading). 32x48: three wing frames cycled spread -> mid -> back -> mid.
  // Drawn at 2x in-game (it is far above the ground), never through
  // drawSpriteFlash (it is taller than the 32x32 scratch).
  const EGPAL = {
    '.': null,
    'o': '#4e5c82', // outline
    'w': '#f6f8ff', // plumage
    'W': '#d2dbea', // plumage shade (trailing feathers, belly)
    'g': '#8c9ab8', // primaries / tail band
    'c': '#fff6dd', // head
    'y': '#e9b23c', // beak
    'e': '#2e2440', // eye
  };
  // the same silhouette as a soft ground shadow
  const EGSHADOW = { '.': null, 'o': 'rgba(40,60,100,0.30)', 'w': 'rgba(40,60,100,0.30)', 'W': 'rgba(40,60,100,0.30)',
    'g': 'rgba(40,60,100,0.30)', 'c': 'rgba(40,60,100,0.30)', 'y': 'rgba(40,60,100,0.30)', 'e': 'rgba(40,60,100,0.30)' };
  const eagleSpread = [
    '.......og.gg.gW.o...............',
    '.......og.gg.gW.Wo..............',
    '.......og.gg.gW.Wo..............',
    '.......og.gg.gW.Wo..............',
    '.......og.gg.gW.Wo..............',
    '.......og.gg.gW.WWo.............',
    '.......oWWWWwwwwwwo.............',
    '.......oWWWWwwwwwwo.............',
    '.......oWWWWWwwwwwo.............',
    '.......oWWWWWwwwwwo.............',
    '.......oWWWWWwwwwwwo............',
    '.......oWWWWWwwwwwwo............',
    '......oWWWWWWwwwwwwo............',
    '......oWWWWWWwwwwwwo............',
    '......oWWWWWWwwwwwwwo...........',
    '......oWWWWWWwwwwwwwo...........',
    '......oWWWWWWwwwwwwwo...........',
    '......oWWWWWWwwwwwwwo...........',
    '......oWWWWWWwwwwwwwo...........',
    '..oo..oWWWWWWwwwwwwwwo.ooo......',
    '.oggoooWwwwwwwwwwwwwwooccco.....',
    '.oggwwwwwwwwwwwwwwwwooccccco....',
    '.oggwwwwwwwwwwwwwwwwwcccecccoo..',
    '.oggwwwwwwwwwwwwwwwwwccccccyyyo.',
    '.oggwwwwwwwwwwwwwwwwwccccccyyo..',
    '.oggwwWWWWWWWWWWWWWWoocceccoo...',
    '.oggoooWWWWWWWWWWWwwwooccco.....',
    '..oo..oWWWWWWwwwwwwwwo.ooo......',
    '......oWWWWWWwwwwwwwo...........',
    '......oWWWWWWwwwwwwwo...........',
    '......oWWWWWWwwwwwwwo...........',
    '......oWWWWWWwwwwwwwo...........',
    '......oWWWWWWwwwwwwwo...........',
    '......oWWWWWWwwwwwwo............',
    '......oWWWWWWwwwwwwo............',
    '.......oWWWWWwwwwwwo............',
    '.......oWWWWWwwwwwwo............',
    '.......oWWWWWwwwwwo.............',
    '.......oWWWWWwwwwwo.............',
    '.......oWWWWwwwwwwo.............',
    '.......oWWWWwwwwwwo.............',
    '.......og.gg.gW.WWo.............',
    '.......og.gg.gW.Wo..............',
    '.......og.gg.gW.Wo..............',
    '.......og.gg.gW.Wo..............',
    '.......og.gg.gW.Wo..............',
    '.......og.gg.gW.o...............',
    '........o.oo.oo.................',
  ];
  const eagleMid = [
    '................................',
    '.....o.oo.oo....................',
    '....og.gg.gW....................',
    '.....og.gg.WW...................',
    '.....og.gg.WW...................',
    '.....og.gg.gW.o.................',
    '.....og.gg.gW.Wo................',
    '.....oWWWWwwwwwo................',
    '.....oWWWWWwwwwwo...............',
    '.....oWWWWWwwwwwo...............',
    '......oWWWWwwwwwwo..............',
    '......oWWWWwwwwwwo..............',
    '......oWWWWWwwwwwo..............',
    '......oWWWWWwwwwwwo.............',
    '......oWWWWWwwwwwwo.............',
    '......oWWWWWwwwwwwwo............',
    '......oWWWWWWwwwwwwo............',
    '.......oWWWWWwwwwwwwo...........',
    '.......oWWWWWwwwwwwwo...........',
    '..oo...oWWWWWWwwwwwwo..ooo......',
    '.oggoooowwwwwwwwwwwwwooccco.....',
    '.oggwwwwwwwwwwwwwwwwooccccco....',
    '.oggwwwwwwwwwwwwwwwwwcccecccoo..',
    '.oggwwwwwwwwwwwwwwwwwccccccyyyo.',
    '.oggwwwwwwwwwwwwwwwwwccccccyyo..',
    '.oggwwWWWWWWWWWWWWWWoocceccoo...',
    '.oggooooWWWWWWWWWWwwwooccco.....',
    '..oo...oWWWWWWwwwwwwo..ooo......',
    '.......oWWWWWwwwwwwwo...........',
    '.......oWWWWWwwwwwwwo...........',
    '......oWWWWWWwwwwwwo............',
    '......oWWWWWwwwwwwwo............',
    '......oWWWWWwwwwwwo.............',
    '......oWWWWWwwwwwwo.............',
    '......oWWWWWwwwwwo..............',
    '......oWWWWwwwwwwo..............',
    '......oWWWWwwwwwwo..............',
    '.....oWWWWWwwwwwo...............',
    '.....oWWWWWwwwwwo...............',
    '.....oWWWWwwwwwo................',
    '.....og.gg.gW.Wo................',
    '.....og.gg.gW.o.................',
    '.....og.gg.WW...................',
    '.....og.gg.WW...................',
    '....og.gg.gW....................',
    '.....o.oo.oo....................',
    '................................',
    '................................',
  ];
  const eagleBack = [
    '................................',
    '................................',
    '................................',
    '................................',
    '....o.oo.oo.....................',
    '...og.gg.WWo....................',
    '...og.gg.WWo....................',
    '...og.gg.gW.....................',
    '....og.gg.WW....................',
    '....oWWWWwwwwo..................',
    '....oWWWWwwwwwo.................',
    '.....oWWWWwwwwwo................',
    '.....oWWWWwwwwwo................',
    '.....oWWWWWwwwwwo...............',
    '......oWWWWwwwwwwo..............',
    '......oWWWWWwwwwwo..............',
    '......oWWWWWwwwwwwo.............',
    '.......oWWWWWwwwwwwo............',
    '.......oWWWWWwwwwwwo............',
    '..oo...oWWWWWWwwwwwwo..ooo......',
    '.oggoooowwwwwwwwwwwwwooccco.....',
    '.oggwwwwwwwwwwwwwwwwooccccco....',
    '.oggwwwwwwwwwwwwwwwwwcccecccoo..',
    '.oggwwwwwwwwwwwwwwwwwccccccyyyo.',
    '.oggwwwwwwwwwwwwwwwwwccccccyyo..',
    '.oggwwWWWWWWWWWWWWWWoocceccoo...',
    '.oggooooWWWWWWWWWWwwwooccco.....',
    '..oo...oWWWWWWwwwwwwo..ooo......',
    '.......oWWWWWwwwwwwo............',
    '.......oWWWWWwwwwwwo............',
    '......oWWWWWwwwwwwo.............',
    '......oWWWWWwwwwwo..............',
    '......oWWWWwwwwwwo..............',
    '.....oWWWWWwwwwwo...............',
    '.....oWWWWwwwwwo................',
    '.....oWWWWwwwwwo................',
    '....oWWWWwwwwwo.................',
    '....oWWWWwwwwo..................',
    '....og.gg.WW....................',
    '...og.gg.gW.....................',
    '...og.gg.WWo....................',
    '...og.gg.WWo....................',
    '....o.oo.oo.....................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
  ];

  // Team armour as a pure palette swap: the torso band - the rows the head
  // sits in, which hold still across the flap frames (only the wings move) -
  // is re-lettered to plate (P/p) and helm (H) and baked in team colour.
  // Armour only recolours pixels the bird already has, so the silhouette is
  // untouched and the plating follows the body's contours exactly.
  const armorize = (grid) => grid.map((row) => row.includes('c')
    ? row.replace(/w/g, 'P').replace(/W/g, 'p').replace(/c/g, 'H')
    : row);
  const eagleTeamPal = (t) => Object.assign({}, EGPAL, { P: t.coatL, p: t.coatD, H: t.mark });
  // an all-white body for the downed bird's hit flash (it is taller than the
  // 64x64 drawSpriteFlash scratch, so it gets a baked silhouette instead)
  const EGFLASH = Object.keys(EGPAL).reduce((o, k) => (o[k] = k === '.' ? null : '#f4f7ff', o), {});

  // ---------------------------------------------------------------- wolf
  // The wolf den's pack: a low-slung side-view predator, amber-eyed, in the
  // same 3-frame stand/run set the deer and rabbit use (left = flipH).
  const WOPAL = {
    '.': null,
    'o': '#262b38', // outline
    'y': '#6f778c', // coat mid
    'Y': '#8f97ac', // coat light (lit from above)
    'd': '#4d5468', // coat shade (flank)
    'c': '#dfe4ef', // pale throat / belly / muzzle
    'e': '#f2b03c', // eye
    'n': '#171a22', // nose
  };
  const wolfBody = [
    '...........o.o..',
    '..........oYoYo.',
    '.o........oYYYo.',
    'oYo....ooooYYYYo',
    'oYYo..oYYYYYYYeo',
    '.oYYooYYYYYYYccn',
    '..oYYdddddYYcco.',
    '...oddddddddco..',
    '...oddddddddco..',
    '...ocddcccddco..',
  ];
  const wolfStand = wolfBody.concat([
    '...oyo...oyyo...',
    '...oyo...oyyo...',
    '...ooo...ooo....',
  ]);
  const wolfRunA = wolfBody.concat([
    '..oyo....oyyo...',
    '.oyo......oyyo..',
    '.ooo......ooo...',
  ]);
  const wolfRunB = wolfBody.concat([
    '....oyo.oyyo....',
    '....oyo..oyyo...',
    '....ooo..ooo....',
  ]);

  // ---------------------------------------------------------------- rookery
  // Dead trees: the rookery's bare snags. Same 16x24 footprint as a pine so
  // they draw at py-8 in the same band, but stripped to grey wood and snow.
  const DTPAL = {
    '.': null,
    'o': '#2a2018', // outline
    'u': '#6b5a48', // dead wood
    'U': '#4b3d30', // dead wood dark
    'v': '#8a7761', // lit bark
    'w': '#eef4fb', // snow
    's': '#c9dcee', // snow shade
  };
  const deadTree1 = [
    '................',
    '.......ow.......',
    '..w....ou.......',
    '.ouo...ov...w...',
    '..ovo..ov..ouo..',
    '...ovo.ov.ovo...',
    '....ovoovoovo...',
    '.....ovuvuvo....',
    '..w...ouvuo.....',
    '.ouo..ouvuo.ww..',
    '..ovo.ouvuo.ou..',
    '...ovooUvUoovo..',
    '....ovuUvUuvo...',
    '......ouvUo.....',
    '......ouvUo.....',
    '......ouUUo.....',
    '.....oouUUoo....',
    '.....ovuUUvo....',
    '.....ovuUUvo....',
    '.....ouUUUuo....',
    '....oouUUUuoo...',
    '....owwUUUwwo...',
    '....osswwwsso...',
    '.....ssssss.....',
  ];
  const deadTree2 = [
    '................',
    '...........w....',
    '....w.....ou....',
    '...ouo....ov....',
    '....ovo..ovo....',
    '.....ovooovo....',
    '..w...ovuvo.....',
    '.ouo..ouvuo.....',
    '..ovo.ouvuo.w...',
    '...ovooUvUoouo..',
    '....ovuUvUuovo..',
    '......ouvUuvo...',
    '......ouvUo.....',
    '......ouUUo.....',
    '......ouUUo.....',
    '.....oouUUo.....',
    '.....ovuUUoo....',
    '.....ovuUUvo....',
    '.....ouUUUvo....',
    '.....ouUUUuo....',
    '....oouUUUuoo...',
    '....owwUUUwwo...',
    '....osswwwsso...',
    '.....ssssss.....',
  ];

  // Birds: the rookery's flock. Tiny, so a perched frame plus two wing frames
  // is the whole set; the game draws them above the ground on their own alt.
  const BIPAL = {
    '.': null,
    'o': '#232734', // outline
    'y': '#4d5566', // feather mid
    'Y': '#77809a', // feather light
    'c': '#cfd6e4', // pale breast
    'n': '#e0a63c', // beak
  };
  const birdPerch = [
    '..oo.....',
    '.oYYo....',
    'oyYYyon..',
    'oyyyyco..',
    '.oyyco...',
    '..o.o....',
  ];
  const birdFlyA = [
    'oo.....oo',
    '.oy...yo.',
    '.oyYYYyon',
    '..oyccyo.',
    '...ooo...',
  ];
  const birdFlyB = [
    '.........',
    '..oo.oo..',
    '.oyYYYyon',
    'oyyyccyo.',
    '.oo...oo.',
  ];

  // ---------------------------------------------------------------- den
  // The wolf den's mouth: a snow-capped rock mound with a black throat and a
  // picked-over bone at the lip. 16x12, drawn at py+4 like a rock.
  const DNPAL = {
    '.': null,
    'o': '#2b3040', // outline
    'y': '#7b8398', // rock mid
    'Y': '#99a1b6', // rock light
    'v': '#5a6176', // rock dark
    'k': '#12151f', // the dark inside
    'b': '#e6e2d4', // bone
    'w': '#eef4fb', // snow
    's': '#c9dcee', // snow shade
  };
  const den = [
    '................',
    '.....owwwwo.....',
    '...oowwwwwwoo...',
    '..owwwwwwwwwwo..',
    '.oswwwwwwwwwwso.',
    'oYsswyyyyywsssYo',
    'oYyyyokkkoyyyyYo',
    'oYyyokkkkkoyyyYo',
    'ovyyokkkkkoyyyvo',
    'ovvyokkkkkoyyvvo',
    '.ovvokkkkkovvvo.',
    '..ooobkkkboooo..',
  ];
  window.SPRITES = {
    teams: TEAM_SKINS,
    playerTeam: teamPlayers,
    champ: champPlayers,
    teamBuild: teamBuild,
    robotTeam: teamRobots,
    player: teamPlayers[0],
    raider: {
      down: [bake(playerDownIdle, RDPAL), bake(playerDownA, RDPAL), bake(playerDownB, RDPAL)],
      up: [bake(playerUpIdle, RDPAL), bake(playerUpA, RDPAL), bake(playerUpB, RDPAL)],
      right: [bake(playerSideIdle, RDPAL), bake(playerSideA, RDPAL), bake(playerSideB, RDPAL)],
      left: [flipH(bake(playerSideIdle, RDPAL)), flipH(bake(playerSideA, RDPAL)), flipH(bake(playerSideB, RDPAL))],
    },
    // 16 sway frames, not 2 variants: treeFrame() picks one off the wind wave
    tree: treeSway.map((f) => bake(f, TSPAL)),
    stump: bake(stump, TPAL),
    rock: [bake(rock1, RPAL), bake(rock2, RPAL)],
    goldOre: bake(goldOre, GOPAL),
    mine: bake(mine, MIPAL),
    bush: bake(bush, BPAL),
    bushEmpty: bake(bushEmpty, BPAL),
    rabbit: {
      right: [bake(rabbitSit, RBPAL), bake(rabbitHop, RBPAL), bake(rabbitSit, RBPAL)],
      left: [flipH(bake(rabbitSit, RBPAL)), flipH(bake(rabbitHop, RBPAL)), flipH(bake(rabbitSit, RBPAL))],
    },
    wolf: {
      right: [bake(wolfStand, WOPAL), bake(wolfRunA, WOPAL), bake(wolfRunB, WOPAL)],
      left: [flipH(bake(wolfStand, WOPAL)), flipH(bake(wolfRunA, WOPAL)), flipH(bake(wolfRunB, WOPAL))],
    },
    bird: {
      right: [bake(birdPerch, BIPAL), bake(birdFlyA, BIPAL), bake(birdFlyB, BIPAL)],
      left: [flipH(bake(birdPerch, BIPAL)), flipH(bake(birdFlyA, BIPAL)), flipH(bake(birdFlyB, BIPAL))],
    },
    deadTree: [bake(deadTree1, DTPAL), bake(deadTree2, DTPAL)],
    den: bake(den, DNPAL),
    deer: {
      right: [bake(deerStand, DEPAL), bake(deerWalkA, DEPAL), bake(deerWalkB, DEPAL)],
      left: [flipH(bake(deerStand, DEPAL)), flipH(bake(deerWalkA, DEPAL)), flipH(bake(deerWalkB, DEPAL))],
    },
    imp: [bake(imp1, IPAL), bake(imp2, IPAL)],
    eagle: [bake(eagleSpread, EGPAL), bake(eagleMid, EGPAL), bake(eagleBack, EGPAL)],
    // eagleTeam[team] - the same three flap frames in that team's armour
    eagleTeam: TEAM_SKINS.map((t) => [bake(armorize(eagleSpread), eagleTeamPal(t)),
      bake(armorize(eagleMid), eagleTeamPal(t)), bake(armorize(eagleBack), eagleTeamPal(t))]),
    eagleFlash: bake(eagleBack, EGFLASH), // the downed pose, all white, for the hit flash
    eagleShadow: bake(eagleSpread, EGSHADOW),
    wall: [bake(wall, WPAL), bake(wall, WPAL_STONE), bake(wall, WPAL_GOLD)],
    turret: [bake(turret, WPAL), bake(turret, WPAL_STONE), bake(turret, WPAL_GOLD)],
    generator: [bake(generator, WPAL), bake(generator, WPAL_STONE), bake(generator, WPAL_GOLD)],
    spawner: [bake(spawner, WPAL), bake(spawner, WPAL_STONE), bake(spawner, WPAL_GOLD)],
    net: [bake(net, NETPAL)],
    scaffold: [bake(scaffold1, SCPAL), bake(scaffold2, SCPAL), bake(scaffold3, SCPAL)],
    robot: teamRobots[0],
    spikes: bake(spikes, SPAL),
    fire: [bake(fire1, FPAL), bake(fire2, FPAL), bake(fire3, FPAL)],
    torch: [bake(torch1, TOPAL), bake(torch2, TOPAL)],
    itemWood: bake(itemWood, ITPAL),
    itemStone: bake(itemStone, ITPAL),
    itemBerry: bake(itemBerry, ITPAL),
    itemGold: bake(itemGold, ITPAL),
    itemFish: bake(itemFish, FIPAL),
    itemBag: bake(itemBag, ITPAL),
    itemCardWhite: bake(itemCard, CARD_PALS.white),
    itemCardGreen: bake(itemCard, CARD_PALS.green),
    itemCardBlue: bake(itemCard, CARD_PALS.blue),
    itemCardPurple: bake(itemCard, CARD_PALS.purple),
    itemCardGold: bake(itemCard, CARD_PALS.gold),
    // gearIcons[slot][variant][material]: 12 distinct variant glyphs, each in
    // leather / iron / steel / gold
    gearIcons: [
      [gearLongsight, gearQuickdraw, gearHuntsman],
      [gearBulwark, gearIronhide, gearHearthweave],
      [gearStrider, gearSlideworn, gearPackmule],
      [gearSkates, gearDancer, gearGhoststep],
    ].map((row) => row.map((g) => GEAR_MAT_PALS.map((pal) => bake(g, pal)))),
    itemAxe: bake(itemAxe, AXPAL),
    itemBow: bake(itemBow, AXPAL),
    itemPick: bake(itemPick, AXPAL),
    heartFull: bake(heartFull, HPAL),
    heartHalf: bake(heartHalf, HEPAL),
    heartEmpty: bake(heartEmpty, HEPAL),
    cursor: {
      arrow: bake(cursorArrow, CUPAL), hand: bake(cursorHand, CUPAL),
      grab: bake(cursorGrab, CUPAL), hammer: bake(cursorHammer, CUPAL),
    },
    cursorShadow: {
      arrow: bake(cursorArrow, CUSHADOW), hand: bake(cursorHand, CUSHADOW),
      grab: bake(cursorGrab, CUSHADOW), hammer: bake(cursorHammer, CUSHADOW),
    },
  };
})();

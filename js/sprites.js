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

  function flipH(src) {
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.translate(src.width, 0);
    g.scale(-1, 1);
    g.drawImage(src, 0, 0);
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

  const tree1 = [
    '.......Ww.......',
    '......owwo......',
    '......oGgo......',
    '.....owwwso.....',
    '.....oGGLgo.....',
    '....owwwwwso....',
    '....oGGLGggo....',
    '...ogGGLGGgo....',
    '...owwwwGwso....',
    '..ogGGLLGGggo...',
    '..ogGGLGGGggo...',
    '..oGwwLGGwwso...',
    '.ogGGLLGGGGggo..',
    '.ogGGLGGGGgggo..',
    '.owwGGLGGgwwso..',
    'ogGGLLGGGGGgggo.',
    'ogGGLGGGGGGgggo.',
    'oggggGGGGgggggo.',
    '.oosggggggsoo...',
    '....ouUuo.......',
    '....ouUuo.......',
    '....ouUUo.......',
    '...osuUUso......',
    '....ssssss......',
  ];

  const tree2 = [
    '.......wW.......',
    '......owwo......',
    '......ogGo......',
    '.....oswwwo.....',
    '.....ogLGGo.....',
    '....oswwwwwo....',
    '....oggGLGGo....',
    '....ogGLGGgo....',
    '...osGwwwwGo....',
    '...oggGLLGGgo...',
    '..ooggGLGGGgo...',
    '..oswwGGGwwGo...',
    '..oggGLLGGGGgo..',
    '.oogGGLGGGGGgo..',
    '.oswwGGLGGwwwo..',
    '.oggGLLGGGGGggo.',
    'ooggGLGGGGGGggo.',
    'oggggGGGGgggggo.',
    '.oosggggggsoo...',
    '.....ouUuo......',
    '.....ouUuo......',
    '.....ouUUo......',
    '....osuUUso.....',
    '.....ssssss.....',
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
  const turret = [
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

  // Wooden robot: the old imp grids re-baked in carved-wood colours.
  const ROBPAL = {
    '.': null,
    'o': '#3c2a1e', // outline
    'i': '#8a6142', // body mid
    'I': '#a3794f', // body light
    'j': '#6b4a30', // body shade
    'e': '#241a10', // eye socket
    'E': '#ffd95c', // eye glow
    'h': '#b9884f', // peg
    'H': '#8a6142', // peg shade
  };

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
  // Four team presets. A team's colour drives its CHARACTERS (coat, hat, trim)
  // and its BUILDINGS (fittings + glow accent, painted over the tier material)
  // so a base and its owner read as one side at a glance. game.js reads the
  // names/markers back out of SPRITES.teams - this table is the only place the
  // team palette is written down.
  const TEAM_SKINS = [
    { name: 'EMBER', mark: '#df7358', // slot 0 - the original red/teal look
      coat: '#c9524e', coatL: '#df7358', coatD: '#96393f', hat: '#3e8c81', hatL: '#58ab98',
      trim: '#f6ecd4', trimD: '#d9c5a0', fit: '#5a3340', fitL: '#8c4f52', glow: '#ff9440' },
    { name: 'FROST', mark: '#6aa8e8',
      coat: '#3f6fb0', coatL: '#5e93d8', coatD: '#2b4d7d', hat: '#cfe4f2', hatL: '#f4faff',
      trim: '#e8f2fb', trimD: '#bcd0e4', fit: '#2a3a56', fitL: '#4c6a94', glow: '#8fd8ff' },
    { name: 'PINE', mark: '#6ec27a',
      coat: '#3f8a55', coatL: '#5fb073', coatD: '#2b6039', hat: '#c9a24e', hatL: '#e8c471',
      trim: '#eef4e4', trimD: '#c6d0b4', fit: '#2c4434', fitL: '#4e7458', glow: '#9ce87a' },
    { name: 'DUSK', mark: '#a97fd8',
      coat: '#6d4a9c', coatL: '#8f68c4', coatD: '#4b3070', hat: '#d8c46a', hatL: '#f2e08f',
      trim: '#efe6fb', trimD: '#c4b6d8', fit: '#3a2c52', fitL: '#5e4a80', glow: '#d8a8ff' },
  ];
  const teamPlayerPal = (t) => Object.assign({}, PPAL, {
    r: t.coat, R: t.coatL, d: t.coatD, t: t.hat, T: t.hatL, m: t.trim, M: t.trimD,
  });
  const teamBuildPal = (base, t) => Object.assign({}, base, { k: t.fit, K: t.fitL, e: t.glow });
  const teamRobotPal = (t) => Object.assign({}, ROBPAL, { E: t.glow, h: t.coatL, H: t.coat });
  const playerSet = (pal) => ({
    down: [bake(playerDownIdle, pal), bake(playerDownA, pal), bake(playerDownB, pal)],
    up: [bake(playerUpIdle, pal), bake(playerUpA, pal), bake(playerUpB, pal)],
    right: [bake(playerSideIdle, pal), bake(playerSideA, pal), bake(playerSideB, pal)],
    left: [flipH(bake(playerSideIdle, pal)), flipH(bake(playerSideA, pal)), flipH(bake(playerSideB, pal))],
  });
  const TIER_PALS = [WPAL, WPAL_STONE, WPAL_GOLD];
  const teamPlayers = TEAM_SKINS.map((t) => playerSet(teamPlayerPal(t)));
  const teamBuild = TEAM_SKINS.map((t) => ({
    wall: TIER_PALS.map((b) => bake(wall, teamBuildPal(b, t))),
    turret: TIER_PALS.map((b) => bake(turret, teamBuildPal(b, t))),
    generator: TIER_PALS.map((b) => bake(generator, teamBuildPal(b, t))),
    spawner: TIER_PALS.map((b) => bake(spawner, teamBuildPal(b, t))),
  }));
  const teamRobots = TEAM_SKINS.map((t) => [bake(imp1, teamRobotPal(t)), bake(imp2, teamRobotPal(t))]);

  window.SPRITES = {
    teams: TEAM_SKINS,
    playerTeam: teamPlayers,
    teamBuild: teamBuild,
    robotTeam: teamRobots,
    player: teamPlayers[0],
    raider: {
      down: [bake(playerDownIdle, RDPAL), bake(playerDownA, RDPAL), bake(playerDownB, RDPAL)],
      up: [bake(playerUpIdle, RDPAL), bake(playerUpA, RDPAL), bake(playerUpB, RDPAL)],
      right: [bake(playerSideIdle, RDPAL), bake(playerSideA, RDPAL), bake(playerSideB, RDPAL)],
      left: [flipH(bake(playerSideIdle, RDPAL)), flipH(bake(playerSideA, RDPAL)), flipH(bake(playerSideB, RDPAL))],
    },
    tree: [bake(tree1, TPAL), bake(tree2, TPAL)],
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
    deer: {
      right: [bake(deerStand, DEPAL), bake(deerWalkA, DEPAL), bake(deerWalkB, DEPAL)],
      left: [flipH(bake(deerStand, DEPAL)), flipH(bake(deerWalkA, DEPAL)), flipH(bake(deerWalkB, DEPAL))],
    },
    imp: [bake(imp1, IPAL), bake(imp2, IPAL)],
    wall: [bake(wall, WPAL), bake(wall, WPAL_STONE), bake(wall, WPAL_GOLD)],
    turret: [bake(turret, WPAL), bake(turret, WPAL_STONE), bake(turret, WPAL_GOLD)],
    generator: [bake(generator, WPAL), bake(generator, WPAL_STONE), bake(generator, WPAL_GOLD)],
    spawner: [bake(spawner, WPAL), bake(spawner, WPAL_STONE), bake(spawner, WPAL_GOLD)],
    scaffold: [bake(scaffold1, SCPAL), bake(scaffold2, SCPAL), bake(scaffold3, SCPAL)],
    robot: [bake(imp1, ROBPAL), bake(imp2, ROBPAL)],
    spikes: bake(spikes, SPAL),
    fire: [bake(fire1, FPAL), bake(fire2, FPAL), bake(fire3, FPAL)],
    torch: [bake(torch1, TOPAL), bake(torch2, TOPAL)],
    itemWood: bake(itemWood, ITPAL),
    itemStone: bake(itemStone, ITPAL),
    itemBerry: bake(itemBerry, ITPAL),
    itemGold: bake(itemGold, ITPAL),
    itemFish: bake(itemFish, FIPAL),
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

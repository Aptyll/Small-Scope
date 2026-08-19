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

  window.SPRITES = {
    player: {
      down: [bake(playerDownIdle, PPAL), bake(playerDownA, PPAL), bake(playerDownB, PPAL)],
      up: [bake(playerUpIdle, PPAL), bake(playerUpA, PPAL), bake(playerUpB, PPAL)],
      right: [bake(playerSideIdle, PPAL), bake(playerSideA, PPAL), bake(playerSideB, PPAL)],
      left: [flipH(bake(playerSideIdle, PPAL)), flipH(bake(playerSideA, PPAL)), flipH(bake(playerSideB, PPAL))],
    },
    tree: [bake(tree1, TPAL), bake(tree2, TPAL)],
    stump: bake(stump, TPAL),
    rock: [bake(rock1, RPAL), bake(rock2, RPAL)],
    bush: bake(bush, BPAL),
    bushEmpty: bake(bushEmpty, BPAL),
    imp: [bake(imp1, IPAL), bake(imp2, IPAL)],
    wall: bake(wall, WPAL),
    spikes: bake(spikes, SPAL),
    fire: [bake(fire1, FPAL), bake(fire2, FPAL), bake(fire3, FPAL)],
    torch: [bake(torch1, TOPAL), bake(torch2, TOPAL)],
    itemWood: bake(itemWood, ITPAL),
    itemStone: bake(itemStone, ITPAL),
    itemBerry: bake(itemBerry, ITPAL),
    itemAxe: bake(itemAxe, AXPAL),
    heartFull: bake(heartFull, HPAL),
    heartHalf: bake(heartHalf, HEPAL),
    heartEmpty: bake(heartEmpty, HEPAL),
  };
})();

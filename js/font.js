// Tiny 3x5 pixel font. Each glyph is 15 chars, row-major, '1' = pixel on.
(function () {
  const GLYPHS = {
    'A': '010101111101101',
    'B': '110101110101110',
    'C': '011100100100011',
    'D': '110101101101110',
    'E': '111100110100111',
    'F': '111100110100100',
    'G': '011100101101011',
    'H': '101101111101101',
    'I': '111010010010111',
    'J': '001001001101010',
    'K': '101101110101101',
    'L': '100100100100111',
    'M': '101111111101101',
    'N': '111101101101101',
    'O': '010101101101010',
    'P': '110101110100100',
    'Q': '010101101010001',
    'R': '110101110101101',
    'S': '011100010001110',
    'T': '111010010010010',
    'U': '101101101101011',
    'V': '101101101101010',
    'W': '101101111111101',
    'X': '101101010101101',
    'Y': '101101010010010',
    'Z': '111001010100111',
    '0': '111101101101111',
    '1': '010110010010111',
    '2': '110001010100111',
    '3': '110001010001110',
    '4': '101101111001001',
    '5': '111100110001110',
    '6': '011100110101010',
    '7': '111001001010010',
    '8': '111101111101111',
    '9': '010101111001110',
    '-': '000000111000000',
    '+': '000010111010000',
    '.': '000000000000010',
    ',': '000000000010100',
    ':': '000010000010000',
    '!': '010010010000010',
    '?': '110001010000010',
    '/': '001001010100100',
    '(': '010100100100010',
    ')': '010001001001010',
    '<': '001010100010001',
    '>': '100010001010100',
    "'": '010010000000000',
    ' ': '000000000000000',
  };

  // Draws text at integer pixel position. Returns width in px.
  window.drawPixelText = function (ctx, text, x, y, color, scale) {
    scale = scale || 1;
    text = String(text).toUpperCase();
    ctx.fillStyle = color;
    let cx = Math.round(x);
    const cy = Math.round(y);
    for (let i = 0; i < text.length; i++) {
      const g = GLYPHS[text[i]] || GLYPHS['?'];
      for (let p = 0; p < 15; p++) {
        if (g[p] === '1') {
          const gx = p % 3, gy = (p / 3) | 0;
          ctx.fillRect(cx + gx * scale, cy + gy * scale, scale, scale);
        }
      }
      cx += 4 * scale;
    }
    return cx - Math.round(x) - scale; // trailing space removed
  };

  window.pixelTextWidth = function (text, scale) {
    scale = scale || 1;
    return String(text).length * 4 * scale - scale;
  };

  // Text with a 1px drop shadow / outline for readability over the world.
  window.drawPixelTextShadow = function (ctx, text, x, y, color, shadow, scale) {
    scale = scale || 1;
    drawPixelText(ctx, text, x + scale, y + scale, shadow, scale);
    drawPixelText(ctx, text, x, y, color, scale);
  };
})();

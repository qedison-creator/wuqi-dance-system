/**
 * QR Code 生成器 - 基于标准 ISO/IEC 18004
 * 专为微信小程序 Canvas 2D API 优化
 * 支持字节模式编码，纠错等级 M
 */

// ===== GF(256) 运算 =====
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) { return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]; }

// ===== RS 纠错 =====
function rsGenPoly(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    let ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      ng[j] ^= gfMul(g[j], EXP[i]);
      ng[j + 1] ^= g[j];
    }
    g = ng;
  }
  return g;
}

function rsEncode(data, ecLen) {
  const gen = rsGenPoly(ecLen);
  const msg = new Array(data.length + ecLen).fill(0);
  for (let i = 0; i < data.length; i++) msg[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const c = msg[i];
    if (c !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], c);
      }
    }
  }
  return msg.slice(data.length);
}

// ===== QR 版本信息 =====
// [总码字数, [EC块数1, 数据码字数1], [EC块数2, 数据码字数2]]
// 纠错等级 M
const VERSION_INFO = [
  null,
  { total: 26,  ecPerBlock: 10, blocks: [[1, 16]] },                    // v1
  { total: 44,  ecPerBlock: 16, blocks: [[1, 28]] },                    // v2
  { total: 70,  ecPerBlock: 26, blocks: [[1, 44]] },                    // v3
  { total: 100, ecPerBlock: 18, blocks: [[2, 32]] },                    // v4
  { total: 134, ecPerBlock: 24, blocks: [[2, 43]] },                    // v5
  { total: 172, ecPerBlock: 16, blocks: [[4, 27]] },                    // v6
  { total: 196, ecPerBlock: 18, blocks: [[4, 31]] },                    // v7
  { total: 242, ecPerBlock: 22, blocks: [[2, 38], [2, 39]] },          // v8
  { total: 292, ecPerBlock: 22, blocks: [[3, 36], [2, 37]] },          // v9
  { total: 346, ecPerBlock: 26, blocks: [[4, 43], [1, 44]] },          // v10
  { total: 404, ecPerBlock: 30, blocks: [[1, 50], [4, 51]] },          // v11
  { total: 466, ecPerBlock: 22, blocks: [[6, 36], [2, 37]] },          // v12
  { total: 532, ecPerBlock: 22, blocks: [[8, 37], [1, 38]] },          // v13
  { total: 581, ecPerBlock: 24, blocks: [[4, 40], [5, 41]] },          // v14
  { total: 655, ecPerBlock: 24, blocks: [[5, 41], [5, 42]] },          // v15
  { total: 733, ecPerBlock: 28, blocks: [[7, 45], [3, 46]] },          // v16
  { total: 815, ecPerBlock: 28, blocks: [[10, 46], [1, 47]] },         // v17
  { total: 901, ecPerBlock: 26, blocks: [[9, 43], [4, 44]] },          // v18
  { total: 991, ecPerBlock: 26, blocks: [[3, 44], [11, 45]] },         // v19
  { total: 1085, ecPerBlock: 26, blocks: [[3, 41], [13, 42]] },        // v20
];

// 字节模式容量（纠错等级M）
const BYTE_CAPACITY = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666];

function getVersion(dataLen) {
  for (let v = 1; v < BYTE_CAPACITY.length; v++) {
    if (BYTE_CAPACITY[v] >= dataLen) return v;
  }
  return 20;
}

function getModuleCount(v) { return 17 + v * 4; }

// ===== 对齐图案位置 =====
const ALIGN_POS = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
  [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
  [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
];

// ===== 格式信息（纠错M，掩码0-7）=====
const FORMAT_M = [
  101010111010100, 101000011000111, 101111001101010, 101101101111001,
  100010111111001, 100000011101010, 100111101000111, 100101001010100
];

// ===== 版本信息（v7+）=====
const VERSION_BITS = [
  null, null, null, null, null, null,
  0b000111110010010100, 0b001000010110111100, 0b001001101010011001,
  0b001010010011010011, 0b001011101101110110, 0b001100011010100110,
  0b001101100001101100, 0b001110011011110001, 0b001111100101010100,
];

// ===== 编码数据 =====
function encodeData(text, version) {
  const vi = VERSION_INFO[version];
  const dataBytes = [];
  
  // 字节模式指示符: 0100
  let bits = '0100';
  // 字符计数指示符（v1-9: 8位, v10+: 16位）
  const countBits = version <= 9 ? 8 : 16;
  bits += numToBits(text.length, countBits);
  // 数据
  for (let i = 0; i < text.length; i++) {
    bits += numToBits(text.charCodeAt(i), 8);
  }
  // 终止符
  bits += '0000';
  
  // 转字节
  for (let i = 0; i < bits.length; i += 8) {
    const byte = bits.substring(i, i + 8);
    dataBytes.push(parseInt(byte.padEnd(8, '0'), 2));
  }
  
  // 填充到总数据码字数
  const totalDataCodewords = vi.total - vi.ecPerBlock * vi.blocks.reduce((s, b) => s + b[0], 0);
  const padBytes = [0xEC, 0x11];
  let padIdx = 0;
  while (dataBytes.length < totalDataCodewords) {
    dataBytes.push(padBytes[padIdx % 2]);
    padIdx++;
  }
  
  return dataBytes.slice(0, totalDataCodewords);
}

function numToBits(n, len) {
  let s = '';
  for (let i = len - 1; i >= 0; i--) s = ((n >> i) & 1) + s;
  return s;
}

// ===== 生成纠错码和交织 =====
function generateCodewords(dataBytes, version) {
  const vi = VERSION_INFO[version];
  const blocks = [];
  let offset = 0;
  
  for (const [count, dcLen] of vi.blocks) {
    for (let b = 0; b < count; b++) {
      const dc = dataBytes.slice(offset, offset + dcLen);
      const ec = rsEncode(dc, vi.ecPerBlock);
      blocks.push({ data: dc, ec: ec });
      offset += dcLen;
    }
  }
  
  // 交织数据码字
  const result = [];
  const maxDataLen = Math.max(...blocks.map(b => b.data.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of blocks) {
      if (i < block.data.length) result.push(block.data[i]);
    }
  }
  // 交织纠错码字
  for (let i = 0; i < vi.ecPerBlock; i++) {
    for (const block of blocks) {
      result.push(block.ec[i]);
    }
  }
  
  return result;
}

// ===== 生成QR矩阵 =====
function generateMatrix(text) {
  const version = getVersion(text.length);
  const size = getModuleCount(version);
  const matrix = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size)); // 0=free, 1=reserved
  
  // 标记保留区
  function reserve(x, y) { if (x >= 0 && x < size && y >= 0 && y < size) reserved[y][x] = 1; }
  function setModule(x, y, val) { if (x >= 0 && x < size && y >= 0 && y < size) { matrix[y][x] = val; reserved[y][x] = 1; } }
  
  // 1. 定位图案
  function drawFinder(ox, oy) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = ox + dx, y = oy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        if (dy >= 0 && dy <= 6 && dx >= 0 && dx <= 6) {
          if (dy === 0 || dy === 6 || dx === 0 || dx === 6) setModule(x, y, 1);
          else if (dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4) setModule(x, y, 1);
          else setModule(x, y, 0);
        } else {
          setModule(x, y, 0); // 分隔符
        }
      }
    }
  }
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);
  
  // 2. 定时图案
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setModule(i, 6, i % 2 === 0 ? 1 : 0);
    if (!reserved[i][6]) setModule(6, i, i % 2 === 0 ? 1 : 0);
  }
  
  // 3. 对齐图案
  const ap = ALIGN_POS[version] || [];
  for (const ax of ap) {
    for (const ay of ap) {
      // 跳过与定位图案重叠的位置
      if ((ax <= 8 && ay <= 8) || (ax <= 8 && ay >= size - 9) || (ax >= size - 9 && ay <= 8)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const val = (Math.abs(dx) === 2 || Math.abs(dy) === 2 || (dx === 0 && dy === 0)) ? 1 : 0;
          setModule(ax + dx, ay + dy, val);
        }
      }
    }
  }
  
  // 4. 暗模块
  setModule(8, size - 8, 1);
  
  // 5. 预留格式信息区域
  for (let i = 0; i < 8; i++) {
    reserve(i, 8); reserve(8, i);
    reserve(8, size - 1 - i); reserve(size - 1 - i, 8);
  }
  reserve(8, 8);
  
  // 6. 版本信息区域（v7+）
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        reserve(i, size - 11 + j);
        reserve(size - 11 + j, i);
      }
    }
  }
  
  // 7. 编码数据
  const dataBytes = encodeData(text, version);
  const codewords = generateCodewords(dataBytes, version);
  const bitStr = codewords.map(b => numToBits(b, 8)).join('');
  // 补齐到总模块数
  const totalModules = size * size - reserved.flat().reduce((s, v) => s + v, 0);
  const paddedBits = bitStr.padEnd(totalModules, '0');
  
  let bitIdx = 0;
  let dir = -1;
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5; // 跳过定时列
    for (let row = dir === -1 ? size - 1 : 0; dir === -1 ? row >= 0 : row < size; row += dir) {
      for (let dc = 0; dc < 2; dc++) {
        const x = col - dc;
        if (x < 0 || x >= size) continue;
        if (reserved[row][x]) continue;
        matrix[row][x] = bitIdx < paddedBits.length ? parseInt(paddedBits[bitIdx]) : 0;
        bitIdx++;
      }
    }
    dir = -dir;
  }
  
  // 8. 掩码评估和应用（使用掩码0简化）
  const maskIdx = 0;
  const maskFn = (x, y) => (x + y) % 2 === 0;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (reserved[y][x]) continue;
      if (maskFn(x, y)) matrix[y][x] ^= 1;
    }
  }
  
  // 9. 写入格式信息
  const fmt = FORMAT_M[maskIdx];
  const fmtBits = numToBits(fmt, 15);
  // 水平（左上定位图案旁）
  const hPos = [0,1,2,3,4,5,7,8, size-8,size-7,size-6,size-5,size-4,size-3,size-2];
  for (let i = 0; i < 15; i++) {
    matrix[8][hPos[i]] = parseInt(fmtBits[i]);
  }
  // 垂直
  const vPos = [size-1,size-2,size-3,size-4,size-5,size-6,size-7,8,7,5,4,3,2,1,0];
  for (let i = 0; i < 15; i++) {
    matrix[vPos[i]][8] = parseInt(fmtBits[i]);
  }
  
  // 10. 版本信息（v7+）
  if (version >= 7 && VERSION_BITS[version] !== undefined) {
    const vBits = numToBits(VERSION_BITS[version], 18);
    for (let i = 0; i < 18; i++) {
      const bit = parseInt(vBits[i]);
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      matrix[r][c] = bit;
      matrix[c][r] = bit;
    }
  }
  
  return { matrix, size };
}

// ===== 绘制到 Canvas 2D Context =====
function drawQRToCanvas(ctx, text, canvasWidth, canvasHeight, options = {}) {
  const { matrix, size } = generateMatrix(text);
  const padding = Math.floor(Math.min(canvasWidth, canvasHeight) * 0.08);
  const drawW = canvasWidth - padding * 2;
  const drawH = canvasHeight - padding * 2;
  const cellW = drawW / size;
  const cellH = drawH / size;
  
  // 白色背景
  ctx.fillStyle = options.bgColor || '#FFFFFF';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  
  // 绘制模块
  ctx.fillStyle = options.darkColor || '#2A2122';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix[y][x] === 1) {
        ctx.fillRect(
          padding + x * cellW,
          padding + y * cellH,
          Math.ceil(cellW),
          Math.ceil(cellH)
        );
      }
    }
  }
}

module.exports = { generateMatrix, drawQRToCanvas };

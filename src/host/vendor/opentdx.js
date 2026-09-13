// src/transport/connection.ts
import net from "net";
import zlib from "zlib";

// src/const/protocol.ts
var RESPONSE_HEADER_SIZE = 16;
var CONNECT_TIMEOUT_MS = 5e3;
var SEND_TIMEOUT_MS = 15e3;
var DEFAULT_HEARTBEAT_INTERVAL_MS = 15e3;
var MAX_CONSECUTIVE_HEARTBEAT = 20;

// src/errors.ts
var TdxErrorCode = /* @__PURE__ */ ((TdxErrorCode2) => {
  TdxErrorCode2["NOT_CONNECTED"] = "NOT_CONNECTED";
  TdxErrorCode2["CONNECTION_TIMEOUT"] = "CONNECTION_TIMEOUT";
  TdxErrorCode2["CONNECTION_ERROR"] = "CONNECTION_ERROR";
  TdxErrorCode2["SEND_ERROR"] = "SEND_ERROR";
  TdxErrorCode2["SEND_TIMEOUT"] = "SEND_TIMEOUT";
  TdxErrorCode2["RECEIVE_ERROR"] = "RECEIVE_ERROR";
  TdxErrorCode2["AUTO_RETRY_EXHAUSTED"] = "AUTO_RETRY_EXHAUSTED";
  TdxErrorCode2["NO_AVAILABLE_SERVER"] = "NO_AVAILABLE_SERVER";
  TdxErrorCode2["PARSE_ERROR"] = "PARSE_ERROR";
  TdxErrorCode2["DISCONNECT_ERROR"] = "DISCONNECT_ERROR";
  return TdxErrorCode2;
})(TdxErrorCode || {});
var TdxError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "TdxError";
  }
  code;
};

// src/transport/connection.ts
var TdxConnection = class {
  socket = null;
  _connected = false;
  customizeCounter = 0;
  pending = /* @__PURE__ */ new Map();
  get isConnected() {
    return this._connected;
  }
  async connect(ip, port, timeoutMs = CONNECT_TIMEOUT_MS) {
    return new Promise((resolve2, reject) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => {
        socket.setTimeout(0);
        this.socket = socket;
        this._connected = true;
        this.setupDataListener(socket);
        resolve2();
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(new TdxError(`Connection timeout to ${ip}:${port}`, "CONNECTION_TIMEOUT" /* CONNECTION_TIMEOUT */));
      });
      socket.once("error", (err) => {
        socket.destroy();
        reject(new TdxError(`Connection error to ${ip}:${port}: ${err.message}`, "CONNECTION_ERROR" /* CONNECTION_ERROR */));
      });
      socket.connect(port, ip);
    });
  }
  disconnect() {
    const err = new TdxError("Disconnected", "DISCONNECT_ERROR" /* DISCONNECT_ERROR */);
    this._connected = false;
    for (const [, { reject }] of this.pending) reject(err);
    this.pending.clear();
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
      }
      this.socket = null;
    }
  }
  async send(data, timeoutMs = SEND_TIMEOUT_MS) {
    if (!this._connected || !this.socket) {
      throw new TdxError("Not connected", "NOT_CONNECTED" /* NOT_CONNECTED */);
    }
    const cid = ++this.customizeCounter;
    const buf = Buffer.from(data);
    buf.writeUInt32LE(cid, 1);
    return new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cid);
        reject(new TdxError(`Send timeout after ${timeoutMs}ms`, "SEND_TIMEOUT" /* SEND_TIMEOUT */));
      }, timeoutMs);
      this.pending.set(cid, {
        resolve: (data2) => {
          clearTimeout(timer);
          resolve2(data2);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
      const sent = this.socket.write(buf, (writeErr) => {
        if (writeErr) {
          this.pending.delete(cid);
          clearTimeout(timer);
          this._connected = false;
          reject(new TdxError(`Send error: ${writeErr.message}`, "SEND_ERROR" /* SEND_ERROR */));
        }
      });
      if (!sent) {
        this.pending.delete(cid);
        clearTimeout(timer);
        this._connected = false;
        reject(new TdxError("Send buffer full", "SEND_ERROR" /* SEND_ERROR */));
      }
    });
  }
  setupDataListener(socket) {
    let buf = Buffer.alloc(0);
    const failAll = (err) => {
      for (const [, { reject }] of this.pending) reject(err);
      this.pending.clear();
      this._connected = false;
    };
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= RESPONSE_HEADER_SIZE) {
        const customize = buf.readUInt32LE(5);
        const zipSize = buf.readUInt16LE(12);
        const unzipSize = buf.readUInt16LE(14);
        if (buf.length < RESPONSE_HEADER_SIZE + zipSize) break;
        const bodyRaw = buf.subarray(RESPONSE_HEADER_SIZE, RESPONSE_HEADER_SIZE + zipSize);
        buf = buf.subarray(RESPONSE_HEADER_SIZE + zipSize);
        let body;
        if (zipSize !== unzipSize && zipSize > 0) {
          body = zlib.inflateSync(bodyRaw);
        } else {
          body = Buffer.from(bodyRaw);
        }
        const entry = this.pending.get(customize);
        if (entry) {
          this.pending.delete(customize);
          entry.resolve(body);
        }
      }
    });
    socket.on("error", (err) => failAll(err instanceof Error ? err : new Error(String(err))));
    socket.on("close", () => failAll(new TdxError("Connection closed", "DISCONNECT_ERROR" /* DISCONNECT_ERROR */)));
  }
};

// src/transport/heartbeat.ts
var HeartbeatManager = class {
  constructor(heartbeatFn, onDisconnect, intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, maxConsecutive = MAX_CONSECUTIVE_HEARTBEAT) {
    this.heartbeatFn = heartbeatFn;
    this.onDisconnect = onDisconnect;
    this.intervalMs = intervalMs;
    this.maxConsecutive = maxConsecutive;
  }
  heartbeatFn;
  onDisconnect;
  intervalMs;
  maxConsecutive;
  interval = null;
  lastAckTime = Date.now();
  consecutiveCount = 0;
  stopped = false;
  start() {
    this.stopped = false;
    this.lastAckTime = Date.now();
    this.consecutiveCount = 0;
    this.interval = setInterval(() => {
      if (this.stopped) return;
      if (Date.now() - this.lastAckTime <= this.intervalMs) return;
      this.consecutiveCount++;
      if (this.consecutiveCount >= this.maxConsecutive) {
        this.stop();
        this.onDisconnect();
        return;
      }
      this.heartbeatFn().catch(() => {
      });
    }, this.intervalMs);
  }
  stop() {
    this.stopped = true;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
  ack() {
    this.lastAckTime = Date.now();
    this.consecutiveCount = 0;
  }
};

// src/transport/retry.ts
var DefaultRetryStrategy = class {
  *gen() {
    yield 0.1;
    yield 0.5;
    yield 1;
    yield 2;
  }
};

// src/client/base-client.ts
var HOST_SELECT_TTL_MS = 3e5;
var hostSelectCache = /* @__PURE__ */ new Map();
var BaseClient = class {
  connection;
  heartbeatManager = null;
  hosts;
  defaultPort;
  _heartbeat = false;
  _autoRetry = false;
  _raiseException = false;
  retryStrategy = new DefaultRetryStrategy();
  _customConnection = false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _doHeartbeat;
  constructor(hosts, defaultPort, options) {
    const {
      heartbeat = false,
      autoRetry = false,
      raiseException = false
    } = options ?? {};
    this.hosts = hosts;
    this.defaultPort = defaultPort;
    this._heartbeat = heartbeat;
    this._autoRetry = autoRetry;
    this._raiseException = raiseException;
    this.connection = new TdxConnection();
  }
  setConnection(conn) {
    this._customConnection = true;
    this.connection = conn;
  }
  get ip() {
    return "";
  }
  get port() {
    return this.defaultPort;
  }
  get isConnected() {
    return this.connection.isConnected;
  }
  get heartbeat() {
    return this._heartbeat;
  }
  get autoRetry() {
    return this._autoRetry;
  }
  set autoRetry(value) {
    this._autoRetry = value;
  }
  get raiseException() {
    return this._raiseException;
  }
  set raiseException(value) {
    this._raiseException = value;
  }
  async connect(options) {
    const ip = options?.ip;
    const port = options?.port ?? this.defaultPort;
    const timeoutMs = options?.timeoutMs ?? CONNECT_TIMEOUT_MS;
    if (this._customConnection) {
      await this.connection.connect(ip ?? "", port, timeoutMs);
    } else if (ip) {
      await this.connection.connect(ip, port, timeoutMs);
    } else {
      const server = await this._pickServer(timeoutMs);
      await this.connection.connect(server.ip, server.port, timeoutMs);
    }
    if (this._heartbeat && this._doHeartbeat) {
      this.heartbeatManager = new HeartbeatManager(
        () => this._doHeartbeat(),
        () => this.disconnect()
      );
      this.heartbeatManager.start();
    }
    return this;
  }
  async disconnect() {
    this.heartbeatManager?.stop();
    this.heartbeatManager = null;
    this.connection.disconnect();
  }
  async call(parser) {
    const data = parser.serialize();
    const resp = await this.connection.send(data);
    return parser.deserialize(resp);
  }
  async _withRetry(fn) {
    if (!this._autoRetry) return fn();
    try {
      return await fn();
    } catch {
      for (const delay of this.retryStrategy.gen()) {
        await new Promise((r) => setTimeout(r, delay * 1e3));
        this.heartbeatManager?.stop();
        this.connection.disconnect();
        try {
          await this.connect();
          const result = await fn();
          return result;
        } catch {
        }
      }
      if (this._raiseException) {
        throw new TdxError("Auto retry exhausted", "AUTO_RETRY_EXHAUSTED" /* AUTO_RETRY_EXHAUSTED */);
      }
      throw new TdxError("Auto retry exhausted", "AUTO_RETRY_EXHAUSTED" /* AUTO_RETRY_EXHAUSTED */);
    }
  }
  async _pickServer(timeoutMs) {
    const cacheKey = this.hosts.map((h) => `${h.ip}:${h.port}`).join(",");
    const cached = hostSelectCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < HOST_SELECT_TTL_MS) return cached.host;
    const results = [];
    const probeTimeout = Math.min(timeoutMs, 2e3);
    await Promise.allSettled(
      this.hosts.map(async (host) => {
        const start = Date.now();
        const conn = new TdxConnection();
        try {
          await conn.connect(host.ip, host.port, probeTimeout);
          results.push({ host, latency: Date.now() - start });
        } catch {
        } finally {
          conn.disconnect();
        }
      })
    );
    results.sort((a, b) => a.latency - b.latency);
    if (results.length === 0) {
      throw new TdxError("No available server", "NO_AVAILABLE_SERVER" /* NO_AVAILABLE_SERVER */);
    }
    const best = results[0].host;
    hostSelectCache.set(cacheKey, { ts: Date.now(), host: best });
    return best;
  }
};

// src/utils/gbk.ts
import iconv from "iconv-lite";
function encodeGBK(str, width) {
  const encoded = iconv.encode(str, "gbk");
  const result = Buffer.alloc(width, 0);
  encoded.copy(result, 0, 0, Math.min(encoded.length, width));
  return result;
}
function decodeGBK(buf) {
  let end = buf.length;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      end = i;
      break;
    }
  }
  return iconv.decode(buf.subarray(0, end), "gbk");
}

// src/utils/buffer.ts
var BufferReader = class {
  constructor(buf, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }
  buf;
  pos;
  get position() {
    return this.pos;
  }
  set position(v) {
    this.pos = v;
  }
  get remaining() {
    return this.buf.length - this.pos;
  }
  readUInt8() {
    const v = this.buf.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }
  readInt8() {
    const v = this.buf.readInt8(this.pos);
    this.pos += 1;
    return v;
  }
  readUInt16LE() {
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  readInt16LE() {
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  readUInt32LE() {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  readInt32LE() {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  readFloatLE() {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }
  readBytes(n) {
    const v = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return Buffer.from(v);
  }
  readStringGBK(n) {
    const raw = this.readBytes(n);
    return decodeGBK(raw);
  }
  skip(n) {
    this.pos += n;
    return this;
  }
};
var BufferWriter = class {
  chunks = [];
  len = 0;
  writeUInt8(v) {
    const b = Buffer.alloc(1);
    b.writeUInt8(v, 0);
    this.chunks.push(b);
    this.len += 1;
    return this;
  }
  writeInt8(v) {
    const b = Buffer.alloc(1);
    b.writeInt8(v, 0);
    this.chunks.push(b);
    this.len += 1;
    return this;
  }
  writeUInt16LE(v) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v, 0);
    this.chunks.push(b);
    this.len += 2;
    return this;
  }
  writeInt16LE(v) {
    const b = Buffer.alloc(2);
    b.writeInt16LE(v, 0);
    this.chunks.push(b);
    this.len += 2;
    return this;
  }
  writeUInt32LE(v) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v, 0);
    this.chunks.push(b);
    this.len += 4;
    return this;
  }
  writeInt32LE(v) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v, 0);
    this.chunks.push(b);
    this.len += 4;
    return this;
  }
  writeFloatLE(v) {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v, 0);
    this.chunks.push(b);
    this.len += 4;
    return this;
  }
  writeBytes(data) {
    const b = Buffer.from(data);
    this.chunks.push(b);
    this.len += b.length;
    return this;
  }
  writeStringGBK(str, width) {
    this.chunks.push(encodeGBK(str, width));
    this.len += width;
    return this;
  }
  skip(n) {
    this.chunks.push(Buffer.alloc(n, 0));
    this.len += n;
    return this;
  }
  get length() {
    return this.len;
  }
  toBuffer() {
    return Buffer.concat(this.chunks);
  }
};

// src/parser/base.ts
var BaseParser = class {
  msgId;
  head;
  customize = 0;
  needZip = false;
  body = Buffer.alloc(0);
  constructor(msgId, head = 12) {
    this.msgId = msgId;
    this.head = head;
  }
  serialize() {
    const w = new BufferWriter();
    w.writeUInt16LE(this.msgId);
    w.writeBytes(this.body);
    const bodyBuf = w.toBuffer();
    const headFlag = this.head === 12 && this.needZip ? 28 : this.head;
    const hw = new BufferWriter();
    hw.writeUInt8(headFlag);
    hw.writeUInt32LE(this.customize);
    hw.writeUInt8(1);
    hw.writeUInt16LE(bodyBuf.length);
    hw.writeUInt16LE(bodyBuf.length);
    return Buffer.concat([hw.toBuffer(), bodyBuf]);
  }
};

// src/enums/market.ts
var Market = /* @__PURE__ */ ((Market2) => {
  Market2[Market2["SZ"] = 0] = "SZ";
  Market2[Market2["SH"] = 1] = "SH";
  Market2[Market2["BJ"] = 2] = "BJ";
  return Market2;
})(Market || {});
var ExMarket = /* @__PURE__ */ ((ExMarket2) => {
  ExMarket2[ExMarket2["TEMP_STOCK"] = 1] = "TEMP_STOCK";
  ExMarket2[ExMarket2["ZZ_FUTURES_OPTION"] = 4] = "ZZ_FUTURES_OPTION";
  ExMarket2[ExMarket2["DL_FUTURES_OPTION"] = 5] = "DL_FUTURES_OPTION";
  ExMarket2[ExMarket2["SH_FUTURES_OPTION"] = 6] = "SH_FUTURES_OPTION";
  ExMarket2[ExMarket2["CFFEX_OPTION"] = 7] = "CFFEX_OPTION";
  ExMarket2[ExMarket2["SH_STOCK_OPTION"] = 8] = "SH_STOCK_OPTION";
  ExMarket2[ExMarket2["SZ_STOCK_OPTION"] = 9] = "SZ_STOCK_OPTION";
  ExMarket2[ExMarket2["BASIC_FX"] = 10] = "BASIC_FX";
  ExMarket2[ExMarket2["CROSS_FX"] = 11] = "CROSS_FX";
  ExMarket2[ExMarket2["INTL_INDEX"] = 12] = "INTL_INDEX";
  ExMarket2[ExMarket2["COMEX_FUTURES"] = 16] = "COMEX_FUTURES";
  ExMarket2[ExMarket2["NYMEX_FUTURES"] = 17] = "NYMEX_FUTURES";
  ExMarket2[ExMarket2["CBOT_FUTURES"] = 18] = "CBOT_FUTURES";
  ExMarket2[ExMarket2["HK_FINANCIAL_FUTURES"] = 23] = "HK_FINANCIAL_FUTURES";
  ExMarket2[ExMarket2["HK_FINANCIAL_OPTIONS"] = 24] = "HK_FINANCIAL_OPTIONS";
  ExMarket2[ExMarket2["HK_STOCK_FUTURES"] = 25] = "HK_STOCK_FUTURES";
  ExMarket2[ExMarket2["HK_STOCK_OPTIONS"] = 26] = "HK_STOCK_OPTIONS";
  ExMarket2[ExMarket2["HK_INDEX"] = 27] = "HK_INDEX";
  ExMarket2[ExMarket2["ZZ_FUTURES"] = 28] = "ZZ_FUTURES";
  ExMarket2[ExMarket2["DL_FUTURES"] = 29] = "DL_FUTURES";
  ExMarket2[ExMarket2["SH_FUTURES"] = 30] = "SH_FUTURES";
  ExMarket2[ExMarket2["HK_MAIN_BOARD"] = 31] = "HK_MAIN_BOARD";
  ExMarket2[ExMarket2["OPEN_END_FUND"] = 33] = "OPEN_END_FUND";
  ExMarket2[ExMarket2["MONETARY_FUND"] = 34] = "MONETARY_FUND";
  ExMarket2[ExMarket2["MACRO_INDICATOR"] = 38] = "MACRO_INDICATOR";
  ExMarket2[ExMarket2["FUTURES_INDEX"] = 42] = "FUTURES_INDEX";
  ExMarket2[ExMarket2["B_TO_H"] = 43] = "B_TO_H";
  ExMarket2[ExMarket2["NEEQ"] = 44] = "NEEQ";
  ExMarket2[ExMarket2["SH_GOLD"] = 46] = "SH_GOLD";
  ExMarket2[ExMarket2["CFFEX_FUTURES"] = 47] = "CFFEX_FUTURES";
  ExMarket2[ExMarket2["HK_GEM"] = 48] = "HK_GEM";
  ExMarket2[ExMarket2["HK_FUND"] = 49] = "HK_FUND";
  ExMarket2[ExMarket2["TREASURY_VALUATION"] = 54] = "TREASURY_VALUATION";
  ExMarket2[ExMarket2["SUNSHINE_PRIVATE_FUND"] = 56] = "SUNSHINE_PRIVATE_FUND";
  ExMarket2[ExMarket2["BROKER_COLLECTIVE_FINANCE"] = 57] = "BROKER_COLLECTIVE_FINANCE";
  ExMarket2[ExMarket2["BROKER_MONETARY_FINANCE"] = 58] = "BROKER_MONETARY_FINANCE";
  ExMarket2[ExMarket2["MAIN_FUTURES_CONTRACT"] = 60] = "MAIN_FUTURES_CONTRACT";
  ExMarket2[ExMarket2["CSI_INDEX"] = 62] = "CSI_INDEX";
  ExMarket2[ExMarket2["GZ_ARBITRAGE_FUTURES"] = 65] = "GZ_ARBITRAGE_FUTURES";
  ExMarket2[ExMarket2["GZ_FUTURES"] = 66] = "GZ_FUTURES";
  ExMarket2[ExMarket2["GZ_OPTIONS"] = 67] = "GZ_OPTIONS";
  ExMarket2[ExMarket2["RISK_CONTROL_INDEX"] = 68] = "RISK_CONTROL_INDEX";
  ExMarket2[ExMarket2["HUAZHENG_INDEX"] = 69] = "HUAZHENG_INDEX";
  ExMarket2[ExMarket2["EXTENDED_SECTOR_INDEX"] = 70] = "EXTENDED_SECTOR_INDEX";
  ExMarket2[ExMarket2["HK_STOCK_GGT"] = 71] = "HK_STOCK_GGT";
  ExMarket2[ExMarket2["GE_STOCK"] = 73] = "GE_STOCK";
  ExMarket2[ExMarket2["US_STOCK"] = 74] = "US_STOCK";
  ExMarket2[ExMarket2["SG_STOCK"] = 78] = "SG_STOCK";
  ExMarket2[ExMarket2["MONEY_MARKET"] = 91] = "MONEY_MARKET";
  ExMarket2[ExMarket2["FUND_VALUATION"] = 93] = "FUND_VALUATION";
  ExMarket2[ExMarket2["HK_DARK_POOL"] = 98] = "HK_DARK_POOL";
  ExMarket2[ExMarket2["CODE_MIRROR"] = 100] = "CODE_MIRROR";
  ExMarket2[ExMarket2["SZSE_INDEX"] = 102] = "SZSE_INDEX";
  return ExMarket2;
})(ExMarket || {});
var ExCategory = {
  HK: { code: 31, displayName: "\u9999\u6E2F\u4E3B\u677F" },
  HK_GEM: { code: 48, displayName: "\u9999\u6E2F\u521B\u4E1A\u677F" },
  GGT: { code: 71, displayName: "\u6E2F\u80A1\u901A" },
  US: { code: 74, displayName: "\u7F8E\u80A1" },
  HSI: { code: 12001, displayName: "\u6052\u6307\u6210\u5206\u80A1" },
  HSHC: { code: 12002, displayName: "\u6052\u751F\u7EA2\u7B79" },
  HSGQ: { code: 12004, displayName: "\u6052\u751F\u56FD\u4F01" },
  HSGZ: { code: 12007, displayName: "\u6052\u751F\u56FD\u6307" },
  HSKJ: { code: 12012, displayName: "\u6052\u751F\u79D1\u6280" },
  USZGG: { code: 13001, displayName: "\u7F8E\u80A1\u4E2D\u6982\u80A1" },
  USZM: { code: 13002, displayName: "\u77E5\u540D\u7F8E\u80A1" }
};

// src/enums/period.ts
var Period = /* @__PURE__ */ ((Period2) => {
  Period2[Period2["MIN_5"] = 0] = "MIN_5";
  Period2[Period2["MIN_15"] = 1] = "MIN_15";
  Period2[Period2["MIN_30"] = 2] = "MIN_30";
  Period2[Period2["MIN_60"] = 3] = "MIN_60";
  Period2[Period2["DAILY"] = 4] = "DAILY";
  Period2[Period2["WEEKLY"] = 5] = "WEEKLY";
  Period2[Period2["MONTHLY"] = 6] = "MONTHLY";
  Period2[Period2["MIN_1"] = 7] = "MIN_1";
  Period2[Period2["MINS"] = 8] = "MINS";
  Period2[Period2["DAYS"] = 9] = "DAYS";
  Period2[Period2["QUARTERLY"] = 10] = "QUARTERLY";
  Period2[Period2["YEARLY"] = 11] = "YEARLY";
  Period2[Period2["SECONDS"] = 13] = "SECONDS";
  return Period2;
})(Period || {});

// src/enums/adjust.ts
var Adjust = /* @__PURE__ */ ((Adjust2) => {
  Adjust2[Adjust2["NONE"] = 0] = "NONE";
  Adjust2[Adjust2["QFQ"] = 1] = "QFQ";
  Adjust2[Adjust2["HFQ"] = 2] = "HFQ";
  return Adjust2;
})(Adjust || {});

// src/enums/category.ts
var Category = /* @__PURE__ */ ((Category2) => {
  Category2[Category2["SH"] = 0] = "SH";
  Category2[Category2["SZ"] = 2] = "SZ";
  Category2[Category2["A"] = 6] = "A";
  Category2[Category2["B"] = 7] = "B";
  Category2[Category2["KCB"] = 8] = "KCB";
  Category2[Category2["BJ"] = 12] = "BJ";
  Category2[Category2["CYB"] = 14] = "CYB";
  Category2[Category2["BOARD_ALL"] = 1e4] = "BOARD_ALL";
  Category2[Category2["BOARD_HY"] = 10001] = "BOARD_HY";
  Category2[Category2["BOARD_HY2"] = 10002] = "BOARD_HY2";
  Category2[Category2["BOARD_GN"] = 10004] = "BOARD_GN";
  Category2[Category2["BOARD_FG"] = 10005] = "BOARD_FG";
  Category2[Category2["BOARD_DQ"] = 10006] = "BOARD_DQ";
  Category2[Category2["BOARD_OTHER"] = 10007] = "BOARD_OTHER";
  Category2[Category2["BOARD_YJ_LEVEL1"] = 10008] = "BOARD_YJ_LEVEL1";
  Category2[Category2["BOARD_YJ_LEVEL2"] = 10009] = "BOARD_YJ_LEVEL2";
  Category2[Category2["BOARD_YJ_LEVEL3"] = 10010] = "BOARD_YJ_LEVEL3";
  Category2[Category2["HGT"] = 11001] = "HGT";
  Category2[Category2["SGT"] = 11009] = "SGT";
  Category2[Category2["FXJS"] = 11007] = "FXJS";
  Category2[Category2["ETF"] = 11005] = "ETF";
  Category2[Category2["LOF"] = 11012] = "LOF";
  Category2[Category2["ZS"] = 11052] = "ZS";
  return Category2;
})(Category || {});
var FilterType = /* @__PURE__ */ ((FilterType2) => {
  FilterType2[FilterType2["NEW"] = 1] = "NEW";
  FilterType2[FilterType2["KC"] = 2] = "KC";
  FilterType2[FilterType2["ST"] = 4] = "ST";
  FilterType2[FilterType2["CY"] = 8] = "CY";
  FilterType2[FilterType2["BJ"] = 16] = "BJ";
  return FilterType2;
})(FilterType || {});

// src/enums/sort.ts
var SortType = /* @__PURE__ */ ((SortType2) => {
  SortType2[SortType2["CODE"] = 0] = "CODE";
  SortType2[SortType2["NAME"] = 1] = "NAME";
  SortType2[SortType2["PRE_CLOSE"] = 2] = "PRE_CLOSE";
  SortType2[SortType2["OPEN"] = 3] = "OPEN";
  SortType2[SortType2["HIGH"] = 4] = "HIGH";
  SortType2[SortType2["LOW"] = 5] = "LOW";
  SortType2[SortType2["PRICE"] = 6] = "PRICE";
  SortType2[SortType2["BID"] = 7] = "BID";
  SortType2[SortType2["ASK"] = 8] = "ASK";
  SortType2[SortType2["VOLUME"] = 9] = "VOLUME";
  SortType2[SortType2["TOTAL_AMOUNT"] = 10] = "TOTAL_AMOUNT";
  SortType2[SortType2["LAST_VOLUME"] = 11] = "LAST_VOLUME";
  SortType2[SortType2["CHANGE"] = 12] = "CHANGE";
  SortType2[SortType2["CHANGE_PCT"] = 14] = "CHANGE_PCT";
  SortType2[SortType2["AMPLITUDE_PCT"] = 15] = "AMPLITUDE_PCT";
  SortType2[SortType2["AVG"] = 16] = "AVG";
  SortType2[SortType2["PE_DYNAMIC"] = 17] = "PE_DYNAMIC";
  SortType2[SortType2["ENTRUST_RATIO"] = 18] = "ENTRUST_RATIO";
  SortType2[SortType2["INSIDE_VOLUME"] = 19] = "INSIDE_VOLUME";
  SortType2[SortType2["OUTSIDE_VOLUME"] = 20] = "OUTSIDE_VOLUME";
  SortType2[SortType2["IN_OUT_RATIO"] = 21] = "IN_OUT_RATIO";
  SortType2[SortType2["BID_VOLUME"] = 23] = "BID_VOLUME";
  SortType2[SortType2["ASK_VOLUME"] = 24] = "ASK_VOLUME";
  SortType2[SortType2["LOCKED_RATIO"] = 27] = "LOCKED_RATIO";
  SortType2[SortType2["LOCKED_AMOUNT"] = 28] = "LOCKED_AMOUNT";
  SortType2[SortType2["OPEN_AMOUNT"] = 29] = "OPEN_AMOUNT";
  SortType2[SortType2["OPEN_TURNOVER_PCT"] = 30] = "OPEN_TURNOVER_PCT";
  SortType2[SortType2["VOL_RATIO"] = 35] = "VOL_RATIO";
  SortType2[SortType2["TURNOVER_RATE"] = 36] = "TURNOVER_RATE";
  SortType2[SortType2["FLOAT_SHARES"] = 37] = "FLOAT_SHARES";
  SortType2[SortType2["FLOAT_MARKET_CAP"] = 38] = "FLOAT_MARKET_CAP";
  SortType2[SortType2["TOTAL_MARKET_CAP_AB"] = 39] = "TOTAL_MARKET_CAP_AB";
  SortType2[SortType2["UNMATCHED_VOLUME"] = 42] = "UNMATCHED_VOLUME";
  SortType2[SortType2["STRENGTH_PCT"] = 45] = "STRENGTH_PCT";
  SortType2[SortType2["SPEED_PCT"] = 46] = "SPEED_PCT";
  SortType2[SortType2["ACTIVITY"] = 47] = "ACTIVITY";
  SortType2[SortType2["SHORT_TURNOVER_PCT"] = 204] = "SHORT_TURNOVER_PCT";
  SortType2[SortType2["VOL_SPEED_PCT"] = 208] = "VOL_SPEED_PCT";
  SortType2[SortType2["MAIN_NET_AMOUNT"] = 212] = "MAIN_NET_AMOUNT";
  SortType2[SortType2["MAIN_NET_RATIO"] = 215] = "MAIN_NET_RATIO";
  SortType2[SortType2["AUCTION_LIMIT_BUY"] = 258] = "AUCTION_LIMIT_BUY";
  SortType2[SortType2["AMOUNT_2M"] = 268] = "AMOUNT_2M";
  SortType2[SortType2["OPEN_SNATCH_PCT"] = 266] = "OPEN_SNATCH_PCT";
  SortType2[SortType2["OPEN_PCT"] = 281] = "OPEN_PCT";
  SortType2[SortType2["HIGH_PCT"] = 282] = "HIGH_PCT";
  SortType2[SortType2["LOW_PCT"] = 283] = "LOW_PCT";
  SortType2[SortType2["AVG_CHANGE_PCT"] = 284] = "AVG_CHANGE_PCT";
  SortType2[SortType2["DRAWDOWN_PCT"] = 286] = "DRAWDOWN_PCT";
  SortType2[SortType2["ATTACK_PCT"] = 287] = "ATTACK_PCT";
  return SortType2;
})(SortType || {});
var SortOrder = /* @__PURE__ */ ((SortOrder2) => {
  SortOrder2[SortOrder2["NONE"] = 0] = "NONE";
  SortOrder2[SortOrder2["DESC"] = 1] = "DESC";
  SortOrder2[SortOrder2["ASC"] = 2] = "ASC";
  return SortOrder2;
})(SortOrder || {});
var BoardType = /* @__PURE__ */ ((BoardType2) => {
  BoardType2[BoardType2["HY"] = 0] = "HY";
  BoardType2[BoardType2["HY2"] = 1] = "HY2";
  BoardType2[BoardType2["GN"] = 3] = "GN";
  BoardType2[BoardType2["FG"] = 4] = "FG";
  BoardType2[BoardType2["DQ"] = 5] = "DQ";
  BoardType2[BoardType2["OTHER"] = 6] = "OTHER";
  BoardType2[BoardType2["YJ_LEVEL1"] = 7] = "YJ_LEVEL1";
  BoardType2[BoardType2["YJ_LEVEL2"] = 8] = "YJ_LEVEL2";
  BoardType2[BoardType2["YJ_LEVEL3"] = 9] = "YJ_LEVEL3";
  BoardType2[BoardType2["ALL"] = 255] = "ALL";
  return BoardType2;
})(BoardType || {});
var ExBoardType = /* @__PURE__ */ ((ExBoardType2) => {
  ExBoardType2[ExBoardType2["HK_ALL"] = 0] = "HK_ALL";
  ExBoardType2[ExBoardType2["HK_GN"] = 1] = "HK_GN";
  ExBoardType2[ExBoardType2["HK_HY"] = 2] = "HK_HY";
  ExBoardType2[ExBoardType2["US_ALL"] = 3] = "US_ALL";
  ExBoardType2[ExBoardType2["US_GN"] = 4] = "US_GN";
  ExBoardType2[ExBoardType2["US_HY"] = 5] = "US_HY";
  return ExBoardType2;
})(ExBoardType || {});

// src/utils/bitmap.ts
var FieldBit = /* @__PURE__ */ ((FieldBit2) => {
  FieldBit2[FieldBit2["PRE_CLOSE"] = 0] = "PRE_CLOSE";
  FieldBit2[FieldBit2["OPEN"] = 1] = "OPEN";
  FieldBit2[FieldBit2["HIGH"] = 2] = "HIGH";
  FieldBit2[FieldBit2["LOW"] = 3] = "LOW";
  FieldBit2[FieldBit2["CLOSE"] = 4] = "CLOSE";
  FieldBit2[FieldBit2["VOL"] = 5] = "VOL";
  FieldBit2[FieldBit2["VOL_RATIO"] = 6] = "VOL_RATIO";
  FieldBit2[FieldBit2["AMOUNT"] = 7] = "AMOUNT";
  FieldBit2[FieldBit2["INSIDE_VOLUME"] = 8] = "INSIDE_VOLUME";
  FieldBit2[FieldBit2["OUTSIDE_VOLUME"] = 9] = "OUTSIDE_VOLUME";
  FieldBit2[FieldBit2["TOTAL_SHARES"] = 10] = "TOTAL_SHARES";
  FieldBit2[FieldBit2["FLOAT_SHARES"] = 11] = "FLOAT_SHARES";
  FieldBit2[FieldBit2["EPS"] = 12] = "EPS";
  FieldBit2[FieldBit2["NET_ASSETS"] = 13] = "NET_ASSETS";
  FieldBit2[FieldBit2["SECURITY_TYPE_PRICE"] = 14] = "SECURITY_TYPE_PRICE";
  FieldBit2[FieldBit2["TOTAL_MARKET_CAP_AB"] = 15] = "TOTAL_MARKET_CAP_AB";
  FieldBit2[FieldBit2["PE_DYNAMIC"] = 16] = "PE_DYNAMIC";
  FieldBit2[FieldBit2["BID_PRICE"] = 17] = "BID_PRICE";
  FieldBit2[FieldBit2["ASK_PRICE"] = 18] = "ASK_PRICE";
  FieldBit2[FieldBit2["SERVER_UPDATE_DATE"] = 19] = "SERVER_UPDATE_DATE";
  FieldBit2[FieldBit2["SERVER_UPDATE_TIME"] = 20] = "SERVER_UPDATE_TIME";
  FieldBit2[FieldBit2["LOT_SIZE_INFO"] = 21] = "LOT_SIZE_INFO";
  FieldBit2[FieldBit2["BOARD_STRENGTH"] = 22] = "BOARD_STRENGTH";
  FieldBit2[FieldBit2["DIVIDEND_YIELD"] = 23] = "DIVIDEND_YIELD";
  FieldBit2[FieldBit2["BID_VOLUME"] = 24] = "BID_VOLUME";
  FieldBit2[FieldBit2["ASK_VOLUME"] = 25] = "ASK_VOLUME";
  FieldBit2[FieldBit2["LAST_VOLUME"] = 26] = "LAST_VOLUME";
  FieldBit2[FieldBit2["TURNOVER"] = 27] = "TURNOVER";
  FieldBit2[FieldBit2["INDUSTRY"] = 28] = "INDUSTRY";
  FieldBit2[FieldBit2["INDUSTRY_CHANGE_UP"] = 29] = "INDUSTRY_CHANGE_UP";
  FieldBit2[FieldBit2["STOCK_TAG_FLAGS"] = 30] = "STOCK_TAG_FLAGS";
  FieldBit2[FieldBit2["DECIMAL_POINT"] = 31] = "DECIMAL_POINT";
  FieldBit2[FieldBit2["BUY_PRICE_LIMIT"] = 32] = "BUY_PRICE_LIMIT";
  FieldBit2[FieldBit2["SELL_PRICE_LIMIT"] = 33] = "SELL_PRICE_LIMIT";
  FieldBit2[FieldBit2["PRICE_DECIMAL_INFO"] = 34] = "PRICE_DECIMAL_INFO";
  FieldBit2[FieldBit2["LOT_SIZE"] = 35] = "LOT_SIZE";
  FieldBit2[FieldBit2["PRE_IPOV"] = 36] = "PRE_IPOV";
  FieldBit2[FieldBit2["SPEED_PCT"] = 37] = "SPEED_PCT";
  FieldBit2[FieldBit2["AVG_PRICE"] = 38] = "AVG_PRICE";
  FieldBit2[FieldBit2["IPOV"] = 39] = "IPOV";
  FieldBit2[FieldBit2["PE_TTM_VOL_RELATED"] = 40] = "PE_TTM_VOL_RELATED";
  FieldBit2[FieldBit2["EX_PRICE_PLACEHOLDER"] = 41] = "EX_PRICE_PLACEHOLDER";
  FieldBit2[FieldBit2["OPERATING_REVENUE"] = 42] = "OPERATING_REVENUE";
  FieldBit2[FieldBit2["FLAG_KCB"] = 43] = "FLAG_KCB";
  FieldBit2[FieldBit2["FLAG_BJ"] = 44] = "FLAG_BJ";
  FieldBit2[FieldBit2["CIRCULATING_CAPITAL_Z"] = 45] = "CIRCULATING_CAPITAL_Z";
  FieldBit2[FieldBit2["AFTER_HOURS_VOLUME"] = 46] = "AFTER_HOURS_VOLUME";
  FieldBit2[FieldBit2["PE_TTM"] = 48] = "PE_TTM";
  FieldBit2[FieldBit2["PE_STATIC"] = 49] = "PE_STATIC";
  FieldBit2[FieldBit2["INDEX_METRIC"] = 55] = "INDEX_METRIC";
  FieldBit2[FieldBit2["MAIN_NET_AMOUNT"] = 56] = "MAIN_NET_AMOUNT";
  FieldBit2[FieldBit2["BID_ASK_RATIO"] = 57] = "BID_ASK_RATIO";
  FieldBit2[FieldBit2["NON_INDEX_FLAG"] = 58] = "NON_INDEX_FLAG";
  FieldBit2[FieldBit2["CHANGE_20D_PCT"] = 59] = "CHANGE_20D_PCT";
  FieldBit2[FieldBit2["YTD_PCT"] = 60] = "YTD_PCT";
  FieldBit2[FieldBit2["STOCK_CLASS_CODE"] = 62] = "STOCK_CLASS_CODE";
  FieldBit2[FieldBit2["PERCENT_BASE"] = 63] = "PERCENT_BASE";
  FieldBit2[FieldBit2["MTD_PCT"] = 64] = "MTD_PCT";
  FieldBit2[FieldBit2["CHANGE_1Y_PCT"] = 65] = "CHANGE_1Y_PCT";
  FieldBit2[FieldBit2["PREV_CHANGE_PCT"] = 66] = "PREV_CHANGE_PCT";
  FieldBit2[FieldBit2["CHANGE_3D_PCT"] = 67] = "CHANGE_3D_PCT";
  FieldBit2[FieldBit2["CHANGE_60D_PCT"] = 68] = "CHANGE_60D_PCT";
  FieldBit2[FieldBit2["CHANGE_5D_PCT"] = 69] = "CHANGE_5D_PCT";
  FieldBit2[FieldBit2["CHANGE_10D_PCT"] = 70] = "CHANGE_10D_PCT";
  FieldBit2[FieldBit2["PREV2_CHANGE_PCT"] = 71] = "PREV2_CHANGE_PCT";
  FieldBit2[FieldBit2["BID2_PRICE"] = 72] = "BID2_PRICE";
  FieldBit2[FieldBit2["ASK2_PRICE"] = 73] = "ASK2_PRICE";
  FieldBit2[FieldBit2["AH_CODE"] = 74] = "AH_CODE";
  FieldBit2[FieldBit2["UNKNOWN_CODE"] = 75] = "UNKNOWN_CODE";
  FieldBit2[FieldBit2["OPEN_AMOUNT"] = 87] = "OPEN_AMOUNT";
  FieldBit2[FieldBit2["ANNUAL_LIMIT_UP_DAYS"] = 88] = "ANNUAL_LIMIT_UP_DAYS";
  FieldBit2[FieldBit2["ACTIVITY"] = 89] = "ACTIVITY";
  FieldBit2[FieldBit2["DIVIDEND_YIELD_RATE"] = 91] = "DIVIDEND_YIELD_RATE";
  FieldBit2[FieldBit2["CONSECUTIVE_UP_DAYS"] = 92] = "CONSECUTIVE_UP_DAYS";
  FieldBit2[FieldBit2["LIMIT_UP_COUNT"] = 93] = "LIMIT_UP_COUNT";
  FieldBit2[FieldBit2["BID2_VOLUME"] = 93] = "BID2_VOLUME";
  FieldBit2[FieldBit2["LIMIT_DOWN_COUNT"] = 94] = "LIMIT_DOWN_COUNT";
  FieldBit2[FieldBit2["ASK2_VOLUME"] = 94] = "ASK2_VOLUME";
  FieldBit2[FieldBit2["INDUSTRY_SUB"] = 95] = "INDUSTRY_SUB";
  FieldBit2[FieldBit2["AUCTION_BUY_LIMIT"] = 102] = "AUCTION_BUY_LIMIT";
  FieldBit2[FieldBit2["AUCTION_SELL_LIMIT"] = 103] = "AUCTION_SELL_LIMIT";
  FieldBit2[FieldBit2["VOL_SPEED_PCT"] = 104] = "VOL_SPEED_PCT";
  FieldBit2[FieldBit2["SHORT_TURNOVER_PCT"] = 105] = "SHORT_TURNOVER_PCT";
  FieldBit2[FieldBit2["AMOUNT_2M"] = 106] = "AMOUNT_2M";
  FieldBit2[FieldBit2["MAIN_NET_AMOUNT_COPY"] = 107] = "MAIN_NET_AMOUNT_COPY";
  FieldBit2[FieldBit2["MAIN_NET_RATIO"] = 108] = "MAIN_NET_RATIO";
  FieldBit2[FieldBit2["RETAIL_NET_AMOUNT"] = 109] = "RETAIL_NET_AMOUNT";
  FieldBit2[FieldBit2["MAIN_NET_5M_AMOUNT"] = 110] = "MAIN_NET_5M_AMOUNT";
  FieldBit2[FieldBit2["MAIN_NET_3D_AMOUNT"] = 111] = "MAIN_NET_3D_AMOUNT";
  FieldBit2[FieldBit2["MAIN_NET_5D_AMOUNT"] = 112] = "MAIN_NET_5D_AMOUNT";
  FieldBit2[FieldBit2["MAIN_NET_10D_AMOUNT"] = 113] = "MAIN_NET_10D_AMOUNT";
  FieldBit2[FieldBit2["MAIN_BUY_NET_AMOUNT"] = 114] = "MAIN_BUY_NET_AMOUNT";
  FieldBit2[FieldBit2["DDX"] = 115] = "DDX";
  FieldBit2[FieldBit2["DDY"] = 116] = "DDY";
  FieldBit2[FieldBit2["DDZ"] = 117] = "DDZ";
  FieldBit2[FieldBit2["DDF"] = 118] = "DDF";
  FieldBit2[FieldBit2["STOCK_FLAG_A"] = 119] = "STOCK_FLAG_A";
  FieldBit2[FieldBit2["STOCK_FLAG_B"] = 120] = "STOCK_FLAG_B";
  FieldBit2[FieldBit2["AUCTION_VOL_RATIO"] = 122] = "AUCTION_VOL_RATIO";
  FieldBit2[FieldBit2["PREV_AMOUNT"] = 123] = "PREV_AMOUNT";
  FieldBit2[FieldBit2["RECENT_INDICATOR"] = 125] = "RECENT_INDICATOR";
  FieldBit2[FieldBit2["BID3_PRICE"] = 128] = "BID3_PRICE";
  FieldBit2[FieldBit2["BID4_PRICE"] = 129] = "BID4_PRICE";
  FieldBit2[FieldBit2["BID5_PRICE"] = 130] = "BID5_PRICE";
  FieldBit2[FieldBit2["ASK3_PRICE"] = 131] = "ASK3_PRICE";
  FieldBit2[FieldBit2["ASK4_PRICE"] = 132] = "ASK4_PRICE";
  FieldBit2[FieldBit2["ASK5_PRICE"] = 133] = "ASK5_PRICE";
  FieldBit2[FieldBit2["BID3_VOLUME"] = 134] = "BID3_VOLUME";
  FieldBit2[FieldBit2["BID4_VOLUME"] = 135] = "BID4_VOLUME";
  FieldBit2[FieldBit2["UP_COUNT"] = 136] = "UP_COUNT";
  FieldBit2[FieldBit2["BID5_VOLUME"] = 136] = "BID5_VOLUME";
  FieldBit2[FieldBit2["ASK3_VOLUME"] = 137] = "ASK3_VOLUME";
  FieldBit2[FieldBit2["ASK4_VOLUME"] = 138] = "ASK4_VOLUME";
  FieldBit2[FieldBit2["DOWN_COUNT"] = 139] = "DOWN_COUNT";
  FieldBit2[FieldBit2["ASK5_VOLUME"] = 139] = "ASK5_VOLUME";
  FieldBit2[FieldBit2["BID_ASK_DIFF"] = 140] = "BID_ASK_DIFF";
  FieldBit2[FieldBit2["CHANGE_UP_TYPE"] = 141] = "CHANGE_UP_TYPE";
  FieldBit2[FieldBit2["SAFETY_SCORE"] = 142] = "SAFETY_SCORE";
  FieldBit2[FieldBit2["HIGHLIGHT_COUNT"] = 143] = "HIGHLIGHT_COUNT";
  FieldBit2[FieldBit2["CHANGE_AT_1000"] = 144] = "CHANGE_AT_1000";
  FieldBit2[FieldBit2["CHANGE_AT_1030"] = 145] = "CHANGE_AT_1030";
  FieldBit2[FieldBit2["CHANGE_AT_1100"] = 146] = "CHANGE_AT_1100";
  FieldBit2[FieldBit2["CHANGE_AT_1130"] = 147] = "CHANGE_AT_1130";
  FieldBit2[FieldBit2["CHANGE_AT_1330"] = 148] = "CHANGE_AT_1330";
  FieldBit2[FieldBit2["CHANGE_AT_1400"] = 149] = "CHANGE_AT_1400";
  FieldBit2[FieldBit2["CHANGE_AT_1430"] = 150] = "CHANGE_AT_1430";
  return FieldBit2;
})(FieldBit || {});
var FIELD_META = {
  [0 /* PRE_CLOSE */]: { name: "pre_close", fmt: "float32", desc: "\u6628\u6536" },
  [1 /* OPEN */]: { name: "open", fmt: "float32", desc: "\u5F00\u76D8\u4EF7" },
  [2 /* HIGH */]: { name: "high", fmt: "float32", desc: "\u6700\u9AD8\u4EF7" },
  [3 /* LOW */]: { name: "low", fmt: "float32", desc: "\u6700\u4F4E\u4EF7" },
  [4 /* CLOSE */]: { name: "close", fmt: "float32", desc: "\u6536\u76D8\u4EF7" },
  [5 /* VOL */]: { name: "vol", fmt: "uint32", desc: "\u6210\u4EA4\u91CF" },
  [6 /* VOL_RATIO */]: { name: "vol_ratio", fmt: "float32", desc: "\u91CF\u6BD4" },
  [7 /* AMOUNT */]: { name: "amount", fmt: "float32", desc: "\u603B\u91D1\u989D(\u5143)" },
  [8 /* INSIDE_VOLUME */]: { name: "inside_volume", fmt: "uint32", desc: "\u5185\u76D8" },
  [9 /* OUTSIDE_VOLUME */]: { name: "outside_volume", fmt: "uint32", desc: "\u5916\u76D8" },
  [10 /* TOTAL_SHARES */]: { name: "total_shares", fmt: "float32", desc: "\u603B\u80A1\u6570(\u4E07)" },
  [11 /* FLOAT_SHARES */]: { name: "float_shares", fmt: "float32", desc: "\u6D41\u901A\u80A1(\u4E07)" },
  [12 /* EPS */]: { name: "eps", fmt: "float32", desc: "\u6BCF\u80A1\u6536\u76CA" },
  [13 /* NET_ASSETS */]: { name: "net_assets", fmt: "float32", desc: "\u51C0\u8D44\u4EA7" },
  [14 /* SECURITY_TYPE_PRICE */]: { name: "security_type_price", fmt: "float32", desc: "\u8BC1\u5238\u7C7B\u578B\u4EF7" },
  [15 /* TOTAL_MARKET_CAP_AB */]: { name: "total_market_cap_ab", fmt: "float32", desc: "AB\u80A1\u603B\u5E02\u503C" },
  [16 /* PE_DYNAMIC */]: { name: "pe_dynamic", fmt: "float32", desc: "\u5E02\u76C8\u7387(\u52A8)" },
  [17 /* BID_PRICE */]: { name: "bid_price", fmt: "float32", desc: "\u4E70\u4E00\u4EF7" },
  [18 /* ASK_PRICE */]: { name: "ask_price", fmt: "float32", desc: "\u5356\u4E00\u4EF7" },
  [19 /* SERVER_UPDATE_DATE */]: { name: "server_update_date", fmt: "uint32", desc: "\u670D\u52A1\u5668\u66F4\u65B0\u65E5\u671F" },
  [20 /* SERVER_UPDATE_TIME */]: { name: "server_update_time", fmt: "uint32", desc: "\u670D\u52A1\u5668\u66F4\u65B0\u65F6\u95F4" },
  [21 /* LOT_SIZE_INFO */]: { name: "lot_size_info", fmt: "uint32", desc: "\u6BCF\u624B\u4FE1\u606F" },
  [22 /* BOARD_STRENGTH */]: { name: "board_strength", fmt: "float32", desc: "\u677F\u5757\u5F3A\u5EA6" },
  [23 /* DIVIDEND_YIELD */]: { name: "dividend_yield", fmt: "float32", desc: "\u6BCF\u80A1\u80A1\u606F(\u5143)" },
  [24 /* BID_VOLUME */]: { name: "bid_volume", fmt: "uint32", desc: "\u4E70\u91CF" },
  [25 /* ASK_VOLUME */]: { name: "ask_volume", fmt: "uint32", desc: "\u5356\u91CF" },
  [26 /* LAST_VOLUME */]: { name: "last_volume", fmt: "uint32", desc: "\u73B0\u91CF" },
  [27 /* TURNOVER */]: { name: "turnover", fmt: "float32", desc: "\u6362\u624B" },
  [28 /* INDUSTRY */]: { name: "industry", fmt: "uint32", desc: "\u884C\u4E1A\u5206\u7C7B\u4EE3\u7801" },
  [29 /* INDUSTRY_CHANGE_UP */]: { name: "industry_change_up", fmt: "float32", desc: "\u884C\u4E1A\u6DA8\u8DCC\u5E45" },
  [30 /* STOCK_TAG_FLAGS */]: { name: "stock_tag_flags", fmt: "uint32", desc: "\u80A1\u7968\u6807\u7B7E\u4F4D\u56FE" },
  [31 /* DECIMAL_POINT */]: { name: "decimal_point", fmt: "uint32", desc: "\u6570\u636E\u7CBE\u5EA6" },
  [32 /* BUY_PRICE_LIMIT */]: { name: "buy_price_limit", fmt: "float32", desc: "\u6DA8\u505C\u4EF7" },
  [33 /* SELL_PRICE_LIMIT */]: { name: "sell_price_limit", fmt: "float32", desc: "\u8DCC\u505C\u4EF7" },
  [34 /* PRICE_DECIMAL_INFO */]: { name: "price_decimal_info", fmt: "uint32", desc: "\u4EF7\u683C\u7CBE\u5EA6\u6807\u5FD7" },
  [35 /* LOT_SIZE */]: { name: "lot_size", fmt: "uint32", desc: "\u6240\u5C5E\u5730\u533A\u677F\u5757/\u6BCF\u624B\u80A1\u6570" },
  [36 /* PRE_IPOV */]: { name: "pre_ipov", fmt: "float32", desc: "\u6628IPOV" },
  [37 /* SPEED_PCT */]: { name: "speed_pct", fmt: "float32", desc: "\u6DA8\u901F" },
  [38 /* AVG_PRICE */]: { name: "avg_price", fmt: "float32", desc: "\u5747\u4EF7" },
  [39 /* IPOV */]: { name: "ipov", fmt: "float32", desc: "IPOV" },
  [40 /* PE_TTM_VOL_RELATED */]: { name: "pe_ttm_vol_related", fmt: "float32", desc: "\u524D\u53C2\u8003\u4EF7" },
  [41 /* EX_PRICE_PLACEHOLDER */]: { name: "ex_price_placeholder", fmt: "float32", desc: "\u524D\u91D1\u989D\u53C2\u8003" },
  [42 /* OPERATING_REVENUE */]: { name: "operating_revenue", fmt: "float32", desc: "\u8425\u4E1A\u6536\u5165(\u4E07)" },
  [43 /* FLAG_KCB */]: { name: "flag_kcb", fmt: "uint32", desc: "\u79D1\u521B\u677F\u6807\u5FD7" },
  [44 /* FLAG_BJ */]: { name: "flag_bj", fmt: "uint32", desc: "\u5317\u4EA4\u6240\u6807\u5FD7" },
  [45 /* CIRCULATING_CAPITAL_Z */]: { name: "circulating_capital_z", fmt: "float32", desc: "\u6D41\u901A\u80A1\u672CZ(\u4E07)" },
  [46 /* AFTER_HOURS_VOLUME */]: { name: "after_hours_volume", fmt: "int32", desc: "\u76D8\u540E\u91CF" },
  [48 /* PE_TTM */]: { name: "pe_ttm", fmt: "float32", desc: "\u5E02\u76C8\u7387TTM" },
  [49 /* PE_STATIC */]: { name: "pe_static", fmt: "float32", desc: "\u5E02\u76C8\u7387\u9759" },
  [55 /* INDEX_METRIC */]: { name: "index_metric", fmt: "float32", desc: "\u6307\u6570\u6307\u6807" },
  [56 /* MAIN_NET_AMOUNT */]: { name: "main_net_amount", fmt: "float32", desc: "\u4ECA\u65E5\u4E3B\u529B\u51C0\u6D41\u5165" },
  [57 /* BID_ASK_RATIO */]: { name: "bid_ask_ratio", fmt: "float32", desc: "\u59D4\u6BD4" },
  [58 /* NON_INDEX_FLAG */]: { name: "non_index_flag", fmt: "uint32", desc: "\u975E\u6307\u6570\u6807\u5FD7" },
  [59 /* CHANGE_20D_PCT */]: { name: "change_20d_pct", fmt: "float32", desc: "20\u65E5\u6DA8\u5E45%" },
  [60 /* YTD_PCT */]: { name: "ytd_pct", fmt: "float32", desc: "\u5E74\u521D\u81F3\u4ECA%" },
  [62 /* STOCK_CLASS_CODE */]: { name: "stock_class_code", fmt: "uint32", desc: "\u8BC1\u5238\u5B50\u5206\u7C7B\u7801" },
  [63 /* PERCENT_BASE */]: { name: "percent_base", fmt: "uint32", desc: "\u767E\u5206\u6BD4\u57FA\u5E95" },
  [64 /* MTD_PCT */]: { name: "mtd_pct", fmt: "float32", desc: "\u6708\u521D\u81F3\u4ECA%" },
  [65 /* CHANGE_1Y_PCT */]: { name: "change_1y_pct", fmt: "float32", desc: "\u4E00\u5E74\u6DA8\u5E45%" },
  [66 /* PREV_CHANGE_PCT */]: { name: "prev_change_pct", fmt: "float32", desc: "\u6628\u6DA8\u5E45%" },
  [67 /* CHANGE_3D_PCT */]: { name: "change_3d_pct", fmt: "float32", desc: "3\u65E5\u6DA8\u5E45%" },
  [68 /* CHANGE_60D_PCT */]: { name: "change_60d_pct", fmt: "float32", desc: "60\u65E5\u6DA8\u5E45%" },
  [69 /* CHANGE_5D_PCT */]: { name: "change_5d_pct", fmt: "float32", desc: "5\u65E5\u6DA8\u5E45%" },
  [70 /* CHANGE_10D_PCT */]: { name: "change_10d_pct", fmt: "float32", desc: "10\u65E5\u6DA8\u5E45%" },
  [71 /* PREV2_CHANGE_PCT */]: { name: "prev2_change_pct", fmt: "float32", desc: "\u524D\u65E5\u6DA8\u5E45%" },
  [72 /* BID2_PRICE */]: { name: "bid2_price", fmt: "float32", desc: "\u4E70\u4E8C\u4EF7" },
  [73 /* ASK2_PRICE */]: { name: "ask2_price", fmt: "float32", desc: "\u5356\u4E8C\u4EF7" },
  [74 /* AH_CODE */]: { name: "ah_code", fmt: "uint32", desc: "\u5BF9\u5E94A/H\u80A1code" },
  [75 /* UNKNOWN_CODE */]: { name: "unknown_code", fmt: "uint32", desc: "\u672A\u77E5\u4EE3\u7801" },
  [87 /* OPEN_AMOUNT */]: { name: "open_amount", fmt: "float32", desc: "\u5F00\u76D8\u91D1\u989D(\u5143)" },
  [88 /* ANNUAL_LIMIT_UP_DAYS */]: { name: "annual_limit_up_days", fmt: "int32", desc: "\u5E74\u6DA8\u505C\u5929\u6570" },
  [89 /* ACTIVITY */]: { name: "activity", fmt: "uint32", desc: "\u6D3B\u8DC3\u5EA6" },
  [91 /* DIVIDEND_YIELD_RATE */]: { name: "dividend_yield_rate", fmt: "float32", desc: "\u80A1\u606F\u7387%" },
  [92 /* CONSECUTIVE_UP_DAYS */]: { name: "consecutive_up_days", fmt: "int32", desc: "\u8FDE\u6DA8\u5929" },
  [93 /* LIMIT_UP_COUNT */]: { name: "limit_up_count", fmt: "uint32", desc: "\u6DA8\u505C\u6570/\u4E70\u4E8C\u91CF" },
  [94 /* LIMIT_DOWN_COUNT */]: { name: "limit_down_count", fmt: "uint32", desc: "\u8DCC\u505C\u6570/\u5356\u4E8C\u91CF" },
  [95 /* INDUSTRY_SUB */]: { name: "industry_sub", fmt: "uint32", desc: "\u884C\u4E1A\u4E8C\u7EA7\u5206\u7C7B" },
  [102 /* AUCTION_BUY_LIMIT */]: { name: "auction_buy_limit", fmt: "float32", desc: "\u8FDE\u7EED\u7ADE\u4EF7\u4E70\u5165\u4E0A\u9650" },
  [103 /* AUCTION_SELL_LIMIT */]: { name: "auction_sell_limit", fmt: "float32", desc: "\u8FDE\u7EED\u7ADE\u4EF7\u5356\u51FA\u4E0B\u9650" },
  [104 /* VOL_SPEED_PCT */]: { name: "vol_speed_pct", fmt: "float32", desc: "\u91CF\u6DA8\u901F%" },
  [105 /* SHORT_TURNOVER_PCT */]: { name: "short_turnover_pct", fmt: "float32", desc: "\u77ED\u6362\u624B%" },
  [106 /* AMOUNT_2M */]: { name: "amount_2m", fmt: "float32", desc: "2\u5206\u949F\u91D1\u989D(\u5143)" },
  [107 /* MAIN_NET_AMOUNT_COPY */]: { name: "main_net_amount_copy", fmt: "float32", desc: "\u4ECA\u65E5\u4E3B\u529B\u51C0\u6D41\u5165(\u526F\u672C)" },
  [108 /* MAIN_NET_RATIO */]: { name: "main_net_ratio", fmt: "float32", desc: "\u4E3B\u529B\u51C0\u6BD4%" },
  [109 /* RETAIL_NET_AMOUNT */]: { name: "retail_net_amount", fmt: "float32", desc: "\u6563\u6237\u5355\u589E\u6BD4" },
  [110 /* MAIN_NET_5M_AMOUNT */]: { name: "main_net_5m_amount", fmt: "float32", desc: "5\u5206\u949F\u4E3B\u529B\u51C0\u989D" },
  [111 /* MAIN_NET_3D_AMOUNT */]: { name: "main_net_3d_amount", fmt: "float32", desc: "\u8FD1\u4E09\u65E5\u4E3B\u529B\u51C0\u989D" },
  [112 /* MAIN_NET_5D_AMOUNT */]: { name: "main_net_5d_amount", fmt: "float32", desc: "\u8FD1\u4E94\u65E5\u4E3B\u529B\u51C0\u989D" },
  [113 /* MAIN_NET_10D_AMOUNT */]: { name: "main_net_10d_amount", fmt: "float32", desc: "\u8FD1\u5341\u65E5\u4E3B\u4E70\u91D1\u989D" },
  [114 /* MAIN_BUY_NET_AMOUNT */]: { name: "main_buy_net_amount", fmt: "float32", desc: "\u4ECA\u65E5\u4E3B\u4E70\u51C0\u989D" },
  [115 /* DDX */]: { name: "ddx", fmt: "float32", desc: "DDX" },
  [116 /* DDY */]: { name: "ddy", fmt: "float32", desc: "DDY" },
  [117 /* DDZ */]: { name: "ddz", fmt: "float32", desc: "DDZ" },
  [118 /* DDF */]: { name: "ddf", fmt: "float32", desc: "DDF" },
  [119 /* STOCK_FLAG_A */]: { name: "stock_flag_a", fmt: "float32", desc: "\u4E2A\u80A1\u6807\u5FD7\u4F4DA" },
  [120 /* STOCK_FLAG_B */]: { name: "stock_flag_b", fmt: "float32", desc: "\u4E2A\u80A1\u6807\u5FD7\u4F4DB" },
  [122 /* AUCTION_VOL_RATIO */]: { name: "auction_vol_ratio", fmt: "float32", desc: "\u7ADE\u4EF7\u6628\u6BD4" },
  [123 /* PREV_AMOUNT */]: { name: "prev_amount", fmt: "float32", desc: "\u6628\u6210\u4EA4\u989D(\u5143)" },
  [125 /* RECENT_INDICATOR */]: { name: "recent_indicator", fmt: "float32", desc: "\u8FD1\u65E5\u6307\u6807\u63D0\u793A" },
  [128 /* BID3_PRICE */]: { name: "bid3_price", fmt: "float32", desc: "\u4E70\u4E09\u4EF7" },
  [129 /* BID4_PRICE */]: { name: "bid4_price", fmt: "float32", desc: "\u4E70\u56DB\u4EF7" },
  [130 /* BID5_PRICE */]: { name: "bid5_price", fmt: "float32", desc: "\u4E70\u4E94\u4EF7" },
  [131 /* ASK3_PRICE */]: { name: "ask3_price", fmt: "float32", desc: "\u5356\u4E09\u4EF7" },
  [132 /* ASK4_PRICE */]: { name: "ask4_price", fmt: "float32", desc: "\u5356\u56DB\u4EF7" },
  [133 /* ASK5_PRICE */]: { name: "ask5_price", fmt: "float32", desc: "\u5356\u4E94\u4EF7" },
  [134 /* BID3_VOLUME */]: { name: "bid3_volume", fmt: "uint32", desc: "\u4E70\u4E09\u91CF" },
  [135 /* BID4_VOLUME */]: { name: "bid4_volume", fmt: "uint32", desc: "\u4E70\u56DB\u91CF" },
  [136 /* UP_COUNT */]: { name: "up_count", fmt: "uint32", desc: "\u4E0A\u6DA8\u5BB6\u6570/\u4E70\u4E94\u91CF" },
  [137 /* ASK3_VOLUME */]: { name: "ask3_volume", fmt: "uint32", desc: "\u5356\u4E09\u91CF" },
  [138 /* ASK4_VOLUME */]: { name: "ask4_volume", fmt: "uint32", desc: "\u5356\u56DB\u91CF" },
  [139 /* DOWN_COUNT */]: { name: "down_count", fmt: "uint32", desc: "\u4E0B\u8DCC\u5BB6\u6570/\u5356\u4E94\u91CF" },
  [140 /* BID_ASK_DIFF */]: { name: "bid_ask_diff", fmt: "int32", desc: "\u59D4\u5DEE" },
  [141 /* CHANGE_UP_TYPE */]: { name: "change_up_type", fmt: "int32", desc: "\u5C01\u677F\u72B6\u6001" },
  [142 /* SAFETY_SCORE */]: { name: "safety_score", fmt: "float32", desc: "\u5B89\u5168\u5206" },
  [143 /* HIGHLIGHT_COUNT */]: { name: "highlight_count", fmt: "float32", desc: "\u4EAE\u70B9\u6570" },
  [144 /* CHANGE_AT_1000 */]: { name: "change_at_1000", fmt: "float32", desc: "\u65E5\u5185\u6DA8\u5E45% 10:00" },
  [145 /* CHANGE_AT_1030 */]: { name: "change_at_1030", fmt: "float32", desc: "\u65E5\u5185\u6DA8\u5E45% 10:30" },
  [146 /* CHANGE_AT_1100 */]: { name: "change_at_1100", fmt: "float32", desc: "\u65E5\u5185\u6DA8\u5E45% 11:00" },
  [147 /* CHANGE_AT_1130 */]: { name: "change_at_1130", fmt: "float32", desc: "\u65E5\u5185\u6DA8\u5E45% 11:30" },
  [148 /* CHANGE_AT_1330 */]: { name: "change_at_1330", fmt: "float32", desc: "\u65E5\u5185\u6DA8\u5E45% 13:30" },
  [149 /* CHANGE_AT_1400 */]: { name: "change_at_1400", fmt: "float32", desc: "\u65E5\u5185\u6DA8\u5E45% 14:00" },
  [150 /* CHANGE_AT_1430 */]: { name: "change_at_1430", fmt: "float32", desc: "\u65E5\u5185\u6DA8\u5E45% 14:30" }
};
var FIELD_POSTPROCESS = {
  74: (value, stock) => {
    if (!value) return "";
    const market = stock["market"];
    const width = market === 0 /* SZ */ || market === 1 /* SH */ || market === 2 /* BJ */ ? 5 : 6;
    return String(value).padStart(width, "0");
  }
};
var PresetField = /* @__PURE__ */ ((PresetField2) => {
  PresetField2[PresetField2["NONE"] = 0] = "NONE";
  PresetField2[PresetField2["OHLC"] = 1] = "OHLC";
  PresetField2[PresetField2["BASIC"] = 2] = "BASIC";
  PresetField2[PresetField2["QUOTE"] = 3] = "QUOTE";
  PresetField2[PresetField2["VOLUME"] = 4] = "VOLUME";
  PresetField2[PresetField2["FUNDAMENTAL"] = 5] = "FUNDAMENTAL";
  PresetField2[PresetField2["ENHANCED"] = 6] = "ENHANCED";
  PresetField2[PresetField2["AH_CODE"] = 7] = "AH_CODE";
  PresetField2[PresetField2["BOARD_STATS"] = 8] = "BOARD_STATS";
  PresetField2[PresetField2["HANDICAP"] = 9] = "HANDICAP";
  PresetField2[PresetField2["COMMON"] = 10] = "COMMON";
  PresetField2[PresetField2["DEBUG"] = 11] = "DEBUG";
  PresetField2[PresetField2["ALL"] = 12] = "ALL";
  return PresetField2;
})(PresetField || {});
var presetFieldSet = new Set(Object.values(PresetField).filter((v) => typeof v === "number"));
function isPresetField(v) {
  return presetFieldSet.has(v);
}
function presetFields(preset) {
  switch (preset) {
    case 0 /* NONE */:
      return [];
    case 1 /* OHLC */:
      return [1 /* OPEN */, 2 /* HIGH */, 3 /* LOW */, 4 /* CLOSE */];
    case 2 /* BASIC */:
      return [1 /* OPEN */, 2 /* HIGH */, 3 /* LOW */, 4 /* CLOSE */, 0 /* PRE_CLOSE */, 5 /* VOL */];
    case 3 /* QUOTE */:
      return [17 /* BID_PRICE */, 18 /* ASK_PRICE */, 24 /* BID_VOLUME */, 25 /* ASK_VOLUME */, 26 /* LAST_VOLUME */];
    case 4 /* VOLUME */:
      return [5 /* VOL */, 7 /* AMOUNT */, 27 /* TURNOVER */, 6 /* VOL_RATIO */];
    case 5 /* FUNDAMENTAL */:
      return [10 /* TOTAL_SHARES */, 11 /* FLOAT_SHARES */, 12 /* EPS */, 13 /* NET_ASSETS */];
    case 6 /* ENHANCED */:
      return [1 /* OPEN */, 2 /* HIGH */, 3 /* LOW */, 4 /* CLOSE */, 5 /* VOL */, 11 /* FLOAT_SHARES */, 89 /* ACTIVITY */];
    case 7 /* AH_CODE */:
      return [1 /* OPEN */, 2 /* HIGH */, 3 /* LOW */, 4 /* CLOSE */, 5 /* VOL */, 74 /* AH_CODE */, 35 /* LOT_SIZE */, 28 /* INDUSTRY */];
    case 8 /* BOARD_STATS */:
      return [93 /* LIMIT_UP_COUNT */, 94 /* LIMIT_DOWN_COUNT */, 136 /* UP_COUNT */, 139 /* DOWN_COUNT */];
    case 9 /* HANDICAP */:
      return [
        17 /* BID_PRICE */,
        72 /* BID2_PRICE */,
        128 /* BID3_PRICE */,
        129 /* BID4_PRICE */,
        130 /* BID5_PRICE */,
        18 /* ASK_PRICE */,
        73 /* ASK2_PRICE */,
        131 /* ASK3_PRICE */,
        132 /* ASK4_PRICE */,
        133 /* ASK5_PRICE */,
        24 /* BID_VOLUME */,
        93 /* BID2_VOLUME */,
        134 /* BID3_VOLUME */,
        135 /* BID4_VOLUME */,
        136 /* BID5_VOLUME */,
        25 /* ASK_VOLUME */,
        94 /* ASK2_VOLUME */,
        137 /* ASK3_VOLUME */,
        138 /* ASK4_VOLUME */,
        139 /* ASK5_VOLUME */
      ];
    case 10 /* COMMON */:
      return [
        0 /* PRE_CLOSE */,
        1 /* OPEN */,
        2 /* HIGH */,
        3 /* LOW */,
        4 /* CLOSE */,
        5 /* VOL */,
        6 /* VOL_RATIO */,
        7 /* AMOUNT */,
        10 /* TOTAL_SHARES */,
        11 /* FLOAT_SHARES */,
        12 /* EPS */,
        13 /* NET_ASSETS */,
        14 /* SECURITY_TYPE_PRICE */,
        15 /* TOTAL_MARKET_CAP_AB */,
        16 /* PE_DYNAMIC */,
        21 /* LOT_SIZE_INFO */,
        23 /* DIVIDEND_YIELD */,
        26 /* LAST_VOLUME */,
        27 /* TURNOVER */,
        30 /* STOCK_TAG_FLAGS */,
        31 /* DECIMAL_POINT */,
        32 /* BUY_PRICE_LIMIT */,
        33 /* SELL_PRICE_LIMIT */,
        34 /* PRICE_DECIMAL_INFO */,
        35 /* LOT_SIZE */,
        36 /* PRE_IPOV */,
        37 /* SPEED_PCT */,
        43 /* FLAG_KCB */,
        48 /* PE_TTM */,
        49 /* PE_STATIC */,
        56 /* MAIN_NET_AMOUNT */,
        104 /* VOL_SPEED_PCT */,
        105 /* SHORT_TURNOVER_PCT */,
        45 /* CIRCULATING_CAPITAL_Z */
      ];
    case 12 /* ALL */:
      return Object.values(FieldBit).filter((v) => typeof v === "number");
    default:
      return [];
  }
}
var FieldSelection = class _FieldSelection {
  _fields;
  constructor(...parts) {
    this._fields = /* @__PURE__ */ new Set();
    for (const part of parts) {
      const bits = part instanceof _FieldSelection ? part._fields : isPresetField(part) ? presetFields(part).map((b) => b) : [part];
      for (const bit of bits) {
        this._fields.add(bit);
      }
    }
  }
  add(other) {
    const bits = other instanceof _FieldSelection ? other._fields : isPresetField(other) ? presetFields(other).map((b) => b) : [other];
    for (const bit of bits) this._fields.add(bit);
    return this;
  }
  get fields() {
    return [...this._fields];
  }
  get size() {
    return this._fields.size;
  }
  has(bit) {
    return this._fields.has(bit);
  }
  [Symbol.iterator]() {
    return this._fields[Symbol.iterator]();
  }
};
function normalizeFields(fields) {
  if (fields instanceof FieldSelection) return fields;
  if (isPresetField(fields)) {
    return new FieldSelection(...presetFields(fields));
  }
  if (typeof fields === "number") {
    return new FieldSelection(fields);
  }
  return new FieldSelection(...fields);
}
var CTRL_EXTENDED = 1;
function getActiveFieldsFromBitmap(bitmapBytes) {
  const activeBits = [];
  for (let byteIdx = 0; byteIdx < bitmapBytes.length; byteIdx++) {
    const byte = bitmapBytes[byteIdx];
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      if (byte & 1 << bitIdx) {
        activeBits.push(byteIdx * 8 + bitIdx);
      }
    }
  }
  return activeBits;
}
function buildBitmap(fields) {
  if (isPresetField(fields) && fields === 11 /* DEBUG */) {
    return Buffer.alloc(20, 255);
  }
  const selection = normalizeFields(fields);
  const buf = Buffer.alloc(20, 0);
  for (const bit of selection) {
    const byteIdx = Math.floor(bit / 8);
    const bitIdx = bit % 8;
    if (byteIdx < 20) buf[byteIdx] |= 1 << bitIdx;
  }
  return buf;
}
function buildBitmapNew(fields) {
  if (isPresetField(fields) && fields === 11 /* DEBUG */) {
    return Buffer.alloc(16, 255);
  }
  const selection = normalizeFields(fields);
  const buf = Buffer.alloc(16, 0);
  for (const bit of selection) {
    if (bit >= 128) continue;
    const byteIdx = Math.floor(bit / 8);
    const bitIdx = bit % 8;
    if (byteIdx < 16) buf[byteIdx] |= 1 << bitIdx;
  }
  return buf;
}

// src/parser/mac-quotation/symbol-quotes.ts
var SymbolQuotes = class extends BaseParser {
  constructor(codeList, fields = 10 /* COMMON */) {
    super(4651, 1);
    const w = new BufferWriter();
    w.writeBytes(buildBitmap(fields));
    w.writeUInt16LE(codeList.length);
    for (const [market, code] of codeList) {
      w.writeUInt16LE(market);
      w.writeStringGBK(code, 22);
    }
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const fieldBitmap = data.subarray(0, 20);
    const r = new BufferReader(data, 20);
    const total = r.readUInt32LE();
    const rowCount = r.readUInt16LE();
    const activeBits = getActiveFieldsFromBitmap(fieldBitmap);
    const stocks = [];
    const fieldCount = activeBits.length;
    const rowLen = 68 + 4 * fieldCount;
    for (let i = 0; i < rowCount; i++) {
      const rowStart = 26 + i * rowLen;
      const row = new BufferReader(data, rowStart);
      let market = row.readUInt16LE();
      const symbol = row.readStringGBK(22);
      const name = row.readStringGBK(44);
      try {
        market = market <= 3 ? market : market;
      } catch {
        market = 1 /* TEMP_STOCK */;
      }
      const stockDict = {
        market,
        code: symbol,
        name
      };
      if (fieldCount > 0) {
        for (let idx = 0; idx < activeBits.length; idx++) {
          const bitPos = activeBits[idx];
          const valueBytes = data.subarray(rowStart + 68 + idx * 4, rowStart + 68 + (idx + 1) * 4);
          let fieldName;
          let fieldFormat;
          const isKnown = !!FIELD_META[bitPos];
          if (isKnown) {
            fieldName = FIELD_META[bitPos].name;
            fieldFormat = FIELD_META[bitPos].fmt;
          } else {
            fieldName = `unknown_field_0x${bitPos.toString(16)}`;
            fieldFormat = "float32";
          }
          let value;
          if (fieldFormat === "float32") {
            value = valueBytes.readFloatLE();
            if (!isKnown && value !== 0 && Math.abs(value) < 1e-6) {
              stockDict[fieldName] = valueBytes.readInt32LE();
              continue;
            }
          } else if (fieldFormat === "uint32") {
            value = valueBytes.readUInt32LE();
          } else {
            value = valueBytes.readInt32LE();
          }
          if (FIELD_POSTPROCESS[bitPos]) {
            value = FIELD_POSTPROCESS[bitPos](value, stockDict);
          }
          stockDict[fieldName] = value;
        }
      }
      stocks.push(stockDict);
    }
    return { count: rowCount, total, stocks };
  }
};

// src/utils/help.ts
function exchangeBoardCode(boardSymbol) {
  if (boardSymbol.startsWith("US")) return 3e4 + parseInt(boardSymbol.slice(2), 10);
  if (boardSymbol.startsWith("HK")) return 2e4 + parseInt(boardSymbol.slice(2), 10);
  if (boardSymbol.startsWith("000")) return 31e3 + parseInt(boardSymbol, 10);
  if (boardSymbol.startsWith("399") && boardSymbol.length === 6) return parseInt(boardSymbol, 10) - 399e3 + 3e4;
  if (boardSymbol.startsWith("899") && boardSymbol.length === 6) return parseInt(boardSymbol, 10) - 899e3 + 32e3;
  if (boardSymbol.startsWith("88") && boardSymbol.length === 6) return parseInt(boardSymbol, 10) - 88e4 + 2e4;
  return parseInt(boardSymbol, 10);
}
function unpackByType(unusualType, data) {
  const r = new BufferReader(data);
  let v1 = r.readUInt8();
  let v2 = r.readFloatLE();
  let v3 = r.readFloatLE();
  let v4 = r.readUInt32LE();
  let desc = "";
  let val = "";
  switch (unusualType) {
    case 3:
      desc = `\u4E3B\u529B${v1 === 0 ? "\u4E70\u5165" : "\u5356\u51FA"}`;
      val = `${v2.toFixed(2)}/${v3.toFixed(2)}`;
      break;
    case 4:
      desc = "\u52A0\u901F\u62C9\u5347";
      val = `${(v2 * 100).toFixed(2)}%`;
      break;
    case 5:
      desc = "\u52A0\u901F\u4E0B\u8DCC";
      break;
    case 6:
      desc = "\u4F4E\u4F4D\u53CD\u5F39";
      val = `${(v2 * 100).toFixed(2)}%`;
      break;
    case 7:
      desc = "\u9AD8\u4F4D\u56DE\u843D";
      val = `${(v2 * 100).toFixed(2)}%`;
      break;
    case 8:
      desc = "\u6491\u6746\u8DF3\u9AD8";
      val = `${(v2 * 100).toFixed(2)}%`;
      break;
    case 9:
      desc = "\u5E73\u53F0\u8DF3\u6C34";
      val = `${(v2 * 100).toFixed(2)}%`;
      break;
    case 10:
      desc = `\u5355\u7B14\u51B2${v2 < 0 ? "\u8DCC" : "\u6DA8"}`;
      val = `${(v2 * 100).toFixed(2)}%`;
      break;
    case 11:
      desc = `\u533A\u95F4\u653E\u91CF${v3 === 0 ? "\u5E73" : v3 < 0 ? "\u8DCC" : "\u6DA8"}`;
      val = `${v2.toFixed(1)}\u500D${v3 === 0 ? "" : `${(v3 * 100).toFixed(2)}%`}`;
      break;
    case 12:
      desc = "\u533A\u95F4\u7F29\u91CF";
      break;
    case 16:
      desc = "\u5927\u5355\u6258\u76D8";
      val = `${v4.toFixed(2)}/${v3.toFixed(2)}`;
      break;
    case 17:
      desc = "\u5927\u5355\u538B\u76D8";
      val = `${v2.toFixed(2)}/${v3.toFixed(2)}`;
      break;
    case 18:
      desc = "\u5927\u5355\u9501\u76D8";
      break;
    case 19:
      desc = "\u7ADE\u4EF7\u8BD5\u4E70";
      val = `${v2.toFixed(2)}/${v3.toFixed(2)}`;
      break;
    case 20: {
      const r2 = new BufferReader(data.subarray(1, 10));
      const subType = r2.readUInt8();
      v2 = r2.readFloatLE();
      v3 = r2.readFloatLE();
      const direction = v1 === 0 ? "\u6DA8" : "\u8DCC";
      if (subType === 1) desc = `\u903C\u8FD1${direction}\u505C`;
      else if (subType === 2) desc = `\u5C01${direction}\u505C\u677F`;
      else if (subType === 4) desc = `\u5C01${direction}\u5927\u51CF`;
      else if (subType === 5) desc = `\u6253\u5F00${direction}\u505C`;
      val = `${v2.toFixed(2)}/${v3.toFixed(2)}`;
      break;
    }
    case 21: {
      if (v1 === 0) desc = "\u5C3E\u76D8??";
      else if (v1 === 1) desc = "\u5C3E\u76D8\u5BF9\u5012";
      else if (v1 === 2) desc = "\u5C3E\u76D8\u62C9\u5347";
      else desc = "\u5C3E\u76D8\u6253\u538B";
      val = `${(v2 * 100).toFixed(2)}%/${v3.toFixed(2)}`;
      break;
    }
    case 22:
      desc = `\u76D8\u4E2D${v2 < 0 ? "\u5F31" : "\u5F3A"}\u52BF`;
      val = `${(v2 * 100).toFixed(2)}%`;
      break;
    case 29:
      desc = "\u6025\u901F\u62C9\u5347";
      val = `${(v2 * 100).toFixed(2)}%`;
      break;
    case 30:
      desc = "\u6025\u901F\u4E0B\u8DCC";
      val = `${(v2 * 100).toFixed(2)}%`;
      break;
  }
  return { desc, val, v1, v2, v3, v4 };
}
var STOCK_TAG_FLAGS_LABELS = {
  [1 << 0]: "\u6CAA\u6DF1\u6E2F\u901A\u5927\u76D8",
  [1 << 1]: "\u878D\u8D44\u878D\u5238",
  [1 << 2]: "\u6CAA\u6E2F\u901A",
  [1 << 3]: "\u6DF1\u6E2F\u901A",
  [1 << 14]: "\u542BGDR",
  [1 << 15]: "\u6CAA\u6DF1\u6E2F\u901A\u5C0F\u76D8",
  [1 << 17]: "\u6CAA\u6DF1\u6E2F\u901A\u4E2D\u76D8",
  [1 << 20]: "ST/*ST"
};

// src/parser/mac-quotation/board-members-quotes.ts
var BoardMembersQuotes = class extends SymbolQuotes {
  constructor(boardSymbol = "881001", sortType = 14 /* CHANGE_PCT */, start = 0, pageSize = 80, sortOrder = 0 /* NONE */, fields = 0 /* NONE */, excludeFlags = []) {
    super([], 0 /* NONE */);
    Object.defineProperty(this, "msgId", { value: 4652, writable: false });
    const boardCode = exchangeBoardCode(boardSymbol);
    const w = new BufferWriter();
    w.writeUInt32LE(boardCode);
    w.skip(9);
    w.writeUInt16LE(sortType);
    w.writeUInt32LE(start);
    w.writeUInt16LE(pageSize);
    w.writeUInt8(sortOrder);
    w.writeUInt8(0);
    w.writeBytes(buildBitmapNew(fields));
    const b0 = 0;
    const b1 = excludeFlags.reduce((sum, f) => sum + f, 0);
    const b2 = 0;
    w.writeUInt8(b0);
    w.writeUInt8(b1);
    w.writeUInt8(b2);
    w.writeUInt8(CTRL_EXTENDED);
    this.body = w.toBuffer();
  }
};

// src/utils/datetime.ts
function combineToDatetime(ymd, dateNum, formatTdxTime = false) {
  const ymdStr = String(ymd);
  const year = Number(ymdStr.slice(0, 4));
  const month = Number(ymdStr.slice(4, 6));
  const day = Number(ymdStr.slice(6, 8));
  const hours = Math.floor(dateNum / 3600);
  const minutes = Math.floor(dateNum % 3600 / 60);
  const dt = new Date(year, month - 1, day, hours, minutes);
  if (formatTdxTime && dt.getHours() >= 0 && dt.getHours() <= 5) {
    dt.setDate(dt.getDate() + 1);
  }
  return dt;
}

// src/parser/mac-quotation/symbol-bar.ts
var SymbolBar = class extends BaseParser {
  isEx;
  constructor(market, code, period, times = 1, start = 0, count = 700, fq = 0 /* NONE */) {
    super(4654, 1);
    this.isEx = market > 3;
    const w = new BufferWriter();
    w.writeUInt16LE(market);
    w.writeStringGBK(code, 22);
    w.writeUInt16LE(period);
    w.writeUInt16LE(times);
    w.writeUInt32LE(start);
    w.writeUInt16LE(count);
    w.writeUInt16LE(fq);
    w.writeInt8(1);
    w.writeInt8(1);
    w.writeInt8(0);
    w.writeInt8(1);
    w.writeUInt16LE(0);
    w.writeBytes(Buffer.alloc(4, 0));
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data);
    const market = r.readUInt16LE();
    const symbol = r.readStringGBK(12);
    r.skip(10);
    const respPeriod = r.readUInt8();
    const categoryFlag = r.readUInt16LE();
    const count = r.readUInt16LE();
    const start = r.readUInt32LE();
    const charts = [];
    for (let i = 0; i < count; i++) {
      const cr = new BufferReader(data, 33 + i * 36);
      const ymd = cr.readUInt32LE();
      const timeNum = cr.readUInt32LE();
      const open2 = cr.readFloatLE();
      const high2 = cr.readFloatLE();
      const low2 = cr.readFloatLE();
      const close2 = cr.readFloatLE();
      const amount2 = cr.readFloatLE();
      const vol2 = cr.readFloatLE();
      const floatShares = cr.readFloatLE();
      charts.push({
        datetime: combineToDatetime(ymd, timeNum, respPeriod < 4 || respPeriod === 7 || respPeriod === 8),
        open: open2,
        high: high2,
        low: low2,
        close: close2,
        vol: vol2,
        amount: amount2,
        float_shares: floatShares
      });
    }
    const tailOffset = 33 + count * 36;
    const tr = new BufferReader(data, tailOffset);
    const name = tr.readStringGBK(44);
    const decimal = tr.readUInt8();
    const category = tr.readUInt8();
    const volUnit = tr.readFloatLE();
    tr.skip(5);
    const dateRaw = tr.readUInt32LE();
    const timeRaw = tr.readUInt32LE();
    const preClose = tr.readFloatLE();
    const open = tr.readFloatLE();
    const high = tr.readFloatLE();
    const low = tr.readFloatLE();
    const close = tr.readFloatLE();
    const momentum = tr.readFloatLE();
    const vol = tr.readUInt32LE();
    const amount = tr.readFloatLE();
    const tailPad = tr.readBytes(12);
    const turnover = tr.readFloatLE();
    const avg = tr.readFloatLE();
    const industry = tr.readUInt32LE();
    const time = new Date(
      Math.floor(dateRaw / 1e4),
      Math.floor(dateRaw % 1e4 / 100) - 1,
      dateRaw % 100,
      Math.floor(timeRaw / 1e4),
      Math.floor(timeRaw % 1e4 / 100),
      timeRaw % 100
    );
    return {
      market: this.isEx ? market : market,
      code: symbol,
      name,
      decimal,
      category,
      vol_unit: volUnit,
      time,
      pre_close: preClose,
      open,
      high,
      low,
      close,
      momentum,
      vol,
      amount,
      turnover,
      avg,
      industry,
      period: respPeriod,
      count,
      start,
      charts,
      category_flag: categoryFlag,
      tail_pad: tailPad.toString("hex")
    };
  }
};

// src/parser/mac-quotation/symbol-tick-chart.ts
function toDateNum(v) {
  if (typeof v === "number") return v;
  return v.getFullYear() * 1e4 + (v.getMonth() + 1) * 100 + v.getDate();
}
var SymbolTickChart = class extends BaseParser {
  isEx;
  constructor(market, code, queryDate) {
    super(4653, 1);
    this.isEx = market > 3;
    const ymd = queryDate ? toDateNum(queryDate) : 0;
    const w = new BufferWriter();
    w.writeUInt16LE(market);
    w.writeStringGBK(code, 22);
    w.writeUInt32LE(ymd);
    w.writeUInt16LE(1);
    w.writeUInt16LE(0);
    w.writeUInt16LE(0);
    w.writeUInt16LE(0);
    w.writeUInt16LE(0);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data);
    const market = r.readUInt16LE();
    const code = r.readStringGBK(22);
    const queryDate = r.readUInt32LE();
    const reservedFlags = r.readUInt8();
    const refPrice = r.readFloatLE();
    const count = r.readUInt16LE();
    const charts = [];
    for (let i = 0; i < count; i++) {
      const cr = new BufferReader(data, 35 + i * 18);
      const minutes = cr.readUInt16LE();
      const price = cr.readFloatLE();
      const avg2 = cr.readFloatLE();
      const vol2 = cr.readUInt32LE();
      const momentum2 = cr.readFloatLE();
      charts.push({
        time: `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
        price,
        avg: avg2,
        vol: vol2,
        momentum: momentum2
      });
    }
    const tailOffset = 35 + count * 18;
    const tr = new BufferReader(data, tailOffset);
    const name = tr.readStringGBK(44);
    const decimal = tr.readUInt8();
    const category = tr.readUInt8();
    const volUnit = tr.readFloatLE();
    tr.skip(6);
    const dateRaw = tr.readUInt32LE();
    const timeRaw = tr.readUInt32LE();
    const preClose = tr.readFloatLE();
    const open = tr.readFloatLE();
    const high = tr.readFloatLE();
    const low = tr.readFloatLE();
    const close = tr.readFloatLE();
    const momentum = tr.readFloatLE();
    const vol = tr.readUInt32LE();
    const amount = tr.readFloatLE();
    const tailPad2 = tr.readBytes(12);
    const turnover = tr.readFloatLE();
    const avg = tr.readFloatLE();
    const industry = tr.readUInt32LE();
    const time = new Date(
      Math.floor(dateRaw / 1e4),
      Math.floor(dateRaw % 1e4 / 100) - 1,
      dateRaw % 100,
      Math.floor(timeRaw / 1e4),
      Math.floor(timeRaw % 1e4 / 100),
      timeRaw % 100
    );
    return {
      market: this.isEx ? market : market,
      code,
      name,
      decimal,
      category,
      vol_unit: volUnit,
      time,
      pre_close: preClose,
      open,
      high,
      low,
      close,
      momentum,
      vol,
      amount,
      turnover,
      avg,
      industry,
      charts,
      query_date: queryDate,
      reserved_flags: reservedFlags,
      ref_price: refPrice,
      tail_pad: tailPad2.toString("hex")
    };
  }
};

// src/parser/mac-quotation/symbol-transaction.ts
function toDateNum2(v) {
  if (typeof v === "number") return v;
  return v.getFullYear() * 1e4 + (v.getMonth() + 1) * 100 + v.getDate();
}
var SymbolTransaction = class extends BaseParser {
  isEx;
  constructor(market, code, count = 1e3, start = 0, queryDate) {
    super(4655, 1);
    this.isEx = market > 3;
    const ymd = queryDate ? toDateNum2(queryDate) : 0;
    const w = new BufferWriter();
    w.writeUInt16LE(market);
    w.writeStringGBK(code, 22);
    w.writeUInt32LE(ymd);
    w.writeUInt32LE(start);
    w.writeUInt16LE(count);
    w.skip(10);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data);
    const market = r.readUInt16LE();
    const code = r.readStringGBK(22);
    const queryDate = r.readUInt32LE();
    const flag = r.readUInt8();
    const count = r.readUInt16LE();
    const start = r.readUInt32LE();
    const total = r.readUInt32LE();
    const transactions = [];
    for (let i = 0; i < count; i++) {
      const tr = new BufferReader(data, 39 + i * 18);
      const timeSec = tr.readUInt32LE();
      const price = tr.readFloatLE();
      const volume = tr.readUInt32LE();
      const tradeCount = tr.readUInt32LE();
      const bsFlag = tr.readUInt16LE();
      transactions.push({
        time: `${String(Math.floor(timeSec / 3600)).padStart(2, "0")}:${String(Math.floor(timeSec % 3600 / 60)).padStart(2, "0")}:${String(timeSec % 60).padStart(2, "0")}`,
        price,
        vol: volume,
        trade_count: tradeCount,
        bs_flag: bsFlag
      });
    }
    return {
      market: this.isEx ? market : market,
      code,
      query_date: queryDate,
      flag,
      count,
      start,
      total,
      transactions
    };
  }
};

// src/parser/mac-quotation/symbol-info.ts
var SymbolInfo = class extends BaseParser {
  isEx;
  constructor(market, code) {
    super(4650, 1);
    this.isEx = market > 3;
    const w = new BufferWriter();
    w.writeUInt16LE(market);
    w.writeStringGBK(code, 22);
    w.writeUInt32LE(1);
    w.skip(12);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data, 8);
    const market = r.readUInt16LE();
    const code = r.readStringGBK(22);
    const name = r.readStringGBK(44);
    const r2 = new BufferReader(data, 96);
    const dateRaw = r2.readUInt32LE();
    const timeRaw = r2.readUInt32LE();
    const activity = r2.readUInt32LE();
    const preClose = r2.readFloatLE();
    const open = r2.readFloatLE();
    const high = r2.readFloatLE();
    const low = r2.readFloatLE();
    const close = r2.readFloatLE();
    const momentum = r2.readFloatLE();
    const vol = r2.readUInt32LE();
    const amount = r2.readFloatLE();
    const insideVolume = r2.readUInt32LE();
    const outsideVolume = r2.readUInt32LE();
    const r3 = new BufferReader(data, 148);
    const decimal = r3.readUInt16LE();
    const a = r3.readUInt32LE();
    const b = r3.readFloatLE();
    r3.skip(20);
    const c = r3.readUInt32LE();
    const vr = r3.readFloatLE();
    const turnover = r3.readFloatLE();
    const avg = r3.readFloatLE();
    const time = new Date(
      Math.floor(dateRaw / 1e4),
      Math.floor(dateRaw % 1e4 / 100) - 1,
      dateRaw % 100,
      Math.floor(timeRaw / 1e4),
      Math.floor(timeRaw % 1e4 / 100),
      timeRaw % 100
    );
    return {
      market: this.isEx ? market : market,
      code,
      name,
      time,
      activity,
      pre_close: preClose,
      open,
      high,
      low,
      close,
      momentum,
      vol,
      amount,
      inside_volume: insideVolume,
      outside_volume: outsideVolume,
      decimal,
      vr,
      turnover,
      avg,
      extra: [a, b, c]
    };
  }
};

// src/parser/mac-quotation/board-list.ts
var BoardList = class extends BaseParser {
  constructor(boardType = 255 /* ALL */, start = 0, pageSize = 150) {
    super(4657, 1);
    const sortColumn = 0;
    const sortOrder = 1;
    const w = new BufferWriter();
    w.writeUInt16LE(pageSize);
    w.writeUInt16LE(boardType);
    w.writeUInt8(sortColumn);
    w.writeUInt8(sortOrder);
    w.writeUInt16LE(start);
    w.writeUInt16LE(1);
    w.skip(8);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data);
    const countAll = r.readUInt16LE();
    const total = r.readUInt16LE();
    const count = Math.floor(countAll / 2);
    const fmtLength = 156;
    const result = [];
    for (let i = 0; i < count; i++) {
      const row = new BufferReader(data, 4 + i * 160);
      const market = row.readUInt16LE();
      const code = row.readStringGBK(6);
      const pad1 = row.readBytes(16);
      const name = row.readStringGBK(44);
      const price = row.readFloatLE();
      const riseSpeed = row.readFloatLE();
      const preClose = row.readFloatLE();
      const symbolMarket = row.readUInt16LE();
      const symbolCode = row.readStringGBK(6);
      const pad2 = row.readBytes(16);
      const symbolName = row.readStringGBK(44);
      const symbolPrice = row.readFloatLE();
      const symbolRiseSpeed = row.readFloatLE();
      const symbolPreClose = row.readFloatLE();
      result.push({
        market: market <= 3 ? market : market,
        code,
        name,
        price,
        rise_speed: riseSpeed,
        pre_close: preClose,
        symbol_market: symbolMarket <= 3 ? symbolMarket : symbolMarket,
        symbol_code: symbolCode,
        symbol_name: symbolName,
        symbol_price: symbolPrice,
        symbol_rise_speed: symbolRiseSpeed,
        symbol_pre_close: symbolPreClose,
        pad1: pad1.toString("hex"),
        pad2: pad2.toString("hex")
      });
    }
    return { total, items: result };
  }
};

// src/parser/mac-quotation/symbol-belong-board.ts
var SymbolBelongBoard = class extends BaseParser {
  constructor(symbol, market) {
    super(4632, 1);
    this.customize = 1;
    const w = new BufferWriter();
    w.writeUInt16LE(market);
    w.writeStringGBK(symbol, 8);
    w.skip(16);
    w.writeStringGBK("Stock_GLHQ", 21);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data);
    r.readUInt16LE();
    const queryInfo = r.readBytes(12);
    r.skip(5);
    const ext = r.readBytes(8);
    const listRaw = data.subarray(27);
    let pythonList;
    try {
      pythonList = JSON.parse(decodeGBK(listRaw));
    } catch {
      pythonList = [];
    }
    const result = {
      data: [],
      query_info: queryInfo.toString("hex"),
      ext: ext.toString("hex")
    };
    if (pythonList.length > 0) {
      const firstRow = pythonList[0];
      const n = firstRow.length;
      let keys = null;
      if (n === 9) {
        keys = [
          "board_type",
          "market",
          "board_symbol",
          "board_symbol_name",
          "close",
          "pre_close",
          "\u6DA8\u505C\u6570",
          "\u8DCC\u505C\u6570",
          "\u6700\u76F8\u4F3C"
        ];
      } else if (n === 13) {
        keys = [
          "board_type",
          "market",
          "board_symbol",
          "board_symbol_name",
          "close",
          "pre_close",
          "speed_pct",
          "symbol_market",
          "symbol",
          "symbol_name",
          "symbol_close",
          "symbol_pre_close",
          "symbol_speed_pct"
        ];
      }
      if (keys) {
        for (const row of pythonList) {
          const d = {};
          for (let j = 0; j < keys.length; j++) {
            d[keys[j]] = row[j];
          }
          for (const col of ["close", "pre_close"]) {
            if (col in d && d[col] !== void 0) {
              try {
                d[col] = Number(d[col]);
              } catch {
              }
            }
          }
          result.data.push(d);
        }
      } else {
        result.data = pythonList;
      }
    }
    return result;
  }
};

// src/parser/mac-quotation/symbol-capital-flow.ts
var SymbolCapitalFlow = class extends BaseParser {
  constructor(symbol, market) {
    super(4632, 1);
    this.customize = 2;
    const w = new BufferWriter();
    w.writeUInt16LE(market);
    w.writeStringGBK(symbol, 8);
    w.skip(16);
    w.writeStringGBK("Stock_ZJLX", 21);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data);
    r.readUInt16LE();
    const queryInfo = r.readBytes(12);
    r.skip(5);
    const ext = r.readBytes(8);
    const listRaw = data.subarray(27);
    let pythonList;
    try {
      pythonList = JSON.parse(decodeGBK(listRaw));
    } catch {
      pythonList = [];
    }
    const result = {
      data: null,
      query_info: queryInfo.toString("hex"),
      ext: ext.toString("hex")
    };
    if (pythonList.length >= 2) {
      const todayData = pythonList[0];
      const fiveDaysData = pythonList[1];
      const keys = [
        "\u4ECA\u65E5\u4E3B\u529B\u6D41\u5165",
        "\u4ECA\u65E5\u4E3B\u529B\u6D41\u51FA",
        "\u4ECA\u65E5\u6563\u6237\u6D41\u5165",
        "\u4ECA\u65E5\u6563\u6237\u6D41\u51FA",
        "5\u65E5\u4E3B\u4E70",
        "5\u65E5\u4E3B\u5356",
        "5\u65E5\u8D85\u5927\u5355\u51C0\u989D",
        "5\u65E5\u5927\u5355\u51C0\u989D",
        "5\u65E5\u4E2D\u5355\u51C0\u989D",
        "5\u65E5\u5C0F\u5355\u51C0\u989D"
      ];
      const merged = [...todayData, ...fiveDaysData];
      const d = {};
      for (let i = 0; i < keys.length; i++) {
        try {
          d[keys[i]] = Number(merged[i]);
        } catch {
          d[keys[i]] = merged[i];
        }
      }
      d["\u4ECA\u65E5\u4E3B\u529B\u51C0\u6D41\u5165"] = Number(d["\u4ECA\u65E5\u4E3B\u529B\u6D41\u5165"]) - Number(d["\u4ECA\u65E5\u4E3B\u529B\u6D41\u51FA"]);
      d["\u4ECA\u65E5\u6563\u6237\u51C0\u6D41\u5165"] = Number(d["\u4ECA\u65E5\u6563\u6237\u6D41\u5165"]) - Number(d["\u4ECA\u65E5\u6563\u6237\u6D41\u51FA"]);
      d["5\u65E5\u4E3B\u529B\u51C0\u6D41\u5165"] = Number(d["5\u65E5\u4E3B\u4E70"]) - Number(d["5\u65E5\u4E3B\u5356"]);
      result.data = d;
    }
    return result;
  }
};

// src/parser/mac-quotation/symbol-auction.ts
var Auction = class extends BaseParser {
  isEx;
  constructor(market, code, start = 0, count = 500) {
    super(4669, 1);
    this.isEx = market > 3;
    const w = new BufferWriter();
    w.writeUInt16LE(market);
    w.writeStringGBK(code, 22);
    w.writeUInt32LE(start);
    w.writeUInt32LE(count);
    w.skip(10);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data);
    let market = r.readUInt16LE();
    const code = r.readStringGBK(22);
    const count = r.readUInt32LE();
    try {
      market = this.isEx ? market : market;
    } catch {
    }
    const items = [];
    for (let i = 0; i < count; i++) {
      const ir = new BufferReader(data, 36 + i * 16);
      const timeSec = ir.readUInt32LE();
      const price = ir.readFloatLE();
      const matched = ir.readUInt32LE();
      const unmatched = ir.readInt32LE();
      items.push({
        time: `${String(Math.floor(timeSec / 3600)).padStart(2, "0")}:${String(Math.floor(timeSec % 3600 / 60)).padStart(2, "0")}:${String(timeSec % 60).padStart(2, "0")}`,
        price,
        matched,
        unmatched
      });
    }
    return {
      market,
      code,
      items
    };
  }
};

// src/parser/mac-quotation/symbol-tick-charts.ts
function toDateNum3(v) {
  if (typeof v === "number") return v;
  return v.getFullYear() * 1e4 + (v.getMonth() + 1) * 100 + v.getDate();
}
var TickCharts = class extends BaseParser {
  isEx;
  constructor(market, code, queryDate, days = 5) {
    super(4670, 1);
    this.isEx = market > 3;
    const startDay = queryDate ? toDateNum3(queryDate) : 0;
    const w = new BufferWriter();
    w.writeUInt16LE(market);
    w.writeStringGBK(code, 22);
    w.writeUInt32LE(startDay);
    w.writeUInt16LE(days);
    w.writeUInt16LE(1);
    w.skip(6);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data);
    const market = r.readUInt16LE();
    const code = r.readStringGBK(22);
    const preCloseDates = [];
    const preClosePrices = [];
    for (let i = 0; i < 5; i++) preCloseDates.push(r.readUInt32LE());
    for (let i = 0; i < 5; i++) preClosePrices.push(r.readFloatLE());
    const count = r.readUInt16LE();
    const sendLast = r.readUInt8();
    const pageSize = r.readUInt16LE();
    const total = r.readUInt16LE();
    const charts = [];
    for (let d = 0; d < count; d++) {
      const ticks = [];
      for (let t = 0; t < pageSize; t++) {
        const index = d * pageSize + t;
        const tickOffset = 71 + index * 14;
        if (tickOffset + 14 > data.length) break;
        const tr = new BufferReader(data, tickOffset);
        const minutes = tr.readUInt16LE();
        const price = tr.readFloatLE();
        const avg = tr.readFloatLE();
        const vol = tr.readUInt16LE();
        const tickReserved = tr.readUInt16LE();
        ticks.push({
          minutes: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
          price,
          avg,
          vol,
          tick_reserved: tickReserved
        });
      }
      const ymd = preCloseDates[d];
      charts.push({
        date: `${String(Math.floor(ymd / 1e4)).padStart(4, "0")}-${String(Math.floor(ymd % 1e4 / 100)).padStart(2, "0")}-${String(ymd % 100).padStart(2, "0")}`,
        pre_close: preClosePrices[d],
        ticks
      });
    }
    const tailOffset = 71 + count * pageSize * 14;
    let meta = {};
    if (tailOffset + 120 <= data.length) {
      const tr = new BufferReader(data, tailOffset);
      const name = tr.readStringGBK(44);
      const decimal = tr.readUInt8();
      const category = tr.readUInt8();
      const volUnit = tr.readFloatLE();
      tr.skip(6);
      const dateRaw = tr.readUInt32LE();
      const timeRaw = tr.readUInt32LE();
      const preClose = tr.readFloatLE();
      const open = tr.readFloatLE();
      const high = tr.readFloatLE();
      const low = tr.readFloatLE();
      const close = tr.readFloatLE();
      const momentum = tr.readFloatLE();
      const vol = tr.readUInt32LE();
      const amount = tr.readFloatLE();
      const tailPad2 = tr.readBytes(12);
      const turnover = tr.readFloatLE();
      const avg = tr.readFloatLE();
      const industry = tr.readUInt32LE();
      meta = {
        name,
        decimal,
        category,
        vol_unit: volUnit,
        time: new Date(
          Math.floor(dateRaw / 1e4),
          Math.floor(dateRaw % 1e4 / 100) - 1,
          dateRaw % 100,
          Math.floor(timeRaw / 1e4),
          Math.floor(timeRaw % 1e4 / 100),
          timeRaw % 100
        ),
        pre_close: preClose,
        open,
        high,
        low,
        close,
        momentum,
        vol,
        amount,
        turnover,
        avg,
        industry,
        tail_pad: tailPad2.toString("hex")
      };
    }
    return {
      market: this.isEx ? market : market,
      code,
      charts,
      send_last: sendLast,
      ...meta
    };
  }
};

// src/parser/mac-quotation/unusual.ts
var Unusual = class extends BaseParser {
  constructor(market, start, count = 600) {
    super(4663);
    const w = new BufferWriter();
    w.writeUInt16LE(market);
    w.skip(2);
    w.writeUInt16LE(start);
    w.skip(2);
    w.writeUInt16LE(count);
    w.writeUInt16LE(1);
    w.writeUInt16LE(200);
    w.writeUInt16LE(30);
    w.writeUInt16LE(40);
    w.writeUInt16LE(50);
    w.writeUInt16LE(200);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data);
    const count = r.readUInt16LE();
    const results = [];
    for (let i = 0; i < count; i++) {
      const offset = 32 * i;
      const row = new BufferReader(data, offset + 2);
      const market = row.readUInt16LE();
      const code = row.readStringGBK(6);
      row.readUInt8();
      const unusualType = row.readUInt8();
      row.readUInt8();
      const index = row.readUInt16LE();
      row.readUInt16LE();
      const descVal = unpackByType(unusualType, data.subarray(offset + 17, offset + 30));
      const flag = data[offset + 30];
      const hour = data[offset + 31];
      const minuteSec = data.readUInt16LE(offset + 32);
      results.push({
        index,
        market,
        code,
        time: `${String(hour).padStart(2, "0")}:${String(Math.floor(minuteSec / 100)).padStart(2, "0")}:${String(minuteSec % 100).padStart(2, "0")}`,
        desc: descVal.desc,
        value: descVal.val,
        unusual_type: unusualType,
        v1: descVal.v1,
        v2: descVal.v2,
        v3: descVal.v3,
        v4: descVal.v4,
        flag
      });
    }
    const binaryLength = 2 + count * 32;
    const textBytes = data.subarray(binaryLength);
    const textList = decodeGBK(textBytes).replace(/,/g, "\0").split("\0").map((s) => s.trim()).filter(Boolean);
    for (let i = 0; i < results.length; i++) {
      if (i < textList.length) {
        results[i].name = textList[i];
      }
    }
    return results;
  }
};

// src/parser/mac-quotation/kline-offset.ts
var KlineOffset = class extends BaseParser {
  constructor(offset = 0, count = 128e3) {
    super(4682, 1);
    const w = new BufferWriter();
    w.writeUInt32LE(offset);
    w.writeUInt32LE(count);
    w.skip(5);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    if (data.length < 8) {
      return { total: 0, returned: 0 };
    }
    const total = data.readUInt32BE(0);
    const returned = data.readUInt32LE(4);
    return { total, returned };
  }
};

// src/parser/mac-quotation/server-info.ts
var ServerInfo = class extends BaseParser {
  constructor() {
    super(4623, 1);
    const header = Buffer.from("04002d31", "hex");
    this.body = Buffer.concat([
      header,
      Buffer.alloc(8, 0),
      Buffer.from([0, 39, 6, 14]),
      Buffer.alloc(52, 0)
    ]);
  }
  deserialize(data) {
    if (data.length < 87) return null;
    let pos = 0;
    const count = data.readUInt16LE(pos);
    pos += 2;
    const flags = data.subarray(pos, pos + 8).toString("hex");
    pos += 8;
    const tag = data.subarray(pos, pos + 3).toString("ascii").replace(/\0/g, "");
    pos += 3;
    pos += 9;
    function parseSession(p) {
      const sessions = [];
      for (let i = 0; i < 4; i++) {
        const openVal = data.readUInt16LE(p + i * 4);
        const closeVal = data.readUInt16LE(p + i * 4 + 2);
        sessions.push({
          open: `${Math.floor(openVal / 60)}:${String(openVal % 60).padStart(2, "0")}`,
          close: `${Math.floor(closeVal / 60)}:${String(closeVal % 60).padStart(2, "0")}`
        });
      }
      return sessions;
    }
    function parseDate(p) {
      const d = data.readUInt32LE(p);
      return [
        `${Math.floor(d / 1e4)}-${String(Math.floor(d % 1e4 / 100)).padStart(2, "0")}-${String(d % 100).padStart(2, "0")}`,
        p + 4
      ];
    }
    const [date1, newPos1] = parseDate(pos);
    pos = newPos1;
    const ts1 = data.readUInt32LE(pos);
    pos += 4;
    const sessions1 = parseSession(pos);
    pos += 16;
    const sessions2 = parseSession(pos);
    pos += 16;
    const flag = data[pos];
    pos += 1;
    const [date2, newPos2] = parseDate(pos);
    pos = newPos2;
    const ts2 = data.readUInt32LE(pos);
    pos += 4;
    const [date3, newPos3] = parseDate(pos);
    pos = newPos3;
    const ts3 = data.readUInt32LE(pos);
    pos += 4;
    const val1 = data.readUInt32LE(pos);
    pos += 4;
    const val2 = data.readUInt32LE(pos);
    pos += 4;
    const extra = pos < data.length ? data.subarray(pos).toString("hex") : "";
    return {
      count,
      flags,
      tag,
      today: date1,
      ts1,
      sessions_1: sessions1,
      sessions_2: sessions2,
      flag,
      last_trading_day: date2,
      ts2,
      last_trading_day_2: date3,
      ts3,
      market_param_1: val1,
      market_param_2: val2,
      extra
    };
  }
};

// src/parser/mac-quotation/heartbeat.ts
var HeartBeat = class extends BaseParser {
  constructor() {
    super(4608, 1);
    this.body = Buffer.alloc(10);
  }
  deserialize(data) {
    if (data.length < 2) return null;
    return { heartbeat: data.subarray(0, 2).toString("hex") };
  }
};

// src/parser/mac-quotation/file-query.ts
var FileList = class extends BaseParser {
  constructor(filename, offset = 0) {
    super(4629, 1);
    const w = new BufferWriter();
    w.writeUInt32LE(offset);
    w.writeStringGBK(filename, 70);
    w.skip(30);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data);
    const offset = r.readUInt32LE();
    const size = r.readUInt32LE();
    const flag = r.readInt8();
    const hash = r.readBytes(32);
    return {
      offset,
      size,
      flag,
      hash: hash.toString("ascii").replace(/\0/g, "")
    };
  }
};
var FileDownload = class extends BaseParser {
  constructor(filename, index = 1, offset = 0, size = 3e4) {
    super(4631, 1);
    const w = new BufferWriter();
    w.writeUInt32LE(index);
    w.writeUInt32LE(offset);
    w.writeUInt32LE(size);
    w.writeStringGBK(filename, 70);
    w.skip(30);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    if (data.length < 8) return null;
    const r = new BufferReader(data);
    const index = r.readUInt32LE();
    const size = r.readUInt32LE();
    const content = data.subarray(8);
    let text;
    try {
      text = decodeGBK(content);
    } catch {
      text = content.toString("hex");
    }
    return { index, size, content: text };
  }
};

// src/parser/mac-quotation/goods-list.ts
var MAX_COUNT = 1e3;
var GoodsList = class extends BaseParser {
  constructor(market, start = 0, count = 600) {
    super(9570, 1);
    if (count > MAX_COUNT) {
      throw new Error(`count cannot exceed ${MAX_COUNT}, current: ${count}`);
    }
    const w = new BufferWriter();
    w.writeUInt16LE(market);
    w.writeUInt32LE(start);
    w.writeUInt32LE(count);
    this.body = w.toBuffer();
  }
  deserialize(data) {
    const r = new BufferReader(data);
    const count = r.readUInt16LE();
    const result = [];
    for (let i = 0; i < count; i++) {
      const row = new BufferReader(data, 2 + i * 48);
      const category = row.readUInt16LE();
      const name = row.readStringGBK(23);
      const u = row.readUInt16LE();
      const index = row.readUInt32LE();
      const switch_ = row.readUInt8();
      const f1 = row.readFloatLE();
      const f2 = row.readFloatLE();
      const f3 = row.readFloatLE();
      const h1 = row.readUInt16LE();
      const h2 = row.readUInt16LE();
      let price;
      let volume;
      let change_pct;
      if (Math.abs(f1) < 100 && f3 > 0) {
        price = f3;
        volume = 0;
        change_pct = f1;
      } else {
        price = f1;
        volume = f2;
        change_pct = 0;
      }
      result.push({
        name,
        category,
        u,
        index,
        switch: switch_,
        price,
        volume,
        change_pct,
        h1,
        h2
      });
    }
    return result;
  }
};

// src/client/mac-client.ts
var MacClient = class extends BaseClient {
  constructor(hosts, port, options) {
    super(hosts, port, options);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _doHeartbeat = async () => {
    return this.call(new HeartBeat());
  };
  async login(showInfo = false) {
    try {
      const info = await this.call(new ServerInfo());
      if (showInfo) console.info("server info:", info);
      return info != null;
    } catch (e) {
      console.error("login failed:", e);
      return false;
    }
  }
};

// src/client/mac-mixin.ts
import * as iconv2 from "iconv-lite";
var MacQuotationMixin = class {
  _ack() {
    this.heartbeatManager?.ack();
  }
  _boardSymbolStr(sym) {
    if (typeof sym === "number") return String(sym);
    if (typeof sym === "object") return String(sym.code);
    return sym;
  }
  async getBoardCount(market) {
    return this._withRetry(async () => {
      this._ack();
      const result = await this.call(new BoardList(market));
      return result?.total ?? 0;
    });
  }
  async getBoardList(market, count = 1e4) {
    return this._withRetry(async () => {
      this._ack();
      const MAX_LIST_COUNT = 150;
      const securityList = [];
      const pageSize = Math.min(count, MAX_LIST_COUNT);
      for (let start = 0; start < count; start += pageSize) {
        const currentCount = Math.min(pageSize, count - start);
        const part = await this.call(new BoardList(market, start, currentCount));
        if (!part) break;
        if (part.items.length > 0) securityList.push(...part.items);
        if (part.items.length < currentCount) break;
      }
      return securityList;
    });
  }
  async getBoardMembersQuotes(boardSymbol = "881001", count = 1e5, sortType = 14 /* CHANGE_PCT */, sortOrder = 1 /* DESC */, fields, excludeFlags) {
    return this._withRetry(async () => {
      this._ack();
      const MAX_LIST_COUNT = 80;
      const securityList = [];
      for (let start = 0; start < count; start += MAX_LIST_COUNT) {
        const currentCount = Math.min(MAX_LIST_COUNT, count - start);
        const rs = await this.call(new BoardMembersQuotes(
          this._boardSymbolStr(boardSymbol),
          sortType,
          start,
          currentCount,
          sortOrder,
          fields ?? 10 /* COMMON */,
          excludeFlags
        ));
        if (!rs) break;
        if (rs.stocks.length > 0) securityList.push(...rs.stocks);
        if (rs.stocks.length < currentCount) break;
      }
      return securityList;
    });
  }
  async topBoardMembers(boardSymbol = "881001", count = 20, excludeFlags) {
    return this.getBoardMembersQuotes(
      boardSymbol,
      count,
      47 /* ACTIVITY */,
      1 /* DESC */,
      6 /* ENHANCED */,
      excludeFlags
    );
  }
  async getBoardMembers(boardSymbol = "881001", count = 1e5, sortType = 0 /* CODE */, sortOrder = 0 /* NONE */, excludeFlags) {
    return this._withRetry(async () => {
      this._ack();
      const MAX_LIST_COUNT = 80;
      const securityList = [];
      for (let start = 0; start < count; start += MAX_LIST_COUNT) {
        const currentCount = Math.min(MAX_LIST_COUNT, count - start);
        const rs = await this.call(new BoardMembersQuotes(
          this._boardSymbolStr(boardSymbol),
          sortType,
          start,
          currentCount,
          sortOrder,
          0 /* NONE */,
          excludeFlags
        ));
        if (!rs) break;
        if (rs.stocks.length > 0) securityList.push(...rs.stocks);
        if (rs.stocks.length < currentCount) break;
      }
      return securityList;
    });
  }
  async countBoardMembers(boardSymbol = "881001", count = 1, sortType = 0 /* CODE */, sortOrder = 0 /* NONE */, excludeFlags) {
    return this._withRetry(async () => {
      this._ack();
      return this.call(new BoardMembersQuotes(
        this._boardSymbolStr(boardSymbol),
        sortType,
        0,
        count,
        sortOrder,
        0 /* NONE */,
        excludeFlags
      ));
    });
  }
  async getSymbolBelongBoard(symbol, market) {
    return this._withRetry(async () => {
      this._ack();
      return this.call(new SymbolBelongBoard(symbol, market));
    });
  }
  async getSymbolZjlx(symbol, market) {
    return this._withRetry(async () => {
      this._ack();
      return this.call(new SymbolCapitalFlow(symbol, market));
    });
  }
  async getSymbolBars(market, code, period, times = 1, start = 0, count = 800, fq = 0 /* NONE */) {
    return this._withRetry(async () => {
      this._ack();
      const MAX_LIST_COUNT = 700;
      const pageSize = Math.min(count, MAX_LIST_COUNT);
      const securityList = [];
      for (let startPos = start; startPos < start + count; startPos += pageSize) {
        const currentCount = Math.min(pageSize, start + count - startPos);
        const result = await this.call(new SymbolBar(market, code, period, times, startPos, currentCount, fq));
        if (!result) break;
        const part = result.charts;
        for (const bar of part) {
          const b = bar;
          const fs = (b.float_shares || 0) * 1e4;
          b.float_shares = fs;
          b.turnover = fs && b.vol ? Math.round(b.vol / fs * 100 * 100) / 100 : 0;
        }
        if (part.length > 0) securityList.push(...part);
        if (part.length < currentCount) break;
      }
      return securityList;
    });
  }
  async getSymbolTickChart(market, code, queryDate) {
    return this._withRetry(async () => {
      this._ack();
      const result = await this.call(new SymbolTickChart(market, code, queryDate));
      if (result) {
        result.turnover = result.turnover / 1e4;
      }
      return result;
    });
  }
  async getSymbolQuotes(codeList, fields) {
    return this._withRetry(async () => {
      this._ack();
      const result = await this.call(new SymbolQuotes(codeList, fields ?? 10 /* COMMON */));
      return result?.stocks ?? [];
    });
  }
  async getSymbolTransactions(market, code, count = 1e5, start = 0, queryDate) {
    return this._withRetry(async () => {
      this._ack();
      const MAX_TRANSACTION_COUNT = 1e3;
      const transactionList = [];
      for (let currentStart = start; currentStart < start + count; currentStart += MAX_TRANSACTION_COUNT) {
        const currentCount = Math.min(MAX_TRANSACTION_COUNT, start + count - currentStart);
        const result = await this.call(new SymbolTransaction(market, code, currentCount, currentStart, queryDate));
        if (!result) break;
        if (result.transactions.length > 0) transactionList.push(...result.transactions);
        if (result.transactions.length < currentCount) break;
      }
      return transactionList;
    });
  }
  async getMarketMonitor(market, start = 0, count = 10) {
    return this._withRetry(async () => {
      this._ack();
      const results = [];
      let remaining = count || Infinity;
      let pos = start;
      while (remaining > 0) {
        const reqCount = Math.min(remaining, 600);
        const part = await this.call(new Unusual(market, pos, reqCount));
        results.push(...part);
        if (part.length < reqCount) break;
        remaining -= part.length;
        pos += part.length;
      }
      return results;
    });
  }
  async getAuction(market, code, start = 0, count = 500) {
    return this._withRetry(async () => {
      this._ack();
      return this.call(new Auction(market, code, start, count));
    });
  }
  async getMultiTickCharts(market, code, queryDate, days = 5) {
    return this._withRetry(async () => {
      this._ack();
      return this.call(new TickCharts(market, code, queryDate, days));
    });
  }
  async getSymbolInfo(market, code) {
    return this._withRetry(async () => {
      this._ack();
      return this.call(new SymbolInfo(market, code));
    });
  }
  async getKlineOffset(offset = 0, count = 128e3) {
    return this._withRetry(async () => {
      this._ack();
      return this.call(new KlineOffset(offset, count));
    });
  }
  async getServerInfo() {
    return this._withRetry(async () => {
      this._ack();
      return this.call(new ServerInfo());
    });
  }
  async getGoodsList(market, start = 0, count = 600) {
    return this._withRetry(async () => {
      this._ack();
      return this.call(new GoodsList(market, start, count));
    });
  }
  async downloadMacFile(filename, filesize = 0) {
    const meta = await this.call(new FileList(filename));
    if (!meta) return Buffer.alloc(0);
    const size = filesize || meta.size;
    const fileContent = [];
    const oneChunk = 3e4;
    const segments = Math.ceil(size / oneChunk);
    for (let seg = 0; seg < segments; seg++) {
      const chunkStart = seg * oneChunk;
      const piece = await this.call(new FileDownload(filename, seg + 1, chunkStart, oneChunk));
      if (!piece) break;
      const raw = typeof piece.content === "string" ? iconv2.encode(piece.content, "gbk") : piece.content;
      fileContent.push(raw);
    }
    return Buffer.concat(fileContent);
  }
};

// src/const/hosts.ts
var macHosts = [
  { name: "\u884C\u60C5\u4E3B\u7AD91", ip: "121.36.248.138", port: 7709 },
  { name: "\u884C\u60C5\u4E3B\u7AD92", ip: "123.60.47.136", port: 7709 },
  { name: "\u884C\u60C5\u4E3B\u7AD93", ip: "121.37.207.165", port: 7709 }
];
var macExHosts = [
  { name: "\u6269\u5C55\u884C\u60C51", ip: "116.205.135.205", port: 7727 },
  { name: "\u6269\u5C55\u884C\u60C52", ip: "121.37.232.167", port: 7727 }
];

// src/utils/mixin.ts
function applyMixin(target, mixin) {
  for (const name of Object.getOwnPropertyNames(mixin.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(
      target.prototype,
      name,
      Object.getOwnPropertyDescriptor(mixin.prototype, name)
    );
  }
}

// src/client/mac-standard-client.ts
var MacStandardClient = class extends MacClient {
  constructor(options) {
    super(macHosts, 7709, options);
  }
};
applyMixin(MacStandardClient, MacQuotationMixin);

// src/client/mac-extended-client.ts
var MacExtendedClient = class extends MacClient {
  constructor(options) {
    super(macExHosts, 7727, options);
  }
};
applyMixin(MacExtendedClient, MacQuotationMixin);

// src/tdx-client.ts
var TdxClient = class {
  _options;
  _quotationClient = null;
  _exQuotationClient = null;
  constructor(options = {}) {
    this._options = options;
  }
  async connect() {
    const q = this.qClient();
    if (!q.isConnected) {
      await q.connect();
      await q.login();
    }
    const eq = this.eqClient();
    if (!eq.isConnected) {
      await eq.connect();
      await eq.login();
    }
  }
  async disconnect() {
    if (this._quotationClient?.isConnected) await this._quotationClient.disconnect();
    if (this._exQuotationClient?.isConnected) await this._exQuotationClient.disconnect();
  }
  get quotationClient() {
    return this.qClient();
  }
  get exQuotationClient() {
    return this.eqClient();
  }
  qClient() {
    if (!this._quotationClient) {
      const client = new MacStandardClient({
        heartbeat: this._options.heartbeat ?? true,
        autoRetry: this._options.autoRetry ?? true,
        raiseException: this._options.raiseException ?? true
      });
      if (this._options.hosts) client.hosts = this._options.hosts;
      this._quotationClient = client;
    }
    return this._quotationClient;
  }
  eqClient() {
    if (!this._exQuotationClient) {
      const client = new MacExtendedClient({
        heartbeat: this._options.heartbeat ?? true,
        autoRetry: this._options.autoRetry ?? true,
        raiseException: this._options.raiseException ?? true
      });
      if (this._options.exHosts) client.hosts = this._options.exHosts;
      this._exQuotationClient = client;
    }
    return this._exQuotationClient;
  }
  // ── A股 — K线 / 分时 / 成交 / 竞价 / 异动 ──
  async stockKline(market, code, period, start = 0, count = 800, times = 1, adjust = 0 /* NONE */) {
    return this.qClient().getSymbolBars(market, code, period, times, start, count, adjust);
  }
  async stockTickChart(market, code, date) {
    const result = await this.qClient().getSymbolTickChart(market, code, date);
    return result?.charts ?? [];
  }
  async stockTransaction(market, code, date) {
    const n = date ? 2e3 : 1800;
    return this.qClient().getSymbolTransactions(market, code, n, 0, date);
  }
  async stockAuction(market, code) {
    return this.qClient().getAuction(market, code);
  }
  async stockUnusual(market, start = 0, count = 0) {
    return this.qClient().getMarketMonitor(market, start, count);
  }
  // ── A股 — 板块 / 资金流向 / 主力监控 ──
  async stockBoardList(market = 255 /* ALL */, count = 1e4) {
    return this.qClient().getBoardList(market, count);
  }
  async stockBoardMembers(boardSymbol = "881001", count = 1e5, sortType = 14 /* CHANGE_PCT */, sortOrder = 1 /* DESC */, fields) {
    return this.qClient().getBoardMembersQuotes(boardSymbol, count, sortType, sortOrder, fields);
  }
  async stockBoardTopMembers(boardSymbol = "881001", count = 20) {
    return this.qClient().topBoardMembers(boardSymbol, count);
  }
  async stockBelongBoard(market, code) {
    return this.qClient().getSymbolBelongBoard(code, market);
  }
  async stockCapitalFlow(market, code) {
    return this.qClient().getSymbolZjlx(code, market);
  }
  async stockQuotesFields(codeList, fields) {
    return this.qClient().getSymbolQuotes(codeList, fields);
  }
  async stockMarketMonitor(market, start = 0, count = 10) {
    return this.qClient().getMarketMonitor(market, start, count);
  }
  // ── A股 — 多日分时 / K线偏移 / 个股特征 / 服务器信息 ──
  async stockTickCharts(market, code, queryDate, days = 5) {
    return this.qClient().getMultiTickCharts(market, code, queryDate, days);
  }
  async stockKlineOffset(offset = 0, count = 128e3) {
    return this.qClient().getKlineOffset(offset, count);
  }
  async stockSymbolInfo(market, code) {
    return this.qClient().getSymbolInfo(market, code);
  }
  async serverInfo() {
    return this.qClient().getServerInfo();
  }
  async downloadFile(filename, filesize = 0) {
    return this.qClient().downloadMacFile(filename, filesize);
  }
  // ── 扩展市场 — 品种 / 报价 / K线 / 分时 / 成交（7727） ──
  async goodsVarieties(market, start = 0, count = 600) {
    return this.eqClient().getGoodsList(market, start, count);
  }
  async goodsQuotes(codeList, code) {
    const list = normalizeExCodeList(codeList, code);
    return this.eqClient().getSymbolQuotes(list);
  }
  async goodsKline(market, code, period, start = 0, count = 800, times = 1) {
    return this.eqClient().getSymbolBars(market, code, period, times, start, count);
  }
  async goodsTickChart(market, code, date) {
    const result = await this.eqClient().getSymbolTickChart(market, code, date);
    return result?.charts ?? [];
  }
  async goodsHistoryTransaction(market, code, date) {
    return this.eqClient().getSymbolTransactions(market, code, 2e3, 0, date);
  }
};
function normalizeExCodeList(codeList, code) {
  if (code !== void 0) return [[codeList, code]];
  if (Array.isArray(codeList) && codeList.length === 2 && !Array.isArray(codeList[0])) {
    return [codeList];
  }
  return codeList;
}

// src/store/persist.ts
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join as join2, isAbsolute, dirname as dirname2 } from "path";
import { tmpdir } from "os";

// node_modules/hyparquet/src/constants.js
var ParquetTypes = [
  "BOOLEAN",
  "INT32",
  "INT64",
  "INT96",
  // deprecated
  "FLOAT",
  "DOUBLE",
  "BYTE_ARRAY",
  "FIXED_LEN_BYTE_ARRAY"
];
var Encodings = [
  "PLAIN",
  "GROUP_VAR_INT",
  // deprecated
  "PLAIN_DICTIONARY",
  "RLE",
  "BIT_PACKED",
  // deprecated
  "DELTA_BINARY_PACKED",
  "DELTA_LENGTH_BYTE_ARRAY",
  "DELTA_BYTE_ARRAY",
  "RLE_DICTIONARY",
  "BYTE_STREAM_SPLIT"
];
var FieldRepetitionTypes = [
  "REQUIRED",
  "OPTIONAL",
  "REPEATED"
];
var ConvertedTypes = [
  "UTF8",
  "MAP",
  "MAP_KEY_VALUE",
  "LIST",
  "ENUM",
  "DECIMAL",
  "DATE",
  "TIME_MILLIS",
  "TIME_MICROS",
  "TIMESTAMP_MILLIS",
  "TIMESTAMP_MICROS",
  "UINT_8",
  "UINT_16",
  "UINT_32",
  "UINT_64",
  "INT_8",
  "INT_16",
  "INT_32",
  "INT_64",
  "JSON",
  "BSON",
  "INTERVAL"
];
var CompressionCodecs = [
  "UNCOMPRESSED",
  "SNAPPY",
  "GZIP",
  "LZO",
  "BROTLI",
  "LZ4",
  "ZSTD",
  "LZ4_RAW"
];
var PageTypes = [
  "DATA_PAGE",
  "INDEX_PAGE",
  "DICTIONARY_PAGE",
  "DATA_PAGE_V2"
];
var BoundaryOrders = [
  "UNORDERED",
  "ASCENDING",
  "DESCENDING"
];
var EdgeInterpolationAlgorithms = [
  "SPHERICAL",
  "VINCENTY",
  "THOMAS",
  "ANDOYER",
  "KARNEY"
];

// node_modules/hyparquet/src/wkb.js
function wkbToGeojson(reader) {
  const flags = getFlags(reader);
  if (flags.type === 1) {
    return { type: "Point", coordinates: readPosition(reader, flags) };
  } else if (flags.type === 2) {
    return { type: "LineString", coordinates: readLine(reader, flags) };
  } else if (flags.type === 3) {
    return { type: "Polygon", coordinates: readPolygon(reader, flags) };
  } else if (flags.type === 4) {
    const points = [];
    for (let i = 0; i < flags.count; i++) {
      points.push(readPosition(reader, getFlags(reader)));
    }
    return { type: "MultiPoint", coordinates: points };
  } else if (flags.type === 5) {
    const lines = [];
    for (let i = 0; i < flags.count; i++) {
      lines.push(readLine(reader, getFlags(reader)));
    }
    return { type: "MultiLineString", coordinates: lines };
  } else if (flags.type === 6) {
    const polygons = [];
    for (let i = 0; i < flags.count; i++) {
      polygons.push(readPolygon(reader, getFlags(reader)));
    }
    return { type: "MultiPolygon", coordinates: polygons };
  } else if (flags.type === 7) {
    const geometries = [];
    for (let i = 0; i < flags.count; i++) {
      geometries.push(wkbToGeojson(reader));
    }
    return { type: "GeometryCollection", geometries };
  } else {
    throw new Error(`Unsupported geometry type: ${flags.type}`);
  }
}
function getFlags(reader) {
  const { view } = reader;
  const littleEndian = view.getUint8(reader.offset++) === 1;
  const rawType = view.getUint32(reader.offset, littleEndian);
  reader.offset += 4;
  const type = rawType % 1e3;
  const flags = Math.floor(rawType / 1e3);
  let count = 0;
  if (type > 1 && type <= 7) {
    count = view.getUint32(reader.offset, littleEndian);
    reader.offset += 4;
  }
  let dim = 2;
  if (flags) dim++;
  if (flags === 3) dim++;
  return { littleEndian, type, dim, count };
}
function readPosition(reader, flags) {
  const points = [];
  for (let i = 0; i < flags.dim; i++) {
    const coord = reader.view.getFloat64(reader.offset, flags.littleEndian);
    reader.offset += 8;
    points.push(coord);
  }
  return points;
}
function readLine(reader, flags) {
  const points = [];
  for (let i = 0; i < flags.count; i++) {
    points.push(readPosition(reader, flags));
  }
  return points;
}
function readPolygon(reader, flags) {
  const { view } = reader;
  const rings = [];
  for (let r = 0; r < flags.count; r++) {
    const count = view.getUint32(reader.offset, flags.littleEndian);
    reader.offset += 4;
    rings.push(readLine(reader, { ...flags, count }));
  }
  return rings;
}

// node_modules/hyparquet/src/convert.js
var decoder = new TextDecoder();
var DEFAULT_PARSERS = {
  timestampFromMilliseconds(millis) {
    return new Date(Number(millis));
  },
  timestampFromMicroseconds(micros) {
    return new Date(Number(micros / 1000n));
  },
  timestampFromNanoseconds(nanos) {
    return new Date(Number(nanos / 1000000n));
  },
  dateFromDays(days) {
    return new Date(days * 864e5);
  },
  stringFromBytes(bytes) {
    return bytes && decoder.decode(bytes);
  },
  jsonFromBytes(bytes) {
    return bytes && JSON.parse(decoder.decode(bytes));
  },
  geometryFromBytes(bytes) {
    return bytes && wkbToGeojson({ view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 });
  },
  geographyFromBytes(bytes) {
    return bytes && wkbToGeojson({ view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 });
  },
  uuidFromBytes(bytes) {
    if (!bytes) return void 0;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20, 32);
  }
};
function convertWithDictionary(data, dictionary, encoding, columnDecoder) {
  if (dictionary && encoding.endsWith("_DICTIONARY")) {
    let output = data;
    if (data instanceof Uint8Array && !(dictionary instanceof Uint8Array)) {
      output = new dictionary.constructor(data.length);
    }
    for (let i = 0; i < data.length; i++) {
      output[i] = dictionary[data[i]];
    }
    return output;
  } else {
    return convert(data, columnDecoder);
  }
}
function convert(data, columnDecoder) {
  const { element, parsers, utf8 = true, schemaPath } = columnDecoder;
  const { type, converted_type: ctype, logical_type: ltype } = element;
  const nullable = element.repetition_type !== "REQUIRED";
  const isVariant = schemaPath?.some((s) => s.element.logical_type?.type === "VARIANT");
  if (isVariant && type === "BYTE_ARRAY" && ctype !== "UTF8" && ltype?.type !== "STRING") {
    return data;
  }
  if (ctype === "DECIMAL") {
    const scale = element.scale || 0;
    const factor = 10 ** -scale;
    const arr = new Array(data.length);
    for (let i = 0; i < arr.length; i++) {
      if (data[i] instanceof Uint8Array) {
        arr[i] = parseDecimal(data[i]) * factor;
      } else {
        arr[i] = Number(data[i]) * factor;
      }
    }
    return arr;
  }
  if (!ctype && type === "INT96") {
    return Array.from(data).map((v) => parsers.timestampFromNanoseconds(parseInt96Nanos(v)));
  }
  if (ctype === "DATE") {
    return Array.from(data).map((v) => parsers.dateFromDays(v));
  }
  if (ctype === "TIMESTAMP_MILLIS") {
    return Array.from(data).map((v) => parsers.timestampFromMilliseconds(v));
  }
  if (ctype === "TIMESTAMP_MICROS") {
    return Array.from(data).map((v) => parsers.timestampFromMicroseconds(v));
  }
  if (ctype === "JSON") {
    return data.map((v) => parsers.jsonFromBytes(v));
  }
  if (ctype === "BSON") {
    throw new Error("parquet bson not supported");
  }
  if (ctype === "INTERVAL") {
    throw new Error("parquet interval not supported");
  }
  if (ltype?.type === "GEOMETRY") {
    return data.map((v) => parsers.geometryFromBytes(v));
  }
  if (ltype?.type === "GEOGRAPHY") {
    return data.map((v) => parsers.geographyFromBytes(v));
  }
  if (ltype?.type === "UUID") {
    return data.map((v) => parsers.uuidFromBytes(v));
  }
  if (ctype === "UTF8" || ltype?.type === "STRING" || utf8 && type === "BYTE_ARRAY") {
    return data.map((v) => parsers.stringFromBytes(v));
  }
  if (ctype === "UINT_64" || ltype?.type === "INTEGER" && ltype.bitWidth === 64 && !ltype.isSigned) {
    if (data instanceof BigInt64Array) return new BigUint64Array(data.buffer, data.byteOffset, data.length);
    const arr = nullable ? new Array(data.length) : new BigUint64Array(data.length);
    for (let i = 0; i < arr.length; i++) arr[i] = data[i];
    return arr;
  }
  if (ctype === "UINT_32" || ltype?.type === "INTEGER" && ltype.bitWidth === 32 && !ltype.isSigned) {
    if (data instanceof Int32Array) return new Uint32Array(data.buffer, data.byteOffset, data.length);
    const arr = nullable ? new Array(data.length) : new Uint32Array(data.length);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = data[i] < 0 ? 4294967296 + data[i] : data[i];
    }
    return arr;
  }
  if (ltype?.type === "FLOAT16") {
    return Array.from(data).map(parseFloat16);
  }
  if (ltype?.type === "TIMESTAMP") {
    const { unit } = ltype;
    let parser = parsers.timestampFromMilliseconds;
    if (unit === "MICROS") parser = parsers.timestampFromMicroseconds;
    if (unit === "NANOS") parser = parsers.timestampFromNanoseconds;
    const arr = new Array(data.length);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = parser(data[i]);
    }
    return arr;
  }
  return data;
}
function parseDecimal(bytes) {
  if (!bytes.length) return 0;
  let value = 0n;
  for (const byte of bytes) {
    value = value * 256n + BigInt(byte);
  }
  const bits = bytes.length * 8;
  if (value >= 2n ** BigInt(bits - 1)) {
    value -= 2n ** BigInt(bits);
  }
  return Number(value);
}
function parseInt96Nanos(value) {
  const days = (value >> 64n) - 2440588n;
  const nano = value & 0xffffffffffffffffn;
  return days * 86400000000000n + nano;
}
function parseFloat16(bytes) {
  if (!bytes) return void 0;
  const int16 = bytes[1] << 8 | bytes[0];
  const sign = int16 >> 15 ? -1 : 1;
  const exp = int16 >> 10 & 31;
  const frac = int16 & 1023;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

// node_modules/hyparquet/src/schema.js
function schemaTree(schema, rootIndex, path) {
  const element = schema[rootIndex];
  const children = [];
  let count = 1;
  if (element.num_children) {
    while (children.length < element.num_children) {
      const childElement = schema[rootIndex + count];
      const child = schemaTree(schema, rootIndex + count, [...path, childElement.name]);
      count += child.count;
      children.push(child);
    }
  }
  return { count, element, children, path };
}
function getSchemaPath(schema, name) {
  let tree = schemaTree(schema, 0, []);
  const path = [tree];
  for (const part of name) {
    const child = tree.children.find((child2) => child2.element.name === part);
    if (!child) throw new Error(`parquet schema element not found: ${name}`);
    path.push(child);
    tree = child;
  }
  return path;
}
function getPhysicalColumns(schemaTree2) {
  const columns = [];
  function traverse(node) {
    if (node.children.length) {
      for (const child of node.children) {
        traverse(child);
      }
    } else {
      columns.push(node.path.join("."));
    }
  }
  traverse(schemaTree2);
  return columns;
}
function getMaxRepetitionLevel(schemaPath) {
  let maxLevel = 0;
  for (const { element } of schemaPath) {
    if (element.repetition_type === "REPEATED") {
      maxLevel++;
    }
  }
  return maxLevel;
}
function getMaxDefinitionLevel(schemaPath) {
  let maxLevel = 0;
  for (const { element } of schemaPath.slice(1)) {
    if (element.repetition_type !== "REQUIRED") {
      maxLevel++;
    }
  }
  return maxLevel;
}
function isListLike(schema) {
  if (!schema) return false;
  if (schema.element.converted_type !== "LIST") return false;
  if (schema.children.length > 1) return false;
  const firstChild = schema.children[0];
  if (firstChild.children.length > 1) return false;
  if (firstChild.element.repetition_type !== "REPEATED") return false;
  return true;
}
function isMapLike(schema) {
  if (!schema) return false;
  if (schema.element.converted_type !== "MAP") return false;
  if (schema.children.length > 1) return false;
  const firstChild = schema.children[0];
  if (firstChild.children.length !== 2) return false;
  if (firstChild.element.repetition_type !== "REPEATED") return false;
  const keyChild = firstChild.children.find((child) => child.element.name === "key");
  if (keyChild?.element.repetition_type === "REPEATED") return false;
  const valueChild = firstChild.children.find((child) => child.element.name === "value");
  if (valueChild?.element.repetition_type === "REPEATED") return false;
  return true;
}
function isFlatColumn(schemaPath) {
  if (schemaPath.length !== 2) return false;
  const [, column] = schemaPath;
  if (column.element.repetition_type === "REPEATED") return false;
  if (column.children.length) return false;
  return true;
}

// node_modules/hyparquet/src/thrift.js
var STOP = 0;
var TRUE = 1;
var FALSE = 2;
var BYTE = 3;
var I16 = 4;
var I32 = 5;
var I64 = 6;
var DOUBLE = 7;
var BINARY = 8;
var LIST = 9;
var STRUCT = 12;
function deserializeTCompactProtocol(reader) {
  const value = {};
  let fid = 0;
  while (reader.offset < reader.view.byteLength) {
    const byte = reader.view.getUint8(reader.offset++);
    const type = byte & 15;
    if (type === STOP) break;
    const delta = byte >> 4;
    fid = delta ? fid + delta : readZigZag(reader);
    value[`field_${fid}`] = readElement(reader, type);
  }
  return value;
}
function readElement(reader, type) {
  switch (type) {
    case TRUE:
      return true;
    case FALSE:
      return false;
    case BYTE:
      return reader.view.getInt8(reader.offset++);
    case I16:
    case I32:
      return readZigZag(reader);
    case I64:
      return readZigZagBigInt(reader);
    case DOUBLE: {
      const value = reader.view.getFloat64(reader.offset, true);
      reader.offset += 8;
      return value;
    }
    case BINARY: {
      const stringLength = readVarInt(reader);
      const strBytes = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, stringLength);
      reader.offset += stringLength;
      return strBytes;
    }
    case LIST: {
      const byte = reader.view.getUint8(reader.offset++);
      const elemType = byte & 15;
      let listSize = byte >> 4;
      if (listSize === 15) {
        listSize = readVarInt(reader);
      }
      const boolType = elemType === TRUE || elemType === FALSE;
      const values = new Array(listSize);
      for (let i = 0; i < listSize; i++) {
        values[i] = boolType ? readElement(reader, BYTE) === 1 : readElement(reader, elemType);
      }
      return values;
    }
    case STRUCT:
      return deserializeTCompactProtocol(reader);
    default:
      throw new Error(`thrift unhandled type: ${type}`);
  }
}
function readVarInt(reader) {
  let result = 0;
  let shift = 0;
  while (true) {
    const byte = reader.view.getUint8(reader.offset++);
    result |= (byte & 127) << shift;
    if (!(byte & 128)) {
      return result;
    }
    shift += 7;
  }
}
function readVarBigInt(reader) {
  let result = 0n;
  let shift = 0n;
  while (true) {
    const byte = reader.view.getUint8(reader.offset++);
    result |= BigInt(byte & 127) << shift;
    if (!(byte & 128)) {
      return result;
    }
    shift += 7n;
  }
}
function readZigZag(reader) {
  const zigzag = readVarInt(reader);
  return zigzag >>> 1 ^ -(zigzag & 1);
}
function readZigZagBigInt(reader) {
  const zigzag = readVarBigInt(reader);
  return zigzag >> 1n ^ -(zigzag & 1n);
}

// node_modules/hyparquet/src/geoparquet.js
function markGeoColumns(schema, key_value_metadata) {
  const columns = /* @__PURE__ */ new Map();
  const geo = key_value_metadata?.find(({ key }) => key === "geo")?.value;
  const decodedColumns = (geo && JSON.parse(geo)?.columns) ?? {};
  for (const [name, column] of Object.entries(decodedColumns)) {
    if (column.encoding !== "WKB") continue;
    const type = column.edges === "spherical" ? "GEOGRAPHY" : "GEOMETRY";
    const id = column.crs?.id ?? column.crs?.ids?.[0];
    const crs = id ? `${id.authority}:${id.code.toString()}` : void 0;
    columns.set(name, { type, crs });
  }
  for (let i = 1; i < schema.length; i++) {
    const { logical_type, name, num_children, type } = schema[i];
    if (num_children) {
      i += num_children;
      continue;
    }
    if (type === "BYTE_ARRAY" && !logical_type) {
      schema[i].logical_type = columns.get(name);
    }
  }
}

// node_modules/hyparquet/src/metadata.js
var defaultInitialFetchSize = 1 << 19;
var decoder2 = new TextDecoder();
function decode(value) {
  return value && decoder2.decode(value);
}
async function parquetMetadataAsync(asyncBuffer, { parsers, initialFetchSize = defaultInitialFetchSize, geoparquet = true } = {}) {
  if (!asyncBuffer || !(asyncBuffer.byteLength >= 0)) throw new Error("parquet expected AsyncBuffer");
  const footerOffset = Math.max(0, asyncBuffer.byteLength - initialFetchSize);
  const footerBuffer = await asyncBuffer.slice(footerOffset, asyncBuffer.byteLength);
  const footerView = new DataView(footerBuffer);
  if (footerView.getUint32(footerBuffer.byteLength - 4, true) !== 827474256) {
    throw new Error("parquet file invalid (footer != PAR1)");
  }
  const metadataLength = footerView.getUint32(footerBuffer.byteLength - 8, true);
  if (metadataLength > asyncBuffer.byteLength - 8) {
    throw new Error(`parquet metadata length ${metadataLength} exceeds available buffer ${asyncBuffer.byteLength - 8}`);
  }
  if (metadataLength + 8 > initialFetchSize) {
    const metadataOffset = asyncBuffer.byteLength - metadataLength - 8;
    const metadataBuffer = await asyncBuffer.slice(metadataOffset, footerOffset);
    const combinedBuffer = new ArrayBuffer(metadataLength + 8);
    const combinedView = new Uint8Array(combinedBuffer);
    combinedView.set(new Uint8Array(metadataBuffer));
    combinedView.set(new Uint8Array(footerBuffer), footerOffset - metadataOffset);
    return parquetMetadata(combinedBuffer, { parsers, geoparquet });
  } else {
    return parquetMetadata(footerBuffer, { parsers, geoparquet });
  }
}
function parquetMetadata(arrayBuffer, { parsers, geoparquet = true } = {}) {
  if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error("parquet expected ArrayBuffer");
  const view = new DataView(arrayBuffer);
  parsers = { ...DEFAULT_PARSERS, ...parsers };
  if (view.byteLength < 8) {
    throw new Error("parquet file is too short");
  }
  if (view.getUint32(view.byteLength - 4, true) !== 827474256) {
    throw new Error("parquet file invalid (footer != PAR1)");
  }
  const metadataLengthOffset = view.byteLength - 8;
  const metadataLength = view.getUint32(metadataLengthOffset, true);
  if (metadataLength > view.byteLength - 8) {
    throw new Error(`parquet metadata length ${metadataLength} exceeds available buffer ${view.byteLength - 8}`);
  }
  const metadataOffset = metadataLengthOffset - metadataLength;
  const reader = { view, offset: metadataOffset };
  const metadata = deserializeTCompactProtocol(reader);
  const version = metadata.field_1;
  const schema = metadata.field_2.map((field) => ({
    type: ParquetTypes[field.field_1],
    type_length: field.field_2,
    repetition_type: FieldRepetitionTypes[field.field_3],
    name: decode(field.field_4),
    num_children: field.field_5,
    converted_type: ConvertedTypes[field.field_6],
    scale: field.field_7,
    precision: field.field_8,
    field_id: field.field_9,
    logical_type: logicalType(field.field_10)
  }));
  const columnSchema = schema.filter((e) => e.type);
  const num_rows = metadata.field_3;
  const row_groups = metadata.field_4.map((rowGroup) => ({
    columns: rowGroup.field_1.map((column, columnIndex) => ({
      file_path: decode(column.field_1),
      file_offset: column.field_2,
      meta_data: column.field_3 && {
        type: ParquetTypes[column.field_3.field_1],
        encodings: column.field_3.field_2?.map((e) => Encodings[e]),
        path_in_schema: column.field_3.field_3.map(decode),
        codec: CompressionCodecs[column.field_3.field_4],
        num_values: column.field_3.field_5,
        total_uncompressed_size: column.field_3.field_6,
        total_compressed_size: column.field_3.field_7,
        key_value_metadata: column.field_3.field_8?.map((kv) => ({
          key: decode(kv.field_1),
          value: decode(kv.field_2)
        })),
        data_page_offset: column.field_3.field_9,
        index_page_offset: column.field_3.field_10,
        dictionary_page_offset: column.field_3.field_11,
        statistics: convertStats(column.field_3.field_12, columnSchema[columnIndex], parsers),
        encoding_stats: column.field_3.field_13?.map((encodingStat) => ({
          page_type: PageTypes[encodingStat.field_1],
          encoding: Encodings[encodingStat.field_2],
          count: encodingStat.field_3
        })),
        bloom_filter_offset: column.field_3.field_14,
        bloom_filter_length: column.field_3.field_15,
        size_statistics: column.field_3.field_16 && {
          unencoded_byte_array_data_bytes: column.field_3.field_16.field_1,
          repetition_level_histogram: column.field_3.field_16.field_2,
          definition_level_histogram: column.field_3.field_16.field_3
        },
        geospatial_statistics: column.field_3.field_17 && {
          bbox: column.field_3.field_17.field_1 && {
            xmin: column.field_3.field_17.field_1.field_1,
            xmax: column.field_3.field_17.field_1.field_2,
            ymin: column.field_3.field_17.field_1.field_3,
            ymax: column.field_3.field_17.field_1.field_4,
            zmin: column.field_3.field_17.field_1.field_5,
            zmax: column.field_3.field_17.field_1.field_6,
            mmin: column.field_3.field_17.field_1.field_7,
            mmax: column.field_3.field_17.field_1.field_8
          },
          geospatial_types: column.field_3.field_17.field_2
        }
      },
      offset_index_offset: column.field_4,
      offset_index_length: column.field_5,
      column_index_offset: column.field_6,
      column_index_length: column.field_7,
      crypto_metadata: column.field_8,
      encrypted_column_metadata: column.field_9
    })),
    total_byte_size: rowGroup.field_2,
    num_rows: rowGroup.field_3,
    sorting_columns: rowGroup.field_4?.map((sortingColumn) => ({
      column_idx: sortingColumn.field_1,
      descending: sortingColumn.field_2,
      nulls_first: sortingColumn.field_3
    })),
    file_offset: rowGroup.field_5,
    total_compressed_size: rowGroup.field_6,
    ordinal: rowGroup.field_7
  }));
  const key_value_metadata = metadata.field_5?.map((kv) => ({
    key: decode(kv.field_1),
    value: decode(kv.field_2)
  }));
  const created_by = decode(metadata.field_6);
  if (geoparquet) {
    markGeoColumns(schema, key_value_metadata);
  }
  return {
    version,
    schema,
    num_rows,
    row_groups,
    key_value_metadata,
    created_by,
    metadata_length: metadataLength
  };
}
function parquetSchema({ schema }) {
  return getSchemaPath(schema, [])[0];
}
function logicalType(logicalType2) {
  if (logicalType2?.field_1) return { type: "STRING" };
  if (logicalType2?.field_2) return { type: "MAP" };
  if (logicalType2?.field_3) return { type: "LIST" };
  if (logicalType2?.field_4) return { type: "ENUM" };
  if (logicalType2?.field_5) return {
    type: "DECIMAL",
    scale: logicalType2.field_5.field_1,
    precision: logicalType2.field_5.field_2
  };
  if (logicalType2?.field_6) return { type: "DATE" };
  if (logicalType2?.field_7) return {
    type: "TIME",
    isAdjustedToUTC: logicalType2.field_7.field_1,
    unit: timeUnit(logicalType2.field_7.field_2)
  };
  if (logicalType2?.field_8) return {
    type: "TIMESTAMP",
    isAdjustedToUTC: logicalType2.field_8.field_1,
    unit: timeUnit(logicalType2.field_8.field_2)
  };
  if (logicalType2?.field_10) return {
    type: "INTEGER",
    bitWidth: logicalType2.field_10.field_1,
    isSigned: logicalType2.field_10.field_2
  };
  if (logicalType2?.field_11) return { type: "NULL" };
  if (logicalType2?.field_12) return { type: "JSON" };
  if (logicalType2?.field_13) return { type: "BSON" };
  if (logicalType2?.field_14) return { type: "UUID" };
  if (logicalType2?.field_15) return { type: "FLOAT16" };
  if (logicalType2?.field_16) return {
    type: "VARIANT",
    specification_version: logicalType2.field_16.field_1
  };
  if (logicalType2?.field_17) return {
    type: "GEOMETRY",
    crs: decode(logicalType2.field_17.field_1)
  };
  if (logicalType2?.field_18) return {
    type: "GEOGRAPHY",
    crs: decode(logicalType2.field_18.field_1),
    algorithm: EdgeInterpolationAlgorithms[logicalType2.field_18.field_2]
  };
  return logicalType2;
}
function timeUnit(unit) {
  if (unit.field_1) return "MILLIS";
  if (unit.field_2) return "MICROS";
  if (unit.field_3) return "NANOS";
  throw new Error("parquet time unit required");
}
function convertStats(stats, schema, parsers) {
  return stats && {
    max: convertMetadata(stats.field_1, schema, parsers),
    min: convertMetadata(stats.field_2, schema, parsers),
    null_count: stats.field_3,
    distinct_count: stats.field_4,
    max_value: convertMetadata(stats.field_5, schema, parsers),
    min_value: convertMetadata(stats.field_6, schema, parsers),
    is_max_value_exact: stats.field_7,
    is_min_value_exact: stats.field_8
  };
}
function convertMetadata(value, schema, parsers) {
  const { type, converted_type, logical_type } = schema;
  if (value === void 0) return value;
  if (type === "BOOLEAN") return value[0] === 1;
  if (type === "BYTE_ARRAY") return parsers.stringFromBytes(value);
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  if (type === "FLOAT" && view.byteLength === 4) return view.getFloat32(0, true);
  if (type === "DOUBLE" && view.byteLength === 8) return view.getFloat64(0, true);
  if (type === "INT32" && converted_type === "DECIMAL" && view.byteLength === 4) {
    return view.getInt32(0, true) * 10 ** -(schema.scale || 0);
  }
  if (type === "INT64" && converted_type === "DECIMAL" && view.byteLength === 8) {
    return Number(view.getBigInt64(0, true)) * 10 ** -(schema.scale || 0);
  }
  if (type === "INT32" && converted_type === "DATE") return parsers.dateFromDays(view.getInt32(0, true));
  if (type === "INT64" && converted_type === "TIMESTAMP_MILLIS") return parsers.timestampFromMilliseconds(view.getBigInt64(0, true));
  if (type === "INT64" && converted_type === "TIMESTAMP_MICROS") return parsers.timestampFromMicroseconds(view.getBigInt64(0, true));
  if (type === "INT64" && logical_type?.type === "TIMESTAMP" && logical_type?.unit === "NANOS") return parsers.timestampFromNanoseconds(view.getBigInt64(0, true));
  if (type === "INT64" && logical_type?.type === "TIMESTAMP" && logical_type?.unit === "MICROS") return parsers.timestampFromMicroseconds(view.getBigInt64(0, true));
  if (type === "INT64" && logical_type?.type === "TIMESTAMP") return parsers.timestampFromMilliseconds(view.getBigInt64(0, true));
  const unsigned = converted_type?.startsWith("UINT_") || logical_type?.type === "INTEGER" && !logical_type.isSigned;
  if (type === "INT32" && unsigned && view.byteLength === 4) return view.getUint32(0, true);
  if (type === "INT64" && unsigned && view.byteLength === 8) return view.getBigUint64(0, true);
  if (type === "INT32" && view.byteLength === 4) return view.getInt32(0, true);
  if (type === "INT64" && view.byteLength === 8) return view.getBigInt64(0, true);
  if (converted_type === "DECIMAL") return parseDecimal(value) * 10 ** -(schema.scale || 0);
  if (logical_type?.type === "FLOAT16") return parseFloat16(value);
  if (logical_type?.type === "UUID") return parsers.uuidFromBytes(value);
  if (type === "FIXED_LEN_BYTE_ARRAY") return value;
  return value;
}

// node_modules/hyparquet/src/indexes.js
function readColumnIndex(reader, schema, parsers = void 0) {
  parsers = { ...DEFAULT_PARSERS, ...parsers };
  const thrift = deserializeTCompactProtocol(reader);
  return {
    null_pages: thrift.field_1,
    min_values: thrift.field_2.map((m) => convertMetadata(m, schema, parsers)),
    max_values: thrift.field_3.map((m) => convertMetadata(m, schema, parsers)),
    boundary_order: BoundaryOrders[thrift.field_4],
    null_counts: thrift.field_5,
    repetition_level_histograms: thrift.field_6,
    definition_level_histograms: thrift.field_7
  };
}
function readOffsetIndex(reader) {
  const thrift = deserializeTCompactProtocol(reader);
  return {
    // @ts-ignore
    page_locations: thrift.field_1.map((loc) => ({
      offset: loc.field_1,
      compressed_page_size: loc.field_2,
      first_row_index: loc.field_3
    })),
    unencoded_byte_array_data_bytes: thrift.field_2
  };
}

// node_modules/hyparquet/src/xxhash.js
var MASK = 0xffffffffffffffffn;
var PRIME1 = 0x9e3779b185ebca87n;
var PRIME2 = 0xc2b2ae3d27d4eb4fn;
var PRIME3 = 0x165667b19e3779f9n;
var PRIME4 = 0x85ebca77c2b2ae63n;
var PRIME5 = 0x27d4eb2f165667c5n;
function rotl64(x, r) {
  return (x << r | x >> 64n - r) & MASK;
}
function round(acc, val) {
  acc = acc + val * PRIME2 & MASK;
  acc = rotl64(acc, 31n);
  return acc * PRIME1 & MASK;
}
function mergeRound(acc, val) {
  acc ^= round(0n, val);
  return acc * PRIME1 + PRIME4 & MASK;
}
function xxhash64(input, seed = 0n) {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const len = input.byteLength;
  let offset = 0;
  let h64;
  if (len >= 32) {
    let v1 = seed + PRIME1 + PRIME2 & MASK;
    let v2 = seed + PRIME2 & MASK;
    let v3 = seed;
    let v4 = seed - PRIME1 & MASK;
    while (offset + 32 <= len) {
      v1 = round(v1, view.getBigUint64(offset, true));
      offset += 8;
      v2 = round(v2, view.getBigUint64(offset, true));
      offset += 8;
      v3 = round(v3, view.getBigUint64(offset, true));
      offset += 8;
      v4 = round(v4, view.getBigUint64(offset, true));
      offset += 8;
    }
    h64 = rotl64(v1, 1n) + rotl64(v2, 7n) + rotl64(v3, 12n) + rotl64(v4, 18n) & MASK;
    h64 = mergeRound(h64, v1);
    h64 = mergeRound(h64, v2);
    h64 = mergeRound(h64, v3);
    h64 = mergeRound(h64, v4);
  } else {
    h64 = seed + PRIME5 & MASK;
  }
  h64 = h64 + BigInt(len) & MASK;
  while (offset + 8 <= len) {
    h64 ^= round(0n, view.getBigUint64(offset, true));
    h64 = rotl64(h64, 27n) * PRIME1 + PRIME4 & MASK;
    offset += 8;
  }
  if (offset + 4 <= len) {
    h64 ^= BigInt(view.getUint32(offset, true)) * PRIME1 & MASK;
    h64 = rotl64(h64, 23n) * PRIME2 + PRIME3 & MASK;
    offset += 4;
  }
  while (offset < len) {
    h64 ^= BigInt(view.getUint8(offset)) * PRIME5 & MASK;
    h64 = rotl64(h64, 11n) * PRIME1 & MASK;
    offset += 1;
  }
  h64 ^= h64 >> 33n;
  h64 = h64 * PRIME2 & MASK;
  h64 ^= h64 >> 29n;
  h64 = h64 * PRIME3 & MASK;
  h64 ^= h64 >> 32n;
  return h64;
}

// node_modules/hyparquet/src/bloom.js
var textEncoder = new TextEncoder();
var SALT = new Uint32Array([
  1203114875,
  1150766481,
  2284105051,
  2729912477,
  1884591559,
  770785867,
  2667333959,
  1550580529
]);
function blockIndex(hash, numBlocks) {
  return Number((hash >> 32n) * BigInt(numBlocks) >> 32n);
}
function blockMask(hash) {
  const m = new Uint32Array(8);
  const low = Number(hash & 0xffffffffn) | 0;
  for (let i = 0; i < 8; i++) {
    m[i] = 1 << (Math.imul(low, SALT[i]) >>> 27);
  }
  return m;
}
function sbbfContains(blocks, hash) {
  const offset = blockIndex(hash, blocks.length >> 3) << 3;
  const m = blockMask(hash);
  for (let i = 0; i < 8; i++) {
    if ((blocks[offset + i] & m[i]) === 0) return false;
  }
  return true;
}
function readBloomFilter(reader) {
  const header = deserializeTCompactProtocol(reader);
  const numBytes = header.field_1;
  if (typeof numBytes !== "number" || numBytes <= 0 || numBytes % 32 !== 0) return void 0;
  if (!header.field_2?.field_1) return void 0;
  if (!header.field_3?.field_1) return void 0;
  if (!header.field_4?.field_1) return void 0;
  const { view, offset } = reader;
  if (offset + numBytes > view.byteLength) {
    throw new Error(`parquet bloom filter truncated: need ${numBytes} bytes, have ${view.byteLength - offset}`);
  }
  const blocks = new Uint32Array(numBytes >> 2);
  for (let i = 0; i < blocks.length; i++) {
    blocks[i] = view.getUint32(offset + i * 4, true);
  }
  reader.offset = offset + numBytes;
  return { numBytes, blocks };
}
function hashParquetValue(value, element) {
  if (value === null || value === void 0) return void 0;
  const { type, converted_type, logical_type } = element;
  if (type === "BOOLEAN") {
    if (typeof value !== "boolean") return void 0;
    return xxhash64(new Uint8Array([value ? 1 : 0]));
  }
  if (type === "FLOAT") {
    if (typeof value !== "number") return void 0;
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    return xxhash64(new Uint8Array(buf));
  }
  if (type === "DOUBLE") {
    if (typeof value !== "number") return void 0;
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, true);
    return xxhash64(new Uint8Array(buf));
  }
  if (type === "INT32") {
    if (converted_type === "DATE" || converted_type === "DECIMAL" || converted_type === "TIME_MILLIS") return void 0;
    if (logical_type?.type === "DATE" || logical_type?.type === "TIME" || logical_type?.type === "DECIMAL") return void 0;
    if (typeof value !== "number" || !Number.isInteger(value)) return void 0;
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, value | 0, true);
    return xxhash64(new Uint8Array(buf));
  }
  if (type === "INT64") {
    if (converted_type === "TIMESTAMP_MILLIS" || converted_type === "TIMESTAMP_MICROS") return void 0;
    if (converted_type === "TIME_MICROS" || converted_type === "DECIMAL") return void 0;
    if (logical_type?.type === "TIMESTAMP" || logical_type?.type === "TIME" || logical_type?.type === "DECIMAL") return void 0;
    let bigValue;
    if (typeof value === "bigint") bigValue = value;
    else if (typeof value === "number" && Number.isSafeInteger(value)) bigValue = BigInt(value);
    else return void 0;
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigUint64(0, BigInt.asUintN(64, bigValue), true);
    return xxhash64(new Uint8Array(buf));
  }
  if (type === "BYTE_ARRAY") {
    if (converted_type === "JSON" || converted_type === "BSON" || converted_type === "DECIMAL") return void 0;
    if (logical_type?.type === "JSON" || logical_type?.type === "BSON" || logical_type?.type === "VARIANT") return void 0;
    if (logical_type?.type === "GEOMETRY" || logical_type?.type === "GEOGRAPHY") return void 0;
    if (typeof value === "string") return xxhash64(textEncoder.encode(value));
    if (value instanceof Uint8Array) return xxhash64(value);
    return void 0;
  }
  if (type === "FIXED_LEN_BYTE_ARRAY") {
    if (converted_type === "DECIMAL" || converted_type === "INTERVAL") return void 0;
    if (logical_type?.type === "DECIMAL" || logical_type?.type === "UUID" || logical_type?.type === "FLOAT16") return void 0;
    if (logical_type?.type === "GEOMETRY" || logical_type?.type === "GEOGRAPHY") return void 0;
    if (value instanceof Uint8Array) return xxhash64(value);
    return void 0;
  }
  return void 0;
}
function bloomEligibleColumns(filter) {
  const out = /* @__PURE__ */ new Set();
  walkBloomEligible(filter, out);
  return out;
}
function walkBloomEligible(filter, out) {
  if (!filter) return;
  if ("$and" in filter && Array.isArray(filter.$and)) {
    for (const sub of filter.$and) walkBloomEligible(sub, out);
    return;
  }
  if ("$or" in filter && Array.isArray(filter.$or)) {
    for (const sub of filter.$or) walkBloomEligible(sub, out);
    return;
  }
  if ("$nor" in filter) return;
  for (const [field, condition] of Object.entries(filter)) {
    if (field.startsWith("$")) continue;
    if (typeof condition === "object" && condition !== null && !Array.isArray(condition)) {
      if ("$eq" in condition || "$in" in condition) out.add(field);
    } else {
      out.add(field);
    }
  }
}

// node_modules/hyparquet/src/utils.js
function concat(aaa, bbb) {
  const chunk = 1e4;
  for (let i = 0; i < bbb.length; i += chunk) {
    aaa.push(...bbb.slice(i, i + chunk));
  }
}
function equals(a, b, strict = true) {
  if (strict ? a === b : a == b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!equals(a[i], b[i], strict)) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const k of aKeys) {
    if (!equals(a[k], b[k], strict)) return false;
  }
  return true;
}
function flatten(chunks) {
  if (!chunks) return [];
  if (chunks.length === 1) return chunks[0];
  const output = [];
  for (const chunk of chunks) {
    concat(output, chunk);
  }
  return output;
}

// node_modules/hyparquet/src/filter.js
var encoder = new TextEncoder();
function pathsNeededForFilter(filter) {
  if (!filter) return [];
  const paths = [];
  if ("$and" in filter && Array.isArray(filter.$and)) {
    paths.push(...filter.$and.flatMap(pathsNeededForFilter));
  } else if ("$or" in filter && Array.isArray(filter.$or)) {
    paths.push(...filter.$or.flatMap(pathsNeededForFilter));
  } else if ("$nor" in filter && Array.isArray(filter.$nor)) {
    paths.push(...filter.$nor.flatMap(pathsNeededForFilter));
  } else {
    paths.push(...Object.keys(filter));
  }
  return [...new Set(paths)];
}
function columnsNeededForFilter(filter) {
  return [...new Set(pathsNeededForFilter(filter).map((path) => path.split(".")[0]))];
}
function matchFilter(record, filter, strict = true) {
  if ("$and" in filter && Array.isArray(filter.$and)) {
    return filter.$and.every((subQuery) => matchFilter(record, subQuery, strict));
  }
  if ("$or" in filter && Array.isArray(filter.$or)) {
    return filter.$or.some((subQuery) => matchFilter(record, subQuery, strict));
  }
  if ("$nor" in filter && Array.isArray(filter.$nor)) {
    return !filter.$nor.some((subQuery) => matchFilter(record, subQuery, strict));
  }
  return Object.entries(filter).every(([field, condition]) => {
    const value = resolve(record, field);
    if (typeof condition !== "object" || condition === null || Array.isArray(condition)) {
      return equals(value, condition, strict);
    }
    return Object.entries(condition || {}).every(([operator, target]) => {
      if (operator === "$gt") return value !== null && value !== void 0 && value > target;
      if (operator === "$gte") return value !== null && value !== void 0 && value >= target;
      if (operator === "$lt") return value !== null && value !== void 0 && value < target;
      if (operator === "$lte") return value !== null && value !== void 0 && value <= target;
      if (operator === "$eq") return equals(value, target, strict);
      if (operator === "$ne") return !equals(value, target, strict);
      if (operator === "$in") return Array.isArray(target) && matchesIn(value, target, strict);
      if (operator === "$nin") return Array.isArray(target) && !matchesIn(value, target, strict);
      if (operator === "$not") return !matchFilter({ [field]: value }, { [field]: target }, strict);
      return true;
    });
  });
}
function matchesIn(value, targets, strict) {
  return targets.some((target) => equals(value, target, strict) || Array.isArray(value) && value.some((element) => equals(element, target, strict)));
}
function canSkipRowGroup({ rowGroup, physicalColumns, filter, strict = true, bloomFilters, schemaElements }) {
  if (!filter) return false;
  if ("$and" in filter && Array.isArray(filter.$and)) {
    return filter.$and.some((subFilter) => canSkipRowGroup({ rowGroup, physicalColumns, filter: subFilter, strict, bloomFilters, schemaElements }));
  }
  if ("$or" in filter && Array.isArray(filter.$or)) {
    return filter.$or.every((subFilter) => canSkipRowGroup({ rowGroup, physicalColumns, filter: subFilter, strict, bloomFilters, schemaElements }));
  }
  if ("$nor" in filter && Array.isArray(filter.$nor)) {
    return false;
  }
  for (const [field, condition] of Object.entries(filter)) {
    const columnIndex = physicalColumns.indexOf(field);
    if (columnIndex === -1) continue;
    const stats = rowGroup.columns[columnIndex].meta_data?.statistics;
    const { min, max, min_value, max_value, null_count: nullCount } = stats || {};
    const minVal = min_value !== void 0 ? min_value : min;
    const maxVal = max_value !== void 0 ? max_value : max;
    const haveStats = minVal !== void 0 && maxVal !== void 0;
    const bloom = bloomFilters?.[field];
    const element = schemaElements?.[field];
    const matchingNulls = matchFilter({ value: null }, { value: condition }, strict) && (nullCount === void 0 || nullCount > 0);
    if (haveStats && !matchingNulls && canSkipStats(condition, minVal, maxVal, strict, element)) {
      return true;
    }
    for (const [operator, target] of Object.entries(condition || {})) {
      if (bloom && element) {
        if (operator === "$eq") {
          const hash = hashParquetValue(target, element);
          if (hash !== void 0 && !sbbfContains(bloom.blocks, hash)) return true;
        }
        if (operator === "$in" && Array.isArray(target) && target.length > 0) {
          let allAbsent = true;
          for (const v of target) {
            const h = hashParquetValue(v, element);
            if (h === void 0 || sbbfContains(bloom.blocks, h)) {
              allAbsent = false;
              break;
            }
          }
          if (allAbsent) return true;
        }
      }
    }
  }
  return false;
}
function canSkipStats(condition, minVal, maxVal, strict, element) {
  if (minVal === void 0 || maxVal === void 0) return false;
  const mayContainNaN = element?.type === "FLOAT" || element?.type === "DOUBLE" || element?.logical_type?.type === "FLOAT16";
  for (const [operator, target] of Object.entries(condition || {})) {
    const minComparison = compareParquetValues(minVal, target, strict, element);
    const maxComparison = compareParquetValues(maxVal, target, strict, element);
    const binaryBounds = minVal instanceof Uint8Array || maxVal instanceof Uint8Array;
    const relationalBoundsAreSafe = !binaryBounds && (element?.type !== "BYTE_ARRAY" || typeof target === "string" && [...target].every((character) => character.charCodeAt(0) <= 127));
    if (operator === "$gt" && relationalBoundsAreSafe && maxComparison !== void 0 && maxComparison <= 0) return true;
    if (operator === "$gte" && relationalBoundsAreSafe && maxComparison !== void 0 && maxComparison < 0) return true;
    if (operator === "$lt" && relationalBoundsAreSafe && minComparison !== void 0 && minComparison >= 0) return true;
    if (operator === "$lte" && relationalBoundsAreSafe && minComparison !== void 0 && minComparison > 0) return true;
    if (operator === "$eq") {
      const targetMinComparison = compareParquetValues(target, minVal, strict, element);
      const targetMaxComparison = compareParquetValues(target, maxVal, strict, element);
      if (targetMinComparison !== void 0 && targetMinComparison < 0 || targetMaxComparison !== void 0 && targetMaxComparison > 0) return true;
    }
    if (operator === "$ne" && !mayContainNaN && equals(minVal, maxVal, strict) && equals(minVal, target, strict)) return true;
    if (operator === "$in" && Array.isArray(target) && target.every((value) => {
      const valueMinComparison = compareParquetValues(value, minVal, strict, element);
      const valueMaxComparison = compareParquetValues(value, maxVal, strict, element);
      return valueMinComparison !== void 0 && valueMinComparison < 0 || valueMaxComparison !== void 0 && valueMaxComparison > 0;
    })) return true;
    if (operator === "$nin" && !mayContainNaN && Array.isArray(target) && equals(minVal, maxVal, strict) && target.some((value) => equals(minVal, value, strict))) return true;
  }
  return false;
}
function compareParquetValues(a, b, strict, element) {
  if (element?.type === "BYTE_ARRAY") {
    if (typeof a !== "string" || typeof b !== "string") return void 0;
    return compareBytes(encoder.encode(a), encoder.encode(b));
  }
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return void 0;
    return compareBytes(a, b);
  }
  if (a < b) return -1;
  if (a > b) return 1;
  if (equals(a, b, strict)) return 0;
  return void 0;
}
function compareBytes(a, b) {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  if (a.length < b.length) return -1;
  if (a.length > b.length) return 1;
  return 0;
}
function matchesNull(condition, strict) {
  return matchFilter({ value: null }, { value: condition }, strict);
}
function filterPageRanges(filter, columnPages, groupRows, strict = true) {
  if (!filter) return void 0;
  if ("$and" in filter && Array.isArray(filter.$and)) {
    let ranges;
    for (const subFilter of filter.$and) {
      ranges = intersectRanges(ranges, filterPageRanges(subFilter, columnPages, groupRows, strict));
    }
    return ranges;
  }
  if ("$or" in filter && Array.isArray(filter.$or)) {
    let ranges = [];
    for (const subFilter of filter.$or) {
      const subRanges = filterPageRanges(subFilter, columnPages, groupRows, strict);
      if (!subRanges) return void 0;
      ranges = unionRanges(ranges, subRanges);
    }
    return ranges;
  }
  if ("$nor" in filter && Array.isArray(filter.$nor)) {
    return void 0;
  }
  let result;
  for (const [field, condition] of Object.entries(filter)) {
    const pages = columnPages[field];
    if (!pages) continue;
    const nullCanMatch = matchesNull(condition, strict);
    const keep = [];
    for (let i = 0; i < pages.pageStarts.length; i++) {
      const start = pages.pageStarts[i];
      const end = i + 1 < pages.pageStarts.length ? pages.pageStarts[i + 1] : groupRows;
      const nullCount = pages.nullCounts?.[i];
      const matchingNulls = nullCanMatch && (nullCount === void 0 || nullCount > 0);
      const skip = !pages.nullPages[i] && !matchingNulls && canSkipStats(condition, pages.minValues[i], pages.maxValues[i], strict, pages.element);
      if (!skip) {
        const last = keep[keep.length - 1];
        if (last && last[1] === start) last[1] = end;
        else keep.push([start, end]);
      }
    }
    result = intersectRanges(result, keep);
  }
  return result;
}
function intersectRanges(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i][0], b[j][0]);
    const end = Math.min(a[i][1], b[j][1]);
    if (start < end) out.push([start, end]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}
function unionRanges(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const next = j >= b.length || i < a.length && a[i][0] <= b[j][0] ? a[i++] : b[j++];
    const last = out[out.length - 1];
    if (last && next[0] <= last[1]) last[1] = Math.max(last[1], next[1]);
    else out.push([next[0], next[1]]);
  }
  return out;
}
function resolve(record, path) {
  let value = record;
  for (const part of path.split(".")) {
    value = value?.[part];
  }
  return value;
}

// node_modules/hyparquet/src/plan.js
var runLimit = 1 << 21;
function parquetPlan(options) {
  const { metadata, rowStart = 0, columns, useOffsetIndex = false } = options;
  if (!metadata) throw new Error("parquetPlan requires metadata");
  const groups = [];
  const fetches = [];
  const indexes = [];
  const scanPlan = parquetPlanGroups(options);
  for (const group of scanPlan.groups) {
    const groupPlan = parquetPlanGroup({ ...group, columns, useOffsetIndex });
    groups.push(...groupPlan.groups);
    fetches.push(...groupPlan.fetches);
    indexes.push(...groupPlan.indexes);
  }
  fetches.push(...indexes);
  return { metadata, rowStart, rowEnd: scanPlan.rowEnd, columns, fetches, groups };
}
function parquetPlanGroups({ metadata, rowStart = 0, rowEnd = Infinity, columns, filter, filterStrict = true, bloomFiltersByGroup, schemaElements, pageRangesByGroup, pageLocationsByGroup }) {
  if (!metadata) throw new Error("parquetPlan requires metadata");
  const schemaTree2 = parquetSchema(metadata);
  const physicalColumns = getPhysicalColumns(schemaTree2);
  const elementsByPath = filter ? {
    ...physicalSchemaElements(schemaTree2),
    ...schemaElements
  } : schemaElements;
  const groups = [];
  let groupStart = 0;
  for (let groupIndex = 0; groupIndex < metadata.row_groups.length; groupIndex++) {
    const rowGroup = metadata.row_groups[groupIndex];
    const groupRows = Number(rowGroup.num_rows);
    const groupEnd = groupStart + groupRows;
    if (groupRows > 0 && groupEnd > rowStart && groupStart < rowEnd && !canSkipRowGroup({
      rowGroup,
      physicalColumns,
      filter,
      strict: filterStrict,
      bloomFilters: bloomFiltersByGroup?.[groupIndex],
      schemaElements: elementsByPath
    })) {
      const selectStart = Math.max(rowStart - groupStart, 0);
      const selectEnd = Math.min(rowEnd - groupStart, groupRows);
      const pageRanges = pageRangesByGroup?.[groupIndex];
      const pageLocations = pageLocationsByGroup?.[groupIndex];
      let ranges = pageRanges ? pageRanges.map(([start, end]) => {
        const range = [Math.max(start, selectStart), Math.min(end, selectEnd)];
        return range;
      }).filter(([start, end]) => start < end) : [[selectStart, selectEnd]];
      if (ranges.length > 1) {
        const canSplit = rowGroup.columns.every((chunk) => {
          const columnName = chunk.meta_data?.path_in_schema[0];
          const columnPath = chunk.meta_data?.path_in_schema.join(".");
          if (columns && columnName && !columns.includes(columnName)) return true;
          return !!(chunk.offset_index_offset && chunk.offset_index_length) || !!(columnPath && pageLocations?.[columnPath]);
        });
        ranges = canSplit ? coalesceOverlappingPageRanges(ranges, rowGroup, columns, pageLocations) : [[ranges[0][0], ranges[ranges.length - 1][1]]];
      }
      if (ranges.length) {
        groups.push({ rowGroup, groupIndex, groupStart, groupRows, ranges, pageRanges, pageLocations });
      }
    }
    groupStart = groupEnd;
  }
  return { groups, rowEnd: isFinite(rowEnd) ? rowEnd : groupStart };
}
function parquetPlanGroup({ rowGroup, groupStart, groupRows, ranges, columns, useOffsetIndex = false, pageRanges, pageLocations }) {
  const chunks = [];
  const fetches = [];
  const indexes = [];
  const narrowed = ranges.length > 1 || ranges[0][0] > 0 || ranges[0][1] < groupRows;
  for (const chunk of rowGroup.columns) {
    const meta = chunk.meta_data;
    if (chunk.file_path) throw new Error("parquet file_path not supported");
    if (!meta) throw new Error("parquet column metadata is undefined");
    if (columns && !columns.includes(meta.path_in_schema[0])) continue;
    const columnOffset = meta.dictionary_page_offset || meta.data_page_offset;
    const startByte = Number(columnOffset);
    const endByte = Number(columnOffset + meta.total_compressed_size);
    const chunkPageLocations = pageLocations?.[meta.path_in_schema.join(".")];
    if (chunkPageLocations && narrowed) {
      chunks.push({ columnMetadata: meta, pageLocations: chunkPageLocations, range: { startByte, endByte } });
    } else if ((useOffsetIndex || pageRanges) && chunk.offset_index_offset && chunk.offset_index_length && narrowed) {
      const startByte2 = Number(chunk.offset_index_offset);
      chunks.push({
        columnMetadata: meta,
        offsetIndex: { startByte: startByte2, endByte: startByte2 + chunk.offset_index_length },
        range: { startByte: Number(columnOffset), endByte }
      });
    } else {
      chunks.push({ columnMetadata: meta, range: { startByte, endByte } });
    }
  }
  let run;
  for (const chunk of chunks) {
    if ("pageLocations" in chunk) continue;
    if ("offsetIndex" in chunk) {
      indexes.push(chunk.offsetIndex);
    } else if (columns) {
      fetches.push(chunk.range);
    } else if (run && chunk.range.endByte - run.startByte <= runLimit) {
      run.endByte = chunk.range.endByte;
    } else {
      if (run) fetches.push(run);
      run = { ...chunk.range };
    }
  }
  if (run) fetches.push(run);
  const groups = ranges.map(([selectStart, selectEnd]) => ({
    chunks,
    rowGroup,
    groupStart,
    groupRows,
    selectStart,
    selectEnd
  }));
  return { groups, fetches, indexes };
}
function coalesceOverlappingPageRanges(ranges, rowGroup, columns, pageLocations) {
  const selectedPageLayouts = rowGroup.columns.filter((chunk) => !columns || columns.includes(chunk.meta_data?.path_in_schema[0] || "")).map((chunk) => pageLocations?.[chunk.meta_data?.path_in_schema.join(".") || ""]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    const overlapsPage = last && selectedPageLayouts.some((pages) => {
      if (!pages) return true;
      const lastPages = pagesForRange(last, pages, Number(rowGroup.num_rows));
      const rangePages = pagesForRange(range, pages, Number(rowGroup.num_rows));
      return lastPages[0] <= rangePages[1] && rangePages[0] <= lastPages[1];
    });
    if (last && overlapsPage) last[1] = range[1];
    else merged.push([...range]);
  }
  return merged;
}
function pagesForRange([rangeStart, rangeEnd], pages, groupRows) {
  let first = Infinity;
  let last = -Infinity;
  for (let i = 0; i < pages.length; i++) {
    const pageStart = Number(pages[i].first_row_index);
    const pageEnd = i + 1 < pages.length ? Number(pages[i + 1].first_row_index) : groupRows;
    if (pageEnd > rangeStart && pageStart < rangeEnd) {
      first = Math.min(first, i);
      last = i;
    }
  }
  return [first, last];
}
async function prefetchBloomFilters({ file, metadata, filter, filterStrict = true }) {
  const result = metadata.row_groups.map(() => (
    /** @type {Record<string, BloomFilter>} */
    {}
  ));
  const eligibleCols = bloomEligibleColumns(filter);
  if (eligibleCols.size === 0) return result;
  const physicalColumns = getPhysicalColumns(parquetSchema(metadata));
  const tasks = [];
  metadata.row_groups.forEach((rowGroup, rgIdx) => {
    if (canSkipRowGroup({ rowGroup, physicalColumns, filter, strict: filterStrict })) return;
    for (const colName of eligibleCols) {
      const columnIdx = physicalColumns.indexOf(colName);
      if (columnIdx === -1) continue;
      const meta = rowGroup.columns[columnIdx]?.meta_data;
      if (!meta?.bloom_filter_offset || !meta.bloom_filter_length) continue;
      const start = Number(meta.bloom_filter_offset);
      const end = start + meta.bloom_filter_length;
      tasks.push((async () => {
        const buffer = await file.slice(start, end);
        const bloom = readBloomFilter({ view: new DataView(buffer), offset: 0 });
        if (bloom) result[rgIdx][colName] = bloom;
      })());
    }
  });
  if (tasks.length) await Promise.all(tasks);
  return result;
}
async function prefetchPageIndexes({ file, metadata, filter, filterStrict = true, rowStart = 0, rowEnd = Infinity, columns, bloomFiltersByGroup, schemaElements, parsers }) {
  const pageRangesByGroup = metadata.row_groups.map(() => void 0);
  const pageLocationsByGroup = metadata.row_groups.map(() => (
    /** @type {Record<string, PageLocation[]>} */
    {}
  ));
  if (filter && "$nor" in filter && Array.isArray(filter.$nor)) {
    return { pageRangesByGroup, pageLocationsByGroup };
  }
  const filterColumns = pathsNeededForFilter(filter);
  if (!filterColumns.length) return { pageRangesByGroup, pageLocationsByGroup };
  const schemaTree2 = parquetSchema(metadata);
  const physicalColumns = getPhysicalColumns(schemaTree2);
  const elementsByPath = {
    ...physicalSchemaElements(schemaTree2),
    ...schemaElements
  };
  const indexRanges = [];
  const indexTasks = [];
  const candidateGroups = [];
  let groupStart = 0;
  metadata.row_groups.forEach((rowGroup, rgIdx) => {
    const groupRows = Number(rowGroup.num_rows);
    const groupEnd = groupStart + groupRows;
    const overlaps = groupRows > 0 && groupEnd > rowStart && groupStart < rowEnd;
    groupStart = groupEnd;
    if (!overlaps) return;
    if (canSkipRowGroup({ rowGroup, physicalColumns, filter, strict: filterStrict, bloomFilters: bloomFiltersByGroup?.[rgIdx], schemaElements: elementsByPath })) return;
    const columnPages = {};
    let columnTaskCount = 0;
    const scheduledOffsetPaths = /* @__PURE__ */ new Set();
    let hasFilterIndex = false;
    for (const columnName of filterColumns) {
      const columnIdx = physicalColumns.indexOf(columnName);
      if (columnIdx === -1) continue;
      const chunk = rowGroup.columns[columnIdx];
      const meta = chunk?.meta_data;
      if (!meta) continue;
      if (!chunk.column_index_offset || !chunk.column_index_length) continue;
      if (!chunk.offset_index_offset || !chunk.offset_index_length) continue;
      const element = elementsByPath[columnName];
      if (!element) continue;
      hasFilterIndex = true;
      scheduledOffsetPaths.add(columnName);
      const columnIndexStart = Number(chunk.column_index_offset);
      const offsetIndexStart = Number(chunk.offset_index_offset);
      const columnIndexEnd = columnIndexStart + chunk.column_index_length;
      const offsetIndexEnd = offsetIndexStart + chunk.offset_index_length;
      indexRanges.push(
        { startByte: columnIndexStart, endByte: columnIndexEnd },
        { startByte: offsetIndexStart, endByte: offsetIndexEnd }
      );
      columnTaskCount++;
      indexTasks.push(async (prefetchedFile) => {
        const [columnIndexBuffer, offsetIndexBuffer] = await Promise.all([
          prefetchedFile.slice(columnIndexStart, columnIndexEnd),
          prefetchedFile.slice(offsetIndexStart, offsetIndexEnd)
        ]);
        const columnIndex = readColumnIndex({ view: new DataView(columnIndexBuffer), offset: 0 }, element, parsers);
        const offsetIndex = readOffsetIndex({ view: new DataView(offsetIndexBuffer), offset: 0 });
        pageLocationsByGroup[rgIdx][columnName] = offsetIndex.page_locations;
        columnPages[columnName] = {
          minValues: columnIndex.min_values,
          maxValues: columnIndex.max_values,
          nullPages: columnIndex.null_pages,
          nullCounts: columnIndex.null_counts,
          pageStarts: offsetIndex.page_locations.map((page) => Number(page.first_row_index)),
          element
        };
      });
    }
    if (hasFilterIndex) {
      for (const chunk of rowGroup.columns) {
        const meta = chunk.meta_data;
        if (!meta) continue;
        const columnName = meta.path_in_schema[0];
        const columnPath = meta.path_in_schema.join(".");
        if (columns && !columns.includes(columnName)) continue;
        if (scheduledOffsetPaths.has(columnPath)) continue;
        if (!chunk.offset_index_offset || !chunk.offset_index_length) continue;
        scheduledOffsetPaths.add(columnPath);
        const offsetIndexStart = Number(chunk.offset_index_offset);
        const offsetIndexEnd = offsetIndexStart + chunk.offset_index_length;
        indexRanges.push({ startByte: offsetIndexStart, endByte: offsetIndexEnd });
        columnTaskCount++;
        indexTasks.push(async (prefetchedFile) => {
          const offsetIndexBuffer = await prefetchedFile.slice(offsetIndexStart, offsetIndexEnd);
          const offsetIndex = readOffsetIndex({ view: new DataView(offsetIndexBuffer), offset: 0 });
          pageLocationsByGroup[rgIdx][columnPath] = offsetIndex.page_locations;
        });
      }
    }
    if (columnTaskCount) {
      candidateGroups.push({ rgIdx, groupRows, columnPages });
    }
  });
  if (indexTasks.length) {
    const prefetchedFile = prefetchAsyncBuffer(file, { fetches: coalesceByteRanges(indexRanges) });
    await Promise.all(indexTasks.map((task) => task(prefetchedFile)));
    for (const { rgIdx, groupRows, columnPages } of candidateGroups) {
      pageRangesByGroup[rgIdx] = filterPageRanges(filter, columnPages, groupRows, filterStrict);
    }
  }
  return { pageRangesByGroup, pageLocationsByGroup };
}
function coalesceByteRanges(ranges) {
  const sorted = ranges.map((range) => ({ ...range })).sort((a, b) => a.startByte - b.startByte || a.endByte - b.endByte);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.startByte <= last.endByte) {
      last.endByte = Math.max(last.endByte, range.endByte);
    } else {
      merged.push(range);
    }
  }
  return merged;
}
function physicalSchemaElements(schemaTree2) {
  const elements = {};
  function traverse(node) {
    if (node.children.length) {
      for (const child of node.children) traverse(child);
    } else {
      elements[node.path.join(".")] = node.element;
    }
  }
  traverse(schemaTree2);
  return elements;
}
function prefetchAsyncBuffer(file, { fetches }) {
  const promises = fetches.map(({ startByte, endByte }) => file.slice(startByte, endByte));
  return {
    byteLength: file.byteLength,
    slice(start, end = file.byteLength) {
      const index = fetches.findIndex(({ startByte, endByte }) => startByte <= start && end <= endByte);
      if (index < 0) {
        return file.slice(start, end);
      }
      if (fetches[index].startByte !== start || fetches[index].endByte !== end) {
        const startOffset = start - fetches[index].startByte;
        const endOffset = end - fetches[index].startByte;
        if (promises[index] instanceof Promise) {
          return promises[index].then((buffer) => buffer.slice(startOffset, endOffset));
        } else {
          return promises[index].slice(startOffset, endOffset);
        }
      } else {
        return promises[index];
      }
    }
  };
}

// node_modules/hyparquet/src/variant.js
var decoder3 = new TextDecoder();
var metadataCache = /* @__PURE__ */ new WeakMap();
function decodeVariantColumn(value, parsers = DEFAULT_PARSERS) {
  if (Array.isArray(value)) {
    return value.map((entry) => decodeVariantColumn(entry, parsers));
  }
  if (typeof value !== "object") return value;
  if ("metadata" in value) {
    const metadata = parseVariantMetadata(value.metadata);
    const shreddedFields = value.typed_value && decodeTypedValue(value.typed_value, metadata, parsers);
    const binaryValue = value.value && readVariant(makeReader(value.value), metadata, parsers);
    if (shreddedFields && binaryValue) {
      return { ...binaryValue, ...shreddedFields };
    }
    return shreddedFields ?? binaryValue;
  }
  return value;
}
function decodeTypedValue(typedValue, metadata, parsers) {
  if (typedValue instanceof Date) return typedValue;
  if (typedValue && typeof typedValue === "object" && !Array.isArray(typedValue) && !(typedValue instanceof Uint8Array)) {
    if ("typed_value" in typedValue && typedValue.typed_value !== null && typedValue.typed_value !== void 0) {
      return decodeTypedValue(typedValue.typed_value, metadata, parsers);
    }
    if ("value" in typedValue && typedValue.value instanceof Uint8Array) {
      return readVariant(makeReader(typedValue.value), metadata, parsers);
    }
    if ("typed_value" in typedValue || "value" in typedValue) {
      return null;
    }
    const result = {};
    for (const [key, field] of Object.entries(typedValue)) {
      if (!metadata.dictionary.includes(key)) continue;
      result[key] = decodeTypedValue(field, metadata, parsers);
    }
    return result;
  }
  if (typedValue instanceof Uint8Array) {
    return readVariant(makeReader(typedValue), metadata, parsers);
  }
  if (Array.isArray(typedValue)) {
    return typedValue.map((element) => decodeTypedValue(element, metadata, parsers));
  }
  return typedValue;
}
function makeReader(bytes) {
  return { view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset: 0 };
}
function parseVariantMetadata(bytes) {
  let bufferCache = metadataCache.get(bytes.buffer);
  if (!bufferCache) {
    bufferCache = /* @__PURE__ */ new Map();
    metadataCache.set(bytes.buffer, bufferCache);
  }
  const key = `${bytes.byteOffset}:${bytes.byteLength}`;
  const cached = bufferCache.get(key);
  if (cached) return cached;
  const reader = makeReader(bytes);
  const header = reader.view.getUint8(reader.offset++);
  const version = header & 15;
  if (version !== 1) throw new Error(`parquet unsupported variant metadata version: ${version}`);
  const sorted = (header >> 4 & 1) === 1;
  const offsetSize = (header >> 6 & 3) + 1;
  const dictionarySize = readUnsigned(reader, offsetSize);
  const offsets = new Array(dictionarySize + 1);
  for (let i = 0; i < offsets.length; i++) {
    offsets[i] = readUnsigned(reader, offsetSize);
  }
  const base = reader.offset;
  const dictionary = new Array(dictionarySize);
  for (let i = 0; i < dictionarySize; i++) {
    const start = offsets[i];
    const end = offsets[i + 1];
    const strBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + base + start, end - start);
    dictionary[i] = decoder3.decode(strBytes);
  }
  const metadata = { dictionary, sorted };
  bufferCache.set(key, metadata);
  return metadata;
}
function readUnsigned(reader, byteWidth2) {
  let value = 0;
  for (let i = 0; i < byteWidth2; i++) {
    value |= reader.view.getUint8(reader.offset + i) << i * 8;
  }
  reader.offset += byteWidth2;
  return value;
}
function readVariant(reader, metadata, parsers) {
  const typeByte = reader.view.getUint8(reader.offset++);
  const basicType = typeByte & 3;
  const header = typeByte >> 2;
  if (basicType === 0) return readVariantPrimitive(reader, header, parsers);
  if (basicType === 2) return readVariantObject(reader, header, metadata, parsers);
  if (basicType === 3) return readVariantArray(reader, header, metadata, parsers);
  const bytes = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, header);
  reader.offset += header;
  return decoder3.decode(bytes);
}
function readVariantPrimitive(reader, typeId, parsers) {
  switch (typeId) {
    case 0:
      return null;
    case 1:
      return true;
    case 2:
      return false;
    case 3: {
      const value = reader.view.getInt8(reader.offset);
      reader.offset += 1;
      return value;
    }
    case 4: {
      const value = reader.view.getInt16(reader.offset, true);
      reader.offset += 2;
      return value;
    }
    case 5: {
      const value = reader.view.getInt32(reader.offset, true);
      reader.offset += 4;
      return value;
    }
    case 6: {
      const value = reader.view.getBigInt64(reader.offset, true);
      reader.offset += 8;
      return value;
    }
    case 7: {
      const value = reader.view.getFloat64(reader.offset, true);
      reader.offset += 8;
      return value;
    }
    case 8:
      return readVariantDecimal(reader, 4);
    case 9:
      return readVariantDecimal(reader, 8);
    case 10:
      return readVariantDecimal(reader, 16);
    case 11: {
      const value = reader.view.getInt32(reader.offset, true);
      reader.offset += 4;
      return parsers.dateFromDays(value);
    }
    case 12:
    // timestamp_micros (utc)
    case 13: {
      const value = reader.view.getBigInt64(reader.offset, true);
      reader.offset += 8;
      return parsers.timestampFromMicroseconds(value);
    }
    case 14: {
      const value = reader.view.getFloat32(reader.offset, true);
      reader.offset += 4;
      return value;
    }
    case 15:
      return readVariantBinary(reader);
    case 16: {
      const bytes = readVariantBinary(reader);
      return decoder3.decode(bytes);
    }
    case 17: {
      const value = reader.view.getBigInt64(reader.offset, true);
      reader.offset += 8;
      return value;
    }
    case 18:
    // timestamp_nanos (utc)
    case 19: {
      const value = reader.view.getBigInt64(reader.offset, true);
      reader.offset += 8;
      return parsers.timestampFromNanoseconds(value);
    }
    case 20: {
      const bytes = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, 16);
      reader.offset += 16;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    default:
      throw new Error(`parquet unsupported variant primitive type: ${typeId}`);
  }
}
function readVariantObject(reader, header, metadata, parsers) {
  const offsetWidth = (header & 3) + 1;
  const idWidth = (header >> 2 & 3) + 1;
  const isLarge = header >> 4 & 1;
  const numElements = isLarge ? readUnsigned(reader, 4) : reader.view.getUint8(reader.offset++);
  const fieldIds = new Array(numElements);
  for (let i = 0; i < numElements; i++) {
    fieldIds[i] = readUnsigned(reader, idWidth);
  }
  const offsets = new Array(numElements + 1);
  for (let i = 0; i < offsets.length; i++) {
    offsets[i] = readUnsigned(reader, offsetWidth);
  }
  const out = {};
  for (let i = 0; i < numElements; i++) {
    const key = metadata.dictionary[fieldIds[i]];
    const valueReader = {
      view: reader.view,
      offset: reader.offset + offsets[i]
    };
    out[key] = readVariant(valueReader, metadata, parsers);
  }
  reader.offset += offsets[offsets.length - 1];
  return out;
}
function readVariantArray(reader, header, metadata, parsers) {
  const fieldOffsetSize = header & 3;
  const isLarge = header >> 2 & 1;
  const offsetWidth = fieldOffsetSize + 1;
  const numElements = readUnsigned(reader, isLarge ? 4 : 1);
  const offsets = new Array(numElements + 1);
  for (let i = 0; i < offsets.length; i++) {
    offsets[i] = readUnsigned(reader, offsetWidth);
  }
  const valuesStart = reader.offset;
  const result = new Array(numElements);
  for (let i = 0; i < numElements; i++) {
    const valueReader = {
      view: reader.view,
      offset: valuesStart + offsets[i]
    };
    result[i] = readVariant(valueReader, metadata, parsers);
  }
  reader.offset = valuesStart + offsets[offsets.length - 1];
  return result;
}
function readVariantDecimal(reader, width) {
  const scale = reader.view.getUint8(reader.offset);
  reader.offset += 1;
  let unscaled;
  if (width === 4) {
    unscaled = BigInt(reader.view.getInt32(reader.offset, true));
    reader.offset += 4;
  } else if (width === 8) {
    unscaled = reader.view.getBigInt64(reader.offset, true);
    reader.offset += 8;
  } else {
    const low = reader.view.getBigUint64(reader.offset, true);
    const high = reader.view.getBigInt64(reader.offset + 8, true);
    unscaled = high << 64n | low;
    reader.offset += 16;
  }
  return Number(unscaled) * 10 ** -scale;
}
function readVariantBinary(reader) {
  const length = reader.view.getUint32(reader.offset, true);
  reader.offset += 4;
  const bytes = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, length);
  reader.offset += length;
  return bytes;
}

// node_modules/hyparquet/src/assemble.js
function assembleLists(output, definitionLevels, repetitionLevels, values, schemaPath) {
  const maxDefinitionLevel = getMaxDefinitionLevel(schemaPath);
  if (!definitionLevels?.length && !repetitionLevels.length) {
    if (!maxDefinitionLevel || !values.length) return values;
    definitionLevels = new Array(values.length).fill(maxDefinitionLevel);
  }
  const n = definitionLevels?.length || repetitionLevels.length;
  const repetitionPath = schemaPath.map(({ element }) => element.repetition_type);
  let valueIndex = 0;
  const containerStack = [output];
  let currentContainer = output;
  let currentDepth = 0;
  let currentDefLevel = 0;
  let currentRepLevel = 0;
  if (repetitionLevels[0]) {
    while (currentDepth < repetitionPath.length - 2 && currentRepLevel < repetitionLevels[0]) {
      currentDepth++;
      if (repetitionPath[currentDepth] !== "REQUIRED") {
        currentContainer = currentContainer.at(-1);
        containerStack.push(currentContainer);
        currentDefLevel++;
      }
      if (repetitionPath[currentDepth] === "REPEATED") currentRepLevel++;
    }
  }
  for (let i = 0; i < n; i++) {
    const def = definitionLevels?.length ? definitionLevels[i] : maxDefinitionLevel;
    const rep = repetitionLevels[i];
    while (currentDepth && (rep < currentRepLevel || repetitionPath[currentDepth] !== "REPEATED")) {
      if (repetitionPath[currentDepth] !== "REQUIRED") {
        containerStack.pop();
        currentDefLevel--;
      }
      if (repetitionPath[currentDepth] === "REPEATED") currentRepLevel--;
      currentDepth--;
    }
    currentContainer = containerStack.at(-1);
    while ((currentDepth < repetitionPath.length - 2 || repetitionPath[currentDepth + 1] === "REPEATED") && (currentDefLevel < def || repetitionPath[currentDepth + 1] === "REQUIRED")) {
      currentDepth++;
      if (repetitionPath[currentDepth] !== "REQUIRED") {
        const newList = [];
        currentContainer.push(newList);
        currentContainer = newList;
        containerStack.push(newList);
        currentDefLevel++;
      }
      if (repetitionPath[currentDepth] === "REPEATED") currentRepLevel++;
    }
    if (def === maxDefinitionLevel) {
      currentContainer.push(values[valueIndex++]);
    } else if (currentDepth === repetitionPath.length - 2) {
      currentContainer.push(null);
    } else {
      currentContainer.push([]);
    }
  }
  if (!output.length) {
    for (let i = 0; i < maxDefinitionLevel; i++) {
      const newList = [];
      currentContainer.push(newList);
      currentContainer = newList;
    }
  }
  return output;
}
function assembleNested(subcolumnData, schema, parsers, depth = 0) {
  const path = schema.path.join(".");
  const optional = schema.element.repetition_type === "OPTIONAL";
  const nextDepth = optional ? depth + 1 : depth;
  if (isListLike(schema)) {
    let sublist = schema.children[0];
    let subDepth = nextDepth;
    if (sublist.children.length === 1) {
      sublist = sublist.children[0];
      subDepth++;
    }
    assembleNested(subcolumnData, sublist, parsers, subDepth);
    const subcolumn = sublist.path.join(".");
    const values = subcolumnData.get(subcolumn);
    if (!values) throw new Error("parquet list column missing values");
    if (optional) flattenAtDepth(values, depth);
    subcolumnData.set(path, values);
    subcolumnData.delete(subcolumn);
    return;
  }
  if (isMapLike(schema)) {
    const mapName = schema.children[0].element.name;
    assembleNested(subcolumnData, schema.children[0].children[0], parsers, nextDepth + 1);
    assembleNested(subcolumnData, schema.children[0].children[1], parsers, nextDepth + 1);
    const keys = subcolumnData.get(`${path}.${mapName}.key`);
    const values = subcolumnData.get(`${path}.${mapName}.value`);
    if (!keys) throw new Error("parquet map column missing keys");
    if (!values) throw new Error("parquet map column missing values");
    if (keys.length !== values.length) {
      throw new Error("parquet map column key/value length mismatch");
    }
    const out = assembleMaps(keys, values, nextDepth);
    if (optional) flattenAtDepth(out, depth);
    subcolumnData.delete(`${path}.${mapName}.key`);
    subcolumnData.delete(`${path}.${mapName}.value`);
    subcolumnData.set(path, out);
    return;
  }
  if (schema.children.length) {
    const invertDepth = schema.element.repetition_type === "REQUIRED" ? depth : depth + 1;
    const struct = {};
    for (const child of schema.children) {
      assembleNested(subcolumnData, child, parsers, invertDepth);
      const childData = subcolumnData.get(child.path.join("."));
      if (!childData) throw new Error("parquet struct missing child data");
      struct[child.element.name] = childData;
    }
    for (const child of schema.children) {
      subcolumnData.delete(child.path.join("."));
    }
    let inverted = invertStruct(struct, invertDepth);
    if (schema.element.logical_type?.type === "VARIANT") {
      inverted = decodeVariantColumn(inverted, parsers);
    }
    if (optional) flattenAtDepth(inverted, depth);
    subcolumnData.set(path, inverted);
  }
}
function flattenAtDepth(arr, depth) {
  for (let i = 0; i < arr.length; i++) {
    if (depth) {
      flattenAtDepth(arr[i], depth - 1);
    } else {
      arr[i] = arr[i][0];
    }
  }
}
function assembleMaps(keys, values, depth) {
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    if (depth) {
      out.push(assembleMaps(keys[i], values[i], depth - 1));
    } else {
      if (keys[i]) {
        const obj = {};
        for (let j = 0; j < keys[i].length; j++) {
          const value = values[i][j];
          obj[keys[i][j]] = value === void 0 ? null : value;
        }
        out.push(obj);
      } else {
        out.push(void 0);
      }
    }
  }
  return out;
}
function invertStruct(struct, depth) {
  const keys = Object.keys(struct);
  const length = struct[keys[0]]?.length;
  const out = [];
  for (let i = 0; i < length; i++) {
    const obj = {};
    for (const key of keys) {
      if (struct[key].length !== length) throw new Error("parquet struct parsing error");
      obj[key] = struct[key][i];
    }
    if (depth) {
      out.push(invertStruct(obj, depth - 1));
    } else {
      out.push(obj);
    }
  }
  return out;
}

// node_modules/hyparquet/src/delta.js
function deltaBinaryUnpack(reader, count, output) {
  const int32 = output instanceof Int32Array;
  const blockSize = readVarInt(reader);
  const miniblockPerBlock = readVarInt(reader);
  readVarInt(reader);
  let value = readZigZagBigInt(reader);
  let outputIndex = 0;
  output[outputIndex++] = int32 ? Number(value) : value;
  const valuesPerMiniblock = blockSize / miniblockPerBlock;
  while (outputIndex < count) {
    const minDelta = readZigZagBigInt(reader);
    const bitWidths = new Uint8Array(miniblockPerBlock);
    for (let i = 0; i < miniblockPerBlock; i++) {
      bitWidths[i] = reader.view.getUint8(reader.offset++);
    }
    for (let i = 0; i < miniblockPerBlock && outputIndex < count; i++) {
      const bitWidth2 = BigInt(bitWidths[i]);
      if (bitWidth2) {
        let bitpackPos = 0n;
        let miniblockCount = valuesPerMiniblock;
        const mask = (1n << bitWidth2) - 1n;
        while (miniblockCount && outputIndex < count) {
          let bits = BigInt(reader.view.getUint8(reader.offset)) >> bitpackPos & mask;
          bitpackPos += bitWidth2;
          while (bitpackPos >= 8) {
            bitpackPos -= 8n;
            reader.offset++;
            if (bitpackPos) {
              bits |= BigInt(reader.view.getUint8(reader.offset)) << bitWidth2 - bitpackPos & mask;
            }
          }
          const delta = minDelta + bits;
          value += delta;
          output[outputIndex++] = int32 ? Number(value) : value;
          miniblockCount--;
        }
        if (miniblockCount) {
          reader.offset += Math.ceil((miniblockCount * Number(bitWidth2) + Number(bitpackPos)) / 8);
        }
      } else {
        for (let j = 0; j < valuesPerMiniblock && outputIndex < count; j++) {
          value += minDelta;
          output[outputIndex++] = int32 ? Number(value) : value;
        }
      }
    }
  }
}
function deltaLengthByteArray(reader, count, output) {
  const lengths = new Int32Array(count);
  deltaBinaryUnpack(reader, count, lengths);
  for (let i = 0; i < count; i++) {
    output[i] = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, lengths[i]);
    reader.offset += lengths[i];
  }
}
function deltaByteArray(reader, count, output) {
  const prefixData = new Int32Array(count);
  deltaBinaryUnpack(reader, count, prefixData);
  const suffixData = new Int32Array(count);
  deltaBinaryUnpack(reader, count, suffixData);
  for (let i = 0; i < count; i++) {
    const suffix = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, suffixData[i]);
    if (prefixData[i]) {
      output[i] = new Uint8Array(prefixData[i] + suffixData[i]);
      output[i].set(output[i - 1].subarray(0, prefixData[i]));
      output[i].set(suffix, prefixData[i]);
    } else {
      output[i] = suffix;
    }
    reader.offset += suffixData[i];
  }
}

// node_modules/hyparquet/src/encoding.js
function readRleBitPackedHybrid(reader, width, output, length) {
  if (length === void 0) {
    length = reader.view.getUint32(reader.offset, true);
    reader.offset += 4;
  }
  const startOffset = reader.offset;
  let seen = 0;
  while (seen < output.length) {
    const header = readVarInt(reader);
    if (header & 1) {
      seen = readBitPacked(reader, header, width, output, seen);
    } else {
      const count = header >>> 1;
      readRle(reader, count, width, output, seen);
      seen += count;
    }
  }
  reader.offset = startOffset + length;
}
function readRle(reader, count, bitWidth2, output, seen) {
  const width = bitWidth2 + 7 >> 3;
  let value = 0;
  for (let i = 0; i < width; i++) {
    value |= reader.view.getUint8(reader.offset++) << (i << 3);
  }
  for (let i = 0; i < count; i++) {
    output[seen + i] = value;
  }
}
function readBitPacked(reader, header, bitWidth2, output, seen) {
  let count = header >> 1 << 3;
  const mask = (1 << bitWidth2) - 1;
  let data = 0;
  if (reader.offset < reader.view.byteLength) {
    data = reader.view.getUint8(reader.offset++);
  } else if (mask) {
    throw new Error(`parquet bitpack offset ${reader.offset} out of range`);
  }
  let left = 8;
  let right = 0;
  while (count) {
    if (right > 8) {
      right -= 8;
      left -= 8;
      data >>>= 8;
    } else if (left - right < bitWidth2) {
      data |= reader.view.getUint8(reader.offset) << left;
      reader.offset++;
      left += 8;
    } else {
      if (seen < output.length) {
        output[seen++] = data >> right & mask;
      }
      count--;
      right += bitWidth2;
    }
  }
  return seen;
}
function byteStreamSplit(reader, count, type, typeLength) {
  const width = byteWidth(type, typeLength);
  const bytes = new Uint8Array(count * width);
  for (let b = 0; b < width; b++) {
    for (let i = 0; i < count; i++) {
      bytes[i * width + b] = reader.view.getUint8(reader.offset++);
    }
  }
  if (type === "FLOAT") return new Float32Array(bytes.buffer);
  else if (type === "DOUBLE") return new Float64Array(bytes.buffer);
  else if (type === "INT32") return new Int32Array(bytes.buffer);
  else if (type === "INT64") return new BigInt64Array(bytes.buffer);
  else if (type === "FIXED_LEN_BYTE_ARRAY") {
    const split = new Array(count);
    for (let i = 0; i < count; i++) {
      split[i] = bytes.subarray(i * width, (i + 1) * width);
    }
    return split;
  }
  throw new Error(`parquet byte_stream_split unsupported type: ${type}`);
}
function byteWidth(type, typeLength) {
  switch (type) {
    case "INT32":
    case "FLOAT":
      return 4;
    case "INT64":
    case "DOUBLE":
      return 8;
    case "FIXED_LEN_BYTE_ARRAY":
      if (!typeLength) throw new Error("parquet byteWidth missing type_length");
      return typeLength;
    default:
      throw new Error(`parquet unsupported type: ${type}`);
  }
}

// node_modules/hyparquet/src/plain.js
function readPlain(reader, type, count, fixedLength) {
  if (count === 0) return [];
  if (type === "BOOLEAN") {
    return readPlainBoolean(reader, count);
  } else if (type === "INT32") {
    return readPlainInt32(reader, count);
  } else if (type === "INT64") {
    return readPlainInt64(reader, count);
  } else if (type === "INT96") {
    return readPlainInt96(reader, count);
  } else if (type === "FLOAT") {
    return readPlainFloat(reader, count);
  } else if (type === "DOUBLE") {
    return readPlainDouble(reader, count);
  } else if (type === "BYTE_ARRAY") {
    return readPlainByteArray(reader, count);
  } else if (type === "FIXED_LEN_BYTE_ARRAY") {
    if (!fixedLength) throw new Error("parquet missing fixed length");
    return readPlainByteArrayFixed(reader, count, fixedLength);
  } else {
    throw new Error(`parquet unhandled type: ${type}`);
  }
}
function readPlainBoolean(reader, count) {
  const values = new Array(count);
  for (let i = 0; i < count; i++) {
    const byteOffset = reader.offset + (i / 8 | 0);
    const bitOffset = i % 8;
    const byte = reader.view.getUint8(byteOffset);
    values[i] = (byte & 1 << bitOffset) !== 0;
  }
  reader.offset += Math.ceil(count / 8);
  return values;
}
function readPlainInt32(reader, count) {
  const values = (reader.view.byteOffset + reader.offset) % 4 ? new Int32Array(align(reader.view.buffer, reader.view.byteOffset + reader.offset, count * 4)) : new Int32Array(reader.view.buffer, reader.view.byteOffset + reader.offset, count);
  reader.offset += count * 4;
  return values;
}
function readPlainInt64(reader, count) {
  const values = (reader.view.byteOffset + reader.offset) % 8 ? new BigInt64Array(align(reader.view.buffer, reader.view.byteOffset + reader.offset, count * 8)) : new BigInt64Array(reader.view.buffer, reader.view.byteOffset + reader.offset, count);
  reader.offset += count * 8;
  return values;
}
function readPlainInt96(reader, count) {
  const values = new Array(count);
  for (let i = 0; i < count; i++) {
    const low = reader.view.getBigInt64(reader.offset + i * 12, true);
    const high = reader.view.getInt32(reader.offset + i * 12 + 8, true);
    values[i] = BigInt(high) << 64n | low;
  }
  reader.offset += count * 12;
  return values;
}
function readPlainFloat(reader, count) {
  const values = (reader.view.byteOffset + reader.offset) % 4 ? new Float32Array(align(reader.view.buffer, reader.view.byteOffset + reader.offset, count * 4)) : new Float32Array(reader.view.buffer, reader.view.byteOffset + reader.offset, count);
  reader.offset += count * 4;
  return values;
}
function readPlainDouble(reader, count) {
  const values = (reader.view.byteOffset + reader.offset) % 8 ? new Float64Array(align(reader.view.buffer, reader.view.byteOffset + reader.offset, count * 8)) : new Float64Array(reader.view.buffer, reader.view.byteOffset + reader.offset, count);
  reader.offset += count * 8;
  return values;
}
function readPlainByteArray(reader, count) {
  const values = new Array(count);
  for (let i = 0; i < count; i++) {
    const length = reader.view.getUint32(reader.offset, true);
    reader.offset += 4;
    values[i] = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, length);
    reader.offset += length;
  }
  return values;
}
function readPlainByteArrayFixed(reader, count, fixedLength) {
  const values = new Array(count);
  for (let i = 0; i < count; i++) {
    values[i] = new Uint8Array(reader.view.buffer, reader.view.byteOffset + reader.offset, fixedLength);
    reader.offset += fixedLength;
  }
  return values;
}
function align(buffer, offset, size) {
  const aligned = new ArrayBuffer(size);
  new Uint8Array(aligned).set(new Uint8Array(buffer, offset, size));
  return aligned;
}

// node_modules/hyparquet/src/snappy.js
var WORD_MASK = [0, 255, 65535, 16777215, 4294967295];
function copyBytes(fromArray, fromPos, toArray, toPos, length) {
  for (let i = 0; i < length; i++) {
    toArray[toPos + i] = fromArray[fromPos + i];
  }
}
function snappyUncompress(input, output) {
  const inputLength = input.byteLength;
  const outputLength = output.byteLength;
  let pos = 0;
  let outPos = 0;
  while (pos < inputLength) {
    const c = input[pos];
    pos++;
    if (c < 128) {
      break;
    }
  }
  if (outputLength && pos >= inputLength) {
    throw new Error("invalid snappy length header");
  }
  while (pos < inputLength) {
    const c = input[pos];
    let len = 0;
    pos++;
    if (pos >= inputLength) {
      throw new Error("missing eof marker");
    }
    if ((c & 3) === 0) {
      let len2 = (c >>> 2) + 1;
      if (len2 > 60) {
        if (pos + 3 >= inputLength) {
          throw new Error("snappy error literal pos + 3 >= inputLength");
        }
        const lengthSize = len2 - 60;
        len2 = input[pos] + (input[pos + 1] << 8) + (input[pos + 2] << 16) + (input[pos + 3] << 24);
        len2 = (len2 & WORD_MASK[lengthSize]) + 1;
        pos += lengthSize;
      }
      if (pos + len2 > inputLength) {
        throw new Error("snappy error literal exceeds input length");
      }
      copyBytes(input, pos, output, outPos, len2);
      pos += len2;
      outPos += len2;
    } else {
      let offset = 0;
      switch (c & 3) {
        case 1:
          len = (c >>> 2 & 7) + 4;
          offset = input[pos] + (c >>> 5 << 8);
          pos++;
          break;
        case 2:
          if (inputLength <= pos + 1) {
            throw new Error("snappy error end of input");
          }
          len = (c >>> 2) + 1;
          offset = input[pos] + (input[pos + 1] << 8);
          pos += 2;
          break;
        case 3:
          if (inputLength <= pos + 3) {
            throw new Error("snappy error end of input");
          }
          len = (c >>> 2) + 1;
          offset = input[pos] + (input[pos + 1] << 8) + (input[pos + 2] << 16) + (input[pos + 3] << 24);
          pos += 4;
          break;
        default:
          break;
      }
      if (offset === 0 || isNaN(offset)) {
        throw new Error(`invalid offset ${offset} pos ${pos} inputLength ${inputLength}`);
      }
      if (offset > outPos) {
        throw new Error("cannot copy from before start of buffer");
      }
      copyBytes(output, outPos - offset, output, outPos, len);
      outPos += len;
    }
  }
  if (outPos !== outputLength) throw new Error("premature end of input");
}

// node_modules/hyparquet/src/datapage.js
function readDataPage(bytes, daph, { type, element, schemaPath }) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reader = { view, offset: 0 };
  let dataPage;
  const repetitionLevels = readRepetitionLevels(reader, daph, schemaPath);
  const { definitionLevels, numNulls } = readDefinitionLevels(reader, daph, schemaPath);
  const nValues = daph.num_values - numNulls;
  if (daph.encoding === "PLAIN") {
    dataPage = readPlain(reader, type, nValues, element.type_length);
  } else if (daph.encoding === "PLAIN_DICTIONARY" || daph.encoding === "RLE_DICTIONARY" || daph.encoding === "RLE") {
    const bitWidth2 = type === "BOOLEAN" ? 1 : view.getUint8(reader.offset++);
    if (bitWidth2) {
      dataPage = new Array(nValues);
      if (type === "BOOLEAN") {
        readRleBitPackedHybrid(reader, bitWidth2, dataPage);
        dataPage = dataPage.map((x) => !!x);
      } else {
        readRleBitPackedHybrid(reader, bitWidth2, dataPage, view.byteLength - reader.offset);
      }
    } else {
      dataPage = new Uint8Array(nValues);
    }
  } else if (daph.encoding === "BYTE_STREAM_SPLIT") {
    dataPage = byteStreamSplit(reader, nValues, type, element.type_length);
  } else if (daph.encoding === "DELTA_BINARY_PACKED") {
    const int32 = type === "INT32";
    dataPage = int32 ? new Int32Array(nValues) : new BigInt64Array(nValues);
    deltaBinaryUnpack(reader, nValues, dataPage);
  } else if (daph.encoding === "DELTA_LENGTH_BYTE_ARRAY") {
    dataPage = new Array(nValues);
    deltaLengthByteArray(reader, nValues, dataPage);
  } else {
    throw new Error(`parquet unsupported encoding: ${daph.encoding}`);
  }
  return { definitionLevels, repetitionLevels, dataPage };
}
function readRepetitionLevels(reader, daph, schemaPath) {
  if (schemaPath.length > 1) {
    const maxRepetitionLevel = getMaxRepetitionLevel(schemaPath);
    if (maxRepetitionLevel) {
      const values = new Array(daph.num_values);
      readRleBitPackedHybrid(reader, bitWidth(maxRepetitionLevel), values);
      return values;
    }
  }
  return [];
}
function readDefinitionLevels(reader, daph, schemaPath) {
  const maxDefinitionLevel = getMaxDefinitionLevel(schemaPath);
  if (!maxDefinitionLevel) return { definitionLevels: [], numNulls: 0 };
  const definitionLevels = new Array(daph.num_values);
  readRleBitPackedHybrid(reader, bitWidth(maxDefinitionLevel), definitionLevels);
  let numNulls = daph.num_values;
  for (const def of definitionLevels) {
    if (def === maxDefinitionLevel) numNulls--;
  }
  if (numNulls === 0) definitionLevels.length = 0;
  return { definitionLevels, numNulls };
}
function decompressPage(compressedBytes, uncompressed_page_size, codec, compressors) {
  let page;
  const customDecompressor = compressors?.[codec];
  if (codec === "UNCOMPRESSED") {
    page = compressedBytes;
  } else if (customDecompressor) {
    page = customDecompressor(compressedBytes, uncompressed_page_size);
  } else if (codec === "SNAPPY") {
    page = new Uint8Array(uncompressed_page_size);
    snappyUncompress(compressedBytes, page);
  } else {
    throw new Error(`parquet unsupported compression codec: ${codec}`);
  }
  if (page?.length !== uncompressed_page_size) {
    throw new Error(`parquet decompressed page length ${page?.length} does not match header ${uncompressed_page_size}`);
  }
  return page;
}
function readDataPageV2(compressedBytes, ph, columnDecoder) {
  const view = new DataView(compressedBytes.buffer, compressedBytes.byteOffset, compressedBytes.byteLength);
  const reader = { view, offset: 0 };
  const { type, element, schemaPath, codec, compressors } = columnDecoder;
  const daph2 = ph.data_page_header_v2;
  if (!daph2) throw new Error("parquet data page header v2 is undefined");
  const repetitionLevels = readRepetitionLevelsV2(reader, daph2, schemaPath);
  reader.offset = daph2.repetition_levels_byte_length;
  const definitionLevels = readDefinitionLevelsV2(reader, daph2, schemaPath);
  const uncompressedPageSize = ph.uncompressed_page_size - daph2.definition_levels_byte_length - daph2.repetition_levels_byte_length;
  let page = compressedBytes.subarray(reader.offset);
  if (daph2.is_compressed !== false) {
    page = decompressPage(page, uncompressedPageSize, codec, compressors);
  }
  const pageView = new DataView(page.buffer, page.byteOffset, page.byteLength);
  const pageReader = { view: pageView, offset: 0 };
  let dataPage;
  const nValues = daph2.num_values - daph2.num_nulls;
  if (daph2.encoding === "PLAIN") {
    dataPage = readPlain(pageReader, type, nValues, element.type_length);
  } else if (daph2.encoding === "RLE") {
    dataPage = new Array(nValues);
    readRleBitPackedHybrid(pageReader, 1, dataPage);
    dataPage = dataPage.map((x) => !!x);
  } else if (daph2.encoding === "PLAIN_DICTIONARY" || daph2.encoding === "RLE_DICTIONARY") {
    const bitWidth2 = pageView.getUint8(pageReader.offset++);
    dataPage = new Array(nValues);
    readRleBitPackedHybrid(pageReader, bitWidth2, dataPage, uncompressedPageSize - 1);
  } else if (daph2.encoding === "DELTA_BINARY_PACKED") {
    const int32 = type === "INT32";
    dataPage = int32 ? new Int32Array(nValues) : new BigInt64Array(nValues);
    deltaBinaryUnpack(pageReader, nValues, dataPage);
  } else if (daph2.encoding === "DELTA_LENGTH_BYTE_ARRAY") {
    dataPage = new Array(nValues);
    deltaLengthByteArray(pageReader, nValues, dataPage);
  } else if (daph2.encoding === "DELTA_BYTE_ARRAY") {
    dataPage = new Array(nValues);
    deltaByteArray(pageReader, nValues, dataPage);
  } else if (daph2.encoding === "BYTE_STREAM_SPLIT") {
    dataPage = byteStreamSplit(pageReader, nValues, type, element.type_length);
  } else {
    throw new Error(`parquet unsupported encoding: ${daph2.encoding}`);
  }
  return { definitionLevels, repetitionLevels, dataPage };
}
function readRepetitionLevelsV2(reader, daph2, schemaPath) {
  const maxRepetitionLevel = getMaxRepetitionLevel(schemaPath);
  if (!maxRepetitionLevel) return [];
  const values = new Array(daph2.num_values);
  readRleBitPackedHybrid(reader, bitWidth(maxRepetitionLevel), values, daph2.repetition_levels_byte_length);
  return values;
}
function readDefinitionLevelsV2(reader, daph2, schemaPath) {
  const maxDefinitionLevel = getMaxDefinitionLevel(schemaPath);
  if (maxDefinitionLevel) {
    const values = new Array(daph2.num_values);
    readRleBitPackedHybrid(reader, bitWidth(maxDefinitionLevel), values, daph2.definition_levels_byte_length);
    return values;
  }
}
function bitWidth(value) {
  return 32 - Math.clz32(value);
}

// node_modules/hyparquet/src/column.js
function readColumn(reader, { groupStart, selectStart, selectEnd }, columnDecoder, onPage) {
  const { pathInSchema, schemaPath } = columnDecoder;
  const isFlat = isFlatColumn(schemaPath);
  const chunks = [];
  let dictionary = void 0;
  let lastChunk = void 0;
  let rowCount = 0;
  let skipped = 0;
  const emitLastChunk = onPage && (() => {
    lastChunk && onPage({
      pathInSchema,
      columnData: lastChunk,
      rowStart: groupStart + rowCount - lastChunk.length,
      rowEnd: groupStart + rowCount
    });
  });
  while (isFlat ? rowCount < selectEnd : reader.offset < reader.view.byteLength - 1) {
    if (reader.offset >= reader.view.byteLength - 1) break;
    const header = parquetHeader(reader);
    if (header.type === "DICTIONARY_PAGE") {
      const { data } = readPage(reader, header, columnDecoder, dictionary, void 0, 0);
      if (data) dictionary = convert(data, columnDecoder);
    } else {
      const lastChunkLength = lastChunk?.length || 0;
      const result = readPage(reader, header, columnDecoder, dictionary, lastChunk, selectStart - rowCount);
      if (result.skipped) {
        if (!chunks.length) {
          skipped += result.skipped;
        }
        rowCount += result.skipped;
      } else if (result.data && lastChunk === result.data) {
        rowCount += result.data.length - lastChunkLength;
      } else if (result.data && result.data.length) {
        emitLastChunk?.();
        chunks.push(result.data);
        rowCount += result.data.length;
        lastChunk = result.data;
      }
    }
  }
  emitLastChunk?.();
  return { data: chunks, skipped };
}
function readPage(reader, header, columnDecoder, dictionary, previousChunk, pageStart) {
  const { type, element, schemaPath, codec, compressors } = columnDecoder;
  const compressedBytes = new Uint8Array(
    reader.view.buffer,
    reader.view.byteOffset + reader.offset,
    header.compressed_page_size
  );
  reader.offset += header.compressed_page_size;
  if (header.type === "DATA_PAGE") {
    const daph = header.data_page_header;
    if (!daph) throw new Error("parquet data page header is undefined");
    if (pageStart > daph.num_values && isFlatColumn(schemaPath)) {
      return { skipped: daph.num_values };
    }
    const page = decompressPage(compressedBytes, Number(header.uncompressed_page_size), codec, compressors);
    const { definitionLevels, repetitionLevels, dataPage } = readDataPage(page, daph, columnDecoder);
    const values = convertWithDictionary(dataPage, dictionary, daph.encoding, columnDecoder);
    const output = Array.isArray(previousChunk) ? previousChunk : [];
    const assembled = assembleLists(output, definitionLevels, repetitionLevels, values, schemaPath);
    return { skipped: 0, data: assembled };
  } else if (header.type === "DATA_PAGE_V2") {
    const daph2 = header.data_page_header_v2;
    if (!daph2) throw new Error("parquet data page header v2 is undefined");
    if (pageStart > daph2.num_rows) {
      return { skipped: daph2.num_values };
    }
    const { definitionLevels, repetitionLevels, dataPage } = readDataPageV2(compressedBytes, header, columnDecoder);
    const values = convertWithDictionary(dataPage, dictionary, daph2.encoding, columnDecoder);
    const output = Array.isArray(previousChunk) ? previousChunk : [];
    const assembled = assembleLists(output, definitionLevels, repetitionLevels, values, schemaPath);
    return { skipped: 0, data: assembled };
  } else if (header.type === "DICTIONARY_PAGE") {
    const diph = header.dictionary_page_header;
    if (!diph) throw new Error("parquet dictionary page header is undefined");
    const page = decompressPage(
      compressedBytes,
      Number(header.uncompressed_page_size),
      codec,
      compressors
    );
    const reader2 = { view: new DataView(page.buffer, page.byteOffset, page.byteLength), offset: 0 };
    const dictArray = readPlain(reader2, type, diph.num_values, element.type_length);
    return { skipped: 0, data: dictArray };
  } else {
    throw new Error(`parquet unsupported page type: ${header.type}`);
  }
}
function parquetHeader(reader) {
  const header = deserializeTCompactProtocol(reader);
  const type = PageTypes[header.field_1];
  const uncompressed_page_size = header.field_2;
  const compressed_page_size = header.field_3;
  const crc = header.field_4;
  const data_page_header = header.field_5 && {
    num_values: header.field_5.field_1,
    encoding: Encodings[header.field_5.field_2],
    definition_level_encoding: Encodings[header.field_5.field_3],
    repetition_level_encoding: Encodings[header.field_5.field_4],
    statistics: header.field_5.field_5 && {
      max: header.field_5.field_5.field_1,
      min: header.field_5.field_5.field_2,
      null_count: header.field_5.field_5.field_3,
      distinct_count: header.field_5.field_5.field_4,
      max_value: header.field_5.field_5.field_5,
      min_value: header.field_5.field_5.field_6
    }
  };
  const index_page_header = header.field_6;
  const dictionary_page_header = header.field_7 && {
    num_values: header.field_7.field_1,
    encoding: Encodings[header.field_7.field_2],
    is_sorted: header.field_7.field_3
  };
  const data_page_header_v2 = header.field_8 && {
    num_values: header.field_8.field_1,
    num_nulls: header.field_8.field_2,
    num_rows: header.field_8.field_3,
    encoding: Encodings[header.field_8.field_4],
    definition_levels_byte_length: header.field_8.field_5,
    repetition_levels_byte_length: header.field_8.field_6,
    is_compressed: header.field_8.field_7 === void 0 ? true : header.field_8.field_7,
    // default true
    statistics: header.field_8.field_8
  };
  return {
    type,
    uncompressed_page_size,
    compressed_page_size,
    crc,
    data_page_header,
    index_page_header,
    dictionary_page_header,
    data_page_header_v2
  };
}

// node_modules/hyparquet/src/rowgroup.js
function readRowGroup(options, { metadata }, groupPlan) {
  const asyncColumns = [];
  for (const chunk of groupPlan.chunks) {
    const { path_in_schema: pathInSchema } = chunk.columnMetadata;
    const schemaPath = getSchemaPath(metadata.schema, pathInSchema);
    const columnDecoder = {
      pathInSchema,
      element: schemaPath[schemaPath.length - 1].element,
      schemaPath,
      parsers: { ...DEFAULT_PARSERS, ...options.parsers },
      ...options,
      ...chunk.columnMetadata
    };
    const { startByte, endByte } = chunk.range;
    if ("pageLocations" in chunk) {
      asyncColumns.push({
        pathInSchema,
        data: readSelectedPages(options, groupPlan, chunk, chunk.pageLocations, columnDecoder)
      });
    } else if ("offsetIndex" in chunk) {
      asyncColumns.push({
        pathInSchema,
        // fetch offset index
        data: Promise.resolve(options.file.slice(chunk.offsetIndex.startByte, chunk.offsetIndex.endByte)).then((arrayBuffer) => {
          const pages = readOffsetIndex({ view: new DataView(arrayBuffer), offset: 0 }).page_locations;
          return readSelectedPages(options, groupPlan, chunk, pages, columnDecoder);
        })
      });
    } else {
      asyncColumns.push({
        pathInSchema,
        data: Promise.resolve(options.file.slice(startByte, endByte)).then((buffer) => {
          const reader = { view: new DataView(buffer), offset: 0 };
          return readColumn(reader, groupPlan, columnDecoder, options.onPage);
        })
      });
    }
  }
  return {
    groupStart: groupPlan.groupStart,
    groupRows: groupPlan.groupRows,
    selectStart: groupPlan.selectStart,
    selectEnd: groupPlan.selectEnd,
    asyncColumns
  };
}
async function readSelectedPages(options, groupPlan, chunk, pages, columnDecoder) {
  const { data_page_offset, dictionary_page_offset } = chunk.columnMetadata;
  const { selectStart, selectEnd } = groupPlan;
  let { startByte, endByte } = chunk.range;
  let skipped = -1;
  const hasDict = dictionary_page_offset || data_page_offset < pages[0].offset;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageStart = Number(page.first_row_index);
    const pageEnd = i + 1 < pages.length ? Number(pages[i + 1].first_row_index) : groupPlan.groupRows;
    if (skipped < 0 && pageEnd > selectStart) {
      startByte = Number(page.offset);
      skipped = pageStart;
    }
    if (pageStart < selectEnd) {
      endByte = Number(page.offset) + page.compressed_page_size;
    }
  }
  if (skipped < 0) skipped = 0;
  let view;
  if (hasDict && skipped) {
    const dictLength = Number(pages[0].offset) - chunk.range.startByte;
    const [dictBuffer, dataBuffer] = await Promise.all([
      options.file.slice(chunk.range.startByte, Number(pages[0].offset)),
      options.file.slice(startByte, endByte)
    ]);
    const combined = new Uint8Array(dictLength + dataBuffer.byteLength);
    combined.set(new Uint8Array(dictBuffer, 0, dictLength));
    combined.set(new Uint8Array(dataBuffer), dictLength);
    view = new DataView(combined.buffer);
  } else if (hasDict) {
    view = new DataView(await options.file.slice(chunk.range.startByte, endByte));
  } else {
    view = new DataView(await options.file.slice(startByte, endByte));
  }
  const reader = { view, offset: 0 };
  const adjustedGroupPlan = skipped ? {
    ...groupPlan,
    groupStart: groupPlan.groupStart + skipped,
    selectStart: groupPlan.selectStart - skipped,
    selectEnd: groupPlan.selectEnd - skipped
  } : groupPlan;
  const { data, skipped: columnSkipped } = readColumn(reader, adjustedGroupPlan, columnDecoder, options.onPage);
  return {
    data,
    skipped: skipped + columnSkipped
  };
}
async function asyncGroupToRows({ asyncColumns }, selectStart, selectEnd, columns, rowFormat) {
  const asyncPages = await Promise.all(asyncColumns.map(
    (column) => column.data.then(({ skipped, data }) => ({ skipped, data: flatten(data) }))
  ));
  const selectCount = selectEnd - selectStart;
  if (rowFormat === "object") {
    const groupData2 = Array(selectCount);
    for (let selectRow = 0; selectRow < selectCount; selectRow++) {
      const rowData = {};
      for (let i = 0; i < asyncColumns.length; i++) {
        const { data, skipped } = asyncPages[i];
        rowData[asyncColumns[i].pathInSchema[0]] = data[selectStart + selectRow - skipped];
      }
      groupData2[selectRow] = rowData;
    }
    return groupData2;
  }
  const includedColumnNames = asyncColumns.map((child) => child.pathInSchema[0]).filter((name) => !columns || columns.includes(name));
  const columnOrder = columns ?? includedColumnNames;
  const columnIndexes = columnOrder.map((name) => asyncColumns.findIndex((column) => column.pathInSchema[0] === name));
  const groupData = Array(selectCount);
  for (let selectRow = 0; selectRow < selectCount; selectRow++) {
    const rowData = Array(asyncColumns.length);
    for (let i = 0; i < columnOrder.length; i++) {
      const colIdx = columnIndexes[i];
      if (colIdx < 0) throw new Error(`parquet column not found: ${columnOrder[i]}`);
      const { data, skipped } = asyncPages[colIdx];
      rowData[i] = data[selectStart + selectRow - skipped];
    }
    groupData[selectRow] = rowData;
  }
  return groupData;
}
function assembleAsync(asyncRowGroup, schemaTree2, parsers) {
  const { asyncColumns } = asyncRowGroup;
  parsers = { ...DEFAULT_PARSERS, ...parsers };
  const assembled = [];
  for (const child of schemaTree2.children) {
    if (child.children.length) {
      const childColumns = asyncColumns.filter((column) => column.pathInSchema[0] === child.element.name);
      if (!childColumns.length) continue;
      assembled.push({
        pathInSchema: child.path,
        data: (async () => {
          const resolved = await Promise.all(childColumns.map((c) => c.data));
          const subcolumnData = /* @__PURE__ */ new Map();
          const flattened = resolved.map(({ data }) => flatten(data));
          const skipped = Math.max(...resolved.map((result) => result.skipped));
          const end = Math.min(...resolved.map((result, i) => result.skipped + flattened[i].length));
          for (let i = 0; i < childColumns.length; i++) {
            const start = skipped - resolved[i].skipped;
            const length = Math.max(0, end - skipped);
            subcolumnData.set(
              childColumns[i].pathInSchema.join("."),
              flattened[i].slice(start, start + length)
            );
          }
          assembleNested(subcolumnData, child, parsers);
          const assembled2 = subcolumnData.get(child.element.name);
          if (!assembled2) throw new Error("parquet column data not assembled");
          return { data: [assembled2], skipped };
        })()
      });
    } else {
      const asyncColumn = asyncColumns.find((column) => column.pathInSchema[0] === child.element.name);
      if (asyncColumn) assembled.push(asyncColumn);
    }
  }
  return { ...asyncRowGroup, asyncColumns: assembled };
}

// node_modules/hyparquet/src/scan.js
async function prepareParquetRead(options) {
  const prepared = await prepareParquetOptions(options);
  return {
    options: prepared,
    plan: parquetPlan(prepared)
  };
}
async function prepareParquetOptions(options) {
  const metadata = options.metadata ?? await parquetMetadataAsync(options.file, options);
  const schemaColumns = parquetSchema(metadata).children.map((child) => child.element.name);
  const filterColumns = columnsNeededForFilter(options.filter);
  const missingFilterColumns = filterColumns.filter((column) => !schemaColumns.includes(column));
  if (missingFilterColumns.length) {
    throw new Error(`parquet filter columns not found: ${missingFilterColumns.join(", ")}`);
  }
  if (options.columns) {
    const missingColumns = options.columns.filter((column) => !schemaColumns.includes(column));
    if (missingColumns.length) throw new Error(`parquet column not found: ${missingColumns[0]}`);
  }
  let prepared = { ...options, metadata };
  prepared = await withBloomFilters(prepared);
  prepared = await withPageIndexes(prepared);
  return prepared;
}
function readParquetPlan(options, plan) {
  const readOptions = { ...options, file: prefetchAsyncBuffer(options.file, plan) };
  return plan.groups.map((group) => readRowGroup(readOptions, plan, group));
}
async function withBloomFilters(options) {
  if (!options.useBloomFilters || !options.filter || !options.metadata) return options;
  const schemaTree2 = parquetSchema(options.metadata);
  const schemaElements = {};
  for (const child of schemaTree2.children) schemaElements[child.element.name] = child.element;
  const bloomFiltersByGroup = await prefetchBloomFilters({
    file: options.file,
    metadata: options.metadata,
    filter: options.filter,
    filterStrict: options.filterStrict
  });
  return { ...options, bloomFiltersByGroup, schemaElements };
}
async function withPageIndexes(options) {
  if (!options.usePageIndex || !options.filter || !options.metadata) return options;
  const { pageRangesByGroup, pageLocationsByGroup } = await prefetchPageIndexes({
    file: options.file,
    metadata: options.metadata,
    filter: options.filter,
    filterStrict: options.filterStrict,
    rowStart: options.rowStart,
    rowEnd: options.rowEnd,
    columns: options.columns,
    bloomFiltersByGroup: options.bloomFiltersByGroup,
    schemaElements: options.schemaElements,
    parsers: options.parsers
  });
  return { ...options, pageRangesByGroup, pageLocationsByGroup };
}

// node_modules/hyparquet/src/read.js
var rowIndex = (
  /** @type {typeof import('../src/types.js').rowIndex} */
  /* @__PURE__ */ Symbol("rowIndex")
);
async function parquetRead(options) {
  options.metadata ??= await parquetMetadataAsync(options.file, options);
  const { rowStart = 0, rowEnd, columns, onChunk, onComplete, rowFormat, filter, filterStrict = true } = options;
  if (filter && rowFormat !== "object") {
    throw new Error('parquet filter requires rowFormat: "object"');
  }
  if (options.includeRowIndex && rowFormat !== "object") {
    throw new Error('parquet includeRowIndex requires rowFormat: "object"');
  }
  const filterColumns = columnsNeededForFilter(filter);
  let readColumns = columns;
  if (columns && filterColumns.length) {
    const selectedColumns = new Set(columns);
    const extraColumns = filterColumns.filter((column) => !selectedColumns.has(column));
    if (extraColumns.length) readColumns = [...columns, ...extraColumns];
  }
  const readOptions = readColumns === columns ? options : { ...options, columns: readColumns };
  const prepared = await prepareParquetRead(readOptions);
  const preparedOptions = prepared.options;
  const requiresProjection = readColumns !== columns;
  const asyncGroups = readParquetPlan(preparedOptions, prepared.plan);
  if (!onComplete && !onChunk) {
    await awaitAllColumns(asyncGroups);
    return;
  }
  if (!preparedOptions.metadata) throw new Error("parquet requires metadata");
  const schemaTree2 = parquetSchema(preparedOptions.metadata);
  const assembled = asyncGroups.map((arg) => assembleAsync(arg, schemaTree2, options.parsers));
  if (onChunk) {
    for (const asyncGroup of assembled) {
      for (const asyncColumn of asyncGroup.asyncColumns) {
        asyncColumn.data.then(({ data, skipped }) => {
          let rowStart2 = asyncGroup.groupStart + skipped;
          for (const columnData of data) {
            onChunk({
              columnName: asyncColumn.pathInSchema[0],
              columnData,
              rowStart: rowStart2,
              rowEnd: rowStart2 + columnData.length
            });
            rowStart2 += columnData.length;
          }
        }, () => {
        });
      }
    }
  }
  if (onComplete) {
    await awaitAllColumns(assembled);
    const rows = [];
    for (const asyncGroup of assembled) {
      const selectStart = asyncGroup.selectStart ?? Math.max(rowStart - asyncGroup.groupStart, 0);
      const selectEnd = asyncGroup.selectEnd ?? Math.min((rowEnd ?? Infinity) - asyncGroup.groupStart, asyncGroup.groupRows);
      const groupData = rowFormat === "object" ? await asyncGroupToRows(asyncGroup, selectStart, selectEnd, readColumns, "object") : await asyncGroupToRows(asyncGroup, selectStart, selectEnd, columns, "array");
      if (options.includeRowIndex) {
        for (let i = 0; i < groupData.length; i++) {
          Object.defineProperty(groupData[i], rowIndex, {
            value: asyncGroup.groupStart + selectStart + i
          });
        }
      }
      if (filter) {
        for (
          const row of
          /** @type {Record<string, any>[]} */
          groupData
        ) {
          if (matchFilter(row, filter, filterStrict)) {
            if (requiresProjection && columns) {
              for (const col of filterColumns) {
                if (!columns.includes(col)) delete row[col];
              }
            }
            rows.push(row);
          }
        }
      } else {
        concat(rows, groupData);
      }
    }
    onComplete(rows);
  } else {
    await awaitAllColumns(assembled);
  }
}
async function awaitAllColumns(asyncGroups) {
  const all = asyncGroups.flatMap((g) => g.asyncColumns.map((c) => c.data));
  const results = await Promise.allSettled(all);
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
}
function parquetReadObjects(options) {
  return new Promise((onComplete, reject) => {
    parquetRead({
      ...options,
      rowFormat: "object",
      // force object output
      onComplete
    }).catch(reject);
  });
}

// src/store/config.ts
import { fileURLToPath } from "url";
import { join, dirname } from "path";
var PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
var DB_DIR = join(PKG_ROOT, "db");
var DATA_DIR = process.env.OPENTDX_DATA_DIR || join(DB_DIR, "data");
var DB_PATH = join(DATA_DIR, "warehouse.duckdb");
function marketLabel(mkt) {
  const m = Number(mkt?.value ?? mkt);
  if (m <= 2) return ["SZ", "SH", "BJ"][m];
  const name = ExMarket[m];
  return typeof name === "string" ? name : `M${m}`;
}
function symKey(market, code) {
  return `${marketLabel(market)}.${code}`;
}

// src/store/persist.ts
var _Database = null;
var _warned = false;
function abspath(rel) {
  return isAbsolute(rel) ? rel : join2(DATA_DIR, rel);
}
async function getDatabase() {
  if (_Database) return _Database;
  mkdirSync(DATA_DIR, { recursive: true });
  let duckdb;
  try {
    duckdb = await import("duckdb");
  } catch {
    if (!_warned) {
      console.warn("[tdx-store] \u672A\u5B89\u88C5 duckdb\uFF0C\u843D\u5E93\u88AB\u8DF3\u8FC7\uFF08\u53EF\u9009\u4F9D\u8D56\uFF1Anpm i duckdb\uFF09");
      _warned = true;
    }
    return null;
  }
  _Database = duckdb.Database ?? duckdb.default?.Database;
  return _Database;
}
function freshConn(Database) {
  return new Database(":memory:");
}
function connRun(c, sql) {
  return new Promise((resolve2, reject) => {
    c.run(sql, (err) => err ? reject(err) : resolve2());
  });
}
function connClose(c) {
  return new Promise((resolve2) => {
    try {
      c.close(() => resolve2());
    } catch {
      resolve2();
    }
  });
}
async function readOldParquet(path) {
  try {
    const buf = readFileSync(path);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return await parquetReadObjects({ file: ab });
  } catch {
    return null;
  }
}
function dateStr(v) {
  if (v == null) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toLocalIso(v) {
  const d = v instanceof Date ? v : typeof v === "string" ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) return v;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
function dedupKeepLast(rows, keys) {
  const seen = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const k = keys.map((kk) => {
      const v = r[kk];
      if (v instanceof Date) return toLocalIso(v);
      if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return toLocalIso(v);
      return String(v ?? "");
    }).join("\0");
    seen.set(k, r);
  }
  return [...seen.values()];
}
async function mergeFile(rel, rows, keys) {
  if (!rows || rows.length === 0) return 0;
  const DB = await getDatabase();
  if (!DB) return 0;
  try {
    const abs = abspath(rel);
    mkdirSync(dirname2(abs), { recursive: true });
    let merged = rows;
    if (existsSync(abs) && keys.length > 0) {
      const old = await readOldParquet(abs);
      if (old && old.length) merged = dedupKeepLast([...old, ...rows], keys);
    }
    const tmpJson = join2(tmpdir(), `tdx-persist-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(tmpJson, merged.map((r) => JSON.stringify(r, (_k, v) => typeof v === "bigint" ? Number(v) : v)).join("\n"), "utf8");
    const wdb = freshConn(DB);
    try {
      const sql = `COPY (SELECT * FROM read_json_auto('${tmpJson.replace(/\\/g, "\\\\").replace(/'/g, "''")}')) TO '${abs.replace(/'/g, "''")}' (FORMAT PARQUET, COMPRESSION 'SNAPPY', OVERWRITE true)`;
      await connRun(wdb, sql);
    } finally {
      await connClose(wdb);
    }
    return merged.length;
  } catch (e) {
    if (!_warned) {
      console.warn("[tdx-store] \u843D\u5E93\u5931\u8D25\uFF08\u8DF3\u8FC7\uFF0C\u884C\u60C5\u7167\u5E38\u8FD4\u56DE\uFF09:", e.message);
      _warned = true;
    }
    return 0;
  }
}
function mergeDaily(table, rows, keys, dt) {
  return mergeFile(`${table}/${dt}.parquet`, rows, keys);
}
function mktInt(m) {
  return Number(m?.value ?? m);
}
function todayIso() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
async function persistKline(market, code, period, adjust, bars) {
  if (!bars || bars.length === 0) return 0;
  const pv = mktInt(period);
  const av = mktInt(adjust);
  const rows = bars.map((b) => ({
    datetime: toLocalIso(b.datetime),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    vol: b.vol,
    amount: b.amount,
    float_shares: b.float_shares,
    turnover: b.turnover,
    symbol_key: symKey(market, code),
    period: pv,
    adjust: av,
    dt: dateStr(b.datetime)
  }));
  return mergeFile(`fakt_kline/${pv}/${av}/${mktInt(market)}_${code}.parquet`, rows, ["datetime"]);
}
async function persistQuotes(rows, dt) {
  const r = (rows || []).filter(Boolean);
  if (r.length === 0) return 0;
  const d = dt || todayIso();
  for (const x of r) {
    const m = mktInt(x.market ?? 0);
    x.market = m;
    x.symbol_key = x.symbol_key ?? symKey(m, x.code);
    x.dt = d;
    x.snapshot_at = (/* @__PURE__ */ new Date()).toISOString();
  }
  return mergeDaily("fakt_quote", r, ["symbol_key"], d);
}
async function persistFlow(flow, market, code = "", dt) {
  if (!flow || typeof flow !== "object") return 0;
  const d = dt || todayIso();
  const data = { ...flow };
  data.symbol_key = market != null ? symKey(market, code) : data.symbol_key;
  data.dt = d;
  return mergeDaily("fakt_capital_flow", [data], ["symbol_key"], d);
}
async function persistBelong(rows, market, code) {
  const items = (rows || []).filter(Boolean);
  if (items.length === 0) return 0;
  for (const b of items) b.symbol_key = b.symbol_key ?? symKey(market, code);
  const boardId = "board_code" in items[0] ? "board_code" : "board_symbol" in items[0] ? "board_symbol" : null;
  return mergeFile("fakt_belong_board.parquet", items, boardId ? ["symbol_key", boardId] : ["symbol_key"]);
}
async function persistSymbolInfo(info, market, code) {
  if (!info) return 0;
  const m = mktInt(info.market ?? market);
  const row = {
    symbol_key: symKey(market, code),
    market: m,
    code: info.code ?? code,
    name: info.name ?? "",
    market_type: mktInt(market) <= 2 ? "A_STOCK" : "EXTENDED",
    price_decimals: info.price_decimals,
    per_hand: info.per_hand,
    industry: info.industry,
    category: info.category,
    is_index: false,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  return mergeFile("dim_symbol.parquet", [row], ["symbol_key"]);
}
async function persistServer(info) {
  if (!info) return 0;
  return mergeFile("dim_server.parquet", [{ ...info, queried_at: (/* @__PURE__ */ new Date()).toISOString() }], []);
}
async function asDtCol(rows) {
  return rows.map((r) => {
    const x = { ...r };
    if (x.datetime == null) x.datetime = String(x.time ?? "");
    return x;
  });
}
async function persistIntraday(market, code, queryDate, charts, source = "tick", dt) {
  if (!charts || charts.length === 0) return 0;
  const d = dt || queryDate || todayIso();
  const rows = await asDtCol(charts);
  for (const x of rows) {
    x.symbol_key = symKey(market, code);
    x.source = source;
    x.dt = d;
  }
  return mergeDaily("fakt_intraday", rows, ["symbol_key", "datetime"], d);
}
async function persistTrades(market, code, queryDate, trades, dt) {
  if (!trades || trades.length === 0) return 0;
  const d = dt || queryDate || todayIso();
  const rows = await asDtCol(trades);
  for (const x of rows) {
    x.symbol_key = symKey(market, code);
    x.dt = d;
  }
  return mergeDaily("fakt_trade", rows, ["symbol_key", "datetime", "price"], d);
}
async function persistAuction(market, code, result, dt) {
  const items = (result || {}).items || [];
  if (items.length === 0) return 0;
  const d = dt || todayIso();
  const rows = await asDtCol(items);
  for (const x of rows) {
    x.symbol_key = symKey(market, code);
    x.dt = d;
  }
  return mergeDaily("fakt_auction", rows, ["symbol_key", "datetime"], d);
}
async function persistUnusual(rows, dt) {
  const r = (rows || []).filter(Boolean);
  if (r.length === 0) return 0;
  const d = dt || todayIso();
  const rr = await asDtCol(r);
  for (const x of rr) {
    const m = mktInt(x.market ?? 0);
    x.symbol_key = x.symbol_key ?? symKey(m, x.code);
    x.dt = d;
  }
  return mergeDaily("fakt_unusual", rr, ["symbol_key", "datetime", "unusual_type"], d);
}
async function persistBoardList(rows) {
  const r = (rows || []).filter(Boolean);
  if (r.length === 0) return 0;
  const df = r.map((x) => ({
    board_code: x.code,
    board_name: x.name,
    board_type: x.market,
    market: x.market,
    rep_symbol_code: x.symbol_code,
    rep_symbol_name: x.symbol_name,
    rep_symbol_market: x.symbol_market,
    price: x.price,
    rise_speed: x.rise_speed,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  }));
  return mergeFile("dim_board.parquet", df, ["board_code"]);
}

// src/store/store.ts
var TdxStore = class extends TdxClient {
  constructor(options = {}) {
    super(options);
  }
  // ── A股：K线 / 分时 / 成交 / 竞价 / 异动 ──
  async stockKline(market, code, period, start = 0, count = 800, times = 1, adjust = 0 /* NONE */) {
    const bars = await super.stockKline(market, code, period, start, count, times, adjust);
    await persistKline(market, code, period, adjust, bars);
    return bars;
  }
  async stockTickChart(market, code, date) {
    const charts = await super.stockTickChart(market, code, date);
    await persistIntraday(market, code, date ? date.toISOString().slice(0, 10) : null, charts);
    return charts;
  }
  async stockTransaction(market, code, date) {
    const trades = await super.stockTransaction(market, code, date);
    await persistTrades(market, code, date ? date.toISOString().slice(0, 10) : null, trades);
    return trades;
  }
  async stockAuction(market, code) {
    const result = await super.stockAuction(market, code);
    await persistAuction(market, code, result);
    return result;
  }
  async stockUnusual(market, start = 0, count = 0) {
    const rows = await super.stockUnusual(market, start, count);
    await persistUnusual(rows);
    return rows;
  }
  async stockMarketMonitor(market, start = 0, count = 10) {
    const rows = await super.stockMarketMonitor(market, start, count);
    await persistUnusual(rows);
    return rows;
  }
  // ── A股：板块 / 资金流向 / 个股特征 / 服务器 ──
  async stockBoardList(market = 255 /* ALL */, count = 1e4) {
    const rows = await super.stockBoardList(market, count);
    await persistBoardList(rows);
    return rows;
  }
  async stockBoardMembers(boardSymbol = "881001", count = 1e5, sortType = 14 /* CHANGE_PCT */, sortOrder = 1 /* DESC */, fields) {
    const rows = await super.stockBoardMembers(boardSymbol, count, sortType, sortOrder, fields);
    await persistQuotes(rows);
    return rows;
  }
  async stockQuotesFields(codeList, fields) {
    const rows = await super.stockQuotesFields(codeList, fields);
    await persistQuotes(rows);
    return rows;
  }
  async stockBelongBoard(market, code) {
    const result = await super.stockBelongBoard(market, code);
    const data = result?.data;
    await persistBelong(Array.isArray(data) ? data : null, market, code);
    return result;
  }
  async stockCapitalFlow(market, code) {
    const result = await super.stockCapitalFlow(market, code);
    await persistFlow(result?.data ?? null, market, code);
    return result;
  }
  async stockSymbolInfo(market, code) {
    const info = await super.stockSymbolInfo(market, code);
    await persistSymbolInfo(info, market, code);
    return info;
  }
  async serverInfo() {
    const info = await super.serverInfo();
    await persistServer(info);
    return info;
  }
  // ── 扩展市场 ──
  async goodsKline(market, code, period, start = 0, count = 800, times = 1) {
    const bars = await super.goodsKline(market, code, period, start, count, times);
    await persistKline(market, code, period, 0 /* NONE */, bars);
    return bars;
  }
  async goodsQuotes(codeList, code) {
    const rows = await super.goodsQuotes(codeList, code);
    await persistQuotes(rows);
    return rows;
  }
  async goodsTickChart(market, code, date) {
    const charts = await super.goodsTickChart(market, code, date);
    await persistIntraday(market, code, date ? date.toISOString().slice(0, 10) : null, charts);
    return charts;
  }
  async goodsHistoryTransaction(market, code, date) {
    const trades = await super.goodsHistoryTransaction(market, code, date);
    await persistTrades(market, code, date.toISOString().slice(0, 10), trades);
    return trades;
  }
};

// src/hist/hist-concept.ts
var DEFAULTS = {
  window: 60,
  min_corr: 0.45,
  nfac: 0,
  // 无 numpy：恒只去市场均（python HAS_NUMPY=false 时同）
  graph: "threshold",
  topk: 5,
  pool_n: 200,
  ttl_s: 3600
};
var MARKET_INT2STR = { 0: "SZ", 1: "SH", 2: "BJ" };
function pearson(a, b) {
  const n = a.length;
  if (n < 2) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const dx = a[i] - ma, dy = b[i] - mb;
    cov += dx * dy;
    va += dx * dx;
    vb += dy * dy;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}
var UnionFind = class {
  p;
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(x) {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]];
      x = this.p[x];
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.p[rb] = ra;
  }
};
function residualize(rets) {
  const T = rets[0].length;
  const mkt = new Array(T);
  for (let t = 0; t < T; t++) {
    let s = 0;
    for (const r of rets) s += r[t];
    mkt[t] = s / rets.length;
  }
  return rets.map((r) => r.map((v, t) => v - mkt[t]));
}
function clusterComponents(corr, minCorr) {
  const n = corr.length;
  const uf = new UnionFind(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (corr[i][j] >= minCorr) uf.union(i, j);
    }
  }
  const groups = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const g = uf.find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(i);
  }
  const comps = [...groups.values()].filter((v) => v.length >= 2);
  comps.sort((a, b) => b.length - a.length);
  return comps;
}
var AsyncMutex = class {
  tail = Promise.resolve();
  run(fn) {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => void 0);
    return next;
  }
};
var HistEngine = class {
  _fetch;
  _snapA;
  _nameHook;
  _cfg;
  _log;
  _mutex = new AsyncMutex();
  _klineCache = /* @__PURE__ */ new Map();
  _aRows = [];
  _aTs = 0;
  _snapKey = null;
  _snap = null;
  _builtAt = 0;
  constructor(fetchQfq, snapshotA, cfg, nameHook, log = console.log) {
    this._fetch = fetchQfq;
    this._snapA = snapshotA;
    this._nameHook = nameHook;
    this._cfg = { ...DEFAULTS, ...cfg };
    this._log = log;
  }
  status() {
    return {
      engine: "hist_concept(co-movement self-mined classes)",
      numpy: false,
      scipy: false,
      cfg: { ...this._cfg },
      kline_cached: this._klineCache.size,
      snapshot_ready: this._snap !== null,
      snapshot: (this._snap || {}).meta
    };
  }
  _normMarket(m) {
    const v = m && typeof m === "object" && "value" in m ? m.value : m;
    if (v === "SZ" || v === "SH") return String(v);
    const iv = parseInt(String(v), 10);
    return MARKET_INT2STR[iv] ?? "";
  }
  async _name(market, code) {
    if (this._nameHook) {
      try {
        const n = await this._nameHook(market, code);
        if (n) return String(n);
      } catch {
      }
    }
    return null;
  }
  async _fetchRows(market, code, beg, asOf) {
    const key = `${market.toUpperCase()}\0${code}\0${beg}\0${asOf}`;
    const hit = this._klineCache.get(key);
    if (hit !== void 0) return hit;
    const rows = await this._fetch(market.toUpperCase(), code, beg, asOf);
    const clean = [];
    for (const [d, c] of rows) {
      const f = Number(c);
      if (f && f > 0) clean.push([d, f]);
    }
    this._klineCache.set(key, clean);
    return clean;
  }
  async _ensureARows(ttl = 300) {
    const now = Date.now() / 1e3;
    if (this._aRows.length && now - this._aTs < ttl) return this._aRows;
    const rows = await this._snapA() || [];
    const keep = [];
    for (const r of rows) {
      const mkRaw = r && typeof r === "object" && "value" in r && r.market !== void 0 ? r.market : r.market;
      const v = parseInt(String(mkRaw), 10);
      if (!(v === 0 || v === 1)) continue;
      if (String(r.name || "").includes("ST")) continue;
      try {
        if (Number(r.amount || 0) <= 0 || Number(r.pre_close || 0) <= 0) continue;
      } catch {
        continue;
      }
      keep.push(r);
    }
    keep.sort((a, b) => -Number(a.amount));
    this._aRows = keep;
    this._aTs = now;
    return keep;
  }
  _rebuildCore(asOf, refresh = false, window, minCorr, poolN, extra) {
    return (async () => {
      const win = window ? Math.floor(window) : Math.floor(this._cfg.window);
      const mcorr = minCorr != null ? Number(minCorr) : Number(this._cfg.min_corr);
      const pn = poolN ? Math.floor(poolN) : Math.floor(this._cfg.pool_n);
      const end = asOf || todayIso2();
      const span = Math.floor(win * 3.5) + 60;
      const beg = isoAddDays(end, -span);
      const extraKey = (extra || []).map((e) => `${e.market ?? ""}:${e.code ?? ""}`).sort();
      const key = `${win}|${mcorr}|${pn}|${end}|${beg}|${extraKey.join(",")}`;
      const fresh = this._snap !== null && this._snapKey === key && Date.now() / 1e3 - this._builtAt < this._cfg.ttl_s && !refresh;
      if (fresh) return { ok: true, cached: true, meta: this._snap.meta };
      const t0 = Date.now() / 1e3;
      const poolRows = (await this._ensureARows()).slice(0, Math.max(0, pn - (extra || []).length));
      const seen = /* @__PURE__ */ new Set();
      const pool = [];
      for (const r of [...poolRows, ...extra || []]) {
        const mk = this._normMarket(r.market);
        if (mk !== "SZ" && mk !== "SH") continue;
        const k = mk + String(r.code);
        if (seen.has(k)) continue;
        seen.add(k);
        pool.push({ market: mk, code: String(r.code), name: String(r.name || ""), chg_pct: r.chg_pct });
      }
      const stocks = [];
      for (const s of pool) {
        stocks.push({
          market: s.market,
          code: s.code,
          name: s.name || await this._name(s.market, s.code) || s.code,
          chg_pct: s.chg_pct
        });
      }
      if (stocks.length < 10) return { ok: false, error: "\u53EF\u7528\u6C60 <10 \u53EA\uFF0C\u65E0\u6CD5\u5171\u805A", pool: stocks.length };
      const closes = /* @__PURE__ */ new Map();
      const failed = [];
      for (const s of stocks) {
        try {
          const rows = await this._fetchRows(s.market, s.code, beg, end);
          if (rows.length < win + 5) {
            failed.push([s.code, `\u5386\u53F2\u4E0D\u8DB3(${rows.length})`]);
            continue;
          }
          closes.set(s.market + s.code, rows);
        } catch (e) {
          failed.push([s.code, String(e.message).slice(0, 60)]);
        }
      }
      const usable = stocks.filter((s) => closes.has(s.market + s.code));
      if (usable.length < 10) return { ok: false, error: `\u53EF\u7528\u7968 <10\uFF0C\u65E0\u6CD5\u5171\u805A: ${failed.slice(0, 8).map(([c]) => c).join(",")}`, failed: failed.slice(0, 8) };
      const allDates = /* @__PURE__ */ new Set();
      for (const rows of closes.values()) for (const [d] of rows) allDates.add(d);
      const sortedDates = [...allDates].sort();
      const nPool = closes.size;
      const keepDates = sortedDates.filter((dt) => {
        let c = 0;
        for (const rows of closes.values()) {
          const last = rows[rows.length - 1][0];
          if (last >= dt && rows.some(([d]) => d === dt)) c++;
        }
        return c >= Math.max(1, Math.floor(nPool * 0.8));
      });
      const aligned = /* @__PURE__ */ new Map();
      const usable2 = [];
      for (const s of usable) {
        const k = s.market + s.code;
        const dmap = new Map(closes.get(k).map(([d, c]) => [d, c]));
        const ser = keepDates.map((dt) => dmap.get(dt));
        const tail = ser.slice(-(win + 1));
        if (tail.some((v) => v == null || v <= 0)) continue;
        aligned.set(k, tail);
        usable2.push(s);
      }
      if (usable2.length < 10) return { ok: false, error: "\u5BF9\u9F50\u540E\u53EF\u7528\u7968 <10\uFF08\u505C\u724C/\u8D1F\u4EF7\u8FC7\u6EE4\uFF09", usable: usable2.length, failed: failed.slice(0, 8) };
      const keep2 = keepDates.slice(-(win + 1));
      const rets = [];
      for (const s of usable2) {
        const f = aligned.get(s.market + s.code);
        rets.push(f.slice(1).map((v, t) => v / f[t] - 1));
      }
      const resid = residualize(rets);
      const n = usable2.length;
      const corr = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const c = pearson(resid[i], resid[j]);
          corr[i][j] = c;
          corr[j][i] = c;
        }
      }
      let offSum = 0, offN = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        offSum += Math.abs(corr[i][j]);
        offN++;
      }
      const meanAbs = offN ? offSum / offN : 0;
      const comps = clusterComponents(corr, mcorr);
      const clusters = [];
      const membersIn = /* @__PURE__ */ new Set();
      comps.forEach((mem, idx) => {
        const sub = mem.map((i) => mem.map((j) => corr[i][j]));
        const pairs = [];
        for (let a = 0; a < mem.length; a++) for (let b = a + 1; b < mem.length; b++) pairs.push(sub[a][b]);
        const total = pairs.length;
        const strong = pairs.filter((c) => c >= mcorr).length;
        const intra = total ? pairs.reduce((x, y) => x + y, 0) / total : 0;
        for (const i of mem) membersIn.add(i);
        const weak = total === 0 || intra < mcorr * 0.7 && (total ? strong / total : 0) < 0.5;
        clusters.push({
          class_id: idx + 1,
          size: mem.length,
          mean_intra_corr: Math.round(intra * 1e4) / 1e4,
          strong_pairs: strong,
          total_pairs: total,
          strong_density: total ? Math.round(strong / total * 1e3) / 1e3 : 0,
          weak_chain: weak,
          members: mem.map((i) => ({
            market: usable2[i].market,
            code: usable2[i].code,
            name: usable2[i].name,
            chg_pct: usable2[i].chg_pct,
            mean_corr_to_class: mem.length > 1 ? Math.round(mem.reduce((s, j) => s + (j === i ? 0 : corr[i][j]), 0) / (mem.length - 1) * 1e3) / 1e3 : null
          }))
        });
      });
      const isolated = usable2.filter((_, i) => !membersIn.has(i));
      this._snapKey = key;
      this._snap = {
        as_of: keep2[keep2.length - 1],
        window: win,
        beg,
        end,
        graph_used: "threshold",
        nfac_used: 0,
        min_corr: mcorr,
        pool_size: stocks.length,
        usable: usable2,
        corr,
        clusters,
        isolated,
        failed,
        meta: {
          as_of: keep2[keep2.length - 1],
          window: win,
          graph: "threshold",
          nfac: 0,
          min_corr: mcorr,
          pool_n: pn,
          usable_n: usable2.length,
          mean_abs_corr_pool: Math.round(meanAbs * 1e4) / 1e4,
          n_classes: clusters.length,
          n_isolated: isolated.length,
          failed: failed.slice(0, 6).map(([c]) => c),
          elapsed_s: Math.round((Date.now() / 1e3 - t0) * 10) / 10,
          numpy: false,
          scipy: false
        }
      };
      this._builtAt = Date.now() / 1e3;
      this._log(`[hist_concept] rebuilt as_of=${this._snap.as_of} usable=${usable2.length} classes=${clusters.length} iso=${isolated.length} graph=threshold`);
      return { ok: true, cached: false, meta: this._snap.meta };
    })();
  }
  rebuild(asOf, refresh = false, window, minCorr, poolN, extra) {
    return this._mutex.run(() => this._rebuildCore(asOf, refresh, window, minCorr, poolN, extra));
  }
  _lookup(market, code, snap) {
    const s = snap || this._snap || { usable: [], corr: [] };
    const usable = s.usable || [];
    const corr = s.corr || [];
    const m = market.toUpperCase();
    for (let i = 0; i < usable.length; i++) {
      if (usable[i].market === m && usable[i].code === code) return { i, st: usable[i], usable, corr };
    }
    return { i: null, st: null, usable, corr };
  }
  async queryStock(market, code, topk = 8, asOf, refresh = false, window, minCorr, poolN, expand = true) {
    return this._mutex.run(async () => {
      let r = await this._rebuildCore(asOf, refresh, window, minCorr, poolN);
      if (!r.ok) return r;
      let s = this._snap;
      let { i, st, usable, corr } = this._lookup(market, code, s);
      if (st === null && expand) {
        const extra = [{ market: market.toUpperCase(), code: String(code) }];
        const r2 = await this._rebuildCore(asOf, true, window, minCorr, poolN, extra);
        if (r2.ok) {
          s = this._snap;
          ({ i, st, usable, corr } = this._lookup(market, code, s));
        }
      }
      if (st === null) {
        return {
          ok: false,
          in_pool: false,
          error: "\u8BE5\u7968\u65E0\u6CD5\u5E76\u5165\u81EA\u6316\u6C60\uFF08\u53EF\u80FD\u9000\u5E02/\u957F\u671F\u505C\u724C/\u5317\u4EA4\u6240/\u65E0 QFQ \u6570\u636E\uFF09",
          as_of: s.as_of ?? null,
          pool_n: (s.usable || []).length
        };
      }
      const myClass = (s.clusters || []).find((c) => (c.members || []).some((m) => m.market === st.market && m.code === st.code)) || null;
      const row = corr[i];
      const order = usable.map((_, j) => j).sort((a, b) => row[b] - row[a]);
      const peers = [];
      for (const j of order) {
        if (j === i) continue;
        if (peers.length >= topk) break;
        peers.push({
          market: usable[j].market,
          code: usable[j].code,
          name: usable[j].name,
          corr: Math.round(row[j] * 1e4) / 1e4,
          same_class: Boolean(myClass && (myClass.members || []).some((m) => usable[j].market === m.market && usable[j].code === m.code))
        });
      }
      return {
        ok: true,
        in_pool: true,
        stock: st,
        as_of: s.as_of,
        meta: s.meta,
        class: myClass && {
          class_id: myClass.class_id,
          size: myClass.size,
          mean_intra_corr: myClass.mean_intra_corr,
          strong_density: myClass.strong_density
        },
        peers
      };
    });
  }
  async classes(asOf, refresh = false, topMembers = 5, window, minCorr, poolN) {
    return this._mutex.run(async () => {
      const r = await this._rebuildCore(asOf, refresh, window, minCorr, poolN);
      if (!r.ok) return r;
      const s = this._snap;
      return {
        ok: true,
        as_of: s.as_of,
        meta: s.meta,
        n: s.clusters.length,
        classes: s.clusters.map((c) => ({
          class_id: c.class_id,
          size: c.size,
          mean_intra_corr: c.mean_intra_corr,
          strong_density: c.strong_density,
          weak_chain: c.weak_chain ?? false,
          top: (c.members || []).slice(0, topMembers).map((m) => m.name)
        })),
        isolated_n: s.isolated.length,
        isolated_top: s.isolated.slice(0, topMembers).map((m) => ({ market: m.market, code: m.code, name: m.name, chg_pct: m.chg_pct }))
      };
    });
  }
  async classMembers(classId, asOf, refresh = false, window, minCorr, poolN) {
    return this._mutex.run(async () => {
      const r = await this._rebuildCore(asOf, refresh, window, minCorr, poolN);
      if (!r.ok) return r;
      const s = this._snap;
      const c = s.clusters.find((x) => x.class_id === classId);
      if (!c) {
        return {
          ok: false,
          error: `class ${classId} \u4E0D\u5B58\u5728`,
          as_of: s.as_of,
          max_id: s.clusters.reduce((m, x) => Math.max(m, x.class_id), 0)
        };
      }
      return {
        ok: true,
        as_of: s.as_of,
        meta: s.meta,
        class: { class_id: c.class_id, size: c.size, mean_intra_corr: c.mean_intra_corr, strong_density: c.strong_density },
        members: c.members
      };
    });
  }
};
function todayIso2() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function isoAddDays(iso, days) {
  const d = /* @__PURE__ */ new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
async function selftest() {
  const rng = makeRng(7);
  const beg = "2025-12-13", asOf = "2026-09-09";
  const d0 = /* @__PURE__ */ new Date(beg + "T00:00:00Z");
  const d1 = /* @__PURE__ */ new Date(asOf + "T00:00:00Z");
  const days = Math.round((d1.getTime() - d0.getTime()) / 864e5) + 1;
  const fac = [0.9, 0.3, -0.5];
  const shared = [[], [], []];
  for (let n = 0; n < 3; n++) {
    let f = 0;
    for (let t = 0; t < days; t++) {
      f = 0.92 * f + gauss(rng) * Math.abs(fac[n]) * 6e-3;
      shared[n].push(f);
    }
  }
  const fakeFetch = async (_market, code, _beg, _asOf) => {
    const n = parseInt(code, 10) % 3;
    const out = [];
    let close = 20;
    let cur = new Date(d0);
    for (let t = 0; t < days; t++) {
      const r2 = shared[n][t] + gauss(rng) * 4e-3;
      close *= 1 + r2;
      out.push([cur.toISOString().slice(0, 10), close]);
      cur = new Date(cur.getTime() + 864e5);
    }
    return out;
  };
  const fakeA = async () => {
    const rows = [];
    for (let i = 1; i <= 45; i++) {
      rows.push({ market: i % 2, code: String(1e3 + i).padStart(6, "0"), name: `\u7968${i}`, amount: 1e9 - i * 1e6, pre_close: 20 });
    }
    return rows;
  };
  const eng = new HistEngine(fakeFetch, fakeA, { nfac: 0, window: 60, min_corr: 0.45 }, void 0, () => void 0);
  const r = await eng.rebuild("2026-09-09");
  if (!r.ok) throw new Error(`rebuild failed: ${JSON.stringify(r)}`);
  const q = await eng.queryStock("SH", "001001");
  if (!q.ok || !q.in_pool) throw new Error(`query failed: ${JSON.stringify(q)}`);
  const same = q.peers.filter((p) => p.same_class);
  console.log("[selftest] classes:", eng["_snap"]?.clusters.length, "isolated:", eng["_snap"]?.isolated.length);
  console.log("[selftest] query 001001 class:", JSON.stringify(q.class), "same-class peers:", same.length);
  if (!q.class || q.class.size < 10) throw new Error(`selftest assertion failed: class size < 10 (got ${JSON.stringify(q.class)})`);
  const myN = parseInt("001001", 10) % 3;
  const members = eng["_snap"]?.clusters.find((c) => c.class_id === q.class.class_id)?.members || [];
  if (!members.every((m) => parseInt(m.code, 10) % 3 === myN)) throw new Error("selftest assertion failed: class members not all in same block");
  console.log("[selftest] OK");
}
export {
  Adjust,
  BoardType,
  Category,
  ExBoardType,
  ExCategory,
  ExMarket,
  FieldBit,
  FieldSelection,
  FilterType,
  HistEngine,
  MacExtendedClient,
  MacStandardClient,
  Market,
  Period,
  PresetField,
  SortOrder,
  SortType,
  TdxClient,
  TdxError,
  TdxErrorCode,
  TdxStore,
  selftest as histSelftest,
  macExHosts,
  macHosts
};
//# sourceMappingURL=index.js.map
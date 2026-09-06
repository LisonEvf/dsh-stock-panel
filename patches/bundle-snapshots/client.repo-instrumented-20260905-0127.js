window.__ModuleLoader__.load({
  id: "@lisonevf/dsh-stock-panel",
  // patch-layout 版：client 半注册 `stock` / `stock.preview` 槽，
  // 由 scripts/patch-layout.mjs 注入到 ui-layout 主布局第四列。
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    //#region build output
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn$1, res) => function() {
	return fn$1 && (res = (0, fn$1[__getOwnPropNames(fn$1)[0]])(fn$1 = 0)), res;
};
var __export = (target, all) => {
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
};
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k$1) => from[k$1]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
const react = __toESM(require("react"));
const react_jsx_runtime = __toESM(require("react/jsx-runtime"));

(function(){
  if (window.__cpLog) return;
  window.__cpLog = true;
  if (typeof react !== 'undefined' && react.createElement) {
    var orig = react.createElement;
    react.createElement = function(type){
      if (type && typeof type === 'object' && !(type.typeof)) {
        console.error('[CP-HOOK] createElement object type:', type);
      }
      return orig.apply(this, arguments);
    };
  }
})();
(function(){
  if (window.__cpHook2) return;
  window.__cpHook2 = true;
  try {
    var rt = require('react/jsx-runtime');
    if (rt.jsx) {
      var oj = rt.jsx;
      rt.jsx = function(t){ if (t && typeof t==='object' && !t.typeof){ console.error('[CP-JSX] object type:', t);} return oj.apply(this,arguments); };
    }
    if (rt.jsxs) {
      var ojs = rt.jsxs;
      rt.jsxs = function(t){ if (t && typeof t==='object' && !t.typeof){ console.error('[CP-JSXs] object type:', t);} return ojs.apply(this,arguments); };
    }
  } catch(e){ console.error('[CP] hook2 err', e.message); }
})();
(function(){
  if (window.__cpTrace) return;
  window.__cpTrace = true;
  var origErr = console.error;
  console.error = function(){
    var args = Array.prototype.slice.call(arguments);
    for (var i=0;i<args.length;i++){
      if (typeof args[i]==='string' && args[i].indexOf('Minified React error #130')>-1){
        try { throw new Error('STACK for #130:'); } catch(e){ origErr.apply(console, ['=== #130 CAUGHT ===', e.stack]); }
      }
    }
    return origErr.apply(console, arguments);
  };
})();
(function(){
  if (window.__cpErr) return;
  window.__cpErr = true;
  function tap(name){
    window[name] = function(ev){
      var msg = (ev && ev.message) || '';
      if (typeof msg === 'string' && msg.indexOf('Minified React error #130') > -1){
        try { throw new Error('#130 caught via '+name); } catch(e){ window.__cp130Stack = e.stack; console.error('=== #130 via '+name+' ===', e.stack); }
      }
      return window[''+name].apply(this, arguments);
    };
    window[''+name] = window[name];
  }
  tap('onerror');
  window.addEventListener('error', function(ev){
    var msg = (ev.error && ev.error.message) || (ev.message) || '';
    if (typeof msg === 'string' && msg.indexOf('Minified React error #130') > -1){
      try { throw new Error('#130 caught via error event'); } catch(e){ console.error('=== #130 via error event ===', e.stack); }
    }
  });
})();
(function(){
  if (window.__cpInstrument) return;
  window.__cpInstrument = true;
  try {
    var rjr = require('react/jsx-runtime');
    if (rjr.jsx) {
      var _jsx = rjr.jsx;
      rjr.jsx = function(type){ if (type && typeof type==='object' && !type.typeof){ console.error('[CP-JSX-OBJ] jsx object type:', type); } return _jsx.apply(this, arguments); };
    }
    if (rjr.jsxs) {
      var _jsxs = rjr.jsxs;
      rjr.jsxs = function(type){ if (type && typeof type==='object' && !type.typeof){ console.error('[CP-JSXs-OBJ] jsxs object type:', type); } return _jsxs.apply(this, arguments); };
    }
    var react = require('react');
    if (react.createElement) {
      var _ce = react.createElement;
      react.createElement = function(type){ if (type && typeof type==='object' && !type.typeof){ console.error('[CP-CE-OBJ] createElement object type:', type); } return _ce.apply(this, arguments); };
    }
  } catch(e){ console.error('[CP] instrument err', e); }
})();
(function(){
  if (window.__cpPatched) return;
  window.__cpPatched = true;
  try {
    if (typeof react !== 'undefined') {
      var _ce = react.createElement;
      react.createElement = function(type){ if (type && typeof type==='object' && !type.typeof){ console.error('[CP-CE-OBJ] createElement object type:', type); } return _ce.apply(this, arguments); };
    }
    if (typeof react_jsx_runtime !== 'undefined') {
      if (react_jsx_runtime.jsx) {
        var _jsx = react_jsx_runtime.jsx;
        react_jsx_runtime.jsx = function(type){ if (type && typeof type==='object' && !type.typeof){ console.error('[CP-JSX-OBJ] jsx object type:', type); } return _jsx.apply(this, arguments); };
      }
      if (react_jsx_runtime.jsxs) {
        var _jsxs = react_jsx_runtime.jsxs;
        react_jsx_runtime.jsxs = function(type){ if (type && typeof type==='object' && !type.typeof){ console.error('[CP-JSXs-OBJ] jsxs object type:', type); } return _jsxs.apply(this, arguments); };
      }
    }
  } catch(e){ console.error('[CP] patch err', e); }
})();
//#region src/lib/mcp.ts
/** 可通过全局变量 __DSH_MCP_ENDPOINT__ 覆盖远端 MCP 服务器地址（仅用于日志）。 */
function getMcpEndpoint() {
	if (typeof window !== "undefined" && window.__DSH_MCP_ENDPOINT__) return window.__DSH_MCP_ENDPOINT__;
	return "http://192.168.31.196:8007/mcp";
}
function getMcp() {
	if (!client) client = new McpClient();
	return client;
}
var BRIDGE_ROUTE, McpClient, client;
var init_mcp = __esm({ "src/lib/mcp.ts"() {
	BRIDGE_ROUTE = "/api/stock-panel/mcp";
	McpClient = class {
		endpoint;
		sessionId = null;
		initialized = false;
		constructor(endpoint) {
			this.endpoint = endpoint ?? getMcpEndpoint();
		}
		/** 初始化会话。 */
		async initialize() {
			const resp = await this.rawCall({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2024-11-05",
					capabilities: {},
					clientInfo: {
						name: "dsh-stock-panel",
						version: "1.0"
					}
				}
			});
			const headers = resp.headers;
			this.sessionId = headers["mcp-session-id"] ?? null;
			await this.rawCall({
				jsonrpc: "2.0",
				method: "notifications/initialized"
			});
			this.initialized = true;
		}
		/** 列出工具。 */
		async listTools() {
			if (!this.initialized) await this.initialize();
			const resp = await this.rawCall({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/list",
				params: {}
			});
			const data = await resp.json().catch(() => ({ result: {} }));
			return data.result?.tools ?? [];
		}
		/** 调用工具。 */
		async callTool(name, args = {}) {
			if (!this.initialized) await this.initialize();
			const resp = await this.rawCall({
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: {
					name,
					arguments: args
				}
			});
			const data = await resp.json().catch(() => ({ result: {} }));
			return data.result;
		}
		/** 原始 JSON-RPC 请求，返回 Response（供 SSE 解析）。走 host 半桥接路由。 */
		async rawCall(payload) {
			const headers = {
				"Content-Type": "application/json",
				Accept: "application/json, text/event-stream"
			};
			if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
			const resp = await fetch(BRIDGE_ROUTE, {
				method: "POST",
				headers,
				body: JSON.stringify({
					...payload,
					sessionId: this.sessionId
				})
			});
			if (!resp.ok) throw new Error(`MCP request failed: ${resp.status} ${resp.statusText}`);
			return resp;
		}
	};
	client = null;
} });

//#endregion
//#region src/lib/stock-data.ts
/** 从 MCP 工具结果中提取文本 JSON。 */
function extractText(result) {
	const text = result.content?.filter((c$1) => c$1.type === "text" && c$1.text).map((c$1) => c$1.text).join("\n")?.trim();
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
/** 调用 quote 工具。 */
async function fetchQuote(market, code) {
	const client$1 = getMcp();
	const result = await client$1.callTool("quote", {
		market,
		code
	});
	const data = extractText(result);
	if (!data) throw new Error("quote 工具返回空");
	return {
		code: data.code ?? code,
		name: data.name,
		close: data.close ?? data.price,
		preClose: data.pre_close ?? data.preClose,
		open: data.open,
		high: data.high,
		low: data.low,
		vol: data.vol ?? data.volume,
		amount: data.amount,
		...data
	};
}
/** 调用 kline 工具。 */
async function fetchKline(market, code, period = "DAILY", count = 10) {
	const client$1 = getMcp();
	const result = await client$1.callTool("kline", {
		market,
		code,
		period,
		count
	});
	const data = extractText(result);
	if (!data) throw new Error("kline 工具返回空");
	const rows = Array.isArray(data) ? data : data.rows ?? data.data ?? [];
	return rows.map((r$1) => ({
		datetime: r$1.datetime,
		open: Number(r$1.open),
		high: Number(r$1.high),
		low: Number(r$1.low),
		close: Number(r$1.close),
		volume: Number(r$1.volume ?? r$1.vol ?? 0),
		amount: Number(r$1.amount ?? 0)
	}));
}
var init_stock_data = __esm({ "src/lib/stock-data.ts"() {
	init_mcp();
} });

//#endregion
//#region src/lib/api.ts
async function request(path, init) {
	const isFormData = init?.body instanceof FormData;
	const headers = new Headers(init?.headers);
	if (!isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
	const res = await fetch(`${BASE}${path}`, {
		...init,
		headers
	});
	if (!res.ok) {
		let detail = "";
		try {
			const j$1 = JSON.parse(await res.text());
			detail = j$1.detail ?? j$1.message ?? "";
		} catch {}
		const msg = detail || `${res.status} ${res.statusText}`;
		throw new Error(msg);
	}
	return res.json();
}
/**
* 解析 symbol 为 { market, code }。
* 支持格式："SH000001" / "SZ000001" / "000001" / "sh000001"。
* 默认 SH（上交所）。
*/
function parseSymbol(symbol) {
	const s = symbol.trim().toUpperCase();
	const m$1 = s.match(/^(SH|SZ|BJ)(\d{6})$/);
	if (m$1) return {
		market: m$1[1],
		code: m$1[2]
	};
	if (/^\d{6}$/.test(s)) return {
		market: "SH",
		code: s
	};
	const digits = s.replace(/[^0-9]/g, "");
	return {
		market: "SH",
		code: digits.slice(-6)
	};
}
var dataSource, BASE, api;
var init_api = __esm({ "src/lib/api.ts"() {
	init_stock_data();
	dataSource = typeof globalThis !== "undefined" && globalThis.__DSH_DATA_SOURCE__ || "mcp";
	BASE = typeof globalThis !== "undefined" && globalThis.__VITE_API_BASE__ || "";
	api = {
		klineDaily: async (symbol, days = 120, dateRange, extColumns) => {
			if (dataSource === "mcp") try {
				const { market, code } = parseSymbol(symbol);
				const mcpRows = await fetchKline(market, code, "DAILY", Math.min(days, 1e3));
				const rows = mcpRows.map((r$1) => ({
					symbol: code,
					date: r$1.datetime,
					open: r$1.open,
					high: r$1.high,
					low: r$1.low,
					close: r$1.close,
					volume: r$1.volume,
					amount: r$1.amount
				}));
				return {
					symbol: code,
					rows,
					source: "mcp"
				};
			} catch (err) {
				console.warn("[api] MCP klineDaily 失败，回退到 HTTP:", err);
				dataSource = "http";
			}
			return request((dateRange ? `/api/kline/daily?symbol=${encodeURIComponent(symbol)}&start_date=${dateRange.start}&end_date=${dateRange.end}` : `/api/kline/daily?symbol=${encodeURIComponent(symbol)}&days=${days}`) + (extColumns ? `&ext_columns=${encodeURIComponent(extColumns)}` : ""));
		},
		klineMinute: (symbol, date) => request(`/api/kline/minute?symbol=${encodeURIComponent(symbol)}${date ? `&date=${date}` : ""}`),
		klineDailyBatch: (symbols, days = 12) => request("/api/kline/daily-batch", {
			method: "POST",
			body: JSON.stringify({
				symbols,
				days
			})
		}),
		instrumentSearch: (q$1, limit = 20) => request(`/api/kline/instruments/search?q=${encodeURIComponent(q$1)}&limit=${limit}`),
		stockAnalysisReportsList: () => request("/api/stock-analysis/reports"),
		stockAnalysisReportDelete: (reportId) => request(`/api/stock-analysis/reports/${encodeURIComponent(reportId)}`, { method: "DELETE" }),
		async *stockAnalyzeStream(symbol, focus) {
			const res = await fetch("/api/stock-analysis/analyze", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					symbol,
					focus: focus ?? ""
				})
			});
			if (!res.ok) {
				let detail = "";
				try {
					const j$1 = JSON.parse(await res.text());
					detail = j$1.detail ?? j$1.message ?? "";
				} catch {}
				const msg = detail || `${res.status} ${res.statusText}`;
				throw new Error(msg);
			}
			if (!res.body) throw new Error("响应无 body");
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = "";
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += decoder.decode(value, { stream: true });
				const lines = buf.split("\n");
				buf = lines.pop() ?? "";
				for (const line of lines) {
					const s = line.trim();
					if (!s) continue;
					try {
						yield JSON.parse(s);
					} catch {}
				}
			}
			if (buf.trim()) try {
				yield JSON.parse(buf.trim());
			} catch {}
		},
		stockAnalysisLevels: (symbol, days = 120) => request(`/api/stock-analysis/levels?symbol=${encodeURIComponent(symbol)}&days=${days}`),
		watchlistList: () => request("/api/watchlist"),
		watchlistAdd: (symbol, note = "") => request("/api/watchlist", {
			method: "POST",
			body: JSON.stringify({
				symbol,
				note
			})
		}),
		watchlistRemove: (symbol) => request(`/api/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" }),
		watchlistClear: () => request("/api/watchlist", { method: "DELETE" }),
		quote: (symbol) => {
			if (dataSource === "mcp") {
				const { market, code } = parseSymbol(symbol);
				return fetchQuote(market, code);
			}
			return request(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
		}
	};
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/shared/src/utils.js
var toKebabCase, mergeClasses;
var init_utils = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/shared/src/utils.js"() {
	toKebabCase = (string) => string.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
	mergeClasses = (...classes) => classes.filter((className, index, array) => {
		return Boolean(className) && array.indexOf(className) === index;
	}).join(" ");
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/defaultAttributes.js
var defaultAttributes;
var init_defaultAttributes = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/defaultAttributes.js"() {
	defaultAttributes = {
		xmlns: "http://www.w3.org/2000/svg",
		width: 24,
		height: 24,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 2,
		strokeLinecap: "round",
		strokeLinejoin: "round"
	};
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/Icon.js
var Icon;
var init_Icon = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/Icon.js"() {
	init_defaultAttributes();
	init_utils();
	Icon = (0, react.forwardRef)(({ color = "currentColor", size: size$1 = 24, strokeWidth = 2, absoluteStrokeWidth, className = "", children, iconNode,...rest }, ref) => {
		return (0, react.createElement)("svg", {
			ref,
			...defaultAttributes,
			width: size$1,
			height: size$1,
			stroke: color,
			strokeWidth: absoluteStrokeWidth ? Number(strokeWidth) * 24 / Number(size$1) : strokeWidth,
			className: mergeClasses("lucide", className),
			...rest
		}, [...iconNode.map(([tag, attrs]) => (0, react.createElement)(tag, attrs)), ...Array.isArray(children) ? children : [children]]);
	});
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/createLucideIcon.js
var createLucideIcon;
var init_createLucideIcon = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/createLucideIcon.js"() {
	init_utils();
	init_Icon();
	createLucideIcon = (iconName, iconNode) => {
		const Component = (0, react.forwardRef)(({ className,...props }, ref) => (0, react.createElement)(Icon, {
			ref,
			iconNode,
			className: mergeClasses(`lucide-${toKebabCase(iconName)}`, className),
			...props
		}));
		Component.displayName = `${iconName}`;
		return Component;
	};
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/chevron-right.js
var ChevronRight;
var init_chevron_right = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/chevron-right.js"() {
	init_createLucideIcon();
	ChevronRight = createLucideIcon("ChevronRight", [["path", {
		d: "m9 18 6-6-6-6",
		key: "mthhwq"
	}]]);
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/circle-alert.js
var CircleAlert;
var init_circle_alert = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/circle-alert.js"() {
	init_createLucideIcon();
	CircleAlert = createLucideIcon("CircleAlert", [
		["circle", {
			cx: "12",
			cy: "12",
			r: "10",
			key: "1mglay"
		}],
		["line", {
			x1: "12",
			x2: "12",
			y1: "8",
			y2: "12",
			key: "1pkeuh"
		}],
		["line", {
			x1: "12",
			x2: "12.01",
			y1: "16",
			y2: "16",
			key: "4dfq90"
		}]
	]);
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/loader-circle.js
var LoaderCircle;
var init_loader_circle = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/loader-circle.js"() {
	init_createLucideIcon();
	LoaderCircle = createLucideIcon("LoaderCircle", [["path", {
		d: "M21 12a9 9 0 1 1-6.219-8.56",
		key: "13zald"
	}]]);
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/radio-tower.js
var RadioTower;
var init_radio_tower = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/radio-tower.js"() {
	init_createLucideIcon();
	RadioTower = createLucideIcon("RadioTower", [
		["path", {
			d: "M4.9 16.1C1 12.2 1 5.8 4.9 1.9",
			key: "s0qx1y"
		}],
		["path", {
			d: "M7.8 4.7a6.14 6.14 0 0 0-.8 7.5",
			key: "1idnkw"
		}],
		["circle", {
			cx: "12",
			cy: "9",
			r: "2",
			key: "1092wv"
		}],
		["path", {
			d: "M16.2 4.8c2 2 2.26 5.11.8 7.47",
			key: "ojru2q"
		}],
		["path", {
			d: "M19.1 1.9a9.96 9.96 0 0 1 0 14.1",
			key: "rhi7fg"
		}],
		["path", {
			d: "M9.5 18h5",
			key: "mfy3pd"
		}],
		["path", {
			d: "m8 22 4-11 4 11",
			key: "25yftu"
		}]
	]);
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/search.js
var Search;
var init_search = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/search.js"() {
	init_createLucideIcon();
	Search = createLucideIcon("Search", [["circle", {
		cx: "11",
		cy: "11",
		r: "8",
		key: "4ej97u"
	}], ["path", {
		d: "m21 21-4.3-4.3",
		key: "1qie3q"
	}]]);
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/settings-2.js
var Settings2;
var init_settings_2 = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/settings-2.js"() {
	init_createLucideIcon();
	Settings2 = createLucideIcon("Settings2", [
		["path", {
			d: "M20 7h-9",
			key: "3s1dr2"
		}],
		["path", {
			d: "M14 17H5",
			key: "gfn3mx"
		}],
		["circle", {
			cx: "17",
			cy: "17",
			r: "3",
			key: "18b49y"
		}],
		["circle", {
			cx: "7",
			cy: "7",
			r: "3",
			key: "dfmy0x"
		}]
	]);
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/sparkles.js
var Sparkles;
var init_sparkles = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/sparkles.js"() {
	init_createLucideIcon();
	Sparkles = createLucideIcon("Sparkles", [
		["path", {
			d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
			key: "4pj2yx"
		}],
		["path", {
			d: "M20 3v4",
			key: "1olli1"
		}],
		["path", {
			d: "M22 5h-4",
			key: "1gvqau"
		}],
		["path", {
			d: "M4 17v2",
			key: "vumght"
		}],
		["path", {
			d: "M5 18H3",
			key: "zchphs"
		}]
	]);
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/star.js
var Star;
var init_star = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/star.js"() {
	init_createLucideIcon();
	Star = createLucideIcon("Star", [["polygon", {
		points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2",
		key: "8f66p6"
	}]]);
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/trash-2.js
var Trash2;
var init_trash_2 = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/trash-2.js"() {
	init_createLucideIcon();
	Trash2 = createLucideIcon("Trash2", [
		["path", {
			d: "M3 6h18",
			key: "d0wm0j"
		}],
		["path", {
			d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",
			key: "4alrt4"
		}],
		["path", {
			d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
			key: "v07s0e"
		}],
		["line", {
			x1: "10",
			x2: "10",
			y1: "11",
			y2: "17",
			key: "1uufr5"
		}],
		["line", {
			x1: "14",
			x2: "14",
			y1: "11",
			y2: "17",
			key: "xtxkd"
		}]
	]);
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/x.js
var X$1;
var init_x = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/icons/x.js"() {
	init_createLucideIcon();
	X$1 = createLucideIcon("X", [["path", {
		d: "M18 6 6 18",
		key: "1bl5f8"
	}], ["path", {
		d: "m6 6 12 12",
		key: "d8bk6v"
	}]]);
} });

//#endregion
//#region node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/lucide-react.js
var init_lucide_react = __esm({ "node_modules/.pnpm/lucide-react@0.439.0_react@18.3.1/node_modules/lucide-react/dist/esm/lucide-react.js"() {
	init_chevron_right();
	init_radio_tower();
	init_search();
	init_settings_2();
	init_star();
	init_trash_2();
	init_x();
	init_circle_alert();
	init_loader_circle();
	init_sparkles();
} });

//#endregion
//#region src/components/InstrumentSearch.tsx
/** 标的搜索下拉：输入关键字 → 后端搜索 → 点击选中 */
function InstrumentSearch({ onSelect, initialSymbol }) {
	const [query, setQuery] = (0, react.useState)(initialSymbol ?? "");
	const [results, setResults] = (0, react.useState)([]);
	const [open, setOpen] = (0, react.useState)(false);
	const [loading, setLoading] = (0, react.useState)(false);
	const containerRef = (0, react.useRef)(null);
	(0, react.useEffect)(() => {
		const handleClick = (e$1) => {
			if (containerRef.current && !containerRef.current.contains(e$1.target)) setOpen(false);
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, []);
	(0, react.useEffect)(() => {
		const q$1 = query.trim();
		if (q$1.length < 1) {
			setResults([]);
			setOpen(false);
			return;
		}
		setLoading(true);
		const timer = setTimeout(async () => {
			try {
				const res = await api.instrumentSearch(q$1, 10);
				setResults(res.results);
				setOpen(true);
			} catch {
				setResults([]);
			} finally {
				setLoading(false);
			}
		}, 300);
		return () => clearTimeout(timer);
	}, [query]);
	const handleSelect = (symbol) => {
		onSelect(symbol);
		setOpen(false);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		ref: containerRef,
		className: "relative w-48",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "relative",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Search, { className: "pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					value: query,
					onChange: (e$1) => setQuery(e$1.target.value),
					onFocus: () => results.length > 0 && setOpen(true),
					className: "w-full rounded-md border border-slate-300 py-1 pl-8 pr-8 text-sm font-mono focus:border-emerald-500 focus:outline-none",
					placeholder: "搜索代码/名称",
					autoComplete: "off"
				}),
				query && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					onClick: () => {
						setQuery("");
						setResults([]);
						setOpen(false);
					},
					className: "absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(X$1, { className: "h-3.5 w-3.5" })
				})
			]
		}), open && (results.length > 0 || loading) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg",
			children: loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "px-3 py-2 text-xs text-slate-400",
				children: "搜索中…"
			}) : results.map((r$1, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				onClick: () => handleSelect(r$1.symbol),
				className: "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-emerald-50",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "font-mono text-slate-700",
					children: r$1.symbol
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "text-slate-500",
					children: r$1.name || r$1.code
				})]
			}, i))
		})]
	});
}
var init_InstrumentSearch = __esm({ "src/components/InstrumentSearch.tsx"() {
	init_lucide_react();
	init_api();
} });

//#endregion
//#region node_modules/.pnpm/fancy-canvas@2.1.0/node_modules/fancy-canvas/size.mjs
function size(_a) {
	var width = _a.width, height = _a.height;
	if (width < 0) throw new Error("Negative width is not allowed for Size");
	if (height < 0) throw new Error("Negative height is not allowed for Size");
	return {
		width,
		height
	};
}
function equalSizes(first, second) {
	return first.width === second.width && first.height === second.height;
}
var init_size = __esm({ "node_modules/.pnpm/fancy-canvas@2.1.0/node_modules/fancy-canvas/size.mjs"() {} });

//#endregion
//#region node_modules/.pnpm/fancy-canvas@2.1.0/node_modules/fancy-canvas/device-pixel-ratio.mjs
function createObservable(win) {
	return new Observable(win);
}
var Observable;
var init_device_pixel_ratio = __esm({ "node_modules/.pnpm/fancy-canvas@2.1.0/node_modules/fancy-canvas/device-pixel-ratio.mjs"() {
	Observable = function() {
		function Observable$1(win) {
			var _this = this;
			this._resolutionListener = function() {
				return _this._onResolutionChanged();
			};
			this._resolutionMediaQueryList = null;
			this._observers = [];
			this._window = win;
			this._installResolutionListener();
		}
		Observable$1.prototype.dispose = function() {
			this._uninstallResolutionListener();
			this._window = null;
		};
		Object.defineProperty(Observable$1.prototype, "value", {
			get: function() {
				return this._window.devicePixelRatio;
			},
			enumerable: false,
			configurable: true
		});
		Observable$1.prototype.subscribe = function(next) {
			var _this = this;
			var observer = { next };
			this._observers.push(observer);
			return { unsubscribe: function() {
				_this._observers = _this._observers.filter(function(o$1) {
					return o$1 !== observer;
				});
			} };
		};
		Observable$1.prototype._installResolutionListener = function() {
			if (this._resolutionMediaQueryList !== null) throw new Error("Resolution listener is already installed");
			var dppx = this._window.devicePixelRatio;
			this._resolutionMediaQueryList = this._window.matchMedia("all and (resolution: ".concat(dppx, "dppx)"));
			this._resolutionMediaQueryList.addListener(this._resolutionListener);
		};
		Observable$1.prototype._uninstallResolutionListener = function() {
			if (this._resolutionMediaQueryList !== null) {
				this._resolutionMediaQueryList.removeListener(this._resolutionListener);
				this._resolutionMediaQueryList = null;
			}
		};
		Observable$1.prototype._reinstallResolutionListener = function() {
			this._uninstallResolutionListener();
			this._installResolutionListener();
		};
		Observable$1.prototype._onResolutionChanged = function() {
			var _this = this;
			this._observers.forEach(function(observer) {
				return observer.next(_this._window.devicePixelRatio);
			});
			this._reinstallResolutionListener();
		};
		return Observable$1;
	}();
} });

//#endregion
//#region node_modules/.pnpm/fancy-canvas@2.1.0/node_modules/fancy-canvas/canvas-element-bitmap-size.mjs
function bindTo(canvasElement, target) {
	if (target.type === "device-pixel-content-box") return new DevicePixelContentBoxBinding(canvasElement, target.transform, target.options);
	throw new Error("Unsupported binding target");
}
function canvasElementWindow(canvasElement) {
	return canvasElement.ownerDocument.defaultView;
}
function isDevicePixelContentBoxSupported() {
	return new Promise(function(resolve) {
		var ro = new ResizeObserver(function(entries) {
			resolve(entries.every(function(entry) {
				return "devicePixelContentBoxSize" in entry;
			}));
			ro.disconnect();
		});
		ro.observe(document.body, { box: "device-pixel-content-box" });
	}).catch(function() {
		return false;
	});
}
function predictedBitmapSize(canvasRect, ratio) {
	return size({
		width: Math.round(canvasRect.left * ratio + canvasRect.width * ratio) - Math.round(canvasRect.left * ratio),
		height: Math.round(canvasRect.top * ratio + canvasRect.height * ratio) - Math.round(canvasRect.top * ratio)
	});
}
var DevicePixelContentBoxBinding;
var init_canvas_element_bitmap_size = __esm({ "node_modules/.pnpm/fancy-canvas@2.1.0/node_modules/fancy-canvas/canvas-element-bitmap-size.mjs"() {
	init_size();
	init_device_pixel_ratio();
	DevicePixelContentBoxBinding = function() {
		function DevicePixelContentBoxBinding$1(canvasElement, transformBitmapSize, options) {
			var _a;
			this._canvasElement = null;
			this._bitmapSizeChangedListeners = [];
			this._suggestedBitmapSize = null;
			this._suggestedBitmapSizeChangedListeners = [];
			this._devicePixelRatioObservable = null;
			this._canvasElementResizeObserver = null;
			this._canvasElement = canvasElement;
			this._canvasElementClientSize = size({
				width: this._canvasElement.clientWidth,
				height: this._canvasElement.clientHeight
			});
			this._transformBitmapSize = transformBitmapSize !== null && transformBitmapSize !== void 0 ? transformBitmapSize : function(size$1) {
				return size$1;
			};
			this._allowResizeObserver = (_a = options === null || options === void 0 ? void 0 : options.allowResizeObserver) !== null && _a !== void 0 ? _a : true;
			this._chooseAndInitObserver();
		}
		DevicePixelContentBoxBinding$1.prototype.dispose = function() {
			var _a, _b;
			if (this._canvasElement === null) throw new Error("Object is disposed");
			(_a = this._canvasElementResizeObserver) === null || _a === void 0 || _a.disconnect();
			this._canvasElementResizeObserver = null;
			(_b = this._devicePixelRatioObservable) === null || _b === void 0 || _b.dispose();
			this._devicePixelRatioObservable = null;
			this._suggestedBitmapSizeChangedListeners.length = 0;
			this._bitmapSizeChangedListeners.length = 0;
			this._canvasElement = null;
		};
		Object.defineProperty(DevicePixelContentBoxBinding$1.prototype, "canvasElement", {
			get: function() {
				if (this._canvasElement === null) throw new Error("Object is disposed");
				return this._canvasElement;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(DevicePixelContentBoxBinding$1.prototype, "canvasElementClientSize", {
			get: function() {
				return this._canvasElementClientSize;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(DevicePixelContentBoxBinding$1.prototype, "bitmapSize", {
			get: function() {
				return size({
					width: this.canvasElement.width,
					height: this.canvasElement.height
				});
			},
			enumerable: false,
			configurable: true
		});
		/**
		* Use this function to change canvas element client size until binding is disposed
		* @param clientSize New client size for bound HTMLCanvasElement
		*/
		DevicePixelContentBoxBinding$1.prototype.resizeCanvasElement = function(clientSize) {
			this._canvasElementClientSize = size(clientSize);
			this.canvasElement.style.width = "".concat(this._canvasElementClientSize.width, "px");
			this.canvasElement.style.height = "".concat(this._canvasElementClientSize.height, "px");
			this._invalidateBitmapSize();
		};
		DevicePixelContentBoxBinding$1.prototype.subscribeBitmapSizeChanged = function(listener) {
			this._bitmapSizeChangedListeners.push(listener);
		};
		DevicePixelContentBoxBinding$1.prototype.unsubscribeBitmapSizeChanged = function(listener) {
			this._bitmapSizeChangedListeners = this._bitmapSizeChangedListeners.filter(function(l$1) {
				return l$1 !== listener;
			});
		};
		Object.defineProperty(DevicePixelContentBoxBinding$1.prototype, "suggestedBitmapSize", {
			get: function() {
				return this._suggestedBitmapSize;
			},
			enumerable: false,
			configurable: true
		});
		DevicePixelContentBoxBinding$1.prototype.subscribeSuggestedBitmapSizeChanged = function(listener) {
			this._suggestedBitmapSizeChangedListeners.push(listener);
		};
		DevicePixelContentBoxBinding$1.prototype.unsubscribeSuggestedBitmapSizeChanged = function(listener) {
			this._suggestedBitmapSizeChangedListeners = this._suggestedBitmapSizeChangedListeners.filter(function(l$1) {
				return l$1 !== listener;
			});
		};
		DevicePixelContentBoxBinding$1.prototype.applySuggestedBitmapSize = function() {
			if (this._suggestedBitmapSize === null) return;
			var oldSuggestedSize = this._suggestedBitmapSize;
			this._suggestedBitmapSize = null;
			this._resizeBitmap(oldSuggestedSize);
			this._emitSuggestedBitmapSizeChanged(oldSuggestedSize, this._suggestedBitmapSize);
		};
		DevicePixelContentBoxBinding$1.prototype._resizeBitmap = function(newSize) {
			var oldSize = this.bitmapSize;
			if (equalSizes(oldSize, newSize)) return;
			this.canvasElement.width = newSize.width;
			this.canvasElement.height = newSize.height;
			this._emitBitmapSizeChanged(oldSize, newSize);
		};
		DevicePixelContentBoxBinding$1.prototype._emitBitmapSizeChanged = function(oldSize, newSize) {
			var _this = this;
			this._bitmapSizeChangedListeners.forEach(function(listener) {
				return listener.call(_this, oldSize, newSize);
			});
		};
		DevicePixelContentBoxBinding$1.prototype._suggestNewBitmapSize = function(newSize) {
			var oldSuggestedSize = this._suggestedBitmapSize;
			var finalNewSize = size(this._transformBitmapSize(newSize, this._canvasElementClientSize));
			var newSuggestedSize = equalSizes(this.bitmapSize, finalNewSize) ? null : finalNewSize;
			if (oldSuggestedSize === null && newSuggestedSize === null) return;
			if (oldSuggestedSize !== null && newSuggestedSize !== null && equalSizes(oldSuggestedSize, newSuggestedSize)) return;
			this._suggestedBitmapSize = newSuggestedSize;
			this._emitSuggestedBitmapSizeChanged(oldSuggestedSize, newSuggestedSize);
		};
		DevicePixelContentBoxBinding$1.prototype._emitSuggestedBitmapSizeChanged = function(oldSize, newSize) {
			var _this = this;
			this._suggestedBitmapSizeChangedListeners.forEach(function(listener) {
				return listener.call(_this, oldSize, newSize);
			});
		};
		DevicePixelContentBoxBinding$1.prototype._chooseAndInitObserver = function() {
			var _this = this;
			if (!this._allowResizeObserver) {
				this._initDevicePixelRatioObservable();
				return;
			}
			isDevicePixelContentBoxSupported().then(function(isSupported) {
				return isSupported ? _this._initResizeObserver() : _this._initDevicePixelRatioObservable();
			});
		};
		DevicePixelContentBoxBinding$1.prototype._initDevicePixelRatioObservable = function() {
			var _this = this;
			if (this._canvasElement === null) return;
			var win = canvasElementWindow(this._canvasElement);
			if (win === null) throw new Error("No window is associated with the canvas");
			this._devicePixelRatioObservable = createObservable(win);
			this._devicePixelRatioObservable.subscribe(function() {
				return _this._invalidateBitmapSize();
			});
			this._invalidateBitmapSize();
		};
		DevicePixelContentBoxBinding$1.prototype._invalidateBitmapSize = function() {
			var _a, _b;
			if (this._canvasElement === null) return;
			var win = canvasElementWindow(this._canvasElement);
			if (win === null) return;
			var ratio = (_b = (_a = this._devicePixelRatioObservable) === null || _a === void 0 ? void 0 : _a.value) !== null && _b !== void 0 ? _b : win.devicePixelRatio;
			var canvasRects = this._canvasElement.getClientRects();
			var newSize = canvasRects[0] !== void 0 ? predictedBitmapSize(canvasRects[0], ratio) : size({
				width: this._canvasElementClientSize.width * ratio,
				height: this._canvasElementClientSize.height * ratio
			});
			this._suggestNewBitmapSize(newSize);
		};
		DevicePixelContentBoxBinding$1.prototype._initResizeObserver = function() {
			var _this = this;
			if (this._canvasElement === null) return;
			this._canvasElementResizeObserver = new ResizeObserver(function(entries) {
				var entry = entries.find(function(entry$1) {
					return entry$1.target === _this._canvasElement;
				});
				if (!entry || !entry.devicePixelContentBoxSize || !entry.devicePixelContentBoxSize[0]) return;
				var entrySize = entry.devicePixelContentBoxSize[0];
				var newSize = size({
					width: entrySize.inlineSize,
					height: entrySize.blockSize
				});
				_this._suggestNewBitmapSize(newSize);
			});
			this._canvasElementResizeObserver.observe(this._canvasElement, { box: "device-pixel-content-box" });
		};
		return DevicePixelContentBoxBinding$1;
	}();
} });

//#endregion
//#region node_modules/.pnpm/fancy-canvas@2.1.0/node_modules/fancy-canvas/canvas-rendering-target.mjs
/**
* @experimental
*/
function tryCreateCanvasRenderingTarget2D(binding, contextOptions) {
	var mediaSize = binding.canvasElementClientSize;
	if (mediaSize.width === 0 || mediaSize.height === 0) return null;
	var bitmapSize = binding.bitmapSize;
	if (bitmapSize.width === 0 || bitmapSize.height === 0) return null;
	var context = binding.canvasElement.getContext("2d", contextOptions);
	if (context === null) return null;
	return new CanvasRenderingTarget2D(context, mediaSize, bitmapSize);
}
var CanvasRenderingTarget2D;
var init_canvas_rendering_target = __esm({ "node_modules/.pnpm/fancy-canvas@2.1.0/node_modules/fancy-canvas/canvas-rendering-target.mjs"() {
	CanvasRenderingTarget2D = function() {
		function CanvasRenderingTarget2D$1(context, mediaSize, bitmapSize) {
			if (mediaSize.width === 0 || mediaSize.height === 0) throw new TypeError("Rendering target could only be created on a media with positive width and height");
			this._mediaSize = mediaSize;
			if (bitmapSize.width === 0 || bitmapSize.height === 0) throw new TypeError("Rendering target could only be created using a bitmap with positive integer width and height");
			this._bitmapSize = bitmapSize;
			this._context = context;
		}
		CanvasRenderingTarget2D$1.prototype.useMediaCoordinateSpace = function(f$1) {
			try {
				this._context.save();
				this._context.setTransform(1, 0, 0, 1, 0, 0);
				this._context.scale(this._horizontalPixelRatio, this._verticalPixelRatio);
				return f$1({
					context: this._context,
					mediaSize: this._mediaSize
				});
			} finally {
				this._context.restore();
			}
		};
		CanvasRenderingTarget2D$1.prototype.useBitmapCoordinateSpace = function(f$1) {
			try {
				this._context.save();
				this._context.setTransform(1, 0, 0, 1, 0, 0);
				return f$1({
					context: this._context,
					mediaSize: this._mediaSize,
					bitmapSize: this._bitmapSize,
					horizontalPixelRatio: this._horizontalPixelRatio,
					verticalPixelRatio: this._verticalPixelRatio
				});
			} finally {
				this._context.restore();
			}
		};
		Object.defineProperty(CanvasRenderingTarget2D$1.prototype, "_horizontalPixelRatio", {
			get: function() {
				return this._bitmapSize.width / this._mediaSize.width;
			},
			enumerable: false,
			configurable: true
		});
		Object.defineProperty(CanvasRenderingTarget2D$1.prototype, "_verticalPixelRatio", {
			get: function() {
				return this._bitmapSize.height / this._mediaSize.height;
			},
			enumerable: false,
			configurable: true
		});
		return CanvasRenderingTarget2D$1;
	}();
} });

//#endregion
//#region node_modules/.pnpm/fancy-canvas@2.1.0/node_modules/fancy-canvas/index.mjs
var init_fancy_canvas = __esm({ "node_modules/.pnpm/fancy-canvas@2.1.0/node_modules/fancy-canvas/index.mjs"() {
	init_size();
	init_canvas_element_bitmap_size();
	init_canvas_rendering_target();
} });

//#endregion
//#region node_modules/.pnpm/lightweight-charts@4.2.3/node_modules/lightweight-charts/dist/lightweight-charts.production.mjs
function f(t, i) {
	const n = {
		0: [],
		1: [t.lineWidth, t.lineWidth],
		2: [2 * t.lineWidth, 2 * t.lineWidth],
		3: [6 * t.lineWidth, 6 * t.lineWidth],
		4: [t.lineWidth, 4 * t.lineWidth]
	}[i];
	t.setLineDash(n);
}
function v(t, i, n, s) {
	t.beginPath();
	const e$1 = t.lineWidth % 2 ? .5 : 0;
	t.moveTo(n, i + e$1), t.lineTo(s, i + e$1), t.stroke();
}
function p(t, i) {
	if (!t) throw new Error("Assertion failed" + (i ? ": " + i : ""));
}
function m(t) {
	if (void 0 === t) throw new Error("Value is undefined");
	return t;
}
function b(t) {
	if (null === t) throw new Error("Value is null");
	return t;
}
function w(t) {
	return b(m(t));
}
function M(t) {
	return t < 0 ? 0 : t > 255 ? 255 : Math.round(t) || 0;
}
function x(t) {
	return t <= 0 || t > 1 ? Math.min(Math.max(t, 0), 1) : Math.round(1e4 * t) / 1e4;
}
function T(t) {
	(t = t.toLowerCase()) in g && (t = g[t]);
	{
		const i = C.exec(t) || y.exec(t);
		if (i) return [
			M(parseInt(i[1], 10)),
			M(parseInt(i[2], 10)),
			M(parseInt(i[3], 10)),
			x(i.length < 5 ? 1 : parseFloat(i[4]))
		];
	}
	{
		const i = k.exec(t);
		if (i) return [
			M(parseInt(i[1], 16)),
			M(parseInt(i[2], 16)),
			M(parseInt(i[3], 16)),
			1
		];
	}
	{
		const i = S.exec(t);
		if (i) return [
			M(17 * parseInt(i[1], 16)),
			M(17 * parseInt(i[2], 16)),
			M(17 * parseInt(i[3], 16)),
			1
		];
	}
	throw new Error(`Cannot parse color: ${t}`);
}
function P(t) {
	return .199 * t[0] + .687 * t[1] + .114 * t[2];
}
function R(t) {
	const i = T(t);
	return {
		t: `rgb(${i[0]}, ${i[1]}, ${i[2]})`,
		i: P(i) > 160 ? "black" : "white"
	};
}
function V(t, ...i) {
	for (const n of i) for (const i$1 in n) void 0 !== n[i$1] && Object.prototype.hasOwnProperty.call(n, i$1) && ![
		"__proto__",
		"constructor",
		"prototype"
	].includes(i$1) && ("object" != typeof n[i$1] || void 0 === t[i$1] || Array.isArray(n[i$1]) ? t[i$1] = n[i$1] : V(t[i$1], n[i$1]));
	return t;
}
function O(t) {
	return "number" == typeof t && isFinite(t);
}
function B(t) {
	return "number" == typeof t && t % 1 == 0;
}
function A(t) {
	return "string" == typeof t;
}
function I(t) {
	return "boolean" == typeof t;
}
function z(t) {
	const i = t;
	if (!i || "object" != typeof i) return i;
	let n, s, e$1;
	for (s in n = Array.isArray(i) ? [] : {}, i) i.hasOwnProperty(s) && (e$1 = i[s], n[s] = e$1 && "object" == typeof e$1 ? z(e$1) : e$1);
	return n;
}
function L(t) {
	return null !== t;
}
function E(t) {
	return null === t ? void 0 : t;
}
function F(t, i, n) {
	return void 0 === i && (i = N), `${n = void 0 !== n ? `${n} ` : ""}${t}px ${i}`;
}
function U() {
	return {
		it: [{
			nt: 0,
			st: 0,
			ot: 0,
			_t: 0
		}],
		lt: "",
		rt: "",
		ht: 0,
		et: 0,
		tt: null
	};
}
function K(t, i, n, s, e$1, r$1) {
	t.fillRect(i + r$1, n, s - 2 * r$1, r$1), t.fillRect(i + r$1, n + e$1 - r$1, s - 2 * r$1, r$1), t.fillRect(i, n, r$1, e$1), t.fillRect(i + s - r$1, n, r$1, e$1);
}
function G(t, i, n, s, e$1, r$1) {
	t.save(), t.globalCompositeOperation = "copy", t.fillStyle = r$1, t.fillRect(i, n, s, e$1), t.restore();
}
function J(t, i, n, s, e$1, r$1) {
	t.beginPath(), t.roundRect ? t.roundRect(i, n, s, e$1, r$1) : (t.lineTo(i + s - r$1[1], n), 0 !== r$1[1] && t.arcTo(i + s, n, i + s, n + r$1[1], r$1[1]), t.lineTo(i + s, n + e$1 - r$1[2]), 0 !== r$1[2] && t.arcTo(i + s, n + e$1, i + s - r$1[2], n + e$1, r$1[2]), t.lineTo(i + r$1[3], n + e$1), 0 !== r$1[3] && t.arcTo(i, n + e$1, i, n + e$1 - r$1[3], r$1[3]), t.lineTo(i, n + r$1[0]), 0 !== r$1[0] && t.arcTo(i, n, i + r$1[0], n, r$1[0]));
}
function Q(t, i, n, s, e$1, r$1, h$1 = 0, l$1 = [
	0,
	0,
	0,
	0
], a$1 = "") {
	if (t.save(), !h$1 || !a$1 || a$1 === r$1) return J(t, i, n, s, e$1, l$1), t.fillStyle = r$1, t.fill(), void t.restore();
	const o$1 = h$1 / 2;
	var _$1;
	J(t, i + o$1, n + o$1, s - h$1, e$1 - h$1, (_$1 = -o$1, l$1.map((t$1) => 0 === t$1 ? t$1 : t$1 + _$1))), "transparent" !== r$1 && (t.fillStyle = r$1, t.fill()), "transparent" !== a$1 && (t.lineWidth = h$1, t.strokeStyle = a$1, t.closePath(), t.stroke()), t.restore();
}
function tt(t, i, n, s, e$1, r$1, h$1) {
	t.save(), t.globalCompositeOperation = "copy";
	const l$1 = t.createLinearGradient(0, 0, 0, e$1);
	l$1.addColorStop(0, r$1), l$1.addColorStop(1, h$1), t.fillStyle = l$1, t.fillRect(i, n, s, e$1), t.restore();
}
function _t(t) {
	return "left" === t || "right" === t;
}
function dt(t, i) {
	if (!O(t)) return "n/a";
	if (!B(i)) throw new TypeError("invalid length");
	if (i < 0 || i > 16) throw new TypeError("invalid length");
	if (0 === i) return t.toString();
	return ("0000000000000000" + t.toString()).slice(-i);
}
function mt(t, i, n, s, e$1, r$1, h$1) {
	if (0 === i.length || s.from >= i.length || s.to <= 0) return;
	const { context: l$1, horizontalPixelRatio: a$1, verticalPixelRatio: o$1 } = t, _$1 = i[s.from];
	let u$1 = r$1(t, _$1), c$1 = _$1;
	if (s.to - s.from < 2) {
		const i$1 = e$1 / 2;
		l$1.beginPath();
		const n$1 = {
			nt: _$1.nt - i$1,
			st: _$1.st
		}, s$1 = {
			nt: _$1.nt + i$1,
			st: _$1.st
		};
		l$1.moveTo(n$1.nt * a$1, n$1.st * o$1), l$1.lineTo(s$1.nt * a$1, s$1.st * o$1), h$1(t, u$1, n$1, s$1);
	} else {
		const e$2 = (i$1, n$1) => {
			h$1(t, u$1, c$1, n$1), l$1.beginPath(), u$1 = i$1, c$1 = n$1;
		};
		let d$1 = c$1;
		l$1.beginPath(), l$1.moveTo(_$1.nt * a$1, _$1.st * o$1);
		for (let h$2 = s.from + 1; h$2 < s.to; ++h$2) {
			d$1 = i[h$2];
			const s$1 = r$1(t, d$1);
			switch (n) {
				case 0:
					l$1.lineTo(d$1.nt * a$1, d$1.st * o$1);
					break;
				case 1:
					l$1.lineTo(d$1.nt * a$1, i[h$2 - 1].st * o$1), s$1 !== u$1 && (e$2(s$1, d$1), l$1.lineTo(d$1.nt * a$1, i[h$2 - 1].st * o$1)), l$1.lineTo(d$1.nt * a$1, d$1.st * o$1);
					break;
				case 2: {
					const [t$1, n$1] = Mt(i, h$2 - 1, h$2);
					l$1.bezierCurveTo(t$1.nt * a$1, t$1.st * o$1, n$1.nt * a$1, n$1.st * o$1, d$1.nt * a$1, d$1.st * o$1);
					break;
				}
			}
			1 !== n && s$1 !== u$1 && (e$2(s$1, d$1), l$1.moveTo(d$1.nt * a$1, d$1.st * o$1));
		}
		(c$1 !== d$1 || c$1 === d$1 && 1 === n) && h$1(t, u$1, c$1, d$1);
	}
}
function wt(t, i) {
	return {
		nt: t.nt - i.nt,
		st: t.st - i.st
	};
}
function gt(t, i) {
	return {
		nt: t.nt / i,
		st: t.st / i
	};
}
function Mt(t, i, n) {
	const s = Math.max(0, i - 1), e$1 = Math.min(t.length - 1, n + 1);
	var r$1, h$1;
	return [(r$1 = t[i], h$1 = gt(wt(t[n], t[s]), bt), {
		nt: r$1.nt + h$1.nt,
		st: r$1.st + h$1.st
	}), wt(t[n], gt(wt(t[e$1], t[i]), bt))];
}
function xt(t, i, n, s, e$1) {
	const { context: r$1, horizontalPixelRatio: h$1, verticalPixelRatio: l$1 } = i;
	r$1.lineTo(e$1.nt * h$1, t * l$1), r$1.lineTo(s.nt * h$1, t * l$1), r$1.closePath(), r$1.fillStyle = n, r$1.fill();
}
function kt(t, i, n) {
	return Math.min(Math.max(t, i), n);
}
function yt(t, i, n) {
	return i - t <= n;
}
function Ct(t) {
	const i = Math.ceil(t);
	return i % 2 == 0 ? i - 1 : i;
}
function Rt(t, i) {
	const n = t.context;
	n.strokeStyle = i, n.stroke();
}
function Ot(t, i, n, s, e$1 = 0, r$1 = i.length) {
	let h$1 = r$1 - e$1;
	for (; 0 < h$1;) {
		const r$2 = h$1 >> 1, l$1 = e$1 + r$2;
		s(i[l$1], n) === t ? (e$1 = l$1 + 1, h$1 -= r$2 + 1) : h$1 = r$2;
	}
	return e$1;
}
function It(t, i) {
	return t.ot < i;
}
function zt(t, i) {
	return i < t.ot;
}
function Lt(t, i, n) {
	const s = i.Os(), e$1 = i.ui(), r$1 = Bt(t, s, It), h$1 = At(t, e$1, zt);
	if (!n) return {
		from: r$1,
		to: h$1
	};
	let l$1 = r$1, a$1 = h$1;
	return r$1 > 0 && r$1 < t.length && t[r$1].ot >= s && (l$1 = r$1 - 1), h$1 > 0 && h$1 < t.length && t[h$1 - 1].ot <= e$1 && (a$1 = h$1 + 1), {
		from: l$1,
		to: a$1
	};
}
function Gt(t) {
	return {
		x: t.nt,
		time: t.ot,
		originalData: t.He,
		barColor: t.ce
	};
}
function _i(t, i, n, s) {
	return function(t$1, i$1) {
		if ("transparent" === t$1) return t$1;
		const n$1 = T(t$1), s$1 = n$1[3];
		return `rgba(${n$1[0]}, ${n$1[1]}, ${n$1[2]}, ${i$1 * s$1})`;
	}(t, n + (s - n) * i);
}
function ui(t, i) {
	const n = t % 2600 / 2600;
	let s;
	for (const t$1 of oi) if (n >= t$1.Vr && n <= t$1.Or) {
		s = t$1;
		break;
	}
	p(void 0 !== s, "Last price animation internal logic error");
	const e$1 = (n - s.Vr) / (s.Or - s.Vr);
	return {
		Rr: _i(i, e$1, s.Ir, s.zr),
		Dr: _i(i, e$1, s.Lr, s.Er),
		ht: (r$1 = e$1, h$1 = s.Br, l$1 = s.Ar, h$1 + (l$1 - h$1) * r$1)
	};
	var r$1, h$1, l$1;
}
function di(t, i) {
	return Ct(Math.min(Math.max(t, 12), 30) * i);
}
function fi(t, i) {
	switch (t) {
		case "arrowDown":
		case "arrowUp": return di(i, 1);
		case "circle": return di(i, .8);
		case "square": return di(i, .7);
	}
}
function vi(t) {
	return function(t$1) {
		const i = Math.ceil(t$1);
		return i % 2 != 0 ? i - 1 : i;
	}(di(t, 1));
}
function pi(t) {
	return Math.max(di(t, .1), 3);
}
function mi(t, i, n) {
	return i ? t : n ? Math.ceil(t / 2) : 0;
}
function bi(t, i, n, s, e$1) {
	const r$1 = fi("square", n), h$1 = (r$1 - 1) / 2, l$1 = t - h$1, a$1 = i - h$1;
	return s >= l$1 && s <= l$1 + r$1 && e$1 >= a$1 && e$1 <= a$1 + r$1;
}
function wi(t, i, n, s) {
	const e$1 = (fi("arrowUp", s) - 1) / 2 * n.Jr, r$1 = (Ct(s / 2) - 1) / 2 * n.Jr;
	i.beginPath(), t ? (i.moveTo(n.nt - e$1, n.st), i.lineTo(n.nt, n.st - e$1), i.lineTo(n.nt + e$1, n.st), i.lineTo(n.nt + r$1, n.st), i.lineTo(n.nt + r$1, n.st + e$1), i.lineTo(n.nt - r$1, n.st + e$1), i.lineTo(n.nt - r$1, n.st)) : (i.moveTo(n.nt - e$1, n.st), i.lineTo(n.nt, n.st + e$1), i.lineTo(n.nt + e$1, n.st), i.lineTo(n.nt + r$1, n.st), i.lineTo(n.nt + r$1, n.st - e$1), i.lineTo(n.nt - r$1, n.st - e$1), i.lineTo(n.nt - r$1, n.st)), i.fill();
}
function gi(t, i, n, s, e$1, r$1) {
	return bi(i, n, s, e$1, r$1);
}
function xi(t, i, n, s) {
	i.fillStyle = t.V, void 0 !== t.Kt && function(t$1, i$1, n$1, s$1, e$1, r$1) {
		t$1.save(), t$1.scale(e$1, r$1), t$1.fillText(i$1, n$1, s$1), t$1.restore();
	}(i, t.Kt.ih, t.Kt.nt, t.Kt.st, n, s), function(t$1, i$1, n$1) {
		if (0 === t$1.Ks) return;
		switch (t$1.nh) {
			case "arrowDown": return void wi(!1, i$1, n$1, t$1.Ks);
			case "arrowUp": return void wi(!0, i$1, n$1, t$1.Ks);
			case "circle": return void function(t$2, i$2, n$2) {
				const s$1 = (fi("circle", n$2) - 1) / 2;
				t$2.beginPath(), t$2.arc(i$2.nt, i$2.st, s$1 * i$2.Jr, 0, 2 * Math.PI, !1), t$2.fill();
			}(i$1, n$1, t$1.Ks);
			case "square": return void function(t$2, i$2, n$2) {
				const s$1 = fi("square", n$2), e$1 = (s$1 - 1) * i$2.Jr / 2, r$1 = i$2.nt - e$1, h$1 = i$2.st - e$1;
				t$2.fillRect(r$1, h$1, s$1 * i$2.Jr, s$1 * i$2.Jr);
			}(i$1, n$1, t$1.Ks);
		}
		t$1.nh;
	}(t, i, function(t$1, i$1, n$1) {
		const s$1 = Math.max(1, Math.floor(i$1)) % 2 / 2;
		return {
			nt: Math.round(t$1.nt * i$1) + s$1,
			st: t$1.st * n$1,
			Jr: i$1
		};
	}(t, n, s));
}
function Si(t, i, n) {
	return !(void 0 === t.Kt || !function(t$1, i$1, n$1, s, e$1, r$1) {
		const h$1 = s / 2;
		return e$1 >= t$1 && e$1 <= t$1 + n$1 && r$1 >= i$1 - h$1 && r$1 <= i$1 + h$1;
	}(t.Kt.nt, t.Kt.st, t.Kt.Hi, t.Kt.At, i, n)) || function(t$1, i$1, n$1) {
		if (0 === t$1.Ks) return !1;
		switch (t$1.nh) {
			case "arrowDown":
			case "arrowUp": return gi(0, t$1.nt, t$1.st, t$1.Ks, i$1, n$1);
			case "circle": return function(t$2, i$2, n$2, s, e$1) {
				const r$1 = 2 + fi("circle", n$2) / 2, h$1 = t$2 - s, l$1 = i$2 - e$1;
				return Math.sqrt(h$1 * h$1 + l$1 * l$1) <= r$1;
			}(t$1.nt, t$1.st, t$1.Ks, i$1, n$1);
			case "square": return bi(t$1.nt, t$1.st, t$1.Ks, i$1, n$1);
		}
	}(t, i, n);
}
function ki(t, i, n, s, e$1, r$1, h$1, l$1, a$1) {
	const o$1 = O(n) ? n : n.Se, _$1 = O(n) ? n : n.Me, u$1 = O(n) ? n : n.xe, c$1 = O(i.size) ? Math.max(i.size, 0) : 1, d$1 = vi(l$1.le()) * c$1, f$1 = d$1 / 2;
	switch (t.Ks = d$1, i.position) {
		case "inBar": return t.st = h$1.Rt(o$1, a$1), void (void 0 !== t.Kt && (t.Kt.st = t.st + f$1 + r$1 + .6 * e$1));
		case "aboveBar": return t.st = h$1.Rt(_$1, a$1) - f$1 - s.sh, void 0 !== t.Kt && (t.Kt.st = t.st - f$1 - .6 * e$1, s.sh += 1.2 * e$1), void (s.sh += d$1 + r$1);
		case "belowBar": return t.st = h$1.Rt(u$1, a$1) + f$1 + s.eh, void 0 !== t.Kt && (t.Kt.st = t.st + f$1 + r$1 + .6 * e$1, s.eh += 1.2 * e$1), void (s.eh += d$1 + r$1);
	}
	i.position;
}
function Pi(t, i, n, s) {
	const e$1 = Number.isFinite(i), r$1 = Number.isFinite(n);
	return e$1 && r$1 ? t(i, n) : e$1 || r$1 ? e$1 ? i : n : s;
}
function Fi(t, i) {
	if (null === t) return i;
	if (null === i) return t;
	return {
		ml: Math.min(t.ml, i.ml),
		bl: Math.max(t.bl, i.bl)
	};
}
function Hi(t) {
	var i, n, s, e$1, r$1;
	return {
		Kt: t.text(),
		ki: t.coordinate(),
		Si: null === (i = t.fixedCoordinate) || void 0 === i ? void 0 : i.call(t),
		V: t.textColor(),
		t: t.backColor(),
		yt: null === (s = null === (n = t.visible) || void 0 === n ? void 0 : n.call(t)) || void 0 === s || s,
		hi: null === (r$1 = null === (e$1 = t.tickVisible) || void 0 === e$1 ? void 0 : e$1.call(t)) || void 0 === r$1 || r$1
	};
}
function Yi(t, i, n, s) {
	t.forEach((t$1) => {
		i(t$1).forEach((t$2) => {
			t$2.Sl() === n && s.push(t$2);
		});
	});
}
function Zi(t) {
	return t.Pn();
}
function Xi(t) {
	return t.Bl();
}
function Ki(t) {
	return t.Al();
}
function en(t, i) {
	const n = 100 * (t - i) / i;
	return i < 0 ? -n : n;
}
function rn(t, i) {
	const n = en(t.Ph(), i), s = en(t.Rh(), i);
	return new Ri(n, s);
}
function hn(t, i) {
	const n = 100 * (t - i) / i + 100;
	return i < 0 ? -n : n;
}
function ln(t, i) {
	const n = hn(t.Ph(), i), s = hn(t.Rh(), i);
	return new Ri(n, s);
}
function an(t, i) {
	const n = Math.abs(t);
	if (n < 1e-15) return 0;
	const s = Math.log10(n + i.Ua) + i.$a;
	return t < 0 ? -s : s;
}
function on(t, i) {
	const n = Math.abs(t);
	if (n < 1e-15) return 0;
	const s = Math.pow(10, n - i.$a) - i.Ua;
	return t < 0 ? -s : s;
}
function _n(t, i) {
	if (null === t) return null;
	const n = an(t.Ph(), i), s = an(t.Rh(), i);
	return new Ri(n, s);
}
function un(t, i) {
	if (null === t) return null;
	const n = on(t.Ph(), i), s = on(t.Rh(), i);
	return new Ri(n, s);
}
function cn(t) {
	if (null === t) return sn;
	const i = Math.abs(t.Rh() - t.Ph());
	if (i >= 1 || i < 1e-15) return sn;
	const n = Math.ceil(Math.abs(Math.log10(i))), s = sn.$a + n;
	return {
		$a: s,
		Ua: 1 / Math.pow(10, s)
	};
}
function vn(t) {
	return t.slice().sort((t$1, i) => b(t$1.Xi()) - b(i.Xi()));
}
function Sn(t, i) {
	return null === t || null === i ? t === i : t.Ch(i);
}
function Cn(t, i) {
	return t.weight > i.weight ? t : i;
}
function En(t) {
	return !O(t) && !A(t);
}
function Nn(t) {
	return O(t);
}
function Wn(t, i, n) {
	return i.replace(/yyyy/g, ((t$1) => dt(Fn(t$1), 4))(t)).replace(/yy/g, ((t$1) => dt(Fn(t$1) % 100, 2))(t)).replace(/MMMM/g, ((t$1, i$1) => new Date(t$1.getUTCFullYear(), t$1.getUTCMonth(), 1).toLocaleString(i$1, { month: "long" }))(t, n)).replace(/MMM/g, ((t$1, i$1) => new Date(t$1.getUTCFullYear(), t$1.getUTCMonth(), 1).toLocaleString(i$1, { month: "short" }))(t, n)).replace(/MM/g, ((t$1) => dt(((t$2) => t$2.getUTCMonth() + 1)(t$1), 2))(t)).replace(/dd/g, ((t$1) => dt(((t$2) => t$2.getUTCDate())(t$1), 2))(t));
}
function qn(t) {
	return 60 * t * 60 * 1e3;
}
function Yn(t) {
	return 60 * t * 1e3;
}
function Kn(t, i) {
	if (t.getUTCFullYear() !== i.getUTCFullYear()) return 70;
	if (t.getUTCMonth() !== i.getUTCMonth()) return 60;
	if (t.getUTCDate() !== i.getUTCDate()) return 50;
	for (let n = Zn.length - 1; n >= 0; --n) if (Math.floor(i.getTime() / Zn[n].Dd) !== Math.floor(t.getTime() / Zn[n].Dd)) return Zn[n].Vd;
	return 0;
}
function Gn(t) {
	let i = t;
	if (A(t) && (i = Qn(t)), !En(i)) throw new Error("time must be of type BusinessDay");
	const n = new Date(Date.UTC(i.year, i.month - 1, i.day, 0, 0, 0, 0));
	return {
		Od: Math.round(n.getTime() / 1e3),
		Bd: i
	};
}
function Jn(t) {
	if (!Nn(t)) throw new Error("time must be of type isUTCTimestamp");
	return { Od: t };
}
function Qn(t) {
	const i = new Date(t);
	if (isNaN(i.getTime())) throw new Error(`Invalid date string=${t}, expected format=yyyy-mm-dd`);
	return {
		day: i.getUTCDate(),
		month: i.getUTCMonth() + 1,
		year: i.getUTCFullYear()
	};
}
function ts(t) {
	A(t.time) && (t.time = Qn(t.time));
}
function ss() {
	return !!ns && window.navigator.userAgent.toLowerCase().indexOf("firefox") > -1;
}
function es() {
	return !!ns && /iPhone|iPad|iPod/.test(window.navigator.platform);
}
function rs(t) {
	return t + t % 2;
}
function hs(t, i) {
	return t.zd - i.zd;
}
function ls(t, i, n) {
	const s = (t.zd - i.zd) / (t.ot - i.ot);
	return Math.sign(s) * Math.min(Math.abs(s), n);
}
function _s(t, n) {
	const s = b(t.ownerDocument).createElement("canvas");
	t.appendChild(s);
	const e$1 = bindTo(s, {
		type: "device-pixel-content-box",
		options: { allowResizeObserver: !1 },
		transform: (t$1, i) => ({
			width: Math.max(t$1.width, i.width),
			height: Math.max(t$1.height, i.height)
		})
	});
	return e$1.resizeCanvasElement(n), e$1;
}
function us(t) {
	var i;
	t.width = 1, t.height = 1, null === (i = t.getContext("2d")) || void 0 === i || i.clearRect(0, 0, 1, 1);
}
function cs(t, i, n, s) {
	t.gl && t.gl(i, n, s);
}
function ds(t, i, n, s) {
	t.X(i, n, s);
}
function fs(t, i, n, s) {
	const e$1 = t(n, s);
	for (const t$1 of e$1) {
		const n$1 = t$1.gt();
		null !== n$1 && i(n$1);
	}
}
function vs(t) {
	ns && void 0 !== window.chrome && t.addEventListener("mousedown", (t$1) => {
		if (1 === t$1.button) return t$1.preventDefault(), !1;
	});
}
function ms(t, i) {
	const n = t.clientX - i.clientX, s = t.clientY - i.clientY;
	return Math.sqrt(n * n + s * s);
}
function bs(t) {
	t.cancelable && t.preventDefault();
}
function ws(t) {
	return {
		nt: t.pageX,
		st: t.pageY
	};
}
function gs(t) {
	return t.timeStamp || performance.now();
}
function Ms(t, i) {
	for (let n = 0; n < t.length; ++n) if (t[n].identifier === i) return t[n];
	return null;
}
function xs(t) {
	return {
		Hc: t.Hc,
		Iv: { gr: t.zv.externalId },
		Lv: t.zv.cursorStyle
	};
}
function Ss(t, i, n) {
	for (const s of t) {
		const t$1 = s.gt();
		if (null !== t$1 && t$1.wr) {
			const e$1 = t$1.wr(i, n);
			if (null !== e$1) return {
				Bv: s,
				Iv: e$1
			};
		}
	}
	return null;
}
function ks(t, i) {
	return (n) => {
		var s, e$1, r$1, h$1;
		return (null !== (e$1 = null === (s = n.Dt()) || void 0 === s ? void 0 : s.Pa()) && void 0 !== e$1 ? e$1 : "") !== i ? [] : null !== (h$1 = null === (r$1 = n.da) || void 0 === r$1 ? void 0 : r$1.call(n, t)) && void 0 !== h$1 ? h$1 : [];
	};
}
function ys(t, i, n, s) {
	if (!t.length) return;
	let e$1 = 0;
	const r$1 = n / 2, h$1 = t[0].At(s, !0);
	let l$1 = 1 === i ? r$1 - (t[0].Vi() - h$1 / 2) : t[0].Vi() - h$1 / 2 - r$1;
	l$1 = Math.max(0, l$1);
	for (let r$2 = 1; r$2 < t.length; r$2++) {
		const h$2 = t[r$2], a$1 = t[r$2 - 1], o$1 = a$1.At(s, !1), _$1 = h$2.Vi(), u$1 = a$1.Vi();
		if (1 === i ? _$1 > u$1 - o$1 : _$1 < u$1 + o$1) {
			const s$1 = u$1 - o$1 * i;
			h$2.Oi(s$1);
			const r$3 = s$1 - i * o$1 / 2;
			if ((1 === i ? r$3 < 0 : r$3 > n) && l$1 > 0) {
				const s$2 = 1 === i ? -1 - r$3 : r$3 - n, h$3 = Math.min(s$2, l$1);
				for (let n$1 = e$1; n$1 < t.length; n$1++) t[n$1].Oi(t[n$1].Vi() + i * h$3);
				l$1 -= h$3;
			}
		} else e$1 = r$2, l$1 = 1 === i ? u$1 - o$1 - _$1 : _$1 - (u$1 + o$1);
	}
}
function Ts(t, i) {
	var n, s;
	return null !== (s = null === (n = t.ua) || void 0 === n ? void 0 : n.call(t, i)) && void 0 !== s ? s : [];
}
function Ps(t, i) {
	var n, s;
	return null !== (s = null === (n = t.Pn) || void 0 === n ? void 0 : n.call(t, i)) && void 0 !== s ? s : [];
}
function Rs(t, i) {
	var n, s;
	return null !== (s = null === (n = t.Ji) || void 0 === n ? void 0 : n.call(t, i)) && void 0 !== s ? s : [];
}
function Ds(t, i) {
	var n, s;
	return null !== (s = null === (n = t.aa) || void 0 === n ? void 0 : n.call(t, i)) && void 0 !== s ? s : [];
}
function Bs(t) {
	return (i) => {
		var n, s;
		return null !== (s = null === (n = i.fa) || void 0 === n ? void 0 : n.call(i, t)) && void 0 !== s ? s : [];
	};
}
function Ws(t) {
	return Boolean(t.handleScroll.mouseWheel || t.handleScale.mouseWheel);
}
function js(t) {
	return function(t$1) {
		return void 0 !== t$1.open;
	}(t) || function(t$1) {
		return void 0 !== t$1.value;
	}(t);
}
function Hs(t, i) {
	var n = {};
	for (var s in t) Object.prototype.hasOwnProperty.call(t, s) && i.indexOf(s) < 0 && (n[s] = t[s]);
	if (null != t && "function" == typeof Object.getOwnPropertySymbols) {
		var e$1 = 0;
		for (s = Object.getOwnPropertySymbols(t); e$1 < s.length; e$1++) i.indexOf(s[e$1]) < 0 && Object.prototype.propertyIsEnumerable.call(t, s[e$1]) && (n[s[e$1]] = t[s[e$1]]);
	}
	return n;
}
function $s(t, i, n, s) {
	const e$1 = n.value, r$1 = {
		ee: i,
		ot: t,
		Vt: [
			e$1,
			e$1,
			e$1,
			e$1
		],
		zb: s
	};
	return void 0 !== n.color && (r$1.V = n.color), r$1;
}
function Us(t, i, n, s) {
	const e$1 = n.value, r$1 = {
		ee: i,
		ot: t,
		Vt: [
			e$1,
			e$1,
			e$1,
			e$1
		],
		zb: s
	};
	return void 0 !== n.lineColor && (r$1.lt = n.lineColor), void 0 !== n.topColor && (r$1.Ps = n.topColor), void 0 !== n.bottomColor && (r$1.Rs = n.bottomColor), r$1;
}
function qs(t, i, n, s) {
	const e$1 = n.value, r$1 = {
		ee: i,
		ot: t,
		Vt: [
			e$1,
			e$1,
			e$1,
			e$1
		],
		zb: s
	};
	return void 0 !== n.topLineColor && (r$1.Re = n.topLineColor), void 0 !== n.bottomLineColor && (r$1.De = n.bottomLineColor), void 0 !== n.topFillColor1 && (r$1.ke = n.topFillColor1), void 0 !== n.topFillColor2 && (r$1.ye = n.topFillColor2), void 0 !== n.bottomFillColor1 && (r$1.Ce = n.bottomFillColor1), void 0 !== n.bottomFillColor2 && (r$1.Te = n.bottomFillColor2), r$1;
}
function Ys(t, i, n, s) {
	const e$1 = {
		ee: i,
		ot: t,
		Vt: [
			n.open,
			n.high,
			n.low,
			n.close
		],
		zb: s
	};
	return void 0 !== n.color && (e$1.V = n.color), e$1;
}
function Zs(t, i, n, s) {
	const e$1 = {
		ee: i,
		ot: t,
		Vt: [
			n.open,
			n.high,
			n.low,
			n.close
		],
		zb: s
	};
	return void 0 !== n.color && (e$1.V = n.color), void 0 !== n.borderColor && (e$1.Ot = n.borderColor), void 0 !== n.wickColor && (e$1.Xh = n.wickColor), e$1;
}
function Xs(t, i, n, s, e$1) {
	const r$1 = m(e$1)(n), h$1 = Math.max(...r$1), l$1 = Math.min(...r$1), a$1 = r$1[r$1.length - 1], o$1 = [
		a$1,
		h$1,
		l$1,
		a$1
	], _$1 = n, { time: u$1, color: c$1 } = _$1;
	return {
		ee: i,
		ot: t,
		Vt: o$1,
		zb: s,
		$e: Hs(_$1, ["time", "color"]),
		V: c$1
	};
}
function Ks(t) {
	return void 0 !== t.Vt;
}
function Gs(t, i) {
	return void 0 !== i.customValues && (t.jb = i.customValues), t;
}
function Js(t) {
	return (i, n, s, e$1, r$1, h$1) => function(t$1, i$1) {
		return i$1 ? i$1(t$1) : void 0 === (n$1 = t$1).open && void 0 === n$1.value;
		var n$1;
	}(s, h$1) ? Gs({
		ot: i,
		ee: n,
		zb: e$1
	}, s) : Gs(t(i, n, s, e$1, r$1), s);
}
function Qs(t) {
	return {
		Candlestick: Js(Zs),
		Bar: Js(Ys),
		Area: Js(Us),
		Baseline: Js(qs),
		Histogram: Js($s),
		Line: Js($s),
		Custom: Js(Xs)
	}[t];
}
function te(t) {
	return {
		ee: 0,
		Hb: /* @__PURE__ */ new Map(),
		la: t
	};
}
function ie(t, i) {
	if (void 0 !== t && 0 !== t.length) return {
		$b: i.key(t[0].ot),
		Ub: i.key(t[t.length - 1].ot)
	};
}
function ne(t) {
	let i;
	return t.forEach((t$1) => {
		void 0 === i && (i = t$1.zb);
	}), m(i);
}
function ee(t, i) {
	t.ee = i, t.Hb.forEach((t$1) => {
		t$1.ee = i;
	});
}
function re(t) {
	const i = {
		value: t.Vt[3],
		time: t.zb
	};
	return void 0 !== t.jb && (i.customValues = t.jb), i;
}
function he(t) {
	const i = re(t);
	return void 0 !== t.V && (i.color = t.V), i;
}
function le(t) {
	const i = re(t);
	return void 0 !== t.lt && (i.lineColor = t.lt), void 0 !== t.Ps && (i.topColor = t.Ps), void 0 !== t.Rs && (i.bottomColor = t.Rs), i;
}
function ae(t) {
	const i = re(t);
	return void 0 !== t.Re && (i.topLineColor = t.Re), void 0 !== t.De && (i.bottomLineColor = t.De), void 0 !== t.ke && (i.topFillColor1 = t.ke), void 0 !== t.ye && (i.topFillColor2 = t.ye), void 0 !== t.Ce && (i.bottomFillColor1 = t.Ce), void 0 !== t.Te && (i.bottomFillColor2 = t.Te), i;
}
function oe(t) {
	const i = {
		open: t.Vt[0],
		high: t.Vt[1],
		low: t.Vt[2],
		close: t.Vt[3],
		time: t.zb
	};
	return void 0 !== t.jb && (i.customValues = t.jb), i;
}
function _e(t) {
	const i = oe(t);
	return void 0 !== t.V && (i.color = t.V), i;
}
function ue(t) {
	const i = oe(t), { V: n, Ot: s, Xh: e$1 } = t;
	return void 0 !== n && (i.color = n), void 0 !== s && (i.borderColor = s), void 0 !== e$1 && (i.wickColor = e$1), i;
}
function ce(t) {
	return {
		Area: le,
		Line: he,
		Baseline: ae,
		Histogram: he,
		Bar: _e,
		Candlestick: ue,
		Custom: de
	}[t];
}
function de(t) {
	const i = t.zb;
	return Object.assign(Object.assign({}, t.$e), { time: i });
}
function ge() {
	return {
		width: 0,
		height: 0,
		autoSize: !1,
		layout: pe,
		crosshair: fe,
		grid: ve,
		overlayPriceScales: Object.assign({}, me),
		leftPriceScale: Object.assign(Object.assign({}, me), { visible: !1 }),
		rightPriceScale: Object.assign(Object.assign({}, me), { visible: !0 }),
		timeScale: be,
		watermark: we,
		localization: {
			locale: ns ? navigator.language : "",
			dateFormat: "dd MMM 'yy"
		},
		handleScroll: {
			mouseWheel: !0,
			pressedMouseMove: !0,
			horzTouchDrag: !0,
			vertTouchDrag: !0
		},
		handleScale: {
			axisPressedMouseMove: {
				time: !0,
				price: !0
			},
			axisDoubleClickReset: {
				time: !0,
				price: !0
			},
			mouseWheel: !0,
			pinch: !0
		},
		kineticScroll: {
			mouse: !1,
			touch: !0
		},
		trackingMode: { exitMode: 1 }
	};
}
function xe(t, i, n) {
	const s = Hs(t, ["time", "originalTime"]), e$1 = Object.assign({ time: i }, s);
	return void 0 !== n && (e$1.originalTime = n), e$1;
}
function Te(t) {
	if (void 0 === t || "custom" === t.type) return;
	const i = t;
	void 0 !== i.minMove && void 0 === i.precision && (i.precision = function(t$1) {
		if (t$1 >= 1) return 0;
		let i$1 = 0;
		for (; i$1 < 8; i$1++) {
			const n = Math.round(t$1);
			if (Math.abs(n - t$1) < 1e-8) return i$1;
			t$1 *= 10;
		}
		return i$1;
	}(i.minMove));
}
function Pe(t) {
	return function(t$1) {
		if (I(t$1.handleScale)) {
			const i$1 = t$1.handleScale;
			t$1.handleScale = {
				axisDoubleClickReset: {
					time: i$1,
					price: i$1
				},
				axisPressedMouseMove: {
					time: i$1,
					price: i$1
				},
				mouseWheel: i$1,
				pinch: i$1
			};
		} else if (void 0 !== t$1.handleScale) {
			const { axisPressedMouseMove: i$1, axisDoubleClickReset: n } = t$1.handleScale;
			I(i$1) && (t$1.handleScale.axisPressedMouseMove = {
				time: i$1,
				price: i$1
			}), I(n) && (t$1.handleScale.axisDoubleClickReset = {
				time: n,
				price: n
			});
		}
		const i = t$1.handleScroll;
		I(i) && (t$1.handleScroll = {
			horzTouchDrag: i,
			vertTouchDrag: i,
			mouseWheel: i,
			pressedMouseMove: i
		});
	}(t), t;
}
function De(t, i, n) {
	let s;
	if (A(t)) {
		const i$1 = document.getElementById(t);
		p(null !== i$1, `Cannot find element in DOM with id=${t}`), s = i$1;
	} else s = t;
	const e$1 = new Re(s, i, n);
	return i.setOptions(e$1.options()), e$1;
}
function Ve(t, i) {
	return De(t, new is(), is.Id(i));
}
var e, r, h, l, a, o, _, u, c, d, g, S, k, y, C, D, N, W, j, H, $, q, Y, Z, X, it, nt, st, et, rt, ht, lt, at, ot, ut, ct, ft, vt, pt, bt, St, Tt, Pt, Dt, Vt, Bt, At, Et, Nt, Ft, Wt, jt, Ht, $t, Ut, qt, Yt, Zt, Xt, Kt, Jt, Qt, ti, ii, ni, si, ei, ri, hi, li, ai, oi, ci, Mi, yi, Ci, Ti, Ri, Di, Vi, Oi, Bi, Ai, Ii, zi, Li, Ei, Ni, Wi, ji, $i, Ui, qi, Gi, Ji, Qi, tn, nn, sn, dn, fn, pn, mn, bn, wn, gn, Mn, xn, kn, yn, Tn, Pn, Rn, Dn, Vn, On, Bn, An, In, zn, Ln, Fn, jn, Hn, $n, Un, Zn, Xn, is, ns, as, os, ps, Cs, Vs, Os, As, Is, zs, Ls, Es, Ns, Fs, se, fe, ve, pe, me, be, we, Me, Se, ke, ye, Ce, Re, Be;
var init_lightweight_charts_production = __esm({ "node_modules/.pnpm/lightweight-charts@4.2.3/node_modules/lightweight-charts/dist/lightweight-charts.production.mjs"() {
	init_fancy_canvas();
	e = {
		upColor: "#26a69a",
		downColor: "#ef5350",
		wickVisible: !0,
		borderVisible: !0,
		borderColor: "#378658",
		borderUpColor: "#26a69a",
		borderDownColor: "#ef5350",
		wickColor: "#737375",
		wickUpColor: "#26a69a",
		wickDownColor: "#ef5350"
	}, r = {
		upColor: "#26a69a",
		downColor: "#ef5350",
		openVisible: !0,
		thinBars: !0
	}, h = {
		color: "#2196f3",
		lineStyle: 0,
		lineWidth: 3,
		lineType: 0,
		lineVisible: !0,
		crosshairMarkerVisible: !0,
		crosshairMarkerRadius: 4,
		crosshairMarkerBorderColor: "",
		crosshairMarkerBorderWidth: 2,
		crosshairMarkerBackgroundColor: "",
		lastPriceAnimation: 0,
		pointMarkersVisible: !1
	}, l = {
		topColor: "rgba( 46, 220, 135, 0.4)",
		bottomColor: "rgba( 40, 221, 100, 0)",
		invertFilledArea: !1,
		lineColor: "#33D778",
		lineStyle: 0,
		lineWidth: 3,
		lineType: 0,
		lineVisible: !0,
		crosshairMarkerVisible: !0,
		crosshairMarkerRadius: 4,
		crosshairMarkerBorderColor: "",
		crosshairMarkerBorderWidth: 2,
		crosshairMarkerBackgroundColor: "",
		lastPriceAnimation: 0,
		pointMarkersVisible: !1
	}, a = {
		baseValue: {
			type: "price",
			price: 0
		},
		topFillColor1: "rgba(38, 166, 154, 0.28)",
		topFillColor2: "rgba(38, 166, 154, 0.05)",
		topLineColor: "rgba(38, 166, 154, 1)",
		bottomFillColor1: "rgba(239, 83, 80, 0.05)",
		bottomFillColor2: "rgba(239, 83, 80, 0.28)",
		bottomLineColor: "rgba(239, 83, 80, 1)",
		lineWidth: 3,
		lineStyle: 0,
		lineType: 0,
		lineVisible: !0,
		crosshairMarkerVisible: !0,
		crosshairMarkerRadius: 4,
		crosshairMarkerBorderColor: "",
		crosshairMarkerBorderWidth: 2,
		crosshairMarkerBackgroundColor: "",
		lastPriceAnimation: 0,
		pointMarkersVisible: !1
	}, o = {
		color: "#26a69a",
		base: 0
	}, _ = { color: "#2196f3" }, u = {
		title: "",
		visible: !0,
		lastValueVisible: !0,
		priceLineVisible: !0,
		priceLineSource: 0,
		priceLineWidth: 1,
		priceLineColor: "",
		priceLineStyle: 2,
		baseLineVisible: !0,
		baseLineWidth: 1,
		baseLineColor: "#B2B5BE",
		baseLineStyle: 0,
		priceFormat: {
			type: "price",
			precision: 2,
			minMove: .01
		}
	};
	(function(t) {
		t[t.Simple = 0] = "Simple", t[t.WithSteps = 1] = "WithSteps", t[t.Curved = 2] = "Curved";
	})(c || (c = {})), function(t) {
		t[t.Solid = 0] = "Solid", t[t.Dotted = 1] = "Dotted", t[t.Dashed = 2] = "Dashed", t[t.LargeDashed = 3] = "LargeDashed", t[t.SparseDotted = 4] = "SparseDotted";
	}(d || (d = {}));
	g = {
		khaki: "#f0e68c",
		azure: "#f0ffff",
		aliceblue: "#f0f8ff",
		ghostwhite: "#f8f8ff",
		gold: "#ffd700",
		goldenrod: "#daa520",
		gainsboro: "#dcdcdc",
		gray: "#808080",
		green: "#008000",
		honeydew: "#f0fff0",
		floralwhite: "#fffaf0",
		lightblue: "#add8e6",
		lightcoral: "#f08080",
		lemonchiffon: "#fffacd",
		hotpink: "#ff69b4",
		lightyellow: "#ffffe0",
		greenyellow: "#adff2f",
		lightgoldenrodyellow: "#fafad2",
		limegreen: "#32cd32",
		linen: "#faf0e6",
		lightcyan: "#e0ffff",
		magenta: "#f0f",
		maroon: "#800000",
		olive: "#808000",
		orange: "#ffa500",
		oldlace: "#fdf5e6",
		mediumblue: "#0000cd",
		transparent: "#0000",
		lime: "#0f0",
		lightpink: "#ffb6c1",
		mistyrose: "#ffe4e1",
		moccasin: "#ffe4b5",
		midnightblue: "#191970",
		orchid: "#da70d6",
		mediumorchid: "#ba55d3",
		mediumturquoise: "#48d1cc",
		orangered: "#ff4500",
		royalblue: "#4169e1",
		powderblue: "#b0e0e6",
		red: "#f00",
		coral: "#ff7f50",
		turquoise: "#40e0d0",
		white: "#fff",
		whitesmoke: "#f5f5f5",
		wheat: "#f5deb3",
		teal: "#008080",
		steelblue: "#4682b4",
		bisque: "#ffe4c4",
		aquamarine: "#7fffd4",
		aqua: "#0ff",
		sienna: "#a0522d",
		silver: "#c0c0c0",
		springgreen: "#00ff7f",
		antiquewhite: "#faebd7",
		burlywood: "#deb887",
		brown: "#a52a2a",
		beige: "#f5f5dc",
		chocolate: "#d2691e",
		chartreuse: "#7fff00",
		cornflowerblue: "#6495ed",
		cornsilk: "#fff8dc",
		crimson: "#dc143c",
		cadetblue: "#5f9ea0",
		tomato: "#ff6347",
		fuchsia: "#f0f",
		blue: "#00f",
		salmon: "#fa8072",
		blanchedalmond: "#ffebcd",
		slateblue: "#6a5acd",
		slategray: "#708090",
		thistle: "#d8bfd8",
		tan: "#d2b48c",
		cyan: "#0ff",
		darkblue: "#00008b",
		darkcyan: "#008b8b",
		darkgoldenrod: "#b8860b",
		darkgray: "#a9a9a9",
		blueviolet: "#8a2be2",
		black: "#000",
		darkmagenta: "#8b008b",
		darkslateblue: "#483d8b",
		darkkhaki: "#bdb76b",
		darkorchid: "#9932cc",
		darkorange: "#ff8c00",
		darkgreen: "#006400",
		darkred: "#8b0000",
		dodgerblue: "#1e90ff",
		darkslategray: "#2f4f4f",
		dimgray: "#696969",
		deepskyblue: "#00bfff",
		firebrick: "#b22222",
		forestgreen: "#228b22",
		indigo: "#4b0082",
		ivory: "#fffff0",
		lavenderblush: "#fff0f5",
		feldspar: "#d19275",
		indianred: "#cd5c5c",
		lightgreen: "#90ee90",
		lightgrey: "#d3d3d3",
		lightskyblue: "#87cefa",
		lightslategray: "#789",
		lightslateblue: "#8470ff",
		snow: "#fffafa",
		lightseagreen: "#20b2aa",
		lightsalmon: "#ffa07a",
		darksalmon: "#e9967a",
		darkviolet: "#9400d3",
		mediumpurple: "#9370d8",
		mediumaquamarine: "#66cdaa",
		skyblue: "#87ceeb",
		lavender: "#e6e6fa",
		lightsteelblue: "#b0c4de",
		mediumvioletred: "#c71585",
		mintcream: "#f5fffa",
		navajowhite: "#ffdead",
		navy: "#000080",
		olivedrab: "#6b8e23",
		palevioletred: "#d87093",
		violetred: "#d02090",
		yellow: "#ff0",
		yellowgreen: "#9acd32",
		lawngreen: "#7cfc00",
		pink: "#ffc0cb",
		paleturquoise: "#afeeee",
		palegoldenrod: "#eee8aa",
		darkolivegreen: "#556b2f",
		darkseagreen: "#8fbc8f",
		darkturquoise: "#00ced1",
		peachpuff: "#ffdab9",
		deeppink: "#ff1493",
		violet: "#ee82ee",
		palegreen: "#98fb98",
		mediumseagreen: "#3cb371",
		peru: "#cd853f",
		saddlebrown: "#8b4513",
		sandybrown: "#f4a460",
		rosybrown: "#bc8f8f",
		purple: "#800080",
		seagreen: "#2e8b57",
		seashell: "#fff5ee",
		papayawhip: "#ffefd5",
		mediumslateblue: "#7b68ee",
		plum: "#dda0dd",
		mediumspringgreen: "#00fa9a"
	};
	S = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i, k = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i, y = /^rgb\(\s*(-?\d{1,10})\s*,\s*(-?\d{1,10})\s*,\s*(-?\d{1,10})\s*\)$/, C = /^rgba\(\s*(-?\d{1,10})\s*,\s*(-?\d{1,10})\s*,\s*(-?\d{1,10})\s*,\s*(-?\d*\.?\d+)\s*\)$/;
	D = class {
		constructor() {
			this.h = [];
		}
		l(t, i, n) {
			const s = {
				o: t,
				_: i,
				u: !0 === n
			};
			this.h.push(s);
		}
		v(t) {
			const i = this.h.findIndex((i$1) => t === i$1.o);
			i > -1 && this.h.splice(i, 1);
		}
		p(t) {
			this.h = this.h.filter((i) => i._ !== t);
		}
		m(t, i, n) {
			const s = [...this.h];
			this.h = this.h.filter((t$1) => !t$1.u), s.forEach((s$1) => s$1.o(t, i, n));
		}
		M() {
			return this.h.length > 0;
		}
		S() {
			this.h = [];
		}
	};
	N = "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif";
	W = class {
		constructor(t) {
			this.k = {
				C: 1,
				T: 5,
				P: NaN,
				R: "",
				D: "",
				V: "",
				O: "",
				B: 0,
				A: 0,
				I: 0,
				L: 0,
				N: 0
			}, this.F = t;
		}
		W() {
			const t = this.k, i = this.j(), n = this.H();
			return t.P === i && t.D === n || (t.P = i, t.D = n, t.R = F(i, n), t.L = 2.5 / 12 * i, t.B = t.L, t.A = i / 12 * t.T, t.I = i / 12 * t.T, t.N = 0), t.V = this.$(), t.O = this.U(), this.k;
		}
		$() {
			return this.F.W().layout.textColor;
		}
		U() {
			return this.F.q();
		}
		j() {
			return this.F.W().layout.fontSize;
		}
		H() {
			return this.F.W().layout.fontFamily;
		}
	};
	j = class {
		constructor() {
			this.Y = [];
		}
		Z(t) {
			this.Y = t;
		}
		X(t, i, n) {
			this.Y.forEach((s) => {
				s.X(t, i, n);
			});
		}
	};
	H = class {
		X(t, i, n) {
			t.useBitmapCoordinateSpace((t$1) => this.K(t$1, i, n));
		}
	};
	$ = class extends H {
		constructor() {
			super(...arguments), this.G = null;
		}
		J(t) {
			this.G = t;
		}
		K({ context: t, horizontalPixelRatio: i, verticalPixelRatio: n }) {
			if (null === this.G || null === this.G.tt) return;
			const s = this.G.tt, e$1 = this.G, r$1 = Math.max(1, Math.floor(i)) % 2 / 2, h$1 = (h$2) => {
				t.beginPath();
				for (let l$1 = s.to - 1; l$1 >= s.from; --l$1) {
					const s$1 = e$1.it[l$1], a$1 = Math.round(s$1.nt * i) + r$1, o$1 = s$1.st * n, _$1 = h$2 * n + r$1;
					t.moveTo(a$1, o$1), t.arc(a$1, o$1, _$1, 0, 2 * Math.PI);
				}
				t.fill();
			};
			e$1.et > 0 && (t.fillStyle = e$1.rt, h$1(e$1.ht + e$1.et)), t.fillStyle = e$1.lt, h$1(e$1.ht);
		}
	};
	q = {
		from: 0,
		to: 1
	};
	Y = class {
		constructor(t, i) {
			this.ut = new j(), this.ct = [], this.dt = [], this.ft = !0, this.F = t, this.vt = i, this.ut.Z(this.ct);
		}
		bt(t) {
			const i = this.F.wt();
			i.length !== this.ct.length && (this.dt = i.map(U), this.ct = this.dt.map((t$1) => {
				const i$1 = new $();
				return i$1.J(t$1), i$1;
			}), this.ut.Z(this.ct)), this.ft = !0;
		}
		gt() {
			return this.ft && (this.Mt(), this.ft = !1), this.ut;
		}
		Mt() {
			const t = 2 === this.vt.W().mode, i = this.F.wt(), n = this.vt.xt(), s = this.F.St();
			i.forEach((i$1, e$1) => {
				var r$1;
				const h$1 = this.dt[e$1], l$1 = i$1.kt(n);
				if (t || null === l$1 || !i$1.yt()) return void (h$1.tt = null);
				const a$1 = b(i$1.Ct());
				h$1.lt = l$1.Tt, h$1.ht = l$1.ht, h$1.et = l$1.Pt, h$1.it[0]._t = l$1._t, h$1.it[0].st = i$1.Dt().Rt(l$1._t, a$1.Vt), h$1.rt = null !== (r$1 = l$1.Ot) && void 0 !== r$1 ? r$1 : this.F.Bt(h$1.it[0].st / i$1.Dt().At()), h$1.it[0].ot = n, h$1.it[0].nt = s.It(n), h$1.tt = q;
			});
		}
	};
	Z = class extends H {
		constructor(t) {
			super(), this.zt = t;
		}
		K({ context: t, bitmapSize: i, horizontalPixelRatio: n, verticalPixelRatio: s }) {
			if (null === this.zt) return;
			const e$1 = this.zt.Lt.yt, r$1 = this.zt.Et.yt;
			if (!e$1 && !r$1) return;
			const h$1 = Math.round(this.zt.nt * n), l$1 = Math.round(this.zt.st * s);
			t.lineCap = "butt", e$1 && h$1 >= 0 && (t.lineWidth = Math.floor(this.zt.Lt.et * n), t.strokeStyle = this.zt.Lt.V, t.fillStyle = this.zt.Lt.V, f(t, this.zt.Lt.Nt), function(t$1, i$1, n$1, s$1) {
				t$1.beginPath();
				const e$2 = t$1.lineWidth % 2 ? .5 : 0;
				t$1.moveTo(i$1 + e$2, n$1), t$1.lineTo(i$1 + e$2, s$1), t$1.stroke();
			}(t, h$1, 0, i.height)), r$1 && l$1 >= 0 && (t.lineWidth = Math.floor(this.zt.Et.et * s), t.strokeStyle = this.zt.Et.V, t.fillStyle = this.zt.Et.V, f(t, this.zt.Et.Nt), v(t, l$1, 0, i.width));
		}
	};
	X = class {
		constructor(t) {
			this.ft = !0, this.Ft = {
				Lt: {
					et: 1,
					Nt: 0,
					V: "",
					yt: !1
				},
				Et: {
					et: 1,
					Nt: 0,
					V: "",
					yt: !1
				},
				nt: 0,
				st: 0
			}, this.Wt = new Z(this.Ft), this.jt = t;
		}
		bt() {
			this.ft = !0;
		}
		gt() {
			return this.ft && (this.Mt(), this.ft = !1), this.Wt;
		}
		Mt() {
			const t = this.jt.yt(), i = b(this.jt.Ht()), n = i.$t().W().crosshair, s = this.Ft;
			if (2 === n.mode) return s.Et.yt = !1, void (s.Lt.yt = !1);
			s.Et.yt = t && this.jt.Ut(i), s.Lt.yt = t && this.jt.qt(), s.Et.et = n.horzLine.width, s.Et.Nt = n.horzLine.style, s.Et.V = n.horzLine.color, s.Lt.et = n.vertLine.width, s.Lt.Nt = n.vertLine.style, s.Lt.V = n.vertLine.color, s.nt = this.jt.Yt(), s.st = this.jt.Zt();
		}
	};
	it = class {
		constructor(t, i) {
			this.J(t, i);
		}
		J(t, i) {
			this.zt = t, this.Xt = i;
		}
		At(t, i) {
			return this.zt.yt ? t.P + t.L + t.B : 0;
		}
		X(t, i, n, s) {
			if (!this.zt.yt || 0 === this.zt.Kt.length) return;
			const e$1 = this.zt.V, r$1 = this.Xt.t, h$1 = t.useBitmapCoordinateSpace((t$1) => {
				const h$2 = t$1.context;
				h$2.font = i.R;
				const l$1 = this.Gt(t$1, i, n, s), a$1 = l$1.Jt;
				return l$1.Qt ? Q(h$2, a$1.ti, a$1.ii, a$1.ni, a$1.si, r$1, a$1.ei, [
					a$1.ht,
					0,
					0,
					a$1.ht
				], r$1) : Q(h$2, a$1.ri, a$1.ii, a$1.ni, a$1.si, r$1, a$1.ei, [
					0,
					a$1.ht,
					a$1.ht,
					0
				], r$1), this.zt.hi && (h$2.fillStyle = e$1, h$2.fillRect(a$1.ri, a$1.li, a$1.ai - a$1.ri, a$1.oi)), this.zt._i && (h$2.fillStyle = i.O, h$2.fillRect(l$1.Qt ? a$1.ui - a$1.ei : 0, a$1.ii, a$1.ei, a$1.ci - a$1.ii)), l$1;
			});
			t.useMediaCoordinateSpace(({ context: t$1 }) => {
				const n$1 = h$1.di;
				t$1.font = i.R, t$1.textAlign = h$1.Qt ? "right" : "left", t$1.textBaseline = "middle", t$1.fillStyle = e$1, t$1.fillText(this.zt.Kt, n$1.fi, (n$1.ii + n$1.ci) / 2 + n$1.pi);
			});
		}
		Gt(t, i, n, s) {
			var e$1;
			const { context: r$1, bitmapSize: h$1, mediaSize: l$1, horizontalPixelRatio: a$1, verticalPixelRatio: o$1 } = t, _$1 = this.zt.hi || !this.zt.mi ? i.T : 0, u$1 = this.zt.bi ? i.C : 0, c$1 = i.L + this.Xt.wi, d$1 = i.B + this.Xt.gi, f$1 = i.A, v$1 = i.I, p$1 = this.zt.Kt, m$1 = i.P, b$1 = n.Mi(r$1, p$1), w$1 = Math.ceil(n.xi(r$1, p$1)), g$1 = m$1 + c$1 + d$1, M$1 = i.C + f$1 + v$1 + w$1 + _$1, x$1 = Math.max(1, Math.floor(o$1));
			let S$1 = Math.round(g$1 * o$1);
			S$1 % 2 != x$1 % 2 && (S$1 += 1);
			const k$1 = u$1 > 0 ? Math.max(1, Math.floor(u$1 * a$1)) : 0, y$1 = Math.round(M$1 * a$1), C$1 = Math.round(_$1 * a$1), T$1 = null !== (e$1 = this.Xt.Si) && void 0 !== e$1 ? e$1 : this.Xt.ki, P$1 = Math.round(T$1 * o$1) - Math.floor(.5 * o$1), R$1 = Math.floor(P$1 + x$1 / 2 - S$1 / 2), D$1 = R$1 + S$1, V$1 = "right" === s, O$1 = V$1 ? l$1.width - u$1 : u$1, B$1 = V$1 ? h$1.width - k$1 : k$1;
			let A$1, I$1, z$1;
			return V$1 ? (A$1 = B$1 - y$1, I$1 = B$1 - C$1, z$1 = O$1 - _$1 - f$1 - u$1) : (A$1 = B$1 + y$1, I$1 = B$1 + C$1, z$1 = O$1 + _$1 + f$1), {
				Qt: V$1,
				Jt: {
					ii: R$1,
					li: P$1,
					ci: D$1,
					ni: y$1,
					si: S$1,
					ht: 2 * a$1,
					ei: k$1,
					ti: A$1,
					ri: B$1,
					ai: I$1,
					oi: x$1,
					ui: h$1.width
				},
				di: {
					ii: R$1 / o$1,
					ci: D$1 / o$1,
					fi: z$1,
					pi: b$1
				}
			};
		}
	};
	nt = class {
		constructor(t) {
			this.yi = {
				ki: 0,
				t: "#000",
				gi: 0,
				wi: 0
			}, this.Ci = {
				Kt: "",
				yt: !1,
				hi: !0,
				mi: !1,
				Ot: "",
				V: "#FFF",
				_i: !1,
				bi: !1
			}, this.Ti = {
				Kt: "",
				yt: !1,
				hi: !1,
				mi: !0,
				Ot: "",
				V: "#FFF",
				_i: !0,
				bi: !0
			}, this.ft = !0, this.Pi = new (t || it)(this.Ci, this.yi), this.Ri = new (t || it)(this.Ti, this.yi);
		}
		Kt() {
			return this.Di(), this.Ci.Kt;
		}
		ki() {
			return this.Di(), this.yi.ki;
		}
		bt() {
			this.ft = !0;
		}
		At(t, i = !1) {
			return Math.max(this.Pi.At(t, i), this.Ri.At(t, i));
		}
		Vi() {
			return this.yi.Si || 0;
		}
		Oi(t) {
			this.yi.Si = t;
		}
		Bi() {
			return this.Di(), this.Ci.yt || this.Ti.yt;
		}
		Ai() {
			return this.Di(), this.Ci.yt;
		}
		gt(t) {
			return this.Di(), this.Ci.hi = this.Ci.hi && t.W().ticksVisible, this.Ti.hi = this.Ti.hi && t.W().ticksVisible, this.Pi.J(this.Ci, this.yi), this.Ri.J(this.Ti, this.yi), this.Pi;
		}
		Ii() {
			return this.Di(), this.Pi.J(this.Ci, this.yi), this.Ri.J(this.Ti, this.yi), this.Ri;
		}
		Di() {
			this.ft && (this.Ci.hi = !0, this.Ti.hi = !1, this.zi(this.Ci, this.Ti, this.yi));
		}
	};
	st = class extends nt {
		constructor(t, i, n) {
			super(), this.jt = t, this.Li = i, this.Ei = n;
		}
		zi(t, i, n) {
			if (t.yt = !1, 2 === this.jt.W().mode) return;
			const s = this.jt.W().horzLine;
			if (!s.labelVisible) return;
			const e$1 = this.Li.Ct();
			if (!this.jt.yt() || this.Li.Ni() || null === e$1) return;
			const r$1 = R(s.labelBackgroundColor);
			n.t = r$1.t, t.V = r$1.i;
			const h$1 = 2 / 12 * this.Li.P();
			n.wi = h$1, n.gi = h$1;
			const l$1 = this.Ei(this.Li);
			n.ki = l$1.ki, t.Kt = this.Li.Fi(l$1._t, e$1), t.yt = !0;
		}
	};
	et = /[1-9]/g;
	rt = class {
		constructor() {
			this.zt = null;
		}
		J(t) {
			this.zt = t;
		}
		X(t, i) {
			if (null === this.zt || !1 === this.zt.yt || 0 === this.zt.Kt.length) return;
			const n = t.useMediaCoordinateSpace(({ context: t$1 }) => (t$1.font = i.R, Math.round(i.Wi.xi(t$1, b(this.zt).Kt, et))));
			if (n <= 0) return;
			const s = i.ji, e$1 = n + 2 * s, r$1 = e$1 / 2, h$1 = this.zt.Hi;
			let l$1 = this.zt.ki, a$1 = Math.floor(l$1 - r$1) + .5;
			a$1 < 0 ? (l$1 += Math.abs(0 - a$1), a$1 = Math.floor(l$1 - r$1) + .5) : a$1 + e$1 > h$1 && (l$1 -= Math.abs(h$1 - (a$1 + e$1)), a$1 = Math.floor(l$1 - r$1) + .5);
			const o$1 = a$1 + e$1, _$1 = Math.ceil(0 + i.C + i.T + i.L + i.P + i.B);
			t.useBitmapCoordinateSpace(({ context: t$1, horizontalPixelRatio: n$1, verticalPixelRatio: s$1 }) => {
				const e$2 = b(this.zt);
				t$1.fillStyle = e$2.t;
				const r$2 = Math.round(a$1 * n$1), h$2 = Math.round(0 * s$1), l$2 = Math.round(o$1 * n$1), u$1 = Math.round(_$1 * s$1), c$1 = Math.round(2 * n$1);
				if (t$1.beginPath(), t$1.moveTo(r$2, h$2), t$1.lineTo(r$2, u$1 - c$1), t$1.arcTo(r$2, u$1, r$2 + c$1, u$1, c$1), t$1.lineTo(l$2 - c$1, u$1), t$1.arcTo(l$2, u$1, l$2, u$1 - c$1, c$1), t$1.lineTo(l$2, h$2), t$1.fill(), e$2.hi) {
					const r$3 = Math.round(e$2.ki * n$1), l$3 = h$2, a$2 = Math.round((l$3 + i.T) * s$1);
					t$1.fillStyle = e$2.V;
					const o$2 = Math.max(1, Math.floor(n$1)), _$2 = Math.floor(.5 * n$1);
					t$1.fillRect(r$3 - _$2, l$3, o$2, a$2 - l$3);
				}
			}), t.useMediaCoordinateSpace(({ context: t$1 }) => {
				const n$1 = b(this.zt), e$2 = 0 + i.C + i.T + i.L + i.P / 2;
				t$1.font = i.R, t$1.textAlign = "left", t$1.textBaseline = "middle", t$1.fillStyle = n$1.V;
				const r$2 = i.Wi.Mi(t$1, "Apr0");
				t$1.translate(a$1 + s, e$2 + r$2), t$1.fillText(n$1.Kt, 0, 0);
			});
		}
	};
	ht = class {
		constructor(t, i, n) {
			this.ft = !0, this.Wt = new rt(), this.Ft = {
				yt: !1,
				t: "#4c525e",
				V: "white",
				Kt: "",
				Hi: 0,
				ki: NaN,
				hi: !0
			}, this.vt = t, this.$i = i, this.Ei = n;
		}
		bt() {
			this.ft = !0;
		}
		gt() {
			return this.ft && (this.Mt(), this.ft = !1), this.Wt.J(this.Ft), this.Wt;
		}
		Mt() {
			const t = this.Ft;
			if (t.yt = !1, 2 === this.vt.W().mode) return;
			const i = this.vt.W().vertLine;
			if (!i.labelVisible) return;
			const n = this.$i.St();
			if (n.Ni()) return;
			t.Hi = n.Hi();
			const s = this.Ei();
			if (null === s) return;
			t.ki = s.ki;
			const e$1 = n.Ui(this.vt.xt());
			t.Kt = n.qi(b(e$1)), t.yt = !0;
			const r$1 = R(i.labelBackgroundColor);
			t.t = r$1.t, t.V = r$1.i, t.hi = n.W().ticksVisible;
		}
	};
	lt = class {
		constructor() {
			this.Yi = null, this.Zi = 0;
		}
		Xi() {
			return this.Zi;
		}
		Ki(t) {
			this.Zi = t;
		}
		Dt() {
			return this.Yi;
		}
		Gi(t) {
			this.Yi = t;
		}
		Ji(t) {
			return [];
		}
		Qi() {
			return [];
		}
		yt() {
			return !0;
		}
	};
	(function(t) {
		t[t.Normal = 0] = "Normal", t[t.Magnet = 1] = "Magnet", t[t.Hidden = 2] = "Hidden";
	})(at || (at = {}));
	ot = class extends lt {
		constructor(t, i) {
			super(), this.tn = null, this.nn = NaN, this.sn = 0, this.en = !0, this.rn = /* @__PURE__ */ new Map(), this.hn = !1, this.ln = NaN, this.an = NaN, this._n = NaN, this.un = NaN, this.$i = t, this.cn = i, this.dn = new Y(t, this);
			this.fn = ((t$1, i$1) => (n$1) => {
				const s = i$1(), e$1 = t$1();
				if (n$1 === b(this.tn).vn()) return {
					_t: e$1,
					ki: s
				};
				{
					const t$2 = b(n$1.Ct());
					return {
						_t: n$1.pn(s, t$2),
						ki: s
					};
				}
			})(() => this.nn, () => this.an);
			const n = ((t$1, i$1) => () => {
				const n$1 = this.$i.St().mn(t$1()), s = i$1();
				return n$1 && Number.isFinite(s) ? {
					ot: n$1,
					ki: s
				} : null;
			})(() => this.sn, () => this.Yt());
			this.bn = new ht(this, t, n), this.wn = new X(this);
		}
		W() {
			return this.cn;
		}
		gn(t, i) {
			this._n = t, this.un = i;
		}
		Mn() {
			this._n = NaN, this.un = NaN;
		}
		xn() {
			return this._n;
		}
		Sn() {
			return this.un;
		}
		kn(t, i, n) {
			this.hn || (this.hn = !0), this.en = !0, this.yn(t, i, n);
		}
		xt() {
			return this.sn;
		}
		Yt() {
			return this.ln;
		}
		Zt() {
			return this.an;
		}
		yt() {
			return this.en;
		}
		Cn() {
			this.en = !1, this.Tn(), this.nn = NaN, this.ln = NaN, this.an = NaN, this.tn = null, this.Mn();
		}
		Pn(t) {
			return null !== this.tn ? [this.wn, this.dn] : [];
		}
		Ut(t) {
			return t === this.tn && this.cn.horzLine.visible;
		}
		qt() {
			return this.cn.vertLine.visible;
		}
		Rn(t, i) {
			this.en && this.tn === t || this.rn.clear();
			const n = [];
			return this.tn === t && n.push(this.Dn(this.rn, i, this.fn)), n;
		}
		Qi() {
			return this.en ? [this.bn] : [];
		}
		Ht() {
			return this.tn;
		}
		Vn() {
			this.wn.bt(), this.rn.forEach((t) => t.bt()), this.bn.bt(), this.dn.bt();
		}
		On(t) {
			return t && !t.vn().Ni() ? t.vn() : null;
		}
		yn(t, i, n) {
			this.Bn(t, i, n) && this.Vn();
		}
		Bn(t, i, n) {
			const s = this.ln, e$1 = this.an, r$1 = this.nn, h$1 = this.sn, l$1 = this.tn, a$1 = this.On(n);
			this.sn = t, this.ln = isNaN(t) ? NaN : this.$i.St().It(t), this.tn = n;
			const o$1 = null !== a$1 ? a$1.Ct() : null;
			return null !== a$1 && null !== o$1 ? (this.nn = i, this.an = a$1.Rt(i, o$1)) : (this.nn = NaN, this.an = NaN), s !== this.ln || e$1 !== this.an || h$1 !== this.sn || r$1 !== this.nn || l$1 !== this.tn;
		}
		Tn() {
			const t = this.$i.wt().map((t$1) => t$1.In().An()).filter(L), i = 0 === t.length ? null : Math.max(...t);
			this.sn = null !== i ? i : NaN;
		}
		Dn(t, i, n) {
			let s = t.get(i);
			return void 0 === s && (s = new st(this, i, n), t.set(i, s)), s;
		}
	};
	ut = class ut {
		constructor(t) {
			this.zn = /* @__PURE__ */ new Map(), this.Ln = [], this.En = t;
		}
		Nn(t, i) {
			const n = function(t$1, i$1) {
				return void 0 === t$1 ? i$1 : {
					Fn: Math.max(t$1.Fn, i$1.Fn),
					Wn: t$1.Wn || i$1.Wn
				};
			}(this.zn.get(t), i);
			this.zn.set(t, n);
		}
		jn() {
			return this.En;
		}
		Hn(t) {
			const i = this.zn.get(t);
			return void 0 === i ? { Fn: this.En } : {
				Fn: Math.max(this.En, i.Fn),
				Wn: i.Wn
			};
		}
		$n() {
			this.Un(), this.Ln = [{ qn: 0 }];
		}
		Yn(t) {
			this.Un(), this.Ln = [{
				qn: 1,
				Vt: t
			}];
		}
		Zn(t) {
			this.Xn(), this.Ln.push({
				qn: 5,
				Vt: t
			});
		}
		Un() {
			this.Xn(), this.Ln.push({ qn: 6 });
		}
		Kn() {
			this.Un(), this.Ln = [{ qn: 4 }];
		}
		Gn(t) {
			this.Un(), this.Ln.push({
				qn: 2,
				Vt: t
			});
		}
		Jn(t) {
			this.Un(), this.Ln.push({
				qn: 3,
				Vt: t
			});
		}
		Qn() {
			return this.Ln;
		}
		ts(t) {
			for (const i of t.Ln) this.ns(i);
			this.En = Math.max(this.En, t.En), t.zn.forEach((t$1, i) => {
				this.Nn(i, t$1);
			});
		}
		static ss() {
			return new ut(2);
		}
		static es() {
			return new ut(3);
		}
		ns(t) {
			switch (t.qn) {
				case 0:
					this.$n();
					break;
				case 1:
					this.Yn(t.Vt);
					break;
				case 2:
					this.Gn(t.Vt);
					break;
				case 3:
					this.Jn(t.Vt);
					break;
				case 4:
					this.Kn();
					break;
				case 5:
					this.Zn(t.Vt);
					break;
				case 6: this.Xn();
			}
		}
		Xn() {
			const t = this.Ln.findIndex((t$1) => 5 === t$1.qn);
			-1 !== t && this.Ln.splice(t, 1);
		}
	};
	ct = ".";
	ft = class {
		constructor(t, i) {
			if (i || (i = 1), O(t) && B(t) || (t = 100), t < 0) throw new TypeError("invalid base");
			this.Li = t, this.rs = i, this.hs();
		}
		format(t) {
			const i = t < 0 ? "−" : "";
			return t = Math.abs(t), i + this.ls(t);
		}
		hs() {
			if (this._s = 0, this.Li > 0 && this.rs > 0) {
				let t = this.Li;
				for (; t > 1;) t /= 10, this._s++;
			}
		}
		ls(t) {
			const i = this.Li / this.rs;
			let n = Math.floor(t), s = "";
			const e$1 = void 0 !== this._s ? this._s : NaN;
			if (i > 1) {
				let r$1 = +(Math.round(t * i) - n * i).toFixed(this._s);
				r$1 >= i && (r$1 -= i, n += 1), s = ct + dt(+r$1.toFixed(this._s) * this.rs, e$1);
			} else n = Math.round(n * i) / i, e$1 > 0 && (s = ct + dt(0, e$1));
			return n.toFixed(0) + s;
		}
	};
	vt = class extends ft {
		constructor(t = 100) {
			super(t);
		}
		format(t) {
			return `${super.format(t)}%`;
		}
	};
	pt = class {
		constructor(t) {
			this.us = t;
		}
		format(t) {
			let i = "";
			return t < 0 && (i = "-", t = -t), t < 995 ? i + this.cs(t) : t < 999995 ? i + this.cs(t / 1e3) + "K" : t < 999999995 ? (t = 1e3 * Math.round(t / 1e3), i + this.cs(t / 1e6) + "M") : (t = 1e6 * Math.round(t / 1e6), i + this.cs(t / 1e9) + "B");
		}
		cs(t) {
			let i;
			const n = Math.pow(10, this.us);
			return i = (t = Math.round(t * n) / n) >= 1e-15 && t < 1 ? t.toFixed(this.us).replace(/\.?0+$/, "") : String(t), i.replace(/(\.[1-9]*)0+$/, (t$1, i$1) => i$1);
		}
	};
	bt = 6;
	St = class extends H {
		constructor() {
			super(...arguments), this.G = null;
		}
		J(t) {
			this.G = t;
		}
		K(t) {
			var i;
			if (null === this.G) return;
			const { it: n, tt: s, ds: e$1, et: r$1, Nt: h$1, fs: l$1 } = this.G, a$1 = null !== (i = this.G.vs) && void 0 !== i ? i : this.G.ps ? 0 : t.mediaSize.height;
			if (null === s) return;
			const o$1 = t.context;
			o$1.lineCap = "butt", o$1.lineJoin = "round", o$1.lineWidth = r$1, f(o$1, h$1), o$1.lineWidth = 1, mt(t, n, l$1, s, e$1, this.bs.bind(this), xt.bind(null, a$1));
		}
	};
	Tt = class {
		ws(t, i) {
			const n = this.gs, { Ms: s, xs: e$1, Ss: r$1, ks: h$1, ys: l$1, vs: a$1 } = i;
			if (void 0 === this.Cs || void 0 === n || n.Ms !== s || n.xs !== e$1 || n.Ss !== r$1 || n.ks !== h$1 || n.vs !== a$1 || n.ys !== l$1) {
				const n$1 = t.context.createLinearGradient(0, 0, 0, l$1);
				if (n$1.addColorStop(0, s), null != a$1) {
					const i$1 = kt(a$1 * t.verticalPixelRatio / l$1, 0, 1);
					n$1.addColorStop(i$1, e$1), n$1.addColorStop(i$1, r$1);
				}
				n$1.addColorStop(1, h$1), this.Cs = n$1, this.gs = i;
			}
			return this.Cs;
		}
	};
	Pt = class extends St {
		constructor() {
			super(...arguments), this.Ts = new Tt();
		}
		bs(t, i) {
			return this.Ts.ws(t, {
				Ms: i.Ps,
				xs: "",
				Ss: "",
				ks: i.Rs,
				ys: t.bitmapSize.height
			});
		}
	};
	Dt = class extends H {
		constructor() {
			super(...arguments), this.G = null;
		}
		J(t) {
			this.G = t;
		}
		K(t) {
			if (null === this.G) return;
			const { it: i, tt: n, ds: s, fs: e$1, et: r$1, Nt: h$1, Ds: l$1 } = this.G;
			if (null === n) return;
			const a$1 = t.context;
			a$1.lineCap = "butt", a$1.lineWidth = r$1 * t.verticalPixelRatio, f(a$1, h$1), a$1.lineJoin = "round";
			const o$1 = this.Vs.bind(this);
			void 0 !== e$1 && mt(t, i, e$1, n, s, o$1, Rt), l$1 && function(t$1, i$1, n$1, s$1, e$2) {
				const { horizontalPixelRatio: r$2, verticalPixelRatio: h$2, context: l$2 } = t$1;
				let a$2 = null;
				const o$2 = Math.max(1, Math.floor(r$2)) % 2 / 2, _$1 = n$1 * h$2 + o$2;
				for (let n$2 = s$1.to - 1; n$2 >= s$1.from; --n$2) {
					const s$2 = i$1[n$2];
					if (s$2) {
						const i$2 = e$2(t$1, s$2);
						i$2 !== a$2 && (l$2.beginPath(), null !== a$2 && l$2.fill(), l$2.fillStyle = i$2, a$2 = i$2);
						const n$3 = Math.round(s$2.nt * r$2) + o$2, u$1 = s$2.st * h$2;
						l$2.moveTo(n$3, u$1), l$2.arc(n$3, u$1, _$1, 0, 2 * Math.PI);
					}
				}
				l$2.fill();
			}(t, i, l$1, n, o$1);
		}
	};
	Vt = class extends Dt {
		Vs(t, i) {
			return i.lt;
		}
	};
	Bt = Ot.bind(null, !0), At = Ot.bind(null, !1);
	Et = class {
		constructor(t, i, n) {
			this.Bs = !0, this.As = !0, this.Is = !0, this.zs = [], this.Ls = null, this.Es = t, this.Ns = i, this.Fs = n;
		}
		bt(t) {
			this.Bs = !0, "data" === t && (this.As = !0), "options" === t && (this.Is = !0);
		}
		gt() {
			return this.Es.yt() ? (this.Ws(), null === this.Ls ? null : this.js) : null;
		}
		Hs() {
			this.zs = this.zs.map((t) => Object.assign(Object.assign({}, t), this.Es.Us().$s(t.ot)));
		}
		qs() {
			this.Ls = null;
		}
		Ws() {
			this.As && (this.Ys(), this.As = !1), this.Is && (this.Hs(), this.Is = !1), this.Bs && (this.Zs(), this.Bs = !1);
		}
		Zs() {
			const t = this.Es.Dt(), i = this.Ns.St();
			if (this.qs(), i.Ni() || t.Ni()) return;
			const n = i.Xs();
			if (null === n) return;
			if (0 === this.Es.In().Ks()) return;
			const s = this.Es.Ct();
			null !== s && (this.Ls = Lt(this.zs, n, this.Fs), this.Gs(t, i, s.Vt), this.Js());
		}
	};
	Nt = class extends Et {
		constructor(t, i) {
			super(t, i, !0);
		}
		Gs(t, i, n) {
			i.Qs(this.zs, E(this.Ls)), t.te(this.zs, n, E(this.Ls));
		}
		ie(t, i) {
			return {
				ot: t,
				_t: i,
				nt: NaN,
				st: NaN
			};
		}
		Ys() {
			const t = this.Es.Us();
			this.zs = this.Es.In().ne().map((i) => {
				const n = i.Vt[3];
				return this.se(i.ee, n, t);
			});
		}
	};
	Ft = class extends Nt {
		constructor(t, i) {
			super(t, i), this.js = new j(), this.re = new Pt(), this.he = new Vt(), this.js.Z([this.re, this.he]);
		}
		se(t, i, n) {
			return Object.assign(Object.assign({}, this.ie(t, i)), n.$s(t));
		}
		Js() {
			const t = this.Es.W();
			this.re.J({
				fs: t.lineType,
				it: this.zs,
				Nt: t.lineStyle,
				et: t.lineWidth,
				vs: null,
				ps: t.invertFilledArea,
				tt: this.Ls,
				ds: this.Ns.St().le()
			}), this.he.J({
				fs: t.lineVisible ? t.lineType : void 0,
				it: this.zs,
				Nt: t.lineStyle,
				et: t.lineWidth,
				tt: this.Ls,
				ds: this.Ns.St().le(),
				Ds: t.pointMarkersVisible ? t.pointMarkersRadius || t.lineWidth / 2 + 2 : void 0
			});
		}
	};
	Wt = class extends H {
		constructor() {
			super(...arguments), this.zt = null, this.ae = 0, this.oe = 0;
		}
		J(t) {
			this.zt = t;
		}
		K({ context: t, horizontalPixelRatio: i, verticalPixelRatio: n }) {
			if (null === this.zt || 0 === this.zt.In.length || null === this.zt.tt) return;
			if (this.ae = this._e(i), this.ae >= 2) Math.max(1, Math.floor(i)) % 2 != this.ae % 2 && this.ae--;
			this.oe = this.zt.ue ? Math.min(this.ae, Math.floor(i)) : this.ae;
			let s = null;
			const e$1 = this.oe <= this.ae && this.zt.le >= Math.floor(1.5 * i);
			for (let r$1 = this.zt.tt.from; r$1 < this.zt.tt.to; ++r$1) {
				const h$1 = this.zt.In[r$1];
				s !== h$1.ce && (t.fillStyle = h$1.ce, s = h$1.ce);
				const l$1 = Math.floor(.5 * this.oe), a$1 = Math.round(h$1.nt * i), o$1 = a$1 - l$1, _$1 = this.oe, u$1 = o$1 + _$1 - 1, c$1 = Math.min(h$1.de, h$1.fe), d$1 = Math.max(h$1.de, h$1.fe), f$1 = Math.round(c$1 * n) - l$1, v$1 = Math.round(d$1 * n) + l$1, p$1 = Math.max(v$1 - f$1, this.oe);
				t.fillRect(o$1, f$1, _$1, p$1);
				const m$1 = Math.ceil(1.5 * this.ae);
				if (e$1) {
					if (this.zt.ve) {
						const i$2 = a$1 - m$1;
						let s$2 = Math.max(f$1, Math.round(h$1.pe * n) - l$1), e$3 = s$2 + _$1 - 1;
						e$3 > f$1 + p$1 - 1 && (e$3 = f$1 + p$1 - 1, s$2 = e$3 - _$1 + 1), t.fillRect(i$2, s$2, o$1 - i$2, e$3 - s$2 + 1);
					}
					const i$1 = a$1 + m$1;
					let s$1 = Math.max(f$1, Math.round(h$1.me * n) - l$1), e$2 = s$1 + _$1 - 1;
					e$2 > f$1 + p$1 - 1 && (e$2 = f$1 + p$1 - 1, s$1 = e$2 - _$1 + 1), t.fillRect(u$1 + 1, s$1, i$1 - u$1, e$2 - s$1 + 1);
				}
			}
		}
		_e(t) {
			const i = Math.floor(t);
			return Math.max(i, Math.floor(function(t$1, i$1) {
				return Math.floor(.3 * t$1 * i$1);
			}(b(this.zt).le, t)));
		}
	};
	jt = class extends Et {
		constructor(t, i) {
			super(t, i, !1);
		}
		Gs(t, i, n) {
			i.Qs(this.zs, E(this.Ls)), t.be(this.zs, n, E(this.Ls));
		}
		we(t, i, n) {
			return {
				ot: t,
				ge: i.Vt[0],
				Me: i.Vt[1],
				xe: i.Vt[2],
				Se: i.Vt[3],
				nt: NaN,
				pe: NaN,
				de: NaN,
				fe: NaN,
				me: NaN
			};
		}
		Ys() {
			const t = this.Es.Us();
			this.zs = this.Es.In().ne().map((i) => this.se(i.ee, i, t));
		}
	};
	Ht = class extends jt {
		constructor() {
			super(...arguments), this.js = new Wt();
		}
		se(t, i, n) {
			return Object.assign(Object.assign({}, this.we(t, i, n)), n.$s(t));
		}
		Js() {
			const t = this.Es.W();
			this.js.J({
				In: this.zs,
				le: this.Ns.St().le(),
				ve: t.openVisible,
				ue: t.thinBars,
				tt: this.Ls
			});
		}
	};
	$t = class extends St {
		constructor() {
			super(...arguments), this.Ts = new Tt();
		}
		bs(t, i) {
			const n = this.G;
			return this.Ts.ws(t, {
				Ms: i.ke,
				xs: i.ye,
				Ss: i.Ce,
				ks: i.Te,
				ys: t.bitmapSize.height,
				vs: n.vs
			});
		}
	};
	Ut = class extends Dt {
		constructor() {
			super(...arguments), this.Pe = new Tt();
		}
		Vs(t, i) {
			const n = this.G;
			return this.Pe.ws(t, {
				Ms: i.Re,
				xs: i.Re,
				Ss: i.De,
				ks: i.De,
				ys: t.bitmapSize.height,
				vs: n.vs
			});
		}
	};
	qt = class extends Nt {
		constructor(t, i) {
			super(t, i), this.js = new j(), this.Ve = new $t(), this.Oe = new Ut(), this.js.Z([this.Ve, this.Oe]);
		}
		se(t, i, n) {
			return Object.assign(Object.assign({}, this.ie(t, i)), n.$s(t));
		}
		Js() {
			const t = this.Es.Ct();
			if (null === t) return;
			const i = this.Es.W(), n = this.Es.Dt().Rt(i.baseValue.price, t.Vt), s = this.Ns.St().le();
			this.Ve.J({
				it: this.zs,
				et: i.lineWidth,
				Nt: i.lineStyle,
				fs: i.lineType,
				vs: n,
				ps: !1,
				tt: this.Ls,
				ds: s
			}), this.Oe.J({
				it: this.zs,
				et: i.lineWidth,
				Nt: i.lineStyle,
				fs: i.lineVisible ? i.lineType : void 0,
				Ds: i.pointMarkersVisible ? i.pointMarkersRadius || i.lineWidth / 2 + 2 : void 0,
				vs: n,
				tt: this.Ls,
				ds: s
			});
		}
	};
	Yt = class extends H {
		constructor() {
			super(...arguments), this.zt = null, this.ae = 0;
		}
		J(t) {
			this.zt = t;
		}
		K(t) {
			if (null === this.zt || 0 === this.zt.In.length || null === this.zt.tt) return;
			const { horizontalPixelRatio: i } = t;
			if (this.ae = function(t$1, i$1) {
				if (t$1 >= 2.5 && t$1 <= 4) return Math.floor(3 * i$1);
				const n$1 = 1 - .2 * Math.atan(Math.max(4, t$1) - 4) / (.5 * Math.PI), s$1 = Math.floor(t$1 * n$1 * i$1), e$1 = Math.floor(t$1 * i$1), r$1 = Math.min(s$1, e$1);
				return Math.max(Math.floor(i$1), r$1);
			}(this.zt.le, i), this.ae >= 2) Math.floor(i) % 2 != this.ae % 2 && this.ae--;
			const n = this.zt.In;
			this.zt.Be && this.Ae(t, n, this.zt.tt), this.zt._i && this.Ie(t, n, this.zt.tt);
			const s = this.ze(i);
			(!this.zt._i || this.ae > 2 * s) && this.Le(t, n, this.zt.tt);
		}
		Ae(t, i, n) {
			if (null === this.zt) return;
			const { context: s, horizontalPixelRatio: e$1, verticalPixelRatio: r$1 } = t;
			let h$1 = "", l$1 = Math.min(Math.floor(e$1), Math.floor(this.zt.le * e$1));
			l$1 = Math.max(Math.floor(e$1), Math.min(l$1, this.ae));
			const a$1 = Math.floor(.5 * l$1);
			let o$1 = null;
			for (let t$1 = n.from; t$1 < n.to; t$1++) {
				const n$1 = i[t$1];
				n$1.Ee !== h$1 && (s.fillStyle = n$1.Ee, h$1 = n$1.Ee);
				const _$1 = Math.round(Math.min(n$1.pe, n$1.me) * r$1), u$1 = Math.round(Math.max(n$1.pe, n$1.me) * r$1), c$1 = Math.round(n$1.de * r$1), d$1 = Math.round(n$1.fe * r$1);
				let f$1 = Math.round(e$1 * n$1.nt) - a$1;
				const v$1 = f$1 + l$1 - 1;
				null !== o$1 && (f$1 = Math.max(o$1 + 1, f$1), f$1 = Math.min(f$1, v$1));
				const p$1 = v$1 - f$1 + 1;
				s.fillRect(f$1, c$1, p$1, _$1 - c$1), s.fillRect(f$1, u$1 + 1, p$1, d$1 - u$1), o$1 = v$1;
			}
		}
		ze(t) {
			let i = Math.floor(1 * t);
			this.ae <= 2 * i && (i = Math.floor(.5 * (this.ae - 1)));
			const n = Math.max(Math.floor(t), i);
			return this.ae <= 2 * n ? Math.max(Math.floor(t), Math.floor(1 * t)) : n;
		}
		Ie(t, i, n) {
			if (null === this.zt) return;
			const { context: s, horizontalPixelRatio: e$1, verticalPixelRatio: r$1 } = t;
			let h$1 = "";
			const l$1 = this.ze(e$1);
			let a$1 = null;
			for (let t$1 = n.from; t$1 < n.to; t$1++) {
				const n$1 = i[t$1];
				n$1.Ne !== h$1 && (s.fillStyle = n$1.Ne, h$1 = n$1.Ne);
				let o$1 = Math.round(n$1.nt * e$1) - Math.floor(.5 * this.ae);
				const _$1 = o$1 + this.ae - 1, u$1 = Math.round(Math.min(n$1.pe, n$1.me) * r$1), c$1 = Math.round(Math.max(n$1.pe, n$1.me) * r$1);
				if (null !== a$1 && (o$1 = Math.max(a$1 + 1, o$1), o$1 = Math.min(o$1, _$1)), this.zt.le * e$1 > 2 * l$1) K(s, o$1, u$1, _$1 - o$1 + 1, c$1 - u$1 + 1, l$1);
				else {
					const t$2 = _$1 - o$1 + 1;
					s.fillRect(o$1, u$1, t$2, c$1 - u$1 + 1);
				}
				a$1 = _$1;
			}
		}
		Le(t, i, n) {
			if (null === this.zt) return;
			const { context: s, horizontalPixelRatio: e$1, verticalPixelRatio: r$1 } = t;
			let h$1 = "";
			const l$1 = this.ze(e$1);
			for (let t$1 = n.from; t$1 < n.to; t$1++) {
				const n$1 = i[t$1];
				let a$1 = Math.round(Math.min(n$1.pe, n$1.me) * r$1), o$1 = Math.round(Math.max(n$1.pe, n$1.me) * r$1), _$1 = Math.round(n$1.nt * e$1) - Math.floor(.5 * this.ae), u$1 = _$1 + this.ae - 1;
				if (n$1.ce !== h$1) {
					const t$2 = n$1.ce;
					s.fillStyle = t$2, h$1 = t$2;
				}
				this.zt._i && (_$1 += l$1, a$1 += l$1, u$1 -= l$1, o$1 -= l$1), a$1 > o$1 || s.fillRect(_$1, a$1, u$1 - _$1 + 1, o$1 - a$1 + 1);
			}
		}
	};
	Zt = class extends jt {
		constructor() {
			super(...arguments), this.js = new Yt();
		}
		se(t, i, n) {
			return Object.assign(Object.assign({}, this.we(t, i, n)), n.$s(t));
		}
		Js() {
			const t = this.Es.W();
			this.js.J({
				In: this.zs,
				le: this.Ns.St().le(),
				Be: t.wickVisible,
				_i: t.borderVisible,
				tt: this.Ls
			});
		}
	};
	Xt = class {
		constructor(t, i) {
			this.Fe = t, this.Li = i;
		}
		X(t, i, n) {
			this.Fe.draw(t, this.Li, i, n);
		}
	};
	Kt = class extends Et {
		constructor(t, i, n) {
			super(t, i, !1), this.wn = n, this.js = new Xt(this.wn.renderer(), (i$1) => {
				const n$1 = t.Ct();
				return null === n$1 ? null : t.Dt().Rt(i$1, n$1.Vt);
			});
		}
		We(t) {
			return this.wn.priceValueBuilder(t);
		}
		je(t) {
			return this.wn.isWhitespace(t);
		}
		Ys() {
			const t = this.Es.Us();
			this.zs = this.Es.In().ne().map((i) => Object.assign(Object.assign({
				ot: i.ee,
				nt: NaN
			}, t.$s(i.ee)), { He: i.$e }));
		}
		Gs(t, i) {
			i.Qs(this.zs, E(this.Ls));
		}
		Js() {
			this.wn.update({
				bars: this.zs.map(Gt),
				barSpacing: this.Ns.St().le(),
				visibleRange: this.Ls
			}, this.Es.W());
		}
	};
	Jt = class extends H {
		constructor() {
			super(...arguments), this.zt = null, this.Ue = [];
		}
		J(t) {
			this.zt = t, this.Ue = [];
		}
		K({ context: t, horizontalPixelRatio: i, verticalPixelRatio: n }) {
			if (null === this.zt || 0 === this.zt.it.length || null === this.zt.tt) return;
			this.Ue.length || this.qe(i);
			const s = Math.max(1, Math.floor(n)), e$1 = Math.round(this.zt.Ye * n) - Math.floor(s / 2), r$1 = e$1 + s;
			for (let i$1 = this.zt.tt.from; i$1 < this.zt.tt.to; i$1++) {
				const h$1 = this.zt.it[i$1], l$1 = this.Ue[i$1 - this.zt.tt.from], a$1 = Math.round(h$1.st * n);
				let o$1, _$1;
				t.fillStyle = h$1.ce, a$1 <= e$1 ? (o$1 = a$1, _$1 = r$1) : (o$1 = e$1, _$1 = a$1 - Math.floor(s / 2) + s), t.fillRect(l$1.Os, o$1, l$1.ui - l$1.Os + 1, _$1 - o$1);
			}
		}
		qe(t) {
			if (null === this.zt || 0 === this.zt.it.length || null === this.zt.tt) return void (this.Ue = []);
			const i = Math.ceil(this.zt.le * t) <= 1 ? 0 : Math.max(1, Math.floor(t)), n = Math.round(this.zt.le * t) - i;
			this.Ue = new Array(this.zt.tt.to - this.zt.tt.from);
			for (let i$1 = this.zt.tt.from; i$1 < this.zt.tt.to; i$1++) {
				const s$1 = this.zt.it[i$1], e$1 = Math.round(s$1.nt * t);
				let r$1, h$1;
				if (n % 2) {
					const t$1 = (n - 1) / 2;
					r$1 = e$1 - t$1, h$1 = e$1 + t$1;
				} else {
					const t$1 = n / 2;
					r$1 = e$1 - t$1, h$1 = e$1 + t$1 - 1;
				}
				this.Ue[i$1 - this.zt.tt.from] = {
					Os: r$1,
					ui: h$1,
					Ze: e$1,
					Xe: s$1.nt * t,
					ot: s$1.ot
				};
			}
			for (let t$1 = this.zt.tt.from + 1; t$1 < this.zt.tt.to; t$1++) {
				const n$1 = this.Ue[t$1 - this.zt.tt.from], s$1 = this.Ue[t$1 - this.zt.tt.from - 1];
				n$1.ot === s$1.ot + 1 && n$1.Os - s$1.ui !== i + 1 && (s$1.Ze > s$1.Xe ? s$1.ui = n$1.Os - i - 1 : n$1.Os = s$1.ui + i + 1);
			}
			let s = Math.ceil(this.zt.le * t);
			for (let t$1 = this.zt.tt.from; t$1 < this.zt.tt.to; t$1++) {
				const i$1 = this.Ue[t$1 - this.zt.tt.from];
				i$1.ui < i$1.Os && (i$1.ui = i$1.Os);
				const n$1 = i$1.ui - i$1.Os + 1;
				s = Math.min(n$1, s);
			}
			if (i > 0 && s < 4) for (let t$1 = this.zt.tt.from; t$1 < this.zt.tt.to; t$1++) {
				const i$1 = this.Ue[t$1 - this.zt.tt.from];
				i$1.ui - i$1.Os + 1 > s && (i$1.Ze > i$1.Xe ? i$1.ui -= 1 : i$1.Os += 1);
			}
		}
	};
	Qt = class extends Nt {
		constructor() {
			super(...arguments), this.js = new Jt();
		}
		se(t, i, n) {
			return Object.assign(Object.assign({}, this.ie(t, i)), n.$s(t));
		}
		Js() {
			const t = {
				it: this.zs,
				le: this.Ns.St().le(),
				tt: this.Ls,
				Ye: this.Es.Dt().Rt(this.Es.W().base, b(this.Es.Ct()).Vt)
			};
			this.js.J(t);
		}
	};
	ti = class extends Nt {
		constructor() {
			super(...arguments), this.js = new Vt();
		}
		se(t, i, n) {
			return Object.assign(Object.assign({}, this.ie(t, i)), n.$s(t));
		}
		Js() {
			const t = this.Es.W(), i = {
				it: this.zs,
				Nt: t.lineStyle,
				fs: t.lineVisible ? t.lineType : void 0,
				et: t.lineWidth,
				Ds: t.pointMarkersVisible ? t.pointMarkersRadius || t.lineWidth / 2 + 2 : void 0,
				tt: this.Ls,
				ds: this.Ns.St().le()
			};
			this.js.J(i);
		}
	};
	ii = /[2-9]/g;
	ni = class {
		constructor(t = 50) {
			this.Ke = 0, this.Ge = 1, this.Je = 1, this.Qe = {}, this.tr = /* @__PURE__ */ new Map(), this.ir = t;
		}
		nr() {
			this.Ke = 0, this.tr.clear(), this.Ge = 1, this.Je = 1, this.Qe = {};
		}
		xi(t, i, n) {
			return this.sr(t, i, n).width;
		}
		Mi(t, i, n) {
			const s = this.sr(t, i, n);
			return ((s.actualBoundingBoxAscent || 0) - (s.actualBoundingBoxDescent || 0)) / 2;
		}
		sr(t, i, n) {
			const s = n || ii, e$1 = String(i).replace(s, "0");
			if (this.tr.has(e$1)) return m(this.tr.get(e$1)).er;
			if (this.Ke === this.ir) {
				const t$1 = this.Qe[this.Je];
				delete this.Qe[this.Je], this.tr.delete(t$1), this.Je++, this.Ke--;
			}
			t.save(), t.textBaseline = "middle";
			const r$1 = t.measureText(e$1);
			return t.restore(), 0 === r$1.width && i.length || (this.tr.set(e$1, {
				er: r$1,
				rr: this.Ge
			}), this.Qe[this.Ge] = e$1, this.Ke++, this.Ge++), r$1;
		}
	};
	si = class {
		constructor(t) {
			this.hr = null, this.k = null, this.lr = "right", this.ar = t;
		}
		_r(t, i, n) {
			this.hr = t, this.k = i, this.lr = n;
		}
		X(t) {
			null !== this.k && null !== this.hr && this.hr.X(t, this.k, this.ar, this.lr);
		}
	};
	ei = class {
		constructor(t, i, n) {
			this.ur = t, this.ar = new ni(50), this.cr = i, this.F = n, this.j = -1, this.Wt = new si(this.ar);
		}
		gt() {
			const t = this.F.dr(this.cr);
			if (null === t) return null;
			const i = t.vr(this.cr) ? t.pr() : this.cr.Dt();
			if (null === i) return null;
			const n = t.mr(i);
			if ("overlay" === n) return null;
			const s = this.F.br();
			return s.P !== this.j && (this.j = s.P, this.ar.nr()), this.Wt._r(this.ur.Ii(), s, n), this.Wt;
		}
	};
	ri = class extends H {
		constructor() {
			super(...arguments), this.zt = null;
		}
		J(t) {
			this.zt = t;
		}
		wr(t, i) {
			var n;
			if (!(null === (n = this.zt) || void 0 === n ? void 0 : n.yt)) return null;
			const { st: s, et: e$1, gr: r$1 } = this.zt;
			return i >= s - e$1 - 7 && i <= s + e$1 + 7 ? {
				Mr: this.zt,
				gr: r$1
			} : null;
		}
		K({ context: t, bitmapSize: i, horizontalPixelRatio: n, verticalPixelRatio: s }) {
			if (null === this.zt) return;
			if (!1 === this.zt.yt) return;
			const e$1 = Math.round(this.zt.st * s);
			e$1 < 0 || e$1 > i.height || (t.lineCap = "butt", t.strokeStyle = this.zt.V, t.lineWidth = Math.floor(this.zt.et * n), f(t, this.zt.Nt), v(t, e$1, 0, i.width));
		}
	};
	hi = class {
		constructor(t) {
			this.Sr = {
				st: 0,
				V: "rgba(0, 0, 0, 0)",
				et: 1,
				Nt: 0,
				yt: !1
			}, this.kr = new ri(), this.ft = !0, this.Es = t, this.Ns = t.$t(), this.kr.J(this.Sr);
		}
		bt() {
			this.ft = !0;
		}
		gt() {
			return this.Es.yt() ? (this.ft && (this.yr(), this.ft = !1), this.kr) : null;
		}
	};
	li = class extends hi {
		constructor(t) {
			super(t);
		}
		yr() {
			this.Sr.yt = !1;
			const t = this.Es.Dt(), i = t.Cr().Cr;
			if (2 !== i && 3 !== i) return;
			const n = this.Es.W();
			if (!n.baseLineVisible || !this.Es.yt()) return;
			const s = this.Es.Ct();
			null !== s && (this.Sr.yt = !0, this.Sr.st = t.Rt(s.Vt, s.Vt), this.Sr.V = n.baseLineColor, this.Sr.et = n.baseLineWidth, this.Sr.Nt = n.baseLineStyle);
		}
	};
	ai = class extends H {
		constructor() {
			super(...arguments), this.zt = null;
		}
		J(t) {
			this.zt = t;
		}
		$e() {
			return this.zt;
		}
		K({ context: t, horizontalPixelRatio: i, verticalPixelRatio: n }) {
			const s = this.zt;
			if (null === s) return;
			const e$1 = Math.max(1, Math.floor(i)), r$1 = e$1 % 2 / 2, h$1 = Math.round(s.Xe.x * i) + r$1, l$1 = s.Xe.y * n;
			t.fillStyle = s.Tr, t.beginPath();
			const a$1 = Math.max(2, 1.5 * s.Pr) * i;
			t.arc(h$1, l$1, a$1, 0, 2 * Math.PI, !1), t.fill(), t.fillStyle = s.Rr, t.beginPath(), t.arc(h$1, l$1, s.ht * i, 0, 2 * Math.PI, !1), t.fill(), t.lineWidth = e$1, t.strokeStyle = s.Dr, t.beginPath(), t.arc(h$1, l$1, s.ht * i + e$1 / 2, 0, 2 * Math.PI, !1), t.stroke();
		}
	};
	oi = [
		{
			Vr: 0,
			Or: .25,
			Br: 4,
			Ar: 10,
			Ir: .25,
			zr: 0,
			Lr: .4,
			Er: .8
		},
		{
			Vr: .25,
			Or: .525,
			Br: 10,
			Ar: 14,
			Ir: 0,
			zr: 0,
			Lr: .8,
			Er: 0
		},
		{
			Vr: .525,
			Or: 1,
			Br: 14,
			Ar: 14,
			Ir: 0,
			zr: 0,
			Lr: 0,
			Er: 0
		}
	];
	ci = class {
		constructor(t) {
			this.Wt = new ai(), this.ft = !0, this.Nr = !0, this.Fr = performance.now(), this.Wr = this.Fr - 1, this.jr = t;
		}
		Hr() {
			this.Wr = this.Fr - 1, this.bt();
		}
		$r() {
			if (this.bt(), 2 === this.jr.W().lastPriceAnimation) {
				const t = performance.now(), i = this.Wr - t;
				if (i > 0) return void (i < 650 && (this.Wr += 2600));
				this.Fr = t, this.Wr = t + 2600;
			}
		}
		bt() {
			this.ft = !0;
		}
		Ur() {
			this.Nr = !0;
		}
		yt() {
			return 0 !== this.jr.W().lastPriceAnimation;
		}
		qr() {
			switch (this.jr.W().lastPriceAnimation) {
				case 0: return !1;
				case 1: return !0;
				case 2: return performance.now() <= this.Wr;
			}
		}
		gt() {
			return this.ft ? (this.Mt(), this.ft = !1, this.Nr = !1) : this.Nr && (this.Yr(), this.Nr = !1), this.Wt;
		}
		Mt() {
			this.Wt.J(null);
			const t = this.jr.$t().St(), i = t.Xs(), n = this.jr.Ct();
			if (null === i || null === n) return;
			const s = this.jr.Zr(!0);
			if (s.Xr || !i.Kr(s.ee)) return;
			const e$1 = {
				x: t.It(s.ee),
				y: this.jr.Dt().Rt(s._t, n.Vt)
			}, r$1 = s.V, h$1 = this.jr.W().lineWidth, l$1 = ui(this.Gr(), r$1);
			this.Wt.J({
				Tr: r$1,
				Pr: h$1,
				Rr: l$1.Rr,
				Dr: l$1.Dr,
				ht: l$1.ht,
				Xe: e$1
			});
		}
		Yr() {
			const t = this.Wt.$e();
			if (null !== t) {
				const i = ui(this.Gr(), t.Tr);
				t.Rr = i.Rr, t.Dr = i.Dr, t.ht = i.ht;
			}
		}
		Gr() {
			return this.qr() ? performance.now() - this.Fr : 2599;
		}
	};
	Mi = class extends H {
		constructor() {
			super(...arguments), this.zt = null, this.ar = new ni(), this.j = -1, this.H = "", this.Qr = "";
		}
		J(t) {
			this.zt = t;
		}
		_r(t, i) {
			this.j === t && this.H === i || (this.j = t, this.H = i, this.Qr = F(t, i), this.ar.nr());
		}
		wr(t, i) {
			if (null === this.zt || null === this.zt.tt) return null;
			for (let n = this.zt.tt.from; n < this.zt.tt.to; n++) {
				const s = this.zt.it[n];
				if (Si(s, t, i)) return {
					Mr: s.th,
					gr: s.gr
				};
			}
			return null;
		}
		K({ context: t, horizontalPixelRatio: i, verticalPixelRatio: n }, s, e$1) {
			if (null !== this.zt && null !== this.zt.tt) {
				t.textBaseline = "middle", t.font = this.Qr;
				for (let s$1 = this.zt.tt.from; s$1 < this.zt.tt.to; s$1++) {
					const e$2 = this.zt.it[s$1];
					void 0 !== e$2.Kt && (e$2.Kt.Hi = this.ar.xi(t, e$2.Kt.ih), e$2.Kt.At = this.j, e$2.Kt.nt = e$2.nt - e$2.Kt.Hi / 2), xi(e$2, t, i, n);
				}
			}
		}
	};
	yi = class {
		constructor(t, i) {
			this.ft = !0, this.rh = !0, this.hh = !0, this.ah = null, this.oh = null, this.Wt = new Mi(), this.jr = t, this.$i = i, this.zt = {
				it: [],
				tt: null
			};
		}
		bt(t) {
			this.ft = !0, this.hh = !0, "data" === t && (this.rh = !0, this.oh = null);
		}
		gt(t) {
			if (!this.jr.yt()) return null;
			this.ft && this._h();
			const i = this.$i.W().layout;
			return this.Wt._r(i.fontSize, i.fontFamily), this.Wt.J(this.zt), this.Wt;
		}
		uh() {
			if (this.hh) {
				if (this.jr.dh().length > 0) {
					const t = this.$i.St().le(), i = pi(t), n = 1.5 * vi(t) + 2 * i, s = this.fh();
					this.ah = {
						above: mi(n, s.aboveBar, s.inBar),
						below: mi(n, s.belowBar, s.inBar)
					};
				} else this.ah = null;
				this.hh = !1;
			}
			return this.ah;
		}
		fh() {
			return null === this.oh && (this.oh = this.jr.dh().reduce((t, i) => (t[i.position] || (t[i.position] = !0), t), {
				inBar: !1,
				aboveBar: !1,
				belowBar: !1
			})), this.oh;
		}
		_h() {
			const t = this.jr.Dt(), i = this.$i.St(), n = this.jr.dh();
			this.rh && (this.zt.it = n.map((t$1) => ({
				ot: t$1.time,
				nt: 0,
				st: 0,
				Ks: 0,
				nh: t$1.shape,
				V: t$1.color,
				th: t$1.th,
				gr: t$1.id,
				Kt: void 0
			})), this.rh = !1);
			const s = this.$i.W().layout;
			this.zt.tt = null;
			const e$1 = i.Xs();
			if (null === e$1) return;
			const r$1 = this.jr.Ct();
			if (null === r$1) return;
			if (0 === this.zt.it.length) return;
			let h$1 = NaN;
			const l$1 = pi(i.le()), a$1 = {
				sh: l$1,
				eh: l$1
			};
			this.zt.tt = Lt(this.zt.it, e$1, !0);
			for (let e$2 = this.zt.tt.from; e$2 < this.zt.tt.to; e$2++) {
				const o$1 = n[e$2];
				o$1.time !== h$1 && (a$1.sh = l$1, a$1.eh = l$1, h$1 = o$1.time);
				const _$1 = this.zt.it[e$2];
				_$1.nt = i.It(o$1.time), void 0 !== o$1.text && o$1.text.length > 0 && (_$1.Kt = {
					ih: o$1.text,
					nt: 0,
					st: 0,
					Hi: 0,
					At: 0
				});
				const u$1 = this.jr.ph(o$1.time);
				null !== u$1 && ki(_$1, o$1, u$1, a$1, s.fontSize, l$1, t, i, r$1.Vt);
			}
			this.ft = !1;
		}
	};
	Ci = class extends hi {
		constructor(t) {
			super(t);
		}
		yr() {
			const t = this.Sr;
			t.yt = !1;
			const i = this.Es.W();
			if (!i.priceLineVisible || !this.Es.yt()) return;
			const n = this.Es.Zr(0 === i.priceLineSource);
			n.Xr || (t.yt = !0, t.st = n.ki, t.V = this.Es.mh(n.V), t.et = i.priceLineWidth, t.Nt = i.priceLineStyle);
		}
	};
	Ti = class extends nt {
		constructor(t) {
			super(), this.jt = t;
		}
		zi(t, i, n) {
			t.yt = !1, i.yt = !1;
			const s = this.jt;
			if (!s.yt()) return;
			const e$1 = s.W(), r$1 = e$1.lastValueVisible, h$1 = "" !== s.bh(), l$1 = 0 === e$1.seriesLastValueMode, a$1 = s.Zr(!1);
			if (a$1.Xr) return;
			r$1 && (t.Kt = this.wh(a$1, r$1, l$1), t.yt = 0 !== t.Kt.length), (h$1 || l$1) && (i.Kt = this.gh(a$1, r$1, h$1, l$1), i.yt = i.Kt.length > 0);
			const o$1 = s.mh(a$1.V), _$1 = R(o$1);
			n.t = _$1.t, n.ki = a$1.ki, i.Ot = s.$t().Bt(a$1.ki / s.Dt().At()), t.Ot = o$1, t.V = _$1.i, i.V = _$1.i;
		}
		gh(t, i, n, s) {
			let e$1 = "";
			const r$1 = this.jt.bh();
			return n && 0 !== r$1.length && (e$1 += `${r$1} `), i && s && (e$1 += this.jt.Dt().Mh() ? t.xh : t.Sh), e$1.trim();
		}
		wh(t, i, n) {
			return i ? n ? this.jt.Dt().Mh() ? t.Sh : t.xh : t.Kt : "";
		}
	};
	Ri = class Ri {
		constructor(t, i) {
			this.kh = t, this.yh = i;
		}
		Ch(t) {
			return null !== t && this.kh === t.kh && this.yh === t.yh;
		}
		Th() {
			return new Ri(this.kh, this.yh);
		}
		Ph() {
			return this.kh;
		}
		Rh() {
			return this.yh;
		}
		Dh() {
			return this.yh - this.kh;
		}
		Ni() {
			return this.yh === this.kh || Number.isNaN(this.yh) || Number.isNaN(this.kh);
		}
		ts(t) {
			return null === t ? this : new Ri(Pi(Math.min, this.Ph(), t.Ph(), -Infinity), Pi(Math.max, this.Rh(), t.Rh(), Infinity));
		}
		Vh(t) {
			if (!O(t)) return;
			if (0 === this.yh - this.kh) return;
			const i = .5 * (this.yh + this.kh);
			let n = this.yh - i, s = this.kh - i;
			n *= t, s *= t, this.yh = i + n, this.kh = i + s;
		}
		Oh(t) {
			O(t) && (this.yh += t, this.kh += t);
		}
		Bh() {
			return {
				minValue: this.kh,
				maxValue: this.yh
			};
		}
		static Ah(t) {
			return null === t ? null : new Ri(t.minValue, t.maxValue);
		}
	};
	Di = class Di {
		constructor(t, i) {
			this.Ih = t, this.zh = i || null;
		}
		Lh() {
			return this.Ih;
		}
		Eh() {
			return this.zh;
		}
		Bh() {
			return null === this.Ih ? null : {
				priceRange: this.Ih.Bh(),
				margins: this.zh || void 0
			};
		}
		static Ah(t) {
			return null === t ? null : new Di(Ri.Ah(t.priceRange), t.margins);
		}
	};
	Vi = class extends hi {
		constructor(t, i) {
			super(t), this.Nh = i;
		}
		yr() {
			const t = this.Sr;
			t.yt = !1;
			const i = this.Nh.W();
			if (!this.Es.yt() || !i.lineVisible) return;
			const n = this.Nh.Fh();
			null !== n && (t.yt = !0, t.st = n, t.V = i.color, t.et = i.lineWidth, t.Nt = i.lineStyle, t.gr = this.Nh.W().id);
		}
	};
	Oi = class extends nt {
		constructor(t, i) {
			super(), this.jr = t, this.Nh = i;
		}
		zi(t, i, n) {
			t.yt = !1, i.yt = !1;
			const s = this.Nh.W(), e$1 = s.axisLabelVisible, r$1 = "" !== s.title, h$1 = this.jr;
			if (!e$1 || !h$1.yt()) return;
			const l$1 = this.Nh.Fh();
			if (null === l$1) return;
			r$1 && (i.Kt = s.title, i.yt = !0), i.Ot = h$1.$t().Bt(l$1 / h$1.Dt().At()), t.Kt = this.Wh(s.price), t.yt = !0;
			const a$1 = R(s.axisLabelColor || s.color);
			n.t = a$1.t;
			const o$1 = s.axisLabelTextColor || a$1.i;
			t.V = o$1, i.V = o$1, n.ki = l$1;
		}
		Wh(t) {
			const i = this.jr.Ct();
			return null === i ? "" : this.jr.Dt().Fi(t, i.Vt);
		}
	};
	Bi = class {
		constructor(t, i) {
			this.jr = t, this.cn = i, this.jh = new Vi(t, this), this.ur = new Oi(t, this), this.Hh = new ei(this.ur, t, t.$t());
		}
		$h(t) {
			V(this.cn, t), this.bt(), this.jr.$t().Uh();
		}
		W() {
			return this.cn;
		}
		qh() {
			return this.jh;
		}
		Yh() {
			return this.Hh;
		}
		Zh() {
			return this.ur;
		}
		bt() {
			this.jh.bt(), this.ur.bt();
		}
		Fh() {
			const t = this.jr, i = t.Dt();
			if (t.$t().St().Ni() || i.Ni()) return null;
			const n = t.Ct();
			return null === n ? null : i.Rt(this.cn.price, n.Vt);
		}
	};
	Ai = class extends lt {
		constructor(t) {
			super(), this.$i = t;
		}
		$t() {
			return this.$i;
		}
	};
	Ii = {
		Bar: (t, i, n, s) => {
			var e$1;
			const r$1 = i.upColor, h$1 = i.downColor, l$1 = b(t(n, s)), a$1 = w(l$1.Vt[0]) <= w(l$1.Vt[3]);
			return { ce: null !== (e$1 = l$1.V) && void 0 !== e$1 ? e$1 : a$1 ? r$1 : h$1 };
		},
		Candlestick: (t, i, n, s) => {
			var e$1, r$1, h$1;
			const l$1 = i.upColor, a$1 = i.downColor, o$1 = i.borderUpColor, _$1 = i.borderDownColor, u$1 = i.wickUpColor, c$1 = i.wickDownColor, d$1 = b(t(n, s)), f$1 = w(d$1.Vt[0]) <= w(d$1.Vt[3]);
			return {
				ce: null !== (e$1 = d$1.V) && void 0 !== e$1 ? e$1 : f$1 ? l$1 : a$1,
				Ne: null !== (r$1 = d$1.Ot) && void 0 !== r$1 ? r$1 : f$1 ? o$1 : _$1,
				Ee: null !== (h$1 = d$1.Xh) && void 0 !== h$1 ? h$1 : f$1 ? u$1 : c$1
			};
		},
		Custom: (t, i, n, s) => {
			var e$1;
			return { ce: null !== (e$1 = b(t(n, s)).V) && void 0 !== e$1 ? e$1 : i.color };
		},
		Area: (t, i, n, s) => {
			var e$1, r$1, h$1, l$1;
			const a$1 = b(t(n, s));
			return {
				ce: null !== (e$1 = a$1.lt) && void 0 !== e$1 ? e$1 : i.lineColor,
				lt: null !== (r$1 = a$1.lt) && void 0 !== r$1 ? r$1 : i.lineColor,
				Ps: null !== (h$1 = a$1.Ps) && void 0 !== h$1 ? h$1 : i.topColor,
				Rs: null !== (l$1 = a$1.Rs) && void 0 !== l$1 ? l$1 : i.bottomColor
			};
		},
		Baseline: (t, i, n, s) => {
			var e$1, r$1, h$1, l$1, a$1, o$1;
			const _$1 = b(t(n, s));
			return {
				ce: _$1.Vt[3] >= i.baseValue.price ? i.topLineColor : i.bottomLineColor,
				Re: null !== (e$1 = _$1.Re) && void 0 !== e$1 ? e$1 : i.topLineColor,
				De: null !== (r$1 = _$1.De) && void 0 !== r$1 ? r$1 : i.bottomLineColor,
				ke: null !== (h$1 = _$1.ke) && void 0 !== h$1 ? h$1 : i.topFillColor1,
				ye: null !== (l$1 = _$1.ye) && void 0 !== l$1 ? l$1 : i.topFillColor2,
				Ce: null !== (a$1 = _$1.Ce) && void 0 !== a$1 ? a$1 : i.bottomFillColor1,
				Te: null !== (o$1 = _$1.Te) && void 0 !== o$1 ? o$1 : i.bottomFillColor2
			};
		},
		Line: (t, i, n, s) => {
			var e$1, r$1;
			const h$1 = b(t(n, s));
			return {
				ce: null !== (e$1 = h$1.V) && void 0 !== e$1 ? e$1 : i.color,
				lt: null !== (r$1 = h$1.V) && void 0 !== r$1 ? r$1 : i.color
			};
		},
		Histogram: (t, i, n, s) => {
			var e$1;
			return { ce: null !== (e$1 = b(t(n, s)).V) && void 0 !== e$1 ? e$1 : i.color };
		}
	};
	zi = class {
		constructor(t) {
			this.Kh = (t$1, i) => void 0 !== i ? i.Vt : this.jr.In().Gh(t$1), this.jr = t, this.Jh = Ii[t.Qh()];
		}
		$s(t, i) {
			return this.Jh(this.Kh, this.jr.W(), t, i);
		}
	};
	(function(t) {
		t[t.NearestLeft = -1] = "NearestLeft", t[t.None = 0] = "None", t[t.NearestRight = 1] = "NearestRight";
	})(Li || (Li = {}));
	Ei = 30;
	Ni = class {
		constructor() {
			this.tl = [], this.il = /* @__PURE__ */ new Map(), this.nl = /* @__PURE__ */ new Map();
		}
		sl() {
			return this.Ks() > 0 ? this.tl[this.tl.length - 1] : null;
		}
		el() {
			return this.Ks() > 0 ? this.rl(0) : null;
		}
		An() {
			return this.Ks() > 0 ? this.rl(this.tl.length - 1) : null;
		}
		Ks() {
			return this.tl.length;
		}
		Ni() {
			return 0 === this.Ks();
		}
		Kr(t) {
			return null !== this.hl(t, 0);
		}
		Gh(t) {
			return this.ll(t);
		}
		ll(t, i = 0) {
			const n = this.hl(t, i);
			return null === n ? null : Object.assign(Object.assign({}, this.al(n)), { ee: this.rl(n) });
		}
		ne() {
			return this.tl;
		}
		ol(t, i, n) {
			if (this.Ni()) return null;
			let s = null;
			for (const e$1 of n) s = Fi(s, this._l(t, i, e$1));
			return s;
		}
		J(t) {
			this.nl.clear(), this.il.clear(), this.tl = t;
		}
		rl(t) {
			return this.tl[t].ee;
		}
		al(t) {
			return this.tl[t];
		}
		hl(t, i) {
			const n = this.ul(t);
			if (null === n && 0 !== i) switch (i) {
				case -1: return this.cl(t);
				case 1: return this.dl(t);
				default: throw new TypeError("Unknown search mode");
			}
			return n;
		}
		cl(t) {
			let i = this.fl(t);
			return i > 0 && (i -= 1), i !== this.tl.length && this.rl(i) < t ? i : null;
		}
		dl(t) {
			const i = this.vl(t);
			return i !== this.tl.length && t < this.rl(i) ? i : null;
		}
		ul(t) {
			const i = this.fl(t);
			return i === this.tl.length || t < this.tl[i].ee ? null : i;
		}
		fl(t) {
			return Bt(this.tl, t, (t$1, i) => t$1.ee < i);
		}
		vl(t) {
			return At(this.tl, t, (t$1, i) => t$1.ee > i);
		}
		pl(t, i, n) {
			let s = null;
			for (let e$1 = t; e$1 < i; e$1++) {
				const t$1 = this.tl[e$1].Vt[n];
				Number.isNaN(t$1) || (null === s ? s = {
					ml: t$1,
					bl: t$1
				} : (t$1 < s.ml && (s.ml = t$1), t$1 > s.bl && (s.bl = t$1)));
			}
			return s;
		}
		_l(t, i, n) {
			if (this.Ni()) return null;
			let s = null;
			const e$1 = b(this.el()), r$1 = b(this.An()), h$1 = Math.max(t, e$1), l$1 = Math.min(i, r$1), a$1 = Math.ceil(h$1 / Ei) * Ei, o$1 = Math.max(a$1, Math.floor(l$1 / Ei) * Ei);
			{
				const t$1 = this.fl(h$1), e$2 = this.vl(Math.min(l$1, a$1, i));
				s = Fi(s, this.pl(t$1, e$2, n));
			}
			let _$1 = this.il.get(n);
			void 0 === _$1 && (_$1 = /* @__PURE__ */ new Map(), this.il.set(n, _$1));
			for (let t$1 = Math.max(a$1 + 1, h$1); t$1 < o$1; t$1 += Ei) {
				const i$1 = Math.floor(t$1 / Ei);
				let e$2 = _$1.get(i$1);
				if (void 0 === e$2) {
					const t$2 = this.fl(i$1 * Ei), s$1 = this.vl((i$1 + 1) * Ei - 1);
					e$2 = this.pl(t$2, s$1, n), _$1.set(i$1, e$2);
				}
				s = Fi(s, e$2);
			}
			{
				const t$1 = this.fl(o$1), i$1 = this.vl(l$1);
				s = Fi(s, this.pl(t$1, i$1, n));
			}
			return s;
		}
	};
	Wi = class {
		constructor(t) {
			this.wl = t;
		}
		X(t, i, n) {
			this.wl.draw(t);
		}
		gl(t, i, n) {
			var s, e$1;
			null === (e$1 = (s = this.wl).drawBackground) || void 0 === e$1 || e$1.call(s, t);
		}
	};
	ji = class {
		constructor(t) {
			this.tr = null, this.wn = t;
		}
		gt() {
			var t;
			const i = this.wn.renderer();
			if (null === i) return null;
			if ((null === (t = this.tr) || void 0 === t ? void 0 : t.Ml) === i) return this.tr.xl;
			const n = new Wi(i);
			return this.tr = {
				Ml: i,
				xl: n
			}, n;
		}
		Sl() {
			var t, i, n;
			return null !== (n = null === (i = (t = this.wn).zOrder) || void 0 === i ? void 0 : i.call(t)) && void 0 !== n ? n : "normal";
		}
	};
	$i = class {
		constructor(t, i) {
			this.Wt = new rt(), this.kl = t, this.yl = i;
		}
		gt() {
			return this.Wt.J(Object.assign({ Hi: this.yl.Hi() }, Hi(this.kl))), this.Wt;
		}
	};
	Ui = class extends nt {
		constructor(t, i) {
			super(), this.kl = t, this.Li = i;
		}
		zi(t, i, n) {
			const s = Hi(this.kl);
			n.t = s.t, t.V = s.V;
			const e$1 = 2 / 12 * this.Li.P();
			n.wi = e$1, n.gi = e$1, n.ki = s.ki, n.Si = s.Si, t.Kt = s.Kt, t.yt = s.yt, t.hi = s.hi;
		}
	};
	qi = class {
		constructor(t, i) {
			this.Cl = null, this.Tl = null, this.Pl = null, this.Rl = null, this.Dl = null, this.Vl = t, this.jr = i;
		}
		Ol() {
			return this.Vl;
		}
		Vn() {
			var t, i;
			null === (i = (t = this.Vl).updateAllViews) || void 0 === i || i.call(t);
		}
		Pn() {
			var t, i, n, s;
			const e$1 = null !== (n = null === (i = (t = this.Vl).paneViews) || void 0 === i ? void 0 : i.call(t)) && void 0 !== n ? n : [];
			if ((null === (s = this.Cl) || void 0 === s ? void 0 : s.Ml) === e$1) return this.Cl.xl;
			const r$1 = e$1.map((t$1) => new ji(t$1));
			return this.Cl = {
				Ml: e$1,
				xl: r$1
			}, r$1;
		}
		Qi() {
			var t, i, n, s;
			const e$1 = null !== (n = null === (i = (t = this.Vl).timeAxisViews) || void 0 === i ? void 0 : i.call(t)) && void 0 !== n ? n : [];
			if ((null === (s = this.Tl) || void 0 === s ? void 0 : s.Ml) === e$1) return this.Tl.xl;
			const r$1 = this.jr.$t().St(), h$1 = e$1.map((t$1) => new $i(t$1, r$1));
			return this.Tl = {
				Ml: e$1,
				xl: h$1
			}, h$1;
		}
		Rn() {
			var t, i, n, s;
			const e$1 = null !== (n = null === (i = (t = this.Vl).priceAxisViews) || void 0 === i ? void 0 : i.call(t)) && void 0 !== n ? n : [];
			if ((null === (s = this.Pl) || void 0 === s ? void 0 : s.Ml) === e$1) return this.Pl.xl;
			const r$1 = this.jr.Dt(), h$1 = e$1.map((t$1) => new Ui(t$1, r$1));
			return this.Pl = {
				Ml: e$1,
				xl: h$1
			}, h$1;
		}
		Bl() {
			var t, i, n, s;
			const e$1 = null !== (n = null === (i = (t = this.Vl).priceAxisPaneViews) || void 0 === i ? void 0 : i.call(t)) && void 0 !== n ? n : [];
			if ((null === (s = this.Rl) || void 0 === s ? void 0 : s.Ml) === e$1) return this.Rl.xl;
			const r$1 = e$1.map((t$1) => new ji(t$1));
			return this.Rl = {
				Ml: e$1,
				xl: r$1
			}, r$1;
		}
		Al() {
			var t, i, n, s;
			const e$1 = null !== (n = null === (i = (t = this.Vl).timeAxisPaneViews) || void 0 === i ? void 0 : i.call(t)) && void 0 !== n ? n : [];
			if ((null === (s = this.Dl) || void 0 === s ? void 0 : s.Ml) === e$1) return this.Dl.xl;
			const r$1 = e$1.map((t$1) => new ji(t$1));
			return this.Dl = {
				Ml: e$1,
				xl: r$1
			}, r$1;
		}
		Il(t, i) {
			var n, s, e$1;
			return null !== (e$1 = null === (s = (n = this.Vl).autoscaleInfo) || void 0 === s ? void 0 : s.call(n, t, i)) && void 0 !== e$1 ? e$1 : null;
		}
		wr(t, i) {
			var n, s, e$1;
			return null !== (e$1 = null === (s = (n = this.Vl).hitTest) || void 0 === s ? void 0 : s.call(n, t, i)) && void 0 !== e$1 ? e$1 : null;
		}
	};
	Gi = class extends Ai {
		constructor(t, i, n, s, e$1) {
			super(t), this.zt = new Ni(), this.jh = new Ci(this), this.zl = [], this.Ll = new li(this), this.El = null, this.Nl = null, this.Fl = [], this.Wl = [], this.jl = null, this.Hl = [], this.cn = i, this.$l = n;
			const r$1 = new Ti(this);
			this.rn = [r$1], this.Hh = new ei(r$1, this, t), "Area" !== n && "Line" !== n && "Baseline" !== n || (this.El = new ci(this)), this.Ul(), this.ql(e$1);
		}
		S() {
			null !== this.jl && clearTimeout(this.jl);
		}
		mh(t) {
			return this.cn.priceLineColor || t;
		}
		Zr(t) {
			const i = { Xr: !0 }, n = this.Dt();
			if (this.$t().St().Ni() || n.Ni() || this.zt.Ni()) return i;
			const s = this.$t().St().Xs(), e$1 = this.Ct();
			if (null === s || null === e$1) return i;
			let r$1, h$1;
			if (t) {
				const t$1 = this.zt.sl();
				if (null === t$1) return i;
				r$1 = t$1, h$1 = t$1.ee;
			} else {
				const t$1 = this.zt.ll(s.ui(), -1);
				if (null === t$1) return i;
				if (r$1 = this.zt.Gh(t$1.ee), null === r$1) return i;
				h$1 = t$1.ee;
			}
			const l$1 = r$1.Vt[3], a$1 = this.Us().$s(h$1, { Vt: r$1 }), o$1 = n.Rt(l$1, e$1.Vt);
			return {
				Xr: !1,
				_t: l$1,
				Kt: n.Fi(l$1, e$1.Vt),
				xh: n.Yl(l$1),
				Sh: n.Zl(l$1, e$1.Vt),
				V: a$1.ce,
				ki: o$1,
				ee: h$1
			};
		}
		Us() {
			return null !== this.Nl || (this.Nl = new zi(this)), this.Nl;
		}
		W() {
			return this.cn;
		}
		$h(t) {
			const i = t.priceScaleId;
			void 0 !== i && i !== this.cn.priceScaleId && this.$t().Xl(this, i), V(this.cn, t), void 0 !== t.priceFormat && (this.Ul(), this.$t().Kl()), this.$t().Gl(this), this.$t().Jl(), this.wn.bt("options");
		}
		J(t, i) {
			this.zt.J(t), this.Ql(), this.wn.bt("data"), this.dn.bt("data"), null !== this.El && (i && i.ta ? this.El.$r() : 0 === t.length && this.El.Hr());
			const n = this.$t().dr(this);
			this.$t().ia(n), this.$t().Gl(this), this.$t().Jl(), this.$t().Uh();
		}
		na(t) {
			this.Fl = t, this.Ql();
			const i = this.$t().dr(this);
			this.dn.bt("data"), this.$t().ia(i), this.$t().Gl(this), this.$t().Jl(), this.$t().Uh();
		}
		sa() {
			return this.Fl;
		}
		dh() {
			return this.Wl;
		}
		ea(t) {
			const i = new Bi(this, t);
			return this.zl.push(i), this.$t().Gl(this), i;
		}
		ra(t) {
			const i = this.zl.indexOf(t);
			-1 !== i && this.zl.splice(i, 1), this.$t().Gl(this);
		}
		Qh() {
			return this.$l;
		}
		Ct() {
			const t = this.ha();
			return null === t ? null : {
				Vt: t.Vt[3],
				la: t.ot
			};
		}
		ha() {
			const t = this.$t().St().Xs();
			if (null === t) return null;
			const i = t.Os();
			return this.zt.ll(i, 1);
		}
		In() {
			return this.zt;
		}
		ph(t) {
			const i = this.zt.Gh(t);
			return null === i ? null : "Bar" === this.$l || "Candlestick" === this.$l || "Custom" === this.$l ? {
				ge: i.Vt[0],
				Me: i.Vt[1],
				xe: i.Vt[2],
				Se: i.Vt[3]
			} : i.Vt[3];
		}
		aa(t) {
			const i = [];
			Yi(this.Hl, Zi, "top", i);
			const n = this.El;
			return null !== n && n.yt() ? (null === this.jl && n.qr() && (this.jl = setTimeout(() => {
				this.jl = null, this.$t().oa();
			}, 0)), n.Ur(), i.unshift(n), i) : i;
		}
		Pn() {
			const t = [];
			this._a() || t.push(this.Ll), t.push(this.wn, this.jh, this.dn);
			const i = this.zl.map((t$1) => t$1.qh());
			return t.push(...i), Yi(this.Hl, Zi, "normal", t), t;
		}
		ua() {
			return this.ca(Zi, "bottom");
		}
		da(t) {
			return this.ca(Xi, t);
		}
		fa(t) {
			return this.ca(Ki, t);
		}
		va(t, i) {
			return this.Hl.map((n) => n.wr(t, i)).filter((t$1) => null !== t$1);
		}
		Ji(t) {
			return [this.Hh, ...this.zl.map((t$1) => t$1.Yh())];
		}
		Rn(t, i) {
			if (i !== this.Yi && !this._a()) return [];
			const n = [...this.rn];
			for (const t$1 of this.zl) n.push(t$1.Zh());
			return this.Hl.forEach((t$1) => {
				n.push(...t$1.Rn());
			}), n;
		}
		Qi() {
			const t = [];
			return this.Hl.forEach((i) => {
				t.push(...i.Qi());
			}), t;
		}
		Il(t, i) {
			if (void 0 !== this.cn.autoscaleInfoProvider) {
				const n = this.cn.autoscaleInfoProvider(() => {
					const n$1 = this.pa(t, i);
					return null === n$1 ? null : n$1.Bh();
				});
				return Di.Ah(n);
			}
			return this.pa(t, i);
		}
		ma() {
			return this.cn.priceFormat.minMove;
		}
		ba() {
			return this.wa;
		}
		Vn() {
			var t;
			this.wn.bt(), this.dn.bt();
			for (const t$1 of this.rn) t$1.bt();
			for (const t$1 of this.zl) t$1.bt();
			this.jh.bt(), this.Ll.bt(), null === (t = this.El) || void 0 === t || t.bt(), this.Hl.forEach((t$1) => t$1.Vn());
		}
		Dt() {
			return b(super.Dt());
		}
		kt(t) {
			if (!(("Line" === this.$l || "Area" === this.$l || "Baseline" === this.$l) && this.cn.crosshairMarkerVisible)) return null;
			const i = this.zt.Gh(t);
			if (null === i) return null;
			return {
				_t: i.Vt[3],
				ht: this.ga(),
				Ot: this.Ma(),
				Pt: this.xa(),
				Tt: this.Sa(t)
			};
		}
		bh() {
			return this.cn.title;
		}
		yt() {
			return this.cn.visible;
		}
		ka(t) {
			this.Hl.push(new qi(t, this));
		}
		ya(t) {
			this.Hl = this.Hl.filter((i) => i.Ol() !== t);
		}
		Ca() {
			if (this.wn instanceof Kt != !1) return (t) => this.wn.We(t);
		}
		Ta() {
			if (this.wn instanceof Kt != !1) return (t) => this.wn.je(t);
		}
		_a() {
			return !_t(this.Dt().Pa());
		}
		pa(t, i) {
			if (!B(t) || !B(i) || this.zt.Ni()) return null;
			const n = "Line" === this.$l || "Area" === this.$l || "Baseline" === this.$l || "Histogram" === this.$l ? [3] : [2, 1], s = this.zt.ol(t, i, n);
			let e$1 = null !== s ? new Ri(s.ml, s.bl) : null;
			if ("Histogram" === this.Qh()) {
				const t$1 = this.cn.base, i$1 = new Ri(t$1, t$1);
				e$1 = null !== e$1 ? e$1.ts(i$1) : i$1;
			}
			let r$1 = this.dn.uh();
			return this.Hl.forEach((n$1) => {
				const s$1 = n$1.Il(t, i);
				if (null == s$1 ? void 0 : s$1.priceRange) {
					const t$1 = new Ri(s$1.priceRange.minValue, s$1.priceRange.maxValue);
					e$1 = null !== e$1 ? e$1.ts(t$1) : t$1;
				}
				var h$1, l$1, a$1, o$1;
				null != s$1 && s$1.margins && (h$1 = r$1, l$1 = s$1.margins, r$1 = {
					above: Math.max(null !== (a$1 = null == h$1 ? void 0 : h$1.above) && void 0 !== a$1 ? a$1 : 0, l$1.above),
					below: Math.max(null !== (o$1 = null == h$1 ? void 0 : h$1.below) && void 0 !== o$1 ? o$1 : 0, l$1.below)
				});
			}), new Di(e$1, r$1);
		}
		ga() {
			switch (this.$l) {
				case "Line":
				case "Area":
				case "Baseline": return this.cn.crosshairMarkerRadius;
			}
			return 0;
		}
		Ma() {
			switch (this.$l) {
				case "Line":
				case "Area":
				case "Baseline": {
					const t = this.cn.crosshairMarkerBorderColor;
					if (0 !== t.length) return t;
				}
			}
			return null;
		}
		xa() {
			switch (this.$l) {
				case "Line":
				case "Area":
				case "Baseline": return this.cn.crosshairMarkerBorderWidth;
			}
			return 0;
		}
		Sa(t) {
			switch (this.$l) {
				case "Line":
				case "Area":
				case "Baseline": {
					const t$1 = this.cn.crosshairMarkerBackgroundColor;
					if (0 !== t$1.length) return t$1;
				}
			}
			return this.Us().$s(t).ce;
		}
		Ul() {
			switch (this.cn.priceFormat.type) {
				case "custom":
					this.wa = { format: this.cn.priceFormat.formatter };
					break;
				case "volume":
					this.wa = new pt(this.cn.priceFormat.precision);
					break;
				case "percent":
					this.wa = new vt(this.cn.priceFormat.precision);
					break;
				default: {
					const t = Math.pow(10, this.cn.priceFormat.precision);
					this.wa = new ft(t, this.cn.priceFormat.minMove * t);
				}
			}
			null !== this.Yi && this.Yi.Ra();
		}
		Ql() {
			const t = this.$t().St();
			if (!t.Da() || this.zt.Ni()) return void (this.Wl = []);
			const i = b(this.zt.el());
			this.Wl = this.Fl.map((n, s) => {
				const e$1 = b(t.Va(n.time, !0)), r$1 = e$1 < i ? 1 : -1;
				return {
					time: b(this.zt.ll(e$1, r$1)).ee,
					position: n.position,
					shape: n.shape,
					color: n.color,
					id: n.id,
					th: s,
					text: n.text,
					size: n.size,
					originalTime: n.originalTime
				};
			});
		}
		ql(t) {
			switch (this.dn = new yi(this, this.$t()), this.$l) {
				case "Bar":
					this.wn = new Ht(this, this.$t());
					break;
				case "Candlestick":
					this.wn = new Zt(this, this.$t());
					break;
				case "Line":
					this.wn = new ti(this, this.$t());
					break;
				case "Custom":
					this.wn = new Kt(this, this.$t(), m(t));
					break;
				case "Area":
					this.wn = new Ft(this, this.$t());
					break;
				case "Baseline":
					this.wn = new qt(this, this.$t());
					break;
				case "Histogram":
					this.wn = new Qt(this, this.$t());
					break;
				default: throw Error("Unknown chart style assigned: " + this.$l);
			}
		}
		ca(t, i) {
			const n = [];
			return Yi(this.Hl, t, i, n), n;
		}
	};
	Ji = class {
		constructor(t) {
			this.cn = t;
		}
		Oa(t, i, n) {
			let s = t;
			if (0 === this.cn.mode) return s;
			const e$1 = n.vn(), r$1 = e$1.Ct();
			if (null === r$1) return s;
			const h$1 = e$1.Rt(t, r$1), l$1 = n.Ba().filter((t$1) => t$1 instanceof Gi).reduce((t$1, s$1) => {
				if (n.vr(s$1) || !s$1.yt()) return t$1;
				const e$2 = s$1.Dt(), r$2 = s$1.In();
				if (e$2.Ni() || !r$2.Kr(i)) return t$1;
				const h$2 = r$2.Gh(i);
				if (null === h$2) return t$1;
				const l$2 = w(s$1.Ct());
				return t$1.concat([e$2.Rt(h$2.Vt[3], l$2.Vt)]);
			}, []);
			if (0 === l$1.length) return s;
			l$1.sort((t$1, i$1) => Math.abs(t$1 - h$1) - Math.abs(i$1 - h$1));
			const a$1 = l$1[0];
			return s = e$1.pn(a$1, r$1), s;
		}
	};
	Qi = class extends H {
		constructor() {
			super(...arguments), this.zt = null;
		}
		J(t) {
			this.zt = t;
		}
		K({ context: t, bitmapSize: i, horizontalPixelRatio: n, verticalPixelRatio: s }) {
			if (null === this.zt) return;
			const e$1 = Math.max(1, Math.floor(n));
			t.lineWidth = e$1, function(t$1, i$1) {
				t$1.save(), t$1.lineWidth % 2 && t$1.translate(.5, .5), i$1(), t$1.restore();
			}(t, () => {
				const r$1 = b(this.zt);
				if (r$1.Aa) {
					t.strokeStyle = r$1.Ia, f(t, r$1.za), t.beginPath();
					for (const s$1 of r$1.La) {
						const r$2 = Math.round(s$1.Ea * n);
						t.moveTo(r$2, -e$1), t.lineTo(r$2, i.height + e$1);
					}
					t.stroke();
				}
				if (r$1.Na) {
					t.strokeStyle = r$1.Fa, f(t, r$1.Wa), t.beginPath();
					for (const n$1 of r$1.ja) {
						const r$2 = Math.round(n$1.Ea * s);
						t.moveTo(-e$1, r$2), t.lineTo(i.width + e$1, r$2);
					}
					t.stroke();
				}
			});
		}
	};
	tn = class {
		constructor(t) {
			this.Wt = new Qi(), this.ft = !0, this.tn = t;
		}
		bt() {
			this.ft = !0;
		}
		gt() {
			if (this.ft) {
				const t = this.tn.$t().W().grid, i = {
					Na: t.horzLines.visible,
					Aa: t.vertLines.visible,
					Fa: t.horzLines.color,
					Ia: t.vertLines.color,
					Wa: t.horzLines.style,
					za: t.vertLines.style,
					ja: this.tn.vn().Ha(),
					La: (this.tn.$t().St().Ha() || []).map((t$1) => ({ Ea: t$1.coord }))
				};
				this.Wt.J(i), this.ft = !1;
			}
			return this.Wt;
		}
	};
	nn = class {
		constructor(t) {
			this.wn = new tn(t);
		}
		qh() {
			return this.wn;
		}
	};
	sn = {
		$a: 4,
		Ua: 1e-4
	};
	dn = class {
		constructor(t, i) {
			if (this.qa = t, this.Ya = i, function(t$1) {
				if (t$1 < 0) return !1;
				for (let i$1 = t$1; i$1 > 1; i$1 /= 10) if (i$1 % 10 != 0) return !1;
				return !0;
			}(this.qa)) this.Za = [
				2,
				2.5,
				2
			];
			else {
				this.Za = [];
				for (let t$1 = this.qa; 1 !== t$1;) {
					if (t$1 % 2 == 0) this.Za.push(2), t$1 /= 2;
					else {
						if (t$1 % 5 != 0) throw new Error("unexpected base");
						this.Za.push(2, 2.5), t$1 /= 5;
					}
					if (this.Za.length > 100) throw new Error("something wrong with base");
				}
			}
		}
		Xa(t, i, n) {
			const s = 0 === this.qa ? 0 : 1 / this.qa;
			let e$1 = Math.pow(10, Math.max(0, Math.ceil(Math.log10(t - i)))), r$1 = 0, h$1 = this.Ya[0];
			for (;;) {
				const t$1 = yt(e$1, s, 1e-14) && e$1 > s + 1e-14, i$1 = yt(e$1, n * h$1, 1e-14), l$2 = yt(e$1, 1, 1e-14);
				if (!(t$1 && i$1 && l$2)) break;
				e$1 /= h$1, h$1 = this.Ya[++r$1 % this.Ya.length];
			}
			if (e$1 <= s + 1e-14 && (e$1 = s), e$1 = Math.max(1, e$1), this.Za.length > 0 && (l$1 = e$1, a$1 = 1, o$1 = 1e-14, Math.abs(l$1 - a$1) < o$1)) for (r$1 = 0, h$1 = this.Za[0]; yt(e$1, n * h$1, 1e-14) && e$1 > s + 1e-14;) e$1 /= h$1, h$1 = this.Za[++r$1 % this.Za.length];
			var l$1, a$1, o$1;
			return e$1;
		}
	};
	fn = class {
		constructor(t, i, n, s) {
			this.Ka = [], this.Li = t, this.qa = i, this.Ga = n, this.Ja = s;
		}
		Xa(t, i) {
			if (t < i) throw new Error("high < low");
			const n = this.Li.At(), s = (t - i) * this.Qa() / n, e$1 = new dn(this.qa, [
				2,
				2.5,
				2
			]), r$1 = new dn(this.qa, [
				2,
				2,
				2.5
			]), h$1 = new dn(this.qa, [
				2.5,
				2,
				2
			]), l$1 = [];
			return l$1.push(e$1.Xa(t, i, s), r$1.Xa(t, i, s), h$1.Xa(t, i, s)), function(t$1) {
				if (t$1.length < 1) throw Error("array is empty");
				let i$1 = t$1[0];
				for (let n$1 = 1; n$1 < t$1.length; ++n$1) t$1[n$1] < i$1 && (i$1 = t$1[n$1]);
				return i$1;
			}(l$1);
		}
		io() {
			const t = this.Li, i = t.Ct();
			if (null === i) return void (this.Ka = []);
			const n = t.At(), s = this.Ga(n - 1, i), e$1 = this.Ga(0, i), r$1 = this.Li.W().entireTextOnly ? this.no() / 2 : 0, h$1 = r$1, l$1 = n - 1 - r$1, a$1 = Math.max(s, e$1), o$1 = Math.min(s, e$1);
			if (a$1 === o$1) return void (this.Ka = []);
			let _$1 = this.Xa(a$1, o$1), u$1 = a$1 % _$1;
			u$1 += u$1 < 0 ? _$1 : 0;
			const c$1 = a$1 >= o$1 ? 1 : -1;
			let d$1 = null, f$1 = 0;
			for (let n$1 = a$1 - u$1; n$1 > o$1; n$1 -= _$1) {
				const s$1 = this.Ja(n$1, i, !0);
				null !== d$1 && Math.abs(s$1 - d$1) < this.Qa() || s$1 < h$1 || s$1 > l$1 || (f$1 < this.Ka.length ? (this.Ka[f$1].Ea = s$1, this.Ka[f$1].so = t.eo(n$1)) : this.Ka.push({
					Ea: s$1,
					so: t.eo(n$1)
				}), f$1++, d$1 = s$1, t.ro() && (_$1 = this.Xa(n$1 * c$1, o$1)));
			}
			this.Ka.length = f$1;
		}
		Ha() {
			return this.Ka;
		}
		no() {
			return this.Li.P();
		}
		Qa() {
			return Math.ceil(2.5 * this.no());
		}
	};
	(function(t) {
		t[t.Normal = 0] = "Normal", t[t.Logarithmic = 1] = "Logarithmic", t[t.Percentage = 2] = "Percentage", t[t.IndexedTo100 = 3] = "IndexedTo100";
	})(pn || (pn = {}));
	mn = new vt(), bn = new ft(100, 1);
	wn = class {
		constructor(t, i, n, s) {
			this.ho = 0, this.lo = null, this.Ih = null, this.ao = null, this.oo = {
				_o: !1,
				uo: null
			}, this.co = 0, this.do = 0, this.fo = new D(), this.vo = new D(), this.po = [], this.mo = null, this.bo = null, this.wo = null, this.Mo = null, this.wa = bn, this.xo = cn(null), this.So = t, this.cn = i, this.ko = n, this.yo = s, this.Co = new fn(this, 100, this.To.bind(this), this.Po.bind(this));
		}
		Pa() {
			return this.So;
		}
		W() {
			return this.cn;
		}
		$h(t) {
			if (V(this.cn, t), this.Ra(), void 0 !== t.mode && this.Ro({ Cr: t.mode }), void 0 !== t.scaleMargins) {
				const i = m(t.scaleMargins.top), n = m(t.scaleMargins.bottom);
				if (i < 0 || i > 1) throw new Error(`Invalid top margin - expect value between 0 and 1, given=${i}`);
				if (n < 0 || n > 1) throw new Error(`Invalid bottom margin - expect value between 0 and 1, given=${n}`);
				if (i + n > 1) throw new Error(`Invalid margins - sum of margins must be less than 1, given=${i + n}`);
				this.Do(), this.bo = null;
			}
		}
		Vo() {
			return this.cn.autoScale;
		}
		ro() {
			return 1 === this.cn.mode;
		}
		Mh() {
			return 2 === this.cn.mode;
		}
		Oo() {
			return 3 === this.cn.mode;
		}
		Cr() {
			return {
				Wn: this.cn.autoScale,
				Bo: this.cn.invertScale,
				Cr: this.cn.mode
			};
		}
		Ro(t) {
			const i = this.Cr();
			let n = null;
			void 0 !== t.Wn && (this.cn.autoScale = t.Wn), void 0 !== t.Cr && (this.cn.mode = t.Cr, 2 !== t.Cr && 3 !== t.Cr || (this.cn.autoScale = !0), this.oo._o = !1), 1 === i.Cr && t.Cr !== i.Cr && (!function(t$1, i$1) {
				if (null === t$1) return !1;
				const n$1 = on(t$1.Ph(), i$1), s$1 = on(t$1.Rh(), i$1);
				return isFinite(n$1) && isFinite(s$1);
			}(this.Ih, this.xo) ? this.cn.autoScale = !0 : (n = un(this.Ih, this.xo), null !== n && this.Ao(n))), 1 === t.Cr && t.Cr !== i.Cr && (n = _n(this.Ih, this.xo), null !== n && this.Ao(n));
			const s = i.Cr !== this.cn.mode;
			s && (2 === i.Cr || this.Mh()) && this.Ra(), s && (3 === i.Cr || this.Oo()) && this.Ra(), void 0 !== t.Bo && i.Bo !== t.Bo && (this.cn.invertScale = t.Bo, this.Io()), this.vo.m(i, this.Cr());
		}
		zo() {
			return this.vo;
		}
		P() {
			return this.ko.fontSize;
		}
		At() {
			return this.ho;
		}
		Lo(t) {
			this.ho !== t && (this.ho = t, this.Do(), this.bo = null);
		}
		Eo() {
			if (this.lo) return this.lo;
			const t = this.At() - this.No() - this.Fo();
			return this.lo = t, t;
		}
		Lh() {
			return this.Wo(), this.Ih;
		}
		Ao(t, i) {
			const n = this.Ih;
			(i || null === n && null !== t || null !== n && !n.Ch(t)) && (this.bo = null, this.Ih = t);
		}
		Ni() {
			return this.Wo(), 0 === this.ho || !this.Ih || this.Ih.Ni();
		}
		jo(t) {
			return this.Bo() ? t : this.At() - 1 - t;
		}
		Rt(t, i) {
			return this.Mh() ? t = en(t, i) : this.Oo() && (t = hn(t, i)), this.Po(t, i);
		}
		te(t, i, n) {
			this.Wo();
			const s = this.Fo(), e$1 = b(this.Lh()), r$1 = e$1.Ph(), h$1 = e$1.Rh(), l$1 = this.Eo() - 1, a$1 = this.Bo(), o$1 = l$1 / (h$1 - r$1), _$1 = void 0 === n ? 0 : n.from, u$1 = void 0 === n ? t.length : n.to, c$1 = this.Ho();
			for (let n$1 = _$1; n$1 < u$1; n$1++) {
				const e$2 = t[n$1], h$2 = e$2._t;
				if (isNaN(h$2)) continue;
				let l$2 = h$2;
				null !== c$1 && (l$2 = c$1(e$2._t, i));
				const _$2 = s + o$1 * (l$2 - r$1), u$2 = a$1 ? _$2 : this.ho - 1 - _$2;
				e$2.st = u$2;
			}
		}
		be(t, i, n) {
			this.Wo();
			const s = this.Fo(), e$1 = b(this.Lh()), r$1 = e$1.Ph(), h$1 = e$1.Rh(), l$1 = this.Eo() - 1, a$1 = this.Bo(), o$1 = l$1 / (h$1 - r$1), _$1 = void 0 === n ? 0 : n.from, u$1 = void 0 === n ? t.length : n.to, c$1 = this.Ho();
			for (let n$1 = _$1; n$1 < u$1; n$1++) {
				const e$2 = t[n$1];
				let h$2 = e$2.ge, l$2 = e$2.Me, _$2 = e$2.xe, u$2 = e$2.Se;
				null !== c$1 && (h$2 = c$1(e$2.ge, i), l$2 = c$1(e$2.Me, i), _$2 = c$1(e$2.xe, i), u$2 = c$1(e$2.Se, i));
				let d$1 = s + o$1 * (h$2 - r$1), f$1 = a$1 ? d$1 : this.ho - 1 - d$1;
				e$2.pe = f$1, d$1 = s + o$1 * (l$2 - r$1), f$1 = a$1 ? d$1 : this.ho - 1 - d$1, e$2.de = f$1, d$1 = s + o$1 * (_$2 - r$1), f$1 = a$1 ? d$1 : this.ho - 1 - d$1, e$2.fe = f$1, d$1 = s + o$1 * (u$2 - r$1), f$1 = a$1 ? d$1 : this.ho - 1 - d$1, e$2.me = f$1;
			}
		}
		pn(t, i) {
			const n = this.To(t, i);
			return this.$o(n, i);
		}
		$o(t, i) {
			let n = t;
			return this.Mh() ? n = function(t$1, i$1) {
				return i$1 < 0 && (t$1 = -t$1), t$1 / 100 * i$1 + i$1;
			}(n, i) : this.Oo() && (n = function(t$1, i$1) {
				return t$1 -= 100, i$1 < 0 && (t$1 = -t$1), t$1 / 100 * i$1 + i$1;
			}(n, i)), n;
		}
		Ba() {
			return this.po;
		}
		Uo() {
			if (this.mo) return this.mo;
			let t = [];
			for (let i = 0; i < this.po.length; i++) {
				const n = this.po[i];
				null === n.Xi() && n.Ki(i + 1), t.push(n);
			}
			return t = vn(t), this.mo = t, this.mo;
		}
		qo(t) {
			-1 === this.po.indexOf(t) && (this.po.push(t), this.Ra(), this.Yo());
		}
		Zo(t) {
			const i = this.po.indexOf(t);
			if (-1 === i) throw new Error("source is not attached to scale");
			this.po.splice(i, 1), 0 === this.po.length && (this.Ro({ Wn: !0 }), this.Ao(null)), this.Ra(), this.Yo();
		}
		Ct() {
			let t = null;
			for (const i of this.po) {
				const n = i.Ct();
				null !== n && (null === t || n.la < t.la) && (t = n);
			}
			return null === t ? null : t.Vt;
		}
		Bo() {
			return this.cn.invertScale;
		}
		Ha() {
			const t = null === this.Ct();
			if (null !== this.bo && (t || this.bo.Xo === t)) return this.bo.Ha;
			this.Co.io();
			const i = this.Co.Ha();
			return this.bo = {
				Ha: i,
				Xo: t
			}, this.fo.m(), i;
		}
		Ko() {
			return this.fo;
		}
		Go(t) {
			this.Mh() || this.Oo() || null === this.wo && null === this.ao && (this.Ni() || (this.wo = this.ho - t, this.ao = b(this.Lh()).Th()));
		}
		Jo(t) {
			if (this.Mh() || this.Oo()) return;
			if (null === this.wo) return;
			this.Ro({ Wn: !1 }), (t = this.ho - t) < 0 && (t = 0);
			let i = (this.wo + .2 * (this.ho - 1)) / (t + .2 * (this.ho - 1));
			const n = b(this.ao).Th();
			i = Math.max(i, .1), n.Vh(i), this.Ao(n);
		}
		Qo() {
			this.Mh() || this.Oo() || (this.wo = null, this.ao = null);
		}
		t_(t) {
			this.Vo() || null === this.Mo && null === this.ao && (this.Ni() || (this.Mo = t, this.ao = b(this.Lh()).Th()));
		}
		i_(t) {
			if (this.Vo()) return;
			if (null === this.Mo) return;
			const i = b(this.Lh()).Dh() / (this.Eo() - 1);
			let n = t - this.Mo;
			this.Bo() && (n *= -1);
			const s = n * i, e$1 = b(this.ao).Th();
			e$1.Oh(s), this.Ao(e$1, !0), this.bo = null;
		}
		n_() {
			this.Vo() || null !== this.Mo && (this.Mo = null, this.ao = null);
		}
		ba() {
			return this.wa || this.Ra(), this.wa;
		}
		Fi(t, i) {
			switch (this.cn.mode) {
				case 2: return this.s_(en(t, i));
				case 3: return this.ba().format(hn(t, i));
				default: return this.Wh(t);
			}
		}
		eo(t) {
			switch (this.cn.mode) {
				case 2: return this.s_(t);
				case 3: return this.ba().format(t);
				default: return this.Wh(t);
			}
		}
		Yl(t) {
			return this.Wh(t, b(this.e_()).ba());
		}
		Zl(t, i) {
			return t = en(t, i), this.s_(t, mn);
		}
		r_() {
			return this.po;
		}
		h_(t) {
			this.oo = {
				uo: t,
				_o: !1
			};
		}
		Vn() {
			this.po.forEach((t) => t.Vn());
		}
		Ra() {
			this.bo = null;
			const t = this.e_();
			let i = 100;
			null !== t && (i = Math.round(1 / t.ma())), this.wa = bn, this.Mh() ? (this.wa = mn, i = 100) : this.Oo() ? (this.wa = new ft(100, 1), i = 100) : null !== t && (this.wa = t.ba()), this.Co = new fn(this, i, this.To.bind(this), this.Po.bind(this)), this.Co.io();
		}
		Yo() {
			this.mo = null;
		}
		e_() {
			return this.po[0] || null;
		}
		No() {
			return this.Bo() ? this.cn.scaleMargins.bottom * this.At() + this.do : this.cn.scaleMargins.top * this.At() + this.co;
		}
		Fo() {
			return this.Bo() ? this.cn.scaleMargins.top * this.At() + this.co : this.cn.scaleMargins.bottom * this.At() + this.do;
		}
		Wo() {
			this.oo._o || (this.oo._o = !0, this.l_());
		}
		Do() {
			this.lo = null;
		}
		Po(t, i) {
			if (this.Wo(), this.Ni()) return 0;
			t = this.ro() && t ? an(t, this.xo) : t;
			const n = b(this.Lh()), s = this.Fo() + (this.Eo() - 1) * (t - n.Ph()) / n.Dh();
			return this.jo(s);
		}
		To(t, i) {
			if (this.Wo(), this.Ni()) return 0;
			const n = this.jo(t), s = b(this.Lh()), e$1 = s.Ph() + s.Dh() * ((n - this.Fo()) / (this.Eo() - 1));
			return this.ro() ? on(e$1, this.xo) : e$1;
		}
		Io() {
			this.bo = null, this.Co.io();
		}
		l_() {
			const t = this.oo.uo;
			if (null === t) return;
			let i = null;
			const n = this.r_();
			let s = 0, e$1 = 0;
			for (const r$2 of n) {
				if (!r$2.yt()) continue;
				const n$1 = r$2.Ct();
				if (null === n$1) continue;
				const h$2 = r$2.Il(t.Os(), t.ui());
				let l$1 = h$2 && h$2.Lh();
				if (null !== l$1) {
					switch (this.cn.mode) {
						case 1:
							l$1 = _n(l$1, this.xo);
							break;
						case 2:
							l$1 = rn(l$1, n$1.Vt);
							break;
						case 3: l$1 = ln(l$1, n$1.Vt);
					}
					if (i = null === i ? l$1 : i.ts(b(l$1)), null !== h$2) {
						const t$1 = h$2.Eh();
						null !== t$1 && (s = Math.max(s, t$1.above), e$1 = Math.max(e$1, t$1.below));
					}
				}
			}
			if (s === this.co && e$1 === this.do || (this.co = s, this.do = e$1, this.bo = null, this.Do()), null !== i) {
				if (i.Ph() === i.Rh()) {
					const t$1 = this.e_(), n$1 = 5 * (null === t$1 || this.Mh() || this.Oo() ? 1 : t$1.ma());
					this.ro() && (i = un(i, this.xo)), i = new Ri(i.Ph() - n$1, i.Rh() + n$1), this.ro() && (i = _n(i, this.xo));
				}
				if (this.ro()) {
					const t$1 = un(i, this.xo), n$1 = cn(t$1);
					if (r$1 = n$1, h$1 = this.xo, r$1.$a !== h$1.$a || r$1.Ua !== h$1.Ua) {
						const s$1 = null !== this.ao ? un(this.ao, this.xo) : null;
						this.xo = n$1, i = _n(t$1, n$1), null !== s$1 && (this.ao = _n(s$1, n$1));
					}
				}
				this.Ao(i);
			} else null === this.Ih && (this.Ao(new Ri(-.5, .5)), this.xo = cn(null));
			var r$1, h$1;
			this.oo._o = !0;
		}
		Ho() {
			return this.Mh() ? en : this.Oo() ? hn : this.ro() ? (t) => an(t, this.xo) : null;
		}
		a_(t, i, n) {
			return void 0 === i ? (void 0 === n && (n = this.ba()), n.format(t)) : i(t);
		}
		Wh(t, i) {
			return this.a_(t, this.yo.priceFormatter, i);
		}
		s_(t, i) {
			return this.a_(t, this.yo.percentageFormatter, i);
		}
	};
	gn = class {
		constructor(t, i) {
			this.po = [], this.o_ = /* @__PURE__ */ new Map(), this.ho = 0, this.__ = 0, this.u_ = 1e3, this.mo = null, this.c_ = new D(), this.yl = t, this.$i = i, this.d_ = new nn(this);
			const n = i.W();
			this.f_ = this.v_("left", n.leftPriceScale), this.p_ = this.v_("right", n.rightPriceScale), this.f_.zo().l(this.m_.bind(this, this.f_), this), this.p_.zo().l(this.m_.bind(this, this.p_), this), this.b_(n);
		}
		b_(t) {
			if (t.leftPriceScale && this.f_.$h(t.leftPriceScale), t.rightPriceScale && this.p_.$h(t.rightPriceScale), t.localization && (this.f_.Ra(), this.p_.Ra()), t.overlayPriceScales) {
				const i = Array.from(this.o_.values());
				for (const n of i) {
					const i$1 = b(n[0].Dt());
					i$1.$h(t.overlayPriceScales), t.localization && i$1.Ra();
				}
			}
		}
		w_(t) {
			switch (t) {
				case "left": return this.f_;
				case "right": return this.p_;
			}
			return this.o_.has(t) ? m(this.o_.get(t))[0].Dt() : null;
		}
		S() {
			this.$t().g_().p(this), this.f_.zo().p(this), this.p_.zo().p(this), this.po.forEach((t) => {
				t.S && t.S();
			}), this.c_.m();
		}
		M_() {
			return this.u_;
		}
		x_(t) {
			this.u_ = t;
		}
		$t() {
			return this.$i;
		}
		Hi() {
			return this.__;
		}
		At() {
			return this.ho;
		}
		S_(t) {
			this.__ = t, this.k_();
		}
		Lo(t) {
			this.ho = t, this.f_.Lo(t), this.p_.Lo(t), this.po.forEach((i) => {
				if (this.vr(i)) {
					const n = i.Dt();
					null !== n && n.Lo(t);
				}
			}), this.k_();
		}
		Ba() {
			return this.po;
		}
		vr(t) {
			const i = t.Dt();
			return null === i || this.f_ !== i && this.p_ !== i;
		}
		qo(t, i, n) {
			const s = void 0 !== n ? n : this.C_().y_ + 1;
			this.T_(t, i, s);
		}
		Zo(t) {
			const i = this.po.indexOf(t);
			p(-1 !== i, "removeDataSource: invalid data source"), this.po.splice(i, 1);
			const n = b(t.Dt()).Pa();
			if (this.o_.has(n)) {
				const i$1 = m(this.o_.get(n)), s$1 = i$1.indexOf(t);
				-1 !== s$1 && (i$1.splice(s$1, 1), 0 === i$1.length && this.o_.delete(n));
			}
			const s = t.Dt();
			s && s.Ba().indexOf(t) >= 0 && s.Zo(t), null !== s && (s.Yo(), this.P_(s)), this.mo = null;
		}
		mr(t) {
			return t === this.f_ ? "left" : t === this.p_ ? "right" : "overlay";
		}
		R_() {
			return this.f_;
		}
		D_() {
			return this.p_;
		}
		V_(t, i) {
			t.Go(i);
		}
		O_(t, i) {
			t.Jo(i), this.k_();
		}
		B_(t) {
			t.Qo();
		}
		A_(t, i) {
			t.t_(i);
		}
		I_(t, i) {
			t.i_(i), this.k_();
		}
		z_(t) {
			t.n_();
		}
		k_() {
			this.po.forEach((t) => {
				t.Vn();
			});
		}
		vn() {
			let t = null;
			return this.$i.W().rightPriceScale.visible && 0 !== this.p_.Ba().length ? t = this.p_ : this.$i.W().leftPriceScale.visible && 0 !== this.f_.Ba().length ? t = this.f_ : 0 !== this.po.length && (t = this.po[0].Dt()), null === t && (t = this.p_), t;
		}
		pr() {
			let t = null;
			return this.$i.W().rightPriceScale.visible ? t = this.p_ : this.$i.W().leftPriceScale.visible && (t = this.f_), t;
		}
		P_(t) {
			null !== t && t.Vo() && this.L_(t);
		}
		E_(t) {
			const i = this.yl.Xs();
			t.Ro({ Wn: !0 }), null !== i && t.h_(i), this.k_();
		}
		N_() {
			this.L_(this.f_), this.L_(this.p_);
		}
		F_() {
			this.P_(this.f_), this.P_(this.p_), this.po.forEach((t) => {
				this.vr(t) && this.P_(t.Dt());
			}), this.k_(), this.$i.Uh();
		}
		Uo() {
			return null === this.mo && (this.mo = vn(this.po)), this.mo;
		}
		W_() {
			return this.c_;
		}
		j_() {
			return this.d_;
		}
		L_(t) {
			const i = t.r_();
			if (i && i.length > 0 && !this.yl.Ni()) {
				const i$1 = this.yl.Xs();
				null !== i$1 && t.h_(i$1);
			}
			t.Vn();
		}
		C_() {
			const t = this.Uo();
			if (0 === t.length) return {
				H_: 0,
				y_: 0
			};
			let i = 0, n = 0;
			for (let s = 0; s < t.length; s++) {
				const e$1 = t[s].Xi();
				null !== e$1 && (e$1 < i && (i = e$1), e$1 > n && (n = e$1));
			}
			return {
				H_: i,
				y_: n
			};
		}
		T_(t, i, n) {
			let s = this.w_(i);
			if (null === s && (s = this.v_(i, this.$i.W().overlayPriceScales)), this.po.push(t), !_t(i)) {
				const n$1 = this.o_.get(i) || [];
				n$1.push(t), this.o_.set(i, n$1);
			}
			s.qo(t), t.Gi(s), t.Ki(n), this.P_(s), this.mo = null;
		}
		m_(t, i, n) {
			i.Cr !== n.Cr && this.L_(t);
		}
		v_(t, i) {
			const n = Object.assign({
				visible: !0,
				autoScale: !0
			}, z(i)), s = new wn(t, n, this.$i.W().layout, this.$i.W().localization);
			return s.Lo(this.At()), s;
		}
	};
	Mn = class {
		constructor(t, i, n = 50) {
			this.Ke = 0, this.Ge = 1, this.Je = 1, this.tr = /* @__PURE__ */ new Map(), this.Qe = /* @__PURE__ */ new Map(), this.U_ = t, this.q_ = i, this.ir = n;
		}
		Y_(t) {
			const i = t.time, n = this.q_.cacheKey(i), s = this.tr.get(n);
			if (void 0 !== s) return s.Z_;
			if (this.Ke === this.ir) {
				const t$1 = this.Qe.get(this.Je);
				this.Qe.delete(this.Je), this.tr.delete(m(t$1)), this.Je++, this.Ke--;
			}
			const e$1 = this.U_(t);
			return this.tr.set(n, {
				Z_: e$1,
				rr: this.Ge
			}), this.Qe.set(this.Ge, n), this.Ke++, this.Ge++, e$1;
		}
	};
	xn = class {
		constructor(t, i) {
			p(t <= i, "right should be >= left"), this.X_ = t, this.K_ = i;
		}
		Os() {
			return this.X_;
		}
		ui() {
			return this.K_;
		}
		G_() {
			return this.K_ - this.X_ + 1;
		}
		Kr(t) {
			return this.X_ <= t && t <= this.K_;
		}
		Ch(t) {
			return this.X_ === t.Os() && this.K_ === t.ui();
		}
	};
	kn = class {
		constructor() {
			this.J_ = /* @__PURE__ */ new Map(), this.tr = null, this.Q_ = !1;
		}
		tu(t) {
			this.Q_ = t, this.tr = null;
		}
		iu(t, i) {
			this.nu(i), this.tr = null;
			for (let n = i; n < t.length; ++n) {
				const i$1 = t[n];
				let s = this.J_.get(i$1.timeWeight);
				void 0 === s && (s = [], this.J_.set(i$1.timeWeight, s)), s.push({
					index: n,
					time: i$1.time,
					weight: i$1.timeWeight,
					originalTime: i$1.originalTime
				});
			}
		}
		su(t, i) {
			const n = Math.ceil(i / t);
			return null !== this.tr && this.tr.eu === n || (this.tr = {
				Ha: this.ru(n),
				eu: n
			}), this.tr.Ha;
		}
		nu(t) {
			if (0 === t) return void this.J_.clear();
			const i = [];
			this.J_.forEach((n, s) => {
				t <= n[0].index ? i.push(s) : n.splice(Bt(n, t, (i$1) => i$1.index < t), Infinity);
			});
			for (const t$1 of i) this.J_.delete(t$1);
		}
		ru(t) {
			let i = [];
			for (const n of Array.from(this.J_.keys()).sort((t$1, i$1) => i$1 - t$1)) {
				if (!this.J_.get(n)) continue;
				const s = i;
				i = [];
				const e$1 = s.length;
				let r$1 = 0;
				const h$1 = m(this.J_.get(n)), l$1 = h$1.length;
				let a$1 = Infinity, o$1 = -Infinity;
				for (let n$1 = 0; n$1 < l$1; n$1++) {
					const l$2 = h$1[n$1], _$1 = l$2.index;
					for (; r$1 < e$1;) {
						const t$1 = s[r$1], n$2 = t$1.index;
						if (!(n$2 < _$1)) {
							a$1 = n$2;
							break;
						}
						r$1++, i.push(t$1), o$1 = n$2, a$1 = Infinity;
					}
					if (a$1 - _$1 >= t && _$1 - o$1 >= t) i.push(l$2), o$1 = _$1;
					else if (this.Q_) return s;
				}
				for (; r$1 < e$1; r$1++) i.push(s[r$1]);
			}
			return i;
		}
	};
	yn = class yn {
		constructor(t) {
			this.hu = t;
		}
		lu() {
			return null === this.hu ? null : new xn(Math.floor(this.hu.Os()), Math.ceil(this.hu.ui()));
		}
		au() {
			return this.hu;
		}
		static ou() {
			return new yn(null);
		}
	};
	Tn = class {
		constructor(t, i, n, s) {
			this.__ = 0, this._u = null, this.uu = [], this.Mo = null, this.wo = null, this.cu = new kn(), this.du = /* @__PURE__ */ new Map(), this.fu = yn.ou(), this.vu = !0, this.pu = new D(), this.mu = new D(), this.bu = new D(), this.wu = null, this.gu = null, this.Mu = [], this.cn = i, this.yo = n, this.xu = i.rightOffset, this.Su = i.barSpacing, this.$i = t, this.q_ = s, this.ku(), this.cu.tu(i.uniformDistribution);
		}
		W() {
			return this.cn;
		}
		yu(t) {
			V(this.yo, t), this.Cu(), this.ku();
		}
		$h(t, i) {
			var n;
			V(this.cn, t), this.cn.fixLeftEdge && this.Tu(), this.cn.fixRightEdge && this.Pu(), void 0 !== t.barSpacing && this.$i.Gn(t.barSpacing), void 0 !== t.rightOffset && this.$i.Jn(t.rightOffset), void 0 !== t.minBarSpacing && this.$i.Gn(null !== (n = t.barSpacing) && void 0 !== n ? n : this.Su), this.Cu(), this.ku(), this.bu.m();
		}
		mn(t) {
			var i, n;
			return null !== (n = null === (i = this.uu[t]) || void 0 === i ? void 0 : i.time) && void 0 !== n ? n : null;
		}
		Ui(t) {
			var i;
			return null !== (i = this.uu[t]) && void 0 !== i ? i : null;
		}
		Va(t, i) {
			if (this.uu.length < 1) return null;
			if (this.q_.key(t) > this.q_.key(this.uu[this.uu.length - 1].time)) return i ? this.uu.length - 1 : null;
			const n = Bt(this.uu, this.q_.key(t), (t$1, i$1) => this.q_.key(t$1.time) < i$1);
			return this.q_.key(t) < this.q_.key(this.uu[n].time) ? i ? n : null : n;
		}
		Ni() {
			return 0 === this.__ || 0 === this.uu.length || null === this._u;
		}
		Da() {
			return this.uu.length > 0;
		}
		Xs() {
			return this.Ru(), this.fu.lu();
		}
		Du() {
			return this.Ru(), this.fu.au();
		}
		Vu() {
			const t = this.Xs();
			if (null === t) return null;
			const i = {
				from: t.Os(),
				to: t.ui()
			};
			return this.Ou(i);
		}
		Ou(t) {
			const i = Math.round(t.from), n = Math.round(t.to), s = b(this.Bu()), e$1 = b(this.Au());
			return {
				from: b(this.Ui(Math.max(s, i))),
				to: b(this.Ui(Math.min(e$1, n)))
			};
		}
		Iu(t) {
			return {
				from: b(this.Va(t.from, !0)),
				to: b(this.Va(t.to, !0))
			};
		}
		Hi() {
			return this.__;
		}
		S_(t) {
			if (!isFinite(t) || t <= 0) return;
			if (this.__ === t) return;
			const i = this.Du(), n = this.__;
			if (this.__ = t, this.vu = !0, this.cn.lockVisibleTimeRangeOnResize && 0 !== n) {
				const i$1 = this.Su * t / n;
				this.Su = i$1;
			}
			if (this.cn.fixLeftEdge && null !== i && i.Os() <= 0) {
				const i$1 = n - t;
				this.xu -= Math.round(i$1 / this.Su) + 1, this.vu = !0;
			}
			this.zu(), this.Lu();
		}
		It(t) {
			if (this.Ni() || !B(t)) return 0;
			const i = this.Eu() + this.xu - t;
			return this.__ - (i + .5) * this.Su - 1;
		}
		Qs(t, i) {
			const n = this.Eu(), s = void 0 === i ? 0 : i.from, e$1 = void 0 === i ? t.length : i.to;
			for (let i$1 = s; i$1 < e$1; i$1++) {
				const s$1 = t[i$1].ot, e$2 = n + this.xu - s$1, r$1 = this.__ - (e$2 + .5) * this.Su - 1;
				t[i$1].nt = r$1;
			}
		}
		Nu(t) {
			return Math.ceil(this.Fu(t));
		}
		Jn(t) {
			this.vu = !0, this.xu = t, this.Lu(), this.$i.Wu(), this.$i.Uh();
		}
		le() {
			return this.Su;
		}
		Gn(t) {
			this.ju(t), this.Lu(), this.$i.Wu(), this.$i.Uh();
		}
		Hu() {
			return this.xu;
		}
		Ha() {
			if (this.Ni()) return null;
			if (null !== this.gu) return this.gu;
			const t = this.Su, i = 5 * (this.$i.W().layout.fontSize + 4) / 8 * (this.cn.tickMarkMaxCharacterLength || 8), n = Math.round(i / t), s = b(this.Xs()), e$1 = Math.max(s.Os(), s.Os() - n), r$1 = Math.max(s.ui(), s.ui() - n), h$1 = this.cu.su(t, i), l$1 = this.Bu() + n, a$1 = this.Au() - n, o$1 = this.$u(), _$1 = this.cn.fixLeftEdge || o$1, u$1 = this.cn.fixRightEdge || o$1;
			let c$1 = 0;
			for (const t$1 of h$1) {
				if (!(e$1 <= t$1.index && t$1.index <= r$1)) continue;
				let n$1;
				c$1 < this.Mu.length ? (n$1 = this.Mu[c$1], n$1.coord = this.It(t$1.index), n$1.label = this.Uu(t$1), n$1.weight = t$1.weight) : (n$1 = {
					needAlignCoordinate: !1,
					coord: this.It(t$1.index),
					label: this.Uu(t$1),
					weight: t$1.weight
				}, this.Mu.push(n$1)), this.Su > i / 2 && !o$1 ? n$1.needAlignCoordinate = !1 : n$1.needAlignCoordinate = _$1 && t$1.index <= l$1 || u$1 && t$1.index >= a$1, c$1++;
			}
			return this.Mu.length = c$1, this.gu = this.Mu, this.Mu;
		}
		qu() {
			this.vu = !0, this.Gn(this.cn.barSpacing), this.Jn(this.cn.rightOffset);
		}
		Yu(t) {
			this.vu = !0, this._u = t, this.Lu(), this.Tu();
		}
		Zu(t, i) {
			const n = this.Fu(t), s = this.le(), e$1 = s + i * (s / 10);
			this.Gn(e$1), this.cn.rightBarStaysOnScroll || this.Jn(this.Hu() + (n - this.Fu(t)));
		}
		Go(t) {
			this.Mo && this.n_(), null === this.wo && null === this.wu && (this.Ni() || (this.wo = t, this.Xu()));
		}
		Jo(t) {
			if (null === this.wu) return;
			const i = kt(this.__ - t, 0, this.__), n = kt(this.__ - b(this.wo), 0, this.__);
			0 !== i && 0 !== n && this.Gn(this.wu.le * i / n);
		}
		Qo() {
			null !== this.wo && (this.wo = null, this.Ku());
		}
		t_(t) {
			null === this.Mo && null === this.wu && (this.Ni() || (this.Mo = t, this.Xu()));
		}
		i_(t) {
			if (null === this.Mo) return;
			const i = (this.Mo - t) / this.le();
			this.xu = b(this.wu).Hu + i, this.vu = !0, this.Lu();
		}
		n_() {
			null !== this.Mo && (this.Mo = null, this.Ku());
		}
		Gu() {
			this.Ju(this.cn.rightOffset);
		}
		Ju(t, i = 400) {
			if (!isFinite(t)) throw new RangeError("offset is required and must be finite number");
			if (!isFinite(i) || i <= 0) throw new RangeError("animationDuration (optional) must be finite positive number");
			const n = this.xu, s = performance.now();
			this.$i.Zn({
				Qu: (t$1) => (t$1 - s) / i >= 1,
				tc: (e$1) => {
					const r$1 = (e$1 - s) / i;
					return r$1 >= 1 ? t : n + (t - n) * r$1;
				}
			});
		}
		bt(t, i) {
			this.vu = !0, this.uu = t, this.cu.iu(t, i), this.Lu();
		}
		nc() {
			return this.pu;
		}
		sc() {
			return this.mu;
		}
		ec() {
			return this.bu;
		}
		Eu() {
			return this._u || 0;
		}
		rc(t) {
			const i = t.G_();
			this.ju(this.__ / i), this.xu = t.ui() - this.Eu(), this.Lu(), this.vu = !0, this.$i.Wu(), this.$i.Uh();
		}
		hc() {
			const t = this.Bu(), i = this.Au();
			null !== t && null !== i && this.rc(new xn(t, i + this.cn.rightOffset));
		}
		lc(t) {
			const i = new xn(t.from, t.to);
			this.rc(i);
		}
		qi(t) {
			return void 0 !== this.yo.timeFormatter ? this.yo.timeFormatter(t.originalTime) : this.q_.formatHorzItem(t.time);
		}
		$u() {
			const { handleScroll: t, handleScale: i } = this.$i.W();
			return !(t.horzTouchDrag || t.mouseWheel || t.pressedMouseMove || t.vertTouchDrag || i.axisDoubleClickReset.time || i.axisPressedMouseMove.time || i.mouseWheel || i.pinch);
		}
		Bu() {
			return 0 === this.uu.length ? null : 0;
		}
		Au() {
			return 0 === this.uu.length ? null : this.uu.length - 1;
		}
		ac(t) {
			return (this.__ - 1 - t) / this.Su;
		}
		Fu(t) {
			const i = this.ac(t), n = this.Eu() + this.xu - i;
			return Math.round(1e6 * n) / 1e6;
		}
		ju(t) {
			const i = this.Su;
			this.Su = t, this.zu(), i !== this.Su && (this.vu = !0, this.oc());
		}
		Ru() {
			if (!this.vu) return;
			if (this.vu = !1, this.Ni()) return void this._c(yn.ou());
			const t = this.Eu(), i = this.__ / this.Su, n = this.xu + t, s = new xn(n - i + 1, n);
			this._c(new yn(s));
		}
		zu() {
			const t = this.uc();
			if (this.Su < t && (this.Su = t, this.vu = !0), 0 !== this.__) {
				const t$1 = .5 * this.__;
				this.Su > t$1 && (this.Su = t$1, this.vu = !0);
			}
		}
		uc() {
			return this.cn.fixLeftEdge && this.cn.fixRightEdge && 0 !== this.uu.length ? this.__ / this.uu.length : this.cn.minBarSpacing;
		}
		Lu() {
			const t = this.cc();
			null !== t && this.xu < t && (this.xu = t, this.vu = !0);
			const i = this.dc();
			this.xu > i && (this.xu = i, this.vu = !0);
		}
		cc() {
			const t = this.Bu(), i = this._u;
			if (null === t || null === i) return null;
			return t - i - 1 + (this.cn.fixLeftEdge ? this.__ / this.Su : Math.min(2, this.uu.length));
		}
		dc() {
			return this.cn.fixRightEdge ? 0 : this.__ / this.Su - Math.min(2, this.uu.length);
		}
		Xu() {
			this.wu = {
				le: this.le(),
				Hu: this.Hu()
			};
		}
		Ku() {
			this.wu = null;
		}
		Uu(t) {
			let i = this.du.get(t.weight);
			return void 0 === i && (i = new Mn((t$1) => this.fc(t$1), this.q_), this.du.set(t.weight, i)), i.Y_(t);
		}
		fc(t) {
			return this.q_.formatTickmark(t, this.yo);
		}
		_c(t) {
			const i = this.fu;
			this.fu = t, Sn(i.lu(), this.fu.lu()) || this.pu.m(), Sn(i.au(), this.fu.au()) || this.mu.m(), this.oc();
		}
		oc() {
			this.gu = null;
		}
		Cu() {
			this.oc(), this.du.clear();
		}
		ku() {
			this.q_.updateFormatter(this.yo);
		}
		Tu() {
			if (!this.cn.fixLeftEdge) return;
			const t = this.Bu();
			if (null === t) return;
			const i = this.Xs();
			if (null === i) return;
			const n = i.Os() - t;
			if (n < 0) {
				const t$1 = this.xu - n - 1;
				this.Jn(t$1);
			}
			this.zu();
		}
		Pu() {
			this.Lu(), this.zu();
		}
	};
	Pn = class {
		X(t, i, n) {
			t.useMediaCoordinateSpace((t$1) => this.K(t$1, i, n));
		}
		gl(t, i, n) {
			t.useMediaCoordinateSpace((t$1) => this.vc(t$1, i, n));
		}
		vc(t, i, n) {}
	};
	Rn = class extends Pn {
		constructor(t) {
			super(), this.mc = /* @__PURE__ */ new Map(), this.zt = t;
		}
		K(t) {}
		vc(t) {
			if (!this.zt.yt) return;
			const { context: i, mediaSize: n } = t;
			let s = 0;
			for (const t$1 of this.zt.bc) {
				if (0 === t$1.Kt.length) continue;
				i.font = t$1.R;
				const e$2 = this.wc(i, t$1.Kt);
				e$2 > n.width ? t$1.Zu = n.width / e$2 : t$1.Zu = 1, s += t$1.gc * t$1.Zu;
			}
			let e$1 = 0;
			switch (this.zt.Mc) {
				case "top":
					e$1 = 0;
					break;
				case "center":
					e$1 = Math.max((n.height - s) / 2, 0);
					break;
				case "bottom": e$1 = Math.max(n.height - s, 0);
			}
			i.fillStyle = this.zt.V;
			for (const t$1 of this.zt.bc) {
				i.save();
				let s$1 = 0;
				switch (this.zt.xc) {
					case "left":
						i.textAlign = "left", s$1 = t$1.gc / 2;
						break;
					case "center":
						i.textAlign = "center", s$1 = n.width / 2;
						break;
					case "right": i.textAlign = "right", s$1 = n.width - 1 - t$1.gc / 2;
				}
				i.translate(s$1, e$1), i.textBaseline = "top", i.font = t$1.R, i.scale(t$1.Zu, t$1.Zu), i.fillText(t$1.Kt, 0, t$1.Sc), i.restore(), e$1 += t$1.gc * t$1.Zu;
			}
		}
		wc(t, i) {
			const n = this.kc(t.font);
			let s = n.get(i);
			return void 0 === s && (s = t.measureText(i).width, n.set(i, s)), s;
		}
		kc(t) {
			let i = this.mc.get(t);
			return void 0 === i && (i = /* @__PURE__ */ new Map(), this.mc.set(t, i)), i;
		}
	};
	Dn = class {
		constructor(t) {
			this.ft = !0, this.Ft = {
				yt: !1,
				V: "",
				bc: [],
				Mc: "center",
				xc: "center"
			}, this.Wt = new Rn(this.Ft), this.jt = t;
		}
		bt() {
			this.ft = !0;
		}
		gt() {
			return this.ft && (this.Mt(), this.ft = !1), this.Wt;
		}
		Mt() {
			const t = this.jt.W(), i = this.Ft;
			i.yt = t.visible, i.yt && (i.V = t.color, i.xc = t.horzAlign, i.Mc = t.vertAlign, i.bc = [{
				Kt: t.text,
				R: F(t.fontSize, t.fontFamily, t.fontStyle),
				gc: 1.2 * t.fontSize,
				Sc: 0,
				Zu: 0
			}]);
		}
	};
	Vn = class extends lt {
		constructor(t, i) {
			super(), this.cn = i, this.wn = new Dn(this);
		}
		Rn() {
			return [];
		}
		Pn() {
			return [this.wn];
		}
		W() {
			return this.cn;
		}
		Vn() {
			this.wn.bt();
		}
	};
	(function(t) {
		t[t.OnTouchEnd = 0] = "OnTouchEnd", t[t.OnNextTap = 1] = "OnNextTap";
	})(On || (On = {}));
	Ln = class {
		constructor(t, i, n) {
			this.yc = [], this.Cc = [], this.__ = 0, this.Tc = null, this.Pc = new D(), this.Rc = new D(), this.Dc = null, this.Vc = t, this.cn = i, this.q_ = n, this.Oc = new W(this), this.yl = new Tn(this, i.timeScale, this.cn.localization, n), this.vt = new ot(this, i.crosshair), this.Bc = new Ji(i.crosshair), this.Ac = new Vn(this, i.watermark), this.Ic(), this.yc[0].x_(2e3), this.zc = this.Lc(0), this.Ec = this.Lc(1);
		}
		Kl() {
			this.Nc(ut.es());
		}
		Uh() {
			this.Nc(ut.ss());
		}
		oa() {
			this.Nc(new ut(1));
		}
		Gl(t) {
			const i = this.Fc(t);
			this.Nc(i);
		}
		Wc() {
			return this.Tc;
		}
		jc(t) {
			const i = this.Tc;
			this.Tc = t, null !== i && this.Gl(i.Hc), null !== t && this.Gl(t.Hc);
		}
		W() {
			return this.cn;
		}
		$h(t) {
			V(this.cn, t), this.yc.forEach((i) => i.b_(t)), void 0 !== t.timeScale && this.yl.$h(t.timeScale), void 0 !== t.localization && this.yl.yu(t.localization), (t.leftPriceScale || t.rightPriceScale) && this.Pc.m(), this.zc = this.Lc(0), this.Ec = this.Lc(1), this.Kl();
		}
		$c(t, i) {
			if ("left" === t) return void this.$h({ leftPriceScale: i });
			if ("right" === t) return void this.$h({ rightPriceScale: i });
			const n = this.Uc(t);
			null !== n && (n.Dt.$h(i), this.Pc.m());
		}
		Uc(t) {
			for (const i of this.yc) {
				const n = i.w_(t);
				if (null !== n) return {
					Ht: i,
					Dt: n
				};
			}
			return null;
		}
		St() {
			return this.yl;
		}
		qc() {
			return this.yc;
		}
		Yc() {
			return this.Ac;
		}
		Zc() {
			return this.vt;
		}
		Xc() {
			return this.Rc;
		}
		Kc(t, i) {
			t.Lo(i), this.Wu();
		}
		S_(t) {
			this.__ = t, this.yl.S_(this.__), this.yc.forEach((i) => i.S_(t)), this.Wu();
		}
		Ic(t) {
			const i = new gn(this.yl, this);
			void 0 !== t ? this.yc.splice(t, 0, i) : this.yc.push(i);
			const n = void 0 === t ? this.yc.length - 1 : t, s = ut.es();
			return s.Nn(n, {
				Fn: 0,
				Wn: !0
			}), this.Nc(s), i;
		}
		V_(t, i, n) {
			t.V_(i, n);
		}
		O_(t, i, n) {
			t.O_(i, n), this.Jl(), this.Nc(this.Gc(t, 2));
		}
		B_(t, i) {
			t.B_(i), this.Nc(this.Gc(t, 2));
		}
		A_(t, i, n) {
			i.Vo() || t.A_(i, n);
		}
		I_(t, i, n) {
			i.Vo() || (t.I_(i, n), this.Jl(), this.Nc(this.Gc(t, 2)));
		}
		z_(t, i) {
			i.Vo() || (t.z_(i), this.Nc(this.Gc(t, 2)));
		}
		E_(t, i) {
			t.E_(i), this.Nc(this.Gc(t, 2));
		}
		Jc(t) {
			this.yl.Go(t);
		}
		Qc(t, i) {
			const n = this.St();
			if (n.Ni() || 0 === i) return;
			const s = n.Hi();
			t = Math.max(1, Math.min(t, s)), n.Zu(t, i), this.Wu();
		}
		td(t) {
			this.nd(0), this.sd(t), this.ed();
		}
		rd(t) {
			this.yl.Jo(t), this.Wu();
		}
		hd() {
			this.yl.Qo(), this.Uh();
		}
		nd(t) {
			this.yl.t_(t);
		}
		sd(t) {
			this.yl.i_(t), this.Wu();
		}
		ed() {
			this.yl.n_(), this.Uh();
		}
		wt() {
			return this.Cc;
		}
		ld(t, i, n, s, e$1) {
			this.vt.gn(t, i);
			let r$1 = NaN, h$1 = this.yl.Nu(t);
			const l$1 = this.yl.Xs();
			null !== l$1 && (h$1 = Math.min(Math.max(l$1.Os(), h$1), l$1.ui()));
			const a$1 = s.vn(), o$1 = a$1.Ct();
			null !== o$1 && (r$1 = a$1.pn(i, o$1)), r$1 = this.Bc.Oa(r$1, h$1, s), this.vt.kn(h$1, r$1, s), this.oa(), e$1 || this.Rc.m(this.vt.xt(), {
				x: t,
				y: i
			}, n);
		}
		ad(t, i, n) {
			const s = n.vn(), e$1 = s.Ct(), r$1 = s.Rt(t, b(e$1)), h$1 = this.yl.Va(i, !0), l$1 = this.yl.It(b(h$1));
			this.ld(l$1, r$1, null, n, !0);
		}
		od(t) {
			this.Zc().Cn(), this.oa(), t || this.Rc.m(null, null, null);
		}
		Jl() {
			const t = this.vt.Ht();
			if (null !== t) {
				const i = this.vt.xn(), n = this.vt.Sn();
				this.ld(i, n, null, t);
			}
			this.vt.Vn();
		}
		_d(t, i, n) {
			const s = this.yl.mn(0);
			void 0 !== i && void 0 !== n && this.yl.bt(i, n);
			const e$1 = this.yl.mn(0), r$1 = this.yl.Eu(), h$1 = this.yl.Xs();
			if (null !== h$1 && null !== s && null !== e$1) {
				const i$1 = h$1.Kr(r$1), l$1 = this.q_.key(s) > this.q_.key(e$1), a$1 = null !== t && t > r$1 && !l$1, o$1 = this.yl.W().allowShiftVisibleRangeOnWhitespaceReplacement, _$1 = i$1 && (!(void 0 === n) || o$1) && this.yl.W().shiftVisibleRangeOnNewBar;
				if (a$1 && !_$1) {
					const i$2 = t - r$1;
					this.yl.Jn(this.yl.Hu() - i$2);
				}
			}
			this.yl.Yu(t);
		}
		ia(t) {
			null !== t && t.F_();
		}
		dr(t) {
			const i = this.yc.find((i$1) => i$1.Uo().includes(t));
			return void 0 === i ? null : i;
		}
		Wu() {
			this.Ac.Vn(), this.yc.forEach((t) => t.F_()), this.Jl();
		}
		S() {
			this.yc.forEach((t) => t.S()), this.yc.length = 0, this.cn.localization.priceFormatter = void 0, this.cn.localization.percentageFormatter = void 0, this.cn.localization.timeFormatter = void 0;
		}
		ud() {
			return this.Oc;
		}
		br() {
			return this.Oc.W();
		}
		g_() {
			return this.Pc;
		}
		dd(t, i, n) {
			const s = this.yc[0], e$1 = this.fd(i, t, s, n);
			return this.Cc.push(e$1), 1 === this.Cc.length ? this.Kl() : this.Uh(), e$1;
		}
		vd(t) {
			const i = this.dr(t), n = this.Cc.indexOf(t);
			p(-1 !== n, "Series not found"), this.Cc.splice(n, 1), b(i).Zo(t), t.S && t.S();
		}
		Xl(t, i) {
			const n = b(this.dr(t));
			n.Zo(t);
			const s = this.Uc(i);
			if (null === s) {
				const s$1 = t.Xi();
				n.qo(t, i, s$1);
			} else {
				const e$1 = s.Ht === n ? t.Xi() : void 0;
				s.Ht.qo(t, i, e$1);
			}
		}
		hc() {
			const t = ut.ss();
			t.$n(), this.Nc(t);
		}
		pd(t) {
			const i = ut.ss();
			i.Yn(t), this.Nc(i);
		}
		Kn() {
			const t = ut.ss();
			t.Kn(), this.Nc(t);
		}
		Gn(t) {
			const i = ut.ss();
			i.Gn(t), this.Nc(i);
		}
		Jn(t) {
			const i = ut.ss();
			i.Jn(t), this.Nc(i);
		}
		Zn(t) {
			const i = ut.ss();
			i.Zn(t), this.Nc(i);
		}
		Un() {
			const t = ut.ss();
			t.Un(), this.Nc(t);
		}
		md() {
			return this.cn.rightPriceScale.visible ? "right" : "left";
		}
		bd() {
			return this.Ec;
		}
		q() {
			return this.zc;
		}
		Bt(t) {
			const i = this.Ec, n = this.zc;
			if (i === n) return i;
			if (t = Math.max(0, Math.min(100, Math.round(100 * t))), null === this.Dc || this.Dc.Ps !== n || this.Dc.Rs !== i) this.Dc = {
				Ps: n,
				Rs: i,
				wd: /* @__PURE__ */ new Map()
			};
			else {
				const i$1 = this.Dc.wd.get(t);
				if (void 0 !== i$1) return i$1;
			}
			const s = function(t$1, i$1, n$1) {
				const [s$1, e$1, r$1, h$1] = T(t$1), [l$1, a$1, o$1, _$1] = T(i$1), u$1 = [
					M(s$1 + n$1 * (l$1 - s$1)),
					M(e$1 + n$1 * (a$1 - e$1)),
					M(r$1 + n$1 * (o$1 - r$1)),
					x(h$1 + n$1 * (_$1 - h$1))
				];
				return `rgba(${u$1[0]}, ${u$1[1]}, ${u$1[2]}, ${u$1[3]})`;
			}(n, i, t / 100);
			return this.Dc.wd.set(t, s), s;
		}
		Gc(t, i) {
			const n = new ut(i);
			if (null !== t) {
				const s = this.yc.indexOf(t);
				n.Nn(s, { Fn: i });
			}
			return n;
		}
		Fc(t, i) {
			return void 0 === i && (i = 2), this.Gc(this.dr(t), i);
		}
		Nc(t) {
			this.Vc && this.Vc(t), this.yc.forEach((t$1) => t$1.j_().qh().bt());
		}
		fd(t, i, n, s) {
			const e$1 = new Gi(this, t, i, n, s), r$1 = void 0 !== t.priceScaleId ? t.priceScaleId : this.md();
			return n.qo(e$1, r$1), _t(r$1) || e$1.$h(t), e$1;
		}
		Lc(t) {
			const i = this.cn.layout;
			return "gradient" === i.background.type ? 0 === t ? i.background.topColor : i.background.bottomColor : i.background.color;
		}
	};
	(function(t) {
		t[t.Disabled = 0] = "Disabled", t[t.Continuous = 1] = "Continuous", t[t.OnDataUpdate = 2] = "OnDataUpdate";
	})(Bn || (Bn = {})), function(t) {
		t[t.LastBar = 0] = "LastBar", t[t.LastVisible = 1] = "LastVisible";
	}(An || (An = {})), function(t) {
		t.Solid = "solid", t.VerticalGradient = "gradient";
	}(In || (In = {})), function(t) {
		t[t.Year = 0] = "Year", t[t.Month = 1] = "Month", t[t.DayOfMonth = 2] = "DayOfMonth", t[t.Time = 3] = "Time", t[t.TimeWithSeconds = 4] = "TimeWithSeconds";
	}(zn || (zn = {}));
	Fn = (t) => t.getUTCFullYear();
	jn = class {
		constructor(t = "yyyy-MM-dd", i = "default") {
			this.gd = t, this.Md = i;
		}
		Y_(t) {
			return Wn(t, this.gd, this.Md);
		}
	};
	Hn = class {
		constructor(t) {
			this.xd = t || "%h:%m:%s";
		}
		Y_(t) {
			return this.xd.replace("%h", dt(t.getUTCHours(), 2)).replace("%m", dt(t.getUTCMinutes(), 2)).replace("%s", dt(t.getUTCSeconds(), 2));
		}
	};
	$n = {
		Sd: "yyyy-MM-dd",
		kd: "%h:%m:%s",
		yd: " ",
		Cd: "default"
	};
	Un = class {
		constructor(t = {}) {
			const i = Object.assign(Object.assign({}, $n), t);
			this.Td = new jn(i.Sd, i.Cd), this.Pd = new Hn(i.kd), this.Rd = i.yd;
		}
		Y_(t) {
			return `${this.Td.Y_(t)}${this.Rd}${this.Pd.Y_(t)}`;
		}
	};
	Zn = [
		{
			Dd: (Xn = 1, 1e3 * Xn),
			Vd: 10
		},
		{
			Dd: Yn(1),
			Vd: 20
		},
		{
			Dd: Yn(5),
			Vd: 21
		},
		{
			Dd: Yn(30),
			Vd: 22
		},
		{
			Dd: qn(1),
			Vd: 30
		},
		{
			Dd: qn(3),
			Vd: 31
		},
		{
			Dd: qn(6),
			Vd: 32
		},
		{
			Dd: qn(12),
			Vd: 33
		}
	];
	is = class {
		options() {
			return this.cn;
		}
		setOptions(t) {
			this.cn = t, this.updateFormatter(t.localization);
		}
		preprocessData(t) {
			Array.isArray(t) ? function(t$1) {
				t$1.forEach(ts);
			}(t) : ts(t);
		}
		createConverterToInternalObj(t) {
			return b(function(t$1) {
				return 0 === t$1.length ? null : En(t$1[0].time) || A(t$1[0].time) ? Gn : Jn;
			}(t));
		}
		key(t) {
			return "object" == typeof t && "Od" in t ? t.Od : this.key(this.convertHorzItemToInternal(t));
		}
		cacheKey(t) {
			const i = t;
			return void 0 === i.Bd ? (/* @__PURE__ */ new Date(1e3 * i.Od)).getTime() : new Date(Date.UTC(i.Bd.year, i.Bd.month - 1, i.Bd.day)).getTime();
		}
		convertHorzItemToInternal(t) {
			return Nn(i = t) ? Jn(i) : En(i) ? Gn(i) : Gn(Qn(i));
			var i;
		}
		updateFormatter(t) {
			if (!this.cn) return;
			const i = t.dateFormat;
			this.cn.timeScale.timeVisible ? this.Ad = new Un({
				Sd: i,
				kd: this.cn.timeScale.secondsVisible ? "%h:%m:%s" : "%h:%m",
				yd: "   ",
				Cd: t.locale
			}) : this.Ad = new jn(i, t.locale);
		}
		formatHorzItem(t) {
			const i = t;
			return this.Ad.Y_(/* @__PURE__ */ new Date(1e3 * i.Od));
		}
		formatTickmark(t, i) {
			const n = function(t$1, i$1, n$1) {
				switch (t$1) {
					case 0:
					case 10: return i$1 ? n$1 ? 4 : 3 : 2;
					case 20:
					case 21:
					case 22:
					case 30:
					case 31:
					case 32:
					case 33: return i$1 ? 3 : 2;
					case 50: return 2;
					case 60: return 1;
					case 70: return 0;
				}
			}(t.weight, this.cn.timeScale.timeVisible, this.cn.timeScale.secondsVisible), s = this.cn.timeScale;
			if (void 0 !== s.tickMarkFormatter) {
				const e$1 = s.tickMarkFormatter(t.originalTime, n, i.locale);
				if (null !== e$1) return e$1;
			}
			return function(t$1, i$1, n$1) {
				const s$1 = {};
				switch (i$1) {
					case 0:
						s$1.year = "numeric";
						break;
					case 1:
						s$1.month = "short";
						break;
					case 2:
						s$1.day = "numeric";
						break;
					case 3:
						s$1.hour12 = !1, s$1.hour = "2-digit", s$1.minute = "2-digit";
						break;
					case 4: s$1.hour12 = !1, s$1.hour = "2-digit", s$1.minute = "2-digit", s$1.second = "2-digit";
				}
				const e$1 = void 0 === t$1.Bd ? /* @__PURE__ */ new Date(1e3 * t$1.Od) : new Date(Date.UTC(t$1.Bd.year, t$1.Bd.month - 1, t$1.Bd.day));
				return new Date(e$1.getUTCFullYear(), e$1.getUTCMonth(), e$1.getUTCDate(), e$1.getUTCHours(), e$1.getUTCMinutes(), e$1.getUTCSeconds(), e$1.getUTCMilliseconds()).toLocaleString(n$1, s$1);
			}(t.time, n, i.locale);
		}
		maxTickMarkWeight(t) {
			let i = t.reduce(Cn, t[0]).weight;
			return i > 30 && i < 50 && (i = 30), i;
		}
		fillWeightsForPoints(t, i) {
			(function(t$1, i$1 = 0) {
				if (0 === t$1.length) return;
				let n = 0 === i$1 ? null : t$1[i$1 - 1].time.Od, s = null !== n ? /* @__PURE__ */ new Date(1e3 * n) : null, e$1 = 0;
				for (let r$1 = i$1; r$1 < t$1.length; ++r$1) {
					const i$2 = t$1[r$1], h$1 = /* @__PURE__ */ new Date(1e3 * i$2.time.Od);
					null !== s && (i$2.timeWeight = Kn(h$1, s)), e$1 += i$2.time.Od - (n || i$2.time.Od), n = i$2.time.Od, s = h$1;
				}
				if (0 === i$1 && t$1.length > 1) {
					const i$2 = Math.ceil(e$1 / (t$1.length - 1)), n$1 = /* @__PURE__ */ new Date(1e3 * (t$1[0].time.Od - i$2));
					t$1[0].timeWeight = Kn(/* @__PURE__ */ new Date(1e3 * t$1[0].time.Od), n$1);
				}
			})(t, i);
		}
		static Id(t) {
			return V({ localization: { dateFormat: "dd MMM 'yy" } }, null != t ? t : {});
		}
	};
	ns = "undefined" != typeof window;
	as = class {
		constructor(t, i, n, s) {
			this.Ld = null, this.Ed = null, this.Nd = null, this.Fd = null, this.Wd = null, this.jd = 0, this.Hd = 0, this.$d = t, this.Ud = i, this.qd = n, this.rs = s;
		}
		Yd(t, i) {
			if (null !== this.Ld) {
				if (this.Ld.ot === i) return void (this.Ld.zd = t);
				if (Math.abs(this.Ld.zd - t) < this.rs) return;
			}
			this.Fd = this.Nd, this.Nd = this.Ed, this.Ed = this.Ld, this.Ld = {
				ot: i,
				zd: t
			};
		}
		Vr(t, i) {
			if (null === this.Ld || null === this.Ed) return;
			if (i - this.Ld.ot > 50) return;
			let n = 0;
			const s = ls(this.Ld, this.Ed, this.Ud), e$1 = hs(this.Ld, this.Ed), r$1 = [s], h$1 = [e$1];
			if (n += e$1, null !== this.Nd) {
				const t$1 = ls(this.Ed, this.Nd, this.Ud);
				if (Math.sign(t$1) === Math.sign(s)) {
					const i$1 = hs(this.Ed, this.Nd);
					if (r$1.push(t$1), h$1.push(i$1), n += i$1, null !== this.Fd) {
						const t$2 = ls(this.Nd, this.Fd, this.Ud);
						if (Math.sign(t$2) === Math.sign(s)) {
							const i$2 = hs(this.Nd, this.Fd);
							r$1.push(t$2), h$1.push(i$2), n += i$2;
						}
					}
				}
			}
			let l$1 = 0;
			for (let t$1 = 0; t$1 < r$1.length; ++t$1) l$1 += h$1[t$1] / n * r$1[t$1];
			Math.abs(l$1) < this.$d || (this.Wd = {
				zd: t,
				ot: i
			}, this.Hd = l$1, this.jd = function(t$1, i$1) {
				const n$1 = Math.log(i$1);
				return Math.log(1 * n$1 / -t$1) / n$1;
			}(Math.abs(l$1), this.qd));
		}
		tc(t) {
			const i = b(this.Wd), n = t - i.ot;
			return i.zd + this.Hd * (Math.pow(this.qd, n) - 1) / Math.log(this.qd);
		}
		Qu(t) {
			return null === this.Wd || this.Zd(t) === this.jd;
		}
		Zd(t) {
			const i = t - b(this.Wd).ot;
			return Math.min(i, this.jd);
		}
	};
	os = class {
		constructor(t, i) {
			this.Xd = void 0, this.Kd = void 0, this.Gd = void 0, this.en = !1, this.Jd = t, this.Qd = i, this.tf();
		}
		bt() {
			this.tf();
		}
		if() {
			this.Xd && this.Jd.removeChild(this.Xd), this.Kd && this.Jd.removeChild(this.Kd), this.Xd = void 0, this.Kd = void 0;
		}
		nf() {
			return this.en !== this.sf() || this.Gd !== this.ef();
		}
		ef() {
			return P(T(this.Qd.W().layout.textColor)) > 160 ? "dark" : "light";
		}
		sf() {
			return this.Qd.W().layout.attributionLogo;
		}
		rf() {
			const t = new URL(location.href);
			return t.hostname ? "&utm_source=" + t.hostname + t.pathname : "";
		}
		tf() {
			this.nf() && (this.if(), this.en = this.sf(), this.en && (this.Gd = this.ef(), this.Kd = document.createElement("style"), this.Kd.innerText = "a#tv-attr-logo{--fill:#131722;--stroke:#fff;position:absolute;left:10px;bottom:10px;height:19px;width:35px;margin:0;padding:0;border:0;z-index:3;}a#tv-attr-logo[data-dark]{--fill:#D1D4DC;--stroke:#131722;}", this.Xd = document.createElement("a"), this.Xd.href = `https://www.tradingview.com/?utm_medium=lwc-link&utm_campaign=lwc-chart${this.rf()}`, this.Xd.title = "Charting by TradingView", this.Xd.id = "tv-attr-logo", this.Xd.target = "_blank", this.Xd.innerHTML = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 35 19\" width=\"35\" height=\"19\" fill=\"none\"><g fill-rule=\"evenodd\" clip-path=\"url(#a)\" clip-rule=\"evenodd\"><path fill=\"var(--stroke)\" d=\"M2 0H0v10h6v9h21.4l.5-1.3 6-15 1-2.7H23.7l-.5 1.3-.2.6a5 5 0 0 0-7-.9V0H2Zm20 17h4l5.2-13 .8-2h-7l-1 2.5-.2.5-1.5 3.8-.3.7V17Zm-.8-10a3 3 0 0 0 .7-2.7A3 3 0 1 0 16.8 7h4.4ZM14 7V2H2v6h6v9h4V7h2Z\"/><path fill=\"var(--fill)\" d=\"M14 2H2v6h6v9h6V2Zm12 15h-7l6-15h7l-6 15Zm-7-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z\"/></g><defs><clipPath id=\"a\"><path fill=\"var(--stroke)\" d=\"M0 0h35v19H0z\"/></clipPath></defs></svg>", this.Xd.toggleAttribute("data-dark", "dark" === this.Gd), this.Jd.appendChild(this.Kd), this.Jd.appendChild(this.Xd)));
		}
	};
	ps = class {
		constructor(t, i, n) {
			this.hf = 0, this.lf = null, this.af = {
				nt: Number.NEGATIVE_INFINITY,
				st: Number.POSITIVE_INFINITY
			}, this._f = 0, this.uf = null, this.cf = {
				nt: Number.NEGATIVE_INFINITY,
				st: Number.POSITIVE_INFINITY
			}, this.df = null, this.ff = !1, this.vf = null, this.pf = null, this.mf = !1, this.bf = !1, this.wf = !1, this.gf = null, this.Mf = null, this.xf = null, this.Sf = null, this.kf = null, this.yf = null, this.Cf = null, this.Tf = 0, this.Pf = !1, this.Rf = !1, this.Df = !1, this.Vf = 0, this.Of = null, this.Bf = !es(), this.Af = (t$1) => {
				this.If(t$1);
			}, this.zf = (t$1) => {
				if (this.Lf(t$1)) {
					const i$1 = this.Ef(t$1);
					if (++this._f, this.uf && this._f > 1) {
						const { Nf: n$1 } = this.Ff(ws(t$1), this.cf);
						n$1 < 30 && !this.wf && this.Wf(i$1, this.Hf.jf), this.$f();
					}
				} else {
					const i$1 = this.Ef(t$1);
					if (++this.hf, this.lf && this.hf > 1) {
						const { Nf: n$1 } = this.Ff(ws(t$1), this.af);
						n$1 < 5 && !this.bf && this.Uf(i$1, this.Hf.qf), this.Yf();
					}
				}
			}, this.Zf = t, this.Hf = i, this.cn = n, this.Xf();
		}
		S() {
			null !== this.gf && (this.gf(), this.gf = null), null !== this.Mf && (this.Mf(), this.Mf = null), null !== this.Sf && (this.Sf(), this.Sf = null), null !== this.kf && (this.kf(), this.kf = null), null !== this.yf && (this.yf(), this.yf = null), null !== this.xf && (this.xf(), this.xf = null), this.Kf(), this.Yf();
		}
		Gf(t) {
			this.Sf && this.Sf();
			const i = this.Jf.bind(this);
			if (this.Sf = () => {
				this.Zf.removeEventListener("mousemove", i);
			}, this.Zf.addEventListener("mousemove", i), this.Lf(t)) return;
			const n = this.Ef(t);
			this.Uf(n, this.Hf.Qf), this.Bf = !0;
		}
		Yf() {
			null !== this.lf && clearTimeout(this.lf), this.hf = 0, this.lf = null, this.af = {
				nt: Number.NEGATIVE_INFINITY,
				st: Number.POSITIVE_INFINITY
			};
		}
		$f() {
			null !== this.uf && clearTimeout(this.uf), this._f = 0, this.uf = null, this.cf = {
				nt: Number.NEGATIVE_INFINITY,
				st: Number.POSITIVE_INFINITY
			};
		}
		Jf(t) {
			if (this.Df || null !== this.pf) return;
			if (this.Lf(t)) return;
			const i = this.Ef(t);
			this.Uf(i, this.Hf.tv), this.Bf = !0;
		}
		iv(t) {
			const i = Ms(t.changedTouches, b(this.Of));
			if (null === i) return;
			if (this.Vf = gs(t), null !== this.Cf) return;
			if (this.Rf) return;
			this.Pf = !0;
			const n = this.Ff(ws(i), b(this.pf)), { nv: s, sv: e$1, Nf: r$1 } = n;
			if (this.mf || !(r$1 < 5)) {
				if (!this.mf) {
					const t$1 = .5 * s, i$1 = e$1 >= t$1 && !this.cn.ev(), n$1 = t$1 > e$1 && !this.cn.rv();
					i$1 || n$1 || (this.Rf = !0), this.mf = !0, this.wf = !0, this.Kf(), this.$f();
				}
				if (!this.Rf) {
					const n$1 = this.Ef(t, i);
					this.Wf(n$1, this.Hf.hv), bs(t);
				}
			}
		}
		lv(t) {
			if (0 !== t.button) return;
			const i = this.Ff(ws(t), b(this.vf)), { Nf: n } = i;
			if (n >= 5 && (this.bf = !0, this.Yf()), this.bf) {
				const i$1 = this.Ef(t);
				this.Uf(i$1, this.Hf.av);
			}
		}
		Ff(t, i) {
			const n = Math.abs(i.nt - t.nt), s = Math.abs(i.st - t.st);
			return {
				nv: n,
				sv: s,
				Nf: n + s
			};
		}
		ov(t) {
			let i = Ms(t.changedTouches, b(this.Of));
			if (null === i && 0 === t.touches.length && (i = t.changedTouches[0]), null === i) return;
			this.Of = null, this.Vf = gs(t), this.Kf(), this.pf = null, this.yf && (this.yf(), this.yf = null);
			const n = this.Ef(t, i);
			if (this.Wf(n, this.Hf._v), ++this._f, this.uf && this._f > 1) {
				const { Nf: t$1 } = this.Ff(ws(i), this.cf);
				t$1 < 30 && !this.wf && this.Wf(n, this.Hf.jf), this.$f();
			} else this.wf || (this.Wf(n, this.Hf.uv), this.Hf.uv && bs(t));
			0 === this._f && bs(t), 0 === t.touches.length && this.ff && (this.ff = !1, bs(t));
		}
		If(t) {
			if (0 !== t.button) return;
			const i = this.Ef(t);
			if (this.vf = null, this.Df = !1, this.kf && (this.kf(), this.kf = null), ss()) this.Zf.ownerDocument.documentElement.removeEventListener("mouseleave", this.Af);
			if (!this.Lf(t)) if (this.Uf(i, this.Hf.cv), ++this.hf, this.lf && this.hf > 1) {
				const { Nf: n } = this.Ff(ws(t), this.af);
				n < 5 && !this.bf && this.Uf(i, this.Hf.qf), this.Yf();
			} else this.bf || this.Uf(i, this.Hf.dv);
		}
		Kf() {
			null !== this.df && (clearTimeout(this.df), this.df = null);
		}
		fv(t) {
			if (null !== this.Of) return;
			const i = t.changedTouches[0];
			this.Of = i.identifier, this.Vf = gs(t);
			const n = this.Zf.ownerDocument.documentElement;
			this.wf = !1, this.mf = !1, this.Rf = !1, this.pf = ws(i), this.yf && (this.yf(), this.yf = null);
			{
				const i$1 = this.iv.bind(this), s$1 = this.ov.bind(this);
				this.yf = () => {
					n.removeEventListener("touchmove", i$1), n.removeEventListener("touchend", s$1);
				}, n.addEventListener("touchmove", i$1, { passive: !1 }), n.addEventListener("touchend", s$1, { passive: !1 }), this.Kf(), this.df = setTimeout(this.vv.bind(this, t), 240);
			}
			const s = this.Ef(t, i);
			this.Wf(s, this.Hf.pv), this.uf || (this._f = 0, this.uf = setTimeout(this.$f.bind(this), 500), this.cf = ws(i));
		}
		mv(t) {
			if (0 !== t.button) return;
			const i = this.Zf.ownerDocument.documentElement;
			ss() && i.addEventListener("mouseleave", this.Af), this.bf = !1, this.vf = ws(t), this.kf && (this.kf(), this.kf = null);
			{
				const t$1 = this.lv.bind(this), n$1 = this.If.bind(this);
				this.kf = () => {
					i.removeEventListener("mousemove", t$1), i.removeEventListener("mouseup", n$1);
				}, i.addEventListener("mousemove", t$1), i.addEventListener("mouseup", n$1);
			}
			if (this.Df = !0, this.Lf(t)) return;
			const n = this.Ef(t);
			this.Uf(n, this.Hf.bv), this.lf || (this.hf = 0, this.lf = setTimeout(this.Yf.bind(this), 500), this.af = ws(t));
		}
		Xf() {
			this.Zf.addEventListener("mouseenter", this.Gf.bind(this)), this.Zf.addEventListener("touchcancel", this.Kf.bind(this));
			{
				const t = this.Zf.ownerDocument, i = (t$1) => {
					this.Hf.wv && (t$1.composed && this.Zf.contains(t$1.composedPath()[0]) || t$1.target && this.Zf.contains(t$1.target) || this.Hf.wv());
				};
				this.Mf = () => {
					t.removeEventListener("touchstart", i);
				}, this.gf = () => {
					t.removeEventListener("mousedown", i);
				}, t.addEventListener("mousedown", i), t.addEventListener("touchstart", i, { passive: !0 });
			}
			es() && (this.xf = () => {
				this.Zf.removeEventListener("dblclick", this.zf);
			}, this.Zf.addEventListener("dblclick", this.zf)), this.Zf.addEventListener("mouseleave", this.gv.bind(this)), this.Zf.addEventListener("touchstart", this.fv.bind(this), { passive: !0 }), vs(this.Zf), this.Zf.addEventListener("mousedown", this.mv.bind(this)), this.Mv(), this.Zf.addEventListener("touchmove", () => {}, { passive: !1 });
		}
		Mv() {
			void 0 === this.Hf.xv && void 0 === this.Hf.Sv && void 0 === this.Hf.kv || (this.Zf.addEventListener("touchstart", (t) => this.yv(t.touches), { passive: !0 }), this.Zf.addEventListener("touchmove", (t) => {
				if (2 === t.touches.length && null !== this.Cf && void 0 !== this.Hf.Sv) {
					const i = ms(t.touches[0], t.touches[1]) / this.Tf;
					this.Hf.Sv(this.Cf, i), bs(t);
				}
			}, { passive: !1 }), this.Zf.addEventListener("touchend", (t) => {
				this.yv(t.touches);
			}));
		}
		yv(t) {
			1 === t.length && (this.Pf = !1), 2 !== t.length || this.Pf || this.ff ? this.Cv() : this.Tv(t);
		}
		Tv(t) {
			const i = this.Zf.getBoundingClientRect() || {
				left: 0,
				top: 0
			};
			this.Cf = {
				nt: (t[0].clientX - i.left + (t[1].clientX - i.left)) / 2,
				st: (t[0].clientY - i.top + (t[1].clientY - i.top)) / 2
			}, this.Tf = ms(t[0], t[1]), void 0 !== this.Hf.xv && this.Hf.xv(), this.Kf();
		}
		Cv() {
			null !== this.Cf && (this.Cf = null, void 0 !== this.Hf.kv && this.Hf.kv());
		}
		gv(t) {
			if (this.Sf && this.Sf(), this.Lf(t)) return;
			if (!this.Bf) return;
			const i = this.Ef(t);
			this.Uf(i, this.Hf.Pv), this.Bf = !es();
		}
		vv(t) {
			const i = Ms(t.touches, b(this.Of));
			if (null === i) return;
			const n = this.Ef(t, i);
			this.Wf(n, this.Hf.Rv), this.wf = !0, this.ff = !0;
		}
		Lf(t) {
			return t.sourceCapabilities && void 0 !== t.sourceCapabilities.firesTouchEvents ? t.sourceCapabilities.firesTouchEvents : gs(t) < this.Vf + 500;
		}
		Wf(t, i) {
			i && i.call(this.Hf, t);
		}
		Uf(t, i) {
			i && i.call(this.Hf, t);
		}
		Ef(t, i) {
			const n = i || t, s = this.Zf.getBoundingClientRect() || {
				left: 0,
				top: 0
			};
			return {
				clientX: n.clientX,
				clientY: n.clientY,
				pageX: n.pageX,
				pageY: n.pageY,
				screenX: n.screenX,
				screenY: n.screenY,
				localX: n.clientX - s.left,
				localY: n.clientY - s.top,
				ctrlKey: t.ctrlKey,
				altKey: t.altKey,
				shiftKey: t.shiftKey,
				metaKey: t.metaKey,
				Dv: !t.type.startsWith("mouse") && "contextmenu" !== t.type && "click" !== t.type,
				Vv: t.type,
				Ov: n.target,
				Bv: t.view,
				Av: () => {
					"touchstart" !== t.type && bs(t);
				}
			};
		}
	};
	Cs = class {
		constructor(i, n, s, e$1) {
			this.Li = null, this.Ev = null, this.Nv = !1, this.Fv = new ni(200), this.Qr = null, this.Wv = 0, this.jv = !1, this.Hv = () => {
				this.jv || this.tn.$v().$t().Uh();
			}, this.Uv = () => {
				this.jv || this.tn.$v().$t().Uh();
			}, this.tn = i, this.cn = n, this.ko = n.layout, this.Oc = s, this.qv = "left" === e$1, this.Yv = ks("normal", e$1), this.Zv = ks("top", e$1), this.Xv = ks("bottom", e$1), this.Kv = document.createElement("div"), this.Kv.style.height = "100%", this.Kv.style.overflow = "hidden", this.Kv.style.width = "25px", this.Kv.style.left = "0", this.Kv.style.position = "relative", this.Gv = _s(this.Kv, size({
				width: 16,
				height: 16
			})), this.Gv.subscribeSuggestedBitmapSizeChanged(this.Hv);
			const r$1 = this.Gv.canvasElement;
			r$1.style.position = "absolute", r$1.style.zIndex = "1", r$1.style.left = "0", r$1.style.top = "0", this.Jv = _s(this.Kv, size({
				width: 16,
				height: 16
			})), this.Jv.subscribeSuggestedBitmapSizeChanged(this.Uv);
			const h$1 = this.Jv.canvasElement;
			h$1.style.position = "absolute", h$1.style.zIndex = "2", h$1.style.left = "0", h$1.style.top = "0";
			const l$1 = {
				bv: this.Qv.bind(this),
				pv: this.Qv.bind(this),
				av: this.tp.bind(this),
				hv: this.tp.bind(this),
				wv: this.ip.bind(this),
				cv: this.np.bind(this),
				_v: this.np.bind(this),
				qf: this.sp.bind(this),
				jf: this.sp.bind(this),
				Qf: this.ep.bind(this),
				Pv: this.rp.bind(this)
			};
			this.hp = new ps(this.Jv.canvasElement, l$1, {
				ev: () => !this.cn.handleScroll.vertTouchDrag,
				rv: () => !0
			});
		}
		S() {
			this.hp.S(), this.Jv.unsubscribeSuggestedBitmapSizeChanged(this.Uv), us(this.Jv.canvasElement), this.Jv.dispose(), this.Gv.unsubscribeSuggestedBitmapSizeChanged(this.Hv), us(this.Gv.canvasElement), this.Gv.dispose(), null !== this.Li && this.Li.Ko().p(this), this.Li = null;
		}
		lp() {
			return this.Kv;
		}
		P() {
			return this.ko.fontSize;
		}
		ap() {
			const t = this.Oc.W();
			return this.Qr !== t.R && (this.Fv.nr(), this.Qr = t.R), t;
		}
		op() {
			if (null === this.Li) return 0;
			let t = 0;
			const i = this.ap(), n = b(this.Gv.canvasElement.getContext("2d"));
			n.save();
			const s = this.Li.Ha();
			n.font = this._p(), s.length > 0 && (t = Math.max(this.Fv.xi(n, s[0].so), this.Fv.xi(n, s[s.length - 1].so)));
			const e$1 = this.up();
			for (let i$1 = e$1.length; i$1--;) {
				const s$1 = this.Fv.xi(n, e$1[i$1].Kt());
				s$1 > t && (t = s$1);
			}
			const r$1 = this.Li.Ct();
			if (null !== r$1 && null !== this.Ev && 2 !== (h$1 = this.cn.crosshair).mode && h$1.horzLine.visible && h$1.horzLine.labelVisible) {
				const i$1 = this.Li.pn(1, r$1), s$1 = this.Li.pn(this.Ev.height - 2, r$1);
				t = Math.max(t, this.Fv.xi(n, this.Li.Fi(Math.floor(Math.min(i$1, s$1)) + .11111111111111, r$1)), this.Fv.xi(n, this.Li.Fi(Math.ceil(Math.max(i$1, s$1)) - .11111111111111, r$1)));
			}
			var h$1;
			n.restore();
			const l$1 = t || 34;
			return rs(Math.ceil(i.C + i.T + i.A + i.I + 5 + l$1));
		}
		cp(t) {
			null !== this.Ev && equalSizes(this.Ev, t) || (this.Ev = t, this.jv = !0, this.Gv.resizeCanvasElement(t), this.Jv.resizeCanvasElement(t), this.jv = !1, this.Kv.style.width = `${t.width}px`, this.Kv.style.height = `${t.height}px`);
		}
		dp() {
			return b(this.Ev).width;
		}
		Gi(t) {
			this.Li !== t && (null !== this.Li && this.Li.Ko().p(this), this.Li = t, t.Ko().l(this.fo.bind(this), this));
		}
		Dt() {
			return this.Li;
		}
		nr() {
			const t = this.tn.fp();
			this.tn.$v().$t().E_(t, b(this.Dt()));
		}
		vp(t) {
			if (null === this.Ev) return;
			if (1 !== t) {
				this.pp(), this.Gv.applySuggestedBitmapSize();
				const t$1 = tryCreateCanvasRenderingTarget2D(this.Gv);
				null !== t$1 && (t$1.useBitmapCoordinateSpace((t$2) => {
					this.mp(t$2), this.Ie(t$2);
				}), this.tn.bp(t$1, this.Xv), this.wp(t$1), this.tn.bp(t$1, this.Yv), this.gp(t$1));
			}
			this.Jv.applySuggestedBitmapSize();
			const i = tryCreateCanvasRenderingTarget2D(this.Jv);
			null !== i && (i.useBitmapCoordinateSpace(({ context: t$1, bitmapSize: i$1 }) => {
				t$1.clearRect(0, 0, i$1.width, i$1.height);
			}), this.Mp(i), this.tn.bp(i, this.Zv));
		}
		xp() {
			return this.Gv.bitmapSize;
		}
		Sp(t, i, n) {
			const s = this.xp();
			s.width > 0 && s.height > 0 && t.drawImage(this.Gv.canvasElement, i, n);
		}
		bt() {
			var t;
			null === (t = this.Li) || void 0 === t || t.Ha();
		}
		Qv(t) {
			if (null === this.Li || this.Li.Ni() || !this.cn.handleScale.axisPressedMouseMove.price) return;
			const i = this.tn.$v().$t(), n = this.tn.fp();
			this.Nv = !0, i.V_(n, this.Li, t.localY);
		}
		tp(t) {
			if (null === this.Li || !this.cn.handleScale.axisPressedMouseMove.price) return;
			const i = this.tn.$v().$t(), n = this.tn.fp(), s = this.Li;
			i.O_(n, s, t.localY);
		}
		ip() {
			if (null === this.Li || !this.cn.handleScale.axisPressedMouseMove.price) return;
			const t = this.tn.$v().$t(), i = this.tn.fp(), n = this.Li;
			this.Nv && (this.Nv = !1, t.B_(i, n));
		}
		np(t) {
			if (null === this.Li || !this.cn.handleScale.axisPressedMouseMove.price) return;
			const i = this.tn.$v().$t(), n = this.tn.fp();
			this.Nv = !1, i.B_(n, this.Li);
		}
		sp(t) {
			this.cn.handleScale.axisDoubleClickReset.price && this.nr();
		}
		ep(t) {
			if (null === this.Li) return;
			!this.tn.$v().$t().W().handleScale.axisPressedMouseMove.price || this.Li.Mh() || this.Li.Oo() || this.kp(1);
		}
		rp(t) {
			this.kp(0);
		}
		up() {
			const t = [], i = null === this.Li ? void 0 : this.Li;
			return ((n) => {
				for (let s = 0; s < n.length; ++s) {
					const e$1 = n[s].Rn(this.tn.fp(), i);
					for (let i$1 = 0; i$1 < e$1.length; i$1++) t.push(e$1[i$1]);
				}
			})(this.tn.fp().Uo()), t;
		}
		mp({ context: t, bitmapSize: i }) {
			const { width: n, height: s } = i, e$1 = this.tn.fp().$t(), r$1 = e$1.q(), h$1 = e$1.bd();
			r$1 === h$1 ? G(t, 0, 0, n, s, r$1) : tt(t, 0, 0, n, s, r$1, h$1);
		}
		Ie({ context: t, bitmapSize: i, horizontalPixelRatio: n }) {
			if (null === this.Ev || null === this.Li || !this.Li.W().borderVisible) return;
			t.fillStyle = this.Li.W().borderColor;
			const s = Math.max(1, Math.floor(this.ap().C * n));
			let e$1;
			e$1 = this.qv ? i.width - s : 0, t.fillRect(e$1, 0, s, i.height);
		}
		wp(t) {
			if (null === this.Ev || null === this.Li) return;
			const i = this.Li.Ha(), n = this.Li.W(), s = this.ap(), e$1 = this.qv ? this.Ev.width - s.T : 0;
			n.borderVisible && n.ticksVisible && t.useBitmapCoordinateSpace(({ context: t$1, horizontalPixelRatio: r$1, verticalPixelRatio: h$1 }) => {
				t$1.fillStyle = n.borderColor;
				const l$1 = Math.max(1, Math.floor(h$1)), a$1 = Math.floor(.5 * h$1), o$1 = Math.round(s.T * r$1);
				t$1.beginPath();
				for (const n$1 of i) t$1.rect(Math.floor(e$1 * r$1), Math.round(n$1.Ea * h$1) - a$1, o$1, l$1);
				t$1.fill();
			}), t.useMediaCoordinateSpace(({ context: t$1 }) => {
				var r$1;
				t$1.font = this._p(), t$1.fillStyle = null !== (r$1 = n.textColor) && void 0 !== r$1 ? r$1 : this.ko.textColor, t$1.textAlign = this.qv ? "right" : "left", t$1.textBaseline = "middle";
				const h$1 = this.qv ? Math.round(e$1 - s.A) : Math.round(e$1 + s.T + s.A), l$1 = i.map((i$1) => this.Fv.Mi(t$1, i$1.so));
				for (let n$1 = i.length; n$1--;) {
					const s$1 = i[n$1];
					t$1.fillText(s$1.so, h$1, s$1.Ea + l$1[n$1]);
				}
			});
		}
		pp() {
			if (null === this.Ev || null === this.Li) return;
			const t = [], i = this.Li.Uo().slice(), n = this.tn.fp(), s = this.ap();
			this.Li === n.pr() && this.tn.fp().Uo().forEach((t$1) => {
				n.vr(t$1) && i.push(t$1);
			});
			const e$1 = this.Li;
			i.forEach((i$1) => {
				i$1.Rn(n, e$1).forEach((i$2) => {
					i$2.Oi(null), i$2.Bi() && t.push(i$2);
				});
			}), t.forEach((t$1) => t$1.Oi(t$1.ki()));
			this.Li.W().alignLabels && this.yp(t, s);
		}
		yp(t, i) {
			if (null === this.Ev) return;
			const n = this.Ev.height / 2, s = t.filter((t$1) => t$1.ki() <= n), e$1 = t.filter((t$1) => t$1.ki() > n);
			s.sort((t$1, i$1) => i$1.ki() - t$1.ki()), e$1.sort((t$1, i$1) => t$1.ki() - i$1.ki());
			for (const n$1 of t) {
				const t$1 = Math.floor(n$1.At(i) / 2), s$1 = n$1.ki();
				s$1 > -t$1 && s$1 < t$1 && n$1.Oi(t$1), s$1 > this.Ev.height - t$1 && s$1 < this.Ev.height + t$1 && n$1.Oi(this.Ev.height - t$1);
			}
			ys(s, 1, this.Ev.height, i), ys(e$1, -1, this.Ev.height, i);
		}
		gp(t) {
			if (null === this.Ev) return;
			const i = this.up(), n = this.ap(), s = this.qv ? "right" : "left";
			i.forEach((i$1) => {
				if (i$1.Ai()) i$1.gt(b(this.Li)).X(t, n, this.Fv, s);
			});
		}
		Mp(t) {
			if (null === this.Ev || null === this.Li) return;
			const i = this.tn.$v().$t(), n = [], s = this.tn.fp(), e$1 = i.Zc().Rn(s, this.Li);
			e$1.length && n.push(e$1);
			const r$1 = this.ap(), h$1 = this.qv ? "right" : "left";
			n.forEach((i$1) => {
				i$1.forEach((i$2) => {
					i$2.gt(b(this.Li)).X(t, r$1, this.Fv, h$1);
				});
			});
		}
		kp(t) {
			this.Kv.style.cursor = 1 === t ? "ns-resize" : "default";
		}
		fo() {
			const t = this.op();
			this.Wv < t && this.tn.$v().$t().Kl(), this.Wv = t;
		}
		_p() {
			return F(this.ko.fontSize, this.ko.fontFamily);
		}
	};
	Vs = class Vs {
		constructor(i, n) {
			this.Ev = size({
				width: 0,
				height: 0
			}), this.Cp = null, this.Tp = null, this.Pp = null, this.Rp = null, this.Dp = !1, this.Vp = new D(), this.Op = new D(), this.Bp = 0, this.Ap = !1, this.Ip = null, this.zp = !1, this.Lp = null, this.Ep = null, this.jv = !1, this.Hv = () => {
				this.jv || null === this.Np || this.$i().Uh();
			}, this.Uv = () => {
				this.jv || null === this.Np || this.$i().Uh();
			}, this.Qd = i, this.Np = n, this.Np.W_().l(this.Fp.bind(this), this, !0), this.Wp = document.createElement("td"), this.Wp.style.padding = "0", this.Wp.style.position = "relative";
			const s = document.createElement("div");
			s.style.width = "100%", s.style.height = "100%", s.style.position = "relative", s.style.overflow = "hidden", this.jp = document.createElement("td"), this.jp.style.padding = "0", this.Hp = document.createElement("td"), this.Hp.style.padding = "0", this.Wp.appendChild(s), this.Gv = _s(s, size({
				width: 16,
				height: 16
			})), this.Gv.subscribeSuggestedBitmapSizeChanged(this.Hv);
			const e$1 = this.Gv.canvasElement;
			e$1.style.position = "absolute", e$1.style.zIndex = "1", e$1.style.left = "0", e$1.style.top = "0", this.Jv = _s(s, size({
				width: 16,
				height: 16
			})), this.Jv.subscribeSuggestedBitmapSizeChanged(this.Uv);
			const r$1 = this.Jv.canvasElement;
			r$1.style.position = "absolute", r$1.style.zIndex = "2", r$1.style.left = "0", r$1.style.top = "0", this.$p = document.createElement("tr"), this.$p.appendChild(this.jp), this.$p.appendChild(this.Wp), this.$p.appendChild(this.Hp), this.Up(), this.hp = new ps(this.Jv.canvasElement, this, {
				ev: () => null === this.Ip && !this.Qd.W().handleScroll.vertTouchDrag,
				rv: () => null === this.Ip && !this.Qd.W().handleScroll.horzTouchDrag
			});
		}
		S() {
			null !== this.Cp && this.Cp.S(), null !== this.Tp && this.Tp.S(), this.Pp = null, this.Jv.unsubscribeSuggestedBitmapSizeChanged(this.Uv), us(this.Jv.canvasElement), this.Jv.dispose(), this.Gv.unsubscribeSuggestedBitmapSizeChanged(this.Hv), us(this.Gv.canvasElement), this.Gv.dispose(), null !== this.Np && this.Np.W_().p(this), this.hp.S();
		}
		fp() {
			return b(this.Np);
		}
		qp(t) {
			var i, n;
			null !== this.Np && this.Np.W_().p(this), this.Np = t, null !== this.Np && this.Np.W_().l(Vs.prototype.Fp.bind(this), this, !0), this.Up(), this.Qd.Yp().indexOf(this) === this.Qd.Yp().length - 1 ? (this.Pp = null !== (i = this.Pp) && void 0 !== i ? i : new os(this.Wp, this.Qd), this.Pp.bt()) : (null === (n = this.Pp) || void 0 === n || n.if(), this.Pp = null);
		}
		$v() {
			return this.Qd;
		}
		lp() {
			return this.$p;
		}
		Up() {
			if (null !== this.Np && (this.Zp(), 0 !== this.$i().wt().length)) {
				if (null !== this.Cp) {
					const t = this.Np.R_();
					this.Cp.Gi(b(t));
				}
				if (null !== this.Tp) {
					const t = this.Np.D_();
					this.Tp.Gi(b(t));
				}
			}
		}
		Xp() {
			null !== this.Cp && this.Cp.bt(), null !== this.Tp && this.Tp.bt();
		}
		M_() {
			return null !== this.Np ? this.Np.M_() : 0;
		}
		x_(t) {
			this.Np && this.Np.x_(t);
		}
		Qf(t) {
			if (!this.Np) return;
			this.Kp();
			const i = t.localX, n = t.localY;
			this.Gp(i, n, t);
		}
		bv(t) {
			this.Kp(), this.Jp(), this.Gp(t.localX, t.localY, t);
		}
		tv(t) {
			var i;
			if (!this.Np) return;
			this.Kp();
			const n = t.localX, s = t.localY;
			this.Gp(n, s, t);
			const e$1 = this.wr(n, s);
			this.Qd.Qp(null !== (i = null == e$1 ? void 0 : e$1.Lv) && void 0 !== i ? i : null), this.$i().jc(e$1 && {
				Hc: e$1.Hc,
				Iv: e$1.Iv
			});
		}
		dv(t) {
			null !== this.Np && (this.Kp(), this.tm(t));
		}
		qf(t) {
			null !== this.Np && this.im(this.Op, t);
		}
		jf(t) {
			this.qf(t);
		}
		av(t) {
			this.Kp(), this.nm(t), this.Gp(t.localX, t.localY, t);
		}
		cv(t) {
			null !== this.Np && (this.Kp(), this.Ap = !1, this.sm(t));
		}
		uv(t) {
			null !== this.Np && this.tm(t);
		}
		Rv(t) {
			if (this.Ap = !0, null === this.Ip) {
				const i = {
					x: t.localX,
					y: t.localY
				};
				this.rm(i, i, t);
			}
		}
		Pv(t) {
			null !== this.Np && (this.Kp(), this.Np.$t().jc(null), this.hm());
		}
		lm() {
			return this.Vp;
		}
		am() {
			return this.Op;
		}
		xv() {
			this.Bp = 1, this.$i().Un();
		}
		Sv(t, i) {
			if (!this.Qd.W().handleScale.pinch) return;
			const n = 5 * (i - this.Bp);
			this.Bp = i, this.$i().Qc(t.nt, n);
		}
		pv(t) {
			this.Ap = !1, this.zp = null !== this.Ip, this.Jp();
			const i = this.$i().Zc();
			null !== this.Ip && i.yt() && (this.Lp = {
				x: i.Yt(),
				y: i.Zt()
			}, this.Ip = {
				x: t.localX,
				y: t.localY
			});
		}
		hv(t) {
			if (null === this.Np) return;
			const i = t.localX, n = t.localY;
			if (null === this.Ip) this.nm(t);
			else {
				this.zp = !1;
				const s = b(this.Lp), e$1 = s.x + (i - this.Ip.x), r$1 = s.y + (n - this.Ip.y);
				this.Gp(e$1, r$1, t);
			}
		}
		_v(t) {
			0 === this.$v().W().trackingMode.exitMode && (this.zp = !0), this.om(), this.sm(t);
		}
		wr(t, i) {
			const n = this.Np;
			return null === n ? null : function(t$1, i$1, n$1) {
				const s = t$1.Uo(), e$1 = function(t$2, i$2, n$2) {
					var s$1, e$2;
					let r$1, h$1;
					for (const o$1 of t$2) {
						const t$3 = null !== (e$2 = null === (s$1 = o$1.va) || void 0 === s$1 ? void 0 : s$1.call(o$1, i$2, n$2)) && void 0 !== e$2 ? e$2 : [];
						for (const i$3 of t$3) l$1 = i$3.zOrder, (!(a$1 = null == r$1 ? void 0 : r$1.zOrder) || "top" === l$1 && "top" !== a$1 || "normal" === l$1 && "bottom" === a$1) && (r$1 = i$3, h$1 = o$1);
					}
					var l$1, a$1;
					return r$1 && h$1 ? {
						zv: r$1,
						Hc: h$1
					} : null;
				}(s, i$1, n$1);
				if ("top" === (null == e$1 ? void 0 : e$1.zv.zOrder)) return xs(e$1);
				for (const r$1 of s) {
					if (e$1 && e$1.Hc === r$1 && "bottom" !== e$1.zv.zOrder && !e$1.zv.isBackground) return xs(e$1);
					const s$1 = Ss(r$1.Pn(t$1), i$1, n$1);
					if (null !== s$1) return {
						Hc: r$1,
						Bv: s$1.Bv,
						Iv: s$1.Iv
					};
					if (e$1 && e$1.Hc === r$1 && "bottom" !== e$1.zv.zOrder && e$1.zv.isBackground) return xs(e$1);
				}
				return (null == e$1 ? void 0 : e$1.zv) ? xs(e$1) : null;
			}(n, t, i);
		}
		_m(i, n) {
			b("left" === n ? this.Cp : this.Tp).cp(size({
				width: i,
				height: this.Ev.height
			}));
		}
		um() {
			return this.Ev;
		}
		cp(t) {
			equalSizes(this.Ev, t) || (this.Ev = t, this.jv = !0, this.Gv.resizeCanvasElement(t), this.Jv.resizeCanvasElement(t), this.jv = !1, this.Wp.style.width = t.width + "px", this.Wp.style.height = t.height + "px");
		}
		dm() {
			const t = b(this.Np);
			t.P_(t.R_()), t.P_(t.D_());
			for (const i of t.Ba()) if (t.vr(i)) {
				const n = i.Dt();
				null !== n && t.P_(n), i.Vn();
			}
		}
		xp() {
			return this.Gv.bitmapSize;
		}
		Sp(t, i, n) {
			const s = this.xp();
			s.width > 0 && s.height > 0 && t.drawImage(this.Gv.canvasElement, i, n);
		}
		vp(t) {
			if (0 === t) return;
			if (null === this.Np) return;
			if (t > 1 && this.dm(), null !== this.Cp && this.Cp.vp(t), null !== this.Tp && this.Tp.vp(t), 1 !== t) {
				this.Gv.applySuggestedBitmapSize();
				const t$1 = tryCreateCanvasRenderingTarget2D(this.Gv);
				null !== t$1 && (t$1.useBitmapCoordinateSpace((t$2) => {
					this.mp(t$2);
				}), this.Np && (this.fm(t$1, Ts), this.vm(t$1), this.pm(t$1), this.fm(t$1, Ps), this.fm(t$1, Rs)));
			}
			this.Jv.applySuggestedBitmapSize();
			const i = tryCreateCanvasRenderingTarget2D(this.Jv);
			null !== i && (i.useBitmapCoordinateSpace(({ context: t$1, bitmapSize: i$1 }) => {
				t$1.clearRect(0, 0, i$1.width, i$1.height);
			}), this.bm(i), this.fm(i, Ds));
		}
		wm() {
			return this.Cp;
		}
		gm() {
			return this.Tp;
		}
		bp(t, i) {
			this.fm(t, i);
		}
		Fp() {
			null !== this.Np && this.Np.W_().p(this), this.Np = null;
		}
		tm(t) {
			this.im(this.Vp, t);
		}
		im(t, i) {
			const n = i.localX, s = i.localY;
			t.M() && t.m(this.$i().St().Nu(n), {
				x: n,
				y: s
			}, i);
		}
		mp({ context: t, bitmapSize: i }) {
			const { width: n, height: s } = i, e$1 = this.$i(), r$1 = e$1.q(), h$1 = e$1.bd();
			r$1 === h$1 ? G(t, 0, 0, n, s, h$1) : tt(t, 0, 0, n, s, r$1, h$1);
		}
		vm(t) {
			const i = b(this.Np).j_().qh().gt();
			null !== i && i.X(t, !1);
		}
		pm(t) {
			const i = this.$i().Yc();
			this.Mm(t, Ps, cs, i), this.Mm(t, Ps, ds, i);
		}
		bm(t) {
			this.Mm(t, Ps, ds, this.$i().Zc());
		}
		fm(t, i) {
			const n = b(this.Np).Uo();
			for (const s of n) this.Mm(t, i, cs, s);
			for (const s of n) this.Mm(t, i, ds, s);
		}
		Mm(t, i, n, s) {
			const e$1 = b(this.Np), r$1 = e$1.$t().Wc(), h$1 = null !== r$1 && r$1.Hc === s, l$1 = null !== r$1 && h$1 && void 0 !== r$1.Iv ? r$1.Iv.Mr : void 0;
			fs(i, (i$1) => n(i$1, t, h$1, l$1), s, e$1);
		}
		Zp() {
			if (null === this.Np) return;
			const t = this.Qd, i = this.Np.R_().W().visible, n = this.Np.D_().W().visible;
			i || null === this.Cp || (this.jp.removeChild(this.Cp.lp()), this.Cp.S(), this.Cp = null), n || null === this.Tp || (this.Hp.removeChild(this.Tp.lp()), this.Tp.S(), this.Tp = null);
			const s = t.$t().ud();
			i && null === this.Cp && (this.Cp = new Cs(this, t.W(), s, "left"), this.jp.appendChild(this.Cp.lp())), n && null === this.Tp && (this.Tp = new Cs(this, t.W(), s, "right"), this.Hp.appendChild(this.Tp.lp()));
		}
		xm(t) {
			return t.Dv && this.Ap || null !== this.Ip;
		}
		Sm(t) {
			return Math.max(0, Math.min(t, this.Ev.width - 1));
		}
		km(t) {
			return Math.max(0, Math.min(t, this.Ev.height - 1));
		}
		Gp(t, i, n) {
			this.$i().ld(this.Sm(t), this.km(i), n, b(this.Np));
		}
		hm() {
			this.$i().od();
		}
		om() {
			this.zp && (this.Ip = null, this.hm());
		}
		rm(t, i, n) {
			this.Ip = t, this.zp = !1, this.Gp(i.x, i.y, n);
			const s = this.$i().Zc();
			this.Lp = {
				x: s.Yt(),
				y: s.Zt()
			};
		}
		$i() {
			return this.Qd.$t();
		}
		sm(t) {
			if (!this.Dp) return;
			const i = this.$i(), n = this.fp();
			if (i.z_(n, n.vn()), this.Rp = null, this.Dp = !1, i.ed(), null !== this.Ep) {
				const t$1 = performance.now(), n$1 = i.St();
				this.Ep.Vr(n$1.Hu(), t$1), this.Ep.Qu(t$1) || i.Zn(this.Ep);
			}
		}
		Kp() {
			this.Ip = null;
		}
		Jp() {
			if (!this.Np) return;
			if (this.$i().Un(), document.activeElement !== document.body && document.activeElement !== document.documentElement) b(document.activeElement).blur();
			else {
				const t = document.getSelection();
				null !== t && t.removeAllRanges();
			}
			!this.Np.vn().Ni() && this.$i().St().Ni();
		}
		nm(t) {
			if (null === this.Np) return;
			const i = this.$i(), n = i.St();
			if (n.Ni()) return;
			const s = this.Qd.W(), e$1 = s.handleScroll, r$1 = s.kineticScroll;
			if ((!e$1.pressedMouseMove || t.Dv) && (!e$1.horzTouchDrag && !e$1.vertTouchDrag || !t.Dv)) return;
			const h$1 = this.Np.vn(), l$1 = performance.now();
			if (null !== this.Rp || this.xm(t) || (this.Rp = {
				x: t.clientX,
				y: t.clientY,
				Od: l$1,
				ym: t.localX,
				Cm: t.localY
			}), null !== this.Rp && !this.Dp && (this.Rp.x !== t.clientX || this.Rp.y !== t.clientY)) {
				if (t.Dv && r$1.touch || !t.Dv && r$1.mouse) {
					const t$1 = n.le();
					this.Ep = new as(.2 / t$1, 7 / t$1, .997, 15 / t$1), this.Ep.Yd(n.Hu(), this.Rp.Od);
				} else this.Ep = null;
				h$1.Ni() || i.A_(this.Np, h$1, t.localY), i.nd(t.localX), this.Dp = !0;
			}
			this.Dp && (h$1.Ni() || i.I_(this.Np, h$1, t.localY), i.sd(t.localX), null !== this.Ep && this.Ep.Yd(n.Hu(), l$1));
		}
	};
	Os = class {
		constructor(i, n, s, e$1, r$1) {
			this.ft = !0, this.Ev = size({
				width: 0,
				height: 0
			}), this.Hv = () => this.vp(3), this.qv = "left" === i, this.Oc = s.ud, this.cn = n, this.Tm = e$1, this.Pm = r$1, this.Kv = document.createElement("div"), this.Kv.style.width = "25px", this.Kv.style.height = "100%", this.Kv.style.overflow = "hidden", this.Gv = _s(this.Kv, size({
				width: 16,
				height: 16
			})), this.Gv.subscribeSuggestedBitmapSizeChanged(this.Hv);
		}
		S() {
			this.Gv.unsubscribeSuggestedBitmapSizeChanged(this.Hv), us(this.Gv.canvasElement), this.Gv.dispose();
		}
		lp() {
			return this.Kv;
		}
		um() {
			return this.Ev;
		}
		cp(t) {
			equalSizes(this.Ev, t) || (this.Ev = t, this.Gv.resizeCanvasElement(t), this.Kv.style.width = `${t.width}px`, this.Kv.style.height = `${t.height}px`, this.ft = !0);
		}
		vp(t) {
			if (t < 3 && !this.ft) return;
			if (0 === this.Ev.width || 0 === this.Ev.height) return;
			this.ft = !1, this.Gv.applySuggestedBitmapSize();
			const i = tryCreateCanvasRenderingTarget2D(this.Gv);
			null !== i && i.useBitmapCoordinateSpace((t$1) => {
				this.mp(t$1), this.Ie(t$1);
			});
		}
		xp() {
			return this.Gv.bitmapSize;
		}
		Sp(t, i, n) {
			const s = this.xp();
			s.width > 0 && s.height > 0 && t.drawImage(this.Gv.canvasElement, i, n);
		}
		Ie({ context: t, bitmapSize: i, horizontalPixelRatio: n, verticalPixelRatio: s }) {
			if (!this.Tm()) return;
			t.fillStyle = this.cn.timeScale.borderColor;
			const e$1 = Math.floor(this.Oc.W().C * n), r$1 = Math.floor(this.Oc.W().C * s), h$1 = this.qv ? i.width - e$1 : 0;
			t.fillRect(h$1, 0, e$1, r$1);
		}
		mp({ context: t, bitmapSize: i }) {
			G(t, 0, 0, i.width, i.height, this.Pm());
		}
	};
	As = Bs("normal"), Is = Bs("top"), zs = Bs("bottom");
	Ls = class {
		constructor(i, n) {
			this.Rm = null, this.Dm = null, this.k = null, this.Vm = !1, this.Ev = size({
				width: 0,
				height: 0
			}), this.Om = new D(), this.Fv = new ni(5), this.jv = !1, this.Hv = () => {
				this.jv || this.Qd.$t().Uh();
			}, this.Uv = () => {
				this.jv || this.Qd.$t().Uh();
			}, this.Qd = i, this.q_ = n, this.cn = i.W().layout, this.Xd = document.createElement("tr"), this.Bm = document.createElement("td"), this.Bm.style.padding = "0", this.Am = document.createElement("td"), this.Am.style.padding = "0", this.Kv = document.createElement("td"), this.Kv.style.height = "25px", this.Kv.style.padding = "0", this.Im = document.createElement("div"), this.Im.style.width = "100%", this.Im.style.height = "100%", this.Im.style.position = "relative", this.Im.style.overflow = "hidden", this.Kv.appendChild(this.Im), this.Gv = _s(this.Im, size({
				width: 16,
				height: 16
			})), this.Gv.subscribeSuggestedBitmapSizeChanged(this.Hv);
			const s = this.Gv.canvasElement;
			s.style.position = "absolute", s.style.zIndex = "1", s.style.left = "0", s.style.top = "0", this.Jv = _s(this.Im, size({
				width: 16,
				height: 16
			})), this.Jv.subscribeSuggestedBitmapSizeChanged(this.Uv);
			const e$1 = this.Jv.canvasElement;
			e$1.style.position = "absolute", e$1.style.zIndex = "2", e$1.style.left = "0", e$1.style.top = "0", this.Xd.appendChild(this.Bm), this.Xd.appendChild(this.Kv), this.Xd.appendChild(this.Am), this.zm(), this.Qd.$t().g_().l(this.zm.bind(this), this), this.hp = new ps(this.Jv.canvasElement, this, {
				ev: () => !0,
				rv: () => !this.Qd.W().handleScroll.horzTouchDrag
			});
		}
		S() {
			this.hp.S(), null !== this.Rm && this.Rm.S(), null !== this.Dm && this.Dm.S(), this.Jv.unsubscribeSuggestedBitmapSizeChanged(this.Uv), us(this.Jv.canvasElement), this.Jv.dispose(), this.Gv.unsubscribeSuggestedBitmapSizeChanged(this.Hv), us(this.Gv.canvasElement), this.Gv.dispose();
		}
		lp() {
			return this.Xd;
		}
		Lm() {
			return this.Rm;
		}
		Em() {
			return this.Dm;
		}
		bv(t) {
			if (this.Vm) return;
			this.Vm = !0;
			const i = this.Qd.$t();
			!i.St().Ni() && this.Qd.W().handleScale.axisPressedMouseMove.time && i.Jc(t.localX);
		}
		pv(t) {
			this.bv(t);
		}
		wv() {
			const t = this.Qd.$t();
			!t.St().Ni() && this.Vm && (this.Vm = !1, this.Qd.W().handleScale.axisPressedMouseMove.time && t.hd());
		}
		av(t) {
			const i = this.Qd.$t();
			!i.St().Ni() && this.Qd.W().handleScale.axisPressedMouseMove.time && i.rd(t.localX);
		}
		hv(t) {
			this.av(t);
		}
		cv() {
			this.Vm = !1;
			const t = this.Qd.$t();
			t.St().Ni() && !this.Qd.W().handleScale.axisPressedMouseMove.time || t.hd();
		}
		_v() {
			this.cv();
		}
		qf() {
			this.Qd.W().handleScale.axisDoubleClickReset.time && this.Qd.$t().Kn();
		}
		jf() {
			this.qf();
		}
		Qf() {
			this.Qd.$t().W().handleScale.axisPressedMouseMove.time && this.kp(1);
		}
		Pv() {
			this.kp(0);
		}
		um() {
			return this.Ev;
		}
		Nm() {
			return this.Om;
		}
		Fm(i, s, e$1) {
			equalSizes(this.Ev, i) || (this.Ev = i, this.jv = !0, this.Gv.resizeCanvasElement(i), this.Jv.resizeCanvasElement(i), this.jv = !1, this.Kv.style.width = `${i.width}px`, this.Kv.style.height = `${i.height}px`, this.Om.m(i)), null !== this.Rm && this.Rm.cp(size({
				width: s,
				height: i.height
			})), null !== this.Dm && this.Dm.cp(size({
				width: e$1,
				height: i.height
			}));
		}
		Wm() {
			const t = this.jm();
			return Math.ceil(t.C + t.T + t.P + t.L + t.B + t.Hm);
		}
		bt() {
			this.Qd.$t().St().Ha();
		}
		xp() {
			return this.Gv.bitmapSize;
		}
		Sp(t, i, n) {
			const s = this.xp();
			s.width > 0 && s.height > 0 && t.drawImage(this.Gv.canvasElement, i, n);
		}
		vp(t) {
			if (0 === t) return;
			if (1 !== t) {
				this.Gv.applySuggestedBitmapSize();
				const i$1 = tryCreateCanvasRenderingTarget2D(this.Gv);
				null !== i$1 && (i$1.useBitmapCoordinateSpace((t$1) => {
					this.mp(t$1), this.Ie(t$1), this.$m(i$1, zs);
				}), this.wp(i$1), this.$m(i$1, As)), null !== this.Rm && this.Rm.vp(t), null !== this.Dm && this.Dm.vp(t);
			}
			this.Jv.applySuggestedBitmapSize();
			const i = tryCreateCanvasRenderingTarget2D(this.Jv);
			null !== i && (i.useBitmapCoordinateSpace(({ context: t$1, bitmapSize: i$1 }) => {
				t$1.clearRect(0, 0, i$1.width, i$1.height);
			}), this.Um([...this.Qd.$t().wt(), this.Qd.$t().Zc()], i), this.$m(i, Is));
		}
		$m(t, i) {
			const n = this.Qd.$t().wt();
			for (const s of n) fs(i, (i$1) => cs(i$1, t, !1, void 0), s, void 0);
			for (const s of n) fs(i, (i$1) => ds(i$1, t, !1, void 0), s, void 0);
		}
		mp({ context: t, bitmapSize: i }) {
			G(t, 0, 0, i.width, i.height, this.Qd.$t().bd());
		}
		Ie({ context: t, bitmapSize: i, verticalPixelRatio: n }) {
			if (this.Qd.W().timeScale.borderVisible) {
				t.fillStyle = this.qm();
				const s = Math.max(1, Math.floor(this.jm().C * n));
				t.fillRect(0, 0, i.width, s);
			}
		}
		wp(t) {
			const i = this.Qd.$t().St(), n = i.Ha();
			if (!n || 0 === n.length) return;
			const s = this.q_.maxTickMarkWeight(n), e$1 = this.jm(), r$1 = i.W();
			r$1.borderVisible && r$1.ticksVisible && t.useBitmapCoordinateSpace(({ context: t$1, horizontalPixelRatio: i$1, verticalPixelRatio: s$1 }) => {
				t$1.strokeStyle = this.qm(), t$1.fillStyle = this.qm();
				const r$2 = Math.max(1, Math.floor(i$1)), h$1 = Math.floor(.5 * i$1);
				t$1.beginPath();
				const l$1 = Math.round(e$1.T * s$1);
				for (let s$2 = n.length; s$2--;) {
					const e$2 = Math.round(n[s$2].coord * i$1);
					t$1.rect(e$2 - h$1, 0, r$2, l$1);
				}
				t$1.fill();
			}), t.useMediaCoordinateSpace(({ context: t$1 }) => {
				const i$1 = e$1.C + e$1.T + e$1.L + e$1.P / 2;
				t$1.textAlign = "center", t$1.textBaseline = "middle", t$1.fillStyle = this.$(), t$1.font = this._p();
				for (const e$2 of n) if (e$2.weight < s) {
					const n$1 = e$2.needAlignCoordinate ? this.Ym(t$1, e$2.coord, e$2.label) : e$2.coord;
					t$1.fillText(e$2.label, n$1, i$1);
				}
				this.Qd.W().timeScale.allowBoldLabels && (t$1.font = this.Zm());
				for (const e$2 of n) if (e$2.weight >= s) {
					const n$1 = e$2.needAlignCoordinate ? this.Ym(t$1, e$2.coord, e$2.label) : e$2.coord;
					t$1.fillText(e$2.label, n$1, i$1);
				}
			});
		}
		Ym(t, i, n) {
			const s = this.Fv.xi(t, n), e$1 = s / 2, r$1 = Math.floor(i - e$1) + .5;
			return r$1 < 0 ? i += Math.abs(0 - r$1) : r$1 + s > this.Ev.width && (i -= Math.abs(this.Ev.width - (r$1 + s))), i;
		}
		Um(t, i) {
			const n = this.jm();
			for (const s of t) for (const t$1 of s.Qi()) t$1.gt().X(i, n);
		}
		qm() {
			return this.Qd.W().timeScale.borderColor;
		}
		$() {
			return this.cn.textColor;
		}
		j() {
			return this.cn.fontSize;
		}
		_p() {
			return F(this.j(), this.cn.fontFamily);
		}
		Zm() {
			return F(this.j(), this.cn.fontFamily, "bold");
		}
		jm() {
			null === this.k && (this.k = {
				C: 1,
				N: NaN,
				L: NaN,
				B: NaN,
				ji: NaN,
				T: 5,
				P: NaN,
				R: "",
				Wi: new ni(),
				Hm: 0
			});
			const t = this.k, i = this._p();
			if (t.R !== i) {
				const n = this.j();
				t.P = n, t.R = i, t.L = 3 * n / 12, t.B = 3 * n / 12, t.ji = 9 * n / 12, t.N = 0, t.Hm = 4 * n / 12, t.Wi.nr();
			}
			return this.k;
		}
		kp(t) {
			this.Kv.style.cursor = 1 === t ? "ew-resize" : "default";
		}
		zm() {
			const t = this.Qd.$t(), i = t.W();
			i.leftPriceScale.visible || null === this.Rm || (this.Bm.removeChild(this.Rm.lp()), this.Rm.S(), this.Rm = null), i.rightPriceScale.visible || null === this.Dm || (this.Am.removeChild(this.Dm.lp()), this.Dm.S(), this.Dm = null);
			const n = { ud: this.Qd.$t().ud() }, s = () => i.leftPriceScale.borderVisible && t.St().W().borderVisible, e$1 = () => t.bd();
			i.leftPriceScale.visible && null === this.Rm && (this.Rm = new Os("left", i, n, s, e$1), this.Bm.appendChild(this.Rm.lp())), i.rightPriceScale.visible && null === this.Dm && (this.Dm = new Os("right", i, n, s, e$1), this.Am.appendChild(this.Dm.lp()));
		}
	};
	Es = !!ns && !!navigator.userAgentData && navigator.userAgentData.brands.some((t) => t.brand.includes("Chromium")) && !!ns && ((null === (Ns = null === navigator || void 0 === navigator ? void 0 : navigator.userAgentData) || void 0 === Ns ? void 0 : Ns.platform) ? "Windows" === navigator.userAgentData.platform : navigator.userAgent.toLowerCase().indexOf("win") >= 0);
	Fs = class {
		constructor(t, i, n) {
			var s;
			this.Xm = [], this.Km = 0, this.ho = 0, this.__ = 0, this.Gm = 0, this.Jm = 0, this.Qm = null, this.tb = !1, this.Vp = new D(), this.Op = new D(), this.Rc = new D(), this.ib = null, this.nb = null, this.Jd = t, this.cn = i, this.q_ = n, this.Xd = document.createElement("div"), this.Xd.classList.add("tv-lightweight-charts"), this.Xd.style.overflow = "hidden", this.Xd.style.direction = "ltr", this.Xd.style.width = "100%", this.Xd.style.height = "100%", (s = this.Xd).style.userSelect = "none", s.style.webkitUserSelect = "none", s.style.msUserSelect = "none", s.style.MozUserSelect = "none", s.style.webkitTapHighlightColor = "transparent", this.sb = document.createElement("table"), this.sb.setAttribute("cellspacing", "0"), this.Xd.appendChild(this.sb), this.eb = this.rb.bind(this), Ws(this.cn) && this.hb(!0), this.$i = new Ln(this.Vc.bind(this), this.cn, n), this.$t().Xc().l(this.lb.bind(this), this), this.ab = new Ls(this, this.q_), this.sb.appendChild(this.ab.lp());
			const e$1 = i.autoSize && this.ob();
			let r$1 = this.cn.width, h$1 = this.cn.height;
			if (e$1 || 0 === r$1 || 0 === h$1) {
				const i$1 = t.getBoundingClientRect();
				r$1 = r$1 || i$1.width, h$1 = h$1 || i$1.height;
			}
			this._b(r$1, h$1), this.ub(), t.appendChild(this.Xd), this.cb(), this.$i.St().ec().l(this.$i.Kl.bind(this.$i), this), this.$i.g_().l(this.$i.Kl.bind(this.$i), this);
		}
		$t() {
			return this.$i;
		}
		W() {
			return this.cn;
		}
		Yp() {
			return this.Xm;
		}
		fb() {
			return this.ab;
		}
		S() {
			this.hb(!1), 0 !== this.Km && window.cancelAnimationFrame(this.Km), this.$i.Xc().p(this), this.$i.St().ec().p(this), this.$i.g_().p(this), this.$i.S();
			for (const t of this.Xm) this.sb.removeChild(t.lp()), t.lm().p(this), t.am().p(this), t.S();
			this.Xm = [], b(this.ab).S(), null !== this.Xd.parentElement && this.Xd.parentElement.removeChild(this.Xd), this.Rc.S(), this.Vp.S(), this.Op.S(), this.pb();
		}
		_b(i, n, s = !1) {
			if (this.ho === n && this.__ === i) return;
			const e$1 = function(i$1) {
				const n$1 = Math.floor(i$1.width), s$1 = Math.floor(i$1.height);
				return size({
					width: n$1 - n$1 % 2,
					height: s$1 - s$1 % 2
				});
			}(size({
				width: i,
				height: n
			}));
			this.ho = e$1.height, this.__ = e$1.width;
			const r$1 = this.ho + "px", h$1 = this.__ + "px";
			b(this.Xd).style.height = r$1, b(this.Xd).style.width = h$1, this.sb.style.height = r$1, this.sb.style.width = h$1, s ? this.mb(ut.es(), performance.now()) : this.$i.Kl();
		}
		vp(t) {
			void 0 === t && (t = ut.es());
			for (let i = 0; i < this.Xm.length; i++) this.Xm[i].vp(t.Hn(i).Fn);
			this.cn.timeScale.visible && this.ab.vp(t.jn());
		}
		$h(t) {
			const i = Ws(this.cn);
			this.$i.$h(t);
			const n = Ws(this.cn);
			n !== i && this.hb(n), this.cb(), this.bb(t);
		}
		lm() {
			return this.Vp;
		}
		am() {
			return this.Op;
		}
		Xc() {
			return this.Rc;
		}
		wb() {
			null !== this.Qm && (this.mb(this.Qm, performance.now()), this.Qm = null);
			const t = this.gb(null), i = document.createElement("canvas");
			i.width = t.width, i.height = t.height;
			const n = b(i.getContext("2d"));
			return this.gb(n), i;
		}
		Mb(t) {
			if ("left" === t && !this.xb()) return 0;
			if ("right" === t && !this.Sb()) return 0;
			if (0 === this.Xm.length) return 0;
			return b("left" === t ? this.Xm[0].wm() : this.Xm[0].gm()).dp();
		}
		kb() {
			return this.cn.autoSize && null !== this.ib;
		}
		yb() {
			return this.Xd;
		}
		Qp(t) {
			this.nb = t, this.nb ? this.yb().style.setProperty("cursor", t) : this.yb().style.removeProperty("cursor");
		}
		Cb() {
			return this.nb;
		}
		Tb() {
			return m(this.Xm[0]).um();
		}
		bb(t) {
			(void 0 !== t.autoSize || !this.ib || void 0 === t.width && void 0 === t.height) && (t.autoSize && !this.ib && this.ob(), !1 === t.autoSize && null !== this.ib && this.pb(), t.autoSize || void 0 === t.width && void 0 === t.height || this._b(t.width || this.__, t.height || this.ho));
		}
		gb(i) {
			let n = 0, s = 0;
			const e$1 = this.Xm[0], r$1 = (t, n$1) => {
				let s$1 = 0;
				for (let e$2 = 0; e$2 < this.Xm.length; e$2++) {
					const r$2 = this.Xm[e$2], h$2 = b("left" === t ? r$2.wm() : r$2.gm()), l$1 = h$2.xp();
					null !== i && h$2.Sp(i, n$1, s$1), s$1 += l$1.height;
				}
			};
			if (this.xb()) {
				r$1("left", 0);
				n += b(e$1.wm()).xp().width;
			}
			for (let t = 0; t < this.Xm.length; t++) {
				const e$2 = this.Xm[t], r$2 = e$2.xp();
				null !== i && e$2.Sp(i, n, s), s += r$2.height;
			}
			if (n += e$1.xp().width, this.Sb()) {
				r$1("right", n);
				n += b(e$1.gm()).xp().width;
			}
			const h$1 = (t, n$1, s$1) => {
				b("left" === t ? this.ab.Lm() : this.ab.Em()).Sp(b(i), n$1, s$1);
			};
			if (this.cn.timeScale.visible) {
				const t = this.ab.xp();
				if (null !== i) {
					let n$1 = 0;
					this.xb() && (h$1("left", n$1, s), n$1 = b(e$1.wm()).xp().width), this.ab.Sp(i, n$1, s), n$1 += t.width, this.Sb() && h$1("right", n$1, s);
				}
				s += t.height;
			}
			return size({
				width: n,
				height: s
			});
		}
		Pb() {
			let i = 0, n = 0, s = 0;
			for (const t of this.Xm) this.xb() && (n = Math.max(n, b(t.wm()).op(), this.cn.leftPriceScale.minimumWidth)), this.Sb() && (s = Math.max(s, b(t.gm()).op(), this.cn.rightPriceScale.minimumWidth)), i += t.M_();
			n = rs(n), s = rs(s);
			const e$1 = this.__, r$1 = this.ho, h$1 = Math.max(e$1 - n - s, 0), l$1 = this.cn.timeScale.visible;
			let a$1 = l$1 ? Math.max(this.ab.Wm(), this.cn.timeScale.minimumHeight) : 0;
			var o$1;
			a$1 = (o$1 = a$1) + o$1 % 2;
			const _$1 = 0 + a$1, u$1 = r$1 < _$1 ? 0 : r$1 - _$1, c$1 = u$1 / i;
			let d$1 = 0;
			for (let i$1 = 0; i$1 < this.Xm.length; ++i$1) {
				const e$2 = this.Xm[i$1];
				e$2.qp(this.$i.qc()[i$1]);
				let r$2 = 0, l$2 = 0;
				l$2 = i$1 === this.Xm.length - 1 ? u$1 - d$1 : Math.round(e$2.M_() * c$1), r$2 = Math.max(l$2, 2), d$1 += r$2, e$2.cp(size({
					width: h$1,
					height: r$2
				})), this.xb() && e$2._m(n, "left"), this.Sb() && e$2._m(s, "right"), e$2.fp() && this.$i.Kc(e$2.fp(), r$2);
			}
			this.ab.Fm(size({
				width: l$1 ? h$1 : 0,
				height: a$1
			}), l$1 ? n : 0, l$1 ? s : 0), this.$i.S_(h$1), this.Gm !== n && (this.Gm = n), this.Jm !== s && (this.Jm = s);
		}
		hb(t) {
			t ? this.Xd.addEventListener("wheel", this.eb, { passive: !1 }) : this.Xd.removeEventListener("wheel", this.eb);
		}
		Rb(t) {
			switch (t.deltaMode) {
				case t.DOM_DELTA_PAGE: return 120;
				case t.DOM_DELTA_LINE: return 32;
			}
			return Es ? 1 / window.devicePixelRatio : 1;
		}
		rb(t) {
			if (!(0 !== t.deltaX && this.cn.handleScroll.mouseWheel || 0 !== t.deltaY && this.cn.handleScale.mouseWheel)) return;
			const i = this.Rb(t), n = i * t.deltaX / 100, s = -i * t.deltaY / 100;
			if (t.cancelable && t.preventDefault(), 0 !== s && this.cn.handleScale.mouseWheel) {
				const i$1 = Math.sign(s) * Math.min(1, Math.abs(s)), n$1 = t.clientX - this.Xd.getBoundingClientRect().left;
				this.$t().Qc(n$1, i$1);
			}
			0 !== n && this.cn.handleScroll.mouseWheel && this.$t().td(-80 * n);
		}
		mb(t, i) {
			var n;
			const s = t.jn();
			3 === s && this.Db(), 3 !== s && 2 !== s || (this.Vb(t), this.Ob(t, i), this.ab.bt(), this.Xm.forEach((t$1) => {
				t$1.Xp();
			}), 3 === (null === (n = this.Qm) || void 0 === n ? void 0 : n.jn()) && (this.Qm.ts(t), this.Db(), this.Vb(this.Qm), this.Ob(this.Qm, i), t = this.Qm, this.Qm = null)), this.vp(t);
		}
		Ob(t, i) {
			for (const n of t.Qn()) this.ns(n, i);
		}
		Vb(t) {
			const i = this.$i.qc();
			for (let n = 0; n < i.length; n++) t.Hn(n).Wn && i[n].N_();
		}
		ns(t, i) {
			const n = this.$i.St();
			switch (t.qn) {
				case 0:
					n.hc();
					break;
				case 1:
					n.lc(t.Vt);
					break;
				case 2:
					n.Gn(t.Vt);
					break;
				case 3:
					n.Jn(t.Vt);
					break;
				case 4:
					n.qu();
					break;
				case 5: t.Vt.Qu(i) || n.Jn(t.Vt.tc(i));
			}
		}
		Vc(t) {
			null !== this.Qm ? this.Qm.ts(t) : this.Qm = t, this.tb || (this.tb = !0, this.Km = window.requestAnimationFrame((t$1) => {
				if (this.tb = !1, this.Km = 0, null !== this.Qm) {
					const i = this.Qm;
					this.Qm = null, this.mb(i, t$1);
					for (const n of i.Qn()) if (5 === n.qn && !n.Vt.Qu(t$1)) {
						this.$t().Zn(n.Vt);
						break;
					}
				}
			}));
		}
		Db() {
			this.ub();
		}
		ub() {
			const t = this.$i.qc(), i = t.length, n = this.Xm.length;
			for (let t$1 = i; t$1 < n; t$1++) {
				const t$2 = m(this.Xm.pop());
				this.sb.removeChild(t$2.lp()), t$2.lm().p(this), t$2.am().p(this), t$2.S();
			}
			for (let s = n; s < i; s++) {
				const i$1 = new Vs(this, t[s]);
				i$1.lm().l(this.Bb.bind(this), this), i$1.am().l(this.Ab.bind(this), this), this.Xm.push(i$1), this.sb.insertBefore(i$1.lp(), this.ab.lp());
			}
			for (let n$1 = 0; n$1 < i; n$1++) {
				const i$1 = t[n$1], s = this.Xm[n$1];
				s.fp() !== i$1 ? s.qp(i$1) : s.Up();
			}
			this.cb(), this.Pb();
		}
		Ib(t, i, n) {
			var s;
			const e$1 = /* @__PURE__ */ new Map();
			if (null !== t) this.$i.wt().forEach((i$1) => {
				const n$1 = i$1.In().ll(t);
				null !== n$1 && e$1.set(i$1, n$1);
			});
			let r$1;
			if (null !== t) {
				const i$1 = null === (s = this.$i.St().Ui(t)) || void 0 === s ? void 0 : s.originalTime;
				void 0 !== i$1 && (r$1 = i$1);
			}
			const h$1 = this.$t().Wc(), l$1 = null !== h$1 && h$1.Hc instanceof Gi ? h$1.Hc : void 0, a$1 = null !== h$1 && void 0 !== h$1.Iv ? h$1.Iv.gr : void 0;
			return {
				zb: r$1,
				ee: null != t ? t : void 0,
				Lb: null != i ? i : void 0,
				Eb: l$1,
				Nb: e$1,
				Fb: a$1,
				Wb: null != n ? n : void 0
			};
		}
		Bb(t, i, n) {
			this.Vp.m(() => this.Ib(t, i, n));
		}
		Ab(t, i, n) {
			this.Op.m(() => this.Ib(t, i, n));
		}
		lb(t, i, n) {
			this.Rc.m(() => this.Ib(t, i, n));
		}
		cb() {
			const t = this.cn.timeScale.visible ? "" : "none";
			this.ab.lp().style.display = t;
		}
		xb() {
			return this.Xm[0].fp().R_().W().visible;
		}
		Sb() {
			return this.Xm[0].fp().D_().W().visible;
		}
		ob() {
			return "ResizeObserver" in window && (this.ib = new ResizeObserver((t) => {
				const i = t.find((t$1) => t$1.target === this.Jd);
				i && this._b(i.contentRect.width, i.contentRect.height);
			}), this.ib.observe(this.Jd, { box: "border-box" }), !0);
		}
		pb() {
			null !== this.ib && this.ib.disconnect(), this.ib = null;
		}
	};
	se = class {
		constructor(t) {
			this.qb = /* @__PURE__ */ new Map(), this.Yb = /* @__PURE__ */ new Map(), this.Zb = /* @__PURE__ */ new Map(), this.Xb = [], this.q_ = t;
		}
		S() {
			this.qb.clear(), this.Yb.clear(), this.Zb.clear(), this.Xb = [];
		}
		Kb(t, i) {
			let n = 0 !== this.qb.size, s = !1;
			const e$1 = this.Yb.get(t);
			if (void 0 !== e$1) if (1 === this.Yb.size) n = !1, s = !0, this.qb.clear();
			else for (const i$1 of this.Xb) i$1.pointData.Hb.delete(t) && (s = !0);
			let r$1 = [];
			if (0 !== i.length) {
				const n$1 = i.map((t$1) => t$1.time), e$2 = this.q_.createConverterToInternalObj(i), h$2 = Qs(t.Qh()), l$1 = t.Ca(), a$1 = t.Ta();
				r$1 = i.map((i$1, r$2) => {
					const o$1 = e$2(i$1.time), _$1 = this.q_.key(o$1);
					let u$1 = this.qb.get(_$1);
					void 0 === u$1 && (u$1 = te(o$1), this.qb.set(_$1, u$1), s = !0);
					const c$1 = h$2(o$1, u$1.ee, i$1, n$1[r$2], l$1, a$1);
					return u$1.Hb.set(t, c$1), c$1;
				});
			}
			n && this.Gb(), this.Jb(t, r$1);
			let h$1 = -1;
			if (s) {
				const t$1 = [];
				this.qb.forEach((i$1) => {
					t$1.push({
						timeWeight: 0,
						time: i$1.la,
						pointData: i$1,
						originalTime: ne(i$1.Hb)
					});
				}), t$1.sort((t$2, i$1) => this.q_.key(t$2.time) - this.q_.key(i$1.time)), h$1 = this.Qb(t$1);
			}
			return this.tw(t, h$1, function(t$1, i$1, n$1) {
				const s$1 = ie(t$1, n$1), e$2 = ie(i$1, n$1);
				if (void 0 !== s$1 && void 0 !== e$2) return { ta: s$1.Ub >= e$2.Ub && s$1.$b >= e$2.$b };
			}(this.Yb.get(t), e$1, this.q_));
		}
		vd(t) {
			return this.Kb(t, []);
		}
		iw(t, i) {
			const n = i;
			(function(t$1) {
				void 0 === t$1.zb && (t$1.zb = t$1.time);
			})(n), this.q_.preprocessData(i);
			const s = this.q_.createConverterToInternalObj([i])(i.time), e$1 = this.Zb.get(t);
			if (void 0 !== e$1 && this.q_.key(s) < this.q_.key(e$1)) throw new Error(`Cannot update oldest data, last time=${e$1}, new time=${s}`);
			let r$1 = this.qb.get(this.q_.key(s));
			const h$1 = void 0 === r$1;
			void 0 === r$1 && (r$1 = te(s), this.qb.set(this.q_.key(s), r$1));
			const l$1 = Qs(t.Qh()), a$1 = t.Ca(), o$1 = t.Ta(), _$1 = l$1(s, r$1.ee, i, n.zb, a$1, o$1);
			r$1.Hb.set(t, _$1), this.nw(t, _$1);
			const u$1 = { ta: Ks(_$1) };
			if (!h$1) return this.tw(t, -1, u$1);
			const c$1 = {
				timeWeight: 0,
				time: r$1.la,
				pointData: r$1,
				originalTime: ne(r$1.Hb)
			}, d$1 = Bt(this.Xb, this.q_.key(c$1.time), (t$1, i$1) => this.q_.key(t$1.time) < i$1);
			this.Xb.splice(d$1, 0, c$1);
			for (let t$1 = d$1; t$1 < this.Xb.length; ++t$1) ee(this.Xb[t$1].pointData, t$1);
			return this.q_.fillWeightsForPoints(this.Xb, d$1), this.tw(t, d$1, u$1);
		}
		nw(t, i) {
			let n = this.Yb.get(t);
			void 0 === n && (n = [], this.Yb.set(t, n));
			const s = 0 !== n.length ? n[n.length - 1] : null;
			null === s || this.q_.key(i.ot) > this.q_.key(s.ot) ? Ks(i) && n.push(i) : Ks(i) ? n[n.length - 1] = i : n.splice(-1, 1), this.Zb.set(t, i.ot);
		}
		Jb(t, i) {
			0 !== i.length ? (this.Yb.set(t, i.filter(Ks)), this.Zb.set(t, i[i.length - 1].ot)) : (this.Yb.delete(t), this.Zb.delete(t));
		}
		Gb() {
			for (const t of this.Xb) 0 === t.pointData.Hb.size && this.qb.delete(this.q_.key(t.time));
		}
		Qb(t) {
			let i = -1;
			for (let n = 0; n < this.Xb.length && n < t.length; ++n) {
				const s = this.Xb[n], e$1 = t[n];
				if (this.q_.key(s.time) !== this.q_.key(e$1.time)) {
					i = n;
					break;
				}
				e$1.timeWeight = s.timeWeight, ee(e$1.pointData, n);
			}
			if (-1 === i && this.Xb.length !== t.length && (i = Math.min(this.Xb.length, t.length)), -1 === i) return -1;
			for (let n = i; n < t.length; ++n) ee(t[n].pointData, n);
			return this.q_.fillWeightsForPoints(t, i), this.Xb = t, i;
		}
		sw() {
			if (0 === this.Yb.size) return null;
			let t = 0;
			return this.Yb.forEach((i) => {
				0 !== i.length && (t = Math.max(t, i[i.length - 1].ee));
			}), t;
		}
		tw(t, i, n) {
			const s = {
				ew: /* @__PURE__ */ new Map(),
				St: { Eu: this.sw() }
			};
			if (-1 !== i) this.Yb.forEach((i$1, e$1) => {
				s.ew.set(e$1, {
					$e: i$1,
					rw: e$1 === t ? n : void 0
				});
			}), this.Yb.has(t) || s.ew.set(t, {
				$e: [],
				rw: n
			}), s.St.hw = this.Xb, s.St.lw = i;
			else {
				const i$1 = this.Yb.get(t);
				s.ew.set(t, {
					$e: i$1 || [],
					rw: n
				});
			}
			return s;
		}
	};
	fe = {
		vertLine: {
			color: "#9598A1",
			width: 1,
			style: 3,
			visible: !0,
			labelVisible: !0,
			labelBackgroundColor: "#131722"
		},
		horzLine: {
			color: "#9598A1",
			width: 1,
			style: 3,
			visible: !0,
			labelVisible: !0,
			labelBackgroundColor: "#131722"
		},
		mode: 1
	}, ve = {
		vertLines: {
			color: "#D6DCDE",
			style: 0,
			visible: !0
		},
		horzLines: {
			color: "#D6DCDE",
			style: 0,
			visible: !0
		}
	}, pe = {
		background: {
			type: "solid",
			color: "#FFFFFF"
		},
		textColor: "#191919",
		fontSize: 12,
		fontFamily: N,
		attributionLogo: !0
	}, me = {
		autoScale: !0,
		mode: 0,
		invertScale: !1,
		alignLabels: !0,
		borderVisible: !0,
		borderColor: "#2B2B43",
		entireTextOnly: !1,
		visible: !1,
		ticksVisible: !1,
		scaleMargins: {
			bottom: .1,
			top: .2
		},
		minimumWidth: 0
	}, be = {
		rightOffset: 0,
		barSpacing: 6,
		minBarSpacing: .5,
		fixLeftEdge: !1,
		fixRightEdge: !1,
		lockVisibleTimeRangeOnResize: !1,
		rightBarStaysOnScroll: !1,
		borderVisible: !0,
		borderColor: "#2B2B43",
		visible: !0,
		timeVisible: !1,
		secondsVisible: !0,
		shiftVisibleRangeOnNewBar: !0,
		allowShiftVisibleRangeOnWhitespaceReplacement: !1,
		ticksVisible: !1,
		uniformDistribution: !1,
		minimumHeight: 0,
		allowBoldLabels: !0
	}, we = {
		color: "rgba(0, 0, 0, 0)",
		visible: !1,
		fontSize: 48,
		fontFamily: N,
		fontStyle: "",
		text: "",
		horzAlign: "center",
		vertAlign: "center"
	};
	Me = class {
		constructor(t, i) {
			this.aw = t, this.ow = i;
		}
		applyOptions(t) {
			this.aw.$t().$c(this.ow, t);
		}
		options() {
			return this.Li().W();
		}
		width() {
			return _t(this.ow) ? this.aw.Mb(this.ow) : 0;
		}
		Li() {
			return b(this.aw.$t().Uc(this.ow)).Dt;
		}
	};
	Se = {
		color: "#FF0000",
		price: 0,
		lineStyle: 2,
		lineWidth: 1,
		lineVisible: !0,
		axisLabelVisible: !0,
		title: "",
		axisLabelColor: "",
		axisLabelTextColor: ""
	};
	ke = class {
		constructor(t) {
			this.Nh = t;
		}
		applyOptions(t) {
			this.Nh.$h(t);
		}
		options() {
			return this.Nh.W();
		}
		_w() {
			return this.Nh;
		}
	};
	ye = class {
		constructor(t, i, n, s, e$1) {
			this.uw = new D(), this.Es = t, this.cw = i, this.dw = n, this.q_ = e$1, this.fw = s;
		}
		S() {
			this.uw.S();
		}
		priceFormatter() {
			return this.Es.ba();
		}
		priceToCoordinate(t) {
			const i = this.Es.Ct();
			return null === i ? null : this.Es.Dt().Rt(t, i.Vt);
		}
		coordinateToPrice(t) {
			const i = this.Es.Ct();
			return null === i ? null : this.Es.Dt().pn(t, i.Vt);
		}
		barsInLogicalRange(t) {
			if (null === t) return null;
			const i = new yn(new xn(t.from, t.to)).lu(), n = this.Es.In();
			if (n.Ni()) return null;
			const s = n.ll(i.Os(), 1), e$1 = n.ll(i.ui(), -1), r$1 = b(n.el()), h$1 = b(n.An());
			if (null !== s && null !== e$1 && s.ee > e$1.ee) return {
				barsBefore: t.from - r$1,
				barsAfter: h$1 - t.to
			};
			const l$1 = {
				barsBefore: null === s || s.ee === r$1 ? t.from - r$1 : s.ee - r$1,
				barsAfter: null === e$1 || e$1.ee === h$1 ? h$1 - t.to : h$1 - e$1.ee
			};
			return null !== s && null !== e$1 && (l$1.from = s.zb, l$1.to = e$1.zb), l$1;
		}
		setData(t) {
			this.q_, this.Es.Qh(), this.cw.pw(this.Es, t), this.mw("full");
		}
		update(t) {
			this.Es.Qh(), this.cw.bw(this.Es, t), this.mw("update");
		}
		dataByIndex(t, i) {
			const n = this.Es.In().ll(t, i);
			if (null === n) return null;
			return ce(this.seriesType())(n);
		}
		data() {
			const t = ce(this.seriesType());
			return this.Es.In().ne().map((i) => t(i));
		}
		subscribeDataChanged(t) {
			this.uw.l(t);
		}
		unsubscribeDataChanged(t) {
			this.uw.v(t);
		}
		setMarkers(t) {
			this.q_;
			const i = t.map((t$1) => xe(t$1, this.q_.convertHorzItemToInternal(t$1.time), t$1.time));
			this.Es.na(i);
		}
		markers() {
			return this.Es.sa().map((t) => xe(t, t.originalTime, void 0));
		}
		applyOptions(t) {
			this.Es.$h(t);
		}
		options() {
			return z(this.Es.W());
		}
		priceScale() {
			return this.dw.priceScale(this.Es.Dt().Pa());
		}
		createPriceLine(t) {
			const i = V(z(Se), t), n = this.Es.ea(i);
			return new ke(n);
		}
		removePriceLine(t) {
			this.Es.ra(t._w());
		}
		seriesType() {
			return this.Es.Qh();
		}
		attachPrimitive(t) {
			this.Es.ka(t), t.attached && t.attached({
				chart: this.fw,
				series: this,
				requestUpdate: () => this.Es.$t().Kl()
			});
		}
		detachPrimitive(t) {
			this.Es.ya(t), t.detached && t.detached();
		}
		mw(t) {
			this.uw.M() && this.uw.m(t);
		}
	};
	Ce = class {
		constructor(t, i, n) {
			this.ww = new D(), this.mu = new D(), this.Om = new D(), this.$i = t, this.yl = t.St(), this.ab = i, this.yl.nc().l(this.gw.bind(this)), this.yl.sc().l(this.Mw.bind(this)), this.ab.Nm().l(this.xw.bind(this)), this.q_ = n;
		}
		S() {
			this.yl.nc().p(this), this.yl.sc().p(this), this.ab.Nm().p(this), this.ww.S(), this.mu.S(), this.Om.S();
		}
		scrollPosition() {
			return this.yl.Hu();
		}
		scrollToPosition(t, i) {
			i ? this.yl.Ju(t, 1e3) : this.$i.Jn(t);
		}
		scrollToRealTime() {
			this.yl.Gu();
		}
		getVisibleRange() {
			const t = this.yl.Vu();
			return null === t ? null : {
				from: t.from.originalTime,
				to: t.to.originalTime
			};
		}
		setVisibleRange(t) {
			const i = {
				from: this.q_.convertHorzItemToInternal(t.from),
				to: this.q_.convertHorzItemToInternal(t.to)
			}, n = this.yl.Iu(i);
			this.$i.pd(n);
		}
		getVisibleLogicalRange() {
			const t = this.yl.Du();
			return null === t ? null : {
				from: t.Os(),
				to: t.ui()
			};
		}
		setVisibleLogicalRange(t) {
			p(t.from <= t.to, "The from index cannot be after the to index."), this.$i.pd(t);
		}
		resetTimeScale() {
			this.$i.Kn();
		}
		fitContent() {
			this.$i.hc();
		}
		logicalToCoordinate(t) {
			const i = this.$i.St();
			return i.Ni() ? null : i.It(t);
		}
		coordinateToLogical(t) {
			return this.yl.Ni() ? null : this.yl.Nu(t);
		}
		timeToCoordinate(t) {
			const i = this.q_.convertHorzItemToInternal(t), n = this.yl.Va(i, !1);
			return null === n ? null : this.yl.It(n);
		}
		coordinateToTime(t) {
			const i = this.$i.St(), n = i.Nu(t), s = i.Ui(n);
			return null === s ? null : s.originalTime;
		}
		width() {
			return this.ab.um().width;
		}
		height() {
			return this.ab.um().height;
		}
		subscribeVisibleTimeRangeChange(t) {
			this.ww.l(t);
		}
		unsubscribeVisibleTimeRangeChange(t) {
			this.ww.v(t);
		}
		subscribeVisibleLogicalRangeChange(t) {
			this.mu.l(t);
		}
		unsubscribeVisibleLogicalRangeChange(t) {
			this.mu.v(t);
		}
		subscribeSizeChange(t) {
			this.Om.l(t);
		}
		unsubscribeSizeChange(t) {
			this.Om.v(t);
		}
		applyOptions(t) {
			this.yl.$h(t);
		}
		options() {
			return Object.assign(Object.assign({}, z(this.yl.W())), { barSpacing: this.yl.le() });
		}
		gw() {
			this.ww.M() && this.ww.m(this.getVisibleRange());
		}
		Mw() {
			this.mu.M() && this.mu.m(this.getVisibleLogicalRange());
		}
		xw(t) {
			this.Om.m(t.width, t.height);
		}
	};
	Re = class {
		constructor(t, i, n) {
			this.Sw = /* @__PURE__ */ new Map(), this.kw = /* @__PURE__ */ new Map(), this.yw = new D(), this.Cw = new D(), this.Tw = new D(), this.Pw = new se(i);
			const s = void 0 === n ? z(ge()) : V(z(ge()), Pe(n));
			this.q_ = i, this.aw = new Fs(t, s, i), this.aw.lm().l((t$1) => {
				this.yw.M() && this.yw.m(this.Rw(t$1()));
			}, this), this.aw.am().l((t$1) => {
				this.Cw.M() && this.Cw.m(this.Rw(t$1()));
			}, this), this.aw.Xc().l((t$1) => {
				this.Tw.M() && this.Tw.m(this.Rw(t$1()));
			}, this);
			const e$1 = this.aw.$t();
			this.Dw = new Ce(e$1, this.aw.fb(), this.q_);
		}
		remove() {
			this.aw.lm().p(this), this.aw.am().p(this), this.aw.Xc().p(this), this.Dw.S(), this.aw.S(), this.Sw.clear(), this.kw.clear(), this.yw.S(), this.Cw.S(), this.Tw.S(), this.Pw.S();
		}
		resize(t, i, n) {
			this.autoSizeActive() || this.aw._b(t, i, n);
		}
		addCustomSeries(t, i) {
			const n = w(t), s = Object.assign(Object.assign({}, _), n.defaultOptions());
			return this.Vw("Custom", s, i, n);
		}
		addAreaSeries(t) {
			return this.Vw("Area", l, t);
		}
		addBaselineSeries(t) {
			return this.Vw("Baseline", a, t);
		}
		addBarSeries(t) {
			return this.Vw("Bar", r, t);
		}
		addCandlestickSeries(t = {}) {
			return function(t$1) {
				void 0 !== t$1.borderColor && (t$1.borderUpColor = t$1.borderColor, t$1.borderDownColor = t$1.borderColor), void 0 !== t$1.wickColor && (t$1.wickUpColor = t$1.wickColor, t$1.wickDownColor = t$1.wickColor);
			}(t), this.Vw("Candlestick", e, t);
		}
		addHistogramSeries(t) {
			return this.Vw("Histogram", o, t);
		}
		addLineSeries(t) {
			return this.Vw("Line", h, t);
		}
		removeSeries(t) {
			const i = m(this.Sw.get(t)), n = this.Pw.vd(i);
			this.aw.$t().vd(i), this.Ow(n), this.Sw.delete(t), this.kw.delete(i);
		}
		pw(t, i) {
			this.Ow(this.Pw.Kb(t, i));
		}
		bw(t, i) {
			this.Ow(this.Pw.iw(t, i));
		}
		subscribeClick(t) {
			this.yw.l(t);
		}
		unsubscribeClick(t) {
			this.yw.v(t);
		}
		subscribeCrosshairMove(t) {
			this.Tw.l(t);
		}
		unsubscribeCrosshairMove(t) {
			this.Tw.v(t);
		}
		subscribeDblClick(t) {
			this.Cw.l(t);
		}
		unsubscribeDblClick(t) {
			this.Cw.v(t);
		}
		priceScale(t) {
			return new Me(this.aw, t);
		}
		timeScale() {
			return this.Dw;
		}
		applyOptions(t) {
			this.aw.$h(Pe(t));
		}
		options() {
			return this.aw.W();
		}
		takeScreenshot() {
			return this.aw.wb();
		}
		autoSizeActive() {
			return this.aw.kb();
		}
		chartElement() {
			return this.aw.yb();
		}
		paneSize() {
			const t = this.aw.Tb();
			return {
				height: t.height,
				width: t.width
			};
		}
		setCrosshairPosition(t, i, n) {
			const s = this.Sw.get(n);
			if (void 0 === s) return;
			const e$1 = this.aw.$t().dr(s);
			null !== e$1 && this.aw.$t().ad(t, i, e$1);
		}
		clearCrosshairPosition() {
			this.aw.$t().od(!0);
		}
		Vw(t, i, n = {}, s) {
			Te(n.priceFormat);
			const e$1 = V(z(u), z(i), n), r$1 = this.aw.$t().dd(t, e$1, s), h$1 = new ye(r$1, this, this, this, this.q_);
			return this.Sw.set(h$1, r$1), this.kw.set(r$1, h$1), h$1;
		}
		Ow(t) {
			const i = this.aw.$t();
			i._d(t.St.Eu, t.St.hw, t.St.lw), t.ew.forEach((t$1, i$1) => i$1.J(t$1.$e, t$1.rw)), i.Wu();
		}
		Bw(t) {
			return m(this.kw.get(t));
		}
		Rw(t) {
			const i = /* @__PURE__ */ new Map();
			t.Nb.forEach((t$1, n$1) => {
				const s = n$1.Qh(), e$1 = ce(s)(t$1);
				if ("Custom" !== s) p(js(e$1));
				else {
					const t$2 = n$1.Ta();
					p(!t$2 || !1 === t$2(e$1));
				}
				i.set(this.Bw(n$1), e$1);
			});
			const n = void 0 !== t.Eb && this.kw.has(t.Eb) ? this.Bw(t.Eb) : void 0;
			return {
				time: t.zb,
				logical: t.ee,
				point: t.Lb,
				hoveredSeries: n,
				hoveredObjectId: t.Fb,
				seriesData: i,
				sourceEvent: t.Wb
			};
		}
	};
	Be = Object.assign(Object.assign({}, u), _);
} });

//#endregion
//#region src/components/KlineChart.tsx
/** 把后端 KlineRow 转成 lightweight-charts v4 需要的格式 */
function toSeriesData(rows) {
	const candlestick = [];
	const volume = [];
	for (const r$1 of rows) {
		const time = typeof r$1.date === "string" ? r$1.date.slice(0, 10) : String(r$1.date);
		const open = Number(r$1.open);
		const high = Number(r$1.high);
		const low = Number(r$1.low);
		const close = Number(r$1.close);
		if ([
			open,
			high,
			low,
			close
		].some((n) => Number.isNaN(n))) continue;
		candlestick.push({
			time,
			open,
			high,
			low,
			close
		});
		const vol = Number(r$1.volume ?? 0);
		if (!Number.isNaN(vol)) {
			const isUp = close >= open;
			volume.push({
				time,
				value: vol,
				color: isUp ? "rgba(38,166,154,0.5)" : "rgba(239,83,80,0.5)"
			});
		}
	}
	return {
		candlestick,
		volume
	};
}
function KlineChart({ symbol, height = 480, className, onDataChange, onCross }) {
	const containerRef = (0, react.useRef)(null);
	const chartRef = (0, react.useRef)(null);
	const candleRef = (0, react.useRef)(null);
	const [status, setStatus] = (0, react.useState)("loading");
	const [error, setError] = (0, react.useState)("");
	const [range, setRange] = (0, react.useState)(() => {
		const end = /* @__PURE__ */ new Date();
		const start = /* @__PURE__ */ new Date();
		start.setMonth(start.getMonth() - 6);
		return {
			start: start.toISOString().slice(0, 10),
			end: end.toISOString().slice(0, 10)
		};
	});
	(0, react.useEffect)(() => {
		if (!symbol) return;
		let cancelled = false;
		(async () => {
			try {
				const res = await api.klineDaily(symbol, 120, range);
				if (cancelled) return;
				const { candlestick, volume } = toSeriesData(res.rows);
				candleRef.current?.setData(candlestick);
				if (volume.length && chartRef.current) {
					const vol = chartRef.current.addHistogramSeries({
						color: "#94a3b8",
						priceScaleId: "vol"
					});
					vol.priceScale().applyOptions({ scaleMargins: {
						top: .85,
						bottom: .05
					} });
					vol.setData(volume);
				}
				setStatus(res.rows.length ? "ok" : "empty");
				onDataChange?.(res.rows);
			} catch (e$1) {
				if (cancelled) return;
				setError(e$1.message);
				setStatus("error");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [
		symbol,
		range,
		onDataChange
	]);
	(0, react.useEffect)(() => {
		const el = containerRef.current;
		if (!el) return;
		const chart = Ve(el, {
			layout: {
				background: {
					type: In.Solid,
					color: "transparent"
				},
				textColor: "#64748b"
			},
			grid: {
				vertLines: { color: "rgba(148,163,184,0.12)" },
				horzLines: { color: "rgba(148,163,184,0.12)" }
			},
			width: el.clientWidth,
			height,
			rightPriceScale: {
				visible: true,
				borderColor: "rgba(148,163,184,0.2)"
			}
		});
		chartRef.current = chart;
		const candle = chart.addCandlestickSeries({
			upColor: "#26a69a",
			downColor: "#ef5350",
			borderUpColor: "#26a69a",
			borderDownColor: "#ef5350",
			wickUpColor: "#26a69a",
			wickDownColor: "#ef5350"
		});
		candleRef.current = candle;
		if (onCross) chart.subscribeCrosshairMove((param) => {
			const main = param.point ? param.seriesData.get(candle) : void 0;
			onCross?.(main);
		});
		const ro = new ResizeObserver(() => {
			chart.resize(el.clientWidth, height);
		});
		ro.observe(el);
		return () => {
			ro.disconnect();
			chart.remove();
			chartRef.current = null;
		};
	}, [height, onCross]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className,
		ref: containerRef,
		style: { height },
		children: [
			status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "text-sm text-muted py-4",
				children: "K 加载中…"
			}),
			status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "text-sm text-danger py-2",
				children: error || "K 加载失败"
			}),
			status === "empty" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "flex h-full items-center justify-center text-sm text-muted",
				children: "暂无历史 K 线数据"
			})
		]
	});
}
var init_KlineChart = __esm({ "src/components/KlineChart.tsx"() {
	init_lightweight_charts_production();
	init_api();
} });

//#endregion
//#region src/lib/format.ts
function fmtPrice(v$1, digits = 2) {
	if (v$1 == null || Number.isNaN(v$1)) return "—";
	return v$1.toFixed(digits);
}
function fmtVolume(v$1) {
	if (v$1 == null || Number.isNaN(v$1)) return "—";
	if (v$1 >= 1e8) return `${(v$1 / 1e8).toFixed(2)}亿`;
	if (v$1 >= 1e4) return `${(v$1 / 1e4).toFixed(2)}万`;
	return v$1.toFixed(0);
}
function fmtBigNum(v$1) {
	if (v$1 == null || Number.isNaN(v$1)) return "—";
	const sign = v$1 < 0 ? "-" : "";
	const abs = Math.abs(v$1);
	if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}万亿`;
	if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(2)}亿`;
	if (abs >= 1e4) return `${sign}${(abs / 1e4).toFixed(0)}万`;
	return v$1.toFixed(0);
}
function fmtDate(s) {
	if (s == null) return "—";
	const d$1 = typeof s === "string" ? new Date(s) : s;
	if (isNaN(d$1.getTime())) return String(s);
	return `${d$1.getFullYear()}-${String(d$1.getMonth() + 1).padStart(2, "0")}-${String(d$1.getDate()).padStart(2, "0")}`;
}
var init_format = __esm({ "src/lib/format.ts"() {} });

//#endregion
//#region src/lib/stock-info-fields.ts
function getStorage() {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
function loadInfoFields() {
	const st$1 = getStorage();
	if (st$1) {
		const saved = st$1.getItem("stock-info-bar-fields");
		if (saved) try {
			const parsed = JSON.parse(saved);
			if (parsed.length > 0) return mergeFields(parsed);
		} catch {}
	}
	return [...BUILTIN_INFO_FIELDS];
}
function saveInfoFields(columns) {
	const st$1 = getStorage();
	if (st$1) try {
		st$1.setItem("stock-info-bar-fields", JSON.stringify(columns));
	} catch {}
}
function mergeFields(saved) {
	const result = [...saved];
	for (const def of BUILTIN_INFO_FIELDS) if (!result.some((f$1) => f$1.id === def.id)) result.push(def);
	return result;
}
var BUILTIN_INFO_FIELDS, INFO_GROUPS;
var init_stock_info_fields = __esm({ "src/lib/stock-info-fields.ts"() {
	BUILTIN_INFO_FIELDS = [
		{
			id: "builtin:market_cap",
			source: {
				type: "builtin",
				key: "market_cap"
			},
			label: "市值",
			visible: true,
			align: "left"
		},
		{
			id: "builtin:float_market_cap",
			source: {
				type: "builtin",
				key: "float_market_cap"
			},
			label: "流通值",
			visible: true,
			align: "left"
		},
		{
			id: "builtin:turnover",
			source: {
				type: "builtin",
				key: "turnover"
			},
			label: "换手",
			visible: true,
			align: "left"
		},
		{
			id: "builtin:volume",
			source: {
				type: "builtin",
				key: "volume"
			},
			label: "成交量",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:amplitude",
			source: {
				type: "builtin",
				key: "amplitude"
			},
			label: "振幅",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:open",
			source: {
				type: "builtin",
				key: "open"
			},
			label: "开盘",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:high",
			source: {
				type: "builtin",
				key: "high"
			},
			label: "最高",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:low",
			source: {
				type: "builtin",
				key: "low"
			},
			label: "最低",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:eps",
			source: {
				type: "builtin",
				key: "eps"
			},
			label: "EPS",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:bps",
			source: {
				type: "builtin",
				key: "bps"
			},
			label: "BPS",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:roe",
			source: {
				type: "builtin",
				key: "roe"
			},
			label: "ROE",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:pe_ttm",
			source: {
				type: "builtin",
				key: "pe_ttm"
			},
			label: "PE",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:pb",
			source: {
				type: "builtin",
				key: "pb"
			},
			label: "PB",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:gross_margin",
			source: {
				type: "builtin",
				key: "gross_margin"
			},
			label: "毛利率",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:net_margin",
			source: {
				type: "builtin",
				key: "net_margin"
			},
			label: "净利率",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:debt_ratio",
			source: {
				type: "builtin",
				key: "debt_ratio"
			},
			label: "负债率",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:revenue_yoy",
			source: {
				type: "builtin",
				key: "revenue_yoy"
			},
			label: "营收增速",
			visible: false,
			align: "left"
		},
		{
			id: "builtin:net_income_yoy",
			source: {
				type: "builtin",
				key: "net_income_yoy"
			},
			label: "净利增速",
			visible: false,
			align: "left"
		}
	];
	INFO_GROUPS = [
		{
			id: "scale",
			label: "规模",
			icon: "🏦",
			keys: ["market_cap", "float_market_cap"]
		},
		{
			id: "volume",
			label: "成交",
			icon: "📊",
			keys: [
				"turnover",
				"volume",
				"amplitude"
			]
		},
		{
			id: "quote",
			label: "行情",
			icon: "📈",
			keys: [
				"open",
				"high",
				"low"
			]
		},
		{
			id: "finance",
			label: "财务",
			icon: "📋",
			keys: [
				"eps",
				"bps",
				"roe",
				"pe_ttm",
				"pb",
				"gross_margin",
				"net_margin",
				"debt_ratio",
				"revenue_yoy",
				"net_income_yoy"
			]
		}
	];
} });

//#endregion
//#region src/components/StockInfoBar.tsx
/** 精简渲染扩展数据值（信息条专用） */
function renderExtInline(val, col, expanded, onToggle) {
	if (val == null || typeof val === "number" && Number.isNaN(val)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: "text-slate-400",
		children: "—"
	});
	if (typeof val === "number") {
		const displayVal = Number.isInteger(val) ? fmtPrice(val, 0) : fmtPrice(val);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "tabular-nums",
			children: displayVal
		});
	}
	if (typeof val === "boolean") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: val ? "text-red-600" : "text-slate-400",
		children: val ? "是" : "否"
	});
	const str = String(val);
	if (col.extDisplay?.displayMode === "text") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: str });
	const sep = col.extDisplay?.separator?.trim() || null;
	const tags = sep ? str.split(sep).map((s) => s.trim()).filter(Boolean) : str.split(/[、,，;；\-]/).map((s) => s.trim()).filter(Boolean);
	if (tags.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: "text-slate-400",
		children: "—"
	});
	const maxTags = col.extDisplay?.maxTags ?? 0;
	const showAll = maxTags <= 0 || expanded;
	const sliced = showAll ? tags : tags.slice(0, maxTags);
	const overflow = tags.length - sliced.length;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		className: "inline-flex flex-wrap items-center gap-0.5",
		children: [sliced.map((tag, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: "inline-block px-1 rounded text-[10px] leading-tight text-yellow-600 bg-yellow-500/10",
			children: tag
		}, i)), !showAll && overflow > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			onClick: onToggle,
			className: "inline-block px-1 rounded text-[10px] leading-tight text-blue-600 bg-blue-500/10",
			children: ["+", overflow]
		})]
	});
}
function StockInfoBar({ symbol, name, stockInfo, rows, fields, onFieldsChange, financialMetrics, onMonitor, inWatchlist, onToggleWatchlist }) {
	const [customizerOpen, setCustomizerOpen] = (0, react.useState)(false);
	const [expandedExt, setExpandedExt] = (0, react.useState)(/* @__PURE__ */ new Set());
	const toggleExtExpand = (key) => {
		setExpandedExt((prev$1) => {
			const next = new Set(prev$1);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	};
	if (rows.length === 0) return null;
	const latest = rows[rows.length - 1];
	const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
	const close = Number(latest.close);
	const chg = prev ? close - Number(prev.close) : 0;
	const chgPct = prev ? chg / Number(prev.close) * 100 : 0;
	const isUp = chg >= 0;
	const clr = isUp ? BULL : BEAR;
	const totalShares = stockInfo?.total_shares;
	const floatShares = stockInfo?.float_shares;
	const marketCap = totalShares ? close * totalShares : null;
	const floatMarketCap = floatShares ? close * floatShares : null;
	const turnoverRate = floatShares && latest.volume ? Number(latest.volume) * 100 / floatShares * 100 : null;
	const displayName = stockInfo?.name ?? name ?? "";
	const computeBuiltinValue = (key) => {
		switch (key) {
			case "market_cap": return marketCap != null ? fmtBigNum(marketCap) : null;
			case "float_market_cap": return floatMarketCap != null ? fmtBigNum(floatMarketCap) : null;
			case "turnover": return turnoverRate != null ? `${turnoverRate.toFixed(2)}%` : null;
			case "volume": return latest.volume != null ? fmtVolume(Number(latest.volume)) : null;
			case "amplitude": {
				const prevClose = prev ? Number(prev.close) : null;
				if (prevClose == null || prevClose === 0) return null;
				const hi$1 = Number(latest.high);
				const lo = Number(latest.low);
				return `${((hi$1 - lo) / prevClose * 100).toFixed(2)}%`;
			}
			case "open": return fmtPrice(Number(latest.open));
			case "high": return fmtPrice(Number(latest.high));
			case "low": return fmtPrice(Number(latest.low));
			case "eps": return financialMetrics?.eps_basic != null ? fmtPrice(financialMetrics.eps_basic) : null;
			case "bps": return financialMetrics?.bps != null ? fmtPrice(financialMetrics.bps) : null;
			case "roe": return financialMetrics?.roe != null ? `${financialMetrics.roe.toFixed(2)}%` : null;
			case "gross_margin": return financialMetrics?.gross_margin != null ? `${financialMetrics.gross_margin.toFixed(2)}%` : null;
			case "net_margin": return financialMetrics?.net_margin != null ? `${financialMetrics.net_margin.toFixed(2)}%` : null;
			case "debt_ratio": return financialMetrics?.debt_to_asset_ratio != null ? `${financialMetrics.debt_to_asset_ratio.toFixed(2)}%` : null;
			case "revenue_yoy": return financialMetrics?.revenue_yoy != null ? `${financialMetrics.revenue_yoy.toFixed(2)}%` : null;
			case "net_income_yoy": return financialMetrics?.net_income_yoy != null ? `${financialMetrics.net_income_yoy.toFixed(2)}%` : null;
			case "pe_ttm": {
				const eps = financialMetrics?.eps_basic;
				return eps && eps !== 0 ? fmtPrice(close / eps) : null;
			}
			case "pb": {
				const bps = financialMetrics?.bps;
				return bps && bps !== 0 ? fmtPrice(close / bps) : null;
			}
			default: return null;
		}
	};
	const visibleFields = fields.filter((f$1) => f$1.visible);
	const inlineFields = visibleFields.filter((f$1) => !f$1.standalone);
	const standaloneFields = visibleFields.filter((f$1) => f$1.standalone);
	const toggleField = (id) => {
		onFieldsChange(fields.map((f$1) => f$1.id === id ? {
			...f$1,
			visible: !f$1.visible
		} : f$1));
	};
	const renderField = (f$1) => {
		if (f$1.source.type === "ext") {
			const { configId, fieldName } = f$1.source;
			const val = stockInfo?.ext?.[`${configId}__${fieldName}`];
			if (val == null || typeof val === "number" && Number.isNaN(val)) return null;
			const cellKey = `${symbol}::${f$1.id}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "inline-flex items-center gap-1",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: f$1.label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "text-slate-600",
					children: renderExtInline(val, f$1, expandedExt.has(cellKey), () => toggleExtExpand(cellKey))
				})]
			}, f$1.id);
		}
		const value = computeBuiltinValue(f$1.source.type === "builtin" ? f$1.source.key : "");
		if (value == null) return null;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			className: "cursor-pointer hover:text-slate-900",
			onClick: () => toggleField(f$1.id),
			children: [
				f$1.label,
				" ",
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "text-slate-600",
					children: value
				})
			]
		}, f$1.id);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "px-2 pb-3 font-mono text-[12px] select-none space-y-1",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "flex items-baseline gap-x-3 flex-wrap",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "text-slate-900 font-bold text-sm tracking-wide",
						children: symbol
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "text-slate-600 font-medium",
						children: displayName
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { color: clr },
						className: "text-lg font-bold tabular-nums",
						children: fmtPrice(close)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: { color: clr },
						className: "tabular-nums",
						children: [isUp ? "+" : "", fmtPrice(chg)]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: { color: clr },
						className: "tabular-nums",
						children: [
							isUp ? "+" : "",
							fmtPrice(chgPct),
							"%"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "ml-auto self-center flex items-center gap-1",
						children: [
							onToggleWatchlist && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: onToggleWatchlist,
								className: `p-1 rounded-btn transition-colors cursor-pointer ${inWatchlist ? "text-yellow-500" : "text-slate-400 hover:text-slate-700"}`,
								title: inWatchlist ? "移出自选" : "加自选",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Star, { className: "h-3.5 w-3.5" })
							}),
							onMonitor && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: onMonitor,
								className: "p-1 rounded-btn text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer",
								title: "加监控",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RadioTower, { className: "h-3.5 w-3.5" })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								onClick: () => setCustomizerOpen(true),
								className: "p-1 rounded-btn text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors",
								title: "自定义信息条",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Settings2, { className: "h-3.5 w-3.5" })
							})
						]
					})
				]
			}),
			inlineFields.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "flex items-center gap-x-4 gap-y-1 text-[11px] flex-wrap text-slate-500",
				children: inlineFields.map(renderField)
			}),
			standaloneFields.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "space-y-1",
				children: standaloneFields.map((f$1) => {
					const node = renderField(f$1);
					if (node == null) return null;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "flex items-center gap-x-4 text-[11px] flex-wrap text-slate-500",
						children: node
					}, f$1.id);
				})
			}),
			customizerOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40",
				onClick: () => setCustomizerOpen(false),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "w-72 rounded-lg bg-white p-4 shadow-xl",
					onClick: (e$1) => e$1.stopPropagation(),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: "mb-3 text-sm font-semibold text-slate-800",
							children: "信息条指标"
						}),
						INFO_GROUPS.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "mb-3",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "mb-1 text-xs font-medium text-slate-500",
								children: [
									group.icon,
									" ",
									group.label
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "flex flex-wrap gap-1",
								children: fields.filter((f$1) => f$1.source.type === "builtin" && group.keys.includes(f$1.source.key)).map((f$1) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									onClick: () => toggleField(f$1.id),
									className: `rounded px-2 py-0.5 text-[11px] transition-colors ${f$1.visible ? "bg-blue-500/10 text-blue-600" : "bg-slate-100 text-slate-400"}`,
									children: f$1.label
								}, f$1.id))
							})]
						}, group.id)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							onClick: () => setCustomizerOpen(false),
							className: "mt-2 w-full rounded-md bg-slate-800 py-1.5 text-xs text-white",
							children: "完成"
						})
					]
				})
			})
		]
	});
}
var BULL, BEAR;
var init_StockInfoBar = __esm({ "src/components/StockInfoBar.tsx"() {
	init_lucide_react();
	init_format();
	init_stock_info_fields();
	BULL = "#C74040";
	BEAR = "#2D9B65";
} });

//#endregion
//#region src/components/PriceLevels.tsx
/** 关键价位面板：按组显示压力/支撑位，标注与现价关系 */
function PriceLevels({ levels, close, activeTypes, onToggleType }) {
	const grouped = (0, react.useMemo)(() => {
		const result = [];
		for (const g$1 of LEVEL_GROUPS) {
			const items = (levels[g$1.key] ?? []).slice(0, 3);
			if (items.length) result.push({
				group: g$1,
				items
			});
		}
		return result;
	}, [levels]);
	if (grouped.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "text-xs text-slate-400 py-4",
		children: "暂无关键价位数据"
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "space-y-3",
		children: [grouped.map(({ group, items }) => {
			const active = !activeTypes || activeTypes.has(group.key);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: active ? "" : "opacity-50",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "mb-1 flex items-center gap-2",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "text-[11px] font-medium",
						style: { color: group.color },
						children: group.label
					}), onToggleType && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						onClick: () => onToggleType(group.key),
						className: "text-[10px] text-slate-400 hover:text-slate-600",
						children: active ? "收起" : "展开"
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]",
					children: items.map((p$1, i) => {
						const isResistance = p$1.side === "resistance";
						const isSupport = p$1.side === "support";
						const closeVal = close ?? 0;
						const diffNum = closeVal ? p$1.value - closeVal : 0;
						const diffPct = closeVal !== 0 ? diffNum / closeVal * 100 : 0;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "flex items-center justify-between",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: isResistance ? "text-red-500" : isSupport ? "text-green-500" : "text-slate-500",
								children: p$1.label
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "tabular-nums text-slate-700",
								children: [fmtPrice(p$1.value), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: `ml-1 text-[10px] ${diffNum > 0 ? "text-red-400" : "text-green-400"}`,
									children: [
										diffNum > 0 ? "+" : "",
										diffPct.toFixed(1),
										"%"
									]
								})]
							})]
						}, i);
					})
				})]
			}, group.key);
		}), close != null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "pt-1 text-[11px] text-slate-500 border-t border-slate-100",
			children: ["现价 ", fmtPrice(close)]
		})]
	});
}
var LEVEL_GROUPS;
var init_PriceLevels = __esm({ "src/components/PriceLevels.tsx"() {
	init_format();
	LEVEL_GROUPS = [
		{
			key: "sr",
			label: "压力支撑",
			color: "#F97316"
		},
		{
			key: "pivot",
			label: "枢轴点",
			color: "#8B5CF6"
		},
		{
			key: "extreme",
			label: "前高前低",
			color: "#EAB308"
		},
		{
			key: "boll",
			label: "布林带",
			color: "#F97316"
		},
		{
			key: "keltner_s",
			label: "Keltner短期",
			color: "#06B6D4"
		},
		{
			key: "keltner_m",
			label: "Keltner中期",
			color: "#22D3EE"
		},
		{
			key: "keltner_l",
			label: "Keltner长期",
			color: "#67E8F9"
		},
		{
			key: "atr_stop",
			label: "ATR止损",
			color: "#EF4444"
		},
		{
			key: "gap",
			label: "缺口位",
			color: "#EC4899"
		},
		{
			key: "fib",
			label: "斐波那契",
			color: "#F59E0B"
		},
		{
			key: "round",
			label: "整数关口",
			color: "#71717A"
		}
	];
} });

//#endregion
//#region src/components/Watchlist.tsx
/** 自选股列表：从后端拉取，支持移除/清空 */
function Watchlist({ symbols, onRemove, onClear }) {
	const [items, setItems] = (0, react.useState)([]);
	const [loading, setLoading] = (0, react.useState)(true);
	(0, react.useEffect)(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await api.watchlistList();
				if (cancelled) return;
				setItems(res.symbols);
			} catch {} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);
	const handleRemove = async (symbol) => {
		await api.watchlistRemove(symbol);
		onRemove(symbol);
		setItems((prev) => prev.filter((s) => s.symbol !== symbol));
	};
	const handleClear = async () => {
		await api.watchlistClear();
		onClear();
		setItems([]);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "flex flex-col",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "mb-2 flex items-center justify-between",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h3", {
				className: "text-xs font-medium text-slate-500",
				children: [
					"自选股 (",
					items.length,
					")"
				]
			}), items.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				onClick: handleClear,
				className: "text-[10px] text-slate-400 hover:text-red-500",
				children: "清空"
			})]
		}), loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "text-xs text-slate-400 py-2",
			children: "加载中…"
		}) : items.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "text-xs text-slate-400 py-2",
			children: "暂无自选，在图表区点击 ⭐ 添加"
		}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
			className: "space-y-1",
			children: items.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: "flex items-center justify-between rounded bg-slate-50 px-2 py-1",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-1.5 min-w-0",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Star, { className: "h-3 w-3 shrink-0 text-yellow-500" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "font-mono text-xs text-slate-700",
							children: item.symbol
						}),
						item.name && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "truncate text-[10px] text-slate-400",
							children: item.name
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-1",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronRight, { className: "h-3 w-3 text-slate-300" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						onClick: () => handleRemove(item.symbol),
						className: "p-0.5 text-slate-300 hover:text-red-500",
						title: "移出自选",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Trash2, { className: "h-3 w-3" })
					})]
				})]
			}, item.symbol))
		})]
	});
}
var init_Watchlist = __esm({ "src/components/Watchlist.tsx"() {
	init_lucide_react();
	init_api();
} });

//#endregion
//#region src/components/AiAnalysisHost.tsx
/** AI 个股四维分析宿主：流式调用后端，渲染进度 + 结果 */
function AiAnalysisHost({ symbol, name, onReportAdded }) {
	const [phase, setPhase] = (0, react.useState)("idle");
	const [progress, setProgress] = (0, react.useState)("");
	const [error, setError] = (0, react.useState)("");
	const runAnalysis = async () => {
		if (!symbol) return;
		setPhase("loading");
		setError("");
		setProgress("正在分析行情与关键价位…");
		try {
			let content = "";
			let summary = "";
			for await (const chunk of api.stockAnalyzeStream(symbol)) if (chunk.type === "delta") {
				setPhase("streaming");
				if (chunk.content) {
					content += chunk.content;
					setProgress(content.slice(0, 200));
				}
				if (chunk.summary) summary = chunk.summary;
			} else if (chunk.type === "error") {
				setPhase("error");
				setError(chunk.message ?? "分析失败");
				return;
			} else if (chunk.type === "done") setPhase("done");
			if (content) onReportAdded({
				id: `local-${Date.now()}`,
				symbol,
				name,
				focus: "四维分析",
				content,
				summary,
				created_at: (/* @__PURE__ */ new Date()).toISOString()
			});
		} catch (e$1) {
			setPhase("error");
			setError(e$1.message);
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "rounded-lg border border-slate-200 p-3",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "mb-2 flex items-center justify-between",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
					className: "text-xs font-medium text-slate-600",
					children: "AI 四维分析"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "text-[10px] text-slate-400",
					children: "技术 · 基本面 · 财务 · 消息面"
				})]
			}),
			phase === "idle" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				onClick: runAnalysis,
				className: "flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-500 px-3 py-2 text-xs text-white hover:bg-blue-600",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Sparkles, { className: "h-3.5 w-3.5" }), "开始 AI 分析"]
			}),
			(phase === "loading" || phase === "streaming") && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-center gap-2 rounded-md bg-slate-50 px-3 py-4 text-xs text-slate-500",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(LoaderCircle, { className: "h-3.5 w-3.5 animate-spin text-blue-500" }), progress || "分析中…"]
			}),
			phase === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-center gap-2 rounded-md bg-red-50 px-3 py-4 text-xs text-red-500",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CircleAlert, { className: "h-3.5 w-3.5" }), error || "分析失败，请重试"]
			})
		]
	});
}
var init_AiAnalysisHost = __esm({ "src/components/AiAnalysisHost.tsx"() {
	init_lucide_react();
	init_api();
} });

//#endregion
//#region src/components/MarkdownRenderer.tsx
/**
* 轻量 Markdown 渲染器 — 零依赖，专为 AI 分析报告设计。
* 支持：标题 / 加粗 / 行内代码 / 列表 / 表格 / 引用 / 分隔线 / 段落
*/
function renderInline(text, keyBase) {
	const nodes = [];
	const re$1 = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
	let last = 0;
	let m$1;
	let i = 0;
	while ((m$1 = re$1.exec(text)) !== null) {
		if (m$1.index > last) nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(react.Fragment, { children: text.slice(last, m$1.index) }, `${keyBase}-t-${i}`));
		if (m$1[1]) nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
			className: "font-semibold text-slate-800",
			children: m$1[2]
		}, `${keyBase}-b-${i}`));
		else if (m$1[3]) nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
			className: "px-1 py-0.5 rounded bg-slate-100 text-[0.85em] font-mono text-emerald-700",
			children: m$1[4]
		}, `${keyBase}-c-${i}`));
		last = m$1.index + m$1[0].length;
		i++;
	}
	if (last < text.length) nodes.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(react.Fragment, { children: text.slice(last) }, `${keyBase}-t-end`));
	return nodes;
}
function parseTable(lines, start) {
	const tableLines = [];
	let idx = start;
	while (idx < lines.length && lines[idx].trim().startsWith("|")) {
		tableLines.push(lines[idx].trim());
		idx++;
	}
	if (tableLines.length < 2) return null;
	if (!/^|[\s-:|]+$/.test(tableLines[1]) && !tableLines[1].split("|").every((c$1) => /^[\s-:]*$/.test(c$1))) return null;
	const parseRow = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c$1) => c$1.trim());
	const header = parseRow(tableLines[0]);
	const body = tableLines.slice(2).map(parseRow);
	return {
		rows: [header, ...body],
		consumed: tableLines.length
	};
}
function MarkdownRenderer({ content }) {
	const lines = content.replace(/\r\n/g, "\n").split("\n");
	const blocks = [];
	let i = 0;
	let key = 0;
	while (i < lines.length) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed) {
			i++;
			continue;
		}
		if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
			blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("hr", { className: "my-6 border-slate-200" }, key++));
			i++;
			continue;
		}
		const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
		if (hMatch) {
			const level = hMatch[1].length;
			const text = hMatch[2];
			const sizeCls = level === 1 ? "text-base" : level === 2 ? "text-sm" : "text-xs";
			const mtCls = level <= 2 ? "mt-6" : "mt-5";
			blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: `${sizeCls} ${mtCls} mb-3 font-semibold text-slate-800 flex items-center gap-1.5`,
				children: renderInline(text, `h-${key}`)
			}, key++));
			i++;
			continue;
		}
		if (trimmed.startsWith(">")) {
			const quoteLines = [];
			while (i < lines.length && lines[i].trim().startsWith(">")) {
				quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
				i++;
			}
			blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("blockquote", {
				className: "my-4 pl-3 border-l-2 border-amber-400/40 bg-amber-400/[0.04] py-1.5 pr-2 rounded-r text-xs text-slate-600",
				children: renderInline(quoteLines.join(" "), `q-${key}`)
			}, key++));
			continue;
		}
		if (trimmed.startsWith("|")) {
			const table = parseTable(lines, i);
			if (table) {
				const [header, ...body] = table.rows;
				const ncol = header.length;
				blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "my-5 overflow-hidden rounded border border-slate-200",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
						className: "w-full text-xs border-collapse table-fixed",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("colgroup", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("col", { className: "w-auto" }), Array.from({ length: ncol - 1 }).map((_$1, ci$1) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("col", { className: ci$1 === ncol - 2 ? "w-1/2" : "w-auto" }, ci$1))] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", {
								className: "bg-slate-50",
								children: header.map((cell, ci$1) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
									className: "px-2.5 py-1.5 text-left font-medium text-slate-700 border-b border-slate-200 whitespace-nowrap",
									children: renderInline(cell, `th-${key}-${ci$1}`)
								}, ci$1))
							}) }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: body.map((row, ri$1) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", {
								className: "border-b border-slate-100 last:border-0",
								children: row.map((cell, ci$1) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
									className: "px-2.5 py-1.5 text-slate-600 align-top break-words",
									children: renderInline(cell, `td-${key}-${ri$1}-${ci$1}`)
								}, ci$1))
							}, ri$1)) })
						]
					})
				}, key++));
				i += table.consumed;
				continue;
			}
		}
		if (/^[-*]\s+/.test(trimmed)) {
			const items = [];
			while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
				i++;
			}
			blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: "my-4 space-y-2",
				children: items.map((item, ii$1) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					className: "flex items-start gap-2 text-sm text-slate-600 leading-relaxed",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "mt-[7px] h-1 w-1 rounded-full bg-emerald-500 shrink-0" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: renderInline(item, `li-${key}-${ii$1}`) })]
				}, ii$1))
			}, key++));
			continue;
		}
		if (/^\d+\.\s+/.test(trimmed)) {
			const items = [];
			while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
				i++;
			}
			blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
				className: "my-4 space-y-2",
				children: items.map((item, ii$1) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
					className: "flex items-start gap-2 text-xs text-slate-600 leading-relaxed",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "mt-0.5 h-4 w-4 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-mono flex items-center justify-center shrink-0",
						children: ii$1 + 1
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "flex-1 text-slate-600",
						children: renderInline(item, `ol-${key}-${ii$1}`)
					})]
				}, ii$1))
			}, key++));
			continue;
		}
		blocks.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
			className: "my-3 text-sm text-slate-600 leading-relaxed",
			children: renderInline(trimmed, `p-${key}`)
		}, key++));
		i++;
	}
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: blocks });
}
var init_MarkdownRenderer = __esm({ "src/components/MarkdownRenderer.tsx"() {} });

//#endregion
//#region src/components/AiReportCard.tsx
/** AI 个股分析报告卡片：四维分析内容渲染 + 删除 */
function AiReportCard({ report, onDelete }) {
	const [expanded, setExpanded] = (0, react.useState)(false);
	const handleDelete = async () => {
		await api.stockAnalysisReportDelete(report.id);
		onDelete?.(report.id);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "rounded-lg border border-slate-200 bg-white p-3",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "mb-2 flex items-center justify-between",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-1.5",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Sparkles, { className: "h-3.5 w-3.5 text-blue-500" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "text-xs font-medium text-slate-600",
						children: "AI 四维分析"
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-2",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "text-[10px] text-slate-400",
						children: fmtDate(report.created_at)
					}), onDelete && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						onClick: handleDelete,
						className: "p-0.5 text-slate-300 hover:text-red-500",
						title: "删除",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Trash2, { className: "h-3.5 w-3.5" })
					})]
				})]
			}),
			report.summary && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "mb-2 rounded bg-blue-50 px-2 py-1.5 text-xs text-slate-600",
				children: report.summary
			}),
			report.content ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: `overflow-auto ${expanded ? "" : "max-h-48"}`,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MarkdownRenderer, { content: report.content })
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "text-xs text-slate-400 py-4",
				children: "分析生成中…"
			}),
			report.content && report.content.length > 400 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				onClick: () => setExpanded((v$1) => !v$1),
				className: "mt-2 text-[11px] text-blue-500 hover:text-blue-700",
				children: expanded ? "收起" : "展开全文"
			})
		]
	});
}
var init_AiReportCard = __esm({ "src/components/AiReportCard.tsx"() {
	init_lucide_react();
	init_api();
	init_MarkdownRenderer();
	init_format();
} });

//#endregion
//#region src/pages/StockDetailPage.tsx
var StockDetailPage_exports = {};
__export(StockDetailPage_exports, { StockDetailPage: () => StockDetailPage });
function StockDetailPage() {
	const [state, setState] = (0, react.useState)({
		...EMPTY,
		fields: loadInfoFields()
	});
	const [loading, setLoading] = (0, react.useState)(false);
	const [error, setError] = (0, react.useState)("");
	const [reports, setReports] = (0, react.useState)([]);
	const chartRowsRef = (0, react.useRef)([]);
	(0, react.useEffect)(() => {
		saveInfoFields(state.fields);
	}, [state.fields]);
	(0, react.useEffect)(() => {
		(async () => {
			try {
				const res = await api.watchlistList();
				setState((s) => ({
					...s,
					watchlist: res.symbols.map((e$1) => e$1.symbol)
				}));
			} catch {}
		})();
	}, []);
	const loadSymbol = (0, react.useCallback)((symbol) => {
		if (!symbol) return;
		setLoading(true);
		setError("");
		Promise.allSettled([api.klineDaily(symbol, 120), api.stockAnalysisLevels(symbol, 120)]).then(([kRes, lRes]) => {
			if (cancelledRef.current) return;
			const rows = kRes.status === "fulfilled" ? kRes.value.rows : [];
			const levels = lRes.status === "fulfilled" ? lRes.value : null;
			if (!rows.length) setError("暂无该标的 K 线数据");
			setState((s) => ({
				...s,
				symbol,
				name: rows.length ? rows[rows.length - 1].name ?? s.name ?? symbol : s.name,
				rows,
				stockInfo: kRes.status === "fulfilled" ? kRes.value.stock_info : void 0,
				levels
			}));
			chartRowsRef.current = rows;
			setLoading(false);
		});
	}, []);
	const cancelledRef = (0, react.useRef)(false);
	(0, react.useEffect)(() => {
		cancelledRef.current = false;
		return () => {
			cancelledRef.current = true;
		};
	}, []);
	const handleSelect = (0, react.useCallback)((symbol) => {
		loadSymbol(symbol);
	}, [loadSymbol]);
	const toggleWatchlist = (0, react.useCallback)((symbol) => {
		const inList = state.watchlist.includes(symbol);
		if (inList) api.watchlistRemove(symbol).then(() => setState((s) => ({
			...s,
			watchlist: s.watchlist.filter((w$1) => w$1 !== symbol)
		})));
		else api.watchlistAdd(symbol).then(() => setState((s) => ({
			...s,
			watchlist: [...s.watchlist, symbol]
		})));
	}, [state.watchlist]);
	const latestClose = (0, react.useMemo)(() => {
		const latest = state.rows[state.rows.length - 1];
		return latest ? Number(latest.close) : 0;
	}, [state.rows]);
	const activeLevelTypes = (0, react.useMemo)(() => {
		if (!state.levels) return /* @__PURE__ */ new Set();
		return new Set(Object.keys(state.levels.levels));
	}, [state.levels]);
	const handleReportAdded = (0, react.useCallback)((report) => {
		setReports((prev) => [report, ...prev]);
	}, []);
	const handleReportDelete = (0, react.useCallback)((id) => {
		setReports((prev) => prev.filter((r$1) => r$1.id !== id));
	}, []);
	const handleFieldsChange = (0, react.useCallback)((fields) => {
		setState((s) => ({
			...s,
			fields
		}));
	}, []);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "flex h-full w-full overflow-hidden bg-white text-slate-800",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "flex min-w-0 flex-1 flex-col overflow-auto px-3 py-3",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "mb-3 flex items-center gap-2",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(InstrumentSearch, { onSelect: handleSelect }),
						state.name && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "text-sm font-medium text-slate-600",
							children: state.name
						}),
						latestClose > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "text-lg font-bold tabular-nums text-red-600",
							children: fmtPrice(latestClose)
						}),
						state.symbol && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							onClick: () => toggleWatchlist(state.symbol),
							className: `ml-auto p-1 rounded cursor-pointer ${state.watchlist.includes(state.symbol) ? "text-yellow-500" : "text-slate-300 hover:text-slate-500"}`,
							title: state.watchlist.includes(state.symbol) ? "移出自选" : "加自选",
							children: "⭐"
						})
					]
				}),
				error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "mb-2 rounded bg-red-50 px-3 py-2 text-xs text-red-500",
					children: error
				}),
				state.rows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StockInfoBar, {
					symbol: state.symbol,
					name: state.name,
					stockInfo: state.stockInfo,
					rows: state.rows,
					fields: state.fields,
					onFieldsChange: handleFieldsChange,
					inWatchlist: state.watchlist.includes(state.symbol),
					onToggleWatchlist: () => toggleWatchlist(state.symbol)
				}),
				state.symbol && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "mt-2",
					children: loading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "flex h-64 items-center justify-center text-sm text-slate-400",
						children: "K 加载中…"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(KlineChart, {
						symbol: state.symbol,
						height: 320,
						onDataChange: (rows) => {
							chartRowsRef.current = rows;
						}
					})
				}),
				state.levels && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "mt-4",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "mb-2 text-xs font-medium text-slate-500",
						children: "关键价位"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PriceLevels, {
						levels: state.levels.levels,
						close: latestClose,
						activeTypes: activeLevelTypes
					})]
				}),
				state.symbol && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "mt-4",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AiAnalysisHost, {
						symbol: state.symbol,
						name: state.name,
						onReportAdded: handleReportAdded
					})
				}),
				reports.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "mt-4 space-y-2",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: "text-xs font-medium text-slate-500",
						children: "分析报告"
					}), reports.map((r$1) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AiReportCard, {
						report: r$1,
						onDelete: handleReportDelete
					}, r$1.id))]
				})
			]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: "w-40 shrink-0 border-l border-slate-100 px-3 py-3",
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Watchlist, {
				symbols: state.watchlist,
				onRemove: (sym) => setState((s) => ({
					...s,
					watchlist: s.watchlist.filter((w$1) => w$1 !== sym)
				})),
				onClear: () => setState((s) => ({
					...s,
					watchlist: []
				}))
			})
		})]
	});
}
var EMPTY;
var init_StockDetailPage = __esm({ "src/pages/StockDetailPage.tsx"() {
	init_api();
	init_InstrumentSearch();
	init_KlineChart();
	init_StockInfoBar();
	init_PriceLevels();
	init_Watchlist();
	init_AiAnalysisHost();
	init_AiReportCard();
	init_stock_info_fields();
	init_format();
	EMPTY = {
		symbol: "",
		name: "",
		rows: [],
		levels: null,
		watchlist: [],
		fields: BUILTIN_INFO_FIELDS
	};
} });

//#endregion
//#region src/client.ts
/** stock 列的宽度（px）——由 ui-layout 的 computeColumns 决定，这里仅文档化。 */
const STOCK_COL_MIN = 200;
const STOCK_COL_MAX = 420;
/**
* StockPanel：主布局第四列的根组件。
*
* 不再用 fixed 定位浮层，而是填满 ui-layout 分配的 stock 列空间
* （className 由 patch-layout 注入为 `pI_x6G_stockCol`）。顶部工具栏显示
* 标题 + 收起按钮，主体异步加载 StockDetailPage（与旧版相同的懒加载策略）。
*/
function StockPanel() {
	const [collapsed, setCollapsed] = (0, react.useState)(false);
	if (collapsed) return (0, react.createElement)("div", {
		className: "dsh-stock",
		style: {
			alignItems: "center",
			justifyContent: "center"
		}
	}, (0, react.createElement)("button", {
		onClick: () => setCollapsed(false),
		title: "展开 A股量化工作台",
		style: {
			writingMode: "vertical-rl",
			border: "none",
			background: "transparent",
			cursor: "pointer",
			fontSize: 12,
			color: "var(--ds-muted)",
			padding: "8px 4px"
		}
	}, "📈 工作台"));
	return (0, react.createElement)("div", { className: "dsh-stock" }, (0, react.createElement)("div", { className: "ds-toolbar" }, (0, react.createElement)("div", { className: "ds-title" }, (0, react.createElement)("span", null, "📈 A股量化工作台")), (0, react.createElement)("button", {
		className: "ds-close",
		onClick: () => setCollapsed(true),
		title: "收起"
	}, "⟩")), (0, react.createElement)("div", { className: "ds-body" }, (0, react.createElement)(StockDetailLoader)));
}
/**
* 内部加载器：异步加载 StockDetailPage，加载完成后渲染。
* 与旧版一致：用 useState 跟踪加载状态，加载失败显示错误信息。
*/
function StockDetailLoader() {
	const [tick, setTick] = (0, react.useState)(0);
	const CompRef = (0, react.useRef)(null);
	if (CompRef.current === null) (async () => {
		try {
			const mod = await Promise.resolve().then(() => (init_StockDetailPage(), StockDetailPage_exports));
			CompRef.current = mod.StockDetailPage;
			setTick((n) => n + 1);
			if (typeof console !== "undefined") console.log("[stock-panel] StockDetailPage loaded, keys:", Object.keys(mod));
		} catch (err) {
			if (typeof console !== "undefined") console.error("[stock-panel] failed to load StockDetailPage:", err);
			CompRef.current = function renderError() {
				return (0, react.createElement)("div", { style: {
					padding: 16,
					color: "#ef4444"
				} }, "加载失败: " + String(err));
			};
			setTick((n) => n + 1);
		}
	})();
	const Comp = CompRef.current;
	return Comp ? (0, react.createElement)(Comp) : (0, react.createElement)("div", { style: {
		padding: 16,
		color: "#94a3b8"
	} }, "加载中…");
}
/**
* 插件体。ctx 由 dsh.client 运行时注入。
*
* 只注册一个 additive slot：
*   - `stock`：主布局最右列（由 patch-layout 新增，落在 details 列右侧）。
*
* 工作台不再放入对话区右侧的 split（stock.preview），避免与对话争宽度、
* 压垮输入框所在区域。
*/
function apply(ctx) {
	const slots = ctx.slots;
	if (typeof window !== "undefined") window.__DSH_DATA_SOURCE__ = window.__DSH_DATA_SOURCE__ || "mcp";
	if (typeof console !== "undefined") console.log("[stock-panel] apply called, slot: stock");
	slots.register({
		name: "stock",
		id: "stock-panel",
		priority: 100
	}, () => (0, react.createElement)(StockPanel));
}

//#endregion
exports.STOCK_COL_MAX = STOCK_COL_MAX;
exports.STOCK_COL_MIN = STOCK_COL_MIN;
exports.StockPanel = StockPanel;
exports.apply = apply;
    //#endregion
    exports.inject = ["slots"];
    return module.exports;
  }
});

//# sourceMappingURL=client.js.map





